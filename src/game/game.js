// Game session: owns the scene and runs every system for one match (solo = host with no peers).
// Host-authoritative rules: every state change goes through act() -> host handleAction() -> emit() -> applyEvent().
import * as THREE from 'three';
import { settings, quality } from '../core/settings.js';
import { input } from '../core/input.js';
import { audio } from '../audio/audio.js';
import { RNG, clamp, damp, lerp, smoothstep } from '../core/util.js';
import { MAPS, GHOST_TYPES } from '../world/maps.js';
import { World } from '../world/world.js';
import { FH } from '../world/level.js';
import { LocalPlayer } from './player.js';
import { Avatar } from './avatar.js';
import { Ghost, S as GS, GHOST_DEF } from './ghost.js';
import { ITEMS, NOTES, KEY_IDS } from './items.js';
import { EscapeCutscene } from './cutscene.js';

const SNAP_HZ = 15, STATE_HZ = 20;
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3();

// ============================================================================ remote player (third person)
class RemotePlayer {
  constructor(game, rec) {
    this.game = game;
    this.rec = rec;
    this.avatar = new Avatar('player', { profile: rec.profile });
    game.scene.add(this.avatar.root);
    this.avatar.play('Idle');
    this.buf = [];
    this.stepD = 0;
    this.lastPos = new THREE.Vector3();
    this.spot = game.remoteSpots.pop() || null;
    this.label = this._label(rec.name);
    game.scene.add(this.label);
  }

  _label(name) {
    const cv = document.createElement('canvas'); cv.width = 256; cv.height = 64;
    const g = cv.getContext('2d');
    g.font = '28px "Special Elite", monospace'; g.textAlign = 'center';
    g.fillStyle = 'rgba(0,0,0,0.55)'; g.fillRect(28, 12, 200, 40);
    g.fillStyle = '#e8dcc8'; g.fillText(name.slice(0, 14), 128, 42);
    const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace;
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthTest: true, transparent: true, fog: true }));
    sp.scale.set(0.9, 0.225, 1);
    return sp;
  }

  push(s, t) {
    this.buf.push({ s, t });
    if (this.buf.length > 20) this.buf.shift();
  }

  update(dt) {
    const g = this.game, r = this.rec;
    // interpolate ~100 ms in the past
    const rt = performance.now() - 110;
    let a = null, b = null;
    for (let i = this.buf.length - 1; i >= 0; i--) { if (this.buf[i].t <= rt) { a = this.buf[i]; b = this.buf[i + 1] || a; break; } }
    if (!a && this.buf.length) a = b = this.buf[0];
    if (a) {
      const k = b === a ? 0 : clamp((rt - a.t) / (b.t - a.t), 0, 1);
      const sa = a.s, sb = b.s;
      r.pos.set(lerp(sa[0], sb[0], k), lerp(sa[1], sb[1], k), lerp(sa[2], sb[2], k));
      let dy = sb[3] - sa[3]; while (dy > Math.PI) dy -= Math.PI * 2; while (dy < -Math.PI) dy += Math.PI * 2;
      r.yaw = sa[3] + dy * k;
      r.pitch = lerp(sa[4], sb[4], k);
      r.layer = sb[5];
      const f = sb[6];
      r.crouch = !!(f & 1); r.flashOn = !!(f & 2); r.sprint = !!(f & 4); r.slide = !!(f & 8); r.talking = !!(f & 16);
      r.holdingBreath = !!(f & 32); r.crucifix = (f >> 8) & 15;
      r.speed = sb[7];
      r.health = sb[8];
      r.vel.set((sb[0] - sa[0]) / Math.max(0.01, (b.t - a.t) / 1000), 0, (sb[2] - sa[2]) / Math.max(0.01, (b.t - a.t) / 1000));
      r.flashDir.set(-Math.sin(r.yaw) * Math.cos(r.pitch), Math.sin(r.pitch), -Math.cos(r.yaw) * Math.cos(r.pitch));
    }
    const av = this.avatar;
    const vis = r.alive && !r.hidden;
    av.root.visible = vis || r.caught;
    this.label.visible = vis;
    if (this.spot) this.spot.visible = vis && r.flashOn;
    if (!av.root.visible) return;
    av.root.position.copy(r.pos);
    av.root.rotation.y = r.yaw + Math.PI;
    let anim = 'Idle', sp = 1;
    if (r.caught) anim = 'Caught';
    else if (r.slide) anim = 'Slide';
    else if (r.crouch) { anim = r.speed > 0.2 ? 'CrouchWalk' : 'CrouchIdle'; sp = Math.max(0.6, r.speed / 1.0); }
    else if (r.speed > 3.2) { anim = 'Run'; sp = r.speed / 4.2; }
    else if (r.speed > 0.2) { anim = 'Walk'; sp = r.speed / 1.5; }
    av.play(anim, { fade: 0.2, once: anim === 'Caught' });
    if (anim !== 'Caught') av.setSpeed(sp);
    av.aim = r.caught ? null : { dir: r.flashDir.clone(), weight: 1 };
    av.update(dt);
    av.setFlashlightOn(r.flashOn);
    this.label.position.set(r.pos.x, r.pos.y + (r.crouch ? 1.25 : 2.0), r.pos.z);
    if (this.spot) {
      const tip = av.attach.flashTip || av.attach.flashlight;
      if (tip) tip.getWorldPosition(this.spot.position); else this.spot.position.copy(r.eye);
      this.spot.target.position.copy(this.spot.position).addScaledVector(r.flashDir, 5);
      this.spot.target.updateMatrixWorld();
      this.spot.intensity = r.flashOn ? 40 : 0;
    }
    // their footsteps, spatialised
    const moved = this.lastPos.distanceTo(r.pos);
    this.lastPos.copy(r.pos);
    if (r.speed > 0.3 && moved < 2) {
      this.stepD += moved;
      const stride = r.crouch ? 0.55 : r.sprint ? 1.05 : 0.72;
      if (this.stepD > stride) {
        this.stepD = 0;
        const room = g.level.roomAt(r.pos.x, r.pos.z, r.layer);
        const muffle = !g.level.los(r.eye, g.listenerPos());
        audio.play('footstep', { pos: r.pos.clone(), surface: room ? room.surface : 'wood', intensity: r.crouch ? 0.35 : r.sprint ? 1.2 : 0.7, vol: 0.9, muffle });
      }
    }
    // proximity voice
    if (this.voice) {
      const p = this.voice.panner;
      const e = r.eye;
      p.positionX.value = e.x; p.positionY.value = e.y; p.positionZ.value = e.z;
      const occl = !g.level.los(e, g.listenerPos());
      this.voice.lp.frequency.value = occl ? 1200 : 18000;
    }
  }

  dispose() {
    this.avatar.dispose();
    this.label.removeFromParent();
    if (this.spot) { this.spot.intensity = 0; this.game.remoteSpots.push(this.spot); }
    if (this.voice) { try { this.voice.src.disconnect(); this.voice.el.remove(); } catch (_) { /* noop */ } }
  }
}

// ============================================================================ game
export class Game {
  constructor(app, config, net) {
    this.app = app;
    this.config = config;
    this.net = net;
    this.isHost = !net || net.isHost;
    this.seed = config.seed;
    this.def = MAPS[config.map];
    this.renderer = app.renderer;
    this.hud = app.hud;
    this.hud.subsOn = settings.subtitles;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(settings.fov, innerWidth / innerHeight, 0.05, 120);
    this.time = 0;
    this.noises = [];
    this.players = [];
    this.remotes = new Map();
    this.ghosts = [];
    this.heat = [];
    this.aggression = 0;
    this.hunt = 0;
    this.ghostNear = 0;
    this.fear = 0;
    this.inv = [null, null, null, null, null, null];
    this.sel = 0;
    this.obj = { keys: { brass: false, iron: false, silver: false }, padlocks: { brass: true, iron: true, silver: true }, power: true, fuse: false, breaker: true, outage: false, gateOpen: false, seenGate: false };
    this.stats = { start: 0, caught: 0, items: 0, notes: 0, dist: 0 };
    this.paused = false;
    this.ended = false;
    this.phase = 'play';
    this.hurtSlow = 0;
    this.dmgFx = 0;
    this.lastSnap = 0; this.lastState = 0;
    this.rng = new RNG(config.seed ^ 0x9e3779b9);
    this.director = { outageAt: 80 + this.rng.next() * 35, huntAt: 170 + this.rng.next() * 60, scareAt: 30 + this.rng.next() * 20, huntEnd: 0 };
    this.remoteSpots = [];
    this.caughtSeq = null;
    this.spectating = null;
    this.readNotes = new Set();
  }

