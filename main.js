// Enex — Discord'u kendi temanla açan hafif bir masaüstü uygulaması.
// Enex — a themed desktop shell for Discord.
//
// Giriş, mesaj, ses ve ekran paylaşımı Discord'un kendi web uygulamasıyla çalışır;
// Enex hesap bilgisi (token) görmez ve saklamaz.

const {
  app, BrowserWindow, Menu, session, shell, desktopCapturer, ipcMain,
  protocol, net, dialog, screen, globalShortcut
} = require('electron');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { spawn } = require('child_process');
const nodeNet = require('net');
const i18n = require('./i18n');
const { t } = i18n;
const { ActivityService } = require('./activity');
const { RpcServer } = require('./rpc');

const DISCORD_URL = 'https://discord.com/app';
const ALLOWED_HOSTS = ['discord.com', 'ptb.discord.com', 'canary.discord.com'];

const THEMES = [
  { id: 'aurora',     colors: ['#07060f', '#8b5cf6', '#ec4899', '#22d3ee'] },
  { id: 'anime',      colors: ['#2a1b5e', '#ff8fb8', '#ffd27a', '#9fe7ff'] },
  { id: 'glass',      colors: ['#3b4a5e', '#9ad8ff', '#ffffff', '#d5dae4'] },
  { id: 'neon-tokyo', colors: ['#050508', '#f5e100', '#ff2a6d', '#00f0ff'] },
  { id: 'synthwave',  colors: ['#1e0540', '#ff3cac', '#ffb547', '#2de2e6'] },
  { id: 'abyss',      colors: ['#021422', '#2dd4bf', '#38bdf8', '#a5f3fc'] },
  { id: 'obsidian',   colors: ['#09090a', '#d4b06a', '#e8cf98', '#f6f1e6'] },
  { id: 'matrix',     colors: ['#000000', '#00ff66', '#b6ff00', '#b8ffcf'] }
];
const themeList = () => THEMES.map((th) => ({
  ...th, name: t(`theme.${th.id}.name`), desc: t(`theme.${th.id}.desc`)
}));

const VIDEO_EXT = ['mp4', 'webm', 'mkv', 'mov', 'm4v'];
const IMAGE_EXT = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'avif', 'bmp', 'svg'];

let mainWindow = null;
let mainIsClear = false;
let studioWindow = null;
let cssKeys = [];

// enex:// adresi Discord sayfasının duvar kağıdını okuyabilmesi için (Discord'un CSP'sini aşar)
protocol.registerSchemesAsPrivileged([
  { scheme: 'enex', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, bypassCSP: true } }
]);

// ---------- Eski "Nexus" verilerini taşı (giriş ve ayarlar kaybolmasın) ----------
(function migrateFromNexus() {
  try {
    const appData = app.getPath('appData');
    const target = path.join(appData, 'Enex');
    const source = ['Nexus', 'nexus'].map((n) => path.join(appData, n)).find((p) => fs.existsSync(p));
    app.setPath('userData', target);
    if (source && !fs.existsSync(target)) {
      // Önbellek klasörlerini atla: hem büyükler hem de yeniden oluşuyorlar
      const skip = new Set(['Cache', 'Code Cache', 'GPUCache', 'DawnCache', 'DawnGraphiteCache', 'DawnWebGPUCache', 'GrShaderCache', 'ShaderCache', 'Crashpad', 'blob_storage']);
      fs.cpSync(source, target, {
        recursive: true,
        errorOnExist: false,
        filter: (src) => !skip.has(path.basename(src))
      });
      const oldSettings = path.join(target, 'nexus-settings.json');
      if (fs.existsSync(oldSettings)) fs.renameSync(oldSettings, path.join(target, 'enex-settings.json'));
    }
  } catch (err) {
    console.error('Eski veriler taşınamadı:', err);
  }
})();

// ---------- Ayarlar ----------
const DEFAULTS = {
  theme: 'aurora', fx: true, cards: true, clean: true, accent: null,
  glassMode: 'clear',    // 'acrylic' = buzlu cam, 'clear' = tam saydam
  glassAlpha: 0.03,      // Cam teması panel koyuluğu (neredeyse tamamen saydam)
  animeAlpha: 0.38,      // Anime teması panel koyuluğu
  wallDim: 0.2,          // Duvar kağıdı karartma
  wallpaper: null,       // Kendi duvar kağıdın (dosya yolu); null = hazır duvar kağıdı
  dpiEnabled: true,      // Engel aşma (ByeDPI) sadece Enex için
  lang: 'auto',          // 'auto' | 'tr' | 'en'
  dpiMethod: null,      // En son çalışan yöntem (otomatik bulunur)
  shareAudio: true,      // Ekran paylaşırken sesi de paylaş (Discord'daki konuşmalar hariç)
  overlay: false,        // Oyun içi arayüz (ses kanalı + bildirimler, Enex arka plandayken)
  overlayCorner: 'tl',   // Ses listesinin köşesi: tl | tr | bl | br (bildirimler karşı köşede)
  activityGames: true,   // Oynadığın oyunu "Oynuyor" olarak paylaş
  activityMusic: true,   // Çalan müziği "Dinliyor" olarak paylaş
  musicSources: 'smart', // 'music' = sadece müzik uygulamaları, 'smart' = + tarayıcıda çalan müzik, 'all' = her medya
  musicBlock: '',        // Kullanıcının ekstra yasak kelimeleri (virgülle ayrılmış)
  perfMode: true,        // Oyundayken Enex'i hafiflet (animasyon/efekt durdur, öncelik düşür)
  activityRpc: true,     // Rich Presence destekleyen uygulamalar Enex'e bağlanabilsin
  version: 6
};
const settingsFile = () => path.join(app.getPath('userData'), 'enex-settings.json');
let settings = { ...DEFAULTS };

function loadSettings() {
  try { settings = { ...DEFAULTS, ...JSON.parse(fs.readFileSync(settingsFile(), 'utf8')) }; } catch (_) {}
  if (!THEMES.some((th) => th.id === settings.theme)) settings.theme = DEFAULTS.theme;
  applyLang();
  if (settings.wallpaper && !fs.existsSync(settings.wallpaper)) settings.wallpaper = null;
  // Eski sürümden gelen ayarları yeni varsayılanlara taşı
  const v = settings.version || 0;
  if (v < 3) {
    settings.glassMode = DEFAULTS.glassMode;
    settings.animeAlpha = DEFAULTS.animeAlpha;
  }
  if (v < 4) {
    settings.glassAlpha = DEFAULTS.glassAlpha;
  }
  if (v < 5) {
    settings.musicSources = 'all'; // tarayıcıdan dinlenen müzik de paylaşılsın
  }
  if (v < 6) {
    settings.musicSources = 'smart'; // her videoyu değil, sadece müziği paylaş
    settings.version = 6;
    saveSettings();
  }
}
function applyLang() {
  i18n.setLang(i18n.resolveLang(settings.lang, app.getLocale()));
}

function saveSettings() {
  try { fs.writeFileSync(settingsFile(), JSON.stringify(settings, null, 2)); } catch (_) {}
}

const readTheme = (name) => fs.readFileSync(path.join(__dirname, 'themes', `${name}.css`), 'utf8');
const isHex = (v) => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, Number(v) || 0));
const ext = (p) => path.extname(p || '').slice(1).toLowerCase();

function isDiscord(url) {
  try { return ALLOWED_HOSTS.includes(new URL(url).hostname); } catch (_) { return false; }
}

const wantsClear = () => settings.theme === 'glass' && settings.glassMode === 'clear';

// =====================================================================
// ENGEL AŞMA (ByeDPI)
// ciadpi.exe arka planda, penceresiz çalışan küçük bir yerel SOCKS proxy'dir.
// Sadece Enex'in trafiği ondan geçer; bilgisayarın geri kalanı etkilenmez.
// DNS de sadece Enex için şifreli (DNS-over-HTTPS) yapılır.
// =====================================================================
// Denenecek yöntemler. Sırayla test edilir, Discord'a ulaşabilen ilki kullanılır ve hatırlanır.
// "direct": proxy yok, sadece şifreli DNS (engel sadece DNS'teyse en hızlısı budur).
const DPI_METHODS = [
  { id: 'dns', direct: true },
  { id: 'sd', args: ['--split', '1+s', '--disorder', '3+s'] },
  { id: 'tlsrec', args: ['--tlsrec', '3+s', '--split', '1+s', '--disorder', '3+s'] },
  { id: 'fake5', args: ['--disorder', '1', '--fake', '-1', '--ttl', '5'] },
  { id: 'fake3', args: ['--disorder', '1', '--fake', '-1', '--ttl', '3'] },
  { id: 'fake8', args: ['--disorder', '1', '--fake', '-1', '--ttl', '8'] },
  { id: 'oob', args: ['--oob', '3+s', '--disorder', '1+s'] },
  { id: 'disoob', args: ['--disoob', '3+s', '--split', '1+s'] },
  { id: 'sni', args: ['--split', '0+sm', '--disorder', '0+se', '--tlsrec', '0+sm'] },
  { id: 'mix', args: ['--split', '1+s', '--disorder', '3+s', '--fake', '-1', '--ttl', '5', '--tlsrec', '3+s'] }
];
const PROBE_URLS = ['https://gateway.discord.gg/?v=10&encoding=json', 'https://discord.com/api/v10/gateway'];
const DOH_SERVERS = ['https://cloudflare-dns.com/dns-query', 'https://dns.google/dns-query'];

