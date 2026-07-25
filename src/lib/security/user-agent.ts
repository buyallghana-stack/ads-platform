/**
 * Turns a user-agent string into something a person recognises.
 *
 * Deliberately small and heuristic. The job is only to help someone answer
 * "is that me?" when looking at their own sign-ins — "iPhone · Safari" does
 * that; a full UA string does not. Order matters: Edge and Opera both claim
 * to be Chrome, and Chrome on iOS claims to be Safari, so the more specific
 * token has to be tested first.
 */
export type DeviceInfo = { device: string; browser: string | null; os: string | null }

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

/**
 * The operating system and, where the UA states it, its version — "iOS 18.7"
 * distinguishes two iPhones on the list far better than "iPhone" twice.
 */
function describeOs(userAgent: string): string | null {
  const ios = userAgent.match(/(?:iPhone )?OS (\d+)[._](\d+)/)
  if (ios && /iPhone|iPad/.test(userAgent)) return `iOS ${ios[1]}.${ios[2]}`

  const android = userAgent.match(/Android (\d+(?:\.\d+)?)/)
  if (android) return `Android ${android[1]}`

  const mac = userAgent.match(/Mac OS X (\d+)[._](\d+)/)
  if (mac) return `macOS ${mac[1]}.${mac[2]}`

  const windows = userAgent.match(/Windows NT (\d+\.\d+)/)
  if (windows) {
    // Windows 11 also reports NT 10.0; there is no way to tell them apart from
    // the UA, so both are reported as the version that is certainly true.
    return windows[1] === '10.0' ? 'Windows 10 or 11' : `Windows (NT ${windows[1]})`
  }

  if (/CrOS/.test(userAgent)) return 'ChromeOS'
  if (/Linux/.test(userAgent)) return 'Linux'
  return null
}

export function describeUserAgent(userAgent: string | null): DeviceInfo {
  if (!userAgent) return { device: 'Unknown device', browser: null, os: null }

  const device = DEVICES.find(([re]) => re.test(userAgent))?.[1] ?? 'Unknown device'
  const browser = BROWSERS.find(([re]) => re.test(userAgent))?.[1] ?? null
  return { device, browser, os: describeOs(userAgent) }
}
