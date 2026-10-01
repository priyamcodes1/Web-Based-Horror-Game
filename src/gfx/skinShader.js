// Cheap subsurface-scattering look for skin on MeshStandard/PhysicalMaterial.
// Real skin lets red light travel further under the surface than green/blue, so the light terminator is soft
// and warm instead of a hard grey falloff. The diffuse N.L is wrapped per colour channel (red widest) and a
// faint back-scatter lights thin parts (ears, nose, fingers) from behind. Specular is untouched.
import { ShaderChunk } from 'three';

const LINE = 'reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseContribution ) * ( 1.0 - F );';
let patched = null;

function skinChunk() {
  if (patched !== null) return patched;
  const src = ShaderChunk.lights_physical_pars_fragment;
  if (!src.includes(LINE)) {
    console.warn('skinShader: diffuse line not found in this three.js version; SSS look disabled');
    patched = src;
    return patched;
  }
  patched = src.replace(LINE, `{
		float nl = dot( geometryNormal, directLight.direction );
		vec3 wrapped = clamp( ( vec3( nl ) + SKIN_WRAP ) / ( 1.0 + SKIN_WRAP ), 0.0, 1.0 );
		wrapped *= wrapped;
		float back = pow( saturate( dot( geometryViewDir, -directLight.direction ) ), 3.0 ) * SKIN_SCATTER;
		vec3 sss = directLight.color * ( wrapped + back * vec3( 1.0, 0.35, 0.25 ) );
		reflectedLight.directDiffuse += sss * BRDF_Lambert( material.diffuseContribution ) * ( 1.0 - F );
	}`);
  return patched;
}

export function applySkinShader(material, { wrap = [0.48, 0.2, 0.12], scatter = 0.12 } = {}) {
  material.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace('#include <lights_physical_pars_fragment>',
      `#define SKIN_WRAP vec3(${wrap.map((x) => x.toFixed(3)).join(', ')})\n#define SKIN_SCATTER ${scatter.toFixed(3)}\n${skinChunk()}`);
  };
  material.customProgramCacheKey = () => `skin-sss-${wrap.join('-')}-${scatter}`;
  material.needsUpdate = true;
  return material;
}
