// Discord penceresinin ön yükleyicisi.
// Ayrı (izole) bir JS dünyasında çalışır: Discord'un kodu buradaki fonksiyonlara erişemez.
// Görevleri: başlık çubuğu ve pencere butonları, anime temasında duvar kağıdı ve yaprak animasyonu.

const { ipcRenderer } = require('electron');

// Discord'un açılır pencereleri (ör. yayını ayrı pencerede izleme) de bu dosyayı yükler;
// onlarda başlık çubuğu, duvar kağıdı ve köprü kurulmaz.
const IS_POPOUT = location.pathname.startsWith('/popout');
let gaming = false; // oyun öndeyken duvar kağıdı ve yaprak animasyonu durur (GPU oyuna kalsın)

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

if (!IS_POPOUT) {
  onBody(() => {
    syncTitlebar();
    setInterval(syncTitlebar, 1200); // giriş ekranından uygulamaya geçişi yakala
  });
}

ipcRenderer.on('enex:chrome', (_e, state) => {
  chrome = { ...chrome, ...state, labels: { ...chrome.labels, ...(state.labels || {}) } };
  if (!IS_POPOUT) onBody(syncTitlebar);
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

    const { src, kind, dim, kenburns } = wallState;
    const paused = wallState.paused || gaming;
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
  } else if (!wallState.paused && !gaming) {
    if (v) v.play().catch(() => {});
    const host = document.getElementById('enex-wall');
    if (host) startPetals(host);
  }
});

ipcRenderer.on('enex:wallpaper', (_e, state) => {
  if (IS_POPOUT) return;
  wallState = state;
  renderWall();
});

// Oyun modu: oyun öndeyken Discord sayfasındaki bütün animasyonlar, geçişler ve bulanıklık
// (backdrop-filter, GPU'yu en çok yoran efekt) durur. Oyundan çıkınca geri gelir.
const GAMING_CSS = `
html[data-nx-gaming] *, html[data-nx-gaming] *::before, html[data-nx-gaming] *::after {
  animation-play-state: paused !important;
  transition: none !important;
  backdrop-filter: none !important;
  -webkit-backdrop-filter: none !important;
}`;
function applyGaming() {
  onBody(() => {
    if (!document.getElementById('enex-gaming-css')) {
      const st = document.createElement('style');
      st.id = 'enex-gaming-css';
      st.textContent = GAMING_CSS;
      (document.head || document.documentElement).appendChild(st);
    }
    const h = document.documentElement;
    if (gaming) {
      // Temanın hareket efektlerini (motion.css) de kapat, sonra geri aç
      if (h.hasAttribute('data-nx-fx')) { h.setAttribute('data-nx-fx-was', ''); h.removeAttribute('data-nx-fx'); }
      h.setAttribute('data-nx-gaming', '');
    } else {
      h.removeAttribute('data-nx-gaming');
      if (h.hasAttribute('data-nx-fx-was')) { h.removeAttribute('data-nx-fx-was'); h.setAttribute('data-nx-fx', ''); }
    }
  });
  try { window.postMessage({ __enex: 'gaming', on: gaming }, '*'); } catch (_) {}
}

ipcRenderer.on('enex:gaming', (_e, on) => {
  if (IS_POPOUT || gaming === Boolean(on)) return;
  gaming = Boolean(on);
  applyGaming();
  if (wallState) renderWall();
});

// Açılıştaki "bağlanıyor" ekranına ilerleme yazısı
ipcRenderer.on('enex:loading', (_e, text) => {
  onBody(() => {
    const el = document.getElementById('nx-loading-text');
    if (el) el.textContent = text;
  });
});

/* =====================================================================
   YAYIN SESİ
   Discord ekran paylaşımı başlatınca (getDisplayMedia), akışa Enex'in kendi
   yakaladığı sesi ekler. Discord'daki konuşmalar bu seste YOKTUR.
   Bu fonksiyon sayfanın kendi dünyasında çalışır; ses verisi buradan
   window.postMessage ile gelir.
   ===================================================================== */
