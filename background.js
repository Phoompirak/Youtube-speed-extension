// background.js — Speed Controller Turbo Service Worker
// Updates per-tab extension action badge (speed / AD Turbo indicator)

function formatBadgeSpeed(speed) {
  const n = Number(speed);
  if (!Number.isFinite(n) || n === 1) return '';
  if (Number.isInteger(n)) return n + 'x';
  const s = String(Math.round(n * 100) / 100);
  return s.length <= 4 ? s : n.toFixed(1);
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || message.type !== 'UPDATE_BADGE') return;
  const tabId = sender?.tab?.id;
  if (typeof tabId !== 'number') return;

  const isAdTurbo = Boolean(message.isAdTurbo);
  const text = isAdTurbo ? 'AD' : formatBadgeSpeed(message.speed);
  const bgColor = isAdTurbo ? '#f59e0b' : '#18181b';
  const textColor = isAdTurbo ? '#09090b' : '#fafafa';

  chrome.action.setBadgeText({ tabId, text }).catch(() => {});
  if (text) {
    chrome.action.setBadgeBackgroundColor({ tabId, color: bgColor }).catch(() => {});
    if (chrome.action.setBadgeTextColor) {
      chrome.action.setBadgeTextColor({ tabId, color: textColor }).catch(() => {});
    }
  }
  sendResponse?.({ ok: true });
});
