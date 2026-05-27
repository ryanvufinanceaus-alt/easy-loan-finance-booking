function valueAt(object, path) {
  return path.split(".").reduce((current, part) => current?.[part], object);
}

function isMissing(value) {
  return value === undefined || value === null || value === "";
}

const requiredFields = [
  ["applicants.primary.firstName", "Primary applicant first name"],
  ["applicants.primary.lastName", "Primary applicant last name"],
  ["applicants.primary.dateOfBirth", "Primary applicant date of birth"],
  ["applicants.primary.email", "Primary applicant email"],
  ["applicants.primary.mobile", "Primary applicant mobile"],
  ["applicants.primary.address.line1", "Primary residential address"],
  ["applicants.primary.employment.status", "Primary employment status"],
  ["applicants.primary.income.baseAnnual", "Primary base income"],
  ["loan.applicationType", "Application type"],
  ["loan.loanAmount", "Loan amount"],
  ["loan.repaymentType", "Repayment type"],
  ["loan.loanTermYears", "Loan term"],
  ["property.address", "Security property address"],
  ["property.purchasePrice", "Purchase price"],
  ["expenses.livingMonthly", "Living expenses"]
];

export function validateInfinityPayload(payload) {
  const issues = [];

  for (const [path, label] of requiredFields) {
    if (isMissing(valueAt(payload, path))) {
      issues.push({
        severity: "error",
        code: "MISSING_REQUIRED_FIELD",
        path,
        message: `${label} is required before AOL autofill.`
      });
    }
  }

  const loanAmount = Number(valueAt(payload, "loan.loanAmount") || 0);
  const purchasePrice = Number(valueAt(payload, "property.purchasePrice") || 0);
  const deposit = Number(valueAt(payload, "loan.deposit") || 0);
  const lvr = Number(valueAt(payload, "loan.lvr") || 0);

  if (purchasePrice > 0 && loanAmount > purchasePrice) {
    issues.push({
      severity: "error",
      code: "LOAN_EXCEEDS_PURCHASE_PRICE",
      path: "loan.loanAmount",
      message: "Loan amount is higher than the purchase price."
    });
  }

  if (purchasePrice > 0 && loanAmount > 0) {
    const calculatedLvr = Number(((loanAmount / purchasePrice) * 100).toFixed(2));
    if (Math.abs(calculatedLvr - lvr) > 0.5) {
      issues.push({
        severity: "warning",
        code: "LVR_MISMATCH",
        path: "loan.lvr",
        message: `CRM LVR is ${lvr}%, calculated LVR is ${calculatedLvr}%.`
      });
    }
  }

  if (purchasePrice > 0 && deposit > 0 && Math.abs(purchasePrice - deposit - loanAmount) > 100) {
    issues.push({
      severity: "warning",
      code: "DEPOSIT_LOAN_TOTAL_MISMATCH",
      path: "loan.deposit",
      message: "Deposit plus loan amount does not match purchase price."
    });
  }

  if (lvr > 80) {
    issues.push({
      severity: "warning",
      code: "LMI_REVIEW_REQUIRED",
      path: "loan.lvr",
      message: "LVR is above 80%. Confirm LMI treatment before Push AOL."
    });
  }

  const pendingDocs = (payload.documentChecklist || []).filter((doc) => doc.status !== "received");
  if (pendingDocs.length > 0) {
    issues.push({
      severity: "warning",
      code: "PENDING_DOCUMENTS",
      path: "documentChecklist",
      message: `${pendingDocs.length} document(s) are still pending.`
    });
  }

  if (payload.documentIntake?.warnings?.length) {
    issues.push({
      severity: "warning",
      code: "DOCUMENT_EXTRACTION_NEEDS_REVIEW",
      path: "documentIntake",
      message: "Some uploaded documents need OCR/AI review before treating extracted values as final."
    });
  }

  return {
    okToAutofill: !issues.some((issue) => issue.severity === "error"),
    issues
  };
}
