import { classifyLoanPurpose, isRefinanceCase } from "./loanPurpose.mjs";

const currency = (value) => Number(value || 0);

function fullName(applicant) {
  return [applicant?.firstName, applicant?.middleName, applicant?.lastName || applicant?.surname].filter(Boolean).join(" ").trim();
}

function formatClientAddress(applicant) {
  const a = applicant?.address || {};
  // STATE + postcode tail, e.g. ", Mayfield NSW 2304, Australia".
  const TAIL = /,?\s*([A-Za-z' -]+?)\s+(NSW|VIC|QLD|SA|WA|TAS|ACT|NT)\s+(\d{4})(?:,\s*Australia)?\s*$/i;
  let line1 = a.line1 || a.current || "";
  let suburb = a.suburb || "", state = a.state || "", postcode = a.postcode || "";
  // If we only have a full address string, split it — BUT the structured suburb/state/postcode WIN, so a stale
  // OCR postcode inside fullAddress (e.g. "Mayfield NSW 2034") can't leak in and get re-parsed downstream.
  if ((!line1 || !postcode) && a.fullAddress) {
    const full = String(a.fullAddress).replace(/,\s*Australia\s*$/i, "");
    const m = full.match(TAIL);
    if (m) {
      if (!line1) line1 = full.slice(0, m.index).replace(/,\s*$/, "").trim();
      suburb = suburb || m[1].trim();
      state = state || m[2];
      postcode = postcode || m[3];
    } else if (!line1) { line1 = full; }
  }
  if (!(line1 || suburb || state || postcode)) return "";
  return `${line1}, ${suburb} ${state} ${postcode}, ${a.country || "Australia"}`
    .replace(/\s+,/g, ",").replace(/\s+/g, " ").replace(/^,\s*/, "").trim();
}

function looksLikeDate(value) {
  return /^\d{4}-\d{2}-\d{2}$|^\d{1,2}\/\d{1,2}\/\d{4}$/.test(String(value || "").trim());
}

function clientDetailsForApplicant(applicant, options = {}) {
  const rawLicenceNo = applicant?.id?.driversLicenceNo || "";
  const rawExpiry = applicant?.id?.licenceExpiryDate || "";
  return {
    fullName: fullName(applicant),
    entityType: "Individual",
    primaryApplicant: options.primaryApplicant ? "Yes" : "No",
    applicantType: "Applicant",
    title: applicant?.title || (applicant?.gender === "Female" ? "Ms." : ""),
    firstName: applicant?.firstName || "",
    middleName: applicant?.middleName || "",
    surname: applicant?.lastName || applicant?.surname || "",
    dateOfBirth: applicant?.dateOfBirth || "",
    gender: applicant?.gender || "",
    maritalStatus: options.relatedSpouse ? "Married" : applicant?.maritalStatus || "",
    relatedSpouse: options.relatedSpouse || "",
    mobile: applicant?.mobile || "",
    email: applicant?.email || "",
    currentAddress: formatClientAddress(applicant),
    numberOfDependants: applicant?.dependants ?? 0,
    currentHousingSituation: options.currentHousingSituation || applicant?.currentHousingSituation || applicant?.currentResidentialStatus || applicant?.address?.residentialStatus || applicant?.address?.currentResidentialStatus || "",
    permanentInAustralia: applicant?.permanentInAustralia || (applicant?.residencyStatus ? "Yes" : ""),
    driversLicenceNo: looksLikeDate(rawLicenceNo) ? "" : rawLicenceNo,
    licenceExpiryDate: rawExpiry || (looksLikeDate(rawLicenceNo) ? rawLicenceNo : ""),
    licenceState: applicant?.id?.licenceState || "",
    licenceClass: applicant?.id?.licenceClass || ""
  };
}

function applicantHousingSituation(applicant) {
  return applicant?.currentHousingSituation ||
    applicant?.currentResidentialStatus ||
    applicant?.address?.residentialStatus ||
    applicant?.address?.currentResidentialStatus ||
    "";
}

function currentHousingSituationForApplicant(caseData, applicant) {
  const primary = caseData.applicants?.find((item) => item.role === "primary") || caseData.applicants?.[0] || {};
  const primaryFallback = applicant?.role === "secondary" ? applicantHousingSituation(primary) : "";
  return applicantHousingSituation(applicant) ||
    primaryFallback ||
    caseData.clientProfile?.currentHousingSituation ||
    "";
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
  switch (classifyLoanPurpose(caseData)) { // shared classifier: occupancy-first, never opportunityName
    case "refinance": return "Refinance";
    case "vacant-land": return "Purchase Vacant Land";
    case "investment": return "Purchase Investment Property";
    default: return "Purchase Owner Occupied Dwelling";
  }
}

function isRefinance(caseData) {
  return isRefinanceCase(caseData);
}

function dateToAu(value) {
  if (!value) return "";
  const text = String(value).trim();
  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[3]}/${iso[2]}/${iso[1]}`;
  const au = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (au) return `${au[1].padStart(2, "0")}/${au[2].padStart(2, "0")}/${au[3]}`;
  return text;
}

function addDaysAu(days) {
  const date = new Date();
  date.setDate(date.getDate() + Number(days || 0));
  return `${String(date.getDate()).padStart(2, "0")}/${String(date.getMonth() + 1).padStart(2, "0")}/${date.getFullYear()}`;
}

function firstPresent(...values) {
  return values.find((value) => value !== undefined && value !== null && String(value).trim() !== "");
}

function isPreApproval(caseData) {
  return caseData.loan?.preApproval === true || /pre[- ]?approval/i.test(`${caseData.brokerNotes || ""} ${caseData.loan?.applicationType || ""} ${caseData.selectedTemplate?.title || ""}`);
}

function selectedObjectives(caseData) {
  const purpose = loanPurposeText(caseData);
  const refi = isRefinance(caseData);
  const construct = Boolean(caseData.loan?.constructOwnerOccupied || caseData.loan?.constructInvestment);
  const cashOut = Boolean(caseData.loan?.cashOut || /cash[ -]?out|equity release|release equity/i.test(`${caseData.loan?.purpose || ""} ${caseData.loan?.opportunityName || ""}`));
  return {
    bridging: Boolean(caseData.loan?.bridging),
    constructRenovateOwnerOccupiedDwelling: Boolean(caseData.loan?.constructOwnerOccupied),
    constructRenovateInvestmentProperty: Boolean(caseData.loan?.constructInvestment),
    debtConsolidation: Boolean(caseData.loan?.debtConsolidation),
    purchaseInvestmentProperty: purpose === "Purchase Investment Property" && !refi && !construct,
    purchaseOwnerOccupiedDwelling: purpose === "Purchase Owner Occupied Dwelling" && !refi && !construct,
    purchaseVacantLand: /vacant land/i.test(purpose),
    refinance: refi,
    reverseMortgage: Boolean(caseData.loan?.reverseMortgage),
    otherPurpose: Boolean(caseData.loan?.otherPurpose || (refi && cashOut)),
    consumerConstruction: Boolean(caseData.loan?.consumerConstruction),
    leisurePurchase: Boolean(caseData.loan?.leisurePurchase),
    medicalPurchase: Boolean(caseData.loan?.medicalPurchase),
    vehiclePurchase: Boolean(caseData.loan?.vehiclePurchase),
    consumerOtherPurpose: Boolean(caseData.loan?.consumerOtherPurpose || (!refi && cashOut))
  };
}

function selectedRequirements(caseData) {
  const product = String(caseData.loan?.productPreference || "");
  const repayment = String(caseData.loan?.repaymentType || "");
  const purpose = loanPurposeText(caseData);
  const ownerOccupiedPurchase = purpose === "Purchase Owner Occupied Dwelling" && !isRefinance(caseData);
  const explicitInterestOnly = ownerOccupiedPurchase ? caseData.loan?.interestOnly === true : (caseData.loan?.interestOnly === true || /interest only/i.test(repayment));
  const balloonRepayments = ownerOccupiedPurchase ? caseData.loan?.balloonRepayments === true : Boolean(caseData.loan?.balloonRepayments || /balloon/i.test(repayment));
  const weeklyRepayments = ownerOccupiedPurchase ? false : caseData.loan?.weeklyRepayments === true;
  const fortnightlyRepayments = ownerOccupiedPurchase ? false : caseData.loan?.fortnightlyRepayments === true;
  const monthlyRepayments = ownerOccupiedPurchase ? true : (caseData.loan?.monthlyRepayments === true || (!weeklyRepayments && !fortnightlyRepayments));
  return {
    bridgingFinance: Boolean(caseData.loan?.bridging),
    extraRepayments: caseData.loan?.extraRepayments === true,
    lineOfCredit: Boolean(caseData.loan?.lineOfCredit),
    nonConformingLoan: Boolean(caseData.loan?.nonConformingLoan),
    offset: caseData.loan?.offsetRequested !== false,
    rateLock: Boolean(caseData.loan?.rateLock),
    redraw: Boolean(caseData.loan?.redrawRequested ?? true),
    reverseMortgage: Boolean(caseData.loan?.reverseMortgage),
    otherRequirements: Boolean(caseData.loan?.otherRequirements),
    noEarlyRepaymentPenalty: Boolean(caseData.loan?.noEarlyRepaymentPenalty),
    fixedRate: /fixed/i.test(product) && !/variable/i.test(product),
    variableRate: /variable/i.test(product) || !/fixed/i.test(product),
    fixedVariableRate: /fixed.*variable|variable.*fixed/i.test(product),
    interestOnly: explicitInterestOnly,
    balloonRepayments,
    principalAndInterest: !explicitInterestOnly && !balloonRepayments,
    weeklyRepayments,
    fortnightlyRepayments,
    monthlyRepayments
  };
}

function lenderText(caseData) {
  return caseData.loan?.lender || caseData.loan?.preferredLender || "[LENDER]";
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

// ---- Loan-feature logic: drives the Loans & Securities commentary + Preferred Loan Features so the narrative
// tracks the ACTUAL loan (rate type, redraw, offset, P&I/IO, repayment frequency) instead of hardcoded text. ----
function repaymentFrequencyLabel(caseData) {
  const f = String(caseData.loan?.repaymentFrequency || "").toLowerCase();
  if (/fortnight/.test(f)) return "Fortnightly";
  if (/week/.test(f)) return "Weekly";
  if (/month/.test(f)) return "Monthly";
  if (caseData.loan?.weeklyRepayments === true) return "Weekly";
  if (caseData.loan?.fortnightlyRepayments === true) return "Fortnightly";
  return "Monthly";
}
function frequencyReason(freq) {
  if (freq === "Weekly") return "The client prefers weekly repayments to align with their cash flow and help manage budgeting.";
  if (freq === "Fortnightly") return "The client prefers fortnightly repayments to align with their pay cycle and reduce interest over the loan term.";
  return "The client prefers monthly repayments to align with their budgeting.";
}
function loanFeatureShape(caseData) {
  const req = selectedRequirements(caseData);
  const product = String(caseData.loan?.productPreference || caseData.loan?.product || "");
  const isFixed = /fixed/i.test(product) && !/variable/i.test(product);
  return {
    isFixed,
    rateType: isFixed ? "Fixed Rate" : "Variable Rate",
    redraw: req.redraw,
    offset: req.offset,
    extraRepayments: req.extraRepayments,
    interestOnly: req.interestOnly,
    repaymentTypeLabel: req.interestOnly ? "Interest Only" : "P & I Repayments",
    frequency: repaymentFrequencyLabel(caseData),
    term: caseData.loan?.loanTermYears || 30
  };
}
// The "features" paragraph of the Loans & Securities commentary — built from the real loan shape, in the
// broker's preferred order: rate type → redraw → P&I/IO → frequency (offset mentioned only if selected).
function circumstancesFeaturesParagraph(caseData, who, p) {
  const s = loanFeatureShape(caseData);
  const lower = who.toLowerCase();
  const parts = [];
  parts.push(s.isFixed
    ? `${who} chooses a fixed rate option for certainty of repayments during the fixed period.`
    : `${who} chooses a variable option to enable flexibility in reducing debt if ${p.subject} accumulates extra funds during this period.`);
  if (s.redraw) parts.push(`Also, ${lower} would like to use the redraw option if ${p.subject} needs to gain access to the funds.`);
  // Offset is captured as a Preferred Loan Feature, but the broker keeps it OUT of this commentary paragraph
  // (matches the reference SOCA sample). Do not add an offset sentence here.
  parts.push(s.interestOnly
    ? `${who} prefers an Interest Only option to keep repayments lower during the initial period.`
    : `${who} prefers a Principal & Interest option because ${p.subject} would like to pay down the loan over the period of ${s.term} years to reduce the debt.`);
  parts.push(frequencyReason(s.frequency));
  return parts.join(" ");
}
// Prioritised Loan Features list — derived from the real loan shape (matches the Preferred Loan Features tab).
function buildPreferredFeatures(caseData) {
  if (caseData.selectedTemplate?.loanFeatures?.length) return caseData.selectedTemplate.loanFeatures;
  const s = loanFeatureShape(caseData);
  const feats = [];
  feats.push({ feature: s.rateType, reason: s.isFixed ? "The client prefers a fixed rate for certainty of repayments." : "The client wants flexibility if interest rates decrease." });
  if (s.redraw) feats.push({ feature: "Redraw", reason: "Gain access to funds if required." });
  feats.push({ feature: s.repaymentTypeLabel, reason: s.interestOnly ? "Interest Only to keep repayments lower during the initial period." : "The client prefers to reduce principal over the loan term." });
  if (s.offset) feats.push({ feature: "Offset", reason: "To save interest charged." });
  feats.push({ feature: `${s.frequency} Repayments`, reason: frequencyReason(s.frequency) });
  return feats.map((f, i) => ({ priority: i + 1, feature: f.feature, reason: f.reason }));
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
  const refi = isRefinance(caseData);
  const objectiveText = refi
    ? `${who} would like to refinance ${p.possessive} existing home loan.`
    : purpose.includes("investment")
      ? `${who} would like to buy an investment property.`
      : purpose.includes("vacant land")
        ? `${who} would like to buy vacant land.`
        : objective;

  const purposeSentence = refi
    ? `${who} ${p.be} seeking finance to refinance the existing home loan.`
    : `${who} ${p.be} seeking pre-approval to purchase ${purpose.includes("investment") ? "an investment" : "an owner-occupied"} property.`;
  const Subject = `${p.subject[0].toUpperCase()}${p.subject.slice(1)}`;
  // Paragraph 1, body = term / income / no anticipated changes (no purpose sentence). Loan Features uses this on
  // its own; the other fields prepend the purpose sentence.
  const para1Body = `${Subject} ${p.be} looking to have the loan for ${loanTerm} years; however ${p.subject} may be able to pay down sooner in the future if ${p.subject} ${p.be} in a position to. The applicant ${p.be} working and earning a good income. The applicant does not foresee any changes to ${p.possessive} financial position that may affect ${p.possessive} ability to repay the home loan.`;
  const para1 = `${purposeSentence} ${para1Body}`;
  const lenderSentence = `${lender} was chosen because they provide stronger servicing and offer competitive rates.`;
  // Paragraph 2: the loan features, built from the actual loan shape (variable/fixed, redraw, P&I/IO, frequency).
  const featuresParagraph = circumstancesFeaturesParagraph(caseData, who, p);
  const longStructure = `${para1}\n\n${featuresParagraph}`;

  return {
    loanObjectiveExplanation: objectiveText,
    circumstancesObjectivesPriorities: `${para1}\n${lenderSentence}\n\n${featuresParagraph}`,
    financialAwarenessPractices: `${who} already has experience with mortgage products. Loan terms and key features have been fully explained and understood.\n${who} has a good record of saving and ${p.be} living within ${p.possessive} means.`,
    lender: `${lender} was chosen because they provide a stronger service and better interest rate for the client. Other lenders do not give enough borrowing capacity and better interest rate for clients to purchase the property ${p.subject} wants.`,
    loanAmount: `The loan amount can be serviced by the applicant and is enough for ${p.object} to complete the purchase.`,
    interestRate: `${product} rate to take advantage of when the interest rate decreases.`,
    loanStructure: longStructure,
    goalsObjectives: longStructure,
    // Loan Features sample starts at the term sentence (no purpose opener) + the features paragraph.
    loanFeatures: `${para1Body}\n\n${featuresParagraph}`,
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
  const applicants = (caseData.applicants || [])
    .filter((applicant) => Boolean(fullName(applicant)))
    .sort((a, b) => (a.role === "primary" ? -1 : 0) - (b.role === "primary" ? -1 : 0));
  const primary = applicants.find((applicant) => applicant.role === "primary") || applicants[0];
  const secondary = applicants.find((applicant) => applicant.role === "secondary") || null;
  const narrative = applyNarrativeOverrides(buildNarrative(caseData, applicants), caseData, applicants);
  const loanPurpose = loanPurposeText(caseData);
  const lender = lenderText(caseData);
  const facilityAmount = currency(caseData.loan?.loanAmount);
  const security = primarySecurity(caseData);
  // Derived from the real loan shape (rate type, redraw, P&I/IO, offset, repayment frequency) so the Preferred
  // Loan Features tab tracks the case — e.g. a weekly-repayment loan lists "Weekly Repayments", not "Monthly".
  const preferredLoanFeatures = buildPreferredFeatures(caseData);

  return {
    applicantMode: secondary ? "couple" : "single",
    clientDetails: clientDetailsForApplicant(primary, {
      primaryApplicant: true,
      relatedSpouse: secondary ? fullName(secondary) : "",
      currentHousingSituation: currentHousingSituationForApplicant(caseData, primary)
    }),
    applicants: applicants.map((applicant, index) =>
      clientDetailsForApplicant(applicant, {
        primaryApplicant: index === 0,
        relatedSpouse: applicants.length > 1 ? fullName(index === 0 ? applicants[1] : applicants[0]) : "",
        currentHousingSituation: currentHousingSituationForApplicant(caseData, applicant)
      })
    ),
    coApplicant: secondary
      ? {
          firstName: secondary.firstName || "",
          middleName: secondary.middleName || "",
          surname: secondary.lastName || secondary.surname || "",
          dateOfBirth: secondary.dateOfBirth || "",
          gender: secondary.gender || "",
          maritalStatus: primary ? "Married" : secondary.maritalStatus || "",
          relatedSpouse: primary ? fullName(primary) : "",
          mobile: secondary.mobile || "",
          email: secondary.email || "",
          currentAddress: formatClientAddress(secondary),
          driversLicenceNo: secondary.id?.driversLicenceNo || "",
          licenceExpiryDate: secondary.id?.licenceExpiryDate || "",
          licenceState: secondary.id?.licenceState || "",
          licenceClass: secondary.id?.licenceClass || ""
        }
      : null,
    financials: {
      assets: caseData.assets || [],
      liabilities: caseData.liabilities || [],
      expenses: (() => {
        const ownerPct = applicants.length >= 2 ? "50%" : "100%";
        const rows = (caseData.expenses?.breakdown?.length ? caseData.expenses.breakdown : []).map((expense) => ({
          templateKey: expense.templateKey || "",
          type: expense.expenseType || expense.type || "Groceries",
          expenseType: expense.expenseType || expense.type || "Groceries",
          infinityTypeCandidates: Array.isArray(expense.infinityTypeCandidates) ? expense.infinityTypeCandidates : [expense.expenseType || expense.type || "Groceries"],
          amount: currency(expense.amount || expense.value),
          frequency: expense.frequency || "Monthly",
          description: expense.description || expense.expenseType || expense.type || "Living expenses / HEM",
          continuePostSettlement: expense.continuePostSettlement || "Yes",
          ownership: expense.ownership || "100%",
          applicantScope: expense.applicantScope || "household",
          source: expense.source || caseData.expenseSource || caseData.expenses?.source || ""
        })).map((expense) => ({ ...expense, ownership: expense.ownership && expense.ownership !== "100%" ? expense.ownership : ownerPct })).filter((expense) => expense.amount > 0);
        // Renting applicants must carry a Rent living expense (default $600/mo unless provided).
        const housing = String(currentHousingSituationForApplicant(caseData, primary) || "").toLowerCase();
        const hasRent = rows.some((r) => /rent/i.test(r.type) || /rent/i.test(r.expenseType));
        if (housing.includes("rent") && !hasRent) {
          const rentMonthly = Number(caseData.expenses?.rentMonthly) > 0 ? Number(caseData.expenses.rentMonthly) : 600;
          const ownerOccupied = loanPurposeText(caseData) === "Purchase Owner Occupied Dwelling";
          rows.unshift({
            templateKey: "rent",
            type: "Rental Expenses",
            expenseType: "Rental Expenses",
            infinityTypeCandidates: ["Rental Expenses", "Rent", "Board"],
            amount: rentMonthly,
            frequency: "Monthly",
            description: "Rental Expense",
            continuePostSettlement: ownerOccupied ? "No" : "Yes",
            ownership: ownerPct,
            applicantScope: "household",
            source: "template (renting)"
          });
        }
        return rows;
      })(),
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
      dateCreditGuideProvided: dateToAu(firstPresent(caseData.factFind?.dateCreditGuideProvided, caseData.loan?.dateCreditGuideProvided, caseData.createdAt, addDaysAu(0))),
      dateInterviewConducted: dateToAu(firstPresent(caseData.factFind?.dateInterviewConducted, caseData.loan?.dateInterviewConducted, caseData.interviewDate, caseData.createdAt, addDaysAu(0))),
      methodClientInterview: caseData.factFind?.methodClientInterview || "Face to Face",
      methodDocumentIdentification: caseData.factFind?.methodDocumentIdentification || "Face to Face",
      facilityAmount,
      estimatedSettlementDate: dateToAu(firstPresent(caseData.loan?.estimatedSettlementDate, caseData.loan?.settlementDate, caseData.property?.settlementDate, addDaysAu(isPreApproval(caseData) ? 90 : 45))),
      selectedApplicants: applicants.map(fullName),
      objectives: {
        ...selectedObjectives(caseData)
      },
      requirements: {
        ...selectedRequirements(caseData)
      },
      loanObjectiveExplanation: narrative.loanObjectiveExplanation,
      isRefinanceApplication: isRefinance(caseData)
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
