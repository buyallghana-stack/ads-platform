import { describe, expect, it } from 'vitest'

import { adThumbnailUrl } from '@/lib/ads/media'

/**
 * Which picture a card shows.
 *
 * Operator, 2026-09-23: a survey or an article with no artwork was landing in
 * the feed as the same generated cover as everything else, which reads as a
 * card that failed to load rather than as a survey. Each format now has a
 * default of its own.
 *
 * ⚠️ THIS IS A UNIT TEST ON PURPOSE. Production carries nineteen videos and one
 * survey and NO articles at all, so the article path cannot be photographed on
 * the real feed however long you look at it. That is exactly the case worth
 * pinning down: the one nobody can see today is the one that ships broken.
 */
describe('ad thumbnails', () => {
  it('prefers what the advertiser uploaded, over everything', () => {
    const url = adThumbnailUrl({
      thumbnail_path: 'ads/real-artwork.jpg',
      youtube_video_id: 'dQw4w9WgXcQ',
      format: 'survey',
    })
    expect(url).toContain('ads/real-artwork.jpg')
    expect(url).not.toContain('/ads/default-survey.jpg')
  })

  it("falls back to YouTube's own still for a video", () => {
    expect(adThumbnailUrl({ youtube_video_id: 'dQw4w9WgXcQ', format: 'video' })).toBe(
      'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg',
    )
  })

  it('gives a survey the survey cover', () => {
    expect(adThumbnailUrl({ format: 'survey' })).toBe('/ads/default-survey.jpg')
  })

  /* The one that cannot be seen on the live feed today. */
  it('gives an article the article cover', () => {
    expect(adThumbnailUrl({ format: 'link' })).toBe('/ads/default-article.jpg')
  })

  /* A video with neither artwork nor a YouTube id still draws the generated
     cover: a video's picture is its own frame, and inventing one would put the
     same stock image on every unfinished ad in the admin. */
  it('leaves a video with nothing to fall back on', () => {
    expect(adThumbnailUrl({ format: 'video' })).toBeNull()
  })

  it('does not invent a cover for a format it has never heard of', () => {
    expect(adThumbnailUrl({ format: 'something_new' })).toBeNull()
    expect(adThumbnailUrl({})).toBeNull()
  })
})
