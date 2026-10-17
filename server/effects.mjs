import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { crc32, deflateSync, inflateSync } from 'node:zlib';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const effectsDir = join(root, 'sprites', 'effects');
const OPENAI_IMAGES = 'https://api.openai.com/v1/images/generations';
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const STYLE = [
  'A centered gold and amber dungeon light effect, and nothing else.',
  'Soft painted light, antique gold and rich amber.',
  'No text, no letters, no numbers, no watermark, no logo, no frame.',
  'Do not draw a chest, box, lock, character, floor, ground, rocks, or star field.',
].join(' ');

const SPECS = [
  {
    id: 'glow',
    file: 'glow.png',
    subject: 'Only a soft elliptical amber pool of light in the exact center of the canvas, not near the bottom. Wide and low, brightest at its center, fading out well before the edges.',
  },
  {
    id: 'selected',
    file: 'selected.png',
    subject: 'Only a brighter thin gold ring, a clean circular halo with an empty center and amber highlights. No ground disc.',
  },
  {
    id: 'reward',
    file: 'reward.png',
    subject: 'Only a burst of gold sparks and short light rays from the center. No prize, no chest, no container.',
  },
  {
    id: 'spark',
    file: 'spark.png',
    subject: 'A nearly empty image with one tiny amber spark in the exact center, no larger than a grain of sand, plus a faint halo only slightly wider than that spark. Not a sun, not an orb, not a disc, not a circle of light.',
  },
];

function loadEnvFile() {
  let text = '';
  try {
    text = readFileSync(join(root, '.env'), 'utf8');
  } catch {
    return {};
  }
  const out = {};
  for (const rawLine of text.split(/\r?\n/)) {
    let line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    if (line.startsWith('export ')) line = line.slice(7).trim();
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"'))
      || (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

function envValue(name) {
  const fromFile = loadEnvFile()[name];
  if (typeof fromFile === 'string' && fromFile.trim()) return fromFile.trim();
  const fromProcess = process.env[name];
  return typeof fromProcess === 'string' ? fromProcess.trim() : '';
}

function scrub(text) {
  return String(text || '')
    .replace(/sk-[A-Za-z0-9_-]+/g, '[redacted]')
    .replace(/Bearer\s+\S+/gi, 'Bearer [redacted]')
    .slice(0, 400);
}

function isPng(buffer) {
  return Buffer.isBuffer(buffer) && buffer.length >= 8 && buffer.subarray(0, 8).equals(PNG_SIGNATURE);
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type);
  const body = data || Buffer.alloc(0);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(body.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, body])) >>> 0, 0);
  return Buffer.concat([length, typeBuf, body, crc]);
}

function encodePng(width, height, rgba) {
  const stride = width * 4;
  const raw = Buffer.alloc(height * (stride + 1));
  for (let y = 0; y < height; y += 1) {
    const row = y * (stride + 1);
    raw[row] = 0;
    rgba.copy(raw, row + 1, y * stride, y * stride + stride);
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
    PNG_SIGNATURE,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND'),
  ]);
}

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

function unfilter(data, width, height, bpp) {
  const stride = width * bpp;
  const expected = height * (stride + 1);
  if (data.length < expected) throw new Error('truncated png rows');
  const out = Buffer.alloc(height * stride);
  let input = 0;
  let output = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = data[input];
    input += 1;
    for (let x = 0; x < stride; x += 1) {
      const raw = data[input];
      input += 1;
      const left = x >= bpp ? out[output - bpp] : 0;
      const up = y > 0 ? out[output - stride] : 0;
      const upLeft = x >= bpp && y > 0 ? out[output - stride - bpp] : 0;
      let predictor = 0;
      if (filter === 1) predictor = left;
      else if (filter === 2) predictor = up;
      else if (filter === 3) predictor = Math.floor((left + up) / 2);
      else if (filter === 4) predictor = paeth(left, up, upLeft);
      else if (filter !== 0) throw new Error('bad png filter');
      out[output] = (raw + predictor) & 255;
      output += 1;
    }
  }
  return out;
}

