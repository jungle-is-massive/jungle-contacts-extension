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

// ── HubSpot config ──────────────────────────────────────────────
// We write contacts to HubSpot via a Make.com webhook so we never
// expose a private HubSpot API token in the extension.
const MAKE_WEBHOOK_URL = 'https://hook.eu1.make.com/0pw21mpqnhp4mry2wsy7fifldrdo36hm';
// (Set this to your actual Make.com webhook URL after creating the scenario)

const INTERMEDIARY_ORG_IDS = new Set([
  'aar','ingenuity','creativebrief','oystercatchers','observatory',
  'tuffon','auditstar','individual_consultants','gonetwork','masterclassing','adassoc'
]);

// ── Contact type state ───────────────────────────────────────────
let currentContactType = 'intermediary';

function setContactType(type, btn) {
  currentContactType = type;
  document.querySelectorAll('.type-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');

  const isIntermediary = type === 'intermediary';
  const needsSourceName = ['Referral','Speaking / Event'].includes(type);

  document.getElementById('field-org').style.display         = isIntermediary ? '' : 'none';
  document.getElementById('field-source-name').style.display = needsSourceName ? '' : 'none';
  document.getElementById('field-role').style.display        = isIntermediary ? '' : 'none';
  document.getElementById('field-influence').style.display   = isIntermediary ? '' : 'none';

  if (needsSourceName) {
    const labelMap = { 'Referral': 'Referred by', 'Speaking / Event': 'Event name' };
    document.getElementById('source-name-label').textContent = labelMap[type] || 'Source';
    document.getElementById('source_name').placeholder = type === 'Referral' ? 'e.g. Jane Smith' : 'e.g. Cannes Lions';
  }
}


