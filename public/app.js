/* Find a Quiz: search page */
(function () {
  var S = window.FAQSchedule, L = window.FAQLabels, CFG = window.FAQ || {};
  var $ = function (id) { return document.getElementById(id); };
  var DAY_COLOURS = ['#ffcf3f', '#ff8a65', '#7fd6c2', '#b9a7ff', '#ffb3c7', '#9fd3ff', '#c5e37a'];
  var MILE = 1.609344;
  var state = { center: null, label: '', all: [], shown: 0, filters: {} };
  // Before anyone searches, show quizzes in the visitor's own country (guessed from their time zone)
  var TZ = ''; try { TZ = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch (e) { /* old browser */ }
  var HOME = /^Europe\/(London|Belfast|Jersey|Guernsey|Isle_of_Man)$/.test(TZ) ? { code: 'GB', name: 'the UK' } : /^(America\/(New_York|Chicago|Denver|Phoenix|Los_Angeles|Anchorage|Detroit|Boise|Indiana|Kentucky|North_Dakota|Menominee|Juneau|Sitka|Nome|Adak|Metlakatla|Yakutat)|Pacific\/Honolulu)/.test(TZ) ? { code: 'US', name: 'the USA' } : null;
  state.region = HOME;
  var PAGE = 30;

  if (CFG.price > 0) $('price').innerHTML = '£' + (CFG.price % 1 ? Number(CFG.price).toFixed(2) : CFG.price) + '<small>per quiz night listed</small>';
  if (CFG.price <= 0) $('price').innerHTML = 'Free<small>to list your quiz, for now</small>';

  Object.keys(L.TYPES).forEach(function (k) { var o = document.createElement('option'); o.value = k; o.textContent = L.TYPES[k]; $('type').appendChild(o); });

  // ---- Map (if the map library can't load, the list still works) ----
  var LL = window.L, lmap = null, layer = null, here = null, markers = {}, hereIcon = null;
  if (LL) {
    lmap = LL.map('map', { scrollWheelZoom: false, worldCopyJump: true }).setView([52.5, -1.9], 7);
    LL.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' }).addTo(lmap);
    lmap.on('focus', function () { lmap.scrollWheelZoom.enable(); });
    layer = LL.layerGroup().addTo(lmap);
    hereIcon = LL.divIcon({ className: 'pin', iconSize: [22, 22], iconAnchor: [11, 11], html: '<div style="width:22px;height:22px;border-radius:50%;background:#0fa39a;border:3px solid #fff;box-shadow:0 0 0 2.5px #1a1340"></div>' });
  } else document.querySelector('.map-wrap').hidden = true;
  function pinIcon(colour, big) {
    var w = big ? 38 : 30, h = big ? 48 : 38;
    return LL.divIcon({ className: 'pin', iconSize: [w, h], iconAnchor: [w / 2, h - 2], popupAnchor: [0, -h + 6],
      html: '<svg viewBox="0 0 30 38" width="' + w + '" height="' + h + '"><path d="M15 1.5C7.5 1.5 1.8 7.2 1.8 14.3 1.8 23.4 15 36 15 36s13.2-12.6 13.2-21.7C28.2 7.2 22.5 1.5 15 1.5z" fill="' + colour + '" stroke="#1a1340" stroke-width="2.4"/><circle cx="15" cy="14" r="5" fill="#fff7ea" stroke="#1a1340" stroke-width="2"/></svg>' });
  }

  // ---- Helpers ----
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function say(t, err) { $('status').textContent = t || ''; $('status').className = 'status' + (err ? ' err' : ''); }
  function today() { return S.ymd(S.todayLocal()); }
  function firstDay(q) { var s = q.schedule || {}; if (s.repeat === 'once') { var d = S.parse(s.date); return d ? d.getUTCDay() : 0; } return (s.days || [0])[0]; }
  function distText(km) {
    if (km == null) return '';
    var mi = km / MILE;
    return (mi < 0.2 ? 'Under ¼ mile' : mi < 10 ? mi.toFixed(1) + ' miles' : Math.round(mi) + ' miles');
  }

  // ---- Filters ----
  function passes(q) {
    var f = state.filters, s = q.schedule || {}, t = today();
    if (!state.center && state.region && q.country !== state.region.code) return false;
    var day = $('day').value;
    if (day === 'tonight' && !S.matches(s, S.parse(t))) return false;
    if (day === 'tomorrow' && !S.matches(s, new Date(S.parse(t).getTime() + 86400000))) return false;
    if (day === 'week') { var nd = q.next; if (!nd || (S.parse(nd) - S.parse(t)) / 86400000 > 6) return false; }
    if (/^\d$/.test(day)) {
      var dn = +day;
      if (s.repeat === 'once') { var dd = S.parse(s.date); if (!dd || dd.getUTCDay() !== dn) return false; }
      else if (!s.days || s.days.indexOf(dn) < 0) return false;
    }
    var type = $('type').value; if (type && (q.types || []).indexOf(type) < 0) return false;
    if (f.free && !(q.fee && q.fee.free)) return false;
    if (f.family && ['all', 'family'].indexOf(q.ages) < 0) return false;
    if (f.food && (q.features || []).indexOf('food') < 0) return false;
    if (f.app && (q.formats || []).indexOf('app') < 0 && (q.formats || []).indexOf('tablets') < 0) return false;
    return true;
  }

  // ---- Showing results ----
  function card(q) {
    var t = today(), nextTxt = q.next ? S.prettyDate(q.next, t) : '';
    var img = q.photo ? '<img class="thumb" src="' + esc(q.photo) + '" alt="" loading="lazy">'
      : '<div class="ph" style="--c:' + DAY_COLOURS[firstDay(q)] + '" data-day="' + S.SHORT[firstDay(q)] + '"></div>';
    var tags = [];
    if (nextTxt) tags.push('<span class="tag ' + (nextTxt === 'Tonight' ? 'tonight' : 'next') + '">' + esc(nextTxt === 'Tonight' ? 'Tonight!' : 'Next: ' + nextTxt) + '</span>');
    if (q.km != null) tags.push('<span class="tag dist">' + esc(distText(q.km)) + '</span>');
    if (q.feeText) tags.push('<span class="tag' + (q.fee && q.fee.free ? ' free' : '') + '">' + esc(q.feeText) + '</span>');
    if (q.ages && L.AGES[q.ages]) tags.push('<span class="tag">' + esc(L.AGES[q.ages]) + '</span>');
    if (q.verified) tags.push('<span class="badge ok">✓ Confirmed</span>');
    var place = q.online ? 'Online quiz' : [q.venue, q.town].filter(Boolean).join(', ');
    return '<a class="card" href="' + esc(q.url) + '" data-id="' + esc(q.id) + '">' + img + '<div><h3>' + esc(q.title) + '</h3><p class="meta">' + esc(place) + '</p><p class="when">' + esc(q.when || 'Check with the venue') + '</p><div class="tags">' + tags.join('') + '</div></div></a>';
  }
  function render() {
    var items = state.all.filter(passes);
    var listEl = $('list');
    state.items = items; state.shown = Math.min(PAGE, items.length);
    listEl.innerHTML = items.slice(0, state.shown).map(card).join('');
    $('more').hidden = items.length <= state.shown;
    var where = state.center ? (state.areaKm ? ' in ' : ' near ') + state.label : '';
    if (!items.length) {
      $('count').textContent = 'No quizzes found' + where;
      listEl.innerHTML = '<div class="empty"><h3>Nothing here yet</h3><p>' + (state.center ? 'Try a bigger distance or fewer filters. ' : 'Try fewer filters. ') + 'Know a quiz round here? Tell the host they can <a href="/list">list it for ' + esc(CFG.price > 0 ? '£' + Number(CFG.price).toFixed(2) : 'free') + '</a>.</p></div>';
    } else $('count').textContent = items.length + (items.length === 1 ? ' quiz' : ' quizzes') + where;
    drawMarkers(items);
  }
  function drawMarkers(items) {
    if (!lmap) return;
    layer.clearLayers(); markers = {};
    var pts = [];
    items.forEach(function (q) {
      if (q.online || q.lat == null) return;
      var m = LL.marker([q.lat, q.lng], { icon: pinIcon(DAY_COLOURS[firstDay(q)]), title: q.title, keyboard: true });
      m.bindPopup('<b>' + esc(q.title) + '</b><br>' + esc(q.venue || '') + '<br>' + esc(q.when) + (q.next ? '<br>Next: ' + esc(S.prettyDate(q.next, today())) : '') + '<br><a href="' + esc(q.url) + '">See details →</a>');
      m.on('click', function () {
        var c = document.querySelector('.card[data-id="' + q.id + '"]');
        document.querySelectorAll('.card.hl').forEach(function (x) { x.classList.remove('hl'); });
        if (c) { c.classList.add('hl'); if (window.innerWidth > 900) c.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }
      });
      m.addTo(layer); markers[q.id] = m; pts.push([q.lat, q.lng]);
    });
    if (state.center) {
      var r = Math.max(Number($('radius').value) * MILE, state.areaKm || 0) * 1000;
      var b = LL.latLng(state.center.lat, state.center.lng).toBounds(r * 2);
      if (pts.length) { var pb = LL.latLngBounds(pts); pb.extend([state.center.lat, state.center.lng]); lmap.fitBounds(pb.pad(0.15), { maxZoom: 14 }); }
      else lmap.fitBounds(b);
    } else if (pts.length) lmap.fitBounds(LL.latLngBounds(pts).pad(0.1), { maxZoom: 13 });
  }
  $('more').querySelector('button').addEventListener('click', function () {
    var next = state.items.slice(state.shown, state.shown + PAGE);
    $('list').insertAdjacentHTML('beforeend', next.map(card).join(''));
    state.shown += next.length; $('more').hidden = state.items.length <= state.shown;
  });
  $('list').addEventListener('mouseover', function (e) {
    var c = e.target.closest && e.target.closest('.card'); if (!c) return;
    var m = lmap && markers[c.getAttribute('data-id')]; if (m && !m._faqBig) { Object.keys(markers).forEach(function (k) { if (markers[k]._faqBig) { markers[k].setIcon(markers[k]._faqIcon); markers[k]._faqBig = false; markers[k].setZIndexOffset(0); } }); m._faqIcon = m.options.icon; m.setIcon(pinIcon('#ff5a36', true)); m._faqBig = true; m.setZIndexOffset(1000); }
  });

  // ---- Loading quizzes ----
  function load() {
    var u = '/api/quizzes';
    if (state.center) u += '?lat=' + state.center.lat + '&lng=' + state.center.lng + '&km=' + Math.round(Math.max(Number($('radius').value) * MILE, state.areaKm || 0));
    $('count').textContent = 'Loading quizzes…';
    return fetch(u).then(function (r) { return r.json(); }).then(function (j) {
      state.all = j.quizzes || [];
      if (!state.center && !state.all.length) $('count').textContent = 'No quizzes listed yet';
      render();
      if (!state.center) {
        $('count').innerHTML = state.items.length + ' quizzes in ' + (state.region ? state.region.name + ' · <a href="#" id="everywhere">show everywhere</a>' : 'the world') + ' · search to find ones near you';
        var ev = document.getElementById('everywhere');
        if (ev) ev.addEventListener('click', function (e) { e.preventDefault(); state.region = null; render(); $('count').textContent = state.items.length + ' quizzes worldwide · search to find ones near you'; });
      }
    }).catch(function () { $('count').textContent = 'Couldn’t load quizzes. Check your connection and try again.'; });
  }
  function setCenter(lat, lng, label, fromUser, area) {
    state.center = { lat: +lat, lng: +lng }; state.label = label;
    state.areaKm = area > 40 ? area : 0; // a whole state/county/country: search all of it, not just around its middle
    if (lmap) { if (here) lmap.removeLayer(here); here = LL.marker([lat, lng], { icon: hereIcon, interactive: false, keyboard: false }).addTo(lmap); }
    say('');
    try {
      var p = new URLSearchParams(); if (fromUser === 'gps') { p.set('lat', (+lat).toFixed(3)); p.set('lng', (+lng).toFixed(3)); } else p.set('q', label);
      history.replaceState(null, '', '/?' + p.toString());
    } catch (e) { /* old browser */ }
    return load();
  }

  // ---- Searching for a place ----
  function showSuggest(results) {
    var ul = $('suggest');
    ul.innerHTML = results.map(function (r, i) { return '<li><button type="button" data-i="' + i + '">' + esc(r.name) + '</button></li>'; }).join('');
    ul.hidden = false;
    ul.onclick = function (e) {
      var b = e.target.closest('button'); if (!b) return;
      var r = results[+b.getAttribute('data-i')]; ul.hidden = true;
      var short = shortName(r);
      $('q').value = short; setCenter(r.lat, r.lng, short, null, r.areaKm);
    };
  }
  function shortName(r) { return r.postcode && /^[A-Z]{1,2}\d/.test(r.name) ? r.name : String(r.name).split(',').slice(0, 2).join(',').trim(); }
  document.addEventListener('click', function (e) { if (!e.target.closest('#search')) $('suggest').hidden = true; });
  $('search').addEventListener('submit', function (e) {
    e.preventDefault();
    var q = $('q').value.trim();
    if (!q) { say('Type a town, city or postcode, or tap “Near me”.', true); return; }
    say('Finding ' + q + '…');
    fetch('/api/geocode?q=' + encodeURIComponent(q)).then(function (r) { return r.json(); }).then(function (j) {
      var rs = (j.results || []).filter(function (r) { return isFinite(r.lat) && isFinite(r.lng); });
      if (j.error) return say(j.error, true);
      if (!rs.length) return say('We couldn’t find “' + q + '”. Try a nearby town or a postcode.', true);
      setCenter(rs[0].lat, rs[0].lng, shortName(rs[0]), null, rs[0].areaKm);
      if (rs.length > 1) say('Showing quizzes near ' + shortName(rs[0]) + '. Not the right place? Pick one from the list.'), showSuggest(rs);
    }).catch(function () { say('Search isn’t working right now. Please try again.', true); });
  });
  $('near').addEventListener('click', function () {
    if (!navigator.geolocation) return say('Your browser can’t share your location. Type a town or postcode instead.', true);
    say('Finding you…');
    navigator.geolocation.getCurrentPosition(function (pos) {
      $('q').value = '';
      setCenter(pos.coords.latitude, pos.coords.longitude, 'you', 'gps');
    }, function () { say('We couldn’t get your location. Type a town or postcode instead.', true); }, { enableHighAccuracy: false, timeout: 12000, maximumAge: 300000 });
  });

  // ---- Filters ----
  ['day', 'type'].forEach(function (id) { $(id).addEventListener('change', render); });
  $('radius').addEventListener('change', function () { if (state.center) load(); else render(); });
  document.querySelectorAll('.pill[data-f]').forEach(function (b) {
    b.addEventListener('click', function () {
      var on = b.getAttribute('aria-pressed') !== 'true'; b.setAttribute('aria-pressed', on);
      state.filters[b.getAttribute('data-f')] = on; render();
    });
  });

  // ---- Start: from the address bar (?q=Birmingham or ?lat=..&lng=..), else show everything ----
  var params = new URLSearchParams(location.search);
  if (params.get('lat') && params.get('lng')) setCenter(params.get('lat'), params.get('lng'), 'you', 'gps');
  else if (params.get('q')) { $('q').value = params.get('q'); load().then(function () { $('search').dispatchEvent(new Event('submit', { cancelable: true })); }); }
  else load();
})();
