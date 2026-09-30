// Room furnishing: rule-based placement of detailed props, plus registration of lights, hide spots,
// loot containers, item spots and interactables. Static props are merged per room/material.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { cloneProp, applyLibrary } from '../core/assets.js';
import { WT, FH, CEIL, C } from './level.js';

const DYNAMIC = /(_Door|Drawer|Pendulum|Lever|_Lid|DisplayCase_Glass|_Hand|Ballerina|Crank|VentBoards|Window_Glass)/;
const NO_COLLIDE = new Set(['Painting_Portrait', 'Painting_Tall', 'Painting_Wide', 'Painting_Small', 'Sconce', 'Chandelier',
  'WallMirror', 'Curtain', 'CurtainRod', 'WindowFrame', 'TableLamp', 'HangingSheet', 'KitchenShelf', 'Rug', 'VentGrate', 'VentBoards']);

// local-space item surfaces per prop (x, y, z) - front is +Z
const SURFACES = {
  DiningTable: [[-0.9, 0.785, 0.15], [0.3, 0.785, -0.2], [1.1, 0.785, 0.2], [-0.2, 0.785, 0.3]],
  Desk: [[-0.35, 0.785, 0.05], [0.2, 0.785, 0.15]],
  Nightstand: [[0.05, 0.68, 0.0]],
  Dresser: [[-0.35, 0.94, -0.05], [0.35, 0.94, -0.05]],
  KitchenCounter: [[-0.4, 0.91, 0.12], [0.1, 0.91, 0.18]],
  Crate: [[0.0, 0.65, 0.0]],
  Bed: [[0.3, 0.76, -0.3]],
  Pew: [[0.5, 0.47, 0.0]],
  Barrel: [[0.0, 0.9, 0.0]],
  Altar: [[0.0, 1.015, 0.15]],
  BilliardTable: [[0.8, 0.85, 0.3]],
  Bookshelf: [[-0.3, 0.515, 0.12], [0.3, 0.935, 0.12], [0.0, 1.355, 0.12]],
  Sofa: [[0.4, 0.52, 0.0]],
  Stove: [[0.3, 0.9, 0.1]],
};
const LIGHTS = {
  Chandelier_Light: { color: 0xffb46a, intensity: 18, range: 11, kind: 'electric' },
  Sconce_Light: { color: 0xffae5c, intensity: 5, range: 6, kind: 'electric' },
  TableLamp_Light: { color: 0xffb870, intensity: 4, range: 5, kind: 'electric' },
  Fireplace_Light: { color: 0xff6a22, intensity: 10, range: 7, kind: 'fire' },
  Candelabra_Light: { color: 0xff9a3c, intensity: 4, range: 5, kind: 'fire' },
  Bulb_Light: { color: 0xffd9a0, intensity: 7, range: 7, kind: 'electric' },
};

export class Furnisher {
  constructor(level, rng) {
    this.L = level;
    this.rng = rng;
    this.sizeCache = {};
    this.dynamicObjs = [];
  }

  size(name, glb = 'furniture') {
    if (this.sizeCache[name]) return this.sizeCache[name];
    const o = cloneProp(glb, name);
    o.updateMatrixWorld(true);
    const b = new THREE.Box3().setFromObject(o);
    const s = { w: b.max.x - b.min.x, d: b.max.z - b.min.z, h: b.max.y - b.min.y, minX: b.min.x, maxX: b.max.x, minZ: b.min.z, maxZ: b.max.z };
    this.sizeCache[name] = s;
    return s;
  }

  // ------------------------------------------------------------------ wall spans
  sides(room, layer) {
    const r = room;
    const y = layer * FH;
    const S = [
      { id: 'S', axis: 'x', fixed: r.z + WT, from: r.x, to: r.x + r.w, rot: 0, inward: [0, 1] },
      { id: 'N', axis: 'x', fixed: r.z + r.d - WT, from: r.x, to: r.x + r.w, rot: Math.PI, inward: [0, -1] },
      { id: 'W', axis: 'z', fixed: r.x + WT, from: r.z, to: r.z + r.d, rot: Math.PI / 2, inward: [1, 0] },
      { id: 'E', axis: 'z', fixed: r.x + r.w - WT, from: r.z, to: r.z + r.d, rot: -Math.PI / 2, inward: [-1, 0] },
    ];
    for (const s of S) {
      s.y = y;
      s.free = [[s.from + 0.2, s.to - 0.2]];
      s.freeLow = [[s.from + 0.2, s.to - 0.2]];
      const cut = (lst, a, b) => {
        const out = [];
        for (const [p, q] of lst) {
          if (b <= p || a >= q) { out.push([p, q]); continue; }
          if (a > p) out.push([p, a]);
          if (b < q) out.push([b, q]);
        }
        return out;
      };
      const line = s.id === 'S' ? r.z : s.id === 'N' ? r.z + r.d : s.id === 'W' ? r.x : r.x + r.w;
      for (const d of r.doors) {
        if (d.layer !== layer && d.kind !== 'gate') continue;
        const onLine = (d.orient === 'h' && s.axis === 'x' && Math.abs(d.z - line) < 0.01) || (d.orient === 'v' && s.axis === 'z' && Math.abs(d.x - line) < 0.01);
        if (!onLine) continue;
        const c = s.axis === 'x' ? d.x : d.z, hw = d.width / 2 + (d.kind === 'vent' ? 0.4 : 0.75);
        s.free = cut(s.free, c - hw, c + hw);
        s.freeLow = cut(s.freeLow, c - hw, c + hw);
      }
      for (const w of r.windows) {
        const onLine = (w.orient === 'h' && s.axis === 'x' && Math.abs(w.z - line) < 0.01) || (w.orient === 'v' && s.axis === 'z' && Math.abs(w.x - line) < 0.01);
        if (!onLine) continue;
        const c = s.axis === 'x' ? w.x : w.z;
        s.free = cut(s.free, c - 1.25, c + 1.25);
        s.freeLow = cut(s.freeLow, c - 0.95, c + 0.95);
      }
    }
    return S;
  }

