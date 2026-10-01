// Audio engine: recorded sound library (public/audio, CC0 recordings mastered by tools/audio/fetch_sfx.py)
// played through HRTF 3D panners with wall occlusion (low-pass + attenuation when there is no line of sight)
// and per-room reverb sends. Variations are picked without immediate repeats and pitch-jittered.
// Ambience loops crossfade into themselves. The old procedural synth remains only as a fallback
// for any sound whose recordings are missing.
import { settings } from '../core/settings.js';

const rnd = (a, b) => a + Math.random() * (b - a);
const pick = (a) => a[(Math.random() * a.length) | 0];

// vowel formants (F1, F2, F3) for voice synthesis
const VOWELS = {
  a: [800, 1150, 2900], e: [400, 1700, 2600], i: [300, 2300, 3000], o: [450, 800, 2830], u: [325, 700, 2530],
  uh: [600, 1040, 2250], ee: [270, 2290, 3010],
};

class AudioEngine {
  constructor() {
    this.ctx = null;
    this.ready = false;
    this.samples = new Map();
    this.loops = {};
    this.listenerPos = { x: 0, y: 0, z: 0 };
    this.lastPick = new Map();
    this.occluder = null;      // (pos) => { gain, cutoff, wet } - set by the game (line of sight / rooms)
    this.room = { wet: 0.15 }; // listener's room acoustics (set by the game)
  }

  init() {
    if (this.ctx) { if (this.ctx.state !== 'running') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AC({ latencyHint: 'interactive' });
    const c = this.ctx;
    this.master = c.createGain();
    this.comp = c.createDynamicsCompressor();
    this.comp.threshold.value = -14; this.comp.ratio.value = 4; this.comp.attack.value = 0.004; this.comp.release.value = 0.2;
    this.master.connect(this.comp).connect(c.destination);
    this.bus = {};
    for (const k of ['music', 'sfx', 'voice', 'ui', 'amb']) {
      this.bus[k] = c.createGain();
      this.bus[k].connect(this.master);
    }
    this.reverb = c.createConvolver();
    this.reverb.buffer = this.impulse(2.2, 3.2);
    this.reverbOut = c.createGain(); this.reverbOut.gain.value = 0.5;
    this.reverb.connect(this.reverbOut).connect(this.master);
    // the ambience bus ducks under stingers / screams
    this.duckGain = c.createGain(); this.duckGain.gain.value = 1;
    this.bus.amb.disconnect(); this.bus.amb.connect(this.duckGain).connect(this.master);
    this.noise = { white: this.noiseBuffer('white'), pink: this.noiseBuffer('pink'), brown: this.noiseBuffer('brown') };
    this.applyVolumes();
    this.ready = true;
    this.loadManifest();
  }

  applyVolumes() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(settings.master, t, 0.05);
    this.bus.music.gain.setTargetAtTime(settings.music * 0.8, t, 0.05);
    this.bus.sfx.gain.setTargetAtTime(settings.sfx, t, 0.05);
    this.bus.amb.gain.setTargetAtTime(settings.sfx * 0.9, t, 0.05);
    this.bus.voice.gain.setTargetAtTime(settings.voice, t, 0.05);
    this.bus.ui.gain.setTargetAtTime(settings.sfx * 0.8, t, 0.05);
  }

  async loadManifest() {
    try {
      const res = await fetch('/audio/manifest.json', { cache: 'no-cache' });
      if (!res.ok) return;
      const man = await res.json();
      // ambience + UI first, then everything else, a few files at a time (keeps the main thread smooth)
      const first = ['ui_hover', 'ui_click', 'ui_back', 'menu_ambience', 'thunder', 'rain_window', 'wind_house', 'ambience_house'];
      const keys = Object.keys(man).filter((k) => Array.isArray(man[k]) && man[k].length).sort((x, y) => (first.includes(y) - first.includes(x)));
      const jobs = [];
      for (const key of keys) for (const f of man[key]) jobs.push([key, f]);
      let i = 0;
      const worker = async () => {
        while (i < jobs.length) {
          const [key, f] = jobs[i++];
          try {
            const r = await fetch('/audio/' + f);
            if (!r.ok) continue;
            const buf = await this.ctx.decodeAudioData(await r.arrayBuffer());
            if (!this.samples.has(key)) this.samples.set(key, []);
            this.samples.get(key).push(buf);
            // upgrade a synth loop that started before its recording arrived
            for (const [ln, spec] of Object.entries(LOOP_SAMPLES)) if (spec.key === key && this.loops[ln] && !this.loops[ln].sampled) this.restartLoop(ln);
          } catch (_) { /* missing file: synth fallback */ }
        }
      };
      await Promise.all([worker(), worker(), worker(), worker()]);
      this.loaded = true;
    } catch (_) { /* no manifest: fully procedural */ }
  }

  /** Random variation of a sample key, never the same file twice in a row. */
  pickBuf(key) {
    const bufs = this.samples.get(key);
    if (!bufs || !bufs.length) return null;
    if (bufs.length === 1) return bufs[0];
    let i;
    const last = this.lastPick.get(key);
    do { i = (Math.random() * bufs.length) | 0; } while (i === last);
    this.lastPick.set(key, i);
    return bufs[i];
  }

  // ------------------------------------------------------------------ buffers
  noiseBuffer(kind, secs = 4) {
    const c = this.ctx, n = c.sampleRate * secs;
    const b = c.createBuffer(2, n, c.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = b.getChannelData(ch);
      let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, last = 0;
      for (let i = 0; i < n; i++) {
        const w = Math.random() * 2 - 1;
        if (kind === 'white') d[i] = w;
        else if (kind === 'pink') {
          b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759; b2 = 0.969 * b2 + w * 0.153852;
          b3 = 0.8665 * b3 + w * 0.3104856; b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
          d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11; b6 = w * 0.115926;
        } else { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; }
      }
    }
    return b;
  }

