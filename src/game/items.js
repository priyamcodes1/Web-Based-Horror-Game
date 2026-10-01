// World items, loot distribution, pickups/drops/usage and the interaction targeting system.
import * as THREE from 'three';
import { cloneProp, applyLibrary } from '../core/assets.js';
import { audio } from '../audio/audio.js';
import { input } from '../core/input.js';
import { FH } from '../world/level.js';

export const ITEM_DEFS = {
  battery: { name: 'Battery', prop: 'Battery', rot: [0, 0, 0] },
  medkit: { name: 'Medical Kit', prop: 'Medkit' },
  syringe: { name: 'Adrenaline', prop: 'Syringe', rot: [0, 0.4, 0] },
  pills: { name: 'Sedatives', prop: 'Pills' },
  crucifix: { name: 'Crucifix', prop: 'Crucifix', rot: [-Math.PI / 2, 0, 0] },
  fuse: { name: 'Fuse', prop: 'Fuse', quest: true },
  crowbar: { name: 'Crowbar', prop: 'Crowbar', rot: [0, 0, 0] },
  key_brass: { name: 'Brass Key', prop: 'Key_Brass', quest: true, key: 'brass' },
  key_silver: { name: 'Silver Key', prop: 'Key_Silver', quest: true, key: 'silver' },
  key_iron: { name: 'Iron Key', prop: 'Key_Iron', quest: true, key: 'iron' },
  note: { name: 'Note', prop: 'Note' },
};

export const NOTES = [
  ['A page torn from a diary', 'Edmund says the house is only settling. Houses do not weep at night. Houses do not call your name from the nursery when the child is asleep beside you.\n\n— E.'],
  ['Groundskeeper\'s ledger', 'Oct 3 — Mr. Blackwood ordered the chain replaced. Said the old one "would not hold him".\nOct 9 — Found the kitchen cleaver in the chapel. Nobody will say who put it there.\nOct 12 — I do not go into the cellar anymore.'],
  ['Letter, never sent', 'My dearest sister,\nI wore the dress again tonight. Edmund forbids it, but it is the only thing in this house that still remembers me as I was. The veil is torn. I cannot stop crying and I do not know why.'],
  ['Nursery rhyme, in a child\'s hand', 'Lily Lily in the hall\nwind the box and hear her call\nhide inside the wardrobe tall\nholding breath won\'t help at all'],
  ['Maid\'s warning, scratched into wood', 'THREE LOCKS ON THE FRONT DOOR\nbrass in the drawers — silver behind glass — iron where the Lady bathed\nNEED THE POWER FOR THE BOLT\ndon\'t run where they can hear you'],
  ['Doctor\'s note', 'The patient insists her daughter is alive and singing in the walls. Prescribed laudanum. The husband would not let me examine the child. The husband would not let me leave.'],
  ['Electrician\'s invoice', 'Replaced fuses x4 — generator room. Advised owner the wiring will fail under load.\nOwner advised me the house "prefers the dark".\nPayment: outstanding.'],
  ['The last page', 'If you are reading this, the doors have already closed behind you.\nThey only see what the light shows them.\nThey only hear what you let them hear.\nThe little one tires quickly. The Lady does not. He never stops.'],
  ['Museum catalogue', 'Item 14: silver key, provenance unknown. Displayed under glass at the Lady\'s insistence. Glass is not locked. Glass does not need to be.'],
  ['Scrawled on a menu card', 'Dinner for three. Only two plates were ever used.'],
  // side quest: the scattered diary (indices 10-12)
  ['Diary — page one', 'Lily will not stop humming. Edmund locked the nursery and slid the key under my door, as though I were the one who needed keeping.'],
  ['Diary — page two', 'He wears the old chain now, around his waist, the way his father did. I hear it in the halls at night. He says it keeps him from wandering.'],
  ['Diary — page three', 'I hid what they want where they cannot bear to look: behind the light. Shine it in our faces, and we remember what we were.'],
];

