import * as THREE from "three";
import { atmosphereGlsl, atmosphereUniforms } from "./atmosphere.js";
import { waterUniforms } from "./watershader.js";
import { WATER_SURFACE_Y } from "./world.js";

// The waterfall at the head of the stream: a thick curtain of water pours off a rocky
// ledge on the mountainside and arcs down into the pool where the stream begins, so
// the stream has a source. Drawn in the stream's own colours (waterUniforms):
//   - a rounded body of water, toon-shaded with a lit side, a shadow side and darker
//     edges, with white streaks rushing down it
//   - an outer veil of foam streaks moving at a different speed, for depth
//   - a churning pile of white foam blobs where it lands, foam patches and ripples
//     spreading downstream, and low mist, spray and bubbles around the splash
// scenery.js keeps its path clear and frames it with rocks.
//
//   const waterfall = createWaterfall(scene, world);
//   waterfall.update(elapsedSeconds);   // every frame

// Where it is on the map: the ledge at the top of the slope north of the stream's
// head, and the landing in the stream (the stream flows south, toward +z).
export const WATERFALL = {
  x: 16.5,
  topZ: -114.5,
  bottomZ: -102.5,
  topWidth: 7,
  bottomWidth: 10,
  topDepth: 1.6, // how thick the falling water is
  bottomDepth: 2.6,
};

const ALONG = 64; // rings down the fall
const AROUND = 20; // points around each ring
const FLOW_SPEED = 7; // how fast the streaks rush down (units per second)

// 2D simplex noise (Ashima Arts / Stefan Gustavson, MIT), as in watershader.js.
const noiseGlsl = /* glsl */ `
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
`;

// ---------------------------------------------------------------------------
// The falling water: a tube with a flattened (elliptical) cross-section following
// the arc off the ledge, so it has real thickness from every side.
// ---------------------------------------------------------------------------
const fallVert = /* glsl */ `
  attribute float aAcross; // units from the middle, across the fall
  varying vec2 vUv;
  varying vec3 vWorld;
  varying vec3 vNormalW;
  varying float vAcross;
  void main() {
    vUv = uv;
    vAcross = aAcross;
    vNormalW = normalize(mat3(modelMatrix) * normal);
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorld = world.xyz;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const fallFrag = /* glsl */ `
  uniform float time;
  uniform float fallLength;
  uniform float veil; // 0: the body of water, 1: the foam veil around it
  uniform vec3 deepColor;
  uniform vec3 lightColor;
  uniform vec3 foamColor;
  uniform vec3 deepShade;
  ${atmosphereGlsl}
  ${noiseGlsl}
  varying vec2 vUv;
  varying vec3 vWorld;
  varying vec3 vNormalW;
  varying float vAcross;
  void main() {
    vec3 n = normalize(vNormalW);
    vec3 view = normalize(cameraPosition - vWorld);
    float down = vUv.y * fallLength; // units down the fall
    float speed = veil > 0.5 ? ${(FLOW_SPEED * 1.35).toFixed(2)} : ${FLOW_SPEED.toFixed(2)};
    float flow = down - time * speed;
    float churn = smoothstep(0.6, 1.0, vUv.y); // more white water toward the bottom

    // Streaks stretched down the fall.
    float a = vAcross * 1.3 + (veil > 0.5 ? 17.0 : 0.0);
    float streak = snoise(vec2(a, flow * 0.22)) * 0.65 + snoise(vec2(a * 2.4 + 3.0, flow * 0.5)) * 0.35;

    if (veil > 0.5) {
      // Only the brightest streaks, as loose foam sheeting off the surface.
      float foam = aastep(0.5 - churn * 0.35, streak);
      if (foam < 0.5) discard;
      gl_FragColor = vec4(atmosphere(foamColor, vWorld), 0.85);
      #include <colorspace_fragment>
      return;
    }

    // Toon-shaded body: lit side, shadow side, darker toward the silhouette.
    float lit = aastep(-0.1, dot(n, atmoLightDir));
    vec3 col = mix(mix(deepColor, deepShade, 0.35), mix(deepColor, lightColor, 0.7), lit);
    float rim = 1.0 - abs(dot(n, view));
    col = mix(col, deepShade, smoothstep(0.55, 0.95, rim) * 0.55);
    col = mix(col, lightColor, aastep(0.05 - churn * 0.4, streak) * 0.8);
    col = mix(col, foamColor, aastep(0.4 - churn * 0.55, streak));
    // A white lip where it pours over the ledge.
    float lip = 0.05 + 0.015 * snoise(vec2(vAcross * 2.0, time * 2.0));
    col = mix(col, foamColor, 1.0 - aastep(lip, vUv.y));

    gl_FragColor = vec4(atmosphere(col, vWorld), 1.0);
    #include <colorspace_fragment>
  }
