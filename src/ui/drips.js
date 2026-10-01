// Blood for the UI, simulated on one canvas: a bead swells under an edge and necks off, falls under
// gravity as a stretching, wobbling teardrop, and hits the real bottom of the screen: crown splash,
// secondary droplets on ballistic arcs, and a pool that spreads, darkens and soaks away.
// Everything runs on the animation clock (dt clamped, paused while the tab is hidden), so nothing
// queues up in the background and bursts out when you come back.

const G = 2600;            // px/s^2
const MAX_DROPS = 48, MAX_PARTS = 260, MAX_POOLS = 34;

let cv = null, g = null, dpr = 1, W = 0, H = 0;
let running = false, last = 0, clock = 0;
const beads = [], drops = [], parts = [], pools = [], crowns = [], emitters = new Set();

const rnd = (a, b) => a + Math.random() * (b - a);

function ensure() {
  if (cv) return;
  cv = document.createElement('canvas');
  cv.className = 'drip-layer';
  document.body.appendChild(cv);
  g = cv.getContext('2d');
  const resize = () => {
    dpr = Math.min(devicePixelRatio || 1, 2); W = innerWidth; H = innerHeight;
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    cv.style.width = W + 'px'; cv.style.height = H + 'px';
  };
  resize(); addEventListener('resize', resize);
  document.addEventListener('visibilitychange', () => { last = 0; });   // resume without a time jump
}

function wake() {
  ensure();
  if (running) return;
  running = true; last = 0;
  requestAnimationFrame(loop);
}

function loop(now) {
  if (!running) return;
  if (document.hidden) { last = 0; requestAnimationFrame(loop); return; }
  const dt = last ? Math.min(1 / 30, (now - last) / 1000) : 1 / 60;
  last = now; clock += dt;
  step(dt);
  draw();
  const idle = !beads.length && !drops.length && !parts.length && !pools.length && !crowns.length && !emitters.size;
  if (idle) { running = false; g.clearRect(0, 0, cv.width, cv.height); return; }
  requestAnimationFrame(loop);
}

// ------------------------------------------------------------------ simulation
function floorY() { return H - 1; }

function step(dt) {
  for (const e of emitters) e.tick(dt);
  // hanging beads: mass flows in, the bead sags on a stretching neck, then pinches off
  for (let i = beads.length - 1; i >= 0; i--) {
    const b = beads[i];
    b.t += dt;
    const k = Math.min(1, b.t / b.hang);
    b.r = b.size * (0.25 + 0.75 * Math.pow(k, 0.7)) * 0.5;
    b.sag = b.size * (0.15 + 1.25 * k * k);
    b.wob += dt;
    if (k >= 1) {
      beads.splice(i, 1);
      if (drops.length < MAX_DROPS) drops.push({ x: b.x, y: b.y + b.sag, vy: 30, r: b.r, wob: 0, age: 0, neck: b.size * 0.9, ax: b.x, ay: b.y });
      // a smaller satellite bead sometimes re-forms on the leftover film
      if (b.size > 7 && Math.random() < 0.35) addBead(b.x + rnd(-1, 1), b.y, { size: b.size * 0.55, hang: b.hang * 0.9 });
    }
  }
  // falling drops
  for (let i = drops.length - 1; i >= 0; i--) {
    const d = drops[i];
    d.age += dt;
    d.vy += G * dt; d.vy *= 1 - 0.02 * dt * 60 * 0.03;      // a touch of air drag
    d.y += d.vy * dt;
    d.wob += dt;
    d.neck = Math.max(0, d.neck - dt * 220);                // the snapped neck recoils into the edge
    const fy = floorY();
    if (d.y + d.r >= fy) { drops.splice(i, 1); impact(d.x, fy, d.r, d.vy); }
  }
  // splash droplets
  for (let i = parts.length - 1; i >= 0; i--) {
    const p = parts[i];
    p.vy += G * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.age += dt;
    const fy = floorY();
    if (p.y >= fy && p.vy > 0) {
      parts.splice(i, 1);
      if (p.r > 0.9 && pools.length < MAX_POOLS * 2) pools.push(mkPool(p.x, fy, p.r * 1.6, 0.5));
    }
  }
  for (let i = crowns.length - 1; i >= 0; i--) { const c = crowns[i]; c.age += dt; if (c.age > c.life) crowns.splice(i, 1); }
  // pools spread fast, then slow, then soak away
  for (let i = pools.length - 1; i >= 0; i--) {
    const p = pools[i];
    p.age += dt;
    p.w = p.w0 + (p.wMax - p.w0) * (1 - Math.exp(-p.age * 5));
    if (p.age > p.life) pools.splice(i, 1);
  }
  while (pools.length > MAX_POOLS * 2) pools.shift();
}

