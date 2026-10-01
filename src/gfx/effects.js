// Custom shaders: rainy window glass, volumetric flashlight cone, flashlight-lit dust, ghost rim/dissolve.
import * as THREE from 'three';

// ---------------------------------------------------------------------------- rain on glass
export function makeRainGlassMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uFlash: { value: 0 }, uRain: { value: 1 } },
    vertexShader: /* glsl */`
      varying vec2 vUv; varying vec3 vWorld;
      void main() {
        vUv = uv;
        vec4 w = modelMatrix * vec4(position, 1.0);
        vWorld = w.xyz;
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */`
      uniform float uTime; uniform float uFlash; uniform float uRain;
      varying vec2 vUv; varying vec3 vWorld;
      #define S(a,b,t) smoothstep(a,b,t)
      vec3 N13(float p){ vec3 p3 = fract(vec3(p)*vec3(.1031,.11369,.13787)); p3 += dot(p3, p3.yzx+19.19);
        return fract(vec3((p3.x+p3.y)*p3.z,(p3.x+p3.z)*p3.y,(p3.y+p3.z)*p3.x)); }
      float N(float t){ return fract(sin(t*12345.564)*7658.76); }
      vec2 DropLayer(vec2 uv, float t){
        vec2 UV = uv; uv.y += t*0.75;
        vec2 a = vec2(6.,1.); vec2 grid = a*2.;
        vec2 id = floor(uv*grid);
        uv.y += N(id.x);
        id = floor(uv*grid);
        vec3 n = N13(id.x*35.2+id.y*2376.1);
        vec2 st = fract(uv*grid)-vec2(.5,0.);
        float x = n.x-.5;
        float y = UV.y*20.;
        float wig = sin(y+sin(y));
        x += wig*(.5-abs(x))*(n.z-.5); x *= .7;
        float ti = fract(t+n.z);
        y = (S(0.,.85,ti)*S(1.,.85,ti)-.5)*.9+.5;
        vec2 p = vec2(x,y);
        float d = length((st-p)*a.yx);
        float mainDrop = S(.4,.0,d);
        float r = sqrt(S(1.,y,st.y));
        float cd = abs(st.x-x);
        float trail = S(.23*r,.15*r*r,cd);
        float front = S(-.02,.02,st.y-y);
        trail *= front*r*r;
        y = fract(UV.y*10.)+(st.y-.5);
        float dd = length(st-vec2(x,y));
        float droplets = S(.3,0.,dd);
        return vec2(mainDrop+droplets*r*front, trail);
      }
      float StaticDrops(vec2 uv, float t){
        uv *= 40.;
        vec2 id = floor(uv); uv = fract(uv)-.5;
        vec3 n = N13(id.x*107.45+id.y*3543.654);
        vec2 p = (n.xy-.5)*.7;
        float d = length(uv-p);
        float fade = S(0.,.025,fract(t+n.z))*S(1.,.025,fract(t+n.z));
        return S(.3,0.,d)*fract(n.z*10.)*fade;
      }
      vec2 Drops(vec2 uv, float t){
        float s = StaticDrops(uv,t);
        vec2 m1 = DropLayer(uv,t);
        vec2 m2 = DropLayer(uv*1.85,t);
        float c = S(.3,1.,s+m1.x+m2.x);
        return vec2(c, max(m1.y, m2.y));
      }
      vec3 outside(vec2 uv, float blur, float seed){
        vec3 sky = mix(vec3(.018,.022,.03), vec3(.05,.06,.08), uv.y);
        float h = .30 + .07*sin(uv.x*7.+seed) + .045*sin(uv.x*19.+seed*2.3) + .025*sin(uv.x*47.+seed);
        float w = .012 + blur*.06;
        float trees = S(h+w, h-w, uv.y);
        vec3 col = mix(sky, vec3(.004,.005,.007), trees);
        vec2 lp = vec2(fract(seed*.37)*.8+.1, h-.03);
        col += vec3(1.,.62,.3) * .0022/(pow(length((uv-lp)*vec2(1.,1.6)),1.6)+.002+blur*.02) * (1.-trees*.2);
        col += uFlash * vec3(.55,.6,.75) * (1. - trees*.85);
        return col;
      }
      void main(){
        // glTF UVs have v pointing down (flipY = false); work in v-up so drops run down the glass
        vec2 wuv = vec2(vUv.x, 1. - vUv.y);
        float seed = dot(floor(vWorld.xz*0.5), vec2(12.9898, 78.233));
        vec2 uv = wuv * vec2(1.4, 2.0) + vec2(fract(seed*.1), 0.);
        float t = uTime*.18 + fract(seed)*10.;
        vec2 c = Drops(uv, t);
        vec2 e = vec2(.001, 0.);
        float cx = Drops(uv+e, t).x, cy = Drops(uv+e.yx, t).x;
        vec2 n = vec2(cx-c.x, cy-c.x);
        float fog = .55 * (1. - c.y) * (1. - S(0.,.2,c.x));
        float blur = clamp(fog*2. + .15, 0., 1.);
        vec3 col = outside(wuv + n*6., blur*(1.-c.x), seed);
        // condensation haze + slight reflection of the warm room
        col = mix(col, vec3(.06,.055,.05) + uFlash*.15, fog*.55);
        col += vec3(.7,.75,.8) * pow(max(0., n.x*14. + n.y*10.), 2.) * .25;
        gl_FragColor = vec4(col, 1.);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
}

