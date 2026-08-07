'use client'

import { useState, useTransition } from 'react'

import { ArrowLeft, ArrowRight, Check, Coins, Pencil, Plus, ShieldCheck, Smartphone } from 'lucide-react'
import { useTranslations } from 'next-intl'

import { savePayoutDetails } from '@/app/[locale]/(app)/profile/payout/actions'
import { Button } from '@/components/ui/Button'
import { useRouter } from '@/i18n/navigation'
import { cn } from '@/lib/cn'

type MomoSaved = { providerId: string; providerName: string; msisdn: string; accountName: string }
type CryptoSaved = {
  coinId: string
  coinCode: string
  networkId: string | null
  networkName: string | null
  walletAddress: string
}
type Provider = { id: string; name: string; code: string }
type Coin = { id: string; code: string; name: string; requires_network: boolean }
type Network = { id: string; code: string; name: string; coin_id: string }

/** Show enough of a destination to recognise it, not enough to misuse. */
function maskTail(v: string, keep = 4) {
  if (v.length <= keep) return v
  return '••••' + v.slice(-keep)
}
function maskWallet(v: string) {
  if (v.length <= 12) return v
  return v.slice(0, 6) + '…' + v.slice(-6)
}

const inputCls =
  'h-11 w-full rounded-(--radius-input) border border-ink-200 bg-surface px-3.5 text-sm text-ink-900 ' +
  'placeholder:text-ink-400 hover:border-ink-300 focus:border-brand-600 focus:outline-none ' +
  'focus:shadow-[0_0_0_3px] focus:shadow-brand-600/12 transition-[border-color,box-shadow]'

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[0.8125rem] font-medium text-ink-700">{label}</span>
      {children}
    </label>
  )
}

