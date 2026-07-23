'use client'

import { ThemeProvider as NextThemeProvider } from 'next-themes'

/**
 * Theme provider.
 *
 * The default is `system` — a fresh visitor gets dark or light to match their
 * OS, with no flash on load (next-themes writes the class before paint via an
 * inline script). Once the user or admin dashboard ships its light/dark/system
 * toggle, it drives this same provider with `useTheme().setTheme(...)`, and the
 * choice persists in localStorage under the `theme` key.
 *
 *   attribute="class"          -> toggles a `dark` class on <html>, which the
 *                                 Tailwind v4 `dark:` variant (see globals.css)
 *                                 and the `.dark { }` token overrides key off.
 *   disableTransitionOnChange  -> no colour-transition smear when flipping.
 */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  return (
    <NextThemeProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
    >
      {children}
    </NextThemeProvider>
  )
}
