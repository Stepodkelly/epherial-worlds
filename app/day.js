// Display embed only. The day feed is GET /api/day. Do not scrape this URL.
export const CALENDAR_EMBED = 'https://calendar.google.com/calendar/embed?src=stephen.kelly%40uni.minerva.edu&ctz=Asia%2FTokyo';

export async function fetchDay() {
  const res = await fetch('/api/day');
  if (!res.ok) throw new Error('day');
  return res.json();
}
