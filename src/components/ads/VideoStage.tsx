'use client'

import { useEffect, useRef, useState } from 'react'

import type { FeedAd } from '@/lib/ads/data'

/**
 * The video surface, for both sources an ad can have.
 *
 * Two things it deliberately does NOT give the user:
 *
 *   - Native controls. Scrubbing is how you skip an advert, and the whole
 *     reward depends on the ad actually being watched. The parent draws its
 *     own non-interactive progress bar instead, so the user can still see how
 *     far along they are.
 *   - Autoplay. Mobile browsers refuse unmuted autoplay anyway, and a video
 *     that starts silently is a video the user thinks is broken. The parent
 *     gates playback behind one tap, which is both the platform rule and the
 *     honest interaction.
 *
 * Playback is driven by the `playing` prop rather than an imperative handle,
 * so the question overlay pausing the video is a state change like any other
 * and cannot drift out of sync with what is on screen.
 *
 * None of the timing reported here is trusted for money. The server stamped
 * its own clock in register_ad_view and re-checks elapsed time on submit; the
 * numbers below only decide when to draw a question.
 */

type YTPlayer = {
  playVideo(): void
  pauseVideo(): void
  getCurrentTime(): number
  getDuration(): number
  destroy(): void
}

type YTNamespace = {
  Player: new (
    el: HTMLElement,
    opts: {
      videoId: string
      host?: string
      playerVars?: Record<string, number | string>
      events?: {
        onReady?: () => void
        onStateChange?: (e: { data: number }) => void
        onError?: (e: { data: number }) => void
      }
    },
  ) => YTPlayer
}

declare global {
  interface Window {
    YT?: YTNamespace
    onYouTubeIframeAPIReady?: () => void
  }
}

/**
 * The IFrame API is a singleton script with one global ready callback, so the
 * promise is module-level: mounting the player twice in one session must not
 * inject the script twice or clobber a pending callback.
 */
let apiPromise: Promise<YTNamespace> | null = null

function loadYouTubeApi(): Promise<YTNamespace> {
  if (apiPromise) return apiPromise
  apiPromise = new Promise((resolve) => {
    if (window.YT && window.YT.Player) {
      resolve(window.YT)
      return
    }
    const previous = window.onYouTubeIframeAPIReady
    window.onYouTubeIframeAPIReady = () => {
      if (previous) previous()
      resolve(window.YT as YTNamespace)
    }
    const script = document.createElement('script')
    script.src = 'https://www.youtube.com/iframe_api'
    script.async = true
    document.head.appendChild(script)
  })
  return apiPromise
}

const YT_ENDED = 0
const YT_PLAYING = 1
const YT_PAUSED = 2

