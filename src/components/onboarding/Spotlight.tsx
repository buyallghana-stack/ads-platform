'use client'

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'

import { ArrowRight } from 'lucide-react'
import { useTranslations } from 'next-intl'

import { useMounted } from '@/components/onboarding/use-mounted'
import { Button } from '@/components/ui/Button'

type Box = { top: number; left: number; width: number; height: number }

/** Distance between the element and the edge of the cutout. */
const PAD = 10
/** Corner radius of the cutout. Matched to the app's own cards, not to a
 *  library default, so the hole reads as part of the interface. */
const RADIUS = 14
/** Height reserved at the bottom for the bubble, so nothing hides behind it. */
const CARD_ZONE = 260
/** Space kept clear at the top, so a target never sits under the app header. */
const TOP_GUTTER = 72

/** A rounded rectangle, as an SVG path. */
function roundedRect({ top, left, width, height }: Box, r: number) {
  const x = left
  const y = top
  const w = width
  const h = height
  const rr = Math.min(r, w / 2, h / 2)
  return (
    `M${x + rr},${y}` +
    `H${x + w - rr}A${rr},${rr} 0 0 1 ${x + w},${y + rr}` +
    `V${y + h - rr}A${rr},${rr} 0 0 1 ${x + w - rr},${y + h}` +
    `H${x + rr}A${rr},${rr} 0 0 1 ${x},${y + h - rr}` +
    `V${y + rr}A${rr},${rr} 0 0 1 ${x + rr},${y}Z`
  )
}

/**
 * One SVG, with a rounded hole punched through it.
 *
 * ⚠️ WHY AN SVG AND NOT FOUR DIVS, WHICH IS WHAT THIS WAS. Four rectangles
 * framing the target leave a SQUARE hole with hard seams against a rounded
 * card, and every one of them takes taps, so the only reachable thing on the
 * screen is the exact element being pointed at. That is correct for "here is
 * your balance" and catastrophic for "go and watch an ad": the surveys tab,
 * every other card and the video player itself all sit under a shade, so the
 * step can never finish and the app looks frozen. Action steps do not use this
 * component at all now; they use the task bar, which dims nothing.
 *
 * A single path with `fill-rule: evenodd` gives a genuinely rounded hole, and
 * SVG hit-testing only applies to PAINTED area, so a tap in the hole reaches
 * the real element with nothing to opt out of. It renders back to the oldest
 * browser this app supports, unlike the `clip-path` and mask versions of the
 * same idea.
 *
 * The scrim is 50%, which is the settled default across every tour library.
 * At 75% the app behind it reads as switched off rather than as the thing
 * being explained.
 */
