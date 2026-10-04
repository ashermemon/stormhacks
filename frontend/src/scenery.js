import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { WATER_SURFACE_Y } from "./world.js";
import { zoneOf, GRASS, SHORE, ROCK, SNOW } from "./terrainTexture.js";
import { seededRandom } from "./trinkets/spawnZones.js";

// Dresses World.glb with the nature kit in assets/models/world/environment: a grass
// blanket over the meadow, flower patches, groves, bushes and boulders, pines on the
// foothills, reeds along the banks and swaying seaweed on the stream and pond beds.
//
// Placement reads the terrain's painted zones (meadow green, shore sand, mountain rock,
// snow) plus the heightmap, so the props always match the ground under them. It is
// seeded, so every player sees the same world. Everything is instanced in map chunks;
// update(camera) thins out the small stuff with distance.

const MODEL_URLS = urlsByName(
  import.meta.glob("../assets/models/world/environment/*.gltf", {
    query: "?url",
    import: "default",
    eager: true,
  }),
);
// The .gltf files point at these by bare file name. Normal maps aren't used by the
// toon shader, so they're left out of the build and never downloaded.
const RESOURCE_URLS = urlsByName(
  import.meta.glob(
    ["../assets/models/world/environment/*.{bin,png}", "!**/*_Normal.png"],
    { query: "?url", import: "default", eager: true },
  ),
);
const BLANK_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==";

const SEED = 20261003;
const MOBILE = window.matchMedia("(pointer: coarse)").matches;
const LOD_RANGE = MOBILE ? 0.6 : 1; // phones draw the small stuff over a shorter range
const MAX_WALK_HEIGHT = 4.5; // obstacles only matter where the otter can walk
const VIEW_LIMIT = 170; // past the fog (environment.js), nothing needs drawing

// How each kind of prop is drawn. cell: chunk size (smaller = finer culling).
// Within `near` every instance draws; it thins to `minFrac` at `far`, then hides.
const KINDS = {
  meadowGrass: { model: "Grass_Wispy_Short", cell: 12, near: 16, far: 58, minFrac: 0.12 },
  tallGrass: { model: "Grass_Common_Tall", cell: 16, near: 25, far: 80, minFrac: 0.2 },
  shortGrass: { model: "Grass_Common_Short", cell: 16, near: 20, far: 60, minFrac: 0.2 },
  reeds: { model: "Grass_Common_Tall", cell: 16, near: 30, far: 90, minFrac: 0.3 },
  seaweed: { model: "Grass_Common_Tall", material: "seaweed", cell: 16, near: 25, far: 60, minFrac: 0.3 },
  seaGrass: { model: "Grass_Common_Short", material: "seaweed", cell: 16, near: 20, far: 50, minFrac: 0.3 },
  flowers3: { model: "Flower_3_Group", cell: 16, near: 25, far: 80, minFrac: 0.25 },
  flowers4: { model: "Flower_4_Group", cell: 16, near: 25, far: 80, minFrac: 0.25 },
  bush: { model: "Bush_Common_Flowers", cell: 24, near: 50, far: 140, minFrac: 0.5 },
  tree1: { model: "CommonTree_1", outline: true, cell: 32 },
  tree2: { model: "CommonTree_2", outline: true, cell: 32 },
  tree3: { model: "CommonTree_3", outline: true, cell: 32 },
  pine: { model: "Pine_1", outline: true, cell: 32 },
  twistedTree: { model: "TwistedTree_2", outline: true, cell: 32 },
  rock: { model: "Rock_Medium_2", outline: true, cell: 32 },
  pebble1: { model: "Pebble_Round_1", outline: true, cell: 16, near: 18, far: 45, minFrac: 0.3 },
  pebble2: { model: "Pebble_Round_2", outline: true, cell: 16, near: 18, far: 45, minFrac: 0.3 },
  pebble4: { model: "Pebble_Round_4", outline: true, cell: 16, near: 18, far: 45, minFrac: 0.3 },
};
const COMMON_TREES = ["tree1", "tree2", "tree3"];
const PEBBLES = ["pebble1", "pebble2", "pebble4"];

// Foliage materials (by glTF material name) and how much they sway. They all keep their
// authored normals on back faces, so leaf and blade cards shade as one soft volume.
const FOLIAGE = {
  Grass: { wind: 0.1 },
  Leaves: { wind: 0.05 },
  Flowers: { wind: 0.05 },
  Leaves_NormalTree: { wind: 0.0025 },
  Leaves_Pine: { wind: 0.002 },
  Leaves_TwistedTree: { wind: 0.0006 },
};

