/* Find a Quiz: admin page */
(function () {
  var $ = function (id) { return document.getElementById(id); };
  var data = null;
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function api(path, body) {
    return fetch('/api/admin/' + path, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {})
      .then(function (r) { return r.json().then(function (j) { if (r.status === 401) { showLogin(); throw new Error(j.error); } if (!r.ok) throw new Error(j.error || 'Failed'); return j; }); });
  }
  function showLogin() { $('login').hidden = false; $('panel').hidden = true; }
  if (!(window.FAQ && window.FAQ.adminOn)) { $('login').hidden = false; $('login').innerHTML = '<p>The admin page is switched off. Add <b>ADMIN_PASSWORD</b> in Railway → Variables, then reload.</p>'; return; }

  $('login').addEventListener('submit', function (e) {
    e.preventDefault();
    fetch('/api/admin/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: e.target.password.value }) })
      .then(function (r) { return r.json().then(function (j) { if (!r.ok) throw new Error(j.error); }); })
      .then(load).catch(function (err) { $('loginErr').textContent = err.message; });
  });
  $('sqRun').addEventListener('click', function () { api('sync-sq', {}).then(function () { setTimeout(load, 800); }); });
  $('logout').addEventListener('click', function () { api('logout', {}).then(showLogin).catch(showLogin); });

  function load() {
    return api('overview').then(function (j) {
      data = j; $('login').hidden = true; $('panel').hidden = false;
      var c = j.counts, st = j.settings;
      $('stats').innerHTML = [
        ['Live listings', c.live], ['From hosts', c.owner], ['Found online', c.found], ['From SpeedQuizzing', c.sq], ['Sales', j.sales], ['Takings', '£' + j.takings.toFixed(2)],
        ['Photos', j.storage.photos + ' · ' + j.storage.usedMB + ' MB of ' + st.storageCapMB], ['Open reports', c.reports],
      ].map(function (x) { return '<div class="stat">' + esc(x[0]) + '<b>' + esc(x[1]) + '</b></div>'; }).join('');
      var w = [];
      if (!j.payReady) w.push('Card payments aren’t set up: add SUMUP_API_KEY and SUMUP_MERCHANT_CODE in Railway → Variables.');
      if (!j.emailReady) w.push('Edit links aren’t emailed to listers (optional: add RESEND_API_KEY). They’re shown on screen after paying.');
      $('warn').hidden = !w.length; $('warn').innerHTML = w.map(esc).join('<br>');
      var f = $('settings').elements;
      ['price', 'maxEvents', 'maxPhotos', 'maxPhotoKB', 'storageCapMB', 'notice'].forEach(function (k) { f[k].value = st[k]; });
      f.paymentsOn.checked = st.paymentsOn;
      var q = j.sqSync;
      $('sqStatus').innerHTML = j.sqRunning ? '<b>Importing now…</b> This takes a few minutes. Reload to see the result.' : !q ? 'Not run yet. It runs by itself a minute after the site starts.' :
        q.error ? 'Last import <b>failed</b> on ' + esc(new Date(q.at).toLocaleString('en-GB')) + ': ' + esc(q.error) :
        'Last import ' + esc(new Date(q.at).toLocaleString('en-GB')) + ': <b>' + q.found + '</b> US events found, ' + q.added + ' added, ' + q.updated + ' updated, ' + (q.skipped || 0) + ' skipped, ' + (q.hidden || 0) + ' taken down' + (q.failed ? ', ' + q.failed + ' couldn’t be read' : '') + '.';
      drawReports(); drawTable();
    });
  }
  $('settings').addEventListener('submit', function (e) {
    e.preventDefault(); var f = e.target.elements;
    api('settings', { price: f.price.value, maxEvents: f.maxEvents.value, maxPhotos: f.maxPhotos.value, maxPhotoKB: f.maxPhotoKB.value, storageCapMB: f.storageCapMB.value, paymentsOn: f.paymentsOn.checked, notice: f.notice.value })
      .then(function () { $('setMsg').textContent = 'Saved ✓'; setTimeout(function () { $('setMsg').textContent = ''; }, 2500); load(); })
      .catch(function (err) { $('setMsg').textContent = err.message; });
  });

  function drawReports() {
    var open = data.reports.filter(function (r) { return !r.resolved; });
    $('repCount').textContent = open.length ? '(' + open.length + ' open)' : '';
    $('reports').innerHTML = open.length ? '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Quiz</th><th>Problem</th><th>When</th><th></th></tr></thead><tbody>' + open.map(function (r) {
      var l = data.listings.find(function (x) { return x.id === r.listingId; });
      return '<tr><td>' + (l ? '<a href="/quiz/' + esc(l.slug) + '" target="_blank">' + esc(r.title) + '</a>' : esc(r.title)) + '</td><td><b>' + esc(r.reason) + '</b> ' + esc(r.message) + (r.email ? '<br><a href="mailto:' + esc(r.email) + '">' + esc(r.email) + '</a>' : '') + '</td><td>' + esc(new Date(r.at).toLocaleString('en-GB')) + '</td><td><button data-rep="' + esc(r.id) + '">Done</button></td></tr>';
    }).join('') + '</tbody></table></div>' : '<p class="muted">No open reports.</p>';
  }
  $('reports').addEventListener('click', function (e) { var b = e.target.closest('button[data-rep]'); if (b) api('report/' + b.getAttribute('data-rep'), {}).then(load); });

  function drawTable() {
    var q = $('filter').value.trim().toLowerCase(), show = $('show').value;
    var rows = data.listings.filter(function (l) {
      if (q && (l.title + ' ' + l.town + ' ' + l.email).toLowerCase().indexOf(q) < 0) return false;
      if (show === 'owner') return l.source !== 'seed' && l.source !== 'speedquizzing';
      if (show === 'seed') return l.source === 'seed';
      if (show === 'speedquizzing') return l.source === 'speedquizzing';
      if (show === 'hidden') return l.status === 'hidden';
      if (show === 'ended') return !l.live && l.status === 'active';
      return true;
    });
    $('tbl').querySelector('tbody').innerHTML = rows.map(function (l) {
      var status = l.status === 'hidden' ? 'Hidden' : l.live ? 'Live' : 'Ended';
      var b = function (a, t, cls) { return '<button data-id="' + esc(l.id) + '" data-a="' + a + '"' + (cls ? ' class="' + cls + '"' : '') + '>' + t + '</button>'; };
      return '<tr><td><a href="/quiz/' + esc(l.slug) + '" target="_blank">' + esc(l.title) + '</a><br><span class="muted">' + esc(l.town) + ' · ' + (l.source === 'seed' ? 'found online' : l.source === 'speedquizzing' ? 'SpeedQuizzing' : l.source) + (l.verified ? ' · ✓' : '') + (l.photos ? ' · ' + l.photos + ' 📷' : '') + '</span></td>' +
        '<td>' + esc(l.when) + '</td><td>' + status + '</td><td>' + (l.expiresAt ? esc(new Date(l.expiresAt).toLocaleDateString('en-GB')) : '—') + '</td><td>' + (l.email ? '<a href="mailto:' + esc(l.email) + '">' + esc(l.email) + '</a>' : '') + '</td>' +
        '<td>' + b('editlink', 'Edit') + (l.status === 'hidden' ? b('show', 'Show') : b('hide', 'Hide')) + (l.verified ? b('unverify', 'Unconfirm') : b('verify', 'Confirm')) + (l.expiresAt ? b('extend', '+13 dates') : '') + b('delete', 'Delete', 'danger') + '</td></tr>';
    }).join('') || '<tr><td colspan="6" class="muted">No listings.</td></tr>';
  }
  $('filter').addEventListener('input', drawTable); $('show').addEventListener('change', drawTable);
  $('tbl').addEventListener('click', function (e) {
    var b = e.target.closest('button[data-a]'); if (!b) return;
    var a = b.getAttribute('data-a'), id = b.getAttribute('data-id');
    if (a === 'delete' && !window.confirm('Delete this listing for good?')) return;
    if (a === 'editlink' && !window.confirm('Open an edit page for this listing? (This makes a new edit link, so any link the lister had stops working. Copy the new one to them if needed.)')) return;
    api('listing/' + id, { action: a }).then(function (j) { if (j.url) window.open(j.url, '_blank'); return load(); }).catch(function (err) { alert(err.message); });
  });

  load().catch(function () { /* shows login */ });
})();