function expandColor(pixels, width, height, colorType, plte, trns) {
  const count = width * height;
  const rgba = Buffer.alloc(count * 4);
  if (colorType === 6) {
    pixels.copy(rgba, 0, 0, count * 4);
    return rgba;
  }
  if (colorType === 2) {
    for (let i = 0; i < count; i += 1) {
      rgba[i * 4] = pixels[i * 3];
      rgba[i * 4 + 1] = pixels[i * 3 + 1];
      rgba[i * 4 + 2] = pixels[i * 3 + 2];
      rgba[i * 4 + 3] = 255;
    }
    if (trns && trns.length >= 6) {
      const red = trns.readUInt16BE(0);
      const green = trns.readUInt16BE(2);
      const blue = trns.readUInt16BE(4);
      for (let i = 0; i < count; i += 1) {
        if (rgba[i * 4] === red && rgba[i * 4 + 1] === green && rgba[i * 4 + 2] === blue) {
          rgba[i * 4 + 3] = 0;
        }
      }
    }
    return rgba;
  }
  if (colorType === 0) {
    for (let i = 0; i < count; i += 1) {
      const gray = pixels[i];
      rgba[i * 4] = gray;
      rgba[i * 4 + 1] = gray;
      rgba[i * 4 + 2] = gray;
      rgba[i * 4 + 3] = 255;
    }
    return rgba;
  }
  if (colorType === 4) {
    for (let i = 0; i < count; i += 1) {
      const gray = pixels[i * 2];
      rgba[i * 4] = gray;
      rgba[i * 4 + 1] = gray;
      rgba[i * 4 + 2] = gray;
      rgba[i * 4 + 3] = pixels[i * 2 + 1];
    }
    return rgba;
  }
  if (colorType === 3) {
    if (!plte) throw new Error('png palette missing');
    for (let i = 0; i < count; i += 1) {
      const index = pixels[i];
      const slot = index * 3;
      rgba[i * 4] = plte[slot] || 0;
      rgba[i * 4 + 1] = plte[slot + 1] || 0;
      rgba[i * 4 + 2] = plte[slot + 2] || 0;
      rgba[i * 4 + 3] = trns && index < trns.length ? trns[index] : 255;
    }
    return rgba;
  }
  throw new Error('unsupported png color');
}

function readPng(buffer) {
  if (!isPng(buffer)) throw new Error('not a png');
  let offset = 8;
  let ihdr = null;
  let plte = null;
  let trns = null;
  const idat = [];
  while (offset + 8 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    const start = offset + 8;
    const end = start + length;
    if (end + 4 > buffer.length) throw new Error('truncated png');
    const data = buffer.subarray(start, end);
    const expected = buffer.readUInt32BE(end) >>> 0;
    const actual = crc32(Buffer.concat([Buffer.from(type), data])) >>> 0;
    if (actual !== expected) throw new Error('bad png crc');
    if (type === 'IHDR') ihdr = data;
    else if (type === 'PLTE') plte = data;
    else if (type === 'tRNS') trns = data;
    else if (type === 'IDAT') idat.push(data);
    offset = end + 4;
    if (type === 'IEND') break;
  }
  if (!ihdr || ihdr.length < 13) throw new Error('png header missing');
  const width = ihdr.readUInt32BE(0);
  const height = ihdr.readUInt32BE(4);
  const bitDepth = ihdr[8];
  const colorType = ihdr[9];
  if (bitDepth !== 8 || ihdr[10] !== 0 || ihdr[11] !== 0 || ihdr[12] !== 0) {
    throw new Error('unsupported png encoding');
  }
  const bpp = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colorType];
  if (!bpp) throw new Error('unsupported png color');
  const inflated = inflateSync(Buffer.concat(idat));
  const pixels = unfilter(inflated, width, height, bpp);
  const rgba = expandColor(pixels, width, height, colorType, plte, trns);
  return { width, height, rgba };
}

export function pngRgba(buffer) {
  const image = readPng(buffer);
  return { width: image.width, height: image.height, rgba: image.rgba };
}

function tightenMote(buffer) {
  const image = readPng(buffer);
  const { rgba, width, height } = image;
  let minX = width;
  let minY = height;
  let maxX = 0;
  let maxY = 0;
  let solid = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (rgba[(y * width + x) * 4 + 3] < 48) continue;
      solid += 1;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  if (!solid || Math.max(maxX - minX, maxY - minY) <= 120) return buffer;
  let best = -Infinity;
  let bx = Math.round(width / 2);
  let by = Math.round(height / 2);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4;
      if (rgba[i + 3] < 200) continue;
      const score = rgba[i] + rgba[i + 1] + rgba[i + 2] - Math.hypot(x - width / 2, y - height / 2) * 0.2;
      if (score > best) {
        best = score;
        bx = x;
        by = y;
      }
    }
  }
  const core = 12;
  const halo = 40;
  const next = Buffer.alloc(rgba.length);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const distance = Math.hypot(x - bx, y - by);
      if (distance > halo) continue;
      const i = (y * width + x) * 4;
      const falloff = distance <= core ? 1 : 1 - (distance - core) / (halo - core);
      next[i] = rgba[i];
      next[i + 1] = rgba[i + 1];
      next[i + 2] = rgba[i + 2];
      next[i + 3] = Math.round(rgba[i + 3] * falloff * falloff);
    }
  }
  return encodePng(width, height, next);
}

export function knockOutPng(buffer) {
  const image = readPng(buffer);
  const { rgba } = image;
  for (let i = 0; i < rgba.length; i += 4) {
    const lum = (rgba[i] + rgba[i + 1] + rgba[i + 2]) / 3;
    if (lum < 22) rgba[i + 3] = 0;
    else if (lum < 52) rgba[i + 3] = Math.round(((lum - 22) / 30) * rgba[i + 3]);
  }
  return encodePng(image.width, image.height, rgba);
}

