// Cinematic sequences: the ghost catch (victim POV + witness view) and the escape ending.
import * as THREE from 'three';
import { audio } from '../audio/audio.js';
import { cloneProp, applyLibrary, loadGLTF } from '../core/assets.js';
import { Avatar } from '../entities/avatar.js';
import { makeRainGlassMaterial } from '../gfx/effects.js';
import { damp } from '../core/util.js';

const ease = (t) => t * t * (3 - 2 * t);

/**
 * Catch sequence (runs on every peer from the host's 'catch' event).
 *  0.00-0.30  jumpscare: the ghost bursts in from the side of the victim's view (scream + stinger, face lit)
 *  widow / warden: 0.30-2.70 throat grab and lift - the victim hangs from her hands, legs kicking, clawing at
 *                  her wrists; she laughs (he roars) into their face; 2.70 thrown down -> body fall, bone crack
 *  child:          0.30-2.40 knocks the victim flat, crouches over their face, giggles
 *  then fade. Witnesses see the same choreography on the victim's avatar.
 */
export function playCatch(game, ghost, victim, isLocal) {
  return new Promise((resolve) => {
    const T = ghost.type;
    const lift = T !== 'child';
    const vpos = victim.pos.clone();
    const vyaw = victim.yaw;
    const look = new THREE.Vector3(-Math.sin(vyaw), 0, -Math.cos(vyaw));
    const right = new THREE.Vector3(Math.cos(vyaw), 0, -Math.sin(vyaw));
    const sideSign = Math.random() < 0.5 ? -1 : 1;
    const reach = T === 'warden' ? 0.66 : T === 'child' ? 0.5 : 0.6;
    const start = vpos.clone().addScaledVector(right, sideSign * 1.5).addScaledVector(look, 0.55);
    const end = vpos.clone().addScaledVector(look, reach);
    start.y = end.y = vpos.y;
    const faceYaw = (p) => Math.atan2(vpos.x - p.x, vpos.z - p.z);
    ghost.setPos(start, faceYaw(start));
    ghost.dissolveTarget = 0; ghost.dissolve = 0;
    ghost.state = 'grab';
    ghost.play(ghost.P.anims.grab, 0.04, true, 1.7);
    ghost.voice?.stop?.(0.05);
    // sound: the scare itself
    const headP = () => ghost.headWorld(new THREE.Vector3());
    // the scare is IN the room: from her mouth, sweeping in from the side with her (HRTF), huge reverb tail
    const jh = audio.play('jumpscare', { vol: isLocal ? 1.35 : 0.85, pos: headP(), ref: isLocal ? 4 : 2.5 });
    const sweep = setInterval(() => jh?.setPos(headP()), 40); setTimeout(() => clearInterval(sweep), 900);
    audio.play('stinger', { vol: isLocal ? 0.9 : 0.45 });
    ghost.setExpr(T === 'warden' ? 'roar' : T === 'child' ? 'laugh' : 'scream', 1.4);
    if (T === 'widow') setTimeout(() => audio.play('scream', { pos: headP(), vol: 1.1, ref: 3 }), 60);
    if (T === 'warden') setTimeout(() => audio.play('roar', { pos: headP(), vol: 1.2, ref: 3 }), 60);
    if (T === 'child') setTimeout(() => audio.play('giggle', { pos: headP(), vol: 1, ref: 3, rate: 0.9 }), 60);
    // the victim body: a remote avatar (witnesses) - the local victim has no body, only the camera
    let avatar = null;
    if (!isLocal) {
      avatar = game.avatarFor(victim.id);
      if (avatar) { avatar.scripted = 'catch'; avatar.hideSeq = null; avatar.root.visible = true; avatar.pos.copy(vpos); avatar.yaw = avatar.bodyYaw = vyaw; avatar.play('Avoid', 0.06, true, 1.6); }
    }
    // a hard, cold light on the ghost's face for the victim (the house is dark; the scare must read)
    // permanent light created at load (adding/removing lights recompiles every shader = a freeze)
    const faceLight = game.faceLight;
    const p = game.player, cam = p.camera;
    const startFov = cam.fov;
    if (isLocal) { p.locked = true; p.cinematic = true; p.cinematicNoFlash = true; game.hud.letterbox(true); game.cutsceneVictim = true; }
    const camStart = cam.position.clone();
    const q0 = cam.quaternion.clone();
    const dur = lift ? 3.6 : 3.2;
    const tLunge = 0.3, tDrop = lift ? 2.7 : 2.4;
    let t = 0, phase = 0, dropY = 0, dropV = 0;
    const handsMid = new THREE.Vector3(), tmp = new THREE.Vector3(), head = new THREE.Vector3();
    const tick = (dt) => {
      t += dt;
      // ---------------- ghost
      if (t < tLunge) {
        const k = t / tLunge, e = 1 - (1 - k) * (1 - k);
        const gp = start.clone().lerp(end, e);
        ghost.setPos(gp, faceYaw(gp));
      } else if (phase === 0) {
        phase = 1;
        ghost.setPos(end, faceYaw(end));
        if (lift) { ghost.play(ghost.P.anims.lift, 0.18, false, 1); audio.play('hit', { pos: vpos.clone().setY(vpos.y + 1.4), vol: 0.9 }); }
        else { ghost.play(ghost.P.anims.crouch || ghost.P.anims.idle, 0.3); audio.play('body_fall', { pos: vpos, vol: 1 }); }
        if (avatar) avatar.play(lift ? 'Hang' : 'Fall', 0.12, !lift, lift ? 1.2 : 1.8);
        setTimeout(() => { if (lift) audio.play(isLocal ? 'victim_scream' : 'hurt', { pos: isLocal ? null : vpos.clone().setY(vpos.y + 1.6), vol: 0.8 }); }, 300);
        setTimeout(() => ghost.speak('kill', 1.1), lift ? 1200 : 700);
      }
      if (t > tDrop && phase === 1) {
        phase = 2;
        if (lift) { ghost.play(ghost.P.anims.attack, 0.1, true, 1.3); audio.play('whoosh', { pos: vpos, vol: 0.9 }); }
        setTimeout(() => { audio.play('body_fall', { pos: vpos, vol: 1.1 }); if (lift) audio.play('bone', { pos: vpos, vol: 0.8 }); }, lift ? 280 : 0);
        if (avatar && lift) avatar.play('Fall', 0.08, true, 2.2);
      }
      // where the throat is held: in front of her face, a little above it (she holds you up to look at you)
      ghost.headWorld(handsMid);
      const gf = new THREE.Vector3(Math.sin(ghost.yaw), 0, Math.cos(ghost.yaw));
      const lifted = phase === 1 ? Math.min(1, (t - tLunge) / 0.5) : 0;
      handsMid.addScaledVector(gf, 0.42).add(new THREE.Vector3(0, 0.02 + 0.14 * lifted, 0));
      // ---------------- victim avatar (witnesses)
      if (avatar) {
        if (!isLocal) ghost.lookTarget = (avatar.head || avatar.root).getWorldPosition(new THREE.Vector3());
        if (phase === 1 && lift) {
          // hang the avatar so its neck sits in her grip (one correction step per frame converges instantly)
          avatar.root.position.copy(avatar.pos); avatar.root.rotation.y = avatar.bodyYaw + Math.PI;
          avatar.root.updateMatrixWorld(true);
          const neck = (avatar.neck || avatar.head).getWorldPosition(tmp);
          const corr = new THREE.Vector3().subVectors(handsMid, neck);
          if (corr.length() > 0.5) corr.setLength(0.5);                // never fling the body around
          avatar.pos.add(corr.multiplyScalar(0.5));
          // face her: her yaw points at the victim; the avatar yaw convention looks toward -Z (yaw 0)
          avatar.bodyYaw = ghost.yaw; avatar.yaw = ghost.yaw;
          dropY = avatar.pos.y;
        } else if (phase === 2 && lift) {
          dropV -= 9.8 * dt; dropY = Math.max(vpos.y, dropY + dropV * dt);
          avatar.pos.y = dropY;
        }
        avatar.update(dt, cam);
      }
      // ---------------- victim camera
      if (isLocal) {
        ghost.headWorld(head);
        head.add(new THREE.Vector3(Math.sin(ghost.yaw), 0, Math.cos(ghost.yaw)).multiplyScalar(0.09));
        faceLight.position.copy(head).addScaledVector(new THREE.Vector3(Math.sin(ghost.yaw), 0.3, Math.cos(ghost.yaw)), 0.55);
        faceLight.intensity = (t < tLunge ? 1.4 : 1.1) * (0.85 + Math.random() * 0.3);
        ghost.lookTarget = cam.position;
        const shake = (t < tLunge + 0.25 ? 0.05 : phase === 1 ? 0.018 : 0.03);
        let cp;
        if (t < tLunge) cp = camStart.clone();
        else if (lift && phase === 1) cp = camStart.clone().lerp(handsMid.clone().add(new THREE.Vector3(0, 0.1, 0)), Math.min(1, (t - tLunge) / 0.35));
        else if (lift && phase === 2) { dropV -= 9.8 * dt; dropY = Math.max(vpos.y + 0.25, (dropY || cam.position.y) + dropV * dt); cp = cam.position.clone(); cp.y = dropY; }
        else cp = camStart.clone().lerp(vpos.clone().setY(vpos.y + 0.28).addScaledVector(look, -0.25), Math.min(1, (t - tLunge) / 0.45));
        cp.x += (Math.random() - 0.5) * shake; cp.y += (Math.random() - 0.5) * shake; cp.z += (Math.random() - 0.5) * shake;
        cam.position.copy(cp);
        const m = new THREE.Matrix4().lookAt(cam.position, head, new THREE.Vector3(0, 1, 0));
        const q = new THREE.Quaternion().setFromRotationMatrix(m);
        if (phase === 2 && lift) q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.min(1, (t - tDrop) * 2) * 0.9 * sideSign));
        cam.quaternion.slerp(t < tLunge ? q : q, t < tLunge ? 1 - Math.exp(-28 * dt) : 1 - Math.exp(-10 * dt));
        void q0;
        cam.fov = damp(cam.fov, t < tLunge ? startFov + 8 : startFov - 18, 6, dt); cam.updateProjectionMatrix();
        game.gfx.fx.uFear.value = 1; game.gfx.fx.uCA.value = t < tLunge + 0.3 ? 3 : 1.4;
        game.gfx.fx.uDamage.value = phase === 1 ? 0.35 + 0.35 * Math.sin(t * 9) ** 2 : t > tDrop ? 1 : 0.2;
        if (t < 0.05) game.flash(0.12);
        if (t > dur - 0.7) game.gfx.fx.uFade.value = Math.min(1, (t - (dur - 0.7)) / 0.5);
      }
      if (t >= dur) {
        game.offTick(tick);
        faceLight.intensity = 0;
        if (isLocal) {
          cam.fov = startFov; cam.updateProjectionMatrix();
          game.gfx.fx.uCA.value = 0; game.gfx.fx.uDamage.value = 0;
          game.hud.letterbox(false); game.cutsceneVictim = false; p.cinematicNoFlash = false;
        }
        ghost.postAnim = null; ghost.lookTarget = null;
        if (avatar) avatar.scripted = false;
        resolve();
      }
    };
    game.onTick(tick);
  });
}

