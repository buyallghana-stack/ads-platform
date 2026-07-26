import type { Metadata } from 'next'

import {
  ArrowRight,
  BadgeCheck,
  ChevronRight,
  Clock3,
  Coins,
  Gift,
  Globe2,
  KeyRound,
  ListChecks,
  Lock,
  PlayCircle,
  Send,
  ShieldCheck,
  Sparkles,
  Store,
  TrendingUp,
  UserPlus,
  Wallet,
} from 'lucide-react'
import { getFormatter, getTranslations, setRequestLocale } from 'next-intl/server'

import { Chip, Display, Eyebrow, IconTile, Section, SectionHead } from '@/components/marketing/Bits'
import { Faq } from '@/components/marketing/Faq'
import { MarketingFooter } from '@/components/marketing/MarketingFooter'
import { MarketingNav } from '@/components/marketing/MarketingNav'
import { PhoneFrame } from '@/components/marketing/PhoneFrame'
import { Button } from '@/components/ui/Button'
import { Link } from '@/i18n/navigation'
import { getMarketingFigures } from '@/lib/marketing/plans'

/**
 * SidePerks landing page. Replaces the redirect that used to send every
 * visitor straight to /signup.
 *
 * WHAT THIS PAGE SELLS, AND WHY (operator decision, 2026-07-26). SidePerks is
 * meant to cover ad-watching and affiliate marketing. Only one of those is
 * built: the ad and survey loop ships and pays today, while outbound affiliate
 * marketing is a later phase (plan §12, "currently dropped/deferred"). So
 * watching leads the page, the invite programme — which does exist — takes the
 * secondary slot, and affiliate offers appear once, clearly marked as not yet
 * available. Nothing here advertises a screen a visitor cannot reach.
 *
 * EVERY NUMBER ON THIS PAGE COMES FROM THE DATABASE (`getMarketingFigures`) —
 * prices, daily limits, the points-to-cedi rate, withdrawal thresholds. There
 * are no invented user counts, testimonials or payout totals anywhere on it,
 * and the imagery is genuine screenshots of the running app rather than stock
 * photography (see PhoneFrame).
 *
 * RENDERING: statically generated, revalidated hourly. It is the front door on
 * Ghanaian mobile data, so it must arrive as cached HTML; the figures are read
 * through a cookieless anon client precisely so the route can stay static.
 */

export const revalidate = 3600

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>
}): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'landing.meta' })

  // `absolute` escapes the layout's "%s · SidePerks" template — the front page
  // should not be titled "SidePerks · SidePerks".
  return {
    title: { absolute: t('title') },
    description: t('description'),
  }
}

