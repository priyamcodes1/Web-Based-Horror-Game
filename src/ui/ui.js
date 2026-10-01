// Menus + HUD (DOM). Menu visuals: procedural spider webs, stormy canvas backdrop, blood-drop buttons.
import { settings, saveSettings, QUALITY } from '../core/settings.js';
import { audio } from '../audio/audio.js';
import { MAPS, MAP_LIST, GHOST_TYPES } from '../world/maps.js';
import { CAST, castById } from '../entities/cast.js';
import { CharStage } from './preview.js';
import { drip, dripFrom, splash } from './drips.js';

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];

// ============================================================================ webs + menu backdrop
function webSVG(flip) {
  const S = 460, cx = flip ? S : 0, cy = 0;
  let d = '';
  const spokes = 11, rings = 13;
  const ang = (i) => (flip ? Math.PI / 2 : 0) + (i / (spokes - 1)) * (Math.PI / 2);
  const R = (i, k) => (k / rings) * S * (0.95 + 0.1 * Math.sin(i * 3.1 + k));
  for (let i = 0; i < spokes; i++) {
    const a = ang(i);
    d += `M${cx},${cy} L${cx + Math.cos(a) * S * 1.05 * (flip ? -1 : 1) * (flip ? -1 : 1)},${cy + Math.sin(a) * S * 1.05} `;
  }
  for (let k = 1; k <= rings; k++) {
    for (let i = 0; i < spokes - 1; i++) {
      const a0 = ang(i), a1 = ang(i + 1);
      const r0 = R(i, k), r1 = R(i + 1, k);
      const x0 = cx + Math.cos(a0) * r0, y0 = cy + Math.sin(a0) * r0;
      const x1 = cx + Math.cos(a1) * r1, y1 = cy + Math.sin(a1) * r1;
      const am = (a0 + a1) / 2, rm = (r0 + r1) / 2 * 0.9;
      d += `M${x0.toFixed(1)},${y0.toFixed(1)} Q${(cx + Math.cos(am) * rm).toFixed(1)},${(cy + Math.sin(am) * rm).toFixed(1)} ${x1.toFixed(1)},${y1.toFixed(1)} `;
    }
  }
  return `<svg viewBox="0 0 ${S} ${S}" xmlns="http://www.w3.org/2000/svg"><path d="${d}" fill="none" stroke="rgba(230,225,215,.55)" stroke-width="1"/>
    <circle cx="${flip ? S - 150 : 150}" cy="120" r="2.2" fill="#ddd" opacity=".7"/><circle cx="${flip ? S - 90 : 90}" cy="210" r="1.6" fill="#ddd" opacity=".6"/></svg>`;
}