/** Escape ending: gate opens, run out into the rain, car, drive off. Everyone sees it. */
/** Build the exterior set up-front (during loading) so shaders compile before the finale. */
export function buildExterior(g) {
  const L = g.level;
  const gate = L.gate;
  const gx = gate.x;
  // ---- build the exterior around the front of the house (outside is z < 0)
  const ext = new THREE.Group(); ext.name = 'exterior';
  g.scene.add(ext);
  const mansion = cloneProp('exterior', 'Mansion'); applyLibrary(mansion);
  // Blender front faces -Y -> +Z in glTF; the house interior front wall is z=0 facing -Z, so rotate 180°
  mansion.rotation.y = Math.PI;
  mansion.position.set(gx, -0.8, 0.02);
  const sx = L.W / 40, sz = L.D / 30;
  mansion.scale.set(sx, 1, sz);
  ext.add(mansion);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(260, 260, 64, 64), g.groundMat);
  ground.rotation.x = -Math.PI / 2; ground.position.set(gx, -0.8, -60);
  ground.receiveShadow = true;
  ext.add(ground);
  const road = new THREE.Mesh(new THREE.PlaneGeometry(7, 200), g.asphaltMat);
  road.rotation.x = -Math.PI / 2; road.position.set(gx, -0.78, -80);
  ext.add(road);
  const path = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 34), g.gravelMat);
  path.rotation.x = -Math.PI / 2; path.position.set(gx, -0.785, -20);
  ext.add(path);
  const add = (name, x, z, rot = 0, s = 1) => { const o = cloneProp('exterior', name); applyLibrary(o); o.position.set(x, -0.8, z); o.rotation.y = rot; o.scale.setScalar(s); ext.add(o); return o; };
  for (let i = -8; i <= 8; i++) if (Math.abs(i) > 1) add('FenceSection', gx + i * 2.5, -36);
  add('GatePillar', gx - 2.6, -36); add('GatePillar', gx + 2.6, -36);
  const leafL = add('IronGateLeaf', gx - 2.2, -36, 0); const leafR = add('IronGateLeaf', gx + 2.2, -36, Math.PI);
  for (let i = 0; i < 6; i++) add('LampPost', gx + (i % 2 ? 3.2 : -3.2), -6 - i * 5.5);
  const trees = [];
  for (let i = 0; i < 26; i++) {
    const side = i % 2 ? 1 : -1;
    trees.push(add('DeadTree' + (i % 3), gx + side * (8 + Math.random() * 30), -4 - Math.random() * 60, Math.random() * 6, 0.8 + Math.random() * 0.6));
  }
  for (let i = 0; i < 9; i++) add('Gravestone' + (i % 3), gx - 14 - Math.random() * 10, -10 - Math.random() * 16, Math.random());
  add('Fountain', gx + 12, -16);
  const car = add('Car', gx + 1.5, -46, Math.PI / 2);
  // lamp lights + headlights
  const lamps = [];
  for (let i = 0; i < 3; i++) { const l = new THREE.PointLight(0xffb070, 0, 14, 2); l.position.set(gx + (i % 2 ? 3.2 : -3.2), 2.6, -6 - i * 11); g.scene.add(l); lamps.push(l); }
  const moon = new THREE.DirectionalLight(0x8090b0, 0); moon.position.set(gx + 30, 40, -60); g.scene.add(moon, moon.target);
  const heads = [new THREE.SpotLight(0xfff4dc, 0, 40, 0.5, 0.5, 1.5), new THREE.SpotLight(0xfff4dc, 0, 40, 0.5, 0.5, 1.5)];
  for (const h of heads) { g.scene.add(h, h.target); }
  const rain = makeRainField(g);
  ext.add(rain);
  // ---- actors: the escaping survivor(s)
  const actors = [];
  g.roster.slice(0, 8).forEach((p, i) => {
    const a = new Avatar(g, p.profile, p.name);
    a.scripted = true; a.tag.visible = false;
    a.pos.set(gx - 0.6 + i * 0.5, 0, 1.8 + i * 0.6);
    a.yaw = 0;
    a.id = p.id;
    actors.push(a);
  });
  return { ext, leafL, leafR, car, lamps, moon, heads, rain, actors };
}

