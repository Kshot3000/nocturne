/* ============================================================
   Nocturne — config, seed contacts & welcome mail
   Cardano by day. Nocturne by night.
   ============================================================ */

/* ---------- checksum-real address validation (ADA / BTC) ----------
   The validators below verify the actual checksums, not just the
   shape: bech32 / bech32m (BIP-173 / BIP-350) for Cardano and for
   Bitcoin SegWit/Taproot, and Base58Check (double-SHA-256) for
   legacy Bitcoin. A one-character typo breaks the checksum and is
   rejected — a regex-only check would wave it through and the
   review step would still render a scannable QR for it. */
const NocturneAddr = (() => {
  'use strict';

  /* --- tiny synchronous SHA-256 (needed by Base58Check) --- */
  const K = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
  ];
  const rotr = (x, n) => (x >>> n) | (x << (32 - n));

  function sha256(bytes) {
    const H = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
    const msg = Array.from(bytes);
    const bitLen = msg.length * 8;
    msg.push(0x80);
    while (msg.length % 64 !== 56) msg.push(0);
    msg.push(0, 0, 0, 0, (bitLen >>> 24) & 0xff, (bitLen >>> 16) & 0xff, (bitLen >>> 8) & 0xff, bitLen & 0xff);
    const w = new Array(64);
    for (let off = 0; off < msg.length; off += 64) {
      for (let t = 0; t < 16; t++) {
        w[t] = ((msg[off + t * 4] << 24) | (msg[off + t * 4 + 1] << 16) |
          (msg[off + t * 4 + 2] << 8) | msg[off + t * 4 + 3]) >>> 0;
      }
      for (let t = 16; t < 64; t++) {
        const s0 = (rotr(w[t - 15], 7) ^ rotr(w[t - 15], 18) ^ (w[t - 15] >>> 3)) >>> 0;
        const s1 = (rotr(w[t - 2], 17) ^ rotr(w[t - 2], 19) ^ (w[t - 2] >>> 10)) >>> 0;
        w[t] = (w[t - 16] + s0 + w[t - 7] + s1) >>> 0;
      }
      let [a, b, c, d, e, f, g, h] = H;
      for (let t = 0; t < 64; t++) {
        const S1 = (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) >>> 0;
        const ch = ((e & f) ^ (~e & g)) >>> 0;
        const t1 = (h + S1 + ch + K[t] + w[t]) >>> 0;
        const S0 = (rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) >>> 0;
        const maj = ((a & b) ^ (a & c) ^ (b & c)) >>> 0;
        const t2 = (S0 + maj) >>> 0;
        h = g; g = f; f = e; e = (d + t1) >>> 0;
        d = c; c = b; b = a; a = (t1 + t2) >>> 0;
      }
      H[0] = (H[0] + a) >>> 0; H[1] = (H[1] + b) >>> 0; H[2] = (H[2] + c) >>> 0; H[3] = (H[3] + d) >>> 0;
      H[4] = (H[4] + e) >>> 0; H[5] = (H[5] + f) >>> 0; H[6] = (H[6] + g) >>> 0; H[7] = (H[7] + h) >>> 0;
    }
    const out = new Uint8Array(32);
    H.forEach((v, i) => {
      out[i * 4] = (v >>> 24) & 0xff; out[i * 4 + 1] = (v >>> 16) & 0xff;
      out[i * 4 + 2] = (v >>> 8) & 0xff; out[i * 4 + 3] = v & 0xff;
    });
    return out;
  }
  const sha256Hex = (text) => {
    const bytes = [];
    for (const ch of String(text)) {
      const cp = ch.codePointAt(0);
      if (cp < 0x80) bytes.push(cp);
      else if (cp < 0x800) bytes.push(0xc0 | (cp >> 6), 0x80 | (cp & 0x3f));
      else if (cp < 0x10000) bytes.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
      else bytes.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 0x3f), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
    }
    return Array.from(sha256(bytes)).map((b) => b.toString(16).padStart(2, '0')).join('');
  };

  /* --- bech32 / bech32m (BIP-173 / BIP-350) --- */
  const BECH = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
  const BECH_REV = {};
  for (let i = 0; i < BECH.length; i++) BECH_REV[BECH[i]] = i;

  function bech32Decode(str) {
    if (typeof str !== 'string' || str.length < 8) return null;
    if (str !== str.toLowerCase() && str !== str.toUpperCase()) return null; // no mixed case
    const s = str.toLowerCase();
    const split = s.lastIndexOf('1');
    if (split < 1 || split + 7 > s.length) return null;
    const hrp = s.slice(0, split);
    const values = [];
    for (const ch of s.slice(split + 1)) {
      if (!(ch in BECH_REV)) return null;
      values.push(BECH_REV[ch]);
    }
    let chk = 1;
    const polymodStep = (v) => {
      const b = chk >>> 25;
      chk = ((chk & 0x1ffffff) << 5) ^ v;
      if (b & 1) chk ^= 0x3b6a57b2;
      if (b & 2) chk ^= 0x26508e6d;
      if (b & 4) chk ^= 0x1ea119fa;
      if (b & 8) chk ^= 0x3d4233dd;
      if (b & 16) chk ^= 0x2a1462b3;
    };
    for (const ch of hrp) polymodStep(ch.charCodeAt(0) >>> 5);
    polymodStep(0);
    for (const ch of hrp) polymodStep(ch.charCodeAt(0) & 31);
    for (const v of values) polymodStep(v);
    const encoding = chk === 1 ? 'bech32' : chk === 0x2bc830a3 ? 'bech32m' : null;
    if (!encoding) return null;
    return { hrp, encoding, data: values.slice(0, -6) };
  }

  function convertBits(values, from, to, pad) {
    let acc = 0, bits = 0;
    const out = [];
    const maxv = (1 << to) - 1;
    for (const v of values) {
      acc = (acc << from) | v;
      bits += from;
      while (bits >= to) {
        bits -= to;
        out.push((acc >>> bits) & maxv);
      }
    }
    if (pad) {
      if (bits) out.push((acc << (to - bits)) & maxv);
    } else if (bits >= from || ((acc << (to - bits)) & maxv)) {
      return null;
    }
    return out;
  }

  /* --- Cardano: bech32, hrp addr (mainnet) / addr_test (testnet) --- */
  function ada(v) {
    const dec = bech32Decode(v);
    if (!dec || dec.encoding !== 'bech32') return false;
    if (dec.hrp !== 'addr' && dec.hrp !== 'addr_test') return false;
    const bytes = convertBits(dec.data, 5, 8, false);
    // Shelley payment addresses: 1 header byte + 28-byte hash (+ optional second hash)
    return !!bytes && (bytes.length === 29 || bytes.length === 57);
  }

  /* --- Bitcoin: bech32/bech32m SegWit + Base58Check legacy --- */
  function btcSegwit(v) {
    const dec = bech32Decode(v);
    if (!dec || dec.hrp !== 'bc' || dec.data.length < 2) return false;
    const version = dec.data[0];
    if (version === 0 && dec.encoding !== 'bech32') return false;
    if (version > 0 && dec.encoding !== 'bech32m') return false;
    if (version > 16) return false;
    const program = convertBits(dec.data.slice(1), 5, 8, false);
    if (!program || program.length < 2 || program.length > 40) return false;
    if (version === 0 && program.length !== 20 && program.length !== 32) return false;
    return true;
  }

  const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  function btcBase58Check(v) {
    const bytes = [0];
    for (const ch of v) {
      const idx = B58.indexOf(ch);
      if (idx < 0) return false;
      let carry = idx;
      for (let i = 0; i < bytes.length; i++) {
        carry += bytes[i] * 58;
        bytes[i] = carry & 0xff;
        carry >>>= 8;
      }
      while (carry) { bytes.push(carry & 0xff); carry >>>= 8; }
    }
    for (const ch of v) { if (ch === '1') bytes.push(0); else break; }
    bytes.reverse();
    if (bytes.length !== 25) return false;
    const version = bytes[0];
    if (v[0] === '1' && version !== 0x00) return false;
    if (v[0] === '3' && version !== 0x05) return false;
    if (v[0] !== '1' && v[0] !== '3') return false;
    const digest = sha256(sha256(bytes.slice(0, 21)));
    return bytes.slice(21).every((b, i) => b === digest[i]);
  }

  function btc(v) {
    if (typeof v !== 'string') return false;
    if (/^bc1/i.test(v)) return btcSegwit(v);
    return btcBase58Check(v);
  }

  return { ada, btc, bech32Decode, sha256Hex };
})();

