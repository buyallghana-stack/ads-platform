/**
 * Draft content for the two affiliate training courses.
 *
 *   node scripts/seed-training-content.mjs          write it
 *   node scripts/seed-training-content.mjs --wipe   remove it and start over
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS WRITTEN RATHER THAN SOURCED
 *
 * The obvious way to fill a course quickly is to take material off the internet.
 * These courses are SOLD, for GHS 150 and GHS 400, so anything in them that
 * belongs to somebody else is a liability that arrives later with a letter —
 * and the training programme is already the part of Phase 2 under the most
 * scrutiny (DECISIONS.md §6).
 *
 * So the text below is written from `docs/phase2/DECISIONS.md`: it describes
 * the operator's OWN programme, which no external source could do accurately
 * anyway. It is a first draft to be edited, not filler to be replaced.
 *
 * ---------------------------------------------------------------------------
 * NO VIDEO LESSONS, ON PURPOSE
 *
 * A video lesson with no file is a publish blocker (`lesson_is_ready`), so a
 * course seeded with video placeholders could not be published and the operator
 * could not exercise the rest of the flow. Everything here is `article` or
 * `quiz`, which means both courses come out PUBLISHABLE — buy, learn, activate
 * and earn can all be walked end to end today. Video lessons get added from the
 * admin when there are films to put in them.
 */
import { Client } from 'pg'

const WIPE = process.argv.includes('--wipe')

const shared = {
  sections: [
    {
      title: 'How this works',
      lessons: [
        {
          kind: 'article',
          title: 'What you are actually selling',
          preview: true,
          body: `You are not selling a chance to earn. You are selling a product somebody wants, and you are paid a share of what they pay for it.

That distinction matters more than it sounds. Everything in this programme is built around it: commission comes from real sales of real products, the rates on training are deliberately LOWER than the rates on the products in the shop, and nobody is ever paid for signing somebody up on its own.

If you find yourself explaining this opportunity mainly in terms of recruiting other people, you have drifted away from what the programme is and towards something we do not run.

Two things you can always say honestly:

The products are real, and you can see exactly what they cost before anybody buys.

You are paid a percentage of money that actually changed hands.

Two things you must never say, because neither is true and both create problems for you as much as for us:

That anyone is guaranteed to earn anything.

That earnings are typical, average, or expected. You do not know what anybody else makes, and neither do we until they make it.`,
        },
        {
          kind: 'article',
          title: 'How your commission is calculated',
          body: `Your commission is a percentage of what the buyer ACTUALLY PAID. Not the list price.

This is worth understanding properly, because it is the single question most people get wrong.

If a product lists at GHS 200 and is on sale at GHS 150, and your rate is 30%, you earn 30% of 150 — which is GHS 45. Not 30% of 200.

The reason is simple: a percentage of the list price can pay out more commission than the sale actually brought in. That is not a business, it is a leak. So the rule is the amount charged, every time.

Two consequences follow from the same rule:

A sale reduces your commission along with the price. That is not the platform taking something from you — the buyer paid less, so there is less to share.

An upgrade pays on the difference, because the difference is what was charged. Somebody moving from Beginner to Professional pays the gap, and the commission is calculated on the gap.

Each product carries its own rate, and you can see it before you decide to promote anything.`,
        },
        {
          kind: 'quiz',
          title: 'Check what you have read',
          quiz: {
            title: 'Check what you have read',
            passPercent: 70,
            questions: [
              {
                prompt: 'A product lists at GHS 200, is on sale at GHS 150, and your rate is 30%. What do you earn?',
                options: [
                  { body: 'GHS 45 — thirty per cent of what was actually paid', isCorrect: true },
                  { body: 'GHS 60 — thirty per cent of the list price', isCorrect: false },
                  { body: 'GHS 50 — the difference between the two prices', isCorrect: false },
                ],
              },
              {
                prompt: 'Which of these can you honestly tell someone?',
                options: [
                  { body: 'You are paid a percentage of money that actually changed hands', isCorrect: true },
                  { body: 'Most people who join earn back the course fee in a month', isCorrect: false },
                  { body: 'Earnings are guaranteed once you have the training', isCorrect: false },
                ],
              },
            ],
          },
        },
      ],
    },
    {
      title: 'Getting your links out',
      lessons: [
        {
          kind: 'article',
          title: 'Your link, and how a sale finds its way back to you',
          body: `Every product you can promote has a link that belongs to you. When somebody opens it, we remember that it was yours.

That memory lasts THIRTY DAYS. If they buy within that window, the sale is credited to you even if they did not buy on the first visit — which most people do not.

Two details that decide real money:

LAST CLICK WINS. If somebody opens your link and then opens somebody else's before buying, the sale goes to the last link they used. Not the first. This cuts both ways, and it is why sending a link once and never mentioning it again tends not to work.

THE LINK REMEMBERS THE DEVICE AND THE ACCOUNT. Somebody can open your link while logged out, come back days later, sign in, and buy — and it still counts. You do not need them to buy in one sitting.

One thing that never counts: your own purchases through your own link. Buying your own training through your own link would be a discount funded by the programme, so it pays nothing.`,
        },
        {
          kind: 'article',
          title: 'What the platform gives you, and what you should not make',
          body: `All the marketing material comes from us. Images, wording, the descriptions of what each product does — you will find them ready to use.

This is not us being controlling about design. It is the one part of this programme where a mistake by one person creates a problem for everybody.

Marketing that somebody writes themselves is where income claims appear. "Make GHS 500 a week." "This paid for itself in ten days." Nobody sets out to write those; they appear because they are the easiest thing to say when you want somebody to click.

An income claim is the operator's problem regardless of who wrote it — and it is the fastest way to turn a programme that is defensible into one that is not.

So: use what you are given. If you want something that does not exist yet, ask for it rather than making it.`,
        },
      ],
    },
    {
      title: 'Getting paid',
      lessons: [
        {
          kind: 'article',
          title: 'When money becomes yours, and when it can go back',
          body: `Commission is credited when the sale is confirmed. There is no waiting period — it lands in your commission balance straight away.

You can withdraw once your balance reaches GHS 50. Withdrawals use the same methods and the same fee as the rest of the platform, and the fee is fixed at the moment you file the request, so it cannot change underneath you afterwards.

Now the part nobody enjoys reading, which you should read anyway.

A buyer can be refunded for up to fourteen days. If a sale you were paid for is refunded, the commission is taken back. Because there is no waiting period, it is possible for that to happen AFTER you have already withdrawn the money.

When that happens your balance goes below zero. Nothing is collected from you — nobody will ask you to send money back. What happens is that withdrawals pause until new commission brings the balance above zero again.

Your commission and your points from watching ads are completely separate. Two balances, two withdrawal requests, and they are never added together.`,
        },
        {
          kind: 'quiz',
          title: 'Before you start promoting',
          quiz: {
            title: 'Before you start promoting',
            passPercent: 70,
            questions: [
              {
                prompt: 'Somebody opens your link, then opens a friend\'s link for the same product, then buys. Who is paid?',
                options: [
                  { body: 'The friend — the last link used before buying', isCorrect: true },
                  { body: 'You — the first link they opened', isCorrect: false },
                  { body: 'Both of you, split evenly', isCorrect: false },
                ],
              },
              {
                prompt: 'A sale you were paid for is refunded after you already withdrew the money. What happens?',
                options: [
                  { body: 'Your balance goes below zero and withdrawals pause until it recovers', isCorrect: true },
                  { body: 'You are invoiced for the difference', isCorrect: false },
                  { body: 'Nothing — commission is final once withdrawn', isCorrect: false },
                ],
              },
              {
                prompt: 'Where should your marketing images and wording come from?',
                options: [
                  { body: 'The platform — all creatives are supplied', isCorrect: true },
                  { body: 'Whatever performs best on your own social media', isCorrect: false },
                  { body: 'Other affiliates who are doing well', isCorrect: false },
                ],
              },
            ],
          },
        },
      ],
    },
  ],
}

