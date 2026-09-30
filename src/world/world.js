// World: assembles the level, furniture, doors, windows, weather, lights and items for a map + seed.
// Everything here is deterministic for a given seed so every peer builds the identical house.
import * as THREE from 'three';
import { Level, FH, CEIL, WT, C } from './level.js';
import { Furnisher, RECIPES } from './furnish.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { pbr, cloneProp, applyLibrary, libMaterial, emissive, assets } from '../core/assets.js';
import { quality } from '../core/settings.js';
import { RNG } from '../core/util.js';
import { ITEMS, NOTES } from '../game/items.js';

const UP = new THREE.Vector3(0, 1, 0);
const tmpV = new THREE.Vector3();

// ============================================================================ window glass (rain on the far side)
export function makeRainGlass() {
  return new THREE.ShaderMaterial({
    name: 'RainGlass',
    transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: true,
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
      uTime: { value: 0 }, uFlash: { value: 0 }, uHaze: { value: new THREE.Color(0x1a2330) },
    }]),
    vertexShader: /* glsl */`
      #include <fog_pars_vertex>
      varying vec2 vUv; varying vec3 vW;
      void main() {
        vUv = uv;
        vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz;
        vec4 mvPosition = viewMatrix * w;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */`
      #include <fog_pars_fragment>
      uniform float uTime, uFlash; uniform vec3 uHaze;
      varying vec2 vUv; varying vec3 vW;
      float h1(float n) { return fract(sin(n) * 43758.5453); }
      float h2(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
      // one layer of running drops: returns (mask, trail)
      vec2 drops(vec2 uv, float t, float scale) {
        vec2 g = uv * vec2(scale, scale * 0.45);
        vec2 id = floor(g);
        float n = h2(id + scale);
        g.y += t * (0.35 + n * 0.5) + n * 7.0;
        id = floor(g);
        vec2 f = fract(g) - 0.5;
        float r = h2(id * 1.31 + scale);
        float x = (r - 0.5) * 0.7 + sin(g.y * 3.0 + r * 6.0) * 0.08;
        vec2 d = vec2((f.x - x) * 2.2, f.y + 0.2);
        float drop = smoothstep(0.1, 0.0, length(d * vec2(1.0, 1.35)));
        float trail = smoothstep(0.05, 0.0, abs(f.x - x)) * smoothstep(-0.2, 0.5, f.y) * step(0.35, r);
        return vec2(drop * step(0.2, r), trail * 0.35);
      }
      void main() {
        vec2 uv = vW.xz * 0.0 + vec2(vUv.x * 1.4, vUv.y * 2.0);
        vec2 a = drops(uv, uTime, 9.0);
        vec2 b = drops(uv * 1.7 + 3.1, uTime * 1.2, 14.0);
        vec2 bg = uv * 34.0; vec2 bc = fract(bg) - 0.5; float bh = h2(floor(bg));
        float stat = step(0.82, bh) * smoothstep(0.2, 0.05, length(bc + (vec2(h2(floor(bg) + 3.1), h2(floor(bg) + 7.7)) - 0.5) * 0.5)) * 0.5;   // round condensation beads
        float wet = clamp(a.x + b.x * 0.7 + stat, 0.0, 1.0);
        float trail = a.y + b.y;
        // misty glass: haze + fogging near the frame edges
        float edge = smoothstep(0.0, 0.12, vUv.x) * smoothstep(1.0, 0.88, vUv.x) * smoothstep(0.0, 0.1, vUv.y) * smoothstep(1.0, 0.9, vUv.y);
        vec3 col = uHaze * (0.9 + uFlash * 6.0);
        col += vec3(0.55, 0.62, 0.7) * wet * (0.18 + uFlash * 2.0);
        col += vec3(0.25, 0.3, 0.36) * trail * (0.2 + uFlash);
        float alpha = mix(0.55, 0.32, edge) + wet * 0.25 + trail * 0.1;
        gl_FragColor = vec4(col, clamp(alpha, 0.0, 0.85));
        #include <fog_fragment>
      }`,
  });
}

// ============================================================================ rain particles (outside only)
function makeRain(W, D, count) {
  const g = new THREE.BufferGeometry();
  const pos = new Float32Array(count * 2 * 3);
  const seed = new Float32Array(count * 2 * 4);
  for (let i = 0; i < count; i++) {
    const x = Math.random(), y = Math.random(), z = Math.random(), s = 0.75 + Math.random() * 0.5;
    for (let k = 0; k < 2; k++) {
      pos.set([0, k, 0], (i * 2 + k) * 3);
      seed.set([x, y, z, s], (i * 2 + k) * 4);
    }
  }
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('seed', new THREE.BufferAttribute(seed, 4));
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
  const m = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, fog: true,
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
      uTime: { value: 0 }, uCam: { value: new THREE.Vector3() }, uHouse: { value: new THREE.Vector4(0, 0, W, D) },
      uRoof: { value: FH * 2 + 0.5 }, uFlash: { value: 0 },
    }]),
    vertexShader: /* glsl */`
      #include <fog_pars_vertex>
      attribute vec4 seed; uniform float uTime; uniform vec3 uCam; uniform vec4 uHouse; uniform float uRoof;
      varying float vA;
      void main() {
        vec3 box = vec3(36.0, 22.0, 36.0);
        vec3 p = seed.xyz * box;
        p.y -= uTime * 9.5 * seed.w;
        p.x += uTime * 1.2;
        p = mod(p - uCam + box * 0.5, box) + uCam - box * 0.5;
        p.xz += vec2(0.06, 0.0) * position.y;
        p.y += position.y * 0.42;
        bool inside = p.x > uHouse.x - 0.3 && p.x < uHouse.z + 0.3 && p.z > uHouse.y - 0.3 && p.z < uHouse.w + 0.3 && p.y < uRoof;
        vA = inside || p.y < -0.05 ? 0.0 : (0.22 + 0.18 * position.y);
        vec4 mvPosition = viewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */`
      #include <fog_pars_fragment>
      uniform float uFlash; varying float vA;
      void main() { if (vA < 0.01) discard; gl_FragColor = vec4(vec3(0.55, 0.6, 0.68) * (1.0 + uFlash * 4.0), vA);
        #include <fog_fragment>
      }`,
  });
  const mesh = new THREE.LineSegments(g, m);
  mesh.frustumCulled = false;
  mesh.renderOrder = 3;
  return mesh;
}

