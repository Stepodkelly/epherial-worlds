// Day feed. The secret iCal URL is read from the environment here.
// https://calendar.google.com/calendar/embed is a display link, never a source.

const TOKYO_OFFSET = '+09:00';
const DISCONNECTED = 'The day feed is not connected.';
const EMBED_URL = /calendar\.google\.com\/calendar\/embed/i;
const MAX_EVENTS = 8;

const CLASS_RE = /\b(?:classes|class|lectures|lecture|seminars|seminar|studies|study|work|meetings|meeting)\b/i;
const MEAL_RE = /\b(?:lunches|lunch|dinners|dinner|breakfasts|breakfast|meals|meal|coffees|coffee)\b/i;
const SOCIAL_RE = /\b(?:parties|party|friends|friend|groups|group|calls|call)\b/i;

function disconnected() {
  return { events: [], beats: [], line: DISCONNECTED };
}

function unfoldIcs(text) {
  return String(text)
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\n[ \t]/g, '');
}

function unescapeIcs(value) {
  let out = '';
  for (let i = 0; i < value.length; i += 1) {
    if (value[i] === '\\' && i + 1 < value.length) {
      const next = value[i + 1];
      if (next === 'n' || next === 'N') out += ' ';
      else out += next;
      i += 1;
    } else {
      out += value[i];
    }
  }
  return out.replace(/\s+/g, ' ').trim();
}

function readProps(block) {
  const props = new Map();
  let depth = 0;
  for (const rawLine of block.split('\n')) {
    const line = rawLine.trimEnd();
    if (!line) continue;
    const upper = line.toUpperCase();
    if (upper.startsWith('BEGIN:')) {
      depth += 1;
      continue;
    }
    if (upper.startsWith('END:')) {
      depth = Math.max(0, depth - 1);
      continue;
    }
    if (depth > 0) continue;
    const splitAt = line.indexOf(':');
    if (splitAt <= 0) continue;
    const name = line.slice(0, splitAt).split(';')[0].trim().toUpperCase();
    if (!name || props.has(name)) continue;
    const params = {};
    for (const part of line.slice(0, splitAt).split(';').slice(1)) {
      const eq = part.indexOf('=');
      if (eq === -1) continue;
      let paramValue = part.slice(eq + 1).trim();
      if (paramValue.length >= 2 && paramValue.startsWith('"') && paramValue.endsWith('"')) {
        paramValue = paramValue.slice(1, -1);
      }
      params[part.slice(0, eq).trim().toUpperCase()] = paramValue;
    }
    props.set(name, { value: line.slice(splitAt + 1).trim(), params });
  }
  return props;
}

function isUtcZone(tzid) {
  return /^(UTC|GMT|Z|ETC\/UTC|ETC\/GMT|ETC\/GMT\+0)$/i.test(tzid);
}

function isDateOnly(prop) {
  const kind = String(prop.params.VALUE || '').toUpperCase();
  return kind === 'DATE' || /^\d{8}$/.test(prop.value.trim());
}

