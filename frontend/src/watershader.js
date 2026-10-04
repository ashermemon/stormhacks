// water.js
// Stylized toon water for World.glb: flat blues, lighter patches, white streaks that
// follow the stream (and slowly swirl in the pond), plus a wobbly white foam rim at the shore.
//
//   import { applyToonWater, updateWater, waterUniforms } from './water.js';
//
//   const world = (await loader.loadAsync('modelsUnshared/World.glb')).scene;
//   applyToonWater(world);     // before toonifyScene(world) is fine too; water is tagged toon:false
//   scene.add(world);
//
//   // in your render loop:
//   updateWater(clock.getElapsedTime());
//
// The water mesh in World.glb carries baked per-vertex data in its vertex colours:
//   R = depth below the surface, G/B = flow direction, A = flow speed.

import * as THREE from "three";

// Tweak these at runtime, every water mesh updates.
export const waterUniforms = {
  time: { value: 0 },
  deepColor: { value: new THREE.Color("#1f80e6") },
  lightColor: { value: new THREE.Color("#78b4e8") },
  foamColor: { value: new THREE.Color("#ffffff") },
  opacity: { value: 0.85 }, // < 1 so the otter is visible when diving; 1 = fully opaque like the reference
  deepShade: { value: new THREE.Color("#14559e") }, // colour the water darkens to over deep spots
  depthRange: { value: 20.0 }, // set automatically from the map's userData.depthRange
  patternScale: { value: 0.22 }, // smaller = bigger patches and streaks
  flowSpeed: { value: 0.6 }, // how fast the pattern travels downstream
  foamWidth: { value: 0.22 }, // shoreline foam, in units of water depth
  streakAmount: { value: 0.55 }, // higher = fewer white streaks (0..1)
  patchAmount: { value: 0.05 }, // higher = fewer light-blue patches (-1..1)
};

export function updateWater(elapsedSeconds) {
  waterUniforms.time.value = elapsedSeconds;
}

const vert = /* glsl */ `
  attribute vec4 waterData;
  uniform float depthRange;
  varying vec2 vWorld;
  varying float vDepth;
  varying vec2 vFlow;
  varying float vSpeed;
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorld = wp.xz;
    vDepth = waterData.r * depthRange - 0.5;
    vec2 f = waterData.gb * 2.0 - 1.0;
    vFlow = vec2(f.x, -f.y);          // Blender (x, y) -> three.js (x, -z)
    vSpeed = waterData.a;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

const frag = /* glsl */ `
  uniform float time;
  uniform vec3 deepColor;
  uniform vec3 lightColor;
  uniform vec3 foamColor;
  uniform vec3 deepShade;
  uniform float opacity;
  uniform float patternScale;
  uniform float flowSpeed;
  uniform float foamWidth;
  uniform float streakAmount;
  uniform float patchAmount;
  varying vec2 vWorld;
  varying float vDepth;
  varying vec2 vFlow;
  varying float vSpeed;

  // 2D simplex noise (Ashima Arts / Stefan Gustavson, MIT)
  vec3 permute(vec3 x) { return mod(((x * 34.0) + 1.0) * x, 289.0); }
  float snoise(vec2 v) {
    const vec4 C = vec4(0.211324865405187, 0.366025403784439, -0.577350269189626, 0.024390243902439);
    vec2 i = floor(v + dot(v, C.yy));
    vec2 x0 = v - i + dot(i, C.xx);
    vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
    vec4 x12 = x0.xyxy + C.xxzz;
    x12.xy -= i1;
    i = mod(i, 289.0);
    vec3 p = permute(permute(i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0));
    vec3 m = max(0.5 - vec3(dot(x0, x0), dot(x12.xy, x12.xy), dot(x12.zw, x12.zw)), 0.0);
    m = m * m; m = m * m;
    vec3 x = 2.0 * fract(p * C.www) - 1.0;
    vec3 h = abs(x) - 0.5;
    vec3 ox = floor(x + 0.5);
    vec3 a0 = x - ox;
    m *= 1.79284291400159 - 0.85373472095314 * (a0 * a0 + h * h);
    vec3 g;
    g.x = a0.x * x0.x + h.x * x0.y;
    g.yz = a0.yz * x12.xz + h.yz * x12.yw;
    return 130.0 * dot(m, g);
  }

  // hard toon edge with a pixel of anti-aliasing
  float aastep(float threshold, float value) {
    float w = fwidth(value) * 0.75;
    return smoothstep(threshold - w, threshold + w, value);
  }

  // noise stretched along the flow so it reads as streaks
  float streaks(vec2 p, vec2 dir) {
    vec2 perp = vec2(-dir.y, dir.x);
    vec2 q = vec2(dot(p, dir) * 0.45, dot(p, perp) * 1.6);
    return snoise(q) * 0.65 + snoise(q * 2.3 + 4.1) * 0.35;
  }

  void main() {
    vec2 dir = vFlow;
    float len = length(dir);
    dir = len > 1e-3 ? dir / len : vec2(1.0, 0.0);

    // flow-map trick: two copies of the pattern drift downstream and cross-fade,
    // so the motion never stretches out over time
    float t = time * flowSpeed;
    float p0 = fract(t * 0.25);
    float p1 = fract(t * 0.25 + 0.5);
    float w0 = 1.0 - abs(1.0 - 2.0 * p0);
    vec2 uv = vWorld * patternScale;
    vec2 drift = dir * vSpeed * 2.0;
    float n = streaks(uv - drift * p0, dir) * w0
            + streaks(uv - drift * p1 + 13.7, dir) * (1.0 - w0);

    // base blue darkens in soft steps over deep water (pools, pond, channels)
    float deepness = smoothstep(2.0, 10.0, vDepth);
    vec3 col = mix(deepColor, deepShade, floor(deepness * 3.0 + 0.5) / 3.0);
    col = mix(col, lightColor, aastep(patchAmount + 0.25 * deepness, n));   // fewer light patches over deep water
    col = mix(col, foamColor,  aastep(streakAmount, n));      // white streaks

    // shoreline: light band, then a wobbly white foam rim where the water gets shallow
    float wob = snoise(vWorld * 1.3 + time * 0.3) * 0.08;
    col = mix(col, lightColor, 1.0 - aastep(foamWidth * 2.2 + wob, vDepth));
    col = mix(col, foamColor,  1.0 - aastep(foamWidth + wob, vDepth));

    gl_FragColor = vec4(col, opacity);
    #include <colorspace_fragment>
  }
`;

export const waterMaterial = new THREE.ShaderMaterial({
  uniforms: waterUniforms,
  vertexShader: vert,
  fragmentShader: frag,
  transparent: true,
  depthWrite: false, // so things under the surface (a diving otter) still draw
  side: THREE.DoubleSide, // visible from underneath too
  toneMapped: false,
});

export function applyToonWater(root) {
  root.traverse((o) => {
    if (!o.isMesh || !o.userData.water) return;
    const g = o.geometry;
    if (!g.attributes.waterData && g.attributes.color)
      g.setAttribute("waterData", g.attributes.color);
    if (o.userData.depthRange)
      waterUniforms.depthRange.value = o.userData.depthRange;
    o.material = waterMaterial;
    o.renderOrder = 1; // draw after opaque things
    o.userData._toonified = true;
  });
  return root;
}
