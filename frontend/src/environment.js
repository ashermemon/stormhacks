import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import cloudsUrl from "../assets/models/world/clouds/Clouds.glb?url";
import {
  atmosphereGlsl,
  atmosphereUniforms,
  SUN_DIRECTION,
} from "./atmosphere.js";
import { seededRandom } from "./trinkets/spawnZones.js";

// Sky, sun and clouds. The ground, water and mountains come from World.glb (world.js);
// the haze that ties them to the sky lives in atmosphere.js.
//
//   const environment = createEnvironment(scene);
//   // every frame, after the camera has moved:
//   environment.update(camera, elapsedSeconds);

const SKY_RADIUS = 400; // inside the camera's far plane (500)
const CLOUD_DRIFT = 0.004; // radians per second the cloud ring turns
const SUN_RADIUS = 0.04; // angular radius in radians (~4.5 degrees across)

const skyUniforms = {
  ...atmosphereUniforms,
  skyZenith: { value: new THREE.Color("#4fa6dc") },
  skyMid: { value: new THREE.Color("#8ccdec") },
  sunCore: { value: new THREE.Color("#fffdf2") },
  sunHalo: { value: new THREE.Color("#fff3d2") },
  sunGlow: { value: new THREE.Color("#ffe8c0") },
};

// A gradient from the haze colour at the horizon to deep blue overhead, warmer toward
// the sun, and the sun itself: a small bright disc in a soft glow.
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
    uniform vec3 skyZenith;
    uniform vec3 skyMid;
    uniform vec3 sunCore;
    uniform vec3 sunHalo;
    uniform vec3 sunGlow;
    ${atmosphereGlsl}
    varying vec3 vDir;


    void main() {
      vec3 dir = normalize(vDir);
      float up = max(dir.y, 0.0);
      // A band of mist above the horizon, reaching past the mountain peaks (~18
      // degrees up), so the hazed mountains melt into it instead of standing out as
      // lighter shapes against blue.
      vec3 mist = hazeColorToward(dir);
      vec3 sky = mix(mist, skyMid, smoothstep(0.08, 0.38, up));
      sky = mix(sky, skyZenith, smoothstep(0.35, 0.85, up));

      float toSun = dot(dir, atmoSunDir);
      float angle = acos(clamp(toSun, -1.0, 1.0));
      float r = ${SUN_RADIUS.toFixed(4)};
      sky = mix(sky, sunGlow, pow(max(toSun, 0.0), 10.0) * 0.4); // wide warm glow
      sky = mix(sky, sunHalo, exp(-angle / (r * 1.6)) * 0.8); // bright halo
      sky = mix(sky, sunCore, 1.0 - smoothstep(r * 0.8, r, angle)); // the disc
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
      float light = dot(n, atmoSunDir);
      float w = fwidth(light) * 0.75;
      vec3 col = vTint * mix(cloudShade, vec3(1.0), smoothstep(-0.15 - w, -0.15 + w, light));
      // Edges seen against the sun catch warm light.
      float rim = pow(1.0 - abs(dot(n, view)), 3.0) * max(dot(view, atmoSunDir), 0.0);
      col = mix(col, cloudRim, smoothstep(0.15, 0.3, rim) * 0.7);
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
  const sun = new THREE.DirectionalLight(0xffe2a6, 2);
  sun.position.copy(SUN_DIRECTION).multiplyScalar(50);
  scene.add(sun);

  return {
    update(camera, elapsedSeconds) {
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