// ============================================================================ light pool
// A fixed number of real point lights is assigned every few frames to the most relevant light sources near the
// camera. The shader light count never changes (no recompiles) and far-away rooms cost nothing.
class LightPool {
  constructor(scene, n) {
    this.slots = [];
    for (let i = 0; i < n; i++) {
      const l = new THREE.PointLight(0xffffff, 0, 8, 2);
      l.castShadow = false;
      scene.add(l);
      this.slots.push({ light: l, src: null, level: 0 });
    }
    this.timer = 0;
  }
}

// ============================================================================ world
export class World {
  constructor(game) {
    this.game = game;
    this.scene = game.scene;
    this.items = [];
    this.interactables = [];
    this.power = true;
    this.powerFlicker = 0;
    this.time = 0;
    this.lightningT = 8 + Math.random() * 10;
    this.flash = 0;
    this.dyn = [];      // animated props (clocks, curtains)
  }

  async build(def, seed, progress = () => {}) {
    const scene = this.scene;
    this.def = def;
    this.seed = seed;
    const L = this.level = new Level(def);
    L.build(scene);
    progress(0.1, 'Raising the walls…');

    const rng = new RNG(seed);
    const F = this.F = new Furnisher(L, rng);
    F.rugMat = pbr('rug_persian');
    F.runnerMat = pbr('rug_persian', { color: 0xb07a6a });
    F.cordMat = new THREE.MeshStandardMaterial({ color: 0x151210, roughness: 0.6, metalness: 0.2 });
    F.bulbMat = libMaterial('M_bulb');
    this.rainGlass = makeRainGlass();

    for (const r of L.rooms) {
      r._sides = {};
      for (const l of r.layers) r._sides[l] = F.sides(r, l);
    }
    let n = 0;
    for (const r of L.rooms) {
      const fn = RECIPES[r.type];
      if (fn) { try { fn(F, r, r.layers[0]); } catch (e) { console.warn('recipe failed', r.id, e); } }
      F.windows(r, this.rainGlass);
      if (++n % 6 === 0) { progress(0.1 + 0.35 * n / L.rooms.length, 'Furnishing ' + r.name + '…'); await new Promise((res) => setTimeout(res, 0)); }
    }
    this._collectDynamic();
    this.doorGroup = new THREE.Group(); this.doorGroup.name = 'doors';
    scene.add(this.doorGroup);
    for (const d of L.doors) this._buildDoor(d);
    progress(0.5, 'Hanging the doors…');
    for (const r of L.rooms) F.mergeRoom(r);
    L.buildNav();
    progress(0.6, 'Laying the grounds…');
    this._buildOutside(rng);
    this.rain = makeRain(L.W, L.D, quality().rainDrops);
    scene.add(this.rain);
    this.pool = new LightPool(scene, quality().lightPool);
    this.lights = L.rooms.flatMap((r) => r.lights);
    this._placeItems(rng);
    this._registerInteractables();
    progress(0.7, 'Hiding the keys…');
    return this;
  }

  // ------------------------------------------------------------------------ misc dynamic props
  _collectDynamic() {
    for (const r of this.level.rooms) {
      if (r.clock) this.dyn.push({ kind: 'clock', ...r.clock, t: Math.random() * 10 });
      for (const c of r.group.children) {
        if (c.name === 'Curtain') this.dyn.push({ kind: 'curtain', obj: c, ph: Math.random() * 6, base: c.rotation.x });
      }
    }
  }

