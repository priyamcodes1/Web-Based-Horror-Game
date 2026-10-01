// Director content: a wide pool of haunting events (host picks one, everyone experiences it) and mid-game
// side quests with rewards. Installed onto Game.prototype by installEvents(Game).
import * as THREE from 'three';
import { clone as skeletonClone } from 'three/addons/utils/SkeletonUtils.js';
import { audio } from '../audio/audio.js';
import { assets, cloneProp, applyLibrary } from '../core/assets.js';
import { FH, CEIL } from '../world/level.js';

const V = (a) => new THREE.Vector3(...a);
const WRITINGS = ['GET OUT', 'SHE SEES YOU', 'HIDE', 'NOT ALONE', 'HE SMELLS YOU', 'PLAY WITH ME', 'NO WAY OUT', 'BEHIND YOU'];

// ------------------------------------------------------------------ events
// pick(game, target, room) -> partial event (or null if it can't happen here); run(game, ev) on every peer
export const EVENTS = {
  slam: {
    w: 3,
    pick(g, t) {
      const L = g.level;
      const doors = L.doors.filter((d) => d.leaves.length && d.kind !== 'gate' && !d.locked && Math.hypot(d.x - t.pos.x, d.z - t.pos.z) < 12 && Math.hypot(d.x - t.pos.x, d.z - t.pos.z) > 2.5);
      if (!doors.length) return null;
      const d = g.rng.pick(doors); return { door: d.id, open: !d.open };
    },
    run(g, ev) { const d = g.level.doors[ev.door]; g.doors.setOpen(d, ev.open, { x: d.x + 1, z: d.z + 1 }, true); audio.play('door_slam', { pos: d.center }); },
  },
  slamAll: {
    w: 1, big: true,
    pick(g, t, room) { if (!room || room.doors.filter((d) => d.leaves.length && !d.locked && d.kind !== 'gate').length < 2) return null; return { room: room.index }; },
    run(g, ev) {
      const r = g.level.rooms[ev.room];
      r.doors.filter((d) => d.leaves.length && !d.locked && d.kind !== 'gate').forEach((d, i) => setTimeout(() => {
        g.doors.setOpen(d, false, null, true); audio.play('door_slam', { pos: d.center, vol: 1 });
      }, i * 140));
      g.shake = Math.max(g.shake || 0, 0.6);
    },
  },
  whisper: { w: 3, pick: behind, run(g, ev) { audio.play('whisper', { pos: V(ev.pos), vol: 1, ref: 1 }); } },
  knock: { w: 2, pick: behind, run(g, ev) { audio.play('knock', { pos: V(ev.pos), vol: 1 }); } },
  giggle: { w: 2, pick: behind, run(g, ev) { audio.play('giggle', { pos: V(ev.pos), vol: 0.9 }); } },
  breath: {
    w: 1, big: true,
    pick(g, t) { const b = new THREE.Vector3(Math.sin(t.yaw), 0, Math.cos(t.yaw)); return { pos: t.pos.clone().addScaledVector(b, 0.55).setY(t.pos.y + 1.6).toArray(), pid: t.id }; },
    run(g, ev) {
      audio.play('monster_breath', { pos: V(ev.pos), vol: 1, ref: 0.6 });
      if (ev.pid === g.localId) { g.hud.frost?.(2.5); g.hud.subtitle('<i>Something breathes on the back of your neck.</i>', 2.5); }
    },
  },
  footsteps: {
    w: 2,
    pick(g, t) { return { pos: t.pos.clone().setY(t.pos.y + 0.2).toArray() }; },
    run(g, ev) {
      const p = V(ev.pos); p.y += FH;
      for (let i = 0; i < 7; i++) setTimeout(() => audio.play('heavy_step', { pos: p.clone().add(new THREE.Vector3(i * 0.7 - 2, 0, Math.sin(i) * 0.3)), vol: 0.8 }), i * 480);
    },
  },
  chair: { w: 2, pick: near, run(g, ev) { audio.play('chair_scrape', { pos: V(ev.pos), vol: 1 }); } },
  objects: { w: 2, pick: near, run(g, ev) { audio.play('object_fall', { pos: V(ev.pos), vol: 1 }); setTimeout(() => audio.play('object_fall', { pos: V(ev.pos), vol: 0.6 }), 260); } },
  phone: { w: 1, pick: near, run(g, ev) { audio.play('phone_ring', { pos: V(ev.pos), vol: 1 }); } },
  radio: { w: 1, pick: near, run(g, ev) { audio.play('radio_static', { pos: V(ev.pos), vol: 0.9 }); setTimeout(() => audio.play('whisper', { pos: V(ev.pos), vol: 0.7 }), 900); } },
  baby: {
    w: 1,
    pick(g) { const n = g.level.rooms.find((r) => r.type === 'nursery'); if (!n) return null; return { pos: [n.cx, n.layers[0] * FH + 0.8, n.cz] }; },
    run(g, ev) { audio.play('baby_cry', { pos: V(ev.pos), vol: 1, ref: 3 }); },
  },
  bell: { w: 1, pick: near, run(g, ev) { audio.play('bell', { pos: V(ev.pos), vol: 1 }); setTimeout(() => audio.play('bell', { pos: V(ev.pos), vol: 0.7 }), 700); } },
  glass: {
    w: 1,
    pick(g, t, room) { if (!room || !room.windows.length) return null; const w = g.rng.pick(room.windows); return { pos: [w.x, w.layer * FH + 1.5, w.z] }; },
    run(g, ev) { for (let i = 0; i < 3; i++) setTimeout(() => audio.play('glass_tap', { pos: V(ev.pos), vol: 1 }), i * 600); },
  },
  window: {
    w: 1, big: true,
    pick(g, t, room) { if (!room || !room.windows.length) return null; const w = g.rng.pick(room.windows); return { pos: [w.x, w.layer * FH + 1.5, w.z], room: room.index }; },
    run(g, ev) {
      audio.play('window_bang', { pos: V(ev.pos), vol: 1 }); audio.play('whoosh', { pos: V(ev.pos), vol: 1 });
      g.flash(0.5);
      const r = g.level.rooms[ev.room];
      for (const a of r.lights) if (a.kind === 'fire') { a.dead = true; setTimeout(() => { a.dead = false; }, 14000); }
      setTimeout(() => audio.play('candle_out', { pos: V(ev.pos), vol: 0.8 }), 300);
    },
  },
  clock: { w: 1, pick() { return {}; }, run(g) { const r = g.level.rooms.find((x) => x.clock); if (r) audio.play('clock_chime', { pos: r.clock.obj.getWorldPosition(new THREE.Vector3()), vol: 1 }); } },
  piano: {
    w: 1,
    pick(g) { const pr = g.level.rooms.find((r) => r.type === 'music'); return pr ? { room: pr.index } : null; },
    run(g, ev) { const r = g.level.rooms[ev.room]; audio.play('piano', { pos: new THREE.Vector3(r.cx, r.layers[0] * FH + 1, r.cz), vol: 1 }); },
  },
  musicbox: {
    w: 1,
    pick(g) { return g.musicBox && !g.musicBox.playing ? {} : null; },
    run(g) { g.musicBox.playing = true; audio.play('musicbox', { pos: g.musicBox.pos, vol: 1, ref: 3 }); setTimeout(() => { g.musicBox.playing = false; }, 9000); },
  },
  lightsOut: {
    w: 2, big: true,
    pick(g, t, room) { if (!room || !room.lights.some((a) => a.kind === 'electric')) return null; return { room: room.index }; },
    run(g, ev) {
      const r = g.level.rooms[ev.room]; const p = new THREE.Vector3(r.cx, r.layers[0] * FH + 3, r.cz);
      audio.play('light_buzz', { pos: p });
      setTimeout(() => { g.lights.breakRoom(r); audio.play('bulb_pop', { pos: p, vol: 0.9 }); }, 700);
    },
  },
  strobe: {
    w: 1,
    pick(g, t, room) { if (!room || !room.lights.some((a) => a.kind === 'electric')) return null; return { room: room.index }; },
    run(g, ev) {
      const r = g.level.rooms[ev.room]; const p = new THREE.Vector3(r.cx, r.layers[0] * FH + 3, r.cz);
      audio.play('light_buzz', { pos: p, vol: 1 });
      let n = 0; const tick = () => { if (n++ > 16) { for (const a of r.lights) a.broken = false; return; } for (const a of r.lights) if (a.kind === 'electric') a.broken = n % 2 === 0; setTimeout(tick, 60 + Math.random() * 120); };
      tick();
    },
  },
  frame: {
    w: 1,
    pick(g, t, room) { if (!room) return null; const p = g.level.randomPoint(g.rng, room); return { pos: [p.x, p.y, p.z], room: room.index, rot: g.rng.range(0, 6.28) }; },
    run(g, ev) {
      const o = cloneProp('furniture', 'Painting_Small'); applyLibrary(o);
      o.position.set(ev.pos[0], ev.pos[1] + 0.03, ev.pos[2]); o.rotation.set(-Math.PI / 2, 0, ev.rot);
      g.level.rooms[ev.room].group.add(o);
      audio.play('frame_fall', { pos: V(ev.pos), vol: 1 });
    },
  },
  writing: {
    w: 1, big: true,
    pick(g, t, room) {
      if (!room) return null;
      // a wall the player is NOT facing
      const back = new THREE.Vector3(Math.sin(t.yaw), 0, Math.cos(t.yaw));
      const ax = Math.abs(back.x) > Math.abs(back.z);
      const side = ax ? (back.x > 0 ? 'E' : 'W') : (back.z > 0 ? 'N' : 'S');
      return { room: room.index, side, text: g.rng.pick(WRITINGS), y: t.pos.y };
    },
    run(g, ev) { paintWriting(g, g.level.rooms[ev.room], ev.side, ev.text); },
  },
  shadow: {
    w: 1, big: true,
    pick(g, t, room) {
      // a doorway in front of the player, 6-14 m away
      const fwd = new THREE.Vector3(-Math.sin(t.yaw), 0, -Math.cos(t.yaw));
      const ds = g.level.doors.filter((d) => (d.open || d.kind === 'arch') && d.layer === g.level.layerOfY(t.pos.y + 0.3)).filter((d) => {
        const to = new THREE.Vector3(d.x - t.pos.x, 0, d.z - t.pos.z); const dist = to.length();
        return dist > 5 && dist < 14 && to.normalize().dot(fwd) > 0.75;
      });
      if (!ds.length) return null;
      const d = g.rng.pick(ds);
      return { door: d.id, type: g.rng.pick(g.config.ghostTypes) };
    },
    run(g, ev) { shadowFigure(g, g.level.doors[ev.door], ev.type); },
  },
};

