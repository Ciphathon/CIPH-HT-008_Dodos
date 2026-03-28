(function () {
  "use strict";

  let isModalOpen = false;
  let skipNextScan = false;

  let userSettings = {
    sensitivity: "balanced",
    disabledPatterns: ["email", "ifsc_code", "ipv4_private"],
    whitelist: [],
    autoPurge: true,
    ocrEnabled: true
  };

  chrome.storage.sync.get("gow_settings", (data) => {
    if (data.gow_settings) userSettings = { ...userSettings, ...data.gow_settings };
  });

  const SITE_CONFIGS = {
    "chatgpt.com": { input: "#prompt-textarea", submit: '[data-testid="send-button"]' },
    "chat.openai.com": { input: "#prompt-textarea", submit: '[data-testid="send-button"]' },
    "claude.ai": { input: ".ProseMirror", submit: '[aria-label="Send message"]' },
    "gemini.google.com": { input: ".ql-editor", submit: '.send-button' },
    "copilot.microsoft.com": { input: "#userInput", submit: '[aria-label="Submit"]' },
    "www.bing.com": { input: "#searchbox", submit: '#search_icon' },
    "mail.google.com": { input: ".Am.Al.editable", submit: '[data-tooltip="Send"], [aria-label="Send"]' },
    "www.google.com": { input: 'textarea[name="q"], input[name="q"]', submit: 'input[name="btnK"], [aria-label="Google Search"]' }
  };

  const hostname = window.location.hostname;
  const config = SITE_CONFIGS[hostname];

  function isWhitelisted() {
    return (userSettings.whitelist || []).some(domain => hostname.includes(domain.trim()));
  }

  function isSiteDisabled() {
    if (hostname === "mail.google.com" && !userSettings.gmailEnabled) return true;
    if (hostname === "www.google.com" && !userSettings.googleSearchEnabled) return true;
    return false;
  }

  function getInputEl() { return config ? document.querySelector(config.input) : null; }
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
      const proto = el.tagName === "TEXTAREA"
        ? window.HTMLTextAreaElement.prototype
        : window.HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, "value").set;
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

    const labels = [...new Set(findings.map(f => f.label))].join(" · ");
    const severity = findings[0]?.severity;
    const colors = { critical: "#FF4444", high: "#FF9500", medium: "#FFD60A", low: "#8E8E93" };
    const color = colors[severity] || "#FF9500";

    bar.style.cssText = `
      position: fixed;
      background: #1A1A22;
      border: 1.5px solid ${color};
      border-radius: 8px;
      color: ${color};
      font-family: -apple-system, sans-serif;
      font-size: 13px;
      font-weight: 600;
      padding: 8px 14px;
      z-index: 2147483640;
      display: flex;
      align-items: center;
      gap: 7px;
      pointer-events: none;
      box-shadow: 0 4px 20px rgba(0,0,0,0.7);
    `;
    bar.innerHTML = `<span style="font-size:14px">🦉</span> GuardOWL: <strong>${labels}</strong> detected — will intercept on send`;
    document.body.appendChild(bar);

    const showBelow = hostname === "www.google.com";
    function positionBar() {
      const el = getInputEl();
      if (!el || !document.getElementById("gow-inline-warning")) return;
      const rect = el.getBoundingClientRect();

      if (showBelow) {
        bar.style.top = (rect.bottom + 6) + "px";
        bar.style.transform = "";
      } else {
        bar.style.top = (rect.top - 8) + "px";
        bar.style.transform = "translateY(-100%)";
      }
      bar.style.left = rect.left + "px";
      bar.style.width = rect.width + "px";
      bar.style.height = "";
      bar.style.borderRadius = "8px";

      repositionRAF = requestAnimationFrame(positionBar);
    }
    positionBar();

    setTimeout(removeInlineWarning, 8000);
  }

  function removeInlineWarning() {
    document.getElementById("gow-inline-warning")?.remove();
    inlineBarFindings = null;
    if (repositionRAF) { cancelAnimationFrame(repositionRAF); repositionRAF = null; }
  }

  let tesseractReady = false;
  let tesseractLoading = false;

  function safeSendMessage(msg) {
    try {
      if (!chrome?.runtime?.id) return Promise.resolve(null);
      return chrome.runtime.sendMessage(msg).catch(() => null);
    } catch (_) {
      return Promise.resolve(null);
    }
  }

  async function initTesseract() {
    if (tesseractReady || tesseractLoading) return;
    tesseractLoading = true;
    try {
      const resp = await safeSendMessage({ type: "INIT_OCR" });
      if (!resp?.ok) throw new Error(resp?.error || "Init failed");
      tesseractReady = true;
      tesseractLoading = false;
    } catch (err) {
      tesseractLoading = false;
    }
  }

  function preprocessCanvas(sourceCanvas) {
    const w = sourceCanvas.width, h = sourceCanvas.height;
    const dst = document.createElement("canvas");
    dst.width = w; dst.height = h;
    const ctx = dst.getContext("2d");
    ctx.drawImage(sourceCanvas, 0, 0);

    const imgData = ctx.getImageData(0, 0, w, h);
    const d = imgData.data;

    for (let i = 0; i < d.length; i += 4) {
      const gray = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      d[i] = d[i + 1] = d[i + 2] = gray;
    }

    let min = 255, max = 0;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i] < min) min = d[i];
      if (d[i] > max) max = d[i];
    }
    const range = max - min || 1;
    for (let i = 0; i < d.length; i += 4) {
      const stretched = ((d[i] - min) / range) * 255;
      d[i] = d[i + 1] = d[i + 2] = stretched;
    }

    let sum = 0, count = 0;
    for (let i = 0; i < d.length; i += 4) { sum += d[i]; count++; }
    const threshold = sum / count;
    for (let i = 0; i < d.length; i += 4) {
      const val = d[i] > threshold ? 255 : 0;
      d[i] = d[i + 1] = d[i + 2] = val;
    }

    ctx.putImageData(imgData, 0, 0);
    return dst;
  }

  async function scanImageFromClipboard(imageBlob) {
    showOCROverlay("Scanning image for sensitive data...", "#8E8E93");

    try {
      const bitmap = await createImageBitmap(imageBlob);
      const canvas = document.createElement("canvas");
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      canvas.getContext("2d").drawImage(bitmap, 0, 0);

      if (!tesseractReady) await initTesseract();
      if (!tesseractReady) {
        showOCROverlay("⚠️ OCR engine unavailable — image not scanned", "#FF9500");
        return;
      }

      const originalData = canvas.toDataURL("image/png");
      const processedCanvas = preprocessCanvas(canvas);
      const processedData = processedCanvas.toDataURL("image/png");

      const [resp1, resp2] = await Promise.all([
        safeSendMessage({ type: "DO_OCR", imageData: originalData }),
        safeSendMessage({ type: "DO_OCR", imageData: processedData })
      ]);

      const text1 = resp1?.ok ? (resp1.text || "") : "";
      const text2 = resp2?.ok ? (resp2.text || "") : "";

      const combinedText = text1.length >= text2.length
        ? text1 + "\n" + text2
        : text2 + "\n" + text1;

      if (!combinedText || combinedText.trim().length < 4) {
        showOCROverlay("Image scanned — no readable text found", "#30D158");
        return;
      }

      const findings = guardOwlScan(combinedText, userSettings.disabledPatterns || []);
      if (findings.length === 0) {
        showOCROverlay("Image scanned — no sensitive data detected", "#30D158");
        return;
      }

      removeOCROverlay();
      isModalOpen = true;

      guardOwlShowModal(findings, combinedText, (action) => {
        isModalOpen = false;
        if (action === "remove") logDetection(findings, "blocked");
        if (action === "send") logDetection(findings, "ignored");
      }, true);

    } catch (err) {
      isModalOpen = false;
      showOCROverlay("⚠️ Could not process image", "#FF9500");
    }
  }

  let ocrOverlayRAF = null;

  function showOCROverlay(msg, color) {
    removeOCROverlay();
    const overlay = document.createElement("div");
    overlay.id = "gow-ocr-overlay";

    overlay.style.cssText = `
      position: fixed;
      background: rgba(26, 26, 34, 0.85);
      backdrop-filter: blur(4px);
      border: 1.5px solid ${color}88;
      color: ${color};
      font-family: -apple-system, sans-serif;
      font-size: 15px;
      font-weight: 600;
      display: flex;
      align-items: center;
      justify-content: center;
      border-radius: 12px;
      z-index: 2147483646;
      box-shadow: 0 8px 30px rgba(0,0,0,0.6);
      animation: gow-fadein 0.2s ease;
      cursor: not-allowed;
      pointer-events: auto;
    `;
    overlay.innerHTML = `<span style="font-size:18px; margin-right:8px;">🦉</span> ${msg}`;
    document.body.appendChild(overlay);

    function positionOverlay() {
      const el = getInputEl();
      const ov = document.getElementById("gow-ocr-overlay");
      if (!el || !ov) return;
      const rect = el.getBoundingClientRect();
      ov.style.top = rect.top + "px";
      ov.style.left = rect.left + "px";
      ov.style.width = rect.width + "px";
      ov.style.height = rect.height + "px";
      ocrOverlayRAF = requestAnimationFrame(positionOverlay);
    }
    positionOverlay();

    if (color === "#30D158" || color === "#FF9500") setTimeout(removeOCROverlay, 3500);
  }

  function removeOCROverlay() {
    if (ocrOverlayRAF) { cancelAnimationFrame(ocrOverlayRAF); ocrOverlayRAF = null; }
    document.getElementById("gow-ocr-overlay")?.remove();
  }

  async function handlePaste(e) {
    if (isWhitelisted() || isSiteDisabled()) return;
    const items = e.clipboardData?.items;
    if (!items) return;

    if (userSettings.ocrEnabled !== false) {
      for (const item of items) {
        if (item.type.startsWith("image/")) {
          const blob = item.getAsFile();
          if (blob) { scanImageFromClipboard(blob); return; }
        }
      }
    }

    const pastedText = e.clipboardData.getData("text") || "";
    if (!pastedText || pastedText.trim().length < 4) return;

    const findings = guardOwlScan(pastedText, userSettings.disabledPatterns || []);
    if (findings.length === 0) return;

    requestAnimationFrame(() => highlightPIIInInput(findings));
  }

  function handleSubmitAttempt(e) {
    if (isWhitelisted() || isSiteDisabled()) return;
    if (skipNextScan) { skipNextScan = false; return; }
    if (isModalOpen) { e.preventDefault(); e.stopPropagation(); return; }

    const text = getInputText();
    if (!text || text.trim().length < 3) return;

    const findings = guardOwlScan(text, userSettings.disabledPatterns || []);
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

  function handleFileUpload(e) {
    if (isWhitelisted() || isSiteDisabled()) return;
    if (userSettings.ocrEnabled === false) return;
    const files = e.target?.files;
    if (!files) return;
    for (const file of files) {
      if (file.type.startsWith("image/")) {
        scanImageFromClipboard(file);
        return;
      }
    }
  }

  function handleDrop(e) {
    if (isWhitelisted() || isSiteDisabled()) return;
    if (userSettings.ocrEnabled === false) return;
    const files = e.dataTransfer?.files;
    if (!files) return;
    for (const file of files) {
      if (file.type.startsWith("image/")) {
        scanImageFromClipboard(file);
        return;
      }
    }
  }

  function logDetection(findings, outcome) {
    if (!chrome?.storage?.local) return;
    chrome.storage.local.get(["gow_stats", "gow_log"], (data) => {
      const stats = data.gow_stats || { total_blocked: 0, total_masked: 0, total_ignored: 0 };
      let log = data.gow_log || [];
      if (outcome === "blocked") stats.total_blocked++;
      if (outcome === "masked") stats.total_masked++;
      if (outcome === "ignored") stats.total_ignored++;

      const safeTypes = findings.map(f => btoa(f.label).slice(0, 8));
      log.unshift({
        ts: Date.now(),
        site: hostname,
        outcome,
        types: safeTypes,
        severity: findings[0]?.severity
      });
      if (log.length > 100) log.length = 100;

      if (userSettings.autoPurge !== false) {
        const cutoff = Date.now() - (24 * 60 * 60 * 1000);
        log = log.filter(entry => entry.ts > cutoff);
      }

      chrome.storage.local.set({ gow_stats: stats, gow_log: log });
      try { safeSendMessage({ type: "UPDATE_BADGE", count: stats.total_blocked }); } catch (_) { }
    });
  }

  function logCleanSend() {
    if (!chrome?.storage?.local) return;
    chrome.storage.local.get("gow_stats", (data) => {
      const stats = data.gow_stats || {};
      stats.clean_sends = (stats.clean_sends || 0) + 1;
      chrome.storage.local.set({ gow_stats: stats });
    });
  }

  function injectStyles() {
    if (document.getElementById("gow-anim-styles")) return;
    const s = document.createElement("style");
    s.id = "gow-anim-styles";
    s.textContent = `@keyframes gow-fadein { from{opacity:0;transform:translateY(6px)} to{opacity:1;transform:translateY(0)} }`;
    document.head.appendChild(s);
  }

  let inputScanTimer = null;
  function handleInput() {
    if (isWhitelisted() || isSiteDisabled()) return;
    clearTimeout(inputScanTimer);
    inputScanTimer = setTimeout(() => {
      const text = getInputText();
      if (!text || text.trim().length < 3) { removeInlineWarning(); return; }
      const findings = guardOwlScan(text, userSettings.disabledPatterns || []);
      if (findings.length === 0) { removeInlineWarning(); return; }
      highlightPIIInInput(findings);
    }, 400);
  }

  function hookFileInputs() {
    document.querySelectorAll('input[type="file"]').forEach(input => {
      if (input.__gow_hooked) return;
      input.__gow_hooked = true;
      input.addEventListener("change", handleFileUpload, true);
    });
  }

  function attachListeners() {
    injectStyles();

    document.removeEventListener("keydown", handleKeydown, true);
    document.removeEventListener("paste", handlePaste, true);
    document.removeEventListener("drop", handleDrop, true);
    document.removeEventListener("input", handleInput, true);

    document.addEventListener("keydown", handleKeydown, true);
    document.addEventListener("paste", handlePaste, true);
    document.addEventListener("drop", handleDrop, true);
    document.addEventListener("input", handleInput, true);

    const observer = new MutationObserver(() => {
      const btn = getSubmitBtn();
      if (btn && !btn.__gow_hooked) {
        btn.__gow_hooked = true;
        btn.addEventListener("click", handleSubmitAttempt, true);
      }
      hookFileInputs();
    });
    observer.observe(document.body, { childList: true, subtree: true });

    const btn = getSubmitBtn();
    if (btn && !btn.__gow_hooked) { btn.__gow_hooked = true; btn.addEventListener("click", handleSubmitAttempt, true); }
    hookFileInputs();

    const ocrSites = ["chatgpt.com", "chat.openai.com", "claude.ai", "gemini.google.com", "copilot.microsoft.com", "www.bing.com"];
    if (ocrSites.includes(hostname)) {
      setTimeout(initTesseract, 5000);
    }
  }

  function hookSPANavigation() {
    const origPushState = history.pushState.bind(history);
    history.pushState = function (...args) {
      origPushState(...args);
      setTimeout(attachListeners, 600);
    };
    window.addEventListener("popstate", () => setTimeout(attachListeners, 600));
  }

  if (config) {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", () => { attachListeners(); hookSPANavigation(); });
    } else {
      attachListeners();
      hookSPANavigation();
    }
  }

})();