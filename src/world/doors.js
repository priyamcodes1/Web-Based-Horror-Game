// Door visuals + state: hinged leaves (push open away from the opener), double doors, arches,
// barricaded vents, and the padlocked main gate.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { cloneProp, applyLibrary, libMaterial } from '../core/assets.js';
import { C, WT, DOOR_H_MODEL } from './level.js';

/** The leaf model's back handle mesh (dlhw001) has its plate on the free edge but its knob mirrored onto the
 *  hinge side and sunk into the wood, so from behind it floated past the door over the wall. Mirror the knob's
 *  vertices back across the leaf (x and z: a rotation, so winding stays valid) so it stands proud of the back plate. */
const fixedHW = new WeakMap();
function fixHardware(leaf) {
  leaf.traverse((o) => {
    if (!o.isMesh || o.name !== 'dlhw001') return;
    let geo = fixedHW.get(o.geometry);
    if (!geo) {
      geo = o.geometry.clone();
      const p = geo.attributes.position, n = geo.attributes.normal;
      let plateZ = 0, knobZ = Infinity;
      for (let i = 0; i < p.count; i++) {
        if (p.getX(i) < 0) knobZ = Math.min(knobZ, p.getZ(i));
        else plateZ = Math.max(plateZ === 0 ? -Infinity : plateZ, p.getZ(i));
      }
      for (let i = 0; i < p.count; i++) {
        if (p.getX(i) >= 0) continue;
        p.setXYZ(i, -p.getX(i), p.getY(i), plateZ - (p.getZ(i) - knobZ));
        if (n) n.setXYZ(i, -n.getX(i), n.getY(i), -n.getZ(i));
      }
      p.needsUpdate = true; if (n) n.needsUpdate = true;
      geo.computeBoundingBox(); geo.computeBoundingSphere();
      fixedHW.set(o.geometry, geo);
    }
    o.geometry = geo;
  });
}

export class Doors {
  constructor(level, scene) {
    this.level = level;
    this.group = new THREE.Group(); this.group.name = 'doors';
    scene.add(this.group);
    for (const d of level.doors) this.build(d);
  }

