// Speed Controller Turbo - Content Script v3.0
// Ad Turbo: auto speed-up ads x16 + universal keyword-based ad skip.

(() => {
  'use strict';

  // ─── Constants ───────────────────────────────────────────────────────────────
  const SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 5, 6, 8, 10, 12, 16];
  const TURBO_SPEED = 16;
  const AD_RAMP_MIN = 2;
  const AD_RAMP_MAX = 10;
  const AD_RAMP_DURATION = 5000;
  const AD_SKIP_RETRY_INTERVAL = 150;
  const AD_SKIP_RETRY_DURATION = 15000;
  const AD_SKIP_CLICK_DELAY = 200;
  const MIN_SPEED = 0.25;
  const MAX_SPEED = 16;
  const VIDEO_SCAN_INTERVAL = 1000;
  const SPEED_SYNC_INTERVAL = 500;
  const AD_SYNC_INTERVAL = 500;
  const TURBO_LIST_SCAN_INTERVAL = 1500;
  const STATS_SAVE_INTERVAL = 10000;
  const OSD_DURATION = 950;
  const CURRENT_SITE = location.hostname.replace(/^www\./, '');
  const IS_TOP_FRAME = (() => {
    try {
      return window.self === window.top;
    } catch {
      return false;
    }
  })();

  const DEFAULT_SHORTCUTS = { raise: ']', lower: '[', reset: '\\', turbo: 't' };
  const AD_BLOCKER_SCAN_INTERVAL = 8000; // ขยายช่วงสแกนแบบ Full Scan เป็น 8 วินาที (ลดการใช้งาน CPU ถี่เกินความจำเป็น)

  // ─── Ad Skip & Blocker Keywords ───────────────────────────────────────────
  const DEFAULT_SKIP_KEYWORDS = ['ข้าม', 'ปิด', 'skip', 'close', 'dismiss', 'continue', 'skip ad', 'skip ads', 'ข้ามโฆษณา'];
  const DEFAULT_GAMBLING_DOMAINS = [
    'ufabet', 'sbobet', 'joker', 'slotxo', 'pg-slot', 'pgslot',
    'betflik', 'ambbet', 'sa-game', 'sagame', 'sexy-baccarat',
    'gclub', 'fun88', 'w88', 'ole777', 'ufaxx', 'ufa', 'mafia',
    'kingmaker', 'jili', 'lockdown168', 'mahaheng', 'game66',
    '1xbet', 'betway', 'dafabet', 'baccarat', 'สล็อต',
    'เว็บพนัน', 'คาสิโน', 'แทงบอล', 'เดิมพัน', 'sbo cool', 'ufa2za'
  ];

  const STORAGE_KEYS = [
    'yt_speed', 'yt_ad_turbo', 'yt_show_panel',
    'yt_panel_pos', 'yt_opacity', 'yt_theme', 'yt_site_speeds',
    'yt_shortcuts', 'yt_stats', 'yt_presets', 'yt_blacklist', 'yt_whitelist',
    'yt_use_site_speed', 'yt_list_mode', 'yt_skip_keywords',
    'yt_ad_blocker', 'yt_gambling_domains', 'yt_ad_blocker_stats',
    'yt_auto_next'
  ];

  // ─── State ───────────────────────────────────────────────────────────────────
  let currentSpeed = 1;
  let adTurboEnabled = true;        // เปิด/ปิด Ad Turbo
  let adBlockerEnabled = false;     // เปิด/ปิด Ad Blocker (ค่าเริ่มต้นปิด ป้องกัน false positive)
  let autoNextEnabled = false;      // เปิด/ปิด Auto Next Lesson (คลิก "ต้องการเรียนบทถัดไป" อัตโนมัติ)
  let showPanel = true;
  let isStateLoaded = false;
  let panelOpacity = 92;
  let currentTheme = 'dark'; // 'dark' | 'light' | 'auto'
  let siteSpeedMap = {};
  let useSiteSpeed = true;
  let frameOverrideSpeed = null;
  let shortcuts = { ...DEFAULT_SHORTCUTS };
  let stats = { savedSeconds: 0, topSpeed: 1, todayVideos: 0, lastDate: '' };
  let adBlockerStats = { blocked: 0, session: 0 };
  let presets = []; // [{name, speed}]
  let blacklist = []; // hostnames
  let whitelist = []; // hostnames
  let listMode = 'none'; // 'none' | 'blacklist' | 'whitelist'
  let skipKeywords = [...DEFAULT_SKIP_KEYWORDS];
  let gamblingDomains = [...DEFAULT_GAMBLING_DOMAINS];
  let preAdSpeed = null;                  // สปีดก่อนเร่งโฆษณา
  let preAdMutedStates = new WeakMap();   // สถานะ Mute ก่อนโฆษณาเข้า (WeakMap กัน memory leak)
  let preAdVolumeStates = new WeakMap();  // ระดับเสียงก่อนโฆษณาเข้า (WeakMap กัน memory leak)
  let isCurrentlyInAdTurbo = false;       // กำลังเร่งโฆษณาอยู่หรือไม่
  let adStartedAt = 0;
  let adRampSpeed = null;
  let adSkipStartedAt = 0;
  let adSkipRetryTimer = null;
  let lastSkipClickAt = 0;
  let skipClickTimer = null;
  let adMutationSkipTimer = null;
  let lastAutoNextClickAt = 0;
  let autoNextDebounceTimer = null;
  let lastBadgeKey = '';

  // Shadow DOM & Panel refs
  let shadowHost = null;
  let shadowRoot = null;
  let panel = null;
  let badge = null;
  let sliderEl = null;
  let sliderValueEl = null;
  let adTurboBtn = null;
  let adBlockerBtn = null;
  let inspectorOverlay = null;
  let osdEl = null;
  let osdTimer = null;
  let activeTab = 'speed'; // speed | presets | stats | settings

  let lastUrl = location.href;
  let videoIdSeed = 0;
  let statsTickTimer = null;
  let statsLastTimestamp = null;

  // ─── Lifecycle & Context Management ──────────────────────────────────────────
  let isShutDown = false;
  const activeIntervals = new Set();
  const activeObservers = new Set();

  function isContextValid() {
    if (isShutDown) return false;
    try {
      return typeof chrome !== 'undefined' && Boolean(chrome.runtime && chrome.runtime.id);
    } catch (e) {
      return false;
    }
  }

  const INJECT_NONCE = (typeof crypto !== 'undefined' && crypto.randomUUID)
    ? crypto.randomUUID()
    : 'sc-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
  let helperScriptInjected = false;

  function injectHelperScript(onReady) {
    if (!isContextValid() || isShutDown) return;
    if (helperScriptInjected) {
      onReady?.();
      return;
    }
    try {
      const script = document.createElement('script');
      script.src = chrome.runtime.getURL('inject.js');
      script.dataset.nonce = INJECT_NONCE;
      script.onload = () => {
        helperScriptInjected = true;
        script.remove();
        onReady?.();
      };
      script.onerror = () => script.remove();
      (document.head || document.documentElement).appendChild(script);
    } catch (e) {
      console.warn('[Speed Controller] Failed to inject helper script:', e);
    }
  }

  function runPageScript(code) {
    if (!isContextValid() || isShutDown) return;
    injectHelperScript(() => {
      const event = new CustomEvent('SpeedControllerRunScript', {
        detail: { nonce: INJECT_NONCE, code },
      });
      document.dispatchEvent(event);
    });
  }

  function syncExtensionBadge() {
    if (!IS_TOP_FRAME || !isContextValid() || isShutDown) return;
    const speed = getEffectiveSpeed();
    const key = isCurrentlyInAdTurbo ? 'AD' : String(speed);
    if (key === lastBadgeKey) return;
    lastBadgeKey = key;
    try {
      chrome.runtime.sendMessage({
        type: 'UPDATE_BADGE',
        speed,
        isAdTurbo: isCurrentlyInAdTurbo,
      }, () => { void chrome.runtime.lastError; });
    } catch { /* ignore */ }
  }

  function shutdownOrphanedScript() {
    if (isShutDown) return;
    isShutDown = true;
    for (const id of activeIntervals) clearInterval(id);
    activeIntervals.clear();
    for (const obs of activeObservers) {
      try { obs.disconnect(); } catch (e) {}
    }
    activeObservers.clear();
    stopAdSkipRetry();
    if (adMutationSkipTimer) clearTimeout(adMutationSkipTimer);
    adMutationSkipTimer = null;
    if (autoNextDebounceTimer) clearTimeout(autoNextDebounceTimer);
    autoNextDebounceTimer = null;
    removePanel();
    if (shadowHost) {
      shadowHost.remove();
      shadowHost = null;
      shadowRoot = null;
      osdEl = null;
    }
  }

  function registerInterval(cb, ms, runWhenHidden = false) {
    const id = setInterval(() => {
      if (!isContextValid()) {
        shutdownOrphanedScript();
        return;
      }
      if (!runWhenHidden && document.hidden) return;
      cb();
    }, ms);
    activeIntervals.add(id);
    return id;
  }

  // ─── Site Gating ─────────────────────────────────────────────────────────────
  function isSiteAllowed() {
    if (listMode === 'blacklist') return !blacklist.includes(CURRENT_SITE);
    if (listMode === 'whitelist') return whitelist.includes(CURRENT_SITE);
    return true;
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────────
  function getEffectiveSpeed() {
    if (!IS_TOP_FRAME && frameOverrideSpeed !== null) {
      return frameOverrideSpeed;
    }
    if (useSiteSpeed) {
      return typeof siteSpeedMap[CURRENT_SITE] === 'number' ? siteSpeedMap[CURRENT_SITE] : 1;
    }
    return currentSpeed;
  }

  function getTargetSpeed() {
    return isCurrentlyInAdTurbo ? getAdTurboSpeed() : getEffectiveSpeed();
  }

  function randomAdRampSpeed() {
    const steps = Math.round((AD_RAMP_MAX - AD_RAMP_MIN) / 0.5);
    return AD_RAMP_MIN + Math.floor(Math.random() * (steps + 1)) * 0.5;
  }

  function getAdTurboSpeed() {
    if (!adStartedAt || !adRampSpeed) return TURBO_SPEED;
    return Date.now() - adStartedAt < AD_RAMP_DURATION ? adRampSpeed : TURBO_SPEED;
  }

  function safeSetStorage(data) {
    if (!isContextValid() || isShutDown) {
      shutdownOrphanedScript();
      return;
    }
    try {
      chrome.storage.local.set(data, () => {
        if (!isContextValid() || chrome.runtime.lastError) {
          shutdownOrphanedScript();
        }
      });
    } catch (e) {
      shutdownOrphanedScript();
    }
  }

  function waitForVideo(callback, maxWait = 15000) {
    const start = Date.now();
    const check = () => {
      if (!isContextValid() || isShutDown) {
        shutdownOrphanedScript();
        return;
      }
      const video = getAllVideos()[0];
      if (video) {
        callback(video);
      } else if (Date.now() - start < maxWait) {
        requestAnimationFrame(check);
      }
    };
    check();
  }

  let cachedVideos = [];
  let lastVideoScanTime = 0;
  let lastShadowScanTime = 0;
  let videoDomDirty = true;

  function collectShadowVideos(root, found) {
    if (!root || !root.querySelectorAll) return;
    const all = root.querySelectorAll('*');
    for (let i = 0; i < all.length; i++) {
      const sr = all[i].shadowRoot;
      if (sr && all[i].id !== 'yt-speed-root') {
        const vids = sr.querySelectorAll('video');
        for (let j = 0; j < vids.length; j++) {
          if (!found.includes(vids[j])) found.push(vids[j]);
        }
        collectShadowVideos(sr, found);
      }
    }
  }

  function getAllVideos(forceShadowScan = false) {
    const now = Date.now();
    // Fast O(1) live HTMLCollection lookup for light-DOM videos
    const liveVideos = document.getElementsByTagName('video');
    if (liveVideos.length > 0) {
      const result = [];
      for (let i = 0; i < liveVideos.length; i++) {
        result.push(liveVideos[i]);
      }
      // Keep any previously found connected shadow videos
      for (let i = 0; i < cachedVideos.length; i++) {
        const v = cachedVideos[i];
        if (v.isConnected && !result.includes(v)) result.push(v);
      }
      if ((forceShadowScan || (videoDomDirty && now - lastShadowScanTime > 4000))) {
        collectShadowVideos(document, result);
        lastShadowScanTime = now;
        videoDomDirty = false;
      }
      cachedVideos = result;
      lastVideoScanTime = now;
      return cachedVideos;
    }

    // No light-DOM videos: only scan Shadow DOM when DOM changed and at most every 4s
    if (forceShadowScan || (videoDomDirty && now - lastShadowScanTime > 4000)) {
      const found = [];
      collectShadowVideos(document, found);
      cachedVideos = found;
      lastShadowScanTime = now;
      lastVideoScanTime = now;
      videoDomDirty = false;
    } else if (cachedVideos.length > 0) {
      cachedVideos = cachedVideos.filter((v) => v.isConnected);
    }
    return cachedVideos;
  }

  function getVideoKey(video) {
    if (!video.__ytSpeedKey) {
      video.__ytSpeedKey = 'yt-speed-' + (++videoIdSeed);
    }
    return video.__ytSpeedKey;
  }

  function getVideoLabel(video, index) {
    const parts = [];
    const title = document.title ? document.title.replace(/\s*-\s*YouTube\s*$/i, '') : '';
    if (title) parts.push(title);

    const src = video.currentSrc || video.src || '';
    if (src) {
      try {
        const url = new URL(src, location.href);
        parts.push(url.hostname.replace(/^www\./, ''));
      } catch {
        parts.push('video source');
      }
    }

    if (!parts.length) parts.push('Video ' + (index + 1));
    return parts.join(' · ');
  }


  function clampSpeed(s) {
    return Math.round(Math.min(MAX_SPEED, Math.max(MIN_SPEED, s)) * 100) / 100;
  }

  // ─── Ad Detection (Universal) ─────────────────────────────────────────────────
  function isAdVideo(video) {
    if (!video) return false;

    // 1. ตรวจจาก iframe host (ad networks)
    const host = window.location.host;
    const adHosts = ['doubleclick.net', 'googlesyndication.com', 'googleads',
      'adsrvr.org', 'adnxs.com', 'moatads.com', 'serving-sys.com'];
    if (adHosts.some(h => host.includes(h))) return true;

    // 2. YouTube-specific
    if (document.querySelector(
      '.html5-video-player.ad-showing, #movie_player.ad-showing, ' +
      '.ad-showing .html5-video-player, .ad-interrupting, .ytp-ad-player-overlay, ' +
      '.ytp-ad-module:not(:empty)'
    )) return true;

    // 3. Universal: traverse parent elements
    let curr = video;
    while (curr && curr !== document.body) {
      const id = (curr.id || '').toLowerCase();
      const cls = typeof curr.className === 'string' ? curr.className.toLowerCase() : '';

      if (
        /\bad[\-_]?(container|player|video|wrapper|overlay|unit|slot|banner|break)\b/.test(cls) ||
        /\bad[\-_]?(container|player|video|wrapper|overlay|unit|slot|banner|break)\b/.test(id) ||
        cls.includes('videoadui') || cls.includes('product-video') ||
        cls.includes('ns-hgnhl') || /ns-[a-z0-9]+-e-/i.test(cls) ||
        id.includes('landscapevideo')
      ) return true;

      curr = curr.parentElement;
    }

    // 4. ตรวจจาก video source URL
    const src = video.currentSrc || video.src || '';
    if (src && (src.includes('doubleclick') || src.includes('googlesyndication') ||
        src.includes('/ads/') || src.includes('/ad/') || src.includes('slot-') ||
        src.includes('pre-roll') || src.includes('post-roll'))) return true;

    // 5. สำหรับเว็บทั่วไปและเว็บดูหนังเถื่อน/สตรีมมิ่ง (หรือ iframe ของ video player ทุกเจ้า) ที่ไม่ใช่ YouTube หรือ Social Media หลัก
    if (!location.hostname.includes('youtube.com') && !location.hostname.includes('facebook.com') &&
        !location.hostname.includes('drive.google.com') && !location.hostname.includes('docs.google.com') &&
        !location.hostname.includes('googleusercontent.com') &&
        !location.hostname.includes('tiktok.com') && !location.hostname.includes('instagram.com') && 
        !location.hostname.includes('twitter.com') && !location.hostname.includes('x.com')) {
      // วิดีโอความยาวสั้นกว่า 180 วินาที (3 นาที) บนเว็บหนัง/สตรีมมิ่ง/iframe ถือเป็นโฆษณาพรีโรลเสมอ
      if (video.duration > 0 && video.duration < 180) {
        return true;
      }
      // ตรวจสอบจากชื่อคลาสหรือ ID ของตัวเล่นวิดีโอหรือ parent (เช่น jw-ad, vjs-ad, ima-ad-container)
      let p = video;
      while (p && p !== document.body) {
        const cls = (typeof p.className === 'string' ? p.className : '').toLowerCase();
        const pid = (p.id || '').toLowerCase();
        if (cls.includes('jw-ad') || cls.includes('vjs-ad') || cls.includes('ima-ad') || cls.includes('ad-showing') || cls.includes('ad-playing') || cls.includes('preroll') || pid.includes('preroll') || cls.includes('vast') || cls.includes('vpaid') || cls.includes('video-ad')) {
          return true;
        }
        p = p.parentElement;
      }
    }

    return false;
  }

  // ─── Ad Skip Helpers ──────────────────────────────────────────────────────────
  function isClickable(el) {
    if (!el || el.disabled) return false;
    const rect = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
    
    // ตรวจหาขนาดจากทั้ง bounding rect และ offsetWidth/Height (รองรับองค์ประกอบแบบ inline หรือที่ขนาดแฝง)
    const hasSize = rect.width > 0 || rect.height > 0 || el.offsetWidth > 0 || el.offsetHeight > 0;
    return hasSize;
  }

  function isInAdContext(el) {
    let curr = el;
    while (curr && curr !== document.body) {
      const id = (curr.id || '').toLowerCase();
      const cls = (typeof curr.className === 'string' ? curr.className : '').toLowerCase();
      if (id.includes('ad') || cls.includes('ad-') || cls.includes('ad_') ||
          cls.includes('advert') || cls.includes('overlay') || cls.includes('modal') ||
          cls.includes('popup') || cls.includes('interstitial') ||
          cls.includes('ytp-ad') || cls.includes('jw-ad') || cls.includes('vjs-ad')) {
        return true;
      }
      curr = curr.parentElement;
    }
    return false;
  }

  function clickOrRunJs(el) {
    if (!el) return false;
    const href = el.getAttribute('href') || '';
    if (href.startsWith('javascript:')) {
      runPageScript(href);
      return true;
    }
    el.click();
    return true;
  }

  function queueSkipClick(el) {
    if (!el || skipClickTimer) return false;
    skipClickTimer = setTimeout(() => {
      skipClickTimer = null;
      if (!isCurrentlyInAdTurbo || !isVisibleAdControl(el)) return;
      if (Date.now() - lastSkipClickAt <= 1000) return;
      lastSkipClickAt = Date.now();
      clickOrRunJs(el);
      console.log('[Ad Turbo] Clicked YouTube skip button after 200ms delay');
    }, AD_SKIP_CLICK_DELAY);
    return true;
  }

  function isYouTube() {
    return /(^|\.)youtube\.com$|(^|\.)youtube-nocookie\.com$/i.test(location.hostname);
  }

  function isVisibleAdControl(el) {
    if (!el || !isClickable(el)) return false;
    const rect = el.getBoundingClientRect();
    const vw = window.innerWidth || document.documentElement.clientWidth;
    const vh = window.innerHeight || document.documentElement.clientHeight;
    return rect.bottom >= 0 && rect.right >= 0 && rect.top <= vh && rect.left <= vw;
  }

  function getYouTubeSkipCandidates() {
    const selectors = [
      '.ytp-ad-skip-button-modern',
      '.ytp-ad-skip-button',
      '.ytp-skip-ad-button',
      '.ytp-ad-skip-button-slot button',
      '.videoAdUiSkipButton',
      'button[aria-label*="skip" i]',
      '[role="button"][aria-label*="skip" i]'
    ];
    const candidates = [];
    for (const selector of selectors) {
      try {
        document.querySelectorAll(selector).forEach((el) => {
          if (!candidates.includes(el)) candidates.push(el);
        });
      } catch { /* ignore selector differences between player versions */ }
    }
    return candidates;
  }

  function findYouTubeSkipButton() {
    const direct = getYouTubeSkipCandidates().find(isVisibleAdControl);
    if (direct) return direct;

    const fallback = document.querySelectorAll(
      '#movie_player button, #movie_player [role="button"], .html5-video-player button'
    );
    for (const el of fallback) {
      if (!isVisibleAdControl(el)) continue;
      const label = [el.textContent, el.getAttribute('aria-label'), el.getAttribute('title')]
        .filter(Boolean).join(' ').trim().toLowerCase();
      if (/skip|ข้าม/.test(label)) return el;
    }
    return null;
  }

  function findAndClickSkipButton() {
    if (isYouTube()) {
      const skipButton = findYouTubeSkipButton();
      if (skipButton && Date.now() - lastSkipClickAt > 1000) {
        return queueSkipClick(skipButton);
      }
      return false;
    }

    // Strategy 1: CSS Selectors ที่รู้จัก (YouTube, Dailymotion, jwplayer, videojs, iframe embeds ฯลฯ)
    const knownSelectors = [
      '.ytp-ad-skip-button', '.ytp-ad-skip-button-modern',
      '.ytp-skip-ad-button', '.videoAdUiSkipButton',
      '[id*="skip" i]', '[class*="skip-ad" i]', '[class*="skip_ad" i]',
      '[class*="skipAd" i]', '[class*="ad-close" i]', '[class*="close-ad" i]',
      '[data-testid*="skip" i]', '[aria-label*="skip" i]', '[aria-label*="Skip" i]',
      '.jw-skip', '.vjs-ad-skip-button', '.plyr__ads button',
      'button[class*="skip" i]', 'div[class*="skip" i]', 'span[class*="skip" i]',
      'a[class*="skip" i]', 'div[id*="skip" i]', 'span[id*="skip" i]'
    ];

    for (const sel of knownSelectors) {
      try {
        // อัปเกรดเป็น querySelectorAll และวนลูปตรวจสอบทุกตัว (แก้ไขบัคตัวแรกไม่ทำงานตัวถัดไปถูกข้าม)
        const buttons = document.querySelectorAll(sel);
        for (const btn of buttons) {
          if (btn && isClickable(btn)) {
            clickOrRunJs(btn);
            console.log('[Ad Turbo] Clicked skip (selector):', sel);
            return true;
          }
        }
      } catch { /* invalid selector on some pages */ }
    }

    // Strategy 2: Keyword text matching (universal — ครอบคลุมทุกเว็บ)
    const candidates = document.querySelectorAll(
      'button, a, [role="button"], span[onclick], div[onclick], ' +
      '[class*="skip" i], [class*="close" i], [class*="dismiss" i]'
    );

    for (const el of candidates) {
      const text = (el.textContent || el.innerText || '').trim().toLowerCase();
      const ariaLabel = (el.getAttribute('aria-label') || '').toLowerCase();
      const title = (el.getAttribute('title') || '').toLowerCase();
      const combined = text + ' ' + ariaLabel + ' ' + title;

      for (const keyword of skipKeywords) {
        if (combined.includes(keyword.toLowerCase()) && isClickable(el)) {
          // ตรวจว่า element อยู่ใน ad context หรือมี ad video อยู่
          if (isInAdContext(el) || getAllVideos().some(isAdVideo)) {
            clickOrRunJs(el);
            console.log(`[Ad Turbo] Clicked skip: "${text.substring(0, 40)}" (keyword: "${keyword}")`);
            return true;
          }
        }
      }
    }

    return false;
  }

  function startAdSkipRetry() {
    if (adSkipRetryTimer) return;
    adSkipStartedAt = Date.now();
    const retry = () => {
      adSkipRetryTimer = null;
      if (!isCurrentlyInAdTurbo || Date.now() - adSkipStartedAt > AD_SKIP_RETRY_DURATION) return;
      findAndClickSkipButton();
      adSkipRetryTimer = setTimeout(retry, AD_SKIP_RETRY_INTERVAL);
    };
    retry();
  }

  function stopAdSkipRetry() {
    if (adSkipRetryTimer) clearTimeout(adSkipRetryTimer);
    adSkipRetryTimer = null;
    adSkipStartedAt = 0;
    if (skipClickTimer) clearTimeout(skipClickTimer);
    skipClickTimer = null;
  }

  // ─── Ad Overlay Blocker Engine (7 Algorithms) ───────────────────────────────
  let adBlockerObserver = null;

  function isSafeToHide(el) {
    if (!el || el === document.body || el === document.documentElement) return false;
    if (el.id === 'yt-speed-root' || el.id === 'yt-speed-panel' || el.closest('#yt-speed-root, #yt-speed-panel')) return false;
    // ห้ามซ่อนวิดีโอหรือกล่องครอบวิดีโอหลัก
    if (el.tagName === 'VIDEO' || el.querySelector('video')) return false;
    // ห้ามซ่อนแท็กโครงสร้างพื้นฐานหลักของหน้าเว็บ (เช่น main, header หลัก, content area ใหญ่) ถ้าไม่ใช่โฆษณาแท้ๆ
    if (el.tagName === 'MAIN' || el.id === 'main' || el.id === 'content' || el.id === 'app') return false;
    return true;
  }

  function hideAdElement(el, reason, isHijack = false) {
    if (!el || !isSafeToHide(el)) return false;
    
    if (isHijack) {
      // ปลดอาวุธ Click-hijack แทนการลบ เพื่อป้องกันเว็บพัง
      if (el.style.pointerEvents === 'none') return false;
      el.style.setProperty('pointer-events', 'none', 'important');
      el.removeAttribute('onclick');
      if (el.tagName === 'A') el.removeAttribute('href');
      adBlockerStats.blocked++;
      adBlockerStats.session++;
      console.log(`[Ad Blocker] Neutralized Click-hijack layer (${reason})`, el);
      syncAdBlockerUI();
      return true;
    }

    if (el.style.display === 'none' && el.getAttribute('data-ad-blocked') === 'true') return false;
    
    el.style.setProperty('display', 'none', 'important');
    el.setAttribute('data-ad-blocked', 'true');
    adBlockerStats.blocked++;
    adBlockerStats.session++;
    console.log(`[Ad Blocker] Blocked overlay/banner (${reason})`, el);
    syncAdBlockerUI();
    return true;
  }

  function findAdContainer(el) {
    if (!el || !isSafeToHide(el)) return null;
    // วิ่งหา Container ที่เหมาะสม (เช่น กล่องลอย, กล่องป้ายโฆษณา, หรือ parent li/div 1-3 ชั้น)
    const floatingParent = el.closest('div[style*="fixed"], div[style*="absolute"], div[class*="popup"], div[class*="overlay"], div[class*="banner"], div[id*="popup"], div[id*="banner"], li[class*="ad"]');
    if (floatingParent && isSafeToHide(floatingParent)) return floatingParent;
    
    let curr = el;
    for (let i = 0; i < 3; i++) {
      if (!curr.parentElement || !isSafeToHide(curr.parentElement)) break;
      const style = getComputedStyle(curr.parentElement);
      if (style.display === 'flex' || style.display === 'grid' || curr.parentElement.tagName === 'LI') {
        curr = curr.parentElement;
      } else {
        break;
      }
    }
    return curr;
  }

  // Algorithm 1: Z-Index Overlay Detection
  function detectHighZIndexOverlays(root = document) {
    // ค้นหาเฉพาะแท็กและ Element ที่มีโอกาสเป็น overlay/banner เพื่อหลีกเลี่ยงการค้นหาแบบหว่านแห '*'
    const targets = root.querySelectorAll ? root.querySelectorAll('div, a, iframe, img, section, aside, [style*="z-index"]') : [];
    const vpW = window.innerWidth, vpH = window.innerHeight;
    
    for (const el of targets) {
      if (!isSafeToHide(el) || el.getAttribute('data-ad-blocked') === 'true') continue;
      const style = getComputedStyle(el);
      const z = parseInt(style.zIndex) || 0;
      const pos = style.position;
      
      // รองรับ z-index >= 10 สำหรับ overlay บังหน้าจอหรือบังวิดีโอในเว็บดูหนังเถื่อน
      if (z >= 10 && (pos === 'fixed' || pos === 'absolute')) {
        const rect = el.getBoundingClientRect();
        const coverageX = vpW > 0 ? rect.width / vpW : 0;
        const coverageY = vpH > 0 ? rect.height / vpH : 0;
        const text = (el.innerText || '').toLowerCase();
        const hasGamblingText = gamblingDomains.some(d => text.includes(d));
        
        // ถ้าเป็นแบนเนอร์หรือป๊อปอัปที่มีคำพนัน ลิงก์พนัน หรือครอบคลุมจอ/ครอบคลุมวิดีโอ
        if (hasGamblingText || (z > 999 && ((coverageX > 0.25 && coverageY > 0.25) || (rect.width > 200 && rect.height > 120)))) {
          if (!el.querySelector('video')) {
            hideAdElement(el, 'High z-index / Gambling ad overlay');
          }
        }
      }
    }
  }

  // Algorithm 2: Gambling Domain Link Detection
  function detectGamblingLinks(root = document) {
    const links = root.querySelectorAll ? root.querySelectorAll('a[href]') : [];
    for (const link of links) {
      if (!isSafeToHide(link) || link.getAttribute('data-ad-blocked') === 'true') continue;
      const href = (link.href || '').toLowerCase();
      const text = (link.textContent || '').toLowerCase();
      
      for (const domain of gamblingDomains) {
        if (href.includes(domain) || text.includes(domain)) {
          const container = findAdContainer(link);
          if (container) hideAdElement(container, `Gambling domain match: ${domain}`);
          break;
        }
      }
    }
  }

  // Algorithm 3 (#5): Transparent Click-hijack Detection (Safe-Zap via pointer-events: none)
  function detectAndNeutralizeClickHijackLayers(root = document) {
    // ค้นหาเฉพาะ div, span, a ที่มีโอกาสเข้าข่ายเลเยอร์ดักคลิก
    const targets = root.querySelectorAll ? root.querySelectorAll('div, span, a') : [];
    const vpW = window.innerWidth, vpH = window.innerHeight;
    
    for (const el of targets) {
      if (!isSafeToHide(el) || el.style.pointerEvents === 'none') continue;
      const style = getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      
      const isTrans = parseFloat(style.opacity) < 0.05 || style.backgroundColor === 'rgba(0, 0, 0, 0)' || style.backgroundColor === 'transparent';
      const isLarge = (rect.width > vpW * 0.5 && rect.height > vpH * 0.5) || (rect.width > 250 && rect.height > 150 && el.closest('div[id*="player" i], div[class*="player" i], .jwplayer, .video-js'));
      const isFixedOrAbs = (style.position === 'fixed' || style.position === 'absolute') && (parseInt(style.zIndex || 0) >= 1);
      
      // เงื่อนไข: โปร่งใส + ครอบคลุมหน้าจอหรือกล่องวิดีโอ + z-index + ไม่มีข้อความหรือเป็นลิงก์ดักคลิก
      if (isTrans && isLarge && isFixedOrAbs && (el.innerText.trim().length === 0 || el.tagName === 'A' || el.getAttribute('onclick'))) {
        hideAdElement(el, 'Transparent Click-hijack layer', true);
      }
    }
  }

  // Algorithm 4: Iframe Ad Network Detection
  const AD_NETWORK_PATTERNS = [
    'doubleclick.net', 'googlesyndication.com', 'googleadservices.com',
    'adnxs.com', 'adsrvr.org', 'moatads.com', 'serving-sys.com',
    'popads.net', 'popcash.net', 'propellerads.com', 'exoclick.com',
    'juicyads.com', 'trafficjunky.com', 'clickadu.com',
    'adcash.com', 'hilltopads.net', 'a-ads.com'
  ];

  function detectAdIframes(root = document) {
    const iframes = root.querySelectorAll ? root.querySelectorAll('iframe') : [];
    for (const iframe of iframes) {
      if (!isSafeToHide(iframe) || iframe.getAttribute('data-ad-blocked') === 'true') continue;
      const src = (iframe.src || '').toLowerCase();
      if (AD_NETWORK_PATTERNS.some(p => src.includes(p)) || iframe.width === '0' || iframe.height === '0') {
        hideAdElement(iframe, 'Ad network iframe');
      }
    }
  }

  // Algorithm 5: Image Size Heuristic
  const COMMON_AD_SIZES = [
    [728, 90], [300, 250], [160, 600], [336, 280],
    [970, 250], [300, 600], [320, 100], [468, 60]
  ];

  function detectAdImages(root = document) {
    const imgs = root.querySelectorAll ? root.querySelectorAll('img') : [];
    for (const img of imgs) {
      if (!isSafeToHide(img) || img.getAttribute('data-ad-blocked') === 'true') continue;
      const w = img.naturalWidth || img.width || img.offsetWidth;
      const h = img.naturalHeight || img.height || img.offsetHeight;
      if (w === 0 || h === 0) continue;
      
      let isAdSize = false;
      for (const [aw, ah] of COMMON_AD_SIZES) {
        if (Math.abs(w - aw) < 25 && Math.abs(h - ah) < 25) { isAdSize = true; break; }
      }
      if (!isAdSize && w > 600 && h < 200 && h > 30) isAdSize = true; // Full-width banner
      
      if (isAdSize) {
        const parentLink = img.closest('a');
        if (parentLink) {
          const href = (parentLink.href || '').toLowerCase();
          if (href.startsWith('http') || parentLink.getAttribute('target') === '_blank' || gamblingDomains.some(d => href.includes(d))) {
            const container = findAdContainer(parentLink);
            if (container) hideAdElement(container, `Ad banner image (${w}x${h})`);
          }
        }
      }
    }
  }

  // Algorithm 6 (#7): Close Button Pattern Detection & Fake Close Button Bypass
  function findAndClickCloseButtonsOrBypassFake(root = document) {
    const closeSelectors = [
      '[class*="close" i]', '[id*="close" i]',
      '[class*="dismiss" i]', '[class*="btn-close" i]',
      '[aria-label*="close" i]', '[aria-label*="ปิด" i]',
      '[class*="ad-close" i]', '[class*="close-ad" i]'
    ];
    
    for (const sel of closeSelectors) {
      const buttons = root.querySelectorAll ? root.querySelectorAll(sel) : [];
      buttons.forEach(btn => {
        if (!isSafeToHide(btn) || btn.id === 'yt-speed-panel' || btn.closest('#yt-speed-panel')) return;
        if (btn.offsetWidth === 0 || btn.offsetHeight === 0) return;
        
        // 1. ตรวจสอบก่อนว่าเป็น "ปุ่มปิดหลอก" หรือไม่ (มีลิงก์ออกนอก หรือเป้าหมายพนัน)
        const linkAncestor = btn.tagName === 'A' ? btn : btn.closest('a');
        if (linkAncestor) {
          const href = (linkAncestor.href || '').toLowerCase();
          const isExternalOrGambling = href.startsWith('http') || gamblingDomains.some(d => href.includes(d));
          if (isExternalOrGambling) {
            // ⚠️ ปุ่มปิดหลอก! ห้ามคลิกเด็ดขาด! ซ่อน Parent Ad Container ทันที
            const container = btn.closest('div[style*="fixed"], div[style*="absolute"], div[class*="ad" i], div[class*="popup" i], div[class*="banner" i]') || btn.parentElement;
            if (container && isSafeToHide(container)) {
              hideAdElement(container, 'Fake close button parent container');
            }
            return;
          }
        }
        
        // 2. ถ้าเป็นปุ่มปิดจริง และอยู่ใน overlay โฆษณา/popup → ทำการกดปิดอย่างปลอดภัย
        const parentOverlay = btn.closest('div[style*="fixed"], div[style*="absolute"], div[class*="popup" i], div[class*="modal" i]');
        if (parentOverlay && isSafeToHide(parentOverlay) && !parentOverlay.querySelector('video')) {
          try { clickOrRunJs(btn); } catch { /* ignore */ }
        }
      });
    }
  }

  // Algorithm 7: MutationObserver with Debounced / Batched Scan to prevent CPU spikes & infinite loops
  let adBlockerDebounceTimer = null;
  const nodesToScan = new Set();

  function watchForInjectedAds() {
    if (adBlockerObserver || !isContextValid() || isShutDown) return;
    adBlockerObserver = new MutationObserver((mutations) => {
      if (!adBlockerEnabled || isShutDown) return;
      
      let shouldQueue = false;
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node.nodeType === 1 && isSafeToHide(node)) {
            // หลีกเลี่ยงการสแกนแผงควบคุมหลักหรือกล่องแสดงผล OSD ของตัวเองเพื่อป้องกัน infinite loops
            if (node.id === 'yt-speed-root' || node.id === 'yt-speed-panel' || node.closest('#yt-speed-root, #yt-speed-panel') || node.id === 'yt-speed-osd') continue;
            nodesToScan.add(node);
            shouldQueue = true;
          }
        }
      }
      
      if (shouldQueue) {
        if (adBlockerDebounceTimer) clearTimeout(adBlockerDebounceTimer);
        adBlockerDebounceTimer = setTimeout(() => {
          if (!isContextValid() || isShutDown) return;
          
          // ตัดการเชื่อมต่อชั่วคราวขณะสแกนแก้ไข DOM เพื่อไม่ให้เกิดปฏิกิริยาสะท้อนกลับวนลูปสะสม
          if (adBlockerObserver) {
            try { adBlockerObserver.disconnect(); } catch (e) {}
          }
          
          try {
            for (const node of nodesToScan) {
              if (node && node.isConnected) {
                scanAndBlockOverlays(node);
              }
            }
          } catch (e) {}
          nodesToScan.clear();
          
          // ทำการเฝ้าสังเกตการณ์ต่อ
          if (adBlockerObserver && adBlockerEnabled && !isShutDown) {
            const targetNode = document.body || document.documentElement;
            if (targetNode) {
              try { adBlockerObserver.observe(targetNode, { childList: true, subtree: true }); } catch (e) {}
            }
          }
        }, 500); // ดีบาวน์ 500ms
      }
    });
    const targetNode = document.body || document.documentElement;
    if (targetNode) {
      adBlockerObserver.observe(targetNode, { childList: true, subtree: true });
      activeObservers.add(adBlockerObserver);
    }
  }

  function stopWatchingInjectedAds() {
    if (adBlockerObserver) {
      try { adBlockerObserver.disconnect(); } catch (e) {}
      activeObservers.delete(adBlockerObserver);
      adBlockerObserver = null;
    }
    if (adBlockerDebounceTimer) {
      clearTimeout(adBlockerDebounceTimer);
      adBlockerDebounceTimer = null;
    }
    nodesToScan.clear();
  }

  // Master Scanner
  function scanAndBlockOverlays(root = document) {
    if (!adBlockerEnabled) return;
    try {
      detectGamblingLinks(root);
      detectHighZIndexOverlays(root);
      detectAndNeutralizeClickHijackLayers(root);
      detectAdIframes(root);
      detectAdImages(root);
      findAndClickCloseButtonsOrBypassFake(root);
    } catch (e) {
      console.warn('[Ad Blocker] Scan error:', e);
    }
  }

  function toggleAdBlocker(enabled) {
    adBlockerEnabled = enabled;
    safeSetStorage({ yt_ad_blocker: adBlockerEnabled });
    syncAdBlockerUI();
    if (adBlockerEnabled) {
      watchForInjectedAds();
      scanAndBlockOverlays();
      console.log('[Ad Blocker] Enabled & active');
    } else {
      stopWatchingInjectedAds();
      console.log('[Ad Blocker] Disabled');
    }
  }

  // ─── Hold-to-Boost State (Spacebar) ─────────────────────────────────────────
  let holdBoostActive = false;
  const HOLD_BOOST_SPEED = 2.5;
  const HOLD_BOOST_DELAY_MS = 250;
  let spaceHoldTimer = null;
  let suppressSpaceKeyup = false;

  // Cache native HTMLMediaElement setters to bypass site-level property shadowing
  const NATIVE_PLAYBACK_RATE_SET = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'playbackRate')?.set;
  const NATIVE_DEFAULT_RATE_SET = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'defaultPlaybackRate')?.set;

  function setNativePlaybackRate(video, rate) {
    if (NATIVE_DEFAULT_RATE_SET) {
      NATIVE_DEFAULT_RATE_SET.call(video, rate);
    } else {
      video.defaultPlaybackRate = rate;
    }
    if (NATIVE_PLAYBACK_RATE_SET) {
      NATIVE_PLAYBACK_RATE_SET.call(video, rate);
    } else {
      video.playbackRate = rate;
    }
  }

  // ─── Speed Application ───────────────────────────────────────────────────────
  function applyVideoSpeed(video) {
    if (!video) return null;
    const isAd = isAdVideo(video);
    // Priority Stack: 1. Ad Turbo (x16) > 2. Hold-to-Boost > 3. User Effective Speed
    const shouldTurbo = isAd && adTurboEnabled;
    const targetSpeed = shouldTurbo
      ? getAdTurboSpeed()
      : (holdBoostActive ? HOLD_BOOST_SPEED : getEffectiveSpeed());
    try {
      if ('preservesPitch' in video) {
        video.preservesPitch = targetSpeed <= 4.0;
      }
      if (Math.abs(video.defaultPlaybackRate - targetSpeed) >= 0.01 || Math.abs(video.playbackRate - targetSpeed) >= 0.01) {
        video.__tfLastInternalSetAt = performance.now();
        setNativePlaybackRate(video, targetSpeed);
      }
    } catch (e) {
      // Fallback if a browser/DRM pipeline rejects extreme speed (e.g. > 8x or 16x)
      try {
        video.__tfLastInternalSetAt = performance.now();
        video.playbackRate = Math.min(targetSpeed, 16);
      } catch { /* ignore */ }
    }
    return targetSpeed;
  }

  function applyCurrentSpeed() {
    const videos = getAllVideos();
    if (!videos.length) return;
    videos.forEach((v) => applyVideoSpeed(v));
    updateBadge();
  }

  function getControlVideos() {
    const videos = getAllVideos();
    if (videos.length <= 1) return videos;

    const active = videos.filter((video) => {
      const rect = video.getBoundingClientRect();
      const style = getComputedStyle(video);
      const visible = rect.width > 0 && rect.height > 0 &&
        style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
      return visible && !isAdVideo(video);
    });
    const playing = active.filter((video) => !video.paused && !video.ended);
    if (playing.length) return playing;
    if (active.length) return [active.sort((a, b) =>
      (b.getBoundingClientRect().width * b.getBoundingClientRect().height) -
      (a.getBoundingClientRect().width * a.getBoundingClientRect().height))[0]];
    return videos;
  }

  function updateBadge() {
    if (badge) badge.textContent = 'x' + getTargetSpeed();
    if (sliderEl) {
      sliderEl.value = getEffectiveSpeed();
      if (sliderValueEl) sliderValueEl.textContent = 'x' + getEffectiveSpeed();
    }
    syncExtensionBadge();
  }

  // ─── Shadow DOM UI Host (100% CSS Isolation + Fullscreen Support) ────────────
  const SHADOW_UI_STYLES = `
    :host {
      all: initial;
      font-family: -apple-system, BlinkMacSystemFont, 'Inter', 'Segoe UI', 'Noto Sans Thai', system-ui, sans-serif;
    }
    *, *::before, *::after { box-sizing: border-box; }

    /* ── Minimal OSD Pill ── */
    #yt-speed-osd {
      position: fixed;
      top: 48px;
      left: 50%;
      transform: translateX(-50%) translateY(-6px) scale(0.96);
      z-index: 2147483647;
      background: rgba(14, 14, 17, 0.86);
      backdrop-filter: blur(14px) saturate(140%);
      -webkit-backdrop-filter: blur(14px) saturate(140%);
      border: 1px solid rgba(255, 255, 255, 0.12);
      border-radius: 999px;
      padding: 7px 14px;
      display: inline-flex;
      flex-direction: row;
      align-items: center;
      justify-content: center;
      gap: 7px;
      color: #fafafa;
      opacity: 0;
      pointer-events: none;
      transition: opacity 0.16s ease, transform 0.18s cubic-bezier(0.22, 1, 0.36, 1);
      box-shadow: 0 8px 28px rgba(0, 0, 0, 0.42);
      line-height: 1;
    }
    #yt-speed-osd.osd-show {
      opacity: 1;
      transform: translateX(-50%) translateY(0) scale(1);
    }
    #yt-speed-osd.osd-fade {
      opacity: 0;
      transform: translateX(-50%) translateY(-4px) scale(0.97);
    }
    #yt-speed-osd .osd-icon {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      color: #fafafa;
    }
    #yt-speed-osd .osd-val {
      font-size: 13.5px;
      font-weight: 600;
      color: #fafafa;
      font-variant-numeric: tabular-nums;
      letter-spacing: -0.01em;
    }

    /* ── Minimal Floating Panel ── */
    #yt-speed-panel {
      --bg: rgba(13, 13, 16, 0.92);
      --surface: rgba(255, 255, 255, 0.045);
      --surface-hover: rgba(255, 255, 255, 0.09);
      --border: rgba(255, 255, 255, 0.1);
      --text: #fafafa;
      --text-soft: #a1a1aa;
      --text-muted: #71717a;
      --accent: #fafafa;
      --accent-ink: #09090b;
      --turbo: #f59e0b;

      position: fixed;
      top: 76px;
      right: 16px;
      width: 244px;
      background: var(--bg);
      backdrop-filter: blur(18px) saturate(150%);
      -webkit-backdrop-filter: blur(18px) saturate(150%);
      border: 1px solid var(--border);
      border-radius: 14px;
      padding: 10px 12px;
      color: var(--text);
      box-shadow: 0 14px 40px rgba(0, 0, 0, 0.5);
      pointer-events: auto;
      user-select: none;
      font-size: 12px;
      line-height: 1.35;
      z-index: 2147483646;
      transition: opacity 0.2s ease, width 0.2s ease;
    }
    #yt-speed-panel[data-theme="light"] {
      --bg: rgba(250, 250, 252, 0.94);
      --surface: rgba(9, 9, 11, 0.045);
      --surface-hover: rgba(9, 9, 11, 0.09);
      --border: rgba(9, 9, 11, 0.1);
      --text: #09090b;
      --text-soft: #52525b;
      --text-muted: #71717a;
      --accent: #09090b;
      --accent-ink: #fafafa;
      box-shadow: 0 12px 32px rgba(0, 0, 0, 0.14);
    }
    #yt-speed-panel.collapsed {
      width: auto;
      padding: 6px 52px 6px 10px;
      border-radius: 999px;
    }
    #yt-speed-panel.collapsed .sc-tab-bar,
    #yt-speed-panel.collapsed .sc-tab-content {
      display: none;
    }
    #yt-speed-panel.collapsed .sc-header {
      margin-bottom: 0;
      padding-bottom: 0;
      border-bottom: none;
    }

    .sc-header {
      display: flex;
      align-items: center;
      gap: 6px;
      cursor: grab;
      padding-right: 42px;
      padding-bottom: 8px;
      margin-bottom: 8px;
      border-bottom: 1px solid var(--border);
    }
    .sc-header:active { cursor: grabbing; }
    .sc-title {
      font-size: 12px;
      font-weight: 600;
      letter-spacing: -0.01em;
      color: var(--text);
      display: inline-flex;
      align-items: center;
      gap: 5px;
    }
    .sc-badge {
      background: var(--accent);
      color: var(--accent-ink);
      font-size: 11px;
      font-weight: 700;
      padding: 2px 7px;
      border-radius: 999px;
      font-variant-numeric: tabular-nums;
      cursor: ns-resize;
    }

    .sc-toggle, .sc-close-panel {
      position: absolute;
      top: 8px;
      width: 20px;
      height: 20px;
      border-radius: 6px;
      border: 1px solid transparent;
      background: transparent;
      color: var(--text-muted);
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      font-size: 13px;
      line-height: 1;
      transition: background 0.14s ease, color 0.14s ease;
    }
    .sc-toggle { right: 30px; }
    .sc-close-panel { right: 8px; }
    #yt-speed-panel.collapsed .sc-toggle,
    #yt-speed-panel.collapsed .sc-close-panel {
      top: 50%;
      transform: translateY(-50%);
    }
    .sc-toggle:hover, .sc-close-panel:hover {
      background: var(--surface-hover);
      color: var(--text);
    }

    .sc-tab-bar {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 3px;
      background: var(--surface);
      padding: 3px;
      border-radius: 9px;
      margin-bottom: 9px;
    }
    .sc-tab-btn {
      border: none;
      background: transparent;
      color: var(--text-muted);
      font-size: 10.5px;
      font-weight: 500;
      padding: 5px 2px;
      border-radius: 7px;
      cursor: pointer;
      transition: all 0.14s ease;
      white-space: nowrap;
    }
    .sc-tab-btn:hover { color: var(--text); }
    .sc-tab-btn.active {
      background: var(--accent);
      color: var(--accent-ink);
      font-weight: 600;
    }

    .sc-tab-content { display: none; flex-direction: column; gap: 8px; max-height: 360px; overflow-y: auto; }
    .sc-tab-content.active { display: flex; }
    .sc-tab-content::-webkit-scrollbar { width: 4px; }
    .sc-tab-content::-webkit-scrollbar-thumb { background: var(--border); border-radius: 999px; }

    .sc-slider-wrap { display: flex; flex-direction: column; gap: 5px; }
    .sc-slider-header { display: flex; justify-content: space-between; align-items: center; font-size: 11px; color: var(--text-soft); }
    .sc-slider-value { font-size: 14px; font-weight: 600; color: var(--text); font-variant-numeric: tabular-nums; }
    .sc-slider {
      -webkit-appearance: none;
      appearance: none;
      width: 100%;
      height: 3px;
      border-radius: 999px;
      background: var(--surface-hover);
      outline: none;
      cursor: pointer;
    }
    .sc-slider::-webkit-slider-thumb {
      -webkit-appearance: none;
      appearance: none;
      width: 13px;
      height: 13px;
      border-radius: 50%;
      background: var(--accent);
      cursor: pointer;
    }

    .sc-quick-grid, .sc-speed-grid {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 4px;
    }
    .sc-btn, .sc-preset-btn, .sc-settings-btn {
      border: 1px solid var(--border);
      background: var(--surface);
      color: var(--text-soft);
      border-radius: 7px;
      padding: 5px 6px;
      font-size: 11px;
      font-weight: 500;
      cursor: pointer;
      transition: all 0.14s ease;
      font-variant-numeric: tabular-nums;
    }
    .sc-btn:hover, .sc-preset-btn:hover, .sc-settings-btn:hover {
      background: var(--surface-hover);
      color: var(--text);
    }
    .sc-btn.active, .sc-preset-btn.active {
      background: var(--accent);
      color: var(--accent-ink);
      border-color: var(--accent);
      font-weight: 600;
    }
    .sc-turbo-btn, .sc-blocker-btn {
      width: 100%;
      text-align: left;
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 7px 9px;
    }
    .sc-turbo-btn.active {
      background: var(--turbo);
      color: #09090b;
      border-color: var(--turbo);
    }

    .sc-hint, .sc-settings-hint {
      font-size: 10px;
      color: var(--text-muted);
      line-height: 1.4;
    }
    .sc-hint kbd {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 4px;
      padding: 0 4px;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      color: var(--text-soft);
    }

    .sc-stats-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 6px; }
    .sc-stat-box {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 7px;
      text-align: center;
    }
    .sc-stat-val { font-size: 13px; font-weight: 600; color: var(--text); font-variant-numeric: tabular-nums; }
    .sc-stat-label { font-size: 10px; color: var(--text-muted); margin-top: 2px; }

    .sc-section {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 10px;
      padding: 8px 9px;
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .sc-section-title { font-size: 11px; font-weight: 600; color: var(--text); }
    .sc-settings-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
    .sc-settings-label { font-size: 11px; color: var(--text-soft); }
    .sc-input, .sc-select {
      background: var(--bg);
      color: var(--text);
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 4px 7px;
      font-size: 11px;
      outline: none;
    }
    .sc-mini-switch { position: relative; width: 32px; height: 18px; display: inline-block; flex-shrink: 0; }
    .sc-mini-switch input { opacity: 0; width: 0; height: 0; }
    .sc-mini-slider {
      position: absolute;
      inset: 0;
      border-radius: 999px;
      background: var(--surface-hover);
      cursor: pointer;
      transition: background 0.16s ease;
    }
    .sc-mini-slider::before {
      content: '';
      position: absolute;
      width: 12px;
      height: 12px;
      left: 3px;
      top: 3px;
      border-radius: 50%;
      background: var(--text-soft);
      transition: transform 0.16s ease, background 0.16s ease;
    }
    .sc-mini-switch input:checked + .sc-mini-slider { background: var(--accent); }
    .sc-mini-switch input:checked + .sc-mini-slider::before {
      transform: translateX(14px);
      background: var(--accent-ink);
    }
    .sc-preset-item { display: flex; align-items: center; gap: 4px; }
    .sc-preset-item .sc-preset-btn { flex: 1; text-align: left; }
    .sc-preset-del {
      border: 1px solid var(--border);
      background: transparent;
      color: var(--text-muted);
      border-radius: 6px;
      padding: 4px 7px;
      cursor: pointer;
      font-size: 11px;
    }
    .sc-preset-del:hover { color: #ef4444; border-color: rgba(239, 68, 68, 0.4); }
    .sc-chip-list { display: flex; flex-wrap: wrap; gap: 4px; }
    .sc-chip {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      background: var(--bg);
      border: 1px solid var(--border);
      border-radius: 999px;
      padding: 2px 7px;
      font-size: 10px;
      color: var(--text-soft);
    }
    .sc-chip button {
      border: none;
      background: transparent;
      color: var(--text-muted);
      cursor: pointer;
      padding: 0;
      font-size: 11px;
    }
  `;

  function getShadowMountTarget() {
    return document.fullscreenElement || document.webkitFullscreenElement || document.documentElement || document.body;
  }

  function syncShadowHostParent() {
    if (!shadowHost) return;
    const target = getShadowMountTarget();
    if (target && shadowHost.parentNode !== target) {
      target.appendChild(shadowHost);
    }
  }

  function ensureShadowRoot() {
    if (shadowRoot && shadowHost) {
      syncShadowHostParent();
      return shadowRoot;
    }
    shadowHost = document.createElement('div');
    shadowHost.id = 'yt-speed-root';
    shadowRoot = shadowHost.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = SHADOW_UI_STYLES;
    shadowRoot.appendChild(style);
    syncShadowHostParent();
    return shadowRoot;
  }

  document.addEventListener('fullscreenchange', syncShadowHostParent);
  document.addEventListener('webkitfullscreenchange', syncShadowHostParent);

  // ─── Feature 6: Speed OSD ────────────────────────────────────────────────────
  const OSD_ICONS = {
    up: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M3.5 6.8C3.5 5.9 4.5 5.4 5.2 5.9L11.4 10.6C12 11.1 12 11.9 11.4 12.4L5.2 17.1C4.5 17.6 3.5 17.1 3.5 16.2V6.8Z" fill="currentColor" opacity="0.52"/><path d="M12.5 6.8C12.5 5.9 13.5 5.4 14.2 5.9L20.4 10.6C21 11.1 21 11.9 20.4 12.4L14.2 17.1C13.5 17.6 12.5 17.1 12.5 16.2V6.8Z" fill="currentColor"/></svg>',
    down: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M20.5 6.8C20.5 5.9 19.5 5.4 18.8 5.9L12.6 10.6C12 11.1 12 11.9 12.6 12.4L18.8 17.1C19.5 17.6 20.5 17.1 20.5 16.2V6.8Z" fill="currentColor" opacity="0.52"/><path d="M11.5 6.8C11.5 5.9 10.5 5.4 9.8 5.9L3.6 10.6C3 11.1 3 11.9 3.6 12.4L9.8 17.1C10.5 17.6 11.5 17.1 11.5 16.2V6.8Z" fill="currentColor"/></svg>',
    neutral: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/></svg>',
    next: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 4 15 12 5 20 5 4" fill="currentColor"/><line x1="19" y1="5" x2="19" y2="19"/></svg>',
  };

  const UI_ICONS = {
    zap: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>',
    shield: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>',
    sliders: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0"><line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/></svg>',
    barChart: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>',
    settings: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>',
    trash: '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>',
    clock: '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>',
    award: '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>',
    play: '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0"><polygon points="5 3 19 12 5 21 5 3"/></svg>',
  };

  function showOSD(speed, direction, customText = null) {
    const root = ensureShadowRoot();
    if (!root) return;
    if (!osdEl) {
      osdEl = document.createElement('div');
      osdEl.id = 'yt-speed-osd';
      root.appendChild(osdEl);
    }
    const icon = OSD_ICONS[direction] || OSD_ICONS.neutral;
    const text = customText !== null ? customText : `x${speed}`;
    osdEl.innerHTML = `<span class="osd-icon">${icon}</span><span class="osd-val">${text}</span>`;
    osdEl.classList.remove('osd-fade');
    void osdEl.offsetWidth; // reflow to restart animation
    osdEl.classList.add('osd-show');

    clearTimeout(osdTimer);
    osdTimer = setTimeout(() => {
      osdEl.classList.remove('osd-show');
      osdEl.classList.add('osd-fade');
    }, OSD_DURATION);
  }

  // ─── Auto Next Lesson Mode (jconfirm / E-Learning Dialog) ───────────────────
  const AUTO_NEXT_TEXT = 'ต้องการเรียนบทถัดไป';
  const AUTO_NEXT_COOLDOWN_MS = 2500;

  function isElementVisibleForClick(el) {
    if (!el || !el.isConnected || el.disabled) return false;
    const style = getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function findAutoNextLessonButton() {
    // 1. Fast path: jconfirm dialog buttons (exact structure reported by user)
    const jconfirmBtns = document.querySelectorAll('.jconfirm-box .jconfirm-buttons button, [role="dialog"] button');
    for (let i = 0; i < jconfirmBtns.length; i++) {
      const btn = jconfirmBtns[i];
      const text = (btn.textContent || '').replace(/\s+/g, ' ').trim();
      if (text === AUTO_NEXT_TEXT || (text.includes(AUTO_NEXT_TEXT) && !text.includes('เรียนซ้ำ'))) {
        if (isElementVisibleForClick(btn)) return btn;
      }
    }
    // 2. Fallback: any visible button matching exact text
    const allBtns = document.getElementsByTagName('button');
    for (let i = 0; i < allBtns.length; i++) {
      const btn = allBtns[i];
      const text = (btn.textContent || '').replace(/\s+/g, ' ').trim();
      if (text === AUTO_NEXT_TEXT && isElementVisibleForClick(btn)) {
        return btn;
      }
    }
    return null;
  }

  function checkAndClickAutoNextLesson() {
    if (!autoNextEnabled || isShutDown) return false;
    const now = Date.now();
    if (now - lastAutoNextClickAt < AUTO_NEXT_COOLDOWN_MS) return false;

    const btn = findAutoNextLessonButton();
    if (!btn) return false;

    lastAutoNextClickAt = now;
    try {
      btn.click();
      showOSD('', 'next', 'บทถัดไป');
      return true;
    } catch {
      return false;
    }
  }

  // ─── Feature 7: Usage Statistics ─────────────────────────────────────────────
  function initStatsTracking() {
    const today = new Date().toDateString();
    if (stats.lastDate !== today) {
      stats.todayVideos = 0;
      stats.lastDate = today;
    }

    registerInterval(() => {
      const videos = getAllVideos();
      const mainVideo = videos.find((v) => !isAdVideo(v));
      if (mainVideo && !mainVideo.paused) {
        const spd = mainVideo.playbackRate;
        if (spd > 1) {
          const savedThisTick = (STATS_SAVE_INTERVAL / 1000) * (spd - 1) / spd;
          stats.savedSeconds += savedThisTick;
        }
        if (spd > stats.topSpeed) stats.topSpeed = spd;
      }
      safeSetStorage({ yt_stats: stats });
      updateStatsUI();
    }, STATS_SAVE_INTERVAL);
  }

  function formatTime(seconds) {
    if (seconds < 60) return Math.round(seconds) + ' วิ';
    if (seconds < 3600) return Math.round(seconds / 60) + ' นาที';
    return (seconds / 3600).toFixed(1) + ' ชม.';
  }

  // ─── Feature 1: Custom Speed (set speed with slider value) ───────────────────
  function setSpeed(spd, direction) {
    const clamped = clampSpeed(spd);

    if (!IS_TOP_FRAME) {
      frameOverrideSpeed = clamped;
    } else if (useSiteSpeed) {
      // Feature 2: Per-Site Speed Memory
      siteSpeedMap[CURRENT_SITE] = clamped;
      safeSetStorage({ yt_site_speeds: siteSpeedMap });
    } else {
      currentSpeed = clamped;
      safeSetStorage({ yt_speed: clamped });
    }

    syncSpeedUI();
    applyCurrentSpeed();
    broadcastSpeedToFrames(clamped);
    showOSD(clamped, direction);

    // Stats: count new video if first speed change
    const today = new Date().toDateString();
    if (stats.lastDate !== today) {
      stats.todayVideos = 0;
      stats.lastDate = today;
    }
    stats.todayVideos++;
    safeSetStorage({ yt_stats: stats });
    updateStatsUI();
  }

  function broadcastSpeedToFrames(speed) {
    document.querySelectorAll('iframe').forEach((frame) => {
      try {
        frame.contentWindow?.postMessage({
          source: 'speed-controller-turbo',
          type: 'SET_SPEED',
          speed,
        }, '*');
      } catch { /* cross-origin frames may disappear during navigation */ }
    });
  }

  function syncSpeedUI() {
    const spd = getEffectiveSpeed();
    if (badge) badge.textContent = 'x' + getTargetSpeed();
    if (sliderEl) {
      sliderEl.value = spd;
      if (sliderValueEl) sliderValueEl.textContent = 'x' + spd;
    }
    if (panel) {
      panel.querySelectorAll('.sc-preset-btn').forEach((btn) => {
        btn.classList.toggle('active', parseFloat(btn.dataset.speed) === spd);
      });
    }
    syncExtensionBadge();
  }

  function toggleAdTurbo(nextValue) {
    adTurboEnabled = nextValue;
    safeSetStorage({ yt_ad_turbo: adTurboEnabled });
    syncAdTurboUI();
    applyCurrentSpeed();
    showOSD(getEffectiveSpeed(), 'neutral');
  }

  function syncAdTurboUI() {
    if (!adTurboBtn) return;
    adTurboBtn.classList.toggle('active', adTurboEnabled);
    adTurboBtn.innerHTML = `<span style="display:inline-flex;align-items:center;gap:6px">${UI_ICONS.zap}<span>Ad Turbo</span></span><span>${adTurboEnabled ? 'ON' : 'OFF'}</span>`;
  }

  function syncAdBlockerUI() {
    if (!adBlockerBtn) return;
    adBlockerBtn.classList.toggle('active', adBlockerEnabled);
    const blockedCount = adBlockerStats.session || 0;
    adBlockerBtn.innerHTML = `<span style="display:inline-flex;align-items:center;gap:6px">${UI_ICONS.shield}<span>Ad Blocker</span></span><span>${adBlockerEnabled ? `ON (${blockedCount})` : 'OFF'}</span>`;
  }

  // ─── Video Inspector ─────────────────────────────────────────────────────────
  function setHighlightedVideo(video) {
    if (!video) { clearHighlightedVideo(); return; }
    const rect = video.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    if (!inspectorOverlay) {
      inspectorOverlay = document.createElement('div');
      inspectorOverlay.id = 'yt-speed-inspector-overlay';
      document.body.appendChild(inspectorOverlay);
    }
    inspectorOverlay.style.display = 'block';
    inspectorOverlay.style.left = (rect.left + window.scrollX) + 'px';
    inspectorOverlay.style.top = (rect.top + window.scrollY) + 'px';
    inspectorOverlay.style.width = rect.width + 'px';
    inspectorOverlay.style.height = rect.height + 'px';
  }

  function clearHighlightedVideo() {
    if (inspectorOverlay) { inspectorOverlay.remove(); inspectorOverlay = null; }
  }

  // ─── (Turbo Targets section removed — Ad Turbo handles ads automatically) ──

  // ─── Feature 7: Stats UI ─────────────────────────────────────────────────────
  let statsContainerEl = null;

  function updateStatsUI() {
    if (!statsContainerEl) return;
    statsContainerEl.innerHTML = `
      <div class="sc-stat-row"><span class="sc-stat-label" style="display:inline-flex;align-items:center;gap:5px">${UI_ICONS.clock}ประหยัดเวลา</span><span class="sc-stat-val">${formatTime(stats.savedSeconds)}</span></div>
      <div class="sc-stat-row"><span class="sc-stat-label" style="display:inline-flex;align-items:center;gap:5px">${UI_ICONS.award}สปีดสูงสุด</span><span class="sc-stat-val">x${stats.topSpeed}</span></div>
      <div class="sc-stat-row"><span class="sc-stat-label" style="display:inline-flex;align-items:center;gap:5px">${UI_ICONS.play}วิดีโอวันนี้</span><span class="sc-stat-val">${stats.todayVideos}</span></div>
    `;
  }

  // ─── Feature 2: Per-Site Speed toggle UI ─────────────────────────────────────
  let siteSpeedLabelEl = null;

  function updateSiteSpeedLabel() {
    if (!siteSpeedLabelEl) return;
    const spd = siteSpeedMap[CURRENT_SITE];
    siteSpeedLabelEl.textContent = spd !== undefined ? `x${spd} บน ${CURRENT_SITE}` : `ไม่มีค่าสำหรับ ${CURRENT_SITE}`;
  }

  // ─── Feature 5: Position Memory with Snap ────────────────────────────────────
  function snapToCorner(x, y, w, h) {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const snap = 60;
    let sx = x;
    let sy = y;
    if (x < snap) sx = 16;
    else if (x + w > vw - snap) sx = vw - w - 16;
    if (y < snap) sy = 16;
    else if (y + h > vh - snap) sy = vh - h - 16;
    return { sx, sy };
  }

  function clampPanelPos(x, y) {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const w = panel ? panel.offsetWidth : 240;
    const h = panel ? panel.offsetHeight : 300;
    return {
      x: Math.max(0, Math.min(vw - w, x)),
      y: Math.max(0, Math.min(vh - h, y)),
    };
  }

  // ─── Feature 4: Theme & Opacity ──────────────────────────────────────────────
  function applyTheme() {
    if (!panel) return;
    const effectiveTheme = currentTheme === 'auto'
      ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
      : currentTheme;
    panel.setAttribute('data-theme', effectiveTheme);
  }

  function applyOpacity() {
    if (!panel) return;
    panel.style.opacity = (panelOpacity / 100).toFixed(2);
  }

  // ─── Panel Creation ───────────────────────────────────────────────────────────
  function canShowFloatingPanel() {
    return isStateLoaded && IS_TOP_FRAME && showPanel && isSiteAllowed();
  }

  function createPanel() {
    if (!canShowFloatingPanel()) return;
    const root = ensureShadowRoot();
    if (!root || root.getElementById('yt-speed-panel')) return;

    panel = document.createElement('div');
    panel.id = 'yt-speed-panel';
    applyTheme();
    applyOpacity();

    // ── Header ──
    const header = document.createElement('div');
    header.className = 'sc-header';

    const title = document.createElement('span');
    title.className = 'sc-title';
    title.innerHTML = `${OSD_ICONS.up}<span>Speed</span>`;

    badge = document.createElement('span');
    badge.className = 'sc-badge';
    badge.textContent = 'x1';

    header.appendChild(title);
    header.appendChild(badge);
    panel.appendChild(header);

    // ── Tabs ──
    const tabBar = document.createElement('div');
    tabBar.className = 'sc-tab-bar';
    const tabs = [
      { id: 'speed', html: `${UI_ICONS.sliders}<span>Speed</span>` },
      { id: 'presets', html: `${UI_ICONS.zap}<span>Presets</span>` },
      { id: 'stats', html: `${UI_ICONS.barChart}<span>Stats</span>` },
      { id: 'settings', html: UI_ICONS.settings },
    ];
    tabs.forEach(({ id, html }) => {
      const btn = document.createElement('button');
      btn.className = 'sc-tab-btn' + (id === activeTab ? ' active' : '');
      btn.dataset.tab = id;
      btn.style.display = 'inline-flex';
      btn.style.alignItems = 'center';
      btn.style.justifyContent = 'center';
      btn.style.gap = '4px';
      btn.innerHTML = html;
      btn.addEventListener('click', () => switchTab(id));
      tabBar.appendChild(btn);
    });
    panel.appendChild(tabBar);

    // ── Tab Contents ──

    // SPEED TAB
    const speedTab = document.createElement('div');
    speedTab.className = 'sc-tab-content' + (activeTab === 'speed' ? ' active' : '');
    speedTab.dataset.tabContent = 'speed';

    // Feature 1: Slider
    const sliderWrap = document.createElement('div');
    sliderWrap.className = 'sc-slider-wrap';

    sliderEl = document.createElement('input');
    sliderEl.type = 'range';
    sliderEl.className = 'sc-slider';
    sliderEl.min = MIN_SPEED;
    sliderEl.max = MAX_SPEED;
    sliderEl.step = 0.25;
    sliderEl.value = getEffectiveSpeed();

    sliderValueEl = document.createElement('div');
    sliderValueEl.className = 'sc-slider-value';
    sliderValueEl.textContent = 'x' + getEffectiveSpeed();

    const sliderResetBtn = document.createElement('button');
    sliderResetBtn.className = 'sc-slider-reset';
    sliderResetBtn.title = 'Double-click to reset';
    sliderResetBtn.textContent = '↺';
    sliderResetBtn.addEventListener('click', () => setSpeed(1, 'neutral'));
    sliderResetBtn.addEventListener('dblclick', () => setSpeed(1, 'neutral'));

    sliderEl.addEventListener('input', () => {
      sliderValueEl.textContent = 'x' + sliderEl.value;
    });
    sliderEl.addEventListener('change', () => {
      setSpeed(parseFloat(sliderEl.value), 'neutral');
    });

    // Feature 9: Mouse Wheel on slider
    sliderEl.addEventListener('wheel', (e) => {
      e.preventDefault();
      const step = e.deltaY < 0 ? 0.25 : -0.25;
      const next = clampSpeed(getEffectiveSpeed() + step);
      setSpeed(next, step > 0 ? 'up' : 'down');
    }, { passive: false });

    sliderWrap.appendChild(sliderValueEl);
    sliderWrap.appendChild(sliderEl);
    sliderWrap.appendChild(sliderResetBtn);
    speedTab.appendChild(sliderWrap);

    // Speed preset buttons row (quick picks)
    const quickSpeeds = [1, 1.5, 2, 3];
    const quickRow = document.createElement('div');
    quickRow.className = 'sc-quick-row';
    quickSpeeds.forEach((spd) => {
      const btn = document.createElement('button');
      btn.className = 'sc-btn' + (getEffectiveSpeed() === spd ? ' active' : '');
      btn.textContent = 'x' + spd;
      btn.dataset.speed = spd;
      btn.addEventListener('click', () => setSpeed(spd, spd > getEffectiveSpeed() ? 'up' : 'down'));
      quickRow.appendChild(btn);
    });
    speedTab.appendChild(quickRow);

    // Ad Turbo & Ad Blocker
    const turboContainer = document.createElement('div');
    turboContainer.className = 'sc-turbo-container';
    adTurboBtn = document.createElement('button');
    adTurboBtn.id = 'sc-turbo-toggle';
    adTurboBtn.className = 'sc-turbo-btn';
    adTurboBtn.addEventListener('click', () => toggleAdTurbo(!adTurboEnabled));
    turboContainer.appendChild(adTurboBtn);

    adBlockerBtn = document.createElement('button');
    adBlockerBtn.id = 'sc-blocker-toggle';
    adBlockerBtn.className = 'sc-turbo-btn';
    adBlockerBtn.style.marginTop = '6px';
    adBlockerBtn.addEventListener('click', () => toggleAdBlocker(!adBlockerEnabled));
    turboContainer.appendChild(adBlockerBtn);

    speedTab.appendChild(turboContainer);
    syncAdTurboUI();
    syncAdBlockerUI();

    const hint = document.createElement('div');
    hint.className = 'sc-shortcut-hint';
    hint.id = 'sc-shortcut-hint';
    updateHintText(hint);
    speedTab.appendChild(hint);

    panel.appendChild(speedTab);

    // PRESETS TAB
    const presetsTab = document.createElement('div');
    presetsTab.className = 'sc-tab-content' + (activeTab === 'presets' ? ' active' : '');
    presetsTab.dataset.tabContent = 'presets';
    presetsTab.id = 'sc-presets-content';
    renderPresetsTab(presetsTab);
    panel.appendChild(presetsTab);

    // STATS TAB
    const statsTab = document.createElement('div');
    statsTab.className = 'sc-tab-content' + (activeTab === 'stats' ? ' active' : '');
    statsTab.dataset.tabContent = 'stats';

    const statsTitle = document.createElement('div');
    statsTitle.className = 'sc-section-title';
    statsTitle.textContent = 'สถิติการใช้งาน';
    statsTab.appendChild(statsTitle);

    statsContainerEl = document.createElement('div');
    statsContainerEl.className = 'sc-stats-container';
    updateStatsUI();
    statsTab.appendChild(statsContainerEl);

    const resetStatsBtn = document.createElement('button');
    resetStatsBtn.className = 'sc-settings-btn danger';
    resetStatsBtn.style.display = 'inline-flex';
    resetStatsBtn.style.alignItems = 'center';
    resetStatsBtn.style.justifyContent = 'center';
    resetStatsBtn.style.gap = '5px';
    resetStatsBtn.innerHTML = `${UI_ICONS.trash}<span>รีเซ็ตสถิติ</span>`;
    resetStatsBtn.addEventListener('click', () => {
      stats = { savedSeconds: 0, topSpeed: 1, todayVideos: 0, lastDate: new Date().toDateString() };
      safeSetStorage({ yt_stats: stats });
      updateStatsUI();
    });
    statsTab.appendChild(resetStatsBtn);
    panel.appendChild(statsTab);

    // SETTINGS TAB
    const settingsTab = document.createElement('div');
    settingsTab.className = 'sc-tab-content' + (activeTab === 'settings' ? ' active' : '');
    settingsTab.dataset.tabContent = 'settings';
    renderSettingsTab(settingsTab);
    panel.appendChild(settingsTab);

    // ── Collapse / Close Buttons ──
    const toggleBtn = document.createElement('button');
    toggleBtn.className = 'sc-toggle';
    toggleBtn.textContent = '−';
    toggleBtn.title = 'Collapse/expand';
    toggleBtn.addEventListener('click', () => {
      panel.classList.toggle('collapsed');
      toggleBtn.textContent = panel.classList.contains('collapsed') ? '+' : '−';
      if (panel.style.left) {
        const rect = panel.getBoundingClientRect();
        const safePos = clampPanelPos(rect.left, rect.top);
        panel.style.left = safePos.x + 'px';
        panel.style.top = safePos.y + 'px';
      }
    });
    panel.appendChild(toggleBtn);

    const closeBtn = document.createElement('button');
    closeBtn.className = 'sc-close-panel';
    closeBtn.innerHTML = '&times;';
    closeBtn.title = 'Close speed controller';
    closeBtn.addEventListener('click', () => {
      showPanel = false;
      removePanel();
      safeSetStorage({ yt_show_panel: false });
    });
    panel.appendChild(closeBtn);

    // ── Feature 9: Mouse wheel on whole panel badge ──
    badge.addEventListener('wheel', (e) => {
      e.preventDefault();
      const step = e.deltaY < 0 ? 0.25 : -0.25;
      const next = clampSpeed(getEffectiveSpeed() + step);
      setSpeed(next, step > 0 ? 'up' : 'down');
    }, { passive: false });

    // ── Feature 5: Drag with position memory & snap ──
    let isDragging = false;
    let dragOffsetX = 0;
    let dragOffsetY = 0;

    header.addEventListener('mousedown', (e) => {
      isDragging = true;
      const rect = panel.getBoundingClientRect();
      dragOffsetX = e.clientX - rect.left;
      dragOffsetY = e.clientY - rect.top;
      panel.style.transition = 'none';
      e.preventDefault();
    });

    document.addEventListener('mousemove', (e) => {
      if (!isDragging) return;
      let nx = e.clientX - dragOffsetX;
      let ny = e.clientY - dragOffsetY;
      const clamped = clampPanelPos(nx, ny);
      panel.style.left = clamped.x + 'px';
      panel.style.top = clamped.y + 'px';
      panel.style.right = 'auto';
    });

    document.addEventListener('mouseup', () => {
      if (!isDragging) return;
      isDragging = false;
      if (!panel) return;
      const rect = panel.getBoundingClientRect();
      const { sx, sy } = snapToCorner(rect.left, rect.top, rect.width, rect.height);
      panel.style.transition = 'left 0.2s ease, top 0.2s ease';
      panel.style.left = sx + 'px';
      panel.style.top = sy + 'px';
      safeSetStorage({ yt_panel_pos: { x: sx, y: sy } });
    });

    root.appendChild(panel);

    // Restore position
    if (!isContextValid() || isShutDown) return;
    try {
      chrome.storage.local.get('yt_panel_pos', (result) => {
        if (!isContextValid() || isShutDown || chrome.runtime.lastError || !panel) return;
        if (result && result.yt_panel_pos) {
          const { x, y } = result.yt_panel_pos;
          const safePos = clampPanelPos(Number(x) || 16, Number(y) || 16);
          panel.style.left = safePos.x + 'px';
          panel.style.top = safePos.y + 'px';
          panel.style.right = 'auto';
        }
      });
    } catch (e) {
      shutdownOrphanedScript();
    }

    syncSpeedUI();
    syncAdTurboUI();
    updateSiteSpeedLabel();
  }

  window.addEventListener('resize', () => {
    if (!panel || !panel.style.left) return;
    const rect = panel.getBoundingClientRect();
    const safePos = clampPanelPos(rect.left, rect.top);
    panel.style.left = safePos.x + 'px';
    panel.style.top = safePos.y + 'px';
  });

  function switchTab(id) {
    activeTab = id;
    if (!panel) return;
    panel.querySelectorAll('.sc-tab-btn').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.tab === id);
    });
    panel.querySelectorAll('.sc-tab-content').forEach((content) => {
      content.classList.toggle('active', content.dataset.tabContent === id);
    });
  }

  function updateHintText(el) {
    const s = shortcuts;
    const hint = el || (shadowRoot ? shadowRoot.getElementById('sc-shortcut-hint') : null);
    if (!hint) return;
    hint.innerHTML = `<kbd>${s.lower}</kbd> ลด &nbsp;<kbd>${s.raise}</kbd> เพิ่ม &nbsp;<kbd>${s.reset}</kbd> Reset &nbsp;<kbd>${s.turbo}</kbd> Turbo`;
  }

  // ─── Feature 8: Presets Tab ──────────────────────────────────────────────────
  function renderPresetsTab(container) {
    container.innerHTML = '';

    const title = document.createElement('div');
    title.className = 'sc-section-title';
    title.textContent = 'Speed Presets';
    container.appendChild(title);

    const list = document.createElement('div');
    list.className = 'sc-presets-list';

    presets.forEach((preset, idx) => {
      const item = document.createElement('div');
      item.className = 'sc-preset-item';

      const applyBtn = document.createElement('button');
      applyBtn.className = 'sc-preset-btn' + (getEffectiveSpeed() === preset.speed ? ' active' : '');
      applyBtn.dataset.speed = preset.speed;
      applyBtn.innerHTML = `<span class="preset-name">${preset.name}</span><span class="preset-spd">x${preset.speed}</span>`;
      applyBtn.addEventListener('click', () => {
        setSpeed(preset.speed, preset.speed > getEffectiveSpeed() ? 'up' : 'down');
        if (panel) panel.querySelectorAll('.sc-preset-btn').forEach((b) => b.classList.remove('active'));
        applyBtn.classList.add('active');
      });

      const delBtn = document.createElement('button');
      delBtn.className = 'sc-preset-del';
      delBtn.title = 'Delete preset';
      delBtn.innerHTML = '&times;';
      delBtn.addEventListener('click', () => {
        presets.splice(idx, 1);
        safeSetStorage({ yt_presets: presets });
        renderPresetsTab(container);
      });

      item.appendChild(applyBtn);
      item.appendChild(delBtn);
      list.appendChild(item);
    });

    container.appendChild(list);

    // Add preset form
    const addRow = document.createElement('div');
    addRow.className = 'sc-add-preset-row';

    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.className = 'sc-input';
    nameInput.placeholder = 'ชื่อ preset';
    nameInput.maxLength = 20;

    const speedInput = document.createElement('input');
    speedInput.type = 'number';
    speedInput.className = 'sc-input sc-input-speed';
    speedInput.placeholder = 'x?';
    speedInput.min = MIN_SPEED;
    speedInput.max = MAX_SPEED;
    speedInput.step = 0.25;
    speedInput.value = getEffectiveSpeed();

    const addBtn = document.createElement('button');
    addBtn.className = 'sc-settings-btn';
    addBtn.textContent = '+ Add';
    addBtn.addEventListener('click', () => {
      const name = nameInput.value.trim() || ('x' + speedInput.value);
      const speed = clampSpeed(parseFloat(speedInput.value) || 1);
      presets.push({ name, speed });
      safeSetStorage({ yt_presets: presets });
      renderPresetsTab(container);
    });

    addRow.appendChild(nameInput);
    addRow.appendChild(speedInput);
    addRow.appendChild(addBtn);
    container.appendChild(addRow);
  }

  // ─── Feature 3, 4, 2, 10: Settings Tab ──────────────────────────────────────
  function renderSettingsTab(container) {
    container.innerHTML = '';

    // ── Feature 2: Per-Site Speed ──
    const siteSection = createSection(container, 'จำสปีดแยกตามเว็บ');

    const siteRow = document.createElement('div');
    siteRow.className = 'sc-settings-row';
    const siteLabel = document.createElement('span');
    siteLabel.className = 'sc-settings-label';
    siteLabel.textContent = 'Per-Site Speed';
    const siteSwitch = createToggleSwitch(useSiteSpeed, (val) => {
      useSiteSpeed = val;
      safeSetStorage({ yt_use_site_speed: val });
      syncSpeedUI();
      applyCurrentSpeed();
      broadcastSpeedToFrames(getEffectiveSpeed());
      updateSiteSpeedLabel();
    });
    siteRow.appendChild(siteLabel);
    siteRow.appendChild(siteSwitch);
    siteSection.appendChild(siteRow);

    siteSpeedLabelEl = document.createElement('div');
    siteSpeedLabelEl.className = 'sc-settings-hint';
    updateSiteSpeedLabel();
    siteSection.appendChild(siteSpeedLabelEl);

    const clearSiteBtn = document.createElement('button');
    clearSiteBtn.className = 'sc-settings-btn';
    clearSiteBtn.style.display = 'inline-flex';
    clearSiteBtn.style.alignItems = 'center';
    clearSiteBtn.style.justifyContent = 'center';
    clearSiteBtn.style.gap = '5px';
    clearSiteBtn.innerHTML = `${UI_ICONS.trash}<span>ลบสปีดของ ${CURRENT_SITE}</span>`;
    clearSiteBtn.addEventListener('click', () => {
      delete siteSpeedMap[CURRENT_SITE];
      safeSetStorage({ yt_site_speeds: siteSpeedMap });
      syncSpeedUI();
      applyCurrentSpeed();
      broadcastSpeedToFrames(getEffectiveSpeed());
      updateSiteSpeedLabel();
    });
    siteSection.appendChild(clearSiteBtn);

    const autoNextRow = document.createElement('div');
    autoNextRow.className = 'sc-settings-row';
    const autoNextLabel = document.createElement('span');
    autoNextLabel.className = 'sc-settings-label';
    autoNextLabel.textContent = 'Auto Next Lesson';
    const autoNextSwitch = createToggleSwitch(autoNextEnabled, (val) => {
      autoNextEnabled = val;
      safeSetStorage({ yt_auto_next: val });
      if (val) checkAndClickAutoNextLesson();
    });
    autoNextRow.appendChild(autoNextLabel);
    autoNextRow.appendChild(autoNextSwitch);
    siteSection.appendChild(autoNextRow);

    // ── Feature 4: Theme ──
    const themeSection = createSection(container, 'ธีม & ความโปร่งใส');

    const themeRow = document.createElement('div');
    themeRow.className = 'sc-settings-row';
    const themeLabel = document.createElement('span');
    themeLabel.className = 'sc-settings-label';
    themeLabel.textContent = 'Theme';
    const themeSel = document.createElement('select');
    themeSel.className = 'sc-select';
    [['dark', 'Dark'], ['light', 'Light'], ['auto', 'Auto']].forEach(([val, lbl]) => {
      const opt = document.createElement('option');
      opt.value = val;
      opt.textContent = lbl;
      opt.selected = currentTheme === val;
      themeSel.appendChild(opt);
    });
    themeSel.addEventListener('change', () => {
      currentTheme = themeSel.value;
      safeSetStorage({ yt_theme: currentTheme });
      applyTheme();
    });
    themeRow.appendChild(themeLabel);
    themeRow.appendChild(themeSel);
    themeSection.appendChild(themeRow);

    // Opacity slider
    const opacityRow = document.createElement('div');
    opacityRow.className = 'sc-settings-row';
    const opacityLabel = document.createElement('span');
    opacityLabel.className = 'sc-settings-label';
    opacityLabel.textContent = `ความโปร่งใส ${panelOpacity}%`;
    const opacitySlider = document.createElement('input');
    opacitySlider.type = 'range';
    opacitySlider.className = 'sc-slider sc-opacity-slider';
    opacitySlider.min = 20;
    opacitySlider.max = 100;
    opacitySlider.step = 5;
    opacitySlider.value = panelOpacity;
    opacitySlider.addEventListener('input', () => {
      panelOpacity = parseInt(opacitySlider.value);
      opacityLabel.textContent = `ความโปร่งใส ${panelOpacity}%`;
      applyOpacity();
    });
    opacitySlider.addEventListener('change', () => {
      safeSetStorage({ yt_opacity: panelOpacity });
    });
    opacityRow.appendChild(opacityLabel);
    opacityRow.appendChild(opacitySlider);
    themeSection.appendChild(opacityRow);

    // ── Feature 3: Keyboard Shortcuts ──
    const shortcutSection = createSection(container, 'แป้นพิมพ์ลัด');
    [
      ['raise', 'เพิ่มสปีด'],
      ['lower', 'ลดสปีด'],
      ['reset', 'รีเซ็ต x1'],
      ['turbo', 'เปิด/ปิด Turbo'],
    ].forEach(([key, label]) => {
      const row = document.createElement('div');
      row.className = 'sc-settings-row';
      const lbl = document.createElement('span');
      lbl.className = 'sc-settings-label';
      lbl.textContent = label;
      const input = document.createElement('input');
      input.type = 'text';
      input.className = 'sc-kbd-input';
      input.maxLength = 3;
      input.value = shortcuts[key];
      input.readOnly = true;
      input.addEventListener('keydown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        shortcuts[key] = e.key;
        input.value = e.key;
        safeSetStorage({ yt_shortcuts: shortcuts });
        updateHintText();
        input.blur();
      });
      input.addEventListener('focus', () => { input.value = '...'; });
      input.addEventListener('blur', () => { input.value = shortcuts[key]; });
      row.appendChild(lbl);
      row.appendChild(input);
      shortcutSection.appendChild(row);
    });

    const resetShortcutsBtn = document.createElement('button');
    resetShortcutsBtn.className = 'sc-settings-btn';
    resetShortcutsBtn.textContent = '↺ รีเซ็ตแป้นพิมพ์';
    resetShortcutsBtn.addEventListener('click', () => {
      shortcuts = { ...DEFAULT_SHORTCUTS };
      safeSetStorage({ yt_shortcuts: shortcuts });
      renderSettingsTab(container);
      updateHintText();
    });
    shortcutSection.appendChild(resetShortcutsBtn);

    // ── Feature 10: Blacklist / Whitelist ──
    const listSection = createSection(container, 'เว็บที่ใช้งาน');

    const listModeRow = document.createElement('div');
    listModeRow.className = 'sc-settings-row';
    const listModeLabel = document.createElement('span');
    listModeLabel.className = 'sc-settings-label';
    listModeLabel.textContent = 'โหมด';
    const listModeSel = document.createElement('select');
    listModeSel.className = 'sc-select';
    [['none', 'ทุกเว็บ'], ['blacklist', 'Blacklist'], ['whitelist', 'Whitelist']].forEach(([val, lbl]) => {
      const opt = document.createElement('option');
      opt.value = val;
      opt.textContent = lbl;
      opt.selected = listMode === val;
      listModeSel.appendChild(opt);
    });
    listModeSel.addEventListener('change', () => {
      listMode = listModeSel.value;
      safeSetStorage({ yt_list_mode: listMode });
    });
    listModeRow.appendChild(listModeLabel);
    listModeRow.appendChild(listModeSel);
    listSection.appendChild(listModeRow);

    const currentSiteRow = document.createElement('div');
    currentSiteRow.className = 'sc-settings-hint';
    currentSiteRow.textContent = `เว็บปัจจุบัน: ${CURRENT_SITE}`;
    listSection.appendChild(currentSiteRow);

    const addBlackBtn = document.createElement('button');
    addBlackBtn.className = 'sc-settings-btn';
    addBlackBtn.textContent = 'Block เว็บนี้';
    addBlackBtn.addEventListener('click', () => {
      if (!blacklist.includes(CURRENT_SITE)) {
        blacklist.push(CURRENT_SITE);
        safeSetStorage({ yt_blacklist: blacklist });
      }
    });
    listSection.appendChild(addBlackBtn);

    const addWhiteBtn = document.createElement('button');
    addWhiteBtn.className = 'sc-settings-btn';
    addWhiteBtn.textContent = 'Allow เว็บนี้';
    addWhiteBtn.addEventListener('click', () => {
      if (!whitelist.includes(CURRENT_SITE)) {
        whitelist.push(CURRENT_SITE);
        safeSetStorage({ yt_whitelist: whitelist });
      }
    });
    listSection.appendChild(addWhiteBtn);

    // ── Ad Skip Keywords Editor ──
    const keywordSection = createSection(container, 'คำคีย์เวิร์ดกดข้ามโฆษณา (Ad Skip Keywords)');
    const kwTagsWrap = document.createElement('div');
    kwTagsWrap.className = 'sc-tags-wrap';
    const renderKeywords = () => {
      kwTagsWrap.innerHTML = '';
      skipKeywords.forEach((kw, idx) => {
        const tag = document.createElement('span');
        tag.className = 'sc-tag';
        tag.textContent = kw + ' ';
        const rm = document.createElement('b');
        rm.textContent = '×';
        rm.addEventListener('click', () => {
          skipKeywords.splice(idx, 1);
          safeSetStorage({ yt_skip_keywords: skipKeywords });
          renderKeywords();
        });
        tag.appendChild(rm);
        kwTagsWrap.appendChild(tag);
      });
    };
    renderKeywords();
    keywordSection.appendChild(kwTagsWrap);

    const kwAddRow = document.createElement('div');
    kwAddRow.className = 'sc-add-preset-row';
    const kwInput = document.createElement('input');
    kwInput.type = 'text';
    kwInput.className = 'sc-input';
    kwInput.placeholder = 'เพิ่มคำข้าม เช่น skip, ปิด';
    const kwAddBtn = document.createElement('button');
    kwAddBtn.className = 'sc-settings-btn';
    kwAddBtn.textContent = '+ Add';
    kwAddBtn.addEventListener('click', () => {
      const val = kwInput.value.trim().toLowerCase();
      if (val && !skipKeywords.includes(val)) {
        skipKeywords.push(val);
        safeSetStorage({ yt_skip_keywords: skipKeywords });
        kwInput.value = '';
        renderKeywords();
      }
    });
    kwAddRow.appendChild(kwInput);
    kwAddRow.appendChild(kwAddBtn);
    keywordSection.appendChild(kwAddRow);

    const kwResetBtn = document.createElement('button');
    kwResetBtn.className = 'sc-settings-btn';
    kwResetBtn.textContent = '↺ รีเซ็ตคำคีย์เวิร์ดข้ามโฆษณา';
    kwResetBtn.addEventListener('click', () => {
      skipKeywords = [...DEFAULT_SKIP_KEYWORDS];
      safeSetStorage({ yt_skip_keywords: skipKeywords });
      renderKeywords();
    });
    keywordSection.appendChild(kwResetBtn);

    // ── Gambling Domains Editor (Ad Blocker) ──
    const domainSection = createSection(container, 'รายการบล็อกเว็บพนัน (Gambling Domains)');
    const domTagsWrap = document.createElement('div');
    domTagsWrap.className = 'sc-tags-wrap';
    const renderDomains = () => {
      domTagsWrap.innerHTML = '';
      gamblingDomains.forEach((dom, idx) => {
        const tag = document.createElement('span');
        tag.className = 'sc-tag sc-tag-domain';
        tag.textContent = dom + ' ';
        const rm = document.createElement('b');
        rm.textContent = '×';
        rm.addEventListener('click', () => {
          gamblingDomains.splice(idx, 1);
          safeSetStorage({ yt_gambling_domains: gamblingDomains });
          renderDomains();
        });
        tag.appendChild(rm);
        domTagsWrap.appendChild(tag);
      });
    };
    renderDomains();
    domainSection.appendChild(domTagsWrap);

    const domAddRow = document.createElement('div');
    domAddRow.className = 'sc-add-preset-row';
    const domInput = document.createElement('input');
    domInput.type = 'text';
    domInput.className = 'sc-input';
    domInput.placeholder = 'เพิ่มโดเมน เช่น ufabet, sbobet';
    const domAddBtn = document.createElement('button');
    domAddBtn.className = 'sc-settings-btn';
    domAddBtn.textContent = '+ Add';
    domAddBtn.addEventListener('click', () => {
      const val = domInput.value.trim().toLowerCase();
      if (val && !gamblingDomains.includes(val)) {
        gamblingDomains.push(val);
        safeSetStorage({ yt_gambling_domains: gamblingDomains });
        domInput.value = '';
        renderDomains();
      }
    });
    domAddRow.appendChild(domInput);
    domAddRow.appendChild(domAddBtn);
    domainSection.appendChild(domAddRow);

    const domResetBtn = document.createElement('button');
    domResetBtn.className = 'sc-settings-btn';
    domResetBtn.textContent = '↺ รีเซ็ตโดเมนเว็บพนัน';
    domResetBtn.addEventListener('click', () => {
      gamblingDomains = [...DEFAULT_GAMBLING_DOMAINS];
      safeSetStorage({ yt_gambling_domains: gamblingDomains });
      renderDomains();
    });
    domainSection.appendChild(domResetBtn);
  }

  function createSection(parent, titleText) {
    const section = document.createElement('div');
    section.className = 'sc-settings-section';
    const title = document.createElement('div');
    title.className = 'sc-section-title';
    title.textContent = titleText;
    section.appendChild(title);
    parent.appendChild(section);
    return section;
  }

  function createToggleSwitch(checked, onChange) {
    const label = document.createElement('label');
    label.className = 'sc-mini-switch';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = checked;
    input.addEventListener('change', () => onChange(input.checked));
    const span = document.createElement('span');
    span.className = 'sc-mini-slider';
    label.appendChild(input);
    label.appendChild(span);
    return label;
  }

  function removePanel() {
    const el = shadowRoot ? shadowRoot.getElementById('yt-speed-panel') : null;
    if (el) el.remove();
    panel = null;
    badge = null;
    adTurboBtn = null;
    adBlockerBtn = null;
    sliderEl = null;
    sliderValueEl = null;
    statsContainerEl = null;
    siteSpeedLabelEl = null;
  }

  // ─── Load Saved State ─────────────────────────────────────────────────────────
  function loadSavedState() {
    if (!isContextValid() || isShutDown) {
      shutdownOrphanedScript();
      return;
    }
    try {
      chrome.storage.local.get(STORAGE_KEYS, (result) => {
        if (!isContextValid() || isShutDown || chrome.runtime.lastError) {
          shutdownOrphanedScript();
          return;
        }
        if (typeof result.yt_speed === 'number') currentSpeed = result.yt_speed;
        if (typeof result.yt_ad_turbo === 'boolean') adTurboEnabled = result.yt_ad_turbo;
        if (typeof result.yt_ad_blocker === 'boolean') adBlockerEnabled = result.yt_ad_blocker;
        if (typeof result.yt_auto_next === 'boolean') autoNextEnabled = result.yt_auto_next;
        if (typeof result.yt_show_panel === 'boolean') showPanel = result.yt_show_panel;
        if (typeof result.yt_opacity === 'number') panelOpacity = result.yt_opacity;
        if (typeof result.yt_theme === 'string') currentTheme = result.yt_theme;
        if (result.yt_site_speeds && typeof result.yt_site_speeds === 'object') siteSpeedMap = result.yt_site_speeds;
        if (typeof result.yt_use_site_speed === 'boolean') useSiteSpeed = result.yt_use_site_speed;
        if (result.yt_shortcuts && typeof result.yt_shortcuts === 'object') shortcuts = { ...DEFAULT_SHORTCUTS, ...result.yt_shortcuts };
        if (result.yt_stats && typeof result.yt_stats === 'object') stats = { ...stats, ...result.yt_stats };
        if (result.yt_ad_blocker_stats && typeof result.yt_ad_blocker_stats === 'object') adBlockerStats = { ...adBlockerStats, ...result.yt_ad_blocker_stats };
        if (Array.isArray(result.yt_presets)) presets = result.yt_presets;
        if (Array.isArray(result.yt_blacklist)) blacklist = result.yt_blacklist;
        if (Array.isArray(result.yt_whitelist)) whitelist = result.yt_whitelist;
        if (typeof result.yt_list_mode === 'string') listMode = result.yt_list_mode;
        if (Array.isArray(result.yt_skip_keywords) && result.yt_skip_keywords.length) skipKeywords = result.yt_skip_keywords;
        if (Array.isArray(result.yt_gambling_domains) && result.yt_gambling_domains.length) gamblingDomains = result.yt_gambling_domains;
        isStateLoaded = true;

        syncSpeedUI();
        syncAdTurboUI();
        syncAdBlockerUI();
        if (adBlockerEnabled) {
          watchForInjectedAds();
          scanAndBlockOverlays();
        }
        if (autoNextEnabled) {
          checkAndClickAutoNextLesson();
        }
        waitForVideo(() => {
          applyCurrentSpeed();
          broadcastSpeedToFrames(getEffectiveSpeed());
        });
      });
    } catch (e) {
      console.warn('[Speed Controller] Failed to load saved state:', e);
      shutdownOrphanedScript();
    }
  }

  // ─── Storage Listener ─────────────────────────────────────────────────────────
  if (isContextValid()) {
    try {
      chrome.storage.onChanged.addListener((changes, areaName) => {
        try {
          if (!isContextValid() || isShutDown) {
            shutdownOrphanedScript();
            return;
          }
          if (areaName !== 'local') return;

          if (changes.yt_speed) {
            currentSpeed = changes.yt_speed.newValue ?? currentSpeed;
            if (!useSiteSpeed) {
              syncSpeedUI();
              applyCurrentSpeed();
              broadcastSpeedToFrames(getEffectiveSpeed());
            }
          }
          if (changes.yt_ad_turbo) {
            adTurboEnabled = changes.yt_ad_turbo.newValue !== false;
            syncAdTurboUI();
            applyCurrentSpeed();
          }
          if (changes.yt_ad_blocker) {
            adBlockerEnabled = Boolean(changes.yt_ad_blocker.newValue);
            syncAdBlockerUI();
            if (adBlockerEnabled) {
              watchForInjectedAds();
              scanAndBlockOverlays();
            } else {
              stopWatchingInjectedAds();
            }
          }
          if (changes.yt_auto_next) {
            autoNextEnabled = Boolean(changes.yt_auto_next.newValue);
            if (autoNextEnabled) checkAndClickAutoNextLesson();
          }
          if (changes.yt_skip_keywords) {
            if (Array.isArray(changes.yt_skip_keywords.newValue) && changes.yt_skip_keywords.newValue.length) {
              skipKeywords = changes.yt_skip_keywords.newValue;
            }
          }
          if (changes.yt_gambling_domains) {
            if (Array.isArray(changes.yt_gambling_domains.newValue) && changes.yt_gambling_domains.newValue.length) {
              gamblingDomains = changes.yt_gambling_domains.newValue;
            }
          }
          if (changes.yt_show_panel) {
            showPanel = changes.yt_show_panel.newValue !== false;
            if (showPanel) createPanel();
            else removePanel();
          }
          if (changes.yt_opacity) {
            panelOpacity = changes.yt_opacity.newValue;
            applyOpacity();
          }
          if (changes.yt_theme) {
            currentTheme = changes.yt_theme.newValue;
            applyTheme();
          }
          if (changes.yt_use_site_speed) {
            useSiteSpeed = changes.yt_use_site_speed.newValue !== false;
            syncSpeedUI();
            applyCurrentSpeed();
            broadcastSpeedToFrames(getEffectiveSpeed());
            updateSiteSpeedLabel();
          }
          if (changes.yt_site_speeds) {
            siteSpeedMap = changes.yt_site_speeds.newValue || {};
            if (useSiteSpeed) {
              syncSpeedUI();
              applyCurrentSpeed();
              broadcastSpeedToFrames(getEffectiveSpeed());
            }
            updateSiteSpeedLabel();
          }
        } catch (e) {
          shutdownOrphanedScript();
        }
      });
    } catch (e) {
      shutdownOrphanedScript();
    }
  }

  // ─── Popup / iframe command bridge ──────────────────────────────────────────
  if (isContextValid()) {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (!message || isShutDown) return;
      if (message.type === 'SET_SPEED' && Number.isFinite(Number(message.speed))) {
        const nextSpeed = clampSpeed(Number(message.speed));
        if (IS_TOP_FRAME) {
          setSpeed(nextSpeed, 'neutral');
          sendResponse({ ok: true, speed: getEffectiveSpeed() });
          return true;
        }
        // In child iframes: apply directly without polluting siteSpeedMap or racing sendResponse
        frameOverrideSpeed = nextSpeed;
        applyCurrentSpeed();
        broadcastSpeedToFrames(nextSpeed);
        return;
      }
      if (message.type === 'GET_SPEED') {
        if (!IS_TOP_FRAME) return;
        sendResponse({ ok: true, speed: getEffectiveSpeed(), site: CURRENT_SITE });
        return true;
      }
    });
  }

  window.addEventListener('message', (event) => {
    const data = event.data;
    if (!data || data.source !== 'speed-controller-turbo') return;
    if (data.type === 'SET_SPEED' && !IS_TOP_FRAME && Number.isFinite(Number(data.speed))) {
      frameOverrideSpeed = clampSpeed(Number(data.speed));
      syncSpeedUI();
      applyCurrentSpeed();
      broadcastSpeedToFrames(frameOverrideSpeed);
    }
  });

  function reportFrameVideo() {
    if (IS_TOP_FRAME || !getAllVideos().length) return;
    try {
      window.top.postMessage({ source: 'speed-controller-turbo', type: 'FRAME_VIDEO_AVAILABLE' }, '*');
    } catch { /* ignore inaccessible/disposed parent frames */ }
  }

  if (IS_TOP_FRAME) {
    window.addEventListener('message', (event) => {
      const data = event.data;
      if (!data || data.source !== 'speed-controller-turbo' || data.type !== 'FRAME_VIDEO_AVAILABLE') return;
      if (isStateLoaded) {
        broadcastSpeedToFrames(getEffectiveSpeed());
        if (showPanel && isSiteAllowed()) createPanel();
      }
    });
  }

  // ─── Intervals ───────────────────────────────────────────────────────────────
  registerInterval(() => {
    tagVideos();
    reportFrameVideo();
    if (!panel && getAllVideos().length && canShowFloatingPanel()) createPanel();
  }, VIDEO_SCAN_INTERVAL);

  registerInterval(() => {
    const videos = getAllVideos();
    videos.forEach((v) => applyVideoSpeed(v));
    if (badge && videos.length) badge.textContent = 'x' + getTargetSpeed();
  }, SPEED_SYNC_INTERVAL);

  // ─── Ad Turbo Engine (main loop) ──────────────────────────────────────────
  function resetAdTurboState() {
    if (!isCurrentlyInAdTurbo) return;
    isCurrentlyInAdTurbo = false;
    stopAdSkipRetry();
    const restoreSpeed = preAdSpeed || getEffectiveSpeed();
    const videos = getAllVideos();
    videos.forEach((video) => {
      try {
        video.__tfLastInternalSetAt = performance.now();
        video.playbackRate = restoreSpeed;
        video.defaultPlaybackRate = restoreSpeed;
      } catch { /* ignore */ }
      try {
        if (preAdMutedStates.has(video)) video.muted = preAdMutedStates.get(video);
        if (preAdVolumeStates.has(video)) {
          const vol = preAdVolumeStates.get(video);
          if (typeof vol === 'number' && vol >= 0 && vol <= 1) video.volume = vol;
        }
      } catch { /* ignore */ }
    });
    preAdMutedStates = new WeakMap();
    preAdVolumeStates = new WeakMap();
    preAdSpeed = null;
    adStartedAt = 0;
    adRampSpeed = null;
    updateBadge();
  }

  registerInterval(() => {
    if (!adTurboEnabled) return;

    const videos = getAllVideos();
    if (!videos.length) {
      if (isCurrentlyInAdTurbo) resetAdTurboState();
      return;
    }
    const hasAd = videos.some(isAdVideo);

    if (hasAd) {
      // เข้าสู่โหมดเร่งโฆษณา
      if (!isCurrentlyInAdTurbo) {
        preAdSpeed = getEffectiveSpeed();
        isCurrentlyInAdTurbo = true;
        adStartedAt = Date.now();
        adRampSpeed = randomAdRampSpeed();
        startAdSkipRetry();
        updateBadge();
      }

      // เร่ง x16 + Mute อัตโนมัติ
      videos.forEach((video) => {
        if (isAdVideo(video)) {
          const adSpeed = getAdTurboSpeed();
          if (video.playbackRate !== adSpeed) video.playbackRate = adSpeed;
          if (video.defaultPlaybackRate !== adSpeed) video.defaultPlaybackRate = adSpeed;

          if (!preAdMutedStates.has(video)) {
            preAdMutedStates.set(video, video.muted);
            preAdVolumeStates.set(video, video.volume);
          }
          if (!video.muted) {
            video.muted = true;
          }
        }
      });

      // พยายามกดข้าม
      findAndClickSkipButton();

    } else if (isCurrentlyInAdTurbo) {
      // โฆษณาจบแล้ว → ปรับกลับสปีดเดิม และเปิดเสียงกลับมาเท่าเดิม
      const restoreSpeed = preAdSpeed || getEffectiveSpeed();
      resetAdTurboState();
      showOSD(restoreSpeed, 'neutral');
    }
  }, AD_SYNC_INTERVAL);

  // ─── Auto Next Lesson Periodic Check ──────────────────────────────────────
  registerInterval(() => {
    if (autoNextEnabled) {
      checkAndClickAutoNextLesson();
    }
  }, 1200);

  // ─── Ad Overlay Blocker Engine (Periodic Scan) ────────────────────────────
  registerInterval(() => {
    if (adBlockerEnabled) {
      scanAndBlockOverlays();
    }
  }, AD_BLOCKER_SCAN_INTERVAL);

  // ─── Feature 3: Keyboard Shortcuts + Hold Spacebar to Boost ──────────────────
  document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;

    // Hold Spacebar (>250ms) to temporarily boost speed to x2.5
    if (e.code === 'Space' && getAllVideos().length > 0) {
      if (e.repeat) {
        if (holdBoostActive) {
          e.preventDefault();
          e.stopImmediatePropagation();
        }
        return;
      }
      if (!spaceHoldTimer && !holdBoostActive) {
        spaceHoldTimer = setTimeout(() => {
          spaceHoldTimer = null;
          holdBoostActive = true;
          suppressSpaceKeyup = true;
          applyCurrentSpeed();
          showOSD(HOLD_BOOST_SPEED, 'up');
        }, HOLD_BOOST_DELAY_MS);
      }
      return;
    }

    const spd = getEffectiveSpeed();

    if (e.key === shortcuts.raise) {
      e.preventDefault(); e.stopPropagation();
      const idx = SPEEDS.indexOf(clampSpeed(Math.round(spd / 0.25) * 0.25));
      const nextIdx = SPEEDS.findIndex((s) => s > spd);
      if (nextIdx !== -1) setSpeed(SPEEDS[nextIdx], 'up');
    } else if (e.key === shortcuts.lower) {
      e.preventDefault(); e.stopPropagation();
      const prevSpeeds = SPEEDS.filter((s) => s < spd);
      if (prevSpeeds.length) setSpeed(prevSpeeds[prevSpeeds.length - 1], 'down');
    } else if (e.key === shortcuts.reset) {
      e.preventDefault(); e.stopPropagation();
      setSpeed(1, 'neutral');
    } else if (e.key === shortcuts.turbo) {
      e.preventDefault(); e.stopPropagation();
      toggleAdTurbo(!adTurboEnabled);
    }
  }, true);

  document.addEventListener('keyup', (e) => {
    if (e.code !== 'Space') return;
    clearTimeout(spaceHoldTimer);
    spaceHoldTimer = null;

    if (holdBoostActive) {
      holdBoostActive = false;
      applyCurrentSpeed();
      showOSD(getEffectiveSpeed(), 'neutral');
      if (suppressSpaceKeyup) {
        suppressSpaceKeyup = false;
        e.preventDefault();
        e.stopImmediatePropagation();
        const vids = getControlVideos();
        if (vids[0] && vids[0].paused) {
          vids[0].play().catch(() => {});
        }
      }
    }
  }, true);

  window.addEventListener('blur', () => {
    clearTimeout(spaceHoldTimer);
    spaceHoldTimer = null;
    if (holdBoostActive) {
      holdBoostActive = false;
      applyCurrentSpeed();
    }
  });

  // ─── Feature 9: Mouse Wheel on Video ─────────────────────────────────────────
  document.addEventListener('wheel', (e) => {
    if (!e.ctrlKey) return;
    const target = e.target;
    const isOnVideo = target.tagName === 'VIDEO' || target.closest('video');
    if (!isOnVideo) return;
    e.preventDefault();
    e.stopPropagation();
    const step = e.deltaY < 0 ? 0.25 : -0.25;
    setSpeed(clampSpeed(getEffectiveSpeed() + step), step > 0 ? 'up' : 'down');
  }, { passive: false, capture: true });

  // ─── Lightweight SPA URL Detection & Targeted DOM Observer ──────────────────
  function handleUrlChange() {
    if (location.href === lastUrl) return;
    lastUrl = location.href;
    cachedVideos = [];
    lastVideoScanTime = 0;
    videoDomDirty = true;
    resetAdTurboState();
    waitForVideo(() => {
      applyCurrentSpeed();
      broadcastSpeedToFrames(getEffectiveSpeed());
    });
  }

  if (typeof window.navigation !== 'undefined' && window.navigation.addEventListener) {
    window.navigation.addEventListener('navigatesuccess', handleUrlChange);
  }
  window.addEventListener('popstate', handleUrlChange);
  window.addEventListener('hashchange', handleUrlChange);
  window.addEventListener('yt-navigate-finish', handleUrlChange);

  const mutationObserver = new MutationObserver((mutations) => {
    if (!isContextValid() || isShutDown) {
      shutdownOrphanedScript();
      return;
    }
    if (location.href !== lastUrl) {
      handleUrlChange();
    }

    let sawNewElement = false;
    for (let i = 0; i < mutations.length; i++) {
      const added = mutations[i].addedNodes;
      for (let j = 0; j < added.length; j++) {
        const n = added[j];
        if (n.nodeType === 1 && n.id !== 'yt-speed-root') {
          sawNewElement = true;
          break;
        }
      }
      if (sawNewElement) break;
    }

    if (sawNewElement) {
      videoDomDirty = true;
      if (autoNextEnabled && !autoNextDebounceTimer) {
        autoNextDebounceTimer = setTimeout(() => {
          autoNextDebounceTimer = null;
          checkAndClickAutoNextLesson();
        }, 120);
      }
    }

    if (isCurrentlyInAdTurbo && isYouTube() && !adMutationSkipTimer) {
      adMutationSkipTimer = setTimeout(() => {
        adMutationSkipTimer = null;
        findAndClickSkipButton();
      }, 60);
    }
  });
  const targetNode = document.body || document.documentElement;
  if (targetNode) {
    mutationObserver.observe(targetNode, { childList: true, subtree: true });
    activeObservers.add(mutationObserver);
  }

  // ─── Tag Videos (with Exponential Backoff Fight-Back) ───────────────────────
  function tagVideos() {
    const videos = getAllVideos();
    videos.forEach((video) => {
      getVideoKey(video);
      video.dataset.ytSpeedKey = video.__ytSpeedKey;
      if (!video.__ytSpeedListenersAttached) {
        video.__ytSpeedListenersAttached = true;
        video.__tfFightBackCount = 0;

        ['play', 'playing', 'loadedmetadata', 'durationchange'].forEach((ev) => {
          video.addEventListener(ev, () => {
            window.setTimeout(() => applyVideoSpeed(video), 0);
          });
        });

        video.addEventListener('ratechange', () => {
          // Ignore ratechange fired by our own assignment
          if (performance.now() - (video.__tfLastInternalSetAt || 0) < 60) return;

          clearTimeout(video.__tfFightBackTimer);
          video.__tfFightBackTimer = window.setTimeout(() => {
            applyVideoSpeed(video);
          }, 40);
        });
      }
    });
  }

  // ─── Init ───────────────────────────────────────────────────────────────────
  loadSavedState();
  initStatsTracking();
  waitForVideo(() => {
    createPanel();
    tagVideos();
    applyCurrentSpeed();
  });
})();