function menuBackdrop(canvas) {
  const g = canvas.getContext('2d');
  let W, H, t = 0, flash = 0, next = 3;
  const drops = Array.from({ length: 420 }, () => ({ x: Math.random(), y: Math.random(), s: 0.6 + Math.random() }));
  const fog = Array.from({ length: 7 }, (_, i) => ({ x: Math.random(), y: 0.55 + Math.random() * 0.4, r: 0.35 + Math.random() * 0.4, v: 0.004 + Math.random() * 0.01, i }));
  const resize = () => { W = canvas.width = innerWidth; H = canvas.height = innerHeight; };
  resize(); addEventListener('resize', resize);
  const house = (x0, base, w) => {
    g.beginPath();
    g.moveTo(x0, base); g.lineTo(x0, base - w * 0.28); g.lineTo(x0 + w * 0.12, base - w * 0.42); g.lineTo(x0 + w * 0.16, base - w * 0.52);
    g.lineTo(x0 + w * 0.18, base - w * 0.42); g.lineTo(x0 + w * 0.42, base - w * 0.42); g.lineTo(x0 + w * 0.5, base - w * 0.6);
    g.lineTo(x0 + w * 0.58, base - w * 0.42); g.lineTo(x0 + w * 0.82, base - w * 0.42); g.lineTo(x0 + w * 0.86, base - w * 0.5);
    g.lineTo(x0 + w * 0.88, base - w * 0.42); g.lineTo(x0 + w, base - w * 0.28); g.lineTo(x0 + w, base); g.closePath(); g.fill();
  };
  let alive = true;
  const frame = () => {
    if (!alive) return;
    t += 1 / 60;
    next -= 1 / 60;
    if (next <= 0) { flash = 1; next = 5 + Math.random() * 9; setTimeout(() => audio.ready && audio.play('thunder', { vol: 0.5 }), 400 + Math.random() * 900); }
    flash *= 0.9;
    const f = flash > 0.05 ? flash * (Math.random() > 0.3 ? 1 : 0.4) : 0;
    const grd = g.createLinearGradient(0, 0, 0, H);
    grd.addColorStop(0, `rgb(${6 + f * 90},${7 + f * 95},${12 + f * 120})`); grd.addColorStop(1, '#000');
    g.fillStyle = grd; g.fillRect(0, 0, W, H);
    // manor silhouette with a single lit window
    g.fillStyle = `rgba(0,0,0,${0.92})`;
    const w = Math.min(W * 0.62, 900), base = H * 0.86;
    house(W / 2 - w / 2, base, w);
    const lit = 0.6 + 0.4 * Math.sin(t * 7) * Math.sin(t * 3.1);
    g.fillStyle = `rgba(255,150,60,${0.35 * lit})`;
    g.fillRect(W / 2 + w * 0.2, base - w * 0.33, w * 0.025, w * 0.045);
    g.fillStyle = '#000'; g.fillRect(0, base, W, H - base);
    // dead trees
    g.strokeStyle = '#000'; g.lineWidth = 3;
    for (const [tx, s] of [[0.12, 1.2], [0.86, 1], [0.95, 0.8]]) {
      const bx = W * tx; g.beginPath(); g.moveTo(bx, base); g.lineTo(bx + 4, base - 180 * s);
      for (let k = 0; k < 6; k++) { const y = base - (60 + k * 22) * s; g.moveTo(bx + 2, y); g.lineTo(bx + (k % 2 ? 1 : -1) * (40 + k * 6) * s, y - 40 * s); }
      g.stroke();
    }
    // fog
    for (const fo of fog) {
      fo.x += fo.v / 10;
      const x = ((fo.x % 1.4) - 0.2) * W, y = fo.y * H, r = fo.r * W;
      const fg = g.createRadialGradient(x, y, 0, x, y, r);
      fg.addColorStop(0, `rgba(140,140,150,${0.07 + f * 0.1})`); fg.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = fg; g.fillRect(x - r, y - r, r * 2, r * 2);
    }
    // rain
    g.strokeStyle = `rgba(170,180,200,${0.22 + f * 0.3})`; g.lineWidth = 1;
    g.beginPath();
    for (const d of drops) {
      d.y += 0.018 * d.s; d.x -= 0.002 * d.s; if (d.y > 1) { d.y -= 1; d.x = Math.random(); }
      const x = d.x * W, y = d.y * H; g.moveTo(x, y); g.lineTo(x - 3 * d.s, y + 16 * d.s);
    }
    g.stroke();
    requestAnimationFrame(frame);
  };
  frame();
  return () => { alive = false; };
}

function splat(e) { splash(e.clientX, e.clientY, 16); }

// ============================================================================ Menu
export class Menu {
  constructor(handlers) {
    this.h = handlers;
    this.stack = ['m-main'];
    this.cfg = { mode: 'solo', map: 'blackwood', ghostCount: 1, ghostTypes: ['widow'], lives: 3, difficulty: 'normal' };
    $('.web-tl').innerHTML = webSVG(false);
    $('.web-tr').innerHTML = webSVG(true);
    this.stopBg = menuBackdrop($('#menu-bg'));
    this.stopDrips = dripFrom($('.title'), { every: [1300, 3200], inset: 0.08, textOnly: true, size: () => 10 + Math.random() * 7 });
    this.wire();
    this.buildProfiles(); this.buildMaps(); this.buildGhosts(); this.bindSettings();
    $('#in-name').value = settings.playerName || '';
  }

