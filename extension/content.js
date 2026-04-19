/**
 * Content script — runs on linkedin.com/in/* pages.
 * When the popup asks for profile data, scrape the page and send it back.
 *
 * Strategy: read multiple stable signals and prefer the most reliable.
 *   1. <h1> tag           — almost always the name on a profile
 *   2. <meta og:title>     — usually just the name
 *   3. <title> tag         — "(N) Name - Headline | LinkedIn"
 *   4. <meta og:description> — full headline
 *   5. <meta description> — "Title at Company. Location. View Name's profile…"
 *   6. .text-body-medium  — DOM headline (volatile class but still common)
 */

function clean(s) {
  return (s || '').replace(/\s+/g, ' ').replace(/^\s+|\s+$/g, '').trim();
}

function getMeta(selector) {
  const el = document.querySelector(selector);
  return el ? clean(el.getAttribute('content') || '') : '';
}

function getH1Text() {
  const h1 = document.querySelector('main h1, h1');
  return h1 ? clean(h1.textContent) : '';
}

/**
 * The LinkedIn document.title is one of:
 *   "(Number) Name | LinkedIn"
 *   "Name - Headline | LinkedIn"
 *   "Name | LinkedIn"
 * Strip the leading notification count and the trailing "| LinkedIn".
 */
function parseDocTitle() {
  let t = clean(document.title);
  t = t.replace(/^\(\d+\)\s*/, '');
  t = t.replace(/\s*[\|\-–—]\s*LinkedIn\s*$/i, '');
  return t;
}

function findHeadlineNode() {
  const candidates = [
    'main section .text-body-medium',
    'main .text-body-medium',
    'section[data-section="topcard"] .text-body-medium',
    'div.text-body-medium.break-words',
  ];
  for (const sel of candidates) {
    const el = document.querySelector(sel);
    const txt = el ? clean(el.textContent) : '';
    if (txt && txt.length < 250) return txt;
  }
  return '';
}

function findCurrentCompanyNode() {
  // Stable aria-label on the top card current-company button
  const btn = document.querySelector('[aria-label^="Current company"], [aria-label*="current company" i]');
  if (btn) {
    const span = btn.querySelector('span[aria-hidden="true"]') || btn;
    const txt = clean(span.textContent || '');
    if (txt) return txt;
  }
  // Fallback: any /company/ link inside main
  const aTags = document.querySelectorAll('main a[href*="/company/"]');
  for (const a of aTags) {
    const txt = clean(a.textContent || '');
    if (txt && txt.length < 80) return txt;
  }
  return '';
}

/**
 * Split a headline into title and company.
 *   "Managing Director at Ingenuity+"             → ("Managing Director", "Ingenuity+")
 *   "Managing Director at Ingenuity+ · London"    → ("Managing Director", "Ingenuity+")
 *   "Managing Director | Speaker | Author"        → ("Managing Director | Speaker | Author", "")
 *   "Director, Strategy"                          → ("Director, Strategy", "")
 *   "Founder & CEO @ Acme"                        → ("Founder & CEO", "Acme")
 */
function splitHeadline(headline) {
  if (!headline) return { title: '', company: '' };
  let m = headline.match(/^(.+?)\s+at\s+(.+)$/i);
  if (m) {
    return { title: clean(m[1]), company: clean(m[2].split('·')[0]) };
  }
  m = headline.match(/^(.+?)\s+@\s+(.+)$/);
  if (m) {
    return { title: clean(m[1]), company: clean(m[2].split('·')[0]) };
  }
  return { title: clean(headline.split('·')[0]), company: '' };
}

function nameFromMetaDesc(meta) {
  if (!meta) return '';
  const m = meta.match(/View ([^']+?)(?:'s)?\s+profile/i);
  return m ? clean(m[1]) : '';
}

function scrapeProfile() {
  const ogTitle = getMeta('meta[property="og:title"]');
  const docTitle = parseDocTitle();
  const h1 = getH1Text();
  const metaDesc = getMeta('meta[name="description"]');
  const nameFromDesc = nameFromMetaDesc(metaDesc);

  // NAME — prefer h1 (most reliable on rendered page); fall back to og:title, then doc title, then meta desc
  let name = h1 || ogTitle || nameFromDesc;
  if (!name && docTitle) {
    name = clean(docTitle.split(/\s+[\-|]\s+/)[0]);
  }

  // HEADLINE — DOM first, then og:description, then trailing part of doc title
  const ogDesc = getMeta('meta[property="og:description"]');
  let headline = findHeadlineNode() || ogDesc;
  if (!headline) {
    const parts = docTitle.split(/\s+[\-|]\s+/);
    if (parts.length > 1) headline = clean(parts.slice(1).join(' - '));
  }

  const { title, company: companyFromHeadline } = splitHeadline(headline);
  const company = findCurrentCompanyNode() || companyFromHeadline;

  const url = (window.location.origin + window.location.pathname).replace(/\/$/, '');

  return {
    name: clean(name),
    title: clean(title || headline),
    company: clean(company),
    headline: clean(headline),
    linkedin_url: url,
    _debug: { h1, ogTitle, docTitle, ogDesc, metaDesc: metaDesc.slice(0, 120) }
  };
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === 'scrapeProfile') {
    try {
      const data = scrapeProfile();
      sendResponse({ ok: true, data });
    } catch (err) {
      sendResponse({ ok: false, error: String(err) });
    }
    return true;
  }
});