// Instance colours. Grass tips are a shade brighter than the two painted meadow greens
// they grow from, so the blanket reads as part of the ground.
const GRASS_LIGHT = new THREE.Color("#86c86a");
const GRASS_DARK = new THREE.Color("#72b65e");
const REED_COLOR = new THREE.Color("#b3c46a");
const SEAWEED_COLOR = new THREE.Color("#3f9a74");
const SEA_GRASS_COLOR = new THREE.Color("#5fae6c");
const ROCK_TINT = new THREE.Color(1.15, 1.17, 1.3); // lifts the dark kit rock toward the painted grey
// Leaf textures are a flat olive; these (linear) multipliers freshen them toward the
// meadow's greens. The twisted landmark trees turn a warm autumn orange.
const leafGreen = (range) => new THREE.Color(range(0.8, 1.15), range(1.25, 1.45), 1);
const PINE_TINT = new THREE.Color(0.95, 1.15, 1);
const LANDMARK_LEAVES = new THREE.Color(1.1, 9, 4);
const WHITE = new THREE.Color(1, 1, 1);

/**
 * @param scene   the scene to add the props to (call before toonifyScene)
 * @param world   what loadWorld returned
 * @param clearings  [{x, z, r}] spots kept free of trees and rocks (e.g. the spawn)
 */
