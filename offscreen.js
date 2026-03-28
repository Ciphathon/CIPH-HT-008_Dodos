




let tesseractWorker = null;
let tesseractReady = false;
let initError = null;


(async function autoInit() {
  try {
    console.log("[GuardOWL Offscreen] Initializing Tesseract...");

    
    
    tesseractWorker = await Tesseract.createWorker("eng", 1, {
      workerPath: chrome.runtime.getURL("tesseract.worker.min.js"),
      workerBlobURL: false,
      corePath: chrome.runtime.getURL("tesseract-core-simd-lstm.wasm.js"),
      langPath: "https://tessdata.projectnaptha.com/4.0.0",
      cacheMethod: "none"
    });

    tesseractReady = true;
    console.log("[GuardOWL Offscreen] Tesseract ready!");
  } catch (err) {
    initError = err.message;
    console.error("[GuardOWL Offscreen] Tesseract init error:", err);
  }
})();

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.target !== "offscreen") return false;

  if (msg.type === "INIT_OCR") {
    if (tesseractReady) {
      sendResponse({ ok: true });
    } else if (initError) {
      sendResponse({ ok: false, error: initError });
    } else {
      
      let elapsed = 0;
      const poll = setInterval(() => {
        elapsed += 500;
        if (tesseractReady) {
          clearInterval(poll);
          sendResponse({ ok: true });
        } else if (initError || elapsed > 30000) {
          clearInterval(poll);
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
