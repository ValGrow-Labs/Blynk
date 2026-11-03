import { useEffect, useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { riderApplications, settings } from '../api/resources';
import type {
  CheckoutSettings,
  DeliveryFeeInput,
  DeliveryFeeMode,
  DeliveryFeeSetting,
  RiderCommissionSetting,
  RiderTripsSetting,
} from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { PageHeader } from '../components/Layout';
import { KmTierEditor, TierModeChoice } from '../components/KmTierEditor';
import { ConfirmDialog, Spinner } from '../components/ui';
import { catalogErrorMessage, formatColomboDate, parseDeliveryFee, parseFreeDeliveryCount } from '../lib/catalog';
import { formatDateTime } from '../lib/inventory';
import { parseMaxFee, parseTierRows, tierAmountText, tiersSummary, tiersToRows } from '../lib/kmTiers';
import { formatPercent, parseCommissionPercent } from '../lib/riderPay';
import { MAX_DROPOFF_KM, MIN_DROPOFF_KM, TRIP_ORDER_CHOICES, formatKm, parseDropoffKm, tripOrdersLabel } from '../lib/riderTrips';
import { checkoutExtrasPatch, parseBasketAmount } from '../lib/checkoutExtras';
import { basePerKmOf, basePerKmText, basketFreeDeliveryText, parseBasePerKm } from '../lib/deliveryFee';
import { BasePerKmFields } from '../components/BasePerKmFields';
import { SmallOrderFeeCard } from '../components/SmallOrderFeeCard';
import { DeliveryRadiusCard } from '../components/DeliveryRadiusCard';
import { DeliveryZonesCard } from '../components/DeliveryZonesCard';
import { CartRulesCard } from '../components/CartRulesCard';
import { CustomerSmsLanguageCard } from '../components/CustomerSmsLanguageCard';
import { AppVersionCard } from '../components/AppUpdate';
import { AppUpdatesSettingsCard } from '../components/AppUpdatesSettingsCard';
import { DefaultMarkupCard } from '../components/DefaultMarkupCard';
import { RiderAutoAssignCard } from '../components/RiderAutoAssignCard';
import { PaymentGatewayCard } from '../components/PaymentGatewayCard';
import { SellerApplicationsTile, SellerProductsTile, SellersTile } from './Sellers/HubCards';
import { SettingsCategories, isCategoryHash, type SettingsCategory } from '../components/SettingsCategories';

/**
 * The More tab (plan §8: rider list, settings, sign-out). Sign-out is real,
 * working functionality. Task F7 replaces the "rider list ... built by a
 * later task" placeholder line with a real entry point to the new
 * `/more/riders` read-only roster (plan §14, common.md rule 9) - a link, not
 * a fabricated action, since the screen it leads to is itself read-only (no
 * rider create/activate/deactivate/edit capability exists in the backend).
 * The "Delivery fee" setting (store-wide, `GET|PATCH
 * /admin/settings/delivery-fee`) lives here as the app's settings area, with
 * the checkout switches (`GET|PATCH /admin/settings/checkout`; owner,
 * 2026-10-08): coupon codes on/off and free deliveries for every customer
 * since a start date (owner, 2026-10-09). The rider commission default
 * (`GET|PATCH /admin/settings/rider-commission`; owner, 2026-10-09) sits
 * beside them, and "Rider earnings" opens the per-rider earnings report.
 * Owner, 2026-10-10: "Rider trips" (`GET|PATCH /admin/settings/rider-trips`)
 * sets how many orders one rider may carry at once and how far apart their
 * drop-offs may be, and "Coupons" opens the coupon codes (/more/coupons).
 * /more#checkout-settings (the Coupons page's link) scrolls to Checkout.
 * Owner, 2026-10-13: "Global default markup" (`GET|PATCH
 * /admin/settings/default-markup`, migration 044) sits with the store
 * settings; /more#default-markup (linked from Catalog) scrolls to it.
 * Owner's brother, 2026-11-03: EVERYTHING on More (the link tiles and the
 * settings cards) sits in a category - Deliveries, Riders, Orders and payments,
 * Customers and rewards, Sellers, Team and app - behind one row of chips; the
 * page is just the header, who is signed in, the chips, the open category and
 * Sign out. /more#settings-<id> opens a category; any card's own anchor
 * (#checkout-settings, #default-markup, #rider-auto-assign ...) opens the
 * category that holds it. Only the open category is mounted (so only its tile
 * badges and settings load).
 */
export function More() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const { hash } = useLocation();

  // /more#checkout-settings (owner, 2026-10-10): the Coupons page links here
  // when coupon codes are off. The card loads after a moment, so retry briefly.
  useEffect(() => {
    if (!hash || isCategoryHash(hash)) return;
    let tries = 0;
    const timer = window.setInterval(() => {
      const el = document.getElementById(hash.slice(1));
      if (el || ++tries > 20) window.clearInterval(timer);
      el?.scrollIntoView?.({ block: 'start' });
    }, 100);
    return () => window.clearInterval(timer);
  }, [hash]);

  async function handleSignOut() {
    await signOut();
    navigate('/login', { replace: true });
  }

  return (
    <div className="page">
      <PageHeader title="More" description="Everything in one place, grouped by what it is for." />
      <section className="card">
        <p className="card__row">
          <span className="card__label">Signed in as</span>
          <span className="card__value">{user?.full_name ?? user?.phone ?? user?.email}</span>
        </p>
        <p className="card__row">
          <span className="card__label">Role</span>
          <span className="card__value">{user?.role}</span>
        </p>
      </section>

      <SettingsCategories categories={MORE_CATEGORIES} />

      <section className="card">
        <button type="button" className="button button--ghost" onClick={() => void handleSignOut()}>
          Sign out
        </button>
      </section>
    </div>
  );
}

