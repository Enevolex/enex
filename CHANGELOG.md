# Değişiklikler · Changelog

**Türkçe** · [English](#english)

## [1.1.0] · 10 Ekim 2026: Oyuncu güncellemesi 🎮

Masaüstü Discord'da olup web sürümünde olmayan oyuncu özelliklerini Enex'e getirdik. Üstüne,
neyin paylaşıldığını senin seçtiğin bir gizlilik filtresi ve oyundayken FPS'ini koruyan bir
oyun modu ekledik.

### ✨ Yeni

- **Oyun içi arayüz (overlay)**
  - Oyundayken ses kanalındakiler köşede görünür, konuşan kişi yeşil parlar.
  - Susturulmuş ya da sağırlaştırılmış kişilerin yanında simge çıkar.
  - Gelen mesajlar küçük bildirimler olarak düşer.
  - Sadece bir oyun öndeyken çıkar ve oyunun açık olduğu monitöre yerleşir.
  - Tıklamalar oyuna geçer, odağı asla çalmaz.
  - <kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>O</kbd> ile oyunun içinden aç/kapa.
  - Tema Stüdyosu'ndan köşe seçilebilir ve "Önizle" ile denenebilir.
- **"Oynuyor" durumu**
  - Açtığın oyun, masaüstü Discord'daki gibi profilinde görünür.
  - Discord'un tanıdığı ~10.500 oyun otomatik algılanır: CS2, VALORANT, LoL, Fortnite, GTA V, Minecraft, Roblox…
- **"Dinliyor" durumu**
  - Spotify, Apple Music, YouTube Music, Deezer, TIDAL gibi uygulamalarda ya da tarayıcıda çalan müzik profilinde görünür.
  - Discord'un kendi Spotify bağlantısı zaten görünüyorsa ikinci kez eklenmez.
- **Rich Presence desteği:** Kendi durumunu Discord'a gönderen oyunlar ve uygulamalar (harita, karakter, parça adı…) Enex'e bağlanabilir.
- **Ayrı pencerede yayın:** Birinin ekran paylaşımını izlerken "Ayrı pencerede oynat" artık tarayıcıda değil, Enex'in kendi penceresinde açılır.
- **Tema Stüdyosu'nda yeni bölümler**
  - "Etkinlik paylaşımı" ve "Performans" ayarları.
  - O an ne paylaşıldığını gösteren "Şu an" listesi.
  - Oyun algılama ve Discord bağlantısının durumu.
  - Discord'da etkinlik paylaşımı kapalıysa uyarı.
- **Tanılama günlüğü:** Bir şey çalışmazsa sebebi `enex-debug.log` dosyasında yazar.
  - Stüdyo'dan tek tıkla açılır.
  - Hesap bilgisi yazmaz; paylaşılmayan medyanın adını da yazmaz.

### 🛡️ Gizlilik

- **Akıllı paylaşım (varsayılan):** Sadece müzik paylaşılır.
  - Tarayıcıda çalan bir şey ancak müzik olduğu belliyse paylaşılır: albüm bilgisi, YouTube "- Topic" kanalı ya da başlıkta "Official Music Video", "ft.", "prod.", "Lyrics", "Remix" gibi işaretler.
  - Vlog, film ve diğer videolar paylaşılmaz.
- **Yetişkin içerik filtresi:** Yetişkin site adları ve terimleri hangi kaynaktan gelirse gelsin asla paylaşılmaz.
  - Spotify gibi müzik uygulamalarında sadece kesin terimler aranır, gerçek şarkılar yanlışlıkla engellenmez.
- **Kendi yasak kelimelerin:** "Asla paylaşma" kutusuna yazdığın kelimeleri içeren hiçbir şey paylaşılmaz.
- **Üç mod:** Sadece müzik uygulamaları · Akıllı · Her medya.

### ⚡ Performans: Oyun modu

- **Küçük overlay:** Overlay tüm ekranı kaplayan tek bir pencere yerine, sadece içeriği kadar büyük iki küçük pencereden oluşur. Ekranı kaplayan saydam pencere, Windows'un oyunu en hızlı yoldan göstermesini engelleyip FPS düşürür; küçük pencerelerde bu etki çok daha az.
- **Efektler durur:** Oyun öndeyken Enex'in bütün animasyonları, geçişleri, bulanıklık efektleri, duvar kağıdı ve yaprak animasyonu durur. Oyundan çıkınca geri gelir.
- **Öncelik düşer:** Enex'in işlemleri düşük önceliğe iner, işlemci önce oyuna çalışır.
  - Ses servisine dokunulmaz.
  - Sesli sohbetteyken Discord sayfası normal öncelikte kalır, ses kesilmez.
- **Arka plan seyrekleşir:** Arka plandaki kontroller oyundayken seyrekleşir. Konuşma göstergesi yine anında gelir.
- **Ayar:** Tema Stüdyosu → Performans → "Oyun modu" (varsayılan açık).

### 🔧 İyileştirmeler ve düzeltmeler

- **Gecikme düzeldi:** Oyuna geçince Chromium'un Enex'i yavaşlatması kapatıldı. Overlay'deki bilgiler artık gecikmiyor.
- **Daha sağlam bağlantı:** Discord'un iç yapısına bağlanma yöntemi baştan yazıldı.
  - Discord'un yüklediği bütün modül sistemleri yakalanır ve asıl olan seçilir.
  - Etkinlikler, Discord'un veri depolarının gerçekten kullandığı olay dağıtıcısına gönderilir.
- **Bağımsız parçalar:** Etkinlik paylaşımı ve ses listesi ayrıldı; biri çalışmazsa öteki etkilenmez.
- **Yeniden bağlanma:** Bağlantı koparsa (uyku, internet kesintisi) etkinlikler otomatik yeniden gönderilir.
- **Titreme yok:** Oyun bir anlığına odağı kaybedince (Steam arayüzü, yükleme ekranı) overlay titreyip kaybolmaz.

### 📦 Teknik

- **Yeni dosyalar**
  - `activity.js`: oyun ve müzik algılama.
  - `rpc.js`: yerel Rich Presence sunucusu.
  - `native/enex-helper.cpp` → `bin/enex-helper.exe`: çalışan programlar ve ön plandaki pencere; sadece okur, hiçbir şeye enjekte etmez.
- **İndirilen liste:** Tanınan oyunlar listesi Discord'dan indirilir, 24 saat önbellekte tutulur. Engel aşma açıksa o da bu bağlantıyı kullanır.
- **Ayarlar:** Ayar dosyası sürüm 6'ya taşındı; eski ayarlar otomatik güncellenir.

---

## [1.0.0]

- İlk sürüm: 8 tema, Tema Stüdyosu, canlı duvar kağıdı, cam pencere, dahili engel aşma (ByeDPI + şifreli DNS), ekran paylaşımında uygulama sesi.

---

<a id="english"></a>

# English

## [1.1.0] · October 10, 2026: The gamer update 🎮

We brought the gaming features desktop Discord has (and the web version doesn't) to Enex, then
added a privacy filter where you choose what's shared and a game mode that protects your FPS.

### ✨ New

- **In-game overlay**
  - See who's in your voice channel while you play; the speaker glows green.
  - Muted or deafened people get an icon.
  - New messages pop up as small notifications.
  - Only appears while a game is in front, on the monitor the game is on.
  - Clicks pass through to the game; it never steals focus.
  - Toggle it from inside a game with <kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>O</kbd>.
  - Pick the corner in Theme Studio and try it with "Preview".
- **"Playing" status**
  - The game you open shows on your profile like desktop Discord.
  - ~10,500 games recognized by Discord are detected automatically: CS2, VALORANT, LoL, Fortnite, GTA V, Minecraft, Roblox…
- **"Listening to" status**
  - Music from Spotify, Apple Music, YouTube Music, Deezer, TIDAL or your browser shows on your profile.
  - If Discord's own Spotify connection already shows it, it isn't added twice.
- **Rich Presence support:** games and apps that report their own status (map, character, track…) can connect to Enex.
- **Pop-out streams:** "Pop out" on someone's stream now opens in Enex's own window instead of your browser.
- **New Theme Studio sections**
  - "Activity sharing" and "Performance" settings.
  - A "Right now" list showing what's being shared.
  - Status of game detection and of the Discord connection.
  - A warning if activity sharing is off in Discord.
- **Diagnostic log:** if something doesn't work, the reason is written to `enex-debug.log`.
  - One click to open it from the Studio.
  - It never writes account info or the names of media that weren't shared.

### 🛡️ Privacy

- **Smart sharing (default):** only music is shared.
  - Something playing in a browser is shared only if it's clearly music: album info, a YouTube "- Topic" channel, or title markers like "Official Music Video", "ft.", "prod.", "Lyrics", "Remix".
  - Vlogs, movies and other videos are not shared.
- **Adult content filter:** adult site names and terms are never shared, whatever the source.
  - Music apps like Spotify are only checked for unambiguous terms, so real songs aren't blocked by mistake.
- **Your own blocked words:** anything containing words from the "Never share" box is never shared.
- **Three modes:** Music apps only · Smart · Any media.

### ⚡ Performance: Game mode

- **Tiny overlay:** the overlay is now two tiny windows only as big as their content, instead of one fullscreen window. A fullscreen transparent window stops Windows from presenting the game the fastest way and costs FPS; tiny windows keep that cost much lower.
- **Effects stop:** while a game is in front, all of Enex's animations, transitions, blur effects, wallpaper and petals stop. They come back when you leave the game.
- **Lower priority:** Enex's processes drop to low CPU priority, so the CPU works for the game first.
  - The audio service is never touched.
  - While you're in a voice call, the Discord page keeps normal priority so your voice doesn't cut out.
- **Less background work:** background checks run less often while gaming. The speaking indicator still updates instantly.
- **Setting:** Theme Studio → Performance → "Game mode" (on by default).

### 🔧 Improvements & fixes

- **No more lag:** Chromium no longer slows Enex down when you switch to a game, so overlay info doesn't lag.
- **Sturdier connection:** the way Enex connects to Discord's internals was rewritten.
  - It captures every module system Discord loads and picks the real one.
  - Activities go to the event dispatcher that Discord's data stores actually use.
- **Independent parts:** activity sharing and the voice list are now separate; one failing doesn't break the other.
- **Reconnects:** after a reconnect (sleep, network drop), activities are re-sent automatically.
- **No flicker:** the overlay no longer flickers away when a game briefly loses focus (Steam overlay, loading screens).

### 📦 Technical

- **New files**
  - `activity.js`: game and music detection.
  - `rpc.js`: local Rich Presence server.
  - `native/enex-helper.cpp` → `bin/enex-helper.exe`: running programs and the foreground window; read-only, injects into nothing.
- **Downloaded list:** the recognized games list is downloaded from Discord and cached for 24 hours. If the unblocker is on, the download goes through it too.
- **Settings:** the settings file moved to version 6; old settings are migrated automatically.

---

## [1.0.0]

- First release: 8 themes, Theme Studio, live wallpapers, glass window, built-in unblocker (ByeDPI + encrypted DNS), app audio in screen sharing.
