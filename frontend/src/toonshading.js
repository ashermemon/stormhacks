// toonshading.js
// One consistent cel-shaded + ink-outline style for the whole scene.
//
//   import { toonifyScene, applyToonStyle, setToonLight, toonUniforms, outlineUniforms } from './toonshading.js';
//
//   // otters: give each one its colour texture (special outline mask for the face)
//   const otter = SkeletonUtils.clone(gltf.scene);
//   applyToonStyle(otter, 'models/textures/Otter_Green.png');
//   scene.add(otter);
//
//   // everything else (props, terrain, buildings...): one call, any time after loading
//   toonifyScene(scene);
//
// What toonifyScene does to each mesh:
//   - swaps Standard / Physical / Phong / Lambert / Toon materials for the toon shader,
//     keeping the material's colour, texture, vertex colours, emissive and transparency
//   - adds an ink outline (inverted hull) with the same on-screen thickness everywhere
//   - leaves MeshBasicMaterial and custom ShaderMaterials alone (UI, skyboxes, effects)
//
// Per-object opt-outs:
//   mesh.userData.toon = false        -> skip this mesh entirely
//   mesh.userData.noOutline = true    -> toon shading but no outline (good for big floors)
//
// The shading uses its own light direction (setToonLight), so the scene looks the
// same regardless of the lights you add. Lights don't need to be removed; they're ignored.

import * as THREE from "three";

// ---------------------------------------------------------------------------
// Shared settings: tweak once, every toon material in the scene updates.
// ---------------------------------------------------------------------------
export const toonUniforms = {
  lightDir: { value: new THREE.Vector3(0.5, 1.0, 0.8).normalize() }, // world space, toward the light
  shadowTint: { value: new THREE.Color(0.78, 0.66, 0.62) }, // multiplies colour in shadow
  threshold: { value: -0.1 }, // -1..1, higher = more of each object in shadow
  softness: { value: 0.02 }, // shadow edge softness (0 = razor sharp)
};

export const outlineUniforms = {
  thickness: { value: 3.0 }, // in pixels at 1080p (scales with screen size)
  color: { value: new THREE.Color("#3c220e") }, // dark brown ink
  depthPush: { value: 0.06 }, // world units the outline sits behind the surface;
  // raise if stray lines show in creases, lower if
  // outlines vanish where objects touch
};

export function setToonLight(x, y, z) {
  toonUniforms.lightDir.value.set(x, y, z).normalize();
}

// ---------------------------------------------------------------------------
// Toon surface shader (works on static, skinned and instanced meshes)
// ---------------------------------------------------------------------------
const toonVert = /* glsl */ `
  #include <common>
  #include <color_pars_vertex>
  #include <skinning_pars_vertex>
  varying vec2 vUv;
  varying vec3 vNormalW;
  void main() {
    vUv = uv;
    #include <color_vertex>
    #include <beginnormal_vertex>
    #include <skinbase_vertex>
    #include <skinnormal_vertex>
    #ifdef USE_INSTANCING
      objectNormal = mat3(instanceMatrix) * objectNormal;
    #endif
    #include <begin_vertex>
    #include <skinning_vertex>
    #include <project_vertex>
    vNormalW = normalize(mat3(modelMatrix) * objectNormal);
  }
`;

const toonFrag = /* glsl */ `
  uniform vec3 diffuse;
  uniform vec3 emissive;
  uniform float opacity;
  #ifdef USE_MAP
    uniform sampler2D map;
  #endif
  uniform vec3 lightDir;
  uniform vec3 shadowTint;
  uniform float threshold;
  uniform float softness;
  #include <color_pars_fragment>
  varying vec2 vUv;
  varying vec3 vNormalW;
  void main() {
    vec4 base = vec4(diffuse, opacity);
    #ifdef USE_MAP
      base *= texture2D(map, vUv);
    #endif
    #if defined(USE_COLOR) || defined(USE_COLOR_ALPHA)
      base.rgb *= vColor.rgb;
    #endif
    vec3 n = normalize(vNormalW);
    if (!gl_FrontFacing) n = -n;               // correct shading on double-sided faces
    float lit = smoothstep(threshold - softness, threshold + softness, dot(n, lightDir));
    gl_FragColor = vec4(mix(base.rgb * shadowTint, base.rgb, lit) + emissive, base.a);
    #include <colorspace_fragment>
  }
`;

