import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import campfireUrl from "../assets/models/world/extras/Campfire.glb?url";
import logBenchUrl from "../assets/models/world/extras/LogBench.glb?url";
import { toonifyScene } from "./toonshading.js";

// The campfire area: Campfire.glb (stones and a log pile) burning a soft particle fire
// (`applyCampfire` below) on a patch of sand, with three log benches in a horseshoe on
// the far side of the fire from the water, so you sit looking over the fire at the water. The logs are seats like the benches (seating.js): walk into one to sit.
//
// The log benches (LogBench.glb) are built at the otter model's scale like the bench,
// with two seats each marked by SitPoint_L / SitPoint_R and their StandPoints.
//
//   const campfire = await createCampfire(scene, world, scenery.campsite, { openToward: SPAWN });
//   (openToward only matters if the site doesn't know where the water is.)
//   campfire.seats   // for createSeating, alongside the benches
//   campfire.update(elapsedSeconds);   // every frame: the fire burns

const FIRE_SCALE = 2.4; // Campfire.glb is in metres; this sizes it for the otters
const FIRE_RADIUS = 1.2; // what the otter can't walk into
const LOG_SCALE = 1.8; // LogBench.glb is at the otter model's scale (character.js MODEL_SCALE)
const LOG_SEATS = [["SitPoint_L", "StandPoint_L"], ["SitPoint_R", "StandPoint_R"]];
const LOG_RING = 4.0; // log benches' distance from the fire
// Three logs in a horseshoe around the fire, this far apart (65 degrees), so their
// ends don't touch; the open side faces the water.
const LOG_SPREAD = (65 * Math.PI) / 180;
const SAND_RADIUS = 5.6; // sandy ground under the fire and the logs
const SAND_COLOR = "#e1d09d"; // the terrain texture's shore sand

// ---------------------------------------------------------------------------
// The fire (provided shader code, unchanged below this line up to "The campfire area").
// Cozy glowing campfire for Campfire.glb:
//   - a particle flame: soft glowing puffs that rise, shrink and cool from white-yellow to orange to red,
//     with wisps breaking off the top, plus sparks drifting up
//   - charred logs that glow orange on the sides facing the fire, with pulsing ember cracks
//   - a glowing ember bed, warm firelight on the stones, a soft halo and a pool of light on the ground
//
// Several campfires can share one update; each gets its own random timing.
// Tune everything in `campfireSettings` (live: changes apply on the next frame).
// ---------------------------------------------------------------------------

export const campfireSettings = {
  height: 1.05,                                // how tall the flames rise (m)
  width: 0.19,                                 // radius of the flame base (m)
  puffs: 130,                                   // flame particles per fire
  sparks: 16,                                  // spark particles per fire
  hot:  new THREE.Color('#fff6c8'),            // white-yellow core
  warm: new THREE.Color('#ffc43d'),            // yellow
  mid:  new THREE.Color('#ff7a1a'),            // orange
  cool: new THREE.Color('#ff5212'),            // red tips
  light: new THREE.Color('#ffa040'),           // colour of the light the fire casts
  lightStrength: 0.55,                          // how much the fire lights the stones/logs
  glowStrength: 0.35,                          // halo + ground light pool (raise for night scenes)
  emberColor: new THREE.Color('#ff5a14'),
};

// ---------------------------------------------------------------------------
// shared GLSL
// ---------------------------------------------------------------------------
const noiseGlsl = /* glsl */ `
  float hash13(vec3 p) { p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
  float vnoise(vec3 p) {
    vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(hash13(i), hash13(i + vec3(1,0,0)), f.x), mix(hash13(i + vec3(0,1,0)), hash13(i + vec3(1,1,0)), f.x), f.y),
               mix(mix(hash13(i + vec3(0,0,1)), hash13(i + vec3(1,0,1)), f.x), mix(hash13(i + vec3(0,1,1)), hash13(i + vec3(1,1,1)), f.x), f.y), f.z);
  }
`;

