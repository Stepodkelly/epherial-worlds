import { fetchDay } from './day.js';
import { commitObject, recallObject } from './graph.js';
import { effectLayer, motionStyle } from './motion.js';
import { manualTrack, coverRect, updateTracks } from './track.js';
import { requestName } from './voice.js';
import { publishRoom, startWatch } from './watch.js';
import {
  exampleFor,
  fitLabel,
  goldIn,
  indexPack,
  inventName,
  questFor,
  recall,
  verbsFor,
} from './world.js';

const REGISTRY_KEY = 'epherial.registry.v1';
const GOLD_KEY = 'epherial.gold.v1';
const REHEARSE_SIZE = { w: 1280, h: 720 };

const overlay = document.getElementById('overlay');
const video = document.getElementById('cam');
const view = document.getElementById('view');
const grade = document.getElementById('grade');
const darken = document.getElementById('darken');
const eyes = document.getElementById('eyes');
const patrol = document.getElementById('patrol');
const voice = document.getElementById('voice');
const statusEl = document.getElementById('status');
const questEl = document.getElementById('quest');
const card = document.getElementById('card');
const cardReal = document.getElementById('card-real');
const cardName = document.getElementById('card-name');
const cardLine = document.getElementById('card-line');
const cardMyth = document.getElementById('card-myth');
const cardVerbs = document.getElementById('card-verbs');
const cardSay = document.getElementById('card-say');
const picker = document.getElementById('picker');
const pickerClasses = document.getElementById('picker-classes');
const inventory = document.getElementById('inventory');
const restBtn = document.getElementById('rest');
const closeBtn = document.getElementById('close');
const fileBtn = document.getElementById('file');
const rehearseBtn = document.getElementById('rehearse');
const cameraBtn = document.getElementById('camera');
const headsetBtn = document.getElementById('headset');
const forgetBtn = document.getElementById('forget');

const anchors = new Map();
const motes = Array.from({ length: 96 }, () => ({
  x: Math.random(),
  y: Math.random(),
  s: 0.5 + Math.random() * 1.7,
  v: 0.015 + Math.random() * 0.05,
}));

const state = {
  pack: null,
  index: null,
  floor: null,
  floorName: 'live',
  tracks: [],
  registry: [],
  gold: 0,
  sprites: new Map(),
  canvases: new Map(),
  rehearsing: false,
  mirrored: false,
  videoReady: false,
  detector: null,
  detectError: '',
  aimX: 0,
  aimY: 0,
  selectedId: null,
  returnLeft: 0,
  returnTimer: 0,
  banner: '',
  bannerUntil: 0,
  xr: null,
  booted: false,
  beat: '',
  watching: false,
};

const audio = { ctx: null, drone: null, nextTick: 0 };
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

start().catch((error) => {
  statusEl.textContent = 'Serve this project and open /app/. The floor files did not load.';
  voice.textContent = error.message || 'The floor did not load.';
});

async function start() {
  const [pack, floor] = await Promise.all([
    loadJson('../world-pack.json'),
    loadJson('../floor.json'),
  ]);
  state.pack = pack;
  state.floor = floor;
  state.index = indexPack(pack);
  state.registry = loadRegistry();
  state.gold = Number(localStorage.getItem(GOLD_KEY) || 0) || 0;
  await loadSprites();
  renderPicker();
  renderInventory();
  voice.textContent = pack.voice.tone;
  setFloor(floor.default || 'live', false);
  const params = new URLSearchParams(location.search);
  state.watching = params.has('watch');
  setMode(!state.watching && params.has('rehearse'));
  enableControls();
  state.booted = true;
  revealHeadset();
  if (state.watching) {
    startWatch(applyWatch);
    voice.textContent = 'Watching the floor.';
  } else if (!state.rehearsing) {
    const opened = await openCamera();
    if (!opened) setMode(true);
  }
  if (!state.watching) {
    openEye();
    window.setTimeout(senseLoop, 80);
  }
  requestAnimationFrame(frame);
  loadBeat();
}

async function loadBeat() {
  try {
    const day = await fetchDay();
    if (typeof day?.line === 'string' && day.line) {
      state.beat = day.line;
      if (!state.banner) voice.textContent = day.line;
    }
  } catch {
    state.beat = '';
  }
  publishSoon();
}

