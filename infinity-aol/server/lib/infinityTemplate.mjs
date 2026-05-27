const currency = (value) => Number(value || 0);

function fullName(applicant) {
  return [applicant?.firstName, applicant?.middleName, applicant?.lastName].filter(Boolean).join(" ").trim();
}

function sentenceName(applicants) {
  if (applicants.length > 1) return "The clients";
  return "The client";
}

function pronouns(applicants) {
  if (applicants.length > 1) return { subject: "they", object: "them", possessive: "their", be: "are" };
  const gender = String(applicants[0]?.gender || "").toLowerCase();
  if (gender === "female") return { subject: "she", object: "her", possessive: "her", be: "is" };
  if (gender === "male") return { subject: "he", object: "him", possessive: "his", be: "is" };
  return { subject: "they", object: "them", possessive: "their", be: "are" };
}

function loanPurposeText(caseData) {
  const purpose = `${caseData.property?.purpose || caseData.loan?.applicationType || ""}`.toLowerCase();
  if (purpose.includes("investment")) return "Purchase Investment Property";
  if (purpose.includes("owner")) return "Purchase Owner Occupied Dwelling";
  if (purpose.includes("refinance")) return "Refinance";
  return caseData.property?.purpose || caseData.loan?.applicationType || "Purchase";
}

function isRefinance(caseData) {
  return /refinance/i.test(`${caseData.property?.purpose || ""} ${caseData.loan?.applicationType || ""} ${caseData.loan?.opportunityName || ""}`);
}

function selectedObjectives(caseData) {
  const purpose = loanPurposeText(caseData);
  return {
    bridging: Boolean(caseData.loan?.bridging),
    constructRenovateOwnerOccupiedDwelling: Boolean(caseData.loan?.constructOwnerOccupied),
    constructRenovateInvestmentProperty: Boolean(caseData.loan?.constructInvestment),
    debtConsolidation: Boolean(caseData.loan?.debtConsolidation),
    purchaseInvestmentProperty: purpose === "Purchase Investment Property",
    purchaseOwnerOccupiedDwelling: purpose === "Purchase Owner Occupied Dwelling",
    purchaseVacantLand: /vacant land/i.test(purpose),
    refinance: isRefinance(caseData),
    reverseMortgage: Boolean(caseData.loan?.reverseMortgage),
    otherPurpose: Boolean(caseData.loan?.otherPurpose),
    consumerConstruction: Boolean(caseData.loan?.consumerConstruction),
    leisurePurchase: Boolean(caseData.loan?.leisurePurchase),
    medicalPurchase: Boolean(caseData.loan?.medicalPurchase),
    vehiclePurchase: Boolean(caseData.loan?.vehiclePurchase),
    consumerOtherPurpose: Boolean(caseData.loan?.consumerOtherPurpose)
  };
}

function selectedRequirements(caseData) {
  const product = String(caseData.loan?.productPreference || "");
  const repayment = String(caseData.loan?.repaymentType || "");
  return {
    bridgingFinance: Boolean(caseData.loan?.bridging),
    extraRepayments: Boolean(caseData.loan?.extraRepayments ?? true),
    lineOfCredit: Boolean(caseData.loan?.lineOfCredit),
    nonConformingLoan: Boolean(caseData.loan?.nonConformingLoan),
    offset: Boolean(caseData.loan?.offsetRequested),
    rateLock: Boolean(caseData.loan?.rateLock),
    redraw: Boolean(caseData.loan?.redrawRequested ?? true),
    reverseMortgage: Boolean(caseData.loan?.reverseMortgage),
    otherRequirements: Boolean(caseData.loan?.otherRequirements),
    noEarlyRepaymentPenalty: Boolean(caseData.loan?.noEarlyRepaymentPenalty),
    fixedRate: /fixed/i.test(product) && !/variable/i.test(product),
    variableRate: /variable/i.test(product) || !/fixed/i.test(product),
    fixedVariableRate: /fixed.*variable|variable.*fixed/i.test(product),
    interestOnly: /interest only/i.test(repayment),
    balloonRepayments: Boolean(caseData.loan?.balloonRepayments),
    principalAndInterest: /principal|p\s*&\s*i/i.test(repayment),
    weeklyRepayments: /weekly/i.test(caseData.loan?.repaymentFrequency || ""),
    fortnightlyRepayments: /fortnight/i.test(caseData.loan?.repaymentFrequency || ""),
    monthlyRepayments: !/weekly|fortnight/i.test(caseData.loan?.repaymentFrequency || "")
  };
}

