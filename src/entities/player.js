// First-person survivor controller.
import * as THREE from 'three';
import { input } from '../core/input.js';
import { settings, quality } from '../core/settings.js';
import { audio } from '../audio/audio.js';
import { cloneProp, applyLibrary } from '../core/assets.js';
import { clamp, damp, lerp } from '../core/util.js';
import { FH } from '../world/level.js';

const STAND = { eye: 1.56, h: 1.74 }, CROUCH = { eye: 0.82, h: 0.95 }, SLIDE = { eye: 0.62, h: 0.75 }, PRONE = { eye: 0.3, h: 0.42 };
const SPEED = { walk: 2.75, sprint: 5.35, crouch: 1.45 };

function makeCookie() {
  // soft reflector profile: bright core, wide smooth falloff, faint uneven spill. No rings.
  const n = 256, c = document.createElement('canvas'); c.width = c.height = n;
  const g = c.getContext('2d');
  const img = g.createImageData(n, n);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const dx = (x + 0.5) / n * 2 - 1, dy = (y + 0.5) / n * 2 - 1;
    const r = Math.hypot(dx, dy);
    const core = Math.exp(-r * r * 10) * 0.22;                           // hotspot
    const body = Math.pow(Math.cos(Math.min(r, 1) * Math.PI / 2), 1.3) * 0.78;  // broad pool
    const lens = 1 + 0.03 * Math.sin(Math.atan2(dy, dx) * 5 + r * 3);   // slight unevenness
    const v = Math.min(1, (core + body) * lens) * (r < 1 ? 1 : 0);
    const i = (y * n + x) * 4;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = Math.round(255 * Math.max(0, v)); img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Flashlight rig shared by the local player and remote avatars. */
export const FLASH = { color: 0xfff7ee, intensity: 42, angle: 0.72, penumbra: 0.35, decay: 1.7, range: 30 };
let COOKIE = null;
export function flashCookie() { return (COOKIE ||= makeCookie()); }

export class Player {
  constructor(game) {
    this.game = game;
    const q = quality();
    this.camera = new THREE.PerspectiveCamera(settings.fov, innerWidth / innerHeight, 0.05, 90);
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.yaw = 0; this.pitch = 0;
    this.eye = STAND.eye; this.h = STAND.h;
    this.state = 'stand';           // stand | crouch | slide
    this.slideT = 0;
    this.stamina = 100; this.exhausted = false; this.staminaDelay = 0;
    this.health = 100; this.sanity = 100;
    this.battery = 100;
    this.flashOn = true;
    this.adrenaline = 0;
    this.alive = true;
    this.hiding = null;
    this.breath = 1; this.holdingBreath = false;
    this.bob = 0; this.bobAmt = 0; this.lastStepPhase = 0;
    this.fear = 0; this.damage = 0;
    this.locked = false;           // cutscene control
    this.noise = [];
    this.inventory = new Array(6).fill(null);
    this.slot = 0;
    this.moving = false; this.sprinting = false;
    this.lookRoll = 0;

    // flashlight
    this.flash = new THREE.SpotLight(FLASH.color, 0, FLASH.range, FLASH.angle, FLASH.penumbra, FLASH.decay);
    this.flash.map = flashCookie();
    this.flash.castShadow = true;
    this.flash.shadow.mapSize.set(q.shadowSize, q.shadowSize);
    this.flash.shadow.bias = -0.0005; this.flash.shadow.radius = 3; this.flash.shadow.normalBias = 0.025;
    this.flash.shadow.camera.near = 0.15; this.flash.shadow.camera.far = FLASH.range;
    this.flashTarget = new THREE.Object3D();
    this.flash.target = this.flashTarget;
    this.flashDir = new THREE.Vector3(0, 0, -1);
    game.scene.add(this.flash, this.flashTarget);
    // wide, dim spill around the beam: real torches scatter light well outside the hotspot
    this.spill = new THREE.SpotLight(FLASH.color, 0, 14, 1.15, 1, 2);
    this.spill.castShadow = false;
    this.spill.target = this.flashTarget;
    game.scene.add(this.spill);
    // bounce fill: faint light where the beam lands (fakes GI so walls don't look pitch black around the spot)
    this.bounce = new THREE.PointLight(0xfff0e0, 0, 9, 1.4);
    game.scene.add(this.bounce);
    this.ray = new THREE.Raycaster();

    // viewmodel
    this.vm = new THREE.Group();
    this.vmFlash = cloneProp('items', 'Flashlight'); applyLibrary(this.vmFlash, { cast: false });
    this.vmFlash.scale.setScalar(1.0);
    this.vm.add(this.vmFlash);
    this.vmHeld = new THREE.Group();
    this.vm.add(this.vmHeld);
    this.camera.add(this.vm);
    this.vm.traverse((o) => { if (o.isMesh) { o.castShadow = false; o.renderOrder = 5; } });
    this.vmSway = new THREE.Vector2(); this.vmKick = 0;
    game.scene.add(this.camera);

    input.onLookDelta = (dx, dy) => {
      if (this.locked || !this.alive) return;
      if (this.hiding) {
        if (this.hideSeq) return;                                   // moving in/out: the camera is scripted
        const bed = this.hiding.kind === 'bed';
        this.yaw = clamp(this.yaw - dx, this.hiding.yaw - (bed ? 1.0 : 0.75), this.hiding.yaw + (bed ? 1.0 : 0.75));
        this.pitch = clamp(this.pitch - dy, bed ? -0.12 : -0.45, bed ? 0.16 : 0.35);
        return;
      }
      this.yaw -= dx;
      this.pitch = clamp(this.pitch - dy, -1.5, 1.5);
      this.vmSway.x += dx * 0.6; this.vmSway.y += dy * 0.6;
    };
  }

  get layer() { return this.game.level.layerOfY(this.pos.y + 0.3); }
  get eyePos() { return new THREE.Vector3(this.pos.x, this.pos.y + this.eye, this.pos.z); }
  get room() { return this.game.level.roomAt(this.pos.x, this.pos.z, this.layer); }

  spawnAt(p, yaw = 0) {
    this.pos.set(p.x, p.y, p.z);
    this.vel.set(0, 0, 0);
    this.yaw = yaw; this.pitch = 0;
    this.state = 'stand'; this.eye = STAND.eye; this.h = STAND.h;
  }

  emit(radius, kind = 'step') { this.noise.push({ x: this.pos.x, y: this.pos.y, z: this.pos.z, r: radius, kind }); }

  // ------------------------------------------------------------------ inventory
  give(type) {
    const i = this.inventory.findIndex((s) => s === null);
    if (i < 0) return false;
    this.inventory[i] = type;
    this.game.hud.hotbar(this);
    return true;
  }
  take(type) {
    const i = this.inventory.indexOf(type);
    if (i < 0) return false;
    this.inventory[i] = null;
    this.game.hud.hotbar(this);
    return true;
  }
  has(type) { return this.inventory.includes(type); }
  get held() { return this.inventory[this.slot]; }

  // ------------------------------------------------------------------ update
  update(dt) {
    const g = this.game, L = g.level;
    if (!this.alive) { this.updateCamera(dt); return; }
    // inventory selection
    for (let i = 0; i < 6; i++) if (input.hit('Digit' + (i + 1))) { this.slot = i; g.hud.hotbar(this); this.refreshHeld(); }
    if (input.wheel) { this.slot = (this.slot + (input.wheel > 0 ? 1 : 5)) % 6; g.hud.hotbar(this); this.refreshHeld(); }
    if (input.hit('KeyF') && !this.locked) this.toggleFlash();
    if (input.hit('KeyR') && this.has('battery') && this.battery < 95) { this.take('battery'); this.battery = 100; audio.play('battery'); g.hud.notify('Fresh battery', 1.5); }
    if ((input.hit('KeyQ') || input.clicked) && !this.locked && !this.hiding) g.items.useHeld(this);
    if (input.hit('KeyG') && this.held && !this.hiding) g.items.drop(this);

    if (this.hiding) { this.updateHiding(dt); this.updateCamera(dt); this.updateFlash(dt); return; }
    if (this.locked) { this.updateCamera(dt); this.updateFlash(dt); return; }

    // ---- input
    const f = (input.down('KeyW') ? 1 : 0) - (input.down('KeyS') ? 1 : 0);
    const s = (input.down('KeyD') ? 1 : 0) - (input.down('KeyA') ? 1 : 0);
    const wish = new THREE.Vector3(s, 0, -f);
    if (wish.lengthSq() > 1) wish.normalize();
    wish.applyAxisAngle(new THREE.Vector3(0, 1, 0), this.yaw);
    if (this.frozen > 0) { this.frozen -= dt; wish.set(0, 0, 0); }        // the Warden's roar
    this.moving = wish.lengthSq() > 0.01;
    const cDown = input.down('KeyC');
    const wantSprint = input.down('ShiftLeft') || input.down('ShiftRight');

    // ---- stance
    if (input.hit('KeyC') && this.state === 'stand' && this.sprinting && f > 0 && this.stamina > 15) {
      this.state = 'slide'; this.slideT = 0.95;
      const dir = new THREE.Vector3(0, 0, -1).applyAxisAngle(new THREE.Vector3(0, 1, 0), this.yaw);
      const sp = Math.max(this.vel.length(), SPEED.sprint) * 1.32;
      this.vel.copy(dir.multiplyScalar(sp));
      if (!this.adrenaline) this.stamina -= 16;
      this.staminaDelay = 1.0;
      this.emit(9, 'slide');
      audio.play('whoosh', { vol: 0.35 });
    } else if (cDown && this.state === 'stand') {
      this.state = 'crouch';
    } else if (!cDown && this.state === 'crouch') {
      if (this.canStand()) this.state = 'stand';
    }
    if (this.state === 'slide') {
      this.slideT -= dt;
      if (this.slideT <= 0) this.state = cDown || !this.canStand() ? 'crouch' : 'stand';
    }
    const tgt = this.state === 'stand' ? STAND : this.state === 'crouch' ? CROUCH : SLIDE;
    this.eye = damp(this.eye, tgt.eye, 12, dt);
    this.h = tgt.h;

    // ---- speed + stamina
    this.sprinting = wantSprint && this.moving && f > 0 && this.state === 'stand' && !this.exhausted && this.stamina > 0;
    let speed = this.state === 'crouch' ? SPEED.crouch : this.sprinting ? SPEED.sprint : SPEED.walk;
    if (this.adrenaline > 0) { speed *= 1.15; this.adrenaline -= dt; }
    if (this.health < 35) speed *= 0.88;
    if (this.sprinting && !this.adrenaline) { this.stamina -= 7 * dt; this.staminaDelay = 0.8; }
    else if (this.state !== 'slide') {
      this.staminaDelay -= dt;
      if (this.staminaDelay <= 0) this.stamina += (this.moving ? 11 : 17) * dt;
    }
    this.stamina = clamp(this.stamina, 0, 100);
    if (this.stamina <= 0) { this.exhausted = true; audio.play('breath_in', { intensity: 1.5 }); }
    if (this.exhausted && this.stamina > 30) this.exhausted = false;

    // ---- velocity
    if (this.state === 'slide') {
      const fr = Math.exp(-1.6 * dt);
      this.vel.multiplyScalar(fr);
      // light steering while sliding
      this.vel.addScaledVector(wish, dt * 2.5);
    } else {
      const target = wish.multiplyScalar(speed);
      const k = this.moving ? 14 : 18;
      this.vel.x = damp(this.vel.x, target.x, k, dt);
      this.vel.z = damp(this.vel.z, target.z, k, dt);
    }

    // ---- integrate + collide
    const prev = this.pos.clone();
    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.z * dt;
    const l = this.layer;
    L.collide(this.pos, 0.3, this.pos.y + 0.05, this.pos.y + this.h);
    // keep inside the map
    this.pos.x = clamp(this.pos.x, 0.3, L.W - 0.3); this.pos.z = clamp(this.pos.z, 0.3, L.D - 0.3);
    const gy = L.heightAt(this.pos.x, this.pos.z, l);
    this.pos.y = Math.abs(gy - this.pos.y) > 0.6 ? gy : damp(this.pos.y, gy, 20, dt);
    const moved = Math.hypot(this.pos.x - prev.x, this.pos.z - prev.z);
    if (moved < this.vel.length() * dt * 0.3) { this.vel.multiplyScalar(0.5); }

    // ---- head bob + footsteps
    const spd = moved / Math.max(dt, 1e-4);
    const stride = this.sprinting ? 1.05 : this.state === 'crouch' ? 0.62 : 0.78;
    if (spd > 0.2 && this.state !== 'slide') {
      this.bob += moved / stride * Math.PI;
      const phase = Math.floor(this.bob / Math.PI);
      if (phase !== this.lastStepPhase) {
        this.lastStepPhase = phase;
        this.footstep();
      }
    }
    this.bobAmt = damp(this.bobAmt, this.state === 'slide' ? 0 : Math.min(spd / SPEED.sprint, 1), 8, dt);

    // ---- interaction
    g.interact.update(this);

    // ---- breathing when exhausted
    this.breathT = (this.breathT || 0) - dt;
    if (this.stamina < 35 && this.breathT <= 0) {
      audio.play(Math.random() < 0.5 ? 'breath_in' : 'breath_out', { intensity: 1.4 - this.stamina / 50 });
      this.breathT = 0.7 + this.stamina / 60;
    }
    this.updateCamera(dt);
    this.updateFlash(dt);
    this.updateSanity(dt);
  }

  canStand() {
    const p = this.pos.clone();
    const L = this.game.level;
    for (const b of L.query(p.x, p.z, 0.6)) {
      if (p.y + STAND.h <= b.y0 || p.y + 0.9 >= b.y1) continue;
      const cx = Math.max(b.x0, Math.min(p.x, b.x1)), cz = Math.max(b.z0, Math.min(p.z, b.z1));
      if ((p.x - cx) ** 2 + (p.z - cz) ** 2 < 0.28 * 0.28) return false;
    }
    return true;
  }

  surfaceHere() {
    const r = this.room;
    if (!r) return 'wood';
    for (const g of r.rugs) if (this.pos.x > g.x0 && this.pos.x < g.x1 && this.pos.z > g.z0 && this.pos.z < g.z1) return 'carpet';
    return r.type === 'stairs' ? 'carpet' : r.surface;
  }

  footstep() {
    const inten = this.sprinting ? 1.2 : this.state === 'crouch' ? 0.35 : 0.7;
    const surf = this.surfaceHere();
    audio.play('footstep', { surface: surf, intensity: inten, vol: 0.9 });
    this.emit(this.sprinting ? 13 : this.state === 'crouch' ? 1.5 : surf === 'carpet' ? 3.5 : 5.5, 'step');
    this.game.net.stepEvent?.(surf, inten);
  }

  toggleFlash() {
    if (this.battery <= 0 && !this.flashOn) { audio.play('flashlight'); this.game.hud.notify('The battery is dead. [R] to replace', 2); return; }
    this.flashOn = !this.flashOn;
    audio.play('flashlight');
  }

  refreshHeld() {
    this.vmHeld.clear();
    const t = this.held;
    const map = { battery: 'Battery', medkit: 'Medkit', syringe: 'Syringe', pills: 'Pills', crucifix: 'Crucifix', fuse: 'Fuse', crowbar: 'Crowbar' };
    if (t && map[t]) {
      const o = cloneProp('items', map[t]); applyLibrary(o, { cast: false });
      o.traverse((m) => { if (m.isMesh) m.renderOrder = 5; });
      const scale = t === 'crowbar' ? 0.7 : t === 'medkit' ? 0.8 : 1.4;
      o.scale.setScalar(scale);
      o.rotation.set(-0.3, 0.6, 0.2);
      this.vmHeld.add(o);
    }
  }

  updateCamera(dt) {
    const c = this.camera;
    const bx = Math.sin(this.bob * 0.5) * 0.035 * this.bobAmt * (settings.headBob ? 1 : 0);
    const by = Math.abs(Math.sin(this.bob)) * 0.045 * this.bobAmt * (settings.headBob ? 1 : 0);
    if (!this.cinematic) {
      c.position.set(this.pos.x, this.pos.y + this.eye + by, this.pos.z);
      const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
      c.position.addScaledVector(right, bx);
      this.lookRoll = damp(this.lookRoll, this.state === 'slide' ? 0.06 : 0, 8, dt);
      c.rotation.set(this.pitch, this.yaw, this.lookRoll, 'YXZ');
      const sh = this.game.shake || 0;
      if (sh > 0.01) {
        c.position.x += (Math.random() - 0.5) * 0.05 * sh; c.position.y += (Math.random() - 0.5) * 0.05 * sh;
        c.rotation.z += (Math.random() - 0.5) * 0.03 * sh;
        this.game.shake = sh * Math.exp(-4 * dt);
      }
    }
    if (c.fov !== settings.fov) { c.fov = settings.fov; c.updateProjectionMatrix(); }
    // viewmodel sway / bob
    this.vmSway.multiplyScalar(Math.exp(-10 * dt));
    const sx = clamp(this.vmSway.x, -0.08, 0.08), sy = clamp(this.vmSway.y, -0.08, 0.08);
    const vb = Math.sin(this.bob) * 0.012 * this.bobAmt;
    this.vm.visible = !this.hiding && this.alive && !this.cinematic;
    this.vmFlash.position.set(0.2 - sx * 0.4, -0.22 + Math.abs(vb) - sy * 0.3 - (this.sprinting ? 0.03 : 0), -0.34);
    this.vmFlash.rotation.set(0.04 + sy * 1.5 + (this.sprinting ? -0.25 : 0), -0.04 + sx * 1.5, 0);
    this.vmHeld.position.set(-0.24 + sx * 0.3, -0.26 + vb, -0.42);
  }

  updateFlash(dt) {
    const cam = this.camera;
    cam.updateMatrixWorld();
    const on = this.flashOn && this.battery > 0 && this.alive && !this.cinematicNoFlash && !this.hiding;   // torch goes dark while hiding
    if (on) this.battery = Math.max(0, this.battery - dt * 100 / 420);
    if (this.battery <= 0 && this.flashOn) { this.flashOn = false; audio.play('flashlight'); this.game.hud.notify('Flashlight battery is dead', 2.5); }
    let flick = 1;
    if (on && this.battery < 15 && Math.random() < 0.08) flick = Math.random() * 0.4;
    if (on && this.game.ghostFlicker > 0 && Math.random() < this.game.ghostFlicker * 0.4) flick = Math.random() * 0.2;
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
    this.flashDir.lerp(fwd, 1 - Math.exp(-28 * dt)).normalize();
    const origin = this.hiding
      ? cam.position.clone()
      : new THREE.Vector3(0.2, -0.2, -0.35).applyMatrix4(cam.matrixWorld);
    this.flash.position.copy(origin);
    this.flashTarget.position.copy(origin).add(this.flashDir);
    // cutscenes: a dim, trembling torch so close-ups aren't blown out
    const mul = this.cinematic && !this.hiding ? 0.32 * (0.8 + Math.random() * 0.4) : 1;
    // eye adaptation: a wall right in front of the lens must not turn into a white disc
    const near = THREE.MathUtils.smoothstep(this.hitDist ?? 6, 0.25, 3.2);
    this.flashBase = damp(this.flashBase ?? 1, 0.16 + 0.84 * near, 6, dt);
    const level = on ? flick * mul * (0.6 + 0.4 * Math.min(1, this.battery / 30)) : 0;
    this.flash.intensity = FLASH.intensity * level * this.flashBase;
    this.spill.position.copy(origin);
    this.spill.intensity = 2.2 * level * this.flashBase;
    // bounce light at the hit point
    this.bounceT = (this.bounceT || 0) - dt;
    if (on && this.bounceT <= 0) {
      this.bounceT = 0.05;
      this.ray.set(origin, this.flashDir); this.ray.far = 12;
      const room = this.room;
      const hits = room ? this.ray.intersectObject(room.group, true) : [];
      const d = hits.length ? hits[0].distance : 12;
      this.hitDist = d;
      this.bounce.position.copy(origin).addScaledVector(this.flashDir, Math.max(0.3, d * 0.55));
      this.bounceTarget = 0.6 * (1 - d / 14);
    }
    this.bounce.intensity = damp(this.bounce.intensity, on ? (this.bounceTarget || 0) * flick * this.flashBase : 0, 12, dt);
  }

  updateSanity(dt) {
    const room = this.room;
    const lit = this.flashOn || (this.game.lights.powerLevel > 0.5 && room && room.lights.some((a) => a.level > 0.3));
    this.sanity = clamp(this.sanity + (lit ? 0.6 : -1.1) * dt - this.fear * 1.5 * dt, 0, 100);
  }

  // ------------------------------------------------------------------ hiding
  // Wardrobe: walk in, turn round, pull the doors to (they stay ajar - hold W to push them wider and see more,
  // at the risk of being seen). Bed: get down at the side and crawl underneath, looking back out at floor level.
  enterHide(spot) {
    if (spot.occupant) return;
    spot.occupant = this;
    this.hiding = spot;
    this.preHide = this.pos.clone();
    this.vel.set(0, 0, 0);
    this.cinematic = true;
    this.hideT = 0;
    this.hideSeq = { enter: true, t: 0, fromPos: this.camera.position.clone(), fromYaw: this.yaw, fromPitch: this.pitch };
    this.bounce.intensity = 0;
    if (spot.kind === 'bed') { audio.play('cloth', { pos: spot.stand }); setTimeout(() => audio.play('crawl', { pos: spot.pos }), 650); }
    else audio.play('hide_in', { pos: spot.pos });
    this.emit(spot.kind === 'bed' ? 2.5 : 4, 'hide');
  }

  exitHide(instant = false) {
    const spot = this.hiding;
    if (!spot) return;
    if (instant) { this.finishExit(); return; }
    if (this.hideSeq && !this.hideSeq.enter) return;
    this.hideSeq = { enter: false, t: 0 };
    if (spot.kind === 'bed') audio.play('crawl', { pos: spot.pos }); else audio.play('hide_out', { pos: spot.pos });
    this.holdingBreath = false;
    this.game.hud.breath(false);
  }

  finishExit() {
    const spot = this.hiding;
    spot.occupant = null;
    this.hiding = null; this.hideSeq = null;
    this.cinematic = false;
    this.pos.copy(spot.stand);
    this.yaw = spot.yaw; this.pitch = 0;
    this.state = 'stand'; this.eye = 1.56;
    this.game.hud.hideSlit(false);
    this.game.hud.breath(false);
    this.holdingBreath = false;
    if (spot.doorL) { spot.doorL.rotation.y = 0; spot.doorR.rotation.y = 0; }
  }

  /** Camera pose inside the hiding place (eye position + facing out). */
  hidePose(spot) {
    if (spot.kind === 'bed') return { pos: spot.pos.clone(), yaw: spot.yaw };
    return { pos: spot.pos.clone().addScaledVector(spot.front, -0.02), yaw: spot.yaw };
  }

  updateHiding(dt) {
    const s = this.hiding, cam = this.camera;
    const bed = s.kind === 'bed';
    const ease = (x) => { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); };
    const inPose = this.hidePose(s);
    const standEye = s.stand.clone().setY(s.stand.y + 1.56);
    const q = this.hideSeq;
    let door = 0.45;                                          // wardrobe doors: how far ajar
    if (q) {
      q.t += dt;
      if (q.enter) {
        if (bed) {
          // 0-0.5 step to the side, 0.5-1.1 drop to the floor facing the bed, 1.1-2.1 slide under and turn out
          const side = s.stand.clone().setY(s.stand.y + 0.32);
          const faceIn = s.yaw + Math.PI;
          if (q.t < 0.5) { cam.position.lerpVectors(q.fromPos, standEye, ease(q.t / 0.5)); this.yaw = lerpAngle(q.fromYaw, faceIn, ease(q.t / 0.5)); this.pitch = -0.3 * ease(q.t / 0.5); }
          else if (q.t < 1.1) { cam.position.lerpVectors(standEye, side, ease((q.t - 0.5) / 0.6)); this.yaw = faceIn; this.pitch = -0.3 + 0.2 * ease((q.t - 0.5) / 0.6); }
          else if (q.t < 2.1) { const k = ease((q.t - 1.1) / 1.0); cam.position.lerpVectors(side, inPose.pos, k); this.yaw = lerpAngle(faceIn, inPose.yaw, Math.max(0, (k - 0.4) / 0.6)); this.pitch = -0.1 * (1 - k); }
          else { this.hideSeq = null; this.yaw = inPose.yaw; this.pitch = 0; audio.play('bed_creak', { pos: s.pos, vol: 0.4 }); }
        } else {
          // 0-0.45 walk to the doors (they swing open), 0.45-1.0 step in and turn round, 1.0-1.5 pull the doors to
          const front = standEye;
          const inside = inPose.pos;
          if (q.t < 0.45) { cam.position.lerpVectors(q.fromPos, front, ease(q.t / 0.45)); this.yaw = lerpAngle(q.fromYaw, s.yaw + Math.PI, ease(q.t / 0.45)); this.pitch = 0; door = ease(q.t / 0.3) * 1.5; }
          else if (q.t < 1.0) { const k = ease((q.t - 0.45) / 0.55); cam.position.lerpVectors(front, inside, k); this.yaw = lerpAngle(s.yaw + Math.PI, s.yaw, k); door = 1.5; }
          else if (q.t < 1.5) { cam.position.copy(inside); this.yaw = s.yaw; door = 1.5 - 1.05 * ease((q.t - 1.0) / 0.5); }
          else { this.hideSeq = null; door = 0.45; }
        }
      } else {
        if (bed) {
          const side = s.stand.clone().setY(s.stand.y + 0.32);
          if (q.t < 0.9) { cam.position.lerpVectors(inPose.pos, side, ease(q.t / 0.9)); this.pitch = 0.05; }
          else if (q.t < 1.5) { cam.position.lerpVectors(side, standEye, ease((q.t - 0.9) / 0.6)); this.pitch = 0; }
          else { this.finishExit(); return; }
        } else {
          if (q.t < 0.25) { cam.position.copy(inPose.pos); door = 0.45 + 1.05 * ease(q.t / 0.25); }
          else if (q.t < 0.75) { cam.position.lerpVectors(inPose.pos, standEye, ease((q.t - 0.25) / 0.5)); door = 1.5; }
          else { if (s.doorL) { s.doorL.rotation.y = 0; s.doorR.rotation.y = 0; } this.finishExit(); return; }
        }
      }
    } else {
      this.hideT += dt;
      cam.position.copy(inPose.pos);
      if (bed) cam.position.y += Math.sin(this.hideT * 1.6) * 0.004;           // breathing against the floor
      // peek: hold W to ease the doors wider (and lean toward the gap)
      const peek = !bed && input.down('KeyW');
      this.peek = damp(this.peek || 0, peek ? 1 : 0, 5, dt);
      door = 0.45 + 0.55 * this.peek;
      if (!bed) cam.position.addScaledVector(s.front, 0.08 * this.peek);
      this.peekExposed = this.peek > 0.5;
      // hold breath
      this.holdingBreath = input.down('Space') && this.breath > 0;
      if (this.holdingBreath) this.breath = Math.max(0, this.breath - dt / 9);
      else this.breath = Math.min(1, this.breath + dt / 5);
      if (this.breath <= 0 && input.down('Space')) { audio.play('gasp', { vol: 0.9 }); this.emit(6, 'gasp'); this.breath = 0.15; }
      this.game.hud.breath(true, this.breath, this.holdingBreath);
      if (input.hit('KeyE') && this.hideT > 0.4) this.exitHide();
    }
    if (s.doorL) { s.doorL.rotation.y = -door; s.doorR.rotation.y = door; }
    cam.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
    this.game.hud.hideSlit(!q, bed);
    this.pos.set(s.pos.x, s.stand.y, s.pos.z);
  }
}

function lerpAngle(a, b, t) {
  let d = ((b - a + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
  return a + d * t;
}