export default async function LandingPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  setRequestLocale(locale)

  const t = await getTranslations('landing')
  const format = await getFormatter()
  const figures = await getMarketingFigures()

  const num = (n: number) => format.number(n)
  const freeAds = figures.free?.adsPerDay ?? 20
  const bestRate = figures.best?.rewardMultiplier ?? 2
  const months = figures.plans.find((p) => !p.isDefault)?.months ?? 3
  const paidPlans = figures.plans.filter((p) => !p.isDefault)

  /* --- Stat band. Four figures, every one of them read from config. ----- */
  const stats = [
    { icon: <PlayCircle />, value: num(freeAds), label: t('stats.freeAds') },
    {
      icon: <Coins />,
      value: 'GHS 1',
      label: t('stats.rate', { points: num(figures.pointsPerCedi) }),
    },
    { icon: <TrendingUp />, value: `${bestRate}×`, label: t('stats.bestRate') },
    { icon: <Clock3 />, value: t('stats.monthsValue', { months }), label: t('stats.months') },
  ]

  const steps = [
    { icon: <UserPlus />, tone: 'brand' as const, key: 'signup' },
    { icon: <PlayCircle />, tone: 'brand' as const, key: 'watch' },
    { icon: <ListChecks />, tone: 'violet' as const, key: 'answer' },
    { icon: <Wallet />, tone: 'success' as const, key: 'earn' },
  ]

  /* --- Safety. Every item is a feature that is actually built. ---------- */
  const safety = [
    { icon: <ShieldCheck />, tone: 'brand' as const, key: 'twoFactor' },
    { icon: <KeyRound />, tone: 'violet' as const, key: 'pin' },
    { icon: <Wallet />, tone: 'success' as const, key: 'accounts' },
    { icon: <Coins />, tone: 'orange' as const, key: 'peg' },
    { icon: <Lock />, tone: 'teal' as const, key: 'data' },
    { icon: <BadgeCheck />, tone: 'brand' as const, key: 'oneAccount' },
  ]

  const faqItems = ['free', 'worth', 'withdraw', 'questions', 'methods', 'devices'].map((k) => ({
    q: t(`faq.items.${k}.q`),
    a: t(`faq.items.${k}.a`, {
      freeAds: num(freeAds),
      points: num(figures.pointsPerCedi),
      freeThreshold: num(figures.free?.withdrawFrom ?? 5000),
      bestThreshold: num(figures.best?.withdrawFrom ?? 1000),
    }),
  }))

  return (
    <div className="min-h-full bg-canvas">
      <MarketingNav />

      <main>
        {/* ================= HERO ================= */}
        <Section className="pt-10 pb-4 sm:pt-14 lg:pt-20 lg:pb-8">
          <div className="grid items-center gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)] lg:gap-16">
            <div className="flex flex-col items-start">
              <a
                href="#earning"
                className="group inline-flex items-center gap-2 rounded-full border border-ink-200 bg-surface py-1 pr-3 pl-1 text-sm text-ink-600 transition-colors hover:border-ink-300"
              >
                <Chip tone="success">{t('hero.badgeChip')}</Chip>
                <span className="font-medium">{t('hero.badge')}</span>
                <ArrowRight
                  aria-hidden
                  className="size-3.5 shrink-0 text-ink-400 transition-transform group-hover:translate-x-0.5"
                />
              </a>

              <Display
                as="h1"
                title={t('hero.title')}
                accent={t('hero.titleAccent')}
                className="mt-6"
              />

              <p className="mt-5 max-w-xl text-[1.0625rem] leading-relaxed text-pretty text-ink-600 sm:text-lg">
                {t('hero.lead', { points: num(figures.pointsPerCedi), freeAds: num(freeAds) })}
              </p>

              {/* GRID, not flex. `Button` carries `shrink-0`, so a `fullWidth`
                  button in a flex row cannot give width back and overruns its
                  container — the exact defect that clipped the survey sheet's
                  Submit button. A grid item stretches to its track instead. */}
              <div className="mt-8 grid w-full gap-3 sm:w-auto sm:grid-flow-col sm:auto-cols-max">
                <Link href="/signup">
                  <Button size="lg" fullWidth trailingIcon={<ArrowRight />}>
                    {t('hero.primaryCta')}
                  </Button>
                </Link>
                <a href="#how">
                  <Button variant="secondary" size="lg" fullWidth>
                    {t('hero.secondaryCta')}
                  </Button>
                </a>
              </div>

              <p className="mt-4 text-sm text-ink-500">{t('hero.note')}</p>
            </div>

            {/* Hero visual: the real ads feed on a soft brand field. The two
                floating chips quote the screen behind them, so nothing here
                claims more than the screenshot already shows. */}
            {/* The outer px-3 and the plate's -inset-x-3 cancel exactly, so
                the tinted plate reaches the column's edge and never past it.
                An earlier version used `inset-x-[-8%]`, which is a percentage
                of a column that is full-width on a phone — it hung 23px off
                the right edge at 320px and made the whole document scroll
                sideways. Negative insets in a hero must be fixed lengths
                inside a box that has been padded to absorb them. */}
            <div className="mx-auto w-full max-w-[26rem] px-3 lg:mx-0">
              <div className="relative">
                <div
                  aria-hidden
                  className="absolute -inset-x-3 -inset-y-4 rounded-[2.5rem] bg-linear-160 from-brand-100 via-brand-50 to-violet-50"
                />
                <PhoneFrame
                  priority
                  srcLight="/marketing/ads-feed-light.webp"
                  srcDark="/marketing/ads-feed-dark.webp"
                  alt={t('hero.shotAlt')}
                  width={780}
                  height={1440}
                  className="relative mx-auto max-w-[19rem] sm:max-w-[21rem]"
                />

                {/* Floating chips quote the screen behind them. Hidden below
                    sm, where there is no room beside the phone for them. */}
                <div className="pointer-events-none absolute -top-5 -left-5 hidden rounded-(--radius-card) border border-ink-200 bg-surface px-3 py-2 shadow-[0_8px_24px_-8px_rgb(15_23_42/0.25)] sm:block">
                  <p className="text-[0.6875rem] font-semibold tracking-[0.06em] text-ink-500 uppercase">
                    {t('hero.chipEarnedLabel')}
                  </p>
                  <p className="text-lg font-semibold text-success-700">
                    {t('hero.chipEarnedValue')}
                  </p>
                </div>

                <div className="pointer-events-none absolute -right-2 bottom-8 hidden rounded-(--radius-card) border border-ink-200 bg-surface px-3 py-2 shadow-[0_8px_24px_-8px_rgb(15_23_42/0.25)] sm:block">
                  <p className="text-[0.6875rem] font-semibold tracking-[0.06em] text-ink-500 uppercase">
                    {t('hero.chipDailyLabel')}
                  </p>
                  <p className="text-lg font-semibold text-ink-900">
                    {t('hero.chipDailyValue', { count: num(freeAds) })}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </Section>

        {/* ================= STAT BAND ================= */}
        <div className="px-4 sm:px-6">
          <div className="mx-auto max-w-[76rem] border-y border-ink-200 py-8 sm:py-10">
            <dl className="grid grid-cols-2 gap-x-6 gap-y-8 lg:grid-cols-4">
              {stats.map((s) => (
                <div key={s.label} className="flex flex-col items-center gap-1 text-center">
                  <span aria-hidden className="text-ink-400 [&>svg]:size-6">
                    {s.icon}
                  </span>
                  <dd className="text-[1.75rem] leading-tight font-semibold tracking-[-0.02em] text-ink-900 sm:text-[2rem]">
                    {s.value}
                  </dd>
                  <dt className="text-sm text-balance text-ink-500">{s.label}</dt>
                </div>
              ))}
            </dl>
          </div>
        </div>

        {/* ================= WAYS TO EARN ================= */}
        <Section>
          <SectionHead
            eyebrow={t('ways.eyebrow')}
            eyebrowIcon={<Sparkles />}
            title={t('ways.title')}
            accent={t('ways.titleAccent')}
            lead={t('ways.lead')}
          />

          <div className="mt-12 grid gap-4 lg:grid-cols-3">
            {/* The built product gets the double-width card and the only
                coloured fill. Weight on the page mirrors weight in the app. */}
            <article className="relative flex flex-col overflow-hidden rounded-(--radius-panel) border border-brand-600/20 bg-brand-50 p-6 sm:p-8 lg:col-span-2">
              <div className="flex flex-wrap items-center gap-3">
                <IconTile tone="brand" size="lg">
                  <PlayCircle />
                </IconTile>
                <Chip tone="success">{t('ways.watch.chip')}</Chip>
              </div>
              <h3 className="mt-5 text-xl font-semibold tracking-[-0.02em] text-balance text-ink-900 sm:text-2xl">
                {t('ways.watch.title')}
              </h3>
              <p className="mt-3 max-w-xl leading-relaxed text-pretty text-ink-600">
                {t('ways.watch.body', { freeAds: num(freeAds) })}
              </p>
              <ul className="mt-6 grid gap-3 sm:grid-cols-2">
                {['videos', 'surveys', 'upfront', 'instant'].map((k) => (
                  <li key={k} className="flex items-start gap-2.5">
                    <BadgeCheck aria-hidden className="mt-0.5 size-4 shrink-0 text-brand-600" />
                    <span className="text-sm text-ink-700">{t(`ways.watch.points.${k}`)}</span>
                  </li>
                ))}
              </ul>
              <div className="mt-7">
                <Link href="/signup">
                  <Button trailingIcon={<ArrowRight />}>{t('ways.watch.cta')}</Button>
                </Link>
              </div>
            </article>

            <div className="grid gap-4">
              <article className="flex flex-col rounded-(--radius-panel) border border-ink-200 bg-surface p-6">
                <div className="flex flex-wrap items-center gap-3">
                  <IconTile tone="orange">
                    <Gift />
                  </IconTile>
                  <Chip tone="success">{t('ways.invite.chip')}</Chip>
                </div>
                <h3 className="mt-4 text-lg font-semibold tracking-[-0.02em] text-ink-900">
                  {t('ways.invite.title')}
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-pretty text-ink-600">
                  {t('ways.invite.body')}
                </p>
                <a
                  href="#invite"
                  className="mt-auto inline-flex items-center gap-1 pt-5 text-sm font-semibold text-orange-700 hover:underline"
                >
                  {t('ways.invite.cta')}
                  <ChevronRight aria-hidden className="size-4" />
                </a>
              </article>

              {/* Not built. Says so in the badge AND in the copy — an unmarked
                  "coming soon" card is just a promise in a nicer font. It is
                  deliberately the quietest card on the page. */}
              <article className="flex flex-col rounded-(--radius-panel) border border-dashed border-ink-300 bg-canvas p-6">
                <div className="flex flex-wrap items-center gap-3">
                  <IconTile tone="violet">
                    <Store />
                  </IconTile>
                  <Chip tone="neutral">{t('ways.affiliate.chip')}</Chip>
                </div>
                <h3 className="mt-4 text-lg font-semibold tracking-[-0.02em] text-ink-900">
                  {t('ways.affiliate.title')}
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-pretty text-ink-600">
                  {t('ways.affiliate.body')}
                </p>
              </article>
            </div>
          </div>
        </Section>

        {/* ================= HOW IT WORKS ================= */}
        <Section id="how" className="bg-surface">
          <SectionHead
            eyebrow={t('how.eyebrow')}
            eyebrowIcon={<ListChecks />}
            title={t('how.title')}
            accent={t('how.titleAccent')}
            lead={t('how.lead')}
          />

          <ol className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {steps.map((step, i) => (
              <li
                key={step.key}
                className="flex flex-col rounded-(--radius-card) border border-ink-200 bg-canvas p-6"
              >
                <div className="flex items-center justify-between">
                  <IconTile tone={step.tone}>{step.icon}</IconTile>
                  <span aria-hidden className="text-2xl font-semibold tracking-[-0.02em] text-ink-300">
                    {String(i + 1).padStart(2, '0')}
                  </span>
                </div>
                <h3 className="mt-5 font-semibold text-ink-900">
                  {t(`how.steps.${step.key}.title`)}
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-pretty text-ink-600">
                  {t(`how.steps.${step.key}.body`)}
                </p>
              </li>
            ))}
          </ol>
        </Section>

        {/* ================= EARNING SHOWCASE ================= */}
        <Section id="earning">
          <SectionHead
            eyebrow={t('earning.eyebrow')}
            eyebrowIcon={<PlayCircle />}
            title={t('earning.title')}
            accent={t('earning.titleAccent')}
            lead={t('earning.lead')}
          />

          <div className="mt-14 flex flex-col gap-16 lg:gap-24">
            {/* Row 1 — the feed. The copy comes first in source order so a
                screen reader hears the claim before the picture of it. */}
            <div className="grid items-center gap-10 lg:grid-cols-2 lg:gap-16">
              <div>
                <Eyebrow tone="brand">{t('earning.feed.eyebrow')}</Eyebrow>
                <h3 className="mt-3 text-[1.5rem] leading-tight font-semibold tracking-[-0.025em] text-balance text-ink-900 sm:text-[1.875rem]">
                  {t('earning.feed.title')}
                </h3>
                <p className="mt-4 leading-relaxed text-pretty text-ink-600">
                  {t('earning.feed.body')}
                </p>
                <ul className="mt-6 flex flex-col gap-3">
                  {['points', 'length', 'tabs', 'cap'].map((k) => (
                    <li key={k} className="flex items-start gap-3">
                      <BadgeCheck
                        aria-hidden
                        className="mt-0.5 size-[1.125rem] shrink-0 text-brand-600"
                      />
                      <span className="text-[0.9375rem] text-ink-700">
                        {t(`earning.feed.points.${k}`, { freeAds: num(freeAds) })}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
              <PhoneFrame
                srcLight="/marketing/ads-feed-light.webp"
                srcDark="/marketing/ads-feed-dark.webp"
                alt={t('earning.feed.shotAlt')}
                width={780}
                height={1440}
                className="mx-auto w-full max-w-[18rem] lg:order-first"
              />
            </div>

            {/* Row 2 — the balance. */}
            <div className="grid items-center gap-10 lg:grid-cols-2 lg:gap-16">
              <div>
                <Eyebrow tone="success">{t('earning.balance.eyebrow')}</Eyebrow>
                <h3 className="mt-3 text-[1.5rem] leading-tight font-semibold tracking-[-0.025em] text-balance text-ink-900 sm:text-[1.875rem]">
                  {t('earning.balance.title')}
                </h3>
                <p className="mt-4 leading-relaxed text-pretty text-ink-600">
                  {t('earning.balance.body', { points: num(figures.pointsPerCedi) })}
                </p>
                <ul className="mt-6 flex flex-col gap-3">
                  {['cedis', 'statement', 'chart', 'withdraw'].map((k) => (
                    <li key={k} className="flex items-start gap-3">
                      <BadgeCheck
                        aria-hidden
                        className="mt-0.5 size-[1.125rem] shrink-0 text-success-600"
                      />
                      <span className="text-[0.9375rem] text-ink-700">
                        {t(`earning.balance.points.${k}`)}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
              <PhoneFrame
                srcLight="/marketing/home-light.webp"
                srcDark="/marketing/home-dark.webp"
                alt={t('earning.balance.shotAlt')}
                width={780}
                height={1440}
                className="mx-auto w-full max-w-[18rem]"
              />
            </div>
          </div>
        </Section>

        {/* ================= PLANS ================= */}
        <Section id="plans" className="bg-surface">
          <SectionHead
            eyebrow={t('plans.eyebrow')}
            eyebrowIcon={<TrendingUp />}
            tone="violet"
            title={t('plans.title')}
            accent={t('plans.titleAccent')}
            lead={t('plans.lead')}
          />

          {figures.plans.length > 0 && (
            <>
              <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                {paidPlans.map((plan) => {
                  const isBest = plan.slug === figures.best?.slug
                  return (
                    <article
                      key={plan.slug}
                      className={
                        isBest
                          ? 'flex flex-col rounded-(--radius-panel) border border-violet-600/30 bg-violet-50 p-6'
                          : 'flex flex-col rounded-(--radius-panel) border border-ink-200 bg-canvas p-6'
                      }
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="font-semibold text-ink-900">{plan.name}</h3>
                        {isBest && <Chip tone="violet">{t('plans.bestChip')}</Chip>}
                      </div>

                      <p className="mt-4 flex items-baseline gap-1.5">
                        <span className="text-sm font-medium text-ink-500">{plan.currency}</span>
                        <span className="text-[2rem] leading-none font-semibold tracking-[-0.03em] text-ink-900">
                          {num(plan.price)}
                        </span>
                      </p>
                      <p className="mt-1.5 text-sm text-ink-500">
                        {t('plans.period', { months: plan.months })}
                      </p>

                      <dl className="mt-6 flex flex-col gap-3 border-t border-ink-200 pt-5 text-sm">
                        <div className="flex items-baseline justify-between gap-3">
                          <dt className="text-ink-500">{t('plans.rowAds')}</dt>
                          <dd className="font-semibold text-ink-900">{num(plan.adsPerDay)}</dd>
                        </div>
                        <div className="flex items-baseline justify-between gap-3">
                          <dt className="text-ink-500">{t('plans.rowRate')}</dt>
                          <dd className="font-semibold text-success-700">
                            +{Math.round((plan.rewardMultiplier - 1) * 100)}%
                          </dd>
                        </div>
                        <div className="flex items-baseline justify-between gap-3">
                          <dt className="text-ink-500">{t('plans.rowThreshold')}</dt>
                          <dd className="font-semibold text-ink-900">{num(plan.withdrawFrom)}</dd>
                        </div>
                      </dl>
                    </article>
                  )
                })}
              </div>

              {/* The free tier is deliberately not a fifth card in that row.
                  It is not something you buy, and pricing it beside the paid
                  plans invites the comparison that ends in "why would I pay". */}
              {figures.free && (
                <div className="mt-4 flex flex-col gap-4 rounded-(--radius-panel) border border-ink-200 bg-canvas p-6 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <h3 className="font-semibold text-ink-900">
                      {t('plans.free.title', { name: figures.free.name })}
                    </h3>
                    <p className="mt-1.5 text-sm text-pretty text-ink-600">
                      {t('plans.free.body', {
                        ads: num(figures.free.adsPerDay),
                        threshold: num(figures.free.withdrawFrom),
                      })}
                    </p>
                  </div>
                  <div className="shrink-0">
                    <Link href="/signup">
                      <Button variant="secondary" trailingIcon={<ArrowRight />}>
                        {t('plans.free.cta')}
                      </Button>
                    </Link>
                  </div>
                </div>
              )}

              <p className="mt-6 max-w-3xl text-sm leading-relaxed text-pretty text-ink-500">
                {t('plans.stacking')}
              </p>
            </>
          )}
        </Section>

        {/* ================= INVITE ================= */}
        <Section id="invite">
          <div className="overflow-hidden rounded-(--radius-panel) border border-orange-600/20 bg-orange-50">
            <div className="grid gap-10 p-6 sm:p-10 lg:grid-cols-2 lg:items-center lg:gap-16 lg:p-14">
              <div>
                <Eyebrow tone="orange" icon={<Gift />}>
                  {t('invite.eyebrow')}
                </Eyebrow>
                <Display
                  title={t('invite.title')}
                  accent={t('invite.titleAccent')}
                  className="mt-3"
                />
                <p className="mt-4 leading-relaxed text-pretty text-ink-600">{t('invite.lead')}</p>
                <div className="mt-7">
                  <Link href="/signup">
                    <Button trailingIcon={<ArrowRight />}>{t('invite.cta')}</Button>
                  </Link>
                </div>
              </div>

              <ol className="flex flex-col gap-3">
                {[
                  { icon: <Send />, key: 'share' },
                  { icon: <UserPlus />, key: 'join' },
                  { icon: <PlayCircle />, key: 'watch' },
                  { icon: <Gift />, key: 'bonus' },
                ].map((s, i) => (
                  <li
                    key={s.key}
                    className="flex items-start gap-4 rounded-(--radius-card) border border-orange-600/15 bg-surface p-4"
                  >
                    <IconTile tone="orange">{s.icon}</IconTile>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-ink-900">
                        <span className="text-ink-400">{i + 1}. </span>
                        {t(`invite.steps.${s.key}.title`)}
                      </p>
                      <p className="mt-1 text-sm leading-relaxed text-pretty text-ink-600">
                        {t(`invite.steps.${s.key}.body`)}
                      </p>
                    </div>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        </Section>

        {/* ================= SAFETY ================= */}
        <Section className="bg-surface">
          <SectionHead
            eyebrow={t('safety.eyebrow')}
            eyebrowIcon={<ShieldCheck />}
            tone="teal"
            title={t('safety.title')}
            accent={t('safety.titleAccent')}
            lead={t('safety.lead')}
          />

          <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {safety.map((item) => (
              <div
                key={item.key}
                className="flex items-start gap-4 rounded-(--radius-card) border border-ink-200 bg-canvas p-5"
              >
                <IconTile tone={item.tone}>{item.icon}</IconTile>
                <div className="min-w-0">
                  <h3 className="text-[0.9375rem] font-semibold text-ink-900">
                    {t(`safety.items.${item.key}.title`)}
                  </h3>
                  <p className="mt-1.5 text-sm leading-relaxed text-pretty text-ink-600">
                    {t(`safety.items.${item.key}.body`)}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </Section>

        {/* ================= FAQ ================= */}
        <Section id="faq">
          <div className="grid gap-10 lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)] lg:gap-16">
            <SectionHead
              align="start"
              eyebrow={t('faq.eyebrow')}
              eyebrowIcon={<Globe2 />}
              title={t('faq.title')}
              accent={t('faq.titleAccent')}
              lead={t('faq.lead')}
            />
            <Faq items={faqItems} />
          </div>
        </Section>

        {/* ================= FINAL CTA ================= */}
        <Section className="pb-20 lg:pb-28">
          <div className="relative overflow-hidden rounded-(--radius-panel) bg-brand-600 px-6 py-14 text-center sm:px-10 lg:py-20">
            {/* Two soft pools, the same texture as the balance hero inside the
                app — the page's last frame should look like the product it
                opens onto. */}
            <div
              aria-hidden
              className="pointer-events-none absolute -top-24 -right-16 size-72 rounded-full bg-white/10"
            />
            <div
              aria-hidden
              className="pointer-events-none absolute -bottom-28 -left-10 size-80 rounded-full bg-white/[0.07]"
            />

            <div className="relative mx-auto flex max-w-2xl flex-col items-center">
              <h2 className="text-[1.75rem] leading-[1.12] font-semibold tracking-[-0.03em] text-balance text-white sm:text-[2.25rem]">
                {t('cta.title')}{' '}
                <span className="font-display text-[1.06em] font-normal tracking-[-0.01em] italic">
                  {t('cta.titleAccent')}
                </span>
              </h2>
              <p className="mt-4 text-[1.0625rem] leading-relaxed text-pretty text-white/85">
                {t('cta.lead', { freeAds: num(freeAds) })}
              </p>

              <div className="mt-8 grid w-full gap-3 sm:w-auto sm:grid-flow-col sm:auto-cols-max">
                <Link href="/signup">
                  <Button
                    size="lg"
                    fullWidth
                    trailingIcon={<ArrowRight />}
                    className="border-white bg-white text-brand-700 shadow-none hover:border-white hover:bg-brand-50 active:bg-brand-100"
                  >
                    {t('cta.primary')}
                  </Button>
                </Link>
                <Link href="/login">
                  <Button
                    size="lg"
                    fullWidth
                    variant="secondary"
                    className="border-white/35 bg-white/10 text-white shadow-none hover:border-white/50 hover:bg-white/20 hover:text-white active:bg-white/25"
                  >
                    {t('cta.secondary')}
                  </Button>
                </Link>
              </div>

              <p className="mt-5 text-sm text-white/70">{t('cta.note')}</p>
            </div>
          </div>
        </Section>
      </main>

      <MarketingFooter />
    </div>
  )
}
