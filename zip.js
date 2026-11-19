/* Escritor y lector de archivos .zip sin dependencias (sin compresión: las fotos y videos ya vienen comprimidos).
   Admite archivos grandes (ZIP64) y se usa tanto en la app web como en la de Android. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CronoZip = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var TABLE = (function () {
    var t = new Uint32Array(256);
    for (var n = 0; n < 256; n++) {
      var c = n;
      for (var k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      t[n] = c >>> 0;
    }
    return t;
  })();

  /* CRC-32 encadenable: crc32(b, crc32(a)) equivale a crc32(a + b). */
  function crc32(u8, prev) {
    var c = ~(prev || 0);
    for (var i = 0; i < u8.length; i++) c = TABLE[(c ^ u8[i]) & 255] ^ (c >>> 8);
    return (~c) >>> 0;
  }

  var enc = new TextEncoder();
  var dec = new TextDecoder('utf-8');
  var CHUNK = 4 * 1024 * 1024;
  var MAX32 = 0xFFFFFFFF;

  function dosTime(d) { return ((d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1)) & 0xFFFF; }
  function dosDate(d) { return (((Math.max(1980, d.getFullYear()) - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()) & 0xFFFF; }
  function setU64(v, off, n) { v.setUint32(off, n % 4294967296, true); v.setUint32(off + 4, Math.floor(n / 4294967296), true); }
  function getU64(v, off) { return v.getUint32(off, true) + v.getUint32(off + 4, true) * 4294967296; }
  function isBlob(x) { return typeof Blob !== 'undefined' && x instanceof Blob; }
  async function sliceBytes(blob, a, b) { return new Uint8Array(await blob.slice(a, b).arrayBuffer()); }

  /* ---------- escritura ---------- */
  /* sink: objeto con write(Uint8Array) asincrónico. opts.zip64At: umbral de ZIP64 (solo para pruebas). */
  function Writer(sink, opts) {
    this.sink = sink;
    this.pos = 0;
    this.entries = [];
    this.limit = (opts && opts.zip64At) || MAX32;
  }
  Writer.prototype._w = async function (u8) { await this.sink.write(u8); this.pos += u8.length; };

  /* data: Uint8Array o Blob */
  Writer.prototype.addFile = async function (name, data, date) {
    var blob = isBlob(data), size = blob ? data.size : data.length, o, crc = 0;
    if (size >= MAX32) throw new Error('Un archivo es demasiado grande para el respaldo.');
    if (blob) {
      for (o = 0; o < size; o += CHUNK) crc = crc32(await sliceBytes(data, o, Math.min(size, o + CHUNK)), crc);
    } else crc = crc32(data, 0);
    var nameB = enc.encode(name), d = date || new Date(), offset = this.pos;
    var h = new Uint8Array(30 + nameB.length), v = new DataView(h.buffer);
    v.setUint32(0, 0x04034b50, true); v.setUint16(4, 20, true); v.setUint16(6, 0x0800, true); v.setUint16(8, 0, true);
    v.setUint16(10, dosTime(d), true); v.setUint16(12, dosDate(d), true); v.setUint32(14, crc, true);
    v.setUint32(18, size, true); v.setUint32(22, size, true); v.setUint16(26, nameB.length, true); v.setUint16(28, 0, true);
    h.set(nameB, 30);
    await this._w(h);
    if (blob) {
      for (o = 0; o < size; o += CHUNK) await this._w(await sliceBytes(data, o, Math.min(size, o + CHUNK)));
    } else if (size) await this._w(data);
    this.entries.push({ nameB: nameB, crc: crc, size: size, offset: offset, time: dosTime(d), date: dosDate(d) });
  };

  Writer.prototype.finish = async function () {
    var cdStart = this.pos, n = this.entries.length, limit = this.limit, i, e;
    for (i = 0; i < n; i++) {
      e = this.entries[i];
      var z64 = e.offset >= limit, extra = z64 ? 12 : 0;
      var c = new Uint8Array(46 + e.nameB.length + extra), v = new DataView(c.buffer);
      v.setUint32(0, 0x02014b50, true); v.setUint16(4, 45, true); v.setUint16(6, z64 ? 45 : 20, true);
      v.setUint16(8, 0x0800, true); v.setUint16(10, 0, true); v.setUint16(12, e.time, true); v.setUint16(14, e.date, true);
      v.setUint32(16, e.crc, true); v.setUint32(20, e.size, true); v.setUint32(24, e.size, true);
      v.setUint16(28, e.nameB.length, true); v.setUint16(30, extra, true); v.setUint16(32, 0, true);
      v.setUint16(34, 0, true); v.setUint16(36, 0, true); v.setUint32(38, 0, true);
      v.setUint32(42, z64 ? MAX32 : e.offset, true);
      c.set(e.nameB, 46);
      if (z64) {
        var p = 46 + e.nameB.length;
        v.setUint16(p, 1, true); v.setUint16(p + 2, 8, true); setU64(v, p + 4, e.offset);
      }
      await this._w(c);
    }
    var cdSize = this.pos - cdStart;
    var need64 = cdStart >= limit || n >= 0xFFFF || cdSize >= limit;
    if (need64) {
      var eocd64Pos = this.pos;
      var z = new Uint8Array(56 + 20), zv = new DataView(z.buffer);
      zv.setUint32(0, 0x06064b50, true); setU64(zv, 4, 44); zv.setUint16(12, 45, true); zv.setUint16(14, 45, true);
      zv.setUint32(16, 0, true); zv.setUint32(20, 0, true); setU64(zv, 24, n); setU64(zv, 32, n); setU64(zv, 40, cdSize); setU64(zv, 48, cdStart);
      zv.setUint32(56, 0x07064b50, true); zv.setUint32(60, 0, true); setU64(zv, 64, eocd64Pos); zv.setUint32(72, 1, true);
      await this._w(z);
    }
    var t = new Uint8Array(22), tv = new DataView(t.buffer);
    tv.setUint32(0, 0x06054b50, true); tv.setUint16(4, 0, true); tv.setUint16(6, 0, true);
    tv.setUint16(8, need64 ? 0xFFFF : n, true); tv.setUint16(10, need64 ? 0xFFFF : n, true);
    tv.setUint32(12, need64 ? MAX32 : cdSize, true); tv.setUint32(16, need64 ? MAX32 : cdStart, true); tv.setUint16(20, 0, true);
    await this._w(t);
    return this.pos;
  };

  /* ---------- lectura ---------- */
  /* blob: Blob o File. Devuelve [{name, size, getBlob(type), getText()}]. */
  async function readZip(blob) {
    var total = blob.size;
    if (total < 22) throw new Error('El archivo no es un respaldo válido.');
    var tailLen = Math.min(total, 65557), tailStart = total - tailLen;
    var tail = await sliceBytes(blob, tailStart, total), tv = new DataView(tail.buffer);
    var p = -1, i;
    for (i = tail.length - 22; i >= 0; i--) { if (tv.getUint32(i, true) === 0x06054b50) { p = i; break; } }
    if (p < 0) throw new Error('El archivo no es un respaldo válido.');
    var count = tv.getUint16(p + 10, true), cdSize = tv.getUint32(p + 12, true), cdOff = tv.getUint32(p + 16, true);
    if (count === 0xFFFF || cdSize === MAX32 || cdOff === MAX32) {
      var locPos = tailStart + p - 20;
      var loc = await sliceBytes(blob, locPos, locPos + 20), lv = new DataView(loc.buffer);
      if (lv.getUint32(0, true) !== 0x07064b50) throw new Error('El respaldo está dañado.');
      var z64pos = getU64(lv, 8);
      var z = await sliceBytes(blob, z64pos, z64pos + 56), zv = new DataView(z.buffer);
      if (zv.getUint32(0, true) !== 0x06064b50) throw new Error('El respaldo está dañado.');
      count = getU64(zv, 32); cdSize = getU64(zv, 40); cdOff = getU64(zv, 48);
    }
    var cd = await sliceBytes(blob, cdOff, cdOff + cdSize), cv = new DataView(cd.buffer);
    var out = [], q = 0;
    for (i = 0; i < count; i++) {
      if (cv.getUint32(q, true) !== 0x02014b50) throw new Error('El respaldo está dañado.');
      var method = cv.getUint16(q + 10, true);
      var csize = cv.getUint32(q + 20, true), usize = cv.getUint32(q + 24, true);
      var nl = cv.getUint16(q + 28, true), el = cv.getUint16(q + 30, true), cl = cv.getUint16(q + 32, true);
      var loff = cv.getUint32(q + 42, true);
      var name = dec.decode(cd.subarray(q + 46, q + 46 + nl));
      var ep = q + 46 + nl, eend = ep + el;
      while (ep + 4 <= eend) {
        var hid = cv.getUint16(ep, true), hs = cv.getUint16(ep + 2, true), dp = ep + 4;
        if (hid === 1) {
          if (usize === MAX32) { usize = getU64(cv, dp); dp += 8; }
          if (csize === MAX32) { csize = getU64(cv, dp); dp += 8; }
          if (loff === MAX32) { loff = getU64(cv, dp); dp += 8; }
        }
        ep += 4 + hs;
      }
      out.push(makeEntry(blob, name, method, csize, usize, loff));
      q += 46 + nl + el + cl;
    }
    return out;
  }

  function makeEntry(blob, name, method, csize, usize, loff) {
    var cache = null;
    async function dataStart() {
      var lh = await sliceBytes(blob, loff, loff + 30), lv = new DataView(lh.buffer);
      if (lv.getUint32(0, true) !== 0x04034b50) throw new Error('El respaldo está dañado.');
      return loff + 30 + lv.getUint16(26, true) + lv.getUint16(28, true);
    }
    return {
      name: name,
      size: usize,
      getBlob: async function (type) {
        if (cache) return cache;
        var s = await dataStart(), raw = blob.slice(s, s + csize, type || '');
        if (method === 0) { cache = raw; return raw; }
        if (method === 8 && typeof DecompressionStream !== 'undefined') {
          var r = new Response(raw.stream().pipeThrough(new DecompressionStream('deflate-raw')));
          return new Blob([await r.arrayBuffer()], { type: type || '' });
        }
        throw new Error('El respaldo usa una compresión que no se puede leer.');
      },
      getText: async function () { return dec.decode(new Uint8Array(await (await this.getBlob()).arrayBuffer())); }
    };
  }

  return { crc32: crc32, Writer: Writer, readZip: readZip };
});
