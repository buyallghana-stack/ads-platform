'use client'

import { useEffect, useState } from 'react'
import { Iphone } from '@/components/magicui/iphone'
import { Android } from '@/components/magicui/android'
import { Safari } from '@/components/magicui/safari'
import { Smartphone, Monitor, TabletSmartphone } from 'lucide-react'
import { cn } from '@/lib/cn'

export type DevicePlatform = 'ios' | 'android' | 'desktop'

export interface AdaptiveDeviceMockupProps {
  srcLight: string
  srcDark?: string
  desktopSrcLight?: string
  desktopSrcDark?: string
  alt: string
  url?: string
  priority?: boolean
  className?: string
  /** Force a specific mockup type instead of auto-detecting */
  forcedPlatform?: DevicePlatform
  /** Whether to show the device preview switcher */
  showSwitcher?: boolean
  /** Whether this frame is strictly a phone frame (swaps between iOS and Android) */
  mobileOnly?: boolean
}

export function AdaptiveDeviceMockup({
  srcLight,
  srcDark,
  desktopSrcLight,
  desktopSrcDark,
  alt,
  url = 'sideperks.com/dashboard',
  priority = false,
  className,
  forcedPlatform,
  showSwitcher = false,
  mobileOnly = false,
}: AdaptiveDeviceMockupProps) {
  const [platform, setPlatform] = useState<DevicePlatform>(forcedPlatform ?? (mobileOnly ? 'ios' : 'desktop'))
  const [detectedPlatform, setDetectedPlatform] = useState<DevicePlatform>(mobileOnly ? 'ios' : 'desktop')
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
    if (forcedPlatform) {
      setPlatform(forcedPlatform)
      return
    }

    const checkDevice = () => {
      // 1. Tablet & Laptop / Desktop: determined by screen width (>= 768px)
      if (window.innerWidth >= 768) {
        setDetectedPlatform('desktop')
        setPlatform('desktop')
        return
      }

      // 2. Mobile screen (< 768px): determined by mobile Operating System
      const ua = navigator.userAgent || ''
      const isIOS = /iPhone|iPod|iPad/i.test(ua)
      const detected: DevicePlatform = isIOS ? 'ios' : 'android'
      setDetectedPlatform(detected)
      setPlatform(detected)
    }

    checkDevice()
    window.addEventListener('resize', checkDevice)
    return () => window.removeEventListener('resize', checkDevice)
  }, [forcedPlatform])

  const dLight = desktopSrcLight || srcLight
  const dDark = desktopSrcDark || srcDark

  return (
    <div className={cn('flex flex-col items-center gap-4', className)}>
      {showSwitcher && mounted ? (
        <div className="inline-flex items-center gap-1 p-1 rounded-full bg-ink-900/5 dark:bg-white/10 border border-ink-900/10 dark:border-white/10 backdrop-blur-xs text-xs font-medium text-ink-600 dark:text-ink-300">
          <button
            type="button"
            onClick={() => setPlatform('ios')}
            className={cn(
              'flex items-center gap-1.5 px-3 py-1 rounded-full transition-all duration-200 cursor-pointer',
              platform === 'ios'
                ? 'bg-white dark:bg-ink-800 text-ink-900 dark:text-white shadow-xs font-semibold'
                : 'hover:text-ink-900 dark:hover:text-white',
            )}
          >
            <Smartphone className="size-3.5" />
            <span>iPhone (iOS)</span>
            {detectedPlatform === 'ios' && (
              <span className="size-1.5 rounded-full bg-brand-500" title="Your device" />
            )}
          </button>
          <button
            type="button"
            onClick={() => setPlatform('android')}
            className={cn(
              'flex items-center gap-1.5 px-3 py-1 rounded-full transition-all duration-200 cursor-pointer',
              platform === 'android'
                ? 'bg-white dark:bg-ink-800 text-ink-900 dark:text-white shadow-xs font-semibold'
                : 'hover:text-ink-900 dark:hover:text-white',
            )}
          >
            <TabletSmartphone className="size-3.5" />
            <span>Android</span>
            {detectedPlatform === 'android' && (
              <span className="size-1.5 rounded-full bg-brand-500" title="Your device" />
            )}
          </button>
          <button
            type="button"
            onClick={() => setPlatform('desktop')}
            className={cn(
              'flex items-center gap-1.5 px-3 py-1 rounded-full transition-all duration-200 cursor-pointer',
              platform === 'desktop'
                ? 'bg-white dark:bg-ink-800 text-ink-900 dark:text-white shadow-xs font-semibold'
                : 'hover:text-ink-900 dark:hover:text-white',
            )}
          >
            <Monitor className="size-3.5" />
            <span>Safari / Laptop</span>
            {detectedPlatform === 'desktop' && (
              <span className="size-1.5 rounded-full bg-brand-500" title="Your device" />
            )}
          </button>
        </div>
      ) : null}

      <div className="w-full">
        {platform === 'desktop' ? (
          <div className="w-full max-w-2xl lg:max-w-3xl mx-auto drop-shadow-2xl transition-all duration-300">
            <Safari
              url={url}
              imageSrcLight={dLight}
              imageSrcDark={dDark}
              alt={alt}
              priority={priority}
              className="w-full"
            />
          </div>
        ) : platform === 'android' ? (
          <div className="w-full max-w-[19rem] sm:max-w-[21rem] mx-auto drop-shadow-2xl transition-all duration-300">
            <Android
              srcLight={srcLight}
              srcDark={srcDark}
              alt={alt}
              priority={priority}
              className="w-full"
            />
          </div>
        ) : (
          <div className="w-full max-w-[19rem] sm:max-w-[21rem] mx-auto drop-shadow-2xl transition-all duration-300">
            <Iphone
              srcLight={srcLight}
              srcDark={srcDark}
              alt={alt}
              priority={priority}
              className="w-full"
            />
          </div>
        )}
      </div>
    </div>
  )
}