export async function createScenery(scene, world, { clearings = [] } = {}) {
  const models = await loadModels();
  const field = buildField(world);
  const scatter = new Scatter(models, field);
  placeEverything(scatter, field, world, clearings);
  const chunks = scatter.build(scene);

  const cam = new THREE.Vector3();
  return {
    update(camera) {
      camera.getWorldPosition(cam);
      for (const chunk of chunks) {
        const dx = Math.max(Math.abs(cam.x - chunk.cx) - chunk.half, 0);
        const dz = Math.max(Math.abs(cam.z - chunk.cz) - chunk.half, 0);
        const d = Math.hypot(dx, dz);
        const { near, far, minFrac } = chunk.lod;
        let frac = 1;
        if (d >= far) frac = 0;
        else if (d > near) frac = minFrac + (1 - minFrac) * (1 - (d - near) / (far - near));
        const count = Math.ceil(chunk.size * frac);
        chunk.group.visible = count > 0;
        for (const mesh of chunk.meshes) mesh.count = count;
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Models
// ---------------------------------------------------------------------------
function urlsByName(modules) {
  const out = {};
  for (const [path, url] of Object.entries(modules)) out[path.split("/").pop()] = url;
  return out;
}

async function loadModels() {
  const manager = new THREE.LoadingManager();
  // Match on the file name alone: in a build the small .gltf files are inlined as data
  // URLs, so their resources resolve to "data:...base64.../Grass.png".
  manager.setURLModifier((url) => {
    const name = url.split("/").pop().split("?")[0];
    if (RESOURCE_URLS[name]) return RESOURCE_URLS[name];
    if (name.endsWith("_Normal.png")) return BLANK_PNG;
    return url;
  });
  const loader = new GLTFLoader(manager);
  const materials = new Map(); // shared by name, so each texture is uploaded once

  const models = {};
  await Promise.all(
    Object.entries(MODEL_URLS).map(async ([file, url]) => {
      const gltf = await loader.loadAsync(url);
      gltf.scene.updateMatrixWorld(true);
      const parts = [];
      gltf.scene.traverse((o) => {
        if (!o.isMesh) return;
        let material = o.material;
        if (!materials.has(material.name)) materials.set(material.name, material);
        material = materials.get(material.name);
        const geometry = o.geometry.clone().applyMatrix4(o.matrixWorld);
        parts.push({ geometry, material });
      });
      models[file.replace(".gltf", "")] = { parts };
    }),
  );

  for (const material of materials.values()) {
    const foliage = FOLIAGE[material.name];
    if (!foliage) continue;
    material.userData.wind = foliage.wind;
    material.userData.keepNormals = true;
    if (material.alphaTest > 0 && material.map) material.map = bleedCutoutTexture(material.map);
  }

  // Canopies: shade each one darker toward its underside, so it reads as a volume
  // rather than a flat cut-out.
  for (const model of Object.values(models)) {
    for (const { geometry, material } of model.parts) {
      if (!material.name.startsWith("Leave") && !material.name.startsWith("Leaf")) continue;
      geometry.computeBoundingBox();
      const { min, max } = geometry.boundingBox;
      const pos = geometry.attributes.position;
      const color = geometry.attributes.color;
      if (!color) continue;
      for (let i = 0; i < pos.count; i++) {
        const t = (pos.getY(i) - min.y) / Math.max(max.y - min.y, 1e-3);
        const shade = 0.6 + 0.4 * Math.sqrt(t);
        for (let c = 0; c < 3; c++) color.setComponent(i, c, color.getComponent(i, c) * shade);
      }
    }
  }

  // Grass: drop the kit's colour-strip texture and shade each clump from its instance
  // colour instead (picked to match the painted ground), darkening toward the root with
  // the baked AO. Normals all point up, so it lights like the ground it grows from.
  const grass = materials.get("Grass");
  grass.map = null;
  for (const model of Object.values(models)) {
    for (const { geometry, material } of model.parts) {
      if (material !== grass) continue;
      const color = geometry.attributes.color;
      for (let i = 0; i < color.count; i++) {
        for (let c = 0; c < 3; c++) color.setComponent(i, c, 0.55 + 0.45 * color.getComponent(i, c));
      }
      const normal = geometry.attributes.normal;
      for (let i = 0; i < normal.count; i++) normal.setXYZ(i, 0, 1, 0);
    }
  }

  // Seaweed: the same grass models, swaying further.
  const seaweed = grass.clone();
  seaweed.name = "Seaweed";
  seaweed.userData = { wind: 0.16, keepNormals: true };
  models.materialOverrides = { seaweed };
  return models;
}

// The kit's cut-out textures (leaves, petals) hold unrelated colour in their see-through
// pixels (black, or white around the petals). Mipmaps and the soft edges that survive
// the alpha cut-off blend it in, giving dark or white rims. Refill every mostly
// see-through pixel with the colour of the opaque pixels around it ("push-pull":
// average down a pyramid of alpha-weighted colour, then read back the nearest level
// that has any). Also caps the texture at 1024 px.
const MAX_FOLIAGE_TEXTURE = 1024;

function bleedCutoutTexture(texture) {
  const image = texture.image;
  const scale = Math.min(1, MAX_FOLIAGE_TEXTURE / Math.max(image.width, image.height));
  const w = Math.round(image.width * scale);
  const h = Math.round(image.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(image, 0, 0, w, h);
  const px = new Uint8Array(ctx.getImageData(0, 0, w, h).data.buffer);

  // Level 0: alpha-weighted colour (r*a, g*a, b*a) and weight (a).
  const levels = [];
  let lw = w;
  let lh = h;
  let cur = new Float32Array(lw * lh * 4);
  for (let i = 0; i < lw * lh; i++) {
    const a = px[i * 4 + 3] / 255;
    cur[i * 4] = px[i * 4] * a;
    cur[i * 4 + 1] = px[i * 4 + 1] * a;
    cur[i * 4 + 2] = px[i * 4 + 2] * a;
    cur[i * 4 + 3] = a;
  }
  levels.push({ data: cur, w: lw, h: lh });
  while (lw > 1 || lh > 1) {
    const nw = Math.max(1, lw >> 1);
    const nh = Math.max(1, lh >> 1);
    const next = new Float32Array(nw * nh * 4);
    for (let y = 0; y < lh; y++) {
      const ny = Math.min(nh - 1, y >> 1);
      for (let x = 0; x < lw; x++) {
        const o = (ny * nw + Math.min(nw - 1, x >> 1)) * 4;
        const s = (y * lw + x) * 4;
        next[o] += cur[s];
        next[o + 1] += cur[s + 1];
        next[o + 2] += cur[s + 2];
        next[o + 3] += cur[s + 3];
      }
    }
    levels.push({ data: next, w: nw, h: nh });
    cur = next;
    lw = nw;
    lh = nh;
  }

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (px[i * 4 + 3] > 150) continue; // solid enough to keep its own colour
      for (let l = 1; l < levels.length; l++) {
        const { data: d, w: dw, h: dh } = levels[l];
        const o = (Math.min(dh - 1, y >> l) * dw + Math.min(dw - 1, x >> l)) * 4;
        if (d[o + 3] < 0.5) continue;
        px[i * 4] = d[o] / d[o + 3];
        px[i * 4 + 1] = d[o + 1] / d[o + 3];
        px[i * 4 + 2] = d[o + 2] / d[o + 3];
        break;
      }
    }
  }
  // Uploaded as raw pixels: a canvas would premultiply the refilled colour away again.
  const bled = new THREE.DataTexture(px, w, h);
  bled.flipY = texture.flipY;
  bled.colorSpace = texture.colorSpace;
  bled.wrapS = texture.wrapS;
  bled.wrapT = texture.wrapT;
  bled.magFilter = THREE.LinearFilter;
  bled.minFilter = THREE.LinearMipmapLinearFilter;
  bled.generateMipmaps = true;
  bled.anisotropy = 4;
  bled.needsUpdate = true;
  texture.dispose();
  return bled;
}

// ---------------------------------------------------------------------------
// What's where: painted zone, heights, distance to water and to the mountains
// ---------------------------------------------------------------------------
const FIELD_RES = 1; // distance-field cells per world unit

function buildField(world) {
  const { terrain, mapHalf, getGroundHeight } = world;
  const span = mapHalf * 2;

  // Painted zones, read off the terrain texture. Its UVs are planar over the map:
  // u = (x + half) / span, v (image row, top down) = (z + half) / span.
  const image = terrain.material.map.image;
  const n = 512;
  const canvas = document.createElement("canvas");
  canvas.width = n;
  canvas.height = n;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(image, 0, 0, n, n);
  const px = ctx.getImageData(0, 0, n, n).data;
  const zones = new Uint8Array(n * n);
  const lightness = new Float32Array(n * n);
  for (let i = 0; i < n * n; i++) {
    const r = px[i * 4];
    const g = px[i * 4 + 1];
    const b = px[i * 4 + 2];
    zones[i] = zoneOf(r, g, b);
    lightness[i] = g;
  }
  const texel = (x, z) => {
    const i = Math.min(n - 1, Math.max(0, Math.floor(((x + mapHalf) / span) * n)));
    const j = Math.min(n - 1, Math.max(0, Math.floor(((z + mapHalf) / span) * n)));
    return j * n + i;
  };
  const zone = (x, z) => zones[texel(x, z)];
  // 0 on the darker meadow patches, 1 on the lighter ones.
  const meadowLight = (x, z) => THREE.MathUtils.clamp((lightness[texel(x, z)] - 160) / 14, 0, 1);

  // Distance fields on a 1-unit grid: how far to the nearest water, and to the
  // nearest rock or snow (i.e. how deep into the meadow a spot is).
  const size = Math.round(span * FIELD_RES) + 1;
  const toWorld = (k) => k / FIELD_RES - mapHalf;
  const water = new Uint8Array(size * size);
  const wild = new Uint8Array(size * size);
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const x = toWorld(i);
      const z = toWorld(j);
      water[j * size + i] = getGroundHeight(x, z) < WATER_SURFACE_Y ? 1 : 0;
      const zn = zone(x, z);
      wild[j * size + i] = zn === ROCK || zn === SNOW ? 1 : 0;
    }
  }
  const waterDistGrid = distanceField(water, size);
  const wildDistGrid = distanceField(wild, size);
  const sampleGrid = (grid) => (x, z) => {
    const i = Math.min(size - 1, Math.max(0, Math.round((x + mapHalf) * FIELD_RES)));
    const j = Math.min(size - 1, Math.max(0, Math.round((z + mapHalf) * FIELD_RES)));
    return grid[j * size + i] / FIELD_RES;
  };

  const slope = (x, z) => {
    const e = 0.6;
    const gx = getGroundHeight(x + e, z) - getGroundHeight(x - e, z);
    const gz = getGroundHeight(x, z + e) - getGroundHeight(x, z - e);
    return Math.hypot(gx, gz) / (2 * e);
  };

  // Lowest ground under a footprint, so big props on a slope don't float on one side.
  const footing = (x, z, r) => {
    let y = getGroundHeight(x, z);
    for (let a = 0; a < 6; a++) {
      const t = (a / 6) * Math.PI * 2;
      y = Math.min(y, getGroundHeight(x + Math.cos(t) * r, z + Math.sin(t) * r));
    }
    return y;
  };

  // The underwater caves sit on the bed; nothing should grow inside their rock.
  const caves = [];
  world.root.traverse((o) => {
    if (o.isMesh && o.userData.cave) caves.push({ mesh: o, box: new THREE.Box3().setFromObject(o) });
  });
  const raycaster = new THREE.Raycaster();
  const down = new THREE.Vector3(0, -1, 0);
  const origin = new THREE.Vector3();
  const inCave = (x, z, margin = 0.5) => {
    const ground = getGroundHeight(x, z);
    for (const { mesh, box } of caves) {
      if (x < box.min.x - margin || x > box.max.x + margin) continue;
      if (z < box.min.z - margin || z > box.max.z + margin) continue;
      for (const [ox, oz] of [[0, 0], [margin, 0], [-margin, 0], [0, margin], [0, -margin]]) {
        origin.set(x + ox, box.max.y + 1, z + oz);
        raycaster.set(origin, down);
        const hit = raycaster.intersectObject(mesh, false)[0];
        if (hit && hit.point.y > ground - 0.3) return true;
      }
    }
    return false;
  };

  return {
    mapHalf,
    ground: getGroundHeight,
    zone,
    meadowLight,
    waterDist: sampleGrid(waterDistGrid),
    wildDist: sampleGrid(wildDistGrid),
    slope,
    footing,
    inCave,
  };
}

// Two-pass chamfer distance transform: distance (in cells) to the nearest set cell.
function distanceField(mask, size) {
  const d = new Float32Array(size * size);
  for (let k = 0; k < d.length; k++) d[k] = mask[k] ? 0 : 1e6;
  const D = Math.SQRT2;
  const relax = (k, i, j, di, dj, cost) => {
    const ni = i + di;
    const nj = j + dj;
    if (ni < 0 || nj < 0 || ni >= size || nj >= size) return;
    const v = d[nj * size + ni] + cost;
    if (v < d[k]) d[k] = v;
  };
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const k = j * size + i;
      relax(k, i, j, -1, 0, 1);
      relax(k, i, j, 0, -1, 1);
      relax(k, i, j, -1, -1, D);
      relax(k, i, j, 1, -1, D);
    }
  }
  for (let j = size - 1; j >= 0; j--) {
    for (let i = size - 1; i >= 0; i--) {
      const k = j * size + i;
      relax(k, i, j, 1, 0, 1);
      relax(k, i, j, 0, 1, 1);
      relax(k, i, j, 1, 1, D);
      relax(k, i, j, -1, 1, D);
    }
  }
  return d;
}