// ---------------------------------------------------------------------------
// Flame + spark particles (one instanced quad per particle, camera-facing)
// ---------------------------------------------------------------------------
const particleVert = /* glsl */ `
  attribute vec4 aSeed;          // 4 random numbers per particle
  uniform float time, seedOffset, height, width, isSpark;
  uniform vec3 hot, warm, mid, cool;
  varying vec2 vUv;
  varying vec3 vColor;
  varying float vAlpha;
  varying float vSoft;

  vec3 ramp(float h) {           // h: 1 = hottest, 0 = coolest
    vec3 c = mix(cool, mid, smoothstep(0.0, 0.45, h));
    c = mix(c, warm, smoothstep(0.45, 0.75, h));
    return mix(c, hot, smoothstep(0.78, 1.0, h));
  }

  void main() {
    vUv = uv;
    float ang = aSeed.z * 6.2831853;
    vec3 local;
    float size, t;
    if (isSpark < 0.5) {
      // ---- flame puff ----
      // particles belong to one of 5 tongues around the bed; each tongue licks up and down on its own
      float tongue = floor(aSeed.z * 5.0);
      float inT = fract(aSeed.z * 5.0) - 0.5;
      float tph = tongue * 1.93 + seedOffset * 3.0;
      float lick = 0.62 + 0.38 * sin(time * (1.7 + 0.35 * tongue) + tph) * sin(time * 0.9 + tph * 1.3 + 1.0);
      float period = 0.7 + 0.45 * aSeed.w;
      t = fract(time / period + aSeed.x + seedOffset);
      float r = width * sqrt(aSeed.y);
      float centre = 1.0 - r / width;                       // 1 in the middle of the bed
      float a2 = (tongue + 0.5 + inT * 0.55) / 5.0 * 6.2831853;
      float rise = height * mix(0.5 * lick + 0.18, 1.0, centre * centre) * (0.8 + 0.35 * aSeed.w);
      float y = rise * pow(t, 0.9);
      float pull = 1.0 - 0.45 * smoothstep(0.0, 0.8, t);
      vec2 xz = vec2(cos(a2), sin(a2)) * r * pull;
      // turbulence that grows with height, so the tops break into wisps
      float w1 = sin(time * 3.4 + aSeed.x * 40.0 + t * 6.0);
      float w2 = sin(time * 2.6 + aSeed.y * 31.0 + t * 5.0);
      xz += vec2(w1, w2) * 0.07 * t * t;
      xz += vec2(sin(time * 1.3 + seedOffset * 9.0), cos(time * 1.7 + seedOffset * 7.0)) * 0.04 * t * t;  // the whole fire leans a little
      local = vec3(xz.x, y, xz.y);
      // grows in quickly, then shrinks to a wisp at the top
      size = (0.09 + 0.07 * aSeed.y + 0.07 * centre) * smoothstep(0.0, 0.1, t) * pow(1.0 - t, 1.15);
      float heat = (1.0 - t) * (0.5 + 0.5 * centre);
      vColor = ramp(clamp(heat * 1.35, 0.0, 1.0));
      vAlpha = smoothstep(0.0, 0.08, t) * (1.0 - smoothstep(0.35, 0.85, t));
      vSoft = 0.0;
    } else {
      // ---- spark ----
      float period = 1.6 + 1.2 * aSeed.w;
      t = fract(time / period + aSeed.x + seedOffset);
      float r = width * 0.8 * sqrt(aSeed.y);
      vec2 xz = vec2(cos(ang), sin(ang)) * r;
      xz += vec2(sin(time * 2.0 + aSeed.y * 20.0), cos(time * 1.6 + aSeed.x * 17.0)) * 0.12 * t;
      local = vec3(xz.x, height * (0.35 + 1.5 * t), xz.y);
      float blink = 0.6 + 0.4 * sin(time * 17.0 + aSeed.z * 50.0);
      size = 0.028 * (1.0 - 0.5 * t);
      vColor = ramp(0.8 - 0.4 * t);
      vAlpha = smoothstep(0.0, 0.05, t) * (1.0 - smoothstep(0.6, 1.0, t)) * blink * step(0.35, aSeed.w);  // only some sparks fly
      vSoft = 1.0;
    }
    vec4 centreW = modelMatrix * vec4(local, 1.0);
    vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
    vec3 up    = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
    float scale = length(modelMatrix[0].xyz);
    // puffs are a little taller than wide, like tongues of flame
    vec3 world = centreW.xyz + (right * position.x + up * position.y * (isSpark < 0.5 ? 1.25 : 1.0)) * size * scale;
    gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
  }
`;

