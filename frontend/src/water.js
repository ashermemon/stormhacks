import { WATER_SURFACE_Y } from "./world.js";

const GRAVITY = 25;
const JUMP_VELOCITY = 9;
const DIVE_ANGLE = (35 * Math.PI) / 180;
const DIVE_SPEED = 3.5;
const RISE_SPEED = 3;
const SWIM_DEPTH = 0.45; // water deeper than this is swum, shallower is walked
const SWIM_FLOOR_MARGIN = 0.5; // diving stops this far above the bed
const SETTLE_SPEED = 5; // units/sec: easing onto the ground / up to the surface
const AIRBORNE_HEIGHT = 0.3; // this far above the ground counts as in the air

const underwaterOverlay = document.createElement('div');

underwaterOverlay.style.position = 'fixed';
underwaterOverlay.style.inset = '0';
underwaterOverlay.style.background = 'rgba(0, 100, 255, 0.18)'; // underwater tint: alpha = strength
underwaterOverlay.style.pointerEvents = 'none';
underwaterOverlay.style.zIndex = '9999';
underwaterOverlay.style.opacity = '0';
underwaterOverlay.style.transition = 'opacity 0.3s ease';

document.body.appendChild(underwaterOverlay);

// Swim / walk / jump physics over the World.glb terrain. The water surface is the
// plane y = WATER_SURFACE_Y; wherever the ground is more than SWIM_DEPTH below it
// the otter swims (SwimSurface expects his origin right at the surface).
export function createAquaticArea(getGroundHeight) {
  const waterDepthAt = (x, z) => WATER_SURFACE_Y - getGroundHeight(x, z);
  // null = on land / in the air, "surface" = swimming on top, "under" = below the surface.
  let swimState = null;
  let grounded = true;
  let jumpWasDown = false;

  function stepVerticalMotion(player, controls, dt) {
    const ground = getGroundHeight(player.x, player.z);
    const inWater = waterDepthAt(player.x, player.z) > SWIM_DEPTH;
    const jumpPressed = controls.jumpDown && !jumpWasDown;
    jumpWasDown = controls.jumpDown;

    if (!inWater && swimState) {
      swimState = null;
      grounded = true; // climbed out onto the bank
    }

    if (swimState === null) {
      if (jumpPressed && grounded) {
        player.vy = JUMP_VELOCITY;
        grounded = false;
      }
      if (grounded) {
        // Follow the ground; ease down small drops (like stepping out of the water).
        player.vy = 0;
        player.y = Math.max(ground, player.y - SETTLE_SPEED * dt);
        if (player.y - ground > AIRBORNE_HEIGHT) grounded = false;
      } else {
        player.vy -= GRAVITY * dt;
        player.y += player.vy * dt;
      }
      if (inWater && player.y <= WATER_SURFACE_Y) {
        if (player.vy < -0.5) {
          // A jump landing in the water carries its downward momentum into a sink.
          swimState = "under";
          player.vy = -Math.min(14, Math.abs(player.vy) * 1.4);
        } else {
          swimState = "surface";
        }
      } else if (!inWater && player.y <= ground) {
        player.y = ground;
        player.vy = 0;
        grounded = true;
      }
    }

    if (swimState === "surface") {
      // Ease up to the surface (walking in from the shallows starts below it).
      player.y = Math.min(WATER_SURFACE_Y, player.y + SETTLE_SPEED * dt);
      player.vy = 0;
      if (controls.dive) swimState = "under";
    }

    if (swimState === "under") {
      if (controls.dive) {
        // The tilt is baked into the Dive clip, so travel along that same angle.
        const step = DIVE_SPEED * dt;
        player.x += Math.sin(player.ry) * Math.cos(DIVE_ANGLE) * step;
        player.z += Math.cos(player.ry) * Math.cos(DIVE_ANGLE) * step;
        player.y -= Math.sin(DIVE_ANGLE) * step;
        player.vy = 0;
      } else if (controls.rise) {
        player.y += RISE_SPEED * dt;
        player.vy = 0;
      } else {
        player.y += player.vy * dt;
        player.vy *= Math.exp(-3.5 * dt);
      }
      const floor = getGroundHeight(player.x, player.z) + SWIM_FLOOR_MARGIN;
      player.y = Math.max(floor, player.y);
      if (player.y >= WATER_SURFACE_Y) {
        player.y = WATER_SURFACE_Y;
        swimState = "surface";
      }
    }

    const underwater = swimState === "under" && player.y < WATER_SURFACE_Y - 0.5;
    underwaterOverlay.style.opacity = underwater ? "1" : "0";
  }

  // Which animation mode fits an otter at this position moving vertically at vy:
  // "land", "air", "surface", "dive", "hover" or "rise". Works for remote players
  // too, since it only needs what the network sends.
  function swimModeAt(position, vy) {
    const ground = getGroundHeight(position.x, position.z);
    const inWater = WATER_SURFACE_Y - ground > SWIM_DEPTH;
    if (!inWater || position.y > WATER_SURFACE_Y + 0.05) {
      return position.y - ground > AIRBORNE_HEIGHT ? "air" : "land";
    }
    if (position.y > WATER_SURFACE_Y - 0.15) return "surface";
    // Rising through the top of the water (e.g. easing up after wading in) is just
    // surfacing; a real climb from deeper hands over to "surface" near the top too.
    if (vy > 0.3) return position.y > WATER_SURFACE_Y - 0.6 ? "surface" : "rise";
    if (vy < -0.3) return "dive";
    return "hover";
  }

  return {
    stepPhysics: stepVerticalMotion,
    swimState: () => swimState,
    swimModeAt,
  };
}
