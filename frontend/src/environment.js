import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import cloudsUrl from "../assets/models/world/clouds/Clouds.glb?url";
import { atmosphereGlsl, atmosphereUniforms } from "./atmosphere.js";
import { createDayCycle } from "./daycycle.js";
import { seededRandom } from "./trinkets/spawnZones.js";

// Sky, sun, moon, stars and clouds. The ground, water and mountains come from World.glb
// (world.js); the haze that ties them to the sky lives in atmosphere.js, and the time
// of day that colours all of it in daycycle.js.
//
//   const environment = createEnvironment(scene);
//   // every frame, after the camera has moved:
//   environment.update(camera, elapsedSeconds);

const SKY_RADIUS = 400; // inside the camera's far plane (500)
const CLOUD_DRIFT = 0.004; // radians per second the cloud ring turns
const SUN_RADIUS = 0.04; // angular radius in radians (~4.5 degrees across)
const MOON_RADIUS = 0.02; // same size as the sun

// Colours marked "cycle" are set every frame from daycycle.js.
const skyUniforms = {
  ...atmosphereUniforms,
  skyTime: { value: 0 },
  skyZenith: { value: new THREE.Color("#4fa6dc") }, // cycle
  skyMid: { value: new THREE.Color("#8ccdec") }, // cycle
  sunCore: { value: new THREE.Color("#fffdf2") }, // cycle
  sunHalo: { value: new THREE.Color("#fff3d2") }, // cycle
  sunGlow: { value: new THREE.Color("#ffe8c0") }, // cycle
  sunVisible: { value: 1 }, // cycle
  moonDir: { value: new THREE.Vector3(0, -1, 0) }, // cycle
  moonVisible: { value: 0 }, // cycle
  starAmount: { value: 0 }, // cycle
  moonColor: { value: new THREE.Color("#eef2ff") },
  moonGlow: { value: new THREE.Color("#8fa6dc") },
};