  impulse(secs, decay) {
    const c = this.ctx, n = c.sampleRate * secs;
    const b = c.createBuffer(2, n, c.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = b.getChannelData(ch);
      for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, decay) * (i < 200 ? i / 200 : 1);
    }
    return b;
  }

  // ------------------------------------------------------------------ routing helpers
  /** Create an output for a sound: spatial (HRTF panner + occlusion lowpass) or flat. */
  out(opts = {}) {
    const c = this.ctx;
    const g = c.createGain();
    g.gain.value = opts.vol ?? 1;
    let tail = g;
    const bus = this.bus[opts.bus || 'sfx'];
    let occ = null;
    if (opts.pos) {
      occ = this.occluder ? this.occluder(opts.pos) : null;
      const lp = c.createBiquadFilter(); lp.type = 'lowpass';
      lp.frequency.value = opts.muffle ? 900 : (occ ? occ.cutoff : 20000); lp.Q.value = 0.5;
      const og = c.createGain(); og.gain.value = occ ? occ.gain : 1;
      const p = c.createPanner();
      p.panningModel = 'HRTF'; p.distanceModel = 'inverse';
      p.refDistance = opts.ref ?? 1.5; p.maxDistance = 80; p.rolloffFactor = opts.rolloff ?? 1.15;
      p.positionX.value = opts.pos.x; p.positionY.value = opts.pos.y; p.positionZ.value = opts.pos.z;
      g.connect(lp).connect(og).connect(p).connect(bus);
      tail = p;
      g._panner = p; g._lp = lp; g._og = og;
    } else {
      g.connect(bus);
    }
    // reverb: the requested amount scaled by the listener's room, plus more when the source is behind walls
    const wet = (opts.reverb ?? 0) * (opts.pos ? 0.6 + this.room.wet * 2.6 : 1) + (occ ? occ.wet : 0);
    if (wet > 0.01) {
      const s = c.createGain(); s.gain.value = wet;
      tail.connect(s).connect(this.reverb);
      g._wet = s;
    }
    return g;
  }

  env(g, t, a, peak, d, sustain = 0) {
    g.gain.cancelScheduledValues(t);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0002), t + a);
    g.gain.exponentialRampToValueAtTime(Math.max(sustain, 0.0001), t + a + d);
  }

  noiseSrc(kind = 'white', rate = 1) {
    const s = this.ctx.createBufferSource();
    s.buffer = this.noise[kind]; s.loop = true; s.playbackRate.value = rate;
    s.loopStart = Math.random() * 3;
    return s;
  }

  filt(type, f, q = 1) {
    const b = this.ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q; return b;
  }

  shaper(amount = 20) {
    const ws = this.ctx.createWaveShaper();
    const n = 1024, curve = new Float32Array(n);
    for (let i = 0; i < n; i++) { const x = i / n * 2 - 1; curve[i] = ((1 + amount) * x) / (1 + amount * Math.abs(x)); }
    ws.curve = curve; ws.oversample = '2x';
    return ws;
  }

  stopAt(nodes, t) { for (const n of nodes) { try { n.stop(t); } catch (_) { /* already stopped */ } } }

  // ------------------------------------------------------------------ public API
  /** Play a named sound. opts: {pos, vol, muffle, bus, surface, ...}. Returns handle with setPos/stop. */
  play(name, opts = {}) {
    if (!this.ready) return null;
    const m = resolve(name, opts);
    if (m) {
      const buf = this.pickBuf(m.key);
      if (buf) {
        return this.playSample(buf, { ...opts, vol: (opts.vol ?? 1) * (m.vol ?? 1), rate: opts.rate ?? (m.rate ? m.rate() : rnd(0.95, 1.05)),
          bus: opts.bus || m.bus || BUS_OF[name] || 'sfx', reverb: opts.reverb ?? m.reverb ?? REVERB_OF[name] ?? 0.12, dur: m.dur, name, fx: m.fx, sub: m.sub, grit: m.grit });
      }
    }
    const fn = SYNTH[name];
    if (!fn) return null;
    const o = this.out({ ...opts, bus: opts.bus || BUS_OF[name] || 'sfx', reverb: opts.reverb ?? REVERB_OF[name] ?? 0.12 });
    const dur = fn(this, o, opts) || 1;
    setTimeout(() => { try { o.disconnect(); } catch (_) { /* noop */ } }, (dur + 3.5) * 1000);
    return this.handle(o, null);
  }

  handle(o, src) {
    return {
      node: o, src,
      setPos: (p) => {
        if (!o._panner) return;
        const t = this.ctx.currentTime;
        o._panner.positionX.setTargetAtTime(p.x, t, 0.05); o._panner.positionY.setTargetAtTime(p.y, t, 0.05); o._panner.positionZ.setTargetAtTime(p.z, t, 0.05);
        if (this.occluder && o._og) {
          const occ = this.occluder(p);
          o._og.gain.setTargetAtTime(occ.gain, t, 0.12); o._lp.frequency.setTargetAtTime(occ.cutoff, t, 0.12);
        }
      },
      setMuffle: (m) => { if (o._lp) o._lp.frequency.setTargetAtTime(m ? 900 : 20000, this.ctx.currentTime, 0.08); },
      stop: (fade = 0.05) => { try { o.gain.setTargetAtTime(0, this.ctx.currentTime, fade); if (src) src.stop(this.ctx.currentTime + fade * 6); } catch (_) { /* noop */ } },
    };
  }

  playSample(buf, opts) {
    const c = this.ctx;
    const o = this.out({ ...opts, bus: opts.bus || 'sfx', reverb: opts.reverb ?? 0.1 });
    const s = c.createBufferSource(); s.buffer = buf;
    s.playbackRate.value = opts.rate ?? rnd(0.96, 1.04);
    if (opts.fx === 'ghost') {
      // an unnatural voice: an octave-down rumble under it, a slightly detuned double a hair behind it,
      // a little grit - one recording becomes something too big for the throat it comes from
      const r = s.playbackRate.value, t0 = c.currentTime;
      const grit = this.shaper(opts.grit ?? 2.5);
      const bus = c.createGain(); bus.gain.value = 0.8;
      s.connect(bus);
      const sub = c.createBufferSource(); sub.buffer = buf; sub.playbackRate.value = r * 0.5;
      const subLp = this.filt('lowpass', 1100, 0.6), subG = c.createGain(); subG.gain.value = opts.sub ?? 0.5;
      sub.connect(subLp).connect(subG).connect(bus);
      const dbl = c.createBufferSource(); dbl.buffer = buf; dbl.playbackRate.value = r * 1.013;
      const dly = c.createDelay(0.1); dly.delayTime.value = 0.031; const dblG = c.createGain(); dblG.gain.value = 0.38;
      dbl.connect(dly).connect(dblG).connect(bus);
      bus.connect(grit).connect(o);
      const len = buf.duration / r;
      sub.start(t0); sub.stop(t0 + len + 0.05);
      dbl.start(t0); dbl.stop(t0 + len / 1.013 + 0.1);
      // the sub layer is twice as long: fade it out with the main voice
      subG.gain.setValueAtTime(subG.gain.value, t0 + len * 0.85); subG.gain.linearRampToValueAtTime(0.0001, t0 + len);
    } else s.connect(o);
    if (opts.dur && opts.dur < buf.duration) {
      // trimmed (e.g. a quick door creak): play the head of the recording with a short fade
      const t = c.currentTime, v = o.gain.value;
      s.start(t, 0, opts.dur + 0.25);
      o.gain.setValueAtTime(v, t + opts.dur);
      o.gain.linearRampToValueAtTime(0.0001, t + opts.dur + 0.25);
    } else s.start();
    if (/scream|stinger|jumpscare|roar/.test(opts.name || '')) this.duck(0.45, 1.6);
    s.onended = () => { try { o.disconnect(); } catch (_) { /* noop */ } };
    return this.handle(o, s);
  }

  duck(level, secs) {
    const t = this.ctx.currentTime, g = this.duckGain.gain;
    g.cancelScheduledValues(t); g.setTargetAtTime(level, t, 0.05); g.setTargetAtTime(1, t + secs, 0.8);
  }

  updateListener(pos, fwd, up) {
    if (!this.ready) return;
    const L = this.ctx.listener, t = this.ctx.currentTime;
    this.listenerPos = pos;
    if (L.positionX) {
      L.positionX.setTargetAtTime(pos.x, t, 0.01); L.positionY.setTargetAtTime(pos.y, t, 0.01); L.positionZ.setTargetAtTime(pos.z, t, 0.01);
      L.forwardX.setTargetAtTime(fwd.x, t, 0.01); L.forwardY.setTargetAtTime(fwd.y, t, 0.01); L.forwardZ.setTargetAtTime(fwd.z, t, 0.01);
      L.upX.setTargetAtTime(up.x, t, 0.01); L.upY.setTargetAtTime(up.y, t, 0.01); L.upZ.setTargetAtTime(up.z, t, 0.01);
    } else {
      L.setPosition(pos.x, pos.y, pos.z);
      L.setOrientation(fwd.x, fwd.y, fwd.z, up.x, up.y, up.z);
    }
  }

  // ------------------------------------------------------------------ loops (ambience / music)
  startLoop(name, opts = {}) {
    if (!this.ready || this.loops[name]) return this.loops[name];
    const spec = LOOP_SAMPLES[name];
    const bufs = spec && this.samples.get(spec.key);
    let h;
    if (bufs && bufs.length) {
      h = this.sampleLoop(bufs, { bus: opts.bus || spec.bus || 'amb', set: spec.set });
      h.sampled = true;
    } else {
      const fn = LOOPS[name];
      if (!fn) return null;
      h = fn(this, opts);
    }
    h.vol = opts.vol ?? 1;
    h.gain.gain.setTargetAtTime(h.vol, this.ctx.currentTime, opts.fade ?? 1.5);
    this.loops[name] = h;
    return h;
  }

  restartLoop(name) {
    const h = this.loops[name];
    if (!h) return;
    const vol = h.vol ?? 1;
    this.stopLoop(name);
    this.startLoop(name, { vol, fade: 2 });
  }

  /** Endless loop from recordings: each pass crossfades into the next (random file / start offset). */
  sampleLoop(bufs, { bus = 'amb', set = null } = {}) {
    const c = this.ctx;
    const g = c.createGain(); g.gain.value = 0.0001;
    const lp = this.filt('lowpass', 20000, 0.5);
    g.connect(lp).connect(this.bus[bus]);
    let alive = true, rate = 1, timer = null;
    const X = 2.5;   // crossfade seconds
    const voices = [];
    const next = () => {
      if (!alive) return;
      const buf = bufs[(Math.random() * bufs.length) | 0];
      const src = c.createBufferSource(); src.buffer = buf; src.playbackRate.value = rate;
      const vg = c.createGain(); const t = c.currentTime;
      const off = buf.duration > 20 ? Math.random() * buf.duration * 0.4 : 0;
      const play = Math.max(X * 2 + 0.5, (buf.duration - off) / rate);
      vg.gain.setValueAtTime(0, t); vg.gain.linearRampToValueAtTime(1, t + X);
      vg.gain.setValueAtTime(1, t + play - X); vg.gain.linearRampToValueAtTime(0, t + play);
      src.loop = buf.duration < X * 2 + 0.5;
      src.connect(vg).connect(g); src.start(t, off); src.stop(t + play + 0.1);
      voices.push(src); src.onended = () => { const i = voices.indexOf(src); if (i >= 0) voices.splice(i, 1); };
      timer = setTimeout(next, Math.max(1000, (play - X) * 1000));
    };
    next();
    return {
      gain: g,
      set: (x) => {
        if (set === 'rate') { rate = 0.85 + x * 0.6; for (const v of voices) v.playbackRate.setTargetAtTime(rate, c.currentTime, 0.4); }
        else if (set === 'muffle') lp.frequency.setTargetAtTime(x ? 1200 : 20000, c.currentTime, 0.3);
      },
      stop: () => { alive = false; clearTimeout(timer); g.gain.setTargetAtTime(0, c.currentTime, 0.6); setTimeout(() => voices.forEach((v) => { try { v.stop(); } catch (_) { /* noop */ } }), 3500); },
    };
  }

  setLoop(name, vol, param) {
    const h = this.loops[name];
    if (!h) return;
    h.gain.gain.setTargetAtTime(vol, this.ctx.currentTime, 0.3);
    if (param !== undefined && h.set) h.set(param);
  }

  stopLoop(name) {
    const h = this.loops[name];
    if (!h) return;
    h.stop();
    delete this.loops[name];
  }

  stopAll() { for (const k of Object.keys(this.loops)) this.stopLoop(k); }
}

