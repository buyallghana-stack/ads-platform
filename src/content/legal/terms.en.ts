import { businessDetails, LEGAL_ENTITY, type LegalDoc } from './types'

const CONTACT = LEGAL_ENTITY.contactEmail

/**
 * Terms of Service — English.
 *
 * Written in plain language on purpose. The conventions here follow what
 * established rewards platforms (Swagbucks, InboxDollars and similar) settled
 * on after years of disputes: points are a revocable licence rather than
 * money, earnings can be reversed when the activity behind them was not
 * genuine, one account per person, and payouts are conditional on
 * verification. Those clauses exist because each is a real failure mode of a
 * paid-to-view product, not as boilerplate.
 *
 * 2026-07-30 revision. The 2026-07-25 wording described a product that has
 * since grown four earning routes it did not mention — tasks, reward games,
 * gift codes and a referral commission on plan purchases — and a lawyer is
 * about to review this document against the live app. Sections 5 to 8 and 12
 * are new; 13 and 14 changed. Two rules govern the new wording:
 *
 *  1. The reward-games section states the facts the lawyer's opinion of
 *     2026-07-30 relies on (plays are included with a plan, cannot be bought,
 *     nothing is staked, every outcome pays). Those facts are what keep the
 *     feature outside the Gaming Act, 2006 (Act 721). If the product ever
 *     charges for a play, this section becomes false BEFORE it becomes
 *     unlawful — treat it as a tripwire, not decoration.
 *  2. The referral section describes exactly the depth the code pays, and
 *     never the depth that is merely permitted. A document promising money
 *     the code does not pay is the worse mistake of the two.
 *
 * 2026-07-31 revision, section 12 only. The operator reports that the lawyer
 * has approved a two-level programme and it has been built (migration 083), so
 * "rewards are one level deep" became false the moment that shipped. The
 * section now says two levels, says that a third is not reachable by any
 * setting, and states that the two levels of a purchase commission together
 * cannot exceed the purchase — all three are properties the code enforces, not
 * intentions. Second-level rates ship at zero.
 *
 * Anchor ids are unchanged from the previous version even where the heading
 * numbers moved, so existing links keep working.
 */
