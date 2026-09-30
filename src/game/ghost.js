// Ghost AI. The host runs the "brain" (perception + state machine + pathing); every peer runs the "body"
// (animation, voices, footsteps, dissolve) from replicated state so everyone sees and hears the same thing.
import * as THREE from 'three';
import { Avatar } from './avatar.js';
import { audio } from '../audio/audio.js';
import { clamp, dampAngle, angleDiff, RNG } from '../core/util.js';
import { FH } from '../world/level.js';

export const GHOST_DEF = {
  widow: {
    name: 'The Widow', walk: 1.35, run: 4.25, walkRef: 1.25, runRef: 3.9,
    sight: 17, fov: 1.0, hearing: 1.0, memory: 9, chaseMax: 45, reach: 1.25,
    anims: { idle: 'Idle', walk: 'Glide', run: 'Chase', search: 'Search', alert: 'Scream', attack: 'Attack', grab: 'Grab', stare: 'Stare' },
    voice: { ambient: ['weep', 'whisper', 'weep'], alert: 'scream', chase: ['wail', 'whisper'], search: ['whisper', 'weep'], grab: 'scream' },
    ambientGap: [9, 20], chaseGap: [3.5, 6], flashStun: true, doors: 'open', vent: false, eye: 1.62,
    subs: { alert: 'The Widow shrieks', ambient: '(distant weeping)' },
  },
  child: {
    name: 'The Hollow Child', walk: 1.15, run: 5.15, walkRef: 1.0, runRef: 4.4,
    sight: 9, fov: 0.95, hearing: 2.1, memory: 5, chaseMax: 8, reach: 1.1,
    anims: { idle: 'Idle', walk: 'Walk', run: 'Run', crawl: 'Crawl', search: 'Search', alert: 'Giggle', attack: 'Attack', grab: 'Grab', stare: 'Stare' },
    voice: { ambient: ['hum', 'giggle', 'hum'], alert: 'giggle', chase: ['giggle'], search: ['hum'], grab: 'scream' },
    ambientGap: [8, 16], chaseGap: [2.5, 4.5], tease: true, doors: 'open', vent: true, eye: 1.05,
    subs: { alert: 'A child giggles', ambient: '(a child humming)' },
  },
  warden: {
    name: 'The Warden', walk: 1.2, run: 3.95, walkRef: 1.1, runRef: 3.2,
    sight: 14, fov: 1.1, hearing: 1.25, memory: 18, chaseMax: 70, reach: 1.45,
    anims: { idle: 'Idle', walk: 'Walk', run: 'Run', search: 'Search', alert: 'Roar', attack: 'Attack', grab: 'Grab' },
    voice: { ambient: ['chain', 'growl', 'chain'], alert: 'roar', chase: ['growl', 'chain'], search: ['growl'], grab: 'roar' },
    ambientGap: [6, 12], chaseGap: [2.5, 4], tracker: true, doors: 'smash', vent: false, eye: 1.9,
    subs: { alert: 'The Warden ROARS', ambient: '(a chain drags somewhere)' },
  },
};

const DIFF = {
  easy: { speed: 0.86, sense: 0.78, cool: 1.35, dmg: 0.75 },
  normal: { speed: 1.0, sense: 1.0, cool: 1.0, dmg: 1.0 },
  nightmare: { speed: 1.1, sense: 1.28, cool: 0.7, dmg: 1.3 },
};

// states replicated as small ints
export const S = { dormant: 0, appear: 1, roam: 2, linger: 3, investigate: 4, search: 5, alert: 6, chase: 7, attack: 8, grab: 9, vanish: 10, stare: 11, check: 12, recoil: 13 };
const SN = Object.fromEntries(Object.entries(S).map(([k, v]) => [v, k]));

const _v = new THREE.Vector3(), _v2 = new THREE.Vector3();

