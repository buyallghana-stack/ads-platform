import { businessDetails, LEGAL_ENTITY, type LegalDoc } from './types'

const CONTACT = LEGAL_ENTITY.contactEmail

/**
 * Privacy Policy — English.
 *
 * Describes only what the product actually does. That is a deliberate
 * constraint: a policy claiming protections we have not built, or omitting
 * processing we do perform, is worse than no policy, because it is the
 * document a regulator reads back to us. Where something is not built yet it
 * is described as not yet in use rather than promised.
 *
 * 2026-07-30 revision, alongside the Terms. Three kinds of processing had
 * appeared in the product since 2026-07-25 and were absent here: task progress
 * and claims, reward-game plays and prizes, and gift-code redemptions. The
 * fourth addition matters more than those — section 5 is new and discloses
 * that the LEADERBOARD SHOWS YOUR NAME AND PHOTO TO OTHER USERS, with no
 * opt-out. That is a disclosure to other data subjects, which the previous
 * version made nowhere, and the absence of an opt-out is stated plainly rather
 * than papered over.
 */
export const privacyEn: LegalDoc = {
  title: 'Privacy Policy',
  updated: '2026-07-30',
  summary:
    'This policy explains what personal information SidePerks collects, why we need it, who we share it with, and the control you have over it.',
  sections: [
    {
      id: 'who',
      heading: '1. Who this policy covers',
      blocks: [
        {
          kind: 'p',
          text: `${LEGAL_ENTITY.product} ("we", "us") is the controller of the personal information described here. This policy applies to our website, our app and everything you do through them. Section 14 identifies us and tells you how to get in touch.`,
        },
        {
          kind: 'p',
          text: `We handle personal information in line with the Data Protection Act, 2012 (Act 843) of ${LEGAL_ENTITY.country}. Where the European General Data Protection Regulation applies to you, we apply it too.`,
        },
      ],
    },
    {
      id: 'collect',
      heading: '2. What we collect',
      blocks: [
        { kind: 'p', text: 'Information you give us:' },
        {
          kind: 'list',
          items: [
            'your name, email address and phone number;',
            'your password, which we never store — only a one-way hash of it;',
            'your payout details: your mobile money number and account name, or your cryptocurrency wallet address and network;',
            'your withdrawal PIN, stored only as a one-way hash;',
            'if you turn on two-factor authentication, your authenticator secret, stored encrypted, and one-way hashes of your backup codes;',
            'a profile photo, if you upload one;',
            'anything you write to us in a support conversation, which we keep as a thread so we can follow it up.',
          ],
        },
        { kind: 'p', text: 'Information we collect automatically when you use the service:' },
        {
          kind: 'list',
          items: [
            'which advertisements and surveys you completed, when, how far through, and how you answered the attention question;',
            'your points, transactions, payout requests and plan history;',
            'your progress towards tasks, and which task rewards you have claimed;',
            'the reward-game plays you have used and the prizes they produced;',
            'the gift codes you have redeemed;',
            'your standing on the leaderboard for each period, and the notifications we have sent you and whether you have read them;',
            'your device and browser type, and the network address you connect from, together with the approximate country it indicates;',
            'a record of your sign-ins and the devices where your account is signed in;',
            'referral information, such as the code used when an account was created, and — if you invited someone who then bought a plan — the fact of that purchase and the commission it earned you.',
          ],
        },
        { kind: 'p', text: 'Information from others: confirmation from payment and payout providers that a payment or disbursement succeeded or failed.' },
        {
          kind: 'p',
          text: 'A device signature: when you register or sign in, your browser calculates a short code from general characteristics of your device and browser — things like screen size, language, time zone and the fonts available. It is a one-way code, not a name, and it is calculated on your device: the characteristics themselves are never sent to us, only the code. We use it for one purpose, described in section 4.',
        },
        {
          kind: 'p',
          text: 'A bot check: to stop automated sign-ups we may show a challenge from Cloudflare Turnstile. Cloudflare receives your IP address and basic request information in order to answer it.',
        },
        {
          kind: 'note',
          text: 'We do not collect your full card details, and we do not ask for your mobile money PIN or your wallet’s private keys. Nobody legitimate will ever ask you for those.',
        },
      ],
    },
    {
      id: 'why',
      heading: '3. Why we use it, and on what basis',
      blocks: [
        {
          kind: 'list',
          items: [
            'To run your account and pay you — we cannot provide the service or send a payout without it. Basis: performance of our contract with you.',
            'To run the features you use — crediting ads and surveys, measuring progress towards tasks, awarding and recording reward-game prizes, applying gift codes, and building the leaderboard. Basis: performance of our contract with you.',
            'To confirm that ad views are genuine and to prevent fraud, multiple accounts and abuse. Basis: our legitimate interest in protecting the service, advertisers and honest users.',
            'To keep the service secure, including sign-in records and the security features you switch on. Basis: legitimate interest and, for some records, legal obligation.',
            'To meet legal, tax and accounting duties, including keeping records of money moved. Basis: legal obligation.',
            'To send you service notifications — a payout decision, a message from support, an announcement. Basis: performance of our contract and legitimate interest.',
            'To answer your support messages. Basis: performance of our contract and legitimate interest.',
            'To improve the service and understand which features are used. Basis: legitimate interest.',
          ],
        },
        {
          kind: 'p',
          text: 'We do not use your personal information to build advertising profiles about you, and we do not sell it.',
        },
      ],
    },
    {
      id: 'fraud',
      heading: '4. Automated checks',
      blocks: [
        {
          kind: 'p',
          text: 'We run automated checks on activity — for example, signals about the device and network used, and patterns in how ads are watched and answered. These checks can result in points being reversed, an account being flagged for review, or a payout being held.',
        },
        {
          kind: 'p',
          text: 'The device signature described in section 2 is used only to notice when one device is behind several accounts, or when somebody refers themselves. It is not used to track you across other websites, it is not shared, and it is not used to decide what you see.',
        },
        {
          kind: 'note',
          text: 'No decision that matters is made by a machine alone. An automated check can flag an account or hold a payout; a person decides what happens next, and you can ask us to look again.',
        },
        {
          kind: 'p',
          text: 'You can ask us to look again at any decision that affects you, and a person will review it. Contact us using the details at the end of this policy.',
        },
      ],
    },
    {
      id: 'visible',
      heading: '5. What other users can see',
      blocks: [
        {
          kind: 'p',
          text: 'Most of what we hold about you is visible only to you and to our staff. Two features show something to other people, and you should know about both before you use the service.',
        },
        {
          kind: 'p',
          text: 'The leaderboard shows other signed-in users your first name, the first initial of your surname, and your profile photo if you have uploaded one, next to the points you earned in the period. It does not show your email address, your phone number, your balance, your payouts or your full surname. Everyone who earns points appears, and there is currently no setting to hide yourself. If you would prefer not to appear, contact us and we will remove you.',
        },
        {
          kind: 'p',
          text: 'Referrals show the person who invited you that their invitation was used, and whether the conditions for a reward were met. They do not see your balance, your activity or your contact details.',
        },
        {
          kind: 'p',
          text: 'If you would rather not appear under your own name, you can change the name on your account in Profile → Personal information, subject to section 2 of the Terms, which asks you to register under your own accurate name.',
        },
      ],
    },
    {
      id: 'sharing',
      heading: '6. Who we share it with',
      blocks: [
        {
          kind: 'list',
          items: [
            'Payment and payout providers, so that money can reach you. They receive only what is needed to make the payment.',
            'Advertisers and advertising partners, in aggregate — how many people watched an ad and how it performed. They do not receive your name, email or phone number.',
            'Technology providers that host and run the service for us, including our database, hosting and email providers, under contracts that limit them to acting on our instructions.',
            'Exchange-rate providers, which tell us the price of a cryptocurrency so a payout can be quoted. They are asked for a price and receive nothing about you.',
            'An error-monitoring provider, which receives a report when something breaks — the page it happened on, the error, and the make of browser. It is configured NOT to receive your address, your cookies or your session, and sign-in links have their token removed before the report is sent.',
            'Authorities and regulators, where the law requires it or to establish or defend legal claims.',
            'A buyer or successor, if the business is ever sold or reorganised. We would tell you first.',
          ],
        },
        {
          kind: 'p',
          text: 'Some advertisements are shown through embedded video players operated by third parties. When one is used, that provider may set its own cookies and receive your network address as part of delivering the video.',
        },
      ],
    },
    {
      id: 'where',
      heading: '7. Where your information is held',
      blocks: [
        {
          kind: 'p',
          text: 'Our database and servers are hosted in the European Union (Paris region). This means your information is transferred outside Ghana and stored in a jurisdiction with strong data-protection rules.',
        },
        {
          kind: 'p',
          text: 'Where information moves between countries, we rely on the safeguards our providers have in place, including standard contractual clauses.',
        },
      ],
    },
    {
      id: 'retention',
      heading: '8. How long we keep it',
      blocks: [
        {
          kind: 'list',
          items: [
            'Account information: while your account is open.',
            'If you ask us to delete your account: 15 days, during which signing in cancels the request. After that the deletion is carried out.',
            'Transaction records — points earned, payouts and plan payments: kept after deletion for as long as tax, accounting and anti-fraud law requires. These records are anonymised, so they can no longer be linked back to you by name.',
            'A one-way hash of the email address and phone number of a deleted account: kept indefinitely, so the same details cannot be used to open a new account. A hash cannot be turned back into your email or phone number.',
            'Security and sign-in records: a limited period, so we can investigate suspicious activity.',
            'Leaderboard standings for past periods: kept as part of the record of points earned, and shown without your details once your account is deleted.',
          ],
        },
      ],
    },
    {
      id: 'rights',
      heading: '9. Your rights',
      blocks: [
        { kind: 'p', text: 'You can:' },
        {
          kind: 'list',
          items: [
            'see and correct your details in Profile → Personal information;',
            'ask for a copy of the personal information we hold about you;',
            'delete your account from Profile → Delete account;',
            'object to, or ask us to restrict, processing based on our legitimate interests — including asking to be left off the leaderboard;',
            'withdraw consent where we relied on it, without affecting what happened before;',
            'ask us to review an automated decision that affected you.',
          ],
        },
        {
          kind: 'p',
          text: `To exercise any of these, write to ${CONTACT}. Some information must be kept even after deletion, as explained in section 8.`,
        },
        {
          kind: 'p',
          text: `If you are unhappy with how we have handled your information, you can complain to the Data Protection Commission of ${LEGAL_ENTITY.country}. We would appreciate the chance to put it right first.`,
        },
      ],
    },
    {
      id: 'security',
      heading: '10. How we protect it',
      blocks: [
        {
          kind: 'list',
          items: [
            'Passwords, withdrawal PINs and backup codes are stored as one-way hashes, never as text we could read.',
            'Two-factor authentication secrets are encrypted, so a copy of the database alone does not reveal them.',
            'Traffic between you and us is encrypted in transit.',
            'Access to your records is restricted at the database level, so one account cannot read another’s.',
            'Sensitive actions — payouts, changing your password or email, deleting your account — require you to confirm who you are.',
          ],
        },
        {
          kind: 'p',
          text: 'No service can promise perfect security. If a breach ever affects your personal information, we will tell you and the regulator as the law requires.',
        },
      ],
    },
    {
      id: 'cookies',
      heading: '11. Cookies and local storage',
      blocks: [
        {
          kind: 'p',
          text: 'We use only what the service needs to work: cookies that keep you signed in, that record you have passed two-factor authentication, and that remember your language. Your browser also stores your theme choice and, if you arrived from an invite link, the referral code.',
        },
        {
          kind: 'p',
          text: 'We do not use advertising or tracking cookies of our own. Embedded video players used to show some advertisements may set their own.',
        },
      ],
    },
    {
      id: 'children',
      heading: '12. Children',
      blocks: [
        {
          kind: 'p',
          text: 'SidePerks is for adults aged 18 and over. We do not knowingly collect information from children. If you believe a child has registered, tell us and we will remove the account.',
        },
      ],
    },
    {
      id: 'changes',
      heading: '13. Changes to this policy',
      blocks: [
        {
          kind: 'p',
          text: 'We will update this policy as the service grows. When a change matters to you we will tell you in the app or by email. The date at the top shows when this version was published.',
        },
      ],
    },
    {
      id: 'contact',
      heading: '14. Who we are and how to contact us',
      blocks: [
        { kind: 'p', text: 'SidePerks is operated by:' },
        { kind: 'list', items: businessDetails() },
        {
          kind: 'p',
          text: `For any question about privacy, or to exercise your rights, write to ${CONTACT}.`,
        },
      ],
    },
  ],
}
