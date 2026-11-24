/**
 * ELORA — استقبال طلبات المتجر في جدول Google
 * ------------------------------------------------------------
 * ماذا يفعل هذا الكود؟
 *   • يستقبل كل طلب من المتجر ويضيفه صفًا جديدًا في ورقة «الطلبات».
 *   • يرسل لك بريد تنبيه منسّقًا مع كل طلب جديد.
 *   • يتيح للزبون معرفة «حالة طلبه» من المتجر عندما تغيّرها أنت في الجدول.
 *
 * طريقة التركيب: راجع ملف «ربط-الطلبات.md» بجانب هذا الملف.
 */

// ================== الإعدادات ==================
const NOTIFY_EMAIL = '';            // اتركه فارغًا ليصل التنبيه إلى بريد حسابك في Google
const STORE_NAME   = 'ELORA';
const SHEET_NAME   = 'الطلبات';
const STATUSES     = ['جديد', 'تم التأكيد', 'قيد التجهيز', 'تم الشحن', 'تم التسليم', 'ملغي'];
// معرّف الجدول: الجزء بين /d/ و /edit في رابطه. يلزم فقط إن أنشأت المشروع من script.google.com بدل قائمة «Extensions» في الجدول.
const SPREADSHEET_ID = '';
// رابط ملف أسعار المتجر: يعيد الكود حساب المبلغ منه ليكشف أي تلاعب بالأسعار
const SHOP_URL = 'https://elora-shop.pages.dev/shop.json';
// حماية من سيل الطلبات الوهمية
const MAX_PER_PHONE_HOUR = 5;      // أقصى عدد طلبات من الرقم نفسه خلال ساعة
const MAX_PER_10_MIN     = 30;     // أقصى عدد طلبات من الجميع خلال ١٠ دقائق
// ===============================================

// الأعمدة الجديدة تُضاف في النهاية دائمًا حتى لا تختلط بأعمدة جدولك الحالي
const HEADERS = [
  'رقم الطلب', 'التاريخ', 'الحالة', 'طريقة الإرسال',
  'الاسم', 'الجوال', 'مراسلة الزبون',
  'المنطقة', 'المدينة', 'العنوان',
  'القطع', 'عدد القطع',
  'المجموع', 'الخصم', 'الكوبون', 'التوصيل', 'تغليف هدية', 'الإجمالي', 'أسعار تُحدَّد لاحقًا',
  'طريقة الدفع', 'رسالة الإهداء', 'ملاحظات الزبون', 'ملاحظاتك',
  'تحقق المبلغ'
];
const COL = Object.fromEntries(HEADERS.map((h, i) => [h, i + 1]));

/** شغّل هذه الدالة مرة واحدة لتجهيز الجدول (من القائمة أعلى المحرر اختر setup ثم Run). */
function setup() {
  const sh = sheet_();
  sh.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS])
    .setFontWeight('bold').setBackground('#241c19').setFontColor('#faf6f2')
    .setHorizontalAlignment('center').setVerticalAlignment('middle');
  sh.setRightToLeft(true);
  sh.setFrozenRows(1);
  sh.setFrozenColumns(1);
  sh.setRowHeight(1, 36);
  const widths = { 'رقم الطلب': 150, 'التاريخ': 140, 'الحالة': 120, 'طريقة الإرسال': 110, 'الاسم': 140, 'الجوال': 120,
    'مراسلة الزبون': 170, 'العنوان': 220, 'القطع': 320, 'ملاحظات الزبون': 220, 'ملاحظاتك': 220 };
  Object.entries(widths).forEach(([h, w]) => sh.setColumnWidth(COL[h], w));

  // قائمة منسدلة للحالة
  const rule = SpreadsheetApp.newDataValidation().requireValueInList(STATUSES, true).setAllowInvalid(false).build();
  sh.getRange(2, COL['الحالة'], sh.getMaxRows() - 1, 1).setDataValidation(rule);

  // ألوان الحالة
  const colors = { 'جديد': ['#fdecef', '#8c4d5c'], 'تم التأكيد': ['#fff4d6', '#7a5a00'], 'قيد التجهيز': ['#e8f0fe', '#1a56b0'],
    'تم الشحن': ['#ede7f6', '#5e35b1'], 'تم التسليم': ['#e6f4ea', '#1e7a3c'], 'ملغي': ['#eeeeee', '#666666'] };
  const range = sh.getRange(2, COL['الحالة'], sh.getMaxRows() - 1, 1);
  sh.setConditionalFormatRules(Object.entries(colors).map(([s, [bg, fg]]) =>
    SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo(s).setBackground(bg).setFontColor(fg).setBold(true).setRanges([range]).build()));

  ['المجموع', 'الخصم', 'التوصيل', 'تغليف هدية', 'الإجمالي'].forEach((h) =>
    sh.getRange(2, COL[h], sh.getMaxRows() - 1, 1).setNumberFormat('#,##0'));
  sh.getRange(2, COL['القطع'], sh.getMaxRows() - 1, 1).setWrap(true);
  try { ss_().toast('تم تجهيز جدول الطلبات ✓', STORE_NAME, 5); } catch (e) { /* التنبيه يظهر فقط داخل نافذة الجدول */ }
  Logger.log('تم تجهيز جدول الطلبات ✓ ' + ss_().getUrl());
}