function roomSnapshot() {
  const viewWidth = Math.max(1, window.innerWidth);
  const viewHeight = Math.max(1, window.innerHeight);
  return {
    floor: state.floorName,
    gold: state.gold,
    beat: state.beat || '',
    tracks: state.tracks.filter((track) => track.rect).map((track) => {
      const record = state.index.byId.get(track.subclass);
      return {
        id: track.id,
        subclass: track.subclass,
        name: track.filed?.name || record?.sub.name || track.label,
        nx: track.rect.x / viewWidth,
        ny: track.rect.y / viewHeight,
        w: track.rect.w / viewWidth,
        h: track.rect.h / viewHeight,
      };
    }),
  };
}

let publishTimer = 0;
function publishSoon() {
  if (state.watching || !state.booted) return;
  if (publishTimer) return;
  publishTimer = window.setTimeout(() => {
    publishTimer = 0;
    publishRoom(roomSnapshot());
  }, 200);
}

function applyWatch(remote) {
  const floor = remote.floor;
  if (floor && state.floor.states[floor] && floor !== state.floorName) setFloor(floor, false);
  state.gold = Number(remote.gold) || 0;
  state.beat = typeof remote.beat === 'string' ? remote.beat : '';
  const tracks = Array.isArray(remote.tracks) ? remote.tracks : [];
  state.tracks = tracks.map((track) => {
    const record = state.index.byId.get(track.subclass);
    const name = typeof track.name === 'string' ? track.name : (record?.sub.name || '');
    return {
      id: track.id,
      subclass: track.subclass,
      classId: record?.group.id || '',
      label: name,
      score: 1,
      age: 8,
      manual: true,
      frac: {
        nx: Number(track.nx) || 0,
        ny: Number(track.ny) || 0,
        w: Number(track.w) || 0,
        h: Number(track.h) || 0,
      },
      filed: {
        id: String(track.id),
        subclass: track.subclass,
        classId: record?.group.id || '',
        name,
        real: name,
        line: '',
        done: {},
      },
      done: {},
    };
  });
}

async function loadJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(url);
  return response.json();
}

function loadRegistry() {
  try {
    const parsed = JSON.parse(localStorage.getItem(REGISTRY_KEY) || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveRegistry() {
  localStorage.setItem(REGISTRY_KEY, JSON.stringify(state.registry));
  localStorage.setItem(GOLD_KEY, String(state.gold));
}

async function loadSprites() {
  let ids = [];
  try {
    ids = await loadJson('../sprites/manifest.json');
  } catch {
    ids = [];
  }
  await Promise.all(ids.map(async (id) => {
    try {
      const image = await loadImage(`../sprites/${id}.png`);
      const stamp = knockOut(image);
      state.canvases.set(id, stamp);
      state.sprites.set(id, stamp.toDataURL('image/png'));
    } catch {
      // A missing icon falls back to the class stamp.
    }
  }));
  const eyesUrl = state.sprites.get('corner_eyes');
  const patrolUrl = state.sprites.get('patrol_shadow');
  if (eyesUrl) eyes.src = eyesUrl;
  if (patrolUrl) patrol.src = patrolUrl;
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(url));
    image.src = url;
  });
}

function knockOut(image) {
  const canvas = document.createElement('canvas');
  const longest = Math.max(image.width, image.height) || 1;
  const scale = Math.min(1, 256 / longest);
  canvas.width = Math.max(1, Math.round(image.width * scale));
  canvas.height = Math.max(1, Math.round(image.height * scale));
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
  const frame = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = frame.data;
  for (let i = 0; i < data.length; i += 4) {
    const lum = (data[i] + data[i + 1] + data[i + 2]) / 3;
    if (lum < 22) data[i + 3] = 0;
    else if (lum < 52) data[i + 3] = Math.round(((lum - 22) / 30) * data[i + 3]);
  }
  ctx.putImageData(frame, 0, 0);
  return canvas;
}

function spriteFor(subclass, classId) {
  return state.sprites.get(subclass) || state.sprites.get(classId) || '';
}