/** A link tile (same look and wording as the old More hub tiles). */
function Tile({ to, title }: { to: string; title: string }) {
  return (
    <Link className="cat-hub__card" to={to}>
      <span className="cat-hub__title">{title}</span>
    </Link>
  );
}

/** Rider requests, with the number of applications waiting (loaded only while Riders is open). */
function RiderRequestsTile() {
  const [pending, setPending] = useState(0);
  useEffect(() => {
    let live = true;
    riderApplications
      .pendingCount()
      .then((n) => live && setPending(n))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);
  return (
    <Link className="cat-hub__card" to="/more/rider-requests">
      <span className="cat-hub__title">Rider requests</span>
      {pending > 0 ? (
        <span className="cat-hub__count" aria-label={`${pending} waiting`}>
          {pending}
        </span>
      ) : null}
    </Link>
  );
}

/**
 * Everything on More, by category (names and order as Admin where they overlap).
 * Each category lists its link tiles first, then its settings cards. Cards keep
 * their own code. `anchors` are the element ids a /more#... link may point at.
 * No tile or card is role-gated today (the tab itself is for every staff role);
 * set `visible: false` on an item to hide it, and a category with nothing
 * visible disappears with its chip.
 */
const MORE_CATEGORIES: readonly SettingsCategory[] = [
  {
    id: 'deliveries',
    label: 'Deliveries',
    description: 'Everything about getting an order to the customer: hours, fees, areas and riders on the road.',
    tiles: [
      // Where riders are and which orders wait for one (owner, 2026-10-25).
      { key: 'rider-map', node: <Tile to="/more/rider-map" title="Rider map" /> },
      { key: 'deliver', node: <Tile to="/more/deliver" title="Deliver orders myself" /> },
      // Each customer's saved addresses and orders per address (owner, 2026-10-11).
      { key: 'customers', node: <Tile to="/more/customers" title="Customer addresses" /> },
      // Opening hours, close the store now, holidays and delivery slots - one screen (owner, 2026-10-10).
      { key: 'opening-hours', node: <Tile to="/more/opening-hours" title="Opening hours" /> },
    ],
    cards: [
      { key: 'delivery-fee', anchors: ['delivery-fee-title'], node: <DeliveryFeeCard /> },
      // Small-order fee (2026-10-25): off by default; needs migration 063.
      { key: 'small-order-fee', anchors: ['small-order-fee'], node: <SmallOrderFeeCard /> },
      // Delivery radius (2026-10-25): how far from the store orders are accepted.
      { key: 'delivery-radius', anchors: ['delivery-radius'], node: <DeliveryRadiusCard /> },
      // Extra delivery areas (2026-11-01): separate circles such as Beruwala, added to the radius.
      { key: 'delivery-zones', anchors: ['delivery-zones'], node: <DeliveryZonesCard /> },
      { key: 'rider-trips', anchors: ['rider-trips-title'], node: <RiderTripsCard /> },
      // Automatic rider assignment (owner, 2026-10-25): off by default.
      { key: 'rider-auto-assign', anchors: ['rider-auto-assign'], node: <RiderAutoAssignCard /> },
    ],
  },
  {
    id: 'riders',
    label: 'Riders',
    description: 'Your riders: who they are, what they earn and what they are paid.',
    tiles: [
      { key: 'riders', node: <Tile to="/more/riders" title="Riders" /> },
      { key: 'rider-requests', node: <RiderRequestsTile /> },
      { key: 'cash', node: <Tile to="/more/cash" title="Cash" /> },
      { key: 'earnings', node: <Tile to="/more/earnings" title="Rider earnings" /> },
      // Rider pay model, rain/peak boosts, daily targets (owner, 2026-10-10).
      { key: 'rider-pay', node: <Tile to="/more/rider-pay" title="Rider pay" /> },
      // Which documents riders upload and must have verified (owner, 2026-10-10).
      { key: 'rider-documents', node: <Tile to="/more/rider-documents" title="Rider documents" /> },
    ],
    cards: [{ key: 'rider-commission', anchors: ['rider-commission-title'], node: <RiderCommissionCard /> }],
  },
  {
    id: 'orders',
    label: 'Orders and payments',
    description: 'Checkout, carts, online payments, prices, stock buying and the daily report.',
    tiles: [
      // The evening report SMS with the day's numbers (owner, 2026-10-25).
      { key: 'daily-report', node: <Tile to="/more/daily-report" title="Daily report" /> },
      // Reorder suggestions and supplier purchase orders (owner, 2026-10-25).
      { key: 'purchasing', node: <Tile to="/more/purchasing" title="Purchasing" /> },
      // Expiry dates (owner, 2026-10-25; migration 059): what is expired or expiring.
      { key: 'expiry', node: <Tile to="/more/expiry" title="Expiry" /> },
    ],
    cards: [
      { key: 'checkout', anchors: ['checkout-settings', 'checkout-settings-title'], node: <CheckoutSettingsCard /> },
      // Cart rules (owner, 2026-10-27): one seller per order, on by default.
      { key: 'cart-rules', anchors: ['cart-rules'], node: <CartRulesCard /> },
      // PayHere online payments (docs/api/payhere.md): on/off, window, methods; credentials Admin-only.
      { key: 'payment-gateway', anchors: ['payment-gateway-title'], node: <PaymentGatewayCard /> },
      // Selling prices (owner, 2026-10-13): the markup products fall back to.
      { key: 'default-markup', anchors: ['default-markup'], node: <DefaultMarkupCard /> },
    ],
  },
  {
    id: 'customers',
    label: 'Customers and rewards',
    description: 'Coupons, offers, messages and rewards for customers.',
    tiles: [
      // Coupon codes for customers (owner, 2026-10-10).
      { key: 'coupons', node: <Tile to="/more/coupons" title="Coupons" /> },
      { key: 'sms-offers', node: <Tile to="/more/sms-offers" title="SMS offers" /> },
      // Push to every customer who allowed notifications (owner, 2026-10-19).
      { key: 'notifications', node: <Tile to="/more/notifications" title="Notifications" /> },
      // Customers' "deliver this basket every Monday" subscriptions (2026-10-24).
      { key: 'repeat-baskets', node: <Tile to="/more/repeat-baskets" title="Repeat baskets" /> },
      // Order ratings and rider tips (2026-10-24).
      { key: 'ratings', node: <Tile to="/more/ratings" title="Ratings" /> },
      // Birthday-week gift and birthday SMS (owner, 2026-10-09).
      { key: 'birthday-offer', node: <Tile to="/more/birthday-offer" title="Birthday offer" /> },
      // Refer a friend rewards and referrals (owner, 2026-10-10).
      { key: 'refer-a-friend', node: <Tile to="/more/refer-a-friend" title="Refer a friend" /> },
      // Blynk Points: earn on delivered orders, spend at checkout (owner, 2026-10-10).
      { key: 'points', node: <Tile to="/more/points" title="Blynk Points" /> },
      // Blynk Wallet: refunds go to the customer's wallet (owner, 2026-10-15).
      { key: 'wallet', node: <Tile to="/more/wallet" title="Blynk Wallet" /> },
    ],
    // Customer SMS language (owner, 2026-10-12).
    cards: [{ key: 'sms-language', anchors: ['customer-sms-language-title'], node: <CustomerSmsLanguageCard /> }],
  },
  {
    id: 'sellers',
    label: 'Sellers',
    description: 'Sellers, their applications and their products.',
    // Badges: shops waiting, new applications, products waiting (each tile loads its own count).
    tiles: [
      { key: 'sellers', node: <SellersTile /> },
      { key: 'seller-applications', node: <SellerApplicationsTile /> },
      { key: 'seller-products', node: <SellerProductsTile /> },
    ],
  },
  {
    id: 'app',
    label: 'Team and app',
    description: 'Staff accounts, app updates and the app version.',
    tiles: [{ key: 'staff', node: <Tile to="/more/staff" title="Staff accounts" /> }],
    cards: [
      // In-app updates (owner, 2026-10-12): force or offer the new Ops / Rider APK.
      { key: 'app-updates', anchors: ['app-updates-title'], node: <AppUpdatesSettingsCard /> },
      // This phone's Blynk Ops version and "Check for updates".
      { key: 'app-version', anchors: ['app-version-title'], node: <AppVersionCard /> },
    ],
  },
];

/** Store-wide delivery fee. New orders use the saved value; placed orders
 * keep theirs (the server snapshots it on each order).
 *
 * Owner, 2026-10-10: the fee is either the same for every order (FLAT) or
 * worked out by distance (DISTANCE_TIERS): a per-km tier table on the road
 * distance from the store to the delivery address - every started km
 * counts, the last km's amount repeats - with an optional maximum.
 *
 * 2026-10-25: BASE_PER_KM - a base fee for the first km, then an amount for
 * every started km beyond it (optional maximum), with a live preview. */
const FEE_MODES: ReadonlyArray<{ id: DeliveryFeeMode; text: string }> = [
  { id: 'FLAT', text: 'Same fee for every order' },
  { id: 'DISTANCE_TIERS', text: 'By distance (per km)' },
  { id: 'BASE_PER_KM', text: 'Base + per km' },
];

function DeliveryFeeCard() {
  const [current, setCurrent] = useState<DeliveryFeeSetting | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [mode, setMode] = useState<DeliveryFeeMode>('FLAT');
  const [value, setValue] = useState('');
  const [rows, setRows] = useState<string[]>([]);
  const [cap, setCap] = useState('');
  const [bpk, setBpk] = useState({ base: '', baseKm: '', perKm: '' });
  const [error, setError] = useState<string | null>(null);
  const [rowErrors, setRowErrors] = useState<(string | undefined)[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function show(fee: DeliveryFeeSetting) {
    setCurrent(fee);
    setMode(fee.fee_mode ?? 'FLAT');
    setValue(String(fee.fee_lkr));
    setRows(tiersToRows(fee.tiers));
    setCap(typeof fee.max_fee_lkr === 'number' ? String(Number(fee.max_fee_lkr.toFixed(2))) : '');
    const f = basePerKmOf(fee);
    setBpk({ base: String(f.base_lkr), baseKm: String(f.base_km), perKm: String(f.per_km_lkr) });
  }

  useEffect(() => {
    settings.deliveryFee
      .get()
      .then(show)
      .catch((err) => setLoadError(catalogErrorMessage(err)));
  }, []);

  function pickMode(next: DeliveryFeeMode) {
    setMode(next);
    setError(null);
    setRowErrors([]);
    setNotice(null);
    // No tiers stored yet: start km 1 at the current flat fee (owner, 2026-10-10).
    if (next === 'DISTANCE_TIERS' && rows.length === 0) {
      setRows([value.trim() || (current ? String(current.fee_lkr) : '')]);
    }
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    setNotice(null);
    let body: DeliveryFeeInput;
    if (mode === 'FLAT') {
      const parsed = parseDeliveryFee(value);
      if ('error' in parsed) {
        setError(parsed.error);
        return;
      }
      body = { fee_mode: 'FLAT', fee_lkr: parsed.value };
    } else if (mode === 'BASE_PER_KM') {
      const parsed = parseBasePerKm(bpk);
      if ('error' in parsed) {
        setError(parsed.error);
        return;
      }
      const max = parseMaxFee(cap);
      if ('error' in max) {
        setError(`Maximum fee: ${max.error}`);
        return;
      }
      body = { fee_mode: 'BASE_PER_KM', ...parsed.value, max_fee_lkr: max.value };
    } else {
      const parsed = parseTierRows(rows);
      if ('error' in parsed) {
        setRowErrors(parsed.rowErrors);
        setError(parsed.error);
        return;
      }
      const max = parseMaxFee(cap);
      if ('error' in max) {
        setRowErrors([]);
        setError(`Maximum fee: ${max.error}`);
        return;
      }
      body = { fee_mode: 'DISTANCE_TIERS', tiers: parsed.tiers, max_fee_lkr: max.value };
    }
    setError(null);
    setRowErrors([]);
    setSaving(true);
    try {
      const saved = await settings.deliveryFee.update(body);
      show(saved);
      const savedMode = saved.fee_mode ?? 'FLAT';
      setNotice(
        savedMode === 'DISTANCE_TIERS'
          ? `Delivery fee saved: by distance, ${feeTiersText(saved)}.`
          : savedMode === 'BASE_PER_KM'
            ? `Delivery fee saved: ${feeFormulaText(saved)}.`
            : `Delivery fee saved: LKR ${Number(saved.fee_lkr).toFixed(2)}.`
      );
    } catch (err) {
      setError(catalogErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  const loading = !current && !loadError;
  const parsedCap = parseMaxFee(cap);
  const capValue = 'value' in parsedCap ? parsedCap.value : null;
  const currentByDistance = (current?.fee_mode ?? 'FLAT') === 'DISTANCE_TIERS';
  const currentBasePerKm = current?.fee_mode === 'BASE_PER_KM';

  return (
    <section className="card" aria-labelledby="delivery-fee-title">
      <h2 className="section-label" id="delivery-fee-title">
        Delivery fee
      </h2>
      {current ? (
        <>
          <p className="card__row">
            <span className="card__label">Current fee</span>
            <span className="card__value mono">
              {currentByDistance ? 'By distance' : currentBasePerKm ? 'Base + per km' : `LKR ${Number(current.fee_lkr).toFixed(2)}`}
            </span>
          </p>
          {currentByDistance ? (
            <p className="quiet" data-testid="fee-tiers-now">
              {feeTiersText(current)}
            </p>
          ) : null}
          {currentBasePerKm ? (
            <p className="quiet" data-testid="fee-formula-now">
              {feeFormulaText(current)}
            </p>
          ) : null}
        </>
      ) : loadError ? (
        <p className="field__error">{loadError}</p>
      ) : (
        <Spinner label="Loading delivery fee" />
      )}
      {current?.updated_at ? <p className="quiet">Last changed {formatDateTime(current.updated_at)}</p> : null}
      <form className="form" onSubmit={save} noValidate>
        <div className="field">
          <TierModeChoice<DeliveryFeeMode>
            label="How the fee is worked out"
            options={FEE_MODES}
            value={mode}
            onPick={pickMode}
            disabled={loading}
          />
          <span className="field__hint">
            {mode === 'FLAT'
              ? 'Every order pays the same fee.'
              : mode === 'BASE_PER_KM'
                ? 'The base fee covers the first km, then every started km beyond it adds the per-km amount. Road distance, store to the delivery address. Free deliveries still apply.'
                : 'Worked out from the road distance, store to the delivery address. Free deliveries still apply.'}
          </span>
        </div>
        {mode === 'FLAT' ? (
          <div className="fee-form">
            <label className="field">
              <span className="field__label">New fee (LKR)</span>
              <input
                className="input"
                inputMode="decimal"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                aria-invalid={error ? true : undefined}
                disabled={loading}
              />
            </label>
            <button type="submit" className="button" disabled={saving || loading}>
              {saving ? <Spinner label="Saving" /> : 'Save'}
            </button>
          </div>
        ) : (
          <>
            {mode === 'BASE_PER_KM' ? (
              <BasePerKmFields
                base={bpk.base}
                baseKm={bpk.baseKm}
                perKm={bpk.perKm}
                onChange={setBpk}
                cap={capValue}
                error={error}
                disabled={loading}
              />
            ) : (
              <KmTierEditor
                label="Price per km"
                rows={rows}
                onChange={(next) => {
                  setRows(next);
                  setRowErrors([]);
                }}
                rowErrors={rowErrors}
                cap={capValue}
                disabled={loading}
              />
            )}
            <div className="field">
              <label className="field">
                <span className="field__label">Maximum fee (LKR, optional)</span>
                <input
                  className="input"
                  inputMode="decimal"
                  value={cap}
                  onChange={(e) => setCap(e.target.value)}
                  disabled={loading}
                />
              </label>
              <span className="field__hint">Blank = no maximum. A long trip never costs the customer more than this.</span>
            </div>
            <button type="submit" className="button" disabled={saving || loading}>
              {saving ? <Spinner label="Saving" /> : 'Save'}
            </button>
          </>
        )}
      </form>
      {error ? <p className="field__error" role="alert">{error}</p> : null}
      {notice ? <p className="quiet quiet--ok" role="status">{notice}</p> : null}
      <p className="page__note">Orders already placed keep the fee they were placed with.</p>
    </section>
  );
}

/** "LKR 120 up to 2 km, then LKR 40 for each extra km · max LKR 250" for a base + per km fee. */
function feeFormulaText(fee: DeliveryFeeSetting): string {
  return basePerKmText(basePerKmOf(fee), typeof fee.max_fee_lkr === 'number' ? fee.max_fee_lkr : null);
}

/** "km 1 LKR 100, km 2 LKR 60, km 3+ LKR 50 · max LKR 250" for a by-distance fee. */
function feeTiersText(fee: DeliveryFeeSetting): string {
  const text = tiersSummary(fee.tiers ?? []);
  return typeof fee.max_fee_lkr === 'number' ? `${text} · max LKR ${tierAmountText(fee.max_fee_lkr)}` : text;
}

/** Coupon codes at checkout, and free deliveries for every customer -
 * existing ones too - counted from a start date (owner, 2026-10-09). New
 * orders follow the saved switches; placed orders keep their fee. */
function CheckoutSettingsCard() {
  const [current, setCurrent] = useState<CheckoutSettings | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [coupons, setCoupons] = useState(false);
  const [savings, setSavings] = useState(false);
  const [freeOn, setFreeOn] = useState(true);
  const [count, setCount] = useState('2');
  // Owner, 2026-10-12: free delivery above a basket amount, and ordering for someone else.
  const [basketOn, setBasketOn] = useState(false);
  const [basketAmount, setBasketAmount] = useState('3000');
  const [forOthersOn, setForOthersOn] = useState(true);
  const [codeToReceiver, setCodeToReceiver] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmRestart, setConfirmRestart] = useState(false);

  function show(s: CheckoutSettings) {
    setCurrent(s);
    setCoupons(s.coupons_enabled);
    setSavings(s.show_offer_savings === true);
    setFreeOn(s.new_customer_free_deliveries.enabled);
    setCount(String(s.new_customer_free_deliveries.count));
    setBasketOn(s.basket_free_delivery?.enabled === true);
    setBasketAmount(String(s.basket_free_delivery?.min_subtotal_lkr ?? 3000));
    setForOthersOn(s.order_for_someone_else?.enabled ?? true);
    setCodeToReceiver(s.order_for_someone_else?.send_code_to_receiver ?? true);
  }

  useEffect(() => {
    settings.checkout
      .get()
      .then(show)
      .catch((err) => setLoadError(catalogErrorMessage(err)));
  }, []);

  async function save(event: FormEvent) {
    event.preventDefault();
    setNotice(null);
    const parsed = parseFreeDeliveryCount(count);
    if ('error' in parsed) {
      setError(parsed.error);
      return;
    }
    const basket = parseBasketAmount(basketAmount);
    if (basketOn && 'error' in basket) {
      setError(basket.error);
      return;
    }
    setError(null);
    setSaving(true);
    try {
      show(
        await settings.checkout.update({
          coupons_enabled: coupons,
          new_customer_free_deliveries: { enabled: freeOn, count: parsed.value },
          // Sent only when flipped, so saving the other switches works
          // against a backend from before this one (owner, 2026-10-10).
          ...(savings !== (current?.show_offer_savings === true) ? { show_offer_savings: savings } : {}),
          // Owner, 2026-10-12: likewise sent only when changed.
          ...checkoutExtrasPatch(current, {
            basketOn,
            basketAmount: 'amount' in basket ? basket.amount : null,
            forOthersOn,
            codeToReceiver,
          }),
        })
      );
      setNotice('Checkout settings saved.');
    } catch (err) {
      setError(catalogErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  /** Start the count again from now (owner, 2026-10-09): orders placed
   * before this moment stop using up anyone's free deliveries. Sends the
   * saved switch and count, so only the start date changes. */
  async function restartFromToday() {
    if (!current) return;
    setConfirmRestart(false);
    setNotice(null);
    setError(null);
    setSaving(true);
    try {
      // only the saved baseline moves: the switches and numbers being edited above stay as they are
      // (owner, 2026-10-23: "why its not saving" - the restart reloaded the card and dropped the edits)
      setCurrent(
        await settings.checkout.update({
          new_customer_free_deliveries: {
            enabled: current.new_customer_free_deliveries.enabled,
            count: current.new_customer_free_deliveries.count,
            since: new Date().toISOString(),
          },
        })
      );
      setNotice('Free deliveries now count from today. Your other changes above are not saved yet: press Save.');
    } catch (err) {
      setError(catalogErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="card" id="checkout-settings" aria-labelledby="checkout-settings-title">
      <h2 className="section-label" id="checkout-settings-title">
        Checkout
      </h2>
      {loadError ? (
        <p className="field__error">{loadError}</p>
      ) : !current ? (
        <Spinner label="Loading checkout settings" />
      ) : (
        <form className="form" onSubmit={save} noValidate>
          <label className="toggle">
            <input type="checkbox" checked={coupons} onChange={(e) => setCoupons(e.target.checked)} />
            <span>
              <strong>Coupon codes at checkout</strong>
              <em>When off, the app hides the coupon field.</em>
            </span>
          </label>
          <label className="toggle">
            <input type="checkbox" checked={savings} onChange={(e) => setSavings(e.target.checked)} />
            <span>
              <strong>Show 'Save LKR' on offers</strong>
              <em>The customer app shows how much an offer or combo saves, e.g. "Save LKR 50".</em>
            </span>
          </label>
          <label className="toggle">
            <input type="checkbox" checked={freeOn} onChange={(e) => setFreeOn(e.target.checked)} />
            <span>
              <strong>Free deliveries for every customer</strong>
              <em>Existing customers too. Cancelled orders do not use one up.</em>
            </span>
          </label>
          <label className="field">
            <span className="field__label">Free deliveries per customer</span>
            <input
              className="input"
              inputMode="numeric"
              value={count}
              onChange={(e) => setCount(e.target.value)}
              aria-invalid={error ? true : undefined}
              disabled={!freeOn}
            />
          </label>
          <div className="checkout-since">
            <p className="quiet">
              Counting orders since <strong>{formatColomboDate(current.new_customer_free_deliveries.since)}</strong>
            </p>
            <button
              type="button"
              className="button button--ghost button--sm"
              onClick={() => setConfirmRestart(true)}
              disabled={saving}
            >
              Start again from today
            </button>
          </div>
          <label className="toggle">
            <input type="checkbox" checked={basketOn} onChange={(e) => setBasketOn(e.target.checked)} />
            <span>
              <strong>Free delivery above a basket amount</strong>
              <em>
                {basketFreeDeliveryText(basketAmount)} The rider is still paid their normal share of the delivery fee; Blynk covers it.
                Item total is after product offers, before coupons. Does not use up a free delivery. Not on the website.
              </em>
            </span>
          </label>
          <label className="field">
            <span className="field__label">Free delivery from (LKR)</span>
            <input
              className="input"
              inputMode="decimal"
              value={basketAmount}
              onChange={(e) => setBasketAmount(e.target.value)}
              disabled={!basketOn}
            />
          </label>
          <label className="toggle">
            <input type="checkbox" checked={forOthersOn} onChange={(e) => setForOthersOn(e.target.checked)} />
            <span>
              <strong>Allow ordering for someone else</strong>
              <em>The receiver and the buyer both get the order texts.</em>
            </span>
          </label>
          <label className="toggle">
            <input
              type="checkbox"
              checked={codeToReceiver}
              onChange={(e) => setCodeToReceiver(e.target.checked)}
              disabled={!forOthersOn}
            />
            <span>
              <strong>Send delivery code to receiver</strong>
              <em>When off, only the buyer gets the delivery code.</em>
            </span>
          </label>
          <button type="submit" className="button" disabled={saving}>
            {saving ? <Spinner label="Saving" /> : 'Save'}
          </button>
        </form>
      )}
      {confirmRestart ? (
        <ConfirmDialog
          title="Start free deliveries again from today?"
          message="Orders placed until now stop counting, so every customer gets their free deliveries again."
          confirmLabel="Start again"
          onConfirm={() => void restartFromToday()}
          onCancel={() => setConfirmRestart(false)}
        />
      ) : null}
      {error ? <p className="field__error" role="alert">{error}</p> : null}
      {notice ? <p className="quiet quiet--ok" role="status">{notice}</p> : null}
      {current?.updated_at ? <p className="quiet">Last changed {formatDateTime(current.updated_at)}</p> : null}
    </section>
  );
}

/** The % of the STANDARD delivery fee a commission rider earns (owner,
 * 2026-10-09). A rider with their own % (Riders -> Change pay) keeps it;
 * company riders earn no commission. */
function RiderCommissionCard() {
  const [current, setCurrent] = useState<RiderCommissionSetting | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    settings.riderCommission
      .get()
      .then((s) => {
        setCurrent(s);
        setValue(String(s.default_percent));
      })
      .catch((err) => setLoadError(catalogErrorMessage(err)));
  }, []);

  async function save(event: FormEvent) {
    event.preventDefault();
    setNotice(null);
    const parsed = parseCommissionPercent(value);
    if ('error' in parsed) {
      setError(parsed.error);
      return;
    }
    setError(null);
    setSaving(true);
    try {
      const saved = await settings.riderCommission.update(parsed.value);
      setCurrent(saved);
      setValue(String(saved.default_percent));
      setNotice(`Rider commission saved: ${formatPercent(saved.default_percent)}.`);
    } catch (err) {
      setError(catalogErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="card" aria-labelledby="rider-commission-title">
      <h2 className="section-label" id="rider-commission-title">
        Rider commission
      </h2>
      {loadError ? (
        <p className="field__error">{loadError}</p>
      ) : !current ? (
        <Spinner label="Loading rider commission" />
      ) : (
        <>
          <p className="card__row">
            <span className="card__label">Default share</span>
            <span className="card__value mono">{formatPercent(current.default_percent)}</span>
          </p>
          <form className="fee-form" onSubmit={save} noValidate>
            <label className="field">
              <span className="field__label">Default commission (%)</span>
              <input
                className="input"
                inputMode="decimal"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                aria-invalid={error ? true : undefined}
              />
            </label>
            <button type="submit" className="button" disabled={saving}>
              {saving ? <Spinner label="Saving" /> : 'Save'}
            </button>
          </form>
        </>
      )}
      {error ? <p className="field__error" role="alert">{error}</p> : null}
      {notice ? <p className="quiet quiet--ok" role="status">{notice}</p> : null}
      {current?.updated_at ? <p className="quiet">Last changed {formatDateTime(current.updated_at)}</p> : null}
      <p className="page__note">
        Commission riders earn this share of the standard delivery fee, unless they have their own. Company riders earn no commission.
        {/* Owner, 2026-10-10: fixed / distance pay, boosts and bonuses live on Rider pay. */}{' '}
        Fixed or distance pay, boosts and bonuses are under Rider pay above.
      </p>
    </section>
  );
}

/** Rider trips (owner, 2026-10-10: "ops can control the 2 orders for one
 * delivery if it's in the same route"). Assigning a rider follows these:
 * at most this many open orders per rider, and a second drop-off farther
 * than the distance from one they already hold needs staff to confirm. */
function RiderTripsCard() {
  const [current, setCurrent] = useState<RiderTripsSetting | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [orders, setOrders] = useState<number | null>(null);
  const [km, setKm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function show(s: RiderTripsSetting) {
    setCurrent(s);
    setOrders(s.max_active_deliveries);
    setKm(String(Number(s.max_dropoff_distance_km.toFixed(1))));
  }

  useEffect(() => {
    settings.riderTrips
      .get()
      .then(show)
      .catch((err) => setLoadError(catalogErrorMessage(err)));
  }, []);

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!current) return;
    setNotice(null);
    if (orders === null || !(TRIP_ORDER_CHOICES as readonly number[]).includes(orders)) {
      setError('Pick how many orders one rider can carry.');
      return;
    }
    const parsed = parseDropoffKm(km);
    if ('error' in parsed) {
      setError(parsed.error);
      return;
    }
    setError(null);
    setSaving(true);
    try {
      const saved = await settings.riderTrips.update({ max_active_deliveries: orders, max_dropoff_distance_km: parsed.value });
      show(saved);
      setNotice(`Rider trips saved: ${tripOrdersLabel(saved.max_active_deliveries)}, ${formatKm(saved.max_dropoff_distance_km)}.`);
    } catch (err) {
      setError(catalogErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="card" aria-labelledby="rider-trips-title">
      <h2 className="section-label" id="rider-trips-title">
        Rider trips
      </h2>
      {loadError ? (
        <p className="field__error">{loadError}</p>
      ) : !current ? (
        <Spinner label="Loading rider trips" />
      ) : (
        <form className="form" onSubmit={save} noValidate>
          <p className="card__row">
            <span className="card__label">Now</span>
            <span className="card__value">
              {tripOrdersLabel(current.max_active_deliveries)}, {formatKm(current.max_dropoff_distance_km)}
            </span>
          </p>
          <div className="field">
            <span className="field__label" id="trip-orders-label">
              Orders one rider can carry at once
            </span>
            <div className="segmented" role="group" aria-labelledby="trip-orders-label">
              {TRIP_ORDER_CHOICES.map((n) => (
                <button
                  key={n}
                  type="button"
                  className={n === orders ? 'segmented__item is-selected' : 'segmented__item'}
                  aria-pressed={n === orders}
                  aria-label={tripOrdersLabel(n)}
                  onClick={() => setOrders(n)}
                >
                  {n}
                </button>
              ))}
            </div>
            <span className="field__hint">1 = no trips: one order per rider.</span>
          </div>
          <label className="field">
            <span className="field__label">Max distance between drop-offs (km)</span>
            <input
              className="input"
              inputMode="decimal"
              value={km}
              onChange={(e) => setKm(e.target.value)}
              aria-invalid={error ? true : undefined}
            />
            <span className="field__hint">
              {MIN_DROPOFF_KM} to {MAX_DROPOFF_KM} km, straight line.
            </span>
          </label>
          <button type="submit" className="button" disabled={saving}>
            {saving ? <Spinner label="Saving" /> : 'Save'}
          </button>
        </form>
      )}
      {error ? <p className="field__error" role="alert">{error}</p> : null}
      {notice ? <p className="quiet quiet--ok" role="status">{notice}</p> : null}
      {current?.updated_at ? <p className="quiet">Last changed {formatDateTime(current.updated_at)}</p> : null}
      <p className="page__note">
        A second order is refused for that rider if its drop-off is farther than this, unless staff confirm.
      </p>
    </section>
  );
}
