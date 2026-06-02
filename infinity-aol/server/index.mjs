import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import cors from "cors";
import multer from "multer";
import nodemailer from "nodemailer";
import { cases } from "./data/sampleCases.mjs";
import { buildInfinityPayload, getMapping } from "./lib/mapper.mjs";
import { validateInfinityPayload } from "./lib/validation.mjs";
import { buildDocumentDraft, mergeDocumentDraft } from "./lib/documentIntake.mjs";
import { listTemplates, getTemplate, saveTemplate } from "./lib/caseTemplates.mjs";
import { buildTemplateTextPreview } from "./lib/infinityTemplate.mjs";

export const app = express();
const port = Number(process.env.PORT || 8797);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distPath = path.resolve(__dirname, "../dist");
const dataDir = process.env.INFINITY_AOL_DATA_DIR || path.resolve(__dirname, "data");
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
const useSupabaseStore = Boolean(supabaseUrl && supabaseServiceRoleKey);
const storePrefix = process.env.INFINITY_AOL_STORE_PREFIX || "infinity_aol";
const historyPath = path.resolve(dataDir, "caseHistory.json");
const preparedArchivePath = path.resolve(dataDir, "preparedPayloads.json");
const comparisonSnapshotsPath = path.resolve(dataDir, "comparisonSnapshots.json");
const callNotesPath = path.resolve(dataDir, "callNotes.json");
const localCasesPath = path.resolve(dataDir, "localCases.json");
const clientIntakesPath = path.resolve(dataDir, "clientIntakes.json");

const preparedCases = new Map();
const documentDrafts = new Map();
const caseHistory = new Map();
const comparisonSnapshots = new Map();
let callNotes = [];
let localCases = [];
let clientIntakes = [];
let preparedArchive = [];
const auditLog = [];
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024, files: 12 } });
const notificationEmail = process.env.EASYFLOW_NOTIFY_EMAIL || process.env.BOOKING_NOTIFY_EMAIL || process.env.NOTIFY_EMAIL || "hello@easyloanfinance.com.au";
const notificationFrom = process.env.EASYFLOW_FROM_EMAIL || "Easy Loan Finance <ryan.vufinanceaus@gmail.com>";

app.use(cors());
app.use(express.json({ limit: "1mb" }));

function findCase(caseId) {
  return [...localCases, ...cases].find((item) => item.id === caseId);
}

function summarizeCase(caseData) {
  return {
    id: caseData.id,
    status: caseData.status,
    brokerUser: caseData.brokerUser,
    applicantNames: caseData.applicants.map((applicant) => `${applicant.firstName} ${applicant.lastName}`).join(" & "),
    loanAmount: caseData.loan.loanAmount,
    propertyAddress: caseData.property.address || "Missing property address"
  };
}

function readJsonFile(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJsonFile(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function storeKey(name) {
  return `${storePrefix}_${name}`;
}

async function readSupabaseJson(name, fallback) {
  if (!useSupabaseStore) return fallback;
  try {
    const response = await fetch(`${supabaseUrl}/rest/v1/app_kv?key=eq.${encodeURIComponent(storeKey(name))}&select=value`, {
      headers: {
        apikey: supabaseServiceRoleKey,
        authorization: `Bearer ${supabaseServiceRoleKey}`
      }
    });
    if (!response.ok) return fallback;
    const rows = await response.json();
    return rows?.[0]?.value ?? fallback;
  } catch (error) {
    console.warn(`Infinity AOL Supabase read failed for ${name}: ${error.message}`);
    return fallback;
  }
}

async function writeSupabaseJson(name, value) {
  if (!useSupabaseStore) return;
  try {
    const response = await fetch(`${supabaseUrl}/rest/v1/app_kv`, {
      method: "POST",
      headers: {
        apikey: supabaseServiceRoleKey,
        authorization: `Bearer ${supabaseServiceRoleKey}`,
        "content-type": "application/json",
        prefer: "resolution=merge-duplicates,return=minimal"
      },
      body: JSON.stringify({ key: storeKey(name), value, updated_at: new Date().toISOString() })
    });
    if (!response.ok) {
      console.warn(`Infinity AOL Supabase write failed for ${name}: ${response.status}`);
    }
  } catch (error) {
    console.warn(`Infinity AOL Supabase write failed for ${name}: ${error.message}`);
  }
}

async function readStoredJson(name, filePath, fallback) {
  const fileValue = readJsonFile(filePath, fallback);
  return readSupabaseJson(name, fileValue);
}

function writeStoredJson(name, filePath, value) {
  writeJsonFile(filePath, value);
  writeSupabaseJson(name, value);
}

function persistHistory() {
  writeStoredJson("case_history", historyPath, Object.fromEntries(caseHistory.entries()));
}

function persistComparisonSnapshots() {
  writeStoredJson("comparison_snapshots", comparisonSnapshotsPath, Object.fromEntries(comparisonSnapshots.entries()));
}

function persistPrepared(prepared) {
  preparedArchive = preparedArchive.filter((item) => item.token !== prepared.token);
  preparedArchive.unshift(prepared);
  preparedArchive = preparedArchive.slice(0, 100);
  writeStoredJson("prepared_payloads", preparedArchivePath, preparedArchive);
}

function deleteLocalCaseData(caseId) {
  const beforePreparedCount = preparedArchive.length;
  const removedTokens = preparedArchive.filter((item) => item.caseId === caseId).map((item) => item.token);
  preparedArchive = preparedArchive.filter((item) => item.caseId !== caseId);
  for (const [key, prepared] of [...preparedCases.entries()]) {
    if (key === caseId || prepared?.caseId === caseId) preparedCases.delete(key);
  }

  const historyRemoved = caseHistory.get(caseId)?.length || 0;
  const snapshotsRemoved = comparisonSnapshots.get(caseId)?.length || 0;
  const hadDocumentDraft = documentDrafts.delete(caseId);
  caseHistory.delete(caseId);
  comparisonSnapshots.delete(caseId);

  writeStoredJson("prepared_payloads", preparedArchivePath, preparedArchive);
  persistHistory();
  persistComparisonSnapshots();

  return {
    preparedPayloadsRemoved: beforePreparedCount - preparedArchive.length,
    memoryTokensRemoved: removedTokens.length,
    historyEventsRemoved: historyRemoved,
    comparisonSnapshotsRemoved: snapshotsRemoved,
    documentDraftRemoved: hadDocumentDraft
  };
}

async function hydrateStoredData() {
  const loadedHistory = await readStoredJson("case_history", historyPath, {});
  for (const [caseId, events] of Object.entries(loadedHistory)) {
    if (Array.isArray(events)) caseHistory.set(caseId, events);
  }

  const loadedSnapshots = await readStoredJson("comparison_snapshots", comparisonSnapshotsPath, {});
  for (const [caseId, snapshots] of Object.entries(loadedSnapshots)) {
    if (Array.isArray(snapshots)) comparisonSnapshots.set(caseId, snapshots);
  }

  preparedArchive = await readStoredJson("prepared_payloads", preparedArchivePath, []);
  for (const prepared of preparedArchive) {
    if (!prepared?.token || !prepared?.caseId) continue;
    preparedCases.set(prepared.token, prepared);
    if (!preparedCases.has(prepared.caseId)) preparedCases.set(prepared.caseId, prepared);
  }

  callNotes = await readStoredJson("call_notes", callNotesPath, []);
  localCases = await readStoredJson("local_cases", localCasesPath, []);
  clientIntakes = await readStoredJson("client_intakes", clientIntakesPath, []);
}

function persistCallNotes() {
  writeStoredJson("call_notes", callNotesPath, callNotes);
}

function persistLocalCases() {
  writeStoredJson("local_cases", localCasesPath, localCases);
}

function persistClientIntakes() {
  writeStoredJson("client_intakes", clientIntakesPath, clientIntakes);
}

function publicBaseUrl(request) {
  const forwardedProto = request.get("x-forwarded-proto");
  const protocol = forwardedProto || request.protocol || "https";
  const prefix = request.get("x-forwarded-prefix") || "";
  return `${protocol}://${request.get("host")}${prefix.replace(/\/$/, "")}`;
}

function loanFormBaseUrl(request) {
  const configured = process.env.LOAN_FORM_BASE_URL || process.env.CLIENT_LOAN_FORM_BASE_URL;
  if (configured) return configured.replace(/\/$/, "");
  return publicBaseUrl(request);
}

function canReadLoanSubmissions(request) {
  const role = String(request.get("x-elf-role") || "").toLowerCase();
  const accessLevel = String(request.get("x-elf-access-level") || "").toLowerCase();
  if (!role && !accessLevel) return true;
  return role === "admin" || accessLevel === "broker";
}

function smtpConfigured() {
  return Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
}

function mailTransporter(overrides = {}) {
  if (!smtpConfigured()) return null;
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === "true",
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS
    },
    ...overrides
  });
}

