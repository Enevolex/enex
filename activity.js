// Enex — etkinlik (oyun ve müzik) algılama.
//
// - Oyunlar: Discord'un "tanınan oyunlar" listesi (applications/detectable) ile çalışan
//   programlar karşılaştırılır (masaüstü Discord ve arRPC ile aynı yöntem).
//   Program listesi ve ön plandaki pencere bilgisi bin/enex-helper.exe'den gelir.
// - Müzik: Windows'un medya oturumu (Spotify, Apple Music, YouTube Music, tarayıcı…)
//   kısa bir PowerShell betiğiyle okunur.
//
// Bu modül sadece algılar ve olay yayar; Discord'a gönderme işi main.js + discord-preload.js'te.

const { EventEmitter } = require('events');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

// Önce Discord'un kendisi, olmazsa arRPC'nin GitHub'daki kopyası
const DETECTABLE_URLS = [
  'https://discord.com/api/v9/applications/detectable',
  'https://raw.githubusercontent.com/OpenAsar/arrpc/main/src/process/detectable.json'
];
const DB_MAX_AGE = 24 * 60 * 60 * 1000;

// Tam ekranda olsa bile "oyun" sayılmayacak programlar
const NOT_GAMES = new Set([
  'explorer.exe', 'searchhost.exe', 'shellexperiencehost.exe', 'startmenuexperiencehost.exe',
  'lockapp.exe', 'applicationframehost.exe', 'textinputhost.exe',
  'chrome.exe', 'msedge.exe', 'firefox.exe', 'opera.exe', 'opera_gx.exe', 'brave.exe', 'vivaldi.exe', 'arc.exe', 'zen.exe',
  'vlc.exe', 'mpc-hc.exe', 'mpc-hc64.exe', 'mpc-be64.exe', 'potplayermini.exe', 'potplayermini64.exe',
  'wmplayer.exe', 'video.ui.exe', 'microsoft.media.player.exe', 'mpv.exe',
  'discord.exe', 'discordptb.exe', 'discordcanary.exe', 'enex.exe', 'electron.exe',
  'powerpnt.exe', 'obs64.exe', 'snippingtool.exe', 'screenclippinghost.exe'
]);
const DESKTOP_CLASSES = new Set(['Progman', 'WorkerW', 'Shell_TrayWnd', 'Shell_SecondaryTrayWnd', '#32769']);

// Windows medya oturumu kimliği -> görünen ad
const PLAYERS = [
  [/spotify/i, 'Spotify', 'music'],
  [/applemusic|apple music|AppleInc\.AppleMusic/i, 'Apple Music', 'music'],
  [/itunes/i, 'iTunes', 'music'],
  [/deezer/i, 'Deezer', 'music'],
  [/tidal/i, 'TIDAL', 'music'],
  [/youtube.?music|th-ch\.youtube-music/i, 'YouTube Music', 'music'],
  [/amazon.?music/i, 'Amazon Music', 'music'],
  [/soundcloud/i, 'SoundCloud', 'music'],
  [/ZuneMusic|Microsoft\.Media\.Player/i, 'Media Player', 'music'],
  [/foobar2000/i, 'foobar2000', 'music'],
  [/musicbee/i, 'MusicBee', 'music'],
  [/aimp/i, 'AIMP', 'music'],
  [/winamp/i, 'Winamp', 'music'],
  [/cider/i, 'Cider', 'music'],
  [/qobuz/i, 'Qobuz', 'music'],
  [/fizy/i, 'fizy', 'music'],
  [/vlc/i, 'VLC', 'video'],
  [/chrome|msedge|firefox|308046B0AF4A39CB|opera|brave|vivaldi/i, null, 'browser']
];

