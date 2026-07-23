import type { Metadata } from 'next'

import { ArrowRight, Coins, Plus, TrendingUp, Wallet } from 'lucide-react'
import { setRequestLocale } from 'next-intl/server'

import { StyleguideForms } from '@/components/styleguide/StyleguideForms'
import { ThemeToggle } from '@/components/theme/ThemeToggle'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card, CardBody, CardFooter, CardHeader, StatCard } from '@/components/ui/Card'

export const metadata: Metadata = {
  title: 'Styleguide',
  robots: { index: false, follow: false },
}

function Section({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <section className="border-t border-ink-200 pt-8">
      <h2 className="text-sm font-semibold tracking-[-0.01em] text-ink-900">{title}</h2>
      {note && <p className="mt-1 max-w-2xl text-[0.8125rem] leading-relaxed text-ink-500">{note}</p>}
      <div className="mt-5">{children}</div>
    </section>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-3 py-2.5">
      <span className="w-24 shrink-0 text-[0.75rem] font-medium text-ink-400">{label}</span>
      {children}
    </div>
  )
}

export default async function StyleguidePage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  setRequestLocale(locale)

  return (
    <div className="min-h-dvh bg-canvas px-5 py-10 sm:px-8">
      <div className="mx-auto flex max-w-4xl flex-col gap-8">
        <header className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold tracking-[-0.02em] text-ink-900">Styleguide</h1>
            <p className="mt-1 max-w-2xl text-[0.8125rem] leading-relaxed text-ink-500">
              Every primitive the platform is built from. If a screen needs something not on this
              page, it belongs here first — that is what keeps eleven dashboard surfaces looking
              like one product.
            </p>
          </div>
          {/* The theme choice persists app-wide, so flipping it here also
              switches signup, login and the dashboard. This lives on the
              styleguide until the user/admin dashboards ship their own copy. */}
          <ThemeToggle className="shrink-0" />
        </header>

        {/* ---------------------------------------------------------------- */}
        <Section
          title="Buttons"
          note="Every variant carries a border, including the solid ones — a darker shade of its own fill. Filled variants also get a 1px inset highlight along the top edge. Both are invisible until removed, and removing them is what makes a button look flat."
        >
          <div className="divide-y divide-ink-200 rounded-(--radius-card) border border-ink-200 bg-surface px-4">
            <Row label="Primary">
              <Button size="sm">Small</Button>
              <Button size="md">Medium</Button>
              <Button size="lg">Large</Button>
            </Row>
            <Row label="Secondary">
              <Button variant="secondary" size="sm">Small</Button>
              <Button variant="secondary" size="md">Medium</Button>
              <Button variant="secondary" size="lg">Large</Button>
            </Row>
            <Row label="Ghost">
              <Button variant="ghost" size="sm">Small</Button>
              <Button variant="ghost" size="md">Medium</Button>
              <Button variant="ghost" size="lg">Large</Button>
            </Row>
            <Row label="Danger">
              <Button variant="danger" size="sm">Reject</Button>
              <Button variant="danger" size="md">Disable account</Button>
            </Row>
            <Row label="With icons">
              <Button leadingIcon={<Plus />}>New ad</Button>
              <Button variant="secondary" trailingIcon={<ArrowRight />}>Continue</Button>
              <Button variant="secondary" iconOnly aria-label="Add">
                <Plus />
              </Button>
            </Row>
            <Row label="States">
              <Button loading>Saving</Button>
              <Button disabled>Disabled</Button>
              <Button variant="secondary" disabled>Disabled</Button>
            </Row>
            <Row label="Full width">
              <div className="w-full max-w-xs">
                <Button fullWidth>Create account</Button>
              </div>
            </Row>
          </div>
        </Section>

        {/* ---------------------------------------------------------------- */}
        <Section
          title="Badges"
          note="Tones are named after meaning rather than colour, so tone=&quot;danger&quot; survives a palette change. Tinted rather than solid — a page of solid pills is louder than the data it describes."
        >
          <div className="flex flex-wrap items-center gap-2 rounded-(--radius-card) border border-ink-200 bg-surface p-4">
            <Badge>Draft</Badge>
            <Badge tone="brand" dot>Active</Badge>
            <Badge tone="success" dot>Paid</Badge>
            <Badge tone="warning" dot>Held</Badge>
            <Badge tone="danger" dot>Rejected</Badge>
            <Badge tone="neutral" dot>Exhausted</Badge>
          </div>
        </Section>

        {/* ---------------------------------------------------------------- */}
        <Section
          title="Stat tiles"
          note="The most repeated shape on the dashboards. Figures are tabular so a balance changing from 1,999 to 2,000 does not shift the layout — this sits next to a Realtime value."
        >
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard
              label="Points balance"
              value="12,450"
              sublabel="GHS 12.45"
              icon={<Coins />}
              trend={{ value: '8.2%', direction: 'up' }}
            />
            <StatCard label="Ads today" value="14 / 20" sublabel="6 remaining" icon={<TrendingUp />} />
            <StatCard
              label="Pending payout"
              value="GHS 25.00"
              sublabel="Held until 26 Jul"
              icon={<Wallet />}
            />
            <StatCard
              label="Referrals"
              value="3"
              sublabel="1 pending activation"
              trend={{ value: 'no change', direction: 'flat' }}
            />
          </div>
        </Section>

        {/* ---------------------------------------------------------------- */}
        <Section
          title="Cards"
          note="A 1px border does the containing, not a shadow — shadow-heavy cards read as floating and stack badly when there are twelve on a page. The footer's faint tint is what gives a card a base rather than an abrupt end."
        >
          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <CardHeader
                title="Payout details"
                description="Where your money goes."
                action={<Badge tone="success" dot>Verified</Badge>}
              />
              <CardBody className="text-[0.8125rem] text-ink-600">
                <dl className="grid gap-2">
                  <div className="flex justify-between gap-4">
                    <dt className="text-ink-500">Provider</dt>
                    <dd className="font-medium text-ink-900">MTN Mobile Money</dd>
                  </div>
                  <div className="flex justify-between gap-4">
                    <dt className="text-ink-500">Number</dt>
                    <dd className="font-medium tabular-nums text-ink-900">0241****4567</dd>
                  </div>
                  <div className="flex justify-between gap-4">
                    <dt className="text-ink-500">Name</dt>
                    <dd className="font-medium text-ink-900">Kwame Mensah</dd>
                  </div>
                </dl>
              </CardBody>
              <CardFooter>
                <span className="text-[0.75rem] text-ink-500">Changing these starts a 48h wait.</span>
                <Button variant="secondary" size="sm">Edit</Button>
              </CardFooter>
            </Card>

            <Card>
              <CardHeader title="Redemption request" action={<Badge tone="warning" dot>Held</Badge>} />
              <CardBody className="text-[0.8125rem] text-ink-600">
                <p className="text-2xl font-semibold tabular-nums tracking-[-0.02em] text-ink-900">
                  GHS 25.00
                </p>
                <p className="mt-1 text-ink-500">25,000 points · MTN Mobile Money</p>
                <p className="mt-3 text-[0.75rem] text-ink-400">
                  Reviewed after the holding period ends on 26 July.
                </p>
              </CardBody>
              <CardFooter>
                <Button variant="ghost" size="sm">Cancel request</Button>
                <Button variant="secondary" size="sm">View details</Button>
              </CardFooter>
            </Card>
          </div>
        </Section>

        {/* ---------------------------------------------------------------- */}
        <Section
          title="Form controls"
          note="36px tall, 6px radius, hairline border that darkens on hover, and a two-tone focus — brand border plus a low-opacity halo. Errors are announced, and never carried by colour alone."
        >
          <StyleguideForms />
        </Section>

        {/* ---------------------------------------------------------------- */}
        <Section title="Palette" note="Brand blue sampled from the operator's reference: #0068F8.">
          <div className="flex flex-col gap-4 rounded-(--radius-card) border border-ink-200 bg-surface p-4">
            {/*
              Class names written out in full. Tailwind extracts classes by
              scanning source text, so `bg-${name}-${shade}` produces nothing —
              which is exactly what happened here first time: blank swatches.
            */}
            {(
              [
                {
                  name: 'brand',
                  swatches: [
                    ['50', 'bg-brand-50'], ['100', 'bg-brand-100'], ['200', 'bg-brand-200'],
                    ['300', 'bg-brand-300'], ['400', 'bg-brand-400'], ['500', 'bg-brand-500'],
                    ['600', 'bg-brand-600'], ['700', 'bg-brand-700'], ['800', 'bg-brand-800'],
                    ['900', 'bg-brand-900'], ['950', 'bg-brand-950'],
                  ],
                },
                {
                  name: 'ink',
                  swatches: [
                    ['50', 'bg-ink-50'], ['100', 'bg-ink-100'], ['200', 'bg-ink-200'],
                    ['300', 'bg-ink-300'], ['400', 'bg-ink-400'], ['500', 'bg-ink-500'],
                    ['600', 'bg-ink-600'], ['700', 'bg-ink-700'], ['800', 'bg-ink-800'],
                    ['900', 'bg-ink-900'],
                  ],
                },
              ] as const
            ).map((ramp) => (
              <div key={ramp.name}>
                <p className="mb-1.5 text-[0.75rem] font-medium text-ink-400">{ramp.name}</p>
                <div className="flex overflow-hidden rounded-(--radius-input) border border-ink-200">
                  {ramp.swatches.map(([shade, cls]) => (
                    <div key={shade} className={`h-10 flex-1 ${cls}`} title={`${ramp.name}-${shade}`} />
                  ))}
                </div>
              </div>
            ))}

            <div className="flex flex-wrap gap-4">
              {(
                [
                  ['success-600', 'bg-success-600'],
                  ['warning-500', 'bg-warning-500'],
                  ['danger-600', 'bg-danger-600'],
                  ['brand-accent', 'bg-brand-accent'],
                ] as const
              ).map(([name, cls]) => (
                <span key={name} className="inline-flex items-center gap-2 text-[0.75rem] text-ink-500">
                  <span className={`size-4 rounded border border-ink-200 ${cls}`} />
                  {name}
                </span>
              ))}
            </div>
          </div>
        </Section>
      </div>
    </div>
  )
}
