'use client'

import { useRef, useState, useTransition } from 'react'

import { useTranslations } from 'next-intl'

import { PrizeReveal } from '@/components/games/PrizeReveal'
import { Button } from '@/components/ui/Button'
import { GAME_SKINS, type SkinName } from '@/lib/games/skins'
import { cn } from '@/lib/cn'
import type { GameFace, GameStatus, PlayResult } from '@/lib/games/types'

/**
 * Spin the wheel.
 *
 * UNLIKE THE MYSTERY BOX, the landing slot matters here. The wedges are
 * labelled and visible, so the wheel MUST stop on the one the server drew or
 * the screen contradicts the prize. `play_game` returns that slot; everything
 * below is arithmetic to point the wheel at it.
 *
 * The spin is cosmetic in the strict sense — the outcome is already committed
 * to the database before the first frame — so closing the tab mid-spin loses
 * the animation and nothing else. The points are already credited.
 *
 * ROTATION MATH. Twelve wedges of 30 degrees, drawn from the top going
 * clockwise, so wedge n (1-indexed) spans (n-1)*30 to n*30 with its centre at
 * (n-1)*30 + 15. The pointer sits at the top. To bring wedge n under it the
 * wheel turns to -(centre), plus whole extra turns for the drama. The final
 * angle ALWAYS increases so the wheel never appears to spin backwards between
 * plays.
 */
export function SpinWheel({
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
  const [angle, setAngle] = useState(0)
  const [spinning, setSpinning] = useState(false)
  const [result, setResult] = useState<PlayResult | null>(null)
  const [revealed, setRevealed] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const timer = useRef<number | null>(null)

  const count = faces.length || 12
  const wedge = 360 / count

  const won = result?.ok && revealed ? result : null

  const spin = () => {
    if (spinning || pending || remaining <= 0) return
    setError(null)

    startTransition(async () => {
      const outcome = await skin.play('spin_wheel')
      if (!outcome.ok) {
        setError(t(`errors.${outcome.reason}`))
        return
      }

      const index = Math.max(
        0,
        faces.findIndex((f) => f.slot === outcome.slot),
      )
      const centre = index * wedge + wedge / 2
      /* Five full turns plus whatever is needed to bring the winning centre
         to the top, measured from where the wheel already is so it always
         turns forwards. */
      const target = angle + 360 * 5 + ((360 - (centre % 360)) - (angle % 360) + 360) % 360

      setSpinning(true)
      setResult(outcome)
      setRemaining(outcome.remaining)
      setAngle(target)

      timer.current = window.setTimeout(() => {
        setSpinning(false)
        setRevealed(true)
      }, 4200)
    })
  }

  const again = () => {
    if (timer.current) window.clearTimeout(timer.current)
    setResult(null)
    setRevealed(false)
    setError(null)
  }

  if (won) {
    return (
      <PrizeReveal
        label={won.label}
        value={won.value}
        extraPlays={won.extraPlays}
        remaining={remaining}
        colour={faces.find((f) => f.slot === won.slot)?.colour ?? '#2563eb'}
        skin={skin}
        onAgain={again}
      />
    )
  }

  return (
    <div className="flex flex-col items-center">
      <p className="text-center text-[0.9375rem] text-ink-600">
        {remaining > 0 ? t('wheel.prompt') : t('wheel.noPlays')}
      </p>

      {error && (
        <p
          role="alert"
          className="mt-4 w-full rounded-(--radius-input) border border-danger-500/25 bg-danger-50 px-3.5 py-2.5 text-center text-[0.8125rem] text-danger-700"
        >
          {error}
        </p>
      )}

      <div className="relative mt-6 w-full max-w-[20rem]">
        {/* Pointer. Sits above the wheel and does not rotate. */}
        <div
          aria-hidden
          className="absolute left-1/2 top-[-0.35rem] z-10 h-0 w-0 -translate-x-1/2"
          style={{
            borderLeft: '0.7rem solid transparent',
            borderRight: '0.7rem solid transparent',
            borderTop: '1.2rem solid #0f172a',
            filter: 'drop-shadow(0 1px 2px rgb(0 0 0 / 0.35))',
          }}
        />

        <svg
          viewBox="0 0 200 200"
          className="w-full rounded-full shadow-xl"
          style={{
            transform: `rotate(${angle}deg)`,
            transition: spinning ? 'transform 4s cubic-bezier(0.15, 0.85, 0.2, 1)' : 'none',
          }}
          role="img"
          aria-label={t('wheel.label')}
        >
          {faces.map((face, index) => {
            const start = (index * wedge - 90) * (Math.PI / 180)
            const end = ((index + 1) * wedge - 90) * (Math.PI / 180)
            const x1 = 100 + 98 * Math.cos(start)
            const y1 = 100 + 98 * Math.sin(start)
            const x2 = 100 + 98 * Math.cos(end)
            const y2 = 100 + 98 * Math.sin(end)
            const mid = (index * wedge + wedge / 2 - 90) * (Math.PI / 180)

            return (
              <g key={face.slot}>
                <path
                  d={`M100,100 L${x1},${y1} A98,98 0 0,1 ${x2},${y2} Z`}
                  fill={face.colour}
                  stroke="#ffffff"
                  strokeWidth="1"
                />
                <text
                  x={100 + 62 * Math.cos(mid)}
                  y={100 + 62 * Math.sin(mid)}
                  fill="#ffffff"
                  fontSize="9"
                  fontWeight="700"
                  textAnchor="middle"
                  dominantBaseline="middle"
                  transform={`rotate(${index * wedge + wedge / 2} ${100 + 62 * Math.cos(mid)} ${100 + 62 * Math.sin(mid)})`}
                  style={{ paintOrder: 'stroke', stroke: 'rgb(0 0 0 / 0.25)', strokeWidth: 2 }}
                >
                  {skin.formatWedge(face.value)}
                </text>
              </g>
            )
          })}
          <circle cx="100" cy="100" r="16" fill="#ffffff" stroke="#e2e8f0" strokeWidth="2" />
        </svg>
      </div>

      <Button
        size="lg"
        onClick={spin}
        loading={pending}
        disabled={spinning || remaining <= 0}
        className={cn('mt-7 min-w-[12rem]')}
      >
        {spinning ? t('wheel.spinning') : t('wheel.spin')}
      </Button>

      <p className="mt-4 text-center text-[0.8125rem] text-ink-500">
        {t('playsLeft', { count: remaining })}
      </p>
    </div>
  )
}