  build(d) {
    const L = this.level;
    const y = d.y;
    const along0 = d.j0 * C, along1 = d.j1 * C, line = d.k * C;
    const H = d.orient === 'h';
    const sy = d.height / (DOOR_H_MODEL[d.kind] || d.height);
    const mk = (x, z, rot, scale, name) => {
      const o = cloneProp('furniture', name);
      applyLibrary(o);
      if (name === 'DoorLeaf') fixHardware(o);
      o.position.set(x, y, z); o.rotation.y = rot; o.scale.set(scale, name === 'DoorLeaf' || name === 'GateDoor' ? sy : 1, 1);
      this.group.add(o);
      return o;
    };
    if (d.kind === 'door') {
      const s = d.width / 0.95;
      const leaf = H ? mk(along0, line, 0, s, 'DoorLeaf') : mk(line, along0, -Math.PI / 2, s, 'DoorLeaf');
      d.leaves.push({ obj: leaf, base: leaf.rotation.y, dir: 1 });
    } else if (d.kind === 'double') {
      const s = d.width / 2 / 0.95;
      const a = H ? mk(along0, line, 0, s, 'DoorLeaf') : mk(line, along0, -Math.PI / 2, s, 'DoorLeaf');
      const b = H ? mk(along1, line, Math.PI, s, 'DoorLeaf') : mk(line, along1, Math.PI / 2, s, 'DoorLeaf');
      d.leaves.push({ obj: a, base: a.rotation.y, dir: 1 }, { obj: b, base: b.rotation.y, dir: -1 });
    } else if (d.kind === 'vent') {
      const cx = (along0 + along1) / 2;
      // grate + boards on the "a" room side (lower coordinate) facing into that room
      const off = WT + 0.03;
      const rot = H ? Math.PI : Math.PI / 2 * -1 + Math.PI;
      const gx = H ? cx : line - off, gz = H ? line - off : cx;
      d.grate = mk(gx, gz, H ? Math.PI : -Math.PI / 2, 1, 'VentGrate');
      d.boards = mk(H ? cx : line - off - 0.02, H ? line - off - 0.02 : cx, H ? Math.PI : -Math.PI / 2, 1, 'VentBoards');
      void rot;
      // duct lining so you don't see into the wall void
      const duct = new THREE.Mesh(new THREE.BoxGeometry(H ? 0.9 : 0.24, 0.9, H ? 0.24 : 0.9),
        new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.9, side: THREE.BackSide }));
      duct.position.set(H ? cx : line, y + 0.45, H ? line : cx);
      this.group.add(duct);
    } else if (d.kind === 'gate') {
      buildGate(d, this.group);
    }
    // collider for closed leaves / boarded vents
    if (d.kind !== 'arch') {
      const t = 0.07;
      const box = H
        ? { x0: along0, z0: line - t, x1: along1, z1: line + t, y0: y, y1: y + d.height, door: d }
        : { x0: line - t, z0: along0, x1: line + t, z1: along1, y0: y, y1: y + d.height, door: d };
      d.collider = L.addCollider(box);
      d.collider.enabled = !d.open;
    }
    d.center = new THREE.Vector3(d.x, y + Math.min(1.2, d.height * 0.5), d.z);
  }

  /** Toggle a door. `from` = position of whoever opened it (door swings away). Returns new open state. */
  setOpen(d, open, from = null, slam = false) {
    if (d.kind === 'arch' || d.kind === 'vent') return d.open;
    d.open = open;
    if (open && from) {
      const side = d.orient === 'h' ? Math.sign(from.z - d.z) : Math.sign(from.x - d.x);
      d.hinge = side === 0 ? 1 : -side;
    }
    d.target = open ? 1 : 0;
    d.slam = slam;
    if (d.collider) d.collider.enabled = !open;
    return open;
  }

  breakVent(d) {
    d.barricaded = false;
    d.open = true;
    if (d.boards) { d.boards.visible = false; }
    if (d.grate) { d.grate.visible = false; }
    if (d.collider) d.collider.enabled = false;
  }

  update(dt) {
    for (const d of this.level.doors) {
      if (!d.leaves.length || d.scripted) continue;
      const speed = d.slam ? 14 : 3.2;
      d.angle += (d.target - d.angle) * Math.min(1, dt * speed);
      if (Math.abs(d.target - d.angle) < 0.001) d.angle = d.target;
      for (const lf of d.leaves) {
        const sweep = d.kind === 'gate' ? 1.45 : 1.75;
        const sign = d.orient === 'h' ? 1 : -1;
        lf.obj.rotation.y = lf.base + d.angle * sweep * lf.dir * d.hinge * sign * (d.kind === 'gate' ? -1 : 1);
      }
    }
  }
}

// ------------------------------------------------------------------ the main gate
// A grand panelled double door (panels on both faces), long iron pull bars on the inside, and three heavy chains
// wrapped round both bars, each closed by its own padlock (brass / silver / iron - one per key). The leaves open
// outward. The escape cutscene drives all of it (d.scripted), see game/escape.js.

/** Planar UVs from object-space position (picked by face normal) so tiling textures keep a real-world scale. */
export function planarUV(geo, s = 1, vertGrain = false) {
  const p = geo.attributes.position, n = geo.attributes.normal;
  const uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) {
    const ax = Math.abs(n.getX(i)), ay = Math.abs(n.getY(i)), az = Math.abs(n.getZ(i));
    let u, v;
    if (ax >= ay && ax >= az) { u = p.getZ(i); v = p.getY(i); } else if (ay >= az) { u = p.getX(i); v = p.getZ(i); } else if (vertGrain) { u = p.getY(i); v = p.getX(i); } else { u = p.getX(i); v = p.getY(i); }
    uv[i * 2] = u * s; uv[i * 2 + 1] = v * s;
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return geo;
}

