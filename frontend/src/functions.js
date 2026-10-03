export function isOnWater(player, water) {
  const halfWidth = water.geometry.parameters.width / 2;
  const halfDepth = water.geometry.parameters.depth / 2;

  return (
    player.x >= water.position.x - halfWidth &&
    player.x <= water.position.x + halfWidth &&
    player.z >= water.position.z - halfDepth &&
    player.z <= water.position.z + halfDepth
  );
}
