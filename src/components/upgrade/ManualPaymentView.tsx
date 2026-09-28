'use client'

import { useState, useTransition } from 'react'

import { Check, CircleAlert, CircleCheck, Clock, Copy, ImageUp, Smartphone } from 'lucide-react'
import { useFormatter, useTranslations } from 'next-intl'

import { cancelManualPayment, claimManualPayment } from '@/app/[locale]/(app)/upgrade/actions'
import { Button } from '@/components/ui/Button'
import { TextField } from '@/components/ui/TextField'
import { Link, useRouter } from '@/i18n/navigation'
import { compressFittedImage } from '@/lib/images/compress-square'

type State = 'send' | 'waiting' | 'confirmed' | 'closed'

/**
 * Manual mobile money, the buyer's side: exactly what to send and where, laid
 * out like the crypto payout details (every value copyable), then "I have
 * sent it". The operator confirms from Admin > Payments.
 */
export function ManualPaymentView(props: {
  paymentId: string
  planName: string
  amountMinor: number
  currency: string
  reference: string
  state: State
  number: string
  accountName: string
  network: string
}) {
  const t = useTranslations('upgrade.manual')
  const format = useFormatter()
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [senderPhone, setSenderPhone] = useState('')
  const [proof, setProof] = useState<File | null>(null)
  const [preparing, setPreparing] = useState(false)

  const amount = format.number(props.amountMinor / 100, {
    style: 'currency',
    currency: props.currency,
    minimumFractionDigits: props.amountMinor % 100 ? 2 : 0,
  })

  if (props.state !== 'send') {
    const tone = {
      waiting: { Icon: Clock, chip: 'bg-warning-50 text-warning-600' },
      confirmed: { Icon: CircleCheck, chip: 'bg-success-50 text-success-600' },
      closed: { Icon: CircleAlert, chip: 'bg-danger-50 text-danger-600' },
    }[props.state]
    return (
      <div className="mx-auto w-full max-w-md px-4 py-5 sm:px-6 md:py-7">
        <div className="animate-rise mt-10 flex flex-col items-center text-center">
          <span className={`grid size-16 place-items-center rounded-full ${tone.chip}`}>
            <tone.Icon aria-hidden className="size-8" />
          </span>
          <h1 className="mt-4 text-[1.25rem] font-semibold tracking-[-0.02em] text-ink-900">
            {t(`${props.state}.title`)}
          </h1>
          <p className="mt-1.5 max-w-[36ch] text-[0.8125rem] leading-relaxed text-ink-500">
            {t(`${props.state}.body`, { plan: props.planName, amount, reference: props.reference })}
          </p>
          <Link href="/upgrade" className="mt-7 w-full">
            <Button size="lg" fullWidth>
              {t('backToPlans')}
            </Button>
          </Link>
        </div>
      </div>
    )
  }

  /*
    Shrunk HERE, before a byte leaves the phone: a raw screenshot is 1 to 4 MB,
    which is slow on mobile data and above the server's 1 MB limit. 1400px on
    the long edge keeps a receipt's text readable; ~300 KB is plenty.
  */
  const pickProof = async (file: File | undefined) => {
    setError(null)
    if (!file) return setProof(null)
    setPreparing(true)
    const small = await compressFittedImage(file, { maxEdgePx: 1400, maxBytes: 300_000, name: 'payment-proof' })
    setPreparing(false)
    if (small.size > 950_000) {
      setProof(null)
      return setError(t('proofTooLarge'))
    }
    setProof(small)
  }

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    if (!proof) return setError(t('proofRequired'))
    const form = new FormData()
    form.set('paymentId', props.paymentId)
    form.set('senderPhone', senderPhone)
    form.set('proof', proof)
    startTransition(async () => {
      const res = await claimManualPayment(form)
      if (!res.ok) return setError(res.message)
      router.refresh()
    })
  }

  const cancel = () => {
    setError(null)
    startTransition(async () => {
      const res = await cancelManualPayment(props.paymentId)
      if (!res.ok) return setError(res.message)
      router.push('/upgrade')
    })
  }

  return (
    <div className="mx-auto w-full max-w-md px-4 py-5 sm:px-6 md:py-7">
      <div className="flex items-center gap-3">
        <span className="grid size-10 place-items-center rounded-full bg-brand-50 text-brand-600">
          <Smartphone aria-hidden className="size-5" />
        </span>
        <div>
          <h1 className="text-[1.125rem] font-semibold tracking-[-0.02em] text-ink-900">{t('title')}</h1>
          <p className="text-[0.8125rem] text-ink-500">{t('subtitle', { plan: props.planName })}</p>
        </div>
      </div>

      <div className="mt-5 rounded-(--radius-card) border border-ink-200 bg-surface p-4">
        <p className="text-[0.75rem] font-semibold tracking-[0.04em] text-ink-500 uppercase">{t('sendExactly')}</p>
        <div className="mt-1 flex items-center justify-between gap-3">
          <p className="text-[1.75rem] font-semibold tracking-[-0.02em] text-ink-900 tabular-nums">{amount}</p>
          <CopyButton value={(props.amountMinor / 100).toFixed(props.amountMinor % 100 ? 2 : 0)} label={t('copy')} copied={t('copied')} />
        </div>

        <dl className="mt-3 divide-y divide-ink-100 border-t border-ink-100">
          <Row label={t('number')} value={props.number} copy={{ label: t('copy'), copied: t('copied') }} mono />
          {props.accountName && <Row label={t('accountName')} value={props.accountName} />}
          {props.network && <Row label={t('network')} value={props.network} />}
        </dl>
      </div>

      <ol className="mt-4 list-decimal space-y-1.5 pl-5 text-[0.8125rem] leading-relaxed text-ink-600">
        <li>{t('step1', { amount, number: props.number })}</li>
        <li>{t('step2')}</li>
        <li>{t('step3')}</li>
      </ol>

      <form method="post" onSubmit={submit} noValidate className="mt-5 flex flex-col gap-3.5">
        <TextField
          label={t('senderPhone')}
          type="tel"
          inputMode="tel"
          autoComplete="tel-national"
          placeholder="024 123 4567"
          value={senderPhone}
          onChange={(e) => setSenderPhone(e.target.value)}
        />
        <div>
          <p className="text-[0.8125rem] font-medium text-ink-800">{t('proof')}</p>
          <label className="mt-1.5 flex cursor-pointer items-center gap-3 rounded-(--radius-input) border border-dashed border-ink-300 bg-surface px-3.5 py-3 hover:border-brand-500">
            <span className="grid size-9 shrink-0 place-items-center rounded-full bg-brand-50 text-brand-600">
              <ImageUp aria-hidden className="size-4.5" />
            </span>
            <span className="min-w-0 text-[0.8125rem] text-ink-600">
              {preparing
                ? t('proofPreparing')
                : proof
                  ? t('proofReady', { kb: Math.max(1, Math.round(proof.size / 1024)) })
                  : t('proofPick')}
            </span>
            <input
              type="file"
              accept="image/*"
              className="sr-only"
              onChange={(e) => void pickProof(e.target.files?.[0])}
            />
          </label>
          <p className="mt-1 text-[0.75rem] text-ink-500">{t('proofHint')}</p>
        </div>
        {error && (
          <p role="alert" className="text-[0.8125rem] font-medium text-danger-600">
            {error}
          </p>
        )}
        <Button type="submit" size="lg" fullWidth loading={pending} disabled={pending || preparing}>
          {t('sent')}
        </Button>
        <Button type="button" variant="ghost" size="sm" fullWidth disabled={pending} onClick={cancel}>
          {t('cancel')}
        </Button>
      </form>
    </div>
  )
}

