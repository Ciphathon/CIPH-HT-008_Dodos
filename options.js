
const PATTERN_GROUPS = [
  {
    id: "api_keys",
    label: "API Keys & Developer Tokens",
    desc: "Cloud service and platform credentials",
    patterns: [
      { id: "openai_key", label: "OpenAI API Key", severity: "critical" },
      { id: "anthropic_key", label: "Anthropic API Key", severity: "critical" },
      { id: "aws_access_key", label: "AWS Access Key", severity: "critical" },
      { id: "aws_secret_key", label: "AWS Secret Key", severity: "critical" },
      { id: "github_token", label: "GitHub Token", severity: "critical" },
      { id: "google_api_key", label: "Google API Key", severity: "critical" },
      { id: "stripe_key", label: "Stripe Secret Key", severity: "critical" },
    ]
  },
  {
    id: "credentials",
    label: "Credentials & Auth",
    desc: "Passwords, tokens, private keys, and connection strings",
    patterns: [
      { id: "jwt_token", label: "JWT Token", severity: "critical" },
      { id: "private_key", label: "Private Key (PEM)", severity: "critical" },
      { id: "password_inline", label: "Inline Password", severity: "high" },
      { id: "db_connection", label: "Database Connection String", severity: "critical" },
    ]
  },
  {
    id: "indian_pii",
    label: "Indian PII",
    desc: "Aadhaar, PAN, and phone numbers",
    patterns: [
      { id: "aadhaar", label: "Aadhaar Number", severity: "critical" },
      { id: "pan_card", label: "PAN Card Number", severity: "critical" },
      { id: "india_phone", label: "Indian Phone Number", severity: "medium" },
    ]
  },
  {
    id: "financial",
    label: "Financial Data",
    desc: "Credit cards and bank codes",
    patterns: [
      { id: "credit_card", label: "Credit / Debit Card", severity: "critical" },
      { id: "ifsc_code", label: "Bank IFSC Code", severity: "medium" },
    ]
  },
  {
    id: "network_general",
    label: "Network & General PII",
    desc: "IP addresses, email addresses, and SSN",
    patterns: [
      { id: "ipv4_private", label: "Private IP Address", severity: "medium" },
      { id: "email", label: "Email Address", severity: "low" },
      { id: "ssn", label: "Social Security Number (SSN)", severity: "critical" },
    ]
  }
];


const PATTERN_META = PATTERN_GROUPS.flatMap(g => g.patterns);

const severityColors = { critical: "#FF4444", high: "#FF9500", medium: "#FFD60A", low: "#30D158" };


const PRESETS = {
  strict: [],
  balanced: ["email", "ifsc_code", "ipv4_private"],
  minimal: ["email", "ifsc_code", "ipv4_private", "india_phone", "password_inline", "jwt_token"]
};

let currentSettings = {
  sensitivity: "balanced",
  disabledPatterns: [...PRESETS.balanced],
  whitelist: [],
  autoPurge: true,
  ocrEnabled: true,
  
  gmailEnabled: false,
  googleSearchEnabled: false
};


function buildGroups(disabledPatterns) {
  const container = document.getElementById("pattern-groups");
  container.innerHTML = "";
  PATTERN_GROUPS.forEach(group => {
    const groupEl = document.createElement("div");
    groupEl.className = "pattern-group";

    const header = document.createElement("div");
    header.className = "group-header";
    const enabledCount = group.patterns.filter(p => !disabledPatterns.includes(p.id)).length;
    header.innerHTML = `
      <div class="group-title">${group.label}</div>
      <div class="group-meta">
        <span class="group-count">${enabledCount}/${group.patterns.length} active</span>
        <span class="group-chevron">▾</span>
      </div>
    `;

    const body = document.createElement("div");
    body.className = "group-body";

    group.patterns.forEach(p => {
      const isEnabled = !disabledPatterns.includes(p.id);
      const row = document.createElement("div");
      row.className = "toggle-row";
      row.innerHTML = `
        <div>
          <div class="toggle-label" style="color:${isEnabled ? "#E5E5EA" : "#636366"}">
            <span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:${severityColors[p.severity]};margin-right:7px;vertical-align:middle;"></span>
            ${p.label}
          </div>
          <div class="toggle-sub">${p.severity}</div>
        </div>
        <label class="switch">
          <input type="checkbox" data-id="${p.id}" ${isEnabled ? "checked" : ""} />
          <span class="slider"></span>
        </label>
      `;
      body.appendChild(row);
    });

    
    header.addEventListener("click", () => {
      const isOpen = body.classList.toggle("open");
      header.querySelector(".group-chevron").textContent = isOpen ? "▴" : "▾";
    });

    groupEl.appendChild(header);
    groupEl.appendChild(body);
    container.appendChild(groupEl);
  });
}



