# No Extra Cost Deployment

Goal: run Infinity AOL AutoFill Assistant without buying another Render service.

## Recommended setup

Use the existing paid Render service that already runs the broker booking app, and mount this assistant as another route on the same web service:

```text
Existing Render broker service
  /book
  /dashboard
  /api/bookings
  /infinity-aol
  /api/infinity/*
  /api/cases/*
```

This avoids another monthly Render bill. The Chrome Extension can point to either:

```text
https://your-existing-broker-service.onrender.com
```

or a custom domain already attached to that same service.

## What stays local

Autofill should stay inside the broker's Chrome browser:

- Infinity/AOL tab is opened and logged in by the broker.
- Extension reads the prepared payload from the API.
- Extension writes values directly into page fields through the browser DOM.
- No OS mouse movement.
- No OS keyboard typing.
- No broker password storage.
- No MFA bypass.
- No automatic submission.

## Windows and Mac laptop use

Use this as a PWA plus Chrome Extension:

1. Open the assistant URL in Chrome.
2. Click Chrome menu > Save and share > Install page as app.
3. Load the Chrome Extension from the `extension` folder.
4. In the extension popup, set API base to the same URL as the installed app.

This gives a desktop-app feel on Windows and macOS without Electron packaging, code signing, or another hosting bill.

## When local-only is better

If customer documents should not touch Render yet, run the app locally:

```powershell
npm install
npm run build
npm run start
```

Then use this API base in the extension:

```text
http://127.0.0.1:8797
```

The same extension works with local or Render by changing the API base.

## Why web is not the slow part

The slow part is usually OCR/document extraction and lender page rendering, not the app shell. The actual autofill runs locally in Chrome against the already-open Infinity/AOL page, so it does not need to move the mouse or wait for remote desktop actions.

## Production note

The current file intake parses text-like documents locally and flags scanned PDFs/images for OCR review. Before trusting scanned IDs, payslips, and bank statements as final extracted data, connect a document-AI/OCR provider or a local OCR pipeline.
