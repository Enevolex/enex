// Discord penceresinin ön yükleyicisi.
// Ayrı (izole) bir JS dünyasında çalışır: Discord'un kodu buradaki fonksiyonlara erişemez.
// Görevleri: başlık çubuğu ve pencere butonları, anime temasında duvar kağıdı ve yaprak animasyonu.

const { ipcRenderer } = require('electron');

let wallState = null;
let chrome = { clear: false, maximized: false, labels: { brand: 'ENEX', minimize: 'Minimize', maximize: 'Maximize', restore: 'Restore', close: 'Close' } };

function onBody(fn) {
  if (document.body) fn();
  else document.addEventListener('DOMContentLoaded', fn, { once: true });
}

/* =====================================================================
   BAŞLIK ÇUBUĞU
   Discord'un kendi üst çubuğu varsa onu kullanırız (sürükleme CSS'i main.js'ten gelir),
   yoksa (ör. giriş ekranı) kendi ince çubuğumuzu çizeriz. Butonlar her durumda bizim.
   Enex window chrome: Discord's own top bar is reused when present.
   ===================================================================== */
const DISCORD_BAR = '[class^="base_"] > [class^="bar_"], [class*=" base_"] > [class^="bar_"], [class^="base_"] > [class*=" bar_"]';

const ICONS = {
  min: '<svg width="10" height="10" viewBox="0 0 10 10"><path d="M0 5h10" stroke="currentColor" stroke-width="1"/></svg>',
  max: '<svg width="10" height="10" viewBox="0 0 10 10"><rect x=".5" y=".5" width="9" height="9" fill="none" stroke="currentColor"/></svg>',
  restore: '<svg width="10" height="10" viewBox="0 0 10 10"><rect x=".5" y="2.5" width="7" height="7" fill="none" stroke="currentColor"/><path d="M2.5 2.5V.5h7v7h-2" fill="none" stroke="currentColor"/></svg>',
  close: '<svg width="10" height="10" viewBox="0 0 10 10"><path d="M0 0l10 10M10 0L0 10" stroke="currentColor" stroke-width="1.1"/></svg>'
};

function buildControls() {
  let box = document.getElementById('enex-controls');
  if (box) return box;
  box = document.createElement('div');
  box.id = 'enex-controls';
  const mk = (cls, action, label) => {
    const b = document.createElement('button');
    b.className = `nx-wbtn nx-${cls}`;
    b.setAttribute('aria-label', label);
    b.dataset.action = action;
    b.addEventListener('click', () => ipcRenderer.send('enex:win', action));
    return b;
  };
  box.append(
    mk('min', 'minimize', chrome.labels.minimize),
    mk('max', 'maximize', chrome.labels.maximize),
    mk('close', 'close', chrome.labels.close)
  );
  return box;
}

function updateControlIcons(box) {
  const L = chrome.labels;
  const min = box.querySelector('.nx-min');
  min.innerHTML = ICONS.min;
  min.setAttribute('aria-label', L.minimize);
  min.title = L.minimize;
  const max = box.querySelector('.nx-max');
  max.innerHTML = chrome.maximized ? ICONS.restore : ICONS.max;
  const maxLabel = chrome.maximized ? L.restore : L.maximize;
  max.setAttribute('aria-label', maxLabel);
  max.title = maxLabel;
  const close = box.querySelector('.nx-close');
  close.innerHTML = ICONS.close;
  close.setAttribute('aria-label', L.close);
  close.title = L.close;
}

function syncTitlebar() {
  if (!document.body) return;
  const discordBar = document.querySelector(DISCORD_BAR);
  let own = document.getElementById('enex-titlebar');
  const controls = buildControls();
  updateControlIcons(controls);

  if (discordBar) {
    if (own) own.remove();
    document.documentElement.removeAttribute('data-nx-owntb');
    const h = Math.round(discordBar.getBoundingClientRect().height) || 32;
    controls.style.height = `${h}px`;
    if (controls.parentElement !== document.body) document.body.appendChild(controls);
  } else {
    if (!own) {
      own = document.createElement('div');
      own.id = 'enex-titlebar';
      const brand = document.createElement('span');
      brand.className = 'nx-brand';
      brand.textContent = chrome.labels.brand;
      own.appendChild(brand);
      document.body.appendChild(own);
    }
    document.documentElement.setAttribute('data-nx-owntb', '');
    const brandEl = own.querySelector('.nx-brand');
    if (brandEl && brandEl.textContent !== chrome.labels.brand) brandEl.textContent = chrome.labels.brand;
    controls.style.height = '32px';
    if (controls.parentElement !== document.body) document.body.appendChild(controls);
  }
}

onBody(() => {
  syncTitlebar();
  setInterval(syncTitlebar, 1200); // giriş ekranından uygulamaya geçişi yakala
});

ipcRenderer.on('enex:chrome', (_e, state) => {
  chrome = { ...chrome, ...state, labels: { ...chrome.labels, ...(state.labels || {}) } };
  onBody(syncTitlebar);
});

/* =====================================================================
   DUVAR KAĞIDI + YAPRAK YAĞMURU (Anime teması)
   ===================================================================== */
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

    const { src, kind, dim, paused, kenburns } = wallState;
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

// ---- Yaprak yağmuru: tek bir canvas, requestAnimationFrame ile akıcı ----
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
  const count = Math.round(Math.min(60, Math.max(25, (innerWidth * innerHeight) / 32000)));
  if (petals.length !== count) {
    petals = Array.from({ length: count }, () => makePetal(innerWidth, innerHeight, true));
  }
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

    const sx = Math.cos(p.flip); // yaprak dönerken incelir: 3B hissi
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

document.addEventListener('visibilitychange', () => {
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

ipcRenderer.on('enex:wallpaper', (_e, state) => {
  wallState = state;
  renderWall();
});

// Açılıştaki "bağlanıyor" ekranına ilerleme yazısı
ipcRenderer.on('enex:loading', (_e, text) => {
  onBody(() => {
    const el = document.getElementById('nx-loading-text');
    if (el) el.textContent = text;
  });
});