function behind(g, t) {
  const back = new THREE.Vector3(Math.sin(t.yaw), 0, Math.cos(t.yaw));
  const p = t.pos.clone().addScaledVector(back, 2.5 + Math.random() * 3); p.y += 1.5;
  return { pos: p.toArray() };
}
function near(g, t) {
  const a = Math.random() * Math.PI * 2, d = 4 + Math.random() * 6;
  const p = t.pos.clone().add(new THREE.Vector3(Math.cos(a) * d, 0.6, Math.sin(a) * d));
  return { pos: p.toArray() };
}

function paintWriting(g, room, side, text) {
  const c = document.createElement('canvas'); c.width = 1024; c.height = 384;
  const x = c.getContext('2d');
  x.font = 'bold 150px "UnifrakturMaguntia", "IM Fell English SC", serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
  x.fillStyle = '#5a0303';
  x.fillText(text, 512, 170);
  // runs: drips under each letter stroke
  const img = x.getImageData(0, 0, 1024, 384);
  for (let i = 0; i < 70; i++) {
    const px = 60 + Math.random() * 900;
    let py = 0; for (let y = 240; y > 100; y--) { if (img.data[(y * 1024 + (px | 0)) * 4 + 3] > 100) { py = y; break; } }
    if (!py) continue;
    const len = 20 + Math.random() * 110, w = 2 + Math.random() * 5;
    const gr = x.createLinearGradient(0, py, 0, py + len); gr.addColorStop(0, '#5a0303'); gr.addColorStop(1, 'rgba(70,0,0,0)');
    x.fillStyle = gr; x.fillRect(px - w / 2, py, w, len);
    x.beginPath(); x.arc(px, py + len * 0.9, w * 0.7, 0, 7); x.fillStyle = 'rgba(80,3,3,.8)'; x.fill();
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 0.98), new THREE.MeshStandardMaterial({ map: t, transparent: true, roughness: 0.35, metalness: 0, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }));
  const y = room.layers[0] * FH + 1.7;
  const o = 0.115;
  if (side === 'N') { m.position.set(room.cx, y, room.z + room.d - o); m.rotation.y = Math.PI; }
  else if (side === 'S') { m.position.set(room.cx, y, room.z + o); }
  else if (side === 'E') { m.position.set(room.x + room.w - o, y, room.cz); m.rotation.y = -Math.PI / 2; }
  else { m.position.set(room.x + o, y, room.cz); m.rotation.y = Math.PI / 2; }
  room.group.add(m);
  audio.play('stinger', { vol: 0.35 });
}

