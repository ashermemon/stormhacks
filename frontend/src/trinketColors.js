// trinketColors.js
// Recolourable trinkets from Trinkets.glb (Clam, Urchin, Snail, Crab, FishRound, FishClassic, FishAngel).
// Each body stores *shade levels* (dark / base / light / lightest) instead of colours, so every stripe,
// rib, spot and shadow is derived from the one colour you pass in. Eyes, blush and the clam's pearl stay fixed.
//
//   import { makeTrinket, setTrinketColor } from './trinketColors.js';
//   const gltf = await loader.loadAsync('Trinkets.glb');
//   const crab = makeTrinket(gltf.scene, 'Crab', '#ff7a59');   // clone + toon style + colour
//   scene.add(crab);
//   setTrinketColor(crab, '#5fb3ff');                           // recolour any time
//
// Names: 'Clam', 'Urchin', 'Snail', 'Crab', 'FishRound', 'FishClassic', 'FishAngel'.
// Origin = centre of the trinket (good for the otter's 'trinket' socket);
// trinket.userData.radius = half its largest size (lift it by that to rest it on the floor).

import * as THREE from 'three';
import { toonifyScene } from './toonshading.js';

const vert = /* glsl */ `
  #include <common>
  #include <color_pars_vertex>
  varying vec3 vNormalW;
  void main() {
    #include <color_vertex>
    vNormalW = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
const frag = /* glsl */ `
  uniform vec3 tint;
  uniform vec3 lightDir;
  uniform vec3 shadowTint;
  uniform float threshold, softness;
  #include <color_pars_fragment>
  varying vec3 vNormalW;
  void main() {
    float s = floor(vColor.r * 4.0 + 0.5) / 4.0;            // crisp bands between shade levels
    vec3 dark  = tint * (0.45 + 0.25 * tint);                // deeper, a bit more saturated
    vec3 light = mix(tint, vec3(1.0), 0.45);
    vec3 pale  = mix(tint, vec3(1.0), 0.75);
    vec3 base = s < 0.5 ? mix(dark, tint, s * 2.0)
              : (s < 0.875 ? mix(tint, light, (s - 0.5) * 4.0) : pale);
    vec3 n = normalize(vNormalW);
    if (!gl_FrontFacing) n = -n;
    float lit = smoothstep(threshold - softness, threshold + softness, dot(n, lightDir));
    gl_FragColor = vec4(mix(base * shadowTint, base, lit), 1.0);
    #include <colorspace_fragment>
  }
`;

function tintMaterial(toonMat, color) {
  const u = (toonMat && toonMat.uniforms) || {};
  const m = new THREE.ShaderMaterial({
    uniforms: {
      tint: { value: new THREE.Color(color) },
      lightDir:   u.lightDir   || { value: new THREE.Vector3(0.5, 1, 0.8).normalize() },
      shadowTint: u.shadowTint || { value: new THREE.Color(0.78, 0.66, 0.62) },
      threshold:  u.threshold  || { value: -0.1 },
      softness:   u.softness   || { value: 0.02 },
    },
    vertexShader: vert, fragmentShader: frag, vertexColors: true, toneMapped: false,
  });
  m.userData.trinketTint = true;
  return m;
}

export function makeTrinket(trinketsScene, name, color = '#ff9f43') {
  const src = trinketsScene.getObjectByName('Trinket_' + name);
  if (!src) throw new Error(`No trinket named "${name}"`);
  const t = src.clone(true);
  t.position.set(0, 0, 0);
  t.traverse((o) => { if (o.isMesh) o.material = o.material.clone(); });
  toonifyScene(t);                                           // outlines + toon look on everything
  t.traverse((o) => {
    if (!o.isMesh) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    if (!(mats[0].name || '').startsWith('Trinket_Tint')) return;
    const tm = tintMaterial(mats[0], color);
    if (Array.isArray(o.material)) { const a = o.material.slice(); a[0] = tm; o.material = a; } else o.material = tm;
  });
  return t;
}

export function setTrinketColor(trinket, color) {
  trinket.traverse((o) => {
    if (!o.isMesh) return;
    for (const m of (Array.isArray(o.material) ? o.material : [o.material]))
      if (m.userData.trinketTint) m.uniforms.tint.value.set(color);
  });
}
