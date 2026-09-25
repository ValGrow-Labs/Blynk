import { ApiError, apiRequest } from '../api/client';

/**
 * Whether this signed-in ADMIN session also has working rider (delivery)
 * capability. Derived, never asserted - the plan (§7: "Three outcomes, all
 * already-implemented backend behavior") is explicit that this is
 * discovered by calling an existing rider-scoped endpoint and reading the
 * outcome, not by adding a new backend endpoint:
 *   - the call succeeds (even with an empty list)  -> ADMIN_PLUS_RIDER
 *   - 403 RIDER_PROFILE_NOT_FOUND / RIDER_INACTIVE  -> ADMIN_ONLY
 *   - anything else (network error, 500, an unrecognised code) -> ADMIN_ONLY,
 *     conservatively - a flaky probe must never grant a capability it
 *     hasn't actually proven, and this function must never throw/crash the
 *     caller.
 *
 * This is called directly with `apiRequest` rather than through
 * `resources.ts` - see that file's doc comment for why (F1 is scoped to the
 * `auth` domain only; a full `riders` domain section is a later task's
 * responsibility).
 */
export type RiderCapability = 'ADMIN_ONLY' | 'ADMIN_PLUS_RIDER';

/** The two 403 codes that mean "no usable rider profile," not "try again." */
const NO_RIDER_PROFILE_CODES = new Set(['RIDER_PROFILE_NOT_FOUND', 'RIDER_INACTIVE']);

/**
 * Re-probable on demand - AuthContext calls this once at login/session
 * restore, but it is exported standalone so a later screen (e.g. before
 * entering Delivery Mode fresh) can re-run it, since a rider profile can be
 * deactivated mid-session and this result must never be treated as a
 * standing authorization decision (common.md rule 5, plan §7's "UX
 * convenience only, never an authorization decision").
 */
export async function probeRiderCapability(): Promise<RiderCapability> {
  try {
    await apiRequest('/riders/deliveries');
    return 'ADMIN_PLUS_RIDER';
  } catch (err) {
    if (err instanceof ApiError && err.status === 403 && err.code && NO_RIDER_PROFILE_CODES.has(err.code)) {
      return 'ADMIN_ONLY';
    }
    // Any other failure (NETWORK, TIMEOUT, an unexpected 5xx, ...) also
    // degrades to ADMIN_ONLY rather than propagating - never crash the
    // caller over a courtesy classification.
    return 'ADMIN_ONLY';
  }
}
