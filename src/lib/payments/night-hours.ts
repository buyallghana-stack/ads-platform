/**
 * Whether the hour (Ghana time, which is GMT all year) falls in the closed
 * stretch. It wraps midnight: close 22, open 8 means 22:00 to 07:59. Equal
 * hours mean never closed.
 */
export function isNightClosed(hour: number, closeHour: number, openHour: number): boolean {
  if (closeHour === openHour) return false
  return closeHour > openHour ? hour >= closeHour || hour < openHour : hour >= closeHour && hour < openHour
}