/** Box with world-scaled UVs, centred at (x, y, z). */
export function uvBox(w, h, d, x, y, z, s = 1) {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(x, y, z);
  return planarUV(g, s, h > w * 1.5);
}

const merge = (list) => mergeGeometries(list.map((g) => (g.index ? g.toNonIndexed() : g)));

const LINK = { R: 0.024, r: 0.0068, stretch: 1.5 };
LINK.pitch = 2 * LINK.R * LINK.stretch - 2 * LINK.r - 0.004;

/** A chain of interlocking links along a smooth path (InstancedMesh). Per-link rest transforms are kept for the drop. */
export function makeChain(points, mat) {
  const curve = new THREE.CatmullRomCurve3(points, false, 'centripetal');
  const n = Math.max(2, Math.round(curve.getLength() / LINK.pitch));
  const geo = new THREE.TorusGeometry(LINK.R, LINK.r, 6, 14);
  geo.scale(1, LINK.stretch, 1);
  const mesh = new THREE.InstancedMesh(geo, mat, n);
  mesh.castShadow = true; mesh.receiveShadow = true;
  const links = [];
  const m = new THREE.Matrix4(), T = new THREE.Vector3(), N = new THREE.Vector3(), B = new THREE.Vector3(), q = new THREE.Quaternion();
  const ref = new THREE.Vector3(0, 0, 1), one = new THREE.Vector3(1, 1, 1);
  for (let i = 0; i < n; i++) {
    const u = i / (n - 1);
    const p = curve.getPointAt(u);
    curve.getTangentAt(u, T).normalize();
    N.copy(ref).addScaledVector(T, -ref.dot(T));
    if (N.lengthSq() < 1e-6) N.set(1, 0, 0).addScaledVector(T, -T.x);
    N.normalize();
    B.crossVectors(T, N);
    // ring plane = (T, side); every other link turned 90 degrees about the chain
    const side = i % 2 ? N : B;
    const hole = new THREE.Vector3().crossVectors(side, T);
    m.makeBasis(side, T, hole);
    q.setFromRotationMatrix(m);
    links.push({ p: p.clone(), q: q.clone(), v: new THREE.Vector3(), spin: new THREE.Vector3(), down: false });
    mesh.setMatrixAt(i, m.compose(p, q, one));
  }
  mesh.instanceMatrix.needsUpdate = true;
  mesh.computeBoundingSphere();
  mesh.userData.links = links;
  return mesh;
}

