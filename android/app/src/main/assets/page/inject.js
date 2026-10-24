// Enex Android — Discord sayfasına belge başında eklenen betik.
// Masaüstündeki discord-preload.js'in karşılığı. Sayfanın kendi dünyasında çalışır.
// Uygulamayla konuşma: EnexNative.postMessage(...) (sadece discord.com kökenine açık).
// Token'a, mesajlara ya da hesap ayarlarına dokunmaz.
(function () {
  'use strict';
  if (window.top !== window || window.__enex) return;
  const IS_POPOUT = location.pathname.startsWith('/popout');
  if (IS_POPOUT) return;
  window.__enex = true;

  const native = window.EnexNative;
  const send = (o) => { try { native && native.postMessage(JSON.stringify(o)); } catch (_) {} };
  const log = (...a) => { try { console.log('[Enex]', ...a); } catch (_) {} };

  let state = null;            // uygulamadan gelen son durum
  let labels = { volWarn: '', volDanger: '' };

  function onBody(fn) {
    if (document.body) fn();
    else document.addEventListener('DOMContentLoaded', fn, { once: true });
  }
  // Belge başında <html> bile henüz olmayabilir: belgenin kendisini izle
  function onHead(fn) {
    if (document.head) fn();
    else {
      const mo = new MutationObserver(() => { if (document.head) { mo.disconnect(); fn(); } });
      mo.observe(document, { childList: true, subtree: true });
    }
  }

  /* =====================================================================
     TEMA
     CSS "constructable stylesheet" ile eklenir: Discord'un güvenlik politikası (CSP)
     bunu engellemez. Olmazsa <style> etiketine düşülür.
     ===================================================================== */
  let sheet = null;
  let styleEl = null;
  function applyCss(css) {
    try {
      if (!sheet) {
        sheet = new CSSStyleSheet();
        document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
      }
      sheet.replaceSync(css);
      // Discord kendi adoptedStyleSheets listesini değiştirirse bizimkini geri koy
      if (!document.adoptedStyleSheets.includes(sheet)) {
        document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
      }
      return;
    } catch (_) { sheet = null; }
    onHead(() => {
      if (!styleEl) {
        styleEl = document.createElement('style');
        styleEl.id = 'enex-theme';
      }
      styleEl.textContent = css;
      if (styleEl.parentNode !== document.head) document.head.appendChild(styleEl);
    });
  }

  function applyFlags(s) {
    const h = document.documentElement;
    const f = { 'data-nx-fx': s.flags.fx, 'data-nx-cards': s.flags.cards, 'data-nx-clean': s.flags.clean, 'data-nx-mobile': s.view.mode === 'mobile' };
    for (const [k, v] of Object.entries(f)) {
      if (v) h.setAttribute(k, ''); else h.removeAttribute(k);
    }
    h.setAttribute('data-nx-theme', s.theme);
    h.setAttribute('data-nx-android', '');
  }

  /* ---------- Görüntü alanı (viewport) ----------
     Mobil: telefon genişliği / ölçek. Masaüstü: geniş sayfa, iki parmakla yakınlaştırma. */
  let vpMeta = null;
  function viewportContent(v) {
    if (v.mode === 'desktop') return `width=${v.width}, user-scalable=yes, minimum-scale=0.1, maximum-scale=4`;
    return `width=${v.width}, user-scalable=no`;
  }
  function applyViewport(v) {
    onHead(() => {
      document.querySelectorAll('meta[name="viewport"]').forEach((m) => { if (m !== vpMeta) m.remove(); });
      if (!vpMeta) {
        vpMeta = document.createElement('meta');
        vpMeta.name = 'viewport';
        vpMeta.dataset.nx = '';
      }
      const c = viewportContent(v);
      if (vpMeta.content !== c) vpMeta.content = c;
      if (vpMeta.parentNode !== document.head) document.head.appendChild(vpMeta);
    });
  }
  onHead(() => {
    new MutationObserver(() => {
      if (!state) return;
      const others = [...document.querySelectorAll('meta[name="viewport"]')].filter((m) => m !== vpMeta);
      if (others.length || (vpMeta && vpMeta.parentNode !== document.head)) applyViewport(state.view);
    }).observe(document.head, { childList: true });
  });

  /* =====================================================================
     DUVAR KAĞIDI + YAPRAK YAĞMURU (Anime teması)
     Duvar kağıdı discord.com/__enex/wall/... adresinden gelir; uygulama bu isteği
     yakalayıp dosyayı verir (aynı köken olduğu için Discord'un CSP'sine takılmaz).
     ===================================================================== */
  let wallState = null;
  function renderWall() {
    onBody(() => {
      let host = document.getElementById('enex-wall');
      if (!wallState) {
        if (host) host.remove();
        stopPetals();
        return;
      }
      if (!host) {
        host = document.createElement('div');
        host.id = 'enex-wall';
        document.body.prepend(host);
      }
      const { src, kind, dim, kenburns } = wallState;
      const paused = wallState.paused;
      let media = host.querySelector('[data-nx-media]');
      if (!media || media.dataset.src !== src || media.dataset.kind !== kind) {
        if (media) media.remove();
        media = document.createElement(kind === 'video' ? 'video' : 'img');
        media.dataset.nxMedia = '';
        media.dataset.src = src;
        media.dataset.kind = kind;
        media.className = 'nx-wall-media';
        if (kind === 'video') {
          media.muted = true;
          media.loop = true;
          media.playsInline = true;
          media.setAttribute('playsinline', '');
          media.autoplay = !paused;
        }
        media.style.opacity = '0';
        const show = () => { media.style.opacity = '1'; };
        media.addEventListener(kind === 'video' ? 'loadeddata' : 'load', show, { once: true });
        media.src = src;
        host.prepend(media);
      }
      media.classList.toggle('nx-kenburns', Boolean(kenburns) && kind === 'image' && !paused);
      if (kind === 'video') {
        if (paused || document.hidden) media.pause();
        else media.play().catch(() => {});
      }
      let shade = host.querySelector('.nx-wall-shade');
      if (!shade) {
        shade = document.createElement('div');
        shade.className = 'nx-wall-shade';
        host.appendChild(shade);
      }
      shade.style.opacity = String(dim ?? 0.2);
      if (paused) stopPetals();
      else startPetals(host);
    });
  }

  let petalCanvas = null;
  let petalRAF = 0;
  let petals = [];
  let lastT = 0;
  function makePetal(w, h, anywhere) {
    const size = 7 + Math.random() * 11;
    return {
      x: Math.random() * w * 1.2 - w * 0.1,
      y: anywhere ? Math.random() * h : -20 - Math.random() * h * 0.3,
      size,
      vy: 22 + Math.random() * 38 + size * 1.5,
      vx: 10 + Math.random() * 25,
      swayAmp: 18 + Math.random() * 40,
      swayFreq: 0.4 + Math.random() * 0.8,
      phase: Math.random() * Math.PI * 2,
      rot: Math.random() * Math.PI * 2,
      vrot: (Math.random() - 0.5) * 2.4,
      flip: Math.random() * Math.PI * 2,
      vflip: 1.2 + Math.random() * 2,
      hue: 330 + Math.random() * 20,
      light: 78 + Math.random() * 12,
      alpha: 0.55 + Math.random() * 0.4
    };
  }
  function resizeCanvas() {
    if (!petalCanvas) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    petalCanvas.width = Math.round(innerWidth * dpr);
    petalCanvas.height = Math.round(innerHeight * dpr);
    petalCanvas.getContext('2d').setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  function startPetals(host) {
    if (!petalCanvas) {
      petalCanvas = document.createElement('canvas');
      petalCanvas.className = 'nx-petals';
      window.addEventListener('resize', resizeCanvas);
    }
    if (petalCanvas.parentElement !== host) host.appendChild(petalCanvas);
    resizeCanvas();
    // Telefonda daha az yaprak: pil ve ısı
    const count = Math.round(Math.min(40, Math.max(18, (innerWidth * innerHeight) / 26000)));
    if (petals.length !== count) petals = Array.from({ length: count }, () => makePetal(innerWidth, innerHeight, true));
    if (!petalRAF && !document.hidden) {
      lastT = performance.now();
      petalRAF = requestAnimationFrame(tick);
    }
  }
  function stopPetals() {
    if (petalRAF) cancelAnimationFrame(petalRAF);
    petalRAF = 0;
    if (petalCanvas) {
      petalCanvas.getContext('2d').clearRect(0, 0, petalCanvas.width, petalCanvas.height);
      petalCanvas.remove();
    }
  }
  function tick(t) {
    const dt = Math.min(0.05, (t - lastT) / 1000);
    lastT = t;
    const w = innerWidth;
    const h = innerHeight;
    const ctx = petalCanvas.getContext('2d');
    ctx.clearRect(0, 0, w, h);
    const time = t / 1000;
    for (let i = 0; i < petals.length; i++) {
      const p = petals[i];
      p.y += p.vy * dt;
      p.x += (p.vx + Math.sin(time * p.swayFreq + p.phase) * p.swayAmp) * dt;
      p.rot += p.vrot * dt;
      p.flip += p.vflip * dt;
      if (p.y > h + 30 || p.x > w + 40) petals[i] = makePetal(w, h, false);
      const sx = Math.cos(p.flip);
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.scale(0.35 + 0.65 * Math.abs(sx), 1);
      ctx.globalAlpha = p.alpha;
      ctx.fillStyle = `hsl(${p.hue} 90% ${p.light}%)`;
      const s = p.size;
      ctx.beginPath();
      ctx.moveTo(0, -s);
      ctx.bezierCurveTo(s * 0.7, -s * 0.8, s * 0.8, s * 0.3, 0, s);
      ctx.bezierCurveTo(-s * 0.8, s * 0.3, -s * 0.7, -s * 0.8, 0, -s);
      ctx.fill();
      ctx.restore();
    }
    petalRAF = requestAnimationFrame(tick);
  }

  /* =====================================================================
     ODAK / GÖRÜNÜRLÜK
     Uygulama arka plana geçince sayfa "gizli" olur. Discord bildirimleri sadece
     pencere odakta değilken gösterir; bu yüzden gizliyken hasFocus() yanlış döner.
     ===================================================================== */
  try {
    const origHasFocus = Document.prototype.hasFocus;
    Document.prototype.hasFocus = function () { return !document.hidden && origHasFocus.call(this); };
  } catch (_) {}
  document.addEventListener('visibilitychange', () => {
    try { window.dispatchEvent(new Event(document.hidden ? 'blur' : 'focus')); } catch (_) {}
    const v = document.querySelector('#enex-wall video');
    if (!wallState) return;
    if (document.hidden) {
      if (v) v.pause();
      if (petalRAF) { cancelAnimationFrame(petalRAF); petalRAF = 0; }
    } else if (!wallState.paused) {
      if (v) v.play().catch(() => {});
      const host = document.getElementById('enex-wall');
      if (host) startPetals(host);
    }
  });

  /* =====================================================================
     BİLDİRİMLER
     Android WebView'da Notification API yok. Discord'un oluşturduğu bildirimler
     uygulamaya iletilir, telefonun bildirimi olarak gösterilir. Dokununca Discord'un
     kendi "tıklandı" işleyicisi çalışır (ilgili kanala gider).
     ===================================================================== */
  const notifs = new Map();
  let notifSeq = 0;
  class EnexNotification extends EventTarget {
    constructor(title, opts) {
      super();
      opts = opts || {};
      this.title = String(title || '');
      this.body = String(opts.body || '');
      this.icon = String(opts.icon || '');
      this.tag = String(opts.tag || '');
      this.data = opts.data;
      this.silent = Boolean(opts.silent);
      this.onclick = null; this.onclose = null; this.onshow = null; this.onerror = null;
      this.__id = ++notifSeq;
      notifs.set(this.__id, this);
      if (notifs.size > 60) notifs.delete(notifs.keys().next().value);
      send({ t: 'notify', id: this.__id, title: this.title.slice(0, 200), body: this.body.slice(0, 1000), icon: this.icon, tag: this.tag.slice(0, 100) });
      setTimeout(() => { this.dispatchEvent(new Event('show')); if (typeof this.onshow === 'function') this.onshow(new Event('show')); }, 0);
    }
    // Discord birkaç saniye sonra kapatır; telefonda bildirim, kullanıcı kaldırana kadar kalsın.
    close() {}
    static get permission() { return 'granted'; }
    static requestPermission(cb) {
      if (typeof cb === 'function') cb('granted');
      return Promise.resolve('granted');
    }
    static get maxActions() { return 0; }
  }
  try {
    Object.defineProperty(window, 'Notification', { value: EnexNotification, configurable: true, writable: true });
  } catch (_) {}
  window.__enexNotifClick = (id) => {
    const n = notifs.get(Number(id));
    if (!n) return;
    try {
      const ev = new Event('click', { cancelable: true });
      n.dispatchEvent(ev);
      if (typeof n.onclick === 'function') n.onclick(ev);
    } catch (err) { log('bildirim tıklaması', err); }
  };

  /* =====================================================================
     İNDİRME (blob: adresleri)
     ===================================================================== */
  window.__enexSaveBlob = async (url, name) => {
    try {
      const blob = await (await fetch(url)).blob();
      const data = await new Promise((res, rej) => {
        const r = new FileReader();
        r.onload = () => res(String(r.result).split(',')[1] || '');
        r.onerror = rej;
        r.readAsDataURL(blob);
      });
      send({ t: 'save', name: String(name || 'enex-dosya'), mime: blob.type || 'application/octet-stream', data });
    } catch (err) {
      send({ t: 'log', msg: 'blob indirilemedi: ' + (err && err.message) });
    }
  };

  /* =====================================================================
     MOBİL DÜZEN
     Discord'un web arayüzü geniş ekran için. Mobilde tek sütun: sohbet ya da
     (çekmece açıkken) sunucular + kanallar. Sınıf adları değişse de çalışsın diye
     parçalar içerikten bulunur ve data-nx-m ile işaretlenir; CSS bunlara bakar.
     ===================================================================== */
  const H = () => document.documentElement;
  const isMobile = () => Boolean(state && state.view.mode === 'mobile');
  const drawerOpen = () => H().hasAttribute('data-nx-drawer');
  let drawerWanted = null; // ilk açılışta çekmece açık başlasın

  function setDrawer(open) {
    if (open) H().setAttribute('data-nx-drawer', ''); else H().removeAttribute('data-nx-drawer');
    if (open) H().removeAttribute('data-nx-members');
    send({ t: 'drawer', open: Boolean(open) });
  }
  window.__enexDrawer = (v) => {
    if (!isMobile() || !H().hasAttribute('data-nx-shell')) return 'none';
    setDrawer(v === 'toggle' ? !drawerOpen() : Boolean(v));
    return drawerOpen() ? 'open' : 'closed';
  };

  const PAGE_SEL = '[class^="page_"], [class*=" page_"]';
  const NAV_SEL = 'nav[class*="guilds_"], [data-list-id="guildsnav"]';
  const LIST_SEL = '[class^="sidebarList_"], [class*=" sidebarList_"], [class^="privateChannels_"], [class*=" privateChannels_"], #channels';
  const PANELS_SEL = 'section[class*="panels_"]';
  const MEMBERS_SEL = '[class^="membersWrap_"], [class*=" membersWrap_"], [class*="profilePanel_"], [class^="userPanelOuter_"], [class*=" userPanelOuter_"]';

  function clearMarks() {
    document.querySelectorAll('[data-nx-m], [data-nx-grow]').forEach((n) => { n.removeAttribute('data-nx-m'); n.removeAttribute('data-nx-grow'); });
  }
  function containsAny(node, list) {
    for (const x of list) if (x && (node === x || node.contains(x))) return true;
    return false;
  }
  let lastShell = false;
  function markLayout() {
    if (!document.body) return;
    const page = document.querySelector(PAGE_SEL);
    const nav = document.querySelector(NAV_SEL);
    const list = document.querySelector(LIST_SEL);
    const panels = document.querySelector(PANELS_SEL);
    const markers = [nav, list, panels].filter(Boolean);
    if (!page || !markers.length) {
      if (lastShell) { clearMarks(); H().removeAttribute('data-nx-shell'); lastShell = false; }
      return;
    }
    // Sayfadan yukarı çık; her seviyede kenar çubuğu parçası içeren kardeşleri "side" yap
    const sides = new Set();
    const mains = new Set();
    let node = page;
    while (node && node.parentElement && node !== document.body) {
      const parent = node.parentElement;
      let found = false;
      for (const sib of parent.children) {
        if (sib === node) continue;
        if (containsAny(sib, markers)) { sides.add(sib); found = true; }
      }
      if (found) mains.add(node);
      if (markers.every((m) => parent.contains(m))) break;
      node = parent;
    }
    if (!sides.size) return;
    for (const n of document.querySelectorAll('[data-nx-m="side"], [data-nx-m="main"]')) {
      if (!sides.has(n) && !mains.has(n)) n.removeAttribute('data-nx-m');
    }
    sides.forEach((n) => { if (n.getAttribute('data-nx-m') !== 'side') n.setAttribute('data-nx-m', 'side'); });
    mains.forEach((n) => { if (n.getAttribute('data-nx-m') !== 'main') n.setAttribute('data-nx-m', 'main'); });
    // Kanal listesi çekmecede genişlesin: listeden çekmece köküne kadar
    document.querySelectorAll('[data-nx-grow]').forEach((n) => n.removeAttribute('data-nx-grow'));
    const growFrom = list || (nav && nav.nextElementSibling);
    if (growFrom) {
      let g = growFrom;
      while (g && g !== document.body) {
        g.setAttribute('data-nx-grow', '');
        if (sides.has(g)) break;
        g = g.parentElement;
      }
    }
    document.querySelectorAll(MEMBERS_SEL).forEach((n) => {
      if (n.getAttribute('data-nx-m') !== 'members') n.setAttribute('data-nx-m', 'members');
    });
    if (!lastShell) {
      H().setAttribute('data-nx-shell', '');
      lastShell = true;
      if (drawerWanted == null) { drawerWanted = false; if (isMobile()) setDrawer(true); }
    }
  }
  let markTimer = 0;
  function scheduleMark() {
    if (markTimer) return;
    markTimer = setTimeout(() => { markTimer = 0; try { markLayout(); } catch (_) {} }, 120);
  }
  onBody(() => {
    new MutationObserver(scheduleMark).observe(document.body, { childList: true, subtree: true });
    scheduleMark();
  });

  // Kanal ya da DM seçilince çekmece kapanır, sohbet görünür
  document.addEventListener('click', (e) => {
    if (!isMobile() || !drawerOpen()) return;
    const a = e.target.closest && e.target.closest('a[href^="/channels/"]');
    if (!a || a.closest('[data-list-item-id^="guildsnav"]') || a.closest(NAV_SEL)) return;
    if (!a.closest('[data-nx-m="side"]')) return;
    setTimeout(() => setDrawer(false), 60);
  }, true);

  // Üye listesi: Discord'un "üye listesi" düğmesine basınca kayan panel olarak açılır
  const MEMBER_BTN = /member|üye|mitglied|membre|miembro|membro|участник/i;
  document.addEventListener('click', (e) => {
    if (!isMobile()) return;
    const scrim = e.target.closest && e.target.closest('#enex-scrim');
    if (scrim) { H().removeAttribute('data-nx-members'); e.preventDefault(); e.stopPropagation(); return; }
    const b = e.target.closest && e.target.closest('[role="button"][aria-label], button[aria-label]');
    if (!b || !MEMBER_BTN.test(b.getAttribute('aria-label') || '')) return;
    if (!b.closest('section[class*="title_"], [class*="toolbar_"], [class*="upperContainer"]')) return;
    if (H().hasAttribute('data-nx-members')) H().removeAttribute('data-nx-members');
    else { H().setAttribute('data-nx-members', ''); e.preventDefault(); e.stopPropagation(); }
  }, true);
  onBody(() => {
    const scrim = document.createElement('div');
    scrim.id = 'enex-scrim';
    document.body.appendChild(scrim);
  });

  // Kaydırma: sağa → çekmece, sola → sohbet
  let touch = null;
  const NO_SWIPE = 'input, textarea, [contenteditable="true"], [role="slider"], video, [class*="scroller_"][class*="horizontal"], [class*="carousel"], [class*="imageWrapper_"]';
  document.addEventListener('touchstart', (e) => {
    if (!isMobile() || e.touches.length !== 1 || !H().hasAttribute('data-nx-shell')) { touch = null; return; }
    if (e.target.closest && e.target.closest(NO_SWIPE)) { touch = null; return; }
    const t0 = e.touches[0];
    touch = { x: t0.clientX, y: t0.clientY, t: Date.now() };
  }, { passive: true, capture: true });
  document.addEventListener('touchend', (e) => {
    if (!touch) return;
    const t1 = e.changedTouches[0];
    const dx = t1.clientX - touch.x;
    const dy = t1.clientY - touch.y;
    const dt = Date.now() - touch.t;
    touch = null;
    if (dt > 600 || Math.abs(dx) < 70 || Math.abs(dy) > Math.abs(dx) * 0.55) return;
    if (layerOpen()) return;
    if (dx > 0 && !drawerOpen()) setDrawer(true);
    else if (dx < 0 && drawerOpen()) setDrawer(false);
  }, { passive: true, capture: true });

  /* ---------- Geri tuşu ---------- */
  function layerOpen() {
    if (document.querySelector('[role="dialog"], [role="menu"], [class*="popout_"], [class*="backdrop_"]')) return true;
    const layers = document.querySelector('[class*="layers_"]');
    return Boolean(layers && layers.children.length > 1);
  }
  function pressEscape() {
    const target = document.activeElement && document.activeElement !== document.body ? document.activeElement : document.body;
    for (const type of ['keydown', 'keyup']) {
      target.dispatchEvent(new KeyboardEvent(type, { key: 'Escape', code: 'Escape', keyCode: 27, which: 27, bubbles: true, cancelable: true }));
    }
  }
  window.__enexBack = () => {
    try {
      if (layerOpen()) { pressEscape(); return 'esc'; }
      if (H().hasAttribute('data-nx-members')) { H().removeAttribute('data-nx-members'); return 'members'; }
      if (isMobile() && H().hasAttribute('data-nx-shell') && !drawerOpen()) { setDrawer(true); return 'drawer'; }
    } catch (_) {}
    return 'none';
  };

  /* =====================================================================
     SES KAYDIRICISI: %100–200 sarı, %200–300 kırmızı + uyarı (masaüstüyle aynı)
     ===================================================================== */
  const VOL_CSS = `
[data-nx-vol] [class*="barFill"] { transition: background-color .15s ease; }
[data-nx-vol="warn"] [class*="barFill"] { background-color: #f0b232 !important; }
[data-nx-vol="danger"] [class*="barFill"] { background-color: #f23f43 !important; }
[data-nx-vol="warn"] [class*="grabber"] { border-color: #f0b232 !important; box-shadow: 0 0 0 2px rgba(240,178,50,.35) !important; }
[data-nx-vol="danger"] [class*="grabber"] { border-color: #f23f43 !important; box-shadow: 0 0 0 3px rgba(242,63,67,.45) !important; }
[data-nx-vol] [class*="bar_"]:not([class*="barFill"]) {
  background-image: linear-gradient(90deg, transparent 0 33.333%, rgba(240,178,50,.42) 33.333% 66.666%, rgba(242,63,67,.5) 66.666% 100%) !important;
}
#enex-vol-toast {
  position: fixed; left: 50%; bottom: 28px; z-index: 2147483647; transform: translateX(-50%) translateY(12px);
  max-width: min(520px, calc(100vw - 32px)); padding: 12px 16px 12px 14px; border-radius: 12px;
  display: flex; gap: 10px; align-items: flex-start; pointer-events: none; opacity: 0;
  font: 500 14px/1.4 "gg sans", system-ui, sans-serif; color: #fff;
  background: rgba(20, 18, 28, .96); border: 1px solid rgba(255,255,255,.1); border-left: 4px solid #f0b232;
  box-shadow: 0 12px 32px -8px rgba(0,0,0,.6); transition: opacity .18s ease, transform .18s ease;
}
#enex-vol-toast.on { opacity: 1; transform: translateX(-50%) translateY(0); }
#enex-vol-toast.danger { border-left-color: #f23f43; background: rgba(48, 12, 16, .97); }
#enex-vol-toast b { display: block; font-weight: 700; margin-bottom: 2px; }
#enex-vol-toast i { font-style: normal; font-size: 18px; line-height: 1.2; }
`;
  let volToastTimer = null;
  let lastWarnAt = 0;
  function volToast(kind) {
    const text = kind === 'danger' ? labels.volDanger : labels.volWarn;
    if (!text) return;
    let el = document.getElementById('enex-vol-toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'enex-vol-toast';
      el.setAttribute('role', 'alert');
      document.body.appendChild(el);
    }
    const [title, ...rest] = text.split('|');
    el.replaceChildren();
    const icon = document.createElement('i');
    icon.textContent = kind === 'danger' ? '⚠️' : '🔊';
    const box = document.createElement('div');
    const b = document.createElement('b');
    b.textContent = title;
    box.append(b, document.createTextNode(rest.join('|')));
    el.append(icon, box);
    el.className = kind === 'danger' ? 'danger' : '';
    requestAnimationFrame(() => el.classList.add('on'));
    clearTimeout(volToastTimer);
    volToastTimer = setTimeout(() => el.classList.remove('on'), kind === 'danger' ? 6000 : 4000);
  }
  const volZone = (v) => (v > 200 ? 'danger' : v > 100 ? 'warn' : 'normal');
  function sliderRoot(el) {
    let n = el;
    for (let i = 0; i < 5 && n && n.parentElement; i++) {
      n = n.parentElement;
      if (n.querySelector('[class*="barFill"], [class*="bar_"]')) return n;
    }
    return el.parentElement || el;
  }
  function checkVolumeSlider(el) {
    const max = Number(el.getAttribute('aria-valuemax'));
    if (!(max > 200)) return;
    const v = Number(el.getAttribute('aria-valuenow'));
    if (!Number.isFinite(v)) return;
    const root = sliderRoot(el);
    const prev = root.getAttribute('data-nx-vol');
    const zone = volZone(v);
    if (prev === zone) return;
    root.setAttribute('data-nx-vol', zone);
    if (prev == null) return;
    if (zone === 'danger' && prev !== 'danger') volToast('danger');
    else if (zone === 'warn' && prev === 'normal' && Date.now() - lastWarnAt > 60000) { lastWarnAt = Date.now(); volToast('warn'); }
  }
  onBody(() => {
    const st = document.createElement('style');
    st.id = 'enex-vol-css';
    st.textContent = VOL_CSS;
    (document.head || document.documentElement).appendChild(st);
    const scan = (root) => {
      if (root.nodeType !== 1) return;
      if (root.matches && root.matches('[role="slider"][aria-valuemax]')) checkVolumeSlider(root);
      if (root.querySelectorAll) root.querySelectorAll('[role="slider"][aria-valuemax]').forEach(checkVolumeSlider);
    };
    new MutationObserver((muts) => {
      for (const m of muts) {
        if (m.type === 'attributes') {
          if (m.target.getAttribute && m.target.getAttribute('role') === 'slider') checkVolumeSlider(m.target);
        } else {
          for (const n of m.addedNodes) scan(n);
        }
      }
    }).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['aria-valuenow', 'aria-valuemax'] });
  });

  /* =====================================================================
     DISCORD KÖPRÜSÜ (masaüstündeki enexInstallBridge'in mobil hali)
     - Ses yükseltme (%300): Discord'un birkaç modülü yüklenirken küçük düzeltmeler.
       Uygulama, Discord sayfasının CSP'sine sadece 'unsafe-eval' ekler (Vencord ile aynı).
     - "Dinliyor" etkinliği: telefonda çalan müzik, Discord'un kendi LOCAL_ACTIVITY_UPDATE
       olayıyla verilir.
     ===================================================================== */
  const instances = new Set();
  const ID = '(?:[A-Za-z_$][\\w$]*)';
  const rx = (src) => new RegExp(src.replace(/\\i/g, ID));
  const BOOST_PATCHES = [
    { id: 'userSlider',
      test: (c) => c.includes('isPlatformEmbedded?') && c.includes('maxValue:'),
      rep: [[rx('(?<=maxValue:)\\i\\.isPlatformEmbedded\\?(\\i\\.\\i):\\i\\.\\i(?=,)'), '$1*1.5']] },
    { id: 'streamSlider',
      test: (c) => c.includes('currentVolume:') && c.includes('maxValue:'),
      rep: [[rx('(?<=maxValue:)\\i\\.\\i\\?(\\d+?):\\d+?(?=,)'), '$1*1.5']] },
    { id: 'webAudio', group: true,
      test: (c) => c.includes('streamSourceNode'),
      rep: [
        [/Math\.max.{0,30}\)\)/, 'arguments[0]'],
        [/\}return"video"/, 'this.updateAudioElement();$&'],
        [/\.volume=this\._volume\/100;/, '.volume=0.00;window.__enexBoost(this);']
      ] },
    { id: 'syncClamp',
      test: (c) => c.includes('AudioContextSettingsMigrated'),
      rep: [
        [rx('(?<=isLocalMute\\(\\i,\\i\\),volume:(\\i).+?\\(0,\\i\\.\\i\\)\\(\\i,\\i,\\{volume:)\\1(?=\\}\\))'), '$&>200?200:$&'],
        [rx('(?<=Object\\.entries\\(\\i\\.localMutes\\).+?volume:).+?(?=,)'), '$&>200?200:$&'],
        [rx('(?<=Object\\.entries\\(\\i\\.localVolumes\\).+?volume:).+?(?=})'), '$&>200?200:$&']
      ] },
    { id: 'storeKeep',
      test: (c) => c.includes('="MediaEngineStore",'),
      rep: [[rx('(\\.settings\\.audioContextSettings.+?)(\\i\\[\\i\\])=(\\i\\.volume)(.+?setLocalVolume\\(\\i,).+?\\)'),
        (_, a, lv, sv, b) => `${a}(${lv}>200?void 0:${lv}=${sv})${b}${lv}??${sv})`]] }
  ];
  const boostStats = {};
  function patchFactory(id, f) {
    if (typeof f !== 'function') return f;
    let src;
    try { src = Function.prototype.toString.call(f); } catch (_) { return f; }
    let code = null;
    for (const p of BOOST_PATCHES) {
      if (!p.test(src)) continue;
      if (code == null) code = '0,' + (src.startsWith('(') ? '' : 'function') + src.slice(src.indexOf('('));
      const st = boostStats[p.id] || (boostStats[p.id] = { seen: 0, applied: 0 });
      st.seen++;
      let next = code;
      let missed = false;
      for (const [m, r] of p.rep) {
        const out = next.replace(m, r);
        if (out === next) missed = true; else next = out;
      }
      if (p.group && missed) continue;
      if (next !== code) { code = next; st.applied++; }
    }
    if (code == null) return f;
    try {
      // eslint-disable-next-line no-eval
      return (0, eval)(`// Enex: ses yükseltme (modül ${String(id)})\n${code}\n//# sourceURL=enex:///WebpackModule${String(id)}`);
    } catch (err) {
      boostStats.error = String(err && err.message).slice(0, 160);
      return f;
    }
  }
  function wrapModules(mods) {
    if (!mods || typeof mods !== 'object' || mods.__enexWrapped) return mods;
    try { for (const k of Object.keys(mods)) mods[k] = patchFactory(k, mods[k]); } catch (_) {}
    return new Proxy(mods, {
      set(t, k, f) { t[k] = patchFactory(k, f); return true; },
      get(t, k) { return k === '__enexWrapped' ? true : t[k]; }
    });
  }
  try {
    Object.defineProperty(window, '__enexBoost', {
      configurable: false,
      enumerable: false,
      value: function (data) {
        try {
          if (!data || !data.stream || !data.audioContext || data.stream.getAudioTracks().length === 0) return;
          const ctx = data.audioContext;
          if (!data.streamSourceNode) data.streamSourceNode = ctx.createMediaStreamSource(data.stream);
          if (!data.gainNode) {
            const g = data.gainNode = ctx.createGain();
            data.streamSourceNode.connect(g);
            g.connect(ctx.destination);
          }
          if (data.sinkId != null && data.sinkId !== ctx.sinkId && typeof ctx.setSinkId === 'function') {
            ctx.setSinkId(data.sinkId === 'default' ? '' : data.sinkId).catch(() => {});
          }
          data.gainNode.gain.value = data._mute ? 0 : Math.max(0, Math.min(3, (Number(data._volume) || 0) / 100));
        } catch (_) {}
      }
    });
  } catch (_) {}

  try {
    Object.defineProperty(Function.prototype, 'm', {
      configurable: true,
      enumerable: false,
      set(v) {
        let val = v;
        try { if (v && typeof v === 'object' && typeof this === 'function') val = wrapModules(v); } catch (_) {}
        Object.defineProperty(this, 'm', { value: val, configurable: true, enumerable: true, writable: true });
        try { if (v && typeof v === 'object' && typeof this === 'function') instances.add(this); } catch (_) {}
      }
    });
  } catch (_) {}

  function pushAcquire() {
    const chunk = window.webpackChunkdiscord_app;
    if (!chunk || typeof chunk.push !== 'function' || chunk.push === Array.prototype.push) return;
    let r = null;
    try {
      chunk.push([[Symbol('enex')], {}, (x) => { r = x; }]);
      chunk.pop();
    } catch (_) {}
    if (r) instances.add(r);
  }
  function reqs() {
    pushAcquire();
    const out = [];
    for (const r of instances) {
      try { if (typeof r === 'function' && r.c && typeof r.c === 'object') out.push(r); } catch (_) {}
    }
    return out.sort((a, b) => Object.keys(b.c).length - Object.keys(a.c).length);
  }
  function* exportsOf(ex) {
    if (!ex || (typeof ex !== 'object' && typeof ex !== 'function') || ex === window) return;
    yield ex;
    let keys;
    try { keys = Object.keys(ex); } catch (_) { return; }
    for (const k of keys) {
      let v;
      try { v = ex[k]; } catch (_) { continue; }
      if (v && v !== ex && v !== window && (typeof v === 'object' || typeof v === 'function')) yield v;
    }
  }
  function find(test) {
    for (const r of reqs()) {
      for (const id in r.c) {
        const m = r.c[id];
        if (!m || !m.exports) continue;
        for (const v of exportsOf(m.exports)) {
          try { if (test(v)) return v; } catch (_) {}
        }
      }
    }
    return null;
  }
  function findAll(test, limit) {
    const out = [];
    for (const r of reqs()) {
      for (const id in r.c) {
        const m = r.c[id];
        if (!m || !m.exports) continue;
        for (const v of exportsOf(m.exports)) {
          try { if (test(v) && !out.includes(v)) { out.push(v); if (out.length >= limit) return out; } } catch (_) {}
        }
      }
    }
    return out;
  }

  let Dispatcher = null;
  let S = {};
  const WANT = ['UserStore', 'PresenceStore', 'AuthenticationStore', 'LocalActivityStore', 'UserSettingsProtoStore'];
  let FluxRef = null;
  let dispatcherScore = 0;

  function findDispatcher() {
    const cands = findAll((v) => typeof v === 'object' && typeof v.dispatch === 'function' &&
      typeof v.subscribe === 'function' && typeof v.unsubscribe === 'function', 25);
    if (!cands.length) return null;
    const score = new Map(cands.map((c) => [c, 0]));
    let all = [];
    try { all = (FluxRef && FluxRef.Store.getAll()) || []; } catch (_) {}
    for (const st of all) {
      let keys = [];
      try { keys = Object.keys(st); } catch (_) { continue; }
      for (const k of keys) {
        let v;
        try { v = st[k]; } catch (_) { continue; }
        if (score.has(v)) score.set(v, score.get(v) + 1);
      }
    }
    for (const c of cands) {
      if (c._actionHandlers && typeof c.addInterceptor === 'function') score.set(c, score.get(c) + 0.5);
    }
    let best = null, bestScore = -1;
    for (const [c, sc] of score) if (sc > bestScore) { best = c; bestScore = sc; }
    dispatcherScore = bestScore;
    return bestScore > 0 ? best : null;
  }
  function findStores() {
    const out = {};
    const put = (st) => {
      if (!st || typeof st !== 'object') return;
      let n = null;
      try { if (typeof st.getName === 'function') n = st.getName(); } catch (_) {}
      if (!n) n = st.constructor && st.constructor.displayName;
      if (n && WANT.includes(n) && !out[n]) out[n] = st;
    };
    const Flux = FluxRef || find((v) => typeof v.connectStores === 'function' && v.Store && typeof v.Store.getAll === 'function');
    if (Flux) { FluxRef = Flux; try { Flux.Store.getAll().forEach(put); } catch (_) {} }
    return out;
  }
  function myId() {
    try { const me = S.UserStore && S.UserStore.getCurrentUser(); if (me) return me.id; } catch (_) {}
    try { return S.AuthenticationStore && S.AuthenticationStore.getId(); } catch (_) {}
    return null;
  }
  function nativeMusicActive() {
    try {
      const me = myId();
      const acts = (S.PresenceStore && S.PresenceStore.getActivities && S.PresenceStore.getActivities(me)) || [];
      return acts.some((a) => a && a.type === 2 && (a.sync_id || (a.party && String(a.party.id || '').startsWith('spotify:'))));
    } catch (_) { return false; }
  }
  function showCurrentGame() {
    try {
      const st = S.UserSettingsProtoStore;
      const set = st && (st.settings || (typeof st.getState === 'function' && st.getState().settings));
      const v = set && set.status && set.status.showCurrentGame;
      if (v == null) return null;
      return typeof v === 'object' ? (v.value == null ? null : Boolean(v.value)) : Boolean(v);
    } catch (_) { return null; }
  }

  const activities = new Map();
  function applyActivity(m) {
    if (!Dispatcher) return;
    let activity = m.activity ? JSON.parse(JSON.stringify(m.activity)) : null;
    if (activity && m.kind === 'music' && m.skipIfNative && nativeMusicActive()) activity = null;
    try {
      Dispatcher.dispatch({ type: 'LOCAL_ACTIVITY_UPDATE', socketId: m.socketId, pid: m.pid || undefined, activity });
      send({ t: 'act', socketId: String(m.socketId), name: activity ? String(activity.name || '') : null });
    } catch (err) {
      send({ t: 'diag', error: 'dispatch: ' + (err && err.message) });
    }
  }
  window.__enexActivity = (m) => {
    if (!m || !m.socketId) return;
    if (m.activity) activities.set(m.socketId, m); else activities.delete(m.socketId);
    applyActivity(m);
  };

  let lastReport = '';
  function report(force) {
    let sizes = [];
    try { sizes = reqs().map((r) => Object.keys(r.c).length); } catch (_) {}
    const d = {
      t: 'diag',
      webpack: sizes.length > 0,
      dispatcher: Boolean(Dispatcher),
      dispatcherScore,
      boost: boostStats,
      stores: Object.keys(S),
      user: Boolean(myId()),
      showCurrentGame: showCurrentGame()
    };
    const key = JSON.stringify(d);
    if (force || key !== lastReport) { lastReport = key; send(d); }
  }
  const sub = (ev, fn) => { try { Dispatcher.subscribe(ev, fn); } catch (_) {} };
  let actReady = false;
  function setup(tries) {
    if (!reqs().length) return;
    if (!FluxRef || !S.PresenceStore) {
      const found = findStores();
      for (const k of Object.keys(found)) S[k] = found[k];
    }
    if (!Dispatcher && (FluxRef || tries > 20)) Dispatcher = findDispatcher();
    if (Dispatcher && !actReady) {
      actReady = true;
      sub('CONNECTION_OPEN', () => setTimeout(() => { for (const m of activities.values()) applyActivity(m); report(true); }, 1500));
      sub('SPOTIFY_PLAYER_STATE', () => setTimeout(() => { for (const m of activities.values()) if (m.kind === 'music') applyActivity(m); }, 500));
      log('etkinlik köprüsü hazır');
      send({ t: 'bridge-ready' });
      for (const m of activities.values()) applyActivity(m);
    }
  }
  let tries = 0;
  const bridgeTimer = setInterval(() => {
    tries++;
    if (!actReady) {
      if (tries < 120 || tries % 10 === 0) setup(tries);
    }
    report();
    // Hazır olunca sadece arada bir rapor (pil)
    if (actReady && tries > 30) { clearInterval(bridgeTimer); setInterval(report, 15000); }
  }, 1000);

  /* =====================================================================
     UYGULAMADAN GELEN MESAJLAR
     ===================================================================== */
  function handle(msg) {
    if (!msg || typeof msg !== 'object') return;
    if (msg.t === 'state') {
      state = msg;
      labels = msg.labels || labels;
      applyCss(msg.css || '');
      applyViewport(msg.view);
      onHead(() => {
        applyFlags(msg);
        if (!isMobile()) { H().removeAttribute('data-nx-drawer'); H().removeAttribute('data-nx-members'); }
      });
      wallState = msg.wall || null;
      renderWall();
      scheduleMark();
    } else if (msg.t === 'activity') {
      window.__enexActivity(msg);
    } else if (msg.t === 'notif-click') {
      window.__enexNotifClick(msg.id);
    }
  }
  window.__enexRecv = handle;
  if (native) {
    native.onmessage = (e) => { try { handle(JSON.parse(e.data)); } catch (err) { log('mesaj', err); } };
  }
  send({ t: 'hello', href: location.href });
})();