async function sendEasyFlowMail(mailOptions) {
  const transporter = mailTransporter();
  if (!transporter || !notificationEmail) return false;
  try {
    await transporter.sendMail(mailOptions);
    return true;
  } catch (error) {
    const host = String(process.env.SMTP_HOST || "").toLowerCase();
    const port = Number(process.env.SMTP_PORT || 587);
    if (!host.includes("smtp.gmail.com") || port === 465) throw error;
    const fallback = mailTransporter({ port: 465, secure: true });
    if (!fallback) throw error;
    await fallback.sendMail(mailOptions);
    return true;
  }
}

function escapeHtml(value = "") {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function moneyLabel(value) {
  const number = Number(value || 0);
  if (!number) return "";
  return new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD", maximumFractionDigits: 0 }).format(number);
}

function factValue(value) {
  if (typeof value === "number") return value ? moneyLabel(value) : "";
  return value || "";
}

function factRows(rows) {
  return rows
    .filter(([, value]) => value !== undefined && value !== null && String(value).trim() !== "")
    .map(([label, value]) => `<tr><th>${escapeHtml(label)}</th><td>${escapeHtml(factValue(value))}</td></tr>`)
    .join("");
}

function factSection(title, rows) {
  const body = factRows(rows);
  if (!body) return "";
  return `<h2>${escapeHtml(title)}</h2><table>${body}</table>`;
}

function intakeFactFindDocument(intake, note = {}) {
  const data = { ...(note || {}), ...(intake?.submission || {}) };
  const clientName = [data.clientName, data.secondApplicantName].filter(Boolean).join(" & ") || "Client";
  const sections = [
    factSection("Applicant Details", [
      ["Client name", data.clientName],
      ["Date of birth", data.dateOfBirth],
      ["Mobile", data.mobile],
      ["Email", data.email],
      ["Preferred language", data.preferredLanguage],
      ["Residency status", data.residencyStatus],
      ["Visa subclass", data.visaSubclass],
      ["Marital status", data.maritalStatus],
      ["Dependants", data.dependants],
      ["Dependent 1 DOB", data.dependant1Dob],
      ["Dependent 2 DOB", data.dependant2Dob],
      ["Dependent 3 DOB", data.dependant3Dob],
      ["Dependent 4 DOB", data.dependant4Dob]
    ]),
    factSection("Second Applicant Details", [
      ["Full name", data.secondApplicantName],
      ["Date of birth", data.secondApplicantDateOfBirth],
      ["Mobile", data.secondApplicantMobile],
      ["Email", data.secondApplicantEmail],
      ["Residency status", data.secondApplicantResidencyStatus],
      ["Visa subclass", data.secondApplicantVisaSubclass],
      ["Marital status", data.secondApplicantMaritalStatus],
      ["Dependants", data.secondApplicantDependants],
      ["Annual income", data.secondAnnualIncome]
    ]),
    factSection("Loan Proposal", [
      ["Loan type", data.loanType],
      ["Loan purpose", data.loanPurpose],
      ["Loan amount required", data.loanAmount],
      ["Property value", data.propertyValue],
      ["Deposit/equity", data.depositEquity],
      ["Property/location", data.propertyLocation],
      ["Timeline", data.timeline],
      ["Loan term years", data.loanTermYears],
      ["Repayment type", data.repaymentType],
      ["Rate preference", data.ratePreference],
      ["Offset requested", data.offsetRequested ? "Yes" : ""]
    ]),
    factSection("Residential History", [
      ["Current address", data.address],
      ["Suburb", data.currentSuburb],
      ["State", data.currentState],
      ["From date", data.currentAddressFromDate],
      ["Residential status", data.currentResidentialStatus],
      ["Previous address", data.previousAddress],
      ["Previous suburb", data.previousSuburb],
      ["Previous state", data.previousState],
      ["Previous postcode", data.previousPostcode],
      ["Previous residential status", data.previousResidentialStatus]
    ]),
    factSection("Second Applicant Residential History", [
      ["Current address", data.secondApplicantAddress],
      ["Suburb", data.secondApplicantCurrentSuburb],
      ["State", data.secondApplicantCurrentState],
      ["From date", data.secondApplicantCurrentAddressFromDate],
      ["Residential status", data.secondApplicantCurrentResidentialStatus],
      ["Previous address", data.secondApplicantPreviousAddress],
      ["Previous suburb", data.secondApplicantPreviousSuburb],
      ["Previous state", data.secondApplicantPreviousState],
      ["Previous postcode", data.secondApplicantPreviousPostcode],
      ["Previous residential status", data.secondApplicantPreviousResidentialStatus]
    ]),
    factSection("Employment And Income", [
      ["Employment type", data.employmentType],
      ["Employer/business", data.employerName],
      ["Occupation", data.occupation],
      ["Employment basis", data.employmentBasis],
      ["Employment from date", data.employmentFromDate],
      ["Business address", data.businessAddress],
      ["Contact name", data.employmentContactName],
      ["Contact number", data.employmentContactNumber],
      ["Annual income", data.annualIncome],
      ["Second applicant income", data.secondAnnualIncome],
      ["Rental income annual", data.rentalIncomeAnnual],
      ["Previous employer/business", data.previousBusinessName],
      ["Previous job title", data.previousJobTitle]
    ]),
    factSection("Second Applicant Employment History", [
      ["Employment type", data.secondApplicantEmploymentType],
      ["Employer/business", data.secondApplicantEmployerName],
      ["Business address", data.secondApplicantBusinessAddress],
      ["Job title", data.secondApplicantJobTitle],
      ["Employment basis", data.secondApplicantEmploymentBasis],
      ["Employment from date", data.secondApplicantEmploymentFromDate],
      ["Contact name", data.secondApplicantEmploymentContactName],
      ["Contact number", data.secondApplicantEmploymentContactNumber],
      ["Previous employer/business", data.secondApplicantPreviousBusinessName],
      ["Previous job title", data.secondApplicantPreviousJobTitle],
      ["Previous employment basis", data.secondApplicantPreviousEmploymentBasis],
      ["Previous from date", data.secondApplicantPreviousEmploymentFromDate],
      ["Previous to date", data.secondApplicantPreviousEmploymentToDate]
    ]),
    factSection("Assets", [
      ["Cash savings", data.cashSavingsAmount],
      ["Cash savings bank", data.cashSavingsBank],
      ["Real estate address", data.realEstateAssetAddress],
      ["Real estate value", data.realEstateAssetValue],
      ["Motor vehicle", data.motorVehicleModelYear],
      ["Motor vehicle value", data.motorVehicleValue],
      ["Home contents item", data.homeContentsItem],
      ["Home contents value", data.homeContentsValue],
      ["Financial asset buffer", data.financialAssetBuffer]
    ]),
    factSection("Liabilities And Expenses", [
      ["Existing debts summary", data.existingDebtsSummary],
      ["Credit issue", data.creditIssue],
      ["General monthly expenses", data.generalExpenses || data.hemMonthly],
      ["Applicant 1 expenses", data.applicant1Expenses],
      ["Applicant 2 expenses", data.applicant2Expenses],
      ["Private health applicant 1", data.applicant1PrivateHealthAmount],
      ["Private health applicant 2", data.applicant2PrivateHealthAmount],
      ["Insurance policies", data.insurancePolicies]
    ]),
    factSection("Commercial / Business", [
      ["Commercial property use", data.commercialPropertyUse],
      ["Business trading name", data.businessTradingName],
      ["ABN/ACN", data.businessAbnAcn],
      ["Business structure", data.businessStructure],
      ["Annual turnover", data.annualBusinessTurnover],
      ["Net profit before tax", data.netProfitBeforeTax],
      ["Commercial security address", data.commercialSecurityAddress],
      ["Commercial lease income", data.commercialLeaseIncome],
      ["Funds purpose", data.commercialFundsPurpose],
      ["GST registered", data.gstRegistered],
      ["Years trading", data.yearsTrading],
      ["Monthly turnover", data.monthlyTurnover]
    ]),
    factSection("Broker Notes", [
      ["Client notes", data.clientNotes],
      ["Quick call notes", note.quickNotes],
      ["Broker assessment", note.brokerAssessment],
      ["Next action", note.nextAction],
      ["Source URL", data.sourceUrl],
      ["Submitted at", intake?.submittedAt]
    ])
  ].filter(Boolean).join("");

  return Buffer.from(`<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>Fact Find - ${escapeHtml(clientName)}</title>
  <style>
    body { color: #16221b; font-family: Arial, sans-serif; font-size: 11pt; line-height: 1.35; }
    h1 { color: #063f2f; font-size: 22pt; margin-bottom: 4px; }
    h2 { border-bottom: 1px solid #b89044; color: #063f2f; font-size: 14pt; margin-top: 20px; padding-bottom: 4px; }
    .meta { color: #59675f; margin-bottom: 18px; }
    table { border-collapse: collapse; width: 100%; }
    th, td { border: 1px solid #d8ded9; padding: 7px 9px; text-align: left; vertical-align: top; }
    th { background: #f4f0e6; width: 34%; }
  </style>
</head>
<body>
  <h1>Easy Loan Finance Fact Find</h1>
  <div class="meta">Generated from Loan Form Submission for ${escapeHtml(clientName)} on ${escapeHtml(new Date().toLocaleString("en-AU"))}</div>
  ${sections}
</body>
</html>`);
}

function factFindFilename(intake, note = {}) {
  const name = (note.clientName || intake?.submission?.clientName || "client").replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "") || "client";
  return `Easy-Loan-Finance-Fact-Find-${name}.doc`;
}