export async function playEscape(game) {
  const g = game;
  const L = g.level;
  await loadGLTF('exterior');
  g.hud.letterbox(true);
  g.player.locked = true; g.player.cinematic = true; g.player.cinematicNoFlash = true;
  g.cutscene = true;
  const cam = g.player.camera;
  const gate = L.gate;
  const gx = gate.x, gz = gate.z;
  const X = g.exterior || buildExterior(g);
  const { ext, leafL, leafR, car, lamps, moon, heads, rain } = X;
  ext.visible = true;
  for (const l of lamps) l.intensity = 16;
  moon.intensity = 1.6;
  const oldFog = g.scene.fog; g.scene.fog = new THREE.FogExp2(0x151a24, 0.02);
  const alive = new Set(g.allPlayers().filter((p) => p.alive).map((p) => p.id));
  const actors = X.actors.filter((a) => alive.has(a.id)).slice(0, 8);
  X.actors.forEach((a) => { a.root.visible = actors.includes(a); });
  actors.forEach((a, i) => { a.pos.set(gx - 0.6 + i * 0.5, 0, 1.8 + i * 0.6); a.yaw = 0; });
  g.cutsceneActors = actors;
  audio.stopLoop('chase'); audio.stopLoop('heartbeat');
  audio.stopLoop('chase'); audio.stopLoop('heartbeat');
  // ---- timeline
  const T = { unlock: 0, doors: 2.2, run: 4.5, gate: 9.5, car: 13.5, drive: 16.5, end: 24 };
  let t = 0;
  const locks = gate.padlocks || [];
  audio.play('unlock', { vol: 1 });
  return new Promise((resolve) => {
    let phase = 0;
    const tick = (dt) => {
      t += dt;
      // padlocks fall one by one
      locks.forEach((pl, i) => {
        const lt = t - i * 0.55;
        if (lt > 0 && !pl.userData.fell) { pl.userData.fell = true; audio.play('unlock', { pos: pl.position }); }
        if (lt > 0) { pl.position.y = Math.max(0.03, pl.position.y - dt * 3 * Math.min(1, lt)); pl.rotation.z += dt * 4; }
      });
      if (t > 1.6 && gate.chain && gate.chain.visible) { gate.chain.visible = false; audio.play('chain', { vol: 1 }); }
      if (t > T.doors && phase === 0) { phase = 1; audio.play('door_creak', { dur: 2.2, vol: 1 }); audio.play('thunder', { close: true }); g.flash(1); g.doors.setOpen(gate, true, null); gate.collider && (gate.collider.enabled = false); audio.startLoop('rain', { vol: 1 }); audio.setLoop('rain', 1, false); }
      // ---- cameras
      if (t < T.run) {
        // interior: over the shoulder at the gate
        const a = actors[0];
        const cp = new THREE.Vector3(gx + 1.3, 1.9, 4.2);
        cam.position.lerp(cp, 1 - Math.exp(-3 * dt));
        look(cam, new THREE.Vector3(gx, 1.5, 0), dt, 4);
        actors.forEach((ac) => ac.play('Idle'));
        void a;
      } else if (t < T.gate) {
        const k = (t - T.run) / (T.gate - T.run);
        actors.forEach((ac, i) => { ac.play('Run', 0.2); ac.yaw = 0; ac.pos.z = 1.8 + i * 0.6 - ease(k) * 34 - k * 4; ac.pos.x = gx - 0.6 + i * 0.5 + Math.sin(k * 6 + i) * 0.4; ac.pos.y = ac.pos.z < -0.2 ? -0.8 : 0; });
        // low exterior angle facing the house as they burst out
        const cp = new THREE.Vector3(gx - 5.5, 0.1, -14 - k * 8);
        cam.position.lerp(cp, 1 - Math.exp(-2 * dt));
        look(cam, actors[0].pos.clone().setY(actors[0].pos.y + 1.2), dt, 5);
        if (phase === 1 && k > 0.35) { phase = 2; audio.play('scream', { vol: 0.8 }); spawnDoorwayGhost(g, gx); }
      } else if (t < T.car) {
        const k = (t - T.gate) / (T.car - T.gate);
        if (phase === 2) { phase = 3; audio.play('door_creak', { dur: 1.2 }); }
        leafL.rotation.y = -ease(Math.min(1, k * 2)) * 1.3; leafR.rotation.y = Math.PI + ease(Math.min(1, k * 2)) * 1.3;
        actors.forEach((ac, i) => { ac.play('Run', 0.2); ac.pos.z = -36 - k * 9 + i * 0.4; ac.pos.x = gx + k * 1.2 - i * 0.3; ac.pos.y = -0.8; });
        const cp = new THREE.Vector3(gx + 6, 1.2, -44);
        cam.position.lerp(cp, 1 - Math.exp(-2 * dt));
        look(cam, actors[0].pos.clone().setY(0.2), dt, 5);
      } else if (t < T.drive) {
        const k = (t - T.car) / (T.drive - T.car);
        if (phase === 3) { phase = 4; audio.play('car_door'); setTimeout(() => audio.play('car_door'), 700); setTimeout(() => audio.play('car_start'), 1300); }
        actors.forEach((ac) => { ac.root.visible = k < 0.4; ac.play('Idle'); });
        car.getObjectByName('Car_Door') && (car.getObjectByName('Car_Door').rotation.z = Math.sin(Math.min(1, k * 2) * Math.PI) * 0.9);
        if (k > 0.4) { for (const h of heads) h.intensity = 60; audio.startLoop('car', { vol: 0.8 }); }
        const cp = new THREE.Vector3(gx - 3, 1.5, -52);
        cam.position.lerp(cp, 1 - Math.exp(-2 * dt));
        look(cam, car.position.clone().setY(0.3), dt, 4);
      } else if (t < T.end) {
        const k = (t - T.drive) / (T.end - T.drive);
        car.position.x = gx + 1.5 - ease(k) * 70;
        audio.setLoop('car', 0.8 * (1 - k), 0.3 + k * 0.6);
        // crane up and away: the house watching them leave
        const cp = new THREE.Vector3(gx + 10, 3 + k * 14, -60 + k * 6);
        cam.position.lerp(cp, 1 - Math.exp(-1.2 * dt));
        look(cam, car.position.clone(), dt, 3);
        if (k > 0.75) g.gfx.fx.uFade.value = (k - 0.75) / 0.25;
        if (k > 0.3 && phase === 4) { phase = 5; g.hud.notify('YOU ESCAPED', 5); }
      } else {
        g.offTick(tick);
        audio.stopLoop('car');
        g.scene.fog = oldFog;
        resolve();
        return;
      }
      // car headlights follow the car
      const hp = car.position.clone();
      heads.forEach((h, i) => { h.position.set(hp.x - 2.3, 0, hp.z + (i ? 0.6 : -0.6)); h.target.position.set(hp.x - 25, -1, hp.z); });
      rain.position.copy(cam.position);
      rain.visible = cam.position.z < -0.3;   // only outdoors
      moon.intensity = 1.6 + g.flashT * 7;     // lightning actually lights the grounds
      rain.material.uniforms.uTime.value += dt;
      if (Math.random() < 0.004) { g.flash(0.8); audio.play('thunder'); }
      for (const a of actors) a.update(dt, cam);
    };
    g.onTick(tick);
  });
}

