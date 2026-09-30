// Main-menu visuals and widgets: storm backdrop, cobwebs, button FX/sounds, profile/map/ghost pickers, settings.
import * as THREE from 'three';
import { settings, saveSettings, QUALITY } from '../core/settings.js';
import { audio } from '../audio/audio.js';
import { MAPS, MAP_LIST, GHOST_TYPES, PROFILES } from '../world/maps.js';
import { cloneCharacter, loadGLTF, prepareCharacter } from '../core/assets.js';
import { Avatar } from '../game/avatar.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

// ============================================================================ cobwebs (SVG)
function webSVG(flip) {
  const R = 460, n = 9, rings = 13;
  const cx = flip ? R : 0, cy = 0;
  const angles = [];
  for (let i = 0; i < n; i++) angles.push((flip ? Math.PI / 2 : 0) + (i / (n - 1)) * (Math.PI / 2) + (Math.random() - 0.5) * 0.08);
  let d = '';
  const pts = angles.map((a) => [cx + Math.cos(a) * R * (flip ? -1 : 1) * (flip ? -1 : 1), cy + Math.sin(a) * R]);
  for (const [x, y] of pts) d += `M${cx},${cy} L${x.toFixed(1)},${y.toFixed(1)} `;
  for (let r = 1; r <= rings; r++) {
    const rr = (r / rings) ** 1.15 * R * 0.97;
    for (let i = 0; i < n - 1; i++) {
      const a0 = angles[i], a1 = angles[i + 1];
      const p0 = [cx + Math.cos(a0) * rr * (flip ? 1 : 1), cy + Math.sin(a0) * rr];
      const p1 = [cx + Math.cos(a1) * rr, cy + Math.sin(a1) * rr];
      const mid = (a0 + a1) / 2, sag = rr * 0.86;
      const c = [cx + Math.cos(mid) * sag, cy + Math.sin(mid) * sag];
      d += `M${p0[0].toFixed(1)},${p0[1].toFixed(1)} Q${c[0].toFixed(1)},${c[1].toFixed(1)} ${p1[0].toFixed(1)},${p1[1].toFixed(1)} `;
    }
  }
  // a torn strand hanging down
  const hx = cx + (flip ? -1 : 1) * R * 0.42;
  d += `M${hx},${R * 0.3} q ${flip ? -8 : 8},60 ${flip ? 4 : -4},140`;
  return `<svg viewBox="0 0 ${R} ${R}" preserveAspectRatio="${flip ? 'xMaxYMin' : 'xMinYMin'} meet"><path d="${d}" stroke="rgba(230,225,215,0.55)" stroke-width="1.1" fill="none"/>
    <circle cx="${hx + (flip ? 4 : -4)}" cy="${R * 0.3 + 140}" r="2.2" fill="rgba(230,225,215,0.7)"/></svg>`;
}

// ============================================================================ storm backdrop
export class MenuBackdrop {
  constructor(canvas) {
    this.cv = canvas;
    this.g = canvas.getContext('2d');
    this.t = 0;
    this.flash = 0;
    this.nextFlash = 3;
    this.drops = Array.from({ length: 420 }, () => ({ x: Math.random(), y: Math.random(), s: 0.6 + Math.random() * 0.8, l: 0.02 + Math.random() * 0.03 }));
    this.fog = Array.from({ length: 7 }, (_, i) => ({ x: Math.random(), y: 0.55 + i * 0.06, s: 0.02 + Math.random() * 0.03, w: 0.6 + Math.random() * 0.5 }));
    this.running = false;
    this.bolt = null;
    this.eyes = 0;
    this.resize();
    addEventListener('resize', () => this.resize());
  }

  resize() {
    const dpr = Math.min(2, devicePixelRatio || 1);
    this.cv.width = innerWidth * dpr; this.cv.height = innerHeight * dpr;
    this.dpr = dpr;
  }

  start() { if (this.running) return; this.running = true; this.last = performance.now(); requestAnimationFrame((t) => this.frame(t)); }
  stop() { this.running = false; }

