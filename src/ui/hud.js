// HUD: thin DOM layer. All writes are change-detected so the per-frame cost is ~zero.
import { ICONS, ITEMS, KEY_COLORS } from '../game/items.js';
import { FH } from '../world/level.js';

const $ = (id) => document.getElementById(id);

export class HUD {
  constructor() {
    this.el = $('hud');
    this.e = {};
    for (const id of ['prompt', 'objective', 'notify', 'subtitle', 'keyring', 'lives-hud', 'stamina-fill', 'battery', 'hotbar', 'fps', 'hide-slit',
      'breath', 'tabmap', 'tabmap-canvas', 'tab-objectives', 'tab-players', 'note', 'note-title', 'note-body', 'spectate', 'spec-name', 'death',
      'death-title', 'death-sub', 'talk', 'letterbox', 'fade', 'click-to-play', 'crosshair', 'fx-vignette', 'fx-damage']) this.e[id] = $(id);
    this.cache = {};
    this.notifyT = 0; this.subT = 0;
    this.noteOpen = false;
  }

  set(key, val, fn) { if (this.cache[key] === val) return; this.cache[key] = val; fn(val); }

  show(on) { this.el.classList.toggle('active', on); }

  notify(text, secs = 3) {
    const n = this.e.notify;
    n.textContent = text; n.classList.add('on');
    this.notifyT = secs;
  }

  subtitle(html, secs = 2.5) {
    if (!this.subsOn) return;
    const s = this.e.subtitle;
    s.innerHTML = html; s.classList.add('on');
    this.subT = secs;
  }

  prompt(text) {
    this.set('prompt', text || '', (v) => {
      this.e.prompt.innerHTML = v;
      this.e.prompt.classList.toggle('on', !!v);
      this.e.crosshair.classList.toggle('hot', !!v);
    });
  }

  objectives(list) {
    const html = '<h4>OBJECTIVES</h4>' + list.map((o) => `<div class="${o.done ? 'done' : ''}">${o.done ? '✓' : '•'} ${o.text}</div>`).join('');
    this.set('obj', html, (v) => { this.e.objective.innerHTML = v; this.e['tab-objectives'].innerHTML = v; });
  }

  keyring(keys) {
    const k = ['brass', 'iron', 'silver'].map((x) => (keys[x] ? 1 : 0)).join('');
    this.set('keys', k, () => {
      this.e.keyring.innerHTML = ['brass', 'iron', 'silver'].map((x) =>
        `<span class="${keys[x] ? 'have' : ''}" title="${x} key" style="color:${KEY_COLORS[x]}">${ICONS.key}</span>`).join('');
    });
  }

  lives(n, max) {
    this.set('lives', n + '/' + max, () => { this.e['lives-hud'].textContent = '♥'.repeat(Math.max(0, n)) + '♡'.repeat(Math.max(0, max - n)); });
  }

  stamina(v, show, low) {
    const w = Math.round(v * 200) / 200;
    this.set('stam', w, () => { this.e['stamina-fill'].style.transform = `scaleX(${w})`; });
    const bar = this.e['stamina-fill'].parentElement;
    this.set('stamShow', show, (s) => bar.classList.toggle('show', s));
    this.set('stamLow', low, (s) => bar.classList.toggle('low', s));
  }

  health(v) {
    // health shows as blood at the screen edge instead of a bar
    this.set('hp', Math.round(v), () => {
      this.e['fx-vignette'].style.background = `radial-gradient(ellipse at center, transparent ${40 + v * 0.2}%, rgba(${v < 50 ? 60 : 0},0,0,${0.75 + (1 - v / 100) * 0.2}) 100%)`;
    });
  }

  battery(v, on, spare) {
    const b = Math.round(v);
    this.set('bat', b + '|' + on + '|' + spare, () => {
      this.e.battery.style.setProperty('--b', v / 100);
      this.e.battery.querySelector('span').textContent = `${b}%${spare ? '  ·  ' + spare + ' spare [R]' : ''}`;
      this.e.battery.classList.toggle('low', v < 20);
      this.e.battery.style.opacity = on ? 1 : 0.5;
    });
  }

  hotbar(inv, sel) {
    const sig = inv.map((s) => s ? s.type + ':' + s.count : '-').join(',') + '|' + sel;
    this.set('hot', sig, () => {
      this.e.hotbar.innerHTML = inv.map((s, i) => {
        if (!s) return `<div class="slot ${i === sel ? 'sel' : ''}"><em>${i + 1}</em></div>`;
        const d = ITEMS[s.type];
        const icon = ICONS[s.type] || ICONS.note;
        return `<div class="slot ${i === sel ? 'sel' : ''}"><em>${i + 1}</em>${icon}${s.count > 1 ? `<b>×${s.count}</b>` : ''}<span class="nm">${d.name}${d.use ? ' — [Q] use' : ''}</span></div>`;
      }).join('');
    });
  }

  fps(text) { this.set('fps', text, (v) => { this.e.fps.textContent = v; }); }

  hideSlit(on) { this.set('slit', on, (v) => this.e['hide-slit'].classList.toggle('on', v)); }

  breath(v, on) {
    this.set('brOn', on, (x) => this.e.breath.classList.toggle('on', x));
    const w = Math.round(v * 100);
    this.set('br', w, () => { this.e.breath.firstElementChild.style.width = w + '%'; });
  }

  damage(v) { this.e['fx-damage'].style.opacity = v; }

  talk(on) { this.set('talk', on, (v) => this.e.talk.classList.toggle('on', v)); }