function enableControls() {
  for (const button of [restBtn, closeBtn, fileBtn, rehearseBtn, forgetBtn]) {
    button.disabled = false;
  }
}

function setMode(rehearse) {
  state.rehearsing = rehearse;
  state.tracks = state.tracks.filter((track) => track.manual);
  video.hidden = rehearse || !state.videoReady;
  cameraBtn.hidden = !rehearse;
  rehearseBtn.textContent = rehearse ? 'Stop rehearsal' : 'Rehearse';
  rehearseBtn.setAttribute('aria-pressed', rehearse ? 'true' : 'false');
  if (!rehearse && !state.videoReady) {
    voice.textContent = 'The camera is still closed. Rehearsal can carry the floor.';
  }
}

async function openCamera() {
  if (!navigator.mediaDevices?.getUserMedia) return false;
  const attempts = [
    { video: { facingMode: { ideal: 'environment' } }, audio: false },
    { video: true, audio: false },
  ];
  for (const constraints of attempts) {
    try {
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      video.srcObject = stream;
      await video.play();
      const facing = stream.getVideoTracks()[0].getSettings().facingMode;
      state.mirrored = facing === 'user';
      video.style.transform = state.mirrored ? 'scaleX(-1)' : '';
      state.videoReady = true;
      video.hidden = state.rehearsing;
      return true;
    } catch {
      // The next constraint may still be allowed.
    }
  }
  return false;
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src;
    script.async = false;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(src));
    document.head.append(script);
  });
}

async function openEye() {
  try {
    await loadScript('https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.22.0/dist/tf.min.js');
    await loadScript('https://cdn.jsdelivr.net/npm/@tensorflow-models/coco-ssd@2.2.3/dist/coco-ssd.min.js');
    if (!window.tf || !window.cocoSsd) throw new Error('The eye scripts did not start.');
    await window.tf.ready();
    state.detector = await window.cocoSsd.load({ base: 'lite_mobilenet_v2' });
    state.detectError = '';
    if (!state.banner) voice.textContent = state.pack.voice.tone;
  } catch {
    state.detectError = 'The eye could not open. Rehearsal still runs, and File center still files.';
    if (!state.rehearsing) voice.textContent = state.detectError;
  }
}

async function revealHeadset() {
  if (!navigator.xr?.isSessionSupported) return;
  const supported = await navigator.xr.isSessionSupported('immersive-ar').catch(() => false);
  headsetBtn.hidden = !supported;
}

function frameSize() {
  if (state.rehearsing || !video.videoWidth) return REHEARSE_SIZE;
  return { w: video.videoWidth, h: video.videoHeight };
}

function centerBBox() {
  const { w, h } = frameSize();
  const bw = w * 0.28;
  const bh = h * 0.4;
  return [(w - bw) / 2, (h - bh) / 2, bw, bh];
}

async function senseLoop() {
  if (!state.booted || state.watching) return;
  try {
    if (state.rehearsing) {
      state.tracks = updateTracks(state.tracks, rehearseDetections(performance.now() / 1000));
    } else if (state.detector && state.videoReady && video.videoWidth) {
      const predictions = await state.detector.detect(video);
      const detections = [];
      for (const prediction of predictions) {
        if (prediction.score < 0.45) continue;
        const fitted = fitLabel(state.index, prediction.class);
        if (!fitted) continue;
        detections.push({
          bbox: prediction.bbox,
          subclass: fitted.id,
          classId: fitted.group.id,
          label: prediction.class,
          score: prediction.score,
        });
      }
      state.tracks = updateTracks(state.tracks, detections);
    }
  } catch {
    state.detectError = 'A look failed. The next one will try again.';
  }
  window.setTimeout(senseLoop, 420);
}

function rehearseDetections(time) {
  const wobble = Math.sin(time) * 18;
  return [
    detection('bottle', [240 + wobble, 200, 170, 250], 0.93),
    detection('laptop', [860, 250, 280, 190], 0.91),
    detection('potted plant', [530, 40, 190, 230], 0.86),
    detection('chair', [40, 300, 180, 210], 0.74),
  ];
}

