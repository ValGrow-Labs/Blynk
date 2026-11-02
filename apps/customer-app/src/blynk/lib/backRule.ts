/*
 * When a screen takes over the Android back button instead of leaving it to the navigator.
 *  - a screen with its own back arrow action ("to the shop", "to Orders") makes the hardware button
 *    do the same;
 *  - a screen with the plain back arrow only needs help when there is nothing to go back to (opened
 *    by a notification or a shared link): the arrow then goes Home, and so does the button, instead
 *    of closing the app.
 * Otherwise the navigator's own back runs (the previous screen).
 */
export function ownsBack(a: { customArrow: boolean; canGoBack: boolean }): boolean {
  return a.customArrow || !a.canGoBack;
}
