// App shell: menu flow, lobby, loading, the render loop, pause and results.
import * as THREE from 'three';
import { settings, loadSettings, saveSettings, quality } from './core/settings.js';
import { input } from './core/input.js';
import { Renderer } from './core/renderer.js';
import { assets, loadGLTF, loadTextureSet, loadImageTexture, TEXTURE_SETS, buildEnvMap } from './core/assets.js';
import { audio } from './audio/audio.js';
import { HUD } from './ui/hud.js';
import { MenuBackdrop, wireButtonFX, buildProfiles, buildMaps, buildGhosts, refreshGhosts, bindSettings, initWebs, renderProfileThumbs, $, $$ } from './ui/menu.js';
import { MAPS, GHOST_TYPES, PROFILES } from './world/maps.js';
import { Game } from './game/game.js';
import { Net } from './net/net.js';
import { LOADING_TIPS } from './game/items.js';

loadSettings();

class App {
  constructor() {
    this.canvas = $('#game');
    this.renderer = new Renderer(this.canvas);
    assets.renderer = this.renderer.r;
    this.hud = new HUD();
    input.attach(this.canvas);
    this.game = null;
    this.net = null;
    this.screen = 'menu';
    this.cfg = { map: 'blackwood', ghostCount: 1, ghosts: ['widow'], lives: 3, difficulty: 'normal', mode: 'solo' };
    try { Object.assign(this.cfg, JSON.parse(localStorage.getItem('bwm.cfg') || '{}')); } catch (_) { /* defaults */ }
    this.cfg.mode = 'solo';
    this.lobby = [];
    this.backdrop = new MenuBackdrop($('#menu-bg'));
    this.fpsAcc = 0; this.fpsN = 0; this.fpsT = 0;
    this._initMenu();
    this._initInput();
    this.backdrop.start();
    this.last = performance.now();
    requestAnimationFrame((t) => this.frame(t));
    // warm the heavy assets while the player browses the menu
    this.thumbsP = renderProfileThumbs().then((th) => { this.thumbs = th; this._profiles(); }).catch((e) => console.warn('thumbs', e));
  }

