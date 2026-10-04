const SIT_REACH = 1.8;
const REARM_DELAY = 2000; // milliseconds before sitting is allowed again
const SEAT_DROP = 0.15;

export function createSeating(benches, character) {
  let seat = null; // { bench, phase: "SitDown" | "Sit" | "StandUp", released }
  let armed = true;
  let rearmAt = 0;

  function nearestBench(player) {
    let best = null;
    let bestDistance = Infinity;

    for (const bench of benches) {
      const d = Math.hypot(
        bench.sit.x - player.x,
        bench.sit.z - player.z
      );

      if (d < bestDistance) [best, bestDistance] = [bench, d];
    }

    return { bench: best, distance: bestDistance };
  }

  function placeAt(player, spot, ry) {
    player.x = spot.x;
    player.y = spot.y;
    player.z = spot.z;
    player.ry = ry;
    player.vy = 0;
  }

  return {
    pose: () => seat?.phase ?? null,

    update(player, { moving, jump, onLand }) {
      if (!seat) {
        const { bench, distance } = nearestBench(player);

        // Wait 1.5 seconds after standing before another sit can trigger.
        if (!armed && performance.now() >= rearmAt) {
          armed = true;
        }

        if (
          !armed ||
          !bench ||
          !onLand ||
          !moving ||
          distance > SIT_REACH
        ) {
          return false;
        }

        seat = {
          bench,
          phase: "SitDown",
          released: false,
        };

        armed = false;

        placeAt(player, bench.sit, bench.rotY);
        character.setPose("SitDown");

        return true;
      }

      const { bench } = seat;

      placeAt(player, bench.sit, bench.rotY);

      const settled =
        seat.phase === "SitDown"
          ? character.poseProgress()
          : seat.phase === "StandUp"
            ? 1 - character.poseProgress()
            : 1;

      player.y -= SEAT_DROP * settled;

      // Getting up needs a fresh press.
      if (!moving && !jump) {
        seat.released = true;
      }

      if (seat.phase === "SitDown" && character.poseDone()) {
        seat.phase = "Sit";
        character.setPose("Sit");

      } else if (
        seat.phase === "Sit" &&
        seat.released &&
        (moving || jump)
      ) {
        seat.phase = "StandUp";
        character.setPose("StandUp");

      } else if (
        seat.phase === "StandUp" &&
        character.poseDone()
      ) {
        placeAt(player, bench.stand, bench.rotY);
        character.setPose(null);

        seat = null;

        // Start the 1.5-second re-sit cooldown.
        armed = false;
        rearmAt = performance.now() + REARM_DELAY;

        return false;
      }

      return true;
    },
  };
}