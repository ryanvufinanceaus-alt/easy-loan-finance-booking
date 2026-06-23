import { classifyLoanPurpose } from "./loanPurpose.mjs";

const money = (value) => Number(value || 0);

function fullName(applicant) {
  return [applicant?.firstName, applicant?.middleName, applicant?.lastName].filter(Boolean).join(" ").trim();
}

function formatAddress(address) {
  if (!address) return "";
  const TAIL = /,?\s*([A-Za-z' -]+?)\s+(NSW|VIC|QLD|SA|WA|TAS|ACT|NT)\s+(\d{4})(?:,\s*Australia)?\s*$/i;
  let line1 = address.line1 || "";
  let suburb = address.suburb || "", state = address.state || "", postcode = address.postcode || "";
  // Don't let a stale postcode inside fullAddress leak in — structured suburb/state/postcode win.
  if ((!line1 || !postcode) && address.fullAddress) {
    const full = String(address.fullAddress).replace(/,\s*Australia\s*$/i, "");
    const m = full.match(TAIL);
    if (m) {
      if (!line1) line1 = full.slice(0, m.index).replace(/,\s*$/, "").trim();
      suburb = suburb || m[1].trim(); state = state || m[2]; postcode = postcode || m[3];
    } else if (!line1) { line1 = full; }
  }
  return [line1, suburb, state, postcode].filter(Boolean).join(" ");
}

function firstPrimary(caseData) {
  return caseData.applicants.find((applicant) => applicant.role === "primary") || caseData.applicants[0] || {};
}

function firstPresent(...values) {
  return values.find((value) => value !== undefined && value !== null && String(value).trim() !== "");
}

// Normalise any date-ish value to ISO yyyy-mm-dd so the extension can parse it (new Date) + drive the
// AOL calendar (navigate month + click day). Handles ISO, dd/mm/yyyy, and JS-parseable timestamps.
const ADELAIDE_YMD = (d) => new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Adelaide", year: "numeric", month: "2-digit", day: "2-digit" }).format(d); // "YYYY-MM-DD"
function toIsoDate(value) {
  if (!value) return "";
  const au = String(value).match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (au) return `${au[3]}-${au[2].padStart(2, "0")}-${au[1].padStart(2, "0")}`;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  // Anchor to Adelaide (broker timezone) so a UTC timestamp near midnight doesn't shift the calendar day.
  return ADELAIDE_YMD(date);
}

// The interview/case date — SAME source chain Infinity uses (infinityTemplate dateInterviewConducted),
// so Infinity ↔ AOL always match: explicit interview date → loan-form submission timestamp → today.
function interviewIsoDate(caseData) {
  const fallback = ADELAIDE_YMD(new Date()); // today in Adelaide, not UTC server time
  return toIsoDate(firstPresent(
    caseData.factFind?.dateInterviewConducted,
    caseData.loan?.dateInterviewConducted,
    caseData.interviewDate,
    caseData.createdAt,
    caseData.intake?.submittedAt,
    caseData.intake?.createdAt
  )) || fallback;
}

function housingSituation(applicant, caseData) {
  return applicant?.currentHousingSituation ||
    applicant?.currentResidentialStatus ||
    applicant?.address?.residentialStatus ||
    applicant?.address?.currentResidentialStatus ||
    caseData.clientProfile?.currentHousingSituation ||
    "";
}

function loanPurpose(caseData) {
  switch (classifyLoanPurpose(caseData)) { // shared classifier: occupancy-first, never opportunityName
    case "refinance": return "Refinance";
    case "investment": return "Investment";
    case "vacant-land": return "Owner occupied"; // AOL has no vacant-land label; treat as owner occupied
    default: return "Owner occupied";
  }
}

export function buildAolTemplate(caseData, infinity) {
  const primary = firstPrimary(caseData);
  const primaryName = fullName(primary);
  const interviewDate = interviewIsoDate(caseData); // ISO yyyy-mm-dd; SAME as Infinity → dates match
  const propertyAddress = caseData.property?.aolAddress || caseData.property?.address || "";
  const deposit = money(caseData.loan?.deposit);
  const savings = Math.max(0, deposit - money(caseData.serviceability?.financialAssetBuffer));
  const selectedLender = caseData.loan?.lender || infinity?.recommendation?.selectedLender || "[LENDER]";
  const isVariable = /variable/i.test(caseData.loan?.productPreference || "") || !/fixed/i.test(caseData.loan?.productPreference || "");
  const isPrincipalInterest = /principal|p\s*&\s*i/i.test(caseData.loan?.repaymentType || "");
  const hasOffset = Boolean(caseData.loan?.offsetRequested);
  const hasRedraw = Boolean(caseData.loan?.redrawRequested ?? true);

  return {
    application: {
      lenderLoanType: caseData.loan?.lenderLoanType || "Alt Doc",
      applyOnlineId: caseData.loan?.applyOnlineId || "",
      lenderId: caseData.loan?.lenderId || "",
      applicants: primaryName,
      totalLoanAmount: money(caseData.loan?.loanAmount),
      securities: propertyAddress,
      brokerNumber: caseData.broker?.number || "070003189",
      companyName: caseData.broker?.companyName || "Beagle Finance Pty Ltd T/A Loankit",
      companyAbn: caseData.broker?.companyAbn || "54 656 734 271",
      brokerFirstName: caseData.broker?.firstName || "Viet Anh",
      brokerLastName: caseData.broker?.lastName || "Vu",
      brokerMobile: caseData.broker?.mobile || "0421367899",
      brokerEmail: caseData.broker?.email || "ryan@easyloanfinance.com.au",
      brokerAddress: caseData.broker?.address || "481 Torrens ROAD Woodville SA 5011",
      legalRepresentation: "Yes",
      loanDocumentsRecipient: primaryName,
      creditImpairment: "",
      originatorComments:
        caseData.loan?.originatorComments ||
        `${primaryName || "Client"} is looking for a pre-approval to purchase ${classifyLoanPurpose(caseData) === "investment" ? "an investment" : "an owner-occupied"} property. Please assess together with the prepared Infinity notes.`
    },
    applicants: {
      applicantType: "Person",
      applicantRole: "Primary applicant",
      title: primary.title || "Ms",
      firstName: primary.firstName || "",
      middleName: primary.middleName || "",
      familyName: primary.lastName || "",
      dateOfBirth: primary.dateOfBirth || "",
      gender: primary.gender || "",
      maritalStatus: primary.maritalStatus || "",
      hasDependants: primary.dependants > 0 ? "Yes" : "No",
      permanentResident: primary.permanentInAustralia || (primary.residencyStatus ? "Yes" : ""),
      residencyStatus: /citizen/i.test(primary.residencyStatus || "") ? "Citizen" : primary.residencyStatus || "",
      firstHomeBuyer: "No",
      employeeOfLender: "No",
      customerOfLender: "No",
      mobilePhone: primary.mobile || "",
      email: primary.email || "",
      currentResidentialAddress: formatAddress(primary.address),
      currentHousingSituation: housingSituation(primary, caseData),
      addressSince: caseData.clientProfile?.addressSince || "",
      employmentName: primary.employment?.employerName || "",
      employmentStatus: primary.employment?.status || "",
      occupation: primary.employment?.occupation || "",
      incomeYearOne: money(primary.income?.baseAnnual),
      incomeYearTwo: money(primary.income?.baseAnnual)
    },
    loans: {
      cashDeposit: deposit,
      savingsContribution: savings,
      totalContribution: deposit + savings,
      primaryPurpose: loanPurpose(caseData),
      absPurpose: "129 - Purchase of established dwelling - House by first mortgage in purchasing existing real estate",
      estimatedSettlementDate: caseData.loan?.estimatedSettlementDate || "",
      baseAmount: money(caseData.loan?.loanAmount),
      productSelector: `${selectedLender} Essential Alt Doc`,
      debitCard: false,
      offsetSubAccount: hasOffset,
      redraw: hasRedraw,
      interestRatePa: Number(String(caseData.loan?.interestRate ?? "").replace(/[^0-9.]/g, "")) || 0,
      totalLoanTerm: `${caseData.loan?.loanTermYears || 30} Yrs`,
      repaymentType: caseData.loan?.repaymentType || "Principal & Interest",
      repaymentFrequency: "Monthly",
      repaymentMethod: "Direct Debit Existing Account",
      nominatedBorrowers: "All applicants (Auto-allocation)"
    },
    securities: {
      name: propertyAddress,
      type: "Registered Mortgage",
      transactionType: "Purchasing",
      isPrimarySecurity: "Yes",
      ownership: "All applicants (Auto-allocation)",
      isPreApproval: caseData.loan?.preApproval ? "Yes" : "No",
      address: propertyAddress,
      status: "Established",
      propertyPrimaryPurpose: loanPurpose(caseData),
      zoning: "Residential",
      propertyType: caseData.property?.aolPropertyType || "Fully Detached House",
      offThePlan: "No",
      rentalIncomeGross: money(primary.income?.rentalAnnual) / 52,
      rentalIncomePeriod: "Weekly",
      hasEvidenceOfTenancy: "No",
      estimatedValue: money(caseData.property?.estimatedValue || caseData.property?.purchasePrice),
      transferOfLandAmount: money(caseData.property?.purchasePrice || caseData.property?.estimatedValue),
      basisOfEstimate: "Applicant Estimate",
      titleType: "Freehold",
      title: caseData.property?.titleType || "Torrens",
      contactForAccess: primaryName
    },
    financials: {
      totalAssets: (caseData.assets || []).reduce((sum, asset) => sum + money(asset.value), 0),
      totalLiabilities: (caseData.liabilities || []).reduce((sum, liability) => sum + money(liability.balance), 0),
      totalIncomeMonthly: Math.round(
        ((caseData.applicants || []).reduce((sum, applicant) => sum + money(applicant.income?.baseAnnual) + money(applicant.income?.rentalAnnual), 0) / 12) * 100
      ) / 100,
      totalExpensesMonthly: money(caseData.expenses?.livingMonthly),
      incomeConfirmed: "No",
      expensesReviewed: "Yes",
      statementOfPositionDate: interviewDate // broker decision: SoP date = interview date
    },
    compliance: {
      interviewDate, // ISO yyyy-mm-dd — bot fills the AOL interview date with this (matches Infinity)
      anticipatedChanges: "No",
      retirementAge: 80,
      reachRetirementDuringLoan: "No",
      ageReach67DuringLoan: "Yes",
      repayPriorToRetirement: true,
      repayPriorToRetirementDetails: "Repayment of loan prior to retirement",
      saleOfAssets: true,
      saleOfAssetsDetails: "Sale of assets",
      applicantDeclaredPurposeAccepted: true,
      refinanceDebtConsolidation: "Not applicable",
      rateType: isVariable ? "Variable" : caseData.loan?.productPreference || "Fixed",
      variableRateImportant: isVariable ? "Important" : "Not important",
      variableRateReasonFlexible: isVariable,
      variableRateRiskAcknowledged: isVariable,
      repaymentImportance: isPrincipalInterest ? "Important" : "Not important",
      repaymentFrequency: "Monthly",
      principalAndInterestMinimiseInterest: isPrincipalInterest,
      principalAndInterestBuildEquity: isPrincipalInterest,
      principalAndInterestRiskAcknowledged: isPrincipalInterest,
      interestOnlyImportance: isPrincipalInterest ? "Not important" : "Important",
      offsetImportance: hasOffset ? "Important" : "Not important",
      offsetReasonAccessFunds: hasOffset,
      offsetReasonReduceInterest: hasOffset,
      offsetRiskAcknowledged: hasOffset,
      redrawImportance: hasRedraw ? "Important" : "Not important",
      redrawReasonFlexibility: hasRedraw,
      redrawRiskAcknowledged: hasRedraw,
      otherRequirements: "No",
      conflicts: "No",
      productSelection: infinity?.recommendation?.loanFeatures || ""
    },
    documents: {
      expected: [
        "Privacy Consent Form",
        "Self Employed Declaration",
        "Responsible Lending Form",
        "Serviceability Calculator",
        "Verification of Identity",
        "Rental Income Statement",
        "Electronic Disclosure and eSignature Consent"
      ]
    },
    summary: {
      totalLoanParties: caseData.applicants?.length || 1,
      totalDependants: (caseData.applicants || []).reduce((sum, applicant) => sum + money(applicant.dependants), 0),
      baseAmount: money(caseData.loan?.loanAmount),
      totalLoanAmount: money(caseData.loan?.loanAmount),
      totalSecurities: money(caseData.property?.estimatedValue || caseData.property?.purchasePrice),
      residentialAddress: formatAddress(primary.address),
      contactInfo: primary.mobile || "",
      primaryPurpose: loanPurpose(caseData),
      repaymentType: caseData.loan?.repaymentType || "Principal & Interest",
      totalLoanTerm: `${caseData.loan?.loanTermYears || 30} years`
    }
  };
}
