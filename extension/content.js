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

/**
 * Walk the DOM near the h1 to find the next significant text block.
 * This is class-agnostic — works regardless of LinkedIn's CSS churn.
 * The headline is almost always the next visible text after the name.
 */
function findHeadlineNearH1() {
  const h1 = document.querySelector('main h1, h1');
  if (!h1) return '';
  const nameText = clean(h1.textContent);

  // Walk up to the topcard container (h1's grandparent or great-grandparent)
  let container = h1.parentElement;
  for (let i = 0; i < 4 && container; i++) {
    container = container.parentElement;
    if (!container) break;
    // Look at all text-bearing children that come AFTER the h1
    const allText = [];
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, null);
    let foundH1 = false;
    let node;
    while (node = walker.nextNode()) {
      if (!foundH1) {
        // Check if this text node is inside the h1
        if (h1.contains(node)) { foundH1 = true; }
        continue;
      }
      const txt = clean(node.textContent);
      if (txt.length < 6 || txt.length > 300) continue;
      // Skip text identical or very similar to the name itself
      if (txt === nameText) continue;
      if (nameText && txt.toLowerCase() === nameText.toLowerCase()) continue;
      // Skip obvious non-headline noise
      if (/^(Connect|Message|More|Follow|Pending|About)$/i.test(txt)) continue;
      if (/^[\d,]+\+?\s*(connection|follower|mutual)/i.test(txt)) continue;
      if (/^(He\/Him|She\/Her|They\/Them)/i.test(txt)) continue;
      // Skip pure location strings (city, country with no role indicators)
      if (/^[A-Z][a-z]+(\s+[A-Z][a-z]+)*,\s+[A-Z][a-z]+/.test(txt) && !/\b(at|@|director|manager|head|chief|founder|consultant|lead|specialist|officer|engineer|designer|writer|editor|strategist|partner|owner|ceo|cto|cmo|cfo|coo|vp|svp|evp|svp|svp|md)\b/i.test(txt)) continue;
      allText.push(txt);
      if (allText.length >= 3) break;
    }
    // The first remaining candidate is the headline
    if (allText.length) return allText[0];
  }
  return '';
}

/**
 * Try to read LinkedIn's JSON-LD structured data — most stable signal possible.
 */
function readJsonLd() {
  const scripts = document.querySelectorAll('script[type="application/ld+json"]');
  for (const s of scripts) {
    try {
      const data = JSON.parse(s.textContent);
      const items = Array.isArray(data) ? data : (data['@graph'] || [data]);
      for (const item of items) {
        if (item['@type'] === 'Person' || item['@type']?.includes?.('Person')) {
          const name = clean(item.name || '');
          const jobTitle = clean(Array.isArray(item.jobTitle) ? item.jobTitle[0] : (item.jobTitle || ''));
          let company = '';
          if (item.worksFor) {
            const wf = Array.isArray(item.worksFor) ? item.worksFor[0] : item.worksFor;
            company = clean(typeof wf === 'string' ? wf : (wf?.name || ''));
          }
          return { name, jobTitle, company };
        }
      }
    } catch (_) { /* ignore parse errors */ }
  }
  return null;
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
  const jsonLd = readJsonLd();

  // NAME — JSON-LD wins, then h1, then meta tags
  let name = (jsonLd && jsonLd.name) || h1 || ogTitle || nameFromDesc;
  if (!name && docTitle) {
    name = clean(docTitle.split(/\s+[\-|]\s+/)[0]);
  }

  // HEADLINE — try in this order:
  //   1. JSON-LD jobTitle (already structured)
  //   2. DOM walk near h1 (class-agnostic)
  //   3. Old class-based selector (for older LinkedIn renders)
  //   4. og:description
  //   5. trailing part of doc title
  const ogDesc = getMeta('meta[property="og:description"]');
  let headline = '';
  let titleFromJsonLd = '';
  let companyFromJsonLd = '';
  if (jsonLd) {
    titleFromJsonLd = jsonLd.jobTitle || '';
    companyFromJsonLd = jsonLd.company || '';
    if (titleFromJsonLd && companyFromJsonLd) {
      headline = `${titleFromJsonLd} at ${companyFromJsonLd}`;
    } else if (titleFromJsonLd) {
      headline = titleFromJsonLd;
    }
  }
  if (!headline) headline = findHeadlineNearH1();
  if (!headline) headline = findHeadlineNode();
  if (!headline) headline = ogDesc;
  if (!headline) {
    const parts = docTitle.split(/\s+[\-|]\s+/);
    if (parts.length > 1) headline = clean(parts.slice(1).join(' - '));
  }

  // TITLE + COMPANY
  let title, company;
  if (titleFromJsonLd || companyFromJsonLd) {
    title = titleFromJsonLd;
    company = companyFromJsonLd || findCurrentCompanyNode();
  } else {
    const split = splitHeadline(headline);
    title = split.title;
    company = findCurrentCompanyNode() || split.company;
  }

  const url = (window.location.origin + window.location.pathname).replace(/\/$/, '');

  return {
    name: clean(name),
    title: clean(title || headline),
    company: clean(company),
    headline: clean(headline),
    linkedin_url: url,
    _debug: {
      h1, ogTitle, docTitle, ogDesc,
      metaDesc: metaDesc.slice(0, 160),
      jsonLd: jsonLd ? JSON.stringify(jsonLd) : null,
      headlineNear: findHeadlineNearH1().slice(0, 100),
      headlineByClass: findHeadlineNode().slice(0, 100),
      companyAria: findCurrentCompanyNode(),
    }
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
