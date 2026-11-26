'use strict';
/* Imports SpeedQuizzing quiz nights in the USA from SpeedQuizzing's public quiz finder (speedquizzing.com/find).
 * The finder page lists every upcoming SpeedQuizzing event with its map position; each event has its own page
 * with the venue, address, start time, entry, prizes, team size and age. We run this when the site starts (if it
 * hasn't run for 6 days) and again every week, so new US quizzes appear and ones that stop are taken down.
 * Quizzes that a host has claimed on Find a Quiz are never changed by the import. */

const SQ = 'https://www.speedquizzing.com';
const DAYS = { sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6 };

// US state from the first three digits of a ZIP code
const ZIP3 = [
  [5, 5, 'NY'], [10, 27, 'MA'], [28, 29, 'RI'], [30, 38, 'NH'], [39, 49, 'ME'], [50, 59, 'VT'], [60, 69, 'CT'], [70, 89, 'NJ'],
  [100, 149, 'NY'], [150, 196, 'PA'], [197, 199, 'DE'], [200, 200, 'DC'], [201, 201, 'VA'], [202, 205, 'DC'], [206, 219, 'MD'],
  [220, 246, 'VA'], [247, 268, 'WV'], [270, 289, 'NC'], [290, 299, 'SC'], [300, 319, 'GA'], [320, 349, 'FL'], [350, 369, 'AL'],
  [370, 385, 'TN'], [386, 397, 'MS'], [398, 399, 'GA'], [400, 427, 'KY'], [430, 458, 'OH'], [460, 479, 'IN'], [480, 499, 'MI'],
  [500, 528, 'IA'], [530, 549, 'WI'], [550, 567, 'MN'], [570, 577, 'SD'], [580, 588, 'ND'], [590, 599, 'MT'], [600, 629, 'IL'],
  [630, 658, 'MO'], [660, 679, 'KS'], [680, 693, 'NE'], [700, 714, 'LA'], [716, 729, 'AR'], [730, 732, 'OK'], [733, 733, 'TX'],
  [734, 749, 'OK'], [750, 799, 'TX'], [800, 816, 'CO'], [820, 831, 'WY'], [832, 838, 'ID'], [840, 847, 'UT'], [850, 865, 'AZ'],
  [870, 884, 'NM'], [885, 885, 'TX'], [889, 898, 'NV'], [900, 961, 'CA'], [967, 968, 'HI'], [970, 979, 'OR'], [980, 994, 'WA'], [995, 999, 'AK'],
];
function zipState(zip) {
  const m = /^(\d{3})\d{2}(?:-\d{4})?$/.exec(String(zip || '').trim()); if (!m) return '';
  const n = +m[1]; const r = ZIP3.find(([a, b]) => n >= a && n <= b); return r ? r[2] : '';
}

const decode = (s) => String(s || '').replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&#0?39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n)).replace(/\\+'/g, "'").replace(/\s+/g, ' ').trim();

// "7:00pm" "6:30PM" "8:00" "730" "2000" -> "19:00" style, or '' if it can't be read
function parseTime(t) {
  t = String(t || '').trim().toLowerCase().replace(/\s+/g, '').replace(/\./g, '');
  let m = /^(\d{1,2})(?::?(\d{2}))?(am|pm)?$/.exec(t);
  if (!m) return '';
  let h = +m[1], mi = m[2] ? +m[2] : 0;
  if (h > 23 || mi > 59) return '';
  if (m[3] === 'pm' && h < 12) h += 12;
  if (m[3] === 'am' && h === 12) h = 0;
  if (!m[3] && h >= 1 && h <= 11) h += 12; // quiz nights without am/pm are evening quizzes
  return String(h).padStart(2, '0') + ':' + String(mi).padStart(2, '0');
}

// The details after "Hosted by ...": "Prizes, $50 bar tab | Free to play | Max 6 per team | Age 21+"
function parseDetails(s) {
  const out = { prizes: '', fee: null, teamMax: null, ages: '' };
  for (let part of String(s || '').split('|').map((x) => x.trim()).filter(Boolean)) {
    let m;
    if (/^prizes?\b/i.test(part)) { out.prizes = part.replace(/^prizes?,?\s*/i, '').slice(0, 200); continue; }
    if ((m = /^max\s+(\d+)\s+per\s+team/i.exec(part))) { if (+m[1] > 0 && +m[1] <= 50) out.teamMax = +m[1]; continue; }
    if ((m = /^age\s+(.*)$/i.exec(part))) {
      const a = m[1].replace(/\+/g, '').trim().toLowerCase();
      out.ages = /^21/.test(a) ? '21' : /^18/.test(a) ? '18' : /^16/.test(a) ? '16' : /^12/.test(a) ? '12' : /^(all|0|5)\b/.test(a) ? 'all' : '';
      continue;
    }
    part = part.replace(/\s*to\s*play$/i, '').trim();
    if (/^(free|\$?\s*0(\.00)?\s*\$?|none|0 with any purchase.*|\$0 with.*)$/i.test(part) || /^free\b/i.test(part)) out.fee = { free: true };
    else if ((m = /^\$?\s*(\d+(?:\.\d{1,2})?)\s*\$?\s*(?:per\s*(person|player|team))?/i.exec(part)) && +m[1] > 0 && +m[1] < 200)
      out.fee = { free: false, amount: +m[1], currency: 'USD', per: /team/i.test(m[2] || '') ? 'team' : 'person' };
  }
  return out;
}