  _mansion(g, W, H, lit) {
    const base = H * 0.86, s = Math.min(W, H * 1.6) / 1400;
    const x0 = W * 0.5;
    g.save();
    g.translate(x0, base);
    g.scale(s, s);
    g.fillStyle = `rgba(${8 + lit * 40},${8 + lit * 40},${12 + lit * 55},1)`;
    g.beginPath();
    // central block with gable, two wings, towers, chimneys
    g.moveTo(-620, 0); g.lineTo(-620, -210); g.lineTo(-540, -260); g.lineTo(-460, -210); g.lineTo(-460, -230);
    g.lineTo(-300, -230); g.lineTo(-300, -330); g.lineTo(-270, -330); g.lineTo(-270, -380); g.lineTo(-250, -380); g.lineTo(-250, -330);
    g.lineTo(-180, -330); g.lineTo(-180, -300); g.lineTo(0, -440); g.lineTo(180, -300); g.lineTo(180, -330); g.lineTo(240, -330);
    g.lineTo(240, -390); g.lineTo(262, -390); g.lineTo(262, -330); g.lineTo(300, -330); g.lineTo(300, -230); g.lineTo(440, -230);
    g.lineTo(440, -340); g.lineTo(490, -420); g.lineTo(540, -340); g.lineTo(540, -230); g.lineTo(620, -230); g.lineTo(620, 0);
    g.closePath(); g.fill();
    // windows
    const win = (x, y, w, h, on) => {
      g.fillStyle = on ? `rgba(255,${150 + Math.random() * 20},70,${0.55 + Math.random() * 0.1})` : `rgba(${20 + lit * 60},${24 + lit * 70},${34 + lit * 90},1)`;
      g.fillRect(x, y, w, h);
    };
    for (let i = 0; i < 6; i++) for (let j = 0; j < 2; j++) win(-560 + i * 70 + (i > 2 ? 160 : 0) + (i > 2 ? 250 : 0) - (i > 2 ? 250 : 0), -180 + j * 90, 26, 50, false);
    for (let i = 0; i < 5; i++) for (let j = 0; j < 2; j++) win(-150 + i * 65, -260 + j * 100, 28, 60, (i === 1 && j === 0) || (i === 3 && j === 1 && Math.sin(this.t * 0.7) > 0.2));
    for (let i = 0; i < 4; i++) for (let j = 0; j < 2; j++) win(330 + i * 65, -180 + j * 90, 26, 50, i === 2 && j === 0 && Math.sin(this.t * 0.3) > -0.4);
    win(478, -370, 24, 40, false);
    // something in the lit window
    if (this.eyes > 0) {
      g.fillStyle = `rgba(255,40,20,${this.eyes})`;
      g.beginPath(); g.arc(-81, -238, 2.4, 0, 6.3); g.arc(-72, -238, 2.4, 0, 6.3); g.fill();
    }
    // iron fence
    g.fillStyle = 'rgba(4,4,6,1)';
    for (let x = -900; x < 900; x += 22) { g.fillRect(x, -80, 4, 80); g.beginPath(); g.moveTo(x - 3, -80); g.lineTo(x + 2, -94); g.lineTo(x + 7, -80); g.fill(); }
    g.fillRect(-900, -64, 1800, 5); g.fillRect(-900, -20, 1800, 5);
    g.restore();
  }

  _tree(g, x, y, s, lit) {
    g.save(); g.translate(x, y); g.scale(s, s);
    g.strokeStyle = `rgba(${3 + lit * 20},${3 + lit * 20},${5 + lit * 25},1)`;
    g.lineCap = 'round';
    const branch = (len, w, depth) => {
      g.lineWidth = w; g.beginPath(); g.moveTo(0, 0); g.lineTo(0, -len); g.stroke();
      if (depth <= 0) return;
      g.save(); g.translate(0, -len);
      const sway = Math.sin(this.t * 0.8 + depth + x) * 0.02;
      g.save(); g.rotate(-0.45 + sway - depth * 0.02); branch(len * 0.72, w * 0.66, depth - 1); g.restore();
      g.save(); g.rotate(0.38 + sway + depth * 0.03); branch(len * 0.68, w * 0.62, depth - 1); g.restore();
      if (depth % 2) { g.save(); g.rotate(0.05 + sway); branch(len * 0.5, w * 0.5, depth - 2); g.restore(); }
      g.restore();
    };
    branch(140, 16, 6);
    g.restore();
  }