  wire() {
    document.addEventListener('pointerdown', () => { audio.init(); if (!audio.loops.menu && $('#menu').classList.contains('active')) audio.startLoop('menu', { vol: 0.7 }); }, { once: false });
    document.addEventListener('mouseover', (e) => {
      const b = e.target.closest('button');
      if (b && b !== this._hov) {
        this._hov = b; audio.play('ui_hover');
        if (b.classList.contains('bb')) {
          // blood gathers under the button edge and falls
          const r = b.getBoundingClientRect();
          const x = r.left + r.width * (0.55 + Math.random() * 0.3);
          setTimeout(() => this._hov === b && drip(x, r.bottom - 1, { size: 6 + Math.random() * 3, hang: 650 + Math.random() * 500 }), 220);
        }
      } else if (!b) this._hov = null;
    });
    document.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      audio.play(b.classList.contains('back') ? 'ui_back' : 'ui_click');
      if (b.classList.contains('bb')) splat(e);
      if (b.dataset.go) this.go(b.dataset.go);
      if (b.hasAttribute('data-back')) this.back();
    });
    const seg = (id, key, cb) => $$(`#${id} button`).forEach((b) => b.addEventListener('click', () => {
      $$(`#${id} button`).forEach((x) => x.classList.toggle('on', x === b));
      this.cfg[key] = isNaN(+b.dataset.v) ? b.dataset.v : +b.dataset.v;
      cb && cb(this.cfg[key]);
    }));
    seg('mode-seg', 'mode', (v) => {
      $('#join-box').classList.toggle('hidden', v !== 'join');
      $$('.host-only').forEach((el) => el.classList.toggle('hidden', v === 'join'));
      $('#btn-start span').textContent = v === 'solo' ? 'Enter the Manor' : v === 'host' ? 'Create Lobby' : 'Join Lobby';
    });
    seg('ghost-count', 'ghostCount', (v) => { $('#ghost-count-label').textContent = v; this.fixGhosts(); });
    seg('difficulty', 'difficulty');
    $$('#lives button').forEach((b) => b.addEventListener('click', () => {
      this.cfg.lives = Math.max(1, Math.min(5, this.cfg.lives + +b.dataset.d));
      $('#lives b').textContent = this.cfg.lives;
    }));
    $('#btn-start').addEventListener('click', () => {
      settings.playerName = ($('#in-name').value || '').trim().slice(0, 16) || 'Survivor';
      saveSettings();
      this.h.start({ ...this.cfg, name: settings.playerName, profile: this.profile, code: ($('#in-code').value || '').trim().toUpperCase() });
    });
    $('#btn-lobby-start').addEventListener('click', () => this.h.lobbyStart());
    $('#lobby-leave').addEventListener('click', () => this.h.leaveLobby());
    $('#copy-code').addEventListener('click', () => { try { navigator.clipboard.writeText($('#lobby-code').textContent); } catch (_) { /* ignore */ } });
  }

  go(id) {
    $$('#menu .panel').forEach((p) => p.classList.toggle('active', p.id === id));
    if (id === 'm-play') this.initStage();
    if (id === 'm-credits') this.fillCredits();
    if (this.stack.at(-1) !== id) this.stack.push(id);
    if (id === 'm-settings') this.refreshSettings();
  }

  back() {
    this.stack.pop();
    const prev = this.stack.at(-1) || 'm-main';
    if (this.h.inGame && this.h.inGame()) { this.hide(); this.h.backToPause(); return; }
    this.go(prev);
  }

  show(panel = 'm-main') { $('#menu').classList.add('active'); this.go(panel); }
  hide() {
    $('#menu').classList.remove('active');
    // the game needs the whole GPU: drop the menu's character stage (rebuilt when the play screen reopens)
    if (this.stage) {
      this.stage.dispose(); this.stage = null;
      const old = $('#surv-view'), cv = old.cloneNode(false); old.replaceWith(cv);
      $('#surv-load').classList.remove('done');
    }
  }

  buildProfiles() {
    const box = $('#profiles');
    this.profile = settings.profile >= 0 && settings.profile < CAST.length ? settings.profile : Math.floor(Math.random() * CAST.length);
    box.innerHTML = CAST.map((p, i) => `<div class="prof ${i === this.profile ? 'on' : ''}" data-id="${i}" title="${p.name} — ${p.desc}"><div class="ph-img"></div><b>${p.name}</b></div>`).join('');
    const pick = (i) => {
      this.profile = (i + CAST.length) % CAST.length; settings.profile = this.profile; saveSettings();
      box.querySelectorAll('.prof').forEach((x) => x.classList.toggle('on', +x.dataset.id === this.profile));
      const c = CAST[this.profile];
      $('#surv-name').textContent = c.name; $('#surv-desc').textContent = c.desc;
      $('#surv-count').textContent = `${this.profile + 1} / ${CAST.length}`;
      this.stage?.show(this.profile);
    };
    box.querySelectorAll('.prof').forEach((el) => el.addEventListener('click', () => { pick(+el.dataset.id); audio.play('ui_click'); }));
    $('#surv-prev').addEventListener('click', () => pick(this.profile - 1));
    $('#surv-next').addEventListener('click', () => pick(this.profile + 1));
    pick(this.profile);
  }

  /** Third-party asset attributions (CC-BY requires it; CC0 is credited as thanks). */
  async fillCredits() {
    if (this._credits) return;
    this._credits = true;
    const el = $('#cr-licenses');
    try {
      const [chars, sfx] = await Promise.all([fetch('/models/chars/licenses.json').then((r) => r.json()), fetch('/audio/credits.json').then((r) => r.json())]);
      const by = chars.filter((c) => c.license !== 'CC0');
      const authors = [...new Set(Object.values(sfx).flat().map((c) => c.author))].sort((x, y) => x.localeCompare(y));
      el.innerHTML = `<b>Characters</b>: built on MakeHuman / MPFB (CC0). Garments under CC-BY 4.0: ${by.map((c) => `${escapeHtml(c.asset.replace(/^[a-z]+_/, '').replace(/_/g, ' '))} by ${escapeHtml(c.author)}`).join(', ')}.<br>
        <b>Motion capture</b>: data from mocap.cs.cmu.edu — created with funding from NSF EIA-0196217.<br>
        <b>Sound</b>: ${Object.values(sfx).flat().length} CC0 recordings from Freesound.org by ${authors.map(escapeHtml).join(', ')}.`;
    } catch (_) { el.textContent = ''; }
  }

  /** Lazy: the 3D stage + real-model portraits load the first time the play screen opens. */
  async initStage() {
    if (this.stage) return;
    this.stage = new CharStage($('#surv-view'));
    this.stage.start();
    try {
      await this.stage.load();
      $('#surv-load').classList.add('done');
      this.stage.show(this.profile);
      await new Promise((r) => setTimeout(r, 30));
      $$('#profiles .prof').forEach((el) => {
        const ph = el.querySelector('.ph-img');
        if (!ph) return;                                   // already rendered on an earlier visit
        ph.outerHTML = `<img alt="" src="${this.stage.portrait(+el.dataset.id)}">`;
      });
      this.stage.show(this.profile);
      // ghosts: portraits rendered from their models too
      for (const el of $$('#ghosts .ghost')) {
        if (el.dataset.rendered) continue; el.dataset.rendered = 1;
        const gt = GHOST_TYPES[el.dataset.id];
        try { el.querySelector('img').src = await this.stage.ghostPortrait(gt.model); } catch (_) { /* keep painting */ }
      }
    } catch (e) {
      console.warn('stage', e);
      $('#surv-load').textContent = 'Preview unavailable';
    }
  }

  buildMaps() {
    const box = $('#maps');
    box.innerHTML = MAP_LIST.map((id) => `<div class="map ${id === this.cfg.map ? 'on' : ''}" data-id="${id}"><canvas width="240" height="180"></canvas>
      <div><b>${MAPS[id].name}</b><small>${MAPS[id].difficulty}</small></div></div>`).join('');
    box.querySelectorAll('.map').forEach((el) => {
      drawPlan(el.querySelector('canvas'), MAPS[el.dataset.id]);
      el.title = MAPS[el.dataset.id].desc;
      el.addEventListener('click', () => { this.cfg.map = el.dataset.id; box.querySelectorAll('.map').forEach((x) => x.classList.toggle('on', x === el)); audio.play('ui_click'); });
    });
  }

  buildGhosts() {
    const box = $('#ghosts');
    box.innerHTML = Object.values(GHOST_TYPES).map((gt) => `<div class="ghost ${this.cfg.ghostTypes.includes(gt.id) ? 'on' : ''}" data-id="${gt.id}">
      <img src="${gt.img}" alt="${gt.name}"/><div><b>${gt.name}</b><small>${gt.blurb}</small></div></div>`).join('');
    box.querySelectorAll('.ghost').forEach((el) => el.addEventListener('click', () => {
      const id = el.dataset.id, list = this.cfg.ghostTypes;
      if (list.includes(id)) { if (list.length > 1) list.splice(list.indexOf(id), 1); }
      else { list.push(id); while (list.length > this.cfg.ghostCount) list.shift(); }
      this.fixGhosts(); audio.play('ui_click');
    }));
  }

  fixGhosts() {
    while (this.cfg.ghostTypes.length > this.cfg.ghostCount) this.cfg.ghostTypes.shift();
    $$('#ghosts .ghost').forEach((x) => x.classList.toggle('on', this.cfg.ghostTypes.includes(x.dataset.id)));
  }

  bindSettings() {
    const ranges = ['brightness', 'fov', 'master', 'music', 'sfx', 'voice', 'sensitivity'];
    for (const k of ranges) {
      const el = $('#s-' + k);
      const show = () => {
        el.nextElementSibling.textContent = k === 'fov' ? `${settings[k]}°` : ['master', 'music', 'sfx', 'voice'].includes(k) ? `${Math.round(settings[k] * 100)}%` : (+settings[k]).toFixed(2);
        el.style.setProperty('--p', ((el.value - el.min) / (el.max - el.min) * 100) + '%');
      };
      el.addEventListener('input', () => { settings[k] = +el.value; show(); audio.applyVolumes(); saveSettings(); this.h.settingsChanged?.(k); });
      el._show = show;
    }
    for (const k of ['invertY', 'headBob', 'subtitles', 'showFps', 'voiceChat']) {
      const el = $('#s-' + k);
      el.addEventListener('change', () => { settings[k] = el.checked; saveSettings(); this.h.settingsChanged?.(k); });
    }
    $$('#quality button').forEach((b) => b.addEventListener('click', () => {
      settings.quality = b.dataset.v; saveSettings(); this.refreshSettings(); this.h.settingsChanged?.('quality');
    }));
    $$('#voice-mode button').forEach((b) => b.addEventListener('click', () => {
      settings.voiceMode = b.dataset.v; saveSettings(); this.refreshSettings(); this.h.settingsChanged?.('voiceMode');
    }));
  }

  refreshSettings() {
    for (const k of ['brightness', 'fov', 'master', 'music', 'sfx', 'voice', 'sensitivity']) { const el = $('#s-' + k); el.value = settings[k]; el._show(); }
    for (const k of ['invertY', 'headBob', 'subtitles', 'showFps', 'voiceChat']) $('#s-' + k).checked = !!settings[k];
    $$('#quality button').forEach((b) => b.classList.toggle('on', b.dataset.v === settings.quality));
    $$('#voice-mode button').forEach((b) => b.classList.toggle('on', b.dataset.v === (settings.voiceMode || 'ptt')));
    const q = QUALITY[settings.quality];
    $('#quality-hint').textContent = `${q.shadowSize}px flashlight shadows · ${q.msaa ? q.msaa + '× MSAA' : 'no MSAA'} · ${q.lightPool} dynamic lights · ${q.bloom ? 'bloom' : 'no bloom'} · textures ${q.texRes}`;
  }

  lobby(code, players, isHost, cfg) {
    this.go('m-lobby');
    $('#lobby-code').textContent = code;
    const hex = (n) => '#' + n.toString(16).padStart(6, '0');
    const face = (i) => { const el = $(`#profiles .prof[data-id="${((i % CAST.length) + CAST.length) % CAST.length}"] img`); return el ? `<img src="${el.src}" alt="">` : '<i></i>'; };
    $('#lobby-list').innerHTML = players.map((p) => `<li>${face(p.profile | 0)}<span>${escapeHtml(p.name)}</span><em>${p.host ? 'HOST · ' : ''}${castById(p.profile | 0).name}</em></li>`).join('');
    $('#btn-lobby-start').classList.toggle('hidden', !isHost);
    $('#lobby-hint').textContent = isHost ? 'Share the code with friends (up to 8). Start when everyone is in.' : 'Waiting for the host to start…';
    if (cfg) {
      $('#lobby-cfg').textContent = `${MAPS[cfg.map].name} · ${cfg.ghostCount} ghost${cfg.ghostCount > 1 ? 's' : ''} (${cfg.ghostTypes.map((g) => GHOST_TYPES[g].name).join(', ')}) · ${cfg.lives} lives · ${cfg.difficulty}`;
    }
  }

  error(msg) { alert(msg); }
}

