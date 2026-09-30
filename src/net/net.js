// Networking over WebRTC (PeerJS). Star topology for game data: the host is authoritative for ghosts, doors,
// items, power and lives; clients own their own movement. Voice chat uses a full mesh of media calls.
// Signalling goes through the public PeerJS broker, so a static Vercel deployment is all that is needed.
import Peer from 'peerjs';

const PREFIX = 'blackwood-manor-v1-';
const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function makeCode() {
  let s = '';
  for (let i = 0; i < 5; i++) s += ALPHA[(Math.random() * ALPHA.length) | 0];
  return s;
}

const PEER_OPTS = {
  debug: 0,
  config: {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      { urls: 'stun:global.stun.twilio.com:3478' },
      { urls: 'turn:eu-0.turn.peerjs.com:3478', username: 'peerjs', credential: 'peerjsp' },
      { urls: 'turn:us-0.turn.peerjs.com:3478', username: 'peerjs', credential: 'peerjsp' },
    ],
  },
};

export class Net {
  constructor() {
    this.peer = null;
    this.isHost = false;
    this.code = null;
    this.myId = null;
    this.conns = new Map();   // peerId -> DataConnection (host: all clients, client: just host)
    this.handlers = {};
    this.calls = new Map();
    this.micStream = null;
    this.closed = false;
  }

  on(type, fn) { (this.handlers[type] ||= []).push(fn); return this; }
  emit(type, ...a) { for (const f of this.handlers[type] || []) f(...a); }

  _dispatch(msg, from) {
    if (!msg || typeof msg !== 'object') return;
    this.emit('msg', msg, from);
    this.emit(msg.t, msg, from);
  }

  _wire(conn) {
    conn.on('data', (d) => this._dispatch(d, conn.peer));
    conn.on('close', () => { this.conns.delete(conn.peer); this.emit('leave', conn.peer); });
    conn.on('error', () => { this.conns.delete(conn.peer); this.emit('leave', conn.peer); });
  }

  /** Create a room. Resolves with the room code. */
  host() {
    return new Promise((resolve, reject) => {
      const tryCode = (attempt) => {
        const code = makeCode();
        const peer = new Peer(PREFIX + code, PEER_OPTS);
        let done = false;
        peer.on('open', (id) => {
          done = true;
          this.peer = peer; this.isHost = true; this.code = code; this.myId = id;
          peer.on('connection', (conn) => {
            conn.on('open', () => { this.conns.set(conn.peer, conn); this._wire(conn); this.emit('join', conn.peer); });
          });
          peer.on('call', (call) => this._answer(call));
          peer.on('disconnected', () => { if (!this.closed) peer.reconnect(); });
          resolve(code);
        });
        peer.on('error', (e) => {
          if (done) { this.emit('error', e); return; }
          peer.destroy();
          if (e.type === 'unavailable-id' && attempt < 4) tryCode(attempt + 1);
          else reject(new Error(e.type === 'network' || e.type === 'server-error' ? 'Could not reach the matchmaking server.' : e.message || String(e)));
        });
      };
      tryCode(0);
    });
  }

  /** Join a room by code. */
  join(code) {
    code = code.trim().toUpperCase();
    return new Promise((resolve, reject) => {
      const peer = new Peer(PEER_OPTS);
      const timer = setTimeout(() => { peer.destroy(); reject(new Error('Timed out. Check the room code.')); }, 15000);
      peer.on('open', (id) => {
        this.peer = peer; this.myId = id; this.isHost = false; this.code = code;
        const conn = peer.connect(PREFIX + code, { reliable: true });
        conn.on('open', () => {
          clearTimeout(timer);
          this.conns.set(conn.peer, conn);
          this.host_ = conn;
          conn.on('data', (d) => this._dispatch(d, conn.peer));
          conn.on('close', () => { this.conns.delete(conn.peer); if (!this.closed) this.emit('hostLost'); });
          resolve(id);
        });
        conn.on('error', () => { clearTimeout(timer); reject(new Error('Could not connect to that room.')); });
      });
      peer.on('call', (call) => this._answer(call));
      peer.on('error', (e) => {
        clearTimeout(timer);
        if (e.type === 'peer-unavailable') reject(new Error('No room with that code.'));
        else if (!this.peer) reject(new Error(e.message || String(e)));
        else this.emit('error', e);
      });
    });
  }

  /** client -> host */
  send(msg) {
    if (this.isHost) return;
    const c = this.host_;
    if (c && c.open) { try { c.send(msg); } catch (_) { /* channel closing */ } }
  }

  /** host -> every client (optionally except one) */
  broadcast(msg, except = null) {
    for (const [id, c] of this.conns) {
      if (id === except || !c.open) continue;
      try { c.send(msg); } catch (_) { /* channel closing */ }
    }
  }

  sendTo(id, msg) {
    const c = this.conns.get(id);
    if (c && c.open) { try { c.send(msg); } catch (_) { /* noop */ } }
  }

  // ------------------------------------------------------------------ voice chat (mesh)
  async enableMic() {
    if (this.micStream) return this.micStream;
    try {
      this.micStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      for (const t of this.micStream.getAudioTracks()) t.enabled = false;   // push-to-talk
      return this.micStream;
    } catch (_) { return null; }
  }

  setTalking(on) {
    if (!this.micStream) return;
    for (const t of this.micStream.getAudioTracks()) t.enabled = on;
  }

  callPeers(ids) {
    if (!this.micStream || !this.peer) return;
    for (const id of ids) {
      if (id === this.myId || this.calls.has(id)) continue;
      // lower id calls higher id so each pair only has one call
      if (this.myId > id) continue;
      const call = this.peer.call(id, this.micStream);
      if (call) this._trackCall(call);
    }
  }

  _answer(call) {
    call.answer(this.micStream || undefined);
    this._trackCall(call);
  }

  _trackCall(call) {
    this.calls.set(call.peer, call);
    call.on('stream', (stream) => this.emit('voice', call.peer, stream));
    call.on('close', () => this.calls.delete(call.peer));
    call.on('error', () => this.calls.delete(call.peer));
  }

  close() {
    this.closed = true;
    for (const c of this.calls.values()) { try { c.close(); } catch (_) { /* noop */ } }
    for (const c of this.conns.values()) { try { c.close(); } catch (_) { /* noop */ } }
    if (this.micStream) for (const t of this.micStream.getTracks()) t.stop();
    if (this.peer) { try { this.peer.destroy(); } catch (_) { /* noop */ } }
    this.conns.clear(); this.calls.clear();
    this.peer = null;
  }
}
