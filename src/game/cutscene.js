// Escape cutscene: survivors burst out of the manor, run the driveway in the rain, push the iron gate open and
// drive away. Built as its own scene around the exterior set so it never disturbs the interior.
import * as THREE from 'three';
import { cloneProp, applyLibrary, pbr } from '../core/assets.js';
import { quality } from '../core/settings.js';
import { audio } from '../audio/audio.js';
import { Avatar } from './avatar.js';
import { clamp, smoothstep, lerp } from '../core/util.js';

const PATH = [[0, 0.8, -0.6], [0, 0.8, 1.8], [0, 0.02, 4.9], [2.8, 0, 12], [3.4, 0, 17.5], [0.8, 0, 26], [0, 0, 30.5], [3.4, 0, 38], [5.2, 0, 41.5]]
  .map((p) => new THREE.Vector3(...p));
const RUN = 5.0;

function pathLen() { let s = 0; for (let i = 1; i < PATH.length; i++) s += PATH[i].distanceTo(PATH[i - 1]); return s; }
const TOTAL = pathLen();

function along(d, out) {
  let rem = d;
  for (let i = 1; i < PATH.length; i++) {
    const seg = PATH[i].distanceTo(PATH[i - 1]);
    if (rem <= seg) { out.copy(PATH[i - 1]).lerp(PATH[i], rem / seg); return i; }
    rem -= seg;
  }
  out.copy(PATH[PATH.length - 1]);
  return PATH.length - 1;
}

export class EscapeCutscene {
  constructor(game, survivors, ghostType) {
    this.game = game;
    this.survivors = survivors.slice(0, 5);
    this.ghostType = ghostType || 'widow';
    this.t = 0;
    this.done = false;
    this.cues = new Set();
  }

