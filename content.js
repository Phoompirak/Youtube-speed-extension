// ? YT Speed Controller ? Content Script
// ??????????????????????????? YouTube

(() => {
  "use strict";

  const SPEEDS = [1, 1.25, 1.5, 2, 3, 4, 5, 6, 8, 10, 12, 16];
  const TURBO_SPEED = 16;

  let currentSpeed = 1;
  let isTurboMode = false;
  let panel = null;
  let badge = null;
  let activeBtn = null;
  let turboBtn = null;

  function getTargetSpeed() {
    return isTurboMode ? TURBO_SPEED : currentSpeed;
  }

  function waitForVideo(callback, maxWait = 15000) {
    const start = Date.now();
    const check = () => {
      const video = document.querySelector("video");
      if (video) {
        callback(video);
      } else if (Date.now() - start < maxWait) {
        requestAnimationFrame(check);
      }
    };
    check();
  }

  function syncTurboUi() {
    if (!turboBtn) return;

    turboBtn.classList.toggle("active", isTurboMode);
        turboBtn.textContent = isTurboMode ? "Turbo Mode: ON" : "Turbo Mode: OFF";
  }

  function syncSpeedButtons() {
    const allBtns = document.querySelectorAll(".sc-btn");
    allBtns.forEach((btn) => {
      btn.classList.remove("active");
      if (parseFloat(btn.dataset.speed) === currentSpeed) {
        btn.classList.add("active");
        activeBtn = btn;
      }
    });
  }

  function applyCurrentSpeed() {
    const video = document.querySelector("video");
    if (!video) return;

    const targetSpeed = getTargetSpeed();
    if (video.playbackRate !== targetSpeed) {
      video.playbackRate = targetSpeed;
    }

    if (badge) {
      badge.textContent = "x" + targetSpeed;
    }
  }

  function toggleTurboMode(nextValue) {
    isTurboMode = nextValue;
    chrome.storage.local.set({ yt_turbo: isTurboMode });
    syncTurboUi();
    applyCurrentSpeed();
  }

  function loadSavedState() {
    chrome.storage.local.get(["yt_speed", "yt_turbo"], (result) => {
      if (typeof result.yt_speed === "number") {
        currentSpeed = result.yt_speed;
      }
      if (typeof result.yt_turbo === "boolean") {
        isTurboMode = result.yt_turbo;
      }
      syncTurboUi();
      syncSpeedButtons();
      waitForVideo(() => applyCurrentSpeed());
    });
  }

  function createPanel() {
    if (document.getElementById("yt-speed-panel")) return;

    panel = document.createElement("div");
    panel.id = "yt-speed-panel";

    const header = document.createElement("div");
    header.className = "sc-header";

    const title = document.createElement("span");
    title.className = "sc-title";
        title.textContent = "Speed";

    badge = document.createElement("span");
    badge.className = "sc-badge";
    badge.textContent = "x1";

    header.appendChild(title);
    header.appendChild(badge);
    panel.appendChild(header);

    const grid = document.createElement("div");
    grid.className = "sc-grid";

    SPEEDS.forEach((spd) => {
      const btn = document.createElement("button");
      btn.className = "sc-btn";
      btn.textContent = "x" + spd;
      btn.dataset.speed = spd;

      if (spd === currentSpeed) {
        btn.classList.add("active");
        activeBtn = btn;
      }

      btn.addEventListener("click", () => setSpeed(spd, btn));
      grid.appendChild(btn);
    });

    panel.appendChild(grid);

    const turboContainer = document.createElement("div");
    turboContainer.className = "sc-turbo-container";

    turboBtn = document.createElement("button");
    turboBtn.id = "sc-turbo-toggle";
    turboBtn.className = "sc-turbo-btn";
    turboBtn.addEventListener("click", () => toggleTurboMode(!isTurboMode));
    turboContainer.appendChild(turboBtn);
    panel.appendChild(turboContainer);
    syncTurboUi();

    const hint = document.createElement("div");
    hint.className = "sc-shortcut-hint";
    hint.innerHTML =
      "<kbd>[</kbd> ?????? &nbsp;&nbsp; <kbd>]</kbd> ????????? &nbsp;&nbsp; <kbd>\</kbd> ?????? x1";
    panel.appendChild(hint);

    const toggleBtn = document.createElement("button");
    toggleBtn.className = "sc-toggle";
        toggleBtn.textContent = "-";
        toggleBtn.title = "Collapse/expand";
    toggleBtn.addEventListener("click", () => {
      panel.classList.toggle("collapsed");
            toggleBtn.textContent = panel.classList.contains("collapsed") ? "+" : "-";
    });
    panel.appendChild(toggleBtn);

    let isDragging = false;
    let offsetX = 0;
    let offsetY = 0;

    header.addEventListener("mousedown", (e) => {
      isDragging = true;
      const rect = panel.getBoundingClientRect();
      offsetX = e.clientX - rect.left;
      offsetY = e.clientY - rect.top;
      panel.style.transition = "none";
      e.preventDefault();
    });

    document.addEventListener("mousemove", (e) => {
      if (!isDragging) return;
      panel.style.left = e.clientX - offsetX + "px";
      panel.style.top = e.clientY - offsetY + "px";
      panel.style.right = "auto";
    });

    document.addEventListener("mouseup", () => {
      isDragging = false;
    });

    document.body.appendChild(panel);
  }

  function setSpeed(spd, btn) {
    currentSpeed = spd;
    chrome.storage.local.set({ yt_speed: spd });
    syncSpeedButtons();
    applyCurrentSpeed();
  }

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local") return;

    if (changes.yt_speed) {
      currentSpeed = changes.yt_speed.newValue ?? currentSpeed;
      syncSpeedButtons();
      applyCurrentSpeed();
    }

    if (changes.yt_turbo) {
      isTurboMode = Boolean(changes.yt_turbo.newValue);
      syncTurboUi();
      applyCurrentSpeed();
    }
  });

  document.addEventListener("keydown", (e) => {
    if (
      e.target.tagName === "INPUT" ||
      e.target.tagName === "TEXTAREA" ||
      e.target.isContentEditable
    ) {
      return;
    }

    const idx = SPEEDS.indexOf(currentSpeed);

    if (e.key === "]") {
      e.preventDefault();
      e.stopPropagation();
      if (idx < SPEEDS.length - 1) setSpeed(SPEEDS[idx + 1], null);
    } else if (e.key === "[") {
      e.preventDefault();
      e.stopPropagation();
      if (idx > 0) setSpeed(SPEEDS[idx - 1], null);
    } else if (e.key === "\\") {
      e.preventDefault();
      e.stopPropagation();
      setSpeed(1, null);
    }
  });

  let lastUrl = location.href;

  const observer = new MutationObserver(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      waitForVideo(() => applyCurrentSpeed());
    }
  });

  observer.observe(document.body, { childList: true, subtree: true });

  setInterval(() => {
    const video = document.querySelector("video");
    const isAd = document.querySelector('.ad-showing, .ad-interrupting, .ytp-ad-player-overlay');
    const targetSpeed = getTargetSpeed();

    if (video) {
      if (isAd) {
        if (video.playbackRate !== TURBO_SPEED) {
          video.playbackRate = TURBO_SPEED;
        }
      } else if (video.playbackRate !== targetSpeed) {
        video.playbackRate = targetSpeed;
      }
    }

    if (badge && video && !isAd) {
      badge.textContent = "x" + targetSpeed;
    }
  }, 2000);

  setInterval(() => {
    const video = document.querySelector("video");
    const isAd = document.querySelector('.ad-showing, .ad-interrupting, .ytp-ad-player-overlay');

    if (isAd && video && video.playbackRate !== TURBO_SPEED) {
      video.playbackRate = TURBO_SPEED;
    }

    const skipBtn = document.querySelector('.ytp-ad-skip-button, .ytp-ad-skip-button-modern, .ytp-skip-ad-button, .videoAdUiSkipButton');
    if (skipBtn && !skipBtn.disabled) {
      skipBtn.click();
      console.log("Auto skipped ad");
    }
  }, 500);

  loadSavedState();
  waitForVideo(() => {
    createPanel();
    applyCurrentSpeed();
    console.log("YT Speed Controller ready!");
  });
})();
