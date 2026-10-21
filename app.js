(function () {
  'use strict';
  var MONTHS = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
  var MAXP = 6, BUCKET = 'fotos', URL_TTL = 3600;
  function $(id) { return document.getElementById(id); }
  function h(tag, cls, txt) { var e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; }
  function uuid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) { var r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3 | 8)).toString(16); });
  }

  var cfg = window.CRONO_CONFIG || {};
  var sb = null, uid = null;
  var notes = [], loading = true, urls = {};
  var editingId = null, pending = [], removedIds = [], saving = false, confirmId = null;
  var order = 'asc', query = '';
  try { var so = localStorage.getItem('cronologia-orden'); if (so === 'asc' || so === 'desc') order = so; } catch (e) {}

  function showView(name) {
    ['setup', 'login', 'app'].forEach(function (v) { $('view-' + v).hidden = v !== name; });
  }
  function tpath(p) { return uid + '/' + p.id + '_t.jpg'; }
  function fpath(p) { return uid + '/' + p.id + '.jpg'; }
  function cached(path) { var c = urls[path]; return c && c.exp > Date.now() ? c.url : ''; }

  /* ---------- fechas ---------- */
  function sortKey(n) { return n.year * 10000 + (n.month || 0) * 100 + (n.day || 0); }
  function fmtDate(n) {
    if (n.day && n.month) return n.day + ' de ' + MONTHS[n.month - 1] + ' de ' + n.year;
    if (n.month) return MONTHS[n.month - 1] + ' de ' + n.year;
    return String(n.year);
  }
  function span(v, s, p) { return v === 1 ? '1 ' + s : v + ' ' + p; }
  function ago(n) {
    var now = new Date(), cy = now.getFullYear(), cm = now.getMonth() + 1, cd = now.getDate();
    if (n.day && n.month) {
      var days = Math.round((Date.UTC(cy, cm - 1, cd) - Date.UTC(n.year, n.month - 1, n.day)) / 864e5);
      if (days === 0) return 'hoy';
      if (days === 1) return 'ayer';
      if (days === -1) return 'mañana';
      if (Math.abs(days) < 30) return days > 0 ? 'hace ' + span(days, 'día', 'días') : 'dentro de ' + span(-days, 'día', 'días');
    }
    var m = n.month ? (cy * 12 + cm) - (n.year * 12 + n.month) : (cy - n.year) * 12;
    if (m === 0) return n.month ? 'este mes' : 'este año';
    var abs = Math.abs(m);
    var txt = abs < 12 ? span(abs, 'mes', 'meses') : span(Math.floor(abs / 12), 'año', 'años');
    return m > 0 ? 'hace ' + txt : 'dentro de ' + txt;
  }

  /* ---------- sesión ---------- */
  function setSession(s) {
    var newId = s && s.user ? s.user.id : null;
    if (newId === uid) return;
    uid = newId;
    notes = []; urls = {}; resetForm(); confirmId = null;
    if (!uid) { showView('login'); render(); return; }
    $('who').textContent = s.user.email || '';
    showView('app');
    loadNotes();
  }
  function banner(msg) { var b = $('banner'); b.textContent = msg || ''; b.hidden = !msg; }

  async function loadNotes() {
    loading = true; banner(''); render();
    try {
      var all = [], from = 0;
      for (;;) {
        var r = await sb.from('notes').select('*').range(from, from + 999);
        if (r.error) throw r.error;
        all = all.concat(r.data);
        if (r.data.length < 1000) break;
        from += 1000;
      }
      notes = all.map(normalize);
      loading = false; render(); refreshThumbs();
    } catch (e) {
      loading = false; render();
      banner('No se pudieron leer las notas. Revisá la conexión y recargá la página.');
    }
  }
  function normalize(r) {
    return { id: r.id, title: r.title, text: r.body || '', year: r.year, month: r.month || 0, day: r.day || 0,
      photos: Array.isArray(r.photos) ? r.photos : [], createdAt: Date.parse(r.created_at) || 0 };
  }

  /* ---------- fotos ---------- */
  async function signPaths(paths) {
    var need = paths.filter(function (p) { return !cached(p); });
    for (var i = 0; i < need.length; i += 100) {
      var r = await sb.storage.from(BUCKET).createSignedUrls(need.slice(i, i + 100), URL_TTL);
      if (r.error) throw r.error;
      (r.data || []).forEach(function (it) {
        if (it.signedUrl && it.path) urls[it.path] = { url: it.signedUrl, exp: Date.now() + (URL_TTL - 600) * 1000 };
      });
    }
  }
  function refreshThumbs() {
    if (!uid) return Promise.resolve();
    var paths = [];
    notes.forEach(function (n) { n.photos.forEach(function (p) { paths.push(tpath(p)); }); });
    if (!paths.length) return Promise.resolve();
    var me = uid;
    return signPaths(paths).then(function () { if (me === uid) render(); }).catch(function () {});
  }
  function loadImage(file) {
    return new Promise(function (res, rej) {
      var url = URL.createObjectURL(file), img = new Image();
      img.onload = function () { res({ img: img, url: url }); };
      img.onerror = function () { URL.revokeObjectURL(url); rej(new Error('imagen')); };
      img.src = url;
    });
  }
  function canvasBlob(img, max, q) {
    var s = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    var w = Math.max(1, Math.round(img.naturalWidth * s)), hh = Math.max(1, Math.round(img.naturalHeight * s));
    var c = document.createElement('canvas'); c.width = w; c.height = hh;
    var x = c.getContext('2d'); x.fillStyle = '#ffffff'; x.fillRect(0, 0, w, hh); x.drawImage(img, 0, 0, w, hh);
    return new Promise(function (res, rej) { c.toBlob(function (b) { b ? res(b) : rej(new Error('blob')); }, 'image/jpeg', q); });
  }
  async function processFile(file) {
    var r = await loadImage(file);
    try {
      var full = await canvasBlob(r.img, 1600, 0.8);
      var thumb = await canvasBlob(r.img, 240, 0.7);
      return { full: full, thumb: thumb };
    } finally { URL.revokeObjectURL(r.url); }
  }
  function addFiles(files) {
    var imgs = Array.prototype.filter.call(files, function (f) { return f && f.type && f.type.indexOf('image/') === 0; });
    if (!imgs.length) return;
    var chain = Promise.resolve();
    imgs.forEach(function (f) {
      chain = chain.then(function () {
        if (pending.length >= MAXP) { setStatus('Cada nota admite hasta ' + MAXP + ' fotos.', 'err'); return; }
        return processFile(f).then(function (r) {
          pending.push({ id: uuid(), isNew: true, full: r.full, thumb: r.thumb, preview: URL.createObjectURL(r.thumb) });
          renderStrip(); setStatus('', '');
        }).catch(function () { setStatus('No se pudo leer una de las imágenes.', 'err'); });
      });
    });
  }
  function dropPreview(p) { if (p.isNew && p.preview) URL.revokeObjectURL(p.preview); }
  function renderStrip() {
    var s = $('strip'); s.textContent = '';
    pending.forEach(function (p, i) {
      var box = h('div', 'pimg');
      if (p.preview) { var img = h('img'); img.src = p.preview; img.alt = 'Foto ' + (i + 1) + ' de la nota'; box.append(img); }
      var x = h('button', null, '×'); x.type = 'button'; x.setAttribute('aria-label', 'Quitar foto ' + (i + 1));
      x.addEventListener('click', function () {
        if (!p.isNew) removedIds.push(p.id);
        dropPreview(p);
        pending = pending.filter(function (q) { return q !== p; }); renderStrip();
      });
      box.append(x); s.append(box);
    });
  }

  /* ---------- formulario ---------- */
  function setStatus(msg, kind) { var s = $('status'); s.textContent = msg; s.className = 'status' + (kind ? ' ' + kind : ''); }
  function setYearDefault() { $('f-year').value = new Date().getFullYear(); }
  function resetForm() {
    pending.forEach(dropPreview);
    editingId = null; pending = []; removedIds = [];
    $('note-form').reset(); setYearDefault(); renderStrip();
    $('form-title').textContent = 'Nueva nota'; $('f-save').textContent = 'Guardar nota'; $('f-cancel').hidden = true;
  }
  function startEdit(n) {
    resetForm();
    editingId = n.id; confirmId = null;
    pending = n.photos.map(function (p) { return { id: p.id, isNew: false, preview: cached(tpath(p)) }; });
    $('f-title').value = n.title; $('f-text').value = n.text || '';
    $('f-day').value = n.day || ''; $('f-month').value = n.month || ''; $('f-year').value = n.year;
    renderStrip(); setStatus('', '');
    $('form-title').textContent = 'Editando nota'; $('f-save').textContent = 'Guardar cambios'; $('f-cancel').hidden = false;
    render();
    $('note-form').scrollIntoView({ behavior: 'smooth', block: 'start' });
    $('f-title').focus({ preventScroll: true });
  }
  async function onSubmit(e) {
    e.preventDefault();
    if (saving || !uid) return;
    var title = $('f-title').value.trim(), text = $('f-text').value.trim();
    var year = parseInt($('f-year').value, 10), month = parseInt($('f-month').value, 10) || 0, day = parseInt($('f-day').value, 10) || 0;
    if (!title) { setStatus('Escribí qué pasó en una línea.', 'err'); $('f-title').focus(); return; }
    if (!(year >= 1000 && year <= 2200)) { setStatus('Ingresá un año válido, por ejemplo 2019.', 'err'); $('f-year').focus(); return; }
    if (day && !month) { setStatus('Si ponés el día, elegí también el mes.', 'err'); $('f-month').focus(); return; }
    if (day) {
      var dt = new Date(0); dt.setUTCFullYear(year, month - 1, day);
      if (dt.getUTCMonth() !== month - 1 || dt.getUTCDate() !== day) { setStatus('Esa fecha no existe. Revisá el día y el mes.', 'err'); $('f-day').focus(); return; }
    }
    saving = true; $('f-save').disabled = true; setStatus('Guardando…', '');
    var me = uid, bucket = sb.storage.from(BUCKET);
    try {
      for (var i = 0; i < pending.length; i++) {
        var p = pending[i];
        if (!p.isNew) continue;
        var u1 = await bucket.upload(fpath(p), p.full, { contentType: 'image/jpeg', upsert: true });
        if (u1.error) throw u1.error;
        var u2 = await bucket.upload(tpath(p), p.thumb, { contentType: 'image/jpeg', upsert: true });
        if (u2.error) throw u2.error;
        p.isNew = false;
      }
      var row = { title: title, body: text, year: year, month: month, day: day, photos: pending.map(function (p) { return { id: p.id }; }) };
      var res;
      if (editingId) res = await sb.from('notes').update(row).eq('id', editingId).select().single();
      else res = await sb.from('notes').insert(Object.assign({ id: uuid(), user_id: me }, row)).select().single();
      if (res.error) throw res.error;
      var saved = normalize(res.data);
      if (me !== uid) return;
      notes = notes.filter(function (n) { return n.id !== saved.id; }); notes.push(saved);
      var rm = [];
      removedIds.forEach(function (id) { rm.push(me + '/' + id + '.jpg', me + '/' + id + '_t.jpg'); });
      if (rm.length) bucket.remove(rm).catch(function () {});
      removedIds = [];
      resetForm(); setStatus('Nota guardada.', 'ok'); render(); refreshThumbs();
    } catch (err) {
      var msg = err && err.message ? String(err.message) : '';
      setStatus(/exceeded|too large|payload|size/i.test(msg) ? 'Una foto es demasiado grande o no hay más espacio.' : 'No se pudo guardar. Revisá la conexión y probá de nuevo.', 'err');
    } finally { saving = false; $('f-save').disabled = false; }
  }

  /* ---------- línea de tiempo ---------- */
  function entryEl(n) {
    var a = h('article', 'entry');
    var head = h('div', 'e-head');
    var when = h('div', 'when', fmtDate(n)); when.append(h('span', 'ago', ago(n)));
    var acts = h('div', 'acts');
    if (confirmId === n.id) {
      acts.append(h('span', null, '¿Borrar esta nota?'));
      var yes = h('button', 'linkbtn del', 'Sí, borrar'); yes.type = 'button';
      yes.addEventListener('click', function () { removeNote(n); });
      var no = h('button', 'linkbtn', 'Cancelar'); no.type = 'button';
      no.addEventListener('click', function () { confirmId = null; render(); });
      acts.append(yes, no);
    } else {
      var ed = h('button', 'linkbtn', 'Editar'); ed.type = 'button';
      ed.addEventListener('click', function () { startEdit(n); });
      var del = h('button', 'linkbtn del', 'Borrar'); del.type = 'button';
      del.addEventListener('click', function () { confirmId = n.id; render(); });
      acts.append(ed, del);
    }
    head.append(when, acts);
    a.append(head, h('h3', 'e-title', n.title));
    if (n.text) a.append(h('p', 'e-text', n.text));
    if (n.photos.length) {
      var th = h('div', 'thumbs');
      n.photos.forEach(function (p, i) {
        var b = h('button', 'thumb'); b.type = 'button'; b.setAttribute('aria-label', 'Ampliar foto ' + (i + 1) + ' de ' + n.photos.length);
        var u = cached(tpath(p));
        if (u) { var img = h('img'); img.src = u; img.alt = ''; img.loading = 'lazy'; b.append(img); }
        b.addEventListener('click', function () { openLb(n, i, b); });
        th.append(b);
      });
      a.append(th);
    }
    return a;
  }
  async function removeNote(n) {
    confirmId = null;
    try {
      var r = await sb.from('notes').delete().eq('id', n.id);
      if (r.error) throw r.error;
      var paths = [];
      n.photos.forEach(function (p) { paths.push(fpath(p), tpath(p)); });
      if (paths.length) sb.storage.from(BUCKET).remove(paths).catch(function () {});
      if (editingId === n.id) resetForm();
      notes = notes.filter(function (x) { return x.id !== n.id; });
    } catch (e) { setStatus('No se pudo borrar la nota.', 'err'); }
    render();
  }
  function render() {
    var root = $('timeline'); root.textContent = '';
    $('o-asc').setAttribute('aria-pressed', String(order === 'asc'));
    $('o-desc').setAttribute('aria-pressed', String(order === 'desc'));
    if (!uid) return;
    if (loading) { $('count').textContent = ''; root.append(h('p', 'state', 'Cargando tus notas…')); return; }
    var q = query.trim().toLowerCase();
    var list = notes.filter(function (n) { return !q || ((n.title || '') + ' ' + (n.text || '')).toLowerCase().indexOf(q) !== -1; });
    var dir = order === 'asc' ? 1 : -1;
    list.sort(function (a, b) { return (sortKey(a) - sortKey(b)) * dir || (a.createdAt - b.createdAt) * dir; });
    $('count').textContent = notes.length ? (q ? list.length + ' de ' + notes.length : span(notes.length, 'nota', 'notas')) : '';
    if (!notes.length) {
      var st = h('div', 'state'); st.append(h('strong', null, 'Todavía no hay notas'));
      st.append(document.createTextNode('Cargá la primera arriba. Podés agregar los hechos en cualquier orden: la página los acomoda por la fecha en que ocurrieron.'));
      root.append(st); return;
    }
    if (!list.length) { root.append(h('p', 'state', 'Ninguna nota coincide con la búsqueda.')); return; }
    var counts = {};
    list.forEach(function (n) { counts[n.year] = (counts[n.year] || 0) + 1; });
    var cur = null, box = null;
    list.forEach(function (n) {
      if (n.year !== cur) {
        var sec = h('section', 'year'), hd = h('h2', 'year-h');
        hd.append(h('span', 'y', String(n.year)), h('span', 'n', span(counts[n.year], 'nota', 'notas')));
        box = h('div', 'list'); sec.append(hd, box); root.append(sec); cur = n.year;
      }
      box.append(entryEl(n));
    });
  }

  /* ---------- visor ---------- */
  var lb = { open: false, photos: [], i: 0, opener: null };
  function showLb() {
    var p = lb.photos[lb.i], img = $('lb-img'), full = cached(fpath(p));
    img.src = full || cached(tpath(p)) || ''; img.classList.toggle('loading', !full);
    $('lb-count').textContent = (lb.i + 1) + ' / ' + lb.photos.length;
    var multi = lb.photos.length > 1;
    $('lb-prev').hidden = !multi; $('lb-next').hidden = !multi;
    $('lb-msg').textContent = '';
    if (!full) {
      signPaths([fpath(p)]).then(function () {
        var u = cached(fpath(p));
        if (!u) throw new Error('sin url');
        if (lb.open && lb.photos[lb.i].id === p.id) { img.src = u; img.classList.remove('loading'); }
      }).catch(function () {
        if (lb.open && lb.photos[lb.i].id === p.id) { img.classList.remove('loading'); $('lb-msg').textContent = 'No se pudo cargar la foto completa.'; }
      });
    }
  }
  function openLb(n, i, opener) {
    lb = { open: true, photos: n.photos, i: i, opener: opener };
    $('lb-title').textContent = n.title; $('lb').hidden = false; showLb(); $('lb-close').focus();
  }
  function closeLb() {
    lb.open = false; $('lb').hidden = true; $('lb-img').removeAttribute('src');
    if (lb.opener && document.body.contains(lb.opener)) lb.opener.focus();
  }
  function stepLb(d) { if (lb.photos.length > 1) { lb.i = (lb.i + d + lb.photos.length) % lb.photos.length; showLb(); } }

  /* ---------- ingreso ---------- */
  function loginStatus(msg, kind) { var s = $('l-status'); s.textContent = msg; s.className = 'status' + (kind ? ' ' + kind : ''); }
  async function onLogin(e) {
    e.preventDefault();
    var email = $('l-email').value.trim(), pass = $('l-pass').value;
    if (!email || !pass) { loginStatus('Escribí tu correo y tu contraseña.', 'err'); return; }
    $('l-go').disabled = true; loginStatus('Ingresando…', '');
    try {
      var r = await sb.auth.signInWithPassword({ email: email, password: pass });
      if (r.error) {
        loginStatus(r.error.status === 429 ? 'Demasiados intentos. Esperá unos minutos.' : (r.error.status >= 500 || r.error.name === 'AuthRetryableFetchError') ? 'No se pudo conectar. Probá de nuevo.' : 'Correo o contraseña incorrectos.', 'err');
      } else { loginStatus('', ''); }
    } catch (err) { loginStatus('No se pudo conectar. Probá de nuevo.', 'err'); }
    $('l-pass').value = ''; $('l-go').disabled = false;
  }

  /* ---------- arranque ---------- */
  function bind() {
    MONTHS.forEach(function (m, i) { var o = h('option', null, m); o.value = i + 1; $('f-month').append(o); });
    setYearDefault(); renderStrip();
    $('login-form').addEventListener('submit', onLogin);
    $('logout').addEventListener('click', function () { sb.auth.signOut(); });
    $('note-form').addEventListener('submit', onSubmit);
    $('f-cancel').addEventListener('click', function () { resetForm(); setStatus('', ''); });
    $('f-today').addEventListener('click', function () {
      var d = new Date(); $('f-day').value = d.getDate(); $('f-month').value = d.getMonth() + 1; $('f-year').value = d.getFullYear();
    });
    $('pick').addEventListener('click', function () { $('f-files').click(); });
    $('f-files').addEventListener('change', function (e) { addFiles(e.target.files); e.target.value = ''; });
    var drop = $('drop');
    drop.addEventListener('dragover', function (e) { e.preventDefault(); drop.classList.add('over'); });
    drop.addEventListener('dragleave', function () { drop.classList.remove('over'); });
    drop.addEventListener('drop', function (e) { e.preventDefault(); drop.classList.remove('over'); if (e.dataTransfer) addFiles(e.dataTransfer.files); });
    document.addEventListener('paste', function (e) {
      if (lb.open || !uid || !e.clipboardData) return;
      var files = [], items = e.clipboardData.items || [];
      for (var i = 0; i < items.length; i++) {
        if (items[i].kind === 'file' && items[i].type.indexOf('image/') === 0) { var f = items[i].getAsFile(); if (f) files.push(f); }
      }
      if (files.length) { e.preventDefault(); addFiles(files); }
    });
    $('q').addEventListener('input', function (e) { query = e.target.value; render(); });
    function setOrder(o) { order = o; try { localStorage.setItem('cronologia-orden', o); } catch (e) {} render(); }
    $('o-asc').addEventListener('click', function () { setOrder('asc'); });
    $('o-desc').addEventListener('click', function () { setOrder('desc'); });
    $('lb-close').addEventListener('click', closeLb);
    $('lb-prev').addEventListener('click', function () { stepLb(-1); });
    $('lb-next').addEventListener('click', function () { stepLb(1); });
    $('lb').addEventListener('click', function (e) { if (e.target === $('lb') || e.target === $('lb-stage')) closeLb(); });
    document.addEventListener('keydown', function (e) {
      if (!lb.open) return;
      if (e.key === 'Escape') closeLb();
      else if (e.key === 'ArrowLeft') stepLb(-1);
      else if (e.key === 'ArrowRight') stepLb(1);
    });
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible' && uid) refreshThumbs();
    });
  }

  bind();
  if (!cfg.url || !cfg.key || !window.supabase) { showView('setup'); return; }
  sb = window.supabase.createClient(cfg.url, cfg.key, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false } });
  showView('login');
  sb.auth.getSession().then(function (r) { setSession(r.data && r.data.session); }).catch(function () {});
  sb.auth.onAuthStateChange(function (ev, s) { setTimeout(function () { setSession(s); }, 0); });
})();