function makeToonMaterial({
  map = null,
  color = new THREE.Color(1, 1, 1),
  emissive = new THREE.Color(0, 0, 0),
  opacity = 1,
  transparent = false,
  side = THREE.FrontSide,
  vertexColors = false,
} = {}) {
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      diffuse: { value: color.clone() },
      emissive: { value: emissive.clone() },
      opacity: { value: opacity },
      map: { value: map },
      ...toonUniforms, // shared objects, so tweaking toonUniforms updates everything
    },
    defines: map ? { USE_MAP: "" } : {},
    vertexShader: toonVert,
    fragmentShader: toonFrag,
    transparent,
    side,
    vertexColors,
    toneMapped: false, // keep flat colours exact
  });
  mat.userData.isToon = true;
  return mat;
}

// ---------------------------------------------------------------------------
// Outline shader: inverted hull pushed out in screen space, so line weight is
// the same on every object no matter its size or distance.
// ---------------------------------------------------------------------------
const outlineVert = /* glsl */ `
  #include <common>
  #include <skinning_pars_vertex>
  attribute vec3 outlineNormal;          // smoothed normals, so hard-edged props don't crack open
  uniform float thickness;
  uniform float depthPush;
  void main() {
    float w = 1.0;
    #ifdef OTTER_MASK
      // otter face details (eyes, nose, mouth, blush) sit at u > 0.91 in its UV layout: no outline
      if (uv.x > 0.91) w = 0.0;
      // thinner outline across the front of the face so it never crowds the features
      float face = clamp((position.z - 0.16) / 0.08, 0.0, 1.0)
                 * clamp((position.y - 0.80) / 0.04, 0.0, 1.0)
                 * clamp((0.34 - abs(position.x)) / 0.05, 0.0, 1.0);
      w *= 1.0 - 0.7 * face;
    #endif

    vec3 objectNormal = outlineNormal;
    #include <skinbase_vertex>
    #include <skinnormal_vertex>
    #ifdef USE_INSTANCING
      objectNormal = mat3(instanceMatrix) * objectNormal;
    #endif
    #include <begin_vertex>
    #include <skinning_vertex>
    #include <project_vertex>

    // Shove the hull away from the camera so it can only show past the silhouette,
    // never through creases (armpits, ear bumps, where parts meet).
    vec3 away = isOrthographic ? vec3(0.0, 0.0, -1.0) : normalize(mvPosition.xyz);
    gl_Position = projectionMatrix * vec4(mvPosition.xyz + away * depthPush, 1.0);

    vec2 dir = (normalMatrix * objectNormal).xy;
    float len = length(dir);
    dir = len > 1e-4 ? dir / len : vec2(0.0);
    float aspectFix = projectionMatrix[0][0] / projectionMatrix[1][1];
    gl_Position.xy += dir * vec2(aspectFix, 1.0) * (thickness * 2.0 / 1080.0) * gl_Position.w * w;
  }
`;

const outlineFrag = /* glsl */ `
  uniform vec3 color;
  void main() {
    gl_FragColor = vec4(color, 1.0);
    #include <colorspace_fragment>
  }
`;

function makeOutlineMaterial(defines = {}) {
  return new THREE.ShaderMaterial({
    uniforms: { ...outlineUniforms },
    defines,
    vertexShader: outlineVert,
    fragmentShader: outlineFrag,
    side: THREE.BackSide,
    toneMapped: false,
  });
}

export const outlineMaterial = makeOutlineMaterial();
const otterOutlineMaterial = makeOutlineMaterial({ OTTER_MASK: "" });

