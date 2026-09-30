// Skinned character wrapper: appearance (player profiles), animation blending, procedural aiming (flashlight arm,
// head look), attachments and the dissolve effect used when ghosts vanish.
import * as THREE from 'three';
import { cloneCharacter, prepareCharacter, cloneProp, applyLibrary } from '../core/assets.js';
import { quality } from '../core/settings.js';
import { PROFILES } from '../world/maps.js';

const LOCOMOTION = /^(Idle|Walk|Run|CrouchIdle|CrouchWalk|Glide|Chase|Crawl|Search|Stare)$/;
const clipCache = new Map();

/** Sanitise clips once per model: drop scale / static translation tracks, pin locomotion hips in x/z. */
function cleanClips(name, clips) {
  if (clipCache.has(name)) return clipCache.get(name);
  const out = clips.map((c) => {
    const clip = c.clone();
    clip.tracks = clip.tracks.filter((t) => {
      if (t.name.endsWith('.scale')) return false;
      if (t.name.endsWith('.position')) {
        if (!/^hips\./.test(t.name)) return false;
        if (LOCOMOTION.test(clip.name)) {
          const v = t.values;
          for (let i = 3; i < v.length; i += 3) { v[i] = v[0]; v[i + 2] = v[2]; }
        }
      }
      return true;
    });
    return clip;
  });
  const map = Object.fromEntries(out.map((c) => [c.name, c]));
  clipCache.set(name, map);
  return map;
}

const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _v = new THREE.Vector3(), _v2 = new THREE.Vector3();
const Y = new THREE.Vector3(0, 1, 0);

/** Rotate a bone so its +Y axis (bone direction) points along a world-space direction. */
export function aimBone(bone, worldDir, weight = 1) {
  if (!bone) return;
  bone.parent.getWorldQuaternion(_q);
  _q2.copy(_q).multiply(bone.quaternion);             // current world rotation
  _v.copy(Y).applyQuaternion(_q2);                    // current world bone axis
  const delta = new THREE.Quaternion().setFromUnitVectors(_v, _v2.copy(worldDir).normalize());
  if (weight < 1) delta.slerp(new THREE.Quaternion(), 1 - weight);
  _q2.premultiply(delta);
  bone.quaternion.copy(_q.invert().multiply(_q2));
  bone.updateMatrixWorld(true);
}