export class Ghost {
  constructor(game, type, id, authority) {
    this.game = game;
    this.type = type;
    this.id = id;
    this.def = GHOST_DEF[type];
    this.auth = authority;
    this.diff = DIFF[game.config.difficulty] || DIFF.normal;
    this.avatar = new Avatar(type);
    game.scene.add(this.avatar.root);
    this.pos = new THREE.Vector3();
    this.yaw = 0;
    this.layer = 0;
    this.state = S.dormant;
    this.stateT = 0;
    this.path = null; this.pathI = 0; this.repathT = 0;
    this.target = null;             // player record being chased
    this.lastKnown = null;          // { x, y, z, l }
    this.lastSeenT = -99;
    this.chaseT = 0;
    this.aware = {};                // playerId -> 0..1
    this.speed = 0; this.curSpeed = 0;
    this.dissolve = 1;
    this.voiceT = 3 + Math.random() * 6;
    this.stepT = 0;
    this.stuckT = 0; this.lastPos = new THREE.Vector3();
    this.cooldown = 0;
    this.heardT = 0;
    this.rng = new RNG((game.seed * 31 + id * 977) >>> 0);
    this.net = { pos: new THREE.Vector3(), yaw: 0, t: 0 };
    this.visibleToLocal = false;
    this.flashStunT = 0;
    this.lastAlertT = -99;
    this.hideCheck = null;
    this.avatar.setDissolve(1);
    this.anim = '';
    this.grabVictim = null;
  }

  get eye() { return _v.set(this.pos.x, this.pos.y + this.def.eye, this.pos.z); }
  get stateName() { return SN[this.state]; }

  setState(s, t = 0) {
    this.state = s; this.stateT = t;
    this.game.onGhostState?.(this, s);
  }

  // =========================================================================== host brain
  spawnAt(p) {
    this.pos.set(p.x, p.y, p.z);
    this.layer = p.l;
    this.yaw = this.rng.next() * Math.PI * 2;
    this.setState(S.appear, 1.2);
    this.path = null;
  }

  mult() {
    const g = this.game;
    const agg = 1 + g.aggression * 0.06 + (g.hunt > 0 ? 0.1 : 0);
    return this.diff.speed * agg;
  }

  think(dt) {
    const g = this.game, L = g.level;
    this.stateT -= dt;
    this.cooldown -= dt;
    this.flashStunT -= dt;
    const st = this.state;

    if (st === S.dormant) {
      if (this.stateT <= 0) {
        const p = g.findGhostSpawn(this);
        if (p) this.spawnAt(p); else this.stateT = 2;
      }
      return;
    }
    if (st === S.appear) { if (this.stateT <= 0) this.setState(S.roam); return; }
    if (st === S.vanish) {
      if (this.stateT <= 0) { this.setState(S.dormant, this.banishT || (10 + this.rng.next() * 12) * this.diff.cool); this.banishT = 0; this.pos.y = -100; }
      return;
    }
    if (st === S.grab) { if (this.stateT <= 0) this.vanish(); return; }
    if (st === S.recoil || st === S.stare) {
      if (this.stateT <= 0) { if (this.teaseVanish) { this.teaseVanish = false; this.vanish(); } else this.resumeAfterPause(); return; }
      if (!this.teaseVanish) this.perceive(dt);
      return;
    }
    if (st === S.attack) {
      if (!this.attackHit && this.stateT < 0.55) {
        this.attackHit = true;
        const p = this.target;
        if (p && p.alive && !p.hidden && p.pos.distanceTo(this.pos) < this.def.reach + 0.55 && Math.abs(p.pos.y - this.pos.y) < 1.2) g.ghostHit(this, p);
      }
      if (this.stateT <= 0) { this.setState(S.recoil, 1.6 * this.diff.cool); }
      return;
    }
    if (st === S.alert) {
      if (this.target) this.faceTo(this.target.pos, dt, 10);
      if (this.stateT <= 0) { this.setState(S.chase); this.chaseT = 0; }
      return;
    }

    this.perceive(dt);
    if (this.state !== st) return;

    switch (st) {
      case S.roam:
        if (!this.path || this.pathDone()) { this.setState(S.linger, 2.5 + this.rng.next() * 5); this.path = null; }
        break;
      case S.linger:
        if (this.stateT <= 0) this.pickRoam();
        break;
      case S.investigate:
        if (!this.path || this.pathDone()) { this.setState(S.search, 4 + this.rng.next() * 4); this.path = null; this.maybeCheckHide(); }
        break;
      case S.search:
        if (this.stateT <= 0) { this.pickRoam(); }
        break;
      case S.check: {
        const hs = this.hideCheck;
        if (!hs) { this.pickRoam(); break; }
        if ((!this.path || this.pathDone()) && this.stateT > 1.6) this.stateT = 1.6;   // arrived: open doors
        if (this.stateT <= 1.6 && !this.checkOpened) {
          this.checkOpened = true;
          g.openHideSpot(hs, true);
          if (hs.occupant) {
            const p = g.playerById(hs.occupant);
            if (p) { this.target = p; this.grab(p, true); return; }
          }
        }
        if (this.stateT <= 0) { g.openHideSpot(hs, false); this.hideCheck = null; this.setState(S.search, 2); }
        break;
      }
      case S.chase: this.chase(dt); break;
      default: break;
    }
    // a roaming ghost with nothing to do drifts toward the "heat" (where players have been)
    if (this.state === S.roam && g.hunt > 0 && this.repathT <= 0) {
      const p = g.nearestPlayer(this.pos, true);
      if (p) { this.goTo(p.pos, p.layer, true); this.repathT = 5; }
    }
  }

