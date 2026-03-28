
function guardOwlShowModal(findings, originalText, onAction, imageMode = false) {
  guardOwlRemoveModal();

  const severityColors = {
    critical: "#FF4444", high: "#FF9500", medium: "#FFD60A", low: "#8E8E93"
  };

  const findingsHTML = findings.map(f => `
    <div class="gow-finding">
      <span class="gow-dot" style="background:${severityColors[f.severity] || '#888'}"></span>
      <span class="gow-finding-label">${f.label}</span>
      <span class="gow-finding-match">${f.match.slice(0, 4)}••••</span>
      <span class="gow-badge gow-badge-${f.severity}">${f.severity}</span>
    </div>
  `).join("");

  // FIX #8: Mask preview for text mode — show before/after
  let maskPreviewHTML = "";
  if (!imageMode) {
    const maskedText = guardOwlMask(originalText, findings);
    const previewOriginal = originalText.trim().slice(0, 80) + (originalText.length > 80 ? "…" : "");
    const previewMasked = maskedText.trim().slice(0, 80) + (maskedText.length > 80 ? "…" : "");
    maskPreviewHTML = `
      <div class="gow-mask-preview">
        <div class="gow-preview-row">
          <span class="gow-preview-label">Before</span>
          <span class="gow-preview-text gow-preview-before">${escapeHtml(previewOriginal)}</span>
        </div>
        <div class="gow-preview-row">
          <span class="gow-preview-label">After</span>
          <span class="gow-preview-text gow-preview-after">${escapeHtml(previewMasked)}</span>
        </div>
      </div>
    `;
  }

  const actionsHTML = imageMode ? `
    <div class="gow-actions">
      <button class="gow-btn gow-btn-remove" id="gow-btn-remove" style="flex:1">
        Got it — I won't send this image
      </button>
      <button class="gow-btn gow-btn-send" id="gow-btn-send">
        Send anyway
      </button>
    </div>
    <div class="gow-img-note">GuardOWL found sensitive text inside your pasted image via OCR.</div>
  ` : `
    <div class="gow-actions">
      <button class="gow-btn gow-btn-remove" id="gow-btn-remove">Remove</button>
      <button class="gow-btn gow-btn-mask" id="gow-btn-mask">Mask &amp; send</button>
      <button class="gow-btn gow-btn-send" id="gow-btn-send">Send anyway</button>
    </div>
    ${maskPreviewHTML}
  `;

  const overlay = document.createElement("div");
  overlay.id = "guardowl-overlay";
  // FIX #9: ARIA for screen readers
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.setAttribute("aria-labelledby", "gow-modal-title");

  overlay.innerHTML = `
    <div id="guardowl-modal">
      <div class="gow-header">
        <div class="gow-logo">
          <img src="${chrome.runtime.getURL('icons/icon48.png')}" width="28" height="28" alt="GuardOWL Logo" style="border-radius: 6px;" />
        </div>
        <div class="gow-header-text">
          <div class="gow-title" id="gow-modal-title">
            ${imageMode ? "Sensitive data detected in image" : "GuardOWL detected sensitive data"}
          </div>
          <div class="gow-subtitle">
            ${findings.length} pattern${findings.length > 1 ? "s" : ""} found
            ${imageMode ? "via OCR scan" : "before sending"}
          </div>
        </div>
        <button class="gow-close" id="gow-close-btn" aria-label="Dismiss">✕</button>
      </div>

      <div class="gow-findings-list">${findingsHTML}</div>
      <div class="gow-divider"></div>
      ${actionsHTML}

      <div class="gow-footer">
        GuardOWL never sees your data
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  // Button handlers
  function doAction(action, extra) {
    guardOwlRemoveModal();
    onAction(action, extra);
  }

  document.getElementById("gow-btn-remove")?.addEventListener("click", () => doAction("remove", null));
  document.getElementById("gow-btn-mask")?.addEventListener("click", () => {
    const masked = guardOwlMask(originalText, findings);
    doAction("mask", masked);
  });
  document.getElementById("gow-btn-send")?.addEventListener("click", () => doAction("send", originalText));
  document.getElementById("gow-close-btn")?.addEventListener("click", () => doAction("remove", null));
  overlay.addEventListener("click", (e) => { if (e.target === overlay) doAction("remove", null); });

  // FIX #9: Escape key to dismiss
  function handleEscape(e) {
    if (e.key === "Escape") { doAction("remove", null); }
  }
  document.addEventListener("keydown", handleEscape, true);
  // Clean up escape listener when modal closes
  overlay._removeEscape = () => document.removeEventListener("keydown", handleEscape, true);

  // FIX #9: Focus trap — keep Tab focus inside modal
  const modal = document.getElementById("guardowl-modal");
  const focusable = () => [...modal.querySelectorAll("button")].filter(b => !b.disabled);

  function trapFocus(e) {
    if (e.key !== "Tab") return;
    const els = focusable();
    if (!els.length) return;
    const first = els[0], last = els[els.length - 1];
    if (e.shiftKey) {
      if (document.activeElement === first) { e.preventDefault(); last.focus(); }
    } else {
      if (document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  }
  modal.addEventListener("keydown", trapFocus);

  // Move focus into modal
  setTimeout(() => focusable()[0]?.focus(), 50);
}

function guardOwlRemoveModal() {
  const overlay = document.getElementById("guardowl-overlay");
  if (overlay?._removeEscape) overlay._removeEscape(); // clean up escape listener
  overlay?.remove();
}

// ── HTML escape helper ──
function escapeHtml(str) {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
