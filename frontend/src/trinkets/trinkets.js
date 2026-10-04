// Trinket gameplay, client side. The server (backend/trinkets.py) owns the truth:
// which trinkets exist, who holds what, and what is inside. This file only draws
// and sends requests.
//
// Loop:  dive -> F near a trinket to grab -> surface -> F to start cracking ->
//        tap F on the beat -> reveal what was inside -> stamped into the journal (J).

import * as THREE from "three";
import { toonifyScene } from "../toonshading.js";
import { buildLoot, buildTrinket, TIER_COLORS } from "./models.js";
import { createJournal } from "./journal.js";
import { spawnPointFromSeed } from "./spawnZones.js";
import "./trinkets.css";

const GRAB_RANGE = 1.8; // from the otter's middle to the trinket
const GRAB_FLY_TIME = 0.3; // seabed -> paws
const CRACK_LIFT = 1.4; // how far above the paws a trinket is held while cracking
const BEAT_LEAD = 1.0; // seconds before the first beat
const BEAT_INTERVAL = 0.6;
const PERFECT_WINDOW = 0.08; // +- seconds around the beat
const GOOD_WINDOW = 0.18;
const FISH_HOLD_SECONDS = 0.05;
const MISS = 0, GOOD = 1, PERFECT = 2;
const REVEAL_ROLL_TIME = 1.3; // slot-machine spin before the tier lands
const REVEAL_HOLD_TIME = 3.0;
const SAND = [new THREE.Color("#c8b48a"), new THREE.Color("#a08c64")];
const BUBBLE = [new THREE.Color("#e8f7ff")];

// ---------------------------------------------------------------------------
// Little DOM helpers. Everything on screen is a plain element styled in trinkets.css.
// ---------------------------------------------------------------------------
function div(id, html = "") {
  const el = document.createElement("div");
  el.id = id;
  el.innerHTML = html;
  document.body.appendChild(el);
  return el;
}

function flash(el, text, className = "") {
  el.textContent = text;
  el.className = "";
  void el.offsetWidth; // restart the CSS animation
  el.className = `show ${className}`;
}

