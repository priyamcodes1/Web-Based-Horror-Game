// Ghost: animated model + AI brain (host-authoritative; clients interpolate network state).
import * as THREE from 'three';
import { cloneCharacter, prepareCharacter } from '../core/assets.js';
import { SpringBones } from '../gfx/springBones.js';
import { ghostify, makeGhostUniforms } from '../gfx/effects.js';
import { audio } from '../audio/audio.js';
import { angleDiff, clamp, dampAngle } from '../core/util.js';
import { FH } from '../world/level.js';

export const GHOST_PARAMS = {
  // The Widow: roams silently and weeps; screams when she spots you and chases for a long time;
  // a flashlight in her face makes her cover her eyes, cry out and flee.
  widow: {
    walk: 1.3, chase: 4.6, sight: 20, fov: 125, hearing: 0.85, giveUp: 14, search: 18, attack: 1.45, damage: 45,
    anims: { idle: 'Idle', walk: 'Glide', run: 'Run', reach: 'Chase', attack: 'Attack', search: 'Search', stare: 'Stare', alert: 'Scream',
      grab: 'Grab', lift: 'Lift', flinch: 'Flinch', crouch: 'Crouch' },
    voice: { ambient: 'weep', alert: 'scream', chase: 'wail', idle2: 'whisper', flinch: 'wail', kill: 'laugh' },
    light: 'flee', rim: 0x9ab8d8, float: 0.0, step: null, scale: 1,
  },
  // The Hollow Child: nearly blind, hears everything; faster than your sprint but bored quickly; crawls
  // through open vents; sometimes just stares, giggles and vanishes.
  child: {
    walk: 1.55, chase: 5.6, sight: 7, fov: 100, hearing: 2.6, giveUp: 3.5, search: 9, attack: 1.3, damage: 40,
    anims: { idle: 'Idle', walk: 'Walk', run: 'Run', crawl: 'Crawl', attack: 'Attack', search: 'Search', stare: 'Stare', alert: 'Giggle',
      grab: 'Grab', lift: 'Grab', flinch: 'Flinch', crouch: 'Crouch' },
    voice: { ambient: 'hum', alert: 'giggle', chase: 'giggle', idle2: 'child_whisper', flinch: 'scream', kill: 'giggle' },
    light: 'flee', rim: 0xc8b0a0, float: 0, step: 'light', scale: 1,
  },
  // The Warden: slow but relentless; tracks you by scent, smashes doors open, his roar freezes your legs;
  // you hear his chain first. Light only makes him angrier.
  warden: {
    walk: 1.15, chase: 3.1, sight: 18, fov: 100, hearing: 1.0, giveUp: 40, search: 30, attack: 1.6, damage: 100,
    anims: { idle: 'Idle', walk: 'Walk', run: 'Walk', attack: 'Attack', search: 'Search', stare: 'Stare', alert: 'Roar',
      grab: 'Grab', lift: 'Lift', flinch: 'Flinch', smash: 'Smash', crouch: 'Crouch' },
    voice: { ambient: 'monster_breath', alert: 'roar', chase: 'growl', idle2: 'chain', flinch: 'growl', kill: 'roar' },
    light: 'rage', rim: 0xd08060, float: 0, step: 'heavy', scale: 1,
  },
};

// facial expressions (ARKit-style shape keys baked into the ghost bodies)
const EXPR = {
  slack: { jawOpen: 0.1 },
  weep: { jawOpen: 0.22, mouthFrownLeft: 0.9, mouthFrownRight: 0.9, browInnerUp: 1, eyeBlinkLeft: 0.4, eyeBlinkRight: 0.4, mouthLowerDownLeft: 0.3, mouthLowerDownRight: 0.3 },
  scream: { jawOpen: 1, mouthStretchLeft: 0.85, mouthStretchRight: 0.85, mouthLowerDownLeft: 0.7, mouthLowerDownRight: 0.7, mouthUpperUpLeft: 0.5, mouthUpperUpRight: 0.5,
    eyeWideLeft: 1, eyeWideRight: 1, browInnerUp: 0.9, noseSneerLeft: 0.5, noseSneerRight: 0.5 },
  laugh: { jawOpen: 0.55, mouthSmileLeft: 1, mouthSmileRight: 1, mouthUpperUpLeft: 0.6, mouthUpperUpRight: 0.6, eyeWideLeft: 0.7, eyeWideRight: 0.7, mouthStretchLeft: 0.3, mouthStretchRight: 0.3 },
  grin: { jawOpen: 0.18, mouthSmileLeft: 0.75, mouthSmileRight: 0.75, eyeWideLeft: 0.6, eyeWideRight: 0.6 },
  roar: { jawOpen: 1, noseSneerLeft: 1, noseSneerRight: 1, browDownLeft: 1, browDownRight: 1, mouthStretchLeft: 0.7, mouthStretchRight: 0.7, mouthUpperUpLeft: 0.9, mouthUpperUpRight: 0.9 },
  snarl: { jawOpen: 0.2, noseSneerLeft: 0.6, noseSneerRight: 0.6, browDownLeft: 0.8, browDownRight: 0.8, mouthUpperUpLeft: 0.4, mouthUpperUpRight: 0.4 },
  pain: { jawOpen: 0.45, eyeBlinkLeft: 1, eyeBlinkRight: 1, browDownLeft: 0.7, browDownRight: 0.7, mouthStretchLeft: 0.8, mouthStretchRight: 0.8, noseSneerLeft: 0.6, noseSneerRight: 0.6 },
  whisper: { jawOpen: 0.25, mouthFunnel: 0.4 },
};
const BASE_EXPR = { widow: 'weep', child: 'grin', warden: 'snarl' };
// voice kind -> expression (per ghost)
const VOICE_EXPR = {
  widow: { ambient: 'weep', alert: 'scream', chase: 'scream', idle2: 'whisper', flinch: 'pain', kill: 'laugh' },
  child: { ambient: 'grin', alert: 'laugh', chase: 'laugh', idle2: 'whisper', flinch: 'scream', kill: 'laugh' },
  warden: { ambient: 'snarl', alert: 'roar', chase: 'roar', idle2: 'snarl', flinch: 'pain', kill: 'roar' },
};

