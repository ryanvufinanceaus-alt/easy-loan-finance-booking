# Tomorrow Test Runbook

Use this flow for the first editable Infinity/AOL case.

## What Ryan needs before testing

- Chrome logged in to Infinity and AOL manually. Do not automate passwords or MFA.
- Chrome extension loaded from `C:\Users\User\OneDrive\Documents\New project 2\infinity-aol\extension`.
- Extension API set to `https://loanops.easyloanfinance.com.au` after the new domain is verified. Until then use `https://booking.easyloanfinance.com.au/infinity-aol`.
- One editable test case in Infinity/AOL.
- Optional customer files: driver licence front/back, income, accountant letter, bank statement.

Custom domain is useful later, but it is not required for the first test. The client form already has a meaningful link:

```text
https://loan-form.easyloanfinance.com.au/loan-form/<token>
```

Fallback path if the custom domain is not live yet:

```text
https://booking.easyloanfinance.com.au/infinity-aol/loan-form/<token>
```

Add separate custom domains to the same paid Render service. This keeps one Render bill while making each workflow clean:

```text
booking.easyloanfinance.com.au      Booking System
client-call.easyloanfinance.com.au  Simple staff/call-centre quick notes
loan-form.easyloanfinance.com.au    Public client Loan Form only
loanops.easyloanfinance.com.au      LoanOps AI for Infinity/AOL preparation
```

Use `client-call.easyloanfinance.com.au` for quick phone intake, `loan-form.easyloanfinance.com.au` for client submissions, and `loanops.easyloanfinance.com.au` for broker review, payload preparation, Infinity/AOL autofill, comparison, and backup. All domains point to the same Render service and share the same backend data.

## Storage without Render Persistent Disk

Do not add Render Persistent Disk for this module. Use the existing Supabase project instead, so Client Call, Loan Form submissions, prepared payloads, comparison snapshots, and history survive Render deploys/restarts without another Render disk.

Create this table once in Supabase SQL Editor:

```sql
create table if not exists public.app_kv (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);
```

Render environment needs:

```text
SUPABASE_URL=<existing booking Supabase URL>
SUPABASE_SERVICE_ROLE_KEY=<existing service role key>
LOAN_FORM_BASE_URL=https://loan-form.easyloanfinance.com.au
```

Optional:

```text
INFINITY_AOL_STORE_PREFIX=infinity_aol
```

If Supabase is not configured, local JSON files are used only as a fallback.

Manual admin backup downloads:

```text
https://loanops.easyloanfinance.com.au/api/backup
```

Backup requires broker/admin access. Keep a downloaded JSON backup weekly or before large changes. If the new LoanOps AI domain is not ready yet, use `https://booking.easyloanfinance.com.au/infinity-aol/api/backup`.

## Local fallback

1. Start the assistant:

```powershell
npm run build
npm run start
```

2. Open:

```text
http://127.0.0.1:8797/
```

3. Select the CRM case.
4. Select the closest template.
5. Click `Preview Case Text`.
6. Check the text for:
   - Loan Objective Explanation
   - Circumstances, Objectives and Priorities
   - Financial Awareness and Practices
   - Lender
   - Loan Amount
   - Interest Rate
   - Loan Structure
   - Goals and Objectives
   - Loan Features
   - Commissions and Conflict

7. If needed, edit the template JSON.
8. Click `Prepare Infinity AOL`.
9. Copy the token into the Chrome Extension.

## Live flow

1. Open `https://booking.easyloanfinance.com.au/infinity-aol` tonight.
2. Search/select a case by applicant name, second applicant name, case ID, or address.
3. Check the left info panel: loan amount, income, HEM, financial asset, files queued, fields found, warnings.
4. If starting from a phone call, open `Client Call`, save it, then copy the `Loan Form` link.
5. If using files, drag/drop documents and click `Prepare Files for Extension`.
6. Select/edit the closest template and preview the generated wording.
7. Click `Prepare for Extension`.
8. Copy the Case ID or token into the Chrome Extension.
9. Open the editable Infinity case tab and click `Start AutoFill`.
10. Review Infinity. Broker manually clicks `Push AOL`.
11. Open AOL and click `Start AutoFill` again.
12. Click `Compare Current Page` or `Compare Case` to see mismatches.
13. Broker reviews and manually submits only when satisfied.

## Recommended production domains

- Client Call quick intake: `https://client-call.easyloanfinance.com.au`
- LoanOps AI broker workspace: `https://loanops.easyloanfinance.com.au`
- Public booking link: `https://booking.easyloanfinance.com.au/book`
- Public loan form link: `https://loan-form.easyloanfinance.com.au/loan-form/<token>`
- Current fallback while DNS is being moved: `https://booking.easyloanfinance.com.au`

`app.easyloanfinance.com.au` is less clear than workflow-specific domains. Retire or redirect `app` after `client-call`, `loan-form`, and `loanops` are verified.

## Default tick logic

Most loans default to 30 years. If the CRM case already has a specific term, the case value wins. Example: the sample LIEN case remains 40 years because that screenshot case has 40 years in CRM data.

### Needs Analysis / Infinity

Enabled when appropriate:

- Purchase Investment Property or Purchase Owner Occupied Dwelling
- Offset, only if requested
- Redraw, default yes unless the case says no
- Variable Rate, default yes unless fixed-only case
- P & I Repayments, when repayment type is Principal and Interest
- Monthly Repayments, default yes unless weekly or fortnightly is selected
- Extra Repayments, default yes

Disabled unless case says otherwise:

- Bridging
- Construction / Renovation
- Debt Consolidation
- Vacant Land
- Reverse Mortgage
- Other Purpose
- Rate Lock
- Line of Credit
- Non-conforming Loan
- No Early Repayment Penalty
- Interest Only
- Balloon Repayments
- Weekly / Fortnightly repayments

### AOL Compliance

Default for standard variable P&I:

- Anticipated changes: No
- Refinance/debt consolidation: Not applicable unless refinance case
- Rate type: Variable
- Variable rate importance: Important
- Variable rate flexibility reason: ticked
- Principal and interest: Important
- P&I reasons: minimise interest and build equity ticked
- Interest only: Not important
- Offset: Important if requested
- Offset access/reduce interest reasons: ticked if offset requested
- Redraw: Important unless case says no
- Redraw flexibility reason: ticked
- Other requirements: No
- Conflicts: No
- Product selection: generated from the Loan Features template text

## Fill sequence

Use `Start AutoFill` for the normal test. Use Advanced `Fill Current Popup` only if one popup needs a retry:

1. Infinity Client Details
2. Infinity Financials
3. Infinity Needs Analysis
4. Infinity Loans, Securities and Commentary
5. Infinity Preferred Loan Features
6. Infinity Recommendation
7. Infinity Commissions / Conflict
8. Review manually in Infinity
9. Broker clicks Push AOL
10. AOL Application
11. AOL Applicants
12. AOL Loans
13. AOL Securities
14. AOL Financials
15. AOL Compliance
16. AOL Summary / Documents
17. Click `Check Page` on AOL.

## If something does not fill

Do not retry the whole page immediately.

1. Stay on that section.
2. Click `Check Page`.
3. Note which fields are missing/skipped.
4. Add the exact visible label text to `server/mappings/infinity-aol-v1.json`.
5. Rebuild and restart.
6. Reload extension.
7. Retry that section only.

The extension does not submit. The final submit/push must remain a broker click after review.
