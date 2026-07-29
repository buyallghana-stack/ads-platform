'use client'

import { useEffect } from 'react'

import * as Sentry from '@sentry/nextjs'

/**
 * The last error boundary in the application.
 *
 * It catches what nothing else can: a throw in the root layout, and React
 * render errors that escape every nested boundary. Those are the failures that
 * leave somebody looking at a blank white page — the class of bug that took a
 * day to find when iOS 15 could not parse a chunk and every button went dead.
 * Without this file they are never reported at all.
 *
 * IT REPLACES THE ROOT LAYOUT, so it has to render its own <html> and <body>,
 * and it cannot use anything from the layout it is replacing. No next-intl
 * provider, so no translations — the copy is English-only on purpose rather
 * than risking a second throw inside the error screen. Styles are inline for
 * the same reason: if the stylesheet is what failed, a class name is worth
 * nothing here.
 */
export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  useEffect(() => {
    Sentry.captureException(error)
  }, [error])

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '24px',
          background: '#f1f5f9',
          fontFamily:
            '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
        }}
      >
        <div style={{ maxWidth: '26rem', textAlign: 'center' }}>
          <p style={{ margin: 0, fontSize: '17px', fontWeight: 600, color: '#0f172a' }}>
            <span>Side</span>
            <span style={{ color: '#0068f8' }}>Perks</span>
          </p>

          <h1
            style={{
              margin: '18px 0 8px',
              fontSize: '20px',
              lineHeight: 1.3,
              fontWeight: 600,
              color: '#0f172a',
            }}
          >
            Something went wrong
          </h1>

          <p style={{ margin: '0 0 20px', fontSize: '15px', lineHeight: 1.6, color: '#475569' }}>
            This page could not be shown. Your account, your points and any withdrawal you have
            requested are unaffected.
          </p>

          {/* A full reload, not router.refresh(): whatever broke may have
              broken the router with it. */}
          <button
            type="button"
            onClick={() => window.location.reload()}
            style={{
              padding: '12px 22px',
              fontSize: '15px',
              fontWeight: 600,
              color: '#ffffff',
              background: '#0068f8',
              border: 'none',
              borderRadius: '10px',
              cursor: 'pointer',
            }}
          >
            Try again
          </button>

          {/* The one thing support will ask for. Sentry attaches the same
              digest, so this turns "it broke" into a specific report. */}
          {error.digest && (
            <p style={{ margin: '18px 0 0', fontSize: '12px', color: '#94a3b8' }}>
              Reference: {error.digest}
            </p>
          )}
        </div>
      </body>
    </html>
  )
}