export const termsEn: LegalDoc = {
  title: 'Terms of Service',
  updated: '2026-07-31',
  summary:
    'These terms explain how SidePerks works, what we expect from you, and what you can expect from us. Please read them before you start earning.',
  sections: [
    {
      id: 'agreement',
      heading: '1. Your agreement with us',
      blocks: [
        {
          kind: 'p',
          text: `These Terms of Service ("Terms") are an agreement between you and ${LEGAL_ENTITY.product} ("we", "us", "our"). They apply every time you use our website, our app, or any part of our service.`,
        },
        {
          kind: 'p',
          text: 'By creating an account or using the service, you accept these Terms. If you do not accept them, please do not use SidePerks.',
        },
        {
          kind: 'p',
          text: 'Our Privacy Policy explains how we handle your personal information and forms part of this agreement.',
        },
        {
          kind: 'p',
          text: 'Section 23 sets out who we are and how to reach us, so you know who you are contracting with.',
        },
      ],
    },
    {
      id: 'eligibility',
      heading: '2. Who can use SidePerks',
      blocks: [
        { kind: 'p', text: 'To open and keep an account you must:' },
        {
          kind: 'list',
          items: [
            'be at least 18 years old;',
            `be resident in ${LEGAL_ENTITY.country}, which is currently the only country we serve;`,
            'register using your own accurate name, email address and phone number;',
            'hold one account only, and use it only for yourself.',
          ],
        },
        {
          kind: 'p',
          text: 'One person may hold one account. Households sharing a device may contact support before registering, so we can avoid mistaking honest use for duplicate accounts.',
        },
      ],
    },
    {
      id: 'account',
      heading: '3. Your account and its security',
      blocks: [
        {
          kind: 'p',
          text: 'You are responsible for what happens on your account. Keep your password private, and do not let anyone else sign in as you.',
        },
        {
          kind: 'p',
          text: 'We give you tools to protect yourself: a withdrawal PIN, two-factor authentication using an authenticator app, backup codes, and a list of the devices where you are signed in. We strongly recommend turning on two-factor authentication before you build up a balance.',
        },
        {
          kind: 'p',
          text: 'Tell us immediately if you think someone else has access to your account. We may suspend an account while we investigate a report of this kind.',
        },
      ],
    },
    {
      id: 'earning',
      heading: '4. How earning works',
      blocks: [
        {
          kind: 'p',
          text: 'You earn points by watching advertisements through SidePerks and answering the attention question that follows, and by completing surveys where they are offered. Points are credited once the activity is completed and the answer is accepted.',
        },
        {
          kind: 'p',
          text: 'Points can also reach your balance through the other features described below: tasks (section 5), reward games (section 6), gift codes (section 7) and referrals (section 12). Everything credited to your balance is points, and everything in section 9 applies to it however it was earned.',
        },
        {
          kind: 'p',
          text: 'How much you can earn each day depends on your plan. Ads and surveys are supplied by advertisers and research partners, so the number available to you on any given day varies, and we cannot promise a particular quantity, frequency or income.',
        },
        {
          kind: 'note',
          text: 'SidePerks is a way to earn small rewards in your spare time. It is not employment, not an investment, and not a guaranteed income.',
        },
      ],
    },
    {
      id: 'tasks',
      heading: '5. Tasks',
      blocks: [
        {
          kind: 'p',
          text: 'A task is an optional challenge with a target — for example, watching a number of ads, or keeping a daily streak. When your progress reaches the target, the reward becomes available for you to claim.',
        },
        {
          kind: 'p',
          text: 'Rewards are not paid automatically: you claim them, and each task can be claimed once per account. Progress is measured from the activity already recorded on your account, so a task may count activity you completed before that task appeared.',
        },
        {
          kind: 'p',
          text: 'We may add, change, pause or withdraw tasks at any time. A task withdrawn before you claim it pays nothing, and progress towards it is not compensated. If activity behind your progress is later reversed under section 10, your progress is reduced accordingly.',
        },
      ],
    },
    {
      id: 'games',
      heading: '6. Reward games',
      blocks: [
        {
          kind: 'p',
          text: 'Some plans include a number of plays each week on our reward games — currently a spin wheel and a mystery box. Plays are a benefit of the plan you already hold.',
        },
        {
          kind: 'p',
          text: 'You cannot buy plays, and you cannot stake points, money or anything else on a play. There is no separate fee to take part, nothing is wagered, and nothing is risked: every possible outcome awards a prize. Prizes are points or additional plays, and are subject to section 9.',
        },
        {
          kind: 'p',
          text: 'Each play is drawn on our servers, not on your device. The app only reveals the result that was already decided, so closing the app during an animation neither loses a prize nor produces a second one. We set which prizes are available, how many of each may be won in a day or a week, and how likely each is; we do not publish the relative chance of each prize.',
        },
        {
          kind: 'p',
          text: 'Plays are granted weekly and do not carry over. The number included with each plan may change, as may the prizes offered.',
        },
        {
          kind: 'note',
          text: 'Because plays come with a plan rather than being sold, and because nothing is paid, staked or risked for the chance of a prize, the reward games are a loyalty feature of the service. They are not a betting, gaming or lottery product, and we do not operate them as one.',
        },
      ],
    },
    {
      id: 'gift-codes',
      heading: '7. Gift codes',
      blocks: [
        {
          kind: 'p',
          text: 'We sometimes issue gift codes — for a promotion, a campaign, or to put right a problem raised through support. Entering a valid code credits the points it carries.',
        },
        {
          kind: 'p',
          text: 'A code can be used once, by one account. Codes may have an expiry date, may be limited in number, and may be withdrawn before they are used. A code is not property, has no cash value in itself, and may not be sold, bought or traded.',
        },
        {
          kind: 'p',
          text: 'We may reverse points from a code that was published in error, obtained from someone it was not issued to, or redeemed through automated guessing of codes.',
        },
      ],
    },
    {
      id: 'leaderboard',
      heading: '8. The leaderboard',
      blocks: [
        {
          kind: 'p',
          text: 'The leaderboard ranks users by the points they earned during a period, so people can see how they compare. Everyone who earns appears in it; there is currently no way to opt out, and if that matters to you, please contact us.',
        },
        {
          kind: 'p',
          text: 'Other signed-in users see your first name, the first initial of your surname, and your profile photo if you have uploaded one. They do not see your email address, your phone number, your balance or your payouts.',
        },
        {
          kind: 'p',
          text: 'Withdrawals and refunds do not affect a standing, and accounts under review may be excluded. Placing on the leaderboard carries recognition only — no prize or payment is attached to it.',
        },
      ],
    },
    {
      id: 'points',
      heading: '9. What points are',
      blocks: [
        {
          kind: 'p',
          text: 'Points are a reward we credit to your account under a limited, personal, revocable licence. They are not money, not a deposit, not legal tender and not your property. This is true of every point, whether it came from an ad, a survey, a task, a reward game, a gift code or a referral.',
        },
        { kind: 'p', text: 'This means points:' },
        {
          kind: 'list',
          items: [
            'have no cash value until they are redeemed through an approved payout;',
            'cannot be sold, transferred, gifted or combined with another person’s account;',
            'are shown alongside an indicative cash value, which is an estimate and not a promise of what you will receive;',
            'are forfeited if your account is closed or terminated.',
          ],
        },
        {
          kind: 'p',
          text: 'We may introduce an inactivity period after which unredeemed points expire. If we do, we will tell you in advance and give you a reasonable chance to redeem.',
        },
      ],
    },
    {
      id: 'verification',
      heading: '10. Verification, corrections and reversals',
      blocks: [
        {
          kind: 'p',
          text: 'Advertisers pay for genuine attention. We therefore check that activity on the service is real, using signals such as the device and browser you use, your network address, and patterns in how ads are watched and answered.',
        },
        {
          kind: 'p',
          text: 'If points were credited in error, or for activity that turns out not to be genuine, we may correct or reverse them, including after they appear in your balance. This applies to points from any source, including task rewards, game prizes, gift codes and referral rewards. Where a reversal affects a payout you have requested, we may pause or decline that payout.',
        },
        {
          kind: 'p',
          text: 'If you believe a correction was wrong, contact us and we will look at it again. A person reviews any decision you ask us to reconsider.',
        },
      ],
    },
    {
      id: 'prohibited',
      heading: '11. Things you must not do',
      blocks: [
        { kind: 'p', text: 'You must not:' },
        {
          kind: 'list',
          items: [
            'open or control more than one account, including through friends, family or paid signups;',
            'use bots, scripts, automation, emulators, modified apps or any tool that watches ads, answers questions, completes tasks or plays reward games for you;',
            'hide or misrepresent where you are, for example with a VPN, proxy or location spoofing;',
            'play ads without watching them, including muting, backgrounding or running several at once to farm points;',
            'interfere with the ad player, the attention questions, the reward games, or any security or fraud check;',
            'attempt to guess, generate or redeem gift codes that were not issued to you;',
            'create referrals that are not real people, or reward people for signing up on your behalf;',
            'sell, buy, rent or share accounts;',
            'copy, scrape or republish our content, or attempt to access parts of the service you are not entitled to.',
          ],
        },
        {
          kind: 'p',
          text: 'Breaking these rules can lead to reversal of points, suspension, or permanent closure of your account.',
        },
      ],
    },
    {
      id: 'referrals',
      heading: '12. Referrals',
      blocks: [
        {
          kind: 'p',
          text: 'You may invite other people using your referral link or code. Where a referral reward applies, it is paid to the people who introduced them — the person who invited them, and, at a lower rate, whoever invited that person. It is never charged to the person invited. Nobody pays anything to refer or to be referred.',
        },
        { kind: 'p', text: 'A referral can pay a reward at up to three moments:' },
        {
          kind: 'list',
          items: [
            'when the person you invited creates an account using your code;',
            'when they become active by completing the activity condition shown in the app at the time;',
            'when they buy a plan — a commission calculated as a percentage of what they paid, subject to a limit per person you invited.',
          ],
        },
        {
          kind: 'p',
          text: 'The amounts, conditions and limits are those shown in the app at the time, and we may change them. Some of them may be set to zero, in which case that reward is not paid at all.',
        },
        {
          kind: 'p',
          text: 'Referral rewards go at most two levels deep. You may be rewarded for the people you invited yourself, and, at a separate rate, for the people they in turn invite. That is where it stops: we do not pay you anything for a third level or beyond, and no setting anywhere in the service can extend it — the limit is built into how the reward is calculated, not into a preference.',
        },
        {
          kind: 'p',
          text: 'A second-level reward is paid out of the same event as the first, never in addition to the value of it: where the reward is a commission on a purchase, the first and second levels together can never exceed what was actually paid for that purchase. Second-level rates may be set to zero, and are, unless the app shows otherwise.',
        },
        {
          kind: 'p',
          text: 'Your earnings on SidePerks come from using the service and from introducing customers to it, not from building a network of recruits. Nothing is charged to refer or to be referred, no reward depends on how many levels of people you assemble, and we do not operate an earnings plan of any other kind.',
        },
        {
          kind: 'p',
          text: 'The Team screen shows you both levels openly. For each person it shows their name, their phone number, which plans they hold, how much has been paid out to them and how much their remaining balance is worth — in cedis, not points, so you can check it against what you know a cedi is worth. We show it because you are entitled to see what the introductions you are being rewarded for actually amount to, rather than taking our word for a total.',
        },
        {
          kind: 'note',
          text: 'This works both ways, and you should assume it does: whoever invited you, and whoever invited them, see exactly the same information about you. Section 5 of the Privacy Policy lists it field by field, including what they cannot see. If that is not acceptable to you, do not join using somebody’s referral code.',
        },
        {
          kind: 'p',
          text: 'We do not pay referral rewards for accounts you control yourself, for people who never use the service, or for signups obtained by spam or by misleading claims about earnings. We may reverse a referral reward, including a purchase commission, if the payment behind it is refunded or reversed, or if the account turns out not to be genuine.',
        },
      ],
    },
    {
      id: 'plans',
      heading: '13. Plans and payments',
      blocks: [
        {
          kind: 'p',
          text: 'Some plans raise your daily earning limit or add other benefits, such as a higher reward multiplier or weekly plays on the reward games. The price, duration and benefits are shown before you pay, and are what apply to your purchase.',
        },
        {
          kind: 'p',
          text: 'You may hold more than one plan at a time, but only one of each. Where you hold several, their benefits add up, within any overall limits shown in the app.',
        },
        {
          kind: 'note',
          text: 'A plan buys you access to the service on better terms. It is not a purchase of points, and it is not a purchase of a chance to win anything.',
        },
        {
          kind: 'p',
          text: 'Payments are handled by our payment providers. We do not receive or store your full card details.',
        },
        {
          kind: 'p',
          text: 'Because a plan gives you access immediately, payments are generally non-refundable except where the law requires otherwise, or where we did not deliver the benefit you paid for. If a plan is cancelled or an account is closed for breaking these Terms, no refund is due.',
        },
      ],
    },
    {
      id: 'payouts',
      heading: '14. Withdrawals and payouts',
      blocks: [
        {
          kind: 'p',
          text: 'You may request a payout once your balance reaches the minimum shown in the app. Payouts are made to a mobile money account or a cryptocurrency wallet that you have set up and that belongs to you.',
        },
        {
          kind: 'p',
          text: 'Payout requests are reviewed before they are paid. We may ask you to verify your identity or your payout details, and we may hold, decline or reverse a request where there are signs of fraud, where the details do not appear to belong to you, or where we are required to by law.',
        },
        {
          kind: 'p',
          text: 'For security, changing your payout details starts a short waiting period before a payout can be made to the new destination.',
        },
        {
          kind: 'note',
          text: `Cryptocurrency payouts carry exchange-rate risk. When you request one, we convert the amount using the exchange rate we hold at that moment and fix the quantity of cryptocurrency on your request, so the figure you are shown is the figure we send. If no reliable rate is available when you request it, the quantity is calculated when the payout is processed instead. What you are owed is the cedi value of your points; the amount of cryptocurrency that value buys can move in the meantime.`,
        },
        {
          kind: 'p',
          text: 'Payouts depend on the licences and payment arrangements we hold. Where payouts are not yet available, this is stated in the app; points continue to accrue and may be redeemed once payouts open.',
        },
      ],
    },
    {
      id: 'suspension',
      heading: '15. Flagging, suspension and closure',
      blocks: [
        {
          kind: 'p',
          text: 'We may flag an account for review, suspend it, or close it if we reasonably believe these Terms have been broken, if we are required to by law, or to protect other users, advertisers or the service.',
        },
        {
          kind: 'p',
          text: 'A flag is a warning that we are looking at something and usually does not stop you using SidePerks. We will tell you the reason where we are able to, and you can reply through support.',
        },
        {
          kind: 'p',
          text: 'If an account is closed for breaking these Terms, unredeemed points are forfeited and pending payouts may be cancelled.',
        },
      ],
    },
    {
      id: 'closing',
      heading: '16. Closing your own account',
      blocks: [
        {
          kind: 'p',
          text: 'You can ask us to delete your account at any time from Profile → Delete account. Deletion does not happen straight away: your account is scheduled for deletion 15 days later, and simply signing in again during that time cancels the request.',
        },
        {
          kind: 'p',
          text: 'When deletion completes it is permanent. Unredeemed points are forfeited, and the email address and phone number on the account can no longer be used to open a new one. Withdraw what you can before you confirm.',
        },
        {
          kind: 'p',
          text: 'We keep the records we are required to keep, such as transaction history. Our Privacy Policy explains this in detail.',
        },
      ],
    },
    {
      id: 'availability',
      heading: '17. Changes to the service',
      blocks: [
        {
          kind: 'p',
          text: 'We are still building SidePerks, and we may add, change or remove features, plans, earning rates, limits, tasks, games and payout options. Where a change materially reduces what you already have, we will give you reasonable notice.',
        },
        {
          kind: 'p',
          text: 'We do not promise the service will always be available or uninterrupted. Maintenance, technical faults and problems at our suppliers can all interrupt it.',
        },
      ],
    },
    {
      id: 'ip',
      heading: '18. Our content and yours',
      blocks: [
        {
          kind: 'p',
          text: 'The SidePerks name, logo, design and software belong to us or our licensors. The advertisements belong to the advertisers. You may use them only as part of using the service normally.',
        },
        {
          kind: 'p',
          text: 'Anything you send us, such as a support message or feedback, stays yours; you allow us to use it to run and improve the service.',
        },
      ],
    },
    {
      id: 'liability',
      heading: '19. Disclaimers and our liability',
      blocks: [
        {
          kind: 'p',
          text: 'The service is provided as it is. We do not promise that it will be error-free, that ads will always be available, or that you will earn any particular amount.',
        },
        {
          kind: 'p',
          text: 'Nothing in these Terms limits liability that cannot be limited by law, including for fraud or for death or personal injury caused by negligence.',
        },
        {
          kind: 'p',
          text: 'Subject to that, we are not liable for indirect or consequential loss, or for loss of profits, income or expected earnings. Our total liability to you for any claim is limited to the greater of the value of the payouts we have made to you in the six months before the claim, or GHS 500.',
        },
      ],
    },
    {
      id: 'indemnity',
      heading: '20. Your responsibility to us',
      blocks: [
        {
          kind: 'p',
          text: 'If someone brings a claim against us because of how you used the service or because you broke these Terms, you agree to cover the reasonable costs and damages that result.',
        },
      ],
    },
    {
      id: 'changes',
      heading: '21. Changes to these Terms',
      blocks: [
        {
          kind: 'p',
          text: 'We may update these Terms. When we make an important change we will notify you in the app or by email before it takes effect. The date at the top shows when this version was published.',
        },
        {
          kind: 'p',
          text: 'If you continue using SidePerks after a change takes effect, you accept the updated Terms. If you do not accept them, you can close your account.',
        },
      ],
    },
    {
      id: 'law',
      heading: '22. Law and disputes',
      blocks: [
        {
          kind: 'p',
          text: `These Terms are governed by the laws of ${LEGAL_ENTITY.country}, and the courts of ${LEGAL_ENTITY.country} have jurisdiction over any dispute.`,
        },
        {
          kind: 'p',
          text: `Please contact us first at ${CONTACT}. Most problems are quicker to fix directly, and we would rather resolve a complaint than argue about it.`,
        },
      ],
    },
    {
      id: 'contact',
      heading: '23. Who we are and how to reach us',
      blocks: [
        { kind: 'p', text: 'SidePerks is operated by:' },
        { kind: 'list', items: businessDetails() },
        {
          kind: 'p',
          text: `You can contact us at ${CONTACT}, or through support inside the app. We aim to reply within a few working days.`,
        },
      ],
    },
  ],
}
