// Cinematic sequences: the ghost catch (victim POV + witness view). The escape ending lives in escape.js.
import * as THREE from 'three';
import { audio } from '../audio/audio.js';
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

export { makeRainGlassMaterial };
