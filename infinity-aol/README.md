# Infinity AOL AutoFill Assistant

This project adds a broker-controlled bridge between a Broker CRM case and Infinity/AOL submission.

Architecture:

`CRM database -> Case Data API -> Validation Engine -> Infinity Mapping Layer -> Chrome Extension AutoFill -> Broker Review -> Push AOL`

What is implemented:

- CRM case view with `Prepare Infinity AOL`.
- Case API pulling applicants, contact details, employment, income, expenses, assets, liabilities, property, loan structure, broker notes, and document checklist.
- Infinity-compatible JSON payload.
- Web document intake for income, ID, bank statements, contracts, and broker presets.
- Smart text-file extraction for email, mobile, DOB, licence number, ABN, address-like lines, income, savings/assets, and mortgage balances with confidence/source tracking.
- Template defaults for HEM monthly assumptions and financial-asset buffers.
- Editable autofill templates for common scenarios such as single investor pre-approval, couple owner-occupied purchase, and refinance/cash-out.
- Section text templates for the Infinity/AOL narrative fields shown in the screenshots, including Loan Objective, Circumstances/Objectives/Priorities, Financial Awareness, Lender, Loan Amount, Interest Rate, Loan Structure, Goals/Objectives, Loan Features, and Commissions/Conflict.
- Case-aware text rendering with placeholders such as `{Client}`, `{subject}`, `{possessive}`, `{lender}`, `{loanTerm}`, `{repayment}`, and `{loanAmount}`.
- Case fill history so a broker can reopen prior prepared payloads and autofill events for the selected case.
- Validation for missing required fields and inconsistent loan/property numbers.
- Versioned Infinity mapping layer.
- Chrome Extension that reads a prepared payload from the CRM API and fills matching fields section by section.
- Screenshot-derived Infinity template mapping for Client Details, Financials, Needs Analysis, Loans/Securities/Commentary, Preferred Loan Features, Recommendation, and Commissions.
- Single-applicant versus couple-aware narrative generation for broker notes and AOL text areas.
- Extension `Check Page` mode to compare visible Infinity/AOL fields against the prepared payload after fill or after Push AOL.
- ApplyOnline/AOL mapping from the provided screenshots for Application, Applicants, Loans, Securities, Financials, Summary, Compliance, and Documents.
- `One-Click Intake + Payload` in the CRM UI: upload files, apply presets, and prepare the Infinity/AOL token in one action.
- Audit logging for prepare and autofill actions.
- Safety guardrails: no password storage, no MFA bypass, no auto-submit.
- PWA install support so the CRM/intake app can be installed from Chrome on Windows or macOS.
- Extension API base can point to local `127.0.0.1` or an existing Render service.

## No extra hosting cost mode

Do not create a second paid Render service. Mount this assistant inside the existing broker booking Render service and expose it as another app route, for example `/infinity-aol`, with the API routes on the same service.

See [NO_EXTRA_COST_DEPLOYMENT.md](./NO_EXTRA_COST_DEPLOYMENT.md) for the exact setup.

The autofill itself still runs locally in the broker's already-open Chrome tab. It uses DOM events inside Chrome, so it does not move the mouse, type through the operating system, store passwords, bypass MFA, or submit without broker confirmation.

## Run locally

```powershell
npm install
npm run dev
```

Open the CRM UI at:

```text
http://127.0.0.1:5173
```

API runs at:

```text
http://127.0.0.1:8797
```

## Chrome Extension

1. Open Chrome Extensions.
2. Enable Developer mode.
3. Click Load unpacked.
4. Select the `extension` folder.
5. If using Render, set the extension API base to the existing Render URL. If using local mode, keep `http://127.0.0.1:8797`.
6. In the CRM, open a case and click `Prepare Infinity AOL`.
7. Optional: upload client documents and choose HEM/financial-asset presets before preparing AOL.
8. Or click `One-Click Intake + Payload` to upload documents and generate the payload token in one step.
9. Copy the case ID or generated payload token into the extension popup.
10. Open Infinity/AOL, stay logged in normally, then click `Fill Section` or `Fill Visible`.
11. Click `Check Page` to compare the visible Infinity/AOL page against the prepared payload.
12. Review the fields in Infinity, then the broker manually clicks `Push AOL`.
13. After AOL opens or updates, click `Check Page` again on the AOL page to catch mismatches.

The extension does not use the mouse or keyboard. It sets page fields through the browser DOM and dispatches normal input/change events. Some lender pages with custom widgets, shadow DOM, or cross-origin iframes may require extra selectors in `server/mappings/infinity-aol-v1.json`.

Current document extraction is intentionally conservative. Text-like files can be parsed with local rules, while scanned PDFs/images are accepted and flagged for OCR/AI review. In production, connect an OCR or document-AI provider before trusting scan-only IDs and payslips as final extracted data.

## Templates

Templates live in the app UI under Document Intake. A broker can choose a scenario, edit the JSON, and either:

- use the edited JSON for the next prepare only, or
- click `Save Template` to store the edited template locally.

Template fields can control default HEM, financial asset buffer, expense categories, current housing situation, loan purpose, repayment type, product preference, loan term, requested features, required documents, and common narrative text used in Infinity/AOL fields.

Click `Preview Case Text` to render the selected template against the currently selected CRM case before preparing the payload. This lets the broker adjust the wording for single applicants, couples, lender choice, loan term, and loan objective before autofill.

## History

Each prepare, intake, and autofill action is kept in `Case Fill History` for the selected case. Prepared payloads are also archived locally under `server/data/preparedPayloads.json` so a broker can reopen a recent token after a server restart in local mode.

For a shared Render deployment, use the same database as the broker booking app for production-grade history instead of relying on local JSON files.

## First Real Case Test

Use [TONIGHT_TEST_RUNBOOK.md](./TONIGHT_TEST_RUNBOOK.md) for the first editable case. It lists the fill order, default tick logic, 30-year default rule, and the fix loop if a visible Infinity/AOL label does not fill.
