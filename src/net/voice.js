// Proximity voice chat. Every remote voice is a sound source in the house:
//   mic stream -> voice EQ (high-pass, presence) -> gentle compressor -> occlusion low-pass + gain
//   -> HRTF panner at the speaker's mouth (distance roll-off, directivity cone: facing away = duller)
//   -> voice bus, plus a reverb send sized by the room (talking in the foyer rings, a closet is dry).
// Output goes through a MediaStreamDestination played by an <audio> element so the browser's echo
// canceller sees it (WebAudio output alone bypasses AEC -> speaker feedback).
// Mic modes: push-to-talk (hold V) or open mic; toggle with M or the HUD mic button.
import { audio } from '../audio/audio.js';
import { settings, saveSettings } from '../core/settings.js';
import { input } from '../core/input.js';

export class VoiceChat {
  constructor(game) {
    this.game = game;
    this.net = game.net;
    this.peers = new Map();       // id -> { src, el, panner, lp, og, wet, level, analyser }
    this.micOn = false;           // user intent (open mic) / armed (ptt)
    this.talking = false;         // currently transmitting
    this.level = 0;
    this.ready = false;
  }

  async start() {
    if (!this.net.online || !audio.ready) return;
    const c = audio.ctx;
    // everyone joins the mesh (silent track until the mic is enabled), so mic-less players still hear
    this.out = c.createMediaStreamDestination();
    this.outEl = new Audio(); this.outEl.srcObject = this.out.stream; this.outEl.play().catch(() => {});
    this.outGain = c.createGain(); this.outGain.gain.value = settings.voice * 1.4;
    this.outGain.connect(this.out);
    this.verbSend = c.createGain(); this.verbSend.gain.value = 1;
    this.verb = c.createConvolver(); this.verb.buffer = audio.impulse(1.8, 3.4);
    this.verbSend.connect(this.verb).connect(this.outGain);
    this.net.on('voice-stream', ({ id, stream }) => this.attach(id, stream));
    await this.net.startVoiceMesh(this.game.roster.map((r) => r.id), c);
    this.ready = true;
    if (settings.voiceChat) await this.enableMic(true);
    this.game.hud.voice(this.state());
  }

  state() { return { ready: this.ready, mic: this.micOn, talking: this.talking, mode: settings.voiceMode || 'ptt', hasMic: !!this.net.micStream }; }

  async enableMic(on) {
    if (on && !this.net.micStream) {
      const ok = await this.net.openMic();
      if (!ok) { this.game.hud.notify('Microphone unavailable — check browser permissions', 3); this.micOn = false; this.game.hud.voice(this.state()); return false; }
      // local level meter (talk indicator + VAD)
      const src = audio.ctx.createMediaStreamSource(this.net.micStream);
      this.micAnalyser = audio.ctx.createAnalyser(); this.micAnalyser.fftSize = 512;
      src.connect(this.micAnalyser);
    }
    this.micOn = on;
    settings.voiceChat = on; saveSettings();
    this.apply();
    this.game.hud.notify(on ? ((settings.voiceMode || 'ptt') === 'ptt' ? 'Mic armed — hold V to talk' : 'Mic on (open mic) — M to mute') : 'Mic muted', 2);
    return true;
  }

  /** Decide whether the mic track is live this frame. */
  apply() {
    const ptt = (settings.voiceMode || 'ptt') === 'ptt';
    const live = this.micOn && !!this.net.micStream && (!ptt || this.pttDown) && this.game.player.alive !== false;
    if (live !== this.talking) { this.talking = live; this.net.setTalking(live); this.game.hud.voice(this.state()); }
  }