  resumeAfterPause() {
    if (this.target && this.target.alive && this.game.time - this.lastSeenT < this.def.memory) { this.setState(S.chase); return; }
    this.pickRoam();
  }

  vanish() {
    this.setState(S.vanish, 1.3);
    this.path = null; this.target = null; this.grabVictim = null;
    for (const k of Object.keys(this.aware)) this.aware[k] = 0;
  }

  banish(seconds = 25) {
    this.vanish();
    this.banishT = seconds;
  }

  pickRoam() {
    const g = this.game, L = g.level;
    const rooms = L.rooms.filter((r) => r.type !== 'stairs' && !(r.keyRoom === 'iron' && !this.def.vent && this.game.isRoomSealed(r)));
    let total = 0;
    const w = rooms.map((r) => {
      let v = 1 + (g.heat[r.index] || 0) * 2.5;
      const d = Math.hypot(r.cx - this.pos.x, r.cz - this.pos.z);
      if (d < 4) v *= 0.3;                            // go somewhere else
      if (g.hunt > 0) { const p = g.nearestPlayer(new THREE.Vector3(r.cx, 0, r.cz), true); if (p && p.room === r) v *= 6; }
      for (const o of g.ghosts) if (o !== this && o.state !== S.dormant && Math.hypot(r.cx - o.pos.x, r.cz - o.pos.z) < 5) v *= 0.3;
      total += v; return v;
    });
    let x = this.rng.next() * total;
    let room = rooms[0];
    for (let i = 0; i < rooms.length; i++) { x -= w[i]; if (x <= 0) { room = rooms[i]; break; } }
    const p = L.randomPoint(this.rng, room);
    if (this.goTo(p, p.l)) this.setState(S.roam);
    else this.setState(S.linger, 1.5);
  }

  goTo(p, layer, keepState = false) {
    const L = this.game.level;
    const path = L.findPath({ x: this.pos.x, z: this.pos.z, l: this.layer }, { x: p.x, z: p.z, l: layer }, this.def.vent ? 'vent' : true);
    if (!path || path.length < 1) return false;
    this.path = path; this.pathI = 1;
    void keepState;
    return true;
  }

  pathDone() { return !this.path || this.pathI >= this.path.length; }

  faceTo(p, dt, rate = 8) {
    const want = Math.atan2(p.x - this.pos.x, p.z - this.pos.z);
    this.yaw = dampAngle(this.yaw, want, rate, dt);
  }

