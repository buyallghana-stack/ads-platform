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
import { playGame } from '@/app/[locale]/(app)/games/actions'

import type { GameSkin } from './types'

export type SkinName = 'ads'

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
}
