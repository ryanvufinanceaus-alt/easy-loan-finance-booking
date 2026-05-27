import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const userTemplatePath = path.resolve(__dirname, "../data/userTemplates.json");

const defaultTemplates = [
  {
    id: "single-investor-preapproval",
    name: "Single Investor Pre-Approval",
    description: "Single borrower buying an investment property with variable P&I, redraw, and offset.",
    applicantMode: "single",
    scenario: "investment_purchase",
    defaults: {
      hemMonthly: 3000,
      financialAssetBuffer: 30000,
      currentHousingSituation: "Own Home Mortgage",
      loanPurpose: "Purchase Investment Property",
      repaymentType: "Principal and Interest",
      productPreference: "Variable",
      loanTermYears: 30,
      offsetRequested: true,
      preApproval: true,
      expenses: {
        livingMonthly: 3000,
        rentMonthly: 0,
        educationMonthly: 0,
        insuranceMonthly: 200,
        transportMonthly: 500,
        otherMonthly: 2300
      }
    },
    loanFeatures: [
      { priority: 1, feature: "Variable Rate", reason: "The client wants flexibility if interest rates decrease." },
      { priority: 2, feature: "Redraw", reason: "Gain access to funds if required." },
      { priority: 3, feature: "P & I Repayments", reason: "The client prefers to reduce principal over the loan term." },
      { priority: 4, feature: "Offset", reason: "To save interest charged." },
      { priority: 5, feature: "Monthly Repayments", reason: "Personal preference and easier monthly budgeting." }
    ],
    narrativeOverrides: {
      loanObjectiveExplanation: "{Client} would like to buy {possessive} investment property.",
      circumstancesObjectivesPriorities:
        "{Client} {be} seeking pre-approval to purchase an investment property. {Subject} {be} looking to have the loan for {loanTerm} years; however {subject} may be able to pay down sooner in the future if {subject} {be} in a position to. The applicant {be} working and earning good income. The applicant does not foresee any changes to {possessive} financial position that may affect {possessive} ability to repay the home loan.\n{lender} was chosen because they provide stronger servicing and offer competitive rates.\n\n{Client} chooses a variable option to enable flexibility in reducing debt if {subject} accumulates extra funds during this period. Also, {client} would like to use the redraw option if {subject} needs to gain access to the funds. {Client} prefers a {repayment} option because {subject} would like to pay down the loan over the period of {loanTerm} years to reduce the debt. The repayment monthly is more suitable for {client} to budget.",
      financialAwarenessPractices:
        "{Client} already has experience with mortgage products. Loan terms and key features have been fully explained and understood.\n{Client} has a good record of saving. {Client} {be} living within {possessive} means and can save most of {possessive} income.",
      lender:
        "{lender} was chosen because they provide a stronger service and better interest rate for the client. Other lenders do not give enough borrowing capacity and better interest rate for clients to purchase the property {subject} wants.",
      loanAmount: "The loan amount can be serviced by the applicant and is enough for {object} to complete the purchase.",
      interestRate: "Variable rate to take advantage of when the interest rate decreases.",
      loanStructure:
        "{Client} {be} seeking pre-approval to purchase an investment property. {Subject} {be} looking to have the loan for {loanTerm} years; however {subject} may be able to pay down sooner in the future if {subject} {be} in a position to.\nThe applicant {be} working and earning a good income. The applicant does not foresee any changes to {possessive} financial position that may affect {possessive} ability to repay the home loan.\n\n{Client} chooses a variable option to enable flexibility in reducing debt if {subject} accumulates extra funds during this period. Also, {client} would like to use the redraw option if {subject} needs to gain access to the fund. {Client} prefers a {repayment} option because {subject} would like to pay down the loan in a period of {loanTerm} years to reduce the debt. The repayment of the monthly amount is more suitable for {client} to budget.",
      goalsObjectives:
        "{Client} {be} seeking pre-approval to purchase an investment property. {Subject} {be} looking to have the loan for {loanTerm} years; however {subject} may be able to pay down sooner in the future if {subject} {be} in a position to.\nThe applicant {be} working and earning a good income. The applicant does not foresee any changes to {possessive} financial position that may affect {possessive} ability to repay the home loan.\n\n{Client} chooses a variable option to enable flexibility in reducing debt if {subject} accumulates extra funds during this period. Also, {client} would like to use the redraw option if {subject} needs to gain access to the funds. {Client} prefers a {repayment} option because {subject} would like to pay down the loan over the period of {loanTerm} years to reduce the debt. The repayment of the monthly amount is more suitable for {client} to budget.",
      loanFeatures:
        "{Subject} {be} looking to have the loan for {loanTerm} years; however {client} may be able to pay down sooner in the future if {subject} {be} in a position to.\nThe applicant {be} working and earning a good income. The applicant does not foresee any changes to {possessive} financial position that may affect {possessive} ability to repay the home loan.\n\n{Client} chooses a variable option to enable flexibility in reducing debt if {subject} accumulates extra funds during this period. Also, {client} would like to use the redraw option if {subject} needs to gain access to the funds. {Client} prefers a {repayment} option because {subject} would like to pay down the loan in a period of {loanTerm} years to reduce the debt. The repayment of the monthly amount is more suitable for {client} to budget.",
      commissionsConflict: "No conflict of interest has been identified. Standard lender commissions and referral fees have been disclosed where applicable."
    },
    requiredDocs: ["Drivers licence", "Income evidence", "Bank statements", "Contract of sale or property details"]
  },
  {
    id: "couple-owner-occupied-purchase",
    name: "Couple Owner Occupied Purchase",
    description: "Two borrowers buying a home with standard variable P&I and offset.",
    applicantMode: "couple",
    scenario: "owner_purchase",
    defaults: {
      hemMonthly: 5000,
      financialAssetBuffer: 40000,
      currentHousingSituation: "Renting",
      loanPurpose: "Purchase Owner Occupied Dwelling",
      repaymentType: "Principal and Interest",
      productPreference: "Variable",
      loanTermYears: 30,
      offsetRequested: true,
      preApproval: false,
      expenses: {
        livingMonthly: 5000,
        rentMonthly: 0,
        educationMonthly: 500,
        insuranceMonthly: 350,
        transportMonthly: 700,
        otherMonthly: 700
      }
    },
    loanFeatures: [
      { priority: 1, feature: "Variable Rate", reason: "The clients want flexibility with repayments and future rate movements." },
      { priority: 2, feature: "Offset", reason: "To reduce interest charged while keeping savings accessible." },
      { priority: 3, feature: "P & I Repayments", reason: "The clients prefer to pay down the loan from settlement." },
      { priority: 4, feature: "Monthly Repayments", reason: "Monthly repayments align with household budgeting." },
      { priority: 5, feature: "Redraw", reason: "Access to additional repayments if needed." }
    ],
    narrativeOverrides: {
      loanObjectiveExplanation: "{Client} would like to buy {possessive} owner occupied property.",
      circumstancesObjectivesPriorities:
        "{Client} {be} seeking finance to purchase an owner occupied property. {Subject} {be} looking for a loan structure that supports stable household budgeting and future flexibility. The applicants are working and earning stable income. They do not foresee any changes to their financial position that may affect their ability to repay the home loan.\n\n{Client} chooses a variable option with offset and redraw to keep flexibility while reducing interest charged. {Client} prefers a {repayment} option because they would like to pay down the loan over the period of {loanTerm} years.",
      financialAwarenessPractices:
        "{Client} understand the key mortgage features and loan terms that have been discussed. They have a good savings record and the proposed loan structure suits their household budget.",
      lender:
        "{lender} was selected because the product features and serviceability outcome match the clients' requirements, including flexibility, offset, redraw, and competitive repayments.",
      loanAmount: "The loan amount has been assessed against the clients' funding position and is enough to complete the purchase.",
      interestRate: "Variable rate was selected to provide flexibility with future repayment and rate movements.",
      loanStructure:
        "{Client} requested a {repayment} loan over {loanTerm} years with offset and redraw. This structure provides flexibility while supporting the clients' objective to reduce debt over time.",
      goalsObjectives:
        "{Client} {be} buying an owner occupied property and want a loan structure that is affordable, flexible, and suitable for long-term household budgeting.",
      loanFeatures:
        "{Client} requested loan features that provide flexibility in repaying the loan ahead of schedule. Offset and redraw allow surplus funds to remain accessible while reducing interest charged where possible.",
      commissionsConflict: "No conflict of interest has been identified. Standard lender commissions and any referral fees have been disclosed where applicable."
    },
    requiredDocs: ["IDs for both applicants", "Payslips or income evidence", "Bank statements", "Contract of sale"]
  },
  {
    id: "refinance-cashout",
    name: "Refinance / Cash Out",
    description: "Refinance existing loan, review equity release purpose, and map existing mortgage details.",
    applicantMode: "single_or_couple",
    scenario: "refinance",
    defaults: {
      hemMonthly: 4000,
      financialAssetBuffer: 30000,
      loanPurpose: "Refinance",
      repaymentType: "Principal and Interest",
      productPreference: "Variable",
      loanTermYears: 30,
      offsetRequested: true,
      preApproval: false,
      expenses: {
        livingMonthly: 4000,
        rentMonthly: 0,
        educationMonthly: 0,
        insuranceMonthly: 300,
        transportMonthly: 600,
        otherMonthly: 700
      }
    },
    loanFeatures: [
      { priority: 1, feature: "Variable Rate", reason: "The client wants flexibility with future repayment changes." },
      { priority: 2, feature: "Offset", reason: "To reduce interest charged and keep surplus funds accessible." },
      { priority: 3, feature: "Redraw", reason: "Access to extra repayments if required." },
      { priority: 4, feature: "P & I Repayments", reason: "The client prefers to reduce principal over time." },
      { priority: 5, feature: "Monthly Repayments", reason: "Monthly repayments suit the client's budget." }
    ],
    narrativeOverrides: {
      loanObjectiveExplanation: "{Client} would like to refinance {possessive} existing loan.",
      circumstancesObjectivesPriorities:
        "{Client} {be} seeking to refinance {possessive} existing loan to improve the loan structure and access more suitable product features. The applicant has discussed the objective for refinance and confirmed the proposed loan remains affordable.\n\n{Client} prefers a {repayment} option over {loanTerm} years with flexible features such as offset and redraw. The structure supports future repayment flexibility while keeping the loan suitable for the client's budget.",
      financialAwarenessPractices:
        "{Client} already has experience with mortgage products through the existing loan. The refinance purpose, product features, costs, and loan terms have been explained and understood.",
      lender:
        "{lender} was chosen because the product and servicing outcome are suitable for the client's refinance objective and provide the required loan features.",
      loanAmount: "The refinance loan amount can be serviced by the applicant and is sufficient to meet the confirmed refinance objective.",
      interestRate: "Variable rate was selected to maintain flexibility if interest rates decrease or the client wishes to make additional repayments.",
      loanStructure:
        "{Client} requested a refinance loan with a {repayment} repayment type over {loanTerm} years. The proposed structure provides flexibility through offset and redraw while keeping repayments manageable.",
      goalsObjectives:
        "{Client} {be} refinancing to obtain a more suitable loan structure and product features. The client understands the proposed loan, costs, and repayment obligations.",
      loanFeatures:
        "{Client} requested features that provide flexibility in managing repayments, reducing interest, and accessing surplus funds if needed.",
      commissionsConflict: "No conflict of interest has been identified. Standard lender commissions and any referral fees have been disclosed where applicable."
    },
    requiredDocs: ["IDs", "Income evidence", "Existing mortgage statements", "Rates notice", "Bank statements"]
  }
];

