# Jungle Intermediary Contacts — Chrome extension

Save LinkedIn contacts straight to the [Jungle Intermediary Plan](https://jungle-is-massive.github.io/intermediary-plan/).

---

## Install (one-time, ~60 seconds)

Chrome doesn't let unpacked extensions auto-install, so this is a manual load. Takes about a minute.

1. Download the extension folder to your laptop:
   - From GitHub: go to the `extension/` folder, click the green **Code** button → **Download ZIP**
   - Unzip it somewhere stable (e.g. `~/Documents/jungle-extension/`)
2. Open Chrome and go to `chrome://extensions` in the address bar
3. Toggle **Developer mode** on (top-right)
4. Click **Load unpacked** (top-left)
5. Select the `extension/` folder you unzipped
6. The Jungle icon now lives in your Chrome toolbar. Pin it for one-click access: click the puzzle-piece icon → pin **Jungle Intermediary Contacts**

---

## How to use

1. Open any LinkedIn profile (`linkedin.com/in/…`)
2. Click the Jungle extension icon in your toolbar
3. The popup pre-fills:
   - **Name** (from the profile H1)
   - **Title** (from the headline)
   - **LinkedIn URL**
   - **Intermediary** — auto-matched if the current company name contains a known intermediary (e.g. "Ingenuity+", "AAR"). Otherwise, pick from the dropdown
4. Fill in warmth, influence, role, and notes
5. Click **Save contact**
6. The record lands in Supabase and appears on the intermediary plan's People Map next time you refresh it

---

## Troubleshooting

**"Open a LinkedIn profile"** — the popup needs an active tab that matches `linkedin.com/in/*`. Navigate to a profile first, then click the icon again.

**Name/title didn't pre-fill** — LinkedIn occasionally ships new DOM. The popup still works, just type the fields manually. If this happens often, raise it and the scraper can be updated.

**Save failed** — check you can reach Supabase (`https://iehkvlyjumkzccoqqgxl.supabase.co`). If the org dropdown option doesn't exist in the intermediary plan, the record still saves but won't appear under an org section on the page.

---

## Adding a new intermediary

If the Jungle team onboards a new intermediary (say "Flock Associates"), it needs to be added in **two** places:

1. The `INTERMEDIARIES` array at the top of `intermediary-plan/index.html` (the page)
2. The `INTERMEDIARIES` array at the top of `extension/popup.js` (this extension)

Use the same `id` (lowercase, no spaces) in both places.