  // ========================================================================== setup
  async load(progress) {
    const scene = this.scene;
    scene.fog = new THREE.FogExp2(this.def.fog, 0.055);
    scene.background = new THREE.Color(this.def.fog);
    this.ambient = new THREE.AmbientLight(0x9aa6c0, 0.05);
    this.moon = new THREE.DirectionalLight(0x7f90b8, 0.12);
    this.moon.position.set(-20, 30, -10);
    scene.add(this.ambient, this.moon);
    this.world = new World(this);
    await this.world.build(this.def, this.seed, progress);
    this.level = this.world.level;
    this.heat = new Array(this.level.rooms.length).fill(0);
    // drawers / hide spots get global ids (identical on every peer)
    this.drawers = []; this.hideSpots = [];
    for (const r of this.level.rooms) {
      for (const e of r.interact) {
        if (e.kind === 'drawer' && !this.drawers.includes(e.ref)) { e.ref.id = this.drawers.length; this.drawers.push(e.ref); }
        if (e.kind === 'hide' && !this.hideSpots.includes(e.ref)) { e.ref.id = this.hideSpots.length; this.hideSpots.push(e.ref); }
      }
    }
    for (const dr of this.drawers) { dr.open = 0; dr.target = 0; }
    for (const hs of this.hideSpots) { hs.open = 0; hs.target = 0; hs.openT = 0; }
    this.fuseBox = this.level.rooms.find((r) => r.fuseBox)?.fuseBox || null;
    if (this.fuseBox) this.fuseBox.hasFuse = true;
    this.cases = this.level.rooms.flatMap((r) => r.cases || []);
    this.cases.forEach((c, i) => { c.id = i; });
    progress(0.75, 'Waking the dead…');
    // spot lights reserved for remote players' torches (constant light count = no shader recompiles)
    for (let i = 0; i < 4; i++) {
      const s = new THREE.SpotLight(0xfff1d8, 0, 22, 0.5, 0.5, 1.6);
      s.castShadow = false;
      scene.add(s, s.target);
      this.remoteSpots.push(s);
    }
    // players
    const me = this.config.localId;
    const spawnRoom = this.level.byId[this.def.spawn.room];
    this.config.players.forEach((p, i) => {
      const rec = {
        id: p.id, name: p.name, profile: p.profile, isLocal: p.id === me,
        pos: new THREE.Vector3(), vel: new THREE.Vector3(), yaw: Math.PI, pitch: 0, layer: 0,
        alive: true, caught: false, lives: this.config.lives, health: 100, flashOn: true, flashDir: new THREE.Vector3(0, 0, -1),
        crouch: false, sprint: false, slide: false, speed: 0, hidden: false, hideSpot: null, holdingBreath: false, talking: false, crucifix: 0,
        room: null, stepAcc: 0,
      };
      Object.defineProperty(rec, 'eye', { get() { return new THREE.Vector3(this.pos.x, this.pos.y + (this.crouch ? 0.75 : 1.6), this.pos.z); } });
      const sp = this.level.randomPoint(new RNG(this.seed + i * 7), spawnRoom);
      rec.pos.set(sp.x, sp.y, sp.z);
      this.players.push(rec);
      if (rec.isLocal) this.localRec = rec;
    });
    this.local = new LocalPlayer(this, this.localRec.profile);
    this.local.spawn({ x: this.localRec.pos.x, y: this.localRec.pos.y, z: this.localRec.pos.z, l: 0 }, 0);
    for (const rec of this.players) if (!rec.isLocal) this.remotes.set(rec.id, new RemotePlayer(this, rec));
    // ghosts: brains on the host, bodies everywhere
    this.config.ghosts.forEach((type, i) => {
      const g = new Ghost(this, type, i, this.isHost);
      g.setState(GS.dormant, 22 + i * 28 + this.rng.next() * 8);
      g.pos.set(0, -100, 0);
      this.ghosts.push(g);
    });
    // phantom (client-only apparitions)
    this.phantom = new Avatar(this.config.ghosts[0] || 'widow');
    this.phantom.setDissolve(1);
    scene.add(this.phantom.root);
    this.phantomT = 0;
    // highlight shell for the objective item + focus
    this._initHighlight();
    progress(0.85, 'Compiling shaders…');
    this.renderer.setup(scene, this.camera);
    await this.renderer.precompile(scene, this.camera);
    progress(0.95, 'Listening…');
    this._wireNet();
    this.objectivesChanged();
    return this;
  }