  frame(now) {
    if (!this.running) return;
    const dt = Math.min(0.05, (now - this.last) / 1000); this.last = now;
    this.t += dt;
    const g = this.g, W = this.cv.width, H = this.cv.height;
    this.nextFlash -= dt;
    if (this.nextFlash < 0) {
      this.nextFlash = 5 + Math.random() * 9;
      this.flash = 1;
      this.bolt = this._makeBolt(W, H);
      if (audio.ready) setTimeout(() => audio.play('thunder', { vol: 0.5, close: Math.random() < 0.4 }), 300 + Math.random() * 1200);
      if (Math.random() < 0.5) this.eyes = 1;
    }
    this.flash = Math.max(0, this.flash - dt * 1.8);
    this.eyes = Math.max(0, this.eyes - dt * 0.35);
    const f = this.flash > 0.7 || (this.flash > 0.35 && this.flash < 0.5) ? this.flash : this.flash * 0.25;
    // sky
    const sky = g.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, `rgb(${6 + f * 90},${6 + f * 95},${10 + f * 120})`);
    sky.addColorStop(0.6, `rgb(${14 + f * 50},${8 + f * 45},${10 + f * 60})`);
    sky.addColorStop(1, 'rgb(4,2,2)');
    g.fillStyle = sky; g.fillRect(0, 0, W, H);
    // moon glow behind clouds
    const mg = g.createRadialGradient(W * 0.78, H * 0.22, 0, W * 0.78, H * 0.22, H * 0.35);
    mg.addColorStop(0, 'rgba(160,170,200,0.20)'); mg.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = mg; g.fillRect(0, 0, W, H);
    if (this.bolt && this.flash > 0.45) {
      g.strokeStyle = `rgba(220,230,255,${this.flash})`; g.lineWidth = 2.2 * this.dpr; g.shadowColor = '#9fb4ff'; g.shadowBlur = 20;
      g.beginPath(); this.bolt.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.stroke();
      g.shadowBlur = 0;
    }
    this._tree(g, W * 0.1, H * 0.95, H / 900, f);
    this._tree(g, W * 0.93, H * 0.97, H / 1100, f);
    this._mansion(g, W, H, f);
    // ground
    g.fillStyle = 'rgb(3,2,2)'; g.fillRect(0, H * 0.86, W, H * 0.14);
    // drifting fog banks
    for (const fb of this.fog) {
      fb.x += fb.s * dt * 0.1;
      const x = ((fb.x % 1.6) - 0.3) * W, y = fb.y * H;
      const gr = g.createRadialGradient(x, y, 0, x, y, fb.w * W * 0.5);
      gr.addColorStop(0, `rgba(${60 + f * 60},${55 + f * 60},${60 + f * 80},0.16)`); gr.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = gr; g.fillRect(x - W, y - H * 0.3, W * 2, H * 0.6);
    }
    // rain
    g.strokeStyle = `rgba(170,180,200,${0.18 + f * 0.3})`; g.lineWidth = 1 * this.dpr;
    g.beginPath();
    for (const d of this.drops) {
      d.y += dt * d.s * 1.6; d.x += dt * 0.05;
      if (d.y > 1) { d.y -= 1.05; d.x = Math.random(); }
      const x = (d.x % 1) * W, y = d.y * H;
      g.moveTo(x, y); g.lineTo(x + d.l * H * 0.15, y + d.l * H);
    }
    g.stroke();
    // blood-red floor glow
    const bg = g.createRadialGradient(W / 2, H * 1.1, 0, W / 2, H * 1.1, H * 0.7);
    bg.addColorStop(0, 'rgba(120,8,8,0.25)'); bg.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = bg; g.fillRect(0, 0, W, H);
    requestAnimationFrame((t) => this.frame(t));
  }

  _makeBolt(W, H) {
    let x = W * (0.15 + Math.random() * 0.7), y = 0;
    const pts = [[x, y]];
    while (y < H * 0.55) { x += (Math.random() - 0.5) * W * 0.05; y += H * (0.02 + Math.random() * 0.04); pts.push([x, y]); }
    return pts;
  }
}

// ============================================================================ button FX + sounds
export function wireButtonFX(root = document) {
  root.addEventListener('pointerover', (e) => {
    const b = e.target.closest('button, .prof, .map, .ghost');
    if (!b || b.contains(e.relatedTarget)) return;
    audio.play('ui_hover');
  });
  root.addEventListener('pointerdown', (e) => {
    const b = e.target.closest('button, .prof, .map, .ghost');
    if (!b) return;
    audio.play(b.classList.contains('back') ? 'ui_back' : 'ui_click');
    if (b.classList.contains('bb')) splat(e.clientX, e.clientY);
  });
}