// A gradient from the haze colour at the horizon to the zenith colour overhead,
// warmer toward the sun; the sun (a small bright disc in a soft glow); and at night a
// thin crescent moon drawn the same way, in a cool glow, with twinkling stars.
const skyMaterial = new THREE.ShaderMaterial({
  uniforms: skyUniforms,
  vertexShader: /* glsl */ `
    varying vec3 vDir;
    void main() {
      vDir = position;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform float skyTime;
    uniform vec3 skyZenith;
    uniform vec3 skyMid;
    uniform vec3 sunCore;
    uniform vec3 sunHalo;
    uniform vec3 sunGlow;
    uniform float sunVisible;
    uniform vec3 moonDir;
    uniform float moonVisible;
    uniform float starAmount;
    uniform vec3 moonColor;
    uniform vec3 moonGlow;
    ${atmosphereGlsl}
    varying vec3 vDir;

    float hash(vec3 p) {
      return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453);
    }

    // 1 inside a disc of radius 1 at c, with the same soft edge as the sun.
    float disc(vec2 p, vec2 c) {
      return 1.0 - smoothstep(0.8, 1.0, length(p - c));
    }

    void main() {
      vec3 dir = normalize(vDir);
      float up = max(dir.y, 0.0);
      // A band of mist above the horizon, reaching past the mountain peaks (~18
      // degrees up), so the hazed mountains melt into it instead of standing out as
      // lighter shapes against blue.
      vec3 mist = hazeColorToward(dir);
      vec3 sky = mix(mist, skyMid, smoothstep(0.08, 0.38, up));
      sky = mix(sky, skyZenith, smoothstep(0.35, 0.85, up));

      // Stars: one in a few cells of a grid over the sky, twinkling, above the mist.
      vec3 cell = floor(dir * 160.0);
      float seed = hash(cell);
      vec3 spot = (cell + 0.5 + (vec3(hash(cell + 1.3), hash(cell + 2.7), hash(cell + 4.1)) - 0.5) * 0.6) / 160.0;
      float star = step(0.975, seed) * (1.0 - smoothstep(0.0006, 0.0016, length(dir - normalize(spot))));
      star *= 0.6 + 0.4 * sin(skyTime * (1.5 + seed * 3.0) + seed * 40.0);
      sky += vec3(0.9, 0.93, 1.0) * star * starAmount * smoothstep(0.05, 0.3, up);

      // Shooting stars: a few slots, each now and then streaking a bright head and a
      // fading tail across a random patch of sky in under a second.
      for (int i = 0; i < 3; i++) {
        float slot = float(i);
        float period = 9.0 + slot * 5.5;
        float t = skyTime + slot * 3.1;
        float n = floor(t / period);
        float life = (t - n * period) / 0.8; // 0..1 over 0.8 s
        if (life > 1.0 || hash(vec3(n, slot, 7.0)) < 0.5) continue;
        float az = hash(vec3(n, slot, 1.0)) * 6.2832;
        float el = mix(0.45, 1.0, hash(vec3(n, slot, 2.0))); // ~26-57 degrees up
        vec3 start = vec3(cos(az) * cos(el), sin(el), sin(az) * cos(el));
        vec3 across = normalize(cross(start, vec3(0.0, 1.0, 0.0)));
        if (hash(vec3(n, slot, 3.0)) > 0.5) across = -across;
        vec3 down = -normalize(vec3(0.0, 1.0, 0.0) - start * start.y);
        vec3 travel = normalize(across + down * 0.6);
        vec3 head = normalize(start + travel * 0.35 * life);
        vec3 tail = normalize(start + travel * 0.35 * max(life - 0.35, 0.0));
        vec3 seg = head - tail;
        float along = clamp(dot(dir - tail, seg) / max(dot(seg, seg), 1e-8), 0.0, 1.0);
        float d = length(dir - (tail + seg * along));
        float streak = (1.0 - smoothstep(0.0008, 0.0025, d)) * along * sin(life * 3.14159);
        sky += vec3(1.0, 0.97, 0.9) * streak * starAmount * smoothstep(0.1, 0.3, up);
      }

      float toSun = dot(dir, atmoSunDir);
      float angle = acos(clamp(toSun, -1.0, 1.0));
      float r = ${SUN_RADIUS.toFixed(4)};
      sky = mix(sky, sunGlow, pow(max(toSun, 0.0), 10.0) * 0.4 * sunVisible); // wide warm glow
      sky = mix(sky, sunHalo, exp(-angle / (r * 1.6)) * 0.8 * sunVisible); // bright halo
      sky = mix(sky, sunCore, (1.0 - smoothstep(r * 0.8, r, angle)) * sunVisible); // the disc

      // Moon: glows like the sun but cool and dimmer, then a thin crescent: its disc
      // with a slightly offset disc cut out of it.
      float toMoon = dot(dir, moonDir);
      float moonAngle = acos(clamp(toMoon, -1.0, 1.0));
      float mr = ${MOON_RADIUS.toFixed(4)};
      sky = mix(sky, moonGlow, pow(max(toMoon, 0.0), 10.0) * 0.25 * moonVisible); // wide cool glow
      sky = mix(sky, moonGlow, exp(-moonAngle / (mr * 1.6)) * 0.45 * moonVisible); // halo
      vec3 side = normalize(cross(moonDir, vec3(0.0, 1.0, 0.0)));
      vec3 lift = cross(side, moonDir);
      vec2 face = vec2(dot(dir, side), dot(dir, lift)) / mr; // in moon radii
      float crescent = disc(face, vec2(0.0)) * (1.0 - disc(face, vec2(0.36, 0.2)));
      sky = mix(sky, moonColor, crescent * step(0.0, toMoon) * moonVisible);
      gl_FragColor = vec4(sky, 1.0);
      #include <colorspace_fragment>
    }
  `,
  side: THREE.BackSide,
  depthWrite: false,
  depthTest: false,
  toneMapped: false,
});

// Clouds (assets/models/world/clouds/Clouds.glb): four shapes with flat bottoms at
// y = 0 and a baked white-to-lavender belly gradient in their vertex colours. On top
// of that: a cool cel shadow on the side away from the sun, warm edges against the
// sun, and a fade into the haze with distance.
const cloudMaterial = new THREE.ShaderMaterial({
  uniforms: {
    ...atmosphereUniforms,
    cloudShade: { value: new THREE.Color("#d2dbf2") }, // multiplies the side away from the sun
    cloudRim: { value: new THREE.Color("#fff1d2") },
  },
  vertexShader: /* glsl */ `
    varying vec3 vNormalW;
    varying vec3 vWorld;
    varying vec3 vTint;
    void main() {
      vNormalW = normalize(mat3(modelMatrix) * normal);
      vec4 world = modelMatrix * vec4(position, 1.0);
      vWorld = world.xyz;
      vTint = color.rgb; // the baked colours are RGBA
      gl_Position = projectionMatrix * viewMatrix * world;
    }
  `,
  fragmentShader: /* glsl */ `
    uniform vec3 cloudShade;
    uniform vec3 cloudRim;
    ${atmosphereGlsl}
    varying vec3 vNormalW;
    varying vec3 vWorld;
    varying vec3 vTint;
    void main() {
      vec3 n = normalize(vNormalW);
      if (!gl_FrontFacing) n = -n;
      vec3 view = normalize(vWorld - cameraPosition);
      float light = dot(n, atmoLightDir);
      float w = fwidth(light) * 0.75;
      vec3 col = vTint * mix(cloudShade, vec3(1.0), smoothstep(-0.15 - w, -0.15 + w, light));
      col *= atmoSceneTint * mix(0.6, 1.0, atmoDaylight); // the time of day's light; dimmer at night
      // Edges seen against the sun catch warm light (not at night).
      float rim = pow(1.0 - abs(dot(n, view)), 3.0) * max(dot(view, atmoSunDir), 0.0);
      col = mix(col, cloudRim * atmoSceneTint, smoothstep(0.15, 0.3, rim) * 0.7 * atmoDaylight);
      float dist = length(vWorld - cameraPosition);
      // Far clouds, and low ones sitting in the horizon mist, fade into it.
      float haze = max(smoothstep(120.0, 420.0, dist) * 0.3, (1.0 - smoothstep(0.02, 0.25, view.y)) * 0.3);
      col = mix(col, hazeColorToward(view), haze);
      gl_FragColor = vec4(col, 1.0);
      #include <colorspace_fragment>
    }
  `,
  vertexColors: true,
  side: THREE.DoubleSide,
  toneMapped: false,
});

