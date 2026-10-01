// Third-person survivor (remote players, spectate target, cutscenes): realistic cast character with mocap
// locomotion, aim-following head/spine, a torch in the right hand, and scripted hide sequences
// (step back into a wardrobe, lie down and crawl under a bed) that every other player sees.
import * as THREE from 'three';
import { cloneProp, applyLibrary } from '../core/assets.js';
import { makeSurvivor, castById } from './cast.js';
import { dampAngle, angleDiff, clamp } from '../core/util.js';

const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _v = new THREE.Vector3(), _e = new THREE.Euler();
const UP = new THREE.Vector3(0, 1, 0);

export class Avatar {
  constructor(game, profileId, name) {
    this.game = game;
    this.profileId = profileId;
    this.name = name;
    this.char = makeSurvivor(profileId);
    this.root = this.char.root;
    game.scene.add(this.root);
    this.pos = new THREE.Vector3(); this.yaw = 0; this.pitch = 0;
    this.bodyYaw = 0;
    this.target = { pos: new THREE.Vector3(), yaw: 0 };
    this.vel = new THREE.Vector3();
    this.lastPos = null;
    this.flashOn = true;
    this.stance = 'stand'; this.speed = 0; this.alive = true;
    this.hideSpot = null; this.hideSeq = null;
    this.torch = cloneProp('items', 'Flashlight'); applyLibrary(this.torch, { cast: false });
    this.torchTip = this.torch.getObjectByName('Flashlight_Tip');
    game.scene.add(this.torch);
    this.hand = this.char.bones.hand_r; this.head = this.char.bones.head;
    this.neck = this.char.bones.neck_01; this.spine = this.char.bones.spine_03;
    this.play('Idle');
    this.char.update(0);
    this.char.resetPhysics();
    this.tag = this.makeTag(name);
    game.scene.add(this.tag);
    this.speakIcon = this.makeSpeak();
    game.scene.add(this.speakIcon);
  }

