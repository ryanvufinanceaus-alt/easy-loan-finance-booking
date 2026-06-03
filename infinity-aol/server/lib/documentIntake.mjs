import { getTemplate, templateSummary } from "./caseTemplates.mjs";

const currencyPattern = /\$?\s?([0-9]{2,3}(?:,[0-9]{3})+(?:\.\d{2})?|[0-9]{4,6}(?:\.\d{2})?)/g;
const bsbPattern = /\b\d{3}[- ]?\d{3}\b/;
const licencePattern = /\b(?:licen[cs]e|driver|passport|medicare)\b/i;
const emailPattern = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;
const auMobilePattern = /\b(?:\+?61\s?4|04)\d(?:[\s-]?\d){7}\b/;
const dobPattern = /\b(?:date of birth|dob|birth date)\s*[:\-]?\s*([0-3]?\d[\/\-. ][0-1]?\d[\/\-. ](?:19|20)\d{2}|(?:19|20)\d{2}[\/\-. ][0-1]?\d[\/\-. ][0-3]?\d)\b/i;
const abnPattern = /\b(?:ABN|Australian Business Number)\s*[:\-]?\s*((?:\d\s*){11})\b/i;
const datePattern = /([0-3]?\d[\/\-. ][0-1]?\d[\/\-. ](?:19|20)\d{2}|(?:19|20)\d{2}[\/\-. ][0-1]?\d[\/\-. ][0-3]?\d)/;
const licenceNoPattern = /\b(?:licen[cs]e|driver'?s? licen[cs]e|licence)\s*(?:no\.?|number|num)?\s*[:\-]?\s*([A-Z0-9]{5,12})\b/i;
const licenceExpiryPattern = /\b(?:expiry|expires|valid\s*(?:to|until)|licen[cs]e expiry)\s*(?:date)?\s*[:\-]?\s*([0-3]?\d[\/\-. ][0-1]?\d[\/\-. ](?:19|20)\d{2}|(?:19|20)\d{2}[\/\-. ][0-1]?\d[\/\-. ][0-3]?\d)\b/i;
const licenceCardPattern = /\b(?:card\s*(?:no\.?|number)|licen[cs]e card|document\s*(?:no\.?|number))\s*[:\-]?\s*([A-Z0-9]{6,14})\b/i;
const licenceClassPattern = /\b(?:class|licen[cs]e class)\s*[:\-]?\s*([A-Z0-9]{1,3})\b/i;
const statePattern = /\b(?:state|licen[cs]e state)\s*[:\-]?\s*(NSW|VIC|QLD|SA|WA|TAS|ACT|NT)\b/i;
const postcodePattern = /\b(?:NSW|VIC|QLD|SA|WA|TAS|ACT|NT)\s+\d{4}\b/i;
const structuredKeyPattern = /^\s*([A-Z][A-Z0-9 /&().'-]{2,50})\s*[:=]\s*(.+?)\s*$/i;

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

function rolePath(role, fieldPath) {
  return `applicants.${role}.${fieldPath}`;
}

function detectApplicantRole(source, text) {
  const haystack = `${source} ${text.slice(0, 1000)}`.toLowerCase();
  if (/\b(applicant\s*2|borrower\s*2|secondary|spouse|partner|co-?applicant|co-?borrower|joint)\b/.test(haystack)) return "secondary";
  return "primary";
}

function dateAfterLabel(text, labels) {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  for (const line of lines) {
    const lower = line.toLowerCase();
    if (!labels.some((label) => lower.includes(label))) continue;
    const date = line.match(datePattern)?.[1];
    if (date) return normaliseDate(date);
  }
  return null;
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

function structuredSuggestions(text, source, defaultRole) {
  const suggestions = [];
  let role = defaultRole;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const lower = line.toLowerCase();
    if (/\b(applicant\s*2|borrower\s*2|secondary|spouse|partner|co-?applicant|co-?borrower)\b/.test(lower)) role = "secondary";
    if (/\b(applicant\s*1|borrower\s*1|primary|main applicant)\b/.test(lower)) role = "primary";

    const match = line.match(structuredKeyPattern);
    if (!match) continue;
    const key = match[1].trim().toLowerCase();
    const value = match[2].trim();
    const moneyValue = bestMoneyValue(value);

    if (/^(loan amount|facility amount|base amount|requested loan)/.test(key) && moneyValue) {
      suggestions.push(suggestion("loan.loanAmount", moneyValue, source, 0.92, "Structured loan amount"));
    } else if (/(annual income|base salary|base income|salary|company profit before tax|gross income)/.test(key) && moneyValue) {
      suggestions.push(suggestion(rolePath(role, "income.baseAnnual"), moneyValue, source, 0.9, `Structured ${role} income`));
    } else if (/rental income/.test(key) && moneyValue) {
      suggestions.push(suggestion(rolePath(role, "income.rentalAnnual"), moneyValue, source, 0.88, `Structured ${role} rental income`));
    } else if (/(hem|living expense|living expenses)/.test(key) && moneyValue) {
      suggestions.push(suggestion("expenses.livingMonthly", moneyValue, source, 0.88, "Structured HEM/living expenses"));
    } else if (/(financial asset|cash|savings|deposit)/.test(key) && moneyValue) {
      suggestions.push(suggestion("assets.cash.value", moneyValue, source, 0.88, "Structured financial asset"));
    } else if (/(dob|date of birth|birth date)/.test(key)) {
      const date = value.match(datePattern)?.[1] || value;
      suggestions.push(suggestion(rolePath(role, "dateOfBirth"), normaliseDate(date), source, 0.92, `Structured ${role} DOB`));
    } else if (/(driver|licen[cs]e).*?(no|number)/.test(key)) {
      suggestions.push(suggestion(rolePath(role, "id.driversLicenceNo"), value.replace(/\s/g, ""), source, 0.9, `Structured ${role} licence number`));
    } else if (/(card).*?(no|number)/.test(key)) {
      suggestions.push(suggestion(rolePath(role, "id.licenceCardNumber"), value.replace(/\s/g, ""), source, 0.86, `Structured ${role} licence card number`));
    } else if (/(expiry|valid to|valid until)/.test(key)) {
      const date = value.match(datePattern)?.[1] || value;
      suggestions.push(suggestion(rolePath(role, "id.licenceExpiryDate"), normaliseDate(date), source, 0.86, `Structured ${role} licence expiry`));
    } else if (/address/.test(key)) {
      suggestions.push(suggestion(rolePath(role, "address.fullAddress"), value, source, 0.82, `Structured ${role} address`));
    } else if (/email/.test(key) && emailPattern.test(value)) {
      suggestions.push(suggestion(rolePath(role, "email"), value.match(emailPattern)[0], source, 0.9, `Structured ${role} email`));
    } else if (/(mobile|phone)/.test(key) && auMobilePattern.test(value)) {
      suggestions.push(suggestion(rolePath(role, "mobile"), cleanPhone(value.match(auMobilePattern)[0]), source, 0.88, `Structured ${role} mobile`));
    } else if (/abn/.test(key)) {
      suggestions.push(suggestion(rolePath(role, "employment.abn"), value.replace(/\s/g, ""), source, 0.86, `Structured ${role} ABN`));
    } else if (/employer/.test(key)) {
      suggestions.push(suggestion(rolePath(role, "employment.employerName"), value, source, 0.82, `Structured ${role} employer`));
    } else if (/occupation/.test(key)) {
      suggestions.push(suggestion(rolePath(role, "employment.occupation"), value, source, 0.8, `Structured ${role} occupation`));
    }
  }
  return suggestions;
}

function extractFromFile(file) {
  const text = readText(file);
  const type = classifyFile(file, text);
  const moneyValue = text ? bestMoneyValue(text) : null;
  const fields = {};
  const suggestions = [];
  const warnings = [];
  const source = file.originalname;
  const role = detectApplicantRole(source, text);

  if (type === "income" && moneyValue) {
    const labelledIncome =
      extractLabelledMoney(text, ["annual income", "yearly", "salary", "gross income", "company profit before tax", "base salary"]) || moneyValue;
    fields.detectedAnnualIncome = labelledIncome > 20000 ? labelledIncome : labelledIncome * 26;
    suggestions.push(suggestion(rolePath(role, "income.baseAnnual"), fields.detectedAnnualIncome, source, 0.82, `${role} income amount detected`));
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
    suggestions.push(suggestion(rolePath(role, "email"), email, source, 0.86, `${role} email detected`));
  }

  const mobile = text.match(auMobilePattern)?.[0];
  if (mobile) {
    fields.mobile = cleanPhone(mobile);
    suggestions.push(suggestion(rolePath(role, "mobile"), fields.mobile, source, 0.82, `${role} Australian mobile detected`));
  }

  const dob = text.match(dobPattern)?.[1];
  if (dob) {
    fields.dateOfBirth = normaliseDate(dob);
    suggestions.push(suggestion(rolePath(role, "dateOfBirth"), fields.dateOfBirth, source, 0.8, `${role} DOB label detected`));
  }

  const licence = text.match(licenceNoPattern)?.[1];
  if (licence) {
    fields.driversLicenceNo = licence;
    suggestions.push(suggestion(rolePath(role, "id.driversLicenceNo"), licence, source, 0.76, `${role} driver licence number detected`));
  }

  const licenceExpiry = text.match(licenceExpiryPattern)?.[1] || dateAfterLabel(text, ["expiry", "expires", "valid to", "valid until"]);
  if (licenceExpiry) {
    fields.licenceExpiryDate = normaliseDate(licenceExpiry);
    suggestions.push(suggestion(rolePath(role, "id.licenceExpiryDate"), fields.licenceExpiryDate, source, 0.78, `${role} licence expiry detected`));
  }

  const licenceCard = text.match(licenceCardPattern)?.[1];
  if (licenceCard) {
    fields.licenceCardNumber = licenceCard;
    suggestions.push(suggestion(rolePath(role, "id.licenceCardNumber"), licenceCard, source, 0.72, `${role} licence card number detected from back side`));
  }

  const licenceClass = text.match(licenceClassPattern)?.[1];
  if (licenceClass) {
    fields.licenceClass = licenceClass;
    suggestions.push(suggestion(rolePath(role, "id.licenceClass"), licenceClass, source, 0.7, `${role} licence class detected`));
  }

  const licenceState = text.match(statePattern)?.[1];
  if (licenceState) {
    fields.licenceState = licenceState;
    suggestions.push(suggestion(rolePath(role, "id.licenceState"), licenceState, source, 0.7, `${role} licence state detected`));
  }

  const abn = text.match(abnPattern)?.[1]?.replace(/\s/g, "");
  if (abn) {
    fields.abn = abn;
    suggestions.push(suggestion(rolePath(role, "employment.abn"), abn, source, 0.78, `${role} ABN detected`));
  }

  const address = text ? extractAddress(text) : null;
  if (address) {
    fields.addressLine = address;
    suggestions.push(suggestion(rolePath(role, "address.fullAddress"), address, source, 0.66, `${role} address-like line with Australian state/postcode detected`));
  }

  const mortgageBalance = text ? extractLabelledMoney(text, ["mortgage", "home loan", "loan balance", "current balance"]) : null;
  if (type !== "income" && mortgageBalance) {
    fields.detectedLiabilityBalance = mortgageBalance;
    suggestions.push(suggestion("liabilities.mortgage.balance", mortgageBalance, source, 0.7, "Mortgage or loan balance detected"));
  }

  if (!text && /pdf|image/i.test(file.mimetype)) {
    warnings.push("Binary PDF/image uploaded. Run browser OCR or upload a text/CSV intake sheet for full automatic reading.");
  }

  if (text) suggestions.push(...structuredSuggestions(text, source, role));

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

function parseManualIntake(value) {
  if (!value) return {};
  if (typeof value === "object") return value;
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}

function manualSuggestion(path, value, reason) {
  if (value === undefined || value === null || value === "") return null;
  return suggestion(path, value, "broker quick review", 0.96, reason);
}

function manualMoneySuggestion(path, value, reason) {
  const number = presetNumber(value, 0);
  if (!number) return null;
  return manualSuggestion(path, number, reason);
}

function splitManualName(fullName = "") {
  const parts = String(fullName || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return {};
  if (parts.length === 1) return { firstName: parts[0], lastName: "" };
  return {
    firstName: parts.slice(0, -1).join(" "),
    lastName: parts.at(-1)
  };
}

export function buildDocumentDraft(files = [], options = {}) {
  const documents = files.map(extractFromFile);
  const selectedTemplate = getTemplate(options.templateId);
  const templateOverrides = parseTemplateOverrides(options.templateOverrides);
  const manualIntake = parseManualIntake(options.manualIntake);
  const template = selectedTemplate ? { ...selectedTemplate, ...(templateOverrides || {}) } : templateOverrides;
  const primaryName = splitManualName(manualIntake.primaryApplicantName);
  const secondaryName = splitManualName(manualIntake.secondaryApplicantName);
  const fieldSuggestions = documents.flatMap((doc) => doc.suggestions);
  const manualSuggestions = [
    manualMoneySuggestion("loan.loanAmount", manualIntake.loanAmount, "Broker typed loan amount"),
    manualMoneySuggestion("expenses.livingMonthly", manualIntake.hemMonthly, "Broker typed HEM/living expense"),
    manualMoneySuggestion("assets.cash.value", manualIntake.financialAssetBuffer, "Broker typed financial asset buffer"),
    manualSuggestion("applicants.primary.firstName", primaryName.firstName, "Broker confirmed primary applicant name"),
    manualSuggestion("applicants.primary.lastName", primaryName.lastName, "Broker confirmed primary applicant surname"),
    manualMoneySuggestion("applicants.primary.income.baseAnnual", manualIntake.primaryAnnualIncome, "Broker typed primary annual income"),
    manualSuggestion("applicants.primary.dateOfBirth", manualIntake.primaryDateOfBirth, "Broker typed primary DOB"),
    manualSuggestion("applicants.primary.mobile", manualIntake.primaryMobile, "Broker typed primary mobile"),
    manualSuggestion("applicants.primary.email", manualIntake.primaryEmail, "Broker typed primary email"),
    manualSuggestion("applicants.secondary.firstName", secondaryName.firstName, "Broker confirmed secondary applicant name"),
    manualSuggestion("applicants.secondary.lastName", secondaryName.lastName, "Broker confirmed secondary applicant surname"),
    manualMoneySuggestion("applicants.secondary.income.baseAnnual", manualIntake.secondaryAnnualIncome, "Broker typed secondary annual income"),
    manualSuggestion("applicants.secondary.dateOfBirth", manualIntake.secondaryDateOfBirth, "Broker typed secondary DOB"),
    manualSuggestion("applicants.secondary.mobile", manualIntake.secondaryMobile, "Broker typed secondary mobile"),
    manualSuggestion("applicants.secondary.email", manualIntake.secondaryEmail, "Broker typed secondary email"),
    manualSuggestion("applicants.primary.id.driversLicenceNo", manualIntake.primaryDriversLicenceNo, "Broker typed primary licence number"),
    manualSuggestion("applicants.primary.id.licenceCardNumber", manualIntake.primaryLicenceCardNumber, "Broker typed primary licence card number"),
    manualSuggestion("applicants.primary.id.licenceExpiryDate", manualIntake.primaryLicenceExpiryDate, "Broker typed primary licence expiry"),
    manualSuggestion("applicants.secondary.id.driversLicenceNo", manualIntake.secondaryDriversLicenceNo, "Broker typed secondary licence number"),
    manualSuggestion("applicants.secondary.id.licenceCardNumber", manualIntake.secondaryLicenceCardNumber, "Broker typed secondary licence card number"),
    manualSuggestion("applicants.secondary.id.licenceExpiryDate", manualIntake.secondaryLicenceExpiryDate, "Broker typed secondary licence expiry")
  ].filter(Boolean);
  const allSuggestions = [...fieldSuggestions, ...manualSuggestions];
  const detectedIncome = allSuggestions.find((item) => item.path === "applicants.primary.income.baseAnnual")?.value;
  const detectedFinancialAsset = documents.map((doc) => doc.fields.detectedFinancialAsset).find(Boolean);
  const hemMonthly = presetNumber(manualIntake.hemMonthly || options.hemMonthly, template?.defaults?.hemMonthly || 4000);
  const financialAssetBuffer = presetNumber(manualIntake.financialAssetBuffer || options.financialAssetBuffer, detectedFinancialAsset || template?.defaults?.financialAssetBuffer || 30000);

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
      fieldSuggestions: allSuggestions
    },
    manualIntake,
    documents,
    warnings: documents.flatMap((doc) => doc.warnings.map((message) => ({ fileName: doc.fileName, message })))
  };
}

function applicantForPath(merged, role) {
  return merged.applicants.find((applicant) => applicant.role === role) || null;
}

function ensureSecondaryApplicant(merged, draft) {
  const manualIntake = draft?.manualIntake || {};
  const wantsSecondary =
    manualIntake.hasSecondApplicant === "Yes" ||
    manualIntake.secondaryApplicantName ||
    manualIntake.secondaryAnnualIncome ||
    manualIntake.secondaryDriversLicenceNo ||
    manualIntake.secondaryDateOfBirth;
  if (!wantsSecondary || applicantForPath(merged, "secondary")) return;
  const primary = applicantForPath(merged, "primary") || {};
  merged.applicants.push({
    role: "secondary",
    firstName: "",
    middleName: "",
    lastName: "",
    dateOfBirth: "",
    maritalStatus: primary.maritalStatus || "",
    residencyStatus: "",
    dependants: primary.dependants || 0,
    email: "",
    mobile: "",
    address: primary.address ? { ...primary.address } : {},
    employment: {},
    income: {}
  });
}

function splitAddress(fullAddress) {
  const match = String(fullAddress).match(/^(.*?),?\s+([A-Za-z ]+)\s+(NSW|VIC|QLD|SA|WA|TAS|ACT|NT)\s+(\d{4})(?:,\s*Australia)?$/i);
  if (!match) return { line1: fullAddress };
  return {
    line1: match[1].trim(),
    suburb: match[2].trim(),
    state: match[3].toUpperCase(),
    postcode: match[4],
    country: "Australia"
  };
}

function applySuggestion(merged, item) {
  if (item.confidence < 0.72) return;
  if (item.path === "loan.loanAmount") {
    merged.loan = { ...(merged.loan || {}), loanAmount: Number(item.value) || merged.loan?.loanAmount };
    return;
  }
  if (item.path === "expenses.livingMonthly") {
    merged.expenses = { ...(merged.expenses || {}), livingMonthly: Number(item.value) || merged.expenses?.livingMonthly };
    return;
  }

  const applicantMatch = item.path.match(/^applicants\.(primary|secondary)\.(.+)$/);
  if (!applicantMatch) return;
  const applicant = applicantForPath(merged, applicantMatch[1]);
  if (!applicant) return;
  const fieldPath = applicantMatch[2];
  if (fieldPath === "firstName" && item.value) applicant.firstName = item.value;
  if (fieldPath === "lastName" && item.value) applicant.lastName = item.value;
  if (fieldPath === "email" && (!applicant.email || item.confidence >= 0.9)) applicant.email = item.value;
  if (fieldPath === "mobile" && (!applicant.mobile || item.confidence >= 0.9)) applicant.mobile = item.value;
  if (fieldPath === "dateOfBirth" && (!applicant.dateOfBirth || item.confidence >= 0.9)) applicant.dateOfBirth = item.value;
  if (fieldPath === "income.baseAnnual") applicant.income = { ...(applicant.income || {}), baseAnnual: Number(item.value) || 0 };
  if (fieldPath === "income.rentalAnnual") applicant.income = { ...(applicant.income || {}), rentalAnnual: Number(item.value) || 0 };
  if (fieldPath.startsWith("id.")) {
    const key = fieldPath.replace("id.", "");
    applicant.id = { ...(applicant.id || {}), [key]: item.value };
  }
  if (fieldPath === "address.fullAddress" && item.confidence >= 0.8) applicant.address = splitAddress(item.value);
  if (fieldPath.startsWith("employment.")) {
    const key = fieldPath.replace("employment.", "");
    applicant.employment = { ...(applicant.employment || {}), [key]: item.value };
  }
}

export function mergeDocumentDraft(caseData, draft) {
  if (!draft) return caseData;

  const merged = structuredClone(caseData);
  const template = draft.templateConfig;

  if (draft.manualIntake?.hasSecondApplicant === "No") {
    merged.applicants = merged.applicants.filter((applicant) => applicant.role !== "secondary");
  }
  ensureSecondaryApplicant(merged, draft);

  for (const item of draft.extracted.fieldSuggestions || []) {
    applySuggestion(merged, item);
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