async function notifyCallIntake(note) {
  await sendEasyFlowMail({
    to: notificationEmail,
    from: notificationFrom,
    replyTo: note.email || notificationEmail,
    subject: `New Call Intake - ${note.clientName || "Unnamed client"}`,
    text: [
      "New Client Call Intake saved.",
      "",
      `Client: ${note.clientName || ""}`,
      `Second applicant: ${note.secondApplicantName || ""}`,
      `Phone: ${note.mobile || ""}`,
      `Email: ${note.email || ""}`,
      `Loan: ${note.loanPurpose || note.loanType || ""} ${moneyLabel(note.loanAmount)}`,
      `Next action: ${note.nextAction || ""}`
    ].join("\n"),
    html: `<p>New Client Call Intake saved.</p>${factSection("Call Intake", [["Client", note.clientName], ["Second applicant", note.secondApplicantName], ["Phone", note.mobile], ["Email", note.email], ["Loan", `${note.loanPurpose || note.loanType || ""} ${moneyLabel(note.loanAmount)}`], ["Next action", note.nextAction]])}`
  });
}

async function notifyLoanFormSubmission(intake, note) {
  const attachment = intakeFactFindDocument(intake, note);
  await sendEasyFlowMail({
    to: notificationEmail,
    from: notificationFrom,
    replyTo: intake?.submission?.email || note?.email || notificationEmail,
    subject: `Loan Form Submitted - ${note?.clientName || intake?.submission?.clientName || "Client"}`,
    text: [
      "A client has submitted a Loan Form.",
      "",
      `Client: ${note?.clientName || intake?.submission?.clientName || ""}`,
      `Second applicant: ${note?.secondApplicantName || intake?.submission?.secondApplicantName || ""}`,
      `Phone: ${note?.mobile || intake?.submission?.mobile || ""}`,
      `Email: ${note?.email || intake?.submission?.email || ""}`,
      `Loan purpose: ${note?.loanPurpose || intake?.submission?.loanPurpose || ""}`,
      `Loan amount: ${moneyLabel(note?.loanAmount || intake?.submission?.loanAmount)}`,
      "",
      "A Fact Find document is attached."
    ].join("\n"),
    html: `<p>A client has submitted a Loan Form.</p>${factSection("Loan Form Summary", [["Client", note?.clientName || intake?.submission?.clientName], ["Second applicant", note?.secondApplicantName || intake?.submission?.secondApplicantName], ["Phone", note?.mobile || intake?.submission?.mobile], ["Email", note?.email || intake?.submission?.email], ["Loan purpose", note?.loanPurpose || intake?.submission?.loanPurpose], ["Loan amount", note?.loanAmount || intake?.submission?.loanAmount]])}<p>A Fact Find document is attached.</p>`,
    attachments: [{
      filename: factFindFilename(intake, note),
      content: attachment,
      contentType: "application/msword"
    }]
  });
}

function buildInfinityAolBackup() {
  return {
    exportedAt: new Date().toISOString(),
    service: "infinity-aol",
    storage: useSupabaseStore ? "supabase-app-kv" : "local-json-fallback",
    callNotes,
    clientIntakes,
    localCases,
    preparedPayloads: preparedArchive,
    caseHistory: Object.fromEntries(caseHistory.entries()),
    comparisonSnapshots: Object.fromEntries(comparisonSnapshots.entries()),
    auditLog
  };
}

function applyClientIntakeToNote(note, intake) {
  const next = { ...note };
  const fields = [
    "clientName",
    "secondApplicantName",
    "secondApplicantDateOfBirth",
    "secondApplicantMobile",
    "secondApplicantEmail",
    "secondApplicantResidencyStatus",
    "secondApplicantVisaSubclass",
    "secondApplicantMaritalStatus",
    "secondApplicantDependants",
    "secondApplicantAddress",
    "secondApplicantCurrentSuburb",
    "secondApplicantCurrentState",
    "secondApplicantCurrentAddressFromDate",
    "secondApplicantCurrentResidentialStatus",
    "secondApplicantPreviousAddress",
    "secondApplicantPreviousSuburb",
    "secondApplicantPreviousState",
    "secondApplicantPreviousPostcode",
    "secondApplicantPreviousResidentialStatus",
    "secondApplicantEmploymentType",
    "secondApplicantEmployerName",
    "secondApplicantBusinessAddress",
    "secondApplicantJobTitle",
    "secondApplicantEmploymentBasis",
    "secondApplicantEmploymentFromDate",
    "secondApplicantEmploymentContactName",
    "secondApplicantEmploymentContactNumber",
    "secondApplicantPreviousBusinessName",
    "secondApplicantPreviousJobTitle",
    "secondApplicantPreviousEmploymentBasis",
    "secondApplicantPreviousEmploymentFromDate",
    "secondApplicantPreviousEmploymentToDate",
    "mobile",
    "email",
    "preferredLanguage",
    "loanType",
    "loanPurpose",
    "loanAmount",
    "propertyValue",
    "depositEquity",
    "propertyLocation",
    "timeline",
    "dateOfBirth",
    "address",
    "residencyStatus",
    "visaSubclass",
    "maritalStatus",
    "dependants",
    "dependant1Dob",
    "dependant2Dob",
    "dependant3Dob",
    "dependant4Dob",
    "currentSuburb",
    "currentState",
    "currentAddressFromDate",
    "currentResidentialStatus",
    "previousAddress",
    "previousSuburb",
    "previousState",
    "previousPostcode",
    "previousResidentialStatus",
    "employmentType",
    "employerName",
    "businessAddress",
    "occupation",
    "employmentBasis",
    "employmentFromDate",
    "employmentContactName",
    "employmentContactNumber",
    "previousEmploymentType",
    "previousBusinessName",
    "previousBusinessAddress",
    "previousJobTitle",
    "previousEmploymentBasis",
    "previousEmploymentFromDate",
    "previousEmploymentToDate",
    "annualIncome",
    "secondAnnualIncome",
    "rentalIncomeAnnual",
    "generalExpenses",
    "applicant1Expenses",
    "applicant2Expenses",
    "applicant1PrivateHealth",
    "applicant1PrivateHealthAmount",
    "applicant2PrivateHealth",
    "applicant2PrivateHealthAmount",
    "insurancePolicies",
    "realEstateAssetAddress",
    "realEstateAssetValue",
    "cashSavingsAmount",
    "cashSavingsBank",
    "motorVehicleModelYear",
    "motorVehicleValue",
    "homeContentsItem",
    "homeContentsValue",
    "existingDebtsSummary",
    "creditIssue",
    "propertyType",
    "firstHomeBuyer",
    "fixedRatePreference",
    "variableRatePreference",
    "splitLoanPreference",
    "loanTermYears",
    "repaymentType",
    "ratePreference",
    "offsetRequested",
    "hemMonthly",
    "financialAssetBuffer",
    "commercialPropertyUse",
    "businessTradingName",
    "businessAbnAcn",
    "businessStructure",
    "annualBusinessTurnover",
    "netProfitBeforeTax",
    "commercialSecurityAddress",
    "commercialLeaseIncome",
    "commercialFundsPurpose",
    "vehicleUse",
    "vehicleCondition",
    "saleType",
    "vehicleDescription",
    "vehiclePrice",
    "tradeInDeposit",
    "currentLender",
    "currentLoanBalance",
    "currentRepayment",
    "refinanceReason",
    "businessPurpose",
    "gstRegistered",
    "yearsTrading",
    "monthlyTurnover",
    "sourceUrl"
  ];
  for (const field of fields) {
    if (intake[field] !== undefined && intake[field] !== "") next[field] = intake[field];
  }
  next.quickNotes = [next.quickNotes, intake.clientNotes && `Loan form:\n${intake.clientNotes}`].filter(Boolean).join("\n\n");
  next.status = "Loan form received";
  next.updatedAt = new Date().toISOString();
  return next;
}

function normalizeClientIntakeSubmission(body = {}) {
  return {
    ...body,
    loanAmount: Number(body.loanAmount || 0),
    propertyValue: Number(body.propertyValue || 0),
    depositEquity: Number(body.depositEquity || 0),
    dependants: Number(body.dependants || 0),
    annualIncome: Number(body.annualIncome || 0),
    secondAnnualIncome: Number(body.secondAnnualIncome || 0),
    rentalIncomeAnnual: Number(body.rentalIncomeAnnual || 0),
    generalExpenses: Number(body.generalExpenses || 0),
    applicant1Expenses: Number(body.applicant1Expenses || 0),
    applicant2Expenses: Number(body.applicant2Expenses || 0),
    applicant1PrivateHealthAmount: Number(body.applicant1PrivateHealthAmount || 0),
    applicant2PrivateHealthAmount: Number(body.applicant2PrivateHealthAmount || 0),
    realEstateAssetValue: Number(body.realEstateAssetValue || 0),
    cashSavingsAmount: Number(body.cashSavingsAmount || 0),
    motorVehicleValue: Number(body.motorVehicleValue || 0),
    homeContentsValue: Number(body.homeContentsValue || 0),
    loanTermYears: Number(body.loanTermYears || 30),
    hemMonthly: Number(body.hemMonthly || 0),
    financialAssetBuffer: Number(body.financialAssetBuffer || 0),
    annualBusinessTurnover: Number(body.annualBusinessTurnover || 0),
    netProfitBeforeTax: Number(body.netProfitBeforeTax || 0),
    commercialLeaseIncome: Number(body.commercialLeaseIncome || 0),
    vehiclePrice: Number(body.vehiclePrice || 0),
    tradeInDeposit: Number(body.tradeInDeposit || 0),
    currentLoanBalance: Number(body.currentLoanBalance || 0),
    currentRepayment: Number(body.currentRepayment || 0),
    monthlyTurnover: Number(body.monthlyTurnover || 0),
    offsetRequested: Boolean(body.offsetRequested)
  };
}