/** يستقبل الطلب من المتجر */
function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const d = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    if (d.website) return json_({ ok: true });                       // حماية من الرسائل الآلية
    if (!/^EL-\d{6}-[A-Z0-9]{4,8}$/.test(d.id || '')) return json_({ ok: false, error: 'bad id' });
    if (!clean_(d.name) || !clean_(d.phone) || !Array.isArray(d.items) || !d.items.length || d.items.length > 60) {
      return json_({ ok: false, error: 'missing data' });
    }

    const sh = sheet_();
    if (findRow_(sh, d.id)) return json_({ ok: true, id: d.id, duplicate: true });  // لا تكرار لنفس الطلب
    if (!rateOk_(d.phone)) return json_({ ok: false, error: 'rate' });
    ensureHeaders_(sh);
    const check = verify_(d);

    const items = d.items.slice(0, 60).map((it, i) => {
      const price = num_(it.price);
      const p = price == null ? 'السعر عند الطلب' : `${it.from ? 'يبدأ من ' : ''}${fmt_(price * (num_(it.q) || 1))}`;
      return `${i + 1}. ${clean_(it.title, 120)} × ${num_(it.q) || 1} — ${p}`;
    }).join('\n');
    const count = d.items.reduce((a, it) => a + (num_(it.q) || 1), 0);
    const phone = clean_(d.phone, 30);

    const row = new Array(HEADERS.length).fill('');
    const set = (h, v) => { row[COL[h] - 1] = v; };
    set('رقم الطلب', d.id);
    set('التاريخ', new Date());
    set('الحالة', 'جديد');
    set('طريقة الإرسال', d.channel === 'whatsapp' ? 'واتساب' : 'مباشر من المتجر');
    set('الاسم', clean_(d.name, 80));
    set('الجوال', phone);
    set('مراسلة الزبون', waLink_(phone));
    set('المنطقة', clean_(d.zone, 60));
    set('المدينة', clean_(d.city, 60));
    set('العنوان', clean_(d.address, 300));
    set('القطع', items);
    set('عدد القطع', count);
    set('المجموع', num_(d.sub));
    set('الخصم', num_(d.discount) || '');
    set('الكوبون', clean_(d.coupon, 30));
    set('التوصيل', d.ship == null ? '' : num_(d.ship));
    set('تغليف هدية', d.giftWrap ? (num_(d.giftWrapFee) || 'نعم') : '');
    set('الإجمالي', num_(d.total));
    set('أسعار تُحدَّد لاحقًا', d.unpriced ? 'نعم' : '');
    set('طريقة الدفع', clean_(d.payment, 60));
    set('رسالة الإهداء', clean_(d.giftNote, 300));
    set('ملاحظات الزبون', clean_(d.notes, 500));
    set('تحقق المبلغ', check ? check.label : '');

    sh.appendRow(row);
    const r = sh.getLastRow();
    sh.getRange(r, 1, 1, HEADERS.length).setVerticalAlignment('top');
    sh.getRange(r, COL['التاريخ']).setNumberFormat('yyyy-mm-dd hh:mm');
    if (check && !check.ok) sh.getRange(r, COL['الإجمالي'], 1, 1).setBackground('#fde2e1').setFontColor('#b3261e').setFontWeight('bold');

    if (MailApp.getRemainingDailyQuota() > 3) notify_(d, items, count, check);
    return json_({ ok: true, id: d.id });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}

/** يتيح للمتجر معرفة حالة طلب برقمه (لا يُرجع أي بيانات شخصية) */
function doGet(e) {
  const ids = String((e && e.parameter && e.parameter.ids) || '').split(',')
    .map((s) => s.trim()).filter((s) => /^EL-\d{6}-[A-Z0-9]{4,8}$/.test(s)).slice(0, 20);
  if (!ids.length) return json_({ ok: true, store: STORE_NAME });
  const sh = sheet_();
  const last = sh.getLastRow();
  const data = last > 1 ? sh.getRange(2, 1, last - 1, COL['الحالة']).getValues() : [];
  const map = {};
  data.forEach((r) => { if (ids.includes(r[0])) map[r[0]] = r[COL['الحالة'] - 1] || 'جديد'; });
  return json_({ ok: true, statuses: map });
}

