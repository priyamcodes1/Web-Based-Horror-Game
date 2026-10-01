// The escape ending, end to end.
//  1. first person at the main gate: three keys, three padlocks; each chain crashes to the floor, then you put
//     your shoulder to the doors and they swing out into the storm
//  2. third person outside: out under the portico, down the steps, along the gravel drive (something watches from
//     the doorway), shove the iron gate open, run to the car, get in, door shut
//  3. ignition, headlights, and the car pulls away down the road into the fog
// Every surviving player escapes, each in their own ending: on each peer's screen it's just them - their hands
// on the locks, their run, their car. (A dead player watches the first survivor's ending.)
import * as THREE from 'three';
import { audio } from '../audio/audio.js';
import { assets, cloneProp, applyLibrary, libMaterial } from '../core/assets.js';
import { Avatar } from '../entities/avatar.js';
import { planarUV, uvBox } from '../world/doors.js';
import { twoBoneIK } from '../gfx/armIK.js';
import { clamp, damp, dampAngle, fbm, RNG } from '../core/util.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const Y0 = -0.8;                  // ground level outside (the house floor is 0)
const FZ = -22;                   // the iron fence and its gate
const ROAD = { near: -24, far: -31 };
const CAR_Z = -25.75;             // parked on the near lane, nose toward +x, driver's door facing the house
const ease = (x) => { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); };
const easeOut = (x) => { x = clamp(x, 0, 1); return 1 - (1 - x) * (1 - x) * (1 - x); };
const seg = (t, a, b) => ease((t - a) / (b - a));
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const merge = (list) => mergeGeometries(list.map((g) => (g.index ? g.toNonIndexed() : g)));

// ============================================================================ textures drawn at load
function canvasTex(w, h, draw, srgb = true) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
const glowTexture = () => canvasTex(128, 128, (g) => {
  const r = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(0.12, 'rgba(255,255,255,0.6)');
  r.addColorStop(0.4, 'rgba(255,255,255,0.14)'); r.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = r; g.fillRect(0, 0, 128, 128);
});
const cloudTexture = (rng) => canvasTex(256, 128, (g) => {
  for (let i = 0; i < 70; i++) {
    const x = 40 + rng.next() * 176, y = 40 + rng.next() * 50, r = 14 + rng.next() * 34;
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, 'rgba(255,255,255,0.11)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 256, 128);
  }
});
const grassTexture = (rng) => canvasTex(128, 128, (g) => {
  for (let i = 0; i < 34; i++) {
    const x = 6 + rng.next() * 116, h = 50 + rng.next() * 74, lean = (rng.next() - 0.5) * 34, w = 2 + rng.next() * 3;
    const c = rng.next();
    g.fillStyle = c < 0.5 ? `rgb(${70 + c * 40},${82 + c * 30},${44})` : `rgb(${96 + c * 30},${88 + c * 20},${52})`;
    g.beginPath(); g.moveTo(x - w, 128); g.quadraticCurveTo(x + lean * 0.3, 128 - h * 0.6, x + lean, 128 - h); g.quadraticCurveTo(x + lean * 0.3 + w * 0.5, 128 - h * 0.6, x + w, 128); g.fill();
  }
});
const leafTexture = () => canvasTex(64, 64, (g) => {
  g.fillStyle = '#fff'; g.beginPath(); g.moveTo(32, 2); g.quadraticCurveTo(62, 26, 32, 62); g.quadraticCurveTo(2, 26, 32, 2); g.fill();
  g.strokeStyle = 'rgba(0,0,0,0.35)'; g.lineWidth = 2; g.beginPath(); g.moveTo(32, 4); g.lineTo(32, 60); g.stroke();
});

/** Material from a loaded texture set, mapped by the geometry's own (world-scaled) UVs. */
function texMat(set, { color = 0xffffff, rough = 1, normal = 1, vertexColors = false, env = 0 } = {}) {
  const s = assets.sets[set] || {};
  const m = new THREE.MeshStandardMaterial({
    map: s.c || null, normalMap: s.n || null, roughnessMap: s.orm || null, aoMap: s.orm || null, aoMapIntensity: 0.8,
    color, roughness: rough, metalness: 0, normalScale: new THREE.Vector2(normal, normal), vertexColors,
  });
  if (env && assets.envMap) { m.envMap = assets.envMap; m.envMapIntensity = env; }
  return m;
}

