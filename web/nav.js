'use strict';
// Link from a game back to the hub. Games are also published as standalone pages (claude.ai artifacts)
// where there is no hub, so the link only appears once the Go server answers /healthz.
(function (root) {
  const I18n = root.I18n;
  if (I18n) I18n.add({ ro: { '← Игры': '← Jocuri', 'Ко всем играм': 'La toate jocurile' } });
  const t = (s) => (I18n ? I18n.t(s) : s);

  let served = null;
  function onServer() {
    if (!served) {
      served = fetch('../healthz', { cache: 'no-store' })
        .then((r) => r.ok && r.text())
        .then((txt) => !!txt && txt.trim() === 'ok')
        .catch(() => false);
    }
    return served;
  }

  // Returns a hidden <a> styled with the given class; it shows itself when the hub is reachable.
  function home(className) {
    const a = root.document.createElement('a');
    a.href = '../';
    a.className = `${className || ''} home-link`.trim();
    a.textContent = t('← Игры');
    a.title = t('Ко всем играм');
    a.setAttribute('aria-label', t('Ко всем играм'));
    a.setAttribute('data-i18n-skip', '');
    a.style.display = 'none';
    a.style.textDecoration = 'none';
    a.style.whiteSpace = 'nowrap';
    onServer().then((ok) => {
      if (!ok) return;
      a.style.display = '';
      // Inline elements styled as buttons need flex to center their text like the buttons next to them.
      if (getComputedStyle(a).display === 'inline') a.style.display = 'inline-flex';
      a.style.alignItems = 'center';
      a.style.justifyContent = 'center';
    });
    return a;
  }

  root.GameNav = { home, onServer };
})(typeof self !== 'undefined' ? self : this);