  build() {
    const s = this.scene = new THREE.Scene();
    s.background = new THREE.Color(0x07090d);
    s.fog = new THREE.FogExp2(0x0a0d12, 0.028);
    const cam = this.camera = new THREE.PerspectiveCamera(42, innerWidth / innerHeight, 0.1, 400);
    s.add(new THREE.HemisphereLight(0x3a4a66, 0x0a0806, 0.35));
    const moon = this.moon = new THREE.DirectionalLight(0x8fa6d8, 0.9);
    moon.position.set(-30, 40, 60);
    moon.target.position.set(0, 0, 20);
    moon.castShadow = true;
    const sz = Math.min(4096, quality().shadowSize * 2);
    moon.shadow.mapSize.set(sz, sz);
    Object.assign(moon.shadow.camera, { left: -40, right: 40, top: 40, bottom: -40, near: 1, far: 160 });
    moon.shadow.bias = -0.0004;
    s.add(moon, moon.target);
    const place = (name, x, y, z, rot = 0, sc = 1, glb = 'exterior') => {
      const o = cloneProp(glb, name); applyLibrary(o);
      o.position.set(x, y, z); o.rotation.y = rot; o.scale.setScalar(sc);
      s.add(o); return o;
    };
    // ground, driveway, road
    const plane = (w, d, mat, x, z, y, rep) => {
      const g = new THREE.PlaneGeometry(w, d); g.rotateX(-Math.PI / 2);
      const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * w / rep, uv.getY(i) * d / rep);
      const m = new THREE.Mesh(g, mat); m.position.set(x, y, z); m.receiveShadow = true; s.add(m); return m;
    };
    plane(400, 400, pbr('ground_mud', { color: 0x8a8478 }), 0, 20, -0.02, 3);
    plane(5.5, 27, pbr('gravel'), 0, 17.5, 0.0, 2.5);
    plane(400, 7, pbr('asphalt', { roughness: 0.6 }), 0, 43, 0.01, 4);
    // wet road sheen
    const wet = new THREE.Mesh(new THREE.PlaneGeometry(400, 7).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x05070a, roughness: 0.08, metalness: 0.2, transparent: true, opacity: 0.45 }));
    wet.position.set(0, 0.02, 43); s.add(wet);
    // the manor
    this.mansion = place('Mansion', 0, 0, 0);
    this.doors = [];
    for (const sd of [-1, 1]) {
      const pivot = new THREE.Group(); pivot.position.set(sd * 1.15, 0.8, 0.05);
      const leaf = cloneProp('furniture', 'GateDoor'); applyLibrary(leaf);
      if (sd > 0) leaf.rotation.y = Math.PI;
      pivot.add(leaf); s.add(pivot);
      this.doors.push({ pivot, sd });
    }
    // warm light spilling from the open doorway
    this.doorLight = new THREE.PointLight(0xffa860, 0, 14, 2); this.doorLight.position.set(0, 2.2, 1.5); s.add(this.doorLight);
    place('Fountain', 0, 0, 16, 0, 1);
    this.lamps = [];
    for (const sd of [-1, 1]) for (const z of [8, 23]) {
      place('LampPost', sd * 4.2, 0, z);
      const l = new THREE.PointLight(0xffbf70, 9, 16, 2); l.position.set(sd * 4.2, 3.4, z); s.add(l); this.lamps.push(l);
    }
    // fence + gate
    for (let x = -46; x <= 46; x += 2.55) { if (Math.abs(x) < 3.6) continue; place('FenceSection', x, 0, 30); }
    place('GatePillar', -3.25, 0, 30); place('GatePillar', 3.25, 0, 30);
    this.gateL = place('IronGateLeaf', -2.75, 0, 30, 0); this.gateR = place('IronGateLeaf', 2.75, 0, 30, Math.PI);
    // trees + graves for silhouette depth
    const rnd = (a, b) => a + Math.random() * (b - a);
    for (let i = 0; i < 34; i++) {
      const side = i % 2 ? 1 : -1;
      place('DeadTree' + (i % 3), side * rnd(9, 60), 0, rnd(-30, 36), rnd(0, 6.28), rnd(0.8, 1.35));
    }
    for (let i = 0; i < 16; i++) place('Gravestone' + (i % 3), -14 - (i % 4) * 1.8 + rnd(-0.3, 0.3), 0, 10 + Math.floor(i / 4) * 2.3, Math.PI / 2 + rnd(-0.2, 0.2));
    // the car, parked on the road facing west
    this.car = place('Car', 6.4, 0, 43.2, 0);
    this.carDoor = this.car.getObjectByName('Car_Door');
    this.carDoorBase = this.carDoor ? this.carDoor.rotation.y : 0;
    this.heads = [];
    for (const n of ['Car_HeadlightL', 'Car_HeadlightR']) {
      const e = this.car.getObjectByName(n);
      if (!e) continue;
      const sp = new THREE.SpotLight(0xfff3d8, 0, 60, 0.42, 0.5, 1.4);
      sp.position.copy(e.position); sp.target.position.copy(e.position).add(new THREE.Vector3(-10, -0.6, 0));
      this.car.add(sp, sp.target); this.heads.push(sp);
    }
    this.car.traverse((o) => { if (o.isMesh && /head|tail/.test(o.material.name)) { o.material = o.material.clone(); o.userData.lamp = true; o.material.emissiveIntensity = 0; } });
    // survivors
    this.runners = this.survivors.map((sv, i) => {
      const a = new Avatar('player', { profile: sv.profile });
      a.setFlashlightOn(true);
      a.play('Run', { speed: 1.15 });
      s.add(a.root);
      return { a, delay: 0.6 + i * 0.38, lat: (i % 2 ? 1 : -1) * Math.ceil(i / 2) * 0.75, gone: false, pos: new THREE.Vector3() };
    });
    // a ghost watching from the doorway
    this.ghost = new Avatar(this.ghostType);
    this.ghost.setDissolve(1);
    this.ghost.root.position.set(0, 0.8, -0.3);
    this.ghost.play(this.ghost.clips.Stare ? 'Stare' : 'Idle');
    s.add(this.ghost.root);
    // rain
    this.rain = this.game.world.rain.clone();
    this.rain.material = this.game.world.rain.material.clone();
    this.rain.material.uniforms.uHouse.value.set(-20.5, -30.5, 20.5, 4.4);
    this.rain.material.uniforms.uRoof.value = 14.4;
    s.add(this.rain);
    this.flash = 0;
    this.flashT = 3.4;
    return this;
  }

  cue(name, fn) { if (!this.cues.has(name)) { this.cues.add(name); fn(); } }

  update(dt) {
    const t = (this.t += dt);
    const cam = this.camera;
    const r0 = this.runners[0];
    // ---------------- runners
    for (const r of this.runners) {
      const d = Math.max(0, (t - r.delay) * RUN);
      if (d >= TOTAL - 0.05) {
        if (!r.gone) { r.gone = true; r.a.root.visible = false; }
        continue;
      }
      const i = along(d, r.pos);
      const ahead = new THREE.Vector3(); along(Math.min(TOTAL, d + 0.6), ahead);
      const dir = ahead.clone().sub(r.pos); dir.y = 0;
      const side = new THREE.Vector3(dir.z, 0, -dir.x).normalize();
      const k = smoothstep(2, 6, d) * (1 - smoothstep(TOTAL - 8, TOTAL - 2, d));
      r.a.root.position.copy(r.pos).addScaledVector(side, r.lat * k);
      if (dir.lengthSq() > 1e-6) r.a.root.rotation.y = Math.atan2(dir.x, dir.z);
      r.a.root.visible = t > r.delay - 0.3;
      r.a.aim = { dir: new THREE.Vector3(Math.sin(r.a.root.rotation.y), -0.25, Math.cos(r.a.root.rotation.y)).normalize(), weight: 0.8 };
      r.a.update(dt);
      void i;
    }
    // ---------------- set dressing cues
    if (t > 0.25) this.cue('doors', () => { audio.play('door_slam', { vol: 1 }); audio.play('whoosh', { vol: 0.5 }); });
    const dk = smoothstep(0.25, 0.7, t);
    for (const d of this.doors) d.pivot.rotation.y = d.sd * dk * 1.9;   // both leaves swing outward
    this.doorLight.intensity = 14 * dk * (0.9 + Math.random() * 0.1);
    const gk = smoothstep(6.1, 6.8, t);
    this.gateL.rotation.y = -gk * 1.5;
    this.gateR.rotation.y = Math.PI + gk * 1.5;
    if (t > 6.1) this.cue('gate', () => audio.play('door_creak', { vol: 0.9, dur: 1.4 }));
    if (t > 6.6) this.cue('ghost', () => { audio.play(this.ghostType === 'warden' ? 'roar' : this.ghostType === 'child' ? 'giggle' : 'scream', { vol: 0.6, reverb: 0.8 }); });
    const gd = t > 6.6 ? Math.max(0, 1 - (t - 6.6) * 0.8) : 1;
    this.ghost.setDissolve(gd, gd < 1 && gd > 0 ? 0.3 : 0);
    this.ghost.update(dt);
    // car: door, lights, drive
    const doorOpen = smoothstep(8.4, 8.9, t) * (1 - smoothstep(10.4, 10.7, t));
    if (this.carDoor) this.carDoor.rotation.y = this.carDoorBase + doorOpen * 1.1;
    if (t > 8.4) this.cue('cardoor', () => audio.play('car_door', { vol: 0.7 }));
    if (t > 10.6) this.cue('cardoor2', () => audio.play('car_door', { vol: 1 }));
    if (t > 11.0) this.cue('start', () => { audio.play('car_start', { vol: 1 }); });
    const lampOn = t > 11.0 ? 1 : 0;
    for (const h of this.heads) h.intensity = 120 * lampOn;
    this.car.traverse((o) => { if (o.userData.lamp) o.material.emissiveIntensity = lampOn * (/tail/.test(o.material.name) ? 2.5 : 6); });
    if (t > 12.2) this.cue('drive', () => { audio.startLoop('car', { vol: 0.8 }); });
    const td = Math.max(0, t - 12.4);
    const carX = 6.4 - 0.5 * 3.6 * td * td;
    this.car.position.x = carX;
    if (audio.loops.car) audio.setLoop('car', 0.8 * (1 - smoothstep(16, 19.5, t)), clamp(td / 5, 0, 1));
    // lightning
    this.flashT -= dt;
    if (this.flashT <= 0) { this.flash = 1; this.flashT = 4 + Math.random() * 5; setTimeout(() => audio.play('thunder', { close: Math.random() < 0.5 }), 400 + Math.random() * 900); }
    this.flash = Math.max(0, this.flash - dt * 2.5);
    const fl = this.flash > 0.6 || (this.flash > 0.25 && this.flash < 0.4) ? this.flash : 0;
    this.moon.intensity = 0.9 + fl * 6;
    this.rain.material.uniforms.uTime.value = t;
    this.rain.material.uniforms.uCam.value.copy(cam.position);
    this.rain.material.uniforms.uFlash.value = fl;
    // ---------------- camera shots
    const lead = r0 ? r0.a.root.position : new THREE.Vector3(0, 0, 10);
    const look = new THREE.Vector3();
    if (t < 2.4) {
      // A: low wide shot from the fountain looking up at the doors
      const k = t / 2.4;
      cam.position.set(lerp(-3.5, -2.2, k), lerp(0.7, 0.9, k), lerp(13, 11.5, k));
      look.set(0, lerp(4.5, 2.2, k), 0);
      cam.fov = 38;
    } else if (t < 5.9) {
      // B: tracking alongside the lead runner
      cam.position.set(lead.x + 3.4, 1.5, lead.z - 0.6);
      look.set(lead.x, 1.3, lead.z + 1.2);
      cam.fov = 50;
    } else if (t < 8.3) {
      // C: outside the gate, survivors run at camera, ghost in the doorway behind them
      const k = (t - 5.9) / 2.4;
      cam.position.set(lerp(-1.2, -0.6, k), 1.55, lerp(35.5, 34, k));
      look.set(0, lerp(2.0, 1.6, k), 0);
      cam.fov = lerp(30, 42, k);
    } else if (t < 11.8) {
      // D: at the car
      cam.position.set(2.2, 1.35, 38.6);
      look.set(6.2, 1.0, 42.8);
      cam.fov = 45;
    } else {
      // E: the car pulls away; crane up and hold on the manor through the rain
      const k = clamp((t - 11.8) / 7, 0, 1);
      const e = k * k * (3 - 2 * k);
      cam.position.set(lerp(12, 14, e), lerp(1.6, 9, e), lerp(47, 58, e));
      look.set(lerp(this.car.position.x, -2, e), lerp(1, 4, e), lerp(43, 12, e));
      cam.fov = lerp(40, 34, e);
    }
    cam.aspect = innerWidth / innerHeight;
    cam.lookAt(look);
    cam.updateProjectionMatrix();
    audio.updateListener(cam.position, new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion), new THREE.Vector3(0, 1, 0));
    if (t > 20.5) this.done = true;
    return { t, flash: fl };
  }

  dispose() {
    audio.stopLoop('car');
    this.scene.traverse((o) => { if (o.isMesh && o.geometry && !o.geometry.userData.shared) { /* shared geometries stay cached */ } });
    for (const r of this.runners) r.a.dispose();
    this.ghost.dispose();
  }
}
