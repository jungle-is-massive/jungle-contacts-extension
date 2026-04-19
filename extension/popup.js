/**
 * Popup logic for Jungle Intermediary Contacts.
 *
 * Flow:
 *   1. Ask the active tab for profile data (via content script message).
 *   2. Prefill the form. If not on LinkedIn, show empty state.
 *   3. On submit, POST to Supabase intermediary_people.
 */

const SUPABASE_URL = 'https://iehkvlyjumkzccoqqgxl.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImllaGt2bHlqdW1remNjb3FxZ3hsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU4MTMwNzYsImV4cCI6MjA5MTM4OTA3Nn0.pF9K9aBwWN10JRT_ODTLPzsdPKH3X0CW30WrPMn9lGs';
const SB_HEADERS = {
  'apikey': SUPABASE_KEY,
  'Authorization': `Bearer ${SUPABASE_KEY}`,
  'Content-Type': 'application/json',
};
const PLAN_URL = 'https://jungle-is-massive.github.io/intermediary-plan/';

// Must match the IDs hardcoded in the intermediary-plan page.
// If you add new intermediaries there, mirror them here.
const INTERMEDIARIES = [
  { id: 'aar', name: 'AAR', tier: 1 },
  { id: 'ingenuity', name: 'Ingenuity+', tier: 1 },
  { id: 'creativebrief', name: 'Creativebrief', tier: 1 },
  { id: 'oystercatchers', name: 'Oystercatchers', tier: 1 },
  { id: 'observatory', name: 'Observatory International', tier: 2 },
  { id: 'tuffon', name: 'Tuffon Hall', tier: 2 },
  { id: 'elevator', name: 'Nicky Bullard / Elevator', tier: 2 },
  { id: 'gonetwork', name: 'The GO Network', tier: 2 },
  { id: 'masterclassing', name: 'Masterclassing', tier: 3 },
  { id: 'adassoc', name: 'Advertising Association', tier: 3 },
];

const $ = (id) => document.getElementById(id);
const statusEl = $('status');
const formEl = $('form');
const emptyEl = $('empty');
const resultEl = $('result');

function setStatus(text, cls) {
  statusEl.textContent = text;
  statusEl.className = 'status' + (cls ? ' ' + cls : '');
}

function showResult(html, cls) {
  resultEl.innerHTML = html;
  resultEl.className = 'result ' + cls;
}

// Populate the intermediary dropdown
function populateOrgDropdown(defaultGuess) {
  const sel = $('org_id');
  sel.innerHTML =
    '<option value="">Select an intermediary…</option>' +
    INTERMEDIARIES.map(i =>
      `<option value="${i.id}"${i.id === defaultGuess ? ' selected' : ''}>${i.name} (Tier ${i.tier})</option>`
    ).join('');
}

// Heuristic: match the LinkedIn "current company" against our intermediary names
function guessOrg(company) {
  if (!company) return '';
  const c = company.toLowerCase();
  for (const i of INTERMEDIARIES) {
    const n = i.name.toLowerCase();
    if (c.includes(n) || n.includes(c)) return i.id;
  }
  // Manual synonym map for tricky cases
  const synonyms = {
    'nicky bullard': 'elevator',
    'the elevator': 'elevator',
    'go network': 'gonetwork',
    'advertising association': 'adassoc',
  };
  for (const [k, v] of Object.entries(synonyms)) {
    if (c.includes(k)) return v;
  }
  return '';
}

// Ask the content script for profile data
async function getProfileFromTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.url || !tab.url.includes('linkedin.com/in/')) {
    return { ok: false, reason: 'not-linkedin' };
  }

  // Try sending a message to the existing content script.
  // If the content script isn't loaded (e.g. page loaded before extension install), inject it.
  try {
    return await chrome.tabs.sendMessage(tab.id, { type: 'scrapeProfile' });
  } catch (err) {
    // Inject on demand and retry
    try {
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
      return await chrome.tabs.sendMessage(tab.id, { type: 'scrapeProfile' });
    } catch (err2) {
      return { ok: false, reason: 'scrape-failed', error: String(err2) };
    }
  }
}

async function init() {
  populateOrgDropdown();

  const result = await getProfileFromTab();

  if (!result || !result.ok) {
    statusEl.style.display = 'none';
    emptyEl.style.display = 'block';
    return;
  }

  const d = result.data;
  $('name').value = d.name || '';
  $('title').value = d.title || '';
  $('linkedin_url').value = d.linkedin_url || '';

  const guessed = guessOrg(d.company);
  populateOrgDropdown(guessed);

  if (d.company && !guessed) {
    setStatus(`Profile loaded · "${d.company}" not matched`, '');
  } else if (guessed) {
    const name = INTERMEDIARIES.find(i => i.id === guessed).name;
    setStatus(`Matched to ${name}`, 'ok');
  } else {
    setStatus('Profile loaded', 'ok');
  }

  formEl.style.display = 'block';
}

// ─── Save handler ───
formEl.addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = $('save-btn');
  btn.disabled = true;
  btn.textContent = 'Saving…';
  resultEl.className = 'result';
  resultEl.style.display = 'none';

  const record = {
    org_id: $('org_id').value,
    name: $('name').value.trim(),
    title: $('title').value.trim() || null,
    role: $('role').value.trim() || null,
    warmth: $('warmth').value,
    influence: $('influence').value,
    linkedin_url: $('linkedin_url').value.trim() || null,
    notes: $('notes').value.trim() || null,
    source: 'chrome-extension',
  };

  if (!record.org_id || !record.name) {
    showResult('Intermediary and name are required.', 'err');
    btn.disabled = false;
    btn.textContent = 'Save contact';
    return;
  }

  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/intermediary_people`, {
      method: 'POST',
      headers: { ...SB_HEADERS, 'Prefer': 'return=representation' },
      body: JSON.stringify(record),
    });
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(errText || `HTTP ${res.status}`);
    }
    const [saved] = await res.json();
    const orgName = INTERMEDIARIES.find(i => i.id === record.org_id)?.name || record.org_id;
    showResult(
      `Saved ${saved.name} to ${orgName}.  <a href="${PLAN_URL}" target="_blank">View plan →</a>`,
      'ok'
    );
    btn.textContent = 'Saved ✓';
    // Don't re-enable — prevent accidental double-saves. User can close and re-open.
    setTimeout(() => { btn.textContent = 'Save another'; btn.disabled = false; formEl.reset(); populateOrgDropdown(); }, 2000);
  } catch (err) {
    console.error(err);
    showResult('Save failed: ' + (err.message || String(err)), 'err');
    btn.disabled = false;
    btn.textContent = 'Save contact';
  }
});

$('cancel-btn').addEventListener('click', () => window.close());

init();