function playerOf(aumid) {
  for (const [re, name, kind] of PLAYERS) if (re.test(aumid || '')) return { name, kind };
  // Bilinmeyen uygulama: kimliğin son parçasından okunabilir bir ad çıkar
  const raw = String(aumid || '').split(/[!\\/]/).pop().replace(/\.exe$/i, '').replace(/_[a-z0-9]{13}$/i, '');
  return { name: raw ? raw.split('.').pop() : null, kind: 'other' };
}

// ---------------------------------------------------------------------
// Müzik: Windows medya oturumunu okuyan PowerShell betiği (Windows PowerShell 5.1)
// Her 2 saniyede bir, çalan oturum varsa bilgilerini JSON satırı olarak yazar.
// ---------------------------------------------------------------------
const MEDIA_PS = `
$ErrorActionPreference = 'SilentlyContinue'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false
$enexPid = __PID__
try {
  Add-Type -AssemblyName System.Runtime.WindowsRuntime
  $asTask = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation\`1' } | Select-Object -First 1
  function Await($op, [Type]$type) {
    $task = $asTask.MakeGenericMethod($type).Invoke($null, @($op))
    if ($task.Wait(4000)) { return $task.Result } else { return $null }
  }
  $null = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType = WindowsRuntime]
  $mgrType = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]
  $propType = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties]
  $mgr = Await ($mgrType::RequestAsync()) $mgrType
} catch { $mgr = $null }
if (-not $mgr) { [Console]::Out.WriteLine('{"t":"media-error"}'); exit 1 }
[Console]::Out.WriteLine('{"t":"media-ready"}')
while ($true) {
  if (-not (Get-Process -Id $enexPid -ErrorAction SilentlyContinue)) { exit 0 }
  $o = [ordered]@{ t = 'media'; playing = $false }
  try {
    $pick = $null
    foreach ($s in $mgr.GetSessions()) {
      if ([string]$s.GetPlaybackInfo().PlaybackStatus -eq 'Playing') { $pick = $s; break }
    }
    if ($pick) {
      $p = Await ($pick.TryGetMediaPropertiesAsync()) $propType
      $tl = $pick.GetTimelineProperties()
      $o.playing = $true
      $o.app = [string]$pick.SourceAppUserModelId
      $o.title = [string]$p.Title
      $o.artist = [string]$p.Artist
      $o.album = [string]$p.AlbumTitle
      $o.pos = [double]$tl.Position.TotalSeconds
      $o.dur = [double]$tl.EndTime.TotalSeconds
      $o.upd = [double]$tl.LastUpdatedTime.ToUnixTimeMilliseconds()
    }
  } catch {}
  [Console]::Out.WriteLine(($o | ConvertTo-Json -Compress))
  Start-Sleep -Milliseconds 3000
}
`;

class ActivityService extends EventEmitter {
  /**
   * @param {object} o
   * @param {string} o.helperExe  enex-helper.exe yolu
   * @param {string} o.cacheDir   userData klasörü
   * @param {(url:string)=>Promise<Response>} o.fetch  Enex oturumu üzerinden istek (engel aşma dahil)
   * @param {(...a:any[])=>void} o.log
   */
  constructor(o) {
    super();
    this.o = o;
    this.log = o.log || (() => {});
    this.helper = null;
    this.media = null;
    this.db = null;           // { byExe: Map<basename, entry[]>, count }
    this.dbState = 'none';    // none | loading | ready | error
    this.procs = [];          // [[pid, path]]
    this.games = new Map();   // appId -> { id, name, pid, start }
    this.fg = null;           // son ön plan bilgisi
    this.music = null;        // son çalan parça
    this.helperState = 'off'; // off | running | missing | error
    this.mediaState = 'off';  // off | running | error | unsupported
    this.opts = { games: true, music: true, ownPid: process.pid };
    this._stopped = true;
    this._helperRestarts = 0;
    this._mediaRestarts = 0;
  }