// Smooth seeded value noise in 0..1, two octaves. `scale` = 1 / feature size.
function makeNoise(seed) {
  const hash = (i, j) => {
    let h = (Math.imul(i, 374761393) + Math.imul(j, 668265263) + Math.imul(seed, 982451653)) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  };
  const value = (x, z) => {
    const i = Math.floor(x);
    const j = Math.floor(z);
    const fx = x - i;
    const fz = z - j;
    const sx = fx * fx * (3 - 2 * fx);
    const sz = fz * fz * (3 - 2 * fz);
    const top = hash(i, j) * (1 - sx) + hash(i + 1, j) * sx;
    const bottom = hash(i, j + 1) * (1 - sx) + hash(i + 1, j + 1) * sx;
    return top * (1 - sz) + bottom * sz;
  };
  return (x, z, scale) =>
    value(x * scale, z * scale) * 0.65 + value(x * scale * 2.3 + 37.1, z * scale * 2.3 - 11.7) * 0.35;
}

// ---------------------------------------------------------------------------
// Placement
// ---------------------------------------------------------------------------
function placeEverything(scatter, field, world, clearings) {
  const { ground, zone, slope, waterDist, wildDist, footing, inCave, meadowLight, mapHalf } = field;
  const random = seededRandom(SEED);
  const noise = makeNoise(SEED);
  const pick = (list) => list[Math.floor(random() * list.length)];
  const range = (a, b) => a + random() * (b - a);
  const cleared = (x, z, pad = 0) =>
    clearings.some((c) => Math.hypot(x - c.x, z - c.z) < c.r + pad);

  // Visit a jittered grid over the whole map.
  const grid = (step, visit) => {
    for (let z = -mapHalf; z < mapHalf; z += step) {
      for (let x = -mapHalf; x < mapHalf; x += step) {
        visit(x + random() * step, z + random() * step);
      }
    }
  };
  const onDryGrass = (x, z) => zone(x, z) === GRASS && ground(x, z) > WATER_SURFACE_Y + 0.08;
  const tint = (base, jitter = 0.06) =>
    base.clone().offsetHSL(range(-0.01, 0.01), 0, range(-jitter, jitter));
  const meadowColor = (x, z) => GRASS_DARK.clone().lerp(GRASS_LIGHT, meadowLight(x, z));

  // Only where the otter walks or wades: a rock on the bed mustn't stop a swimmer above it.
  const obstacle = (x, z, r) => {
    const y = ground(x, z);
    if (y > WATER_SURFACE_Y - 0.4 && y < MAX_WALK_HEIGHT) world.addObstacle(x, z, r);
  };

  // --- Meadow: a wispy grass blanket over every bit of painted green. ---
  grid(0.85, (x, z) => {
    if (!onDryGrass(x, z) || slope(x, z) > 1.5) return;
    const lush = noise(x, z, 0.07); // taller, denser drifts
    if (random() > 0.72 + 0.28 * lush) return;
    const s = 0.5 + 0.35 * lush + range(0, 0.15);
    scatter.add("meadowGrass", x, ground(x, z) - 0.03, z, {
      scale: [s * range(0.9, 1.2), s * range(0.8, 1.15), s * range(0.9, 1.2)],
      tilt: 0.12,
      color: tint(meadowColor(x, z), 0.03),
    });
  });

  // Taller tufts in drifts, and where the meadow runs up to the mountains.
  grid(2.2, (x, z) => {
    if (!onDryGrass(x, z) || slope(x, z) > 1.2) return;
    const drift = noise(x + 300, z, 0.05);
    const edge = wildDist(x, z) < 7;
    if (!(drift > 0.62 || (edge && random() < 0.45))) return;
    const kind = random() < 0.55 ? "tallGrass" : "shortGrass";
    const s = kind === "tallGrass" ? range(0.5, 0.8) : range(0.7, 1.1);
    const color = meadowColor(x, z).lerp(REED_COLOR, range(0, 0.35)); // a touch of seed-head yellow
    scatter.add(kind, x, ground(x, z) - 0.03, z, { scale: s, tilt: 0.15, color: tint(color, 0.04) });
  });

  // --- Flowers: patches of one kind each, plus a scatter along the banks. ---
  grid(1.5, (x, z) => {
    if (!onDryGrass(x, z) || slope(x, z) > 1) return;
    const patch = noise(x - 500, z + 200, 0.045);
    const bank = waterDist(x, z);
    const onBank = bank > 1.5 && bank < 7;
    let chance = 0;
    if (patch > 0.64) chance = 0.45 * Math.min(1, (patch - 0.64) / 0.08);
    if (onBank) chance = Math.max(chance, 0.09);
    if (chance === 0 || random() > chance) return;
    const kind = noise(x + 90, z - 40, 0.03) > 0.5 ? "flowers3" : "flowers4";
    scatter.add(kind, x, ground(x, z) - 0.03, z, { scale: range(0.38, 0.6), tilt: 0.12 });
  });

  // --- Groves of broadleaf trees, thickest toward the mountains. ---
  const trees = [];
  grid(6.5, (x, z) => {
    if (!onDryGrass(x, z) || slope(x, z) > 0.8) return;
    if (waterDist(x, z) < 4 || cleared(x, z, 4)) return;
    const grove = noise(x + 1000, z, 0.035);
    const edge = wildDist(x, z);
    let chance = 0.02;
    if (grove > 0.64) chance = 0.75;
    else if (edge < 6) chance = 0.35;
    else if (edge < 14) chance = 0.08;
    if (random() > chance) return;
    const s = range(1.05, 1.55);
    const y = footing(x, z, 0.8 * s) - 0.1;
    scatter.add(pick(COMMON_TREES), x, y, z, { scale: s, tilt: 0.04, leafColor: leafGreen(range) });
    obstacle(x, z, 0.45 * s);
    trees.push({ x, z, s });
  });

  // Bushes: at the feet of the groves and along the meadow's edge.
  grid(4.5, (x, z) => {
    if (!onDryGrass(x, z) || slope(x, z) > 1) return;
    if (waterDist(x, z) < 2.5 || cleared(x, z, 1)) return;
    const nearTree = trees.some((t) => Math.hypot(t.x - x, t.z - z) < 7);
    const edge = wildDist(x, z) < 5;
    const chance = nearTree ? 0.35 : edge ? 0.3 : 0.025;
    if (random() > chance) return;
    const s = range(1.0, 1.7);
    scatter.add("bush", x, footing(x, z, 0.6 * s) - 0.05, z, { scale: s, tilt: 0.06, leafColor: leafGreen(range) });
  });

  // Two great twisted trees as landmarks, a short way back from the water.
  const landmarks = [];
  grid(5, (x, z) => {
    if (!onDryGrass(x, z) || slope(x, z) > 0.4 || cleared(x, z, 10)) return;
    const w = waterDist(x, z);
    if (w < 8 || w > 14 || wildDist(x, z) < 12) return;
    landmarks.push({ x, z, order: random() });
  });
  landmarks.sort((a, b) => a.order - b.order);
  const great = [];
  for (const spot of landmarks) {
    if (great.length === 2) break;
    if (great.some((g) => Math.hypot(g.x - spot.x, g.z - spot.z) < 60)) continue;
    if (trees.some((t) => Math.hypot(t.x - spot.x, t.z - spot.z) < 6)) continue;
    great.push(spot);
    const s = range(0.62, 0.72);
    const { x, z } = spot;
    scatter.add("twistedTree", x, footing(x, z, 2 * s) - 0.2, z, { scale: s, leafColor: LANDMARK_LEAVES });
    obstacle(x, z, 1.1 * s);
    // A ring of flowers around its roots.
    for (let k = 0; k < 14; k++) {
      const a = random() * Math.PI * 2;
      const r = range(4, 8);
      const fx = x + Math.cos(a) * r;
      const fz = z + Math.sin(a) * r;
      if (!onDryGrass(fx, fz)) continue;
      scatter.add(k % 2 ? "flowers3" : "flowers4", fx, ground(fx, fz) - 0.03, fz, { scale: range(0.4, 0.6) });
    }
  }

  // --- Foothills: pine forest climbing the mountain ring, thinning with height. ---
  grid(5.5, (x, z) => {
    const zn = zone(x, z);
    const y = ground(x, z);
    const edge = zn === GRASS && wildDist(x, z) < 3;
    if (!(zn === ROCK || edge) || y < 1 || y > 30) return;
    if (slope(x, z) > 2.2 || waterDist(x, z) < 4 || cleared(x, z, 4)) return;
    const stand = noise(x - 2000, z, 0.04);
    const chance = (stand > 0.45 ? 0.85 : 0.3) * (1 - Math.max(0, y - 6) / 26);
    if (random() > chance) return;
    const s = range(1.0, 1.7);
    // The roots splay out, so sink it on slopes until the downhill ones touch the ground.
    const sink = 0.2 + 0.25 * Math.min(slope(x, z), 1.5) * s;
    scatter.add("pine", x, footing(x, z, 0.9 * s) - sink, z, { scale: s, tilt: 0.05, leafColor: tint(PINE_TINT, 0.05) });
    obstacle(x, z, 0.45 * s);
  });

  // --- Rocks. ---
  const rock = (x, y, z, s, sink = 0.25) => {
    scatter.add("rock", x, y - sink * s, z, {
      scale: [s * range(0.8, 1.2), s * range(0.7, 1.1), s * range(0.8, 1.2)],
      tilt: 0.35,
      color: tint(ROCK_TINT, 0.05),
    });
  };
  const pebble = (x, y, z, s) =>
    scatter.add(pick(PEBBLES), x, y - 0.02, z, { scale: s, tilt: 0.2, color: tint(ROCK_TINT, 0.08) });

  // Boulders strewn over the mountains.
  grid(7, (x, z) => {
    const zn = zone(x, z);
    if ((zn !== ROCK && zn !== SNOW) || slope(x, z) > 0.9 || ground(x, z) > 28) return;
    if (random() > (zn === ROCK ? 0.4 : 0.15)) return;
    const s = range(1.2, 3.2);
    rock(x, footing(x, z, s), z, s, 0.35);
    obstacle(x, z, 1.1 * s);
  });

  // A few in the meadow (more near its edge), each with pebbles around it.
  grid(9, (x, z) => {
    if (!onDryGrass(x, z) || slope(x, z) > 1 || waterDist(x, z) < 3 || cleared(x, z, 3)) return;
    if (random() > (wildDist(x, z) < 14 ? 0.2 : 0.05)) return;
    const s = range(0.6, 1.5);
    rock(x, footing(x, z, s), z, s);
    if (s > 0.8) obstacle(x, z, 1.1 * s);
    const count = 2 + Math.floor(random() * 5);
    for (let k = 0; k < count; k++) {
      const a = random() * Math.PI * 2;
      const r = range(1.3, 2.6) * s + 0.5;
      const px = x + Math.cos(a) * r;
      const pz = z + Math.sin(a) * r;
      pebble(px, ground(px, pz), pz, range(0.8, 1.6));
    }
  });

  // --- The water's edge: reeds, pebbly sand and stones half in the water. ---
  grid(1.1, (x, z) => {
    const y = ground(x, z);
    if (y < -0.7 || y > 0.45 || slope(x, z) > 1.5 || inCave(x, z)) return;
    const zn = zone(x, z);
    const reedBed = noise(x + 700, z - 300, 0.09);
    if (reedBed > 0.48 && random() < 0.6) {
      const kind = random() < 0.7 ? "reeds" : "shortGrass";
      const s = kind === "reeds" ? range(0.55, 0.95) : range(0.8, 1.2);
      scatter.add(kind, x, y - 0.05, z, { scale: s, tilt: 0.15, color: tint(REED_COLOR, 0.05) });
    } else if (zn === SHORE && random() < 0.16) {
      pebble(x, y, z, range(0.8, 1.7));
    }
    if (random() < 0.012 && !cleared(x, z, 2)) {
      const s = range(0.5, 1.1);
      rock(x, y, z, s, 0.35);
      if (s > 0.8) obstacle(x, z, 1.0 * s);
    }
  });

  // The little dry sand patch in the meadow: a pebble beach.
  grid(0.9, (x, z) => {
    if (zone(x, z) !== SHORE || ground(x, z) < 0.45 || waterDist(x, z) < 3) return;
    if (random() < 0.22) pebble(x, ground(x, z), z, range(0.8, 1.8));
    else if (random() < 0.01) rock(x, ground(x, z), z, range(0.5, 0.9), 0.3);
  });

  // --- Underwater: seaweed beds, sea grass in the shallows, stones on the bed. ---
  grid(1.2, (x, z) => {
    const y = ground(x, z);
    const depth = WATER_SURFACE_Y - y;
    if (depth < 0.7 || inCave(x, z)) return;
    const bed = noise(x - 50, z + 800, 0.07);
    if (bed > 0.38 && random() < 0.65) {
      if (depth < 1.6) {
        scatter.add("seaGrass", x, y - 0.05, z, { scale: range(0.8, 1.3), tilt: 0.2, color: tint(SEA_GRASS_COLOR, 0.05) });
      } else {
        // Long fronds in deep water, always stopping short of the surface.
        const reach = Math.min(depth - 0.6, 7) * range(0.35, 0.8);
        const sy = THREE.MathUtils.clamp(reach / 1.84, 0.5, 3.2);
        const sxz = range(0.7, 1.1);
        scatter.add("seaweed", x, y - 0.05, z, { scale: [sxz, sy, sxz], tilt: 0.15, color: tint(SEAWEED_COLOR, 0.06) });
      }
    } else if (random() < 0.05) {
      pebble(x, y, z, range(1, 2.2));
    }
  });
  grid(6, (x, z) => {
    if (WATER_SURFACE_Y - ground(x, z) < 1.2 || inCave(x, z, 2)) return;
    if (random() > 0.3) return;
    const s = range(0.6, 1.6);
    rock(x, footing(x, z, s), z, s, 0.3);
  });
}