  // ------------------------------------------------------------------------ doors
  _buildDoor(d) {
    const g = new THREE.Group();
    g.position.set(d.x, d.y, d.z);
    if (d.orient === 'v') g.rotation.y = -Math.PI / 2;
    d.group = g;
    d.leaves = [];
    const w = d.width;
    const mkLeaf = (name, hingeX, dir, width, srcW, scaleY = 1) => {
      const pivot = new THREE.Group();
      pivot.position.x = hingeX;
      const leaf = cloneProp('furniture', name);
      applyLibrary(leaf);
      if (name === 'DoorLeaf') {
        // the exported spindle is mirrored across the hinge; fold it back onto the handle side
        leaf.traverse((o) => {
          if (!o.isMesh || !/dlhw/.test(o.name)) return;
          const geo = o.geometry.clone(); const pa = geo.attributes.position;
          for (let i = 0; i < pa.count; i++) if (pa.getX(i) < -0.4) pa.setX(i, -pa.getX(i));
          pa.needsUpdate = true; geo.computeBoundingSphere(); o.geometry = geo;
        });
      }
      leaf.scale.set(width / srcW, scaleY, 1);
      if (dir < 0) leaf.rotation.y = Math.PI;
      pivot.add(leaf);
      g.add(pivot);
      d.leaves.push({ pivot, dir });
    };
    if (d.kind === 'door') mkLeaf('DoorLeaf', -w / 2 + 0.02, 1, w - 0.05, 0.95);
    else if (d.kind === 'double') { mkLeaf('DoorLeaf', -w / 2 + 0.02, 1, w / 2 - 0.03, 0.95, 1.1); mkLeaf('DoorLeaf', w / 2 - 0.02, -1, w / 2 - 0.03, 0.95, 1.1); }
    else if (d.kind === 'gate') {
      mkLeaf('GateDoor', -w / 2 + 0.02, 1, w / 2 - 0.03, 1.15, 1.03);
      mkLeaf('GateDoor', w / 2 - 0.02, -1, w / 2 - 0.03, 1.15, 1.03);
      // three padlocks on a chain across the two leaves
      d.padlocks = {};
      const cols = { brass: 0xd8b060, iron: 0x777a80, silver: 0xe0e4ea };
      ['brass', 'iron', 'silver'].forEach((k, i) => {
        const p = cloneProp('furniture', 'Padlock'); applyLibrary(p);
        p.scale.setScalar(1.6);
        p.position.set(-0.22 + i * 0.22, 1.05 + (i === 1 ? 0.08 : 0), 0.13);
        p.traverse((o) => { if (o.isMesh && o.material.name === 'lib_brass') { o.material = o.material.clone(); o.material.color.setHex(cols[k]); } });
        g.add(p);
        d.padlocks[k] = p;
      });
      const chain = cloneProp('furniture', 'ChainDrape'); applyLibrary(chain);
      chain.position.set(0, 0.0, 0.1); g.add(chain);
      d.chain = chain;
    } else if (d.kind === 'vent') {
      // boards go on the side facing away from the locked / key room
      const aIsSecret = !!(d.a.keyRoom || d.a.doors.some((x) => x.locked === 'inside'));
      const boardSide = (aIsSecret ? 1 : -1) * (d.orient === 'h' ? 1 : -1); // local z sign
      const grate = cloneProp('furniture', 'VentGrate'); applyLibrary(grate);
      grate.position.z = -boardSide * (WT + 0.025);
      g.add(grate);
      d.grate = grate;
      const boards = cloneProp('furniture', 'VentBoards'); applyLibrary(boards);
      boards.position.z = boardSide * (WT + 0.02);
      if (boardSide < 0) boards.rotation.y = Math.PI;
      g.add(boards);
      d.boards = boards;
      d.boardSide = boardSide;
    }
    g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    this.doorGroup.add(g);
    // closed-door collider across the opening
    if (d.kind !== 'arch') {
      const h = d.kind === 'vent' ? 0.9 : d.height;
      const t = WT + 0.02;
      const box = d.orient === 'h'
        ? { x0: d.x - w / 2, x1: d.x + w / 2, z0: d.z - t, z1: d.z + t, y0: d.y, y1: d.y + h }
        : { x0: d.x - t, x1: d.x + t, z0: d.z - w / 2, z1: d.z + w / 2, y0: d.y, y1: d.y + h };
      box.door = d;
      d.collider = this.level.addCollider(box);
      if (d.kind === 'vent') d.collider.enabled = d.barricaded;
    }
    d.angle = 0; d.target = 0; d.swing = 1; d.slamT = 0;
    if (d.kind === 'arch') d.open = true;
  }

  /** Local z-side (+1/-1) of a world position relative to a door's plane. */
  doorSide(d, p) {
    return d.orient === 'h' ? Math.sign(p.z - d.z) || 1 : Math.sign(-(p.x - d.x)) || 1;
  }

