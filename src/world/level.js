// Level: turns a map definition into geometry, colliders, a navigation grid and line-of-sight queries.
import * as THREE from 'three';
import { pbr } from '../core/assets.js';

export const C = 0.5;          // grid cell (m)
export const FH = 3.8;         // floor-to-floor height
export const CEIL = 3.5;       // interior ceiling height
export const WT = 0.1;         // half wall thickness
const DOOR_W = { door: 1.0, double: 2.0, arch: 2.0, vent: 1.0, gate: 2.5 };
const DOOR_H = { door: 2.2, double: 2.45, arch: 2.75, vent: 0.9, gate: 3.0 };
const TILE = {
  wood_floor: 2.0, wood_floor_light: 2.0, parquet: 2.0, tile_checker: 2.4, stone_floor: 3.0, concrete: 3.0,
  plaster: 2.0, brick: 2.5, tile_wall: 1.5, wood_dark: 1.2, wallpaper_red: 1.0, wallpaper_green: 1.0, wallpaper_blue: 1.0,
  wallpaper_grey: 1.0, wallpaper_gold: 1.0, marble: 2.0,
};
const SURFACE = { wood_floor: 'wood', wood_floor_light: 'wood', parquet: 'wood', tile_checker: 'tile', marble: 'tile',
  stone_floor: 'stone', concrete: 'stone' };
const NO_WAINSCOT = new Set(['bathroom', 'kitchen', 'fuse', 'laundry', 'cellar', 'storage', 'pantry', 'servants', 'chapel']);

