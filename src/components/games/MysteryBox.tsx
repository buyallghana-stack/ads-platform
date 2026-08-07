'use client'

import { useState, useTransition } from 'react'

import { useTranslations } from 'next-intl'

import { PrizeReveal } from '@/components/games/PrizeReveal'
import { cn } from '@/lib/cn'
import { GAME_SKINS, type SkinName } from '@/lib/games/skins'
import type { GameFace, GameStatus, PlayResult } from '@/lib/games/types'

/**
 * Mystery box — twelve boxes, pick one.
 *
 * THE BOX YOU TAP IS NOT WHAT DECIDES YOUR PRIZE, and it is worth being clear
 * about why that is honest rather than a trick. The prize is drawn by the
 * server from the weighted table the instant you tap; the box you chose is
 * where it is revealed. Every box is identical before the draw, so picking
 * box 3 over box 7 changes nothing and never could — which is exactly what a
 * mystery box is. The alternative, fixing contents to boxes in advance, would
 * mean the odds depend on where a player's thumb lands.
 *
 * The other eleven boxes stay CLOSED afterwards. Showing what was "in" them
 * would be inventing a fact — they never held anything.
 *
 * FOR THE SAME REASON THE BOXES ARE NOT COLOURED BY PRIZE. The first version
 * tinted box N with prize N's colour, which taught a player that the gold box
 * in the corner is the jackpot — a pattern that is not true and that they
 * would reasonably feel cheated by. These twelve hues are decorative and
 * fixed; they carry no information, because there is none to carry.
 */

/* Decorative only. Deliberately NOT the prize colours. */
const BOX_HUES = [
  '#38bdf8', '#34d399', '#a78bfa', '#f472b6',
  '#fbbf24', '#22d3ee', '#fb923c', '#4ade80',
  '#c084fc', '#60a5fa', '#f43f5e', '#eab308',
]

export function MysteryBox({
  faces,
  status,
  skin: skinName = 'ads',
}: {
  faces: GameFace[]
  status: GameStatus
  /** A NAME, not a skin: functions cannot cross the server boundary. Defaults
   *  to the points games, so the ads side reads exactly as before. */
  skin?: SkinName
}) {
  const skin = GAME_SKINS[skinName]
  const t = useTranslations('games')

  const [remaining, setRemaining] = useState(status.remaining)
  const [picked, setPicked] = useState<number | null>(null)
  const [result, setResult] = useState<PlayResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const won = result?.ok ? result : null

  const pick = (index: number) => {
    if (pending || won || remaining <= 0) return
    setPicked(index)
    setError(null)

    startTransition(async () => {
      const outcome = await skin.play('mystery_box')
      if (!outcome.ok) {
        setPicked(null)
        setError(t(`errors.${outcome.reason}`))
        return
      }
      setResult(outcome)
      setRemaining(outcome.remaining)
    })
  }

  const again = () => {
    setResult(null)
    setPicked(null)
    setError(null)
  }

  /* The colour of the prize that was drawn, for the reveal. Falls back to the
     tapped box's colour if the drawn slot is not on the visible board — which
     can happen legitimately, because an operator may deactivate a prize
     between the page loading and the tap. */
  const wonColour =
    faces.find((f) => f.slot === won?.slot)?.colour ??
    (picked !== null ? faces[picked]?.colour : undefined) ??
    '#2563eb'

  if (won) {
    return (
      <PrizeReveal
        label={won.label}
        value={won.value}
        extraPlays={won.extraPlays}
        remaining={remaining}
        colour={wonColour}
        skin={skin}
        onAgain={again}
      />
    )
  }

  return (
    <div>
      <p className="text-center text-[0.9375rem] text-ink-600">
        {remaining > 0 ? t('box.prompt') : t('box.noPlays')}
      </p>

      {error && (
        <p
          role="alert"
          className="mt-4 rounded-(--radius-input) border border-danger-500/25 bg-danger-50 px-3.5 py-2.5 text-center text-[0.8125rem] text-danger-700"
        >
          {error}
        </p>
      )}

      <div className="mt-6 grid grid-cols-3 gap-3 sm:grid-cols-4 sm:gap-4">
        {faces.map((face, index) => {
          const isPicked = picked === index
          const dimmed = picked !== null && !isPicked
          return (
            <button
              key={face.slot}
              type="button"
              onClick={() => pick(index)}
              disabled={pending || remaining <= 0}
              aria-label={t('box.boxNumber', { number: index + 1 })}
              className={cn(
                'relative aspect-square rounded-2xl border-2 transition-all duration-300',
                'grid place-items-center text-[1.75rem] shadow-sm',
                'disabled:cursor-not-allowed',
                isPicked && 'scale-105 animate-pulse',
                dimmed && 'scale-95 opacity-40',
                remaining <= 0 && 'opacity-50',
                !dimmed && !isPicked && 'hover:-translate-y-0.5 hover:shadow-md active:translate-y-0',
              )}
              style={{
                backgroundColor: `${BOX_HUES[index % BOX_HUES.length]}22`,
                borderColor: BOX_HUES[index % BOX_HUES.length],
              }}
            >
              <span aria-hidden>🎁</span>
              <span
                className="absolute bottom-1 right-1.5 text-[0.6875rem] font-bold tabular-nums"
                style={{ color: BOX_HUES[index % BOX_HUES.length] }}
              >
                {index + 1}
              </span>
            </button>
          )
        })}
      </div>

      <p className="mt-5 text-center text-[0.8125rem] text-ink-500">
        {t('playsLeft', { count: remaining })}
      </p>
    </div>
  )
}
