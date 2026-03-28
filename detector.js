const GUARDOWL_PATTERNS = [


  {
    id: "anthropic_key",
    label: "Anthropic API Key",
    severity: "critical",
    pattern: /sk-ant-[a-zA-Z0-9\-_]{32,}/g
  },
  {
    id: "openai_key",
    label: "OpenAI API Key",
    severity: "critical",
    pattern: /sk-(?!ant-)[a-zA-Z0-9\-_]{32,}/g
  },
  {
    id: "aws_access_key",
    label: "AWS Access Key",
    severity: "critical",
    pattern: /\bAKIA[0-9A-Z]{16}\b/g
  },
  {
    id: "aws_secret_key",
    label: "AWS Secret Key",
    severity: "critical",
    pattern: /(?:aws_secret_access_key|aws_secret|secret_key)\s*[:=]\s*[A-Za-z0-9\/+=]{40}/gi
  },
  {
    id: "github_token",
    label: "GitHub Token",
    severity: "critical",
    pattern: /gh[pousr]_[A-Za-z0-9_]{36,}/g
  },
  {
    id: "google_api_key",
    label: "Google API Key",
    severity: "critical",
    pattern: /AIza[0-9A-Za-z\-_]{35}/g
  },
  {
    id: "stripe_key",
    label: "Stripe Secret Key",
    severity: "critical",
    pattern: /sk_(live|test)_[0-9a-zA-Z]{24,}/g
  },
  {
    id: "jwt_token",
    label: "JWT Token",
    severity: "critical",

    pattern: /eyJ[A-Za-z0-9\-_]{10,}\.eyJ[A-Za-z0-9\-_]{10,}\.[A-Za-z0-9\-_.+/]{10,}/g
  },


  {
    id: "private_key",
    label: "Private Key (PEM)",
    severity: "critical",
    pattern: /-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----/g
  },
  {
    id: "password_inline",
    label: "Inline Password",
    severity: "high",

    pattern: /(?:password|passwd|pwd)\s*[:=]\s*\S{6,}/gi
  },
  {
    id: "db_connection",
    label: "Database Connection String",
    severity: "critical",
    pattern: /(mongodb(\+srv)?|postgres|postgresql|mysql|redis):\/\/[^:]+:[^@]+@[^\s]+/gi
  },


  {
    id: "aadhaar",
    label: "Aadhaar Number",
    severity: "critical",

    pattern: /(?<!\d)[2-9]\d{3}[\s\-]?\d{4}[\s\-]?\d{4}(?!\d)/g,
    validate: (m) => m.replace(/[\s\-]/g, "").length === 12  // must be exactly 12 digits
  },
  {
    id: "pan_card",
    label: "PAN Card Number",
    severity: "critical",

    pattern: /\b[A-Z]{3}[ABCFGHLJPTF][A-Z]\d{4}[A-Z]\b/g
  },
  {
    id: "india_phone",
    label: "Indian Phone Number",
    severity: "medium",

    pattern: /(?<!\d)(?:\+91[\s\-]?)?[6-9]\d{9}(?!\d)/g,
    validate: (m) => {

      const digits = m.replace(/[\s\-+]/g, "");
      return digits.length === 10 || (digits.startsWith("91") && digits.length === 12);
    }
  },


  {
    id: "credit_card",
    label: "Credit / Debit Card Number",
    severity: "critical",
    pattern: /\b(?:4[0-9]{12}(?:[0-9]{3})?|5[1-5][0-9]{14}|3[47][0-9]{13}|6(?:011|5[0-9]{2})[0-9]{12})\b/g,
    validate: luhnCheck
  },
  {
    id: "ifsc_code",
    label: "Bank IFSC Code",
    severity: "medium",

    pattern: /\b[A-Z]{4}0[A-Z0-9]{6}\b/g,
    validate: (m) => /^[A-Z]{4}0[A-Z0-9]{6}$/.test(m) && m.length === 11
  },


  {
    id: "ipv4_private",
    label: "Private IP Address",
    severity: "medium",
    pattern: /\b(10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3})\b/g
  },


  {
    id: "email",
    label: "Email Address",
    severity: "low",

    pattern: /\b[a-zA-Z0-9._%+\-]{2,}@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}\b/g,
    validate: (m) => {

      const placeholders = ["example.com", "test.com", "test.org", "foo.com", "bar.com", "sample.com", "email.com"];
      return !placeholders.some(p => m.toLowerCase().endsWith(p));
    }
  },
  {
    id: "ssn",
    label: "Social Security Number (SSN)",
    severity: "critical",

    pattern: /\b(?!000|666|9\d{2})\d{3}-(?!00)\d{2}-(?!0000)\d{4}\b/g
  }
];


