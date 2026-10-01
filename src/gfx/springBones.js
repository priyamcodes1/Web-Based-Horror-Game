// Spring-bone secondary motion (soft-tissue jiggle + hair), VRM-style verlet tails with sphere colliders.
// Config comes from the GLB: scene node extras `mara_physics` (written by tools/blender/mara_j.py):
//   springs:   [{ bone, parent, tail:[x,y,z] (rest, scene space), stiffness, drag, gravity, radius, maxAngle }]
//   colliders: [{ bone, center:[x,y,z] (rest, scene space), radius }]
// Rest positions are converted to bone-local space at bind time, so glTF axis conventions never matter.
import * as THREE from 'three';

const sanitize = (n) => THREE.PropertyBinding.sanitizeNodeName(n);
const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();
const _q1 = new THREE.Quaternion(), _q2 = new THREE.Quaternion();
const _m1 = new THREE.Matrix4();

export class SpringBones {
  /**
   * @param {THREE.Object3D} root  the loaded gltf.scene (must be at its rest pose when constructed)
   * @param {object} cfg           parsed `mara_physics` config
   */
  constructor(root, cfg, opts = {}) {
    this.root = root;
    this.enabled = true;
    this.intensity = opts.intensity ?? 1.0;     // scales inertia response (0 = rigid)
    this.wind = new THREE.Vector3();            // world-space wind force (m/s^2-ish)
    this.step = 1 / 120;
    this._acc = 0;
    const bones = {};
    root.traverse((o) => { if (o.isBone) bones[o.name] = o; });
    root.updateMatrixWorld(true);
    const rootInv = new THREE.Matrix4().copy(root.matrixWorld).invert();
    const toWorld = (p) => new THREE.Vector3(...p).applyMatrix4(root.matrixWorld);
    void rootInv;

    this.colliders = [];
    for (const c of cfg.colliders || []) {
      const b = bones[sanitize(c.bone)];
      if (!b) continue;
      this.colliders.push({ bone: b, local: b.worldToLocal(toWorld(c.center)), radius: c.radius, world: new THREE.Vector3() });
    }

    this.joints = [];
    for (const s of cfg.springs || []) {
      const b = bones[sanitize(s.bone)];
      if (!b) continue;
      const head = b.getWorldPosition(new THREE.Vector3());
      const tailW = toWorld(s.tail);
      const localTail = b.worldToLocal(tailW.clone());           // tail in the bone's own frame
      const len = tailW.distanceTo(head);
      this.joints.push({
        bone: b, s,
        axis: localTail.clone().normalize(),
        restQuat: b.quaternion.clone(),                          // rest local rotation (springs are never keyed)
        len,
        cur: tailW.clone(), prev: tailW.clone(),
        depth: 0,
      });
    }
    // parents before children
    for (const j of this.joints) { let d = 0, o = j.bone; while (o.parent) { d++; o = o.parent; } j.depth = d; }
    // fit colliders: at rest no colliding tail (or its bone head) may start inside a collider, otherwise the
    // solver would shove it out every frame (hair puffing / bunching). Shrink each sphere until all clear.
    for (const c of this.colliders) {
      c.bone.updateMatrixWorld(true);
      const cw = c.local.clone().applyMatrix4(c.bone.matrixWorld);
      for (const j of this.joints) {
        if (!this._collides(j, c)) continue;
        const head = j.bone.getWorldPosition(new THREE.Vector3());
        for (const p of [j.cur, head]) {
          const free = p.distanceTo(cw) - j.s.radius - 0.003;
          if (free < c.radius) c.radius = Math.max(0.01, free);
        }
      }
    }
    this.joints.sort((a, b) => a.depth - b.depth);
    this.gravityDir = new THREE.Vector3(0, -1, 0);
  }

  /** Soft tissue sits inside the body and is bounded by its angle limit; only hair-like springs collide. */
  _collides(j, c) {
    return j.s.kind === 'hair' && c.bone !== j.bone;
  }

  /** Snap all tails to the current animated pose (call after teleports / clip switches). */
  reset() {
    this.root.updateMatrixWorld(true);
    for (const j of this.joints) {
      j.bone.quaternion.copy(j.restQuat);
      j.bone.updateMatrixWorld(true);
      const t = this._restTail(j, _v1);
      j.cur.copy(t); j.prev.copy(t);
    }
  }

  _restTail(j, out) {
    // where the tail would be with the bone at its rest local rotation under the current (animated) parent
    const parent = j.bone.parent;
    _q1.copy(parent.getWorldQuaternion(_q2)).multiply(j.restQuat);
    const head = j.bone.getWorldPosition(_v3);
    return out.copy(j.axis).applyQuaternion(_q1).multiplyScalar(j.len).add(head);
  }

