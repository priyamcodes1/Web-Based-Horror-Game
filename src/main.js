// Boot + app flow: menu -> (lobby) -> loading -> game -> results.
import { loadSettings, settings } from './core/settings.js';
import { input } from './core/input.js';
import { audio } from './audio/audio.js';
import { Gfx } from './gfx/renderer.js';
import { Menu, Hud } from './ui/ui.js';
import { Net } from './net/net.js';
import { Game } from './game/game.js';
import { assets } from './core/assets.js';
import { drip } from './ui/drips.js';

loadSettings();
const $ = (s) => document.querySelector(s);
const canvas = $('#game');
const gfx = new Gfx(canvas);
const hud = new Hud();
const net = new Net();
input.attach(canvas);
$('#gpu-name').textContent = gfx.gpuName;

let game = null;
let lobby = null;    // { roster, config, isHost }
let paused = false;

const TIPS = [
  'Sprinting is loud. The Hollow Child hears footsteps from rooms away.',
  'Hold your breath with Space while hiding — but not for too long.',
  'The Widow flinches when a flashlight finds her face.',
  'You will hear the Warden\'s chain long before you see him.',
  'Slide (C while sprinting) for a burst of speed — it costs stamina.',
  'Vents are too small for them. Crouch (C) and crawl through.',
  'When the power dies, look for something that glows.',
  'A wound-up music box draws them in. Use it to buy time.',
  'Closing a door behind you breaks their line of sight.',
  'Drawers hide batteries, medicine and worse.',
];

const menu = new Menu({
  start: (cfg) => onStart(cfg),
  lobbyStart: () => hostStart(),
  leaveLobby: () => { net.close(); lobby = null; menu.go('m-play'); },
  inGame: () => !!game,
  backToPause: () => showPause(true),
  settingsChanged: (k) => {
    if (k === 'quality') { gfx.setup(); if (game) hud.notify('Quality applied — shadows update on next map load', 3); }
  },
});

// ---------------------------------------------------------------------------- flows
async function onStart(cfg) {
  audio.init();
  if (cfg.mode === 'solo') {
    const roster = [{ id: 'local', name: cfg.name, profile: cfg.profile, host: true }];
    runGame(sanitize(cfg), (Math.random() * 1e9) | 0, roster, 'local');
    return;
  }
  const btn = $('#btn-start'); btn.disabled = true;
  try {
    if (cfg.mode === 'host') {
      const code = await net.host();
      lobby = { isHost: true, config: sanitize(cfg), roster: [{ id: net.myId, name: cfg.name, profile: cfg.profile, host: true }] };
      net.on('hello', (m, from) => {
        if (lobby.roster.length >= 8) { net.sendTo(from, { t: 'full' }); return; }
        if (!lobby.roster.find((p) => p.id === from)) lobby.roster.push({ id: from, name: String(m.name).slice(0, 16), profile: m.profile | 0, host: false });
        pushLobby();
      });
      net.on('leave', ({ id }) => { if (!game) { lobby.roster = lobby.roster.filter((p) => p.id !== id); pushLobby(); } });
      menu.lobby(code, lobby.roster, true, lobby.config);
    } else {
      if (!/^[A-Z]{4}$/.test(cfg.code)) throw new Error('Enter the 4-letter room code.');
      await net.join(cfg.code);
      lobby = { isHost: false, roster: [], config: null };
      net.on('lobby', (m) => { lobby.roster = m.roster; lobby.config = m.config; menu.lobby(net.code, m.roster, false, m.config); });
      net.on('full', () => { menu.error('That lobby is full.'); net.close(); menu.go('m-play'); });
      net.on('start', (m) => runGame(m.config, m.seed, m.roster, net.myId));
      net.on('leave', () => { if (!game) { menu.error('The host closed the lobby.'); net.close(); menu.go('m-play'); } else hud.notify('Lost connection to the host', 4); });
      net.send({ t: 'hello', name: cfg.name, profile: cfg.profile });
      menu.lobby(net.code, [], false, null);
    }
  } catch (e) {
    menu.error(e.message || String(e));
    net.close();
  } finally { btn.disabled = false; }
}

function sanitize(cfg) {
  const types = cfg.ghostTypes.length ? cfg.ghostTypes : ['widow'];
  return { map: cfg.map, ghostCount: cfg.ghostCount, ghostTypes: types, lives: cfg.lives, difficulty: cfg.difficulty };
}

function pushLobby() {
  menu.lobby(net.code, lobby.roster, true, lobby.config);
  net.broadcast({ t: 'lobby', roster: lobby.roster, config: lobby.config });
}

function hostStart() {
  if (!lobby || !lobby.isHost) return;
  const seed = (Math.random() * 1e9) | 0;
  net.broadcast({ t: 'start', config: lobby.config, seed, roster: lobby.roster });
  runGame(lobby.config, seed, lobby.roster, net.myId);
}

