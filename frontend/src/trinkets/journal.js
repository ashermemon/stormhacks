// The otter's little book. Left page: trinkets cracked (species x tier stamps).
// Right page: what was found inside. Press J to open/close.

import { TIER_COLORS } from "./models.js";

const SPECIES_ICON = { clam: "🐚", crab: "🦀", urchin: "🟣", snail: "🐌" };

export function createJournal(catalog, initial) {
  let data = initial;
  let stamps = new Set(); // entries to stamp-animate the next time the book is shown

  const book = document.createElement("div");
  book.id = "journal";
  book.hidden = true;
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
              ? `<td class="got${stamp}" style="--tier:${TIER_COLORS[tier]}">${SPECIES_ICON[species]}<small>×${count}</small></td>`
              : `<td class="empty">?</td>`;
          })
          .join("");
        return `<tr><th>${species}</th>${cells}</tr>`;
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
              ? `<li class="got${stamp}">${item.name} <small>×${count}</small></li>`
              : `<li class="empty">???</li>`;
          })
          .join("");
        return `<h4 style="color:${TIER_COLORS[tier]}">${tier}</h4><ul>${items}</ul>`;
      })
      .join("");

    const tierHeads = catalog.tiers.map((t) => `<th style="color:${TIER_COLORS[t]}">${t[0].toUpperCase()}</th>`).join("");
    book.innerHTML = `
      <div class="page">
        <h3>Trinkets cracked</h3>
        <table><tr><th></th>${tierHeads}</tr>${rows}</table>
        <p class="shells">🐚 ${data.shells} shells</p>
      </div>
      <div class="page">
        <h3>Treasures found</h3>
        ${finds}
        <p class="hint">J to close</p>
      </div>`;
  }

  function toggle(open = book.hidden) {
    book.hidden = !open;
    if (open) {
      render();
      stamps = new Set(); // the stamp animation plays once
    }
  }

  return {
    toggle,
    isOpen: () => !book.hidden,
    /** Server sends the full journal after each crack; `highlights` are the entries to stamp. */
    update(next, highlights = []) {
      data = next;
      stamps = new Set(highlights);
      if (!book.hidden) render();
    },
  };
}