// ============================================================================ recording map
// game sound name -> sample key (+ per-sound gain / pitch / trim). Missing keys fall back to the synth.
const R = (key, extra = {}) => ({ key, ...extra });
const jitter = (a, b) => () => rnd(a, b);
const SURF_KEY = { wood: 'step_wood', carpet: 'step_carpet', tile: 'step_tile', stone: 'step_stone', metal: 'step_stone', gravel: 'step_stone', mud: 'step_carpet' };
function resolve(name, o) {
  switch (name) {
    case 'footstep': {
      const i = o.intensity ?? 0.7;
      const key = i >= 1.15 && o.surface !== 'carpet' ? 'step_run' : SURF_KEY[o.surface] || 'step_wood';
      return R(key, { vol: 0.25 + 0.6 * Math.min(1.3, i), rate: jitter(0.9 + i * 0.05, 1.04 + i * 0.05), reverb: 0.08 });
    }
    case 'heavy_step': return R('step_heavy', { vol: 1.1, rate: jitter(0.8, 0.92), reverb: 0.2 });
    case 'door_creak': return R('door_open', { vol: 0.85, dur: o.dur ? o.dur + 0.4 : undefined, reverb: 0.2 });
    case 'door_close': return R('door_close', { vol: 0.9 });
    case 'door_slam': return R('door_slam', { vol: 1.0, reverb: 0.35 });
    case 'door_locked': return R('door_locked', { vol: 0.8 });
    case 'door_bang': return R('door_bang', { vol: 1, reverb: 0.3 });
    case 'unlock': return R('unlock', { vol: 0.9 });
    case 'drawer': return R(o.close ? 'drawer_close' : 'drawer_open', { vol: 0.8 });
    case 'hide_in': case 'hide_out': return R('wardrobe', { vol: 0.75, dur: 1.4 });
    case 'bed_creak': return R('bed_creak', { vol: 0.6 });
    case 'cloth': return R('cloth', { vol: 0.6 });
    case 'crawl': return R('crawl', { vol: 0.7 });
    case 'pickup': return R('pickup', { vol: 0.8 });
    case 'key_pickup': return R('keys', { vol: 0.95 });
    case 'battery': return R('battery', { vol: 0.9 });
    case 'flashlight': return R('flashlight', { vol: 0.75, rate: jitter(0.97, 1.05) });
    case 'glass_break': return R('glass_break', { vol: 0.95, reverb: 0.25 });
    case 'wood_break': return R('wood_break', { vol: 1 });
    case 'fuse_insert': return R('fuse', { vol: 0.9 });
    case 'lever': return R('lever', { vol: 1 });
    case 'power_down': return R('power_down', { vol: 1 });
    case 'power_up': return R('power_up', { vol: 1 });
    case 'light_buzz': return R('light_buzz', { vol: 0.8 });
    case 'bulb_pop': return R('bulb_pop', { vol: 0.9 });
    case 'thunder': return R('thunder', { vol: o.close ? 1.2 : 0.75, rate: o.close ? jitter(0.95, 1.02) : jitter(0.8, 0.92), reverb: 0.08 });
    case 'whisper': return R('ghost_whisper', { fx: 'ghost', sub: 0.3, vol: 1, reverb: 0.5 });
    case 'wail': return R('wail', { fx: 'ghost', vol: 1, rate: jitter(0.86, 0.96), reverb: 0.6 });
    case 'weep': return R('weep', { fx: 'ghost', sub: 0.35, vol: 0.9, rate: jitter(0.88, 0.97), reverb: 0.55 });
    case 'scream': return R('scream_ghost', { fx: 'ghost', sub: 0.55, grit: 3.5, vol: 1.1, rate: jitter(0.86, 0.95), reverb: 0.7 });
    case 'laugh': return R('laugh_ghost', { fx: 'ghost', sub: 0.6, vol: 1, rate: jitter(0.86, 0.95), reverb: 0.5 });
    case 'giggle': return R('giggle', { fx: 'ghost', sub: 0.25, vol: 0.95, rate: jitter(0.95, 1.08), reverb: 0.55 });
    case 'hum': return R('hum', { fx: 'ghost', sub: 0.3, vol: 0.8, rate: jitter(0.9, 0.98), reverb: 0.6 });
    case 'child_whisper': return R('child_whisper', { fx: 'ghost', sub: 0.25, vol: 1, reverb: 0.5 });
    case 'growl': return R('growl', { fx: 'ghost', sub: 0.7, grit: 4, vol: 1, rate: jitter(0.8, 0.92), reverb: 0.3 });
    case 'roar': return R('roar', { fx: 'ghost', sub: 0.8, grit: 5, vol: 1.2, rate: jitter(0.82, 0.92), reverb: 0.4 });
    case 'monster_breath': return R('breath_monster', { fx: 'ghost', sub: 0.6, vol: 0.9, rate: jitter(0.85, 0.95) });
    case 'chain': return R('chain', { vol: 0.9, reverb: 0.3 });
    case 'stinger': return R('stinger', { vol: 0.9, bus: 'music', reverb: 0.3 });
    case 'jumpscare': return R('jumpscare', { fx: 'ghost', sub: 0.6, grit: 4, vol: 1.25, rate: jitter(0.9, 1.0), reverb: 0.2, bus: 'sfx' });
    case 'knock': return R('knock', { vol: 1, reverb: 0.3 });
    case 'clock_chime': return R('clock_chime', { vol: 0.9, reverb: 0.5 });
    case 'piano': return R('piano_creepy', { vol: 0.9, bus: 'music', reverb: 0.5 });
    case 'musicbox': return R('music_box', { vol: 0.9, bus: 'music', reverb: 0.4, rate: jitter(0.93, 0.97) });
    case 'gasp': return R('gasp', { vol: 0.8, bus: 'voice' });
    case 'breath_in': case 'breath_out': return R('breath_heavy', { vol: 0.35 + 0.25 * Math.min(1.5, o.intensity ?? 1), bus: 'voice', reverb: 0.05 });
    case 'breath_scared': return R('breath_scared', { vol: 0.5, bus: 'voice', reverb: 0.05 });
    case 'hurt': return R('hurt', { vol: 0.9, bus: 'voice' });
    case 'victim_scream': return R('scream_victim', { vol: 1, bus: 'voice', reverb: 0.4 });
    case 'cleaver': return R('swipe', { vol: 0.9 });
    case 'hit': return R('hit_body', { vol: 1 });
    case 'bone': return R('bone_crack', { vol: 1 });
    case 'body_fall': return R('land', { vol: 1 });
    case 'whoosh': return R('whoosh', { vol: 0.7 });
    case 'slide': return R('slide', { vol: 0.8 });
    case 'vanish': return R('vanish', { vol: 0.85, reverb: 0.5 });
    case 'heal': return R('heal', { vol: 0.8 });
    case 'inject': return R('inject', { vol: 0.9 });
    case 'pills': return R('pills', { vol: 0.8 });
    case 'paper': return R('paper', { vol: 0.8 });
    case 'page': return R('book_page', { vol: 0.8, bus: 'ui' });
    case 'book_open': return R('ui_open', { vol: 0.8, bus: 'ui' });
    case 'car_door': return R('car_door', { vol: 1 });
    case 'car_start': return R('car_start', { vol: 1 });
    case 'ui_hover': return R('ui_hover', { vol: 0.5, bus: 'ui', reverb: 0 });
    case 'ui_click': return R('ui_click', { vol: 0.7, bus: 'ui', reverb: 0 });
    case 'ui_back': return R('ui_back', { vol: 0.7, bus: 'ui', reverb: 0 });
    case 'object_fall': return R('object_fall', { vol: 1, reverb: 0.25 });
    case 'frame_fall': return R('frame_fall', { vol: 1, reverb: 0.25 });
    case 'chair_scrape': return R('chair_scrape', { vol: 0.9, reverb: 0.25 });
    case 'phone_ring': return R('phone_ring', { vol: 0.9, reverb: 0.3 });
    case 'radio_static': return R('radio_static', { vol: 0.7 });
    case 'bell': return R('bell', { vol: 0.9, reverb: 0.4 });
    case 'baby_cry': return R('baby_cry', { vol: 0.7, rate: jitter(0.85, 0.92), reverb: 0.6 });
    case 'rope_creak': return R('rope_creak', { vol: 0.8 });
    case 'house_creak': return R('house_creak', { vol: 0.8, reverb: 0.35 });
    case 'glass_tap': return R('glass_tap', { vol: 0.9 });
    case 'window_bang': return R('window_bang', { vol: 1, reverb: 0.3 });
    case 'candle_out': return R('candle_out', { vol: 0.8 });
    case 'crucifix': return R('bell', { vol: 0.8, rate: jitter(0.7, 0.75), reverb: 0.7 });
    default: return null;
  }
}
const LOOP_SAMPLES = {
  rain: { key: 'rain_window', set: 'muffle' },
  rain_out: { key: 'rain_heavy' },
  wind: { key: 'wind_house' },
  drone: { key: 'ambience_house' },
  heartbeat: { key: 'heartbeat', set: 'rate', bus: 'sfx' },
  chase: { key: 'chase_loop', bus: 'music' },
  menu: { key: 'menu_ambience', bus: 'music' },
  car: { key: 'car_idle' },
  clock: { key: 'clock_tick' },
  drip: { key: 'water_drip' },
};