  letterbox(on) { this.e.letterbox.classList.toggle('on', on); }
  fade(on, secs = 1) { this.e.fade.style.transitionDuration = secs + 's'; this.e.fade.classList.toggle('on', on); }
  clickToPlay(on) { this.e['click-to-play'].classList.toggle('on', on); }

  showNote(title, body) {
    this.e['note-title'].textContent = title;
    this.e['note-body'].textContent = body;
    this.e.note.classList.add('on');
    this.noteOpen = true;
  }
  closeNote() { this.e.note.classList.remove('on'); this.noteOpen = false; }

  spectate(name) {
    this.e.spectate.classList.toggle('on', !!name);
    if (name) this.e['spec-name'].textContent = name;
  }

  death(title, sub) {
    this.e.death.classList.toggle('on', !!title);
    if (title) { this.e['death-title'].textContent = title; this.e['death-sub'].textContent = sub || ''; }
  }

  crosshair(on) { this.set('ch', on, (v) => { this.e.crosshair.style.display = v ? '' : 'none'; }); }

  tick(dt) {
    if (this.notifyT > 0) { this.notifyT -= dt; if (this.notifyT <= 0) this.e.notify.classList.remove('on'); }
    if (this.subT > 0) { this.subT -= dt; if (this.subT <= 0) this.e.subtitle.classList.remove('on'); }
  }

  // ------------------------------------------------------------------ Tab map
  tab(on) { this.set('tab', on, (v) => this.e.tabmap.classList.toggle('on', v)); }

  drawMap(game) {
    const cv = this.e['tabmap-canvas'];
    const r = cv.getBoundingClientRect();
    if (!r.width) return;
    const dpr = Math.min(2, devicePixelRatio || 1);
    if (cv.width !== Math.round(r.width * dpr)) { cv.width = Math.round(r.width * dpr); cv.height = Math.round(r.height * dpr); }
    const g = cv.getContext('2d');
    const L = game.level;
    const me = game.localPlayerRec() || game.specTarget();
    const layer = me ? me.layer : 0;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, cv.width, cv.height);
    const pad = 30 * dpr;
    const s = Math.min((cv.width - pad * 2) / L.W, (cv.height - pad * 2 - 30 * dpr) / L.D);
    const ox = (cv.width - L.W * s) / 2, oz = pad + 30 * dpr;
    g.font = `${14 * dpr}px "IM Fell English SC", serif`;
    g.fillStyle = '#b89c6a';
    g.fillText(layer === 0 ? 'GROUND FLOOR' : 'UPPER FLOOR', ox, oz - 12 * dpr);
    for (const rm of L.rooms) {
      if (!rm.layers.includes(layer)) continue;
      const x = ox + rm.x * s, y = oz + rm.z * s;
      g.fillStyle = rm.visited ? 'rgba(120,100,80,0.28)' : 'rgba(40,34,30,0.55)';
      g.fillRect(x, y, rm.w * s, rm.d * s);
      g.strokeStyle = 'rgba(216,207,192,0.55)'; g.lineWidth = 1.5 * dpr;
      g.strokeRect(x, y, rm.w * s, rm.d * s);
      if (rm.visited || rm.type === 'foyer') {
        g.fillStyle = 'rgba(216,207,192,0.75)';
        g.font = `${Math.max(9, Math.min(13, rm.w * s / 9)) * dpr / Math.max(1, dpr * 0.8)}px "Special Elite", monospace`;
        g.fillText(rm.name, x + 4 * dpr, y + 14 * dpr);
      }
    }
    // doors
    for (const d of L.doors) {
      if (d.layer !== layer && !(d.a.type === 'stairs' || d.b?.type === 'stairs')) continue;
      if (d.layer !== layer) continue;
      g.strokeStyle = d.kind === 'gate' ? '#c3140f' : d.kind === 'vent' ? '#6a8aa0' : d.locked ? '#b08a4a' : '#0a0808';
      g.lineWidth = 4 * dpr;
      g.beginPath();
      if (d.orient === 'h') { g.moveTo(ox + (d.x - d.width / 2) * s, oz + d.z * s); g.lineTo(ox + (d.x + d.width / 2) * s, oz + d.z * s); }
      else { g.moveTo(ox + d.x * s, oz + (d.z - d.width / 2) * s); g.lineTo(ox + d.x * s, oz + (d.z + d.width / 2) * s); }
      g.stroke();
    }
    // players
    for (const p of game.players) {
      if (!p.alive || Math.abs(p.pos.y - layer * FH) > FH * 0.6) continue;
      const x = ox + p.pos.x * s, y = oz + p.pos.z * s;
      g.fillStyle = p.isLocal ? '#e8e0d0' : '#7fc2ff';
      g.beginPath(); g.arc(x, y, 5 * dpr, 0, Math.PI * 2); g.fill();
      if (p.isLocal) {
        g.strokeStyle = '#e8e0d0'; g.lineWidth = 2 * dpr;
        g.beginPath(); g.moveTo(x, y); g.lineTo(x - Math.sin(p.yaw) * 14 * dpr, y - Math.cos(p.yaw) * 14 * dpr); g.stroke();
      } else {
        g.fillStyle = '#7fc2ff'; g.font = `${11 * dpr}px "Special Elite", monospace`; g.fillText(p.name, x + 8 * dpr, y + 4 * dpr);
      }
    }
    this.e['tab-players'].innerHTML = game.players.map((p) => `<div>${p.alive ? '●' : '✝'} ${p.name}${p.isLocal ? ' (you)' : ''} — ${'♥'.repeat(Math.max(0, p.lives))}</div>`).join('');
  }
}