function detection(label, bbox, score) {
  const fitted = fitLabel(state.index, label);
  return {
    bbox,
    subclass: fitted.id,
    classId: fitted.group.id,
    label,
    score,
  };
}

function frame(now) {
  const time = now / 1000;
  drawDust(time);
  placeAtmosphere(time);
  layoutAnchors(time);
  fileStable(time);
  publishSoon();
  paintHud(time);
  const spec = state.floor.states[state.floorName];
  if (spec) updateAudio(spec, time);
  requestAnimationFrame(frame);
}

function drawDust(time) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const width = window.innerWidth;
  const height = window.innerHeight;
  if (view.width !== Math.floor(width * dpr) || view.height !== Math.floor(height * dpr)) {
    view.width = Math.floor(width * dpr);
    view.height = Math.floor(height * dpr);
  }
  const ctx = view.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);
  const spec = state.floor?.states[state.floorName];
  const count = Math.round(48 * (spec?.dust || 0));
  ctx.fillStyle = 'rgba(239, 230, 214, 0.72)';
  for (let i = 0; i < count; i += 1) {
    const mote = motes[i];
    mote.y -= mote.v * (reduceMotion ? 0.2 : 1);
    mote.x += Math.sin(time * 0.6 + i) * 0.0009;
    if (mote.y < 0) mote.y = 1;
    ctx.beginPath();
    ctx.arc(mote.x * width, mote.y * height, mote.s, 0, Math.PI * 2);
    ctx.fill();
  }
}

function placeAtmosphere(time) {
  const spec = state.floor.states[state.floorName];
  if (spec.eyes && eyes.src) {
    eyes.hidden = false;
    const pulse = reduceMotion ? 0.7 : 0.45 + 0.4 * (0.5 + 0.5 * Math.sin(time * 1.7));
    eyes.style.opacity = String(pulse);
  } else {
    eyes.hidden = true;
  }
  if (spec.patrolSeconds && patrol.src) {
    patrol.hidden = false;
    const u = (time % spec.patrolSeconds) / spec.patrolSeconds;
    patrol.style.left = `${-18 + u * 110}%`;
    const edge = Math.min(1, Math.min(u, 1 - u) / 0.12);
    patrol.style.opacity = String(0.9 * edge);
  } else {
    patrol.hidden = true;
  }
}

function layoutAnchors(time) {
  const size = frameSize();
  const viewWidth = window.innerWidth;
  const viewHeight = window.innerHeight;
  const live = new Set();
  for (const track of state.tracks) {
    const rect = track.frac
      ? {
        x: track.frac.nx * viewWidth,
        y: track.frac.ny * viewHeight,
        w: track.frac.w * viewWidth,
        h: track.frac.h * viewHeight,
      }
      : coverRect(
        track.bbox,
        size.w,
        size.h,
        viewWidth,
        viewHeight,
        state.mirrored && !state.rehearsing,
      );
    track.rect = rect;
    const el = ensureAnchor(track);
    live.add(track.id);
    el.style.left = `${rect.x}px`;
    el.style.top = `${rect.y}px`;
    el.style.width = `${rect.w}px`;
    el.style.height = `${rect.h}px`;
    const motion = motionStyle(
      { ...track, rect },
      reduceMotion ? 0 : time,
      state.aimX,
      state.aimY,
      Math.max(1, viewWidth * viewHeight),
    );
    el.style.setProperty('--shift-x', `${motion.shiftX}px`);
    el.style.setProperty('--shift-y', `${motion.shiftY}px`);
    el.style.setProperty('--shadow-x', `${motion.shadowX}px`);
    el.style.setProperty('--bob', `${reduceMotion ? 0 : motion.bob}px`);
    const selected = track.id === state.selectedId;
    el.classList.toggle('is-selected', selected);
    const burst = Number(track.rewardUntil || el.dataset.burst || 0);
    if (track.rewardUntil) el.dataset.burst = String(track.rewardUntil);
    const kind = burst > time ? 'reward' : (selected ? 'selected' : 'idle');
    if (burst && burst <= time) delete el.dataset.burst;
    const fx = el.querySelector('.fx');
    const fxSrc = effectLayer(kind);
    if (fx && fx.dataset.kind !== kind) {
      fx.dataset.kind = kind;
      fx.hidden = false;
      fx.src = fxSrc;
    }
    const record = state.index.byId.get(track.subclass);
    const plate = el.querySelector('.plate');
    plate.textContent = track.filed?.name || record?.sub.name || track.label;
    const img = el.querySelector('img.stamp');
    const src = spriteFor(track.subclass, track.classId);
    if (src && img.src !== src) img.src = src;
    el.setAttribute('aria-label', plate.textContent);
  }
  for (const [id, el] of anchors) {
    if (live.has(id)) continue;
    el.remove();
    anchors.delete(id);
  }
}