// ----------------------------------------------------------------------------- geometry accumulator
class Geo {
  constructor() { this.parts = new Map(); }
  arr(key) {
    let p = this.parts.get(key);
    if (!p) { p = { pos: [], nrm: [], uv: [] }; this.parts.set(key, p); }
    return p;
  }
  /** Quad from 4 corners (CCW seen from normal side). uv(p) -> [u,v]. */
  quad(key, a, b, c, d, n, uv) {
    const p = this.arr(key);
    for (const v of [a, b, c, a, c, d]) {
      p.pos.push(v[0], v[1], v[2]); p.nrm.push(n[0], n[1], n[2]);
      const t = uv(v); p.uv.push(t[0], -t[1]);   // textures use the glTF (flipY = false) convention
    }
  }
  /** Axis-aligned box with world-scale UVs. faces: skip set e.g. {'-y':1} */
  box(key, x0, y0, z0, x1, y1, z1, tile = 1, skip = null) {
    const T = 1 / tile;
    const f = (nm, a, b, c, d, n, uv) => { if (!skip || !skip[nm]) this.quad(key, a, b, c, d, n, uv); };
    f('+x', [x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [1, 0, 0], (v) => [-v[2] * T, v[1] * T]);
    f('-x', [x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [-1, 0, 0], (v) => [v[2] * T, v[1] * T]);
    f('+y', [x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], [0, 1, 0], (v) => [v[0] * T, -v[2] * T]);
    f('-y', [x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], [0, -1, 0], (v) => [v[0] * T, v[2] * T]);
    f('+z', [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [0, 0, 1], (v) => [v[0] * T, v[1] * T]);
    f('-z', [x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [0, 0, -1], (v) => [-v[0] * T, v[1] * T]);
  }
  meshes(matFor) {
    const out = [];
    for (const [key, p] of this.parts) {
      if (!p.pos.length) continue;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(p.pos, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(p.nrm, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(p.uv, 2));
      g.computeBoundingSphere(); g.computeBoundingBox();
      const m = new THREE.Mesh(g, matFor(key));
      m.name = key;
      m.castShadow = !key.startsWith('floor') && !key.startsWith('ceil');
      m.receiveShadow = true;
      m.matrixAutoUpdate = false;
      out.push(m);
    }
    return out;
  }
}

// ----------------------------------------------------------------------------- level
export class Level {
  constructor(def) {
    this.def = def;
    this.W = def.size[0]; this.D = def.size[1];
    this.NX = Math.round(this.W / C); this.NZ = Math.round(this.D / C);
    this.rooms = def.rooms.map((r, i) => ({
      ...r, index: i, layers: r.f === 'both' ? [0, 1] : [r.f], cx: r.x + r.w / 2, cz: r.z + r.d / 2,
      doors: [], windows: [], lights: [], hideSpots: [], spots: [], interact: [], group: null, footprints: [], rugs: [],
      surface: SURFACE[r.floor] || 'wood', visited: false,
    }));
    this.byId = Object.fromEntries(this.rooms.map((r) => [r.id, r]));
    this.stairs = this.rooms.find((r) => r.type === 'stairs');
    // cells[layer][iz*NX+ix] = room index or -1
    this.cells = [0, 1].map(() => new Int16Array(this.NX * this.NZ).fill(-1));
    for (const r of this.rooms) {
      for (const l of r.layers) {
        for (let iz = Math.round(r.z / C); iz < Math.round((r.z + r.d) / C); iz++) {
          for (let ix = Math.round(r.x / C); ix < Math.round((r.x + r.w) / C); ix++) this.cells[l][iz * this.NX + ix] = r.index;
        }
      }
    }
    // edges: h[l][k*NX+i] between cell row k-1 and k at z=k*C; v[l][k*(NX+1)+i]... we use v[l][iz*(NX+1)+k] at x=k*C
    this.hEdge = [0, 1].map(() => new Array((this.NZ + 1) * this.NX).fill(null));
    this.vEdge = [0, 1].map(() => new Array(this.NZ * (this.NX + 1)).fill(null));
    this.doors = [];
    this.colliders = [];
    this.dynamic = [];     // door colliders (toggle)
    this.hash = new Map();
    this._buildEdges();
    this._placeDoors();
  }

  cell(l, ix, iz) {
    if (ix < 0 || iz < 0 || ix >= this.NX || iz >= this.NZ) return -1;
    return this.cells[l][iz * this.NX + ix];
  }

  roomAt(x, z, l) {
    const r = this.cell(l, Math.floor(x / C), Math.floor(z / C));
    return r >= 0 ? this.rooms[r] : null;
  }

  layerOfY(y) { return y > FH * 0.5 ? 1 : 0; }

  heightAt(x, z, l) {
    const s = this.stairs;
    if (s && x > s.x && x < s.x + s.w && z > s.z && z < s.z + s.d) {
      const t = (z - (s.z + 0.5)) / (s.d - 1.0);
      return Math.min(1, Math.max(0, t)) * FH;
    }
    return l * FH;
  }

  _buildEdges() {
    for (let l = 0; l < 2; l++) {
      for (let k = 0; k <= this.NZ; k++) {
        for (let i = 0; i < this.NX; i++) {
          const a = this.cell(l, i, k - 1), b = this.cell(l, i, k);
          if (a !== b) this.hEdge[l][k * this.NX + i] = { a, b, door: null, window: null };
        }
      }
      for (let iz = 0; iz < this.NZ; iz++) {
        for (let k = 0; k <= this.NX; k++) {
          const a = this.cell(l, k - 1, iz), b = this.cell(l, k, iz);
          if (a !== b) this.vEdge[l][iz * (this.NX + 1) + k] = { a, b, door: null, window: null };
        }
      }
    }
  }

  /** Find the longest shared run of edges between two rooms on some layer. */
  _sharedRun(ra, rb, preferLayer = null) {
    let best = null;
    const layers = preferLayer !== null ? [preferLayer] : [0, 1];
    for (const l of layers) {
      for (let k = 0; k <= this.NZ; k++) {
        let start = -1;
        for (let i = 0; i <= this.NX; i++) {
          const e = i < this.NX ? this.hEdge[l][k * this.NX + i] : null;
          const ok = e && ((e.a === ra.index && e.b === rb.index) || (e.a === rb.index && e.b === ra.index));
          if (ok && start < 0) start = i;
          if (!ok && start >= 0) {
            if (!best || i - start > best.len) best = { l, orient: 'h', k, i0: start, i1: i, len: i - start };
            start = -1;
          }
        }
      }
      for (let k = 0; k <= this.NX; k++) {
        let start = -1;
        for (let iz = 0; iz <= this.NZ; iz++) {
          const e = iz < this.NZ ? this.vEdge[l][iz * (this.NX + 1) + k] : null;
          const ok = e && ((e.a === ra.index && e.b === rb.index) || (e.a === rb.index && e.b === ra.index));
          if (ok && start < 0) start = iz;
          if (!ok && start >= 0) {
            if (!best || iz - start > best.len) best = { l, orient: 'v', k, i0: start, i1: iz, len: iz - start };
            start = -1;
          }
        }
      }
    }
    return best;
  }

  _edge(l, orient, k, i) {
    return orient === 'h' ? this.hEdge[l][k * this.NX + i] : this.vEdge[l][i * (this.NX + 1) + k];
  }

  _placeDoors() {
    let id = 0;
    for (const [aid, bid, opts = {}] of this.def.doors) {
      const ra = this.byId[aid], rb = this.byId[bid];
      if (!ra || !rb) { console.warn('bad door', aid, bid); continue; }
      let layer = null;
      if (ra.type === 'stairs') layer = rb.f; else if (rb.type === 'stairs') layer = ra.f;
      const run = this._sharedRun(ra, rb, layer);
      if (!run) { console.warn('no shared edge', aid, bid); continue; }
      const kind = opts.kind || 'door';
      const wCells = Math.min(Math.round(DOOR_W[kind] / C), Math.max(1, run.len - 2));
      let center = run.i0 + Math.floor(run.len / 2);
      if (run.len >= wCells + 2) center = Math.min(Math.max(center, run.i0 + 1 + Math.ceil(wCells / 2)), run.i1 - 1 - Math.floor(wCells / 2));
      const j0 = center - Math.floor(wCells / 2), j1 = j0 + wCells;
      this._addDoor(id++, kind, run.l, run.orient, run.k, j0, j1, ra, rb, opts);
    }
    // main gate on the exterior wall of the gate room
    const g = this.def.gate, gr = this.byId[g.room];
    const wCells = Math.round(DOOR_W.gate / C);
    const k = Math.round(gr.z / C);
    const j0 = Math.round(g.at / C) - Math.floor(wCells / 2);
    this.gate = this._addDoor(id++, 'gate', 0, 'h', k, j0, j0 + wCells, gr, null, { locked: 'gate' });
  }

  _addDoor(id, kind, l, orient, k, j0, j1, ra, rb, opts) {
    const along0 = j0 * C, along1 = j1 * C, line = k * C;
    const mid = (along0 + along1) / 2;
    const d = {
      id, kind, layer: l, orient, k, j0, j1, a: ra, b: rb, width: along1 - along0, height: DOOR_H[kind],
      locked: opts.locked || null, barricaded: kind === 'vent', open: kind === 'arch', angle: 0, target: 0,
      x: orient === 'h' ? mid : line, z: orient === 'h' ? line : mid, y: l * FH, leaves: [], collider: null,
      lastToggle: 0, hinge: 1,
    };
    for (let j = j0; j < j1; j++) {
      const e = this._edge(l, orient, k, j);
      if (e) e.door = d;
    }
    this.doors.push(d);
    ra.doors.push(d); if (rb) rb.doors.push(d);
    return d;
  }

  /** Mark exterior window openings on rooms that want windows. */
  planWindows() {
    const WIN_CELLS = 3;   // 1.5 m opening
    for (const r of this.rooms) {
      if (!r.windows) continue;
      const l = r.layers[0];
      const sides = [
        { orient: 'h', k: Math.round(r.z / C), from: Math.round(r.x / C), to: Math.round((r.x + r.w) / C), out: -1 },
        { orient: 'h', k: Math.round((r.z + r.d) / C), from: Math.round(r.x / C), to: Math.round((r.x + r.w) / C), out: 1 },
        { orient: 'v', k: Math.round(r.x / C), from: Math.round(r.z / C), to: Math.round((r.z + r.d) / C), out: -1 },
        { orient: 'v', k: Math.round((r.x + r.w) / C), from: Math.round(r.z / C), to: Math.round((r.z + r.d) / C), out: 1 },
      ];
      for (const s of sides) {
        // exterior if the neighbour cell is void
        const probe = s.orient === 'h' ? this.cell(l, s.from, s.out < 0 ? s.k - 1 : s.k) : this.cell(l, s.out < 0 ? s.k - 1 : s.k, s.from);
        if (probe !== -1) continue;
        const len = s.to - s.from;
        const spacing = r.type === 'gallery' ? 6 : 7;   // cells between window centres
        const n = Math.max(1, Math.floor((len - 2) / spacing));
        const startOff = (len - (n - 1) * spacing) / 2;
        for (let w = 0; w < n; w++) {
          const c = Math.round(s.from + startOff + w * spacing);
          const j0 = c - 1, j1 = j0 + WIN_CELLS;
          if (j0 < s.from + 1 || j1 > s.to - 1) continue;
          let clash = false;
          for (let j = j0 - 1; j <= j1; j++) { const e = this._edge(l, s.orient, s.k, j); if (!e || e.door) clash = true; }
          if (clash) continue;
          const win = { room: r, layer: l, orient: s.orient, k: s.k, j0, j1, out: s.out,
            x: s.orient === 'h' ? (j0 + j1) / 2 * C : s.k * C, z: s.orient === 'h' ? s.k * C : (j0 + j1) / 2 * C };
          for (let j = j0; j < j1; j++) this._edge(l, s.orient, s.k, j).window = win;
          r.windows.push(win);
        }
      }
    }
  }

  // ------------------------------------------------------------------------- geometry
  build(scene) {
    this.planWindows();
    const geos = this.rooms.map(() => new Geo());
    const shell = new Geo();   // exterior faces + posts
    const tile = (m) => TILE[m] || 1.5;
    // floors & ceilings
    for (const r of this.rooms) {
      const G = geos[r.index];
      for (const l of r.layers) {
        const y = l * FH;
        const fx0 = r.x, fx1 = r.x + r.w, fz0 = r.z, fz1 = r.z + r.d;
        if (r.type === 'stairs' && l === 1) continue;
        const ft = 1 / tile(r.floor);
        G.quad('floor:' + r.floor, [fx0, y, fz1], [fx1, y, fz1], [fx1, y, fz0], [fx0, y, fz0], [0, 1, 0], (v) => [v[0] * ft, -v[2] * ft]);
        const cy = r.type === 'stairs' ? FH + CEIL : y + CEIL;
        if (r.type === 'stairs' && l === 0) continue;
        const ct = 1 / 2.0;
        G.quad('ceil:plaster', [fx0, cy, fz0], [fx1, cy, fz0], [fx1, cy, fz1], [fx0, cy, fz1], [0, -1, 0], (v) => [v[0] * ct, v[2] * ct]);
      }
      if (r.type === 'stairs') this._buildStairs(G, r);
    }
    // walls
    for (let l = 0; l < 2; l++) {
      this._wallsFor(l, 'h', geos, shell, tile);
      this._wallsFor(l, 'v', geos, shell, tile);
    }
    // meshes
    const matFor = (key) => {
      const [kind, name] = key.split(':');
      if (kind === 'ceil') return pbr('plaster', { color: 0xb9b3a6 });
      if (kind === 'trim') return pbr('wood_dark', { physical: true, clearcoat: 0.3 });
      if (kind === 'crown') return pbr('plaster', { color: 0xd2ccbf });
      if (kind === 'ext') return pbr('brick');
      if (kind === 'wains') return pbr('wood_dark', { physical: true, clearcoat: 0.25 });
      if (kind === 'stair') return pbr('wood_dark', { physical: true, clearcoat: 0.35 });
      if (kind === 'runner') return pbr('velvet_red', { color: 0x9a6060 });
      if (kind === 'rail') return pbr('brass', { envMap: true });
      return pbr(name);
    };
    this.root = new THREE.Group(); this.root.name = 'level';
    for (const r of this.rooms) {
      const g = new THREE.Group(); g.name = 'room:' + r.id;
      for (const m of geos[r.index].meshes(matFor)) g.add(m);
      r.group = g;
      r.bounds = new THREE.Box3(new THREE.Vector3(r.x, r.layers[0] * FH, r.z), new THREE.Vector3(r.x + r.w, (r.layers.at(-1) + 1) * FH, r.z + r.d));
      this.root.add(g);
    }
    this.shellGroup = new THREE.Group();
    for (const m of shell.meshes(matFor)) this.shellGroup.add(m);
    this.root.add(this.shellGroup);
    scene.add(this.root);
    this._buildHash();
    return this.root;
  }

  _roomWallMat(r) { return r ? r.wall : null; }

  /** Walls along every edge line with runs of identical (a,b,door,window) edges. */
  _wallsFor(l, orient, geos, shell, tile) {
    const lines = orient === 'h' ? this.NZ + 1 : this.NX + 1;
    const count = orient === 'h' ? this.NX : this.NZ;
    const y0 = l * FH;
    for (let k = 0; k <= lines - 1; k++) {
      let i = 0;
      while (i < count) {
        const e = this._edge(l, orient, k, i);
        if (!e) { i++; continue; }
        let j = i + 1;
        while (j < count) {
          const f = this._edge(l, orient, k, j);
          if (!f || f.a !== e.a || f.b !== e.b || f.door !== e.door || f.window !== e.window) break;
          j++;
        }
        this._wallRun(l, orient, k, i, j, e, geos, shell, tile, y0);
        i = j;
      }
    }
  }

  _wallRun(l, orient, k, i0, i1, e, geos, shell, tile, y0) {
    const line = k * C, s0 = i0 * C, s1 = i1 * C;
    const ra = e.a >= 0 ? this.rooms[e.a] : null, rb = e.b >= 0 ? this.rooms[e.b] : null;
    // stairwell walls on layer 1 at the bottom edge / layer 0 at the top edge are normal walls; skip duplicate stair-stair
    const sides = [
      { r: ra, n: -1 },   // face toward lower coordinate side (room a)
      { r: rb, n: 1 },
    ];
    const opening = e.door ? { h: e.door.height, kind: e.door.kind } : e.window ? { h: 2.7, sill: 0.8, kind: 'window' } : null;
    for (const sd of sides) {
      const G = sd.r ? geos[sd.r.index] : shell;
      const w = sd.n < 0 ? line - WT : line + WT;           // face plane coordinate
      const fullH = !sd.r ? FH : (sd.r.type === 'stairs' ? FH : CEIL);
      const matKey = sd.r ? 'wall:' + sd.r.wall : 'ext:brick';
      const tl = sd.r ? tile(sd.r.wall) : 2.5;
      const wains = sd.r && !NO_WAINSCOT.has(sd.r.type) && sd.r.type !== 'stairs';
      const bands = [];   // [yA, yB] vertical bands with their material
      if (!opening) {
        bands.push([0, fullH]);
      } else if (opening.kind === 'window') {
        bands.push([0, opening.sill], [opening.h, fullH]);
      } else {
        bands.push([opening.h, fullH]);
      }
      for (const [ya, yb] of bands) {
        let lo = ya;
        if (wains && ya < 1.0 && yb > 0) {
          const top = Math.min(1.0, yb);
          this._face(G, 'wains:wood_dark', orient, w + (sd.n < 0 ? -0.012 : 0.012), s0, s1, y0 + ya, y0 + top, sd.n, 1.2);
          lo = top;
        }
        if (yb > lo) this._face(G, matKey, orient, w, s0, s1, y0 + lo, y0 + yb, sd.n, tl);
      }
      if (sd.r) {
        const inward = sd.n < 0 ? -1 : 1;   // towards the room on this side
        // baseboard, chair rail, crown - only on solid spans (not across door/window openings at those heights)
        const spans = [[s0, s1]];
        if (!opening || opening.kind === 'window') {
          this._strip(G, 'trim:wood', orient, w, inward, spans, y0, y0 + 0.18, 0.022);
          if (wains) this._strip(G, 'trim:wood', orient, w, inward, spans, y0 + 0.97, y0 + 1.03, 0.035);
        }
        if (sd.r.type !== 'stairs') this._strip(G, 'crown:plaster', orient, w, inward, spans, y0 + fullH - 0.14, y0 + fullH, 0.07);
        // opening reveals: jamb faces (wall thickness) + casing trim
        if (opening) this._reveal(G, orient, line, s0, s1, y0, opening, inward, sd.n, wains);
      }
    }
    // soffit / sill cap across the wall thickness (shared shell: stays visible whichever side is culled)
    if (opening) {
      const G = shell;
      const top = y0 + opening.h;
      if (orient === 'h') G.box('crown:plaster', s0, top, line - WT, s1, top + 0.02, line + WT, 1, { '+y': 1 });
      else G.box('crown:plaster', line - WT, top, s0, line + WT, top + 0.02, s1, 1, { '+y': 1 });
      if (opening.kind === 'window') {
        const sy = y0 + opening.sill;
        if (orient === 'h') G.box('trim:wood', s0 - 0.05, sy - 0.04, line - WT - 0.06, s1 + 0.05, sy, line + WT + 0.02, 1);
        else G.box('trim:wood', line - WT - 0.06, sy - 0.04, s0 - 0.05, line + WT + 0.02, sy, s1 + 0.05, 1);
      }
    }
    // end posts close T-junction gaps
    const G = shell;
    const pH = FH;
    for (const s of [s0, s1]) {
      if (orient === 'h') G.box('crown:plaster', s - WT, y0, line - WT, s + WT, y0 + pH, line + WT, 1, { '-y': 1 });
      else G.box('crown:plaster', line - WT, y0, s - WT, line + WT, y0 + pH, s + WT, 1, { '-y': 1 });
    }
  }

  _face(G, key, orient, w, s0, s1, ya, yb, n, tile) {
    const T = 1 / tile;
    if (orient === 'h') {
      if (n < 0) G.quad(key, [s1, ya, w], [s0, ya, w], [s0, yb, w], [s1, yb, w], [0, 0, -1], (v) => [-v[0] * T, v[1] * T]);
      else G.quad(key, [s0, ya, w], [s1, ya, w], [s1, yb, w], [s0, yb, w], [0, 0, 1], (v) => [v[0] * T, v[1] * T]);
    } else {
      if (n < 0) G.quad(key, [w, ya, s0], [w, ya, s1], [w, yb, s1], [w, yb, s0], [-1, 0, 0], (v) => [v[2] * T, v[1] * T]);
      else G.quad(key, [w, ya, s1], [w, ya, s0], [w, yb, s0], [w, yb, s1], [1, 0, 0], (v) => [-v[2] * T, v[1] * T]);
    }
  }

  _strip(G, key, orient, w, inward, spans, ya, yb, depth) {
    for (const [a, b] of spans) {
      const d0 = inward < 0 ? w - depth : w, d1 = inward < 0 ? w : w + depth;
      if (orient === 'h') G.box(key, a, ya, d0, b, yb, d1, 1);
      else G.box(key, d0, ya, a, d1, yb, b, 1);
    }
  }

  _reveal(G, orient, line, s0, s1, y0, op, inward, n, wains) {
    const top = y0 + op.h, bot = y0 + (op.kind === 'window' ? op.sill : 0);
    // jamb faces at the ends of the opening (perpendicular to the wall), half-thickness per side
    const d0 = n < 0 ? line - WT : line, d1 = n < 0 ? line : line + WT;
    if (orient === 'h') {
      G.quad('crown:plaster', [s0, bot, d0], [s0, bot, d1], [s0, top, d1], [s0, top, d0], [1, 0, 0], (v) => [v[2], v[1]]);
      G.quad('crown:plaster', [s1, bot, d1], [s1, bot, d0], [s1, top, d0], [s1, top, d1], [-1, 0, 0], (v) => [v[2], v[1]]);
    } else {
      G.quad('crown:plaster', [d1, bot, s0], [d0, bot, s0], [d0, top, s0], [d1, top, s0], [0, 0, 1], (v) => [v[0], v[1]]);
      G.quad('crown:plaster', [d0, bot, s1], [d1, bot, s1], [d1, top, s1], [d0, top, s1], [0, 0, -1], (v) => [v[0], v[1]]);
    }
    if (op.kind === 'vent') return;
    // casing trim around the opening on this face
    const cw = 0.09, cd = 0.025;
    const f0 = inward < 0 ? line - WT - cd : line + WT, f1 = inward < 0 ? line - WT : line + WT + cd;
    const pieces = [[s0 - cw, bot, s0, top + cw], [s1, bot, s1 + cw, top + cw], [s0 - cw, top, s1 + cw, top + cw]];
    for (const [a, ya, b, yb] of pieces) {
      if (orient === 'h') G.box('trim:wood', a, ya, f0, b, yb, f1, 1);
      else G.box('trim:wood', f0, ya, a, f1, yb, b, 1);
    }
  }

  _buildStairs(G, r) {
    const steps = 20;
    const run = (r.d - 1.0) / steps, rise = FH / steps;
    const x0 = r.x + WT, x1 = r.x + r.w - WT;
    for (let s = 0; s < steps; s++) {
      const z0 = r.z + 0.5 + s * run, z1 = z0 + run + 0.02;
      const top = (s + 1) * rise;
      G.box('stair:wood', x0, 0, z0, x1, top, z1, 1.2, { '-y': 1 });
      // nosing
      G.box('stair:wood', x0, top - 0.035, z0 - 0.03, x1, top, z0, 1.2);
      // carpet runner
      G.box('runner:velvet', x0 + 0.55, top, z0 + 0.02, x1 - 0.55, top + 0.012, z1 - 0.02, 0.8, { '-y': 1 });
    }
    // top landing slab
    G.box('stair:wood', x0, FH - 0.2, r.z + r.d - 0.5, x1, FH, r.z + r.d, 1.2);
    // handrails along both side walls
    for (const x of [x0 + 0.06, x1 - 0.06]) {
      const zA = r.z + 0.5, zB = r.z + r.d - 0.5;
      const N = 16;
      for (let i = 0; i < N; i++) {
        const za = zA + (zB - zA) * i / N, zb = zA + (zB - zA) * (i + 1) / N;
        const ya = (za - zA) / (zB - zA) * FH + 0.95, yb = (zb - zA) / (zB - zA) * FH + 0.95;
        G.box('rail:brass', x - 0.025, Math.min(ya, yb) - 0.02, za, x + 0.025, Math.max(ya, yb) + 0.02, zb, 1);
      }
    }
  }

  // ------------------------------------------------------------------------- collision
  _buildHash() {
    // static wall colliders from edges (solid everywhere except door openings, which get lintels)
    for (let l = 0; l < 2; l++) {
      const y0 = l * FH;
      for (const orient of ['h', 'v']) {
        const lines = orient === 'h' ? this.NZ + 1 : this.NX + 1;
        const count = orient === 'h' ? this.NX : this.NZ;
        for (let k = 0; k < lines; k++) {
          let i = 0;
          while (i < count) {
            const e = this._edge(l, orient, k, i);
            if (!e) { i++; continue; }
            let j = i + 1;
            while (j < count) { const f = this._edge(l, orient, k, j); if (!f || (!!f.door) !== (!!e.door) || f.door !== e.door) break; j++; }
            const line = k * C, s0 = i * C, s1 = j * C;
            const yb = e.door ? y0 + e.door.height : y0;
            const box = orient === 'h'
              ? { x0: s0 - 0.02, z0: line - WT, x1: s1 + 0.02, z1: line + WT, y0: yb, y1: y0 + FH, wall: true }
              : { x0: line - WT, z0: s0 - 0.02, x1: line + WT, z1: s1 + 0.02, y0: yb, y1: y0 + FH, wall: true };
            this.addCollider(box);
            i = j;
          }
        }
      }
    }
  }

  addCollider(b) {
    b.id = this.colliders.length;
    b.enabled = b.enabled ?? true;
    this.colliders.push(b);
    const gx0 = Math.floor(b.x0 / 2), gx1 = Math.floor(b.x1 / 2), gz0 = Math.floor(b.z0 / 2), gz1 = Math.floor(b.z1 / 2);
    for (let gx = gx0; gx <= gx1; gx++) for (let gz = gz0; gz <= gz1; gz++) {
      const key = gx * 1000 + gz;
      let a = this.hash.get(key);
      if (!a) { a = []; this.hash.set(key, a); }
      a.push(b);
    }
    return b;
  }

  query(x, z, r) {
    const out = [];
    const seen = this._seen || (this._seen = new Set());
    seen.clear();
    for (let gx = Math.floor((x - r) / 2); gx <= Math.floor((x + r) / 2); gx++) {
      for (let gz = Math.floor((z - r) / 2); gz <= Math.floor((z + r) / 2); gz++) {
        const a = this.hash.get(gx * 1000 + gz);
        if (!a) continue;
        for (const b of a) if (b.enabled && !seen.has(b.id)) { seen.add(b.id); out.push(b); }
      }
    }
    return out;
  }

  /** Push a vertical cylinder (x,z,radius, y range) out of all overlapping colliders. Returns corrected pos. */
  collide(pos, radius, yLo, yHi) {
    for (let iter = 0; iter < 3; iter++) {
      let moved = false;
      for (const b of this.query(pos.x, pos.z, radius + 0.5)) {
        if (yHi <= b.y0 || yLo >= b.y1) continue;
        const cx = Math.max(b.x0, Math.min(pos.x, b.x1));
        const cz = Math.max(b.z0, Math.min(pos.z, b.z1));
        let dx = pos.x - cx, dz = pos.z - cz;
        const d2 = dx * dx + dz * dz;
        if (d2 >= radius * radius) continue;
        if (d2 > 1e-8) {
          const d = Math.sqrt(d2), push = radius - d;
          pos.x += dx / d * push; pos.z += dz / d * push;
        } else {
          // centre inside the box: push out along the shallowest axis
          const px = Math.min(pos.x - b.x0, b.x1 - pos.x), pz = Math.min(pos.z - b.z0, b.z1 - pos.z);
          if (px < pz) pos.x += (pos.x - b.x0 < b.x1 - pos.x ? -(px + radius) : px + radius);
          else pos.z += (pos.z - b.z0 < b.z1 - pos.z ? -(pz + radius) : pz + radius);
        }
        moved = true;
      }
      if (!moved) break;
    }
    return pos;
  }

  // ------------------------------------------------------------------------- navigation
  buildNav() {
    const N = this.NX * this.NZ;
    this.walk = [0, 1].map(() => new Uint8Array(N));
    for (let l = 0; l < 2; l++) {
      for (let iz = 0; iz < this.NZ; iz++) for (let ix = 0; ix < this.NX; ix++) {
        const r = this.cells[l][iz * this.NX + ix];
        if (r < 0) continue;
        const x = (ix + 0.5) * C, z = (iz + 0.5) * C;
        const y = this.heightAt(x, z, l);
        let blocked = false;
        for (const b of this.query(x, z, 0.3)) {
          if (b.wall || b.door) continue;
          if (y + 1.0 <= b.y0 || y + 0.2 >= b.y1) continue;
          if (x > b.x0 - 0.22 && x < b.x1 + 0.22 && z > b.z0 - 0.22 && z < b.z1 + 0.22) { blocked = true; break; }
        }
        this.walk[l][iz * this.NX + ix] = blocked ? 0 : 1;
      }
    }
  }

  /** Can an agent step from cell (ix,iz) to neighbour (nx,nz) on layer l? ghosts may pass closed (unlocked) doors. */
  passable(l, ix, iz, nx, nz, ghost = true) {
    if (nx < 0 || nz < 0 || nx >= this.NX || nz >= this.NZ) return false;
    if (!this.walk[l][nz * this.NX + nx]) return false;
    const blocks = (e) => {
      if (!e) return false;
      if (!e.door) return true;
      const d = e.door;
      if (d.kind === 'vent') return ghost === 'vent' ? d.barricaded : (ghost ? true : d.barricaded);   // only crawlers use open vents
      if (d.kind === 'gate') return true;
      if (d.locked && d.locked !== 'open') return true;
      return !d.open && !ghost;
    };
    if (nx !== ix && nz !== iz) {
      // diagonal: both orthogonal neighbours must be passable
      return this.passable(l, ix, iz, nx, iz, ghost) && this.passable(l, ix, iz, ix, nz, ghost)
        && this.passable(l, nx, iz, nx, nz, ghost) && this.passable(l, ix, nz, nx, nz, ghost);
    }
    if (nx !== ix) return !blocks(this.vEdge[l][iz * (this.NX + 1) + Math.max(ix, nx)]);
    return !blocks(this.hEdge[l][Math.max(iz, nz) * this.NX + ix]);
  }

  /** A* over (layer, cell). Returns world waypoints [{x,y,z,l}] (smoothed) or null. */
  findPath(from, to, ghost = true, maxIter = 12000) {
    const NX = this.NX, N = this.NX * this.NZ;
    const sx = Math.floor(from.x / C), sz = Math.floor(from.z / C), sl = from.l;
    const tx = Math.floor(to.x / C), tz = Math.floor(to.z / C), tl = to.l;
    if (sx < 0 || sz < 0 || sx >= NX || sz >= this.NZ || tx < 0 || tz < 0 || tx >= NX || tz >= this.NZ) return null;
    const S = sl * N + sz * NX + sx, T = tl * N + tz * NX + tx;
    const g = this._g || (this._g = new Float32Array(2 * N));
    const came = this._came || (this._came = new Int32Array(2 * N));
    const stamp = this._stamp || (this._stamp = new Uint32Array(2 * N));
    const closed = this._closed || (this._closed = new Uint32Array(2 * N));
    this._gen = (this._gen || 0) + 1;
    const gen = this._gen;
    const heap = [];
    const h = (id) => {
      const l = (id / N) | 0, rem = id % N, iz = (rem / NX) | 0, ix = rem % NX;
      let d = Math.hypot(ix - tx, iz - tz);
      if (l !== tl) d += 16;
      return d;
    };
    const push = (id, f) => {
      heap.push([f, id]);
      let i = heap.length - 1;
      while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; }
    };
    const pop = () => {
      const top = heap[0], last = heap.pop();
      if (heap.length) {
        heap[0] = last; let i = 0;
        for (;;) { const l = 2 * i + 1, r = l + 1; let m = i;
          if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
          if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; }
      }
      return top;
    };
    stamp[S] = gen; g[S] = 0; came[S] = -1;
    push(S, h(S));
    let iter = 0, found = false;
    const stair = this.stairs;
    while (heap.length && iter++ < maxIter) {
      const [, cur] = pop();
      if (closed[cur] === gen) continue;
      closed[cur] = gen;
      if (cur === T) { found = true; break; }
      const l = (cur / N) | 0, rem = cur % N, iz = (rem / NX) | 0, ix = rem % NX;
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dz) continue;
        const nx = ix + dx, nz = iz + dz;
        if (!this.passable(l, ix, iz, nx, nz, ghost)) continue;
        const nid = l * N + nz * NX + nx;
        const cost = g[cur] + (dx && dz ? 1.414 : 1);
        if (stamp[nid] !== gen || cost < g[nid]) { stamp[nid] = gen; g[nid] = cost; came[nid] = cur; push(nid, cost + h(nid)); }
      }
      // vertical link inside the stairwell
      const r = this.cells[l][rem];
      if (stair && r === stair.index) {
        const nid = (1 - l) * N + rem;
        const cost = g[cur] + 0.1;
        if (stamp[nid] !== gen || cost < g[nid]) { stamp[nid] = gen; g[nid] = cost; came[nid] = cur; push(nid, cost + h(nid)); }
      }
    }
    if (!found) return null;
    const cells = [];
    for (let c = T; c !== -1; c = came[c]) cells.push(c);
    cells.reverse();
    const pts = cells.map((id) => {
      const l = (id / N) | 0, rem = id % N, iz = (rem / NX) | 0, ix = rem % NX;
      const x = (ix + 0.5) * C, z = (iz + 0.5) * C;
      return { x, z, l, y: this.heightAt(x, z, l) };
    });
    return this.smooth(pts, ghost);
  }

  /** String-pull: drop waypoints that have a clear straight walk between neighbours (same layer). */
  smooth(pts, ghost) {
    if (pts.length < 3) return pts;
    const out = [pts[0]];
    let anchor = 0;
    for (let i = 2; i < pts.length; i++) {
      const a = pts[anchor], b = pts[i];
      if (a.l !== b.l || !this.walkLine(a, b, ghost)) {
        out.push(pts[i - 1]);
        anchor = i - 1;
      }
    }
    out.push(pts[pts.length - 1]);
    return out;
  }

  walkLine(a, b, ghost) {
    const dist = Math.hypot(b.x - a.x, b.z - a.z);
    const n = Math.ceil(dist / (C * 0.5));
    let px = Math.floor(a.x / C), pz = Math.floor(a.z / C);
    for (let i = 1; i <= n; i++) {
      const t = i / n;
      const x = a.x + (b.x - a.x) * t, z = a.z + (b.z - a.z) * t;
      const cx = Math.floor(x / C), cz = Math.floor(z / C);
      if (cx !== px || cz !== pz) {
        if (!this.passable(a.l, px, pz, cx, cz, ghost)) return false;
        px = cx; pz = cz;
      }
    }
    return true;
  }

  /** Line of sight between two points (eye heights). Walls, closed doors and window glass block. */
  los(a, b) {
    const la = this.layerOfY(a.y), lb = this.layerOfY(b.y);
    const s = this.stairs;
    const inStair = (p) => s && p.x > s.x && p.x < s.x + s.w && p.z > s.z && p.z < s.z + s.d;
    if (la !== lb && !(inStair(a) || inStair(b))) return false;
    const l = inStair(a) ? lb : la;
    const dist = Math.hypot(b.x - a.x, b.z - a.z);
    const n = Math.ceil(dist / (C * 0.5));
    let px = Math.floor(a.x / C), pz = Math.floor(a.z / C);
    for (let i = 1; i <= n; i++) {
      const t = i / n;
      const x = a.x + (b.x - a.x) * t, z = a.z + (b.z - a.z) * t;
      const cx = Math.floor(x / C), cz = Math.floor(z / C);
      if (cx !== px || cz !== pz) {
        const steps = [];
        if (cx !== px) steps.push([cx, pz]);
        if (cz !== pz) steps.push([cx, cz]);
        let ox = px, oz = pz;
        for (const [sx, sz] of steps) {
          let e = null;
          if (sx !== ox) e = this.vEdge[l][oz * (this.NX + 1) + Math.max(ox, sx)];
          else if (sz !== oz) e = this.hEdge[l][Math.max(oz, sz) * this.NX + ox];
          if (e) {
            if (!e.door) return false;
            const d = e.door;
            if (d.kind === 'vent') { if (Math.min(a.y, b.y) - l * FH > 0.9) return false; }
            else if (!d.open && d.kind !== 'arch') return false;
          }
          ox = sx; oz = sz;
        }
        px = cx; pz = cz;
      }
    }
    return true;
  }

  randomPoint(rng, room, layer = null) {
    for (let t = 0; t < 40; t++) {
      const x = room.x + 0.6 + rng.next() * (room.w - 1.2), z = room.z + 0.6 + rng.next() * (room.d - 1.2);
      const l = layer ?? room.layers[0];
      const ix = Math.floor(x / C), iz = Math.floor(z / C);
      if (this.walk && this.walk[l][iz * this.NX + ix]) return { x, z, l, y: this.heightAt(x, z, l) };
    }
    return { x: room.cx, z: room.cz, l: room.layers[0], y: this.heightAt(room.cx, room.cz, room.layers[0]) };
  }
}
