import * as THREE from "three";

// The sun and the air between you and the mountains, shared by every shader that
// draws the world (toonshading.js, watershader.js, the sky and clouds in
// environment.js), so the haze on the ground meets the sky at the horizon.

// Toward the sun: low in the west-north-west, so it shows over the mountains and
// rakes the hills with longer shadow sides.
export const SUN_DIRECTION = new THREE.Vector3(-0.83, 0.42, 0.37).normalize();

export const atmosphereUniforms = {
  atmoSunDir: { value: SUN_DIRECTION },
  atmoHazeColor: { value: new THREE.Color("#d3ebf2") }, // also the sky at the horizon
  atmoSunHaze: { value: new THREE.Color("#ffe2b0") }, // warmer haze looking toward the sun
  atmoNear: { value: 40 }, // haze starts this far from the camera...
  atmoFar: { value: 240 }, // ...and is full this far
  atmoStrength: { value: 0.75 }, // full haze is this opaque
  atmoBase: { value: 2 }, // thickest below this height...
  atmoTop: { value: 60 }, // ...thinning up to this height
  atmoTopKeep: { value: 0.55 }, // how much haze is left above atmoTop
};

// GLSL: atmosphere(color, worldPos) mixes a linear colour toward the haze. Call it
// before <colorspace_fragment>. Needs `cameraPosition` (three provides it).
export const atmosphereGlsl = /* glsl */ `
  uniform vec3 atmoSunDir;
  uniform vec3 atmoHazeColor;
  uniform vec3 atmoSunHaze;
  uniform float atmoNear;
  uniform float atmoFar;
  uniform float atmoStrength;
  uniform float atmoBase;
  uniform float atmoTop;
  uniform float atmoTopKeep;

  vec3 hazeColorToward(vec3 viewDir) {
    float toSun = pow(max(dot(viewDir, atmoSunDir), 0.0), 6.0);
    return mix(atmoHazeColor, atmoSunHaze, toSun * 0.6);
  }

  vec3 atmosphere(vec3 color, vec3 worldPos) {
    vec3 toPoint = worldPos - cameraPosition;
    float dist = length(toPoint);
    float haze = smoothstep(atmoNear, atmoFar, dist) * atmoStrength;
    haze *= mix(1.0, atmoTopKeep, smoothstep(atmoBase, atmoTop, worldPos.y));
    return mix(color, hazeColorToward(toPoint / max(dist, 1e-4)), haze);
  }
`;