  // =========================================================================== menu
  _initMenu() {
    initWebs();
    wireButtonFX(document);
    $('#gpu-name').textContent = this.renderer.gpu;
    // first gesture unlocks audio
    const unlock = () => {
      audio.init();
      if (this.screen === 'menu' && !audio.loops.menu) audio.startLoop('menu', { vol: 0.55 });
    };
    addEventListener('pointerdown', unlock);
    addEventListener('keydown', unlock);
    // panel navigation
    document.addEventListener('click', (e) => {
      const go = e.target.closest('[data-go]');
      if (go) this.panel(go.dataset.go);
      const back = e.target.closest('[data-back]');
      if (back) { if (this.game) this._showPause(); else this.panel('m-main'); }
    });
    // mode
    const mode = $('#mode-seg');
    mode.onclick = (e) => {
      const b = e.target.closest('button'); if (!b) return;
      this.cfg.mode = b.dataset.v;
      $$('button', mode).forEach((x) => x.classList.toggle('on', x === b));
      $('#join-box').classList.toggle('hidden', this.cfg.mode !== 'join');
      $('.host-only').style.display = this.cfg.mode === 'join' ? 'none' : '';
      $('#btn-start span').textContent = this.cfg.mode === 'solo' ? 'Enter the Manor' : this.cfg.mode === 'host' ? 'Create Lobby' : 'Join Lobby';
    };
    const name = $('#in-name');
    name.value = settings.playerName || '';
    name.oninput = () => { settings.playerName = name.value.trim().slice(0, 16); saveSettings(); };
    this._profiles();
    buildMaps($('#maps'), this.cfg.map, (id) => { this.cfg.map = id; this._saveCfg(); });
    // ghosts
    const gc = $('#ghost-count');
    const setCount = (n) => {
      this.cfg.ghostCount = n;
      $$('button', gc).forEach((x) => x.classList.toggle('on', +x.dataset.v === n));
      $('#ghost-count-label').textContent = n;
      const all = Object.keys(GHOST_TYPES);
      while (this.cfg.ghosts.length < n) { const free = all.filter((g) => !this.cfg.ghosts.includes(g)); this.cfg.ghosts.push(free.length ? free[(Math.random() * free.length) | 0] : all[0]); }
      while (this.cfg.ghosts.length > n) this.cfg.ghosts.shift();
      refreshGhosts($('#ghosts'), this.cfg.ghosts);
      this._saveCfg();
    };
    gc.onclick = (e) => { const b = e.target.closest('button'); if (b) setCount(+b.dataset.v); };
    buildGhosts($('#ghosts'), this.cfg.ghosts, (id) => {
      const sel = this.cfg.ghosts;
      const i = sel.indexOf(id);
      if (i >= 0) { if (sel.length > 1) sel.splice(i, 1); setCount(sel.length); }
      else { sel.push(id); if (sel.length > 3) sel.shift(); setCount(Math.max(this.cfg.ghostCount, sel.length)); }
      refreshGhosts($('#ghosts'), sel);
    });
    setCount(this.cfg.ghosts.length || 1);
    // lives + difficulty
    const lv = $('#lives');
    const setLives = (n) => { this.cfg.lives = Math.max(1, Math.min(9, n)); lv.querySelector('b').textContent = this.cfg.lives; this._saveCfg(); };
    lv.onclick = (e) => { const b = e.target.closest('button'); if (b) setLives(this.cfg.lives + +b.dataset.d); };
    setLives(this.cfg.lives);
    const df = $('#difficulty');
    const setDiff = (v) => { this.cfg.difficulty = v; $$('button', df).forEach((x) => x.classList.toggle('on', x.dataset.v === v)); this._saveCfg(); };
    df.onclick = (e) => { const b = e.target.closest('button'); if (b) setDiff(b.dataset.v); };
    setDiff(this.cfg.difficulty);
    // start
    $('#btn-start').onclick = () => this._start();
    $('#btn-lobby-start').onclick = () => this._hostStart();
    $('#lobby-leave').onclick = () => { this._closeNet(); this.panel('m-play'); };
    $('#copy-code').onclick = () => { navigator.clipboard?.writeText($('#lobby-code').textContent); $('#copy-code').textContent = 'copied'; setTimeout(() => { $('#copy-code').textContent = 'copy'; }, 1200); };
    // settings
    bindSettings((k) => {
      if (k === 'quality' && this.game) this.renderer.applyQuality();
      if (k === 'subtitles') this.hud.subsOn = settings.subtitles;
      if (k === 'fov' && this.game) this.game.camera.fov = settings.fov;
    });
    // pause / results
    $('#p-resume').onclick = () => this._resume();
    $('#p-settings').onclick = () => { $('#pause').classList.remove('active'); $('#menu').classList.add('active'); this.panel('m-settings'); };
    $('#p-leave').onclick = () => this.toMenu();
    $('#res-menu').onclick = () => this.toMenu();
    $('#spec-prev').onclick = () => this.game && this.game._cycleSpectate(-1);
    $('#spec-next').onclick = () => this.game && this.game._cycleSpectate(1);
    this.canvas.addEventListener('click', () => { if (this.game && this.screen === 'game' && !input.locked) this._resume(); });
  }

  _profiles() { buildProfiles($('#profiles'), this.thumbs, (id) => { settings.profile = id; saveSettings(); }); }
  _saveCfg() { try { localStorage.setItem('bwm.cfg', JSON.stringify({ ...this.cfg, mode: undefined })); } catch (_) { /* ignore */ } }

  panel(id) {
    $$('#menu .panel').forEach((p) => p.classList.toggle('active', p.id === id));
  }

  _myProfile() { return settings.profile >= 0 ? settings.profile : (Math.random() * PROFILES.length) | 0; }
  _myName() { return (settings.playerName || '').trim() || ['Survivor', 'Stranger', 'Guest', 'Wanderer'][(Math.random() * 4) | 0]; }

  _toast(msg) {
    const h = $('#lobby-hint');
    alert(msg); void h;
  }

