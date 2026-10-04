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
const LAND_FADE = 0.2;
const SWIM_FADE = 0.4; // standing -> horizontal blend reads as a flop into the water
const HOVER_ANIMATION_SPEED = 0.4; // clip rate while treading water below the surface
// The on-back float in SwimSurface runs between these fractions of the clip.
const FLOAT_START = 0.48;
const FLOAT_END = 0.84;
const CLIP_FPS = 24;
const SURFACE_IDLE_SPEED = 0.3; // below this at the surface he just floats on his back
// Surface clip: 0-1.4 s is the upward swim (looped while climbing), the rest is
// the level-out, head pop and shake, played once on reaching the top.
const SURFACE_CLIMB_END = 1.4;
const CLIP_FOR_MODE = {
  surface: "SwimSurface",
  dive: "Dive",
  hover: "Dive",
  rise: "Surface",
};

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
    this.vy = 0;

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
      // The on-back float cut out of SwimSurface, for when he's not moving.
      // Ping-pong so it loops without snapping from the end pose to the start.
      const swim = this.actions.SwimSurface?.getClip();
      if (swim) {
        const frames = swim.duration * CLIP_FPS;
        const floatClip = THREE.AnimationUtils.subclip(
          swim,
          "SwimFloat",
          Math.round(FLOAT_START * frames),
          Math.round(FLOAT_END * frames),
          CLIP_FPS,
        );
        this.actions.SwimFloat = this.mixer.clipAction(floatClip);
        this.actions.SwimFloat.setLoop(THREE.LoopPingPong);
      }
      if (this.actions.Surface) {
        this.actions.Surface.setLoop(THREE.LoopOnce);
        this.actions.Surface.clampWhenFinished = true;
      }
      this.play("Idle");
    }

    return this;
  }

  play(name, fade = LAND_FADE) {
    const action = this.actions[name] ?? Object.values(this.actions)[0];
    if (!action || action === this.current) return;
    action.reset().fadeIn(fade).play();
    this.current?.fadeOut(fade);
    this.current = action;
  }

  // True during the on-back float part of the surface swim (swim slower then).
  isFloating() {
    if (this.current && this.current === this.actions.SwimFloat) return true;
    const swim = this.actions.SwimSurface;
    if (!swim || this.current !== swim) return false;
    const p = swim.time / swim.getClip().duration;
    return p > FLOAT_START && p < FLOAT_END;
  }

  // Picks the clip from how the root moved since last frame, so it works the
  // same for the local player and network-smoothed remotes. getSwimMode(position, vy)
  // returns "land", "surface", "dive", "hover" or "rise".
  update(delta, getSwimMode = null) {
    const { x, y, z } = this.root.position;
    if (this.lastX !== undefined && delta > 0) {
      const blend = 1 - Math.exp(-SPEED_SMOOTHING * delta);
      const speed = Math.hypot(x - this.lastX, z - this.lastZ) / delta;
      this.speed += (speed - this.speed) * blend;
      this.vy += ((y - this.lastY) / delta - this.vy) * blend;
    }
    this.lastX = x;
    this.lastY = y;
    this.lastZ = z;

    const mode = getSwimMode?.(this.root.position, this.vy) ?? "land";
    const surfaceClip = this.actions.Surface;
    let name =
      CLIP_FOR_MODE[mode] ??
      (this.speed > WALK_SPEED_THRESHOLD ? "Walk" : "Idle");

    if (mode === "surface" && this.speed < SURFACE_IDLE_SPEED && this.actions.SwimFloat) {
      name = "SwimFloat";
    }

    // Treading water keeps the pose of the last direction swum: climb after Shift, dive after Space.
    if (mode === "dive" || mode === "rise") this.lastSwimDirection = mode;
    const hoverClimb = mode === "hover" && this.lastSwimDirection === "rise";
    if (hoverClimb) name = "Surface";
    const climbing = mode === "rise" || hoverClimb;

    // Just reached the top while climbing: skip to the level-out and let the
    // head pop / shake finish before switching to the surface swim.
    const finishingSurface =
      mode === "surface" && surfaceClip && this.current === surfaceClip;
    if (finishingSurface) {
      if (surfaceClip.time < SURFACE_CLIMB_END) surfaceClip.time = SURFACE_CLIMB_END;
      if (surfaceClip.isRunning()) name = "Surface";
    }
    // Slower crossfade whenever a swim clip is on either side of the switch.
    const leavingSwim = [...Object.values(CLIP_FOR_MODE), "SwimFloat"].some(
      (clip) => this.current === this.actions[clip],
    );
    this.play(name, mode !== "land" || leavingSwim ? SWIM_FADE : LAND_FADE);
    if (this.actions.Dive) {
      this.actions.Dive.timeScale = mode === "hover" ? HOVER_ANIMATION_SPEED : 1;
    }
    if (surfaceClip) {
      surfaceClip.timeScale = hoverClimb ? HOVER_ANIMATION_SPEED : 1;
    }
    this.mixer?.update(delta);

    // Keep repeating the upward swim until he hits the surface.
    if (climbing && surfaceClip && surfaceClip.time >= SURFACE_CLIMB_END) {
      surfaceClip.time %= SURFACE_CLIMB_END;
    }
  }

  dispose() {
    this.setName(null);
    this.scene.remove(this.root);
    this.mixer?.stopAllAction();
  }
}