function splitName(fullName = "") {
  const parts = String(fullName).trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return { firstName: "", lastName: "" };
  if (parts.length === 1) return { firstName: parts[0], lastName: "" };
  return { firstName: parts.slice(0, -1).join(" "), lastName: parts.at(-1) };
}

function buildLocalCaseFromCallNote(note) {
  const primary = splitName(note.clientName);
  const secondary = splitName(note.secondApplicantName);
  const applicants = [
    {
      role: "primary",
      firstName: primary.firstName,
      middleName: "",
      lastName: primary.lastName,
      dateOfBirth: note.dateOfBirth || "",
      maritalStatus: note.maritalStatus || "Single",
      residencyStatus: note.residencyStatus || "",
      dependants: Number(note.dependants || 0),
      email: note.email || "",
      mobile: note.mobile || "",
      address: { line1: note.address || "", suburb: "", state: "", postcode: "", country: "Australia" },
      employment: {
        status: note.employmentType || "",
        employerName: note.employerName || "",
        occupation: note.occupation || "",
        startDate: ""
      },
      income: { baseAnnual: Number(note.annualIncome || 0), overtimeAnnual: 0, bonusAnnual: 0, rentalAnnual: Number(note.rentalIncomeAnnual || 0) }
    }
  ];

  if (note.secondApplicantName?.trim()) {
    applicants.push({
      role: "secondary",
      firstName: secondary.firstName,
      middleName: "",
      lastName: secondary.lastName,
      dateOfBirth: note.secondApplicantDateOfBirth || "",
      maritalStatus: note.secondApplicantMaritalStatus || note.maritalStatus || "Married",
      residencyStatus: note.secondApplicantResidencyStatus || "",
      dependants: Number(note.secondApplicantDependants || 0),
      email: note.secondApplicantEmail || "",
      mobile: note.secondApplicantMobile || "",
      address: {
        line1: note.secondApplicantAddress || note.address || "",
        suburb: note.secondApplicantCurrentSuburb || "",
        state: note.secondApplicantCurrentState || "",
        postcode: "",
        country: "Australia"
      },
      employment: {
        status: note.secondApplicantEmploymentType || "",
        employerName: note.secondApplicantEmployerName || "",
        occupation: note.secondApplicantJobTitle || "",
        startDate: note.secondApplicantEmploymentFromDate || ""
      },
      income: { baseAnnual: Number(note.secondAnnualIncome || 0), overtimeAnnual: 0, bonusAnnual: 0, rentalAnnual: 0 }
    });
  }

  const assets = [
    { type: "Cash", description: note.cashSavingsBank || "Savings / deposit", value: Number(note.cashSavingsAmount || note.financialAssetBuffer || note.depositEquity || 0) }
  ];
  if (note.realEstateAssetAddress || note.realEstateAssetValue) {
    assets.push({ type: "Real Estate", description: note.realEstateAssetAddress || "Real estate asset", value: Number(note.realEstateAssetValue || 0) });
  }
  if (note.motorVehicleModelYear || note.motorVehicleValue) {
    assets.push({ type: "Motor Vehicle", description: note.motorVehicleModelYear || "Motor vehicle", value: Number(note.motorVehicleValue || 0) });
  }
  if (note.homeContentsItem || note.homeContentsValue) {
    assets.push({ type: "Home Contents", description: note.homeContentsItem || "Home contents", value: Number(note.homeContentsValue || 0) });
  }

  return {
    id: `ELF-DRAFT-${Date.now().toString(36).toUpperCase()}`,
    status: "Draft from call note",
    brokerUser: note.brokerUser || "ryan.vu",
    sourceCallNoteId: note.id,
    applicants,
    expenses: {
      livingMonthly: Number(note.hemMonthly || note.generalExpenses || note.applicant1Expenses || (applicants.length > 1 ? 4300 : 3200)),
      rentMonthly: 0,
      educationMonthly: 0,
      insuranceMonthly: 0,
      transportMonthly: 0,
      otherMonthly: 0
    },
    assets,
    liabilities: note.existingDebtsSummary ? [{ type: "Other", lender: "", limit: 0, balance: 0, repaymentMonthly: 0, description: note.existingDebtsSummary }] : [],
    property: {
      purpose: note.loanPurpose || note.loanType || "",
      address: note.propertyLocation || "",
      purchasePrice: Number(note.propertyValue || 0),
      estimatedValue: Number(note.propertyValue || 0),
      propertyType: note.propertyType || "",
      titleType: "",
      bedrooms: 0
    },
    loan: {
      applicationType: note.loanType || "Purchase",
      loanAmount: Number(note.loanAmount || 0),
      deposit: Number(note.depositEquity || 0),
      lvr: Number(note.lvr || 0),
      productPreference: note.ratePreference || "Variable",
      repaymentType: note.repaymentType || "Principal and interest",
      loanTermYears: Number(note.loanTermYears || 30),
      offsetRequested: Boolean(note.offsetRequested)
    },
    brokerNotes: [note.quickNotes, note.brokerAssessment, note.nextAction].filter(Boolean).join("\n\n"),
    documentChecklist: []
  };
}

function upsertLocalCaseFromCallNote(noteIndex, historyType = "client-intake-synced") {
  const note = callNotes[noteIndex];
  if (!note) return null;
  const existingCaseId = note.convertedCaseId;
  const nextCase = buildLocalCaseFromCallNote(note);

  if (existingCaseId) {
    const caseIndex = localCases.findIndex((item) => item.id === existingCaseId);
    const updatedCase = {
      ...nextCase,
      id: existingCaseId,
      status: "Updated from client information",
      sourceCallNoteId: note.id
    };
    if (caseIndex >= 0) localCases[caseIndex] = updatedCase;
    else localCases.unshift(updatedCase);
    pushCaseHistory(existingCaseId, {
      type: historyType,
      brokerUser: note.brokerUser,
      sourceCallNoteId: note.id,
      clientName: note.clientName
    });
    persistLocalCases();
    return updatedCase;
  }

  localCases.unshift(nextCase);
  callNotes[noteIndex] = {
    ...note,
    convertedCaseId: nextCase.id,
    status: "Draft case created from client information",
    updatedAt: new Date().toISOString()
  };
  persistLocalCases();
  persistCallNotes();
  pushCaseHistory(nextCase.id, {
    type: historyType,
    brokerUser: nextCase.brokerUser,
    sourceCallNoteId: note.id,
    clientName: note.clientName
  });
  return nextCase;
}

