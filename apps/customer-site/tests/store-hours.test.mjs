// Store hours on the website follow Admin / Ops (owner, 2026-10-20: "make sure the timings can
// able controlled by the admins opening and closing timings").
// Run from the repo root:  node --test apps/customer-site/tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const site = join(dirname(fileURLToPath(import.meta.url)), '..');
const walk = (dir) => readdirSync(dir).flatMap((n) => (statSync(join(dir, n)).isDirectory() ? walk(join(dir, n)) : [join(dir, n)]));
const pages = [join(site, 'index.html'), ...walk(join(site, 'pages')).filter((f) => f.endsWith(`${sep}index.html`))];
// The written hours, in every language the pages use.
const WRITTEN = /8 AM|9 PM|පෙ\.ව\. 8|ප\.ව\. 9|காலை 8|இரவு 9|8–9/;

/** Visible text of a page with the parts store-hours.js rewrites taken out. */
function unmarkedText(html) {
  return html
    .replace(/<head>[\s\S]*?<\/head>/, '')
    .replace(/<script[\s\S]*?<\/script>/g, '')
    .replace(/<([a-z]+)[^>]*data-hours="[^"]*"[^>]*>[^<]*<\/\1>/g, '')
    .replace(/<[^>]+>/g, ' ');
}

test('every hour the pages show is marked for store-hours.js, and the script is loaded', () => {
  for (const file of pages) {
    const html = readFileSync(file, 'utf8');
    const left = unmarkedText(html).match(WRITTEN);
    assert.equal(left, null, `${file}: hours written without data-hours: "${left && left[0]}"`);
    if (/data-hours=/.test(html)) assert.match(html, /<script src="\/store-hours\.js\?v=\w+" defer><\/script>/, `${file}: store-hours.js not loaded`);
  }
});