export class Items {
  constructor(game) {
    this.game = game;
    this.world = new Map();     // id -> {id,type,pos,obj,taken,drawer,case,noteIdx}
    this.nextId = 1;
    this.group = new THREE.Group(); game.scene.add(this.group);
    this.outlineMat = new THREE.MeshBasicMaterial({ color: 0xffd48a, side: THREE.BackSide, transparent: true, opacity: 0.6,
      depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending });
    this.t = 0;
  }

  // ------------------------------------------------------------------ deterministic initial loot
  distribute(rng) {
    const L = this.game.level;
    const allSpots = [];
    for (const r of L.rooms) for (const s of r.spots) allSpots.push({ ...s, room: r });
    const take = (filter) => {
      const c = allSpots.filter((s) => !s.used && filter(s));
      if (!c.length) return null;
      const s = rng.pick(c); s.used = true; return s;
    };
    const floorSpot = (room) => {
      const p = L.randomPoint(rng, room);
      return { pos: new THREE.Vector3(p.x, p.y + 0.02, p.z), kind: 'floor', room };
    };
    const place = (type, spot, extra = {}) => {
      if (!spot) return null;
      if (spot.kind === 'drawer') { const it = this.spawn(type, spot.pos, { drawer: spot.drawer, ...extra }); spot.drawer.loot = it; return it; }
      return this.spawn(type, spot.pos, extra);
    };
    const roomsOf = (types) => L.rooms.filter((r) => types.includes(r.type));
    // keys
    const brassRooms = roomsOf(['library', 'study', 'dining', 'billiard', 'parlor', 'bedroom', 'sewing']);
    place('key_brass', take((s) => s.kind === 'drawer' && brassRooms.includes(s.room)) || take((s) => brassRooms.includes(s.room)) || floorSpot(rng.pick(L.rooms)));
    const museum = L.rooms.find((r) => r.keyRoom === 'silver');
    if (museum && museum.cases && museum.cases.length) {
      const dc = rng.pick(museum.cases);
      dc.item = this.spawn('key_silver', dc.itemPos, { inCase: dc });
      for (const other of museum.cases) if (other !== dc && !other.item) other.item = this.spawnDecor(other, rng);
    } else place('key_silver', take(() => true) || floorSpot(rng.pick(L.rooms)));
    const bath = L.rooms.find((r) => r.keyRoom === 'iron');
    place('key_iron', (bath && (take((s) => s.room === bath) || floorSpot(bath))) || take(() => true));
    // tools & supplies
    const service = roomsOf(['storage', 'cellar', 'laundry', 'servants', 'pantry', 'fuse', 'kitchen']);
    place('crowbar', take((s) => service.includes(s.room)) || floorSpot(rng.pick(service.length ? service : L.rooms)));
    const n = this.game.players.length;
    const counts = { medkit: 3 + n, syringe: 2 + Math.ceil(n / 2), pills: 3, battery: 5 + n, crucifix: 2 + Math.floor(n / 2) };
    for (const [type, cnt] of Object.entries(counts)) {
      for (let i = 0; i < cnt; i++) place(type, take((s) => rng.chance(0.6) ? s.kind === 'drawer' : true) || floorSpot(rng.pick(L.rooms)));
    }
    rng.shuffle([...NOTES.keys()].slice(0, 10)).slice(0, 8).forEach((ni) => place('note', take((s) => s.kind === 'surface') || floorSpot(rng.pick(L.rooms)), { noteIdx: ni }));
  }

  spawnDecor(dc, rng) {
    // a real exhibit, scaled to sit inside the case: busts, statuettes, a rocking horse, a music box...
    const pool = [['furniture', 'Bust'], ['furniture', 'Statue_Weeping'], ['furniture', 'Statue_Praying'], ['furniture', 'Statue_Reaching'],
      ['furniture', 'RockingHorse'], ['furniture', 'Candelabra'], ['furniture', 'Padlock'], ['items', 'MusicBox'], ['items', 'Crucifix'], ['items', 'Candle']];
    const [glb, name] = rng ? rng.pick(pool) : pool[0];
    const o = cloneProp(glb, name); applyLibrary(o);
    o.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(o), size = box.getSize(new THREE.Vector3());
    const k = Math.min(0.34 / Math.max(size.y, 1e-3), 0.3 / Math.max(size.x, size.z, 1e-3));
    o.scale.multiplyScalar(k);
    o.position.copy(dc.itemPos);
    o.position.y += -box.min.y * k - 0.07;
    o.rotation.y = (dc.obj?.rotation.y || 0) + (rng ? rng.range(-0.4, 0.4) : 0);
    this.group.add(o);
    return null;
  }