// One twinkle texture shared by every trinket: a four-point star.
function makeGlintTexture() {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d");
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(0.15, "rgba(255,255,240,0.8)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  g.fillStyle = "white";
  g.beginPath();
  g.moveTo(32, 0); g.lineTo(35, 29); g.lineTo(64, 32); g.lineTo(35, 35);
  g.lineTo(32, 64); g.lineTo(29, 35); g.lineTo(0, 32); g.lineTo(29, 29);
  g.fill();
  return new THREE.CanvasTexture(c);
}

// Where an otter holds things: just past both forearms, averaged.
function pawPosition(character, out) {
  const model = character?.model;
  if (!model) return character ? out.copy(character.root.position).setY(character.root.position.y + 0.8) : null;
  const bone = (name) => model.getObjectByName(name) ?? model.getObjectByName(name.replace(".", ""));
  const a = new THREE.Vector3(), b = new THREE.Vector3();
  out.set(0, 0, 0);
  for (const side of ["L", "R"]) {
    bone(`forearm.${side}`).getWorldPosition(a);
    bone(`upper_arm.${side}`).getWorldPosition(b);
    out.add(a.addScaledVector(a.clone().sub(b), 0.8)); // elbow + most of a forearm length
  }
  return out.multiplyScalar(0.5);
}

export function createTrinkets({ scene, net, zones, getCharacter, swimState, onJournalToggle }) {
  const trinkets = new Map(); // id -> see addTrinket()
  const particles = [];
  const glintTexture = makeGlintTexture();
  const particleGeometry = new THREE.IcosahedronGeometry(1, 0);
  const journal = createJournal(net.trinketCatalog, net.journal, onJournalToggle);
  let crack = null; // null | { pending } | { beats, grades, t } | { waiting }
  let reveal = null;
  let shake = 0;
  let time = 0;
  let player = null;
  let fishGrabHeld = false;
  let fishGrabTime = 0;

  const prompt = div("trinket-prompt");
  const toast = div("trinket-toast");
  const rhythm = div("trinket-rhythm", `<div class="pips"></div><div class="target"></div><span class="fThing">Press F to crack!</span><div class="ring"></div><div class="grade"></div>`);
  const card = div("trinket-reveal");
  const ring = rhythm.querySelector(".ring");
  const pips = rhythm.querySelector(".pips");
  const gradeText = rhythm.querySelector(".grade");

  // ---- trinkets in the world ------------------------------------------------
  function addTrinket(data, popIn = false) {
    const { group, colors } = buildTrinket(data.species, data.seed);
    toonifyScene(group);
    const spot = spawnPointFromSeed(zones, data.seed);
    group.position.copy(spot.position);
    group.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), spot.normal);
    group.rotateY(spot.yaw);

    const glint = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: glintTexture, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }),
    );
    glint.position.copy(spot.position).addScaledVector(spot.normal, 0.35);
    scene.add(group, glint);

    trinkets.set(data.id, {
      ...data,
      group,
      glint,
      colors,
      home: group.position.clone(),
      homeQuaternion: group.quaternion.clone(),
      twinklePhase: (data.seed % 1000) / 160, // so they don't all blink together
      grabT: 1, // 0..1 while flying into the paws
      popT: popIn ? 0 : 1, // 0..1 while appearing
      wobble: 0, // squash after a tap / denied grab
      lift: 0, // 0..1, raised over the head while cracking
    });
  }

  function removeTrinket(id) {
    const t = trinkets.get(id);
    if (!t) return null;
    scene.remove(t.group, t.glint);
    t.group.traverse((o) => o.geometry?.dispose()); // materials are shared, keep them
    t.glint.material.dispose();
    trinkets.delete(id);
    return t;
  }

  const myTrinket = () => [...trinkets.values()].find((t) => t.holder === net.id) ?? null;

  function nearestGrabbable() {
    if (!player || swimState() !== "under" || myTrinket()) return null;
    const me = new THREE.Vector3(player.x, player.y + 0.5, player.z);
    let best = null, bestDistance = GRAB_RANGE;
    for (const t of trinkets.values()) {
      if (t.holder) continue;
      const d = t.home.distanceTo(me);
      if (d < bestDistance) [best, bestDistance] = [t, d];
    }
    return best;
  }

  // ---- particles: small flat-coloured blobs with velocity, gravity and a lifetime ----
  function burst(position, colors, count, { speed = 2, gravity = 6, life = 0.7, size = 0.05, up = 1 } = {}) {
    for (let i = 0; i < count; i++) {
      const p = new THREE.Mesh(
        particleGeometry,
        new THREE.MeshBasicMaterial({ color: colors[i % colors.length], transparent: true }),
      );
      p.position.copy(position);
      const dir = new THREE.Vector3(Math.random() - 0.5, Math.random() * up, Math.random() - 0.5).normalize();
      p.userData = { v: dir.multiplyScalar(speed * (0.5 + Math.random())), gravity, life, maxLife: life, size: size * (0.6 + Math.random() * 0.8) };
      scene.add(p);
      particles.push(p);
    }
  }

  function updateParticles(dt) {
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      const d = p.userData;
      d.life -= dt;
      if (d.life <= 0) {
        scene.remove(p);
        p.material.dispose();
        particles.splice(i, 1);
        continue;
      }
      d.v.y -= d.gravity * dt;
      d.v.multiplyScalar(1 - 2 * dt); // water drag
      p.position.addScaledVector(d.v, dt);
      p.scale.setScalar(d.size * Math.min(1, d.life / d.maxLife * 2));
      p.material.opacity = Math.min(1, d.life / d.maxLife * 3);
    }
  }

  // ---- server messages -----------------------------------------------------
  for (const data of net.trinkets) addTrinket(data);

  net.on("trinket_taken", ({ trinket, by }) => {
    const t = trinkets.get(trinket.id);
    if (!t) return;
    t.holder = by;
    t.grabT = 0;
    // A puff of sand where it lay and a couple of bubbles, for whoever grabbed it.
    burst(t.home, SAND, 18, { speed: 2.5, gravity: 3, life: 0.9, size: 0.06, up: 0.6 });
    burst(t.home, BUBBLE, 8, { speed: 1, gravity: -4, life: 1.2, size: 0.05 });
    if (by === net.id) {
      shake = Math.max(shake, 0.12);
      flash(toast, `Got a ${t.species}!`);
    }
  });

  net.on("trinket_denied", ({ id }) => {
    const t = trinkets.get(id);
    if (t) t.wobble = 1;
    flash(toast, "Too slow!", "bad");
  });

  net.on("trinket_released", ({ trinket }) => {
    const t = trinkets.get(trinket.id);
    if (!t) return;
    if (t.holder === net.id) endCrack();
    t.holder = null;
    t.group.position.copy(t.home);
    t.group.quaternion.copy(t.homeQuaternion);
    t.group.scale.setScalar(1);
  });

  net.on("trinket_gone", ({ id, spawn }) => {
    const t = removeTrinket(id);
    if (t) burst(t.group.position, t.colors, 20, { speed: 3, life: 0.8, size: 0.06 });
    addTrinket(spawn, true);
  });

  net.on("trinket_spawn", ({ trinket }) => addTrinket(trinket, true));

  net.on("trinket_crack_begin", ({ beats }) => {
    crack = { beats, grades: [], t: 0 };
    pips.innerHTML = "<span></span>".repeat(beats);
    rhythm.className = "show";
  });

  net.on("trinket_cracked", ({ result, journal: nextJournal }) => {
    endCrack();
    const t = removeTrinket(result.id);
    const at = t ? t.group.position.clone() : new THREE.Vector3(player.x, player.y + 1 + CRACK_LIFT, player.z);
    burst(at, t?.colors ?? SAND, 40, { speed: 4.5, gravity: 8, life: 1, size: 0.07, up: 1.5 });
    shake = Math.max(shake, 0.3);

    const highlights = [];
    if (result.newEntry) highlights.push(`${result.species}:${result.tier}`);
    if (result.newItem) highlights.push(result.item);
    journal.update(nextJournal, highlights);
    startReveal(result, at);
  });

  // ---- cracking (rhythm) ---------------------------------------------------
  function beatTime(i) {
    return BEAT_LEAD + i * BEAT_INTERVAL;
  }

  function tap() {
    const target = beatTime(crack.grades.length);
    const off = Math.abs(crack.t - target);
    grade(off <= PERFECT_WINDOW ? PERFECT : off <= GOOD_WINDOW ? GOOD : MISS);
  }

  function grade(g) {
    crack.grades.push(g);
    pips.children[crack.grades.length - 1].className = ["miss", "good", "perfect"][g];
    flash(gradeText, ["MISS", "GOOD", "PERFECT!"][g], ["miss", "good", "perfect"][g]);
    const t = myTrinket();
    if (t && g !== MISS) {
      t.wobble = 1;
      burst(t.group.position, t.colors, g === PERFECT ? 14 : 6, { speed: 3, life: 0.5, size: 0.04 });
      shake = Math.max(shake, g === PERFECT ? 0.18 : 0.08);
    }
    if (crack.grades.length === crack.beats) {
      net.send({ type: "trinket_crack_end", grades: crack.grades });
      crack = { waiting: true };
      rhythm.className = "";
    }
  }

  function updateCrack(dt) {
    if (!crack?.beats) return;
    crack.t += dt;
    const target = beatTime(crack.grades.length);
    // The ring closes in on the target circle and touches it exactly on the beat.
    const scale = 1 + Math.max(0, (target - crack.t) / BEAT_INTERVAL) * 1.5;
    ring.style.transform = `translate(-50%, -50%) scale(${scale})`;
    ring.style.opacity = target - crack.t > BEAT_INTERVAL * 1.2 ? 0 : 1;
    if (crack.t > target + GOOD_WINDOW) grade(MISS);
  }

  function endCrack() {
    crack = null;
    rhythm.className = "";
  }

  // ---- reveal: slot-machine tier roll, then the loot pops out ----------------
  function startReveal(result, at) {
    if (reveal) finishReveal();
    const loot = buildLoot(result.item, result.itemTier);
    toonifyScene(loot);
    loot.visible = false;
    scene.add(loot);
    reveal = { result, at, loot, t: 0, landed: false, lastRoll: 0 };
    card.innerHTML = `<div class="tier"></div><div class="item"></div>`;
    card.className = "show rolling";
  }

  function updateReveal(dt) {
    if (!reveal) return;
    const r = reveal;
    r.t += dt;
    const { result } = r;
    const tierEl = card.querySelector(".tier");

    if (!r.landed) {
      // Spin through tier names, slowing down, like a reel.
      const progress = r.t / REVEAL_ROLL_TIME;
      if (r.t - r.lastRoll > 0.05 + progress * progress * 0.25) {
        r.lastRoll = r.t;
        const tier = net.trinketCatalog.tiers[Math.floor(Math.random() * 4)];
        tierEl.textContent = `${tier} ${result.species}`;
        tierEl.style.color = TIER_COLORS[tier];
      }
      if (r.t >= REVEAL_ROLL_TIME) land(r);
    } else {
      // Loot floats up out of the paws and spins.
      const k = Math.min(1, (r.t - REVEAL_ROLL_TIME) * 3);
      const pop = 1 + Math.sin(k * Math.PI) * 0.6;
      r.loot.position.copy(r.at).setY(r.at.y + k * 0.5 + Math.sin(time * 3) * 0.05);
      r.loot.rotation.y += dt * 3;
      r.loot.scale.setScalar(k * pop * (result.itemTier === "legendary" ? 2.2 : 1.6));
      if (r.t > REVEAL_ROLL_TIME + REVEAL_HOLD_TIME) finishReveal();
    }
  }

  function land(r) {
    const { result } = r;
    r.landed = true;
    r.loot.visible = true;
    const tierEl = card.querySelector(".tier");
    tierEl.textContent = `${result.tier} ${result.species}`;
    tierEl.style.color = TIER_COLORS[result.tier];
    card.querySelector(".item").innerHTML = `
      ${result.bumped ? `<div class="bump">✨ LUCKY! upgraded to ${result.itemTier}</div>` : ""}
      <div class="name" style="color:${TIER_COLORS[result.itemTier]}">${result.name}</div>
      <div class="shells">${result.shells ? `+${result.shells} shells` : "just sand… better luck next time"}${result.perfect ? " · perfect crack!" : ""}</div>
      ${result.newItem ? `<div class="new">NEW! in your journal</div>` : ""}`;
    card.className = `show landed ${result.itemTier}`;
    const color = [new THREE.Color(TIER_COLORS[result.itemTier]), new THREE.Color("#ffffff")];
    const big = result.itemTier === "legendary" ? 3 : result.itemTier === "rare" ? 2 : 1;
    burst(r.at, color, 25 * big, { speed: 3 + big, gravity: 2, life: 1.2, size: 0.05 });
    shake = Math.max(shake, 0.1 * big);
  }

  function finishReveal() {
    scene.remove(reveal.loot);
    reveal.loot.geometry.dispose();
    reveal = null;
    card.className = "";
  }

  // ---- input -----------------------------------------------------------------
  function pressAction() {
    if (crack?.beats) return tap();
    if (crack) return; // waiting for the server
    const held = myTrinket();
    if (held && swimState() === "surface") {
      crack = { pending: true };
      net.send({ type: "trinket_crack_begin" });
      return;
    }
    const near = nearestGrabbable();
    if (near?.species === "fish") {
      fishGrabHeld = true;
      fishGrabTime = 0;
      return;
    }
    if (near) net.send({ type: "trinket_grab", id: near.id });
  }

  function releaseAction() {
    fishGrabHeld = false;
  }

  window.addEventListener("keydown", (e) => {
    if (e.target instanceof HTMLInputElement || e.repeat) return;
    if (e.code === "KeyJ") journal.toggle();
    if (e.code === "Escape" && crack?.beats) {
      net.send({ type: "trinket_crack_cancel" });
      endCrack();
    }
    if (e.code === "KeyF") pressAction();
  });
  window.addEventListener("keyup", (e) => {
    if (e.code === "KeyF") releaseAction();
  });

  // ---- per frame ---------------------------------------------------------------
  function updatePrompt(near, held) {
    let text = "";
    if (crack) text = "";
    else if (held && swimState() === "surface") text = "<b>F / Act</b> crack it open!";
    else if (held) text = "Surface to the waterline to crack it open! <b>Shift / Rise</b> ⬆";
    else if (near) text = `<b>F / Act</b> grab the ${near.species}`;
    if (prompt.innerHTML !== text) prompt.innerHTML = text;
    prompt.className = text ? "show" : "";
  }

  const paw = new THREE.Vector3();
  return {
    /** Movement and diving are frozen while cracking. */
    busy: () => crack !== null,
    pressAction,
    releaseAction,
    toggleJournal: () => journal.toggle(),

    update(dt, currentPlayer, camera) {
      player = currentPlayer;
      time += dt;
      const near = nearestGrabbable();
      const held = myTrinket();

      if (near?.species === "fish" && fishGrabHeld && !held && !crack) {
        fishGrabTime += dt;
        if (fishGrabTime >= FISH_HOLD_SECONDS) {
          net.send({ type: "trinket_grab", id: near.id });
          fishGrabHeld = false;
          fishGrabTime = 0;
        }
      } else if (near?.species !== "fish") {
        fishGrabTime = 0;
      }

      for (const t of trinkets.values()) {
        t.wobble = Math.max(0, t.wobble - dt * 4);
        t.popT = Math.min(1, t.popT + dt * 2);
        const squash = 1 + Math.sin(t.wobble * Math.PI * 3) * t.wobble * 0.3;

        if (t.holder) {
          t.glint.visible = false;
          const character = getCharacter(t.holder);
          if (!pawPosition(character, paw)) {
            t.group.visible = false;
            continue;
          }
          t.group.visible = true;
          t.grabT = Math.min(1, t.grabT + dt / GRAB_FLY_TIME);
          const k = 1 - (1 - t.grabT) ** 3; // ease out
          t.group.position.lerpVectors(t.home, paw, k);
          t.group.position.y += Math.sin(k * Math.PI) * 0.6; // little hop on the way up
          // While cracking, hold it up over the head so the camera (behind the otter) sees it.
          // Each tap squashes it and knocks it down a little, like a bash on a rock.
          t.lift += ((t.holder === net.id && crack ? 1 : 0) - t.lift) * Math.min(1, dt * 10);
          t.group.position.y += t.lift * (CRACK_LIFT - t.wobble * 0.4);
          t.group.quaternion.slerpQuaternions(t.homeQuaternion, character.root.quaternion, k);
          const grow = 1 + Math.sin(k * Math.PI) * 0.4 + t.lift * 0.6;
          t.group.scale.set(squash, 1 / squash, squash).multiplyScalar(grow);
        } else {
          // On the seabed: twinkle now and then; the one you can grab pulses.
          const isNear = t === near;
          const twinkle = Math.max(0, Math.sin(time * 1.7 + t.twinklePhase)) ** 12;
          t.glint.visible = true;
          t.glint.material.opacity = isNear ? 0.9 : twinkle;
          t.glint.scale.setScalar(isNear ? 0.5 + Math.sin(time * 8) * 0.08 : 0.25 + twinkle * 0.3);
          const pulse = isNear ? 1.12 + Math.sin(time * 8) * 0.06 : 1;
          const pop = t.popT < 1 ? Math.sin(t.popT * Math.PI * 0.5) * (1 + Math.sin(t.popT * Math.PI) * 0.3) : 1;
          t.group.scale.set(squash, 1 / squash, squash).multiplyScalar(pulse * pop);
        }
      }

      updateCrack(dt);
      updateReveal(dt);
      updateParticles(dt);
      updatePrompt(near, held);

      // Camera shake on top of wherever game.js put the camera.
      if (shake > 0) {
        camera.position.x += (Math.random() - 0.5) * shake;
        camera.position.y += (Math.random() - 0.5) * shake;
        shake = Math.max(0, shake - dt * 1.5);
      }
    },
  };
}
