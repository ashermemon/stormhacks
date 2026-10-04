// Sitting on benches. Walk into a bench on land and the otter sits down (SitDown, then
// the Sit loop); press a direction or jump to get up again (StandUp). The clips are
// built around the bench's two markers: SitDown starts with him standing on StandPoint
// and carries him onto SitPoint, StandUp does the reverse. So his origin snaps to the
// seat when he sits and back to StandPoint when he's up, and nothing pops.
//
//   const seating = createSeating(scenery.benches, me);
//   // each frame, before movement; while it returns true, skip movement and physics:
//   const seated = seating.update(player, { moving, jump, onLand });
//   net.sendState({ ..., pose: seating.pose() });

const SIT_REACH = 1.6; // walk this close to a seat (horizontally) to sit on it
const REARM_DISTANCE = 2.6; // after getting up, step this far away before it sits you again
// How far below the bench's SitPoint he sits, so his bottom and legs rest on the seat.
// Eased in during SitDown and out during StandUp, so both ends still line up.
const SEAT_DROP = 0.15;

export function createSeating(benches, character) {
  let seat = null; // { bench, phase: "SitDown" | "Sit" | "StandUp", released }
  let armed = true;

  function nearestBench(player) {
    let best = null;
    let bestDistance = Infinity;
    for (const bench of benches) {
      const d = Math.hypot(bench.sit.x - player.x, bench.sit.z - player.z);
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
    /** The bench clip playing ("SitDown", "Sit", "StandUp"), or null. Sent to other players. */
    pose: () => seat?.phase ?? null,

    /**
     * moving / jump: this frame's input. onLand: not swimming.
     * Returns true while the otter belongs to a bench (skip walking and physics).
     */
    update(player, { moving, jump, onLand }) {
      if (!seat) {
        const { bench, distance } = nearestBench(player);
        if (!armed && distance > REARM_DISTANCE) armed = true;
        if (!armed || !bench || !onLand || !moving || distance > SIT_REACH) return false;
        seat = { bench, phase: "SitDown", released: false };
        armed = false;
        placeAt(player, bench.sit, bench.rotY);
        character.setPose("SitDown");
        return true;
      }

      const { bench } = seat;
      placeAt(player, bench.sit, bench.rotY);
      const settled =
        seat.phase === "SitDown" ? character.poseProgress()
        : seat.phase === "StandUp" ? 1 - character.poseProgress()
        : 1;
      player.y -= SEAT_DROP * settled;
      // Getting up needs a fresh press: the key held while walking in doesn't count.
      if (!moving && !jump) seat.released = true;

      if (seat.phase === "SitDown" && character.poseDone()) {
        seat.phase = "Sit";
        character.setPose("Sit");
      } else if (seat.phase === "Sit" && seat.released && (moving || jump)) {
        seat.phase = "StandUp";
        character.setPose("StandUp");
      } else if (seat.phase === "StandUp" && character.poseDone()) {
        placeAt(player, bench.stand, bench.rotY);
        character.setPose(null);
        seat = null;
        return false;
      }
      return true;
    },
  };
}