const DIFF = { easy: { speed: 0.88, sense: 0.75, cool: 1.4 }, normal: { speed: 1, sense: 1, cool: 1 }, nightmare: { speed: 1.1, sense: 1.3, cool: 0.7 } };

export class Ghost {
  constructor(game, type, id, rng) {
    this.game = game; this.type = type; this.id = id; this.rng = rng;
    this.P = GHOST_PARAMS[type];
    this.diff = DIFF[game.config.difficulty] || DIFF.normal;
    const { root, animations } = cloneCharacter({ widow: 'ghost_widow', child: 'ghost_child', warden: 'ghost_warden' }[type]);
    this.root = root;
    prepareCharacter(root, true);
    this.uniforms = makeGhostUniforms(this.P.rim);
    root.traverse((o) => {
      if (!o.isMesh) return;
      const m = o.material;
      if (/Hair|Brow|Lash|eyebrow|eyelash/i.test(m.name + o.name)) { m.alphaTest = 0.4; m.transparent = false; m.side = THREE.DoubleSide; return; }
      if (/Skirt/i.test(m.name)) m.side = THREE.DoubleSide;
      if ('roughness' in m) m.roughness = Math.max(m.roughness, 0.5);
      o.material = m.clone();
      ghostify(o.material, this.uniforms);
    });
    this.head = null;
    this.bones = {};
    root.traverse((o) => { if (o.isBone) this.bones[o.name] = o; });
    this.head = this.bones.head; this.neck = this.bones.neck_01 || this.bones.neck;
    // gown sway (same spring rig as the survivors' skirts, with thigh colliders)
    root.updateMatrixWorld(true);
    const W = (b, x, y, z) => b.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(x, y, z)).toArray();
    const springs = [], colliders = [];
    for (const [bn, z] of [['skirt_f', 0.06], ['skirt_b', -0.06]]) if (this.bones[bn]) springs.push({ bone: bn, tail: W(this.bones[bn], 0, -0.7, z), stiffness: 0.45, drag: 0.3, gravity: 0.7, radius: 0.05, maxAngle: 32, kind: 'hair' });
    for (const sd of ['l', 'r']) {
      const th = this.bones['thigh_' + sd], ca = this.bones['calf_' + sd];
      if (th && ca && springs.length) {
        const a = th.getWorldPosition(new THREE.Vector3()), b = ca.getWorldPosition(new THREE.Vector3());
        colliders.push({ bone: 'thigh_' + sd, center: a.clone().lerp(b, 0.5).toArray(), radius: 0.09 });
        colliders.push({ bone: 'calf_' + sd, center: b.clone().lerp(b.clone().setY(0.1), 0.4).toArray(), radius: 0.08 });
      }
    }
    this.physics = springs.length ? new SpringBones(root, { springs, colliders }) : null;
    // the face's forward axis in head-bone space (bind pose: the model faces +Z)
    if (this.head) { const hq = this.head.getWorldQuaternion(new THREE.Quaternion()); this.faceAxis = new THREE.Vector3(0, 0, 1).applyQuaternion(hq.invert()); }
    this.lookTarget = null; this.lookW = 0;
    // face: every mesh carrying the expression shape keys (body, brows, lashes)
    this.faceMeshes = [];
    root.traverse((o) => { if (o.isMesh && o.morphTargetDictionary && 'jawOpen' in o.morphTargetDictionary) this.faceMeshes.push(o); });
    this.exprCur = {}; this.exprTarget = { ...EXPR[BASE_EXPR[type]] }; this.exprT = 0; this.exprName = BASE_EXPR[type]; this.exprClock = 0;
    game.scene.add(root);
    this.mixer = new THREE.AnimationMixer(root);
    this.clips = {};
    for (const c of animations) this.clips[c.name] = c;
    this.actions = {};
    this.current = null;
    this.pos = new THREE.Vector3();
    this.yaw = 0;
    this.state = 'roam';
    this.path = null; this.pi = 0;
    this.target = null; this.lastSeen = null; this.lastSeenT = 0;
    this.awareness = new Map();
    this.speed = 0; this.moveSpeed = 0;
    this.timer = 0; this.cool = 0; this.voiceT = 3 + rng.next() * 6; this.stepT = 0; this.repathT = 0;
    this.dissolve = 0; this.dissolveTarget = 0;
    this.seenHide = null;
    this.sinceSeen = new Map();   // player id -> seconds since this ghost last saw them out in the open
    this.stun = 0; this.lure = null; this.hunt = 0;
    this.stuckT = 0; this.lastPos = new THREE.Vector3();
    this.special = 0;
    this.lightCool = 0; this.flinchT = 0; this.fleeT = 0; this.rage = 0; this.stareCool = 30; this.scentT = 0; this.smashT = 0;
    this.visible = true;
    this.net = { x: 0, y: 0, z: 0, yaw: 0, a: 'Idle', d: 0 };
  }

  // ------------------------------------------------------------------ animation
  play(name, fade = 0.3, once = false, speed = 1) {
    if (!name || !this.clips[name]) return;
    let a = this.actions[name];
    if (!a) { a = this.mixer.clipAction(this.clips[name]); this.actions[name] = a; }
    if (this.current === a && !once) { a.timeScale = speed; return; }
    a.reset();
    a.setLoop(once ? THREE.LoopOnce : THREE.LoopRepeat, Infinity);
    a.clampWhenFinished = once;
    a.timeScale = speed;
    a.enabled = true;
    if (this.current && this.current !== a) a.crossFadeFrom(this.current, fade, true);
    a.play();
    this.current = a;
    this.animName = name;
  }

  /** Turn the head (and a little of the neck) so the face points at a world position. */
  aimHead(target, weight) {
    if (!this.head || !this.faceAxis || weight <= 0.001) return;
    for (const [bone, w] of [[this.neck, 0.35], [this.head, 0.75]]) {
      if (!bone) continue;
      bone.updateWorldMatrix(true, false);
      const wq = bone.getWorldQuaternion(new THREE.Quaternion());
      const hq = this.head.getWorldQuaternion(new THREE.Quaternion());
      const fwd = this.faceAxis.clone().applyQuaternion(hq);
      const to = target.clone().sub(this.head.getWorldPosition(new THREE.Vector3())).normalize();
      const delta = new THREE.Quaternion().setFromUnitVectors(fwd, to);
      const d = new THREE.Quaternion().slerp(delta, weight * w);
      const nw = d.multiply(wq);
      const pq = bone.parent.getWorldQuaternion(new THREE.Quaternion()).invert();
      bone.quaternion.copy(pq.multiply(nw));
    }
  }

  setPos(p, yaw = this.yaw) { this.pos.copy(p); this.yaw = yaw; this.root.position.copy(p); this.root.rotation.y = yaw; }

  headWorld(out = new THREE.Vector3()) {
    if (this.head) return this.head.getWorldPosition(out);
    return out.copy(this.pos).setY(this.pos.y + 1.7);
  }

  /** Host: the ghost speaks - every peer hears it and sees the face move. */
  say(kind, vol = 1) {
    if (!this.P.voice[kind]) return;
    if (this.game.isHost) this.game.event({ k: 'gsay', g: this.id, kind, vol });
  }

  /** All peers: play the voice from the ghost's head and pull the matching face. */
  speak(kind, vol = 1) {
    const name = this.P.voice[kind];
    if (!name) return null;
    this.voice?.stop?.(0.15);
    const h = audio.play(name, { pos: this.headWorld(), vol, ref: 2.5, rolloff: 1.0 });
    this.voice = h;   // follows the ghost while it moves (position + occlusion)
    const ex = VOICE_EXPR[this.type][kind];
    if (ex) this.setExpr(ex, kind === 'ambient' ? 4 : kind === 'kill' ? 2.2 : 1.6);
    return h;
  }

  setExpr(name, dur = 1.5) {
    this.exprTarget = { ...(EXPR[name] || EXPR.slack) };
    this.exprName = name; this.exprT = dur;
  }

  updateFace(dt) {
    if (!this.faceMeshes.length) return;
    this.exprClock += dt;
    if (this.exprT > 0) { this.exprT -= dt; if (this.exprT <= 0) { this.exprTarget = { ...EXPR[BASE_EXPR[this.type]] }; this.exprName = BASE_EXPR[this.type]; } }
    const k = Math.min(1, dt * (this.exprName === 'scream' || this.exprName === 'roar' ? 14 : 6));
    const keys = new Set([...Object.keys(this.exprCur), ...Object.keys(this.exprTarget)]);
    for (const key of keys) this.exprCur[key] = (this.exprCur[key] || 0) + ((this.exprTarget[key] || 0) - (this.exprCur[key] || 0)) * k;
    // vocal motion: a laugh chops the jaw, a scream trembles, weeping quivers
    let jaw = this.exprCur.jawOpen || 0;
    const t = this.exprClock;
    if (this.exprName === 'laugh') jaw *= 0.55 + 0.45 * Math.abs(Math.sin(t * 22));
    else if (this.exprName === 'scream' || this.exprName === 'roar') jaw *= 1.7 * (0.92 + 0.08 * Math.sin(t * 47));   // past the face unit: a jaw-dropping scream
    else if (this.exprName === 'weep') jaw *= 0.7 + 0.3 * Math.abs(Math.sin(t * 5.5) * Math.sin(t * 1.7));
    else if (this.exprName === 'whisper') jaw *= 0.5 + 0.5 * Math.abs(Math.sin(t * 9));
    // blink now and then (milky eyes still blink)
    const blink = (t % 4.3) < 0.12 ? 1 : 0;
    for (const m of this.faceMeshes) {
      const d = m.morphTargetDictionary, inf = m.morphTargetInfluences;
      for (const key of keys) if (key in d) inf[d[key]] = this.exprCur[key] || 0;
      if ('jawOpen' in d) inf[d.jawOpen] = jaw;
      if (blink && 'eyeBlinkLeft' in d && this.exprName !== 'scream') { inf[d.eyeBlinkLeft] = 1; inf[d.eyeBlinkRight] = 1; }
    }
  }

  hearable() {
    const p = this.game.localView();
    return this.game.level.los(p, this.headWorld());
  }

  // ------------------------------------------------------------------ helpers
  get layer() { return this.game.level.layerOfY(this.pos.y + 0.3); }

  goTo(p, ghost = true) {
    const L = this.game.level, from = { x: this.pos.x, z: this.pos.z, l: this.layer };
    const l = p.l ?? L.layerOfY(p.y ?? 0);
    let path = L.findPath(from, { x: p.x, z: p.z, l }, ghost);
    // the exact point can sit on furniture (a music box on a table): settle for the nearest reachable spot beside it
    for (let r = 0.7; !path && r <= 2.1; r += 0.7) {
      for (let k = 0; k < 8 && !path; k++) {
        const a = k * Math.PI / 4;
        path = L.findPath(from, { x: p.x + Math.cos(a) * r, z: p.z + Math.sin(a) * r, l }, ghost);
      }
    }
    this.path = path; this.pi = 1;
    return !!path;
  }

  randomRoomPoint(near = null, maxDist = 999) {
    const L = this.game.level;
    const rooms = L.rooms.filter((r) => r.type !== 'stairs' && (!near || Math.hypot(r.cx - near.x, r.cz - near.z) < maxDist));
    const r = this.rng.pick(rooms.length ? rooms : L.rooms);
    return L.randomPoint(this.rng, r);
  }

  vanish(then) {
    this.dissolveTarget = 1;
    audio.play('vanish', { pos: this.pos.clone().setY(this.pos.y + 1.2), vol: 0.7 });
    this.afterVanish = then;
  }

  teleportFar(from) {
    this.seenHide = null;
    const L = this.game.level;
    let best = null, bd = 0;
    for (let i = 0; i < 12; i++) {
      const p = this.randomRoomPoint();
      const d = Math.hypot(p.x - from.x, p.z - from.z) + (p.l !== L.layerOfY(from.y) ? 12 : 0);
      if (d > bd) { bd = d; best = p; }
    }
    this.setPos(new THREE.Vector3(best.x, best.y, best.z), this.rng.range(-Math.PI, Math.PI));
    this.path = null;
    this.dissolveTarget = 0;
  }

  // ------------------------------------------------------------------ AI (host)
  think(dt, players) {
    const g = this.game, L = g.level, P = this.P, D = this.diff;
    this.timer -= dt; this.cool -= dt; this.voiceT -= dt; this.repathT -= dt;
    if (this.stun > 0) {
      this.stun -= dt;
      this.moveSpeed = 0;
      this.play(P.anims.alert || P.anims.idle, 0.2);
      if (this.stun <= 0) { this.state = 'retreat'; this.vanish(() => this.teleportFar(this.pos)); }
      return;
    }
    if (this.state === 'grab' || this.state === 'vanishing') { this.moveSpeed = 0; return; }

    // ---------------- perception
    const eye = this.headWorld(new THREE.Vector3());
    const fwd = new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    let seen = null, seenD = 1e9;
    for (const pl of players) {
      if (!pl.alive || pl.caught) continue;
      const pe = pl.eye;
      const dx = pe.x - this.pos.x, dz = pe.z - this.pos.z;
      const d = Math.hypot(dx, dz);
      const sameFloor = Math.abs(pe.y - eye.y) < 2.6 || this.nearStairs(pl.pos);
      if (!sameFloor) { this.awareness.set(pl.id, 0); continue; }
      let a = this.awareness.get(pl.id) || 0;
      const inFov = d < 2.2 || Math.abs(angleDiff(this.yaw, Math.atan2(dx, dz))) < (P.fov * D.sense) * Math.PI / 360;
      // she watched you climb in (saw you out in the open a moment ago): she knows exactly where you are
      if (pl.hiding && this.seenHide !== pl.hideSpot && (this.sinceSeen.get(pl.id) ?? 99) < 1.0 && (d < 8 || a >= 0.5)) this.seenHide = pl.hideSpot;
      // hidden unless she saw you get in, or you're peeking with the doors pushed wide and she's close
      const hidden = pl.hiding && this.seenHide !== pl.hideSpot && !(pl.exposed && d < 6);
      let visible = false;
      if (!hidden && d < P.sight * 1.2 && inFov) visible = L.los(eye, pe);
      const knowsSpot = pl.hiding && this.seenHide === pl.hideSpot;
      if (knowsSpot) { visible = true; a = 1.5; }                   // no need to see through the doors: she knows
      this.sinceSeen.set(pl.id, visible && !pl.hiding ? 0 : (this.sinceSeen.get(pl.id) ?? 99) + dt);
      if (visible) {
        // stealth: a torch gives you away, a lit room less so, the dark hides you; crouching low and keeping
        // still both matter (until she is already chasing you)
        let light = pl.flashOn ? 1 : 0.45;
        if (pl.roomLit) light = Math.max(light, 0.85);
        const stalking = this.state !== 'chase';
        let stealth = 1;
        if (pl.crouch && stalking) { light *= 0.6; stealth *= 0.55; }
        const moving = pl.vel ? Math.hypot(pl.vel.x, pl.vel.z) > 0.4 : true;
        if (!moving && !pl.flashOn && stalking) stealth *= 0.7;
        if (this.state === 'lured') stealth *= 0.25;                     // entranced by the music box
        const range = P.sight * light * D.sense * (this.hunt > 0 ? 1.4 : 1);
        if (knowsSpot) { /* stays fully aware */ } else if (d < range) {
          const rate = d < 2.2 ? 6 : (1.6 * (1 - d / range) + 0.4) * D.sense * stealth;
          a += rate * dt * (this.state === 'chase' ? 3 : 1);
        } else a -= dt * 0.3;
      } else a -= dt * 0.25;
      a = clamp(a, 0, 1.5);
      this.awareness.set(pl.id, a);
      if (visible && a >= 1 && d < seenD) { seen = pl; seenD = d; }
    }

    // ---------------- hearing
    if (this.state !== 'chase' && this.state !== 'alert' && this.cool <= 0) {
      for (const n of g.noiseEvents) {
        const cross = Math.abs(n.y - this.pos.y) > 2.6 ? 0.45 : 1;
        const hr = n.r * P.hearing * D.sense * cross * (this.hunt > 0 ? 1.5 : 1);
        const d = Math.hypot(n.x - this.pos.x, n.z - this.pos.z);
        if (d < hr) {
          this.state = 'investigate'; this.timer = 10; this.goTo({ x: n.x, z: n.z, l: L.layerOfY(n.y + 0.3) });
          if (this.rng.chance(0.3)) this.say('idle2', 0.8);
          break;
        }
      }
    }

    // ---------------- state transitions on sight
    // cooldown only blocks *starting* a hunt/strike; an ongoing chase keeps tracking what it sees
    // flinching / fleeing / vanishing / staring ghosts are busy: seeing you must not snap them back into a hunt
    const busy = ['flinch', 'flee', 'retreat', 'stare', 'stunned'].includes(this.state);
    if (seen && !busy && (this.cool <= 0 || this.state === 'chase' || this.state === 'attack')) {
      if (this.state !== 'chase' && this.state !== 'alert' && this.state !== 'attack') {
        this.state = 'alert'; this.timer = this.type === 'child' ? 0.7 : 1.1; this.target = seen;
        this.play(P.anims.alert || P.anims.idle, 0.2, true);
        this.say('alert', 1);
        g.onSpotted?.(this, seen);
        if (this.type === 'warden') {
          const frozen = players.filter((pl) => pl.alive && !pl.hiding && pl.pos.distanceTo(this.pos) < 12 && L.los(eye, pl.eye)).map((pl) => pl.id);
          if (frozen.length) g.freezePlayers?.(frozen, 1.7);
          this.timer = 1.6;
        }
      }
      this.target = seen;
      this.lastSeen = seen.pos.clone(); this.lastSeenVel = seen.vel ? seen.vel.clone() : new THREE.Vector3();
      this.lastSeenT = 0;
    } else if (this.target) this.lastSeenT += dt;

    this.shy = 1;
    // ---------------- flashlight in the face
    this.lightCool -= dt;
    if (this.lightCool <= 0 && this.state !== 'flinch' && this.state !== 'flee' && this.dissolve < 0.3) {
      for (const pl of players) {
        if (!pl.alive || !pl.flashOn || pl.hiding || !pl.lookDir) continue;
        const toG = new THREE.Vector3().subVectors(eye, pl.eye);
        const d = toG.length();
        if (d > 11 || d < 0.6) continue;
        toG.divideScalar(d);
        if (pl.lookDir.dot(toG) < 0.965) continue;              // the beam has to be on her face
        if (!L.los(pl.eye, eye)) continue;
        this.onLight(pl);
        break;
      }
    }
    if (this.state === 'flinch') {
      this.flinchT -= dt; this.moveSpeed = 0; this.speed = 0;
      if (this.lightFrom) this.faceTowards(this.lightFrom, dt, 4);
      if (this.flinchT <= 0) {
        if (this.P.light === 'rage') { this.state = this.target ? 'chase' : 'roam'; this.rage = 10; this.chaseT = 2; }
        else { this.state = 'flee'; this.fleeT = this.type === 'child' ? 2.2 : 3.5; this.path = null; this.repathT = 0; }
      }
      return;
    }
    if (this.state === 'flee') {
      this.fleeT -= dt; this.repathT -= dt;
      if (this.repathT <= 0 && this.lightFrom) {
        const away = new THREE.Vector3().subVectors(this.pos, this.lightFrom).setY(0).normalize().multiplyScalar(7);
        const p = { x: this.pos.x + away.x, z: this.pos.z + away.z, l: this.layer };
        if (!this.goTo(p)) this.goTo(this.randomRoomPoint(this.pos, 12));
        this.repathT = 1.2;
      }
      this.followPath(dt, this.P.chase * 1.05);
      if (this.fleeT <= 0) { this.state = 'retreat'; this.target = null; this.vanish(() => { this.teleportFar(this.pos); this.state = 'roam'; this.cool = 10 * D.cool; }); }
      return;
    }
    this.rage = Math.max(0, this.rage - dt);
    // ---------------- the child sometimes just stands and stares... then giggles and is gone
    this.stareCool -= dt;
    if (this.type === 'child' && this.state === 'stare') {
      this.timer -= dt; this.moveSpeed = 0; this.speed = 0;
      if (this.stareAt) this.faceTowards(this.stareAt.pos, dt, 5);
      if (this.timer <= 0) { this.say('alert', 0.9); this.state = 'retreat'; this.vanish(() => { this.teleportFar(this.pos); this.state = 'roam'; }); }
      return;
    }
    if (this.type === 'child' && this.stareCool <= 0 && (this.state === 'roam' || this.state === 'investigate')) {
      for (const pl of players) {
        if (!pl.alive || pl.hiding || !pl.lookDir) continue;
        const to = new THREE.Vector3().subVectors(eye, pl.eye); const d = to.length();
        if (d < 4 || d > 13) continue;
        if (pl.lookDir.dot(to.divideScalar(d)) < 0.85 || !L.los(pl.eye, eye)) continue;
        this.state = 'stare'; this.timer = 2.4 + this.rng.next() * 1.5; this.stareAt = pl; this.stareCool = 45 + this.rng.next() * 40;
        this.play(this.P.anims.stare, 0.4);
        if (this.rng.chance(0.5)) this.say('idle2', 0.8);
        return;
      }
    }
    // ---------------- the warden follows your scent trail
    if (this.type === 'warden' && (this.state === 'roam' || this.state === 'search') && this.cool <= 0) {
      this.scentT -= dt;
      if (this.scentT <= 0) {
        this.scentT = 5;
        const trail = g.scentTrail?.(this.pos, this.layer);
        if (trail) { this.state = 'track'; this.goTo(trail); this.timer = 9; }
      }
    }

    // lure (music box)
    if (this.lure && ['roam', 'search', 'investigate', 'track', 'lured'].includes(this.state)) {   // never pulls her off a hunt
      if (this.state !== 'lured') { this.state = 'lured'; this.goTo(this.lure); }
      this.lure.t -= dt;
      if (this.lure.t <= 0) { this.lure = null; this.state = 'roam'; }
    }

    // ---------------- state behaviours
    let speed = 0;
    switch (this.state) {
      case 'alert':
        this.faceTowards(this.target.pos, dt, 8);
        if (this.timer <= 0) { this.state = 'chase'; this.chaseT = 0; this.path = null; this.repathT = 0; }
        break;
      case 'chase': {
        this.chaseT += dt;
        const t = this.target;
        if (!t || !t.alive || t.caught) { this.state = 'search'; this.timer = P.search; break; }
        // saw them hide: walk straight to the spot and drag them out
        if (t.hideSpot && this.seenHide === t.hideSpot) {
          const st = t.hideSpot.stand;
          this.lastSeenT = 0;
          if (this.repathT <= 0) { this.goTo({ x: st.x, z: st.z, l: L.layerOfY(st.y + 0.3) }); this.repathT = 0.6; }
          speed = P.chase * D.speed * (this.shy || 1);
          if (Math.hypot(st.x - this.pos.x, st.z - this.pos.z) < 0.9) { speed = 0; this.state = 'grab'; this.checkSpot(t.hideSpot); }
          break;
        }
        const visibleNow = this.lastSeenT < 0.2;
        const goal = visibleNow ? t.pos : this.lastSeen.clone().addScaledVector(this.lastSeenVel, Math.min(this.lastSeenT, 1.6));
        if (this.repathT <= 0) { this.goTo({ x: goal.x, z: goal.z, l: L.layerOfY((visibleNow ? t.pos.y : this.lastSeen.y) + 0.3) }); this.repathT = visibleNow ? 0.35 : 0.8; }
        speed = P.chase * D.speed * Math.min(1, 0.72 + this.chaseT * 0.14) * (this.shy || 1);
        if (this.hunt > 0) speed *= 1.06;
        if (this.rage > 0) speed *= 1.18;
        if (this.lastSeenT > P.giveUp) { this.state = 'search'; this.timer = P.search; this.searchCenter = this.lastSeen.clone(); this.path = null; g.onLost?.(this); }
        if (this.voiceT <= 0) { this.say('chase', 0.9); this.voiceT = this.rng.range(3, 6); }
        const d = Math.hypot(t.pos.x - this.pos.x, t.pos.z - this.pos.z);
        if (d < P.attack && visibleNow && this.cool <= 0 && Math.abs(t.pos.y - this.pos.y) < 1.2) this.attack(t);
        // right on top of the victim while recovering: hover menacingly instead of clipping into them
        if (d < 0.9) speed = 0;
        // child sometimes drops into a spider-crawl mid chase
        if (this.type === 'child') this.crawl = this.chaseT % 9 > 5;
        break;
      }
      case 'attack':
        speed = 0;
        if (this.timer <= 0) { this.state = 'chase'; this.cool = 2.2; this.path = null; }
        break;
      case 'search': {
        if (!this.path || this.pi >= this.path.length) {
          // check a nearby hiding spot or wander around the last known position
          const spot = this.nearbyHideSpot(this.searchCenter || this.pos);
          if (spot && this.rng.chance(0.55) && !spot.checked) {
            spot.checked = 6;
            this.checking = spot;
            this.goTo({ x: spot.stand.x, z: spot.stand.z, l: L.layerOfY(spot.stand.y + 0.3) });
          } else {
            const c = this.searchCenter || this.pos;
            const p = { x: c.x + this.rng.range(-5, 5), z: c.z + this.rng.range(-5, 5), l: L.layerOfY(c.y + 0.3) };
            if (!this.goTo(p)) this.goTo(this.randomRoomPoint(c, 10));
          }
          this.pause = this.rng.range(0.8, 2.2);
        }
        speed = P.walk * 1.35 * D.speed;
        if (this.checking && Math.hypot(this.checking.stand.x - this.pos.x, this.checking.stand.z - this.pos.z) < 0.7) {
          this.checkSpot(this.checking); this.checking = null;
        }
        if (this.timer <= 0) { this.state = 'retreat'; this.vanish(() => { this.teleportFar(this.pos); this.state = 'roam'; this.cool = 8 * D.cool; }); }
        break;
      }
      case 'investigate':
        speed = P.walk * 1.5 * D.speed;
        if (!this.path || this.pi >= this.path.length || this.timer <= 0) { this.state = 'search'; this.timer = P.search * 0.5; this.searchCenter = this.pos.clone(); }
        break;
      case 'lured':
        speed = P.walk * 1.6;
        if (!this.path || this.pi >= this.path.length) speed = 0;
        break;
      case 'retreat':
        speed = 0;
        break;
      case 'track':
        speed = P.walk * 1.25 * D.speed;
        if (this.voiceT <= 0) { this.say('idle2', 0.8); this.voiceT = this.rng.range(3, 6); }
        if (!this.path || this.pi >= this.path.length || this.timer <= 0) { this.state = 'search'; this.timer = 6; this.searchCenter = this.pos.clone(); }
        break;
      case 'roam':
      default:
        if (!this.path || this.pi >= this.path.length) {
          if (this.pauseT === undefined || this.pauseT <= 0) {
            // during hunts roam toward players; otherwise wander the house
            if (this.hunt > 0 && players.length) {
              const t = this.rng.pick(players.filter((p) => p.alive)) || players[0];
              this.goTo({ x: t.pos.x + this.rng.range(-4, 4), z: t.pos.z + this.rng.range(-4, 4), l: L.layerOfY(t.pos.y + 0.3) }) || this.goTo(this.randomRoomPoint());
            } else this.goTo(this.randomRoomPoint());
            this.pauseT = this.rng.range(1.5, 5);
          } else this.pauseT -= dt;
        }
        speed = P.walk * D.speed * (this.hunt > 0 ? 1.4 : 1);
        if (this.voiceT <= 0) { this.say(this.rng.chance(0.7) ? 'ambient' : 'idle2', 0.7); this.voiceT = this.rng.range(8, 18); }
        break;
    }
    this.followPath(dt, speed);
  }

  nearStairs(p) {
    const s = this.game.level.stairs;
    return s && p.x > s.x - 1 && p.x < s.x + s.w + 1 && p.z > s.z - 1 && p.z < s.z + s.d + 1;
  }

  nearbyHideSpot(c) {
    const L = this.game.level;
    let best = null, bd = 9;
    for (const r of L.rooms) for (const s of r.hideSpots) {
      const d = Math.hypot(s.pos.x - c.x, s.pos.z - c.z);
      if (d < bd && Math.abs(s.pos.y - c.y) < 3) { bd = d; best = s; }
    }
    return best;
  }

  checkSpot(spot) {
    const occ = this.game.agents().find((a) => a.hideSpot === spot) || null;
    this.play(this.P.anims.search || this.P.anims.idle, 0.3);
    this.faceTowards(spot.pos, 1, 50);
    if (!occ) { this.game.net.spotOpen?.(spot); this.game.flingHideSpot?.(spot); return; }
    const saw = this.seenHide === spot;
    const chance = saw ? 1 : occ.holdingBreath ? 0.0 : 0.35;
    if (this.rng.next() < chance) {
      this.game.pullOutOfHiding(this, occ, spot);
    } else {
      this.game.flingHideSpot?.(spot, true);
    }
  }

  /** A flashlight beam in the face. */
  onLight(pl) {
    this.lightCool = this.P.light === 'rage' ? 8 : 14;
    this.lightFrom = pl.pos.clone();
    this.state = 'flinch';
    this.flinchT = this.P.light === 'rage' ? 1.1 : 1.5;
    this.path = null;
    this.play(this.P.anims.flinch, 0.12, true, this.type === 'child' ? 1.4 : 1.1);
    this.say('flinch', 1);
    this.game.onGhostLit?.(this, pl);
  }

  blinkBehind(pl) {
    const L = this.game.level;
    const back = new THREE.Vector3(-Math.sin(pl.yaw || 0), 0, -Math.cos(pl.yaw || 0));
    const p = pl.pos.clone().addScaledVector(back, -4.5);
    const room = L.roomAt(p.x, p.z, L.layerOfY(pl.pos.y + 0.3));
    if (!room) return;
    this.vanish(() => { this.setPos(new THREE.Vector3(p.x, L.heightAt(p.x, p.z, L.layerOfY(pl.pos.y + 0.3)), p.z), this.yaw); this.dissolveTarget = 0; this.path = null; });
  }

  attack(t) {
    const g = this.game;
    this.state = 'attack'; this.timer = 1.2; this.moveSpeed = 0;
    this.faceTowards(t.pos, 1, 60);
    const lethal = t.health - this.P.damage * (this.diff.speed > 1 ? 1.2 : 1) <= 0 || this.type === 'warden';
    if (lethal) {
      this.state = 'grab';
      g.catchPlayer(this, t);
    } else {
      this.play(this.P.anims.attack, 0.1, true);
      audio.play('cleaver', { pos: this.pos, vol: this.type === 'warden' ? 1 : 0 });
      g.hitPlayer(this, t, this.P.damage);
    }
  }

  faceTowards(p, dt, k = 6) {
    const want = Math.atan2(p.x - this.pos.x, p.z - this.pos.z);
    this.yaw = dampAngle(this.yaw, want, k, dt);
  }

  followPath(dt, speed) {
    const L = this.game.level;
    this.smashT = Math.max(0, (this.smashT || 0) - dt);
    if (this.smashT > 0.9) { this.speed = 0; return; }          // mid-swing at a door
    this.moveSpeed += (speed - this.moveSpeed) * Math.min(1, dt * 4);
    if (!this.path || this.pi >= this.path.length || this.moveSpeed < 0.02) { this.speed = 0; return; }
    const wp = this.path[this.pi];
    if (this.type === 'child') {
      const v = L.doors.find((d) => d.kind === 'vent' && Math.hypot(d.x - this.pos.x, d.z - this.pos.z) < 1.6);
      this.ventCrawl = !!v;
    }
    const dx = wp.x - this.pos.x, dz = wp.z - this.pos.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.35 || (wp.l !== this.layer && d < 0.8)) { this.pi++; return; }
    const step = Math.min(d, this.moveSpeed * dt);
    this.pos.x += dx / d * step; this.pos.z += dz / d * step;
    const l = L.stairs && this.nearStairs(this.pos) ? wp.l : this.layer;
    this.pos.y = L.heightAt(this.pos.x, this.pos.z, l);
    this.yaw = dampAngle(this.yaw, Math.atan2(dx, dz), 7, dt);
    this.speed = step / dt;
    // open doors in the way
    for (const door of L.doors) {
      if (door.kind === 'arch' || door.kind === 'vent' || door.kind === 'gate' || door.open) continue;
      if (Math.abs(door.y - this.pos.y) > 2) continue;
      const dd = Math.hypot(door.x - this.pos.x, door.z - this.pos.z);
      if (this.type === 'warden' && dd < 1.5 && !door.locked && door.kind !== 'vent' && door.kind !== 'gate' && this.smashT <= 0) {
        // he doesn't open doors - he breaks them in
        this.smashT = 1.6; this.play(this.P.anims.smash, 0.12, true, 1.2);
        setTimeout(() => this.game.ghostOpensDoor(door, this.pos, true, true), 420);
      } else if (dd < 1.1 && this.type !== 'warden') {
        this.game.ghostOpensDoor(door, this.pos, this.state === 'chase');
      }
    }
    // stuck detection
    this.stuckT += dt;
    if (this.stuckT > 2) {
      if (this.pos.distanceTo(this.lastPos) < 0.3) { this.path = null; this.repathT = 0; }
      this.lastPos.copy(this.pos); this.stuckT = 0;
    }
  }

  // ------------------------------------------------------------------ per-frame (all peers)
  update(dt) {
    const P = this.P;
    this.uniforms.uGTime.value += dt;
    this.dissolve += (this.dissolveTarget - this.dissolve) * Math.min(1, dt * 2.5);
    if (Math.abs(this.dissolve - this.dissolveTarget) < 0.02) {
      this.dissolve = this.dissolveTarget;
      if (this.dissolve === 1 && this.afterVanish) { const f = this.afterVanish; this.afterVanish = null; f(); }
    }
    this.uniforms.uDissolve.value = this.dissolve;
    this.uniforms.uRim.value = 0.25 + 0.2 * Math.sin(this.uniforms.uGTime.value * 2) + (this.state === 'chase' ? 0.25 : 0);
    this.root.visible = this.dissolve < 0.99 && this.visible;
    // locomotion animation (host decides; clients use net anim)
    if (this.game.isHost && !['alert', 'attack', 'grab', 'retreat', 'flinch', 'stare'].includes(this.state) && this.stun <= 0 && !(this.smashT > 0.9)) {
      const sp = this.speed;
      let a = P.anims.idle;
      if (this.state === 'search' && sp < 0.1) a = P.anims.search || P.anims.idle;
      else if ((this.ventCrawl || (this.crawl && sp > 2.2)) && P.anims.crawl) a = P.anims.crawl;
      else if (this.type === 'widow' && this.state === 'chase' && sp > 0.1 && sp < 3.2) a = P.anims.reach;   // arms out, reaching
      else if (sp > 2.2) a = P.anims.run;
      else if (sp > 0.1) a = P.anims.walk;
      let ts = sp > 2.2 ? clamp(sp / (P.chase * 0.95), 0.8, 1.35) : sp > 0.1 ? clamp(sp / P.walk, 0.7, 1.7) : 1;
      if (this.type === 'warden' && sp > 0.1) ts = clamp(sp / 1.1, 0.8, 2.6);           // one heavy stride, faster when he hunts
      if (a === P.anims.crawl) ts = clamp(sp / 1.2, 0.8, 2.2);
      this.play(a, 0.35, false, ts);
    }
    this.mixer.update(dt);
    this.updateFace(dt);
    this.root.position.copy(this.pos); this.root.rotation.y = this.yaw;
    // eyes on the prey: the chase target, the one she stares at, or whoever she holds
    const want = this.lookTarget || (this.state === 'chase' && this.target ? this.target.eye : this.state === 'stare' && this.stareAt ? this.stareAt.eye : null);
    this.lookW += ((want ? 1 : 0) - this.lookW) * Math.min(1, dt * 5);
    if (want) this._look = want.clone ? want.clone() : want;
    if (this._look && this.lookW > 0.01) { this.root.updateMatrixWorld(true); this.aimHead(this._look, this.lookW); }
    if (this.physics && this.dissolve < 0.95) this.physics.update(dt);
    if (this.postAnim) this.postAnim(dt);
    this.voiceT2 = (this.voiceT2 || 0) - dt;
    if (this.voice && this.voiceT2 <= 0) { this.voiceT2 = 0.15; this.voice.setPos(this.headWorld()); }
    this.root.position.copy(this.pos);
    this.root.position.y += P.float * (1 + Math.sin(this.uniforms.uGTime.value * 1.3) * 0.4);
    this.root.rotation.y = this.yaw;
    // footsteps / chain
    this.stepT -= dt * Math.max(this.speed, 0);
    if (this.stepT <= 0 && this.speed > 0.2 && this.dissolve < 0.5) {
      this.stepT = this.type === 'warden' ? 1.35 : 0.9;
      const pos = this.pos.clone().setY(this.pos.y + 0.2);
      if (P.step === 'heavy') { audio.play('heavy_step', { pos, vol: 1, ref: 3 }); if (this.rng.chance(0.75)) audio.play('chain', { pos: pos.clone().setY(pos.y + 0.8), vol: 0.85, ref: 3.5 }); }
      else if (P.step === 'light') audio.play('footstep', { pos, surface: 'wood', intensity: 0.45, ref: 1.5 });
    }
  }

  serialize() {
    return [this.id, +this.pos.x.toFixed(2), +this.pos.y.toFixed(2), +this.pos.z.toFixed(2), +this.yaw.toFixed(2), this.animName || '', +this.dissolve.toFixed(2), this.state];
  }

  applyNet(s, dt) {
    const [, x, y, z, yaw, anim, d, state] = s;
    this.pos.lerp(new THREE.Vector3(x, y, z), Math.min(1, dt * 12));
    this.yaw = dampAngle(this.yaw, yaw, 12, dt);
    this.dissolveTarget = d; this.state = state;
    const moved = this.pos.distanceTo(this.lastNetPos || this.pos);
    this.speed = moved / Math.max(dt, 1e-3);
    this.lastNetPos = this.pos.clone();
    if (anim && anim !== this.animName) this.play(anim, 0.3, /Attack|Grab|Scream|Roar|Giggle|Flinch|Smash/.test(anim));
  }
}

export const GHOST_FH = FH;
