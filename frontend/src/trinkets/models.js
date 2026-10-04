// Procedural trinket meshes. Each species is a handful of primitives, varied by the seed
// (colour, size, rib/spike/leg counts). The tier is NOT shown: the server never tells
// us, so every trinket looks equally shiny until it is cracked.

import * as THREE from "three";
import { seededRandom } from "./spawnZones.js";

export const TIER_COLORS = {
  common: "#cfd8dc",
  uncommon: "#6fdc8c",
  rare: "#5aa9ff",
  legendary: "#ffc94d",
};

// Materials are shared by colour, so 40 trinkets don't mean 1000 materials.
const materials = new Map();
function material(color) {
  const key = new THREE.Color(color).getHexString();
  if (!materials.has(key)) materials.set(key, new THREE.MeshStandardMaterial({ color: `#${key}`, flatShading: true }));
  return materials.get(key);
}

function mesh(geometry, color) {
  return new THREE.Mesh(geometry, material(color));
}

function clam(random, hue) {
  const color = new THREE.Color().setHSL(hue, 0.35, 0.72);
  const ribs = 7 + Math.floor(random() * 6);
  // Half a sphere with radial ribs pushed into the rim.
  const shellGeometry = () => {
    const g = new THREE.SphereGeometry(0.3, 18, 6, 0, Math.PI * 2, 0, Math.PI / 2);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const rib = 1 + 0.08 * Math.sin(Math.atan2(p.getX(i), p.getZ(i)) * ribs);
      p.setXYZ(i, p.getX(i) * rib, p.getY(i), p.getZ(i) * rib);
    }
    g.computeVertexNormals();
    return g;
  };
  const group = new THREE.Group();
  const bottom = mesh(shellGeometry(), color.clone().multiplyScalar(0.85));
  bottom.scale.set(1, 0.35, 0.85);
  bottom.rotation.x = Math.PI; // dome facing down
  const top = mesh(shellGeometry(), color);
  top.scale.set(1, 0.4, 0.85);
  top.rotation.x = -0.12; // slightly open, a peek of the inside
  top.position.y = 0.02;
  group.add(bottom, top);
  group.position.y = 0.1;
  return { group, colors: [color, color.clone().offsetHSL(0, 0, -0.2)] };
}

function crab(random, hue) {
  const color = new THREE.Color().setHSL((0.98 + hue * 0.12) % 1, 0.65, 0.5);
  const dark = color.clone().multiplyScalar(0.7);
  const group = new THREE.Group();
  const body = mesh(new THREE.SphereGeometry(0.22, 10, 6), color);
  body.scale.set(1.2, 0.5, 0.9);
  body.position.y = 0.14;
  group.add(body);
  const legs = 2 + Math.floor(random() * 2); // per side
  for (const side of [-1, 1]) {
    for (let i = 0; i < legs; i++) {
      const leg = mesh(new THREE.CylinderGeometry(0.025, 0.02, 0.22, 4), dark);
      leg.position.set(side * 0.26, 0.08, -0.1 + (i * 0.18) / legs);
      leg.rotation.z = side * 1.0;
      group.add(leg);
    }
    const claw = mesh(new THREE.SphereGeometry(0.08 + random() * 0.04, 6, 4), color);
    claw.scale.set(1, 0.7, 1.4);
    claw.position.set(side * 0.2, 0.16, 0.26);
    const eye = mesh(new THREE.SphereGeometry(0.035, 6, 4), "#1b1b1b");
    eye.position.set(side * 0.07, 0.28, 0.15);
    group.add(claw, eye);
  }
  return { group, colors: [color, dark] };
}

