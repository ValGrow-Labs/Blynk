import { Fragment, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

/**
 * Settings grouped into categories on More (owner's brother, 2026-11-03: "make
 * every setting in categories, like Deliveries: under that all the delivery
 * related settings will be there"). A scrollable row of category chips; only the
 * chosen category's cards are mounted, so a hidden category never loads its
 * settings. The cards themselves are untouched.
 *
 * The chosen category lives in the URL hash, like every other More deep link:
 *  - `/more#settings-riders` opens a category by its id;
 *  - `/more#checkout-settings` (any card's own anchor, e.g. from Coupons or the
 *    rider map) opens the category that holds that card, and More scrolls to it;
 *  - anything else (or nothing) opens the first category, Deliveries.
 */

export interface SettingsItem {
  /** Stable key (also a React key). */
  key: string;
  /** Element ids inside this card that a `/more#...` link may point at. */
  anchors?: readonly string[];
  /** The card (or link tile) itself. */
  node: ReactNode;
}

export interface SettingsCategory {
  id: string;
  label: string;
  description: string;
  items: readonly SettingsItem[];
}

/** `/more#settings-<category id>` opens that category. */
export const SETTINGS_HASH_PREFIX = 'settings-';

export function categoryHash(id: string): string {
  return `#${SETTINGS_HASH_PREFIX}${id}`;
}

/** True for `#settings-...` (a category link, nothing on the page to scroll to). */
export function isCategoryHash(hash: string): boolean {
  return hash.replace(/^#/, '').startsWith(SETTINGS_HASH_PREFIX);
}

/** The category a URL hash points at; unknown or empty values give the first one. */
export function categoryForHash(hash: string, categories: readonly SettingsCategory[]): SettingsCategory {
  let raw = hash.replace(/^#/, '');
  try {
    raw = decodeURIComponent(raw);
  } catch {
    // keep the raw text: it just will not match anything
  }
  if (raw.startsWith(SETTINGS_HASH_PREFIX)) {
    const id = raw.slice(SETTINGS_HASH_PREFIX.length);
    return categories.find((c) => c.id === id) ?? categories[0];
  }
  return categories.find((c) => c.items.some((i) => i.anchors?.includes(raw))) ?? categories[0];
}

const tabId = (id: string) => `settings-tab-${id}`;
const PANEL_ID = 'settings-panel';

export function SettingsCategories({ categories }: { categories: readonly SettingsCategory[] }) {
  const { hash } = useLocation();
  const navigate = useNavigate();
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const selected = categoryForHash(hash, categories);

  function choose(id: string, focus = false) {
    navigate({ hash: categoryHash(id) }, { replace: true });
    const el = tabRefs.current[id];
    if (focus) el?.focus();
    el?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    let next = index;
    if (event.key === 'ArrowRight') next = (index + 1) % categories.length;
    else if (event.key === 'ArrowLeft') next = (index - 1 + categories.length) % categories.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = categories.length - 1;
    else return;
    event.preventDefault();
    choose(categories[next].id, true);
  }

  return (
    <section className="settings-cats" aria-labelledby="settings-cats-title">
      <h2 className="section-label" id="settings-cats-title">
        Settings
      </h2>
      <div className="settings-cats__tabs" role="tablist" aria-label="Settings categories">
        {categories.map((c, index) => {
          const isSelected = c.id === selected.id;
          return (
            <button
              key={c.id}
              ref={(el) => {
                tabRefs.current[c.id] = el;
              }}
              type="button"
              role="tab"
              id={tabId(c.id)}
              className={isSelected ? 'settings-cats__tab is-selected' : 'settings-cats__tab'}
              aria-selected={isSelected}
              aria-controls={PANEL_ID}
              tabIndex={isSelected ? 0 : -1}
              onClick={() => choose(c.id)}
              onKeyDown={(e) => onKeyDown(e, index)}
            >
              {c.label}
              <span className="settings-cats__count" aria-label={`${c.items.length} settings`}>
                {c.items.length}
              </span>
            </button>
          );
        })}
      </div>
      <div className="settings-cats__panel" role="tabpanel" id={PANEL_ID} aria-labelledby={tabId(selected.id)}>
        <p className="quiet settings-cats__about">{selected.description}</p>
        {/* Only this category is mounted: the others do not fetch anything. */}
        {selected.items.map((item) => (
          <Fragment key={item.key}>{item.node}</Fragment>
        ))}
      </div>
    </section>
  );
}