  spawn(type, pos, opts = {}) {
    const def = ITEM_DEFS[type];
    const id = opts.id ?? this.nextId++;
    this.nextId = Math.max(this.nextId, id + 1);
    const obj = cloneProp('items', def.prop);
    applyLibrary(obj);
    obj.position.copy(pos);
    const r = def.rot || [0, 0, 0];
    obj.rotation.set(r[0], (opts.yaw ?? Math.random() * Math.PI * 2) + r[1], r[2]);
    if (type === 'note') obj.rotation.x = 0;
    if (type.startsWith('key')) { obj.rotation.set(0, obj.rotation.y, Math.PI / 2); obj.scale.setScalar(1.4); obj.position.y += 0.01; }
    if (type === 'crowbar') { obj.rotation.set(0, obj.rotation.y, Math.PI / 2); obj.position.y += 0.012; }
    obj.traverse((o) => { if (o.isMesh) o.castShadow = false; });
    this.group.add(obj);
    const it = { id, type, pos: obj.position.clone(), obj, taken: false, drawer: opts.drawer || null, inCase: opts.inCase || null, noteIdx: opts.noteIdx };
    if (it.drawer) { it.drawer.obj.attach(obj); it.local = obj.position.clone(); }
    if (def.quest || type === 'fuse') this.addOutline(it);
    this.world.set(id, it);
    return it;
  }

  addOutline(it) {
    const o = new THREE.Group();
    it.obj.traverse((m) => {
      if (!m.isMesh) return;
      const h = new THREE.Mesh(m.geometry, this.outlineMat);
      h.matrixAutoUpdate = false;
      h.userData.src = m;
      h.renderOrder = 30;
      o.add(h);
    });
    it.outline = o;
    this.group.add(o);
  }

  remove(id) {
    const it = this.world.get(id);
    if (!it) return;
    it.taken = true;
    it.obj.parent?.remove(it.obj);
    if (it.outline) this.group.remove(it.outline);
    if (it.drawer && it.drawer.loot === it) it.drawer.loot = null;
    this.world.delete(id);
  }

  worldPos(it) { const p = new THREE.Vector3(); it.obj.getWorldPosition(p); return p; }

  update(dt, camPos) {
    this.updateFlying(dt);
    this.t += dt;
    this.outlineMat.opacity = 0.35 + 0.25 * Math.sin(this.t * 4);
    for (const it of this.world.values()) {
      if (!it.outline) continue;
      const p = this.worldPos(it);
      const d = p.distanceTo(camPos);
      it.outline.visible = d < 11 && (!it.drawer || it.drawer.open > 0.5);   // no x-ray through a shut drawer (read as a floating item)
      if (!it.outline.visible) continue;
      it.obj.updateMatrixWorld(true);
      for (const h of it.outline.children) {
        h.matrix.copy(h.userData.src.matrixWorld);
        h.matrix.multiply(new THREE.Matrix4().makeScale(1.12, 1.12, 1.12));
      }
    }
  }

