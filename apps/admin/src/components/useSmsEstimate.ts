import { useEffect, useRef, useState } from 'react';
import type { SmsOfferEstimate } from '../api/types';
import { smsOfferErrorMessage } from '../lib/smsOffers';

/** Wait this long after the last change before asking for a new estimate. */
export const ESTIMATE_DELAY_MS = 400;

export type Estimate = { key: string; data: SmsOfferEstimate } | { key: string; error: string } | null;

/**
 * The live "who gets it" numbers: `body` as a JSON string (the key; '' = nothing valid to ask yet),
 * asked after a short pause, and only the answer for the latest inputs is kept. The caller compares
 * `estimate.key` with its own key to know whether the figures are stale.
 */
export function useSmsEstimate(key: string, run: (body: never) => Promise<SmsOfferEstimate>, failure: string): Estimate {
  const [estimate, setEstimate] = useState<Estimate>(null);
  const latest = useRef(key);
  const runRef = useRef(run);
  runRef.current = run;

  useEffect(() => {
    latest.current = key;
    if (!key) return;
    const timer = setTimeout(() => {
      runRef
        .current(JSON.parse(key) as never)
        .then((data) => {
          if (latest.current === key) setEstimate({ key, data });
        })
        .catch((err) => {
          if (latest.current === key) setEstimate({ key, error: smsOfferErrorMessage(err, failure) });
        });
    }, ESTIMATE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [key, failure]);

  return estimate;
}
