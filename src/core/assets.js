// Asset loading: glTF (meshopt), shared PBR texture library, M_* material substitution, character cloning.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { clone as skeletonClone } from 'three/addons/utils/SkeletonUtils.js';
import { quality } from './settings.js';

const texLoader = new THREE.TextureLoader();
const gltfLoader = new GLTFLoader();
gltfLoader.setMeshoptDecoder(MeshoptDecoder);

export const assets = {
  gltf: {},
  textures: {},
  mats: {},
  sets: {},
  renderer: null,
  envMap: null,
};

// Texture sets available in /textures (name -> kind hints)
export const TEXTURE_SETS = [
  'wood_floor', 'wood_floor_light', 'parquet', 'wood_dark', 'wood_light', 'wood_old',
  'wallpaper_red', 'wallpaper_green', 'wallpaper_blue', 'wallpaper_grey', 'wallpaper_gold',
  'plaster', 'marble', 'tile_checker', 'tile_wall', 'stone_floor', 'brick', 'concrete',
  'metal_rust', 'brass', 'iron', 'velvet_red', 'velvet_green', 'fabric_linen', 'leather',
  'rug_persian', 'ground_mud', 'gravel', 'asphalt', 'roof_slate', 'bark', 'paper',
];

function loadTex(url, srgb) {
  return new Promise((res) => {
    texLoader.load(url, (t) => {
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      t.anisotropy = Math.min(quality().anisotropy, assets.renderer ? assets.renderer.capabilities.getMaxAnisotropy() : 4);
      res(t);
    }, undefined, () => res(null));
  });
}

export async function loadTextureSet(name) {
  if (assets.sets[name]) return assets.sets[name];
  const [c, n, orm] = await Promise.all([
    loadTex(`/textures/${name}_c.webp`, true), loadTex(`/textures/${name}_n.webp`, false), loadTex(`/textures/${name}_orm.webp`, false),
  ]);
  assets.sets[name] = { c, n, orm };
  return assets.sets[name];
}

export async function loadImageTexture(name) {
  if (assets.textures[name]) return assets.textures[name];
  const t = await loadTex(`/textures/${name}.webp`, true);
  if (t) { t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; }
  assets.textures[name] = t;
  return t;
}

export function loadGLTF(name) {
  if (assets.gltf[name]) return Promise.resolve(assets.gltf[name]);
  return new Promise((res, rej) => {
    gltfLoader.load(`/models/${name}.glb`, (g) => { assets.gltf[name] = g; res(g); }, undefined, rej);
  });
}

/** Standard PBR material from a texture set. */
export function pbr(setName, opts = {}) {
  const key = setName + JSON.stringify(opts);
  if (assets.mats[key]) return assets.mats[key];
  const s = assets.sets[setName];
  const Ctor = (opts.physical && quality().physical) ? THREE.MeshPhysicalMaterial : THREE.MeshStandardMaterial;
  const m = new Ctor({
    map: s?.c || null, normalMap: s?.n || null, roughnessMap: s?.orm || null, metalnessMap: s?.orm || null,
    aoMap: s?.orm || null, aoMapIntensity: 0.85, roughness: opts.roughness ?? 1, metalness: opts.metalness ?? 1,
    color: new THREE.Color(opts.color ?? 0xffffff), normalScale: new THREE.Vector2(opts.normal ?? 1, opts.normal ?? 1),
    side: opts.side ?? THREE.FrontSide,
  });
  if (opts.physical && m.isMeshPhysicalMaterial) { m.clearcoat = opts.clearcoat ?? 0; m.clearcoatRoughness = 0.15; m.sheen = opts.sheen ?? 0; }
  if (opts.envMap && assets.envMap) { m.envMap = assets.envMap; m.envMapIntensity = opts.envMapIntensity ?? 0.25; }
  m.name = 'lib_' + setName;
  assets.mats[key] = m;
  return m;
}

function plain(key, params, Ctor = THREE.MeshStandardMaterial) {
  if (assets.mats[key]) return assets.mats[key];
  const m = new Ctor(params);
  m.name = key;
  assets.mats[key] = m;
  return m;
}

// Shared emissive materials whose intensity the game drives (power on/off, flicker)
export const emissive = {
  bulb: null, flame: null, ember: null, window: null,
};