  _initHighlight() {
    this.hl = new THREE.Group();
    this.scene.add(this.hl);
    this.hlMat = new THREE.MeshBasicMaterial({ color: 0xffc46a, transparent: true, opacity: 0.35, side: THREE.BackSide, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
    this.hlMatFront = new THREE.MeshBasicMaterial({ color: 0xffd28a, transparent: true, opacity: 0.55, side: THREE.BackSide, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
    this.hlTarget = null;
  }

  /** Glowing inverted-hull outline around an object (fuse during a blackout, targeted items). */
  setHighlight(obj, strong = false) {
    if (this.hlTarget === obj && this.hlStrong === strong) return;
    this.hl.clear();
    this.hlTarget = obj; this.hlStrong = strong;
    if (!obj) return;
    obj.updateMatrixWorld(true);
    obj.traverse((o) => {
      if (!o.isMesh) return;
      for (const [mat, sc] of [[this.hlMatFront, 1.12], ...(strong ? [[this.hlMat, 1.22]] : [])]) {
        const m = new THREE.Mesh(o.geometry, mat);
        m.matrixAutoUpdate = false;
        m.userData.src = o; m.userData.sc = sc;
        m.renderOrder = 998;
        this.hl.add(m);
      }
    });
  }

  _updateHighlight() {
    const t = this.time;
    this.hlMatFront.opacity = 0.28 + Math.sin(t * 4) * 0.12;
    this.hlMat.opacity = 0.22 + Math.sin(t * 4) * 0.1;
    for (const m of this.hl.children) {
      const src = m.userData.src;
      src.updateWorldMatrix(true, false);
      if (!src.geometry.boundingSphere) src.geometry.computeBoundingSphere();
      const c = src.geometry.boundingSphere.center;
      const s = m.userData.sc;
      // scale about the geometry centre so the shell wraps the item evenly
      m.matrix.copy(src.matrixWorld).multiply(new THREE.Matrix4().makeTranslation(c.x, c.y, c.z)).multiply(new THREE.Matrix4().makeScale(s, s, s)).multiply(new THREE.Matrix4().makeTranslation(-c.x, -c.y, -c.z));
      m.matrixWorld.copy(m.matrix);
    }
  }

  // ========================================================================== networking
  _wireNet() {
    const net = this.net;
    if (!net) return;
    net.on('st', (m, from) => { if (this.isHost) { const r = this.remotes.get(from); if (r) r.push(m.s, performance.now()); } });
    net.on('act', (m, from) => { if (this.isHost) this.handleAction(from, m.a); });
    net.on('snap', (m) => {
      if (this.isHost) return;
      const now = performance.now();
      m.g.forEach((s, i) => { const g = this.ghosts[i]; if (g) g.applyNet(s, now); });
      for (const [id, s] of m.p) { if (id === this.localRec.id) continue; const r = this.remotes.get(id); if (r) r.push(s, now); }
      this.hunt = m.h; this.aggression = m.a;
    });
    net.on('ev', (m) => { if (!this.isHost) this.applyEvent(m.e); });
    net.on('leave', (id) => {
      if (!this.isHost) return;
      const r = this.remotes.get(id);
      if (r) this.emit({ k: 'left', pid: id });
    });
    net.on('hostLost', () => { if (!this.ended) this.app.abort('The host left the game.'); });
    net.on('voice', (peerId, stream) => this._attachVoice(peerId, stream));
    if (settings.voiceChat) {
      net.enableMic().then((s) => { if (s) setTimeout(() => net.callPeers(this.players.map((p) => p.id).filter((id) => id !== this.localRec.id)), 1500); });
    }
  }

  _attachVoice(peerId, stream) {
    const r = this.remotes.get(peerId);
    if (!r || !audio.ctx) return;
    const el = document.createElement('audio'); el.srcObject = stream; el.muted = true; el.play().catch(() => {});
    document.body.appendChild(el);
    const c = audio.ctx;
    const src = c.createMediaStreamSource(stream);
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 18000;
    const panner = c.createPanner(); panner.panningModel = 'HRTF'; panner.distanceModel = 'inverse'; panner.refDistance = 2; panner.rolloffFactor = 1.2; panner.maxDistance = 40;
    const g = c.createGain(); g.gain.value = 1.4;
    src.connect(lp).connect(panner).connect(g).connect(audio.bus.voice);
    r.voice = { el, src, lp, panner };
  }

  /** Send a gameplay action to the authority. */
  act(a) {
    if (this.isHost) this.handleAction(this.localRec.id, a);
    else this.net.send({ t: 'act', a });
  }

  /** Host: apply + broadcast an event. */
  emit(e) {
    this.applyEvent(e);
    if (this.net && this.isHost) this.net.broadcast({ t: 'ev', e });
  }

  playerById(id) { return this.players.find((p) => p.id === id); }
  localPlayerRec() { return this.localRec && this.localRec.alive ? this.localRec : null; }
  listenerPos() { return this.camera.position; }
  isRoomSealed(r) { return r.doors.every((d) => d.locked === 'inside' || d.kind === 'vent' && d.barricaded || d.kind === 'arch' && false); }

  nearestPlayer(p, aliveOnly) {
    let best = null, bd = 1e9;
    for (const r of this.players) {
      if (aliveOnly && (!r.alive || r.caught)) continue;
      const d = r.pos.distanceTo(p);
      if (d < bd) { bd = d; best = r; }
    }
    return best;
  }

  // ========================================================================== host: actions
  handleAction(pid, a) {
    const p = this.playerById(pid);
    if (!p) return;
    const L = this.level, W = this.world;
    switch (a.k) {
      case 'noise': this._pushNoise(new THREE.Vector3(a.x, a.y, a.z), a.r, a.l ?? L.layerOfY(a.y + 0.5), a.s); break;
      case 'door': {
        const d = L.doors[a.d];
        if (!d || d.locked || d.kind === 'gate' || d.kind === 'arch' || d.kind === 'vent') return;
        const open = !d.open || d.target === 0 && d.angle > 0 ? !(d.target > 0) : false;
        this.emit({ k: 'door', d: d.id, open: a.open ?? open, sw: W.doorSide(d, p.pos), fast: !!a.fast });
        this._pushNoise(new THREE.Vector3(d.x, d.y + 1, d.z), a.fast ? 16 : 6, d.layer, 'door');
        break;
      }
      case 'unlock': {
        const d = L.doors[a.d];
        if (!d || d.locked !== 'inside') return;
        this.emit({ k: 'unlock', d: d.id });
        break;
      }
      case 'vent': {
        const d = L.doors[a.d];
        if (!d || !d.barricaded) return;
        this.emit({ k: 'vent', d: d.id });
        this._pushNoise(new THREE.Vector3(d.x, d.y + 0.5, d.z), 15, d.layer, 'break');
        break;
      }
      case 'drawer': {
        const dr = this.drawers[a.i];
        if (!dr) return;
        this.emit({ k: 'drawer', i: a.i, open: !(dr.target > 0) });
        break;
      }
      case 'pickup': {
        const it = W.items[a.i];
        if (!it || it.taken) return;
        this.emit({ k: 'taken', i: a.i, pid });
        if (ITEMS[it.type].key) this.emit({ k: 'key', key: ITEMS[it.type].key, pid });
        if (it.lure) this.emit({ k: 'lureStop', i: a.i });
        break;
      }
      case 'drop': {
        const id = W.items.length;
        this.emit({ k: 'spawn', i: id, type: a.type, x: a.x, y: a.y, z: a.z, lure: !!a.lure });
        if (a.lure) this.lures = [...(this.lures || []), { i: id, until: this.time + 22, next: 0 }];
        break;
      }
      case 'hide': {
        const hs = this.hideSpots[a.h];
        if (!hs) return;
        if (a.enter) {
          if (hs.occupant && hs.occupant !== pid) return;
          this.emit({ k: 'hide', h: a.h, pid, enter: true });
        } else if (hs.occupant === pid) this.emit({ k: 'hide', h: a.h, pid, enter: false });
        break;
      }
      case 'fuse': {
        if (this.obj.fuse || !this.obj.outage) return;
        this.emit({ k: 'obj', o: { fuse: true, power: true, breaker: true } });
        this.emit({ k: 'power', on: true, why: 'fuse', pid });
        break;
      }
      case 'lever': {
        if (!this.obj.fuse && this.obj.outage) return;
        if (this.obj.breaker) return;
        this.emit({ k: 'obj', o: { breaker: true, power: true } });
        this.emit({ k: 'power', on: true, why: 'lever', pid });
        break;
      }
      case 'case': {
        const c = this.cases[a.c];
        if (!c || c.broken) return;
        this.emit({ k: 'case', c: a.c });
        this._pushNoise(c.itemPos.clone(), 30, L.layerOfY(c.itemPos.y), 'glass');
        break;
      }
      case 'gate': {
        const o = this.obj;
        const using = KEY_IDS.filter((k) => o.keys[k] && o.padlocks[k]);
        if (using.length) { for (const k of using) this.emit({ k: 'padlock', key: k, pid }); this._pushNoise(new THREE.Vector3(L.gate.x, 1, L.gate.z), 10, 0, 'gate'); return; }
        if (KEY_IDS.every((k) => !o.padlocks[k]) && !o.gateOpen) this.emit({ k: 'escape', pid });
        break;
      }
      case 'seen-gate': if (!this.obj.seenGate) this.emit({ k: 'obj', o: { seenGate: true } }); break;
      case 'piano': this.emit({ k: 'piano', x: a.x, y: a.y, z: a.z }); this._pushNoise(new THREE.Vector3(a.x, a.y, a.z), 16, L.layerOfY(a.y), 'piano'); break;
      case 'hp': p.health = clamp(a.v, 0, 100); break;
      case 'crucifixUsed': break;
      default: break;
    }
  }

  _pushNoise(pos, r, l, src) {
    this.noises.push({ pos, r, l, t: this.time, src });
  }

  makeNoise(pos, r, src) {
    const a = { k: 'noise', x: pos.x, y: pos.y, z: pos.z, r, s: src, l: this.local ? this.local.layer : 0 };
    if (this.isHost) this.handleAction(this.localRec.id, a);
    else this.net.send({ t: 'act', a });
  }

  // ========================================================================== all peers: events
  applyEvent(e) {
    const L = this.level, W = this.world;
    const me = this.localRec;
    switch (e.k) {
      case 'door': {
        const d = L.doors[e.d];
        if (!d) return;
        d.swing = e.sw || 1;
        W.setDoor(d, e.open, null, e.fast);
        if (e.open) this.sfx(e.fast ? 'door_slam' : 'door_creak', { x: d.x, y: d.y + 1.2, z: d.z }, { dur: e.fast ? undefined : 0.7 + Math.random() * 0.8 });
        break;
      }
      case 'unlock': {
        const d = L.doors[e.d];
        d.locked = null;
        if (d.collider) d.collider.enabled = !d.open;
        this.sfx('unlock', { x: d.x, y: d.y + 1, z: d.z });
        break;
      }
      case 'vent': {
        const d = L.doors[e.d];
        W.breakVent(d);
        this.sfx('wood_break', { x: d.x, y: d.y + 0.4, z: d.z });
        break;
      }
      case 'drawer': {
        const dr = this.drawers[e.i];
        dr.target = e.open ? 1 : 0;
        this.sfx('drawer', dr.obj.getWorldPosition(new THREE.Vector3()));
        break;
      }
      case 'taken': {
        const it = W.items[e.i];
        if (!it || it.taken) return;
        it.taken = true;
        it.obj.removeFromParent();
        if (it.lure && it.lureSound) { it.lureSound.stop(); it.lure = false; }
        if (this.hlTarget === it.obj) this.setHighlight(null);
        if (e.pid === me.id) this._gainItem(it);
        break;
      }
      case 'spawn': {
        const def = ITEMS[e.type];
        const spot = { pos: new THREE.Vector3(e.x, e.y, e.z), kind: 'floor', room: L.roomAt(e.x, e.z, L.layerOfY(e.y + 0.5)) };
        while (W.items.length < e.i) W.items.push({ id: W.items.length, taken: true, obj: new THREE.Object3D(), type: 'battery' });
        const it = W._spawnItem(e.type, spot, this.rng, {});
        it.id = e.i;
        W.items[e.i] = it;
        W.interactables.push({ kind: 'item', ref: it, pos: null, radius: 2.1 });
        void def;
        if (e.lure) {
          it.lure = true;
          it.lureSound = null;
          it.lureUntil = this.time + 22;
          this.hud.subtitle('<i>♪</i> the music box plays…', 3);
        }
        break;
      }
      case 'lureStop': { const it = W.items[e.i]; if (it) it.lure = false; break; }
      case 'hide': {
        const hs = this.hideSpots[e.h];
        const p = this.playerById(e.pid);
        if (e.enter) {
          hs.occupant = e.pid;
          if (p) { p.hidden = true; p.hideSpot = hs; }
          hs.openT = 0.9; hs.target = 1;
          this.sfx('door_creak', hs.pos, { dur: 0.5 });
          if (e.pid === me.id) this.local.enterHide(hs);
        } else {
          hs.occupant = null;
          if (p) { p.hidden = false; p.hideSpot = null; }
          hs.openT = 0.8; hs.target = 1;
          this.sfx('door_creak', hs.pos, { dur: 0.45 });
          if (e.pid === me.id) this.local.exitHide();
        }
        break;
      }
      case 'hideOpen': {
        const hs = this.hideSpots[e.h];
        hs.target = e.open ? 1 : 0; hs.openT = 0;
        this.sfx(e.open ? 'door_slam' : 'door_close', hs.pos);
        break;
      }
      case 'power': {
        this.obj.power = e.on;
        W.setPower(e.on);
        this.sfx(e.on ? 'power_up' : 'power_down', this.fuseBox ? this.fuseBox.slot : this.camera.position, { vol: 1.2 });
        if (!e.on) {
          audio.play('power_down', { vol: 0.8 });
          this.hud.notify(e.why === 'outage' ? 'The power has gone out' : 'The breaker tripped', 3.5);
          this.scene.fog.density = 0.075;
        } else {
          this.hud.notify('Power restored', 2.5);
          this.scene.fog.density = 0.055;
          if (this.fuseBox && e.why === 'fuse') { this.fuseBox.hasFuse = true; }
        }
        if (this.fuseBox) this.fuseBox.leverTarget = e.on ? 0 : 1;
        this.objectivesChanged();
        break;
      }
      case 'obj': Object.assign(this.obj, e.o); this.objectivesChanged(); break;
      case 'case': {
        const c = this.cases[e.c];
        c.broken = true; c.locked = false;
        if (c.glass) c.glass.visible = false;
        this.sfx('glass_break', c.itemPos, { vol: 1.2 });
        break;
      }
      case 'key': {
        this.obj.keys[e.key] = true;
        const p = this.playerById(e.pid);
        this.hud.notify(`${p ? p.name : 'Someone'} found the ${e.key} key`, 3);
        audio.play('key_pickup', { vol: 0.7 });
        this.aggression += 1;
        this.objectivesChanged();
        break;
      }
      case 'padlock': {
        this.obj.padlocks[e.key] = false;
        W.removePadlock(e.key);
        this.sfx('unlock', { x: L.gate.x, y: 1.1, z: L.gate.z }, { vol: 1.2 });
        this.hud.notify(`The ${e.key} padlock falls away`, 2.5);
        this.objectivesChanged();
        break;
      }
      case 'escape': this._beginEscape(); break;
      case 'hit': {
        const p = this.playerById(e.pid);
        if (p) p.health = e.hp;
        const g = this.ghosts[e.g];
        if (g) audio.play('cleaver', { pos: g.pos.clone().setY(g.pos.y + 1.2), vol: 0.5 });
        if (e.pid === me.id) {
          this.local.health = e.hp;
          this.local.shake = 1.2; this.dmgFx = 1;
          this.local.adrenaline = Math.max(this.local.adrenaline, 2.2);
          this.local.stamina = Math.min(100, this.local.stamina + 30);
          audio.play('hurt', { vol: 0.9 });
          this.hud.notify('RUN', 1.2);
        }
        break;
      }
      case 'crucifix': {
        const g = this.ghosts[e.g];
        if (g) { audio.play('crucifix', { pos: g.pos.clone().setY(1.5), vol: 1 }); }
        if (e.pid === me.id) {
          this._consume('crucifix');
          this.local.health = Math.max(this.local.health, 35);
          this.act({ k: 'hp', v: this.local.health });
          this.hud.notify('The crucifix burns — it lets go', 3);
          this.renderer.u.uFlash.value = 0.8;
        }
        break;
      }
      case 'caught': this._caught(e); break;
      case 'respawn': {
        const p = this.playerById(e.pid);
        if (!p) return;
        p.caught = false; p.lives = e.lives; p.health = 100; p.hidden = false; p.hideSpot = null;
        p.pos.set(e.x, e.y, e.z);
        if (e.pid === me.id) {
          this.local.spawn({ x: e.x, y: e.y, z: e.z, l: e.l }, this.rng.next() * 6.28);
          this.local.health = 100;
          this.local.controlLocked = false;
          this.caughtSeq = null;
          this.hud.death(null);
          this.hud.fade(false, 1.2);
          this.hud.letterbox(false);
          this.hud.notify(`${e.lives} ${e.lives === 1 ? 'life' : 'lives'} left`, 3);
        }
        break;
      }
      case 'out': {
        const p = this.playerById(e.pid);
        if (!p) return;
        p.alive = false; p.caught = false; p.lives = 0;
        if (e.pid === me.id) this._becomeSpectator();
        else this.hud.notify(`${p.name} is gone`, 3);
        break;
      }
      case 'left': {
        const p = this.playerById(e.pid);
        if (!p) return;
        p.alive = false; p.lives = 0;
        const r = this.remotes.get(e.pid);
        if (r) { r.dispose(); this.remotes.delete(e.pid); }
        this.hud.notify(`${p.name} left the game`, 3);
        if (this.spectating === p) this._cycleSpectate(1);
        break;
      }
      case 'ghost': this._ghostEventLocal(e); break;
      case 'hunt': {
        this.hunt = e.on ? e.d : 0;
        if (e.on) {
          audio.play('stinger', { vol: 0.5 });
          setTimeout(() => audio.play('whisper', { vol: 0.9 }), 900);
          this.hud.subtitle('<i>(the house holds its breath)</i>', 3);
          this.world.powerFlicker = 2.5;
        }
        break;
      }
      case 'scare': this._scareLocal(e); break;
      case 'piano': audio.play('piano', { pos: new THREE.Vector3(e.x, e.y, e.z), notes: [48, 51, 54, 57, 60].sort(() => Math.random() - 0.5).slice(0, 3), arp: 0.18 }); break;
      case 'end': this._end(e.result); break;
      default: break;
    }
  }

  // ========================================================================== ghost hooks (host)
  onGhostState(g, s) {
    if (this.isHost) g.onStateChangeVisual();
    void s;
  }

  ghostEvent(g, kind) { this.emit({ k: 'ghost', g: g.id, kind }); }

  _ghostEventLocal(e) {
    const g = this.ghosts[e.g];
    if (!g) return;
    if (e.kind === 'flinch') { audio.play('vanish', { pos: g.pos.clone().setY(1.5), vol: 0.4 }); g.say(g.def.voice.search[0] || 'whisper', 0.6); }
    if (e.kind === 'tease') g.say('giggle', 0.8, true);
    if (e.kind === 'bored') g.say('giggle', 0.6);
    if (e.kind === 'attack') g.say(g.type === 'warden' ? 'growl' : g.type === 'child' ? 'giggle' : 'wail', 0.8);
    if (e.kind === 'roar') {
      const lp = this.localPlayerRec();
      if (lp && lp.pos.distanceTo(g.pos) < 10) { this.local.stun = 1.4; this.local.shake = 1.4; this.hud.notify('Your legs lock up', 1.4); }
    }
  }

  wardenRoar(g) { this.ghostEvent(g, 'roar'); if (this.rng.next() < 0.35 && this.obj.power && this.obj.fuse) this._trip(); }

  stinger(g) {
    const lp = this.localPlayerRec();
    if (lp && g.target === lp) { audio.play('stinger', { vol: 0.45 }); this.renderer.u.uCA.value = 0.012; }
  }

  lethalAt() { return 45 * (this.ghosts[0]?.diff.dmg || 1) + 0.01; }

  ghostHit(g, p) {
    const dmg = 45 * g.diff.dmg;
    const hp = Math.max(1, p.health - dmg);
    p.health = hp;
    this.emit({ k: 'hit', pid: p.id, hp, g: g.id });
  }

  ghostGrab(g, p, fromHide) {
    if (p.crucifix > 0) {
      p.crucifix--;
      this.emit({ k: 'crucifix', pid: p.id, g: g.id });
      g.banish(28);
      return;
    }
    // stage the grab: ghost right in front of the victim
    const dir = _v.copy(g.pos).sub(p.pos); dir.y = 0;
    if (dir.lengthSq() < 0.01) dir.set(Math.sin(g.yaw), 0, Math.cos(g.yaw)).negate();
    dir.normalize();
    if (!fromHide) g.pos.copy(p.pos).addScaledVector(dir, 0.72);
    g.yaw = Math.atan2(-dir.x, -dir.z);
    p.caught = true;
    p.lives = Math.max(0, p.lives - 1);
    this.emit({ k: 'caught', pid: p.id, g: g.id, lives: p.lives, fromHide: !!fromHide, gx: g.pos.x, gy: g.pos.y, gz: g.pos.z, gyaw: g.yaw });
    setTimeout(() => {
      if (this.ended) return;
      if (p.hideSpot) this.emit({ k: 'hide', h: p.hideSpot.id, pid: p.id, enter: false });
      if (p.lives > 0) {
        const s = this.findSafeSpot();
        this.emit({ k: 'respawn', pid: p.id, x: s.x, y: s.y, z: s.z, l: s.l, lives: p.lives });
      } else {
        this.emit({ k: 'out', pid: p.id });
        if (this.players.every((x) => !x.alive)) setTimeout(() => this.emit({ k: 'end', result: 'dead' }), 2500);
      }
    }, 4300);
  }

  ghostOpenDoor(g, d, smash) {
    this.emit({ k: 'door', d: d.id, open: true, sw: this.world.doorSide(d, g.pos), fast: smash });
    if (smash) this._pushNoise(new THREE.Vector3(d.x, d.y + 1, d.z), 18, d.layer, 'slam');
  }

  openHideSpot(hs, open) { this.emit({ k: 'hideOpen', h: hs.id, open }); }

  findGhostSpawn(ghost) {
    const L = this.level;
    for (let t = 0; t < 40; t++) {
      const r = L.rooms[(this.rng.next() * L.rooms.length) | 0];
      if (r.type === 'stairs' || (!ghost.def.vent && this.isRoomSealed(r))) continue;
      const p = L.randomPoint(this.rng, r);
      const v = new THREE.Vector3(p.x, p.y + 1.5, p.z);
      let ok = true;
      for (const pl of this.players) {
        if (!pl.alive) continue;
        const d = pl.pos.distanceTo(v);
        if (d < 15 - t * 0.2 || (d < 26 && L.los(v, pl.eye))) { ok = false; break; }
      }
      for (const o of this.ghosts) if (o !== ghost && o.state !== GS.dormant && o.pos.distanceTo(v) < 8) ok = false;
      if (ok) return p;
    }
    return null;
  }

  findSafeSpot() {
    const L = this.level;
    let best = null, bestS = -1;
    for (let t = 0; t < 30; t++) {
      const r = L.rooms[(this.rng.next() * L.rooms.length) | 0];
      if (r.type === 'stairs' || this.isRoomSealed(r)) continue;
      const p = L.randomPoint(this.rng, r);
      let s = 99;
      for (const g of this.ghosts) if (g.state !== GS.dormant) s = Math.min(s, Math.hypot(g.pos.x - p.x, g.pos.z - p.z) + (g.layer !== p.l ? 10 : 0));
      if (s > bestS) { bestS = s; best = p; }
      if (s > 20) break;
    }
    return best || L.randomPoint(this.rng, L.byId[this.def.spawn.room]);
  }

  _trip() {
    this.emit({ k: 'obj', o: { breaker: false, power: false } });
    this.emit({ k: 'power', on: false, why: 'trip' });
  }

  // ========================================================================== caught / death / spectate
  _caught(e) {
    const p = this.playerById(e.pid);
    const g = this.ghosts[e.g];
    if (!p) return;
    p.caught = true; p.lives = e.lives;
    this.stats.caught += e.pid === this.localRec.id ? 1 : 0;
    if (g) { g.pos.set(e.gx, e.gy, e.gz); g.yaw = e.gyaw; g.net.pos.copy(g.pos); g.net.yaw = e.gyaw; g.state = GS.grab; g.anim = ''; }
    const gv = g ? g.pos.clone().setY(g.pos.y + 1.4) : p.pos;
    audio.play(g ? g.def.voice.grab : 'scream', { pos: gv, vol: 1.2 });
    if (e.pid !== this.localRec.id) {
      const d = p.pos.distanceTo(this.camera.position);
      if (d < 25) audio.play('death_cry', { pos: p.eye, vol: 0.9 });
      this.hud.notify(`${p.name} was taken by ${g ? g.def.name : 'something'}`, 3);
      return;
    }
    // ---- local victim: cinematic grab from the victim's eyes
    const L = this.local;
    L.controlLocked = true;
    if (!e.fromHide && L.hiding) L.exitHide();
    this.caughtSeq = { t: 0, g, fromHide: e.fromHide, lives: e.lives, startYaw: L.yaw, startPitch: L.pitch };
    this.hud.letterbox(true);
    audio.play('stinger', { vol: 0.9 });
    audio.play('death_cry', { vol: 0.8 });
    this.renderer.u.uCA.value = 0.02;
  }

  _updateCaught(dt) {
    const c = this.caughtSeq;
    if (!c) return;
    c.t += dt;
    const L = this.local, g = c.g;
    // yank the view onto the ghost's face and hold it there, shaking
    if (g) {
      const head = g.avatar.bones.head;
      const hp = head ? head.getWorldPosition(new THREE.Vector3()) : g.pos.clone().setY(g.pos.y + g.def.eye);
      const eye = this.camera.position;
      const d = hp.clone().sub(eye);
      const yaw = Math.atan2(-d.x, -d.z), pitch = Math.atan2(d.y, Math.hypot(d.x, d.z));
      const k = 1 - Math.exp(-dt * (c.t < 0.4 ? 14 : 6));
      let dy = yaw - L.yaw; while (dy > Math.PI) dy -= Math.PI * 2; while (dy < -Math.PI) dy += Math.PI * 2;
      L.yaw += dy * k; L.pitch += (pitch - L.pitch) * k;
      // lifted off the floor
      if (c.t > 0.5 && !c.fromHide) L.pos.y = lerp(L.pos.y, this.level.layerOfY(L.pos.y + 0.3) * FH + 0.35, 1 - Math.exp(-dt * 2));
    }
    L.shake = Math.max(L.shake, c.t < 2.4 ? 0.8 + Math.sin(c.t * 30) * 0.2 : 0);
    this.renderer.u.uDamage.value = smoothstep(0.2, 2.2, c.t) * 0.85;
    this.renderer.u.uFear.value = 1;
    if (c.t > 2.3 && !c.faded) { c.faded = true; this.hud.fade(true, 0.6); }
    if (c.t > 2.9 && !c.text) {
      c.text = true;
      this.hud.death(c.lives > 0 ? 'Taken' : 'Gone', c.lives > 0 ? `${c.lives} ${c.lives === 1 ? 'life' : 'lives'} remain…` : 'You have no lives left');
      this.renderer.u.uDamage.value = 0;
    }
  }

  _becomeSpectator() {
    const L = this.local;
    L.alive = false;
    L.controlLocked = true;
    this.localRec.alive = false;
    this.caughtSeq = null;
    this.hud.fade(false, 1.5);
    this.hud.letterbox(false);
    this.renderer.u.uDamage.value = 0;
    setTimeout(() => this.hud.death(null), 2500);
    this._cycleSpectate(1);
  }

  specTarget() { return this.spectating; }

  _cycleSpectate(dir) {
    const alive = this.players.filter((p) => p.alive && !p.isLocal);
    if (!alive.length) { this.spectating = null; this.hud.spectate(null); return; }
    let i = alive.indexOf(this.spectating);
    i = (i + dir + alive.length) % alive.length;
    this.spectating = alive[i];
    this.hud.spectate(this.spectating.name);
  }

  _updateSpectator(dt) {
    const t = this.spectating;
    if (!t || !t.alive) { this._cycleSpectate(1); if (!this.spectating) return; }
    const s = this.spectating;
    if (input.clicked || input.hit('ArrowRight') || input.hit('KeyE')) this._cycleSpectate(1);
    if (input.hit('ArrowLeft') || input.hit('KeyQ')) this._cycleSpectate(-1);
    const eye = s.eye;
    const back = new THREE.Vector3(Math.sin(s.yaw), 0, Math.cos(s.yaw));
    const want = eye.clone().addScaledVector(back, 2.3).add(new THREE.Vector3(0, 0.45, 0));
    // pull in if a wall is between
    const d = this.rayDist(eye, want.clone().sub(eye).normalize(), 2.4);
    const camP = eye.clone().add(want.clone().sub(eye).normalize().multiplyScalar(Math.max(0.4, d - 0.2)));
    this.camera.position.lerp(camP, 1 - Math.exp(-dt * 10));
    this.camera.lookAt(eye.clone().addScaledVector(back, -1.5));
    this.camera.updateMatrixWorld();
    audio.updateListener(this.camera.position, new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion), new THREE.Vector3(0, 1, 0));
    this.local.flash.intensity = 0; this.local.beam.visible = false; this.local.bounce.intensity = 0;
  }

  // ========================================================================== inventory
  _gainItem(it) {
    const def = ITEMS[it.type];
    this.stats.items++;
    if (it.type === 'note') {
      const n = NOTES[it.note ?? 0];
      this.readNotes.add(it.note);
      this.stats.notes++;
      audio.play('pickup', { vol: 0.5 });
      this._openNote(n.title, n.body);
      return;
    }
    if (def.key) { audio.play('key_pickup'); return; }
    audio.play(it.type === 'battery' ? 'battery' : 'pickup', { vol: 0.8 });
    let slot = def.stack ? this.inv.findIndex((s) => s && s.type === it.type) : -1;
    if (slot < 0) slot = this.inv.findIndex((s) => !s);
    if (slot < 0) {
      // full: drop the pickup back
      this.hud.notify('Your pockets are full', 2);
      this.act({ k: 'drop', type: it.type, x: this.local.pos.x, y: this.local.pos.y + 0.02, z: this.local.pos.z });
      return;
    }
    if (this.inv[slot]) this.inv[slot].count++; else this.inv[slot] = { type: it.type, count: 1 };
    this.hud.notify(`${def.name}`, 1.6);
    if (it.type === 'fuse' && !this.obj.power) this.hud.subtitle('Bring the fuse to the generator room', 3);
  }

  _openNote(title, body) {
    this.hud.showNote(title, body);
    this.local.controlLocked = true;
  }

  count(type) { return this.inv.reduce((n, s) => n + (s && s.type === type ? s.count : 0), 0); }

  _consume(type) {
    const i = this.inv.findIndex((s) => s && s.type === type);
    if (i < 0) return false;
    if (--this.inv[i].count <= 0) this.inv[i] = null;
    return true;
  }

  _useSelected() {
    const s = this.inv[this.sel];
    if (!s) return;
    const L = this.local;
    switch (s.type) {
      case 'medkit':
        if (L.health >= 100) { this.hud.notify('You are not hurt', 1.5); return; }
        this._consume('medkit'); L.health = Math.min(100, L.health + 60); audio.play('heal'); this.act({ k: 'hp', v: L.health }); this.hud.notify('Patched up', 1.5); break;
      case 'pills':
        this._consume('pills'); L.health = Math.min(100, L.health + 25); this.fear = 0; audio.play('heal', { vol: 0.6 }); this.act({ k: 'hp', v: L.health }); this.hud.notify('Your hands stop shaking', 2); break;
      case 'syringe':
        this._consume('syringe'); L.adrenaline = 12; L.stamina = 100; L.exhausted = false; audio.play('inject'); this.hud.notify('Adrenaline', 1.5); this.renderer.u.uCA.value = 0.01; break;
      case 'musicbox': {
        this._consume('musicbox');
        const fwd = new THREE.Vector3(-Math.sin(L.yaw), 0, -Math.cos(L.yaw));
        const p = L.pos.clone().addScaledVector(fwd, 0.6);
        this.act({ k: 'drop', type: 'musicbox', x: p.x, y: p.y + 0.01, z: p.z, lure: true });
        this.hud.notify('You wind the music box and set it down…', 2.5);
        break;
      }
      case 'battery': this._swapBattery(); break;
      default: this.hud.notify(ITEMS[s.type].desc, 2.5);
    }
  }

  _swapBattery() {
    if (!this.count('battery')) { this.hud.notify('No spare batteries', 1.5); return; }
    this._consume('battery');
    this.local.battery = 100;
    this.local.flashOn = true;
    audio.play('battery');
    this.hud.notify('Fresh battery', 1.5);
  }

  _drop() {
    const s = this.inv[this.sel];
    if (!s) return;
    const L = this.local;
    const fwd = new THREE.Vector3(-Math.sin(L.yaw), 0, -Math.cos(L.yaw));
    const p = L.pos.clone().addScaledVector(fwd, 0.7);
    this.level.collide(p, 0.15, p.y + 0.1, p.y + 0.3);
    this.act({ k: 'drop', type: s.type, x: p.x, y: p.y + 0.02, z: p.z });
    this._consume(s.type);
  }

  // ========================================================================== interaction
  _target() {
    const cam = this.camera;
    const org = cam.position, dir = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
    let best = null, bs = 1e9;
    const itPos = new THREE.Vector3();
    for (const it of this.world.interactables) {
      let pos = it.pos;
      if (it.kind === 'item') {
        const item = it.ref;
        if (item.taken) continue;
        if (item.drawer && item.drawer.open < 0.6) continue;
        if (item.case && item.case.locked) continue;
        pos = item.obj.getWorldPosition(itPos);
      }
      if (!pos) continue;
      const d = pos.distanceTo(org);
      if (d > (it.kind === 'item' ? 2.3 : 2.4)) continue;
      const to = _v.copy(pos).sub(org).divideScalar(d);
      const dot = to.dot(dir);
      const tol = Math.cos(Math.atan((it.kind === 'item' ? 0.22 : it.kind === 'gate' ? 1.0 : it.kind === 'door' ? 0.55 : 0.35) / Math.max(0.3, d)));
      if (dot < tol) continue;
      const score = (1 - dot) * 30 + d * 0.4 + (it.kind === 'item' ? -0.5 : 0);
      if (score >= bs) continue;
      if (!this.level.los(org, _v2.copy(pos).addScaledVector(to, -0.25))) continue;
      best = { ...it, pos: pos.clone(), d }; bs = score;
    }
    return best;
  }

  _promptFor(t) {
    const K = '<kbd>E</kbd>';
    const o = this.obj, L = this.level;
    switch (t.kind) {
      case 'item': {
        const it = t.ref;
        if (it.type === 'note') return `${K}Read note`;
        return `${K}Take ${ITEMS[it.type].name}${it.lure ? ' (stop the music)' : ''}`;
      }
      case 'door': {
        const d = t.ref;
        if (d.locked === 'inside') {
          const inside = this._insideRoom(d);
          const here = L.roomAt(this.local.pos.x, this.local.pos.z, this.local.layer);
          return here === inside ? `${K}Unlock the door` : 'Locked from the other side';
        }
        return `${K}${d.target > 0 ? 'Close' : 'Open'} door`;
      }
      case 'vent': {
        const d = t.ref;
        if (d.barricaded) return this.count('crowbar') ? `${K}Pry off the boards (loud)` : 'Boarded up — you need a tool';
        return 'A crawlspace — crouch <kbd>C</kbd> to squeeze through';
      }
      case 'gate': {
        if (!o.seenGate && !this._seenGateSent) { this._seenGateSent = true; this.act({ k: 'seen-gate' }); }
        const left = KEY_IDS.filter((k) => o.padlocks[k]);
        if (!left.length) return `${K}<b>Open the gate — ESCAPE</b>`;
        const usable = left.filter((k) => o.keys[k]);
        if (usable.length) return `${K}Unlock the ${usable.join(' & ')} padlock${usable.length > 1 ? 's' : ''}`;
        return `Chained shut — ${left.length} padlock${left.length > 1 ? 's' : ''} remain (${left.join(', ')})`;
      }
      case 'drawer': return `${K}${t.ref.target > 0 ? 'Close' : 'Open'} drawer`;
      case 'hide': {
        const hs = t.ref;
        if (hs.occupant && hs.occupant !== this.localRec.id) return 'Someone is hiding in there';
        return `${K}Hide in the wardrobe`;
      }
      case 'fusebox': {
        if (o.outage && !o.fuse) return this.count('fuse') ? `${K}Insert the fuse` : 'The fuse socket is empty';
        if (!o.breaker) return `${K}Reset the breaker`;
        return 'The generator hums';
      }
      case 'case': {
        const c = t.ref;
        if (c.broken) return c.item && !c.item.taken ? null : 'Shattered and empty';
        if (!c.item) return 'An empty display case';
        return this.count('crowbar') ? `${K}Smash the glass (very loud)` : 'Sealed display case — you need something heavy';
      }
      case 'piano': return `${K}Play a few notes (loud)`;
      default: return null;
    }
  }

  _insideRoom(d) {
    if (d.a.keyRoom) return d.a;
    if (d.b && d.b.keyRoom) return d.b;
    return d.a.doors.filter((x) => x.kind !== 'vent').length === 1 ? d.a : d.b;
  }

  _interact(t) {
    const o = this.obj;
    switch (t.kind) {
      case 'item': this.act({ k: 'pickup', i: t.ref.id }); break;
      case 'door': {
        const d = t.ref;
        if (d.locked === 'inside') {
          const here = this.level.roomAt(this.local.pos.x, this.local.pos.z, this.local.layer);
          if (here === this._insideRoom(d)) this.act({ k: 'unlock', d: d.id }); else { this.sfx('door_locked', { x: d.x, y: d.y + 1, z: d.z }); }
          return;
        }
        this.act({ k: 'door', d: d.id, open: !(d.target > 0) });
        break;
      }
      case 'vent': if (t.ref.barricaded && this.count('crowbar')) this.act({ k: 'vent', d: t.ref.id }); break;
      case 'gate': this.act({ k: 'gate' }); if (KEY_IDS.some((k) => o.padlocks[k] && !o.keys[k])) this.sfx('door_locked', { x: t.ref.x, y: 1.2, z: t.ref.z }); break;
      case 'drawer': this.act({ k: 'drawer', i: t.ref.id }); break;
      case 'hide': {
        const hs = t.ref;
        if (hs.occupant && hs.occupant !== this.localRec.id) return;
        this.act({ k: 'hide', h: hs.id, enter: true });
        break;
      }
      case 'fusebox':
        if (o.outage && !o.fuse && this.count('fuse')) { this._consume('fuse'); this.act({ k: 'fuse' }); audio.play('fuse_insert'); }
        else if (!o.breaker && (o.fuse || !o.outage)) { this.act({ k: 'lever' }); this.sfx('unlock', t.pos); }
        break;
      case 'case': if (!t.ref.broken && t.ref.item && this.count('crowbar')) this.act({ k: 'case', c: t.ref.id }); break;
      case 'piano': this.act({ k: 'piano', x: t.pos.x, y: t.pos.y, z: t.pos.z }); break;
      default: break;
    }
  }

  // ========================================================================== objectives
  objectivesChanged() {
    const o = this.obj;
    const list = [];
    const nk = KEY_IDS.filter((k) => o.keys[k]).length;
    const locks = KEY_IDS.filter((k) => o.padlocks[k]).length;
    if (o.gateOpen) list.push({ text: 'ESCAPE', done: false });
    else {
      list.push({ text: o.seenGate ? 'The front gate is chained — three padlocks' : 'Find a way out of the house', done: false });
      if (!o.power) list.push({ text: o.outage && !o.fuse ? 'Restore the power — find a fuse for the generator room' : 'Reset the breaker in the generator room', done: false });
      list.push({ text: `Find the keys (${nk}/3)`, done: nk === 3 });
      if (!o.keys.iron) list.push({ text: 'The iron key — somewhere behind a bolted door', done: false });
      if (!o.keys.silver) list.push({ text: 'The silver key — kept with The Collection', done: false });
      if (!o.keys.brass) list.push({ text: 'The brass key — tucked away in a drawer upstairs', done: false });
      if (nk > 0) list.push({ text: `Unlock the gate (${3 - locks}/3 padlocks)`, done: locks === 0 });
      if (locks === 0) list.push({ text: 'Open the gate and escape', done: false });
    }
    this.hud.objectives(list);
    this.hud.keyring(o.keys);
  }

  // ========================================================================== director (host)
  _director(dt) {
    const D = this.director, t = this.time;
    // blackout the first time
    if (!this.obj.outage && this.aggression > 0 && !D.forced) { D.forced = true; D.outageAt = Math.min(D.outageAt, Math.max(t + 8, 45)); }
    if (!this.obj.outage && t > D.outageAt) {
      if (this.fuseBox) {
        this.emit({ k: 'obj', o: { outage: true, fuse: false, power: false, breaker: false } });
        this.emit({ k: 'power', on: false, why: 'outage' });
      }
      this.obj.outage = true;
    }
    // hunts
    if (this.hunt > 0) {
      this.hunt -= dt;
      if (this.hunt <= 0) this.emit({ k: 'hunt', on: false });
    } else if (t > D.huntAt && this.ghosts.some((g) => g.state !== GS.dormant)) {
      D.huntAt = t + Math.max(90, 200 - this.aggression * 25) + this.rng.next() * 60;
      this.emit({ k: 'hunt', on: true, d: 28 });
      if (this.obj.power && this.obj.fuse && this.rng.next() < 0.4) this._trip();
    }
    // scares
    if (t > D.scareAt) {
      D.scareAt = t + 22 + this.rng.next() * 30 - this.aggression * 2;
      const alive = this.players.filter((p) => p.alive && !p.caught && !p.hidden);
      if (alive.length) {
        const p = alive[(this.rng.next() * alive.length) | 0];
        const kinds = ['slam', 'whisper', 'knock', 'steps', 'phantom', 'phantom', 'flicker', 'clock', 'breath'];
        const kind = kinds[(this.rng.next() * kinds.length) | 0];
        const e = { k: 'scare', kind, pid: p.id, x: p.pos.x, y: p.pos.y, z: p.pos.z, l: p.layer };
        if (kind === 'slam') {
          let bd = null, bdist = 9;
          for (const d of this.level.doors) {
            if (!d.open || d.kind !== 'door' || d.locked || Math.abs(d.y - p.pos.y) > 1.5) continue;
            const dist = Math.hypot(d.x - p.pos.x, d.z - p.pos.z);
            if (dist > 2.5 && dist < bdist) { bdist = dist; bd = d; }
          }
          if (bd) { this.emit({ k: 'door', d: bd.id, open: false, sw: bd.swing, fast: true }); return; }
          e.kind = 'knock';
        }
        this.emit(e);
      }
    }
    // music-box lures pull ghosts
    if (this.lures) {
      for (const lu of this.lures) {
        const it = this.world.items[lu.i];
        if (!it || !it.lure || this.time > lu.until) { lu.dead = true; continue; }
        if (this.time > lu.next) {
          lu.next = this.time + 4;
          const p = it.obj.getWorldPosition(new THREE.Vector3());
          this._pushNoise(p, 30, this.level.layerOfY(p.y + 0.5), 'lure');
        }
      }
      this.lures = this.lures.filter((l) => !l.dead);
    }
    // footstep noise for remote players is derived from their replicated state
    for (const p of this.players) {
      if (p.isLocal || !p.alive || p.hidden) continue;
      if (p.speed > 0.3) {
        p.stepAcc += p.speed * dt;
        const stride = p.crouch ? 0.55 : p.sprint ? 1.05 : 0.72;
        if (p.stepAcc > stride) { p.stepAcc = 0; this._pushNoise(p.pos.clone(), p.crouch ? 1.8 : p.sprint ? 13 : 5.5, p.layer, 'step'); }
      }
      if (p.talking) { p.talkAcc = (p.talkAcc || 0) + dt; if (p.talkAcc > 1) { p.talkAcc = 0; this._pushNoise(p.pos.clone(), 7, p.layer, 'voice'); } }
    }
    this.aggression = Math.max(this.aggression, KEY_IDS.filter((k) => this.obj.keys[k]).length) + 0 * dt;
  }

  _scareLocal(e) {
    const me = this.localPlayerRec();
    const L = this.local;
    const target = me && e.pid === me.id;
    const pos = new THREE.Vector3(e.x, e.y + 1.4, e.z);
    const behind = target ? L.eyePos.clone().add(new THREE.Vector3(Math.sin(L.yaw), 0, Math.cos(L.yaw)).multiplyScalar(1.2)) : pos;
    switch (e.kind) {
      case 'whisper': if (target) { audio.play('whisper', { pos: behind, vol: 1.0, ref: 0.6 }); this.hud.subtitle('<i>(whispering, right behind you)</i>', 2); } break;
      case 'breath': if (target) audio.play('breath_out', { pos: behind, vol: 1.0, intensity: 1.6 }); break;
      case 'knock': audio.play('knock', { pos: pos.clone().add(new THREE.Vector3((Math.random() - 0.5) * 6, 0, (Math.random() - 0.5) * 6)), vol: 1.0, muffle: true }); break;
      case 'steps': {
        const p = pos.clone(); p.y = e.l === 0 ? FH + 0.1 : 0.1;
        let i = 0;
        const tick = () => { if (i++ > 7) return; audio.play('footstep', { pos: p.add(new THREE.Vector3(0.9, 0, 0.3)).clone(), surface: 'wood', intensity: 1.3, vol: 1, muffle: true }); setTimeout(tick, 260); };
        if (target) { tick(); this.hud.subtitle('<i>(running footsteps overhead)</i>', 2); }
        break;
      }
      case 'flicker': this.world.powerFlicker = 1.5; audio.play('light_buzz', { pos, vol: 0.6 }); break;
      case 'clock': audio.play('clock_chime', { pos, vol: 0.5, muffle: true }); break;
      case 'phantom': if (target) this._phantom(); break;
      default: break;
    }
  }

  _phantom() {
    // a figure at the far end of your view that is gone when you look properly
    const L = this.local, lv = this.level;
    const fwd = new THREE.Vector3(-Math.sin(L.yaw), 0, -Math.cos(L.yaw));
    for (let d = 12; d >= 6; d -= 1.5) {
      const p = L.pos.clone().addScaledVector(fwd, d);
      const ix = Math.floor(p.x / 0.5), iz = Math.floor(p.z / 0.5);
      if (!lv.walk || !lv.walk[L.layer][iz * lv.NX + ix]) continue;
      if (!lv.los(L.eyePos, p.clone().setY(p.y + 1.5))) continue;
      this.phantom.root.position.set(p.x, L.pos.y, p.z);
      this.phantom.root.rotation.y = Math.atan2(-fwd.x, -fwd.z);
      this.phantom.play(this.phantom.clips.Stare ? 'Stare' : 'Idle');
      this.phantomT = 2.2;
      audio.play('whisper', { pos: p.clone().setY(1.5), vol: 0.5 });
      return;
    }
  }

  // ========================================================================== escape / end
  _beginEscape() {
    if (this.phase !== 'play') return;
    this.obj.gateOpen = true;
    this.objectivesChanged();
    this.phase = 'gate';
    this.gateT = 0;
    const g = this.level.gate;
    g.locked = null;
    this.world.setDoor(g, true, new THREE.Vector3(g.x, 0, g.z + 3), false);
    audio.play('door_creak', { vol: 1, dur: 2.2 });
    audio.play('thunder', { close: true, vol: 1 });
    this.hud.letterbox(true);
    this.hud.notify('The gate groans open', 2.5);
    this.gateLight = new THREE.SpotLight(0xbfd2ff, 0, 30, 0.7, 0.6, 1.2);
    this.gateLight.position.set(g.x, 3, g.z - 6);
    this.gateLight.target.position.set(g.x, 0, g.z + 6);
    this.scene.add(this.gateLight, this.gateLight.target);
    for (const gh of this.ghosts) if (this.isHost && gh.state !== GS.dormant) gh.vanish();
  }

  _updateGate(dt) {
    this.gateT += dt;
    const g = this.level.gate;
    this.gateLight.intensity = smoothstep(0.3, 1.8, this.gateT) * 90;
    this.renderer.u.uFlash.value = smoothstep(1.6, 2.8, this.gateT) * 0.6;
    if (this.local.alive && !this.local.hiding) {
      // walk the camera toward the light
      const L = this.local;
      L.controlLocked = true;
      const d = new THREE.Vector3(g.x - L.pos.x, 0, g.z - 1.5 - L.pos.z);
      const want = Math.atan2(-d.x, -d.z);
      let dy = want - L.yaw; while (dy > Math.PI) dy -= Math.PI * 2; while (dy < -Math.PI) dy += Math.PI * 2;
      L.yaw += dy * Math.min(1, dt * 3); L.pitch += (0.05 - L.pitch) * Math.min(1, dt * 3);
    }
    if (this.gateT > 2.6 && !this.gateFaded) { this.gateFaded = true; this.hud.fade(true, 0.5); }
    if (this.gateT > 3.2) this._startCutscene();
  }

  _startCutscene() {
    this.phase = 'cutscene';
    const survivors = this.players.filter((p) => p.alive).map((p) => ({ profile: p.profile, name: p.name }));
    if (!survivors.length) survivors.push({ profile: this.localRec.profile, name: this.localRec.name });
    this.cut = new EscapeCutscene(this, survivors, this.config.ghosts[0]).build();
    this.renderer.setScene(this.cut.scene, this.cut.camera);
    this.renderer.u.uFlash.value = 0;
    audio.stopLoop('chase'); audio.stopLoop('heartbeat');
    audio.setLoop('rain', 1.0, false);
    this.hud.fade(false, 1.2);
    this.hud.letterbox(true);
    this.hud.prompt(null);
    this.hud.crosshair(false);
    this.local.body.root.visible = false;
  }

  _end(result) {
    if (this.ended) return;
    this.ended = true;
    const survived = this.players.filter((p) => p.alive).map((p) => p.name);
    this.app.showResults({
      result, map: this.def.name, time: this.time, caught: this.stats.caught, items: this.stats.items, notes: this.stats.notes,
      keys: KEY_IDS.filter((k) => this.obj.keys[k]).length, survived, dist: this.stats.dist,
    });
  }

  // ========================================================================== helpers
  sfx(name, pos, opts = {}) {
    const p = pos.isVector3 ? pos.clone() : new THREE.Vector3(pos.x, pos.y, pos.z);
    const muffle = !this.level.los(p, this.listenerPos());
    audio.play(name, { pos: p, muffle, ...opts });
  }

  /** Distance to the first wall/door along a ray (cheap march through the collision grid). */
  rayDist(org, dir, max) {
    const L = this.level;
    const step = 0.2;
    for (let d = 0.2; d < max; d += step) {
      const x = org.x + dir.x * d, y = org.y + dir.y * d, z = org.z + dir.z * d;
      const l = L.layerOfY(y);
      if (y < l * FH + 0.01 || y > l * FH + 3.5) return d;
      for (const b of L.query(x, z, 0.05)) if (x > b.x0 && x < b.x1 && z > b.z0 && z < b.z1 && y > b.y0 && y < b.y1) return d;
    }
    return max;
  }

  onLightning() {
    const d = 0.4 + Math.random() * 2.2;
    setTimeout(() => audio.play('thunder', { close: d < 1, vol: 0.9 }), d * 1000);
  }

  // ========================================================================== main update
  update(dt) {
    if (this.ended && this.phase !== 'cutscene') return;
    this.time += dt;
    if (this.phase === 'cutscene') {
      const r = this.cut.update(dt);
      this.renderer.u.uFlash.value = r.flash * 0.15;
      this.renderer.u.uFear.value = 0; this.renderer.u.uDamage.value = 0;
      if (r.t > 14.5 && !this.cutTitle) { this.cutTitle = true; this.hud.death('Escaped', 'The manor lets you go… this time.'); }
      if (r.t > 18.8 && !this.cutFade) { this.cutFade = true; this.hud.fade(true, 1.5); }
      if (this.cut.done) { this.phase = 'done'; this.hud.death(null); this._end('escaped'); }
      audio.setLoop('rain', 0.9);
      return;
    }
    const L = this.local, me = this.localRec;
    const paused = this.paused && this.isHost && this.players.length === 1;
    if (paused) return;

    // ------------------------------------------------ input
    if (this.hud.noteOpen) {
      if (input.hit('KeyE') || input.hit('Escape') || input.clicked) { this.hud.closeNote(); L.controlLocked = !!this.caughtSeq || !L.alive; }
    } else if (me.alive && !me.caught && this.phase === 'play') {
      if (input.hit('KeyF')) L.toggleFlash();
      if (input.hit('KeyR')) this._swapBattery();
      for (let i = 0; i < 6; i++) if (input.hit('Digit' + (i + 1))) this.sel = i;
      if (input.wheel) this.sel = (this.sel + input.wheel + 6) % 6;
      if (input.hit('KeyQ') || (input.clicked && input.locked && !L.hiding)) this._useSelected();
      if (input.hit('KeyG') && !L.hiding) this._drop();
      if (L.hiding) {
        this.hud.prompt('<kbd>E</kbd>Leave the wardrobe · hold <kbd>Space</kbd> to hold your breath');
        if (input.hit('KeyE') && this.hideSpots[L.hiding.id]) this.act({ k: 'hide', h: L.hiding.id, enter: false });
      } else {
        const t = this._target();
        const text = t ? this._promptFor(t) : null;
        this.hud.prompt(text);
        if (t && input.hit('KeyE') && text && text.includes('<kbd>E</kbd>')) this._interact(t);
        this.setHighlight(t && t.kind === 'item' ? t.ref.obj : this._objectiveGlow(), !t || t.kind !== 'item');
      }
    } else this.hud.prompt(null);
    this.hud.tab(input.down('Tab'));
    const talking = settings.voiceChat && input.down('KeyV') && me.alive;
    if (this.net) this.net.setTalking(talking);
    this.hud.talk(talking);

    // ------------------------------------------------ local player
    if (me.alive) {
      const before = L.pos.clone();
      L.update(dt);
      this.stats.dist += before.distanceTo(L.pos);
      me.pos.copy(L.pos); me.vel.copy(L.vel); me.yaw = L.yaw; me.pitch = L.pitch; me.layer = L.layer;
      me.crouch = L.crouch; me.sprint = L.sprinting; me.slide = L.slideT > 0; me.speed = L.speed; me.flashOn = L.flashLevel > 0.1;
      me.flashDir.copy(L.flashDir); me.health = L.health; me.holdingBreath = L.holdingBreath; me.talking = talking;
      me.crucifix = this.count('crucifix');
      me.hidden = !!L.hiding; me.hideSpot = L.hiding;
      this._updateCaught(dt);
      const r = this.level.roomAt(L.pos.x, L.pos.z, L.layer);
      if (r) { r.visited = true; me.room = r; }
    } else {
      this._updateSpectator(dt);
    }
    for (const p of this.players) if (!p.isLocal) p.room = this.level.roomAt(p.pos.x, p.pos.z, p.layer);

    // ------------------------------------------------ remote players
    for (const r of this.remotes.values()) r.update(dt);

    // ------------------------------------------------ host simulation
    if (this.isHost) {
      for (const p of this.players) if (p.room && p.alive) this.heat[p.room.index] = Math.min(10, this.heat[p.room.index] + dt);
      for (let i = 0; i < this.heat.length; i++) this.heat[i] *= 1 - dt * 0.01;
      this.noises = this.noises.filter((n) => this.time - n.t < 2.5);
      if (this.phase === 'play') {
        this._director(dt);
        for (const g of this.ghosts) { g.think(dt); if (g.state !== GS.dormant) g.move(dt); }
      }
    }

    // ------------------------------------------------ ghost bodies + proximity
    let near = 0, chased = 0;
    const lp = this.camera.position;
    for (const g of this.ghosts) {
      g.present(dt);
      if (g.state === GS.dormant || g.state === GS.vanish) continue;
      const d = g.pos.distanceTo(lp);
      const vis = d < 14 && Math.abs(g.pos.y - lp.y) < 3 ? (this.level.los(g.pos.clone().setY(g.pos.y + 1.4), lp) ? 1 : 0.4) : 0;
      near = Math.max(near, vis * clamp(1 - d / 14, 0, 1));
      if (g.state === GS.chase && me.alive) chased = Math.max(chased, clamp(1 - d / 25, 0.2, 1));
    }
    this.ghostNear = damp(this.ghostNear, near, 4, dt);
    this.chased = damp(this.chased || 0, chased, 2, dt);

    // phantom
    if (this.phantomT > 0) {
      this.phantomT -= dt;
      const d = this.phantom.root.position.distanceTo(L.pos);
      const toP = this.phantom.root.position.clone().sub(L.eyePos).normalize();
      const looked = toP.dot(new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion)) > 0.97;
      if (d < 5 || (looked && this.phantomT < 1.6)) this.phantomT = Math.min(this.phantomT, 0.25);
      this.phantom.setDissolve(this.phantomT > 0.3 ? 0 : 1 - this.phantomT / 0.3, 0.2);
      this.phantom.update(dt);
      if (this.phantomT <= 0) this.phantom.setDissolve(1);
    }

    // ------------------------------------------------ world
    const camLayer = this.level.layerOfY(this.camera.position.y);
    this.world.update(dt, this.camera.position, camLayer, this.ghostNear);
    this._updateAnimatedProps(dt);
    this._updateHighlight();
    if (this.phase === 'gate') this._updateGate(dt);
    // lure music
    for (const it of this.world.items) {
      if (!it.lure || it.taken) continue;
      if (this.time > it.lureUntil) { it.lure = false; continue; }
      it.lureNext = it.lureNext || 0;
      if (this.time > it.lureNext) { it.lureNext = this.time + 7.5; it.lureSound = audio.play('musicbox', { pos: it.obj.getWorldPosition(new THREE.Vector3()), vol: 0.9 }); }
      const bal = it.obj.getObjectByName('MusicBox_Ballerina');
      if (bal) bal.rotation.y += dt * 2;
    }

    // ------------------------------------------------ fear, audio mix, post fx
    this._atmosphere(dt);

    // ------------------------------------------------ HUD
    if (me.alive) {
      this.hud.stamina(L.stamina / 100, L.stamina < 99 || L.sprinting, L.exhausted);
      this.hud.battery(L.battery, L.flashOn, this.count('battery'));
      this.hud.health(L.health);
      this.hud.hideSlit(!!L.hiding);
      this.hud.breath(L.breath, !!L.hiding);
    }
    this.hud.hotbar(this.inv, this.sel);
    this.hud.lives(me.lives, this.config.lives);
    if (input.down('Tab')) this.hud.drawMap(this);
    this.hud.tick(dt);

    // ------------------------------------------------ network
    this._netTick();
  }

  _objectiveGlow() {
    // during a blackout the fuse (or whoever carries nothing) glows so it can be found
    if (!this.obj.power && this.obj.outage && !this.obj.fuse) {
      const f = this.world.items.find((i) => i.type === 'fuse' && !i.taken);
      if (f) {
        const d = f.obj.getWorldPosition(new THREE.Vector3()).distanceTo(this.camera.position);
        if (d < 14) return f.obj;
      }
      if (this.count('fuse') && this.fuseBox) {
        const door = this.fuseBox.door;
        if (door && door.getWorldPosition(new THREE.Vector3()).distanceTo(this.camera.position) < 12) return door;
      }
    }
    if (!this.obj.breaker && this.obj.fuse && this.fuseBox && this.fuseBox.lever) return this.fuseBox.lever;
    return null;
  }

  _updateAnimatedProps(dt) {
    for (const dr of this.drawers) {
      dr.target = dr.target || 0;
      dr.open = dr.open + (dr.target - dr.open) * Math.min(1, dt * 7);
      dr.obj.position.z = dr.base.z + dr.open * 0.3;
    }
    for (const hs of this.hideSpots) {
      hs.open = hs.open || 0;
      if (hs.openT > 0) { hs.openT -= dt; if (hs.openT <= 0) hs.target = hs.occupant ? 0.07 : 0; }
      const tgt = hs.target ?? (hs.occupant ? 0.07 : 0);
      hs.open += (tgt - hs.open) * Math.min(1, dt * 6);
      if (hs.doorL) hs.doorL.rotation.y = -1.7 * hs.open;
      if (hs.doorR) hs.doorR.rotation.y = 1.7 * hs.open;
    }
    const fb = this.fuseBox;
    if (fb) {
      fb.leverT = fb.leverT ?? 0;
      fb.leverT += ((fb.leverTarget || 0) - fb.leverT) * Math.min(1, dt * 8);
      if (fb.lever) { fb.leverBase ??= fb.lever.rotation.x; fb.lever.rotation.x = fb.leverBase + fb.leverT * 1.3; }
      if (fb.door) {
        const near = this.camera.position.distanceTo(fb.slot) < 2.5 ? 1 : 0;
        fb.doorOpen = (fb.doorOpen || 0) + (near - (fb.doorOpen || 0)) * Math.min(1, dt * 4);
        fb.door.rotation.y = -1.9 * fb.doorOpen;
      }
    }
  }

  _atmosphere(dt) {
    const L = this.local, me = this.localRec;
    const u = this.renderer.u;
    const lit = me.alive ? this.world.lightAt(this.camera.position) : 0.5;
    let fearT = this.ghostNear * 0.9 + this.chased * 0.8 + (me.alive && !L.flashOn && lit < 0.1 ? 0.25 : 0) + (this.hunt > 0 ? 0.2 : 0);
    if (L.health < 50) fearT += 0.15;
    this.fear = damp(this.fear, clamp(fearT, 0, 1), fearT > this.fear ? 3 : 0.4, dt);
    if (!this.caughtSeq) {
      u.uFear.value = this.fear * 0.8;
      u.uDamage.value = Math.max(0, this.dmgFx);
    }
    this.dmgFx = Math.max(0, this.dmgFx - dt * 1.5);
    u.uCA.value = damp(u.uCA.value, 0.0008 + this.fear * 0.002, 3, dt);
    u.uDistort.value = this.ghostNear;
    u.uVignette.value = 0.3 + (L.hiding ? 0.6 : 0) + (me.alive ? (1 - L.health / 100) * 0.4 : 0);
    if (this.phase === 'play') u.uFlash.value = damp(u.uFlash.value, this.world.flashLevel * 0.04, 20, dt);
    this.renderer.r.toneMappingExposure = this.obj.power ? 1.0 : 1.12;
    this.ambient.intensity = (this.obj.power ? 0.05 : 0.03) + this.world.flashLevel * 0.25;
    this.moon.intensity = 0.1 + this.world.flashLevel * 1.5;
    // audio mix
    if (audio.ready) {
      const nw = this.world.nearestWindow(this.camera.position, this.level.layerOfY(this.camera.position.y));
      const rainVol = nw ? clamp(1.1 - nw.d / 9, 0.25, 1) : 0.25;
      audio.setLoop('rain', rainVol * 0.85, !nw || nw.d > 3);
      audio.setLoop('wind', 0.3 + rainVol * 0.2);
      audio.setLoop('drone', 0.35 + this.fear * 0.4);
      if (this.chased > 0.05) { if (!audio.loops.chase) audio.startLoop('chase', { vol: 0 }); audio.setLoop('chase', this.chased * 0.8, this.chased); }
      else if (audio.loops.chase && this.chased < 0.02) audio.stopLoop('chase');
      if (!audio.loops.heartbeat) audio.startLoop('heartbeat', { vol: 0 });
      audio.setLoop('heartbeat', clamp((this.fear - 0.25) * 1.2, 0, 1), this.fear);
      audio.setLoop('electric_hum', this.obj.power ? 0.25 : 0);
    }
  }

  _netTick() {
    if (!this.net) return;
    const now = performance.now();
    const me = this.localRec;
    const q = (v) => Math.round(v * 100) / 100;
    const flags = (p) => (p.crouch ? 1 : 0) | (p.flashOn ? 2 : 0) | (p.sprint ? 4 : 0) | (p.slide ? 8 : 0) | (p.talking ? 16 : 0) | (p.holdingBreath ? 32 : 0) | ((p.crucifix & 15) << 8);
    const st = (p) => [q(p.pos.x), q(p.pos.y), q(p.pos.z), q(p.yaw), q(p.pitch), p.layer, flags(p), q(p.speed), Math.round(p.health)];
    if (!this.isHost) {
      if (now - this.lastState > 1000 / STATE_HZ) { this.lastState = now; this.net.send({ t: 'st', s: st(me) }); }
      return;
    }
    // host: fold the latest client states into the authoritative records
    for (const [id, r] of this.remotes) {
      const last = r.buf[r.buf.length - 1];
      if (!last) continue;
      const p = r.rec;
      p.crucifix = (last.s[6] >> 8) & 15;
      p.holdingBreath = !!(last.s[6] & 32);
      p.talking = !!(last.s[6] & 16);
      void id;
    }
    if (now - this.lastSnap > 1000 / SNAP_HZ) {
      this.lastSnap = now;
      this.net.broadcast({ t: 'snap', g: this.ghosts.map((g) => g.snapshot()), p: this.players.map((p) => [p.id, st(p)]), h: this.hunt, a: this.aggression });
    }
  }

  // ========================================================================== lifecycle
  startAudio() {
    audio.startLoop('rain', { vol: 0.5 });
    audio.startLoop('wind', { vol: 0.3 });
    audio.startLoop('drone', { vol: 0.35 });
    audio.startLoop('electric_hum', { vol: 0.25 });
  }

  dispose() {
    audio.stopAll();
    this.local?.dispose();
    for (const r of this.remotes.values()) r.dispose();
    for (const g of this.ghosts) g.dispose();
    if (this.cut) this.cut.dispose();
    this.scene.traverse((o) => {
      if (o.isMesh && o.geometry && o.name.startsWith('merged')) o.geometry.dispose();
    });
  }
}

export { GHOST_TYPES, GHOST_DEF };