// ---------------------------------------------------------------------------- volumetric flashlight cone
export function makeFlashlightCone(length = 11, radius = 3.2) {
  const geo = new THREE.CylinderGeometry(0.035, radius, length, 40, 12, true);
  geo.translate(0, -length / 2, 0);          // narrow apex at origin, wide end at y = -length
  geo.rotateX(Math.PI / 2);                  // -> wide end at z = -length (camera forward)
  const mat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uIntensity: { value: 1 }, uLength: { value: length }, uColor: { value: new THREE.Color(0xfff1d6) } },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    vertexShader: /* glsl */`
      varying float vDist; varying vec3 vN; varying vec3 vView; varying vec3 vLocal;
      void main(){
        vLocal = position;
        vDist = -position.z;
        vec4 mv = modelViewMatrix * vec4(position, 1.);
        vN = normalize(normalMatrix * normal);
        vView = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */`
      uniform float uTime; uniform float uIntensity; uniform float uLength; uniform vec3 uColor;
      varying float vDist; varying vec3 vN; varying vec3 vView; varying vec3 vLocal;
      float hash(vec3 p){ return fract(sin(dot(p, vec3(12.9898,78.233,37.719)))*43758.5453); }
      float noise(vec3 p){ vec3 i = floor(p); vec3 f = fract(p); f = f*f*(3.-2.*f);
        return mix(mix(mix(hash(i),hash(i+vec3(1,0,0)),f.x),mix(hash(i+vec3(0,1,0)),hash(i+vec3(1,1,0)),f.x),f.y),
                   mix(mix(hash(i+vec3(0,0,1)),hash(i+vec3(1,0,1)),f.x),mix(hash(i+vec3(0,1,1)),hash(i+vec3(1,1,1)),f.x),f.y),f.z); }
      void main(){
        float along = clamp(vDist / uLength, 0., 1.);
        float edge = pow(abs(dot(vN, vView)), 2.5);
        float fall = pow(1. - along, 2.2) * smoothstep(.04, .22, along);
        float dust = .65 + .35 * noise(vLocal*2.2 + vec3(0., uTime*.25, uTime*.1));
        float a = edge * fall * dust * .016 * uIntensity;
        gl_FragColor = vec4(uColor * a, a);
      }`,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 10;
  return mesh;
}

// ---------------------------------------------------------------------------- dust motes lit by the flashlight
export function makeDust(count) {
  const g = new THREE.BufferGeometry();
  const p = new Float32Array(count * 3), s = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    p[i * 3] = (Math.random() - 0.5) * 10; p[i * 3 + 1] = (Math.random() - 0.5) * 4; p[i * 3 + 2] = (Math.random() - 0.5) * 10;
    s[i] = Math.random();
  }
  g.setAttribute('position', new THREE.BufferAttribute(p, 3));
  g.setAttribute('seed', new THREE.BufferAttribute(s, 1));
  const m = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uCenter: { value: new THREE.Vector3() }, uLightPos: { value: new THREE.Vector3() },
      uLightDir: { value: new THREE.Vector3(0, 0, -1) }, uOn: { value: 1 }, uPx: { value: 1 } },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */`
      uniform float uTime; uniform vec3 uCenter; uniform vec3 uLightPos; uniform vec3 uLightDir; uniform float uOn; uniform float uPx;
      attribute float seed; varying float vA;
      void main(){
        vec3 p = position;
        p += vec3(sin(uTime*.2+seed*40.), sin(uTime*.13+seed*17.)*.6, cos(uTime*.17+seed*23.)) * .35;
        p = uCenter + mod(p - uCenter + 5., 10.) - 5.;
        p.y = uCenter.y + mod(position.y + uTime*.03*(seed-.5) + 2., 4.) - 2.;
        vec3 d = p - uLightPos;
        float dist = length(d);
        float cone = smoothstep(.86, .97, dot(normalize(d), uLightDir));
        vA = cone * uOn * smoothstep(9., 1., dist) * (.35 + .65*seed);
        vec4 mv = modelViewMatrix * vec4(p, 1.);
        vA *= smoothstep(.6, 1.6, -mv.z);
        gl_PointSize = min(uPx * (1.2 + seed*1.8) * (3. / -mv.z), 9.);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */`
      varying float vA;
      void main(){
        vec2 c = gl_PointCoord - .5;
        float a = smoothstep(.5, 0., length(c)) * vA;
        if (a < .01) discard;
        gl_FragColor = vec4(vec3(1., .95, .85) * a, a);
      }`,
  });
  const pts = new THREE.Points(g, m);
  pts.frustumCulled = false;
  return pts;
}