// One event page -> the parts we need (or null if the page isn't in the expected shape)
function parseEventPage(html) {
  const head = /<title>[^<]*?Pub Quiz\s*•\s*(.*?)\s*•\s*Next on/i.exec(html);
  const where = /fa-map-marker-alt[^>]*><\/i>\s*<b>([\s\S]*?)<\/b>\s*,?\s*([\s\S]*?)<\/p>/i.exec(html);
  const when = /fa-clock[^>]*><\/i>\s*([^<•]*?)\s*•\s*(\w+day)\b/i.exec(html);
  const meta = /<meta name="description" content="([^"]*)"/i.exec(html);
  const desc = meta ? decode(meta[1]) : '';
  const bar = desc.indexOf('|');
  const host = ((bar >= 0 ? desc.slice(0, bar) : desc).match(/Hosted by ([^,|]+?)\s*$/) || [, ''])[1].trim();
  const extra = bar >= 0 ? desc.slice(bar + 1) : '';
  if (!where) return null;
  const venue = decode(where[1]);
  const parts = decode(where[2]).split(',').map((x) => x.trim()).filter(Boolean);
  let zip = '';
  if (parts.length && /^(\d{5}(-\d{4})?|[A-Z]\d[A-Z] ?\d[A-Z]\d)$/i.test(parts[parts.length - 1])) zip = parts.pop();
  let town = parts.length > 1 ? parts.pop() : '';
  if (/township|charter town/i.test(town) && parts.length > 1) town = parts.pop();
  const address = parts.join(', ');
  let title = head ? decode(head[1]).replace(/,\s*[^,]+$/, '') : '';
  if (title.includes(' @ ')) title = title.split(' @ ')[0].trim() + ' @ ' + venue; // SpeedQuizzing cuts titles at 40 letters
  if (!title) title = 'Quiz Night @ ' + venue;
  return {
    title, venue, address, town, zip,
    time: when ? parseTime(when[1]) : '', day: when ? DAYS[when[2].toLowerCase()] : undefined,
    host, details: parseDetails(extra),
  };
}

// The finder page: every upcoming event with its position and next date
function parseFinder(html) {
  const m = /var\s+events\s*=\s*JSON\.parse\('(\[[\s\S]*?\])'\)/.exec(html);
  if (!m) throw new Error('SpeedQuizzing finder page has changed (no event list found)');
  return JSON.parse(m[1].replace(/\\'/g, "'").replace(/\\\\/g, '\\'));
}
const inUSA = (lat, lon) => (lat > 24 && lat < 49.4 && lon > -125 && lon < -66.5) || (lat > 51 && lat < 72 && lon < -129 && lon > -170) || (lat > 18 && lat < 23 && lon > -161 && lon < -154);

async function get(url) {
  const r = await fetch(url, { headers: { 'User-Agent': 'FindAQuiz/1.0 (+https://www.find-a-quiz.com)', Accept: 'text/html' }, signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error(`${url} -> ${r.status}`);
  return r.text();
}

/* Run an import. db and helpers come from the server.
 *   upsert(listingData, sqId) adds or updates a listing; markUnseen(seenIds) takes down old unclaimed ones. */
async function syncUSA({ upsert, markUnseen, log = console.log }) {
  const all = parseFinder(await get(`${SQ}/find/`));
  const byId = new Map();
  for (const e of all) {
    const lat = +e.lat, lon = +e.lon;
    if (!e.event_id || !inUSA(lat, lon)) continue;
    const cur = byId.get(e.event_id);
    if (!cur || e.date < cur.date) byId.set(e.event_id, { id: String(e.event_id), lat, lon, date: e.date, day: DAYS[String(e.day || '').toLowerCase()] });
  }
  const list = [...byId.values()];
  const result = { found: list.length, added: 0, updated: 0, skipped: 0, failed: 0 };
  let i = 0;
  async function worker() {
    while (i < list.length) {
      const e = list[i++];
      try {
        const p = parseEventPage(await get(`${SQ}/events/${e.id}/`));
        if (!p) { result.skipped++; continue; }
        const state = zipState(p.zip);
        if (p.zip && !state) { result.skipped++; continue; } // a Canadian postcode, not the USA
        const day = e.day != null ? e.day : p.day;
        if (day == null) { result.skipped++; continue; }
        const r = upsert({
          title: p.title, venue: p.venue, address: p.address, town: p.town, region: state, postcode: p.zip, country: 'US',
          lat: e.lat, lng: e.lon, schedule: { repeat: 'weekly', days: [day], time: p.time },
          fee: p.details.fee, teamMax: p.details.teamMax, ages: p.details.ages, prizes: p.details.prizes, host: p.host,
          types: ['general'], formats: ['app'],
          description: 'A SpeedQuizzing trivia night: teams answer on their phones using the free SpeedQuizzing app (no pens or paper). Found on SpeedQuizzing’s quiz finder, so check with the venue how often it runs before you go.',
          sourceUrl: `${SQ}/events/${e.id}/`,
        }, e.id);
        result[r]++;
      } catch (err) { result.failed++; log('SpeedQuizzing import: event', e.id, err.message); }
      await new Promise((ok) => setTimeout(ok, 250)); // go gently on their site
    }
  }
  await Promise.all([worker(), worker(), worker()]);
  result.hidden = markUnseen(new Set(list.map((e) => e.id)));
  return result;
}

module.exports = { syncUSA, parseEventPage, parseFinder, parseDetails, parseTime, zipState };