  // ------------------------------------------------------------------ placement
  footprintFree(room, x0, z0, x1, z1, margin = 0.12) {
    if (x0 < room.x + WT || z0 < room.z + WT || x1 > room.x + room.w - WT || z1 > room.z + room.d - WT) return false;
    for (const f of room.footprints) {
      if (x0 < f.x1 + margin && x1 > f.x0 - margin && z0 < f.z1 + margin && z1 > f.z0 - margin) return false;
    }
    // keep door swing / walkway zones clear
    for (const d of room.doors) {
      const zone = 1.25;
      const hw = d.width / 2 + 0.2;
      const dx0 = d.orient === 'h' ? d.x - hw : d.x - zone, dx1 = d.orient === 'h' ? d.x + hw : d.x + zone;
      const dz0 = d.orient === 'h' ? d.z - zone : d.z - hw, dz1 = d.orient === 'h' ? d.z + zone : d.z + hw;
      if (x0 < dx1 && x1 > dx0 && z0 < dz1 && z1 > dz0) return false;
    }
    return true;
  }

  /** Instantiate + register a prop at world (x,z) with yaw rot on the room's floor (or y override). */
  spawn(name, room, layer, x, z, rot, opts = {}) {
    const obj = cloneProp(opts.glb || 'furniture', name);
    applyLibrary(obj);
    const y = (opts.y ?? 0) + layer * FH;
    obj.position.set(x, y, z);
    obj.rotation.y = rot;
    if (opts.scale) obj.scale.setScalar(opts.scale);
    obj.updateMatrixWorld(true);
    obj.userData.prop = name;
    obj.userData.room = room;
    room.group.add(obj);
    const box = new THREE.Box3().setFromObject(obj);
    if (!opts.noFootprint) room.footprints.push({ x0: box.min.x, z0: box.min.z, x1: box.max.x, z1: box.max.z, name });
    if (!NO_COLLIDE.has(name) && !opts.noCollide && box.max.y - box.min.y > 0.25) {
      const shrink = opts.shrink ?? 0.04;
      this.L.addCollider({ x0: box.min.x + shrink, z0: box.min.z + shrink, x1: box.max.x - shrink, z1: box.max.z - shrink,
        y0: box.min.y, y1: box.max.y, prop: name });
    }
    this.registerFeatures(obj, name, room, layer);
    return obj;
  }

  /** Place against a wall. Returns the object or null when no span fits. */
  againstWall(name, room, layer, opts = {}) {
    const sz = this.size(name);
    const w = sz.w * (opts.scale ?? 1), d = sz.d * (opts.scale ?? 1);
    const sides = room._sides[layer];
    const cand = [];
    for (const s of sides) {
      if (opts.side && !opts.side.includes(s.id)) continue;
      const list = opts.low ? s.freeLow : s.free;
      for (const [a, b] of list) if (b - a >= w + 0.05) cand.push({ s, a, b });
    }
    if (!cand.length) return null;
    this.rng.shuffle(cand);
    if (opts.preferLong) cand.sort((p, q) => (q.b - q.a) - (p.b - p.a));
    for (const c of cand) {
      const s = c.s;
      const span = c.b - c.a - w;
      const along = opts.center ? c.a + (c.b - c.a) / 2 : c.a + w / 2 + (opts.atStart ? 0 : this.rng.next() * span);
      const off = WT + d / 2 + (opts.gap ?? 0.03) - (s.id === 'S' || s.id === 'N' ? 0 : 0);
      const x = s.axis === 'x' ? along : s.fixed + s.inward[0] * (d / 2 + (opts.gap ?? 0.03) - (opts.flush ? d / 2 : 0));
      const z = s.axis === 'x' ? s.fixed + s.inward[1] * (d / 2 + (opts.gap ?? 0.03) - (opts.flush ? d / 2 : 0)) : along;
      void off;
      // footprint test
      const hw = s.axis === 'x' ? w / 2 : d / 2, hd = s.axis === 'x' ? d / 2 : w / 2;
      if (!opts.wallMount && !this.footprintFree(room, x - hw, z - hd, x + hw, z + hd, 0.05)) continue;
      // consume span
      const list = opts.low ? s.freeLow : s.free;
      const m = opts.spacing ?? 0.25;
      const cut = [];
      for (const [p, q] of list) {
        if (along + w / 2 + m <= p || along - w / 2 - m >= q) { cut.push([p, q]); continue; }
        if (along - w / 2 - m > p) cut.push([p, along - w / 2 - m]);
        if (along + w / 2 + m < q) cut.push([along + w / 2 + m, q]);
      }
      if (opts.low) s.freeLow = cut; else { s.free = cut; if (!opts.wallMount) s.freeLow = s.freeLow.map((x2) => x2); }
      if (!opts.wallMount && !opts.low) {
        // tall furniture also blocks low placements
        const cl = [];
        for (const [p, q] of s.freeLow) {
          if (along + w / 2 + m <= p || along - w / 2 - m >= q) { cl.push([p, q]); continue; }
          if (along - w / 2 - m > p) cl.push([p, along - w / 2 - m]);
          if (along + w / 2 + m < q) cl.push([along + w / 2 + m, q]);
        }
        s.freeLow = cl;
      }
      return this.spawn(name, room, layer, x, z, s.rot + (opts.rotOffset ?? 0), { ...opts, noFootprint: !!opts.wallMount });
    }
    return null;
  }