function readUserTemplates() {
  try {
    if (!fs.existsSync(userTemplatePath)) return [];
    const parsed = JSON.parse(fs.readFileSync(userTemplatePath, "utf8"));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeUserTemplates(templates) {
  fs.mkdirSync(path.dirname(userTemplatePath), { recursive: true });
  fs.writeFileSync(userTemplatePath, `${JSON.stringify(templates, null, 2)}\n`);
}

function normalizeTemplate(template) {
  return {
    id: String(template.id || "").trim(),
    name: String(template.name || template.id || "").trim(),
    description: String(template.description || "").trim(),
    applicantMode: template.applicantMode || "single_or_couple",
    scenario: template.scenario || "custom",
    defaults: template.defaults || {},
    loanFeatures: Array.isArray(template.loanFeatures) ? template.loanFeatures : [],
    narrativeOverrides: template.narrativeOverrides || {},
    sectionText: template.sectionText || template.narrativeOverrides || {},
    requiredDocs: Array.isArray(template.requiredDocs) ? template.requiredDocs : []
  };
}

export function listTemplates() {
  const userTemplates = readUserTemplates();
  const merged = new Map(defaultTemplates.map((template) => [template.id, normalizeTemplate(template)]));
  for (const template of userTemplates) {
    const normalized = normalizeTemplate(template);
    if (normalized.id) merged.set(normalized.id, normalized);
  }
  return [...merged.values()];
}

export function getTemplate(templateId) {
  if (!templateId) return null;
  return listTemplates().find((template) => template.id === templateId) || null;
}

export function saveTemplate(template) {
  const normalized = normalizeTemplate(template);
  if (!normalized.id) throw new Error("Template id is required.");
  if (!normalized.name) throw new Error("Template name is required.");

  const userTemplates = readUserTemplates().filter((item) => item.id !== normalized.id);
  userTemplates.push(normalized);
  writeUserTemplates(userTemplates);
  return normalized;
}

export function templateSummary(template) {
  if (!template) return null;
  return {
    id: template.id,
    name: template.name,
    scenario: template.scenario,
    hemMonthly: template.defaults?.hemMonthly || null,
    financialAssetBuffer: template.defaults?.financialAssetBuffer || null,
    textFields: Object.keys(template.sectionText || template.narrativeOverrides || {}).length,
    requiredDocs: template.requiredDocs || []
  };
}