function lenderText(caseData) {
  return caseData.loan?.lender || caseData.loan?.preferredLender || "Pepper Money";
}

function primarySecurity(caseData) {
  return {
    name: caseData.property?.shortName || caseData.property?.address || "TBC security",
    amount: currency(caseData.property?.estimatedValue || caseData.property?.purchasePrice),
    primary: true
  };
}

function primaryIncome(applicant) {
  return currency(applicant?.income?.baseAnnual) + currency(applicant?.income?.overtimeAnnual) + currency(applicant?.income?.bonusAnnual);
}

function buildNarrative(caseData, applicants) {
  const who = sentenceName(applicants);
  const p = pronouns(applicants);
  const purpose = loanPurposeText(caseData).toLowerCase();
  const loanTerm = caseData.loan?.loanTermYears || 30;
  const lender = lenderText(caseData);
  const product = caseData.loan?.productPreference || "Variable";
  const repayment = caseData.loan?.repaymentType || "Principal and Interest";
  const objective = `${who} would like to buy ${p.possessive} ${purpose.includes("investment") ? "investment" : "owner occupied"} property.`;

  const longStructure = `${who} ${p.be} seeking pre-approval to purchase ${purpose.includes("investment") ? "an investment" : "a"} property. ${p.subject[0].toUpperCase()}${p.subject.slice(1)} ${p.be} looking to have the loan for ${loanTerm} years; however ${p.subject} may be able to pay down sooner in the future if ${p.subject} ${p.be} in a position to. The applicant ${p.be} working and earning good income. The applicant does not foresee any changes to ${p.possessive} financial position that may affect ${p.possessive} ability to repay the home loan.\n\n${who} chooses a variable option to enable flexibility in reducing debt if ${p.subject} accumulates extra funds during this period. Also, ${who.toLowerCase()} would like to use the redraw option if ${p.subject} needs to gain access to the funds. ${who} prefers a ${repayment} option because ${p.subject} would like to pay down the loan over the period of ${loanTerm} years to reduce the debt. The monthly repayment is more suitable for ${who.toLowerCase()} to budget.`;

  return {
    loanObjectiveExplanation: objective,
    circumstancesObjectivesPriorities: `${longStructure}\n${lender} was chosen because they provide stronger servicing and offer competitive rates.`,
    financialAwarenessPractices: `${who} already has experience with mortgage products. Loan terms and key features have been fully explained and understood.\n${who} has a good record of saving and ${p.be} living within ${p.possessive} means.`,
    lender: `${lender} was chosen because they provide a stronger service and better interest rate for the client. Other lenders do not provide enough borrowing capacity and better interest rate for the client to purchase the property they want.`,
    loanAmount: `The loan amount can be serviced by the applicant and is enough for ${p.object} to complete the purchase.`,
    interestRate: `${product} rate to take advantage of when the interest rate decreases.`,
    loanStructure: longStructure,
    goalsObjectives: longStructure,
    loanFeatures: longStructure,
    commissionsConflict: "No conflict of interest has been identified. Standard lender commissions and any referral fees have been disclosed where applicable."
  };
}

