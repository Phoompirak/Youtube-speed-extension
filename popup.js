// popup.js — Speed Controller Turbo v3.0

const turboToggle       = document.getElementById('turboToggle');
const adBlockerToggle   = document.getElementById('adBlockerToggle');
const showPanelToggle   = document.getElementById('showPanelToggle');
const siteSpeedToggle   = document.getElementById('siteSpeedToggle');
const autoNextToggle    = document.getElementById('autoNextToggle');
const speedRange        = document.getElementById('speedRange');
const speedMinusBtn     = document.getElementById('speedMinusBtn');
const speedResetBtn     = document.getElementById('speedResetBtn');
const speedPlusBtn      = document.getElementById('speedPlusBtn');
const speedButtons       = document.querySelectorAll('[data-speed]');

const currentSpeedDisplay = document.getElementById('currentSpeedDisplay');
const currentSiteEl       = document.getElementById('currentSite');

const kbdRaise  = document.getElementById('kbdRaise');
const kbdLower  = document.getElementById('kbdLower');
const kbdReset  = document.getElementById('kbdReset');
const kbdTurbo  = document.getElementById('kbdTurbo');

const statSaved    = document.getElementById('statSaved');
const statTopSpeed = document.getElementById('statTopSpeed');
const statVideos   = document.getElementById('statVideos');
const statBlocked  = document.getElementById('statBlocked');

const KEYS = ['yt_ad_turbo', 'yt_ad_blocker', 'yt_show_panel', 'yt_use_site_speed', 'yt_auto_next', 'yt_speed', 'yt_site_speeds', 'yt_shortcuts', 'yt_stats', 'yt_ad_blocker_stats'];
let activeTabId = null;
let activeSite = '';
let useSiteSpeed = true;
let siteSpeedMap = {};
let globalSpeed = 1;
let displayedSpeed = 1;

function getDisplayedSpeed() {
  if (useSiteSpeed) {
    return activeSite && typeof siteSpeedMap[activeSite] === 'number'
      ? siteSpeedMap[activeSite]
      : 1;
  }
  return globalSpeed;
}

function formatTime(seconds) {
  if (seconds < 60) return Math.round(seconds) + ' วิ';
  if (seconds < 3600) return Math.round(seconds / 60) + ' นาที';
  return (seconds / 3600).toFixed(1) + ' ชม.';
}

function load() {
  chrome.storage.local.get(KEYS, (result) => {
    turboToggle.checked     = result.yt_ad_turbo !== false;
    if (adBlockerToggle) adBlockerToggle.checked = Boolean(result.yt_ad_blocker);
    showPanelToggle.checked = result.yt_show_panel !== false;
    useSiteSpeed            = result.yt_use_site_speed !== false;
    siteSpeedToggle.checked = useSiteSpeed;
    if (autoNextToggle) autoNextToggle.checked = Boolean(result.yt_auto_next);

    globalSpeed  = typeof result.yt_speed === 'number' ? result.yt_speed : 1;
    siteSpeedMap = result.yt_site_speeds && typeof result.yt_site_speeds === 'object' ? result.yt_site_speeds : {};
    updateSpeedUI(getDisplayedSpeed());

    const sc = result.yt_shortcuts || {};
    kbdRaise.textContent = sc.raise || ']';
    kbdLower.textContent = sc.lower || '[';
    kbdReset.textContent = sc.reset || '\\';
    kbdTurbo.textContent = sc.turbo || 't';

    if (result.yt_stats) {
      const s = result.yt_stats;
      statSaved.textContent    = formatTime(s.savedSeconds || 0);
      statTopSpeed.textContent = 'x' + (s.topSpeed || 1);
      statVideos.textContent   = s.todayVideos || 0;
    }

    if (statBlocked) {
      const bs = result.yt_ad_blocker_stats || {};
      statBlocked.textContent = bs.blocked || 0;
    }
  });

  // Get active tab URL & site
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs[0]) activeTabId = tabs[0].id;
    if (tabs[0] && tabs[0].url) {
      try {
        const url = new URL(tabs[0].url);
        if (url.protocol === 'http:' || url.protocol === 'https:') {
          activeSite = url.hostname.replace(/^www\./, '');
          currentSiteEl.textContent = activeSite;
          updateSpeedUI(getDisplayedSpeed());
        } else {
          currentSiteEl.textContent = url.protocol.replace(':', '');
        }
      } catch {
        currentSiteEl.textContent = '—';
      }
    }
    if (activeTabId !== null) {
      chrome.tabs.sendMessage(activeTabId, { type: 'GET_SPEED' }, (response) => {
        if (!chrome.runtime.lastError && response?.ok) {
          if (response.site) {
            activeSite = response.site;
            currentSiteEl.textContent = activeSite;
          }
          updateSpeedUI(response.speed || 1);
        } else if (!activeSite && currentSiteEl.textContent === 'loading...') {
          currentSiteEl.textContent = '—';
        }
      });
    } else if (currentSiteEl.textContent === 'loading...') {
      currentSiteEl.textContent = '—';
    }
  });
}

