/*
 * Where the Android back button / the back arrow on the code screen (/otp) goes. Pure, so the
 * hardware button and the arrow share one rule and the tests pin it.
 *  - a code is being checked or re-sent: stay (the request must finish);
 *  - opened by the start gate: the number screen of the gate (nothing useful is underneath);
 *  - otherwise: back where it came from, or the cart when the screen was opened cold.
 */
export type OtpBack = 'stay' | 'gate-login' | 'back' | 'cart';

export function otpBackAction(a: { busy: boolean; gate: boolean; canGoBack: boolean }): OtpBack {
  if (a.busy) return 'stay';
  if (a.gate) return 'gate-login';
  return a.canGoBack ? 'back' : 'cart';
}
