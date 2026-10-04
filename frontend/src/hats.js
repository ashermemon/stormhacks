import hatUrl from "../assets/models/character/Hat.glb?url";

const HATS = [
  {
    name: "No Hat",
    file: null,
    preview: "—",
  },
  {
    name: "Hat",
    file: hatUrl,
    preview: "🎩",
  },
];

export function createWardrobe(
  character,
  onToggle,
) {
  let selected = null;

  const backdrop =
    document.createElement("div");

  backdrop.id =
    "hat-wardrobe-backdrop";

  backdrop.hidden = true;

  const wardrobe =
    document.createElement("div");

  wardrobe.id = "hat-wardrobe";
  wardrobe.hidden = true;

  document.body.appendChild(backdrop);
  document.body.appendChild(wardrobe);

  backdrop.addEventListener(
    "click",
    () => toggle(false),
  );

  function render() {
    wardrobe.innerHTML = `
      <div class="hat-page">

        <button
          class="hat-close"
          aria-label="Close wardrobe"
        >
          ×
        </button>

        <h2>Hat Wardrobe</h2>

        <p class="hat-subtitle">
          Choose something to wear
        </p>

        <div class="hat-grid">

          ${HATS.map((hat, index) => `
            <button
              class="hat-card${
                selected === hat.file
                  ? " selected"
                  : ""
              }"
              data-hat="${index}"
            >
              <div class="hat-preview">
                ${hat.preview}
              </div>

              <div class="hat-name">
                ${hat.name}
              </div>
            </button>
          `).join("")}

        </div>

        <p class="hat-hint">
          Click a hat to wear it
        </p>

      </div>
    `;

    wardrobe
      .querySelector(".hat-close")
      .addEventListener(
        "click",
        () => toggle(false),
      );

    wardrobe
      .querySelectorAll(".hat-card")
      .forEach((button) => {
        button.addEventListener(
          "click",
          async () => {
            const index =
              Number(button.dataset.hat);

            await selectHat(HATS[index]);
          },
        );
      });
  }

  async function selectHat(hat) {
    if (hat.file) {
      await character.setHat(hat.file);
      selected = hat.file;
    } else {
      character.removeHat();
      selected = null;
    }

    render();
  }

  function toggle(
    open = wardrobe.hidden,
  ) {
    wardrobe.hidden = !open;
    backdrop.hidden = !open;

    if (open) {
      render();
    }

    onToggle?.(open);
  }

  render();

  return {
    toggle,

    open() {
      toggle(true);
    },

    close() {
      toggle(false);
    },

    isOpen() {
      return !wardrobe.hidden;
    },
  };
}