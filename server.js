'use strict';
/* Find a Quiz (find-a-quiz.com): find a quiz night near you, anywhere in the world.
 * Plain Node.js, nothing to install. Listings cost £2 (paid by card through SumUp, like The Big Quiz Live site).
 * Everything is saved in DATA_DIR: listings.json plus a photos/ folder. On Railway, attach a volume there. */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const S = require('./public/schedule');
const L = require('./public/labels');
const { seedListings, slugify } = require('./lib/seed');
const sq = require('./lib/speedquizzing');

// ---- Settings (Railway Variables) --------------------------------------------------------------
const PORT = process.env.PORT || 3000;
const SITE_URL = (process.env.SITE_URL || `http://localhost:${PORT}`).replace(/\/+$/, '');
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'listings.json');
const PHOTO_DIR = path.join(DATA_DIR, 'photos');
const PUBLIC = path.join(__dirname, 'public');
const SUMUP_API_KEY = process.env.SUMUP_API_KEY || '';
const SUMUP_MERCHANT_CODE = process.env.SUMUP_MERCHANT_CODE || '';
const SUMUP_BASE = process.env.SUMUP_BASE || 'https://api.sumup.com';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const RESEND_API_KEY = process.env.RESEND_API_KEY || '';           // optional: email people their "manage" link
const MAIL_FROM = process.env.MAIL_FROM || 'Find a Quiz <hello@find-a-quiz.com>';
const CONTACT_EMAIL = process.env.CONTACT_EMAIL || '';
const NO_GEOCODE = process.env.NO_GEOCODE === '1';                  // for testing without internet

if (!ADMIN_PASSWORD) console.warn('WARNING: ADMIN_PASSWORD is not set, so the admin page is switched off.');
if (!SUMUP_API_KEY || !SUMUP_MERCHANT_CODE) console.warn('WARNING: SUMUP_API_KEY / SUMUP_MERCHANT_CODE not set. Paid listings will not work.');

// ---- Storage: one JSON file, written safely ---------------------------------------------------
const DEFAULT_SETTINGS = {
  price: 2,               // £ per quiz date (a weekly quiz listed for 8 weeks = 8 dates = £16)
  maxEvents: 52,          // most quiz dates that can be paid for at once
  maxPhotos: 4,           // photos per listing
  maxPhotoKB: 400,        // biggest single photo after it's been shrunk in the browser
  storageCapMB: 1024,     // stop accepting photos once all photos together reach this
  paymentsOn: true,       // switch off to pause new listings
  notice: '',             // optional message across the top of every page
};
let db = { listings: {}, pending: {}, photos: {}, reports: [], settings: {}, geocache: {} };
try { db = Object.assign(db, JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'))); } catch (e) { /* first run */ }
db.settings = Object.assign({}, DEFAULT_SETTINGS, db.settings);
delete db.settings.listingDays; // (listings used to be paid by the year; now it's per quiz date)
fs.mkdirSync(PHOTO_DIR, { recursive: true });
if (!db.seeded) { for (const l of seedListings()) db.listings[l.id] = l; db.seeded = new Date().toISOString(); save(); }

let saveTimer = null;
function save() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = DATA_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db));
  fs.renameSync(tmp, DATA_FILE);
}
function saveSoon() { clearTimeout(saveTimer); saveTimer = setTimeout(save, 300); }

// ---- Helpers ------------------------------------------------------------------------------------
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const newToken = (n = 18) => crypto.randomBytes(n).toString('base64url');
const hash = (s) => crypto.createHash('sha256').update(String(s)).digest('base64url');
const nowIso = () => new Date().toISOString();
const londonToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const clientIp = (req) => String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '?').split(',')[0].trim();
const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

function send(res, status, body, type = 'application/json; charset=utf-8', extra = {}) {
  res.writeHead(status, Object.assign({
    'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin', 'X-Frame-Options': 'SAMEORIGIN',
  }, extra));
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}
const json = (res, status, obj) => send(res, status, obj);
const htmlRes = (res, status, body) => send(res, status, body, 'text/html; charset=utf-8');
function redirect(res, to) { res.writeHead(302, { Location: to }); res.end(); }

function readRaw(req, limit) {
  return new Promise((resolve, reject) => {
    let n = 0, over = false; const chunks = [];
    if (Number(req.headers['content-length']) > limit) over = true;
    // Too big: stop keeping it (but let it finish arriving, so the browser gets our message instead of a broken connection)
    req.on('data', (c) => { n += c.length; if (n > limit) over = true; if (!over) chunks.push(c); });
    req.on('end', () => (over ? reject(Object.assign(new Error('too large'), { code: 'TOO_LARGE' })) : resolve(Buffer.concat(chunks))));
    req.on('error', reject);
  });
}
async function readJson(req, limit = 60_000) {
  const b = await readRaw(req, limit);
  if (!b.length) return {};
  try { return JSON.parse(b.toString('utf8')); } catch (e) { throw Object.assign(new Error('bad json'), { code: 'BAD_JSON' }); }
}

// Simple per-visitor limits (e.g. 40 photo uploads an hour)
const buckets = new Map();
function limited(key, max, windowMs) {
  const now = Date.now(); let b = buckets.get(key);
  if (!b || now > b.reset) { b = { n: 0, reset: now + windowMs }; buckets.set(key, b); }
  b.n++; return b.n > max;
}
setInterval(() => { const now = Date.now(); for (const [k, b] of buckets) if (now > b.reset) buckets.delete(k); }, 10 * 60_000).unref();

