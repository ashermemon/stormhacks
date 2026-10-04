// The otter's little book. Left page: trinkets cracked (species x tier stamps), each
// one its Trinkets.glb model in the tier's colour, spinning. Right page: what was
// found inside. Press J to open/close.

import * as THREE from "three";
import { iconModelName, TIER_COLORS, trinketModel } from "./models.js";
import { PIXEL_SHELL_SVG } from "./pixelShell.js";

const ICON_PIXELS = 96; // each spinning model is drawn this big, shown at half size (sharp on hi-dpi)
const ICON_SPIN = 0.8; // radians per second

// One small offscreen renderer draws every spinning trinket, one after another, into
// each cell's own canvas. It only runs while the journal is open.
function createIconRenderer() {
  const renderer = new THREE.WebGLRenderer({
    alpha: true,
    antialias: true,
    stencil: true,
  });
  renderer.setSize(ICON_PIXELS, ICON_PIXELS, false);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 20);
  camera.position.set(0, 1.1, 4);
  camera.lookAt(0, 0, 0);
  const models = new Map(); // "species:tier" -> model, sized to fit the view

  function modelFor(key) {
    if (!models.has(key)) {
      const [species, tier] = key.split(":");
      const name = iconModelName(species);
      const model = name && trinketModel(name, TIER_COLORS[tier], 1);
      if (model) {
        const size = new THREE.Box3()
          .setFromObject(model)
          .getSize(new THREE.Vector3());
        model.scale.setScalar(2 / Math.max(size.x, size.y, size.z));
      }
      models.set(key, model);
    }
    return models.get(key);
  }

  return {
    draw(canvas, time) {
      const model = modelFor(canvas.dataset.key);
      if (!model) return;
      model.rotation.y = time * ICON_SPIN + Number(canvas.dataset.phase);
      scene.add(model);
      renderer.render(scene, camera);
      scene.remove(model);
      const ctx = canvas.getContext("2d");
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(renderer.domElement, 0, 0, canvas.width, canvas.height);
    },
  };
}

export function createJournal(catalog, initial, onToggle) {
  let data = initial;
  let stamps = new Set();
  let icons = null; // created the first time the journal opens
  let spinning = 0;

  const book = document.createElement("div");
  book.id = "journal";
  book.hidden = true;

  const backdrop = document.createElement("div");
  backdrop.id = "journal-backdrop";
  backdrop.hidden = true;

  backdrop.addEventListener("click", () => toggle(false));

  document.body.appendChild(backdrop);
  document.body.appendChild(book);

  function render() {
    const rows = catalog.species
      .map((species) => {
        const cells = catalog.tiers
          .map((tier) => {
            const key = `${species}:${tier}`;
            const count = data.trinkets[key] ?? 0;
            const stamp = stamps.has(key) ? " stamp" : "";

            return count
              ? `
                <td
                  class="got${stamp}"
                  style="--tier:${TIER_COLORS[tier]}"
                >
                  <canvas
                    class="trinket-icon"
                    data-key="${key}"
                    data-phase="${(catalog.tiers.indexOf(tier) * 0.8).toFixed(1)}"
                    width="${ICON_PIXELS}"
                    height="${ICON_PIXELS}"
                  ></canvas>
                  <small>×${count}</small>
                </td>
              `
              : `
                <td class="empty">
                  ?
                </td>
              `;
          })
          .join("");

        return `
          <tr>
            <th>${species}</th>
            ${cells}
          </tr>
        `;
      })
      .join("");

    const finds = catalog.tiers
      .map((tier) => {
        const items = catalog.items
          .filter((item) => item.tier === tier)
          .map((item) => {
            const count = data.finds[item.id] ?? 0;
            const stamp = stamps.has(item.id) ? " stamp" : "";

            return count
              ? `
                <li class="got${stamp}">
                  ${item.name}
                  <small>×${count}</small>
                </li>
              `
              : `
                <li class="empty">
                  ???
                </li>
              `;
          })
          .join("");

        return `
          <h4 style="color:${TIER_COLORS[tier]}">
            ${tier}
          </h4>

          <ul>
            ${items}
          </ul>
        `;
      })
      .join("");

    const tierHeads = catalog.tiers
      .map(
        (t) => `
            <th style="color:${TIER_COLORS[t]}">
              ${t[0].toUpperCase()}
            </th>
          `,
      )
      .join("");

    book.innerHTML = `
      <div class="page">
        <h3>Trinkets cracked</h3>

        <table>
          <tr>
            <th></th>
            ${tierHeads}
          </tr>

          ${rows}
        </table>

        <p class="shells">
          <span class="shell-icon">${PIXEL_SHELL_SVG}</span>
          ${data.shells} shells
        </p>
      </div>

      <div class="page">
        <h3>Treasures found</h3>

        ${finds}

        <p class="hint">
          J to close
        </p>
      </div>
    `;
  }

  // Spin every trinket in the journal while it's open.
  function spin(now) {
    if (book.hidden) {
      spinning = 0;
      return;
    }
    for (const canvas of book.querySelectorAll("canvas.trinket-icon"))
      icons.draw(canvas, now / 1000);
    spinning = requestAnimationFrame(spin);
  }

  function toggle(open = book.hidden) {
    book.hidden = !open;
    backdrop.hidden = !open;

    if (open) {
      render();
      stamps = new Set();
      icons ??= createIconRenderer();
      if (!spinning) spinning = requestAnimationFrame(spin);
    }

    onToggle?.(open);
  }

  return {
    toggle,

    isOpen() {
      return !book.hidden;
    },

    getShells() {
      return data.shells ?? 0;
    },

    spendShells(amount) {
      const cost = Number(amount);

      if (!Number.isFinite(cost) || cost < 0) {
        return false;
      }

      const shells = data.shells ?? 0;

      if (shells < cost) {
        return false;
      }

      data = {
        ...data,
        shells: shells - cost,
      };

      if (!book.hidden) {
        render();
      }

      return true;
    },

    update(next, highlights = []) {
      data = next;
      stamps = new Set(highlights);

      if (!book.hidden) {
        render();
      }
    },
  };
}
