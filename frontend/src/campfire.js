import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import campfireUrl from "../assets/models/world/extras/Campfire.glb?url";
import { atmosphereUniforms } from "./atmosphere.js";

// The campfire area: Campfire.glb (stones, a log pile and a flame card) with log seats
// in a semicircle around it, open on the side facing `openToward` (the spawn) so it's
// easy to walk in. The logs are seats like the benches (seating.js): walk into one to sit.
//
// The log seats are PLACEHOLDER geometry until their model arrives: replace buildLog(),
// keeping each log's seat at SEAT_HEIGHT (the bench's) so the otter's Sit clips still
// fit, or move SIT / STAND to the new model's markers.
//
//   const campfire = await createCampfire(scene, world, scenery.campsite, { openToward: SPAWN });
//   campfire.seats   // for createSeating, alongside the benches
//   campfire.update(elapsedSeconds);   // every frame: the flame dances

const FIRE_SCALE = 2.4; // Campfire.glb is in metres; this sizes it for the otters
const FIRE_RADIUS = 1.2; // what the otter can't walk into
const SEAT_HEIGHT = 0.756; // the bench's SitPoint at the otter's scale (0.42 * 1.8)
// Seat and stand spots on a log, in its own space: it faces +z, toward the fire.
const SIT = new THREE.Vector3(0, SEAT_HEIGHT, 0.036);
const STAND = new THREE.Vector3(0, 0, 1.116);
const LOG_RING = 3.6; // log seats' distance from the fire
const LOG_LENGTH = 4.8;
// Thick logs settle into the ground: the top stays at SEAT_HEIGHT whatever the radius.
const LOG_RADIUS = 0.72;
const SEATS_ALONG = [-1.1, 1.1]; // two otters fit side by side on each log

// ---------------------------------------------------------------------------
// The flame: a stylized layered flame drawn on Campfire.glb's "Flame" card with a
// shader: soft teardrop flame (deep-orange rim, orange, yellow, pale core) with side
// lobes, a swaying/stretching dance, a wobble that travels up to the tip, and droplet
// embers rising. The card always turns to face the camera (around the vertical axis),
// so it looks right from every angle, and the 3D logs in front of it hide its base so
// it burns out of the pile. Several campfires can share one update; each gets its own
// random phase so they don't flicker in sync.
// ---------------------------------------------------------------------------
export const campfireColors = {
  rim: new THREE.Color("#e04f1c"), // outline around the flame
  outer: new THREE.Color("#ff8a2a"),
  mid: new THREE.Color("#ffb53c"),
  inner: new THREE.Color("#ffd966"),
  core: new THREE.Color("#fff4cf"),
};

const sharedTime = { value: 0 };

export function updateCampfires(elapsedSeconds) {
  sharedTime.value = elapsedSeconds;
}

const flameVert = /* glsl */ `
  varying vec2 vLocal;
  void main() {
    vLocal = position.xy;   // card-local metres: x centred, y = 0 at the bottom (independent of UV flips)
    // cylindrical billboard: stay upright, turn to face the camera around Y
    vec3 center = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
    float sx = length(modelMatrix[0].xyz);
    float sy = length(modelMatrix[1].xyz);
    vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
    right.y = 0.0;
    right = length(right) > 1e-4 ? normalize(right) : vec3(1.0, 0.0, 0.0);
    vec3 world = center + right * position.x * sx + vec3(0.0, 1.0, 0.0) * position.y * sy;
    gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
  }
`;