  // ------------------------------------------------------------------ perception
  perceive(dt) {
    const g = this.game, L = g.level;
    const sense = this.diff.sense * (g.hunt > 0 ? 1.2 : 1) * (1 + g.aggression * 0.04);
    const eye = this.eye.clone();
    const fwd = _v2.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    let best = null, bestScore = 0;
    for (const p of g.players) {
      if (!p.alive || p.caught) { this.aware[p.id] = 0; continue; }
      if (p.hidden) {
        // saw them climb in? then we know exactly where they are
        if (this.target === p && g.time - this.lastSeenT < 1.2 && p.hideSpot && !this.hideCheck && this.state === S.chase) this.beginCheck(p.hideSpot, true);
        this.aware[p.id] = Math.max(0, (this.aware[p.id] || 0) - dt);
        continue;
      }
      const pe = p.eye;
      const d = pe.distanceTo(eye);
      if (d > 30) { this.aware[p.id] = Math.max(0, (this.aware[p.id] || 0) - dt * 0.5); continue; }
      const dir = _v.copy(pe).sub(eye); dir.y = 0; dir.normalize();
      const ang = Math.acos(clamp(dir.dot(fwd), -1, 1));
      const chasing = this.state === S.chase && this.target === p;
      const fov = this.def.fov * (chasing ? 1.8 : 1);
      // light: their torch makes them visible from afar; a torch shone AT the ghost is noticed even from behind
      const lit = g.world.lightAt(pe);
      let range = this.def.sight * sense * (0.5 + lit * 0.6 + (p.flashOn ? 0.45 : 0)) * (p.crouch ? 0.68 : 1) * (p.speed < 0.3 ? 0.85 : 1);
      if (chasing) range = Math.max(range, 22);
      let seen = false;
      if (d < range && (ang < fov || d < 1.6)) seen = L.los(eye, pe);
      let beamOnMe = false;
      if (p.flashOn && d < 16) {
        const toMe = _v.copy(eye).sub(pe).normalize();
        if (toMe.dot(p.flashDir) > 0.93 && L.los(eye, pe)) { beamOnMe = true; if (!seen && d < 12) seen = true; }
      }
      if (beamOnMe && this.def.flashStun && this.flashStunT <= 0 && (this.state === S.chase || this.state === S.roam) && d < 9) {
        // The Widow flinches from direct light
        this.flashStunT = 6;
        this.setState(S.stare, 1.3);
        this.target = p; this.lastSeenT = g.time; this.lastKnown = { x: p.pos.x, y: p.pos.y, z: p.pos.z, l: p.layer };
        g.ghostEvent(this, 'flinch');
        return;
      }
      if (seen) {
        const rate = chasing ? 99 : (1.6 + 8 / Math.max(1, d)) * sense * (p.flashOn ? 1.3 : 1);
        this.aware[p.id] = Math.min(1.2, (this.aware[p.id] || 0) + rate * dt);
        const score = this.aware[p.id] * 10 - d;
        if (this.aware[p.id] >= 1 && (!best || score > bestScore)) { best = p; bestScore = score; }
      } else {
        this.aware[p.id] = Math.max(0, (this.aware[p.id] || 0) - dt * 0.35);
      }
    }
    if (best) {
      this.lastSeenT = g.time;
      this.lastKnown = { x: best.pos.x, y: best.pos.y, z: best.pos.z, l: best.layer };
      this.lastVel = best.vel ? best.vel.clone() : new THREE.Vector3();
      if (this.state !== S.chase || this.target !== best) {
        this.target = best;
        if (this.def.tease && this.state !== S.chase && best.pos.distanceTo(this.pos) > 7 && this.rng.chance(0.35)) {
          // the child sometimes just stares... then leaves
          this.setState(S.stare, 1.8);
          g.ghostEvent(this, 'tease');
          this.teaseVanish = true;
          return;
        }
        if (g.time - this.lastAlertT > 12) { this.lastAlertT = g.time; this.setState(S.alert, this.type === 'warden' ? 1.6 : 1.1); g.ghostEvent(this, 'alert'); if (this.type === 'warden') g.wardenRoar(this); }
        else { this.setState(S.chase); }
        this.chaseT = 0;
        this.path = null;
      }
      return;
    }
    // hearing (only when not already chasing someone we can see)
    if (this.state !== S.chase || g.time - this.lastSeenT > 1.5) {
      for (const n of g.noises) {
        if (n.t < this.heardT) continue;
        const sameL = n.l === this.layer || L.stairs && L.roomAt(n.pos.x, n.pos.z, n.l) === L.stairs;
        const eff = n.r * this.def.hearing * sense * (sameL ? 1 : 0.45);
        const d = n.pos.distanceTo(this.pos);
        if (d > eff) continue;
        this.heardT = g.time;
        if (this.state === S.chase) { this.lastKnown = { x: n.pos.x, y: n.pos.y, z: n.pos.z, l: n.l }; this.path = null; continue; }
        if (this.goTo(n.pos, n.l)) {
          this.setState(S.investigate);
          this.investigatePos = n.pos.clone();
          g.ghostEvent(this, 'hear');
        }
        break;
      }
    }
  }

