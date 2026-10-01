// Multiplayer over WebRTC (PeerJS). Works on static hosting (Vercel): peers find each other through the
// public PeerJS signalling broker, then all game traffic is peer-to-peer. The host is authoritative for
// ghosts, doors, items and objectives; clients own their own movement.
import Peer from 'peerjs';

const PREFIX = 'bwmanor-v1-';
const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ';

function iceServers() {
  const list = [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun1.l.google.com:19302' }, { urls: 'stun:global.stun.twilio.com:3478' }];
  const env = import.meta.env || {};
  if (env.VITE_TURN_URL) list.push({ urls: env.VITE_TURN_URL, username: env.VITE_TURN_USER, credential: env.VITE_TURN_PASS });
  return list;
}

export class Net {
  constructor() {
    this.peer = null;
    this.isHost = true;
    this.online = false;
    this.conns = new Map();     // peerId -> DataConnection (host: all clients; client: host only)
    this.handlers = new Map();
    this.myId = 'local';
    this.code = null;
    this.calls = new Map();
    this.micStream = null;
  }

  on(type, fn) { this.handlers.set(type, fn); }
  emit(type, msg, from) { const h = this.handlers.get(type); if (h) h(msg, from); }

  _opts() { return { debug: 0, config: { iceServers: iceServers() } }; }

  host() {
    return new Promise((resolve, reject) => {
      const tryOnce = (attempt) => {
        const code = Array.from({ length: 4 }, () => ALPHA[(Math.random() * ALPHA.length) | 0]).join('');
        const peer = new Peer(PREFIX + code, this._opts());
        peer.on('open', () => {
          this.peer = peer; this.isHost = true; this.online = true; this.code = code; this.myId = peer.id;
          peer.on('connection', (c) => this._accept(c));
          peer.on('call', (call) => this._answerCall(call));
          peer.on('disconnected', () => { try { peer.reconnect(); } catch (_) { /* ignore */ } });
          resolve(code);
        });
        peer.on('error', (e) => {
          if (e.type === 'unavailable-id' && attempt < 5) { peer.destroy(); tryOnce(attempt + 1); }
          else if (!this.peer) reject(new Error(this._err(e)));
        });
      };
      tryOnce(0);
    });
  }

  join(code) {
    return new Promise((resolve, reject) => {
      const peer = new Peer(undefined, this._opts());
      const timer = setTimeout(() => reject(new Error('Could not reach that room. Check the code and try again.')), 15000);
      peer.on('open', () => {
        this.peer = peer; this.isHost = false; this.online = true; this.myId = peer.id; this.code = code.toUpperCase();
        const c = peer.connect(PREFIX + this.code, { reliable: true, serialization: 'json' });
        c.on('open', () => { clearTimeout(timer); this.conns.set(c.peer, c); this._wire(c); resolve(); });
        c.on('error', () => { clearTimeout(timer); reject(new Error('Connection failed.')); });
        peer.on('call', (call) => this._answerCall(call));
      });
      peer.on('error', (e) => { clearTimeout(timer); reject(new Error(this._err(e))); });
    });
  }

  _err(e) {
    if (e.type === 'peer-unavailable') return 'No game found with that code.';
    if (e.type === 'network' || e.type === 'server-error') return 'Could not reach the matchmaking server. Check your connection.';
    if (e.type === 'browser-incompatible') return 'This browser does not support WebRTC.';
    return e.message || String(e.type || e);
  }

  _accept(c) {
    c.on('open', () => { this.conns.set(c.peer, c); this._wire(c); });
  }

  _wire(c) {
    c.on('data', (msg) => { if (msg && msg.t) this.emit(msg.t, msg, c.peer); });
    c.on('close', () => { this.conns.delete(c.peer); this.emit('leave', { id: c.peer }, c.peer); });
    c.on('error', () => { this.conns.delete(c.peer); this.emit('leave', { id: c.peer }, c.peer); });
  }

  /** client -> host, or host -> everyone */
  send(msg) { for (const c of this.conns.values()) if (c.open) c.send(msg); }
  sendTo(id, msg) { const c = this.conns.get(id); if (c && c.open) c.send(msg); }
  broadcast(msg, except = null) { for (const [id, c] of this.conns) if (id !== except && c.open) c.send(msg); }
  relay(msg, from) { if (this.isHost) this.broadcast(msg, from); }

  // ------------------------------------------------------------------ proximity voice chat
  /** Join the voice mesh with a silent track (the mic is swapped in later without renegotiating). */
  async startVoiceMesh(peerIds, ctx) {
    this.silent = ctx.createMediaStreamDestination().stream.getAudioTracks()[0];
    this.outStream = new MediaStream([this.silent]);
    for (const call of this.pendingCalls || []) this._answerCall(call);
    this.pendingCalls = [];
    for (const id of peerIds) if (id !== this.myId && id > this.myId && !this.calls.has(id)) {
      try { this._wireCall(this.peer.call(id, this.outStream)); } catch (_) { /* peer gone */ }
    }
    return true;
  }

  async openMic() {
    try {
      this.micStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } });
      this.micTrack = this.micStream.getAudioTracks()[0];
      this.micTrack.enabled = false;
      return true;
    } catch (_) { return false; }
  }

  _answerCall(call) {
    // answer even without a mic (silent track): everyone hears everyone. Calls that arrive before our
    // own mesh is up wait, so the connection is send+receive from the start.
    if (!this.outStream) { (this.pendingCalls ||= []).push(call); return; }
    call.answer(this.outStream);
    this._wireCall(call);
  }

  _wireCall(call) {
    this.calls.set(call.peer, call);
    call.on('stream', (s) => this.emit('voice-stream', { id: call.peer, stream: s }));
    call.on('close', () => this.calls.delete(call.peer));
    call.on('error', () => this.calls.delete(call.peer));
  }

  /** Transmit the mic (true) or silence (false) on every voice connection. */
  setTalking(on) {
    const track = on && this.micTrack ? this.micTrack : this.silent;
    if (this.micTrack) this.micTrack.enabled = !!on;
    for (const call of this.calls.values()) {
      const pc = call.peerConnection;
      if (!pc) continue;
      for (const sd of pc.getSenders()) if (!sd.track || sd.track.kind === 'audio') { try { sd.replaceTrack(track); } catch (_) { /* noop */ } }
    }
  }

  close() {
    for (const c of this.conns.values()) { try { c.close(); } catch (_) { /* ignore */ } }
    for (const c of this.calls.values()) { try { c.close(); } catch (_) { /* ignore */ } }
    if (this.micStream) this.micStream.getTracks().forEach((t) => t.stop());
    if (this.peer) { try { this.peer.destroy(); } catch (_) { /* ignore */ } }
    this.conns.clear(); this.calls.clear(); this.peer = null; this.online = false; this.isHost = true;
    this.micStream = null; this.micTrack = null; this.outStream = null; this.pendingCalls = [];
  }
}