  /** Mount on a wall at height (paintings, sconces, mirrors). */
  onWall(name, room, layer, y, opts = {}) {
    const sz = this.size(name);
    const sides = room._sides[layer];
    const cand = [];
    for (const s of sides) {
      if (opts.side && !opts.side.includes(s.id)) continue;
      for (const [a, b] of s.wallFree || (s.wallFree = s.free.map((x) => [...x]))) if (b - a >= sz.w + 0.1) cand.push({ s, a, b });
    }
    if (!cand.length) return null;
    const c = this.rng.pick(cand);
    const s = c.s;
    const along = opts.center ? (c.a + c.b) / 2 : c.a + sz.w / 2 + this.rng.next() * (c.b - c.a - sz.w);
    const dd = (opts.depth ?? sz.d / 2) + 0.005;
    const x = s.axis === 'x' ? along : s.fixed + s.inward[0] * dd;
    const z = s.axis === 'x' ? s.fixed + s.inward[1] * dd : along;
    const m = 0.4;
    const out = [];
    for (const [p, q] of s.wallFree) {
      if (along + sz.w / 2 + m <= p || along - sz.w / 2 - m >= q) { out.push([p, q]); continue; }
      if (along - sz.w / 2 - m > p) out.push([p, along - sz.w / 2 - m]);
      if (along + sz.w / 2 + m < q) out.push([along + sz.w / 2 + m, q]);
    }
    s.wallFree = out;
    return this.spawn(name, room, layer, x, z, s.rot, { ...opts, y, noFootprint: true, noCollide: true });
  }

  /** Free-standing placement near the room centre (or random inside), rotation given or random-ish. */
  inRoom(name, room, layer, opts = {}) {
    const sz = this.size(name, opts.glb);
    const sc = opts.scale ?? 1;
    for (let t = 0; t < (opts.tries ?? 40); t++) {
      const rot = opts.rot ?? (opts.alignLong ? (room.w >= room.d ? 0 : Math.PI / 2) : this.rng.pick([0, Math.PI / 2, Math.PI, -Math.PI / 2]));
      const sw = Math.abs(Math.cos(rot)) * sz.w + Math.abs(Math.sin(rot)) * sz.d;
      const sd = Math.abs(Math.sin(rot)) * sz.w + Math.abs(Math.cos(rot)) * sz.d;
      let x, z;
      if (opts.at) { [x, z] = opts.at; } else if (opts.centered && t < 6) {
        x = room.cx + (this.rng.next() - 0.5) * t * 0.3; z = room.cz + (this.rng.next() - 0.5) * t * 0.3;
      } else {
        x = room.x + 0.6 + sw * sc / 2 + this.rng.next() * Math.max(0, room.w - 1.2 - sw * sc);
        z = room.z + 0.6 + sd * sc / 2 + this.rng.next() * Math.max(0, room.d - 1.2 - sd * sc);
      }
      if (this.footprintFree(room, x - sw * sc / 2, z - sd * sc / 2, x + sw * sc / 2, z + sd * sc / 2, opts.margin ?? 0.35) || opts.force) {
        return this.spawn(name, room, layer, x, z, rot, opts);
      }
      if (opts.at) break;
    }
    return null;
  }

  // ------------------------------------------------------------------ feature registration
  registerFeatures(obj, name, room, layer) {
    obj.traverse((o) => {
      const n = o.name;
      if (LIGHTS[n]) {
        const p = new THREE.Vector3(); o.getWorldPosition(p);
        const cfg = LIGHTS[n];
        room.lights.push({ pos: p, ...cfg, room, prop: obj, flicker: Math.random() });
      }
      if (DYNAMIC.test(n) && o.isObject3D) this.dynamicObjs.push(o);
    });
    const surf = SURFACES[name];
    if (surf) {
      for (const [lx, ly, lz] of surf) {
        const p = new THREE.Vector3(lx, ly, lz).applyMatrix4(obj.matrixWorld);
        room.spots.push({ pos: p, kind: 'surface', prop: name, rot: obj.rotation.y });
      }
    }
    if (name === 'Wardrobe') {
      const cam = obj.getObjectByName('Wardrobe_HideCam');
      const p = new THREE.Vector3(); cam.getWorldPosition(p);
      const front = new THREE.Vector3(0, 0, 1).applyAxisAngle(new THREE.Vector3(0, 1, 0), obj.rotation.y);
      const hs = { id: room.hideSpots.length + room.index * 100, room, pos: p, front, yaw: obj.rotation.y,
        doorL: obj.getObjectByName('Wardrobe_DoorL'), doorR: obj.getObjectByName('Wardrobe_DoorR'), occupant: null, open: 0,
        stand: p.clone().addScaledVector(front, 0.9).setY(layer * FH) };
      room.hideSpots.push(hs);
      room.interact.push({ kind: 'hide', ref: hs, pos: p.clone().setY(layer * FH + 1.2), radius: 1.4, label: 'Hide' });
    }
    if (name === 'Dresser' || name === 'Nightstand') {
      obj.traverse((o) => {
        if (!/Drawer/.test(o.name)) return;
        const p = new THREE.Vector3(); o.getWorldPosition(p);
        const out = new THREE.Vector3(0, 0, 1).applyAxisAngle(new THREE.Vector3(0, 1, 0), obj.rotation.y);
        const dr = { obj: o, open: 0, target: 0, loot: null, base: o.position.clone(), out, room };
        room.spots.push({ pos: p.clone().addScaledVector(out, -0.2).add(new THREE.Vector3(0, -0.02, 0)), kind: 'drawer', drawer: dr });
        room.interact.push({ kind: 'drawer', ref: dr, pos: p, radius: 1.3, label: 'Open drawer' });
      });
    }
    if (name === 'FuseBox') {
      const slot = obj.getObjectByName('FuseBox_Slot');
      const p = new THREE.Vector3(); slot.getWorldPosition(p);
      const fb = { obj, slot: p, door: obj.getObjectByName('FuseBox_Door'), lever: obj.getObjectByName('FuseBox_Lever'), hasFuse: true, room };
      room.fuseBox = fb;
      room.interact.push({ kind: 'fusebox', ref: fb, pos: p, radius: 1.6, label: 'Fuse box' });
    }
    if (name === 'DisplayCase') {
      const it = obj.getObjectByName('DisplayCase_Item');
      const p = new THREE.Vector3(); it.getWorldPosition(p);
      const dc = { obj, glass: obj.getObjectByName('DisplayCase_Glass'), itemPos: p, broken: false, item: null, room };
      (room.cases ||= []).push(dc);
      room.interact.push({ kind: 'case', ref: dc, pos: p, radius: 1.4, label: 'Display case' });
    }
    if (name === 'Piano') {
      const p = obj.position.clone().setY(obj.position.y + 0.8);
      room.interact.push({ kind: 'piano', ref: { obj, room }, pos: p, radius: 1.8, label: 'Play' });
    }
    if (name === 'Clock') {
      room.clock = { obj, pendulum: obj.getObjectByName('Clock_Pendulum'), handH: obj.getObjectByName('Clock_HandH'), handM: obj.getObjectByName('Clock_HandM') };
    }
  }