  beginCheck(hs, knows) {
    this.hideCheck = hs;
    this.checkOpened = false;
    this.goTo(hs.stand, this.game.level.layerOfY(hs.stand.y + 0.5));
    this.setState(S.check, knows ? 5 : 6);
  }

  maybeCheckHide() {
    const g = this.game;
    // look into a nearby wardrobe now and then; much likelier if someone inside is breathing hard
    let bestHs = null, bd = 3.2;
    for (const r of g.level.rooms) for (const hs of r.hideSpots) {
      const d = hs.stand.distanceTo(this.pos);
      if (d < bd) { bd = d; bestHs = hs; }
    }
    if (!bestHs) return;
    let p = 0.12 + this.game.aggression * 0.03;
    if (bestHs.occupant) {
      const pl = g.playerById(bestHs.occupant);
      p = pl && pl.holdingBreath ? 0.08 : 0.55;
      if (this.investigatePos && this.investigatePos.distanceTo(bestHs.stand) < 2.5) p += 0.2;
    }
    if (this.rng.chance(p)) this.beginCheck(bestHs, false);
  }

  chase(dt) {
    const g = this.game;
    const p = this.target;
    this.chaseT += dt;
    if (!p || !p.alive || p.caught) { this.setState(S.search, 3); this.target = null; return; }
    const sinceSeen = g.time - this.lastSeenT;
    // The Warden always knows roughly where you went
    if (this.def.tracker && sinceSeen > 2 && sinceSeen < this.def.memory && Math.floor(this.chaseT * 0.25) !== Math.floor((this.chaseT - dt) * 0.25)) {
      this.lastKnown = { x: p.pos.x, y: p.pos.y, z: p.pos.z, l: p.layer };
      this.path = null;
    }
    if (sinceSeen > this.def.memory || (this.def.chaseMax && this.chaseT > this.def.chaseMax * (1 + g.aggression * 0.1))) {
      if (this.type === 'child') { g.ghostEvent(this, 'bored'); this.vanish(); return; }
      this.setState(S.search, 5); this.target = null; this.path = null; this.maybeCheckHide(); return;
    }
    const visible = sinceSeen < 0.25;
    const dist = p.pos.distanceTo(this.pos);
    if (visible && dist < this.def.reach && Math.abs(p.pos.y - this.pos.y) < 1.0 && this.cooldown <= 0) {
      if (p.health <= g.lethalAt(this)) this.grab(p);
      else { this.setState(S.attack, 1.0); this.attackHit = false; this.cooldown = 1.5; g.ghostEvent(this, 'attack'); }
      return;
    }
    this.repathT -= dt;
    if (this.repathT <= 0 || !this.path || this.pathDone()) {
      this.repathT = visible ? 0.25 : 0.6;
      const tgt = visible ? { x: p.pos.x, z: p.pos.z, l: p.layer } : this.lastKnown && { ...this.lastKnown };
      if (tgt && !visible && this.lastVel && sinceSeen < 1.5) { tgt.x += this.lastVel.x * 0.8; tgt.z += this.lastVel.z * 0.8; }
      if (tgt && !this.goTo(tgt, tgt.l)) {
        if (!visible) { this.setState(S.search, 4); this.path = null; }
      } else if (!visible && this.pathDone() && tgt) {
        this.setState(S.search, 4); this.maybeCheckHide();
      }
    }
    if (!visible && this.lastKnown && this.pathDone()) { this.setState(S.search, 4 + this.rng.next() * 3); this.path = null; this.maybeCheckHide(); }
  }

  grab(p, fromHide = false) {
    this.setState(S.grab, 3.4);
    this.path = null;
    this.grabVictim = p;
    this.game.ghostGrab(this, p, fromHide);
  }

