/* Orbit tag readers: ID3v2 (mp3), MP4/M4A atoms, FLAC Vorbis comments, WAV INFO.
   Pure functions on Uint8Array so they run in the browser and in Node tests. */
(function (root) {
  'use strict';

  const td8 = new TextDecoder('utf-8');

  function latin1(bytes) {
    let s = '';
    for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return s;
  }

  function decodeText(bytes, enc) {
    if (enc === 0) return latin1(bytes);
    if (enc === 3) return td8.decode(bytes);
    if (enc === 2) return new TextDecoder('utf-16be').decode(bytes);
    if (enc === 1) {
      if (bytes.length >= 2) {
        if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes.subarray(2));
        if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes.subarray(2));
      }
      return new TextDecoder('utf-16le').decode(bytes);
    }
    return td8.decode(bytes);
  }

  function clean(s) {
    return s.replace(/^﻿/, '').split('\u0000')[0].trim();
  }

  function syncsafe(b, o) {
    return ((b[o] & 0x7f) << 21) | ((b[o + 1] & 0x7f) << 14) | ((b[o + 2] & 0x7f) << 7) | (b[o + 3] & 0x7f);
  }
  function u32(b, o) {
    return ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
  }

  /* ---------- ID3v2 ---------- */
  function parseAPIC(d, v22) {
    const enc = d[0];
    let p = 1;
    let mime;
    if (v22) {
      mime = 'image/' + latin1(d.subarray(1, 4)).toLowerCase().replace('jpg', 'jpeg');
      p = 4;
    } else {
      let e = p;
      while (e < d.length && d[e] !== 0) e++;
      mime = latin1(d.subarray(p, e));
      p = e + 1;
    }
    p++; // picture type
    if (enc === 1 || enc === 2) {
      while (p + 1 < d.length && !(d[p] === 0 && d[p + 1] === 0)) p += 2;
      p += 2;
    } else {
      while (p < d.length && d[p] !== 0) p++;
      p++;
    }
    if (p >= d.length) return null;
    if (!mime || mime.indexOf('/') < 0) mime = 'image/jpeg';
    return { mime: mime, data: d.slice(p) };
  }

  function parseID3(u8) {
    if (u8.length < 10 || u8[0] !== 0x49 || u8[1] !== 0x44 || u8[2] !== 0x33) return null;
    const ver = u8[3];
    const flags = u8[5];
    const size = syncsafe(u8, 6);
    let pos = 10;
    const end = Math.min(u8.length, 10 + size);
    if (flags & 0x40 && ver >= 3) {
      pos += ver === 4 ? syncsafe(u8, pos) : u32(u8, pos) + 4;
    }
    const tags = {};
    const idLen = ver === 2 ? 3 : 4;
    const hdr = ver === 2 ? 6 : 10;
    const map = {
      TIT2: 'title', TT2: 'title', TPE1: 'artist', TP1: 'artist',
      TALB: 'album', TAL: 'album', TPE2: 'albumArtist', TP2: 'albumArtist'
    };
    while (pos + hdr <= end) {
      const id = latin1(u8.subarray(pos, pos + idLen));
      if (!/^[A-Z0-9]+$/.test(id)) break;
      let fsize;
      if (ver === 2) fsize = (u8[pos + 3] << 16) | (u8[pos + 4] << 8) | u8[pos + 5];
      else if (ver === 4) fsize = syncsafe(u8, pos + 4);
      else fsize = u32(u8, pos + 4);
      const ds = pos + hdr;
      const de = ds + fsize;
      if (fsize <= 0 || de > end) break;
      const data = u8.subarray(ds, de);
      if (map[id]) {
        const v = clean(decodeText(data.subarray(1), data[0]));
        if (v && !tags[map[id]]) tags[map[id]] = v;
      } else if ((id === 'APIC' || id === 'PIC') && !tags.picture) {
        const pic = parseAPIC(data, ver === 2);
        if (pic) tags.picture = pic;
      }
      pos = de;
    }
    return tags;
  }

  /* ---------- MP4 / M4A ---------- */
  function parseMP4(u8) {
    const tags = {};
    function item(type, bs, be) {
      let p = bs;
      while (p + 16 <= be) {
        const size = u32(u8, p);
        const t = latin1(u8.subarray(p + 4, p + 8));
        if (size < 8) break;
        if (t === 'data') {
          const flags = u32(u8, p + 8) & 0xffffff;
          const payload = u8.subarray(p + 16, Math.min(p + size, be));
          if (type === '©nam') tags.title = td8.decode(payload).trim();
          else if (type === '©ART') tags.artist = td8.decode(payload).trim();
          else if (type === '©alb') tags.album = td8.decode(payload).trim();
          else if (type === 'aART') tags.albumArtist = td8.decode(payload).trim();
          else if (type === 'covr' && !tags.picture) {
            tags.picture = { mime: flags === 14 ? 'image/png' : 'image/jpeg', data: payload.slice() };
          }
          return;
        }
        p += size;
      }
    }
    function walk(start, end, inIlst) {
      let p = start;
      while (p + 8 <= end) {
        let size = u32(u8, p);
        const type = latin1(u8.subarray(p + 4, p + 8));
        let h = 8;
        if (size === 1) {
          if (p + 16 > end) break;
          size = u32(u8, p + 8) * 4294967296 + u32(u8, p + 12);
          h = 16;
        } else if (size === 0) size = end - p;
        if (size < h) break;
        if (p + size > end) size = end - p;
        const bs = p + h;
        const be = p + size;
        if (inIlst) item(type, bs, be);
        else if (type === 'moov' || type === 'udta') walk(bs, be, false);
        else if (type === 'meta') walk(bs + 4, be, false);
        else if (type === 'ilst') walk(bs, be, true);
        p += size;
      }
    }
    walk(0, u8.length, false);
    return tags;
  }

  /* ---------- FLAC ---------- */
  function parseFLAC(u8) {
    if (!(u8[0] === 0x66 && u8[1] === 0x4c && u8[2] === 0x61 && u8[3] === 0x43)) return null;
    const tags = {};
    let p = 4;
    while (p + 4 <= u8.length) {
      const hdr = u8[p];
      const last = hdr & 0x80;
      const type = hdr & 0x7f;
      const len = (u8[p + 1] << 16) | (u8[p + 2] << 8) | u8[p + 3];
      p += 4;
      if (p + len > u8.length) break;
      const dv = new DataView(u8.buffer, u8.byteOffset + p, len);
      if (type === 4) {
        let o = 0;
        const vlen = dv.getUint32(o, true);
        o += 4 + vlen;
        const n = dv.getUint32(o, true);
        o += 4;
        for (let i = 0; i < n && o + 4 <= len; i++) {
          const l = dv.getUint32(o, true);
          o += 4;
          const s = td8.decode(u8.subarray(p + o, p + o + l));
          o += l;
          const eq = s.indexOf('=');
          if (eq > 0) {
            const k = s.slice(0, eq).toUpperCase();
            const v = s.slice(eq + 1).trim();
            if (k === 'TITLE') tags.title = v;
            else if (k === 'ARTIST') tags.artist = v;
            else if (k === 'ALBUM') tags.album = v;
            else if (k === 'ALBUMARTIST') tags.albumArtist = v;
          }
        }
      } else if (type === 6 && !tags.picture) {
        let o = 4;
        const ml = dv.getUint32(o);
        o += 4;
        const mime = td8.decode(u8.subarray(p + o, p + o + ml));
        o += ml;
        const dl = dv.getUint32(o);
        o += 4 + dl + 16;
        const pl = dv.getUint32(o);
        o += 4;
        tags.picture = { mime: mime || 'image/jpeg', data: u8.slice(p + o, p + o + pl) };
      }
      p += len;
      if (last) break;
    }
    return tags;
  }

  /* ---------- WAV (LIST/INFO) ---------- */
  function parseWAV(u8) {
    if (latin1(u8.subarray(0, 4)) !== 'RIFF' || latin1(u8.subarray(8, 12)) !== 'WAVE') return null;
    const tags = {};
    let p = 12;
    while (p + 8 <= u8.length) {
      const id = latin1(u8.subarray(p, p + 4));
      const size = (u8[p + 4]) | (u8[p + 5] << 8) | (u8[p + 6] << 16) | (u8[p + 7] << 24);
      const ds = p + 8;
      if (id === 'LIST' && latin1(u8.subarray(ds, ds + 4)) === 'INFO') {
        let q = ds + 4;
        const qe = Math.min(ds + size, u8.length);
        while (q + 8 <= qe) {
          const sid = latin1(u8.subarray(q, q + 4));
          const ssz = (u8[q + 4]) | (u8[q + 5] << 8) | (u8[q + 6] << 16) | (u8[q + 7] << 24);
          const v = clean(td8.decode(u8.subarray(q + 8, q + 8 + ssz)));
          if (sid === 'INAM') tags.title = v;
          else if (sid === 'IART') tags.artist = v;
          else if (sid === 'IPRD') tags.album = v;
          q += 8 + ssz + (ssz & 1);
        }
      }
      if (size < 0) break;
      p = ds + size + (size & 1);
    }
    return tags;
  }

  function guessFromName(name) {
    const base = name.replace(/\.[^.]+$/, '').replace(/_/g, ' ').trim();
    const m = base.match(/^(.+?)\s+-\s+(.+)$/);
    if (m) return { artist: m[1].trim(), title: m[2].trim() };
    return { title: base };
  }

  /* Sniff by magic bytes first, then by extension. */
  function parseTags(u8, name) {
    let t = null;
    try {
      if (u8[0] === 0x49 && u8[1] === 0x44 && u8[2] === 0x33) t = parseID3(u8);
      else if (u8[0] === 0x66 && u8[1] === 0x4c && u8[2] === 0x61 && u8[3] === 0x43) t = parseFLAC(u8);
      else if (latin1(u8.subarray(4, 8)) === 'ftyp' || latin1(u8.subarray(4, 8)) === 'moov') t = parseMP4(u8);
      else if (latin1(u8.subarray(0, 4)) === 'RIFF') t = parseWAV(u8);
    } catch (e) { t = null; }
    t = t || {};
    const g = guessFromName(name || '');
    return {
      title: t.title || g.title || 'Untitled',
      artist: t.artist || t.albumArtist || g.artist || 'Unknown Artist',
      album: t.album || 'Unknown Album',
      picture: t.picture || null
    };
  }

  const api = { parseTags: parseTags, parseID3: parseID3, parseMP4: parseMP4, parseFLAC: parseFLAC, parseWAV: parseWAV, guessFromName: guessFromName };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.OrbitTags = api;
})(typeof self !== 'undefined' ? self : this);
