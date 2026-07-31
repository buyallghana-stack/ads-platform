'use client'

import {
  Plus,
  Trash2,
  AtSign,
  Briefcase,
  Camera,
  Globe,
  Mail,
  MessageCircle,
  Music2,
  Phone,
  PlaySquare,
  Users,
} from 'lucide-react'
import { useTranslations } from 'next-intl'

import { Button } from '@/components/ui/Button'
import type { AdErrors } from '@/lib/admin/ad-draft'
import { CTA_KINDS, ctaHref, type CtaKind, type CtaLink } from '@/lib/ads/cta'
import { cn } from '@/lib/cn'

import { Field, inputClass } from './FormBits'

/**
 * What the viewer can do about the ad they just watched.
 *
 * The operator's words: "these are maybe the links, advertisers contact
 * information, social media handles, or websites if they have i can place them
 * there." So it is a list rather than a fixed set of fields — an advertiser
 * might send a website and nothing else, or a WhatsApp number and two handles,
 * and a column per channel would mean a migration every time a new one
 * matters.
 *
 * The FIRST entry is the big button under the video; the rest become small
 * links beside it. Order is the operator's, which is why entries move rather
 * than sort themselves.
 *
 * Values are stored exactly as the advertiser wrote them — "@mtnghana",
 * "024 123 4567", "mtn.com.gh". Turning those into links is `ctaHref`, and the
 * preview under each row shows what it resolved to, so a typo is visible here
 * rather than discovered by a user tapping a dead link.
 */

const ICON: Record<CtaKind, typeof Globe> = {
  website: Globe,
  whatsapp: MessageCircle,
  phone: Phone,
  email: Mail,
  // lucide-react dropped its brand marks (a trademark question, not an
  // oversight), so each social channel gets a plain icon that says what it
  // is for. The channel's NAME is always beside it, so nothing depends on
  // recognising the glyph.
  instagram: Camera,
  facebook: Users,
  x: AtSign,
  tiktok: Music2,
  youtube: PlaySquare,
  linkedin: Briefcase,
}

export function AdCallToAction({
  label,
  links,
  errors,
  showErrors,
  max = 6,
  onLabel,
  onLinks,
}: {
  label: string
  links: CtaLink[]
  errors: AdErrors
  showErrors: boolean
  /**
   * How many destinations this ad may carry. Six for a video, where the links
   * are an offer beside the film — but ONE for a link ad, where the link is
   * the ad: two destinations would make "was the link clicked" a question
   * with two different answers, and the database refuses it outright.
   */
  max?: number
  onLabel: (value: string) => void
  onLinks: (links: CtaLink[]) => void
}) {
  const t = useTranslations('admin.ads.editor')

  const err = (key: string) => {
    const found = showErrors ? errors[key] : undefined
    return found ? t(`errors.${found}`) : undefined
  }

  const set = (index: number, patch: Partial<CtaLink>) =>
    onLinks(links.map((link, i) => (i === index ? { ...link, ...patch } : link)))

  return (
    <div className="flex flex-col gap-3">
      {links.length === 0 && (
        <p className="rounded-(--radius-card) border border-dashed border-ink-200 px-4 py-6 text-center text-[0.8125rem] leading-relaxed text-ink-400">
          {t('ctaEmpty')}
        </p>
      )}

      {links.map((link, index) => {
        const Icon = ICON[link.kind] ?? Globe
        const href = ctaHref(link)
        const problem = err(`cta.${index}`)

        return (
          <div
            key={index}
            className="rounded-(--radius-card) border border-ink-200 bg-canvas p-3"
          >
            <div className="mb-2 flex items-center justify-between gap-2">
              <span className="inline-flex items-center gap-1.5 text-[0.6875rem] font-semibold tracking-[0.05em] text-ink-400 uppercase">
                <Icon aria-hidden className="size-3.5" />
                {max === 1
                  ? t('ctaDestination')
                  : index === 0
                    ? t('ctaPrimary')
                    : t('ctaLinkN', { n: index + 1 })}
              </span>
              <button
                type="button"
                aria-label={t('ctaRemove')}
                title={t('ctaRemove')}
                onClick={() => onLinks(links.filter((_, i) => i !== index))}
                className="grid size-8 place-items-center rounded-(--radius-input) text-danger-600 transition-colors hover:bg-danger-50 [&>svg]:size-3.5"
              >
                <Trash2 aria-hidden />
              </button>
            </div>

            <div className="flex flex-col gap-2 sm:flex-row">
              <select
                value={link.kind}
                aria-label={t('ctaChannel')}
                onChange={(e) => set(index, { kind: e.target.value as CtaKind })}
                className={inputClass(false, 'h-9 pr-8 sm:w-40 sm:shrink-0')}
              >
                {CTA_KINDS.map((kind) => (
                  <option key={kind} value={kind}>
                    {t(`ctaKind.${kind}`)}
                  </option>
                ))}
              </select>

              <input
                value={link.value}
                aria-label={t('ctaValue')}
                placeholder={t(`ctaPlaceholder.${link.kind}`)}
                onChange={(e) => set(index, { value: e.target.value })}
                className={inputClass(Boolean(problem), 'h-9 min-w-0 flex-1')}
              />
            </div>

            {problem ? (
              <p role="alert" className="mt-1.5 text-[0.6875rem] font-medium text-danger-600">
                {problem}
              </p>
            ) : (
              href && (
                /* What it will actually open. A typo in a handle is invisible
                   until you see the link it built. */
                <p className="mt-1.5 truncate text-[0.625rem] text-ink-400">
                  {t('ctaOpens', { href })}
                </p>
              )
            )}
          </div>
        )
      })}

      {/* A problem with the SET of links rather than with one of them: a link
          ad with no destination, or with two. */}
      {err('ctaLinks') && (
        <p role="alert" className="text-[0.75rem] font-medium text-danger-600">
          {err('ctaLinks')}
        </p>
      )}

      {links.length < max && (
        <Button
          type="button"
          variant="secondary"
          size="md"
          className="self-start"
          onClick={() => onLinks([...links, { kind: 'website', value: '' }])}
        >
          <Plus aria-hidden className="size-4" />
          {links.length === 0 ? t('ctaAddFirst') : t('ctaAdd')}
        </Button>
      )}

      {links.length > 0 && (
        <Field
          label={t('ctaLabelField')}
          hint={t('ctaLabelHint')}
          error={err('ctaLabel')}
          className="max-w-xs"
        >
          <input
            value={label}
            maxLength={40}
            placeholder={t('ctaLabelPlaceholder')}
            onChange={(e) => onLabel(e.target.value)}
            className={inputClass(Boolean(err('ctaLabel')))}
          />
        </Field>
      )}

      <p className={cn('text-[0.6875rem] leading-relaxed text-ink-400')}>
        {t(max === 1 ? 'ctaNoteLink' : 'ctaNote')}
      </p>
    </div>
  )
}
