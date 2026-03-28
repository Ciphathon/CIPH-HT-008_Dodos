
const severityColors = { critical: "#FF4444", high: "#FF9500", medium: "#FFD60A", low: "#8E8E93" };

function timeAgo(ts) {
  const diff = Math.floor((Date.now() - ts) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}


chrome.storage.local.get(["gow_stats", "gow_log"], (data) => {
  const stats = data.gow_stats || { total_blocked: 0, total_masked: 0, total_ignored: 0 };
  const log = data.gow_log || [];

  document.getElementById("stat-blocked").textContent = stats.total_blocked || 0;
  document.getElementById("stat-masked").textContent = stats.total_masked || 0;
  document.getElementById("stat-ignored").textContent = stats.total_ignored || 0;

  const logList = document.getElementById("log-list");
  if (log.length === 0) return;

  logList.innerHTML = "";
  log.slice(0, 15).forEach(entry => {
    const item = document.createElement("div");
    item.className = "log-item";
    const color = severityColors[entry.severity] || "#8E8E93";
    
    const siteName = (entry.site || "Unknown site").replace(/^www\./, "");
    item.innerHTML = `
      <div class="log-dot" style="background:${color}"></div>
      <div class="log-content">
        <div class="log-types">${siteName}</div>
        <div class="log-meta">${timeAgo(entry.ts)}</div>
      </div>
      <div class="log-outcome outcome-${entry.outcome}">${entry.outcome}</div>
    `;
    logList.appendChild(item);
  });
});

// ── Active site check ──
try {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (chrome.runtime.lastError) return;
    const url = tabs[0]?.url || "";
    const supported = ["chatgpt.com", "chat.openai.com", "claude.ai", "gemini.google.com", "copilot.microsoft.com", "bing.com", "mail.google.com", "www.google.com"];
    const isActive = supported.some(s => url.includes(s));
    if (!isActive) {
      const dot = document.getElementById("status-dot");
      dot.classList.add("inactive");
      dot.title = "Not active on this site";
    }
  });
} catch (_) { /* no tabs permission fallback — just leave dot green */ }

// ── OCR engine status ──
try {
  chrome.runtime.sendMessage({ type: "TESSERACT_STATUS" }, (resp) => {
    if (chrome.runtime.lastError) return; // context invalidated
    const dot = document.getElementById("ocr-dot");
    if (resp?.ready) {
      dot.textContent = "OCR";
      dot.classList.add("ready");
      dot.title = "OCR engine ready";
    } else {
      dot.title = "OCR engine will warm up on page load";
    }
  });
} catch (_) { /* extension was reloaded */ }

// ── Export log ──
document.getElementById("btn-export").addEventListener("click", () => {
  chrome.storage.local.get(["gow_stats", "gow_log"], (data) => {
    const json = JSON.stringify({ stats: data.gow_stats, log: data.gow_log }, null, 2);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `guardowl-log-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  });
});


document.getElementById("btn-clear").addEventListener("click", () => {
  chrome.storage.local.set({ gow_log: [] }, () => {
    document.getElementById("log-list").innerHTML =
      '<div class="log-empty">Log cleared</div>';
  });
});


document.getElementById("btn-settings").addEventListener("click", (e) => {
  e.preventDefault();
  chrome.runtime.openOptionsPage();
});
