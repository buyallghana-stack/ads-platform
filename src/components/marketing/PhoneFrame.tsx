'use client'

import { AdaptiveDeviceMockup } from './AdaptiveDeviceMockup'

/**
 * A responsive device mockup shell around real screenshots of the app.
 * Automatically adapts between iPhone (iOS), Android, and Safari (desktop/tablet).
 */
export function PhoneFrame({
  srcLight,
  srcDark,
  desktopSrcLight,
  desktopSrcDark,
  alt,
  priority = false,
  className,
  mobileOnly = false,
}: {
  srcLight: string
  srcDark?: string
  desktopSrcLight?: string
  desktopSrcDark?: string
  alt: string
  width?: number
  height?: number
  priority?: boolean
  className?: string
  mobileOnly?: boolean
}) {
  return (
    <AdaptiveDeviceMockup
      srcLight={srcLight}
      srcDark={srcDark}
      desktopSrcLight={desktopSrcLight}
      desktopSrcDark={desktopSrcDark}
      alt={alt}
      priority={priority}
      className={className}
      mobileOnly={mobileOnly}
    />
  )
}