// ================== أدوات ==================
function ss_() {
  const active = SpreadsheetApp.getActive();
  if (active) return active;
  if (!SPREADSHEET_ID) throw new Error('ضع معرّف الجدول في SPREADSHEET_ID أعلى الكود');
  return SpreadsheetApp.openById(SPREADSHEET_ID);
}
function sheet_() {
  const ss = ss_();
  return ss.getSheetByName(SHEET_NAME) || ss.insertSheet(SHEET_NAME, 0);
}
function findRow_(sh, id) {
  const last = sh.getLastRow();
  if (last < 2) return 0;
  const i = sh.getRange(2, 1, last - 1, 1).getValues().findIndex((r) => r[0] === id);
  return i < 0 ? 0 : i + 2;
}
function clean_(v, max) {
  let s = String(v == null ? '' : v).replace(/[\u0000-\u0008\u000B-\u001F]/g, '').trim().slice(0, max || 200);
  if (/^[=+\-@]/.test(s)) s = "'" + s;   // يمنع تنفيذ صيغ داخل الجدول
  return s;
}
function num_(v) { const n = Number(v); return Number.isFinite(n) ? n : null; }
function fmt_(n) { return Number(n).toLocaleString('en-US') + ' ر.ي'; }
function waLink_(phone) {
  let d = String(phone).replace(/[٠-٩]/g, (c) => '٠١٢٣٤٥٦٧٨٩'.indexOf(c)).replace(/\D/g, '');
  if (!d) return '';
  if (d.startsWith('00')) d = d.slice(2);
  else if (d.startsWith('0')) d = '967' + d.slice(1);
  else if (d.length === 9 && d.startsWith('7')) d = '967' + d;   // رقم يمني محلي
  return 'https://wa.me/' + d;
}
function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}
/** يمنع إغراق الجدول بطلبات وهمية: حد لكل رقم جوال وحد عام */
function rateOk_(phone) {
  const c = CacheService.getScriptCache();
  const p = 'rp:' + String(phone || '').replace(/\D/g, '').slice(-9);
  const g = 'rg:' + Math.floor(Date.now() / 600000);
  const np = Number(c.get(p) || 0), ng = Number(c.get(g) || 0);
  if (np >= MAX_PER_PHONE_HOUR || ng >= MAX_PER_10_MIN) return false;
  c.put(p, String(np + 1), 3600);
  c.put(g, String(ng + 1), 660);
  return true;
}

/** يضيف عناوين الأعمدة الجديدة إلى جدول قديم دون المساس بالموجود */
function ensureHeaders_(sh) {
  const head = sh.getRange(1, 1, 1, HEADERS.length).getValues()[0];
  HEADERS.forEach((h, i) => {
    if (head[i] === '' || head[i] == null) sh.getRange(1, i + 1).setValue(h).setFontWeight('bold').setBackground('#241c19').setFontColor('#faf6f2');
  });
}

/** يعيد حساب المبلغ من أسعار المتجر الحقيقية (shop.json) ويقارنه بما أرسله المتصفح */
function verify_(d) {
  try {
    const cache = CacheService.getScriptCache();
    let raw = cache.get('shop');
    if (!raw) {
      const res = UrlFetchApp.fetch(SHOP_URL + '?t=' + Date.now(), { muteHttpExceptions: true, headers: { 'User-Agent': 'Mozilla/5.0 (ELORA orders)' } });
      if (res.getResponseCode() !== 200) return null;
      raw = res.getContentText();
      if (raw.length < 95000) cache.put('shop', raw, 300);
    }
    const shop = JSON.parse(raw);
    const P = shop.products || {};
    let sub = 0, unpriced = false;
    for (const it of d.items) {
      const p = P[String(it.key || it.title)] || {};
      const q = Math.max(1, Math.floor(num_(it.q) || 1));
      if (!Number.isFinite(p.price)) { unpriced = true; continue; }
      let u = p.price;
      (p.bulk || []).forEach((b) => { if (q >= b.min && b.price < u) u = b.price; });
      sub += u * q;
    }
    if (unpriced) return { ok: true, label: 'فيه قطع بلا سعر' };
    const today = Utilities.formatDate(new Date(), 'Asia/Aden', 'yyyy-MM-dd');
    let disc = 0;
    const c = (shop.coupons || {})[String(d.couponCode || '')];
    if (c && c.active !== false && !(c.expires && c.expires < today) && !(c.min && sub < c.min)) {
      disc = c.type === 'percent' ? Math.round(sub * c.value / 100) : Math.min(c.value, sub);
    }
    if (shop.tiersOn !== false) (shop.tiers || []).forEach((t) => { if (sub >= t.min) disc = Math.max(disc, Math.round(sub * t.pct / 100)); });
    const zone = (shop.deliveryZones || []).find((z) => z && z.name === d.zone);
    const free = shop.freeShippingOver > 0 && sub >= shop.freeShippingOver;
    const ship = zone ? (free ? 0 : zone.fee || 0) : 0;
    const gw = shop.giftWrap && shop.giftWrap.enabled && d.giftWrap ? (shop.giftWrap.fee || 0) : 0;
    const total = Math.max(0, sub - disc) + ship + gw;
    const ok = Math.abs(total - (num_(d.total) || 0)) <= 1;
    return { ok, total, label: ok ? '✓ مطابق' : '⚠ المبلغ الصحيح: ' + fmt_(total) };
  } catch (err) {
    return null;                       // لا نوقف الطلب إن تعذّر التحقق
  }
}

