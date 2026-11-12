/**
 * SplitWoi cleanup script:
 * 1. Remove all QR-related code (both openDeviceModal duplicates) → replace with single clean modal
 * 2. Remove anim-wave (waving hand animation)
 * 3. Remove excessive anim-pop from list items (keep only on page-level/hero)
 * 4. Reduce emoji clutter (keep functional icons, remove decorative ones)
 */

const fs = require('fs');
const path = require('path');
const FILE = path.join(__dirname, 'public', 'index.html');

let html = fs.readFileSync(FILE, 'utf8');

// ─── 1. Remove getQRLibrary function ───────────────────────────────────────────
html = html.replace(
/\/\/ 6\. Load QR code library from CDN[\s\S]*?^}\n/m,
''
);

// ─── 2. Remove buildQRSvg function ────────────────────────────────────────────
html = html.replace(
/\nasync function buildQRSvg\(text\) \{[\s\S]*?^}\n/m,
'\n'
);

// ─── 3. Remove BOTH old openDeviceModal functions + replace with clean one ────
// First, remove both occurrences of `async function openDeviceModal() { ... }`
// They span from the function header to the closing `}` at column 0.
// We'll remove everything from the first definition through the end of the second.

const firstModal = html.indexOf('// 7. Connect iPhone & Laptop Device Modal (Works on any Wi-Fi or mobile data)');
const secondModal = html.indexOf('// 7. Connect iPhone & Laptop Device Modal\nasync function openDeviceModal()');
// Find end of second modal block
let depth = 0;
let inSecond = false;
let secondEnd = -1;
for (let i = secondModal; i < html.length; i++) {
  if (html[i] === '{') { depth++; inSecond = true; }
  if (html[i] === '}') { depth--; }
  if (inSecond && depth === 0) { secondEnd = i + 1; break; }
}

if (firstModal !== -1 && secondEnd !== -1) {
  // Replace everything from firstModal through secondEnd with clean function
  const cleanModal = `
// Connect Device Modal
async function openDeviceModal() {
  playSfx('click');

  let ipInfo = { port: 3000, ips: [] };
  try { ipInfo = await api('network-info'); } catch {}

  const ipsList = (ipInfo.ips || []).filter(i => !/WSL|vEthernet|Hyper-V|Loopback|Virtual|VMware/i.test(i.name));
  const activeIp = ipsList[0]?.ip || ipInfo.ips?.[0]?.ip || location.hostname;
  const port = ipInfo.port || location.port || 3000;
  const localUrl = \`http://\${activeIp}:\${port}\`;

  const currentUrl = location.origin;
  const isPublicUrl = !currentUrl.includes('localhost') && !currentUrl.match(/^https?:\\/\\/(10\\.|192\\.168\\.|172\\.(1[6-9]|2[0-9]|3[01])\\.)/)
  const shareUrl = isPublicUrl ? currentUrl : localUrl;

  const modal = document.createElement('div');
  modal.className = 'vault-overlay';
  modal.id = 'dev-modal-overlay';
  modal.innerHTML = \`
    <div class="vault-modal anim-pop" style="max-width:480px;padding:26px;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
        <h3 style="margin:0;font-size:1.25rem;">Open on Another Device</h3>
        <button class="icon-btn" id="close-dev-modal">✕</button>
      </div>

      \${isPublicUrl ? \`
        <div style="background:var(--acc);border:2px solid var(--line);border-radius:14px;padding:12px 16px;margin-bottom:16px;">
          <b style="color:#111;display:block;">Public Link Active</b>
          <span style="font-size:0.85rem;color:#333;">Works from anywhere — no shared Wi-Fi needed.</span>
        </div>
      \` : \`
        <div style="background:var(--card-sub);border:2px solid var(--line);border-radius:14px;padding:12px 16px;margin-bottom:16px;font-size:0.85rem;color:var(--mute);">
          <b style="color:var(--ink);">Local network only.</b> To get a public link that works from anywhere, run <code>start_app.bat</code> in your project folder.
        </div>
      \`}

      <label>Link to share</label>
      <div style="display:flex;gap:8px;align-items:center;margin-top:6px;margin-bottom:18px;">
        <input id="share-link-input" style="margin:0;font-family:var(--mono);font-size:13px;font-weight:700;" value="\${shareUrl}" readonly>
        <button class="btn acc" id="copy-share-link" style="padding:10px 18px;flex-shrink:0;">Copy</button>
      </div>

      <div style="background:var(--card-sub);border:1.5px solid var(--line);border-radius:12px;padding:14px;font-size:0.84rem;color:var(--mute);line-height:1.6;">
        <b style="color:var(--ink);display:block;margin-bottom:4px;">How to open:</b>
        <b style="color:var(--ink);">iPhone:</b> Open Safari, paste the link, then tap Share → Add to Home Screen for an app icon.<br>
        <b style="color:var(--ink);">Laptop:</b> Open Chrome or Edge and paste the link.
      </div>
    </div>
  \`;

  document.body.appendChild(modal);

  modal.querySelector('#close-dev-modal').onclick = () => modal.remove();
  modal.onclick = e => { if (e.target === modal) modal.remove(); };

  modal.querySelector('#copy-share-link').onclick = () => {
    navigator.clipboard.writeText(shareUrl);
    playSfx('click');
    showToast('Link copied! Share it with your friend.', 'success');
  };
}
`;
  html = html.slice(0, firstModal) + cleanModal + html.slice(secondEnd);
}

