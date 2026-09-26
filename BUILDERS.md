# Builders notes (Midnight)

Nocturne is a **static** privacy UX sketch. When you take the next step onto chain:

1. Prefer **[example-bboard](https://github.com/midnightntwrk/example-bboard)** and **[create-mn-app](https://github.com/midnightntwrk/create-mn-app)** — not archived `example-counter`.
2. Discover wallets with `Object.values(window.midnight)` — do not hardcode `window.midnight.mnLace` (Lace alias is convenience-only). See [React wallet-connect](https://docs.midnight.network/guides/react-wallet-connect).
3. Never authorize Compact circuits with `ownPublicKey()` alone ([MPS-0029](https://github.com/midnightntwrk/midnight-improvement-proposals/blob/main/mps/mps-0029-compact-caller-identity.md)).
4. Pin toolchain against Midnight’s compatibility matrix (Compact ~0.31.1 / language ~0.23, midnight-js 4.1.1, DApp Connector 4.0.1, proof-server 8.1.0 — verify before deploy).

## Branding

- X: [@kshot9000](https://x.com/kshot9000)
- Cardano donation: see `js/data.js` / README (canonical address in Midnight-GrokBot-Agent `BRANDING.md`)