const particleFrag = /* glsl */ `
  uniform float time, isSpark;
  varying vec2 vUv;
  varying vec3 vColor;
  varying float vAlpha;
  varying float vSoft;
  ${noiseGlsl}
  void main() {
    vec2 p = vUv * 2.0 - 1.0;
    float d = length(p);
    float a;
    if (isSpark < 0.5) {
      // soft blob with a ragged, moving edge so overlapping puffs read as flame, not bubbles
      float n = vnoise(vec3(p * 2.2, time * 2.5 + vColor.r * 10.0));
      a = 1.0 - smoothstep(0.45 + 0.25 * n, 0.95, d);
    } else {
      a = 1.0 - smoothstep(0.0, 1.0, d);
      a = a * a;
    }
    a *= vAlpha;
    if (a < 0.003) discard;
    // premultiplied output: bright colour, partial coverage -> glows over dark AND bright backgrounds
    float cover = isSpark < 0.5 ? 0.55 : 0.25;
    gl_FragColor = vec4(vColor * a, a * cover);
  }
`;

// ---------------------------------------------------------------------------
// Halo + ground light pool (premultiplied, additive-looking)
// ---------------------------------------------------------------------------
const glowVert = /* glsl */ `
  uniform float billboard;
  varying vec2 vUv;
  void main() {
    vUv = uv;
    if (billboard > 0.5) {
      vec4 c = modelMatrix * vec4(0.0, 0.0, 0.0, 1.0);
      vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
      vec3 up    = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
      float s = length(modelMatrix[0].xyz);
      gl_Position = projectionMatrix * viewMatrix * vec4(c.xyz + (right * position.x + up * position.y) * s, 1.0);
    } else {
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  }
`;
const glowFrag = /* glsl */ `
  uniform vec3 color;
  uniform float strength, flicker;
  varying vec2 vUv;
  void main() {
    float d = length(vUv * 2.0 - 1.0);
    float a = pow(max(1.0 - d, 0.0), 2.2) * strength * flicker;
    if (a < 0.002) discard;
    gl_FragColor = vec4(color * a, 0.0);   // pure additive glow
  }
`;

// ---------------------------------------------------------------------------
// Fire-lit surfaces: logs (charred + glowing cracks), stones (warm light), ember bed
// ---------------------------------------------------------------------------
const litVert = /* glsl */ `
  varying vec3 vWorld;
  varying vec3 vNormalW;
  void main() {
    vec4 w = modelMatrix * vec4(position, 1.0);
    vWorld = w.xyz;
    vNormalW = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`;
const litFrag = /* glsl */ `
  uniform vec3 diffuse;
  uniform vec3 lightDir;
  uniform vec3 shadowTint;
  uniform float threshold, softness;
  uniform vec3 fireCenter;       // world position of the base of the flames
  uniform vec3 fireLight, emberColor;
  uniform float fireStrength, flicker, time, kind;   // kind: 0 stone, 1 log, 2 ember bed
  varying vec3 vWorld;
  varying vec3 vNormalW;
  ${noiseGlsl}
  void main() {
    vec3 n = normalize(vNormalW);
    if (!gl_FrontFacing) n = -n;
    vec3 base = diffuse;
    vec3 rel = vWorld - fireCenter;
    float dh = length(rel.xz);

    if (kind > 1.75) {
      // ember bed: dark char with glowing, pulsing specks, hottest in the middle
      vec3 col = vec3(0.035, 0.025, 0.022);
      float sp = vnoise(vec3(vWorld.xz * 34.0, 1.0));
      float pulse = 0.55 + 0.45 * sin(time * 3.0 + vnoise(vec3(vWorld.xz * 9.0, 2.0)) * 12.0);
      float core = 1.0 - smoothstep(0.05, 0.3, dh);
      float glow = smoothstep(0.45, 0.75, sp) * pulse * (0.35 + 0.65 * core) + core * 0.35;
      col += emberColor * glow * 1.6 * flicker;
      gl_FragColor = vec4(col, 1.0);
      #include <colorspace_fragment>
      return;
    }

    if (kind > 0.5) {
      // logs: charred toward the middle of the fire
      float charr = 1.0 - smoothstep(0.05, 0.5, dh);
      float endCap = kind > 1.25 ? 1.0 : 0.0;              // pale cut ends: darken harder
      base = mix(base * mix(0.55, 0.16, endCap), vec3(0.05, 0.038, 0.034), charr * 0.85);
    }
    float lit = smoothstep(threshold - softness, threshold + softness, dot(n, lightDir));
    vec3 col = mix(base * shadowTint, base, lit);

    // warm light from the flames: falls off with distance, strongest on faces turned toward the fire
    vec3 toFire = fireCenter + vec3(0.0, 0.3, 0.0) - vWorld;
    float dist = length(toFire);
    float facing = clamp(dot(n, toFire / dist) * 0.8 + 0.12, 0.0, 1.0);
    float fall = 1.0 - smoothstep(0.1, 0.95, dist);
    col += fireLight * fall * fall * facing * fireStrength * flicker;

    if (kind > 0.5) {
      // glowing ember cracks on the hot parts of the logs, pulsing
      float hotZone = (1.0 - smoothstep(0.08, 0.33, dh)) * (1.0 - smoothstep(0.1, 0.42, rel.y));
      float cr = vnoise(vWorld * vec3(26.0, 26.0, 26.0));
      float cracks = smoothstep(0.62, 0.8, cr) + smoothstep(0.78, 0.95, vnoise(vWorld * 61.0 + 3.0)) * 0.6;
      float pulse = 0.6 + 0.4 * sin(time * 2.4 + vnoise(vWorld * 7.0) * 10.0);
      float underGlow = clamp(dot(n, normalize(vec3(-rel.x, 0.0, -rel.z) + vec3(0.0, -0.3, 0.0))), 0.0, 1.0);
      vec3 ember = emberColor * (cracks * pulse * 2.2 + underGlow * 0.9) * hotZone * flicker;
      // cut ends: smouldering ember glow in the grain, even on the outer ends
      float endCap = kind > 1.25 ? 1.0 : 0.0;
      ember += emberColor * endCap * smoothstep(0.5, 0.85, vnoise(vWorld * 48.0)) * pulse * 0.9 * flicker;
      col += ember;
    }
    gl_FragColor = vec4(col, 1.0);
    #include <colorspace_fragment>
  }
`;

