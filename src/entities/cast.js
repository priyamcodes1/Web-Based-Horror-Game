// Survivor cast: realistic MakeHuman characters (tools/blender/cast.py) sharing one mocap library per body
// type (tools/blender/anims.py). Every character uses the same game_engine bone names, so clips from the
// library play on anyone; the pelvis (root motion) track is rescaled to each character's hip height.
// Secondary motion: spring bones for the backpack, skirt panels and long hair, with thigh colliders so a
// stride pushes the skirt out instead of passing through it.
import * as THREE from 'three';
import { clone as skeletonClone } from 'three/addons/utils/SkeletonUtils.js';
import { loadGLTF, assets } from '../core/assets.js';
import { SpringBones } from '../gfx/springBones.js';

export const CAST = [
  { id: 'ava', name: 'Ava', sex: 'f', desc: 'Crop top, denim shorts, red pack' },
  { id: 'maya', name: 'Maya', sex: 'f', desc: 'Tube top, plaid skirt, knee boots' },
  { id: 'zoe', name: 'Zoe', sex: 'f', desc: 'Knit crop top, jeans, green pack' },
  { id: 'lena', name: 'Lena', sex: 'f', desc: 'Cami, denim skirt, sneakers' },
  { id: 'jake', name: 'Jake', sex: 'm', desc: 'Tee, shorts, black pack' },
  { id: 'marcus', name: 'Marcus', sex: 'm', desc: 'Muscle shirt, shorts, olive pack' },
  { id: 'kenji', name: 'Kenji', sex: 'm', desc: 'Shirt, jeans, biker boots' },
  { id: 'cole', name: 'Cole', sex: 'm', desc: 'Tank, board shorts, brown pack' },
];
export const castById = (i) => CAST[((i % CAST.length) + CAST.length) % CAST.length];

const LIB = {};      // sex -> { clips: {name: AnimationClip}, hip, restPelvis }

async function loadLibrary(sex) {
  if (LIB[sex]) return LIB[sex];
  const g = await loadGLTF(sex === 'f' ? 'anim_f' : 'anim_m');
  let meta = null, pelvis = null;
  g.scene.traverse((o) => {
    if (o.userData && o.userData.anim) { try { meta = JSON.parse(o.userData.anim); } catch (_) { /* ignore */ } }
    if (o.name === 'pelvis') pelvis = o;
  });
  LIB[sex] = { clips: Object.fromEntries(g.animations.map((c) => [c.name, c])), hip: meta?.hip ?? 1, restPelvis: pelvis ? pelvis.position.clone() : new THREE.Vector3() };
  return LIB[sex];
}

/** Load the GLBs a roster needs (characters + their animation libraries). */
export async function loadCast(ids) {
  const want = [...new Set(ids.map((i) => castById(i).id))];
  await Promise.all(want.map((id) => loadGLTF('chars/' + id)));
  await Promise.all([...new Set(want.map((id) => CAST.find((c) => c.id === id).sex))].map(loadLibrary));
}

/** Pelvis translation track re-based onto this character's rest pose and scaled by hip height. */
function adaptClip(clip, lib, restPelvis, hipRatio) {
  const tracks = clip.tracks.map((t) => {
    if (!/pelvis\.position$/.test(t.name)) return t;
    const v = t.values.slice();
    for (let i = 0; i < v.length; i += 3) {
      v[i] = restPelvis.x + (v[i] - lib.restPelvis.x) * hipRatio;
      v[i + 1] = restPelvis.y + (v[i + 1] - lib.restPelvis.y) * hipRatio;
      v[i + 2] = restPelvis.z + (v[i + 2] - lib.restPelvis.z) * hipRatio;
    }
    return new THREE.VectorKeyframeTrack(t.name, t.times, v);
  });
  return new THREE.AnimationClip(clip.name, clip.duration, tracks);
}

