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
//   mesh.userData.noOutline = true    -> toon shading but no outline
//   mesh.userData.outline = "contour" -> outline without the silhouette stencil, so
//                                        it also draws where the mesh overlaps itself
//                                        (hill in front of hill); for terrain
//
// Per-material extras (set on the source material before toonifying):
//   material.alphaTest > 0            -> cut-out leaves/petals (kept from glTF alphaMode MASK)
//   material.userData.keepNormals     -> back faces use the front normal instead of flipping
//                                        it (grass/leaf cards whose normals are authored to
//                                        shade as one soft volume)
//   material.userData.wind = 0.1      -> sways in the wind; the number is how far (world
//                                        units) a vertex 1 unit above the model's base moves.
//                                        Drive it with updateWind(elapsedSeconds).
//
// The shading uses its own light direction (setToonLight), so the scene looks the
// same regardless of the lights you add. Lights don't need to be removed; they're ignored.

import * as THREE from "three";
import { atmosphereGlsl, atmosphereUniforms } from "./atmosphere.js";

// World position of the vertex, for the distance haze (atmosphere.js).
const atmoWorldVertex = /* glsl */ `
    vec4 atmoWorld = vec4(transformed, 1.0);
    #ifdef USE_INSTANCING
      atmoWorld = instanceMatrix * atmoWorld;
    #endif
    vAtmoWorld = (modelMatrix * atmoWorld).xyz;
`;

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

// Terrain contour lines (meshes tagged userData.outline = "contour"): same ink colour,
// but thinner and pushed further back so gentle ground bumps don't draw scribbles —
// only ridges, hill crests and the skyline do.
export const contourOutlineUniforms = {
  thickness: { value: 2.0 },
  depthPush: { value: 0.6 },
};

export function setToonLight(x, y, z) {
  toonUniforms.lightDir.value.set(x, y, z).normalize();
}

export const windUniforms = {
  windTime: { value: 0 },
  windDir: { value: new THREE.Vector2(0.8, 0.6).normalize() }, // world xz the gusts push toward
};

export function updateWind(elapsedSeconds) {
  windUniforms.windTime.value = elapsedSeconds;
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
  varying vec3 vAtmoWorld;
  #ifdef WIND_STRENGTH
    uniform float windTime;
    uniform vec2 windDir;
  #endif
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
    #ifdef WIND_STRENGTH
      // Bend grows with height above the model's base, so roots stay planted. The phase
      // runs across the world, so gusts roll over a meadow instead of every blade in sync.
      vec4 worldPos = vec4(transformed, 1.0);
      #ifdef USE_INSTANCING
        worldPos = instanceMatrix * worldPos;
      #endif
      worldPos = modelMatrix * worldPos;
      float height = max(transformed.y, 0.0);
      float phase = windTime * 1.6 + worldPos.x * 0.35 + worldPos.z * 0.22;
      float gust = sin(phase) * 0.6 + sin(phase * 2.3 + 1.7) * 0.25 + 0.35;
      worldPos.xz += windDir * gust * WIND_STRENGTH * height * height;
      vec4 mvPosition = viewMatrix * worldPos;
      gl_Position = projectionMatrix * mvPosition;
    #else
      #include <project_vertex>
    #endif
    #ifdef CLIP_BELOW_Y
      vWorldY = (modelMatrix * vec4(transformed, 1.0)).y;
    #endif
    ${atmoWorldVertex}
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
  ${atmosphereGlsl}
  varying vec3 vAtmoWorld;
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
    #ifdef ALPHA_CUTOFF
      if (base.a < ALPHA_CUTOFF) discard;
      base.a = 1.0; // what survives the cut is solid; a soft alpha would blend with the page
    #endif
    vec3 n = normalize(vNormalW);
    #ifndef KEEP_NORMALS
      if (!gl_FrontFacing) n = -n;             // correct shading on double-sided faces
    #endif
    float lit = smoothstep(threshold - softness, threshold + softness, dot(n, lightDir));
    vec3 shaded = mix(base.rgb * shadowTint, base.rgb, lit) + emissive;
    gl_FragColor = vec4(atmosphere(shaded, vAtmoWorld), base.a);
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
  alphaTest = 0,
  wind = 0,
  keepNormals = false,
} = {}) {
  const defines = {};
  if (map) defines.USE_MAP = "";
  if (alphaTest > 0) defines.ALPHA_CUTOFF = alphaTest.toFixed(4);
  if (wind > 0) defines.WIND_STRENGTH = wind.toFixed(4);
  if (keepNormals) defines.KEEP_NORMALS = "";
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      diffuse: { value: color.clone() },
      emissive: { value: emissive.clone() },
      opacity: { value: opacity },
      map: { value: map },
      ...toonUniforms, // shared objects, so tweaking toonUniforms updates everything
      ...atmosphereUniforms,
      ...(wind > 0 ? windUniforms : {}),
    },
    defines,
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
  #ifdef CLIP_BELOW_Y
    varying float vWorldY;
  #endif
  uniform float depthPush;
  varying vec3 vAtmoWorld;
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
    ${atmoWorldVertex}

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
  ${atmosphereGlsl}
  varying vec3 vAtmoWorld;
  #ifdef CLIP_BELOW_Y
    varying float vWorldY;
  #endif
  void main() {
    #ifdef CLIP_BELOW_Y
      if (vWorldY < CLIP_BELOW_Y) discard; // no ink under the water surface
    #endif
    gl_FragColor = vec4(atmosphere(color, vAtmoWorld), 1.0); // far ink fades into the haze
    #include <colorspace_fragment>
  }