// ---------------------------------------------------------------------------
// setup
// ---------------------------------------------------------------------------
const time = { value: 0 };
const flicker = { value: 1 };
const fires = [];
const quad = new THREE.PlaneGeometry(2, 2);   // -1..1 so the shaders can treat it as a unit disc

const premultipliedBlend = {
  transparent: true, depthWrite: false, toneMapped: false,
  blending: THREE.CustomBlending,
  blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
  blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
};

function makeParticles(count, isSpark, seedOffset) {
  const geo = new THREE.InstancedBufferGeometry();
  geo.index = quad.index;
  geo.setAttribute('position', quad.attributes.position);
  geo.setAttribute('uv', quad.attributes.uv);
  const seeds = new Float32Array(count * 4);
  for (let i = 0; i < seeds.length; i++) seeds[i] = Math.random();
  geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 4));
  geo.instanceCount = count;
  const s = campfireSettings;
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      time, seedOffset: { value: seedOffset }, isSpark: { value: isSpark ? 1 : 0 },
      height: { value: s.height }, width: { value: s.width },
      hot: { value: s.hot }, warm: { value: s.warm }, mid: { value: s.mid }, cool: { value: s.cool },
    },
    vertexShader: particleVert, fragmentShader: particleFrag,
    side: THREE.DoubleSide, ...premultipliedBlend,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = isSpark ? 4 : 3;
  mesh.userData.toon = false;
  return mesh;
}

function makeGlow(billboard, size, y) {
  const g = billboard ? quad : new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2);
  const mat = new THREE.ShaderMaterial({
    uniforms: { billboard: { value: billboard ? 1 : 0 }, color: { value: campfireSettings.light },
                strength: { value: campfireSettings.glowStrength * (billboard ? 1.0 : 0.8) }, flicker },
    vertexShader: glowVert, fragmentShader: glowFrag,
    side: THREE.DoubleSide, ...premultipliedBlend,
    polygonOffset: !billboard, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  });
  const m = new THREE.Mesh(g, mat);
  m.scale.setScalar(size);
  m.position.y = y;
  m.frustumCulled = false;
  m.renderOrder = billboard ? 5 : 1;
  m.userData.toon = false;
  return m;
}

function kindOf(name) {
  if (name.startsWith('Camp_LogEnd')) return 1.4;
  if (name.startsWith('Camp_Bark')) return 1;
  if (name.startsWith('Camp_Stone')) return 0;
  if (name.startsWith('Camp_Char')) return 2;
  return -1;
}

