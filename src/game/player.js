// Local player: first-person controller with full-body awareness, stamina, crouch/slide, flashlight and hiding.
import * as THREE from 'three';
import { input } from '../core/input.js';
import { settings, quality } from '../core/settings.js';
import { audio } from '../audio/audio.js';
import { clamp, damp, lerp } from '../core/util.js';
import { FH } from '../world/level.js';
import { Avatar } from './avatar.js';

const STAND_H = 1.75, CROUCH_H = 0.85, RADIUS = 0.3;
const EYE_STAND = 1.63, EYE_CROUCH = 0.72;
const SPEED = { walk: 2.35, sprint: 4.7, crouch: 1.25, slide: 7.2 };
const STAM = { max: 100, sprintDrain: 5.5, slideCost: 16, regenWalk: 9, regenIdle: 15, delay: 0.9, exhaustedUntil: 30 };

// ---------------------------------------------------------------------------- flashlight cookie (lens pattern)
function beamCookie() {
  const s = 256, cv = document.createElement('canvas'); cv.width = cv.height = s;
  const g = cv.getContext('2d');
  const img = g.createImageData(s, s);
  for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
    const dx = (x - s / 2) / (s / 2), dy = (y - s / 2) / (s / 2);
    const r = Math.sqrt(dx * dx + dy * dy);
    let v = Math.max(0, 1 - r) ** 0.6;                       // wide soft spill
    v += Math.exp(-r * r * 26) * 0.9;                       // hot centre
    v += Math.exp(-((r - 0.36) ** 2) * 900) * 0.18;         // reflector ring
    v += Math.exp(-((r - 0.62) ** 2) * 600) * 0.1;
    v *= 0.92 + 0.08 * Math.sin(Math.atan2(dy, dx) * 9 + r * 20); // reflector facets
    v *= r > 0.98 ? 0 : 1;
    const c = Math.min(255, v * 200);
    const i = (y * s + x) * 4;
    img.data[i] = c; img.data[i + 1] = c * 0.96; img.data[i + 2] = c * 0.88; img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function beamMesh() {
  const len = 9, rad = Math.tan(0.52) * len;
  const g = new THREE.CylinderGeometry(0.03, rad, len, 40, 16, true);
  g.translate(0, -len / 2, 0);   // narrow tip at the origin, wide end at -Y
  g.rotateX(Math.PI / 2);        // -Y -> -Z : the beam opens along the view direction
  const m = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    uniforms: { uI: { value: 1 }, uTime: { value: 0 }, uLen: { value: len } },
    vertexShader: /* glsl */`
      varying float vAlong; varying vec3 vN; varying vec3 vV; varying vec3 vP;
      void main() {
        vAlong = clamp(-position.z / ${len.toFixed(1)}, 0.0, 1.0);
        vP = position;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */`
      uniform float uI, uTime; varying float vAlong; varying vec3 vN; varying vec3 vV; varying vec3 vP;
      float h(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
      float n3(vec3 x) { vec3 i = floor(x), f = fract(x); f = f*f*(3.0-2.0*f);
        return mix(mix(mix(h(i), h(i+vec3(1,0,0)), f.x), mix(h(i+vec3(0,1,0)), h(i+vec3(1,1,0)), f.x), f.y),
                   mix(mix(h(i+vec3(0,0,1)), h(i+vec3(1,0,1)), f.x), mix(h(i+vec3(0,1,1)), h(i+vec3(1,1,1)), f.x), f.y), f.z); }
      void main() {
        float facing = pow(abs(dot(vN, vV)), 1.6);                       // soft edges
        float fall = pow(1.0 - vAlong, 2.2) * smoothstep(0.0, 0.06, vAlong);
        float dust = 0.65 + 0.35 * n3(vP * 2.2 + vec3(0.0, uTime * 0.12, uTime * 0.05));
        float a = facing * fall * dust * 0.075 * uI;
        gl_FragColor = vec4(vec3(1.0, 0.95, 0.85) * a, 1.0);
      }`,
  });
  const mesh = new THREE.Mesh(g, m);
  mesh.frustumCulled = false;
  mesh.renderOrder = 5;
  return mesh;
}

// ---------------------------------------------------------------------------- floating dust lit by the torch
function dustPoints(n) {
  const g = new THREE.BufferGeometry();
  const p = new Float32Array(n * 3);
  for (let i = 0; i < n * 3; i++) p[i] = Math.random();
  g.setAttribute('position', new THREE.BufferAttribute(p, 3));
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
  const m = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { uCam: { value: new THREE.Vector3() }, uDir: { value: new THREE.Vector3(0, 0, -1) }, uOrg: { value: new THREE.Vector3() },
      uTime: { value: 0 }, uOn: { value: 1 }, uPx: { value: 1 } },
    vertexShader: /* glsl */`
      uniform vec3 uCam, uDir, uOrg; uniform float uTime, uPx; varying float vB;
      void main() {
        vec3 box = vec3(7.0, 4.0, 7.0);
        vec3 p = position * box;
        p += vec3(sin(uTime * 0.13 + position.y * 40.0), sin(uTime * 0.09 + position.x * 30.0) - uTime * 0.02, cos(uTime * 0.11 + position.z * 50.0)) * 0.35;
        p = mod(p - uCam + box * 0.5, box) + uCam - box * 0.5;
        vec3 d = p - uOrg; float dl = length(d);
        float cone = smoothstep(0.82, 0.93, dot(d / dl, uDir));
        vB = cone * smoothstep(9.0, 1.0, dl) * smoothstep(0.3, 0.9, dl);
        vec4 mv = viewMatrix * vec4(p, 1.0);
        gl_PointSize = clamp(uPx * 2.6 / -mv.z, 1.0, 6.0 * uPx);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */`
      uniform float uOn; varying float vB;
      void main() { float r = length(gl_PointCoord - 0.5); if (r > 0.5 || vB * uOn < 0.01) discard;
        gl_FragColor = vec4(vec3(1.0, 0.95, 0.85) * vB * uOn * 0.3 * (1.0 - r * 2.0), 1.0); }`,
  });
  const pts = new THREE.Points(g, m);
  pts.frustumCulled = false;
  return pts;
}

export class LocalPlayer {
  constructor(game, profile) {
    this.game = game;
    this.camera = game.camera;
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.yaw = 0; this.pitch = 0;
    this.layer = 0;
    this.height = STAND_H;
    this.eye = EYE_STAND;
    this.crouch = false;
    this.sprinting = false;
    this.slideT = 0; this.slideDir = new THREE.Vector3();
    this.stamina = STAM.max; this.stamDelay = 0; this.exhausted = false;
    this.health = 100;
    this.fear = 0;
    this.battery = 100;
    this.flashOn = true;
    this.hiding = null; this.hideT = 0; this.breath = 1; this.holdingBreath = false;
    this.adrenaline = 0; this.stun = 0;
    this.stepDist = 0; this.stepSide = 1;
    this.bobT = 0; this.bobAmt = 0;
    this.speed = 0;
    this.alive = true;
    this.controlLocked = false;
    this.moveNoise = 0;
    this.lastSeenSafe = 0;
    this.shake = 0;
    this.lookOverride = null;
    this.roll = 0;

    // camera + flashlight rig
    const cam = this.camera;
    cam.rotation.order = 'YXZ';
    const q = quality();
    this.flash = new THREE.SpotLight(0xfff1d8, 150, 34, 0.6, 0.55, 1.4);
    this.flash.castShadow = true;
    this.flash.shadow.mapSize.set(q.shadowSize, q.shadowSize);
    this.flash.shadow.camera.near = 0.15;
    this.flash.shadow.camera.far = 28;
    this.flash.shadow.bias = -0.00015;
    this.flash.shadow.normalBias = 0.025;
    this.flash.shadow.radius = 3;
    this.flash.map = beamCookie();
    game.scene.add(this.flash, this.flash.target);
    this.flashDir = new THREE.Vector3(0, 0, -1);
    this.beam = beamMesh();
    game.scene.add(this.beam);
    this.dust = dustPoints(q.dust);
    game.scene.add(this.dust);
    // a faint "bounce" light so walls hit by the torch softly light the room around you
    this.bounce = new THREE.PointLight(0xffe6c8, 0, 6, 2);
    game.scene.add(this.bounce);

    // first-person body
    this.body = new Avatar('player', { profile, firstPerson: true });
    game.scene.add(this.body.root);
    this.body.play('Idle');
    this.body.aim = { dir: new THREE.Vector3(0, 0, -1), weight: 1 };

    input.onLookDelta = (dx, dy) => this.look(dx, dy);
  }

  look(dx, dy) {
    if (this.controlLocked && !this.hiding) return;
    this.yaw -= dx;
    this.pitch = clamp(this.pitch - dy, -1.45, 1.45);
    if (this.hiding) {
      // restricted view through the wardrobe gap
      const base = this.hiding.yaw + Math.PI;
      let d = this.yaw - base;
      while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2;
      this.yaw = base + clamp(d, -0.45, 0.45);
      this.pitch = clamp(this.pitch, -0.35, 0.3);
    }
    this.camera.rotation.set(this.pitch, this.yaw, this.roll);
  }

  spawn(p, yaw = 0) {
    this.pos.set(p.x, p.y, p.z);
    this.layer = p.l ?? this.game.level.layerOfY(p.y + 0.5);
    this.yaw = yaw; this.pitch = 0;
    this.vel.set(0, 0, 0);
    this.crouch = false; this.height = STAND_H; this.eye = EYE_STAND;
    this.slideT = 0;
    this.hiding = null;
    this.body.root.visible = true;
  }

  get eyePos() { return new THREE.Vector3(this.pos.x, this.pos.y + this.eye, this.pos.z); }

  // ------------------------------------------------------------------------ per-frame
  update(dt) {
    const L = this.game.level;
    const canMove = this.alive && !this.controlLocked && !this.hiding;
    // ---------------- input -> wish direction
    let fx = 0, fz = 0;
    if (canMove) {
      if (input.down('KeyW')) fz -= 1;
      if (input.down('KeyS')) fz += 1;
      if (input.down('KeyA')) fx -= 1;
      if (input.down('KeyD')) fx += 1;
    }
    const len = Math.hypot(fx, fz);
    if (len > 0) { fx /= len; fz /= len; }
    const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
    const wish = new THREE.Vector3(fx * cos + fz * sin, 0, -fx * sin + fz * cos);
    const moving = len > 0;
    const forwardish = fz < -0.2;

    // ---------------- crouch / slide / sprint state
    const wantSprint = canMove && (input.down('ShiftLeft') || input.down('ShiftRight'));
    if (canMove && input.hit('KeyC')) {
      if (this.sprinting && moving && this.slideT <= 0 && this.stamina >= STAM.slideCost * 0.6) {
        this.slideT = 0.85;
        this.slideDir.copy(wish).normalize();
        this.stamina = Math.max(0, this.stamina - STAM.slideCost);
        this.stamDelay = STAM.delay;
        this.crouch = true;
        audio.play('whoosh', { vol: 0.25 });
        this.game.makeNoise(this.pos, 9, 'slide');
      } else if (this.crouch) {
        if (this._headroom(STAND_H)) this.crouch = false;
      } else this.crouch = true;
    }
    if (wantSprint && this.crouch && this.slideT <= 0 && moving && this._headroom(STAND_H)) this.crouch = false;
    const canSprint = !this.exhausted && this.stamina > 0 && !this.crouch;
    this.sprinting = canMove && wantSprint && moving && forwardish && canSprint && this.stun <= 0;

    // ---------------- speed
    let target;
    if (this.slideT > 0) {
      this.slideT -= dt;
      const k = Math.max(0, this.slideT / 0.85);
      target = lerp(SPEED.crouch, SPEED.slide, k * k);
      wish.copy(this.slideDir);
    } else if (this.crouch) target = SPEED.crouch;
    else if (this.sprinting) target = SPEED.sprint;
    else target = SPEED.walk;
    if (this.adrenaline > 0) { this.adrenaline -= dt; target *= 1.18; }
    if (this.stun > 0) { this.stun -= dt; target *= 0.45; }
    if (!moving && this.slideT <= 0) target = 0;
    if (this.game.hurtSlow > 0) target *= 0.85;
    const accel = moving || this.slideT > 0 ? 14 : 12;
    const tv = wish.clone().multiplyScalar(target);
    this.vel.x = damp(this.vel.x, tv.x, accel, dt);
    this.vel.z = damp(this.vel.z, tv.z, accel, dt);
    this.speed = Math.hypot(this.vel.x, this.vel.z);

    // ---------------- stamina
    if (this.adrenaline > 0) this.stamina = STAM.max;
    else if (this.sprinting) { this.stamina = Math.max(0, this.stamina - STAM.sprintDrain * dt); this.stamDelay = STAM.delay; }
    else {
      this.stamDelay -= dt;
      if (this.stamDelay <= 0) this.stamina = Math.min(STAM.max, this.stamina + (this.speed < 0.3 ? STAM.regenIdle : STAM.regenWalk) * dt);
    }
    if (this.stamina <= 0.5 && !this.exhausted) { this.exhausted = true; audio.play('breath_out', { intensity: 1.4 }); }
    if (this.exhausted && this.stamina >= STAM.exhaustedUntil) this.exhausted = false;

    // ---------------- height (crouch transition)
    const hT = this.crouch ? CROUCH_H : STAND_H;
    this.height = damp(this.height, hT, 12, dt);
    this.eye = damp(this.eye, this.crouch ? EYE_CROUCH : EYE_STAND, 11, dt);

    // ---------------- integrate + collide
    if (!this.hiding) {
      const np = this.pos.clone().addScaledVector(this.vel, dt);
      L.collide(np, RADIUS, np.y + 0.35, np.y + this.height);
      const moved = Math.hypot(np.x - this.pos.x, np.z - this.pos.z);
      if (dt > 1e-4) { this.vel.x = (np.x - this.pos.x) / dt; this.vel.z = (np.z - this.pos.z) / dt; }  // lose speed into walls, keep the slide along them
      this.pos.x = np.x; this.pos.z = np.z;
      // floor height: stairs ramp or storey floor
      const s = L.stairs;
      const inStair = s && this.pos.x > s.x && this.pos.x < s.x + s.w && this.pos.z > s.z && this.pos.z < s.z + s.d;
      let fy = L.heightAt(this.pos.x, this.pos.z, this.layer);
      if (!inStair) fy = this.layer * FH;
      this.pos.y = inStair ? damp(this.pos.y, fy, 18, dt) : fy;
      if (inStair) this.layer = L.layerOfY(this.pos.y + 0.2);
      this._footsteps(moved, dt, inStair);
    }

    // ---------------- flashlight battery
    if (this.flashOn) {
      this.battery = Math.max(0, this.battery - dt * (100 / 330));
      if (this.battery <= 0) { this.flashOn = false; audio.play('flashlight'); this.game.hud.notify('The flashlight died', 2.5); }
    }

    // ---------------- hiding breath
    if (this.hiding) {
      this.holdingBreath = input.down('Space') && this.breath > 0;
      if (this.holdingBreath) { this.breath = Math.max(0, this.breath - dt / 7); if (this.breath <= 0) { audio.play('gasp'); this.game.makeNoise(this.pos, 6, 'gasp'); } }
      else this.breath = Math.min(1, this.breath + dt / 5);
    } else { this.holdingBreath = false; this.breath = Math.min(1, this.breath + dt / 4); }

    this._camera(dt);
    this._body(dt);
  }

  _headroom(h) {
    const L = this.game.level;
    for (const b of L.query(this.pos.x, this.pos.z, RADIUS + 0.1)) {
      if (this.pos.y + h <= b.y0 || this.pos.y + 0.4 >= b.y1) continue;
      const cx = clamp(this.pos.x, b.x0, b.x1), cz = clamp(this.pos.z, b.z0, b.z1);
      if ((this.pos.x - cx) ** 2 + (this.pos.z - cz) ** 2 < (RADIUS - 0.02) ** 2) return false;
    }
    return true;
  }

  surface() {
    const L = this.game.level;
    const r = L.roomAt(this.pos.x, this.pos.z, this.layer);
    if (!r) return 'gravel';
    if (r.type === 'stairs') return 'carpet';
    for (const rg of r.rugs) if (this.pos.x > rg.x0 && this.pos.x < rg.x1 && this.pos.z > rg.z0 && this.pos.z < rg.z1) return 'carpet';
    return r.surface;
  }

  _footsteps(moved, dt, inStair) {
    if (this.speed < 0.25) { this.stepDist = Math.min(this.stepDist, 0.3); return; }
    this.stepDist += moved;
    const stride = this.slideT > 0 ? 99 : this.crouch ? 0.55 : this.sprinting ? 1.05 : 0.72;
    if (this.stepDist >= stride) {
      this.stepDist = 0;
      this.stepSide *= -1;
      const surf = this.surface();
      const loud = this.crouch ? 0.35 : this.sprinting ? 1.25 : 0.75;
      audio.play('footstep', { surface: surf, intensity: loud * (inStair ? 1.1 : 1), vol: 0.55 });
      const radius = this.crouch ? 1.8 : this.sprinting ? 13 : 5.5;
      this.game.makeNoise(this.pos, radius * (surf === 'wood' ? 1.15 : surf === 'carpet' ? 0.7 : 1), 'step');
    }
  }

  _camera(dt) {
    const cam = this.camera;
    // head bob (disabled via settings) - tied to stride so it matches footsteps
    const bobOn = settings.headBob && !this.hiding;
    const moveK = clamp(this.speed / SPEED.sprint, 0, 1);
    this.bobAmt = damp(this.bobAmt, bobOn && this.slideT <= 0 ? moveK : 0, 8, dt);
    this.bobT += dt * (this.sprinting ? 12.5 : this.crouch ? 6.5 : 8.8) * (this.speed > 0.2 ? 1 : 0);
    const bobY = Math.abs(Math.sin(this.bobT)) * 0.055 * this.bobAmt - 0.02 * this.bobAmt;
    const bobX = Math.sin(this.bobT) * 0.035 * this.bobAmt;
    this.roll = damp(this.roll, (this.slideT > 0 ? -0.06 : 0) + Math.sin(this.bobT) * 0.006 * this.bobAmt, 8, dt);
    // idle breathing sway
    const t = this.game.time;
    const breathe = Math.sin(t * 1.6) * 0.006 * (this.exhausted ? 3 : 1);
    this.shake = Math.max(0, this.shake - dt * 1.5);
    const sh = this.shake * this.shake;
    const sx = (Math.random() - 0.5) * sh * 0.08, sy = (Math.random() - 0.5) * sh * 0.08;
    if (this.hiding) {
      const hp = this.hiding.pos;
      cam.position.lerp(new THREE.Vector3(hp.x, hp.y + (this.holdingBreath ? -0.02 : 0), hp.z), Math.min(1, dt * 8));
    } else {
      const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
      cam.position.set(this.pos.x, this.pos.y + this.eye + bobY + breathe, this.pos.z).addScaledVector(right, bobX);
    }
    cam.position.x += sx; cam.position.y += sy;
    cam.rotation.set(this.pitch + sy * 0.3, this.yaw, this.roll + sx * 0.3);
    cam.fov = damp(cam.fov, settings.fov + (this.sprinting ? 5 : 0) + (this.slideT > 0 ? 9 : 0), 6, dt);
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld(true);

    // flashlight: follows view with a touch of weight (no effect on aim latency - camera is direct)
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
    const lag = this.hiding ? 30 : 16;
    this.flashDir.lerp(fwd, 1 - Math.exp(-lag * dt)).normalize();
    const r = new THREE.Vector3(1, 0, 0).applyQuaternion(cam.quaternion);
    const u = new THREE.Vector3(0, 1, 0).applyQuaternion(cam.quaternion);
    const org = cam.position.clone().addScaledVector(r, 0.16).addScaledVector(u, -0.2).addScaledVector(fwd, 0.25);
    this.flash.position.copy(org);
    this.flash.target.position.copy(org).addScaledVector(this.flashDir, 5);
    this.flash.target.updateMatrixWorld();
    const bat = this.battery;
    let fl = this.flashOn ? 1 : 0;
    if (this.flashOn && bat < 12) fl *= (Math.random() < 0.08 ? 0.1 : 0.55 + bat / 30);
    if (this.flashOn && this.game.ghostNear > 0.5 && Math.random() < this.game.ghostNear * 0.12) fl *= 0.05;
    this.flashLevel = fl;
    // eye adaptation: surfaces right in front of the lens don't blow out to white
    this.flashNear = damp(this.flashNear ?? 1, clamp((this._hitD ?? 5) / 2.2, 0.3, 1), 8, dt);
    this.flash.intensity = 150 * fl * this.flashNear;
    this.flash.visible = true;
    // volumetric beam and dust are only visible in dark areas
    const dark = 1 - clamp(this.game.world.lightAt(cam.position) * 1.4, 0, 0.8);
    this.beam.position.copy(org);
    this.beam.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, -1), this.flashDir);
    this.beam.material.uniforms.uI.value = fl * dark;
    this.beam.material.uniforms.uTime.value = t;
    this.beam.visible = fl > 0.01 && !this.hiding;
    const du = this.dust.material.uniforms;
    du.uCam.value.copy(cam.position); du.uDir.value.copy(this.flashDir); du.uOrg.value.copy(org);
    du.uTime.value = t; du.uOn.value = fl * dark; du.uPx.value = this.game.renderer.r.getPixelRatio() * innerHeight / 720;
    // bounce: where the beam hits (cheap fake GI)
    let hitD = this.game.rayDist(org, this.flashDir, 12);
    for (const g of this.game.ghosts) {
      if (g.dissolve > 0.9) continue;
      const to = g.pos.clone().setY(g.pos.y + 1.3).sub(org);
      const d = to.length();
      if (d < hitD && to.normalize().dot(this.flashDir) > 0.85) hitD = d;
    }
    this._hitD = hitD;
    this.bounce.position.copy(org).addScaledVector(this.flashDir, Math.max(0.3, hitD - 0.4));
    this.bounce.intensity = fl * 3.5 * clamp(1.4 - hitD / 10, 0.1, 1);
    // audio listener
    audio.updateListener(cam.position, fwd, u);
  }

  _body(dt) {
    const b = this.body;
    b.root.visible = !this.hiding && this.alive;
    if (!b.root.visible) return;
    const fwd = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    // body slightly behind the eye so looking down shows the torso, not its inside
    b.root.position.copy(this.pos).addScaledVector(fwd, -0.14);
    b.root.position.y = this.pos.y - (this.crouch ? 0.02 : 0);
    b.root.rotation.y = this.yaw + Math.PI;
    let anim = 'Idle', sp = 1;
    if (this.slideT > 0) anim = 'Slide';
    else if (this.crouch) { anim = this.speed > 0.2 ? 'CrouchWalk' : 'CrouchIdle'; sp = Math.max(0.6, this.speed / 1.0); }
    else if (this.speed > 3.2) { anim = 'Run'; sp = this.speed / 4.2; }
    else if (this.speed > 0.2) { anim = 'Walk'; sp = this.speed / 1.5; }
    b.play(anim, { fade: 0.2 });
    b.setSpeed(sp);
    b.aim.dir.copy(this.flashDir);
    const sel = this.game.inv[this.game.sel];
    b.setHeld(sel ? sel.type : null, sel ? this.game.itemModel(sel.type) : null);
    b.useT = Math.max(0, (b.useT || 0) - dt * 2);
    b.update(dt);
    b.setFlashlightOn(this.flashLevel > 0.1, 1.2);
  }

  // ------------------------------------------------------------------------ actions
  toggleFlash() {
    if (this.battery <= 0) { audio.play('flashlight'); this.game.hud.notify('No power left — [R] to change battery', 2); return; }
    this.flashOn = !this.flashOn;
    audio.play('flashlight', { vol: 0.8 });
  }

  enterHide(spot) {
    this.hiding = spot;
    this.vel.set(0, 0, 0);
    this.crouch = false;
    this.yaw = spot.yaw + Math.PI;   // face out of the wardrobe
    this.pitch = 0;
    this.camera.rotation.set(0, this.yaw, 0);
  }

  exitHide() {
    const s = this.hiding;
    if (!s) return;
    this.hiding = null;
    this.pos.set(s.stand.x, s.stand.y, s.stand.z);
    this.yaw = s.yaw + Math.PI;
  }

  dispose() {
    input.onLookDelta = null;
    this.flash.removeFromParent(); this.flash.target.removeFromParent();
    this.beam.removeFromParent(); this.dust.removeFromParent(); this.bounce.removeFromParent();
    this.body.dispose();
  }
}

export { STAND_H, CROUCH_H, RADIUS };
