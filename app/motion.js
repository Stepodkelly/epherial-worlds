const EFFECT_FILES = {
  idle: 'glow.png',
  selected: 'selected.png',
  reward: 'reward.png',
};

export function effectLayer(kind) {
  const file = EFFECT_FILES[kind];
  if (!file) return '';
  return `../sprites/effects/${file}`;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function boxArea(track) {
  const bbox = track?.bbox;
  if (Array.isArray(bbox) && bbox.length >= 4) {
    const width = Number(bbox[2]);
    const height = Number(bbox[3]);
    if (Number.isFinite(width) && Number.isFinite(height)) return width * height;
  }
  const rect = track?.rect;
  if (rect) {
    const width = Number(rect.w);
    const height = Number(rect.h);
    if (Number.isFinite(width) && Number.isFinite(height)) return width * height;
  }
  return 0;
}

function trackId(track) {
  const id = Number(track?.id);
  return Number.isFinite(id) ? id : 0;
}

export function motionStyle(track, timeSeconds, aimX, aimY, viewArea) {
  const view = Number(viewArea);
  let depth = (boxArea(track) / view) * 10;
  if (!Number.isFinite(depth)) depth = 0.4;
  depth = clamp(depth, 0.4, 1.4);
  const time = Number(timeSeconds);
  const bob = Math.sin((Number.isFinite(time) ? time : 0) * 2.2 + trackId(track)) * 7;
  const ax = Number(aimX);
  const ay = Number(aimY);
  const aimXN = Number.isFinite(ax) ? ax : 0;
  const aimYN = Number.isFinite(ay) ? ay : 0;
  return {
    bob,
    shiftX: aimXN * 20 * depth,
    shiftY: aimYN * 8 * depth,
    shadowX: aimXN * 6 * depth,
  };
}