const NOCTURNE = {
  name: 'Nocturne',
  tagline: 'Private messaging on Midnight',
  domain: 'nocturne.night',

  /* --- Socials ------------------------------------------------ */
  x: {
    handle: '@kshot9000',
    url: 'https://x.com/kshot9000'
  },

  /* --- Donations (carried over from the earlier sites) -------- */
  donate: [
    {
      id: 'ADA',
      label: 'Cardano (ADA)',
      addr: 'addr1q8hnl6vl5a6k3rw3n5g3jtte696zcl76kfatzv7gpswa9r0dj7fma6klq55y4ffm7tf0em09udnyhuk4ah92pl5x9jpqjae44v',
      view: 'https://cardanoscan.io/addresses/addr1q8hnl6vl5a6k3rw3n5g3jtte696zcl76kfatzv7gpswa9r0dj7fma6klq55y4ffm7tf0em09udnyhuk4ah92pl5x9jpqjae44v',
      color: '#9a9a9a'
    },
    {
      id: 'BTC',
      label: 'Bitcoin (BTC)',
      addr: '3GnR7TWBXAB3pPztBWpNF4LMNEX5yX8vZK',
      view: 'https://mempool.space/address/3GnR7TWBXAB3pPztBWpNF4LMNEX5yX8vZK',
      color: '#cfcfcf'
    },
    {
      id: 'ERG',
      label: 'Ergo (ERG)',
      addr: '9fcM5RWnAjmP4vx5bnW6yohB6H9bLq8sJbaPLHtwZLtQPB32Pvy',
      view: 'https://explorer.ergoplatform.com/addresses/9fcM5RWnAjmP4vx5bnW6yohB6H9bLq8sJbaPLHtwZLtQPB32Pvy',
      color: '#b3b3b3'
    }
  ],

  /* --- Assets available in the send flow ----------------------- */
  assets: [
    {
      id: 'NIGHT',
      name: 'Midnight',
      ticker: 'NIGHT',
      color: '#ffffff',
      icon: 'moon',
      precision: 6,
      fee: 0.0005,
      feeLabel: 'DUST fee — generated by NIGHT (demo)',
      addrHint: 'mid1… or 38–64 char Midnight address',
      validate: (v) =>
        /^mid1[0-9a-z]{20,90}$/i.test(v) || /^[a-z0-9]{38,64}$/i.test(v)
    },
    {
      id: 'ADA',
      name: 'Cardano',
      ticker: 'ADA',
      color: '#9a9a9a',
      icon: 'cardano',
      precision: 6,
      fee: 0.25,
      feeLabel: '0.25 ADA (demo fee)',
      addrHint: 'addr1… (bech32 Shelley address)',
      validate: (v) => NocturneAddr.ada(v)
    },
    {
      id: 'BTC',
      name: 'Bitcoin',
      ticker: 'BTC',
      color: '#cfcfcf',
      icon: 'btc',
      precision: 8,
      fee: 0.00002,
      feeLabel: '0.00002 BTC (demo fee)',
      addrHint: 'bc1… (bech32) or 1… / 3… (legacy)',
      validate: (v) => NocturneAddr.btc(v)
    }
  ],

  /* --- Seeded residents (demo contacts) ------------------------ */
  contacts: [
    {
      id: 'nocturne',
      handle: 'nocturne',
      name: 'Nocturne Concierge',
      system: true,
      color: '#ffffff',
      online: true,
      welcome:
        'Welcome to the quiet side of Cardano, {handle}. I am the concierge — ask me about your mailbox, sending NIGHT/ADA/BTC, or how the encryption works.',
      replies: [
        'Noted. Everything you store here is sealed with AES-256-GCM before it touches this browser’s storage.',
        'Tip: open the Send tab to move NIGHT, ADA or BTC. The QR in the review step is real and scannable.',
        'Your mailbox is {handle}@nocturne.night. Mail you send lands in the Sent folder.',
        'Remember: Nocturne has no server. When this tab’s storage clears, the dark takes it back.',
        'Ask me again if you like — I never sleep, which is the point of the name.',
        'Midnight tip: programmable privacy — everything stays shielded, and only what’s necessary gets disclosed, when it’s necessary. That’s the zero-knowledge way.'
      ]
    },
    {
      id: 'moon_whisper',
      handle: 'moon_whisper',
      name: 'Moon Whisper',
      color: '#ffffff',
      online: true,
      welcome:
        'You found the quiet channel, {handle}. Moonlight travels fast; gossip doesn’t. What’s on your mind?',
      replies: [
        'The moon doesn’t send receipts. But I can see you read that.',
        'I was just watching Midnight’s ledger breathe — public state up top, private state under the blanket. It hums in B-flat, if you squint.',
        'Keep your keys like a lullaby — only you should know the words.',
        'I once forwarded a secret to a satellite. It bounced. Poetic, no?',
        'The dark isn’t empty, {handle}. It’s just listening.',
        'Send me your NIGHT and I’ll pretend it was always mine. (Demo, demo — nothing actually moves.)'
      ]
    },
    {
      id: 'ada_dev',
      handle: 'ada_dev',
      name: 'Ada Dev',
      color: '#9a9a9a',
      online: true,
      welcome:
        '{handle}! I ship Cardano stuff by day and lurk Midnight channels by night. P2P, Plutus, or just moon talk?',
      replies: [
        'Ha — “privacy by default, drama by exception.” I could tattoo that.',
        'If Nocturne ever gets a relay, I’m volunteering as the human load-balancer.',
        'My ADA address is in my bio. My secrets are in Nocturne. That’s the whole philosophy.',
        'Static site, zero servers. It’s the most “on-chain” feeling a website can get without being on-chain.',
        'Ship it. Then whisper about it. Then let the blocks settle.',
        '0x42, but make it midnight.'
      ]
    },
    {
      id: 'btc_ghost',
      handle: 'btc_ghost',
      name: 'BTC Ghost',
      color: '#cfcfcf',
      online: false,
      welcome:
        '*static* …you… talk to a ghost, {handle}? …fine. I lurk here. BTC forever. Midnight sometimes.',
      replies: [
        'Not much to say. Satoshis don’t whisper. They settle.',
        'I heard Midnight discloses only what’s necessary, when it’s necessary. In 2010 we called that “a cold wallet in a bunker.”',
        'My last message was 2016. I keep it as an artifact.',
        'Send BTC. I’ll haunt the mempool. (Demo. Nothing moves. Even ghosts don’t trust demos.)',
        '…',
        '*ghost appears to have left the dark*'
      ]
    }
  ],

  /* Generic reply pool for chats the user starts with new handles */
  genericReplies: [
    'Heard you over the quiet line. (This is a demo resident — no one is really there, which is rather the point.)',
    'Signal received. I will pretend to be someone important. (Demo mode.)',
    'Even ghosts need a “typing…” indicator. (Demo mode.)'
  ],

  /* --- Welcome mail (seeded into the inbox) --------------------- */
  welcomeMail: [
    {
      from: 'welcome@nocturne.night',
      name: 'Nocturne',
      subject: 'Welcome to the quiet side of Cardano',
      body:
        'Your private mailbox {handle}@nocturne.night is live.\n\n' +
        'This inbox lives only in your browser. It is sealed with AES-256-GCM ' +
        '(WebCrypto, right in your machine) before anything is written to storage, ' +
        'and there is no server holding a copy.\n\n' +
        'What you can do here:\n' +
        '• Chat with residents in the Messages tab\n' +
        '• Write mail to anyone at @nocturne.night (Sent folder keeps your copies)\n' +
        '• Send Midnight (NIGHT), Cardano (ADA) or Bitcoin (BTC) from the Send tab\n\n' +
        'Cardano by day. Nocturne by night.\n' +
        '— The Nocturne Concierge',
      read: false
    },
    {
      from: 'midnight@nocturne.night',
      name: 'Midnight Desk',
      subject: 'Programmable privacy',
      body:
        'Midnight is the fourth-generation blockchain of the Cardano ecosystem, ' +
        'built to bring rational privacy to blockchain: zero-knowledge proofs shield ' +
        'sensitive data, and programmable privacy decides exactly what gets ' +
        'disclosed — and when. NIGHT continuously generates DUST, the resource ' +
        'that powers transactions, so costs stay predictable.\n\n' +
        'Nocturne is what a conversation feels like at “private”: messages sealed ' +
        'end-to-end, a mailbox with no landlord, and money rails that don’t announce ' +
        'themselves.\n\n' +
        'Nothing in this mailbox has ever left your device. That is not a feature ' +
        'we added — it is a feature we refused to remove.',
      read: false
    },
    {
      from: 'treasury@nocturne.night',
      name: 'Nocturne Treasury',
      subject: 'Your keys, your coins',
      body:
        'A note before you send anything:\n\n' +
        'The Send tab builds a real, scannable QR of the recipient address and ' +
        'validates it per-chain (NIGHT, ADA, BTC). The broadcast step, however, is a ' +
        'simulation — Nocturne is a static site on GitHub Pages, so no transaction ' +
        'is ever signed or relayed from this browser.\n\n' +
        'Treat it as the design preview of a private money rail: the UX is final, ' +
        'the settlement is not (yet).\n\n' +
        'Keep the lights low.',
      read: false
    }
  ]
};