/** Resolve an M_* placeholder material name to a real material. */
export function libMaterial(mname, original) {
  const n = mname.replace(/^M_/, '').replace(/\.\d+$/, '');
  const env = { envMap: true };
  switch (n) {
    case 'wood_dark': return pbr('wood_dark', { physical: true, clearcoat: 0.35 });
    case 'wood_light': return pbr('wood_light');
    case 'wood_old': return pbr('wood_old');
    case 'velvet_red': return pbr('velvet_red', { physical: true, sheen: 1 });
    case 'velvet_green': return pbr('velvet_green', { physical: true, sheen: 1 });
    case 'leather': return pbr('leather');
    case 'fabric_linen': return pbr('fabric_linen');
    case 'cloth_dust': return pbr('fabric_linen', { color: 0xb8b2a6 });
    case 'felt': return pbr('velvet_green', { color: 0x4f9a5f });
    case 'brass': return pbr('brass', env);
    case 'iron': return pbr('iron', env);
    case 'metal_rust': return pbr('metal_rust', env);
    case 'marble': return pbr('marble', { physical: true, clearcoat: 0.2 });
    case 'stone_floor': return pbr('stone_floor');
    case 'brick': return pbr('brick');
    case 'plaster': return pbr('plaster');
    case 'paper': return pbr('paper');
    case 'concrete': return pbr('concrete');
    case 'roof_slate': return pbr('roof_slate');
    case 'bark': return pbr('bark');
    case 'tile_wall': return pbr('tile_wall');
    case 'book_a': return pbr('leather', { color: 0xb03a2e });
    case 'book_b': return pbr('leather', { color: 0x3f7a4f });
    case 'book_c': return pbr('leather', { color: 0x3f4f9a });
    case 'book_d': return pbr('leather', { color: 0xc8a060 });
    case 'porcelain': return plain('porcelain', { color: 0xe8e4dc, roughness: 0.12, metalness: 0, envMap: assets.envMap, envMapIntensity: 0.35 });
    case 'ivory': return plain('ivory', { color: 0xe6dcc4, roughness: 0.35, metalness: 0 });
    case 'wax': return plain('wax', { color: 0xe8dcc0, roughness: 0.55, metalness: 0, emissive: 0x2a1a08, emissiveIntensity: 0.4 });
    case 'rubber': return plain('rubber', { color: 0x0b0b0b, roughness: 0.85, metalness: 0 });
    case 'plastic': return plain('plastic', { color: 0x1a1a1a, roughness: 0.45, metalness: 0 });
    case 'black': return plain('black', { color: 0x050505, roughness: 0.7, metalness: 0 });
    case 'lacquer': return plain('lacquer', { color: 0x040404, roughness: 0.18, metalness: 0, envMap: assets.envMap, envMapIntensity: 0.6 }, quality().physical ? THREE.MeshPhysicalMaterial : THREE.MeshStandardMaterial);
    case 'chrome': return plain('chrome', { color: 0xc8c8cc, roughness: 0.18, metalness: 1, envMap: assets.envMap, envMapIntensity: 0.7 });
    case 'mirror': return plain('mirror', { color: 0x9aa0a4, roughness: 0.03, metalness: 1, envMap: assets.envMap, envMapIntensity: 0.9 });
    case 'glass': return plain('glass', { color: 0x9fb4b6, roughness: 0.05, metalness: 0, transparent: true, opacity: 0.22, depthWrite: false, envMap: assets.envMap, envMapIntensity: 0.8 });
    case 'gauge': case 'clockface': return pbr('paper', { color: 0xf0e8d0 });
    case 'red_cross': return plain('red_cross', { color: 0x8a0f0f, roughness: 0.5, metalness: 0 });
    case 'carpaint': return plain('carpaint', { color: 0x1a1f26, roughness: 0.28, metalness: 0.6, envMap: assets.envMap, envMapIntensity: 0.8 }, quality().physical ? THREE.MeshPhysicalMaterial : THREE.MeshStandardMaterial);
    case 'bulb':
      return (emissive.bulb ||= plain('bulb', { color: 0xfff2d8, emissive: 0xffc27a, emissiveIntensity: 3, roughness: 0.3 }));
    case 'flame':
      return (emissive.flame ||= plain('flame', { color: 0xffa640, emissive: 0xff9a30, emissiveIntensity: 5, transparent: true, opacity: 0.9, depthWrite: false }, THREE.MeshBasicMaterial));
    case 'ember':
      return (emissive.ember ||= plain('ember', { color: 0x2a0a02, emissive: 0xff3a0a, emissiveIntensity: 2.5, roughness: 0.9 }));
    case 'window_glow':
      return (emissive.window ||= plain('window_glow', { color: 0x1a1008, emissive: 0xffa550, emissiveIntensity: 1.6 }));
    case 'headlight': return plain('headlight', { color: 0xffffff, emissive: 0xfff4dc, emissiveIntensity: 6 });
    case 'taillight': return plain('taillight', { color: 0x400000, emissive: 0xff1a0a, emissiveIntensity: 2.5 });
    case 'emissive_red': return plain('emissive_red', { color: 0x300000, emissive: 0xff2210, emissiveIntensity: 1.5 });
    default:
      if (n.startsWith('painting_')) {
        const t = assets.textures[n];
        return plain(n, { map: t || null, roughness: 0.55, metalness: 0, color: 0xffffff });
      }
      return original;
  }
}

