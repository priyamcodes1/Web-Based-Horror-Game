// Door visuals + state: hinged leaves (push open away from the opener), double doors, arches,
// barricaded vents, and the padlocked main gate.
import * as THREE from 'three';
import { cloneProp, applyLibrary } from '../core/assets.js';
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
      const s = d.width / 2 / 1.15;
      const a = mk(along0, line, 0, s, 'GateDoor');
      const b = mk(along1, line, Math.PI, s, 'GateDoor');
      d.leaves.push({ obj: a, base: 0, dir: -1 }, { obj: b, base: Math.PI, dir: 1 });
      d.padlocks = [];
      const cx = (along0 + along1) / 2;
      const chain = mk(cx, line + WT + 0.1, Math.PI, 1, 'ChainDrape');
      chain.scale.set(1.8, 1, 1);
      d.chain = chain;
      for (let i = 0; i < 3; i++) {
        const p = mk(cx - 0.35 + i * 0.35, line + WT + 0.13, Math.PI, 1, 'Padlock');
        p.position.y = y + 1.0 + (i === 1 ? -0.12 : 0.02);
        p.scale.setScalar(1.6);
        d.padlocks.push(p);
      }
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
      if (!d.leaves.length) continue;
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