/* Professional buys one extra section: the second commission level. */
const professionalExtra = {
  title: 'The second level',
  lessons: [
    {
      kind: 'article',
      title: 'How the second level actually works',
      body: `Professional pays you on two levels.

Level one is your own sales — somebody buys through your link, you are paid.

Level two is sales made by affiliates you brought in. If somebody joins through your link and later sells something, you earn on that too.

Both levels are a percentage of the SAME figure: what the buyer paid. Level two is not carved out of level one, and it does not reduce what the level-one affiliate earns. Their commission is untouched by yours.

There are exactly two levels. Not three, and not "two for now". There is no third level anywhere in the system to switch on — it is a structural limit, not a setting, and it is deliberate.

The level-two rate is lower than the level-one rate, always. That is also deliberate: this programme is meant to reward selling more than it rewards recruiting, and the numbers are set so that selling is the better use of your time.`,
    },
    {
      kind: 'article',
      title: 'What never pays, and why you should be glad',
      body: `Some things earn nothing, at either level. It is worth knowing which, so you are not counting on money that is not coming.

RENEWALS PAY NOBODY. When somebody renews their training a year later, no commission is paid to anyone. You are paid for bringing somebody in, once — not every year afterwards for the same introduction.

If that sounds like it is against your interests, consider what the alternative looks like. Being paid every year, forever, for one recruitment is the definition of residual recruitment income, and it is precisely the feature that makes regulators treat a programme as a pyramid scheme rather than a sales business. It is left out on purpose, and it is part of why this programme can operate openly.

UPGRADES PAY THE UPLINE, NOT THE LAST LINK. If somebody you brought in upgrades from Beginner to Professional, you are paid — not whoever's link they happened to click that week. An upgrade needs no link at all, so crediting it by last click would let somebody move your commission by sending a message.

AND YOUR OWN PURCHASES PAY NOTHING, at either level.`,
    },
    {
      kind: 'quiz',
      title: 'The second level',
      quiz: {
        title: 'The second level',
        passPercent: 70,
        questions: [
          {
            prompt: 'You earn on level two from a sale. What happens to the level-one affiliate\'s commission?',
            options: [
              { body: 'Nothing — both levels are a percentage of the same amount', isCorrect: true },
              { body: 'It is reduced by what you earn', isCorrect: false },
              { body: 'It is split between you', isCorrect: false },
            ],
          },
          {
            prompt: 'Somebody you introduced renews their training a year later. What do you earn?',
            options: [
              { body: 'Nothing — renewals pay nobody, at any level', isCorrect: true },
              { body: 'The same commission as their first purchase', isCorrect: false },
              { body: 'A reduced renewal rate', isCorrect: false },
            ],
          },
          {
            prompt: 'How many commission levels does this programme have?',
            options: [
              { body: 'Two, and a third is not possible in the system', isCorrect: true },
              { body: 'Two now, with more planned', isCorrect: false },
              { body: 'As many as your downline is deep', isCorrect: false },
            ],
          },
        ],
      },
    },
  ],
}