function look(cam, target, dt, k) {
  const m = new THREE.Matrix4().lookAt(cam.position, target, new THREE.Vector3(0, 1, 0));
  const q = new THREE.Quaternion().setFromRotationMatrix(m);
  cam.quaternion.slerp(q, 1 - Math.exp(-k * dt));
}

async function groundMat(g) {
  return g.groundMat;
}

function spawnDoorwayGhost(g, gx) {
  const ghost = g.ghosts[0];
  if (!ghost) return;
  ghost.stun = 0; ghost.state = 'retreat';
  ghost.setPos(new THREE.Vector3(gx, 0, 0.6), Math.PI);
  ghost.dissolveTarget = 0; ghost.dissolve = 0.6;
  ghost.play(ghost.P.anims.stare || ghost.P.anims.idle, 0.1);
}

function makeRainField(g) {
  const n = Math.round(g.quality.rainDrops * 0.6);
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(n * 6);
  for (let i = 0; i < n; i++) {
    const x = (Math.random() - 0.5) * 40, y = Math.random() * 20, z = (Math.random() - 0.5) * 40;
    pos.set([x, y, z, x - 0.03, y - 0.32, z], i * 6);
  }
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const mat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 } },
    transparent: true, depthWrite: false,
    vertexShader: `uniform float uTime; varying float vA;
      void main(){ vec3 p = position; p.y = mod(p.y - uTime*22., 20.) - 8.; vA = .10 + .08 * fract(position.x * 13.7);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(p,1.); }`,
    fragmentShader: `varying float vA; void main(){ gl_FragColor = vec4(.62,.68,.8, vA); }`,
  });
  const l = new THREE.LineSegments(geo, mat);
  l.frustumCulled = false;
  return l;
}

export { makeRainGlassMaterial };