function ensureAnchor(track) {
  const existing = anchors.get(track.id);
  if (existing) return existing;
  const el = document.createElement('button');
  el.type = 'button';
  el.className = 'anchor';
  el.innerHTML = '<span class="shadow"></span><img class="fx" alt="" hidden><img class="stamp" alt=""><span class="plate"></span>';
  const fx = el.querySelector('.fx');
  fx.addEventListener('error', () => {
    fx.hidden = true;
  });
  el.addEventListener('click', () => {
    const live = state.tracks.find((item) => item.id === track.id) || track;
    openCard(live);
  });
  anchors.set(track.id, el);
  document.getElementById('anchors').append(el);
  return el;
}

const naming = new Set();

function fileStable(time) {
  if (state.watching) return;
  const born = [];
  const jobs = [];
  let changed = false;
  const viewWidth = Math.max(1, window.innerWidth);
  const viewHeight = Math.max(1, window.innerHeight);
  for (const track of state.tracks) {
    if (track.filed || !track.rect) continue;
    if (!track.manual && (track.age < 3 || track.score < 0.5)) continue;
    const record = state.index.byId.get(track.subclass);
    if (!record) continue;
    const nx = (track.rect.x + track.rect.w / 2) / viewWidth;
    const ny = (track.rect.y + track.rect.h / 2) / viewHeight;
    const siblingCount = state.tracks.filter((item) => item.subclass === track.subclass).length;
    let item = recall(state.registry, track.subclass, nx, ny, siblingCount);
    let created = false;
    if (!item) {
      const serial = state.registry.filter((entry) => entry.subclass === track.subclass).length;
      const example = serial === 0 ? exampleFor(state.pack, track.label, track.subclass) : null;
      item = {
        id: `obj_${track.id}_${Math.floor(time * 1000)}`,
        subclass: track.subclass,
        classId: record.group.id,
        name: example?.name || inventName(state.index, record, serial),
        real: track.label,
        nx,
        ny,
        line: record.sub.discourse || '',
        myth: example?.material ? state.index.materials.get(example.material)?.myth || '' : '',
        done: {},
        named: Boolean(example?.name),
      };
      state.registry.push(item);
      born.push(item.name);
      changed = true;
      created = true;
    }
    item.done = item.done || {};
    track.filed = item;
    track.done = item.done;
    track.classId = record.group.id;
    if (state.selectedId === track.id) cardName.textContent = item.name;
    jobs.push({ track, item, nx, ny, record, created });
  }
  if (born.length === 1) state.banner = `${born[0]} is on the floor.`;
  else if (born.length > 1) {
    state.banner = `${born.slice(0, -1).join(', ')} and ${born.at(-1)} are on the floor.`;
  }
  if (born.length) state.bannerUntil = time + 4.5;
  if (changed) {
    saveRegistry();
    renderInventory();
  }
  for (const job of jobs) void enrich(job);
}