function normalizeCompare(value) {
  if (typeof value === "boolean") return value ? "yes" : "no";
  return String(value ?? "")
    .replace(/[$,]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function valuesMatch(left, right) {
  const a = normalizeCompare(left);
  const b = normalizeCompare(right);
  if (!a && !b) return true;
  if (!a || !b) return false;
  return a === b || a.includes(b) || b.includes(a);
}

function valueAt(object, valuePath) {
  return valuePath.split(".").reduce((current, part) => current?.[part], object);
}

function platformForSection(sectionId = "") {
  if (sectionId.startsWith("aol")) return "aol";
  return "infinity";
}

const crossPlatformRules = [
  { label: "Applicant first name", infinity: "infinity.clientDetails.firstName", aol: "aol.applicants.firstName" },
  { label: "Applicant surname/family name", infinity: "infinity.clientDetails.surname", aol: "aol.applicants.familyName" },
  { label: "Date of birth", infinity: "infinity.clientDetails.dateOfBirth", aol: "aol.applicants.dateOfBirth" },
  { label: "Mobile", infinity: "infinity.clientDetails.mobile", aol: "aol.applicants.mobilePhone" },
  { label: "Email", infinity: "infinity.clientDetails.email", aol: "aol.applicants.email" },
  { label: "Residential address", infinity: "infinity.clientDetails.currentAddress", aol: "aol.applicants.currentResidentialAddress" },
  { label: "Dependants", infinity: "infinity.clientDetails.numberOfDependants", aol: "aol.summary.totalDependants" },
  { label: "Facility/base amount", infinity: "loan.loanAmount", aol: "aol.loans.baseAmount" },
  { label: "Loan purpose", infinity: "infinity.loansSecuritiesCommentary.loanPurpose", aol: "aol.loans.primaryPurpose" },
  { label: "Repayment type", infinity: "loan.repaymentType", aol: "aol.loans.repaymentType" },
  { label: "Repayment frequency", infinity: "loan.repaymentFrequency", aol: "aol.loans.repaymentFrequency" },
  { label: "Security address", infinity: "property.address", aol: "aol.securities.address" },
  { label: "Security value", infinity: "property.estimatedValue", aol: "aol.securities.estimatedValue" },
  { label: "Total assets", infinity: "serviceability.financialAssetBuffer", aol: "aol.financials.totalAssets" },
  { label: "Total liabilities", infinity: "serviceability.totalLiabilities", aol: "aol.financials.totalLiabilities" },
  { label: "Monthly expenses", infinity: "serviceability.hemMonthly", aol: "aol.financials.totalExpensesMonthly" }
];

function latestObservedMap(snapshots, platform) {
  const rows = snapshots
    .filter((snapshot) => snapshot.platform === platform)
    .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
  const observed = new Map();
  for (const snapshot of rows) {
    for (const row of [...(snapshot.matched || []), ...(snapshot.mismatched || [])]) {
      if (row.payloadPath) observed.set(row.payloadPath, row.actual);
    }
  }
  return observed;
}

function buildComparisonReport(caseId) {
  const prepared = preparedCases.get(caseId);
  const snapshots = comparisonSnapshots.get(caseId) || [];
  const payload = prepared?.payload || {};
  const infinityObserved = latestObservedMap(snapshots, "infinity");
  const aolObserved = latestObservedMap(snapshots, "aol");
  const pageIssues = snapshots.flatMap((snapshot) => [
    ...(snapshot.mismatched || []).map((row) => ({ ...row, type: "mismatch", platform: snapshot.platform, checkedAt: snapshot.timestamp })),
    ...(snapshot.missing || []).map((row) => ({ ...row, type: "missing", platform: snapshot.platform, checkedAt: snapshot.timestamp }))
  ]);

  const crossPlatformRows = crossPlatformRules
    .map((rule) => {
      const infinityActual = infinityObserved.get(rule.infinity);
      const aolActual = aolObserved.get(rule.aol);
      const infinityExpected = valueAt(payload, rule.infinity);
      const aolExpected = valueAt(payload, rule.aol);
      const left = infinityActual ?? infinityExpected;
      const right = aolActual ?? aolExpected;
      const checked = infinityObserved.has(rule.infinity) || aolObserved.has(rule.aol);
      return {
        label: rule.label,
        infinityPath: rule.infinity,
        aolPath: rule.aol,
        infinityValue: left,
        aolValue: right,
        checked,
        ok: valuesMatch(left, right)
      };
    });
  const crossPlatformMismatches = crossPlatformRows.filter((row) => row.checked && !row.ok);
  const pendingChecks = crossPlatformRows.filter((row) => !row.checked).map((row) => ({
    label: row.label,
    infinityPath: row.infinityPath,
    aolPath: row.aolPath
  }));

  return {
    caseId,
    snapshotCount: snapshots.length,
    pageIssues,
    crossPlatformMismatches,
    pendingChecks,
    ok: pageIssues.length === 0 && crossPlatformMismatches.filter((row) => row.checked).length === 0
  };
}

function pushCaseHistory(caseId, event) {
  const events = caseHistory.get(caseId) || [];
  events.unshift({ ...event, caseId, timestamp: event.timestamp || new Date().toISOString() });
  caseHistory.set(caseId, events.slice(0, 50));
  persistHistory();
}

function summarizePrepared(prepared, type) {
  return {
    id: prepared.token,
    type,
    token: prepared.token,
    caseId: prepared.caseId,
    brokerUser: prepared.brokerUser,
    timestamp: new Date().toISOString(),
    template: prepared.payload?.meta?.template || null,
    applicantNames: Object.values(prepared.payload?.applicants || {})
      .filter(Boolean)
      .map((applicant) => `${applicant.firstName || ""} ${applicant.lastName || ""}`.trim())
      .join(" & "),
    loanAmount: prepared.payload?.loan?.loanAmount || 0,
    okToAutofill: prepared.validation?.okToAutofill || false,
    errors: prepared.validation?.issues?.filter((issue) => issue.severity === "error").length || 0,
    warnings: prepared.validation?.issues?.filter((issue) => issue.severity === "warning").length || 0
  };
}

function prepareCase(caseData, source = "prepare", options = {}) {
  if (options.templateId || options.templateOverrides || options.hemMonthly || options.financialAssetBuffer || options.manualIntake) {
    const draft = buildDocumentDraft([], {
      templateId: options.templateId,
      templateOverrides: options.templateOverrides,
      hemMonthly: options.hemMonthly,
      financialAssetBuffer: options.financialAssetBuffer,
      manualIntake: options.manualIntake
    });
    documentDrafts.set(caseData.id, draft);
  }

  const mergedCase = mergeDocumentDraft(caseData, documentDrafts.get(caseData.id));
  const payload = buildInfinityPayload(mergedCase);
  const validation = validateInfinityPayload(payload);
  const token = crypto.randomBytes(16).toString("hex");
  const prepared = {
    token,
    caseId: caseData.id,
    brokerUser: caseData.brokerUser,
    payload,
    validation,
    mappingVersion: payload.meta.mappingVersion,
    expiresAt: new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString()
  };

  preparedCases.set(token, prepared);
  preparedCases.set(caseData.id, prepared);
  persistPrepared(prepared);
  auditLog.push({
    type: source,
    timestamp: new Date().toISOString(),
    brokerUser: caseData.brokerUser,
    caseId: caseData.id,
    token,
    errors: validation.issues.filter((issue) => issue.severity === "error").length,
    warnings: validation.issues.filter((issue) => issue.severity === "warning").length
  });
  pushCaseHistory(caseData.id, summarizePrepared(prepared, source));

  return prepared;
}

await hydrateStoredData();

app.get("/api/health", (_request, response) => {
  response.json({ ok: true, service: "Infinity AOL AutoFill Assistant" });
});

app.get("/api/cases", (_request, response) => {
  response.json([...localCases, ...cases].map(summarizeCase));
});

app.get("/api/cases/:caseId", (request, response) => {
  const caseData = findCase(request.params.caseId);
  if (!caseData) return response.status(404).json({ error: "Case not found" });
  response.json(caseData);
});

app.delete("/api/cases/:caseId/local-data", (request, response) => {
  const caseId = request.params.caseId;
  const expected = `DELETE ${caseId}`;
  if (request.body?.confirm !== expected) {
    return response.status(400).json({ error: `Type ${expected} to confirm local data deletion.` });
  }

  const result = deleteLocalCaseData(caseId);
  auditLog.push({
    type: "delete-local-case-data",
    timestamp: new Date().toISOString(),
    brokerUser: request.body?.brokerUser || "unknown",
    caseId,
    ...result
  });
  response.json({ ok: true, caseId, ...result });
});

app.post("/api/cases/:caseId/prepare-infinity-aol", (request, response) => {
  const caseData = findCase(request.params.caseId);
  if (!caseData) return response.status(404).json({ error: "Case not found" });

  response.json(prepareCase(caseData, "prepare", request.body || {}));
});

app.post("/api/cases/:caseId/template-preview", (request, response) => {
  const caseData = findCase(request.params.caseId);
  if (!caseData) return response.status(404).json({ error: "Case not found" });

  const draft = buildDocumentDraft([], {
    templateId: request.body?.templateId,
    templateOverrides: request.body?.templateOverrides,
    hemMonthly: request.body?.hemMonthly,
    financialAssetBuffer: request.body?.financialAssetBuffer,
    manualIntake: request.body?.manualIntake
  });
  const mergedCase = mergeDocumentDraft(caseData, draft);
  response.json({
    caseId: caseData.id,
    template: draft.template,
    preview: buildTemplateTextPreview(mergedCase)
  });
});

app.get("/api/templates", (_request, response) => {
  response.json(listTemplates());
});

app.get("/api/call-notes", (_request, response) => {
  response.json([...callNotes].sort((a, b) => new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt)));
});

app.get("/api/call-notes/:noteId", (request, response) => {
  const note = callNotes.find((item) => item.id === request.params.noteId);
  if (!note) return response.status(404).json({ error: "Call note not found" });
  response.json(note);
});

app.get("/api/client-intakes", (request, response) => {
  if (!canReadLoanSubmissions(request)) return response.status(403).json({ error: "Broker access required for Loan Form Submissions." });
  const rows = clientIntakes.map((intake) => {
    const note = callNotes.find((item) => item.id === intake.callNoteId) || {};
    return {
      id: intake.id,
      token: intake.token,
      callNoteId: intake.callNoteId,
      brokerUser: intake.brokerUser || note.brokerUser || "",
      status: intake.status,
      createdAt: intake.createdAt,
      submittedAt: intake.submittedAt,
      clientName: note.clientName || intake.submission?.clientName || "",
      secondApplicantName: note.secondApplicantName || intake.submission?.secondApplicantName || "",
      secondApplicantDateOfBirth: intake.submission?.secondApplicantDateOfBirth || "",
      secondApplicantMobile: intake.submission?.secondApplicantMobile || "",
      secondApplicantEmail: intake.submission?.secondApplicantEmail || "",
      secondApplicantResidencyStatus: intake.submission?.secondApplicantResidencyStatus || "",
      secondApplicantVisaSubclass: intake.submission?.secondApplicantVisaSubclass || "",
      secondApplicantMaritalStatus: intake.submission?.secondApplicantMaritalStatus || "",
      secondApplicantDependants: intake.submission?.secondApplicantDependants || "",
      secondApplicantAddress: intake.submission?.secondApplicantAddress || "",
      secondApplicantCurrentSuburb: intake.submission?.secondApplicantCurrentSuburb || "",
      secondApplicantCurrentState: intake.submission?.secondApplicantCurrentState || "",
      secondApplicantCurrentAddressFromDate: intake.submission?.secondApplicantCurrentAddressFromDate || "",
      secondApplicantCurrentResidentialStatus: intake.submission?.secondApplicantCurrentResidentialStatus || "",
      secondApplicantPreviousAddress: intake.submission?.secondApplicantPreviousAddress || "",
      secondApplicantPreviousSuburb: intake.submission?.secondApplicantPreviousSuburb || "",
      secondApplicantPreviousState: intake.submission?.secondApplicantPreviousState || "",
      secondApplicantPreviousPostcode: intake.submission?.secondApplicantPreviousPostcode || "",
      secondApplicantPreviousResidentialStatus: intake.submission?.secondApplicantPreviousResidentialStatus || "",
      secondApplicantEmploymentType: intake.submission?.secondApplicantEmploymentType || "",
      secondApplicantEmployerName: intake.submission?.secondApplicantEmployerName || "",
      secondApplicantBusinessAddress: intake.submission?.secondApplicantBusinessAddress || "",
      secondApplicantJobTitle: intake.submission?.secondApplicantJobTitle || "",
      secondApplicantEmploymentBasis: intake.submission?.secondApplicantEmploymentBasis || "",
      secondApplicantEmploymentFromDate: intake.submission?.secondApplicantEmploymentFromDate || "",
      secondApplicantEmploymentContactName: intake.submission?.secondApplicantEmploymentContactName || "",
      secondApplicantEmploymentContactNumber: intake.submission?.secondApplicantEmploymentContactNumber || "",
      secondApplicantPreviousBusinessName: intake.submission?.secondApplicantPreviousBusinessName || "",
      secondApplicantPreviousJobTitle: intake.submission?.secondApplicantPreviousJobTitle || "",
      secondApplicantPreviousEmploymentBasis: intake.submission?.secondApplicantPreviousEmploymentBasis || "",
      secondApplicantPreviousEmploymentFromDate: intake.submission?.secondApplicantPreviousEmploymentFromDate || "",
      secondApplicantPreviousEmploymentToDate: intake.submission?.secondApplicantPreviousEmploymentToDate || "",
      mobile: note.mobile || intake.submission?.mobile || "",
      email: note.email || intake.submission?.email || "",
      loanType: note.loanType || intake.submission?.loanType || "",
      loanPurpose: note.loanPurpose || intake.submission?.loanPurpose || "",
      loanAmount: note.loanAmount || intake.submission?.loanAmount || 0,
      propertyValue: note.propertyValue || intake.submission?.propertyValue || 0,
      depositEquity: note.depositEquity || intake.submission?.depositEquity || 0,
      propertyLocation: note.propertyLocation || intake.submission?.propertyLocation || "",
      annualIncome: note.annualIncome || intake.submission?.annualIncome || 0,
      secondAnnualIncome: note.secondAnnualIncome || intake.submission?.secondAnnualIncome || 0,
      hemMonthly: note.hemMonthly || intake.submission?.hemMonthly || 0,
      financialAssetBuffer: note.financialAssetBuffer || intake.submission?.financialAssetBuffer || 0,
      clientNotes: intake.submission?.clientNotes || "",
      lastSavedAt: intake.lastSavedAt || intake.updatedAt || intake.submittedAt || null,
      lastEditedBy: intake.lastEditedBy || "",
      factFindExportedAt: intake.factFindExportedAt || null,
      convertedCaseId: note.convertedCaseId || null,
      url: `${loanFormBaseUrl(request)}/loan-form/${intake.token}`,
      updatedAt: intake.submittedAt || note.updatedAt || intake.createdAt
    };
  });
  response.json(rows.sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0)));
});

