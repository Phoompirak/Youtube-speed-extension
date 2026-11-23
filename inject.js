(() => {
  'use strict';

  const NONCE = document.currentScript?.dataset?.nonce || '';
  if (!NONCE) return;

  function executeJsUrl(codeStr) {
    let clean = String(codeStr || '').replace(/^javascript:/i, '').trim();
    clean = clean.replace(/;$/, '').trim();

    // Parse simple function call e.g. "window.ad.skip()" or "ad.skip()"
    const match = clean.match(/^([a-zA-Z0-9_$.]+)\s*\(\s*\)$/);
    if (match) {
      const path = match[1];
      const parts = path.split('.');
      let obj = window;
      for (let i = 0; i < parts.length - 1; i++) {
        const part = parts[i];
        if (part === 'window') continue;
        obj = obj[part];
        if (!obj) break;
      }

      const funcName = parts[parts.length - 1];
      if (obj && typeof obj[funcName] === 'function') {
        try {
          obj[funcName]();
          return true;
        } catch {
          return false;
        }
      }
    }
    return false;
  }

  document.addEventListener('SpeedControllerRunScript', (e) => {
    const detail = e?.detail;
    if (!detail || detail.nonce !== NONCE || typeof detail.code !== 'string') return;
    executeJsUrl(detail.code);
  });
})();
