/**
 * The certificate itself, built to the operator's reference (2026-08-07).
 *
 * ── IT IS HTML, NOT A GENERATED IMAGE ──
 *
 * The download is the browser's own print-to-PDF, which is why this is laid
 * out in CSS rather than drawn. That buys three things a generated PNG would
 * not: the name stays selectable text so a verifier can copy it, it prints at
 * the printer's resolution instead of at whatever raster we chose, and there
 * is no PDF library in the bundle or on the server. `print.css` below turns
 * the page into one landscape sheet with nothing else on it.
 *
 * ── PROPORTIONS ARE LOCKED, THE FONT SCALES ──
 *
 * A certificate that reflows is a certificate that looks different on every
 * phone, and this one gets shared as an image. So the sheet is a fixed 297×210
 * aspect box (A4 landscape) and everything inside is sized in `cqw` — container
 * query widths — so the whole thing scales as one object from a 320px phone to
 * an A4 page.
 *
 * ── THE TWO LEVELS ARE TOLD APART BY THE BAR ──
 *
 * Amber for Beginner, violet for Professional. The reference used amber and
 * blue; blue is the ads business's colour and this is an affiliate document,
 * so Professional wears the affiliate violet (operator's choice).
 */

type Level = 'beginner' | 'professional' | null

export function CertificateSheet({
  holder,
  course,
  level,
  grade,
  issuedAt,
  code,
  qrDataUrl,
  locale,
}: {
  holder: string
  course: string
  level: Level
  grade: number | null
  issuedAt: string
  code: string
  /** Pre-rendered on the server; see the note in the page. */
  qrDataUrl: string | null
  locale: string
}) {
  const professional = level === 'professional'
  const accent = professional ? '#7c3aed' : '#f59e0b'
  const accentInk = professional ? '#5b21b6' : '#b45309'

  return (
    /*
      ⚠️ LIGHT, WHATEVER THE THEME IS (operator, 2026-08-07: "a certificate
      should only be light themed no matter your theme settings").

      Every colour on this sheet was already a literal hex rather than a token,
      so the sheet itself never went dark — but it sits inside the affiliate
      wrapper, which is a dark violet skin, and that showed around it and
      behind it when the page was screenshotted, shared or printed. A
      certificate is a document, not a screen: it has one appearance.

      `colorScheme: 'light'` is the part that is easy to miss. Without it the
      browser still renders form controls, scrollbars and the print background
      in the dark scheme it inherited, which is how a "light" sheet still
      prints with a grey wash behind it.
    */
    <div
      className="certificate-sheet"
      style={{
        containerType: 'inline-size',
        width: '100%',
        colorScheme: 'light',
        background: '#fff',
      }}
    >
      <div
        style={{
          position: 'relative',
          aspectRatio: '297 / 210',
          background: '#fdfdfb',
          color: '#1f2430',
          overflow: 'hidden',
          border: '1px solid rgb(15 23 42 / 0.10)',
          borderRadius: '0.5cqw',
          /* The reference's woven paper, as a hairline texture rather than an
             image: two faint diagonals at low opacity. An asset would be one
             more thing to load and would band when printed. */
          backgroundImage:
            'repeating-linear-gradient(45deg, rgb(15 23 42 / 0.022) 0 1px, transparent 1px 6px)',
        }}
      >
        {/* The spine. Vertical word, exactly as the reference. */}
        <div
          style={{
            position: 'absolute',
            left: '7cqw',
            top: 0,
            width: '7.5cqw',
            height: '52%',
            background: accent,
            display: 'grid',
            placeItems: 'center',
          }}
        >
          <span
            style={{
              writingMode: 'vertical-rl',
              transform: 'rotate(180deg)',
              color: '#fff',
              fontWeight: 800,
              letterSpacing: '0.28cqw',
              fontSize: '2.5cqw',
            }}
          >
            CERTIFICATE
          </span>
        </div>

        {/* The mark, not a stand-in for it.
            This was a violet disc with the words SIDE / PERKS set in it, which
            is what you draw when the real asset is not to hand — and on a
            document somebody presents to an employer it reads as a placeholder.
            `sideperks-mark.png` is the actual logo and it is already in
            /public for the app header. */}
        <div
          style={{
            position: 'absolute',
            right: '7cqw',
            top: '6.5cqw',
            width: '15cqw',
            textAlign: 'center',
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/sideperks-mark.png"
            alt=""
            style={{
              width: '11cqw',
              height: '11cqw',
              display: 'block',
              margin: '0 auto',
              borderRadius: '2.4cqw',
            }}
          />
          <p
            style={{
              marginTop: '0.9cqw',
              fontSize: '1.25cqw',
              fontWeight: 700,
              letterSpacing: '0.1em',
              color: accentInk,
            }}
          >
            SIDEPERKS
          </p>
        </div>

        {/* The body. */}
        <div style={{ position: 'absolute', left: '19cqw', top: '9cqw', right: '23cqw' }}>
          <p style={{ fontSize: '1.9cqw', color: '#6b7280' }}>This is to certify that</p>

          <p
            style={{
              marginTop: '2.4cqw',
              fontSize: '4.6cqw',
              fontWeight: 800,
              letterSpacing: '-0.02em',
              color: accentInk,
              textTransform: 'uppercase',
              lineHeight: 1.1,
            }}
          >
            {holder}
          </p>
          <div
            style={{ marginTop: '1.2cqw', height: '0.22cqw', width: '38cqw', background: '#d8dae0' }}
          />

          <p style={{ marginTop: '2.2cqw', fontSize: '1.85cqw', lineHeight: 1.65, color: '#4b5563' }}>
            has successfully completed <strong style={{ color: '#1f2430' }}>{course}</strong>
            {grade !== null && (
              <>
                {' '}
                with an overall grade of{' '}
                <strong style={{ color: accentInk }}>{grade}%</strong>
              </>
            )}
            , covering how affiliate commission is earned, how links are attributed, and how
            payouts are made.
          </p>

          <p style={{ marginTop: '1.6cqw', fontSize: '1.6cqw', color: '#6b7280' }}>
            Issued on behalf of SidePerks Ghana,{' '}
            {new Intl.DateTimeFormat(locale, {
              day: 'numeric',
              month: 'long',
              year: 'numeric',
            }).format(new Date(issuedAt))}
          </p>
        </div>

        {/* Verification. */}
        <div style={{ position: 'absolute', left: '7cqw', bottom: '6cqw' }}>
          {qrDataUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={qrDataUrl}
              alt=""
              style={{ width: '11cqw', height: '11cqw', display: 'block' }}
            />
          )}
          <p style={{ marginTop: '0.8cqw', fontSize: '1.15cqw', color: '#9aa1ad', letterSpacing: '0.06em' }}>
            {code}
          </p>
        </div>

        {/* Signatures. */}
        <div
          style={{
            position: 'absolute',
            right: '7cqw',
            bottom: '6cqw',
            display: 'flex',
            gap: '6cqw',
          }}
        >
          {[
            { src: '/certificate/signature-ceo.png', name: 'Johnson Matteo', role: 'Chief Executive Officer' },
            { src: '/certificate/signature-manager.png', name: 'Stephen Boakye', role: 'Manager, SidePerks Ghana' },
          ].map((s) => (
            <div key={s.name} style={{ width: '22cqw', textAlign: 'center' }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={s.src}
                alt=""
                style={{ height: '6cqw', objectFit: 'contain', margin: '0 auto', display: 'block' }}
              />
              <div style={{ marginTop: '0.6cqw', height: '0.16cqw', background: '#c9cdd6' }} />
              <p style={{ marginTop: '0.9cqw', fontSize: '1.5cqw', fontWeight: 700 }}>{s.name}</p>
              <p style={{ fontSize: '1.2cqw', color: '#6b7280' }}>{s.role}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
