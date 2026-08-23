'use client'

import { useState, useTransition } from 'react'

import { AlertTriangle, ExternalLink, Trash2, Users, X } from 'lucide-react'
import { useTranslations } from 'next-intl'

import {
  deleteCommunity,
  saveCommunity,
} from '@/app/[locale]/admin/(super)/communities/actions'
import { Button } from '@/components/ui/Button'
import type { AdminCommunity } from '@/lib/admin/data/communities'
import { cn } from '@/lib/cn'

import { StatusDot } from './AdminChrome'
import { Field, FieldSet, Segmented, SwitchRow, inputClass } from './FormBits'

const PLATFORMS = ['whatsapp', 'telegram', 'x', 'instagram', 'facebook', 'tiktok', 'other'] as const

/**
 * Community links.
 *
 * The operator adds a name and a link; the user sees the name and taps it. So
 * the form is deliberately four fields and no more, and the list shows the url
 * because THIS side is the one that needs to check it.
 *
 * Switching one off is the normal way to retire a community: the row and its
 * position survive, and it disappears from every user's Profile immediately
 * because the database's own select policy is what hides it. Delete is for a
 * link added by mistake.
 */
export function CommunitiesBoard({ communities }: { communities: AdminCommunity[] }) {
  const t = useTranslations('admin.communities')
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState<AdminCommunity | 'new' | null>(null)
  const [busy, startTransition] = useTransition()

  const remove = (id: string) =>
    startTransition(async () => {
      const r = await deleteCommunity(id)
      if (!r.ok) setError(r.message)
    })

  return (
    <>
      {error && (
        <div
          role="alert"
          className="mb-4 flex items-start gap-2.5 rounded-(--radius-card) border border-danger-500/25 bg-danger-50 px-3.5 py-3"
        >
          <AlertTriangle aria-hidden className="mt-px size-4 shrink-0 text-danger-700" />
          <p className="min-w-0 flex-1 text-[0.8125rem] leading-relaxed text-danger-700">{error}</p>
          <button
            type="button"
            onClick={() => setError(null)}
            className="shrink-0 rounded p-0.5 text-danger-700/70 hover:text-danger-700"
          >
            <X aria-hidden className="size-4" />
            <span className="sr-only">{t('dismiss')}</span>
          </button>
        </div>
      )}

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-prose text-[0.8125rem] text-ink-500">{t('intro')}</p>
        <Button size="md" leadingIcon={<Users />} onClick={() => setEditing('new')}>
          {t('create')}
        </Button>
      </div>

      {editing && (
        <CommunityForm
          community={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onError={setError}
        />
      )}

      {communities.length === 0 ? (
        <p className="rounded-(--radius-card) border border-dashed border-ink-200 px-4 py-10 text-center text-[0.875rem] text-ink-400">
          {t('empty')}
        </p>
      ) : (
        <ul className="flex flex-col gap-2.5">
          {communities.map((c) => (
            <li
              key={c.id}
              className="rounded-(--radius-card) border border-ink-200 bg-surface p-3.5"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-[0.9375rem] font-semibold text-ink-900">{c.name}</p>
                  <p className="mt-0.5 text-[0.75rem] text-ink-500">
                    {t(`platform.${c.platform}`)}
                  </p>
                </div>
                <StatusDot tone={c.isActive ? 'success' : 'neutral'}>
                  {t(c.isActive ? 'status.live' : 'status.off')}
                </StatusDot>
              </div>
              <div className="mt-3 flex items-center justify-between gap-3 border-t border-ink-200/60 pt-3">
                <a
                  href={c.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-[0.8125rem] text-ink-600 hover:text-ink-900"
                >
                  <span className="max-w-[240px] truncate sm:max-w-sm">{c.url}</span>
                  <ExternalLink aria-hidden className="size-3 shrink-0" />
                </a>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => setEditing(c)}
                    className="rounded-(--radius-input) px-3 py-1.5 text-[0.8125rem] font-medium text-ink-700 hover:bg-ink-100"
                  >
                    {t('edit')}
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => remove(c.id)}
                    className={cn(
                      'inline-flex items-center gap-1.5 rounded-(--radius-input) px-3 py-2',
                      'text-[0.8125rem] font-medium text-danger-700 hover:bg-danger-50',
                      'disabled:opacity-50',
                    )}
                  >
                    <Trash2 aria-hidden className="size-3.5" />
                    {t('delete')}
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  )
}

/* ------------------------------------------------------------------ */

function CommunityForm({
  community,
  onClose,
  onError,
}: {
  community: AdminCommunity | null
  onClose: () => void
  onError: (m: string | null) => void
}) {
  const t = useTranslations('admin.communities')
  const [pending, startTransition] = useTransition()

  const [name, setName] = useState(community?.name ?? '')
  const [platform, setPlatform] = useState(community?.platform ?? 'whatsapp')
  const [url, setUrl] = useState(community?.url ?? '')
  const [isActive, setIsActive] = useState(community?.isActive ?? true)
  const [sortOrder, setSortOrder] = useState(String(community?.sortOrder ?? 0))

  /* The same rule the database enforces, said before the save rather than
     after it. A link pasted from a browser bar often loses the scheme. */
  const urlLooksRight = /^https:\/\/\S{3,}$/i.test(url.trim())
  const ready = name.trim().length > 0 && urlLooksRight && !pending

  const submit = () =>
    startTransition(async () => {
      onError(null)
      const r = await saveCommunity({
        id: community?.id ?? null,
        name: name.trim(),
        platform,
        url: url.trim(),
        business: 'ads',
        isActive,
        sortOrder: Number(sortOrder) || 0,
      })
      if (r.ok) onClose()
      else onError(r.message)
    })

  return (
    <div className="mb-5 rounded-(--radius-card) border border-ink-200 bg-surface p-4 sm:p-5">
      <div className="grid gap-3.5 sm:grid-cols-2">
        <Field label={t('form.name')} hint={t('form.nameHint')} className="sm:col-span-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={60}
            placeholder={t('form.namePlaceholder')}
            className={inputClass(name.trim().length === 0)}
          />
        </Field>

        <Field
          label={t('form.url')}
          hint={t('form.urlHint')}
          error={url.length > 0 && !urlLooksRight ? t('form.urlError') : undefined}
          className="sm:col-span-2"
        >
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            inputMode="url"
            spellCheck={false}
            placeholder="https://chat.whatsapp.com/..."
            className={inputClass(url.length > 0 && !urlLooksRight)}
          />
        </Field>

        <Field label={t('form.platform')} hint={t('form.platformHint')}>
          <select
            value={platform}
            onChange={(e) => setPlatform(e.target.value)}
            className={inputClass()}
          >
            {PLATFORMS.map((p) => (
              <option key={p} value={p}>
                {t(`platform.${p}`)}
              </option>
            ))}
          </select>
        </Field>

        <Field label={t('form.order')} hint={t('form.orderHint')}>
          <input
            type="number"
            value={sortOrder}
            onChange={(e) => setSortOrder(e.target.value)}
            className={inputClass()}
          />
        </Field>
      </div>

      <div className="mt-3.5">
        <SwitchRow
          title={t('form.active')}
          description={t('form.activeHint')}
          checked={isActive}
          onChange={setIsActive}
        />
      </div>

      <div className="mt-4 flex flex-wrap justify-end gap-2">
        <Button type="button" variant="ghost" size="md" onClick={onClose} disabled={pending}>
          {t('cancel')}
        </Button>
        <Button type="button" size="md" onClick={submit} disabled={!ready}>
          {t('save')}
        </Button>
      </div>
    </div>
  )
}
