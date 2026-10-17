import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const OPENAI_CHAT = 'https://api.openai.com/v1/chat/completions';

const NAME_SYSTEM = [
  'You name ordinary real objects for a live dungeon-crawl floor show.',
  'Reply with JSON only: {"name":"...","line":"..."}.',
  'name is a short original title of two or three words that you invent.',
  'line is one original sentence for an object card.',
  'Use the subclass, class, real-world label, tendencies, and discourse only as flavor.',
  'Do not quote books, lyrics, poems, or existing titles. Do not use quotation marks.',
].join(' ');

const SEQUENCE_SYSTEM = [
  'You write one original sentence that sequences a day on a live dungeon-crawl floor.',
  'Reply with JSON only: {"line":"..."}.',
  'Use the events, the voice, and the templates only as flavor.',
  'Do not quote books, lyrics, poems, or existing titles. Do not use quotation marks.',
  'One sentence.',
].join(' ');

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

function sequenceTarget() {
  const base = envValue('AI_BASE_URL');
  const sponsorKey = envValue('AI_API_KEY');
  if (base && sponsorKey) {
    return {
      provider: 'sponsor',
      url: `${base.replace(/\/+$/, '')}/chat/completions`,
      apiKey: sponsorKey,
    };
  }
  return {
    provider: 'openai',
    url: OPENAI_CHAT,
    apiKey: envValue('OPENAI_API_KEY'),
  };
}

export function sequenceTextProvider() {
  return sequenceTarget().provider;
}

function cleanText(value) {
  if (typeof value !== 'string') return '';
  return value
    .replace(/[“”«»"]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function oneSentence(text) {
  if (!text) return '';
  const match = text.match(/^.*?[.!?](?=\s|$)/);
  return (match ? match[0] : text).trim();
}

function messageText(message) {
  const content = message?.content;
  let text = '';
  if (typeof content === 'string') text = content;
  else if (Array.isArray(content)) {
    text = content.map((part) => (typeof part?.text === 'string' ? part.text : '')).join('');
  }
  if (text.trim()) return text;
  const reasoning = message?.reasoning_content || message?.reasoning;
  return typeof reasoning === 'string' ? reasoning : '';
}

function parseJsonContent(content) {
  const text = String(content || '').trim();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(text.slice(start, end + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

const SPONSOR_MODEL = 'deepseek-ai/deepseek-v4-flash';

async function completeJson({ url, apiKey, system, user, model = 'gpt-4o-mini', reasoningEffort }) {
  if (!apiKey) return null;
  const body = {
    model,
    response_format: { type: 'json_object' },
    temperature: 0.8,
    max_tokens: 180,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
  };
  if (reasoningEffort) body.reasoning_effort = reasoningEffort;
  let response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60_000),
    });
  } catch {
    return null;
  }
  if (!response.ok) return null;
  let data;
  try {
    data = await response.json();
  } catch {
    return null;
  }
  return parseJsonContent(messageText(data?.choices?.[0]?.message));
}

export async function nameObject({ subclass, className, label, tendencies, discourse } = {}) {
  try {
    const parsed = await completeJson({
      url: OPENAI_CHAT,
      apiKey: envValue('OPENAI_API_KEY'),
      system: NAME_SYSTEM,
      user: JSON.stringify({
        subclass: subclass ?? '',
        className: className ?? '',
        label: label ?? '',
        tendencies: Array.isArray(tendencies) ? tendencies : [],
        discourse: discourse ?? '',
      }),
    });
    const name = cleanText(parsed?.name);
    const line = oneSentence(cleanText(parsed?.line));
    if (!name || !line) return { name: '', line: '', error: true };
    return { name, line };
  } catch {
    return { name: '', line: '', error: true };
  }
}

export async function sequenceDay({ events, templates, voice } = {}) {
  try {
    const target = sequenceTarget();
    const parsed = await completeJson({
      url: target.url,
      apiKey: target.apiKey,
      model: target.provider === 'sponsor' ? SPONSOR_MODEL : 'gpt-4o-mini',
      reasoningEffort: target.provider === 'sponsor' ? 'none' : undefined,
      system: SEQUENCE_SYSTEM,
      user: JSON.stringify({
        events: events ?? [],
        templates: templates ?? [],
        voice: voice ?? '',
      }),
    });
    const line = oneSentence(cleanText(parsed?.line));
    if (!line) return { line: '', error: true };
    return { line };
  } catch {
    return { line: '', error: true };
  }
}
