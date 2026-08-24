/* ============================================================
   Nocturne — app logic
   Messenger · Mailbox · Send (NIGHT/ADA/BTC) · Activity
   Static site: everything runs in the browser, state is
   sealed (AES-GCM) before it touches localStorage.
   ============================================================ */
(function () {
  'use strict';

  /* ---------- tiny helpers ---------- */
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const esc = (s) =>
    String(s).replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const uid = () =>
    'n_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function timeAgo(ts) {
    const d = Date.now() - ts;
    if (d < 45e3) return 'now';
    if (d < 3600e3) return Math.max(1, Math.round(d / 60e3)) + 'm';
    if (d < 86400e3) return Math.round(d / 3600e3) + 'h';
    if (d < 172800e3) return 'yesterday';
    return new Date(ts).toLocaleDateString();
  }
  function clock(ts) {
    return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  function fmtAmt(n, prec) {
    return Number(n).toLocaleString(undefined, { maximumFractionDigits: prec || 8 });
  }
  function trunc(s, a, b) {
    s = String(s);
    if (s.length <= a + b + 1) return s;
    return s.slice(0, a) + '…' + s.slice(-b);
  }

  /* ---------- state ---------- */
  const LS_KEY = 'nocturne.v1';
  const NC = NocturneCrypto;
  const C = NOCTURNE;

  let S = null; // app state {profile, convos, mail, txs}
  let KEY = null; // CryptoKey (aes) or rawKey b64 (xor)
  let MODE = null; // 'aes' | 'xor'
  let TAB = 'messages';
  let CUR_CONVO = null;
  let chatOpen = true; // mobile chat visibility
  let MAIL_VIEW = { tab: 'inbox', id: null };
  const timers = [];

  const mqMobile = () => window.matchMedia('(max-width: 860px)').matches;

  /* ---------- persistence (queued) ---------- */
  let saveQ = Promise.resolve();
  function save() {
    saveQ = saveQ.then(async () => {
      const raw = localStorage.getItem(LS_KEY);
      if (!raw || !S) return;
      const store = JSON.parse(raw);
      try {
        if (store.mode === 'aes') store.sealed = await NC.seal(KEY, S);
        else store.xor = NC.xorSeal(KEY, S);
        localStorage.setItem(LS_KEY, JSON.stringify(store));
      } catch (e) {
        console.warn('Nocturne: save failed', e);
      }
    });
    return saveQ;
  }

  /* ---------- toast ---------- */
  let toastTimer = null;
  function toast(msg, kind) {
    const t = $('#toast');
    if (!t) return;
    t.textContent = msg;
    t.className = 'toast show ' + (kind || '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.className = 'toast'; }, 2600);
  }

  /* ---------- clipboard ---------- */
  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (e) {
      try {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        ta.remove();
        return true;
      } catch (e2) {
        return false;
      }
    }
  }

  /* ---------- modal management ---------- */
  function openModal(id) {
    const m = document.getElementById(id);
    if (!m) return;
    m.classList.remove('hidden');
    m.setAttribute('aria-hidden', 'false');
    const f = m.querySelector('input, button');
    if (f && id !== 'm-review') setTimeout(() => f.focus(), 30);
  }
  function closeModal(id) {
    const m = document.getElementById(id);
    if (!m) return;
    m.classList.add('hidden');
    m.setAttribute('aria-hidden', 'true');
  }

  /* ---------- entry flow ---------- */
  function storeRaw() {
    try { return JSON.parse(localStorage.getItem(LS_KEY) || 'null'); }
    catch (e) { return null; }
  }

  async function enterFlow() {
    if (MODE && S) { enterApp(); return; }
    const store = storeRaw();
    if (!store) { openModal('m-onboard'); return; }
    try {
      if (store.keyMode === 'passphrase') {
        openModal('m-unlock');
        return;
      }
      if (store.mode === 'aes') {
        KEY = await NC.importRawKey(store.rawKey);
        MODE = 'aes';
        S = await NC.open(store.sealed, KEY);
      } else if (store.mode === 'xor') {
        KEY = store.rawKey;
        MODE = 'xor';
        S = NC.xorOpen(store.xor, KEY);
      } else {
        throw new Error('unknown store mode');
      }
      enterApp();
    } catch (e) {
      console.warn(e);
      toast('Could not open your sealed data.', 'err');
      openModal('m-unlock');
    }
  }

  function enterApp() {
    $('#site').classList.add('hidden');
    const app = $('#app');
    app.classList.remove('hidden');
    app.setAttribute('aria-hidden', 'false');
    setAppBar();
    TAB = 'messages';
    chatOpen = true;
    if (!CUR_CONVO || !convo(CUR_CONVO)) CUR_CONVO = (S.convos[0] || {}).id || null;
    renderSide();
    renderMain();
    toast('Sealed and ready. The dark is listening.');
  }

  function toSite() {
    $('#app').classList.add('hidden');
    $('#app').setAttribute('aria-hidden', 'true');
    $('#site').classList.remove('hidden');
  }

  function setAppBar() {
    const p = S.profile;
    $('#app-handle').textContent = '@' + p.handle;
    $('#app-mailbox').textContent = p.mailbox;
    const av = $('#app-avatar');
    av.textContent = p.handle.slice(0, 1).toUpperCase();
    av.style.setProperty('--c', '#ffffff');
    const badge = $('#app-lock');
    badge.textContent = MODE === 'aes' ? '🔒 AES-256-GCM' : '⚠ XOR obfuscated';
    badge.title = MODE === 'aes'
      ? 'Local state is sealed with AES-256-GCM (WebCrypto) before storage.'
      : 'WebCrypto unavailable in this browser — data is obfuscated, not truly encrypted.';
  }

  /* ---------- onboarding ---------- */
  function bindOnboard() {
    const h = $('#ob-handle');
    const preview = () => {
      const v = (h.value || '').toLowerCase();
      $('#ob-mailbox').textContent = (v || 'yourhandle') + '@' + C.domain;
    };
    h.addEventListener('input', preview);
    preview();

    $('#ob-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const handle = (h.value || '').trim().toLowerCase();
      if (!/^[a-z0-9_]{3,24}$/.test(handle)) {
        toast('Handle: 3–24 letters, numbers or underscores.', 'err');
        return;
      }
      const p1 = $('#ob-pass').value;
      const p2 = $('#ob-pass2').value;
      if (p1 && p1.length < 8) { toast('Passphrase needs at least 8 characters (or leave empty).', 'err'); return; }
      if (p1 && p1 !== p2) { toast('Passphrases don’t match.', 'err'); return; }

      const btn = $('#ob-go');
      btn.disabled = true;
      btn.textContent = 'Sealing…';
      try {
        await createIdentity(handle, p1);
        closeModal('m-onboard');
        btn.disabled = false;
        btn.textContent = 'Enter Nocturne';
      } catch (err) {
        console.warn(err);
        toast('Something went wrong while sealing.', 'err');
        btn.disabled = false;
        btn.textContent = 'Enter Nocturne';
      }
    });
  }

  async function createIdentity(handle, pass) {
    const now = Date.now();
    S = {
      v: 1,
      profile: { handle, mailbox: handle + '@' + C.domain, createdAt: now },
      convos: seedConvos(handle, now),
      mail: { inbox: seedMail(handle, now), sent: [] },
      txs: []
    };

    const store = { v: 1, keyMode: pass ? 'passphrase' : 'none' };
    if (NC.available()) {
      const key = await NC.newDeviceKey();
      KEY = key;
      MODE = 'aes';
      store.mode = 'aes';
      store.rawKey = pass ? null : await NC.exportRawKey(key);
      if (pass) store.wrapped = await NC.wrapKey(key, pass);
      store.sealed = await NC.seal(key, S);
    } else {
      const raw = NC.randomRawKeyB64();
      KEY = raw;
      MODE = 'xor';
      store.mode = 'xor';
      store.rawKey = raw;
      store.xor = NC.xorSeal(raw, S);
    }
    localStorage.setItem(LS_KEY, JSON.stringify(store));
    enterApp();
  }

  /* ---------- unlock ---------- */
  function bindUnlock() {
    $('#ul-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const pass = $('#ul-pass').value;
      const store = storeRaw();
      if (!store) { toast('No local Nocturne data found.', 'err'); return; }
      if (store.mode === 'xor') {
        /* WebCrypto unavailable at creation time: key is stored plain */
        KEY = store.rawKey;
        MODE = 'xor';
        S = NC.xorOpen(store.xor, KEY);
        closeModal('m-unlock');
        enterApp();
        return;
      }
      if (!store.wrapped) { toast('No passphrase-locked data found.', 'err'); return; }
      try {
        const key = await NC.unwrapKey(store.wrapped, pass);
        S = await NC.open(store.sealed, key);
        KEY = key;
        MODE = 'aes';
        closeModal('m-unlock');
        enterApp();
      } catch (err) {
        $('#ul-pass').value = '';
        $('#ul-pass').focus();
        toast('Wrong passphrase — the seal holds.', 'err');
      }
    });
    $('#ul-reset').addEventListener('click', () => {
      localStorage.removeItem(LS_KEY);
      location.reload();
    });
  }

  /* ---------- clear data ---------- */
  function bindClear() {
    $('#clear-go').addEventListener('click', () => {
      localStorage.removeItem(LS_KEY);
      location.reload();
    });
  }

  /* ---------- seeding ---------- */
  function seedConvos(handle, now) {
    return C.contacts.map((c, i) => {
      const ts = now - 1000 * 60 * 12 * (C.contacts.length - i);
      const text = (c.welcome || '').replace('{handle}', handle);
      return {
        id: c.id,
        handle: c.handle,
        name: c.name,
        color: c.color,
        system: !!c.system,
        online: !!c.online,
        userMade: false,
        silent: false,
        replies: (c.replies || []).slice(),
        _ri: 0,
        msgs: text ? [{ id: uid(), from: 'them', text, ts, status: 'read' }] : [],
        lastActive: ts
      };
    });
  }

  function seedMail(handle, now) {
    return C.welcomeMail.map((m, i) => ({
      id: uid(),
      from: m.from,
      name: m.name,
      subject: m.subject,
      body: m.body.replace(/\{handle\}/g, handle),
      ts: now - 1000 * 60 * 9 * (C.welcomeMail.length - i),
      read: false
    }));
  }

  /* ---------- lookups ---------- */
  const convo = (id) => (S ? S.convos.find((c) => c.id === id) : null);
  const asset = (id) => C.assets.find((a) => a.id === id);
  const isChatVisible = () => TAB === 'messages' && !$('#app').classList.contains('hidden');

  /* ---------- side panel ---------- */
  function renderSide() {
    const box = $('#side-list');
    if (!S || !box) return;
    let html = '';

    if (TAB === 'messages') {
      const list = S.convos.slice().sort((a, b) => b.lastActive - a.lastActive);
      html = list.map((c) => {
        const last = c.msgs[c.msgs.length - 1];
        const preview = c.typing
          ? '<i>typing…</i>'
          : last ? esc(last.from === 'me' ? 'You: ' + last.text : last.text) : '—';
        return (
          '<button class="side-item ' + (CUR_CONVO === c.id ? 'active' : '') + '" data-act="open-convo" data-id="' + c.id + '">' +
          '<span class="avatar sm" style="--c:' + c.color + '">' + esc(c.name.slice(0, 1).toUpperCase()) + '</span>' +
          '<span class="side-main"><b>' + esc(c.name) + '</b>' +
          '<small class="side-prev">' + preview + '</small></span>' +
          '<span class="side-time">' + (last ? timeAgo(last.ts) : '') + '</span>' +
          '</button>'
        );
      }).join('');
    } else if (TAB === 'mail') {
      const unread = S.mail.inbox.filter((m) => !m.read).length;
      html =
        '<button class="side-item ' + (MAIL_VIEW.tab === 'inbox' && !MAIL_VIEW.id ? 'active' : '') + '" data-act="mail-folder" data-tab="inbox">' +
        '<span class="avatar sm" style="--c:#ffffff">✉</span>' +
        '<span class="side-main"><b>Inbox</b><small class="side-prev">' + unread + ' unread</small></span>' +
        '</button>' +
        '<button class="side-item ' + (MAIL_VIEW.tab === 'sent' && !MAIL_VIEW.id ? 'active' : '') + '" data-act="mail-folder" data-tab="sent">' +
        '<span class="avatar sm" style="--c:#9a9a9a">↗</span>' +
        '<span class="side-main"><b>Sent</b><small class="side-prev">' + S.mail.sent.length + ' messages</small></span>' +
        '</button>';
    } else if (TAB === 'send') {
      html =
        '<div class="side-note">' +
        '<b>Quiet rails</b>' +
        '<p>Midnight (NIGHT) · Cardano (ADA) · Bitcoin (BTC).</p>' +
        '<p>Addresses are validated per-chain and rendered to a real, scannable QR. The broadcast step is a simulation — this is a static site.</p>' +
        '</div>';
    } else if (TAB === 'activity') {
      const n = S.txs.length;
      html =
        '<div class="side-note"><b>Activity</b>' +
        '<p>' + n + ' simulated send' + (n === 1 ? '' : 's') + ' recorded locally.</p>' +
        '<p>Nothing here was ever relayed. That is the point of the honesty panel.</p></div>';
    }
    box.innerHTML = html;
  }

  /* ---------- main pane ---------- */
  function renderMain() {
    const main = $('#app-main');
    if (!S || !main) return;
    if (TAB === 'messages') renderMessages(main);
    else if (TAB === 'mail') renderMail(main);
    else if (TAB === 'send') renderSend(main);
    else renderActivity(main);
    renderSide();
  }

  /* ---------- messages ---------- */
  function contactListHtml() {
    const list = S.convos.slice().sort((a, b) => b.lastActive - a.lastActive);
    return (
      '<div class="pane-head"><div><h3>Messages</h3><p class="muted">Sealed end-to-end · stored only in this browser</p></div>' +
      '<button class="btn btn-ghost" data-act="new-chat">＋ New chat</button></div>' +
      '<div class="c-list">' +
      list.map((c) => {
        const last = c.msgs[c.msgs.length - 1];
        const preview = c.typing ? '<i>typing…</i>' : last ? esc(last.text) : 'Say hello';
        return (
          '<button class="c-row" data-act="open-convo" data-id="' + c.id + '">' +
          '<span class="avatar" style="--c:' + c.color + '">' + esc(c.name.slice(0, 1).toUpperCase()) + '</span>' +
          '<span class="c-mid"><b>' + esc(c.name) + '</b><small>' + preview + '</small></span>' +
          '<span class="c-end"><span class="dot ' + (c.online ? 'on' : '') + '"></span>' + (last ? timeAgo(last.ts) : '') + '</span>' +
          '</button>'
        );
      }).join('') +
      '</div>'
    );
  }

  function bubbleHtml(m, c) {
    const me = m.from === 'me';
    const ticks = me
      ? '<span class="tick t-' + m.status + '" title="' + m.status + '">' +
        (m.status === 'sent' ? '✓' : '✓✓') + '</span>'
      : '';
    return (
      '<div class="msg ' + (me ? 'me' : 'them') + '" data-mid="' + m.id + '">' +
      '<div class="bubble">' + esc(m.text).replace(/\n/g, '<br>') + '</div>' +
      '<div class="meta">' + clock(m.ts) + ' ' + ticks + '</div></div>'
    );
  }

  function renderMessages(main) {
    const showList = mqMobile() && !chatOpen;
    if (showList) {
      main.innerHTML = contactListHtml();
      return;
    }
    const c = convo(CUR_CONVO) || S.convos[0];
    if (!c) { main.innerHTML = '<div class="empty"><span class="empty-moon">☾</span><p>No conversations yet.</p><button class="btn btn-primary" data-act="new-chat">Start one</button></div>'; return; }
    CUR_CONVO = c.id;

    main.innerHTML =
      '<div class="chat">' +
      '<header class="chat-head">' +
      '<button class="icon-btn back-m" data-act="chat-back" aria-label="Back to conversations">←</button>' +
      '<span class="avatar" style="--c:' + c.color + '">' + esc(c.name.slice(0, 1).toUpperCase()) + '</span>' +
      '<div class="chat-id"><b>' + esc(c.name) + '</b>' +
      '<span class="chat-sub">@' + esc(c.handle) + ' · ' + (c.online ? 'online' : 'offline') +
      ' <span class="lock-chip">🔒 sealed</span></span></div>' +
      '</header>' +
      '<div class="msgs" id="msgs">' + c.msgs.map((m) => bubbleHtml(m, c)).join('') +
      '<div class="typing ' + (c.typing ? '' : 'hidden') + '" id="typing"><span></span><span></span><span></span></div>' +
      '</div>' +
      '<form class="composer" id="composer">' +
      '<input id="msg-input" type="text" maxlength="500" placeholder="Whisper to @' + esc(c.handle) + '…" autocomplete="off">' +
      '<button class="btn btn-primary" type="submit" aria-label="Send">Send</button>' +
      '</form>' +
      '</div>';

    c._rendered = c.msgs.length;
    scrollMsgs();
    const input = $('#msg-input');
    if (input) input.focus();
  }

  function scrollMsgs() {
    const box = $('#msgs');
    if (box) box.scrollTop = box.scrollHeight;
  }

  function appendMsgDom(c) {
    const box = $('#msgs');
    if (!box) return;
    if (c._rendered == null) c._rendered = 0;
    for (let i = c._rendered; i < c.msgs.length; i++) {
      const typing = $('#typing');
      const div = document.createElement('div');
      div.innerHTML = bubbleHtml(c.msgs[i], c);
      box.insertBefore(div.firstChild, typing || null);
    }
    c._rendered = c.msgs.length;
    scrollMsgs();
  }

  function setTypingDom(c, on) {
    const t = $('#typing');
    if (t) t.classList.toggle('hidden', !on);
  }

  function setTickDom(c) {
    const box = $('#msgs');
    if (!box) return;
    c.msgs.forEach((m) => {
      if (m.from !== 'me') return;
      const el = box.querySelector('[data-mid="' + m.id + '"] .tick');
      if (el) {
        el.className = 'tick t-' + m.status;
        el.textContent = m.status === 'sent' ? '✓' : '✓✓';
        el.title = m.status;
      }
    });
  }

  function openConvo(id) {
    CUR_CONVO = id;
    chatOpen = true;
    const c = convo(id);
    if (c) c._rendered = null; // force full render
    renderMain();
  }

  function sendMsg() {
    const input = $('#msg-input');
    const c = convo(CUR_CONVO);
    if (!input || !c) return;
    const text = input.value.trim();
    if (!text) return;
    input.value = '';

    const mine = { id: uid(), from: 'me', text, ts: Date.now(), status: 'sent' };
    c.msgs.push(mine);
    c.lastActive = Date.now();
    c._rendered = null;
    save();

    if (isChatVisible()) {
      renderMessages($('#app-main'));
    } else {
      renderSide();
    }

    /* delivered tick */
    timers.push(setTimeout(() => {
      if (mine.status === 'sent') mine.status = 'delivered';
      save();
      if (isChatVisible() && CUR_CONVO === c.id) setTickDom(c);
    }, 600));

    if (c.silent) return;

    const lines = c.replies && c.replies.length ? c.replies : C.genericReplies;
    const line = lines[c._ri % lines.length];
    c._ri += 1;
    if (c.userMade && c._ri >= 1) c.silent = true;

    timers.push(setTimeout(() => {
      c.typing = true;
      save();
      if (isChatVisible() && CUR_CONVO === c.id) setTypingDom(c, true);
    }, 700));

    timers.push(setTimeout(() => {
      c.typing = false;
      const theirs = {
        id: uid(),
        from: 'them',
        text: line.replace('{handle}', S.profile.handle),
        ts: Date.now(),
        status: 'read'
      };
      c.msgs.push(theirs);
      c.msgs.forEach((m) => { if (m.from === 'me') m.status = 'read'; });
      c.lastActive = Date.now();
      save();
      if (isChatVisible() && CUR_CONVO === c.id) {
        setTypingDom(c, false);
        appendMsgDom(c);
        setTickDom(c);
      }
      renderSide();
    }, 2100 + Math.random() * 1600));
  }

  /* ---------- new chat ---------- */
  function bindNewChat() {
    $('#nc-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const h = ($('#nc-handle').value || '').trim().toLowerCase().replace(/^@/, '');
      if (!/^[a-z0-9_]{3,24}$/.test(h)) { toast('Handle: 3–24 letters, numbers or underscores.', 'err'); return; }
      let c = S.convos.find((x) => x.handle === h);
      if (!c) {
        const palette = ['#ffffff', '#ffffff', '#9a9a9a', '#cfcfcf', '#ffffff'];
        c = {
          id: uid(),
          handle: h,
          name: h,
          color: palette[Math.floor(Math.random() * palette.length)],
          system: false,
          online: Math.random() > 0.4,
          userMade: true,
          silent: false,
          replies: C.genericReplies.slice(),
          _ri: 0,
          msgs: [],
          lastActive: Date.now()
        };
        S.convos.push(c);
      }
      save();
      closeModal('m-newchat');
      $('#nc-handle').value = '';
      openConvo(c.id);
    });
  }

  /* ---------- mail ---------- */
  function renderMail(main) {
    if (MAIL_VIEW.id) {
      const m = S.mail.inbox.concat(S.mail.sent).find((x) => x.id === MAIL_VIEW.id);
      if (m) {
        main.innerHTML =
          '<div class="pane-head">' +
          '<button class="icon-btn" data-act="mail-back" aria-label="Back to mailbox">←</button>' +
          '<div><h3>' + esc(m.subject || '(no subject)') + '</h3></div></div>' +
          '<div class="mail-read">' +
          '<div class="mail-from"><span class="avatar" style="--c:' + (m.from === S.profile.mailbox ? '#ffffff' : '#9a9a9a') + '">' +
          esc((m.name || m.from).slice(0, 1).toUpperCase()) + '</span>' +
          '<div><b>' + esc(m.name || m.from) + '</b><small>' + esc(m.from) + (m.from === S.profile.mailbox ? ' (you)' : '') + '</small></div></div>' +
          '<div class="mail-body">' + esc(m.body).replace(/\n/g, '<br>') + '</div>' +
          '<div class="mail-foot">' + new Date(m.ts).toLocaleString() + ' · sealed at rest 🔒</div>' +
          '</div>';
        return;
      }
      MAIL_VIEW = { tab: MAIL_VIEW.tab, id: null };
    }

    const list = S.mail[MAIL_VIEW.tab].slice().sort((a, b) => b.ts - a.ts);
    main.innerHTML =
      '<div class="pane-head"><div><h3>' + (MAIL_VIEW.tab === 'inbox' ? 'Inbox' : 'Sent') + '</h3>' +
      '<p class="muted">' + esc(S.profile.mailbox) + ' · local, sealed, no landlord</p></div>' +
      '<button class="btn btn-ghost" data-act="compose">✎ Compose</button></div>' +
      (list.length
        ? '<div class="m-list">' + list.map((m) => (
            '<button class="m-row ' + (m.read ? '' : 'unread') + '" data-act="open-mail" data-id="' + m.id + '">' +
            '<span class="avatar sm" style="--c:' + (m.from === S.profile.mailbox ? '#ffffff' : '#9a9a9a') + '">' + esc((m.name || m.from).slice(0, 1).toUpperCase()) + '</span>' +
            '<span class="m-mid"><b>' + esc(m.subject || '(no subject)') + '</b><small>' + esc(m.body.slice(0, 90)) + '…</small></span>' +
            '<span class="m-end">' + (MAIL_VIEW.tab === 'sent' ? '↗ ' : '') + timeAgo(m.ts) + '</span>' +
            '</button>'
          )).join('') + '</div>'
        : '<div class="empty"><span class="empty-moon">✉</span><p>Quiet in here.</p></div>');
  }

  function bindMail() {
    $('#compose-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const to = ($('#cm-to').value || '').trim();
      const subject = ($('#cm-subj').value || '').trim();
      const body = ($('#cm-body').value || '').trim();
      if (!/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(to)) { toast('Enter a valid recipient address.', 'err'); return; }
      if (!body) { toast('Give the mail some words.', 'err'); return; }
      const m = {
        id: uid(),
        from: S.profile.mailbox,
        name: '@' + S.profile.handle,
        to,
        subject: subject || '(no subject)',
        body,
        ts: Date.now(),
        read: true
      };
      S.mail.sent.unshift(m);
      if (to.toLowerCase() === S.profile.mailbox.toLowerCase()) {
        S.mail.inbox.unshift({ id: uid(), from: to, name: 'you', to, subject: m.subject, body, ts: m.ts, read: false });
      }
      save();
      closeModal('m-compose');
      $('#cm-to').value = ''; $('#cm-subj').value = ''; $('#cm-body').value = '';
      renderSide();
      if (TAB === 'mail') renderMail($('#app-main'));
      toast('Sent to ' + to + ' (kept in Sent).');
    });
  }

  /* ---------- send crypto ---------- */
  function renderSend(main) {
    const a = asset(SND.asset);
    main.innerHTML =
      '<div class="pane-head"><div><h3>Send crypto</h3><p class="muted">Quiet rails · fees shown upfront · QR is real, broadcast is simulated</p></div></div>' +
      '<div class="asset-row">' + C.assets.map((x) => (
        '<button class="asset-card ' + (x.id === SND.asset ? 'sel' : '') + '" data-act="pick-asset" data-id="' + x.id + '" style="--c:' + x.color + '">' +
        coinIcon(x) + '<b>' + x.ticker + '</b><small>' + x.name + '</small>' +
        '</button>'
      )).join('') + '</div>' +
      '<div class="form">' +
      '<label>Recipient address<input id="snd-addr" type="text" spellcheck="false" placeholder="' + esc(a.addrHint) + '" value="' + esc(SND.addr) + '"></label>' +
      '<div class="field-note ' + (SND.addrOk ? 'ok' : '') + '" id="snd-addr-note">' +
        (SND.addrOk ? '✓ Looks like a valid ' + a.name + ' address.' : 'We’ll check this against ' + a.name + '’s address rules as you type.') +
      '</div>' +
      '<div class="form-grid">' +
      '<label>Amount (' + a.ticker + ')<input id="snd-amt" type="text" inputmode="decimal" placeholder="0.0" value="' + esc(SND.amt) + '"></label>' +
      '<label>Memo (optional)<input id="snd-memo" type="text" maxlength="140" placeholder="e.g. dinner, anon" value="' + esc(SND.memo) + '"></label>' +
      '</div>' +
      '<div class="fee-row"><span>Network fee (demo)</span><b>' + a.feeLabel + '</b></div>' +
      '<button class="btn btn-primary btn-lg" id="snd-review" ' + (canReview() ? '' : 'disabled') + '>Review & seal</button>' +
      '</div>';

    $('#snd-addr').addEventListener('input', onSndInput);
    $('#snd-amt').addEventListener('input', onSndInput);
    $('#snd-memo').addEventListener('input', onSndInput);
    $('#snd-review').addEventListener('click', openReview);
  }

  const SND = { asset: 'NIGHT', addr: '', addrOk: false, amt: '', memo: '' };

  function coinIcon(a) {
    if (a.icon === 'moon') return '<span class="coin">☾</span>';
    if (a.icon === 'btc') return '<span class="coin">₿</span>';
    return '<span class="coin dots">' + '<i></i><i></i><i></i><i></i><i></i><i></i></span>';
  }

  function onSndInput(e) {
    const a = asset(SND.asset);
    const addr = ($('#snd-addr') ? $('#snd-addr').value : SND.addr).trim();
    const amt = ($('#snd-amt') ? $('#snd-amt').value : SND.amt).trim();
    SND.addr = addr;
    SND.amt = amt;
    const memo = $('#snd-memo') ? $('#snd-memo').value : SND.memo;
    SND.memo = memo;

    SND.addrOk = !!addr && a.validate(addr);
    const amtNum = Number(amt.replace(',', '.'));
    SND.amtOk = amt !== '' && isFinite(amtNum) && amtNum > 0 &&
      amtNum === Number(amtNum.toFixed(a.precision));

    const note = $('#snd-addr-note');
    if (note) {
      note.className = 'field-note ' + (SND.addrOk ? 'ok' : (addr ? 'bad' : ''));
      note.textContent = addr
        ? (SND.addrOk ? '✓ Looks like a valid ' + a.name + ' address.'
          : '✗ That doesn’t match ' + a.name + ' address rules (' + a.addrHint + ').')
        : 'We’ll check this against ' + a.name + '’s address rules as you type.';
    }
    const btn = $('#snd-review');
    if (btn) btn.disabled = !(SND.addrOk && SND.amtOk);
  }

  function canReview() {
    return SND.addrOk && SND.amtOk;
  }

  function pickAsset(id) {
    SND.asset = id;
    SND.addrOk = false;
    SND.amtOk = false;
    renderMain();
  }

  function openReview() {
    const a = asset(SND.asset);
    if (!SND.addrOk || !SND.amtOk) return;
    const amt = Number(SND.amt.replace(',', '.'));
    $('#rv-asset-dot').style.setProperty('--c', a.color);
    $('#rv-asset-dot').textContent = a.ticker === 'NIGHT' ? '☾' : a.ticker === 'BTC' ? '₿' : '●';
    $('#rv-from').textContent = '@' + S.profile.handle;
    $('#rv-amount').textContent = fmtAmt(amt, a.precision) + ' ' + a.ticker;
    $('#rv-fee').textContent = a.feeLabel;
    $('#rv-addr-full').textContent = SND.addr;
    $('#rv-memo').textContent = SND.memo || '—';
    const qr = $('#rv-qr');
    try {
      const q = qrcode(0, 'M');
      q.addData(SND.addr);
      q.make();
      qr.innerHTML = q.createSvgTag({ cellSize: 4, margin: 2, scalable: true, alt: { text: 'Recipient address' } });
    } catch (e) {
      qr.innerHTML = '<div class="qr-fallback">' + esc(SND.addr) + '</div>';
    }
    $('#rv-success').classList.add('hidden');
    $('#rv-progress').classList.remove('hidden');
    $$('#rv-progress .step').forEach((s) => s.className = 'step');
    openModal('m-review');
    $('#rv-broadcast').disabled = false;
  }

  async function broadcast() {
    const a = asset(SND.asset);
    const amt = Number(SND.amt.replace(',', '.'));
    const btn = $('#rv-broadcast');
    btn.disabled = true;
    const steps = $$('#rv-progress .step');
    const labels = [
      'Sealing payload (AES-256-GCM)',
      'Broadcasting to ' + a.name,
      '1 confirmation (simulated)'
    ];
    steps.forEach((s, i) => { s.querySelector('b').textContent = labels[i]; });
    for (let i = 0; i < steps.length; i++) {
      steps[i].classList.add('busy');
      await sleep(i === 0 ? 500 : 950);
      steps[i].classList.remove('busy');
      steps[i].classList.add('done');
    }
    const hash = Array.from(self.crypto.getRandomValues(new Uint8Array(32)))
      .map((b) => b.toString(16).padStart(2, '0')).join('');
    const tx = {
      id: uid(),
      asset: a.id,
      name: a.name,
      color: a.color,
      icon: a.icon,
      amount: amt,
      fee: a.fee,
      addr: SND.addr,
      memo: SND.memo,
      ts: Date.now(),
      hash,
      status: 'confirmed'
    };
    S.txs.unshift(tx);
    save();
    $('#rv-progress').classList.add('hidden');
    $('#rv-success').classList.remove('hidden');
    $('#tx-hash').textContent = hash;
    if (TAB === 'activity') renderMain(); else renderSide();
  }

  function bindReview() {
    $('#rv-broadcast').addEventListener('click', broadcast);
    $('#rv-copy').addEventListener('click', async () => {
      const ok = await copyText(SND.addr);
      toast(ok ? 'Address copied.' : 'Copy failed.', ok ? '' : 'err');
    });
    $('#tx-hash').addEventListener('click', async () => {
      const ok = await copyText($('#tx-hash').textContent);
      toast(ok ? 'Hash copied.' : 'Copy failed.', ok ? '' : 'err');
    });
    $('#rv-done').addEventListener('click', () => {
      closeModal('m-review');
      SND.addr = ''; SND.amt = ''; SND.memo = ''; SND.addrOk = false; SND.amtOk = false;
      TAB = 'activity';
      setTab('activity');
    });
  }

  /* ---------- activity ---------- */
  function renderActivity(main) {
    const list = S.txs;
    main.innerHTML =
      '<div class="pane-head"><div><h3>Activity</h3><p class="muted">Simulated sends · recorded locally · never relayed</p></div></div>' +
      (list.length
        ? '<div class="tx-list">' + list.map((t) => (
            '<div class="tx-row">' +
            '<span class="tx-coin" style="--c:' + t.color + '">' + (t.icon === 'moon' ? '☾' : t.icon === 'btc' ? '₿' : '●') + '</span>' +
            '<div class="tx-mid"><b>−' + fmtAmt(t.amount, 8) + ' ' + t.asset + '</b>' +
            '<small>' + esc(t.name) + ' · to ' + trunc(t.addr, 8, 8) + (t.memo ? ' · “' + esc(t.memo) + '”' : '') + '</small></div>' +
            '<div class="tx-end"><span class="chip">confirmed · simulated</span>' +
            '<small class="tx-time">' + timeAgo(t.ts) + '</small></div>' +
            '<button class="link tx-hash" data-act="copy-hash" data-hash="' + t.hash + '" data-label="Transaction hash">📋 ' + trunc(t.hash, 6, 6) + '</button>' +
            '</div>'
          )).join('') + '</div>'
        : '<div class="empty"><span class="empty-moon">☾</span><p>No sends yet.</p><button class="btn btn-primary" data-act="go-send">Send something quiet</button></div>');
  }

  /* ---------- tabs ---------- */
  function setTab(tab) {
    TAB = tab;
    $$('.tab-btn').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
    if (tab === 'mail') MAIL_VIEW = { tab: MAIL_VIEW.tab, id: null };
    if (tab === 'messages' && mqMobile()) chatOpen = false;
    renderMain();
  }

  /* ---------- global action delegation ---------- */
  function bindActions() {
    /* modal cancel buttons */
    $$('[data-close]').forEach((b) => b.addEventListener('click', () => closeModal(b.dataset.close)));

    document.addEventListener('click', async (e) => {
      const el = e.target.closest('[data-act]');
      if (el) {
        const act = el.dataset.act;
        switch (act) {
          case 'enter': enterFlow(); break;
          case 'to-site': toSite(); break;
          case 'tab': setTab(el.dataset.tab); break;
          case 'open-convo': openConvo(el.dataset.id); break;
          case 'chat-back': chatOpen = false; renderMain(); break;
          case 'new-chat': openModal('m-newchat'); break;
          case 'mail-folder': MAIL_VIEW = { tab: el.dataset.tab, id: null }; renderMain(); break;
          case 'mail-back': MAIL_VIEW.id = null; renderMain(); break;
          case 'open-mail': {
            const m = S.mail.inbox.concat(S.mail.sent).find((x) => x.id === el.dataset.id);
            if (m && !m.read) { m.read = true; save(); }
            MAIL_VIEW.id = el.dataset.id;
            renderMain();
            break;
          }
          case 'compose': {
            const t = $('#cm-to');
            if (t && !t.value) t.value = S.profile.handle + '@' + C.domain;
            const f = $('#cm-from');
            if (f) f.textContent = S.profile.mailbox;
            openModal('m-compose');
            break;
          }
          case 'pick-asset': pickAsset(el.dataset.id); break;
          case 'copy-hash': {
            const ok = await copyText(el.dataset.hash);
            toast(ok ? el.dataset.label + ' copied.' : 'Copy failed.', ok ? '' : 'err');
            break;
          }
          case 'go-send': setTab('send'); break;
          case 'ask-clear': openModal('m-clear'); break;
        }
      }
      const cp = e.target.closest('[data-copy]');
      if (cp) {
        const ok = await copyText(cp.dataset.copy);
        toast(ok ? (cp.dataset.label || 'Address') + ' copied.' : 'Copy failed.', ok ? '' : 'err');
      }
    });

    document.addEventListener('submit', (e) => {
      if (e.target && e.target.id === 'composer') {
        e.preventDefault();
        sendMsg();
      }
    });
  }

  /* ---------- landing page bits ---------- */
  function initLanding() {
    const burger = $('#nav-burger');
    if (burger) burger.addEventListener('click', () => {
      $('.nav-links').classList.toggle('open');
    });
    $$('.nav-links a').forEach((a) => a.addEventListener('click', () => {
      $('.nav-links').classList.remove('open');
    }));

    const io = ('IntersectionObserver' in window)
      ? new IntersectionObserver((entries) => {
          entries.forEach((en) => {
            if (en.isIntersecting) { en.target.classList.add('in'); io.unobserve(en.target); }
          });
        }, { threshold: 0.12 })
      : null;
    $$('.reveal').forEach((el) => io ? io.observe(el) : el.classList.add('in'));

    const yr = $('#year');
    if (yr) yr.textContent = new Date().getFullYear();
  }

  /* ---------- starfield ---------- */
  function initStars() {
    const cv = document.getElementById('stars');
    if (!cv) return;
    const ctx = cv.getContext('2d');
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    let stars = [];
    function seed() {
      const n = Math.min(230, Math.floor((cv.width * cv.height) / 9000));
      stars = Array.from({ length: n }, () => ({
        x: Math.random() * cv.width,
        y: Math.random() * cv.height,
        r: Math.random() * 1.3 + 0.2,
        p: Math.random() * Math.PI * 2,
        s: 0.4 + Math.random() * 1.2
      }));
    }
    function resize() {
      cv.width = window.innerWidth;
      cv.height = window.innerHeight;
      seed();
      if (reduced) frame();
    }
    function frame() {
      ctx.clearRect(0, 0, cv.width, cv.height);
      for (const st of stars) {
        st.p += 0.012 * st.s;
        ctx.globalAlpha = 0.22 + 0.6 * (0.5 + 0.5 * Math.sin(st.p));
        ctx.fillStyle = st.r > 1.1 ? '#e8e8e8' : '#b3b3b3';
        ctx.beginPath();
        ctx.arc(st.x, st.y, st.r, 0, 7);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
    window.addEventListener('resize', resize);
    resize();
    if (!reduced) (function loop() { frame(); requestAnimationFrame(loop); })();
  }

  /* ---------- boot ---------- */
  function boot() {
    initStars();
    initLanding();
    bindOnboard();
    bindUnlock();
    bindClear();
    bindNewChat();
    bindMail();
    bindReview();
    bindActions();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
