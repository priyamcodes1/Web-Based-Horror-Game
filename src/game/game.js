// Game session: world build, simulation loop, host-authoritative rules, networking glue, director.
import * as THREE from 'three';
import { settings, quality } from '../core/settings.js';
import { input } from '../core/input.js';
import { RNG, nextFrame } from '../core/util.js';
import { audio } from '../audio/audio.js';
import { assets, loadGLTF, loadTextureSet, loadImageTexture, TEXTURE_SETS, buildEnvMap, libMaterial, cloneProp, applyLibrary } from '../core/assets.js';
import { MAPS, PROFILES } from '../world/maps.js';
import { Level, FH } from '../world/level.js';
import { Furnisher, RECIPES } from '../world/furnish.js';
import { LightManager } from '../world/lights.js';
import { Doors } from '../world/doors.js';
import { Player, FLASH, flashCookie } from '../entities/player.js';
import { Avatar } from '../entities/avatar.js';
import { loadCast } from '../entities/cast.js';
import { VoiceChat } from '../net/voice.js';
import { installEvents, QUESTS } from './events.js';
import { getGuide } from '../ui/guide.js';
import { Ghost } from '../entities/ghost.js';
import { Items, Interact, ITEM_DEFS } from './items.js';
import { playCatch } from './cutscene.js';
import { playEscape, buildExterior } from './escape.js';
import { makeRainGlassMaterial } from '../gfx/effects.js';

const TIPS = [
  'Sprinting is loud. The Hollow Child hears footsteps from rooms away.',
  'Hold your breath with Space while hiding — but not for too long.',
  'The Widow flinches from a flashlight in her face.',
  'You will hear the Warden\'s chain long before you see him.',
  'Sliding (C while sprinting) gives a burst of speed — at the cost of stamina.',
  'Vents are too small for them. Crawl through with C.',
  'When the power dies, look for something that glows.',
  'A wound-up music box draws them in. Use it.',
  'Doors slow them down only a little. Closing one behind you still hides you.',
];

export class Game {
  constructor({ gfx, hud, net, config, seed, localId, roster, onExit }) {
    this.gfx = gfx; this.hud = hud; this.net = net; this.config = config; this.seed = seed;
    this.localId = localId; this.roster = roster; this.onExit = onExit;
    this.isHost = !net.online || net.isHost;
    this.quality = quality();
    this.scene = new THREE.Scene();
    this.rng = new RNG(seed);
    this.ticks = new Set();
    this.noiseEvents = [];
    this.keys = { brass: false, silver: false, iron: false };
    this.power = true;
    this.remote = new Map();      // id -> {agent state}
    this.avatars = new Map();     // id -> Avatar
    this.lives = new Map(roster.map((p) => [p.id, config.lives]));
    this.ghostFlicker = 0;
    this.time = 0;
    this.safeUntil = new Map();   // player id -> game time until which no ghost may catch them (respawn grace)
    this.stats = { deaths: 0, items: 0, notes: 0 };
    this.running = false;
    this.flashT = 0;
    this.sendT = 0;
    this.director = { hunt: 0, nextHunt: 0, nextBlackout: 0, nextScare: 25, huntT: 0 };
    this.guide = getGuide(() => this.closeBook());
    this.bookOpen = false;
  }

  openBook() {
    if (this.bookOpen || !this.running) return;
    this.bookOpen = true;
    input.unlock();
    this.guide.show_();
  }

  closeBook() {
    if (!this.bookOpen) return;
    this.bookOpen = false;
    if (this.guide.open) this.guide.close();
    if (this.running) input.lock();
  }

