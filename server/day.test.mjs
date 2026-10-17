import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { loadDay, mapEvents, parseIcs } from './day.mjs';

const pack = JSON.parse(readFileSync(new URL('../world-pack.json', import.meta.url), 'utf8'));

const FIXTURE = [
  'BEGIN:VCALENDAR',
  'VERSION:2.0',
  'PRODID:-//Epherial//Day Test//EN',
  'BEGIN:VEVENT',
  'UID:breakfast-past@epherial',
  'SUMMARY:Breakfast',
  'DTSTART:20261017T070000',
  'DTEND:20261017T080000',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'UID:class-1@epherial',
  'SUMMARY:Linear Alge',
  ' bra class',
  'DTSTART:20261017T090000',
  'DTEND:20261017T103000',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'UID:meal-1@epherial',
  'SUMMARY:Lunch with notes',
  'DTSTART:20261017T120000',
  'DTEND:20261017T130000',
  'END:VEVENT',
  'END:VCALENDAR',
].join('\r\n');

const now = new Date('2026-10-17T01:00:00.000Z');

test('fixture keeps the open class and the later meal', () => {
  const events = parseIcs(FIXTURE, now);
  assert.deepEqual(events, [
    {
      id: 'class-1@epherial',
      title: 'Linear Algebra class',
      start: '2026-10-17T00:00:00.000Z',
      end: '2026-10-17T01:30:00.000Z',
    },
    {
      id: 'meal-1@epherial',
      title: 'Lunch with notes',
      start: '2026-10-17T03:00:00.000Z',
      end: '2026-10-17T04:00:00.000Z',
    },
  ]);

  const beats = mapEvents(events, pack);
  assert.equal(beats.length, 2);
  assert.equal(beats[0].verb, 'rest');
  assert.equal(beats[0].target, 'seat');
  assert.equal(beats[0].eventId, 'class-1@epherial');
  assert.equal(beats[0].id, 'rest_seat:class-1@epherial');
  assert.equal(beats[0].line, 'Sit the safe seat for 1 hour 30 minutes while Linear Algebra class is live.');
  assert.equal(beats[1].verb, 'refill');
  assert.equal(beats[1].target, 'drinking_vessel');
  assert.equal(beats[1].id, 'refill_vessel:meal-1@epherial');
  assert.equal(beats[1].line, 'Refill the drinking vessel for Lunch with notes before the house lights dim.');

  const brief = { events, beats, line: beats[0].line };
  assert.equal(brief.line, beats[0].line);
  assert.match(brief.line, /Linear Algebra class/);
  assert.match(brief.line, /safe seat/);
});

test('a null pack still returns generic beats', () => {
  const events = parseIcs(FIXTURE, now);
  const beats = mapEvents(events, null);
  assert.equal(beats[0].verb, 'rest');
  assert.equal(beats[0].target, 'seat');
  assert.equal(beats[0].id, 'rest:class-1@epherial');
  assert.equal(beats[0].line, 'Sit the safe seat for 1 hour 30 minutes for Linear Algebra class.');
  assert.equal(beats[1].verb, 'refill');
  assert.equal(beats[1].target, 'drinking_vessel');
  assert.equal(beats[1].line, 'Refill the drinking vessel for Lunch with notes.');
});

test('social titles patrol the audience and everything else walks the floor', () => {
  const events = [
    {
      id: 'social-1',
      title: 'Friday group call',
      start: '2026-10-17T06:00:00.000Z',
      end: '2026-10-17T07:00:00.000Z',
    },
    {
      id: 'errand-1',
      title: 'Mail run',
      start: '2026-10-17T08:00:00.000Z',
      end: '2026-10-17T08:30:00.000Z',
    },
  ];
  const beats = mapEvents(events, pack);
  assert.equal(beats[0].verb, 'patrol');
  assert.equal(beats[0].target, 'audience_feed');
  assert.match(beats[0].line, /audience is on/i);
  assert.equal(beats[1].verb, 'pass');
  assert.equal(beats[1].target, 'floor');
});

test('zulu stays utc, an all-day date is tokyo midnight, and the list caps at eight', () => {
  const lines = [
    'BEGIN:VCALENDAR',
    'BEGIN:VEVENT',
    'UID:zulu-1',
    'SUMMARY:Seminar',
    'DTSTART:20261017T090000Z',
    'DTEND:20261017T100000Z',
    'END:VEVENT',
  ];
  for (let i = 0; i < 9; i += 1) {
    const hour = String(11 + i).padStart(2, '0');
    lines.push(
      'BEGIN:VEVENT',
      `UID:extra-${i}`,
      'SUMMARY:Meeting',
      `DTSTART:20261017T${hour}0000Z`,
      `DTEND:20261017T${hour}3000Z`,
      'END:VEVENT',
    );
  }
  lines.push('END:VCALENDAR');
  const events = parseIcs(lines.join('\n'), new Date('2026-10-17T08:00:00.000Z'));
  assert.equal(events.length, 8);
  assert.equal(events[0].id, 'zulu-1');
  assert.equal(events[0].start, '2026-10-17T09:00:00.000Z');
  assert.equal(events[1].id, 'extra-0');
  assert.equal(events.at(-1).id, 'extra-6');

  const allDay = parseIcs([
    'BEGIN:VCALENDAR',
    'BEGIN:VEVENT',
    'UID:all-day',
    'SUMMARY:Study block',
    'DTSTART;VALUE=DATE:20261018',
    'DTEND;VALUE=DATE:20261019',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\n'), new Date('2026-10-17T16:00:00.000Z'));
  assert.equal(allDay.length, 1);
  assert.equal(allDay[0].start, '2026-10-17T15:00:00.000Z');
  assert.equal(allDay[0].end, '2026-10-18T15:00:00.000Z');
});

test('an empty feed url does not fetch, and the embed is refused', async () => {
  const original = globalThis.fetch;
  let called = false;
  globalThis.fetch = async () => {
    called = true;
    throw new Error('network');
  };
  try {
    const empty = await loadDay({ icsUrl: '   ', pack, now });
    assert.equal(called, false);
    assert.deepEqual(empty.events, []);
    assert.deepEqual(empty.beats, []);
    assert.equal(empty.line, 'The day feed is not connected.');

    const embed = await loadDay({
      icsUrl: 'https://calendar.google.com/calendar/embed?src=example&ctz=Asia%2FTokyo',
      pack,
      now,
    });
    assert.equal(called, false);
    assert.equal(embed.line, 'The day feed is not connected.');
  } finally {
    globalThis.fetch = original;
  }
});

test('loadDay maps a fixture response without the network', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    url: 'https://example.test/calendar.ics',
    text: async () => FIXTURE,
  });
  try {
    const brief = await loadDay({ icsUrl: 'https://example.test/calendar.ics', pack, now });
    assert.equal(brief.events.length, 2);
    assert.equal(brief.beats[0].verb, 'rest');
    assert.equal(brief.beats[1].verb, 'refill');
    assert.equal(brief.line, brief.beats[0].line);
  } finally {
    globalThis.fetch = original;
  }
});