  status() {
    return {
      helper: this.helperState,
      media: this.mediaState,
      db: this.dbState,
      dbCount: this.db ? this.db.count : 0,
      games: [...this.games.values()].map((g) => g.name),
      music: this.music && this.music.playing ? `${this.music.artist ? this.music.artist + ' – ' : ''}${this.music.title}` : null
    };
  }

  configure(opts) {
    const before = { ...this.opts };
    Object.assign(this.opts, opts);
    if (this._stopped) return;
    if (before.games && !this.opts.games) this._clearGames();
    if (before.music !== this.opts.music) {
      if (this.opts.music) this._startMedia();
      else { this._stopMedia(); this._setMusic(null); }
    }
    if (!before.games && this.opts.games) this._scan();
  }

  start() {
    if (process.platform !== 'win32') {
      this.helperState = 'unsupported';
      this.mediaState = 'unsupported';
      this.emit('status');
      return;
    }
    this._stopped = false;
    this._loadDb();
    this._startHelper();
    if (this.opts.music) this._startMedia();
  }

  stop() {
    this._stopped = true;
    if (this.helper) { this.helper.removeAllListeners('exit'); try { this.helper.stdin.end(); this.helper.kill(); } catch (_) {} }
    this.helper = null;
    this._stopMedia();
  }

  // ---------------- Tanınan oyunlar listesi ----------------
  _cacheFile() { return path.join(this.o.cacheDir, 'detectable.json'); }

  async _loadDb() {
    this.dbState = 'loading';
    let raw = null;
    let age = Infinity;
    try {
      const st = fs.statSync(this._cacheFile());
      age = Date.now() - st.mtimeMs;
      raw = JSON.parse(fs.readFileSync(this._cacheFile(), 'utf8'));
      this._indexDb(raw);
      this.log('activity', `oyun listesi önbellekten: ${this.db.count} uygulama`);
    } catch (_) { /* önbellek yok */ }

    if (!raw || age > DB_MAX_AGE) {
      for (let attempt = 0; attempt < 3 && !this._stopped; attempt++) {
        try {
          const res = await this.o.fetch(DETECTABLE_URLS[attempt % DETECTABLE_URLS.length]);
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const data = await res.json();
          if (!Array.isArray(data) || data.length < 100) throw new Error('beklenmeyen yanıt');
          this._indexDb(data);
          fs.writeFileSync(this._cacheFile(), JSON.stringify(data));
          this.log('activity', `oyun listesi indirildi: ${this.db.count} uygulama`);
          break;
        } catch (err) {
          this.log('activity', `oyun listesi indirilemedi (deneme ${attempt + 1}): ${err.message}`);
          await new Promise((r) => setTimeout(r, 15000 * (attempt + 1)));
        }
      }
    }
    this.dbState = this.db ? 'ready' : 'error';
    this.emit('status');
    this._scan();
  }

  _indexDb(list) {
    const byExe = new Map();
    let count = 0;
    for (const app of list) {
      if (!app || !app.id || !Array.isArray(app.executables)) continue;
      let used = false;
      for (const x of app.executables) {
        if (!x || !x.name || x.is_launcher) continue;
        if (x.os && x.os !== 'win32') continue;
        const exact = x.name[0] === '>';
        const full = (exact ? x.name.slice(1) : x.name).toLowerCase().replace(/\\/g, '/');
        const base = full.split('/').pop();
        if (!base) continue;
        if (!byExe.has(base)) byExe.set(base, []);
        byExe.get(base).push({ id: String(app.id), name: String(app.name || ''), full, exact, args: x.arguments || null });
        used = true;
      }
      if (used) count++;
    }
    this.db = { byExe, count };
  }

