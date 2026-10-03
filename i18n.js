// Enex dil dosyası — Türkçe ve İngilizce.
// Yeni bir dil eklemek için STRINGS içine aynı anahtarlarla bir nesne daha ekleyin.

const STRINGS = {
  tr: {
    'app.name': 'Enex',
    'app.studio': 'Enex Tema Stüdyosu',

    // Menü
    'menu.app': 'Enex',
    'menu.studio': 'Tema Stüdyosu',
    'menu.reload': 'Yenile',
    'menu.devtools': 'Geliştirici araçları',
    'menu.quit': 'Çıkış',
    'menu.theme': 'Tema',
    'menu.fx': 'Efektler',
    'menu.cards': 'Kart düzeni',
    'menu.clean': 'Sade mod',
    'menu.language': 'Dil',
    'menu.edit': 'Düzen',
    'menu.undo': 'Geri al',
    'menu.redo': 'Yinele',
    'menu.cut': 'Kes',
    'menu.copy': 'Kopyala',
    'menu.paste': 'Yapıştır',
    'menu.selectAll': 'Tümünü seç',
    'menu.view': 'Görünüm',
    'menu.resetZoom': 'Yakınlaştırmayı sıfırla',
    'menu.zoomIn': 'Yakınlaştır',
    'menu.zoomOut': 'Uzaklaştır',
    'menu.fullscreen': 'Tam ekran',

    // Pencere butonları
    'win.minimize': 'Küçült',
    'win.maximize': 'Büyüt',
    'win.restore': 'Önceki boyut',
    'win.close': 'Kapat',

    // Açılış ekranı
    'loading.connecting': 'Bağlanıyor…',
    'loading.search': 'Bağlantı yöntemi deneniyor ({i}/{n}): {name}',

    // Temalar
    'theme.aurora.name': 'Aurora',
    'theme.aurora.desc': 'Derin uzayda mor, pembe ve camgöbeği kuzey ışıkları.',
    'theme.anime.name': 'Anime',
    'theme.anime.desc': 'Discord saydam, arkada hareketli duvar kağıdı ve düşen kiraz yaprakları.',
    'theme.glass.name': 'Cam',
    'theme.glass.desc': 'Pencere saydam, arkadaki masaüstün görünür.',
    'theme.neon-tokyo.name': 'Neon Tokyo',
    'theme.neon-tokyo.desc': 'Siberpunk. Keskin köşeler, sarı neon, CRT tarama çizgileri.',
    'theme.synthwave.name': 'Synthwave',
    'theme.synthwave.desc': "80'ler gecesi. Turuncu güneş ve ufka akan neon ızgara.",
    'theme.abyss.name': 'Derin Okyanus',
    'theme.abyss.desc': 'Su altı ışık huzmeleri ve yükselen ışıltılar.',
    'theme.obsidian.name': 'Obsidyen',
    'theme.obsidian.desc': 'Siyah ve şampanya altını. Sakin, lüks ve en hafif tema.',
    'theme.matrix.name': 'Matrix',
    'theme.matrix.desc': 'Fosforlu yeşil terminal. Her şey daktilo yazısıyla.',

    // Stüdyo
    'studio.title': 'Tema Stüdyosu',
    'studio.lead': 'Bir temaya tıkla, Discord penceresinde anında değişir.',
    'studio.active': 'AKTİF',
    'studio.look': 'Görünüm',
    'studio.fx': 'Efektler',
    'studio.fx.hint': 'Hareketli arka plan, cam bulanıklığı ve akıcı animasyonlar. Kasma olursa kapat.',
    'studio.cards': 'Kart düzeni',
    'studio.cards.hint': 'Kanal listesi ve sohbet ayrı, köşeleri yuvarlak kartlara dönüşür.',
    'studio.clean': 'Sade mod',
    'studio.clean.hint': 'Nitro, mağaza, hediye ve çıkartma butonlarını gizler.',
    'studio.language': 'Dil',
    'studio.lang.auto': 'Otomatik',
    'studio.glass': 'Cam ayarları',
    'studio.glass.acrylic': 'Buzlu cam',
    'studio.glass.clear': 'Tam saydam',
    'studio.glass.clearHint': 'Pencere tamamen saydam olur. Taşımak için üst çubuğu sürükle. Bu modda pencere kenardan boyutlandırılamaz; geçerken Discord bir kez yeniden yüklenir.',
    'studio.glass.acrylicHint': 'Masaüstün bulanık görünür. Windows 11 gerekir; Windows 10’da arka plan siyah kalabilir.',
    'studio.panelAlpha': 'Panel koyuluğu',
    'studio.anime': 'Anime ayarları',
    'studio.wallpaper': 'Duvar kağıdı',
    'studio.wall.bundledAnime': 'Hazır anime duvar kağıdı',
    'studio.wall.sakura': 'Sakura Gecesi (hazır)',
    'studio.wall.pick': 'Video ya da resim seç',
    'studio.wall.reset': 'Hazır olana dön',
    'studio.wall.hint': 'MP4, WebM, GIF ve resimler olur. 4K video ekran kartını yorabilir; kasarsa 1080p bir sürüm seç ya da efektleri kapat.',
    'studio.wallDim': 'Duvar kağıdı karartma',
    'studio.accent': 'Vurgu rengi',
    'studio.accent.reset': 'Temanın rengine dön',
    'studio.accent.custom': 'Özel renk kullanılıyor. Tema değiştirsen de bu renk kalır.',
    'studio.accent.theme': '{theme} temasının kendi rengi kullanılıyor.',
    'studio.network': 'Bağlantı',
    'studio.dpi': 'Engel aşma',
    'studio.dpi.hint': 'Discord’a erişim engelini sadece Enex için aşar. Arka planda, görünmeden çalışır.',
    'studio.dpi.auto': 'Çalışan yöntemi kendisi bulur ve hatırlar. Discord açılmazsa “Yeniden bul”a bas.',
    'studio.dpi.test': 'Bağlantıyı test et',
    'studio.dpi.research': 'Yeniden bul',
    'studio.dpi.testing': 'Deneniyor…',
    'studio.dpi.restarting': 'Yeniden başlatılıyor…',
    'studio.shortcuts': 'Kısayollar',
    'studio.key.studio': 'Bu pencere',
    'studio.key.themes': 'Tema değiştir',
    'studio.key.fx': 'Efektler',
    'studio.key.cards': 'Kart düzeni',

    // Duvar kağıdı seçme penceresi
    'dialog.wallpaper': 'Duvar kağıdı seç',
    'dialog.media': 'Video ve resimler',
    'dialog.videos': 'Videolar',
    'dialog.images': 'Resimler',

    // Ekran paylaşımı
    'picker.title': 'Ne paylaşmak istiyorsun?',
    'picker.sub': 'Bir ekran ya da pencere seç. Esc ile vazgeçebilirsin.',
    'picker.screens': 'Ekranlar',
    'picker.windows': 'Pencereler',
    'picker.empty': 'Burada gösterilecek bir şey yok.',
    'picker.cancel': 'Vazgeç',
    'picker.share': 'Paylaş',

    // Engel aşma durumları
    'dpi.off': 'Kapalı',
    'dpi.on': 'Açık · {method}',
    'dpi.searching': 'Yöntem aranıyor… {i}/{n}',
    'dpi.failed': 'Hiçbir yöntem Discord’a ulaşamadı.',
    'dpi.missing': 'ciadpi.exe bulunamadı. Antivirüs silmiş olabilir.',
    'dpi.windowsOnly': 'Engel aşma sadece Windows’ta çalışıyor.',
    'dpi.stopped': 'Engel aşma durdu, yeniden başlatılıyor…',
    'dpi.reached': 'Discord’a ulaşıldı · {ms} ms',
    'dpi.unreachable': 'Discord’a ulaşılamadı. “Yeniden bul”a bas. ({err})',
    'dpi.m.dns': 'Sadece şifreli DNS',
    'dpi.m.sd': 'Bölme + sıra karıştırma',
    'dpi.m.tlsrec': 'TLS kaydı bölme',
    'dpi.m.fake5': 'Sahte paket (TTL 5)',
    'dpi.m.fake3': 'Sahte paket (TTL 3)',
    'dpi.m.fake8': 'Sahte paket (TTL 8)',
    'dpi.m.oob': 'OOB',
    'dpi.m.disoob': 'Ters OOB',
    'dpi.m.sni': 'SNI ortasından bölme',
    'dpi.m.mix': 'Karma'
  },

  en: {
    'app.name': 'Enex',
    'app.studio': 'Enex Theme Studio',

    'menu.app': 'Enex',
    'menu.studio': 'Theme Studio',
    'menu.reload': 'Reload',
    'menu.devtools': 'Developer tools',
    'menu.quit': 'Quit',
    'menu.theme': 'Theme',
    'menu.fx': 'Effects',
    'menu.cards': 'Card layout',
    'menu.clean': 'Clean mode',
    'menu.language': 'Language',
    'menu.edit': 'Edit',
    'menu.undo': 'Undo',
    'menu.redo': 'Redo',
    'menu.cut': 'Cut',
    'menu.copy': 'Copy',
    'menu.paste': 'Paste',
    'menu.selectAll': 'Select all',
    'menu.view': 'View',
    'menu.resetZoom': 'Reset zoom',
    'menu.zoomIn': 'Zoom in',
    'menu.zoomOut': 'Zoom out',
    'menu.fullscreen': 'Full screen',

    'win.minimize': 'Minimize',
    'win.maximize': 'Maximize',
    'win.restore': 'Restore',
    'win.close': 'Close',

    'loading.connecting': 'Connecting…',
    'loading.search': 'Trying connection method ({i}/{n}): {name}',

    'theme.aurora.name': 'Aurora',
    'theme.aurora.desc': 'Violet, pink and cyan northern lights in deep space.',
    'theme.anime.name': 'Anime',
    'theme.anime.desc': 'See-through Discord over a live wallpaper with falling cherry petals.',
    'theme.glass.name': 'Glass',
    'theme.glass.desc': 'A see-through window: your desktop shows right through.',
    'theme.neon-tokyo.name': 'Neon Tokyo',
    'theme.neon-tokyo.desc': 'Cyberpunk. Sharp corners, yellow neon, CRT scanlines.',
    'theme.synthwave.name': 'Synthwave',
    'theme.synthwave.desc': 'An 80s night. Orange sun and a neon grid rolling to the horizon.',
    'theme.abyss.name': 'Abyss',
    'theme.abyss.desc': 'Underwater light rays and rising sparkles.',
    'theme.obsidian.name': 'Obsidian',
    'theme.obsidian.desc': 'Black and champagne gold. Calm, luxurious and the lightest theme.',
    'theme.matrix.name': 'Matrix',
    'theme.matrix.desc': 'Phosphor-green terminal. Everything in monospace.',

    'studio.title': 'Theme Studio',
    'studio.lead': 'Click a theme and the Discord window changes instantly.',
    'studio.active': 'ACTIVE',
    'studio.look': 'Appearance',
    'studio.fx': 'Effects',
    'studio.fx.hint': 'Animated backgrounds, glass blur and smooth motion. Turn off if things stutter.',
    'studio.cards': 'Card layout',
    'studio.cards.hint': 'Channel list and chat become separate cards with rounded corners.',
    'studio.clean': 'Clean mode',
    'studio.clean.hint': 'Hides Nitro, shop, gift and sticker buttons.',
    'studio.language': 'Language',
    'studio.lang.auto': 'Automatic',
    'studio.glass': 'Glass settings',
    'studio.glass.acrylic': 'Frosted',
    'studio.glass.clear': 'Fully clear',
    'studio.glass.clearHint': 'The window becomes fully transparent. Drag the top bar to move it. Edge resizing is not available in this mode; Discord reloads once when switching.',
    'studio.glass.acrylicHint': 'Your desktop shows through blurred. Needs Windows 11; on Windows 10 the background may stay black.',
    'studio.panelAlpha': 'Panel darkness',
    'studio.anime': 'Anime settings',
    'studio.wallpaper': 'Wallpaper',
    'studio.wall.bundledAnime': 'Bundled anime wallpaper',
    'studio.wall.sakura': 'Sakura Night (bundled)',
    'studio.wall.pick': 'Choose a video or image',
    'studio.wall.reset': 'Back to bundled',
    'studio.wall.hint': 'MP4, WebM, GIF and images work. 4K video can tax your GPU; if it stutters pick a 1080p version or turn effects off.',
    'studio.wallDim': 'Wallpaper dimming',
    'studio.accent': 'Accent color',
    'studio.accent.reset': 'Use theme color',
    'studio.accent.custom': 'Using a custom color. It stays when you switch themes.',
    'studio.accent.theme': 'Using the {theme} theme’s own color.',
    'studio.network': 'Connection',
    'studio.dpi': 'Unblock Discord',
    'studio.dpi.hint': 'Gets around Discord blocks for Enex only. Runs silently in the background.',
    'studio.dpi.auto': 'Finds a working method by itself and remembers it. If Discord won’t load, press “Search again”.',
    'studio.dpi.test': 'Test connection',
    'studio.dpi.research': 'Search again',
    'studio.dpi.testing': 'Testing…',
    'studio.dpi.restarting': 'Restarting…',
    'studio.shortcuts': 'Shortcuts',
    'studio.key.studio': 'This window',
    'studio.key.themes': 'Switch theme',
    'studio.key.fx': 'Effects',
    'studio.key.cards': 'Card layout',

    'dialog.wallpaper': 'Choose wallpaper',
    'dialog.media': 'Videos and images',
    'dialog.videos': 'Videos',
    'dialog.images': 'Images',

    'picker.title': 'What do you want to share?',
    'picker.sub': 'Pick a screen or a window. Press Esc to cancel.',
    'picker.screens': 'Screens',
    'picker.windows': 'Windows',
    'picker.empty': 'Nothing to show here.',
    'picker.cancel': 'Cancel',
    'picker.share': 'Share',

    'dpi.off': 'Off',
    'dpi.on': 'On · {method}',
    'dpi.searching': 'Searching… {i}/{n}',
    'dpi.failed': 'No method could reach Discord.',
    'dpi.missing': 'ciadpi.exe is missing. Your antivirus may have removed it.',
    'dpi.windowsOnly': 'Unblocking only works on Windows.',
    'dpi.stopped': 'Unblocker stopped, restarting…',
    'dpi.reached': 'Discord reached · {ms} ms',
    'dpi.unreachable': 'Couldn’t reach Discord. Press “Search again”. ({err})',
    'dpi.m.dns': 'Encrypted DNS only',
    'dpi.m.sd': 'Split + disorder',
    'dpi.m.tlsrec': 'TLS record split',
    'dpi.m.fake5': 'Fake packet (TTL 5)',
    'dpi.m.fake3': 'Fake packet (TTL 3)',
    'dpi.m.fake8': 'Fake packet (TTL 8)',
    'dpi.m.oob': 'OOB',
    'dpi.m.disoob': 'Reverse OOB',
    'dpi.m.sni': 'Mid-SNI split',
    'dpi.m.mix': 'Mixed'
  }
};

let current = 'tr';

function resolveLang(pref, systemLocale) {
  if (pref === 'tr' || pref === 'en') return pref;
  return String(systemLocale || '').toLowerCase().startsWith('tr') ? 'tr' : 'en';
}

function setLang(lang) {
  current = STRINGS[lang] ? lang : 'en';
}

function getLang() {
  return current;
}

function t(key, vars) {
  const s = (STRINGS[current] && STRINGS[current][key]) ?? STRINGS.en[key] ?? key;
  if (!vars) return s;
  return s.replace(/\{(\w+)\}/g, (_, k) => (vars[k] ?? `{${k}}`));
}

function dict() {
  return { ...STRINGS.en, ...STRINGS[current] };
}

module.exports = { t, setLang, getLang, resolveLang, dict, LANGS: Object.keys(STRINGS) };
