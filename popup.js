// popup.js — Speed Controller Turbo v3.0

const turboToggle       = document.getElementById('turboToggle');
const adBlockerToggle   = document.getElementById('adBlockerToggle');
const showPanelToggle   = document.getElementById('showPanelToggle');
const siteSpeedToggle   = document.getElementById('siteSpeedToggle');
const speedRange        = document.getElementById('speedRange');
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

const KEYS = ['yt_ad_turbo', 'yt_ad_blocker', 'yt_show_panel', 'yt_use_site_speed', 'yt_speed', 'yt_site_speeds', 'yt_shortcuts', 'yt_stats', 'yt_ad_blocker_stats'];
let activeTabId = null;
let activeSite = '';

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
    siteSpeedToggle.checked = Boolean(result.yt_use_site_speed);

    const storedSpeed = typeof result.yt_speed === 'number' ? result.yt_speed : 1;
    const siteMap = result.yt_site_speeds || {};
    const spd = result.yt_use_site_speed && activeSite && typeof siteMap[activeSite] === 'number'
      ? siteMap[activeSite] : storedSpeed;
    updateSpeedUI(spd);

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

  // Get active tab URL
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs[0]) activeTabId = tabs[0].id;
    if (tabs[0] && tabs[0].url) {
      try {
        const url = new URL(tabs[0].url);
        activeSite = url.hostname.replace(/^www\./, '');
        currentSiteEl.textContent = activeSite;
      } catch {
        currentSiteEl.textContent = 'unknown';
      }
    }
    if (activeTabId !== null) {
      chrome.tabs.sendMessage(activeTabId, { type: 'GET_SPEED' }, (response) => {
        if (!chrome.runtime.lastError || response?.ok) updateSpeedUI(response?.speed || 1);
      });
    }
  });
}

function updateSpeedUI(speed) {
  const safe = Math.min(16, Math.max(0.25, Number(speed) || 1));
  currentSpeedDisplay.textContent = 'x' + safe;
  if (speedRange) speedRange.value = safe;
  speedButtons.forEach((button) => {
    button.classList.toggle('active', Number(button.dataset.speed) === safe);
  });
}

function setSpeedFromPopup(speed) {
  const safe = Math.round(Math.min(16, Math.max(0.25, Number(speed) || 1)) * 100) / 100;
  updateSpeedUI(safe);
  if (activeTabId !== null) {
    chrome.tabs.sendMessage(activeTabId, { type: 'SET_SPEED', speed: safe }, (response) => {
      if (chrome.runtime.lastError || !response?.ok) {
        chrome.storage.local.set({ yt_speed: safe });
      }
    });
  } else {
    chrome.storage.local.set({ yt_speed: safe });
  }
}

if (speedRange) speedRange.addEventListener('input', () => setSpeedFromPopup(speedRange.value));
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
  chrome.storage.local.set({ yt_use_site_speed: siteSpeedToggle.checked });
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== 'local') return;
  if (changes.yt_ad_turbo)     turboToggle.checked = changes.yt_ad_turbo.newValue !== false;
  if (changes.yt_ad_blocker && adBlockerToggle) adBlockerToggle.checked = Boolean(changes.yt_ad_blocker.newValue);
  if (changes.yt_show_panel)   showPanelToggle.checked = changes.yt_show_panel.newValue !== false;
  if (changes.yt_use_site_speed) siteSpeedToggle.checked = Boolean(changes.yt_use_site_speed.newValue);
  if (changes.yt_speed) {
    updateSpeedUI(changes.yt_speed.newValue || 1);
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