function buildGate(d, group) {
  const y = d.y, x0 = d.j0 * C, x1 = d.j1 * C, line = d.k * C, cx = (x0 + x1) / 2;
  const wood = libMaterial('M_wood_dark'), iron = libMaterial('M_iron');
  const lw = (x1 - x0) / 2 - 0.006, lh = d.height - 0.04, T = 0.09;
  const bx = lw - 0.3;                                          // pull bar, from the hinge
  // ---- leaves (pivot at the hinge): stiles and rails proud of the slab on both faces, raised fields between
  const leafGeo = (sgn) => {
    const X = (a) => sgn * a;
    const parts = [uvBox(lw, lh, T, X(lw / 2), lh / 2, 0, 1.2)];
    const rails = [[0, 0.24], [0.98, 1.16], [2.06, 2.2], [lh - 0.16, lh]];
    const st = 0.15, pr = 0.018;
    for (const f of [1, -1]) {
      const z = f * (T / 2 + pr / 2);
      parts.push(uvBox(st, lh, pr, X(st / 2), lh / 2, z, 1.2), uvBox(st, lh, pr, X(lw - st / 2), lh / 2, z, 1.2));
      for (const [a, b] of rails) parts.push(uvBox(lw - 2 * st, b - a, pr, X(lw / 2), (a + b) / 2, z, 1.2));
      for (let k = 0; k < rails.length - 1; k++) {
        const a = rails[k][1] + 0.05, b = rails[k + 1][0] - 0.05, w = lw - 2 * st - 0.1;
        parts.push(uvBox(w, b - a, 0.012, X(lw / 2), (a + b) / 2, f * (T / 2 + 0.006), 1.2));
        parts.push(uvBox(w - 0.08, b - a - 0.08, 0.026, X(lw / 2), (a + b) / 2, f * (T / 2 + 0.013), 1.2));
      }
    }
    return merge(parts);
  };
  const ironGeo = (sgn) => {
    const X = (a) => sgn * a;
    const parts = [];
    for (const h of [0.45, lh / 2, lh - 0.45]) for (const f of [1, -1]) parts.push(uvBox(0.62, 0.07, 0.012, X(0.31), h, f * (T / 2 + 0.024), 4));
    // inside: the long pull bar near the meeting edge, on two stand-off brackets
    const bar = new THREE.CylinderGeometry(0.016, 0.016, 1.34, 10); bar.translate(X(bx), 1.36, T / 2 + 0.07); parts.push(planarUV(bar, 4));
    for (const h of [0.72, 2.0]) parts.push(uvBox(0.03, 0.04, 0.075, X(bx), h, T / 2 + 0.045, 4));
    // outside: a ring pull on a back plate
    const ring = new THREE.TorusGeometry(0.09, 0.013, 8, 24); ring.translate(X(bx), 1.26, -(T / 2 + 0.03)); parts.push(planarUV(ring, 4));
    parts.push(uvBox(0.1, 0.1, 0.014, X(bx), 1.36, -(T / 2 + 0.007), 4));
    return merge(parts);
  };
  const mkLeaf = (hx, sgn) => {
    const piv = new THREE.Group();
    piv.position.set(hx, y, line);
    for (const m of [new THREE.Mesh(leafGeo(sgn), wood), new THREE.Mesh(ironGeo(sgn), iron)]) { m.castShadow = true; m.receiveShadow = true; piv.add(m); }
    group.add(piv);
    return piv;
  };
  const a = mkLeaf(x0 + 0.003, 1), b = mkLeaf(x1 - 0.003, -1);
  d.leaves.push({ obj: a, base: 0, dir: -1 }, { obj: b, base: 0, dir: 1 });
  // ---- casing round the opening (inside face): heavy moulded frame with a cornice, plus the reveal through the wall
  const wz = line + WT, H = d.height;
  const casing = new THREE.Mesh(merge([
    uvBox(0.24, H + 0.24, 0.07, x0 - 0.12, y + (H + 0.24) / 2, wz + 0.035, 1.2), uvBox(0.24, H + 0.24, 0.07, x1 + 0.12, y + (H + 0.24) / 2, wz + 0.035, 1.2),
    uvBox(x1 - x0 + 0.48, 0.24, 0.07, cx, y + H + 0.12, wz + 0.035, 1.2),
    uvBox(x1 - x0 + 0.7, 0.1, 0.16, cx, y + H + 0.29, wz + 0.08, 1.2), uvBox(x1 - x0 + 0.8, 0.06, 0.2, cx, y + H + 0.37, wz + 0.1, 1.2),
    uvBox(0.3, 0.22, 0.1, x0 - 0.12, y + 0.11, wz + 0.05, 1.2), uvBox(0.3, 0.22, 0.1, x1 + 0.12, y + 0.11, wz + 0.05, 1.2),
    uvBox(0.03, H, 2 * WT + 0.04, x0 - 0.015, y + H / 2, line, 1.2), uvBox(0.03, H, 2 * WT + 0.04, x1 + 0.015, y + H / 2, line, 1.2),
    uvBox(x1 - x0 + 0.06, 0.03, 2 * WT + 0.04, cx, y + H + 0.015, line, 1.2),
  ]), wood);
  casing.receiveShadow = true; casing.castShadow = true;
  group.add(casing);
  // ---- chains: a loop round both pull bars (padlock at the bottom of the loop), and an X of two heavy chains
  // across both leaves, stapled to the casing, each joined by a padlock. One padlock per key.
  const zf = line + T / 2, bxL = x0 + 0.003 + bx, bxR = x1 - 0.003 - bx;
  const V = (x, yy, z) => new THREE.Vector3(x, y + yy, z);
  const S = 2.1, shackleTop = 0.1 * S;                             // padlock origin -> where the chain runs through the shackle
  d.chains = []; d.padlocks = [];
  const lock = (kind, P, chain) => {
    group.add(chain);
    d.chains.push(chain);
    const pl = cloneProp('furniture', 'Padlock'); applyLibrary(pl);
    const bodyMat = libMaterial(kind === 'brass' ? 'M_brass' : kind === 'silver' ? 'M_chrome' : 'M_iron');
    pl.traverse((o) => { if (o.isMesh && o.name !== 'Padlock_Shackle' && o.name !== 'plkh') o.material = bodyMat; });
    pl.scale.setScalar(S);
    pl.position.set(P.x, P.y - shackleTop, P.z + 0.004);
    pl.userData = { kind, chain, rest: pl.position.clone(), shackle: pl.getObjectByName('Padlock_Shackle') };
    group.add(pl);
    d.padlocks.push(pl);
  };
  // the loop through the pull bars
  {
    const h = 1.17, sag = 0.2, z = (o) => zf + o;
    const P = V(cx, h - sag, z(0.118));
    lock('brass', P, makeChain([V(cx - 0.012, h - sag, z(0.118)), V(cx - 0.12, h - 0.1, z(0.114)), V(bxL + 0.03, h - 0.014, z(0.112)), V(bxL - 0.036, h, z(0.07)),
      V(bxL + 0.005, h + 0.014, z(0.03)), V(bxL + 0.08, h + 0.03, z(0.042)), V(cx, h + 0.045, z(0.046)), V(bxR - 0.08, h + 0.03, z(0.042)),
      V(bxR - 0.005, h + 0.014, z(0.03)), V(bxR + 0.036, h, z(0.07)), V(bxR - 0.03, h - 0.014, z(0.112)), V(cx + 0.12, h - 0.1, z(0.114)), V(cx + 0.012, h - sag, z(0.118))], iron));
  }
  // the X: from a staple high on one jamb to a staple low on the other, sagging, with a padlock joining it on the way
  const staple = new THREE.TorusGeometry(0.035, 0.009, 6, 12, Math.PI);
  const stapleMeshes = [];
  const diag = (kind, sx, zo) => {
    const A = V(sx < 0 ? x0 - 0.12 : x1 + 0.12, 2.52, wz + 0.08), B = V(sx < 0 ? x1 + 0.12 : x0 - 0.12, 0.46, wz + 0.08);
    for (const s of [A, B]) { const m = new THREE.Mesh(staple, iron); m.position.copy(s).setZ(wz + 0.07); m.rotation.x = Math.PI / 2; m.rotation.z = Math.PI / 2; stapleMeshes.push(m); }
    const px = cx + sx * 0.52;                                      // padlock on the upper part of the run
    const sp = (px - A.x) / (B.x - A.x);
    const pts = [A, V(A.x - sx * 0.1, A.y - 0.07, zf + zo)];
    let P = null;
    for (let k = 1; k < 12; k++) {
      const s = k / 12;
      const q = new THREE.Vector3().lerpVectors(A, B, s);
      q.y -= Math.sin(Math.PI * s) * 0.09; q.z = zf + zo;
      if (!P && s > sp) {
        P = new THREE.Vector3().lerpVectors(A, B, sp); P.y -= Math.sin(Math.PI * sp) * 0.09 + 0.035; P.z = zf + zo + 0.01;
        pts.push(P);
      }
      if (Math.abs(s - sp) > 0.03) pts.push(q);
    }
    pts.push(V(B.x + sx * 0.1, B.y + 0.07, zf + zo), B);
    lock(kind, P, makeChain(pts, iron));
  };
  diag('silver', -1, 0.06);
  diag('iron', 1, 0.09);
  const staples = new THREE.Mesh(merge(stapleMeshes.map((m) => { m.updateMatrix(); return planarUV(m.geometry.clone().applyMatrix4(m.matrix), 4); })), iron);
  group.add(staples);
  d.scripted = false;
}