function mkPool(x, y, w, strength = 1) {
  return { x, y, w0: w * 0.4, w, wMax: w, age: 0, life: rnd(5.5, 8.5), strength, seed: Math.random() * 100 };
}

function impact(x, y, r, vy) {
  const energy = Math.min(1.6, vy / 1400) * r;
  // crown sheet
  crowns.push({ x, y, r, age: 0, life: 0.22 + r * 0.01, h: r * (1.6 + energy * 0.4) });
  // secondary droplets: most low and wide, a few tall
  const n = Math.min(MAX_PARTS - parts.length, Math.round(6 + energy * 2.2));
  for (let i = 0; i < n; i++) {
    const side = Math.random() < 0.5 ? -1 : 1;
    const up = Math.random() < 0.25 ? rnd(380, 720) : rnd(140, 380);
    parts.push({ x: x + side * rnd(0, r * 0.8), y: y - 1, vx: side * rnd(60, 340) * (0.6 + energy * 0.15), vy: -up * (0.7 + energy * 0.12),
      r: rnd(0.6, Math.max(1, r * 0.32)), age: 0 });
  }
  // main pool
  const p = mkPool(x, y, r * (2.4 + energy * 0.5), 1);
  p.wMax = p.w; p.w0 = r * 0.9;
  pools.push(p);
}

// ------------------------------------------------------------------ drawing
const DARK = '#3d0000', MID = '#8e0906', HI = '#c8170f';

function bloodFill(x, y, r) {
  const gr = g.createRadialGradient(x - r * 0.35, y - r * 0.2, r * 0.1, x, y, r * 1.25);
  gr.addColorStop(0, HI); gr.addColorStop(0.45, MID); gr.addColorStop(1, DARK);
  return gr;
}

function highlight(x, y, r, a = 0.75) {
  g.fillStyle = `rgba(255,214,205,${a})`;
  g.beginPath(); g.ellipse(x - r * 0.38, y - r * 0.22, r * 0.2, r * 0.3, -0.5, 0, Math.PI * 2); g.fill();
  g.fillStyle = `rgba(255,170,160,${a * 0.25})`;
  g.beginPath(); g.ellipse(x + r * 0.35, y + r * 0.45, r * 0.18, r * 0.09, 0.4, 0, Math.PI * 2); g.fill();
}

function drawBead(b) {
  const { x, y } = b, r = b.r, cy = y + b.sag;
  const film = Math.max(r * 1.15, b.size * 0.5);
  const neck = Math.max(1, r * (0.75 - 0.45 * Math.min(1, b.t / b.hang)));
  g.fillStyle = bloodFill(x, cy, r);
  g.beginPath();
  g.moveTo(x - film, y);
  g.quadraticCurveTo(x - neck * 0.9, y + b.sag * 0.25, x - neck, cy - r * 0.75);
  g.arc(x, cy, r, Math.PI * 1.22, -Math.PI * 0.22, true);   // from upper-left, round the bottom, to upper-right
  g.lineTo(x + neck, cy - r * 0.75);
  g.quadraticCurveTo(x + neck * 0.9, y + b.sag * 0.25, x + film, y);
  g.closePath();
  g.fill();
  highlight(x, cy, r, 0.65);
}