// ------------------------------------------------------------------------------ dissolve (ghost vanish / appear)
function addDissolve(mat, shared) {
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uDissolve = shared.uDissolve;
    sh.uniforms.uGlow = shared.uGlow;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vDPos;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvDPos = position;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
      varying vec3 vDPos; uniform float uDissolve; uniform float uGlow;
      float dHash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
      float dNoise(vec3 x) { vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(mix(dHash(i), dHash(i + vec3(1,0,0)), f.x), mix(dHash(i + vec3(0,1,0)), dHash(i + vec3(1,1,0)), f.x), f.y),
                   mix(mix(dHash(i + vec3(0,0,1)), dHash(i + vec3(1,0,1)), f.x), mix(dHash(i + vec3(0,1,1)), dHash(i + vec3(1,1,1)), f.x), f.y), f.z); }`)
      .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
      float dn = dNoise(vDPos * 9.0) * 0.7 + dNoise(vDPos * 23.0) * 0.3;
      if (dn < uDissolve) discard;`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
      float edge = smoothstep(uDissolve + 0.08, uDissolve, dn) * step(0.001, uDissolve);
      totalEmissiveRadiance += vec3(0.35, 0.55, 0.9) * (edge * 6.0 + uGlow);`);
  };
  mat.customProgramCacheKey = () => 'dissolve';
  mat.needsUpdate = true;
}

export class Avatar {
  /**
   * kind: 'player' | 'widow' | 'child' | 'warden'
   * opts: { profile, firstPerson }
   */
  constructor(kind, opts = {}) {
    this.kind = kind;
    const model = kind === 'player' ? 'player' : 'ghost_' + kind;
    const { root, animations } = cloneCharacter(model);
    prepareCharacter(root, quality().msaa);
    this.root = new THREE.Group();
    this.root.add(root);
    this.model = root;
    this.clips = cleanClips(model, animations);
    this.mixer = new THREE.AnimationMixer(root);
    this.actions = {};
    this.current = null;
    this.bones = {};
    root.traverse((o) => { if (o.isBone) this.bones[o.name] = o; });
    this.meshes = [];
    root.traverse((o) => { if (o.isSkinnedMesh) this.meshes.push(o); });
    this.dissolveU = { uDissolve: { value: 0 }, uGlow: { value: 0 } };
    this.attach = {};
    if (kind === 'player') this._applyProfile(opts.profile ?? 0, !!opts.firstPerson);
    else this._ghostMaterials();
    this.firstPerson = !!opts.firstPerson;
    this.lookTarget = null;
    this.aim = null;             // { dir: Vector3 } flashlight aim
    this.speedScale = 1;
  }

  _applyProfile(pi, fp) {
    const P = PROFILES[pi % PROFILES.length];
    this.profile = P;
    const show = new Set(['Player_Body', 'Player_Eyes', P.top, P.pants, P.shoes, P.hair]);
    if (P.hat) show.add(P.hat);
    if (P.backpack) show.add('Acc_Backpack');
    if (P.glasses) show.add('Acc_Glasses');
    // hats replace long-hair crowns poorly: keep long hair under beanie, drop short hair under cap
    if (P.hat === 'Hat_Cap' && P.hair === 'Hair_Short') show.delete('Hair_Short');
    const tint = (m, hex, k = 1.7) => {
      const c = new THREE.Color(hex);
      if (hex === 0xffffff) return;
      m.color.copy(c).multiplyScalar(k);
    };
    for (const m of this.meshes) {
      m.visible = show.has(m.name);
      if (!m.visible) continue;
      m.material = m.material.clone();
      const mat = m.material;
      if (m.name === P.top) tint(mat, P.topColor);
      else if (m.name === P.pants) tint(mat, P.pantsColor);
      else if (m.name === P.hair) { tint(mat, P.hairColor, 1.6); }
      else if (m.name === P.hat) tint(mat, P.hatColor || 0x333333);
      else if (m.name === 'Player_Body') {
        const s = new THREE.Color(P.skin), base = new THREE.Color(0.77, 0.63, 0.545);
        mat.color.setRGB(Math.min(1.3, s.r / base.r), Math.min(1.3, s.g / base.g), Math.min(1.3, s.b / base.b));
      }
      if (Array.isArray(mat)) continue;
      mat.roughness = Math.max(mat.roughness ?? 0.8, 0.35);
    }
    for (const m of this.meshes) if (m.visible && m.name === 'Hair_Long' && Array.isArray(m.material)) m.material = m.material.map((x) => x.clone());
    if (fp) {
      // first-person body: collapse the head so the camera sits cleanly inside the neck; hair/hat/glasses hidden
      for (const m of this.meshes) if (/Hair|Hat|Glasses|Eyes/.test(m.name)) m.visible = false;
      if (this.bones.head) this.bones.head.scale.setScalar(0.001);
      for (const m of this.meshes) { m.castShadow = false; }
    }
    // flashlight in the right hand
    const fl = cloneProp('items', 'Flashlight'); applyLibrary(fl);
    fl.traverse((o) => { if (o.isMesh && /bulb/.test(o.material.name)) o.material = o.material.clone(); });
    fl.scale.setScalar(1.0);
    const hand = this.bones['hand.R'];
    if (hand) {
      const holder = new THREE.Group();
      holder.add(fl);
      // model: flashlight points +Z; bone: +Y runs along the fingers
      fl.rotation.set(-Math.PI / 2, 0, 0);
      fl.position.set(-0.01, 0.07, 0.025);
      hand.add(holder);
      this.attach.flashlight = fl;
      this.attach.flashTip = fl.getObjectByName('Flashlight_Tip');
    }
  }

  _ghostMaterials() {
    for (const m of this.meshes) {
      m.material = m.material.clone();
      const mat = m.material;
      if (/Eye|Pupil/.test(mat.name)) {
        if (mat.emissive) { mat.emissive.setHex(this.kind === 'warden' ? 0xff3010 : 0xbfe6ff); mat.emissiveIntensity = 2.5; }
      }
      addDissolve(mat, this.dissolveU);
    }
  }

  action(name) {
    if (this.actions[name]) return this.actions[name];
    const clip = this.clips[name];
    if (!clip) return null;
    const a = this.mixer.clipAction(clip);
    this.actions[name] = a;
    return a;
  }

  /** Crossfade to a clip. opts: { fade, once, speed, restart } */
  play(name, opts = {}) {
    const a = this.action(name);
    if (!a) return null;
    const fade = opts.fade ?? 0.25;
    if (this.current === a && !opts.restart) { if (opts.speed !== undefined) a.timeScale = opts.speed; return a; }
    a.reset();
    a.enabled = true;
    a.setLoop(opts.once ? THREE.LoopOnce : THREE.LoopRepeat, Infinity);
    a.clampWhenFinished = !!opts.once;
    a.timeScale = opts.speed ?? 1;
    a.setEffectiveWeight(1);
    if (this.current && this.current !== a) a.crossFadeFrom(this.current, fade, true);
    a.play();
    this.current = a;
    this.currentName = name;
    return a;
  }

  clipDuration(name) { return this.clips[name] ? this.clips[name].duration : 1; }

  setSpeed(s) { if (this.current) this.current.timeScale = s; }

  update(dt) {
    this.mixer.update(dt);
    if (this.aim && this.kind === 'player') this._aimFlashlight();
    if (this.lookTarget && this.bones.head) this._lookAt(this.lookTarget);
  }

  _aimFlashlight() {
    const b = this.bones;
    if (!b['upper_arm.R']) return;
    this.model.updateMatrixWorld(true);
    const dir = this.aim.dir;
    const chest = b.chest.getWorldPosition(new THREE.Vector3());
    const right = new THREE.Vector3().crossVectors(dir, Y).normalize();
    // hand target: in front of the chest, slightly right and low, along the aim direction
    const target = chest.clone().addScaledVector(dir, 0.46).addScaledVector(right, 0.13).add(new THREE.Vector3(0, this.firstPerson ? -0.06 : 0.02, 0));
    const shoulder = b['upper_arm.R'].getWorldPosition(new THREE.Vector3());
    const elbowT = shoulder.clone().lerp(target, 0.5).addScaledVector(right, 0.05).add(new THREE.Vector3(0, -0.12, 0));
    const w = this.aim.weight ?? 1;
    aimBone(b['upper_arm.R'], elbowT.sub(shoulder), w);
    const elbow = b['forearm.R'].getWorldPosition(new THREE.Vector3());
    aimBone(b['forearm.R'], target.clone().sub(elbow), w);
    aimBone(b['hand.R'], dir, w);
    // keep the fingers wrapped: small curl on each finger root
    for (const f of ['f0.0.R', 'f1.0.R', 'f2.0.R', 'f3.0.R']) if (b[f]) b[f].rotation.x += 0.9 * w;
  }

  _lookAt(target) {
    const head = this.bones.head;
    const hp = head.getWorldPosition(new THREE.Vector3());
    const d = target.clone().sub(hp);
    if (d.lengthSq() < 0.01) return;
    // only the yaw/pitch component within limits, blended over the animation pose
    const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(this.root.quaternion);
    const ang = fwd.angleTo(new THREE.Vector3(d.x, 0, d.z));
    if (ang > 1.4) return;
    d.normalize();
    const up = d.clone().add(new THREE.Vector3(0, 1, 0)).normalize();
    aimBone(head, up, 0.5);
  }

  setDissolve(v, glow = 0) {
    this.dissolveU.uDissolve.value = v;
    this.dissolveU.uGlow.value = glow;
    this.root.visible = v < 0.99;
  }

  setFlashlightOn(on) {
    const fl = this.attach.flashlight;
    if (!fl) return;
    fl.traverse((o) => { if (o.isMesh && /bulb/.test(o.material.name)) o.material.emissiveIntensity = on ? 3 : 0; });
  }

  dispose() {
    this.mixer.stopAllAction();
    this.root.removeFromParent();
  }
}
