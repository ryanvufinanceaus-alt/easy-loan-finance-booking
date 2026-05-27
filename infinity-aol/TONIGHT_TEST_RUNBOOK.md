# Tonight Test Runbook

Use this flow for the first editable Infinity/AOL case.

## Before opening lender pages

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

Use `Fill Section`, not full blind fill, for first test:

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
