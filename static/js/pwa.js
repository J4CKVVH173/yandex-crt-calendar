(() => {
  'use strict';
  const preview = window.self !== window.top || new URLSearchParams(location.search).has('preview');
  if (preview) return;
  const standalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  const manifest = document.querySelector('link[rel="manifest"]');
  const setToken = token => { manifest.href = '/manifest.webmanifest?t=' + encodeURIComponent(token); };
  window.YacalPWA = {setToken};
  const display = location.pathname.match(/^\/d\/([^/]+)$/);
  if (display) setToken(decodeURIComponent(display[1]));
  if ('serviceWorker' in navigator && window.isSecureContext) {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }
  const panel = document.createElement('aside');
  panel.id = 'pwa-install';
  panel.hidden = true;
  panel.setAttribute('aria-label', 'Установка календаря');
  panel.innerHTML = '<span>Календарь отдельным приложением</span><button type="button" data-install>Установить</button><button type="button" data-dismiss aria-label="Скрыть предложение установки">×</button>';
  document.body.append(panel);
  let prompt = null, dismissed = false;
  try { dismissed = sessionStorage.getItem('yacal-install-dismissed') === '1'; } catch (_) {}
  const install = panel.querySelector('[data-install]');
  panel.querySelector('[data-dismiss]').onclick = () => {
    dismissed = true;
    panel.hidden = true;
    try { sessionStorage.setItem('yacal-install-dismissed', '1'); } catch (_) {}
  };
  window.addEventListener('beforeinstallprompt', event => {
    if (standalone()) return;
    event.preventDefault();
    prompt = event;
    if (!dismissed) panel.hidden = false;
  });
  install.onclick = async () => {
    if (!prompt) return;
    const pending = prompt;
    prompt = null;
    install.disabled = true;
    try {
      await pending.prompt();
      await pending.userChoice;
    } catch (_) {
      // Browser controls whether installation can be offered again.
    } finally {
      panel.hidden = true;
      install.disabled = false;
    }
  };
  window.addEventListener('appinstalled', () => { prompt = null; panel.hidden = true; });
  matchMedia('(display-mode: standalone)').addEventListener('change', () => {
    if (standalone()) panel.hidden = true;
  });
})();
