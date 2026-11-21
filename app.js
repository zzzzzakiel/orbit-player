/* Orbit Player: local music + SoundCloud likes, click wheel UI, themes, stickers.
   No dependencies. Library lives in the browser's IndexedDB on this device. */
(function () {
  'use strict';

  /* ================= helpers ================= */
  const $ = (s, r) => (r || document).querySelector(s);
  const ls = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* storage unavailable */ } },
    del(k) { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } }
  };
  const uid = () => (window.crypto && crypto.randomUUID ? crypto.randomUUID() : 'id' + Date.now().toString(36) + Math.random().toString(36).slice(2, 9));
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  function fmt(t) {
    if (!isFinite(t) || t < 0) t = 0;
    t = Math.floor(t);
    return Math.floor(t / 60) + ':' + String(t % 60).padStart(2, '0');
  }
  const b64u = (u8) => btoa(String.fromCharCode.apply(null, u8)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const view = $('#view');
  const audio = $('#audio');

  let toastTimer = 0;
  function toast(msg, ms) {
    const el = $('#toast');
    el.textContent = msg;
    el.classList.add('on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('on'), ms || 1900);
  }

  function askText(title, value) {
    return new Promise((resolve) => {
      const m = $('#modal'), inp = $('#modalInput');
      $('#modalTitle').textContent = title;
      inp.value = value || '';
      m.hidden = false;
      setTimeout(() => { try { inp.focus(); inp.select(); } catch (e) { /* ignore */ } }, 30);
      const done = (v) => {
        m.hidden = true;
        $('#modalOk').onclick = $('#modalCancel').onclick = inp.onkeydown = null;
        resolve(v);
      };
      $('#modalOk').onclick = () => done(inp.value.trim() || null);
      $('#modalCancel').onclick = () => done(null);
      inp.onkeydown = (e) => { if (e.key === 'Enter') done(inp.value.trim() || null); if (e.key === 'Escape') done(null); };
    });
  }

  /* ================= settings ================= */
  const cfg = Object.assign({ theme: 'silver', click: false, shuffle: false, repeat: 'off', demo: false }, ls.get('orbit.cfg', {}));
  const saveCfg = () => ls.set('orbit.cfg', cfg);

  /* ================= storage (IndexedDB with in-memory fallback) ================= */
  let db = null;
  const mem = { songs: new Map(), blobs: new Map(), playlists: new Map() };
  function openDB() {
    return new Promise((res, rej) => {
      if (!window.indexedDB) return rej(new Error('no idb'));
      const r = indexedDB.open('orbit', 1);
      r.onupgradeneeded = () => {
        const d = r.result;
        d.createObjectStore('songs', { keyPath: 'id' });
        d.createObjectStore('blobs', { keyPath: 'id' });
        d.createObjectStore('playlists', { keyPath: 'id' });
      };
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  }
  function idb(store, mode, op) {
    return new Promise((res, rej) => {
      try {
        const t = db.transaction(store, mode);
        const r = op(t.objectStore(store));
        t.oncomplete = () => res(r && r.result);
        t.onerror = () => rej(t.error);
        t.onabort = () => rej(t.error);
      } catch (e) { rej(e); }
    });
  }
  const DB = {
    all: (s) => db ? idb(s, 'readonly', (o) => o.getAll()) : Promise.resolve(Array.from(mem[s].values())),
    get: (s, id) => db ? idb(s, 'readonly', (o) => o.get(id)) : Promise.resolve(mem[s].get(id)),
    put: (s, v) => db ? idb(s, 'readwrite', (o) => o.put(v)) : (mem[s].set(v.id, v), Promise.resolve()),
    del: (s, id) => db ? idb(s, 'readwrite', (o) => o.delete(id)) : (mem[s].delete(id), Promise.resolve()),
    clear: (s) => db ? idb(s, 'readwrite', (o) => o.clear()) : (mem[s].clear(), Promise.resolve())
  };

  const lib = { songs: [], byId: new Map(), playlists: [] };
  const cmpSong = (a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base', numeric: true });
  async function loadLib() {
    lib.songs = (await DB.all('songs')).sort(cmpSong);
    lib.byId = new Map(lib.songs.map((s) => [s.id, s]));
    lib.playlists = (await DB.all('playlists')).sort((a, b) => a.name.localeCompare(b.name));
  }

  /* ================= themes ================= */
  const THEMES = [
    { id: 'silver', name: 'Silver' },
    { id: 'graphite', name: 'Graphite' },
    { id: 'lime', name: 'Lime' },
    { id: 'grape', name: 'Grape Glitter' },
    { id: 'bubblegum', name: 'Bubblegum' },
    { id: 'milk', name: 'Milk' }
  ];
  function glitterURI(seed) {
    let r = seed;
    const rnd = () => { r = (r * 16807) % 2147483647; return r / 2147483647; };
    let s = '';
    const cols = ['#ffffff', '#ffd6f4', '#d9c2ff', '#bfe9ff'];
    for (let i = 0; i < 46; i++) {
      const x = (rnd() * 100).toFixed(1), y = (rnd() * 100).toFixed(1);
      s += "<circle cx='" + x + "' cy='" + y + "' r='" + (0.5 + rnd() * 1.3).toFixed(2) + "' fill='" + cols[Math.floor(rnd() * 4)] + "' opacity='" + (0.5 + rnd() * 0.5).toFixed(2) + "'/>";
      if (i % 7 === 0) {
        const X = +x, Y = +y;
        s += "<path d='M" + X + ' ' + (Y - 3) + 'L' + (X + 0.8) + ' ' + (Y - 0.8) + 'L' + (X + 3) + ' ' + Y + 'L' + (X + 0.8) + ' ' + (Y + 0.8) + 'L' + X + ' ' + (Y + 3) + 'L' + (X - 0.8) + ' ' + (Y + 0.8) + 'L' + (X - 3) + ' ' + Y + 'L' + (X - 0.8) + ' ' + (Y - 0.8) + "Z' fill='#fff' opacity='.9'/>";
      }
    }
    return 'url("data:image/svg+xml,' + encodeURIComponent("<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'>" + s + '</svg>') + '")';
  }
  function applyTheme(id) {
    if (!THEMES.some((t) => t.id === id)) id = 'silver';
    cfg.theme = id;
    document.documentElement.dataset.theme = id;
    saveCfg();
    renderStickers();
  }

  /* ================= stickers (original artwork) ================= */
  const S = (inner) => '<svg viewBox="-4 -4 72 72" xmlns="http://www.w3.org/2000/svg"><g filter="url(#stkOutline)">' + inner + '</g></svg>';
  const STICKERS = {
    star: S('<polygon points="32,4 40,24 61,25 45,38 50,59 32,47 14,59 19,38 3,25 24,24" fill="#ffd23f"/>'),
    heart: S('<path fill="#ff4f86" d="M32 57C10 41 5 27 12 17c6-8 16-6 20 2 4-8 14-10 20-2 7 10 2 24-20 40z"/><path d="M17 20c3-3 7-2 9 1" stroke="#fff" stroke-opacity=".7" stroke-width="2.4" fill="none" stroke-linecap="round"/>'),
    flower: S('<g fill="#ff9fd1"><circle cx="32" cy="15" r="11"/><circle cx="49" cy="27" r="11"/><circle cx="43" cy="47" r="11"/><circle cx="21" cy="47" r="11"/><circle cx="15" cy="27" r="11"/></g><circle cx="32" cy="32" r="9" fill="#ffd23f"/>'),
    smiley: S('<circle cx="32" cy="32" r="26" fill="#ffdf4d"/><circle cx="23" cy="27" r="3.2" fill="#2a2330"/><circle cx="41" cy="27" r="3.2" fill="#2a2330"/><path d="M20 38q12 14 24 0" stroke="#2a2330" stroke-width="3" fill="none" stroke-linecap="round"/>'),
    cat: S('<path d="M12 28 L14 6 L29 17 Q32 16.5 35 17 L50 6 L52 28 Q58 40 50 50 Q41 58 32 58 Q23 58 14 50 Q6 40 12 28Z" fill="#fff4e3"/><path d="M17 14l6 5-7 4zM47 14l-6 5 7 4z" fill="#ffc2d6"/><circle cx="23" cy="34" r="3" fill="#2a2330"/><circle cx="41" cy="34" r="3" fill="#2a2330"/><path d="M29 41h6l-3 3.4z" fill="#ff7aa5"/><path d="M32 44.4v3M32 47.4q-3 3-6 0M32 47.4q3 3 6 0M14 40l-8-2M14 44l-8 2M50 40l8-2M50 44l8 2" stroke="#2a2330" stroke-width="1.5" fill="none" stroke-linecap="round"/>'),
    bolt: S('<polygon points="37,3 14,36 29,36 22,61 50,26 34,26" fill="#ffe14a"/>'),
    cherry: S('<path d="M24 38Q26 16 44 8M42 40Q40 20 44 8" stroke="#3f9b4a" stroke-width="3" fill="none" stroke-linecap="round"/><circle cx="22" cy="46" r="11" fill="#e8264d"/><circle cx="43" cy="46" r="11" fill="#e8264d"/><path d="M44 8q8-2 12 3-8 3-12-3z" fill="#4cb85a"/>'),
    moon: S('<path d="M44 8a26 26 0 1 0 12 36A22 22 0 0 1 44 8z" fill="#ffe7a0"/>'),
    sparkle: S('<path d="M32 4C34 22 42 30 60 32 42 34 34 42 32 60 30 42 22 34 4 32 22 30 30 22 32 4Z" fill="#bfe6ff"/>'),
    cloud: S('<path d="M18 46a12 12 0 0 1 2-24 15 15 0 0 1 28 4 10 10 0 0 1-2 20z" fill="#cfe9ff"/>'),
    disco: S('<circle cx="32" cy="32" r="24" fill="#c7cfda"/><g fill="none" stroke="#8a94a3" stroke-width="1.3"><ellipse cx="32" cy="32" rx="9" ry="24"/><ellipse cx="32" cy="32" rx="18" ry="24"/><ellipse cx="32" cy="32" rx="24" ry="9"/><ellipse cx="32" cy="32" rx="24" ry="17"/></g><circle cx="23" cy="22" r="3" fill="#fff" opacity=".85"/>'),
    ladybug: S('<ellipse cx="32" cy="36" rx="22" ry="21" fill="#e8264d"/><path d="M32 15v42" stroke="#2a2330" stroke-width="2.4"/><circle cx="32" cy="15" r="9" fill="#2a2330"/><g fill="#2a2330"><circle cx="22" cy="32" r="3.6"/><circle cx="42" cy="32" r="3.6"/><circle cx="24" cy="46" r="3.2"/><circle cx="40" cy="46" r="3.2"/></g>')
  };
  let stk = ls.get('orbit.stk', {});
  let selStk = null;
  let editing = false;
  const saveStk = () => ls.set('orbit.stk', stk);
  const themeStk = () => stk[cfg.theme] || (stk[cfg.theme] = []);
  function renderStickers() {
    const host = $('#stickers');
    host.textContent = '';
    themeStk().forEach((s) => {
      const el = document.createElement('div');
      el.className = 'sticker' + (s.id === selStk ? ' sel' : '');
      el.dataset.id = s.id;
      el.style.cssText = 'left:' + s.x + '%;top:' + s.y + '%;width:' + s.s + 'cqw;height:' + s.s + 'cqw;transform:translate(-50%,-50%) rotate(' + s.r + 'deg)';
      el.innerHTML = STICKERS[s.k] || '';
      host.appendChild(el);
    });
  }
  function setEditing(on) {
    editing = on;
    selStk = null;
    $('#device').classList.toggle('editing', on);
    $('#tray').classList.toggle('on', on);
    if (on) {
      buildTray();
      setTimeout(() => { try { $('#tray').scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } catch (e) { /* ignore */ } }, 50);
    }
    renderStickers();
  }
  function buildTray() {
    const row = $('#trayRow');
    row.textContent = '';
    Object.keys(STICKERS).forEach((k) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.setAttribute('aria-label', 'Add ' + k + ' sticker');
      b.innerHTML = STICKERS[k];
      b.onclick = () => {
        const s = { id: uid(), k: k, x: 50 + (Math.random() * 20 - 10), y: 48 + (Math.random() * 20 - 10), s: 17, r: Math.round(Math.random() * 24 - 12) };
        themeStk().push(s);
        selStk = s.id;
        saveStk();
        renderStickers();
      };
      row.appendChild(b);
    });
    const tools = $('#trayTools');
    tools.textContent = '';
    const mk = (label, fn) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = label;
      b.onclick = fn;
      tools.appendChild(b);
    };
    const sel = () => themeStk().find((s) => s.id === selStk);
    const mod = (fn) => () => { const s = sel(); if (!s) { toast('Tap a sticker first'); return; } fn(s); saveStk(); renderStickers(); };
    mk('Smaller', mod((s) => { s.s = Math.max(6, s.s - 2.5); }));
    mk('Bigger', mod((s) => { s.s = Math.min(48, s.s + 2.5); }));
    mk('Rotate', mod((s) => { s.r = (s.r + 15) % 360; }));
    mk('Delete', mod((s) => { stk[cfg.theme] = themeStk().filter((x) => x !== s); selStk = null; }));
    mk('Done', () => setEditing(false));
  }
  (function stickerDrag() {
    const host = $('#stickers');
    host.addEventListener('pointerdown', (e) => {
      if (!editing) return;
      const el = e.target.closest('.sticker');
      if (!el) return;
      e.preventDefault();
      const s = themeStk().find((x) => x.id === el.dataset.id);
      if (!s) return;
      selStk = s.id;
      host.querySelectorAll('.sticker').forEach((n) => n.classList.toggle('sel', n === el));
      el.setPointerCapture(e.pointerId);
      const r = $('#device').getBoundingClientRect();
      const move = (ev) => {
        s.x = Math.max(0, Math.min(100, ((ev.clientX - r.left) / r.width) * 100));
        s.y = Math.max(0, Math.min(100, ((ev.clientY - r.top) / r.height) * 100));
        el.style.left = s.x + '%';
        el.style.top = s.y + '%';
      };
      const up = () => { el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); el.removeEventListener('pointercancel', up); saveStk(); };
      el.addEventListener('pointermove', move);
      el.addEventListener('pointerup', up);
      el.addEventListener('pointercancel', up);
    });
  })();

  /* ================= artwork ================= */
  function fallbackArt(title) {
    try {
      const c = document.createElement('canvas');
      c.width = c.height = 200;
      const g = c.getContext('2d');
      let h = 0;
      for (let i = 0; i < title.length; i++) h = (h * 31 + title.charCodeAt(i)) % 360;
      const gr = g.createLinearGradient(0, 0, 200, 200);
      gr.addColorStop(0, 'hsl(' + h + ',70%,58%)');
      gr.addColorStop(1, 'hsl(' + ((h + 50) % 360) + ',65%,28%)');
      g.fillStyle = gr;
      g.fillRect(0, 0, 200, 200);
      g.fillStyle = 'rgba(255,255,255,.85)';
      g.font = '700 96px -apple-system, Helvetica, Arial, sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText((title.trim()[0] || '♪').toUpperCase(), 100, 108);
      return c.toDataURL('image/jpeg', 0.8);
    } catch (e) { return ''; }
  }
  async function makeArt(pic) {
    if (!pic) return null;
    try {
      const bmp = await createImageBitmap(new Blob([pic.data], { type: pic.mime }));
      const c = document.createElement('canvas');
      const k = 240 / Math.max(bmp.width, bmp.height);
      c.width = Math.round(bmp.width * k);
      c.height = Math.round(bmp.height * k);
      c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
      return c.toDataURL('image/jpeg', 0.82);
    } catch (e) { return null; }
  }

  /* ================= importing ================= */
  async function readMoov(f) {
    let off = 0;
    while (off + 8 <= f.size) {
      const h = new Uint8Array(await f.slice(off, off + 16).arrayBuffer());
      let size = ((h[0] << 24) | (h[1] << 16) | (h[2] << 8) | h[3]) >>> 0;
      const type = String.fromCharCode(h[4], h[5], h[6], h[7]);
      if (size === 1) size = (((h[8] << 24) | (h[9] << 16) | (h[10] << 8) | h[11]) >>> 0) * 4294967296 + (((h[12] << 24) | (h[13] << 16) | (h[14] << 8) | h[15]) >>> 0);
      else if (size === 0) size = f.size - off;
      if (type === 'moov') return new Uint8Array(await f.slice(off, off + Math.min(size, 40 * 1024 * 1024)).arrayBuffer());
      if (size < 8) break;
      off += size;
    }
    return new Uint8Array(await f.slice(0, Math.min(f.size, 1 << 20)).arrayBuffer());
  }
  function blobDuration(blob) {
    return new Promise((res) => {
      const a = new Audio();
      const url = URL.createObjectURL(blob);
      const fin = (d) => { URL.revokeObjectURL(url); a.src = ''; res(isFinite(d) ? d : 0); };
      a.preload = 'metadata';
      a.onloadedmetadata = () => fin(a.duration);
      a.onerror = () => fin(0);
      setTimeout(() => fin(0), 5000);
      a.src = url;
    });
  }
  async function readMeta(f, id) {
    const ext = (f.name.split('.').pop() || '').toLowerCase();
    const u8 = (ext === 'm4a' || ext === 'mp4' || ext === 'aac') ? await readMoov(f) : new Uint8Array(await f.slice(0, Math.min(f.size, 6 * 1024 * 1024)).arrayBuffer());
    const t = window.OrbitTags.parseTags(u8, f.name);
    const art = (await makeArt(t.picture)) || fallbackArt(t.title);
    const duration = await blobDuration(f);
    return { id: id, title: t.title, artist: t.artist, album: t.album, duration: duration, art: art, fileName: f.name, size: f.size, added: Date.now() };
  }
  let importing = false;
  async function importFiles(files) {
    if (importing) return;
    const list = Array.from(files).filter((f) => /^audio\//.test(f.type) || /\.(mp3|m4a|aac|flac|wav|ogg|opus|mp4)$/i.test(f.name));
    if (!list.length) { toast('Pick audio files (mp3, m4a, flac, wav)'); return; }
    importing = true;
    let added = 0, dup = 0, bad = 0;
    for (let i = 0; i < list.length; i++) {
      const f = list[i];
      toast('Adding ' + (i + 1) + ' of ' + list.length + '…', 60000);
      if (lib.songs.some((s) => s.fileName === f.name && s.size === f.size)) { dup++; continue; }
      try {
        const id = uid();
        const meta = await readMeta(f, id);
        await DB.put('blobs', { id: id, blob: f });
        await DB.put('songs', meta);
        lib.songs.push(meta);
        lib.byId.set(id, meta);
        added++;
      } catch (e) { bad++; }
    }
    lib.songs.sort(cmpSong);
    importing = false;
    toast('Added ' + added + (dup ? ', skipped ' + dup + ' duplicate' + (dup > 1 ? 's' : '') : '') + (bad ? ', ' + bad + ' failed' : ''), 3200);
    refresh();
  }
  $('#file').addEventListener('change', (e) => { importFiles(e.target.files); e.target.value = ''; });
  const pickFiles = () => $('#file').click();

  /* ================= demo songs (generated tones, so the player works on first open) ================= */
  function synthWav(seed) {
    const sr = 22050, dur = 14, n = sr * dur;
    const pcm = new Int16Array(n);
    const scales = [[0, 3, 5, 7, 10], [0, 2, 4, 7, 9], [0, 2, 3, 7, 8]];
    const sc = scales[seed % 3];
    const base = [220, 196, 246.9][seed % 3];
    const step = [0.35, 0.28, 0.42][seed % 3];
    const noteLen = Math.floor(sr * step * 2.2);
    for (let k = 0; k * step < dur; k++) {
      const f = base * Math.pow(2, (sc[(k * 3 + seed) % 5] + 12 * ((k >> 2) % 2)) / 12);
      const start = Math.floor(k * step * sr);
      for (let i = 0; i < noteLen && start + i < n; i++) {
        const t = i / sr;
        const env = Math.exp(-3.6 * i / noteLen) * Math.min(1, i / 120);
        const v = (Math.sin(2 * Math.PI * f * t) * 0.5 + Math.sin(4 * Math.PI * f * t) * 0.14) * env;
        pcm[start + i] += Math.round(v * 9000);
      }
    }
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      pcm[i] += Math.round(Math.sin(2 * Math.PI * (base / 2) * t) * 1700 * (0.6 + 0.4 * Math.sin(t * 0.9)));
    }
    const buf = new ArrayBuffer(44 + n * 2);
    const dv = new DataView(buf);
    const wr = (o, s) => { for (let i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i)); };
    wr(0, 'RIFF'); dv.setUint32(4, 36 + n * 2, true); wr(8, 'WAVEfmt ');
    dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true);
    dv.setUint32(24, sr, true); dv.setUint32(28, sr * 2, true); dv.setUint16(32, 2, true); dv.setUint16(34, 16, true);
    wr(36, 'data'); dv.setUint32(40, n * 2, true);
    for (let i = 0; i < n; i++) dv.setInt16(44 + i * 2, pcm[i], true);
    return new Blob([buf], { type: 'audio/wav' });
  }
  async function seedDemos() {
    const names = ['Glass Hours', 'Velvet Static', 'Paper Moon'];
    for (let i = 0; i < 3; i++) {
      const id = uid();
      const blob = synthWav(i);
      const meta = { id: id, title: names[i], artist: 'Orbit Demo', album: 'Starter Tones', duration: 14, art: fallbackArt(names[i]), fileName: 'demo-' + i + '.wav', size: blob.size, added: Date.now(), demo: true };
      await DB.put('blobs', { id: id, blob: blob });
      await DB.put('songs', meta);
    }
    cfg.demo = true;
    saveCfg();
    await loadLib();
  }

  /* ================= player ================= */
  const P = { queue: [], base: [], idx: -1, kind: 'local', shuffle: !!cfg.shuffle, repeat: cfg.repeat || 'off', tok: 0, url: null };
  const cur = () => P.queue[P.idx] || null;
  function shuf(arr, first) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); const t = a[i]; a[i] = a[j]; a[j] = t; }
    if (first != null && first >= 0) { const f = arr[first]; const k = a.indexOf(f); if (k > 0) { a.splice(k, 1); a.unshift(f); } }
    return a;
  }
  async function playList(tracks, start, kind, forceShuffle) {
    if (!tracks.length) return;
    P.kind = kind;
    P.base = tracks.slice();
    if (forceShuffle != null) { P.shuffle = forceShuffle; cfg.shuffle = forceShuffle; saveCfg(); }
    if (P.shuffle) { P.queue = shuf(P.base, start); P.idx = 0; } else { P.queue = P.base.slice(); P.idx = start || 0; }
    await load(P.idx, true);
  }
  async function load(i, auto) {
    const t = P.queue[i];
    if (!t) return;
    P.idx = i;
    const my = ++P.tok;
    let src;
    try {
      if (P.kind === 'local') {
        const b = await DB.get('blobs', t.id);
        if (my !== P.tok) return;
        if (!b) throw new Error('That file is missing. Re-import it.');
        if (P.url) URL.revokeObjectURL(P.url);
        P.url = URL.createObjectURL(b.blob);
        src = P.url;
      } else {
        const cands = await scStreamUrls(t);
        if (my !== P.tok) return;
        P.cands = cands; P.ci = 0;
        src = cands[0].u;
      }
    } catch (e) {
      toast(e.message || 'Could not load this track', 3200);
      refresh();
      return;
    }
    audio.src = src;
    refresh();
    updateMS();
    if (auto) {
      try { await audio.play(); } catch (e) { toast('Tap play to start'); }
    }
  }
  function next(natural) {
    if (!P.queue.length) return;
    if (natural && P.repeat === 'one') { audio.currentTime = 0; audio.play().catch(() => {}); return; }
    if (P.idx + 1 < P.queue.length) { load(P.idx + 1, true); return; }
    if (P.repeat === 'all') { if (P.shuffle) P.queue = shuf(P.base); load(0, true); return; }
    if (natural) { audio.pause(); audio.currentTime = 0; } else toast('End of queue');
  }
  function prev() {
    if (!P.queue.length) return;
    if (audio.currentTime > 3 || P.idx === 0) { audio.currentTime = 0; return; }
    load(P.idx - 1, true);
  }
  function toggle() {
    if (!cur()) { toast('Nothing playing yet'); return; }
    if (audio.paused) audio.play().catch(() => toast('Tap play to start')); else audio.pause();
  }
  function seekBy(sec) {
    if (!cur() || !isFinite(audio.duration)) return;
    audio.currentTime = Math.max(0, Math.min(audio.duration, audio.currentTime + sec));
    updateNPTime();
  }
  function setShuffle(v) {
    P.shuffle = v;
    cfg.shuffle = v;
    saveCfg();
    if (P.queue.length) {
      const c = cur();
      P.queue = v ? shuf(P.base, P.base.indexOf(c)) : P.base.slice();
      P.idx = Math.max(0, P.queue.indexOf(c));
    }
    refresh();
  }
  function cycleRepeat() {
    P.repeat = P.repeat === 'off' ? 'all' : P.repeat === 'all' ? 'one' : 'off';
    cfg.repeat = P.repeat;
    saveCfg();
    refresh();
  }
  function playNext(track) {
    if (!P.queue.length) { playList([track], 0, 'local'); return; }
    if (P.kind !== 'local') { toast('SoundCloud and local songs keep separate queues'); return; }
    P.queue.splice(P.idx + 1, 0, track);
    P.base.push(track);
    toast('Plays next');
  }
  audio.addEventListener('play', () => { updateSB(); setPlaybackState('playing'); });
  audio.addEventListener('pause', () => { updateSB(); setPlaybackState('paused'); });
  audio.addEventListener('ended', () => next(true));
  audio.addEventListener('timeupdate', () => { updateNPTime(); });
  audio.addEventListener('durationchange', () => { updateNPTime(); updatePosition(); });
  audio.addEventListener('error', () => {
    const cs = audio.getAttribute('src');
    if (!cs || cs === SILENT) return;
    const t = cur();
    const code = audio.error ? audio.error.code : '?';
    if (P.kind === 'sc' && P.cands && P.ci + 1 < P.cands.length) {
      P.ci++;
      audio.src = P.cands[P.ci].u;
      audio.play().catch(() => {});
      return;
    }
    const used = P.kind === 'sc' && P.cands ? P.cands.map((c) => c.k.replace(/_url$/, '')).join(', ') : '';
    toast(P.kind === 'sc' ? 'SoundCloud won\'t play this one (' + used + ', code ' + code + ')' : 'Can\'t play ' + (t ? t.title : 'this file'), 4200);
  });

  /* iOS only lets a media element play after a tap on that element. Unlock it silently on the first tap so
     later plays (which happen after async storage reads) are allowed. */
  const SILENT = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAESsAABErAAABAAgAZGF0YQAAAAA=';
  let unlocked = false;
  function unlockAudio() {
    if (unlocked) return;
    unlocked = true;
    try {
      if (audio.getAttribute('src')) return;
      audio.muted = true;
      audio.src = SILENT;
      const done = () => { audio.muted = false; if (audio.getAttribute('src') === SILENT) { audio.pause(); audio.removeAttribute('src'); audio.load(); } };
      const pr = audio.play();
      if (pr && pr.then) pr.then(done).catch(() => { audio.muted = false; });
    } catch (e) { audio.muted = false; }
  }
  ['click', 'touchend', 'pointerup', 'keydown'].forEach((ev) => document.addEventListener(ev, unlockAudio, { capture: true, passive: true }));

  /* media session (lock screen / headphones) */
  function setPlaybackState(s) { if ('mediaSession' in navigator) { try { navigator.mediaSession.playbackState = s; } catch (e) { /* ignore */ } } }
  function updatePosition() {
    if (!('mediaSession' in navigator) || !navigator.mediaSession.setPositionState) return;
    try { if (isFinite(audio.duration) && audio.duration > 0) navigator.mediaSession.setPositionState({ duration: audio.duration, playbackRate: audio.playbackRate || 1, position: Math.min(audio.currentTime, audio.duration) }); } catch (e) { /* ignore */ }
  }
  function updateMS() {
    if (!('mediaSession' in navigator)) return;
    const t = cur();
    if (!t) return;
    try {
      navigator.mediaSession.metadata = new MediaMetadata({ title: t.title, artist: t.artist, album: t.album || '', artwork: t.art ? [{ src: t.art, sizes: '256x256' }] : [] });
    } catch (e) { /* ignore */ }
  }
  /* iOS drops handlers registered before audio is playing, so install them again on every 'playing' event.
     seekbackward/seekforward stay null so the lock screen shows previous/next track instead of +/-10s. */
  function installMS() {
    if (!('mediaSession' in navigator)) return;
    const set = (a, fn) => { try { navigator.mediaSession.setActionHandler(a, fn); } catch (e) { /* unsupported */ } };
    set('play', () => audio.play().catch(() => {}));
    set('pause', () => audio.pause());
    set('previoustrack', () => prev());
    set('nexttrack', () => next(false));
    set('seekto', (d) => { if (d && d.seekTime != null) audio.currentTime = d.seekTime; });
    set('seekbackward', null);
    set('seekforward', null);
  }
  installMS();
  audio.addEventListener('playing', installMS);
  setInterval(() => { if (!audio.paused) updatePosition(); }, 4000);

  /* ================= screens ================= */
  const stack = [];
  const top = () => stack[stack.length - 1];
  const push = (sc) => { stack.push(sc); render(); };
  function pop() { if (stack.length > 1) { stack.pop(); render(); } }
  const listScreen = (title, build, opts) => Object.assign({ kind: 'list', title: title, build: build, index: 0, scroll: 0 }, opts || {});

  function updateSB() {
    $('#sbPlay').textContent = cur() ? (audio.paused ? '❚❚' : '▶') : '';
    const sc = top();
    $('#sbTitle').textContent = sc ? sc.title : 'Orbit';
  }
  function refresh() { if (stack.length) render(true); }

  function render(keep) {
    const sc = top();
    if (!sc) return;
    $('#sbTitle').textContent = sc.title;
    if (sc.kind === 'list') {
      const prevScroll = keep && view.firstChild && view.firstChild.classList && view.firstChild.classList.contains('list') ? view.firstChild.scrollTop : null;
      sc.items = sc.build();
      if (sc.index >= sc.items.length) sc.index = Math.max(0, sc.items.length - 1);
      drawList(sc, prevScroll);
    } else if (sc.kind === 'np') drawNP();
    else if (sc.kind === 'html') { view.textContent = ''; sc.mount(view); }
    updateSB();
  }
  function drawList(sc, prevScroll) {
    const list = document.createElement('div');
    list.className = 'list';
    const noteHtml = sc.noteFn ? sc.noteFn() : sc.note;
    if (noteHtml) { const n = document.createElement('div'); n.className = 'note'; n.innerHTML = noteHtml; list.appendChild(n); }
    if (!sc.items.length) {
      const e = document.createElement('div');
      e.className = 'empty';
      e.textContent = sc.empty || 'Nothing here yet.';
      list.appendChild(e);
    }
    const frag = document.createDocumentFragment();
    sc.items.forEach((it, i) => {
      const r = document.createElement('div');
      r.className = 'row' + (i === sc.index ? ' sel' : '') + (it.dim ? ' dim' : '');
      r.dataset.i = i;
      r.innerHTML = '<span class="lbl">' + esc(it.t) + '</span>' + (it.dl ? '<span class="dl" title="Uploader allows downloads">↓</span>' : '') + (it.s ? '<span class="sub">' + esc(it.s) + '</span>' : '') + (it.go ? '<span class="chev">›</span>' : '');
      frag.appendChild(r);
    });
    list.appendChild(frag);
    view.textContent = '';
    view.appendChild(list);
    const sel = list.querySelector('.row.sel');
    if (prevScroll != null) list.scrollTop = prevScroll;
    else if (sel) list.scrollTop = Math.max(0, sel.offsetTop - list.clientHeight / 2 + sel.offsetHeight / 2);
    if (sel && prevScroll != null) ensureVisible(list, sel);
  }
  function ensureVisible(list, el) {
    const t = el.offsetTop, b = t + el.offsetHeight;
    if (t < list.scrollTop) list.scrollTop = t;
    else if (b > list.scrollTop + list.clientHeight) list.scrollTop = b - list.clientHeight;
  }
  function selectIdx(i) {
    const sc = top();
    const list = view.querySelector('.list');
    if (!list) return;
    const old = list.querySelector('.row.sel');
    if (old) old.classList.remove('sel');
    sc.index = i;
    const el = list.querySelector('.row[data-i="' + i + '"]');
    if (el) { el.classList.add('sel'); ensureVisible(list, el); }
  }
  function activate(i) {
    const sc = top();
    if (sc.kind !== 'list') return;
    const it = sc.items[i];
    if (it && it.on) it.on(i);
  }

  /* row taps and long-presses (delegated) */
  (function rowEvents() {
    let timer = 0, fired = false, sx = 0, sy = 0;
    view.addEventListener('pointerdown', (e) => {
      const row = e.target.closest('.row');
      fired = false;
      if (!row) return;
      sx = e.clientX; sy = e.clientY;
      const i = +row.dataset.i;
      const it = top().items && top().items[i];
      clearTimeout(timer);
      if (it && it.long) timer = setTimeout(() => { fired = true; selectIdx(i); it.long(i); }, 520);
    });
    const cancel = () => clearTimeout(timer);
    view.addEventListener('pointermove', (e) => { if (Math.hypot(e.clientX - sx, e.clientY - sy) > 8) cancel(); });
    view.addEventListener('pointerup', cancel);
    view.addEventListener('pointercancel', cancel);
    view.addEventListener('click', (e) => {
      if (fired) { fired = false; return; }
      if (e.target.closest('a')) return;
      const row = e.target.closest('.row');
      if (!row) return;
      const i = +row.dataset.i;
      selectIdx(i);
      activate(i);
    });
  })();

  /* ---- Now Playing ---- */
  function openNP() { if (top().kind === 'np') return; push({ kind: 'np', title: 'Now Playing' }); }
  function drawNP() {
    const t = cur();
    if (!t) { view.innerHTML = '<div class="empty">Nothing playing yet. Pick a song from Music.</div>'; return; }
    const sc = P.kind === 'sc';
    view.innerHTML =
      '<div class="np">' +
      '<div class="np-top"><div class="np-art" style="background-image:url(\'' + esc(t.art || '') + '\')"></div>' +
      '<div class="np-meta"><div class="np-title">' + esc(t.title) + '</div><div class="np-artist">' + esc(t.artist) + '</div>' +
      (sc ? '<div class="np-src">via <a href="' + esc(t.link || 'https://soundcloud.com') + '" target="_blank" rel="noopener noreferrer">SoundCloud</a></div>' : '<div class="np-album">' + esc(t.album || '') + '</div>') +
      '</div></div>' +
      '<div class="np-pos"><div class="bar" id="npBar"><i id="npFill"></i></div><div class="times"><span id="npCur">0:00</span><span id="npRem">-0:00</span></div></div>' +
      '<div></div>' +
      '<div class="np-modes"><button class="chip' + (P.shuffle ? ' on' : '') + '" id="chipShuf" type="button">Shuffle</button>' +
      '<button class="chip' + (P.repeat !== 'off' ? ' on' : '') + '" id="chipRep" type="button">Repeat ' + (P.repeat === 'one' ? '1' : P.repeat === 'all' ? 'All' : 'Off') + '</button>' +
      '<button class="chip" id="chipQ" type="button">Up Next</button></div></div>';
    $('#chipShuf').onclick = () => setShuffle(!P.shuffle);
    $('#chipRep').onclick = cycleRepeat;
    $('#chipQ').onclick = openQueue;
    const bar = $('#npBar');
    const seek = (e) => {
      const r = bar.getBoundingClientRect();
      if (isFinite(audio.duration)) audio.currentTime = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * audio.duration;
      updateNPTime();
    };
    bar.addEventListener('pointerdown', (e) => { bar.setPointerCapture(e.pointerId); seek(e); const mv = (ev) => seek(ev); const up = () => { bar.removeEventListener('pointermove', mv); bar.removeEventListener('pointerup', up); }; bar.addEventListener('pointermove', mv); bar.addEventListener('pointerup', up); });
    updateNPTime();
  }
  function updateNPTime() {
    const f = $('#npFill');
    if (!f) return;
    const d = audio.duration, c = audio.currentTime || 0;
    f.style.width = (isFinite(d) && d > 0 ? Math.min(100, (c / d) * 100) : 0) + '%';
    $('#npCur').textContent = fmt(c);
    $('#npRem').textContent = '-' + fmt(isFinite(d) ? d - c : (cur() && cur().duration) || 0);
  }
  function openQueue() {
    push(listScreen('Up Next', () => {
      const out = [];
      for (let i = P.idx + 1; i < Math.min(P.queue.length, P.idx + 301); i++) {
        const t = P.queue[i];
        out.push({ t: t.title, s: t.artist, on: () => { load(i, true); stack.pop(); render(); } });
      }
      return out;
    }, { empty: 'Nothing queued after this song.' }));
  }

  /* ---- Music screens ---- */
  function songItems(songs, title) {
    return songs.map((s, i) => ({
      t: s.title, s: s.artist,
      on: () => { playList(songs, i, 'local'); openNP(); },
      long: () => push(songOptions(s, title))
    }));
  }
  function songsScreen(title, getSongs, extra) {
    return listScreen(title, () => {
      const songs = getSongs();
      return (extra ? extra(songs) : []).concat(songItems(songs, title));
    }, { empty: 'No songs yet. Choose Import Songs, then pick files from the Files app.' });
  }
  function rootScreen() {
    return listScreen('Orbit', () => {
      const out = [];
      if (cur()) out.push({ t: 'Now Playing', go: 1, on: openNP });
      out.push({ t: 'Shuffle Songs', on: () => { if (!lib.songs.length) { toast('Import songs first'); return; } playList(lib.songs, null, 'local', true); openNP(); } });
      out.push({ t: 'SoundCloud', go: 1, on: () => push(scRoot()) });
      out.push({ t: 'Import Songs', on: pickFiles });
      out.push({ t: 'Themes', go: 1, on: () => push(themesScreen()) });
      out.push({ t: 'Settings', go: 1, on: () => push(settingsScreen()) });
      return out;
    });
  }
  function musicScreen() {
    return listScreen('Music', () => [
      { t: 'Songs', s: String(lib.songs.length), go: 1, on: () => push(songsScreen('Songs', () => lib.songs)) },
      { t: 'Artists', go: 1, on: () => push(groupScreen('Artists', 'artist')) },
      { t: 'Albums', go: 1, on: () => push(groupScreen('Albums', 'album')) },
      { t: 'Playlists', s: String(lib.playlists.length), go: 1, on: () => push(playlistsScreen()) },
      { t: 'Import Songs', on: pickFiles }
    ]);
  }
  function groupScreen(title, key) {
    return listScreen(title, () => {
      const m = new Map();
      lib.songs.forEach((s) => { const k = s[key] || 'Unknown'; if (!m.has(k)) m.set(k, []); m.get(k).push(s); });
      return Array.from(m.keys()).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' })).map((k) => ({
        t: k, s: String(m.get(k).length), go: 1,
        on: () => push(songsScreen(k, () => lib.songs.filter((s) => (s[key] || 'Unknown') === k), (songs) => songs.length ? [{ t: 'Shuffle', on: () => { playList(songs, null, 'local', true); openNP(); } }] : []))
      }));
    }, { empty: 'No songs yet.' });
  }
  function playlistsScreen() {
    return listScreen('Playlists', () => [{
      t: 'New Playlist…', on: async () => {
        const n = await askText('Playlist name', '');
        if (!n) return;
        const p = { id: uid(), name: n, songIds: [] };
        await DB.put('playlists', p);
        lib.playlists.push(p);
        refresh();
      }
    }].concat(lib.playlists.map((p) => ({ t: p.name, s: String(p.songIds.length), go: 1, on: () => push(playlistScreen(p.id)) }))));
  }
  function playlistScreen(pid) {
    const get = () => lib.playlists.find((p) => p.id === pid);
    return listScreen((get() || {}).name || 'Playlist', () => {
      const p = get();
      if (!p) return [];
      const songs = p.songIds.map((id) => lib.byId.get(id)).filter(Boolean);
      const out = [];
      if (songs.length) out.push({ t: 'Shuffle', on: () => { playList(songs, null, 'local', true); openNP(); } });
      songs.forEach((s, i) => out.push({ t: s.title, s: s.artist, on: () => { playList(songs, i, 'local'); openNP(); }, long: () => push(songOptions(s, p.name, p)) }));
      out.push({ t: 'Rename Playlist…', dim: 1, on: async () => { const n = await askText('Playlist name', p.name); if (!n) return; p.name = n; await DB.put('playlists', p); top().title = n; refresh(); } });
      out.push({ t: 'Delete Playlist', dim: 1, on: () => push(confirmScreen('Delete "' + p.name + '"?', 'Delete Playlist', async () => { await DB.del('playlists', p.id); lib.playlists = lib.playlists.filter((x) => x.id !== p.id); stack.pop(); stack.pop(); render(); toast('Playlist deleted'); })) });
      return out;
    }, { empty: 'Empty playlist.' });
  }
  function confirmScreen(question, label, fn) {
    return listScreen('Are you sure?', () => [
      { t: question, dim: 1 },
      { t: label, on: () => fn() },
      { t: 'Cancel', on: () => pop() }
    ]);
  }
  function songOptions(song, ctxTitle, playlist) {
    return listScreen('Options', () => {
      const out = [
        { t: 'Play Next', on: () => { playNext(song); pop(); } },
        { t: 'Add to Playlist…', go: 1, on: () => push(addToPlaylistScreen(song)) },
        { t: 'Edit Info…', on: async () => {
          const ti = await askText('Title', song.title); if (!ti) return;
          const ar = await askText('Artist', song.artist); if (!ar) return;
          song.title = ti; song.artist = ar;
          await DB.put('songs', song);
          lib.songs.sort(cmpSong);
          stack.pop(); render();
        } }
      ];
      if (playlist) out.push({ t: 'Remove from Playlist', on: async () => { playlist.songIds = playlist.songIds.filter((x) => x !== song.id); await DB.put('playlists', playlist); pop(); } });
      out.push({ t: 'Remove from Library', dim: 1, on: () => push(confirmScreen('Delete "' + song.title + '" from this device?', 'Delete Song', async () => {
        await DB.del('songs', song.id); await DB.del('blobs', song.id);
        lib.songs = lib.songs.filter((s) => s.id !== song.id); lib.byId.delete(song.id);
        for (const p of lib.playlists) if (p.songIds.includes(song.id)) { p.songIds = p.songIds.filter((x) => x !== song.id); await DB.put('playlists', p); }
        stack.pop(); stack.pop(); render(); toast('Song removed');
      })) });
      return out;
    });
  }
  function addToPlaylistScreen(song) {
    return listScreen('Add to Playlist', () => [{
      t: 'New Playlist…', on: async () => {
        const n = await askText('Playlist name', ''); if (!n) return;
        const p = { id: uid(), name: n, songIds: [song.id] };
        await DB.put('playlists', p); lib.playlists.push(p);
        stack.pop(); stack.pop(); render(); toast('Added to ' + n);
      }
    }].concat(lib.playlists.map((p) => ({
      t: p.name, s: p.songIds.includes(song.id) ? 'added' : '', on: async () => {
        if (!p.songIds.includes(song.id)) { p.songIds.push(song.id); await DB.put('playlists', p); }
        stack.pop(); stack.pop(); render(); toast('Added to ' + p.name);
      }
    }))));
  }

  /* ---- Themes & settings ---- */
  function themesScreen() {
    return listScreen('Themes', () => THEMES.map((t) => ({
      t: t.name, s: cfg.theme === t.id ? '✓' : '', on: () => { applyTheme(t.id); refresh(); }
    })).concat([
      { t: 'Stickers…', dim: 0, on: () => { setEditing(true); toast('Tap a sticker below to add it'); } },
      { t: 'Clear stickers on this look', dim: 1, on: () => { stk[cfg.theme] = []; saveStk(); renderStickers(); toast('Stickers cleared'); } }
    ]), { index: Math.max(0, THEMES.findIndex((t) => t.id === cfg.theme)) });
  }
  function settingsScreen() {
    return listScreen('Settings', () => [
      { t: 'Wheel click sound', s: cfg.click ? 'On' : 'Off', on: () => { cfg.click = !cfg.click; saveCfg(); refresh(); } },
      { t: 'Storage used', s: storageText, on: updateStorage },
      { t: 'Remove demo songs', on: async () => {
        const demos = lib.songs.filter((s) => s.demo);
        for (const s of demos) { await DB.del('songs', s.id); await DB.del('blobs', s.id); }
        await loadLib(); toast(demos.length ? 'Demo songs removed' : 'No demo songs');
      } },
      { t: 'Clear whole library', dim: 1, on: () => push(confirmScreen('Delete every song and playlist on this device?', 'Delete Everything', async () => {
        await DB.clear('songs'); await DB.clear('blobs'); await DB.clear('playlists'); await loadLib();
        audio.pause(); audio.removeAttribute('src'); P.queue = []; P.base = []; P.idx = -1;
        stack.length = 1; render(); toast('Library cleared');
      })) },
      { t: 'About', go: 1, on: () => push(aboutScreen()) }
    ]);
  }
  let storageText = '';
  async function updateStorage() {
    try {
      const e = await navigator.storage.estimate();
      storageText = (e.usage / 1048576).toFixed(0) + ' MB';
    } catch (err) { storageText = 'n/a'; }
    if (top().title === 'Settings') refresh();
  }
  function aboutScreen() {
    return { kind: 'html', title: 'About', mount(el) {
      el.innerHTML = '<div class="form"><div class="note"><b>Orbit Player 1.0</b><br>A personal music player with a click wheel. Your imported songs stay on this device and play offline.<br><br>Original artwork. Not affiliated with, or endorsed by, Apple, Shufl FM or SoundCloud.</div></div>';
    } };
  }

  /* ================= click wheel ================= */
  const wheel = $('#wheel');
  let audioCtx = null;
  function tick() {
    if (!cfg.click) return;
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      const o = audioCtx.createOscillator(), g = audioCtx.createGain();
      o.frequency.value = 1900; g.gain.value = 0.05;
      g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 0.02);
      o.connect(g); g.connect(audioCtx.destination);
      o.start(); o.stop(audioCtx.currentTime + 0.02);
    } catch (e) { /* ignore */ }
  }
  let lastStep = 0;
  function step(dir) {
    const sc = top();
    if (sc.kind === 'list') {
      const n = sc.items.length;
      if (!n) return;
      const now = performance.now();
      const mult = (n > 40 && now - lastStep < 45) ? 4 : 1;
      lastStep = now;
      const i = Math.max(0, Math.min(n - 1, sc.index + dir * mult));
      if (i !== sc.index) { selectIdx(i); tick(); }
    } else if (sc.kind === 'np') seekBy(dir * 5);
    else { const el = view.querySelector('.form,.log'); if (el) el.scrollTop += dir * view.clientHeight * 0.25; }
  }
  function press() {
    const sc = top();
    if (sc.kind === 'list') activate(sc.index);
    else if (sc.kind === 'np') openQueue();
  }
  const ZONES = { menu: $('#labMenu'), prev: $('#labPrev'), next: $('#labNext'), play: $('#labPlay'), center: $('#center') };
  function zoneOf(p) {
    if (p.d < 0.36) return 'center';
    if (p.a > -135 && p.a <= -45) return 'menu';
    if (p.a > -45 && p.a <= 45) return 'next';
    if (p.a > 45 && p.a <= 135) return 'play';
    return 'prev';
  }
  function hot(z, on) { if (ZONES[z]) ZONES[z].classList.toggle('hot', on); }
  function polar(e) {
    const r = wheel.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    return { a: Math.atan2(e.clientY - cy, e.clientX - cx) * 180 / Math.PI, d: Math.hypot(e.clientX - cx, e.clientY - cy) / (r.width / 2) };
  }
  const W = { on: false, id: null, last: 0, acc: 0, total: 0, sd: 0, zone: '', x: 0, y: 0 };
  const STEP = 18;
  wheel.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    try { wheel.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    const p = polar(e);
    W.on = true; W.id = e.pointerId; W.last = p.a; W.acc = 0; W.total = 0; W.sd = p.d; W.x = e.clientX; W.y = e.clientY;
    W.zone = zoneOf(p);
    hot(W.zone, true);
  });
  wheel.addEventListener('pointermove', (e) => {
    if (!W.on || e.pointerId !== W.id) return;
    const p = polar(e);
    let d = p.a - W.last;
    if (d > 180) d -= 360;
    if (d < -180) d += 360;
    W.last = p.a;
    if (W.sd < 0.36) return;
    W.acc += d; W.total += Math.abs(d);
    while (W.acc >= STEP) { W.acc -= STEP; step(1); }
    while (W.acc <= -STEP) { W.acc += STEP; step(-1); }
  });
  function wheelEnd(e, cancelled) {
    if (!W.on || e.pointerId !== W.id) return;
    W.on = false;
    hot(W.zone, false);
    if (cancelled) return;
    if (W.total < 12 && Math.hypot(e.clientX - W.x, e.clientY - W.y) < 16) {
      tick();
      if (W.zone === 'center') press();
      else if (W.zone === 'menu') pop();
      else if (W.zone === 'next') next(false);
      else if (W.zone === 'prev') prev();
      else if (W.zone === 'play') toggle();
    }
  }
  wheel.addEventListener('pointerup', (e) => wheelEnd(e, false));
  wheel.addEventListener('pointercancel', (e) => wheelEnd(e, true));
  document.addEventListener('keydown', (e) => {
    if (/^(INPUT|TEXTAREA)$/.test((e.target || {}).tagName || '')) return;
    if (e.key === 'ArrowDown') { step(1); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { step(-1); e.preventDefault(); }
    else if (e.key === 'Enter') press();
    else if (e.key === 'Escape' || e.key === 'Backspace') pop();
    else if (e.key === ' ') { toggle(); e.preventDefault(); }
    else if (e.key === 'ArrowRight') next(false);
    else if (e.key === 'ArrowLeft') prev();
  });

  /* ================= SoundCloud (official API, streaming only) ================= */
  const SC = { api: 'https://api.soundcloud.com', auth: 'https://secure.soundcloud.com/authorize', token: 'https://secure.soundcloud.com/oauth/token' };
  const sc = { likes: null, loading: false, q: '', fresh: [], seen: new Set(ls.get('orbit.sc.seen', [])) };
  const scCred = () => ls.get('orbit.sc.cred', null);
  const scTok = () => ls.get('orbit.sc.tok', null);
  const redirectUri = () => location.origin + location.pathname.replace(/index\.html$/, '');
  const blockedHost = () => /claude/i.test(location.hostname);

  async function scTokenRequest(params) {
    const c = scCred();
    if (!c || !c.id || !c.secret) throw new Error('Add your Client ID and Secret first');
    const body = new URLSearchParams(Object.assign({ client_id: c.id, client_secret: c.secret, redirect_uri: redirectUri() }, params));
    const r = await fetch(SC.token, { method: 'POST', headers: { Accept: 'application/json; charset=utf-8', 'Content-Type': 'application/x-www-form-urlencoded' }, body: body });
    if (!r.ok) { const t = await r.text().catch(() => ''); throw new Error('Sign-in failed (' + r.status + ') ' + t.slice(0, 100)); }
    const j = await r.json();
    ls.set('orbit.sc.tok', { access: j.access_token, refresh: j.refresh_token || (scTok() || {}).refresh, exp: Date.now() + (j.expires_in || 3600) * 1000 });
  }
  async function scAccess() {
    let t = scTok();
    if (!t) throw new Error('Not signed in to SoundCloud');
    if (t.exp - Date.now() < 60000) {
      if (!t.refresh) throw new Error('Session expired. Sign in again.');
      await scTokenRequest({ grant_type: 'refresh_token', refresh_token: t.refresh });
      t = scTok();
    }
    return t.access;
  }
  async function scApi(path, params, retry) {
    const tok = await scAccess();
    const url = /^https?:/.test(path) ? path : SC.api + path + (params ? '?' + new URLSearchParams(params) : '');
    let r;
    try { r = await fetch(url, { headers: { Authorization: 'OAuth ' + tok, Accept: 'application/json; charset=utf-8' } }); }
    catch (e) { throw new Error(blockedHost() ? 'This preview can\'t reach SoundCloud. Use your own hosted copy.' : 'Couldn\'t reach SoundCloud (offline, or blocked).'); }
    if (r.status === 401 && retry !== false) {
      const t = scTok();
      if (t && t.refresh) { await scTokenRequest({ grant_type: 'refresh_token', refresh_token: t.refresh }); return scApi(path, params, false); }
    }
    if (!r.ok) { const t = await r.text().catch(() => ''); throw new Error('SoundCloud ' + r.status + (t ? ': ' + t.slice(0, 100) : '')); }
    return r.json();
  }
  async function scSignIn() {
    const c = scCred();
    if (!c || !c.id || !c.secret) { toast('Save your Client ID and Secret first'); return; }
    if (!(window.crypto && crypto.subtle)) { toast('Sign-in needs a secure (https) page'); return; }
    const v = b64u(crypto.getRandomValues(new Uint8Array(48)));
    const ch = b64u(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(v))));
    const st = b64u(crypto.getRandomValues(new Uint8Array(16)));
    ls.set('orbit.sc.pkce', { v: v, st: st });
    const u = new URL(SC.auth);
    u.search = new URLSearchParams({ client_id: c.id, redirect_uri: redirectUri(), response_type: 'code', code_challenge: ch, code_challenge_method: 'S256', state: st, display: 'popup' }).toString();
    location.href = u.toString();
  }
  async function scHandleReturn() {
    const q = new URLSearchParams(location.search);
    if (!q.get('code') && !q.get('error')) return false;
    const p = ls.get('orbit.sc.pkce', null);
    history.replaceState(null, '', location.pathname);
    if (q.get('error')) { toast('SoundCloud: ' + q.get('error'), 3500); return false; }
    if (!p || p.st !== q.get('state')) { toast('Sign-in check failed. Try again.', 3500); return false; }
    ls.del('orbit.sc.pkce');
    try { await scTokenRequest({ grant_type: 'authorization_code', code: q.get('code'), code_verifier: p.v }); toast('Signed in to SoundCloud'); return true; }
    catch (e) { toast(e.message, 4000); return false; }
  }
  const normTrack = (t) => ({
    id: t.urn || ('soundcloud:tracks:' + t.id),
    title: t.title || 'Untitled',
    artist: t.metadata_artist || (t.user && t.user.username) || 'Unknown',
    album: '',
    duration: (t.duration || 0) / 1000,
    art: ((t.artwork_url || (t.user && t.user.avatar_url) || '') + '').replace('-large', '-t500x500'),
    link: t.permalink_url || '',
    dl: !!t.downloadable,
    access: t.access
  });
  async function scLoadLikes() {
    if (sc.loading) return;
    sc.loading = true;
    try {
      let all = [], path = '/me/likes/tracks', params = { limit: 200, linked_partitioning: 'true', access: 'playable' };
      for (let guard = 0; guard < 60; guard++) {
        const j = await scApi(path, params);
        const col = Array.isArray(j) ? j : (j.collection || []);
        all = all.concat(col.filter((t) => t.access !== 'blocked').map(normTrack));
        toast('Loading likes… ' + all.length, 30000);
        if (!j.next_href) break;
        path = j.next_href; params = null;
      }
      sc.likes = all;
      if (!sc.seen.size) { sc.seen = new Set(all.map((t) => t.id)); ls.set('orbit.sc.seen', Array.from(sc.seen)); sc.fresh = []; }
      else sc.fresh = all.filter((t) => !sc.seen.has(t.id));
      toast('Loaded ' + all.length + ' likes' + (sc.fresh.length ? ', ' + sc.fresh.length + ' new' : ''), 2800);
    } catch (e) { toast(e.message, 4200); }
    finally { sc.loading = false; refresh(); }
  }
  const SC_KEYS = ['hls_aac_160_url', 'hls_aac_96_url', 'hls_mp3_128_url', 'hls_opus_64_url', 'http_mp3_128_url'];
  async function scResolve(u) {
    if (!/^https:\/\/api\.soundcloud\.com\//.test(u)) return u;
    const tok = await scAccess();
    const ac = new AbortController();
    const r = await fetch(u, { headers: { Authorization: 'OAuth ' + tok }, signal: ac.signal });
    const fin = r.url;
    ac.abort();
    if (!r.ok) throw new Error('stream ' + r.status);
    return fin || u;
  }
  async function scStreamUrls(t) {
    const j = await scApi('/tracks/' + t.id + '/streams');
    const raw = SC_KEYS.filter((k) => j[k]).map((k) => ({ k: k, u: j[k] }));
    if (!raw.length) throw new Error(j.preview_mp3_128_url ? 'SoundCloud only allows a 30s preview of this one' : 'SoundCloud has no stream for this track');
    const res = await Promise.all(raw.map(async (c) => { try { return { k: c.k, u: await scResolve(c.u) }; } catch (e) { return null; } }));
    const good = res.filter((c, n) => c && c.u !== raw[n].u);
    return good.length ? good : raw;
  }
  function openLink(url) { if (!url) return; const a = document.createElement('a'); a.href = url; a.target = '_blank'; a.rel = 'noopener noreferrer'; document.body.appendChild(a); a.click(); a.remove(); }
  function scTrackItems(tracks) {
    return tracks.map((t, i) => ({
      t: t.title, s: t.artist, dl: t.dl,
      on: () => { playList(tracks, i, 'sc'); openNP(); },
      long: () => push(listScreen('Options', () => [
        { t: 'Open on SoundCloud', on: () => openLink(t.link) },
        { t: t.dl ? 'Uploader allows downloads' : 'Streaming only', dim: 1 }
      ]))
    }));
  }
  function scRoot() {
    return listScreen('SoundCloud', () => {
      const c = scCred(), tok = scTok(), out = [];
      if (!c || !c.id || !c.secret) {
        out.push({ t: 'Set up SoundCloud', go: 1, on: () => push(scSetup()) });
      } else if (!tok) {
        out.push({ t: 'Sign in with SoundCloud', on: scSignIn });
        out.push({ t: 'Edit credentials', go: 1, dim: 1, on: () => push(scSetup()) });
      } else {
        out.push({ t: 'Search', go: 1, on: () => push(scSearchScreen()) });
        out.push({ t: 'Likes', s: sc.likes ? String(sc.likes.length) : 'tap to load', go: 1, on: async () => { if (!sc.likes) await scLoadLikes(); if (sc.likes) push(listScreen('Likes', () => scTrackItems(sc.likes), { empty: 'No streamable likes found.' })); } });
        out.push({ t: 'Shuffle Likes', on: async () => { if (!sc.likes) await scLoadLikes(); if (sc.likes && sc.likes.length) { playList(sc.likes, null, 'sc', true); openNP(); } } });
        out.push({ t: 'New since last sync', s: sc.likes ? String(sc.fresh.length) : '', go: 1, on: async () => { if (!sc.likes) await scLoadLikes(); if (sc.likes) push(scNewScreen()); } });
        out.push({ t: 'Downloadable likes', s: sc.likes ? String(sc.likes.filter((x) => x.dl).length) : '', go: 1, on: async () => { if (!sc.likes) await scLoadLikes(); if (sc.likes) push(listScreen('Downloadable', () => sc.likes.filter((x) => x.dl).map((t) => ({ t: t.title, s: t.artist, dl: true, on: () => openLink(t.link) })), { note: 'Tap a track to open its SoundCloud page and use the uploader\'s download button. Then import the file with Import Songs.', empty: 'None of your likes offer downloads.' })); } });
        out.push({ t: 'Refresh likes', on: () => scLoadLikes() });
        out.push({ t: 'Test connection', go: 1, dim: 1, on: () => push(scTest()) });
        out.push({ t: 'Sign out and delete data', dim: 1, on: () => push(confirmScreen('Remove your SoundCloud login and saved like IDs from this device?', 'Sign Out', () => { ls.del('orbit.sc.tok'); ls.del('orbit.sc.seen'); sc.likes = null; sc.fresh = []; sc.seen = new Set(); if (P.kind === 'sc') { audio.pause(); audio.removeAttribute('src'); P.queue = []; P.base = []; P.idx = -1; } stack.pop(); render(); toast('Signed out. Data deleted.'); })) });
      }
      return out;
    }, { noteFn: () => blockedHost() ? '<b>Preview mode.</b> Claude\'s preview blocks outside connections, so SoundCloud only works from your own hosted copy of this app.' : '' });
  }
  function scSearchScreen() {
    return { kind: 'html', title: 'Search', mount(el) {
      el.innerHTML = '<div class="form"><label for="scQ">Search your liked songs</label>' +
        '<input id="scQ" type="text" inputmode="search" enterkeyhint="search" autocomplete="off" autocapitalize="off" spellcheck="false" value="' + esc(sc.q || '') + '">' +
        '<div class="btnrow"><button class="btn" id="scGo" type="button">Search</button></div></div>';
      const go = () => {
        const q = $('#scQ').value.trim();
        if (!q) { toast('Type something to search'); return; }
        sc.q = q;
        push(scResultsScreen(q));
      };
      $('#scGo').onclick = go;
      $('#scQ').addEventListener('input', () => { sc.q = $('#scQ').value; });
      $('#scQ').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); go(); } });
      setTimeout(() => { try { $('#scQ').focus(); } catch (e) { /* ignore */ } }, 80);
    } };
  }
  function scResultsScreen(q) {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    const scr = listScreen('Results', () => {
      if (!sc.likes) return [{ t: sc.loading ? 'Loading your likes...' : 'Could not load your likes', dim: 1 }];
      const hit = sc.likes.filter((t) => { const hay = (t.title + ' ' + t.artist).toLowerCase(); return words.every((w) => hay.indexOf(w) >= 0); }).slice(0, 200);
      return scTrackItems(hit);
    }, { empty: 'No liked songs match.', note: 'Liked songs matching "' + esc(q) + '".' });
    if (!sc.likes && !sc.loading) scLoadLikes();
    return scr;
  }
  function scNewScreen() {
    return listScreen('New Likes', () => sc.fresh.length ? scTrackItems(sc.fresh).concat([{ t: 'Mark all as seen', dim: 1, on: () => { sc.seen = new Set(sc.likes.map((x) => x.id)); ls.set('orbit.sc.seen', Array.from(sc.seen)); sc.fresh = []; toast('Marked as seen'); pop(); } }]) : [], { empty: 'No new likes since your last sync.' });
  }
  function scSetup() {
    return { kind: 'html', title: 'SoundCloud Setup', mount(el) {
      const c = scCred() || {};
      el.innerHTML = '<div class="form">' +
        '<div class="note">Register an app in SoundCloud\'s developer portal, then paste its credentials here. They stay on this device.</div>' +
        '<label for="scId">Client ID</label><input id="scId" autocomplete="off" autocapitalize="off" spellcheck="false" value="' + esc(c.id || '') + '">' +
        '<label for="scSecret">Client Secret</label><input id="scSecret" type="password" autocomplete="off" value="' + esc(c.secret || '') + '">' +
        '<label>Redirect URI to register</label><code>' + esc(redirectUri()) + '</code>' +
        '<div class="btnrow"><button class="btn" id="scSave" type="button">Save</button></div></div>';
      $('#scSave').onclick = () => {
        const id = $('#scId').value.trim(), secret = $('#scSecret').value.trim();
        if (!id || !secret) { toast('Both fields are required'); return; }
        ls.set('orbit.sc.cred', { id: id, secret: secret });
        toast('Saved');
        stack.pop(); render();
      };
    } };
  }
  function scTest() {
    return { kind: 'html', title: 'Test Connection', mount(el) {
      el.innerHTML = '<div class="log" id="scLog"></div>';
      const log = $('#scLog');
      const line = (txt, cls) => { const d = document.createElement('div'); if (cls) d.className = cls; d.textContent = txt; log.appendChild(d); log.scrollTop = log.scrollHeight; };
      const hostOf = (x) => (x.split('/')[2] || x.slice(0, 24)).replace('.soundcloud.cloud', '.sc.cloud');
      const probe = (u) => new Promise((resolve) => {
        const a = new Audio(); a.preload = 'metadata';
        const done = (r) => { a.onloadedmetadata = null; a.onerror = null; a.removeAttribute('src'); resolve(r); };
        a.onloadedmetadata = () => done('ok ' + Math.round(a.duration) + 's');
        a.onerror = () => done('err' + (a.error ? a.error.code : '?'));
        setTimeout(() => done('timeout'), 6000);
        a.src = u;
      });
      const detail = async (u, tok) => {
        const ac = new AbortController();
        try {
          const r = await fetch(u, { headers: { Authorization: 'OAuth ' + tok }, signal: ac.signal });
          const fin = r.url, ct = (r.headers.get('content-type') || '').split(';')[0];
          let body = '';
          if (/mpegurl|text|json/.test(ct)) body = (await r.text()).slice(0, 500);
          ac.abort();
          return { st: r.status, fin: fin, same: fin === u, ct: ct, body: body };
        } catch (e) { return { err: e.message || 'failed' }; }
      };
      (async () => {
        line('v4 ' + location.pathname);
        const t = scTok();
        line(t ? 'Token ok, ' + Math.round((t.exp - Date.now()) / 60000) + ' min left' : 'No token', t ? 'ok' : 'bad');
        try {
          const tok = await scAccess();
          let tr = sc.likes;
          if (!tr || !tr.length) {
            const j = await scApi('/me/likes/tracks', { limit: 8, linked_partitioning: 'true', access: 'playable' });
            tr = (Array.isArray(j) ? j : (j.collection || [])).map(normTrack);
          }
          const idx = Array.from(new Set([0, 2].filter((i) => i < tr.length)));
          for (const i of idx) {
            const x = tr[i];
            line('#' + (i + 1) + ' ' + x.title.slice(0, 26));
            try {
              const s = await scApi('/tracks/' + x.id + '/streams');
              for (const k of SC_KEYS.filter((q) => s[q])) {
                line(' ' + k.replace(/_url$/, ''));
                const d = await detail(s[k], tok);
                if (d.err) { line('  fetch: ' + d.err, 'bad'); continue; }
                line('  auth ' + d.st + (d.same ? ' same-url' : ' > ' + hostOf(d.fin)) + ' ' + d.ct, d.st === 200 ? 'ok' : 'bad');
                if (d.same && d.body) {
                  const segs = d.body.split('\n').filter((l) => l && l[0] !== '#');
                  line('  body ' + d.body.replace(/\s+/g, ' ').slice(0, 80));
                  if (segs[0]) line('  seg ' + hostOf(segs[0]) + ' ..' + segs[0].split('?')[0].slice(-24));
                }
                if (!d.same) { const au = await probe(d.fin); line('  audio ' + au, /^ok/.test(au) ? 'ok' : 'bad'); }
              }
            } catch (e) { line('  ' + e.message, 'bad'); }
          }
          line('Counting all likes...');
          try {
            const c = { playable: 0, preview: 0, blocked: 0, other: 0 };
            let path = '/me/likes/tracks', params = { limit: 200, linked_partitioning: 'true', access: 'playable,preview,blocked' };
            for (let g = 0; g < 30; g++) {
              const j = await scApi(path, params);
              const col = Array.isArray(j) ? j : (j.collection || []);
              col.forEach((x) => { c[x.access in c ? x.access : 'other']++; });
              if (!j.next_href) break;
              path = j.next_href; params = null;
            }
            line('Tracks: ' + c.playable + ' full, ' + c.preview + ' preview, ' + c.blocked + ' blocked' + (c.other ? ', ' + c.other + ' other' : ''), 'ok');
          } catch (e) { line('Count: ' + e.message, 'bad'); }
          try {
            let n = 0, path = '/me/likes/playlists', params = { limit: 200, linked_partitioning: 'true' };
            for (let g = 0; g < 10; g++) {
              const j = await scApi(path, params);
              const col = Array.isArray(j) ? j : (j.collection || []);
              n += col.length;
              if (!j.next_href) break;
              path = j.next_href; params = null;
            }
            line('Liked playlists/albums: ' + n, 'ok');
          } catch (e) { line('Playlists: ' + e.message, 'bad'); }
          line('Done.');
        } catch (e) { line(e.message, 'bad'); }
      })();
    } };
  }

  /* ================= boot ================= */
  (async function boot() {
    document.documentElement.style.setProperty('--glit-a', glitterURI(11));
    document.documentElement.style.setProperty('--glit-b', glitterURI(97));
    try { db = await openDB(); } catch (e) { db = null; }
    applyTheme(cfg.theme);
    await loadLib();
    if (!cfg.demo && !lib.songs.length) await seedDemos();
    stack.push(rootScreen());
    render();
    updateStorage();
    try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch (e) { /* ignore */ }
    if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol) && !blockedHost()) navigator.serviceWorker.register('sw.js').catch(() => {});
    if (await scHandleReturn()) { push(scRoot()); }
    window.__orbit = { lib: lib, P: P, stack: stack, audio: audio, cfg: cfg };
  })();
})();
