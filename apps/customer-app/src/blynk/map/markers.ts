/*
 * The tracking map's two markers as SVG text, shared by the web map (it puts them in a DOM node)
 * and the phone's WebView page. Fixed strings only: nothing in them comes from the customer.
 */

/** The door: an ink pin with a yellow house (the delivery address). */
export const DOOR_SVG =
  '<svg width="30" height="40" viewBox="0 0 32 46"><path d="M16 1a15 15 0 0115 15c0 7.5-5.4 13.3-12 14.7L16 35l-3-4.3C6.4 29.3 1 23.5 1 16A15 15 0 0116 1z" fill="#1A1D2E" stroke="#fff" stroke-width="1.8"/><path d="M10 17.5l6-5 6 5V23h-4v-3.5h-4V23h-4z" fill="#FFE141"/></svg>';

/** The rider: a yellow disc with an arrow that turns with the heading; grey while the position is stale. */
export const riderSvg = (stale: boolean) =>
  `<svg width="38" height="38" viewBox="0 0 38 38"><circle cx="19" cy="19" r="15" fill="${stale ? '#C9CAD3' : '#FFE141'}" stroke="#1A1D2E" stroke-width="2"/><path d="M19 9l6 14-6-3.6-6 3.6z" fill="#1A1D2E"/></svg>`;