function fireLitMaterial(src, kind, fireCenter) {
  const u = src.uniforms || {};
  const s = campfireSettings;
  return new THREE.ShaderMaterial({
    uniforms: {
      diffuse:    { value: (u.diffuse ? u.diffuse.value : src.color || new THREE.Color(1, 1, 1)).clone() },
      // reuse the scene's toon light settings when the mesh was toonified first
      lightDir:   u.lightDir   || { value: new THREE.Vector3(0.5, 1, 0.8).normalize() },
      shadowTint: u.shadowTint || { value: new THREE.Color(0.78, 0.66, 0.62) },
      threshold:  u.threshold  || { value: -0.1 },
      softness:   u.softness   || { value: 0.02 },
      fireCenter, fireLight: { value: s.light }, emberColor: { value: s.emberColor },
      fireStrength: { value: s.lightStrength }, flicker, time, kind: { value: kind },
    },
    vertexShader: litVert, fragmentShader: litFrag,
    toneMapped: false,
  });
}

export function applyCampfire(root) {
  root.updateMatrixWorld(true);
  let anchor = null;
  root.traverse((o) => { if (o.userData.flame || o.name === 'Flame') anchor = anchor || o; });
  if (!anchor) { console.warn('applyCampfire: no "Flame" node found'); return root; }
  if (anchor.isMesh) anchor.visible = false;           // the old flame card is just the spawn point now

  const fireCenter = { value: new THREE.Vector3() };
  const meshes = [];
  root.traverse((o) => { if (o.isMesh && o !== anchor) meshes.push(o); });
  for (const o of meshes) {
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    const surface = mats[0];
    const kind = kindOf((surface.name || '').replace(' (toon)', ''));
    if (kind < 0) continue;
    const lit = fireLitMaterial(surface, kind, fireCenter);
    if (Array.isArray(o.material)) { const arr = o.material.slice(); arr[0] = lit; o.material = arr; }   // keeps the outline pass
    else o.material = lit;
    o.userData._toonified = true;
  }

  const fx = new THREE.Group();
  fx.name = 'CampfireFX';
  fx.position.copy(anchor.position).add(new THREE.Vector3(0, 0.08, 0));
  anchor.parent.add(fx);
  const seed = Math.random() * 10;
  fx.add(makeParticles(campfireSettings.puffs, false, seed));
  fx.add(makeParticles(campfireSettings.sparks, true, seed + 3.7));
  const halo = makeGlow(true, 0.95, 0.35);
  const pool = makeGlow(false, 1.6, -0.12);
  fx.add(halo, pool);

  fires.push({ root, fx, fireCenter });
  return root;
}

export function updateCampfires(elapsedSeconds) {
  const t = elapsedSeconds;
  time.value = t;
  flicker.value = 0.88 + 0.07 * Math.sin(t * 11.3) + 0.05 * Math.sin(t * 6.7 + 1.3) + 0.04 * Math.sin(t * 23.9 + 0.4);
  for (const f of fires) f.fx.getWorldPosition(f.fireCenter.value);
}

