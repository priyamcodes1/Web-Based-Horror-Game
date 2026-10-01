// Renderer + post-processing chain. Quality presets only change internal cost settings
// (MSAA samples, shadow resolution, bloom); the image is always rendered at native resolution on High/Max.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { quality, settings } from '../core/settings.js';

const HorrorShader = {
  uniforms: {
    tDiffuse: { value: null }, uTime: { value: 0 }, uGrain: { value: 0.06 }, uVignette: { value: 1.0 },
    uCA: { value: 0.0 }, uDamage: { value: 0 }, uFear: { value: 0 }, uBright: { value: 1 }, uDistort: { value: 0 },
    uFade: { value: 0 }, uFlash: { value: 0 }, uRes: { value: new THREE.Vector2(1, 1) }, uDesat: { value: 0.12 },
  },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }`,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse; uniform float uTime, uGrain, uVignette, uCA, uDamage, uFear, uBright, uDistort, uFade, uFlash, uDesat;
    uniform vec2 uRes; varying vec2 vUv;
    float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233)) + uTime*7.13) * 43758.5453); }
    void main(){
      vec2 uv = vUv;
      vec2 c = uv - .5;
      // sanity distortion: slow warping waves
      uv += vec2(sin(uv.y*18. + uTime*1.7), cos(uv.x*14. + uTime*1.3)) * .0035 * uDistort;
      float ca = (uCA + uFear*.6 + uDamage*1.2) * .004;
      vec3 col;
      col.r = texture2D(tDiffuse, uv + c*ca).r;
      col.g = texture2D(tDiffuse, uv).g;
      col.b = texture2D(tDiffuse, uv - c*ca).b;
      // grading: lift blacks slightly toward teal, crush toward warm highlights
      float l = dot(col, vec3(.299,.587,.114));
      col = mix(col, vec3(l), uDesat + uFear*.2);
      col = pow(max(col, 0.), vec3(1. / uBright));
      col *= mix(vec3(.95,1.,1.05), vec3(1.05,1.,.93), smoothstep(.0,.5,l));
      // vignette (tightens with fear)
      float v = smoothstep(.95, .25 - uFear*.12, length(c * vec2(1., .85)) * (uVignette + uFear*.4));
      col *= mix(.35, 1., v);
      // damage: red pulse from the edges
      col = mix(col, vec3(.45,0.,0.) * (.6 + .4*sin(uTime*9.)), clamp(uDamage * (1.-v) * 1.4, 0., .85));
      // film grain
      col += (h(uv*uRes) - .5) * uGrain;
      col += uFlash * .16 * vec3(.8, .88, 1.) * (.4 + l);
      col *= 1. - uFade;
      gl_FragColor = vec4(col, 1.);
    }`,
};

export class Gfx {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false, depth: true });
    const r = this.renderer;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.05;
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFShadowMap;
    r.info.autoReset = true;
    this.fx = { ...HorrorShader.uniforms };
    this.setup();
    addEventListener('resize', () => this.resize());
  }

  get gpuName() {
    try {
      const gl = this.renderer.getContext();
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL).replace(/ANGLE \(|\)|Direct3D.*|vs_.*/g, '').trim() : 'WebGL2';
    } catch (_) { return 'WebGL2'; }
  }

  setup() {
    const q = quality();
    this.pixelRatio = Math.min(devicePixelRatio || 1, q.pixelRatioCap);
    this.renderer.setPixelRatio(this.pixelRatio);
    this.renderer.setSize(innerWidth, innerHeight, false);
    const w = Math.floor(innerWidth * this.pixelRatio), h = Math.floor(innerHeight * this.pixelRatio);
    const rt = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, samples: q.msaa });
    if (this.composer) this.composer.dispose();
    this.composer = new EffectComposer(this.renderer, rt);
    this.renderPass = new RenderPass(null, null);
    this.composer.addPass(this.renderPass);
    if (q.bloom) {
      // only genuinely hot pixels (flames, bulb filaments) bloom, and only a little
      this.bloom = new UnrealBloomPass(new THREE.Vector2(w, h), 0.22, 0.35, 2.2);
      this.composer.addPass(this.bloom);
    } else this.bloom = null;
    this.composer.addPass(new OutputPass());
    this.post = new ShaderPass(HorrorShader);
    this.post.uniforms = this.fx;
    this.post.material.uniforms = this.fx;
    this.composer.addPass(this.post);
    this.fx.uRes.value.set(w, h);
    this.fx.uGrain.value = q.grain ? 0.055 : 0.0;
  }

  resize() {
    this.renderer.setSize(innerWidth, innerHeight, false);
    const w = Math.floor(innerWidth * this.pixelRatio), h = Math.floor(innerHeight * this.pixelRatio);
    this.composer.setSize(innerWidth, innerHeight);
    this.fx.uRes.value.set(w, h);
    if (this.camera) { this.camera.aspect = innerWidth / innerHeight; this.camera.updateProjectionMatrix(); }
  }

  render(scene, camera, dt) {
    this.camera = camera;
    this.renderPass.scene = scene;
    this.renderPass.camera = camera;
    this.fx.uTime.value += dt;
    this.fx.uBright.value = settings.brightness;
    this.composer.render(dt);
  }
}