function luhnCheck(num) {
  const digits = num.replace(/\D/g, "");
  let sum = 0, isEven = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = parseInt(digits[i]);
    if (isEven) { d *= 2; if (d > 9) d -= 9; }
    sum += d;
    isEven = !isEven;
  }
  return sum % 10 === 0;
}

// ── Main scan function ──
function guardOwlScan(text, disabledCategories = []) {
  if (!text || text.trim().length < 4) return [];
  const findings = [];

  for (const rule of GUARDOWL_PATTERNS) {
    // Respect per-category user settings
    if (disabledCategories.includes(rule.id)) continue;

    const regex = new RegExp(rule.pattern.source, rule.pattern.flags);
    let match;
    while ((match = regex.exec(text)) !== null) {
      if (rule.validate && !rule.validate(match[0])) continue;
      if (rule.severity === "low" && match[0].length < 6) continue;
      findings.push({
        id: rule.id,
        label: rule.label,
        severity: rule.severity,
        match: match[0],
        index: match.index
      });
    }
  }


  const seen = new Map();
  for (const f of findings) {
    if (!seen.has(f.id)) seen.set(f.id, f);
  }

  const hasCritical = [...seen.values()].some(f => f.severity === "critical");
  if (!hasCritical) {
    for (const f of entropyCheck(text)) {
      if (!seen.has(f.id)) seen.set(f.id, f);
    }
  }


  for (const f of contextScan(text)) {
    if (!seen.has(f.id)) seen.set(f.id, f);
  }


  for (const f of nlpScan(text)) {
    if (!seen.has(f.id)) seen.set(f.id, f);
  }

  return [...seen.values()];
}


function guardOwlMask(text, findings) {
  let result = text;
  const sorted = [...findings].sort((a, b) => b.index - a.index);
  for (const f of sorted) {
    const masked = f.match.slice(0, 3) + "****" + f.match.slice(-2);
    result = result.slice(0, f.index) + masked + result.slice(f.index + f.match.length);
  }
  return result;
}



function shannonEntropy(str) {
  const freq = {};
  for (const c of str) freq[c] = (freq[c] || 0) + 1;
  return -Object.values(freq).reduce((sum, f) => {
    const p = f / str.length;
    return sum + p * Math.log2(p);
  }, 0);
}

function entropyCheck(text) {
  const tokens = text.split(/[\s\n\r,;()\[\]{}'"]+/);
  for (const token of tokens) {
    if (token.length < 20 || token.length > 200) continue;
    if (!/[A-Za-z]/.test(token) || !/[0-9]/.test(token)) continue;
    if (shannonEntropy(token) > 4.5) {
      return [{
        id: "high_entropy_secret",
        label: "High-entropy secret / token",
        severity: "high",
        match: token,
        index: text.indexOf(token)
      }];
    }
  }
  return [];
}


const CONTEXT_PATTERNS = [
  {
    id: "context_token",
    label: "Possible token / credential",
    severity: "high",
    pattern: /(?:token|secret|key|auth|bearer|credential|api_key|access_key)[^\n]{0,20}[:=\s]+([A-Za-z0-9_\-]{20,})/gi
  },
  {
    id: "context_password",
    label: "Possible password in context",
    severity: "high",
    pattern: /(?:password|passwd|pass|pwd|pin)[^\n]{0,10}[:=\s]+(\S{8,})/gi
  },
  {
    id: "context_connection",
    label: "Possible connection detail",
    severity: "medium",
    pattern: /(?:host|endpoint|server|database|db_url|conn)[^\n]{0,15}[:=\s]+([\w\-\.]+\.\w{2,})/gi
  }
];

function contextScan(text) {
  const findings = [];
  for (const rule of CONTEXT_PATTERNS) {
    const regex = new RegExp(rule.pattern.source, rule.pattern.flags);
    const match = regex.exec(text);
    if (match) {
      findings.push({
        id: rule.id,
        label: rule.label,
        severity: rule.severity,
        match: match[0],
        index: match.index
      });
    }
  }
  return findings;
}


function nlpScan(text) {
  if (!nlp) return [];
  const findings = [];
  try {
    const doc = nlp(text);

    const phones = doc.phoneNumbers?.().out("array") || [];
    if (phones.length > 0) {
      findings.push({
        id: "nlp_phone",
        label: "Phone number (NLP)",
        severity: "medium",
        match: phones[0],
        index: text.indexOf(phones[0])
      });
    }

    const orgs = doc.organizations().out("array").filter(o => o.length >= 5 && /^[A-Za-z0-9\s]+$/.test(o));
    if (orgs.length > 0 && text.length > 100) {
      findings.push({
        id: "nlp_org",
        label: "Organisation name (NLP)",
        severity: "low",
        match: orgs[0],
        index: text.indexOf(orgs[0])
      });
    }
  } catch (_) { }
  return findings;
}