// ============================================================================ the set (built at load)
export function buildExterior(g) {
  const L = g.level, gx = L.gate.x;
  const sz = L.D / 30;
  const rng = new RNG(0xbeef ^ (g.seed | 0));
  const ext = new THREE.Group(); ext.name = 'exterior';
  g.scene.add(ext);
  const add = (name, x, z, rot = 0, s = 1, y = Y0) => { const o = cloneProp('exterior', name); applyLibrary(o); o.position.set(x, y, z); o.rotation.y = rot; o.scale.setScalar(s); ext.add(o); return o; };

  // ---- the house front
  const mansion = cloneProp('exterior', 'Mansion'); applyLibrary(mansion);
  mansion.rotation.y = Math.PI;                              // modelled facing -Y (= +Z in glTF): turn to face the drive
  mansion.position.set(gx, Y0, 0.02);
  mansion.scale.set(L.W / 40, 1, sz);
  ext.add(mansion);
  const porchZ = -3.4 * sz + 0.02, stepZ = -4.43 * sz + 0.02;
  const groundY = (x, z) => (z > porchZ ? 0 : z > stepZ ? ((z - porchZ) / (stepZ - porchZ)) * Y0 : Y0);
  const carX = gx + 3.2;
  // rolling ground, flattened under the drive, along the fence, under the road and in front of the house
  const zRoad = (ROAD.near + ROAD.far) / 2;
  const flatAt = (x, z) => (z < -3 && z > FZ - 2.5 ? clamp((Math.abs(x - gx) - 2) / 3, 0, 1) : 1) * clamp((Math.abs(z - zRoad) - 5.2) / 3, 0, 1)
    * clamp((Math.abs(z - FZ) - 0.8) / 2.5, 0, 1) * clamp((-z - 6) / 4, 0, 1) * clamp((Math.hypot(x - gx - 11, z + 13) - 3) / 2, 0, 1);
  const hgt = (x, z) => Y0 - 0.06 + flatAt(x, z) * ((fbm(x * 0.08, z * 0.08, 3, 7) - 0.5) * 0.7 + fbm(x * 0.6, z * 0.6, 2, 3) * 0.05);
  // where the cameras stand: nothing big grows there
  const camSpots = [[gx + 2.3, -6.3], [gx - 1.5, FZ - 3.6], [carX + 3.7, CAR_Z + 3.6], [carX + 5.6, CAR_Z + 3.3], [carX - 5.5, ROAD.far - 3.2]];
  const clearOfCams = (x, z, r) => camSpots.every(([cx2, cz2]) => Math.hypot(x - cx2, z - cz2) > r);
  const keep = (x, z, pad = 0) =>                                        // clear of the drive, road, porch, fountain
    Math.abs(x - gx) < 2.2 + pad && z < -3 && z > ROAD.near - 0.5 ? false
      : z < ROAD.near + 0.6 + pad && z > ROAD.far - 0.6 - pad ? false
        : z > -5.5 - pad && Math.abs(x - gx) < 4.5 + pad ? false
          : Math.hypot(x - (gx + 11), z + 13) < 3.2 + pad ? false
            : z < 0.4;

  // ---- ground: gently rolling, mud with mossy patches (vertex colour), flattened under the drive and the road
  {
    const geo = new THREE.PlaneGeometry(240, 150, 120, 75);
    geo.rotateX(-Math.PI / 2); geo.translate(gx, 0, -40);
    const p = geo.attributes.position, col = new Float32Array(p.count * 3);
    const mud = new THREE.Color(0x6b5d4c), moss = new THREE.Color(0x3c4a2c), dark = new THREE.Color(0x2c2a24), c = new THREE.Color();
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), z = p.getZ(i);
      p.setY(i, hgt(x, z));
      const m = fbm(x * 0.15 + 9, z * 0.15, 3, 11);
      c.copy(mud).lerp(moss, clamp((m - 0.35) * 2.2, 0, 1)).lerp(dark, clamp((fbm(x * 0.4, z * 0.4, 2, 5) - 0.55) * 2, 0, 0.6));
      col.set([c.r, c.g, c.b], i * 3);
    }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.computeVertexNormals();
    planarUV(geo, 1 / 2.5);
    const ground = new THREE.Mesh(geo, texMat('ground_mud', { vertexColors: true, rough: 1 }));
    ground.receiveShadow = true;
    ext.add(ground);
  }
  // ---- gravel drive with stone edging, from the steps through the gate to the road
  {
    const z0 = stepZ - 0.05, z1 = ROAD.near - 0.1, len = z0 - z1, zc = (z0 + z1) / 2;
    const path = new THREE.Mesh(planarUV(new THREE.PlaneGeometry(3.0, len).rotateX(-Math.PI / 2).translate(gx, Y0 + 0.02, zc), 1 / 1.6), texMat('gravel', { color: 0x9a9690 }));
    path.receiveShadow = true; ext.add(path);
    const edge = new THREE.Mesh(merge([uvBox(0.16, 0.1, len, gx - 1.58, Y0 + 0.03, zc, 1.5), uvBox(0.16, 0.1, len, gx + 1.58, Y0 + 0.03, zc, 1.5)]), texMat('stone_floor', { color: 0x8a8580 }));
    edge.receiveShadow = true; edge.castShadow = true; ext.add(edge);
  }
  // ---- the road: wet asphalt, worn markings, kerbs (a gap where the drive meets it)
  {
    const zc = (ROAD.near + ROAD.far) / 2, w = ROAD.near - ROAD.far;
    const road = new THREE.Mesh(planarUV(new THREE.PlaneGeometry(300, w).rotateX(-Math.PI / 2).translate(gx, Y0 + 0.02, zc), 1 / 4), texMat('asphalt', { color: 0x6c6c6c, rough: 0.62, normal: 0.7, env: 0.35 }));
    road.receiveShadow = true; ext.add(road);
    const dashes = [], lines = [];
    for (let x = -150; x < 150; x += 6) dashes.push(uvBox(3, 0.004, 0.13, gx + x, Y0 + 0.024, zc, 1));
    lines.push(uvBox(300, 0.004, 0.1, gx, Y0 + 0.024, ROAD.near - 0.35, 1), uvBox(300, 0.004, 0.1, gx, Y0 + 0.024, ROAD.far + 0.35, 1));
    ext.add(new THREE.Mesh(merge(dashes), new THREE.MeshStandardMaterial({ color: 0x9c8644, roughness: 0.7 })));
    ext.add(new THREE.Mesh(merge(lines), new THREE.MeshStandardMaterial({ color: 0x7d7d78, roughness: 0.7 })));
    const kerb = (x0, x1, z) => uvBox(x1 - x0, 0.15, 0.22, gx + (x0 + x1) / 2, Y0 + 0.06, z, 1.5);
    const kerbs = new THREE.Mesh(merge([kerb(-150, -1.7, ROAD.near + 0.11), kerb(1.7, 150, ROAD.near + 0.11), kerb(-150, 150, ROAD.far - 0.11)]), texMat('concrete', { color: 0x8c8a86 }));
    kerbs.receiveShadow = true; ext.add(kerbs);
  }
  // ---- puddles: black mirrors that catch the lamps
  {
    const pm = new THREE.MeshStandardMaterial({ color: 0x07090c, roughness: 0.14, metalness: 0.1, envMap: assets.envMap || null, envMapIntensity: 0.6 });
    const spots = [[gx - 0.6, -9.5, 0.9, 0.5], [gx + 0.7, -15, 0.7, 0.4], [gx - 0.3, -20.3, 1.0, 0.45], [carX - 6, -27.2, 1.6, 0.7], [carX + 7, -28.6, 1.3, 0.6],
      [gx - 16, -26.4, 1.8, 0.6], [gx + 22, -29.3, 1.2, 0.5], [carX - 1, -29.6, 1.1, 0.5], [gx - 7, -12, 1.2, 0.8], [gx + 6, -18, 1.4, 0.7]];
    const geos = spots.map(([x, z, a, b]) => { const c = new THREE.CircleGeometry(1, 20).rotateX(-Math.PI / 2); c.scale(a, 1, b); c.rotateY(rng.range(0, 3)); c.translate(x, (z < ROAD.near && z > ROAD.far ? Y0 + 0.026 : Math.abs(x - gx) < 1.5 ? Y0 + 0.026 : Y0 + 0.03), z); return c; });
    ext.add(new THREE.Mesh(merge(geos), pm));
  }
  // ---- fence: sections either side of two stone pillars, the iron gate between them
  for (let k = 0; k < 18; k++) for (const s of [-1, 1]) add('FenceSection', gx + s * (4.25 + k * 2.5), FZ, 0, 1, hgt(gx + s * (4.25 + k * 2.5), FZ) - 0.02);
  add('GatePillar', gx - 2.6, FZ); add('GatePillar', gx + 2.6, FZ);
  const leafL = add('IronGateLeaf', gx - 2.2, FZ, 0); const leafR = add('IronGateLeaf', gx + 2.2, FZ, Math.PI);
  // ---- lamps: along the drive, and along the far side of the road
  const lampPos = [];
  for (const z of [-7.5, -13.5, -19.5]) for (const s of [-1, 1]) { add('LampPost', gx + s * 2.45, z, 0); lampPos.push(V(gx + s * 2.45, Y0 + 3.4, z)); }
  for (let k = -5; k <= 5; k++) { add('LampPost', gx + 4 + k * 22, ROAD.far - 0.7, 0); lampPos.push(V(gx + 4 + k * 22, Y0 + 3.4, ROAD.far - 0.7)); }
  const glowTex = glowTexture();
  const glow = (pos, color, size, opacity = 1) => {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color, transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending, fog: true }));
    s.position.copy(pos); s.scale.setScalar(size); s.renderOrder = 3; ext.add(s); return s;
  };
  for (const p of lampPos) glow(p, 0xffb36a, 2.2, 0.7);
  // porch lanterns either side of the doors
  for (const s of [-1, 1]) {
    const lp = V(gx + s * 1.9, 2.3, -0.14);
    const box = new THREE.Mesh(merge([uvBox(0.2, 0.32, 0.2, lp.x, lp.y, lp.z - 0.05, 4), uvBox(0.04, 0.12, 0.14, lp.x, lp.y + 0.2, lp.z + 0.02, 4)]), libMaterial('M_iron'));
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.06, 10, 8), libMaterial('M_bulb')); bulb.position.copy(lp).setZ(lp.z - 0.05);
    ext.add(box, bulb);
    glow(bulb.position, 0xffb070, 1.3, 0.8);
  }
  // ---- trees, graves, the fountain, bushes, rocks
  const trees = [];
  for (let i = 0; i < 70; i++) {
    let x, z, tries = 0;
    do {
      const band = rng.next();
      if (band < 0.55) { x = gx + (rng.chance(0.5) ? -1 : 1) * rng.range(6, 42); z = rng.range(-21, -5); }
      else if (band < 0.85) { x = gx + rng.range(-70, 70); z = rng.range(ROAD.far - 18, ROAD.far - 2.5); }
      else { x = gx + (rng.chance(0.5) ? -1 : 1) * rng.range(8, 60); z = rng.range(ROAD.near + 1.2, FZ - 0.8) - 0.4; }
    } while ((!keep(x, z, 0.8) || !clearOfCams(x, z, 4)) && ++tries < 20);
    if (tries >= 20) continue;
    trees.push(add('DeadTree' + (i % 3), x, z, rng.range(0, 6.3), rng.range(0.75, 1.35), hgt(x, z) - 0.05));
  }
  for (let i = 0; i < 12; i++) { const x = gx - 11 - rng.next() * 9, z = -9 - rng.next() * 9; add('Gravestone' + (i % 3), x, z, rng.range(-0.3, 0.3), 1, hgt(x, z) - 0.03); }
  add('Fountain', gx + 11, -13, 0, 1, hgt(gx + 11, -13));
  const bushGeo = (() => {
    const b = new THREE.IcosahedronGeometry(0.7, 2); const p = b.attributes.position;
    for (let i = 0; i < p.count; i++) { const v = V(p.getX(i), p.getY(i), p.getZ(i)); v.multiplyScalar(0.75 + fbm(v.x * 3 + 5, v.z * 3 + v.y * 2, 2, 4) * 0.55); p.setXYZ(i, v.x, Math.max(v.y, -0.15), v.z); }
    b.computeVertexNormals(); return b;
  })();
  const scatter = (geo, mat, n, place, opts = {}) => {
    const m = new THREE.InstancedMesh(geo, mat, n);
    const M = new THREE.Matrix4(), q = new THREE.Quaternion(), s = V(1, 1, 1), p = V(0, 0, 0), c = new THREE.Color();
    let k = 0;
    for (let i = 0; i < n * 4 && k < n; i++) {
      const r = place(p, q, s, c);
      if (!r) continue;
      m.setMatrixAt(k, M.compose(p, q, s));
      if (opts.colors) m.setColorAt(k, c);
      k++;
    }
    m.count = k;
    m.castShadow = !!opts.cast; m.receiveShadow = true;
    m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true;
    m.computeBoundingSphere();
    ext.add(m);
    return m;
  };
  const up = V(0, 1, 0);
  const yawQ = (q, a) => q.setFromAxisAngle(up, a);
  // bushes: along the fence, against the house front, round the fountain
  scatter(bushGeo, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1 }), 90, (p, q, s, c) => {
    const r = rng.next();
    if (r < 0.45) p.set(gx + (rng.chance(0.5) ? -1 : 1) * rng.range(3.4, 40), Y0, FZ + rng.range(0.6, 1.4));
    else if (r < 0.75) p.set(gx + (rng.chance(0.5) ? -1 : 1) * rng.range(4.6, 19), Y0, rng.range(-1.6, -0.7));
    else p.set(gx + (rng.chance(0.5) ? -1 : 1) * rng.range(3.4, 40), Y0, ROAD.far - rng.range(1.5, 6));
    if (!clearOfCams(p.x, p.z, 3)) return false;
    p.y = hgt(p.x, p.z);
    yawQ(q, rng.range(0, 6.3)); const k = rng.range(0.6, 1.4); s.set(k * rng.range(0.9, 1.5), k * rng.range(0.6, 1.0), k);
    c.setHSL(rng.range(0.16, 0.26), rng.range(0.18, 0.3), rng.range(0.07, 0.12));
    return true;
  }, { colors: true, cast: true });
  // rocks along the drive edges and the verges
  scatter(new THREE.DodecahedronGeometry(1, 0), texMat('stone_floor', { color: 0x777570 }), 160, (p, q, s) => {
    const r = rng.next();
    if (r < 0.4) p.set(gx + (rng.chance(0.5) ? -1 : 1) * rng.range(1.75, 2.4), Y0, rng.range(-20.5, -5));
    else p.set(gx + rng.range(-40, 40), Y0, rng.range(-21, -4));
    if (r >= 0.4 && !keep(p.x, p.z)) return false;
    p.y = hgt(p.x, p.z) + 0.01;
    q.setFromEuler(new THREE.Euler(rng.range(0, 3), rng.range(0, 6), rng.range(0, 3)));
    const k = rng.range(0.05, 0.22); s.set(k * rng.range(1, 1.6), k * 0.55, k);
    return true;
  }, { cast: true });
  // grass tufts: three crossed cards, normals pointing up so they shade like the ground
  {
    const parts = [];
    for (let i = 0; i < 3; i++) { const pl = new THREE.PlaneGeometry(0.6, 0.45).translate(0, 0.21, 0).rotateY((i * Math.PI) / 3); parts.push(pl); }
    const tuft = merge(parts);
    const n = tuft.attributes.normal; for (let i = 0; i < n.count; i++) n.setXYZ(i, 0, 1, 0);
    const mat = new THREE.MeshStandardMaterial({ map: grassTexture(rng), alphaTest: 0.5, side: THREE.DoubleSide, roughness: 1, color: 0xffffff });
    scatter(tuft, mat, 4200, (p, q, s, c) => {
      const r = rng.next();
      if (r < 0.7) p.set(gx + rng.range(-45, 45), Y0 - 0.04, rng.range(-23.3, -2));
      else p.set(gx + rng.range(-60, 60), Y0 - 0.04, rng.range(ROAD.far - 14, ROAD.far - 0.4));
      if (!keep(p.x, p.z, -0.6) && !(p.z < ROAD.far)) return false;
      if (Math.abs(p.x - gx) < 1.75 && p.z > ROAD.near) return false;
      if (!clearOfCams(p.x, p.z, 0.8)) return false;
      p.y = hgt(p.x, p.z) - 0.03;
      yawQ(q, rng.range(0, 6.3)); const k = rng.range(0.55, 1.35); s.set(k, k * rng.range(0.7, 1.3), k);
      c.setHSL(rng.range(0.13, 0.22), rng.range(0.2, 0.4), rng.range(0.22, 0.42));
      return true;
    }, { colors: true });
  }
  // fallen leaves everywhere, thicker along the edges of things
  {
    const mat = new THREE.MeshStandardMaterial({ map: leafTexture(), alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.9 });
    scatter(new THREE.PlaneGeometry(0.11, 0.11).rotateX(-Math.PI / 2), mat, 2600, (p, q, s, c) => {
      const r = rng.next();
      if (r < 0.35) p.set(gx + rng.range(-1.5, 1.5), Y0 + 0.03, rng.range(ROAD.near, stepZ - 0.1));
      else if (r < 0.6) p.set(gx + rng.range(-60, 60), Y0 + 0.03, rng.range(ROAD.far + 0.1, ROAD.near - 0.1) + (rng.chance(0.7) ? 0 : 0));
      else { p.set(gx + rng.range(-40, 40), 0, rng.range(-23, -3)); p.y = hgt(p.x, p.z) + 0.012; }
      if (r < 0.6 && r >= 0.35 && rng.chance(0.6)) p.z = rng.chance(0.5) ? ROAD.near - rng.range(0.1, 1.2) : ROAD.far + rng.range(0.1, 1.2);
      q.setFromEuler(new THREE.Euler(rng.range(-0.3, 0.3), rng.range(0, 6.3), rng.range(-0.3, 0.3)));
      const k = rng.range(0.6, 1.4); s.set(k, 1, k * rng.range(0.6, 1));
      c.setHSL(rng.range(0.02, 0.1), rng.range(0.4, 0.7), rng.range(0.1, 0.24));
      return true;
    }, { colors: true });
  }
  // ---- utility poles and sagging wires along the far verge, a warning sign
  {
    const poles = [], wires = [];
    const xs = []; for (let k = -6; k <= 6; k++) xs.push(gx + k * 24 - 7);
    for (const x of xs) {
      const z = ROAD.far - 2.2;
      const c = new THREE.CylinderGeometry(0.11, 0.15, 8.5, 8); c.translate(x, Y0 + 4.25, z); poles.push(planarUV(c, 1));
      poles.push(uvBox(0.12, 0.12, 2.2, x, Y0 + 7.9, z, 1), uvBox(0.1, 0.1, 1.4, x, Y0 + 7.3, z, 1));
    }
    for (let i = 0; i < xs.length - 1; i++) for (const o of [-0.95, 0, 0.95]) {
      const a = V(xs[i], Y0 + 8.0, ROAD.far - 2.2 + o), b = V(xs[i + 1], Y0 + 8.0, ROAD.far - 2.2 + o);
      const pts = []; for (let k = 0; k <= 10; k++) { const t = k / 10; pts.push(new THREE.Vector3().lerpVectors(a, b, t).add(V(0, -Math.sin(Math.PI * t) * 1.1, 0))); }
      wires.push(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 20, 0.012, 4));
    }
    const pm = new THREE.Mesh(merge(poles), texMat('wood_old', { color: 0x6a5c50 })); pm.castShadow = true; ext.add(pm);
    ext.add(new THREE.Mesh(merge(wires.map((w) => { w.deleteAttribute('uv'); return w; })), new THREE.MeshStandardMaterial({ color: 0x050505, roughness: 0.6 })));
    const sx = gx - 13, sz2 = ROAD.far - 0.9;
    const post = new THREE.Mesh(merge([uvBox(0.07, 2.3, 0.07, sx, Y0 + 1.15, sz2, 2)]), libMaterial('M_iron'));
    const plate = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.62, 0.02).rotateZ(Math.PI / 4).translate(sx, Y0 + 2.15, sz2 + 0.05), new THREE.MeshStandardMaterial({ color: 0x8a7420, roughness: 0.55, metalness: 0.2 }));
    post.castShadow = plate.castShadow = true;
    ext.add(post, plate);
  }
  // ---- the car
  const car = add('Car', carX, CAR_Z, Math.PI, 1, Y0 + 0.02);
  const carDoor = car.getObjectByName('Car_Door');
  const carMats = {};
  car.traverse((o) => {
    if (!o.isMesh) return;
    if (o.name === 'Car_Headlights') { o.material = carMats.head = o.material.clone(); carMats.head.emissiveIntensity = 0.05; }
    if (o.name === 'Car_Taillights') { o.material = carMats.tail = o.material.clone(); carMats.tail.emissiveIntensity = 0.25; }
    if (o.name === 'carcabin') { o.material = new THREE.MeshStandardMaterial({ color: 0x0c1014, roughness: 0.08, metalness: 0.4, transparent: true, opacity: 0.62, depthWrite: false, envMap: assets.envMap || null, envMapIntensity: 0.9 }); o.renderOrder = 2; }
  });
  const carLocal = (x, y, z) => car.localToWorld(V(x, y, z));
  // headlights: real spots, a glow on each lens and a soft volumetric beam through the rain
  const heads = [new THREE.SpotLight(0xfff1d6, 0, 45, 0.42, 0.55, 1.4), new THREE.SpotLight(0xfff1d6, 0, 45, 0.42, 0.55, 1.4)];
  for (const h of heads) g.scene.add(h, h.target);
  const beamMat = new THREE.ShaderMaterial({
    uniforms: { uI: { value: 0 } }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    vertexShader: `varying float vA; varying vec3 vN; varying vec3 vV;
      void main(){ vA = uv.y; vec4 mv = modelViewMatrix * vec4(position,1.); vV = -mv.xyz; vN = normalMatrix * normal; gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `uniform float uI; varying float vA; varying vec3 vN; varying vec3 vV;
      void main(){ float edge = pow(abs(dot(normalize(vN), normalize(vV))), 1.6); float a = pow(vA, 2.2) * edge * uI;
        gl_FragColor = vec4(vec3(1.,.95,.84) * a * .5, 1.); }`,
  });
  const beams = [];
  for (const s of [-1, 1]) {
    const b = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 2.6, 16, 20, 1, true).translate(0, -8, 0).rotateZ(-Math.PI / 2), beamMat);
    // cone axis now along -x (narrow end at the origin): the car's nose is -x in its own frame
    b.position.set(-2.38, 0.72, s * 0.62);
    b.rotation.z = 0.045;                                       // aimed a little down at the road
    b.renderOrder = 4; b.frustumCulled = false;
    car.add(b); beams.push(b);
  }
  const headGlows = [-1, 1].map((s) => { const sp = glow(V(0, 0, 0), 0xfff4e0, 1.6, 0); car.attach(sp); sp.position.set(-2.42, 0.72, s * 0.62); return sp; });
  const tailGlows = [-1, 1].map((s) => { const sp = glow(V(0, 0, 0), 0xff2a10, 0.7, 0.15); car.attach(sp); sp.position.set(2.42, 0.78, s * 0.65); return sp; });
  // exhaust
  const cloudTex = cloudTexture(rng);
  const puffs = [];
  for (let i = 0; i < 10; i++) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: cloudTex, color: 0x9a9ea6, transparent: true, opacity: 0, depthWrite: false, fog: true }));
    s.visible = false; ext.add(s); puffs.push({ s, t: 9 });
  }
  // ---- low fog banks drifting over the grounds
  const fogBanks = [];
  for (let i = 0; i < 26; i++) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: cloudTex, color: 0x8d97a6, transparent: true, opacity: rng.range(0.16, 0.3), depthWrite: false, fog: true }));
    s.position.set(gx + rng.range(-45, 45), Y0 + rng.range(0.3, 1.1), rng.range(-40, -5));
    s.scale.set(rng.range(10, 18), rng.range(2.5, 4), 1);
    s.renderOrder = 1;
    ext.add(s); fogBanks.push({ s, v: rng.range(0.2, 0.5) });
  }
  // ---- lights. Exactly as many as before the rework would add: three movable lamp lights (re-aimed per shot),
  // the moon (with shadows on better presets, rendered only while the ending plays), a sky/ground fill
  const lamps = [0, 1, 2].map(() => { const l = new THREE.PointLight(0xffa860, 0, 13, 1.6); g.scene.add(l); return l; });
  const moon = new THREE.DirectionalLight(0x9db0d6, 0);
  moon.position.set(gx - 22, 34, -48); moon.target.position.set(gx, Y0, -14);
  if (g.quality.shadowSize >= 1024) {
    moon.castShadow = true;
    moon.shadow.mapSize.set(2048, 2048);
    const sc = moon.shadow.camera; sc.left = -34; sc.right = 34; sc.top = 30; sc.bottom = -30; sc.near = 5; sc.far = 110;
    moon.shadow.bias = -0.0006; moon.shadow.normalBias = 0.04;
    moon.shadow.autoUpdate = false;                          // costs nothing during play; the ending turns it on
    moon.shadow.needsUpdate = true;                          // ...but render it once now: a never-drawn shadow map is an invalid sampler
  }
  g.scene.add(moon, moon.target);
  const sky = new THREE.HemisphereLight(0x55688c, 0x1a1712, 0);
  g.scene.add(sky);
  const rain = makeRainField(g, gx);
  ext.add(rain);
  // ---- actors: a third-person body for every player
  const actors = [];
  g.roster.slice(0, 8).forEach((p, i) => {
    const a = new Avatar(g, p.profile, p.name);
    a.scripted = true; a.tag.visible = false;
    a.pos.set(gx - 0.6 + i * 0.5, 0, 1.8 + i * 0.6);
    a.id = p.id;
    actors.push(a);
  });
  return { ext, gx, sz, groundY, porchZ, stepZ, carX, leafL, leafR, car, carDoor, carMats, carLocal, heads, beamMat, beams, headGlows, tailGlows,
    puffs, fogBanks, lamps, lampPos, moon, sky, rain, actors, trees };
}

// ============================================================================ rain: thin streaks that stay out of the lens
function makeRainField(g, gx) {
  const n = Math.round(g.quality.rainDrops * 0.45);
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(n * 6);
  const R = 18;
  for (let i = 0; i < n; i++) {
    const x = (Math.random() - 0.5) * 2 * R, y = Math.random() * 16, z = (Math.random() - 0.5) * 2 * R;
    pos.set([x, y, z, x - 0.025, y - 0.24, z + 0.01], i * 6);
  }
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const mat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uFlash: { value: 0 }, uGx: { value: gx }, uLit: { value: 0.5 } },
    transparent: true, depthWrite: false,
    vertexShader: `uniform float uTime, uGx; varying float vA;
      void main(){
        vec3 p = position; p.y = mod(p.y - uTime * 15., 16.) - 7.;
        vec4 w = modelMatrix * vec4(p, 1.);
        vec4 mv = viewMatrix * w;
        float d = -mv.z;
        // fade out close to the lens (no giant streaks) and into the fog; none under the portico or indoors
        float a = smoothstep(1.6, 4.5, d) * (1. - smoothstep(14., 24., d));
        if (w.z > -0.1 || (w.z > -4.0 && abs(w.x - uGx) < 3.9 && w.y < 7.)) a = 0.;
        vA = a * (.35 + .65 * fract(position.x * 13.7 + position.z * 7.1));
        gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `uniform float uFlash, uLit; varying float vA;
      void main(){ if (vA < .002) discard; gl_FragColor = vec4(vec3(.6,.66,.76) * (uLit + uFlash * 1.5), vA * .22); }`,
  });
  const l = new THREE.LineSegments(geo, mat);
  l.frustumCulled = false;
  return l;
}

