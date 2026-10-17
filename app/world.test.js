import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { coverRect, iou, manualTrack, updateTracks } from './track.js';
import {
  COCO_SUBCLASS,
  exampleFor,
  fitLabel,
  indexPack,
  inventName,
  questFor,
  recall,
} from './world.js';

const pack = JSON.parse(readFileSync(new URL('../world-pack.json', import.meta.url), 'utf8'));
const index = indexPack(pack);

test('every detector label lands on a subclass in the pack', () => {
  for (const [label, id] of Object.entries(COCO_SUBCLASS)) {
    const fitted = fitLabel(index, label);
    assert.ok(fitted, label);
    assert.equal(fitted.id, id);
  }
  assert.equal(fitLabel(index, 'toilet'), null);
  assert.equal(fitLabel(index, 'laptop').id, 'thinking_tool');
  assert.equal(fitLabel(index, 'person').id, 'audience_feed');
});

test('a bottle keeps the prepared name and a second one does not', () => {
  const record = fitLabel(index, 'bottle');
  const example = exampleFor(pack, 'bottle', record.id);
  assert.equal(example.name, 'Old-Bone Pitch Canteen');
  const named = inventName(index, record, 1);
  assert.notEqual(named, example.name);
  assert.match(named, /Vessel|Canteen|Pitch|drinking/i);
});

test('one stored laptop is remembered, and two are kept apart', () => {
  const registry = [{ id: 'obj_1', subclass: 'thinking_tool', name: 'Lying Scrap-Glass', nx: 0.1, ny: 0.1 }];
  assert.equal(recall(registry, 'thinking_tool', 0.9, 0.9).name, 'Lying Scrap-Glass');
  assert.equal(recall(registry, 'thinking_tool', 0.9, 0.9, 2), null);
  registry.push({ id: 'obj_2', subclass: 'thinking_tool', name: 'Other', nx: 0.8, ny: 0.8 });
  assert.equal(recall(registry, 'thinking_tool', 0.82, 0.78, 2).name, 'Other');
  assert.equal(recall(registry, 'thinking_tool', 0.1, 0.9, 2), null);
});

test('quests see a class target and a finished one stays done', () => {
  const tracks = [{
    filed: { name: 'Bench' },
    subclass: 'safe_seat',
    classId: 'seat',
    done: {},
  }];
  assert.equal(questFor(pack, tracks).quest.id, 'rest_seat');
  tracks[0].done.rest_seat = true;
  assert.equal(questFor(pack, tracks), null);
});

test('cover fit mirrors a front camera and keeps the center', () => {
  const rect = coverRect([0, 0, 50, 50], 100, 100, 200, 100, false);
  assert.equal(rect.w, 100);
  assert.equal(rect.y, -50);
  const flipped = coverRect([0, 0, 50, 50], 100, 100, 200, 100, true);
  assert.equal(flipped.x, 100);
  assert.equal(iou([0, 0, 10, 10], [0, 0, 10, 10]), 1);
  assert.equal(iou([0, 0, 10, 10], [20, 20, 10, 10]), 0);
});

test('a track keeps its id and a pin survives an empty frame', () => {
  const tracks = updateTracks([], [{
    bbox: [0, 0, 40, 40],
    subclass: 'thinking_tool',
    classId: 'technology',
    label: 'laptop',
    score: 0.9,
  }]);
  const id = tracks[0].id;
  const again = updateTracks(tracks, [{
    bbox: [2, 2, 40, 40],
    subclass: 'thinking_tool',
    classId: 'technology',
    label: 'laptop',
    score: 0.9,
  }]);
  assert.equal(again.length, 1);
  assert.equal(again[0].id, id);
  assert.equal(again[0].age, 2);
  const pinned = manualTrack('room_door', 'doorway', [10, 10, 30, 80]);
  const kept = updateTracks([pinned], []);
  assert.equal(kept.length, 1);
  assert.equal(kept[0].manual, true);
});