`;

function buildFall(world, grow = 1) {
  const { x, topZ, bottomZ, topWidth, bottomWidth, topDepth, bottomDepth } = WATERFALL;
  const ground = (px, pz) => world.getGroundHeight(px, pz);
  const top = ground(x, topZ) + 0.6;
  const bottom = WATER_SURFACE_Y - 0.8; // ends under the surface, so there's no seam
  const start = -0.12; // starts a little back inside the ledge, so its end is hidden

  // The arc: water leaving the ledge keeps going forward while it falls.
  const centre = [];
  for (let r = 0; r <= ALONG; r++) {
    const s = start + (1 - start) * (r / ALONG);
    const drop = Math.max(s, 0) ** 2;
    centre.push(new THREE.Vector3(x, top - (top - bottom) * drop, topZ + (bottomZ - topZ) * s));
  }
  const distances = [0];
  for (let r = 1; r <= ALONG; r++) distances.push(distances[r - 1] + centre[r].distanceTo(centre[r - 1]));
  const total = distances[ALONG];

  const across = new THREE.Vector3(1, 0, 0);
  const tangent = new THREE.Vector3();
  const out = new THREE.Vector3();
  const offset = new THREE.Vector3();
  const normal = new THREE.Vector3();
  const positions = [];
  const normals = [];
  const uvs = [];
  const acrossUnits = [];
  for (let r = 0; r <= ALONG; r++) {
    const s = Math.max(0, start + (1 - start) * (r / ALONG));
    tangent.subVectors(centre[Math.min(r + 1, ALONG)], centre[Math.max(r - 1, 0)]).normalize();
    out.crossVectors(tangent, across).normalize(); // out of the front of the curtain
    const halfWidth = ((topWidth + (bottomWidth - topWidth) * s) / 2) * grow;
    const halfDepth = ((topDepth + (bottomDepth - topDepth) * s) / 2) * grow;
    for (let k = 0; k <= AROUND; k++) {
      const angle = (k / AROUND) * Math.PI * 2;
      const c = Math.cos(angle);
      const sn = Math.sin(angle);
      offset.copy(across).multiplyScalar(halfWidth * c).addScaledVector(out, halfDepth * sn);
      const p = offset.add(centre[r]);
      if (s > 0 && s < 0.9) p.y = Math.max(p.y, ground(p.x, p.z) + 0.3); // never inside the slope
      positions.push(p.x, p.y, p.z);
      normal.copy(across).multiplyScalar(c / halfWidth).addScaledVector(out, sn / halfDepth).normalize();
      normals.push(normal.x, normal.y, normal.z);
      uvs.push(k / AROUND, distances[r] / total);
      acrossUnits.push(halfWidth * c);
    }
  }
  const indices = [];
  for (let r = 0; r < ALONG; r++) {
    for (let k = 0; k < AROUND; k++) {
      const a = r * (AROUND + 1) + k;
      const b = a + AROUND + 1;
      indices.push(a, a + 1, b, a + 1, b + 1, b);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setAttribute("aAcross", new THREE.Float32BufferAttribute(acrossUnits, 1));
  geometry.setIndex(indices);
  geometry.computeBoundingSphere();
  return { geometry, length: total };
}

function fallMaterial(time, length, veil) {
  return new THREE.ShaderMaterial({
    uniforms: {
      ...atmosphereUniforms,
      time,
      fallLength: { value: length },
      veil: { value: veil ? 1 : 0 },
      deepColor: waterUniforms.deepColor, // the stream's colours, so it matches
      lightColor: waterUniforms.lightColor,
      foamColor: waterUniforms.foamColor,
      deepShade: waterUniforms.deepShade,
    },
    vertexShader: fallVert,
    fragmentShader: fallFrag,
    transparent: veil,
    depthWrite: !veil,
    side: THREE.DoubleSide,
    toneMapped: false,
  });
}

// ---------------------------------------------------------------------------
// Where it lands: foam patches and ripples on the water, and a churning pile of
// toon-shaded foam blobs.
// ---------------------------------------------------------------------------
const flatVert = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vWorld;
  void main() {
    vUv = uv;
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorld = world.xyz;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const foamPatchFrag = /* glsl */ `
  uniform float time;
  uniform vec3 foamColor;
  ${atmosphereGlsl}
  ${noiseGlsl}
  varying vec2 vUv;
  varying vec3 vWorld;
  void main() {
    vec2 p = vUv * 2.0 - 1.0;
    float d = length(p);
    if (d > 1.0) discard;
    vec2 w = vWorld.xz;
    // Solid near the splash, breaking into patches further out, drifting downstream.
    float n = snoise(w * 0.8 + vec2(0.0, -time * 1.4)) * 0.6
            + snoise(w * 2.0 + vec2(time * 0.7, -time * 2.0)) * 0.4;
    float foam = aastep(mix(-0.8, 0.7, d), n);
    float ring = aastep(0.86, fract(d * 3.0 - time * 0.9)) * (1.0 - d) * 0.8; // ripples
    float a = max(foam, ring) * (1.0 - smoothstep(0.82, 1.0, d));
    if (a < 0.02) discard;
    gl_FragColor = vec4(atmosphere(foamColor, vWorld), a);
    #include <colorspace_fragment>
  }
