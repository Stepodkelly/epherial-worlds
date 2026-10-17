// Ordinary detector labels filed onto the world pack.
// A person is the audience, not a mob. Unknown labels are ignored.
export const COCO_SUBCLASS = {
  laptop: 'thinking_tool',
  keyboard: 'party_channel',
  mouse: 'thinking_tool',
  'cell phone': 'tunnel_relay',
  tv: 'room_screen',
  remote: 'room_screen',
  clock: 'floor_clock',
  microwave: 'service_machine',
  oven: 'service_machine',
  toaster: 'service_machine',
  refrigerator: 'cold_locker',
  sink: 'service_tap',
  'dining table': 'craft_bench',
  bottle: 'drinking_vessel',
  'wine glass': 'drinking_vessel',
  cup: 'drinking_vessel',
  bowl: 'drinking_vessel',
  vase: 'drinking_vessel',
  chair: 'safe_seat',
  couch: 'safe_seat',
  bench: 'safe_seat',
  bed: 'safe_seat',
  'potted plant': 'wall_growth',
  book: 'hall_map',
  scissors: 'handled_tool',
  knife: 'handled_tool',
  fork: 'handled_tool',
  spoon: 'handled_tool',
  toothbrush: 'handled_tool',
  suitcase: 'tiered_loot_box',
  backpack: 'bulk_cask',
  handbag: 'pocket_store',
  person: 'audience_feed',
  dog: 'patrol_dog',
  cat: 'patrol_dog',
  bird: 'patrol_dog',
  horse: 'patrol_dog',
};

export function indexPack(pack) {
  const byId = new Map();
  for (const group of pack.classes || []) {
    for (const sub of group.subclasses || []) {
      byId.set(sub.id, { id: sub.id, sub, group });
    }
  }
  return {
    pack,
    byId,
    factions: new Map((pack.factions || []).map((faction) => [faction.id, faction])),
    materials: new Map((pack.materials || []).map((material) => [material.id, material])),
  };
}

export function fitLabel(index, label) {
  const id = COCO_SUBCLASS[label];
  if (!id) return null;
  return index.byId.get(id) || null;
}

export function hash(text) {
  let value = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    value ^= text.charCodeAt(i);
    value = Math.imul(value, 16777619);
  }
  return value >>> 0;
}

export function verbsFor(record, example) {
  const verbs = [];
  const push = (list) => {
    for (const verb of list || []) {
      if (!verbs.includes(verb)) verbs.push(verb);
    }
  };
  if (record) {
    push(record.sub.verbs);
    push(record.group.verbs);
  }
  if (!verbs.length && example) push(example.verbs);
  return verbs;
}

export function exampleFor(pack, label, subclassId) {
  const needle = String(label || '').toLowerCase();
  return (pack.examples || []).find((entry) => {
    if (entry.subclass !== subclassId) return false;
    const real = String(entry.real || '').toLowerCase();
    return real === needle || real.includes(needle) || needle.includes(real);
  }) || null;
}

export function inventName(index, record, serial) {
  const faction = index.factions.get(record.group.naming_faction || record.group.faction);
  const tendencies = faction?.tendencies?.length ? faction.tendencies : (record.sub.look || ['marked']);
  const tendency = tendencies[(hash(record.id) + serial) % tendencies.length];
  const word = (String(tendency).match(/[A-Za-z]+/) || ['Marked'])[0];
  return `${word.charAt(0).toUpperCase()}${word.slice(1)} ${record.sub.name}`;
}

// One stored thing, and only one of that kind in view: it is the same thing,
// even if the camera has turned. Two in view are matched by where they sit.
export function recall(registry, subclass, nx, ny, siblingCount = 1) {
  const same = registry.filter((item) => item.subclass === subclass);
  if (same.length === 1 && siblingCount <= 1) return same[0];
  let best = null;
  let bestDistance = 0.28;
  for (const item of same) {
    const distance = Math.hypot((item.nx ?? 0.5) - nx, (item.ny ?? 0.5) - ny);
    if (distance < bestDistance) {
      best = item;
      bestDistance = distance;
    }
  }
  return best;
}

export function questFor(pack, tracks) {
  for (const quest of pack.quests || []) {
    const track = tracks.find((item) => {
      if (!item.filed) return false;
      if (item.done && item.done[quest.id]) return false;
      return item.subclass === quest.target || item.classId === quest.target;
    });
    if (track) return { quest, track };
  }
  return null;
}

export function goldIn(reward) {
  const match = String(reward || '').match(/(\d+)/);
  return match ? Number(match[1]) : 0;
}