function prepMaterials(root) {
  root.traverse((o) => {
    if (!o.isMesh) return;
    o.frustumCulled = false;            // skinned bounds lie when animated
    o.castShadow = true; o.receiveShadow = true;
    const m = o.material;
    const n = (m.name || '') + ' ' + o.name;
    if (/Hair|Brow|Lash|eyebrow|eyelash/i.test(n)) {
      m.alphaTest = 0.4; m.transparent = false; m.side = THREE.DoubleSide; m.depthWrite = true;
      if (/Brow|Lash|eyebrow|eyelash/i.test(n)) o.castShadow = false;
    }
    if (/Skirt/i.test(n)) m.side = THREE.DoubleSide;
    // nothing on a person should be a mirror under a torch
    if ('roughness' in m) m.roughness = Math.max(m.roughness, /high-poly|Eye_M/i.test(n) ? 0.38 : 0.5);
    if ('metalness' in m && !/Zip/.test(n)) m.metalness = 0;
    if (m.map) m.map.anisotropy = 4;
  });
}

/** Hands must rest on a skirt, not sink through it (the shared mocap library was captured on bare legs).
 *  At rest, record the skirt's outline around the pelvis (max radius per height band and direction); each frame
 *  after the clip is applied, swing any arm whose hand or fingertips fall inside that outline out to its surface. */
const SECT = 12, BANDS = 6;
function makeSkirtFit(root, bones) {
  let skirt = null;
  root.traverse((o) => { if (o.isSkinnedMesh && /skirt/i.test(o.name)) skirt = o; });
  if (!skirt || !bones.pelvis || !bones.upperarm_l) return null;
  root.updateMatrixWorld(true);
  const toLocal = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const pel = bones.pelvis.getWorldPosition(new THREE.Vector3()).applyMatrix4(toLocal);
  const pos = skirt.geometry.attributes.position, v = new THREE.Vector3();
  let y0 = Infinity, y1 = -Infinity;
  const pts = [];
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).applyMatrix4(skirt.matrixWorld).applyMatrix4(toLocal).sub(pel);
    pts.push(v.x, v.y, v.z); y0 = Math.min(y0, v.y); y1 = Math.max(y1, v.y);
  }
  const R = new Float32Array(SECT * BANDS);
  for (let i = 0; i < pts.length; i += 3) {
    const x = pts[i], y = pts[i + 1], z = pts[i + 2];
    const b = Math.min(BANDS - 1, Math.floor((y - y0) / (y1 - y0 + 1e-6) * BANDS));
    const a = Math.floor(((Math.atan2(x, z) / (2 * Math.PI)) + 1) % 1 * SECT) % SECT;
    R[b * SECT + a] = Math.max(R[b * SECT + a], Math.hypot(x, z));
  }
  const radius = (y, ang) => {
    const fb = Math.min(BANDS - 1, Math.max(0, (y - y0) / (y1 - y0) * BANDS - 0.5));
    const fa = (((ang / (2 * Math.PI)) + 1) % 1) * SECT - 0.5;
    const b0 = Math.floor(fb), b1 = Math.min(BANDS - 1, b0 + 1), tb = fb - b0;
    const a0 = (Math.floor(fa) + SECT) % SECT, a1 = (a0 + 1) % SECT, ta = fa - Math.floor(fa);
    const r = (b, a) => R[b * SECT + a];
    return (r(b0, a0) * (1 - ta) + r(b0, a1) * ta) * (1 - tb) + (r(b1, a0) * (1 - ta) + r(b1, a1) * ta) * tb;
  };
  const side = (s) => ({ up: bones['upperarm_' + s], pts: [bones['hand_' + s], bones['middle_01_' + s], bones['middle_03_' + s]].filter(Boolean) });
  const arms = [side('l'), side('r')];
  const legs = legPush(root, bones, skirt);
  const inv = new THREE.Matrix4(), pc = new THREE.Vector3(), p = new THREE.Vector3(), sh = new THREE.Vector3();
  const a = new THREE.Vector3(), b = new THREE.Vector3(), q = new THREE.Quaternion(), wq = new THREE.Quaternion(), pq = new THREE.Quaternion();
  return () => {
    root.updateMatrixWorld(true);
    inv.copy(root.matrixWorld).invert();
    bones.pelvis.getWorldPosition(pc).applyMatrix4(inv);
    for (const arm of arms) {
      // deepest point of the hand inside the outline -> how far (root-local, horizontal) it must move out
      let best = 0, bx = 0, bz = 0, bp = null;
      for (const bn of arm.pts) {
        bn.getWorldPosition(p).applyMatrix4(inv).sub(pc);
        if (p.y < y0 - 0.03 || p.y > y1 - 0.02) continue;
        const d = Math.hypot(p.x, p.z), need = radius(p.y, Math.atan2(p.x, p.z)) * 1.04 + 0.02 - d;
        if (need > best && d > 1e-3) { best = need; bx = p.x / d; bz = p.z / d; bp = bn; }
      }
      if (!bp) continue;
      // rotate the whole arm about the shoulder so that point lands on the surface
      arm.up.getWorldPosition(sh);
      bp.getWorldPosition(a);
      b.set(bx * best, 0, bz * best).transformDirection(root.matrixWorld).multiplyScalar(best).add(a);
      q.setFromUnitVectors(a.sub(sh).normalize(), b.sub(sh).normalize());
      arm.up.getWorldQuaternion(wq);
      arm.up.parent.getWorldQuaternion(pq);
      arm.up.quaternion.copy(pq.invert().multiply(q.multiply(wq)));
      arm.up.updateMatrixWorld(true);
    }
    if (legs) legs();
  };
}

