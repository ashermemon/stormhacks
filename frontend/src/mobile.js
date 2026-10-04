/**
 * On-screen touch controls: left stick for move, right-side drag for look,
 * and buttons for jump/dive, rise, action (F), journal, and chat.
 */
import { setTouchAxes, setTouchButton } from "./input.js";
import "./mobile.css";

const STICK_RADIUS = 52;

function isTouchDevice() {
  return navigator.maxTouchPoints > 0 || window.matchMedia("(pointer: coarse)").matches;
}

function clampStick(dx, dy) {
  const len = Math.hypot(dx, dy);
  if (len > STICK_RADIUS) {
    dx = (dx / len) * STICK_RADIUS;
    dy = (dy / len) * STICK_RADIUS;
  }
  return { dx, dy, forward: -dy / STICK_RADIUS, right: dx / STICK_RADIUS };
}

/**
 * @param {{
 *   onLook: (dx: number, dy: number) => void,
 *   onAction: (pressed: boolean) => void,
 *   onJournal: () => void,
 *   onChat: () => void,
 * }} handlers
 */
export function createMobileControls({ onLook, onAction, onJournal, onChat }) {
  if (!isTouchDevice()) return null;

  document.body.classList.add("has-mobile-controls");

  const root = document.createElement("div");
  root.id = "mobile-controls";
  root.innerHTML = `
    <div class="mobile-stick" id="mobile-stick">
      <div class="mobile-stick-base"></div>
      <div class="mobile-stick-knob" id="mobile-stick-knob"></div>
    </div>
    <div class="mobile-look" id="mobile-look"></div>
    <div class="mobile-actions">
      <button type="button" class="mobile-btn mobile-btn-sm" id="mobile-chat" aria-label="Chat">Chat</button>
      <button type="button" class="mobile-btn mobile-btn-sm" id="mobile-journal" aria-label="Journal">Book</button>
      <button type="button" class="mobile-btn" id="mobile-sink" aria-label="Swim down">Sink</button>
      <button type="button" class="mobile-btn mobile-btn-lg" id="mobile-jump" aria-label="Jump or swim up">Jump / Rise</button>
      <button type="button" class="mobile-btn mobile-btn-lg mobile-btn-action" id="mobile-action" aria-label="Grab or crack">Act</button>
    </div>
  `;
  document.body.appendChild(root);

  // Prevent page scroll / pinch while playing.
  document.documentElement.style.touchAction = "none";
  document.body.style.touchAction = "none";
  document.body.style.overscrollBehavior = "none";

  // ---- joystick -------------------------------------------------------------
  const stick = root.querySelector("#mobile-stick");
  const knob = root.querySelector("#mobile-stick-knob");
  let stickId = null;

  function resetStick() {
    stickId = null;
    knob.style.transform = "translate(-50%, -50%)";
    setTouchAxes(0, 0);
  }

  function moveStick(clientX, clientY) {
    const rect = stick.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const { dx, dy, forward, right } = clampStick(clientX - cx, clientY - cy);
    knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
    setTouchAxes(forward, right);
  }

  stick.addEventListener(
    "touchstart",
    (e) => {
      e.preventDefault();
      e.stopPropagation();
      const t = e.changedTouches[0];
      stickId = t.identifier;
      moveStick(t.clientX, t.clientY);
    },
    { passive: false },
  );

  // ---- look zone (right half, behind buttons) -------------------------------
  const look = root.querySelector("#mobile-look");
  let lookId = null;
  let lookX = 0;
  let lookY = 0;

  look.addEventListener(
    "touchstart",
    (e) => {
      // Don't steal touches that land on action buttons (they're siblings above).
      const t = e.changedTouches[0];
      lookId = t.identifier;
      lookX = t.clientX;
      lookY = t.clientY;
    },
    { passive: true },
  );

  // ---- hold buttons ---------------------------------------------------------
  function bindHold(el, name) {
    const down = (e) => {
      e.preventDefault();
      e.stopPropagation();
      el.classList.add("active");
      setTouchButton(name, true);
    };
    const up = (e) => {
      e.preventDefault();
      e.stopPropagation();
      el.classList.remove("active");
      setTouchButton(name, false);
    };
    el.addEventListener("touchstart", down, { passive: false });
    el.addEventListener("touchend", up, { passive: false });
    el.addEventListener("touchcancel", up, { passive: false });
  }

  bindHold(root.querySelector("#mobile-jump"), "jump");
  bindHold(root.querySelector("#mobile-sink"), "sink");

  const actionBtn = root.querySelector("#mobile-action");
  actionBtn.addEventListener(
    "touchstart",
    (e) => {
      e.preventDefault();
      e.stopPropagation();
      actionBtn.classList.add("active");
      onAction(true);
    },
    { passive: false },
  );
  const actionUp = (e) => {
    e.preventDefault();
    e.stopPropagation();
    actionBtn.classList.remove("active");
    onAction(false);
  };
  actionBtn.addEventListener("touchend", actionUp, { passive: false });
  actionBtn.addEventListener("touchcancel", actionUp, { passive: false });

  root.querySelector("#mobile-journal").addEventListener(
    "touchstart",
    (e) => {
      e.preventDefault();
      e.stopPropagation();
      onJournal();
    },
    { passive: false },
  );
  root.querySelector("#mobile-chat").addEventListener(
    "touchstart",
    (e) => {
      e.preventDefault();
      e.stopPropagation();
      onChat();
    },
    { passive: false },
  );

  // ---- shared move / end ----------------------------------------------------
  window.addEventListener(
    "touchmove",
    (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier === stickId) {
          e.preventDefault();
          moveStick(t.clientX, t.clientY);
        } else if (t.identifier === lookId) {
          e.preventDefault();
          onLook(t.clientX - lookX, t.clientY - lookY);
          lookX = t.clientX;
          lookY = t.clientY;
        }
      }
    },
    { passive: false },
  );

  window.addEventListener(
    "touchend",
    (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier === stickId) resetStick();
        if (t.identifier === lookId) lookId = null;
      }
    },
    { passive: true },
  );
  window.addEventListener(
    "touchcancel",
    (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier === stickId) resetStick();
        if (t.identifier === lookId) lookId = null;
      }
    },
    { passive: true },
  );

  return {
    dispose() {
      resetStick();
      setTouchButton("jump", false);
      setTouchButton("sink", false);
      root.remove();
      document.body.classList.remove("has-mobile-controls");
    },
  };
}