function enexInstallShareAudio() {
  if (window.__enexShareAudio) return;
  window.__enexShareAudio = true;
  const md = navigator.mediaDevices;
  if (!md || !md.getDisplayMedia) return;
  const original = md.getDisplayMedia.bind(md);
  const MAX_QUEUE = 48000 * 2 * 0.25; // en fazla 250 ms gecikme biriksin
  let current = null;

  const stopCurrent = () => {
    if (!current) return;
    const cur = current;
    current = null;
    try { cur.node.disconnect(); } catch (_) {}
    try { cur.ctx.close(); } catch (_) {}
    window.postMessage({ __enex: 'audio-stop' }, '*');
  };

  window.addEventListener('message', (e) => {
    if (e.source !== window || !e.data || e.data.__enex !== 'pcm' || !current) return;
    const chunk = new Int16Array(e.data.ab);
    current.queue.push(chunk);
    current.queued += chunk.length;
    while (current.queued > MAX_QUEUE && current.queue.length > 1) {
      const old = current.queue.shift();
      current.queued -= old.length - current.offset;
      current.offset = 0;
    }
  });

  const requestAudio = () => new Promise((resolve) => {
    const id = Math.random().toString(36).slice(2);
    const onMsg = (e) => {
      if (e.source === window && e.data && e.data.__enex === 'audio-ready' && e.data.id === id) {
        window.removeEventListener('message', onMsg);
        resolve(e.data.result);
      }
    };
    window.addEventListener('message', onMsg);
    window.postMessage({ __enex: 'audio-start', id }, '*');
    setTimeout(() => { window.removeEventListener('message', onMsg); resolve(null); }, 4000);
  });

  md.getDisplayMedia = async function (constraints) {
    const stream = await original(constraints);
    try {
      if (constraints && constraints.audio && stream.getAudioTracks().length === 0) {
        stopCurrent();
        const result = await requestAudio();
        if (result && result.ok) {
          const ctx = new AudioContext({ sampleRate: 48000, latencyHint: 'interactive' });
          const node = ctx.createScriptProcessor(1024, 0, 2);
          const dest = ctx.createMediaStreamDestination();
          const mute = ctx.createGain();
          mute.gain.value = 0;
          const cur = { ctx, node, queue: [], offset: 0, queued: 0 };
          node.onaudioprocess = (ev) => {
            const L = ev.outputBuffer.getChannelData(0);
            const R = ev.outputBuffer.getChannelData(1);
            let i = 0;
            while (i < L.length && cur.queue.length) {
              const chunk = cur.queue[0];
              while (i < L.length && cur.offset < chunk.length) {
                L[i] = chunk[cur.offset] / 32768;
                R[i] = chunk[cur.offset + 1] / 32768;
                cur.offset += 2;
                cur.queued -= 2;
                i++;
              }
              if (cur.offset >= chunk.length) { cur.queue.shift(); cur.offset = 0; }
            }
            for (; i < L.length; i++) { L[i] = 0; R[i] = 0; }
          };
          node.connect(dest);
          node.connect(mute);
          mute.connect(ctx.destination); // sadece işlemenin sürmesi için, ses çıkmaz
          ctx.resume().catch(() => {});
          current = cur;

          const audioTrack = dest.stream.getAudioTracks()[0];
          stream.addTrack(audioTrack);

          // Paylaşım bitince yakalayıcıyı durdur
          const end = () => { if (current === cur) stopCurrent(); };
          for (const tr of stream.getTracks()) {
            tr.addEventListener('ended', end);
            const stopFn = tr.stop.bind(tr);
            tr.stop = function () { end(); return stopFn(); };
          }
        }
      }
    } catch (err) {
      console.warn('[Enex] yayın sesi eklenemedi:', err);
    }
    return stream;
  };
}