let dpiProc = null;
let dpiPort = null;
let dpiArgs = null;
// Durum, dil değişince yeniden çevrilebilsin diye anahtar olarak tutulur
let dpiStatus = { state: 'off', key: 'dpi.off' };
const dpiView = () => ({
  state: dpiStatus.state,
  message: dpiStatus.raw || t(dpiStatus.key, {
    ...dpiStatus.vars,
    method: dpiStatus.vars?.method ? t(`dpi.m.${dpiStatus.vars.method}`) : undefined
  })
});
let dpiRestarts = 0;
let dpiSearching = null;

function unpackedPath(...parts) {
  const p = path.join(__dirname, ...parts);
  const u = p.replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`);
  return u !== p && fs.existsSync(u) ? u : p;
}

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = nodeNet.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

function waitForPort(port, timeoutMs) {
  const until = Date.now() + timeoutMs;
  return new Promise((resolve) => {
    const tryOnce = () => {
      const sock = nodeNet.connect(port, '127.0.0.1');
      sock.once('connect', () => { sock.destroy(); resolve(true); });
      sock.once('error', () => {
        sock.destroy();
        if (Date.now() > until) resolve(false);
        else setTimeout(tryOnce, 100);
      });
    };
    tryOnce();
  });
}

function stopDpi() {
  if (dpiProc) {
    dpiProc.removeAllListeners('exit');
    try { dpiProc.kill(); } catch (_) {}
  }
  dpiProc = null;
  dpiPort = null;
  dpiArgs = null;
}

// ciadpi.exe'yi verilen ayarlarla penceresiz başlat
async function spawnCiadpi(args) {
  const exe = unpackedPath('bin', 'ciadpi.exe');
  if (!fs.existsSync(exe)) { const e = new Error('missing'); e.code = 'MISSING'; throw e; }
  const port = await freePort();
  const proc = spawn(exe, ['-i', '127.0.0.1', '-p', String(port), ...args], { windowsHide: true, stdio: 'ignore' });
  const failed = new Promise((resolve) => {
    proc.once('error', (e) => resolve(e));
    proc.once('exit', (c) => resolve(new Error(`çıkış kodu ${c}`)));
  });
  const up = await Promise.race([waitForPort(port, 4000), failed.then(() => false)]);
  if (up !== true) {
    try { proc.kill(); } catch (_) {}
    const err = await Promise.race([failed, new Promise((r) => setTimeout(() => r(null), 50))]);
    throw new Error(`ciadpi başlamadı${err ? ` (${err.message})` : ''}`);
  }
  return { proc, port };
}

// Ayrı bir test oturumuyla Discord'a gerçekten ulaşılabiliyor mu bak
async function probe(proxyRules) {
  const ses = session.fromPartition('enex-probe');
  await ses.setProxy(proxyRules ? { proxyRules, proxyBypassRules: '<local>' } : { mode: 'direct' });
  await ses.closeAllConnections().catch(() => {});
  try {
    await Promise.all(PROBE_URLS.map((u) =>
      ses.fetch(u, { cache: 'no-store', signal: AbortSignal.timeout(6000) })
    ));
    return true;
  } catch (_) {
    return false;
  }
}

function adoptProc(proc, port, args) {
  dpiProc = proc;
  dpiPort = port;
  dpiArgs = args;
  proc.once('exit', () => {
    if (dpiProc !== proc) return;
    dpiProc = null;
    dpiPort = null;
    dpiStatus = { state: 'error', key: 'dpi.stopped' };
    if (dpiRestarts++ < 3) {
      setTimeout(async () => {
        try {
          const r = await spawnCiadpi(args);
          adoptProc(r.proc, r.port, args);
          await session.defaultSession.setProxy({ proxyRules: `socks4://127.0.0.1:${r.port}`, proxyBypassRules: '<local>' });
          dpiStatus = { state: 'on', key: 'dpi.on', vars: { method: settings.dpiMethod } };
          if (mainWindow) mainWindow.webContents.reload();
        } catch (_) { /* aşağıda bildirilir */ }
        notifyDpi();
      }, 1000);
    }
    notifyDpi();
  });
}

function notifyDpi(progress) {
  if (studioWindow && !studioWindow.isDestroyed()) studioWindow.webContents.send('studio:dpi', dpiView());
  if (progress && mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('enex:loading', progress);
}

// Çalışan bir yöntem bul. Önce en son çalışanı dener; olmazsa hepsini sırayla.
async function findMethod(forceSearch) {
  const ordered = [...DPI_METHODS];
  const lastIdx = ordered.findIndex((m) => m.id === settings.dpiMethod);
  if (lastIdx > 0 && !forceSearch) ordered.unshift(...ordered.splice(lastIdx, 1));

  for (let i = 0; i < ordered.length; i++) {
    const m = ordered[i];
    dpiStatus = { state: 'search', key: 'dpi.searching', vars: { i: i + 1, n: ordered.length } };
    notifyDpi(t('loading.search', { i: i + 1, n: ordered.length, name: t(`dpi.m.${m.id}`) }));

    if (m.direct) {
      if (await probe(null)) return { method: m };
      continue;
    }
    let r;
    try { r = await spawnCiadpi(m.args); } catch (err) {
      if (err.code === 'MISSING') {
        dpiStatus = { state: 'error', key: 'dpi.missing' };
        return null;
      }
      continue;
    }
    if (await probe(`socks4://127.0.0.1:${r.port}`)) return { method: m, ...r };
    try { r.proc.kill(); } catch (_) {}
  }
  return null;
}

// Proxy ve DNS ayarlarını sadece Enex'in oturumuna uygula
async function applyNetwork(forceSearch = false) {
  if (dpiSearching) return dpiSearching;
  dpiSearching = (async () => {
    const ses = session.defaultSession;
    stopDpi();
    dpiRestarts = 0;
    try {
      app.configureHostResolver({
        secureDnsMode: settings.dpiEnabled ? 'secure' : 'automatic',
        secureDnsServers: DOH_SERVERS
      });
    } catch (err) {
      console.error('DNS ayarlanamadı:', err);
    }

    if (!settings.dpiEnabled) {
      dpiStatus = { state: 'off', key: 'dpi.off' };
      await ses.setProxy({ mode: 'direct' });
    } else if (process.platform !== 'win32') {
      dpiStatus = { state: 'error', key: 'dpi.windowsOnly' };
      await ses.setProxy({ mode: 'direct' });
    } else {
      const found = await findMethod(forceSearch);
      if (!found) {
        if (dpiStatus.key !== 'dpi.missing') dpiStatus = { state: 'error', key: 'dpi.failed' };
        await ses.setProxy({ mode: 'direct' });
      } else {
        settings.dpiMethod = found.method.id;
        saveSettings();
        if (found.proc) {
          adoptProc(found.proc, found.port, found.method.args);
          await ses.setProxy({ proxyRules: `socks4://127.0.0.1:${found.port}`, proxyBypassRules: '<local>' });
        } else {
          await ses.setProxy({ mode: 'direct' });
        }
        dpiStatus = { state: 'on', key: 'dpi.on', vars: { method: found.method.id } };
      }
    }
    await ses.closeAllConnections().catch(() => {});
    notifyDpi();
  })().finally(() => { dpiSearching = null; });
  return dpiSearching;
}

async function testConnection() {
  const t0 = Date.now();
  try {
    await Promise.all(PROBE_URLS.map((u) =>
      session.defaultSession.fetch(u, { cache: 'no-store', signal: AbortSignal.timeout(8000) })
    ));
    return { ok: true, message: t('dpi.reached', { ms: Date.now() - t0 }) };
  } catch (err) {
    return { ok: false, message: t('dpi.unreachable', { err: err.message }) };
  }
}

app.on('will-quit', stopDpi);
process.on('exit', stopDpi);

// ---------- Duvar kağıdı ----------
// wallpapers/ klasörüne "varsayilan.*" adıyla konan dosya hazır duvar kağıdı olur
function bundledWallpaper() {
  // Kurulu uygulamada duvar kağıtları paketin dışında (app.asar.unpacked) durur: video akışı orada sorunsuz
  let dir = path.join(__dirname, 'wallpapers');
  const unpacked = dir.replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`);
  if (unpacked !== dir && fs.existsSync(unpacked)) dir = unpacked;
  try {
    const f = fs.readdirSync(dir).find((n) => /^varsayilan\.(mp4|webm|jpe?g|png|webp|gif)$/i.test(n));
    if (f) return path.join(dir, f);
  } catch (_) {}
  return path.join(dir, settings.fx ? 'sakura-gecesi.svg' : 'sakura-gecesi-static.svg');
}
function wallpaperFile() {
  return settings.wallpaper || bundledWallpaper();
}
function wallpaperState() {
  if (settings.theme !== 'anime') return null;
  const file = wallpaperFile();
  const kind = VIDEO_EXT.includes(ext(file)) ? 'video' : 'image';
  return {
    src: `enex://wall/${encodeURIComponent(path.basename(file))}?v=${encodeURIComponent(file)}`,
    kind,
    dim: settings.wallDim,
    paused: !settings.fx,
    kenburns: true
  };
}

