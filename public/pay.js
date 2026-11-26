/* Find a Quiz: card payment in a box on our own page (SumUp's card form), as on The Big Quiz Live.
 * FAQPay.start({ ref, label }) asks the server for a SumUp checkout for that ref, shows the card form, and when
 * SumUp confirms the payment, goes to the "your quiz is live" page. The server also checks with SumUp by itself,
 * so the listing still goes live if the page is closed straight after paying. */
(function () {
  var SDK = 'https://gateway.sumup.com/gateway/ecom/card/v2/sdk.js';
  var loading = null, widget = null, busy = false;
  var $ = function (id) { return document.getElementById(id); };
  function loadSdk() {
    if (window.SumUpCard) return Promise.resolve();
    if (loading) return loading;
    loading = new Promise(function (ok, bad) {
      var s = document.createElement('script'); s.src = SDK; s.async = true;
      s.onload = function () { window.SumUpCard ? ok() : bad(new Error('load')); };
      s.onerror = function () { loading = null; bad(new Error('load')); };
      document.head.appendChild(s);
    });
    return loading;
  }
  function say(t, err) { var m = $('payMsg'); m.textContent = t || ''; m.className = 'msg' + (err ? ' err' : ''); }
  function close() {
    if (busy) return;
    try { if (widget) widget.unmount(); } catch (e) { /* gone */ }
    widget = null; $('paybox').hidden = true; document.body.style.overflow = '';
  }
  $('payClose').addEventListener('click', close);
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !$('paybox').hidden) close(); });

  function confirmPaid(ref) {
    busy = true; $('sumup-card').innerHTML = '<div class="spin"></div>'; say('Payment received! Putting your quiz live…');
    var tries = 0;
    (function poll() {
      tries++;
      fetch('/api/pay-status?ref=' + encodeURIComponent(ref), { cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (j) {
        if (j.status === 'PAID' && j.url) { busy = false; location.href = j.url; return; }
        if (j.status === 'FAILED') { busy = false; say('The payment didn’t go through and you haven’t been charged. Please try again.', true); return; }
        if (tries < 60) setTimeout(poll, 2000); else { busy = false; location.href = '/done?ref=' + encodeURIComponent(ref); }
      }).catch(function () { if (tries < 60) setTimeout(poll, 3000); });
    })();
  }

  function start(opts) {
    $('paybox').hidden = false; document.body.style.overflow = 'hidden';
    $('payWhat').textContent = opts.label || ''; $('sumup-card').innerHTML = '';
    say('Loading the secure card form…');
    return fetch('/api/checkout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ref: opts.ref }) })
      .then(function (r) { return r.json().then(function (j) { if (!r.ok) throw new Error(j.error || 'Something went wrong.'); return j; }); })
      .then(function (j) {
        if (j.paid && j.url) { location.href = j.url; return; }
        return loadSdk().catch(function () { throw new Error('The card form couldn’t load. Check your connection and try again.'); }).then(function () {
          say('');
          widget = window.SumUpCard.mount({
            id: 'sumup-card', checkoutId: j.checkoutId, amount: j.amount, currency: 'GBP', locale: 'en-GB',
            onResponse: function (type, body) {
              if (type === 'sent' || type === 'auth-screen') { busy = true; say(type === 'auth-screen' ? 'Confirm the payment with your bank…' : 'Processing…'); }
              else if (type === 'success') { try { widget.unmount(); } catch (e) { /* gone */ } widget = null; confirmPaid(opts.ref); }
              else if (type === 'fail') { busy = false; say('The payment didn’t go through and you haven’t been charged. Please try again.', true); }
              else if (type === 'error') { busy = false; say((body && body.message) || 'There was a problem with the card. Please check the details.', true); }
              else if (type === 'invalid') { busy = false; say('Please check the card details.', true); }
            },
          });
        });
      })
      .catch(function (err) { busy = false; say(err.message, true); });
  }
  window.FAQPay = { start: start };
})();
