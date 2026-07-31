'use client'

import { useMemo, useState, useTransition } from 'react'

import { AlertTriangle, Check } from 'lucide-react'
import { useFormatter, useTranslations } from 'next-intl'

import { saveGamePrizes, setTierPlays, type PrizeInput } from '@/app/[locale]/admin/(super)/games/actions'
import { Button } from '@/components/ui/Button'
import type { AdminPrize, GameStats, TierPlays } from '@/lib/admin/data/games'
import { cn } from '@/lib/cn'
import type { GameKind } from '@/lib/games/types'

/**
 * The prize table editor — the whole configuration surface for a game.
 *
 * THE NUMBER THAT MATTERS IS RTP, and it is recomputed on every keystroke
 * rather than on save. An operator editing weights without seeing what a play
 * costs is pricing a game by feel, and the feedback has to arrive while they
 * are still deciding. The percentages beside each row are the same
 * calculation the database does; they are shown here so the operator can see
 * the shape of the table without saving to find out.
 *
 * Weights are integers and need not total anything. That is the point of
 * weights: adding a thirteenth outcome does not mean re-doing twelve others.
 */
export function GamePrizeEditor({
  game,
  prizes,
  stats,
  tiers,
}: {
  game: GameKind
  prizes: AdminPrize[]
  stats: GameStats | null
  tiers: TierPlays[]
}) {
  const t = useTranslations('admin.games')
  const format = useFormatter()

  const [rows, setRows] = useState<AdminPrize[]>(prizes)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [pending, startTransition] = useTransition()

  const [plays, setPlays] = useState<TierPlays[]>(tiers)
  const [playsSaved, setPlaysSaved] = useState<string | null>(null)

  /* Live economics. `weight === 0` means "configured but never drawn", so it
     contributes to neither the odds nor the cost. */
  const economics = useMemo(() => {
    const active = rows.filter((r) => r.isActive && r.weight > 0)
    const total = active.reduce((sum, r) => sum + r.weight, 0)
    const rtp = total === 0 ? 0 : active.reduce((sum, r) => sum + r.weight * r.points, 0) / total
    const extra =
      total === 0 ? 0 : active.reduce((sum, r) => sum + r.weight * r.extraPlays, 0) / total
    return { total, rtp, extra }
  }, [rows])

  const update = (slot: number, patch: Partial<AdminPrize>) => {
    setSaved(false)
    setRows((current) => current.map((r) => (r.slot === slot ? { ...r, ...patch } : r)))
  }

  const save = () => {
    setError(null)
    setSaved(false)

    const invalid = rows.find((r) => r.points <= 0 && r.extraPlays <= 0)
    if (invalid) {
      // Mirrors the database constraint so the operator hears it here first.
      setError(t('errors.mustPay', { slot: invalid.slot }))
      return
    }

    const payload: PrizeInput[] = rows.map((r) => ({
      id: r.id,
      slot: r.slot,
      label: r.label.trim(),
      points: Math.max(0, Math.trunc(r.points)),
      extra_plays: Math.max(0, Math.trunc(r.extraPlays)),
      weight: Math.max(0, Math.trunc(r.weight)),
      colour: r.colour,
      daily_cap: Math.max(0, Math.trunc(r.dailyCap)),
      weekly_cap: Math.max(0, Math.trunc(r.weeklyCap)),
      is_active: r.isActive,
    }))

    startTransition(async () => {
      const result = await saveGamePrizes(game, payload)
      if (!result.ok) setError(result.message)
      else setSaved(true)
    })
  }

  const savePlays = (tier: TierPlays, value: number) => {
    setPlays((current) =>
      current.map((p) => (p.id === tier.id ? { ...p, weeklyGamePlays: value } : p)),
    )
    startTransition(async () => {
      const result = await setTierPlays(tier.id, value)
      if (!result.ok) setError(result.message)
      else setPlaysSaved(tier.id)
    })
  }

  return (
    <div className="space-y-6">
      {/* ---- Economics ---------------------------------------------------- */}
      <section className="grid gap-3 sm:grid-cols-3">
        <Figure
          label={t('stats.expectedRtp')}
          value={format.number(Math.round(economics.rtp))}
          hint={t('stats.perPlay')}
          tone="brand"
        />
        <Figure
          label={t('stats.actualRtp')}
          value={stats ? format.number(Math.round(stats.actualRtp)) : '—'}
          hint={t('stats.last30', { plays: stats?.playsPeriod ?? 0 })}
          tone={
            stats && stats.playsPeriod > 30 && stats.actualRtp > economics.rtp * 1.5
              ? 'warn'
              : 'plain'
          }
        />
        <Figure
          label={t('stats.totalWeight')}
          value={format.number(economics.total)}
          hint={t('stats.weightHint')}
          tone="plain"
        />
      </section>

      {error && (
        <p
          role="alert"
          className="flex items-start gap-2 rounded-(--radius-input) border border-danger-500/25 bg-danger-50 px-3.5 py-2.5 text-[0.8125rem] text-danger-700"
        >
          <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0" />
          {error}
        </p>
      )}

      {/* ---- The twelve outcomes ------------------------------------------ */}
      <section className="overflow-x-auto rounded-(--radius-panel) border border-ink-200 bg-surface">
        <table className="w-full min-w-[54rem] text-left text-[0.8125rem]">
          <thead className="border-b border-ink-200 bg-ink-50 text-[0.6875rem] uppercase tracking-wide text-ink-500">
            <tr>
              <th scope="col" className="px-3 py-2.5 font-semibold">{t('col.slot')}</th>
              <th scope="col" className="px-3 py-2.5 font-semibold">{t('col.label')}</th>
              <th scope="col" className="px-3 py-2.5 font-semibold">{t('col.points')}</th>
              <th scope="col" className="px-3 py-2.5 font-semibold">{t('col.extraPlays')}</th>
              <th scope="col" className="px-3 py-2.5 font-semibold">{t('col.weight')}</th>
              <th scope="col" className="px-3 py-2.5 font-semibold">{t('col.chance')}</th>
              <th scope="col" className="px-3 py-2.5 font-semibold">{t('col.dailyCap')}</th>
              <th scope="col" className="px-3 py-2.5 font-semibold">{t('col.weeklyCap')}</th>
              <th scope="col" className="px-3 py-2.5 font-semibold">{t('col.colour')}</th>
              <th scope="col" className="px-3 py-2.5 font-semibold">{t('col.won')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const chance =
                economics.total === 0 || !row.isActive || row.weight === 0
                  ? 0
                  : (row.weight * 100) / economics.total
              return (
                <tr key={row.slot} className="border-b border-ink-100 last:border-b-0">
                  <td className="px-3 py-2 font-bold tabular-nums text-ink-400">{row.slot}</td>
                  <td className="px-3 py-2">
                    <input
                      aria-label={t('col.label')}
                      value={row.label}
                      onChange={(e) => update(row.slot, { label: e.target.value })}
                      className="w-40 rounded-(--radius-input) border border-ink-200 bg-canvas px-2 py-1.5 text-ink-900"
                    />
                  </td>
                  <Num value={row.points} onChange={(v) => update(row.slot, { points: v })} label={t('col.points')} />
                  <Num value={row.extraPlays} onChange={(v) => update(row.slot, { extraPlays: v })} label={t('col.extraPlays')} width="w-16" />
                  <Num value={row.weight} onChange={(v) => update(row.slot, { weight: v })} label={t('col.weight')} />
                  <td className="px-3 py-2 tabular-nums font-semibold text-ink-700">
                    {chance.toFixed(2)}%
                  </td>
                  <Num value={row.dailyCap} onChange={(v) => update(row.slot, { dailyCap: v })} label={t('col.dailyCap')} width="w-16" />
                  <Num value={row.weeklyCap} onChange={(v) => update(row.slot, { weeklyCap: v })} label={t('col.weeklyCap')} width="w-16" />
                  <td className="px-3 py-2">
                    <input
                      type="color"
                      aria-label={t('col.colour')}
                      value={row.colour}
                      onChange={(e) => update(row.slot, { colour: e.target.value })}
                      className="h-8 w-12 cursor-pointer rounded border border-ink-200 bg-canvas"
                    />
                  </td>
                  <td className="px-3 py-2 tabular-nums text-ink-500">
                    {row.wonToday} / {row.wonThisWeek}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </section>

      <div className="flex items-center gap-3">
        <Button onClick={save} loading={pending}>
          {t('save')}
        </Button>
        {saved && (
          <span className="flex items-center gap-1.5 text-[0.8125rem] font-medium text-success-600">
            <Check aria-hidden className="size-4" />
            {t('saved')}
          </span>
        )}
      </div>

      {/* ---- Plays per plan ----------------------------------------------- */}
      <section className="rounded-(--radius-panel) border border-ink-200 bg-surface p-4">
        <h2 className="text-[0.9375rem] font-semibold text-ink-900">{t('plans.title')}</h2>
        <p className="mt-1 text-[0.8125rem] leading-relaxed text-ink-500">{t('plans.hint')}</p>

        <ul className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {plays.map((tier) => (
            <li
              key={tier.id}
              className="flex items-center justify-between gap-3 rounded-(--radius-card) border border-ink-200 px-3 py-2.5"
            >
              <span className="min-w-0">
                <span className="block truncate text-[0.875rem] font-semibold text-ink-900">
                  {tier.name}
                </span>
                <span className="block text-[0.75rem] text-ink-500">
                  {tier.isDefault
                    ? t('plans.free')
                    : format.number(tier.priceMinor / 100, {
                        style: 'currency',
                        currency: 'GHS',
                        maximumFractionDigits: 0,
                      })}
                </span>
              </span>
              <span className="flex items-center gap-1.5">
                <input
                  type="number"
                  min={0}
                  max={100}
                  aria-label={t('plans.playsFor', { plan: tier.name })}
                  value={tier.weeklyGamePlays}
                  onChange={(e) => savePlays(tier, Math.max(0, Number(e.target.value) || 0))}
                  className="w-16 rounded-(--radius-input) border border-ink-200 bg-canvas px-2 py-1.5 text-center tabular-nums text-ink-900"
                />
                {playsSaved === tier.id && (
                  <Check aria-hidden className="size-4 text-success-600" />
                )}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}

function Num({
  value,
  onChange,
  label,
  width = 'w-24',
}: {
  value: number
  onChange: (value: number) => void
  label: string
  width?: string
}) {
  return (
    <td className="px-3 py-2">
      <input
        type="number"
        min={0}
        aria-label={label}
        value={value}
        onChange={(e) => onChange(Math.max(0, Number(e.target.value) || 0))}
        className={cn(
          width,
          'rounded-(--radius-input) border border-ink-200 bg-canvas px-2 py-1.5 text-right tabular-nums text-ink-900',
        )}
      />
    </td>
  )
}

function Figure({
  label,
  value,
  hint,
  tone,
}: {
  label: string
  value: string
  hint: string
  tone: 'brand' | 'warn' | 'plain'
}) {
  return (
    <div
      className={cn(
        'rounded-(--radius-panel) border px-4 py-3',
        tone === 'brand' && 'border-brand-500/25 bg-brand-50',
        tone === 'warn' && 'border-warning-500/30 bg-warning-50',
        tone === 'plain' && 'border-ink-200 bg-surface',
      )}
    >
      <p className="text-[0.6875rem] font-semibold uppercase tracking-wide text-ink-500">{label}</p>
      <p
        className={cn(
          'mt-0.5 text-[1.375rem] font-bold tabular-nums',
          tone === 'brand' ? 'text-brand-700' : tone === 'warn' ? 'text-warning-600' : 'text-ink-900',
        )}
      >
        {value}
      </p>
      <p className="mt-0.5 text-[0.75rem] text-ink-500">{hint}</p>
    </div>
  )
}
