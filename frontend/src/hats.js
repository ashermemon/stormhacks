import hatUrl from "../assets/models/character/Hat.glb?url";
import wizardHatUrl from "../assets/models/character/WizardHat.glb?url";

const HATS = [
  {
    id: "none",
    name: "No Hat",
    file: null,
    preview: "—",
  },
  {
    id: "hat",
    name: "Hat",
    file: hatUrl,
    preview: "🎩",
  },
  {
    id: "wizardHat",
    name: "Wizard Hat",
    file: wizardHatUrl,
    preview: "🧙",
  },
];

export function createWardrobe(
  character,
  onToggle,
) {
  let selected = character.getHatId();

  const backdrop =
    document.createElement("div");

  backdrop.id =
    "hat-wardrobe-backdrop";

  backdrop.hidden = true;

  const wardrobe =
    document.createElement("div");

  wardrobe.id =
    "hat-wardrobe";

  wardrobe.hidden = true;

  document.body.appendChild(backdrop);
  document.body.appendChild(wardrobe);

  backdrop.addEventListener(
    "click",
    () => toggle(false),
  );

  function ownsHat(hatId) {
    if (hatId === "none") {
      return true;
    }

    return character.ownsHat(hatId);
  }

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

          ${HATS.map((hat, index) => {
            const owned = ownsHat(hat.id);

            return `
              <button
                class="hat-card${
                  selected === hat.id
                    ? " selected"
                    : ""
                }${
                  !owned
                    ? " locked"
                    : ""
                }"
                data-hat="${index}"
                ${!owned ? "disabled" : ""}
              >
                <div class="hat-preview">
                  ${
                    owned
                      ? hat.preview
                      : "🔒"
                  }
                </div>

                <div class="hat-name">
                  ${hat.name}
                </div>

                ${
                  !owned
                    ? `
                      <div class="hat-locked">
                        Locked
                      </div>
                    `
                    : ""
                }
              </button>
            `;
          }).join("")}

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
              Number(
                button.dataset.hat,
              );

            await selectHat(
              HATS[index],
            );
          },
        );
      });
  }

  async function selectHat(hat) {
    if (!ownsHat(hat.id)) {
      console.warn(
        `Cannot equip ${hat.id}: hat is not owned.`,
      );

      return;
    }

    if (hat.file) {
      const result =
        await character.setHat(
          hat.file,
          hat.id,
        );

      if (!result) {
        return;
      }
    } else {
      character.removeHat();
    }

    selected = hat.id;

    render();
  }

  function toggle(
    open = wardrobe.hidden,
  ) {
    wardrobe.hidden = !open;
    backdrop.hidden = !open;

    if (open) {
      selected =
        character.getHatId();

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