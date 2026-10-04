import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import * as SkeletonUtils from "three/examples/jsm/utils/SkeletonUtils.js";
import otterUrl from "../assets/models/character/Otter.glb?url";
import { createNametag, disposeNametag } from "./nametags.js";
import { applyToonStyle } from "./toonshading.js";

const NAMETAG_GAP = 0.4;
const MODEL_SCALE = 1.8;
const WALK_SPEED_THRESHOLD = 0.8; // units/sec
const SPEED_SMOOTHING = 12;
const WALK_ANIMATION_SPEED = 1.3; // playback rate of the Walk clip

const TEXTURE_URLS = Object.fromEntries(
  Object.entries(
    import.meta.glob("../assets/models/character/textures/Otter_*.png", {
      eager: true,
      query: "?url",
      import: "default",
    }),
  ).map(([path, url]) => [path.match(/Otter_(\w+)\.png$/)[1], url]),
);

export const OTTER_COLORS = Object.keys(TEXTURE_URLS);

const loader = new GLTFLoader();
const textureLoader = new THREE.TextureLoader();
let gltfPromise = null;
const textureCache = new Map();

function loadOtterGltf() {
  gltfPromise ??= loader.loadAsync(otterUrl);
  return gltfPromise;
}

function loadTexture(color) {
  if (!textureCache.has(color)) {
    const tex = textureLoader.load(TEXTURE_URLS[color]);
    tex.flipY = false;
    tex.colorSpace = THREE.SRGBColorSpace;
    textureCache.set(color, tex);
  }
  return textureCache.get(color);
}

export class Character {
  constructor(scene, color = "Yellow", name = null) {
    if (!TEXTURE_URLS[color]) {
      color = "Yellow";
    }
    this.scene = scene;
    this.color = color;
    this.mixer = null;
    this.actions = {};
    this.speed = 0;

    this.root = new THREE.Group();
    this.scene.add(this.root);
    this.model = null;
    this.nametag = null;
    this.nametagHeight = 2;

    if (name) this.setName(name);
    this.ready = this.load();
  }

  setName(name) {
    if (this.nametag) {
      this.root.remove(this.nametag);
      disposeNametag(this.nametag);
      this.nametag = null;
    }
    this.name = name;
    if (!name) return;
    this.nametag = createNametag(name);
    this.nametag.position.y = this.nametagHeight;
    this.root.add(this.nametag);
  }

  async load() {
    const gltf = await loadOtterGltf();

    const otter = SkeletonUtils.clone(gltf.scene);
    applyToonStyle(otter, loadTexture(this.color));

    otter.scale.setScalar(MODEL_SCALE);
    this.nametagHeight =
      new THREE.Box3().setFromObject(otter).max.y + NAMETAG_GAP;

    this.model = otter;
    this.root.add(otter);

    if (this.nametag) this.nametag.position.y = this.nametagHeight;

    if (gltf.animations.length > 0) {
      this.mixer = new THREE.AnimationMixer(otter);
      for (const clip of gltf.animations) {
        this.actions[clip.name] = this.mixer.clipAction(clip);
      }
      if (this.actions.Walk) {
        this.actions.Walk.timeScale = WALK_ANIMATION_SPEED;
      }
      this.play("Idle");
    }

    return this;
  }

  play(name) {
    const action = this.actions[name] ?? Object.values(this.actions)[0];
    if (!action || action === this.current) return;
    action.reset().fadeIn(0.2).play();
    this.current?.fadeOut(0.2);
    this.current = action;
  }

  // Picks Walk or Idle from how fast the root moved since last frame, so it
  // works the same for the local player and network-smoothed remotes.
  update(delta) {
    const { x, z } = this.root.position;
    if (this.lastX !== undefined && delta > 0) {
      const speed = Math.hypot(x - this.lastX, z - this.lastZ) / delta;
      this.speed +=
        (speed - this.speed) * (1 - Math.exp(-SPEED_SMOOTHING * delta));
    }
    this.lastX = x;
    this.lastZ = z;

    this.play(this.speed > WALK_SPEED_THRESHOLD ? "Walk" : "Idle");
    this.mixer?.update(delta);
  }

  dispose() {
    this.setName(null);
    this.scene.remove(this.root);
    this.mixer?.stopAllAction();
  }
}