// Floating times, and any zone other than UTC, are Asia/Tokyo wall time.
function parseStamp(prop) {
  if (!prop) return null;
  const match = prop.value.trim().match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?)?(Z)?$/i);
  if (!match) return null;
  const [, year, month, day, hour, minute, second, zulu] = match;
  if (isDateOnly(prop) || !hour) {
    return new Date(`${year}-${month}-${day}T00:00:00${TOKYO_OFFSET}`);
  }
  const clock = `${year}-${month}-${day}T${hour}:${minute}:${second || '00'}`;
  const tzid = prop.params.TZID || '';
  const utc = Boolean(zulu) || isUtcZone(tzid);
  const date = new Date(utc ? `${clock}Z` : `${clock}${TOKYO_OFFSET}`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function endOf(startProp, start, endProp) {
  const parsed = parseStamp(endProp);
  if (parsed) return parsed;
  if (isDateOnly(startProp)) return new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return new Date(start.getTime());
}

function stillOpen(event, now) {
  return event.end.getTime() > now.getTime();
}

export function parseIcs(icsText, now = new Date()) {
  const text = unfoldIcs(icsText);
  const events = [];
  for (const chunk of text.split(/BEGIN:VEVENT/i).slice(1)) {
    const block = chunk.split(/END:VEVENT/i)[0];
    const props = readProps(block);
    const status = props.get('STATUS');
    if (status && status.value.toUpperCase() === 'CANCELLED') continue;
    const summary = props.get('SUMMARY');
    const startProp = props.get('DTSTART');
    if (!summary || !startProp) continue;
    const start = parseStamp(startProp);
    if (!start) continue;
    const end = endOf(startProp, start, props.get('DTEND'));
    if (Number.isNaN(end.getTime()) || end.getTime() < start.getTime()) continue;
    const title = unescapeIcs(summary.value);
    if (!title) continue;
    const uid = props.get('UID');
    const id = uid ? unescapeIcs(uid.value) : `${title}:${start.toISOString()}`;
    events.push({ id, title, start, end });
  }
  return events
    .filter((event) => stillOpen(event, now))
    .sort((a, b) => a.start - b.start || a.end - b.end || a.id.localeCompare(b.id))
    .slice(0, MAX_EVENTS)
    .map((event) => ({
      id: event.id,
      title: event.title,
      start: event.start.toISOString(),
      end: event.end.toISOString(),
    }));
}

function spanPhrase(startIso, endIso) {
  const ms = Date.parse(endIso) - Date.parse(startIso);
  if (!Number.isFinite(ms) || ms <= 0) return 'its length';
  const minutes = Math.round(ms / 60000);
  if (minutes >= 1440 && minutes % 1440 === 0) {
    const days = minutes / 1440;
    return `${days} day${days === 1 ? '' : 's'}`;
  }
  const hours = Math.floor(minutes / 60);
  const rem = minutes % 60;
  const parts = [];
  if (hours) parts.push(`${hours} hour${hours === 1 ? '' : 's'}`);
  if (rem) parts.push(`${rem} minute${rem === 1 ? '' : 's'}`);
  return parts.length ? parts.join(' ') : 'its length';
}

function kindFor(title) {
  if (CLASS_RE.test(title)) return 'class';
  if (MEAL_RE.test(title)) return 'meal';
  if (SOCIAL_RE.test(title)) return 'social';
  return 'floor';
}

function assignmentFor(kind) {
  if (kind === 'class') return { verb: 'rest', target: 'seat' };
  if (kind === 'meal') return { verb: 'refill', target: 'drinking_vessel' };
  if (kind === 'social') return { verb: 'patrol', target: 'audience_feed' };
  return { verb: 'pass', target: 'floor' };
}

function questFor(pack, verb, target) {
  const quests = pack?.quests;
  if (!Array.isArray(quests)) return null;
  return quests.find((quest) => quest.verb === verb && quest.target === target) || null;
}

function beatLine(event, kind, pack) {
  const title = event.title;
  const show = Boolean(pack?.voice);
  if (kind === 'class') {
    const length = spanPhrase(event.start, event.end);
    return show
      ? `Sit the safe seat for ${length} while ${title} is live.`
      : `Sit the safe seat for ${length} for ${title}.`;
  }
  if (kind === 'meal') {
    return show
      ? `Refill the drinking vessel for ${title} before the house lights dim.`
      : `Refill the drinking vessel for ${title}.`;
  }
  if (kind === 'social') {
    return show
      ? `The audience is on for ${title}, so give the crowd a wave.`
      : `The audience is on for ${title}.`;
  }
  return show
    ? `Pass the floor and clear ${title} before the collapse clock bites.`
    : `Pass the floor for ${title}.`;
}

export function mapEvents(events, pack) {
  return (events || []).map((event) => {
    const kind = kindFor(event.title || '');
    const { verb, target } = assignmentFor(kind);
    const quest = questFor(pack, verb, target);
    return {
      id: quest ? `${quest.id}:${event.id}` : `${verb}:${event.id}`,
      verb,
      target,
      line: beatLine(event, kind, pack),
      eventId: event.id,
    };
  });
}

export async function loadDay({ icsUrl = process.env.CALENDAR_ICS_URL, pack = null, now = new Date() } = {}) {
  const url = typeof icsUrl === 'string' ? icsUrl.trim() : '';
  if (!url || EMBED_URL.test(url)) return disconnected();
  let text = '';
  try {
    const res = await fetch(url);
    if (!res.ok || EMBED_URL.test(res.url || '')) return disconnected();
    text = await res.text();
  } catch {
    return disconnected();
  }
  const events = parseIcs(text, now);
  const beats = mapEvents(events, pack);
  return {
    events,
    beats,
    line: beats[0]?.line || '',
  };
}