  // Bir program yolu tanınan bir oyuna mı ait? (arRPC'deki eşleştirme kuralları)
  matchPath(p) {
    if (!this.db || !p) return null;
    const lower = String(p).toLowerCase().replace(/\\/g, '/');
    const parts = lower.split('/');
    const compare = [];
    for (let i = 1; i <= parts.length; i++) compare.push(parts.slice(-i).join('/'));
    for (const c of compare.slice()) {
      compare.push(c.replace('64', ''), c.replace('.x64', ''), c.replace('x64', ''), c.replace('_64', ''));
    }
    const base = parts[parts.length - 1];
    const keys = new Set([base, base.replace('64', ''), base.replace('.x64', ''), base.replace('x64', ''), base.replace('_64', '')]);
    for (const k of keys) {
      const cands = this.db.byExe.get(k);
      if (!cands) continue;
      for (const c of cands) {
        if (c.exact ? c.full === compare[0] : compare.includes(c.full)) return c;
      }
    }
    return null;
  }

  isGamePid(pid) {
    for (const g of this.games.values()) if (g.pid === pid) return true;
    return false;
  }

  // Ön plandaki pencere bir oyun mu? (overlay için)
  isGameForeground(fg = this.fg) {
    if (!fg || !fg.pid || fg.pid === this.opts.ownPid) return false;
    if (DESKTOP_CLASSES.has(fg.cls)) return false;
    if (this.isGamePid(fg.pid) || (fg.path && this.matchPath(fg.path))) return true;
    const exe = String(fg.path || '').split(/[\\/]/).pop().toLowerCase();
    if (!exe || NOT_GAMES.has(exe)) return false;
    // Listede olmayan oyunlar: ekranı tamamen kaplayan pencere
    return Boolean(fg.full);
  }

