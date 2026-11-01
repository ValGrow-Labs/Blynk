import { describe, it, expect } from 'vitest';
import {
  draftFromZone,
  draftPoint,
  newDraft,
  pointFromText,
  zoneRowErrors,
  zoneSlug,
  zonesBody,
  type ZoneDraft,
} from '../lib/deliveryZones';

const BERUWALA = { id: 'beruwala', name: 'Beruwala', lat: 6.4759, lng: 79.9842, radius_km: 3, enabled: false };

const filled = (over: Partial<ZoneDraft> = {}): ZoneDraft => ({ ...newDraft('k1'), name: 'Beruwala', lat: '6.4759', lng: '79.9842', radius: '3', ...over });

describe('extra delivery areas - helpers', () => {
  it('reads a zone into a row and back into the exact PUT body', () => {
    const draft = draftFromZone(BERUWALA, 'k0');
    expect(draft).toEqual({ key: 'k0', id: 'beruwala', name: 'Beruwala', lat: '6.4759', lng: '79.9842', radius: '3', enabled: false });
    expect(zonesBody([draft])).toEqual({ body: { zones: [BERUWALA] } });
  });

  it('makes the id of a new area from its name, unique within the list', () => {
    const body = zonesBody([draftFromZone(BERUWALA, 'k0'), filled({ key: 'k1', name: 'Beruwala Town' }), filled({ key: 'k2', name: 'Aluthgama 2' })]);
    expect('body' in body && body.body.zones.map((z) => z.id)).toEqual(['beruwala', 'beruwala-town', 'aluthgama-2']);
    expect(zoneSlug('  Béruwala, Town! ')).toBe('beruwala-town');
  });

  it('a new area never takes an id a saved area already has', () => {
    // A saved zone renamed away keeps "beruwala"; the new "Beruwala" becomes beruwala-2.
    const renamed = { ...draftFromZone(BERUWALA, 'k0'), name: 'Old Beruwala' };
    const body = zonesBody([renamed, filled({ key: 'k1' })]);
    expect('body' in body && body.body.zones.map((z) => z.id)).toEqual(['beruwala', 'beruwala-2']);
  });

  it('refuses a missing or long name, coordinates outside Sri Lanka, and a radius outside 0.5 to 15 km', () => {
    expect(zoneRowErrors(filled())).toEqual({});
    expect(zoneRowErrors(filled({ name: ' ' })).name).toMatch(/Enter the name/);
    expect(zoneRowErrors(filled({ name: 'x'.repeat(41) })).name).toBe('At most 40 characters.');
    expect(zoneRowErrors(filled({ lat: '12.5' })).lat).toMatch(/5 to 10/);
    expect(zoneRowErrors(filled({ lat: '' })).lat).toMatch(/5 to 10/);
    expect(zoneRowErrors(filled({ lng: '84' })).lng).toMatch(/78 to 83/);
    expect(zoneRowErrors(filled({ lng: 'abc' })).lng).toMatch(/78 to 83/);
    expect(zoneRowErrors(filled({ radius: '0.4' })).radius).toBe('The radius must be between 0.5 and 15 km.');
    expect(zoneRowErrors(filled({ radius: '15.5' })).radius).toBe('The radius must be between 0.5 and 15 km.');
    expect(zoneRowErrors(filled({ radius: '2.555' })).radius).toBe('Use at most 2 decimal places.');
    expect(zoneRowErrors(filled({ radius: 'big' })).radius).toBe('Enter a number, like 3 or 2.5.');
    expect(zoneRowErrors(filled({ radius: '' })).radius).toBe('Enter the radius in km, like 3.');
    expect(zoneRowErrors(filled({ radius: '2.5 km' }))).toEqual({});
  });

  it('refuses two areas with the same name and more than 10 areas', () => {
    const twice = zonesBody([filled({ key: 'a' }), filled({ key: 'b', name: 'beruwala' })]);
    expect(twice).toEqual({ errors: { b: { name: 'Another area already has this name.' } } });
    const eleven = zonesBody(Array.from({ length: 11 }, (_, i) => filled({ key: `k${i}`, name: `Area ${i}` })));
    expect('listError' in eleven && eleven.listError).toBe('At most 10 extra areas.');
  });

  it('sends an empty list when every area was removed', () => {
    expect(zonesBody([])).toEqual({ body: { zones: [] } });
  });

  it('reads a pasted Google Maps link or "lat, lng" with the seller location parser', () => {
    expect(pointFromText('6.4759, 79.9842')).toEqual({ lat: 6.4759, lng: 79.9842 });
    expect(pointFromText('https://www.google.com/maps/place/Beruwala/@6.4759,79.9842,14z')).toEqual({ lat: 6.4759, lng: 79.9842 });
    expect(pointFromText('hello')).toBeNull();
  });

  it('gives the point of a row only when both numbers are readable', () => {
    expect(draftPoint(filled())).toEqual({ lat: 6.4759, lng: 79.9842 });
    expect(draftPoint(filled({ lng: '' }))).toBeNull();
  });
});
