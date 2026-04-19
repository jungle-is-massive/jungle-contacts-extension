/**
 * Content script — runs on linkedin.com/in/* pages.
 * When the popup asks for profile data, scrape the page and send it back.
 *
 * LinkedIn's markup is volatile. We use multiple strategies per field and
 * return whatever we find.
 */

function textClean(s) {
  return (s || '').replace(/\s+/g, ' ').trim();
}

function firstText(selectors) {
  for (const sel of selectors) {
    const el = document.querySelector(sel);
    if (el && textClean(el.textContent)) return textClean(el.textContent);
  }
  return '';
}

function scrapeProfile() {
  // NAME — usually the only <h1> on the page
  const name = firstText([
    'h1.text-heading-xlarge',
    'main h1',
    'h1'
  ]);

  // HEADLINE — the line directly under the name, contains role + company
  // Example: "Managing Director at Ingenuity+ · London"
  const headline = firstText([
    'div.text-body-medium.break-words',
    'main section div[class*="text-body-medium"]',
    'main section .pv-text-details__left-panel div:nth-of-type(2)'
  ]);

  // Try to split "Role at Company" out of headline
  let title = headline;
  let company = '';
  if (headline && /\s+at\s+/i.test(headline)) {
    const [t, rest] = headline.split(/\s+at\s+/i);
    title = textClean(t);
    // Strip any location suffix after a bullet
    company = textClean(rest.split('·')[0]);
  }

  // CURRENT COMPANY fallback — look at the Experience section's first entry
  if (!company) {
    // The "top card" often shows current company as a separate line
    const topCardCompany = document.querySelector('button[aria-label*="Current company"] span[aria-hidden="true"]');
    if (topCardCompany) company = textClean(topCardCompany.textContent);
  }
  if (!company) {
    // Another fallback: first <li> under Experience section
    const expSection = [...document.querySelectorAll('section')].find(s => {
      const h = s.querySelector('h2, #experience, [id*="experience"]');
      return h && /experience/i.test(h.textContent || '');
    });
    if (expSection) {
      const firstExp = expSection.querySelector('li span[aria-hidden="true"]');
      if (firstExp) company = textClean(firstExp.textContent);
    }
  }

  // LOCATION
  const location = firstText([
    'main section .text-body-small.inline.t-black--light.break-words',
    'main section div.pv-text-details__left-panel span.text-body-small'
  ]);

  // LINKEDIN URL — use canonical location, stripping tracking params
  const url = (window.location.origin + window.location.pathname).replace(/\/$/, '');

  return {
    name,
    title: title || headline,
    company,
    headline,
    location,
    linkedin_url: url
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
    return true; // keep channel open (even for sync response — safer)
  }
});