  // =========================================================================== lobby / start
  async _start() {
    audio.init();
    if (this.cfg.mode === 'solo') {
      const pid = 'local';
      this.startGame({ map: this.cfg.map, seed: (Math.random() * 2 ** 31) | 0, ghosts: this.cfg.ghosts.slice(0, this.cfg.ghostCount), lives: this.cfg.lives,
        difficulty: this.cfg.difficulty, players: [{ id: pid, name: this._myName(), profile: this._myProfile() }], localId: pid }, null);
      return;
    }
    const btn = $('#btn-start');
    btn.disabled = true;
    const net = this.net = new Net();
    try {
      if (this.cfg.mode === 'host') {
        const code = await net.host();
        this.lobby = [{ id: net.myId, name: this._myName(), profile: this._myProfile() }];
        net.on('hello', (m, from) => {
          if (this.game) { net.sendTo(from, { t: 'kick', reason: 'That game has already started.' }); return; }
          if (this.lobby.length >= 5) { net.sendTo(from, { t: 'kick', reason: 'The lobby is full (5 players).' }); return; }
          this.lobby.push({ id: from, name: String(m.name || 'Guest').slice(0, 16), profile: m.profile | 0 });
          this._lobbyBroadcast();
        });
        net.on('leave', (id) => { if (!this.game) { this.lobby = this.lobby.filter((p) => p.id !== id); this._lobbyBroadcast(); } });
        net.on('ready', (m, from) => { this.readySet?.add(from); this._checkGo(); });
        $('#lobby-code').textContent = code;
        $('#lobby-hint').textContent = 'Share the code with friends (up to 5 players). You start the game when everyone is in.';
        $('#btn-lobby-start').style.display = '';
        this._lobbyRender();
        this.panel('m-lobby');
      } else {
        const code = $('#in-code').value;
        if (!code.trim()) throw new Error('Enter the room code your host gave you.');
        await net.join(code);
        net.send({ t: 'hello', name: this._myName(), profile: this._myProfile() });
        net.on('lobby', (m) => { this.lobby = m.players; this.lobbyCfg = m.cfg; this._lobbyRender(); });
        net.on('kick', (m) => { this._closeNet(); this.panel('m-play'); this._toast(m.reason); });
        net.on('start', (m) => this.startGame(m.config, net));
        net.on('go', () => this._go());
        net.on('hostLost', () => { if (!this.game) { this._closeNet(); this.panel('m-play'); this._toast('The host closed the lobby.'); } });
        $('#lobby-code').textContent = code.toUpperCase();
        $('#lobby-hint').textContent = 'Waiting for the host to start…';
        $('#btn-lobby-start').style.display = 'none';
        this.panel('m-lobby');
      }
    } catch (e) {
      this._closeNet();
      this._toast(e.message || String(e));
    } finally { btn.disabled = false; }
  }

  _lobbyBroadcast() {
    const cfg = { map: this.cfg.map, ghosts: this.cfg.ghosts.slice(0, this.cfg.ghostCount), lives: this.cfg.lives, difficulty: this.cfg.difficulty };
    this.lobbyCfg = cfg;
    this.net.broadcast({ t: 'lobby', players: this.lobby, cfg });
    this._lobbyRender();
  }

  _lobbyRender() {
    const colors = ['#c3140f', '#7fc2ff', '#b08a4a', '#8fd18f', '#d08fd1'];
    $('#lobby-list').innerHTML = this.lobby.map((p, i) => `<li><i style="background:${colors[i % 5]}"></i><span>${escapeHtml(p.name)}</span><em>${i === 0 ? 'host' : PROFILES[p.profile % PROFILES.length].name}</em></li>`).join('');
    const c = this.lobbyCfg || { map: this.cfg.map, ghosts: this.cfg.ghosts, lives: this.cfg.lives, difficulty: this.cfg.difficulty };
    $('#lobby-cfg').innerHTML = `${MAPS[c.map].name} · ${c.ghosts.map((g) => GHOST_TYPES[g].name).join(', ')} · ${c.lives} lives · ${c.difficulty}`;
  }

  _hostStart() {
    const used = new Set();
    const players = this.lobby.map((p) => {
      let prof = p.profile % PROFILES.length;
      if (used.has(prof)) prof = PROFILES.findIndex((_, i) => !used.has(i));
      used.add(prof);
      return { ...p, profile: prof < 0 ? p.profile : prof };
    });
    const config = { map: this.cfg.map, seed: (Math.random() * 2 ** 31) | 0, ghosts: this.cfg.ghosts.slice(0, this.cfg.ghostCount), lives: this.cfg.lives,
      difficulty: this.cfg.difficulty, players };
    this.readySet = new Set();
    for (const p of players) if (p.id !== this.net.myId) this.net.sendTo(p.id, { t: 'start', config: { ...config, localId: p.id } });
    this.startGame({ ...config, localId: this.net.myId }, this.net);
    this.goTimer = setTimeout(() => this._go(true), 90000);
  }

