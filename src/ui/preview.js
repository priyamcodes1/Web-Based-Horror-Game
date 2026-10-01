// Menu character stage: the real survivor models on a lit pedestal (idle mocap, drag to turn) plus
// portrait thumbnails rendered from the same models, so the menu shows exactly who you'll play.
import * as THREE from 'three';
import { CAST, loadCast, makeSurvivor } from '../entities/cast.js';
import { assets, loadGLTF } from '../core/assets.js';
import { clone as skeletonClone } from 'three/addons/utils/SkeletonUtils.js';

export class CharStage {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(28, 1, 0.1, 30);
    const s = this.scene;
    s.add(new THREE.HemisphereLight(0x6a7088, 0x1a0e0a, 0.55));
    const key = new THREE.SpotLight(0xffd2a8, 60, 12, 0.55, 0.7, 1.6);
    key.position.set(1.6, 3.2, 2.6); key.target.position.set(0, 0.9, 0);
    key.castShadow = true; key.shadow.mapSize.set(1024, 1024); key.shadow.bias = -0.0004;
    s.add(key, key.target);
    const rim = new THREE.DirectionalLight(0x8fb0ff, 1.6); rim.position.set(-2, 2.5, -3); s.add(rim);
    const fill = new THREE.PointLight(0xff5a3a, 1.2, 6, 2); fill.position.set(-1.6, 0.4, 1.5); s.add(fill);
    const floor = new THREE.Mesh(new THREE.CircleGeometry(1.1, 64), new THREE.MeshStandardMaterial({ color: 0x1a1414, roughness: 0.95 }));
    floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; s.add(floor);
    const ring = new THREE.Mesh(new THREE.RingGeometry(1.08, 1.12, 64), new THREE.MeshBasicMaterial({ color: 0x5a0a08 }));
    ring.rotation.x = -Math.PI / 2; ring.position.y = 0.002; s.add(ring);
    this.turn = 0.35; this.spin = 0; this.drag = null;
    canvas.addEventListener('pointerdown', (e) => { this.drag = { x: e.clientX, t: this.turn }; canvas.setPointerCapture(e.pointerId); });
    canvas.addEventListener('pointermove', (e) => { if (this.drag) this.turn = this.drag.t + (e.clientX - this.drag.x) * 0.012; });
    canvas.addEventListener('pointerup', () => { this.drag = null; });
    this.chars = {};
    this.current = null;
    this.alive = false;
    this.ready = false;
  }

  async load(onProgress) {
    await loadCast(CAST.map((_, i) => i));
    this.ready = true;
    onProgress?.();
  }

  show(index) {
    if (!this.ready) { this.pending = index; return; }
    if (this.current) this.scene.remove(this.current.root);
    const c = this.chars[index] || (this.chars[index] = makeSurvivor(index));
    this.current = c;
    c.root.position.set(0, 0, 0);
    this.scene.add(c.root);
    c.play('Idle', 0.01);
    c.update(0.01); c.resetPhysics();
    this.idleSwap = 6 + Math.random() * 4;
    this.frame(c);
  }

  frame(c) {
    const h = c.height;
    this.camera.position.set(0, h * 0.62, h * 2.05 + 0.6);
    this.camera.lookAt(0, h * 0.5, 0);
  }

  start() {
    if (this.alive) return;
    this.alive = true;
    let last = performance.now();
    const loop = (now) => {
      if (!this.alive) return;
      requestAnimationFrame(loop);
      if (document.hidden || !this.canvas.offsetParent) { last = now; return; }
      const dt = Math.min(0.05, (now - last) / 1000); last = now;
      this.resize();
      if (this.current) {
        if (!this.drag) this.turn += dt * 0.25;
        this.current.root.rotation.y = this.turn;

        this.current.update(dt);
      }
      this.renderer.render(this.scene, this.camera);
    };
    requestAnimationFrame(loop);
  }

  stop() { this.alive = false; }

  /** Free the GPU: a second WebGL context full of characters must not compete with the game. */
  dispose() {
    this.alive = false;
    this.scene.traverse((o) => { if (o.isMesh) { o.geometry?.dispose?.(); } });
    this.renderer.dispose();
    try { this.renderer.forceContextLoss(); } catch (_) { /* noop */ }
  }

  resize() {
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    if (!w || !h) return;
    const c = this.renderer.domElement;
    const pr = this.renderer.getPixelRatio();
    if (c.width !== Math.round(w * pr) || c.height !== Math.round(h * pr)) {
      this.renderer.setSize(w, h, false);
      this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
    }
  }

  /** Head-and-shoulders portrait of a survivor (real model, idle pose) as a data URL. */
  portrait(index, w = 180, h = 240) {
    const c = this.chars[index] || (this.chars[index] = makeSurvivor(index));
    const hadParent = c.root.parent;
    const prev = this.current;
    if (prev && prev !== c) this.scene.remove(prev.root);
    this.scene.add(c.root);
    c.root.rotation.y = 0.35;
    c.play('Idle', 0.01); c.update(0.5);
    const cam = new THREE.PerspectiveCamera(24, w / h, 0.1, 20);
    const H = c.height;
    cam.position.set(0.32, H * 0.88, 1.7); cam.lookAt(0, H * 0.83, 0);
    const size = this.renderer.getSize(new THREE.Vector2());
    const pr = this.renderer.getPixelRatio();
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(w, h, false);
    this.renderer.render(this.scene, cam);
    const url = this.renderer.domElement.toDataURL('image/webp', 0.85);
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(size.x || 1, size.y || 1, false);
    if (!hadParent || (prev && prev !== c)) this.scene.remove(c.root);
    if (prev && prev !== c) this.scene.add(prev.root);
    return url;
  }

  /** Portrait of a ghost model (uses the same stage lighting, colder tone). */
  async ghostPortrait(model, w = 240, h = 300) {
    const g = await loadGLTF(model);
    const root = skeletonClone(g.scene);
    root.traverse((o) => { if (o.isMesh) { o.frustumCulled = false; o.castShadow = true; } });
    const prev = this.current;
    if (prev) this.scene.remove(prev.root);
    this.scene.add(root);
    const mixer = new THREE.AnimationMixer(root);
    const clip = g.animations.find((a) => /Stare|Idle/.test(a.name));
    if (clip) { mixer.clipAction(clip).play(); mixer.update(0.8); }
    root.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(root);
    const H = box.max.y - box.min.y;
    const cam = new THREE.PerspectiveCamera(26, w / h, 0.1, 20);
    cam.position.set(0.25, H * 0.8, H * 0.75 + 0.6); cam.lookAt(0, H * 0.78, 0);
    const size = this.renderer.getSize(new THREE.Vector2()), pr = this.renderer.getPixelRatio();
    this.renderer.setPixelRatio(1); this.renderer.setSize(w, h, false);
    this.renderer.render(this.scene, cam);
    const url = this.renderer.domElement.toDataURL('image/webp', 0.85);
    this.renderer.setPixelRatio(pr); this.renderer.setSize(size.x || 1, size.y || 1, false);
    this.scene.remove(root);
    if (prev) this.scene.add(prev.root);
    return url;
  }
}