  // ---------------- enex-helper.exe ----------------
  _startHelper() {
    if (this._stopped) return;
    const exe = this.o.helperExe;
    if (!fs.existsSync(exe)) {
      this.helperState = 'missing';
      this.log('activity', 'enex-helper.exe bulunamadı:', exe);
      this.emit('status');
      return;
    }
    let proc;
    try {
      proc = spawn(exe, ['--procs', '5000', '--fg', '400'], { windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] });
    } catch (err) {
      this.helperState = 'error';
      this.log('activity', 'enex-helper başlatılamadı:', err.message);
      this.emit('status');
      return;
    }
    this.helper = proc;
    this.helperState = 'running';
    this.emit('status');
    let buf = '';
    proc.stdout.setEncoding('utf8');
    proc.stdout.on('data', (d) => {
      buf += d;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (!line) continue;
        let msg;
        try { msg = JSON.parse(line); } catch (_) { continue; }
        this._onHelper(msg);
      }
    });
    proc.on('error', (err) => this.log('activity', 'enex-helper hatası:', err.message));
    proc.on('exit', (code) => {
      if (this.helper !== proc) return;
      this.helper = null;
      this.helperState = 'error';
      this.log('activity', `enex-helper kapandı (kod ${code})`);
      this.emit('status');
      if (!this._stopped && this._helperRestarts++ < 5) setTimeout(() => this._startHelper(), 2000);
    });
  }

  _onHelper(msg) {
    if (msg.t === 'procs' && Array.isArray(msg.list)) {
      this.procs = msg.list;
      this._scan();
    } else if (msg.t === 'fg') {
      this.fg = msg;
      this.emit('foreground', msg);
    } else if (msg.t === 'ready') {
      this._helperRestarts = 0;
    }
  }

  _scan() {
    if (!this.db || !this.opts.games) return;
    const seen = new Map();
    for (const [pid, p] of this.procs) {
      if (pid === this.opts.ownPid) continue;
      const m = this.matchPath(p);
      if (m && !seen.has(m.id)) seen.set(m.id, { ...m, pid });
    }
    for (const [id, m] of seen) {
      const old = this.games.get(id);
      if (old && old.pid === m.pid) continue;
      const g = { id, name: m.name, pid: m.pid, start: old ? old.start : Date.now() };
      this.games.set(id, g);
      this.log('activity', `oyun algılandı: ${g.name} (${id})`);
      this.emit('game', g);
    }
    for (const [id, g] of this.games) {
      if (!seen.has(id)) {
        this.games.delete(id);
        this.log('activity', `oyun kapandı: ${g.name}`);
        this.emit('game-end', g);
      }
    }
  }

  _clearGames() {
    for (const g of this.games.values()) this.emit('game-end', g);
    this.games.clear();
  }

  // ---------------- Müzik ----------------
  _startMedia() {
    if (this._stopped || this.media || process.platform !== 'win32') return;
    const script = MEDIA_PS.replace('__PID__', String(process.pid));
    const encoded = Buffer.from(script, 'utf16le').toString('base64');
    const ps = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    let proc;
    try {
      proc = spawn(ps, ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded],
        { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
    } catch (err) {
      this.mediaState = 'error';
      this.log('activity', 'müzik izleyici başlatılamadı:', err.message);
      this.emit('status');
      return;
    }
    this.media = proc;
    // Oyunla yarışmasın: düşük öncelik
    try { require('os').setPriority(proc.pid, require('os').constants.priority.PRIORITY_BELOW_NORMAL); } catch (_) {}
    let buf = '';
    proc.stdout.setEncoding('utf8');
    proc.stdout.on('data', (d) => {
      buf += d;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).replace(/^\uFEFF/, '').trim();
        buf = buf.slice(i + 1);
        if (!line) continue;
        let msg;
        try { msg = JSON.parse(line); } catch (_) { continue; }
        if (msg.t === 'media-ready') { this.mediaState = 'running'; this._mediaRestarts = 0; this.emit('status'); this.log('activity', 'müzik izleyici hazır'); }
        else if (msg.t === 'media-error') { this.mediaState = 'unsupported'; this.emit('status'); this.log('activity', 'Windows medya oturumu okunamıyor'); }
        else if (msg.t === 'media') this._onMedia(msg);
      }
    });
    proc.on('error', (err) => this.log('activity', 'müzik izleyici hatası:', err.message));
    proc.on('exit', (code) => {
      if (this.media !== proc) return;
      this.media = null;
      if (this.mediaState !== 'unsupported') this.mediaState = 'error';
      this.log('activity', `müzik izleyici kapandı (kod ${code})`);
      this.emit('status');
      if (!this._stopped && this.opts.music && this.mediaState !== 'unsupported' && this._mediaRestarts++ < 5) {
        setTimeout(() => this._startMedia(), 5000);
      }
    });
  }

  _stopMedia() {
    if (this.media) { this.media.removeAllListeners('exit'); try { this.media.kill(); } catch (_) {} }
    this.media = null;
    if (this.mediaState === 'running') this.mediaState = 'off';
  }

  _onMedia(m) {
    if (!m.playing || !m.title) return this._setMusic(null);
    const player = playerOf(m.app);
    // Gerçek konum: son güncellemeden bu yana geçen süre eklenir
    const pos = Math.max(0, Number(m.pos) || 0) + (m.upd ? Math.max(0, (Date.now() - m.upd) / 1000) : 0);
    const dur = Math.max(0, Number(m.dur) || 0);
    this._setMusic({
      playing: true,
      app: String(m.app || ''),
      player: player.name,
      kind: player.kind,
      title: String(m.title).slice(0, 128),
      artist: String(m.artist || '').slice(0, 128),
      album: String(m.album || '').slice(0, 128),
      start: Date.now() - pos * 1000,
      end: dur > 0 && dur >= pos ? Date.now() + (dur - pos) * 1000 : null
    });
  }

  _setMusic(next) {
    const prev = this.music;
    const key = (x) => (x ? `${x.app}|${x.title}|${x.artist}` : '');
    const changed = key(prev) !== key(next) ||
      (prev && next && Math.abs(prev.start - next.start) > 4000); // ileri/geri sarma
    this.music = next;
    if (changed) this.emit('music', next);
  }
}

module.exports = { ActivityService, playerOf };
