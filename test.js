'use strict';
// Quick end-to-end check: node test.js  (uses a pretend SumUp, a temporary data folder, and no internet)
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'faq-'));
let checkouts = {};
const mock = http.createServer((req, res) => {
  let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => {
    res.setHeader('Content-Type', 'application/json');
    if (req.method === 'POST' && req.url === '/v0.1/checkouts') { const j = JSON.parse(b); const id = 'chk_' + Object.keys(checkouts).length; checkouts[id] = { id, status: 'PENDING', amount: j.amount, description: j.description }; return res.end(JSON.stringify(checkouts[id])); }
    const m = req.url.match(/^\/v0\.1\/checkouts\/(.+)$/);
    if (req.method === 'GET' && m && checkouts[m[1]]) return res.end(JSON.stringify(checkouts[m[1]]));
    res.statusCode = 404; res.end('{}');
  });
});

(async () => {
  await new Promise((ok) => mock.listen(0, ok));
  Object.assign(process.env, { DATA_DIR: tmp, SUMUP_API_KEY: 'test', SUMUP_MERCHANT_CODE: 'MTEST', SUMUP_BASE: `http://127.0.0.1:${mock.address().port}`, ADMIN_PASSWORD: 'secret-pass', NO_GEOCODE: '1' });
  // SpeedQuizzing's site is replaced by saved copies of its pages
  const realFetch = global.fetch;
  global.fetch = async (url, opts) => {
    const u = String(url);
    if (u.startsWith('https://www.speedquizzing.com/')) {
      const f = u.endsWith('/find/') ? 'sq-find.html' : `sq-event-${(u.match(/events\/(\d+)/) || [])[1]}.html`;
      const file = path.join(__dirname, 'test-fixtures', f);
      return new Response(fs.existsSync(file) ? fs.readFileSync(file) : 'not found', { status: fs.existsSync(file) ? 200 : 404 });
    }
    return realFetch(url, opts);
  };
  const { server, db, runSqSync } = require('./server');
  const S = require('./public/schedule');
  await new Promise((ok) => server.listen(0, ok));
  const base = `http://127.0.0.1:${server.address().port}`;
  let cookie = '';
  const call = async (method, p, body, raw) => {
    const r = await fetch(base + p, { method, headers: Object.assign(raw ? { 'Content-Type': 'image/jpeg' } : { 'Content-Type': 'application/json' }, cookie ? { Cookie: cookie } : {}), body: raw || (body ? JSON.stringify(body) : undefined), redirect: 'manual' });
    const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch (e) { /* html */ }
    return { status: r.status, j, t, headers: r.headers };
  };

  // Seeded quizzes are there, and searching near Birmingham finds the city-centre ones first
  let r = await call('GET', '/api/quizzes');
  assert.ok(r.j.quizzes.length >= 80, 'seed quizzes loaded: ' + r.j.quizzes.length);
  r = await call('GET', '/api/quizzes?lat=52.4797&lng=-1.9026&km=8');
  assert.ok(r.j.quizzes.length > 10 && r.j.quizzes[0].km < 1, 'nearby search sorted by distance');
  assert.ok(!r.j.quizzes.some((q) => q.contact), 'no private details in search');
  console.log('✓ search:', r.j.quizzes.length, 'within 8 km of Birmingham; nearest', r.j.quizzes[0].title);

  // A quiz page renders with structured data
  const seed = Object.values(db.listings).find((l) => l.source === 'seed');
  r = await call('GET', `/quiz/${seed.slug}`);
  assert.strictEqual(r.status, 200); assert.ok(r.t.includes('application/ld+json') && r.t.includes('Claim it'));
  const own = Object.values(db.listings).find((l) => l.verified);
  r = await call('GET', `/quiz/${own.slug}`); assert.ok(r.t.includes('✓ Confirmed') && !r.t.includes('Claim it'));
  r = await call('GET', `/claim/${own.id}`); assert.strictEqual(r.status, 302, 'confirmed quizzes cannot be claimed');
  console.log('✓ quiz pages, confirmed badge, claim link only on found-online ones');

  // Photos: right type and size only
  const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(2000, 1)]);
  r = await call('POST', '/api/photos', null, jpeg); assert.strictEqual(r.status, 200); const photoId = r.j.id;
  r = await call('POST', '/api/photos', null, Buffer.from('<svg>nope</svg>')); assert.strictEqual(r.status, 415);
  r = await call('POST', '/api/photos', null, Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(500 * 1024)])); assert.strictEqual(r.status, 413);
  console.log('✓ photos: JPEG accepted, wrong type and over-size rejected');

  // A new paid listing: form -> SumUp checkout -> paid -> live, with an edit link
  const listing = {
    title: 'Test Quiz Night', venue: 'The Test Arms', address: '1 High St', town: 'Dudley', postcode: 'DY1 1AA', country: 'GB', lat: 52.51, lng: -2.08,
    schedule: { repeat: 'monthly', days: [2], weeks: [1, -1], time: '20:00' }, fee: { free: false, amount: '2.5', currency: 'GBP', per: 'person' },
    teamMax: 6, ages: '18', types: ['general', 'music', 'nonsense'], description: '<script>alert(1)</script> Great fun', contact: { name: 'Chris', email: 'chris@example.com' },
  };
  r = await call('POST', '/api/listings', { listing: Object.assign({}, listing, { title: '' }) }); assert.strictEqual(r.status, 400);
  r = await call('POST', '/api/listings', { listing, photos: [photoId], events: 4 }); assert.strictEqual(r.status, 200); const ref = r.j.ref;
  assert.strictEqual(r.j.amount, '8.00', '4 dates x £2'); assert.strictEqual(r.j.events, 4);
  r = await call('POST', '/api/checkout', { ref }); assert.ok(r.j.checkoutId); const chk = r.j.checkoutId;
  assert.ok(checkouts[chk].description.includes('Test Quiz Night') && checkouts[chk].description.includes('4 dates') && checkouts[chk].amount === 8);
  r = await call('GET', `/api/pay-status?ref=${ref}`); assert.strictEqual(r.j.status, 'PENDING');
  checkouts[chk].status = 'PAID';
  r = await call('GET', `/api/pay-status?ref=${ref}`); assert.strictEqual(r.j.status, 'PAID');
  r = await call('GET', `/done?ref=${ref}`); const token = (r.t.match(/\/manage\/([A-Za-z0-9_-]+)/) || [])[1]; assert.ok(token, 'edit link shown');
  const mine = Object.values(db.listings).find((l) => l.title === 'Test Quiz Night');
  assert.ok(mine.verified && mine.expiresAt && mine.photos[0] === photoId && mine.types.join() === 'general,music');
  const four = S.nextDates(listing.schedule, new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London' }).format(new Date()), 4);
  assert.strictEqual(mine.expiresAt.slice(0, 10), S.ymd(new Date(Date.parse(four[3]) + 86400000)), 'shown until the morning after the 4th date');
  r = await call('GET', `/quiz/${mine.slug}`); assert.ok(r.t.includes('1st &amp; last Tuesday of the month') && !r.t.includes('<script>alert'));
  assert.ok(!r.t.includes('chris@example.com'), 'email not shown publicly');
  console.log('✓ £2 per quiz date: 4 dates = £8, listing shown up to the 4th date; edit link given; text made safe');

  // Editing with the edit link, and renewing
  r = await call('GET', `/api/manage/${token}`); assert.strictEqual(r.j.listing.contact.email, 'chris@example.com'); assert.strictEqual(r.j.listing.datesLeft, 4);
  r = await call('PUT', `/api/manage/${token}`, { listing: Object.assign({}, listing, { title: 'Test Quiz Night (new name)' }), photos: [] });
  assert.ok(r.j.ok && mine.title.includes('new name') && !mine.photos.length && !db.photos[photoId], 'edit saved and removed photo deleted');
  // Switching to weekly keeps the same 4 paid dates still to come
  r = await call('PUT', `/api/manage/${token}`, { listing: Object.assign({}, listing, { schedule: { repeat: 'weekly', days: [3], time: '20:00' } }), photos: [] });
  r = await call('GET', `/api/manage/${token}`); assert.strictEqual(r.j.listing.datesLeft, 4, 'still 4 paid dates after changing days');
  r = await call('GET', '/api/manage/not-a-real-token-at-all-000'); assert.strictEqual(r.status, 404);
  const before = mine.expiresAt;
  r = await call('POST', `/api/manage/${token}/renew`, { events: 2 }); const rref = r.j.ref; assert.strictEqual(r.j.amount, '4.00');
  r = await call('POST', '/api/checkout', { ref: rref }); checkouts[r.j.checkoutId].status = 'PAID';
  r = await call('GET', `/api/pay-status?ref=${rref}`); assert.strictEqual(r.j.status, 'PAID'); assert.ok(mine.expiresAt > before);
  r = await call('GET', `/api/manage/${token}`); assert.strictEqual(r.j.listing.datesLeft, 6, '4 + 2 more dates');
  console.log('✓ edit link works; changing days keeps the paid dates; adding 2 more dates = £4');

  // Claiming a "found online" quiz keeps its page address
  r = await call('POST', '/api/listings', { listing: Object.assign({}, listing, { title: seed.title }), claimId: seed.id }); const cref = r.j.ref;
  r = await call('POST', '/api/checkout', { ref: cref }); checkouts[r.j.checkoutId].status = 'PAID';
  await call('GET', `/api/pay-status?ref=${cref}`);
  assert.ok(db.listings[seed.id].verified && db.listings[seed.id].manageHash && db.listings[seed.id].source === 'owner');
  r = await call('POST', '/api/listings', { listing, claimId: seed.id }); assert.strictEqual(r.status, 400, 'cannot claim twice');
  console.log('✓ claiming a found-online quiz');

  // Admin: log in, change price to free, publish free, hide a listing
  r = await call('POST', '/api/admin/login', { password: 'wrong' }); assert.strictEqual(r.status, 401);
  r = await call('POST', '/api/admin/login', { password: 'secret-pass' }); cookie = r.headers.get('set-cookie').split(';')[0];
  r = await call('GET', '/api/admin/overview'); assert.ok(r.j.takings === 14 && r.j.sales === 3, 'takings ' + r.j.takings);
  r = await call('POST', '/api/admin/settings', Object.assign({}, r.j.settings, { price: 0 })); assert.strictEqual(r.j.settings.price, 0);
  r = await call('POST', '/api/listings', { listing: Object.assign({}, listing, { title: 'Free one', schedule: { repeat: 'once', date: '2030-01-05', time: '19:30' } }) });
  assert.ok(r.j.done);
  r = await call('POST', `/api/admin/listing/${mine.id}`, { action: 'hide' });
  r = await call('GET', `/quiz/${mine.slug}`); assert.strictEqual(r.status, 404);
  r = await call('GET', '/sitemap.xml'); assert.ok(r.t.includes('/quiz/'));
  console.log('✓ admin: log-in, takings, free listings, hide');

  // SpeedQuizzing USA import: US events added, the London one left out, claimed ones left alone
  await runSqSync('test');
  const a = db.listings.sq611, b = db.listings.sq3069;
  assert.ok(a && b && !db.listings.sq10410, 'US events imported, UK one skipped');
  assert.ok(a.country === 'US' && a.region === 'MA' && a.postcode === '01085' && a.schedule.days[0] === 4 && a.schedule.time === '20:00' && a.fee.free && a.ages === '21' && a.teamMax === 7 && a.host === 'Bobby Roast Beef');
  assert.ok(b.region === 'FL' && b.schedule.days[0] === 2 && b.prizes === 'gift cards for top teams');
  assert.ok(db.sqSync.found === 2 && db.sqSync.added === 2);
  r = await call('GET', '/api/quizzes?lat=42.12&lng=-72.75&km=20'); assert.ok(r.j.quizzes.some((q) => q.id === 'sq611'), 'found near Westfield, MA');
  r = await call('GET', `/quiz/${a.slug}`); assert.ok(r.t.includes('SpeedQuizzing’s quiz finder') && r.t.includes('Claim it'));
  a.title = 'Changed by hand'; await runSqSync('test'); assert.strictEqual(db.listings.sq611.title, "Thursday @ 7B's Bar & Grill", 'unclaimed ones are refreshed');
  console.log('✓ SpeedQuizzing USA import: 2 US events added (MA, FL), UK event left out, details read correctly');

  console.log('\nAll good.');
  server.close(); mock.close(); fs.rmSync(tmp, { recursive: true, force: true });
  process.exit(0);
})().catch((e) => { console.error('FAILED:', e); process.exit(1); });