// ---------- Panel saydamlığı (Cam ve Anime) ----------
function alphaCss() {
  let rgb, a;
  if (settings.theme === 'glass') {
    // Cam: tüm paneller neredeyse aynı saydamlıkta, arkadaki yazı okunabilsin
    const g = clamp(settings.glassAlpha, 0, 0.9);
    const f2 = (x) => clamp(x, 0, 0.97).toFixed(2);
    return `html:root {
      --nx-bg-rail: rgba(8, 8, 12, ${f2(g + 0.02)}) !important;
      --nx-bg-side: rgba(8, 8, 12, ${f2(g)}) !important;
      --nx-bg-chat: rgba(8, 8, 12, ${f2(g)}) !important;
      --nx-bg-input: rgba(8, 8, 12, ${f2(g + 0.08)}) !important;
    }`;
  }
  else if (settings.theme === 'anime') { rgb = '14, 10, 32'; a = settings.animeAlpha; }
  else return null;
  const f = (x) => clamp(x, 0, 0.97).toFixed(2);
  return `html:root {
    --nx-bg-rail: rgba(${rgb}, ${f(a + 0.1)}) !important;
    --nx-bg-side: rgba(${rgb}, ${f(a)}) !important;
    --nx-bg-chat: rgba(${rgb}, ${f(a - 0.08)}) !important;
    --nx-bg-input: rgba(${rgb}, ${f(a + 0.15)}) !important;
  }`;
}

// ---------- Pencere malzemesi (buzlu cam) ----------
function applyWindowMaterial() {
  if (!mainWindow || mainIsClear) return;
  const acrylic = settings.theme === 'glass' && settings.glassMode === 'acrylic';
  try {
    if (typeof mainWindow.setBackgroundMaterial === 'function') {
      mainWindow.setBackgroundMaterial(acrylic ? 'acrylic' : 'none');
    }
    mainWindow.setBackgroundColor(acrylic ? '#00000000' : '#07060f');
  } catch (err) {
    console.error('Pencere malzemesi ayarlanamadı:', err);
  }
}

// ---------- Tema uygulama ----------
async function applyTheme() {
  if (!mainWindow) return;
  const wc = mainWindow.webContents;
  try {
    const old = cssKeys;
    cssKeys = [];
    cssKeys.push(await wc.insertCSS(readTheme('core')));
    cssKeys.push(await wc.insertCSS(readTheme(settings.theme)));
    cssKeys.push(await wc.insertCSS(readTheme('motion')));
    const a = alphaCss();
    if (a) cssKeys.push(await wc.insertCSS(a));
    if (isHex(settings.accent)) {
      cssKeys.push(await wc.insertCSS(
        `html:root { --nx-accent: ${settings.accent} !important; --nx-glow: ${settings.accent}aa !important; }`
      ));
    }
    for (const k of old) await wc.removeInsertedCSS(k).catch(() => {});

    const flags = { 'data-nx-fx': settings.fx, 'data-nx-cards': settings.cards, 'data-nx-clean': settings.clean };
    await wc.executeJavaScript(`(() => {
      const f = ${JSON.stringify(flags)};
      for (const [k, v] of Object.entries(f)) {
        if (v) document.documentElement.setAttribute(k, '');
        else document.documentElement.removeAttribute(k);
      }
      document.documentElement.setAttribute('data-nx-theme', ${JSON.stringify(settings.theme)});
    })()`);

    wc.send('enex:wallpaper', wallpaperState());
    sendChrome();
  } catch (err) {
    console.error('Tema uygulanamadı:', err);
  }
  applyWindowMaterial();
}

function sendChrome() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const maximized = mainIsClear ? Boolean(mainWindow.restoredBounds) : mainWindow.isMaximized();
  mainWindow.webContents.send('enex:chrome', {
    clear: mainIsClear,
    maximized,
    labels: {
      brand: t('app.name').toUpperCase(),
      minimize: t('win.minimize'),
      maximize: t('win.maximize'),
      restore: t('win.restore'),
      close: t('win.close')
    }
  });
}

async function updateSettings(patch) {
  for (const [k, v] of Object.entries(patch || {})) {
    if (k === 'theme' && THEMES.some((th) => th.id === v)) settings.theme = v;
    if (k === 'lang' && ['auto', ...i18n.LANGS].includes(v)) { settings.lang = v; applyLang(); }
    if (['fx', 'cards', 'clean'].includes(k)) settings[k] = Boolean(v);
    if (k === 'accent') settings.accent = isHex(v) ? v : null;
    if (k === 'glassMode' && ['acrylic', 'clear'].includes(v)) settings.glassMode = v;
    if (k === 'glassAlpha') settings.glassAlpha = clamp(v, 0, 0.9);
    if (k === 'animeAlpha') settings.animeAlpha = clamp(v, 0, 0.9);
    if (k === 'wallDim') settings.wallDim = clamp(v, 0, 0.85);
    if (k === 'wallpaper') settings.wallpaper = (v && fs.existsSync(v)) ? v : null;
    if (k === 'dpiEnabled') settings.dpiEnabled = Boolean(v);
    if (k === 'shareAudio') settings.shareAudio = Boolean(v);
    if (k === 'overlay') settings.overlay = Boolean(v);
    if (k === 'overlayCorner' && OVERLAY_CORNERS.includes(v)) settings.overlayCorner = v;
    if (['activityGames', 'activityMusic', 'activityRpc'].includes(k)) settings[k] = Boolean(v);
    if (k === 'musicSources' && MUSIC_SOURCES.includes(v)) settings.musicSources = v;
    if (k === 'musicBlock') settings.musicBlock = String(v || '').slice(0, 2000);
    if (k === 'perfMode') settings.perfMode = Boolean(v);
  }
  saveSettings();

  // Sadece oyun içi arayüz / etkinlik ayarı değiştiyse Discord'a dokunmaya gerek yok
  const keys = Object.keys(patch || {});
  const OVERLAY_KEYS = ['overlay', 'overlayCorner'];
  const ACTIVITY_KEYS = ['activityGames', 'activityMusic', 'activityRpc', 'musicSources', 'musicBlock', 'perfMode'];
  if (keys.length && keys.every((k) => OVERLAY_KEYS.includes(k) || ACTIVITY_KEYS.includes(k))) {
    if (keys.some((k) => OVERLAY_KEYS.includes(k))) applyOverlaySettings('overlay' in patch);
    if (keys.some((k) => ACTIVITY_KEYS.includes(k))) applyActivitySettings();
    buildMenu();
    pushStudio();
    return studioState();
  }
  pushOverlayConfig(); // tema/dil/vurgu rengi overlay'e de yansısın

  if ('lang' in (patch || {}) && studioWindow && !studioWindow.isDestroyed()) {
    studioWindow.setTitle(t('app.studio'));
  }

  if ('dpiEnabled' in (patch || {})) {
    // Bağlantı değişti: Discord'u yeni bağlantıyla yeniden yükle (tema dom-ready'de yeniden uygulanır)
    await applyNetwork();
    if (mainWindow) mainWindow.webContents.reload();
    buildMenu();
    pushStudio();
    return studioState();
  }

  // Tam saydam mod pencere açılırken seçilebiliyor; değiştiyse pencereyi yeniden kur
  if (mainWindow && wantsClear() !== mainIsClear) createWindow();
  else await applyTheme();

  buildMenu();
  pushStudio();
  return studioState();
}

// Ayar menüden ya da kısayoldan değişirse Stüdyo da güncellensin
function pushStudio() {
  if (studioWindow && !studioWindow.isDestroyed()) studioWindow.webContents.send('studio:state', studioState());
}

const studioState = () => ({
  settings,
  lang: i18n.getLang(),
  strings: i18n.dict(),
  themes: themeList(),
  wallpaperName: settings.wallpaper ? path.basename(settings.wallpaper) : null,
  bundledIsAnime: /^varsayilan\./i.test(path.basename(bundledWallpaper())),
  acrylicSupported: process.platform === 'win32',
  dpi: dpiView(),
  dpiSearching: Boolean(dpiSearching),
  activity: activityStatus()
});