function Row({
  label,
  value,
  copy,
  mono,
}: {
  label: string
  value: string
  copy?: { label: string; copied: string }
  mono?: boolean
}) {
  return (
    <div className="flex items-center justify-between gap-3 py-2.5">
      <div className="min-w-0">
        <dt className="text-[0.75rem] text-ink-500">{label}</dt>
        <dd className={`mt-0.5 truncate text-[0.9375rem] font-semibold text-ink-900 ${mono ? 'tabular-nums tracking-[0.02em]' : ''}`}>
          {value}
        </dd>
      </div>
      {copy && <CopyButton value={value} label={copy.label} copied={copy.copied} />}
    </div>
  )
}

function CopyButton({ value, label, copied }: { value: string; label: string; copied: string }) {
  const [done, setDone] = useState(false)
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value)
          setDone(true)
          setTimeout(() => setDone(false), 1500)
        } catch {
          /* Clipboard refused (old browser, no permission): the value is on screen. */
        }
      }}
      className="inline-flex shrink-0 items-center gap-1.5 rounded-(--radius-input) border border-ink-200 px-2.5 py-1.5 text-[0.75rem] font-medium text-ink-700 hover:bg-ink-50"
    >
      {done ? <Check aria-hidden className="size-3.5" /> : <Copy aria-hidden className="size-3.5" />}
      {done ? copied : label}
    </button>
  )
}
