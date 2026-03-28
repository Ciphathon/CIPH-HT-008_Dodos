const JavaScriptObfuscator = require("javascript-obfuscator");
const fs = require("fs");
const path = require("path");

const OBFUSCATE = [
  "content.js",
  "background.js",
  "offscreen.js",
  "detector.js",
  "modal.js",
  "popup.js",
  "options.js"
];

const COPY_AS_IS = [
  "manifest.json",
  "offscreen.html",
  "popup.html",
  "popup.css",
  "options.html",
  "options.css",
  "modal.css",
  "compromise.min.js",
  "tesseract.min.js",
  "tesseract.worker.min.js",
  "tesseract-core-simd-lstm.wasm.js"
];

const SRC = __dirname;
const DIST = path.join(__dirname, "dist");

const OBFUSCATOR_OPTIONS = {
  compact: true,
  controlFlowFlattening: true,
  controlFlowFlatteningThreshold: 0.5,
  deadCodeInjection: true,
  deadCodeInjectionThreshold: 0.2,
  debugProtection: false,
  disableConsoleOutput: false,
  identifierNamesGenerator: "hexadecimal",
  renameGlobals: false,
  selfDefending: false,
  stringArray: true,
  stringArrayEncoding: ["base64"],
  stringArrayThreshold: 0.75,
  transformObjectKeys: true,
  unicodeEscapeSequence: false
};

if (!fs.existsSync(DIST)) fs.mkdirSync(DIST, { recursive: true });
const distIcons = path.join(DIST, "icons");
if (!fs.existsSync(distIcons)) fs.mkdirSync(distIcons, { recursive: true });

console.log("Building dist...\n");
for (const file of OBFUSCATE) {
  const src = path.join(SRC, file);
  if (!fs.existsSync(src)) { console.warn(`  ⚠️  Missing: ${file}`); continue; }
  const code = fs.readFileSync(src, "utf8");
  const result = JavaScriptObfuscator.obfuscate(code, OBFUSCATOR_OPTIONS);
  fs.writeFileSync(path.join(DIST, file), result.getObfuscatedCode());
  console.log(`  ✓ Obfuscated: ${file}`);
}

for (const file of COPY_AS_IS) {
  const src = path.join(SRC, file);
  if (!fs.existsSync(src)) { console.warn(`  ⚠️  Missing (skip): ${file}`); continue; }
  fs.copyFileSync(src, path.join(DIST, file));
  console.log(`  → Copied: ${file}`);
}

// Copy icons folder
const iconsSrc = path.join(SRC, "icons");
if (fs.existsSync(iconsSrc)) {
  fs.readdirSync(iconsSrc).forEach(f => {
    fs.copyFileSync(path.join(iconsSrc, f), path.join(distIcons, f));
  });
  console.log(`  → Copied: icons/`);
}

console.log(`\nBuild complete -> ./dist/`);