// ============================================================================ synth voices
const BUS_OF = {
  ui_hover: 'ui', ui_click: 'ui', whisper: 'voice', wail: 'voice', weep: 'voice', scream: 'voice', giggle: 'voice',
  hum: 'voice', growl: 'voice', roar: 'voice', sob: 'voice', stinger: 'music', piano: 'music', musicbox: 'music',
};
const REVERB_OF = { whisper: 0.5, wail: 0.7, weep: 0.5, scream: 0.5, giggle: 0.55, hum: 0.6, growl: 0.35, roar: 0.4,
  thunder: 0.2, stinger: 0.4, piano: 0.6, musicbox: 0.5, door_creak: 0.25, door_slam: 0.4, chain: 0.3, clock_chime: 0.6 };

function thump(A, o, t, f0 = 90, f1 = 40, dur = 0.12, vol = 0.8) {
  const c = A.ctx;
  const osc = c.createOscillator(); osc.type = 'sine';
  osc.frequency.setValueAtTime(f0, t); osc.frequency.exponentialRampToValueAtTime(f1, t + dur);
  const g = c.createGain(); A.env(g, t, 0.004, vol, dur);
  osc.connect(g).connect(o); osc.start(t); osc.stop(t + dur + 0.05);
}

function burst(A, o, t, { kind = 'white', type = 'bandpass', f = 1000, q = 1, dur = 0.08, vol = 0.5, a = 0.003, rate = 1 } = {}) {
  const c = A.ctx;
  const s = A.noiseSrc(kind, rate);
  const fl = A.filt(type, f, q);
  const g = c.createGain(); A.env(g, t, a, vol, dur);
  s.connect(fl).connect(g).connect(o); s.start(t); s.stop(t + a + dur + 0.05);
  return fl;
}

function tone(A, o, t, { type = 'sine', f = 440, dur = 0.3, vol = 0.3, a = 0.005, glide = null, detune = 0 } = {}) {
  const c = A.ctx;
  const osc = c.createOscillator(); osc.type = type; osc.frequency.setValueAtTime(f, t); osc.detune.value = detune;
  if (glide) osc.frequency.exponentialRampToValueAtTime(glide, t + dur);
  const g = c.createGain(); A.env(g, t, a, vol, dur);
  osc.connect(g).connect(o); osc.start(t); osc.stop(t + a + dur + 0.05);
  return osc;
}

/** Formant voice: glottal source (saw w/ vibrato+jitter) or breath noise through 3 formant bandpasses. */
function voice(A, o, t, { pitch = 300, pitchEnd = null, dur = 1, vowels = ['a'], breath = 0.2, vib = 5, vibAmt = 0.02,
  vol = 0.5, a = 0.05, rel = 0.3, dist = 0, whisper = false, tremolo = 0 } = {}) {
  const c = A.ctx;
  const mix = c.createGain(); mix.gain.value = 1;
  let src, stops = [];
  if (!whisper) {
    const osc = c.createOscillator(); osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(pitch, t);
    if (pitchEnd) osc.frequency.exponentialRampToValueAtTime(pitchEnd, t + dur);
    const lfo = c.createOscillator(); lfo.frequency.value = vib;
    const lg = c.createGain(); lg.gain.value = pitch * vibAmt;
    lfo.connect(lg).connect(osc.frequency);
    osc.start(t); lfo.start(t); stops.push(osc, lfo);
    src = osc;
  }
  const n = A.noiseSrc('pink'); n.start(t); stops.push(n);
  const ng = c.createGain(); ng.gain.value = whisper ? 1 : breath;
  n.connect(ng);
  const pre = c.createGain(); pre.gain.value = 1;
  if (src) src.connect(pre);
  ng.connect(pre);
  let chainIn = pre;
  if (dist) { const ws = A.shaper(dist); pre.connect(ws); chainIn = ws; }
  const seg = dur / vowels.length;
  const gains = [1, 0.5, 0.25];
  for (let k = 0; k < 3; k++) {
    const bp = A.filt('bandpass', VOWELS[vowels[0]][k], whisper ? 8 : 10);
    vowels.forEach((v, i) => bp.frequency.setTargetAtTime(VOWELS[v][k] * (pitch > 500 ? 1.15 : 1), t + i * seg, seg * 0.3));
    const g = c.createGain(); g.gain.value = gains[k];
    chainIn.connect(bp).connect(g).connect(mix);
  }
  const out = c.createGain();
  A.env(out, t, a, vol, dur, vol * 0.8);
  out.gain.setTargetAtTime(0.0001, t + dur, rel / 3);
  if (tremolo) {
    const tr = c.createOscillator(); tr.frequency.value = tremolo;
    const tg = c.createGain(); tg.gain.value = 0.5;
    const base = c.createGain(); base.gain.value = 0.5;
    tr.connect(tg).connect(base.gain); tr.start(t); stops.push(tr);
    mix.connect(base).connect(out);
  } else mix.connect(out);
  out.connect(o);
  A.stopAt(stops, t + dur + rel + 0.3);
  return dur + rel;
}

