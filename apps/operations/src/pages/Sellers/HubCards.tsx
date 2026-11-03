import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { sellerApplications } from '../../api/sellerApplications';
import { sellerSubmissions, sellers } from '../../api/sellers';

/**
 * The More tiles for the seller admin (owner, 2026-10-25): Sellers (badge = shops waiting for
 * approval), Seller applications (badge = new applications from blynk.lk/seller, 2026-10-27) and Seller
 * products (badge = products waiting for approval). Seller commission is reached from the Sellers screen.
 * The counts are an extra: a failure just shows no badge. Each tile loads its own count, and More only
 * mounts them while its Sellers category is open (2026-11-03). They render the link only: More wraps
 * each in its list item.
 */
function useCount(load: () => Promise<number>): number {
  const [n, setN] = useState(0);
  useEffect(() => {
    let live = true;
    load()
      .then((count) => live && setN(count))
      .catch(() => undefined);
    return () => {
      live = false;
    };
    // load is a fresh closure each render; the count is fetched once per mount
  }, []);
  return n;
}

export function SellersTile() {
  // Invite-only seller shops: add, approve, commission, payouts (owner, 2026-10-25).
  const waitingSellers = useCount(async () => (await sellers.list({ status: 'PENDING' })).length);
  return (
    <Link className="cat-hub__card" to="/more/sellers">
      <span className="cat-hub__title">Sellers</span>
      {waitingSellers > 0 ? (
        <span className="cat-hub__count" aria-label={`${waitingSellers} sellers waiting`}>
          {waitingSellers}
        </span>
      ) : null}
    </Link>
  );
}

export function SellerApplicationsTile() {
  // Shops that applied at blynk.lk/seller still NEW (owner's brother, 2026-10-27).
  const newApplications = useCount(async () => (await sellerApplications.list({ status: 'NEW' })).new_count);
  return (
    <Link className="cat-hub__card" to="/more/seller-applications">
      <span className="cat-hub__title">Seller applications</span>
      {newApplications > 0 ? (
        <span className="cat-hub__count" aria-label={`${newApplications} new applications`}>
          {newApplications}
        </span>
      ) : null}
    </Link>
  );
}

export function SellerProductsTile() {
  const waitingProducts = useCount(() => sellerSubmissions.pendingCount());
  return (
    <Link className="cat-hub__card" to="/more/seller-products">
      <span className="cat-hub__title">Seller products</span>
      {waitingProducts > 0 ? (
        <span className="cat-hub__count" aria-label={`${waitingProducts} products waiting`}>
          {waitingProducts}
        </span>
      ) : null}
    </Link>
  );
}