async function enrich({ track, item, nx, ny, record, created }) {
  try {
    const found = await recallObject({ subclass: item.subclass, nx, ny });
    if (found?.enabled && found.object?.name && created) {
      item.name = found.object.name;
      if (found.object.line) item.line = found.object.line;
      if (found.object.id) item.id = found.object.id;
      item.named = true;
      track.filed = item;
      saveRegistry();
      renderInventory();
      if (state.selectedId === track.id) cardName.textContent = item.name;
      publishSoon();
      return;
    }
  } catch {
    // Memory can be quiet. The floor name still stands.
  }
  if (created && !item.named && !naming.has(item.id)) {
    naming.add(item.id);
    const named = await requestName({
      subclass: item.subclass,
      className: record.group.name,
      label: item.real,
      tendencies: record.sub.look || [],
      discourse: record.sub.discourse || '',
    });
    naming.delete(item.id);
    if (named?.name && !named.error) {
      item.name = named.name;
      item.named = true;
      if (named.line) item.line = named.line;
      saveRegistry();
      renderInventory();
      if (state.selectedId === track.id) {
        cardName.textContent = item.name;
        cardLine.textContent = item.line || cardLine.textContent;
      }
    }
  }
  const memory = await commitObject({
    id: item.id,
    subclass: item.subclass,
    classId: item.classId,
    name: item.name,
    real: item.real,
    nx,
    ny,
    line: item.line || '',
  });
  if (memory?.enabled) publishSoon();
}

function paintHud(time) {
  const spec = state.floor.states[state.floorName];
  const mode = state.rehearsing ? 'rehearsal' : (state.videoReady ? 'camera' : 'no camera');
  const eye = state.watching
    ? 'shared eye'
    : (state.detector ? 'eye open' : (state.detectError ? 'eye closed' : 'eye opening'));
  const hold = state.returnLeft > 0 ? ` · live in ${state.returnLeft}s` : '';
  const patrolLabel = spec.patrolSeconds ? `patrol ${spec.patrolSeconds}s` : 'patrol hidden';
  const modeLabel = state.watching ? 'watching' : mode;
  const text = `${state.floorName}${hold} · ${modeLabel} · ${eye} · ${state.tracks.length} in view · ${state.gold} gold · ${patrolLabel}`;
  if (statusEl.textContent !== text) statusEl.textContent = text;

  const found = questFor(state.pack, state.tracks);
  if (!found) {
    questEl.hidden = true;
  } else {
    questEl.hidden = false;
    const line = `${found.quest.verb} ${found.track.filed.name} · ${found.quest.reward}`;
    if (questEl.textContent !== line) questEl.textContent = line;
  }

  if (state.banner && time < state.bannerUntil) {
    if (voice.textContent !== state.banner) voice.textContent = state.banner;
    return;
  }
  if (state.banner && time >= state.bannerUntil) {
    state.banner = '';
    voice.textContent = spokenLine();
  }
}

function spokenLine() {
  if (state.beat) return state.beat;
  if (state.watching) return 'Watching the floor.';
  if (state.detectError && !state.detector) return state.detectError;
  return state.pack.voice.tone;
}

function renderInventory() {
  inventory.replaceChildren();
  for (const item of state.registry) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'chip';
    const img = document.createElement('img');
    img.alt = '';
    img.src = spriteFor(item.subclass, item.classId);
    const span = document.createElement('span');
    span.textContent = item.name;
    button.append(img, span);
    button.addEventListener('click', () => openCard(trackFromItem(item)));
    inventory.append(button);
  }
}

function renderPicker() {
  pickerClasses.replaceChildren();
  for (const group of state.pack.classes) {
    const sub = group.subclasses[0];
    if (!sub) continue;
    const button = document.createElement('button');
    button.type = 'button';
    const img = document.createElement('img');
    img.alt = '';
    img.src = spriteFor(sub.id, group.id);
    button.append(img, document.createTextNode(group.name));
    button.addEventListener('click', () => {
      const track = manualTrack(sub.id, group.id, centerBBox());
      state.tracks.push(track);
      picker.hidden = true;
    });
    pickerClasses.append(button);
  }
}

function trackFromItem(item) {
  const live = state.tracks.find((track) => track.filed && track.filed.id === item.id);
  if (live) return live;
  item.done = item.done || {};
  return {
    id: item.id,
    subclass: item.subclass,
    classId: item.classId,
    label: item.real,
    filed: item,
    done: item.done,
    manual: Boolean(item.loose),
    score: 1,
    age: 8,
  };
}

