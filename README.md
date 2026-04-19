# Jungle Contacts Extension

Chrome extension that saves LinkedIn contacts straight to the [Jungle Intermediary Plan](https://jungle-is-massive.github.io/intermediary-plan/) People Map.

## Quick install

1. Download the latest zip: [`jungle-intermediary-contacts.zip`](./jungle-intermediary-contacts.zip) (click → Download raw file)
2. Unzip somewhere permanent
3. Open `chrome://extensions` in Chrome, turn on **Developer mode** (top right), click **Load unpacked**, select the unzipped folder
4. Pin the Jungle icon to your toolbar
5. Visit any `linkedin.com/in/…` profile, click the Jungle icon, fill + save

Full install instructions and usage: [`extension/README.md`](./extension/README.md)

## What it does

- Scrapes the LinkedIn profile you're currently viewing
- Auto-matches their company against Jungle's intermediary list (AAR, Ingenuity+, etc.)
- POSTs the contact to Supabase (`intermediary_people` table)
- Contact appears on the intermediary plan's People Map on next refresh

## Stack

- Manifest V3
- Vanilla JS, no build step
- Same Supabase backend as the intermediary-plan page — single source of truth

## Development

Edit the files in `extension/` and reload the extension in `chrome://extensions` to test.

The `jungle-intermediary-contacts.zip` at the repo root is the distributable — regenerate it after changes with:

```bash
cd extension
zip -j ../jungle-intermediary-contacts.zip *
```