export function PayoutAccountsForm({
  momoSaved,
  cryptoSaved,
  providers,
  coins,
  networks,
  returnTo,
}: {
  momoSaved: MomoSaved | null
  cryptoSaved: CryptoSaved | null
  providers: Provider[]
  coins: Coin[]
  networks: Network[]
  /** The withdrawal that sent them here, already validated against an
   *  allow-list on the server. Null when they arrived from Profile. */
  returnTo: string | null
}) {
  const t = useTranslations('payout')
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [editing, setEditing] = useState<null | 'momo' | 'crypto'>(null)
  const [error, setError] = useState<string | null>(null)

  const [momo, setMomo] = useState({
    providerId: momoSaved?.providerId ?? '',
    msisdn: momoSaved?.msisdn ?? '',
    accountName: momoSaved?.accountName ?? '',
  })
  const [crypto, setCrypto] = useState({
    coinId: cryptoSaved?.coinId ?? '',
    networkId: cryptoSaved?.networkId ?? '',
    walletAddress: cryptoSaved?.walletAddress ?? '',
  })

  const selectedCoin = coins.find((c) => c.id === crypto.coinId)
  const coinNetworks = networks.filter((n) => n.coin_id === crypto.coinId)

  const open = (which: 'momo' | 'crypto') => {
    setError(null)
    setEditing(which)
  }
  const cancel = () => {
    setError(null)
    setEditing(null)
    // Reset to saved values.
    setMomo({
      providerId: momoSaved?.providerId ?? '',
      msisdn: momoSaved?.msisdn ?? '',
      accountName: momoSaved?.accountName ?? '',
    })
    setCrypto({
      coinId: cryptoSaved?.coinId ?? '',
      networkId: cryptoSaved?.networkId ?? '',
      walletAddress: cryptoSaved?.walletAddress ?? '',
    })
  }

  const errText = (r: { errorKey?: string; message?: string }) =>
    r.message ?? (r.errorKey ? t(`errors.${r.errorKey}` as 'errors.numberRequired') : t('errors.generic'))

  const submit = (which: 'momo' | 'crypto') => {
    setError(null)
    startTransition(async () => {
      const res =
        which === 'momo'
          ? await savePayoutDetails({
              method: 'mobile_money',
              providerId: momo.providerId,
              msisdn: momo.msisdn,
              accountName: momo.accountName,
            })
          : await savePayoutDetails({
              method: 'crypto',
              coinId: crypto.coinId,
              networkId: selectedCoin?.requires_network ? crypto.networkId || null : null,
              walletAddress: crypto.walletAddress,
            })
      if (res.ok) {
        setEditing(null)
        router.refresh()
      } else {
        setError(errText(res))
      }
    })
  }

  return (
    <div className="mx-auto w-full max-w-xl px-4 py-5 sm:px-6 md:py-7">
      <header className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => router.push(returnTo ?? '/profile')}
          aria-label={t('back')}
          className="grid size-9 place-items-center rounded-full text-ink-600 transition-colors hover:bg-ink-100 hover:text-ink-900 pointer-coarse:size-10"
        >
          <ArrowLeft aria-hidden className="size-4.5" />
        </button>
        <div>
          <h1 className="text-lg font-semibold tracking-[-0.02em] text-ink-900">{t('title')}</h1>
          <p className="text-[0.8125rem] text-ink-500">{t('subtitle')}</p>
        </div>
      </header>

      <p className="mt-4 flex gap-2 rounded-(--radius-input) border border-warning-500/25 bg-warning-50 px-3.5 py-2.5 text-[0.75rem] leading-relaxed text-warning-600">
        <ShieldCheck aria-hidden className="mt-0.5 size-3.5 shrink-0" />
        {t('coolOffNote')}
      </p>

      {/*
        THE WAY BACK, when a withdrawal sent them here.

        One payout account serves both businesses, so an affiliate with no
        destination crosses the mode boundary to reach this screen. Landing in
        the other business's colours with only a Profile link out of it is how
        somebody abandons a withdrawal they had already started. The header's
        back arrow goes here too.
      */}
      {returnTo && (momoSaved || cryptoSaved) && (
        <button
          type="button"
          onClick={() => router.push(returnTo)}
          className="mt-3 flex w-full items-center justify-between gap-3 rounded-(--radius-card) border border-brand-600 bg-brand-600 px-4 py-3 text-left transition-colors hover:bg-brand-700"
        >
          <span className="text-[0.875rem] font-semibold text-white">{t('backToWithdrawal')}</span>
          <ArrowRight aria-hidden className="size-4 shrink-0 text-white/80" />
        </button>
      )}

      <div className="mt-5 flex flex-col gap-4">
        {/* ---- Mobile Money ------------------------------------------------ */}
        <MethodCard
          icon={<Smartphone />}
          tone="brand"
          title={t('momo.title')}
          isOpen={editing === 'momo'}
          saved={
            momoSaved && (
              <>
                <p className="text-[0.875rem] font-semibold text-ink-900">{momoSaved.providerName}</p>
                <p className="text-[0.8125rem] text-ink-500">
                  {maskTail(momoSaved.msisdn)} · {momoSaved.accountName}
                </p>
              </>
            )
          }
          onEdit={() => open('momo')}
          editLabel={momoSaved ? t('change') : t('add')}
        >
          {editing === 'momo' && (
            <div className="flex flex-col gap-3.5">
              <Field label={t('momo.provider')}>
                <select
                  className={inputCls}
                  value={momo.providerId}
                  onChange={(e) => setMomo((m) => ({ ...m, providerId: e.target.value }))}
                >
                  <option value="">{t('momo.providerPlaceholder')}</option>
                  {providers.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </Field>
              <Field label={t('momo.number')}>
                <input
                  type="tel"
                  inputMode="tel"
                  className={inputCls}
                  placeholder="024 123 4567"
                  value={momo.msisdn}
                  onChange={(e) => setMomo((m) => ({ ...m, msisdn: e.target.value }))}
                />
              </Field>
              <Field label={t('momo.name')}>
                <input
                  className={inputCls}
                  placeholder={t('momo.namePlaceholder')}
                  value={momo.accountName}
                  onChange={(e) => setMomo((m) => ({ ...m, accountName: e.target.value }))}
                />
              </Field>
              <p className="text-[0.75rem] text-ink-400">{t('momo.nameHint')}</p>

              <FormError error={error} />
              <FormButtons pending={pending} onCancel={cancel} onSave={() => submit('momo')} />
            </div>
          )}
        </MethodCard>

        {/* ---- Crypto ------------------------------------------------------ */}
        <MethodCard
          icon={<Coins />}
          tone="teal"
          title={t('crypto.title')}
          isOpen={editing === 'crypto'}
          saved={
            cryptoSaved && (
              <>
                <p className="text-[0.875rem] font-semibold text-ink-900">
                  {cryptoSaved.coinCode}
                  {cryptoSaved.networkName ? ` · ${cryptoSaved.networkName}` : ''}
                </p>
                <p className="font-mono text-[0.8125rem] text-ink-500">
                  {maskWallet(cryptoSaved.walletAddress)}
                </p>
              </>
            )
          }
          onEdit={() => open('crypto')}
          editLabel={cryptoSaved ? t('change') : t('add')}
        >
          {editing === 'crypto' && (
            <div className="flex flex-col gap-3.5">
              <Field label={t('crypto.coin')}>
                <select
                  className={inputCls}
                  value={crypto.coinId}
                  onChange={(e) => setCrypto((c) => ({ ...c, coinId: e.target.value, networkId: '' }))}
                >
                  <option value="">{t('crypto.coinPlaceholder')}</option>
                  {coins.map((c) => (
                    <option key={c.id} value={c.id}>{c.code} — {c.name}</option>
                  ))}
                </select>
              </Field>

              {selectedCoin?.requires_network && (
                <Field label={t('crypto.network')}>
                  <select
                    className={inputCls}
                    value={crypto.networkId}
                    onChange={(e) => setCrypto((c) => ({ ...c, networkId: e.target.value }))}
                  >
                    <option value="">{t('crypto.networkPlaceholder')}</option>
                    {coinNetworks.map((n) => (
                      <option key={n.id} value={n.id}>{n.name}</option>
                    ))}
                  </select>
                  <span className="mt-1 text-[0.75rem] text-warning-600">{t('crypto.networkWarn')}</span>
                </Field>
              )}

              <Field label={t('crypto.wallet')}>
                <input
                  className={cn(inputCls, 'font-mono')}
                  placeholder={t('crypto.walletPlaceholder')}
                  value={crypto.walletAddress}
                  onChange={(e) => setCrypto((c) => ({ ...c, walletAddress: e.target.value }))}
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                />
              </Field>

              <FormError error={error} />
              <FormButtons pending={pending} onCancel={cancel} onSave={() => submit('crypto')} />
            </div>
          )}
        </MethodCard>
      </div>
    </div>
  )
}

