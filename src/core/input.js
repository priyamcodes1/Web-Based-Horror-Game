// Low-latency input: raw pointer-lock mouse deltas are consumed directly by the camera
// (no smoothing, no frame delay). Keyboard state is polled each frame.
import { settings } from './settings.js';

class Input {
  constructor() {
    this.keys = new Set();
    this.pressed = new Set();   // edge-triggered this frame
    this.released = new Set();
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.wheel = 0;
    this.buttons = 0;
    this.clicked = false;
    this.locked = false;
    this.enabled = false;
    this.el = null;
    this.onLookDelta = null;    // (dx, dy) applied immediately on the event for zero latency
    this.onUnlock = null;

    addEventListener('keydown', (e) => {
      if (!this.enabled) return;
      if (e.code === 'Tab' || e.code === 'Space') e.preventDefault();
      if (!this.keys.has(e.code)) this.pressed.add(e.code);
      this.keys.add(e.code);
    });
    addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
      this.released.add(e.code);
    });
    addEventListener('blur', () => { this.keys.clear(); });
    addEventListener('mousemove', (e) => {
      if (!this.locked || !this.enabled) return;
      const s = 0.0022 * settings.sensitivity;
      const dx = e.movementX * s;
      const dy = e.movementY * s * (settings.invertY ? -1 : 1);
      if (this.onLookDelta) this.onLookDelta(dx, dy);
      else { this.mouseDX += dx; this.mouseDY += dy; }
    });
    addEventListener('mousedown', (e) => {
      if (!this.enabled) return;
      this.buttons |= 1 << e.button;
      if (e.button === 0) this.clicked = true;
    });
    addEventListener('mouseup', (e) => { this.buttons &= ~(1 << e.button); });
    addEventListener('wheel', (e) => { if (this.enabled) this.wheel += Math.sign(e.deltaY); }, { passive: true });
    document.addEventListener('pointerlockchange', () => {
      const was = this.locked;
      this.locked = document.pointerLockElement === this.el;
      if (was && !this.locked && this.onUnlock) this.onUnlock();
    });
  }

  attach(el) { this.el = el; }

  async lock() {
    if (!this.el || this.locked) return;
    try {
      // unadjustedMovement bypasses OS mouse acceleration -> 1:1, lowest latency aim
      await this.el.requestPointerLock({ unadjustedMovement: true });
    } catch (_) {
      try { await this.el.requestPointerLock(); } catch (__) { /* user gesture required */ }
    }
  }

  unlock() { if (document.pointerLockElement) document.exitPointerLock(); }

  down(code) { return this.keys.has(code); }
  hit(code) { return this.pressed.has(code); }

  endFrame() {
    this.pressed.clear();
    this.released.clear();
    this.mouseDX = this.mouseDY = 0;
    this.wheel = 0;
    this.clicked = false;
  }
}

export const input = new Input();
