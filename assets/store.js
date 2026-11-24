/* ELORA — منطق المتجر
 * يقرأ: site.config.json و data.json (نفس ملفات المعرض القديم) + shop.json (الأسعار والتوصيل والكوبونات).
 */
(() => {
  'use strict';

  // إن لم تتوفر ملفات المتجر بجوار الصفحة (معاينة محلية) تُقرأ من الموقع المنشور
  const REMOTE = 'https://elora-shop.pages.dev/';
  const PAGE = 24;

  /* ================= أدوات ================= */
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const icon = (n, cls = '') => `<svg class="i ${cls}"><use href="#i-${n}"/></svg>`;
  const norm = (s) => String(s || '').toLowerCase()
    .replace(/[ً-ْـ]/g, '').replace(/[أإآٱ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي')
    .replace(/ؤ/g, 'و').replace(/ئ/g, 'ي').replace(/\s+/g, ' ').trim()
    .replace(/لولو/g, 'لول');   // «لؤلؤ» و«لولو» و«لول» كلها تجد بعضها
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

  const store = {
    get(k, d) { try { const v = localStorage.getItem('elora:' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem('elora:' + k, JSON.stringify(v)); } catch { /* وضع خاص */ } },
  };

  let CFG = {}, SHOP = {}, BASE = '';
  let ITEMS = [];
  const BY = new Map();
  let NF = new Intl.NumberFormat('ar-u-nu-arab');

  const S = {
    cat: '*', sort: 'featured', inStock: false, shown: 0, view: [],
    cart: store.get('cart', {}),
    wish: store.get('wish', []),
    recent: store.get('recent', []),
    coupon: store.get('coupon', ''),
    gift: store.get('gift', { on: false, note: '' }),
    zone: store.get('zone', ''),
    customer: store.get('customer', {}),
    orders: store.get('orders', []),
    payment: '',
    channel: store.get('channel', 'direct'),
  };
  const save = (k) => store.set(k, S[k]);

  const num = (n) => NF.format(n);
  const money = (n) => `${NF.format(n)} ${SHOP.currency || 'ر.ي'}`;
  const url = (p) => (!p || /^(https?:|data:|blob:)/.test(p)) ? p : BASE + p;

  /* ================= التحميل ================= */
  async function getJSON(u) {
    const r = await fetch(u + (u.includes('?') ? '&' : '?') + 'v=' + Date.now());
    if (!r.ok) throw new Error(r.status);
    return r.json();
  }
  async function getWithFallback(path, fallback) {
    try { return { data: await getJSON(path), base: '' }; } catch { /* جرّب المنشور */ }
    try { return { data: await getJSON(REMOTE + path), base: REMOTE }; } catch { /* لا شيء */ }
    return { data: fallback, base: '' };
  }

  function buildItems(raw) {
    const list = Array.isArray(raw) ? raw : (raw.items || []);
    const prods = SHOP.products || {};
    ITEMS = list
      .filter((it) => it.type !== 'video' || it.thumb)
      .map((it, order) => {
        const extra = prods[it.id] || prods[it.title] || {};
        const p = {
          id: it.id, title: it.title || '', cat: it.category || 'أخرى',
          img: url(it.src), thumb: url(it.thumb || it.src), w: it.w, h: it.h,
          added: Date.parse(it.added) || 0, order,
          price: Number.isFinite(extra.price) ? extra.price : null,
          oldPrice: Number.isFinite(extra.oldPrice) ? extra.oldPrice : null,
          stock: Number.isFinite(extra.stock) ? extra.stock : null,
          desc: extra.desc || '', featured: !!extra.featured, hidden: !!extra.hidden, from: !!extra.from,
          aliases: Array.isArray(extra.aliases) ? extra.aliases : [],
        };
        p.key = norm(`${p.title} ${p.cat} ${p.desc}`);
        return p;
      })
      .filter((p) => !p.hidden);
    BY.clear(); BYSID.clear();
    ITEMS.forEach((p) => { p.sid = shortId(p.id); BY.set(p.id, p); BYSID.set(p.sid, p); });
    // روابط قديمة لقطع أُعيدت تسميتها تبقى تفتحها
    ITEMS.forEach((p) => p.aliases.forEach((a) => { if (!BYSID.has(a)) BYSID.set(a, p); }));
    // نظّف السلة والمفضلة من قطع لم تعد موجودة
    for (const id in S.cart) if (!BY.has(id)) delete S.cart[id];
    S.wish = S.wish.filter((id) => BY.has(id));
    S.recent = S.recent.filter((id) => BY.has(id));
  }

  /** يختار المتصفح الصورة المناسبة لحجم الشاشة: المصغّرة (≈٧٠٠ بكسل) للجوال، والكاملة للشاشات الكبيرة. */
  function srcset(p, sizes) {
    if (!p.w || !p.h || p.thumb === p.img) return `src="${esc(p.img)}"`;
    const tw = Math.round(p.w * Math.min(1, 700 / Math.max(p.w, p.h)));
    return `src="${esc(p.thumb)}" srcset="${esc(p.thumb)} ${tw}w, ${esc(p.img)} ${p.w}w" sizes="${sizes}"`;
  }

  const isNew = (p) => p.added && Date.now() - p.added < (SHOP.newDays || 14) * 864e5;
  const soldOut = (p) => p.stock === 0;
  const canAdd = (p, extra = 1) => !soldOut(p) && (p.stock == null || (S.cart[p.id] || 0) + extra <= p.stock);
  // رابط قصير وثابت لكل قطعة: …/elora/#i=k3f9a2 بدل اسم عربي طويل مشفّر
  const shortId = (s) => { let h = 0x811c9dc5; for (const ch of String(s)) { h ^= ch.codePointAt(0); h = Math.imul(h, 0x01000193) >>> 0; } return h.toString(36); };
  const BYSID = new Map();
  const siteBase = () => (/^https?:$/.test(location.protocol) && !/^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname))
    ? location.origin + location.pathname
    : (SHOP.siteUrl || REMOTE);
  const productLink = (p) => `${siteBase()}#i=${p.sid}`;

  function waLink(text) {
    const n = String(CFG.whatsapp || '').replace(/\D/g, '');
    if (!n) return null;
    // الرموز التعبيرية الملوّنة (مثل 🌸) تظهر «�» في بعض نسخ واتساب عند فتحها من رابط
    const safe = String(text || '').replace(/\u{1F338}/gu, '✿').replace(/[\u{10000}-\u{10FFFF}]️?/gu, '').replace(/[ \t]{2,}/g, ' ');
    return `https://wa.me/${n}${safe ? `?text=${encodeURIComponent(safe)}` : ''}`;
  }

  /* ================= واجهات العرض ================= */
  function priceHTML(p) {
    if (p.price == null) return `<div class="price"><span class="ask">السعر عند الطلب</span></div>`;
    return `<div class="price">${p.from ? '<span class="from">يبدأ من</span>' : ''}<span>${money(p.price)}</span>${p.oldPrice && p.oldPrice > p.price ? `<span class="old">${money(p.oldPrice)}</span>` : ''}</div>`;
  }
  function badgesHTML(p) {
    const b = [];
    if (soldOut(p)) b.push('<span class="badge out">نفدت الكمية</span>');
    else {
      if (p.oldPrice && p.price != null && p.oldPrice > p.price) b.push(`<span class="badge sale">خصم ${num(Math.round(100 - (p.price / p.oldPrice) * 100))}٪</span>`);
      if (isNew(p)) b.push('<span class="badge new">جديد</span>');
      if (p.stock != null && p.stock > 0 && p.stock <= 2) b.push(`<span class="badge low">${p.stock === 1 ? 'آخر قطعة' : 'كمية محدودة'}</span>`);
    }
    return b.length ? `<div class="badges">${b.join('')}</div>` : '';
  }
  function cardHTML(p, { reveal = true, quick = true } = {}) {
    const wished = S.wish.includes(p.id);
    return `<article class="card${reveal ? ' reveal' : ''}${soldOut(p) ? ' soldout' : ''}" data-id="${esc(p.id)}">
      <div class="card-top">
        <div class="card-media" data-open="${esc(p.id)}" role="link" tabindex="0" aria-label="${esc(p.title)}">
          <img src="${esc(p.thumb)}" alt="${esc(p.title)}" loading="lazy" decoding="async" onload="this.classList.add('loaded')">
          ${badgesHTML(p)}
        </div>
        <button class="wish" data-wish="${esc(p.id)}" aria-pressed="${wished}" aria-label="${wished ? 'إزالة من المفضلة' : 'أضف إلى المفضلة'}">${icon('heart')}</button>
        ${quick ? `<button class="quick" data-add="${esc(p.id)}" ${soldOut(p) ? 'disabled' : ''} aria-label="أضف ${esc(p.title)} إلى السلة">${icon(soldOut(p) ? 'close' : 'plus')}<span>${soldOut(p) ? 'غير متوفر' : 'أضف للسلة'}</span></button>` : ''}
      </div>
      <div class="card-info">
        <span class="card-cat">${esc(p.cat)}</span>
        <h3 class="card-name" data-open="${esc(p.id)}">${esc(p.title)}</h3>
        ${priceHTML(p)}
      </div>
    </article>`;
  }
  const skeletons = (n) => Array.from({ length: n }, () =>
    `<div class="card skel-card"><div class="card-media skel"></div><div class="skel skel-line" style="width:40%"></div><div class="skel skel-line" style="width:75%"></div></div>`).join('');

  const revealer = 'IntersectionObserver' in window && !reduced
    ? new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('in'); revealer.unobserve(e.target); } }), { rootMargin: '0px 0px -40px' })
    : null;
  function observeReveal(root) {
    $$('.card.reveal:not(.in)', root).forEach((el, i) => {
      if (!revealer) { el.classList.add('in'); return; }
      el.style.transitionDelay = `${(i % 4) * 60}ms`;
      revealer.observe(el);
    });
  }

  /* ---------- الترويسة والواجهة ---------- */
  function categories() {
    const m = new Map();
    ITEMS.forEach((p) => { if (!m.has(p.cat)) m.set(p.cat, []); m.get(p.cat).push(p); });
    return [...m.entries()].sort((a, b) => b[1].length - a[1].length);
  }

  function renderChrome() {
    const name = CFG.brandName || 'ELORA';
    const tag = CFG.tagline || '';
    document.title = tag ? `${name} — ${tag}` : name;
    $$('.brand-word').forEach((el) => { el.textContent = name; });
    $('#heroSub').textContent = tag || $('#heroSub').textContent;
    if (SHOP.heroTitle) $('#heroTitle').textContent = SHOP.heroTitle;
    if (SHOP.heroAccent) $('#heroAccent').textContent = SHOP.heroAccent;
    $('#ftrTag').textContent = tag;
    $('#copyright').textContent = `© ${num(new Date().getFullYear()).replace(/٬/g, '')} ${name} — جميع الحقوق محفوظة`;
    $('#sampleBanner').hidden = !SHOP.sampleData;

    const wa = waLink('السلام عليكم ورحمة الله ✿');
    const insta = CFG.instagram ? `https://instagram.com/${String(CFG.instagram).replace(/^@/, '')}` : '';
    if (wa) {
      $('#waFab').href = wa; $('#waFab').hidden = false;
      $('#heroWa').href = wa;
      $('#menuWa').href = wa; $('#menuWa').hidden = false;
    } else $('#heroWa').hidden = true;
    if (insta) {
      $('#instaSec').hidden = false;
      $('#instaLink').href = insta;
      $('#instaHandle').textContent = '@' + String(CFG.instagram).replace(/^@/, '');
      $('#menuInsta').href = insta; $('#menuInsta').hidden = false;
    }
    $('#ftrSocial').innerHTML = [
      insta && `<a href="${esc(insta)}" target="_blank" rel="noopener" aria-label="إنستقرام">${icon('insta')}</a>`,
      wa && `<a href="${esc(wa)}" target="_blank" rel="noopener" aria-label="واتساب">${icon('chat')}</a>`,
    ].filter(Boolean).join('');

    // شريط العرض المؤقت (بعدّاد تنازلي) يتقدّم على الإعلانات المتناوبة
    const promo = SHOP.promo || {};
    const promoEnds = promo.ends ? new Date(promo.ends) : null;
    const promoLive = promo.active && promo.text && (!promoEnds || promoEnds > new Date());
    const ann = (SHOP.announcements || []).filter(Boolean);
    if (promoLive) {
      const el = $('#announceText');
      $('#announce').classList.add('promo');
      const tick = () => {
        const left = promoEnds ? promoEnds - Date.now() : null;
        if (left != null && left <= 0) { location.reload(); return; }
        let cd = '';
        if (left != null) {
          const d = Math.floor(left / 864e5), h = Math.floor(left / 36e5) % 24, m = Math.floor(left / 6e4) % 60, s = Math.floor(left / 1e3) % 60;
          const p = (n) => { const t = String(n).padStart(2, '0'); return SHOP.digits === 'latn' ? t : t.replace(/\d/g, (x) => '٠١٢٣٤٥٦٧٨٩'[x]); };
          cd = `<span class="cd" aria-label="ينتهي العرض خلال">${d ? `<b>${num(d)}</b><i>يوم</i>` : ''}<b>${p(h)}</b><i>:</i><b>${p(m)}</b><i>:</i><b>${p(s)}</b></span>`;
        }
        el.innerHTML = `✦ ${esc(promo.text)} ${cd}`;
      };
      tick();
      if (promoEnds) setInterval(tick, 1000);
    } else if (ann.length) {
      let i = 0;
      const el = $('#announceText');
      el.textContent = ann[0];
      if (ann.length > 1 && !reduced) setInterval(() => {
        el.classList.add('out');
        setTimeout(() => { i = (i + 1) % ann.length; el.textContent = ann[i]; el.classList.remove('out'); }, 350);
      }, 4500);
    } else $('#announce').hidden = true;

    // الشريط المتحرك
    const perks = SHOP.perks || [];
    if (perks.length) {
      const run = perks.map((t) => `<span>${esc(t)}</span>`).join('');
      $('#marquee').innerHTML = run + run + run + run;
    } else $('.marquee').hidden = true;

    // لماذا
    $('#whyGrid').innerHTML = (SHOP.features || []).map((f) =>
      `<div class="why-item"><div class="why-ico">${icon(f.icon || 'sparkle')}</div><h3>${esc(f.title)}</h3><p>${esc(f.text)}</p></div>`).join('');
    $('.why').hidden = !(SHOP.features || []).length;

    // آراء
    const t = SHOP.testimonials || [];
    $('#testiSec').hidden = !t.length;
    $('#testiGrid').innerHTML = t.map((x) => `<figure class="testi"><blockquote>${esc(x.text)}</blockquote><figcaption>— ${esc(x.name)}</figcaption></figure>`).join('');

    // الأسئلة
    const faq = SHOP.faq || [];
    $('#faqSec').hidden = !faq.length;
    $('#faq').innerHTML = faq.map((f) => `<details><summary>${esc(f.q)}</summary><p>${esc(f.a)}</p></details>`).join('');
  }

  function renderCatalogChrome() {
    const cats = categories();
    $('#statCount').textContent = num(ITEMS.length);
    $('#statCats').textContent = num(cats.length);

    // الواجهة: عرض متحرك لأجمل القطع داخل القوس
    const featured = ITEMS.filter((p) => p.featured);
    const heroPool = (featured.length ? featured : ITEMS).filter((p) => !soldOut(p)).slice(0, 5);
    startHeroSlides(heroPool);

    // الحكاية
    const story = SHOP.story || {};
    if (story.title && story.text && ITEMS.length) {
      const pic = ITEMS.find((p) => p.title === story.image) || featured[1] || ITEMS[0];
      $('#storyTitle').textContent = story.title;
      $('#storyText').textContent = story.text;
      $('#storyMedia').innerHTML = `<img ${srcset(pic, '(max-width: 820px) 100vw, 50vw')} alt="${esc(pic.title)}" loading="lazy">`;
      $('#story').hidden = false;
    }

    // الفئات
    $('#catRow').innerHTML = cats.map(([c, list]) => {
      const cover = list.find((p) => p.featured) || list[0];
      return `<a class="cat" href="#shop" data-cat-link="${esc(c)}">
        <span class="cat-img"><img src="${esc(cover.thumb)}" alt="" loading="lazy"></span>
        <span class="cat-label"><b>${esc(c)}</b><small>${num(list.length)} ${list.length > 10 || list.length < 3 ? 'قطعة' : 'قطع'}</small></span>
      </a>`;
    }).join('');

    const navCats = cats.slice(0, 5);
    $('#hdrNav').innerHTML = navCats.map(([c]) => `<a href="#shop" data-cat-link="${esc(c)}">${esc(c)}</a>`).join('');
    $('#menuCats').innerHTML = cats.map(([c, l]) => `<li><a href="#shop" data-cat-link="${esc(c)}">${esc(c)} <small>${num(l.length)}</small></a></li>`).join('');
    $('#ftrCats').innerHTML = cats.map(([c]) => `<li><a href="#shop" data-cat-link="${esc(c)}">${esc(c)}</a></li>`).join('');

    $('#chips').innerHTML = [['*', 'الكل'], ...cats.map(([c]) => [c, c])].map(([v, l]) =>
      `<button class="chip" role="tab" data-cat="${esc(v)}" aria-selected="${v === S.cat}">${esc(l)}</button>`).join('');

    // المختارات
    const picks = (featured.length ? featured : [...ITEMS].sort((a, b) => b.added - a.added)).slice(0, 10);
    $('#picksRail').innerHTML = picks.map((p) => cardHTML(p)).join('');
    observeReveal($('#picksRail'));
    $('#picksSec').hidden = !picks.length;

    // بيانات منظّمة لمحركات البحث
    const ld = {
      '@context': 'https://schema.org', '@type': 'Store', name: CFG.brandName || 'ELORA', description: CFG.tagline || '',
      url: location.origin + location.pathname, image: url(CFG.logo || ''),
      ...(CFG.instagram ? { sameAs: [`https://instagram.com/${String(CFG.instagram).replace(/^@/, '')}`] } : {}),
      hasOfferCatalog: {
        '@type': 'OfferCatalog', name: 'منتجات ' + (CFG.brandName || ''),
        itemListElement: ITEMS.slice(0, 50).map((p) => ({
          '@type': 'Offer', itemOffered: { '@type': 'Product', name: p.title, image: p.img, category: p.cat },
          ...(p.price != null && !SHOP.sampleData ? { price: p.price, priceCurrency: SHOP.currencyCode || 'YER' } : {}),
          availability: soldOut(p) ? 'https://schema.org/OutOfStock' : 'https://schema.org/InStock',
        })),
      },
    };
    const s = document.createElement('script');
    s.type = 'application/ld+json';
    s.textContent = JSON.stringify(ld);
    document.head.appendChild(s);
  }

  let heroTimer = null;
  function startHeroSlides(pool) {
    const box = $('#heroSlides'), dots = $('#heroDots'), pick = $('#heroPick');
    if (!pool.length) return;
    box.classList.remove('skel');
    box.innerHTML = pool.map((p, i) => `<img ${srcset(p, '(max-width: 820px) 82vw, 36vw')} alt="" ${i ? 'loading="lazy"' : 'fetchpriority="high"'} style="background:url('${esc(p.thumb)}') center/cover">`).join('');
    dots.innerHTML = pool.length > 1 ? pool.map((p, i) => `<button role="tab" aria-label="${esc(p.title)}" data-slide="${i}"></button>`).join('')
      + '<button class="hero-pause" data-pause aria-label="إيقاف العرض المتحرك" aria-pressed="false"></button>' : '';
    let cur = -1, paused = false, hover = false;
    const show = (i) => {
      cur = (i + pool.length) % pool.length;
      const p = pool[cur];
      $$('img', box).forEach((im, k) => im.classList.toggle('on', k === cur));
      $$('[data-slide]', dots).forEach((d, k) => d.setAttribute('aria-current', String(k === cur)));
      pick.hidden = false;
      pick.dataset.open = p.id;
      pick.innerHTML = `<img src="${esc(p.thumb)}" alt=""><span><small>قطعة مختارة</small><b>${esc(p.title)}</b>${priceHTML(p)}</span>${icon('next')}`;
    };
    // يتبدّل دائمًا، حتى في وضع «تقليل الحركة» (يفعّله توفير الطاقة في كثير من الجوالات):
    // تبديل الصورة ليس حركة مزعجة، والتأثيرات الحركية نفسها تُلغى عبر CSS في ذلك الوضع.
    const play = () => {
      clearInterval(heroTimer);
      if (pool.length > 1 && !paused) heroTimer = setInterval(() => { if (!document.hidden && !hover) show(cur + 1); }, reduced ? 6000 : 5000);
    };
    dots.onclick = (e) => {
      const pz = e.target.closest('[data-pause]');
      if (pz) {
        paused = !paused;
        pz.setAttribute('aria-pressed', String(paused));
        pz.setAttribute('aria-label', paused ? 'تشغيل العرض المتحرك' : 'إيقاف العرض المتحرك');
        play();
        return;
      }
      const b = e.target.closest('[data-slide]');
      if (b) { show(Number(b.dataset.slide)); play(); }
    };
    // يتوقف مؤقتًا ما دام مؤشر الفأرة فوق الصورة
    $('#heroArt').addEventListener('mouseenter', () => { hover = true; });
    $('#heroArt').addEventListener('mouseleave', () => { hover = false; });
    // السحب بالإصبع للتنقل بين الصور
    let sx = null, sy = null;
    box.addEventListener('touchstart', (e) => { sx = e.touches[0].clientX; sy = e.touches[0].clientY; }, { passive: true });
    box.addEventListener('touchend', (e) => {
      if (sx == null) return;
      const dx = e.changedTouches[0].clientX - sx, dy = e.changedTouches[0].clientY - sy;
      sx = null;
      if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy)) { show(cur + (dx > 0 ? 1 : -1)); play(); }
    }, { passive: true });
    box.style.touchAction = 'pan-y';
    show(0);
    play();
  }

  /* ---------- الشبكة ---------- */
  function computeView() {
    let v = S.cat === '*' ? [...ITEMS] : ITEMS.filter((p) => p.cat === S.cat);
    if (S.inStock) v = v.filter((p) => !soldOut(p));
    const cmpPrice = (dir) => (a, b) => {
      if (a.price == null && b.price == null) return a.order - b.order;
      if (a.price == null) return 1;
      if (b.price == null) return -1;
      return dir * (a.price - b.price);
    };
    const sorts = {
      featured: (a, b) => (b.featured - a.featured) || (soldOut(a) - soldOut(b)) || a.order - b.order,
      new: (a, b) => (b.added - a.added) || a.order - b.order,
      'price-asc': cmpPrice(1),
      'price-desc': cmpPrice(-1),
      name: (a, b) => a.title.localeCompare(b.title, 'ar'),
    };
    v.sort(sorts[S.sort] || sorts.featured);
    S.view = v;
  }
  function renderGrid() {
    computeView();
    S.shown = 0;
    $('#grid').innerHTML = '';
    $('#emptyState').hidden = S.view.length > 0;
    $('#resultCount').textContent = `${num(S.view.length)} ${S.view.length > 10 || S.view.length < 3 ? 'قطعة' : 'قطع'}`;
    $$('#chips .chip').forEach((c) => c.setAttribute('aria-selected', String(c.dataset.cat === S.cat)));
    renderMore();
  }
  function renderMore() {
    const slice = S.view.slice(S.shown, S.shown + PAGE);
    if (!slice.length) return;
    $('#grid').insertAdjacentHTML('beforeend', slice.map((p) => cardHTML(p)).join(''));
    S.shown += slice.length;
    observeReveal($('#grid'));
  }
  if ('IntersectionObserver' in window) {
    new IntersectionObserver((es) => { if (es[0].isIntersecting && S.shown < S.view.length) renderMore(); }, { rootMargin: '800px' }).observe($('#sentinel'));
  }

  function setCat(c, scroll) {
    S.cat = c;
    renderGrid();
    if (scroll) $('#shop').scrollIntoView({ behavior: reduced ? 'auto' : 'smooth' });
  }

  function renderRecent() {
    const list = S.recent.map((id) => BY.get(id)).filter(Boolean).slice(0, 12);
    $('#recentSec').hidden = list.length < 2;
    $('#recentRail').innerHTML = list.map((p) => cardHTML(p, { reveal: false, quick: false })).join('');
  }

  /* ================= العدّادات ================= */
  const cartCount = () => Object.values(S.cart).reduce((a, b) => a + b, 0);
  function updateCounts(bump) {
    const c = cartCount(), w = S.wish.length;
    $$('[data-count="cart"]').forEach((el) => {
      el.textContent = num(c); el.hidden = !c;
      if (bump === 'cart') { el.classList.remove('bump'); void el.offsetWidth; el.classList.add('bump'); }
    });
    $$('[data-count="wish"]').forEach((el) => {
      el.textContent = num(w); el.hidden = !w;
      if (bump === 'wish') { el.classList.remove('bump'); void el.offsetWidth; el.classList.add('bump'); }
    });
  }

  /* ================= الإشعارات ================= */
  function toast(msg, action) {
    const el = document.createElement('div');
    el.className = 'toast';
    el.innerHTML = `${icon('check')}<span>${esc(msg)}</span>${action ? `<button>${esc(action.label)}</button>` : ''}`;
    if (action) el.querySelector('button').onclick = () => { action.run(); kill(); };
    $('#toasts').appendChild(el);
    const kill = () => { el.classList.add('out'); setTimeout(() => el.remove(), 300); };
    setTimeout(kill, 3200);
    while ($('#toasts').children.length > 3) $('#toasts').firstElementChild.remove();
  }

  /* ================= السلة ================= */
  function flyToCart(fromImg) {
    if (reduced || !fromImg || !fromImg.getBoundingClientRect || !Element.prototype.animate) return;
    const target = [...$$('[data-open-drawer="cart"]')].find((b) => b.offsetParent !== null);
    if (!target) return;
    const a = fromImg.getBoundingClientRect(), b = target.getBoundingClientRect();
    if (!a.width) return;
    const ghost = fromImg.cloneNode();
    ghost.className = 'fly';
    Object.assign(ghost.style, { left: a.left + 'px', top: a.top + 'px', width: a.width + 'px', height: a.height + 'px', opacity: 1 });
    document.body.appendChild(ghost);
    const dx = b.left + b.width / 2 - (a.left + a.width / 2), dy = b.top + b.height / 2 - (a.top + a.height / 2);
    ghost.animate([
      { transform: 'translate(0,0) scale(1)', opacity: 1, borderRadius: '14px' },
      { transform: `translate(${dx * .5}px, ${dy * .5 - 60}px) scale(.45)`, opacity: .9, offset: .55 },
      { transform: `translate(${dx}px, ${dy}px) scale(.08)`, opacity: .2, borderRadius: '50%' },
    ], { duration: 750, easing: 'cubic-bezier(.5,0,.3,1)' }).onfinish = () => ghost.remove();
  }

  function addToCart(id, qty = 1, srcImg) {
    const p = BY.get(id);
    if (!p) return false;
    if (!canAdd(p, qty)) {
      toast(soldOut(p) ? 'هذه القطعة نفدت حاليًا' : `المتوفر من هذه القطعة ${num(p.stock)} فقط`);
      return false;
    }
    S.cart[id] = (S.cart[id] || 0) + qty;
    save('cart');
    flyToCart(srcImg);
    setTimeout(() => updateCounts('cart'), srcImg && !reduced ? 650 : 0);
    toast(`تمت إضافة «${p.title}» إلى السلة`,{ label: 'عرض السلة', run: () => openDrawer('cart') });
    if (drawerMode === 'cart') renderDrawer();
    return true;
  }
  function setQty(id, q) {
    const p = BY.get(id);
    if (!p) return;
    if (q <= 0) delete S.cart[id];
    else S.cart[id] = p.stock != null ? Math.min(q, p.stock) : q;
    save('cart'); updateCounts(); renderDrawer();
  }

  function zones() { return (SHOP.deliveryZones || []).filter((z) => z && z.name); }
  function totals() {
    const lines = Object.entries(S.cart).map(([id, q]) => ({ p: BY.get(id), q })).filter((l) => l.p);
    const sub = lines.reduce((s, l) => s + (l.p.price != null ? l.p.price * l.q : 0), 0);
    const unpriced = lines.some((l) => l.p.price == null);
    let discount = 0, couponMsg = '', couponOk = false;
    const c = S.coupon && (SHOP.coupons || {})[S.coupon];
    if (S.coupon) {
      if (!c) couponMsg = 'الكوبون غير صالح';
      else if (c.active === false) couponMsg = 'هذا الكوبون متوقف حاليًا';
      else if (c.expires && c.expires < new Date().toISOString().slice(0, 10)) couponMsg = 'انتهت صلاحية هذا الكوبون';
      else if (c.min && sub < c.min) couponMsg = `يتطلب هذا الكوبون طلبًا بقيمة ${money(c.min)} على الأقل`;
      else {
        discount = c.type === 'percent' ? Math.round(sub * c.value / 100) : Math.min(c.value, sub);
        couponOk = true; couponMsg = `تم تطبيق ${c.label || S.coupon}`;
      }
    }
    const zone = zones().find((z) => z.name === S.zone);
    const free = SHOP.freeShippingOver > 0 && sub >= SHOP.freeShippingOver;
    const ship = zone ? (free ? 0 : zone.fee || 0) : null;
    const gw = SHOP.giftWrap && SHOP.giftWrap.enabled && S.gift.on ? (SHOP.giftWrap.fee || 0) : 0;
    const total = Math.max(0, sub - discount) + (ship || 0) + gw;
    return { lines, count: cartCount(), sub, unpriced, discount, couponMsg, couponOk, zone, free, ship, gw, total };
  }

  /* ================= الدرج الجانبي ================= */
  let drawerMode = null;
  let lastFocus = null;
  const layers = [];

  function lock() { document.documentElement.classList.add('locked'); }
  function unlockIfIdle() { if (!layers.length) document.documentElement.classList.remove('locked'); }
  function showScrim() { const s = $('#scrim'); s.hidden = false; void s.offsetWidth; s.classList.add('on'); }
  function hideScrimIfIdle() {
    if (layers.some((l) => l === 'drawer' || l === 'menu' || l === 'sheet' || l === 'checkout')) return;
    const s = $('#scrim'); s.classList.remove('on'); setTimeout(() => { if (!s.classList.contains('on')) s.hidden = true; }, 300);
  }
  function openLayer(name, el) {
    if (!layers.length) lastFocus = document.activeElement;
    if (!layers.includes(name)) layers.push(name);
    el.hidden = false;
    void el.offsetWidth;   // يثبّت الحالة الابتدائية ثم يبدأ الحركة
    el.classList.add('on');
    lock();
  }
  function closeLayer(name, el) {
    const i = layers.indexOf(name);
    if (i < 0) return;
    layers.splice(i, 1);
    el.classList.remove('on');
    setTimeout(() => { if (!el.classList.contains('on')) el.hidden = true; }, 400);
    unlockIfIdle();
    if (!layers.length && lastFocus && lastFocus.focus) lastFocus.focus({ preventScroll: true });
  }

  function openDrawer(mode) {
    closeMenu();
    drawerMode = mode;
    renderDrawer();
    if (mode === 'orders') refreshStatuses();
    showScrim();
    openLayer('drawer', $('#drawer'));
    setTimeout(() => $('#drawer [data-close]').focus({ preventScroll: true }), 50);
  }
  function closeDrawer() {
    if (!layers.includes('drawer')) return;
    closeLayer('drawer', $('#drawer'));
    drawerMode = null;
    hideScrimIfIdle();
  }
  function openMenu() { showScrim(); openLayer('menu', $('#menu')); }
  function closeMenu() { if (layers.includes('menu')) { closeLayer('menu', $('#menu')); hideScrimIfIdle(); } }

  function lineHTML(p, q) {
    return `<div class="line">
      <div class="line-img" data-open="${esc(p.id)}"><img src="${esc(p.thumb)}" alt="" loading="lazy"></div>
      <div>
        <div class="line-top">
          <div><div class="line-name" data-open="${esc(p.id)}">${esc(p.title)}</div><div class="line-cat">${esc(p.cat)}</div></div>
          <button class="rm" data-rm="${esc(p.id)}" aria-label="حذف ${esc(p.title)}">${icon('trash')}</button>
        </div>
        <div class="line-bottom">
          <div class="stepper" role="group" aria-label="الكمية">
            <button data-qty="${esc(p.id)}" data-d="1" aria-label="زيادة" ${p.stock != null && q >= p.stock ? 'disabled' : ''}>${icon('plus')}</button>
            <output>${num(q)}</output>
            <button data-qty="${esc(p.id)}" data-d="-1" aria-label="إنقاص">${icon('minus')}</button>
          </div>
          ${p.price != null ? `<b>${money(p.price * q)}</b>` : '<span class="price"><span class="ask">عند الطلب</span></span>'}
        </div>
      </div>
    </div>`;
  }

  function summaryHTML(t, { withZone = false } = {}) {
    const anyPriced = t.lines.some((l) => l.p.price != null);
    const rows = anyPriced ? [`<div class="sum-row"><span>المجموع${t.unpriced ? ' (للقطع المسعّرة)' : ''}</span><span>${money(t.sub)}</span></div>`] : [];
    if (t.discount) rows.push(`<div class="sum-row disc"><span>الخصم · <bdi dir="ltr">${esc(S.coupon)}</bdi></span><span>− ${money(t.discount)}</span></div>`);
    if (t.gw) rows.push(`<div class="sum-row"><span>تغليف الهدية</span><span>${money(t.gw)}</span></div>`);
    if ((withZone && zones().length) || t.zone) {
      rows.push(`<div class="sum-row"><span>التوصيل${t.zone ? ` (${esc(t.zone.name)})` : ''}</span><span>${t.ship == null ? 'يُحدَّد في الخطوة التالية' : t.ship === 0 ? 'مجاني' : money(t.ship)}</span></div>`);
    } else if (zones().length) {
      rows.push(`<div class="sum-row"><span>التوصيل</span><span>${t.free ? 'مجاني' : 'يُحسب عند إتمام الطلب'}</span></div>`);
    }
    if (anyPriced) {
      rows.push(`<div class="sum-row total"><span>${t.unpriced ? 'الإجمالي المبدئي' : 'الإجمالي'}</span><span>${money(t.total)}</span></div>`);
      if (t.unpriced) rows.push(`<p class="note">بعض القطع سعرها عند الطلب، وسنؤكد لك الإجمالي النهائي عبر واتساب.</p>`);
    } else {
      rows.push(`<div class="sum-row total"><span>الإجمالي</span><span>يُحدَّد عند التأكيد</span></div>`);
      rows.push(`<p class="note">سنرسل لك السعر النهائي عبر واتساب عند تأكيد طلبك.</p>`);
    }
    return rows.join('');
  }

  function renderDrawer() {
    if (!drawerMode) return;
    const body = $('#drawerBody'), foot = $('#drawerFoot');
    if (drawerMode === 'cart') {
      const t = totals();
      $('#drawerTitle').textContent = t.count ? `سلة المشتريات (${num(t.count)})` : 'سلة المشتريات';
      if (!t.lines.length) {
        const sug = ITEMS.filter((p) => p.featured && !soldOut(p)).slice(0, 4);
        body.innerHTML = `<div class="empty-state">
          <div class="ring">${icon('bag')}</div><h3>سلتك فارغة</h3><p>اكتشف قطعًا مصنوعة يدويًا بحب.</p>
          <button class="btn" data-close data-goto="#shop">ابدأ التسوق</button>
          ${sug.length ? `<div class="mini-head">قد تعجبك</div><div class="mini-grid">${sug.map((p) => cardHTML(p, { reveal: false, quick: false })).join('')}</div>` : ''}
        </div>`;
        foot.innerHTML = '';
        return;
      }
      let bar = '';
      if (SHOP.freeShippingOver > 0 && !t.unpriced) {
        const left = SHOP.freeShippingOver - t.sub;
        const pct = Math.min(100, (t.sub / SHOP.freeShippingOver) * 100);
        bar = `<div class="ship-bar${left <= 0 ? ' done' : ''}">${icon('truck')} ${left <= 0 ? 'رائع! حصلت على <b>توصيل مجاني</b>' : `أضف ${money(left)} لتحصل على <b>توصيل مجاني</b>`}<div class="track"><div class="fill" style="width:${pct}%"></div></div></div>`;
      }
      const gw = SHOP.giftWrap && SHOP.giftWrap.enabled;
      body.innerHTML = bar + t.lines.map((l) => lineHTML(l.p, l.q)).join('') + `
        ${gw ? `<label class="opt"><input type="checkbox" id="giftOn" ${S.gift.on ? 'checked' : ''}>${icon('gift')} تغليف هدية <small>${SHOP.giftWrap.fee ? '+ ' + money(SHOP.giftWrap.fee) : 'مجانًا'}</small></label>
        <div class="field" id="giftNoteWrap" ${S.gift.on ? '' : 'hidden'}><textarea id="giftNote" rows="2" maxlength="200" placeholder="رسالة الإهداء (اختياري)">${esc(S.gift.note)}</textarea></div>` : ''}
        ${Object.keys(SHOP.coupons || {}).length ? `<div class="field" style="margin-top:14px"><span>كوبون الخصم</span>
          <form class="coupon" id="couponForm"><input id="couponIn" placeholder="أدخل الكود" value="${esc(S.coupon)}" autocomplete="off" dir="ltr"><button class="btn btn-ghost" type="submit">${S.coupon && t.couponOk ? 'تغيير' : 'تطبيق'}</button></form>
          ${t.couponMsg ? `<p class="coupon-msg ${t.couponOk ? 'ok' : 'err'}">${esc(t.couponMsg)}</p>` : ''}</div>` : ''}`;
      foot.innerHTML = summaryHTML(t) + `<button class="btn btn-block btn-lg" id="toCheckout">إتمام الطلب ${icon('next')}</button>`;
      return;
    }
    if (drawerMode === 'wish') {
      const list = S.wish.map((id) => BY.get(id)).filter(Boolean);
      $('#drawerTitle').textContent = list.length ? `المفضلة (${num(list.length)})` : 'المفضلة';
      foot.innerHTML = '';
      if (!list.length) {
        body.innerHTML = `<div class="empty-state"><div class="ring">${icon('heart')}</div><h3>لا توجد قطع في المفضلة</h3><p>اضغط على القلب في أي قطعة لحفظها هنا.</p><button class="btn" data-close data-goto="#shop">تصفّح القطع</button></div>`;
        return;
      }
      body.innerHTML = list.map((p) => `<div class="line">
        <div class="line-img" data-open="${esc(p.id)}"><img src="${esc(p.thumb)}" alt="" loading="lazy"></div>
        <div>
          <div class="line-top"><div><div class="line-name" data-open="${esc(p.id)}">${esc(p.title)}</div><div class="line-cat">${esc(p.cat)}</div></div>
            <button class="rm" data-wish="${esc(p.id)}" aria-label="إزالة من المفضلة">${icon('trash')}</button></div>
          <div class="line-bottom">${priceHTML(p)}
            <button class="btn" style="height:38px;padding:0 16px;font-size:.88rem" data-add="${esc(p.id)}" ${soldOut(p) ? 'disabled' : ''}>${soldOut(p) ? 'نفدت' : 'أضف للسلة'}</button></div>
        </div></div>`).join('');
      if (list.some((p) => !soldOut(p))) foot.innerHTML = `<button class="btn btn-block btn-ghost" id="wishAll">أضف الكل إلى السلة</button>`;
      return;
    }
    if (drawerMode === 'orders') {
      $('#drawerTitle').textContent = 'طلباتي';
      foot.innerHTML = '';
      if (!S.orders.length) {
        body.innerHTML = `<div class="empty-state"><div class="ring">${icon('receipt')}</div><h3>لا توجد طلبات بعد</h3><p>ستظهر هنا طلباتك التي ترسلها من هذا الجهاز.</p></div>`;
        return;
      }
      body.innerHTML = `<p class="note" style="margin-top:12px">تُحفظ الطلبات على هذا الجهاز فقط. اذكر رقم الطلب عند التواصل معنا.</p>` +
        S.orders.map((o, i) => `<div class="order">
          <div class="order-top"><span class="order-id">${esc(o.id)}</span><span class="order-date">${esc(new Date(o.at).toLocaleDateString('ar-u-nu-arab', { day: 'numeric', month: 'long', year: 'numeric' }))}</span></div>
          ${o.status ? trackHTML(o.status, true) : o.channel === 'whatsapp' ? '<div class="order-via">أُرسل عبر واتساب</div>' : ''}
          <div class="order-thumbs">${o.items.slice(0, 6).map((it) => { const p = BY.get(it.id); return p ? `<img src="${esc(p.thumb)}" alt="${esc(p.title)}" title="${esc(p.title)} × ${it.q}">` : ''; }).join('')}</div>
          <div class="sum-row"><span>${num(o.items.reduce((a, b) => a + b.q, 0))} قطعة</span><b style="color:var(--text)">${money(o.total)}${o.unpriced ? ' +' : ''}</b></div>
          <div class="order-actions" style="margin-top:10px">
            <button class="btn btn-ghost" data-reorder="${i}">اطلبها مجددًا</button>
            ${waLink() ? `<a class="btn btn-ghost" target="_blank" rel="noopener" href="${esc(waLink(`السلام عليكم، أود الاستفسار عن طلبي رقم ${o.id}`))}">${icon('chat')} استفسر</a>` : ''}
          </div></div>`).join('');
    }
  }

  /* ================= صفحة المنتج ================= */
  let sheetId = null;
  function openSheet(id, { push = true } = {}) {
    const p = BY.get(id);
    if (!p) return;
    closeMenu();
    sheetId = id;
    S.recent = [id, ...S.recent.filter((x) => x !== id)].slice(0, 16);
    save('recent');
    renderSheet();
    if (!layers.includes('sheet')) { showScrim(); openLayer('sheet', $('#sheet')); }
    if (push && location.hash !== '#i=' + p.sid) history.replaceState(null, '', '#i=' + p.sid);
    setTimeout(() => $('#sheet .modal-close')?.focus({ preventScroll: true }), 60);
  }
  function closeSheet() {
    if (!layers.includes('sheet')) return;
    closeLayer('sheet', $('#sheet'));
    hideScrimIfIdle();
    sheetId = null;
    if (/^#[ip]=/.test(location.hash)) history.replaceState(null, '', location.pathname + location.search);
    renderRecent();
  }
  let sheetQty = 1;
  function renderSheet() {
    const p = BY.get(sheetId);
    if (!p) return;
    sheetQty = 1;
    const list = S.view.length ? S.view : ITEMS;
    const idx = list.findIndex((x) => x.id === p.id);
    const related = ITEMS.filter((x) => x.cat === p.cat && x.id !== p.id).slice(0, 8);
    const more = related.length < 4 ? ITEMS.filter((x) => x.cat !== p.cat && x.featured).slice(0, 8 - related.length) : [];
    const wished = S.wish.includes(p.id);
    const stock = soldOut(p) ? '<span class="stock-line out">نفدت الكمية حاليًا</span>'
      : p.stock != null && p.stock <= 2 ? `<span class="stock-line low">${p.stock === 1 ? 'آخر قطعة متبقية' : `متبقٍ ${num(p.stock)} قطع فقط`}</span>`
      : '<span class="stock-line">متوفرة وجاهزة للطلب</span>';
    const askText = `${CFG.whatsappMessage || 'السلام عليكم، أود الاستفسار عن هذه القطعة'}\n\n${p.title}\n${productLink(p)}`;
    $('#sheetCard').innerHTML = `
      <button class="icon-btn modal-close" data-close aria-label="إغلاق">${icon('close')}</button>
      <div class="sheet">
        <div class="sheet-media" id="zoomBox">
          <img ${srcset(p, '(max-width: 820px) 100vw, 1100px')} alt="${esc(p.title)}" style="background:url('${esc(p.thumb)}') center/cover">
          ${idx > -1 && list.length > 1 ? `
            <button class="icon-btn sheet-nav prev" data-step="-1" aria-label="القطعة السابقة">${icon('prev')}</button>
            <button class="icon-btn sheet-nav next" data-step="1" aria-label="القطعة التالية">${icon('next')}</button>` : ''}
          <span class="zoom-hint">${icon('zoom')} اضغط للتكبير</span>
        </div>
        <div class="sheet-info">
          <span class="card-cat">${esc(p.cat)}</span>
          <h2>${esc(p.title)}</h2>
          ${priceHTML(p)}
          ${stock}
          <p class="sheet-desc">${esc(p.desc || `قطعة من تشكيلة ${p.cat} في ${CFG.brandName || 'ELORA'}، مصنوعة يدويًا بعناية وتفاصيل دقيقة.`)}</p>
          ${soldOut(p) ? `
            ${waLink() ? `<a class="btn btn-lg btn-block" target="_blank" rel="noopener" href="${esc(waLink(`السلام عليكم، أود أن تخبروني عند توفر: ${p.title}\n${productLink(p)}`))}">${icon('chat')} أبلغني عند التوفر</a>` : ''}`
          : `<div class="buy-row">
              <div class="stepper lg" role="group" aria-label="الكمية">
                <button data-sq="1" aria-label="زيادة">${icon('plus')}</button><output id="sq">${num(1)}</output><button data-sq="-1" aria-label="إنقاص">${icon('minus')}</button>
              </div>
              <button class="btn" data-sheet-add>${icon('bag')} أضف للسلة</button>
            </div>
            <button class="btn btn-rose btn-lg btn-block" data-buy-now>اشترِ الآن</button>`}
          <div class="sub-actions">
            <button class="btn btn-ghost" data-wish="${esc(p.id)}" aria-pressed="${wished}">${icon('heart')} ${wished ? 'في المفضلة' : 'أضف للمفضلة'}</button>
            ${waLink() ? `<a class="btn btn-ghost" target="_blank" rel="noopener" href="${esc(waLink(askText))}">${icon('chat')} اسأل عن القطعة</a>` : ''}
            <button class="btn btn-ghost" data-share="${esc(p.id)}">${icon('share')} مشاركة</button>
          </div>
          <ul class="assure">
            <li>${icon('sparkle')} مصنوعة يدويًا، وقد تختلف تفاصيل بسيطة من قطعة لأخرى</li>
            <li>${icon('chat')} نؤكد طلبك ونتفق على التوصيل عبر واتساب</li>
            ${SHOP.giftWrap && SHOP.giftWrap.enabled ? `<li>${icon('gift')} تغليف هدية متاح عند الطلب</li>` : ''}
          </ul>
        </div>
      </div>
      ${related.length + more.length ? `<div class="related"><h3>قد يعجبك أيضًا</h3><div class="rail">${[...related, ...more].map((x) => cardHTML(x, { reveal: false })).join('')}</div></div>` : ''}`;
    $('#sheetCard').scrollTop = 0;

    const box = $('#zoomBox');
    const img = box.querySelector('img');
    box.addEventListener('click', (e) => {
      if (e.target.closest('button')) return;
      box.classList.toggle('zoomed');
      pan(e);
    });
    const pan = (e) => {
      if (!box.classList.contains('zoomed')) return;
      const r = box.getBoundingClientRect();
      img.style.transformOrigin = `${((e.clientX - r.left) / r.width) * 100}% ${((e.clientY - r.top) / r.height) * 100}%`;
    };
    box.addEventListener('mousemove', pan);
    box.addEventListener('mouseleave', () => box.classList.remove('zoomed'));
    let tx = null;
    box.addEventListener('touchstart', (e) => { tx = e.changedTouches[0].clientX; }, { passive: true });
    box.addEventListener('touchend', (e) => {
      if (tx == null || box.classList.contains('zoomed')) return;
      const dx = e.changedTouches[0].clientX - tx;
      if (Math.abs(dx) > 60) stepSheet(dx > 0 ? 1 : -1);
      tx = null;
    }, { passive: true });
  }
  function stepSheet(d) {
    const list = S.view.length ? S.view : ITEMS;
    const i = list.findIndex((x) => x.id === sheetId);
    if (i < 0) return;
    const n = list[(i + d + list.length) % list.length];
    openSheet(n.id);
  }

  async function share(p) {
    const link = productLink(p);
    try {
      if (navigator.share) await navigator.share({ title: `${p.title} — ${CFG.brandName || 'ELORA'}`, url: link });
      else { await navigator.clipboard.writeText(link); toast('تم نسخ رابط القطعة'); }
    } catch { /* أُلغيت المشاركة */ }
  }

  function toggleWish(id, btn) {
    const i = S.wish.indexOf(id);
    if (i > -1) S.wish.splice(i, 1); else S.wish.unshift(id);
    save('wish');
    const on = i < 0;
    $$(`[data-wish="${CSS.escape(id)}"]`).forEach((b) => {
      if (b.classList.contains('rm')) return;
      b.setAttribute('aria-pressed', String(on));
      if (b.classList.contains('wish')) b.setAttribute('aria-label', on ? 'إزالة من المفضلة' : 'أضف إلى المفضلة');
      if (b.classList.contains('btn')) b.innerHTML = `${icon('heart')} ${on ? 'في المفضلة' : 'أضف للمفضلة'}`;
    });
    if (btn && btn.classList.contains('wish')) { btn.classList.remove('pop'); void btn.offsetWidth; btn.classList.add('pop'); }
    updateCounts('wish');
    if (on) toast('تمت الإضافة إلى المفضلة',{ label: 'عرض', run: () => openDrawer('wish') });
    if (drawerMode === 'wish') renderDrawer();
  }

  /* ================= إتمام الطلب ================= */
  let coStep = 0;
  let lastOrder = null;
  const STEPS = ['بياناتك', 'التوصيل', 'المراجعة'];

  function openCheckout() {
    if (!cartCount()) return;
    closeDrawer();
    coStep = 0;
    lastOrder = null;
    pending = null;
    S.payment = S.payment || (SHOP.payments || [])[0] || '';
    renderCheckout();
    showScrim();
    openLayer('checkout', $('#checkout'));
  }
  function closeCheckout() {
    if (!layers.includes('checkout')) return;
    closeLayer('checkout', $('#checkout'));
    hideScrimIfIdle();
  }

  function stepsHTML() {
    return `<div class="steps">${STEPS.map((s, i) => `<div class="step ${i < coStep ? 'done' : i === coStep ? 'cur' : ''}">${num(i + 1)}. ${s}</div>`).join('')}</div>`;
  }

  function renderCheckout() {
    const c = S.customer;
    const t = totals();
    const card = $('#coCard');
    let html = `<button class="icon-btn modal-close" data-close aria-label="إغلاق">${icon('close')}</button><div class="co">`;

    if (lastOrder) {
      const o = lastOrder;
      const wa = waLink(o.message);
      const waBtn = (cls, label) => wa ? `<a class="btn btn-lg ${cls}" href="${esc(wa)}" target="_blank" rel="noopener">${icon('chat')} ${label}</a>` : '';
      let body;
      if (o.channel === 'direct' && o.state === 'sending') {
        body = `<div class="ring sending"><span class="spinner"></span></div>
          <h2>جارٍ إرسال طلبك…</h2><div class="oid">${esc(o.id)}</div>
          <p>لحظات ويصل طلبك إلى ${esc(CFG.brandName || 'ELORA')}.</p>`;
      } else if (o.channel === 'direct' && o.state === 'ok') {
        body = `<div class="ring">${icon('check')}</div>
          <h2>استلمنا طلبك، شكرًا لك!</h2><div class="oid">${esc(o.id)}</div>
          ${trackHTML('جديد')}
          <p class="success-note">سنتواصل معك قريبًا على <b dir="ltr">${esc(latinDigits(S.customer.phone).replace(/\s+/g, ''))}</b> لتأكيد الطلب وترتيب التوصيل. تابع حالة طلبك من «طلباتي».</p>
          <div class="co-actions" style="margin-top:20px">${waBtn('btn-ghost', 'أرسل نسخة عبر واتساب لتأكيد أسرع')}</div>
          <div class="co-actions"><button class="btn btn-lg" data-close>متابعة التسوق</button></div>`;
      } else if (o.channel === 'direct' && o.state === 'fail') {
        body = `<div class="ring warn">${icon('chat')}</div>
          <h2>لم يكتمل الإرسال المباشر</h2><div class="oid">${esc(o.id)}</div>
          <p>يبدو أن الاتصال ضعيف. طلبك محفوظ، أرسله الآن عبر واتساب بضغطة واحدة.</p>
          <div class="co-actions" style="margin-top:20px">${waBtn('', 'إرسال الطلب عبر واتساب')}</div>
          <div class="co-actions"><button class="btn btn-ghost btn-lg" id="retryOrder">إعادة المحاولة</button><button class="btn btn-ghost btn-lg" id="copyOrder">${icon('receipt')} نسخ الطلب</button></div>`;
      } else {
        body = `<div class="ring">${icon('check')}</div>
          <h2>خطوة أخيرة!</h2><div class="oid">${esc(o.id)}</div>
          <ol class="next-steps">
            <li><b>اضغط «إرسال»</b> في واتساب، فرسالة طلبك جاهزة هناك.</li>
            <li>نراجع طلبك ونتواصل معك <b>لتأكيده</b> وترتيب التوصيل.</li>
            <li>احتفظ برقم الطلب، وتجده دائمًا في <b>«طلباتي»</b>.</li>
          </ol>
          <div class="co-actions" style="margin-top:22px">${waBtn('', 'فتح واتساب وإرسال الطلب')}</div>
          <div class="co-actions"><button class="btn btn-ghost btn-lg" id="copyOrder">${icon('receipt')} نسخ تفاصيل الطلب</button><button class="btn btn-ghost btn-lg" data-close>متابعة التسوق</button></div>`;
      }
      card.innerHTML = html + `<div class="success">${body}</div></div>`;
      return;
    }

    html += `<h2>إتمام الطلب</h2><p class="co-sub">ثلاث خطوات سريعة ويصلنا طلبك.</p>${stepsHTML()}`;

    if (coStep === 0) {
      html += `<form class="co-form" id="coForm" novalidate>
        <label class="field"><span>الاسم الكامل</span><input name="name" required autocomplete="name" value="${esc(c.name || '')}"><span class="err">اكتب اسمك من فضلك</span></label>
        <label class="field"><span>رقم الجوال <small>(واتساب)</small></span><input name="phone" type="tel" required inputmode="tel" autocomplete="tel" dir="ltr" style="text-align:right" placeholder="7XX XXX XXX" value="${esc(c.phone || '')}" pattern="[0-9٠-٩+\\s\\-]{7,}"><span class="err">اكتب رقم جوال صحيحًا</span></label>
        <label class="opt"><input type="checkbox" name="remember" ${c.remember !== false ? 'checked' : ''}> احفظ بياناتي على هذا الجهاز للطلبات القادمة</label>
        <div class="co-actions"><button class="btn btn-lg" type="submit">متابعة ${icon('next')}</button></div>
      </form>`;
    } else if (coStep === 1) {
      const zs = zones();
      html += `<form class="co-form" id="coForm" novalidate>
        ${zs.length ? `<div class="field"><span>منطقة التوصيل</span><div class="radio-cards">${zs.map((z) => `
          <label class="radio-card"><input type="radio" name="zone" value="${esc(z.name)}" ${S.zone === z.name ? 'checked' : ''} required> ${esc(z.name)}
          <small>${t.free ? 'مجاني' : z.fee ? money(z.fee) : 'مجاني'}</small></label>`).join('')}</div><span class="err">اختر منطقة التوصيل</span></div>` : ''}
        <label class="field"><span>المدينة</span><input name="city" required autocomplete="address-level2" value="${esc(c.city || '')}"><span class="err">اكتب المدينة</span></label>
        <label class="field"><span>العنوان بالتفصيل <small>(الحي، الشارع، أقرب معلم)</small></span><textarea name="address" rows="2" required autocomplete="street-address">${esc(c.address || '')}</textarea><span class="err">اكتب عنوان التوصيل</span></label>
        <label class="field"><span>ملاحظات للطلب <small>(اختياري)</small></span><textarea name="notes" rows="2" placeholder="مثال: وقت مناسب للتوصيل، لون مفضل…">${esc(c.notes || '')}</textarea></label>
        <div class="co-actions"><button class="btn btn-ghost btn-lg" type="button" data-co-back>${icon('prev')} رجوع</button><button class="btn btn-lg" type="submit">مراجعة الطلب ${icon('next')}</button></div>
      </form>`;
    } else {
      const pays = SHOP.payments || [];
      html += `<div class="co-form">
        <div class="review-list">${t.lines.map((l) => `<div class="review-item"><img src="${esc(l.p.thumb)}" alt=""><span>${esc(l.p.title)} <small style="color:var(--muted)">× ${num(l.q)}</small></span><b>${l.p.price != null ? money(l.p.price * l.q) : 'عند الطلب'}</b></div>`).join('')}</div>
        <div class="review-who"><button data-co-goto="0">تعديل</button><b>${esc(c.name)}</b> · <span dir="ltr">${esc(c.phone)}</span><br>${esc([S.zone, c.city, c.address].filter(Boolean).join(' — '))}
          ${S.gift.on ? `<br>${icon('gift')} تغليف هدية${S.gift.note ? `: «${esc(S.gift.note)}»` : ''}` : ''}</div>
        ${pays.length ? `<div class="field"><span>طريقة الدفع</span><div class="radio-cards">${pays.map((p) => `<label class="radio-card"><input type="radio" name="pay" value="${esc(p)}" ${S.payment === p ? 'checked' : ''}> ${esc(p)}</label>`).join('')}</div></div>` : ''}
        <div style="display:flex;flex-direction:column;gap:8px">${summaryHTML(t, { withZone: true })}</div>
        ${hasEndpoint() ? `<div class="field"><span>كيف تريد إرسال طلبك؟</span>
          <div class="channel-cards">
            <label class="channel-card"><input type="radio" name="channel" value="direct" ${S.channel === 'direct' ? 'checked' : ''}>
              <span class="ch-ico">${icon('bag')}</span><b>مباشرة إلى المتجر</b><small>يصلنا فورًا بضغطة واحدة، ولا يحتاج واتساب</small><em>الأسرع</em></label>
            <label class="channel-card"><input type="radio" name="channel" value="whatsapp" ${S.channel === 'whatsapp' ? 'checked' : ''}>
              <span class="ch-ico wa">${icon('chat')}</span><b>عبر واتساب</b><small>تُفتح محادثة معنا ورسالة الطلب جاهزة</small></label>
          </div></div>` : ''}
        <details class="wa-preview" id="waPreview" ${S.channel === 'whatsapp' ? '' : 'hidden'}>
          <summary>${icon('chat')} معاينة رسالة الطلب <small>كما ستصل إلى ${esc(CFG.brandName || 'ELORA')}</small></summary>
          <div class="wa-chat"><div class="wa-bubble" id="waBubble">${waPreviewHTML(buildMessage(pendingOrder().id, t, pendingOrder().at))}</div></div>
        </details>
        <input type="text" name="website" id="hp" tabindex="-1" autocomplete="off" class="hp" aria-hidden="true">
        <div class="co-actions"><button class="btn btn-ghost btn-lg" type="button" data-co-back>${icon('prev')} رجوع</button><button class="btn btn-lg" id="placeOrder">${placeLabel()}</button></div>
      </div>`;
    }
    html += '</div>';
    card.innerHTML = html;
    card.scrollTop = 0;
    const first = card.querySelector('input:not([type=checkbox]):not([type=radio]), textarea');
    if (first && !first.value && matchMedia('(pointer:fine)').matches) setTimeout(() => first.focus(), 80);
  }

  function validate(form) {
    let ok = true;
    $$('.field', form).forEach((f) => {
      const inputs = $$('input,textarea,select', f).filter((i) => i.required);
      if (!inputs.length) return;
      let valid;
      if (inputs[0].type === 'radio') valid = inputs.some((i) => i.checked);
      else valid = inputs.every((i) => i.value.trim() && i.checkValidity());
      f.classList.toggle('invalid', !valid);
      if (!valid && ok) { ok = false; (inputs[0]).focus(); }
    });
    return ok;
  }

  function onCheckoutSubmit(form) {
    if (!validate(form)) return;
    const fd = new FormData(form);
    if (coStep === 0) {
      S.customer = { ...S.customer, name: fd.get('name').trim(), phone: fd.get('phone').trim(), remember: !!fd.get('remember') };
    } else if (coStep === 1) {
      if (fd.has('zone')) { S.zone = fd.get('zone'); save('zone'); }
      S.customer = { ...S.customer, city: fd.get('city').trim(), address: fd.get('address').trim(), notes: (fd.get('notes') || '').trim() };
    }
    persistCustomer();
    coStep++;
    renderCheckout();
  }
  function persistCustomer() {
    if (S.customer.remember === false) store.set('customer', { remember: false });
    else { const { notes, ...keep } = S.customer; store.set('customer', keep); }
  }

  function orderId() {
    const d = new Date();
    const p2 = (n) => String(n).padStart(2, '0');
    const rnd = Array.from(crypto.getRandomValues(new Uint8Array(5)), (b) => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[b % 32]).join('');
    return `EL-${String(d.getFullYear()).slice(2)}${p2(d.getMonth() + 1)}${p2(d.getDate())}-${rnd}`;
  }
  /* رسالة الطلب
   * تُستخدم رموز من النطاق الأساسي فقط (✿ ◆ ✓ ┄) لأن الرموز التعبيرية الملوّنة
   * تظهر «�» في بعض نسخ واتساب عند فتحها من رابط. التنسيق بصيغة واتساب: *عريض* و _مائل_.
   */
  const latinDigits = (s) => String(s || '').replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(/[۰-۹]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d));
  const oneLine = (s) => String(s || '').replace(/\s*\n+\s*/g, ' — ').trim();
  function buildMessage(id, t, at = new Date()) {
    const c = S.customer;
    const brand = CFG.brandName || 'ELORA';
    const SEP = '┄┄┄┄┄┄┄┄┄┄┄┄┄┄';
    const priced = t.lines.filter((l) => l.p.price != null);
    const when = at.toLocaleString('ar-u-nu-arab', { day: 'numeric', month: 'long', year: 'numeric', hour: 'numeric', minute: '2-digit' });
    const L = [];

    L.push(`✿ *${brand}* ✿`);
    L.push('*طلب جديد من المتجر*');
    L.push('');
    L.push('السلام عليكم ورحمة الله،');
    L.push('أرغب بتأكيد الطلب التالي:');
    L.push('');
    L.push(`*رقم الطلب:* ${id}`);
    L.push(`*التاريخ:* ${when}`);

    // القطع
    L.push(SEP);
    L.push(`*◆ القطع المطلوبة (${num(t.count)})*`);
    t.lines.forEach((l, i) => {
      L.push('');
      L.push(`*${num(i + 1)}. ${l.p.title}*`);
      if (l.p.price == null) {
        L.push(`الكمية: ${num(l.q)}  ·  السعر يُحدَّد عند التأكيد`);
      } else {
        const unit = `${l.p.from ? 'يبدأ من ' : ''}${money(l.p.price)}`;
        if (l.q > 1) {
          L.push(`الكمية: ${num(l.q)}  ·  سعر القطعة: ${unit}`);
          L.push(`المجموع: *${money(l.p.price * l.q)}*`);
        } else {
          L.push(`الكمية: ${num(l.q)}  ·  السعر: ${unit}`);
        }
      }
      L.push(productLink(l.p));
    });

    // الحساب
    L.push(SEP);
    L.push('*◆ ملخص الحساب*');
    if (!priced.length) {
      L.push('السعر يُحدَّد عند تأكيد الطلب');
      if (t.zone) L.push(`التوصيل (${t.zone.name}): ${t.ship === 0 ? 'مجاني ✓' : money(t.ship)}`);
      if (t.gw) L.push(`تغليف الهدية: ${money(t.gw)}`);
    } else {
      L.push(`المجموع${t.unpriced ? ' (للقطع المسعّرة)' : ''}: ${money(t.sub)}`);
      if (t.discount) L.push(`الخصم: − ${money(t.discount)}  (كوبون ${S.coupon})`);
      if (t.gw) L.push(`تغليف الهدية: ${money(t.gw)}`);
      if (t.zone) L.push(`التوصيل (${t.zone.name}): ${t.ship === 0 ? 'مجاني ✓' : money(t.ship)}`);
      L.push(`*الإجمالي${t.unpriced ? ' المبدئي' : ' المستحق'}: ${money(t.total)}*`);
      if (t.unpriced) L.push('_يُضاف سعر بقية القطع عند التأكيد_');
      if (priced.some((l) => l.p.from)) L.push('_بعض الأسعار تبدأ من القيمة المذكورة_');
    }
    if (S.payment) L.push(`طريقة الدفع: ${S.payment}`);

    // التوصيل
    L.push(SEP);
    L.push('*◆ بيانات التوصيل*');
    L.push(`الاسم: ${oneLine(c.name)}`);
    L.push(`الجوال: ${latinDigits(c.phone).replace(/\s+/g, '')}`);
    if (S.zone) L.push(`المنطقة: ${S.zone}`);
    if (c.city) L.push(`المدينة: ${oneLine(c.city)}`);
    if (c.address) L.push(`العنوان: ${oneLine(c.address)}`);
    if (c.notes) L.push(`ملاحظات: ${oneLine(c.notes)}`);

    // الهدية
    if (S.gift.on) {
      L.push(SEP);
      L.push('*◆ هدية*');
      L.push('تغليف هدية ✓');
      if (S.gift.note) L.push(`رسالة الإهداء: «${oneLine(S.gift.note)}»`);
    }

    L.push(SEP);
    L.push('بانتظار تأكيدكم، وشكرًا لكم ✿');
    return L.join('\n');
  }

  // معاينة الرسالة كما ستظهر في واتساب
  function waPreviewHTML(text) {
    return esc(text)
      .replace(/(^|[\s(])\*([^*\n]+)\*(?=$|[\s).,:،])/gm, '$1<b>$2</b>')
      .replace(/(^|\s)_([^_\n]+)_(?=$|\s)/gm, '$1<i>$2</i>')
      .replace(/(https?:\/\/\S+)/g, '<span class="wa-link">$1</span>')
      .replace(/\n/g, '<br>');
  }
  let pending = null;
  function pendingOrder() {
    if (!pending) pending = { id: orderId(), at: new Date() };
    return pending;
  }

  /* ---------- الإرسال المباشر إلى المتجر (جدول Google) ---------- */
  const hasEndpoint = () => /^https:\/\/\S+$/.test(SHOP.orderEndpoint || '');
  const channel = () => (hasEndpoint() ? (S.channel === 'whatsapp' ? 'whatsapp' : 'direct') : 'whatsapp');
  const placeLabel = () => channel() === 'direct' ? `${icon('check')} تأكيد الطلب` : `${icon('chat')} تأكيد وإرسال عبر واتساب`;

  const TRACK = [['جديد', 'الاستلام'], ['تم التأكيد', 'التأكيد'], ['قيد التجهيز', 'التجهيز'], ['تم الشحن', 'الشحن'], ['تم التسليم', 'التسليم']];
  function trackHTML(status, compact) {
    if (status === 'ملغي') return `<div class="track-cancel">أُلغي هذا الطلب</div>`;
    const cur = Math.max(0, TRACK.findIndex(([s]) => s === status));
    return `<ol class="track${compact ? ' compact' : ''}" aria-label="حالة الطلب: ${esc(TRACK[cur][1])}">${TRACK.map(([, label], i) =>
      `<li class="${i < cur ? 'done' : i === cur ? 'cur' : ''}"><span></span><small>${label}</small></li>`).join('')}</ol>`;
  }

  function orderPayload(id, at, t, ch) {
    const c = S.customer;
    return {
      id, at: at.toISOString(), channel: ch,
      name: c.name, phone: latinDigits(c.phone), zone: S.zone || '', city: c.city || '', address: c.address || '', notes: c.notes || '',
      items: t.lines.map((l) => ({ title: l.p.title, q: l.q, price: l.p.price, from: l.p.from, link: productLink(l.p) })),
      sub: t.sub, discount: t.discount, coupon: t.discount ? S.coupon : '', ship: t.ship,
      giftWrap: !!S.gift.on, giftWrapFee: t.gw, giftNote: S.gift.on ? S.gift.note : '',
      total: t.total, unpriced: t.unpriced, payment: S.payment || '',
      website: ($('#hp') || {}).value || '',
    };
  }
  async function sendToStore(payload) {
    const body = JSON.stringify(payload);
    try {
      // text/plain لا يحتاج إذنًا مسبقًا (preflight) من خوادم Google
      const r = await fetch(SHOP.orderEndpoint, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error || 'rejected');
      return j;
    } catch (err) {
      if (err && err.message && err.message !== 'Failed to fetch' && !(err instanceof SyntaxError)) throw err;
      // بعض المتصفحات تمنع قراءة الرد؛ نرسل مرة أخرى دون قراءته (الجدول يتجاهل الطلب المكرر)
      await fetch(SHOP.orderEndpoint, { method: 'POST', mode: 'no-cors', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body });
      return { ok: true, opaque: true };
    }
  }
  async function submitDirect() {
    if (!lastOrder) return;
    lastOrder.state = 'sending';
    renderCheckout();
    const started = Date.now();
    try { await sendToStore(lastOrder.payload); lastOrder.state = 'ok'; } catch { lastOrder.state = 'fail'; }
    const o = S.orders.find((x) => x.id === lastOrder.id);
    if (o) { o.sent = lastOrder.state === 'ok'; if (o.sent) o.status = o.status || 'جديد'; save('orders'); }
    setTimeout(() => { if (layers.includes('checkout')) renderCheckout(); }, Math.max(0, 900 - (Date.now() - started)));
  }

  let statusFetchedAt = 0;
  async function refreshStatuses() {
    if (!hasEndpoint() || Date.now() - statusFetchedAt < 20000) return;
    const ids = S.orders.slice(0, 20).map((o) => o.id);
    if (!ids.length) return;
    statusFetchedAt = Date.now();
    try {
      const j = await fetch(`${SHOP.orderEndpoint}?ids=${encodeURIComponent(ids.join(','))}`).then((r) => r.json());
      if (!j.ok || !j.statuses) return;
      let changed = false;
      S.orders.forEach((o) => { const st = j.statuses[o.id]; if (st && st !== o.status) { o.status = st; changed = true; } });
      if (changed) { save('orders'); if (drawerMode === 'orders') renderDrawer(); }
    } catch { /* بلا اتصال */ }
  }

  function placeOrder() {
    const pay = $('#coCard input[name="pay"]:checked');
    if (pay) S.payment = pay.value;
    const t = totals();
    const { id, at } = pendingOrder();
    pending = null;
    const ch = channel();
    const message = buildMessage(id, t, at);
    const payload = hasEndpoint() ? orderPayload(id, at, t, ch) : null;
    S.orders.unshift({ id, at: +at, items: t.lines.map((l) => ({ id: l.p.id, q: l.q })), total: t.total, unpriced: t.unpriced, channel: ch });
    S.orders = S.orders.slice(0, 30);
    save('orders');
    lastOrder = { id, message, channel: ch, state: ch === 'direct' ? 'sending' : 'ok', payload };
    if (ch === 'whatsapp') {
      const wa = waLink(message);
      if (wa) window.open(wa, '_blank', 'noopener');
      if (payload) sendToStore(payload).catch(() => {});   // نسخة في جدول الطلبات حتى لو لم يضغط الزبون «إرسال»
    }
    S.cart = {}; save('cart');
    S.coupon = ''; save('coupon');
    S.gift = { on: false, note: '' }; save('gift');
    if (S.customer.notes) { S.customer.notes = ''; persistCustomer(); }
    updateCounts();
    if (ch === 'direct') submitDirect(); else renderCheckout();
  }

  /* ================= البحث ================= */
  let srActive = -1;
  function openSearch() {
    closeMenu();
    openLayer('search', $('#searchOv'));
    const inp = $('#searchInput');
    inp.value = '';
    renderSearch('');
    setTimeout(() => inp.focus(), 60);
  }
  function closeSearch() { closeLayer('search', $('#searchOv')); }
  function highlight(text, q) {
    if (!q) return esc(text);
    // تظليل بسيط على النص الأصلي بمطابقة بعد التطبيع حرفًا بحرف
    const nt = norm(text), nq = norm(q);
    const i = nt.indexOf(nq);
    if (i < 0 || nt.length !== text.length) return esc(text);
    return esc(text.slice(0, i)) + '<mark>' + esc(text.slice(i, i + nq.length)) + '</mark>' + esc(text.slice(i + nq.length));
  }
  function renderSearch(q) {
    const box = $('#searchResults');
    const nq = norm(q);
    srActive = -1;
    if (!nq) {
      const cats = categories();
      const rec = S.recent.map((id) => BY.get(id)).filter(Boolean).slice(0, 4);
      box.innerHTML = `<div class="sr-label">تصفّح حسب الفئة</div><div class="sr-chips">${cats.map(([c]) => `<button class="chip" data-cat-link="${esc(c)}">${esc(c)}</button>`).join('')}</div>
        ${rec.length ? `<div class="sr-label" style="margin-top:18px">شاهدتها مؤخرًا</div>${rec.map((p) => srItem(p, '')).join('')}` : ''}`;
      return;
    }
    const words = nq.split(' ');
    const res = ITEMS.map((p) => {
      let score = 0;
      for (const w of words) {
        if (!p.key.includes(w)) return null;
        score += norm(p.title).startsWith(w) ? 3 : norm(p.title).includes(w) ? 2 : 1;
      }
      return { p, score };
    }).filter(Boolean).sort((a, b) => b.score - a.score).slice(0, 8);
    box.innerHTML = res.length
      ? `<div class="sr-label">${num(res.length)} نتيجة</div>${res.map((r) => srItem(r.p, q)).join('')}`
      : `<div class="empty-state"><div class="ring">${icon('search')}</div><h3>لا نتائج لـ «${esc(q)}»</h3><p>جرّب كلمة أخرى مثل: لؤلؤ، حقيبة، سوار.</p></div>`;
  }
  function srItem(p, q) {
    return `<button class="sr-item" data-open="${esc(p.id)}"><img src="${esc(p.thumb)}" alt="" loading="lazy"><div><b>${highlight(p.title, q)}</b><small>${esc(p.cat)}</small></div>${priceHTML(p)}</button>`;
  }

  /* ================= الأحداث ================= */
  document.addEventListener('click', (e) => {
    const t = e.target;
    const el = (sel) => t.closest(sel);
    let b;

    if ((b = el('[data-add]'))) {
      const card = b.closest('.card, .line');
      addToCart(b.dataset.add, 1, card && card.querySelector('img'));
      return;
    }
    if ((b = el('[data-wish]'))) { toggleWish(b.dataset.wish, b); return; }
    if ((b = el('[data-open]'))) {
      if (layers.includes('search')) closeSearch();
      if (layers.includes('drawer')) closeDrawer();
      openSheet(b.dataset.open);
      return;
    }
    if ((b = el('[data-cat-link]'))) {
      e.preventDefault();
      if (layers.includes('search')) closeSearch();
      closeMenu();
      setCat(b.dataset.catLink, true);
      return;
    }
    if ((b = el('#chips [data-cat]'))) { setCat(b.dataset.cat); return; }
    if ((b = el('[data-open-drawer]'))) { openDrawer(b.dataset.openDrawer); return; }
    if ((b = el('[data-close]'))) {
      const layer = b.closest('#drawer, #menu, #sheet, #checkout, #searchOv');
      if (!layer) return;
      ({ drawer: closeDrawer, menu: closeMenu, sheet: closeSheet, checkout: closeCheckout, searchOv: closeSearch })[layer.id]();
      if (b.dataset.goto) setTimeout(() => $(b.dataset.goto).scrollIntoView({ behavior: reduced ? 'auto' : 'smooth' }), 200);
      return;
    }
    if ((b = el('[data-rail]'))) {
      const r = $('#' + b.dataset.rail);
      r.scrollBy({ left: Number(b.dataset.dir) * r.clientWidth * .8, behavior: 'smooth' });
      return;
    }
    if ((b = el('[data-qty]'))) { setQty(b.dataset.qty, (S.cart[b.dataset.qty] || 0) + Number(b.dataset.d)); return; }
    if ((b = el('[data-rm]'))) {
      const id = b.dataset.rm, q = S.cart[id];
      setQty(id, 0);
      toast('حُذفت القطعة من السلة', { label: 'تراجع', run: () => { S.cart[id] = q; save('cart'); updateCounts(); renderDrawer(); } });
      return;
    }
    if ((b = el('[data-step]'))) { stepSheet(Number(b.dataset.step)); return; }
    if ((b = el('[data-sq]'))) {
      const p = BY.get(sheetId);
      const max = p && p.stock != null ? Math.max(1, p.stock - (S.cart[p.id] || 0)) : 99;
      sheetQty = Math.min(max, Math.max(1, sheetQty + Number(b.dataset.sq)));
      $('#sq').textContent = num(sheetQty);
      return;
    }
    if (el('[data-sheet-add]')) { addToCart(sheetId, sheetQty, $('#zoomBox img')); return; }
    if (el('[data-buy-now]')) {
      const p = BY.get(sheetId);
      if (p && (S.cart[p.id] || canAdd(p, sheetQty))) {
        if (!S.cart[p.id]) { S.cart[p.id] = sheetQty; save('cart'); updateCounts('cart'); }
        closeSheet();
        openCheckout();
      }
      return;
    }
    if ((b = el('[data-share]'))) { share(BY.get(b.dataset.share)); return; }
    if (el('#toCheckout')) { openCheckout(); return; }
    if (el('#wishAll')) {
      let n = 0;
      S.wish.forEach((id) => { const p = BY.get(id); if (p && !S.cart[id] && canAdd(p)) { S.cart[id] = 1; n++; } });
      save('cart'); updateCounts('cart');
      toast(n ? `أُضيفت ${num(n)} ${n > 2 && n < 11 ? 'قطع' : 'قطعة'} إلى السلة` : 'كل القطع موجودة في السلة', { label: 'عرض السلة', run: () => openDrawer('cart') });
      return;
    }
    if ((b = el('[data-reorder]'))) {
      const o = S.orders[Number(b.dataset.reorder)];
      if (!o) return;
      let n = 0;
      o.items.forEach((it) => { const p = BY.get(it.id); if (p && !soldOut(p)) { S.cart[it.id] = p.stock != null ? Math.min(it.q, p.stock) : it.q; n++; } });
      save('cart'); updateCounts('cart');
      if (n) openDrawer('cart'); else toast('القطع في هذا الطلب غير متوفرة حاليًا');
      return;
    }
    if (el('[data-co-back]')) { coStep = Math.max(0, coStep - 1); renderCheckout(); return; }
    if ((b = el('[data-co-goto]'))) { coStep = Number(b.dataset.coGoto); renderCheckout(); return; }
    if (el('#placeOrder')) { placeOrder(); return; }
    if (el('#retryOrder')) { submitDirect(); return; }
    if (el('#copyOrder')) {
      const txt = lastOrder ? lastOrder.message : '';
      (navigator.clipboard ? navigator.clipboard.writeText(txt) : Promise.reject())
        .then(() => toast('تم نسخ تفاصيل الطلب، الصقها في أي محادثة'))
        .catch(() => toast('تعذّر النسخ على هذا الجهاز'));
      return;
    }
    if (el('#searchBtn') || el('#bnSearch')) { openSearch(); return; }
    if (el('#menuBtn')) { openMenu(); return; }
    if (el('#themeBtn') || el('#themeBtnM')) { toggleTheme(); return; }
    if (el('#resetFilters')) { S.inStock = false; $('#inStockOnly').checked = false; setCat('*'); return; }
    if (t === $('#scrim')) {
      if (layers.includes('checkout')) closeCheckout();
      else if (layers.includes('sheet')) closeSheet();
      else { closeDrawer(); closeMenu(); }
      return;
    }
    if (t === $('#searchOv')) { closeSearch(); return; }
    if (t.classList && t.classList.contains('modal')) {
      if (t.id === 'sheet') closeSheet(); else if (t.id === 'checkout') closeCheckout();
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      const top = layers[layers.length - 1];
      ({ drawer: closeDrawer, menu: closeMenu, sheet: closeSheet, checkout: closeCheckout, search: closeSearch })[top]?.();
      return;
    }
    if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('.card-media[data-open]')) { e.preventDefault(); openSheet(e.target.dataset.open); return; }
    if (layers[layers.length - 1] === 'sheet' && (e.key === 'ArrowLeft' || e.key === 'ArrowRight') && !e.target.matches('input,textarea')) {
      stepSheet(e.key === 'ArrowLeft' ? 1 : -1);
      return;
    }
    if (layers.includes('search') && (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter')) {
      const items = $$('#searchResults .sr-item');
      if (!items.length) return;
      if (e.key === 'Enter') { if (srActive > -1) { e.preventDefault(); items[srActive].click(); } return; }
      e.preventDefault();
      srActive = (srActive + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
      items.forEach((it, i) => it.classList.toggle('active', i === srActive));
      items[srActive].scrollIntoView({ block: 'nearest' });
      return;
    }
    if (e.key === '/' && !layers.length && !e.target.matches('input,textarea,select')) { e.preventDefault(); openSearch(); }
  });

  document.addEventListener('submit', (e) => {
    const f = e.target;
    if (f.id === 'coForm') { e.preventDefault(); onCheckoutSubmit(f); }
    if (f.id === 'couponForm') {
      e.preventDefault();
      S.coupon = $('#couponIn').value.trim().toUpperCase();
      save('coupon');
      renderDrawer();
      const t = totals();
      if (t.couponOk) toast(t.couponMsg);
    }
  });

  document.addEventListener('change', (e) => {
    const t = e.target;
    if (t.id === 'giftOn') { S.gift.on = t.checked; save('gift'); renderDrawer(); }
    if (t.id === 'sortSel') { S.sort = t.value; renderGrid(); }
    if (t.id === 'inStockOnly') { S.inStock = t.checked; renderGrid(); }
    if (t.name === 'channel') {
      S.channel = t.value; save('channel');
      $('#placeOrder').innerHTML = placeLabel();
      $('#waPreview').hidden = S.channel !== 'whatsapp';
    }
    if (t.name === 'pay') {
      S.payment = t.value;
      const b = $('#waBubble');
      if (b) b.innerHTML = waPreviewHTML(buildMessage(pendingOrder().id, totals(), pendingOrder().at));
    }
    if (t.name === 'zone') {
      S.zone = t.value; save('zone');
      t.closest('.field')?.classList.remove('invalid');
    }
  });
  document.addEventListener('input', (e) => {
    const t = e.target;
    if (t.id === 'searchInput') renderSearch(t.value);
    if (t.id === 'giftNote') { S.gift.note = t.value; save('gift'); }
    if (t.closest && t.closest('.field.invalid') && t.value.trim()) t.closest('.field').classList.remove('invalid');
  });

  /* ================= الوضع الليلي ================= */
  function syncThemeIcon() {
    const dark = document.documentElement.dataset.theme === 'dark';
    $('#themeBtn use').setAttribute('href', dark ? '#i-sun' : '#i-moon');
    $('#themeBtn').setAttribute('aria-label', dark ? 'الوضع الفاتح' : 'الوضع الليلي');
    $('#themeBtnM use').setAttribute('href', dark ? '#i-sun' : '#i-moon');
    $('#themeBtnM span').textContent = dark ? 'الوضع الفاتح' : 'الوضع الليلي';
    const meta = $('meta[name="theme-color"]');
    if (meta) meta.content = dark ? '#141110' : '#fbf8f6';
  }
  function toggleTheme() {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    const apply = () => { document.documentElement.dataset.theme = next; syncThemeIcon(); };
    store.set('theme', next);
    if (document.startViewTransition && !reduced) document.startViewTransition(apply); else apply();
  }

  /* ================= الترويسة عند التمرير ================= */
  let ticking = false, lastY = 0;
  addEventListener('scroll', () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      $('#hdr').classList.toggle('scrolled', scrollY > 8);
      // على الجوال: زر واتساب يختفي أثناء النزول (لا يغطي الأسعار) ويعود عند الصعود
      const fab = $('#waFab');
      if (innerWidth <= 820) fab.classList.toggle('away', scrollY > lastY && scrollY > 400);
      else fab.classList.remove('away');
      lastY = scrollY;
      ticking = false;
    });
  }, { passive: true });

  /* ================= روابط القطع ================= */
  function routeHash() {
    const s = location.hash.match(/^#i=([a-z0-9]+)$/);
    const m = location.hash.match(/^#p=(.+)$/);   // روابط قديمة
    const p = s ? BYSID.get(s[1]) : m ? BY.get(decodeURIComponent(m[1])) : null;
    if (p) openSheet(p.id, { push: false });
    else if (!s && !m && layers.includes('sheet')) closeSheet();
  }
  addEventListener('hashchange', routeHash);

  /* ================= تطبيق قابل للتثبيت ================= */
  let deferredPrompt = null;
  addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    $('#installBtn').hidden = false;
  });
  $('#installBtn').addEventListener('click', async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    deferredPrompt = null;
    $('#installBtn').hidden = true;
  });
  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
  }

  /* ================= الإقلاع ================= */
  (async function boot() {
    syncThemeIcon();
    $('#grid').innerHTML = skeletons(8);
    $('#picksRail').innerHTML = skeletons(4);
    const shopRes = await getWithFallback('shop.json', {});
    SHOP = shopRes.data || {};
    if (SHOP.digits === 'latn') NF = new Intl.NumberFormat('en');
    const [cfgRes, dataRes] = await Promise.all([
      getWithFallback('site.config.json', {}),
      getWithFallback('data.json', { items: [] }),
    ]);
    CFG = cfgRes.data || {};
    BASE = dataRes.base || cfgRes.base || '';
    if (cfgRes.base && CFG.logo) CFG.logo = cfgRes.base + CFG.logo;
    buildItems(dataRes.data || { items: [] });

    renderChrome();
    renderCatalogChrome();
    $('#sortSel').value = S.sort;
    renderGrid();
    renderRecent();
    updateCounts();
    routeHash();
    // رابط مباشر لقسم (#shop مثلًا): مرّر إليه بعد اكتمال المحتوى
    if (/^#[a-z][\w-]*$/i.test(location.hash)) $(location.hash)?.scrollIntoView();
  })();
})();