function narrativeContext(caseData, applicants) {
  const who = sentenceName(applicants);
  const p = pronouns(applicants);
  const purpose = loanPurposeText(caseData);
  const propertyUse = purpose.toLowerCase().includes("investment") ? "investment" : "owner occupied";
  return {
    Client: who,
    client: who.toLowerCase(),
    Subject: `${p.subject[0].toUpperCase()}${p.subject.slice(1)}`,
    subject: p.subject,
    object: p.object,
    possessive: p.possessive,
    be: p.be,
    lender: lenderText(caseData),
    loanTerm: caseData.loan?.loanTermYears || 30,
    repayment: caseData.loan?.repaymentType || "Principal and Interest",
    purpose,
    propertyUse,
    loanAmount: currency(caseData.loan?.loanAmount)
  };
}

function renderTemplateText(value, context) {
  return String(value || "").replace(/\{(\w+)\}/g, (_match, key) => context[key] ?? "");
}

function applyNarrativeOverrides(narrative, caseData, applicants) {
  const overrides = caseData.selectedTemplate?.sectionText || caseData.selectedTemplate?.narrativeOverrides || {};
  if (!Object.keys(overrides).length) return narrative;

  const context = narrativeContext(caseData, applicants);

  return Object.fromEntries(
    Object.entries(narrative).map(([key, value]) => [key, overrides[key] ? renderTemplateText(overrides[key], context) : value])
  );
}

export function buildTemplateTextPreview(caseData) {
  const applicants = (caseData.applicants || []).filter(Boolean);
  const narrative = applyNarrativeOverrides(buildNarrative(caseData, applicants), caseData, applicants);
  return {
    needsAnalysis: {
      loanObjectiveExplanation: narrative.loanObjectiveExplanation
    },
    loansSecuritiesCommentary: {
      circumstancesObjectivesPriorities: narrative.circumstancesObjectivesPriorities,
      financialAwarenessPractices: narrative.financialAwarenessPractices
    },
    recommendation: {
      lender: narrative.lender,
      loanAmount: narrative.loanAmount,
      interestRate: narrative.interestRate,
      loanStructure: narrative.loanStructure,
      goalsObjectives: narrative.goalsObjectives,
      loanFeatures: narrative.loanFeatures
    },
    commissionsConflict: {
      comments: narrative.commissionsConflict
    }
  };
}