function updateSpeedUI(speed) {
  const safe = Math.round(Math.min(16, Math.max(0.25, Number(speed) || 1)) * 100) / 100;
  displayedSpeed = safe;
  currentSpeedDisplay.textContent = 'x' + safe;
  if (speedRange) speedRange.value = safe;
  speedButtons.forEach((button) => {
    button.classList.toggle('active', Number(button.dataset.speed) === safe);
  });
}

function saveSpeedFallback(safe) {
  if (useSiteSpeed && activeSite) {
    siteSpeedMap = { ...siteSpeedMap, [activeSite]: safe };
    chrome.storage.local.set({ yt_site_speeds: siteSpeedMap });
  } else {
    globalSpeed = safe;
    chrome.storage.local.set({ yt_speed: safe });
  }
}

function setSpeedFromPopup(speed) {
  const safe = Math.round(Math.min(16, Math.max(0.25, Number(speed) || 1)) * 100) / 100;
  updateSpeedUI(safe);
  if (activeTabId !== null) {
    chrome.tabs.sendMessage(activeTabId, { type: 'SET_SPEED', speed: safe }, (response) => {
      if (chrome.runtime.lastError || !response?.ok) {
        saveSpeedFallback(safe);
      }
    });
  } else {
    saveSpeedFallback(safe);
  }
}

if (speedRange) speedRange.addEventListener('input', () => setSpeedFromPopup(speedRange.value));
if (speedMinusBtn) speedMinusBtn.addEventListener('click', () => setSpeedFromPopup(displayedSpeed - 0.25));
if (speedResetBtn) speedResetBtn.addEventListener('click', () => setSpeedFromPopup(1));
if (speedPlusBtn) speedPlusBtn.addEventListener('click', () => setSpeedFromPopup(displayedSpeed + 0.25));
speedButtons.forEach((button) => {
  button.addEventListener('click', () => setSpeedFromPopup(button.dataset.speed));
});

turboToggle.addEventListener('change', () => {
  chrome.storage.local.set({ yt_ad_turbo: turboToggle.checked });
});

if (adBlockerToggle) {
  adBlockerToggle.addEventListener('change', () => {
    chrome.storage.local.set({ yt_ad_blocker: adBlockerToggle.checked });
  });
}

showPanelToggle.addEventListener('change', () => {
  chrome.storage.local.set({ yt_show_panel: showPanelToggle.checked });
});

siteSpeedToggle.addEventListener('change', () => {
  useSiteSpeed = siteSpeedToggle.checked;
  chrome.storage.local.set({ yt_use_site_speed: useSiteSpeed });
  updateSpeedUI(getDisplayedSpeed());
});

if (autoNextToggle) {
  autoNextToggle.addEventListener('change', () => {
    chrome.storage.local.set({ yt_auto_next: autoNextToggle.checked });
  });
}

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== 'local') return;
  if (changes.yt_ad_turbo)     turboToggle.checked = changes.yt_ad_turbo.newValue !== false;
  if (changes.yt_ad_blocker && adBlockerToggle) adBlockerToggle.checked = Boolean(changes.yt_ad_blocker.newValue);
  if (changes.yt_show_panel)   showPanelToggle.checked = changes.yt_show_panel.newValue !== false;
  if (changes.yt_auto_next && autoNextToggle) autoNextToggle.checked = Boolean(changes.yt_auto_next.newValue);
  if (changes.yt_use_site_speed) {
    useSiteSpeed = changes.yt_use_site_speed.newValue !== false;
    siteSpeedToggle.checked = useSiteSpeed;
    updateSpeedUI(getDisplayedSpeed());
  }
  if (changes.yt_site_speeds) {
    siteSpeedMap = changes.yt_site_speeds.newValue || {};
    if (useSiteSpeed) updateSpeedUI(getDisplayedSpeed());
  }
  if (changes.yt_speed) {
    globalSpeed = changes.yt_speed.newValue || 1;
    if (!useSiteSpeed) updateSpeedUI(globalSpeed);
  }
  if (changes.yt_shortcuts) {
    const sc = changes.yt_shortcuts.newValue || {};
    kbdRaise.textContent = sc.raise || ']';
    kbdLower.textContent = sc.lower || '[';
    kbdReset.textContent = sc.reset || '\\';
    kbdTurbo.textContent = sc.turbo || 't';
  }
  if (changes.yt_stats) {
    const s = changes.yt_stats.newValue || {};
    statSaved.textContent    = formatTime(s.savedSeconds || 0);
    statTopSpeed.textContent = 'x' + (s.topSpeed || 1);
    statVideos.textContent   = s.todayVideos || 0;
  }
  if (changes.yt_ad_blocker_stats && statBlocked) {
    const bs = changes.yt_ad_blocker_stats.newValue || {};
    statBlocked.textContent = bs.blocked || 0;
  }
});

load();
