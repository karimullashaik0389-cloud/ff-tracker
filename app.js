/* Frost & Flame – Investment Tracker (PWA). Talks to the backend only through window.FFApi. */
(function () {
  'use strict';
  var POTS = ['Thanmayee/Karimulla', 'Gopi'];
  var CATEGORIES = ['Equipment', 'Smallwares', 'Fit-out/Signage', 'Decor', 'Seating', 'Packaging', 'Food stock',
    'Rent/Deposit', 'Licences/Legal', 'Marketing/Website', 'Utilities', 'Other'];
  var PAID_FROM = ['Business account', 'Own money', "Gopi's loan"];
  var STATUSES = ['Paid', 'Ordered / unpaid', 'Refund due'];
  var UNPAID = 'Ordered / unpaid', REFUND = 'Refund due';

  var state = { spends: [], repayments: [], settings: { budgets: {} }, loaded: false,
    view: 'home', person: POTS[0], filter: 'all', query: '' };

  /* ---------------- helpers ---------------- */
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var gbp = new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' });
  function money(n) { return gbp.format(Math.round((Number(n) || 0) * 100) / 100); }
  function moneyShort(n) { n = Number(n) || 0; return n >= 1000 ? '£' + (n / 1000).toFixed(n >= 10000 ? 0 : 1) + 'k' : '£' + Math.round(n); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function today() { var d = new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function niceDate(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || ''); if (!m) return iso || '';
    return Number(m[3]) + ' ' + ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][Number(m[2]) - 1] + ' ' + m[1];
  }
  function monthLabel(ym) { var p = ym.split('-'); return ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][Number(p[1]) - 1] + ' ' + p[0].slice(2); }
  function potClass(p) { return p === 'Gopi' ? 'gopi' : 'tk'; }
  function potShort(p) { return p === 'Gopi' ? 'Gopi' : 'Thanmayee/Karimulla'; }
  function initial(p) { return p === 'Gopi' ? 'G' : 'T/K'; }
  function sum(list, f) { return list.reduce(function (a, x) { return a + (f ? f(x) : x); }, 0); }
  function round2(n) { return Math.round(n * 100) / 100; }

  /* ---------------- the maths (one place) ---------------- */
  // EXAMPLE rows never count. "Ordered / unpaid" is shown separately – no money has left anyone's pocket yet.
  function real(s) { return !s.example; }
  function counts(s) { return real(s) && s.status !== UNPAID; }
  function canEdit(x) { return !!state.me && (state.me.isAdmin || (!!x.addedBy && x.addedBy === state.me.user)); }
  function calc() {
    var sp = state.spends.filter(counts), all = state.spends.filter(real), rep = state.repayments;
    var pots = {};
    POTS.forEach(function (p) {
      var inv = round2(sum(sp.filter(function (s) { return s.spentBy === p; }), function (s) { return s.amount; }));
      var paid = round2(sum(rep.filter(function (r) { return r.pot === p; }), function (r) { return r.amount; }));
      pots[p] = { invested: inv, repaid: paid, outstanding: round2(inv - paid),
        count: sp.filter(function (s) { return s.spentBy === p; }).length };
    });
    var total = round2(sum(POTS, function (p) { return pots[p].invested; }));
    var repaid = round2(sum(POTS, function (p) { return pots[p].repaid; }));
    var months = {};
    sp.forEach(function (s) {
      var k = (s.date || '').slice(0, 7); if (!/^\d{4}-\d{2}$/.test(k)) return;
      months[k] = months[k] || { 'Thanmayee/Karimulla': 0, Gopi: 0 };
      if (months[k][s.spentBy] != null) months[k][s.spentBy] += s.amount;
    });
    var cats = {};
    sp.forEach(function (s) { var c = s.category || 'Uncategorised'; cats[c] = (cats[c] || 0) + s.amount; });
    var committed = {};
    all.filter(function (s) { return s.status === UNPAID; }).forEach(function (s) { var c = s.category || 'Uncategorised'; committed[c] = (committed[c] || 0) + s.amount; });
    return {
      pots: pots, total: total, repaid: repaid, outstanding: round2(total - repaid),
      unpaid: round2(sum(all.filter(function (s) { return s.status === UNPAID; }), function (s) { return s.amount; })),
      refundDue: round2(sum(all.filter(function (s) { return s.status === REFUND; }), function (s) { return s.amount; })),
      months: months, cats: cats, committed: committed,
      missing: all.filter(function (s) { return !s.billLink; }),
      entries: all.length
    };
  }
  window.FFCalc = calc; // used by the tests

  /* ---------------- UI plumbing ---------------- */
  var toastTimer;
  function toast(msg, bad) {
    var t = $('#toast'); t.textContent = msg; t.className = 'toast' + (bad ? ' bad' : ''); t.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(function () { t.hidden = true; }, bad ? 4200 : 2600);
  }
  function busy(on, text) { $('#busy').hidden = !on; $('#busy-text').textContent = text || 'Saving…'; }
  function confirmBox(title, text, okLabel) {
    return new Promise(function (resolve) {
      var d = $('#dialog'); $('#dialog-title').textContent = title; $('#dialog-text').textContent = text;
      $('#dialog-ok').textContent = okLabel || 'Delete'; d.hidden = false;
      function done(v) { d.hidden = true; $('#dialog-ok').onclick = $('#dialog-cancel').onclick = null; resolve(v); }
      $('#dialog-ok').onclick = function () { done(true); };
      $('#dialog-cancel').onclick = function () { done(false); };
    });
  }
  function openSheet(title, html, onMount) {
    $('#sheet-title').textContent = title; $('#sheet-body').innerHTML = html; $('#sheet').hidden = false;
    $('#sheet-body').scrollTop = 0; document.body.style.overflow = 'hidden';
    if (onMount) onMount($('#sheet-body'));
  }
  function closeSheet() { $('#sheet').hidden = true; $('#sheet-body').innerHTML = ''; document.body.style.overflow = ''; }
  $$('#sheet [data-close]').forEach(function (b) { b.addEventListener('click', closeSheet); });

  function fail(e) {
    busy(false);
    if (e && e.code === 'auth') return; // lock screen already shown
    toast((e && e.message) || 'Something went wrong', true);
  }

  /* ---------------- lock screen: pick who you are, then your own PIN ---------------- */
  var pin = '', lockUser = '', mode = 'login', loginPin = '', newPin1 = '';
  function drawDots() {
    var box = $('#pin-dots'), len = Math.max(4, pin.length); box.innerHTML = '';
    for (var i = 0; i < len; i++) { var d = document.createElement('i'); if (i < pin.length) d.className = 'on'; box.appendChild(d); }
  }
  function pickStep(msg) {
    mode = 'login'; pin = ''; lockUser = ''; loginPin = ''; newPin1 = '';
    $('#lock-users').hidden = false; $('#lock-pin').hidden = true; $('#users-msg').textContent = msg || '';
  }
  function pinStep(user) {
    lockUser = user; mode = 'login'; pin = ''; drawDots();
    $('#lock-users').hidden = true; $('#lock-pin').hidden = false; $('#not-you').hidden = false;
    $('#pin-ask').textContent = 'Hi ' + user + ' – enter your PIN'; $('#lock-msg').textContent = '';
    clearInterval(lockTimer); $$('#keypad button').forEach(function (b) { b.disabled = false; });
  }
  function newPinStep(first) {
    mode = first ? 'new1' : 'new2'; pin = ''; drawDots(); $('#not-you').hidden = true;
    $('#lock-users').hidden = true; $('#lock-pin').hidden = false;
    $('#pin-ask').textContent = first ? 'Welcome ' + lockUser + '! Choose your own PIN (4–8 digits)' : 'Type your new PIN again';
  }
  function showLock(msg) {
    pickStep(msg); $('#app').hidden = true; $('#lock').hidden = false; closeSheet();
    state.spends = []; state.repayments = []; state.loaded = false; state.me = null; // forget data when locked
    $$('.view').forEach(function (v) { v.innerHTML = ''; });                         // and wipe it from the screen
  }
  function showApp() { $('#lock').hidden = true; $('#app').hidden = false; }
  function enterApp() { pin = ''; loginPin = ''; newPin1 = ''; drawDots(); $('#lock-msg').textContent = ''; showApp(); go('home'); load(); }
  var lockTimer;
  function lockCountdown(sec) {
    var keys = $$('#keypad button'); keys.forEach(function (b) { b.disabled = true; });
    clearInterval(lockTimer);
    var end = Date.now() + sec * 1000;
    function tick() {
      var left = Math.ceil((end - Date.now()) / 1000);
      if (left <= 0) { clearInterval(lockTimer); keys.forEach(function (b) { b.disabled = false; }); $('#lock-msg').textContent = 'Try again'; return; }
      $('#lock-msg').textContent = 'Too many wrong PINs for ' + lockUser + '. Try again in ' + Math.floor(left / 60) + ':' + pad(left % 60);
    }
    tick(); lockTimer = setInterval(tick, 1000);
  }
  function shake() { var dots = $('#pin-dots'); dots.classList.remove('shake'); void dots.offsetWidth; dots.classList.add('shake'); }
  function submitPin() {
    if (pin.length < 4) { $('#lock-msg').textContent = 'Enter at least 4 digits'; return; }
    if (mode === 'new1') {
      if (pin === loginPin) { pin = ''; drawDots(); shake(); $('#lock-msg').textContent = 'Choose a different PIN from the one you were given'; return; }
      newPin1 = pin; $('#lock-msg').textContent = ''; return newPinStep(false);
    }
    if (mode === 'new2') {
      if (pin !== newPin1) { $('#lock-msg').textContent = "Those didn't match – start again"; shake(); return newPinStep(true); }
      $('#lock-msg').textContent = 'Saving…';
      return FFApi.changePin(loginPin, newPin1).then(function () { toast('Your new PIN is set'); enterApp(); },
        function (e) { $('#lock-msg').textContent = e.message; newPinStep(true); });
    }
    var tried = pin; $('#lock-msg').textContent = 'Checking…';
    FFApi.login(lockUser, tried).then(function (r) {
      if (r.mustChangePin) { loginPin = tried; $('#lock-msg').textContent = ''; return newPinStep(true); }
      enterApp();
    }, function (e) {
      pin = ''; drawDots(); shake();
      if (e.code === 'locked') lockCountdown(e.extra.retryAfter || 900);
      else if (e.code === 'bad_pin') $('#lock-msg').textContent = 'Wrong PIN' + (e.extra.remaining != null ? ' · ' + e.extra.remaining + ' tries left' : '');
      else $('#lock-msg').textContent = e.message;
    });
  }
  $$('.user-pick').forEach(function (b) { b.addEventListener('click', function () { pinStep(b.getAttribute('data-user')); }); });
  $('#not-you').addEventListener('click', function () { pickStep(); });
  $('#keypad').addEventListener('click', function (ev) {
    var b = ev.target.closest('button'); if (!b || b.disabled) return;
    var k = b.getAttribute('data-k');
    if (k === 'del') pin = pin.slice(0, -1);
    else if (k === 'ok') return submitPin();
    else if (pin.length < 8) pin += k;
    if (mode === 'login' || pin.length) $('#lock-msg').textContent = '';
    drawDots();
  });
  document.addEventListener('keydown', function (ev) {
    if ($('#lock').hidden || $('#lock-pin').hidden) return;
    if (/^\d$/.test(ev.key) && pin.length < 8) { pin += ev.key; drawDots(); }
    else if (ev.key === 'Backspace') { pin = pin.slice(0, -1); drawDots(); }
    else if (ev.key === 'Enter') submitPin();
  });
  FFApi.onAuthLost(function (msg) { showLock(msg || 'Please unlock again'); });

  /* ---------------- data ---------------- */
  function load(silent) {
    if (!silent) renderSkeleton();
    return FFApi.data().then(function (r) {
      state.spends = r.spends || []; state.repayments = r.repayments || []; state.settings = r.settings || { budgets: {} }; state.me = r.me || null;
      state.loaded = true; render();
    }, function (e) {
      if (e.code === 'auth') return;
      netState();
      $('#view-' + state.view).innerHTML = '<div class="card empty"><b>Can\'t load right now</b>' + esc(e.message) +
        '<div style="margin-top:14px"><button class="btn btn-ice" id="retry">Try again</button></div></div>';
      $('#retry').onclick = function () { load(); };
    });
  }
  function renderSkeleton() { $('#view-' + state.view).innerHTML = '<div class="skeleton" style="height:170px"></div><div class="skeleton"></div><div class="skeleton"></div>'; }

  /* ---------------- navigation ---------------- */
  var TITLES = { home: 'Dashboard', spends: 'All spends', people: 'People', repay: 'Repayments', settings: 'Settings' };
  function go(v) {
    state.view = v;
    $$('.view').forEach(function (s) { s.hidden = s.id !== 'view-' + v; });
    $$('.tab[data-view]').forEach(function (t) { t.classList.toggle('active', t.getAttribute('data-view') === v); });
    $('#view-title').textContent = TITLES[v]; window.scrollTo(0, 0);
    if (state.loaded) render();
  }
  $$('.tab[data-view]').forEach(function (t) { t.addEventListener('click', function () { go(t.getAttribute('data-view')); }); });
  $('#tab-add').addEventListener('click', function () { spendForm(null); });
  $('#btn-settings').addEventListener('click', function () { go('settings'); });
  $('#btn-refresh').addEventListener('click', function () { load().then(function () { if (state.loaded) toast('Up to date'); }); });

  function render() {
    ({ home: renderHome, spends: renderSpends, people: renderPeople, repay: renderRepay, settings: renderSettings })[state.view]();
  }

  /* ---------------- shared bits ---------------- */
  function spendItem(s, opts) {
    opts = opts || {};
    var tags = '';
    if (s.status === UNPAID) tags += '<span class="tag unpaid">Unpaid</span>';
    if (s.status === REFUND) tags += '<span class="tag refund">Refund due</span>';
    if (!s.billLink && !s.example) tags += '<span class="tag nobill">No bill</span>';
    var sub = [niceDate(s.date), s.category, opts.hidePot ? '' : potShort(s.spentBy)].filter(Boolean).join(' · ');
    return '<li class="item" data-id="' + esc(s.id) + '">' +
      '<button type="button" class="item-btn" data-open="' + esc(s.id) + '">' +
      '<span class="item-icon ' + potClass(s.spentBy) + '">' + (s.spentBy === 'Gopi' ? 'G' : 'TK') + '</span>' +
      '<span class="item-main"><span class="item-title" style="display:block">' + esc(s.title) + '</span>' +
      '<span class="item-sub" style="display:block">' + tags + (tags ? ' ' : '') + esc(sub) + '</span></span>' +
      '<span class="item-amt">' + money(s.amount) + '</span></button>' +
      (s.billLink && opts.billLinks ? '<button type="button" class="bill-link" data-bill="' + esc(s.id) + '">Bill</button>' : '') +
      '</li>';
  }
  function wireList(root) {
    $$('[data-open]', root).forEach(function (b) { b.onclick = function () { spendDetail(b.getAttribute('data-open')); }; });
    $$('[data-bill]', root).forEach(function (b) { b.onclick = function (e) { e.stopPropagation(); viewBill(b.getAttribute('data-bill')); }; });
  }
  function byDateDesc(a, b) { return (b.date || '').localeCompare(a.date || '') || (b.createdAt || '').localeCompare(a.createdAt || ''); }
  function potCard(p, c) {
    var pc = c.pots[p], pct = pc.invested ? Math.min(100, pc.repaid / pc.invested * 100) : 0;
    return '<button type="button" class="pot" data-person="' + esc(p) + '">' +
      '<div class="pot-name"><span class="dot ' + potClass(p) + '"></span>' + esc(potShort(p)) + '</div>' +
      '<div class="pot-amt" data-test="invested-' + potClass(p) + '">' + money(pc.invested) + '</div>' +
      '<div class="bar ' + (p === 'Gopi' ? 'fl' : '') + '"><i style="width:' + pct.toFixed(1) + '%"></i></div>' +
      '<div class="pot-line"><span>Repaid</span><b data-test="repaid-' + potClass(p) + '">' + money(pc.repaid) + '</b></div>' +
      '<div class="pot-line"><span>Still owed</span><b data-test="owed-' + potClass(p) + '">' + money(pc.outstanding) + '</b></div></button>';
  }

  function monthChart(months) {
    var keys = Object.keys(months).sort().slice(-6);
    if (!keys.length) return '<div class="empty">No spends yet</div>';
    var W = 340, H = 170, pb = 26, pt = 18, bw = Math.min(38, (W - 20) / keys.length - 14);
    var max = Math.max.apply(null, keys.map(function (k) { return months[k]['Thanmayee/Karimulla'] + months[k].Gopi; })) || 1;
    var step = (W - 10) / keys.length, svg = '';
    keys.forEach(function (k, i) {
      var a = months[k]['Thanmayee/Karimulla'], g = months[k].Gopi, x = 5 + i * step + (step - bw) / 2;
      var ha = a / max * (H - pb - pt), hg = g / max * (H - pb - pt), base = H - pb;
      svg += '<rect x="' + x + '" y="' + (base - ha) + '" width="' + bw + '" height="' + Math.max(ha, 0) + '" rx="5" fill="#7fd3ff"/>';
      svg += '<rect x="' + x + '" y="' + (base - ha - hg) + '" width="' + bw + '" height="' + Math.max(hg, 0) + '" rx="5" fill="#ff7a1a"/>';
      svg += '<text x="' + (x + bw / 2) + '" y="' + (base - ha - hg - 5) + '" text-anchor="middle" font-size="11" fill="#f4f1ec" font-family="Inter">' + moneyShort(a + g) + '</text>';
      svg += '<text x="' + (x + bw / 2) + '" y="' + (H - 8) + '" text-anchor="middle" font-size="11" fill="#9b9aa6" font-family="Inter">' + monthLabel(k) + '</text>';
    });
    return '<svg class="chart" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Spend by month">' +
      '<line x1="0" x2="' + W + '" y1="' + (H - pb) + '" y2="' + (H - pb) + '" stroke="#2a2a33"/>' + svg + '</svg>' +
      '<div class="legend"><span><i class="dot tk"></i>Thanmayee/Karimulla</span><span><i class="dot gopi"></i>Gopi</span></div>';
  }
  function catBars(cats) {
    var keys = Object.keys(cats).sort(function (a, b) { return cats[b] - cats[a]; });
    if (!keys.length) return '<div class="empty">Nothing yet</div>';
    var max = cats[keys[0]] || 1, tot = sum(keys, function (k) { return cats[k]; });
    return keys.map(function (k, i) {
      return '<div class="cat-row"><div class="cat-top"><span>' + esc(k) + '</span><span><b>' + money(cats[k]) + '</b> <span class="muted">' +
        Math.round(cats[k] / tot * 100) + '%</span></span></div><div class="bar ' + (i % 2 ? 'fl' : '') + '"><i style="width:' + (cats[k] / max * 100).toFixed(1) + '%"></i></div></div>';
    }).join('');
  }
  function budgetBlock(c) {
    var b = state.settings.budgets || {}, keys = Object.keys(b);
    if (!keys.length) return '<div class="card"><div class="card-head"><h3>Budget vs actual</h3></div><p class="note" style="margin:0 0 12px">Set budgets per category to see how much is left.</p><button class="btn" data-go="settings">Set budgets</button></div>';
    var rows = keys.sort(function (x, y) { return x === 'TOTAL' ? -1 : y === 'TOTAL' ? 1 : x.localeCompare(y); }).map(function (k) {
      var actual = k === 'TOTAL' ? c.total : (c.cats[k] || 0);
      var ordered = k === 'TOTAL' ? c.unpaid : (c.committed[k] || 0);
      var used = actual + ordered, pct = b[k] ? used / b[k] * 100 : 0, left = b[k] - used;
      return '<div class="cat-row" data-budget="' + esc(k) + '"><div class="cat-top"><span>' + (k === 'TOTAL' ? '<b>Whole opening</b>' : esc(k)) + '</span><span><b>' + money(used) + '</b> <span class="muted">of ' + money(b[k]) + '</span></span></div>' +
        '<div class="bar ' + (pct > 100 ? 'over' : pct > 85 ? 'fl' : '') + '"><i style="width:' + Math.min(100, pct).toFixed(1) + '%"></i></div>' +
        '<div class="cat-top muted" style="font-size:12px"><span>' + (ordered ? 'incl. ' + money(ordered) + ' ordered, not paid' : '') + '</span><span class="' + (left < 0 ? 'flame' : '') + '">' + (left < 0 ? money(-left) + ' over' : money(left) + ' left') + '</span></div></div>';
    }).join('');
    return '<div class="card"><div class="card-head"><h3>Budget vs actual</h3><button class="link-btn" data-go="settings">Edit</button></div>' + rows + '</div>';
  }

  /* ---------------- HOME ---------------- */
  function renderHome() {
    var c = calc(), el = $('#view-home');
    var recent = state.spends.filter(real).sort(byDateDesc).slice(0, 5);
    el.innerHTML =
      '<div class="card hero"><div class="hero-label">Total invested</div>' +
      '<div class="hero-amount" data-test="total">' + money(c.total) + '</div>' +
      '<div class="hero-row"><span class="pill ice">Repaid <b data-test="repaid">' + money(c.repaid) + '</b></span>' +
      '<span class="pill flame">Still owed <b data-test="owed">' + money(c.outstanding) + '</b></span></div>' +
      ((c.unpaid || c.refundDue) ? '<div class="hero-row" style="margin-top:8px">' +
        (c.unpaid ? '<span class="pill warn">Ordered, not paid <b data-test="unpaid">' + money(c.unpaid) + '</b></span>' : '') +
        (c.refundDue ? '<span class="pill">Refunds due <b data-test="refund">' + money(c.refundDue) + '</b></span>' : '') + '</div>' : '') +
      '</div>' +
      '<div class="pots">' + POTS.map(function (p) { return potCard(p, c); }).join('') + '</div>' +
      (c.missing.length ? '<div class="card" id="missing-card"><div class="card-head"><h3>Missing a bill</h3><span class="pill warn" data-test="missing-count">' + c.missing.length + '</span></div><ul class="list">' +
        c.missing.slice(0, 4).map(function (s) { return spendItem(s); }).join('') + '</ul>' +
        (c.missing.length > 4 ? '<button class="btn" style="margin-top:8px" data-filter="nobill">See all ' + c.missing.length + '</button>' : '') + '</div>' : '') +
      '<div class="card"><div class="card-head"><h3>Recent spends</h3><button class="link-btn" data-go="spends">See all</button></div>' +
      (recent.length ? '<ul class="list">' + recent.map(function (s) { return spendItem(s, { billLinks: true }); }).join('') + '</ul>'
        : '<div class="empty"><b>No spends yet</b>Tap the orange + to add the first one.</div>') + '</div>' +
      '<div class="card"><h3>Spend by month</h3>' + monthChart(c.months) + '</div>' +
      '<div class="card"><h3>By category</h3>' + catBars(c.cats) + '</div>' +
      budgetBlock(c) +
      '<p class="note">' + c.entries + ' entries. The EXAMPLE row in the Sheet is never counted. “Ordered, not paid” is left out of totals until it is marked Paid.</p>';
    wireList(el);
    $$('[data-person]', el).forEach(function (b) { b.onclick = function () { state.person = b.getAttribute('data-person'); go('people'); }; });
    $$('[data-go]', el).forEach(function (b) { b.onclick = function () { go(b.getAttribute('data-go')); }; });
    $$('[data-filter]', el).forEach(function (b) { b.onclick = function () { state.filter = b.getAttribute('data-filter'); go('spends'); }; });
  }

  /* ---------------- SPENDS ---------------- */
  function renderSpends() {
    var el = $('#view-spends');
    var filters = [['all', 'All'], ['nobill', 'Missing bill'], ['Thanmayee/Karimulla', 'Thanmayee/Karimulla'], ['Gopi', 'Gopi'], ['unpaid', 'Unpaid'], ['refund', 'Refund due']];
    el.innerHTML = '<input class="search" id="q" type="search" placeholder="Search spends" value="' + esc(state.query) + '" autocomplete="off">' +
      '<div class="chips">' + filters.map(function (f) { return '<button type="button" class="chip' + (state.filter === f[0] ? ' on' : '') + '" data-f="' + esc(f[0]) + '">' + esc(f[1]) + '</button>'; }).join('') + '</div>' +
      '<div class="card" id="spend-list-card"></div>';
    function draw() {
      var q = state.query.toLowerCase();
      var list = state.spends.filter(real).filter(function (s) {
        var f = state.filter;
        if (f === 'nobill' && s.billLink) return false;
        if (f === 'unpaid' && s.status !== UNPAID) return false;
        if (f === 'refund' && s.status !== REFUND) return false;
        if (POTS.indexOf(f) >= 0 && s.spentBy !== f) return false;
        return !q || (s.title + ' ' + s.reason + ' ' + s.supplier + ' ' + s.category).toLowerCase().indexOf(q) >= 0;
      }).sort(byDateDesc);
      $('#spend-list-card').innerHTML = list.length ? '<div class="card-head"><h3>' + list.length + ' spend' + (list.length === 1 ? '' : 's') + '</h3><b>' + money(sum(list, function (s) { return s.amount; })) + '</b></div><ul class="list">' +
        list.map(function (s) { return spendItem(s, { billLinks: true }); }).join('') + '</ul>' : '<div class="empty"><b>Nothing here</b>Try another filter.</div>';
      wireList($('#spend-list-card'));
    }
    draw();
    $('#q').addEventListener('input', function (e) { state.query = e.target.value; draw(); });
    $$('.chip', el).forEach(function (c) { c.onclick = function () { state.filter = c.getAttribute('data-f'); $$('.chip', el).forEach(function (x) { x.classList.toggle('on', x === c); }); draw(); }; });
  }

  /* ---------------- PEOPLE ---------------- */
  function renderPeople() {
    var c = calc(), p = state.person, pc = c.pots[p], el = $('#view-people');
    var mine = state.spends.filter(real).filter(function (s) { return s.spentBy === p; }).sort(byDateDesc);
    var reps = state.repayments.filter(function (r) { return r.pot === p; }).sort(byDateDesc);
    var from = {}; mine.filter(counts).forEach(function (s) { var k = s.paidFrom || 'Not set'; from[k] = (from[k] || 0) + s.amount; });
    var share = c.total ? Math.round(pc.invested / c.total * 100) : 0;
    el.innerHTML = '<div class="seg">' + POTS.map(function (x) { return '<button type="button" data-pot="' + esc(x) + '" class="' + (x === p ? 'on' : '') + '">' + esc(potShort(x)) + '</button>'; }).join('') + '</div>' +
      '<div class="card hero"><div class="hero-label">' + esc(p) + ' · invested</div><div class="hero-amount" data-test="person-invested">' + money(pc.invested) + '</div>' +
      '<div class="hero-row"><span class="pill ice">Repaid <b data-test="person-repaid">' + money(pc.repaid) + '</b></span><span class="pill flame">Still owed <b data-test="person-owed">' + money(pc.outstanding) + '</b></span><span class="pill">' + share + '% of total</span></div>' +
      '<div class="bar ' + (p === 'Gopi' ? 'fl' : '') + '" style="margin-top:14px"><i style="width:' + (pc.invested ? Math.min(100, pc.repaid / pc.invested * 100) : 0).toFixed(1) + '%"></i></div>' +
      '<div class="note" style="margin:4px 0 0">' + (pc.invested ? Math.round(pc.repaid / pc.invested * 100) : 0) + '% paid back so far</div></div>' +
      (Object.keys(from).length ? '<div class="card"><h3>Paid from</h3>' + Object.keys(from).map(function (k) { return '<div class="stat-row"><span>' + esc(k) + '</span><b>' + money(from[k]) + '</b></div>'; }).join('') + '</div>' : '') +
      '<div class="card"><div class="card-head"><h3>Spends</h3><span class="muted">' + mine.length + '</span></div>' +
      (mine.length ? '<ul class="list">' + mine.map(function (s) { return spendItem(s, { hidePot: true, billLinks: true }); }).join('') + '</ul>' : '<div class="empty">No spends yet</div>') + '</div>' +
      '<div class="card"><div class="card-head"><h3>Repayments</h3><span class="muted">' + reps.length + '</span></div>' +
      (reps.length ? '<ul class="list">' + reps.map(repItem).join('') + '</ul>' : '<div class="empty">Nothing repaid yet</div>') + '</div>';
    $$('.seg button', el).forEach(function (b) { b.onclick = function () { state.person = b.getAttribute('data-pot'); renderPeople(); }; });
    wireList(el); wireRepList(el);
  }

  /* ---------------- REPAYMENTS ---------------- */
  function repItem(r) {
    return '<li class="item" data-rid="' + esc(r.id) + '"><span class="item-icon ' + potClass(r.pot) + '">↩</span>' +
      '<span class="item-main"><span class="item-title" style="display:block">' + esc(potShort(r.pot)) + '</span><span class="item-sub" style="display:block">' +
      esc([niceDate(r.date), r.note, r.addedBy ? 'added by ' + r.addedBy : ''].filter(Boolean).join(' · ')) + '</span></span><span class="item-amt">' + money(r.amount) + '</span>' +
      (canEdit(r) ? '<button type="button" class="bill-link" data-delrep="' + esc(r.id) + '" aria-label="Delete repayment" style="color:var(--muted)">✕</button>' : '') + '</li>';
  }
  function wireRepList(root) {
    $$('[data-delrep]', root).forEach(function (b) {
      b.onclick = function () {
        var r = state.repayments.filter(function (x) { return x.id === b.getAttribute('data-delrep'); })[0]; if (!r) return;
        confirmBox('Delete repayment?', money(r.amount) + ' to ' + r.pot + ' on ' + niceDate(r.date) + '. This cannot be undone.').then(function (ok) {
          if (!ok) return; busy(true, 'Deleting…');
          FFApi.deleteRepayment(r.id).then(function () {
            state.repayments = state.repayments.filter(function (x) { return x.id !== r.id; }); busy(false); toast('Repayment deleted'); render();
          }, fail);
        });
      };
    });
  }
  function renderRepay() {
    var c = calc(), el = $('#view-repay'), reps = state.repayments.slice().sort(byDateDesc);
    el.innerHTML = '<div class="pots">' + POTS.map(function (p) {
      return '<div class="pot"><div class="pot-name"><span class="dot ' + potClass(p) + '"></span>' + esc(potShort(p)) + '</div><div class="pot-amt">' + money(c.pots[p].outstanding) + '</div><div class="pot-line"><span>still owed</span></div></div>';
    }).join('') + '</div>' +
      '<div class="card"><h3>Record a repayment</h3><p class="note" style="margin-top:-4px">When the business pays someone back.</p>' +
      '<form class="form" id="rep-form" novalidate>' +
      '<div class="field"><span class="lbl">Paid back to</span><div class="choice" id="rep-pot">' + POTS.map(function (p, i) { return '<button type="button" data-v="' + esc(p) + '" class="' + (i === 0 ? 'on' : '') + (p === 'Gopi' ? ' gopi' : '') + '">' + esc(potShort(p)) + '</button>'; }).join('') + '</div></div>' +
      '<div class="field"><label for="rep-amount">Amount</label><div class="money"><span>£</span><input class="input" id="rep-amount" inputmode="decimal" placeholder="0.00" autocomplete="off"></div></div>' +
      '<div class="field"><label for="rep-date">Date</label><input class="input" id="rep-date" type="date" value="' + today() + '"></div>' +
      '<div class="field"><label for="rep-note">Note <span class="opt">(optional)</span></label><input class="input" id="rep-note" placeholder="e.g. Bank transfer, first month"></div>' +
      '<div class="err" id="rep-err"></div><button class="btn btn-ice" type="submit" id="rep-save">Save repayment</button></form></div>' +
      '<div class="card"><div class="card-head"><h3>History</h3><span class="muted">' + money(c.repaid) + '</span></div>' +
      (reps.length ? '<ul class="list" id="rep-list">' + reps.map(repItem).join('') + '</ul>' : '<div class="empty">No repayments yet</div>') + '</div>';
    var pot = POTS[0];
    $$('#rep-pot button', el).forEach(function (b) { b.onclick = function () { pot = b.getAttribute('data-v'); $$('#rep-pot button', el).forEach(function (x) { x.classList.toggle('on', x === b); }); }; });
    $('#rep-form').addEventListener('submit', function (ev) {
      ev.preventDefault();
      var amt = parseAmount($('#rep-amount').value);
      if (!(amt > 0)) { $('#rep-err').textContent = 'Enter how much was paid back'; $('#rep-amount').classList.add('invalid'); return; }
      if (amt > c.pots[pot].outstanding + 0.001) {
        // allowed, but say so
        if (!window.__ffAllowOverpay) { $('#rep-err').textContent = 'That is more than ' + potShort(pot) + ' is owed (' + money(c.pots[pot].outstanding) + '). Tap Save again to record it anyway.'; window.__ffAllowOverpay = true; return; }
      }
      window.__ffAllowOverpay = false;
      busy(true);
      FFApi.addRepayment({ pot: pot, amount: amt, date: $('#rep-date').value || today(), note: $('#rep-note').value.trim() }).then(function (r) {
        state.repayments.push(r.repayment); busy(false); toast('Repayment saved'); renderRepay();
      }, fail);
    });
    wireRepList(el);
  }

  /* ---------------- SETTINGS ---------------- */
  function renderSettings() {
    var el = $('#view-settings'), b = state.settings.budgets || {};
    el.innerHTML = '<div class="card"><h3>Budgets</h3><p class="note" style="margin-top:-4px">Optional. Leave blank for no budget.</p><form class="form" id="bud-form">' +
      '<div class="field"><label for="bud-TOTAL">Whole opening budget</label><div class="money"><span>£</span><input class="input" id="bud-TOTAL" data-k="TOTAL" inputmode="decimal" value="' + (b.TOTAL || '') + '"></div></div>' +
      CATEGORIES.map(function (k) { return '<div class="field"><label for="bud-' + k.replace(/\W/g, '') + '">' + esc(k) + '</label><input class="input" id="bud-' + k.replace(/\W/g, '') + '" data-k="' + esc(k) + '" inputmode="decimal" placeholder="£" value="' + (b[k] || '') + '"></div>'; }).join('') +
      '<button class="btn btn-ice" type="submit">Save budgets</button></form></div>' +
      '<div class="card"><h3>Change my PIN</h3><p class="note" style="margin-top:-4px">Signed in as <b data-test="me">' + esc(state.me ? state.me.user : '') + '</b>' + (state.me && state.me.isAdmin ? ' (admin)' : '') + '. You can only change your own PIN. Never share it.</p><form class="form" id="pin-form" autocomplete="off">' +
      '<div class="field"><label for="pin-old">Current PIN</label><input class="input" id="pin-old" type="password" inputmode="numeric" maxlength="8"></div>' +
      '<div class="field"><label for="pin-new">New PIN (4–8 digits)</label><input class="input" id="pin-new" type="password" inputmode="numeric" maxlength="8"></div>' +
      '<div class="err" id="pin-err"></div><button class="btn" type="submit">Change PIN</button></form></div>' +
      '<div class="card"><h3>This phone</h3><p class="note" style="margin-top:-4px">Locking signs this phone out. Your data stays in the Google Sheet.</p><button class="btn" id="btn-lock">Lock / switch person</button></div>' +
      '<p class="note">Data lives in the “Frost &amp; Flame – Investment Tracker” Google Sheet. Bills go to the Bills folder in Google Drive. Nothing is stored on this phone except the unlock key.</p>';
    $('#bud-form').addEventListener('submit', function (ev) {
      ev.preventDefault(); var out = {};
      $$('[data-k]', $('#bud-form')).forEach(function (i) { var v = parseAmount(i.value); if (v > 0) out[i.getAttribute('data-k')] = v; });
      busy(true); FFApi.saveSettings({ budgets: out }).then(function (r) { state.settings = r.settings; busy(false); toast('Budgets saved'); }, fail);
    });
    $('#pin-form').addEventListener('submit', function (ev) {
      ev.preventDefault(); var o = $('#pin-old').value, n = $('#pin-new').value;
      if (!/^\d{4,8}$/.test(n)) { $('#pin-err').textContent = 'New PIN must be 4–8 digits'; return; }
      if (o === n) { $('#pin-err').textContent = 'Choose a different PIN'; return; }
      busy(true); FFApi.changePin(o, n).then(function () { busy(false); toast('PIN changed'); $('#pin-old').value = $('#pin-new').value = ''; $('#pin-err').textContent = ''; },
        function (e) { busy(false); $('#pin-err').textContent = e.message; });
    });
    $('#btn-lock').onclick = function () { FFApi.logout(); showLock('Locked'); };
  }

  /* ---------------- spend detail ---------------- */
  function findSpend(id) { return state.spends.filter(function (s) { return s.id === id; })[0]; }
  function spendDetail(id) {
    var s = findSpend(id); if (!s) return;
    openSheet('Spend', '<div class="muted" style="font-size:13px">' + esc(niceDate(s.date)) + '</div>' +
      '<h2 style="font-size:30px;margin:4px 0 10px">' + esc(s.title) + '</h2><div class="detail-amt ' + (s.spentBy === 'Gopi' ? 'flame' : 'ice') + '">' + money(s.amount) + '</div>' +
      '<dl class="detail-grid"><dt>Spent by</dt><dd>' + esc(s.spentBy) + '</dd>' +
      '<dt>Status</dt><dd>' + esc(s.status || 'Paid') + '</dd>' +
      (s.category ? '<dt>Category</dt><dd>' + esc(s.category) + '</dd>' : '') +
      (s.paidFrom ? '<dt>Paid from</dt><dd>' + esc(s.paidFrom) + '</dd>' : '') +
      (s.supplier ? '<dt>Supplier</dt><dd>' + esc(s.supplier) + '</dd>' : '') +
      (s.reason ? '<dt>Reason</dt><dd>' + esc(s.reason) + '</dd>' : '') +
      '<dt>Added by</dt><dd data-test="added-by">' + esc(s.addedBy || 'Typed in the Sheet') + (s.createdAt ? ' <span class="who">· ' + esc(niceDate(s.createdAt.slice(0, 10))) + '</span>' : '') + '</dd>' +
      (s.editedBy ? '<dt>Last edited by</dt><dd data-test="edited-by">' + esc(s.editedBy) + (s.updatedAt ? ' <span class="who">· ' + esc(niceDate(s.updatedAt.slice(0, 10))) + '</span>' : '') + '</dd>' : '') + '</dl>' +
      (s.billLink ? '<button class="btn btn-ice" id="d-bill" style="margin-bottom:10px">View bill</button>' : '<div class="pill warn" style="margin-bottom:14px">No bill yet – tap Edit to add a photo</div>') +
      (s.example ? '<p class="note">This is the EXAMPLE row from the Sheet. It is not counted.</p>' : '') +
      (canEdit(s) ? '<div class="btn-row"><button class="btn" id="d-edit">Edit</button><button class="btn" id="d-del" style="color:var(--danger)">Delete</button></div>'
        : '<p class="perm-note" id="d-perm">Only ' + esc(s.addedBy || 'the person who added it') + ' or Karimulla can edit or delete this.</p>'),
      function (root) {
        if ($('#d-bill', root)) $('#d-bill', root).onclick = function () { viewBill(s.id); };
        if (!canEdit(s)) return;
        $('#d-edit', root).onclick = function () { spendForm(s); };
        $('#d-del', root).onclick = function () {
          confirmBox('Delete this spend?', s.title + ' · ' + money(s.amount) + (s.billLink ? '. Its bill goes to the Drive bin.' : '.') + ' This cannot be undone here.').then(function (ok) {
            if (!ok) return; busy(true, 'Deleting…');
            FFApi.deleteSpend(s.id).then(function () {
              state.spends = state.spends.filter(function (x) { return x.id !== s.id; }); busy(false); closeSheet(); toast('Spend deleted'); render();
            }, fail);
          });
        };
      });
  }

  function viewBill(id) {
    busy(true, 'Opening bill…');
    FFApi.getBill(id).then(function (r) {
      busy(false); var src = 'data:' + r.mime + ';base64,' + r.data, body = $('#viewer-body');
      body.innerHTML = r.mime === 'application/pdf' ? '<iframe title="Bill"></iframe>' : '<img alt="Bill">';
      body.firstChild.src = src;
      var s = findSpend(id); $('#viewer-open').href = (s && s.billLink) || r.url || '#';
      $('#viewer').hidden = false;
    }, fail);
  }
  $('#viewer-close').onclick = function () { $('#viewer').hidden = true; $('#viewer-body').innerHTML = ''; };

  /* ---------------- add / edit form ---------------- */
  function parseAmount(v) { var n = Number(String(v || '').replace(/[£,\s]/g, '')); return isNaN(n) ? 0 : Math.round(n * 100) / 100; }
  function choiceHtml(id, opts, val, cls) {
    return '<div class="choice' + (cls ? ' ' + cls : '') + '" id="' + id + '">' + opts.map(function (o) {
      return '<button type="button" data-v="' + esc(o) + '" class="' + (o === val ? 'on' : '') + (o === 'Gopi' ? ' gopi' : '') + '">' + esc(o) + '</button>';
    }).join('') + '</div>';
  }
  function spendForm(s) {
    var edit = !!s;
    var myPot = state.me ? (state.me.user === 'Gopi' ? 'Gopi' : 'Thanmayee/Karimulla') : '';
    s = s || { date: today(), status: 'Paid', spentBy: myPot, paidFrom: '', category: '' };
    var bill = null, removeBill = false;
    openSheet(edit ? 'Edit spend' : 'Add spend',
      '<form class="form" id="sp-form" novalidate>' +
      '<div class="field"><label for="sp-amount">Amount</label><div class="money"><span>£</span><input class="input" id="sp-amount" inputmode="decimal" placeholder="0.00" autocomplete="off" value="' + (edit ? s.amount.toFixed(2) : '') + '"></div></div>' +
      '<div class="field"><label for="sp-title">What was it?</label><input class="input" id="sp-title" placeholder="e.g. Display freezer" maxlength="200" value="' + esc(s.title || '') + '"></div>' +
      '<div class="field"><span class="lbl">Spent by</span>' + choiceHtml('sp-by', POTS, s.spentBy) + '</div>' +
      '<div class="field"><label for="sp-date">Date</label><input class="input" id="sp-date" type="date" value="' + esc(s.date || today()) + '"></div>' +
      '<div class="field"><span class="lbl">Bill / invoice photo <span class="opt">(optional)</span></span>' +
      '<div class="photo-row"><label class="btn btn-ice" style="display:flex;align-items:center;justify-content:center">📷 Camera<input type="file" id="sp-cam" accept="image/*" capture="environment" hidden></label>' +
      '<label class="btn" style="display:flex;align-items:center;justify-content:center">Gallery / PDF<input type="file" id="sp-file" accept="image/*,application/pdf" hidden></label></div>' +
      '<div id="sp-prev"></div></div>' +
      '<div class="field"><label for="sp-reason">Reason / description <span class="opt">(optional)</span></label><textarea class="input" id="sp-reason" maxlength="2000" placeholder="Why we bought it">' + esc(s.reason || '') + '</textarea></div>' +
      '<div class="field"><label for="sp-cat">Category <span class="opt">(optional)</span></label><select class="input" id="sp-cat"><option value="">Choose…</option>' + CATEGORIES.map(function (c) { return '<option' + (c === s.category ? ' selected' : '') + '>' + esc(c) + '</option>'; }).join('') + '</select></div>' +
      '<div class="field"><span class="lbl">Paid from <span class="opt">(optional)</span></span>' + choiceHtml('sp-from', PAID_FROM, s.paidFrom, 'three') + '</div>' +
      '<div class="field"><span class="lbl">Status</span>' + choiceHtml('sp-status', STATUSES, s.status || 'Paid', 'three') + '</div>' +
      '<div class="field"><label for="sp-supplier">Supplier <span class="opt">(optional)</span></label><input class="input" id="sp-supplier" maxlength="200" placeholder="e.g. Nisbets" value="' + esc(s.supplier || '') + '"></div>' +
      '<div class="err" id="sp-err"></div>' +
      '<button class="btn btn-primary" type="submit" id="sp-save">' + (edit ? 'Save changes' : 'Save spend') + '</button></form>',
      function (root) {
        var picked = { 'sp-by': s.spentBy || '', 'sp-from': s.paidFrom || '', 'sp-status': s.status || 'Paid' };
        ['sp-by', 'sp-from', 'sp-status'].forEach(function (id) {
          $$('#' + id + ' button', root).forEach(function (b) {
            b.onclick = function () {
              var v = b.getAttribute('data-v');
              if (id === 'sp-from' && picked[id] === v) { picked[id] = ''; b.classList.remove('on'); return; } // optional: tap again to clear
              picked[id] = v; $$('#' + id + ' button', root).forEach(function (x) { x.classList.toggle('on', x === b); });
            };
          });
        });
        function drawPrev() {
          var p = $('#sp-prev', root);
          if (bill) {
            p.innerHTML = '<div class="photo-prev">' + (bill.mime === 'application/pdf' ? '<div class="pdf">PDF</div>' : '<img alt="Bill preview" src="data:' + bill.mime + ';base64,' + bill.data + '">') +
              '<div style="flex:1"><b>New bill ready</b><div class="muted" style="font-size:13px">' + Math.round(bill.bytes / 1024) + ' KB · saves with the spend</div></div><button type="button" class="link-btn" id="sp-unpick">Remove</button></div>';
            $('#sp-unpick', root).onclick = function () { bill = null; drawPrev(); };
          } else if (edit && s.billLink && !removeBill) {
            p.innerHTML = '<div class="photo-prev"><div class="pdf" style="background:var(--ice-dim);color:var(--ice)">✓</div><div style="flex:1"><b>Bill saved</b><div class="muted" style="font-size:13px">Pick a new one to replace it</div></div><button type="button" class="link-btn" id="sp-rm">Remove</button></div>';
            $('#sp-rm', root).onclick = function () { removeBill = true; drawPrev(); };
          } else if (removeBill) {
            p.innerHTML = '<div class="photo-prev"><div style="flex:1" class="muted">Bill will be removed when you save</div><button type="button" class="link-btn" id="sp-undo">Undo</button></div>';
            $('#sp-undo', root).onclick = function () { removeBill = false; drawPrev(); };
          } else p.innerHTML = '';
        }
        drawPrev();
        function onFile(ev) {
          var f = ev.target.files && ev.target.files[0]; ev.target.value = ''; if (!f) return;
          $('#sp-err', root).textContent = '';
          prepareBill(f).then(function (b) { bill = b; removeBill = false; drawPrev(); }, function (e) { $('#sp-err', root).textContent = e.message; });
        }
        $('#sp-cam', root).addEventListener('change', onFile);
        $('#sp-file', root).addEventListener('change', onFile);
        $('#sp-form', root).addEventListener('submit', function (ev) {
          ev.preventDefault();
          var data = {
            amount: parseAmount($('#sp-amount', root).value), title: $('#sp-title', root).value.trim(), spentBy: picked['sp-by'],
            date: $('#sp-date', root).value || today(), reason: $('#sp-reason', root).value.trim(), category: $('#sp-cat', root).value,
            paidFrom: picked['sp-from'], status: picked['sp-status'] || 'Paid', supplier: $('#sp-supplier', root).value.trim()
          };
          $$('.invalid', root).forEach(function (x) { x.classList.remove('invalid'); });
          var err = !(data.amount > 0) ? ['sp-amount', 'Enter the amount'] : !data.title ? ['sp-title', 'Say what it was'] : !data.spentBy ? ['sp-by', 'Choose who spent it'] : null;
          if (err) { $('#sp-err', root).textContent = err[1]; var f = $('#' + err[0], root); f.classList.add('invalid'); f.scrollIntoView({ block: 'center', behavior: 'smooth' }); return; }
          $('#sp-err', root).textContent = '';
          busy(true, bill ? 'Saving with bill…' : 'Saving…');
          var payload = bill ? { mime: bill.mime, data: bill.data, name: bill.name } : null;
          (edit ? FFApi.updateSpend(s.id, data, payload, removeBill) : FFApi.addSpend(data, payload)).then(function (r) {
            if (edit) state.spends = state.spends.map(function (x) { return x.id === s.id ? r.spend : x; });
            else state.spends.push(r.spend);
            busy(false); closeSheet(); toast(edit ? 'Changes saved' : 'Spend saved'); render();
          }, fail);
        });
        if (!edit) setTimeout(function () { try { $('#sp-amount', root).focus(); } catch (e) {} }, 250);
      });
  }

  /* ---------------- photo: resize in the browser ---------------- */
  var MAX_SIDE = 1600, QUALITY = 0.82;
  function readAsDataURL(blob) {
    return new Promise(function (res, rej) { var r = new FileReader(); r.onload = function () { res(r.result); }; r.onerror = function () { rej(new Error('Could not read the file')); }; r.readAsDataURL(blob); });
  }
  function loadImage(file) {
    return new Promise(function (res, rej) {
      var url = URL.createObjectURL(file), img = new Image();
      img.onload = function () { res({ img: img, done: function () { URL.revokeObjectURL(url); } }); };
      img.onerror = function () { URL.revokeObjectURL(url); rej(new Error('That photo type could not be opened. Try a JPG or PNG.')); };
      img.src = url;
    });
  }
  function prepareBill(file) {
    if (file.type === 'application/pdf') {
      if (file.size > 6 * 1024 * 1024) return Promise.reject(new Error('PDF is too big (max 6 MB)'));
      return readAsDataURL(file).then(function (d) { return { mime: 'application/pdf', data: d.split(',')[1], bytes: file.size, name: file.name }; });
    }
    if (!/^image\//.test(file.type) && !/\.(jpe?g|png|heic|heif|webp)$/i.test(file.name)) return Promise.reject(new Error('Please choose a photo or a PDF'));
    return loadImage(file).then(function (o) {
      var w = o.img.naturalWidth, h = o.img.naturalHeight, k = Math.min(1, MAX_SIDE / Math.max(w, h));
      var c = document.createElement('canvas'); c.width = Math.round(w * k); c.height = Math.round(h * k);
      var ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height); ctx.drawImage(o.img, 0, 0, c.width, c.height); o.done();
      var d = c.toDataURL('image/jpeg', QUALITY), b64 = d.split(',')[1];
      return { mime: 'image/jpeg', data: b64, bytes: Math.round(b64.length * 0.75), name: (file.name || 'bill').replace(/\.\w+$/, '') + '.jpg', width: c.width, height: c.height };
    });
  }

  /* ---------------- online / offline ---------------- */
  function netState() { $('#offline-bar').hidden = navigator.onLine; document.body.classList.toggle('is-offline', !navigator.onLine); }
  window.addEventListener('online', function () { netState(); if (!$('#app').hidden) load(true); });
  window.addEventListener('offline', netState);
  netState();

  /* ---------------- start ---------------- */
  drawDots(); state.me = null;
  if (FFApi.hasToken()) { showApp(); go('home'); load(); } else showLock();
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    window.addEventListener('load', function () { navigator.serviceWorker.register('sw.js').catch(function () {}); });
  }
})();