function shadowFigure(g, door, type) {
  const src = assets.gltf['ghost_' + type] || assets.gltf.ghost_widow;
  if (!src) return;
  const root = skeletonClone(src.scene);
  const black = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.92, depthWrite: true });
  root.traverse((o) => { if (o.isMesh) { o.material = black; o.frustumCulled = false; o.castShadow = false; } });
  const mixer = new THREE.AnimationMixer(root);
  const clip = src.animations.find((a) => /Glide|Walk/.test(a.name));
  if (clip) mixer.clipAction(clip).play();
  const H = door.orient === 'h';
  const dir = H ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 0, 1);
  const a = new THREE.Vector3(door.x, door.y, door.z).addScaledVector(dir, -2.2), b = new THREE.Vector3(door.x, door.y, door.z).addScaledVector(dir, 2.2);
  root.rotation.y = Math.atan2(dir.x, dir.z);
  g.scene.add(root);
  let t = 0;
  const tick = (dt) => {
    t += dt;
    const k = t / 2.4;
    root.position.lerpVectors(a, b, k);
    mixer.update(dt * 1.3);
    black.opacity = 0.92 * Math.min(1, t * 4) * Math.min(1, (1 - k) * 4);
    if (k >= 1) { g.offTick(tick); g.scene.remove(root); }
  };
  g.onTick(tick);
  audio.play('whoosh', { pos: new THREE.Vector3(door.x, door.y + 1.2, door.z), vol: 0.5 });
}