`;

const blobVert = /* glsl */ `
  attribute vec4 aSeed;
  uniform float time;
  varying vec3 vNormalW;
  varying vec3 vWorld;
  void main() {
    // Each blob swells and shrinks and bobs on its own beat, like churning foam.
    float beat = time * (2.2 + aSeed.y * 1.8) + aSeed.x * 6.2831;
    float swell = 0.78 + 0.22 * sin(beat) + 0.08 * sin(beat * 2.7 + 1.3);
    vec3 p = position * swell;
    p.y += 0.12 * sin(beat * 0.7);
    vec4 world = modelMatrix * instanceMatrix * vec4(p, 1.0);
    vWorld = world.xyz;
    vNormalW = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const blobFrag = /* glsl */ `
  uniform vec3 foamColor;
  uniform vec3 foamShade;
  ${atmosphereGlsl}
  ${noiseGlsl}
  varying vec3 vNormalW;
  varying vec3 vWorld;
  void main() {
    float lit = aastep(-0.05, dot(normalize(vNormalW), atmoLightDir));
    vec3 col = mix(foamShade, foamColor, lit);
    gl_FragColor = vec4(atmosphere(col, vWorld), 1.0);
    #include <colorspace_fragment>
  }
`;

function makeFoamPile(time, landing) {
  const { bottomWidth } = WATERFALL;
  const count = 30;
  const mesh = new THREE.InstancedMesh(
    new THREE.IcosahedronGeometry(1, 2),
    new THREE.ShaderMaterial({
      uniforms: {
        ...atmosphereUniforms,
        time,
        foamColor: waterUniforms.foamColor,
        foamShade: { value: new THREE.Color("#bfe0f5") },
      },
      vertexShader: blobVert,
      fragmentShader: blobFrag,
      toneMapped: false,
    }),
    count,
  );
  const seeds = new Float32Array(count * 4);
  const matrix = new THREE.Matrix4();
  for (let i = 0; i < count; i++) {
    const r = Math.random;
    // Across the width of the fall, bunched where it hits, a few trailing downstream.
    const trailing = i >= 22;
    const x = (r() - 0.5) * bottomWidth * (trailing ? 0.7 : 0.95);
    const z = trailing ? 1.5 + r() * 3 : (r() - 0.4) * 2;
    const size = trailing ? 0.2 + r() * 0.2 : 0.35 + r() * 0.4;
    matrix.compose(
      new THREE.Vector3(landing.x + x, landing.y + size * 0.15, landing.z + z),
      new THREE.Quaternion(),
      new THREE.Vector3(size, size * 0.75, size),
    );
    mesh.setMatrixAt(i, matrix);
    for (let k = 0; k < 4; k++) seeds[i * 4 + k] = r();
  }
  mesh.geometry.setAttribute("aSeed", new THREE.InstancedBufferAttribute(seeds, 4));
  mesh.computeBoundingSphere();
  mesh.boundingSphere.radius += 1; // they swell
  mesh.userData.toon = false;
  return mesh;
}

// ---------------------------------------------------------------------------
// Mist, spray and bubbles around the splash: instanced quads, every particle's path
// worked out in the vertex shader from its seed and the time.
// ---------------------------------------------------------------------------
const MIST = 0;
const SPRAY = 1;
const BUBBLES = 2;

const particleVert = /* glsl */ `
  attribute vec4 aSeed;
  uniform float time, kind, spread;
  uniform vec3 origin; // where the water lands
  varying vec2 vUv;
  varying float vAlpha;
  void main() {
    vUv = uv;
    vec4 s = aSeed;
    vec3 centre;
    float size;
    bool lying = false; // bubbles lie flat on the water
    float across = (s.y - 0.5) * spread; // spread along the width of the fall
    if (kind < 0.5) {
      // mist: billows out from the splash, low over the water, and fades
      float period = 2.5 + 2.0 * s.w;
      float t = fract(time / period + s.x);
      float a = s.z * 6.2831853;
      centre = origin + vec3(across, 0.4, 0.0)
             + vec3(cos(a) * 2.5 * t, 1.8 * t, abs(sin(a)) * 3.5 * t + 0.5);
      size = mix(0.8, 2.0, t);
      vAlpha = 0.18 * sin(3.14159 * t);
    } else if (kind < 1.5) {
      // spray: droplets thrown out of the splash, arcing back down
      float period = 0.7 + 0.5 * s.w;
      float t = fract(time / period + s.x);
      float tt = t * period;
      float a = s.z * 6.2831853;
      float speed = 1.0 + 2.5 * s.w;
      vec3 v = vec3(cos(a) * speed, 2.5 + 2.5 * s.w, abs(sin(a)) * speed + 0.5);
      centre = origin + vec3(across, 0.2, 0.0) + vec3(v.x * tt, v.y * tt - 4.9 * tt * tt, v.z * tt);
      size = 0.16 * (1.0 - 0.5 * t);
      vAlpha = (centre.y > origin.y - 0.1 ? 1.0 : 0.0) * (1.0 - t);
    } else {
      // bubbles: little rings floating downstream on the surface, then popping
      float period = 2.5 + 2.0 * s.w;
      float t = fract(time / period + s.x);
      centre = origin + vec3(across, 0.06, 1.0 + s.z * 2.0)
             + vec3(sin(time * 2.0 + s.x * 9.0) * 0.15, 0.0, t * 4.0);
      size = mix(0.12, 0.42, t);
      vAlpha = smoothstep(0.0, 0.1, t) * (1.0 - smoothstep(0.82, 1.0, t));
      lying = true;
    }
    vec3 world;
    if (lying) {
      world = centre + vec3(position.x, 0.0, position.y) * size;
    } else {
      vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
      vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
      world = centre + (right * position.x + up * position.y) * size;
    }
    gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
  }
`;

const particleFrag = /* glsl */ `
  uniform float kind;
  uniform vec3 atmoSceneTint;
  varying vec2 vUv;
  varying float vAlpha;
  void main() {
    float d = length(vUv * 2.0 - 1.0);
    float a;
    if (kind < 0.5) a = 1.0 - smoothstep(0.15, 1.0, d); // soft puff
    else if (kind < 1.5) a = 1.0 - smoothstep(0.5, 1.0, d); // droplet
    else a = smoothstep(0.55, 0.7, d) * (1.0 - smoothstep(0.85, 1.0, d)); // ring
    a *= vAlpha;
    if (a < 0.01) discard;
    vec3 col = vec3(0.93, 0.97, 1.0) * atmoSceneTint;
    gl_FragColor = vec4(col * a, a); // premultiplied
    #include <colorspace_fragment>
  }
`;

const quad = new THREE.PlaneGeometry(2, 2);

function makeParticles(kind, count, origin, time) {
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.index = quad.index;
  geometry.setAttribute("position", quad.attributes.position);
  geometry.setAttribute("uv", quad.attributes.uv);
  const seeds = new Float32Array(count * 4);
  for (let i = 0; i < seeds.length; i++) seeds[i] = Math.random();
  geometry.setAttribute("aSeed", new THREE.InstancedBufferAttribute(seeds, 4));
  geometry.instanceCount = count;
  const mesh = new THREE.Mesh(
    geometry,
    new THREE.ShaderMaterial({
      uniforms: {
        time,
        kind: { value: kind },
        spread: { value: WATERFALL.bottomWidth * 0.9 },
        origin: { value: origin },
        atmoSceneTint: atmosphereUniforms.atmoSceneTint,
      },
      vertexShader: particleVert,
      fragmentShader: particleFrag,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false,
      blending: THREE.CustomBlending,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
    }),
  );
  mesh.frustumCulled = false;
  mesh.renderOrder = 3;
  mesh.userData.toon = false;
  return mesh;
}

export function createWaterfall(scene, world) {
  const time = { value: 0 };
  const group = new THREE.Group();
  group.name = "waterfall";
  scene.add(group);

  const body = buildFall(world);
  const water = new THREE.Mesh(body.geometry, fallMaterial(time, body.length, false));
  const veil = new THREE.Mesh(buildFall(world, 1.1).geometry, fallMaterial(time, body.length, true));
  veil.renderOrder = 2;
  for (const mesh of [water, veil]) mesh.userData.toon = false;
  group.add(water, veil);

  // Where the water meets the stream.
  const landing = new THREE.Vector3(WATERFALL.x, WATER_SURFACE_Y, WATERFALL.bottomZ);

  const patch = new THREE.Mesh(
    new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2),
    new THREE.ShaderMaterial({
      uniforms: { ...atmosphereUniforms, time, foamColor: waterUniforms.foamColor },
      vertexShader: flatVert,
      fragmentShader: foamPatchFrag,
      transparent: true,
      depthWrite: false,
      toneMapped: false,
    }),
  );
  // Stretched across the fall and downstream from it.
  patch.scale.set(WATERFALL.bottomWidth * 0.75, 1, WATERFALL.bottomWidth * 0.9);
  patch.position.copy(landing).add(new THREE.Vector3(0, 0.04, 2));
  patch.renderOrder = 2; // over the stream's surface (renderOrder 1)
  patch.userData.toon = false;
  group.add(patch, makeFoamPile(time, landing));

  group.add(
    makeParticles(MIST, 28, landing, time),
    makeParticles(SPRAY, 80, landing, time),
    makeParticles(BUBBLES, 40, landing, time),
  );

  return {
    update(elapsedSeconds) {
      time.value = elapsedSeconds;
    },
  };
}