  // =========================================================================== loading
  async load(progress) {
    const P = (v, s) => progress(v, s);
    P(0.02, 'Waking the house…');
    assets.renderer = this.gfx.renderer;
    buildEnvMap(this.gfx.renderer);
    let done = 0;
    const models = ['furniture', 'items', 'exterior', ...new Set(this.config.ghostTypes.map((t) => 'ghost_' + t))];
    await Promise.all([...models.map((m) => loadGLTF(m).then(() => P(0.05 + 0.35 * (++done / (models.length + 1)), `Carving ${m.replace('ghost_', 'the ').replace('_', ' ')}…`))),
      loadCast(this.roster.map((r) => r.profile | 0)).then(() => P(0.05 + 0.35 * (++done / (models.length + 1)), 'Gathering the guests…'))]);
    done = 0;
    await Promise.all(TEXTURE_SETS.map((t) => loadTextureSet(t).then(() => P(0.4 + 0.25 * (++done / TEXTURE_SETS.length), 'Hanging the wallpaper…'))));
    await Promise.all(['painting_0', 'painting_1', 'painting_2', 'painting_3', 'painting_4'].map((n) => loadImageTexture(n)));
    await nextFrame();

    P(0.68, 'Building the manor…');
    const def = MAPS[this.config.map];
    this.scene.fog = new THREE.FogExp2(def.fog, 0.055);
    this.scene.background = new THREE.Color(def.fog);
    const L = this.level = new Level(def);
    L.build(this.scene);
    this.rainMat = makeRainGlassMaterial();
    await nextFrame();

    P(0.74, 'Furnishing the rooms…');
    const F = this.furnisher = new Furnisher(L, this.rng);
    F.rugMat = new THREE.MeshStandardMaterial({ map: assets.sets.rug_persian.c, normalMap: assets.sets.rug_persian.n, roughness: 1, metalness: 0 });
    F.runnerMat = F.rugMat;
    F.cordMat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.6 });
    F.bulbMat = libMaterial('M_bulb');
    for (const r of L.rooms) r._sides = Object.fromEntries(r.layers.map((l) => [l, F.sides(r, l)]));
    for (const r of L.rooms) {
      F.windows(r, this.rainMat);
      const recipe = RECIPES[r.type];
      if (recipe) for (const l of (r.type === 'stairs' ? [0] : r.layers)) { try { recipe(F, r, l); } catch (e) { console.warn('furnish', r.id, e); } }
    }
    await nextFrame();
    P(0.8, 'Dusting everything…');
    for (const r of L.rooms) F.mergeRoom(r);
    L.buildNav();
    this.hideList = L.rooms.flatMap((r) => r.hideSpots);
    this.hideList.forEach((h, i) => { h.gid = i; });
    this.doors = new Doors(L, this.scene);
    this.lights = new LightManager(this.scene, L);
    this.fuseRoom = L.rooms.find((r) => r.fuseBox);
    const nursery = L.rooms.find((r) => r.musicBoxSpot);
    if (nursery) {
      const mb = cloneProp('items', 'MusicBox');
      applyLibrary(mb);
      mb.position.copy(nursery.musicBoxSpot); nursery.group.add(mb);
      this.musicBox = { obj: mb, pos: mb.position.clone().setY(mb.position.y + 0.1), playing: false, room: nursery };
    }
    await nextFrame();

    P(0.86, 'Placing the lost things…');
    this.items = new Items(this);
    this.interact = new Interact(this);
    this.player = new Player(this);
    this.players = this.roster;
    this.items.distribute(new RNG(this.seed ^ 0x9e3779b9));
    const spawnRoom = L.byId[def.spawn.room];
    const idx = this.roster.findIndex((p) => p.id === this.localId);
    this.spawnRoom = spawnRoom;
    this.player.spawnAt(new THREE.Vector3(spawnRoom.cx - 1.65 + (idx % 4) * 1.1, 0, spawnRoom.z + 2.2 + Math.floor(idx / 4) * 1.1), 0);
    this.player.yaw = Math.PI; // face into the house (away from the gate)
    this.player.refreshHeld();
    for (const p of this.roster) if (p.id !== this.localId) {
      const a = new Avatar(this, p.profile, p.name);
      this.avatars.set(p.id, a);
      this.remote.set(p.id, { id: p.id, name: p.name, profile: p.profile, pos: new THREE.Vector3(spawnRoom.cx, 0, spawnRoom.z + 2), yaw: 0, alive: true, flashOn: true, vel: new THREE.Vector3(), health: 100 });
    }
    // jumpscare face light: always in the scene (light count never changes at runtime -> no shader recompiles)
    this.faceLight = new THREE.PointLight(0xdfe6ff, 0, 3.5, 2); this.faceLight.castShadow = false; this.scene.add(this.faceLight);
    // remote flashlight pool
    this.remoteLights = [0, 1, 2, 3].map(() => { const s = new THREE.SpotLight(FLASH.color, 0, FLASH.range, FLASH.angle, FLASH.penumbra, FLASH.decay); s.map = flashCookie(); s.castShadow = false; this.scene.add(s, s.target); return s; });

    P(0.9, 'Something stirs upstairs…');
    this.ghosts = [];
    const types = this.config.ghostTypes;
    for (let i = 0; i < this.config.ghostCount; i++) {
      const t = types[i % types.length];
      const gh = new Ghost(this, t, i, new RNG(this.seed + 77 * (i + 1)));
      const far = this.farthestRoom(spawnRoom);
      const p = L.randomPoint(this.rng, far[i % far.length]);
      gh.setPos(new THREE.Vector3(p.x, p.y, p.z), 0);
      gh.cool = 25 + i * 10;   // grace period at start
      this.ghosts.push(gh);
    }
    this.hud.keys(this.keys);
    this.hud.lives(this.config.lives, this.config.lives);
    this.hud.hotbar(this.player);
    this.updateObjectives();
    this.wireNet();

    P(0.93, 'Raising the storm outside…');
    this.exterior = buildExterior(this);
    P(0.95, 'Compiling shaders…');
    this.player.camera.aspect = innerWidth / innerHeight; this.player.camera.updateProjectionMatrix();
    try { await this.gfx.renderer.compileAsync(this.scene, this.player.camera); } catch (_) { /* older browsers */ }
    // hide the finale set until the escape (before the first real frame, or its rain shows up on screen)
    this.exterior.ext.visible = false;
    for (const a of this.exterior.actors) { a.root.visible = false; a.tag.visible = false; a.scripted = true; }
    // pre-compile every material in the house with the final light setup (all rooms + doors visible), so no
    // shader ever compiles mid-game (entering a new room, a catch cutscene) - those compiles freeze the screen
    for (const r of this.level.rooms) r.group.visible = true;
    for (const d of this.level.doors) for (const lf of d.leaves) lf.obj.visible = true;
    try { await this.gfx.renderer.compileAsync(this.scene, this.player.camera); } catch (_) { /* older browsers */ }
    await this.warmup(P);
    this.loaded = true;
    this.idleFrame(0.016);
    P(1, 'Enter.');
  }

  /** Render the house once from every room (4 directions, tiny target): every shader variant that real play
   *  will need compiles now, behind the loading screen, instead of freezing the game later. */
  async warmup(P) {
    const R = this.gfx.renderer;
    // same format as the real frame (MSAA half-float), or the driver builds yet another variant later
    const rt = new THREE.WebGLRenderTarget(192, 108, { type: THREE.HalfFloatType, samples: this.quality.msaa || 0 });
    const cam = new THREE.PerspectiveCamera(100, 16 / 9, 0.05, 60);
    const fl = this.player.flash; const fi = fl.intensity; fl.intensity = 1;
    // every item prop once, as the viewmodel draws it (renderOrder / no shadows)
    const shelf = new THREE.Group();
    Object.values(ITEM_DEFS).forEach((d, i) => { const o = cloneProp('items', d.prop); applyLibrary(o, { cast: false }); o.position.set((i % 6) * 0.25 - 0.6, Math.floor(i / 6) * 0.25 - 0.2, -1); o.traverse((m) => { if (m.isMesh) m.renderOrder = 5; }); shelf.add(o); });
    cam.add(shelf); this.scene.add(cam);
    const rooms = this.level.rooms;
    for (let i = 0; i < rooms.length; i++) {
      const r = rooms[i];
      for (const l of r.layers) {
        cam.position.set(r.cx, l * FH + 1.5, r.cz);
        const views = [[-0.15, 0], [-0.15, 1.57], [-0.15, 3.14], [-0.15, 4.71], [1.2, 0], [1.2, 3.14], [-1.2, 0], [-1.2, 3.14]];
        for (const [pitch, yaw] of views) {
          cam.rotation.set(pitch, yaw, 0, 'YXZ'); cam.updateMatrixWorld();
          fl.position.copy(cam.position); this.player.flashTarget.position.copy(cam.position).add(new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion));
          R.setRenderTarget(rt); R.render(this.scene, cam);
        }
      }
      if (i % 6 === 5) { P(0.955 + 0.04 * (i / rooms.length), 'Lighting the candles…'); await nextFrame(); }
    }
    // the escape ending's set, once, from where its cameras stand (moon shadow included): no hitch when it starts
    const X = this.exterior;
    if (X) {
      X.ext.visible = true; X.rain.visible = true;
      for (const a of X.actors) a.root.visible = true;
      if (X.moon.castShadow) X.moon.shadow.needsUpdate = true;
      for (const [x, y, z, yaw] of [[X.gx + 2.3, 0.35, -6.3, 0.3], [X.gx, 0.8, -12, Math.PI], [X.carX - 5.5, 1.3, -34, -1.2]]) {
        cam.position.set(x, y, z); cam.rotation.set(-0.05, yaw, 0, 'YXZ'); cam.updateMatrixWorld();
        R.setRenderTarget(rt); R.render(this.scene, cam);
      }
      X.ext.visible = false; X.rain.visible = false;
      for (const a of X.actors) { a.root.visible = false; a.torch.visible = false; }
    }
    R.setRenderTarget(null);
    rt.dispose();
    this.scene.remove(cam);
    fl.intensity = fi;
  }

  farthestRoom(from) {
    return [...this.level.rooms].filter((r) => r.type !== 'stairs')
      .sort((a, b) => Math.hypot(b.cx - from.cx, b.cz - from.cz) + (b.layers[0] !== from.layers[0] ? 10 : 0) - (Math.hypot(a.cx - from.cx, a.cz - from.cz) + (a.layers[0] !== from.layers[0] ? 10 : 0)))
      .slice(0, 5);
  }

  /** How a sound at `pos` reaches the listener: line of sight, through an open doorway, or through walls. */
  occlusion(pos) {
    const L = this.level, cam = this.player.camera.position;
    const lp = { x: pos.x, y: pos.y, z: pos.z };
    const dy = Math.abs(pos.y - cam.y);
    const otherFloor = dy > 2.6 && !this.player.room?.type?.includes('stairs');
    if (otherFloor) return { gain: 0.32, cutoff: 480, wet: 0.35 };
    if (L.los(cam, lp)) return { gain: 1, cutoff: 20000, wet: 0 };
    const la = L.roomAt(cam.x, cam.z, L.layerOfY(cam.y - 0.4)), lb = L.roomAt(pos.x, pos.z, L.layerOfY(pos.y - 0.2));
    if (la && lb && la !== lb) {
      const link = la.doors.find((d) => (d.a === lb || d.b === lb));
      if (link && (link.open || link.angle > 0.05 || link.kind === 'arch')) return { gain: 0.75, cutoff: 3200, wet: 0.12 };
      if (link) return { gain: 0.5, cutoff: 1100, wet: 0.2 };   // closed door between neighbours
    }
    if (la === lb) return { gain: 0.85, cutoff: 6000, wet: 0.05 };   // same room, something in the way
    return { gain: 0.38, cutoff: 700, wet: 0.3 };                    // somewhere else in the house
  }

  start() {
    this.running = true;
    audio.occluder = (pos) => this.occlusion(pos);
    this.hud.show(true);
    audio.stopLoop('menu');
    audio.startLoop('rain', { vol: 0.5 });
    audio.startLoop('wind', { vol: 0.35 });
    audio.startLoop('drone', { vol: 0.6 });
    audio.startLoop('heartbeat', { vol: 0 });
    audio.startLoop('chase', { vol: 0 });
    audio.play('door_slam', { vol: 1 });
    this.hud.notify('The door slams shut behind you.', 4);
    setTimeout(() => this.hud.subtitle('<i>Find the three keys. Unlock the gate. Get out.</i>', 5), 2200);
    const d = this.director;
    const diff = this.config.difficulty;
    d.nextHunt = diff === 'nightmare' ? 120 : diff === 'easy' ? 240 : 170;
    d.nextBlackout = diff === 'easy' ? 260 : 190;
    if (this.net.online) { this.voice = new VoiceChat(this); this.voice.start(); }
  }

  onTick(f) { this.ticks.add(f); }
  offTick(f) { this.ticks.delete(f); }

  // =========================================================================== frame
  /** Before the player clicks in: keep the real scene on screen (no simulation). */
  idleFrame(dt) {
    const p = this.player;
    p.updateCamera(dt); p.updateFlash(dt);
    this.lights.update(dt, p.camera.position);
    this.weather(dt);
    this.cull();
    this.gfx.render(this.scene, p.camera, dt);
  }

  frame(dt) {
    if (!this.running) { if (this.loaded && !this.finished) this.idleFrame(dt); return; }
    this.time += dt;
    const p = this.player;
    for (const f of [...this.ticks]) f(dt);
    if (!this.paused) {
      if (input.hit('KeyB') && !this.cutscene) { if (this.bookOpen) this.closeBook(); else this.openBook(); }
      if (this.hud.noteOpen) { if (input.hit('KeyE') || input.hit('Escape')) this.hud.closeNote(); }
      else if (this.bookOpen) { p.updateCamera(dt); p.updateFlash(dt); }
      else if (!this.cutscene) p.update(dt);
      else p.updateFlash(dt);
      if (p.alive) this.markVisited();
      // tab map
      const tab = input.down('Tab');
      if (tab !== this._tab || tab) this.hud.tabMap(tab, this.level, p, [...this.remote.values()].map((r) => ({ ...r, layer: this.level.layerOfY(r.pos.y + 0.3) })));
      this._tab = tab;
    }
    // local noise -> host
    if (p.noise.length) {
      if (this.isHost) this.noiseEvents.push(...p.noise); else this.net.send({ t: 'act', k: 'noise', n: p.noise });
      p.noise.length = 0;
    }
    // host simulation
    if (this.isHost) {
      const agents = this.agents();
      this.recordTrails(dt, agents);
      if (!this.adminFreeze && !this.escaping) for (const g of this.ghosts) g.think(dt, agents);
      else for (const g of this.ghosts) { g.speed = 0; g.moveSpeed = 0; }
      this.noiseEvents.length = 0;
      if (!this.escaping) this.directorTick(dt, agents);
    }
    for (const g of this.ghosts) g.update(dt);
    this.updateFear(dt);
    // remote avatars + their flashlights
    for (const [id, a] of this.avatars) if (a.scripted !== 'catch') a.update(dt, p.camera);
    this.updateRemoteLights();
    if (this.voice) { this.voice.update(dt); this.hud.micLevel(this.voice.level); }
    this.doors.update(dt);
    this.items.update(dt, p.camera.position);
    this.lights.haunts = this.ghosts.filter((g) => g.dissolve < 0.5).map((g) => ({ pos: g.pos, radius: g.state === 'chase' ? 9 : 6 }));
    this.lights.update(dt, p.camera.position);
    this.animateProps(dt);
    this.weather(dt);
    this.cull();
    // spectate camera
    if (!p.alive && !this.cutscene) this.spectateUpdate(dt);
    // room acoustics: big halls ring, small rooms are dry
    const room = p.room;
    if (room !== this._acRoom) { this._acRoom = room; audio.room.wet = room ? Math.min(0.32, 0.05 + (room.w * room.d) / 420 + (room.type === 'stairs' || room.type === 'foyer' ? 0.1 : 0)) : 0.1; }
    this.houseSounds(dt);
    // audio listener
    const cam = p.camera;
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion), up = new THREE.Vector3(0, 1, 0).applyQuaternion(cam.quaternion);
    audio.updateListener(cam.position, fwd, up);
    // network send
    this.sendT -= dt;
    if (this.net.online && this.sendT <= 0) { this.sendT = 1 / 15; this.netSend(); }
    // HUD
    this.hud.bars(p);
    this.hud.tick(dt, settings.showFps);
    this.gfx.fx.uFear.value += ((this.fear || 0) - this.gfx.fx.uFear.value) * Math.min(1, dt * 3);
    this.gfx.fx.uDistort.value = p.sanity < 35 ? (35 - p.sanity) / 35 : 0;
    this.gfx.fx.uFlash.value = this.flashT = Math.max(0, this.flashT - dt * 3);
    this.gfx.render(this.scene, cam, dt);
  }

  /** The house is never quiet: creaks, settling wood, distant knocks, somewhere nearby (local, cosmetic). */
  houseSounds(dt) {
    this._houseT = (this._houseT ?? 6) - dt;
    if (this._houseT > 0 || !this.player.alive) return;
    this._houseT = 7 + Math.random() * 14;
    const c = this.player.pos;
    const a = Math.random() * Math.PI * 2, d = 4 + Math.random() * 9;
    const pos = new THREE.Vector3(c.x + Math.cos(a) * d, c.y + (Math.random() < 0.25 ? FH : 0) + 1 + Math.random() * 1.5, c.z + Math.sin(a) * d);
    const r = Math.random();
    audio.play(r < 0.55 ? 'house_creak' : r < 0.7 ? 'knock' : r < 0.85 ? 'object_fall' : 'whisper', { pos, vol: r < 0.55 ? 0.7 : 0.45, ref: 2 });
  }

  markVisited() { const r = this.player.room; if (r && !r.visited) r.visited = true; }

  /** Portal culling: rooms are drawn only if visible through a chain of open doorways inside the view frustum. */
  cull() {
    const L = this.level, cam = this.player.camera;
    const cp = cam.position;
    const D = this.quality.drawDistance;
    cam.updateMatrixWorld();
    this._pm = this._pm || new THREE.Matrix4(); this._fr = this._fr || new THREE.Frustum(); this._bx = this._bx || new THREE.Box3();
    this._pm.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    this._fr.setFromProjectionMatrix(this._pm);
    const cl = L.layerOfY(cp.y - 0.4);
    const start = L.roomAt(cp.x, cp.z, cl) || L.roomAt(cp.x, cp.z, 1 - cl);
    for (const r of L.rooms) r._vis = false;
    if (this.escaping) {
      // escape ending: only the rooms along the front facade can be seen from outside
      for (const r of L.rooms) r._vis = r.layers.includes(0) && r.z < 1;
    } else if (!start || (this.cutscene && !this.cutsceneVictim)) {
      for (const r of L.rooms) { const dx = Math.max(r.x - cp.x, 0, cp.x - (r.x + r.w)), dz = Math.max(r.z - cp.z, 0, cp.z - (r.z + r.d)); r._vis = Math.hypot(dx, dz) < D; }
    } else {
      const q = [[start, 0]];
      start._vis = true;
      while (q.length) {
        const [room, depth] = q.shift();
        if (depth > 6) continue;
        for (const d of room.doors) {
          const other = d.a === room ? d.b : d.a;
          if (!other || other._vis) continue;
          const see = d.kind === 'arch' || d.open || d.angle > 0.02 || (d.kind === 'vent' && !d.barricaded);
          if (!see) continue;
          const dist = Math.hypot(d.x - cp.x, d.z - cp.z);
          if (dist > D) continue;
          const H = d.orient === 'h';
          const x0 = H ? d.j0 * 0.5 : d.x - 0.2, x1 = H ? d.j1 * 0.5 : d.x + 0.2;
          const z0 = H ? d.z - 0.2 : d.j0 * 0.5, z1 = H ? d.z + 0.2 : d.j1 * 0.5;
          this._bx.min.set(x0, d.y, z0); this._bx.max.set(x1, d.y + d.height, z1);
          if (dist > 1.6 && !this._fr.intersectsBox(this._bx)) continue;
          other._vis = true;
          q.push([other, depth + 1]);
        }
      }
      // the stairwell connects both floors visually
      if (L.stairs && L.stairs._vis) for (const d of L.stairs.doors) { const o = d.a === L.stairs ? d.b : d.a; if (o && Math.hypot(d.x - cp.x, d.z - cp.z) < 10) o._vis = true; }
    }
    for (const r of L.rooms) r.group.visible = r._vis;
    for (const d of L.doors) {
      const vis = (d.a && d.a._vis) || (d.b && d.b._vis);
      for (const lf of d.leaves) lf.obj.visible = vis;
      if (d.grate) { d.grate.visible = vis && d.barricaded !== false; }
    }
    L.shellGroup.visible = !!this.cutscene && !this.cutsceneVictim;
  }

  animateProps(dt) {
    const t = this.time;
    for (const r of this.level.rooms) {
      if (!r.group.visible) continue;
      if (r.clock && r.clock.pendulum) r.clock.pendulum.rotation.z = Math.sin(t * Math.PI) * 0.12;
      if (r.clock && r.clock.handM) { r.clock.handM.rotation.z = -t * 0.02; r.clock.handH.rotation.z = -t * 0.0017; }
      for (const it of r.interact) if (it.kind === 'drawer') {
        const dr = it.ref;
        dr.open += (dr.target - dr.open) * Math.min(1, dt * 8);
        dr.obj.position.z = dr.base.z + dr.open * 0.32;
      }
    }
    for (const h of this.hideList) {
      if (h.occupant === this.player || h.animOwner) continue;
      h.open = (h.open || 0) + ((h.flung || 0) - (h.open || 0)) * Math.min(1, dt * 6);
      if (h.flung) h.flung = Math.max(0, h.flung - dt * 0.5);
      if (h.doorL) h.doorL.rotation.y = -h.open * 1.6;
      if (h.doorR) h.doorR.rotation.y = h.open * 1.6;
    }
    if (this.musicBox && this.musicBox.playing) {
      const b = this.musicBox.obj.getObjectByName('MusicBox_Ballerina');
      if (b) b.rotation.y += dt * 2;
    }
  }

  weather(dt) {
    this.rainMat.uniforms.uTime.value += dt;
    this.rainMat.uniforms.uFlash.value = this.flashT;
    this.thunderT = (this.thunderT ?? 12) - dt;
    if (this.thunderT <= 0) {
      this.thunderT = 18 + Math.random() * 40;
      const close = Math.random() < 0.35;
      this.flash(close ? 1 : 0.5);
      setTimeout(() => audio.play('thunder', { close, vol: 0.8 }), close ? 80 : 900 + Math.random() * 1500);
    }
    // rain louder near windows / upper floor
    const r = this.player.room;
    const nearWin = r && r.windows.length ? 1 : 0.45;
    audio.setLoop('rain', (0.35 + 0.4 * nearWin) * (this.cutscene ? 1.2 : 1), !(r && r.windows.length));
  }

  flash(v) { this.flashT = Math.max(this.flashT, v); }

  // =========================================================================== fear / chase music
  updateFear(dt) {
    const p = this.player;
    let near = 99, chasing = false;
    for (const g of this.ghosts) {
      if (g.dissolve > 0.8) continue;
      const d = g.pos.distanceTo(p.pos);
      near = Math.min(near, d);
      if (g.state === 'chase' && g.target && g.target.id === this.localId) chasing = true;
    }
    const f = Math.max(0, 1 - near / 14);
    this.fear = Math.max(f * 0.8, chasing ? 1 : 0);
    p.fear = this.fear;
    this.ghostFlicker = Math.max(0, 1 - near / 7);
    audio.setLoop('heartbeat', this.fear > 0.2 ? Math.min(1, this.fear * 1.2) * (p.holdingBreath ? 1.3 : 1) : 0, this.fear);
    audio.setLoop('chase', chasing ? 0.9 : 0, Math.min(1, f + 0.3));
    audio.setLoop('drone', chasing ? 0.2 : 0.6);
  }

  // =========================================================================== agents (AI view of players)
  agents() {
    const list = [];
    const p = this.player;
    const camFwd = new THREE.Vector3(0, 0, -1).applyQuaternion(p.camera.quaternion);
    const litRoom = (pos, l) => { const r = this.level.roomAt(pos.x, pos.z, l); return r && this.lights.powerLevel > 0.5 && r.lights.some((a) => a.kind === 'electric' && !a.broken); };
    if (p.alive) list.push({ id: this.localId, name: settings.playerName, pos: p.pos, eye: p.eyePos, vel: p.vel, alive: p.alive, caught: this.caughtId === this.localId || this.isSafe(this.localId),
      hiding: p.hiding, hideSpot: p.hiding, justHid: false, flashOn: p.flashOn && p.battery > 0, roomLit: litRoom(p.pos, p.layer), crouch: p.state !== 'stand',
      lookDir: camFwd, yaw: p.yaw, health: p.health, holdingBreath: p.holdingBreath, exposed: !!(p.hiding && p.peekExposed) });
    for (const r of this.remote.values()) {
      if (!r.alive) continue;
      const spot = r.hd >= 0 ? this.hideList[r.hd] : null;
      list.push({ id: r.id, name: r.name, pos: r.pos, eye: new THREE.Vector3(r.pos.x, r.pos.y + (r.st === 'stand' ? 1.6 : 0.8), r.pos.z), vel: r.vel, alive: true,
        caught: this.caughtId === r.id || this.isSafe(r.id), hiding: spot, hideSpot: spot, flashOn: r.flashOn, roomLit: litRoom(r.pos, this.level.layerOfY(r.pos.y + 0.3)),
        crouch: r.st !== 'stand', lookDir: new THREE.Vector3(-Math.sin(r.yaw), 0, -Math.cos(r.yaw)), yaw: r.yaw, health: r.health ?? 100, holdingBreath: !!r.hb, exposed: !!r.pk });
    }
    return list;
  }

  allPlayers() {
    const p = this.player;
    const me = { id: this.localId, name: settings.playerName, profile: this.roster.find((r) => r.id === this.localId)?.profile ?? 0, alive: p.alive, pos: p.pos };
    return [me, ...[...this.remote.values()].map((r) => ({ id: r.id, name: r.name, profile: r.profile, alive: r.alive, pos: r.pos }))];
  }

  avatarFor(id) { return this.avatars.get(id); }
  localView() { return this.player.camera.position; }

  ghostInFront(p, range) {
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(p.camera.quaternion);
    let best = null, bd = range;
    for (const g of this.ghosts) {
      if (g.dissolve > 0.5) continue;
      const to = g.pos.clone().setY(g.pos.y + 1.4).sub(p.eyePos);
      const d = to.length();
      if (d < bd && to.normalize().dot(fwd) > 0.6 && this.level.los(p.eyePos, g.headWorld())) { bd = d; best = g; }
    }
    return best;
  }

  // =========================================================================== requests & events
  request(a) {
    if (this.isHost) this.applyAction(a, this.localId);
    else this.net.send({ t: 'act', ...a });
  }

  event(ev) {
    this.applyEvent(ev);
    if (this.net.online && this.isHost) this.net.broadcast({ t: 'ev', ...ev });
  }

  applyAction(a, pid) {
    const L = this.level;
    switch (a.k) {
      case 'noise': for (const n of a.n) this.noiseEvents.push(n); break;
      case 'pick': { const it = this.items.world.get(a.id); if (it && !it.taken) { this.event({ k: 'pick', id: a.id, by: pid }); this.questPick(a.id); } break; }
      case 'drop': this.event({ k: 'spawn', id: this.items.nextId++, type: a.type, pos: a.pos }); break;
      case 'door': { const d = L.doors[a.id]; if (d && !d.locked) { this.event({ k: 'door', id: a.id, open: a.open, from: a.from }); this.noiseEvents.push({ x: d.x, y: d.y, z: d.z, r: 7 }); } break; }
      case 'unlock': this.event({ k: 'unlock', id: a.id }); break;
      case 'vent': this.event({ k: 'vent', id: a.id }); { const d = L.doors[a.id]; this.noiseEvents.push({ x: d.x, y: d.y, z: d.z, r: 11 }); } break;
      case 'drawer': { const r = L.rooms[a.room], it = r && r.interact[a.idx]; if (it) this.event({ k: 'drawer', room: a.room, idx: a.idx, open: it.ref.target ? 0 : 1 }); break; }
      case 'fuse': if (!this.power && this.fuseRoom && !this.fuseRoom.fuseBox.hasFuse) this.event({ k: 'fuse' }); break;
      case 'lever': if (!this.power && this.fuseRoom && this.fuseRoom.fuseBox.hasFuse) this.event({ k: 'power', on: true }); break;
      case 'case': { const r = L.rooms[a.room], dc = r && r.cases[a.idx]; if (dc && !dc.broken) { this.event({ k: 'case', room: a.room, idx: a.idx }); this.noiseEvents.push({ x: dc.itemPos.x, y: dc.itemPos.y, z: dc.itemPos.z, r: 16 }); } break; }
      case 'piano': { const r = L.rooms[a.room]; this.event({ k: 'piano', room: a.room }); this.noiseEvents.push({ x: r.cx, y: r.layers[0] * FH, z: r.cz, r: 22 }); this.questAction(a); break; }
      case 'musicbox': if (this.musicBox && !this.musicBox.playing) { this.event({ k: 'musicbox' }); for (const g of this.ghosts) g.lure = { x: this.musicBox.pos.x, z: this.musicBox.pos.z, l: this.musicBox.room.layers[0], t: g.type === 'child' ? 30 : 12 }; this.questAction(a); } break;
      case 'crucifix': { const g = this.ghosts[a.ghost]; if (g && g.stun <= 0) this.event({ k: 'stun', g: a.ghost, t: g.type === 'warden' ? 3 : 6 }); break; }
      case 'gate': if (Object.values(this.keys).every(Boolean) && this.power && !this.escaping) this.event({ k: 'escape' }); break;
      default: break;
    }
  }

  applyEvent(ev) {
    const L = this.level, me = this.localId, p = this.player;
    switch (ev.k) {
      case 'pick': {
        const it = this.items.world.get(ev.id);
        if (!it) break;
        const pos = this.items.worldPos(it);
        this.items.remove(ev.id);
        const def = ITEM_DEFS[it.type];
        if (def.key) {
          this.keys[def.key] = true; this.hud.keys(this.keys);
          audio.play('key_pickup', { pos });
          this.hud.notify(ev.by === me ? `You found the ${def.name}` : `${this.nameOf(ev.by)} found the ${def.name}`, 3);
          this.updateObjectives();
          if (this.isHost && this.director.blackouts === undefined) { this.director.blackouts = 0; this.director.nextBlackout = Math.min(this.director.nextBlackout, this.time + 20); }
          if (this.isHost) this.scare(true);
        } else if (ev.by === me) {
          p.give(it.type); p.refreshHeld(); audio.play('pickup'); this.stats.items++;
          this.hud.notify(def.name, 1.5);
          if (it.type === 'fuse') this.updateObjectives();
        }
        break;
      }
      case 'spawn': this.items.spawn(ev.type, new THREE.Vector3(...ev.pos), { id: ev.id, noteIdx: ev.diary ? 10 + (this._diaryN = ((this._diaryN ?? -1) + 1) % 3) : undefined }); break;
      case 'door': {
        const d = L.doors[ev.id];
        this.doors.setOpen(d, ev.open, ev.from ? { x: ev.from[0], z: ev.from[1] } : null, ev.slam);
        audio.play(ev.smash ? 'door_bang' : ev.slam ? 'door_slam' : ev.open ? 'door_creak' : 'door_close', { pos: d.center, dur: ev.open && !ev.slam ? 0.9 : undefined });
        if (ev.smash) { audio.play('wood_break', { pos: d.center, vol: 0.7 }); if (this.player.pos.distanceTo(d.center) < 8) this.shake = Math.max(this.shake || 0, 0.5); }
        break;
      }
      case 'unlock': { const d = L.doors[ev.id]; d.locked = null; audio.play('unlock', { pos: d.center }); this.hud.notify('Unlocked', 1.5); break; }
      case 'vent': { const d = L.doors[ev.id]; this.doors.breakVent(d); audio.play('wood_break', { pos: d.center }); break; }
      case 'drawer': {
        const it = L.rooms[ev.room].interact[ev.idx]; const dr = it.ref;
        dr.target = ev.open; audio.play('drawer', { pos: it.pos });
        break;
      }
      case 'fuse': this.fuseRoom.fuseBox.hasFuse = true; audio.play('fuse_insert', { pos: this.fuseRoom.fuseBox.slot }); this.updateObjectives(); break;
      case 'power': this.setPower(ev.on); break;
      case 'case': {
        const dc = L.rooms[ev.room].cases[ev.idx]; dc.broken = true;
        if (dc.glass) dc.glass.visible = false;
        audio.play('glass_break', { pos: dc.itemPos });
        break;
      }
      case 'piano': { const r = L.rooms[ev.room]; audio.play('piano', { pos: new THREE.Vector3(r.cx, r.layers[0] * FH + 1, r.cz), vol: 1 }); break; }
      case 'musicbox':
        this.musicBox.playing = true;
        audio.play('musicbox', { pos: this.musicBox.pos, vol: 1, ref: 3 });
        setTimeout(() => { this.musicBox.playing = false; }, 9000);
        break;
      case 'stun': { const g = this.ghosts[ev.g]; g.stun = ev.t; g.state = 'stunned'; this.flash(0.35); audio.play('scream', { pos: g.headWorld(), vol: 0.8 }); break; }
      case 'catch': this.onCatch(ev); break;
      case 'hit': this.onHit(ev); break;
      case 'lives': this.lives.set(ev.id, ev.lives); if (ev.id === me) this.hud.lives(ev.lives, this.config.lives); break;
      case 'dead': { const r = this.remote.get(ev.id); if (r) r.alive = false; break; }
      case 'hunt': this.setHunt(ev.on); break;
      case 'scare': this.runScare(ev); break;
      case 'quest': this.applyQuest(ev); break;
      case 'fling': { const h = this.hideList[ev.spot]; if (!h) break; if (h.kind === 'bed') audio.play('bed_creak', { pos: h.pos, vol: 1 }); else { h.flung = 1; audio.play('door_slam', { pos: h.pos, vol: 0.7 }); } break; }
      case 'escape': this.escape(); break;
      case 'admin':
        if (ev.op === 'keys') {
          for (const k of Object.keys(this.keys)) this.keys[k] = true;
          this.hud.keys(this.keys); this.updateObjectives();
          audio.play('key_pickup');
        }
        break;
      case 'gsay': { const gh = this.ghosts[ev.g]; if (gh) gh.speak(ev.kind, ev.vol); break; }
      case 'freeze':
        if (ev.ids.includes(me) && p.alive && !p.hiding) {
          p.frozen = ev.t; this.hud.notify("Your legs won't move!", ev.t); audio.play('gasp', { vol: 0.9 });
          this.shake = Math.max(this.shake || 0, 0.8);
        }
        break;
      case 'gameover': this.gameOver(false); break;
      case 'sound': audio.play(ev.name, { pos: new THREE.Vector3(...ev.pos), vol: ev.vol }); break;
      default: break;
    }
  }

  nameOf(id) { return id === this.localId ? settings.playerName : this.remote.get(id)?.name || 'Someone'; }

  // =========================================================================== power / hunts / director
  setPower(on) {
    this.power = on;
    this.lights.setPower(on);
    if (on) { this.lights.fixAll(); audio.play('power_up', { pos: this.fuseRoom?.fuseBox.slot }); this.hud.notify('The lights flicker back to life', 3); }
    else { audio.play('power_down', { vol: 1 }); this.hud.notify('The power has failed', 3.5); }
    if (this.fuseRoom?.fuseBox.lever) this.fuseRoom.fuseBox.lever.rotation.x = on ? -0.6 : 0.6;
    this.updateObjectives();
  }

  blackout() {
    const fb = this.fuseRoom?.fuseBox;
    if (!fb) return;
    this.event({ k: 'power', on: false });
    // burn out the fuse and spawn replacements somewhere else in the house
    this.fuseRoom.fuseBox.hasFuse = false;
    const far = this.level.rooms.filter((r) => r !== this.fuseRoom && r.type !== 'stairs' && Math.hypot(r.cx - this.fuseRoom.cx, r.cz - this.fuseRoom.cz) > 10);
    for (let i = 0; i < 2; i++) {
      const r = this.rng.pick(far);
      const spot = r.spots.find((s) => s.kind === 'surface' && !s.used) || null;
      const pos = spot ? spot.pos : (() => { const q = this.level.randomPoint(this.rng, r); return new THREE.Vector3(q.x, q.y + 0.02, q.z); })();
      if (spot) spot.used = true;
      this.event({ k: 'spawn', id: this.items.nextId++, type: 'fuse', pos: [pos.x, pos.y, pos.z] });
    }
  }

  setHunt(on) {
    this.hunt = on;
    this.lights.hunt = on ? 1 : 0;
    for (const g of this.ghosts) g.hunt = on ? 1 : 0;
    if (on) { audio.play('stinger', { vol: 0.5 }); this.hud.notify('They are hunting…', 3); this.hud.subtitle('<i>Hide.</i>', 3); }
  }

  directorTick(dt, agents) {
    const d = this.director;
    if (this.escaping) return;
    // hunts
    if (!this.hunt && this.time > d.nextHunt) { this.event({ k: 'hunt', on: true }); d.huntT = 30 + Math.random() * 12; }
    if (this.hunt) { d.huntT -= dt; if (d.huntT <= 0) { this.event({ k: 'hunt', on: false }); d.nextHunt = this.time + (this.config.difficulty === 'nightmare' ? 110 : 160) + Math.random() * 70; } }
    // blackouts
    if (this.power && this.time > d.nextBlackout && d.blackouts !== undefined) {
      this.blackout(); d.blackouts++; d.nextBlackout = this.time + 230 + Math.random() * 150;
    } else if (this.power && d.blackouts === undefined && this.time > 200) { d.blackouts = 0; d.nextBlackout = this.time + 5; }
    // haunting events + side quests
    d.nextScare -= dt;
    if (d.nextScare <= 0) { this.scare(this.rng.chance(0.18)); d.nextScare = 16 + Math.random() * 26; }
    this.questTick(dt, agents);
    // all dead?
    if (!agents.length && !this.over && [...this.lives.values()].every((v) => v <= 0)) { this.over = true; this.event({ k: 'gameover' }); }
  }

  // =========================================================================== ghost interactions (host)
  ghostOpensDoor(door, pos, slam, smash = false) {
    if (door.locked || door.kind === 'vent' || door.kind === 'gate') return;
    if (!smash && this.time - door.lastToggle < 1.5) return;
    if (door.open && !smash) return;
    door.lastToggle = this.time;
    this.event({ k: 'door', id: door.id, open: true, from: [pos.x, pos.z], slam, smash: smash ? 1 : 0 });
    this.noiseEvents.push({ x: door.x, y: door.y, z: door.z, r: smash ? 18 : 6 });
  }

  /** Warden: a point on the nearest survivor's trail from a few seconds ago (scent). */
  scentTrail(from, layer) {
    let best = null, bd = 1e9;
    for (const [id, tr] of this.trails || []) {
      if (!tr.length) continue;
      const head = tr[tr.length - 1];
      const d = Math.hypot(head.x - from.x, head.z - from.z) + (head.l !== layer ? 10 : 0);
      if (d < bd && d < 45) { bd = d; best = tr[Math.max(0, tr.length - 12)]; }
    }
    return best;
  }

  recordTrails(dt, agents) {
    this._trailT = (this._trailT || 0) - dt;
    if (this._trailT > 0) return;
    this._trailT = 0.5;
    this.trails ||= new Map();
    for (const a of agents) {
      if (!this.trails.has(a.id)) this.trails.set(a.id, []);
      const t = this.trails.get(a.id);
      t.push({ x: a.pos.x, z: a.pos.z, l: this.level.layerOfY(a.pos.y + 0.3) });
      if (t.length > 40) t.shift();
    }
  }

  freezePlayers(ids, t) { this.event({ k: 'freeze', ids, t }); }

  onGhostLit(ghost, pl) {
    if (pl.id !== this.localId) return;
    const msg = { widow: 'She shields her eyes and recoils…', child: 'She shrieks and scurries away from the light…', warden: 'He throws an arm over his eyes — and comes on angrier.' }[ghost.type];
    this.hud.subtitle(`<i>${msg}</i>`, 2.5);
  }

  hitPlayer(ghost, agent, dmg) { this.event({ k: 'hit', g: ghost.id, id: agent.id, dmg }); }

  onHit(ev) {
    const g = this.ghosts[ev.g];
    if (ev.id === this.localId) {
      const p = this.player;
      if (this.adminGod) return;
      p.health = Math.max(1, p.health - ev.dmg);
      p.adrenaline = Math.max(p.adrenaline, 2.2);   // flight response
      p.stamina = Math.min(100, p.stamina + 30);
      const away = p.pos.clone().sub(g.pos).setY(0).normalize();
      p.vel.addScaledVector(away, 6);
      audio.play('hurt'); audio.play('cleaver', { vol: 0.8 }); audio.play('hit', { vol: 0.8 });
      this.gfx.fx.uDamage.value = 1; setTimeout(() => { this.gfx.fx.uDamage.value = 0; }, 450);
      this.shake = Math.max(this.shake || 0, 1.2);
      this.hud.notify('RUN', 1.2);
    } else {
      const r = this.remote.get(ev.id);
      audio.play('hurt', { pos: r?.pos?.clone().setY(r.pos.y + 1.5) }); audio.play('hit', { pos: r?.pos });
      const a = this.avatars.get(ev.id);
      if (a && !a.scripted) { a.scripted = 'hit'; a.play('Stumble', 0.08, true, 1.4); setTimeout(() => { if (a.scripted === 'hit') a.scripted = false; }, 900); }
    }
  }

  /** Just caught: through the death screen and a few seconds after respawning nobody can take them again. */
  isSafe(id) { return (this.safeUntil.get(id) ?? -1) > this.time || (this.adminGod && id === this.localId); }

  catchPlayer(ghost, agent) {
    if (this.caughtId || this.isSafe(agent.id)) { ghost.state = 'chase'; return; }
    this.event({ k: 'catch', g: ghost.id, id: agent.id, pos: agent.pos.toArray(), yaw: agent.yaw });
  }

  pullOutOfHiding(ghost, agent, spot) {
    this.event({ k: 'fling', spot: spot.gid });
    this.catchPlayer(ghost, agent);
  }

  flingHideSpot(spot) { this.event({ k: 'fling', spot: spot.gid }); }

  async onCatch(ev) {
    const g = this.ghosts[ev.g];
    const local = ev.id === this.localId;
    this.caughtId = ev.id;
    const victim = local
      ? { id: this.localId, pos: this.player.pos.clone(), yaw: this.player.yaw }
      : { id: ev.id, pos: new THREE.Vector3(...ev.pos), yaw: ev.yaw };
    if (local && this.player.hiding) this.player.exitHide(true);
    if (local) { this.cutscene = true; this.cutsceneVictim = true; audio.setLoop('chase', 0); }
    await playCatch(this, g, victim, local);
    this.safeUntil.set(ev.id, this.time + 3.5 + 3);   // death screen (3.5 s) + a moment to get your bearings
    this.caughtId = null;
    if (this.isHost) {
      const lives = (this.lives.get(ev.id) ?? 1) - 1;
      this.event({ k: 'lives', id: ev.id, lives });
      g.state = 'retreat';
      g.vanish(() => { g.teleportFar(victim.pos); g.state = 'roam'; g.cool = 22 * g.diff.cool; g.target = null; });
      if (lives <= 0) this.event({ k: 'dead', id: ev.id });
    }
    if (local) this.afterCaught();
  }

  afterCaught() {
    const p = this.player;
    const lives = this.lives.get(this.localId) ?? 0;
    this.stats.deaths++;
    this.cutscene = false;
    p.locked = false; p.cinematic = false;
    if (lives > 0) {
      this.hud.death(true, 'You were taken', `${lives} ${lives === 1 ? 'life' : 'lives'} remaining…`);
      setTimeout(() => {
        this.hud.death(false);
        this.gfx.fx.uFade.value = 0;
        const r = this.safeRoom();
        const q = this.level.randomPoint(this.rng, r);
        p.spawnAt(new THREE.Vector3(q.x, q.y, q.z), this.rng.range(-3, 3));
        p.health = 100; p.stamina = 100; p.sanity = Math.max(p.sanity, 50);
        audio.play('gasp');
      }, 3500);
    } else {
      p.alive = false;
      this.hud.death(true, 'The manor keeps you', 'No lives remain. You can still watch…');
      setTimeout(() => { this.hud.death(false); this.gfx.fx.uFade.value = 0; this.startSpectate(); }, 4000);
      if (this.isHost) this.event({ k: 'dead', id: this.localId });
    }
  }

  safeRoom() {
    const rooms = this.level.rooms.filter((r) => r.type !== 'stairs');
    let best = rooms[0], bd = -1;
    for (const r of rooms) {
      const d = Math.min(...this.ghosts.map((g) => Math.hypot(g.pos.x - r.cx, g.pos.z - r.cz) + (g.layer !== r.layers[0] ? 8 : 0)));
      if (d > bd) { bd = d; best = r; }
    }
    return best;
  }

  // =========================================================================== spectate
  startSpectate() {
    this.spectating = true;
    this.specIdx = 0;
    document.getElementById('spec-prev').onclick = () => this.cycleSpectate(-1);
    document.getElementById('spec-next').onclick = () => this.cycleSpectate(1);
    this.cycleSpectate(0);
  }

  cycleSpectate(d) {
    const alive = [...this.remote.values()].filter((r) => r.alive);
    if (!alive.length) { this.hud.spectate(true, 'No one left'); return; }
    this.specIdx = ((this.specIdx + d) % alive.length + alive.length) % alive.length;
    this.specTarget = alive[this.specIdx].id;
    this.hud.spectate(true, alive[this.specIdx].name);
  }

  spectateUpdate(dt) {
    if (input.hit('KeyQ') || input.hit('ArrowLeft')) this.cycleSpectate(-1);
    if (input.hit('KeyE') || input.hit('ArrowRight')) this.cycleSpectate(1);
    const r = this.remote.get(this.specTarget);
    if (!r || !r.alive) { this.cycleSpectate(1); return; }
    const cam = this.player.camera;
    const back = new THREE.Vector3(Math.sin(r.yaw), 0, Math.cos(r.yaw));
    const want = r.pos.clone().addScaledVector(back, 2.2).add(new THREE.Vector3(0.45, 1.9, 0));
    // keep camera out of walls
    const L = this.level;
    if (!L.los(r.pos.clone().setY(r.pos.y + 1.6), want)) want.copy(r.pos).setY(r.pos.y + 1.7).addScaledVector(back, 0.4);
    cam.position.lerp(want, 1 - Math.exp(-8 * dt));
    const look = r.pos.clone().setY(r.pos.y + 1.4).addScaledVector(back, -3);
    cam.lookAt(look);
    this.player.pos.copy(r.pos);
  }

  // =========================================================================== objectives & end states
  updateObjectives() {
    const k = this.keys, n = Object.values(k).filter(Boolean).length;
    const list = [];
    if (!this.power) {
      const fb = this.fuseRoom?.fuseBox;
      list.push({ text: fb && fb.hasFuse ? `Pull the lever in the ${this.fuseRoom.name}` : this.player?.has('fuse') ? `Bring the fuse to the ${this.fuseRoom.name}` : 'The power is out — find a glowing fuse', done: false });
    }
    list.push({ text: `Brass key ${k.brass ? '✓' : '— hidden in a drawer'}`, done: k.brass });
    list.push({ text: `Silver key ${k.silver ? '✓' : '— behind glass in the collection'}`, done: k.silver });
    list.push({ text: `Iron key ${k.iron ? '✓' : '— where the Lady bathed (locked from inside)'}`, done: k.iron });
    list.push({ text: n >= 3 ? (this.power ? 'Unlock the main gate in the foyer' : 'Restore power to open the gate') : `Unlock the main gate (${n}/3)`, done: false });
    if (this.quest) list.push({ text: QUESTS[this.quest.id].text(this.quest), side: true, done: false });
    this.hud.objectives(list);
  }

  async escape() {
    if (this.escaping) return;
    this.escaping = true;
    this.hud.prompt(null);
    if (this.bookOpen) this.closeBook();
    if (this.hud.noteOpen) this.hud.closeNote();
    if (this.player.hiding) this.player.exitHide(true);
    for (const g of this.ghosts) { g.state = 'retreat'; g.dissolveTarget = 1; }
    audio.setLoop('chase', 0); audio.setLoop('heartbeat', 0); audio.setLoop('drone', 0.2);
    this.gfx.fx.uFade.value = 0;
    await playEscape(this);
    this.finish(true);
  }

  gameOver() { this.finish(false); }

  finish(win) {
    this.running = false; this.finished = true;
    input.unlock();
    audio.stopAll();
    const mins = Math.floor(this.time / 60), secs = Math.floor(this.time % 60);
    this.onExit({ win, stats: [['Time in the manor', `${mins}:${String(secs).padStart(2, '0')}`], ['Times caught', this.stats.deaths], ['Items found', this.stats.items], ['Keys recovered', `${Object.values(this.keys).filter(Boolean).length}/3`]] });
  }

  // =========================================================================== networking
  wireNet() {
    const net = this.net;
    if (!net.online) return;
    net.on('act', (m, from) => { if (this.isHost) this.applyAction(m, from); });
    net.on('ev', (m) => { if (!this.isHost) this.applyEvent(m); });
    net.on('st', (m, from) => { if (this.isHost) this.applyRemoteState(from, m); });
    net.on('ws', (m) => { if (this.isHost) return; this.applyWorldState(m); });
    net.on('leave', ({ id }) => { const a = this.avatars.get(id); if (a) a.dispose(); this.avatars.delete(id); this.remote.delete(id); this.hud.notify(`${this.nameOf(id)} left`, 2); });
  }

  myState() {
    const p = this.player;
    return { x: +p.pos.x.toFixed(2), y: +p.pos.y.toFixed(2), z: +p.pos.z.toFixed(2), yaw: +p.yaw.toFixed(3), pitch: +p.pitch.toFixed(2), st: p.state,
      sp: +Math.hypot(p.vel.x, p.vel.z).toFixed(2), fl: p.flashOn && p.battery > 0 ? 1 : 0, hd: p.hiding ? p.hiding.gid : -1, al: p.alive ? 1 : 0,
      h: Math.round(p.health), hb: p.holdingBreath ? 1 : 0, tk: this.voice?.talking ? 1 : 0, pk: p.peekExposed && p.hiding ? 1 : 0, em: p.emoting ? 1 : 0 };
  }

  netSend() {
    if (this.isHost) {
      const players = { [this.localId]: this.myState() };
      for (const [id, r] of this.remote) if (r.raw) players[id] = r.raw;
      this.net.broadcast({ t: 'ws', p: players, g: this.ghosts.map((g) => g.serialize()), pw: this.power ? 1 : 0, keys: this.keys, fb: this.fuseRoom?.fuseBox.hasFuse ? 1 : 0 });
    } else {
      this.net.send({ t: 'st', ...this.myState() });
    }
  }

  applyRemoteState(id, s) {
    const r = this.remote.get(id);
    if (!r) return;
    const prev = r.pos.clone();
    r.raw = s;
    r.pos.set(s.x, s.y, s.z); r.yaw = s.yaw; r.st = s.st; r.flashOn = !!s.fl; r.hd = s.hd; r.alive = s.al !== 0; r.health = s.h; r.hb = s.hb; r.pk = s.pk;
    // remote hiders occupy their spot for everyone (no one else can climb in)
    if (r.hd !== r._hd) { const o = this.hideList[r._hd]; if (o && o.occupant === r) o.occupant = null; const n = this.hideList[r.hd]; if (n && !n.occupant) n.occupant = r; r._hd = r.hd; }
    r.vel.copy(r.pos).sub(prev).multiplyScalar(15);
    const a = this.avatars.get(id);
    if (a && !a.scripted) a.setState(s);
  }

  applyWorldState(m) {
    for (const [id, s] of Object.entries(m.p)) if (id !== this.localId) this.applyRemoteState(id, s);
    const dt = 1 / 15;
    for (const gs of m.g) { const g = this.ghosts[gs[0]]; if (g && g.state !== 'grab') g.applyNet(gs, dt); }
    if (!!m.pw !== this.power) this.setPower(!!m.pw);
    if (this.fuseRoom) this.fuseRoom.fuseBox.hasFuse = !!m.fb;
    let changed = false;
    for (const k of Object.keys(this.keys)) if (m.keys[k] && !this.keys[k]) { this.keys[k] = true; changed = true; }
    if (changed) { this.hud.keys(this.keys); this.updateObjectives(); }
  }

  updateRemoteLights() {
    const cam = this.player.camera.position;
    // the escape ending: the survivors running for the car carry their torches
    const list = this.escaping ? (this.cutsceneActors || []).filter((a) => a.torchOn && a.root.visible).map((a) => [a.id, a])
      : [...this.avatars.entries()].filter(([id]) => this.remote.get(id)?.flashOn && this.remote.get(id)?.alive)
        .sort((a, b) => a[1].pos.distanceTo(cam) - b[1].pos.distanceTo(cam));
    const pos = new THREE.Vector3(), dir = new THREE.Vector3();
    this.remoteLights.forEach((L, i) => {
      const e = list[i];
      if (!e || !e[1].root.visible) { L.intensity = 0; return; }
      e[1].torchWorld(pos, dir);
      L.position.copy(pos); L.target.position.copy(pos).add(dir); L.intensity = FLASH.intensity * 0.85;
    });
  }

  // =========================================================================== teardown
  dispose() {
    this.running = false; this.finished = true;
    if (this.bookOpen) { this.bookOpen = false; this.guide.close(); }
    if (this.voice) this.voice.dispose();
    audio.occluder = null;
    audio.stopAll();
    this.scene.traverse((o) => {
      if (o.geometry && !o.isSkinnedMesh) o.geometry.dispose?.();
    });
    this.gfx.renderer.renderLists.dispose();
  }
}

export { PROFILES };

installEvents(Game);