function readyPng(path) {
  try {
    if (!existsSync(path) || statSync(path).size < 33) return false;
    return isPng(readFileSync(path));
  } catch {
    return false;
  }
}

async function requestImage(body, apiKey) {
  let response;
  try {
    response = await fetch(OPENAI_IMAGES, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60_000),
    });
  } catch (error) {
    const timedOut = error?.name === 'TimeoutError' || error?.name === 'AbortError';
    return { ok: false, status: 0, message: timedOut ? 'timed out' : 'request failed' };
  }
  let data = null;
  if (response.ok) {
    try {
      data = await response.json();
    } catch {
      return { ok: false, status: response.status, message: 'image response was not json' };
    }
    return { ok: true, status: response.status, data };
  }
  let message = response.statusText || 'request failed';
  try {
    const payload = await response.json();
    if (typeof payload?.error?.message === 'string') message = payload.error.message;
  } catch {
    message = response.statusText || 'request failed';
  }
  return { ok: false, status: response.status, message: scrub(message) };
}

function retryBody(failure, prompt) {
  if (failure.status !== 400 && failure.status !== 404 && failure.status !== 422) return null;
  const text = String(failure.message || '').toLowerCase();
  const modelMissing = /does not exist|not found|invalid model|unknown model|not available|do not have access|must be one of/.test(text);
  const paramRejected = /background|transparent|output_format|unknown parameter|invalid parameter|unrecognized|unsupported|not supported/.test(text);
  if (!modelMissing && !paramRejected) return null;
  const blackPrompt = `${prompt} Solid pure black background.`;
  if (modelMissing) {
    return {
      model: 'dall-e-3',
      prompt: blackPrompt,
      size: '1024x1024',
      response_format: 'b64_json',
      n: 1,
    };
  }
  return {
    model: 'gpt-image-1',
    prompt: blackPrompt,
    size: '1024x1024',
    output_format: 'png',
  };
}

async function bytesFromImage(data) {
  const item = data?.data?.[0];
  if (!item || typeof item !== 'object') {
    return { error: true, message: 'empty image response' };
  }
  const b64 = item.b64_json || item.b64 || item.image;
  if (typeof b64 === 'string' && b64) return { png: Buffer.from(b64, 'base64') };
  if (typeof item.url === 'string' && item.url) {
    try {
      const response = await fetch(item.url, { signal: AbortSignal.timeout(60_000) });
      if (!response.ok) {
        return { error: true, status: response.status, message: 'image download failed' };
      }
      return { png: Buffer.from(await response.arrayBuffer()) };
    } catch (error) {
      const timedOut = error?.name === 'TimeoutError' || error?.name === 'AbortError';
      return { error: true, status: 0, message: timedOut ? 'timed out' : 'image download failed' };
    }
  }
  return { error: true, message: 'image response had no png' };
}

async function generateEffect(spec) {
  const apiKey = envValue('OPENAI_API_KEY');
  if (!apiKey) return { error: true, message: 'missing API key' };
  const prompt = `${STYLE} ${spec.subject}`;
  const first = await requestImage({
    model: 'gpt-image-1',
    prompt,
    size: '1024x1024',
    background: 'transparent',
    output_format: 'png',
  }, apiKey);
  if (first.ok) {
    const bytes = await bytesFromImage(first.data);
    if (bytes.error) return bytes;
    if (!isPng(bytes.png)) return { error: true, message: 'response was not a png' };
    return { png: finishSprite(spec, bytes.png) };
  }
  const secondBody = retryBody(first, prompt);
  if (!secondBody) return { error: true, status: first.status, message: first.message };
  const second = await requestImage(secondBody, apiKey);
  if (!second.ok) return { error: true, status: second.status, message: second.message };
  const bytes = await bytesFromImage(second.data);
  if (bytes.error) return bytes;
  if (!isPng(bytes.png)) return { error: true, message: 'response was not a png' };
  try {
    return { png: finishSprite(spec, knockOutPng(bytes.png)) };
  } catch {
    return { error: true, message: 'could not knock out the background' };
  }
}

function finishSprite(spec, png) {
  if (spec.id !== 'spark') return png;
  try {
    return tightenMote(png);
  } catch {
    return png;
  }
}

export async function ensureEffects() {
  mkdirSync(effectsDir, { recursive: true });
  const ids = {};
  let failure = null;
  for (const spec of SPECS) {
    const dest = join(effectsDir, spec.file);
    if (readyPng(dest)) {
      ids[spec.id] = spec.file;
      continue;
    }
    const result = await generateEffect(spec);
    if (!result.png) {
      if (!failure) failure = result;
      if (result.status === 401 || result.status === 403) break;
      continue;
    }
    writeFileSync(dest, result.png);
    ids[spec.id] = spec.file;
  }
  const manifest = { ids };
  if (failure) {
    manifest.error = true;
    if (failure.status) manifest.status = failure.status;
    if (failure.message) manifest.message = scrub(failure.message);
  }
  writeFileSync(join(effectsDir, 'effects.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}
