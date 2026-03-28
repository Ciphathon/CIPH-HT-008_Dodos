const TESSERACT_CDN = "https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js";
let cachedTesseractScript = null;

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.set({
    gow_stats: { total_blocked: 0, total_masked: 0, total_ignored: 0, clean_sends: 0 },
    gow_log: []
  });
  chrome.action.setBadgeBackgroundColor({ color: "#FF9500" });
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "UPDATE_BADGE") {
    const count = msg.count || 0;
    chrome.action.setBadgeText({ text: count > 0 ? String(count) : "" });
    return;
  }

  if (msg.type === "FETCH_TESSERACT") {
    if (cachedTesseractScript) {
      sendResponse({ ok: true, scriptText: cachedTesseractScript });
      return;
    }

    fetch(TESSERACT_CDN)
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.text();
      })
      .then(text => {
        cachedTesseractScript = text;
        sendResponse({ ok: true, scriptText: text });
      })
      .catch(err => {
        console.warn("[GuardOWL BG] Tesseract fetch failed:", err.message);
        sendResponse({ ok: false, error: err.message });
      });

    return true; 
  }
});
