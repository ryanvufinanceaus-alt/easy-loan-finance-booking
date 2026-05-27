import { getTemplate, templateSummary } from "./caseTemplates.mjs";

const currencyPattern = /\$?\s?([0-9]{2,3}(?:,[0-9]{3})+(?:\.\d{2})?|[0-9]{4,6}(?:\.\d{2})?)/g;
const bsbPattern = /\b\d{3}[- ]?\d{3}\b/;
const licencePattern = /\b(?:licen[cs]e|driver|passport|medicare)\b/i;
const emailPattern = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;
const auMobilePattern = /\b(?:\+?61\s?4|04)\d(?:[\s-]?\d){7}\b/;
const dobPattern = /\b(?:date of birth|dob|birth date)\s*[:\-]?\s*([0-3]?\d[\/\-. ][0-1]?\d[\/\-. ](?:19|20)\d{2}|(?:19|20)\d{2}[\/\-. ][0-1]?\d[\/\-. ][0-3]?\d)\b/i;
const abnPattern = /\b(?:ABN|Australian Business Number)\s*[:\-]?\s*((?:\d\s*){11})\b/i;
const licenceNoPattern = /\b(?:licen[cs]e|driver'?s? licen[cs]e)\s*(?:no\.?|number)?\s*[:\-]?\s*([A-Z0-9]{5,12})\b/i;
const postcodePattern = /\b(?:NSW|VIC|QLD|SA|WA|TAS|ACT|NT)\s+\d{4}\b/i;

function parseMoney(value) {
  return Number(String(value).replace(/[$,\s]/g, ""));
}

function moneyValues(text) {
  return [...text.matchAll(currencyPattern)]
    .map((match) => parseMoney(match[1]))
    .filter((value) => Number.isFinite(value) && value > 0);
}

function bestMoneyValue(text) {
  const matches = moneyValues(text);
  if (!matches.length) return null;
  return Math.max(...matches);
}

function classifyFile(file, text) {
  const haystack = `${file.originalname} ${text}`.toLowerCase();
  if (haystack.includes("payslip") || haystack.includes("pay slip") || haystack.includes("salary")) return "income";
  if (haystack.includes("bank") || haystack.includes("statement") || bsbPattern.test(haystack)) return "bankStatement";
  if (licencePattern.test(haystack) || haystack.includes("id")) return "identity";
  if (haystack.includes("contract") || haystack.includes("sale")) return "contract";
  return "supporting";
}

function readText(file) {
  const isTextLike = /text|json|csv|xml|html/i.test(file.mimetype) || /\.(txt|csv|json|xml|html)$/i.test(file.originalname);
  if (!isTextLike) return "";
  return file.buffer.toString("utf8").slice(0, 25000);
}

function normaliseDate(value) {
  const parts = String(value).trim().split(/[\/\-. ]+/).filter(Boolean);
  if (parts.length !== 3) return value;
  if (parts[0].length === 4) return `${parts[0]}-${parts[1].padStart(2, "0")}-${parts[2].padStart(2, "0")}`;
  return `${parts[2]}-${parts[1].padStart(2, "0")}-${parts[0].padStart(2, "0")}`;
}

function cleanPhone(value) {
  return String(value).replace(/[^\d+]/g, "");
}

function extractLabelledMoney(text, labels) {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  for (const line of lines) {
    if (!labels.some((label) => line.toLowerCase().includes(label))) continue;
    const amount = bestMoneyValue(line);
    if (amount) return amount;
  }
  return null;
}

function extractAddress(text) {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  return lines.find((line) => postcodePattern.test(line) && /\d/.test(line) && line.length < 140) || null;
}

function suggestion(path, value, source, confidence, reason) {
  return { path, value, source, confidence, reason };
}

function extractFromFile(file) {
  const text = readText(file);
  const type = classifyFile(file, text);
  const moneyValue = text ? bestMoneyValue(text) : null;
  const fields = {};
  const suggestions = [];
  const warnings = [];
  const source = file.originalname;

  if (type === "income" && moneyValue) {
    const labelledIncome =
      extractLabelledMoney(text, ["annual income", "yearly", "salary", "gross income", "company profit before tax", "base salary"]) || moneyValue;
    fields.detectedAnnualIncome = labelledIncome > 20000 ? labelledIncome : labelledIncome * 26;
    suggestions.push(suggestion("applicants.primary.income.baseAnnual", fields.detectedAnnualIncome, source, 0.82, "Income amount detected"));
  }

  const balance = text ? extractLabelledMoney(text, ["closing balance", "available balance", "current balance", "savings", "deposit"]) : null;
  if ((type === "bankStatement" && moneyValue) || balance) {
    const detectedBalance = balance || moneyValue;
    fields.detectedFinancialAsset = detectedBalance;
    suggestions.push(suggestion("assets.cash.value", detectedBalance, source, 0.78, "Bank balance or savings amount detected"));
  }

  const email = text.match(emailPattern)?.[0];
  if (email) {
    fields.email = email;
    suggestions.push(suggestion("applicants.primary.email", email, source, 0.86, "Email detected"));
  }

  const mobile = text.match(auMobilePattern)?.[0];
  if (mobile) {
    fields.mobile = cleanPhone(mobile);
    suggestions.push(suggestion("applicants.primary.mobile", fields.mobile, source, 0.82, "Australian mobile detected"));
  }

  const dob = text.match(dobPattern)?.[1];
  if (dob) {
    fields.dateOfBirth = normaliseDate(dob);
    suggestions.push(suggestion("applicants.primary.dateOfBirth", fields.dateOfBirth, source, 0.8, "DOB label detected"));
  }

  const licence = text.match(licenceNoPattern)?.[1];
  if (licence) {
    fields.driversLicenceNo = licence;
    suggestions.push(suggestion("applicants.primary.id.driversLicenceNo", licence, source, 0.76, "Driver licence number detected"));
  }

  const abn = text.match(abnPattern)?.[1]?.replace(/\s/g, "");
  if (abn) {
    fields.abn = abn;
    suggestions.push(suggestion("applicants.primary.employment.abn", abn, source, 0.78, "ABN detected"));
  }

  const address = text ? extractAddress(text) : null;
  if (address) {
    fields.addressLine = address;
    suggestions.push(suggestion("applicants.primary.address.fullAddress", address, source, 0.66, "Address-like line with Australian state/postcode detected"));
  }

  const mortgageBalance = text ? extractLabelledMoney(text, ["mortgage", "home loan", "loan balance", "current balance"]) : null;
  if (type !== "income" && mortgageBalance) {
    fields.detectedLiabilityBalance = mortgageBalance;
    suggestions.push(suggestion("liabilities.mortgage.balance", mortgageBalance, source, 0.7, "Mortgage or loan balance detected"));
  }

  if (!text && /pdf|image/i.test(file.mimetype)) {
    warnings.push("Binary PDF/image uploaded. OCR or AI extraction is needed for full automatic reading.");
  }

  return {
    fileName: file.originalname,
    mimeType: file.mimetype,
    size: file.size,
    type,
    fields,
    suggestions,
    confidence: suggestions.length ? Math.max(...suggestions.map((item) => item.confidence)) : 0.25,
    warnings
  };
}

function presetNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function parseTemplateOverrides(value) {
  if (!value) return null;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

export function buildDocumentDraft(files = [], options = {}) {
  const documents = files.map(extractFromFile);
  const selectedTemplate = getTemplate(options.templateId);
  const templateOverrides = parseTemplateOverrides(options.templateOverrides);
  const template = selectedTemplate ? { ...selectedTemplate, ...(templateOverrides || {}) } : templateOverrides;
  const detectedIncome = documents.map((doc) => doc.fields.detectedAnnualIncome).find(Boolean);
  const detectedFinancialAsset = documents.map((doc) => doc.fields.detectedFinancialAsset).find(Boolean);
  const hemMonthly = presetNumber(options.hemMonthly, template?.defaults?.hemMonthly || 4000);
  const financialAssetBuffer = presetNumber(options.financialAssetBuffer, detectedFinancialAsset || template?.defaults?.financialAssetBuffer || 30000);
  const fieldSuggestions = documents.flatMap((doc) => doc.suggestions);

  return {
    preparedAt: new Date().toISOString(),
    template: template ? templateSummary(template) : null,
    templateConfig: template || null,
    assumptions: {
      hemMonthly,
      financialAssetBuffer,
      assetSource: detectedFinancialAsset ? "document" : "broker preset",
      expenseSource: "broker preset",
      incomeSource: detectedIncome ? "document" : "crm",
      templateSource: template?.id || null
    },
    extracted: {
      primaryAnnualIncome: detectedIncome || null,
      financialAsset: detectedFinancialAsset || null,
      fieldSuggestions
    },
    documents,
    warnings: documents.flatMap((doc) => doc.warnings.map((message) => ({ fileName: doc.fileName, message })))
  };
}

export function mergeDocumentDraft(caseData, draft) {
  if (!draft) return caseData;

  const merged = structuredClone(caseData);
  const primary = merged.applicants.find((applicant) => applicant.role === "primary");
  const template = draft.templateConfig;

  if (primary && draft.extracted.primaryAnnualIncome) {
    primary.income.baseAnnual = draft.extracted.primaryAnnualIncome;
  }

  if (primary) {
    for (const item of draft.extracted.fieldSuggestions || []) {
      if (item.confidence < 0.8) continue;
      if (item.path === "applicants.primary.email" && !primary.email) primary.email = item.value;
      if (item.path === "applicants.primary.mobile" && !primary.mobile) primary.mobile = item.value;
      if (item.path === "applicants.primary.dateOfBirth" && !primary.dateOfBirth) primary.dateOfBirth = item.value;
      if (item.path === "applicants.primary.id.driversLicenceNo" && !primary.id?.driversLicenceNo) {
        primary.id = { ...(primary.id || {}), driversLicenceNo: item.value };
      }
      if (item.path === "applicants.primary.employment.abn" && !primary.employment?.abn) {
        primary.employment = { ...(primary.employment || {}), abn: item.value };
      }
    }
  }

  const hasCashAsset = merged.assets.some((asset) => asset.type === "Cash" && asset.description === "Document/Preset Financial Asset");
  if (!hasCashAsset) {
    merged.assets.push({
      type: "Cash",
      description: "Document/Preset Financial Asset",
      value: draft.assumptions.financialAssetBuffer
    });
  }

  if (template?.defaults?.expenses) {
    merged.expenses = { ...merged.expenses, ...template.defaults.expenses };
  }

  if (template?.defaults?.currentHousingSituation) {
    merged.clientProfile = { ...(merged.clientProfile || {}), currentHousingSituation: template.defaults.currentHousingSituation };
  }

  if (template?.defaults?.loanPurpose) {
    merged.property = { ...merged.property, purpose: merged.property?.purpose || template.defaults.loanPurpose };
  }

  if (template?.defaults) {
    merged.loan = {
      ...merged.loan,
      repaymentType: merged.loan?.repaymentType || template.defaults.repaymentType,
      productPreference: merged.loan?.productPreference || template.defaults.productPreference,
      loanTermYears: merged.loan?.loanTermYears || template.defaults.loanTermYears,
      offsetRequested: merged.loan?.offsetRequested ?? template.defaults.offsetRequested,
      preApproval: merged.loan?.preApproval ?? template.defaults.preApproval
    };
  }

  merged.expenses.livingMonthly = draft.assumptions.hemMonthly;
  merged.documentIntake = draft;
  merged.selectedTemplate = template || null;
  return merged;
}
