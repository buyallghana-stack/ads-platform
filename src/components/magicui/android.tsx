import { useId, type HTMLAttributes } from 'react'
import { cn } from '@/lib/cn'

const ANDROID_WIDTH = 380
const ANDROID_HEIGHT = 832
const SCREEN_X = 9
const SCREEN_Y = 14
const SCREEN_WIDTH = 360
const SCREEN_HEIGHT = 800
const SCREEN_RADIUS = 30

// Calculated percentages
const LEFT_PCT = (SCREEN_X / ANDROID_WIDTH) * 100
const TOP_PCT = (SCREEN_Y / ANDROID_HEIGHT) * 100
const WIDTH_PCT = (SCREEN_WIDTH / ANDROID_WIDTH) * 100
const HEIGHT_PCT = (SCREEN_HEIGHT / ANDROID_HEIGHT) * 100
const RADIUS_PCT = (SCREEN_RADIUS / SCREEN_WIDTH) * 100

export interface AndroidProps extends HTMLAttributes<HTMLDivElement> {
  src?: string
  srcLight?: string
  srcDark?: string
  alt?: string
  videoSrc?: string
  priority?: boolean
}

export function Android({
  src,
  srcLight,
  srcDark,
  alt = 'Android preview',
  videoSrc,
  priority = false,
  className,
  style,
  ...props
}: AndroidProps) {
  const maskId = useId()
  const lightImage = srcLight || src
  const darkImage = srcDark
  const hasVideo = !!videoSrc
  const hasMedia = hasVideo || !!lightImage

  return (
    <div
      className={cn('relative inline-block w-full align-middle leading-none', className)}
      style={{
        aspectRatio: `${ANDROID_WIDTH}/${ANDROID_HEIGHT}`,
        ...style,
      }}
      {...props}
    >
      {/* Screen container */}
      <div
        className="pointer-events-none absolute z-0 overflow-hidden"
        style={{
          left: `${LEFT_PCT}%`,
          top: `${TOP_PCT}%`,
          width: `${WIDTH_PCT}%`,
          height: `${HEIGHT_PCT}%`,
          borderRadius: `${RADIUS_PCT}%`,
        }}
      >
        {hasVideo ? (
          <video
            className="block size-full object-cover object-top"
            src={videoSrc}
            autoPlay
            loop
            muted
            playsInline
            preload="metadata"
          />
        ) : lightImage ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={lightImage}
              alt={alt}
              loading={priority ? 'eager' : 'lazy'}
              decoding="async"
              className={cn('block size-full object-cover object-top', darkImage && 'dark:hidden')}
            />
            {darkImage && (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img
                src={darkImage}
                alt=""
                loading={priority ? 'eager' : 'lazy'}
                decoding="async"
                className="hidden size-full object-cover object-top dark:block"
              />
            )}
          </>
        ) : null}
      </div>

      <svg
        viewBox={`0 0 ${ANDROID_WIDTH} ${ANDROID_HEIGHT}`}
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="pointer-events-none absolute inset-0 size-full"
        style={{ transform: 'translateZ(0)' }}
      >
        <g mask={hasMedia ? `url(#${maskId})` : undefined}>
          {/* Side volume / power buttons */}
          <path
            d="M376 153H378C379.105 153 380 153.895 380 155V249C380 250.105 379.105 251 378 251H376V153Z"
            className="fill-[#CCCCCC] dark:fill-[#4A4A4A]"
          />
          <path
            d="M376 301H378C379.105 301 380 301.895 380 303V351C380 352.105 379.105 353 378 353H376V301Z"
            className="fill-[#CCCCCC] dark:fill-[#4A4A4A]"
          />
          {/* Outer chassis border */}
          <path
            d="M0 42C0 18.8041 18.804 0 42 0H336C359.196 0 378 18.804 378 42V788C378 811.196 359.196 830 336 830H42C18.804 830 0 811.196 0 788V42Z"
            className="fill-[#E5E5E5] dark:fill-[#333333]"
          />
          {/* Inner bezel */}
          <path
            d="M2 43C2 22.0132 19.0132 5 40 5H338C358.987 5 376 22.0132 376 43V787C376 807.987 358.987 825 338 825H40C19.0132 825 2 807.987 2 787V43Z"
            className="fill-[#1A1A1A] dark:fill-[#121212]"
          />
        </g>

        {/* Camera punch-hole */}
        <circle
          cx="189"
          cy="28"
          r="8"
          className="fill-[#0D0D0D]"
        />
        <circle
          cx="189"
          cy="28"
          r="4"
          className="fill-[#1E293B] opacity-80"
        />

        <defs>
          <mask id={maskId} maskUnits="userSpaceOnUse">
            <rect x="0" y="0" width={ANDROID_WIDTH} height={ANDROID_HEIGHT} fill="white" />
            <rect
              x={SCREEN_X}
              y={SCREEN_Y}
              width={SCREEN_WIDTH}
              height={SCREEN_HEIGHT}
              rx={SCREEN_RADIUS}
              ry={SCREEN_RADIUS}
              fill="black"
            />
          </mask>
        </defs>
      </svg>
    </div>
  )
}