// ============================================================================ the run: a path, a speed profile, timing
function makeRunner(X, pts, opts) {
  const curve = new THREE.CatmullRomCurve3(pts.map(([x, z]) => V(x, 0, z)), false, 'centripetal', 0.5);
  const len = curve.getLength();
  const sGate = opts.gateZ != null ? (() => { for (let k = 0; k <= 400; k++) { const u = k / 400; if (curve.getPointAt(u).z <= opts.gateZ) return u * len; } return len; })() : Infinity;
  // simulate the speed profile once, at a fixed step, so the timeline (and every peer) is deterministic
  const table = [];
  let s = 0, v = 0, t = 0;
  const vmax = opts.vmax ?? 4.6;
  while (s < len - 0.01 && t < 30) {
    let target = vmax;
    if (s > sGate - 1.6 && s < sGate + 0.5) target = 3.0;
    else if (s >= sGate + 0.5) target = opts.after ?? 3.9;
    target = Math.min(target, Math.sqrt(2 * 3.4 * Math.max(0, len - s)) + 0.05);
    v += clamp(target - v, -6 * (1 / 60), 7 * (1 / 60));
    s = Math.min(len, s + v / 60);
    t += 1 / 60;
    table.push([t, s, v]);
  }
  table.push([t + 1 / 60, len, 0]);
  const at = (time) => {
    if (time <= 0) return { s: 0, v: 0 };
    const i = Math.min(table.length - 1, Math.floor(time * 60));
    return { s: table[i][1], v: table[i][2] };
  };
  const timeAt = (sq) => { for (const [tt, ss] of table) if (ss >= sq) return tt; return t; };
  return { curve, len, sGate, at, dur: t, tGate: timeAt(sGate), timeAt };
}

