/**
 * Turns a user-agent string into something a person recognises.
 *
 * Deliberately small and heuristic. The job is only to help someone answer
 * "is that me?" when looking at their own sign-ins — "iPhone · Safari" does
 * that; a full UA string does not. Order matters: Edge and Opera both claim
 * to be Chrome, and Chrome on iOS claims to be Safari, so the more specific
 * token has to be tested first.
 */
export type DeviceInfo = { device: string; browser: string | null }

const BROWSERS: Array<[RegExp, string]> = [
  [/\bEdgA?\//, 'Edge'],
  [/\bOPR\/|\bOpera\b/, 'Opera'],
  [/\bSamsungBrowser\//, 'Samsung Internet'],
  [/\bCriOS\//, 'Chrome'],
  [/\bFxiOS\//, 'Firefox'],
  [/\bFirefox\//, 'Firefox'],
  [/\bChrome\//, 'Chrome'],
  [/\bSafari\//, 'Safari'],
]

const DEVICES: Array<[RegExp, string]> = [
  [/\biPhone\b/, 'iPhone'],
  [/\biPad\b/, 'iPad'],
  [/\bAndroid\b.*\bMobile\b/, 'Android phone'],
  [/\bAndroid\b/, 'Android tablet'],
  [/\bWindows NT\b/, 'Windows PC'],
  [/\bMac OS X\b|\bMacintosh\b/, 'Mac'],
  [/\bCrOS\b/, 'Chromebook'],
  [/\bLinux\b/, 'Linux'],
]

export function describeUserAgent(userAgent: string | null): DeviceInfo {
  if (!userAgent) return { device: 'Unknown device', browser: null }

  const device = DEVICES.find(([re]) => re.test(userAgent))?.[1] ?? 'Unknown device'
  const browser = BROWSERS.find(([re]) => re.test(userAgent))?.[1] ?? null
  return { device, browser }
}