const SURF = {
  wood: (A, o, t, v) => {
    thump(A, o, t, 110, 45, 0.09, 0.55 * v);
    burst(A, o, t, { f: rnd(600, 900), q: 1.2, dur: 0.07, vol: 0.35 * v });
    if (Math.random() < 0.12) { // board creak
      const s = tone(A, o, t + 0.02, { type: 'sawtooth', f: rnd(180, 320), dur: rnd(0.15, 0.3), vol: 0.05 * v, glide: rnd(150, 260) });
      void s;
    }
  },
  carpet: (A, o, t, v) => { thump(A, o, t, 80, 40, 0.08, 0.35 * v); burst(A, o, t, { type: 'lowpass', f: 420, dur: 0.1, vol: 0.4 * v, a: 0.01 }); },
  tile: (A, o, t, v) => {
    thump(A, o, t, 140, 60, 0.05, 0.3 * v);
    burst(A, o, t, { type: 'highpass', f: 2500, dur: 0.025, vol: 0.4 * v });
    tone(A, o, t, { f: rnd(2400, 3200), dur: 0.05, vol: 0.03 * v });
  },
  stone: (A, o, t, v) => { thump(A, o, t, 120, 50, 0.07, 0.45 * v); burst(A, o, t, { f: 1400, q: 0.8, dur: 0.05, vol: 0.35 * v }); },
  metal: (A, o, t, v) => { thump(A, o, t, 150, 70, 0.08, 0.4 * v); tone(A, o, t, { type: 'triangle', f: rnd(500, 700), dur: 0.2, vol: 0.06 * v }); burst(A, o, t, { f: 3000, q: 3, dur: 0.05, vol: 0.2 * v }); },
  gravel: (A, o, t, v) => { for (let i = 0; i < 5; i++) burst(A, o, t + i * 0.012, { f: rnd(1500, 3500), q: 2, dur: 0.02, vol: 0.25 * v }); thump(A, o, t, 70, 40, 0.06, 0.3 * v); },
  mud: (A, o, t, v) => { burst(A, o, t, { type: 'lowpass', f: 700, dur: 0.12, vol: 0.5 * v }); burst(A, o, t + 0.05, { f: 1200, q: 4, dur: 0.05, vol: 0.2 * v }); },
};