function urchin(random, hue) {
  const color = new THREE.Color().setHSL((0.75 + hue * 0.2) % 1, 0.45, 0.35);
  const tip = color.clone().offsetHSL(0, 0, 0.25);
  const group = new THREE.Group();
  const core = mesh(new THREE.IcosahedronGeometry(0.17, 1), color);
  core.scale.y = 0.75;
  core.position.y = 0.12;
  group.add(core);
  // Spikes spread evenly over the upper part of a sphere (Fibonacci spiral).
  const spikes = 24 + Math.floor(random() * 16);
  const length = 0.18 + random() * 0.12;
  const up = new THREE.Vector3(0, 1, 0);
  for (let i = 0; i < spikes; i++) {
    const y = 1 - (i / spikes) * 1.2;
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    const angle = i * 2.39996;
    const dir = new THREE.Vector3(Math.cos(angle) * r, y, Math.sin(angle) * r).normalize();
    const spike = mesh(new THREE.ConeGeometry(0.018, length, 4), tip);
    spike.quaternion.setFromUnitVectors(up, dir);
    spike.position.copy(dir).multiplyScalar(0.15 + length / 2);
    spike.position.y += 0.12;
    group.add(spike);
  }
  return { group, colors: [color, tip] };
}

function snail(random, hue) {
  const shell = new THREE.Color().setHSL((0.06 + hue * 0.1) % 1, 0.5, 0.55);
  const stripe = shell.clone().offsetHSL(0, 0, -0.2);
  const skin = new THREE.Color().setHSL(0.12, 0.25, 0.7);
  const group = new THREE.Group();
  const foot = mesh(new THREE.CapsuleGeometry(0.07, 0.3, 3, 6), skin);
  foot.rotation.x = Math.PI / 2;
  foot.position.y = 0.06;
  group.add(foot);
  // Shell: a spiral of shrinking balls, alternating colours for stripes.
  const turns = 1.6 + random() * 0.8;
  const balls = 9;
  for (let i = 0; i < balls; i++) {
    const t = i / (balls - 1);
    const a = t * turns * Math.PI * 2;
    const r = 0.12 * (1 - t * 0.8);
    const ball = mesh(new THREE.SphereGeometry(0.13 * (1 - t * 0.75), 8, 6), i % 2 ? stripe : shell);
    ball.position.set(0, 0.2 + Math.sin(a) * r, -0.04 + Math.cos(a) * r);
    group.add(ball);
  }
  for (const side of [-1, 1]) {
    const stalk = mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.12, 4), skin);
    stalk.position.set(side * 0.03, 0.14, 0.2);
    stalk.rotation.x = 0.4;
    group.add(stalk);
  }
  return { group, colors: [shell, stripe] };
}

function fish(random, hue) {
  const color = new THREE.Color().setHSL((0.52 + hue * 0.3) % 1, 0.65, 0.52);
  const group = new THREE.Group();
  const body = mesh(new THREE.SphereGeometry(0.25, 8, 5), color);
  body.scale.set(1.5, 0.65, 0.65);
  const tail = mesh(new THREE.ConeGeometry(0.16, 0.35, 4), color.clone().multiplyScalar(0.8));
  tail.rotation.z = -Math.PI / 2;
  tail.position.x = -0.4;
  group.add(body, tail);
  return { group, colors: [color, color.clone().multiplyScalar(0.8)] };
}

const BUILDERS = { clam, crab, urchin, snail, fish };

/** Build a trinket. Returns { group, colors } — colors are used for crack shards. */
export function buildTrinket(species, seed) {
  const random = seededRandom(seed ^ 0x5eed);
  const hue = Math.round(random() * 24) / 24; // a few dozen palettes, not infinitely many
  const { group, colors } = BUILDERS[species](random, hue);
  group.scale.multiplyScalar(0.9 + random() * 0.35);
  const root = new THREE.Group();
  root.add(group);
  return { group: root, colors };
}

/** What falls out of a cracked trinket: a shape picked from the item id, tinted by tier. */
export function buildLoot(itemId, tier) {
  const color = new THREE.Color(TIER_COLORS[tier]);
  let geometry;
  if (itemId.includes("pearl")) geometry = new THREE.SphereGeometry(0.22, 16, 12);
  else if (itemId.includes("coin") || itemId.includes("button")) geometry = new THREE.CylinderGeometry(0.22, 0.22, 0.05, 16).rotateX(Math.PI / 2);
  else if (itemId === "gritty_sand") geometry = new THREE.DodecahedronGeometry(0.1, 0);
  else geometry = new THREE.DodecahedronGeometry(0.2, 0);
  const key = `loot:${tier}`;
  if (!materials.has(key)) materials.set(key, new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.35 }));
  return new THREE.Mesh(geometry, materials.get(key));
}