const COURSES = [
  { slug: 'affiliate-training-beginner', sections: shared.sections },
  { slug: 'affiliate-training-professional', sections: [...shared.sections, professionalExtra] },
]

const c = new Client({ connectionString: process.env.SUPABASE_DB_URL })
await c.connect()

try {
  const { rows: admin } = await c.query(
    `select user_id from public.user_roles where role = 'super_admin' limit 1`,
  )
  if (!admin[0]) throw new Error('No super admin to attribute this to.')

  await c.query('begin')

  for (const course of COURSES) {
    const { rows: product } = await c.query(
      `select id, title from public.products where slug = $1`,
      [course.slug],
    )
    if (!product[0]) {
      console.log(`skipped — no product with slug ${course.slug}`)
      continue
    }
    const productId = product[0].id

    // Always start clean, so re-running does not stack duplicates.
    await c.query(`delete from public.course_sections where product_id = $1`, [productId])
    if (WIPE) {
      console.log(`wiped ${product[0].title}`)
      continue
    }

    let sectionPosition = 0
    let lessonsWritten = 0

    for (const section of course.sections) {
      const { rows: sec } = await c.query(
        `insert into public.course_sections (product_id, title, position)
         values ($1, $2, $3) returning id`,
        [productId, section.title, sectionPosition++],
      )

      let lessonPosition = 0
      for (const lesson of section.lessons) {
        const { rows: les } = await c.query(
          `insert into public.lessons
             (section_id, title, position, kind, body, is_preview, duration_seconds)
           values ($1, $2, $3, $4::public.lesson_kind, $5, $6, 0) returning id`,
          [
            sec[0].id,
            lesson.title,
            lessonPosition++,
            lesson.kind,
            lesson.kind === 'article' ? lesson.body : null,
            Boolean(lesson.preview),
          ],
        )
        lessonsWritten += 1

        if (lesson.quiz) {
          const { rows: quiz } = await c.query(
            `insert into public.quizzes (lesson_id, title, at_seconds, pass_percent, position)
             values ($1, $2, null, $3, 0) returning id`,
            [les[0].id, lesson.quiz.title, lesson.quiz.passPercent],
          )
          let questionPosition = 0
          for (const question of lesson.quiz.questions) {
            const { rows: q } = await c.query(
              `insert into public.quiz_questions (quiz_id, position, prompt)
               values ($1, $2, $3) returning id`,
              [quiz[0].id, questionPosition++, question.prompt],
            )
            let optionPosition = 0
            for (const option of question.options) {
              await c.query(
                `insert into public.quiz_options (question_id, position, body, is_correct)
                 values ($1, $2, $3, $4)`,
                [q[0].id, optionPosition++, option.body, option.isCorrect],
              )
            }
          }
        }
      }
    }

    const { rows: blockers } = await c.query(
      `select count(*)::int as n, min(problem) as first
         from public.product_publish_blockers($1)`,
      [productId],
    )
    console.log(
      `${product[0].title}: ${course.sections.length} sections, ${lessonsWritten} lessons, ` +
        `${blockers[0].n} publish blocker(s)${blockers[0].first ? ` — ${blockers[0].first}` : ''}`,
    )
  }

  await c.query('commit')
} catch (error) {
  await c.query('rollback').catch(() => {})
  console.error('FAILED:', error.message)
  process.exitCode = 1
} finally {
  await c.end()
}