  update(dt) {
    if (!this.enabled || !this.joints.length) return;
    // variable substeps: always simulate exactly dt (no lag/stutter at low frame rates), max 1/120 s each
    dt = Math.min(dt, 0.1);
    this.root.updateMatrixWorld(true);
    for (const c of this.colliders) c.world.copy(c.local).applyMatrix4(c.bone.matrixWorld);
    const n = Math.max(1, Math.ceil(dt / this.step));
    for (let i = 0; i < n; i++) this._substep(dt / n);
  }

  _substep(h) {
    const f60 = h * 60;                                          // parameters are tuned per 60 Hz frame
    for (const j of this.joints) {
      const s = j.s, b = j.bone;
      b.quaternion.copy(j.restQuat);
      b.updateMatrixWorld(true);
      const head = b.getWorldPosition(new THREE.Vector3());
      const restT = this._restTail(j, new THREE.Vector3());
      const restDir = _v2.copy(restT).sub(head).normalize();

      // verlet: inertia (with drag) + stiffness toward the animated rest direction + gravity + wind
      const keep = Math.pow(1 - s.drag, f60);                    // drag, rate-corrected for substeps
      const vel = _v1.copy(j.cur).sub(j.prev).multiplyScalar(keep * this.intensity);
      const vmax = j.len * 0.35 * f60;                            // no single step may whip a joint around
      if (vel.length() > vmax) vel.setLength(vmax);
      const next = j.cur.clone().add(vel)
        .addScaledVector(restDir, s.stiffness * 6 * h * j.len)   // VRM: stiffness * dt (scaled to bone length)
        .addScaledVector(this.gravityDir, s.gravity * h * j.len)
        .addScaledVector(this.wind, h * j.len * (s.kind === 'hair' ? 1 : 0.1));
      // length constraint
      next.sub(head).normalize().multiplyScalar(j.len).add(head);
      // colliders (sphere vs tail sphere)
      for (const c of this.colliders) {
        if (!this._collides(j, c)) continue;
        const r = c.radius + s.radius;
        const d = next.distanceTo(c.world);
        if (d < r) {
          next.sub(c.world).normalize().multiplyScalar(r).add(c.world);
          next.sub(head).normalize().multiplyScalar(j.len).add(head);
        }
      }
      // angle limit around the rest direction
      const dir = _v3.copy(next).sub(head).normalize();
      const ang = dir.angleTo(restDir);
      const lim = THREE.MathUtils.degToRad(s.maxAngle);
      if (ang > lim) {
        _q1.setFromUnitVectors(restDir, dir);
        const qLim = new THREE.Quaternion().slerp(_q1, lim / ang);
        dir.copy(restDir).applyQuaternion(qLim);
        next.copy(head).addScaledVector(dir, j.len);
      }
      j.prev.copy(j.cur); j.cur.copy(next);

      // rotate the bone so its tail points at the simulated tail
      const delta = _q1.setFromUnitVectors(restDir, dir);
      const parentQ = b.parent.getWorldQuaternion(_q2);
      const worldQ = new THREE.Quaternion().copy(parentQ).multiply(j.restQuat);
      worldQ.premultiply(delta);
      b.quaternion.copy(parentQ.invert().multiply(worldQ));
      b.updateMatrixWorld(true);
    }
  }
}

/** Find the physics config in a loaded glTF scene (extras land in userData). */
export function findPhysicsConfig(scene) {
  let cfg = null;
  scene.traverse((o) => {
    const raw = o.userData && o.userData.mara_physics;
    if (raw && !cfg) cfg = typeof raw === 'string' ? JSON.parse(raw) : raw;
  });
  return cfg;
}

/** Procedural blink driver for the lid bones listed in the config (adds on top of animation). */
export class Blinker {
  constructor(scene, cfg) {
    this.bones = [];
    scene.traverse((o) => { if (o.isBone && cfg?.blink?.bones.map(sanitize).includes(o.name)) this.bones.push(o); });
    this.close = THREE.MathUtils.degToRad(cfg?.blink?.closeDeg ?? 34);
    this.t = 0; this.next = 1.5 + Math.random() * 3; this.phase = -1;
    this.axis = new THREE.Vector3(1, 0, 0);
    this.base = this.bones.map((b) => b.quaternion.clone());
  }
  update(dt) {
    if (!this.bones.length) return;
    this.t += dt;
    if (this.phase < 0 && this.t > this.next) { this.phase = 0; this.t = 0; }
    let a = 0;
    if (this.phase >= 0) {
      this.phase += dt / 0.16;
      a = Math.sin(Math.min(1, this.phase) * Math.PI);
      if (this.phase >= 1) { this.phase = -1; this.t = 0; this.next = 2 + Math.random() * 4; }
    }
    // the lid rest axis: rotate about the bone's local X (Blender bone X stays X after export)
    for (const b of this.bones) b.quaternion.multiply(_q1.setFromAxisAngle(this.axis, a * this.close));
    void _m1;
  }
}