  _checkGo() {
    if (!this.net || !this.net.isHost || !this.game || !this.gameLoaded) return;
    const need = this.game.players.filter((p) => !p.isLocal).map((p) => p.id);
    if (need.every((id) => this.readySet.has(id))) this._go(true);
  }

  _go(broadcast = false) {
    if (this.started) return;
    if (broadcast && this.net && this.net.isHost) {
      clearTimeout(this.goTimer);
      // anyone who never finished loading is treated as having left
      for (const p of this.game.players) if (!p.isLocal && !this.readySet.has(p.id)) this.game.emit({ k: 'left', pid: p.id });
      this.net.broadcast({ t: 'go' });
    }
    if (!this.gameLoaded) { this.goPending = true; return; }
    this.started = true;
    this._enterGame();
  }

  _closeNet() { if (this.net) { this.net.close(); this.net = null; } }

  // =========================================================================== loading
  async startGame(config, net) {
    this.screen = 'loading';
    this.started = false; this.gameLoaded = false; this.goPending = false;
    $('#menu').classList.remove('active');
    $('#loading').classList.add('active');
    this.backdrop.stop();
    audio.stopLoop('menu');
    const tips = [...LOADING_TIPS].sort(() => Math.random() - 0.5);
    let ti = 0;
    const tipEl = $('#load-tip');
    const nextTip = () => { tipEl.style.opacity = 0; setTimeout(() => { tipEl.textContent = tips[ti++ % tips.length]; tipEl.style.opacity = 1; }, 500); };
    nextTip();
    this.tipTimer = setInterval(nextTip, 5200);
    const fill = $('#load-fill'), stage = $('#load-stage'), drip = $('.load-drip');
    const progress = (v, s) => {
      fill.style.width = (v * 100).toFixed(1) + '%';
      drip.style.setProperty('--x', (v * 100).toFixed(1) + '%');
      if (s) stage.textContent = s;
    };
    try {
      progress(0.02, 'Unlocking the front door…');
      const models = ['furniture', 'items', 'exterior', 'player', ...new Set(config.ghosts.map((g) => GHOST_TYPES[g].model))];
      let done = 0;
      const total = models.length + TEXTURE_SETS.length + 5;
      const tick = (label) => { done++; progress(0.02 + 0.48 * done / total, label); };
      const texP = Promise.all([
        ...TEXTURE_SETS.map((n) => loadTextureSet(n).then(() => tick('Peeling wallpaper…'))),
        ...[0, 1, 2, 3, 4].map((i) => loadImageTexture('painting_' + i).then(() => tick('Hanging the portraits…'))),
      ]);
      const modP = Promise.all(models.map((m) => loadGLTF(m).then(() => tick(m.startsWith('ghost') ? 'Something stirs upstairs…' : 'Moving the furniture…'))));
      await Promise.all([texP, modP]);
      if (!assets.envMap) buildEnvMap(this.renderer.r);
      const game = this.game = new Game(this, config, net);
      await game.load((v, s) => progress(0.5 + v * 0.48, s));
      progress(1, 'Ready.');
      this.gameLoaded = true;
      if (net && !net.isHost) net.send({ t: 'ready' });
      if (!net) this._go();
      else if (net.isHost) this._checkGo();
      else { stage.textContent = 'Waiting for the others…'; if (this.goPending) this._go(); }
    } catch (e) {
      console.error(e);
      clearInterval(this.tipTimer);
      this.abort('Failed to load: ' + (e.message || e));
    }
  }

  _enterGame() {
    clearInterval(this.tipTimer);
    $('#loading').classList.remove('active');
    this.screen = 'game';
    this.hud.show(true);
    this.hud.crosshair(true);
    this.hud.fade(true, 0);
    this.hud.letterbox(false);
    this.hud.death(null);
    this.hud.spectate(null);
    this.hud.clickToPlay(true);
    input.enabled = true;
    this.game.startAudio();
    this.game.hud.notify(MAPS[this.game.config.map].name, 3.5);
    setTimeout(() => this.hud.fade(false, 2.2), 50);
  }