  // ------------------------------------------------------------------ movement (host)
  move(dt) {
    const g = this.game, L = g.level;
    const st = this.state;
    const running = st === S.chase;
    const moving = (st === S.roam || st === S.investigate || st === S.chase || st === S.check) && this.path && !this.pathDone();
    let target = 0;
    if (moving) target = (running ? this.def.run * Math.min(1, 0.55 + this.chaseT * 0.35) : st === S.investigate ? this.def.walk * 1.35 : this.def.walk) * this.mult();
    if (this.flashStunT > 4.5) target *= 0.5;
    this.curSpeed += (target - this.curSpeed) * Math.min(1, dt * (running ? 3 : 5));
    if (moving) {
      const wp = this.path[this.pathI];
      const dx = wp.x - this.pos.x, dz = wp.z - this.pos.z;
      const d = Math.hypot(dx, dz);
      const step = this.curSpeed * dt;
      if (d <= Math.max(step, 0.15)) {
        this.pos.x = wp.x; this.pos.z = wp.z; this.layer = wp.l;
        this.pathI++;
      } else {
        this.pos.x += dx / d * step; this.pos.z += dz / d * step;
        this.yaw = dampAngle(this.yaw, Math.atan2(dx, dz), running ? 10 : 6, dt);
      }
      // doors on the way
      this.handleDoors();
      // stuck?
      if (this.lastPos.distanceTo(this.pos) < 0.02) { this.stuckT += dt; if (this.stuckT > 1.5) { this.stuckT = 0; this.path = null; if (st !== S.chase) this.pickRoam(); } }
      else this.stuckT = 0;
      this.lastPos.copy(this.pos);
    } else if (this.target && (st === S.chase || st === S.stare || st === S.attack)) this.faceTo(this.target.pos, dt, 10);
    const s = L.stairs;
    const inStair = s && this.pos.x > s.x && this.pos.x < s.x + s.w && this.pos.z > s.z && this.pos.z < s.z + s.d;
    this.pos.y = inStair ? L.heightAt(this.pos.x, this.pos.z, this.layer) : this.layer * FH;
    if (inStair) this.layer = L.layerOfY(this.pos.y + 0.2);
    this.speed = moving ? this.curSpeed : 0;
  }

  handleDoors() {
    const g = this.game;
    for (const d of g.level.doors) {
      if (d.open || d.kind === 'arch' || d.kind === 'vent' || d.kind === 'gate' || d.locked) continue;
      const dx = d.x - this.pos.x, dz = d.z - this.pos.z;
      if (dx * dx + dz * dz > 1.6 * 1.6 || Math.abs(d.y - this.pos.y) > 1.5) continue;
      // only if the door is ahead of us
      const f = Math.sin(this.yaw) * dx + Math.cos(this.yaw) * dz;
      if (f < -0.2) continue;
      g.ghostOpenDoor(this, d, this.def.doors === 'smash' && this.state === S.chase);
    }
  }

  // =========================================================================== body (all peers)
  applyNet(s, t) {
    // s: [x, y, z, yaw, state, speed, layer, dissolve]
    this.net.pos.set(s[0], s[1], s[2]);
    this.net.yaw = s[3];
    if (s[4] !== this.state) { this.state = s[4]; this.onStateChangeVisual(); }
    this.speed = s[5];
    this.layer = s[6];
    this.net.t = t;
    if (this.pos.y < -50 || this.pos.distanceTo(this.net.pos) > 4) { this.pos.copy(this.net.pos); this.yaw = this.net.yaw; }
  }

  onStateChangeVisual() {
    const g = this.game;
    const st = this.state;
    const pos = this.pos.clone().setY(this.pos.y + this.def.eye);
    if (st === S.alert) { this.say(this.def.voice.alert, 1.0, true); if (this.type !== 'child') g.stinger(this); }
    if (st === S.vanish) audio.play('vanish', { pos, vol: 0.8 });
    if (st === S.appear) audio.play('whoosh', { pos, vol: 0.4 });
  }

  say(name, vol = 0.8, sub = false) {
    const g = this.game;
    const pos = this.pos.clone().setY(this.pos.y + this.def.eye);
    const muffle = !g.level.los(pos, g.listenerPos());
    audio.play(name, { pos, vol, muffle, ref: 2.5, rolloff: 1.0 });
    if (sub && pos.distanceTo(g.listenerPos()) < 22) g.hud.subtitle(this.def.subs.alert, 2.2);
  }

