/* Find a Quiz: a quiz's own page (small map + "something wrong?" form) */
(function () {
  var el = document.getElementById('map');
  if (el && window.L) {
    var lat = +el.getAttribute('data-lat'), lng = +el.getAttribute('data-lng');
    var m = window.L.map(el, { scrollWheelZoom: false, zoomControl: true }).setView([lat, lng], 15);
    window.L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' }).addTo(m);
    window.L.marker([lat, lng], { icon: window.L.divIcon({ className: 'pin', iconSize: [38, 48], iconAnchor: [19, 46],
      html: '<svg viewBox="0 0 30 38" width="38" height="48"><path d="M15 1.5C7.5 1.5 1.8 7.2 1.8 14.3 1.8 23.4 15 36 15 36s13.2-12.6 13.2-21.7C28.2 7.2 22.5 1.5 15 1.5z" fill="#ff5a36" stroke="#1a1340" stroke-width="2.4"/><circle cx="15" cy="14" r="5" fill="#fff7ea" stroke="#1a1340" stroke-width="2"/></svg>' }) }).addTo(m);
  }
  var f = document.getElementById('report');
  if (f) f.addEventListener('submit', function (e) {
    e.preventDefault();
    var msg = f.querySelector('.msg'), btn = f.querySelector('button');
    btn.disabled = true; msg.textContent = 'Sending…';
    fetch('/api/report', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: f.getAttribute('data-id'), reason: f.reason.value, message: f.message.value, email: f.email.value }) })
      .then(function (r) { return r.json().then(function (j) { if (!r.ok) throw new Error(j.error || 'Couldn’t send.'); }); })
      .then(function () { msg.textContent = 'Thanks! We’ll take a look.'; f.reset(); })
      .catch(function (err) { msg.textContent = err.message; btn.disabled = false; });
  });
})();
