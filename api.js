/* The ONE module that talks to the backend (Apps Script web app, or the mock on the box).
 * Every call: POST, Content-Type text/plain (no CORS preflight), JSON body {action, token, ...}.
 * Only the session token is kept on the phone (localStorage). No spend data is stored or cached. */
(function () {
  var TOKEN_KEY = 'ff_tracker_token';
  var onAuthLost = function () {};

  function getToken() { try { return localStorage.getItem(TOKEN_KEY) || ''; } catch (e) { return ''; } }
  function setToken(t) { try { t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY); } catch (e) {} }

  function ApiError(code, message, extra) {
    var e = new Error(message || code); e.code = code; e.extra = extra || {}; return e;
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
    changePin: function (oldPin, newPin) { return call('changePin', { oldPin: oldPin, newPin: newPin }); }
  };
})();