const SYNTH = {
  footstep(A, o, opts) {
    const t = A.ctx.currentTime;
    (SURF[opts.surface] || SURF.wood)(A, o, t, opts.intensity ?? 1);
    return 0.4;
  },
  heavy_step(A, o) {
    const t = A.ctx.currentTime;
    thump(A, o, t, 70, 28, 0.25, 1.0);
    burst(A, o, t, { type: 'lowpass', f: 300, dur: 0.2, vol: 0.6 });
    if (Math.random() < 0.3) tone(A, o, t + 0.05, { type: 'sawtooth', f: rnd(120, 200), glide: 90, dur: 0.4, vol: 0.05 });
    return 0.6;
  },
  door_creak(A, o, opts) {
    const c = A.ctx, t = c.currentTime, dur = opts.dur ?? rnd(0.8, 1.6);
    const osc = c.createOscillator(); osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(rnd(25, 40), t);
    for (let k = 1; k <= 6; k++) osc.frequency.linearRampToValueAtTime(rnd(20, 85), t + dur * k / 6);
    const g = c.createGain(); A.env(g, t, 0.05, 0.5, dur, 0.3); g.gain.setTargetAtTime(0.0001, t + dur, 0.05);
    for (const [f, q, v] of [[rnd(500, 700), 14, 1], [rnd(1000, 1300), 12, 0.6], [rnd(2000, 2600), 10, 0.3]]) {
      const bp = A.filt('bandpass', f, q); const gg = c.createGain(); gg.gain.value = v * 1.4;
      osc.connect(bp).connect(gg).connect(g);
    }
    g.connect(o);
    osc.start(t); osc.stop(t + dur + 0.2);
    return dur;
  },
  door_close(A, o) { const t = A.ctx.currentTime; thump(A, o, t, 90, 35, 0.2, 0.9); burst(A, o, t, { f: 500, dur: 0.12, vol: 0.5 }); burst(A, o, t + 0.03, { type: 'highpass', f: 3000, dur: 0.03, vol: 0.3 }); return 0.5; },
  door_slam(A, o) { const t = A.ctx.currentTime; thump(A, o, t, 120, 30, 0.35, 1.3); burst(A, o, t, { kind: 'brown', type: 'lowpass', f: 900, dur: 0.4, vol: 1.2 }); burst(A, o, t, { f: 2500, q: 2, dur: 0.06, vol: 0.4 }); return 1; },
  door_locked(A, o) { const t = A.ctx.currentTime; for (let i = 0; i < 3; i++) { burst(A, o, t + i * 0.09, { f: 2200, q: 6, dur: 0.03, vol: 0.4 }); thump(A, o, t + i * 0.09, 160, 90, 0.05, 0.3); } return 0.4; },
  unlock(A, o) { const t = A.ctx.currentTime; burst(A, o, t, { f: 3200, q: 8, dur: 0.03, vol: 0.4 }); tone(A, o, t + 0.12, { type: 'triangle', f: 1800, dur: 0.06, vol: 0.12 }); thump(A, o, t + 0.12, 200, 80, 0.08, 0.5); return 0.4; },
  drawer(A, o) { const t = A.ctx.currentTime; const f = burst(A, o, t, { kind: 'pink', f: 350, q: 2, dur: 0.35, vol: 0.45, a: 0.05 }); f.frequency.linearRampToValueAtTime(700, t + 0.35); thump(A, o, t + 0.36, 100, 50, 0.06, 0.4); return 0.6; },
  pickup(A, o) { const t = A.ctx.currentTime; burst(A, o, t, { kind: 'pink', f: 2000, q: 0.7, dur: 0.1, vol: 0.25, a: 0.02 }); tone(A, o, t + 0.04, { f: 880, dur: 0.12, vol: 0.05 }); return 0.3; },
  key_pickup(A, o) { const t = A.ctx.currentTime; for (let i = 0; i < 4; i++) { tone(A, o, t + i * 0.06, { type: 'triangle', f: rnd(2500, 4200), dur: 0.12, vol: 0.08 }); burst(A, o, t + i * 0.06, { f: 5000, q: 10, dur: 0.02, vol: 0.2 }); } return 0.6; },
  battery(A, o) { const t = A.ctx.currentTime; burst(A, o, t, { f: 3000, q: 4, dur: 0.02, vol: 0.4 }); burst(A, o, t + 0.15, { f: 2400, q: 4, dur: 0.02, vol: 0.4 }); thump(A, o, t + 0.25, 300, 150, 0.04, 0.3); return 0.5; },
  flashlight(A, o) { const t = A.ctx.currentTime; burst(A, o, t, { f: 4000, q: 5, dur: 0.012, vol: 0.5 }); thump(A, o, t, 400, 200, 0.02, 0.2); return 0.2; },
  heal(A, o) { const t = A.ctx.currentTime; burst(A, o, t, { kind: 'pink', f: 1500, q: 0.5, dur: 0.5, vol: 0.2, a: 0.1 }); tone(A, o, t + 0.3, { f: 523, dur: 0.6, vol: 0.05 }); tone(A, o, t + 0.45, { f: 784, dur: 0.6, vol: 0.04 }); return 1; },
  inject(A, o) { const t = A.ctx.currentTime; burst(A, o, t, { type: 'highpass', f: 4000, dur: 0.3, vol: 0.2, a: 0.05 }); thump(A, o, t + 0.35, 60, 40, 0.5, 0.7); thump(A, o, t + 0.75, 60, 40, 0.5, 0.7); return 1.2; },
  fuse_insert(A, o) {
    const c = A.ctx, t = c.currentTime;
    thump(A, o, t, 180, 60, 0.1, 0.8);
    const buzz = c.createOscillator(); buzz.type = 'square'; buzz.frequency.value = 50;
    const lp = A.filt('lowpass', 400); const g = c.createGain(); A.env(g, t + 0.1, 0.01, 0.2, 0.6);
    buzz.connect(lp).connect(g).connect(o); buzz.start(t + 0.1); buzz.stop(t + 0.9);
    for (let i = 0; i < 6; i++) burst(A, o, t + 0.1 + Math.random() * 0.5, { f: 5000, q: 2, dur: 0.01, vol: 0.4 });
    return 1;
  },
  power_down(A, o) {
    const c = A.ctx, t = c.currentTime;
    thump(A, o, t, 150, 40, 0.3, 1.0);
    const hum = c.createOscillator(); hum.type = 'sawtooth'; hum.frequency.setValueAtTime(120, t); hum.frequency.exponentialRampToValueAtTime(18, t + 2.2);
    const lp = A.filt('lowpass', 600); const g = c.createGain(); A.env(g, t, 0.01, 0.25, 2.2);
    hum.connect(lp).connect(g).connect(o); hum.start(t); hum.stop(t + 2.4);
    return 2.5;
  },
  power_up(A, o) {
    const c = A.ctx, t = c.currentTime;
    for (let i = 0; i < 4; i++) burst(A, o, t + i * 0.18, { f: 2000, q: 3, dur: 0.02, vol: 0.5 });
    const hum = c.createOscillator(); hum.type = 'sawtooth'; hum.frequency.setValueAtTime(30, t + 0.4); hum.frequency.exponentialRampToValueAtTime(120, t + 1.6);
    const lp = A.filt('lowpass', 500); const g = c.createGain(); A.env(g, t + 0.4, 0.3, 0.2, 1.5);
    hum.connect(lp).connect(g).connect(o); hum.start(t + 0.4); hum.stop(t + 2.2);
    return 2.2;
  },
  light_buzz(A, o) { const t = A.ctx.currentTime; for (let i = 0; i < 5; i++) { tone(A, o, t + i * rnd(0.03, 0.09), { type: 'square', f: 100, dur: 0.04, vol: 0.05 }); } return 0.5; },
  thunder(A, o, opts) {
    const c = A.ctx, t = c.currentTime, close = opts.close ?? Math.random() < 0.3;
    if (close) burst(A, o, t, { kind: 'white', type: 'highpass', f: 1500, dur: 0.15, vol: 1.2 });
    const s = A.noiseSrc('brown', 0.6); const lp = A.filt('lowpass', close ? 1200 : 500, 0.5);
    lp.frequency.setValueAtTime(close ? 1200 : 500, t); lp.frequency.exponentialRampToValueAtTime(60, t + 5);
    const g = c.createGain(); g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(close ? 2.2 : 1.2, t + (close ? 0.05 : 0.4));
    for (let k = 1; k < 6; k++) g.gain.linearRampToValueAtTime(rnd(0.4, 1.4) * (close ? 1.5 : 0.9) * (1 - k / 7), t + k * 0.7);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 6);
    s.connect(lp).connect(g).connect(o); s.start(t); s.stop(t + 6.2);
    return 6.3;
  },
  heartbeat(A, o, opts) { const t = A.ctx.currentTime, v = opts.intensity ?? 1; thump(A, o, t, 60, 35, 0.12, 0.9 * v); thump(A, o, t + 0.16, 55, 32, 0.14, 0.7 * v); return 0.4; },
  breath_in(A, o, opts) { const t = A.ctx.currentTime, v = opts.intensity ?? 1; const f = burst(A, o, t, { kind: 'pink', f: 1100, q: 1.5, dur: 0.45, vol: 0.18 * v, a: 0.2 }); f.frequency.linearRampToValueAtTime(1600, t + 0.5); return 0.7; },
  breath_out(A, o, opts) { const t = A.ctx.currentTime, v = opts.intensity ?? 1; const f = burst(A, o, t, { kind: 'pink', f: 900, q: 1.2, dur: 0.6, vol: 0.2 * v, a: 0.05 }); f.frequency.linearRampToValueAtTime(600, t + 0.6); return 0.8; },
  gasp(A, o) { const t = A.ctx.currentTime; voice(A, o, t, { pitch: 220, dur: 0.35, vowels: ['a', 'uh'], breath: 1.2, vol: 0.5, a: 0.02, whisper: true }); return 0.7; },
  hurt(A, o) { const t = A.ctx.currentTime; return voice(A, o, t, { pitch: rnd(170, 230), pitchEnd: 120, dur: 0.5, vowels: ['a', 'uh'], breath: 0.6, vol: 0.6, dist: 4 }); },
  death_cry(A, o) { const t = A.ctx.currentTime; return voice(A, o, t, { pitch: 300, pitchEnd: 90, dur: 1.4, vowels: ['a', 'o', 'uh'], breath: 0.8, vol: 0.9, dist: 8, vib: 7, vibAmt: 0.04 }); },
  // ---------------------------------------------------------- ghost voices
  whisper(A, o) {
    const t = A.ctx.currentTime;
    const n = 4 + ((Math.random() * 6) | 0);
    let tt = t;
    for (let i = 0; i < n; i++) {
      const d = rnd(0.08, 0.2);
      voice(A, o, tt, { dur: d, vowels: [pick(['a', 'e', 'i', 'o', 'u']), pick(['a', 'e', 'i', 'o', 'u'])], whisper: true, vol: rnd(0.25, 0.5), a: 0.02, rel: 0.05 });
      tt += d + rnd(0.02, 0.12);
    }
    return tt - t + 0.3;
  },
  wail(A, o) {
    const t = A.ctx.currentTime, d = rnd(2.2, 3.4);
    voice(A, o, t, { pitch: rnd(360, 420), pitchEnd: rnd(260, 300), dur: d, vowels: ['u', 'o', 'a', 'o'], breath: 0.35, vib: 5.5, vibAmt: 0.035, vol: 0.55, a: 0.4, rel: 0.8 });
    voice(A, o, t + 0.05, { pitch: rnd(540, 600), pitchEnd: 380, dur: d * 0.9, vowels: ['u', 'a'], breath: 0.2, vib: 6, vibAmt: 0.03, vol: 0.18, a: 0.5, rel: 0.8 });
    return d + 0.8;
  },
  weep(A, o) {
    const t = A.ctx.currentTime;
    let tt = t;
    for (let i = 0; i < 5; i++) {
      const d = rnd(0.2, 0.45);
      voice(A, o, tt, { pitch: rnd(330, 420), pitchEnd: rnd(250, 300), dur: d, vowels: ['uh', 'u'], breath: 0.7, vib: 9, vibAmt: 0.05, vol: 0.35, a: 0.03, rel: 0.1 });
      tt += d + rnd(0.1, 0.35);
      if (Math.random() < 0.5) { SYNTH.breath_in(A, o, { intensity: 0.8 }); }
    }
    return tt - t;
  },
  scream(A, o, opts) {
    const t = A.ctx.currentTime, base = opts.pitch ?? rnd(520, 700);
    voice(A, o, t, { pitch: base, pitchEnd: base * 0.6, dur: 1.3, vowels: ['a', 'a', 'e'], breath: 0.9, vib: 11, vibAmt: 0.06, vol: 0.9, a: 0.03, dist: 18 });
    voice(A, o, t, { pitch: base * 1.52, pitchEnd: base * 0.9, dur: 1.1, vowels: ['e', 'a'], breath: 0.3, vib: 13, vibAmt: 0.05, vol: 0.35, a: 0.05, dist: 10 });
    burst(A, o, t, { kind: 'white', f: 3000, q: 0.6, dur: 1.2, vol: 0.35, a: 0.02 });
    return 1.6;
  },
  giggle(A, o) {
    const t = A.ctx.currentTime;
    let tt = t, p = rnd(650, 800);
    const n = 5 + ((Math.random() * 3) | 0);
    for (let i = 0; i < n; i++) {
      voice(A, o, tt, { pitch: p, pitchEnd: p * 0.88, dur: 0.1, vowels: ['ee', 'i'], breath: 0.6, vol: 0.45, a: 0.01, rel: 0.05, vib: 0 });
      tt += rnd(0.12, 0.17); p *= 0.95;
    }
    return tt - t + 0.2;
  },
  hum(A, o) { // eerie child lullaby hum
    const t = A.ctx.currentTime;
    const mel = [0, 3, 7, 5, 3, 2, 0, -2, 0];
    let tt = t;
    for (const s of mel) {
      const d = rnd(0.35, 0.55);
      voice(A, o, tt, { pitch: 392 * Math.pow(2, s / 12), dur: d, vowels: ['u'], breath: 0.25, vol: 0.28, a: 0.06, rel: 0.1, vib: 5, vibAmt: 0.01 });
      tt += d;
    }
    return tt - t;
  },
  sob(A, o) { return SYNTH.weep(A, o); },
  growl(A, o) {
    const t = A.ctx.currentTime, d = rnd(1.2, 2.0);
    voice(A, o, t, { pitch: rnd(62, 80), pitchEnd: rnd(55, 70), dur: d, vowels: ['uh', 'o', 'uh'], breath: 0.9, vol: 0.9, a: 0.2, dist: 30, tremolo: rnd(10, 16), vib: 3, vibAmt: 0.05 });
    burst(A, o, t, { kind: 'brown', type: 'lowpass', f: 400, dur: d, vol: 0.5, a: 0.2 });
    return d + 0.4;
  },
  roar(A, o) {
    const t = A.ctx.currentTime;
    voice(A, o, t, { pitch: 90, pitchEnd: 160, dur: 1.6, vowels: ['uh', 'a', 'a'], breath: 1.0, vol: 1.2, a: 0.1, dist: 40, tremolo: 18 });
    voice(A, o, t, { pitch: 180, pitchEnd: 240, dur: 1.4, vowels: ['a'], breath: 0.5, vol: 0.4, a: 0.2, dist: 25 });
    return 2.1;
  },
  chain(A, o) {
    const t = A.ctx.currentTime;
    for (let i = 0; i < 9; i++) {
      const tt = t + i * rnd(0.03, 0.09);
      burst(A, o, tt, { f: rnd(2500, 6000), q: 18, dur: rnd(0.03, 0.08), vol: 0.35 });
      tone(A, o, tt, { type: 'triangle', f: rnd(1800, 3800), dur: 0.1, vol: 0.03 });
    }
    burst(A, o, t, { kind: 'brown', f: 300, q: 1, dur: 0.5, vol: 0.25, a: 0.05 });
    return 0.9;
  },
  cleaver(A, o) { const t = A.ctx.currentTime; burst(A, o, t, { type: 'highpass', f: 3000, dur: 0.18, vol: 0.4, a: 0.05 }); tone(A, o, t + 0.2, { type: 'triangle', f: 1760, dur: 0.8, vol: 0.1 }); thump(A, o, t + 0.2, 200, 60, 0.15, 0.8); return 1; },
  knock(A, o) { const t = A.ctx.currentTime; for (let i = 0; i < 3; i++) { thump(A, o, t + i * 0.28, 140, 70, 0.07, 0.8); burst(A, o, t + i * 0.28, { f: 900, dur: 0.05, vol: 0.4 }); } return 1; },
  whoosh(A, o) { const t = A.ctx.currentTime; const f = burst(A, o, t, { kind: 'pink', f: 300, q: 1, dur: 0.6, vol: 0.5, a: 0.25 }); f.frequency.exponentialRampToValueAtTime(3000, t + 0.5); return 0.9; },
  stinger(A, o) {
    const c = A.ctx, t = c.currentTime;
    for (const semi of [0, 1, 6, 11, 13]) {
      tone(A, o, t, { type: 'sawtooth', f: 110 * Math.pow(2, semi / 12), dur: 1.8, vol: 0.12, a: 0.01, detune: rnd(-15, 15) });
    }
    burst(A, o, t, { kind: 'white', type: 'highpass', f: 800, dur: 0.6, vol: 0.9, a: 0.005 });
    thump(A, o, t, 80, 25, 0.6, 1.5);
    SYNTH.scream(A, o, { pitch: 700 });
    return 2;
  },
  lightning(A, o) { const t = A.ctx.currentTime; burst(A, o, t, { type: 'highpass', f: 2000, dur: 0.12, vol: 0.9, a: 0.002 }); return 0.3; },
  glass_break(A, o) {
    const t = A.ctx.currentTime;
    burst(A, o, t, { type: 'highpass', f: 2500, dur: 0.35, vol: 1.0, a: 0.002 });
    for (let i = 0; i < 18; i++) tone(A, o, t + Math.random() * 0.6, { f: rnd(2500, 7000), dur: rnd(0.05, 0.25), vol: 0.06 });
    return 1;
  },
  wood_break(A, o) { const t = A.ctx.currentTime; burst(A, o, t, { f: 1200, q: 0.7, dur: 0.15, vol: 1.0, a: 0.002 }); thump(A, o, t, 150, 50, 0.2, 0.8); burst(A, o, t + 0.1, { f: 600, dur: 0.3, vol: 0.4 }); return 0.7; },
  piano(A, o, opts) {
    const t = A.ctx.currentTime;
    const notes = opts.notes ?? [pick([0, 1, 6]) + 48, pick([3, 7, 8]) + 48, pick([11, 13]) + 48];
    notes.forEach((m, i) => {
      const f = 440 * Math.pow(2, (m - 69) / 12);
      for (let h = 1; h <= 5; h++) tone(A, o, t + i * (opts.arp ?? 0), { type: 'sine', f: f * h * (1 + 0.0008 * h * h), dur: 2.8 / h, vol: 0.14 / (h * h * 0.7), a: 0.003 });
    });
    return 3.2;
  },
  musicbox(A, o) {
    const t = A.ctx.currentTime;
    const mel = [76, 79, 83, 81, 79, 76, 74, 76, 79, 76, 72, 71, 72, 74, 76];
    mel.forEach((m, i) => {
      const f = 440 * Math.pow(2, (m - 69) / 12);
      const tt = t + i * 0.42 * (1 + i * 0.02); // slowly winding down
      tone(A, o, tt, { type: 'sine', f, dur: 1.2, vol: 0.12, a: 0.002, detune: rnd(-12, 12) });
      tone(A, o, tt, { type: 'sine', f: f * 2.76, dur: 0.4, vol: 0.03, a: 0.001 });
    });
    return mel.length * 0.5 + 1.5;
  },
  clock_tick(A, o) { const t = A.ctx.currentTime; burst(A, o, t, { f: 3500, q: 8, dur: 0.015, vol: 0.25 }); return 0.1; },
  clock_chime(A, o) {
    const t = A.ctx.currentTime;
    for (let i = 0; i < 3; i++) for (const [r, v] of [[1, 0.2], [2.4, 0.08], [3.9, 0.05], [5.4, 0.03]]) tone(A, o, t + i * 1.6, { f: 220 * r, dur: 3.5, vol: v, a: 0.002 });
    return 6;
  },
  car_door(A, o) { const t = A.ctx.currentTime; thump(A, o, t, 110, 45, 0.18, 1.0); burst(A, o, t, { f: 1800, q: 2, dur: 0.05, vol: 0.4 }); return 0.4; },
  car_start(A, o) {
    const c = A.ctx, t = c.currentTime;
    for (let i = 0; i < 6; i++) thump(A, o, t + i * 0.09, 70, 50, 0.05, 0.4);
    const eng = c.createOscillator(); eng.type = 'sawtooth'; eng.frequency.setValueAtTime(28, t + 0.6); eng.frequency.exponentialRampToValueAtTime(55, t + 1.3); eng.frequency.exponentialRampToValueAtTime(34, t + 2.2);
    const lp = A.filt('lowpass', 500); const g = c.createGain(); A.env(g, t + 0.55, 0.1, 0.6, 2.2, 0.3);
    eng.connect(lp).connect(g).connect(o); eng.start(t + 0.55); eng.stop(t + 3);
    return 3;
  },
  ui_hover(A, o) { const t = A.ctx.currentTime; tone(A, o, t, { f: 1900, dur: 0.035, vol: 0.05 }); burst(A, o, t, { f: 4000, q: 4, dur: 0.02, vol: 0.05 }); return 0.1; },
  ui_click(A, o) { const t = A.ctx.currentTime; thump(A, o, t, 160, 50, 0.12, 0.6); burst(A, o, t, { kind: 'pink', type: 'lowpass', f: 900, dur: 0.15, vol: 0.4 }); tone(A, o, t + 0.02, { f: 220, glide: 110, dur: 0.2, vol: 0.08 }); return 0.4; },
  ui_back(A, o) { const t = A.ctx.currentTime; thump(A, o, t, 120, 60, 0.1, 0.4); return 0.2; },
  item_use(A, o) { return SYNTH.pickup(A, o); },
  crucifix(A, o) { const t = A.ctx.currentTime; for (const f of [523, 659, 784, 1046]) tone(A, o, t, { f, dur: 2, vol: 0.06, a: 0.3 }); burst(A, o, t, { kind: 'pink', f: 3000, q: 0.5, dur: 1.2, vol: 0.2, a: 0.1 }); return 2.5; },
  vanish(A, o) { const t = A.ctx.currentTime; const f = burst(A, o, t, { kind: 'pink', f: 2000, q: 2, dur: 0.8, vol: 0.4, a: 0.02 }); f.frequency.exponentialRampToValueAtTime(200, t + 0.8); tone(A, o, t, { type: 'sine', f: 800, glide: 60, dur: 0.9, vol: 0.12 }); return 1; },
};

