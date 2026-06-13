# EasyFlow / Infinity / Booking System Handoff

Generated: 2026-06-13
Repo root: `D:\Finance\Codex Project\Projects\New project 2`
Current focus: Infinity CRM Client Details address modal no longer opens after recent autofill refactors.

## Short Diagnosis Before More Coding

The address failure is probably a workflow regression, not bad address data.

Evidence from git history:

- Older working-ish flow around commit `fc19baf` / `67c83c2`:
  - Fill client fields.
  - Open/fill address modal while still in the same client edit transaction.
  - Save once after fields + addresses.
  - Address edit finder was simple: `findSectionByHeading("Addresses")`, global geometry search, then `clickAtCenter(edit)`.
- Current flow after later fixes:
  - Fill client fields.
  - Verify critical fields.
  - Save fields first.
  - Re-activate/re-verify applicant.
  - Then try address modals.
  - Save again.
  - Address edit finder was replaced with `findAddressesSectionRoot()` + scoped candidate collection + DOM chain click.

Most likely breakpoints:

1. The "save fields before address" step causes Infinity/Angular to re-render the form. The visible Edit text remains, but the candidate element/scope can be stale or no longer bound to the expected Angular handler.
2. `findAddressesSectionRoot()` is stricter than the older `findSectionByHeading("Addresses")` logic and may choose the wrong root or miss valid Edit controls after page scroll/re-render.
3. Current transaction gates stop the applicant before the second save if any required address fails. This blocks later applicants and Financials.
4. The extension popup/status panel can visually cover the page; direct DOM events still should work, but coordinate clicking can be unreliable when the popup sits over the Edit area.

Recommendation before coding:

- Revert only the Client Details address sequence back to the older proven order:
  1. activate applicant
  2. fill non-address fields
  3. fill date fields immediately before address/save
  4. open/fill address modals in the same edit transaction
  5. click one final `Save Changes`
- Keep newer safeguards for gender/date/spouse/applicant switching, but remove the "save fields before address" split.
- Restore old `findEditButtonForAddress()` as primary, and keep the newer target-chain click only as fallback.
- Do not mark Client Details as failed merely because optional Previous Address is missing.
- Do not block all later tabs unless required fields for the active applicant truly failed after final save.

## System Map

### 1. Booking System

Purpose:
- Public and broker booking calendar.
- Root app mounted on Render to avoid multiple paid services.

Main files:
- `package.json`
- `server.mjs`
- `src/App.jsx`
- `README.md`
- `public/`
- `data/`

Important server links:
- `server.mjs` imports `./infinity-aol/server/index.mjs`.
- `server.mjs` mounts Infinity/EasyFlow routes under `/infinity-aol`.
- `server.mjs` also mounts `broker-desk`.

Key code pointers:
- `server.mjs`: root Express server, host routing, booking APIs, mounts `infinity-aol`.
- `src/App.jsx`: booking UI.

Hosting intention:
- Keep booking as the main Render service.
- Mount EasyFlow AI, Client Call, Loan Form, Loan Case Management, and Broker Desk under this one service where practical.

### 2. EasyFlow AI

Purpose:
- Broker-side assistant UI.
- Reviews case data, HEM, template, documents, and prepares payload for Chrome extension.

Main files:
- `infinity-aol/client/src/App.jsx`
- `infinity-aol/client/src/styles.css`
- `infinity-aol/server/index.mjs`
- `infinity-aol/server/lib/mapper.mjs`
- `infinity-aol/server/lib/infinityTemplate.mjs`
- `infinity-aol/server/lib/aolTemplate.mjs`
- `infinity-aol/server/lib/documentIntake.mjs`
- `infinity-aol/server/lib/caseTemplates.mjs`
- `infinity-aol/server/lib/validation.mjs`
- `infinity-aol/server/mappings/infinity-aol-v1.json`

Important APIs:
- `POST /api/cases/:caseId/prepare-infinity-aol`
- `GET /api/infinity/payload/:token`
- `GET /api/infinity/prepared-cases`
- `GET /api/infinity/mappings/current`
- `POST /api/infinity/autofill-log`
- `POST /api/cases/:caseId/comparison-snapshot`
- `GET /api/cases/:caseId/comparison-report`

Data stores:
- `infinity-aol/server/data/localCases.json`
- `infinity-aol/server/data/clientIntakes.json`
- `infinity-aol/server/data/callNotes.json`
- `infinity-aol/server/data/preparedPayloads.json`

### 3. Google Chrome Extension

Purpose:
- Reads prepared payload from EasyFlow AI.
- Autofills Infinity CRM and AOL.