function MethodCard({
  icon,
  tone,
  title,
  saved,
  isOpen,
  onEdit,
  editLabel,
  children,
}: {
  icon: React.ReactNode
  tone: 'brand' | 'teal'
  title: string
  saved: React.ReactNode
  isOpen: boolean
  onEdit: () => void
  editLabel: string
  children: React.ReactNode
}) {
  return (
    <section className="overflow-hidden rounded-(--radius-card) border border-ink-200 bg-surface shadow-[0_1px_2px_0_rgb(15_23_42/0.04)]">
      <div className="flex items-center gap-3 px-4 py-3.5">
        <span
          className={cn(
            'grid size-9 shrink-0 place-items-center rounded-full [&>svg]:size-4.5',
            tone === 'teal' ? 'bg-teal-50 text-teal-600' : 'bg-brand-50 text-brand-600',
          )}
        >
          {icon}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[0.8125rem] font-medium text-ink-500">{title}</p>
          {!isOpen && saved && <div className="mt-0.5">{saved}</div>}
        </div>
        {!isOpen && (
          <Button variant="secondary" size="sm" leadingIcon={saved ? <Pencil /> : <Plus />} onClick={onEdit}>
            {editLabel}
          </Button>
        )}
      </div>
      {isOpen && <div className="border-t border-ink-100 px-4 py-4">{children}</div>}
    </section>
  )
}

function FormError({ error }: { error: string | null }) {
  if (!error) return null
  return (
    <p role="alert" className="rounded-(--radius-input) border border-danger-500/25 bg-danger-50 px-3 py-2 text-[0.8125rem] text-danger-700">
      {error}
    </p>
  )
}

function FormButtons({
  pending,
  onCancel,
  onSave,
}: {
  pending: boolean
  onCancel: () => void
  onSave: () => void
}) {
  const t = useTranslations('payout')
  return (
    <div className="flex gap-3">
      <Button variant="secondary" size="md" className="flex-1" onClick={onCancel} disabled={pending}>
        {t('cancel')}
      </Button>
      <Button size="md" className="flex-1" loading={pending} leadingIcon={<Check />} onClick={onSave}>
        {t('save')}
      </Button>
    </div>
  )
}
