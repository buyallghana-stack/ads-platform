# Auth emails — templates and the settings they depend on

Everything Supabase sends to a person lives here. The dashboard is the only
place these can actually be *set* (there is no Management API token in this
project), so the copies here are the source of truth: paste from the file,
never edit only the dashboard, or the next person to look has no way of
knowing what is live.

## Why the templates cannot be left at their defaults

The default body is `{{ .ConfirmationURL }}`, which points at Supabase's own
`/auth/v1/verify`. That endpoint returns the session **in a URL fragment**
(`#access_token=…`), and a fragment never reaches the server — so
`src/app/auth/confirm/route.ts`, which is where our links are supposed to
land, cannot read it and the person is dropped on a page that does not know
who they are.

Each template below uses `{{ .RedirectTo }}` instead, which is the
`emailRedirectTo` the app already sends on every path:

| Path | What the app sends | Template `type` |
|---|---|---|
| Sign up / resend | `/auth/confirm?next=/dashboard` | `signup` |
| Change email | `/auth/confirm?next=/profile` | `email_change` |
| Password reset | `/auth/confirm?next=/reset-password` | `recovery` |

**The `&` before `token_hash` is load-bearing.** `RedirectTo` already carries
`?next=…`, so appending with `?` would produce two query strings and the token
would be lost.

## Dashboard settings, in the order they matter

**1. Authentication → URL Configuration**

- **Site URL**: `https://ads-platform-flame.vercel.app`
  It is still `http://localhost:3000` at the time of writing, which shows up as
  the `referer` on every GoTrue log line. Any email Supabase sends while it
  says localhost points at the recipient's own machine.
- **Redirect URLs** — add all of these:
  - `https://ads-platform-flame.vercel.app/**`
  - `http://localhost:3000/**`
  - `http://localhost:3100/**` (the QA port used in this project)

**2. Project Settings → Authentication → SMTP Settings**

Resend, using their test sender — no domain needed:

| Field | Value |
|---|---|
| Host | `smtp.resend.com` |
| Port | `465` |
| Username | `resend` |
| Password | the Resend API key (`re_…`) |
| Sender email | `onboarding@resend.dev` |
| Sender name | `SidePerks` |

**The test sender only delivers to the address that owns the Resend account**
(`buyallghana@gmail.com`). Every other recipient is accepted and dropped. That
is fine for proving the flow and useless for letting testers in — a real
domain has to be verified before anybody else receives anything.

**3. Authentication → Rate Limits**

Raise **"Emails sent per hour"** once custom SMTP is on. The built-in mailer
allows a handful an hour and returned 429 three times in testing on
2026-07-29; a signup whose email cannot be sent fails whole, and GoTrue rolls
the account back.

**4. Authentication → Email Templates**

Paste each file into the matching template:

| File | Template |
|---|---|
| `confirm-signup.html` | Confirm signup |
| `change-email.html` | Change Email Address |
| `reset-password.html` | Reset Password |

If **Secure email change** is enabled, changing an address emails BOTH the old
and the new one and both links must be clicked. The same template renders for
each, and each carries its own token, so nothing here changes — just expect
two emails.

## How to check it worked

Sign up on production with `buyallghana@gmail.com`, then:

1. the mail arrives from `onboarding@resend.dev`;
2. its button points at `ads-platform-flame.vercel.app/auth/confirm?next=…&token_hash=…&type=signup`
   — if it points at `supabase.co/auth/v1/verify`, the template did not save;
3. clicking it lands on `/dashboard`, signed in;
4. clicking it a second time lands on `/verify?error=expired`, because these
   tokens are single use and fail closed.