  attach(id, stream) {
    const c = audio.ctx;
    const old = this.peers.get(id);
    if (old) { try { old.src.disconnect(); } catch (_) { /* noop */ } }
    // Chrome only pulls remote WebRTC audio into WebAudio if a media element is consuming it
    const el = new Audio(); el.srcObject = stream; el.muted = true; el.play().catch(() => {});
    const src = c.createMediaStreamSource(stream);
    const hp = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 110; hp.Q.value = 0.7;
    const pres = c.createBiquadFilter(); pres.type = 'peaking'; pres.frequency.value = 2800; pres.gain.value = 2.5; pres.Q.value = 0.9;
    const comp = c.createDynamicsCompressor(); comp.threshold.value = -26; comp.ratio.value = 3; comp.attack.value = 0.006; comp.release.value = 0.18; comp.knee.value = 12;
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 20000; lp.Q.value = 0.5;
    const og = c.createGain(); og.gain.value = 1;
    const panner = c.createPanner();
    panner.panningModel = 'HRTF'; panner.distanceModel = 'inverse';
    panner.refDistance = 1.3; panner.rolloffFactor = 1.5; panner.maxDistance = 40;
    panner.coneInnerAngle = 150; panner.coneOuterAngle = 320; panner.coneOuterGain = 0.5;
    const wet = c.createGain(); wet.gain.value = 0.1;
    const analyser = c.createAnalyser(); analyser.fftSize = 256;
    src.connect(hp).connect(pres).connect(comp).connect(lp).connect(og).connect(panner).connect(this.outGain);
    panner.connect(wet).connect(this.verbSend);
    comp.connect(analyser);
    this.peers.set(id, { src, el, panner, lp, og, wet, analyser, level: 0, buf: new Uint8Array(analyser.fftSize) });
  }

  update(dt) {
    if (!this.ready) return;
    const g = this.game, inp = input;
    // push-to-talk / toggle
    const ptt = (settings.voiceMode || 'ptt') === 'ptt';
    this.pttDown = ptt && inp.down('KeyV');
    if (inp.hit('KeyM')) this.enableMic(!this.micOn);
    this.apply();
    if (this.talking) g.player.emit(5, 'voice');      // ghosts can hear you talk
    // local meter
    if (this.micAnalyser && this.talking) {
      const b = this._mb || (this._mb = new Uint8Array(this.micAnalyser.fftSize));
      this.micAnalyser.getByteTimeDomainData(b);
      let s = 0; for (let i = 0; i < b.length; i++) { const v = (b[i] - 128) / 128; s += v * v; }
      this.level = Math.sqrt(s / b.length);
    } else this.level = 0;
    // remote voices: place at the mouth, face where the speaker faces, occlude through walls
    this.outGain.gain.setTargetAtTime(settings.voice * 1.4, audio.ctx.currentTime, 0.1);
    this.t = (this.t || 0) - dt;
    const occT = this.t <= 0; if (occT) this.t = 0.12;
    const t = audio.ctx.currentTime;
    for (const [id, v] of this.peers) {
      const r = g.remote.get(id);
      if (!r) continue;
      const av = g.avatars.get(id);
      const mouth = av && av.head ? av.head.getWorldPosition(this._m || (this._m = av.pos.clone())) : r.pos.clone().setY(r.pos.y + 1.55);
      v.panner.positionX.setTargetAtTime(mouth.x, t, 0.03); v.panner.positionY.setTargetAtTime(mouth.y, t, 0.03); v.panner.positionZ.setTargetAtTime(mouth.z, t, 0.03);
      const yaw = r.yaw || 0;
      v.panner.orientationX.setTargetAtTime(-Math.sin(yaw), t, 0.05); v.panner.orientationY.setTargetAtTime(0, t, 0.05); v.panner.orientationZ.setTargetAtTime(-Math.cos(yaw), t, 0.05);
      if (occT) {
        let o = g.occlusion(mouth);
        // hiding in a wardrobe / under a bed: you sound muffled to everyone
        if (r.hd >= 0) o = { gain: o.gain * 0.7, cutoff: Math.min(o.cutoff, 1600), wet: o.wet };
        v.og.gain.setTargetAtTime(o.gain, t, 0.1);
        v.lp.frequency.setTargetAtTime(o.cutoff, t, 0.1);
        v.wet.gain.setTargetAtTime(0.06 + audio.room.wet * 0.9 + o.wet, t, 0.2);
      }
      // talk indicator from the actual signal
      v.analyser.getByteTimeDomainData(v.buf);
      let s = 0; for (let i = 0; i < v.buf.length; i += 2) { const x = (v.buf[i] - 128) / 128; s += x * x; }
      v.level = v.level * 0.7 + Math.sqrt(s / (v.buf.length / 2)) * 0.3;
      if (av) av.speaking = v.level > 0.02;
    }
  }

  dispose() {
    for (const v of this.peers.values()) { try { v.src.disconnect(); v.el.srcObject = null; } catch (_) { /* noop */ } }
    this.peers.clear();
    if (this.outEl) { this.outEl.pause(); this.outEl.srcObject = null; }
  }
}
