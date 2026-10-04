export function isOnWater(player, water) {
  const halfWidth = water.geometry.parameters.width / 2;
  const halfDepth = water.geometry.parameters.depth / 2;

  const waterBottom =
    water.position.y - water.geometry.parameters.height / 2 - 1;

  const waterSurface =
    water.position.y + water.geometry.parameters.height / 2;

  const waterDetectionHeight = 19;

  return (
    player.x >= water.position.x - halfWidth &&
    player.x <= water.position.x + halfWidth &&
    player.y >= waterBottom &&
    player.y <= waterSurface + waterDetectionHeight &&
    player.z >= water.position.z - halfDepth &&
    player.z <= water.position.z + halfDepth
  );
}