// ------------------------------------------------------------------ side quests
// Host-driven; one at a time. Progress events keep every peer's HUD in sync.
export const QUESTS = {
  diary: {
    title: 'The scattered diary',
    text: (q) => `Find the three diary pages (${q.n || 0}/3)`,
    start(g, rng) {
      const rooms = rng.shuffle(g.level.rooms.filter((r) => r.type !== 'stairs')).slice(0, 3);
      const ids = rooms.map((r) => { const p = g.level.randomPoint(rng, r); const id = g.items.nextId++; g.event({ k: 'spawn', id, type: 'note', pos: [p.x, p.y + 0.02, p.z], diary: 1 }); return id; });
      return { ids, n: 0 };
    },
    onPick(g, q, id) { if (!q.ids.includes(id)) return false; q.n++; return q.n >= 3; },
    reward(g) {
      const missing = ['brass', 'silver', 'iron'].find((k) => !g.keys[k]);
      const it = missing && [...g.items.world.values()].find((i) => i.type === 'key_' + missing && !i.taken);
      if (it) { const r = g.level.roomAt(it.pos.x, it.pos.z, g.level.layerOfY(it.pos.y + 0.2)); return `The pages speak of the ${missing} key… somewhere in the ${r ? r.name : 'house'}.`; }
      return 'The diary ends mid-sentence. The ink is still wet.';
    },
  },
  stash: {
    title: 'A hidden stash',
    text: (q) => `Someone hid supplies in the ${q.room}`,
    start(g, rng) {
      const far = g.level.rooms.filter((r) => r.type !== 'stairs' && Math.hypot(r.cx - g.player.pos.x, r.cz - g.player.pos.z) > 9);
      const r = rng.pick(far.length ? far : g.level.rooms);
      const ids = ['battery', 'battery', 'medkit'].map((type) => { const p = g.level.randomPoint(rng, r); const id = g.items.nextId++; g.event({ k: 'spawn', id, type, pos: [p.x, p.y + 0.02, p.z] }); return id; });
      return { ids, n: 0, room: r.name };
    },
    onPick(g, q, id) { if (!q.ids.includes(id)) return false; q.n++; return q.n >= 3; },
    reward() { return 'Batteries and bandages. Someone planned to stay a while.'; },
  },
  pray: {
    title: 'Sanctuary',
    text: (q) => `Kneel at the chapel altar (${Math.round((q.p || 0) * 100)}%)`,
    available(g) { return g.level.rooms.some((r) => r.type === 'chapel'); },
    start(g) { const r = g.level.rooms.find((x) => x.type === 'chapel'); const s = r.spots.find((sp) => sp.prop === 'Altar'); const p = s ? s.pos : new THREE.Vector3(r.cx, r.layers[0] * FH, r.cz); return { pos: [p.x, r.layers[0] * FH, p.z], p: 0 }; },
    tick(g, q, dt, agents) {
      const at = agents.some((a) => Math.hypot(a.pos.x - q.pos[0], a.pos.z - q.pos[2]) < 1.7 && Math.abs(a.pos.y - q.pos[1]) < 1.5);
      if (at) q.p = Math.min(1, (q.p || 0) + dt / 8);
      return q.p >= 1;
    },
    reward(g, q) {
      g.event({ k: 'spawn', id: g.items.nextId++, type: 'crucifix', pos: [q.pos[0], q.pos[1] + 0.03, q.pos[2] + 0.4] });
      g.ghosts.forEach((gh, i) => g.event({ k: 'stun', g: i, t: 6 }));
      return 'A bell tolls somewhere beneath the house. For a moment, everything is still.';
    },
  },
  musicbox: {
    title: 'The lullaby',
    text: () => 'Wind the music box in the nursery',
    available(g) { return !!g.musicBox; },
    start() { return {}; },
    onAction(g, q, a) { return a.k === 'musicbox'; },
    reward() { return 'They follow the melody upstairs. Use the time.'; },
  },
  piano: {
    title: 'The last chord',
    text: () => 'Play the piano in the music room',
    available(g) { return g.level.rooms.some((r) => r.type === 'music'); },
    start() { return {}; },
    onAction(g, q, a) { return a.k === 'piano'; },
    reward(g) {
      const r = g.level.rooms.find((x) => x.type === 'music');
      g.event({ k: 'spawn', id: g.items.nextId++, type: 'crucifix', pos: [r.cx, r.layers[0] * FH + 0.02, r.cz] });
      return 'The lid slams. Something clatters to the floor beside it.';
    },
  },
};

