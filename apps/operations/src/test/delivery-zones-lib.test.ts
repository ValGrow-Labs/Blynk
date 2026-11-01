import { describe, expect, it } from 'vitest';
import {
  centreOf,
  draftsOf,
  newZoneDraft,
  pasteToCoordinates,
  slugOf,
  zoneErrors,
  zoneIds,
  zonesBody,
  zonesChanged,
  zonesSummary,
  type DeliveryZone,
} from '../lib/deliveryZones';

/** Extra delivery areas helper (2026-11-01, docs/superpowers/plans/2026-11-01-extra-delivery-areas.md, A and O). */
const BERUWALA: DeliveryZone = { id: 'beruwala', name: 'Beruwala', lat: 6.4759, lng: 79.9842, radius_km: 3, enabled: false };

const filled = (over: Partial<ReturnType<typeof newZoneDraft>> = {}) => ({ ...newZoneDraft(), name: 'Maggona', lat: '6.52', lng: '79.97', radius: '2', ...over });

describe('delivery zones helper', () => {
  it('makes slugs from names', () => {
    expect(slugOf('Beruwala Town')).toBe('beruwala-town');
    expect(slugOf('  Dharga   Town!! ')).toBe('dharga-town');
    expect(slugOf('???')).toBe('');
  });

  it('builds the exact PUT body from the stored rows (a saved zone keeps its id)', () => {
    const drafts = draftsOf([BERUWALA]);
    drafts[0].enabled = true;
    expect(zonesBody(drafts)).toEqual({ body: { zones: [{ ...BERUWALA, enabled: true }] } });
  });

  it('gives a new row the slug of its name, unique within the list', () => {
    const a = filled({ name: 'Maggona' });
    const b = filled({ name: 'Maggona' });
    const stored = draftsOf([{ ...BERUWALA, id: 'maggona' }]);
    expect(zoneIds([...stored, a, b])).toEqual(['maggona', 'maggona-2', 'maggona-3']);
  });

  it('trims, reads "2.25 km" and keeps radius decimals', () => {
    const r = zonesBody([filled({ name: ' Maggona ', lat: ' 6.52 ', radius: '2.25 km' })]);
    expect(r).toMatchObject({ body: { zones: [{ id: 'maggona', name: 'Maggona', lat: 6.52, lng: 79.97, radius_km: 2.25, enabled: true }] } });
  });

  it('checks the name', () => {
    expect(zoneErrors(filled({ name: '  ' })).name).toMatch(/name/i);
    expect(zoneErrors(filled({ name: 'x'.repeat(41) })).name).toBe('At most 40 characters.');
    expect(zoneErrors(filled({ name: 'x'.repeat(40) })).name).toBeUndefined();
    expect(zoneErrors(filled({ name: '???' })).name).toMatch(/letters or numbers/);
  });

  it('checks the Sri Lanka box for the centre', () => {
    expect(zoneErrors(filled({ lat: '4.99' })).lat).toMatch(/5 to 10/);
    expect(zoneErrors(filled({ lat: '10.01' })).lat).toBeDefined();
    expect(zoneErrors(filled({ lat: '5' })).lat).toBeUndefined();
    expect(zoneErrors(filled({ lng: '77.9' })).lng).toMatch(/78 to 83/);
    expect(zoneErrors(filled({ lng: '83.1' })).lng).toBeDefined();
    expect(zoneErrors(filled({ lng: 'abc' })).lng).toBeDefined();
    expect(zoneErrors(filled({ lat: '' })).lat).toBeDefined();
  });

  it('checks the radius 0.5 to 15, at most 2 decimals', () => {
    expect(zoneErrors(filled({ radius: '0.4' })).radius).toBeDefined();
    expect(zoneErrors(filled({ radius: '0.5' })).radius).toBeUndefined();
    expect(zoneErrors(filled({ radius: '15' })).radius).toBeUndefined();
    expect(zoneErrors(filled({ radius: '15.01' })).radius).toBeDefined();
    expect(zoneErrors(filled({ radius: '3.333' })).radius).toBeDefined();
    expect(zoneErrors(filled({ radius: '' })).radius).toBeDefined();
  });

  it('returns the errors per row and refuses more than 10 areas', () => {
    const bad = filled({ name: '' });
    const r = zonesBody([filled(), bad]);
    expect('errors' in r && r.errors[bad.key].name).toBeDefined();
    const many = Array.from({ length: 11 }, (_, i) => filled({ name: `Area ${i}` }));
    const m = zonesBody(many);
    expect('errors' in m && m.error).toBe('At most 10 extra areas.');
    expect('body' in zonesBody(many.slice(0, 10))).toBe(true);
  });

  it('reads a pasted Google Maps link or "lat, lng" (the seller location parser)', () => {
    expect(pasteToCoordinates('6.4759, 79.9842')).toEqual({ lat: '6.4759', lng: '79.9842' });
    expect(pasteToCoordinates('https://www.google.com/maps/place/Beruwala/@6.4759,79.9842,15z')).toEqual({ lat: '6.4759', lng: '79.9842' });
    expect(pasteToCoordinates('https://www.google.com/maps?q=6.4759,79.9842')).toEqual({ lat: '6.4759', lng: '79.9842' });
    expect(pasteToCoordinates('nowhere')).toBeNull();
  });

  it('finds the centre for the Maps link only when both numbers are valid', () => {
    expect(centreOf({ lat: '6.4759', lng: '79.9842' })).toEqual({ lat: 6.4759, lng: 79.9842 });
    expect(centreOf({ lat: '', lng: '79.9842' })).toBeNull();
  });

  it('knows when the rows differ from what is stored', () => {
    const drafts = draftsOf([BERUWALA]);
    expect(zonesChanged(drafts, [BERUWALA])).toBe(false);
    drafts[0].enabled = true;
    expect(zonesChanged(drafts, [BERUWALA])).toBe(true);
    expect(zonesChanged([...draftsOf([BERUWALA]), newZoneDraft()], [BERUWALA])).toBe(true);
  });

  it('words the switched-on areas', () => {
    expect(zonesSummary([BERUWALA])).toBe('No extra area is switched on.');
    expect(zonesSummary([{ ...BERUWALA, enabled: true }])).toBe('Beruwala is on.');
    expect(zonesSummary([{ ...BERUWALA, enabled: true }, { name: 'Maggona', enabled: true }])).toBe('Beruwala, Maggona are on.');
  });
});
