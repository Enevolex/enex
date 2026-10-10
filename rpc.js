// Enex — yerel Rich Presence (RPC) sunucusu.
//
// Masaüstü Discord'un \\?\pipe\discord-ipc-N kanalını taklit eder; böylece kendi durumunu
// Discord'a gönderen oyunlar ve uygulamalar (Rich Presence SDK, müzik uygulamaları, PreMiD…)
// Enex'e bağlanır. Sadece SET_ACTIVITY desteklenir; hesap/token gerektiren komutlar yoktur.
// Protokol arRPC (MIT, https://github.com/OpenAsar/arrpc) incelenerek yeniden yazılmıştır.

const { EventEmitter } = require('events');
const net = require('net');

const OP = { HANDSHAKE: 0, FRAME: 1, CLOSE: 2, PING: 3, PONG: 4 };
const PIPE = process.platform === 'win32' ? '\\\\?\\pipe\\discord-ipc-' : null;
const MAX_FRAME = 64 * 1024;

function encode(op, data) {
  const json = Buffer.from(JSON.stringify(data), 'utf8');
  const buf = Buffer.alloc(8 + json.length);
  buf.writeInt32LE(op, 0);
  buf.writeInt32LE(json.length, 4);
  json.copy(buf, 8);
  return buf;
}

// Uygulamaların bağlanınca beklediği "hazır" mesajı (sahte kullanıcı: gerçek hesap bilgisi verilmez)
const READY_USER = {
  id: '1045800378228281345', username: 'enex', discriminator: '0', global_name: 'Enex',
  avatar: null, bot: false, flags: 0, premium_type: 0
};

class RpcServer extends EventEmitter {
  constructor(log, pipeBase = PIPE) {
    super();
    this.log = log || (() => {});
    this.pipeBase = pipeBase;
    this.server = null;
    this.path = null;
    this.sockets = new Set();
    this.nextId = 0;
  }

  async start() {
    if (!this.pipeBase || this.server) return false;
    for (let i = 0; i < 10; i++) {
      const p = this.pipeBase + i;
      const ok = await new Promise((resolve) => {
        const srv = net.createServer((s) => this._onConnection(s));
        srv.once('error', () => resolve(false)); // kullanımda (ör. masaüstü Discord açık)
        srv.listen(p, () => {
          srv.removeAllListeners('error');
          srv.on('error', (e) => this.log('rpc', 'sunucu hatası:', e.message));
          this.server = srv;
          resolve(true);
        });
      });
      if (ok) {
        this.path = p;
        this.log('rpc', 'dinleniyor:', p);
        return true;
      }
    }
    this.log('rpc', 'boş discord-ipc kanalı bulunamadı');
    return false;
  }

  stop() {
    for (const s of this.sockets) { try { s.destroy(); } catch (_) {} }
    this.sockets.clear();
    if (this.server) { try { this.server.close(); } catch (_) {} }
    this.server = null;
  }

  _onConnection(sock) {
    const st = { id: `rpc:${this.nextId++}`, clientId: null, handshook: false, pid: null, buf: Buffer.alloc(0), active: false };
    this.sockets.add(sock);
    const send = (op, data) => { try { sock.write(encode(op, data)); } catch (_) {} };
    const close = (code, message) => { try { sock.end(encode(OP.CLOSE, { code, message })); } catch (_) {} };

    sock.on('data', (chunk) => {
      st.buf = Buffer.concat([st.buf, chunk]);
      while (st.buf.length >= 8) {
        const op = st.buf.readInt32LE(0);
        const len = st.buf.readInt32LE(4);
        if (len < 0 || len > MAX_FRAME || op < 0 || op > 4) { close(1003, 'invalid frame'); sock.destroy(); return; }
        if (st.buf.length < 8 + len) break;
        let data = null;
        try { data = JSON.parse(st.buf.subarray(8, 8 + len).toString('utf8')); } catch (_) { close(1003, 'invalid json'); sock.destroy(); return; }
        st.buf = st.buf.subarray(8 + len);
        this._onPacket(st, op, data, send, close, sock);
      }
    });
    sock.on('error', () => {});
    sock.on('close', () => {
      this.sockets.delete(sock);
      if (st.active) this.emit('activity', { socketId: st.id, pid: st.pid, activity: null, clientId: st.clientId });
    });
  }