/* =====================================================================
   DISCORD KÖPRÜSÜ (sayfanın kendi dünyasında çalışır)
   - Oyun içi arayüz için: bağlı olduğun ses kanalındakiler, kimin konuştuğu,
     Discord'un gösterdiği masaüstü bildirimleri.
   - Etkinlik paylaşımı için: Enex'in algıladığı oyun/müzik/Rich Presence bilgisini
     Discord'un kendi "yerel etkinlik" olayıyla (LOCAL_ACTIVITY_UPDATE) istemciye verir;
     masaüstü Discord'daki gibi profilinde "Oynuyor / Dinliyor" olarak görünür.
   Token'a, mesajlara ya da hesap ayarlarına dokunmaz.
   Sayfa -> ana süreç: postMessage({__enex:'page', payload})
   Ana süreç -> sayfa:  postMessage({__enex:'activity', ...})
   ===================================================================== */
function enexInstallBridge() {
  if (window.__enexBridge) return;
  window.__enexBridge = true;
  const post = (payload) => { try { window.postMessage({ __enex: 'page', payload }, '*'); } catch (_) {} };
  const log = (...a) => { try { console.log('[Enex]', ...a); } catch (_) {} };

  /* ---------------- Bildirimler ---------------- */
  const sendNotify = (title, opts) => {
    try {
      post({
        type: 'notify',
        title: String(title || '').slice(0, 200),
        body: String((opts && opts.body) || '').slice(0, 500),
        icon: String((opts && opts.icon) || '')
      });
    } catch (_) {}
  };
  const Native = window.Notification;
  if (typeof Native === 'function') {
    const Wrapped = function Notification(title, opts) {
      sendNotify(title, opts);
      return new Native(title, opts);
    };
    Wrapped.prototype = Native.prototype;
    Object.defineProperty(Wrapped, 'permission', { get: () => Native.permission });
    Wrapped.requestPermission = (...a) => Native.requestPermission(...a);
    if (Native.maxActions != null) Object.defineProperty(Wrapped, 'maxActions', { get: () => Native.maxActions });
    try { window.Notification = Wrapped; } catch (_) {}
  }
  try {
    const SWR = window.ServiceWorkerRegistration && window.ServiceWorkerRegistration.prototype;
    if (SWR && typeof SWR.showNotification === 'function') {
      const orig = SWR.showNotification;
      SWR.showNotification = function (title, opts) { sendNotify(title, opts); return orig.call(this, title, opts); };
    }
  } catch (_) {}

  /* ---------------- Discord'un modüllerine erişim ---------------- */
  // Discord birden fazla webpack örneği yükler (ana uygulama, sentry, libdiscore, fast-connect…).
  // İlk yakalanan çoğu zaman küçük bir yardımcı örnektir; bu yüzden hepsini oluştukları anda
  // yakalayıp hepsinde ararız (Vencord'un yöntemi: Function.prototype.m ayarlayıcısı).
  const instances = new Set();
  try {
    Object.defineProperty(Function.prototype, 'm', {
      configurable: true,
      enumerable: false,
      set(v) {
        Object.defineProperty(this, 'm', { value: v, configurable: true, enumerable: true, writable: true });
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
  // Modül önbelleği olan örnekler, en büyüğü (ana Discord) önce
  function reqs() {
    pushAcquire();
    const out = [];
    for (const r of instances) {
      try { if (typeof r === 'function' && r.c && typeof r.c === 'object') out.push(r); } catch (_) {}
    }
    return out.sort((a, b) => Object.keys(b.c).length - Object.keys(a.c).length);
  }
  const getReq = () => reqs()[0] || null;
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
  const fnSrc = (f) => { try { return Function.prototype.toString.call(f); } catch (_) { return ''; } };

  let Dispatcher = null;
  let S = {}; // depolar (stores)
  const WANT = ['SpeakingStore', 'VoiceStateStore', 'UserStore', 'SelectedChannelStore', 'ChannelStore',
    'GuildMemberStore', 'PresenceStore', 'SpotifyStore', 'AuthenticationStore',
    'LocalActivityStore', 'UserSettingsProtoStore'];

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

  // Discord'da dispatch/subscribe'ı olan birden fazla nesne var; asıl Flux dağıtıcısı,
  // veri depolarının (store) kendi içinde tuttuğu nesnedir. En çok depo tarafından
  // kullanılan adayı seçeriz; yanlış nesneye gönderilen etkinlik hiçbir yere ulaşmaz.
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

  function findStores(deep) {
    const out = {};
    const put = (st, forced) => {
      if (!st || typeof st !== 'object') return;
      let n = forced || null;
      try { if (!n && typeof st.getName === 'function') n = st.getName(); } catch (_) {}
      if (!n) n = st.constructor && st.constructor.displayName;
      if (n && WANT.includes(n) && !out[n]) out[n] = st;
    };
    // 1) Flux.Store.getAll(): bütün depolar tek seferde (Vencord'un yöntemi)
    const Flux = FluxRef || find((v) => typeof v.connectStores === 'function' && v.Store && typeof v.Store.getAll === 'function');
    if (Flux) { FluxRef = Flux; try { Flux.Store.getAll().forEach((x) => put(x)); } catch (_) {} }
    if (!deep) return out;
    // 2) Bazı depolar Discord'un WASM çekirdeğinde (libdiscore)
    if (WANT.some((n) => !out[n])) {
      const lib = find((v) => typeof v === 'function' && fnSrc(v).includes('libdiscoreWasm is not initialized'));
      if (lib) { try { const ex = lib(); for (const k in ex) if (k.endsWith('Store')) put(ex[k], k); } catch (_) {} }
    }
    // 3) Yedek: modülleri tek tek tara
    if (WANT.some((n) => !out[n])) {
      find((v) => { if (typeof v === 'object' && (typeof v.getName === 'function' || (v.constructor && v.constructor.displayName))) put(v); return false; });
    }
    return out;
  }

  /* ---------------- Ses kanalı ---------------- */
  const speaking = new Map(); // userId -> son konuşma (SPEAKING olayından)

  function avatarUrl(u) {
    if (u && u.avatar) return `https://cdn.discordapp.com/avatars/${u.id}/${u.avatar}.png?size=64`;
    let i = 0;
    try { i = Number((BigInt(u.id) >> 22n) % 6n); } catch (_) {}
    return `https://cdn.discordapp.com/embed/avatars/${i}.png`;
  }

  function myId() {
    try { const me = S.UserStore && S.UserStore.getCurrentUser(); if (me) return me.id; } catch (_) {}
    try { return S.AuthenticationStore && S.AuthenticationStore.getId(); } catch (_) {}
    return null;
  }

  function voiceChannelId() {
    try { const id = S.SelectedChannelStore && S.SelectedChannelStore.getVoiceChannelId(); if (id) return id; } catch (_) {}
    try {
      const me = myId();
      const vs = me && S.VoiceStateStore && S.VoiceStateStore.getVoiceStateForUser && S.VoiceStateStore.getVoiceStateForUser(me);
      if (vs && vs.channelId) return vs.channelId;
    } catch (_) {}
    return null;
  }

  function isSpeaking(id) {
    try { if (S.SpeakingStore && S.SpeakingStore.isSpeaking(id)) return true; } catch (_) {}
    return speaking.has(id);
  }

  function snapshot() {
    const channelId = voiceChannelId();
    if (!channelId || !S.VoiceStateStore) return { type: 'voice', channel: null, members: [] };
    let channel = null;
    try { channel = S.ChannelStore ? S.ChannelStore.getChannel(channelId) : null; } catch (_) {}
    const guildId = channel && (channel.guild_id || channel.guildId);
    const me = myId();
    let states = {};
    try { states = S.VoiceStateStore.getVoiceStatesForChannel(channelId) || {}; } catch (_) {}
    const list = states instanceof Map ? [...states.values()] : Object.values(states);
    const members = [];
    for (const vs of list) {
      const id = vs && (vs.userId || vs.user_id);
      if (!id) continue;
      let u = null;
      try { u = S.UserStore && S.UserStore.getUser(id); } catch (_) {}
      u = u || { id };
      let nick = null;
      try { nick = guildId && S.GuildMemberStore ? S.GuildMemberStore.getNick(guildId, id) : null; } catch (_) {}
      members.push({
        id,
        name: String(nick || u.globalName || u.global_name || u.username || '…').slice(0, 64),
        avatar: avatarUrl(u),
        speaking: isSpeaking(id),
        muted: Boolean(vs.selfMute || vs.mute || vs.self_mute),
        deafened: Boolean(vs.selfDeaf || vs.deaf || vs.self_deaf),
        self: Boolean(me && me === id)
      });
    }
    members.sort((a, b) => (b.self - a.self) || a.name.localeCompare(b.name));
    let name = channel ? String(channel.name || '') : '';
    if (!name && channel && channel.rawRecipients) name = channel.rawRecipients.map((r) => r.global_name || r.username).join(', ');
    return { type: 'voice', channel: name.slice(0, 80) || null, members };
  }

  let lastVoice = '';
  function pushVoice() {
    let snap;
    try { snap = snapshot(); } catch (err) { return; }
    const json = JSON.stringify(snap);
    if (json !== lastVoice) { lastVoice = json; post(snap); }
  }

  /* ---------------- Etkinlik (oyun / müzik / Rich Presence) ---------------- */
  const activities = new Map(); // socketId -> son mesaj (yeniden bağlanınca tekrar gönderilir)
  let assetFn = null, appFn = null, appCache = {};

  function findAssetFn() {
    if (assetFn) return assetFn;
    const r = getReq();
    if (!r || !r.m) return null;
    for (const id in r.m) {
      if (!fnSrc(r.m[id]).includes('getAssetImage: size must === [')) continue;
      let mod;
      try { mod = r(id); } catch (_) { continue; }
      for (const v of exportsOf(mod)) {
        if (typeof v !== 'function') continue;
        const src = fnSrc(v);
        if (src.includes('startsWith("http:")') || (src.includes('apply(') && src.includes('.dispatch('))) { assetFn = v; return v; }
      }
    }
    return null;
  }
  function findAppFn() {
    if (appFn) return appFn;
    appFn = find((v) => typeof v === 'function' && fnSrc(v).includes('"Invalid Origin"') && fnSrc(v).includes('.application'));
    return appFn;
  }
  async function lookupAsset(appId, key) {
    if (!key) return key;
    const f = findAssetFn();
    if (!f) return /^https?:/i.test(key) ? undefined : key;
    try { const r = await f(appId, [key, undefined]); return (r && r[0]) || undefined; } catch (_) { return undefined; }
  }
  async function lookupAppName(appId) {
    if (appCache[appId] !== undefined) return appCache[appId];
    const f = findAppFn();
    let name = null;
    if (f) {
      try { const sock = {}; await f(sock, appId); name = sock.application && sock.application.name; } catch (_) {}
    }
    appCache[appId] = name || null;
    return appCache[appId];
  }

  // Discord'un kendi Spotify bağlantısı zaten "Dinliyor" gösteriyorsa ikinci bir müzik etkinliği ekleme
  function nativeMusicActive() {
    try {
      const me = myId();
      const acts = (S.PresenceStore && S.PresenceStore.getActivities && S.PresenceStore.getActivities(me)) || [];
      return acts.some((a) => a && a.type === 2 && (a.sync_id || (a.party && String(a.party.id || '').startsWith('spotify:'))));
    } catch (_) { return false; }
  }

  // Discord'un "Algılanan etkinlikleri paylaş" ayarı (Ayarlar → Etkinlik Gizliliği)
  function showCurrentGame() {
    try {
      const st = S.UserSettingsProtoStore;
      const set = st && (st.settings || (typeof st.getState === 'function' && st.getState().settings));
      const v = set && set.status && set.status.showCurrentGame;
      if (v == null) return null;
      return typeof v === 'object' ? (v.value == null ? null : Boolean(v.value)) : Boolean(v);
    } catch (_) { return null; }
  }
  const actNames = (list) => (Array.isArray(list) ? list : []).slice(0, 8).map((a) => `${a && a.type}:${a && a.name}`);
  // Gönderdiğimiz etkinlik Discord'un kendi listelerine girdi mi? (tanılama)
  let checkTimer = null;
  function checkActivities() {
    const me = myId();
    const out = { type: 'act-check', showCurrentGame: showCurrentGame() };
    try { out.local = actNames(S.LocalActivityStore && S.LocalActivityStore.getActivities()); } catch (e) { out.local = 'err'; }
    try { out.presence = actNames(S.PresenceStore && S.PresenceStore.getActivities(me)); } catch (e) { out.presence = 'err'; }
    try { out.status = S.PresenceStore && S.PresenceStore.getStatus(me); } catch (_) {}
    post(out);
  }

  async function applyActivity(m) {
    if (!Dispatcher) return;
    let activity = m.activity ? JSON.parse(JSON.stringify(m.activity)) : null;
    if (activity && m.kind === 'music' && m.skipIfNative && nativeMusicActive()) activity = null;
    if (activity && m.kind === 'rpc') {
      const a = activity.assets;
      if (a) {
        if (a.large_image) a.large_image = await lookupAsset(activity.application_id, a.large_image);
        if (a.small_image) a.small_image = await lookupAsset(activity.application_id, a.small_image);
        for (const k of Object.keys(a)) if (a[k] === undefined) delete a[k];
      }
      if (!activity.name) activity.name = (await lookupAppName(activity.application_id)) || 'Game';
    }
    try {
      Dispatcher.dispatch({ type: 'LOCAL_ACTIVITY_UPDATE', socketId: m.socketId, pid: m.pid || undefined, activity });
      post({ type: 'act', socketId: String(m.socketId), name: activity ? String(activity.name || '') : null });
      clearTimeout(checkTimer);
      checkTimer = setTimeout(checkActivities, 2500);
    } catch (err) {
      post({ type: 'diag', error: 'dispatch: ' + (err && err.message) });
    }
  }

  window.addEventListener('message', (e) => {
    if (e.source !== window || !e.data || e.data.__enex !== 'activity') return;
    const m = e.data;
    if (!m.socketId) return;
    if (m.activity) activities.set(m.socketId, m); else activities.delete(m.socketId);
    applyActivity(m);
  });

  /* ---------------- Kurulum ---------------- */
  // Etkinlik gönderme sadece Dispatcher'a, ses listesi depolara bağlı; biri eksikse öteki yine çalışır.
  let actReady = false;
  let voiceReady = false;
  let lastReport = '';
  function report(force) {
    let sizes = [];
    try { sizes = reqs().map((r) => Object.keys(r.c).length); } catch (_) {}
    const d = {
      type: 'diag',
      webpack: sizes.length > 0,
      instances: sizes.slice(0, 6),
      dispatcher: Boolean(Dispatcher),
      dispatcherScore,
      stores: Object.keys(S),
      voice: voiceReady,
      user: Boolean(myId()),
      showCurrentGame: showCurrentGame()
    };
    const key = JSON.stringify(d);
    if (force || key !== lastReport) { lastReport = key; post(d); }
  }

  const sub = (ev, fn) => { try { Dispatcher.subscribe(ev, fn); } catch (_) {} };

  function setup(tries) {
    if (!reqs().length) return;
    if (!voiceReady || !FluxRef) {
      // Derin tarama ağır; her 5 denemede bir
      const found = findStores(tries % 5 === 0);
      for (const k of Object.keys(found)) S[k] = found[k];
    }
    // Depolar bulunmadan dağıtıcı seçme (yanlış adayı seçmemek için); 20 sn sonra yine de dene
    if (!Dispatcher && (FluxRef || tries > 20)) Dispatcher = findDispatcher();
    if (Dispatcher && !actReady) {
      actReady = true;
      // Bağlantı yenilenince (uyku, internet kopması) etkinlikleri yeniden gönder
      sub('CONNECTION_OPEN', () => setTimeout(() => { for (const m of activities.values()) applyActivity(m); report(true); }, 1500));
      // Kendi "Dinliyor" etkinliğimiz Spotify'la çakışmasın
      sub('SPOTIFY_PLAYER_STATE', () => setTimeout(() => { for (const m of activities.values()) if (m.kind === 'music') applyActivity(m); }, 500));
      log('etkinlik köprüsü hazır');
      post({ type: 'bridge-ready' });
      for (const m of activities.values()) applyActivity(m);
    }
    if (!voiceReady) {
      if (Dispatcher && S.VoiceStateStore && (S.UserStore || S.AuthenticationStore)) {
        voiceReady = true;
        sub('SPEAKING', (e) => {
          if (!e || !e.userId) return;
          if (e.speakingFlags) speaking.set(e.userId, Date.now()); else speaking.delete(e.userId);
          pushVoice();
        });
        for (const ev of ['VOICE_STATE_UPDATES', 'VOICE_CHANNEL_SELECT', 'RTC_CONNECTION_STATE', 'CHANNEL_UPDATES', 'GUILD_MEMBER_UPDATE']) {
          sub(ev, () => setTimeout(pushVoice, 0));
        }
        log('ses köprüsü hazır', Object.keys(S));
      }
    }
  }

  let tries = 0;
  setInterval(() => {
    tries++;
    if (!actReady || !voiceReady) {
      // İlk 2 dakika her saniye, sonra 10 saniyede bir dene
      if (tries < 120 || tries % 10 === 0) setup(tries);
    }
    report();
    if (voiceReady) {
      if (!voiceChannelId()) speaking.clear(); // kanaldan çıkınca konuşma bilgisini sıfırla
      pushVoice();
    }
  }, 1000);
  // Ses listesini sık tazele (olaylar asıl kaynak, bu yedek). Oyundayken bu yedek
  // sıklığı düşer; konuşma göstergesi zaten Discord'un SPEAKING olayıyla anında gelir.
  let gamingNow = false;
  window.addEventListener('message', (e) => {
    if (e.source === window && e.data && e.data.__enex === 'gaming') gamingNow = Boolean(e.data.on);
  });
  setInterval(() => { if (voiceReady && !gamingNow) pushVoice(); }, 250);
}

try {
  const { contextBridge, webFrame } = require('electron');
  const fns = IS_POPOUT ? [] : [enexInstallShareAudio, enexInstallBridge];
  for (const fn of fns) {
    if (contextBridge.executeInMainWorld) contextBridge.executeInMainWorld({ func: fn });
    else webFrame.executeJavaScript(`(${fn.toString()})()`);
  }
} catch (err) {
  console.warn('[Enex] sayfa eklentileri kurulamadı:', err);
}

// Sayfa ile ana süreç arasındaki köprü
window.addEventListener('message', async (e) => {
  if (e.source !== window || !e.data || typeof e.data.__enex !== 'string') return;
  if (e.data.__enex === 'audio-start') {
    let result = null;
    try { result = await ipcRenderer.invoke('enex:audio-start'); } catch (_) {}
    window.postMessage({ __enex: 'audio-ready', id: e.data.id, result }, '*');
  } else if (e.data.__enex === 'audio-stop') {
    ipcRenderer.send('enex:audio-stop');
  } else if (e.data.__enex === 'page' && e.data.payload && typeof e.data.payload === 'object') {
    ipcRenderer.send('enex:page', e.data.payload);
  }
});

// Ana süreçten gelen etkinlik (oyun / müzik / Rich Presence) -> Discord sayfası
ipcRenderer.on('enex:activity', (_e, m) => {
  if (IS_POPOUT || !m || typeof m !== 'object') return;
  window.postMessage({ __enex: 'activity', socketId: m.socketId, pid: m.pid, kind: m.kind, skipIfNative: m.skipIfNative, activity: m.activity }, '*');
});

ipcRenderer.on('enex:pcm', (_e, data) => {
  const ab = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
  window.postMessage({ __enex: 'pcm', ab }, '*', [ab]);
});