// ---- Cleaning what people type in ---------------------------------------------------------------
const txt = (v, max) => (typeof v === 'string' ? v.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').replace(/[ \t]+/g, ' ').trim().slice(0, max) : '');
const line = (v, max) => txt(v, max).replace(/\s+/g, ' ');
function cleanUrl(v) {
  let s = line(v, 300); if (!s) return '';
  if (!/^https?:\/\//i.test(s)) s = 'https://' + s;
  try { const u = new URL(s); return /^https?:$/.test(u.protocol) && u.hostname.includes('.') ? u.href : ''; } catch (e) { return ''; }
}
const pick = (arr, allowed) => Array.isArray(arr) ? [...new Set(arr.filter((x) => own(allowed, x)))] : [];
const isYmd = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !!S.parse(s);
const isTime = (s) => typeof s === 'string' && /^([01]?\d|2[0-3]):[0-5]\d$/.test(s);

function cleanSchedule(s) {
  s = s || {};
  const repeat = ['weekly', 'fortnightly', 'monthly', 'once'].includes(s.repeat) ? s.repeat : null;
  if (!repeat) return { error: 'Choose how often the quiz happens.' };
  const time = isTime(s.time) ? s.time.padStart(5, '0') : '';
  if (!time) return { error: 'Choose a start time.' };
  const out = { repeat, time };
  if (isTime(s.endTime)) out.endTime = s.endTime.padStart(5, '0');
  if (repeat === 'once') {
    if (!isYmd(s.date)) return { error: 'Choose the date of the quiz.' };
    out.date = s.date; return out;
  }
  const days = Array.isArray(s.days) ? [...new Set(s.days.map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))] : [];
  if (!days.length) return { error: 'Choose which day the quiz is on.' };
  out.days = days;
  if (repeat === 'monthly') {
    const w = Array.isArray(s.weeks) ? [...new Set(s.weeks.map(Number).filter((x) => [1, 2, 3, 4, 5, -1].includes(x)))] : [];
    if (!w.length) return { error: 'Choose which week of the month (1st, 2nd, last…).' };
    out.weeks = w;
  }
  if (repeat === 'fortnightly') {
    if (!isYmd(s.anchor)) return { error: 'For a fortnightly quiz, give the date of the next one.' };
    out.anchor = s.anchor;
  }
  return out;
}

// Turns what the listing form sends into a clean listing (or a list of what's missing)
function cleanListing(b) {
  const errors = [];
  const d = {};
  d.title = line(b.title, 90); if (d.title.length < 3) errors.push('Give your quiz a name.');
  d.online = !!b.online;
  d.venue = line(b.venue, 90);
  d.address = line(b.address, 160);
  d.town = line(b.town, 70);
  d.region = line(b.region, 70);
  d.postcode = line(b.postcode, 16).toUpperCase();
  d.country = L.COUNTRIES.includes(b.country) ? b.country : (typeof b.country === 'string' && /^[A-Z]{2}$/.test(b.country) ? b.country : 'GB');
  d.onlineLink = cleanUrl(b.onlineLink);
  const lat = Number(b.lat), lng = Number(b.lng);
  d.lat = Number.isFinite(lat) && Math.abs(lat) <= 90 ? Math.round(lat * 1e6) / 1e6 : null;
  d.lng = Number.isFinite(lng) && Math.abs(lng) <= 180 ? Math.round(lng * 1e6) / 1e6 : null;
  if (!d.online) {
    if (!d.venue) errors.push('Add the name of the venue.');
    if (!d.town) errors.push('Add the town or city.');
    if (d.lat == null || d.lng == null) errors.push('Find the venue on the map (press "Find on map", then drag the pin if needed).');
  }
  const sch = cleanSchedule(b.schedule);
  if (sch.error) errors.push(sch.error); else d.schedule = sch;
  const f = b.fee || {};
  if (f.free) d.fee = { free: true };
  else if (f.amount !== '' && f.amount != null && Number.isFinite(Number(f.amount)) && Number(f.amount) >= 0 && Number(f.amount) < 100000)
    d.fee = { free: false, amount: Math.round(Number(f.amount) * 100) / 100, currency: L.CURRENCIES.includes(f.currency) ? f.currency : 'GBP', per: f.per === 'team' ? 'team' : 'person' };
  else d.fee = null;
  const tm = Number(b.teamMax); d.teamMax = Number.isInteger(tm) && tm > 0 && tm <= 50 ? tm : null;
  d.ages = own(L.AGES, b.ages) ? b.ages : '';
  d.types = pick(b.types, L.TYPES); if (!d.types.length) d.types = ['general'];
  d.formats = pick(b.formats, L.FORMATS);
  d.features = pick(b.features, L.FEATURES);
  d.prizeTags = pick(b.prizeTags, L.PRIZES);
  d.prizes = line(b.prizes, 200);
  const bk = b.booking || {};
  d.booking = (bk.required || bk.link || bk.phone || bk.note) ? { required: !!bk.required, link: cleanUrl(bk.link), phone: line(bk.phone, 30), note: line(bk.note, 200) } : null;
  d.host = line(b.host, 80);
  d.website = cleanUrl(b.website);
  d.facebook = cleanUrl(b.facebook);
  d.phone = line(b.phone, 30);
  d.description = txt(b.description, 1500).replace(/\n{3,}/g, '\n\n');
  const c = b.contact || {};
  d.contact = { name: line(c.name, 80), email: line(c.email, 120).toLowerCase(), phone: line(c.phone, 30) };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.contact.email)) errors.push('Add your email address (it stays private, and is how you get your edit link).');
  return { data: d, errors };
}