  /** Which room a position on a given side of the door belongs to. */
  roomOnSide(d, side) {
    // side is the local z sign; local -z == room a for 'h', == room b for 'v'
    const aSide = d.orient === 'h' ? -1 : 1;
    return side === aSide ? d.a : d.b;
  }

  setDoor(d, open, fromPos = null, fast = false) {
    if (d.kind === 'arch' || d.kind === 'vent') return;
    if (open && fromPos) d.swing = this.doorSide(d, fromPos);
    d.target = open ? (d.kind === 'gate' ? 1.9 : 1.72) : 0;
    d.speed = fast ? 9 : 2.6;
    if (open) { d.open = true; if (d.collider) d.collider.enabled = false; }
    d.lastToggle = this.time;
  }

  _updateDoors(dt) {
    for (const d of this.level.doors) {
      if (!d.leaves.length) continue;
      if (Math.abs(d.angle - d.target) > 0.0005) {
        const sp = (d.speed || 2.6) * dt;
        const prev = d.angle;
        d.angle += Math.sign(d.target - d.angle) * Math.min(Math.abs(d.target - d.angle), sp * (0.35 + Math.abs(d.target - d.angle)));
        if (d.target === 0 && d.angle < 0.02) {
          d.angle = 0; d.open = false;
          if (d.collider && !d.locked) d.collider.enabled = true;
          if (prev > 0.02) this.game.sfx(d.speed > 5 ? 'door_slam' : 'door_close', { x: d.x, y: d.y + 1.2, z: d.z });
        }
        for (const lf of d.leaves) lf.pivot.rotation.y = lf.dir * d.swing * d.angle;
      }
    }
  }

  breakVent(d) {
    if (!d.barricaded) return;
    d.barricaded = false;
    if (d.collider) d.collider.enabled = false;
    if (d.boards) {
      // splinter: boards fall and rotate away
      const b = d.boards;
      this.dyn.push({ kind: 'fall', obj: b, v: new THREE.Vector3(0, 1.2, 0), t: 0, rot: (Math.random() - 0.5) * 4 });
    }
    if (d.grate) this.dyn.push({ kind: 'fall', obj: d.grate, v: new THREE.Vector3(0, 0.6, 0), t: 0, rot: (Math.random() - 0.5) * 3 });
  }

  removePadlock(key) {
    const g = this.level.gate;
    const p = g.padlocks && g.padlocks[key];
    if (!p || p.userData.gone) return;
    p.userData.gone = true;
    this.dyn.push({ kind: 'fall', obj: p, v: new THREE.Vector3(0, 0.8, 0.8), t: 0, rot: 3 });
    if (Object.values(g.padlocks).every((x) => x.userData.gone) && g.chain) this.dyn.push({ kind: 'fall', obj: g.chain, v: new THREE.Vector3(0, 0.3, 0.6), t: 0, rot: 1 });
  }

