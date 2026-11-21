// Builds tests/harness.html: the real popup.html + a fake `chrome` object, so the UI
// can be clicked through in a normal browser tab. Run: node tests/build-harness.js
const fs = require('fs'), path = require('path');
const ext = path.join(__dirname, '..', 'linkedin extention');
let html = fs.readFileSync(path.join(ext, 'popup.html'), 'utf8');
const v = Date.now(); // cache-buster so the browser always loads the latest code
html = html.replace(/(href|src)="(?!http|#)([^"]+)"/g, (m, a, p) => `${a}="../linkedin%20extention/${p}?v=${v}"`);
html = html.replace(`<script src="../linkedin%20extention/lib/storage.js?v=${v}"></script>`, `<script src="chrome-stub.js?v=${v}"></script>\n  <script src="../linkedin%20extention/lib/storage.js?v=${v}"></script>`);
fs.writeFileSync(path.join(__dirname, 'harness.html'), html);
console.log('wrote tests/harness.html');