const flameFrag = /* glsl */ `
  uniform float time;
  uniform float seed;
  uniform vec2 cardSize;      // metres
  uniform vec3 rimColor, outerColor, midColor, innerColor, coreColor;
  varying vec2 vLocal;

  const float BASE = 0.14;    // flame starts this far above the bottom of the card (inside the log pile)
  const float H = 0.80;       // main flame height (m)
  const float W = 0.22;       // main flame half-width (m)

  // signed "inside" distance (m) of a soft teardrop flame; > 0 inside
  float flame(vec2 p, float h, float w, float ph) {
    float stretch = 1.0 + 0.07 * sin(time * 4.1 + ph) + 0.04 * sin(time * 7.3 + ph * 1.3);
    h *= stretch; w /= sqrt(stretch);
    float traw = p.y / h;
    float t = clamp(traw, 0.0, 1.0);
    float sway = (0.10 * sin(time * 2.3 + ph) + 0.05 * sin(time * 3.7 + ph * 1.7)) * t * t * h
               + 0.022 * sin(t * 9.0 - time * 7.0 + ph) * t * h;
    float x = p.x - sway;
    float c = 0.34, wd;
    if (t < c) { float u = (t - c) / c; wd = w * sqrt(max(0.0, 1.0 - u * u)); }
    else       { float u = (t - c) / (1.0 - c); wd = w * pow(max(0.0, 1.0 - u), 1.25) * (1.0 + 0.25 * u * (1.0 - u)); }
    // below the base and above the tip: true distance to the end point, so no hairline streaks
    if (traw < 0.0) return -length(vec2(x, p.y));
    if (traw > 1.0) return -length(vec2(x, p.y - h));
    return wd - abs(x);
  }

  // small upward-pointing droplet; > 0 inside
  float droplet(vec2 p, vec2 c, float s) {
    vec2 q = (p - c) / max(s, 1e-4);
    float d = length(vec2(q.x * (1.0 + max(q.y, 0.0) * 0.9), q.y * 0.8));
    return (1.0 - d) * s;
  }

  float cover(float d) { float aa = fwidth(d) * 0.75 + 1e-5; return smoothstep(-aa, aa, d); }

  void main() {
    vec2 p = vec2(vLocal.x, vLocal.y - BASE);
    float ph = seed * 6.2831;

    // outer silhouette: main flame + two side lobes
    float outer = flame(p, H, W, ph);
    outer = max(outer, flame(p - vec2(-0.13, 0.0), H * 0.55, W * 0.55, ph + 1.7));
    outer = max(outer, flame(p - vec2( 0.14, 0.0), H * 0.47, W * 0.50, ph + 3.1));
    float mid   = flame(p - vec2(0.0, 0.01), H * 0.76, W * 0.70, ph + 0.6);
    float inner = flame(p - vec2(0.0, 0.02), H * 0.52, W * 0.46, ph + 1.2);
    float core  = flame(p - vec2(0.0, 0.03), H * 0.30, W * 0.25, ph + 1.8);

    vec3 col = rimColor;
    float a = cover(outer);
    col = mix(col, outerColor, cover(outer - 0.022));
    col = mix(col, midColor,   cover(mid));
    col = mix(col, innerColor, cover(inner));
    col = mix(col, coreColor,  cover(core));

    // droplet embers drifting up and fading
    for (int i = 0; i < 4; i++) {
      float fi = float(i);
      float k = fract(time * 0.33 + fi * 0.27 + seed);
      float ex = (fi - 1.5) * 0.12 + 0.04 * sin(time * 2.0 + fi * 2.3 + ph);
      float ey = H * (0.55 + 0.60 * k);
      float s = 0.034 * (1.0 - 0.55 * k) * smoothstep(0.0, 0.12, k) * (1.0 - smoothstep(0.78, 1.0, k));
      float d = droplet(p, vec2(ex, ey), s);
      float da = cover(d);
      if (da > 0.0) {
        vec3 dc = mix(rimColor, outerColor, cover(d - s * 0.35));
        dc = mix(dc, innerColor, cover(d - s * 0.65));
        col = mix(col, dc, da * (1.0 - a));
        a = max(a, da);
      }
    }

    if (a < 0.01) discard;
    gl_FragColor = vec4(col, a);
    #include <colorspace_fragment>
  }
`;

/** Gives Campfire.glb's flame card its shader. Call before toonifyScene. */
export function applyCampfire(root) {
  root.traverse((o) => {
    if (!o.isMesh || !o.userData.flame) return;
    o.material = new THREE.ShaderMaterial({
      uniforms: {
        time: sharedTime,
        seed: { value: Math.random() },
        cardSize: { value: new THREE.Vector2(o.userData.cardWidth || 0.95, o.userData.cardHeight || 1.45) },
        rimColor: { value: campfireColors.rim },
        outerColor: { value: campfireColors.outer },
        midColor: { value: campfireColors.mid },
        innerColor: { value: campfireColors.inner },
        coreColor: { value: campfireColors.core },
      },
      vertexShader: flameVert,
      fragmentShader: flameFrag,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false,
    });
    o.frustumCulled = false; // the billboard moves outside the card's original bounds
    o.renderOrder = 2;
    o.userData._toonified = true;
  });
  return root;
}