function loadSettings() {
  chrome.storage.sync.get("gow_settings", (data) => {
    if (data.gow_settings) {
      currentSettings = { ...currentSettings, ...data.gow_settings };
    }
    applySettingsToUI();
  });
}

function applySettingsToUI() {
  
  const radio = document.querySelector(`input[name="sensitivity"][value="${currentSettings.sensitivity}"]`);
  if (radio) radio.checked = true;

  
  buildGroups(currentSettings.disabledPatterns || []);

  
  document.getElementById("whitelist-input").value = (currentSettings.whitelist || []).join("\n");

  
  document.getElementById("toggle-autopurge").checked = currentSettings.autoPurge !== false;
  document.getElementById("toggle-ocr").checked = currentSettings.ocrEnabled !== false;
  document.getElementById("toggle-gmail").checked = currentSettings.gmailEnabled === true;
  document.getElementById("toggle-google-search").checked = currentSettings.googleSearchEnabled === true;
}


function readSettingsFromUI() {
  const sensitivity = document.querySelector("input[name='sensitivity']:checked")?.value || "balanced";

  const disabledPatterns = [];
  document.querySelectorAll("#pattern-groups input[type='checkbox']").forEach(cb => {
    if (!cb.checked) disabledPatterns.push(cb.dataset.id);
  });

  const whitelistRaw = document.getElementById("whitelist-input").value;
  const whitelist = whitelistRaw.split("\n").map(s => s.trim()).filter(Boolean);

  return {
    sensitivity,
    disabledPatterns,
    whitelist,
    autoPurge: document.getElementById("toggle-autopurge").checked,
    ocrEnabled: document.getElementById("toggle-ocr").checked,
    gmailEnabled: document.getElementById("toggle-gmail").checked,
    googleSearchEnabled: document.getElementById("toggle-google-search").checked
  };
}




document.querySelectorAll("input[name='sensitivity']").forEach(radio => {
  radio.addEventListener("change", () => {
    const preset = radio.value;
    buildGroups(PRESETS[preset] || []);
  });
});


document.getElementById("btn-save").addEventListener("click", () => {
  const settings = readSettingsFromUI();

  
  const optionalHosts = [];
  if (settings.gmailEnabled)        optionalHosts.push("https://mail.google.com/*");
  if (settings.googleSearchEnabled) optionalHosts.push("https://www.google.com/*");

  if (optionalHosts.length > 0) {
    chrome.permissions.request(
      { origins: optionalHosts },
      (granted) => {
        if (!granted) {
          
          settings.gmailEnabled        = false;
          settings.googleSearchEnabled = false;
          alert("Permission denied — feature disabled.");
        }
        chrome.storage.sync.set({ gow_settings: settings }, () => {
          const status = document.getElementById("save-status");
          status.textContent = "✓ Saved";
          setTimeout(() => { status.textContent = ""; }, 2500);
        });
      }
    );
  } else {
    chrome.storage.sync.set({ gow_settings: settings }, () => {
      const status = document.getElementById("save-status");
      status.textContent = "✓ Saved";
      setTimeout(() => { status.textContent = ""; }, 2500);
    });
  }
});

// Wipe all data
document.getElementById("btn-wipe").addEventListener("click", () => {
  if (!confirm("Wipe all GuardOWL detection logs and stats? This cannot be undone.")) return;
  chrome.storage.local.set({
    gow_stats: { total_blocked: 0, total_masked: 0, total_ignored: 0, clean_sends: 0 },
    gow_log: []
  }, () => {
    const status = document.getElementById("save-status");
    status.textContent = "✓ Data wiped";
    status.style.color = "#FF4444";
    setTimeout(() => { status.textContent = ""; status.style.color = "#30D158"; }, 3000);
  });
});


loadSettings();