`;

// Scenery and terrain outlines stop at the water surface (y = 0): seen through the
// water, the bed's and caves' ink lines just read as clutter. Otters keep theirs.
const UNDERWATER_CLIP = { CLIP_BELOW_Y: "-0.02" };

function makeOutlineMaterial(defines = {}) {
  return new THREE.ShaderMaterial({
    uniforms: { ...outlineUniforms, ...atmosphereUniforms },
    defines,
    vertexShader: outlineVert,
    fragmentShader: outlineFrag,
    side: THREE.BackSide,
    toneMapped: false,
  });
}

export const outlineMaterial = makeOutlineMaterial();

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
// Silhouette-only outlines. A plain inverted hull also draws lines wherever one
// part of an object overlaps another (head on body, trunk into crown...). Each
// object stamps its own stencil value where it's drawn, and its outline is only
// drawn where that value isn't, i.e. outside its own silhouette. Different
// objects get different values, so outlines still separate overlapping objects.
// Needs a renderer created with { stencil: true }.
// ---------------------------------------------------------------------------
let nextStencilRef = 1;

function takeStencilRef() {
  const ref = nextStencilRef;
  nextStencilRef = (nextStencilRef % 255) + 1;
  return ref;
}

function stampStencil(mat, ref) {
  mat.stencilWrite = true;
  mat.stencilRef = ref;
  mat.stencilFunc = THREE.AlwaysStencilFunc;
  mat.stencilZPass = THREE.ReplaceStencilOp;
  return mat;
}

function silhouetteOutline(mat, ref) {
  mat.stencilWrite = true; // enables the stencil test; the ops keep the buffer as is
  mat.stencilRef = ref;
  mat.stencilFunc = THREE.NotEqualStencilFunc;
  mat.stencilFail = THREE.KeepStencilOp;
  mat.stencilZFail = THREE.KeepStencilOp;
  mat.stencilZPass = THREE.KeepStencilOp;
  return mat;
}

// ---------------------------------------------------------------------------
// Converting existing materials
// ---------------------------------------------------------------------------
const convertCache = new Map();

function canToon(src) {
  return Boolean(
    src &&
      (src.userData?.isToon ||
        src.isMeshStandardMaterial ||
        src.isMeshPhysicalMaterial ||
        src.isMeshPhongMaterial ||
        src.isMeshLambertMaterial ||
        src.isMeshToonMaterial),
  );
}

function toToon(src, stencilRef = 0) {
  if (!canToon(src)) return null;
  if (src.userData.isToon) return src;
  const key = `${src.uuid}:${stencilRef}`;
  if (convertCache.has(key)) return convertCache.get(key);
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
    alphaTest: src.alphaTest,
    wind: src.userData.wind ?? 0,
    keepNormals: Boolean(src.userData.keepNormals),
  });
  mat.name = `${src.name || "material"} (toon)`;
  if (stencilRef) stampStencil(mat, stencilRef);
  convertCache.set(key, mat);
  return mat;
}

// The child of `root` that `o` belongs to, e.g. a tree group for its trunk mesh.
function topLevelObject(root, o) {
  while (o.parent && o.parent !== root) o = o.parent;
  return o;
}

export function toonifyScene(root) {
  // Pass 1: convert materials. Outlined meshes get their top-level object's stencil
  // value, so e.g. a tree's trunk and crown share one silhouette.
  const groups = new Map(); // top-level object -> { ref, meshes }
  const contours = [];
  root.traverse((o) => {
    if (!o.isMesh || o.userData.toon === false || o.userData._toonified) return;
    const list = Array.isArray(o.material) ? o.material : [o.material];
    if (!list.every(canToon)) return; // unsupported material: leave the mesh as it is
    const transparent = list.some((m) => m.transparent);
    const outlined = !o.userData.noOutline && !transparent;

    let group = null;
    if (outlined && o.userData.outline === "contour") {
      contours.push(o);
    } else if (outlined) {
      const top = topLevelObject(root, o);
      group = groups.get(top);
      if (!group) {
        group = { ref: takeStencilRef(), meshes: [] };
        groups.set(top, group);
      }
      group.meshes.push(o);
    }
    const converted = list.map((m) => toToon(m, group?.ref));
    o.material = Array.isArray(o.material) ? converted : converted[0];
    o.userData._toonified = true;
  });

  // Pass 2: outlines. Created after every body material on purpose: three draws
  // opaque materials in id order, so bodies stamp the stencil before outlines test it.
  for (const { ref, meshes } of groups.values()) {
    const outline = silhouetteOutline(makeOutlineMaterial(UNDERWATER_CLIP), ref);
    for (const mesh of meshes) addOutlinePass(mesh, outline);
  }
  if (contours.length) {
    const contour = makeOutlineMaterial(UNDERWATER_CLIP);
    Object.assign(contour.uniforms, contourOutlineUniforms);
    for (const mesh of contours) addOutlinePass(mesh, contour);
  }
  return root;
}

// ---------------------------------------------------------------------------
// Otters: colour texture + otter-specific outline mask
// ---------------------------------------------------------------------------
const texLoader = new THREE.TextureLoader();
const otterMaps = new Map();

function otterMap(textureOrUrl) {
  if (textureOrUrl.isTexture) return textureOrUrl;
  if (!otterMaps.has(textureOrUrl)) {
    const map = texLoader.load(textureOrUrl);
    map.flipY = false; // glTF UV convention
    map.colorSpace = THREE.SRGBColorSpace;
    map.anisotropy = 4;
    otterMaps.set(textureOrUrl, map);
  }
  return otterMaps.get(textureOrUrl);
}

export function applyToonStyle(otterRoot, textureOrUrl) {
  const ref = takeStencilRef();
  const mat = stampStencil(makeToonMaterial({ map: otterMap(textureOrUrl) }), ref);
  // Created after `mat` on purpose: three draws opaque materials in id order, so
  // the body stamps the stencil before its outline tests it.
  const outline = silhouetteOutline(makeOutlineMaterial({ OTTER_MASK: "" }), ref);

  otterRoot.traverse((o) => {
    if (!o.isMesh) return;
    o.material = mat;
    addOutlinePass(o, outline);
    o.userData._toonified = true; // toonifyScene will leave it alone
  });
  return otterRoot;
}