  // ------------------------------------------------------------------------ outside the house (seen through windows)
  _buildOutside(rng) {
    const L = this.level, W = L.W, D = L.D;
    const out = this.outside = new THREE.Group(); out.name = 'outside';
    const groundMat = pbr('ground_mud', { color: 0x807a70 });
    const geo = new THREE.PlaneGeometry(260, 260, 1, 1); geo.rotateX(-Math.PI / 2);
    const uv = geo.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 60, uv.getY(i) * 60);
    const ground = new THREE.Mesh(geo, groundMat);
    ground.position.set(W / 2, -0.03, D / 2);
    ground.receiveShadow = true;
    out.add(ground);
    // gravel apron hugging the house
    const apG = new THREE.PlaneGeometry(W + 6, D + 6); apG.rotateX(-Math.PI / 2);
    const au = apG.attributes.uv; for (let i = 0; i < au.count; i++) au.setXY(i, au.getX(i) * (W + 6) / 2.5, au.getY(i) * (D + 6) / 2.5);
    const apron = new THREE.Mesh(apG, pbr('gravel')); apron.position.set(W / 2, -0.02, D / 2); out.add(apron);
    // the house's exterior roof line (upper ceiling slab + parapet) so windows never look into the void
    const roofMat = pbr('roof_slate');
    const slab = new THREE.Mesh(new THREE.BoxGeometry(W + 0.6, 0.35, D + 0.6), roofMat);
    slab.position.set(W / 2, FH + CEIL + 0.2, D / 2); out.add(slab);
    const place = (name, x, z, rot, s = 1) => {
      const o = cloneProp('exterior', name); applyLibrary(o, { cast: false, receive: true });
      o.position.set(x, 0, z); o.rotation.y = rot; o.scale.setScalar(s); o.updateMatrixWorld(true);
      o.traverse((m) => { if (m.isMesh) m.matrixAutoUpdate = false; });
      out.add(o);
      return o;
    };
    const ringPoint = (min, max) => {
      for (let t = 0; t < 30; t++) {
        const a = rng.next() * Math.PI * 2, r = rng.range(min, max);
        const x = W / 2 + Math.cos(a) * (W / 2 + r), z = D / 2 + Math.sin(a) * (D / 2 + r);
        if (x > -4 && x < W + 4 && z > -4 && z < D + 4) continue;
        return [x, z];
      }
      return [W + max, D + max];
    };
    for (let i = 0; i < 26; i++) { const [x, z] = ringPoint(5, 34); place('DeadTree' + (i % 3), x, z, rng.next() * 6.28, rng.range(0.8, 1.3)); }
    // fence ring
    const fenceR = 16;
    const x0 = -fenceR, x1 = W + fenceR, z0 = -fenceR - 6, z1 = D + fenceR;
    const seg = 2.55;
    const edge = (ax, az, bx, bz) => {
      const len = Math.hypot(bx - ax, bz - az), n = Math.floor(len / seg);
      const rot = -Math.atan2(bz - az, bx - ax);
      for (let i = 0; i < n; i++) {
        const t = (i + 0.5) / n;
        const x = ax + (bx - ax) * t, z = az + (bz - az) * t;
        if (Math.abs(x - L.gate.x) < 4 && Math.abs(z - z0) < 1) continue;   // front gate gap
        place('FenceSection', x, z, rot);
      }
    };
    edge(x0, z0, x1, z0); edge(x1, z0, x1, z1); edge(x1, z1, x0, z1); edge(x0, z1, x0, z0);
    place('GatePillar', L.gate.x - 3.2, z0, 0); place('GatePillar', L.gate.x + 3.2, z0, 0);
    const gl = place('IronGateLeaf', L.gate.x - 2.7, z0, 0.35); void gl;
    place('IronGateLeaf', L.gate.x + 2.7, z0, Math.PI - 0.5);
    // lamp posts along the drive (emissive only - far away)
    this.outdoorLights = [];
    for (const s of [-1, 1]) for (const zz of [-4, -10]) {
      const lp = place('LampPost', L.gate.x + s * 3.5, zz, 0);
      this.outdoorLights.push({ pos: new THREE.Vector3(lp.position.x, 3.4, zz), color: 0xffc37a, intensity: 6, range: 10, kind: 'outdoor', room: null });
    }
    // family graveyard on one side
    const gx = W + 7, gz = D * 0.3;
    for (let i = 0; i < 14; i++) place('Gravestone' + (i % 3), gx + (i % 4) * 1.6 + rng.range(-0.3, 0.3), gz + Math.floor(i / 4) * 2.2 + rng.range(-0.3, 0.3), rng.range(-0.2, 0.2) + Math.PI / 2);
    place('Fountain', L.gate.x, -9, 0, 0.8);
    this._mergeGroup(out);
    this.scene.add(out);
  }

  /** Collapse a static group into one mesh per material (dozens of trees/fence posts -> a handful of draws). */
  _mergeGroup(group) {
    group.updateMatrixWorld(true);
    const byMat = new Map();
    const keep = [];
    group.traverse((o) => {
      if (!o.isMesh) return;
      if (o.geometry.attributes.position.count > 200000) { keep.push(o); return; }
      const g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
      g.applyMatrix4(o.matrixWorld);
      for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
      if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
      if (!g.attributes.normal) g.computeVertexNormals();
      if (!byMat.has(o.material)) byMat.set(o.material, []);
      byMat.get(o.material).push(g);
    });
    group.clear();
    for (const o of keep) group.add(o);
    for (const [m, list] of byMat) {
      const merged = mergeGeometries(list, false);
      list.forEach((g) => g.dispose());
      if (!merged) continue;
      merged.computeBoundingSphere();
      const mesh = new THREE.Mesh(merged, m);
      mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false;
      group.add(mesh);
    }
  }

  // ------------------------------------------------------------------------ items
  _placeItems(rng) {
    const L = this.level;
    const spots = { surface: [], drawer: [] };
    for (const r of L.rooms) for (const s of r.spots) { s.room = r; spots[s.kind]?.push(s); }
    rng.shuffle(spots.surface); rng.shuffle(spots.drawer);
    const used = new Set();
    const take = (pred, kinds = ['surface', 'drawer']) => {
      for (const k of kinds) for (const s of spots[k]) if (!used.has(s) && pred(s)) { used.add(s); return s; }
      return null;
    };
    const floorPoint = (pred) => {
      const rooms = L.rooms.filter((r) => r.type !== 'stairs' && pred({ room: r }));
      const r = rng.pick(rooms.length ? rooms : L.rooms);
      const p = L.randomPoint(rng, r);
      return { pos: new THREE.Vector3(p.x, p.y + 0.02, p.z), kind: 'floor', room: r };
    };
    const fuseRoom = L.rooms.find((r) => r.type === 'fuse');
    const ironRoom = L.rooms.find((r) => r.keyRoom === 'iron');
    const silverRoom = L.rooms.find((r) => r.keyRoom === 'silver');
    const gateRoom = L.gate.a;
    const add = (type, spot, extra = {}) => {
      if (!spot) spot = floorPoint(() => true);
      const it = this._spawnItem(type, spot, rng, extra);
      this.items.push(it);
      return it;
    };
    // --- objective items
    add('fuse', take((s) => s.room !== fuseRoom && s.room.layers[0] !== (fuseRoom?.layers[0] ?? 0) && s.kind === 'surface') || floorPoint((s) => s.room.layers[0] === 1));
    add('crowbar', take((s) => s.kind === 'surface' && s.room.layers[0] === 0 && s.room !== gateRoom && ['storage', 'fuse', 'laundry', 'cellar', 'kitchen', 'pantry', 'servants', 'chapel', 'conservatory', 'study'].includes(s.room.type))
      || take((s) => s.kind === 'surface' && s.room.layers[0] === 0 && s.room !== gateRoom) || floorPoint((s) => s.room.layers[0] === 0));
    add('key_brass', take((s) => s.kind === 'drawer' && s.room.layers[0] === 1 && s.room !== ironRoom && s.room !== silverRoom, ['drawer'])
      || take((s) => s.kind === 'drawer' && s.room !== ironRoom, ['drawer']) || take((s) => s.room.layers[0] === 1 && s.room !== ironRoom));
    add('key_iron', take((s) => s.room === ironRoom) || floorPoint((s) => s.room === ironRoom));
    // silver key: behind glass in the collection
    const cases = silverRoom ? (silverRoom.cases || []) : [];
    if (cases.length) {
      const c = rng.pick(cases);
      add('key_silver', { pos: c.itemPos.clone(), kind: 'case', room: silverRoom, case: c });
      c.locked = true;
      for (const o of cases) if (o !== c) { o.item = null; o.decoy = true; }
    } else add('key_silver', take((s) => s.room === silverRoom) || floorPoint((s) => s.room === silverRoom));
    // music box in the nursery
    const nursery = L.rooms.find((r) => r.type === 'nursery');
    if (nursery && nursery.musicBoxSpot) add('musicbox', { pos: nursery.musicBoxSpot.clone(), kind: 'surface', room: nursery });
    else add('musicbox', take(() => true));
    // --- supplies (scaled with player count)
    const np = Math.max(1, this.game.config.players.length);
    const counts = { battery: 4 + np * 2, medkit: 2 + Math.ceil(np / 2), pills: 3 + np, syringe: 1 + Math.ceil(np / 2), crucifix: 1 + Math.floor(np / 2) };
    const diff = this.game.config.difficulty;
    const mult = diff === 'easy' ? 1.4 : diff === 'nightmare' ? 0.6 : 1;
    for (const [type, c] of Object.entries(counts)) {
      for (let i = 0; i < Math.max(1, Math.round(c * mult)); i++) add(type, take((s) => s.room !== ironRoom || rng.chance(0.3)) || floorPoint(() => true));
    }
    // lore notes
    const notes = rng.shuffle(NOTES.map((_, i) => i)).slice(0, 7);
    for (const ni of notes) add('note', take((s) => s.kind === 'surface') || floorPoint(() => true), { note: ni });
    // decoy display cases get valuables
    for (const c of cases) if (c.decoy && rng.chance(0.6)) {
      add(rng.pick(['medkit', 'syringe', 'crucifix']), { pos: c.itemPos.clone(), kind: 'case', room: silverRoom, case: c });
      c.locked = true;
    }
  }

  _spawnItem(type, spot, rng, extra) {
    const def = ITEMS[type];
    const obj = cloneProp('items', def.model);
    applyLibrary(obj, { cast: true, receive: true });
    obj.rotation.y = rng.next() * Math.PI * 2;
    if (type === 'note') obj.rotation.z = 0;
    if (type === 'crowbar') { obj.rotation.x = 0; obj.position.y += 0.01; }
    const id = this.items.length;
    const it = { id, type, obj, spot, room: spot.room, taken: false, ...extra };
    obj.userData.item = it;
    if (spot.kind === 'drawer') {
      const dr = spot.drawer;
      dr.loot = it;
      const local = dr.obj.worldToLocal(spot.pos.clone());
      obj.position.copy(local);
      // undo parent's scale so items keep their real size
      const ws = new THREE.Vector3(); dr.obj.getWorldScale(ws);
      obj.scale.set(1 / ws.x, 1 / ws.y, 1 / ws.z);
      dr.obj.add(obj);
      it.drawer = dr;
    } else {
      obj.position.copy(spot.pos);
      if (spot.kind === 'floor') obj.position.y += 0.0;
      this.scene.add(obj);
      if (spot.case) { spot.case.item = it; it.case = spot.case; }
    }
    return it;
  }

  itemWorldPos(it, out = new THREE.Vector3()) { return it.obj.getWorldPosition(out); }

  // ------------------------------------------------------------------------ interactables
  _registerInteractables() {
    const L = this.level;
    const list = this.interactables;
    for (const r of L.rooms) for (const e of r.interact) list.push({ ...e, room: r });
    for (const d of L.doors) {
      if (d.kind === 'arch') continue;
      list.push({ kind: d.kind === 'gate' ? 'gate' : d.kind === 'vent' ? 'vent' : 'door', ref: d, pos: new THREE.Vector3(d.x, d.y + (d.kind === 'vent' ? 0.45 : 1.1), d.z), radius: d.kind === 'gate' ? 2.6 : 1.9 });
    }
    for (const it of this.items) list.push({ kind: 'item', ref: it, pos: null, radius: 2.1 });
  }

  // ------------------------------------------------------------------------ power
  setPower(on) {
    this.power = on;
    this.powerFlicker = 0.6;
  }

  // ------------------------------------------------------------------------ per-frame
  update(dt, camPos, camLayer, ghostNear) {
    this.time += dt;
    this._updateDoors(dt);
    // falling debris / padlocks
    for (let i = this.dyn.length - 1; i >= 0; i--) {
      const o = this.dyn[i];
      if (o.kind === 'clock') {
        o.t += dt;
        if (o.pendulum) o.pendulum.rotation.z = Math.sin(o.t * Math.PI) * 0.18;
        if (o.handM) o.handM.rotation.z = -o.t * 0.01;
        if (o.handH) o.handH.rotation.z = -o.t * 0.0008 - 1.2;
      } else if (o.kind === 'curtain') {
        o.obj.rotation.x = o.base + Math.sin(this.time * 0.7 + o.ph) * 0.012 + Math.sin(this.time * 1.9 + o.ph * 2) * 0.006;
      } else if (o.kind === 'fall') {
        o.t += dt;
        o.v.y -= 9.8 * dt;
        o.obj.position.addScaledVector(o.v, dt);
        o.obj.rotation.x += o.rot * dt;
        if (o.t > 1.2) { o.obj.visible = false; this.dyn.splice(i, 1); }
      }
    }
    // weather
    this.lightningT -= dt;
    if (this.lightningT < 0) {
      this.lightningT = 12 + Math.random() * 22;
      this.flash = 1;
      this._flashSeq = [0, 0.07, 0.16, 0.24];
      this.game.onLightning?.();
    }
    if (this.flash > 0) {
      const t = 1 - this.flash;
      const f = (t < 0.06 || (t > 0.12 && t < 0.2)) ? 1 : Math.max(0, 1 - t * 2.2);
      this.flashLevel = f;
      this.flash = Math.max(0, this.flash - dt * 1.6);
    } else this.flashLevel = 0;
    this.rainGlass.uniforms.uTime.value = this.time;
    this.rainGlass.uniforms.uFlash.value = this.flashLevel * 0.6;
    this.rain.material.uniforms.uTime.value = this.time;
    this.rain.material.uniforms.uCam.value.copy(camPos);
    this.rain.material.uniforms.uFlash.value = this.flashLevel;
    // power flicker transition + emissive state
    this.powerFlicker = Math.max(0, this.powerFlicker - dt);
    const fl = this.powerFlicker > 0 ? (Math.random() < 0.5 ? 1 : 0.1) : 1;
    const ghostFlicker = ghostNear > 0.3 && Math.random() < ghostNear * 0.25 ? 0.15 : 1;
    const elec = (this.power ? 1 : 0) * (this.powerFlicker > 0 ? fl : 1) * ghostFlicker;
    this.elecLevel = elec;
    if (emissive.bulb) emissive.bulb.emissiveIntensity = 3 * elec;
    if (emissive.window) emissive.window.emissiveIntensity = 1.6;
    if (emissive.flame) emissive.flame.opacity = 0.85 + Math.sin(this.time * 23) * 0.05;
    this._updateLights(dt, camPos, camLayer);
    this._cullRooms(camPos, camLayer);
  }

  _updateLights(dt, cam, layer) {
    const pool = this.pool;
    pool.timer -= dt;
    if (pool.timer <= 0) {
      pool.timer = 0.12;
      const cand = [];
      const maxD = 22;
      for (const s of this.lights) {
        if (s.kind === 'electric' && !this.power) continue;
        const sl = s.room.layers.includes(layer) || s.room.type === 'stairs';
        if (!sl && Math.abs(s.pos.y - cam.y) > 3) continue;
        const d = s.pos.distanceTo(cam);
        if (d > maxD) continue;
        // prefer lights in rooms we can see into (same room or LOS through doors)
        const vis = this.level.los(cam, s.pos) ? 0 : 6;
        cand.push({ s, score: d + vis - Math.sqrt(s.intensity) * 0.6 });
      }
      cand.sort((a, b) => a.score - b.score);
      const want = new Set(cand.slice(0, pool.slots.length).map((c) => c.s));
      for (const sl of pool.slots) if (sl.src && !want.has(sl.src)) sl.leaving = true; else sl.leaving = false;
      for (const s of want) {
        if (pool.slots.some((sl) => sl.src === s)) continue;
        const free = pool.slots.find((sl) => !sl.src) || pool.slots.find((sl) => sl.leaving && sl.level < 0.05);
        if (!free) continue;
        free.src = s; free.level = 0; free.leaving = false;
        free.light.position.copy(s.pos);
        free.light.color.setHex(s.color);
        free.light.distance = s.range * 1.6;
      }
    }
    const t = this.time;
    for (const sl of pool.slots) {
      if (!sl.src) { sl.light.intensity = 0; continue; }
      const s = sl.src;
      const target = sl.leaving ? 0 : 1;
      sl.level += (target - sl.level) * Math.min(1, dt * 6);
      if (sl.leaving && sl.level < 0.02) { sl.src = null; sl.light.intensity = 0; continue; }
      let k = 1;
      if (s.kind === 'fire') k = 0.82 + Math.sin(t * 13 + s.flicker * 40) * 0.08 + Math.sin(t * 29 + s.flicker * 11) * 0.06;
      else if (s.kind === 'electric') {
        k = this.elecLevel;
        if (s.flicker > 0.93) k *= (Math.sin(t * 40) > 0.3 || Math.random() < 0.9) ? 1 : 0.2;   // a few bad bulbs
      }
      sl.light.intensity = s.intensity * k * sl.level;
    }
  }

  /**
   * Portal visibility: a room is drawn only if the camera can see into it through a chain of open doorways
   * (closed doors, walls and the other storey hide everything behind them). Doors, items and the grounds
   * outside are culled with the rooms they belong to.
   */
  _cullRooms(cam, layer) {
    const L = this.level;
    const dd = quality().drawDistance;
    const start = L.roomAt(cam.x, cam.z, layer) || L.roomAt(cam.x, cam.z, 1 - layer);
    const seen = this._seen || (this._seen = new Set());
    seen.clear();
    if (!start) { for (const r of L.rooms) seen.add(r); }
    else {
      const q = [[start, 0]];
      seen.add(start);
      while (q.length) {
        const [r, depth] = q.shift();
        if (depth >= 4) continue;
        for (const d of r.doors) {
          if (d.kind === 'gate') continue;
          const passable = d.kind === 'arch' || d.open || d.angle > 0.02 || (d.kind === 'vent' && !d.barricaded);
          if (!passable) continue;
          const o = d.a === r ? d.b : d.a;
          if (!o || seen.has(o)) continue;
          const dx = Math.max(o.x - cam.x, 0, cam.x - (o.x + o.w)), dz = Math.max(o.z - cam.z, 0, cam.z - (o.z + o.d));
          if (dx * dx + dz * dz > dd * dd) continue;
          seen.add(o);
          q.push([o, depth + 1]);
        }
      }
      // the stairwell connects both storeys: from inside it, both landings are visible
      if (start.type === 'stairs') for (const d of start.doors) { const o = d.a === start ? d.b : d.a; if (o && (d.open || d.kind === 'arch')) seen.add(o); }
    }
    for (const r of L.rooms) r.group.visible = seen.has(r);
    this.visibleRooms = seen;
    for (const d of L.doors) if (d.group) d.group.visible = seen.has(d.a) || (d.b && seen.has(d.b)) || d.kind === 'gate' && seen.has(d.a);
    for (const it of this.items) {
      if (it.taken || it.drawer) continue;
      const r = it.room;
      const dx = it.obj.position.x - cam.x, dz = it.obj.position.z - cam.z;
      it.obj.visible = (!r || seen.has(r)) && dx * dx + dz * dz < 400;
    }
    // grounds are only visible through windows: skip them for window-less interiors
    let win = false;
    for (const r of seen) if (r.windows.length) { win = true; break; }
    if (this.outside) this.outside.visible = win || !start;
    if (this.rain) this.rain.visible = win || !start;
  }

  /** Light level at a point (0..1): used by ghost perception and fear. */
  lightAt(p) {
    let v = 0;
    const elec = this.elecLevel ?? 1;
    const room = this.level.roomAt(p.x, p.z, this.level.layerOfY(p.y));
    for (const s of this.lights) {
      if (s.room !== room) continue;   // light doesn't pass through walls
      const dx = s.pos.x - p.x, dy = s.pos.y - p.y, dz = s.pos.z - p.z;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 > s.range * s.range) continue;
      const k = s.kind === 'electric' ? elec : 1;
      if (k <= 0) continue;
      v += s.intensity * k * 0.045 / (1 + d2 * 0.5);
    }
    return Math.min(1, v);
  }

  nearestWindow(p, layer) {
    let best = null, bd = 1e9;
    for (const r of this.level.rooms) for (const w of r.windows) {
      if (w.layer !== layer) continue;
      const d = Math.hypot(w.x - p.x, w.z - p.z);
      if (d < bd) { bd = d; best = w; }
    }
    return best ? { w: best, d: bd } : null;
  }
}

export { UP, tmpV, C };