Main files:
- `infinity-aol/extension/manifest.json`
- `infinity-aol/extension/popup.html`
- `infinity-aol/extension/popup.css`
- `infinity-aol/extension/popup.js`
- `infinity-aol/extension/contentScript.js`
- `infinity-aol/extension/mapping/infinity-aol-v1.json`

Current build id:
- `address-dom-chain-housing-fallback-v2.8`

Critical Client Details functions in `contentScript.js`:
- `runClientDetailsWorkflow(payload, mapping, apiBase, result)`
- `activateInfinityApplicantTab(applicant, result, rowIndex)`
- `freshVerifiedApplicantScope(applicant, result, rowIndex, phase)`
- `fillClientDetailsDirect(applicant, result, rowIndex, scope, payload, options)`
- `fillDeferredClientDetailsDateFields(applicant, result, rowIndex, scope)`
- `saveClientDetailsAndVerify(applicant, result, rowIndex, payload)`
- `fillApplicantAddresses(applicant, rawApplicant, result, rowIndex)`
- `fillAddressForApplicant(addressLabel, applicant, rawAddress, result, meta)`
- `clickAddressEdit(addressLabel, result, meta)`
- `findEditButtonForAddress(addressLabel)`
- `collectEditButtonsForAddress(addressLabel)`
- `findAddressesSectionRoot()`
- `fillAddressModal(parsed, modal, result, meta)`
- `saveModalAndVerifyClosed(result, description)`

Critical Financials functions in `contentScript.js`:
- `runFinancialsWorkflow(payload, mapping, apiBase, result)`
- `upsertExpenseRow(row, payload, result)`
- `selectExpenseTypeWithFallback(preferredType, modal, result, preparedCandidates)`
- `buildHemExpenseRows(total, payload)`
- `verifyFinancialsExpenseRows(rows, result)`

Critical Loans & Products functions in `contentScript.js`:
- `runLoansProductsWorkflow(payload, mapping, apiBase, result)`
- Needs Analysis sub-tab logic
- Later lender-selection step should stop before broker chooses 3 lenders.

Current problem area:
- `clickAddressEdit()` reports `Edit Address modal did not open`.
- UI visibly has `Edit` links.
- This started after Client Details workflow was refactored to save before address and stricter address candidate lookup was introduced.

### 4. Client Call

Purpose:
- Intake/call-note UI and quick inputs.
- Feeds case data into EasyFlow AI.

Main files:
- `infinity-aol/client/src/App.jsx`
- `infinity-aol/server/index.mjs`
- `infinity-aol/server/data/clientIntakes.json`
- `infinity-aol/server/data/callNotes.json`

Routes/host behavior:
- `client-call.easyloanfinance.com.au`
- `/client-call`
- `/call-notes`
- In `server.mjs`, `CLIENT_CALL_HOST_RE` routes client-call host to Infinity/EasyFlow app.

Important source fields:
- Applicant names
- DOB
- Gender
- Address
- Current residential status
- Income
- HEM / living expense assumptions

### 5. CRM Broker Desk

Purpose:
- Broker-only internal dashboard.
- User says this was originally Claude-owned; only export index/context here.

Main files:
- `broker-desk/index.js`
- `broker-desk/public/index.html`
- `broker-desk/package.json`
- `server.mjs` mounts it via `require("./broker-desk")`.

Do not deeply refactor without a separate decision.

### 6. Loan Case Management

Purpose:
- Canonical broker case hub.
- Opens/reviews submissions, edits case data, exports/prepares EasyFlow AI payloads.

Main files:
- `infinity-aol/client/src/App.jsx`
- `infinity-aol/server/index.mjs`
- `infinity-aol/server/data/localCases.json`

Important route/host:
- `loan-submissions-management.easyloanfinance.com.au`
- `server.mjs` contains `LOAN_SUBMISSIONS_HOST_RE`.

Important functions:
- `buildNormalisedPayload(submission, validationStatus)` in `infinity-aol/server/index.mjs`
- `buildInfinityPayload(caseData)` in `infinity-aol/server/lib/mapper.mjs`
- `buildInfinityTemplate(caseData)` in `infinity-aol/server/lib/infinityTemplate.mjs`
- `buildAolTemplate(caseData, infinity)` in `infinity-aol/server/lib/aolTemplate.mjs`

Housing data rule:
- Primary `currentResidentialStatus` should come from Loan Form.
- Secondary should use `secondApplicantCurrentResidentialStatus` if present.
- If secondary housing is blank, fallback to primary housing.
- Do not fallback to template/clientProfile `Own Home` before applicant or primary data.

### 7. Loan Form For Customer

