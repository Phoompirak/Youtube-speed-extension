(() => {
  'use strict';

  function executeJsUrl(codeStr) {
    let clean = codeStr.replace(/^javascript:/i, '').trim();
    clean = clean.replace(/;$/, '').trim();
    
    // Parse function call e.g. "window.ad.skip()" or "ad.skip()"
    const match = clean.match(/^([a-zA-Z0-9_$.]+)\s*\((.*)\)$/);
    if (match) {
      const path = match[1]; // "window.ad.skip"
      const argsStr = match[2]; // arguments
      
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
          console.log('[Speed Controller Inject] Successfully executed page function:', path);
          return true;
        } catch (e) {
          console.error('[Speed Controller Inject] Error executing function:', e);
        }
      }
    }
    return false;
  }

  document.addEventListener('SpeedControllerRunScript', (e) => {
    if (e.detail) {
      executeJsUrl(e.detail);
    }
  });
})();