// Must match the IDs hardcoded in the intermediary-plan page.
// If you add new intermediaries there, mirror them here.
// Loaded from Supabase at runtime — this is the fallback if Supabase is unreachable.
// The dropdown is populated by loadIntermediaries() on init.
let INTERMEDIARIES = [
  { id: 'aar',                  name: 'AAR',                       tier: 1 },
  { id: 'ingenuity',            name: 'Ingenuity+',                tier: 1 },
  { id: 'creativebrief',        name: 'Creativebrief',             tier: 1 },
  { id: 'oystercatchers',       name: 'Oystercatchers',            tier: 1 },
  { id: 'observatory',          name: 'Observatory International', tier: 2 },
  { id: 'tuffon',               name: 'Tuffon Hall',               tier: 2 },
  { id: 'auditstar',            name: 'Auditstar',                 tier: 2 },
  { id: 'individual_consultants', name: 'Individual Consultants',  tier: 2, isGroup: true },
  { id: 'gonetwork',            name: 'The GO Network',            tier: 2 },
  { id: 'masterclassing',       name: 'Masterclassing',            tier: 3 },
  { id: 'adassoc',              name: 'Advertising Association',   tier: 3 },
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

// Load intermediaries from Supabase — keeps the extension in sync without code updates
async function loadIntermediaries() {
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/intermediary_orgs?select=id,name,tier,category,website&order=tier.asc,name.asc`,
      { headers: SB_HEADERS }
    );
    if (res.ok) {
      const data = await res.json();
      if (data && data.length > 0) {
        INTERMEDIARIES = data.map(r => ({
          id: r.id,
          name: r.name,
          tier: r.tier || 2,
          isGroup: r.category === 'individual_consultant_group',
          website: r.website || null,
        }));
      }
    }
  } catch (e) {
    // Silently fall back to hardcoded list
  }
}

// Populate the intermediary dropdown
function populateOrgDropdown(defaultGuess) {
  const sel = $('org_id');
  sel.innerHTML =
    '<option value="">Select an intermediary…</option>' +
    INTERMEDIARIES.map(i =>
      `<option value="${i.id}"${i.id === defaultGuess ? ' selected' : ''}>${i.name}${i.isGroup ? ' — Individual Consultants' : ' (Tier ' + i.tier + ')'}</option>`
    ).join('') +
    '<option value="__new__">+ Add new intermediary…</option>';
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
    'nicky bullard': 'individual_consultants',
    'elevator': 'individual_consultants',
    'alex young': 'individual_consultants',
    'ay consulting': 'individual_consultants',
    'auditstar': 'auditstar',
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

  const tryScrape = async () => {
    try {
      return await chrome.tabs.sendMessage(tab.id, { type: 'scrapeProfile' });
    } catch (err) {
      // Inject content script on demand and retry
      try {
        await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
        return await chrome.tabs.sendMessage(tab.id, { type: 'scrapeProfile' });
      } catch (err2) {
        return { ok: false, reason: 'scrape-failed', error: String(err2) };
      }
    }
  };

  // Poll up to 1.5s, every 150ms. Return as soon as we have a name.
  // Title loads slightly later on LinkedIn — we fill it in from whatever we get.
  const start = Date.now();
  const TIMEOUT = 1500;
  const INTERVAL = 150;
  let result = null;
  let bestSoFar = null;

  while (Date.now() - start < TIMEOUT) {
    result = await tryScrape();
    if (result && result.ok) {
      if (!bestSoFar || (result.data?.name && !bestSoFar.data?.name) ||
          (result.data?.title && !bestSoFar.data?.title)) {
        bestSoFar = result;
      }
      // Return as soon as we have a name — title is a bonus, not a blocker
      if (result.data?.name) return result;
    }
    await new Promise(r => setTimeout(r, INTERVAL));
  }

  return bestSoFar || result;
}

async function init() {
  // Populate immediately from hardcoded fallback — no wait, no flicker
  populateOrgDropdown();

  // Load live orgs from Supabase in the background; refresh dropdown when done
  loadIntermediaries().then(() => populateOrgDropdown()).catch(() => {});

  // Ensure field visibility is correct for default type
  const defaultBtn = document.querySelector('.type-btn[data-type="intermediary"]');
  if (defaultBtn) setContactType('intermediary', defaultBtn);

  // Wire up the "Add new intermediary" inline handler
  $('org_id').addEventListener('change', function() {
    const existing = document.getElementById('new-intermediary-row');
    if (this.value === '__new__') {
      if (!existing) {
        const row = document.createElement('div');
        row.id = 'new-intermediary-row';
        row.style.cssText = 'margin-top:-4px;margin-bottom:4px;display:flex;gap:6px;align-items:center';
        row.innerHTML = `
          <input type="text" id="new-int-name" placeholder="e.g. Alex Young Consulting" style="flex:1;padding:7px 9px;border:1.5px solid var(--black);border-radius:7px;font-family:'DM Sans',sans-serif;font-size:12px;background:var(--white);color:var(--black)" />
          <input type="url" id="new-int-website" placeholder="https://example.com" style="flex:1;padding:7px 9px;border:1.5px solid var(--border);border-radius:7px;font-family:'DM Sans',sans-serif;font-size:12px;background:var(--white);color:var(--black)" />
          <button type="button" id="new-int-save" style="background:var(--black);color:var(--green);border:none;padding:7px 12px;border-radius:7px;font-family:'DM Sans',sans-serif;font-weight:700;font-size:11px;cursor:pointer;white-space:nowrap">Add</button>
        `;
        this.parentElement.appendChild(row);
        document.getElementById('new-int-name').focus();
        document.getElementById('new-int-save').addEventListener('click', () => addNewIntermediary());
        document.getElementById('new-int-name').addEventListener('keydown', (e) => { if(e.key==='Enter'){e.preventDefault();addNewIntermediary();} });
      }
    } else {
      if (existing) existing.remove();
    }
  });

  setStatus('Scanning page…', '');
  // Keep status visible for up to 1.5s, then show form regardless

  const result = await getProfileFromTab();

  // Always show the form — pre-fill from LinkedIn if found, empty otherwise
  statusEl.style.display = 'none';

  if (!result || !result.ok) {
    // Not on a LinkedIn profile — show form empty for manual entry
    // Default to LinkedIn type, user can switch
    setContactType('LinkedIn', document.querySelector('.type-btn[data-type="LinkedIn"]'));
    formEl.style.display = 'block';
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

  // Show debug info if title came up empty — helps diagnose LinkedIn DOM changes
  if (!d.title && d._debug) {
    const debugEl = document.createElement('details');
    debugEl.style.cssText = 'margin-top:10px;padding:8px 10px;background:#fff8e1;border:1px solid #f5a623;border-radius:7px;font-size:11px';
    debugEl.innerHTML = `
      <summary style="cursor:pointer;font-weight:700;color:#7a4e00">Title not detected — show what the scraper saw</summary>
      <pre style="margin-top:6px;white-space:pre-wrap;word-break:break-word;font-family:'DM Mono',monospace;font-size:10px;color:#555;line-height:1.4">${escapeHtml(JSON.stringify(d._debug, null, 2))}</pre>
      <button type="button" id="copy-debug" style="margin-top:6px;padding:4px 10px;font-size:10px;border:1px solid #f5a623;background:white;border-radius:4px;cursor:pointer">Copy debug data</button>
    `;
    formEl.insertBefore(debugEl, formEl.querySelector('.actions'));
    document.getElementById('copy-debug').addEventListener('click', () => {
      navigator.clipboard.writeText(JSON.stringify(d._debug, null, 2));
      document.getElementById('copy-debug').textContent = 'Copied ✓';
    });
  }

  formEl.style.display = 'block';
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, m => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m]));
}

// ─── Add new intermediary on the fly ───
async function addNewIntermediary() {
  const nameEl = document.getElementById('new-int-name');
  const websiteEl = document.getElementById('new-int-website');
  const saveBtn = document.getElementById('new-int-save');
  const name = nameEl ? nameEl.value.trim() : '';
  const website = websiteEl ? websiteEl.value.trim() : '';
  if (!name) { nameEl.style.borderColor = 'var(--red)'; return; }

  saveBtn.disabled = true;
  saveBtn.textContent = '…';

  // Create a slug from the name
  const id = name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');

  // Try to save to Supabase intermediaries table
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/intermediary_orgs`, {
      method: 'POST',
      headers: { ...SB_HEADERS, 'Prefer': 'resolution=merge-duplicates,return=representation' },
      body: JSON.stringify({ id, name, website: website || null, tier: 2, category: 'agency', paid: false }),
    });
    if (!res.ok) throw new Error(await res.text());
    const [saved] = await res.json();

    // Add to local list and refresh dropdown
    INTERMEDIARIES.push({ id: saved.id, name: saved.name, tier: saved.tier || 2 });
    const newIntRow = document.getElementById('new-intermediary-row');
    if (newIntRow) newIntRow.remove();
    populateOrgDropdown(saved.id);
    setStatus(`Added "${saved.name}" — now select and save contact`, 'ok');
  } catch (err) {
    // Fallback: add locally only (no Supabase intermediaries table yet)
    INTERMEDIARIES.push({ id, name, tier: 2 });
    const newIntRow = document.getElementById('new-intermediary-row');
    if (newIntRow) newIntRow.remove();
    populateOrgDropdown(id);
    setStatus(`"${name}" added locally`, 'ok');
  }
}