Purpose:
- Customer-facing form.
- Feeds normalized submission into case data.

Main files:
- `infinity-aol/client/src/App.jsx`
- `infinity-aol/server/index.mjs`

Important form fields in `App.jsx`:
- Primary:
  - `dateOfBirth`
  - `gender`
  - `address`
  - `currentResidentialStatus`
  - `previousAddress`
  - `postSettlementAddress`
  - `mailingAddress`
  - `driversLicenceNo`
  - `licenceExpiryDate`
  - `licenceState`
  - `licenceClass`
- Secondary:
  - `secondApplicantDateOfBirth`
  - `secondApplicantGender`
  - `secondApplicantAddress`
  - `secondApplicantCurrentResidentialStatus`
  - `secondApplicantPreviousAddress`
  - `secondApplicantDriversLicenceNo`
  - `secondApplicantLicenceExpiryDate`
  - `secondApplicantLicenceState`
  - `secondApplicantLicenceClass`

Important normalization in `server/index.mjs`:
- `buildNormalisedPayload()` maps submission fields into `applicants[]`.
- Primary address:
  - `address.current`
  - `address.suburb`
  - `address.state`
  - `address.postcode`
  - `address.residentialStatus`
  - `address.previous`
  - `address.postSettlement`
  - `address.mailing`
- Secondary address:
  - falls back to primary address if secondary blank.
  - should also fallback secondary residential status to primary when blank.

## Data Flow

```text
Customer Loan Form / Client Call
  -> infinity-aol/server/index.mjs
  -> buildNormalisedPayload()
  -> localCases/clientIntakes/callNotes
  -> EasyFlow AI prepare button
  -> buildInfinityPayload()
  -> buildInfinityTemplate() + buildAolTemplate()
  -> preparedPayloads.json + token
  -> Chrome extension popup loads token
  -> contentScript.js run workflows
  -> Infinity CRM / AOL web forms
```

## Address Autofill Expected Logic

For each applicant:

1. Activate applicant tab by name.
2. Verify active tab by green underline/form name, not the X delete icon.
3. Fill basic fields:
   - title
   - first/middle/surname
   - marital status
   - related spouse
   - DOB
   - gender
   - housing
   - permanent in Australia
   - licence no/expiry/state/class
4. For each required address:
   - scroll to Addresses section
   - find exact row label
   - click that row's `Edit`
   - wait for `Edit Address` modal
   - parse Australian address:
     - `Unit 1, 79 Crebert St, Mayfield NSW 2304`
     - unit = `1`
     - street number = `79`
     - street name = `Crebert`
     - street type = `Street`
     - suburb = `Mayfield`
     - state = `NSW`
     - postcode = `2304`
     - country = `Australia`
   - save modal
   - verify row no longer says `Please Start Typing Address`
5. Click bottom `Save Changes` once.
6. Wait for green saved toast or stable save completion.
7. Only then move to next applicant or next tab.

## Proposed Fix For Approval

Do not rewrite everything. Make a small rollback-style fix:

1. Restore old address button finder as `findEditButtonForAddressLegacy()`.
2. Make `clickAddressEdit()` use legacy finder first:
   - `findSectionByHeading("Addresses") || document`
   - global candidate scan
   - `clickAtCenter(edit)`
   - wait up to 8 seconds
3. Keep current DOM-chain click only if legacy fails.
4. Move address fill back before first/only final save in `runClientDetailsWorkflow()`.
5. Remove the split:
   - no `save fields before address`
   - no `save applicant after address`
6. Refill DOB and licence expiry immediately before final save to avoid Angular datepicker clearing them.
7. Final save should scroll to bottom and click `Save Changes`.
8. Treat Current/Post Settlement/Mailing Address as required; Previous Address optional.
9. If Current Address edit cannot open, stop Client Details and report exact candidate list.

## Deployment / Backup Notes

Current Render-saving plan:
- Keep one primary Render service for booking root.
- Mount EasyFlow AI under `/infinity-aol`.
- Host-based routing in `server.mjs` handles:
  - booking
  - client-call
  - loan-submissions-management
  - broker-desk

Backup command idea from repo parent:

```powershell
Compress-Archive -Path "D:\Finance\Codex Project\Projects\New project 2\*" -DestinationPath "D:\Finance\Codex Project\Projects\easyflow-full-backup-2026-06-13.zip" -Force
```

Do not include secrets publicly:
- `easy-loan-finance-booking.env`
- any real SMTP/Supabase/API credentials

## Current Unrelated Dirty Files

These existed before this handoff and should not be committed unless intentionally reviewed:

- `package-lock.json`
- `2.png`
- `easy-loan-finance-booking.env`

