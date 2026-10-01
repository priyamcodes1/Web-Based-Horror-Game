// Light manager: a constant-size pool of PointLights is re-assigned each frame to the most relevant
// fixtures near the camera (no shader recompiles, hundreds of fixtures at the cost of a few lights).
import * as THREE from 'three';
import { emissive } from '../core/assets.js';
import { quality } from '../core/settings.js';
import { FH } from './level.js';

export class LightManager {
  constructor(scene, level) {
    this.scene = scene;
    this.level = level;
    this.anchors = [];
    for (const r of level.rooms) for (const a of r.lights) { a.level = 0; a.broken = false; this.anchors.push(a); }
    this.pool = [];
    const n = quality().lightPool;
    for (let i = 0; i < n; i++) {
      const l = new THREE.PointLight(0xffaa66, 0, 8, 2);
      l.castShadow = false;
      scene.add(l);
      this.pool.push(l);
    }
    this.hemi = new THREE.HemisphereLight(0x2a3040, 0x0a0806, 0.35);
    scene.add(this.hemi);
    this.power = true;
    this.powerLevel = 1;       // animated 0..1
    this.hunt = 0;             // 0..1 global flicker (hunts)
    this.haunts = [];          // [{pos, radius}] ghost positions that disturb nearby electric lights
    this.t = 0;
  }

  setPower(on) { this.power = on; }

  update(dt, camPos) {
    this.t += dt;
    const target = this.power ? 1 : 0;
    // power comes back with a stutter, goes out quickly
    this.powerLevel += (target - this.powerLevel) * Math.min(1, dt * (this.power ? 2.5 : 9));
    const huntFlick = this.hunt > 0 ? (Math.sin(this.t * 37) * Math.sin(this.t * 13.3) > 0.2 ? 0.15 : 1) : 1;
    const powerStutter = this.power && this.powerLevel < 0.97 ? (Math.random() < 0.3 ? 0.2 : 1) : 1;
    const elecGlobal = this.powerLevel * (1 - this.hunt * (1 - huntFlick)) * powerStutter;
    if (emissive.bulb) emissive.bulb.emissiveIntensity = 1.2 * elecGlobal;
    if (emissive.flame) emissive.flame.opacity = 0.62 + 0.12 * Math.sin(this.t * 23);
    this.hemi.intensity = 0.08 + 0.2 * elecGlobal;

    // score anchors
    const camL = this.level.layerOfY(camPos.y);
    const cand = [];
    for (const a of this.anchors) {
      const al = this.level.layerOfY(a.pos.y - 0.5);
      if (al !== camL && !this._nearStairs(camPos) ) continue;
      const d = a.pos.distanceTo(camPos);
      if (d > a.range + 14) continue;
      let lvl;
      if (a.kind === 'fire') {
        lvl = a.dead ? 0 : 0.8 + 0.2 * Math.sin(this.t * 11 + a.flicker * 40) * Math.sin(this.t * 7.1 + a.flicker * 9);
      } else {
        lvl = a.broken ? 0 : elecGlobal;
        for (const h of this.haunts) {
          const hd = h.pos.distanceTo(a.pos);
          if (hd < h.radius) {
            const k = 1 - hd / h.radius;
            if (Math.random() < 0.35 * k) lvl *= Math.random() * 0.3;
          }
        }
      }
      a.level = lvl;
      if (lvl <= 0.01) continue;
      cand.push({ a, score: d / (a.intensity * lvl + 0.1) });
    }
    cand.sort((p, q) => p.score - q.score);
    for (let i = 0; i < this.pool.length; i++) {
      const L = this.pool[i];
      const c = cand[i];
      if (!c) { L.intensity = 0; continue; }
      const a = c.a;
      L.position.copy(a.pos);
      if (a.swing) { a.swing.rotation.z = Math.sin(this.t * 0.8 + a.flicker * 6) * 0.03; }
      L.color.setHex(a.color);
      L.distance = a.range;
      L.intensity = a.intensity * a.level;
    }
  }

  _nearStairs(p) {
    const s = this.level.stairs;
    return s && p.x > s.x - 2 && p.x < s.x + s.w + 2 && p.z > s.z - 2 && p.z < s.z + s.d + 2;
  }

  /** Burst/kill the fixtures of a room (scare event). */
  breakRoom(room) { for (const a of room.lights) if (a.kind === 'electric') a.broken = true; }
  fixAll() { for (const a of this.anchors) a.broken = false; }
}

export function yForLayer(l) { return l * FH; }