export function buildInfinityTemplate(caseData) {
  const applicants = (caseData.applicants || []).filter(Boolean);
  const primary = applicants.find((applicant) => applicant.role === "primary") || applicants[0];
  const secondary = applicants.find((applicant) => applicant.role === "secondary") || null;
  const narrative = applyNarrativeOverrides(buildNarrative(caseData, applicants), caseData, applicants);
  const loanPurpose = loanPurposeText(caseData);
  const lender = lenderText(caseData);
  const facilityAmount = currency(caseData.loan?.loanAmount);
  const security = primarySecurity(caseData);
  const preferredLoanFeatures = caseData.selectedTemplate?.loanFeatures?.length
    ? caseData.selectedTemplate.loanFeatures
    : [
        { priority: 1, feature: "Variable Rate", reason: "The client chooses a variable option to enable flexibility in reducing debt if they accumulate extra funds during this period." },
        { priority: 2, feature: "Redraw", reason: "Gain access to funds" },
        { priority: 3, feature: "P & I Repayments", reason: "The client prefers Principal and Interest repayments to pay down the loan over time." },
        { priority: 4, feature: "Offset", reason: "To save interest charged" },
        { priority: 5, feature: "Monthly Repayments", reason: "Personal preference" }
      ];

  return {
    applicantMode: secondary ? "couple" : "single",
    clientDetails: {
      entityType: "Individual",
      primaryApplicant: "Yes",
      applicantType: "Applicant",
      title: primary?.title || (primary?.gender === "Female" ? "Ms." : ""),
      firstName: primary?.firstName || "",
      middleName: primary?.middleName || "",
      surname: primary?.lastName || "",
      dateOfBirth: primary?.dateOfBirth || "",
      gender: primary?.gender || "",
      maritalStatus: primary?.maritalStatus || "",
      mobile: primary?.mobile || "",
      email: primary?.email || "",
      currentAddress: primary?.address?.line1 ? `${primary.address.line1}, ${primary.address.suburb} ${primary.address.state} ${primary.address.postcode}, Australia` : "",
      numberOfDependants: primary?.dependants ?? 0,
      currentHousingSituation: caseData.clientProfile?.currentHousingSituation || "",
      permanentInAustralia: primary?.residencyStatus ? "Yes" : "",
      driversLicenceNo: primary?.id?.driversLicenceNo || "",
      licenceExpiryDate: primary?.id?.licenceExpiryDate || "",
      licenceState: primary?.id?.licenceState || "",
      licenceClass: primary?.id?.licenceClass || ""
    },
    coApplicant: secondary
      ? {
          firstName: secondary.firstName || "",
          middleName: secondary.middleName || "",
          surname: secondary.lastName || "",
          dateOfBirth: secondary.dateOfBirth || "",
          mobile: secondary.mobile || "",
          email: secondary.email || ""
        }
      : null,
    financials: {
      assets: caseData.assets || [],
      liabilities: caseData.liabilities || [],
      incomes: applicants.flatMap((applicant) => {
        const rows = [];
        if (primaryIncome(applicant)) {
          rows.push({
            type: "Base Salary",
            employer: applicant.employment?.employerName || "",
            ownership: fullName(applicant),
            frequency: "Annually",
            amount: primaryIncome(applicant)
          });
        }
        if (currency(applicant.income?.rentalAnnual)) {
          rows.push({
            type: "Rental Income",
            employer: "",
            ownership: fullName(applicant),
            frequency: "Annually",
            amount: currency(applicant.income.rentalAnnual)
          });
        }
        return rows;
      }),
      monthlyExpenses: caseData.expenses || {}
    },
    needsAnalysis: {
      dateCreditGuideProvided: caseData.factFind?.dateCreditGuideProvided || "",
      dateInterviewConducted: caseData.factFind?.dateInterviewConducted || "",
      methodClientInterview: caseData.factFind?.methodClientInterview || "Face to Face",
      methodDocumentIdentification: caseData.factFind?.methodDocumentIdentification || "Face to Face",
      facilityAmount,
      estimatedSettlementDate: caseData.loan?.estimatedSettlementDate || "",
      selectedApplicants: applicants.map(fullName),
      objectives: {
        ...selectedObjectives(caseData)
      },
      requirements: {
        ...selectedRequirements(caseData)
      },
      loanObjectiveExplanation: narrative.loanObjectiveExplanation
    },
    loansSecuritiesCommentary: {
      loanPurpose,
      facilityAmount,
      security,
      preApprovalLoan: /pre[- ]?approval/i.test(caseData.brokerNotes || "") || caseData.loan?.preApproval === true,
      capitaliseLmi: Boolean(caseData.loan?.capitaliseLmi),
      lvr: currency(caseData.loan?.lvr),
      opportunity: loanPurpose,
      opportunityName: caseData.loan?.opportunityName || loanPurpose,
      circumstancesObjectivesPriorities: narrative.circumstancesObjectivesPriorities,
      anySignificantChangesAnticipated: "No",
      otherItemsDiscussed: caseData.loan?.otherItemsDiscussed || "",
      financialAwarenessPractices: narrative.financialAwarenessPractices
    },
    preferredLoanFeatures,
    otherLoanFeatureRequests: caseData.loan?.otherLoanFeatureRequests || "",
    recommendation: {
      selectedLender: lender,
      lender: narrative.lender,
      loanAmount: narrative.loanAmount,
      interestRate: narrative.interestRate,
      loanStructure: narrative.loanStructure,
      goalsObjectives: narrative.goalsObjectives,
      loanFeatures: narrative.loanFeatures
    },
    commissionsConflict: {
      comments: narrative.commissionsConflict,
      referrerType: "Single",
      referrerGroup: "None",
      referrer: "None",
      otherUpfrontFeesInclGst: 0,
      otherFeeNotes: ""
    }
  };
}