  // ------------------------------------------------------------------ merge static meshes per room/material
  mergeRoom(room) {
    const byMat = new Map();
    const remove = [];
    room.group.updateMatrixWorld(true);
    room.group.traverse((o) => {
      if (!o.isMesh || o.isSkinnedMesh) return;
      // skip the level's own merged meshes and anything under a dynamic node
      let p = o, dyn = false;
      while (p && p !== room.group) { if (DYNAMIC.test(p.name) || p.userData.keep) { dyn = true; break; } p = p.parent; }
      if (dyn || !o.parent || o.parent === room.group) return;
      const m = o.material;
      if (!byMat.has(m)) byMat.set(m, []);
      const g = o.geometry.clone();
      g.applyMatrix4(o.matrixWorld);
      byMat.get(m).push({ g, cast: o.castShadow });
      remove.push(o);
    });
    for (const o of remove) o.parent.remove(o);
    for (const [m, list] of byMat) {
      const geos = list.map((x) => x.g);
      const anyIndexed = geos.some((g) => g.index), allIndexed = geos.every((g) => g.index);
      const norm = geos.map((g) => {
        let h = (anyIndexed && !allIndexed && g.index) ? g.toNonIndexed() : g;
        for (const k of Object.keys(h.attributes)) if (!['position', 'normal', 'uv'].includes(k)) h.deleteAttribute(k);
        if (!h.attributes.uv) h.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(h.attributes.position.count * 2), 2));
        if (!h.attributes.normal) h.computeVertexNormals();
        return h;
      });
      let merged = null;
      try { merged = mergeGeometries(norm, false); } catch (_) { merged = null; }
      if (!merged) continue;
      merged.computeBoundingSphere();
      const mesh = new THREE.Mesh(merged, m);
      mesh.castShadow = list.some((x) => x.cast);
      mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false;
      mesh.name = 'merged:' + (m.name || 'mat');
      room.group.add(mesh);
      norm.forEach((g) => g.dispose());
    }
    // remove now-empty prop roots (keep ones that still hold dynamic children or feature empties)
    for (const c of [...room.group.children]) {
      if (c.isMesh) continue;
      let hasMesh = false;
      c.traverse((o) => { if (o.isMesh) hasMesh = true; });
      if (!hasMesh && !c.userData.keep) {
        // keep transform holder if it has dynamic descendants
        let dyn = false;
        c.traverse((o) => { if (DYNAMIC.test(o.name)) dyn = true; });
        if (!dyn) room.group.remove(c);
      }
    }
  }

  // ------------------------------------------------------------------ windows & curtains
  windows(room, rainMat) {
    for (const w of room.windows) {
      const y = w.layer * FH;
      // WindowFrame prop: glass faces -Y in Blender => +Z here; rotate so it faces into the room
      let rot, x = w.x, z = w.z;
      if (w.orient === 'h') rot = w.out < 0 ? 0 : Math.PI;
      else rot = w.out < 0 ? Math.PI / 2 : -Math.PI / 2;
      const frame = this.spawn('WindowFrame', room, w.layer, x, z, rot, { noFootprint: true, noCollide: true });
      frame.userData.keep = true;
      const glass = frame.getObjectByName('Window_Glass');
      if (glass) glass.traverse((o) => { if (o.isMesh) { o.material = rainMat; o.castShadow = false; o.renderOrder = 1; } });
      // curtains on galleries, bedrooms and formal rooms
      if (['gallery', 'bedroom', 'parlor', 'dining', 'foyer', 'music', 'museum', 'library', 'nursery', 'study', 'landing', 'hall'].includes(room.type)) {
        const inward = w.orient === 'h' ? new THREE.Vector3(0, 0, -w.out) : new THREE.Vector3(-w.out, 0, 0);
        const side = w.orient === 'h' ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 0, 1);
        const base = new THREE.Vector3(x, 0, z).addScaledVector(inward, WT + 0.16);
        for (const s of [-1, 1]) {
          const c = cloneProp('furniture', 'Curtain'); applyLibrary(c);
          c.position.copy(base).addScaledVector(side, s * 1.02); c.position.y = y + (CEIL - 3.35);
          c.rotation.y = rot + (s > 0 ? Math.PI : 0) * 0;
          c.scale.x = s;   // mirror for the other side
          c.userData.keep = true;
          room.group.add(c);
          c.traverse((o) => { if (o.isMesh) o.material.side = THREE.DoubleSide; });
        }
        const rodObj = cloneProp('furniture', 'CurtainRod'); applyLibrary(rodObj);
        rodObj.position.copy(base).addScaledVector(inward, -0.06); rodObj.position.y = y + (CEIL - 3.4);
        rodObj.rotation.y = rot;
        room.group.add(rodObj);
      }
    }
  }
}