// ---------------------------------------------------------------------------
// The campfire area
// ---------------------------------------------------------------------------
// Paints an irregular patch of shore sand into the terrain texture under the camp, so
// the fire and logs sit on sand instead of grass. It's a cluster of overlapping,
// stretched, soft blobs (shaped by the camp's position, so each camp's patch differs)
// that fades out gradually into the grass.
function paintSand(world, site) {
  const texture = world.terrain.material.map;
  const canvas = texture.image;
  if (!canvas?.getContext) return; // the texture is a canvas once terrainTexture.js has softened it
  const ctx = canvas.getContext("2d");
  const span = world.mapHalf * 2;
  const pxPerUnit = canvas.width / span;
  const toPx = (x, z) => [((x + world.mapHalf) / span) * canvas.width, ((z + world.mapHalf) / span) * canvas.height];
  let seed = Math.abs(Math.round(site.x * 73 + site.z * 151)) + 1;
  const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

  // Color() stores linear values; the canvas wants sRGB.
  const sand = new THREE.Color(SAND_COLOR).convertLinearToSRGB();
  const rgba = (a) => `rgba(${Math.round(sand.r * 255)}, ${Math.round(sand.g * 255)}, ${Math.round(sand.b * 255)}, ${a})`;
  const blobs = [[0, 0, 0.75, 1, 0]];
  for (let i = 0; i < 9; i++) {
    const angle = random() * Math.PI * 2;
    const offset = 0.2 + random() * 0.3;
    blobs.push([Math.cos(angle) * offset, Math.sin(angle) * offset, 0.4 + random() * 0.3, 0.6 + random() * 0.8, random() * Math.PI]);
  }
  for (const [ox, oz, size, stretch, turn] of blobs) {
    const [cx, cy] = toPx(site.x + ox * SAND_RADIUS, site.z + oz * SAND_RADIUS);
    const r = SAND_RADIUS * size * pxPerUnit;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(turn);
    ctx.scale(stretch, 1 / stretch);
    const gradient = ctx.createRadialGradient(0, 0, 0, 0, 0, r);
    gradient.addColorStop(0, rgba(0.8));
    gradient.addColorStop(0.45, rgba(0.55));
    gradient.addColorStop(1, rgba(0));
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
  texture.needsUpdate = true;
}

// The raw bytes are fetched once (and can be started before the campsites are known);
// each campfire parses its own copy, since toonify/applyCampfire mutate what they get.
let assetBytes = null;

export function preloadCampfireAssets() {
  const fetchBytes = (url) => fetch(url).then((r) => {
    if (!r.ok) throw new Error(`Failed to load ${url}: ${r.status}`);
    return r.arrayBuffer();
  });
  assetBytes ??= Promise.all([fetchBytes(campfireUrl), fetchBytes(logBenchUrl)]);
  return assetBytes;
}

export async function createCampfire(scene, world, site, { openToward }) {
  const group = new THREE.Group();
  group.name = "campfire";
  scene.add(group);
  const ground = (x, z) => world.getGroundHeight(x, z);

  const [fireBytes, logBytes] = await preloadCampfireAssets();
  const [fireGltf, logGltf] = await Promise.all([
    new GLTFLoader().parseAsync(fireBytes.slice(0), ""),
    new GLTFLoader().parseAsync(logBytes.slice(0), ""),
  ]);
  const fire = fireGltf.scene;
  toonifyScene(fire); // first: stones and logs get the toon look and outlines
  applyCampfire(fire); // then: the fire, glowing logs and firelight on top
  fire.scale.setScalar(FIRE_SCALE);
  fire.position.set(site.x, ground(site.x, site.z), site.z);
  group.add(fire);
  world.addObstacle(site.x, site.z, FIRE_RADIUS);

  const logModel = logGltf.scene;
  logModel.updateMatrixWorld(true);
  const marker = (name) => logModel.getObjectByName(name).getWorldPosition(new THREE.Vector3());
  const logLength = new THREE.Box3().setFromObject(logModel).getSize(new THREE.Vector3()).x * LOG_SCALE;

  paintSand(world, site);

  // Three logs on the far side of the fire from the water.
  const seats = [];
  const away = site.toWater
    ? Math.atan2(-site.toWater.z, -site.toWater.x)
    : Math.atan2(site.z - openToward.z, site.x - openToward.x);
  for (const step of [-1, 0, 1]) {
    const angle = away + step * LOG_SPREAD;
    const x = site.x + Math.cos(angle) * LOG_RING;
    const z = site.z + Math.sin(angle) * LOG_RING;
    const rotY = Math.atan2(site.x - x, site.z - z); // +z toward the fire
    // Rest on the lowest ground under its length, so neither end floats.
    const along = new THREE.Vector3(Math.cos(rotY), 0, -Math.sin(rotY));
    const y = Math.min(
      ground(x, z),
      ground(x + along.x * logLength * 0.45, z + along.z * logLength * 0.45),
      ground(x - along.x * logLength * 0.45, z - along.z * logLength * 0.45),
    );
    const log = logModel.clone();
    log.scale.setScalar(LOG_SCALE);
    log.position.set(x, y, z);
    log.rotation.y = rotY;
    group.add(log);

    const toWorld = (local) =>
      local
        .clone()
        .multiplyScalar(LOG_SCALE)
        .applyAxisAngle(new THREE.Vector3(0, 1, 0), rotY)
        .add(log.position);
    for (const [sit, stand] of LOG_SEATS) {
      seats.push({ rotY, sit: toWorld(marker(sit)), stand: toWorld(marker(stand)) });
    }
    for (const side of [-0.38, -0.13, 0.13, 0.38]) {
      world.addObstacle(x + along.x * side * logLength, z + along.z * side * logLength, 0.5);
    }
  }

  return {
    seats,
    update(elapsedSeconds) {
      updateCampfires(elapsedSeconds);
    },
  };
}
