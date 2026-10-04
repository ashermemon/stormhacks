import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import * as SkeletonUtils from "three/examples/jsm/utils/SkeletonUtils.js";
import otterUrl from "../assets/models/character/Otter.glb?url";
import { createNametag, disposeNametag } from "./nametags.js";
import { applyToonStyle } from "./toonshading.js";
import hatUrl from "../assets/models/character/Hat.glb?url";
import wizardHatUrl from "../assets/models/character/WizardHat.glb?url";

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
// Holding a trinket in the water: these clips have a "<name>_Hold" twin where he hugs
// it to his chest. Swapping between twins keeps the clip time, so only the arms move.
const HOLD_SWAP_FADE = 0.25;
// Bench poses (SitDown, Sit, StandUp) hand off to each other exactly, so barely blend.
const POSE_FADE = 0.05;


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
let hatPromise = null;

function loadHatGltf() {
  hatPromise ??= loader.loadAsync(hatUrl);
  hatPromise ??= loader.loadAsync(wizardHatUrl);
  return hatPromise;
}

export const HAT_FILES = {
  none: null,
  hat: hatUrl,
  wizardHat: wizardHatUrl,
};
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
    this.holding = false;
    this.pose = null; // a clip that overrides the movement-picked one (bench sitting)
    this.currentName = null; // the move being played, without any _Hold suffix

    this.root = new THREE.Group();
    this.scene.add(this.root);
    this.model = null;
    this.nametag = null;
    this.nametagHeight = 2;
    this.hat = null;
    this.hatId = "none";
    this.ownedHats = {
      hat: false,
      wizardHat: true,
    };

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
      for (const [source, name] of [
        ["SwimSurface", "SwimFloat"],
        ["SwimSurface_Hold", "SwimFloat_Hold"],
      ]) {
        const swim = this.actions[source]?.getClip();
        if (!swim) continue;
        const frames = swim.duration * CLIP_FPS;
        const floatClip = THREE.AnimationUtils.subclip(
          swim,
          name,
          Math.round(FLOAT_START * frames),
          Math.round(FLOAT_END * frames),
          CLIP_FPS,
        );
        this.actions[name] = this.mixer.clipAction(floatClip);
        this.actions[name].setLoop(THREE.LoopPingPong);
      }
      for (const once of ["Surface", "Surface_Hold", "JumpStart", "JumpLand", "SitDown", "StandUp"]) {
        this.actions[once]?.setLoop(THREE.LoopOnce);
        if (this.actions[once]) this.actions[once].clampWhenFinished = true;
      }
      this.play("Idle");
    }

    return this;
  }

  // The clip for a move: its _Hold twin while holding a trinket, if it has one.
  actionFor(name) {
    return (this.holding && this.actions[`${name}_Hold`]) || this.actions[name];
  }

  play(name, fade = LAND_FADE) {
    const action = this.actionFor(name) ?? Object.values(this.actions)[0];
    if (!action || action === this.current) return;
    // Same move, just grabbing or letting go: carry on from the same moment.
    const swap = this.current && this.currentName === name;
    action.reset();
    if (swap) action.time = this.current.time;
    action.fadeIn(swap ? HOLD_SWAP_FADE : fade).play();
    this.current?.fadeOut(swap ? HOLD_SWAP_FADE : fade);
    this.current = action;
    this.currentName = name;
  }

  /** Holding a trinket: in the water he hugs it to his chest (the _Hold clips; the
   *  land clips have no twins, so on land he walks as usual). */
  setHolding(holding) {
    this.holding = holding;
  }

  /** Play this clip instead of picking one from movement ("SitDown", "Sit", "StandUp"),
   *  or null to go back. Call it on the frame the root is moved to the pose's spot. */
  setPose(name) {
    if (name === this.pose) return;
    this.pose = name;
    this.lastX = undefined; // the root jumps here; don't read that as movement
    this.speed = 0;
    this.vy = 0;
  }

  /** 0..1 through the current pose clip (0 before it has started). */
  poseProgress() {
    const action = this.actions[this.pose];
    if (!action || this.current !== action) return 0;
    return Math.min(1, action.time / action.getClip().duration);
  }

  /** True once a play-once pose (SitDown, StandUp) has finished. */
  poseDone() {
    const action = this.actions[this.pose];
    return Boolean(action && this.current === action && !action.isRunning());
  }

  /** True while a _Hold clip is playing, i.e. the trinket belongs in the chest socket. */
  inHoldPose() {
    return Boolean(this.current?.getClip().name.endsWith("_Hold"));
  }

  /** World transform of the trinket socket between his paws (follows every clip). */
  holdSocket(outPos, outQuat) {
    this.socket ??= this.model?.getObjectByName("trinket");
    if (!this.socket) return null;
    this.socket.getWorldPosition(outPos);
    if (outQuat) this.socket.getWorldQuaternion(outQuat);
    return outPos;
  }

  // True during the on-back float part of the surface swim (swim slower then).
  isFloating() {
    if (this.currentName === "SwimFloat") return true;
    if (this.currentName !== "SwimSurface") return false;
    const p = this.current.time / this.current.getClip().duration;
    return p > FLOAT_START && p < FLOAT_END;
  }

  // Picks the clip from how the root moved since last frame, so it works the
  // same for the local player and network-smoothed remotes. getSwimMode(position, vy)
  // returns "land", "air", "surface", "dive", "hover" or "rise".
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

    if (this.pose && this.actions[this.pose]) {
      this.play(this.pose, POSE_FADE);
      this.mixer?.update(delta);
      return;
    }

    const mode = getSwimMode?.(this.root.position, this.vy) ?? "land";
    const onLand = mode === "land" || mode === "air";
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

    // Treading water keeps the pose of the last direction swum: climb after Space, dive after Shift.
    if (mode === "dive" || mode === "rise") this.lastSwimDirection = mode;
    const hoverClimb = mode === "hover" && this.lastSwimDirection === "rise";
    if (hoverClimb) name = "Surface";
    const climbing = mode === "rise" || hoverClimb;

    // Just reached the top while climbing: skip to the level-out and let the
    // head pop / shake finish before switching to the surface swim.
    const finishingSurface = mode === "surface" && this.currentName === "Surface";
    if (finishingSurface) {
      if (this.current.time < SURFACE_CLIMB_END)
        this.current.time = SURFACE_CLIMB_END;
      if (this.current.isRunning()) name = "Surface";
    }
    let fade = null;
    this.updateJumpPhase(mode);
    if (this.jumpPhase) {
      name = JUMP_CLIPS[this.jumpPhase];
      fade = JUMP_FADES[this.jumpPhase];
    } else if (this.currentName === "JumpLand") {
      fade = name === "Idle" ? JUMP_HANDOFF_FADE : LAND_FADE;
    }

    // Slower crossfade whenever a swim clip is on either side of the switch.
    const leavingSwim = [...Object.values(CLIP_FOR_MODE), "SwimFloat"].includes(
      this.currentName,
    );
    fade ??= !onLand || leavingSwim ? SWIM_FADE : LAND_FADE;
    this.play(name, fade);
    for (const dive of [this.actions.Dive, this.actions.Dive_Hold]) {
      if (dive) dive.timeScale = mode === "hover" ? HOVER_ANIMATION_SPEED : 1;
    }
    for (const surface of [this.actions.Surface, this.actions.Surface_Hold]) {
      if (surface) surface.timeScale = hoverClimb ? HOVER_ANIMATION_SPEED : 1;
    }
    this.mixer?.update(delta);

    // Keep repeating the upward swim until he hits the surface.
    if (climbing && this.currentName === "Surface" && this.current.time >= SURFACE_CLIMB_END) {
      this.current.time %= SURFACE_CLIMB_END;
    }
  }

  // Works from height above the ground alone, so remote players' jumps animate too.
  updateJumpPhase(mode) {
    const { JumpStart: start, JumpAir: air, JumpLand: land } = this.actions;
    if ((mode !== "land" && mode !== "air") || !start || !air || !land) {
      this.jumpPhase = null;
      return;
    }
    const airborne = mode === "air";
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

  removeHat() {
    if (this.hat) {
      this.hat.parent?.remove(this.hat);
      this.hat = null;
    }

    this.hatId = "none";
  }

  async setHat(hatFile, hatId = null) {
    if (!hatFile) {
      this.removeHat();
      return;
    }

    if (!this.model) {
      await this.ready;
    }

    // The skeleton's "hat" bone sits on top of the head and follows every clip, so
    // hats rest on the head instead of sinking into it. Older models without it
    // fall back to the head bone.
    const socket = this.model?.getObjectByName("hat");
    const head = socket ?? this.model?.getObjectByName("head");

    if (!head) {
      console.warn(
        "Otter head bone not found; hat could not be attached.",
      );

      return;
    }

    this.removeHat();

    let hatGltf;

    if (hatFile === hatUrl) {
      hatGltf =
        await loadHatGltf();
    } else {
      hatGltf =
        await loader.loadAsync(hatFile);
    }

    const hat =
      hatGltf.scene.clone(true);

    hat.name = "Hat";

    if (socket) {
      // Rest the hat's base on the socket. Some hats are modelled floating above
      // their origin (the wizard hat starts 0.12 up): drop those onto it. Hats that
      // dip below their origin (an inner crown) keep their origin as the base.
      hat.updateMatrixWorld(true);
      const bottom = new THREE.Box3().setFromObject(hat).min.y;
      hat.position.set(0, bottom > 0 ? -bottom : 0, 0);
    } else {
      hat.position.set(0, 0.36, 0);
    }

    head.add(hat);

    this.hat = hat;
    this.hatId =
      hatId ?? "hat";

    return hat;
  }

  /** While underwater, breathe out a few bubbles from the head every so often. */
  breathe(dt, bubbles, underwater) {
    this.breath = (this.breath ?? Math.random()) - dt;
    if (!underwater || this.breath > 0) return;
    this.breath = 0.5 + Math.random() * 0.8;
    this.headBone ??= this.model?.getObjectByName("head");
    this.breathAt ??= new THREE.Vector3();
    // The mouth, just under the nose, in the head bone's space (the nose tip is at
    // y 1.0, z 0.35 in the model; the head bone at y 0.8), so it follows the head.
    if (this.headBone) this.headBone.localToWorld(this.breathAt.set(0, 0.14, 0.38));
    else this.breathAt.copy(this.root.position).y += 1.5;
    bubbles.emit(this.breathAt, 1 + Math.floor(Math.random() * 3));
  }

  getHatId() {
    return this.hatId;
  }

  getHat() {
    return this.hat;
  }

  ownsHat(hatId) {
    if (hatId === "none") {
      return true;
    }

    return this.ownedHats[hatId] === true;
  }

  addHat(hatId) {
    if (!HAT_FILES[hatId]) {
      console.warn(
        `Unknown hat: ${hatId}`,
      );

      return false;
    }

    this.ownedHats[hatId] = true;

    return true;
  }

  buyHat(hatId) {
    if (!HAT_FILES[hatId]) {
      console.warn(
        `Unknown hat: ${hatId}`,
      );

      return false;
    }

    if (this.ownsHat(hatId)) {
      console.warn(
        `Hat already owned: ${hatId}`,
      );

      return false;
    }

    this.ownedHats[hatId] = true;

    return true;
  }

  removeOwnedHat(hatId) {
    if (hatId === "wizardHat") {
      console.warn(
        "Cannot remove the default wizard hat ownership.",
      );

      return false;
    }

    delete this.ownedHats[hatId];

    if (this.hatId === hatId) {
      this.removeHat();
    }

    return true;
  }

  getOwnedHats() {
    return {
      ...this.ownedHats,
    };
  }

  dispose() {
    this.setName(null);
    this.scene.remove(this.root);
    this.mixer?.stopAllAction();
  }
}
