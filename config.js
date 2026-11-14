// Where the app sends its requests.
//  - On the box (mock backend / local tests): "/api"
//  - Live: the Apps Script web-app URL
(function () {
  var LIVE = 'https://script.google.com/macros/s/AKfycbx1u29KK_v6g5tKZBgyN2wWzZvcV6cCP3ltM0wvVt1vtQLZTWXUufzABsLeTkYYFcvCZA/exec';
  var host = (typeof location !== 'undefined' && location.hostname) || '';
  var local = host === 'localhost' || host === '127.0.0.1';
  window.FF_CONFIG = { API_URL: local ? '/api' : LIVE };
})();