// ============================================================================ room recipes
function rugFor(F, room, layer, scale = 1) {
  const g = new THREE.PlaneGeometry(1, 1);
  g.rotateX(-Math.PI / 2);
  const long = room.w >= room.d;
  const w = Math.min(room.w - 2.2, (long ? 4.2 : 2.8) * scale), d = Math.min(room.d - 2.2, (long ? 2.8 : 4.2) * scale);
  if (w < 1.2 || d < 1.2) return;
  const tex = F.rugMat;
  const m = new THREE.Mesh(g, tex);
  m.scale.set(w, 1, d);
  if (long) { m.rotation.y = Math.PI / 2; m.scale.set(d, 1, w); }
  m.position.set(room.cx, layer * FH + 0.012, room.cz);
  m.receiveShadow = true;
  m.userData.keep = true;
  room.group.add(m);
  room.rugs.push({ x0: room.cx - w / 2, z0: room.cz - d / 2, x1: room.cx + w / 2, z1: room.cz + d / 2 });
}

function runnerFor(F, room, layer) {
  const long = room.w >= room.d;
  const len = (long ? room.w : room.d) - 1.2, wid = 1.0;
  if (len < 2) return;
  const g = new THREE.PlaneGeometry(1, 1); g.rotateX(-Math.PI / 2);
  const m = new THREE.Mesh(g, F.runnerMat);
  if (long) m.scale.set(len, 1, wid); else m.scale.set(wid, 1, len);
  m.position.set(room.cx, layer * FH + 0.012, room.cz);
  m.receiveShadow = true; m.userData.keep = true;
  room.group.add(m);
  room.rugs.push({ x0: room.cx - (long ? len : wid) / 2, z0: room.cz - (long ? wid : len) / 2, x1: room.cx + (long ? len : wid) / 2, z1: room.cz + (long ? wid : len) / 2 });
}

function paintings(F, room, layer, n) {
  const names = ['Painting_Portrait', 'Painting_Tall', 'Painting_Wide', 'Painting_Small'];
  for (let i = 0; i < n; i++) {
    const nm = F.rng.pick(names);
    F.onWall(nm, room, layer, nm === 'Painting_Tall' ? 0.9 : 1.25, {});
  }
}

function sconces(F, room, layer, n) {
  for (let i = 0; i < n; i++) F.onWall('Sconce', room, layer, 2.05, { depth: 0.0 });
}

function chandelier(F, room, layer) {
  const c = cloneProp('furniture', 'Chandelier'); applyLibrary(c, { cast: false });
  c.position.set(room.cx, layer * FH + CEIL, room.cz);
  c.userData.prop = 'Chandelier';
  room.group.add(c);
  c.updateMatrixWorld(true);
  F.registerFeatures(c, 'Chandelier', room, layer);
}

function bareBulb(F, room, layer) {
  const g = new THREE.Group();
  const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.7, 6), F.cordMat);
  cord.position.y = -0.35;
  const socket = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.03, 0.06, 12), F.cordMat); socket.position.y = -0.72;
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.045, 16, 12), F.bulbMat); bulb.position.y = -0.79; bulb.scale.y = 1.3;
  g.add(cord, socket, bulb);
  g.position.set(room.cx, layer * FH + CEIL, room.cz);
  room.group.add(g);
  room.lights.push({ pos: new THREE.Vector3(room.cx, layer * FH + CEIL - 0.85, room.cz), ...LIGHTS.Bulb_Light, room, prop: g, flicker: Math.random(), swing: g });
}

function wardrobes(F, room, layer, n) { for (let i = 0; i < n; i++) F.againstWall('Wardrobe', room, layer, {}); }