  // =========================================================================== pause / resume
  _initInput() {
    input.onUnlock = () => {
      if (this.screen === 'game' && this.game && !this.game.ended) this._showPause();
    };
    addEventListener('keydown', (e) => {
      if (e.code === 'Escape' && this.screen === 'game' && $('#pause').classList.contains('active')) this._resume();
    });
    addEventListener('blur', () => { if (this.game && this.screen === 'game') input.keys.clear(); });
  }

  _showPause() {
    if (!this.game || this.game.ended) return;
    $('#menu').classList.remove('active');
    $('#pause').classList.add('active');
    this.game.paused = true;
    input.enabled = false;
    audio.ctx && this.game.players.length === 1 && audio.ctx.suspend();
  }

  _resume() {
    $('#pause').classList.remove('active');
    $('#menu').classList.remove('active');
    this.hud.clickToPlay(false);
    if (this.game) this.game.paused = false;
    input.enabled = true;
    audio.init();
    input.lock();
  }

  // =========================================================================== end
  showResults(r) {
    this.screen = 'results';
    input.unlock();
    input.enabled = false;
    const m = Math.floor(r.time / 60), s = Math.floor(r.time % 60);
    $('#res-title').textContent = r.result === 'escaped' ? 'You Escaped' : 'Nobody Left the House';
    $('#res-sub').textContent = r.result === 'escaped' ? `Survivors: ${r.survived.join(', ') || '—'}` : 'The manor keeps what it takes.';
    $('#res-stats').innerHTML = [
      ['Map', r.map], ['Time', `${m}:${String(s).padStart(2, '0')}`], ['Keys found', `${r.keys} / 3`], ['Times caught', r.caught],
      ['Items picked up', r.items], ['Notes read', r.notes], ['Distance', `${Math.round(r.dist)} m`],
    ].map(([a, b]) => `<tr><td>${a}</td><td>${b}</td></tr>`).join('');
    $('#results').classList.add('active');
    this.hud.fade(false, 1);
    audio.stopAll();
    audio.play(r.result === 'escaped' ? 'crucifix' : 'stinger', { vol: 0.5 });
  }

  abort(msg) {
    this.toMenu();
    setTimeout(() => alert(msg), 50);
  }

  toMenu() {
    input.unlock();
    input.enabled = false;
    if (this.game) { this.game.dispose(); this.game = null; }
    this._closeNet();
    this.screen = 'menu';
    this.hud.show(false);
    this.hud.fade(false, 0);
    this.hud.letterbox(false);
    this.hud.death(null);
    this.hud.spectate(null);
    this.hud.cache = {};
    for (const id of ['pause', 'results', 'loading']) $('#' + id).classList.remove('active');
    $('#menu').classList.add('active');
    this.panel('m-main');
    this.backdrop.start();
    if (audio.ctx && audio.ctx.state === 'suspended') audio.ctx.resume();
    audio.stopAll();
    audio.startLoop('menu', { vol: 0.55 });
    this.renderer.scene = null;
  }

  // =========================================================================== loop
  frame(now) {
    requestAnimationFrame((t) => this.frame(t));
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    if (this.game && (this.screen === 'game' || this.screen === 'results')) {
      if (this.screen === 'game') this.game.update(dt);
      this.renderer.render(dt);
      // FPS readout
      if (settings.showFps) {
        this.fpsAcc += dt; this.fpsN++;
        if (this.fpsAcc > 0.5) {
          const info = this.renderer.r.info.render;
          this.hud.fps(`${Math.round(this.fpsN / this.fpsAcc)} fps · ${info.calls} draws · ${(info.triangles / 1000).toFixed(0)}k tris · ${quality().label}`);
          this.fpsAcc = 0; this.fpsN = 0;
        }
      } else this.hud.fps('');
    }
    input.endFrame();
  }
}

function escapeHtml(s) { return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

const boot = () => { if (!window.app) window.app = new App(); };
if (document.readyState === 'loading') window.addEventListener('DOMContentLoaded', boot); else boot();
void THREE;
