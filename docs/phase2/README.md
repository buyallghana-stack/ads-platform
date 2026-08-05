# Phase 2 — affiliate marketing

| Document | What it is for |
|---|---|
| [DECISIONS.md](DECISIONS.md) | Every Phase 2 decision and the reasoning. Supersedes `CLAUDE CODE PLAN phase2.md` where they differ |
| [CONFIGURATION.md](CONFIGURATION.md) | Every number you can change, with its live value |
| [DESIGN.md](DESIGN.md) | The six design calls the UI follows from, and what they were derived from |

Migrations 107–132.

---

## 1. Status

**Backend done.** Catalogue, content and private media, commerce and orders, training and
activation, attribution, the commission ledger, reports, curriculum and quizzes, renewals and
upgrades, admin authoring, affiliate operations, nightly maintenance, commission payouts, and
the two screen reads (migrations 130–131).

**UI done.** The mode switch and mode-aware navigation, the affiliate dashboard in all five of
its states, the course player with in-video checkpoints, the curriculum, quizzes, and the
article/PDF reader.

**Not built yet.** The shop and product pages, checkout, the links screen, commission
withdrawal, admin authoring screens, manual commission adjustment, the E34 two-stream
concurrency limit, vendor CSV export.

---

## 2. Design

References were asked for and the operator handed the decisions over instead (2026-08-06):
*"the UI design is up to you. research for better ui design patterns."* [DESIGN.md](DESIGN.md)
records what was derived and from what, so a later screen can be checked against it and a later
decision can overturn one deliberately.

The affiliate green (F38) is resolved there: **jade** is an identity colour for Market mode and
never a status colour, so `success` green keeps meaning *money in* in both businesses.

**Nothing is blocked on an unanswered question.** A1 (catalogue size) was closed on 2026-08-06 as
a question that decides nothing — the shelf handles either scale, the reads paginate regardless,
and A2 already caps the catalogue by making the Owner create every product by hand. See §8 of
[DECISIONS.md](DECISIONS.md).

The only thing still open is optional: whether the operator wants to override jade with a
specific pair. The build does not wait on it.
