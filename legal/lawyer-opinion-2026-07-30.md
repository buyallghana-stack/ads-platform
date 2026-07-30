# Lawyer's written opinion — 2026-07-30, 7:46 PM

Source: WhatsApp message from "Lawyer James", transcribed from a screen recording sent by the
operator on 2026-07-30. Preceded by calls (22 sec, 14 min, 7 min, 40 sec) and a link to
sideperks.org captioned "SidePerks — get paid for watching ads and taking surveys".

This is the operator's record of the advice. It is a transcription, not a signed opinion.

---

## 1. Games (spin wheel + mystery box) — CLEARED

> Having reviewed the concept you've described, I don't see this feature as being designed to
> operate as a betting or gambling product. The key distinction is that users are not paying an
> additional fee, staking money, or risking points for the opportunity to participate. Instead,
> the spin wheel and mystery box are simply loyalty rewards that come as part of a user's existing
> plan. Their plan determines how many opportunities they receive each week, but it does not
> require any separate payment to access the feature.
>
> From a regulatory perspective in Ghana, the Gaming Act, 2006 (Act 721), together with the
> oversight of the Gaming Commission of Ghana, is primarily concerned with activities involving
> gaming, betting and lotteries that fall within the statutory definitions. One of the important
> legal considerations is whether participants are providing consideration specifically in exchange
> for a chance to win a prize. Based on the model you've described, users are not purchasing spins,
> buying mystery boxes, or placing wagers. They are simply enjoying a promotional benefit attached
> to an existing service.
>
> For that reason, the proposed feature is more appropriately characterised as a customer
> engagement or loyalty programme rather than a standalone gaming product. From a development
> standpoint, there is nothing preventing your developer from implementing the feature as
> specified.
>
> That said, this assessment is based on the current design remaining unchanged. If, at any point,
> users are required to pay for spins, purchase mystery boxes, stake funds or points, or otherwise
> provide separate consideration in exchange for the chance to win prizes, the legal position could
> change and a fresh regulatory assessment would be advisable before launch.

## 2. Referral commission — CLEARED

> I've also reviewed the proposed two level referral commission structure. Based on what you've
> shared, I don't have any concerns with the model itself. The referral system is tied to a genuine
> commercial service, namely your advertising platform, where businesses pay to promote their
> products and services. The referral commission simply rewards users for introducing new customers
> to that service rather than rewarding recruitment for its own sake.
>
> The important point is that the referral programme should remain connected to the sale of a
> legitimate service and should not evolve into a structure where earnings are driven primarily by
> recruiting other participants. Keeping the programme to two referral levels is a sensible
> approach and helps maintain a clear distinction from business models that may attract regulatory
> scrutiny.

## 3. Affiliate programme — CLEARED

> The same reasoning applies to your affiliate programme. As long as commissions are earned from
> promoting and generating business for your legitimate advertising services, rather than from
> recruitment alone, the structure is commercially sound and your developer can proceed with
> implementing it as designed.

## 4. Business information to display — sole proprietorship

> With respect to your business information, since you currently operate as a sole proprietorship,
> there is generally no requirement to publish licensing details unless your business is subject to
> a specific licensing regime. What you should display is your registered business name together
> with your business address and any other legally required contact information so users know who
> they are contracting with.

## 5. Next action requested by the lawyer

> Once you've drafted the Terms and Conditions and Privacy Policy, send me the link. I'll review
> both documents carefully and let you know if there are any provisions that should be
> strengthened, amended or added to better protect the business and improve […]

The final sentence was cut off by WhatsApp's "Read more" truncation and is not visible in the
recording. The remainder of that paragraph has not been read.

---

## What this changes in the build

| Area | Before | After this opinion |
|---|---|---|
| `games_enabled` | shipped OFF pending a gaming-licence answer | cleared to turn ON, **conditional on plays never being sold** |
| Referral purchase commission | flagged to the lawyer, unresolved | cleared; two levels is the stated ceiling (we ship one) |
| Affiliate programme | not built | cleared to build |
| Licence display | assumed a licence number had to be shown | sole proprietorship — show **registered business name + business address + contact**, no licence number |
| Terms / Privacy | `LEGAL_REVIEWED=false` | still false; lawyer wants a **public link** to review |

**The condition attached to the games clearance is a build constraint, not a note.** The opinion
holds only while plays are a benefit of an existing plan. Anything that lets a user pay for spins,
buy boxes, or stake points or money for a draw voids it and needs a fresh assessment before launch.