function openCard(track) {
  state.selectedId = track.id;
  const record = state.index.byId.get(track.subclass);
  card.hidden = false;
  cardReal.textContent = track.filed?.real || track.label;
  cardName.textContent = track.filed?.name || record?.sub.name || track.label;
  cardLine.textContent = track.filed?.line || record?.sub.discourse || '';
  const myth = track.filed?.myth || '';
  cardMyth.hidden = !myth;
  cardMyth.textContent = myth;
  cardSay.hidden = true;
  cardSay.textContent = '';
  const example = exampleFor(state.pack, track.label, track.subclass);
  cardVerbs.replaceChildren();
  for (const verb of verbsFor(record, example)) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = verb;
    button.addEventListener('click', () => act(track, verb));
    cardVerbs.append(button);
  }
  if (track.manual) {
    const release = document.createElement('button');
    release.type = 'button';
    release.textContent = 'Release';
    release.addEventListener('click', () => {
      state.tracks = state.tracks.filter((item) => item.id !== track.id);
      closeCard();
    });
    cardVerbs.append(release);
  }
}

function closeCard() {
  card.hidden = true;
  state.selectedId = null;
}

function act(track, verb) {
  const next = state.floor.setBy?.[verb];
  if (next) setFloor(next, verb === 'close');
  for (const quest of state.pack.quests || []) {
    const aimed = track.subclass === quest.target || track.classId === quest.target;
    if (quest.verb !== verb || !aimed || track.done?.[quest.id]) continue;
    track.done[quest.id] = true;
    const gained = goldIn(quest.reward);
    if (gained) state.gold += gained;
    if (String(quest.reward).toLowerCase().includes('loot')) grantLoot();
    track.rewardUntil = performance.now() / 1000 + 2.6;
    const burstEl = anchors.get(track.id);
    if (burstEl) burstEl.dataset.burst = String(track.rewardUntil);
    saveRegistry();
    renderInventory();
    say(`${quest.reward}. ${state.pack.voice.achievement}`);
    return;
  }
  say(lineFor(verb));
}

function lineFor(verb) {
  if (verb === 'rest') return 'Timers pause. The cheap seats can wait.';
  if (verb === 'close') return 'The feed goes dark.';
  if (verb === 'refill' || verb === 'drink' || verb === 'pour' || verb === 'uncork') {
    return state.pack.voice.loot;
  }
  return state.pack.voice.card;
}

function grantLoot() {
  const record = state.index.byId.get('tiered_loot_box');
  if (!record) return;
  state.registry.push({
    id: `loot_${Date.now()}`,
    subclass: record.id,
    classId: record.group.id,
    name: 'Loot box',
    real: 'loot box',
    nx: 0.5,
    ny: 0.5,
    line: record.sub.discourse || '',
    myth: '',
    done: {},
    loose: true,
  });
}

function say(text) {
  cardSay.hidden = false;
  cardSay.textContent = text;
  state.banner = text;
  state.bannerUntil = performance.now() / 1000 + 4.5;
  voice.textContent = text;
}

function setFloor(name, returns) {
  const spec = state.floor.states[name];
  if (!spec) return;
  state.floorName = name;
  const [r, g, b] = spec.grade;
  grade.style.backgroundColor = `rgb(${byte(r)}, ${byte(g)}, ${byte(b)})`;
  darken.style.opacity = String(spec.darken);
  if (state.returnTimer) window.clearInterval(state.returnTimer);
  state.returnTimer = 0;
  state.returnLeft = 0;
  publishSoon();
  if (returns) {
    state.returnLeft = 8;
    state.returnTimer = window.setInterval(() => {
      state.returnLeft -= 1;
      if (state.returnLeft <= 0) {
        window.clearInterval(state.returnTimer);
        state.returnTimer = 0;
        setFloor(state.floor.default || 'live', false);
      }
    }, 1000);
  }
}

function byte(value) {
  return Math.round(Math.min(1, Math.max(0, value)) * 255);
}

function forgetRoom() {
  state.registry = [];
  state.gold = 0;
  for (const track of state.tracks) {
    track.filed = null;
    track.done = {};
  }
  saveRegistry();
  renderInventory();
  closeCard();
  state.banner = 'The floor forgot the room.';
  state.bannerUntil = performance.now() / 1000 + 3.5;
  publishSoon();
}

