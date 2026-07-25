'use client'

import { useEffect, useRef } from 'react'

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

    loadYouTubeApi().then((YT) => {
      if (cancelled || !mountRef.current) return

      instance = new YT.Player(mountRef.current, {
        videoId: ad.youtubeId as string,
        // The no-cookie host is what the privacy policy promises for embeds.
        host: 'https://www.youtube-nocookie.com',
        playerVars: {
          controls: 0, // no scrubbing — see the note at the top
          disablekb: 1,
          modestbranding: 1,
          rel: 0,
          playsinline: 1, // iOS must not take over with its fullscreen player
          fs: 0,
        },
        events: {
          onReady: () => {
            if (cancelled || !instance) return
            playerRef.current = instance
            onReadyRef.current(instance.getDuration())
            // The tap that started this may have landed while the API was
            // still loading, so honour it now rather than losing it.
            if (wantPlayingRef.current) instance.playVideo()

            // getCurrentTime polling is the only position signal the IFrame
            // API offers; 4 Hz is precise enough to land a cue on the intended
            // second and cheap enough for a low-end handset.
            ticker = setInterval(() => {
              const p = playerRef.current
              if (p) onTimeRef.current(p.getCurrentTime())
            }, 250)
          },
          onStateChange: (e) => {
            if (e.data === YT_ENDED) onEndedRef.current()
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
    // The API REPLACES the mount node with its iframe, so the iframe ends up a
    // child of this wrapper — carrying the API's own width/height attributes.
    // The child selector is what overrides them; styling the mount node itself
    // would have no effect once it is gone.
    return (
      <div className="relative size-full [&>iframe]:absolute [&>iframe]:inset-0 [&>iframe]:size-full">
        <div ref={mountRef} className="size-full" />
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