function splat(x, y) {
  for (let i = 0; i < 14; i++) {
    const s = document.createElement('i');
    s.className = 'splat';
    const a = Math.random() * Math.PI * 2, r = 20 + Math.random() * 70;
    s.style.left = x + 'px'; s.style.top = y + 'px';
    s.style.setProperty('--dx', Math.cos(a) * r + 'px');
    s.style.setProperty('--dy', Math.sin(a) * r * 0.6 + Math.random() * 40 + 'px');
    const sz = 3 + Math.random() * 9; s.style.width = s.style.height = sz + 'px';
    document.body.appendChild(s);
    setTimeout(() => s.remove(), 800);
  }
}

// ============================================================================ pickers
export function drawMapPreview(cv, def) {
  const g = cv.getContext('2d');
  const W = cv.width = 320, H = cv.height = 240;
  g.fillStyle = '#0c0908'; g.fillRect(0, 0, W, H);
  const pad = 14, gap = 10;
  const s = Math.min((W - pad * 2 - gap) / 2 / def.size[0], (H - pad * 2 - 16) / def.size[1]);
  for (let l = 0; l < 2; l++) {
    const ox = pad + l * ((W - pad * 2 + gap) / 2), oy = pad + 16;
    g.fillStyle = '#8f877b'; g.font = '10px "Special Elite", monospace';
    g.fillText(l ? 'UPPER' : 'GROUND', ox, pad + 8);
    for (const r of def.rooms) {
      const layers = r.f === 'both' ? [0, 1] : [r.f];
      if (!layers.includes(l)) continue;
      g.fillStyle = r.type === 'stairs' ? 'rgba(195,20,15,0.35)' : r.keyRoom ? 'rgba(176,138,74,0.35)' : 'rgba(216,207,192,0.08)';
      g.fillRect(ox + r.x * s, oy + r.z * s, r.w * s, r.d * s);
      g.strokeStyle = 'rgba(216,207,192,0.5)'; g.lineWidth = 1;
      g.strokeRect(ox + r.x * s + 0.5, oy + r.z * s + 0.5, r.w * s - 1, r.d * s - 1);
    }
    if (l === 0) { g.fillStyle = '#c3140f'; g.fillRect(ox + (def.gate.at - 1.2) * s, oy - 2, 2.4 * s, 4); }
  }
}

/** Render real 3D portraits of the six survivor profiles (once, off-screen). */
export async function renderProfileThumbs() {
  await loadGLTF('player');
  const W = 180, H = 230;
  const r = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  r.setSize(W, H); r.setPixelRatio(1);
  r.outputColorSpace = THREE.SRGBColorSpace;
  r.toneMapping = THREE.ACESFilmicToneMapping;
  const scene = new THREE.Scene();
  const cam = new THREE.PerspectiveCamera(26, W / H, 0.1, 20);
  cam.position.set(0.5, 1.45, 2.6); cam.lookAt(0, 1.25, 0);
  scene.add(new THREE.HemisphereLight(0x8090b0, 0x201010, 0.7));
  const key = new THREE.DirectionalLight(0xffd8b0, 2.4); key.position.set(1.5, 2.5, 2); scene.add(key);
  const rim = new THREE.DirectionalLight(0xff3020, 2.5); rim.position.set(-2, 1.8, -1.5); scene.add(rim);
  const out = [];
  for (const P of PROFILES) {
    const a = new Avatar('player', { profile: P.id });
    a.play('Idle'); a.mixer.update(0.8);
    a.attach.flashlight && (a.attach.flashlight.visible = false);
    scene.add(a.root);
    r.render(scene, cam);
    out.push(r.domElement.toDataURL('image/webp', 0.9));
    a.dispose();
  }
  r.dispose();
  void cloneCharacter; void prepareCharacter;
  return out;
}