function pokeAudio() {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return;
  if (!audio.ctx) {
    audio.ctx = new Ctx();
    const osc = audio.ctx.createOscillator();
    const gain = audio.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = 74;
    gain.gain.value = 0.012;
    osc.connect(gain);
    gain.connect(audio.ctx.destination);
    osc.start();
    audio.drone = { osc, gain };
  }
  if (audio.ctx.state === 'suspended') audio.ctx.resume();
}

function updateAudio(spec, time) {
  if (!audio.ctx || !audio.drone) return;
  const collapse = state.floorName === 'collapse';
  const safe = state.floorName === 'safe';
  audio.drone.osc.frequency.value = safe ? 96 : (collapse ? 54 : 74);
  const wantsTick = (spec.sounds || []).includes('tick');
  if (!wantsTick || time < audio.nextTick) return;
  audio.nextTick = time + (collapse ? 0.72 : 1.35);
  const osc = audio.ctx.createOscillator();
  const gain = audio.ctx.createGain();
  osc.frequency.value = 740;
  gain.gain.setValueAtTime(0.025, audio.ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.0001, audio.ctx.currentTime + 0.07);
  osc.connect(gain);
  gain.connect(audio.ctx.destination);
  osc.start();
  osc.stop(audio.ctx.currentTime + 0.08);
}

restBtn.addEventListener('click', () => {
  if (!state.booted) return;
  setFloor(state.floor.setBy.rest, false);
});

closeBtn.addEventListener('click', () => {
  if (!state.booted) return;
  setFloor(state.floor.setBy.close, true);
});

fileBtn.addEventListener('click', () => {
  picker.hidden = !picker.hidden;
});

rehearseBtn.addEventListener('click', () => {
  setMode(!state.rehearsing);
  if (!state.rehearsing && !state.videoReady) openCamera().then((opened) => {
    if (!opened) setMode(true);
  });
});

cameraBtn.addEventListener('click', async () => {
  const opened = await openCamera();
  if (opened) setMode(false);
  else voice.textContent = 'This browser did not open a camera. Rehearsal is the floor.';
});

forgetBtn.addEventListener('click', forgetRoom);
document.getElementById('card-dismiss').addEventListener('click', closeCard);

headsetBtn.addEventListener('click', async () => {
  if (state.xr) {
    await state.xr.end();
    return;
  }
  headsetBtn.disabled = true;
  document.body.classList.add('in-xr');
  try {
    const { enterHeadset } = await import('./xr.js');
    state.xr = await enterHeadset({
      canvases: state.canvases,
      placement: () => {
        const track = state.tracks.find((item) => item.id === state.selectedId) || state.tracks[0];
        return {
          spriteId: track?.subclass || 'thinking_tool',
          name: track?.filed?.name || 'Filed',
        };
      },
      onEnd: () => {
        state.xr = null;
        document.body.classList.remove('in-xr');
        headsetBtn.textContent = 'Enter headset';
      },
    });
    headsetBtn.textContent = 'Exit headset';
    voice.textContent = 'Pinch or click to leave a marker on the surface you are looking at.';
  } catch {
    document.body.classList.remove('in-xr');
    voice.textContent = 'The headset did not start. The camera floor still works.';
  } finally {
    headsetBtn.disabled = false;
  }
});

window.addEventListener('pointerdown', pokeAudio);
window.addEventListener('pointermove', (event) => {
  state.aimX = (event.clientX / Math.max(1, window.innerWidth)) * 2 - 1;
  state.aimY = (event.clientY / Math.max(1, window.innerHeight)) * 2 - 1;
});
window.addEventListener('deviceorientation', (event) => {
  if (event.gamma == null) return;
  state.aimX = Math.max(-1, Math.min(1, event.gamma / 28));
  state.aimY = Math.max(-1, Math.min(1, ((event.beta || 0) - 42) / 28));
});

window.addEventListener('keydown', (event) => {
  if (!state.booted || event.repeat || event.metaKey || event.ctrlKey || event.altKey) return;
  if (event.key === '1') setFloor('live', false);
  if (event.key === '2') setFloor('safe', false);
  if (event.key === '3') setFloor('collapse', true);
  if (event.key === 'Escape') {
    picker.hidden = true;
    closeCard();
  }
  if (event.key.toLowerCase() === 'f') picker.hidden = !picker.hidden;
});

window.addEventListener('pagehide', saveRegistry);
