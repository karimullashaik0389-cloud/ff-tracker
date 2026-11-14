/* The ONE module that talks to the backend (Apps Script web app, or the mock on the box).
 * Every call: POST, Content-Type text/plain (no CORS preflight), JSON body {action, token, ...}.
 * Session token is kept on the phone (localStorage). Spend data is never cached.
 * Daily tasks: the last successful list is cached for offline reading; ticks are queued and retried. */
(function () {
  var TOKEN_KEY = 'ff_tracker_token';
  var TASKS_CACHE_KEY = 'ff_tasks_cache';
  var TICK_QUEUE_KEY = 'ff_tick_queue';
  var onAuthLost = function () {};

  function getToken() { try { return localStorage.getItem(TOKEN_KEY) || ''; } catch (e) { return ''; } }
  function setToken(t) { try { t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY); } catch (e) {} }

  function ApiError(code, message, extra) {
    var e = new Error(message || code); e.code = code; e.extra = extra || {}; return e;
  }

  function readJson(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key) || 'null') || fallback; } catch (e) { return fallback; }
  }
  function writeJson(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) {}
  }

  function call(action, params, opts) {
    opts = opts || {};
    var body = Object.assign({ action: action, token: getToken() }, params || {});
    if (!navigator.onLine) return Promise.reject(ApiError('offline', "You're offline. Connect to the internet and try again."));
    var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, opts.timeout || 60000) : null;
    return fetch(window.FF_CONFIG.API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(body),
      redirect: 'follow',
      cache: 'no-store',
      credentials: 'omit',
      signal: ctrl ? ctrl.signal : undefined
    }).then(function (r) {
      if (!r.ok) throw ApiError('http', 'Server error (' + r.status + '). Please try again.');
      return r.json();
    }, function (err) {
      throw ApiError(navigator.onLine ? 'network' : 'offline',
        navigator.onLine ? 'Could not reach the server. Please try again.' : "You're offline. Connect and try again.");
    }).then(function (res) {
      if (timer) clearTimeout(timer);
      if (!res || res.ok !== true) {
        if (res && (res.error === 'auth' || res.error === 'must_change_pin')) { setToken(''); onAuthLost(res.message); }
        throw ApiError((res && res.error) || 'unknown', (res && res.message) || 'Something went wrong', res);
      }
      return res;
    }, function (e) { if (timer) clearTimeout(timer); throw e; });
  }

  function cacheTasks(res) {
    if (!res || !res.ok) return res;
    writeJson(TASKS_CACHE_KEY, { user: res.me && res.me.user, saved: Date.now(), data: res });
    return res;
  }
  function cachedTasks(user) {
    var c = readJson(TASKS_CACHE_KEY, null);
    if (!c || !c.data) return null;
    if (user && c.user && c.user !== user) return null;
    var d = c.data;
    d.cached = true;
    return d;
  }
  function applyTickToCache(id, done, me) {
    var c = readJson(TASKS_CACHE_KEY, null);
    if (!c || !c.data || !c.data.tasks) return null;
    var task = null;
    c.data.tasks = c.data.tasks.map(function (t) {
      if (t.id !== id) return t;
      task = Object.assign({}, t, { done: !!done, status: done ? 'Done' : 'Not started', pending: true });
      return task;
    });
    if (c.data.people) {
      c.data.people = c.data.people.map(function (p) {
        var list = c.data.tasks.filter(function (t) {
          return String(t.owner || '').trim().toLowerCase() === String(p.user || '').trim().toLowerCase();
        });
        return Object.assign({}, p, { total: list.length, done: list.filter(function (t) { return t.done; }).length });
      });
    }
    writeJson(TASKS_CACHE_KEY, c);
    return task;
  }
  function getQueue() { return readJson(TICK_QUEUE_KEY, []); }
  function setQueue(q) { writeJson(TICK_QUEUE_KEY, q); }
  function enqueueTick(id, done, taskName) {
    var q = getQueue().filter(function (x) { return x.id !== id; });
    q.push({ id: id, done: !!done, task: taskName || '', at: Date.now() });
    setQueue(q);
  }

  var flushing = false;
  function flushTicks() {
    if (flushing || !navigator.onLine) return Promise.resolve();
    var q = getQueue();
    if (!q.length) return Promise.resolve();
    flushing = true;
    function next(i) {
      if (i >= q.length) { setQueue([]); flushing = false; return Promise.resolve(); }
      var item = q[i];
      return call('setTaskDone', { id: item.id, done: item.done, task: item.task }).then(function () {
        return next(i + 1);
      }, function (e) {
        if (e && (e.code === 'offline' || e.code === 'network')) {
          setQueue(q.slice(i)); flushing = false; return Promise.reject(e);
        }
        // stale/not_found: drop that tick and continue
        return next(i + 1);
      });
    }
    return next(0).then(function () { flushing = false; }, function (e) { flushing = false; throw e; });
  }

  window.FFApi = {
    hasToken: function () { return !!getToken(); },
    onAuthLost: function (fn) { onAuthLost = fn; },
    // user = 'Karimulla' | 'Thanmayee' | 'Gopi'. Each person has their own PIN.
    login: function (user, pin) {
      return call('login', { user: user, pin: pin }).then(function (r) { setToken(r.token); return r; });
    },
    logout: function () {
      var p = call('logout').catch(function () {});
      setToken('');
      try { localStorage.removeItem(TASKS_CACHE_KEY); localStorage.removeItem(TICK_QUEUE_KEY); } catch (e) {}
      return p;
    },
    data: function () { return call('data'); },
    addSpend: function (spend, bill) { return call('addSpend', { spend: spend, bill: bill || null }, { timeout: 120000 }); },
    updateSpend: function (id, spend, bill, removeBill) {
      return call('updateSpend', { id: id, spend: spend, bill: bill || null, removeBill: !!removeBill }, { timeout: 120000 });
    },
    deleteSpend: function (id) { return call('deleteSpend', { id: id }); },
    getBill: function (id) { return call('getBill', { id: id }); },
    addRepayment: function (rep) { return call('addRepayment', { repayment: rep }); },
    deleteRepayment: function (id) { return call('deleteRepayment', { id: id }); },
    saveSettings: function (settings) { return call('saveSettings', { settings: settings }); },
    changePin: function (oldPin, newPin) { return call('changePin', { oldPin: oldPin, newPin: newPin }); },
    tasks: function () {
      return flushTicks().catch(function () {}).then(function () { return call('tasks'); }).then(cacheTasks, function (e) {
        if (e && (e.code === 'offline' || e.code === 'network' || e.code === 'http')) {
          var c = cachedTasks();
          if (c) return c;
        }
        throw e;
      });
    },
    setTaskDone: function (id, done, taskName) {
      if (!navigator.onLine) {
        enqueueTick(id, done, taskName);
        var t = applyTickToCache(id, done);
        return Promise.resolve({ ok: true, queued: true, task: t || { id: id, done: !!done } });
      }
      return call('setTaskDone', { id: id, done: !!done, task: taskName || '' }).then(function (r) {
        // keep cache in sync so a later offline open is fresh
        var c = readJson(TASKS_CACHE_KEY, null);
        if (c && c.data && c.data.tasks && r.task) {
          c.data.tasks = c.data.tasks.map(function (t) { return t.id === r.task.id ? Object.assign({}, t, r.task, { pending: false }) : t; });
          writeJson(TASKS_CACHE_KEY, c);
        }
        return r;
      }, function (e) {
        if (e && (e.code === 'offline' || e.code === 'network')) {
          enqueueTick(id, done, taskName);
          var t = applyTickToCache(id, done);
          return { ok: true, queued: true, task: t || { id: id, done: !!done } };
        }
        throw e;
      });
    },
    setTaskOwner: function (id, owner) { return call('setTaskOwner', { id: id, owner: owner }); },
    flushTicks: flushTicks,
    clearLocalData: function () {
      try { localStorage.removeItem(TASKS_CACHE_KEY); localStorage.removeItem(TICK_QUEUE_KEY); } catch (e) {}
    }
  };
})();
