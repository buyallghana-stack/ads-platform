import { LEGAL_ENTITY, type LegalDoc } from './types'

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
 */
export const termsEn: LegalDoc = {
  title: 'Terms of Service',
  updated: '2026-07-25',
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
          text: 'You earn points by watching advertisements through SidePerks and answering the attention question that follows. Points are credited once an ad is completed and the answer is accepted.',
        },
        {
          kind: 'p',
          text: 'How much you can earn each day depends on your plan. Ads are supplied by advertisers, so the number available to you on any given day varies, and we cannot promise a particular quantity, frequency or income.',
        },
        {
          kind: 'note',
          text: 'SidePerks is a way to earn small rewards in your spare time. It is not employment, not an investment, and not a guaranteed income.',
        },
      ],
    },
    {
      id: 'points',
      heading: '5. What points are',
      blocks: [
        {
          kind: 'p',
          text: 'Points are a reward we credit to your account under a limited, personal, revocable licence. They are not money, not a deposit, not legal tender and not your property.',
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
      heading: '6. Verification, corrections and reversals',
      blocks: [
        {
          kind: 'p',
          text: 'Advertisers pay for genuine attention. We therefore check that activity on the service is real, using signals such as the device and browser you use, your network address, and patterns in how ads are watched and answered.',
        },
        {
          kind: 'p',
          text: 'If points were credited in error, or for activity that turns out not to be genuine, we may correct or reverse them, including after they appear in your balance. Where a reversal affects a payout you have requested, we may pause or decline that payout.',
        },
        {
          kind: 'p',
          text: 'If you believe a correction was wrong, contact us and we will look at it again. A person reviews any decision you ask us to reconsider.',
        },
      ],
    },
    {
      id: 'prohibited',
      heading: '7. Things you must not do',
      blocks: [
        { kind: 'p', text: 'You must not:' },
        {
          kind: 'list',
          items: [
            'open or control more than one account, including through friends, family or paid signups;',
            'use bots, scripts, automation, emulators, modified apps or any tool that watches ads or answers questions for you;',
            'hide or misrepresent where you are, for example with a VPN, proxy or location spoofing;',
            'play ads without watching them, including muting, backgrounding or running several at once to farm points;',
            'interfere with the ad player, the attention questions, or any security or fraud check;',
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
      heading: '8. Referrals',
      blocks: [
        {
          kind: 'p',
          text: 'You may invite other people using your referral link. Referral rewards are credited only when the person you invited is a genuine new user who meets the activity conditions shown in the app at the time.',
        },
        {
          kind: 'p',
          text: 'We do not pay referral rewards for accounts you control yourself, for people who never use the service, or for signups obtained by spam or misleading claims about earnings.',
        },
      ],
    },
    {
      id: 'plans',
      heading: '9. Plans and payments',
      blocks: [
        {
          kind: 'p',
          text: 'Some plans raise your daily earning limit or add other benefits. The price, duration and benefits are shown before you pay, and are what apply to your purchase.',
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
      heading: '10. Withdrawals and payouts',
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
          text: 'Cryptocurrency payouts carry exchange-rate risk. The amount of cryptocurrency you receive is calculated at the time of disbursement, not at the time you request it, and the value can move in between.',
        },
        {
          kind: 'p',
          text: 'Payouts depend on the licences and payment arrangements we hold. Where payouts are not yet available, this is stated in the app; points continue to accrue and may be redeemed once payouts open.',
        },
      ],
    },
    {
      id: 'suspension',
      heading: '11. Flagging, suspension and closure',
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
      heading: '12. Closing your own account',
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
      heading: '13. Changes to the service',
      blocks: [
        {
          kind: 'p',
          text: 'We are still building SidePerks, and we may add, change or remove features, plans, earning rates, limits and payout options. Where a change materially reduces what you already have, we will give you reasonable notice.',
        },
        {
          kind: 'p',
          text: 'We do not promise the service will always be available or uninterrupted. Maintenance, technical faults and problems at our suppliers can all interrupt it.',
        },
      ],
    },
    {
      id: 'ip',
      heading: '14. Our content and yours',
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
      heading: '15. Disclaimers and our liability',
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
      heading: '16. Your responsibility to us',
      blocks: [
        {
          kind: 'p',
          text: 'If someone brings a claim against us because of how you used the service or because you broke these Terms, you agree to cover the reasonable costs and damages that result.',
        },
      ],
    },
    {
      id: 'changes',
      heading: '17. Changes to these Terms',
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
      heading: '18. Law and disputes',
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
      heading: '19. How to reach us',
      blocks: [
        {
          kind: 'p',
          text: `You can contact us at ${CONTACT}. We aim to reply within a few working days.`,
        },
      ],
    },
  ],
}