function notify_(d, items, count, check) {
  const to = NOTIFY_EMAIL || Session.getEffectiveUser().getEmail();
  if (!to) return;
  const esc = (s) => String(s || '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const row = (k, v) => v ? `<tr><td style="color:#7c706a;padding:6px 0;width:120px">${k}</td><td style="padding:6px 0">${v}</td></tr>` : '';
  const total = d.unpriced && !num_(d.sub) ? 'يُحدَّد عند التأكيد' : fmt_(num_(d.total) || 0) + (d.unpriced ? ' (مبدئي)' : '');
  const wa = waLink_(d.phone);
  const html = `
  <div dir="rtl" style="font-family:Tahoma,Arial,sans-serif;background:#faf6f2;padding:24px">
    <div style="max-width:560px;margin:auto;background:#fff;border:1px solid #e9dfd7;border-radius:10px;overflow:hidden">
      <div style="background:#241c19;color:#faf6f2;padding:22px 24px;text-align:center">
        <div style="font-family:Georgia,serif;letter-spacing:.3em;font-size:22px">${STORE_NAME}</div>
        <div style="color:#d9b4bc;margin-top:6px">طلب جديد ${d.channel === 'whatsapp' ? '(أُرسل أيضًا عبر واتساب)' : 'مباشر من المتجر'}</div>
      </div>
      <div style="padding:22px 24px">
        <div style="font-size:13px;color:#7c706a">رقم الطلب</div>
        <div style="font-family:monospace;font-size:18px;font-weight:bold;margin-bottom:16px" dir="ltr">${esc(d.id)}</div>
        <div style="background:#faf6f2;border-radius:8px;padding:14px 16px;white-space:pre-line;line-height:1.9">${esc(items)}</div>
        <table style="width:100%;margin-top:16px;font-size:14px;border-collapse:collapse">
          ${row('عدد القطع', count)}
          ${row('الإجمالي', '<b>' + esc(total) + '</b>')}
          ${check && !check.ok ? row('تنبيه', '<b style="color:#b3261e">' + esc(check.label) + ' — راجع المبلغ قبل التأكيد</b>') : ''}
          ${row('الدفع', esc(d.payment))}
          ${row('الاسم', esc(d.name))}
          ${row('الجوال', '<span dir="ltr">' + esc(d.phone) + '</span>')}
          ${row('العنوان', esc([d.zone, d.city, d.address].filter(Boolean).join(' — ')))}
          ${row('هدية', d.giftWrap ? 'تغليف هدية' + (d.giftNote ? ' — «' + esc(d.giftNote) + '»' : '') : '')}
          ${row('ملاحظات', esc(d.notes))}
        </table>
        ${wa ? `<a href="${wa}" style="display:block;text-align:center;background:#25d366;color:#fff;text-decoration:none;padding:13px;border-radius:6px;margin-top:20px;font-weight:bold">مراسلة الزبون على واتساب</a>` : ''}
        <a href="${ss_().getUrl()}" style="display:block;text-align:center;border:1px solid #241c19;color:#241c19;text-decoration:none;padding:12px;border-radius:6px;margin-top:10px">فتح جدول الطلبات</a>
      </div>
    </div>
  </div>`;
  MailApp.sendEmail({ to, subject: `🛍 طلب جديد ${d.id} — ${STORE_NAME}`, htmlBody: html, name: STORE_NAME });
}