  // ------------------------------------------------------------------ usage (local player)
  useHeld(p) {
    const g = this.game, t = p.held;
    if (!t) return;
    if (p.fp?.busy) return;
    let apply = null, anim = t;
    switch (t) {
      case 'medkit':
        if (p.health >= 100) { g.hud.notify('You are not hurt', 1.5); return; }
        apply = () => { if (!p.take('medkit')) return; p.health = Math.min(100, p.health + 60); audio.play('heal'); g.hud.notify('Wounds dressed', 1.5); };
        audio.play('cloth', { vol: 0.5 });
        break;
      case 'syringe':
        apply = () => { if (!p.take('syringe')) return; p.adrenaline = 12; p.stamina = 100; p.health = Math.min(100, p.health + 15); audio.play('inject'); g.hud.notify('Adrenaline surges', 2); };
        break;
      case 'pills':
        apply = () => { if (!p.take('pills')) return; p.sanity = Math.min(100, p.sanity + 60); audio.play('pickup'); g.hud.notify('Your hands stop shaking', 2); };
        break;
      case 'battery':
        if (p.battery > 95) { g.hud.notify('Battery is already full', 1.5); return; }
        p.replaceBattery();
        return;
      case 'crucifix': {
        const ghost = g.ghostInFront(p, 6.5);
        if (!ghost) {
          g.hud.notify('The crucifix trembles… nothing here to ward off', 2);
          if (p.fp) p.fp.act('crucifix', {}, { keep: true });
          return;
        }
        apply = () => {
          if (!p.take('crucifix')) return;
          audio.play('crucifix', { pos: ghost.pos });
          g.request({ k: 'crucifix', ghost: ghost.id });
        };
        break;
      }
      default:
        g.hud.notify(`Use the ${ITEM_DEFS[t].name.toLowerCase()} on something`, 1.8);
        return;
    }
    const done = () => { apply(); p.refreshHeld(); };
    if (p.fp) p.fp.act(anim, { apply: done }); else done();
  }

  drop(p) {
    const t = p.held;
    if (!t) return;
    p.take(t); p.refreshHeld();
    const fwd = new THREE.Vector3(-Math.sin(p.yaw), 0, -Math.cos(p.yaw));
    const pos = p.pos.clone().addScaledVector(fwd, 0.7);
    pos.y = this.game.level.heightAt(pos.x, pos.z, p.layer) + 0.03;
    this.game.request({ k: 'drop', type: t, pos: [pos.x, pos.y, pos.z] });
    audio.play('pickup', { vol: 0.5 });
    p.emit(4, 'drop');
  }

  /** [G]: wind up and throw the held item. It flies on a real arc, clatters where it lands (ghosts hear it -
   *  a way to pull them elsewhere) and lies there to be picked up again. */
  throwHeld(p) {
    const t = p.held;
    if (!t) return;
    if (!p.fp) { this.drop(p); return; }
    if (p.fp.busy) return;
    p.fp.act('throw', {
      release: () => {
        if (p.held !== t || !p.take(t)) return;
        const from = p.fp.leftHandWorld(new THREE.Vector3());
        p.refreshHeld();
        const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(p.camera.quaternion);
        const vel = dir.multiplyScalar(7.5).add(new THREE.Vector3(0, 2.2, 0)).add(p.vel.clone().multiplyScalar(0.5));
        this.launch(t, from, vel, p);
        audio.play('whoosh', { vol: 0.4 });
      },
    });
  }

  launch(type, from, vel, p) {
    const def = ITEM_DEFS[type];
    const obj = cloneProp('items', def.prop); applyLibrary(obj, { cast: false });
    obj.position.copy(from);
    this.group.add(obj);
    const L = this.game.level;
    const spin = new THREE.Vector3(Math.random() * 8 - 4, Math.random() * 8 - 4, Math.random() * 8 - 4);
    this.flying = this.flying || [];
    this.flying.push({ type, obj, vel, spin, layer: p.layer, t: 0, bounces: 0, L });
  }

