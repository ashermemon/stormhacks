/**
 * Keeps an id -> display name map current from server events.
 * Seeded from the welcome message, updated on join / renamed, pruned on leave.
 *
 * onChange(id, name) is called when a known player's name changes (rename),
 * so callers can refresh whatever shows it (e.g. the nametag).
 */
export function trackNames(net, onChange) {
  const names = new Map(Object.entries(net.names));
  names.set(net.id, net.name);

  net.on('join', ({ id, name }) => names.set(id, name));
  net.on('renamed', ({ id, name }) => {
    names.set(id, name);
    onChange(id, name);
  });
  net.on('leave', ({ id }) => names.delete(id));

  return names;
}