/** Put an actor on the run at local time `lt` (seconds since it set off). Returns its speed. */
function placeRunner(X, a, R, lt, dt, k = 12) {
  const { s, v } = R.at(lt);
  const u = clamp(s / R.len, 0, 1);
  const p = R.curve.getPointAt(u);
  const tan = R.curve.getTangentAt(Math.min(u + 0.01, 1));
  a.pos.set(p.x, X.groundY(p.x, p.z), p.z);
  if (v > 0.05) a.yaw = dampAngle(a.yaw, Math.atan2(-tan.x, -tan.z), k, dt);
  if (v > 2.5) a.play('Run', 0.22, false, clamp(v / 4.6, 0.72, 1.12));
  else if (v > 0.15) a.play('Walk', 0.25, false, clamp(v / 1.45, 0.7, 1.7));
  else a.play('IdleScared', 0.35);
  return v;
}

// ============================================================================ playback
export async function playEscape(game) {
  const g = game, L = g.level, gate = L.gate;
  const p = g.player, cam = p.camera;
  const X = g.exterior || (g.exterior = buildExterior(g));
  const gx = X.gx, gy = gate.y;
  // ---------------------------------------------------------------- set up
  g.cutscene = true;
  g.hud.prompt(null);
  g.hud.letterbox(true);
  p.locked = true;
  gate.scripted = true;
  if (gate.collider) gate.collider.enabled = false;
  for (const a of g.avatars.values()) { a.scripted = 'escape'; a.root.visible = false; a.torch.visible = false; }
  const aliveIds = new Set(g.allPlayers().filter((q) => q.alive).map((q) => q.id));
  if (!aliveIds.size) aliveIds.add(g.localId);
  const alive = X.actors.filter((a) => aliveIds.has(a.id));
  const lead = alive.find((a) => a.id === g.localId) || alive[0] || X.actors[0];
  X.actors.forEach((a) => { a.root.visible = false; a.torch.visible = false; });
  g.cutsceneActors = [lead];
  const fpMode = p.alive && !!p.fp;
  // far from the doors (another room, upstairs, someone else opened it): a quick fade instead of a glide through walls
  const farStart = fpMode && (Math.abs(p.pos.y - gate.y) > 1 || Math.hypot(p.pos.x - gx, p.pos.z - (gate.z + 0.62)) > 2.5);
  const oldFov = cam.fov;
  // the sets of things the ending owns
  const locks = gate.padlocks || [];
  const order = [1, 2, 0].filter((i) => locks[i]);              // silver (left), iron (right), brass (the loop)
  const stand = V(gx, gy, gate.z + 0.62);
  const keyhole = (pl) => pl.localToWorld(V(0, 0.03, 0.03));
  // the keys: pinched in the fingertips, into the keyhole, turned, and left in the lock as it drops
  const keys = [];
  const keyQ = (turn) => new THREE.Quaternion().setFromEuler(new THREE.Euler(0, Math.PI, turn));   // tip into the lock
  const updateKeys = () => {
    keys.forEach((k, i) => {
      if (!k || k.done) return;
      const la = t - T.lock[i];
      const A = fpMode && p.fp.action?.name === 'unlock' ? p.fp.action : null;
      const turn = A ? A.turn || 0 : 1.4 * seg(la, 0.62, 0.9);
      const ins = seg(la, 0.36, 0.56);
      const hole = keyhole(k.pl).add(V(0, 0, 0.012 + 0.035 * (1 - ins)));
      const q = keyQ(-turn);
      let pos = hole;
      if (fpMode) {
        const pinch = p.fp.pinchWorld(new THREE.Vector3()).add(V(0, 0, 0.026).applyQuaternion(q));
        pos = pinch.lerp(hole, seg(la, 0.3, 0.42));
      } else k.obj.visible = la > 0.45;
      k.obj.position.copy(pos); k.obj.quaternion.copy(q);
      if (la >= 0.92) { k.obj.updateMatrixWorld(); k.pl.attach(k.obj); k.done = true; }
    });
  };

  // ---------------------------------------------------------------- timeline
  const T = {};
  T.lock = order.map((_, i) => 1.4 + i * 1.8);                    // each key goes in at T.lock[i]
  T.crouch = T.lock[order.length - 1] - 0.55;                   // the last lock (the loop) hangs low: kneel for it
  T.rise = T.lock[order.length - 1] + 1.55;
  T.push = T.rise + 0.5;
  T.doors = T.push + 0.35;
  T.out = T.doors + 1.55;                                      // cut to the outside
  // the run: out of the door, down the drive, through the gate, to the driver's door
  const cx = X.carX;
  const leadPath = [[gx, gate.z + 0.1], [gx - 0.1, gate.z - 1.2], [gx - 0.2, X.porchZ + 0.2], [gx - 0.3, X.stepZ - 0.4], [gx - 0.25, -9], [gx - 0.1, -15],
    [gx, FZ + 1.6], [gx + 0.15, FZ - 0.5], [gx + 1.2, FZ - 1.55], [cx - 0.35, CAR_Z + 1.55]];
  const RL = makeRunner(X, leadPath, { gateZ: FZ + 0.3, after: 3.6 });
  const C0 = T.out + RL.dur;                                   // the leader stops at the car door
  T.car = { open: C0 + 0.05, inS: C0 + 0.4, inE: C0 + 1.5, close: C0 + 1.75, start: C0 + 2.5, lights: C0 + 3.1, go: C0 + 4.5 };
  T.shots = [
    { name: 'burst', t0: T.out, t1: T.out + 2.35 },
    { name: 'track', t0: T.out + 2.35, t1: T.out + RL.tGate - 1.1 },
    { name: 'gate', t0: T.out + RL.tGate - 1.1, t1: T.out + RL.tGate + 1.3 },
    { name: 'car', t0: T.out + RL.tGate + 1.3, t1: T.car.start - 0.1 },
    { name: 'ignite', t0: T.car.start - 0.1, t1: T.car.go + 0.15 },
    { name: 'away', t0: T.car.go + 0.15, t1: T.car.go + 9.5 },
  ];
  T.title = T.car.go + 2.6;
  T.fade = T.car.go + 4.9;
  T.end = T.car.go + 6.9;

  // ---------------------------------------------------------------- state
  const oldFog = g.scene.fog, oldBg = g.scene.background;
  const extFog = new THREE.FogExp2(0x1b212b, 0.034);
  let t = 0, outdoor = false, shot = null, shotT = 0;
  const camLook = V(gx, 1.3, 0);
  const fired = new Set();
  const once = (key, fn) => { if (!fired.has(key)) { fired.add(key); fn(); } };
  const ghost = g.ghosts[0] || null;
  let stepT = 0, breathT = 1.5;
  const gateSwing = { a: 0, v: 0, on: false };
  const carState = { x: cx, v: 0, door: 0, lights: 0, shake: 0 };
  const seatLocal = V(-0.15, 0.06, -0.38);
  const handL = new THREE.Vector3(), handR = new THREE.Vector3();
  const lampLightsAt = (pts) => X.lamps.forEach((l, i) => { const q = pts[i]; if (q) { l.position.copy(q).add(V(0, -0.15, 0)); l.intensity = 12; } else l.intensity = 0; });
  const nearestLamps = (c, n = 3) => [...X.lampPos].sort((a, b) => a.distanceToSquared(c) - b.distanceToSquared(c)).slice(0, n);

  // ---------------------------------------------------------------- pieces
  const dropLock = (pl) => {
    const U = pl.userData;
    U.fall = { v: V((Math.random() - 0.5) * 0.4, 0.9, 0.55 + Math.random() * 0.3), w: V(Math.random() * 6 - 3, Math.random() * 4 - 2, Math.random() * 6 - 3), t: 0, bounced: 0 };
    audio.play('unlock', { pos: pl.position.clone(), vol: 1.1, ref: 2 });
    setTimeout(() => {
      U.chainFall = true;
      for (const lk of U.chain.userData.links) { lk.v.set((Math.random() - 0.5) * 0.5, Math.random() * 0.3, 0.15 + Math.random() * 0.55); lk.spin.set(Math.random() * 10 - 5, Math.random() * 10 - 5, Math.random() * 10 - 5); }
      audio.play('chain', { pos: pl.position.clone(), vol: 1.2, ref: 2.5 });
    }, 140);
  };
  const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), one = V(1, 1, 1);
  const updateLocks = (dt) => {
    for (const pl of locks) {
      const U = pl.userData;
      if (U.fall) {
        const F = U.fall; F.t += dt;
        if (U.shackle && F.t < 0.12) U.shackle.position.y = Math.min(0.016, F.t * 0.15);
        if (F.t > 0.1 && !F.rest) {
          F.v.y -= 9.8 * dt;
          pl.position.addScaledVector(F.v, dt);
          pl.rotation.x += F.w.x * dt; pl.rotation.y += F.w.y * dt; pl.rotation.z += F.w.z * dt;
          if (pl.position.y < gy + 0.03) {
            pl.position.y = gy + 0.03;
            if (F.bounced < 2 && Math.abs(F.v.y) > 0.6) { F.v.y *= -0.3; F.v.x *= 0.5; F.v.z *= 0.5; F.w.multiplyScalar(0.5); F.bounced++; if (F.bounced === 1) audio.play('object_fall', { pos: pl.position.clone(), vol: 0.45, ref: 1.5, rate: 1.6 }); }
            else { F.rest = true; pl.rotation.x = Math.PI / 2 * Math.sign(pl.rotation.x || 1); pl.position.y = gy + 0.035; }
          }
        }
      }
      if (U.chainFall && !U.chainRest) {
        const ch = U.chain, links = ch.userData.links;
        let moving = 0;
        links.forEach((lk, i) => {
          if (!lk.down) {
            lk.v.y -= 9.8 * dt;
            lk.p.addScaledVector(lk.v, dt);
            _q.setFromEuler(new THREE.Euler(lk.spin.x * dt, lk.spin.y * dt, lk.spin.z * dt)); lk.q.multiply(_q);
            const floor = gy + 0.012 + (i % 3) * 0.008;
            if (lk.p.y < floor) {
              lk.p.y = floor; lk.down = true;
              // settle lying flat-ish: the link's hole axis turns toward vertical
              const flat = new THREE.Quaternion().setFromUnitVectors(V(0, 0, 1).applyQuaternion(lk.q), V(0, 1, 0));
              lk.q.premultiply(flat);
            } else moving++;
          }
          ch.setMatrixAt(i, _m.compose(lk.p, lk.q, one));
        });
        ch.instanceMatrix.needsUpdate = true;
        ch.computeBoundingSphere();
        if (!moving) U.chainRest = true;
      }
    }
  };
  const setLeaves = (k) => {
    const [a, b] = gate.leaves;
    const th = 1.42 * k;
    if (a) a.obj.rotation.y = th;
    if (b) b.obj.rotation.y = -th * Math.min(1, k * 1.04);
  };
  const footstep = (a, v) => {
    stepT -= (1 / 60) * (v > 2.5 ? v / 4.6 : v / 1.45);
    if (v > 0.3 && stepT <= 0) {
      stepT = v > 2.5 ? 0.33 : 0.52;
      const surf = a.pos.z > X.porchZ ? 'stone' : Math.abs(a.pos.x - gx) < 1.6 || a.pos.z < ROAD.near + 0.2 ? 'gravel' : 'mud';
      audio.play('footstep', { pos: a.pos.clone().setY(a.pos.y + 0.1), surface: surf, intensity: v > 2.5 ? 1.3 : 0.8, ref: 2 });
    }
  };
  const ghostIn = () => {
    if (!ghost) return;
    ghost.stun = 0; ghost.state = 'stare'; ghost.target = null; ghost.speed = 0; ghost.afterVanish = null;
    ghost.setPos(V(gx, gy, gate.z - 1.1), Math.PI);           // out on the porch, under the portico
    ghost.dissolve = 1; ghost.dissolveTarget = 0;
    ghost.play(ghost.P.anims.stare || ghost.P.anims.idle, 0.2);
    ghost.lookTarget = V(gx, 1.5, -10);
  };

  audio.stopLoop('chase'); audio.setLoop('heartbeat', 0);
  if (!audio.loops.heartbeat) audio.startLoop('heartbeat', { vol: 0 });
  audio.setLoop('drone', 0.25);
  X.ext.visible = true;
  if (fpMode) {
    p.cinematic = false; p.cinematicNoFlash = false;
    p.state = 'stand';
    p.fp.cancel?.();
    p.fp.setHeld(null);                                          // both hands free: the keys come out one by one
    if (farStart) {
      g.gfx.fx.uFade.value = 1;
      p.pos.set(gx, gate.y, gate.z + 1.6); p.yaw = 0; p.pitch = 0; p.eye = 1.56; p.vel.set(0, 0, 0);
    }
  } else {
    p.cinematic = true; p.cinematicNoFlash = true;
    p.fp?.update?.(0);
    cam.fov = 50; cam.updateProjectionMatrix();
    lead.root.visible = true; lead.pos.copy(stand); lead.yaw = 0; lead.char.resetPhysics();
  }

  return new Promise((resolve) => {
    const tick = (dt) => {
      dt = Math.min(dt, 1 / 20);
      t += dt;
      updateLocks(dt);
      if (farStart && t < 0.9) g.gfx.fx.uFade.value = 1 - seg(t, 0.15, 0.85);
      // ======================================================== 1. the gate, first person
      if (t < T.out) {
        // each padlock: key in, quarter turn, it springs and drops with its chain
        order.forEach((li, i) => {
          const pl = locks[li], tl = T.lock[i];
          if (t >= tl) once('lock' + i, () => {
            const kind = pl.userData.kind;
            const obj = cloneProp('items', 'Key_' + kind[0].toUpperCase() + kind.slice(1)); applyLibrary(obj, { cast: false });
            obj.scale.setScalar(1.3); obj.visible = fpMode; g.scene.add(obj);
            keys[i] = { obj, pl, done: false };
            audio.play('keys', { pos: keyhole(pl), vol: 0.7, ref: 1.5 });
            if (fpMode) p.fp.act('unlock', { apply: () => dropLock(pl) }, { target: keyhole(pl), force: true });
            else setTimeout(() => dropLock(pl), 900);
          });
        });
        if (t >= T.push) once('push', () => { if (fpMode) { p.fp.setHeld(null); p.fp.act('push', {}, { force: true }); } audio.play('breath_in', { intensity: 1.3 }); });
        if (t >= T.doors) once('doors', () => {
          audio.play('door_creak', { pos: V(gx, 1.5, gate.z), vol: 1.1, ref: 3, rate: 0.8 });
          audio.play('whoosh', { vol: 0.8 });
          audio.play('thunder', { close: true });
          g.flash(1);
          audio.stopLoop('rain');
          audio.startLoop('rain_out', { vol: 0.95, fade: 0.6 });
          audio.setLoop('wind', 0.6);
          g.scene.fog = extFog; g.scene.background = extFog.color;
          outdoor = true;
        });
        setLeaves(t > T.doors ? easeOut((t - T.doors) / 1.5) * (1 + 0.04 * Math.sin(Math.max(0, t - T.doors - 1.2) * 9) * Math.exp(-Math.max(0, t - T.doors - 1.2) * 3)) : 0);
        // which lock we're looking at
        let tgt = V(gx, 1.35, gate.z);
        for (let i = 0; i < order.length; i++) if (t > T.lock[i] - 0.9) tgt = keyhole(locks[order[i]]);
        if (t > T.rise) tgt = V(gx, 1.5, gate.z - 4);
        if (t > T.doors + 0.4) tgt = V(gx, 1.1, -12);
        if (fpMode) {
          // walk up to the doors, kneel for the low lock, stand, lean into the push, take a step out
          const goal = stand.clone();
          // step in front of each lock in turn (left hand on the key, so stand a little to its right)
          if (t > T.lock[0] - 0.9 && t < T.rise) { goal.x = tgt.x + 0.15; goal.z = gate.z + 0.5; }
          if (t > T.push) goal.z -= 0.14 * seg(t, T.push, T.push + 0.4);
          if (t > T.doors + 0.5) goal.z -= 0.45 * seg(t, T.doors + 0.5, T.out);
          const prev = p.pos.clone();
          const k = t < 1.2 ? 1 - Math.exp(-4 * dt) : 1 - Math.exp(-8 * dt);
          p.pos.lerp(goal, k);
          p.vel.copy(p.pos).sub(prev).divideScalar(Math.max(dt, 1e-3));
          const kneel = t > T.crouch && t < T.rise;
          p.state = kneel ? 'crouch' : 'stand';
          p.eye = damp(p.eye, kneel ? 1.0 : 1.56, 5, dt);
          const eye = V(p.pos.x, p.pos.y + p.eye, p.pos.z);
          const d = tgt.clone().sub(eye);
          p.yaw = dampAngle(p.yaw, Math.atan2(-d.x, -d.z), 5, dt);
          p.pitch = damp(p.pitch, clamp(Math.atan2(d.y, Math.hypot(d.x, d.z)), -1.2, 0.6), 5, dt);
          p.bob = 0; p.bobAmt = 0;
          // the torch adapts to the door right in front of it (until the doors are open)
          p.hitDist = t < T.doors + 0.5 ? Math.max(0.3, eye.z - gate.z - 0.05) : 3;
          p.updateCamera(dt);
          updateKeys();
        } else {
          // over the shoulder: the survivor at the doors, reaching for each lock
          lead.play(t > T.crouch && t < T.rise ? 'CrouchIdle' : 'Idle', 0.3);
          if (t > T.doors + 0.3) { lead.play('Walk', 0.3); lead.pos.z -= dt * 0.4; }
          const cp = V(gx + 1.1, 1.75, gate.z + 2.6);
          cam.position.lerp(cp, 1 - Math.exp(-3 * dt));
          look(cam, camLook.lerp(tgt, 1 - Math.exp(-4 * dt)), dt, 6);
          lead.update(dt, cam);
          let reach = null;
          for (let i = 0; i < order.length; i++) { const k0 = T.lock[i] - 0.4; if (t > k0 && t < T.lock[i] + 1.3) reach = { pt: keyhole(locks[order[i]]), w: seg(t, k0, k0 + 0.4) * (1 - seg(t, T.lock[i] + 0.9, T.lock[i] + 1.3)) }; }
          if (reach) armTo(lead, 'l', reach.pt, reach.w);
          updateKeys();
        }
      }
      if (t >= T.out) {
        once('cut', () => {
          // ---- third person from here: hide the first-person body completely, the survivor takes its place
          p.cinematic = true; p.cinematicNoFlash = true;
          p.fp?.update?.(0);
          cam.fov = 52; cam.updateProjectionMatrix();
          lead.root.visible = true;
          lead.pos.set(leadPath[0][0], gy, leadPath[0][1]); lead.yaw = 0; lead.pitch = -0.35;
          lead.torchOn = true;
          lead.char.resetPhysics();
          audio.setLoop('heartbeat', 0.55, 0.9);
        });
        // ======================================================== 2. outside, third person
        const lt = t - T.out;
        // ---- the leader's run, then the car
        if (t < T.car.inS) {
          const v = placeRunner(X, lead, RL, lt, dt);
          footstep(lead, v);
          // shoulder the iron gate open on the way through
          const tg = RL.tGate;
          if (lt > tg - 0.45 && !gateSwing.on) { gateSwing.on = true; gateSwing.v = 4.2; audio.play('door_bang', { pos: V(gx, Y0 + 1.2, FZ), vol: 1, rate: 1.35, ref: 3 }); audio.play('chain', { pos: V(gx, Y0 + 1, FZ), vol: 0.5, ref: 3 }); }
          lead.update(dt, cam);
          const w = seg(lt, tg - 0.6, tg - 0.38) * (1 - seg(lt, tg - 0.05, tg + 0.25));
          if (w > 0.01) {
            armTo(lead, 'l', handL.set(gx - 0.45, Y0 + 1.25, FZ + 0.05), w);
            armTo(lead, 'r', handR.set(gx + 0.45, Y0 + 1.25, FZ + 0.05), w);
          }
        } else if (t < T.car.go + 0.1) {
          // into the driver's seat: turn, duck, slide in
          const k = seg(t, T.car.inS, T.car.inE);
          const from = RL.curve.getPointAt(1);
          const seat = X.carLocal(seatLocal.x, seatLocal.y, seatLocal.z);
          lead.pos.set(from.x + (seat.x - from.x) * k, Y0 + (seat.y - Y0) * seg(t, T.car.inS + 0.2, T.car.inE), from.z + (seat.z - from.z) * k);
          lead.yaw = dampAngle(lead.yaw, k < 0.15 ? 0 : -Math.PI / 2, 7, dt);
          lead.play(k < 0.05 ? 'IdleScared' : k < 0.85 ? 'CrouchWalk' : 'CrouchIdle', 0.3, false, 0.7);
          lead.torchOn = k < 0.5;
          lead.update(dt, cam);
          if (k > 0.3) lead.torch.visible = false;
          if (k < 0.2) armTo(lead, 'l', X.carLocal(-0.05, 0.85, -0.98), seg(t, T.car.open - 0.1, T.car.open + 0.15) * (1 - seg(t, T.car.inS + 0.2, T.car.inS + 0.4)));
        } else {
          // driving: ride along in the seat
          const seat = X.carLocal(seatLocal.x, seatLocal.y, seatLocal.z);
          lead.pos.copy(seat); lead.yaw = -Math.PI / 2; lead.play('CrouchIdle', 0.3);
          lead.update(dt, cam); lead.torch.visible = false;
        }
        // ---- the iron gate: a shove, a swing, a bounce off its stops
        if (gateSwing.on) {
          gateSwing.v += (-(gateSwing.a - 1.5) * 9 - gateSwing.v * 2.2) * dt;
          gateSwing.a = clamp(gateSwing.a + gateSwing.v * dt, 0, 1.75);
          X.leafL.rotation.y = gateSwing.a;
          X.leafR.rotation.y = Math.PI - gateSwing.a * 0.96;
        }
        // ---- car: door, ignition, lights, away
        const C = X.car, CT = T.car;
        if (t > CT.open) once('cdoor', () => audio.play('car_door', { pos: X.carLocal(0, 0.8, -0.9), vol: 0.8, ref: 2 }));
        const doorK = t < CT.close ? easeOut((t - CT.open) / 0.55) : 1 - ease((t - CT.close) / 0.32);
        if (X.carDoor) X.carDoor.rotation.y = 1.12 * clamp(doorK, 0, 1);
        if (t > CT.close + 0.3) once('cslam', () => { audio.play('car_door', { pos: X.carLocal(0, 0.8, -0.9), vol: 1.1, ref: 2 }); audio.setLoop('heartbeat', 0.2, 0.6); });
        if (t > CT.start) once('crank', () => audio.play('car_start', { pos: X.carLocal(-1.8, 0.6, 0), vol: 1.1, ref: 3 }));
        if (t > CT.lights) {
          once('lights', () => { audio.startLoop('car', { vol: 0.7 }); audio.play('lever', { pos: X.carLocal(0, 0.8, 0), vol: 0.3 }); });
          // a stutter, then steady
          const on = t - CT.lights;
          carState.lights = on < 0.08 ? 1 : on < 0.16 ? 0.15 : on < 0.24 ? 1 : 1;
        }
        X.carMats.head.emissiveIntensity = 0.05 + carState.lights * 7;
        X.carMats.tail.emissiveIntensity = 0.25 + carState.lights * (t > CT.go - 0.6 && t < CT.go + 0.4 ? 4 : 2.2);
        X.beamMat.uniforms.uI.value = carState.lights * 0.32;
        X.headGlows.forEach((s) => { s.material.opacity = carState.lights * 0.95; });
        X.tailGlows.forEach((s) => { s.material.opacity = 0.12 + carState.lights * (t > CT.go - 0.6 && t < CT.go + 0.4 ? 0.9 : 0.55); });
        if (t > CT.go) {
          const a = t - CT.go;
          carState.v = Math.min(17, 1.9 * a + 0.6 * a * a);
          carState.x += carState.v * dt;
          if (a < 0.1) once('go', () => audio.play('car_start', { pos: X.carLocal(-1.8, 0.6, 0), vol: 0.5, rate: 1.4, ref: 3 }));
        }
        C.position.x = carState.x;
        // idle shudder while running, a squat as it pulls away
        const run = t > CT.start + 0.4 ? 1 : 0;
        C.position.y = Y0 + 0.02 + run * Math.sin(t * 37) * 0.004;
        C.rotation.z = t > CT.go ? Math.min(0.025, (t - CT.go) * 0.05) * Math.exp(-(t - CT.go) * 0.6) : 0;
        C.updateMatrixWorld(true);
        const hl = X.carLocal(-2.4, 0.72, 0.62), hr = X.carLocal(-2.4, 0.72, -0.62);
        X.heads[0].position.copy(hl); X.heads[1].position.copy(hr);
        X.heads[0].target.position.copy(X.carLocal(-24, -0.9, 0.9)); X.heads[1].target.position.copy(X.carLocal(-24, -0.9, -0.9));
        for (const h of X.heads) { h.intensity = carState.lights * 140; h.target.updateMatrixWorld(); }
        if (run) {
          const dist = cam.position.distanceTo(C.position);
          audio.setLoop('car', clamp(1.1 - dist / 60, 0, 0.8));
          // exhaust puffs from the tailpipe
          for (const pf of X.puffs) {
            pf.t += dt;
            if (pf.t > 1.6 && Math.random() < dt * 6) { pf.t = 0; pf.s.visible = true; pf.s.position.copy(X.carLocal(2.5, 0.3, 0.45)); pf.drift = V(0.4 + Math.random() * 0.3, 0.35, (Math.random() - 0.5) * 0.3); }
            if (pf.s.visible) {
              pf.s.position.addScaledVector(pf.drift, dt);
              const k = pf.t / 1.6; pf.s.scale.setScalar(0.4 + k * 1.8); pf.s.material.opacity = 0.22 * (1 - k);
              if (k >= 1) pf.s.visible = false;
            }
          }
        }
        // ---- something in the doorway
        if (lt > 2.75) once('ghost', () => { ghostIn(); g.faceLight.position.set(gx + 0.3, 2.0, gate.z - 2.3); g.faceLight.color.set(0x9fb2d8); g.faceLight.distance = 5; });
        if (ghost && fired.has('ghost')) {
          ghost.lookTarget?.copy(lead.pos).setY(lead.pos.y + 1.5);
          g.faceLight.intensity = lt < 7 ? 5 * seg(lt, 2.8, 3.4) : 0;
          if (lt > 3.3) once('stinger', () => { audio.play('stinger', { vol: 0.75 }); audio.play('whisper', { pos: V(gx, 1.6, gate.z - 1.1), vol: 1, ref: 4 }); });
          if (lt > 8.5) once('ghostout', () => { ghost.dissolveTarget = 1; ghost.lookTarget = null; });
        }
        breathT -= dt;
        if (breathT <= 0 && t < T.car.close) { breathT = 1.4 + Math.random() * 0.8; audio.play('breath_scared', { pos: lead.pos.clone().setY(lead.pos.y + 1.5), vol: 0.6, ref: 1.5 }); }
        // ---- the camera
        const S = T.shots.find((s) => t >= s.t0 && t < s.t1) || T.shots[T.shots.length - 1];
        const cut = S !== shot;
        if (cut) { shot = S; shotT = 0; }
        shotT += dt;
        const chest = lead.pos.clone().setY(lead.pos.y + 1.25);
        let cp, lk, kpos = 0, klook = 6;
        switch (S.name) {
          case 'burst': {      // low by the steps, the doors behind: the survivor bursts out and past
            cp = V(gx + 2.3, Y0 + 1.15, X.stepZ - 1.9);
            lk = lead.pos.z > X.porchZ + 0.5 && lt < 0.6 ? V(gx, 1.5, gate.z) : chest;
            klook = 5;
            if (cut) lampLightsAt([V(gx - 1.9, 2.3, -0.3), V(gx + 1.9, 2.3, -0.3), ...nearestLamps(V(gx, 0, -8), 1)]);
            break;
          }
          case 'track': {      // ahead of the runner, backing away down the drive: the house - and the doorway - behind
            cp = lead.pos.clone().add(V(0.55, 1.45, -3.3)); cp.y = Y0 + 1.6 + (lead.pos.y - Y0) * 0.4;
            lk = chest.clone().lerp(V(gx, 2.0, gate.z), 0.3);
            kpos = 7; klook = 8;
            if (cut) lampLightsAt([V(gx - 1.9, 2.3, -0.3), ...nearestLamps(V(gx, Y0, -13), 2)]);
            break;
          }
          case 'gate': {       // outside the fence, low: through the bars as the gate bursts open toward us
            cp = V(gx - 1.5, Y0 + 0.8, FZ - 3.6).add(V(shotT * 0.12, 0, 0));
            lk = chest.clone().lerp(V(gx, Y0 + 1.3, FZ), 0.35);
            klook = 4;
            if (cut) { lampLightsAt(nearestLamps(V(gx, Y0, FZ - 1), 3)); g.flash(0.6); setTimeout(() => audio.play('thunder', { vol: 0.8 }), 600); }
            break;
          }
          case 'car': {        // three-quarter on the driver's side: arrive, door, in, door shut
            cp = V(cx + 3.7, Y0 + 1.4, CAR_Z + 3.6);
            lk = (t < T.car.inS ? chest : X.carLocal(0, 0.9, -0.6)).clone().lerp(X.carLocal(0, 0.8, -0.9), 0.4);
            klook = 3.5;
            if (cut) lampLightsAt([...nearestLamps(V(cx, Y0, CAR_Z), 2), V(cx + 0.5, Y0 + 3.2, ROAD.near + 0.5)]);
            break;
          }
          case 'ignite': {     // low in front of the grille: the lights come on in our face
            cp = V(cx + 5.6, Y0 + 0.7, CAR_Z + 3.3).add(V(-shotT * 0.12, 0, 0));
            lk = X.carLocal(-1.0, 0.85, -0.2);
            klook = 6;
            break;
          }
          default: {           // wide, from behind on the far verge: tail lights shrinking into the fog
            cp = V(cx - 5.5, Y0 + 2.1, ROAD.far - 3.2);
            lk = C.position.clone().add(V(0, 0.9, 1.4)).lerp(V(cx + 30, Y0 + 1.5, CAR_Z + 4), clamp((t - S.t0) / 6, 0, 0.65));
            klook = 1.6;
            if (cut) lampLightsAt(nearestLamps(V(cx + 8, Y0, ROAD.far), 3));
            if (t - S.t0 > 2.2) once('thunder2', () => { g.flash(0.9); audio.play('thunder', { close: true, vol: 0.9 }); });
          }
        }
        // handheld breath on every shot
        const hh = V(Math.sin(t * 1.3) * 0.02 + Math.sin(t * 3.1) * 0.006, Math.sin(t * 1.7) * 0.015, 0);
        if (cut) { cam.position.copy(cp).add(hh); camLook.copy(lk); cam.lookAt(camLook); }
        else {
          if (kpos) cam.position.lerp(cp.add(hh), 1 - Math.exp(-kpos * dt)); else cam.position.copy(cp.add(hh));
          camLook.lerp(lk, 1 - Math.exp(-klook * dt));
          cam.lookAt(camLook);
        }
        if (t >= T.title) once('title', () => g.hud.notify('YOU ESCAPED', 6));
        if (t >= T.fade) g.gfx.fx.uFade.value = seg(t, T.fade, T.end - 0.3);
      }
      // ======================================================== every frame
      // the world outside: rain round the camera, lightning lights the grounds, fog drifts
      X.rain.position.copy(cam.position);
      X.rain.material.uniforms.uTime.value += dt;
      X.rain.material.uniforms.uFlash.value = g.flashT;
      X.rain.visible = outdoor;
      X.moon.intensity = outdoor ? 0.9 + g.flashT * 6 : 0;
      X.sky.intensity = outdoor ? 0.75 + g.flashT * 2 : 0;
      if (X.moon.castShadow) X.moon.shadow.autoUpdate = outdoor;
      for (const fb of X.fogBanks) { fb.s.position.x += fb.v * dt; if (fb.s.position.x > gx + 50) fb.s.position.x -= 100; }
      if (outdoor && Math.random() < dt * 0.06) { g.flash(0.7); setTimeout(() => audio.play('thunder', { vol: 0.7 }), 400 + Math.random() * 1200); }
      if (t >= T.end) {
        g.offTick(tick);
        audio.stopLoop('car'); audio.stopLoop('heartbeat');
        g.scene.fog = oldFog; g.scene.background = oldBg;
        cam.fov = oldFov; cam.updateProjectionMatrix();
        resolve();
      }
    };
    g.onTick(tick);
  });
}

/** Blend an actor's arm toward a world point (after its clip has posed the body). */
function armTo(a, s, target, w) {
  const B = a.char.bones;
  const up = B['upperarm_' + s], lo = B['lowerarm_' + s], hand = B['hand_' + s];
  if (!up || !lo || !hand || w <= 0.001) return;
  a.root.updateMatrixWorld(true);
  const cur = hand.getWorldPosition(new THREE.Vector3());
  const T = cur.clone().lerp(target, clamp(w, 0, 1));
  const side = s === 'l' ? -1 : 1;
  const right = V(Math.cos(a.yaw), 0, -Math.sin(a.yaw));
  const pole = up.getWorldPosition(new THREE.Vector3()).addScaledVector(right, side * 0.4).add(V(0, -0.35, 0));
  twoBoneIK(up, lo, hand, T, pole);
  a.root.updateMatrixWorld(true);
  a.updateTorch();
}

function look(cam, target, dt, k) {
  const m = new THREE.Matrix4().lookAt(cam.position, target, V(0, 1, 0));
  const q = new THREE.Quaternion().setFromRotationMatrix(m);
  cam.quaternion.slerp(q, 1 - Math.exp(-k * dt));
}