app.get("/api/client-intakes/:intakeId/fact-find", (request, response) => {
  if (!canReadLoanSubmissions(request)) return response.status(403).json({ error: "Broker access required for Fact Find export." });
  const intakeIndex = clientIntakes.findIndex((item) => item.id === request.params.intakeId || item.token === request.params.intakeId);
  const intake = clientIntakes[intakeIndex];
  if (!intake) return response.status(404).json({ error: "Loan form submission not found" });
  const note = callNotes.find((item) => item.id === intake.callNoteId) || {};
  const document = intakeFactFindDocument(intake, note);
  const now = new Date().toISOString();
  clientIntakes[intakeIndex] = { ...intake, factFindExportedAt: now, updatedAt: now };
  persistClientIntakes();
  auditLog.push({
    type: "fact-find-exported",
    timestamp: now,
    brokerUser: request.get("x-elf-user-email") || intake.brokerUser || "broker",
    caseId: note.convertedCaseId || intake.callNoteId,
    intakeId: intake.id
  });
  response.setHeader("content-type", "application/msword; charset=utf-8");
  response.setHeader("cache-control", "no-store");
  response.setHeader("content-disposition", `attachment; filename="${factFindFilename(intake, note)}"`);
  response.send(document);
});

app.patch("/api/client-intakes/:intakeId", (request, response) => {
  if (!canReadLoanSubmissions(request)) return response.status(403).json({ error: "Broker access required for Loan Form Submissions." });
  const intakeIndex = clientIntakes.findIndex((item) => item.id === request.params.intakeId || item.token === request.params.intakeId);
  if (intakeIndex === -1) return response.status(404).json({ error: "Loan form submission not found" });
  const now = new Date().toISOString();
  const current = clientIntakes[intakeIndex];
  const editor = request.get("x-elf-user-email") || current.brokerUser || "broker";
  const submission = normalizeClientIntakeSubmission({ ...(current.submission || {}), ...(request.body?.submission || request.body || {}) });
  const previous = current.submission || {};
  const changedFields = Object.keys(submission).filter((field) => JSON.stringify(previous[field] ?? "") !== JSON.stringify(submission[field] ?? ""));
  clientIntakes[intakeIndex] = {
    ...current,
    status: request.body?.status || current.status || "submitted",
    submittedAt: current.submittedAt || now,
    updatedAt: now,
    lastSavedAt: now,
    lastEditedBy: editor,
    submission
  };
  const noteIndex = callNotes.findIndex((item) => item.id === current.callNoteId);
  let note = null;
  if (noteIndex !== -1) {
    callNotes[noteIndex] = applyClientIntakeToNote(callNotes[noteIndex], submission);
    callNotes[noteIndex] = { ...callNotes[noteIndex], updatedAt: now };
    note = callNotes[noteIndex];
    if (note.convertedCaseId) upsertLocalCaseFromCallNote(noteIndex, "client-intake-edited");
    persistCallNotes();
  }
  persistClientIntakes();
  auditLog.push({
    type: "client-intake-edited",
    timestamp: now,
    brokerUser: editor,
    caseId: note?.convertedCaseId || current.callNoteId,
    intakeId: current.id,
    changedFields
  });
  response.json({ intake: clientIntakes[intakeIndex], note });
});

app.post("/api/call-notes", (request, response) => {
  const now = new Date().toISOString();
  const note = {
    id: `CN-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(2).toString("hex").toUpperCase()}`,
    status: request.body?.status || "New call",
    brokerUser: request.body?.brokerUser || "ryan.vu",
    clientName: request.body?.clientName || "",
    secondApplicantName: request.body?.secondApplicantName || "",
    mobile: request.body?.mobile || "",
    email: request.body?.email || "",
    preferredLanguage: request.body?.preferredLanguage || "Vietnamese / English",
    sourceChannel: request.body?.sourceChannel || "",
    bestTimeToContact: request.body?.bestTimeToContact || "",
    loanType: request.body?.loanType || "Purchase",
    loanPurpose: request.body?.loanPurpose || "",
    loanAmount: Number(request.body?.loanAmount || 0),
    propertyValue: Number(request.body?.propertyValue || 0),
    depositEquity: Number(request.body?.depositEquity || 0),
    propertyLocation: request.body?.propertyLocation || "",
    timeline: request.body?.timeline || "",
    dateOfBirth: request.body?.dateOfBirth || "",
    address: request.body?.address || "",
    residencyStatus: request.body?.residencyStatus || "",
    maritalStatus: request.body?.maritalStatus || "",
    dependants: Number(request.body?.dependants || 0),
    employmentType: request.body?.employmentType || "",
    employerName: request.body?.employerName || "",
    occupation: request.body?.occupation || "",
    annualIncome: Number(request.body?.annualIncome || 0),
    secondAnnualIncome: Number(request.body?.secondAnnualIncome || 0),
    rentalIncomeAnnual: Number(request.body?.rentalIncomeAnnual || 0),
    existingDebtsSummary: request.body?.existingDebtsSummary || "",
    creditIssue: request.body?.creditIssue || "Unknown",
    loanTermYears: Number(request.body?.loanTermYears || 30),
    repaymentType: request.body?.repaymentType || "Principal and interest",
    ratePreference: request.body?.ratePreference || "Variable",
    offsetRequested: Boolean(request.body?.offsetRequested),
    hemMonthly: Number(request.body?.hemMonthly || 0),
    financialAssetBuffer: Number(request.body?.financialAssetBuffer || 0),
    redFlags: Array.isArray(request.body?.redFlags) ? request.body.redFlags : [],
    quickNotes: request.body?.quickNotes || "",
    brokerAssessment: request.body?.brokerAssessment || "",
    nextAction: request.body?.nextAction || "",
    convertedCaseId: null,
    createdAt: now,
    updatedAt: now
  };

  callNotes.unshift(note);
  persistCallNotes();
  auditLog.push({ type: "call-note", timestamp: now, brokerUser: note.brokerUser, caseId: note.id, clientName: note.clientName });
  notifyCallIntake(note).catch((error) => console.warn(`Call intake email failed: ${error.message}`));
  response.status(201).json(note);
});

