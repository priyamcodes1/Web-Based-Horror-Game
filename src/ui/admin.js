// Admin panel (` key): debug/host controls for testing - unlock the main gate, play the escape, god mode,
// ghost control, items, teleport. Guarded by a passcode (client-side only: a deterrent, not real security).
// To change the passcode, put the SHA-256 hex of your new one in ADMIN_HASH.
import { settings, saveSettings } from '../core/settings.js';

const ADMIN_HASH = '6a609fef1cfd5b6ace5944908ee378436a69283a146b7174b0b06f76e359e610';
const ITEMS = ['battery', 'medkit', 'syringe', 'pills', 'crucifix', 'fuse', 'crowbar'];

async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export class AdminPanel {
  constructor(getGame, onOpen, onClose) {
    this.getGame = getGame; this.onOpen = onOpen; this.onClose = onClose;
    this.el = document.createElement('div');
    this.el.id = 'admin';
    this.el.innerHTML = `
      <div class="adm-head"><b>Admin</b><span class="adm-x" title="Close">✕</span></div>
      <div class="adm-lock">
        <input type="password" placeholder="Passcode" autocomplete="off" spellcheck="false" />
        <button data-a="unlock">Enter</button>
        <small class="adm-err"></small>
      </div>
      <div class="adm-body">
        <h4>Main gate</h4>
        <button data-a="keys">Give all 3 keys</button>
        <button data-a="power">Restore power</button>
        <button data-a="gate">Unlock gate (keys + power)</button>
        <button data-a="escape" class="adm-warn">Play escape cutscene (ends the game)</button>
        <h4>Player</h4>
        <button data-a="god">God mode: <span data-s="god">off</span></button>
        <button data-a="heal">Full health / battery / stamina</button>
        <button data-a="tpgate">Teleport to the foyer</button>
        <div class="adm-items">${ITEMS.map((t) => `<button data-a="give" data-t="${t}">+ ${t}</button>`).join('')}</div>
        <h4>Ghosts</h4>
        <button data-a="banish">Banish ghosts (vanish far away)</button>
        <button data-a="freeze">Freeze ghosts: <span data-s="freeze">off</span></button>
        <small class="adm-note"></small>
      </div>`;
    document.body.appendChild(this.el);
    this.el.addEventListener('click', (e) => {
      const b = e.target.closest('button, .adm-x');
      if (!b) return;
      if (b.classList.contains('adm-x')) { this.toggle(false); return; }
      this.run(b.dataset.a, b.dataset.t);
    });
    this.el.querySelector('input').addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') this.run('unlock'); });
    this.open = false;
    this.refresh();
  }

  get unlocked() { return settings.adminOk === ADMIN_HASH; }

  toggle(on = !this.open) {
    this.open = on;
    this.el.classList.toggle('active', on);
    this.refresh();
    if (on) { this.onOpen?.(); if (!this.unlocked) setTimeout(() => this.el.querySelector('input').focus(), 30); }
    else this.onClose?.();
  }

  refresh() {
    const g = this.getGame();
    this.el.classList.toggle('locked', !this.unlocked);
    const set = (k, v) => { const s = this.el.querySelector(`[data-s="${k}"]`); if (s) s.textContent = v ? 'ON' : 'off'; };
    set('god', g?.adminGod); set('freeze', g?.adminFreeze);
    const note = this.el.querySelector('.adm-note');
    note.textContent = !g ? 'Start a game to use these.' : !g.isHost ? 'Only the host can change the gate and ghosts.' : '';
  }

  note(msg) { this.getGame()?.hud.notify('[admin] ' + msg, 2); }

  async run(a, t) {
    if (a === 'unlock') {
      const v = this.el.querySelector('input').value;
      if ((await sha256(v)) === ADMIN_HASH) { settings.adminOk = ADMIN_HASH; saveSettings(); this.el.querySelector('input').value = ''; }
      else this.el.querySelector('.adm-err').textContent = 'Wrong passcode';
      this.refresh();
      return;
    }
    if (!this.unlocked) return;
    const g = this.getGame();
    if (!g || !g.running) { this.refresh(); return; }
    const p = g.player;
    const hostOnly = ['keys', 'power', 'gate', 'escape', 'banish', 'freeze'];
    if (hostOnly.includes(a) && !g.isHost) { this.note('host only'); return; }
    switch (a) {
      case 'keys': g.event({ k: 'admin', op: 'keys' }); this.note('all keys given'); break;
      case 'power': if (!g.power) g.event({ k: 'power', on: true }); this.note('power on'); break;
      case 'gate':
        g.event({ k: 'admin', op: 'keys' });
        if (!g.power) g.event({ k: 'power', on: true });
        this.note('gate unlockable - walk up to it, or play the escape');
        break;
      case 'escape':
        g.event({ k: 'admin', op: 'keys' });
        if (!g.power) g.event({ k: 'power', on: true });
        this.toggle(false);
        g.event({ k: 'escape' });
        break;
      case 'god': g.adminGod = !g.adminGod; this.note('god mode ' + (g.adminGod ? 'on' : 'off')); break;
      case 'heal': p.health = 100; p.battery = 100; p.stamina = 100; p.sanity = 100; this.note('topped up'); break;
      case 'tpgate': {
        const r = g.spawnRoom;
        if (p.hiding) p.exitHide(true);
        const q = g.level.randomPoint(g.rng, r);
        p.spawnAt(q, p.yaw);
        this.note('teleported to ' + (r.name || 'the foyer'));
        break;
      }
      case 'give': if (p.give(t)) { p.refreshHeld(); this.note('+ ' + t); } else this.note('inventory full'); break;
      case 'banish':
        for (const gh of g.ghosts) { gh.state = 'retreat'; gh.target = null; gh.vanish(() => { gh.teleportFar(p.pos); gh.state = 'roam'; gh.cool = 45; }); }
        this.note('ghosts banished');
        break;
      case 'freeze': g.adminFreeze = !g.adminFreeze; this.note('ghosts ' + (g.adminFreeze ? 'frozen' : 'released')); break;
      default: break;
    }
    this.refresh();
  }
}
