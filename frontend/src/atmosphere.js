import * as THREE from "three";

// The sun and the air between you and the mountains, shared by every shader that
// draws the world (toonshading.js, watershader.js, the sky and clouds in
// environment.js), so the haze on the ground meets the sky at the horizon.

// Toward the sun. daycycle.js moves it (and every value below marked "cycle") each
// frame; these starting values are a mid-afternoon sun.
export const SUN_DIRECTION = new THREE.Vector3(-0.83, 0.33, 0.37).normalize();

export const atmosphereUniforms = {
  atmoSunDir: { value: SUN_DIRECTION },
  atmoLightDir: { value: new THREE.Vector3(0, 1, 0) }, // cycle: the toon light (sun or moon)
  atmoHazeColor: { value: new THREE.Color("#d3ebf2") }, // cycle; also the sky at the horizon
  atmoSunHaze: { value: new THREE.Color("#ffc994") }, // cycle: haze looking toward the sun
  atmoSceneTint: { value: new THREE.Color(1, 1, 1) }, // cycle: light colour on everything
  atmoDaylight: { value: 1 }, // cycle: 1 by day, 0 at night
  atmoNear: { value: 40 }, // haze starts this far from the camera...
  atmoFar: { value: 240 }, // ...and is full this far
  atmoStrength: { value: 0.75 }, // full haze is this opaque
  atmoBase: { value: 2 }, // thickest below this height...
  atmoTop: { value: 60 }, // ...thinning up to this height
  atmoTopKeep: { value: 0.55 }, // how much haze is left above atmoTop
};

// GLSL: atmosphere(color, worldPos) tints a linear colour by the time of day's light
// and mixes it toward the haze. Call it before <colorspace_fragment>. Needs
// `cameraPosition` (three provides it).
export const atmosphereGlsl = /* glsl */ `
  uniform vec3 atmoSunDir;
  uniform vec3 atmoLightDir;
  uniform vec3 atmoSceneTint;
  uniform float atmoDaylight;
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
    return mix(color * atmoSceneTint, hazeColorToward(toPoint / max(dist, 1e-4)), haze);
  }
`;
