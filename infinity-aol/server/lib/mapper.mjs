import mapping from "../mappings/infinity-aol-v1.json" with { type: "json" };
import { buildInfinityTemplate } from "./infinityTemplate.mjs";
import { buildAolTemplate } from "./aolTemplate.mjs";

const money = (value) => Number(value || 0);

function applicantByRole(caseData, role) {
  return caseData.applicants.find((applicant) => applicant.role === role) || null;
}

function compactApplicant(applicant) {
  if (!applicant) return null;
  const fullName = [applicant.firstName, applicant.middleName, applicant.lastName || applicant.surname].filter(Boolean).join(" ").trim();
  if (!fullName) return null;

  return {
    fullName,
    firstName: applicant.firstName || "",
    middleName: applicant.middleName || "",
    lastName: applicant.lastName || "",
    title: applicant.title || "",
    gender: applicant.gender || "",
    dateOfBirth: applicant.dateOfBirth || "",
    maritalStatus: applicant.maritalStatus || "",
    currentResidentialStatus: applicant.currentResidentialStatus || "",
    currentHousingSituation: applicant.currentHousingSituation || applicant.currentResidentialStatus || "",
    residencyStatus: applicant.residencyStatus || "",
    dependants: applicant.dependants ?? 0,
    email: applicant.email || "",
    mobile: applicant.mobile || "",
    id: applicant.id || {},
    address: applicant.address || {},
    employment: applicant.employment || {},
    income: applicant.income || {}
  };
}

export function buildInfinityPayload(caseData) {
  const primary = compactApplicant(applicantByRole(caseData, "primary"));
  const secondary = compactApplicant(applicantByRole(caseData, "secondary"));
  const expenses = caseData.expenses || {};
  const totalMonthly =
    money(expenses.livingMonthly) +
    money(expenses.rentMonthly) +
    money(expenses.educationMonthly) +
    money(expenses.insuranceMonthly) +
    money(expenses.transportMonthly) +
    money(expenses.otherMonthly);
  const infinity = buildInfinityTemplate(caseData);
  const assetTotal = (caseData.assets || []).reduce((sum, asset) => sum + money(asset.value), 0);
  const serviceability = {
    hemMonthly: expenses.livingMonthly || caseData.documentIntake?.assumptions?.hemMonthly || 0,
    hemConfirmed: expenses.hemConfirmed === true || caseData.documentIntake?.assumptions?.hemConfirmed === true,
    financialAssetBuffer: assetTotal || caseData.documentIntake?.assumptions?.financialAssetBuffer || 0,
    documentIncomeSource: caseData.documentIntake?.assumptions?.incomeSource || "crm",
    expenseSource: caseData.expenseSource || expenses.source || caseData.documentIntake?.assumptions?.expenseSource || "crm",
    assetSource: caseData.assetSource || caseData.documentIntake?.assumptions?.assetSource || "crm"
  };

  return {
    meta: {
      caseId: caseData.id,
      brokerUser: caseData.brokerUser,
      preparedAt: new Date().toISOString(),
      source: "BrokerDesk CRM",
      targetPlatform: mapping.platform,
      mappingVersion: mapping.version,
      template: caseData.documentIntake?.template || caseData.selectedTemplate?.id || null,
      explicitBrokerReviewRequired: true,
      autoSubmitAllowed: false
    },
    applicants: {
      primary,
      secondary
    },
    expenses: {
      ...expenses,
      totalMonthly
    },
    assets: caseData.assets || [],
    liabilities: caseData.liabilities || [],
    property: caseData.property || {},
    loan: caseData.loan || {},
    brokerNotes: caseData.brokerNotes || "",
    documentChecklist: caseData.documentChecklist || [],
    documentIntake: caseData.documentIntake || null,
    serviceability,
    infinity,
    aol: buildAolTemplate({ ...caseData, serviceability }, infinity)
  };
}

export function getMapping() {
  return mapping;
}