function escapeHtml(s) { return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

function drawPlan(cv, map) {
  const g = cv.getContext('2d');
  const [W, D] = map.size;
  g.fillStyle = '#120c0a'; g.fillRect(0, 0, cv.width, cv.height);
  const s = Math.min((cv.width - 20) / W, (cv.height - 20) / D);
  const ox = (cv.width - W * s) / 2, oz = (cv.height - D * s) / 2;
  g.strokeStyle = 'rgba(220,200,170,.8)'; g.lineWidth = 1;
  for (const r of map.rooms.filter((x) => x.f === 0 || x.f === 'both')) {
    g.fillStyle = r.type === 'stairs' ? 'rgba(160,30,20,.5)' : 'rgba(80,60,50,.35)';
    g.fillRect(ox + r.x * s, oz + (D - r.z - r.d) * s, r.w * s, r.d * s);
    g.strokeRect(ox + r.x * s + 0.5, oz + (D - r.z - r.d) * s + 0.5, r.w * s - 1, r.d * s - 1);
  }
  g.fillStyle = '#c3140f'; g.fillRect(ox + (map.gate.at - 1) * s, oz + D * s - 2, 2 * s, 3);
}

// ============================================================================ HUD
const ICONS = {
  battery: '<svg viewBox="0 0 32 32"><rect x="9" y="6" width="14" height="22" rx="2" fill="none" stroke="#ddd" stroke-width="2"/><rect x="13" y="3" width="6" height="3" fill="#ddd"/><rect x="12" y="15" width="8" height="10" fill="#ddd"/></svg>',
  medkit: '<svg viewBox="0 0 32 32"><rect x="4" y="9" width="24" height="17" rx="3" fill="#ddd"/><path d="M16 12v11M10.5 17.5h11" stroke="#8a0b0b" stroke-width="4"/></svg>',
  syringe: '<svg viewBox="0 0 32 32"><path d="M6 26l4-4M9 23l12-12 4 4-12 12zM21 11l3-3 4 4-3 3M24 8l2-2" stroke="#ddd" stroke-width="2" fill="none"/><path d="M12 20l7-7 2 2-7 7z" fill="#c3140f"/></svg>',
  pills: '<svg viewBox="0 0 32 32"><rect x="10" y="9" width="12" height="18" rx="2" fill="none" stroke="#ddd" stroke-width="2"/><rect x="9" y="5" width="14" height="5" rx="1" fill="#ddd"/><rect x="11" y="15" width="10" height="6" fill="#bbb"/></svg>',
  crucifix: '<svg viewBox="0 0 32 32"><path d="M16 4v24M9 11h14" stroke="#d6b36a" stroke-width="3.5" stroke-linecap="round"/></svg>',
  fuse: '<svg viewBox="0 0 32 32"><rect x="10" y="9" width="12" height="14" rx="3" fill="none" stroke="#ffd48a" stroke-width="2"/><path d="M16 4v5M16 23v5M13 16h6" stroke="#ffd48a" stroke-width="2"/></svg>',
  crowbar: '<svg viewBox="0 0 32 32"><path d="M8 27L24 7l3 2-2 3" stroke="#b44" stroke-width="3" fill="none" stroke-linecap="round"/></svg>',
};
const KEY_SVG = (c) => `<svg viewBox="0 0 32 32"><circle cx="9" cy="16" r="5" fill="none" stroke="${c}" stroke-width="2.5"/><path d="M14 16h14M24 16v5M20 16v4" stroke="${c}" stroke-width="2.5"/></svg>`;

export class Hud {
  constructor() {
    this.el = $('#hud');
    this.notifyT = 0; this.subT = 0;
    this.buildHotbar();
    $('#keyring').innerHTML = [['brass', '#c9a24a'], ['silver', '#d8d8e0'], ['iron', '#8a8a90']].map(([k, c]) => `<span data-k="${k}" title="${k} key">${KEY_SVG(c)}</span>`).join('');
    this.fpsT = 0; this.frames = 0;
    this.map = { canvas: $('#tabmap-canvas') };
  }

  show(on) { this.el.classList.toggle('active', on); }

  buildHotbar() {
    $('#hotbar').innerHTML = Array.from({ length: 6 }, (_, i) => `<div class="slot" data-i="${i}"><em>${i + 1}</em><div class="ic"></div><span class="nm"></span></div>`).join('');
  }

  hotbar(p) {
    $$('#hotbar .slot').forEach((el, i) => {
      const t = p.inventory[i];
      el.classList.toggle('sel', i === p.slot);
      el.querySelector('.ic').innerHTML = t ? (ICONS[t] || '') : '';
      el.querySelector('.nm').textContent = t ? ({ battery: 'Battery [R]', medkit: 'Medical Kit', syringe: 'Adrenaline', pills: 'Sedatives', crucifix: 'Crucifix', fuse: 'Fuse', crowbar: 'Crowbar' }[t]) : '';
    });
  }

  keys(k) { $$('#keyring span').forEach((el) => el.classList.toggle('have', !!k[el.dataset.k])); }
  lives(n, max) { $('#lives-hud').textContent = '♥'.repeat(Math.max(0, n)) + '♡'.repeat(Math.max(0, max - n)); }

  prompt(text, actionable = true) {
    const el = $('#prompt');
    if (!text) { el.classList.remove('on'); $('#crosshair').classList.remove('hot'); return; }
    el.innerHTML = actionable ? `<kbd>E</kbd>${text}` : text;
    el.classList.add('on');
    $('#crosshair').classList.toggle('hot', actionable);
  }

  notify(text, dur = 3) { const el = $('#notify'); el.textContent = text; el.classList.add('on'); this.notifyT = dur; }
  subtitle(html, dur = 3) { const el = $('#subtitle'); el.innerHTML = html; el.classList.add('on'); this.subT = dur; }

  objectives(list) {
    $('#objective').innerHTML = '<h4>OBJECTIVE</h4>' + list.map((o) => `<div class="${o.done ? 'done' : ''}${o.side ? ' side' : ''}">${o.side ? '<em>Side quest</em> ' : ''}${o.text}</div>`).join('');
    $('#tab-objectives').innerHTML = '<h3>Objectives</h3>' + list.map((o) => `<p class="${o.done ? 'done' : ''}">• ${o.text}</p>`).join('');
  }

  bars(p) {
    const st = $('.stamina');
    st.classList.toggle('show', p.stamina < 99.5);
    st.classList.toggle('low', p.exhausted || p.stamina < 25);
    $('#stamina-fill').style.transform = `scaleX(${p.stamina / 100})`;
    const b = $('#battery');
    b.querySelector('i').style.setProperty('--b', p.battery / 100);
    b.querySelector('span').textContent = `${Math.ceil(p.battery)}%${p.flashOn ? '' : ' · off'}`;
    b.classList.toggle('low', p.battery < 20);
    $('#fx-damage').style.opacity = Math.max(0, (1 - p.health / 100) * 0.7 - 0.05);
  }

  hideSlit(on, bed = false) { const el = $('#hide-slit'); el.classList.toggle('on', on); el.classList.toggle('bed', bed); }
  breath(on, v = 1, holding = false) {
    const el = $('#breath'); el.classList.toggle('on', on);
    if (on) { el.firstElementChild.style.width = (v * 100) + '%'; el.firstElementChild.style.background = holding ? '#9ec5ff' : '#e6dccb'; }
  }
  note(n) { $('#note-title').textContent = n[0]; $('#note-body').textContent = n[1]; $('#note').classList.add('on'); this.noteOpen = true; }
  closeNote() { $('#note').classList.remove('on'); this.noteOpen = false; }
  letterbox(on) { $('#letterbox').classList.toggle('on', on); }
  fade(on) { $('#fade').classList.toggle('on', on); }
  clickToPlay(on) { $('#click-to-play').classList.toggle('on', on); }
  talking(on) { $('#mic-btn').classList.toggle('talking', on); }
  /** Mic widget: { ready, mic, talking, mode, hasMic } */
  voice(st) {
    const b = $('#mic-btn');
    b.classList.toggle('hidden', !st.ready);
    b.classList.toggle('muted', !st.mic);
    b.classList.toggle('armed', st.mic && !st.talking);
    b.classList.toggle('talking', !!st.talking);
    $('#mic-label').textContent = !st.mic ? 'MUTED · M' : st.mode === 'ptt' ? (st.talking ? 'TALKING' : 'HOLD V') : (st.talking ? 'OPEN MIC' : 'OPEN MIC');
  }
  micLevel(v) { $('#mic-meter').style.setProperty('--lvl', Math.min(1, v * 6).toFixed(2)); }
  frost(secs) { const el = $('#frost'); el.classList.add('on'); clearTimeout(this._frostT); this._frostT = setTimeout(() => el.classList.remove('on'), secs * 1000); }
  cursorHint(on) { $('#cursor-hint').classList.toggle('on', on); }
  death(on, title = '', sub = '') { $('#death').classList.toggle('on', on); if (on) { $('#death-title').textContent = title; $('#death-sub').textContent = sub; } }
  spectate(on, name = '') { $('#spectate').classList.toggle('on', on); $('#spec-name').textContent = name; }

  tick(dt, fpsOn) {
    if (this.notifyT > 0) { this.notifyT -= dt; if (this.notifyT <= 0) $('#notify').classList.remove('on'); }
    if (this.subT > 0) { this.subT -= dt; if (this.subT <= 0) $('#subtitle').classList.remove('on'); }
    this.frames++; this.fpsT += dt;
    if (this.fpsT > 0.5) { $('#fps').textContent = fpsOn ? `${Math.round(this.frames / this.fpsT)} fps` : ''; this.frames = 0; this.fpsT = 0; }
  }

  tabMap(on, level, player, others) {
    const el = $('#tabmap');
    el.classList.toggle('on', on);
    if (!on) return;
    const cv = this.map.canvas;
    const r = cv.getBoundingClientRect();
    cv.width = r.width; cv.height = r.height;
    const g = cv.getContext('2d');
    const l = player.layer;
    const s = Math.min((cv.width - 40) / level.W, (cv.height - 60) / level.D);
    const ox = (cv.width - level.W * s) / 2, oz = 30;
    const X = (x) => ox + x * s, Z = (z) => oz + (level.D - z) * s;
    g.clearRect(0, 0, cv.width, cv.height);
    g.font = '14px "IM Fell English SC", serif'; g.fillStyle = '#b08a4a';
    g.fillText(l === 0 ? 'GROUND FLOOR' : 'UPPER FLOOR', ox, 18);
    for (const room of level.rooms) {
      if (!room.layers.includes(l)) continue;
      const known = room.visited;
      g.fillStyle = known ? (room.type === 'stairs' ? 'rgba(140,30,20,.45)' : 'rgba(120,95,70,.35)') : 'rgba(40,30,28,.35)';
      g.fillRect(X(room.x), Z(room.z + room.d), room.w * s, room.d * s);
      g.strokeStyle = 'rgba(230,210,180,.55)'; g.strokeRect(X(room.x) + 0.5, Z(room.z + room.d) + 0.5, room.w * s - 1, room.d * s - 1);
      if (known && room.w * s > 60) { g.fillStyle = 'rgba(230,210,180,.75)'; g.font = '11px "Special Elite"'; g.fillText(room.name, X(room.x) + 4, Z(room.z + room.d) + 14); }
    }
    for (const d of level.doors) {
      if (d.layer !== l) continue;
      g.fillStyle = d.kind === 'vent' ? '#6af' : d.locked ? '#c3140f' : '#e6dccb';
      g.fillRect(X(d.x) - 2, Z(d.z) - 2, 4, 4);
    }
    const dot = (p, c, yaw) => {
      g.fillStyle = c; g.beginPath(); g.arc(X(p.x), Z(p.z), 5, 0, 7); g.fill();
      if (yaw !== undefined) { g.strokeStyle = c; g.beginPath(); g.moveTo(X(p.x), Z(p.z)); g.lineTo(X(p.x) - Math.sin(yaw) * 14, Z(p.z) + Math.cos(yaw) * 14); g.stroke(); }
    };
    for (const o of others) if (o.alive && o.layer === l) dot(o.pos, '#7cc4ff');
    dot(player.pos, '#ffde9a', player.yaw);
    const names = others.map((o) => `${o.alive ? '●' : '✝'} ${escapeHtml(o.name)}`).join('<br>');
    $('#tab-players').innerHTML = names;
  }
}