function drawDrop(d) {
  const r = d.r;
  const stretch = Math.min(2.1, 1 + d.vy / 1500) * (1 + 0.12 * Math.sin(d.wob * 38) * Math.exp(-d.wob * 6));
  const top = d.y - r * stretch * 1.9;
  // faint motion streak
  g.strokeStyle = 'rgba(120,6,4,0.18)'; g.lineWidth = r * 0.6;
  g.beginPath(); g.moveTo(d.x, top - Math.min(60, d.vy * 0.03)); g.lineTo(d.x, top + r); g.stroke();
  // recoiling neck on the edge it fell from
  if (d.neck > 0.5) {
    g.fillStyle = MID;
    g.beginPath(); g.ellipse(d.ax, d.ay, r * 0.9, d.neck * 0.5, 0, 0, Math.PI); g.fill();
  }
  g.fillStyle = bloodFill(d.x, d.y, r);
  g.beginPath();
  g.moveTo(d.x, top);
  g.bezierCurveTo(d.x + r * 0.25, top + r * stretch * 0.6, d.x + r, d.y - r * 0.55, d.x + r, d.y);
  g.arc(d.x, d.y, r, 0, Math.PI);
  g.bezierCurveTo(d.x - r, d.y - r * 0.55, d.x - r * 0.25, top + r * stretch * 0.6, d.x, top);
  g.fill();
  highlight(d.x, d.y, r, 0.8);
}

function drawPool(p) {
  const fade = Math.min(1, p.age * 8) * (p.age > p.life - 2.5 ? Math.max(0, (p.life - p.age) / 2.5) : 1) * p.strength;
  if (fade <= 0.01) return;
  const w = p.w, h = Math.max(1.5, w * 0.22);
  const dry = Math.min(1, p.age / p.life);
  g.save();
  g.globalAlpha = fade;
  const gr = g.createRadialGradient(p.x, p.y, 0, p.x, p.y, w);
  gr.addColorStop(0, dry > 0.5 ? '#4a0202' : '#7a0605'); gr.addColorStop(0.75, '#4b0101'); gr.addColorStop(1, 'rgba(40,0,0,0)');
  g.fillStyle = gr;
  g.beginPath();
  // irregular rim
  const N = 18;
  for (let i = 0; i <= N; i++) {
    const a = Math.PI + (i / N) * Math.PI;          // upper half: the visible surface above the screen edge
    const wob = 1 + 0.12 * Math.sin(a * 5 + p.seed) + 0.06 * Math.sin(a * 11 + p.seed * 2);
    const px = p.x + Math.cos(a) * w * wob, py = p.y + Math.sin(a) * h * wob;
    i ? g.lineTo(px, py) : g.moveTo(px, py);
  }
  g.lineTo(p.x + w, p.y + 2); g.lineTo(p.x - w, p.y + 2);
  g.fill();
  // wet sheen while fresh
  if (dry < 0.6) {
    g.globalAlpha = fade * (0.6 - dry) * 0.9;
    g.strokeStyle = 'rgba(255,190,180,0.5)'; g.lineWidth = 1;
    g.beginPath(); g.ellipse(p.x - w * 0.15, p.y - h * 0.55, w * 0.35, h * 0.18, 0, Math.PI * 1.1, Math.PI * 1.9); g.stroke();
  }
  g.restore();
}