// ============================================================================ loops
function makeLoop(A, bus = 'amb') {
  const g = A.ctx.createGain(); g.gain.value = 0.0001; g.connect(A.bus[bus]);
  return g;
}

const LOOPS = {
  rain(A) {
    const c = A.ctx;
    const g = makeLoop(A);
    const s = A.noiseSrc('pink'); const hp = A.filt('highpass', 500); const lp = A.filt('lowpass', 7000);
    const sg = c.createGain(); sg.gain.value = 0.45;
    s.connect(hp).connect(lp).connect(sg).connect(g); s.start();
    const s2 = A.noiseSrc('brown'); const lp2 = A.filt('lowpass', 250); const g2 = c.createGain(); g2.gain.value = 0.35;
    s2.connect(lp2).connect(g2).connect(g); s2.start();
    let alive = true;
    const drops = () => {
      if (!alive) return;
      const t = c.currentTime;
      for (let i = 0; i < 6; i++) burst(A, g, t + Math.random() * 0.25, { f: rnd(2500, 6500), q: 6, dur: 0.01, vol: rnd(0.05, 0.2) });
      setTimeout(drops, 250);
    };
    drops();
    return { gain: g, set: (muffle) => lp.frequency.setTargetAtTime(muffle ? 1400 : 7000, c.currentTime, 0.3), stop: () => { alive = false; g.gain.setTargetAtTime(0, c.currentTime, 0.5); setTimeout(() => { s.stop(); s2.stop(); }, 3000); } };
  },
  wind(A) {
    const c = A.ctx, g = makeLoop(A);
    const s = A.noiseSrc('brown'); const bp = A.filt('bandpass', 320, 1.4);
    const lfo = c.createOscillator(); lfo.frequency.value = 0.07; const lg = c.createGain(); lg.gain.value = 180;
    lfo.connect(lg).connect(bp.frequency); lfo.start();
    const vg = c.createGain(); vg.gain.value = 0.8;
    const lfo2 = c.createOscillator(); lfo2.frequency.value = 0.11; const lg2 = c.createGain(); lg2.gain.value = 0.4;
    lfo2.connect(lg2).connect(vg.gain); lfo2.start();
    s.connect(bp).connect(vg).connect(g); s.start();
    return { gain: g, stop: () => { g.gain.setTargetAtTime(0, c.currentTime, 0.6); setTimeout(() => { s.stop(); lfo.stop(); lfo2.stop(); }, 3000); } };
  },
  drone(A) {
    const c = A.ctx, g = makeLoop(A, 'music');
    const oscs = [];
    for (const [f, type, v] of [[55, 'sawtooth', 0.12], [55.4, 'sawtooth', 0.12], [36.7, 'sine', 0.35], [82.4, 'triangle', 0.05]]) {
      const o = c.createOscillator(); o.type = type; o.frequency.value = f;
      const og = c.createGain(); og.gain.value = v; o.connect(og).connect(g); o.start(); oscs.push(o);
    }
    const lp = A.filt('lowpass', 220);
    g.disconnect(); g.connect(lp).connect(A.bus.music);
    const lfo = c.createOscillator(); lfo.frequency.value = 0.05; const lg = c.createGain(); lg.gain.value = 120;
    lfo.connect(lg).connect(lp.frequency); lfo.start(); oscs.push(lfo);
    let alive = true;
    const creaks = () => { // distant house sounds
      if (!alive) return;
      const r = Math.random();
      const o = A.out({ bus: 'amb', reverb: 0.6, vol: 0.25 });
      if (r < 0.35) SYNTH.door_creak(A, o, { dur: rnd(0.6, 1.4) });
      else if (r < 0.55) SYNTH.knock(A, o);
      else if (r < 0.75) SYNTH.whisper(A, o);
      else thump(A, o, c.currentTime, 60, 30, 0.4, 0.8);
      setTimeout(creaks, rnd(9000, 22000));
    };
    setTimeout(creaks, 6000);
    return { gain: g, stop: () => { alive = false; g.gain.setTargetAtTime(0, c.currentTime, 0.8); setTimeout(() => oscs.forEach((o) => o.stop()), 4000); } };
  },
  chase(A) {
    const c = A.ctx, g = makeLoop(A, 'music');
    const oscs = [];
    const low = c.createGain(); low.gain.value = 0;
    for (const f of [55, 58.27, 41.2]) { const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; o.connect(low); o.start(); oscs.push(o); }
    const lp = A.filt('lowpass', 350, 4); low.connect(lp).connect(g);
    const puls = c.createOscillator(); puls.type = 'square'; puls.frequency.value = 4.2;
    const pg = c.createGain(); pg.gain.value = 0.35; puls.connect(pg).connect(low.gain); puls.start(); oscs.push(puls);
    const hi = c.createGain(); hi.gain.value = 0.0;
    for (const f of [880, 932.3]) { const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; o.connect(hi); o.start(); oscs.push(o); }
    const trem = c.createOscillator(); trem.frequency.value = 13; const tg = c.createGain(); tg.gain.value = 0.03;
    trem.connect(tg).connect(hi.gain); trem.start(); oscs.push(trem);
    const hbp = A.filt('bandpass', 1200, 1.5); hi.connect(hbp).connect(g);
    return {
      gain: g,
      set: (x) => { puls.frequency.setTargetAtTime(3 + x * 3, c.currentTime, 0.5); lp.frequency.setTargetAtTime(250 + x * 600, c.currentTime, 0.4); tg.gain.setTargetAtTime(0.02 + x * 0.05, c.currentTime, 0.4); },
      stop: () => { g.gain.setTargetAtTime(0, c.currentTime, 1.2); setTimeout(() => oscs.forEach((o) => o.stop()), 5000); },
    };
  },
  menu(A) {
    const c = A.ctx, g = makeLoop(A, 'music');
    let alive = true;
    const scale = [45, 48, 52, 53, 57, 60, 64]; // A minor-ish
    const play = () => {
      if (!alive) return;
      const n = pick(scale);
      const o = A.out({ bus: 'music', reverb: 0.8, vol: 1 });
      o.disconnect(); o.connect(g);
      const rv = c.createGain(); rv.gain.value = 0.9; o.connect(rv).connect(A.reverb);
      SYNTH.piano(A, o, { notes: Math.random() < 0.3 ? [n, n + 3] : [n], arp: 0.25 });
      setTimeout(play, rnd(1800, 4200));
    };
    const d = LOOPS.drone(A);
    d.gain.gain.value = 0.5;
    d.gain.disconnect(); d.gain.connect(g);
    play();
    return { gain: g, stop: () => { alive = false; d.stop(); g.gain.setTargetAtTime(0, c.currentTime, 0.8); } };
  },
  heartbeat(A) {
    const c = A.ctx, g = makeLoop(A, 'sfx');
    let alive = true, rate = 1;
    const beat = () => {
      if (!alive) return;
      SYNTH.heartbeat(A, g, { intensity: 1 });
      setTimeout(beat, 60000 / (60 + rate * 90));
    };
    beat();
    return { gain: g, set: (x) => { rate = x; }, stop: () => { alive = false; g.gain.setTargetAtTime(0, c.currentTime, 0.4); } };
  },
  electric_hum(A) {
    const c = A.ctx, g = makeLoop(A);
    const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = 60;
    const lp = A.filt('lowpass', 300); const og = c.createGain(); og.gain.value = 0.05;
    o.connect(lp).connect(og).connect(g); o.start();
    return { gain: g, stop: () => { g.gain.setTargetAtTime(0, c.currentTime, 0.3); setTimeout(() => o.stop(), 2000); } };
  },
  car(A) {
    const c = A.ctx, g = makeLoop(A);
    const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = 34;
    const o2 = c.createOscillator(); o2.type = 'square'; o2.frequency.value = 68;
    const lp = A.filt('lowpass', 380); const og = c.createGain(); og.gain.value = 0.4; const og2 = c.createGain(); og2.gain.value = 0.08;
    o.connect(og).connect(lp); o2.connect(og2).connect(lp); lp.connect(g); o.start(); o2.start();
    return { gain: g, set: (rev) => { o.frequency.setTargetAtTime(30 + rev * 60, c.currentTime, 0.3); o2.frequency.setTargetAtTime(60 + rev * 120, c.currentTime, 0.3); lp.frequency.setTargetAtTime(300 + rev * 900, c.currentTime, 0.3); }, stop: () => { g.gain.setTargetAtTime(0, c.currentTime, 1.5); setTimeout(() => { o.stop(); o2.stop(); }, 6000); } };
  },
};

export const audio = new AudioEngine();
export { SYNTH, LOOPS };