app.patch("/api/call-notes/:noteId", (request, response) => {
  const index = callNotes.findIndex((item) => item.id === request.params.noteId);
  if (index === -1) return response.status(404).json({ error: "Call note not found" });
  const updated = { ...callNotes[index], ...request.body, id: callNotes[index].id, updatedAt: new Date().toISOString() };
  callNotes[index] = updated;
  persistCallNotes();
  response.json(updated);
});

app.delete("/api/call-notes/:noteId", (request, response) => {
  const note = callNotes.find((item) => item.id === request.params.noteId);
  if (!note) return response.status(404).json({ error: "Call note not found" });
  const expected = `DELETE ${note.id}`;
  if (request.body?.confirm !== expected) return response.status(400).json({ error: `Type ${expected} to confirm.` });
  callNotes = callNotes.filter((item) => item.id !== note.id);
  clientIntakes = clientIntakes.filter((item) => item.callNoteId !== note.id);
  persistCallNotes();
  persistClientIntakes();
  auditLog.push({ type: "delete-call-note", timestamp: new Date().toISOString(), brokerUser: note.brokerUser, caseId: note.id });
  response.json({ ok: true, id: note.id });
});

app.post("/api/call-notes/:noteId/convert-to-case", (request, response) => {
  const index = callNotes.findIndex((item) => item.id === request.params.noteId);
  if (index === -1) return response.status(404).json({ error: "Call note not found" });

  const existingCaseId = callNotes[index].convertedCaseId;
  if (existingCaseId) {
    const existing = findCase(existingCaseId);
    return response.json({ note: callNotes[index], case: existing, summary: existing ? summarizeCase(existing) : null });
  }

  const localCase = buildLocalCaseFromCallNote({ ...callNotes[index], ...(request.body || {}) });
  localCases.unshift(localCase);
  callNotes[index] = { ...callNotes[index], convertedCaseId: localCase.id, status: "Draft case created", updatedAt: new Date().toISOString() };
  persistLocalCases();
  persistCallNotes();
  pushCaseHistory(localCase.id, {
    type: "call-note-converted",
    brokerUser: localCase.brokerUser,
    sourceCallNoteId: callNotes[index].id,
    clientName: callNotes[index].clientName
  });
  auditLog.push({
    type: "convert-call-note",
    timestamp: new Date().toISOString(),
    brokerUser: localCase.brokerUser,
    caseId: localCase.id,
    sourceCallNoteId: callNotes[index].id
  });
  response.status(201).json({ note: callNotes[index], case: localCase, summary: summarizeCase(localCase) });
});

app.post("/api/call-notes/:noteId/intake-link", (request, response) => {
  const index = callNotes.findIndex((item) => item.id === request.params.noteId);
  if (index === -1) return response.status(404).json({ error: "Call note not found" });

  const existing = clientIntakes.find((item) => item.callNoteId === request.params.noteId && item.status !== "expired");
  if (existing) {
    return response.json({
      ...existing,
      url: `${loanFormBaseUrl(request)}/loan-form/${existing.token}`,
      fallbackUrl: `${publicBaseUrl(request)}/loan-form/${existing.token}`
    });
  }

  const intake = {
    id: `INTAKE-${Date.now().toString(36).toUpperCase()}`,
    token: crypto.randomBytes(18).toString("hex"),
    callNoteId: request.params.noteId,
    brokerUser: callNotes[index].brokerUser,
    status: "sent",
    createdAt: new Date().toISOString(),
    submittedAt: null,
    submission: null
  };
  clientIntakes.unshift(intake);
  persistClientIntakes();
  callNotes[index] = { ...callNotes[index], intakeToken: intake.token, intakeStatus: "sent", updatedAt: new Date().toISOString() };
  persistCallNotes();
  response.status(201).json({
    ...intake,
    url: `${loanFormBaseUrl(request)}/loan-form/${intake.token}`,
    fallbackUrl: `${publicBaseUrl(request)}/loan-form/${intake.token}`
  });
});

app.get("/api/client-intake/public", (_request, response) => {
  response.json({
    token: "public",
    status: "new",
    submittedAt: null,
    callNoteId: null,
    clientName: "",
    secondApplicantName: "",
    secondApplicantDateOfBirth: "",
    secondApplicantMobile: "",
    secondApplicantEmail: "",
    secondApplicantResidencyStatus: "",
    secondApplicantVisaSubclass: "",
    secondApplicantMaritalStatus: "",
    secondApplicantDependants: "",
    secondApplicantEmploymentType: "",
    secondApplicantEmployerName: "",
    secondApplicantJobTitle: "",
    mobile: "",
    email: "",
    loanPurpose: "",
    loanAmount: "",
    preferredLanguage: "Vietnamese / English"
  });
});

app.post("/api/client-intake/public", (request, response) => {
  const now = new Date().toISOString();
  const submission = normalizeClientIntakeSubmission(request.body || {});
  const baseNote = {
    id: `CN-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(2).toString("hex").toUpperCase()}`,
    status: "Loan form received",
    brokerUser: "loan-form",
    clientName: "",
    secondApplicantName: "",
    mobile: "",
    email: "",
    preferredLanguage: "Vietnamese / English",
    sourceChannel: "Loan Form",
    bestTimeToContact: submission.timeline || "",
    loanType: "Purchase",
    loanPurpose: "",
    loanAmount: 0,
    propertyValue: 0,
    depositEquity: 0,
    propertyLocation: "",
    timeline: "",
    dateOfBirth: "",
    address: "",
    residencyStatus: "",
    maritalStatus: "",
    dependants: 0,
    employmentType: "",
    employerName: "",
    occupation: "",
    annualIncome: 0,
    secondAnnualIncome: 0,
    rentalIncomeAnnual: 0,
    existingDebtsSummary: "",
    creditIssue: "Unknown",
    loanTermYears: 30,
    repaymentType: "Principal and interest",
    ratePreference: "Variable",
    offsetRequested: false,
    hemMonthly: 0,
    financialAssetBuffer: 0,
    redFlags: [],
    quickNotes: "",
    brokerAssessment: "",
    nextAction: "Review loan form submission",
    convertedCaseId: null,
    createdAt: now,
    updatedAt: now
  };
  const note = applyClientIntakeToNote(baseNote, submission);
  const noteForCase = { ...note, intakeStatus: "submitted" };
  callNotes.unshift(noteForCase);
  const intake = {
    id: `INTAKE-${Date.now().toString(36).toUpperCase()}`,
    token: crypto.randomBytes(18).toString("hex"),
    callNoteId: note.id,
    brokerUser: note.brokerUser,
    status: "submitted",
    createdAt: now,
    submittedAt: now,
    submission
  };

  const localCase = upsertLocalCaseFromCallNote(0, "public-loan-form-submitted");
  callNotes[0] = { ...callNotes[0], intakeToken: intake.token, intakeStatus: "submitted", convertedCaseId: localCase?.id || callNotes[0].convertedCaseId };
  clientIntakes.unshift(intake);
  persistCallNotes();
  persistClientIntakes();
  auditLog.push({
    type: "client-intake",
    timestamp: now,
    brokerUser: note.brokerUser,
    caseId: note.id,
    clientName: note.clientName
  });
  notifyLoanFormSubmission(intake, callNotes[0]).catch((error) => console.warn(`Loan form email failed: ${error.message}`));
  response.status(201).json({ ok: true, status: "submitted", callNoteId: note.id, caseId: localCase?.id || null, token: intake.token });
});

app.get("/api/client-intake/:token", (request, response) => {
  const intake = clientIntakes.find((item) => item.token === request.params.token);
  if (!intake) return response.status(404).json({ error: "Loan form link not found" });
  const note = callNotes.find((item) => item.id === intake.callNoteId);
  response.json({
    ...(note || {}),
    token: intake.token,
    status: intake.status,
    submittedAt: intake.submittedAt,
    callNoteId: intake.callNoteId
  });
});