function drawCrown(c) {
  const k = c.age / c.life;
  const spread = c.r * (1.2 + 4.2 * Math.pow(k, 0.5));
  const h = c.h * Math.sin(Math.min(1, k * 1.4) * Math.PI);
  g.save();
  g.globalAlpha = 1 - k * 0.6;
  g.fillStyle = MID;
  // sheet: a thin rising wall that flares outward
  g.beginPath();
  g.moveTo(c.x - spread, c.y);
  g.quadraticCurveTo(c.x - spread * 0.95, c.y - h, c.x - spread * 1.12, c.y - h * 1.05);
  g.lineTo(c.x - spread * 0.78, c.y - h * 0.35);
  g.quadraticCurveTo(c.x, c.y - h * 0.15, c.x + spread * 0.78, c.y - h * 0.35);
  g.lineTo(c.x + spread * 1.12, c.y - h * 1.05);
  g.quadraticCurveTo(c.x + spread * 0.95, c.y - h, c.x + spread, c.y);
  g.closePath(); g.fill();
  // crown points
  for (let i = -3; i <= 3; i++) {
    if (!i) continue;
    const px = c.x + spread * (i / 3) * 1.05, py = c.y - h * (0.8 + 0.25 * Math.abs(i) / 3);
    g.beginPath(); g.arc(px, py, Math.max(0.6, c.r * 0.2 * (1 - k)), 0, Math.PI * 2); g.fill();
  }
  g.restore();
}

function draw() {
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, W, H);
  for (const p of pools) drawPool(p);
  for (const c of crowns) drawCrown(c);
  for (const b of beads) drawBead(b);
  for (const d of drops) drawDrop(d);
  g.fillStyle = MID;
  for (const p of parts) {
    const sp = Math.hypot(p.vx, p.vy), st = Math.min(2.5, 1 + sp / 900);
    const a = Math.atan2(p.vy, p.vx);
    g.beginPath(); g.ellipse(p.x, p.y, p.r * st, p.r, a, 0, Math.PI * 2); g.fill();
  }
}

// ------------------------------------------------------------------ public API
function addBead(x, y, opts = {}) {
  if (beads.length + drops.length >= MAX_DROPS) return null;
  const b = { x, y, size: opts.size ?? rnd(7, 12), hang: (opts.hang ?? rnd(900, 2300)) / 1000, t: 0, r: 0, sag: 0, wob: 0 };
  beads.push(b);
  return b;
}

/** Spawn one drip hanging from viewport point (x, y). opts: size (px), hang (ms to form). It falls to the bottom of the screen. */
export function drip(x, y, opts = {}) {
  wake();
  return addBead(x, y, opts);
}

/** Burst of blood at a point (button click): droplets fly out, fall and splash on the floor. */
export function splash(x, y, n = 14) {
  wake();
  for (let i = 0; i < n && parts.length < MAX_PARTS; i++) {
    const a = rnd(-Math.PI, 0), s = rnd(120, 520);
    parts.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 80, r: rnd(1, 3.2), age: 0 });
  }
}

/** Continuous drips from the bottom edge of an element (e.g. the title). Returns a stop function. */
export function dripFrom(el, { every = [1600, 4200], inset = 0.12, size, textOnly = false } = {}) {
  let wait = 0.6;
  const e = {
    tick(dt) {
      wait -= dt;
      if (wait > 0) return;
      wait = (every[0] + Math.random() * (every[1] - every[0])) / 1000;
      if (el.offsetParent === null) return;
      let r = el.getBoundingClientRect();
      if (textOnly && el.firstChild && el.firstChild.nodeType === 3) {
        // drip from the glyphs of the first text node only (e.g. "Blackwood", not the subtitle below it)
        const range = document.createRange(); range.selectNodeContents(el.firstChild);
        r = range.getBoundingClientRect();
      }
      if (!r.width) return;
      const x = r.left + r.width * (inset + Math.random() * (1 - inset * 2));
      addBead(x, r.bottom - r.height * (textOnly ? 0.26 : 0.18), { size: typeof size === 'function' ? size() : size });
    },
  };
  emitters.add(e);
  wake();
  return () => emitters.delete(e);
}
// dev hook: advance the simulation synchronously (visual QA without an animation clock)
export const _dbg = { beads, drops, parts, pools, crowns, advance(secs, dt = 1 / 60) { ensure(); for (let t = 0; t < secs; t += dt) step(dt); draw(); return cv; } };