  makeSpeak() {
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const g = c.getContext('2d');
    g.fillStyle = '#8df58d'; g.strokeStyle = '#8df58d'; g.lineWidth = 4; g.lineCap = 'round';
    g.beginPath(); g.moveTo(14, 26); g.lineTo(22, 26); g.lineTo(32, 16); g.lineTo(32, 48); g.lineTo(22, 38); g.lineTo(14, 38); g.closePath(); g.fill();
    for (const r of [10, 18]) { g.beginPath(); g.arc(34, 32, r, -0.8, 0.8); g.stroke(); }
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, transparent: true, depthWrite: false }));
    s.scale.set(0.16, 0.16, 1); s.renderOrder = 21; s.visible = false;
    return s;
  }

  get anim() { return this.char.anim; }
  play(name, fade = 0.25, once = false, speed = 1) { return this.char.play(name, fade, once, speed); }

  makeTag(text) {
    const c = document.createElement('canvas'); c.width = 256; c.height = 64;
    const g = c.getContext('2d');
    g.font = '600 28px Cinzel, serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.shadowColor = '#000'; g.shadowBlur = 8; g.fillStyle = '#e8dccb';
    g.fillText(text, 128, 32);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, transparent: true, depthWrite: false }));
    s.scale.set(0.9, 0.225, 1);
    s.renderOrder = 20;
    return s;
  }

  setState(s) {
    this.target.pos.set(s.x, s.y, s.z); this.target.yaw = s.yaw; this.pitch = s.pitch ?? 0;
    this.flashOn = !!s.fl; this.stance = s.st; this.speed = s.sp ?? 0; this.alive = s.al !== 0;
    const spot = s.hd >= 0 ? this.game.hideList?.[s.hd] : null;
    if (spot !== this.hideSpot) this.startHide(spot);
  }

  // ------------------------------------------------------------------ hiding sequences
  startHide(spot) {
    const prev = this.hideSpot;
    this.hideSpot = spot;
    if (spot) this.hideSeq = { kind: spot.kind || 'wardrobe', spot, t: 0, enter: true, from: this.pos.clone(), fromYaw: this.bodyYaw };
    else if (prev) this.hideSeq = { kind: prev.kind || 'wardrobe', spot: prev, t: 0, enter: false };
  }

  /** Returns true while a hide sequence owns the body. */
  updateHide(dt) {
    const q = this.hideSeq;
    if (!q) return false;
    q.t += dt;
    const s = q.spot, out = s.yaw;                      // spot.yaw looks out of the hiding place
    const ease = (x) => { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); };
    if (q.kind === 'bed') {
      // stand at the bed side -> lie down -> slide under; exit: slide out -> get up
      const side = s.stand, under = s.pos;
      if (q.enter) {
        if (q.t < 0.35) { this.pos.lerpVectors(q.from, side, ease(q.t / 0.35)); this.bodyYaw = dampAngle(this.bodyYaw, out + Math.PI, 12, dt); this.play('Walk', 0.15); }
        else if (q.t < 1.5) { this.pos.copy(side); this.bodyYaw = out + Math.PI; this.play('LieDown', 0.2, true, 2.6); }
        else if (q.t < 2.6) { this.pos.lerpVectors(side, under, ease((q.t - 1.5) / 1.1)); this.play('Crawl', 0.3, false, 1.1); }
        else { this.pos.copy(under); this.play('ProneIdle', 0.4); if (q.t > 3) this.hideSeq = null; }
      } else {
        if (q.t < 1.0) { this.pos.lerpVectors(under, side, ease(q.t / 1.0)); this.bodyYaw = out + Math.PI; this.play('Crawl', 0.2, false, -1.1); }
        else if (q.t < 2.2) { this.pos.copy(side); this.play('GetUp', 0.25, true, 2.4); }
        else { this.hideSeq = null; }
      }
      this.root.visible = true;
    } else {
      // wardrobe: walk up, turn around, step backwards inside; exit: step out forwards
      const front = s.stand, inside = s.pos.clone().setY(s.stand.y);
      if (q.enter) {
        if (q.t < 0.45) { this.pos.lerpVectors(q.from, front, ease(q.t / 0.45)); this.bodyYaw = dampAngle(this.bodyYaw, out, 10, dt); this.play('Walk', 0.15, false, 1.3); }
        else if (q.t < 1.15) { this.pos.lerpVectors(front, inside, ease((q.t - 0.45) / 0.7)); this.bodyYaw = dampAngle(this.bodyYaw, out, 14, dt); this.play('Walk', 0.2, false, -1.1); }
        else { this.pos.copy(inside); this.bodyYaw = out; this.play('IdleScared', 0.4); if (q.t > 1.6) this.hideSeq = null; }
      } else {
        if (q.t < 0.6) { this.pos.lerpVectors(inside, front, ease(q.t / 0.6)); this.bodyYaw = out; this.play('Walk', 0.15, false, 1.2); }
        else { this.hideSeq = null; s.animOwner = null; }
      }
      // the doors swing with the sequence; once inside they stay ajar a crack
      const open = q.enter ? (q.t < 1.15 ? Math.min(1, q.t / 0.35) : Math.max(0.28, 1 - (q.t - 1.15) / 0.35)) : Math.max(0, 1 - q.t / 0.8);
      if (s.doorL) s.doorL.rotation.y = -open * 1.6;
      if (s.doorR) s.doorR.rotation.y = open * 1.6;
      if (this.hideSeq) s.animOwner = this;
      this.root.visible = true;
    }
    return true;
  }

  // ------------------------------------------------------------------ per frame
  update(dt, cam) {
    const t = this.target;
    const prev = this.pos.clone();
    let scripted = this.scripted;
    if (!scripted && this.updateHide(dt)) scripted = 'hide';
    if (!scripted) {
      this.pos.lerp(t.pos, Math.min(1, dt * 12));
      this.yaw = dampAngle(this.yaw, t.yaw, 14, dt);
      // velocity from interpolated motion (direction drives body facing)
      const v = _v.copy(this.pos).sub(prev).divideScalar(Math.max(dt, 1e-4)); v.y = 0;
      this.vel.lerp(v, Math.min(1, dt * 8));
      const sp = this.speed || this.vel.length();
      let a = 'Idle', ts = 1;
      let face = this.yaw;
      const moveYaw = Math.atan2(-this.vel.x, -this.vel.z);             // yaw convention: 0 looks toward -Z
      const rel = angleDiff(this.yaw, moveYaw);                          // movement relative to aim
      const back = sp > 0.3 && Math.abs(rel) > 2.0;
      if (sp > 0.3 && !back) face = this.yaw + clamp(rel, -1.2, 1.2) * 0.85;   // strafing: hips turn into the move
      if (this.stance === 'slide') a = 'Slide';
      else if (this.stance === 'prone') { a = sp > 0.15 ? 'Crawl' : 'ProneIdle'; ts = Math.max(0.6, sp / 0.6); }
      else if (this.stance === 'crouch') { a = sp > 0.2 ? 'CrouchWalk' : 'CrouchIdle'; ts = clamp(sp / 1.1, 0.6, 1.6) * (back ? -1 : 1); }
      else if (sp > 3.8) { a = 'Run'; ts = clamp(sp / 4.6, 0.8, 1.4); }
      else if (sp > 0.25) { a = this.game.fear > 0.85 ? 'WalkScared' : 'Walk'; ts = clamp(sp / 1.45, 0.6, 1.8) * (back ? -1 : 1); }
      else if (this.game.fear > 0.9) a = 'IdleScared';
      this.play(a, 0.25, false, ts);
      this.bodyYaw = dampAngle(this.bodyYaw, face, sp > 0.3 ? 9 : 4, dt);
      // idle: only turn the feet when the aim drifts far from the hips
      if (sp <= 0.3 && Math.abs(angleDiff(this.bodyYaw, this.yaw)) > 1.1) this.bodyYaw = dampAngle(this.bodyYaw, this.yaw, 6, dt);
      this.root.visible = this.alive !== false;
    } else if (scripted === true) {
      this.bodyYaw = this.yaw;
    }
    this.root.position.copy(this.pos);
    this.root.rotation.y = this.bodyYaw + Math.PI;     // model faces +Z; yaw 0 looks toward -Z
    this.char.update(dt);
    if (!scripted) this.aimLayer();
    this.updateTorch();
    // name tag
    this.tag.position.set(this.pos.x, this.pos.y + this.char.height + 0.25, this.pos.z);
    const d = cam ? cam.position.distanceTo(this.tag.position) : 99;
    this.tag.visible = this.root.visible && d < 14 && !this.scripted && !this.hideSpot;
    this.tag.material.opacity = Math.min(1, (14 - d) / 4);
    this.speakIcon.position.set(this.pos.x, this.tag.position.y + 0.17, this.pos.z);
    this.speakIcon.visible = !!this.speaking && this.root.visible && d < 20;
  }

  /** Head + upper spine follow the player's aim on top of the locomotion clip. */
  aimLayer() {
    const twist = clamp(angleDiff(this.bodyYaw, this.yaw), -1.3, 1.3);
    const pitch = clamp(this.pitch, -0.9, 0.9);
    const add = (bone, yawK, pitchK) => {
      if (!bone) return;
      bone.updateMatrixWorld();
      // rotate about world up / body right, expressed in the bone's parent space
      const parentQ = bone.parent.getWorldQuaternion(_q2);
      const right = new THREE.Vector3(Math.cos(this.bodyYaw), 0, -Math.sin(this.bodyYaw));
      const r = new THREE.Quaternion().setFromAxisAngle(UP, twist * yawK)
        .multiply(new THREE.Quaternion().setFromAxisAngle(right, -pitch * pitchK));
      const w = bone.getWorldQuaternion(_q);
      w.premultiply(r);
      bone.quaternion.copy(parentQ.invert().multiply(w));
    };
    add(this.spine, 0.35, 0.3); add(this.neck, 0.3, 0.3); add(this.head, 0.35, 0.4);
    this.root.updateMatrixWorld(true);
  }

  updateTorch() {
    const on = this.root.visible && !this.hideSpot;
    this.torch.visible = on;
    if (!on || !this.hand) return;
    this.hand.updateMatrixWorld();
    const p = this.hand.getWorldPosition(_v);
    const hq = this.hand.getWorldQuaternion(_q);
    // palm: a little along the hand toward the fingers
    p.add(new THREE.Vector3(0, 0.07, 0.02).applyQuaternion(hq));
    this.torch.position.copy(p);
    // the torch points where the hand points, pulled toward the aim
    const handDir = new THREE.Vector3(0, 1, 0).applyQuaternion(hq);
    const look = new THREE.Vector3(-Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), -Math.cos(this.yaw) * Math.cos(this.pitch));
    const dir = handDir.lerp(look, 0.6).normalize();
    this.torch.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir);
  }

  torchWorld(pos, dir) {
    if (this.torchTip) this.torchTip.getWorldPosition(pos); else this.torch.getWorldPosition(pos);
    const look = new THREE.Vector3(-Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), -Math.cos(this.yaw) * Math.cos(this.pitch));
    dir.set(0, 0, 1).applyQuaternion(this.torch.quaternion).lerp(look, 0.75).normalize();
  }

  dispose() {
    this.game.scene.remove(this.root); this.game.scene.remove(this.tag); this.game.scene.remove(this.torch); this.game.scene.remove(this.speakIcon);
  }
}

export { castById };
