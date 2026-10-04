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
const WALK_ANIMATION_SPEED = 1.6; // playback rate of the Walk clip
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
// Jump: JumpStart on leaving the ground, JumpAir until touchdown, JumpLand on impact.
const AIRBORNE_HEIGHT = 0.05; // above the ground by more than this = in the air
const JUMP_CLIPS = { start: "JumpStart", air: "JumpAir", land: "JumpLand" };
const JUMP_FADES = { start: 0.1, air: 0.05, land: 0.08 };
// JumpStart ends on JumpAir's first frame and JumpLand on Idle's, so barely blend.
const JUMP_HANDOFF_FADE = 0.05;
const LAND_SQUASH_TIME = 0.25; // walking can cut JumpLand short, but only after the squash
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
      for (const once of ["Surface", "JumpStart", "JumpLand"]) {
        this.actions[once]?.setLoop(THREE.LoopOnce);
        if (this.actions[once]) this.actions[once].clampWhenFinished = true;
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

    if (
      mode === "surface" &&
      this.speed < SURFACE_IDLE_SPEED &&
      this.actions.SwimFloat
    ) {
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
      if (surfaceClip.time < SURFACE_CLIMB_END)
        surfaceClip.time = SURFACE_CLIMB_END;
      if (surfaceClip.isRunning()) name = "Surface";
    }
    let fade = null;
    this.updateJumpPhase(mode, y);
    if (this.jumpPhase) {
      name = JUMP_CLIPS[this.jumpPhase];
      fade = JUMP_FADES[this.jumpPhase];
    } else if (this.current && this.current === this.actions.JumpLand) {
      fade = name === "Idle" ? JUMP_HANDOFF_FADE : LAND_FADE;
    }

    // Slower crossfade whenever a swim clip is on either side of the switch.
    const leavingSwim = [...Object.values(CLIP_FOR_MODE), "SwimFloat"].some(
      (clip) => this.current === this.actions[clip],
    );
    fade ??= mode !== "land" || leavingSwim ? SWIM_FADE : LAND_FADE;
    this.play(name, fade);
    if (this.actions.Dive) {
      this.actions.Dive.timeScale =
        mode === "hover" ? HOVER_ANIMATION_SPEED : 1;
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

  // Works from height alone so remote players' jumps animate too.
  updateJumpPhase(mode, y) {
    const { JumpStart: start, JumpAir: air, JumpLand: land } = this.actions;
    if (mode !== "land" || !start || !air || !land) {
      this.jumpPhase = null;
      return;
    }
    const airborne = y > AIRBORNE_HEIGHT;
    const inAir = this.jumpPhase === "start" || this.jumpPhase === "air";
    if (airborne) {
      if (!inAir) this.jumpPhase = "start";
      else if (this.jumpPhase === "start" && !start.isRunning()) this.jumpPhase = "air";
    } else if (inAir) {
      this.jumpPhase = "land";
    } else if (
      this.jumpPhase === "land" &&
      (!land.isRunning() ||
        (this.speed > WALK_SPEED_THRESHOLD && land.time > LAND_SQUASH_TIME))
    ) {
      this.jumpPhase = null; // landing done, or walking off cuts it short
    }
  }

  dispose() {
    this.setName(null);
    this.scene.remove(this.root);
    this.mixer?.stopAllAction();
  }
}
