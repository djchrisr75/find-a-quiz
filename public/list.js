/* Find a Quiz: list / edit / claim a quiz */
(function () {
  var S = window.FAQSchedule, L = window.FAQLabels, CFG = window.FAQ || {};
  var $ = function (id) { return document.getElementById(id); };
  var form = $('lf'), F = form.elements;
  var mode = CFG.mode || 'new';               // new | manage | claim
  var asAdmin = /[?&]admin=1\b/.test(location.search);
  var photos = [];                            // [{ id, url }] in order
  var uploading = 0;
  var DRAFT = 'faq-draft-v1';

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function checks(boxId, name, map) {
    $(boxId).innerHTML = Object.keys(map).map(function (k) { return '<label><input type="checkbox" name="' + name + '" value="' + esc(k) + '"><span>' + esc(map[k]) + '</span></label>'; }).join('');
  }
  function checked(name) { return Array.prototype.filter.call(form.querySelectorAll('input[name="' + name + '"]'), function (i) { return i.checked; }).map(function (i) { return i.value; }); }
  function setChecked(name, vals) { vals = (vals || []).map(String); form.querySelectorAll('input[name="' + name + '"]').forEach(function (i) { i.checked = vals.indexOf(i.value) >= 0; }); }
  function radio(name) { var r = form.querySelector('input[name="' + name + '"]:checked'); return r ? r.value : ''; }
  function setRadio(name, v) { var r = form.querySelector('input[name="' + name + '"][value="' + v + '"]'); if (r) r.checked = true; }

  // ---- Build the option lists ----
  checks('types', 'types', L.TYPES);
  checks('formats', 'formats', L.FORMATS);
  checks('features', 'features', L.FEATURES);
  checks('prizeTags', 'prizeTags', L.PRIZES);
  var dayMap = { 1: 'Mon', 2: 'Tue', 3: 'Wed', 4: 'Thu', 5: 'Fri', 6: 'Sat', 0: 'Sun' };
  $('days').innerHTML = [1, 2, 3, 4, 5, 6, 0].map(function (d) { return '<label><input type="checkbox" name="days" value="' + d + '"><span>' + dayMap[d] + '</span></label>'; }).join('');
  $('weeks').innerHTML = [[1, '1st'], [2, '2nd'], [3, '3rd'], [4, '4th'], [-1, 'Last']].map(function (w) { return '<label><input type="checkbox" name="weeks" value="' + w[0] + '"><span>' + w[1] + '</span></label>'; }).join('');
  Object.keys(L.AGES).forEach(function (k) { var o = document.createElement('option'); o.value = k; o.textContent = L.AGES[k]; $('ages').appendChild(o); });
  L.CURRENCIES.forEach(function (c) { var o = document.createElement('option'); o.value = c; o.textContent = c; $('currency').appendChild(o); });
  var countries = L.COUNTRIES.map(function (c) { return [c, L.countryName(c)]; });
  var top = countries.slice(0, 1), rest = countries.slice(1).sort(function (a, b) { return a[1].localeCompare(b[1]); });
  top.concat(rest).forEach(function (c) { var o = document.createElement('option'); o.value = c[0]; o.textContent = c[1]; $('country').appendChild(o); });

  // ---- Words at the top ----
  var priceTxt = CFG.price > 0 ? '£' + Number(CFG.price).toFixed(2) : 'free';
  function money(n) { return '£' + (n % 1 ? n.toFixed(2) : String(n)); }
  var EVENT_CHOICES = [1, 2, 4, 8, 13, 26, 52].filter(function (n) { return n <= (CFG.maxEvents || 52); });
  // "4 dates × £2 = £8 · up to Tue 22 Dec"
  function quote(sched, n, from) {
    var t = S.ymd(S.todayLocal()); from = from && from > t ? from : t;
    var ds = sched && (sched.days && sched.days.length || sched.date) ? S.nextDates(sched, from, sched.repeat === 'once' ? 1 : n) : [];
    return { n: ds.length, last: ds[ds.length - 1], amount: Math.round(ds.length * (CFG.price || 0) * 100) / 100 };
  }
  function fillEvents(sel) {
    sel.innerHTML = EVENT_CHOICES.map(function (n) { return '<option value="' + n + '"' + (n === 8 ? ' selected' : '') + '>' + n + (n === 1 ? ' quiz date' : ' quiz dates') + '</option>'; }).join('');
  }
  fillEvents($('events'));
  if (mode === 'new') {
    $('intro').innerHTML = 'Fill this in and your quiz goes live straight away' + (CFG.price > 0 ? '. It costs <b>' + money(CFG.price) + ' per quiz date</b>: pay for as many upcoming dates as you like, and add more whenever you want.' : '. Listing is free at the moment.') + ' You’ll get a private link to edit it whenever you like.';
  } else if (mode === 'claim') {
    $('h1').textContent = 'Claim this quiz';
    $('intro').innerHTML = 'We found this quiz online. Check the details, fix anything that’s wrong and add photos.' + (CFG.price > 0 ? ' Claiming costs <b>' + money(CFG.price) + ' per quiz date</b> you’d like it shown for, and' : ' Once claimed,') + ' your listing gets a ✓ Confirmed badge and you can edit it any time.';
  } else {
    $('h1').textContent = 'Edit your quiz';
    $('intro').textContent = 'Change anything you like and press Save. Your changes show on the site straight away.';
    $('termsBox').hidden = true; $('datesSec').hidden = true;
  }
  if (asAdmin) $('datesSec').hidden = true;
  $('perDate').textContent = CFG.price > 0 ? 'Each quiz night costs ' + money(CFG.price) + ' to list. A weekly quiz shown for 8 weeks is 8 dates, a monthly one shown for 4 months is 4 dates. Your listing comes down after the last date you’ve paid for, and you can add more dates any time from your edit link.' : 'Listing is free at the moment.';
  function updateTotal() {
    var s = schedule(), once = s.repeat === 'once', q = quote(s, Number($('events').value));
    $('eventsBox').hidden = once;
    $('total').textContent = !q.n ? 'Choose the day(s) and time above to see the price.' :
      (once ? '1 quiz date' : q.n + (q.n === 1 ? ' date' : ' dates')) + (CFG.price > 0 ? ' × ' + money(CFG.price) + ' = ' + money(q.amount) : '') + ' · shown up to ' + S.prettyDate(q.last, S.ymd(S.todayLocal())) + (q.last ? ' ' + S.parse(q.last).getUTCFullYear() : '');
    $('go').textContent = goLabel();
  }
  $('events').addEventListener('change', updateTotal);
  if (asAdmin) $('intro').innerHTML += ' <b>(Admin: this will be published free.)</b>';
  $('photoHint').textContent = CFG.maxPhotos > 0 ? 'Add up to ' + CFG.maxPhotos + ' photos of your venue or quiz night. They’re shrunk on your device before uploading, so big photos are fine. JPEG, PNG or WebP.' : 'Photos are switched off at the moment.';

  function goLabel() {
    if (mode === 'manage') return 'Save changes';
    if (asAdmin) return 'Publish (admin, free)';
    var q = quote(schedule(), Number($('events').value));
    return CFG.price > 0 ? 'Continue to payment' + (q.n ? ' · ' + money(q.amount) : '') : 'Publish my quiz';
  }

  // ---- When ----
  function updateWhen() {
    var r = radio('repeat');
    $('weeksBox').hidden = r !== 'monthly';
    $('anchorBox').hidden = r !== 'fortnightly';
    $('dateBox').hidden = r !== 'once';
    $('daysBox').hidden = r === 'once';
    $('daysHint').textContent = r === 'monthly' ? 'e.g. 1st Tuesday: pick “1st” above and “Tue” here' : 'Pick more than one if it runs on several nights';
    var s = schedule(), t = S.ymd(S.todayLocal());
    var nx = s ? S.nextDates(s, t, 3) : [];
    $('whenPreview').textContent = s && (s.days && s.days.length || s.date) ? 'Shows as: ' + S.whenText(s) + (nx.length ? '. Next: ' + nx.map(function (d) { return S.prettyDate(d, t); }).join(', ') : '') : '';
  }
  function schedule() {
    var r = radio('repeat');
    var s = { repeat: r, time: F.time.value, endTime: F.endTime.value || undefined };
    if (r === 'once') s.date = F.date.value;
    else { s.days = checked('days').map(Number); if (r === 'monthly') s.weeks = checked('weeks').map(Number); if (r === 'fortnightly') s.anchor = F.anchor.value; }
    return s;
  }
  form.addEventListener('change', function (e) { if (/^(repeat|days|weeks|time|anchor|date)$/.test(e.target.name)) { updateWhen(); updateTotal(); } });
  // A fortnightly quiz's anchor date should be on one of its days
  F.anchor.addEventListener('change', function () { var d = S.parse(F.anchor.value); if (d && !checked('days').length) setChecked('days', [d.getUTCDay()]); updateWhen(); });

  // ---- Where ----
  function updateOnline() { var on = F.online.checked; $('venueBits').hidden = on; $('onlineBox').hidden = !on; }
  F.online.addEventListener('change', updateOnline);
  var pmap = null, pin = null, latlng = null;
  function showPin(lat, lng, zoom) {
    latlng = { lat: +lat, lng: +lng };
    if (!window.L) { $('mapMsg').textContent = 'Found it (' + latlng.lat.toFixed(4) + ', ' + latlng.lng.toFixed(4) + '). The map can’t load right now, but the location is saved.'; return; }
    $('pickMap').hidden = false;
    if (!pmap) {
      pmap = window.L.map('pickMap', { scrollWheelZoom: false });
      window.L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; OpenStreetMap' }).addTo(pmap);
      pmap.on('click', function (e) { pin.setLatLng(e.latlng); latlng = { lat: e.latlng.lat, lng: e.latlng.lng }; saveDraft(); });
    }
    if (!pin) {
      pin = window.L.marker([lat, lng], { draggable: true, autoPan: true }).addTo(pmap);
      pin.on('dragend', function () { var p = pin.getLatLng(); latlng = { lat: p.lat, lng: p.lng }; saveDraft(); });
    } else pin.setLatLng([lat, lng]);
    pmap.setView([lat, lng], zoom || 16);
    setTimeout(function () { pmap.invalidateSize(); }, 50);
  }
  $('findMap').addEventListener('click', function () {
    var parts = [F.venue.value, F.address.value, F.town.value, F.postcode.value].map(function (s) { return s.trim(); }).filter(Boolean);
    if (!parts.length) { $('mapMsg').textContent = 'Fill in the address first.'; return; }
    $('mapMsg').textContent = 'Looking…';
    var tries = [parts.join(', '), [F.address.value, F.town.value, F.postcode.value].filter(Boolean).join(', '), F.postcode.value, F.town.value].filter(function (q, i, a) { return q && q.trim() && a.indexOf(q) === i; });
    (function next(i) {
      if (i >= tries.length) { $('mapMsg').textContent = 'We couldn’t find that address. Search for the town, then drag the pin to the venue.'; return; }
      fetch('/api/geocode?q=' + encodeURIComponent(tries[i]) + '&country=' + encodeURIComponent(F.country.value)).then(function (r) { return r.json(); }).then(function (j) {
        var r = (j.results || [])[0];
        if (!r) return next(i + 1);
        showPin(r.lat, r.lng, i >= 2 ? 14 : 17);
        if (!F.postcode.value && r.postcode) F.postcode.value = r.postcode;
        $('mapMsg').textContent = i >= 2 ? 'Found the area. Now drag the pin onto the venue.' : 'Found it! Drag the pin if it’s not quite right.';
        saveDraft();
      }).catch(function () { $('mapMsg').textContent = 'The map search isn’t working right now. Please try again.'; });
    })(0);
  });

  // ---- Fee ----
  function updateFee() { $('feeBits').hidden = radio('feeKind') !== 'paid'; }
  form.addEventListener('change', function (e) { if (e.target.name === 'feeKind') updateFee(); });

  // ---- Photos: shrink on the device, then upload ----
  function drawPhotos() {
    var html = photos.map(function (p, i) {
      return '<div class="photo">' + (p.url ? '<img src="' + esc(p.url) + '" alt="Photo ' + (i + 1) + '">' : '') + (p.busy ? '<div class="up">Uploading…</div>' : '') +
        '<button type="button" data-i="' + i + '" aria-label="Remove photo ' + (i + 1) + '">✕</button></div>';
    }).join('');
    if (photos.length < CFG.maxPhotos) html += '<button type="button" class="photo drop" id="addPhoto">＋ Add photo' + (CFG.maxPhotos - photos.length > 1 ? 's' : '') + '</button>';
    $('photos').innerHTML = html;
  }
  $('photos').addEventListener('click', function (e) {
    var b = e.target.closest('button'); if (!b) return;
    if (b.id === 'addPhoto') return $('file').click();
    photos.splice(+b.getAttribute('data-i'), 1); drawPhotos(); saveDraft();
  });
  function loadImage(file) {
    return new Promise(function (ok, bad) {
      var u = URL.createObjectURL(file), img = new Image();
      img.onload = function () { ok(img); }; img.onerror = function () { URL.revokeObjectURL(u); bad(new Error('read')); };
      img.src = u;
    });
  }
  function toBlob(canvas, q) { return new Promise(function (ok) { canvas.toBlob(ok, 'image/jpeg', q); }); }
  // Make the photo small enough: at most 1600px across, and under the size limit
  function shrink(file) {
    var limit = CFG.maxPhotoKB * 1024 * 0.97;
    return loadImage(file).then(function (img) {
      var max = 1600, w = img.naturalWidth, h = img.naturalHeight;
      function attempt(maxSide, q) {
        var scale = Math.min(1, maxSide / Math.max(w, h));
        var c = document.createElement('canvas'); c.width = Math.round(w * scale); c.height = Math.round(h * scale);
        var ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height); ctx.drawImage(img, 0, 0, c.width, c.height);
        return toBlob(c, q).then(function (b) {
          if (!b) throw new Error('read');
          if (b.size <= limit) return b;
          if (q > 0.55) return attempt(maxSide, q - 0.1);
          if (maxSide > 500) return attempt(Math.round(maxSide * 0.75), 0.8);
          throw new Error('big');
        });
      }
      return attempt(max, 0.85);
    });
  }
  $('file').addEventListener('change', function () {
    var files = Array.prototype.slice.call($('file').files, 0, CFG.maxPhotos - photos.length);
    $('file').value = '';
    files.forEach(function (file) {
      var slot = { busy: true, url: '' }; photos.push(slot); drawPhotos(); uploading++;
      shrink(file).then(function (blob) {
        slot.url = URL.createObjectURL(blob); drawPhotos();
        return fetch('/api/photos', { method: 'POST', headers: { 'Content-Type': 'image/jpeg' }, body: blob });
      }).then(function (r) { return r.json().then(function (j) { if (!r.ok) throw new Error(j.error || 'Upload failed.'); return j; }); })
        .then(function (j) { slot.id = j.id; slot.url = j.url; slot.busy = false; })
        .catch(function (err) {
          photos.splice(photos.indexOf(slot), 1);
          $('err').textContent = err.message === 'read' ? 'We couldn’t read one of those photos (iPhone HEIC photos may need saving as JPEG first).' : err.message === 'big' ? 'One photo couldn’t be made small enough. Try a different one.' : err.message;
        })
        .then(function () { uploading--; drawPhotos(); saveDraft(); });
    });
  });

  // ---- Reading and filling the form ----
  function collect() {
    var fk = radio('feeKind');
    return {
      title: F.title.value, description: F.description.value, host: F.host.value,
      types: checked('types'), formats: checked('formats'), features: checked('features'), prizeTags: checked('prizeTags'),
      schedule: schedule(), online: F.online.checked, onlineLink: F.onlineLink.value,
      venue: F.venue.value, address: F.address.value, town: F.town.value, region: F.region.value, postcode: F.postcode.value, country: F.country.value,
      lat: latlng ? latlng.lat : null, lng: latlng ? latlng.lng : null,
      fee: fk === 'free' ? { free: true } : fk === 'paid' ? { free: false, amount: F.amount.value, currency: F.currency.value, per: F.per.value } : null,
      teamMax: F.teamMax.value ? Number(F.teamMax.value) : null, prizes: F.prizes.value, ages: F.ages.value,
      booking: { required: F.bookRequired.checked, link: F.bookLink.value, phone: F.bookPhone.value, note: F.bookNote.value },
      website: F.website.value, facebook: F.facebook.value, phone: F.phone.value,
      contact: { name: F.cname.value, email: F.cemail.value, phone: F.cphone.value },
    };
  }
  function fill(q) {
    var set = function (n, v) { if (F[n] && v != null) F[n].value = v; };
    set('title', q.title); set('description', q.description); set('host', q.host);
    setChecked('types', q.types); setChecked('formats', q.formats); setChecked('features', q.features); setChecked('prizeTags', q.prizeTags);
    var s = q.schedule || {};
    if (s.repeat) setRadio('repeat', s.repeat);
    setChecked('days', s.days); setChecked('weeks', s.weeks); set('anchor', s.anchor); set('date', s.date);
    if (s.time) set('time', s.time); set('endTime', s.endTime || '');
    F.online.checked = !!q.online; set('onlineLink', q.onlineLink);
    set('venue', q.venue); set('address', q.address); set('town', q.town); set('region', q.region); set('postcode', q.postcode);
    if (q.country) set('country', q.country);
    if (q.lat != null && q.lng != null) { latlng = { lat: q.lat, lng: q.lng }; if (!q.online) showPin(q.lat, q.lng, 16); }
    if (q.fee && q.fee.free) setRadio('feeKind', 'free');
    else if (q.fee && q.fee.amount != null) { setRadio('feeKind', 'paid'); set('amount', q.fee.amount); set('currency', q.fee.currency || 'GBP'); set('per', q.fee.per || 'person'); }
    else if (q.fee === null) setRadio('feeKind', 'unknown');
    set('teamMax', q.teamMax || ''); set('prizes', q.prizes); set('ages', q.ages || '');
    var b = q.booking || {};
    F.bookRequired.checked = !!b.required; set('bookLink', b.link); set('bookPhone', b.phone); set('bookNote', b.note);
    set('website', q.website); set('facebook', q.facebook); set('phone', q.phone);
    if (q.contact) { set('cname', q.contact.name); set('cemail', q.contact.email); set('cphone', q.contact.phone); }
    updateWhen(); updateOnline(); updateFee(); updateTotal();
  }

  // Keep a draft on this device so nothing is lost if the page is closed (new listings only)
  var draftTimer = null;
  function saveDraft() {
    if (mode !== 'new') return;
    clearTimeout(draftTimer);
    draftTimer = setTimeout(function () { try { localStorage.setItem(DRAFT, JSON.stringify({ q: collect(), photos: photos.filter(function (p) { return p.id; }), at: Date.now() })); } catch (e) { /* private mode */ } }, 400);
  }
  form.addEventListener('input', saveDraft); form.addEventListener('change', saveDraft);

  // ---- Sending ----
  function fail(msg) { $('err').textContent = msg; $('go').disabled = false; $('go').textContent = goLabel(); }
  form.addEventListener('submit', function (e) {
    e.preventDefault(); $('err').textContent = '';
    if (uploading) return fail('Hang on, a photo is still uploading…');
    if (mode !== 'manage' && !F.terms.checked) return fail('Please tick the box to agree to the terms.');
    var data = collect();
    if (!data.online && !latlng && (data.town || data.address)) return fail('Press “Find on map” so people can find the venue.');
    var body = { listing: data, photos: photos.filter(function (p) { return p.id; }).map(function (p) { return p.id; }) };
    if (mode === 'claim') body.claimId = CFG.claimId;
    if (asAdmin) body.asAdmin = true;
    body.events = Number($('events').value);
    $('go').disabled = true; $('go').textContent = 'Saving…';
    var url = mode === 'manage' ? '/api/manage/' + encodeURIComponent(CFG.token) : '/api/listings';
    fetch(url, { method: mode === 'manage' ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      .then(function (r) { return r.json().then(function (j) { if (!r.ok) throw new Error(j.error || 'Something went wrong.'); return j; }); })
      .then(function (j) {
        if (mode === 'manage') { $('go').disabled = false; $('go').textContent = 'Saved ✓'; setTimeout(function () { $('go').textContent = goLabel(); }, 2500); $('err').innerHTML = '<span style="color:#0b7d75">Saved. <a href="' + esc(j.url) + '">See your listing</a></span>'; return; }
        try { localStorage.removeItem(DRAFT); } catch (e2) { /* fine */ }
        if (j.done && j.url) { location.href = j.url; return; }
        $('go').disabled = false; $('go').textContent = goLabel();
        window.FAQPay.start({ ref: j.ref, label: (mode === 'claim' ? 'Claim: ' : '') + data.title + ' · ' + j.events + (j.events === 1 ? ' quiz date' : ' quiz dates') + ' · £' + j.amount });
      })
      .catch(function (err) { fail(err.message); });
  });

  // ---- Start ----
  drawPhotos(); updateWhen(); updateOnline(); updateFee(); updateTotal();
  if (mode === 'manage') {
    fetch('/api/manage/' + encodeURIComponent(CFG.token)).then(function (r) { return r.json().then(function (j) { if (!r.ok) throw new Error(j.error || 'This edit link isn’t valid.'); return j; }); })
      .then(function (j) {
        var q = j.listing; fill(q);
        photos = (q.photoIds || []).map(function (id, i) { return { id: id, url: q.photos[i] }; }); drawPhotos();
        var box = $('manageBox'); box.hidden = false;
        var exp = q.expiresAt ? new Date(q.expiresAt) : null, expired = exp && exp < new Date();
        var lastPaid = exp ? new Date(exp.getTime() - 30 * 3600000) : null;
        var fromYmd = exp && !expired ? q.expiresAt.slice(0, 10) : null;
        box.innerHTML = '<p style="margin:0 0 8px"><b><a href="' + esc(q.url) + '">' + esc(q.title) + '</a></b> · ' + (exp ? (expired ? 'Your listing <b>ended</b> after ' : '<b>' + q.datesLeft + '</b> paid quiz date' + (q.datesLeft === 1 ? '' : 's') + ' to come, up to <b>') + lastPaid.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' }) + (expired ? '' : '</b>') : 'Listed with no end date') + '</p>' +
          (exp ? '<label class="f" style="display:inline-block;margin:0 8px 0 0">Add the next <select id="moreEvents"></select></label> <button class="btn small" type="button" id="renew">Add dates</button> <span id="moreTotal" class="hint" style="display:inline"></span><br><br>' : '') +
          '<button class="btn small ghost" type="button" id="del">Take my listing down</button>';
        if (exp) {
          fillEvents($('moreEvents'));
          var showMore = function () { var mq = quote(q.schedule, Number($('moreEvents').value), fromYmd); $('moreTotal').textContent = mq.n ? mq.n + ' date' + (mq.n === 1 ? '' : 's') + (CFG.price > 0 ? ' · ' + money(mq.amount) : '') + ', up to ' + S.prettyDate(mq.last, S.ymd(S.todayLocal())) : 'No more dates for this quiz. Change the date above first.'; };
          $('moreEvents').addEventListener('change', showMore); showMore();
        }
        var rn = $('renew');
        if (rn) rn.addEventListener('click', function () {
          rn.disabled = true;
          fetch('/api/manage/' + encodeURIComponent(CFG.token) + '/renew', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ events: Number($('moreEvents').value) }) }).then(function (r) { return r.json().then(function (j2) { if (!r.ok) throw new Error(j2.error || 'Something went wrong.'); return j2; }); })
            .then(function (j2) { rn.disabled = false; if (j2.done) location.href = j2.url; else window.FAQPay.start({ ref: j2.ref, label: q.title + ' · ' + j2.events + ' more date' + (j2.events === 1 ? '' : 's') + ' · £' + j2.amount }); })
            .catch(function (err) { rn.disabled = false; $('err').textContent = err.message; });
        });
        $('del').addEventListener('click', function () {
          if (!window.confirm('Take this listing down for good? This can’t be undone.')) return;
          fetch('/api/manage/' + encodeURIComponent(CFG.token), { method: 'DELETE' }).then(function () { location.href = '/'; });
        });
      })
      .catch(function (err) { $('intro').textContent = err.message; form.hidden = true; });
  } else if (mode === 'claim') {
    fetch('/api/quiz/' + encodeURIComponent(CFG.claimId)).then(function (r) { return r.json(); }).then(function (j) { if (j.quiz) fill(j.quiz); });
  } else {
    try {
      var d = JSON.parse(localStorage.getItem(DRAFT) || 'null');
      if (d && d.q && Date.now() - d.at < 7 * 86400000) { fill(d.q); if (Date.now() - d.at < 20 * 3600000) { photos = (d.photos || []).slice(0, CFG.maxPhotos); drawPhotos(); } } // unused photos are cleared from the server after a day
    } catch (e) { /* no draft */ }
  }
  if (CFG.price > 0 && !CFG.paymentsOn && mode !== 'manage' && !asAdmin) { $('err').textContent = 'We’re not taking new listings for a moment. Please try again later.'; $('go').disabled = true; }
})();