// ─── Save handler ───
formEl.addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = $('save-btn');
  btn.disabled = true;
  btn.textContent = 'Saving…';
  resultEl.className = 'result';
  resultEl.style.display = 'none';

  // Block submit if "Add new" is still selected without saving
  if (currentContactType === 'intermediary' && $('org_id').value === '__new__') {
    showResult('Please add and save the new intermediary first, then save the contact.', 'err');
    btn.disabled = false;
    btn.textContent = 'Save contact';
    return;
  }

  const isIntermediary = currentContactType === 'intermediary';

  // Build record depending on contact type
  const name = $('name').value.trim();
  if (!name) {
    showResult('Name is required.', 'err');
    btn.disabled = false;
    btn.textContent = 'Save contact';
    return;
  }
  if (isIntermediary && !$('org_id').value) {
    showResult('Please select an intermediary.', 'err');
    btn.disabled = false;
    btn.textContent = 'Save contact';
    return;
  }

  const record = isIntermediary ? {
    // → intermediary_people
    org_id:      $('org_id').value,
    name,
    title:       $('title').value.trim() || null,
    role:        $('role').value.trim()  || null,
    warmth:      $('warmth').value,
    influence:   $('influence').value,
    linkedin_url: $('linkedin_url').value.trim() || null,
    email:       $('email').value.trim() || null,
    notes:       $('notes').value.trim() || null,
    source:      'chrome-extension',
  } : {
    // → contacts (unified table)
    full_name:   name,
    first_name:  name.split(' ')[0],
    last_name:   name.split(' ').slice(1).join(' ') || null,
    title:       $('title').value.trim() || null,
    company:     $('company').value.trim() || null,
    linkedin_url: $('linkedin_url').value.trim() || null,
    email:       $('email').value.trim() || null,
    notes:       $('notes').value.trim() || null,
    source_type: currentContactType,
    source_name: $('source_name').value.trim() || null,
    source:      'chrome-extension',
  };

  if (!record) {

  try {
    const isIntermediary = currentContactType === 'intermediary';
    const table = isIntermediary ? 'intermediary_people' : 'contacts';

    // 1. Save to Supabase
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
      method: 'POST',
      headers: { ...SB_HEADERS, 'Prefer': 'return=representation' },
      body: JSON.stringify(record),
    });
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(errText || `HTTP ${res.status}`);
    }
    const [saved] = await res.json();

    // 2. Dual-write to HubSpot via Make.com webhook (fire-and-forget)
    const hsPayload = {
      firstname:   record.first_name || record.name?.split(' ')[0] || '',
      lastname:    record.last_name  || record.name?.split(' ').slice(1).join(' ') || '',
      email:       record.email || '',
      company:     record.company || (isIntermediary ? (INTERMEDIARIES.find(i=>i.id===record.org_id)?.name||'') : ''),
      jobtitle:    record.title || '',
      linkedin:    record.linkedin_url || '',
      source_type: isIntermediary ? 'Intermediary' : currentContactType,
      source_name: isIntermediary ? (INTERMEDIARIES.find(i=>i.id===record.org_id)?.name||'') : (record.source_name||''),
      notes:       record.notes || '',
      supabase_id: saved.id,
    };
    fetch(MAKE_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(hsPayload),
    }).catch(() => {}); // silent fail — Supabase write is the source of truth

    const orgName = isIntermediary
      ? (INTERMEDIARIES.find(i => i.id === record.org_id)?.name || record.org_id)
      : currentContactType;
    showResult(
      `Saved ${saved.name || saved.full_name} to ${orgName}.  <a href="${PLAN_URL}" target="_blank">View plan →</a>`,
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

// Show extension version in the header so it's obvious which build is loaded
try {
  const v = chrome.runtime.getManifest().version;
  $('version-label').textContent = `v${v}`;
} catch (_) { /* ignore */ }

init();