export function buildProfiles(container, thumbs, onPick) {
  container.innerHTML = '';
  const cards = [{ id: -1, name: 'Random', desc: 'Surprise me' }, ...PROFILES].map((P) => {
    const el = document.createElement('div');
    el.className = 'prof' + (settings.profile === P.id ? ' on' : '');
    const th = P.id >= 0 && thumbs ? `<img src="${thumbs[P.id]}" alt="" style="height:96px;display:block;margin:0 auto 4px">`
      : P.id >= 0 ? `<div class="av"><div class="t" style="background:#${P.topColor.toString(16).padStart(6, '0')}"></div><div class="h" style="background:#${P.skin.toString(16).padStart(6, '0')}"></div>${P.hat ? `<div class="x" style="background:#${(P.hatColor || 0).toString(16).padStart(6, '0')}"></div>` : ''}</div>`
        : '<div class="av" style="display:grid;place-items:center;font-size:40px;color:#8f877b">?</div>';
    el.innerHTML = `${th}<b>${P.name}</b><small>${P.desc}</small>`;
    el.onclick = () => { $$('.prof', container).forEach((x) => x.classList.remove('on')); el.classList.add('on'); onPick(P.id); };
    return el;
  });
  cards.slice(0, 7).forEach((c) => container.appendChild(c));
  container.style.gridTemplateColumns = 'repeat(4, 1fr)';
}

export function buildMaps(container, current, onPick) {
  container.innerHTML = '';
  for (const id of MAP_LIST) {
    const def = MAPS[id];
    const el = document.createElement('div');
    el.className = 'map' + (id === current ? ' on' : '');
    const cv = document.createElement('canvas');
    drawMapPreview(cv, def);
    el.appendChild(cv);
    const info = document.createElement('div');
    info.innerHTML = `<b>${def.name}</b><small>${def.difficulty}</small>`;
    info.title = def.desc;
    el.appendChild(info);
    el.onclick = () => { $$('.map', container).forEach((x) => x.classList.remove('on')); el.classList.add('on'); onPick(id); };
    container.appendChild(el);
  }
}

export function buildGhosts(container, selected, onToggle) {
  container.innerHTML = '';
  for (const g of Object.values(GHOST_TYPES)) {
    const el = document.createElement('div');
    el.className = 'ghost' + (selected.includes(g.id) ? ' on' : '');
    el.dataset.id = g.id;
    el.innerHTML = `<img src="${g.img}" alt="${g.name}"><div><b>${g.name}</b><small>${g.blurb}</small></div>`;
    el.onclick = () => onToggle(g.id);
    container.appendChild(el);
  }
}

export function refreshGhosts(container, selected) {
  $$('.ghost', container).forEach((el) => el.classList.toggle('on', selected.includes(el.dataset.id)));
}

// ============================================================================ settings panel
const QHINT = {
  low: 'Native resolution · no MSAA · 512 shadows · 3 dynamic lights. For integrated GPUs.',
  medium: 'Up to 1.25× pixel density · 4× MSAA · bloom · 1K shadows · 4 dynamic lights.',
  high: 'Up to 2× (retina) · 4× MSAA · bloom · 2K shadows · physical materials · 6 dynamic lights.',
  max: 'Full display density · 8× MSAA · 4K shadows · 8 dynamic lights · 16× anisotropic.',
};

export function bindSettings(onChange) {
  const seg = $('#quality');
  const setQ = () => { $$('button', seg).forEach((b) => b.classList.toggle('on', b.dataset.v === settings.quality)); $('#quality-hint').textContent = QHINT[settings.quality] + ' Resolution is never lowered below native.'; };
  seg.onclick = (e) => { const b = e.target.closest('button'); if (!b) return; settings.quality = b.dataset.v; setQ(); saveSettings(); onChange('quality'); };
  setQ();
  const fmt = { brightness: (v) => Math.round(v * 100) + '%', fov: (v) => v + '°', sensitivity: (v) => (+v).toFixed(2) };
  for (const k of ['brightness', 'fov', 'master', 'music', 'sfx', 'voice', 'sensitivity']) {
    const el = $('#s-' + k);
    const em = el.parentElement.querySelector('em');
    const paint = () => {
      const v = +el.value;
      em.textContent = fmt[k] ? fmt[k](v) : Math.round(v * 100) + '%';
      el.style.setProperty('--p', ((v - el.min) / (el.max - el.min)) * 100 + '%');
    };
    el.value = settings[k];
    paint();
    el.oninput = () => { settings[k] = +el.value; paint(); audio.applyVolumes(); onChange(k); };
    el.onchange = () => saveSettings();
  }
  for (const k of ['invertY', 'headBob', 'subtitles', 'showFps', 'voiceChat']) {
    const el = $('#s-' + k);
    el.checked = !!settings[k];
    el.onchange = () => { settings[k] = el.checked; saveSettings(); onChange(k); };
  }
  void QUALITY;
}

export function initWebs() {
  $('.web-tl').innerHTML = webSVG(false);
  $('.web-tr').innerHTML = webSVG(true);
}

export { $, $$ };
