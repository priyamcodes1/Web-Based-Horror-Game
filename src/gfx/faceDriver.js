// Facial life on ARKit-style morph targets (exported from MPFB face units): blinks, eye saccades and
// expression presets that ease in/out (e.g. fear while a Scared clip plays). Works on every mesh that carries
// the named morphs (skin, brows, lashes stay in sync).
import * as THREE from 'three';

export const EXPRESSIONS = {
  neutral: {},
  fear: { browInnerUp: 0.85, browOuterUpLeft: 0.35, browOuterUpRight: 0.35, eyeWideLeft: 0.7, eyeWideRight: 0.7,
    mouthStretchLeft: 0.35, mouthStretchRight: 0.35, jawOpen: 0.12, mouthLowerDownLeft: 0.2, mouthLowerDownRight: 0.2 },
  tense: { browInnerUp: 0.4, browDownLeft: 0.15, browDownRight: 0.15, eyeWideLeft: 0.25, eyeWideRight: 0.25,
    mouthPressLeft: 0.3, mouthPressRight: 0.3 },
  exert: { browDownLeft: 0.3, browDownRight: 0.3, eyeSquintLeft: 0.25, eyeSquintRight: 0.25, jawOpen: 0.22,
    mouthStretchLeft: 0.2, mouthStretchRight: 0.2 },
};

export class FaceDriver {
  constructor(root) {
    this.meshes = [];
    root.traverse((o) => { if (o.isMesh && o.morphTargetDictionary && Object.keys(o.morphTargetDictionary).length) this.meshes.push(o); });
    this.names = new Set(this.meshes.flatMap((m) => Object.keys(m.morphTargetDictionary)));
    this.cur = {};             // current eased expression weights
    this.target = {};
    this.blinkT = 0; this.nextBlink = 1 + Math.random() * 3; this.blinkPhase = -1; this.double = false;
    this.look = new THREE.Vector2(); this.lookTarget = new THREE.Vector2(); this.nextSaccade = 0.5;
    this.blinkRate = 1;        // fear blinks faster
  }

  setExpression(name, { blinkRate = 1 } = {}) {
    this.target = { ...(EXPRESSIONS[name] || {}) };
    this.blinkRate = blinkRate;
  }

  _set(name, v) {
    for (const m of this.meshes) {
      const i = m.morphTargetDictionary[name];
      if (i !== undefined) m.morphTargetInfluences[i] = v;
    }
  }

  update(dt) {
    if (!this.meshes.length) return;
    const out = {};
    // expression ease (~0.35 s)
    const k = 1 - Math.exp(-dt / 0.35);
    for (const n of new Set([...Object.keys(this.cur), ...Object.keys(this.target)])) {
      this.cur[n] = (this.cur[n] || 0) + ((this.target[n] || 0) - (this.cur[n] || 0)) * k;
      out[n] = this.cur[n];
    }
    // blink: fast close (70 ms), slower open (130 ms), occasional double blink
    this.blinkT += dt * this.blinkRate;
    let b = 0;
    if (this.blinkPhase < 0 && this.blinkT > this.nextBlink) { this.blinkPhase = 0; this.blinkT = 0; }
    if (this.blinkPhase >= 0) {
      this.blinkPhase += dt;
      const p = this.blinkPhase;
      b = p < 0.07 ? p / 0.07 : Math.max(0, 1 - (p - 0.07) / 0.13);
      if (p > 0.2) {
        this.blinkPhase = -1; this.blinkT = 0;
        this.double = !this.double && Math.random() < 0.18;
        this.nextBlink = this.double ? 0.12 : 1.8 + Math.random() * 4;
      }
    }
    b = b * b * (3 - 2 * b);
    // eyes also lower slightly with the blink; wide-eyes are suppressed while blinking
    for (const s of ['Left', 'Right']) {
      out['eyeBlink' + s] = Math.min(1, (out['eyeBlink' + s] || 0) + b);
      if (out['eyeWide' + s]) out['eyeWide' + s] *= 1 - b;
    }
    // saccades: quick jumps to a new gaze target, held 0.4-2.5 s
    this.nextSaccade -= dt;
    if (this.nextSaccade < 0) {
      const amp = this.target.eyeWideLeft ? 0.75 : 0.4;          // scared eyes dart more
      this.lookTarget.set((Math.random() * 2 - 1) * amp, (Math.random() * 2 - 1) * amp * 0.5);
      this.nextSaccade = (this.target.eyeWideLeft ? 0.25 : 0.6) + Math.random() * 2;
    }
    this.look.lerp(this.lookTarget, 1 - Math.exp(-dt / 0.03));
    const lx = this.look.x, ly = this.look.y;
    // character's left eye looks "out" when gaze goes to her left (+x)
    out.eyeLookOutLeft = Math.max(0, lx); out.eyeLookInRight = Math.max(0, lx);
    out.eyeLookInLeft = Math.max(0, -lx); out.eyeLookOutRight = Math.max(0, -lx);
    out.eyeLookUpLeft = out.eyeLookUpRight = Math.max(0, ly);
    out.eyeLookDownLeft = out.eyeLookDownRight = Math.max(0, -ly) + b * 0.15;
    for (const n of this.names) this._set(n, THREE.MathUtils.clamp(out[n] || 0, 0, 1));
  }
}
