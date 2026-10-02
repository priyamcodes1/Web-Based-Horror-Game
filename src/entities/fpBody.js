// First-person body: the player's own survivor, seen from the inside.
//  * full mocap body (same clips as everywhere else) placed just behind the eye, head collapsed so it never
//    blocks the camera - look down and you see your chest, legs and feet walking
//  * both arms solved with two-bone IK onto hand poses defined in camera space, fingers posed per grip
//  * the torch lives in the right hand, the selected item in the left; every use is a hand animation
//    (procedural timelines) and the effect lands on the frame the hands get there
import * as THREE from 'three';
import { makeSurvivor } from './cast.js';
import { cloneProp, applyLibrary } from '../core/assets.js';
import { clamp, dampAngle, angleDiff } from '../core/util.js';
import { emoteTarget } from '../gfx/armIK.js';

const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _d = new THREE.Vector3();
const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _m = new THREE.Matrix4();
const ease = (x) => { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); };

/** Rotation taking basis (a1, f1) onto (a2, f2): a = across the knuckles (pinky -> index), f = wrist -> fingers. */
function frameQuat(a, f, out = new THREE.Quaternion()) {
  const x = a.clone().normalize();
  const y = f.clone().addScaledVector(x, -f.dot(x)).normalize();
  const z = new THREE.Vector3().crossVectors(x, y);
  return out.setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
}

/** A hand pose in camera space: wrist position, knuckle-line direction A, finger direction F, curl, thumb. */
function pose(W, A, F, c = 0.55, th = 0.45) {
  return { W: V3(...W), q: frameQuat(V3(...A), V3(...F)), c, th };
}
/** Same, given where the palm faces instead of the knuckle line (handedness picks A). */
function palmPose(side, W, palm, F, c = 0.55, th = 0.45) {
  const P = V3(...palm).normalize(), f = V3(...F);
  f.addScaledVector(P, -f.dot(P)).normalize();
  const A = side === 'r' ? f.clone().cross(P) : P.clone().cross(f);
  return { W: V3(...W), q: frameQuat(A, f), c, th };
}
function lerpPose(p0, p1, k, out) {
  out.W.lerpVectors(p0.W, p1.W, k);
  out.q.slerpQuaternions(p0.q, p1.q, k);
  out.c = p0.c + (p1.c - p0.c) * k; out.th = p0.th + (p1.th - p0.th) * k;
  return out;
}
const clonePose = (p) => ({ W: p.W.clone(), q: p.q.clone(), c: p.c, th: p.th });

// ------------------------------------------------------------------ base poses (camera space: x right, y up, -z ahead)
// right hand: torch in a hammer grip, index side forward, knuckles up and a little in
// power grip: the torch lies diagonally (35 deg) across the base of the fingers, which wrap round it; the hand is
// tilted so that diagonal points the lens ahead and a little toward the middle - palm faces in, knuckles forward-down
const R_TORCH = pose([0.17, -0.21, -0.27], [-0.154, 0.57, -0.807], [-0.186, -0.819, -0.54], 0.92, 0.8);   // lens level, toed in 15 deg
// left hand: upright fist (item standing up out of the index side), palm turned in
const L_FIST = palmPose('l', [-0.15, -0.27, -0.31], [1, 0, 0.3], [0.4, 0.05, -1], 0.85, 0.7);
// left hand: flat palm up, carrying something on it
const L_PALM = palmPose('l', [-0.13, -0.3, -0.33], [0.1, 1, 0.1], [0.15, 0.1, -1], 0.35, 0.2);

/** How each item sits in the hand. pos = (along A, along F, out of the palm N) from the wrist; axes map item-local
 *  axes onto grip axes; grip = which left-hand pose carries it. */
const ITEMS = {
  // pos: (along A, along F, out of the palm) from the wrist; cyl: contact cylinder (local axis through the origin, radius)
  torch: { prop: 'Flashlight', pos: [0.0, 0.085, 0.046], axes: { z: [0.82, 0.57, 0], y: 'N' }, anchor: [0, 0, 0.075], cyl: { axis: 'z', r: 0.03 } },
  battery: { prop: 'Battery', grip: 'fist', pos: [0, 0.085, 0.036], axes: { y: 'A', z: 'F' }, anchor: [0, 0.03, 0], scale: 1.3, cyl: { axis: 'y', r: 0.017 } },
  pills: { prop: 'Pills', grip: 'fist', pos: [0, 0.085, 0.034], axes: { y: 'A', z: 'F' }, anchor: [0, 0.045, 0], cyl: { axis: 'y', r: 0.02 } },
  fuse: { prop: 'Fuse', grip: 'fist', pos: [0, 0.085, 0.026], axes: { z: 'A', y: 'F' }, anchor: [0, 0, 0], cyl: { axis: 'z', r: 0.0125 } },
  syringe: { prop: 'Syringe', grip: 'fist', pos: [0, 0.085, 0.024], axes: { z: '-A', y: 'F' }, anchor: [0, 0, -0.03], scale: 1.2, cyl: { axis: 'z', r: 0.0095 } },
  crucifix: { prop: 'Crucifix', grip: 'fist', pos: [0, 0.085, 0.026], axes: { y: 'A', z: 'F' }, anchor: [0, 0.03, 0], cyl: { axis: 'y', r: 0.011 } },
  crowbar: { prop: 'Crowbar', grip: 'fist', pos: [0, 0.085, 0.027], axes: { z: 'A', y: 'F' }, anchor: [0, 0, -0.26], cyl: { axis: 'z', r: 0.013 } },
  medkit: { prop: 'Medkit', grip: 'palm', pos: [0.0, 0.07, 0.014], axes: { y: 'N', z: 'F' }, anchor: [0, 0, 0], scale: 0.7 },
  key_brass: { prop: 'Key_Brass', grip: 'fist', pos: [0, 0.085, 0.02], axes: { z: 'A', x: 'F' }, anchor: [0, 0, -0.02], scale: 1.3, cyl: { axis: 'z', r: 0.007 } },
  key_silver: { prop: 'Key_Silver', grip: 'fist', pos: [0, 0.085, 0.02], axes: { z: 'A', x: 'F' }, anchor: [0, 0, -0.02], scale: 1.3, cyl: { axis: 'z', r: 0.007 } },
  key_iron: { prop: 'Key_Iron', grip: 'fist', pos: [0, 0.085, 0.02], axes: { z: 'A', x: 'F' }, anchor: [0, 0, -0.02], scale: 1.3, cyl: { axis: 'z', r: 0.007 } },
};

