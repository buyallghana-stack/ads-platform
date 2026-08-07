'use client'

import { useState, useTransition } from 'react'

import { AlertTriangle, Gift, Loader2, RotateCw, Sparkles } from 'lucide-react'
import { useTranslations } from 'next-intl'

import {
  playAffiliateGame,
  type PlayOutcome,
} from '@/app/[locale]/(affiliate)/market/games/actions'
import type { AffiliateGameStatus } from '@/lib/market/play'
import { cedis } from '@/lib/market/money'
import { cn } from '@/lib/cn'

/**
 * The two affiliate games and the plays you have left.
 *
 * ── ONE POOL ACROSS BOTH GAMES ──
 *
 * Same choice as the points games: the allowance is stated once, at the top,
 * because showing it on each card would imply two separate allowances. Three a
 * week on Professional, one on Beginner, both set by the operator.
 *
 * ── THE ANIMATION IS COSMETIC AND SAYS SO ──
 *
 * The outcome is committed in the database before the first frame moves. If
 * somebody closes the tab mid-reveal they lose the animation and nothing else:
 * the money is already in their commission balance. That is why the reveal is
 * a state change here rather than something the server waits on.
 *
 * ⚠️ The prize is never predicted client-side. Only what came back is shown.
 */
export function AffiliateGames({ status }: { status: AffiliateGameStatus }) {
  const t = useTranslations('affiliate.games')

  const [left, setLeft] = useState(status.left)
  const [result, setResult] = useState<Extract<PlayOutcome, { ok: true }> | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [playing, setPlaying] = useState<'mystery_box' | 'spin_wheel' | null>(null)
  const [pending, startTransition] = useTransition()

  const play = (game: 'mystery_box' | 'spin_wheel') => {
    setPlaying(game)
    setResult(null)
    setError(null)
    startTransition(async () => {
      const outcome = await playAffiliateGame({ game })
      if (outcome.ok) {
        setResult(outcome)
        setLeft(outcome.left)
      } else {
        setError(outcome.message)
      }
      setPlaying(null)
    })
  }

  if (!status.enabled) {
    return (
      <section className="rounded-(--radius-panel) border border-ink-200 bg-surface p-6 text-center">
        <span
          aria-hidden
          className="mx-auto grid size-12 place-items-center rounded-full bg-ink-100 text-ink-400"
        >
          <Gift className="size-6" />
        </span>
        <h2 className="mt-3 text-[1rem] font-semibold text-ink-900">{t('closed.title')}</h2>
        <p className="mx-auto mt-1.5 max-w-sm text-[0.8125rem] leading-snug text-ink-500">
          {t('closed.body')}
        </p>
      </section>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      {/* The allowance, stated once. */}
      <section className="flex items-center justify-between gap-4 rounded-(--radius-panel) border border-ink-200 bg-surface px-4 py-3.5">
        <div className="min-w-0">
          <p className="text-[0.8125rem] font-semibold text-ink-900">{t('playsLeft', { n: left })}</p>
          <p className="mt-0.5 text-[0.75rem] leading-snug text-ink-500">
            {status.allowance === 0
              ? t('noProgramme')
              : t('allowance', { n: status.allowance })}
          </p>
        </div>
        <span
          aria-hidden
          className="grid size-10 shrink-0 place-items-center rounded-full bg-brand-600/12 text-brand-700"
        >
          <Sparkles className="size-5" />
        </span>
      </section>

      {error && (
        <p
          role="alert"
          className="flex items-start gap-2 rounded-(--radius-card) border border-danger-500/30 bg-danger-50 px-4 py-3 text-[0.8125rem] text-ink-900"
        >
          <AlertTriangle aria-hidden className="mt-px size-4 shrink-0 text-danger-600" />
          {error}
        </p>
      )}

      {result && (
        <section className="rounded-(--radius-panel) border border-success-500/30 bg-success-50 p-6 text-center">
          <p className="text-[0.75rem] font-semibold tracking-[0.06em] text-success-600 uppercase">
            {t('youWon')}
          </p>
          <p className="mt-2 text-[1.75rem] font-bold leading-none text-ink-900">
            {result.amountMinor > 0 ? cedis(result.amountMinor) : result.label}
          </p>
          <p className="mt-2 text-[0.8125rem] text-ink-600">
            {result.extraPlays > 0
              ? t('wonExtra', { n: result.extraPlays })
              : result.amountMinor > 0
                ? t('inBalance')
                : t('betterLuck')}
          </p>
        </section>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <GameCard
          title={t('box.title')}
          body={t('box.body')}
          cta={t('play')}
          icon={<Gift className="size-6" />}
          from="#7c3aed"
          to="#c026d3"
          busy={playing === 'mystery_box' && pending}
          disabled={pending || left <= 0}
          onPlay={() => play('mystery_box')}
        />
        <GameCard
          title={t('wheel.title')}
          body={t('wheel.body')}
          cta={t('play')}
          icon={<RotateCw className="size-6" />}
          from="#0ea5e9"
          to="#22c55e"
          busy={playing === 'spin_wheel' && pending}
          disabled={pending || left <= 0}
          onPlay={() => play('spin_wheel')}
        />
      </div>

      {left <= 0 && (
        <p className="text-center text-[0.75rem] text-ink-500">{t('comeBack')}</p>
      )}
    </div>
  )
}

function GameCard({
  title,
  body,
  cta,
  icon,
  from,
  to,
  busy,
  disabled,
  onPlay,
}: {
  title: string
  body: string
  cta: string
  icon: React.ReactNode
  from: string
  to: string
  busy: boolean
  disabled: boolean
  onPlay: () => void
}) {
  return (
    <article className="overflow-hidden rounded-(--radius-panel) border border-ink-200 bg-surface">
      <div
        className="flex h-24 items-center justify-center text-white"
        style={{ background: `linear-gradient(135deg, ${from}, ${to})` }}
      >
        <span aria-hidden>{icon}</span>
      </div>
      <div className="p-4">
        <p className="text-[0.9375rem] font-semibold text-ink-900">{title}</p>
        <p className="mt-1 text-[0.8125rem] leading-snug text-ink-500">{body}</p>
        <button
          type="button"
          disabled={disabled}
          onClick={onPlay}
          className={cn(
            'mt-3 inline-flex w-full items-center justify-center gap-2 rounded-(--radius-input) px-4 py-2.5',
            'text-[0.875rem] font-semibold transition-colors',
            disabled
              ? 'cursor-not-allowed bg-ink-100 text-ink-400'
              : 'bg-brand-600 text-white hover:bg-brand-500',
          )}
        >
          {busy && <Loader2 aria-hidden className="size-4 animate-spin" />}
          {cta}
        </button>
      </div>
    </article>
  )
}