async function loadClouds() {
  const gltf = await new GLTFLoader().loadAsync(cloudsUrl);
  const shapes = [];
  gltf.scene.traverse((o) => {
    if (o.isMesh) shapes.push(o.geometry);
  });
  const random = seededRandom(7);
  const group = new THREE.Group();
  group.name = "clouds";
  const place = (
    count,
    minRadius,
    maxRadius,
    minY,
    maxY,
    minScale,
    maxScale,
  ) => {
    for (let i = 0; i < count; i++) {
      const shape = shapes[Math.floor(random() * shapes.length)];
      const cloud = new THREE.Mesh(shape, cloudMaterial);
      const angle = ((i + random() * 0.6) / count) * Math.PI * 2;
      const radius = minRadius + random() * (maxRadius - minRadius);
      cloud.position.set(
        Math.cos(angle) * radius,
        minY + random() * (maxY - minY),
        Math.sin(angle) * radius,
      );
      // Long side roughly across the view from the middle of the map.
      cloud.rotation.y = -angle + Math.PI / 2 + (random() - 0.5) * 0.6;
      cloud.scale.setScalar(minScale + random() * (maxScale - minScale));
      cloud.userData.toon = false;
      cloud.userData.bob = random() * Math.PI * 2;
      cloud.userData.baseY = cloud.position.y;
      group.add(cloud);
    }
  };
  place(22, 140, 230, 40, 75, 0.9, 1.5); // a ring drifting over the mountains
  place(10, 40, 120, 60, 85, 0.6, 1.0); // a few overhead
  return group;
}

export function createEnvironment(scene) {
  const horizon = atmosphereUniforms.atmoHazeColor.value;
  scene.background = horizon.clone(); // under the sky dome, e.g. while it loads
  // Only plain three materials (trinket sparkles and particles) read scene.fog; match the haze.
  scene.fog = new THREE.Fog(
    horizon.clone(),
    atmosphereUniforms.atmoNear.value,
    atmosphereUniforms.atmoFar.value * 1.4,
  );

  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(SKY_RADIUS, 48, 24),
    skyMaterial,
  );
  sky.name = "sky";
  sky.renderOrder = -1000; // drawn first, behind everything
  sky.frustumCulled = false;
  sky.userData.toon = false;
  scene.add(sky);

  // The clouds load in the background and drift in once they're ready.
  let clouds = null;
  loadClouds()
    .then((group) => {
      clouds = group;
      scene.add(group);
    })
    .catch((error) => console.warn("Clouds failed to load", error));

  // The toon shader ignores lights; these are for any plain three materials.
  scene.add(new THREE.HemisphereLight(0xfff4d6, 0x315447, 1.5));
  scene.add(new THREE.DirectionalLight(0xffe2a6, 2));

  const cycle = createDayCycle();

  return {
    update(camera, elapsedSeconds) {
      const day = cycle.update();
      const { colors } = day;
      skyUniforms.skyTime.value = elapsedSeconds;
      skyUniforms.skyZenith.value.copy(colors.zenith);
      skyUniforms.skyMid.value.copy(colors.mid);
      skyUniforms.sunCore.value.copy(colors.sunCore);
      skyUniforms.sunHalo.value.copy(colors.sunHalo);
      skyUniforms.sunGlow.value.copy(colors.sunGlow);
      skyUniforms.sunVisible.value = day.sunVisible;
      skyUniforms.moonDir.value.copy(day.moon);
      skyUniforms.moonVisible.value = day.moonVisible;
      skyUniforms.starAmount.value = day.night;
      scene.fog.color.copy(colors.haze);
      scene.background.copy(colors.haze);

      sky.position.copy(camera.position); // the sky is infinitely far: it moves with you
      if (!clouds) return;
      clouds.rotation.y = elapsedSeconds * CLOUD_DRIFT;
      for (const cloud of clouds.children) {
        cloud.position.y =
          cloud.userData.baseY +
          Math.sin(elapsedSeconds * 0.15 + cloud.userData.bob) * 1.2;
      }
    },
  };
}
