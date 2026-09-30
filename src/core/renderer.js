// Renderer + post-processing chain.
// Scene -> (MSAA HDR target) -> bloom -> single "grade" pass (tone map, sRGB, grain, vignette, CA, fear FX) -> screen.
// Everything stays at native resolution: quality presets change pixel-ratio caps, MSAA and shadow size only.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { settings, quality } from './settings.js';

const GradeShader = {
  name: 'GradeShader',
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uRes: { value: new THREE.Vector2(1, 1) },
    uBrightness: { value: 1 },
    uVignette: { value: 0.35 },
    uGrain: { value: 0.05 },
    uCA: { value: 0.0 },          // chromatic aberration strength
    uFear: { value: 0.0 },        // 0..1 : desaturate, pulse, warp
    uDamage: { value: 0.0 },      // red flash
    uFade: { value: 0.0 },        // black fade
    uFlash: { value: 0.0 },       // white flash (lightning / camera)
    uDistort: { value: 0.0 },     // ghost proximity wave
    uTint: { value: new THREE.Color(1.0, 0.97, 0.94) },
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform float uTime, uBrightness, uVignette, uGrain, uCA, uFear, uDamage, uFade, uFlash, uDistort;
    uniform vec2 uRes;
    uniform vec3 uTint;
    varying vec2 vUv;
    float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
    void main() {
      vec2 uv = vUv;
      vec2 c = uv - 0.5;
      float r2 = dot(c, c);
      // ghost-proximity heat-haze warp (only when a ghost is close)
      if (uDistort > 0.001) {
        uv += vec2(sin(uv.y * 38.0 + uTime * 5.0), cos(uv.x * 31.0 - uTime * 4.0)) * 0.0022 * uDistort * (0.4 + r2 * 3.0);
      }
      vec4 col;
      float ca = uCA + uFear * 0.004 + r2 * 0.004 * uCA * 40.0;
      if (ca > 0.00005) {
        vec2 dir = c * ca;
        col.r = texture2D(tDiffuse, uv + dir).r;
        col.g = texture2D(tDiffuse, uv).g;
        col.b = texture2D(tDiffuse, uv - dir).b;
        col.a = 1.0;
      } else {
        col = texture2D(tDiffuse, uv);
      }
      col.rgb *= uBrightness;
      col.rgb *= uTint;
      col.rgb += uFlash;
      gl_FragColor = vec4(col.rgb, 1.0);
      // tone mapping + output transfer (renderer settings)
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
      // grade: lift shadows a hair toward cold blue, fear desaturates
      float l = dot(gl_FragColor.rgb, vec3(0.299, 0.587, 0.114));
      gl_FragColor.rgb = mix(gl_FragColor.rgb, vec3(l), clamp(uFear * 0.55, 0.0, 0.8));
      gl_FragColor.rgb += vec3(-0.004, 0.0, 0.008) * (1.0 - l);
      // vignette (breathes with fear)
      float vig = smoothstep(0.85, 0.18, r2 * (1.0 + uVignette * 1.4 + uFear * 0.8 * (0.8 + 0.2 * sin(uTime * 7.0))));
      gl_FragColor.rgb *= mix(1.0, vig, 0.9);
      // damage flash from the edges
      gl_FragColor.rgb = mix(gl_FragColor.rgb, vec3(0.45, 0.0, 0.0), uDamage * smoothstep(0.02, 0.35, r2));
      // film grain (animated, luminance-weighted so darks look filmic, not noisy)
      float g = hash(uv * uRes + fract(uTime * 17.0) * 100.0) - 0.5;
      gl_FragColor.rgb += g * uGrain * (1.1 - l);
      gl_FragColor.rgb *= 1.0 - uFade;
      gl_FragColor.a = 1.0;
    }`,
};

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    const ctxAttrs = { antialias: false, alpha: false, depth: true, stencil: false, powerPreference: 'high-performance', desynchronized: true, preserveDrawingBuffer: false };
    this.r = new THREE.WebGLRenderer({ canvas, ...ctxAttrs });
    this.r.outputColorSpace = THREE.SRGBColorSpace;
    this.r.toneMapping = THREE.ACESFilmicToneMapping;
    this.r.toneMappingExposure = 1.0;
    this.r.shadowMap.enabled = true;
    this.r.shadowMap.type = THREE.PCFShadowMap;
    this.r.shadowMap.autoUpdate = true;
    this.r.info.autoReset = false;   // reset once per frame so the FPS readout shows the whole frame
    this.composer = null;
    this.scene = null;
    this.camera = null;
    this.grade = null;
    this.bloom = null;
    this.gpu = this._gpuName();
    addEventListener('resize', () => this.resize());
  }

  _gpuName() {
    try {
      const gl = this.r.getContext();
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      const n = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
      return String(n).replace(/ANGLE \((.*)\)/, '$1').split(',').slice(0, 2).join(' ').slice(0, 60);
    } catch (_) { return 'WebGL2'; }
  }

  setup(scene, camera) {
    this.scene = scene; this.camera = camera;
    this.applyQuality();
  }

  applyQuality() {
    const q = quality();
    const pr = Math.min(devicePixelRatio || 1, q.pixelRatioCap);
    this.r.setPixelRatio(pr);
    this.r.setSize(innerWidth, innerHeight, false);
    if (this.composer) { this.composer.renderTarget1.dispose(); this.composer.renderTarget2.dispose(); }
    if (!this.scene) return;
    const w = Math.floor(innerWidth * pr), h = Math.floor(innerHeight * pr);
    const rt = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, samples: q.msaa, depthBuffer: true, stencilBuffer: false });
    this.composer = new EffectComposer(this.r, rt);
    this.composer.setPixelRatio(1);
    this.composer.setSize(w, h);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = null;
    if (q.bloom) {
      this.bloom = new UnrealBloomPass(new THREE.Vector2(w / 2, h / 2), 0.55, 0.6, 0.82);
      this.composer.addPass(this.bloom);
    }
    const prevU = this.grade ? this.grade.uniforms : null;
    this.grade = new ShaderPass(GradeShader);
    this.grade.material.toneMapped = true;
    if (prevU) for (const k of Object.keys(prevU)) if (k !== 'tDiffuse' && k !== 'uRes') this.grade.uniforms[k].value = prevU[k].value;
    this.grade.uniforms.uRes.value.set(w, h);
    this.grade.uniforms.uGrain.value = q.grain ? 0.055 : 0.0;
    this.composer.addPass(this.grade);
    this.r.shadowMap.needsUpdate = true;
  }

  resize() {
    if (!this.camera) { this.r.setSize(innerWidth, innerHeight, false); return; }
    this.camera.aspect = innerWidth / innerHeight;
    this.camera.updateProjectionMatrix();
    const pr = Math.min(devicePixelRatio || 1, quality().pixelRatioCap);
    this.r.setPixelRatio(pr);
    this.r.setSize(innerWidth, innerHeight, false);
    if (this.composer) {
      const w = Math.floor(innerWidth * pr), h = Math.floor(innerHeight * pr);
      this.composer.setSize(w, h);
      this.grade.uniforms.uRes.value.set(w, h);
    }
  }

  get u() { return this.grade ? this.grade.uniforms : GradeShader.uniforms; }

  render(dt, scene, camera) {
    if (scene && scene !== this.scene) this.setScene(scene, camera);
    if (camera && camera !== this.camera) this.setScene(this.scene, camera);
    const u = this.u;
    u.uTime.value += dt;
    u.uBrightness.value = settings.brightness;
    this.r.info.reset();
    if (this.composer) this.composer.render(dt);
    else this.r.render(this.scene, this.camera);
  }

  setScene(scene, camera) {
    this.scene = scene; this.camera = camera;
    if (this.composer) {
      const rp = this.composer.passes[0];
      rp.scene = scene; rp.camera = camera;
    }
  }

  /** Compile all shaders for a scene up-front (avoids hitches the first time something comes into view). */
  async precompile(scene, camera) {
    try {
      if (this.r.compileAsync) await this.r.compileAsync(scene, camera);
      else this.r.compile(scene, camera);
    } catch (_) { /* best effort */ }
  }
}
