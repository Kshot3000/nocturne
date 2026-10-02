/* Nocturne smoke tests — dependency-free, run with: node --test tests/smoke.test.mjs
   Guards: cache-busted asset refs, dead sister links, per-chain address
   validators, and the WebCrypto / XOR sealing round-trips. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { webcrypto } from 'node:crypto';
import vm from 'node:vm';

const root = new URL('../', import.meta.url);
const read = (p) => readFileSync(new URL(p, root), 'utf8');

function loadConst(file, expr, extra = {}) {
  const ctx = vm.createContext({ console, ...extra });
  vm.runInContext(read(file), ctx);
  return vm.runInContext(expr, ctx);
}

/* ---------- cache-busting: every local CSS/JS ref must carry ?v= ---------- */
test('index.html + 404.html version every local CSS/JS asset', () => {
  for (const page of ['index.html', '404.html']) {
    const html = read(page);
    const refs = [...html.matchAll(/(?:href|src)="([^"]+\.(?:css|js)(?:\?[^"]*)?)"/g)].map((m) => m[1]);
    assert.ok(refs.length > 0, page + ' should reference CSS/JS assets');
    for (const ref of refs) {
      assert.ok(ref.includes('?v='), page + ': unversioned asset ref ' + ref);
    }
  }
});

/* ---------- sister links: the old GitHub Pages NightDream URL 404s ---------- */
test('no dead NightDream.io Pages link remains; nightdream.xyz is linked', () => {
  for (const file of ['index.html', 'README.md']) {
    assert.ok(!read(file).includes('kshot3000.github.io/NightDream.io'), file + ' still links the dead URL');
  }
  assert.ok(read('index.html').includes('https://nightdream.xyz/'));
});

/* ---------- accessibility hooks the app JS relies on ---------- */
test('burger controls the nav and tabs expose aria-selected', () => {
  const html = read('index.html');
  assert.ok(html.includes('aria-controls="nav-links"'));
  assert.ok(html.includes('id="nav-links"'));
  assert.ok(html.includes('aria-expanded="false"'));
  assert.ok(html.includes('aria-selected="true"'));
  const app = read('js/app.js');
  assert.ok(app.includes("setAttribute('aria-expanded'"), 'app.js must keep aria-expanded in sync');
  assert.ok(app.includes("setAttribute('aria-selected'"), 'app.js must keep aria-selected in sync');
  assert.ok(app.includes("'Escape'"), 'app.js must close modals/nav on Escape');
});

/* ---------- address validators (js/data.js) ---------- */
const NOCTURNE = loadConst('js/data.js', 'NOCTURNE');
const asset = (id) => NOCTURNE.assets.find((a) => a.id === id);

test('donation addresses validate against their own chain rules', () => {
  for (const d of NOCTURNE.donate) {
    const a = asset(d.id);
    if (a) assert.ok(a.validate(d.addr), d.id + ' donation address should validate');
  }
});

test('validators reject obvious garbage and accept well-formed samples', () => {
  assert.equal(asset('ADA').validate('addr1q8hnl6vl5a6k3rw3n5g3jtte696zcl76kfatzv7gpswa9r0dj7fma6klq55y4ffm7tf0em09udnyhuk4ah92pl5x9jpqjae44v'), true);
  assert.equal(asset('ADA').validate('not-an-address'), false);
  assert.equal(asset('ADA').validate(''), false);
  assert.equal(asset('BTC').validate('3GnR7TWBXAB3pPztBWpNF4LMNEX5yX8vZK'), true);
  assert.equal(asset('BTC').validate('bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh'), true);
  assert.equal(asset('BTC').validate('0xdeadbeef'), false);
  assert.equal(asset('NIGHT').validate('mid1' + 'a'.repeat(30)), true);
  assert.equal(asset('NIGHT').validate('mid1short'), false);
});

/* ---------- sealing round-trips (js/crypto.js) ---------- */
function loadCrypto() {
  const sandbox = {
    console,
    TextEncoder,
    TextDecoder,
    btoa,
    atob,
    crypto: webcrypto,
  };
  sandbox.self = sandbox;
  const ctx = vm.createContext(sandbox);
  vm.runInContext(read('js/crypto.js'), ctx);
  return vm.runInContext('NocturneCrypto', ctx);
}

test('XOR fallback seal/open round-trips', () => {
  const NC = loadCrypto();
  const key = NC.randomRawKeyB64();
  const obj = { hello: 'midnight', n: 42, list: [1, 2, 3] };
  // Objects come from a vm realm, so compare by value via JSON, not prototype.
  assert.equal(JSON.stringify(NC.xorOpen(NC.xorSeal(key, obj), key)), JSON.stringify(obj));
});

test('AES-256-GCM seal/open and passphrase wrap/unwrap round-trip', async () => {
  const NC = loadCrypto();
  assert.equal(NC.available(), true);
  const key = await NC.newDeviceKey();
  const obj = { secret: 'sealed at rest', ts: 123 };
  assert.equal(JSON.stringify(await NC.open(await NC.seal(key, obj), key)), JSON.stringify(obj));

  const wrapped = await NC.wrapKey(key, 'correct horse battery');
  const unwrapped = await NC.unwrapKey(wrapped, 'correct horse battery');
  assert.equal(JSON.stringify(await NC.open(await NC.seal(unwrapped, obj), unwrapped)), JSON.stringify(obj));
  await assert.rejects(() => NC.unwrapKey(wrapped, 'wrong passphrase'));
});