// Averages normals of vertices that share a position (UV seams, hard edges),
// so the hull expands as one closed shell instead of splitting at corners.
function ensureOutlineNormals(geometry) {
  if (geometry.attributes.outlineNormal) return;
  if (!geometry.attributes.normal) geometry.computeVertexNormals();
  const pos = geometry.attributes.position,
    nor = geometry.attributes.normal;
  const sums = new Map(),
    keys = new Array(pos.count);
  for (let i = 0; i < pos.count; i++) {
    const k = `${Math.round(pos.getX(i) * 1e4)},${Math.round(pos.getY(i) * 1e4)},${Math.round(pos.getZ(i) * 1e4)}`;
    keys[i] = k;
    const s = sums.get(k) || [0, 0, 0];
    s[0] += nor.getX(i);
    s[1] += nor.getY(i);
    s[2] += nor.getZ(i);
    sums.set(k, s);
  }
  const out = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const s = sums.get(keys[i]);
    const l = Math.hypot(s[0], s[1], s[2]) || 1;
    out[i * 3] = s[0] / l;
    out[i * 3 + 1] = s[1] / l;
    out[i * 3 + 2] = s[2] / l;
  }
  geometry.setAttribute("outlineNormal", new THREE.BufferAttribute(out, 3));
}

// Draws the mesh a second time with the outline material (no extra objects).
function addOutlinePass(mesh, outlineMat) {
  const g = mesh.geometry;
  ensureOutlineNormals(g);
  const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  const outlineIndex = mats.length;
  if (g.userData.toonOutlineIndex === undefined) {
    // geometry may be shared by clones: set up once
    if (g.groups.length === 0) {
      const count = g.index ? g.index.count : g.attributes.position.count;
      g.addGroup(0, count, 0);
    }
    const original = g.groups.slice();
    for (const grp of original) g.addGroup(grp.start, grp.count, outlineIndex);
    g.userData.toonOutlineIndex = outlineIndex;
  }
  mesh.material = [...mats, outlineMat];
}

// ---------------------------------------------------------------------------
// Converting existing materials
// ---------------------------------------------------------------------------
const convertCache = new Map();

function toToon(src) {
  if (!src) return null;
  if (src.userData && src.userData.isToon) return src;
  const convertible =
    src.isMeshStandardMaterial ||
    src.isMeshPhysicalMaterial ||
    src.isMeshPhongMaterial ||
    src.isMeshLambertMaterial ||
    src.isMeshToonMaterial;
  if (!convertible) return null;
  if (convertCache.has(src.uuid)) return convertCache.get(src.uuid);
  const mat = makeToonMaterial({
    map: src.map || null,
    color: src.color || new THREE.Color(1, 1, 1),
    emissive: src.emissive
      ? src.emissive.clone().multiplyScalar(src.emissiveIntensity ?? 1)
      : undefined,
    opacity: src.opacity,
    transparent: src.transparent,
    side: src.side,
    vertexColors: src.vertexColors,
  });
  mat.name = `${src.name || "material"} (toon)`;
  convertCache.set(src.uuid, mat);
  return mat;
}

export function toonifyScene(root) {
  root.traverse((o) => {
    if (!o.isMesh || o.userData.toon === false || o.userData._toonified) return;
    const list = Array.isArray(o.material) ? o.material : [o.material];
    const converted = list.map(toToon);
    if (converted.some((m) => m === null)) return; // unsupported material: leave the mesh as it is
    o.material = Array.isArray(o.material) ? converted : converted[0];
    const transparent = converted.some((m) => m.transparent);
    if (!o.userData.noOutline && !transparent)
      addOutlinePass(o, outlineMaterial);
    o.userData._toonified = true;
  });
  return root;
}

// ---------------------------------------------------------------------------
// Otters: colour texture + otter-specific outline mask
// ---------------------------------------------------------------------------
const texLoader = new THREE.TextureLoader();
const otterMats = new Map();

function otterMaterial(textureOrUrl) {
  const key = textureOrUrl.isTexture ? textureOrUrl.uuid : textureOrUrl;
  if (otterMats.has(key)) return otterMats.get(key);
  let map = textureOrUrl;
  if (!map.isTexture) {
    map = texLoader.load(textureOrUrl);
    map.flipY = false; // glTF UV convention
    map.colorSpace = THREE.SRGBColorSpace;
    map.anisotropy = 4;
  }
  const mat = makeToonMaterial({ map });
  otterMats.set(key, mat);
  return mat;
}

export function applyToonStyle(otterRoot, textureOrUrl) {
  const mat = otterMaterial(textureOrUrl);
  otterRoot.traverse((o) => {
    if (!o.isMesh) return;
    o.material = mat;
    addOutlinePass(o, otterOutlineMaterial);
    o.userData._toonified = true; // toonifyScene will leave it alone
  });
  return otterRoot;
}
