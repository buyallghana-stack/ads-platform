import path from 'node:path'
import { chromium } from '@playwright/test'

const outDir = '/mnt/c/Users/Emmanuel Ofori/Desktop/Mockup_Previews'

async function main() {
  const browser = await chromium.launch()

  // 1. Render Safari Laptop Mockup
  {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 })
    await page.goto('http://localhost:3100/en', { waitUntil: 'networkidle' })
    await page.waitForTimeout(1000)

    // Scroll to hero
    const heroMockup = page.locator('main section').first()
    await heroMockup.screenshot({
      path: path.join(outDir, '1_laptop_safari_hero.png'),
    })
    console.log('Saved 1_laptop_safari_hero.png')
    await page.close()
  }

  // 2. Render iPhone Mockup (Mobile iOS viewport)
  {
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 2,
      isMobile: true,
      hasTouch: true,
    })
    const page = await context.newPage()
    await page.goto('http://localhost:3100/en', { waitUntil: 'networkidle' })
    await page.waitForTimeout(1000)

    const heroMockup = page.locator('main section').first()
    await heroMockup.screenshot({
      path: path.join(outDir, '2_iphone_mobile_hero.png'),
    })
    console.log('Saved 2_iphone_mobile_hero.png')
    await context.close()
  }

  // 3. Render Android Mockup (Mobile Android viewport)
  {
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 2,
      isMobile: true,
      hasTouch: true,
    })
    const page = await context.newPage()
    await page.goto('http://localhost:3100/en', { waitUntil: 'networkidle' })
    await page.waitForTimeout(1000)

    const heroMockup = page.locator('main section').first()
    await heroMockup.screenshot({
      path: path.join(outDir, '3_android_mobile_hero.png'),
    })
    console.log('Saved 3_android_mobile_hero.png')
    await context.close()
  }

  await browser.close()
  console.log('All previews saved to:', outDir)
}

main().catch(console.error)
