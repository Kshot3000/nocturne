/* ============================================================
   Nocturne — local sealing (WebCrypto, AES-256-GCM)
   - A 256-bit device key is generated in the browser.
   - If a passphrase is set, the device key is wrapped with a
     PBKDF2-derived key and only the wrapped form is stored.
   - The whole app state is sealed (AES-GCM) before it is
     written to localStorage.
   - Fallback when WebCrypto is unavailable: XOR + base64
     obfuscation (labelled as such in the UI).
   ============================================================ */

const NocturneCrypto = (() => {
  'use strict';

  const te = new TextEncoder();
  const td = new TextDecoder();
  const ITERATIONS = 200000;

  function subtle() {
    return (self.crypto && self.crypto.subtle) ? self.crypto.subtle : null;
  }
  function available() {
    return !!subtle();
  }

  function bufToB64(buf) {
    const bytes = new Uint8Array(buf);
    let bin = '';
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin);
  }
  function b64ToBuf(b64) {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes.buffer;
  }
  function bytesToB64(bytes) {
    let bin = '';
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin);
  }
  function b64ToBytes(b64) {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  }

  async function newDeviceKey() {
    return subtle().generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
  }

  async function importRawKey(rawB64) {
    return subtle().importKey('raw', b64ToBuf(rawB64), { name: 'AES-GCM' }, true, ['encrypt', 'decrypt']);
  }

  async function exportRawKey(key) {
    const raw = await subtle().exportKey('raw', key);
    return bufToB64(raw);
  }

  async function wrapKey(key, passphrase) {
    const salt = self.crypto.getRandomValues(new Uint8Array(16));
    const baseKey = await subtle().importKey(
      'raw', te.encode(passphrase), 'PBKDF2', false, ['deriveKey']
    );
    const kek = await subtle().deriveKey(
      { name: 'PBKDF2', salt, iterations: ITERATIONS, hash: 'SHA-256' },
      baseKey,
      { name: 'AES-GCM', length: 256 },
      true,
      ['encrypt', 'decrypt']
    );
    const iv = self.crypto.getRandomValues(new Uint8Array(12));
    const data = await subtle().encrypt({ name: 'AES-GCM', iv }, kek, await subtle().exportKey('raw', key));
    return {
      salt: bufToB64(salt.buffer),
      iv: bufToB64(iv.buffer),
      data: bufToB64(data),
      iterations: ITERATIONS
    };
  }

  async function unwrapKey(wrapped, passphrase) {
    const salt = b64ToBytes(wrapped.salt).buffer;
    const iv = b64ToBytes(wrapped.iv).buffer;
    const baseKey = await subtle().importKey(
      'raw', te.encode(passphrase), 'PBKDF2', false, ['deriveKey']
    );
    const kek = await subtle().deriveKey(
      { name: 'PBKDF2', salt, iterations: wrapped.iterations || ITERATIONS, hash: 'SHA-256' },
      baseKey,
      { name: 'AES-GCM', length: 256 },
      true,
      ['decrypt']
    );
    const raw = await subtle().decrypt({ name: 'AES-GCM', iv }, kek, b64ToBytes(wrapped.data).buffer);
    return subtle().importKey('raw', raw, { name: 'AES-GCM' }, true, ['encrypt', 'decrypt']);
  }

  async function seal(key, obj) {
    const iv = self.crypto.getRandomValues(new Uint8Array(12));
    const data = await subtle().encrypt(
      { name: 'AES-GCM', iv }, key, te.encode(JSON.stringify(obj))
    );
    return { mode: 'aes-256-gcm', iv: bufToB64(iv.buffer), data: bufToB64(data) };
  }

  async function open(sealed, key) {
    const pt = await subtle().decrypt(
      { name: 'AES-GCM', iv: b64ToBytes(sealed.iv).buffer },
      key,
      b64ToBytes(sealed.data).buffer
    );
    return JSON.parse(td.decode(pt));
  }

  /* ---------- XOR fallback (no WebCrypto) ---------- */
  function xorSeal(rawB64Key, obj) {
    const keyBytes = b64ToBytes(rawB64Key);
    const plain = te.encode(JSON.stringify(obj));
    const out = new Uint8Array(plain.length);
    for (let i = 0; i < plain.length; i++) out[i] = plain[i] ^ keyBytes[i % keyBytes.length];
    return { mode: 'xor', data: bytesToB64(out) };
  }
  function xorOpen(sealed, rawB64Key) {
    const keyBytes = b64ToBytes(rawB64Key);
    const data = b64ToBytes(sealed.data);
    const plain = new Uint8Array(data.length);
    for (let i = 0; i < data.length; i++) plain[i] = data[i] ^ keyBytes[i % keyBytes.length];
    return JSON.parse(td.decode(plain));
  }

  function randomRawKeyB64() {
    return bytesToB64(self.crypto.getRandomValues(new Uint8Array(32)));
  }

  return {
    available,
    ITERATIONS,
    bufToB64,
    b64ToBuf,
    newDeviceKey,
    importRawKey,
    exportRawKey,
    wrapKey,
    unwrapKey,
    seal,
    open,
    xorSeal,
    xorOpen,
    randomRawKeyB64
  };
})();