export function VideoStage({
  ad,
  playing,
  onTime,
  onEnded,
  onReady,
  onError,
}: {
  ad: FeedAd
  playing: boolean
  /** Current playback position in seconds. Drives the cue points. */
  onTime: (seconds: number) => void
  onEnded: () => void
  onReady: (durationSeconds: number) => void
  /** The video cannot be played at all — removed, embed-blocked, or the file
   *  will not load. The user must be told, not left on a black rectangle. */
  onError: () => void
}) {
  const mountRef = useRef<HTMLDivElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  /*
    Set only once onReady has fired. Constructing a YT.Player returns an object
    immediately, but its methods do not exist yet — polling getCurrentTime on
    it throws "is not a function" several times a second and the ad never
    plays. Holding the reference back until onReady is what makes every other
    caller in this file safe.
  */
  const playerRef = useRef<YTPlayer | null>(null)
  /** Whether playback was requested before the player finished loading. */
  const wantPlayingRef = useRef(playing)
  /*
    Whether the curtain in the markup is down over the frame.

    YouTube only shows its own furniture — the channel avatar, the title, the
    channel name, its red play button, the "Watch on YouTube" link, the grid of
    related videos — when the video is NOT playing. So the rule is simply: if
    it is not playing, it is covered. That is driven off the player's own state
    events rather than the `playing` prop, because the prop says what we ASKED
    for and the event says what YouTube actually did, and the gap between the
    two is exactly where its branding appears.

    STARTS COVERED, AND onReady RE-COVERS. The single worst offender is the
    state before anybody has pressed anything: an unstarted embed paints the
    avatar, the title, the channel name and a "Watch on YouTube" link straight
    onto the poster, and that is the first thing a viewer ever sees. Only
    PLAYING lifts this, so there is no window — not at mount, not while the API
    loads, not between ready and the first frame — in which any of it shows.

    State rather than a ref because it has to cause a paint, and it cannot live
    in the parent: by the time a phase change has travelled up and back down,
    YouTube has already rendered a frame of its own.
  */
  const [covered, setCovered] = useState(true)

  /*
    The callbacks are held in refs and read inside the interval rather than
    listed as effect dependencies. A parent that re-renders on every tick (this
    one does — it is showing a progress bar) would otherwise tear down and
    rebuild the YouTube player several times a second.
  */
  const onTimeRef = useRef(onTime)
  const onEndedRef = useRef(onEnded)
  const onReadyRef = useRef(onReady)
  const onErrorRef = useRef(onError)
  useEffect(() => {
    onTimeRef.current = onTime
    onEndedRef.current = onEnded
    onReadyRef.current = onReady
    onErrorRef.current = onError
  })

  // ---- YouTube -----------------------------------------------------------
  useEffect(() => {
    if (!ad.youtubeId) return
    let cancelled = false
    let ticker: ReturnType<typeof setInterval> | null = null
    let instance: YTPlayer | null = null

    /*
      NOW THAT THE TAP WAITS FOR onReady, onReady NEVER ARRIVING IS A DEAD END.
      The parent holds its play button disabled until this player is ready, so a
      YouTube script that never loads — blocked, offline, a connection that has
      simply given up — would leave the viewer on a spinner with nothing to
      press. The API reports nothing in that case: no player is ever
      constructed, so there is no onError either.

      Treating silence as a failure is what gives them a way out: the parent's
      'unavailable' state says so plainly and offers a button. 20 seconds
      because this audience is on mobile data and a slow load is not a broken
      one.
    */
    let stalled: ReturnType<typeof setTimeout> | null = setTimeout(() => {
      stalled = null
      if (!cancelled && !playerRef.current) onErrorRef.current()
    }, 20_000)
    const cancelStallTimer = () => {
      if (stalled) clearTimeout(stalled)
      stalled = null
    }

    loadYouTubeApi().then((YT) => {
      if (cancelled || !mountRef.current) return

      instance = new YT.Player(mountRef.current, {
        videoId: ad.youtubeId as string,
        // The no-cookie host is what the privacy policy promises for embeds.
        host: 'https://www.youtube-nocookie.com',
        playerVars: {
          controls: 0, // no scrubbing — see the note at the top
          disablekb: 1,
          // Kept for the players that still honour it, but it is NOT what
          // hides YouTube from the user: YouTube deprecated modestbranding in
          // 2023 and it is a no-op on current embeds. The inert iframe and the
          // shield in the markup below are what actually do that job.
          modestbranding: 1,
          // Annotations and end-of-video cards are YouTube-branded widgets
          // drawn over the frame, and they are clickable links off this app.
          iv_load_policy: 3,
          rel: 0,
          playsinline: 1, // iOS must not take over with its fullscreen player
          fs: 0,
        },
        events: {
          onReady: () => {
            if (cancelled || !instance) return
            playerRef.current = instance
            cancelStallTimer()
            // A fresh player is showing its unstarted poster, branding and all,
            // so it must be covered — including when this component is reused
            // for the next ad and the previous one left the curtain up. Done
            // here rather than in the effect body because a fresh player IS the
            // signal, and no state event can fire before its own onReady.
            setCovered(true)
            onReadyRef.current(instance.getDuration())
            // The tap that started this may have landed while the API was
            // still loading, so honour it now rather than losing it.
            if (wantPlayingRef.current) instance.playVideo()

            // getCurrentTime polling is the only position signal the IFrame
            // API offers; 4 Hz is precise enough to land a cue on the intended
            // second and cheap enough for a low-end handset.
            let lastSeen = -1
            ticker = setInterval(() => {
              const p = playerRef.current
              if (!p) return
              const at = p.getCurrentTime()
              /*
                A moving clock is proof of playback, and proof beats an event we
                might not have received. Covering the frame is now the default,
                so a missed PLAYING would leave the cover stuck over a video the
                viewer can hear but not see — a worse failure than the branding
                this is all guarding against.

                Gated on having ASKED for playback. Without that, the tick
                between pauseVideo() and YouTube's PAUSED event would still see
                the clock advancing, lift the cover, and flash the branded
                paused frame for a quarter of a second, which is the exact thing
                a question pause is meant to hide.
              */
              if (wantPlayingRef.current && at > lastSeen + 0.01) setCovered(false)
              lastSeen = at
              onTimeRef.current(at)
            }, 250)
          },
          onStateChange: (e) => {
            /*
              PAUSED is the one that matters for how native this feels. A
              question pausing the video is the common case, and a paused
              YouTube embed draws its logo and a "Watch on YouTube" link over
              the frame. Covering it is the only way to keep those out: they
              are painted inside the iframe, so no amount of blocking pointer
              events can reach them.

              BUFFERING is deliberately not covered. It happens mid-playback on
              a slow connection, and a curtain that flickered every time the
              network stuttered would be worse than the spinner it hid.
            */
            if (e.data === YT_PLAYING) setCovered(false)
            if (e.data === YT_PAUSED) setCovered(true)
            if (e.data === YT_ENDED) {
              setCovered(true)
              onEndedRef.current()
            }
          },
          // Embedding disabled, video removed, region-blocked. Without this the
          // user sits on a black rectangle until they give up; the parent turns
          // it into an honest "this ad is not available".
          onError: () => onErrorRef.current(),
        },
      })
    })

    return () => {
      cancelled = true
      cancelStallTimer()
      if (ticker) clearInterval(ticker)
      playerRef.current = null
      // destroy() on a player that never became ready can throw; a failed
      // teardown must not take the overlay down with it.
      try {
        if (instance) instance.destroy()
      } catch {
        /* nothing useful to do */
      }
    }
  }, [ad.youtubeId])

  // ---- Play / pause, both sources ---------------------------------------
  useEffect(() => {
    wantPlayingRef.current = playing
    const yt = playerRef.current
    const el = videoRef.current
    if (playing) {
      if (yt) yt.playVideo()
      // A rejected play() promise is normal (the user navigated away, the tab
      // is hidden); the parent's tap-to-play gate already handles the case
      // that matters.
      if (el) void el.play().catch(() => {})
    } else {
      if (yt) yt.pauseVideo()
      if (el) el.pause()
    }
  }, [playing])

  if (ad.youtubeId) {
    /*
      The API REPLACES the mount node with its iframe, so the iframe ends up a
      child of this wrapper — carrying the API's own width/height attributes.
      The child selector is what overrides them; styling the mount node itself
      would have no effect once it is gone.

      WHY THE EMBED IS INERT
      An ad has to read as part of this app, not as a YouTube video playing
      inside it. Everything YouTube puts in front of the user is reached by a
      pointer event on the iframe: the click that opens youtube.com in a new
      tab, the hover that slides in the title bar naming the video and channel,
      the share and watch-later buttons that come with it, and the right-click
      menu offering "Copy video URL". Taking those events away removes all of
      them at once, and costs nothing, because playback here is driven entirely
      through the JS API from the `playing` prop rather than by the user
      touching the player. `controls: 0` was already keeping them from
      scrubbing; this keeps them from leaving.

      WHY THE IFRAME IS THREE TIMES TOO TALL
      For the first couple of seconds of playback YouTube fades in its own
      furniture — the avatar, the title, the channel name and the logo with its
      link — anchored to the TOP AND BOTTOM EDGES OF THE PLAYER BOX. A curtain
      cannot help there, because the video is genuinely playing and covering it
      would hide the advert the viewer is being paid to watch.

      So the player box is made three times the height of what is on screen and
      pulled up by one whole height, which puts its top and bottom edges one
      screen-height above and below the visible area, and the furniture with
      them. Nothing is cropped from the video: YouTube fits the picture to the
      box's WIDTH and centres it vertically, so a 16:9 video in a box of this
      shape lands exactly in the middle third, which is precisely the area still
      visible. The parent already clips with `overflow-hidden`.
    */
    return (
      <div className="relative size-full overflow-hidden [&>iframe]:pointer-events-none [&>iframe]:absolute [&>iframe]:left-0 [&>iframe]:top-[-100%] [&>iframe]:h-[300%] [&>iframe]:w-full">
        <div ref={mountRef} className="size-full" />

        {/* Belt and braces over `pointer-events-none`: anything that still
            reaches the iframe's box lands here instead. It is also what the
            parent's own overlays sit above, so their z-order is unchanged. */}
        <div aria-hidden className="absolute inset-0" />

        {/*
          WHAT A SHIELD CANNOT STOP.
          Blocking pointer events keeps the user from reaching YouTube, but the
          avatar, the title, the channel name, the red play button, the "Watch
          on YouTube" link and the end-of-video grid of related videos are all
          painted INSIDE the iframe, so nothing outside it can hide them. Only
          covering the frame can.

          Three moments need it. Before playback, where an unstarted embed shows
          the lot and it is the first thing a viewer meets. During a question,
          because a paused embed shows its logo and link. And after the last
          frame, where the related-video grid appears: `rel: 0` has not removed
          those since 2018, it only limits them to the same channel. This
          component stays mounted through the result phase and the parent's
          result panel is translucent, so without this they would show through
          it.

          It carries the ad's own still rather than being plain black, so what
          the viewer meets is a cover image belonging to this app. For a YouTube
          ad with no uploaded artwork that still comes from YouTube's servers,
          but it is a frame of the video with no branding drawn on it. `cover`
          crops the 4:3 still to the player's 16:9 box, which is what trims off
          the letterbox bars the thumbnail is stored with.
        */}
        {covered && (
          <div
            aria-hidden
            className="absolute inset-0 bg-black bg-cover bg-center"
            style={
              ad.thumbnailUrl ? { backgroundImage: `url(${ad.thumbnailUrl})` } : undefined
            }
          />
        )}
      </div>
    )
  }

  if (ad.videoUrl) {
    return (
      <video
        ref={videoRef}
        src={ad.videoUrl}
        playsInline
        preload="auto"
        poster={ad.thumbnailUrl ?? undefined}
        disablePictureInPicture
        onContextMenu={(e) => e.preventDefault()}
        onLoadedMetadata={(e) => onReadyRef.current(e.currentTarget.duration)}
        onTimeUpdate={(e) => onTimeRef.current(e.currentTarget.currentTime)}
        onEnded={() => onEndedRef.current()}
        onError={() => onErrorRef.current()}
        className="size-full bg-black object-contain"
      />
    )
  }

  return null
}