export const RECIPES = {
  foyer(F, r, l) {
    rugFor(F, r, l, 1.2);
    chandelier(F, r, l);
    F.againstWall('Clock', r, l, { side: 'N' }) || F.againstWall('Clock', r, l, {});
    F.againstWall('Statue_Weeping', r, l, {});
    F.againstWall('CoatRack', r, l, { side: 'S' });
    F.againstWall('Candelabra', r, l, {}); F.againstWall('Candelabra', r, l, {});
    F.againstWall('Wardrobe', r, l, { side: 'E,W' });
    F.againstWall('Nightstand', r, l, {});
    F.onWall('WallMirror', r, l, 1.2, {});
    paintings(F, r, l, 4); sconces(F, r, l, 4);
  },
  parlor(F, r, l) {
    rugFor(F, r, l);
    const fp = F.againstWall('Fireplace', r, l, { side: 'N,E,W', center: true });
    F.inRoom('Sofa', r, l, { centered: true, rot: fp ? fp.rotation.y + Math.PI : 0 });
    F.inRoom('Armchair', r, l, {}); F.inRoom('Armchair', r, l, {});
    F.againstWall('Bookshelf', r, l, {});
    const ns = F.againstWall('Nightstand', r, l, { low: true });
    if (ns) lampOn(F, r, l, ns, 0.68);
    F.inRoom('SheetCovered', r, l, {});
    F.againstWall('Wardrobe', r, l, {});
    paintings(F, r, l, 3); sconces(F, r, l, 2); chandelier(F, r, l);
  },
  library(F, r, l) {
    rugFor(F, r, l, 0.8);
    for (let i = 0; i < 8; i++) F.againstWall('Bookshelf', r, l, {});
    const desk = F.inRoom('Desk', r, l, { centered: true });
    if (desk) lampOn(F, r, l, desk, 0.78, 0.5);
    F.inRoom('Armchair', r, l, {}); F.inRoom('Chair', r, l, {});
    F.againstWall('Candelabra', r, l, {});
    sconces(F, r, l, 2); paintings(F, r, l, 1);
  },
  dining(F, r, l) {
    rugFor(F, r, l, 1.1);
    const t = F.inRoom('DiningTable', r, l, { centered: true, alignLong: true, margin: 0.9 });
    if (t) {
      const ax = new THREE.Vector3(1, 0, 0).applyAxisAngle(new THREE.Vector3(0, 1, 0), t.rotation.y);
      const sd = new THREE.Vector3(0, 0, 1).applyAxisAngle(new THREE.Vector3(0, 1, 0), t.rotation.y);
      for (const u of [-0.9, 0, 0.9]) for (const s of [-1, 1]) {
        const p = t.position.clone().addScaledVector(ax, u).addScaledVector(sd, s * 0.78);
        F.spawn('Chair', r, l, p.x, p.z, t.rotation.y + (s > 0 ? Math.PI : 0), { noFootprint: true, shrink: 0.08 });
      }
      for (const s of [-1, 1]) {
        const p = t.position.clone().addScaledVector(ax, s * 1.75);
        F.spawn('Chair', r, l, p.x, p.z, t.rotation.y + (s > 0 ? -Math.PI / 2 : Math.PI / 2), { noFootprint: true, shrink: 0.08 });
      }
      const c = cloneProp('furniture', 'Chandelier'); applyLibrary(c, { cast: false });
      c.position.set(t.position.x, l * FH + CEIL, t.position.z); r.group.add(c); c.updateMatrixWorld(true);
      F.registerFeatures(c, 'Chandelier', r, l);
    }
    F.againstWall('Dresser', r, l, {});
    F.againstWall('Fireplace', r, l, { center: true });
    F.againstWall('Candelabra', r, l, {});
    paintings(F, r, l, 3); sconces(F, r, l, 2);
  },
  billiard(F, r, l) {
    F.inRoom('BilliardTable', r, l, { centered: true, alignLong: true, margin: 0.8 });
    F.againstWall('WineRack', r, l, {}); F.againstWall('Armchair', r, l, {}); F.againstWall('Nightstand', r, l, { low: true });
    F.againstWall('CoatRack', r, l, {});
    const c = cloneProp('furniture', 'Chandelier'); applyLibrary(c, { cast: false }); c.position.set(r.cx, l * FH + CEIL, r.cz); r.group.add(c); c.updateMatrixWorld(true);
    F.registerFeatures(c, 'Chandelier', r, l);
    paintings(F, r, l, 2); sconces(F, r, l, 1);
  },
  hall(F, r, l) {
    runnerFor(F, r, l);
    const n = Math.floor(Math.max(r.w, r.d) / 5);
    for (let i = 0; i < n; i++) sconces(F, r, l, 1);
    paintings(F, r, l, n + 1);
    if (F.rng.chance(0.7)) { const ns = F.againstWall('Nightstand', r, l, { low: true }); if (ns) candelOn(F, r, l, ns, 0.68); }
    if (F.rng.chance(0.6)) F.againstWall('Wardrobe', r, l, {});
    if (F.rng.chance(0.5)) F.againstWall('Radiator', r, l, { low: true });
    if (F.rng.chance(0.4)) F.againstWall('Statue_Praying', r, l, {});
    if (F.rng.chance(0.4)) F.againstWall('Clock', r, l, {});
    if (F.rng.chance(0.5)) F.againstWall('Chair', r, l, { low: true });
  },
  landing(F, r, l) { RECIPES.hall(F, r, l); if (r.w * r.d > 30) { chandelier(F, r, l); F.againstWall('Statue_Reaching', r, l, {}); } },
  gallery(F, r, l) {
    runnerFor(F, r, l);
    const n = Math.floor(Math.max(r.w, r.d) / 4.5);
    paintings(F, r, l, n); sconces(F, r, l, Math.ceil(n / 2));
    for (let i = 0; i < Math.ceil(n / 4); i++) F.againstWall('Wardrobe', r, l, {});
    for (let i = 0; i < Math.ceil(n / 5); i++) F.againstWall(F.rng.pick(['Statue_Weeping', 'Statue_Praying', 'Bust', 'SuitOfArmor']), r, l, {});
    for (let i = 0; i < Math.ceil(n / 5); i++) { const ns = F.againstWall('Nightstand', r, l, { low: true }); if (ns) candelOn(F, r, l, ns, 0.68); }
  },
  stairs(F, r, l) { paintings(F, r, l, 2); sconces(F, r, l, 2); },
  study(F, r, l) {
    rugFor(F, r, l, 0.8);
    const desk = F.inRoom('Desk', r, l, { centered: true }); if (desk) lampOn(F, r, l, desk, 0.78, 0.5);
    F.inRoom('Chair', r, l, {});
    F.againstWall('Bookshelf', r, l, {}); F.againstWall('Bookshelf', r, l, {});
    F.againstWall('Fireplace', r, l, { center: true });
    F.againstWall('Armchair', r, l, {}); F.againstWall('Clock', r, l, {}); F.againstWall('Nightstand', r, l, { low: true });
    F.againstWall('Wardrobe', r, l, {});
    paintings(F, r, l, 2); sconces(F, r, l, 2);
  },
  music(F, r, l) {
    rugFor(F, r, l);
    F.inRoom('Piano', r, l, { centered: true, margin: 0.6 });
    F.againstWall('Chair', r, l, {}); F.againstWall('Chair', r, l, {}); F.againstWall('Chair', r, l, {});
    F.againstWall('Armchair', r, l, {}); F.againstWall('Candelabra', r, l, {}); F.againstWall('Clock', r, l, {});
    F.inRoom('SheetCovered', r, l, {}); F.againstWall('Wardrobe', r, l, {});
    paintings(F, r, l, 2); chandelier(F, r, l);
  },
  storage(F, r, l) {
    for (let i = 0; i < 4; i++) F.againstWall(F.rng.pick(['Crate', 'Crate', 'Barrel', 'SheetCovered']), r, l, { low: true });
    F.inRoom('Crate', r, l, {}); F.inRoom('SheetCovered', r, l, {});
    F.againstWall('Wardrobe', r, l, {});
    if (F.rng.chance(0.5)) F.againstWall('RockingHorse', r, l, { low: true });
    F.againstWall('Bookshelf', r, l, {});
    bareBulb(F, r, l);
  },
  fuse(F, r, l) {
    F.againstWall('FuseBox', r, l, { gap: 0.0, flush: false, center: true });
    F.againstWall('Boiler', r, l, {});
    F.againstWall('Crate', r, l, { low: true }); F.againstWall('Barrel', r, l, { low: true }); F.againstWall('Desk', r, l, {});
    F.againstWall('KitchenShelf', r, l, { wallMount: true });
    bareBulb(F, r, l);
  },
  laundry(F, r, l) {
    F.againstWall('Washtub', r, l, { low: true }); F.againstWall('Washtub', r, l, { low: true });
    F.inRoom('HangingSheet', r, l, { centered: true, noCollide: true, margin: 0.1 }); F.inRoom('HangingSheet', r, l, { noCollide: true, margin: 0.1 });
    F.againstWall('KitchenShelf', r, l, { wallMount: true }); F.againstWall('Crate', r, l, { low: true });
    F.againstWall('Wardrobe', r, l, {});
    bareBulb(F, r, l);
  },
  chapel(F, r, l) {
    const altar = F.againstWall('Altar', r, l, { side: 'N', center: true }) || F.againstWall('Altar', r, l, { center: true });
    const rot = altar ? altar.rotation.y + Math.PI : 0;
    const fwd = new THREE.Vector3(0, 0, 1).applyAxisAngle(new THREE.Vector3(0, 1, 0), rot);
    for (let i = 0; i < 4; i++) {
      const p = altar ? altar.position.clone().addScaledVector(fwd, -(2.0 + i * 1.3)) : new THREE.Vector3(r.cx, 0, r.cz);
      F.inRoom('Pew', r, l, { at: [p.x, p.z], rot: altar ? altar.rotation.y : 0, margin: 0.1 });
    }
    F.againstWall('Candelabra', r, l, {}); F.againstWall('Candelabra', r, l, {}); F.againstWall('Statue_Praying', r, l, {});
    paintings(F, r, l, 1);
  },
  cellar(F, r, l) {
    F.againstWall('WineRack', r, l, {}); F.againstWall('WineRack', r, l, {});
    for (let i = 0; i < 3; i++) F.againstWall('Barrel', r, l, { low: true });
    F.inRoom('Crate', r, l, {});
    const ns = F.againstWall('Nightstand', r, l, { low: true }); if (ns) candelOn(F, r, l, ns, 0.68);
    bareBulb(F, r, l);
  },
  kitchen(F, r, l) {
    F.againstWall('Stove', r, l, {});
    for (let i = 0; i < 3; i++) F.againstWall('KitchenCounter', r, l, {});
    for (let i = 0; i < 2; i++) F.againstWall('KitchenShelf', r, l, { wallMount: true });
    F.inRoom('DiningTable', r, l, { centered: true, scale: 0.6, margin: 0.8 });
    F.inRoom('Chair', r, l, {}); F.againstWall('Barrel', r, l, { low: true });
    bareBulb(F, r, l);
  },
  pantry(F, r, l) {
    for (let i = 0; i < 3; i++) F.againstWall('KitchenShelf', r, l, { wallMount: true });
    for (let i = 0; i < 3; i++) F.againstWall(F.rng.pick(['Crate', 'Barrel']), r, l, { low: true });
    F.againstWall('Wardrobe', r, l, {}); F.inRoom('Crate', r, l, {});
    bareBulb(F, r, l);
  },
  conservatory(F, r, l) {
    F.inRoom('Fountain', r, l, { centered: true, scale: 0.4, glb: 'exterior' });
    for (let i = 0; i < 4; i++) F.againstWall('Barrel', r, l, { low: true, scale: 0.8 });
    F.againstWall('Pew', r, l, {}); F.againstWall('Statue_Reaching', r, l, {}); F.inRoom('Armchair', r, l, {});
    F.againstWall('Wardrobe', r, l, {});
    sconces(F, r, l, 3);
  },
  servants(F, r, l) {
    F.againstWall('Bed', r, l, { scale: 0.8, side: 'N,E,W' });
    F.againstWall('Wardrobe', r, l, {}); const ns = F.againstWall('Nightstand', r, l, { low: true }); if (ns) candelOn(F, r, l, ns, 0.68);
    F.againstWall('Desk', r, l, {}); F.inRoom('Chair', r, l, {}); F.againstWall('Washtub', r, l, { low: true });
    bareBulb(F, r, l);
  },
  bedroom(F, r, l) {
    rugFor(F, r, l);
    const bed = F.againstWall('Bed', r, l, { side: 'N,E,W', center: true, scale: r.small ? 0.85 : 1 }) || F.againstWall('Bed', r, l, { center: true });
    if (bed) {
      const sd = new THREE.Vector3(1, 0, 0).applyAxisAngle(new THREE.Vector3(0, 1, 0), bed.rotation.y);
      for (const s of [-1, 1]) {
        const p = bed.position.clone().addScaledVector(sd, s * 1.15);
        const back = new THREE.Vector3(0, 0, 1).applyAxisAngle(new THREE.Vector3(0, 1, 0), bed.rotation.y);
        p.addScaledVector(back, 0.75);
        const ns = F.inRoom('Nightstand', r, l, { at: [p.x, p.z], rot: bed.rotation.y, margin: 0.02 });
        if (ns) lampOn(F, r, l, ns, 0.68);
      }
    }
    F.againstWall('Wardrobe', r, l, {}); F.againstWall('Dresser', r, l, {});
    F.againstWall('Armchair', r, l, {});
    if (r.master) { F.againstWall('Fireplace', r, l, { center: true }); chandelier(F, r, l); F.againstWall('Wardrobe', r, l, {}); }
    else sconces(F, r, l, 2);
    paintings(F, r, l, 2);
  },
  bathroom(F, r, l) {
    F.againstWall('Bathtub', r, l, { side: 'N,E,W' }) || F.againstWall('Bathtub', r, l, {});
    F.againstWall('Toilet', r, l, {});
    const sink = F.againstWall('Sink', r, l, {});
    if (sink) {
      const mirror = cloneProp('furniture', 'WallMirror'); applyLibrary(mirror);
      const back = new THREE.Vector3(0, 0, -1).applyAxisAngle(new THREE.Vector3(0, 1, 0), sink.rotation.y);
      mirror.position.copy(sink.position).addScaledVector(back, 0.24); mirror.position.y = l * FH + 1.1;
      mirror.rotation.y = sink.rotation.y; r.group.add(mirror);
    }
    F.againstWall('Radiator', r, l, { low: true }); F.againstWall('Nightstand', r, l, { low: true });
    bareBulb(F, r, l);
  },
  sewing(F, r, l) {
    rugFor(F, r, l, 0.8);
    const d = F.inRoom('Desk', r, l, { centered: true }); if (d) lampOn(F, r, l, d, 0.78, 0.5);
    F.inRoom('Chair', r, l, {}); F.againstWall('Statue_Weeping', r, l, {}); F.againstWall('Wardrobe', r, l, {});
    F.inRoom('SheetCovered', r, l, {}); F.againstWall('Bookshelf', r, l, {}); F.againstWall('Dresser', r, l, {});
    sconces(F, r, l, 2);
  },
  nursery(F, r, l) {
    rugFor(F, r, l, 0.8);
    F.againstWall('Crib', r, l, { side: 'N,E,W' }) || F.againstWall('Crib', r, l, {});
    F.inRoom('RockingHorse', r, l, {});
    const ns = F.againstWall('Nightstand', r, l, { low: true });
    if (ns) r.musicBoxSpot = ns.position.clone().setY(ns.position.y + 0.68);
    F.againstWall('Wardrobe', r, l, {}); F.againstWall('Chair', r, l, {});
    F.onWall('Painting_Small', r, l, 1.3, {});
    sconces(F, r, l, 1);
  },
  museum(F, r, l) {
    rugFor(F, r, l, 1.3);
    for (const s of ['Statue_Weeping', 'Statue_Praying', 'Statue_Reaching']) F.inRoom(s, r, l, { margin: 0.9 });
    for (let i = 0; i < 4; i++) F.inRoom('DisplayCase', r, l, { margin: 0.8 });
    F.againstWall('SuitOfArmor', r, l, {}); F.againstWall('SuitOfArmor', r, l, {});
    F.againstWall('Bust', r, l, {}); F.againstWall('Bust', r, l, {});
    F.againstWall('Wardrobe', r, l, {});
    paintings(F, r, l, 6);
    chandelier(F, r, l);
    if (r.w * r.d > 90) { const c = cloneProp('furniture', 'Chandelier'); applyLibrary(c, { cast: false }); c.position.set(r.cx, l * FH + CEIL, r.z + r.d * 0.25); r.group.add(c); c.updateMatrixWorld(true); F.registerFeatures(c, 'Chandelier', r, l); }
  },
};

function lampOn(F, r, l, host, h, off = 0) {
  const lamp = cloneProp('furniture', 'TableLamp'); applyLibrary(lamp);
  const sd = new THREE.Vector3(off, 0, -0.05).applyAxisAngle(new THREE.Vector3(0, 1, 0), host.rotation.y);
  lamp.position.copy(host.position).add(sd); lamp.position.y = l * FH + h * (host.scale.x || 1);
  lamp.rotation.y = host.rotation.y;
  r.group.add(lamp); lamp.updateMatrixWorld(true);
  F.registerFeatures(lamp, 'TableLamp', r, l);
}

function candelOn(F, r, l, host, h) {
  const c = cloneProp('items', 'Candle'); applyLibrary(c);
  c.position.copy(host.position); c.position.y = l * FH + h;
  r.group.add(c); c.updateMatrixWorld(true);
  r.lights.push({ pos: c.position.clone().setY(c.position.y + 0.2), color: 0xff9a3c, intensity: 2.5, range: 4, kind: 'fire', room: r, prop: c, flicker: Math.random() });
}
