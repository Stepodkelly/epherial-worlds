export function iou(a, b) {
  const ax2 = a[0] + a[2];
  const ay2 = a[1] + a[3];
  const bx2 = b[0] + b[2];
  const by2 = b[1] + b[3];
  const x1 = Math.max(a[0], b[0]);
  const y1 = Math.max(a[1], b[1]);
  const x2 = Math.min(ax2, bx2);
  const y2 = Math.min(ay2, by2);
  const width = Math.max(0, x2 - x1);
  const height = Math.max(0, y2 - y1);
  const inter = width * height;
  const union = a[2] * a[3] + b[2] * b[3] - inter;
  return union <= 0 ? 0 : inter / union;
}

// Map a box in video pixels onto a cover-fitted view. Mirroring matches a
// front camera that is displayed flipped.
export function coverRect(box, videoWidth, videoHeight, viewWidth, viewHeight, mirrored) {
  if (!videoWidth || !videoHeight || !viewWidth || !viewHeight) {
    return { x: 0, y: 0, w: 0, h: 0 };
  }
  const scale = Math.max(viewWidth / videoWidth, viewHeight / videoHeight);
  const offsetX = (viewWidth - videoWidth * scale) / 2;
  const offsetY = (viewHeight - videoHeight * scale) / 2;
  const w = box[2] * scale;
  const h = box[3] * scale;
  let x = box[0] * scale + offsetX;
  const y = box[1] * scale + offsetY;
  if (mirrored) x = viewWidth - (x + w);
  return { x, y, w, h };
}

let nextId = 1;

export function updateTracks(tracks, detections) {
  const used = new Set();
  for (const track of tracks) {
    if (track.manual) continue;
    let best = -1;
    let bestOverlap = 0;
    detections.forEach((detection, index) => {
      if (used.has(index)) return;
      const overlap = iou(track.bbox, detection.bbox);
      const same = !track.subclass || track.subclass === detection.subclass;
      const minimum = same ? 0.25 : 0.55;
      if (overlap >= minimum && overlap > bestOverlap) {
        best = index;
        bestOverlap = overlap;
      }
    });
    if (best >= 0) {
      used.add(best);
      absorb(track, detections[best]);
    } else {
      track.missed += 1;
    }
  }

  detections.forEach((detection, index) => {
    if (used.has(index)) return;
    tracks.push({
      id: nextId++,
      bbox: detection.bbox.slice(),
      subclass: detection.subclass,
      classId: detection.classId,
      label: detection.label,
      score: detection.score,
      age: 1,
      missed: 0,
      manual: false,
      pending: '',
      pendingCount: 0,
      filed: null,
      done: {},
    });
  });

  return tracks.filter((track) => track.manual || track.missed < 10);
}

export function manualTrack(subclass, classId, bbox) {
  return {
    id: nextId++,
    bbox: bbox.slice(),
    subclass,
    classId,
    label: 'filed',
    score: 1,
    age: 8,
    missed: 0,
    manual: true,
    pending: '',
    pendingCount: 0,
    filed: null,
    done: {},
  };
}

function absorb(track, detection) {
  const blend = 0.42;
  for (let i = 0; i < 4; i += 1) {
    track.bbox[i] += (detection.bbox[i] - track.bbox[i]) * blend;
  }
  track.age += 1;
  track.missed = 0;
  track.score = detection.score;
  track.label = detection.label;
  const changed = detection.subclass !== track.subclass;
  if (track.age > 8 && changed) {
    if (track.pending !== detection.subclass) {
      track.pending = detection.subclass;
      track.pendingCount = 1;
    } else {
      track.pendingCount += 1;
    }
    if (track.pendingCount >= 4) {
      track.subclass = detection.subclass;
      track.classId = detection.classId;
      track.pending = '';
      track.pendingCount = 0;
      track.filed = null;
    }
    return;
  }
  track.subclass = detection.subclass;
  track.classId = detection.classId;
  track.pending = '';
  track.pendingCount = 0;
}
