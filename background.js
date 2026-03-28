let creatingOffscreen = null;

async function setupOffscreen() {
  const offscreenUrl = chrome.runtime.getURL("offscreen.html");
  const existing = await chrome.runtime.getContexts({
    contextTypes: ["OFFSCREEN_DOCUMENT"],
    documentUrls: [offscreenUrl]
  });
  if (existing.length > 0) return;

  if (creatingOffscreen) {
    await creatingOffscreen;
    return;
  }

  creatingOffscreen = chrome.offscreen.createDocument({
    url: "offscreen.html",
    reasons: ["DOM_SCRAPING"],
    justification: "Run Tesseract OCR securely in an isolated offscreen document"
  });
  await creatingOffscreen;
  creatingOffscreen = null;
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get("gow_stats", (data) => {
    if (!data.gow_stats) {
      chrome.storage.local.set({
        gow_stats: { total_blocked: 0, total_masked: 0, total_ignored: 0, clean_sends: 0 },
        gow_log: []
      });
    }
  });
  chrome.action.setBadgeBackgroundColor({ color: "#FF9500" });
  setupOffscreen().catch(() => {});
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "UPDATE_BADGE") {
    const count = msg.count || 0;
    chrome.action.setBadgeText({ text: count > 0 ? String(count) : "" });
    return true;
  }

  if (msg.target === "offscreen") return false;

  if (msg.type === "INIT_OCR" || msg.type === "DO_OCR") {
    (async () => {
      try {
        await setupOffscreen();
        chrome.runtime.sendMessage(
          { target: "offscreen", type: msg.type, imageData: msg.imageData || null },
          (resp) => {
            if (chrome.runtime.lastError) {
              sendResponse({ ok: false, error: chrome.runtime.lastError.message });
              return;
            }
            sendResponse(resp || { ok: false, error: "No response from offscreen" });
          }
        );
      } catch (err) {
        sendResponse({ ok: false, error: err.message });
      }
    })();
    return true;
  }

  if (msg.type === "TESSERACT_STATUS") {
    (async () => {
      try {
        await setupOffscreen();
        chrome.runtime.sendMessage(
          { target: "offscreen", type: "OCR_STATUS" },
          (resp) => {
            if (chrome.runtime.lastError) {
              sendResponse({ ready: false });
              return;
            }
            sendResponse({ ready: resp?.ready === true });
          }
        );
      } catch (_) {
        sendResponse({ ready: false });
      }
    })();
    return true;
  }
});
