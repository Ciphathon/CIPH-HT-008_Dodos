let tesseractWorker = null;
let tesseractReady = false;
let initError = null;

(async function autoInit() {
  try {
    tesseractWorker = await Tesseract.createWorker("eng", 1, {
      workerPath: chrome.runtime.getURL("tesseract.worker.min.js"),
      workerBlobURL: false,
      corePath: chrome.runtime.getURL("tesseract-core-simd-lstm.wasm.js"),
      langPath: "https://tessdata.projectnaptha.com/4.0.0",
      cacheMethod: "none"
    });
    tesseractReady = true;
  } catch (err) {
    initError = err.message;
  }
})();

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.target !== "offscreen") return false;

  if (msg.type === "INIT_OCR") {
    if (tesseractReady) {
      sendResponse({ ok: true });
    } else {
      let waited = 0;
      const checker = setInterval(() => {
        waited += 500;
        if (tesseractReady) {
          clearInterval(checker);
          sendResponse({ ok: true });
        } else if (initError || waited > 30000) {
          clearInterval(checker);
          sendResponse({ ok: false, error: initError || "Timeout" });
        }
      }, 500);
    }
    return true;
  }

  if (msg.type === "OCR_STATUS") {
    sendResponse({ ready: tesseractReady, error: initError });
    return true;
  }

  if (msg.type === "DO_OCR") {
    if (!tesseractReady) {
      sendResponse({ ok: false, error: "OCR engine not ready" });
      return true;
    }
    (async () => {
      try {
        const { data: { text } } = await tesseractWorker.recognize(msg.imageData);
        sendResponse({ ok: true, text });
      } catch (err) {
        sendResponse({ ok: false, error: err.message });
      }
    })();
    return true;
  }
});