/** Studio photo of a prop node from a props GLB (items, furniture) - used by the field guide. */
CharStage.prototype.propPhoto = function propPhoto(glb, node, w = 360, h = 260, opts = {}) {
  const g = assets.gltf[glb];
  const src = g && g.scene.getObjectByName(node);
  if (!src) return null;
  const o = src.clone(true); o.position.set(0, 0, 0); o.rotation.set(0, opts.rotY ?? 0.6, 0);
  const prev = this.current; if (prev) this.scene.remove(prev.root);
  this.scene.add(o); o.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(o), size = box.getSize(new THREE.Vector3()), c = box.getCenter(new THREE.Vector3());
  const r = Math.max(size.x, size.y, size.z);
  const cam = new THREE.PerspectiveCamera(30, w / h, 0.01, 50);
  cam.position.set(c.x + r * 0.9, c.y + r * 0.55, c.z + r * 1.6); cam.lookAt(c);
  const sz = this.renderer.getSize(new THREE.Vector2()), pr = this.renderer.getPixelRatio();
  this.renderer.setPixelRatio(1); this.renderer.setSize(w, h, false);
  this.renderer.render(this.scene, cam);
  const url = this.renderer.domElement.toDataURL('image/webp', 0.85);
  this.renderer.setPixelRatio(pr); this.renderer.setSize(sz.x || 1, sz.y || 1, false);
  this.scene.remove(o); if (prev) this.scene.add(prev.root);
  return url;
};

export { assets };
