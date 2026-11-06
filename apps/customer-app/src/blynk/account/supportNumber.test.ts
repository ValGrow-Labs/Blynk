import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';
import { SUPPORT } from './support';
import { HELP_HERO } from '../ui/strings';

/*
 * Owner 2026-11-05: Blynk gives no phone or WhatsApp number anywhere ("the current Blynk WhatsApp
 * number is not working ... we don't need to give a number"). Customers reach support by email
 * (SUPPORT.email), so no app code may carry the old number or a Call / WhatsApp link to Blynk.
 * (A rider's number on an order, tel: links to the rider, is another thing.)
 */
const SRC = fileURLToPath(new URL('../../', import.meta.url));
const files = (dir: string): string[] => readdirSync(dir).flatMap((n) => {
  const p = join(dir, n);
  if (statSync(p).isDirectory()) return files(p);
  return /\.(ts|tsx)$/.test(n) && !n.endsWith('.test.ts') ? [p] : [];
});
const rel = (f: string) => relative(SRC, f).split(sep).join('/');

test('support is an email address and there is no phone or WhatsApp in SUPPORT', () => {
  expect(SUPPORT.email).toBe('blynkquickc@gmail.com');
  expect(Object.keys(SUPPORT).filter((k) => /phone|whats/i.test(k))).toEqual([]);
});

test('the old Blynk number and a Blynk wa.me link are written nowhere in the app code', () => {
  const old = ['717107374', '71 710 7374', '071 710 7374'];
  const hits = files(SRC).filter((f) => {
    const t = readFileSync(f, 'utf8');
    return old.some((n) => t.includes(n)) || /wa\.me|api\.whatsapp\.com/.test(t);
  }).map(rel);
  expect(hits).toEqual([]);
}, 30_000);

test('Help has one Email us row and no Call us / WhatsApp us row', () => {
  expect(HELP_HERO.emailUs).toBe('Email us');
  expect(HELP_HERO.copied).toBe('Email address copied');
  expect(HELP_HERO).not.toHaveProperty('call');
  expect(HELP_HERO).not.toHaveProperty('whatsApp');
  for (const s of [HELP_HERO.copied, HELP_HERO.emailUs]) expect(s).not.toMatch(/\d{3}/);
});

test('the Help screen links mailto: the support address and never tel: / wa.me', () => {
  const help = readFileSync(join(SRC, 'app', '(tabs)', 'help.tsx'), 'utf8');
  expect(help).toContain('mailto:${SUPPORT.email}');
  expect(help).not.toMatch(/tel:|wa\.me|SUPPORT\.phone|whatsAppUrl/);
});