// ---------------------------------------------------------------------------- ghost material mods
/** Adds a spectral fresnel rim + noise dissolve to a (skinned) standard material. Returns shared uniforms. */
export function ghostify(material, uniforms) {
  material.transparent = material.transparent || false;
  material.onBeforeCompile = (sh) => {
    sh.uniforms.uDissolve = uniforms.uDissolve;
    sh.uniforms.uRim = uniforms.uRim;
    sh.uniforms.uRimColor = uniforms.uRimColor;
    sh.uniforms.uGTime = uniforms.uGTime;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vGPos;\nvarying vec3 vGN;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvGPos = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvGN = normalize(mat3(modelMatrix) * objectNormal);');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vGPos; varying vec3 vGN;
        uniform float uDissolve; uniform float uRim; uniform vec3 uRimColor; uniform float uGTime;
        float gh(vec3 p){ return fract(sin(dot(p, vec3(12.9898,78.233,37.719)))*43758.5453); }
        float gn(vec3 p){ vec3 i=floor(p); vec3 f=fract(p); f=f*f*(3.-2.*f);
          return mix(mix(mix(gh(i),gh(i+vec3(1,0,0)),f.x),mix(gh(i+vec3(0,1,0)),gh(i+vec3(1,1,0)),f.x),f.y),
                     mix(mix(gh(i+vec3(0,0,1)),gh(i+vec3(1,0,1)),f.x),mix(gh(i+vec3(0,1,1)),gh(i+vec3(1,1,1)),f.x),f.y),f.z); }`)
      .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
        float gnz = gn(vGPos*7.0 + vec3(0., uGTime*.6, 0.)) * .7 + gn(vGPos*23.0) * .3;
        if (gnz < uDissolve) discard;`)
      .replace('#include <dithering_fragment>', `#include <dithering_fragment>
        vec3 vdir = normalize(cameraPosition - vGPos);
        float fr = pow(1. - abs(dot(normalize(vGN), vdir)), 2.5);
        gl_FragColor.rgb += uRimColor * fr * uRim;
        float edge = smoothstep(uDissolve + .08, uDissolve, gnz) * step(.001, uDissolve);
        gl_FragColor.rgb += uRimColor * edge * 3.;`);
  };
  material.customProgramCacheKey = () => 'ghostify';
  material.needsUpdate = true;
  return material;
}

export function makeGhostUniforms(color = 0x8fb4d8) {
  return { uDissolve: { value: 0 }, uRim: { value: 0.35 }, uRimColor: { value: new THREE.Color(color) }, uGTime: { value: 0 } };
}
