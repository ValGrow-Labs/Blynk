import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { TrackingStatus } from '../components/TrackingStatus';

const css = readFileSync(resolve(__dirname, '../styles.css'), 'utf8');

/** The declarations of the rule whose selector is exactly `selector` (no rule = empty). */
function rule(selector: string): Record<string, string> {
  const start = css.indexOf(`\n${selector} {`);
  if (start < 0) return {};
  const body = css.slice(css.indexOf('{', start) + 1, css.indexOf('}', start));
  const declarations: Record<string, string> = {};
  for (const declaration of body.split(';')) {
    const colon = declaration.indexOf(':');
    if (colon > 0) declarations[declaration.slice(0, colon).trim()] = declaration.slice(colon + 1).trim();
  }
  return declarations;
}

/** The hex value of a `--name: #rrggbb;` custom property in :root. */
function token(name: string): string {
  const match = new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`).exec(css);
  if (!match) throw new Error(`token --${name} not found`);
  return match[1];
}

/** Resolves `var(--x)` to its hex value. */
function colour(value: string | undefined): string {
  const match = /var\(--([\w-]+)\)/.exec(value ?? '');
  if (!match) throw new Error(`not a token colour: ${value}`);
  return token(match[1]);
}

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5]
    .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 2.x contrast ratio. */
function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

describe('TrackingStatus looks (M9, M10)', () => {
  it('the CSS helper reads the real rules', () => {
    expect(rule('.tracking-status').color).toBe('var(--ink-2)');
    expect(token('green')).toBe('#0c831f');
    expect(contrast('#000000', '#ffffff')).toBeCloseTo(21, 3);
  });

  it('has an --active rule that is not the plain (stopped) look', () => {
    const plain = rule('.tracking-status');
    const active = rule('.tracking-status--active');
    expect(Object.keys(active).length).toBeGreaterThan(0);
    expect(colour(active.background)).not.toBe(colour(plain.background));
    expect(active['box-shadow']).toContain('var(--green)');
  });

  it('active text is >= 4.5:1 on its fill', () => {
    const active = rule('.tracking-status--active');
    const ratio = contrast(colour(active.color), colour(active.background));
    expect(ratio).toBeGreaterThanOrEqual(4.5);
    expect(ratio).toBeCloseTo(9.19, 1);
  });

  it('retrying text is >= 4.5:1 on its fill', () => {
    const retrying = rule('.tracking-status--retrying');
    const ratio = contrast(colour(retrying.color), colour(retrying.background));
    expect(ratio).toBeGreaterThanOrEqual(4.5);
    expect(ratio).toBeCloseTo(17.43, 1);
  });

  it('blocking error text stays >= 4.5:1', () => {
    const error = rule('.tracking-status--error');
    expect(contrast(colour(error.color), colour(error.background))).toBeGreaterThanOrEqual(4.5);
  });

  it('retrying is a different look from the blocking error and from the cancelled-order note', () => {
    const retrying = rule('.tracking-status--retrying');
    const error = rule('.tracking-status--error');
    const stop = rule('.slip__note--stop');
    expect(colour(retrying.background)).not.toBe(colour(error.background));
    expect(colour(retrying.background)).not.toBe(colour(stop.background));
    expect(retrying.border).toContain('2px solid');
  });

  it('marks each state with its own class', () => {
    const cls = (state: Parameters<typeof TrackingStatus>[0]['state']) =>
      render(<TrackingStatus state={state} />).container.querySelector('p')?.className;

    expect(cls({ permission: 'granted', active: true, lastSentAt: new Date(), lastError: null })).toBe(
      'tracking-status tracking-status--active'
    );
    expect(cls({ permission: 'granted', active: false, lastSentAt: new Date(), lastError: null })).toBe('tracking-status');
    expect(cls({ permission: 'granted', active: true, lastSentAt: null, lastError: 'network' })).toBe(
      'tracking-status tracking-status--retrying'
    );
    for (const blocked of [
      { permission: 'denied', active: false, lastSentAt: null, lastError: null },
      { permission: 'unavailable', active: false, lastSentAt: null, lastError: null },
      { permission: 'granted', active: true, lastSentAt: null, lastError: 'position_unavailable' },
    ] as const) {
      expect(cls(blocked)).toBe('tracking-status tracking-status--error');
    }
  });
});