/** Replace M_* placeholders on a loaded scene graph; enable shadows as requested. */
export function applyLibrary(root, { cast = true, receive = true } = {}) {
  root.traverse((o) => {
    if (!o.isMesh) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    const out = mats.map((m) => (m && m.name && m.name.startsWith('M_') ? libMaterial(m.name, m) : m));
    o.material = Array.isArray(o.material) ? out : out[0];
    const nm = (Array.isArray(o.material) ? o.material[0] : o.material)?.name || '';
    const lightish = /bulb|flame|ember|window|glass|headlight|taillight/.test(nm);
    o.castShadow = cast && !lightish;
    o.receiveShadow = receive;
  });
  return root;
}

/** Fix-ups for character GLBs: alpha hair, veil, glowing eyes. */
export function prepareCharacter(root, msaa) {
  root.traverse((o) => {
    if (!o.isMesh) return;
    o.frustumCulled = false; // skinned bounds are unreliable when animated
    o.castShadow = true;
    o.receiveShadow = true;
    const m = o.material;
    const n = m.name || '';
    if (/Hair/.test(n)) {
      m.alphaTest = 0.35; m.transparent = false; m.side = THREE.DoubleSide; m.alphaToCoverage = !!msaa; m.depthWrite = true;
      m.roughness = 0.55;
    } else if (/Veil/.test(n)) {
      m.transparent = true; m.depthWrite = false; m.side = THREE.DoubleSide; m.opacity = 0.9;
      o.castShadow = false; o.renderOrder = 2;
    } else if (/Eye|Pupil/.test(n)) {
      if (m.emissive) { m.emissiveIntensity = Math.max(m.emissiveIntensity, 1.5); }
      o.castShadow = false;
    }
    if (m.map) m.map.anisotropy = 4;
  });
  return root;
}

/** Clone a skinned character from a cached glTF. */
export function cloneCharacter(name) {
  const g = assets.gltf[name];
  const root = skeletonClone(g.scene);
  return { root, animations: g.animations };
}

/** Clone a named prop root (node) out of a props GLB. */
export function cloneProp(glbName, nodeName) {
  const g = assets.gltf[glbName];
  const src = g.scene.getObjectByName(nodeName);
  if (!src) { console.warn('missing prop', nodeName); return new THREE.Group(); }
  const c = src.clone(true);
  c.position.set(0, 0, 0);
  c.rotation.set(0, 0, 0);
  c.updateMatrix();
  return c;
}

export function buildEnvMap(renderer) {
  // A dim, warm interior environment for subtle metal/glass reflections (not a light source).
  const pm = new THREE.PMREMGenerator(renderer);
  const s = new THREE.Scene();
  s.background = new THREE.Color(0x07060a);
  const geo = new THREE.BoxGeometry(1, 1, 1);
  const mk = (c, x, y, z, sx, sy, sz) => { const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: c, side: THREE.BackSide })); m.position.set(x, y, z); m.scale.set(sx, sy, sz); s.add(m); };
  mk(0x120d0a, 0, 0, 0, 20, 8, 20);
  const lampM = new THREE.MeshBasicMaterial({ color: 0xffb070 });
  for (const [x, z] of [[-4, 0], [4, 3], [0, -5]]) { const l = new THREE.Mesh(new THREE.SphereGeometry(0.4, 12, 8), lampM); l.position.set(x, 3, z); s.add(l); }
  const win = new THREE.Mesh(new THREE.PlaneGeometry(3, 4), new THREE.MeshBasicMaterial({ color: 0x3a4a66 })); win.position.set(0, 1, 9.9); win.rotation.y = Math.PI; s.add(win);
  const rt = pm.fromScene(s, 0.02);
  assets.envMap = rt.texture;
  pm.dispose();
  return assets.envMap;
}