// ---------------------------------------------------------------------------
// Instancing in map chunks
// ---------------------------------------------------------------------------
const _matrix = new THREE.Matrix4();
const _quat = new THREE.Quaternion();
const _euler = new THREE.Euler();
const _pos = new THREE.Vector3();
const _scale = new THREE.Vector3();

class Scatter {
  constructor(models, field) {
    this.models = models;
    this.field = field;
    this.random = seededRandom(SEED + 1);
    this.items = new Map(); // kind name -> [placement]
  }

  add(kind, x, y, z, { scale = 1, tilt = 0, color = null, leafColor = null } = {}) {
    const r = this.random;
    if (!this.items.has(kind)) this.items.set(kind, []);
    this.items.get(kind).push({
      x,
      y,
      z,
      rotY: r() * Math.PI * 2,
      tiltX: (r() * 2 - 1) * tilt,
      tiltZ: (r() * 2 - 1) * tilt,
      scale: Array.isArray(scale) ? scale : [scale, scale, scale],
      color,
      leafColor,
      order: r(), // instances draw in this order, so a partial count is an even thinning
    });
  }

  build(scene) {
    const chunks = [];
    const half = this.field.mapHalf;
    for (const [name, placements] of this.items) {
      const kind = KINDS[name];
      const model = this.models[kind.model];
      const lod = kind.near
        ? { near: kind.near * LOD_RANGE, far: kind.far * LOD_RANGE, minFrac: kind.minFrac }
        : { near: VIEW_LIMIT, far: VIEW_LIMIT, minFrac: 1 };

      const cells = new Map();
      for (const p of placements) {
        const i = Math.floor((p.x + half) / kind.cell);
        const j = Math.floor((p.z + half) / kind.cell);
        const key = `${i},${j}`;
        if (!cells.has(key)) cells.set(key, { i, j, list: [] });
        cells.get(key).list.push(p);
      }

      for (const { i, j, list } of cells.values()) {
        list.sort((a, b) => a.order - b.order);
        // Each chunk is its own top-level object, so its outline stencil is its own.
        const group = new THREE.Group();
        group.name = `scenery:${name}`;
        const meshes = [];
        for (const { geometry, material: baseMaterial } of model.parts) {
          const material = (kind.material && this.models.materialOverrides[kind.material]) || baseMaterial;
          const isBark = baseMaterial.name.startsWith("Bark");
          const isLeaves = !isBark && baseMaterial.name.startsWith("Leave");
          const mesh = new THREE.InstancedMesh(geometry, material, list.length);
          list.forEach((p, k) => {
            _euler.set(p.tiltX, p.rotY, p.tiltZ, "YXZ");
            _quat.setFromEuler(_euler);
            _pos.set(p.x, p.y, p.z);
            _scale.set(p.scale[0], p.scale[1], p.scale[2]);
            mesh.setMatrixAt(k, _matrix.compose(_pos, _quat, _scale));
            const color = isBark ? null : isLeaves ? p.leafColor ?? p.color : p.color;
            mesh.setColorAt(k, color ?? WHITE);
          });
          mesh.instanceMatrix.needsUpdate = true;
          mesh.instanceColor.needsUpdate = true;
          mesh.computeBoundingSphere();
          // Ink on trunks and stones only: an outline around cut-out leaf cards would
          // trace the cards' squares, not the leaves.
          mesh.userData.noOutline = !kind.outline || isLeaves;
          group.add(mesh);
          meshes.push(mesh);
        }
        scene.add(group);
        chunks.push({
          group,
          meshes,
          size: list.length,
          lod,
          cx: (i + 0.5) * kind.cell - half,
          cz: (j + 0.5) * kind.cell - half,
          half: kind.cell / 2,
        });
      }
    }
    return chunks;
  }
}