test('the Dockerfile ships store-hours.js and fills in the API address', () => {
  const docker = readFileSync(join(site, 'Dockerfile'), 'utf8');
  assert.match(docker, /apps\/customer-site\/store-hours\.js/);
  assert.match(docker, /s#__BLYNK_API__#\$\{API_BASE_URL%\/\}#g/);
  const js = readFileSync(join(site, 'store-hours.js'), 'utf8');
  assert.equal(js.split('__BLYNK_API__').length - 1, 1, 'the placeholder appears once, in the code');
});

// ---------------------------------------------------------------- the delivery radius (owner, 2026-11-01)
// The radius is an Admin setting, never typed text: pages mark it <span data-radius>4</span> and store-hours.js fills it
// from GET /store radius_km, the same call that carries the hours.
/** Runs store-hours.js against a fake page and a fake /store answer; returns the fake elements afterwards. */
async function runStoreHours(data, { lang = 'en', ok = true, fail = false } = {}) {
  const el = (attrs = {}) => ({
    textContent: attrs.text ?? '', attrs: { ...attrs.attrs },
    hasAttribute(n) { return n in this.attrs; }, setAttribute(n, v) { this.attrs[n] = v; },
  });
  const plain = el({ text: '4' });
  const counted = el({ text: '4', attrs: { 'data-count': '4' } });
  const hours = el({ text: '8 AM to 9 PM' });
  const document = {
    documentElement: { lang },
    querySelectorAll(sel) {
      if (sel === '[data-radius]') return [plain, counted];
      if (sel === '[data-hours="to"]') return [hours];
      return [];
    },
    querySelector: () => null,
  };
  const src = readFileSync(join(site, 'store-hours.js'), 'utf8').replace('__BLYNK_API__', 'https://api.test/v1');
  const calls = [];
  const fetch = (url) => {
    calls.push(url);
    return fail ? Promise.reject(new Error('offline')) : Promise.resolve({ ok, json: () => Promise.resolve({ data }) });
  };
  vm.runInNewContext(src, { document, fetch, Intl, Date, String, Number, Math, JSON, Array, Object, Boolean });
  await new Promise((r) => setTimeout(r, 20));
  return { plain, counted, hours, calls };
}
const HOURS = { days: Object.fromEntries(['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'].map((d) => [d, { open: '08:00', close: '21:00' }])) };

test('store-hours.js fills data-radius from /store radius_km: 4 -> "4", 4.5 -> "4.5", no trailing zeros', async () => {
  for (const [given, shown] of [[4, '4'], ['4.00', '4'], [4.5, '4.5'], ['4.50', '4.5'], [7.25, '7.25'], [6, '6'], [4.001, '4']]) {
    const { plain, counted, calls } = await runStoreHours({ radius_km: given, hours: HOURS });
    assert.deepEqual(calls, ['https://api.test/v1/store']);
    assert.equal(plain.textContent, shown, `radius_km ${given}`);
    assert.equal(counted.textContent, shown, `radius_km ${given} (count-up target)`);
    // The count-up in app.js reads data-count, so it follows the live figure too.
    assert.equal(counted.attrs['data-count'], shown);
    assert.equal(plain.hasAttribute('data-count'), false, 'a marker without data-count gets none');
  }
});

test('the radius fills even when the store has no opening hours, and in Sinhala and Tamil pages', async () => {
  const noHours = await runStoreHours({ radius_km: 4.5 });
  assert.equal(noHours.plain.textContent, '4.5');
  assert.equal(noHours.hours.textContent, '8 AM to 9 PM', 'hours are left as written when the store sends none');
  for (const lang of ['si', 'ta']) assert.equal((await runStoreHours({ radius_km: 4.5, hours: HOURS }, { lang })).plain.textContent, '4.5');
});

test('a missing, zero or odd radius_km, an error or no answer leaves the written 4 alone', async () => {
  for (const data of [{ hours: HOURS }, { radius_km: null }, { radius_km: 0 }, { radius_km: -2 }, { radius_km: 'far' }, { radius_km: '' }, { radius_km: NaN }]) {
    const { plain, counted } = await runStoreHours(data);
    assert.equal(plain.textContent, '4', JSON.stringify(data));
    assert.equal(counted.attrs['data-count'], '4');
  }
  for (const opts of [{ ok: false }, { fail: true }]) {
    const { plain } = await runStoreHours({ radius_km: 9 }, opts);
    assert.equal(plain.textContent, '4');
  }
});

test('the hours still fill when the radius does (one /store call for both)', async () => {
  const { hours, calls } = await runStoreHours({ radius_km: 4, hours: { days: Object.fromEntries(['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'].map((d) => [d, { open: '07:00', close: '22:00' }])) } });
  assert.equal(hours.textContent, '7 AM to 10 PM');
  assert.equal(calls.length, 1);
});

test('no page types the radius: every "N km" the pages show is a data-radius span or in a tag a script cannot reach', () => {
  for (const file of pages) {
    const html = readFileSync(file, 'utf8');
    const text = html.replace(/<head>[\s\S]*?<\/head>/, '').replace(/<!--[\s\S]*?-->/g, '').replace(/<script[\s\S]*?<\/script>/g, '')
      .replace(/<span data-radius[^>]*>[^<]*<\/span>/g, ' RADIUS ');
    assert.doesNotMatch(text, /\d\s*(km\b|<small>KM)|කි\.මී\.\s*\d|\d\s*කි\.මී|\d\s*கி\.மீ/, `${file}: a radius is typed in the page text`);
    if (/data-radius/.test(html)) assert.match(html, /<script src="\/store-hours\.js\?v=\w+" defer><\/script>/, `${file}: store-hours.js not loaded`);
  }
  const terms = readFileSync(join(site, 'terms.html'), 'utf8');
  assert.match(terms, /deliver within about <span data-radius>4<\/span> km of the Dharga Town Clock Tower \(Dharga Town, Aluthgama, Kande Vihara, Kaluwamodara, Bentota and Moragalla\) and in Beruwala town\./);
});
