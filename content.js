(function () {
  "use strict";

  let isModalOpen  = false;
  let skipNextScan = false;

  const SITE_CONFIGS = {
    "chatgpt.com":          { input: "#prompt-textarea",         submit: '[data-testid="send-button"]' },
    "chat.openai.com":      { input: "#prompt-textarea",         submit: '[data-testid="send-button"]' },
    "claude.ai":            { input: ".ProseMirror",             submit: '[aria-label="Send message"]' },
    "gemini.google.com":    { input: ".ql-editor",               submit: '.send-button' },
    "copilot.microsoft.com":{ input: "#userInput",               submit: '[aria-label="Submit"]' },
    "www.bing.com":         { input: "#searchbox",               submit: '#search_icon' }
  };

  const hostname = window.location.hostname;
  const config   = SITE_CONFIGS[hostname];

  function getInputEl()   { return config ? document.querySelector(config.input) : null; }
  function getSubmitBtn() { return config ? document.querySelector(config.submit) : null; }

  function getInputText() {
    const el = getInputEl();
    if (!el) return null;
    return el.innerText || el.value || el.textContent || "";
  }

  function setInputText(el, text) {
    if (el.isContentEditable) {
      el.focus();
      document.execCommand("selectAll", false, null);
      document.execCommand("insertText", false, text);
    } else {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
      setter.call(el, text);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    }
  }

  function clearInput() {
    const el = getInputEl();
    if (el) setInputText(el, "");
  }

  function clickSend() {
    skipNextScan = true;
    const btn = getSubmitBtn();
    if (btn) btn.click();
    setTimeout(() => { skipNextScan = false; }, 300);
  }


  let inlineBarFindings = null;
  let repositionRAF = null;

  function highlightPIIInInput(findings) {
    removeInlineWarning();
    inlineBarFindings = findings;

    const bar = document.createElement("div");
    bar.id = "gow-inline-warning";

    const labels  = [...new Set(findings.map(f => f.label))].join(" · ");
    const severity = findings[0]?.severity;
    const colors  = { critical: "#FF4444", high: "#FF9500", medium: "#FFD60A", low: "#8E8E93" };
    const color   = colors[severity] || "#FF9500";

    bar.style.cssText = `
      position: fixed;
      background: ${color}18;
      border: 1px solid ${color}55;
      border-radius: 8px;
      color: ${color};
      font-family: -apple-system, sans-serif;
      font-size: 12px;
      font-weight: 600;
      padding: 7px 12px;
      z-index: 2147483640;
      display: flex;
      align-items: center;
      gap: 7px;
      pointer-events: none;
      transition: top 0.1s;
    `;
    bar.innerHTML = `<span style="font-size:14px">🦉</span> GuardOWL: <strong>${labels}</strong> detected — will intercept on send`;
    document.body.appendChild(bar);

    // Position + reposition on scroll/resize
    function positionBar() {
      const el = getInputEl();
      if (!el || !document.getElementById("gow-inline-warning")) return;
      const rect = el.getBoundingClientRect();
      bar.style.top   = (rect.bottom + 6) + "px";
      bar.style.left  = rect.left + "px";
      bar.style.width = rect.width + "px";
      repositionRAF = requestAnimationFrame(positionBar); // FIX 8: continuous reposition
    }
    positionBar();

    // Auto-remove after 8s
    setTimeout(removeInlineWarning, 8000);
  }

  function removeInlineWarning() {
    document.getElementById("gow-inline-warning")?.remove();
    inlineBarFindings = null;
    if (repositionRAF) { cancelAnimationFrame(repositionRAF); repositionRAF = null; }
  }

  // ════════════════════════════════════════
  //  IMAGE OCR
  //  Tesseract loaded via background SW fetch
  //  — bypasses site Content-Security-Policy
  // ════════════════════════════════════════

  let tesseractReady  = false;
  let tesseractWorker = null;
  let tesseractLoading = false;

  async function initTesseract() {
    if (tesseractReady || tesseractLoading) return;
    tesseractLoading = true;

    try {
      // Ask background SW to fetch+cache Tesseract bundle
      // Background fetch is NOT subject to page CSP
      const resp = await chrome.runtime.sendMessage({ type: "FETCH_TESSERACT" });
      if (!resp?.ok) throw new Error("Background fetch failed");

      // Inject the script text via blob URL (bypasses CSP)
      const blob   = new Blob([resp.scriptText], { type: "application/javascript" });
      const blobUrl = URL.createObjectURL(blob);
      await loadScriptFromBlob(blobUrl);
      URL.revokeObjectURL(blobUrl);

      tesseractWorker = await Tesseract.createWorker("eng");
      tesseractReady   = true;
      tesseractLoading = false;
      console.log("[GuardOWL] Tesseract OCR ready");
    } catch (err) {
      tesseractLoading = false;
      console.warn("[GuardOWL] Tesseract init failed:", err.message);
    }
  }

  function loadScriptFromBlob(blobUrl) {
    return new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src     = blobUrl;
      s.onload  = resolve;
      s.onerror = reject;
      document.head.appendChild(s);
    });
  }

  async function scanImageFromClipboard(imageBlob) {
    showOCRToast("🦉 Scanning image for sensitive data...", "#8E8E93");

    try {
      const bitmap = await createImageBitmap(imageBlob);
      const canvas = document.createElement("canvas");
      canvas.width  = bitmap.width;
      canvas.height = bitmap.height;
      canvas.getContext("2d").drawImage(bitmap, 0, 0);

      if (!tesseractReady) await initTesseract();
      if (!tesseractReady) {
        showOCRToast("⚠️ OCR engine unavailable — image not scanned", "#FF9500");
        return;
      }

      const { data: { text } } = await tesseractWorker.recognize(canvas);

      if (!text || text.trim().length < 4) {
        showOCRToast("✓ Image scanned — no readable text found", "#30D158");
        return;
      }

      const findings = guardOwlScan(text);
      if (findings.length === 0) {
        showOCRToast("✓ Image scanned — no sensitive data detected", "#30D158");
        return;
      }

      removeOCRToast();
      isModalOpen = true;

      // FIX 11: image mode callback does NOT call clearInput()
      guardOwlShowModal(findings, text, (action) => {
        isModalOpen = false;
        if (action === "remove") logDetection(findings, "blocked");
        if (action === "send")   logDetection(findings, "ignored");
        // no clearInput() here — image was pasted, not text
      }, true);

    } catch (err) {
      isModalOpen = false; // safety reset
      console.warn("[GuardOWL] OCR error:", err);
      showOCRToast("⚠️ Could not process image", "#FF9500");
    }
  }

  function showOCRToast(msg, color) {
    removeOCRToast();
    const toast = document.createElement("div");
    toast.id = "gow-ocr-toast";
    toast.style.cssText = `
      position: fixed; bottom: 80px; right: 20px;
      background: #16161E; border: 1px solid ${color}66; color: ${color};
      font-family: -apple-system, sans-serif; font-size: 13px; font-weight: 600;
      padding: 10px 16px; border-radius: 10px; z-index: 2147483646;
      box-shadow: 0 8px 24px rgba(0,0,0,0.4); animation: gow-fadein 0.2s ease;
    `;
    toast.textContent = msg;
    document.body.appendChild(toast);
    if (color === "#30D158") setTimeout(removeOCRToast, 3000);
  }

  function removeOCRToast() { document.getElementById("gow-ocr-toast")?.remove(); }

  // ════════════════════════════════════════
  //  PASTE HANDLER
  // ════════════════════════════════════════

  async function handlePaste(e) {
    const items = e.clipboardData?.items;
    if (!items) return;

    // Image paste → OCR
    for (const item of items) {
      if (item.type.startsWith("image/")) {
        const blob = item.getAsFile();
        if (blob) { scanImageFromClipboard(blob); return; }
      }
    }

    // Text paste → scan → inline warning (non-blocking)
    const pastedText = e.clipboardData.getData("text") || "";
    if (!pastedText || pastedText.trim().length < 4) return;

    const findings = guardOwlScan(pastedText);
    if (findings.length === 0) return;

    // Let paste land in DOM first, then show bar
    requestAnimationFrame(() => highlightPIIInInput(findings));
  }

  // ════════════════════════════════════════
  //  SUBMIT INTERCEPTION
  // ════════════════════════════════════════

  function handleSubmitAttempt(e) {
    if (skipNextScan) { skipNextScan = false; return; }
    if (isModalOpen)  { e.preventDefault(); e.stopPropagation(); return; }

    const text = getInputText();
    if (!text || text.trim().length < 3) return;

    const findings = guardOwlScan(text);
    if (findings.length === 0) {
      removeInlineWarning();
      logCleanSend();
      return;
    }

    e.preventDefault();
    e.stopPropagation();
    removeInlineWarning();
    isModalOpen = true;

    guardOwlShowModal(findings, text, (action, newText) => {
      isModalOpen = false;
      const inputEl = getInputEl();

      if (action === "remove") { logDetection(findings, "blocked"); clearInput(); return; }
      if (action === "mask" && newText && inputEl) {
        setInputText(inputEl, newText);
        logDetection(findings, "masked");
        setTimeout(clickSend, 80);
        return;
      }
      if (action === "send") { logDetection(findings, "ignored"); setTimeout(clickSend, 80); }
    });
  }

  function handleKeydown(e) {
    if (e.key === "Enter" && !e.shiftKey) {
      const el = getInputEl();
      if (el && (el === document.activeElement || el.contains(document.activeElement))) {
        handleSubmitAttempt(e);
      }
    }
  }

  // ════════════════════════════════════════
  //  STORAGE
  // ════════════════════════════════════════

  function logDetection(findings, outcome) {
    chrome.storage.local.get(["gow_stats", "gow_log"], (data) => {
      const stats = data.gow_stats || { total_blocked: 0, total_masked: 0, total_ignored: 0 };
      const log   = data.gow_log   || [];
      if (outcome === "blocked") stats.total_blocked++;
      if (outcome === "masked")  stats.total_masked++;
      if (outcome === "ignored") stats.total_ignored++;
      log.unshift({ ts: Date.now(), site: hostname, outcome, types: findings.map(f => f.label), severity: findings[0]?.severity });
      if (log.length > 100) log.length = 100;
      chrome.storage.local.set({ gow_stats: stats, gow_log: log });
      try { chrome.runtime.sendMessage({ type: "UPDATE_BADGE", count: stats.total_blocked }); } catch (_) {}
    });
  }

  function logCleanSend() {
    chrome.storage.local.get("gow_stats", (data) => {
      const stats = data.gow_stats || {};
      stats.clean_sends = (stats.clean_sends || 0) + 1;
      chrome.storage.local.set({ gow_stats: stats });
    });
  }

  // ════════════════════════════════════════
  //  INIT
  // ════════════════════════════════════════

  function injectStyles() {
    if (document.getElementById("gow-anim-styles")) return;
    const s = document.createElement("style");
    s.id = "gow-anim-styles";
    s.textContent = `@keyframes gow-fadein { from{opacity:0;transform:translateY(6px)} to{opacity:1;transform:translateY(0)} }`;
    document.head.appendChild(s);
  }

  function attachListeners() {
    injectStyles();
    document.addEventListener("keydown", handleKeydown, true);
    document.addEventListener("paste",   handlePaste,   true);

    const observer = new MutationObserver(() => {
      const btn = getSubmitBtn();
      if (btn && !btn.__gow_hooked) {
        btn.__gow_hooked = true;
        btn.addEventListener("click", handleSubmitAttempt, true);
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });

    const btn = getSubmitBtn();
    if (btn) { btn.__gow_hooked = true; btn.addEventListener("click", handleSubmitAttempt, true); }

    // Pre-warm Tesseract 5s after load
    setTimeout(initTesseract, 5000);
  }

  if (config) {
    document.readyState === "loading"
      ? document.addEventListener("DOMContentLoaded", attachListeners)
      : attachListeners();
  }

})();
// done!