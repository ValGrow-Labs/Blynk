import { Fragment, useEffect, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

/**
 * Everything on More sits in a category (owner's brother, 2026-11-03: "everything
 * should be categorised, see some rider things are above"). One scrollable row of
 * chips is the page's navigation; the chosen category shows its link tiles first
 * (same tile look as the old hub) and then its settings cards. Only the chosen
 * category is mounted, so a hidden category never loads its settings or its tile
 * count badges. The cards themselves are untouched.
 *
 * The chosen category lives in the URL hash, like every other More deep link:
 *  - `/more#settings-riders` opens a category by its id;
 *  - `/more#checkout-settings` (any card's own anchor, e.g. from Coupons or the
 *    rider map) opens the category that holds that card, and More scrolls to it;
 *  - with no hash, the category last opened this session (sessionStorage), so the
 *    bottom "More" tab and the Back button land where the staff member left off;
 *  - anything else opens the first category, Deliveries.
 * Choosing a chip replaces the history entry, so Back from a tile page returns to
 * `/more#settings-<id>` of the same category.
 */

export interface SettingsItem {
  /** Stable key (also a React key). */
  key: string;
  /** Element ids inside this card that a `/more#...` link may point at. */
  anchors?: readonly string[];
  /** The card, or (for a tile) the link inside the tile's list item. */
  node: ReactNode;
  /** False hides the item for this user (role gates). Default: visible. */
  visible?: boolean;
}

export interface SettingsCategory {
  id: string;
  label: string;
  description: string;
  /** Link tiles, shown first, in the hub tile look. */
  tiles?: readonly SettingsItem[];
  /** Settings cards, shown after the tiles. */
  cards?: readonly SettingsItem[];
}

/** `/more#settings-<category id>` opens that category. */
export const SETTINGS_HASH_PREFIX = 'settings-';

/** sessionStorage key for the last opened category. */
export const LAST_CATEGORY_KEY = 'blynk.ops.more.category';

export function categoryHash(id: string): string {
  return `#${SETTINGS_HASH_PREFIX}${id}`;
}

/** True for `#settings-...` (a category link, nothing on the page to scroll to). */
export function isCategoryHash(hash: string): boolean {
  return hash.replace(/^#/, '').startsWith(SETTINGS_HASH_PREFIX);
}

const shown = (items: readonly SettingsItem[] | undefined) => (items ?? []).filter((i) => i.visible !== false);

/** The categories that have something visible for this user. */
export function visibleCategories(categories: readonly SettingsCategory[]): SettingsCategory[] {
  return categories.filter((c) => shown(c.tiles).length + shown(c.cards).length > 0);
}

function readLast(): string | null {
  try {
    return window.sessionStorage.getItem(LAST_CATEGORY_KEY);
  } catch {
    return null;
  }
}

function writeLast(id: string) {
  try {
    window.sessionStorage.setItem(LAST_CATEGORY_KEY, id);
  } catch {
    // private mode: the hash still carries the choice
  }
}

/**
 * The category a URL hash points at. Empty hash: the remembered one, else the
 * first. An unknown value gives the first.
 */
export function categoryForHash(
  hash: string,
  categories: readonly SettingsCategory[],
  remembered: string | null = null
): SettingsCategory {
  let raw = hash.replace(/^#/, '');
  try {
    raw = decodeURIComponent(raw);
  } catch {
    // keep the raw text: it just will not match anything
  }
  if (raw === '') return categories.find((c) => c.id === remembered) ?? categories[0];
  if (raw.startsWith(SETTINGS_HASH_PREFIX)) {
    const id = raw.slice(SETTINGS_HASH_PREFIX.length);
    return categories.find((c) => c.id === id) ?? categories[0];
  }
  const holds = (c: SettingsCategory) => [...shown(c.tiles), ...shown(c.cards)].some((i) => i.anchors?.includes(raw));
  return categories.find(holds) ?? categories[0];
}

const tabId = (id: string) => `settings-tab-${id}`;
const PANEL_ID = 'settings-panel';

export function SettingsCategories({ categories: all }: { categories: readonly SettingsCategory[] }) {
  const { hash } = useLocation();
  const navigate = useNavigate();
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const categories = visibleCategories(all);
  const selected = categoryForHash(hash, categories, readLast());

  useEffect(() => {
    if (selected) writeLast(selected.id);
  }, [selected?.id]);

  if (!selected) return null;
  const tiles = shown(selected.tiles);
  const cards = shown(selected.cards);

  function choose(id: string, focus = false) {
    writeLast(id);
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
    <section className="settings-cats" aria-label="More">
      <div className="settings-cats__tabs" role="tablist" aria-label="More categories">
        {categories.map((c, index) => {
          const isSelected = c.id === selected.id;
          const count = shown(c.tiles).length + shown(c.cards).length;
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
              <span className="settings-cats__count" aria-label={`${count} items`}>
                {count}
              </span>
            </button>
          );
        })}
      </div>
      <div className="settings-cats__panel" role="tabpanel" id={PANEL_ID} aria-labelledby={tabId(selected.id)}>
        <p className="quiet settings-cats__about">{selected.description}</p>
        {/* Only this category is mounted: the others fetch nothing. */}
        {tiles.length > 0 ? (
          <ul className="cat-hub">
            {tiles.map((item) => (
              <li key={item.key}>{item.node}</li>
            ))}
          </ul>
        ) : null}
        {cards.map((item) => (
          <Fragment key={item.key}>{item.node}</Fragment>
        ))}
      </div>
    </section>
  );
}
