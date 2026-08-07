/**
 * The two skins, resolved on the CLIENT.
 *
 * ⚠️ A SKIN CANNOT BE PASSED FROM A SERVER COMPONENT. It carries functions,
 * and React refuses to serialise those across the boundary: "Functions cannot
 * be passed directly to Client Components". The server action inside it would
 * have been fine; `formatValue` is not.
 *
 * So the page passes a NAME, which is a string, and the component looks the
 * skin up here. Importing a server action into a client module is allowed and
 * is what makes this work.
 */
import { playAffiliateGameForBoard } from '@/app/[locale]/(affiliate)/market/games/actions'
import { playGame } from '@/app/[locale]/(app)/games/actions'
import { cedis } from '@/lib/market/money'

import type { GameSkin } from './types'

export type SkinName = 'ads' | 'affiliate'

export const GAME_SKINS: Record<SkinName, GameSkin> = {
  /* Points, for people watching ads. Plays come with a plan. */
  ads: {
    play: playGame,
    unit: 'points',
    formatValue: (value) => value.toLocaleString(),
    formatWedge: (value) => (value > 0 ? value.toLocaleString() : '+1'),
    hubHref: '/games',
    moreHref: '/upgrade',
  },
  /* Cedis, for affiliates. Plays come with a training programme.
     Everything else, including every pixel of the wheel and the boxes, is the
     same component. */
  affiliate: {
    play: playAffiliateGameForBoard,
    unit: 'money',
    formatValue: (value) => cedis(value),
    /* A wedge has room for about five glyphs, so the currency word is dropped
       and only the figure is drawn. Under a cedi it keeps both decimals,
       because "0.1" on a prize wedge reads as a tenth of something rather
       than as ten pesewas. */
    formatWedge: (value) =>
      value <= 0
        ? '+1'
        : /* Two decimals throughout, so a wedge of prizes reads as one column
             of money: 0.10, 1.00, 2.50, 5.00. `toLocaleString` gave "1.5"
             beside "0.10", which looks like two different units. Above GHS 100
             the decimals are dropped, because five glyphs is all a wedge has. */
          value >= 10_000
          ? Math.round(value / 100).toLocaleString()
          : (value / 100).toFixed(2),
    hubHref: '/market/games',
    moreHref: '/shop',
  },
}