  _onPacket(st, op, data, send, close, sock) {
    if (op === OP.PING) return send(OP.PONG, data);
    if (op === OP.CLOSE) { sock.end(); return; }
    if (op === OP.HANDSHAKE) {
      if (st.handshook) return;
      const v = parseInt(data && data.v != null ? data.v : 1, 10);
      const clientId = data && data.client_id ? String(data.client_id) : '';
      if (v !== 1) { close(4004, 'Invalid version'); return; }
      if (!/^\d{5,25}$/.test(clientId)) { close(4000, 'Invalid client ID'); return; }
      st.handshook = true;
      st.clientId = clientId;
      this.log('rpc', 'uygulama bağlandı:', clientId);
      send(OP.FRAME, {
        cmd: 'DISPATCH', evt: 'READY', nonce: null,
        data: {
          v: 1,
          config: { cdn_host: 'cdn.discordapp.com', api_endpoint: '//discord.com/api', environment: 'production' },
          user: READY_USER
        }
      });
      return;
    }
    if (op !== OP.FRAME || !st.handshook || !data) return;
    const { cmd, args, nonce } = data;

    if (cmd === 'SET_ACTIVITY') {
      const a = args && args.activity;
      if (args && args.pid) st.pid = Number(args.pid) || st.pid;
      if (!a) {
        st.active = false;
        this.emit('activity', { socketId: st.id, pid: st.pid, activity: null, clientId: st.clientId });
        send(OP.FRAME, { cmd, data: null, evt: null, nonce });
        return;
      }
      const activity = this._normalize(a, st.clientId);
      st.active = true;
      this.emit('activity', { socketId: st.id, pid: st.pid, activity, clientId: st.clientId });
      send(OP.FRAME, { cmd, data: { ...activity, name: activity.name || '', application_id: st.clientId }, evt: null, nonce });
      return;
    }
    if (cmd === 'SUBSCRIBE' || cmd === 'UNSUBSCRIBE') {
      send(OP.FRAME, { cmd, data: { evt: data.evt || null }, evt: null, nonce });
      return;
    }
    // Desteklenmeyen komutlar (hesap gerektirenler): uygulama asılı kalmasın diye hata dön
    send(OP.FRAME, { cmd, evt: 'ERROR', nonce, data: { code: 4000, message: `${cmd} is not supported by Enex` } });
  }

  // Uygulamanın gönderdiği etkinliği Discord istemcisinin beklediği biçime çevir
  _normalize(a, clientId) {
    const str = (v, n) => (v == null ? undefined : String(v).slice(0, n));
    const out = {
      application_id: clientId,
      type: [0, 2, 3, 5].includes(Number(a.type)) ? Number(a.type) : 0,
      flags: a.instance ? 1 : 0,
      metadata: {}
    };
    if (a.name) out.name = str(a.name, 128);
    if (a.details) out.details = str(a.details, 128);
    if (a.state) out.state = str(a.state, 128);
    if (a.status_display_type != null) out.status_display_type = Number(a.status_display_type) || 0;
    if (a.details_url) out.details_url = str(a.details_url, 256);
    if (a.state_url) out.state_url = str(a.state_url, 256);
    if (a.timestamps && typeof a.timestamps === 'object') {
      out.timestamps = {};
      for (const k of ['start', 'end']) {
        let t = Number(a.timestamps[k]);
        if (!t) continue;
        if (t < 1e12) t = Math.floor(t * 1000); // saniye -> milisaniye
        out.timestamps[k] = t;
      }
    }
    if (a.assets && typeof a.assets === 'object') {
      out.assets = {};
      for (const k of ['large_image', 'large_text', 'small_image', 'small_text', 'large_url', 'small_url']) {
        if (a.assets[k]) out.assets[k] = str(a.assets[k], 300);
      }
    }
    if (a.party && typeof a.party === 'object') {
      out.party = {};
      if (a.party.id) out.party.id = str(a.party.id, 128);
      if (Array.isArray(a.party.size)) out.party.size = a.party.size.slice(0, 2).map(Number);
    }
    if (Array.isArray(a.buttons) && a.buttons.length) {
      const b = a.buttons.slice(0, 2).filter((x) => x && x.label && x.url);
      out.buttons = b.map((x) => str(x.label, 32));
      out.metadata.button_urls = b.map((x) => str(x.url, 512));
    }
    return out;
  }
}

module.exports = { RpcServer };