  /** Thrown items in flight (called every frame). */
  updateFlying(dt) {
    if (!this.flying?.length) return;
    const g = this.game, L = g.level;
    for (let i = this.flying.length - 1; i >= 0; i--) {
      const f = this.flying[i];
      f.t += dt;
      const prev = f.obj.position.clone();
      f.vel.y -= 9.8 * dt;
      const next = prev.clone().addScaledVector(f.vel, dt);
      // walls: bounce back off with most of the speed gone
      if (!L.los(prev, next)) {
        f.vel.x *= -0.3; f.vel.z *= -0.3; f.vel.y *= 0.5;
        next.copy(prev);
        if (f.bounces++ === 0) { audio.play('object_fall', { pos: prev, vol: 0.6 }); g.player.noise.push({ x: prev.x, y: prev.y, z: prev.z, r: 9, kind: 'throw' }); }
      }
      const lay = L.layerOfY(prev.y - 0.2);
      const floor = L.heightAt(next.x, next.z, lay);
      f.obj.position.copy(next);
      f.obj.rotation.x += f.spin.x * dt; f.obj.rotation.y += f.spin.y * dt; f.obj.rotation.z += f.spin.z * dt;
      if (next.y <= floor + 0.03 || f.t > 4) {
        const pos = new THREE.Vector3(next.x, floor + 0.03, next.z);
        if (!L.roomAt(pos.x, pos.z, lay)) pos.copy(prev).setY(floor + 0.03);
        this.group.remove(f.obj);
        this.flying.splice(i, 1);
        audio.play('object_fall', { pos, vol: 0.9 });
        g.player.noise.push({ x: pos.x, y: pos.y, z: pos.z, r: 11, kind: 'throw' });
        g.request({ k: 'drop', type: f.type, pos: [pos.x, pos.y, pos.z] });
      }
    }
  }
}

// ============================================================================ interaction targeting
export class Interact {
  constructor(game) { this.game = game; this.cur = null; }

  candidates(p) {
    const g = this.game, L = g.level, out = [];
    const eye = p.eyePos;
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(p.camera.quaternion);
    const consider = (pos, radius, ref) => {
      const d = pos.distanceTo(eye);
      if (d > radius) return;
      const dir = pos.clone().sub(eye).normalize();
      const dot = dir.dot(fwd);
      if (dot < 0.82 && d > 0.9) return;
      out.push({ ...ref, score: (1 - dot) * 4 + d * 0.35 });
    };
    for (const it of g.items.world.values()) {
      if (it.inCase && !it.inCase.broken) continue;
      if (it.drawer && it.drawer.open < 0.6) continue;
      consider(g.items.worldPos(it), 2.2, { kind: 'item', ref: it, label: it.type === 'note' ? 'Read note' : `Pick up ${ITEM_DEFS[it.type].name}` });
    }
    for (const d of L.doors) {
      if (Math.abs(d.y - p.pos.y) > 2.5 && d.kind !== 'gate') continue;
      if (d.kind === 'arch') continue;
      consider(d.center, d.kind === 'gate' ? 3.2 : 2.2, { kind: 'door', ref: d, label: this.doorLabel(d, p) });
    }
    const room = p.room;
    const rooms = room ? [room, ...room.doors.map((d) => (d.a === room ? d.b : d.a)).filter(Boolean)] : [];
    for (const r of rooms) for (const it of r.interact) {
      if (it.kind === 'hide' && it.ref.occupant) continue;
      let label = it.label;
      if (it.kind === 'drawer') label = it.ref.open > 0.5 ? 'Close drawer' : 'Open drawer';
      if (it.kind === 'fusebox') label = this.fuseLabel(it.ref, p);
      if (it.kind === 'case') label = it.ref.broken ? null : p.has('crowbar') ? 'Smash the glass' : 'Display case (locked tight)';
      if (!label) continue;
      consider(it.pos, it.radius + 0.6, { ...it, label });
    }
    if (g.musicBox) consider(g.musicBox.pos, 2.2, { kind: 'musicbox', ref: g.musicBox, label: g.musicBox.playing ? null : 'Wind the music box' });
    return out.filter((c) => c.label).sort((a, b) => a.score - b.score);
  }

  doorLabel(d, p) {
    const g = this.game;
    if (d.kind === 'gate') {
      const n = Object.values(g.keys).filter(Boolean).length;
      return n >= 3 ? (g.power ? 'Unlock the main gate' : 'Gate bolt has no power') : `Main gate — ${n}/3 locks open`;
    }
    if (d.kind === 'vent') return d.barricaded ? (p.has('crowbar') ? 'Pry the boards off' : 'Boarded vent') : null;
    if (d.locked === 'inside') return this.insideRoom(d) === p.room ? 'Unlock' : 'Locked';
    return d.open ? 'Close' : 'Open';
  }

