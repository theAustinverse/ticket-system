// Turns the Google Fonts <link media="print"> into a normal stylesheet once it
// has loaded, so the web fonts never block first paint. This used to be an
// inline `onload="this.media='all'"` handler on the <link>, which a strict
// Content-Security-Policy (no inline script) would block.
(function () {
  var link = document.getElementById('webfonts');
  if (!link) return;
  function show() {
    link.media = 'all';
  }
  if (link.sheet) show();
  else link.addEventListener('load', show);
})();
