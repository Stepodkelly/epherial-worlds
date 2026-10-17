import assert from 'node:assert/strict';
import { crc32, deflateSync } from 'node:zlib';
import test from 'node:test';
import { effectLayer, motionStyle } from '../app/motion.js';
import { knockOutPng, pngRgba } from './effects.mjs';

function pngChunk(type, data) {
  const typeBuf = Buffer.from(type);
  const body = data || Buffer.alloc(0);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(body.length, 0);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([typeBuf, body])) >>> 0, 0);
  return Buffer.concat([length, typeBuf, body, checksum]);
}

function opaquePng(width, height, rgba) {
  const stride = width * 4;
  const raw = Buffer.alloc(height * (stride + 1));
  for (let y = 0; y < height; y += 1) {
    const row = y * (stride + 1);
    raw[row] = 0;
    rgba.copy(raw, row + 1, y * stride, (y + 1) * stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw)),
    pngChunk('IEND'),
  ]);
}

test('motionStyle uses depth, bob, and aim', () => {
  const track = { id: 3, bbox: [0, 0, 100, 50] };
  const viewArea = 100_000;
  const time = 1.25;
  const aimX = 0.5;
  const aimY = -0.25;
  const style = motionStyle(track, time, aimX, aimY, viewArea);
  const depth = 0.5;
  assert.equal(style.bob, Math.sin(time * 2.2 + 3) * 7);
  assert.equal(style.shiftX, aimX * 20 * depth);
  assert.equal(style.shiftY, aimY * 8 * depth);
  assert.equal(style.shadowX, aimX * 6 * depth);
});

test('motionStyle clamps depth and reads the box area', () => {
  const tiny = motionStyle({ id: 1, bbox: [9, 9, 1, 1] }, 0, 1, 1, 100_000);
  assert.equal(tiny.bob, Math.sin(1) * 7);
  assert.equal(tiny.shiftX, 20 * 0.4);
  assert.equal(tiny.shiftY, 8 * 0.4);
  assert.equal(tiny.shadowX, 6 * 0.4);

  const huge = motionStyle({ id: 0, bbox: [0, 0, 500, 500] }, 0, 1, -1, 1000);
  assert.equal(huge.bob, 0);
  assert.equal(huge.shiftX, 20 * 1.4);
  assert.equal(huge.shiftY, -8 * 1.4);
  assert.equal(huge.shadowX, 6 * 1.4);
});

test('motionStyle is pure', () => {
  const track = { id: 2, bbox: [1, 2, 40, 40] };
  const before = structuredClone(track);
  const first = motionStyle(track, 0.5, -0.2, 0.3, 8000);
  const second = motionStyle(track, 0.5, -0.2, 0.3, 8000);
  assert.deepEqual(first, second);
  assert.deepEqual(track, before);
  const area = 40 * 40;
  const depth = Math.min(1.4, Math.max(0.4, (area / 8000) * 10));
  assert.equal(first.shiftX, -0.2 * 20 * depth);
  assert.equal(first.shiftY, 0.3 * 8 * depth);
  assert.equal(first.shadowX, -0.2 * 6 * depth);
});

test('effect layers point at the effect sprites', () => {
  assert.equal(effectLayer('idle'), '../sprites/effects/glow.png');
  assert.equal(effectLayer('selected'), '../sprites/effects/selected.png');
  assert.equal(effectLayer('reward'), '../sprites/effects/reward.png');
  assert.equal(effectLayer('spark'), '');
});

test('knockOutPng clears near-black pixels and keeps gold', () => {
  const source = opaquePng(2, 1, Buffer.from([
    0, 0, 0, 255,
    220, 160, 40, 255,
  ]));
  const image = pngRgba(knockOutPng(source));
  assert.equal(image.width, 2);
  assert.equal(image.height, 1);
  assert.deepEqual([...image.rgba.subarray(0, 4)], [0, 0, 0, 0]);
  assert.deepEqual([...image.rgba.subarray(4, 8)], [220, 160, 40, 255]);
});
