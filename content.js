// Speed Controller Turbo - Content Script v3.0
// Ad Turbo: auto speed-up ads x16 + universal keyword-based ad skip.

(() => {
  'use strict';

  // ─── Constants ───────────────────────────────────────────────────────────────
  const SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 5, 6, 8, 10, 12, 16];
  const TURBO_SPEED = 16;
  const MIN_SPEED = 0.25;
  const MAX_SPEED = 16;
  const VIDEO_SCAN_INTERVAL = 1000;
  const SPEED_SYNC_INTERVAL = 2000;
  const AD_SYNC_INTERVAL = 500;
  const TURBO_LIST_SCAN_INTERVAL = 1500;
  const STATS_SAVE_INTERVAL = 10000;
  const OSD_DURATION = 1500;
  const CURRENT_SITE = location.hostname.replace(/^www\./, '');
  const IS_TOP_FRAME = (() => {
    try {
      return window.self === window.top;
    } catch {
      return false;
    }
  })();

  const DEFAULT_SHORTCUTS = { raise: ']', lower: '[', reset: '\\', turbo: 't' };
  const AD_BLOCKER_SCAN_INTERVAL = 2000;

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
    'yt_ad_blocker', 'yt_gambling_domains', 'yt_ad_blocker_stats'
  ];

  // ─── State ───────────────────────────────────────────────────────────────────
  let currentSpeed = 1;
  let adTurboEnabled = true;        // เปิด/ปิด Ad Turbo
  let adBlockerEnabled = false;     // เปิด/ปิด Ad Blocker (ค่าเริ่มต้นปิด ป้องกัน false positive)
  let showPanel = true;
  let isStateLoaded = false;
  let panelOpacity = 92;
  let currentTheme = 'dark'; // 'dark' | 'light' | 'auto'
  let siteSpeedMap = {};
  let useSiteSpeed = false;
  let shortcuts = { ...DEFAULT_SHORTCUTS };
  let stats = { savedSeconds: 0, topSpeed: 1, todayVideos: 0, lastDate: '' };
  let adBlockerStats = { blocked: 0, session: 0 };
  let presets = []; // [{name, speed}]
  let blacklist = []; // hostnames
  let whitelist = []; // hostnames
  let listMode = 'none'; // 'none' | 'blacklist' | 'whitelist'
  let skipKeywords = [...DEFAULT_SKIP_KEYWORDS];
  let gamblingDomains = [...DEFAULT_GAMBLING_DOMAINS];
  let preAdSpeed = null;             // สปีดก่อนเร่งโฆษณา
  let isCurrentlyInAdTurbo = false;  // กำลังเร่งโฆษณาอยู่หรือไม่

  // Panel refs
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

  function runPageScript(code) {
    if (!isContextValid() || isShutDown) return;
    const event = new CustomEvent('SpeedControllerRunScript', { detail: code });
    document.dispatchEvent(event);
  }

  function injectHelperScript() {
    if (!isContextValid() || isShutDown) return;
    try {
      const script = document.createElement('script');
      script.src = chrome.runtime.getURL('inject.js');
      script.onload = () => script.remove();
      (document.head || document.documentElement).appendChild(script);
    } catch (e) {
      console.warn('[Speed Controller] Failed to inject helper script:', e);
    }
  }

  function shutdownOrphanedScript() {
    if (isShutDown) return;
    isShutDown = true;
    console.log('[Speed Controller] Extension context invalidated. Shutting down orphaned content script cleanly.');
    for (const id of activeIntervals) clearInterval(id);
    activeIntervals.clear();
    for (const obs of activeObservers) {
      try { obs.disconnect(); } catch (e) {}
    }
    activeObservers.clear();
    removePanel();
  }

  function registerInterval(cb, ms) {
    const id = setInterval(() => {
      if (!isContextValid()) {
        shutdownOrphanedScript();
        return;
      }
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
    if (useSiteSpeed && siteSpeedMap[CURRENT_SITE] !== undefined) {
      return siteSpeedMap[CURRENT_SITE];
    }
    return currentSpeed;
  }

  function getTargetSpeed() {
    return isCurrentlyInAdTurbo ? TURBO_SPEED : getEffectiveSpeed();
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

  function collectVideosFromRoot(root, found = []) {
    if (!root || !root.querySelectorAll) return found;
    root.querySelectorAll('video').forEach((v) => { if (!found.includes(v)) found.push(v); });
    root.querySelectorAll('*').forEach((el) => {
      if (el.shadowRoot) collectVideosFromRoot(el.shadowRoot, found);
    });
    return found;
  }

  function getAllVideos() {
    return collectVideosFromRoot(document);
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
    if (document.querySelector('.ad-showing, .ad-interrupting, .ytp-ad-player-overlay')) {
      if (document.querySelector('.html5-video-player')?.classList.contains('ad-showing')) return true;
    }

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

  function findAndClickSkipButton() {
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

  // ─── Ad Overlay Blocker Engine (7 Algorithms) ───────────────────────────────
  let adBlockerObserver = null;

  function isSafeToHide(el) {
    if (!el || el === document.body || el === document.documentElement) return false;
    if (el.id === 'yt-speed-panel' || el.closest('#yt-speed-panel')) return false;
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
    const all = root.querySelectorAll ? root.querySelectorAll('*') : [];
    const vpW = window.innerWidth, vpH = window.innerHeight;
    
    for (const el of all) {
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
    const all = root.querySelectorAll ? root.querySelectorAll('div, span, a') : [];
    const vpW = window.innerWidth, vpH = window.innerHeight;
    
    for (const el of all) {
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

  // Algorithm 7: MutationObserver
  function watchForInjectedAds() {
    if (adBlockerObserver) return;
    adBlockerObserver = new MutationObserver((mutations) => {
      if (!adBlockerEnabled) return;
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node.nodeType === 1 && isSafeToHide(node)) {
            scanAndBlockOverlays(node);
          }
        }
      }
    });
    const targetNode = document.body || document.documentElement;
    if (targetNode) {
      adBlockerObserver.observe(targetNode, { childList: true, subtree: true });
    }
  }

  function stopWatchingInjectedAds() {
    if (adBlockerObserver) {
      adBlockerObserver.disconnect();
      adBlockerObserver = null;
    }
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

  // ─── Speed Application ───────────────────────────────────────────────────────
  function applyVideoSpeed(video) {
    if (!video) return null;
    const isAd = isAdVideo(video);
    // เร่ง x16 เฉพาะโฆษณาเมื่อ Ad Turbo เปิด
    const shouldTurbo = isAd && adTurboEnabled;
    const targetSpeed = shouldTurbo ? TURBO_SPEED : getEffectiveSpeed();
    try {
      if (video.defaultPlaybackRate !== targetSpeed) video.defaultPlaybackRate = targetSpeed;
      if (video.playbackRate !== targetSpeed) video.playbackRate = targetSpeed;
    } catch (e) {
      console.warn('Speed Controller could not update this video:', e);
    }
    return targetSpeed;
  }

  function applyCurrentSpeed() {
    const videos = getAllVideos();
    if (!videos.length) return;
    videos.forEach((v) => applyVideoSpeed(v));
    updateBadge();
  }

  function updateBadge() {
    if (badge) badge.textContent = 'x' + getTargetSpeed();
    if (sliderEl) {
      sliderEl.value = getEffectiveSpeed();
      if (sliderValueEl) sliderValueEl.textContent = 'x' + getEffectiveSpeed();
    }
  }

  // ─── Feature 6: Speed OSD ────────────────────────────────────────────────────
  function showOSD(speed, direction) {
    if (!osdEl) {
      osdEl = document.createElement('div');
      osdEl.id = 'yt-speed-osd';
      document.body.appendChild(osdEl);
    }
    const arrow = direction === 'up' ? '⏩' : direction === 'down' ? '⏪' : '↺';
    osdEl.innerHTML = `<span class="osd-arrow">${arrow}</span><span class="osd-val">x${speed}</span>`;
    osdEl.classList.remove('osd-fade');
    void osdEl.offsetWidth; // reflow to restart animation
    osdEl.classList.add('osd-show');

    clearTimeout(osdTimer);
    osdTimer = setTimeout(() => {
      osdEl.classList.remove('osd-show');
      osdEl.classList.add('osd-fade');
    }, OSD_DURATION);
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

    // Feature 2: Per-Site Speed Memory
    if (useSiteSpeed) {
      siteSpeedMap[CURRENT_SITE] = clamped;
      safeSetStorage({ yt_site_speeds: siteSpeedMap });
    } else {
      currentSpeed = clamped;
      safeSetStorage({ yt_speed: clamped });
    }

    syncSpeedUI();
    applyCurrentSpeed();
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

  function syncSpeedUI() {
    const spd = getEffectiveSpeed();
    if (badge) badge.textContent = 'x' + getTargetSpeed();
    if (sliderEl) {
      sliderEl.value = spd;
      if (sliderValueEl) sliderValueEl.textContent = 'x' + spd;
    }
    // Update preset buttons active state
    const presetBtns = document.querySelectorAll('.sc-preset-btn');
    presetBtns.forEach((btn) => {
      btn.classList.toggle('active', parseFloat(btn.dataset.speed) === spd);
    });
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
    adTurboBtn.textContent = adTurboEnabled ? '⚡ Ad Turbo: ON' : '⚡ Ad Turbo: OFF';
  }

  function syncAdBlockerUI() {
    if (!adBlockerBtn) return;
    adBlockerBtn.classList.toggle('active', adBlockerEnabled);
    const blockedCount = adBlockerStats.session || 0;
    adBlockerBtn.textContent = adBlockerEnabled ? `🛡️ Ad Blocker: ON (${blockedCount})` : '🛡️ Ad Blocker: OFF';
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
      <div class="sc-stat-row"><span class="sc-stat-label">⏱ ประหยัดเวลา</span><span class="sc-stat-val">${formatTime(stats.savedSeconds)}</span></div>
      <div class="sc-stat-row"><span class="sc-stat-label">🏆 สปีดสูงสุด</span><span class="sc-stat-val">x${stats.topSpeed}</span></div>
      <div class="sc-stat-row"><span class="sc-stat-label">📺 วิดีโอวันนี้</span><span class="sc-stat-val">${stats.todayVideos}</span></div>
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
    if (document.getElementById('yt-speed-panel')) return;

    panel = document.createElement('div');
    panel.id = 'yt-speed-panel';
    applyTheme();
    applyOpacity();

    // ── Header ──
    const header = document.createElement('div');
    header.className = 'sc-header';

    const title = document.createElement('span');
    title.className = 'sc-title';
    title.textContent = '⚡ Speed';

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
      { id: 'speed', label: '🎛️ Speed' },
      { id: 'presets', label: '⚡ Presets' },
      { id: 'stats', label: '📊 Stats' },
      { id: 'settings', label: '⚙️' },
    ];
    tabs.forEach(({ id, label }) => {
      const btn = document.createElement('button');
      btn.className = 'sc-tab-btn' + (id === activeTab ? ' active' : '');
      btn.dataset.tab = id;
      btn.textContent = label;
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
    resetStatsBtn.textContent = '🗑 รีเซ็ตสถิติ';
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

    document.body.appendChild(panel);

    // Restore position
    if (!isContextValid() || isShutDown) return;
    try {
      chrome.storage.local.get('yt_panel_pos', (result) => {
        if (!isContextValid() || isShutDown || chrome.runtime.lastError) return;
        if (result && result.yt_panel_pos) {
          const { x, y } = result.yt_panel_pos;
          panel.style.left = x + 'px';
          panel.style.top = y + 'px';
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

  function switchTab(id) {
    activeTab = id;
    document.querySelectorAll('.sc-tab-btn').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.tab === id);
    });
    document.querySelectorAll('.sc-tab-content').forEach((content) => {
      content.classList.toggle('active', content.dataset.tabContent === id);
    });
  }

  function updateHintText(el) {
    const s = shortcuts;
    const hint = el || document.getElementById('sc-shortcut-hint');
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
        document.querySelectorAll('.sc-preset-btn').forEach((b) => b.classList.remove('active'));
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
      applyCurrentSpeed();
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
    clearSiteBtn.textContent = `🗑 ลบสปีดของ ${CURRENT_SITE}`;
    clearSiteBtn.addEventListener('click', () => {
      delete siteSpeedMap[CURRENT_SITE];
      safeSetStorage({ yt_site_speeds: siteSpeedMap });
      updateSiteSpeedLabel();
    });
    siteSection.appendChild(clearSiteBtn);

    // ── Feature 4: Theme ──
    const themeSection = createSection(container, 'ธีม & ความโปร่งใส');

    const themeRow = document.createElement('div');
    themeRow.className = 'sc-settings-row';
    const themeLabel = document.createElement('span');
    themeLabel.className = 'sc-settings-label';
    themeLabel.textContent = 'Theme';
    const themeSel = document.createElement('select');
    themeSel.className = 'sc-select';
    [['dark', '🌙 Dark'], ['light', '☀️ Light'], ['auto', '🔄 Auto']].forEach(([val, lbl]) => {
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
    addBlackBtn.textContent = '🚫 Block เว็บนี้';
    addBlackBtn.addEventListener('click', () => {
      if (!blacklist.includes(CURRENT_SITE)) {
        blacklist.push(CURRENT_SITE);
        safeSetStorage({ yt_blacklist: blacklist });
      }
    });
    listSection.appendChild(addBlackBtn);

    const addWhiteBtn = document.createElement('button');
    addWhiteBtn.className = 'sc-settings-btn';
    addWhiteBtn.textContent = '✅ Allow เว็บนี้';
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
    const el = document.getElementById('yt-speed-panel');
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

        syncAdTurboUI();
        syncAdBlockerUI();
        if (adBlockerEnabled) {
          watchForInjectedAds();
          scanAndBlockOverlays();
        }
        waitForVideo(() => applyCurrentSpeed());
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
            syncSpeedUI();
            applyCurrentSpeed();
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
          if (changes.yt_site_speeds) {
            siteSpeedMap = changes.yt_site_speeds.newValue || {};
            applyCurrentSpeed();
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

  // ─── Intervals ───────────────────────────────────────────────────────────────
  registerInterval(() => {
    tagVideos();
    if (!panel && getAllVideos().length && canShowFloatingPanel()) createPanel();
  }, VIDEO_SCAN_INTERVAL);

  registerInterval(() => {
    const videos = getAllVideos();
    videos.forEach((v) => applyVideoSpeed(v));
    if (badge && videos.length) badge.textContent = 'x' + getTargetSpeed();
  }, SPEED_SYNC_INTERVAL);

  // ─── Ad Turbo Engine (main loop) ──────────────────────────────────────────
  registerInterval(() => {
    if (!adTurboEnabled) return;

    const videos = getAllVideos();
    const hasAd = videos.some(isAdVideo);

    if (hasAd) {
      // เข้าสู่โหมดเร่งโฆษณา
      if (!isCurrentlyInAdTurbo) {
        preAdSpeed = getEffectiveSpeed();
        isCurrentlyInAdTurbo = true;
        console.log('[Ad Turbo] Ad detected! Speeding up to x16');
      }

      // เร่ง x16
      videos.forEach((video) => {
        if (isAdVideo(video)) {
          if (video.playbackRate !== TURBO_SPEED) video.playbackRate = TURBO_SPEED;
          if (video.defaultPlaybackRate !== TURBO_SPEED) video.defaultPlaybackRate = TURBO_SPEED;
        }
      });

      // พยายามกดข้าม
      findAndClickSkipButton();

    } else if (isCurrentlyInAdTurbo) {
      // โฆษณาจบแล้ว → ปรับกลับสปีดเดิม
      isCurrentlyInAdTurbo = false;
      const restoreSpeed = preAdSpeed || getEffectiveSpeed();
      videos.forEach((video) => {
        try {
          video.playbackRate = restoreSpeed;
          video.defaultPlaybackRate = restoreSpeed;
        } catch { /* ignore */ }
      });
      preAdSpeed = null;
      console.log(`[Ad Turbo] Ad ended. Restored speed to x${restoreSpeed}`);
      showOSD(restoreSpeed, 'neutral');
      updateBadge();
    }
  }, AD_SYNC_INTERVAL);

  // ─── Ad Overlay Blocker Engine (Periodic Scan) ────────────────────────────
  registerInterval(() => {
    if (adBlockerEnabled) {
      scanAndBlockOverlays();
    }
  }, AD_BLOCKER_SCAN_INTERVAL);

  // ─── Feature 3: Keyboard Shortcuts ───────────────────────────────────────────
  document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) return;

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

  // ─── URL Change Detection ─────────────────────────────────────────────────────
  const mutationObserver = new MutationObserver(() => {
    if (!isContextValid() || isShutDown) {
      shutdownOrphanedScript();
      return;
    }
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      waitForVideo(() => {
        applyCurrentSpeed();
      });
    }
  });
  const targetNode = document.body || document.documentElement;
  if (targetNode) {
    mutationObserver.observe(targetNode, { childList: true, subtree: true });
    activeObservers.add(mutationObserver);
  }

  // ─── Tag Videos ──────────────────────────────────────────────────────────────
  function tagVideos() {
    const videos = getAllVideos();
    videos.forEach((video) => {
      getVideoKey(video);
      video.dataset.ytSpeedKey = video.__ytSpeedKey;
      if (!video.__ytSpeedListenersAttached) {
        video.__ytSpeedListenersAttached = true;
        ['play', 'playing', 'loadedmetadata', 'ratechange', 'durationchange'].forEach((ev) => {
          video.addEventListener(ev, () => {
            window.setTimeout(() => applyVideoSpeed(video), 0);
          });
        });
      }
    });
  }

  // ─── Init ───────────────────────────────────────────────────────────────────
  injectHelperScript();
  loadSavedState();
  initStatsTracking();
  waitForVideo(() => {
    createPanel();
    tagVideos();
    applyCurrentSpeed();
    console.log('Speed Controller Turbo v3.0 (Ad Turbo) ready!');
  });
})();