const FINGERS = ['index', 'middle', 'ring', 'pinky'];
const SEG = [['01', 1.45], ['02', 1.65], ['03', 1.1]];          // a real fist: ~83 / 95 / 63 degrees per joint at curl 1
const THUMB = [['01', 0.5], ['02', 0.75], ['03', 0.75]];

export class FPBody {
  constructor(player, profileId) {
    this.p = player; this.game = player.game;
    this.char = makeSurvivor(profileId);
    this.root = this.char.root;
    this.root.traverse((o) => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = true; } });
    this.cutChest();
    this.game.scene.add(this.root);
    const B = this.bones = this.char.bones;
    this.ok = !!(B.upperarm_l && B.hand_l && B.middle_01_l && B.index_01_l && B.pinky_01_l && B.head);
    this.bodyYaw = player.yaw; this.speed = 0;
    // finger axes + arm lengths from the bind pose (before any clip touches the bones)
    this.root.updateMatrixWorld(true);
    this.hands = this.ok ? { l: this.setupHand('l'), r: this.setupHand('r') } : null;
    this.char.play('Idle', 0);
    this.char.update(0);
    // scale so the body's eyes sit at the camera's standing eye height
    this.root.updateMatrixWorld(true);
    const headY = B.head.getWorldPosition(_a).y - this.root.position.y;
    this.scale = clamp(1.56 / Math.max(1, headY + 0.07), 0.8, 1.1);
    this.root.scale.setScalar(this.scale);
    // items
    this.torch = this.makeItem('torch');
    this.torchTip = this.torch.obj.getObjectByName('Flashlight_Tip') || this.torch.obj;
    this.left = null; this.leftType = null;
    // pose state
    this.base = { l: clonePose(L_FIST), r: clonePose(R_TORCH) };
    this.cur = { l: clonePose(L_FIST), r: clonePose(R_TORCH) };
    this.w = { l: 0, r: 1 };                    // IK weight (0 = the mocap arm)
    this.action = null;
    this.visible = true;
    this.sway = new THREE.Vector2();
    this.emoteW = 0; this.emotePhase = 0;      // [J] gag emote
  }

  // ------------------------------------------------------------------ setup
  /** Only the neck and head go (first-person copy): they sit on top of the camera. The chest stays - cutting it
   *  left an open shell you looked straight down into; now looking down shows your chest and belly, with the legs
   *  beyond (the body leans back out of the way as you look down, see update). */
  cutChest() {
    const names = ['neck_01', 'head'];
    this.root.traverse((o) => {
      if (!o.isSkinnedMesh || /skirt/i.test(o.name)) return;
      const ids = names.map((n) => o.skeleton.bones.findIndex((b) => b.name === n)).filter((i) => i >= 0);
      while (ids.length < 6) ids.push(-1);
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      const out = mats.map((m) => {
        const c = m.clone();
        c.onBeforeCompile = (sh) => {
          sh.uniforms.uCutIds = { value: ids.map((i) => i) };
          sh.vertexShader = sh.vertexShader
            .replace('#include <common>', `#include <common>
uniform float uCutIds[6];
varying float vChest;`)
            .replace('#include <skinning_vertex>', `#include <skinning_vertex>
            vChest = 0.0;
            for (int k = 0; k < 6; k++) {
              float id = uCutIds[k];
              vChest += (abs(skinIndex.x - id) < 0.5 ? skinWeight.x : 0.0) + (abs(skinIndex.y - id) < 0.5 ? skinWeight.y : 0.0)
                      + (abs(skinIndex.z - id) < 0.5 ? skinWeight.z : 0.0) + (abs(skinIndex.w - id) < 0.5 ? skinWeight.w : 0.0);
            }`);
          sh.fragmentShader = sh.fragmentShader
            .replace('#include <common>', `#include <common>
varying float vChest;`)
            .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
if (vChest > 0.45) discard;`);
        };
        c.customProgramCacheKey = () => 'fpChestCut' + (m.customProgramCacheKey ? m.customProgramCacheKey() : '');
        return c;
      });
      o.material = Array.isArray(o.material) ? out : out[0];
    });
  }

  setupHand(s) {
    const B = this.bones;
    const up = B['upperarm_' + s], lo = B['lowerarm_' + s], hand = B['hand_' + s];
    this.root.updateMatrixWorld(true);
    const l1 = up.getWorldPosition(_a).distanceTo(lo.getWorldPosition(_b));
    const l2 = lo.getWorldPosition(_a).distanceTo(hand.getWorldPosition(_b));
    // palm side: right palm = A x F, left palm = F x A (A = pinky->index, F = wrist->fingers)
    const fr = this.handFrame(s);
    const palmSign = s === 'r' ? 1 : -1;
    // finger curl axes (rest pose): perpendicular to the bone and the palm normal, in each bone's local frame
    const curl = [];
    const rest = {};
    const palmN = fr.N.clone().multiplyScalar(palmSign);
    const add = (names, list) => {
      for (const f of names) for (const [k, amt] of list) {
        const b = B[`${f}_${k}_${s}`]; if (!b) continue;
        const next = B[`${f}_0${+k + 1}_${s}`];
        const h = b.getWorldPosition(new THREE.Vector3());
        const d = next ? next.getWorldPosition(new THREE.Vector3()).sub(h) : h.clone().sub(b.parent.getWorldPosition(new THREE.Vector3()));
        const ax = d.normalize().cross(palmN);
        if (ax.lengthSq() < 1e-8) continue;
        const wq = b.getWorldQuaternion(new THREE.Quaternion());
        curl.push({ b, amt, thumb: f === 'thumb', axis: ax.normalize().applyQuaternion(wq.invert()) });
        rest[b.name] = b.quaternion.clone();
      }
    };
    add(FINGERS, SEG); add(['thumb'], THUMB);
    return { s, up, lo, hand, l1, l2, palmSign, curl, rest, sideSign: s === 'r' ? 1 : -1 };
  }

  /** Current grip frame of a hand from its bones: A across the knuckles (toward the index), F toward the fingers. */
  handFrame(s, out = { A: new THREE.Vector3(), F: new THREE.Vector3(), N: new THREE.Vector3() }) {
    const B = this.bones;
    const w = B['hand_' + s].getWorldPosition(_c);
    out.F.copy(B['middle_01_' + s].getWorldPosition(_d)).sub(w).normalize();
    out.A.copy(B['index_01_' + s].getWorldPosition(_d)).sub(B['pinky_01_' + s].getWorldPosition(_b));
    out.A.addScaledVector(out.F, -out.A.dot(out.F)).normalize();
    out.N.crossVectors(out.A, out.F);
    return out;
  }

  makeItem(type) {
    const def = ITEMS[type];
    if (!def) return null;
    const obj = cloneProp('items', def.prop); applyLibrary(obj, { cast: false });
    obj.traverse((o) => { if (o.isMesh) { o.castShadow = false; o.frustumCulled = false; } });
    obj.scale.setScalar(def.scale || 1);
    this.game.scene.add(obj);
    return { type, def, obj };
  }

  setHeld(type) {
    if (type === this.leftType) return;
    if (this.left) this.game.scene.remove(this.left.obj);
    this.left = ITEMS[type] ? this.makeItem(type) : null;
    this.leftType = type;
    const grip = this.left?.def.grip === 'palm' ? L_PALM : L_FIST;
    this.base.l = clonePose(grip);
  }

  // ------------------------------------------------------------------ actions
  get busy() { return !!this.action; }

  /** Play a hand action; `events` = { name: fn } fired at the action's marked times. */
  act(name, events = {}, opts = {}) {
    if (this.action && !opts.force) return false;
    const def = ACTIONS[name];
    if (!def) { for (const k in events) events[k](); return true; }
    this.action = { name, def, t: 0, events, fired: new Set(), opts };
    return true;
  }

  cancel() {
    this.action = null;
  }

  // ------------------------------------------------------------------ per frame
  update(dt) {
    const p = this.p, cam = p.camera;
    const show = this.ok && p.alive && !p.hiding && !p.cinematic;
    this.root.visible = show;
    this.torch.obj.visible = show && this.emoteW < 0.5;
    if (this.left) this.left.obj.visible = show && this.leftVisible !== false;
    if (!show) { if (this.action && (p.hiding || !p.alive)) this.action = null; return; }

    // ---- body placement + locomotion
    const vel = p.vel; const sp = Math.hypot(vel.x, vel.z);
    this.speed += (sp - this.speed) * Math.min(1, dt * 10);
    const moveYaw = Math.atan2(-vel.x, -vel.z);
    const rel = angleDiff(p.yaw, moveYaw);
    const back = this.speed > 0.3 && Math.abs(rel) > 2.0;
    let face = p.yaw;
    if (this.speed > 0.3 && !back) face = p.yaw + clamp(rel, -1.2, 1.2) * 0.6;
    this.bodyYaw = dampAngle(this.bodyYaw, face, 10, dt);
    let a = 'Idle', ts = 1;
    if (p.state === 'slide') a = 'Slide';
    else if (p.state === 'crouch') { a = this.speed > 0.2 ? 'CrouchWalk' : 'CrouchIdle'; ts = clamp(this.speed / 1.1, 0.6, 1.6) * (back ? -1 : 1); }
    else if (this.speed > 3.8) { a = 'Run'; ts = clamp(this.speed / 4.6, 0.8, 1.4); }
    else if (this.speed > 0.25) { a = 'Walk'; ts = clamp(this.speed / 1.45, 0.6, 1.8) * (back ? -1 : 1); }
    this.char.play(a, 0.25, false, ts);
    this.root.rotation.y = this.bodyYaw + Math.PI;
    this.root.position.set(p.pos.x, p.pos.y, p.pos.z);
    this.char.update(dt);
    // keep the eye in front of the neck: push the body back by how far its head rises above the camera
    this.root.updateMatrixWorld(true);
    const head = this.bones.head.getWorldPosition(_a);
    const above = Math.max(0, head.y + 0.05 - cam.position.y);
    // looking down: the chest drops back out of the way so you see your belly, legs and feet ahead
    const down = clamp(-p.pitch - 0.7, 0, 0.8);
    // crouched, the clip's head rides above the low crouch camera: sink the body part of the way, slide the rest back
    const sink = Math.min(above * 0.6, 0.25);
    const backOff = 0.13 + (above - sink) * 0.9 + down * 0.28;
    const fwd = _b.set(-Math.sin(this.bodyYaw), 0, -Math.cos(this.bodyYaw));
    this.root.position.addScaledVector(fwd, -backOff);
    this.root.position.y -= sink;
    this.root.updateMatrixWorld(true);

    // ---- hand poses: base (+ sway, sprint, wall pull-back) then the running action on top
    this.sway.lerp(p.vmSway, 1 - Math.exp(-14 * dt));
    const sx = clamp(this.sway.x, -0.08, 0.08), sy = clamp(this.sway.y, -0.08, 0.08);
    const bob = Math.sin(p.bob) * 0.01 * p.bobAmt;
    const wall = clamp(0.55 - (p.hitDist ?? 9), 0, 0.3);       // torch pressed against a wall: pull the hands in
    for (const s of ['l', 'r']) {
      const b = this.base[s], c = this.cur[s];
      c.W.copy(b.W); c.q.copy(b.q); c.c = b.c; c.th = b.th;
      c.W.x += -sx * 0.35; c.W.y += -sy * 0.3 + Math.abs(bob) - (p.sprinting ? 0.05 : 0);
      c.W.z += wall * 0.8; c.W.y -= wall * 0.3;
    }
    let lw = this.left ? 1 : 0, rw = 1;
    this.leftVisible = true;
    if (this.action) {
      const A = this.action; A.t += dt;
      const r = A.def.run(A.t, this.cur, this, A);
      if (r && r.lw !== undefined) lw = r.lw;
      if (r && r.leftVisible === false) this.leftVisible = false;
      for (const [t, name] of A.def.events || []) if (A.t >= t && !A.fired.has(name)) { A.fired.add(name); A.events[name]?.(); }
      if (A.t >= A.def.dur) { for (const k in A.events) if (!A.fired.has(k)) A.events[k](); this.action = null; }
    }
    // [J] held: the right hand drops to the front of the hips (torch tucked away) and pumps back and forth
    const em = p.emoting && !this.action;
    this.emoteW += ((em ? 1 : 0) - this.emoteW) * Math.min(1, dt * 6);
    if (this.emoteW > 0.001) {
      this.emotePhase += dt * Math.PI * 2 * 2.4;
      cam.updateMatrixWorld();
      const T = emoteTarget(this.bones.pelvis, this.bodyYaw, this.emotePhase);
      const right = V3(Math.cos(this.bodyYaw), 0, -Math.sin(this.bodyYaw));
      const fwd = V3(-Math.sin(this.bodyYaw), 0, -Math.cos(this.bodyYaw));
      const palmW = right.clone().negate().add(V3(0, 0.2, 0)).normalize();          // palm turned in
      const fingW = V3(0, -1, 0).addScaledVector(fwd, 0.35).normalize();            // knuckles down and forward
      const wrist = T.clone().addScaledVector(fingW, -0.07 * this.scale).addScaledVector(palmW, -0.03 * this.scale);
      wrist.addScaledVector(fwd, -0.02 * Math.cos(this.emotePhase));                // the wrist leads the stroke a little
      const invQ = cam.quaternion.clone().invert();
      const W = wrist.applyMatrix4(_m.copy(cam.matrixWorld).invert());
      const E = palmPose('r', W.toArray(), palmW.applyQuaternion(invQ).toArray(), fingW.applyQuaternion(invQ).toArray(), 0.88, 0.8);
      lerpPose(this.cur.r, E, ease(this.emoteW), this.cur.r);
    }
    this.w.l += (lw - this.w.l) * Math.min(1, dt * 9);
    this.w.r += (rw - this.w.r) * Math.min(1, dt * 9);

    // ---- solve
    cam.updateMatrixWorld();
    this.solve('r', this.cur.r, this.w.r, cam);
    if (this.w.l > 0.01) this.solve('l', this.cur.l, this.w.l, cam);
    this.bones.head.scale.setScalar(0.001);                       // never see the inside of your own head
    this.root.updateMatrixWorld(true);

    // ---- items follow the hands, fingers close onto them
    this.placeItem(this.torch, 'r');
    if (!this.torchHidden) this.wrap('r', this.torch, this.w.r);
    if (this.left) {
      this.placeItem(this.left, 'l'); this.left.obj.visible = this.leftVisible && this.w.l > 0.3;
      if (this.left.obj.visible && this.left.def.cyl) this.wrap('l', this.left, this.w.l);
    }
    // the torch thumb-click rides on top of the wrap
    if (this.action?.name === 'toggle') {
      const t = this.action.t, k = t < 0.11 ? ease(t / 0.11) : 1 - ease((t - 0.14) / 0.18);
      for (const f of this.hands.r.curl) if (f.thumb && !/_01_/.test(f.b.name)) f.b.quaternion.multiply(_q.setFromAxisAngle(f.axis, 0.35 * k));
    }
    this.root.updateMatrixWorld(true);
  }

  /** Two-bone IK: wrist onto the pose (camera space), elbow down and out, hand turned to the pose's grip frame. */
  solve(s, ps, w, cam) {
    const H = this.hands[s];
    const T = _a.copy(ps.W).applyMatrix4(cam.matrixWorld);
    const S = H.up.getWorldPosition(new THREE.Vector3());
    const B0 = H.lo.getWorldPosition(new THREE.Vector3());
    const C0 = H.hand.getWorldPosition(new THREE.Vector3());
    // blend toward the animated wrist when the weight is partial
    if (w < 0.999) T.lerpVectors(C0, T, w);
    const l1 = H.l1 * this.scale, l2 = H.l2 * this.scale;
    const toT = T.clone().sub(S);
    const d = clamp(toT.length(), 0.05, (l1 + l2) * 0.999);
    const dir = toT.normalize();
    const camRot = _q.setFromRotationMatrix(cam.matrixWorld);
    const pole = V3(0.55 * H.sideSign, -1, 0.35).applyQuaternion(camRot);
    pole.addScaledVector(dir, -pole.dot(dir)).normalize();
    const ca = (l1 * l1 - l2 * l2 + d * d) / (2 * d);
    const h = Math.sqrt(Math.max(0, l1 * l1 - ca * ca));
    const E = S.clone().addScaledVector(dir, ca).addScaledVector(pole, h);
    const Tw = S.clone().addScaledVector(dir, d);
    this.aimBone(H.up, B0.clone().sub(S), E.clone().sub(S));
    H.up.updateMatrixWorld(true);
    const B1 = H.lo.getWorldPosition(new THREE.Vector3());
    const C1 = H.hand.getWorldPosition(new THREE.Vector3());
    this.aimBone(H.lo, C1.sub(B1), Tw.clone().sub(B1));
    H.lo.updateMatrixWorld(true);
    // hand orientation: grip frame onto the pose's frame (camera space -> world)
    const cur = this.handFrame(s);
    const qCur = frameQuat(cur.A, cur.F, _q2);
    const qTgt = camRot.clone().multiply(ps.q);
    const R = qTgt.multiply(qCur.invert());                       // world delta
    if (w < 0.999) R.slerp(new THREE.Quaternion(), 1 - w);
    const hw = H.hand.getWorldQuaternion(new THREE.Quaternion()).premultiply(R);
    // share the forearm twist so the wrist doesn't wring like a towel
    const fa = Tw.clone().sub(B1).normalize();
    const lw = H.lo.getWorldQuaternion(new THREE.Quaternion());
    const twist = this.twistAbout(R, fa);
    lw.premultiply(new THREE.Quaternion().setFromAxisAngle(fa, twist * 0.5));
    this.setWorldQuat(H.lo, lw); H.lo.updateMatrixWorld(true);
    this.setWorldQuat(H.hand, hw); H.hand.updateMatrixWorld(true);
    // fingers
    const c = ps.c * w + 0.35 * (1 - w), th = ps.th * w + 0.3 * (1 - w);
    for (const f of H.curl) {
      const k = f.thumb ? th : c;
      f.b.quaternion.copy(H.rest[f.b.name]).multiply(_q.setFromAxisAngle(f.axis, f.amt * k));
    }
  }

  /** Close each finger (and the thumb) until it meets the held item's surface, never through it. */
  wrap(s, item, w) {
    const cyl = item.def.cyl;
    if (!cyl || w < 0.3) return;
    const H = this.hands[s];
    item.obj.updateMatrixWorld(true);
    const o = item.obj.getWorldPosition(new THREE.Vector3());
    const d = (cyl.axis === 'y' ? V3(0, 1, 0) : V3(0, 0, 1)).applyQuaternion(item.obj.quaternion).normalize();
    const R = cyl.r * (item.def.scale || 1) + 0.009 * this.scale;          // surface + finger pad thickness
    const dist = (pt) => { const v = pt.sub(o); return v.addScaledVector(d, -v.dot(d)).length(); };
    const groups = {};
    for (const f of H.curl) { const key = f.b.name.replace(/_0\d_[lr]$/, ''); (groups[key] = groups[key] || []).push(f); }
    const pt = new THREE.Vector3(), tip = new THREE.Vector3();
    for (const chain of Object.values(groups)) {
      const set = (k) => { for (const f of chain) f.b.quaternion.copy(H.rest[f.b.name]).multiply(_q.setFromAxisAngle(f.axis, f.amt * k)); chain[0].b.updateMatrixWorld(true); };
      const inside = () => {
        for (let i = 1; i < chain.length; i++) if (dist(chain[i].b.getWorldPosition(pt)) < R) return true;
        const last = chain[chain.length - 1].b, prev = chain[chain.length - 2].b;
        last.getWorldPosition(tip); prev.getWorldPosition(pt);
        tip.add(tip.clone().sub(pt).multiplyScalar(0.75));                // fingertip ~ 3/4 of the middle phalanx past the last joint
        return dist(tip) < R;
      };
      // sweep from open toward closed (the thumb may first swing out past its rest pose to clear the item), keep
      // the most closed pose before first contact, refine between the last free step and the first touching one
      const thumb = chain[0].thumb;
      const k0 = thumb ? -1 : 0, steps = thumb ? 20 : 12;
      let lo = null, hi = 1;
      for (let i = 0; i <= steps; i++) {
        const k = k0 + (1 - k0) * i / steps;
        set(k);
        if (inside()) { if (lo !== null) { hi = k; break; } } else lo = k;
      }
      if (lo === null) lo = k0;
      for (let i = 0; i < 5 && hi > lo + 1e-3; i++) { const m = (lo + hi) / 2; set(m); if (inside()) hi = m; else lo = m; }
      set(lo);
    }
  }

  twistAbout(q, axis) {
    // swing-twist decomposition: angle of q's rotation about `axis`
    const r = V3(q.x, q.y, q.z);
    const p = axis.clone().multiplyScalar(r.dot(axis));
    const t = new THREE.Quaternion(p.x, p.y, p.z, q.w).normalize();
    let ang = 2 * Math.acos(clamp(t.w, -1, 1));
    if (V3(t.x, t.y, t.z).dot(axis) < 0) ang = -ang;
    if (ang > Math.PI) ang -= 2 * Math.PI;
    return ang;
  }

  aimBone(bone, from, to) {
    if (from.lengthSq() < 1e-10 || to.lengthSq() < 1e-10) return;
    const r = new THREE.Quaternion().setFromUnitVectors(from.normalize(), to.normalize());
    const wq = bone.getWorldQuaternion(new THREE.Quaternion()).premultiply(r);
    this.setWorldQuat(bone, wq);
  }

  setWorldQuat(bone, wq) {
    const pq = bone.parent.getWorldQuaternion(new THREE.Quaternion());
    bone.quaternion.copy(pq.invert().multiply(wq));
  }

  placeItem(item, s) {
    const fr = this.handFrame(s);
    const H = this.hands[s];
    const N = fr.N.clone().multiplyScalar(H.palmSign);
    const wrist = H.hand.getWorldPosition(new THREE.Vector3());
    const def = item.def;
    const axis = (k) => {
      if (Array.isArray(k)) return fr.A.clone().multiplyScalar(k[0]).addScaledVector(fr.F, k[1]).addScaledVector(N, k[2]).normalize();
      const neg = k[0] === '-'; const v = (k.replace('-', '') === 'A' ? fr.A : k.replace('-', '') === 'F' ? fr.F : N).clone(); return neg ? v.negate() : v;
    };
    // item rotation: map its two named local axes onto grip axes
    const [k1, k2] = Object.keys(def.axes);
    const L = { x: V3(1, 0, 0), y: V3(0, 1, 0), z: V3(0, 0, 1) };
    const m1 = new THREE.Matrix4().makeBasis(L[k1], L[k2], L[k1].clone().cross(L[k2]));
    const g1 = axis(def.axes[k1]), g2 = axis(def.axes[k2]);
    g2.addScaledVector(g1, -g2.dot(g1)).normalize();
    const m2 = new THREE.Matrix4().makeBasis(g1, g2, g1.clone().cross(g2));
    const q = new THREE.Quaternion().setFromRotationMatrix(m2.multiply(m1.invert()));
    item.obj.quaternion.copy(q);
    const sc = (def.scale || 1);
    const anchor = V3(...def.anchor).multiplyScalar(sc).applyQuaternion(q);
    let [pa, pf, pn] = def.pos;
    if (def.cyl) {
      // cylinders sit across the base of the fingers, one radius plus the palm's thickness out from the knuckles
      const mcp = this.bones['middle_01_' + s].getWorldPosition(new THREE.Vector3()).distanceTo(wrist) / this.scale;
      pf = mcp * 0.92;
      pn = def.cyl.r * sc + 0.022;
    }
    item.obj.position.copy(wrist).addScaledVector(fr.A, pa * this.scale).addScaledVector(fr.F, pf * this.scale).addScaledVector(N, pn * this.scale).sub(anchor);
    item.obj.updateMatrixWorld(true);
  }

  get torchHidden() { return this.emoteW > 0.5; }

  /** Left-hand pose (camera space) that holds the battery on the torch's axis just below its tail;
   *  push 0 = 6 cm short, 1 = seated. Uses last frame's torch transform. */
  batteryPose(push) {
    if (!this.left || this.leftType !== 'battery') return null;
    const cam = this.p.camera, tq = this.torch.obj.quaternion;
    const lens = V3(0, 0, 1).applyQuaternion(tq).normalize();
    const tail = this.torch.obj.localToWorld(V3(0, 0, -0.02));
    const def = this.left.def, sc = def.scale || 1;
    const center = tail.addScaledVector(lens, -(0.035 * sc + 0.06 * (1 - push)));
    // fingers come across from the left, the cell's axis (the grip's A) along the torch
    const camRight = V3(1, 0, 0).applyQuaternion(cam.quaternion);
    const F = camRight.addScaledVector(lens, -camRight.dot(lens)).normalize();
    const A = lens.clone();
    const N = F.clone().cross(A);                                   // left palm = F x A
    const H = this.hands.l;
    const mcp = this.bones.middle_01_l.getWorldPosition(V3(0, 0, 0)).distanceTo(this.bones.hand_l.getWorldPosition(V3(0, 0, 0)));
    const wrist = center.addScaledVector(F, -mcp * 0.92).addScaledVector(N, -(def.cyl.r * sc + 0.022) * this.scale);
    const invQ = cam.quaternion.clone().invert();
    const W = wrist.applyMatrix4(_m.copy(cam.matrixWorld).invert());
    void H;
    return pose(W.toArray(), A.applyQuaternion(invQ).toArray(), F.applyQuaternion(invQ).toArray(), 0.85, 0.75);
  }

  /** World position of the torch lens (the beam starts there). */
  tipWorld(out = new THREE.Vector3()) { return this.torchTip.getWorldPosition(out); }
  /** Between the left thumb and index fingertips (where a pinched key sits). */
  pinchWorld(out = new THREE.Vector3()) {
    const B = this.bones, a = B.thumb_03_l || B.thumb_02_l, b = B.index_03_l || B.index_02_l;
    if (!a || !b) return this.leftHandWorld(out);
    return out.copy(a.getWorldPosition(_c)).add(b.getWorldPosition(_d)).multiplyScalar(0.5);
  }
  leftHandWorld(out = new THREE.Vector3()) { return this.bones.hand_l.getWorldPosition(out); }
}

// ------------------------------------------------------------------ action timelines
// run(t, cur, body, action) edits the current camera-space poses; return { lw } to override the left arm weight.
function key(cur, s, p, k) { lerpPose(cur[s], p, k, cur[s]); }
const seg = (t, a, b) => ease((t - a) / (b - a));

const ACTIONS = {
  // thumb on the tail switch: click
  toggle: {
    dur: 0.32, events: [[0.11, 'apply']],
    run(t, cur) {
      const k = t < 0.11 ? seg(t, 0, 0.11) : 1 - seg(t, 0.14, 0.32);
      cur.r.th = cur.r.th + (1.2 - cur.r.th) * k;
      cur.r.W.y -= 0.008 * k; cur.r.W.z += 0.006 * k;
    },
  },
  // two hands: torch to the middle with the lens tipped up and away; the left hand lines the new cell up under the
  // torch's tail (tracked live, so it always meets it) and pushes it home, then the torch swings back level
  battery: {
    dur: 1.7, events: [[1.1, 'apply']],
    run(t, cur, body) {
      const R = pose([0.05, -0.1, -0.44], [0, 0.983, -0.177], [0, -0.177, -0.983], 0.92, 0.8);
      const kr = t < 0.4 ? seg(t, 0, 0.4) : t < 1.25 ? 1 : 1 - seg(t, 1.25, 1.65);
      key(cur, 'r', R, kr);
      const L = body.batteryPose(t < 0.7 ? 0 : seg(t, 0.7, 1.05));
      if (L) {
        const kl = t < 0.7 ? seg(t, 0.1, 0.65) : t < 1.1 ? 1 : 1 - seg(t, 1.15, 1.5);
        key(cur, 'l', L, kl);
      }
      return { lw: t < 1.45 ? 1 : 1 - seg(t, 1.45, 1.65), leftVisible: t < 1.1 };
    },
  },
  // kit up in front, then pressed to the chest
  medkit: {
    dur: 1.7, events: [[1.15, 'apply']],
    run(t, cur) {
      const L1 = palmPose('l', [-0.04, -0.2, -0.3], [0, 1, 0.2], [0, 0.25, -1], 0.4, 0.2);
      const L2 = palmPose('l', [-0.02, -0.32, -0.22], [0, 0.3, 1], [0, 0.8, -0.6], 0.5, 0.3);
      if (t < 0.5) key(cur, 'l', L1, seg(t, 0, 0.5));
      else if (t < 1.15) lerpPose(L1, L2, seg(t, 0.6, 1.1), cur.l);
      else key(cur, 'l', L2, 1 - seg(t, 1.3, 1.7));
      cur.r.W.y -= 0.04 * (t < 1.2 ? seg(t, 0.3, 0.7) : 1 - seg(t, 1.2, 1.6));
      return { lw: t < 1.5 ? 1 : 1 - seg(t, 1.5, 1.7), leftVisible: t < 1.2 };
    },
  },
  // bottle to the mouth, tip it back
  pills: {
    dur: 1.4, events: [[0.95, 'apply']],
    run(t, cur, body) {
      const L1 = pose([-0.03, -0.15, -0.24], [0.4, 0.85, 0.3], [0.85, -0.2, -0.5], 0.85, 0.7);
      const L2 = pose([-0.02, -0.11, -0.22], [0.3, 0.6, 0.75], [0.9, -0.3, -0.3], 0.85, 0.7);
      if (t < 0.5) key(cur, 'l', L1, seg(t, 0, 0.5));
      else if (t < 1.0) lerpPose(L1, L2, seg(t, 0.55, 0.9), cur.l);
      else key(cur, 'l', L2, 1 - seg(t, 1.0, 1.4));
      body.p.headTilt = 0.12 * (t < 1.0 ? seg(t, 0.55, 0.9) : 1 - seg(t, 1.0, 1.3));
      return { lw: 1, leftVisible: t < 1.0 };
    },
  },
  // syringe raised in an ice-pick grip, driven into the thigh
  syringe: {
    dur: 1.15, events: [[0.62, 'apply']],
    run(t, cur) {
      const L1 = pose([-0.1, -0.12, -0.3], [0, -0.3, 0.2], [0.45, 0.2, -0.9], 0.85, 0.75);
      const L2 = pose([-0.04, -0.52, -0.16], [0.1, -1, 0.1], [0.6, 0.0, -0.8], 0.9, 0.8);
      if (t < 0.4) key(cur, 'l', L1, seg(t, 0, 0.4));
      else if (t < 0.62) lerpPose(L1, L2, seg(t, 0.45, 0.6), cur.l);
      else key(cur, 'l', L2, 1 - seg(t, 0.8, 1.15));
      return { lw: 1, leftVisible: t < 0.8 };
    },
  },
  // thrust the cross out at the ghost and hold it there
  crucifix: {
    dur: 1.35, events: [[0.28, 'apply']],
    run(t, cur) {
      const L1 = pose([-0.04, -0.12, -0.5], [0, 1, 0.1], [0.2, 0.05, -1], 0.9, 0.8);
      const k = t < 0.25 ? seg(t, 0, 0.25) : t < 1.0 ? 1 : 1 - seg(t, 1.0, 1.35);
      key(cur, 'l', L1, k);
      cur.l.W.x += Math.sin(t * 40) * 0.003 * (t > 0.25 && t < 1.0 ? 1 : 0);        // trembling arm
      return { lw: 1, leftVisible: t < 1.05 };
    },
  },
  // wind up over the shoulder, fling it
  throw: {
    dur: 0.9, events: [[0.42, 'release']],
    run(t, cur) {
      const L1 = pose([-0.26, 0.02, 0.02], [0.2, 0.9, 0.3], [0.2, 0.3, -1], 0.85, 0.7);
      const L2 = pose([-0.02, -0.08, -0.6], [0.3, 0.6, -0.3], [0.2, -0.3, -1], 0.25, 0.2);
      if (t < 0.3) key(cur, 'l', L1, seg(t, 0, 0.3));
      else if (t < 0.48) lerpPose(L1, L2, seg(t, 0.3, 0.46), cur.l);
      else key(cur, 'l', L2, 1 - seg(t, 0.55, 0.9));
      return { lw: t < 0.75 ? 1 : 1 - seg(t, 0.75, 0.9), leftVisible: t < 0.42 };
    },
  },
  // left hand up to the padlock, key pinched between thumb and index (the cutscene moves the key with the
  // fingertips): in, a quarter turn with the wrist, let go and back. opts.target = the keyhole, world space
  unlock: {
    dur: 1.45, events: [[0.92, 'apply']],
    run(t, cur, body, A) {
      const cam = body.p.camera;
      const T = A.opts.target.clone().applyMatrix4(_m.copy(cam.matrixWorld).invert());
      const F = T.clone().normalize();                                    // fingers toward the lock
      const up = V3(0, 1, 0).addScaledVector(F, -F.y).normalize();        // index on top, thumb under: a pinch
      A.turn = 1.4 * seg(t, 0.62, 0.9) * (1 - seg(t, 1.0, 1.15));
      const Ax = up.applyAxisAngle(F, A.turn);
      const ins = seg(t, 0.36, 0.56) * (1 - seg(t, 1.0, 1.2));
      const W = T.clone().addScaledVector(F, -(0.2 - 0.035 * ins) * body.scale).addScaledVector(Ax, -0.02 * body.scale);
      const P = pose(W.toArray(), Ax.toArray(), F.toArray(), 0.5, 0.75);
      const k = t < 0.36 ? seg(t, 0, 0.36) : t < 1.12 ? 1 : 1 - seg(t, 1.12, 1.45);
      key(cur, 'l', P, k);
      return { lw: 1, leftVisible: false };
    },
  },
  // both hands flat on the doors and lean in (the torch hand pushes with its knuckles)
  push: {
    dur: 1.5, events: [[0.4, 'apply']],
    run(t, cur) {
      const Lp = palmPose('l', [-0.2, -0.1, -0.5], [0.1, 0.05, -1], [0.1, 1, -0.1], 0.2, 0.25);
      const k = t < 0.35 ? seg(t, 0, 0.35) : t < 0.95 ? 1 : 1 - seg(t, 0.95, 1.5);
      key(cur, 'l', Lp, k);
      cur.l.W.z -= 0.08 * seg(t, 0.35, 0.8) * k;
      cur.r.W.z -= 0.12 * k; cur.r.W.y += 0.05 * k;
      return { lw: k };
    },
  },
  // reach out with the left hand toward something in the world (doors, drawers, pick-ups)
  reach: {
    dur: 0.6, events: [[0.26, 'apply']],
    run(t, cur, body, A) {
      const cam = body.p.camera;
      const target = A.opts.target;
      let W = V3(-0.06, -0.2, -0.5);
      if (target) {
        const local = target.clone().applyMatrix4(_m.copy(cam.matrixWorld).invert());
        const len = local.length();
        if (len > 0.62) local.multiplyScalar(0.62 / len);
        W = local.add(V3(0, -0.04, 0.08));
      }
      const grab = A.opts.grab;
      const P = pose(W.toArray(), [0.3, 0.2, -0.9], [0.15, -0.15, -1], grab ? 0.15 : 0.2, 0.15);
      const k = t < 0.26 ? seg(t, 0, 0.26) : 1 - seg(t, 0.3, 0.6);
      if (body.left) { key(cur, 'l', P, k); }
      else { lerpPose(cur.l, P, 1, cur.l); }
      if (grab && t > 0.26) cur.l.c = Math.min(0.9, 0.15 + (t - 0.26) * 4);
      return { lw: body.left ? 1 : k };
    },
  },
};

export { ITEMS as FP_ITEMS };