  insideRoom(d) { return d.a && d.a.type === 'bathroom' ? d.a : d.b && d.b.type === 'bathroom' ? d.b : d.a; }

  fuseLabel(fb, p) {
    const g = this.game;
    if (g.power) return 'The fuse box hums quietly';
    if (!fb.hasFuse) return p.has('fuse') ? 'Insert the fuse' : 'A fuse has burnt out — find a fuse';
    return 'Pull the lever';
  }

  update(p) {
    const g = this.game;
    if (g.escaping || g.cutscene) { this.cur = null; g.hud.prompt(null); return; }
    const c = this.candidates(p)[0] || null;
    this.cur = c;
    g.hud.prompt(c ? c.label : null, c && !/Locked|locked|Boarded|hums|burnt|Main gate —|no power/.test(c.label));
    if (!c || !input.hit('KeyE')) return;
    // the left hand reaches out to it; the action lands when the hand gets there
    const reach = p.fp && !p.fp.busy && ['item', 'door', 'drawer', 'fusebox', 'case', 'piano', 'musicbox'].includes(c.kind) && !(c.kind === 'item' && c.ref.type === 'note');
    if (reach) {
      const target = this.targetPos(c);
      p.fp.act('reach', { apply: () => this.activate(c, p) }, { target, grab: c.kind === 'item' });
    } else if (!p.fp?.busy) this.activate(c, p);
  }

  targetPos(c) {
    const g = this.game, r = c.ref;
    if (c.kind === 'item') return g.items.worldPos(r).clone();
    if (c.kind === 'door') return (r.handle || r.center).clone ? (r.handle || r.center).clone() : null;
    const p = r.pos || r.center || (r.obj && r.obj.getWorldPosition(new THREE.Vector3()));
    return p && p.clone ? p.clone() : null;
  }

  activate(c, p) {
    const g = this.game;
    switch (c.kind) {
      case 'item':
        if (c.ref.type === 'note') { g.hud.note(NOTES[c.ref.noteIdx % NOTES.length]); audio.play('pickup', { vol: 0.5 }); return; }
        if (!ITEM_DEFS[c.ref.type].key && !p.inventory.includes(null)) { g.hud.notify('Your hands are full — [G] to drop', 2); return; }
        g.request({ k: 'pick', id: c.ref.id });
        break;
      case 'door': {
        const d = c.ref;
        if (d.kind === 'gate') { g.request({ k: 'gate' }); return; }
        if (d.kind === 'vent') { if (d.barricaded && p.has('crowbar')) g.request({ k: 'vent', id: d.id }); else g.hud.notify('Boarded shut. You need something to pry it.', 2.5); return; }
        if (d.locked === 'inside') {
          if (this.insideRoom(d) === p.room) g.request({ k: 'unlock', id: d.id });
          else { audio.play('door_locked', { pos: d.center }); g.hud.notify("It's locked from the other side.", 2.5); }
          return;
        }
        g.request({ k: 'door', id: d.id, open: !d.open, from: [p.pos.x, p.pos.z] });
        break;
      }
      case 'drawer': g.request({ k: 'drawer', room: c.ref.room.index, idx: c.ref.room.interact.indexOf(c.ref.room.interact.find((i) => i.ref === c.ref)) }); break;
      case 'hide': p.enterHide(c.ref); break;
      case 'fusebox': {
        const fb = c.ref;
        if (g.power) return;
        if (!fb.hasFuse && p.has('fuse')) { p.take('fuse'); p.refreshHeld(); g.request({ k: 'fuse' }); }
        else if (fb.hasFuse) g.request({ k: 'lever' });
        else g.hud.notify('The fuse is burnt out. Find a replacement fuse.', 2.5);
        break;
      }
      case 'case':
        if (p.has('crowbar')) g.request({ k: 'case', room: c.ref.room.index, idx: c.ref.room.cases.indexOf(c.ref) });
        else g.hud.notify('The glass is thick. You need something heavy.', 2.5);
        break;
      case 'piano': g.request({ k: 'piano', room: c.ref.room.index }); break;
      case 'musicbox': g.request({ k: 'musicbox' }); break;
      default: break;
    }
  }
}

export { FH };
