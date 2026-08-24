# ☾ Nocturne — Private Messaging on Midnight

**Cardano by day. Nocturne by night.**

Nocturne is a private messenger for **Midnight** — the fourth-generation blockchain
that brings rational privacy to the Cardano ecosystem: a Messenger-style chat,
a sealed personal mailbox, and quiet rails to send **Midnight (NIGHT)**, **Cardano (ADA)**
and **Bitcoin (BTC)**.

- No servers. No build step. No backend. Plain HTML + CSS + JS that runs anywhere,
  including **GitHub Pages**.
- Everything local is sealed with **AES-256-GCM** (WebCrypto) before it touches
  `localStorage`. Keys are generated in the browser and never leave it.
- Optional **passphrase** keeps the device key wrapped at rest.
- Real, scannable **QR codes** on every send; per-chain **address validation** for NIGHT, ADA and BTC.
- Honest by design: what's simulated is labelled (see the Honesty panel on the site).

---

## Features

| Area | What it does |
|---|---|
| **Encrypted DMs** | Messenger-style chat with typing indicators, delivery/read ticks, presence dots, seeded residents (`@nocturne`, `@moon_whisper`, `@ada_dev`, `@btc_ghost`), and new-chat creation for any handle |
| **Private mailbox** | Claims `you@nocturne.night`; Inbox + Sent, unread tracking, compose. Mail to your own handle lands in your inbox |
| **Send crypto** | NIGHT / ADA / BTC with per-chain address validation, demo fees, scannable QR, animated broadcast steps, and a local Activity ledger with copyable (simulated) tx hashes |
| **Identity** | Handle + optional passphrase. Device key is AES-256-GCM; passphrase path wraps it with a PBKDF2 (200k iter) derived key |
| **Landing site** | Hero, features, Midnight explainer, how-it-works, honesty panel, donations, X link |

## Honest disclosure

This is a **static site** (GitHub-Pages friendly), so:

- ✅ **Real:** end-to-end sealing of all local data (WebCrypto AES-256-GCM), QR code
  generation, per-chain address validation, the whole messenger/mail UX.
- ⚠️ **Simulated:** other users (seeded residents with canned replies), transaction
  broadcast/confirmation (nothing is signed or relayed), and mail delivery
  (mail is kept in your local sealed inbox, not routed).

A cross-device messenger would need a relay (WebSocket/WebRTC) and a signing path
for real settlement — deliberately out of scope for a Pages-hostable static site.

## Run locally

Option A — double-click:

```
serve.bat
```

Option B — any static server:

```
npx serve .
# or: python -m http.server 8080
# or: VS Code Live Server
```

Then open <http://localhost:8080>.

> Note: the app uses `crypto.subtle`, which requires a secure context.
> `localhost` and `https://` both qualify. If a browser ever blocks it, the app
> falls back to labelled XOR obfuscation instead of AES.

## Deploy to GitHub Pages

1. Create a new repository (e.g. `nocturne-messenger`).
2. Push this folder:

   ```
   git init
   git add .
   git commit -m "Nocturne — private messaging on Midnight"
   git branch -M main
   git remote add origin https://github.com/<YOUR-USERNAME>/nocturne-messenger.git
   git push -u origin main
   ```

3. In the repo: **Settings → Pages → Source: `main` branch, root (`/`)** → Save.
4. Within a couple of minutes the site is live at
   `https://<your-user-or-org>.github.io/nocturne-messenger/`
   (or `https://<your-user>.github.io/` if the repo is named `<your-user>.github.io`).

All asset paths are relative, so it works on both project pages and a user/org root.
`404.html` is included for Pages' custom 404.

## Project structure

```
nocturne-messenger/
├── index.html            # landing + app shell + modals (single page)
├── 404.html              # themed 404 for GitHub Pages
├── css/style.css         # Midnight design system
├── js/
│   ├── data.js           # config: assets, contacts, welcome mail, donations, X
│   ├── crypto.js         # WebCrypto sealing (AES-256-GCM, PBKDF2 wrap, XOR fallback)
│   ├── app.js            # messenger, mail, send, activity, onboarding, unlock
│   └── vendor/qrcode.js  # qrcode-generator 1.4.4 (Kazuhiko Arase, MIT)
├── assets/favicon.svg
├── serve.bat / serve.ps1 # zero-dependency local server
└── README.md
```

To change assets, fees, contacts or donation addresses, edit **`js/data.js`** —
it is the single source of truth.

## Identity & support

- **X:** [@kshot9000](https://x.com/kshot9000)
- **Donations** (carried over from the earlier sites):
  - ADA: `addr1q8hnl6vl5a6k3rw3n5g3jtte696zcl76kfatzv7gpswa9r0dj7fma6klq55y4ffm7tf0em09udnyhuk4ah92pl5x9jpqjae44v`
  - BTC: `3GnR7TWBXAB3pPztBWpNF4LMNEX5yX8vZK`
  - ERG: `9fcM5RWnAjmP4vx5bnW6yohB6H9bLq8sJbaPLHtwZLtQPB32Pvy`

## Credits

- QR code generation — [qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator)
  by Kazuhiko Arase, MIT license.
- Midnight-inspired theming: deep-space palette, starfield, crescent marks.

## Disclaimer

Nocturne is a community project and a design preview. It is **not affiliated** with
the Midnight or Cardano foundations. Broadcasts in the Send tab are simulated; no
transaction is ever signed or relayed from this site. Not financial advice.