async function runGame(config, seed, roster, localId) {
  menu.hide();
  audio.stopLoop('menu');
  const load = $('#loading'); load.classList.add('active');
  let tip = 0;
  const tipEl = $('#load-tip');
  tipEl.textContent = TIPS[Math.floor(Math.random() * TIPS.length)];
  const tipTimer = setInterval(() => { tipEl.style.opacity = 0; setTimeout(() => { tipEl.textContent = TIPS[(++tip + 3) % TIPS.length]; tipEl.style.opacity = 1; }, 600); }, 5200);
  const progress = (v, stage) => {
    $('#load-fill').style.width = (v * 100).toFixed(1) + '%';
    const r = $('#load-fill').getBoundingClientRect();
    if (Math.random() < 0.25 && r.width > 4) drip(r.right - 2, r.bottom, { size: 5 + Math.random() * 3, hang: 500 + Math.random() * 600 });
    if (stage) $('#load-stage').textContent = stage;
  };
  try {
    game = new Game({ gfx, hud, net, config, seed, localId, roster, onExit: showResults });
    await game.load(progress);
  } catch (e) {
    console.error(e);
    clearInterval(tipTimer); load.classList.remove('active');
    menu.error('Failed to load the manor: ' + (e.message || e));
    game = null; menu.show('m-play');
    return;
  }
  clearInterval(tipTimer);
  load.classList.remove('active');
  canvas.style.display = 'block';
  input.enabled = true;
  hud.show(true);
  hud.clickToPlay(true);
  const begin = async () => {
    canvas.removeEventListener('click', begin);
    hud.clickToPlay(false);
    await input.lock();
    game.start();
  };
  canvas.addEventListener('click', begin);
}

function showPause(on) {
  paused = on;
  $('#pause').classList.toggle('active', on);
  if (game) game.paused = on && !net.online;   // online games keep running
  if (!on && game) input.lock();
}

let freeCursor = false;   // U: cursor released on purpose (HUD buttons, guide) - no pause menu
input.onUnlock = () => {
  if (!game || !game.running || game.hud.noteOpen || freeCursor || game.bookOpen) return;
  showPause(true);
};
canvas.addEventListener('click', () => {
  if (game && game.running && !input.locked && !paused && !game.bookOpen) { freeCursor = false; hud.cursorHint(false); input.lock(); }
});
$('#guide-btn').addEventListener('click', (e) => { e.stopPropagation(); if (game) { if (game.bookOpen) game.closeBook(); else game.openBook(); } });
$('#mic-btn').addEventListener('click', (e) => { e.stopPropagation(); if (game?.voice?.ready) game.voice.enableMic(!game.voice.micOn); });
function toggleCursor() {
  if (!game || !game.running) return;
  if (input.locked) { freeCursor = true; input.unlock(); hud.cursorHint(true); }
  else { freeCursor = false; hud.cursorHint(false); input.lock(); }
}
$('#p-resume').addEventListener('click', () => showPause(false));
$('#p-settings').addEventListener('click', () => { $('#pause').classList.remove('active'); menu.show('m-settings'); });
$('#p-leave').addEventListener('click', () => leaveGame());
$('#res-menu').addEventListener('click', () => { $('#results').classList.remove('active'); menu.show('m-main'); audio.startLoop('menu', { vol: 0.7 }); });

function leaveGame() {
  showPause(false);
  input.unlock();
  if (game) { game.dispose(); game = null; }
  net.close(); lobby = null;
  hud.show(false);
  input.enabled = false;
  menu.show('m-main');
  audio.stopAll();
  audio.startLoop('menu', { vol: 0.7 });
}

function showResults({ win, stats }) {
  const g = game;
  game = null;
  if (g) g.dispose();
  net.close(); lobby = null;
  hud.show(false); hud.letterbox(false);
  input.enabled = false;
  gfx.fx.uFade.value = 0;
  $('#res-title').textContent = win ? 'You Escaped' : 'The Manor Keeps You';
  $('#res-sub').textContent = win ? 'The road swallows the house in fog. For now.' : 'No one made it out. The doors are already closing on the next guests.';
  $('#res-stats').innerHTML = stats.map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join('');
  $('#results').classList.add('active');
}

// ---------------------------------------------------------------------------- main loop
let last = performance.now();
gfx.renderer.setAnimationLoop((now) => {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (game && game.running && input.hit('Escape')) { if (game.bookOpen) game.closeBook(); else showPause(!paused); }
  if (game && game.running && input.hit('KeyU') && !game.bookOpen) toggleCursor();
  if (game) game.frame(dt);
  input.endFrame();
});

// dev-only debug hook (stripped from production builds)
if (import.meta.env.DEV) {
  addEventListener('error', (e) => console.warn('[page-error]', e.message, e.filename, e.lineno, e.colno));
  window.__dbg = {
    get game() { return game; }, gfx, input, assets,
    step(n = 1, dt = 1 / 60) {
      const t0 = performance.now();
      for (let i = 0; i < n; i++) { if (game) game.frame(dt); input.endFrame(); }
      const r = gfx.renderer.info.render;
      return { ms: (performance.now() - t0) / n, calls: r.calls, tris: r.triangles, progs: gfx.renderer.info.programs?.length };
    },
    async shot(name = 'shot', w = 1280, h = 720) {
      gfx.renderer.setSize(w, h, false); gfx.composer.setSize(w, h);
      if (game) { game.player.camera.aspect = w / h; game.player.camera.updateProjectionMatrix(); game.frame(1 / 60); }
      const url = canvas.toDataURL('image/jpeg', 0.85);
      await fetch('/__shot?name=' + name, { method: 'POST', body: url });
      return name;
    },
  };
}

// every change is saved as it happens; no save-on-exit (a stale tab would overwrite newer settings)
void settings;