/** Linear-blend skinning pulls a half-thigh-weighted skirt inward exactly when the thigh swings forward, so a
 *  high step pokes the leg through the cloth. After skinning, the skirt's vertex shader pushes any vertex that
 *  sits inside a thigh capsule (radius profile measured from this character's own body mesh) out to its surface. */
const NB = 8;
function legPush(root, bones, skirt) {
  let body = null;
  root.traverse((o) => { if (o.isSkinnedMesh && /_Body$/.test(o.name)) body = o; });
  if (!body || !bones.thigh_l || !bones.calf_l) return null;
  const toSkirt = new THREE.Matrix4().copy(skirt.matrixWorld).invert();
  const W = (b) => b.getWorldPosition(new THREE.Vector3()).applyMatrix4(toSkirt);
  const radii = new Float32Array(2 * NB);
  const pos = body.geometry.attributes.position, si = body.geometry.attributes.skinIndex, sw = body.geometry.attributes.skinWeight;
  const v = new THREE.Vector3(), ab = new THREE.Vector3(), c = new THREE.Vector3();
  ['l', 'r'].forEach((s, l) => {
    const bi = body.skeleton.bones.indexOf(bones['thigh_' + s]);
    const a = W(bones['thigh_' + s]), b = W(bones['calf_' + s]);
    ab.subVectors(b, a);
    const bins = Array.from({ length: NB }, () => []);
    for (let i = 0; i < pos.count; i++) {
      let w = 0;
      for (let k = 0; k < 4; k++) if (si.getComponent(i, k) === bi) w += sw.getComponent(i, k);
      if (w < 0.5) continue;
      v.fromBufferAttribute(pos, i).applyMatrix4(body.matrixWorld).applyMatrix4(toSkirt);
      const t = v.clone().sub(a).dot(ab) / ab.lengthSq();
      if (t < 0 || t > 1) continue;
      c.copy(a).addScaledVector(ab, t);
      bins[Math.min(NB - 1, Math.floor(t * NB))].push(v.distanceTo(c));
    }
    for (let k = 0; k < NB; k++) {
      const d = bins[k].sort((x, y) => x - y);
      radii[l * NB + k] = d.length ? d[Math.floor(d.length * 0.9)] : 0;
    }
    for (let k = 1; k < NB; k++) if (!radii[l * NB + k]) radii[l * NB + k] = radii[l * NB + k - 1];
  });
  const uni = { uLegA: { value: [new THREE.Vector3(), new THREE.Vector3()] }, uLegB: { value: [new THREE.Vector3(), new THREE.Vector3()] }, uLegR: { value: radii } };
  const mat = skirt.material = skirt.material.clone();
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uni);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
uniform vec3 uLegA[2];
uniform vec3 uLegB[2];
uniform float uLegR[${2 * NB}];`)
      .replace('#include <skinning_vertex>', `#include <skinning_vertex>
      for (int l = 0; l < 2; l++) {
        vec3 a = uLegA[l], ab = uLegB[l] - a;
        float t = dot(transformed - a, ab) / dot(ab, ab);
        if (t < 0.06 || t > 1.0) continue;
        vec3 d = transformed - (a + ab * t);
        float fb = clamp(t * ${NB}.0 - 0.5, 0.0, ${NB - 1}.0);
        int i0 = int(floor(fb));
        float r = mix(uLegR[l * ${NB} + i0], uLegR[l * ${NB} + min(i0 + 1, ${NB - 1})], fract(fb)) + 0.015;
        float dist = length(d);
        if (dist < r && dist > 1e-4) transformed += d * (r / dist - 1.0);
      }`);
  };
  mat.customProgramCacheKey = () => 'skirtLegPush';
  const inv = new THREE.Matrix4();
  return () => {
    inv.copy(skirt.matrixWorld).invert();
    ['l', 'r'].forEach((s, l) => {
      bones['thigh_' + s].getWorldPosition(uni.uLegA.value[l]).applyMatrix4(inv);
      bones['calf_' + s].getWorldPosition(uni.uLegB.value[l]).applyMatrix4(inv);
    });
  };
}

/** The rigs' clavicles stand out level and the shoulder joints sit far out, so every survivor had a wide, square,
 *  shoulder-pad silhouette. Real shoulders slope down from the neck and roll slightly forward, and the deltoid is
 *  rounder and slimmer: drop and roll each clavicle, pull the shoulder joint in toward the neck, and thin the upper
 *  arm's cross-section (its length, and the forearm, untouched). Applied after the clip every frame (the clips
 *  key every bone), guarded so a bone no clip writes is never offset twice. */
const SHOULDER = { drop: THREE.MathUtils.degToRad(19), roll: THREE.MathUtils.degToRad(10), narrow: 0.8, slim: 0.9 };
function relaxShoulders(root, bones) {
  const ops = [];
  // re-apply `fn` on top of whatever the mixer left in `v` (a Vector3/Quaternion), never on top of itself
  const guarded = (v, fn) => { const pre = v.clone(), post = v.clone().set(NaN, NaN, NaN, NaN); ops.push(() => { if (v.equals(post)) v.copy(pre); pre.copy(v); fn(v); post.copy(v); }); };
  root.updateMatrixWorld(true);
  for (const s of ['l', 'r']) {
    const clav = bones['clavicle_' + s], arm = bones['upperarm_' + s], fore = bones['lowerarm_' + s];
    if (!clav || !arm || !clav.parent) continue;
    const tip = arm.getWorldPosition(new THREE.Vector3()).sub(clav.getWorldPosition(new THREE.Vector3()));
    const sign = Math.sign(tip.x) || (s === 'l' ? 1 : -1);
    // model faces +Z, up +Y: tip down = about Z, tip forward = about Y (rest pose, world space)
    const R = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), -sign * SHOULDER.drop)
      .premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -sign * SHOULDER.roll));
    const P = clav.parent.getWorldQuaternion(new THREE.Quaternion());
    const D = P.clone().invert().multiply(R).multiply(P);                 // the same turn, in the clavicle's parent space
    guarded(clav.quaternion, (q) => q.premultiply(D));
    guarded(arm.position, (p) => p.multiplyScalar(SHOULDER.narrow));      // shoulder joint closer to the neck
    if (fore) {
      // slimmer upper arm: scale its two thickness axes, give the forearm the inverse so only the deltoid/biceps change
      const len = fore.position.clone().set(Math.abs(fore.position.x), Math.abs(fore.position.y), Math.abs(fore.position.z));
      const ax = len.x >= len.y && len.x >= len.z ? 'x' : len.y >= len.z ? 'y' : 'z';
      const thin = new THREE.Vector3(SHOULDER.slim, SHOULDER.slim, SHOULDER.slim); thin[ax] = 1;
      const fat = new THREE.Vector3(1 / SHOULDER.slim, 1 / SHOULDER.slim, 1 / SHOULDER.slim); fat[ax] = 1;
      guarded(arm.scale, (v) => v.multiply(thin));
      guarded(fore.scale, (v) => v.multiply(fat));
    }
  }
  if (!ops.length) return null;
  const apply = () => { for (const op of ops) op(); };
  apply();                                                                  // the bind pose too, before any clip runs
  return apply;
}

/**
 * A ready-to-animate survivor: { root, mixer, play(name, fade, once, speed), update(dt), bones, height, meta }.
 */
export function makeSurvivor(index) {
  const c = castById(index);
  const g = assets.gltf['chars/' + c.id];
  const root = skeletonClone(g.scene);
  prepMaterials(root);
  let meta = {};
  root.traverse((o) => { if (o.userData && o.userData.cast) { try { meta = JSON.parse(o.userData.cast); } catch (_) { /* ignore */ } } });
  const bones = {};
  root.traverse((o) => { if (o.isBone) bones[o.name] = o; });
  const lib = LIB[c.sex];
  const restPelvis = bones.pelvis ? bones.pelvis.position.clone() : new THREE.Vector3();
  const hipRatio = bones.pelvis ? restPelvis.length() / Math.max(1e-3, lib.restPelvis.length()) : 1;
  const clips = {};
  for (const [n, clip] of Object.entries(lib.clips)) clips[n] = adaptClip(clip, lib, restPelvis, hipRatio);

  // ---- springs (built at rest pose, in world space of a temporary identity placement)
  root.updateMatrixWorld(true);
  const W = (b, x = 0, y = 0, z = 0) => b.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(x, y, z)).toArray();
  const springs = [], colliders = [];
  if (bones.backpack) springs.push({ bone: 'backpack', tail: W(bones.backpack, 0, -0.38, 0.02), stiffness: 0.55, drag: 0.32, gravity: 0.4, radius: 0.05, maxAngle: 14, kind: 'tissue' });
  for (const [bn, z] of [['skirt_f', 0.05], ['skirt_b', -0.05]]) {
    if (bones[bn]) springs.push({ bone: bn, tail: W(bones[bn], 0, -0.34, z), stiffness: 0.5, drag: 0.28, gravity: 0.6, radius: 0.04, maxAngle: 40, kind: 'hair' });
  }
  if (bones.skirt_f || bones.skirt_b) {
    for (const s of ['l', 'r']) {
      const th = bones['thigh_' + s], ca = bones['calf_' + s];
      if (th && ca) {
        const a = th.getWorldPosition(new THREE.Vector3()), b = ca.getWorldPosition(new THREE.Vector3());
        colliders.push({ bone: 'thigh_' + s, center: a.clone().lerp(b, 0.35).toArray(), radius: 0.085 });
        colliders.push({ bone: 'thigh_' + s, center: a.clone().lerp(b, 0.7).toArray(), radius: 0.07 });
      }
    }
  }
  const physics = springs.length ? new SpringBones(root, { springs, colliders }) : null;
  const skirtFit = makeSkirtFit(root, bones);

  const shoulders = relaxShoulders(root, bones);

  const mixer = new THREE.AnimationMixer(root);
  const actions = {};
  let current = null, currentName = '';
  const S = {
    id: c.id, name: c.name, sex: c.sex, root, mixer, bones, meta, clips, physics,
    height: meta.height || 1.75,
    get anim() { return currentName; },
    play(name, fade = 0.25, once = false, speed = 1) {
      const clip = clips[name];
      if (!clip) return null;
      let a = actions[name];
      if (!a) { a = mixer.clipAction(clip); actions[name] = a; }
      if (current === a && !once) { a.timeScale = speed; return a; }
      a.reset(); a.setLoop(once ? THREE.LoopOnce : THREE.LoopRepeat, Infinity); a.clampWhenFinished = once;
      a.timeScale = speed; a.enabled = true; a.setEffectiveWeight(1);
      if (current && current !== a) a.crossFadeFrom(current, fade, true);
      a.play(); current = a; currentName = name;
      return a;
    },
    duration(name) { return clips[name] ? clips[name].duration : 0; },
    update(dt) {
      mixer.update(dt);
      if (shoulders) shoulders();
      if (skirtFit) skirtFit();
      if (physics) physics.update(dt);
    },
    resetPhysics() { if (physics) { root.updateMatrixWorld(true); physics.reset(); } },
  };
  return S;
}
