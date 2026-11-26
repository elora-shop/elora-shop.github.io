/* ELORA — لوحة التحكم (Atelier Dashboard)
 * تتصل بمستودع GitHub مباشرة، وتجمع كل تعديل في حفظة (commit) واحدة.
 * الملفات: media/… (الصور) · site.config.json (الهوية والتواصل) · shop.json (الأسعار والعروض والتوصيل والواجهة)
 */
(() => {
  'use strict';

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const KEY = 'elora-admin';

  const IMG_EXT = ['jpg', 'jpeg', 'png', 'webp', 'gif', 'avif', 'bmp'];
  const VID_EXT = ['mp4', 'webm', 'mov', 'm4v', 'ogv'];
  const FULL_MAX = 1600, THUMB_MAX = 700, VIDEO_MAX_MB = 24;
  const SHOP_PATH = 'shop.json', CFG_PATH = 'site.config.json';

  let CFG = null;           // {owner, repo, branch, token}
  let ITEMS = [], CATS = [];
  let SITE = {}, SHOP = {};
  let queue = [], editing = null, editingCoupon = null;
  let stagedLogo = null;
  const changes = new Set();
  const UI = { view: 'home', pCat: '*', pQ: '', prCat: '*', prQ: '', prMissing: false };

  /* ═══════════ أدوات ═══════════ */
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const icon = (n, cls = '') => `<svg class="i ${cls}"><use href="#i-${n}"/></svg>`;
  const ext = (n) => (n.split('.').pop() || '').toLowerCase();
  const stem = (n) => n.replace(/\.[^.]+$/, '');
  const safeName = (s) => String(s).replace(/[\\/:*?"<>|]/g, ' ').replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim().replace(/^\.+/, '').slice(0, 80);
  const makeId = (rel) => rel.replace(/\.[^.]+$/, '').normalize('NFKC').replace(/[\s/\\]+/g, '-').replace(/[^\p{L}\p{N}_-]/gu, '').replace(/^-+|-+$/g, '').toLowerCase();
  const shortId = (s) => { let h = 0x811c9dc5; for (const ch of String(s)) { h ^= ch.codePointAt(0); h = Math.imul(h, 0x01000193) >>> 0; } return h.toString(36); };
  const norm = (s) => String(s || '').toLowerCase().replace(/[ً-ْـ]/g, '').replace(/[أإآٱ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').replace(/ؤ/g, 'و').replace(/ئ/g, 'ي');
  const toNum = (v) => { const s = String(v ?? '').replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(/[^\d.]/g, ''); if (s === '') return null; const n = Number(s); return Number.isFinite(n) ? n : null; };
  let NF = new Intl.NumberFormat('ar-u-nu-arab');
  const num = (n) => NF.format(n);
  const money = (n) => `${NF.format(n)} ${SHOP.currency || 'ر.ي'}`;
  const DUAL = { 'قطعة': 'قطعتان', 'منتج': 'منتجان', 'تصنيف': 'تصنيفان' };
  const plural = (n, one, few, many) => n === 1 ? `${one} واحدة`.replace('منتج واحدة', 'منتج واحد').replace('تصنيف واحدة', 'تصنيف واحد')
    : n === 2 && DUAL[one] ? DUAL[one] : `${num(n)} ${n >= 3 && n <= 10 ? few : many}`;
  const store = { get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* */ } } };

  function toast(msg, err) {
    const el = document.createElement('div');
    el.className = 'toast' + (err ? ' err' : '');
    el.innerHTML = `${icon(err ? 'alert' : 'check')}<span>${esc(msg)}</span>`;
    $('#toasts').appendChild(el);
    setTimeout(() => el.remove(), 3000);
  }
  const busy = (msg) => { $('#busyMsg').textContent = msg; $('#busy').hidden = false; };
  const idle = () => { $('#busy').hidden = true; };

  /* ═══════════ GitHub ═══════════ */
  async function gh(path, { method = 'GET', body } = {}) {
    const r = await fetch(`https://api.github.com${path}`, {
      method,
      headers: { Authorization: `Bearer ${CFG.token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!r.ok) {
      let detail = '';
      try { detail = (await r.json()).message || ''; } catch { /* */ }
      if (r.status === 401) detail = 'مفتاح الوصول انتهى أو أُلغي. أنشئ مفتاحًا جديدًا من GitHub ثم سجّل الدخول به (الخطوات في «الدليل»)';
      const e = new Error(detail || `HTTP ${r.status}`); e.status = r.status; throw e;
    }
    return r.status === 204 ? null : r.json();
  }
  const repoBase = () => `/repos/${CFG.owner}/${CFG.repo}`;
  const rawURL = (p) => `https://raw.githubusercontent.com/${CFG.owner}/${CFG.repo}/${CFG.branch}/` + p.split('/').map(encodeURIComponent).join('/');
  // رابط المتجر: من حيث تُفتح اللوحة نفسها (Cloudflare أو GitHub أو دومين خاص) وإلا رابط GitHub
  const siteURL = () => (/^https?:$/.test(location.protocol) && !/^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname))
    ? new URL('./', location.href).href
    : CFG.repo.toLowerCase() === `${CFG.owner.toLowerCase()}.github.io` ? `https://${CFG.repo}/` : `https://${CFG.owner}.github.io/${CFG.repo}/`;

  /** حفظة واحدة لكل التغييرات. entries: {path, blob} إضافة · {path, sha} نقل · {path, sha:null} حذف */
  async function commit(entries, message, onProgress) {
    const ref = await gh(`${repoBase()}/git/ref/heads/${CFG.branch}`);
    const base = ref.object.sha;
    const head = await gh(`${repoBase()}/git/commits/${base}`);
    const tree = [];
    let done = 0;
    const uploads = entries.filter((e) => e.blob).length;
    for (const e of entries) {
      if (e.blob) {
        const content = await toBase64(e.blob);
        const b = await gh(`${repoBase()}/git/blobs`, { method: 'POST', body: { content, encoding: 'base64' } });
        tree.push({ path: e.path, mode: '100644', type: 'blob', sha: b.sha });
        onProgress?.(++done, uploads);
      } else tree.push({ path: e.path, mode: '100644', type: 'blob', sha: e.sha ?? null });
    }
    const nt = await gh(`${repoBase()}/git/trees`, { method: 'POST', body: { base_tree: head.tree.sha, tree } });
    const nc = await gh(`${repoBase()}/git/commits`, { method: 'POST', body: { message, tree: nt.sha, parents: [base] } });
    await gh(`${repoBase()}/git/refs/heads/${CFG.branch}`, { method: 'PATCH', body: { sha: nc.sha } });
    return nc.sha;
  }
  const toBase64 = (blob) => new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result).split(',')[1]); fr.onerror = () => rej(fr.error); fr.readAsDataURL(blob); });
  const jsonBlob = (o) => new Blob([JSON.stringify(o, null, 2) + '\n'], { type: 'application/json' });

  async function readJSON(path) {
    try {
      const r = await gh(`${repoBase()}/contents/${encodeURIComponent(path)}?ref=${CFG.branch}`);
      return JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(r.content.replace(/\s/g, '')), (c) => c.charCodeAt(0))));
    } catch (e) { if (e.status === 404) return {}; throw e; }
  }

  /* ═══════════ الصور والفيديو ═══════════ */
  // تصغير صورة أو إطار فيديو إلى ملف (اسمها مختلف عن render() التي ترسم واجهة اللوحة، وكان تشابه الاسمين يعطّل رفع الصور)
  function shrink(source, max, mime, quality) {
    const sw = source.width || source.videoWidth || source.naturalWidth, sh = source.height || source.videoHeight || source.naturalHeight;
    if (!sw || !sh) return Promise.reject(new Error('تعذّر قراءة الصورة'));
    const k = Math.min(1, max / Math.max(sw, sh));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(sw * k)); c.height = Math.max(1, Math.round(sh * k));
    c.getContext('2d').drawImage(source, 0, 0, c.width, c.height);
    const done = (b, res) => res({ blob: b, w: c.width, h: c.height });
    // بعض متصفحات الجوال لا تدعم WebP: نرجع إلى JPEG
    return new Promise((res, rej) => c.toBlob((b) => (b ? done(b, res) : c.toBlob((j) => (j ? done(j, res) : rej(new Error('تعذّر تجهيز الصورة'))), 'image/jpeg', quality)), mime, quality));
  }
  async function loadImage(file) {
    try { return await createImageBitmap(file); } catch {
      const url = URL.createObjectURL(file);
      try { const img = new Image(); img.src = url; await img.decode(); return img; } finally { setTimeout(() => URL.revokeObjectURL(url), 5000); }
    }
  }
  async function prepImage(file) {
    const bmp = await loadImage(file);
    try {
      const full = await shrink(bmp, FULL_MAX, 'image/jpeg', 0.85);
      const thumb = await shrink(bmp, THUMB_MAX, 'image/webp', 0.8);
      return { kind: 'image', full: full.blob, thumb: thumb.blob, outExt: 'jpg', thumbExt: thumb.blob.type === 'image/webp' ? 'webp' : 'jpg' };
    } finally { bmp.close?.(); }
  }
  async function prepVideo(file) {
    if (file.size > VIDEO_MAX_MB * 1048576) throw new Error(`الفيديو أكبر من ${VIDEO_MAX_MB} ميجابايت`);
    const url = URL.createObjectURL(file);
    const v = Object.assign(document.createElement('video'), { src: url, muted: true, playsInline: true, preload: 'metadata' });
    let thumb = null;
    try {
      await new Promise((res, rej) => { v.onloadeddata = res; v.onerror = () => rej(new Error('تعذّر قراءة الفيديو')); setTimeout(() => rej(new Error('مهلة')), 15000); });
      await new Promise((res) => { v.onseeked = res; v.currentTime = Math.min(1, (v.duration || 3) / 3); setTimeout(res, 4000); });
      thumb = (await shrink(v, THUMB_MAX, 'image/jpeg', 0.8)).blob;
    } catch { /* بلا غلاف */ } finally { URL.revokeObjectURL(url); }
    return { kind: 'video', full: file, thumb, outExt: ext(file.name), thumbExt: 'jpg' };
  }
  async function prepLogo(file) {
    const img = await loadImage(file);
    const w = img.width || img.naturalWidth, h = img.height || img.naturalHeight;
    if (!w || !h) throw new Error('تعذّر قراءة الصورة');
    const k = Math.min(1, 1600 / w);
    const c = document.createElement('canvas');
    c.width = Math.round(w * k); c.height = Math.round(h * k);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    const logo = await new Promise((r) => c.toBlob(r, 'image/png'));
    const S = 512, ic = document.createElement('canvas');
    ic.width = ic.height = S;
    const x = ic.getContext('2d');
    x.fillStyle = '#f6eaec'; x.fillRect(0, 0, S, S);
    const f = Math.min((S * 0.8) / w, (S * 0.8) / h);
    x.drawImage(img, (S - w * f) / 2, (S - h * f) / 2, w * f, h * f);
    const iconB = await new Promise((r) => ic.toBlob(r, 'image/png'));
    img.close?.();
    return { logo, icon: iconB, url: URL.createObjectURL(logo) };
  }

  /* ═══════════ تحميل البيانات ═══════════ */
  async function loadItems() {
    const tree = await gh(`${repoBase()}/git/trees/${CFG.branch}?recursive=1`);
    const thumbs = new Map(), files = [];
    for (const n of tree.tree) {
      if (n.type !== 'blob' || !n.path.startsWith('media/')) continue;
      const rel = n.path.slice(6);
      if (rel.startsWith('_thumbs/')) thumbs.set(makeId(rel.slice(8)), n);
      else if (!rel.split('/').some((p) => p.startsWith('_') || p.startsWith('.'))) files.push({ node: n, rel });
    }
    ITEMS = files.map(({ node, rel }) => {
      const parts = rel.split('/'), e = ext(rel);
      const type = VID_EXT.includes(e) ? 'video' : IMG_EXT.includes(e) ? 'image' : null;
      if (!type) return null;
      const id = makeId(rel), th = thumbs.get(id);
      return { path: node.path, sha: node.sha, id, title: stem(parts[parts.length - 1]), category: parts.length > 1 ? parts[0] : 'عام', type, thumbPath: th?.path || null, thumbSha: th?.sha || null, pending: false };
    }).filter(Boolean);
    ITEMS.sort((a, b) => a.category.localeCompare(b.category, 'ar') || a.title.localeCompare(b.title, 'ar'));
    refreshCats();
  }
  const refreshCats = () => { CATS = [...new Set(ITEMS.map((i) => i.category))].sort((a, b) => a.localeCompare(b, 'ar')); };
  const thumbOf = (it) => it.thumbPath ? rawURL(it.thumbPath) : rawURL(it.path);

  async function loadConfig() {
    [SITE, SHOP] = await Promise.all([readJSON(CFG_PATH), readJSON(SHOP_PATH)]);
    SHOP.products ||= {};
    SHOP.coupons ||= {};
    NF = new Intl.NumberFormat(SHOP.digits === 'latn' ? 'en' : 'ar-u-nu-arab');
    snapshot();
    changes.clear();
    updateSavebar();
  }
  // نسخة من آخر حالة منشورة: نقارن بها قبل الحفظ حتى لا تُنشر حفظات فارغة
  let ORIG_SHOP = '', ORIG_SITE = '';
  // مقارنة لا تتأثر بترتيب المفاتيح (إعادة إدراج مفتاح تغيّر ترتيبه دون أن يتغيّر المحتوى)
  const canon = (v) => JSON.stringify(v, (k, x) => (x && typeof x === 'object' && !Array.isArray(x)) ? Object.keys(x).sort().reduce((o, key) => (o[key] = x[key], o), {}) : x);
  function snapshot() { ORIG_SHOP = canon(cleanShop()); ORIG_SITE = canon(SITE); }

  /* ═══════════ بيانات المنتجات في shop.json ═══════════ */
  const getP = (it) => (SHOP.products[it.title] || SHOP.products[it.id] || {});
  // مدة التجهيز للقطعة (أيام): الخاصة بها أو الافتراضية من «التوصيل والدفع»
  const leadOf = (p) => p.days || (Number(SHOP.makeDays) > 0 ? Number(SHOP.makeDays) : 0);
  const bulkTxt = (b) => (Array.isArray(b) ? b.map((x) => `${x.min}:${x.price}`).join(', ') : '');
  const parseBulk = (s) => {
    const out = [];
    String(s || '').replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)).split(/[,،\n]+/).forEach((part) => {
      const m = part.match(/(\d+)\s*[:=×x]\s*(\d+)/);
      if (m && +m[1] > 1 && +m[2] > 0) out.push({ min: +m[1], price: +m[2] });
    });
    return out.length ? out.sort((a, b) => a.min - b.min) : null;
  };
  function setP(it, patch, silent) {
    const cur = { ...getP(it), ...patch };
    for (const k of Object.keys(cur)) if (cur[k] === null || cur[k] === undefined || cur[k] === '' || cur[k] === false || Number.isNaN(cur[k])) delete cur[k];
    delete SHOP.products[it.id];
    if (Object.keys(cur).length) SHOP.products[it.title] = cur; else delete SHOP.products[it.title];
    if (!silent) markDirty('p:' + it.title);
  }
  function renameP(oldTitle, oldId, it) {
    const data = SHOP.products[oldTitle] || SHOP.products[oldId];
    delete SHOP.products[oldTitle]; delete SHOP.products[oldId];
    if (data) SHOP.products[it.title] = data;
    if (SHOP.story && SHOP.story.image === oldTitle) SHOP.story.image = it.title;
  }
  const isSale = (p) => p.price != null && p.oldPrice != null && p.oldPrice > p.price;
  const discPct = (p) => Math.round(100 - (p.price / p.oldPrice) * 100);
  function priceTxt(p) {
    if (p.price == null) return '';
    return `${p.from ? 'يبدأ من ' : ''}${money(p.price)}`;
  }

  /* ═══════════ التغييرات غير المحفوظة ═══════════ */
  function markDirty(k) { changes.add(k); updateSavebar(); }
  function updateSavebar() {
    const n = changes.size;
    $('#savebar').hidden = !n;
    $('#sbTxt').textContent = n === 1 ? 'تعديل واحد غير محفوظ' : n === 2 ? 'تعديلان غير محفوظين' : `${num(n)} ${n <= 10 ? 'تعديلات غير محفوظة' : 'تعديلًا غير محفوظ'}`;
  }
  function cleanOf(obj) {
    const s = JSON.parse(JSON.stringify(obj || {}));
    s.sampleData = false;
    if (s.products) for (const k of Object.keys(s.products)) if (!Object.keys(s.products[k]).length) delete s.products[k];
    return s;
  }
  const cleanShop = () => cleanOf(SHOP);
  /** دمج ثلاثي: ما غيّرتُه أنا يُطبَّق فوق أحدث نسخة منشورة (من جهاز آخر مثلًا) بدل أن يمحوها */
  const isObj = (x) => x && typeof x === 'object' && !Array.isArray(x);
  function merge3(base, mine, theirs) {
    if (canon(mine) === canon(base)) return theirs;
    if (canon(theirs) === canon(base)) return mine;
    if (!(isObj(base) && isObj(mine) && isObj(theirs))) return mine;      // تعارض على القيمة نفسها: تعديلي يفوز
    const out = {};
    for (const k of new Set([...Object.keys(base), ...Object.keys(mine), ...Object.keys(theirs)])) {
      const b = base[k], m = mine[k], t = theirs[k];
      let v;
      if (canon(m) === canon(b)) v = t;                  // لم أغيّره: خذ الأحدث
      else if (canon(t) === canon(b)) v = m;             // غيّرتُه أنا فقط
      else v = isObj(b) && isObj(m) && isObj(t) ? merge3(b, m, t) : m;
      if (v !== undefined) out[k] = v;
    }
    return out;
  }
  async function saveAll(extra = [], message) {
    // اجلب أحدث نسخة منشورة: إن عُدّلت من جهاز آخر بعد فتح اللوحة، ادمج بدل الكتابة فوقها
    const [rShop, rSite] = await Promise.all([readJSON(SHOP_PATH), readJSON(CFG_PATH)]);
    const remoteShop = canon(cleanOf(rShop)), remoteSite = canon(rSite);
    let merged = false;
    if (remoteShop !== ORIG_SHOP) {
      SHOP = merge3(JSON.parse(ORIG_SHOP), cleanShop(), cleanOf(rShop));
      SHOP.products ||= {}; SHOP.coupons ||= {};
      merged = true;
    }
    if (remoteSite !== ORIG_SITE) { SITE = merge3(JSON.parse(ORIG_SITE), SITE, rSite); merged = true; }
    const shopNow = canon(cleanShop());
    const shopChanged = shopNow !== remoteShop;
    const siteChanged = canon(SITE) !== remoteSite || !!stagedLogo;
    if (!extra.length && !shopChanged && !siteChanged) {
      snapshot();
      changes.clear();
      updateSavebar();
      return false;                      // لا شيء تغيّر فعلًا (مثلًا: تعديل ثم إرجاعه)
    }
    const entries = [...extra];
    if (shopChanged) entries.push({ path: SHOP_PATH, blob: jsonBlob(cleanShop()) });
    if (siteChanged) {
      const next = { ...SITE };
      if (stagedLogo) { entries.push({ path: 'assets/logo.png', blob: stagedLogo.logo }, { path: 'assets/icon.png', blob: stagedLogo.icon }); next.logo = 'assets/logo.png'; }
      entries.push({ path: CFG_PATH, blob: jsonBlob(next) });
    }
    const kinds = [...changes].map((c) => c.split(':')[0]);
    const msg = message || summarize(kinds);
    const sha = await commit(entries, msg, (d, t) => t > 1 && busy(`جارٍ الرفع… ${num(d)}/${num(t)}`));
    changes.clear();
    if (stagedLogo) { URL.revokeObjectURL(stagedLogo.url); stagedLogo = null; }
    snapshot();
    updateSavebar();
    watchDeploy(sha, merged);
    return true;
  }
  function summarize(kinds) {
    const m = { p: 'الأسعار والمنتجات', c: 'الكوبونات', promo: 'شريط العرض', tiers: 'خصم الكمية', ship: 'التوصيل والدفع', front: 'واجهة المتجر', orders: 'إعدادات الطلبات', site: 'إعدادات المتجر' };
    const parts = [...new Set(kinds)].map((k) => m[k]).filter(Boolean);
    return 'لوحة التحكم: تحديث ' + (parts.join('، ') || 'المتجر');
  }
  function showBanner(html, kind = '', hideAfter = 0) {
    const b = $('#banner');
    b.className = 'banner' + (kind ? ' ' + kind : '');
    b.innerHTML = html;
    b.hidden = false;
    clearTimeout(showBanner._t);
    if (hideAfter) showBanner._t = setTimeout(() => { b.hidden = true; }, hideAfter);
  }
  /** يتابع الموقع بعد الحفظ حتى يظهر التحديث فعلًا (version.json يكتبه build.py برقم الحفظة) */
  let deployWatch = 0;
  async function watchDeploy(sha, merged) {
    const my = ++deployWatch, started = Date.now();
    const note = merged ? ' <small>(دُمجت تعديلاتك مع تحديثات أحدث من جهاز آخر)</small>' : '';
    showBanner(`<span class="spin"></span> تم الحفظ، وجارٍ نشره في المتجر… يستغرق عادة دقيقة إلى ثلاث.${note}`, 'info');
    while (my === deployWatch) {
      await new Promise((r) => setTimeout(r, 15000));
      if (my !== deployWatch) return;
      try {
        const v = await fetch(`${siteURL()}version.json?t=${Date.now()}`, { cache: 'no-store' }).then((r) => (r.ok ? r.json() : {}));
        if (v.sha === sha) { showBanner(`${icon('check')} ظهر التحديث في المتجر ✓ <a href="${esc(siteURL())}" target="_blank" rel="noopener">عرض المتجر</a>${note}`, 'ok', 15000); return; }
      } catch { /* نحاول مجددًا */ }
      if (Date.now() - started > 10 * 60000) {
        showBanner(`${icon('alert')} حُفظت تعديلاتك، لكنها لم تظهر في المتجر بعد ١٠ دقائق. قد يكون النشر في Cloudflare متأخرًا أو فشل: افتح <a href="https://dash.cloudflare.com/" target="_blank" rel="noopener">Cloudflare</a> ← Workers &amp; Pages ← elora-shop ← Deployments.`, 'warn');
        return;
      }
    }
  }

  $('#sbSave').addEventListener('click', async () => {
    try { busy('جارٍ الحفظ والنشر…'); toast(await saveAll() ? 'تم الحفظ والنشر' : 'لا توجد تغييرات فعلية لحفظها'); render(); }
    catch (e) { toast('تعذّر الحفظ: ' + e.message, true); }
    finally { idle(); }
  });
  $('#sbDiscard').addEventListener('click', async () => {
    if (!confirm('تجاهل كل التعديلات غير المحفوظة؟')) return;
    try { busy('جارٍ الاستعادة…'); await loadConfig(); if (stagedLogo) { URL.revokeObjectURL(stagedLogo.url); stagedLogo = null; } render(); toast('تم التراجع'); }
    catch (e) { toast(e.message, true); } finally { idle(); }
  });
  addEventListener('beforeunload', (e) => { if (changes.size) { e.preventDefault(); e.returnValue = ''; } });

  /* ═══════════ التنقل ═══════════ */
  const TITLES = {
    home: ['الرئيسية', 'نظرة سريعة على متجرك'],
    products: ['المنتجات', 'أضف الصور، وعدّل الأسماء والتصنيفات'],
    prices: ['الأسعار والمخزون', 'عدّل الأسعار مباشرة في الجدول ثم اضغط «حفظ ونشر»'],
    offers: ['العروض والكوبونات', 'أكواد خصم وشريط عرض بعدّاد تنازلي'],
    shipping: ['التوصيل والدفع', 'مناطق التوصيل ورسومها وطرق الدفع'],
    storefront: ['واجهة المتجر', 'النصوص التي يراها الزائر أولًا'],
    orders: ['الطلبات', 'جدول الطلبات وتتبّع الحالة'],
    settings: ['إعدادات المتجر', 'الاسم والشعار والتواصل'],
  };
  function go(view) {
    if (!TITLES[view]) view = 'home';
    UI.view = view;
    $$('.view').forEach((v) => { v.hidden = v.dataset.view !== view; });
    $$('[data-go]').forEach((b) => b.matches('.side-nav button, .mnav button') && b.setAttribute('aria-current', b.dataset.go === view ? 'page' : 'false'));
    $('#viewTitle').textContent = TITLES[view][0];
    $('#viewSub').textContent = TITLES[view][1];
    if (location.hash !== '#' + view) history.replaceState(null, '', '#' + view);
    closeSide();
    render();
    scrollTo({ top: 0 });
  }
  document.addEventListener('click', (e) => {
    const g = e.target.closest('[data-go]');
    if (g) { e.preventDefault(); go(g.dataset.go); return; }
    if (e.target.closest('[data-act="add"]')) { $('#filePick').click(); return; }
    const c = e.target.closest('[data-close]');
    if (c) { c.closest('.sheet').hidden = true; unlockIfNoSheet(); }
  });
  const openSide = () => { $('#side').classList.add('on'); $('#sideScrim').classList.add('on'); };
  const closeSide = () => { $('#side').classList.remove('on'); $('#sideScrim').classList.remove('on'); };
  $('#menuBtn').addEventListener('click', openSide);
  $('#moreBtn').addEventListener('click', openSide);
  $('#sideScrim').addEventListener('click', closeSide);
  function openSheet(id) { $('#' + id).hidden = false; document.documentElement.classList.add('locked'); }
  function closeSheet(id) { $('#' + id).hidden = true; unlockIfNoSheet(); }
  function unlockIfNoSheet() { if (!$$('.sheet').some((s) => !s.hidden)) document.documentElement.classList.remove('locked'); }
  $$('.sheet').forEach((s) => s.addEventListener('click', (e) => { if (e.target === s) closeSheet(s.id); }));
  addEventListener('keydown', (e) => { if (e.key === 'Escape') { const open = $$('.sheet').filter((s) => !s.hidden).pop(); if (open) closeSheet(open.id); else closeSide(); } });

  function render() {
    renderNavBadges();
    ({ home: renderHome, products: renderProducts, prices: renderPrices, offers: renderOffers, shipping: renderShipping, storefront: renderFront, orders: renderOrders, settings: renderSettings })[UI.view]();
  }
  function renderNavBadges() {
    $('#nbProducts').textContent = num(ITEMS.length);
    const missing = ITEMS.filter((it) => getP(it).price == null).length;
    $('#nbPrices').textContent = missing ? num(missing) : '';
    $$('.cur').forEach((c) => { c.textContent = SHOP.currency || 'ر.ي'; });
  }

  /* ═══════════ الرئيسية ═══════════ */
  function renderHome() {
    const h = new Date().getHours();
    $('#helloKicker').textContent = h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
    $('#helloTitle').textContent = `${h < 12 ? 'صباح الخير' : 'مساء الخير'}، أهلًا بك في مشغل ${SITE.brandName || 'ELORA'}`;
    const ps = ITEMS.map((it) => ({ it, p: getP(it) }));
    const priced = ps.filter((x) => x.p.price != null).length;
    const sale = ps.filter((x) => isSale(x.p)).length;
    const out = ps.filter((x) => x.p.stock === 0 && !leadOf(x.p)).length;
    const low = ps.filter((x) => x.p.stock > 0 && x.p.stock <= 2 && !leadOf(x.p)).length;
    const now = new Date().toISOString().slice(0, 10);
    const coupons = Object.values(SHOP.coupons || {}).filter((c) => c.active !== false && !(c.expires && c.expires < now)).length;
    $('#helloSub').textContent = priced < ITEMS.length ? `${plural(ITEMS.length - priced, 'قطعة', 'قطع', 'قطعة')} بانتظار التسعير.` : 'كل القطع مسعّرة، متجرك جاهز للبيع ✦';
    const stat = (go, ic, label, val, sub) => `<button class="stat" data-go="${go}"><span class="stat-top">${label}${icon(ic)}</span><b>${val}</b><small>${sub}</small></button>`;
    $('#stats').innerHTML = [
      stat('products', 'box', 'المنتجات', num(ITEMS.length), `${plural(CATS.length, 'تصنيف', 'تصنيفات', 'تصنيفًا')}`),
      stat('prices', 'tag', 'مسعّرة', `${num(priced)}<small style="font-size:.9rem"> / ${num(ITEMS.length)}</small>`, priced === ITEMS.length ? 'مكتمل ✓' : 'أكمل التسعير'),
      stat('prices', 'percent', 'عليها خصم', num(sale), out || low ? `${num(out)} نفدت · ${num(low)} كمية محدودة` : 'المخزون بحالة جيدة'),
      stat('offers', 'sparkle', 'كوبونات فعّالة', num(coupons), SHOP.promo?.active ? 'شريط العرض يعمل' : 'لا يوجد عرض مؤقت'),
    ].join('');

    // تنبيهات تمنع توقف المتجر دون أن تنتبه
    const alerts = [];
    if (SITE.tokenExpires) {
      const left = Math.ceil((new Date(SITE.tokenExpires + 'T00:00') - Date.now()) / 864e5);
      if (left <= 30) alerts.push(left <= 0 ? 'انتهى مفتاح الوصول! أنشئ مفتاحًا جديدًا الآن (الخطوات في «الدليل»).' : `مفتاح الوصول ينتهي بعد ${left === 1 ? 'يوم واحد' : left === 2 ? 'يومين' : left <= 10 ? `${num(left)} أيام` : `${num(left)} يومًا`}. جدّده من GitHub قبل أن تتوقف اللوحة عن الحفظ.`);
    }
    if (SHOP.pause?.on) alerts.push('استقبال الطلبات متوقف حاليًا (وضع الإجازة). أعد تشغيله من «التوصيل والدفع».');
    const now0 = new Date().toISOString().slice(0, 10);
    const expiring = Object.entries(SHOP.coupons || {}).filter(([, c]) => c.active !== false && c.expires && c.expires >= now0 && (new Date(c.expires) - Date.now()) < 3 * 864e5).map(([k]) => k);
    if (expiring.length) alerts.push(`ينتهي قريبًا: ${expiring.join('، ')}. جهّز العرض التالي من «العروض».`);
    $('#homeAlerts').innerHTML = alerts.map((a) => `<div class="banner warn">${icon('alert')} ${esc(a)}</div>`).join('');

    const waOk = /^\d{10,15}$/.test(SITE.whatsapp || '') && !/^0/.test(SITE.whatsapp || '');
    const tasks = [
      { done: priced === ITEMS.length, t: 'أضف أسعار القطع', s: `${num(priced)} من ${num(ITEMS.length)} مسعّرة`, go: 'prices' },
      { done: !!SHOP.orderEndpoint, t: 'اربط استقبال الطلبات', s: 'الطلبات تصل إلى جدول Google', go: 'orders' },
      { done: (SHOP.deliveryZones || []).length > 0, t: 'حدّد مناطق التوصيل', s: 'ورسوم كل منطقة', go: 'shipping' },
      { done: (SHOP.payments || []).length > 0, t: 'أضف طرق الدفع', s: 'مثل الدفع عند الاستلام', go: 'shipping' },
      { done: Object.keys(SHOP.coupons || {}).length > 0, t: 'أنشئ أول كوبون خصم', s: 'لجذب أول الزبائن', go: 'offers' },
      { done: ps.filter((x) => x.p.featured).length >= 3, t: 'اختر ٣ قطع مميّزة على الأقل', s: 'تظهر في واجهة المتجر', go: 'prices' },
      { done: waOk, t: 'رقم واتساب صحيح', s: SITE.whatsapp ? `wa.me/${SITE.whatsapp}` : 'غير مضبوط', go: 'settings' },
    ];
    const doneN = tasks.filter((t) => t.done).length;
    const pct = Math.round((doneN / tasks.length) * 100);
    $('#readyPct').textContent = `${num(pct)}٪`;
    $('#readyBar').style.width = pct + '%';
    $('#checklist').innerHTML = tasks.map((t) => `<li class="${t.done ? 'done' : ''}"><button data-go="${t.go}"><span class="ck">${icon('check')}</span><span class="ck-t">${esc(t.t)}<small>${esc(t.s)}</small></span>${icon('next', 'go')}</button></li>`).join('');

    const un = ps.filter((x) => x.p.price == null).slice(0, 12);
    $('#unpricedList').innerHTML = un.length
      ? un.map(({ it }) => `<button data-edit="${ITEMS.indexOf(it)}"><img src="${esc(thumbOf(it))}" alt="" loading="lazy"><span>${esc(it.title)}</span></button>`).join('')
      : `<p class="all-done">${icon('check')} كل القطع مسعّرة</p>`;
  }
  $('#unpricedList').addEventListener('click', (e) => { const b = e.target.closest('[data-edit]'); if (b) openItem(ITEMS[+b.dataset.edit]); });

  /* ═══════════ المنتجات ═══════════ */
  function chipsHTML(sel, list) {
    const counts = new Map();
    list.forEach((i) => counts.set(i.category, (counts.get(i.category) || 0) + 1));
    return [['*', 'الكل', list.length], ...CATS.map((c) => [c, c, counts.get(c) || 0])]
      .map(([v, l, n]) => `<button class="chip" data-cat="${esc(v)}" aria-pressed="${v === sel}">${esc(l)}<i>${num(n)}</i></button>`).join('');
  }
  function renderProducts() {
    $('#pChips').innerHTML = chipsHTML(UI.pCat, ITEMS);
    const q = norm(UI.pQ);
    const view = ITEMS.filter((it) => (UI.pCat === '*' || it.category === UI.pCat) && (!q || norm(it.title).includes(q)));
    $('#pEmpty').hidden = view.length > 0;
    $('#pGrid').innerHTML = view.map((it) => {
      const p = getP(it);
      const badges = [
        it.pending && '<span class="pb pend">قيد النشر</span>',
        p.hidden && '<span class="pb hid">مخفية</span>',
        isSale(p) && `<span class="pb sale">−${num(discPct(p))}٪</span>`,
        p.stock === 0 && !leadOf(p) && '<span class="pb out">نفدت</span>',
        p.stock > 0 && leadOf(p) && `<span class="pb">${num(p.stock)} جاهزة</span>`,
        it.type === 'video' && '<span class="pb">فيديو</span>',
      ].filter(Boolean).join('');
      return `<button class="pcard${p.hidden ? ' hidden-item' : ''}" data-i="${ITEMS.indexOf(it)}">
        <div class="pimg"><img src="${esc(thumbOf(it))}" alt="" loading="lazy" decoding="async"><div class="pbadges">${badges}</div>${p.featured ? `<span class="pstar">${icon('star')}</span>` : ''}</div>
        <div class="pinfo"><small>${esc(it.category)}</small><b>${esc(it.title)}</b>
          ${p.price != null ? `<span class="pprice">${esc(priceTxt(p))}${isSale(p) ? `<s>${money(p.oldPrice)}</s>` : ''}</span>` : '<span class="pprice none">بلا سعر</span>'}</div>
      </button>`;
    }).join('');
  }
  $('#pChips').addEventListener('click', (e) => { const b = e.target.closest('[data-cat]'); if (b) { UI.pCat = b.dataset.cat; renderProducts(); } });
  $('#pSearch').addEventListener('input', (e) => { UI.pQ = e.target.value; renderProducts(); });
  $('#pGrid').addEventListener('click', (e) => { const b = e.target.closest('.pcard'); if (b) openItem(ITEMS[+b.dataset.i]); });

  /* ---------- رفع منتجات جديدة ---------- */
  $('#filePick').addEventListener('change', async (e) => {
    const files = [...e.target.files];
    e.target.value = '';
    if (!files.length) return;
    busy('جارٍ تجهيز الملفات…');
    clearQueue();
    const failed = [];
    for (const f of files) {
      const x = ext(f.name);
      try {
        if (IMG_EXT.includes(x)) queue.push({ file: f, ...(await prepImage(f)) });
        else if (VID_EXT.includes(x)) queue.push({ file: f, ...(await prepVideo(f)) });
        else failed.push(`${f.name}: صيغة غير مدعومة`);
      } catch (err) { failed.push(`${f.name}: ${err.message}`); }
    }
    idle();
    if (failed.length) toast(failed[0], true);
    if (!queue.length) return;
    queue.forEach((q) => {
      q.title = safeName(stem(q.file.name).replace(/^(IMG|VID|PXL|DSC|PHOTO)[-_ ]*/i, '').replace(/^\d{4}[-_]?\d{2}[-_]?\d{2}([-_ ]?WA)?\d*[-_ ]*/i, '').replace(/[-_]+/g, ' ').trim()) || 'منتج جديد';
      q.category = UI.pCat !== '*' ? UI.pCat : (CATS[0] || 'عام');
      q.price = '';
    });
    renderReview();
    openSheet('review');
  });
  function catOptions(sel) {
    return [...new Set([...CATS, sel])].filter(Boolean).map((c) => `<option value="${esc(c)}"${c === sel ? ' selected' : ''}>${esc(c)}</option>`).join('') + '<option value="__new__">＋ تصنيف جديد…</option>';
  }
  function renderReview() {
    $('#revList').innerHTML = queue.map((q, i) => {
      if (!q.preview) q.preview = URL.createObjectURL(q.thumb || q.full);
      const mb = (q.full.size / 1048576).toFixed(1);
      return `<div class="rev-item" data-i="${i}"><img src="${q.preview}" alt="">
        <div class="rev-f">
          <label class="fld wide"><span>اسم المنتج</span><input type="text" data-f="title" value="${esc(q.title)}"></label>
          <label class="fld"><span>التصنيف</span><select data-f="category">${catOptions(q.category)}</select></label>
          <label class="fld"><span>السعر <small>(اختياري)</small></span><span class="inp money"><input type="number" min="0" step="100" data-f="price" value="${esc(q.price)}" placeholder="عند الطلب"><em class="cur">${esc(SHOP.currency || 'ر.ي')}</em></span></label>
          <div class="rev-meta"><span>${q.kind === 'video' ? 'فيديو' : 'صورة'} · ${mb} م.ب</span><button class="link-btn" data-drop="${i}">إزالة</button></div>
        </div></div>`;
    }).join('');
    $('#revPublish').textContent = queue.length === 1 ? 'نشر المنتج' : `نشر ${plural(queue.length, 'منتج', 'منتجات', 'منتجًا')}`;
  }
  $('#revList').addEventListener('input', (e) => {
    const row = e.target.closest('.rev-item');
    if (!row) return;
    const q = queue[+row.dataset.i], f = e.target.dataset.f;
    if (f === 'category' && e.target.value === '__new__') {
      const name = safeName(prompt('اسم التصنيف الجديد:') || '');
      if (name) { if (!CATS.includes(name)) CATS.push(name); q.category = name; }
      renderReview(); return;
    }
    if (f) q[f] = e.target.value;
  });
  $('#revList').addEventListener('click', (e) => {
    const b = e.target.closest('[data-drop]');
    if (!b) return;
    queue.splice(+b.dataset.drop, 1);
    if (!queue.length) { closeSheet('review'); return; }
    renderReview();
  });
  function clearQueue() { queue.forEach((q) => q.preview && URL.revokeObjectURL(q.preview)); queue = []; }
  function uniquePath(cat, title, outExt, taken) {
    const base = safeName(title) || 'منتج';
    let name = base, n = 2;
    while (taken.has(`media/${cat}/${name}.${outExt}`)) name = `${base} ${n++}`;
    taken.add(`media/${cat}/${name}.${outExt}`);
    return { path: `media/${cat}/${name}.${outExt}`, name };
  }
  $('#revPublish').addEventListener('click', async () => {
    const taken = new Set(ITEMS.map((i) => i.path));
    const entries = [], added = [];
    for (const q of queue) {
      const cat = safeName(q.category) || 'عام';
      const { path, name } = uniquePath(cat, q.title, q.outExt, taken);
      entries.push({ path, blob: q.full });
      let thumbPath = null;
      if (q.thumb) { thumbPath = `media/_thumbs/${cat}/${name}.${q.thumbExt}`; entries.push({ path: thumbPath, blob: q.thumb }); }
      const it = { path, sha: null, id: makeId(path.slice(6)), title: name, category: cat, type: q.kind, thumbPath, thumbSha: null, pending: true };
      added.push(it);
      const pr = toNum(q.price);
      // تاريخ الإضافة: منه تظهر شارة «جديد» ويُرتّب «الأحدث» أيًّا كانت الاستضافة
      setP(it, { added: new Date().toISOString().slice(0, 19), ...(pr != null ? { price: pr } : {}) }, true);
    }
    closeSheet('review');
    try {
      busy('جارٍ الرفع…');
      await saveAll(entries, `إضافة ${added.length} منتج`);
      ITEMS.push(...added);
      refreshCats();
      clearQueue();
      render();
      toast('تم نشر المنتجات');
    } catch (err) { toast('تعذّر النشر: ' + err.message, true); } finally { idle(); }
  });

  /* ---------- محرر المنتج ---------- */
  function openItem(it) {
    editing = it;
    const p = getP(it);
    $('#isName').textContent = it.title;
    $('#isThumb').src = thumbOf(it);
    $('#isView').href = `${siteURL()}#i=${shortId(it.id)}`;
    $('#isTitle').value = it.title;
    $('#isCat').innerHTML = catOptions(it.category);
    $('#isPrice').value = p.price ?? '';
    $('#isOld').value = p.oldPrice ?? '';
    $('#isStock').value = p.stock ?? '';
    $('#isFrom').checked = !!p.from;
    $('#isPre').value = p.days ?? '';
    $('#isPre').placeholder = Number(SHOP.makeDays) > 0 ? `الافتراضي ${num(SHOP.makeDays)}` : 'جاهزة';
    $('#isBulk').value = bulkTxt(p.bulk);
    $('#isDesc').value = p.desc || '';
    $('#isFeat').checked = !!p.featured;
    $('#isHidden').checked = !!p.hidden;
    updateItemPreview();
    openSheet('itemSheet');
  }
  function updateItemPreview() {
    const price = toNum($('#isPrice').value), old = toNum($('#isOld').value), stock = toNum($('#isStock').value);
    const from = $('#isFrom').checked;
    $('#isOld').closest('.inp').style.borderColor = old != null && price != null && old <= price ? 'var(--sale)' : '';
    let h = '<small>كما يظهر للزبون:</small> ';
    if (price == null) h += '<b style="color:var(--rose-ink)">السعر عند الطلب</b>';
    else {
      h += `<b>${from ? 'يبدأ من ' : ''}${money(price)}</b>`;
      if (old != null && old > price) h += ` <s>${money(old)}</s> <span class="disc">خصم ${num(Math.round(100 - price / old * 100))}٪</span>`;
    }
    const lead = toNum($('#isPre').value) || (Number(SHOP.makeDays) > 0 ? Number(SHOP.makeDays) : 0);
    if (lead) h += stock > 0 ? ` · <span style="color:var(--ok)">${num(stock)} جاهزة الآن</span>` : ` · <span style="color:var(--gold)">تُصنع خلال ${num(lead)} أيام</span>`;
    else if (stock === 0) h += ' · <b style="color:var(--sale)">نفدت الكمية</b>';
    else if (stock != null && stock <= 2) h += ` · <span style="color:var(--gold)">${stock === 1 ? 'آخر قطعة' : 'كمية محدودة'}</span>`;
    const bk = parseBulk($('#isBulk').value);
    if (bk) h += ` · <small>${bk.map((b) => `${num(b.min)}+ بـ ${money(b.price)}`).join('، ')}</small>`;
    if ($('#isHidden').checked) h += ' · <span style="color:var(--muted)">مخفية</span>';
    $('#isPreview').innerHTML = h;
  }
  $('#itemSheet').addEventListener('input', updateItemPreview);
  $('#isCat').addEventListener('change', (e) => {
    if (e.target.value !== '__new__') return;
    const name = safeName(prompt('اسم التصنيف الجديد:') || '');
    if (name && !CATS.includes(name)) CATS.push(name);
    $('#isCat').innerHTML = catOptions(name || editing.category);
  });
  $('#isSave').addEventListener('click', async () => {
    const it = editing;
    if (!it) return;
    const title = safeName($('#isTitle').value), cat = safeName($('#isCat').value);
    if (!title || !cat) { toast('الاسم والتصنيف مطلوبان', true); return; }
    const price = toNum($('#isPrice').value), old = toNum($('#isOld').value);
    if (old != null && price != null && old <= price) { toast('«قبل الخصم» يجب أن يكون أكبر من السعر', true); return; }
    const entries = [];
    const moved = title !== it.title || cat !== it.category;
    if (moved && it.pending) { toast('انتظر اكتمال نشر هذا المنتج أولًا', true); return; }
    const oldTitle = it.title, oldId = it.id;
    if (moved) {
      const taken = new Set(ITEMS.filter((x) => x !== it).map((x) => x.path));
      const { path: newPath, name } = uniquePath(cat, title, ext(it.path), taken);
      entries.push({ path: it.path, sha: null }, { path: newPath, sha: it.sha });
      let newThumb = null;
      if (it.thumbPath && it.thumbSha) { newThumb = `media/_thumbs/${cat}/${name}.${ext(it.thumbPath)}`; entries.push({ path: it.thumbPath, sha: null }, { path: newThumb, sha: it.thumbSha }); }
      Object.assign(it, { path: newPath, id: makeId(newPath.slice(6)), title: name, category: cat, thumbPath: newThumb, pending: true });
      renameP(oldTitle, oldId, it);
      // الرابط القديم للقطعة (المنشور في إنستقرام مثلًا) يبقى يفتحها بعد تغيير الاسم
      const e = (SHOP.products[it.title] ||= {});
      e.aliases = [...new Set([...(e.aliases || []), shortId(oldId)])].filter((a) => a !== shortId(it.id));
    }
    setP(it, { price, oldPrice: old, stock: toNum($('#isStock').value), days: toNum($('#isPre').value) || null, bulk: parseBulk($('#isBulk').value), from: $('#isFrom').checked, desc: $('#isDesc').value.trim(), featured: $('#isFeat').checked, hidden: $('#isHidden').checked });
    closeSheet('itemSheet');
    try {
      busy('جارٍ الحفظ…');
      await saveAll(entries, `تعديل ${oldTitle}`);
      refreshCats();
      render();
      toast('تم الحفظ');
    } catch (err) { toast('تعذّر الحفظ: ' + err.message, true); } finally { idle(); }
  });
  $('#isDelete').addEventListener('click', async () => {
    const it = editing;
    if (!it || !confirm(`حذف «${it.title}» نهائيًا من المتجر؟`)) return;
    const entries = [{ path: it.path, sha: null }];
    if (it.thumbPath) entries.push({ path: it.thumbPath, sha: null });
    delete SHOP.products[it.title]; delete SHOP.products[it.id];
    closeSheet('itemSheet');
    try {
      busy('جارٍ الحذف…');
      await saveAll(entries, `حذف ${it.title}`);
      ITEMS.splice(ITEMS.indexOf(it), 1);
      refreshCats();
      if (UI.pCat !== '*' && !CATS.includes(UI.pCat)) UI.pCat = '*';
      render();
      toast('تم الحذف');
    } catch (err) { toast('تعذّر الحذف: ' + err.message, true); } finally { idle(); }
  });

  /* ═══════════ الأسعار ═══════════ */
  function priceView() {
    const q = norm(UI.prQ);
    return ITEMS.filter((it) => (UI.prCat === '*' || it.category === UI.prCat) && (!q || norm(it.title).includes(q)) && (!UI.prMissing || getP(it).price == null));
  }
  function renderPrices() {
    $('#prChips').innerHTML = chipsHTML(UI.prCat, ITEMS);
    const list = priceView();
    const cur = esc(SHOP.currency || 'ر.ي');
    $('#prTable').innerHTML = `<div class="pt-h"><span>القطعة</span><span>السعر (${cur})</span><span>قبل الخصم</span><span>المخزون</span><span>مميّزة</span><span>ظاهرة</span></div>` +
      (list.length ? list.map((it) => {
        const p = getP(it), i = ITEMS.indexOf(it);
        return `<div class="prow${changes.has('p:' + it.title) ? ' changed' : ''}" data-i="${i}">
          <button class="pr-item" data-open="${i}"><img src="${esc(thumbOf(it))}" alt="" loading="lazy"><div><b>${esc(it.title)}</b><small>${esc(it.category)}${isSale(p) ? ` · <span class="disc">−${num(discPct(p))}٪</span>` : ''}</small></div></button>
          <div class="cell c-price"><span class="lbl">السعر</span><input type="text" inputmode="numeric" data-k="price" value="${p.price ?? ''}" placeholder="عند الطلب"></div>
          <div class="cell c-old"><span class="lbl">قبل الخصم</span><input type="text" inputmode="numeric" data-k="oldPrice" value="${p.oldPrice ?? ''}" placeholder="—"${p.oldPrice != null && p.price != null && p.oldPrice <= p.price ? ' class="bad"' : ''}></div>
          <div class="cell c-stock"><span class="lbl">المخزون</span><input type="text" inputmode="numeric" data-k="stock" value="${p.stock ?? ''}" placeholder="∞"></div>
          <div class="c-feat"><button class="tg${p.featured ? ' on' : ''}" data-t="featured" aria-pressed="${!!p.featured}" title="مميّزة في الواجهة">${icon('star')}</button></div>
          <div class="c-vis"><button class="tg vis${p.hidden ? ' off' : ''}" data-t="hidden" aria-pressed="${!p.hidden}" title="${p.hidden ? 'مخفية' : 'ظاهرة'}">${icon(p.hidden ? 'eyeoff' : 'eye')}</button></div>
        </div>`;
      }).join('') : '<p class="empty">لا توجد قطع مطابقة.</p>');
  }
  $('#prChips').addEventListener('click', (e) => { const b = e.target.closest('[data-cat]'); if (b) { UI.prCat = b.dataset.cat; renderPrices(); } });
  $('#prSearch').addEventListener('input', (e) => { UI.prQ = e.target.value; renderPrices(); });
  $('#prOnlyMissing').addEventListener('change', (e) => { UI.prMissing = e.target.checked; renderPrices(); });
  $('#prTable').addEventListener('input', (e) => {
    const inp = e.target.closest('input[data-k]');
    if (!inp) return;
    const row = inp.closest('.prow'), it = ITEMS[+row.dataset.i];
    setP(it, { [inp.dataset.k]: toNum(inp.value) });
    row.classList.add('changed');
    const p = getP(it);
    const oldInp = row.querySelector('[data-k="oldPrice"]');
    oldInp.classList.toggle('bad', p.oldPrice != null && p.price != null && p.oldPrice <= p.price);
    renderNavBadges();
  });
  $('#prTable').addEventListener('click', (e) => {
    const o = e.target.closest('[data-open]');
    if (o) { openItem(ITEMS[+o.dataset.open]); return; }
    const t = e.target.closest('[data-t]');
    if (!t) return;
    const row = t.closest('.prow'), it = ITEMS[+row.dataset.i];
    const k = t.dataset.t;
    setP(it, { [k]: !getP(it)[k] });
    row.classList.add('changed');
    const p = getP(it);
    if (k === 'featured') { t.classList.toggle('on', !!p.featured); t.setAttribute('aria-pressed', String(!!p.featured)); }
    else { t.classList.toggle('off', !!p.hidden); t.innerHTML = icon(p.hidden ? 'eyeoff' : 'eye'); t.title = p.hidden ? 'مخفية' : 'ظاهرة'; }
  });

  /* ---------- تعديل جماعي ---------- */
  $('#btnBulk').addEventListener('click', () => {
    $('#bkScope').innerHTML = `<option value="view">القطع الظاهرة في الجدول الآن (${num(priceView().length)})</option><option value="*">كل القطع (${num(ITEMS.length)})</option>` + CATS.map((c) => `<option value="${esc(c)}">${esc(c)} (${num(ITEMS.filter((i) => i.category === c).length)})</option>`).join('');
    $('#bkVal').value = '';
    bulkUpdate();
    openSheet('bulkSheet');
  });
  const bkAct = () => ($('#bkAct input:checked') || {}).value;
  function bulkTargets() {
    const s = $('#bkScope').value;
    return s === 'view' ? priceView() : s === '*' ? ITEMS : ITEMS.filter((i) => i.category === s);
  }
  function bulkUpdate() {
    const a = bkAct();
    $('#bkValWrap').hidden = a === 'unsale';
    $('#bkValLbl').textContent = a === 'set' ? `السعر (${SHOP.currency || 'ر.ي'})` : a === 'adjust' ? 'النسبة ٪ (سالب للتخفيض)' : 'نسبة الخصم ٪';
    const t = bulkTargets();
    const priced = t.filter((it) => getP(it).price != null).length;
    const onSale = t.filter((it) => isSale(getP(it))).length;
    const n = a === 'set' ? t.length : a === 'unsale' ? onSale : priced;
    let txt = `سيتغيّر سعر ${plural(n, 'قطعة', 'قطع', 'قطعة')}`;
    if (a !== 'set' && a !== 'unsale' && priced < t.length) txt += ` (القطع بلا سعر لن تتأثر)`;
    $('#bkPrev').textContent = txt + '. التغيير لا يُنشر حتى تضغط «حفظ ونشر».';
  }
  $('#bulkSheet').addEventListener('input', bulkUpdate);
  $('#bulkSheet').addEventListener('change', bulkUpdate);
  $('#bkApply').addEventListener('click', () => {
    const a = bkAct(), v = toNum($('#bkVal').value), step = +$('#bkRound').value;
    const round = (x) => Math.max(step, Math.round(x / step) * step);
    if (a !== 'unsale' && (v == null || v === 0 && a !== 'adjust')) { toast('اكتب القيمة أولًا', true); return; }
    if (a === 'sale' && (v <= 0 || v >= 95)) { toast('نسبة الخصم بين ١ و ٩٤', true); return; }
    let n = 0;
    for (const it of bulkTargets()) {
      const p = getP(it);
      if (a === 'set') { setP(it, { price: v, oldPrice: null }); n++; }
      else if (a === 'unsale') { if (isSale(p)) { setP(it, { price: p.oldPrice, oldPrice: null }); n++; } }
      else if (p.price != null) {
        if (a === 'sale') { const base = isSale(p) ? p.oldPrice : p.price; setP(it, { oldPrice: base, price: round(base * (1 - v / 100)) }); }
        else { const sign = $('#bkVal').value.trim().startsWith('-') ? -1 : 1; setP(it, { price: round(p.price * (1 + sign * v / 100)), oldPrice: p.oldPrice != null ? round(p.oldPrice * (1 + sign * v / 100)) : null }); }
        n++;
      }
    }
    closeSheet('bulkSheet');
    render();
    toast(`طُبّق على ${plural(n, 'قطعة', 'قطع', 'قطعة')}، اضغط «حفظ ونشر»`);
  });

  /* ═══════════ العروض والكوبونات ═══════════ */
  let cdTimer = null;
  function renderOffers() {
    const pr = SHOP.promo || {};
    $('#promoOn').checked = !!pr.active;
    $('#promoText').value = pr.text || '';
    $('#promoEnds').value = pr.ends ? pr.ends.slice(0, 16) : '';
    renderPromoPreview();
    $('#tiersOn').checked = SHOP.tiersOn !== false && (SHOP.tiers || []).length > 0;
    $$('#tiersBox [data-t]').forEach((inp) => { const t = (SHOP.tiers || [])[+inp.dataset.t]; inp.value = t ? t[inp.dataset.f] : ''; });
    const now = new Date().toISOString().slice(0, 10);
    const list = Object.entries(SHOP.coupons || {});
    $('#coupons').innerHTML = list.map(([code, c]) => {
      const exp = c.expires && c.expires < now;
      const st = exp ? ['exp', 'منتهي'] : c.active === false ? ['off', 'متوقف'] : ['on', 'فعّال'];
      return `<div class="ticket${st[0] !== 'on' ? ' inactive' : ''}" data-code="${esc(code)}">
        <div class="tk-main">
          <span class="tk-state ${st[0]}">${st[1]}</span>
          <span class="tk-code">${esc(code)}</span>
          <span class="tk-meta">${c.min ? `للطلبات من ${money(c.min)}` : 'بدون حد أدنى'}${c.expires ? ` · حتى ${esc(new Date(c.expires + 'T00:00').toLocaleDateString('ar-u-nu-arab', { day: 'numeric', month: 'long' }))}` : ''}</span>
          <div class="tk-actions">
            <button class="icon-btn" data-cp="edit" title="تعديل">${icon('edit')}</button>
            <button class="icon-btn" data-cp="copy" title="نسخ الكود">${icon('copy')}</button>
            <button class="icon-btn" data-cp="share" title="مشاركة">${icon('share')}</button>
          </div>
        </div>
        <div class="tk-val"><b>${c.type === 'percent' ? `${num(c.value)}٪` : num(c.value)}</b><small>${c.type === 'percent' ? 'خصم' : (SHOP.currency || 'ر.ي') + ' خصم'}</small></div>
      </div>`;
    }).join('') + `<button class="ticket new-coupon" id="newCouponTile">${icon('plus')} كوبون جديد</button>`;
  }
  function renderPromoPreview() {
    const on = $('#promoOn').checked, text = $('#promoText').value.trim(), ends = $('#promoEnds').value;
    clearInterval(cdTimer);
    const box = $('#promoPreview');
    if (!on || !text) { box.innerHTML = `<p class="pp-off">${on ? 'اكتب نص العرض لتظهر المعاينة.' : 'الشريط متوقف، فعّله ليظهر أعلى المتجر.'}</p>`; return; }
    const tick = () => {
      const left = ends ? new Date(ends) - Date.now() : null;
      let cd = '';
      if (left != null) {
        if (left <= 0) cd = '<span>انتهى</span>';
        else { const d = Math.floor(left / 864e5), h = Math.floor(left / 36e5) % 24, m = Math.floor(left / 6e4) % 60, s = Math.floor(left / 1e3) % 60; cd = [d && `${d}d`, `${h}h`, `${m}m`, `${s}s`].filter(Boolean).map((x) => `<span>${x}</span>`).join(''); }
      }
      box.innerHTML = `<div class="pp-bar"><span>✦ ${esc(text)}</span>${cd ? `<span class="cd">${cd}</span>` : ''}</div>`;
    };
    tick();
    if (ends) cdTimer = setInterval(() => { if (UI.view === 'offers') tick(); else clearInterval(cdTimer); }, 1000);
  }
  ['promoOn', 'promoText', 'promoEnds'].forEach((id) => $('#' + id).addEventListener('input', () => {
    SHOP.promo = { active: $('#promoOn').checked, text: $('#promoText').value.trim(), ends: $('#promoEnds').value || '' };
    markDirty('promo');
    renderPromoPreview();
  }));
  function readTiers() {
    const rows = [0, 1, 2].map((i) => ({ min: toNum($(`#tiersBox [data-t="${i}"][data-f="min"]`).value), pct: toNum($(`#tiersBox [data-t="${i}"][data-f="pct"]`).value) }))
      .filter((t) => t.min > 0 && t.pct > 0 && t.pct < 100).sort((a, b) => a.min - b.min);
    SHOP.tiers = rows;
    SHOP.tiersOn = $('#tiersOn').checked;
    markDirty('tiers');
  }
  $('#tiersOn').addEventListener('input', readTiers);
  $('#tiersBox').addEventListener('input', readTiers);
  $('#coupons').addEventListener('click', async (e) => {
    if (e.target.closest('#newCouponTile')) { openCoupon(null); return; }
    const b = e.target.closest('[data-cp]');
    if (!b) return;
    const code = b.closest('[data-code]').dataset.code, c = SHOP.coupons[code];
    if (b.dataset.cp === 'edit') openCoupon(code);
    else {
      const val = c.type === 'percent' ? `خصم ${num(c.value)}٪` : `خصم ${money(c.value)}`;
      const text = b.dataset.cp === 'copy' ? code : `✿ ${val} على قطع ${SITE.brandName || 'ELORA'} المصنوعة يدويًا\nاستخدم الكود: ${code}${c.min ? `\nللطلبات من ${money(c.min)}` : ''}${c.expires ? `\nحتى ${new Date(c.expires + 'T00:00').toLocaleDateString('ar-u-nu-arab', { day: 'numeric', month: 'long' })}` : ''}\n${siteURL()}`;
      try {
        if (b.dataset.cp === 'share' && navigator.share) await navigator.share({ text });
        else { await navigator.clipboard.writeText(text); toast(b.dataset.cp === 'copy' ? 'تم نسخ الكود' : 'تم نسخ نص المشاركة'); }
      } catch { /* أُلغيت */ }
    }
  });
  $('#btnNewCoupon').addEventListener('click', () => openCoupon(null));

  let cpType = 'percent';
  function openCoupon(code) {
    editingCoupon = code;
    const c = code ? SHOP.coupons[code] : { type: 'percent', value: 10, min: 0, active: true };
    $('#cpTitle').textContent = code ? 'تعديل الكوبون' : 'كوبون جديد';
    $('#cpCode').value = code || '';
    setCpType(c.type || 'percent');
    $('#cpVal').value = c.value ?? '';
    $('#cpMin').value = c.min || '';
    $('#cpExp').value = c.expires || '';
    $('#cpLabel').value = c.label || '';
    $('#cpActive').checked = c.active !== false;
    $('#cpDelete').hidden = !code;
    cpPreview();
    openSheet('couponSheet');
    setTimeout(() => (code ? $('#cpVal') : $('#cpCode')).focus(), 80);
  }
  function setCpType(t) {
    cpType = t;
    $$('#cpType button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.v === t)));
    $('#cpValLbl').textContent = t === 'percent' ? 'النسبة ٪' : `المبلغ (${SHOP.currency || 'ر.ي'})`;
  }
  $('#cpType').addEventListener('click', (e) => { const b = e.target.closest('[data-v]'); if (b) { setCpType(b.dataset.v); cpPreview(); } });
  $('#cpGen').addEventListener('click', () => {
    const words = ['ELORA', 'PEARL', 'LOVE', 'GIFT', 'SHINE', 'GLOW'];
    const v = toNum($('#cpVal').value) || 10;
    $('#cpCode').value = words[Math.floor(Math.random() * words.length)] + (cpType === 'percent' ? v : Math.floor(Math.random() * 90 + 10));
    cpPreview();
  });
  function cpPreview() {
    const code = $('#cpCode').value.toUpperCase().replace(/[^A-Z0-9_-]/g, '');
    if ($('#cpCode').value !== code) $('#cpCode').value = code;
    const v = toNum($('#cpVal').value) || 0, min = toNum($('#cpMin').value);
    const autoLbl = cpType === 'percent' ? `خصم ${num(v)}٪` : `خصم ${money(v)}`;
    $('#cpLabel').placeholder = autoLbl;
    $('#cpPreview').innerHTML = `<div class="tk-main"><span class="tk-state ${$('#cpActive').checked ? 'on">فعّال' : 'off">متوقف'}</span><span class="tk-code">${esc(code || 'CODE')}</span><span class="tk-meta">${min ? `للطلبات من ${money(min)}` : 'بدون حد أدنى'}</span></div>
      <div class="tk-val"><b>${cpType === 'percent' ? `${num(v)}٪` : num(v)}</b><small>${cpType === 'percent' ? 'خصم' : (SHOP.currency || 'ر.ي') + ' خصم'}</small></div>`;
  }
  $('#couponSheet').addEventListener('input', cpPreview);
  $('#cpSave').addEventListener('click', () => {
    const code = $('#cpCode').value.trim().toUpperCase();
    const v = toNum($('#cpVal').value);
    if (!/^[A-Z0-9_-]{3,20}$/.test(code)) { toast('الكود من ٣ إلى ٢٠ حرفًا إنجليزيًا أو رقمًا', true); return; }
    if (!v || (cpType === 'percent' && v > 90)) { toast(cpType === 'percent' ? 'النسبة بين ١ و ٩٠' : 'اكتب مبلغ الخصم', true); return; }
    if (code !== editingCoupon && SHOP.coupons[code]) { toast('هذا الكود موجود مسبقًا', true); return; }
    if (editingCoupon && editingCoupon !== code) delete SHOP.coupons[editingCoupon];
    const c = { type: cpType, value: v, min: toNum($('#cpMin').value) || 0, label: $('#cpLabel').value.trim() || (cpType === 'percent' ? `خصم ${num(v)}٪` : `خصم ${money(v)}`) };
    if ($('#cpExp').value) c.expires = $('#cpExp').value;
    if (!$('#cpActive').checked) c.active = false;
    SHOP.coupons[code] = c;
    markDirty('c:' + code);
    closeSheet('couponSheet');
    renderOffers();
    toast('حُفظ الكوبون، اضغط «حفظ ونشر» لنشره');
  });
  $('#cpDelete').addEventListener('click', () => {
    if (!editingCoupon || !confirm(`حذف الكوبون ${editingCoupon}؟`)) return;
    delete SHOP.coupons[editingCoupon];
    markDirty('c:' + editingCoupon);
    closeSheet('couponSheet');
    renderOffers();
  });

  /* ═══════════ التوصيل والدفع ═══════════ */
  const PAY_SUGGEST = ['الدفع عند الاستلام', 'تحويل عبر محفظة إلكترونية', 'حوالة عبر الصرافة', 'تحويل بنكي'];
  function renderShipping() {
    const zs = SHOP.deliveryZones || [];
    $('#zones').innerHTML = zs.length ? zs.map((z, i) => `<div class="zone" data-z="${i}">
      <input type="text" data-zf="group" value="${esc(z.group || '')}" placeholder="المحافظة / الدولة" list="zoneGroups">
      <input type="text" data-zf="name" value="${esc(z.name)}" placeholder="المنطقة، مثل: داخل المدينة">
      <span class="inp money"><input type="text" inputmode="numeric" data-zf="fee" value="${z.fee ?? ''}" placeholder="عند التأكيد"><em class="cur">${esc(SHOP.currency || 'ر.ي')}</em></span>
      <button class="icon-btn" data-zdel="${i}" aria-label="حذف">${icon('trash')}</button>
      <input type="text" data-zf="note" class="zone-note-in" value="${esc(z.note || '')}" placeholder="ملاحظة للزبون (اختياري): المدة أو طريقة التوصيل، مثل «٢–٤ أيام عبر شركة نقل»">
      <label class="zone-free"><input type="checkbox" data-zf="free" ${z.free !== false ? 'checked' : ''}> يشملها التوصيل المجاني</label>
    </div>`).join('') + `<datalist id="zoneGroups">${[...new Set(zs.map((z) => z.group).filter(Boolean))].map((g) => `<option value="${esc(g)}">`).join('')}</datalist>`
      : '<p class="zone-empty">لا توجد مناطق بعد. ابدأ بالاقتراحات أدناه، ثم عدّل الأسماء والرسوم.</p>';
    $('#zoneQuick').innerHTML = ZONE_SUGGEST.map((s, i) => `<button type="button" data-zq="${i}">＋ ${esc(s.label)}</button>`).join('');
    $('#freeOver').value = SHOP.freeShippingOver || '';
    $('#makeDays').value = SHOP.makeDays || '';
    $('#pauseOn').checked = !!SHOP.pause?.on;
    $('#pauseText').value = SHOP.pause?.text || '';
    $('#giftOn').checked = !!SHOP.giftWrap?.enabled;
    $('#giftFee').value = SHOP.giftWrap?.fee || '';
    const pays = SHOP.payments || [];
    $('#payTags').innerHTML = pays.length ? pays.map((p, i) => `<span class="tag">${esc(p)}<button data-pdel="${i}" aria-label="حذف">${icon('close')}</button></span>`).join('') : '<span class="hint">لم تُضف طرق دفع بعد.</span>';
    $('#payQuick').innerHTML = PAY_SUGGEST.filter((p) => !pays.includes(p)).map((p) => `<button type="button" data-pq="${esc(p)}">＋ ${esc(p)}</button>`).join('');
  }
  $('#addZone').addEventListener('click', () => { const last = (SHOP.deliveryZones || []).slice(-1)[0]; (SHOP.deliveryZones ||= []).push(last?.group ? { group: last.group, name: '', fee: null } : { name: '', fee: null }); markDirty('ship'); renderShipping(); $$('#zones [data-zf="name"]').pop()?.focus(); });
  $('#zones').addEventListener('input', (e) => {
    const f = e.target.dataset.zf;
    if (!f) return;
    const z = SHOP.deliveryZones[+e.target.closest('[data-z]').dataset.z];
    if (f === 'fee') z.fee = e.target.value.trim() === '' ? null : (toNum(e.target.value) ?? 0);   // فارغ = يُحدَّد عند التأكيد
    else if (f === 'free') { if (e.target.checked) delete z.free; else z.free = false; }
    else if (e.target.value.trim()) z[f] = e.target.value; else delete z[f];
    markDirty('ship');
  });
  // اقتراحات تبدأ بها (الرسوم تكتبها أنت؛ الفارغة = تُحدَّد مع الزبون)
  const ZONE_SUGGEST = [
    { label: 'داخل مدينتي', z: { group: '', name: 'داخل المدينة', fee: null } },
    { label: 'ضواحي المدينة', z: { group: '', name: 'ضواحي وأطراف المدينة', fee: null } },
    { label: 'محافظة أخرى (شركة نقل)', z: { group: 'محافظات أخرى', name: 'اكتب اسم المحافظة', fee: null, note: 'عبر شركة نقل، ٢–٤ أيام', free: false } },
    { label: 'خارج اليمن', z: { group: 'خارج اليمن', name: 'اكتب اسم الدولة', fee: null, note: 'شحن دولي، نتفق على الطريقة والسعر', free: false } },
  ];
  $('#zoneQuick').addEventListener('click', (e) => {
    const b = e.target.closest('[data-zq]');
    if (!b) return;
    const s = ZONE_SUGGEST[+b.dataset.zq].z;
    const z = { ...s }; if (!z.group) delete z.group;
    (SHOP.deliveryZones ||= []).push(z);
    markDirty('ship'); renderShipping();
    $$('#zones [data-zf="name"]').pop()?.select();
  });
  $('#zones').addEventListener('click', (e) => { const b = e.target.closest('[data-zdel]'); if (b) { SHOP.deliveryZones.splice(+b.dataset.zdel, 1); markDirty('ship'); renderShipping(); } });
  $('#freeOver').addEventListener('input', (e) => { SHOP.freeShippingOver = toNum(e.target.value) || 0; markDirty('ship'); });
  $('#makeDays').addEventListener('input', (e) => { SHOP.makeDays = toNum(e.target.value) || 0; markDirty('ship'); });
  ['pauseOn', 'pauseText'].forEach((id) => $('#' + id).addEventListener('input', () => {
    SHOP.pause = { on: $('#pauseOn').checked, text: $('#pauseText').value.trim() };
    if (!SHOP.pause.on && !SHOP.pause.text) delete SHOP.pause;
    markDirty('ship');
  }));
  ['giftOn', 'giftFee'].forEach((id) => $('#' + id).addEventListener('input', () => { SHOP.giftWrap = { enabled: $('#giftOn').checked, fee: toNum($('#giftFee').value) || 0 }; markDirty('ship'); }));
  function addPay(p) { p = p.trim(); if (!p) return; SHOP.payments ||= []; if (!SHOP.payments.includes(p)) SHOP.payments.push(p); markDirty('ship'); renderShipping(); }
  $('#payAdd').addEventListener('submit', (e) => { e.preventDefault(); const i = e.target.querySelector('input'); addPay(i.value); i.value = ''; });
  $('#payQuick').addEventListener('click', (e) => { const b = e.target.closest('[data-pq]'); if (b) addPay(b.dataset.pq); });
  $('#payTags').addEventListener('click', (e) => { const b = e.target.closest('[data-pdel]'); if (b) { SHOP.payments.splice(+b.dataset.pdel, 1); markDirty('ship'); renderShipping(); } });

  /* ═══════════ واجهة المتجر ═══════════ */
  function renderFront() {
    $('#heroTitle').value = SHOP.heroTitle || '';
    $('#heroAccent').value = SHOP.heroAccent || '';
    heroPreview();
    $('#announces').value = (SHOP.announcements || []).join('\n');
    $('#perks').value = (SHOP.perks || []).join('\n');
    const st = SHOP.story || {};
    $('#storyTitle').value = st.title || '';
    $('#storyText').value = st.text || '';
    $('#storyImage').innerHTML = '<option value="">تلقائي (قطعة مميّزة)</option>' + ITEMS.map((it) => `<option${st.image === it.title ? ' selected' : ''}>${esc(it.title)}</option>`).join('');
    renderQA('faqList', SHOP.faq || [], 'q', 'a', 'السؤال', 'الجواب');
    renderQA('testiList', SHOP.testimonials || [], 'name', 'text', 'اسم الزبون', 'ماذا قال؟');
  }
  function heroPreview() {
    $('#heroPreview').innerHTML = `<h4>${esc($('#heroTitle').value || 'قطعٌ تُصنع يدويًا بحب')}<em>${esc($('#heroAccent').value || 'لتكتمل بها أناقتك')}</em></h4>`;
  }
  function renderQA(id, arr, k1, k2, p1, p2) {
    $('#' + id).innerHTML = arr.length ? arr.map((x, i) => `<div class="qa" data-i="${i}"><div><input type="text" data-k="${k1}" value="${esc(x[k1])}" placeholder="${p1}"><textarea rows="2" data-k="${k2}" placeholder="${p2}">${esc(x[k2])}</textarea></div><button class="icon-btn" data-del="${i}" aria-label="حذف">${icon('trash')}</button></div>`).join('') : '<p class="hint">القائمة فارغة.</p>';
  }
  ['heroTitle', 'heroAccent'].forEach((id) => $('#' + id).addEventListener('input', (e) => { SHOP[id] = e.target.value.trim(); markDirty('front'); heroPreview(); }));
  $('#announces').addEventListener('input', (e) => { SHOP.announcements = e.target.value.split('\n').map((s) => s.trim()).filter(Boolean); markDirty('front'); });
  $('#perks').addEventListener('input', (e) => { SHOP.perks = e.target.value.split('\n').map((s) => s.trim()).filter(Boolean); markDirty('front'); });
  ['storyTitle', 'storyText', 'storyImage'].forEach((id) => $('#' + id).addEventListener('input', () => {
    SHOP.story = { title: $('#storyTitle').value.trim(), text: $('#storyText').value.trim(), image: $('#storyImage').value };
    markDirty('front');
  }));
  function bindQA(id, key, blank) {
    $('#' + id).addEventListener('input', (e) => { const row = e.target.closest('.qa'); if (!row) return; SHOP[key][+row.dataset.i][e.target.dataset.k] = e.target.value; markDirty('front'); });
    $('#' + id).addEventListener('click', (e) => { const b = e.target.closest('[data-del]'); if (b) { SHOP[key].splice(+b.dataset.del, 1); markDirty('front'); renderFront(); } });
    return () => { (SHOP[key] ||= []).push({ ...blank }); markDirty('front'); renderFront(); $$(`#${id} input`).pop()?.focus(); };
  }
  $('#addFaq').addEventListener('click', bindQA('faqList', 'faq', { q: '', a: '' }));
  $('#addTesti').addEventListener('click', bindQA('testiList', 'testimonials', { name: '', text: '' }));

  /* ═══════════ الطلبات ═══════════ */
  function renderOrders() {
    $('#orderEp').value = SHOP.orderEndpoint || '';
    // رابط الجدول يُحفظ على هذا الجهاز فقط (لا يُنشر في ملفات المتجر العامة)
    if (SHOP._admin?.ordersSheet && !store.get('elora-sheet', '')) store.set('elora-sheet', SHOP._admin.ordersSheet);
    if (SHOP._admin) { delete SHOP._admin; markDirty('orders'); }
    $('#sheetUrl').value = store.get('elora-sheet', '');
    renderOrdersLink();
    const st = $('#epStatus');
    st.className = 'status-dot' + (SHOP.orderEndpoint ? '' : ' bad');
    st.textContent = SHOP.orderEndpoint ? 'غير مختبر' : 'غير مربوط';
  }
  $('#orderEp').addEventListener('input', (e) => { SHOP.orderEndpoint = e.target.value.trim(); markDirty('orders'); });
  $('#sheetUrl').addEventListener('input', (e) => { const v = e.target.value.trim(); store.set('elora-sheet', /^https:\/\/docs\.google\.com\//.test(v) ? v : ''); renderOrdersLink(); });
  function renderOrdersLink() { const s = store.get('elora-sheet', ''); $('#openSheet').hidden = !s; if (s) $('#openSheet').href = s; }
  async function pingEndpoint(ids) {
    const u = $('#orderEp').value.trim();
    if (!/^https:\/\/script\.google(usercontent)?\.com\//.test(u)) throw new Error('الرابط يجب أن يكون رابط Web app من Google');
    const r = await fetch(u + (ids ? `?ids=${encodeURIComponent(ids)}` : ''));
    const j = await r.json();
    if (!j.ok) throw new Error('رد غير متوقع');
    return j;
  }
  $('#testEp').addEventListener('click', async () => {
    const st = $('#epStatus');
    st.className = 'status-dot'; st.textContent = 'جارٍ الاختبار…';
    try { await pingEndpoint(); st.className = 'status-dot ok'; st.textContent = 'متصل ويعمل'; }
    catch (e) { st.className = 'status-dot bad'; st.textContent = 'لا يستجيب'; toast(e.message, true); }
  });
  $('#trackForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = $('#trackId').value.trim().toUpperCase();
    const res = $('#trackRes');
    if (!/^EL-\d{6}-[A-Z0-9]{4,8}$/.test(id)) { res.textContent = 'رقم الطلب بصيغة EL-261121-XXXXX'; return; }
    res.textContent = 'جارٍ البحث…';
    try { const j = await pingEndpoint(id); res.textContent = j.statuses?.[id] ? `حالة الطلب ${id}: «${j.statuses[id]}»` : 'لم يُعثر على هذا الطلب في الجدول.'; }
    catch (err) { res.textContent = err.message; }
  });

  /* ═══════════ الإعدادات ═══════════ */
  function renderSettings() {
    $('#sBrand').value = SITE.brandName || '';
    $('#sTagline').value = SITE.tagline || '';
    $('#sWa').value = SITE.whatsapp || '';
    $('#sWaMsg').value = SITE.whatsappMessage || '';
    $('#sIg').value = SITE.instagram || '';
    $('#sTheme').value = SITE.defaultTheme || 'light';
    $('#sCur').value = SHOP.currency || '';
    $('#sDigits').value = SHOP.digits || 'arab';
    $('#sSiteUrl').value = SITE.siteUrl || '';
    $('#sTokenExp').value = SITE.tokenExpires || '';
    $('#sLogoPrev').src = stagedLogo ? stagedLogo.url : rawURL(SITE.logo || 'assets/logo.png') + '?t=' + Date.now();
    waCheck();
  }
  const normalizeWa = (raw) => { let d = String(raw || '').replace(/[٠-٩]/g, (c) => '٠١٢٣٤٥٦٧٨٩'.indexOf(c)).replace(/\D/g, ''); if (d.startsWith('00')) d = d.slice(2); return d; };
  function waCheck() {
    const el = $('#sWaCheck'), d = normalizeWa($('#sWa').value);
    if (!d) { el.hidden = true; return; }
    el.hidden = false;
    const bad = /^0/.test(d) || d.length < 10 || d.length > 15;
    el.className = 'wa-check' + (bad ? ' bad' : '');
    el.textContent = /^0/.test(d) ? 'احذف الصفر وابدأ برمز الدولة (مثال: 967)' : bad ? `الرقم ${num(d.length)} خانة، المتوقع بين ١٠ و ١٥ مع رمز الدولة` : `✓ تصل الطلبات إلى wa.me/${d}`;
  }
  const siteField = (id, key, fn = (v) => v.trim()) => $('#' + id).addEventListener('input', (e) => { SITE[key] = fn(e.target.value); markDirty('site'); if (id === 'sWa') waCheck(); });
  siteField('sBrand', 'brandName');
  siteField('sTagline', 'tagline');
  siteField('sWa', 'whatsapp', normalizeWa);
  siteField('sWaMsg', 'whatsappMessage', (v) => v);
  siteField('sIg', 'instagram', (v) => v.trim().replace(/^@/, ''));
  siteField('sTheme', 'defaultTheme');
  siteField('sSiteUrl', 'siteUrl', (v) => { v = v.trim(); return v && !v.endsWith('/') ? v + '/' : v; });
  siteField('sTokenExp', 'tokenExpires');
  $('#sCur').addEventListener('input', (e) => { SHOP.currency = e.target.value.trim() || 'ر.ي'; markDirty('site'); renderNavBadges(); });
  $('#sDigits').addEventListener('input', (e) => { SHOP.digits = e.target.value; NF = new Intl.NumberFormat(SHOP.digits === 'latn' ? 'en' : 'ar-u-nu-arab'); markDirty('site'); });
  $('#sLogoPick').addEventListener('click', () => $('#sLogoFile').click());
  $('#sLogoFile').addEventListener('change', async (e) => {
    const f = e.target.files[0];
    e.target.value = '';
    if (!f) return;
    try { busy('جارٍ تجهيز الشعار…'); if (stagedLogo) URL.revokeObjectURL(stagedLogo.url); stagedLogo = await prepLogo(f); $('#sLogoPrev').src = stagedLogo.url; markDirty('site'); }
    catch (err) { toast(err.message, true); } finally { idle(); }
  });

  /* ═══════════ عام ═══════════ */
  function syncTheme() {
    const dark = document.documentElement.dataset.theme === 'dark';
    $('#themeBtn use').setAttribute('href', dark ? '#i-sun' : '#i-moon');
  }
  $('#themeBtn').addEventListener('click', () => {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    store.set('elora:theme', next);
    syncTheme();
  });
  $('#btnRefresh').addEventListener('click', async () => {
    if (changes.size && !confirm('التحديث سيتجاهل التعديلات غير المحفوظة. متابعة؟')) return;
    try { busy('جارٍ التحديث…'); await loadItems(); await loadConfig(); render(); toast('تم التحديث'); }
    catch (e) { toast(e.message, true); } finally { idle(); }
  });
  $('#btnLogout').addEventListener('click', () => {
    if (!confirm('سيُحذف مفتاح الوصول من هذا الجهاز. متابعة؟')) return;
    localStorage.removeItem(KEY);
    location.reload();
  });

  /* ═══════════ الدخول ═══════════ */
  function guessRepo() {
    const h = location.hostname;
    // على Cloudflare Pages أو دومين خاص: مستودع المتجر المعروف
    if (!h.endsWith('.github.io')) return /^(localhost|127\.0\.0\.1|\[::1\])$/.test(h) || !h ? { owner: '', repo: '' } : { owner: 'elora-shop', repo: 'elora-shop.github.io' };
    const owner = h.split('.')[0];
    const seg = location.pathname.split('/').filter(Boolean)[0];
    return { owner, repo: seg && !seg.includes('.html') ? seg : h };
  }
  async function loginArt() {
    try {
      const d = await fetch('data.json?v=' + Date.now()).then((r) => r.json());
      const items = (d.items || []).filter((i) => i.type !== 'video').slice(0, 6);
      if (!items.length) return;
      const box = $('#laArch');
      box.innerHTML = items.map((i) => `<img src="${esc(i.src)}" alt="">`).join('');
      const imgs = $$('img', box);
      let k = 0;
      imgs[0].classList.add('on');
      setInterval(() => { imgs[k].classList.remove('on'); k = (k + 1) % imgs.length; imgs[k].classList.add('on'); }, 4500);
    } catch { /* بلا صور */ }
  }
  function showLogin(prev, errMsg) {
    const g = guessRepo();
    const owner = prev?.owner || g.owner, repo = prev?.repo || g.repo;
    $('#fOwner').value = owner;
    $('#fRepo').value = repo;
    $('#repoChipTxt').textContent = owner && repo ? `${owner} / ${repo}` : '—';
    $$('.own-name').forEach((el) => { el.textContent = owner || 'اسم المنظمة'; });
    const needRepo = !owner || !repo;
    $('#repoChip').hidden = needRepo;
    $('#repoFields').hidden = !needRepo;
    if (errMsg) { $('#loginErr').innerHTML = `${icon('alert')}<span>${esc(errMsg)}</span>`; $('#loginErr').hidden = false; }
    $('#login').hidden = false;
    $('#app').hidden = true;
    loginArt();
    setTimeout(() => $('#fToken').focus(), 100);
  }
  $('#repoEdit').addEventListener('click', () => { $('#repoChip').hidden = true; $('#repoFields').hidden = false; $('#fOwner').focus(); });
  $('#tokEye').addEventListener('click', () => {
    const t = $('#fToken'), show = t.type === 'password';
    t.type = show ? 'text' : 'password';
    $('#tokEye use').setAttribute('href', show ? '#i-eyeoff' : '#i-eye');
  });
  $('#tokPaste').addEventListener('click', async () => {
    try { $('#fToken').value = (await navigator.clipboard.readText()).trim(); $('#fToken').focus(); }
    catch { toast('الصق المفتاح يدويًا (اضغط مطوّلًا ثم «لصق»)', true); }
  });
  $('#loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const owner = $('#fOwner').value.trim().replace(/^@/, ''), repo = $('#fRepo').value.trim(), token = $('#fToken').value.trim();
    const err = $('#loginErr');
    err.hidden = true;
    const fail = (m) => { err.innerHTML = `${icon('alert')}<span>${esc(m)}</span>`; err.hidden = false; $('#loginForm').classList.remove('shake'); void $('#loginForm').offsetWidth; $('#loginForm').classList.add('shake'); };
    if (!owner || !repo) { $('#repoChip').hidden = true; $('#repoFields').hidden = false; fail('اكتب اسم الحساب واسم المستودع.'); return; }
    if (!token) { fail('الصق مفتاح الوصول أولًا.'); return; }
    CFG = { owner, repo, token, branch: 'main' };
    try {
      busy('جارٍ التحقق…');
      const info = await gh(repoBase());
      CFG.branch = info.default_branch || 'main';
      if (!info.permissions?.push) throw Object.assign(new Error('المفتاح لا يملك صلاحية التعديل. اختر Contents ← Read and write.'), { status: 0 });
      localStorage.setItem(KEY, JSON.stringify(CFG));
      await start();
    } catch (ex) {
      CFG = null;
      fail(ex.status === 401 ? 'المفتاح غير صحيح أو انتهت صلاحيته.' : ex.status === 404 ? 'لم يُعثر على المستودع، أو المفتاح لا يملك صلاحية عليه.' : ex.message);
    } finally { idle(); }
  });

  async function start() {
    busy('جارٍ تحميل المتجر…');
    try {
      await Promise.all([loadItems(), loadConfig()]);
      $('#login').hidden = true;
      $('#app').hidden = false;
      $('#viewStore').href = siteURL();
      syncTheme();
      go(location.hash.slice(1) || 'home');
      const wa = normalizeWa(SITE.whatsapp);
      if (wa.length < 10 || wa.length > 15) {
        const b = $('#banner');
        b.className = 'banner warn';
        b.innerHTML = `${icon('alert')} رقم واتساب غير مضبوط، والطلبات عبر واتساب لن تعمل. <button class="link-btn" data-go="settings">اضبطه الآن</button>`;
        b.hidden = false;
      }
    } finally { idle(); }
  }

  (async function boot() {
    syncTheme();
    try { CFG = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { CFG = null; }
    if (!CFG || !CFG.token) { showLogin(null); return; }
    try { await start(); }
    catch (e) {
      const prev = CFG;
      CFG = null;
      showLogin(prev, e.status === 401 ? 'انتهت صلاحية المفتاح. أنشئ مفتاحًا جديدًا والصقه هنا.' : 'تعذّر الاتصال: ' + e.message);
    }
  })();
})();