// ─── 4. Remove anim-wave class from waving hand emoji in hero ─────────────────
// Remove the entire waving hand div (decorative)
html = html.replace(
  /\s*<div style="font-size:3\.2rem;line-height:1;" class="anim-wave">👋<\/div>/g,
  ''
);
// Remove anim-wave from auth icon (keep the icon, remove the class)
html = html.replace(
  /class="anim-wave"/g,
  ''
);

// ─── 5. Remove anim-pop from individual list/ticket items (keep page-level) ───
// Remove from ticket items in history
html = html.replace(/<div class="ticket anim-pop">/g, '<div class="ticket">');
// Remove from individual people/debt cards that are list items (not hero/page-level)
// Lines 2157, 2166, 2183 area - these are in the people() view list items
// We'll be surgical: remove anim-pop only where it's on <div class="card anim-pop"> inside map() calls
// (These are list-rendered items, not page-level)
// Keep: hero-banner, stat cards (they're first-load), auth card, vault modal
// Remove from: receipt items, people list items, new-receipt form card
// We identify map()-generated cards by context. The safest approach:
// remove anim-pop from cards that are inside template literal map() chains
// but keep stat cards (they have animation-delay inline styles) and hero.

// Remove anim-pop from the "new receipt" form card (line ~1838)
html = html.replace(
  /<div class="card anim-pop">\s*<h3 style="margin:0 0 14px;">New Receipt/,
  '<div class="card"><h3 style="margin:0 0 14px;">New Receipt'
);

// Remove from split-bill summary card (people view)
html = html.replace(
  /<div class="card anim-pop" style="background:var\(--acc\);color:#111;display:flex;justify-content:space-between;align-item/g,
  '<div class="card" style="background:var(--acc);color:#111;display:flex;justify-content:space-between;align-item'
);
html = html.replace(
  /<div class="card anim-pop">\s*<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">\s*<h3 style="margin:0;">Friends/,
  '<div class="card"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;"><h3 style="margin:0;">Friends'
);
html = html.replace(
  /<div class="card anim-pop">\s*<h3 style="margin:0 0 12px;">Split Summary/,
  '<div class="card"><h3 style="margin:0 0 12px;">Split Summary'
);

// ─── 6. Reduce emoji clutter in navigation ────────────────────────────────────
// Keep nav icons but clean up text
// Nav is fine as is — icons in nav are functional/UX

// ─── 7. Clean up hero quick-pills emojis ─────────────────────────────────────
html = html.replace(/<a class="quick-pill" href="#new">📸 Quick Scan<\/a>/, '<a class="quick-pill" href="#new">Scan Receipt</a>');
html = html.replace(/<a class="quick-pill" href="#people">👥 Settle Up<\/a>/, '<a class="quick-pill" href="#people">Settle Up</a>');
html = html.replace(/<a class="quick-pill" href="#hist">📜 Receipts<\/a>/, '<a class="quick-pill" href="#hist">Receipts</a>');
html = html.replace(
  /<button class="quick-pill" id="hero-share-dev" style="font-family:inherit;">📱 Connect Phone \/ Laptop<\/button>/,
  '<button class="quick-pill" id="hero-share-dev" style="font-family:inherit;">Connect Device</button>'
);

// ─── 8. Clean auth view waving emoji ─────────────────────────────────────────
// Remove the anim-wave span entirely on auth card; keep the icon static
html = html.replace(
  /<span style="font-size:3rem;display:inline-block;" >\${isForgot \? '🔑' : '💸'}<\/span>/g,
  '<span style="font-size:2.4rem;display:inline-block;">${isForgot ? \'🔑\' : \'💸\'}</span>'
);

// ─── 9. Remove topbar 📱 emoji text button — keep as text ────────────────────
// The icon-btn with 📱 is fine (it's a small icon button), keep it
// but clean the title text 
html = html.replace(
  'title="Open on iPhone or another Laptop">📱</button>',
  'title="Open on another device">📱</button>'
);

// ─── 10. Remove 'Nudge 💬' trailing emoji ────────────────────────────────────
html = html.replace(/Nudge 💬/g, 'Nudge');

// ─── 11. Remove decorative emojis from toast/error messages ──────────────────
// Keep ⚠️ for warnings, ✓ for success, remove redundant ones
// auth error already has ⚠️ which is fine

// ─── 12. Remove 💡 from tips section heading in device modal ─────────────────
// (Already handled in new modal above - no emoji in tips heading)

// ─── 13. Reduce stat card emojis (keep — they serve as visual category icons) ─
// These are functional, leave them

// Write output
fs.writeFileSync(FILE, html, 'utf8');
console.log('Done. Total lines:', html.split('\n').length);

// Verify no more QR references
const remaining = [];
if (html.includes('qr-wrap')) remaining.push('qr-wrap');
if (html.includes('buildQRSvg')) remaining.push('buildQRSvg');
if (html.includes('getQRLibrary')) remaining.push('getQRLibrary');
if (html.includes('createQRCodeSVG')) remaining.push('createQRCodeSVG');
if (html.includes('qrcode-generator')) remaining.push('qrcode-generator');
const modalCount = html.split('async function openDeviceModal').length - 1;
console.log('QR remnants:', remaining.length ? remaining : 'NONE');
console.log('openDeviceModal count:', modalCount, '(should be 1)');
console.log('anim-wave count:', (html.match(/anim-wave/g) || []).length, '(should be 0 or in CSS only)');
