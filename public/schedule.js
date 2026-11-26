/* Find a Quiz: when a quiz happens. Used by the server and in the browser.
 * A schedule looks like:
 *   { repeat: 'weekly',      days: [2],    time: '20:00' }              every Tuesday
 *   { repeat: 'fortnightly', days: [3],    anchor: '2026-12-02', ... }  every other Wednesday (anchor = one of the dates)
 *   { repeat: 'monthly',     days: [1], weeks: [2], ... }               2nd Monday of the month (-1 = last)
 *   { repeat: 'once',        date: '2026-12-18', ... }                  a one-off event
 * Days are 0 = Sunday ... 6 = Saturday. Dates are plain YYYY-MM-DD in the venue's own local time. */
(function (root) {
  var DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  var SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  var NTH = { 1: '1st', 2: '2nd', 3: '3rd', 4: '4th', 5: '5th', '-1': 'last' };

  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function ymd(d) { return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate()); }
  function parse(s) { var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || '')); return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])) : null; }
  function todayLocal() { var n = new Date(); return new Date(Date.UTC(n.getFullYear(), n.getMonth(), n.getDate())); }
  function addDays(d, n) { return new Date(d.getTime() + n * 86400000); }

  // Which week of the month a date is in (1..5), and whether it's the last one of its weekday
  function nthOfMonth(d) { return Math.floor((d.getUTCDate() - 1) / 7) + 1; }
  function isLastOfMonth(d) { return addDays(d, 7).getUTCMonth() !== d.getUTCMonth(); }

  function matches(s, d) {
    var dow = d.getUTCDay();
    if (!s) return false;
    if (s.repeat === 'once') return s.date === ymd(d);
    if (!s.days || s.days.indexOf(dow) < 0) return false;
    if (s.repeat === 'weekly') return true;
    if (s.repeat === 'fortnightly') {
      var a = parse(s.anchor); if (!a) return true; // no known date: can't tell which week, so show every week as "every other"
      var diff = Math.round((d - a) / 86400000);
      return ((diff % 14) + 14) % 14 === 0;
    }
    if (s.repeat === 'monthly') {
      var w = s.weeks && s.weeks.length ? s.weeks : [1];
      return w.indexOf(nthOfMonth(d)) >= 0 || (w.indexOf(-1) >= 0 && isLastOfMonth(d));
    }
    return false;
  }

  // The next n dates from 'from' (a YYYY-MM-DD string or today), looking up to ~13 months ahead
  function nextDates(s, from, n) {
    n = n || 1;
    var start = (typeof from === 'string' ? parse(from) : from) || todayLocal();
    var out = [];
    if (!s) return out;
    if (s.repeat === 'once') { var d1 = parse(s.date); if (d1 && d1 >= start) out.push(ymd(d1)); return out; }
    for (var i = 0; i < 400 && out.length < n; i++) { var d = addDays(start, i); if (matches(s, d)) out.push(ymd(d)); }
    return out;
  }

  function timeText(t) {
    var m = /^(\d{1,2}):(\d{2})$/.exec(String(t || '')); if (!m) return '';
    var h = +m[1], mi = m[2], ap = h >= 12 ? 'pm' : 'am'; var h12 = h % 12 || 12;
    if (h === 0 && mi === '00') return 'midnight';
    if (h === 12 && mi === '00') return 'noon';
    return h12 + (mi === '00' ? '' : ':' + mi) + ap;
  }
  function joinList(a) { return a.length < 2 ? a.join('') : a.slice(0, -1).join(', ') + ' & ' + a[a.length - 1]; }

  // "Every Tuesday", "Every other Wednesday", "2nd Monday of the month", "Friday 18 December 2026"
  function describe(s) {
    if (!s) return '';
    if (s.repeat === 'once') { var d = parse(s.date); return d ? DAYS[d.getUTCDay()] + ' ' + d.getUTCDate() + ' ' + MONTHS[d.getUTCMonth()] + ' ' + d.getUTCFullYear() : 'One-off'; }
    var days = (s.days || []).slice().sort(function (a, b) { return ((a + 6) % 7) - ((b + 6) % 7); }).map(function (x) { return DAYS[x]; });
    if (s.repeat === 'weekly') return days.length === 7 ? 'Every day' : 'Every ' + joinList(days);
    if (s.repeat === 'fortnightly') return 'Every other ' + joinList(days);
    if (s.repeat === 'monthly') {
      var w = (s.weeks && s.weeks.length ? s.weeks : [1]).slice().sort(function (a, b) { return (a < 0 ? 9 : a) - (b < 0 ? 9 : b); });
      var t = joinList(w.map(function (x) { return NTH[x]; })) + ' ' + joinList(days) + ' of the month';
      return t.charAt(0).toUpperCase() + t.slice(1);
    }
    return '';
  }
  function whenText(s) { var t = timeText(s && s.time); return describe(s) + (t ? ' · ' + t : ''); }

  // "Tonight", "Tomorrow", "Thu 3 Dec"
  function prettyDate(ds, today) {
    var d = parse(ds); if (!d) return '';
    var t = today ? parse(today) : todayLocal();
    var diff = Math.round((d - t) / 86400000);
    if (diff === 0) return 'Tonight';
    if (diff === 1) return 'Tomorrow';
    return SHORT[d.getUTCDay()] + ' ' + d.getUTCDate() + ' ' + MONTHS[d.getUTCMonth()].slice(0, 3);
  }

  var api = { DAYS: DAYS, SHORT: SHORT, MONTHS: MONTHS, matches: matches, nextDates: nextDates, describe: describe, timeText: timeText, whenText: whenText, prettyDate: prettyDate, ymd: ymd, parse: parse, todayLocal: todayLocal };
  if (typeof module === 'object' && module.exports) module.exports = api; else root.FAQSchedule = api;
})(this);