// ---------- Ana pencere ----------
function createWindow(startUrl = DISCORD_URL) {
  const clear = wantsClear();
  const old = mainWindow;
  const bounds = old && !old.isDestroyed() ? old.getBounds() : null;

  const win = new BrowserWindow({
    width: bounds ? bounds.width : 1400,
    height: bounds ? bounds.height : 880,
    x: bounds ? bounds.x : undefined,
    y: bounds ? bounds.y : undefined,
    minWidth: 940,
    minHeight: 560,
    backgroundColor: clear ? '#00000000' : '#07060f',
    transparent: clear,
    frame: false, // başlık çubuğunu temanın parçası olarak kendimiz çiziyoruz
    icon: path.join(__dirname, 'build', 'icon.ico'),
    resizable: !clear, // Windows'ta saydam pencereler yeniden boyutlandırılamıyor
    autoHideMenuBar: true,
    title: t('app.name'),
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'discord-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: true,
      autoplayPolicy: 'no-user-gesture-required',
      // Oyundayken Enex arka planda kalır; Chromium zamanlayıcıları yavaşlatırsa
      // overlay'deki konuşma göstergesi gecikir. (Vesktop da kapatıyor.)
      backgroundThrottling: false
    }
  });
  mainWindow = win;
  mainIsClear = clear;
  win.restoredBounds = null;

  win.once('ready-to-show', () => {
    win.show();
    if (old && !old.isDestroyed()) {
      old.removeAllListeners('closed');
      old.destroy();
    }
  });

  win.on('maximize', sendChrome);
  win.on('unmaximize', sendChrome);
  // Enex öndeyken overlay gizlenir, oyuna geçince geri gelir
  win.on('focus', refreshOverlay);
  win.on('blur', refreshOverlay);

  win.webContents.on('dom-ready', () => {
    cssKeys = [];
    applyTheme();
  });

  win.webContents.setWindowOpenHandler(handleWindowOpen);
  win.webContents.on('did-create-window', (child, { frameName }) => {
    if (String(frameName || '').startsWith('DISCORD_')) setupPopout(child, frameName);
  });
  win.webContents.on('render-process-gone', (_e, d) => dlog('main', 'Discord sayfası çöktü:', d.reason));
  win.webContents.on('will-navigate', (event, url) => {
    if (!isDiscord(url)) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });

  win.on('page-title-updated', (e) => {
    e.preventDefault();
    const title = win.webContents.getTitle().replace(/\s*\|?\s*Discord\s*$/i, '');
    win.setTitle(title ? `Enex — ${title}` : 'Enex');
  });

  win.on('closed', () => {
    if (mainWindow === win) {
      mainWindow = null;
      app.quit();
    }
  });

  if (startUrl === DISCORD_URL) win.loadURL(DISCORD_URL);
  else win.loadFile(startUrl);
}

// Tam saydam moddaki kendi butonlarımız
ipcMain.on('enex:win', (e, action) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  if (!win) return;
  if (action === 'minimize') win.minimize();
  if (action === 'close') win.close();
  if (action === 'maximize' && !(win === mainWindow && mainIsClear)) {
    if (win.isMaximized()) win.unmaximize();
    else win.maximize();
  } else if (action === 'maximize') {
    // Saydam pencere maximize() desteklemediği için ekranı elle kaplıyoruz
    if (win.restoredBounds) {
      win.setBounds(win.restoredBounds);
      win.restoredBounds = null;
    } else {
      win.restoredBounds = win.getBounds();
      win.setBounds(screen.getDisplayMatching(win.getBounds()).workArea);
    }
    sendChrome();
  }
});

