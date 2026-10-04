import * as THREE from "three";
import { atmosphereUniforms, SUN_DIRECTION } from "./atmosphere.js";
import { setToonLight, toonUniforms } from "./toonshading.js";

// Day and night. The time of day comes from the real clock, so every player sees the
// same sky without the server knowing about it. Each frame update() moves the sun and
// moon, aims the toon light, and blends the sky, haze and light colours through day,
// golden dawn/dusk and night. The sky and clouds (environment.js) read the result.
//
// Testing from the URL:  ?time=0.5  freezes the cycle there (0 = sunrise, 0.65 = sunset)
//                        ?cycle=60  runs a whole day in 60 seconds

const CYCLE_SECONDS = 12 * 60; // one full day
const DAY_SHARE = 0.65; // fraction of the cycle the sun is up
const NOON_TILT = 1.05; // radians the noon sun leans off straight up: it peaks ~30 degrees up

// The sun sets west-north-west, in the gap in the mountains, and rises opposite.
const EAST = new THREE.Vector3(0.913, 0, -0.407).normalize();
const NOON = new THREE.Vector3(0, Math.cos(NOON_TILT), 0)
  .addScaledVector(new THREE.Vector3(-0.407, 0, -0.913), Math.sin(NOON_TILT))
  .normalize();

const PALETTE = {
  day: {
    zenith: "#4fa6dc",
    mid: "#8ccdec",
    haze: "#d3ebf2",
    sunHaze: "#ffc994",
    tint: [1, 1, 1],
    shadow: [0.78, 0.66, 0.62],
    sunCore: "#fffdf2",
    sunHalo: "#fff3d2",
    sunGlow: "#ffe8c0",
  },
  dusk: {
    zenith: "#46619e",
    mid: "#d99a86",
    haze: "#f6b98e",
    sunHaze: "#ff8f4f",
    tint: [1.0, 0.8, 0.68],
    shadow: [0.66, 0.52, 0.62],
    sunCore: "#ffd08a",
    sunHalo: "#ffb070",
    sunGlow: "#ff9a5a",
  },
  night: {
    zenith: "#060c22",
    mid: "#121d44",
    haze: "#22325c",
    sunHaze: "#22325c",
    tint: [0.36, 0.42, 0.66],
    shadow: [0.62, 0.66, 0.9],
    sunCore: "#ffd08a",
    sunHalo: "#ffb070",
    sunGlow: "#ff9a5a",
  },
};
// Pre-converted to THREE.Color (linear), so blending each frame is cheap.
for (const key of Object.keys(PALETTE)) {
  const p = PALETTE[key];
  for (const [name, value] of Object.entries(p)) {
    p[name] = Array.isArray(value)
      ? new THREE.Color(...value)
      : new THREE.Color(value);
  }
}

const params = new URLSearchParams(window.location.search);
const FIXED_TIME = params.has("time") ? Number(params.get("time")) : null;
const SPEED_CYCLE = Number(params.get("cycle")) || CYCLE_SECONDS;

/** Where we are in the day: 0 = sunrise, DAY_SHARE = sunset, back to 1 = sunrise. */
function cycleFraction() {
  if (FIXED_TIME !== null && Number.isFinite(FIXED_TIME))
    return ((FIXED_TIME % 1) + 1) % 1;
  return (Date.now() / 1000 / SPEED_CYCLE) % 1;
}

export function createDayCycle() {
  const moon = new THREE.Vector3();
  const light = new THREE.Vector3();
  const state = {
    sun: SUN_DIRECTION, // shared with the haze and clouds
    moon,
    day: 1, // 0..1 weights of each palette; they sum to 1
    dusk: 0,
    night: 0,
    sunVisible: 1,
    moonVisible: 0,
    colors: Object.fromEntries(
      Object.keys(PALETTE.day).map((k) => [k, new THREE.Color()]),
    ),
  };

  function update() {
    const f = cycleFraction();
    // The sun sweeps sunrise -> noon -> sunset while it's up, then the hidden half.
    const angle =
      f < DAY_SHARE
        ? (f / DAY_SHARE) * Math.PI
        : Math.PI + ((f - DAY_SHARE) / (1 - DAY_SHARE)) * Math.PI;
    SUN_DIRECTION.copy(EAST)
      .multiplyScalar(Math.cos(angle))
      .addScaledVector(NOON, Math.sin(angle))
      .normalize();
    moon.copy(SUN_DIRECTION).negate();

    const height = SUN_DIRECTION.y;
    state.day = THREE.MathUtils.smoothstep(height, 0.03, 0.25);
    state.night = 1 - THREE.MathUtils.smoothstep(height, -0.3, -0.05);
    state.dusk = Math.max(0, 1 - state.day - state.night);
    state.sunVisible = THREE.MathUtils.smoothstep(height, -0.12, 0.02);
    state.moonVisible = THREE.MathUtils.smoothstep(-height, -0.12, 0.02);

    for (const [name, color] of Object.entries(state.colors)) {
      color.setRGB(0, 0, 0);
      for (const phase of ["day", "dusk", "night"]) {
        const c = PALETTE[phase][name];
        color.r += c.r * state[phase];
        color.g += c.g * state[phase];
        color.b += c.b * state[phase];
      }
    }

    // Toon light: from the sun by day, the moon by night. Near the horizon it swings
    // through straight up, so the shading never flips from one side to the other.
    const body = height >= 0 ? SUN_DIRECTION : moon;
    const lean = THREE.MathUtils.smoothstep(body.y, 0, 0.3);
    light
      .set(body.x * lean, Math.max(body.y, 0) + 0.5, body.z * lean)
      .normalize();
    setToonLight(light.x, light.y, light.z);
    toonUniforms.shadowTint.value.copy(state.colors.shadow);

    atmosphereUniforms.atmoLightDir.value.copy(light);
    atmosphereUniforms.atmoHazeColor.value.copy(state.colors.haze);
    atmosphereUniforms.atmoSunHaze.value.copy(state.colors.sunHaze);
    atmosphereUniforms.atmoSceneTint.value.copy(state.colors.tint);
    atmosphereUniforms.atmoDaylight.value = state.day + state.dusk * 0.6;
    return state;
  }

  return { update, state };
}