export function installEvents(Game) {
  const P = Game.prototype;

  P.scare = function scare(big = false) {
    const all = this.agents();
    if (!all.length) return;
    const t = this.rng.pick(all);
    const L = this.level;
    const room = L.roomAt(t.pos.x, t.pos.z, L.layerOfY(t.pos.y + 0.3));
    const pool = Object.entries(EVENTS).filter(([, e]) => !big || e.big);
    for (let tries = 0; tries < 6; tries++) {
      // weighted pick, avoid repeating the last event
      const tot = pool.reduce((s, [k, e]) => s + (k === this._lastScare ? 0 : e.w), 0);
      let r = this.rng.next() * tot, kind = pool[0][0];
      for (const [k, e] of pool) { if (k === this._lastScare) continue; r -= e.w; if (r <= 0) { kind = k; break; } }
      const ev = EVENTS[kind].pick(this, t, room);
      if (!ev) continue;
      this._lastScare = kind;
      this.event({ k: 'scare', kind, pid: t.id, ...ev });
      return;
    }
  };

  P.runScare = function runScare(ev) { const e = EVENTS[ev.kind]; if (e) e.run(this, ev); };

  // ---- quests (host)
  P.questTick = function questTick(dt, agents) {
    const d = this.director;
    if (this.quest) {
      const def = QUESTS[this.quest.id];
      if (def.tick && def.tick(this, this.quest, dt, agents)) this.completeQuest();
      else if (def.tick) { this._qSync = (this._qSync || 0) - dt; if (this._qSync <= 0) { this._qSync = 0.5; this.event({ k: 'quest', q: this.quest }); } }
      return;
    }
    d.nextQuest = (d.nextQuest ?? 75) - dt;
    if (d.nextQuest > 0) return;
    const ids = Object.keys(QUESTS).filter((k) => !(this.questsDone || []).includes(k) && (!QUESTS[k].available || QUESTS[k].available(this)));
    if (!ids.length) { d.nextQuest = 1e9; return; }
    const id = this.rng.pick(ids);
    const q = { id, ...QUESTS[id].start(this, this.rng) };
    this.event({ k: 'quest', q, start: 1 });
  };

  P.questPick = function questPick(itemId) {
    if (!this.isHost || !this.quest) return;
    const def = QUESTS[this.quest.id];
    if (def.onPick && def.onPick(this, this.quest, itemId)) this.completeQuest();
    else if (def.onPick) this.event({ k: 'quest', q: this.quest });
  };

  P.questAction = function questAction(a) {
    if (!this.isHost || !this.quest) return;
    const def = QUESTS[this.quest.id];
    if (def.onAction && def.onAction(this, this.quest, a)) this.completeQuest();
  };

  P.completeQuest = function completeQuest() {
    const q = this.quest, def = QUESTS[q.id];
    const msg = def.reward(this, q);
    (this.questsDone ||= []).push(q.id);
    this.event({ k: 'quest', q: null, done: q.id, msg });
    this.director.nextQuest = 120 + this.rng.next() * 80;
  };

  P.applyQuest = function applyQuest(ev) {
    if (ev.done) {
      (this.questsDone ||= []).includes(ev.done) || this.questsDone.push(ev.done);
      this.quest = null;
      this.hud.notify(`Side quest complete — ${QUESTS[ev.done].title}`, 3.5);
      if (ev.msg) setTimeout(() => this.hud.subtitle(`<i>${ev.msg}</i>`, 5), 1200);
      audio.play('stinger', { vol: 0.3 });
    } else {
      if (ev.start) { this.hud.notify(`New side quest — ${QUESTS[ev.q.id].title}`, 3.5); audio.play('paper', { vol: 0.7 }); }
      this.quest = ev.q;
    }
    this.updateObjectives();
  };
}