// ---------------------------------------------------------------------------
// The campfire area
// ---------------------------------------------------------------------------
const bark = new THREE.MeshStandardMaterial({ color: "#7a4a2a" });
const cutWood = new THREE.MeshStandardMaterial({ color: "#d9a86c" });

function buildLog() {
  const log = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.CylinderGeometry(LOG_RADIUS, LOG_RADIUS * 1.05, LOG_LENGTH, 12),
    [bark, cutWood, cutWood], // side, top, bottom: cut rings on the ends
  );
  body.rotation.z = Math.PI / 2; // lying along x
  body.position.y = SEAT_HEIGHT - LOG_RADIUS; // its top is the seat
  log.add(body);
  return log;
}

// A soft warm glow around the fire at night.
function buildGlow() {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d");
  const gradient = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gradient.addColorStop(0, "rgba(255, 190, 110, 0.9)");
  gradient.addColorStop(0.4, "rgba(255, 140, 60, 0.35)");
  gradient.addColorStop(1, "rgba(255, 120, 40, 0)");
  g.fillStyle = gradient;
  g.fillRect(0, 0, 64, 64);
  return new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: new THREE.CanvasTexture(c),
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      transparent: true,
    }),
  );
}

export async function createCampfire(scene, world, site, { openToward }) {
  const group = new THREE.Group();
  group.name = "campfire";
  scene.add(group);
  const ground = (x, z) => world.getGroundHeight(x, z);

  const fire = (await new GLTFLoader().loadAsync(campfireUrl)).scene;
  applyCampfire(fire);
  fire.scale.setScalar(FIRE_SCALE);
  fire.position.set(site.x, ground(site.x, site.z), site.z);
  group.add(fire);
  world.addObstacle(site.x, site.z, FIRE_RADIUS);

  // The glow sits on the model's LightPoint (the heart of the fire).
  const glow = buildGlow();
  const lightPoint = fire.getObjectByName("LightPoint");
  if (lightPoint) lightPoint.add(glow);
  else fire.add(glow);
  glow.scale.setScalar(5 / FIRE_SCALE);

  // Three logs at the other three quarters of a circle, leaving the side toward
  // `openToward` open.
  const seats = [];
  const open = Math.atan2(openToward.z - site.z, openToward.x - site.x);
  for (let i = 1; i <= 3; i++) {
    const angle = open + (i * Math.PI) / 2;
    const x = site.x + Math.cos(angle) * LOG_RING;
    const z = site.z + Math.sin(angle) * LOG_RING;
    const rotY = Math.atan2(site.x - x, site.z - z); // +z toward the fire
    // Rest on the lowest ground under its length, so neither end floats.
    const along = new THREE.Vector3(Math.cos(rotY), 0, -Math.sin(rotY));
    const y = Math.min(
      ground(x, z),
      ground(x + along.x * LOG_LENGTH * 0.45, z + along.z * LOG_LENGTH * 0.45),
      ground(x - along.x * LOG_LENGTH * 0.45, z - along.z * LOG_LENGTH * 0.45),
    );
    const log = buildLog();
    log.position.set(x, y, z);
    log.rotation.y = rotY;
    group.add(log);

    const toWorld = (local, offset) =>
      local
        .clone()
        .setX(offset)
        .applyAxisAngle(new THREE.Vector3(0, 1, 0), rotY)
        .add(log.position);
    for (const offset of SEATS_ALONG) {
      seats.push({ rotY, sit: toWorld(SIT, offset), stand: toWorld(STAND, offset) });
    }
    for (const side of [-1.8, -0.6, 0.6, 1.8]) {
      world.addObstacle(x + along.x * side, z + along.z * side, 0.75);
    }
  }

  return {
    seats,
    update(elapsedSeconds) {
      updateCampfires(elapsedSeconds);
      const night = 1 - atmosphereUniforms.atmoDaylight.value;
      glow.material.opacity = night * (0.9 + Math.sin(elapsedSeconds * 9) * 0.1);
      glow.visible = night > 0.02;
    },
  };
}
