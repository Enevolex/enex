// Enex — Discord'u kendi temanla açan hafif bir masaüstü uygulaması.
// Enex — a themed desktop shell for Discord.
//
// Giriş, mesaj, ses ve ekran paylaşımı Discord'un kendi web uygulamasıyla çalışır;
// Enex hesap bilgisi (token) görmez ve saklamaz.

const {
  app, BrowserWindow, Menu, session, shell, desktopCapturer, ipcMain,
  protocol, net, dialog, screen
} = require('electron');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { spawn } = require('child_process');
const nodeNet = require('net');
const i18n = require('./i18n');
const { t } = i18n;

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

// Kullanıcı verileri %APPDATA%\Enex klasöründe tutulur
app.setPath('userData', path.join(app.getPath('appData'), 'Enex'));

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
  version: 4
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
    settings.version = 4;
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
  }
  saveSettings();

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
  dpiSearching: Boolean(dpiSearching)
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
      spellcheck: true
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

  win.webContents.on('dom-ready', () => {
    cssKeys = [];
    applyTheme();
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http')) shell.openExternal(url);
    return { action: 'deny' };
  });
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
    const finish = (id) => {
      if (done) return;
      done = true;
      ipcMain.removeHandler('picker:get-sources');
      ipcMain.removeAllListeners('picker:choose');
      resolve(sources.find((s) => s.id === id) || null);
      if (!picker.isDestroyed()) picker.close();
    };

    ipcMain.handle('picker:get-sources', () => ({
      strings: i18n.dict(),
      sources: sources.map((s) => ({
        id: s.id,
        name: s.name,
        isScreen: s.id.startsWith('screen:'),
        thumbnail: s.thumbnail.toDataURL()
      }))
    }));
    ipcMain.on('picker:choose', (_e, id) => finish(id));
    picker.on('closed', () => finish(null));

    picker.loadFile(path.join(__dirname, 'picker.html'));
  });
}

function setupSession() {
  const ses = session.defaultSession;

  ses.setUserAgent(app.userAgentFallback.replace(/\s(Electron|enex)\/\S+/gi, ''));
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
      const chosen = await pickScreenSource(sources);
      if (!chosen) return callback({});
      callback(process.platform === 'win32'
        ? { video: chosen, audio: 'loopback' }
        : { video: chosen });
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

// ---------- Menü (Alt ile görünür, kısayollar her zaman çalışır) ----------
function buildMenu() {
  const template = [
    {
      label: t('menu.app'),
      submenu: [
        { label: t('menu.studio'), accelerator: 'CmdOrCtrl+Shift+T', click: openStudio },
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
    // Önce "bağlanıyor" ekranı, bağlantı hazır olunca Discord
    createWindow(path.join(__dirname, 'loading.html'));
    mainWindow.webContents.once('did-finish-load', () => {
      if (mainWindow) mainWindow.webContents.send('enex:loading', t('loading.connecting'));
    });
    await applyNetwork();
    if (mainWindow) mainWindow.loadURL(DISCORD_URL);
  });

  app.on('window-all-closed', () => app.quit());
}