// ---- Photos -------------------------------------------------------------------------------------
function photoKind(buf) {
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { ext: 'jpg', type: 'image/jpeg' };
  if (buf.length > 8 && buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { ext: 'png', type: 'image/png' };
  if (buf.length > 12 && buf.slice(0, 4).toString() === 'RIFF' && buf.slice(8, 12).toString() === 'WEBP') return { ext: 'webp', type: 'image/webp' };
  return null;
}
const storageBytes = () => Object.values(db.photos).reduce((n, p) => n + (p.size || 0), 0);
const photoUrl = (id) => (db.photos[id] ? `/photos/${id}.${db.photos[id].ext}` : '');
function deletePhoto(id) {
  const p = db.photos[id]; if (!p) return;
  try { fs.unlinkSync(path.join(PHOTO_DIR, `${id}.${p.ext}`)); } catch (e) { /* already gone */ }
  delete db.photos[id];
}
// Photo ids a form sent, kept only if they exist and aren't someone else's
function claimPhotos(ids, listingId) {
  const max = db.settings.maxPhotos;
  return (Array.isArray(ids) ? ids : []).filter((id) => typeof id === 'string' && db.photos[id] && (!db.photos[id].listing || db.photos[id].listing === listingId)).slice(0, max);
}
function attachPhotos(listing, ids) {
  const keep = new Set(ids);
  for (const old of listing.photos || []) if (!keep.has(old)) deletePhoto(old);
  for (const id of ids) if (db.photos[id]) db.photos[id].listing = listing.id;
  listing.photos = ids;
}

// ---- Listings -----------------------------------------------------------------------------------
const listingsArr = () => Object.values(db.listings);
function isLive(l, today = londonToday()) {
  if (l.status !== 'active') return false;
  if (l.expiresAt && l.expiresAt < nowIso()) return false;
  if (l.schedule && l.schedule.repeat === 'once' && l.schedule.date < today) return false;
  return true;
}
function uniqueSlug(base, id) {
  let s = slugify(base) || 'quiz', n = 2;
  const taken = (x) => listingsArr().some((l) => l.slug === x && l.id !== id);
  while (taken(s)) s = `${slugify(base)}-${n++}`;
  return s;
}
// What visitors see (never the lister's private contact details)
function publicListing(l, full = false) {
  const next = S.nextDates(l.schedule, londonToday(), full ? 6 : 1);
  const o = {
    id: l.id, slug: l.slug, url: `/quiz/${l.slug}`, title: l.title, venue: l.venue, town: l.town, region: l.region, postcode: l.postcode, country: l.country,
    address: l.address, lat: l.lat, lng: l.lng, online: l.online, schedule: l.schedule, when: S.whenText(l.schedule), next: next[0] || null,
    fee: l.fee, feeText: L.feeText(l.fee), teamMax: l.teamMax, ages: l.ages, types: l.types, formats: l.formats, features: l.features,
    prizes: l.prizes, prizeTags: l.prizeTags || [], verified: l.verified, featured: l.featured, source: l.source,
    photo: l.photos && l.photos[0] ? photoUrl(l.photos[0]) : '',
  };
  if (full) Object.assign(o, {
    nextDates: next, photos: (l.photos || []).map(photoUrl).filter(Boolean), description: l.description, booking: l.booking, host: l.host,
    website: l.website, facebook: l.facebook, phone: l.phone, onlineLink: l.onlineLink, sourceUrl: l.sourceUrl, lastChecked: l.lastChecked,
  });
  return o;
}
function km(aLat, aLng, bLat, bLng) {
  const r = (x) => (x * Math.PI) / 180, R = 6371;
  const dLat = r(bLat - aLat), dLng = r(bLng - aLng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(r(aLat)) * Math.cos(r(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// ---- Paying per quiz date ----------------------------------------------------------------------
// A listing stays up until the morning after the last quiz date paid for.
const endOfQuizDay = (ymd) => new Date(Date.parse(ymd + 'T00:00:00Z') + 30 * 3600_000).toISOString();
function coverage(schedule, fromYmd, n) {
  const dates = S.nextDates(schedule, fromYmd, Math.max(1, n));
  return { dates, events: dates.length, until: dates.length ? endOfQuizDay(dates[dates.length - 1]) : null };
}
const wantEvents = (v) => Math.min(Math.max(parseInt(v, 10) || 1, 1), db.settings.maxEvents);
// How many paid dates are still to come (used when a host changes their quiz's days)
const datesLeft = (l, today = londonToday()) => (l.expiresAt ? S.nextDates(l.schedule, today, 400).filter((d) => endOfQuizDay(d) <= l.expiresAt).length : 0);

// ---- Looking places up (postcodes.io for UK postcodes, OpenStreetMap for everything else) ---------
const UK_POSTCODE = /^([A-Z]{1,2}\d[A-Z\d]?)\s*(\d[A-Z]{2})$/i;
const UK_OUTCODE = /^[A-Z]{1,2}\d[A-Z\d]?$/i;
let lastNominatim = 0;
async function getJson(url, opts = {}) {
  const r = await fetch(url, Object.assign({ headers: { 'User-Agent': `FindAQuiz/1.0 (${SITE_URL})`, Accept: 'application/json' }, signal: AbortSignal.timeout(8000) }, opts));
  if (!r.ok) throw new Error(`lookup ${r.status}`);
  return r.json();
}
async function geocode(q, country) {
  q = line(q, 120); if (!q) return [];
  const key = (country || '') + '|' + q.toLowerCase();
  if (db.geocache[key] && Date.now() - db.geocache[key].at < 30 * 86400_000) return db.geocache[key].r;
  if (NO_GEOCODE) return [];
  let r = [];
  try {
    if (UK_POSTCODE.test(q)) {
      const j = await getJson(`https://api.postcodes.io/postcodes/${encodeURIComponent(q)}`);
      if (j.result) r = [{ name: `${j.result.postcode}, ${j.result.admin_district || j.result.parish || ''}`.replace(/, $/, ''), lat: j.result.latitude, lng: j.result.longitude, country: 'GB', postcode: j.result.postcode, town: j.result.admin_district || '' }];
    } else if (UK_OUTCODE.test(q)) {
      const j = await getJson(`https://api.postcodes.io/outcodes/${encodeURIComponent(q)}`);
      if (j.result) r = [{ name: `${j.result.outcode}, ${(j.result.admin_district || [])[0] || ''}`.replace(/, $/, ''), lat: j.result.latitude, lng: j.result.longitude, country: 'GB' }];
    }
  } catch (e) { /* not a real postcode: fall through to OpenStreetMap */ }
  if (!r.length) {
    // OpenStreetMap's rules: at most one look-up a second, and say who we are
    const wait = Math.max(0, lastNominatim + 1100 - Date.now()); lastNominatim = Date.now() + wait;
    if (wait) await new Promise((ok) => setTimeout(ok, wait));
    const u = new URL('https://nominatim.openstreetmap.org/search');
    u.searchParams.set('q', q); u.searchParams.set('format', 'jsonv2'); u.searchParams.set('limit', '5'); u.searchParams.set('addressdetails', '1');
    if (country) u.searchParams.set('countrycodes', country.toLowerCase());
    if (CONTACT_EMAIL) u.searchParams.set('email', CONTACT_EMAIL);
    try {
      const j = await getJson(u.href, { headers: { 'User-Agent': `FindAQuiz/1.0 (${SITE_URL})`, 'Accept-Language': 'en-GB,en' } });
      r = (j || []).map((x) => ({ name: x.display_name, lat: Number(x.lat), lng: Number(x.lon), country: x.address && x.address.country_code ? x.address.country_code.toUpperCase() : '',
        postcode: (x.address && x.address.postcode) || '', town: x.address ? (x.address.city || x.address.town || x.address.village || x.address.suburb || '') : '' }));
    } catch (e) { console.error('geocode failed', e.message); return []; }
  }
  db.geocache[key] = { at: Date.now(), r }; saveSoon();
  return r;
}
// On start-up, move each "approximate" pin to its exact UK postcode (100 at a time)
async function refineSeedPins() {
  if (NO_GEOCODE) return;
  const todo = listingsArr().filter((l) => l.geo === 'approx' && l.postcode && UK_POSTCODE.test(l.postcode));
  for (let i = 0; i < todo.length; i += 100) {
    const batch = todo.slice(i, i + 100);
    try {
      const j = await getJson('https://api.postcodes.io/postcodes', { method: 'POST', headers: { 'Content-Type': 'application/json', 'User-Agent': 'FindAQuiz/1.0' }, body: JSON.stringify({ postcodes: batch.map((l) => l.postcode) }) });
      for (const row of j.result || []) {
        const l = batch.find((x) => x.postcode.replace(/\s/g, '').toUpperCase() === String(row.query).replace(/\s/g, '').toUpperCase());
        if (l && row.result) { l.lat = row.result.latitude; l.lng = row.result.longitude; l.geo = 'postcode'; }
      }
      saveSoon();
    } catch (e) { console.error('postcode look-up failed (will try again next start):', e.message); return; }
  }
}

// ---- SumUp (same set-up as The Big Quiz Live) ------------------------------------------------------
async function sumup(method, urlPath, body) {
  const r = await fetch(SUMUP_BASE + urlPath, {
    method, headers: { Authorization: `Bearer ${SUMUP_API_KEY}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(15000),
  });
  const text = await r.text();
  let data; try { data = JSON.parse(text); } catch (e) { data = { raw: text }; }
  if (!r.ok) { const err = new Error(`SumUp ${method} ${urlPath} -> ${r.status}`); err.detail = data; throw err; }
  return data;
}
async function checkPaid(ref) {
  const p = db.pending[ref];
  if (!p) return 'UNKNOWN';
  if (p.doneAt) return 'PAID';
  if (!p.checkoutId || !SUMUP_API_KEY) return 'PENDING';
  const c = await sumup('GET', `/v0.1/checkouts/${encodeURIComponent(p.checkoutId)}`);
  if (c.status === 'PAID') { finish(ref); return 'PAID'; }
  return c.status === 'FAILED' ? 'FAILED' : 'PENDING';
}

// A listing has been paid for (or is free): put it live
function finish(ref) {
  const p = db.pending[ref];
  if (!p || p.doneAt) return p;
  const today = londonToday();
  if (p.kind === 'renew') {
    const l = db.listings[p.listingId];
    if (l) { l.expiresAt = coverage(l.schedule, p.fromYmd > today ? p.fromYmd : today, p.events).until || l.expiresAt; l.updatedAt = nowIso(); }
  } else {
    const token = newToken(24);
    let l = p.claimId && db.listings[p.claimId] && !db.listings[p.claimId].manageHash && !db.listings[p.claimId].verified ? db.listings[p.claimId] : null;
    const id = l ? l.id : 'q' + newToken(6).replace(/[-_]/g, 'x');
    const base = { createdAt: nowIso(), featured: false, photos: [] };
    l = Object.assign(l || base, p.data, {
      id, status: 'active', verified: true, source: p.admin ? 'admin' : 'owner', // listed by the venue/host themselves
      updatedAt: nowIso(), paidAt: p.amount ? nowIso() : null, expiresAt: p.admin && !p.amount ? null : coverage(p.data.schedule, today, p.events || 1).until,
      geo: 'pin', sourceUrl: '', lastChecked: londonToday(), manageHash: hash(token),
    });
    l.slug = l.slug || uniqueSlug(`${l.title} ${l.town || ''}`, id);
    db.listings[id] = l;
    attachPhotos(l, claimPhotos(p.photos, id));
    p.listingId = id; p.manageToken = token;
    sendManageEmail(l, token).catch((e) => console.error('email failed', e.message));
  }
  p.doneAt = nowIso();
  save();
  return p;
}

async function sendManageEmail(l, token) {
  if (!RESEND_API_KEY || !l.contact || !l.contact.email) return;
  const manage = `${SITE_URL}/manage/${token}`, view = `${SITE_URL}/quiz/${l.slug}`;
  const body = `<p>Hi ${esc(l.contact.name || 'there')},</p><p>Your quiz <b>${esc(l.title)}</b> is now live on Find a Quiz:<br><a href="${view}">${view}</a></p>
<p>Keep this private link to change your listing, add photos or renew it:<br><a href="${manage}">${manage}</a></p>
<p>${l.expiresAt ? `Your listing covers your quiz dates up to ${new Date(Date.parse(l.expiresAt) - 30 * 3600_000).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}. You can add more dates from your edit link.` : ''}</p><p>Thanks,<br>Find a Quiz</p>`;
  await fetch('https://api.resend.com/emails', {
    method: 'POST', headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: MAIL_FROM, to: [l.contact.email], subject: `Your quiz is live: ${l.title}`, html: body }), signal: AbortSignal.timeout(10000),
  });
}

// ---- Admin log-in (a cookie that lasts 30 days) -------------------------------------------------------
const sessions = new Map();
function adminOk(req) {
  const m = /(?:^|;\s*)faq_admin=([A-Za-z0-9_-]+)/.exec(req.headers.cookie || '');
  const s = m && sessions.get(m[1]);
  return !!(s && s > Date.now());
}
const safeEqual = (a, b) => crypto.timingSafeEqual(crypto.createHash('sha256').update(String(a)).digest(), crypto.createHash('sha256').update(String(b)).digest());

// ---- Pages built on the server (quiz pages, so search engines and link previews see them) ----------------
const SHELL_HEAD = (title, desc, extra = '') => `<!doctype html><html lang="en-GB"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}"><link rel="icon" href="/assets/icon.svg" type="image/svg+xml">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,600;12..96,800&family=DM+Sans:opsz,wght@9..40,400;9..40,600;9..40,700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/assets/style.css">${extra}</head><body>`;
function header() {
  const n = db.settings.notice ? `<div class="notice">${esc(db.settings.notice)}</div>` : '';
  return `${n}<header class="top"><a class="brand" href="/" aria-label="Find a Quiz home"><img src="/assets/logo.svg" alt="" width="40" height="40"><span>find<b>a</b>quiz</span></a>
<nav><a href="/">Find a quiz</a><a class="btn small" href="/list">List your quiz · ${esc(priceText())}</a></nav></header>`;
}
const footer = () => `<footer class="foot"><div><a class="brand" href="/"><img src="/assets/logo.svg" alt="" width="28" height="28"><span>find<b>a</b>quiz</span></a>
<p>Quiz nights near you, wherever you are.</p></div><nav><a href="/list">List your quiz</a><a href="/about">About</a><a href="/terms">Terms &amp; privacy</a></nav></footer>`;
const priceText = () => (db.settings.price > 0 ? `£${Number(db.settings.price) % 1 ? Number(db.settings.price).toFixed(2) : Number(db.settings.price)} a night` : 'free');

function quizPage(l) {
  const q = publicListing(l, true), live = isLive(l);
  const place = q.online ? 'Online quiz' : [q.venue, q.town].filter(Boolean).join(', ');
  const desc = `${q.title}: ${q.when}${place ? ' at ' + place : ''}.${q.feeText ? ' ' + q.feeText + '.' : ''} Find quiz nights near you on Find a Quiz.`;
  const og = `<meta property="og:title" content="${esc(q.title)}"><meta property="og:description" content="${esc(desc)}"><meta property="og:type" content="website">
<meta property="og:url" content="${SITE_URL}${q.url}">${q.photos[0] ? `<meta property="og:image" content="${SITE_URL}${q.photos[0]}">` : `<meta property="og:image" content="${SITE_URL}/assets/og.png">`}
<link rel="canonical" href="${SITE_URL}${q.url}">`;
  const ld = q.next ? {
    '@context': 'https://schema.org', '@type': 'Event', name: q.title, description: q.description || desc,
    startDate: `${q.next}T${q.schedule.time || '19:00'}`, eventStatus: 'https://schema.org/EventScheduled',
    eventAttendanceMode: q.online ? 'https://schema.org/OnlineEventAttendanceMode' : 'https://schema.org/OfflineEventAttendanceMode',
    location: q.online ? { '@type': 'VirtualLocation', url: q.onlineLink || `${SITE_URL}${q.url}` } : { '@type': 'Place', name: q.venue, address: { '@type': 'PostalAddress', streetAddress: q.address, addressLocality: q.town, postalCode: q.postcode, addressCountry: q.country } },
    image: q.photos.map((p) => SITE_URL + p), url: SITE_URL + q.url,
    ...(q.fee && !q.fee.free && q.fee.amount != null ? { offers: { '@type': 'Offer', price: q.fee.amount, priceCurrency: q.fee.currency || 'GBP' } } : q.fee && q.fee.free ? { isAccessibleForFree: true } : {}),
    ...(q.host ? { organizer: { '@type': 'Organization', name: q.host, url: q.website || undefined } } : {}),
  } : null;
  const chips = (keys, map) => keys.map((k) => `<span class="chip">${esc(map[k])}</span>`).join('');
  const facts = [
    ['When', esc(q.when) || 'Check with the venue'],
    q.feeText && ['Entry', esc(q.feeText)],
    q.teamMax && ['Teams', `Up to ${q.teamMax} per team`],
    q.ages && ['Who can play', esc(L.AGES[q.ages])],
    q.prizes && ['Prizes', esc(q.prizes)],
    q.host && ['Quiz host', esc(q.host)],
    q.formats.length && ['How it’s played', q.formats.map((k) => esc(L.FORMATS[k])).join(', ')],
  ].filter(Boolean).map(([k, v]) => `<div class="fact"><dt>${k}</dt><dd>${v}</dd></div>`).join('');
  const nextList = q.nextDates.length ? `<ul class="dates">${q.nextDates.map((d) => `<li>${esc(S.prettyDate(d, londonToday()))}${S.timeText(q.schedule.time) ? ' · ' + S.timeText(q.schedule.time) : ''}</li>`).join('')}</ul>` : '';
  const gallery = q.photos.length ? `<div class="gallery">${q.photos.map((p, i) => `<a href="${p}" target="_blank" rel="noopener"><img src="${p}" alt="${esc(q.title)} photo ${i + 1}" loading="${i ? 'lazy' : 'eager'}"></a>`).join('')}</div>`
    : `<div class="gallery none" aria-hidden="true"><div class="ph" data-day="${q.schedule && q.schedule.days ? S.SHORT[q.schedule.days[0]] : '?'}"></div></div>`;
  const book = q.booking ? `<div class="book">${q.booking.required ? '<b>Booking needed.</b> ' : ''}${q.booking.note ? esc(q.booking.note) + ' ' : ''}${q.booking.link ? `<a class="btn" href="${esc(q.booking.link)}" target="_blank" rel="noopener nofollow">Book a table</a>` : ''}${q.booking.phone ? ` <a class="btn ghost" href="tel:${esc(q.booking.phone.replace(/[^\d+]/g, ''))}">Call ${esc(q.booking.phone)}</a>` : ''}</div>` : '';
  const links = [q.website && `<a href="${esc(q.website)}" target="_blank" rel="noopener nofollow">Website</a>`, q.facebook && `<a href="${esc(q.facebook)}" target="_blank" rel="noopener nofollow">Facebook</a>`,
    q.phone && `<a href="tel:${esc(q.phone.replace(/[^\d+]/g, ''))}">${esc(q.phone)}</a>`, q.onlineLink && `<a href="${esc(q.onlineLink)}" target="_blank" rel="noopener nofollow">Join online</a>`].filter(Boolean).join(' · ');
  const mapUrl = q.online ? '' : `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(q.lat != null ? `${q.lat},${q.lng}` : place)}`;
  const unverified = !q.verified ? `<div class="unverified"><b>Found online.</b> We found this quiz on ${q.sourceUrl ? `<a href="${esc(q.sourceUrl)}" target="_blank" rel="noopener nofollow">${q.source === 'speedquizzing' ? 'SpeedQuizzing’s quiz finder' : 'a public listing'}</a>` : 'a public listing'}${q.lastChecked ? ` (checked ${esc(new Date(q.lastChecked).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }))})` : ''}. Details can change, so check with the venue before you go.
  <a href="/claim/${esc(q.id)}">Is this your quiz? Claim it</a> to update the details, add photos and get a ✓ Confirmed badge.</div>` : '';
  const ended = !live ? `<div class="unverified ended"><b>This listing has ended.</b> <a href="/">Find another quiz nearby</a>.</div>` : '';

  return SHELL_HEAD(`${q.title}${q.town ? ' · ' + q.town : ''} | Find a Quiz`, desc, og + (ld ? `<script type="application/ld+json">${JSON.stringify(ld).replace(/</g, '\\u003c')}</script>` : '') +
    '<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" integrity="sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY=" crossorigin="">') + header() + `
<main class="quiz">
  ${ended}${gallery}
  <div class="quiz-grid">
    <article>
      <p class="crumbs"><a href="/">Find a quiz</a>${q.town ? ` › <a href="/?q=${encodeURIComponent(q.town)}">${esc(q.town)}</a>` : ''}</p>
      <h1>${esc(q.title)} ${q.verified ? '<span class="badge ok" title="Confirmed by the venue or quiz host">✓ Confirmed</span>' : ''}</h1>
      <p class="where">${q.online ? 'Online quiz' : `<b>${esc(q.venue)}</b>${q.address ? ', ' + esc(q.address) : ''}${q.town ? ', ' + esc(q.town) : ''}${q.postcode ? ' ' + esc(q.postcode) : ''}${q.country && q.country !== 'GB' ? ', ' + esc(L.countryName(q.country)) : ''}`}</p>
      <p class="when-big">${esc(q.when)}</p>
      ${q.next ? `<p class="next">Next: <b>${esc(S.prettyDate(q.next, londonToday()))}</b></p>` : ''}
      ${unverified}
      <dl class="facts">${facts}</dl>
      ${q.types.length ? `<div class="chips">${chips(q.types, L.TYPES)}</div>` : ''}
      ${q.description ? `<div class="desc">${esc(q.description).replace(/\n/g, '<br>')}</div>` : ''}
      ${q.features.length ? `<h2>At the venue</h2><div class="chips">${chips(q.features, L.FEATURES)}</div>` : ''}
      ${book}
      ${links ? `<p class="links">${links}</p>` : ''}
    </article>
    <aside>
      ${!q.online && q.lat != null ? `<div id="map" class="mini-map" data-lat="${q.lat}" data-lng="${q.lng}" data-name="${esc(q.venue)}"></div><a class="btn ghost wide" href="${mapUrl}" target="_blank" rel="noopener">Get directions</a>` : ''}
      ${nextList ? `<h2>Coming up</h2>${nextList}` : ''}
      <details class="report"><summary>Something wrong with this listing?</summary>
        <form id="report" data-id="${esc(q.id)}">
          <label>What's wrong?<select name="reason"><option value="details">Details are wrong</option><option value="ended">This quiz has stopped</option><option value="inappropriate">Inappropriate content</option><option value="other">Something else</option></select></label>
          <label>Tell us more (optional)<textarea name="message" maxlength="600" rows="3"></textarea></label>
          <label>Your email (optional, if you'd like a reply)<input type="email" name="email" maxlength="120"></label>
          <button class="btn small" type="submit">Send</button><p class="msg" aria-live="polite"></p>
        </form></details>
    </aside>
  </div>
</main>${footer()}
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js" integrity="sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo=" crossorigin=""></script>
<script src="/assets/quiz.js"></script></body></html>`;
}

function donePage(ref) {
  const p = db.pending[ref];
  const head = SHELL_HEAD('Your quiz is live! | Find a Quiz', 'Your quiz listing is live.') + header();
  if (!p || !p.doneAt) return null;
  const l = db.listings[p.listingId];
  if (!l) return null;
  const view = `/quiz/${l.slug}`;
  if (p.kind === 'renew') return head + `<main class="narrow card-page"><h1>Renewed — thank you!</h1><p>Your listing for <b>${esc(l.title)}</b> now covers your quiz dates up to <b>${new Date(Date.parse(l.expiresAt) - 30 * 3600_000).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' })}</b>.</p><p><a class="btn" href="${view}">See your listing</a></p></main>${footer()}</body></html>`;
  const manage = `${SITE_URL}/manage/${p.manageToken}`;
  return head + `<main class="narrow card-page">
<div class="party" aria-hidden="true">🎉</div><h1>Your quiz is live!</h1>
<p><b>${esc(l.title)}</b> is now on Find a Quiz${l.expiresAt ? `, showing your quiz dates up to <b>${new Date(Date.parse(l.expiresAt) - 30 * 3600_000).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' })}</b>` : ''}.</p>
<p><a class="btn" href="${view}">See your listing</a></p>
<div class="keep"><h2>Save your edit link</h2><p>This private link lets you change the details, add photos or add more quiz dates. ${RESEND_API_KEY ? 'We’ve emailed it to you too, but keep it somewhere safe.' : 'Bookmark it or copy it somewhere safe: it’s the only way to edit your listing.'}</p>
<div class="copy"><input id="ml" readonly value="${esc(manage)}"><button class="btn small" type="button" onclick="var i=document.getElementById('ml');i.select();navigator.clipboard&&navigator.clipboard.writeText(i.value);this.textContent='Copied!'">Copy</button></div></div>
<p class="muted">Tip: share your listing page on social media so people can find your quiz.</p></main>${footer()}</body></html>`;
}

function sitemap() {
  const urls = [`${SITE_URL}/`, `${SITE_URL}/list`, `${SITE_URL}/about`].concat(listingsArr().filter((l) => isLive(l)).map((l) => `${SITE_URL}/quiz/${l.slug}`));
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.map((u) => `<url><loc>${esc(u)}</loc></url>`).join('')}</urlset>`;
}

// ---- Static files -------------------------------------------------------------------------------
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json', '.txt': 'text/plain; charset=utf-8' };
function sendStatic(res, file, cache = 'public, max-age=300') {
  const f = path.join(PUBLIC, file);
  if (!f.startsWith(PUBLIC + path.sep) || !fs.existsSync(f) || !fs.statSync(f).isFile()) return send(res, 404, 'Not found', 'text/plain; charset=utf-8');
  return send(res, 200, fs.readFileSync(f), TYPES[path.extname(f)] || 'application/octet-stream', { 'Cache-Control': cache });
}
// Pages get the site's settings (price, photo limits) put straight in, so they show the right thing first time
function pageWithSettings(file, extra = {}) {
  const page = fs.readFileSync(path.join(PUBLIC, file), 'utf8');
  const st = db.settings;
  const data = JSON.stringify(Object.assign({ price: st.price, priceText: priceText(), maxPhotos: st.maxPhotos, maxPhotoKB: st.maxPhotoKB, maxEvents: st.maxEvents, paymentsOn: st.paymentsOn, notice: st.notice, payReady: !!(SUMUP_API_KEY && SUMUP_MERCHANT_CODE) }, extra))
    .replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  return page.replace('</head>', `<script>window.FAQ=${data}</script>\n</head>`).replace('<!--HEADER-->', header()).replace('<!--FOOTER-->', footer());
}

// ---- The website ---------------------------------------------------------------------------------
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, SITE_URL);
    const p = url.pathname.replace(/\/+$/, '') || '/';
    const ip = clientIp(req);
    const GET = req.method === 'GET' || req.method === 'HEAD', POST = req.method === 'POST';

    // Plain pages
    if (GET && p === '/') return htmlRes(res, 200, pageWithSettings('index.html'));
    if (GET && p === '/list') return htmlRes(res, 200, pageWithSettings('list.html', { mode: 'new' }));
    if (GET && p.startsWith('/manage/')) return htmlRes(res, 200, pageWithSettings('list.html', { mode: 'manage', token: p.slice(8) }));
    if (GET && p.startsWith('/claim/')) {
      const l = db.listings[p.slice(7)];
      if (!l || l.manageHash || l.verified) return redirect(res, l ? `/quiz/${l.slug}` : '/');
      return htmlRes(res, 200, pageWithSettings('list.html', { mode: 'claim', claimId: l.id }));
    }
    if (GET && p === '/about') return htmlRes(res, 200, pageWithSettings('about.html'));
    if (GET && p === '/terms') return htmlRes(res, 200, pageWithSettings('terms.html'));
    if (GET && p === '/admin') return htmlRes(res, 200, pageWithSettings('admin.html', { adminOn: !!ADMIN_PASSWORD }));
    if (GET && p === '/robots.txt') return send(res, 200, `User-agent: *\nDisallow: /manage/\nDisallow: /admin\nDisallow: /api/\nSitemap: ${SITE_URL}/sitemap.xml\n`, 'text/plain; charset=utf-8');
    if (GET && p === '/sitemap.xml') return send(res, 200, sitemap(), 'application/xml; charset=utf-8', { 'Cache-Control': 'public, max-age=3600' });
    if (GET && p.startsWith('/assets/')) return sendStatic(res, p.slice(8));
    if (GET && (p === '/favicon.ico')) return sendStatic(res, 'icon.svg');
    if (GET && p === '/health') return json(res, 200, { ok: true });

    // A quiz's own page
    let m;
    if (GET && (m = p.match(/^\/quiz\/([a-z0-9-]{1,90})$/))) {
      const l = listingsArr().find((x) => x.slug === m[1]);
      if (!l || l.status === 'hidden' || l.status === 'deleted') return htmlRes(res, 404, SHELL_HEAD('Quiz not found | Find a Quiz', '') + header() + `<main class="narrow card-page"><h1>Quiz not found</h1><p>This listing may have been removed.</p><p><a class="btn" href="/">Find a quiz near you</a></p></main>${footer()}</body></html>`);
      return htmlRes(res, 200, quizPage(l));
    }

    // Uploaded photos
    if (GET && (m = p.match(/^\/photos\/([A-Za-z0-9_-]{8,40})\.(jpg|png|webp)$/))) {
      const ph = db.photos[m[1]];
      if (!ph || ph.ext !== m[2]) return send(res, 404, 'Not found', 'text/plain; charset=utf-8');
      const f = path.join(PHOTO_DIR, `${m[1]}.${m[2]}`);
      if (!fs.existsSync(f)) return send(res, 404, 'Not found', 'text/plain; charset=utf-8');
      return send(res, 200, fs.readFileSync(f), { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' }[m[2]], { 'Cache-Control': 'public, max-age=31536000, immutable', 'Content-Security-Policy': "default-src 'none'" });
    }

    // Done page after paying
    if (GET && p === '/done') {
      const ref = url.searchParams.get('ref') || '';
      if (own(db.pending, ref) && !db.pending[ref].doneAt) { try { await checkPaid(ref); } catch (e) { console.error('done: check failed', e.message); } }
      const page = own(db.pending, ref) ? donePage(ref) : null;
      if (page) return htmlRes(res, 200, page);
      return htmlRes(res, 200, SHELL_HEAD('Checking your payment | Find a Quiz', '', '<meta http-equiv="refresh" content="4">') + header() + `<main class="narrow card-page"><h1>Checking your payment…</h1><p>This page will refresh by itself. If you closed the payment box before paying, <a href="/list">start again</a>.</p></main>${footer()}</body></html>`);
    }

    // ---- API: searching ----
    if (GET && p === '/api/quizzes') {
      const lat = Number(url.searchParams.get('lat')), lng = Number(url.searchParams.get('lng'));
      const radius = Math.min(Math.max(Number(url.searchParams.get('km')) || 40, 1), 500);
      const today = londonToday();
      let out = listingsArr().filter((l) => isLive(l, today)).map((l) => publicListing(l));
      if (Number.isFinite(lat) && Number.isFinite(lng) && url.searchParams.get('lat') !== null) {
        out = out.map((q) => Object.assign(q, { km: q.lat != null ? Math.round(km(lat, lng, q.lat, q.lng) * 10) / 10 : null }))
          .filter((q) => q.online || (q.km != null && q.km <= radius))
          .sort((a, b) => (a.online - b.online) || (a.km - b.km));
      } else out.sort((a, b) => String(a.next || '9').localeCompare(String(b.next || '9')) || String(a.schedule.time || '99').localeCompare(String(b.schedule.time || '99')));
      return json(res, 200, { quizzes: out.slice(0, 600), total: out.length, today });
    }
    if (GET && (m = p.match(/^\/api\/quiz\/([A-Za-z0-9_-]{3,40})$/))) {
      const l = db.listings[m[1]];
      if (!l || !isLive(l)) return json(res, 404, { error: 'Not found' });
      return json(res, 200, { quiz: publicListing(l, true), claimable: !l.manageHash && !l.verified });
    }
    if (GET && p === '/api/geocode') {
      if (limited('geo:' + ip, 60, 60 * 60_000)) return json(res, 429, { error: 'Too many searches. Please wait a few minutes.' });
      const r = await geocode(url.searchParams.get('q') || '', (url.searchParams.get('country') || '').toUpperCase().slice(0, 2));
      return json(res, 200, { results: r });
    }
    if (POST && p === '/api/report') {
      if (limited('rep:' + ip, 10, 60 * 60_000)) return json(res, 429, { error: 'Too many reports. Please try later.' });
      const b = await readJson(req, 5000);
      const l = db.listings[String(b.id)];
      if (!l) return json(res, 404, { error: 'Listing not found.' });
      db.reports.push({ id: newToken(6), listingId: l.id, title: l.title, reason: ['details', 'ended', 'inappropriate', 'other'].includes(b.reason) ? b.reason : 'other', message: txt(b.message, 600), email: line(b.email, 120), at: nowIso(), resolved: false });
      db.reports = db.reports.slice(-500); saveSoon();
      return json(res, 200, { ok: true });
    }

    // ---- API: photos (already shrunk in the browser; we only check the type and size) ----
    if (POST && p === '/api/photos') {
      if (limited('ph:' + ip, 40, 60 * 60_000)) return json(res, 429, { error: 'Too many photos uploaded. Please wait an hour.' });
      const st = db.settings;
      if (storageBytes() > st.storageCapMB * 1024 * 1024) return json(res, 507, { error: 'Photo uploads are paused at the moment. You can still list your quiz without photos.' });
      let buf;
      if (Number(req.headers['content-length']) > st.maxPhotoKB * 1024 * 4) return send(res, 413, { error: `That photo is too big. Photos must be under ${st.maxPhotoKB} KB.` }, 'application/json; charset=utf-8', { Connection: 'close' });
      try { buf = await readRaw(req, st.maxPhotoKB * 1024); }
      catch (e) { return json(res, 413, { error: `That photo is too big. Photos must be under ${st.maxPhotoKB} KB.` }); }
      const kind = photoKind(buf);
      if (!kind) return json(res, 415, { error: 'Please upload a JPEG, PNG or WebP photo.' });
      const id = newToken(12);
      fs.writeFileSync(path.join(PHOTO_DIR, `${id}.${kind.ext}`), buf);
      db.photos[id] = { ext: kind.ext, size: buf.length, at: nowIso(), listing: null };
      saveSoon();
      return json(res, 200, { id, url: photoUrl(id) });
    }

    // ---- API: new listing (or claiming a "found online" one) ----
    if (POST && p === '/api/listings') {
      if (limited('new:' + ip, 20, 60 * 60_000)) return json(res, 429, { error: 'Too many tries. Please wait a while.' });
      const b = await readJson(req);
      const { data, errors } = cleanListing(b.listing || {});
      if (errors.length) return json(res, 400, { error: errors[0], errors });
      const isAdmin = adminOk(req) && b.asAdmin === true;
      let claimId = null;
      if (b.claimId) {
        const c = db.listings[String(b.claimId)];
        if (!c || c.manageHash || c.verified) return json(res, 400, { error: 'That listing has already been claimed.' });
        claimId = c.id;
      }
      const cov = coverage(data.schedule, londonToday(), data.schedule.repeat === 'once' ? 1 : wantEvents(b.events));
      if (!cov.events) return json(res, 400, { error: 'That quiz has no dates coming up. Check the date and the days.' });
      const price = isAdmin ? 0 : Math.round((Number(db.settings.price) || 0) * cov.events * 100) / 100;
      if (price > 0 && !db.settings.paymentsOn) return json(res, 503, { error: 'We’re not taking new listings for a moment. Please try again later.' });
      const ref = newToken(16);
      db.pending[ref] = { kind: 'new', data, photos: Array.isArray(b.photos) ? b.photos.slice(0, 12) : [], claimId, admin: isAdmin, events: cov.events, amount: price, createdAt: nowIso(), checkoutId: null };
      if (price <= 0) { finish(ref); return json(res, 200, { done: true, url: `/done?ref=${ref}` }); }
      save();
      return json(res, 200, { ref, amount: price.toFixed(2), events: cov.events, lastDate: cov.dates[cov.dates.length - 1] });
    }

    // ---- API: pay (SumUp card form on our own page) ----
    if (POST && p === '/api/checkout') {
      const b = await readJson(req, 2000);
      const ref = String(b.ref || '');
      const pend = own(db.pending, ref) ? db.pending[ref] : null;
      if (!pend) return json(res, 404, { error: 'Payment not found. Please start again.' });
      if (pend.doneAt) return json(res, 200, { paid: true, url: `/done?ref=${ref}` });
      if (!SUMUP_API_KEY || !SUMUP_MERCHANT_CODE) return json(res, 503, { error: 'Card payments aren’t set up yet. Please try again soon.' });
      if (!pend.checkoutId) {
        const what = `${pend.kind === 'renew' ? 'More dates' : 'Quiz listing'} (${pend.events || 1} date${pend.events > 1 ? 's' : ''})`;
        const c = await sumup('POST', '/v0.1/checkouts', {
          merchant_code: SUMUP_MERCHANT_CODE, amount: pend.amount, currency: 'GBP', checkout_reference: ref,
          description: `Find a Quiz · ${what}: ${(pend.data ? pend.data.title : (db.listings[pend.listingId] || {}).title || '').slice(0, 60)}`,
          return_url: `${SITE_URL}/api/sumup-webhook`,
        });
        if (!c.id) throw new Error('SumUp did not return a checkout');
        pend.checkoutId = c.id; save();
      }
      return json(res, 200, { checkoutId: pend.checkoutId, ref, amount: Number(pend.amount).toFixed(2) });
    }
    if (GET && p === '/api/pay-status') {
      const ref = url.searchParams.get('ref') || '';
      if (!own(db.pending, ref)) return json(res, 404, { status: 'UNKNOWN' });
      const st = await checkPaid(ref);
      return json(res, 200, { status: st, url: st === 'PAID' ? `/done?ref=${ref}` : null });
    }
    if (POST && p === '/api/sumup-webhook') {
      let b = {}; try { b = await readJson(req, 20_000); } catch (e) { /* ignore */ }
      const id = String(b.id || b.checkout_id || (b.payload && (b.payload.checkout_id || b.payload.id)) || '');
      const hit = id && Object.entries(db.pending).find(([, x]) => x.checkoutId === id);
      if (hit && !hit[1].doneAt) await checkPaid(hit[0]).catch((e) => console.error('webhook check', e.message)); // we only trust SumUp's own record
      return json(res, 200, { ok: true });
    }

    // ---- API: the lister's private edit link ----
    if ((m = p.match(/^\/api\/manage\/([A-Za-z0-9_-]{20,64})(\/renew)?$/))) {
      if (limited('man:' + ip, 120, 60 * 60_000)) return json(res, 429, { error: 'Too many tries. Please wait a while.' });
      const h = hash(m[1]);
      const l = listingsArr().find((x) => x.manageHash && safeEqual(x.manageHash, h));
      if (!l || l.status === 'deleted') return json(res, 404, { error: 'This edit link isn’t valid. Check you copied all of it.' });
      if (GET && !m[2]) return json(res, 200, { listing: Object.assign(publicListing(l, true), { contact: l.contact, photoIds: l.photos, expiresAt: l.expiresAt, datesLeft: datesLeft(l), status: l.status }) });
      if (POST && m[2]) {
        const b = await readJson(req, 2000);
        const today = londonToday();
        const fromYmd = l.expiresAt && l.expiresAt > nowIso() ? l.expiresAt.slice(0, 10) : today;
        const cov = coverage(l.schedule, fromYmd, wantEvents(b.events));
        if (!cov.events) return json(res, 400, { error: 'There are no more dates for this quiz. Change the date or days first, then save.' });
        const price = Math.round((Number(db.settings.price) || 0) * cov.events * 100) / 100;
        const ref = newToken(16);
        db.pending[ref] = { kind: 'renew', listingId: l.id, events: cov.events, fromYmd, amount: price, createdAt: nowIso(), checkoutId: null };
        if (price <= 0) { finish(ref); return json(res, 200, { done: true, url: `/done?ref=${ref}` }); }
        save();
        return json(res, 200, { ref, amount: price.toFixed(2), events: cov.events, lastDate: cov.dates[cov.dates.length - 1] });
      }
      if (req.method === 'PUT' && !m[2]) {
        const b = await readJson(req);
        const { data, errors } = cleanListing(b.listing || {});
        if (errors.length) return json(res, 400, { error: errors[0], errors });
        // Changing the quiz's days keeps the same number of paid dates still to come
        if (l.expiresAt && l.expiresAt > nowIso() && JSON.stringify(data.schedule) !== JSON.stringify(l.schedule)) {
          const left = datesLeft(l);
          if (left > 0) l.expiresAt = coverage(data.schedule, londonToday(), left).until || l.expiresAt;
        }
        Object.assign(l, data, { updatedAt: nowIso(), geo: 'pin' });
        attachPhotos(l, claimPhotos(b.photos, l.id));
        save();
        return json(res, 200, { ok: true, url: `/quiz/${l.slug}` });
      }
      if (req.method === 'DELETE' && !m[2]) {
        l.status = 'deleted'; attachPhotos(l, []); save();
        return json(res, 200, { ok: true });
      }
    }

    // ---- API: admin ----
    if (p.startsWith('/api/admin/')) {
      if (!ADMIN_PASSWORD) return json(res, 503, { error: 'Set ADMIN_PASSWORD in Railway Variables to use the admin page.' });
      if (POST && p === '/api/admin/login') {
        if (limited('login:' + ip, 8, 15 * 60_000)) return json(res, 429, { error: 'Too many tries. Wait 15 minutes.' });
        const b = await readJson(req, 2000);
        if (!safeEqual(b.password || '', ADMIN_PASSWORD)) return json(res, 401, { error: 'Wrong password.' });
        const t = newToken(24); sessions.set(t, Date.now() + 30 * 86400_000);
        return send(res, 200, { ok: true }, 'application/json; charset=utf-8', { 'Set-Cookie': `faq_admin=${t}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${30 * 86400}${SITE_URL.startsWith('https') ? '; Secure' : ''}` });
      }
      if (!adminOk(req)) return json(res, 401, { error: 'Please log in.' });
      if (POST && p === '/api/admin/logout') {
        const mm = /(?:^|;\s*)faq_admin=([A-Za-z0-9_-]+)/.exec(req.headers.cookie || ''); if (mm) sessions.delete(mm[1]);
        return send(res, 200, { ok: true }, 'application/json; charset=utf-8', { 'Set-Cookie': 'faq_admin=; Path=/; Max-Age=0' });
      }
      if (GET && p === '/api/admin/overview') {
        const all = listingsArr().filter((l) => l.status !== 'deleted'), today = londonToday();
        const paid = Object.values(db.pending).filter((x) => x.doneAt && x.amount > 0);
        return json(res, 200, {
          settings: db.settings, payReady: !!(SUMUP_API_KEY && SUMUP_MERCHANT_CODE), emailReady: !!RESEND_API_KEY,
          sqSync: db.sqSync || null, sqRunning,
          counts: { live: all.filter((l) => isLive(l, today)).length, owner: all.filter((l) => l.source === 'owner').length, found: all.filter((l) => l.source === 'seed' || l.source === 'speedquizzing').length, sq: all.filter((l) => l.source === 'speedquizzing' && l.status === 'active').length, hidden: all.filter((l) => l.status === 'hidden').length, reports: db.reports.filter((r) => !r.resolved).length },
          takings: Math.round(paid.reduce((n, x) => n + Number(x.amount), 0) * 100) / 100, sales: paid.length,
          storage: { usedMB: Math.round(storageBytes() / 1048576 * 10) / 10, photos: Object.keys(db.photos).length },
          listings: all.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).map((l) => ({ id: l.id, slug: l.slug, title: l.title, town: l.town, when: S.whenText(l.schedule), status: l.status, live: isLive(l, today), source: l.source, verified: l.verified, featured: l.featured, expiresAt: l.expiresAt, photos: (l.photos || []).length, email: l.contact ? l.contact.email : '' })),
          reports: db.reports.slice().reverse(),
        });
      }
      if (POST && p === '/api/admin/settings') {
        const b = await readJson(req, 5000), st = db.settings, num = (v, lo, hi, d) => { const n = Number(v); return Number.isFinite(n) ? Math.min(Math.max(n, lo), hi) : d; };
        st.price = Math.round(num(b.price, 0, 500, st.price) * 100) / 100;
        st.maxEvents = Math.round(num(b.maxEvents, 1, 200, st.maxEvents));
        st.maxPhotos = Math.round(num(b.maxPhotos, 0, 10, st.maxPhotos));
        st.maxPhotoKB = Math.round(num(b.maxPhotoKB, 50, 2000, st.maxPhotoKB));
        st.storageCapMB = Math.round(num(b.storageCapMB, 10, 50000, st.storageCapMB));
        st.paymentsOn = b.paymentsOn !== false;
        st.notice = line(b.notice, 200);
        save();
        return json(res, 200, { ok: true, settings: st });
      }
      if (POST && (m = p.match(/^\/api\/admin\/listing\/([A-Za-z0-9_-]{3,40})$/))) {
        const l = db.listings[m[1]]; if (!l) return json(res, 404, { error: 'Not found' });
        const b = await readJson(req, 2000);
        const a = b.action;
        if (a === 'hide') l.status = 'hidden';
        else if (a === 'show') l.status = 'active';
        else if (a === 'verify') l.verified = true;
        else if (a === 'unverify') l.verified = false;
        else if (a === 'feature') l.featured = true;
        else if (a === 'unfeature') l.featured = false;
        else if (a === 'extend') { const from = l.expiresAt && l.expiresAt > nowIso() ? l.expiresAt.slice(0, 10) : londonToday(); l.expiresAt = coverage(l.schedule, from, 13).until || l.expiresAt; } // 13 more dates, free
        else if (a === 'delete') { l.status = 'deleted'; attachPhotos(l, []); }
        else if (a === 'editlink') { const t = newToken(24); l.manageHash = hash(t); save(); return json(res, 200, { ok: true, url: `${SITE_URL}/manage/${t}`, note: 'Any edit link given out before for this listing no longer works.' }); }
        else return json(res, 400, { error: 'Unknown action' });
        l.updatedAt = nowIso(); save();
        return json(res, 200, { ok: true });
      }
      if (POST && p === '/api/admin/sync-sq') { runSqSync('admin').catch(() => {}); return json(res, 200, { started: true }); }
      if (POST && (m = p.match(/^\/api\/admin\/report\/([A-Za-z0-9_-]{3,20})$/))) {
        const r = db.reports.find((x) => x.id === m[1]); if (r) { r.resolved = true; save(); }
        return json(res, 200, { ok: true });
      }
    }

    return send(res, 404, 'Not found', 'text/plain; charset=utf-8');
  } catch (e) {
    if (e.code === 'TOO_LARGE') return json(res, 413, { error: 'That was too big to send.' });
    if (e.code === 'BAD_JSON') return json(res, 400, { error: 'Something went wrong sending the form. Please try again.' });
    console.error(e.message, e.detail ? JSON.stringify(e.detail) : '');
    if (!res.headersSent) return json(res, 500, { error: 'Something went wrong. Please try again.' });
  }
});

// ---- SpeedQuizzing quiz nights in the USA (see lib/speedquizzing.js) ---------------------------------
function sqUpsert(data, sqId) {
  const id = 'sq' + sqId, ex = db.listings[id];
  if (ex && (ex.manageHash || ex.source !== 'speedquizzing' || ex.status === 'deleted')) { ex.sqSeen = nowIso(); return 'skipped'; } // claimed or removed: leave alone
  const l = ex || { id, createdAt: nowIso(), status: 'active', source: 'speedquizzing', verified: false, featured: false, paidAt: null, expiresAt: null,
    online: false, onlineLink: '', prizeTags: [], features: [], booking: null, website: '', facebook: '', phone: '', photos: [], contact: null, manageHash: null };
  Object.assign(l, data, { updatedAt: nowIso(), sqId: String(sqId), sqSeen: nowIso(), geo: 'sq', lastChecked: londonToday() });
  if (l.status === 'hidden' && l.sqHidden) { l.status = 'active'; l.sqHidden = false; }
  if (!l.slug) l.slug = uniqueSlug(`${data.title} ${data.town} ${data.region}`, id);
  db.listings[id] = l;
  return ex ? 'updated' : 'added';
}
// Quizzes that haven't been on SpeedQuizzing's finder for 45 days are taken down (unless a host has claimed them)
function sqMarkUnseen(seen) {
  let n = 0;
  for (const l of listingsArr()) {
    if (l.source !== 'speedquizzing' || l.manageHash || l.status !== 'active' || seen.has(l.sqId)) continue;
    if (Date.now() - Date.parse(l.sqSeen || 0) > 45 * 86400_000) { l.status = 'hidden'; l.sqHidden = true; n++; }
  }
  return n;
}
let sqRunning = false;
async function runSqSync(why) {
  if (sqRunning) return;
  sqRunning = true;
  try { const r = await sq.syncUSA({ upsert: sqUpsert, markUnseen: sqMarkUnseen }); db.sqSync = Object.assign({ at: nowIso(), why }, r); console.log('SpeedQuizzing USA import:', JSON.stringify(db.sqSync)); }
  catch (e) { db.sqSync = { at: nowIso(), why, error: e.message }; console.error('SpeedQuizzing USA import failed:', e.message); }
  finally { sqRunning = false; save(); }
}
const SQ_ON = process.env.SQ_SYNC !== '0' && !NO_GEOCODE;
function sqDue() { return SQ_ON && (!db.sqSync || Date.now() - Date.parse(db.sqSync.at) > 6 * 86400_000); }

// ---- Housekeeping every few minutes ---------------------------------------------------------------
async function sweep() {
  const now = Date.now();
  // Payments where the payer closed the page: ask SumUp (for up to 2 hours)
  for (const [ref, x] of Object.entries(db.pending)) {
    if (x.doneAt || !x.checkoutId) continue;
    if (now - Date.parse(x.createdAt) < 2 * 3600_000) await checkPaid(ref).catch((e) => console.error('sweep', e.message));
  }
  // Forget unpaid attempts after a week, and finished ones' edit links after 30 days
  for (const [ref, x] of Object.entries(db.pending)) {
    const age = now - Date.parse(x.createdAt);
    if (!x.doneAt && age > 7 * 86400_000) delete db.pending[ref];
    else if (x.doneAt && x.manageToken && age > 30 * 86400_000) { delete x.manageToken; delete x.data; }
  }
  // Photos uploaded but never used in a listing (after a day)
  for (const [id, ph] of Object.entries(db.photos)) if (!ph.listing && now - Date.parse(ph.at) > 86400_000) deletePhoto(id);
  saveSoon();
}

if (require.main === module) {
  server.requestTimeout = 120_000;
  server.listen(PORT, () => console.log(`Find a Quiz listening on ${SITE_URL}`));
  setInterval(() => { sweep().catch((e) => console.error('sweep', e.message)); }, 2 * 60_000).unref();
  setTimeout(() => { refineSeedPins().catch((e) => console.error('pins', e.message)); }, 2000).unref();
  setTimeout(() => { if (sqDue()) runSqSync('start-up'); }, 20_000).unref();
  setInterval(() => { if (sqDue()) runSqSync('weekly'); }, 6 * 3600_000).unref();
}
module.exports = { server, db, cleanListing, finish, isLive, sqUpsert, sqMarkUnseen, runSqSync };
