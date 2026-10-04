import hatUrl from "../assets/models/character/Beanie.glb?url";
import { PIXEL_SHELL_SVG } from "./trinkets/pixelShell.js";
import wizardHatUrl from "../assets/models/character/WizardHat.glb?url";
import beanie from "../assets/models/character/beanie.jpg?url";
const HATS = [
  {
    id: "none",
    name: "No Hat",
    file: null,
    preview: "—",
    price: 0,
  },
  {
    id: "hat",
    name: "Beanie",
    file: hatUrl,
    preview: beanie,
    price: 100,
  },
  {
    id: "wizardHat",
    name: "Wizard Hat",
    file: wizardHatUrl,
    preview: "🧙",
    price: 250,
  },
];

function renderPreview(preview) {
  if (!preview) {
    return "";
  }

  // Image preview
  if (
    typeof preview === "string" &&
    (
      preview.startsWith("/") ||
      preview.startsWith("./") ||
      preview.startsWith("../") ||
      preview.startsWith("http://") ||
      preview.startsWith("https://") ||
      preview.startsWith("data:image/")
    )
  ) {
    return `
      <img
        class="hat-preview-image"
        src="${preview}"
        alt=""
        style=" width: 96px; height: 96px; object-fit: contain; "
      />
    `;
  }

  // Emoji / text preview
  return `
    <span class="hat-preview-emoji">
      ${preview}
    </span>
  `;
}


export function createWardrobe(
  character,
  journal,
  onToggle,
  onPurchase,
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

  window.addEventListener("keydown", (e) => {
    if (e.code === "Escape" && !wardrobe.hidden) {
      toggle(false);
    }
  });

  function getShells() {
    return journal?.getShells?.() ?? 0;
  }

  function ownsHat(hatId) {
    if (hatId === "none") {
      return true;
    }

    return character.ownsHat(hatId);
  }

  function render() {
    const shells = getShells();

    wardrobe.innerHTML = `
      <div class="hat-page">

        <button
          class="hat-close"
          aria-label="Close wardrobe"
        >
          ×
        </button>

        <div class="hat-header">
          <div>
            <h2>Hat Wardrobe</h2>

            <p class="hat-subtitle">
              Choose something to wear
            </p>
          </div>

          <div class="hat-shells">
            <span class="hat-shell-icon">
              ${PIXEL_SHELL_SVG}
            </span>

            <span>
              ${shells}
            </span>
          </div>
        </div>

        <div class="hat-grid">

          ${HATS.map((hat, index) => {
            const owned =
              ownsHat(hat.id);

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
              >
                <div class="hat-preview">
                  ${
                    owned
                      ? renderPreview(hat.preview)
                      : "🔒"
                  }
                </div>

                <div class="hat-name">
                  ${hat.name}
                </div>
                <div class="hat-price"> ${ !owned ? ( hat.price === 0 ? "Free" : `${PIXEL_SHELL_SVG} ${hat.price}` ) : "" } </div>
                                ${
                                  !owned
                                    ? `
                                      <div class="hat-locked">
                                        ${
                                          shells >= hat.price
                                            ? "Buy"
                                            : "Not enough shells"
                                        }
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
    // Already owned: just equip it.
    if (ownsHat(hat.id)) {
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

      return;
    }

    // Not owned: check local wallet first.
    const shells = getShells();

    if (shells < hat.price) {
      console.warn(
        `Cannot buy ${hat.id}: not enough shells.`,
      );

      return;
    }

    if (!onPurchase) {
      console.warn(
        "Hat purchase handler is not connected.",
      );

      return;
    }

    // Server is authoritative for the purchase.
    const purchased =
      await onPurchase(hat.id);

    if (!purchased) {
      return;
    }

    // IMPORTANT:
    // The server accepted the purchase, so unlock
    // the hat in this Character instance.
    if (!character.addHat(hat.id)) {
      console.warn(
        `Purchase succeeded but hat could not be unlocked: ${hat.id}`,
      );

      return;
    }

    // Automatically equip the newly purchased hat.
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

      if (document.pointerLockElement) {
        document.exitPointerLock();
      }
    } else {
      if (!document.body.classList.contains("has-mobile-controls")) {
        const canvas = document.querySelector("canvas");
        canvas?.requestPointerLock()?.catch?.(() => {});
      }
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