app.post("/api/client-intake/:token", (request, response) => {
  const intakeIndex = clientIntakes.findIndex((item) => item.token === request.params.token);
  if (intakeIndex === -1) return response.status(404).json({ error: "Loan form link not found" });
  const noteIndex = callNotes.findIndex((item) => item.id === clientIntakes[intakeIndex].callNoteId);
  if (noteIndex === -1) return response.status(404).json({ error: "Linked call note not found" });

  const now = new Date().toISOString();
  const submission = normalizeClientIntakeSubmission(request.body || {});
  clientIntakes[intakeIndex] = { ...clientIntakes[intakeIndex], status: "submitted", submittedAt: now, submission };
  callNotes[noteIndex] = applyClientIntakeToNote(callNotes[noteIndex], submission);
  const localCase = upsertLocalCaseFromCallNote(noteIndex, "loan-form-submitted");
  persistClientIntakes();
  persistCallNotes();
  auditLog.push({
    type: "client-intake",
    timestamp: now,
    brokerUser: callNotes[noteIndex].brokerUser,
    caseId: localCase?.id || callNotes[noteIndex].id,
    clientName: callNotes[noteIndex].clientName
  });
  notifyLoanFormSubmission(clientIntakes[intakeIndex], callNotes[noteIndex]).catch((error) => console.warn(`Loan form email failed: ${error.message}`));
  response.status(201).json({ ok: true, status: "submitted", caseId: localCase?.id || null });
});

app.get("/api/templates/:templateId", (request, response) => {
  const template = getTemplate(request.params.templateId);
  if (!template) return response.status(404).json({ error: "Template not found" });
  response.json(template);
});

app.put("/api/templates/:templateId", (request, response) => {
  try {
    const saved = saveTemplate({ ...request.body, id: request.params.templateId });
    response.json(saved);
  } catch (error) {
    response.status(400).json({ error: error.message });
  }
});

app.post("/api/cases/:caseId/document-intake", upload.array("documents"), (request, response) => {
  const caseData = findCase(request.params.caseId);
  if (!caseData) return response.status(404).json({ error: "Case not found" });
  if (!request.files?.length) return response.status(400).json({ error: "Upload at least one client document." });

  const draft = buildDocumentDraft(request.files, {
    hemMonthly: request.body.hemMonthly,
    financialAssetBuffer: request.body.financialAssetBuffer,
    templateId: request.body.templateId,
    templateOverrides: request.body.templateOverrides,
    manualIntake: request.body.manualIntake
  });

  documentDrafts.set(caseData.id, draft);
  auditLog.push({
    type: "document-intake",
    timestamp: new Date().toISOString(),
    brokerUser: caseData.brokerUser,
    caseId: caseData.id,
    files: request.files.map((file) => file.originalname),
    hemMonthly: draft.assumptions.hemMonthly,
    financialAssetBuffer: draft.assumptions.financialAssetBuffer,
    warnings: draft.warnings.length
  });
  pushCaseHistory(caseData.id, {
    type: "document-intake",
    files: request.files.map((file) => file.originalname),
    hemMonthly: draft.assumptions.hemMonthly,
    financialAssetBuffer: draft.assumptions.financialAssetBuffer,
    warnings: draft.warnings.length
  });

  response.status(201).json({ caseId: caseData.id, brokerUser: caseData.brokerUser, draft });
});

app.post("/api/cases/:caseId/intake-and-prepare", upload.array("documents"), (request, response) => {
  const caseData = findCase(request.params.caseId);
  if (!caseData) return response.status(404).json({ error: "Case not found" });

  let draft = documentDrafts.get(caseData.id) || null;
  if (request.files?.length || request.body.templateId || request.body.templateOverrides || request.body.hemMonthly || request.body.financialAssetBuffer || request.body.manualIntake) {
    draft = buildDocumentDraft(request.files, {
      hemMonthly: request.body.hemMonthly,
      financialAssetBuffer: request.body.financialAssetBuffer,
      templateId: request.body.templateId,
      templateOverrides: request.body.templateOverrides,
      manualIntake: request.body.manualIntake
    });
    documentDrafts.set(caseData.id, draft);
    auditLog.push({
      type: "document-intake",
      timestamp: new Date().toISOString(),
      brokerUser: caseData.brokerUser,
      caseId: caseData.id,
      files: request.files.map((file) => file.originalname),
      hemMonthly: draft.assumptions.hemMonthly,
      financialAssetBuffer: draft.assumptions.financialAssetBuffer,
      warnings: draft.warnings.length
    });
    pushCaseHistory(caseData.id, {
      type: "document-intake",
      files: request.files.map((file) => file.originalname),
      hemMonthly: draft.assumptions.hemMonthly,
      financialAssetBuffer: draft.assumptions.financialAssetBuffer,
      warnings: draft.warnings.length
    });
  }

  const prepared = prepareCase(caseData, "intake-and-prepare");
  response.status(201).json({ ...prepared, documentDraft: draft });
});

app.get("/api/cases/:caseId/document-intake", (request, response) => {
  const draft = documentDrafts.get(request.params.caseId);
  if (!draft) return response.status(404).json({ error: "No document draft for this case yet." });
  response.json({ caseId: request.params.caseId, draft });
});

app.get("/api/cases/:caseId/history", (request, response) => {
  response.json(caseHistory.get(request.params.caseId) || []);
});

app.get("/api/history", (_request, response) => {
  response.json([...caseHistory.values()].flat().sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp)));
});

app.get("/api/infinity/payload/:tokenOrCaseId", (request, response) => {
  const prepared = preparedCases.get(request.params.tokenOrCaseId);
  if (!prepared) return response.status(404).json({ error: "Prepared payload not found. Prepare the case from CRM first." });
  response.json(prepared);
});

app.get("/api/infinity/mappings/current", (_request, response) => {
  response.json(getMapping());
});

app.post("/api/infinity/autofill-log", (request, response) => {
  const event = {
    type: "autofill",
    timestamp: new Date().toISOString(),
    brokerUser: request.body.brokerUser || "unknown",
    caseId: request.body.caseId || "unknown",
    fieldsFilled: request.body.fieldsFilled || [],
    fieldsSkipped: request.body.fieldsSkipped || [],
    errors: request.body.errors || [],
    sectionId: request.body.sectionId || null,
    userAgent: request.get("user-agent")
  };
  auditLog.push(event);
  pushCaseHistory(event.caseId, {
    type: "autofill",
    brokerUser: event.brokerUser,
    sectionId: event.sectionId,
    fieldsFilled: event.fieldsFilled,
    fieldsSkipped: event.fieldsSkipped,
    errors: event.errors
  });
  response.status(201).json({ ok: true, event });
});

app.post("/api/cases/:caseId/comparison-snapshot", (request, response) => {
  const caseId = request.params.caseId;
  const snapshot = {
    id: crypto.randomBytes(8).toString("hex"),
    type: "comparison-snapshot",
    timestamp: new Date().toISOString(),
    caseId,
    platform: request.body.platform || platformForSection(request.body.sectionId),
    sectionId: request.body.sectionId || null,
    url: request.body.url || null,
    matched: request.body.matched || [],
    mismatched: request.body.mismatched || [],
    missing: request.body.missing || []
  };

  const snapshots = comparisonSnapshots.get(caseId) || [];
  snapshots.unshift(snapshot);
  comparisonSnapshots.set(caseId, snapshots.slice(0, 100));
  persistComparisonSnapshots();
  pushCaseHistory(caseId, {
    type: "comparison-snapshot",
    platform: snapshot.platform,
    sectionId: snapshot.sectionId,
    matched: snapshot.matched.length,
    mismatched: snapshot.mismatched.length,
    missing: snapshot.missing.length
  });
  response.status(201).json({ ok: true, snapshot, report: buildComparisonReport(caseId) });
});

app.get("/api/cases/:caseId/comparison-report", (request, response) => {
  response.json(buildComparisonReport(request.params.caseId));
});

app.get("/api/audit-log", (_request, response) => {
  response.json(auditLog.toReversed());
});

app.get("/api/backup", (_request, response) => {
  response.setHeader("content-disposition", `attachment; filename="infinity-aol-backup-${new Date().toISOString().slice(0, 10)}.json"`);
  response.json(buildInfinityAolBackup());
});

app.use("/api", (request, response) => {
  response.status(404).json({ error: `API route not found: ${request.method} ${request.originalUrl}` });
});

app.use((error, _request, response, _next) => {
  console.error(error);
  if (response.headersSent) return;
  response.status(500).json({ error: "Internal server error", detail: error.message });
});

if (fs.existsSync(distPath)) {
  app.use(express.static(distPath));
  app.get(/^\/(?!api).*/, (_request, response) => {
    response.sendFile(path.join(distPath, "index.html"));
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  app.listen(port, () => {
    console.log(`Infinity AOL AutoFill Assistant API running on http://127.0.0.1:${port}`);
  });
}
