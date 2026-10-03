import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import * as SkeletonUtils from "three/examples/jsm/utils/SkeletonUtils.js";
import otterUrl from "../assets/models/character/Otter.glb?url";

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
  constructor(scene, color = "Yellow") {
    if (!TEXTURE_URLS[color]) {
      color = "Yellow";
    }
    this.scene = scene;
    this.color = color;
    this.mixer = null;
    this.actions = {};

    this.root = new THREE.Group();
    this.scene.add(this.root);
    this.model = null;

    this.ready = this.load();
  }

  async load() {
    const gltf = await loadOtterGltf();

    const otter = SkeletonUtils.clone(gltf.scene);
    const material = new THREE.MeshToonMaterial({
      map: loadTexture(this.color),
      side: THREE.DoubleSide,
    });
    otter.traverse((o) => {
      if (o.isMesh) {
        o.material = material;
        o.castShadow = true;
      }
    });

    this.model = otter;
    this.root.add(otter);

    if (gltf.animations.length > 0) {
      this.mixer = new THREE.AnimationMixer(otter);
      for (const clip of gltf.animations) {
        this.actions[clip.name] = this.mixer.clipAction(clip);
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

  update(delta) {
    this.mixer?.update(delta);
  }

  dispose() {
    this.scene.remove(this.root);
    this.mixer?.stopAllAction();
  }
}