export function Spotlight({
  anchor,
  title,
  body,
  index,
  total,
  busy = false,
  onNext,
  onSkip,
}: {
  anchor: string
  title: string
  body: string
  index: number
  total: number
  busy?: boolean
  onNext: () => void
  onSkip: () => void
}) {
  const t = useTranslations('onboarding')
  const mounted = useMounted()

  /* The measurement is stored WITH the anchor it belongs to, so moving on
     makes it stale by definition and no reset has to run inside the effect. */
  const [measured, setMeasured] = useState<{ anchor: string; box: Box } | null>(null)
  const [viewport, setViewport] = useState({ w: 0, h: 0 })
  /** The first measurement has run, so a missing anchor is really missing. */
  const [settled, setSettled] = useState(false)

  useEffect(() => {
    const find = () => document.querySelector<HTMLElement>(`[data-tour="${anchor}"]`)

    /** Where the target should sit: centred in the space the card leaves. */
    const wantedTop = (height: number) => {
      const safeHeight = Math.max(window.innerHeight - CARD_ZONE - TOP_GUTTER, 120)
      /* A target taller than the space starts at the top, because the
         beginning of a thing is the part worth showing. Anything that fits is
         centred, which looks deliberate. */
      return height >= safeHeight ? TOP_GUTTER : TOP_GUTTER + (safeHeight - height) / 2
    }

    /**
     * The element that actually scrolls.
     *
     * ⚠️ NOT ALWAYS THE WINDOW. `window.scrollBy` silently does nothing when
     * the page scrolls inside a container, and a positioning step that
     * silently does nothing is exactly how this failed: the target stayed
     * below the fold, so nothing was lit and the card flipped to the top of an
     * apparently broken screen.
     */
    const scroller = (() => {
      let node = find()?.parentElement ?? null
      while (node) {
        const style = getComputedStyle(node)
        if (/(auto|scroll)/.test(style.overflowY) && node.scrollHeight > node.clientHeight) return node
        node = node.parentElement
      }
      return null
    })()

    /**
     * Move the page so the target travels by `delta`, and report whether it
     * actually did.
     *
     * ⚠️ THE DETECTED SCROLLER IS A GUESS, AND A WRONG GUESS USED TO BE FATAL.
     * Scrolling a container that does not contain the target moves nothing,
     * the stall counter then fills up, and the loop gives up with the target
     * 1200px off screen. So the guess is checked against the only thing that
     * matters, the target's own position, and the window is tried when it was
     * wrong.
     */
    const nudge = (delta: number) => {
      const topOf = () => find()?.getBoundingClientRect().top ?? null
      const before = topOf()

      if (scroller) {
        scroller.scrollTop += delta
        if (before !== null && Math.abs((topOf() ?? before) - before) > 1) return true
      }

      window.scrollBy(0, delta)
      return before !== null && Math.abs((topOf() ?? before) - before) > 1
    }

    /*
      ⚠️ POSITIONING KEEPS CORRECTING UNTIL IT LANDS, AND THE PAGE IS ONLY
      LOCKED ONCE IT HAS.

      Both were single shots before, run synchronously in this effect, and on a
      real phone neither held: the dashboard was still settling (the checklist
      expands, the hero paints) so the one scroll went to a stale position, and
      locking the page immediately afterwards meant nothing could correct it.
      The member got a dimmed screen with nothing lit on it and a card at the
      top, twice, and reported the walkthrough as broken from step seven on.

      So the loop owns both jobs: it nudges the target toward its place every
      frame until it is within tolerance for a few frames running, then locks.
      The cap stops it fighting a page that genuinely cannot scroll any
      further, which is the community step near the end of Profile.
    */
    /*
      ── THE LOCK IS EVENT BASED, NOT `overflow: hidden` ─────────────────────

      ⚠️ `document.body.style.overflow = 'hidden'` was the obvious lock and it
      was the bug. On a mobile browser it can clamp the scroll position back to
      zero the moment it is applied, which put the page at the top with the
      target far below the fold. It also blocks the walkthrough's OWN
      corrections, so once it was on, nothing could pull the page back.

      On the operator's phone, over LTE, `router.refresh()` after advancing a
      step landed AFTER the loop had settled and locked, reset the scroll, and
      left a dimmed screen with nothing lit on it. It passed here every time
      because a headless run finishes the refresh before the loop settles.

      Blocking the input events instead stops the member scrolling while
      leaving programmatic scrolling to us, and it never moves the page by
      itself.
    */
    const swallow = (e: Event) => e.preventDefault()
    const keys = new Set(['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '])
    const swallowKey = (e: KeyboardEvent) => {
      if (keys.has(e.key)) e.preventDefault()
    }
    window.addEventListener('wheel', swallow, { passive: false })
    window.addEventListener('keydown', swallowKey)

    /*
      ⚠️ NO GLOBAL `touchmove` HANDLER. A non-passive touchmove listener on the
      window makes the browser wait for JavaScript before it can act on ANY
      touch, which adds latency to every tap on the page, not just to
      scrolling. On a cheap phone that is the difference between a button that
      responds and one that does not.

      The dimmed area carries `touch-action: none` instead (see the svg below),
      which the compositor honours without consulting us at all. Touches inside
      the hole are untouched by it, which is the point: that is the one element
      the member is being asked to use.
    */

    let raf = 0
    let last = ''
    let frames = 0
    /** Consecutive nudges that moved nothing, so the page has no travel left. */
    let stalled = 0

    const tick = () => {
      frames += 1

      /*
        ⚠️ MEASURED EVERY FRAME ONLY WHILE IT IS MOVING. `getBoundingClientRect`
        forces a synchronous layout, and doing that sixty times a second for
        the whole life of a step is a phone that feels slow at everything, taps
        included. Once the target has settled this drops to roughly six times a
        second, which is still far faster than anything a page does on its own
        and costs almost nothing.
      */
      if (frames > 45 && frames % 10 !== 0 && frames % 30 !== 0) {
        raf = requestAnimationFrame(tick)
        return
      }

      const target = find()

      if (target) {
        const r = target.getBoundingClientRect()

        /*
          It keeps correcting, because anything that moves the page afterwards
          (a late revalidate most of all) would otherwise leave the target off
          screen for good.

          ⚠️ BUT IT GIVES UP WHEN SCROLLING ACHIEVES NOTHING, AND THAT MATTERS
          MORE THAN THE CORRECTION. When a target cannot reach its place
          because the page is already at the end of its travel, the delta never
          shrinks, so this asked the browser to scroll on EVERY FRAME, for ever.
          Sixty pointless scrolls a second is a phone that stops responding to
          taps: reported as a laggy card and as being stuck on step 2, which
          was not a stuck step at all but a Next button whose tap never landed.

          So a nudge that does not move the page is counted, and after a few in
          a row the loop stops asking. It starts asking again the moment the
          target really does move, which is what keeps the recovery working.
        */
        const delta = r.top - wantedTop(r.height)
        /*
          ⚠️ GIVING UP HAS TO BE TEMPORARY, NOT PERMANENT. A page that is still
          laying out cannot scroll to where it will eventually be able to
          scroll, so four failed nudges in a row is a perfectly ordinary thing
          to happen a few hundred milliseconds after a navigation. Treating it
          as final left the balance card a thousand pixels above the viewport,
          intermittently, depending on how fast the dashboard had settled.

          So four failures pause the attempts rather than end them, and the
          pause lifts about half a second later. The thrash this guard exists
          to prevent was sixty nudges a second; eight is not that.
        */
        if (Math.abs(delta) > 3) {
          /*
            ⚠️ A WHOLE SCREEN AWAY IS NOT A NUDGE, IT IS A JUMP. When the
            browser restores a scroll position on navigation the target can be
            a thousand pixels off, and creeping toward it by increments is both
            slow and fragile: one failed attempt while the page is still
            settling and the guard pauses with the target still nowhere.

            `scrollIntoView` is the browser's own job and it works whatever
            the scroll container turns out to be, which the walked-ancestor
            guess does not. It is used for the jump, and the nudges then do the
            fine correction that puts the target in the space above the card.
          */
          if (Math.abs(delta) > window.innerHeight * 0.6) {
            target.scrollIntoView({ block: 'center', behavior: 'instant' as ScrollBehavior })
            stalled = 0
          } else if (stalled < 4) {
            if (nudge(delta)) stalled = 0
            else stalled += 1
          } else if (frames % 30 === 0) {
            stalled = 0
          }
        }
        if (frames > 6) setSettled(true)

        const box = {
          top: r.top - PAD,
          left: r.left - PAD,
          width: r.width + PAD * 2,
          height: r.height + PAD * 2,
        }
        const key = `${Math.round(box.top)},${Math.round(box.left)},${Math.round(box.width)},${Math.round(box.height)},${window.innerWidth},${window.innerHeight}`
        if (key !== last) {
          /* The target moved on its own, so whatever pinned the page has let
             go. Let the loop try again. */
          if (last !== '' && last !== 'gone') stalled = 0
          last = key
          setMeasured({ anchor, box })
          setViewport({ w: window.innerWidth, h: window.innerHeight })
        }
      } else {
        if (frames > 30) setSettled(true)
        if (last !== 'gone') {
          last = 'gone'
          setMeasured(null)
        }
      }

      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)

    return () => {
      cancelAnimationFrame(raf)
      /* ⚠️ ALWAYS RELEASED. Leaving these listeners behind after the last step
         hands somebody an app they cannot scroll, with nothing on screen to
         explain why. */
      window.removeEventListener('wheel', swallow)
      window.removeEventListener('keydown', swallowKey)
      /* Belt and braces: an older build may have left this set. */
      document.body.style.overflow = ''
    }
  }, [anchor])

  // Portals only after mount; see `useMounted`.
  if (!mounted) return null
  const { w: vw, h: vh } = viewport

  /*
    ── NEVER STRAND ANYBODY ──────────────────────────────────────────────────

    ⚠️ This used to `return null` whenever the anchor could not be measured,
    which meant the step rendered NOTHING: no bubble, no Next, and no Skip. The
    walkthrough was still the current step, so the member was stuck on a screen
    with no way forward and nothing to press.

    Two ways that happened. The element simply is not on this screen, because a
    card only renders in one branch of a page. Or the anchor was a whole page
    wrapper, so the cutout was taller than the viewport and the bubble was
    pushed clean off the bottom (reported on the Team tab: "the next or skip is
    invisible to click").

    Both now fall back to the same card, centred, with no hole. It says the
    same thing and it can always be dismissed. Losing the pointer is a much
    smaller failure than losing the exit.
  */
  const box = measured?.anchor === anchor ? measured.box : null
  const usable = box !== null && box.height < vh * 0.62 && box.width <= vw

  if (!usable) {
    /* Still settling: say nothing for the first frames rather than flashing a
       centred card and then jumping to the real one. */
    if (measured === null && !settled) return null

    return createPortal(
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="fixed inset-0 z-100 flex items-end justify-center p-4 sm:items-center"
        style={{ background: 'rgb(15 23 42 / 0.5)' }}
      >
        <div className="w-[min(21rem,calc(100vw-2rem))] rounded-(--radius-panel) border border-ink-200 bg-surface p-4 shadow-[0_16px_48px_-12px_rgb(15_23_42/0.45)]">
          <p className="text-[0.6875rem] font-semibold uppercase tracking-[0.08em] text-brand-700">
            {t('progress', { index, total })}
          </p>
          <h2 className="mt-1.5 text-[0.9375rem] font-bold leading-snug text-ink-900">{title}</h2>
          <p className="mt-1.5 text-[0.8125rem] leading-relaxed text-ink-600">{body}</p>
          <div className="mt-4 flex items-center justify-between gap-3">
            <Button variant="ghost" size="sm" onClick={onSkip}>
              {t('skip')}
            </Button>
            <Button size="sm" onClick={onNext} loading={busy} trailingIcon={<ArrowRight />}>
              {t('next')}
            </Button>
          </div>
        </div>
      </div>,
      document.body,
    )
  }

  /*
    ⚠️ THE CARD MOVES OUT OF THE WAY WHEN IT WOULD COVER ITS OWN TARGET.

    Reported on the community step: the row was lit correctly and the card sat
    right on top of it, so the one thing the step was asking the member to tap
    could not be reached.

    The scroll normally lifts the target clear, but it cannot when the page has
    no more room to give: the community block is near the end of the Profile
    screen, so there is nothing left to scroll. When that happens the card goes
    to the TOP instead, which is what every tour does rather than insisting on
    one side.
  */
  const cardAtTop = box.top + box.height > vh - CARD_ZONE

  const hole = roundedRect(box, RADIUS)
  const screen = `M0,0H${vw}V${vh}H0Z`

  return createPortal(
    <div role="dialog" aria-modal="true" aria-label={title} className="fixed inset-0 z-100">
      <svg
        aria-hidden
        className="fixed inset-0 h-full w-full"
        style={{ pointerEvents: 'none', touchAction: 'none' }}
      >
        {/* `pointer-events: auto` on the PATH, not the svg. The hole is unpainted,
            so it is not part of the path's hit area and a tap there lands on the
            real control underneath. */}
        <path
          d={`${screen}${hole}`}
          fillRule="evenodd"
          fill="rgb(15 23 42 / 0.5)"
          style={{ pointerEvents: 'auto' }}
        />
        {/*
          The edge of the cutout.

          ⚠️ TWO STROKES, AND THE SOFT ONE IS FOR DARK MODE. A 50% scrim over a
          light app is obvious; over the dark theme it is grey on grey, and the
          lit element barely separates from the dimmed one. The wide, faint
          stroke reads as a glow around the target on a dark canvas and is
          invisible on a light one, which is exactly the right behaviour from a
          single pair of paths.
        */}
        <path d={hole} fill="none" stroke="rgb(255 255 255 / 0.22)" strokeWidth="10" />
        <path d={hole} fill="none" stroke="rgb(255 255 255 / 0.95)" strokeWidth="2" />
      </svg>

      {/*
        ⚠️ ONE PLACE, EVERY STEP. The bubble used to be positioned beside its
        anchor, above or below depending on the room, which meant it moved
        around the screen from step to step and, when the anchor sat low, ended
        up off the bottom entirely.

        It is a sheet at the bottom now, in the same place every time. The page
        is locked and the target has been scrolled into the space above it, so
        both are on screen together and there is nothing to go looking for. The
        hole is what points; the card only has to be readable and reachable,
        and a thumb is already at the bottom of the phone.
      */}
      <div
        className={
          cardAtTop
            ? 'fixed inset-x-0 top-0 px-4 pt-[calc(env(safe-area-inset-top)+1rem)]'
            : 'fixed inset-x-0 bottom-0 px-4 pb-[calc(env(safe-area-inset-bottom)+1rem)]'
        }
      >
        <div className="mx-auto w-full max-w-md rounded-(--radius-panel) border border-ink-200 bg-surface p-4 shadow-[0_16px_48px_-12px_rgb(15_23_42/0.45)]">
        <p className="text-[0.6875rem] font-semibold uppercase tracking-[0.08em] text-brand-700">
          {t('progress', { index, total })}
        </p>
        <h2 className="mt-1.5 text-[0.9375rem] font-bold leading-snug text-ink-900">{title}</h2>
        <p className="mt-1.5 text-[0.8125rem] leading-relaxed text-ink-600">{body}</p>

        <div className="mt-4 flex items-center justify-between gap-3">
          <Button variant="ghost" size="sm" onClick={onSkip}>
            {t('skip')}
          </Button>
          <Button size="sm" onClick={onNext} loading={busy} trailingIcon={<ArrowRight />}>
            {t('next')}
          </Button>
        </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}