  present(dt) {
    const g = this.game;
    if (!this.auth) {
      // smooth toward the replicated transform (snapshots arrive ~15 Hz)
      this.pos.lerp(this.net.pos, Math.min(1, dt * 12));
      this.yaw = dampAngle(this.yaw, this.net.yaw, 12, dt);
    }
    const st = this.state;
    // dissolve
    const wantVis = st !== S.dormant && st !== S.vanish;
    const tgt = wantVis ? 0 : 1;
    this.dissolve += (tgt - this.dissolve) * Math.min(1, dt * (st === S.appear ? 1.4 : 2.2));
    if (st === S.dormant) this.dissolve = 1;
    this.avatar.setDissolve(this.dissolve, st === S.appear || st === S.vanish ? 0.4 : 0);
    const R = this.avatar.root;
    R.position.copy(this.pos);
    R.rotation.y = this.yaw;
    if (st === S.dormant) return;
    // animation
    const A = this.def.anims;
    let anim = A.idle, sp = 1, once = false;
    switch (st) {
      case S.roam: case S.investigate: case S.check:
        if (this.speed > 0.05) { anim = A.walk; sp = this.speed / this.def.walkRef; } else anim = A.search || A.idle;
        break;
      case S.chase:
        if (this.speed > 0.05) {
          anim = A.run; sp = this.speed / this.def.runRef;
          if (this.type === 'child' && A.crawl && (this.crawlMode ||= Math.random() < 0.002)) { anim = A.crawl; sp = this.speed / 3.2; }
        } else anim = A.idle;
        break;
      case S.linger: anim = A.idle; break;
      case S.search: anim = A.search || A.idle; break;
      case S.alert: anim = A.alert || A.idle; once = true; break;
      case S.attack: anim = A.attack; once = true; break;
      case S.grab: anim = A.grab; once = true; break;
      case S.stare: case S.recoil: anim = A.stare || A.idle; break;
      default: anim = A.idle;
    }
    if (st !== S.chase) this.crawlMode = false;
    if (anim !== this.anim) { this.avatar.play(anim, { fade: once ? 0.15 : 0.3, once }); this.anim = anim; }
    if (!once) this.avatar.setSpeed(clamp(sp, 0.4, 2.2));
    // head tracks the nearest visible player when staring / chasing
    const lp = g.localPlayerRec();
    this.avatar.lookTarget = (st === S.stare || st === S.alert || st === S.linger || st === S.search) && lp && lp.eye.distanceTo(this.pos) < 10 ? lp.eye : null;
    this.avatar.update(dt);
    // sounds
    this.voiceT -= dt;
    if (this.voiceT <= 0) {
      const V = this.def.voice;
      if (st === S.chase) { this.say(this.pick(V.chase), 0.9); this.voiceT = this.range(this.def.chaseGap); }
      else if (st === S.search || st === S.investigate) { this.say(this.pick(V.search), 0.6); this.voiceT = this.range(this.def.ambientGap) * 0.7; }
      else if (st !== S.grab && st !== S.attack) {
        this.say(this.pick(V.ambient), 0.55);
        this.voiceT = this.range(this.def.ambientGap);
        const d = this.pos.distanceTo(g.listenerPos());
        if (d < 18 && Math.random() < 0.4) g.hud.subtitle(this.def.subs.ambient, 2);
      }
    }
    // footsteps
    if (this.speed > 0.1) {
      this.stepT -= dt * this.speed;
      if (this.stepT <= 0) {
        this.stepT = this.type === 'warden' ? 1.25 : this.type === 'child' ? 0.55 : 1.1;
        const pos = this.pos.clone();
        const muffle = !g.level.los(pos.clone().setY(pos.y + 1), g.listenerPos());
        if (this.type === 'warden') { audio.play('heavy_step', { pos, vol: 1.1, muffle, ref: 3 }); if (Math.random() < 0.5) audio.play('chain', { pos, vol: 0.5, muffle }); }
        else if (this.type === 'child') audio.play('footstep', { pos, surface: 'wood', intensity: st === S.chase ? 0.9 : 0.45, vol: 0.8, muffle });
        else if (st === S.chase) audio.play('footstep', { pos, surface: 'carpet', intensity: 0.7, vol: 0.7, muffle });
      }
    }
  }

  pick(a) { return Array.isArray(a) ? a[(Math.random() * a.length) | 0] : a; }
  range(r) { return r[0] + Math.random() * (r[1] - r[0]); }

  snapshot() {
    const q = (v) => Math.round(v * 100) / 100;
    return [q(this.pos.x), q(this.pos.y), q(this.pos.z), q(this.yaw), this.state, q(this.speed), this.layer, 0];
  }

  dispose() { this.avatar.dispose(); }
}

export { angleDiff };