// ---------- Tema Stüdyosu ----------
function openStudio() {
  if (studioWindow && !studioWindow.isDestroyed()) {
    if (studioWindow.isMinimized()) studioWindow.restore();
    studioWindow.show();
    studioWindow.focus();
    return;
  }
  studioWindow = new BrowserWindow({
    width: 1020,
    height: 760,
    minWidth: 780,
    minHeight: 560,
    backgroundColor: '#0b0a12',
    autoHideMenuBar: true,
    title: t('app.studio'),
    icon: path.join(__dirname, 'build', 'icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'studio-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  studioWindow.setMenu(null);
  studioWindow.loadFile(path.join(__dirname, 'studio.html'));
  studioWindow.on('closed', () => { studioWindow = null; });
}

ipcMain.handle('studio:get-state', () => studioState());
ipcMain.handle('studio:set', (_e, patch) => updateSettings(patch));
ipcMain.handle('studio:dpi-test', () => testConnection());
ipcMain.handle('studio:dpi-research', async () => {
  await applyNetwork(true);
  if (mainWindow) mainWindow.webContents.reload();
  return studioState();
});
ipcMain.handle('studio:pick-wallpaper', async () => {
  const res = await dialog.showOpenDialog(studioWindow || mainWindow, {
    title: t('dialog.wallpaper'),
    properties: ['openFile'],
    filters: [
      { name: t('dialog.media'), extensions: [...VIDEO_EXT, ...IMAGE_EXT] },
      { name: t('dialog.videos'), extensions: VIDEO_EXT },
      { name: t('dialog.images'), extensions: IMAGE_EXT }
    ]
  });
  if (res.canceled || !res.filePaths[0]) return studioState();
  return updateSettings({ wallpaper: res.filePaths[0], theme: 'anime' });
});

// =====================================================================
// YAYIN SESİ
// enex-audio.exe Windows'un "process loopback" özelliğiyle sesi yakalar ve
// 48 kHz / 2 kanal / 16 bit PCM olarak gönderir. Bu ses, Discord sayfasında
// ekran paylaşımı akışına ayrı bir ses kanalı olarak eklenir (discord-preload.js).
// =====================================================================
let pendingShareAudio = null; // seçilen kaynağa göre enex-audio.exe argümanları
let audioProc = null;
let audioLeftover = null;

function stopShareAudio() {
  if (audioProc) {
    audioProc.removeAllListeners('exit');
    try { audioProc.stdin.end(); } catch (_) {}
    try { audioProc.kill(); } catch (_) {}
  }
  audioProc = null;
  audioLeftover = null;
}

function startShareAudio() {
  stopShareAudio();
  if (!pendingShareAudio || process.platform !== 'win32') return { ok: false };
  const exe = unpackedPath('bin', 'enex-audio.exe');
  if (!fs.existsSync(exe)) return { ok: false, reason: 'missing' };

  const proc = spawn(exe, pendingShareAudio, { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  audioProc = proc;
  proc.on('error', (err) => console.error('enex-audio:', err));
  proc.stderr.on('data', (d) => console.error(String(d).trim()));
  proc.stdout.on('data', (chunk) => {
    // Kare (4 bayt) sınırında böl, artan baytları bir sonraki parçaya ekle
    const buf = audioLeftover ? Buffer.concat([audioLeftover, chunk]) : chunk;
    const usable = buf.length - (buf.length % 4);
    audioLeftover = usable < buf.length ? Buffer.from(buf.subarray(usable)) : null;
    if (usable > 0 && mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('enex:pcm', buf.subarray(0, usable));
    }
  });
  proc.on('exit', () => { if (audioProc === proc) audioProc = null; });
  return { ok: true, sampleRate: 48000, channels: 2 };
}

ipcMain.handle('enex:audio-start', () => startShareAudio());
ipcMain.on('enex:audio-stop', () => stopShareAudio());
app.on('will-quit', stopShareAudio);

// ---------- Ekran paylaşımı seçici ----------
function pickScreenSource(sources) {
  return new Promise((resolve) => {
    const picker = new BrowserWindow({
      parent: mainWindow,
      modal: true,
      width: 860,
      height: 600,
      resizable: false,
      minimizable: false,
      maximizable: false,
      backgroundColor: '#07060f',
      autoHideMenuBar: true,
      title: t('picker.title'),
      webPreferences: {
        preload: path.join(__dirname, 'picker-preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true
      }
    });
    picker.setMenu(null);

    let done = false;
    const finish = (id, audio) => {
      if (done) return;
      done = true;
      ipcMain.removeHandler('picker:get-sources');
      ipcMain.removeAllListeners('picker:choose');
      const source = sources.find((s) => s.id === id) || null;
      if (source && typeof audio === 'boolean' && audio !== settings.shareAudio) {
        settings.shareAudio = audio;
        saveSettings();
      }
      resolve(source ? { source, audio: Boolean(audio) } : null);
      if (!picker.isDestroyed()) picker.close();
    };

    ipcMain.handle('picker:get-sources', () => ({
      strings: i18n.dict(),
      shareAudio: settings.shareAudio,
      audioSupported: process.platform === 'win32',
      sources: sources.map((s) => ({
        id: s.id,
        name: s.name,
        isScreen: s.id.startsWith('screen:'),
        thumbnail: s.thumbnail.toDataURL()
      }))
    }));
    ipcMain.on('picker:choose', (_e, choice) => {
      if (choice && typeof choice === 'object') finish(choice.id, choice.audio);
      else finish(null);
    });
    picker.on('closed', () => finish(null));

    picker.loadFile(path.join(__dirname, 'picker.html'));
  });
}

function setupSession() {
  const ses = session.defaultSession;

  ses.setUserAgent(app.userAgentFallback.replace(/\s(Electron|enex|nexus|discord-client)\/\S+/gi, ''));
  ses.setSpellCheckerLanguages(['tr', 'en-US']);

  const allowed = new Set([
    'media', 'notifications', 'clipboard-sanitized-write', 'clipboard-read',
    'display-capture', 'fullscreen', 'speaker-selection'
  ]);
  ses.setPermissionRequestHandler((wc, permission, callback, details) => {
    callback(isDiscord(details.requestingUrl || wc.getURL()) && allowed.has(permission));
  });
  ses.setPermissionCheckHandler((wc, permission, origin) =>
    isDiscord(origin) && allowed.has(permission)
  );

  ses.setDisplayMediaRequestHandler(async (request, callback) => {
    try {
      const sources = await desktopCapturer.getSources({
        types: ['screen', 'window'],
        thumbnailSize: { width: 400, height: 225 },
        fetchWindowIcons: false
      });
      const picked = await pickScreenSource(sources);
      if (!picked) return callback({});
      const chosen = picked.source;
      // Ses Chromium'un "loopback"u ile DEĞİL, kendi yakalayıcımızla alınır:
      // loopback bilgisayarın tüm sesini (Discord'daki konuşmalar dahil) yayına katıyordu.
      // Pencere paylaşılırsa sadece o uygulamanın sesi, ekran paylaşılırsa Enex hariç her şey.
      if (picked.audio && process.platform === 'win32') {
        const hwnd = chosen.id.startsWith('window:') ? chosen.id.split(':')[1] : null;
        pendingShareAudio = hwnd ? ['--hwnd', hwnd] : ['--exclude', String(process.pid)];
      } else {
        pendingShareAudio = null;
      }
      callback({ video: chosen });
    } catch (err) {
      console.error('Ekran paylaşımı hatası:', err);
      callback({});
    }
  });

  // enex://wall/... → seçili duvar kağıdı dosyası (sadece o dosya, başka hiçbir şey)
  protocol.handle('enex', (request) => {
    const url = new URL(request.url);
    if (url.hostname !== 'wall') return new Response('Not found', { status: 404 });
    const file = wallpaperFile();
    if (!fs.existsSync(file)) return new Response('Not found', { status: 404 });
    return net.fetch(pathToFileURL(file).toString(), { headers: request.headers });
  });
}


// =====================================================================
// TANILAMA GÜNLÜĞÜ
// userData\enex-debug.log (geliştirirken proje klasörüne de yazılır).
// Bir şey çalışmazsa bu dosyaya bakılır; hesap bilgisi yazılmaz.
// =====================================================================
const LOG_MAX = 512 * 1024;
let logFiles = null;
function dlog(scope, ...parts) {
  const line = `${new Date().toISOString()} [${scope}] ${parts.map((p) => (typeof p === 'string' ? p : JSON.stringify(p))).join(' ')}\n`;
  try {
    if (!logFiles) {
      logFiles = [path.join(app.getPath('userData'), 'enex-debug.log')];
      if (!app.isPackaged) logFiles.push(path.join(__dirname, 'enex-debug.log'));
      for (const f of logFiles) {
        try { if (fs.statSync(f).size > LOG_MAX) fs.renameSync(f, f + '.old'); } catch (_) {}
      }
      for (const f of logFiles) fs.appendFileSync(f, `\n===== Enex ${app.getVersion()} · Electron ${process.versions.electron} · ${process.platform} ${require('os').release()} =====\n`);
    }
    for (const f of logFiles) fs.appendFile(f, line, () => {});
  } catch (_) {}
  console.log(line.trim());
}

// =====================================================================
// ETKİNLİK PAYLAŞIMI (Oynuyor / Dinliyor)
// activity.js oyunları ve çalan müziği algılar, rpc.js Rich Presence uygulamalarını dinler.
// Hepsi discord-preload.js'teki köprü üzerinden Discord'a "yerel etkinlik" olarak verilir;
// Discord bunu masaüstü uygulamasındaki gibi profilinde gösterir.
// =====================================================================
const MUSIC_SOURCES = ['music', 'smart', 'all'];

// ---------- Müzik gizlilik filtresi ----------
// Yetişkin içerik siteleri ve kesin terimler: hangi kaynaktan gelirse gelsin ASLA paylaşılmaz.
const ADULT_HARD = [
  'porn', 'porno', 'pornhub', 'xvideos', 'xnxx', 'xhamster', 'redtube', 'youporn', 'brazzers', 'onlyfans', 'fansly',
  'chaturbate', 'stripchat', 'xxx', 'nsfw', 'hentai', 'rule34', 'r34', 'sikiş', 'sikis', 'camgirl', 'r18', 'jav', 'ifşa', 'ifsa'
];
// Daha geniş terimler: şarkı adlarında da geçebildiği için sadece tarayıcı/video kaynaklarına uygulanır
const ADULT_SOFT = [
  'erotic', 'erotik', 'erotica', 'nude', 'nudes', 'naked', 'sex', 'sexy', 'seks', 'çıplak', 'ciplak', 'escort',
  'milf', 'webcam show', '+18', '18+', 'yetişkin', 'adult', 'lewd', 'ecchi', 'bdsm', 'fetish'
];
// Tarayıcıda çalanın müzik olduğunu gösteren işaretler (YouTube başlık alışkanlıkları)
const MUSIC_HINT = /official\s*(music\s*)?(video|audio|visuali[sz]er)|music\s*video|\blyrics?\b|lyric\s*video|\(audio\)|\[audio\]|\bft\.|\bfeat\.?\s|\bprod\.|\bremix\b|\bslowed\b|\breverb\b|\bsped\s*up\b|\bacoustic\b|\bklip\b|şarkı sözleri|\bcover\b|\blive\s+(at|from|session)\b/i;

const escapeRe = (w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function blockRegex(soft) {
  const custom = String(settings.musicBlock || '').split(/[,\n]/).map((w) => w.trim().toLowerCase()).filter((w) => w.length >= 2);
  const words = [...ADULT_HARD, ...(soft ? ADULT_SOFT : []), ...custom];
  // Kelime sınırı: harf/rakam olmayan karakter ya da metin başı/sonu (Türkçe harfler dahil)
  return new RegExp(`(^|[^\\p{L}\\p{N}])(${words.map(escapeRe).join('|')})(?=$|[^\\p{L}\\p{N}])`, 'iu');
}

// Çalan medya paylaşılabilir mi? 'ok' ya da neden paylaşılmadığı
function musicVerdict(m) {
  const text = `${m.title} ${m.artist} ${m.album} ${m.app}`;
  if (blockRegex(m.kind !== 'music').test(text)) return 'blocked';
  if (settings.musicSources === 'all') return 'ok';
  if (m.kind === 'music') return 'ok';
  if (settings.musicSources === 'music') return 'not-music-app';
  // Akıllı mod: tarayıcıda sadece müzik olduğu belli olanlar
  if (m.kind === 'browser') {
    if (m.album) return 'ok'; // YouTube Music, Spotify Web, Apple Music Web albüm bilgisi verir
    if (/ - topic$/i.test(m.artist)) return 'ok'; // YouTube'un otomatik müzik kanalları
    if (MUSIC_HINT.test(m.title)) return 'ok';
    return 'not-music';
  }
  return 'not-music';
}
let activitySvc = null;
let rpcServer = null;
const liveActivities = new Map(); // socketId -> Discord'a gönderilen son mesaj
let bridgeDiag = null;            // köprünün son durum raporu
let lastMusicMsg = null;
let musicVerdictNow = null;

function sendActivity(msg) {
  if (msg.activity) liveActivities.set(msg.socketId, msg);
  else liveActivities.delete(msg.socketId);
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('enex:activity', msg);
  pushStudioActivity();
}

function gameMessage(g, on = true) {
  return {
    socketId: `game:${g.id}`, pid: g.pid, kind: 'game',
    activity: on ? {
      application_id: g.id, name: g.name, type: 0, flags: 0, metadata: {},
      timestamps: { start: g.start }
    } : null
  };
}

function updateMusic() {
  const m = activitySvc && activitySvc.music;
  let activity = null;
  const verdict = m && m.playing ? musicVerdict(m) : null;
  musicVerdictNow = verdict;
  if (settings.activityMusic && m && m.playing && verdict === 'ok') {
    // Tarayıcıda hangi sitenin çaldığı bilinmez: başlık olarak sanatçıyı kullan
    const name = m.player || m.artist || t('activity.musicName');
    activity = {
      application_id: '0',
      name: name.slice(0, 128),
      type: 2, // Dinliyor
      flags: 1,
      status_display_type: m.artist ? 1 : 2, // üye listesinde sanatçı (yoksa şarkı) görünsün
      details: m.title,
      timestamps: m.end ? { start: Math.round(m.start), end: Math.round(m.end) } : { start: Math.round(m.start) }
    };
    if (m.artist) activity.state = m.artist;
  }
  const msg = { socketId: 'music', kind: 'music', skipIfNative: true, activity };
  const key = JSON.stringify(activity);
  if (lastMusicMsg === key) return;
  lastMusicMsg = key;
  // Gizlilik: paylaşılmayan medyanın adı günlüğe de yazılmaz
  if (activity) dlog('activity', `müzik paylaşılıyor: ${m.player || '?'} · ${m.artist} – ${m.title}`);
  else if (verdict && verdict !== 'ok') dlog('activity', `medya paylaşılmadı (${verdict})`);
  sendActivity(msg);
}

async function startRpc() {
  if (rpcServer || process.platform !== 'win32') return;
  rpcServer = new RpcServer(dlog);
  rpcServer.on('activity', (a) => {
    sendActivity({ socketId: a.socketId, pid: a.pid, kind: 'rpc', activity: a.activity });
  });
  await rpcServer.start();
  pushStudioActivity();
}
function stopRpc() {
  if (!rpcServer) return;
  for (const id of [...liveActivities.keys()]) {
    if (id.startsWith('rpc:')) sendActivity({ socketId: id, kind: 'rpc', activity: null });
  }
  rpcServer.stop();
  rpcServer = null;
}

function setupActivity() {
  activitySvc = new ActivityService({
    helperExe: unpackedPath('bin', 'enex-helper.exe'),
    cacheDir: app.getPath('userData'),
    fetch: (u) => session.defaultSession.fetch(u, { cache: 'no-store', signal: AbortSignal.timeout(30000) }),
    log: dlog
  });
  activitySvc.configure({ games: settings.activityGames, music: settings.activityMusic });
  activitySvc.on('game', (g) => sendActivity(gameMessage(g)));
  activitySvc.on('game-end', (g) => sendActivity(gameMessage(g, false)));
  activitySvc.on('music', updateMusic);
  activitySvc.on('foreground', onForeground);
  activitySvc.on('status', () => { pushStudioActivity(); refreshOverlay(); });
  activitySvc.start();
  if (settings.activityRpc) startRpc();
}

function applyActivitySettings() {
  applyPerf();
  if (!activitySvc) return;
  activitySvc.configure({ games: settings.activityGames, music: settings.activityMusic });
  updateMusic();
  if (settings.activityRpc) startRpc(); else stopRpc();
}

function activityStatus() {
  const st = activitySvc ? activitySvc.status() : { helper: 'off', media: 'off', db: 'none', dbCount: 0, games: [], music: null };
  return {
    ...st,
    music: liveActivities.has('music') ? st.music : null, // sadece gerçekten paylaşılan müzik
    rpc: rpcServer && rpcServer.path ? 'running' : (settings.activityRpc ? 'error' : 'off'),
    rpcApps: [...liveActivities.values()].filter((m) => m.kind === 'rpc' && m.activity).map((m) => m.activity.name || m.activity.application_id),
    bridge: bridgeDiag ? (bridgeDiag.dispatcher && bridgeDiag.voice ? 'ready' : 'partial') : 'waiting',
    bridgeInfo: bridgeDiag ? { dispatcher: bridgeDiag.dispatcher, voice: bridgeDiag.voice } : null,
    sharingOff: Boolean(bridgeDiag && bridgeDiag.showCurrentGame === false),
    musicHidden: settings.activityMusic && st.music && !liveActivities.has('music') ? (musicVerdictNow || null) : null,
    inGame
  };
}
let studioActTimer = null;
function pushStudioActivity() {
  if (studioActTimer) return;
  studioActTimer = setTimeout(() => {
    studioActTimer = null;
    if (studioWindow && !studioWindow.isDestroyed()) studioWindow.webContents.send('studio:activity', activityStatus());
  }, 200);
}
ipcMain.handle('studio:activity-status', () => activityStatus());
ipcMain.handle('studio:open-log', () => {
  dlog('main', 'günlük açıldı');
  return shell.openPath(path.join(app.getPath('userData'), 'enex-debug.log'));
});

app.on('will-quit', () => {
  if (activitySvc) activitySvc.stop();
  stopRpc();
});

// =====================================================================
// DISCORD AÇILIR PENCERELERİ (ör. yayını "ayrı pencerede oynat")
// Discord web, açılır pencere için discord.com/popout adresini DISCORD_ ile başlayan bir
// pencere adıyla açar ve içini kendisi doldurur. Bunu tarayıcıya değil, Enex'in içinde açıyoruz.
// (Vesktop'un yöntemi)
// =====================================================================
const popouts = new Map();
const POPOUT_FEATURES = new Set(['width', 'height', 'left', 'top', 'resizable', 'movable', 'alwaysOnTop', 'closable', 'skipTaskbar', 'backgroundColor']);

function parseFeatures(str) {
  const out = {};
  for (const part of String(str || '').split(',')) {
    const [k, v] = part.split('=').map((x) => (x || '').trim());
    if (!POPOUT_FEATURES.has(k)) continue;
    if (v === 'yes' || v === '1' || v === 'true') out[k] = true;
    else if (v === 'no' || v === '0' || v === 'false') out[k] = false;
    else if (v !== '' && !Number.isNaN(Number(v))) out[k] = Number(v);
    else out[k] = v;
  }
  // window.open'daki left/top -> Electron'daki x/y
  if (typeof out.left === 'number') { out.x = out.left; delete out.left; }
  if (typeof out.top === 'number') { out.y = out.top; delete out.top; }
  return out;
}

function handleWindowOpen({ url, frameName, features }) {
  let u;
  try { u = new URL(url); } catch (_) { return { action: 'deny' }; }
  if (String(frameName || '').startsWith('DISCORD_') && isDiscord(url) && u.pathname === '/popout') {
    const existing = popouts.get(frameName);
    if (existing && !existing.isDestroyed()) {
      if (existing.isMinimized()) existing.restore();
      existing.show();
      existing.focus();
      return { action: 'deny' };
    }
    dlog('popout', 'açılıyor:', frameName);
    return {
      action: 'allow',
      overrideBrowserWindowOptions: {
        title: t('app.name'),
        backgroundColor: '#1e1f22',
        minWidth: 320,
        minHeight: 180,
        autoHideMenuBar: true,
        icon: path.join(__dirname, 'build', 'icon.ico'),
        ...parseFeatures(features),
        frame: true, // web Discord açılır pencerede kendi başlık çubuğunu çizmiyor
        webPreferences: {
          preload: path.join(__dirname, 'discord-preload.js'),
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
          backgroundThrottling: false,
          autoplayPolicy: 'no-user-gesture-required'
        }
      }
    };
  }
  if (/^https?:$/.test(u.protocol) || u.protocol === 'mailto:' || u.protocol === 'spotify:' || u.protocol === 'steam:') {
    shell.openExternal(url);
  }
  return { action: 'deny' };
}

function setupPopout(child, frameName) {
  popouts.set(frameName, child);
  child.setMenu(null);
  child.webContents.setWindowOpenHandler(handleWindowOpen);
  child.webContents.on('will-navigate', (event, url) => {
    if (!isDiscord(url)) { event.preventDefault(); shell.openExternal(url); }
  });
  child.on('page-title-updated', (e, title) => {
    e.preventDefault();
    child.setTitle(title && !/^discord$/i.test(title) ? `Enex — ${title.replace(/\s*\|?\s*Discord\s*$/i, '')}` : 'Enex');
  });
  child.once('closed', () => { if (popouts.get(frameName) === child) popouts.delete(frameName); });
}

// =====================================================================
// OYUN İÇİ ARAYÜZ (overlay)
// Ekranın tamamını kaplayan, saydam, her zaman üstte duran ve tıklamaların
// içinden geçtiği ayrı bir pencere. Oyuna hiçbir şey enjekte etmez, bu yüzden
// hile korumalarıyla (Vanguard, EAC, BattlEye) sorun çıkarmaz.
// Not: Oyun "Tam ekran (exclusive)" modundaysa Windows hiçbir pencereyi üstüne
// çizdirmez; oyunda "Kenarlıksız / Pencereli tam ekran" seçilmelidir.
// Sadece bir OYUN öndeyken (tanınan oyun ya da ekranı kaplayan program) ve
// gösterecek bir şey varken görünür; oyunun açık olduğu monitöre yerleşir.
// enex-helper.exe çalışmıyorsa eski kurala döner: Enex arka plandayken göster.
// =====================================================================
const OVERLAY_HOTKEY = 'CmdOrCtrl+Alt+O';
const OVERLAY_CORNERS = ['tl', 'tr', 'bl', 'br'];
const OVERLAY_TOAST_MS = 6500;
const CDN_RE = /^https:\/\/(cdn|media)\.discordapp\.(com|net)\/[\w\-./?=&%]+$/i;

// İki küçük pencere: ses listesi ('voice') ve bildirimler ('toast'). Her biri sadece
// içeriği kadar büyük; tam ekran saydam pencere Windows'un oyunu en hızlı yoldan
// (bağımsız flip) ekrana basmasını engelleyip FPS'i düşürür, küçük pencereler bunu en aza indirir.
const OVERLAY_ZONES = ['voice', 'toast'];
const OPPOSITE_CORNER = { tl: 'tr', tr: 'tl', bl: 'br', br: 'bl' };
const OV = {};                // zone -> { win, ready, size: {w,h,has}, queue: [] }
let overlayVoice = { channel: null, members: [] };
let overlayToastUntil = 0;
let overlayToastTimer = null;
let overlayTopTimer = null;
let overlayPreviewUntil = 0;
let fgInfo = null;
let inGame = false;

const safeIcon = (u) => (typeof u === 'string' && CDN_RE.test(u) ? u : '');
const str = (v, n) => String(v ?? '').slice(0, n);

function helperActive() {
  return Boolean(activitySvc && activitySvc.helperState === 'running' && fgInfo);
}

// Şu an "oyundayız" sayılır mı?
function gameContext() {
  if (Date.now() < overlayPreviewUntil) return true;
  if (helperActive()) return inGame;
  return Boolean(mainWindow && !mainWindow.isDestroyed() && !mainWindow.isFocused());
}

// ---------- Oyun modu (FPS) ----------
// Oyun öndeyken: Discord sayfasındaki animasyon/bulanıklık/duvar kağıdı durur (discord-preload.js),
// Enex'in işlemleri düşük önceliğe iner. Ses servisi ve (sesli sohbetteyken) Discord sayfası
// normal öncelikte kalır ki ses kesilmesin.
let perfApplied = false;
function applyPerf(forceOff) {
  const on = Boolean(!forceOff && settings.perfMode && inGame);
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('enex:gaming', on);
  if (process.platform !== 'win32') return;
  if (!on && !perfApplied) return;
  perfApplied = on;
  const P = require('os').constants.priority;
  const inCall = overlayVoice.members.length > 0;
  const mainPid = mainWindow && !mainWindow.isDestroyed() ? mainWindow.webContents.getOSProcessId() : -1;
  const overlayPids = new Set(OVERLAY_ZONES.map((z) => OV[z] && OV[z].win && !OV[z].win.isDestroyed() ? OV[z].win.webContents.getOSProcessId() : -1));
  let changed = 0;
  for (const m of app.getAppMetrics()) {
    if (/audio/i.test(String(m.serviceName || ''))) continue;   // ses servisi: asla
    if (m.pid === mainPid && inCall) continue;                   // sesli sohbet (WebRTC) bu süreçte
    if (overlayPids.has(m.pid)) continue;                        // overlay akıcı kalsın
    try { require('os').setPriority(m.pid, on ? P.PRIORITY_BELOW_NORMAL : P.PRIORITY_NORMAL); changed++; } catch (_) {}
  }
  if (activitySvc && activitySvc.media && activitySvc.media.pid) {
    try { require('os').setPriority(activitySvc.media.pid, P.PRIORITY_BELOW_NORMAL); } catch (_) {}
  }
  dlog('perf', on ? `oyun modu açık (${changed} süreç düşük öncelikte${inCall ? ', sesli sohbet korunuyor' : ''})` : 'oyun modu kapandı');
}

let leaveTimer = null;
function setInGame(now) {
  if (now === inGame) return;
  inGame = now;
  dlog('overlay', now ? `oyun önde: ${fgInfo && (fgInfo.path || fgInfo.pid)}${fgInfo && fgInfo.full ? ' (tam ekran)' : ''}` : 'oyundan çıkıldı');
  applyPerf();
  pushStudioActivity();
  refreshOverlay();
}
function onForeground(fg) {
  fgInfo = fg;
  const now = Boolean(activitySvc && activitySvc.isGameForeground(fg));
  if (now) {
    clearTimeout(leaveTimer);
    leaveTimer = null;
    setInGame(true);
  } else if (inGame && !leaveTimer) {
    // Oyun bir an odağı kaybedebilir (Steam arayüzü, yükleme ekranı); hemen gizleme
    leaveTimer = setTimeout(() => {
      leaveTimer = null;
      if (!(activitySvc && activitySvc.isGameForeground(fgInfo))) setInGame(false);
    }, 2000);
  }
  refreshOverlay();
}

function overlayTargetBounds() {
  try {
    if (helperActive() && Array.isArray(fgInfo.mon)) {
      const [x, y, w, h] = fgInfo.mon;
      const p = process.platform === 'win32' ? screen.screenToDipPoint({ x: x + w / 2, y: y + h / 2 }) : { x, y };
      return screen.getDisplayNearestPoint(p).bounds;
    }
  } catch (_) {}
  return screen.getPrimaryDisplay().bounds;
}

function overlayAccent() {
  if (isHex(settings.accent)) return settings.accent;
  const th = THEMES.find((x) => x.id === settings.theme);
  return th ? th.colors[1] : '#a78bfa';
}

function zoneCorner(zone) {
  const c = OPPOSITE_CORNER[settings.overlayCorner] ? settings.overlayCorner : 'tl';
  return zone === 'voice' ? c : OPPOSITE_CORNER[c];
}

function pushOverlayConfig() {
  for (const zone of OVERLAY_ZONES) {
    const o = OV[zone];
    if (!o || !o.ready || o.win.isDestroyed()) continue;
    o.win.webContents.send('overlay:config', {
      corner: zoneCorner(zone),
      accent: overlayAccent(),
      labels: { more: t('overlay.more') }
    });
  }
  placeOverlays();
}

function ensureOverlay(zone) {
  const cur = OV[zone];
  if (cur && cur.win && !cur.win.isDestroyed()) return cur;
  const b = overlayTargetBounds();
  const win = new BrowserWindow({
    x: b.x, y: b.y, width: 1, height: 1,
    transparent: true,
    backgroundColor: '#00000000',
    frame: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    focusable: false,       // oyundan odağı asla çalmaz
    skipTaskbar: true,
    hasShadow: false,
    alwaysOnTop: true,
    show: false,
    title: 'Enex Overlay',
    webPreferences: {
      preload: path.join(__dirname, 'overlay-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
      spellcheck: false
    }
  });
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setIgnoreMouseEvents(true);   // fare tıklamaları oyuna geçer
  win.setMenu(null);
  const o = { zone, win, ready: false, size: { w: 0, h: 0, has: false }, queue: [] };
  OV[zone] = o;

  win.webContents.on('did-finish-load', () => {
    o.ready = true;
    pushOverlayConfig();
    if (zone === 'voice') win.webContents.send('overlay:voice', overlayVoice);
    for (const n of o.queue) win.webContents.send('overlay:toast', n);
    o.queue = [];
  });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.on('closed', () => { if (OV[zone] === o) delete OV[zone]; });
  win.loadFile(path.join(__dirname, 'overlay.html'), { query: { zone } });
  return o;
}

// Overlay sayfası içeriğinin boyutunu bildirir; pencere tam o kadar olur
ipcMain.on('overlay:size', (e, s) => {
  const o = OVERLAY_ZONES.map((z) => OV[z]).find((x) => x && !x.win.isDestroyed() && x.win.webContents === e.sender);
  if (!o || !s || typeof s !== 'object') return;
  o.size = {
    w: Math.max(1, Math.min(1200, Math.ceil(Number(s.w) || 0))),
    h: Math.max(1, Math.min(1600, Math.ceil(Number(s.h) || 0))),
    has: Boolean(s.has)
  };
  placeOverlays();
  refreshOverlay();
});

function placeOverlays() {
  const b = overlayTargetBounds();
  for (const zone of OVERLAY_ZONES) {
    const o = OV[zone];
    if (!o || o.win.isDestroyed()) continue;
    const { w, h } = o.size;
    if (w < 2 || h < 2) continue;
    const c = zoneCorner(zone);
    const x = c[1] === 'l' ? b.x : b.x + b.width - w;
    const y = c[0] === 't' ? b.y : b.y + b.height - h;
    const cur = o.win.getBounds();
    if (cur.x !== x || cur.y !== y || cur.width !== w || cur.height !== h) o.win.setBounds({ x, y, width: w, height: h });
  }
}

function destroyOverlay() {
  clearInterval(overlayTopTimer);
  overlayTopTimer = null;
  for (const zone of OVERLAY_ZONES) {
    const o = OV[zone];
    if (o && o.win && !o.win.isDestroyed()) o.win.destroy();
    delete OV[zone];
  }
}

function zoneWanted(zone) {
  if (!settings.overlay || !mainWindow || mainWindow.isDestroyed() || !gameContext()) return false;
  if (zone === 'voice') return overlayVoice.members.length > 0 || Date.now() < overlayPreviewUntil;
  return Date.now() < overlayToastUntil;
}

function refreshOverlay() {
  if (!settings.overlay) { destroyOverlay(); return; }
  let anyVisible = false;
  for (const zone of OVERLAY_ZONES) {
    const want = zoneWanted(zone);
    const o = want ? ensureOverlay(zone) : OV[zone];
    if (!o || o.win.isDestroyed()) continue;
    if (want && o.size.has) {
      if (!o.win.isVisible()) {
        placeOverlays();
        o.win.showInactive();
        o.win.setAlwaysOnTop(true, 'screen-saver');
      }
      anyVisible = true;
    } else if (o.win.isVisible()) {
      o.win.hide();
    }
  }
  // Kenarlıksız oyunlar bazen öne geçer; arada bir en üste geri al
  if (anyVisible && !overlayTopTimer) {
    overlayTopTimer = setInterval(() => {
      for (const zone of OVERLAY_ZONES) {
        const o = OV[zone];
        if (o && !o.win.isDestroyed() && o.win.isVisible()) {
          o.win.setAlwaysOnTop(true, 'screen-saver');
          o.win.moveTop();
        }
      }
    }, 2000);
  } else if (!anyVisible && overlayTopTimer) {
    clearInterval(overlayTopTimer);
    overlayTopTimer = null;
  }
}

function overlayToast(n) {
  // Oyunda değilsen bildirimi zaten Windows/Discord gösteriyor
  if (!settings.overlay || !mainWindow || mainWindow.isDestroyed() || !gameContext()) return;
  overlayToastUntil = Date.now() + OVERLAY_TOAST_MS;
  clearTimeout(overlayToastTimer);
  overlayToastTimer = setTimeout(refreshOverlay, OVERLAY_TOAST_MS + 400);
  const o = ensureOverlay('toast');
  if (o.ready) o.win.webContents.send('overlay:toast', n);
  else o.queue.push(n);
  refreshOverlay();
}

function sendVoice(v) {
  const o = OV.voice;
  if (o && o.ready && !o.win.isDestroyed()) o.win.webContents.send('overlay:voice', v);
}

function applyOverlaySettings(toggled) {
  if (!settings.overlay) { destroyOverlay(); return; }
  pushOverlayConfig();
  if (toggled) overlayToast({ title: t('app.name'), body: t('overlay.enabled', { key: 'Ctrl+Alt+O' }), icon: '' });
  refreshOverlay();
}

// Discord sayfasından gelen veri (discord-preload.js köprüsü). Sadece Discord penceresinden kabul edilir.
ipcMain.on('enex:page', (e, p) => {
  if (!mainWindow || e.sender !== mainWindow.webContents || !p || typeof p !== 'object') return;
  if (p.type === 'voice') {
    const members = Array.isArray(p.members) ? p.members.slice(0, 99).map((m) => ({
      id: str(m && m.id, 32),
      name: str(m && m.name, 64),
      avatar: safeIcon(m && m.avatar),
      speaking: Boolean(m && m.speaking),
      muted: Boolean(m && m.muted),
      deafened: Boolean(m && m.deafened),
      self: Boolean(m && m.self)
    })).filter((m) => m.id) : [];
    const wasIn = overlayVoice.members.length > 0;
    overlayVoice = { channel: p.channel ? str(p.channel, 80) : null, members };
    if (wasIn !== members.length > 0) {
      dlog('overlay', members.length ? `ses kanalı: ${overlayVoice.channel} (${members.length} kişi)` : 'ses kanalından çıkıldı');
      if (perfApplied) applyPerf(); // sesli sohbete girip çıkınca öncelikleri yeniden ayarla
    }
    if (Date.now() >= overlayPreviewUntil) sendVoice(overlayVoice);
    refreshOverlay();
  } else if (p.type === 'notify') {
    dlog('overlay', 'bildirim geldi', gameContext() ? '(gösteriliyor)' : '(oyunda değilsin, atlandı)');
    overlayToast({ title: str(p.title, 200), body: str(p.body, 500), icon: safeIcon(p.icon) });
  } else if (p.type === 'diag') {
    const d = {
      webpack: Boolean(p.webpack), dispatcher: Boolean(p.dispatcher), voice: Boolean(p.voice), user: Boolean(p.user),
      instances: Array.isArray(p.instances) ? p.instances.slice(0, 6).map(Number) : [],
      showCurrentGame: p.showCurrentGame == null ? null : Boolean(p.showCurrentGame),
      dispatcherScore: Number(p.dispatcherScore) || 0,
      stores: Array.isArray(p.stores) ? p.stores.map((s) => str(s, 40)).slice(0, 20) : [],
      error: p.error ? str(p.error, 300) : undefined
    };
    const sig = (x) => JSON.stringify(x ? { ...x, instances: undefined } : x);
    if (sig(d) !== sig(bridgeDiag)) dlog('bridge', d);
    if (!d.error) bridgeDiag = d;
    pushStudioActivity();
  } else if (p.type === 'act-check') {
    const clean = (v) => (Array.isArray(v) ? v.slice(0, 8).map((x) => str(x, 80)) : str(v, 20));
    dlog('activity', 'Discord tarafı:', { paylaşımAyarı: p.showCurrentGame, yerel: clean(p.local), profil: clean(p.presence), durum: str(p.status, 20) });
    if (bridgeDiag) { bridgeDiag.showCurrentGame = p.showCurrentGame; pushStudioActivity(); }
  } else if (p.type === 'act') {
    dlog('activity', `Discord'a iletildi: ${str(p.socketId, 40)} → ${p.name == null ? '(temizlendi)' : str(p.name, 80)}`);
  } else if (p.type === 'bridge-ready') {
    dlog('bridge', `hazır; ${liveActivities.size} etkinlik yeniden gönderiliyor`);
    for (const m of liveActivities.values()) mainWindow.webContents.send('enex:activity', m);
    mainWindow.webContents.send('enex:gaming', Boolean(settings.perfMode && inGame));
  }
});

// Stüdyo'daki "Önizle" butonu: örnek bir bildirim ve ses listesi gösterir
ipcMain.handle('studio:overlay-test', () => {
  if (!settings.overlay) return false;
  overlayPreviewUntil = Date.now() + OVERLAY_TOAST_MS;
  setTimeout(() => { sendVoice(overlayVoice); refreshOverlay(); }, OVERLAY_TOAST_MS + 150);
  overlayToast({ title: t('overlay.testTitle'), body: t('overlay.testBody'), icon: 'https://cdn.discordapp.com/embed/avatars/2.png' });
  if (!overlayVoice.members.length) {
    const o = ensureOverlay('voice');
    const demo = {
      channel: t('overlay.demoChannel'),
      members: [
        { id: 'd1', name: 'Enes', avatar: 'https://cdn.discordapp.com/embed/avatars/0.png', speaking: true, self: true },
        { id: 'd2', name: 'Kaan', avatar: 'https://cdn.discordapp.com/embed/avatars/1.png', muted: true },
        { id: 'd3', name: 'Mert', avatar: 'https://cdn.discordapp.com/embed/avatars/3.png' }
      ]
    };
    if (o.ready) o.win.webContents.send('overlay:voice', demo);
    else o.win.webContents.once('did-finish-load', () => { if (!o.win.isDestroyed()) o.win.webContents.send('overlay:voice', demo); });
  }
  refreshOverlay();
  return true;
});

function setupOverlay() {
  const ok = globalShortcut.register(OVERLAY_HOTKEY, () => updateSettings({ overlay: !settings.overlay }));
  if (!ok) dlog('overlay', 'kısayol kaydedilemedi (başka bir uygulama kullanıyor olabilir):', OVERLAY_HOTKEY);
  screen.on('display-metrics-changed', placeOverlays);
  screen.on('display-added', placeOverlays);
  screen.on('display-removed', placeOverlays);
}
app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  destroyOverlay();
  if (perfApplied) applyPerf(true);
});

// ---------- Menü (Alt ile görünür, kısayollar her zaman çalışır) ----------
function buildMenu() {
  const template = [
    {
      label: t('menu.app'),
      submenu: [
        { label: t('menu.studio'), accelerator: 'CmdOrCtrl+Shift+T', click: openStudio },
        {
          label: t('menu.overlay'), type: 'checkbox', checked: settings.overlay,
          accelerator: OVERLAY_HOTKEY, registerAccelerator: false, // kısayol genel (globalShortcut) olarak kayıtlı
          click: () => updateSettings({ overlay: !settings.overlay })
        },
        { type: 'separator' },
        { role: 'reload', label: t('menu.reload') },
        { role: 'toggleDevTools', label: t('menu.devtools') },
        { type: 'separator' },
        { role: 'quit', label: t('menu.quit') }
      ]
    },
    {
      label: t('menu.theme'),
      submenu: [
        ...themeList().map((th, i) => ({
          label: th.name,
          type: 'radio',
          checked: settings.theme === th.id,
          accelerator: `CmdOrCtrl+Alt+${i + 1}`,
          click: () => updateSettings({ theme: th.id })
        })),
        { type: 'separator' },
        { label: t('menu.fx'), type: 'checkbox', checked: settings.fx, accelerator: 'CmdOrCtrl+Shift+E', click: () => updateSettings({ fx: !settings.fx }) },
        { label: t('menu.cards'), type: 'checkbox', checked: settings.cards, accelerator: 'CmdOrCtrl+Shift+L', click: () => updateSettings({ cards: !settings.cards }) },
        { label: t('menu.clean'), type: 'checkbox', checked: settings.clean, click: () => updateSettings({ clean: !settings.clean }) },
        { type: 'separator' },
        {
          label: t('menu.language'),
          submenu: [
            { label: t('studio.lang.auto'), type: 'radio', checked: settings.lang === 'auto', click: () => updateSettings({ lang: 'auto' }) },
            { label: 'Türkçe', type: 'radio', checked: settings.lang === 'tr', click: () => updateSettings({ lang: 'tr' }) },
            { label: 'English', type: 'radio', checked: settings.lang === 'en', click: () => updateSettings({ lang: 'en' }) }
          ]
        }
      ]
    },
    {
      label: t('menu.edit'),
      submenu: [
        { role: 'undo', label: t('menu.undo') },
        { role: 'redo', label: t('menu.redo') },
        { type: 'separator' },
        { role: 'cut', label: t('menu.cut') },
        { role: 'copy', label: t('menu.copy') },
        { role: 'paste', label: t('menu.paste') },
        { role: 'selectAll', label: t('menu.selectAll') }
      ]
    },
    {
      label: t('menu.view'),
      submenu: [
        { role: 'resetZoom', label: t('menu.resetZoom') },
        { role: 'zoomIn', label: t('menu.zoomIn') },
        { role: 'zoomOut', label: t('menu.zoomOut') },
        { type: 'separator' },
        { role: 'togglefullscreen', label: t('menu.fullscreen') }
      ]
    }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ---------- Başlat ----------
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(async () => {
    loadSettings();
    setupSession();
    buildMenu();
    setupOverlay();
    dlog('main', `başladı · ayarlar: overlay=${settings.overlay} oyun=${settings.activityGames} müzik=${settings.activityMusic} rpc=${settings.activityRpc}`);
    // Önce "bağlanıyor" ekranı, bağlantı hazır olunca Discord
    createWindow(path.join(__dirname, 'loading.html'));
    mainWindow.webContents.once('did-finish-load', () => {
      if (mainWindow) mainWindow.webContents.send('enex:loading', t('loading.connecting'));
    });
    await applyNetwork();
    if (mainWindow) mainWindow.loadURL(DISCORD_URL);
    setupActivity(); // oyun listesi Enex'in bağlantısıyla (engel aşma dahil) indirilir
  });

  app.on('window-all-closed', () => app.quit());
}
