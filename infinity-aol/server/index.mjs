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
import { classifyLoanPurpose } from "./lib/loanPurpose.mjs";
import { buildYtdXlsx } from "./lib/ytdCalc.mjs";
import { buildRecPdf, buildRecDocx, buildRecNarrative } from "./lib/recNotes.mjs";

export const app = express();
const port = Number(process.env.PORT || 8797);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distPath = path.resolve(__dirname, "../dist");
const loanFormImportTemplatePath = path.resolve(__dirname, "../LOAN_FORM_CHATGPT_IMPORT_TEMPLATE.md");
const legacyDataDir = path.resolve(__dirname, "data");
const defaultDataDir = process.env.NODE_ENV === "production" ? "/var/data" : legacyDataDir;
const dataDir = path.resolve(process.env.INFINITY_AOL_DATA_DIR || process.env.DATA_DIR || defaultDataDir);
const backupDir = path.resolve(process.env.INFINITY_AOL_BACKUP_DIR || process.env.BACKUP_DIR || path.join(dataDir, "backups"));
const legacyBackupDir = path.join(dataDir, "legacy-json-backup");
const uploadsDir = path.join(dataDir, "uploads");
const generatedDir = path.join(dataDir, "generated");
const migrationReportPath = path.join(dataDir, "migration-report.json");
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
const useSupabaseStore = process.env.SUPABASE_ENABLED === "true" && Boolean(supabaseUrl && supabaseServiceRoleKey);
const storePrefix = process.env.INFINITY_AOL_STORE_PREFIX || "infinity_aol";
const historyPath = path.resolve(dataDir, "caseHistory.json");
const preparedArchivePath = path.resolve(dataDir, "preparedPayloads.json");
const comparisonSnapshotsPath = path.resolve(dataDir, "comparisonSnapshots.json");
const callNotesPath = path.resolve(dataDir, "callNotes.json");
const localCasesPath = path.resolve(dataDir, "localCases.json");
const clientIntakesPath = path.resolve(dataDir, "clientIntakes.json");
const aolTemplatesPath = path.resolve(dataDir, "aolTemplates.json");
const userTemplatesPath = path.resolve(dataDir, "userTemplates.json"); // same file caseTemplates.mjs writes

const preparedCases = new Map();
const documentDrafts = new Map();
const caseHistory = new Map();
const comparisonSnapshots = new Map();
// Per-lender AOL learned templates (Compliance R&O reason selections etc.). Each lender's AOL form
// differs, so the bot learns + stores a template keyed by lender code (ANZ/ING/…) and reuses it.
const aolTemplates = new Map();
let callNotes = [];
let localCases = [];
let clientIntakes = [];
let preparedArchive = [];
const auditLog = [];
// Bounded append — keep memory from growing without limit (esp. for the public write endpoints).
function audit(event) { auditLog.push(event); if (auditLog.length > 3000) auditLog.splice(0, auditLog.length - 3000); }
// Optional shared-secret for the public extension WRITE endpoints. BACKWARD-COMPATIBLE: if the env var
// isn't set, nothing is enforced (behaves exactly as before). Set EASYFLOW_EXT_SECRET (server) + send the
// matching `x-easyflow-ext-token` header (extension) to turn enforcement ON. Timing-safe compare.
function extTokenOk(request) {
  const secret = process.env.EASYFLOW_EXT_SECRET;
  if (!secret) return true; // not configured → no enforcement
  const got = String(request.get("x-easyflow-ext-token") || "");
  const a = Buffer.from(got), b = Buffer.from(secret);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
// ---- Per-broker auth ----
// The root server (server.mjs) issues a signed session token at POST /api/auth/login (HMAC over
// ADMIN_SESSION_SECRET). We run in the same process, so we verify with the identical secret + fallback
// chain. The Chrome extension stores the token and sends it as `x-easyflow-broker-token`.
const SESSION_SECRET = process.env.ADMIN_SESSION_SECRET || process.env.ADMIN_PASSWORD || "local-dev-secret-change-me";
function verifyBrokerToken(token) {
  try {
    const [body, sig] = String(token || "").split(".");
    if (!body || !sig) return null;
    const expected = crypto.createHmac("sha256", SESSION_SECRET).update(body).digest("base64url");
    const a = Buffer.from(sig), b = Buffer.from(expected);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (!payload.exp || payload.exp < Date.now()) return null;
    return payload;
  } catch { return null; }
}
function brokerFromRequest(request) {
  // 1) bearer token (Chrome extension stores it from /api/auth/login)
  const raw = String(request.get("x-easyflow-broker-token") || request.get("authorization") || "").replace(/^Bearer\s+/i, "");
  let session = verifyBrokerToken(raw);
  if (session) return session;
  // 2) the web app's signed session cookie (same HMAC token, set by server.mjs on login)
  const cookies = String(request.get("cookie") || "");
  for (const match of cookies.matchAll(/(elf_[a-z_]*session)=([^;]+)/g)) {
    session = verifyBrokerToken(decodeURIComponent(match[2]));
    if (session) return session;
  }
  return null;
}
// Guard for endpoints that must be done by a vetted, logged-in broker. Returns the session or sends 401.
function requireBroker(request, response) {
  const session = brokerFromRequest(request);
  if (!session || (session.role !== "broker" && session.role !== "admin")) {
    response.status(401).json({ error: "login required", code: "BROKER_LOGIN_REQUIRED" });
    return null;
  }
  return session;
}

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024, files: 12 } });
const notificationEmail = process.env.EASYFLOW_NOTIFY_EMAIL || process.env.BOOKING_NOTIFY_EMAIL || process.env.NOTIFY_EMAIL || "hello@easyloanfinance.com.au";
const notificationFrom = process.env.EASYFLOW_FROM_EMAIL || "Easy Loan Finance <ryan.vufinanceaus@gmail.com>";
const storageState = {
  primary: dataDir === legacyDataDir ? "local-dev-json" : "render-disk-json",
  dataDir,
  backupDir,
  legacyBackupDir,
  migrationReportPath,
  supabaseSync: useSupabaseStore,
  lastWriteAt: null,
  lastBackupAt: null
};

app.use(cors());
app.use(express.json({ limit: "1mb" }));

function findCase(caseId) {
  return [...localCases, ...cases].find((item) => item.id === caseId);
}

// The prepared payload keeps income at its REAL frequency + per-period amount (e.g. Weekly $1,625.83), which
// Infinity's Financials summary annualises away — so it's the source of truth for the income working.
function getPreparedPayload(caseId) {
  const rec = preparedArchive.find((p) => p.caseId === caseId);
  return (rec && rec.payload) || null;
}
function payloadIncomes(caseId) {
  const p = getPreparedPayload(caseId);
  return (p && p.infinity && p.infinity.financials && p.infinity.financials.incomes)
    || (p && p.aol && p.aol.financials && p.aol.financials.incomes) || [];
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

function ensureStorageFolders() {
  for (const folder of [dataDir, backupDir, legacyBackupDir, uploadsDir, generatedDir]) {
    fs.mkdirSync(folder, { recursive: true });
  }
}

function migrateLegacyJsonToDataDir() {
  ensureStorageFolders();
  const files = [
    "caseHistory.json",
    "preparedPayloads.json",
    "comparisonSnapshots.json",
    "callNotes.json",
    "localCases.json",
    "clientIntakes.json"
  ];
  const report = {
    started_at: new Date().toISOString(),
    data_dir: dataDir,
    legacy_data_dir: legacyDataDir,
    copied_legacy_files: [],
    seeded_live_files: [],
    skipped_existing_live_files: [],
    errors: []
  };

  for (const file of files) {
    const legacyPath = path.join(legacyDataDir, file);
    const livePath = path.join(dataDir, file);
    try {
      if (fs.existsSync(legacyPath)) {
        fs.copyFileSync(legacyPath, path.join(legacyBackupDir, file));
        report.copied_legacy_files.push(file);
        if (!fs.existsSync(livePath)) {
          fs.copyFileSync(legacyPath, livePath);
          report.seeded_live_files.push(file);
        } else {
          report.skipped_existing_live_files.push(file);
        }
      } else if (!fs.existsSync(livePath)) {
        writeJsonFile(livePath, file.endsWith("History.json") || file.endsWith("Snapshots.json") ? {} : []);
        report.seeded_live_files.push(file);
      }
    } catch (error) {
      report.errors.push({ file, message: error.message });
    }
  }

  report.completed_at = new Date().toISOString();
  writeJsonFile(migrationReportPath, report);
}

function persistBackupSnapshot() {
  try {
    ensureStorageFolders();
    const backup = buildInfinityAolBackup();
    const todayPath = path.join(backupDir, `${new Date().toISOString().slice(0, 10)}-backup.json`);
    writeJsonFile(path.join(backupDir, "latest-backup.json"), backup);
    if (!fs.existsSync(todayPath)) writeJsonFile(todayPath, backup);
    storageState.lastBackupAt = new Date().toISOString();
  } catch (error) {
    console.warn(`Infinity AOL backup snapshot failed: ${error.message}`);
  }
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
  try {
    writeJsonFile(filePath, value);
    storageState.lastWriteAt = new Date().toISOString();
    persistBackupSnapshot();
  } catch (error) {
    console.warn(`Infinity AOL local write failed for ${name}: ${error.message}`);
  }
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

  const loadedTemplates = await readStoredJson("aol_templates", aolTemplatesPath, {});
  for (const [lender, tmpl] of Object.entries(loadedTemplates)) {
    if (tmpl && typeof tmpl === "object") aolTemplates.set(lender, tmpl);
  }

  // User-edited case templates (the EasyFlow "Edit template text") persisted ONLY to local disk before —
  // wiped on every Render redeploy. Restore them from Supabase to the local file so caseTemplates reads them.
  try {
    const userTpls = await readStoredJson("user_templates", userTemplatesPath, []);
    if (Array.isArray(userTpls) && userTpls.length) {
      fs.mkdirSync(path.dirname(userTemplatesPath), { recursive: true });
      fs.writeFileSync(userTemplatesPath, `${JSON.stringify(userTpls, null, 2)}\n`);
    }
  } catch (error) { console.warn(`user templates restore failed: ${error.message}`); }
}

function persistAolTemplates() {
  writeStoredJson("aol_templates", aolTemplatesPath, Object.fromEntries(aolTemplates.entries()));
}

// Normalise a lender code key (ANZ, ING, …) so "anz"/"ANZ"/"Anz" all map to one template.
function lenderKey(raw) {
  return String(raw || "").trim().toUpperCase().replace(/[^A-Z0-9]+/g, "") || "DEFAULT";
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

function loanFormUrl(request, intake) {
  const caseQuery = intake?.caseId ? `?caseId=${encodeURIComponent(intake.caseId)}` : "";
  return `${loanFormBaseUrl(request)}/loan-form/${intake.token}${caseQuery}`;
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
      ["Loan scenario", data.loanScenario],
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
    storage: storageState.primary,
    dataDir,
    backupDir,
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
    "firstName",
    "middleName",
    "surname",
    "clientNameSearch",
    "secondApplicantName",
    "secondApplicantFirstName",
    "secondApplicantMiddleName",
    "secondApplicantSurname",
    "secondApplicantNameSearch",
    "secondApplicantDateOfBirth",
    "secondApplicantGender",
    "secondApplicantPermanentInAustralia",
    "secondApplicantDriversLicenceNo",
    "secondApplicantLicenceCardNumber",
    "secondApplicantLicenceExpiryDate",
    "secondApplicantLicenceState",
    "secondApplicantLicenceClass",
    "secondApplicantMobile",
    "secondApplicantEmail",
    "secondApplicantResidencyStatus",
    "secondApplicantVisaSubclass",
    "secondApplicantMaritalStatus",
    "secondApplicantDependants",
    "secondApplicantAddress",
    "secondApplicantCurrentSuburb",
    "secondApplicantCurrentState",
    "secondApplicantCurrentPostcode",
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
    "loanScenario",
    "loanType",
    "loanPurpose",
    "loanAmount",
    "propertyValue",
    "depositEquity",
    "propertyLocation",
    "timeline",
    "dateOfBirth",
    "gender",
    "permanentInAustralia",
    "driversLicenceNo",
    "licenceCardNumber",
    "licenceExpiryDate",
    "licenceState",
    "licenceClass",
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
    "currentPostcode",
    "currentAddressFromDate",
    "currentResidentialStatus",
    "postSettlementAddress",
    "mailingAddress",
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
    "propertyFoundStatus",
    "purchasePrice",
    "sourceOfDeposit",
    "contractStatus",
    "auctionDate",
    "settlementDate",
    "financeClauseDate",
    "propertyUsage",
    "fhogEligible",
    "constructionDetails",
    "currentInterestRate",
    "currentLoanRepaymentType",
    "currentRateType",
    "fixedExpiryDate",
    "offsetRedrawBalance",
    "propertyEstimatedValue",
    "cashOutAmount",
    "cashOutPurpose",
    "debtConsolidationDebts",
    "payoutDetails",
    "arrearsHistory",
    "borrowerEntity",
    "abnAcn",
    "companyTrustDirectorsGuarantors",
    "commercialPropertyAddress",
    "commercialPropertyType",
    "commercialPurchasePrice",
    "commercialZoning",
    "commercialOccupancy",
    "commercialLeaseDetails",
    "commercialAnnualRent",
    "commercialTenantDetails",
    "currentCommercialLoanDetails",
    "commercialIncomeEvidence",
    "commercialFinancialsAvailable",
    "commercialCashOutPurposeEvidence",
    "businessLegalName",
    "entityType",
    "abnStartDate",
    "industry",
    "businessOwnersDirectors",
    "businessLoanPurpose",
    "businessLoanAmount",
    "businessLoanTerm",
    "businessSecurityType",
    "existingBusinessDebts",
    "atoDebtPaymentPlan",
    "bankStatementsAvailable",
    "basAvailable",
    "taxReturnsAvailable",
    "equipmentQuoteInvoice",
    "vehicleApplicantType",
    "vehicleMake",
    "vehicleModel",
    "vehicleYear",
    "vehicleVariant",
    "vehicleVin",
    "vehicleRego",
    "vehicleOdometer",
    "saleType",
    "dealerInvoiceAvailable",
    "privateSellerDetails",
    "balloonResidual",
    "insuranceStatus",
    "vehicleRefinancePayout",
    "businessUsePercentage",
    "chattelMortgageRequired",
    "personalLoanPurpose",
    "personalLoanAmount",
    "personalLoanTerm",
    "personalSecurityType",
    "fundingTimeframe",
    "quoteInvoiceAvailable",
    "personalDebtConsolidationDetails",
    "paydayLoans",
    "bnplUse",
    "gamblingTransactions",
    "dishonoursHistory",
    "hardshipHistory",
    "recentDeclines",
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
  const primaryFallback = splitName(body.clientName);
  const secondaryFallback = splitName(body.secondApplicantName);
  const firstName = String(body.firstName || primaryFallback.firstName || "").trim();
  const middleName = "";
  const surname = String(body.surname || primaryFallback.lastName || "").trim();
  const secondApplicantFirstName = String(body.secondApplicantFirstName || secondaryFallback.firstName || "").trim();
  const secondApplicantMiddleName = "";
  const secondApplicantSurname = String(body.secondApplicantSurname || secondaryFallback.lastName || "").trim();
  const clientName = composeLegalName(firstName, "", surname, body.clientName);
  const secondApplicantName = composeLegalName(
    secondApplicantFirstName,
    "",
    secondApplicantSurname,
    body.secondApplicantName
  );
  const base = {
    ...body,
    clientName,
    firstName,
    middleName,
    surname,
    clientNameSearch: normalizeSearchText(clientName),
    secondApplicantName,
    secondApplicantFirstName,
    secondApplicantMiddleName,
    secondApplicantSurname,
    secondApplicantNameSearch: normalizeSearchText(secondApplicantName),
    dateOfBirth: normalizeAuDate(body.dateOfBirth),
    secondApplicantDateOfBirth: normalizeAuDate(body.secondApplicantDateOfBirth),
    licenceExpiryDate: normalizeAuDate(body.licenceExpiryDate),
    secondApplicantLicenceExpiryDate: normalizeAuDate(body.secondApplicantLicenceExpiryDate),
    dependant1Dob: normalizeAuDate(body.dependant1Dob),
    dependant2Dob: normalizeAuDate(body.dependant2Dob),
    dependant3Dob: normalizeAuDate(body.dependant3Dob),
    dependant4Dob: normalizeAuDate(body.dependant4Dob),
    currentAddressFromDate: normalizeAuDate(body.currentAddressFromDate),
    previousAddressFromDate: normalizeAuDate(body.previousAddressFromDate),
    employmentFromDate: normalizeAuDate(body.employmentFromDate),
    previousEmploymentFromDate: normalizeAuDate(body.previousEmploymentFromDate),
    previousEmploymentToDate: normalizeAuDate(body.previousEmploymentToDate),
    secondApplicantCurrentAddressFromDate: normalizeAuDate(body.secondApplicantCurrentAddressFromDate),
    secondApplicantEmploymentFromDate: normalizeAuDate(body.secondApplicantEmploymentFromDate),
    secondApplicantPreviousEmploymentFromDate: normalizeAuDate(body.secondApplicantPreviousEmploymentFromDate),
    secondApplicantPreviousEmploymentToDate: normalizeAuDate(body.secondApplicantPreviousEmploymentToDate),
    auctionDate: normalizeAuDate(body.auctionDate),
    settlementDate: normalizeAuDate(body.settlementDate),
    financeClauseDate: normalizeAuDate(body.financeClauseDate),
    fixedExpiryDate: normalizeAuDate(body.fixedExpiryDate),
    abnStartDate: normalizeAuDate(body.abnStartDate),
    loanAmount: toNumber(body.loanAmount),
    propertyValue: toNumber(body.propertyValue),
    depositEquity: toNumber(body.depositEquity),
    dependants: Number(body.dependants || 0),
    secondApplicantDependants: Number(body.secondApplicantDependants || 0),
    annualIncome: toNumber(body.annualIncome),
    secondAnnualIncome: toNumber(body.secondAnnualIncome),
    rentalIncomeAnnual: toNumber(body.rentalIncomeAnnual),
    generalExpenses: toNumber(body.generalExpenses),
    applicant1Expenses: toNumber(body.applicant1Expenses),
    applicant2Expenses: toNumber(body.applicant2Expenses),
    applicant1PrivateHealthAmount: toNumber(body.applicant1PrivateHealthAmount),
    applicant2PrivateHealthAmount: toNumber(body.applicant2PrivateHealthAmount),
    realEstateAssetValue: toNumber(body.realEstateAssetValue),
    cashSavingsAmount: toNumber(body.cashSavingsAmount),
    motorVehicleValue: toNumber(body.motorVehicleValue),
    homeContentsValue: toNumber(body.homeContentsValue),
    loanTermYears: Number(body.loanTermYears || 30),
    hemMonthly: toNumber(body.hemMonthly),
    financialAssetBuffer: toNumber(body.financialAssetBuffer),
    purchasePrice: toNumber(body.purchasePrice),
    propertyEstimatedValue: toNumber(body.propertyEstimatedValue),
    cashOutAmount: toNumber(body.cashOutAmount),
    offsetRedrawBalance: toNumber(body.offsetRedrawBalance),
    annualBusinessTurnover: toNumber(body.annualBusinessTurnover),
    netProfitBeforeTax: toNumber(body.netProfitBeforeTax),
    commercialLeaseIncome: toNumber(body.commercialLeaseIncome),
    commercialPurchasePrice: toNumber(body.commercialPurchasePrice),
    commercialAnnualRent: toNumber(body.commercialAnnualRent),
    businessLoanAmount: toNumber(body.businessLoanAmount),
    monthlyTurnover: toNumber(body.monthlyTurnover),
    vehiclePrice: toNumber(body.vehiclePrice),
    tradeInDeposit: toNumber(body.tradeInDeposit),
    vehicleYear: toNumber(body.vehicleYear),
    vehicleOdometer: toNumber(body.vehicleOdometer),
    balloonResidual: toNumber(body.balloonResidual),
    businessUsePercentage: toNumber(body.businessUsePercentage),
    personalLoanAmount: toNumber(body.personalLoanAmount),
    currentLoanBalance: toNumber(body.currentLoanBalance),
    currentRepayment: toNumber(body.currentRepayment),
    offsetRequested: toBoolean(body.offsetRequested)
  };

  const hasSecondApplicant = /^(yes|true|1)$/i.test(String(base.hasSecondApplicant || "").trim());
  base.hasSecondApplicant = hasSecondApplicant ? "Yes" : "No";
  if (!hasSecondApplicant) {
    [
      "secondApplicantName",
      "secondApplicantFirstName",
      "secondApplicantMiddleName",
      "secondApplicantSurname",
      "secondApplicantNameSearch",
      "secondApplicantDateOfBirth",
      "secondApplicantGender",
      "secondApplicantMobile",
      "secondApplicantEmail",
      "secondApplicantResidencyStatus",
      "secondApplicantPermanentInAustralia",
      "secondApplicantVisaSubclass",
      "secondApplicantMaritalStatus",
      "secondApplicantDriversLicenceNo",
      "secondApplicantLicenceCardNumber",
      "secondApplicantLicenceExpiryDate",
      "secondApplicantLicenceState",
      "secondApplicantLicenceClass",
      "secondApplicantAddress",
      "secondApplicantCurrentAddress",
      "secondApplicantCurrentSuburb",
      "secondApplicantCurrentState",
      "secondApplicantCurrentPostcode",
      "secondApplicantCurrentAddressFromDate",
      "secondApplicantPreviousAddress",
      "secondApplicantCurrentResidentialStatus",
      "secondApplicantEmploymentType",
      "secondApplicantEmployerName",
      "secondApplicantOccupation",
      "secondApplicantJobTitle",
      "secondApplicantEmploymentBasis",
      "secondApplicantEmploymentLength",
      "secondApplicantEmploymentFromDate",
      "secondApplicantPreviousEmploymentFromDate",
      "secondApplicantPreviousEmploymentToDate"
    ].forEach((field) => {
      base[field] = "";
    });
    base.secondApplicantDependants = 0;
    base.secondAnnualIncome = 0;
    base.applicant2Expenses = 0;
    base.applicant2PrivateHealthAmount = 0;
  }
  return attachClientIntakePayloads(base, base);
}

function toNumber(value) {
  const cleaned = String(value ?? "").replace(/[$,\s]/g, "");
  if (!cleaned) return 0;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : 0;
}

function toBoolean(value) {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") return /^(true|yes|1)$/i.test(value.trim());
  return Boolean(value);
}

function normalizeAuDate(value = "") {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const match = raw.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
  if (!match) return raw;
  const [, day, month, year] = match;
  return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
}

function loanTypeKey(loanType = "") {
  if (/refinance/i.test(loanType)) return "refinance";
  if (/commercial/i.test(loanType)) return "commercialLoan";
  if (/business/i.test(loanType)) return "businessLoan";
  if (/car/i.test(loanType)) return "carLoan";
  if (/personal/i.test(loanType)) return "personalLoan";
  return "homeLoan";
}

function loanScenarioKey(submission = {}) {
  const text = `${submission.loanType || ""} ${submission.loanPurpose || ""} ${submission.loanScenario || ""}`.toLowerCase();
  if (/commercial/.test(text)) return "commercialLoan";
  if (/business/.test(text)) return "businessLoan";
  if (/car|vehicle/.test(text)) return "carLoan";
  if (/personal/.test(text)) return "personalLoan";
  if (/refinance/.test(text) && /cash|cash.?out|equity|top.?up/.test(text)) return "refinanceCashOut";
  if (/cash.?out/.test(text)) return "refinanceCashOut";
  if (/refinance/.test(text)) return "refinance";
  return loanTypeKey(submission.loanType);
}

const requiredByLoanType = {
  homeLoan: ["propertyFoundStatus", "sourceOfDeposit", "contractStatus", "propertyUsage"],
  refinance: ["currentLender", "currentLoanBalance", "currentInterestRate", "currentRepayment", "currentLoanRepaymentType", "currentRateType", "propertyEstimatedValue", "arrearsHistory"],
  refinanceCashOut: ["currentLender", "currentLoanBalance", "currentInterestRate", "currentRepayment", "currentLoanRepaymentType", "currentRateType", "propertyEstimatedValue", "arrearsHistory", "cashOutAmount", "cashOutPurpose"],
  commercialLoan: ["borrowerEntity", "abnAcn", "companyTrustDirectorsGuarantors", "commercialPropertyAddress", "commercialPropertyType", "commercialPurchasePrice", "commercialOccupancy", "commercialIncomeEvidence", "commercialFinancialsAvailable"],
  businessLoan: ["businessLegalName", "businessTradingName", "abnAcn", "entityType", "gstRegistered", "abnStartDate", "industry", "businessAddress", "businessOwnersDirectors", "businessLoanPurpose", "businessLoanAmount", "businessLoanTerm", "businessSecurityType", "monthlyTurnover", "annualBusinessTurnover", "netProfitBeforeTax", "bankStatementsAvailable", "basAvailable", "taxReturnsAvailable"],
  carLoan: ["vehicleUse", "vehicleApplicantType", "vehicleCondition", "vehicleMake", "vehicleModel", "vehicleYear", "vehiclePrice", "saleType", "insuranceStatus"],
  personalLoan: ["personalLoanPurpose", "personalLoanAmount", "personalLoanTerm", "personalSecurityType", "fundingTimeframe", "quoteInvoiceAvailable", "paydayLoans", "bnplUse", "gamblingTransactions", "dishonoursHistory", "hardshipHistory", "recentDeclines"]
};

const requiredLabels = {
  firstName: "First / given name(s)",
  surname: "Family name / surname",
  dateOfBirth: "Date of birth",
  email: "Email",
  mobile: "Mobile",
  loanType: "Loan type",
  loanPurpose: "Loan purpose",
  loanAmount: "Loan amount",
  address: "Current residential address",
  currentSuburb: "Suburb",
  currentState: "State",
  currentAddressFromDate: "Address from date",
  currentResidentialStatus: "Residential status",
  employmentType: "Employment type",
  employerName: "Employer / business name",
  employmentFromDate: "Employment from date",
  annualIncome: "Main income p.a.",
  generalExpenses: "Monthly living expenses",
  secondApplicantFirstName: "Second applicant first name",
  secondApplicantSurname: "Second applicant surname",
  secondApplicantDateOfBirth: "Second applicant date of birth",
  secondAnnualIncome: "Second applicant income p.a.",
  propertyFoundStatus: "Property found status",
  sourceOfDeposit: "Source of deposit",
  contractStatus: "Contract status",
  propertyUsage: "Property use",
  currentLender: "Current lender",
  currentLoanBalance: "Current loan balance",
  currentInterestRate: "Current interest rate",
  currentRepayment: "Monthly repayment",
  currentLoanRepaymentType: "Current repayment type",
  currentRateType: "Current rate type",
  propertyEstimatedValue: "Estimated property value",
  arrearsHistory: "Missed repayments / arrears",
  borrowerEntity: "Borrower entity",
  abnAcn: "ABN / ACN",
  companyTrustDirectorsGuarantors: "Company, trust, directors and guarantors",
  commercialPropertyAddress: "Commercial property address",
  commercialPropertyType: "Commercial property type",
  commercialPurchasePrice: "Commercial value / purchase price",
  commercialOccupancy: "Commercial occupancy",
  commercialIncomeEvidence: "Commercial income evidence",
  commercialFinancialsAvailable: "Commercial financials available",
  businessLegalName: "Business legal name",
  businessTradingName: "Trading name",
  entityType: "Entity type",
  gstRegistered: "GST registered",
  abnStartDate: "ABN start date",
  industry: "Industry",
  businessAddress: "Business address",
  businessOwnersDirectors: "Owners / directors",
  businessLoanPurpose: "Business loan purpose",
  businessLoanAmount: "Business loan amount",
  businessLoanTerm: "Business loan term",
  businessSecurityType: "Business security type",
  monthlyTurnover: "Monthly revenue",
  annualBusinessTurnover: "Annual turnover",
  netProfitBeforeTax: "Net profit",
  bankStatementsAvailable: "Bank statements available",
  basAvailable: "BAS available",
  taxReturnsAvailable: "Tax returns available",
  vehicleUse: "Vehicle use",
  vehicleApplicantType: "Vehicle applicant type",
  vehicleCondition: "Vehicle condition",
  vehicleMake: "Vehicle make",
  vehicleModel: "Vehicle model",
  vehicleYear: "Vehicle year",
  vehiclePrice: "Vehicle purchase price",
  saleType: "Seller type",
  insuranceStatus: "Insurance status",
  personalLoanPurpose: "Personal loan purpose",
  personalLoanAmount: "Personal loan amount",
  personalLoanTerm: "Personal loan term",
  personalSecurityType: "Personal security type",
  fundingTimeframe: "Funding timeframe",
  quoteInvoiceAvailable: "Quote / invoice available",
  paydayLoans: "Payday loans",
  bnplUse: "BNPL usage",
  gamblingTransactions: "Gambling transactions",
  dishonoursHistory: "Dishonours",
  hardshipHistory: "Hardship history",
  recentDeclines: "Recent loan declines"
};

function valuePresent(value) {
  if (typeof value === "boolean") return true;
  if (typeof value === "number") return value !== 0;
  return value !== undefined && value !== null && String(value).trim() !== "";
}

function buildValidationStatus(submission) {
  const scenarioKey = loanScenarioKey(submission);
  const required = [
    "firstName",
    "surname",
    "dateOfBirth",
    "email",
    "mobile",
    "loanType",
    "loanPurpose",
    "loanAmount",
    "address",
    "currentSuburb",
    "currentState",
    "currentAddressFromDate",
    "currentResidentialStatus",
    "employmentType",
    "annualIncome",
    "generalExpenses",
    ...(submission.hasSecondApplicant === "Yes" ? ["secondApplicantFirstName", "secondApplicantSurname", "secondApplicantDateOfBirth", "secondAnnualIncome"] : []),
    ...(requiredByLoanType[scenarioKey] || [])
  ];
  if (!/unemployed|retired/i.test(submission.employmentType || "")) required.push("employerName", "employmentFromDate");
  if (submission.contractStatus === "Auction") required.push("auctionDate");
  if (submission.propertyFoundStatus === "Yes") required.push("purchasePrice", "settlementDate");
  if (submission.currentRateType === "Fixed") required.push("fixedExpiryDate");
  if (submission.saleType === "Dealer") required.push("dealerInvoiceAvailable");
  if (submission.saleType === "Private sale") required.push("privateSellerDetails");
  if (submission.vehicleUse === "Business") required.push("businessUsePercentage", "chattelMortgageRequired");
  if (submission.personalLoanPurpose === "Debt consolidation") required.push("personalDebtConsolidationDetails");
  const missingFields = [...new Set(required)].filter((key) => !valuePresent(submission[key])).map((key) => ({
    key,
    label: requiredLabels[key] || key
  }));
  const warnings = [];
  if (submission.loanTermYears && ![25, 30, 40].includes(Number(submission.loanTermYears))) warnings.push({ key: "loanTermYears", message: "Loan term is outside the common template values." });
  if (submission.creditIssue === "Yes" || submission.arrearsHistory === "Yes") warnings.push({ key: "creditHistory", message: "Broker review required for credit history." });
  return {
    ok: missingFields.length === 0,
    missingFields,
    warnings,
    generatedAt: new Date().toISOString()
  };
}

function buildNormalisedPayload(submission, validationStatus) {
  const hasSecondApplicant = submission.hasSecondApplicant === "Yes";
  return {
    applicants: [
      {
        role: "primary",
        firstName: submission.firstName,
        surname: submission.surname,
        legalName: submission.clientName,
        dateOfBirth: submission.dateOfBirth,
        gender: submission.gender || "",
        email: submission.email,
        mobile: submission.mobile,
        residencyStatus: submission.residencyStatus,
        permanentInAustralia: submission.permanentInAustralia || (submission.residencyStatus ? "Yes" : ""),
        visaSubclass: submission.visaSubclass || "",
        maritalStatus: submission.maritalStatus,
        currentResidentialStatus: submission.currentResidentialStatus || "",
        currentHousingSituation: submission.currentResidentialStatus || "",
        dependants: submission.dependants,
        id: {
          driversLicenceNo: submission.driversLicenceNo || "",
          licenceCardNumber: submission.licenceCardNumber || "",
          licenceExpiryDate: submission.licenceExpiryDate || "",
          licenceState: submission.licenceState || "",
          licenceClass: submission.licenceClass || "C"
        },
        address: {
          current: submission.address,
          suburb: submission.currentSuburb,
          state: submission.currentState,
          postcode: submission.currentPostcode || "",
          fromDate: submission.currentAddressFromDate,
          residentialStatus: submission.currentResidentialStatus,
          previous: submission.previousAddress,
          postSettlement: submission.postSettlementAddress || submission.address,
          mailing: submission.mailingAddress || submission.address
        }
      },
      ...(hasSecondApplicant ? [{
        role: "secondary",
        firstName: submission.secondApplicantFirstName,
        surname: submission.secondApplicantSurname,
        legalName: submission.secondApplicantName,
        dateOfBirth: submission.secondApplicantDateOfBirth,
        gender: submission.secondApplicantGender || "",
        email: submission.secondApplicantEmail,
        mobile: submission.secondApplicantMobile,
        residencyStatus: submission.secondApplicantResidencyStatus,
        permanentInAustralia: submission.secondApplicantPermanentInAustralia || (submission.secondApplicantResidencyStatus ? "Yes" : ""),
        visaSubclass: submission.secondApplicantVisaSubclass || "",
        maritalStatus: submission.secondApplicantMaritalStatus,
        currentResidentialStatus: submission.secondApplicantCurrentResidentialStatus || submission.currentResidentialStatus || "",
        currentHousingSituation: submission.secondApplicantCurrentResidentialStatus || submission.currentResidentialStatus || "",
        dependants: submission.secondApplicantDependants,
        id: {
          driversLicenceNo: submission.secondApplicantDriversLicenceNo || "",
          licenceCardNumber: submission.secondApplicantLicenceCardNumber || "",
          licenceExpiryDate: submission.secondApplicantLicenceExpiryDate || "",
          licenceState: submission.secondApplicantLicenceState || "",
          licenceClass: submission.secondApplicantLicenceClass || "C"
        },
        address: {
          current: submission.secondApplicantAddress || submission.address,
          suburb: submission.secondApplicantCurrentSuburb,
          state: submission.secondApplicantCurrentState,
          postcode: submission.secondApplicantCurrentPostcode || "",
          fromDate: submission.secondApplicantCurrentAddressFromDate,
          residentialStatus: submission.secondApplicantCurrentResidentialStatus,
          previous: submission.secondApplicantPreviousAddress
        }
      }] : [])
    ],
    employment: {
      primary: {
        type: submission.employmentType,
        employerName: submission.employerName,
        jobTitle: submission.occupation || submission.jobTitle || "",
        basis: submission.employmentBasis,
        fromDate: submission.employmentFromDate
      },
      secondary: hasSecondApplicant ? {
        type: submission.secondApplicantEmploymentType,
        employerName: submission.secondApplicantEmployerName,
        jobTitle: submission.secondApplicantJobTitle,
        basis: submission.secondApplicantEmploymentBasis,
        fromDate: submission.secondApplicantEmploymentFromDate
      } : null
    },
    income: {
      primaryAnnual: submission.annualIncome,
      secondaryAnnual: submission.secondAnnualIncome,
      rentalAnnual: submission.rentalIncomeAnnual,
      monthlyTurnover: submission.monthlyTurnover,
      annualBusinessTurnover: submission.annualBusinessTurnover,
      netProfitBeforeTax: submission.netProfitBeforeTax
    },
    assets: {
      cashSavingsAmount: submission.cashSavingsAmount,
      cashSavingsBank: submission.cashSavingsBank,
      realEstateAssetAddress: submission.realEstateAssetAddress,
      realEstateAssetValue: submission.realEstateAssetValue,
      motorVehicleModelYear: submission.motorVehicleModelYear,
      motorVehicleValue: submission.motorVehicleValue,
      financialAssetBuffer: submission.financialAssetBuffer
    },
    liabilities: {
      existingDebtsSummary: submission.existingDebtsSummary,
      currentLender: submission.currentLender,
      currentLoanBalance: submission.currentLoanBalance,
      currentRepayment: submission.currentRepayment,
      currentInterestRate: submission.currentInterestRate,
      arrearsHistory: submission.arrearsHistory
    },
    expenses: {
      generalMonthly: submission.generalExpenses,
      applicant1Monthly: submission.applicant1Expenses,
      applicant2Monthly: submission.applicant2Expenses,
      hemMonthly: submission.hemMonthly
    },
    loanRequest: {
      loanType: submission.loanType,
      loanScenario: submission.loanScenario,
      loanPurpose: submission.loanPurpose,
      loanAmount: submission.loanAmount || submission.businessLoanAmount || submission.personalLoanAmount,
      loanTermYears: submission.loanTermYears,
      repaymentType: submission.repaymentType,
      ratePreference: submission.ratePreference,
      offsetRequested: submission.offsetRequested,
      propertyFoundStatus: submission.propertyFoundStatus,
      purchasePrice: submission.purchasePrice,
      sourceOfDeposit: submission.sourceOfDeposit,
      contractStatus: submission.contractStatus,
      settlementDate: submission.settlementDate,
      financeClauseDate: submission.financeClauseDate,
      cashOutAmount: submission.cashOutAmount,
      cashOutPurpose: submission.cashOutPurpose
    },
    securityProperties: {
      propertyLocation: submission.propertyLocation,
      propertyType: submission.propertyType,
      propertyUsage: submission.propertyUsage,
      propertyValue: submission.propertyValue || submission.propertyEstimatedValue,
      commercialPropertyAddress: submission.commercialPropertyAddress,
      commercialPropertyType: submission.commercialPropertyType,
      commercialPurchasePrice: submission.commercialPurchasePrice,
      commercialOccupancy: submission.commercialOccupancy
    },
    businesses: {
      borrowerEntity: submission.borrowerEntity,
      businessLegalName: submission.businessLegalName,
      businessTradingName: submission.businessTradingName,
      abnAcn: submission.abnAcn || submission.businessAbnAcn,
      entityType: submission.entityType || submission.businessStructure,
      gstRegistered: submission.gstRegistered,
      abnStartDate: submission.abnStartDate,
      industry: submission.industry,
      businessOwnersDirectors: submission.businessOwnersDirectors,
      businessLoanPurpose: submission.businessLoanPurpose,
      commercialLeaseDetails: submission.commercialLeaseDetails,
      commercialAnnualRent: submission.commercialAnnualRent,
      commercialTenantDetails: submission.commercialTenantDetails,
      commercialIncomeEvidence: submission.commercialIncomeEvidence,
      commercialFinancialsAvailable: submission.commercialFinancialsAvailable,
      existingBusinessDebts: submission.existingBusinessDebts,
      atoDebtPaymentPlan: submission.atoDebtPaymentPlan
    },
    vehicles: {
      vehicleUse: submission.vehicleUse,
      vehicleApplicantType: submission.vehicleApplicantType,
      vehicleCondition: submission.vehicleCondition,
      make: submission.vehicleMake,
      model: submission.vehicleModel,
      year: submission.vehicleYear,
      variant: submission.vehicleVariant,
      vin: submission.vehicleVin,
      rego: submission.vehicleRego,
      odometer: submission.vehicleOdometer,
      purchasePrice: submission.vehiclePrice,
      sellerType: submission.saleType,
      privateSellerDetails: submission.privateSellerDetails,
      balloonResidual: submission.balloonResidual,
      insuranceStatus: submission.insuranceStatus,
      businessUsePercentage: submission.businessUsePercentage,
      chattelMortgageRequired: submission.chattelMortgageRequired
    },
    documents: {
      bankStatementsAvailable: submission.bankStatementsAvailable,
      basAvailable: submission.basAvailable,
      taxReturnsAvailable: submission.taxReturnsAvailable,
      quoteInvoiceAvailable: submission.quoteInvoiceAvailable,
      dealerInvoiceAvailable: submission.dealerInvoiceAvailable,
      equipmentQuoteInvoice: submission.equipmentQuoteInvoice
    },
    consents: {
      privacyAndCreditConsent: submission.privacyAndCreditConsent || ""
    },
    brokerNotes: {
      clientNotes: submission.clientNotes,
      creditIssue: submission.creditIssue,
      personalLoanRisks: {
        paydayLoans: submission.paydayLoans,
        bnplUse: submission.bnplUse,
        gamblingTransactions: submission.gamblingTransactions,
        dishonoursHistory: submission.dishonoursHistory,
        hardshipHistory: submission.hardshipHistory,
        recentDeclines: submission.recentDeclines
      }
    },
    validationStatus
  };
}

function buildPlatformPayload(platform, normalisedPayload) {
  return {
    platform,
    generatedAt: new Date().toISOString(),
    applicants: normalisedPayload.applicants,
    employment: normalisedPayload.employment,
    income: normalisedPayload.income,
    assets: normalisedPayload.assets,
    liabilities: normalisedPayload.liabilities,
    expenses: normalisedPayload.expenses,
    loanRequest: normalisedPayload.loanRequest,
    securityProperties: normalisedPayload.securityProperties,
    businesses: normalisedPayload.businesses,
    vehicles: normalisedPayload.vehicles,
    documents: normalisedPayload.documents,
    consents: normalisedPayload.consents,
    brokerNotes: normalisedPayload.brokerNotes,
    validationStatus: normalisedPayload.validationStatus
  };
}

function buildBrokerReviewSummary(normalisedPayload) {
  const primary = normalisedPayload.applicants[0]?.legalName || "Client";
  const coApplicant = normalisedPayload.applicants[1]?.legalName;
  const loan = normalisedPayload.loanRequest;
  const lines = [
    `${primary}${coApplicant ? ` and ${coApplicant}` : ""}`,
    `${loan.loanType || "Loan"} - ${loan.loanPurpose || "purpose not set"}`,
    `Requested amount: $${Number(loan.loanAmount || 0).toLocaleString("en-AU")}`,
    `Income: $${Number(normalisedPayload.income.primaryAnnual || 0).toLocaleString("en-AU")} primary${normalisedPayload.income.secondaryAnnual ? `, $${Number(normalisedPayload.income.secondaryAnnual).toLocaleString("en-AU")} secondary` : ""}`,
    `Living expenses: $${Number(normalisedPayload.expenses.generalMonthly || normalisedPayload.expenses.hemMonthly || 0).toLocaleString("en-AU")} / month`,
    normalisedPayload.validationStatus.ok ? "Validation: complete" : `Validation: ${normalisedPayload.validationStatus.missingFields.length} missing item(s)`
  ];
  return lines.filter(Boolean);
}

function attachClientIntakePayloads(base, rawBody = {}) {
  const rawSubmission = { ...rawBody };
  delete rawSubmission.rawSubmission;
  delete rawSubmission.normalisedPayload;
  delete rawSubmission.infinityPayload;
  delete rawSubmission.aolPayload;
  delete rawSubmission.validationStatus;
  delete rawSubmission.brokerReviewSummary;
  const validationStatus = buildValidationStatus(base);
  const normalisedPayload = buildNormalisedPayload(base, validationStatus);
  return {
    ...base,
    rawSubmission,
    normalisedPayload,
    infinityPayload: buildPlatformPayload("infinity", normalisedPayload),
    aolPayload: buildPlatformPayload("aol", normalisedPayload),
    validationStatus,
    brokerReviewSummary: buildBrokerReviewSummary(normalisedPayload)
  };
}

function composeLegalName(firstName, middleName, surname, fallback = "") {
  const name = [firstName, middleName, surname].map((part) => String(part || "").trim()).filter(Boolean).join(" ");
  return name || String(fallback || "").trim();
}

function stripVietnameseMarks(value = "") {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D");
}

function normalizeSearchText(value = "") {
  return stripVietnameseMarks(value).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function splitName(fullName = "") {
  const parts = String(fullName).trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return { firstName: "", middleName: "", lastName: "" };
  if (parts.length === 1) return { firstName: parts[0], middleName: "", lastName: "" };
  return { firstName: parts.slice(0, -1).join(" "), middleName: "", lastName: parts.at(-1) };
}

function buildLocalCaseFromCallNote(note) {
  const primary = splitName(note.clientName);
  const secondary = splitName(note.secondApplicantName);
  const applicants = [
    {
      role: "primary",
      firstName: note.firstName || primary.firstName,
      middleName: note.middleName || primary.middleName || "",
      lastName: note.surname || primary.lastName,
      dateOfBirth: note.dateOfBirth || "",
      gender: note.gender || "",
      maritalStatus: note.maritalStatus || "Single",
      residencyStatus: note.residencyStatus || "",
      permanentInAustralia: note.permanentInAustralia || (note.residencyStatus ? "Yes" : ""),
      dependants: Number(note.dependants || 0),
      email: note.email || "",
      mobile: note.mobile || "",
      address: {
        line1: note.address || "",
        suburb: note.currentSuburb || "",
        state: note.currentState || "",
        postcode: note.currentPostcode || "",
        country: "Australia",
        fromDate: note.currentAddressFromDate || "",
        postSettlement: note.postSettlementAddress || note.address || "",
        mailing: note.mailingAddress || note.address || ""
      },
      id: {
        driversLicenceNo: note.driversLicenceNo || "",
        licenceCardNumber: note.licenceCardNumber || "",
        licenceExpiryDate: note.licenceExpiryDate || "",
        licenceState: note.licenceState || "",
        licenceClass: note.licenceClass || "C"
      },
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
      firstName: note.secondApplicantFirstName || secondary.firstName,
      middleName: note.secondApplicantMiddleName || secondary.middleName || "",
      lastName: note.secondApplicantSurname || secondary.lastName,
      dateOfBirth: note.secondApplicantDateOfBirth || "",
      gender: note.secondApplicantGender || "",
      maritalStatus: note.secondApplicantMaritalStatus || note.maritalStatus || "Married",
      residencyStatus: note.secondApplicantResidencyStatus || "",
      permanentInAustralia: note.secondApplicantPermanentInAustralia || (note.secondApplicantResidencyStatus ? "Yes" : ""),
      dependants: Number(note.secondApplicantDependants || 0),
      email: note.secondApplicantEmail || "",
      mobile: note.secondApplicantMobile || "",
      address: {
        line1: note.secondApplicantAddress || note.address || "",
        suburb: note.secondApplicantCurrentSuburb || "",
        state: note.secondApplicantCurrentState || "",
        postcode: note.secondApplicantCurrentPostcode || "",
        country: "Australia"
      },
      id: {
        driversLicenceNo: note.secondApplicantDriversLicenceNo || "",
        licenceCardNumber: note.secondApplicantLicenceCardNumber || "",
        licenceExpiryDate: note.secondApplicantLicenceExpiryDate || "",
        licenceState: note.secondApplicantLicenceState || "",
        licenceClass: note.secondApplicantLicenceClass || "C"
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
    clientProfile: {
      currentHousingSituation: note.currentResidentialStatus || ""
    },
    documentChecklist: []
  };
}

function latestLinkedIntakeForCase(caseData) {
  if (!caseData?.id) return null;
  const sourceCallNoteId = caseData.sourceCallNoteId;
  return [...clientIntakes]
    .filter((intake) =>
      intake?.submission &&
      (intake.caseId === caseData.id ||
        (sourceCallNoteId && intake.callNoteId === sourceCallNoteId) ||
        callNotes.some((note) => note.id === intake.callNoteId && note.convertedCaseId === caseData.id))
    )
    .sort((a, b) => new Date(b.updatedAt || b.submittedAt || b.createdAt || 0) - new Date(a.updatedAt || a.submittedAt || a.createdAt || 0))[0] || null;
}

function hydrateCaseFromLinkedLoanForm(caseData) {
  const intake = latestLinkedIntakeForCase(caseData);
  if (!intake?.submission) return caseData;
  const note = callNotes.find((item) => item.id === intake.callNoteId) || {};
  const combined = {
    ...note,
    ...(intake.submission || {}),
    id: note.id || caseData.sourceCallNoteId || intake.callNoteId,
    brokerUser: caseData.brokerUser || note.brokerUser || intake.brokerUser,
    convertedCaseId: caseData.id
  };
  const hydrated = buildLocalCaseFromCallNote(combined);
  return {
    ...caseData,
    ...hydrated,
    id: caseData.id,
    status: caseData.status,
    sourceCallNoteId: caseData.sourceCallNoteId || note.id || intake.callNoteId,
    brokerUser: caseData.brokerUser || hydrated.brokerUser
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
  let events = caseHistory.get(caseId) || [];
  // Capture events keep ONE entry per key (latest wins) so frequent live snapshots don't bloat the log or
  // evict other captures (lender/rate/overrides) within the cap. Audit/non-capture events still append.
  if (event.type === "capture" && event.key) {
    events = events.filter((existing) => !(existing.type === "capture" && existing.key === event.key));
  }
  events.unshift({ ...event, caseId, timestamp: event.timestamp || new Date().toISOString() });
  caseHistory.set(caseId, events.slice(0, 80));
  persistHistory(); // writes to Supabase app_kv (if SUPABASE_ENABLED) or local disk on every capture
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

function pickTemplateIdForCase(caseData) {
  const applicants = Array.isArray(caseData?.applicants) ? caseData.applicants.filter(Boolean) : [];
  const isCouple = applicants.length >= 2;
  const category = classifyLoanPurpose(caseData); // occupancy-first; never the free-text opportunityName
  const id = category === "refinance" ? (isCouple ? "couple-refinance-cashout" : "refinance-cashout")
    : category === "investment" ? (isCouple ? "couple-investor-preapproval" : "single-investor-preapproval")
    : (isCouple ? "couple-owner-occupied-purchase" : "single-owner-occupied-purchase");
  try {
    console.log(`[pickTemplate] case=${caseData?.caseId || caseData?.id || "?"} occupancy="${(caseData?.property?.occupancy || "").trim()}" category=${category} couple=${isCouple} -> ${id}`);
  } catch (_e) { /* logging only */ }
  return id;
}

// Apply the broker's captured edits (brokerOverrides, from Infinity OR AOL — symmetric) over the case
// data BEFORE building the payload, so a re-Prepare carries the broker's latest numbers to BOTH systems.
// Bounded + safe: only coarse fields that exist in the case data (income now), only when the override has
// a clear label + numeric value; otherwise the loan-form value stands. Source-agnostic (any platform).
function applyBrokerFinancialOverrides(caseData) {
  try {
    const events = (typeof caseHistory?.get === "function" && caseHistory.get(caseData?.id)) || [];
    const ev = events.find((e) => e.type === "capture" && e.key === "brokerOverrides");
    const ov = ev && ev.data && typeof ev.data === "object" ? ev.data : null;
    if (!ov) return caseData;
    const applicants = Array.isArray(caseData.applicants) ? caseData.applicants : [];
    const primary = applicants.find((a) => a && a.role === "primary") || applicants[0];
    if (!primary) return caseData;
    primary.income = primary.income || {};
    for (const o of Object.values(ov)) {
      if (!o || o.value == null || o.value === "") continue;
      const label = String(o.label || "").toLowerCase();
      const num = Number(String(o.value).replace(/[^0-9.]/g, ""));
      if (!num || !Number.isFinite(num)) continue;
      if (/rental/.test(label)) primary.income.rentalAnnual = num;
      else if (/base salary|annual income|gross salary|gross annual|payg income|\bincome p\.?a\b|^salary$|^income$/.test(label)) primary.income.baseAnnual = num;
    }
  } catch (error) { console.warn(`broker override merge failed: ${error.message}`); }
  return caseData;
}

function prepareCase(caseData, source = "prepare", options = {}) {
  const sourceCase = applyBrokerFinancialOverrides(hydrateCaseFromLinkedLoanForm(caseData));
  // Auto-pick a scenario-matched template on first prepare; broker can still override by passing templateId.
  if (!options.templateId && !documentDrafts.get(sourceCase.id)) {
    const autoTemplateId = pickTemplateIdForCase(sourceCase);
    if (autoTemplateId) options.templateId = autoTemplateId;
  }
  if (options.templateId || options.templateOverrides || options.hemMonthly || options.financialAssetBuffer || options.manualIntake) {
    const draft = buildDocumentDraft([], {
      templateId: options.templateId,
      templateOverrides: options.templateOverrides,
      hemMonthly: options.hemMonthly,
      financialAssetBuffer: options.financialAssetBuffer,
      manualIntake: options.manualIntake
    });
    documentDrafts.set(sourceCase.id, draft);
  }

  const mergedCase = mergeDocumentDraft(sourceCase, documentDrafts.get(sourceCase.id));
  const payload = buildInfinityPayload(mergedCase);
  const validation = validateInfinityPayload(payload);
  const token = crypto.randomBytes(16).toString("hex");
  const prepared = {
    token,
    caseId: sourceCase.id,
    brokerUser: sourceCase.brokerUser,
    payload,
    validation,
    mappingVersion: payload.meta.mappingVersion,
    preparedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString()
  };

  preparedCases.set(token, prepared);
  preparedCases.set(sourceCase.id, prepared);
  persistPrepared(prepared);
  audit({
    type: source,
    timestamp: new Date().toISOString(),
    brokerUser: sourceCase.brokerUser,
    caseId: sourceCase.id,
    token,
    errors: validation.issues.filter((issue) => issue.severity === "error").length,
    warnings: validation.issues.filter((issue) => issue.severity === "warning").length
  });
  pushCaseHistory(sourceCase.id, summarizePrepared(prepared, source));

  return prepared;
}

migrateLegacyJsonToDataDir();
await hydrateStoredData();
persistBackupSnapshot();

app.get("/api/health", (_request, response) => {
  response.json({
    ok: true,
    service: "Infinity AOL AutoFill Assistant",
    commit: process.env.RENDER_GIT_COMMIT || process.env.GIT_COMMIT || "local",
    deployedAt: process.env.RENDER_DEPLOY_TIME || null,
    templateIds: listTemplates().map((t) => t.id),
    time: new Date().toISOString()
  });
});

app.get("/api/storage/status", (_request, response) => {
  response.json(storageState);
});

app.get("/api/loan-form-import-template", (request, response) => {
  if (!canReadLoanSubmissions(request)) return response.status(403).json({ error: "Broker access required for Loan Form import template." });
  response.type("text/markdown").send(fs.readFileSync(loanFormImportTemplatePath, "utf8"));
});

app.get("/api/cases", (_request, response) => {
  response.json([...localCases, ...cases].map(summarizeCase));
});

app.get("/api/cases/:caseId", (request, response) => {
  const caseData = findCase(request.params.caseId);
  if (!caseData) return response.status(404).json({ error: "Case not found" });
  const events = caseHistory.get(request.params.caseId) || [];
  const latestNote = events.find((event) => event.type === "loan-form-mismatch");
  const captures = {};
  for (const event of events) {
    if (event.type === "capture" && event.key && !(event.key in captures)) captures[event.key] = event.data;
  }
  response.json({ ...caseData, loanFormNotes: latestNote?.mismatches || [], loanFormNoteAt: latestNote?.timestamp || null, captures });
});

// Records a Loan-Form-vs-Infinity divergence note on the case (persisted to caseHistory).
app.post("/api/cases/:caseId/loan-form-note", (request, response) => {
  if (!extTokenOk(request)) return response.status(401).json({ error: "unauthorized" });
  const caseId = request.params.caseId;
  const mismatches = Array.isArray(request.body?.mismatches) ? request.body.mismatches : [];
  pushCaseHistory(caseId, {
    type: "loan-form-mismatch",
    brokerUser: request.body?.brokerUser || "unknown",
    mismatches
  });
  response.json({ ok: true, caseId, count: mismatches.length });
});

// Generic per-case capture store (internal autofill data — lender scenarios now, more later).
// Mirrors loan-form-note: persisted via caseHistory; GET returns the latest entry per key.
// This is the EasyFlow AI internal source of truth that bridges Infinity ↔ AOL and feeds the
// bidirectional sync (changes captured on one platform are reusable on the other).
app.post("/api/cases/:caseId/capture", (request, response) => {
  if (!extTokenOk(request)) return response.status(401).json({ error: "unauthorized" });
  const caseId = request.params.caseId;
  const key = String(request.body?.key || "").trim();
  if (!key) return response.status(400).json({ error: "capture key required" });
  pushCaseHistory(caseId, {
    type: "capture",
    key,
    brokerUser: request.body?.brokerUser || "unknown",
    platform: request.body?.platform || null,
    data: request.body?.data ?? null
  });
  response.json({ ok: true, caseId, key });
});

app.get("/api/cases/:caseId/capture/:key", (request, response) => {
  const events = caseHistory.get(request.params.caseId) || [];
  const latest = events.find((event) => event.type === "capture" && event.key === request.params.key);
  response.json({
    ok: true,
    caseId: request.params.caseId,
    key: request.params.key,
    data: latest?.data ?? null,
    capturedAt: latest?.timestamp || null
  });
});

// Per-lender learned AOL template (Compliance R&O reason selections etc.). Each lender's AOL form
// differs, so the bot reads this template before filling and writes back any NEW selections it sees —
// the template self-learns per lender across cases. GET returns the stored template; POST merges in.
app.get("/api/aol-templates/:lender", (request, response) => {
  const key = lenderKey(request.params.lender);
  response.json({ ok: true, lender: key, template: aolTemplates.get(key) || null });
});

app.post("/api/aol-templates/:lender", (request, response) => {
  if (!extTokenOk(request)) return response.status(401).json({ error: "unauthorized" });
  const key = lenderKey(request.params.lender);
  const incoming = request.body && typeof request.body === "object" ? request.body : {};
  const prev = aolTemplates.get(key) || {};
  const incomingReasons = (Array.isArray(incoming.reasons) ? incoming.reasons : [])
    .map((value) => String(value || "").trim().toLowerCase()).filter(Boolean);
  // replace=true → the broker DELIBERATELY taught this exact set (overwrite, so corrections stick).
  // Otherwise union (additive learning). The reasons are always de-duplicated.
  const reasons = incoming.replace
    ? Array.from(new Set(incomingReasons))
    : Array.from(new Set([
        ...(Array.isArray(prev.reasons) ? prev.reasons : []).map((value) => String(value || "").trim().toLowerCase()).filter(Boolean),
        ...incomingReasons
      ]));
  const template = {
    ...prev,
    ...incoming,
    reasons,
    lender: key,
    learnedAt: new Date().toISOString()
  };
  delete template.replace;
  aolTemplates.set(key, template);
  persistAolTemplates();
  response.json({ ok: true, lender: key, template });
});

app.delete("/api/cases/:caseId/local-data", (request, response) => {
  const caseId = request.params.caseId;
  const expected = `DELETE ${caseId}`;
  if (request.body?.confirm !== expected) {
    return response.status(400).json({ error: `Type ${expected} to confirm local data deletion.` });
  }

  const result = deleteLocalCaseData(caseId);
  audit({
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

// ---- Document generation (YTD Calculator + Recommendation Notes) ----
// Server-side so BOTH the EasyFlow web app and the Chrome extension can trigger a download from the same
// case data. Auth-gated like the other write endpoints (x-easyflow-ext-token).
function sendDocFile(response, buffer, filename, mime) {
  response.setHeader("Content-Type", mime);
  response.setHeader("Content-Disposition", `attachment; filename="${String(filename).replace(/[^\w.\-]+/g, "_")}"`);
  // Expose the header so the extension (cross-origin fetch) can read the case-named filename.
  response.setHeader("Access-Control-Expose-Headers", "Content-Disposition");
  response.setHeader("Content-Length", buffer.length);
  response.send(buffer);
}
const slug = (s) => String(s || "client").toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 60) || "CLIENT";
function getCapture(caseId, key) {
  const ev = (caseHistory.get(caseId) || []).find((e) => e.type === "capture" && e.key === key);
  return ev ? ev.data : null;
}
// Per-case document history ("last downloaded / not yet"), persisted as a capture so it follows the case
// across the broker's devices (Windows + Mac). { ytd|recPdf|recDocx: { at, by, count } }.
function recordDocHistory(caseId, docKey, brokerName) {
  if (!caseId || caseId === "manual") return;
  const hist = getCapture(caseId, "docHistory") || {};
  hist[docKey] = { at: new Date().toISOString(), by: brokerName || "broker", count: ((hist[docKey] && hist[docKey].count) || 0) + 1 };
  pushCaseHistory(caseId, { type: "capture", key: "docHistory", brokerUser: brokerName || "broker", data: hist });
}
function applicantFullName(a) { return [a?.firstName, a?.lastName || a?.surname].filter(Boolean).join(" ").trim(); }
function applicantLastName(a) { return (a?.lastName || a?.surname || String(a?.firstName || "").trim().split(/\s+/).slice(-1)[0] || "").trim(); }
// Prefill a Recommendation Note from the prepared case so the broker only has to click Download (then
// refine in the web form). Structured facts are accurate; narrative is a sensible seed.
const docMoney = (v) => (Number(v) ? "$" + Number(v).toLocaleString("en-AU") : "");
function applicantIncomeNarrative(a) {
  const name = applicantFullName(a) || "The applicant";
  const emp = a?.employment || {}, inc = a?.income || {};
  const selfEmployed = /self|director|sole|abn/i.test(`${emp.status || ""} ${emp.basis || ""} ${emp.type || ""} ${emp.employmentType || ""}`);
  const out = [];
  if (selfEmployed && emp.employerName) {
    out.push(`${name} is self-employed and operates ${emp.employerName}${emp.abn ? ` (ABN: ${emp.abn})` : ""}${emp.occupation ? ` as a ${emp.occupation}` : ""}. Income has been verified via the accountant's letter and company financials. Annual income = ${docMoney(inc.baseAnnual) || "the stated amount"} p.a.`);
  } else if (emp.employerName) {
    const st = String(emp.status || "").toLowerCase();
    const basis = /part/.test(st) ? "part-time" : /casual/.test(st) ? "casual" : "full-time"; // payg/paye/salary/blank → full-time
    out.push(`${name} is employed ${basis}${emp.occupation ? ` as a ${emp.occupation}` : ""} at ${emp.employerName}${emp.startDate || emp.since ? ` since ${emp.startDate || emp.since}` : ""}. Income is verified from the most recent payslips at a base of ${docMoney(inc.baseAnnual) || "the stated amount"} p.a.`);
  } else if (inc.baseAnnual) {
    out.push(`${name} has a verified income of ${docMoney(inc.baseAnnual)} p.a.`);
  }
  if (Number(inc.overtimeAnnual)) out.push(`Overtime of ${docMoney(inc.overtimeAnnual)} p.a. is also received but not required for servicing.`);
  if (Number(inc.bonusAnnual)) out.push(`Bonus income of ${docMoney(inc.bonusAnnual)} p.a. is received.`);
  if (Number(inc.governmentAnnual || inc.pensionAnnual)) out.push(`Government benefit / Age Pension income of ${docMoney(inc.governmentAnnual || inc.pensionAnnual)} p.a. is received, verified via Centrelink statements and adopted at 100% for servicing.`);
  return out.join(" ");
}
function applicantTotalIncome(a) {
  const inc = a?.income || {};
  return ["baseAnnual", "overtimeAnnual", "bonusAnnual", "rentalAnnual", "governmentAnnual", "pensionAnnual"].reduce((s, k) => s + (Number(inc[k]) || 0), 0);
}
// Expanded, lender-facing VISA / residency narrative — scenario-aware (citizen / PR / temporary / joint),
// neutral wording by default, gendered only when the case records gender, with missing-data fallbacks.
function buildVisaNarrative(apps = []) {
  const list = (apps || []).filter(Boolean);
  if (!list.length) return "Residency status is to be confirmed and should be verified before lodgement.";
  const classify = (a) => {
    const r = String(a?.residencyStatus || "").toLowerCase();
    if (/citizen/.test(r)) return "citizen";
    if (/permanent|\bpr\b/.test(r)) return "pr";
    if (/temporary|temp|bridging|student|subclass|\bvisa\b|\b\d{3}\b/.test(r)) return "temp";
    if (!r.trim()) return "unknown";
    return "pr"; // a stated-but-unrecognised status is treated as a residency we name verbatim below
  };
  const genderOf = (a) => {
    const g = `${a?.gender || ""} ${a?.title || ""}`.toLowerCase();
    if (/\b(male|^m$|^mr$)\b/.test(g) || /\bmr\b/.test(g)) return "m";
    if (/\b(female|^f$|^ms$|^mrs$|^miss$)\b/.test(g) || /\b(ms|mrs|miss)\b/.test(g)) return "f";
    return "";
  };
  const surname = (a) => applicantLastName(a) || applicantFullName(a) || "the applicant";
  const ref = (a) => { const g = genderOf(a); return g === "m" ? `Mr ${surname(a)}` : g === "f" ? `Ms ${surname(a)}` : "the applicant"; };
  const poss = (a) => { const g = genderOf(a); return g === "m" ? "his" : g === "f" ? "her" : "their"; };
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
  const subclassOf = (a) => a?.visaSubclass || (String(a?.residencyStatus || "").match(/subclass\s*(\d+[a-z]?)/i) || [])[1] || "";
  const subclassPr = (a) => { const s = subclassOf(a); return s ? ` under subclass ${s}` : ""; };
  const tempDetail = (a) => {
    const type = a?.visaType || "temporary";
    const sc = subclassOf(a);
    const sub = sc ? `, subclass ${sc}` : "";
    const exp = a?.visaExpiry ? `, with an expiry date of ${a.visaExpiry}` : "";
    return { type, sub, exp, expMissing: !a?.visaExpiry };
  };
  const single = (a) => {
    const name = applicantFullName(a) || "The applicant";
    const k = classify(a);
    if (k === "citizen") {
      return `${name} is an Australian citizen. This provides unrestricted rights to live and work in Australia and supports ${poss(a)} long-term residency stability. Based on the information provided, there are no residency or visa-related concerns that would adversely impact ${poss(a)} ability to remain in Australia, maintain employment, or meet the proposed loan obligations.`;
    }
    if (k === "temp") {
      const d = tempDetail(a);
      return `${name} currently holds a ${d.type} visa${d.sub}${d.exp}.${d.expMissing ? " Visa expiry date is to be confirmed." : ""} The visa permits ${ref(a)} to live and work in Australia, subject to the visa conditions. ${cap(poss(a))} employment, income position, and residency history have been considered in the assessment. Based on the information provided, the applicant's visa position appears acceptable for the proposed lending, subject to lender policy, verification of visa conditions, and any applicable maximum LVR or eligibility restrictions.`;
    }
    if (k === "unknown") {
      return `${name}'s residency status is to be confirmed and should be verified before lodgement.`;
    }
    // PR (or a stated residency we name verbatim)
    const status = /permanent|\bpr\b/i.test(a?.residencyStatus || "") || !a?.residencyStatus ? "an Australian Permanent Resident" : `a ${a.residencyStatus}`;
    return `${name} is ${status}${subclassPr(a)}. This provides ${ref(a)} with stable and ongoing rights to live and work in Australia. ${cap(poss(a))} residency status supports long-term stability and reduces lender risk from a residency perspective. Based on the information provided, no material visa or residency restrictions have been identified that would adversely affect ${poss(a)} ability to remain in Australia, continue employment, or meet the proposed loan repayments over the loan term.`;
  };
  if (list.length === 1) return single(list[0]);

  // Joint — both stable (citizen/PR) vs mixed (one stable, one temporary).
  const stable = list.filter((a) => classify(a) === "citizen" || classify(a) === "pr");
  const temps = list.filter((a) => classify(a) === "temp");
  const statusPhrase = (a) => {
    const k = classify(a);
    if (k === "citizen") return "an Australian citizen";
    if (k === "pr") return "an Australian Permanent Resident";
    return a?.residencyStatus ? `a ${a.residencyStatus}` : "to be confirmed";
  };
  if (temps.length === 0) {
    const names = list.map(applicantFullName);
    const allSame = list.every((a) => statusPhrase(a) === statusPhrase(list[0]));
    const lead = allSame
      ? `${names.join(" and ")} are ${statusPhrase(list[0]).replace(/^an? /, list.length > 1 ? "" : "")}${allSame && /resident/i.test(statusPhrase(list[0])) ? "s" : ""}.`
      : list.map((a) => `${applicantFullName(a)} is ${statusPhrase(a)}.`).join(" ");
    return `${lead} Both applicants have stable rights to live and work in Australia, supporting long-term residency stability and ongoing repayment capacity. Based on the information provided, no material residency or visa-related concerns have been identified that would adversely impact the applicants' ability to remain in Australia or meet the proposed loan obligations.`;
  }
  // Mixed residency
  const prA = stable[0] || list[0];
  const tmpA = temps[0];
  const d = tempDetail(tmpA);
  const lead = `${applicantFullName(prA)} is ${statusPhrase(prA)}. ${applicantFullName(tmpA)} holds a ${d.type} visa${d.sub}${d.exp}.${d.expMissing ? " Visa expiry date is to be confirmed." : ""}`;
  return `${lead} The applicants' combined residency position has been considered in line with the proposed lending structure. ${applicantFullName(prA)} provides residency stability as ${poss(prA)} status allows ongoing residence and work rights in Australia. ${applicantFullName(tmpA)}'s visa position is subject to lender policy and verification. Based on the information provided, no material issue has been identified that would prevent the application from being assessed, subject to lender visa policy, LVR restrictions, and standard verification.`;
}

function buildRecInputFromCase(caseData, opts = {}) {
  const snapshot = getCapture(caseData?.id, "liveCaseSnapshot") || null;
  const liveFin = (snapshot && snapshot.financials) || getCapture(caseData?.id, "infinityFinancials") || getCapture(caseData?.id, "aolFinancials") || {};
  const nameFirst = (n) => { const p = String(n || "").trim().split(/\s+/); return p.slice(0, -1).join(" ") || String(n || ""); };
  const nameLast = (n) => { const p = String(n || "").trim().split(/\s+/); return p.length > 1 ? p[p.length - 1] : ""; };
  // A real income row must have a positive amount AND not be a loan/security/submission line that can sneak
  // into the financials list (e.g. "Prepare Loan Submission $275,000" owned by "PURCHASE OWNER OCCUPIED DWELLING").
  const INCOME_JUNK = /\b(loan|submission|prepare|purchase|dwelling|security|securit|deposit|lvr|valuation|settlement|refinance|property|liability|liabilit|expense|asset)\b/i;
  const isRealIncome = (i) => Number(i.amount) > 0 && !INCOME_JUNK.test(`${i.type || ""} ${i.ownership || ""}`);
  const realLiveIncomes = (liveFin.incomes || []).filter(isRealIncome);
  // CURRENT applicants, most reliable first: the live income OWNERSHIP names (real data the broker entered
  // in Infinity), then the scraped Client-Details snapshot, then the loan-form case (customer's original).
  const incomeOwners = [...new Set(realLiveIncomes.map((i) => String(i.ownership || "").trim()).filter(Boolean))];
  const caseApps = (caseData?.applicants || []).filter(Boolean);
  const nameKey = (s) => String(s || "").toLowerCase().replace(/[^a-z]/g, "");
  // Enrich a live applicant name with the matching case applicant's residency/employment (matched by a
  // shared name token), so VISA + employment detail are kept while the count/name come from live data.
  const enrichApplicant = (name) => {
    const nk = nameKey(name);
    const match = caseApps.find((ca) => {
      const ck = nameKey(applicantFullName(ca));
      return ck && (nk.includes(ck) || ck.includes(nk) || applicantFullName(ca).split(/\s+/).some((t) => t.length > 2 && nk.includes(nameKey(t))));
    }) || {};
    return {
      firstName: nameFirst(name), lastName: nameLast(name), role: "primary",
      residencyStatus: match.residencyStatus, employment: match.employment, income: match.income,
      gender: match.gender, title: match.title,
      visaType: match.visaType, visaSubclass: match.visaSubclass, visaExpiry: match.visaExpiry || match.visaExpiryDate
    };
  };
  let apps;
  if (incomeOwners.length) {
    apps = incomeOwners.map(enrichApplicant);
  } else if (snapshot && Array.isArray(snapshot.applicants) && snapshot.applicants.length) {
    apps = snapshot.applicants.map((a) => ({ firstName: nameFirst(a.name), lastName: nameLast(a.name), role: "primary" }));
  } else {
    apps = (caseData?.applicants || []).filter(Boolean);
  }
  if (opts.single || opts.primaryOnly) apps = apps.slice(0, 1); // broker applies with one borrower only
  // Prefer the LIVE Infinity employment + profile (current role, residency/visa, gender) over the loan-form's
  // original, which can be stale. Single applicant only — the scrape reads the active applicant.
  const liveProfile = (snapshot && snapshot.profile) || {};
  if (apps.length === 1 && snapshot) {
    const emp = snapshot.employment || {};
    // Use the LIVE employment ONLY (do not merge the loan-form's original) — the stale record can carry an old
    // occupation like "Director" from a previous role, and mixing it with the live employer is wrong.
    if (emp.employerName || emp.occupation) apps[0] = { ...apps[0], employment: emp };
    apps[0] = {
      ...apps[0],
      residencyStatus: liveProfile.residencyStatus || apps[0].residencyStatus,
      visaSubclass: liveProfile.visaSubclass || apps[0].visaSubclass,
      visaType: liveProfile.visaType || apps[0].visaType,
      visaExpiry: liveProfile.visaExpiry || apps[0].visaExpiry,
      gender: liveProfile.gender || apps[0].gender,
      title: liveProfile.title || apps[0].title
    };
  }
  const couple = apps.length > 1;
  const subj = couple ? "The clients are" : "The applicant is";
  const them = couple ? "The applicants" : "The applicant";
  // Employment basis of the primary applicant — drives PAYG-vs-self-employed wording across income/capacity.
  const primaryEmp = (apps[0] && apps[0].employment) || {};
  const empStatusStr = `${primaryEmp.status || ""} ${primaryEmp.basis || ""} ${primaryEmp.type || ""} ${primaryEmp.occupation || ""}`.toLowerCase();
  const selfEmployed = /self|sole trad|abn|\bdirector\b|business owner|company financ/.test(empStatusStr);
  const employmentBasis = selfEmployed ? "self-employed" : /casual/.test(empStatusStr) ? "casual" : /part[- ]?time/.test(empStatusStr) ? "part-time" : /full|permanent|payg|paye/.test(empStatusStr) ? "full-time permanent" : "";
  const category = classifyLoanPurpose(caseData); // refinance | investment | owner-occupied | vacant-land
  const isInvestment = category === "investment";
  const isRefi = category === "refinance";
  // Lender + rate + product come from the Recommendation / Preferred Loan Features / Scenarios data, in
  // priority: LIVE scrape of that tab > confirmed selectedLender > the captured lenderScenarios > case.
  const loan = caseData?.loan || {}, prop = caseData?.property || {};
  const selLender = getCapture(caseData?.id, "selectedLender") || {};
  const rec = (snapshot && snapshot.recommendation) || {};
  const lk = (s) => String(s || "").toLowerCase().replace(/[^a-z]/g, "");
  const cleanRate = (x) => String(x == null ? "" : x).replace(/p\.?\s*a\.?/gi, "").replace(/[%\s]/g, "").trim();
  const validRate = (x) => { const n = cleanRate(x); return /^\d{1,2}(\.\d{1,3})?$/.test(n) ? n : ""; };
  const numFrom = (x) => Number(String(x == null ? "" : x).replace(/[^0-9.]/g, "")) || 0;
  const firstNonEmpty = (...xs) => xs.find((x) => x != null && String(x).trim() !== "") || "";
  // "Limit", "Ownership", "Balance" etc. are FINANCIALS-GRID column headers that the lender/scenario scrape can
  // mis-capture — they are never real lender names, so block them everywhere (the broker saw "WITH LIMIT").
  const GARBAGE_LENDER = /^(limit|ownership|balance|amount|interest|interest rate|rate|type|value|description|lender|product|term|repayment|frequency|monthly|annually|loan amount|total|security|lvr)$/i;
  const realLender = (x) => { const t = String(x || "").trim(); return !!t && t.length >= 2 && !GARBAGE_LENDER.test(t); };
  // Scenarios (lender/product/rate) from the live Preferred-Features/Scenarios scrape, else captured lenderScenarios.
  // Drop any scenario whose "lender" is grid-header garbage so it can't become the chosen lender.
  const scenarios = ((snapshot && Array.isArray(snapshot.scenarios) && snapshot.scenarios.length) ? snapshot.scenarios : (getCapture(caseData?.id, "lenderScenarios") || [])).filter((s) => realLender(s.lender));
  // Only trust the Recommendation "confirmed lender" if it's a REAL lender that matches a scenario lender.
  const scenLenders = scenarios.map((s) => s.lender).filter(Boolean);
  const knownLender = (x) => realLender(x) && scenLenders.some((L) => lk(L) === lk(x) || lk(L).includes(lk(x)) || lk(x).includes(lk(L)));
  const confirmedLender = (knownLender(rec.lender) ? rec.lender : "") || (realLender(selLender.lender) ? selLender.lender : "") || "";
  // Match the loan's OCCUPANCY so we never pick (or print) an "Investment" product on an owner-occupied loan.
  const purposeMatch = (s) => (isInvestment ? /invest/i.test(s.product || "") : /\boo\b|owner|occup/i.test(s.product || ""));
  const purposeContradicts = (s) => (isInvestment ? /\boo\b|owner|occup/i.test(s.product || "") : /invest/i.test(s.product || ""));
  const lenderScens = scenarios.filter((s) => confirmedLender && (lk(s.lender) === lk(confirmedLender) || lk(s.lender).includes(lk(confirmedLender)) || lk(confirmedLender).includes(lk(s.lender))));
  // Confirmed lender + matching occupancy > confirmed lender not contradicting > confirmed lender any >
  // recommended > occupancy match across all > first.
  const recScenario = (realLender(selLender.lender) && validRate(selLender.rate) && !purposeContradicts(selLender) ? selLender : null)
    || lenderScens.find(purposeMatch)
    || lenderScens.find((s) => !purposeContradicts(s))
    || lenderScens[0]
    || scenarios.find((s) => s.recommended || s.selected || s.chosen)
    || scenarios.find(purposeMatch)
    || scenarios[0] || {};
  // Lender/rate/product all come from the CHOSEN SCENARIO (internally consistent) — and never a garbage word.
  const lenderName = firstNonEmpty(realLender(recScenario.lender) ? recScenario.lender : "", realLender(selLender.lender) ? selLender.lender : "");
  const rate = validRate(recScenario.rate) || validRate(selLender.rate) || validRate(loan.interestRate);
  let product = firstNonEmpty(recScenario.product, selLender.product, loan.productPreference);
  // Never let the product wording contradict the loan's occupancy (a stale "Investment" label on an OO loan).
  if (product) product = isInvestment ? product.replace(/\bowner[- ]?occupied\b/gi, "Investment") : product.replace(/\binvestment\b/gi, "Owner-Occupied");
  const loanAmount = Number(loan.loanAmount) || numFrom(recScenario.loanAmount) || 0;
  const value = Number(prop.estimatedValue || prop.purchasePrice) || 0;
  const lvrNum = value ? Math.round((loanAmount / value) * 10000) / 100 : 0;
  const term = Number(loan.loanTermYears) || numFrom(recScenario.term) || 30;
  // Approval wording: a PURCHASE without a signed/provided Contract of Sale is a pre-approval / ASSESSMENT case
  // (the broker's rule). Only call it "formal approval" once a contract is actually provided.
  const contractProvided = Boolean(prop.contractSigned || prop.contractOfSale || prop.contractDate || loan.contractProvided || loan.contractOfSale);
  const assessment = !isRefi && !contractProvided;
  const preApproval = assessment || loan.preApproval === true || /pre[- ]?approval/i.test(`${loan.applicationType || ""} ${caseData?.selectedTemplate?.title || ""}`);
  // Optional case attributes for the proposal — from the LIVE Loans & Products capture first, then the case;
  // only stated when present (never invented).
  const lp = (snapshot && snapshot.loanPrefs) || {};
  const fl2 = (x) => String(x || "").toLowerCase();
  const rpSrc = fl2(lp.repaymentType || loan.repaymentType || loan.repayment);
  const repaymentType = /interest only|\bio\b/.test(rpSrc) ? "Interest Only" : /p\s*&?\s*i|principal/.test(rpSrc) ? "Principal and Interest" : "";
  const rfSrc = lp.repaymentFrequency || loan.repaymentFrequency;
  const repaymentFreq = (rfSrc && /week|fortnight|month/i.test(rfSrc)) ? rfSrc : "";
  const featuresStr = `${fl2(loan.features)} ${fl2(loan.loanFeatures)} ${fl2(loan.productFeatures)}`;
  const redraw = lp.redraw === true || loan.redraw === true || /redraw/.test(featuresStr);
  const extraRepayments = lp.extraRepayments === true || loan.extraRepayments === true || /extra repay|additional repay|unlimited repay/.test(featuresStr);
  const dependants = liveProfile.dependants ?? caseData?.dependants ?? caseData?.numberOfDependants ?? caseData?.clientProfile?.dependants;
  // Common sense: a low LVR means a large deposit / strong equity, so a low LVR IS a strong deposit position.
  const depositStrong = (lvrNum > 0 && lvrNum <= 80) || Boolean(loan.strongDeposit || caseData?.clientProfile?.strongDeposit) || /strong deposit/i.test(`${loan.notes || ""} ${caseData?.brokerNotes || ""}`);
  const equifaxLifted = /equifax.{0,30}(lift|remov|clear)/i.test(`${loan.notes || ""} ${caseData?.brokerNotes || ""} ${caseData?.creditNotes || ""}`);

  // INCOME — PREFER the income captured LIVE from Infinity/AOL (the broker's latest edits are the source of
  // truth; the loan-form employment is the customer's original and may be stale). Fall back to the case only
  // if nothing was captured. (liveFin computed at the top.)
  const freqMult = (f) => {
    f = String(f || "Annually").toLowerCase();
    if (/fortnight/.test(f)) return { n: 26, label: "fortnightly", rank: 3 };
    if (/week/.test(f)) return { n: 52, label: "weekly", rank: 4 };
    if (/month/.test(f)) return { n: 12, label: "monthly", rank: 2 };
    return { n: 1, label: "annual", rank: 1 };
  };
  const annualise = (i) => (Number(i.amount) || 0) * freqMult(i.frequency).n;
  // Merge income across sources, keeping for each (type, applicant) the entry with the MOST GRANULAR real
  // frequency — so a weekly/fortnightly per-period entry from the prepared case beats Infinity's annualised
  // summary. This makes the working follow the case's actual pay cycle instead of assuming one.
  const incKey = (i) => `${String(i.type || "").toLowerCase().trim()}|${String(i.ownership || "").toLowerCase().trim()}`;
  const mergeIncomes = (...lists) => {
    const map = new Map();
    for (const list of lists) for (const i of (list || [])) {
      if (!isRealIncome(i)) continue;
      const k = incKey(i), cur = map.get(k);
      if (!cur || freqMult(i.frequency).rank > freqMult(cur.frequency).rank) map.set(k, i);
    }
    return [...map.values()];
  };
  // Source of truth = the LIVE Infinity + AOL captures (current data the broker entered there). Merge both and
  // keep the most granular pay cycle per income. Do NOT use the prepared payload here — it's the pre-fill the
  // broker may have since changed in Infinity/AOL, so it can be stale (e.g. an old $130,600 vs the live ~$84k).
  const snapFin = (snapshot && snapshot.financials) || {};
  const infFin = getCapture(caseData?.id, "infinityFinancials") || {};
  const aolFin = getCapture(caseData?.id, "aolFinancials") || {};
  const liveIncomes = mergeIncomes(snapFin.incomes, infFin.incomes, aolFin.incomes);
  const round2 = (n) => Math.round(n * 100) / 100;
  const fmtNum = (n) => Number(n).toLocaleString("en-AU", { minimumFractionDigits: round2(n) % 1 ? 2 : 0, maximumFractionDigits: 2 });
  // Build the income WORKING as a multiplication that yields the annual figure — matching the broker's samples
  // ("$25 x 57.12 hrs x 52 = $74,256 p.a." or "$3,251.65 x 26 = $84,543 p.a."). Uses the most granular data
  // available: hourly rate x hours x periods > per-period amount x periods > (annual only) per-fortnight working.
  const incomeFormula = (i) => {
    const a = Number(i.amount) || 0, m = freqMult(i.frequency);
    const rate = Number(i.hourlyRate || i.rate), hrs = Number(i.hours || i.hoursPerPeriod);
    if (rate && hrs && m.n > 1) return `$${fmtNum(rate)} x ${fmtNum(hrs)} hrs x ${m.n} (${m.label}) = ${docMoney(round2(rate * hrs * m.n))} p.a.`;
    // Income captured at its ACTUAL pay cycle (weekly/fortnightly/monthly) — show that working directly.
    if (m.n > 1) return `$${fmtNum(a)} x ${m.n} (${m.label}) = ${docMoney(round2(a * m.n))} p.a.`;
    // The weekly-derivation working only makes sense for WAGE/PAYG income. Rental, pension, government, dividend
    // and self-employed/business income are inherently annual figures — show them as p.a., no fake pay cycle.
    const isWage = /base|salary|wage|pay\s?as|payg|ordinary time|gross pay/i.test(i.type || "");
    if (isWage) return `$${fmtNum(round2(a / 52))} x 52 (weekly) = ${docMoney(a)} p.a.`;
    return `${docMoney(a)} p.a.`;
  };
  // Employment lead-in for an applicant (matches the sample: "NAME - full-time Chef/Cook at EMPLOYER since DATE").
  const employmentLead = (name) => {
    const a = apps.find((x) => nameKey(applicantFullName(x)).includes(nameKey(name.split(/\s+/)[0])) || nameKey(name).includes(nameKey(applicantFullName(x))));
    const emp = (a && a.employment) || {};
    // Drop placeholder employers (ABC/XYZ/test, or the client's own name echoed back) so we never print junk.
    let employer = String(emp.employerName || "").trim();
    if (/\b(abc|xyz|test|n\/?a|tbd|none)\b/i.test(employer) || nameKey(employer).includes(nameKey(name.split(/\s+/)[0]))) employer = "";
    if (!employer && !emp.occupation) return "";
    const st = String(emp.status || emp.basis || "").toLowerCase();
    const selfEmp = /self|director|sole|abn/.test(st);
    const basis = selfEmp ? "self-employed" : /part/.test(st) ? "part-time" : /casual/.test(st) ? "casual" : "full-time";
    const since = emp.startDate || emp.since ? ` since ${emp.startDate || emp.since}` : "";
    const verifiedVia = selfEmp ? "verified on the financials provided" : "verified on recent payslips";
    return `${basis}${emp.occupation ? ` ${emp.occupation}` : ""}${employer ? ` at ${employer}` : ""}${since}; ${verifiedVia}. `;
  };
  let incomeDetails;
  if (liveIncomes.length) {
    const total = liveIncomes.reduce((s, i) => s + annualise(i), 0);
    // Group by applicant (ownership), then list each income source with its working underneath.
    const owners = [...new Set(liveIncomes.map((i) => String(i.ownership || "").trim()).filter(Boolean))];
    const groups = owners.length ? owners : [""];
    const blocks = groups.map((owner) => {
      const mine = liveIncomes.filter((i) => String(i.ownership || "").trim() === owner || (!owner && !i.ownership));
      const head = owner ? `${owner.toUpperCase()} — ${employmentLead(owner)}`.trim().replace(/—\s*$/, "").trim() : "";
      const lines = mine.map((i) => `• ${i.type || "Income"}: ${incomeFormula(i)}`);
      return (head ? head + "\n" : "") + lines.join("\n");
    });
    // PAYG → "payslips and employment documentation"; self-employed → "financials" (so the assessor doesn't
    // mistake a PAYG file for self-employed).
    const verifiedFrom = selfEmployed
      ? "Income has been verified from the financials and supporting documentation provided, and supports servicing:"
      : "Income has been verified from the most recent payslips and employment documentation provided, and supports servicing:";
    incomeDetails = verifiedFrom + "\n\n"
      + blocks.join("\n\n")
      + (total ? `\n\nTotal gross income adopted for servicing: ${docMoney(total)} p.a.` : "");
  } else {
    const totalIncome = apps.reduce((s, a) => s + applicantTotalIncome(a), 0);
    incomeDetails = apps.map(applicantIncomeNarrative).filter(Boolean).join("\n\n")
      + (totalIncome ? `\n\nTotal gross income adopted for servicing: ${docMoney(totalIncome)} p.a.` : "");
  }
  // Never leave INCOME blank — keep the section present with a neutral note if nothing was captured.
  if (!String(incomeDetails).trim()) incomeDetails = "Income is to be verified from the employment and income documentation prior to lodgement.";
  // RENTAL — only investment, when rental income present
  const rentalIncome = isInvestment
    ? apps.filter((a) => Number(a?.income?.rentalAnnual)).map((a) => `${applicantFullName(a)} receives rental income of ${docMoney(a.income.rentalAnnual)} p.a. from the investment property, supported by a rental appraisal.`).join("\n")
    : "";
  // VISA / residency — expanded, lender-facing wording per scenario (citizen / PR / temporary / joint), with
  // neutral "the applicant / their" by default (gendered Mr/Ms · his/her only when the case records gender).
  const visaStatus = buildVisaNarrative(apps);
  // OTHER DEBTS — only REAL liabilities: must have a balance/limit > 0 OR a named lender. An empty/placeholder
  // row (e.g. just type "Other" with no figures) is NOT a debt, so it must not produce a false entry.
  // Use the case liabilities (reliable); the live financials liabilities scrape is unreliable (it can mis-file
  // an income row), so don't take liabilities from it.
  const rawLiabs = caseData?.liabilities || [];
  const otherDebts = rawLiabs.filter((l) => {
    const name = String(l.lender || l.institution || l.name || l.type || "").trim();
    const balance = Number(l.balance || l.outstanding || l.amount || l.limit) || 0;
    // exclude empty placeholders AND anything that is actually income mis-filed as a liability
    const isIncome = /salary|wage|\bincome\b|rental|pension|centrelink|allowance|bonus|overtime|benefit/i.test(name);
    const realName = name && !/^(other|n\/a|none|nil)$/i.test(name);
    return !isIncome && (realName || balance > 0);
  }).map((l) => ({
    lenderType: l.lender || l.institution || l.name || l.type || "Existing liability",
    balance: Number(l.balance || l.outstanding || l.amount || l.limit) || 0,
    repayment: Number(l.repayment || l.monthlyRepayment) || 0,
    repayFreq: l.frequency || "Month",
    rate: l.rate || l.interestRate || "",
    security: l.security || "",
    action: l.action || (isRefi ? "To be refinanced" : "Remain open")
  })).filter((d) => d.lenderType || d.balance);

  const cashOut = Boolean(loan.cashOut) || /cash[ -]?out|equity release/i.test(`${loan.purpose || ""} ${loan.opportunityName || ""}`);
  const firstHomeBuyer = Boolean(loan.firstHomeBuyer || caseData?.clientProfile?.firstHomeBuyer);

  // Dwelling description from the property type / address (a unit/apartment is a strata title unit). Do NOT
  // assert condition — that needs a valuation; the collateral section adds "subject to valuation".
  const isStrata = /\bunit\b|\bapt\b|apartment|townhouse|villa|strata|flat\b|\b\d+\s*\/\s*\d+/i.test(`${prop.propertyType || prop.type || ""} ${prop.address || ""}`);
  const dwellingDesc = isStrata ? "Established strata title residential unit" : "Standard residential dwelling";

  // ---- Evidence / stage flags (conservative defaults so the note never overclaims) ----
  const propertyFound = Boolean(prop.address);
  const stage = isRefi ? "refinance" : (contractProvided ? "formal" : "pre_approval");
  const contractStatus = contractProvided ? "attached" : (propertyFound ? "to_be_provided" : "none");
  const valuationDone = Boolean(prop.valuationDone || /valuation.{0,15}(complete|received|acceptable)/i.test(`${prop.valuationStatus || ""} ${loan.notes || ""}`));
  const ccrClean = Boolean(caseData?.creditReportClean) || /(ccr|credit report|credit file).{0,30}(clean|clear|no adverse)/i.test(`${caseData?.creditNotes || ""} ${caseData?.brokerNotes || ""}`);
  const servicingResult = caseData?.servicing?.pass === true ? "pass" : caseData?.servicing?.pass === false ? "tight" : "unknown";
  const rateBlob = `${product} ${lp.rateType || ""} ${fl2(loan.rateType)} ${fl2(loan.features)}`;
  const rateType = /\bfixed\b/i.test(rateBlob) ? "fixed" : /\bvariable\b/i.test(rateBlob) ? "variable" : "";
  const offset = Boolean(lp.offset);
  const debtConsolidation = /debt consolidation|consolidat/i.test(`${loan.purpose || ""} ${loan.opportunityName || ""} ${caseData?.selectedTemplate?.title || ""}`);
  const borrowerType = /\b(pty ltd|p\/l|trust|trustee|corporation|company)\b/i.test(caseData?.borrowerType || caseData?.entityType || "") ? "company_trust" : "individual";

  // Scenario-aware narrative — every strong claim is evidence-gated (see buildRecNarrative).
  const narrative = buildRecNarrative({
    applicantCount: apps.length, borrowerType, isInvestment, isRefi, firstHomeBuyer, cashOut,
    debtConsolidation, stage,
    lenderName, loanAmount, value, lvr: lvrNum ? `${lvrNum}%` : "",
    product, rateType, repaymentType, loanTerm: term, redraw, offset, extraRepayments,
    security: prop.address || "", propertyFound, dwellingDesc, valuationDone, contractStatus,
    servicingResult, ccrClean, equifaxLifted, depositStrong,
    dependants, noLiabilities: otherDebts.length === 0, debtCount: otherDebts.length,
    employmentBasis, selfEmployed
  });

  return {
    clientName: apps.map(applicantFullName).filter(Boolean).join(" & "),
    loanType: preApproval ? "pre_approval" : "approval",
    loanPurpose: isRefi ? "refinance" : "purchase",
    propertyType: isInvestment ? "investment" : "owner_occupied",
    lenderName,
    loanAmount,
    product,
    interestRate: rate ? `${rate}% p.a.` : "",
    securityAddress: prop.address || "",
    estimatedValue: value,
    lvr: lvrNum ? `${lvrNum}%` : "",
    lmi: lvrNum > 80 ? "LMI payable (LVR above 80%)" : (lvrNum ? "N/A (LVR 80% or below)" : ""),
    financeDate: rec.financeDate || loan.financeDate || loan.financeDueDate || "",
    settlementDate: rec.settlementDate || loan.settlementDate || prop.settlementDate || "",
    proposal: narrative.proposal,
    visaStatus,
    capacity: narrative.capacity,
    incomeDetails,
    rentalIncome,
    character: narrative.character,
    collateral: narrative.collateral,
    exitStrategy: narrative.exitStrategy,
    otherDebts,
    noDebtsNote: narrative.noDebtsNote,
    debtsLead: narrative.debtsLead,
    // 08 — Final broker recommendation (closing ask to the assessor), stage-aware + evidence-safe.
    brokerComment: (() => {
      const lead = `Based on the information provided, the application is considered suitable to proceed${lenderName ? ` to ${lenderName}` : ""} for ${stage === "formal" ? "formal approval" : stage === "refinance" ? "assessment of the refinance proposal" : "pre-approval / assessment"}. The proposed loan aligns with the ${couple ? "applicants'" : "applicant's"} stated requirements and objectives${lvrNum && lvrNum <= 80 ? ", demonstrates a low LVR position," : ""} and is supported by the income evidence provided.`;
      const ask = stage === "formal"
        ? "The broker respectfully requests formal approval, subject to the lender's standard credit assessment, valuation, verification and any lender conditions."
        : stage === "refinance"
          ? "The broker respectfully requests assessment of the refinance proposal, subject to payout verification, valuation and any lender conditions."
          : "The broker respectfully requests pre-approval / assessment, subject to the lender's credit assessment, valuation, verification, Contract of Sale and any lender conditions.";
      return `${lead} ${ask}`;
    })()
  };
}

// Prefill a YTD calc from the prepared case: name + base + pay cycle come from the case; the pay-period DATES
// are auto-derived (financial-year start / today, or employment start if later) so the broker only fills the
// one yellow cell — the YTD figure on the latest payslip.
function ddmmyyyy(d) { const p = (n) => String(n).padStart(2, "0"); return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`; }
function buildYtdInputFromCase(caseData) {
  const apps = (caseData?.applicants || []).filter(Boolean);
  const primary = apps.find((a) => a.role === "primary") || apps[0] || {};
  // Prefer the live "Base Salary" income; keep its REAL pay cycle (weekly/fortnightly), falling back to the
  // prepared case which stores the per-period amount + frequency Infinity's summary annualises away.
  const snapshot = getCapture(caseData?.id, "liveCaseSnapshot");
  const snapFin = (snapshot && snapshot.financials) || {};
  const infFin = getCapture(caseData?.id, "infinityFinancials") || {};
  const aolFin = getCapture(caseData?.id, "aolFinancials") || {};
  const isBase = (i) => /base|salary|wage|pay\s?as|payg/i.test(i.type || "") && !/loan|submission|prepare|purchase|dwelling/i.test(`${i.type || ""} ${i.ownership || ""}`);
  const freqRank = (i) => { const f = String(i.frequency || "").toLowerCase(); return /week/.test(f) ? 4 : /fortnight/.test(f) ? 3 : /month/.test(f) ? 2 : 1; };
  // LIVE Infinity + AOL only (the current source of truth); the prepared payload can be stale.
  const candidates = [...(snapFin.incomes || []), ...(infFin.incomes || []), ...(aolFin.incomes || [])].filter(isBase).filter((i) => Number(i.amount));
  // Pick the most granular pay cycle (weekly beats the annualised summary) so the working follows the case.
  const baseInc = candidates.sort((a, b) => freqRank(b) - freqRank(a))[0] || null;
  const freq = baseInc ? String(baseInc.frequency || "Annually") : "";
  const fl = freq.toLowerCase();
  const mult = /fortnight/.test(fl) ? 26 : /week/.test(fl) ? 52 : /month/.test(fl) ? 12 : 1;
  const baseAmount = baseInc ? Number(baseInc.amount) || 0 : 0;
  const annual = baseAmount * mult;
  const liveOwner = baseInc && baseInc.ownership ? baseInc.ownership : "";

  // Auto pay-period dates: First Pay Day = start of the current AU financial year (1 July), or the applicant's
  // employment start date if they started after that. Last Pay Day = today (the latest data point we have).
  const now = new Date();
  const fyStart = new Date(now.getMonth() >= 6 ? now.getFullYear() : now.getFullYear() - 1, 6, 1); // 1 July
  const emp = (primary && primary.employment) || {};
  let firstPay = fyStart;
  const empStart = emp.startDate || emp.since;
  if (empStart) { const es = new Date(empStart); if (!Number.isNaN(es.getTime()) && es > fyStart && es <= now) firstPay = es; }

  return {
    clientName: liveOwner || applicantFullName(primary) || apps.map(applicantFullName).filter(Boolean).join(" & "),
    baseAnnual: annual || primary.income?.baseAnnual || 0,
    baseAmount, baseFrequency: freq || "Annually", baseMultiplier: mult,
    firstPayDay: ddmmyyyy(firstPay), lastPayDay: ddmmyyyy(now), ytdIncome: 0
  };
}

app.post("/api/cases/:caseId/ytd-calc", async (request, response) => {
  const broker = requireBroker(request, response);
  if (!broker) return;
  try {
    const caseData = findCase(request.params.caseId);
    const prefill = caseData ? buildYtdInputFromCase(caseData) : {};
    const input = { ...prefill, ...(request.body || {}) }; // explicit form values win
    const buffer = await buildYtdXlsx(input);
    recordDocHistory(request.params.caseId, "ytd", broker.name);
    sendDocFile(response, buffer, `YTD_${slug(input.clientName)}.xlsx`,
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  } catch (error) { response.status(500).json({ error: String(error?.message || error) }); }
});

// Receive a live snapshot scraped from Infinity by the extension (broker-token auth, independent of Start),
// merge it with the existing one (never wipe good data with an empty scrape), and store it as the versioned
// "updated copy" capture used to build documents.
app.post("/api/cases/:caseId/live-snapshot", (request, response) => {
  const broker = requireBroker(request, response);
  if (!broker) return;
  const caseId = request.params.caseId;
  const incoming = request.body || {};
  const prev = getCapture(caseId, "liveCaseSnapshot") || {};
  const mergeObj = (p, c) => {
    const o = { ...(p || {}) };
    Object.keys(c || {}).forEach((k) => { if (c[k] != null && String(c[k]).trim() !== "") o[k] = c[k]; });
    return o;
  };
  const merged = {
    platform: "infinity", scrapedAt: new Date().toISOString(),
    applicants: (Array.isArray(incoming.applicants) && incoming.applicants.length) ? incoming.applicants : (prev.applicants || []),
    employment: mergeObj(prev.employment, incoming.employment),
    profile: mergeObj(prev.profile, incoming.profile),
    loanPrefs: mergeObj(prev.loanPrefs, incoming.loanPrefs),
    recommendation: mergeObj(prev.recommendation, incoming.recommendation),
    scenarios: (Array.isArray(incoming.scenarios) && incoming.scenarios.length) ? incoming.scenarios : (prev.scenarios || []),
    financials: (incoming.financials && (incoming.financials.incomes || []).length) ? incoming.financials : (prev.financials || null)
  };
  pushCaseHistory(caseId, { type: "capture", key: "liveCaseSnapshot", brokerUser: broker.name, data: merged });
  if (merged.financials && (merged.financials.incomes || []).length) {
    pushCaseHistory(caseId, { type: "capture", key: "infinityFinancials", brokerUser: broker.name, data: merged.financials });
  }
  if (merged.scenarios && merged.scenarios.length) {
    pushCaseHistory(caseId, { type: "capture", key: "lenderScenarios", brokerUser: broker.name, data: merged.scenarios });
  }
  response.json({ ok: true, snapshot: merged });
});

app.post("/api/cases/:caseId/recommendation-notes", async (request, response) => {
  const broker = requireBroker(request, response);
  if (!broker) return;
  try {
    const caseData = findCase(request.params.caseId);
    const overrides = request.body || {};
    const prefill = caseData ? buildRecInputFromCase(caseData, overrides) : {};
    const input = { ...prefill, ...overrides }; // explicit overrides (single flag, edited fields) win
    const format = String(request.query.format || "pdf").toLowerCase();
    const base = `RECNOTES_${slug(input.clientName)}`;
    if (format === "docx") {
      const buffer = await buildRecDocx(input);
      recordDocHistory(request.params.caseId, "recDocx", broker.name);
      sendDocFile(response, buffer, `${base}.docx`,
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    } else {
      const buffer = await buildRecPdf(input);
      recordDocHistory(request.params.caseId, "recPdf", broker.name);
      sendDocFile(response, buffer, `${base}.pdf`, "application/pdf");
    }
  } catch (error) { response.status(500).json({ error: String(error?.message || error) }); }
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
    const submission = intake.submission || {};
    return {
      ...submission,
      id: intake.id,
      token: intake.token,
      callNoteId: intake.callNoteId,
      brokerUser: intake.brokerUser || note.brokerUser || "",
      source: intake.source || (note.sourceChannel === "Loan Form" ? "public-loan-form" : "client-call-link"),
      status: intake.status,
      createdAt: intake.createdAt,
      linkCreatedAt: intake.linkCreatedAt || intake.createdAt || null,
      lastLinkCopiedAt: intake.lastLinkCopiedAt || null,
      linkCopyCount: Number(intake.linkCopyCount || 0),
      submittedAt: intake.submittedAt,
      clientName: note.clientName || submission.clientName || "",
      firstName: note.firstName || submission.firstName || "",
      middleName: note.middleName || submission.middleName || "",
      surname: note.surname || submission.surname || "",
      clientNameSearch: note.clientNameSearch || submission.clientNameSearch || "",
      secondApplicantName: note.secondApplicantName || submission.secondApplicantName || "",
      secondApplicantFirstName: note.secondApplicantFirstName || submission.secondApplicantFirstName || "",
      secondApplicantMiddleName: note.secondApplicantMiddleName || submission.secondApplicantMiddleName || "",
      secondApplicantSurname: note.secondApplicantSurname || submission.secondApplicantSurname || "",
      secondApplicantNameSearch: note.secondApplicantNameSearch || submission.secondApplicantNameSearch || "",
      mobile: note.mobile || submission.mobile || "",
      email: note.email || submission.email || "",
      loanType: note.loanType || submission.loanType || "",
      loanScenario: note.loanScenario || submission.loanScenario || "",
      loanPurpose: note.loanPurpose || submission.loanPurpose || "",
      loanAmount: note.loanAmount || submission.loanAmount || 0,
      propertyValue: note.propertyValue || submission.propertyValue || 0,
      depositEquity: note.depositEquity || submission.depositEquity || 0,
      propertyLocation: note.propertyLocation || submission.propertyLocation || "",
      annualIncome: note.annualIncome || submission.annualIncome || 0,
      secondAnnualIncome: note.secondAnnualIncome || submission.secondAnnualIncome || 0,
      hemMonthly: note.hemMonthly || submission.hemMonthly || 0,
      financialAssetBuffer: note.financialAssetBuffer || submission.financialAssetBuffer || 0,
      clientNotes: submission.clientNotes || "",
      lastSavedAt: intake.lastSavedAt || intake.updatedAt || intake.submittedAt || null,
      lastEditedBy: intake.lastEditedBy || "",
      factFindExportedAt: intake.factFindExportedAt || null,
      submissionVersion: Number(intake.submissionVersion) || 1,
      lastChangedFields: Array.isArray(intake.lastChangedFields) ? intake.lastChangedFields : [],
      submissionHistory: Array.isArray(intake.submissionHistory) ? intake.submissionHistory : [],
      // Broker edits made on Infinity/AOL (the override layer), surfaced into the internal loan form view.
      brokerEdits: (() => {
        try {
          const cid = intake.caseId || note.convertedCaseId;
          if (!cid) return [];
          const ev = (caseHistory.get(cid) || []).find((e) => e.type === "capture" && e.key === "brokerOverrides");
          const ov = ev && ev.data && typeof ev.data === "object" ? ev.data : null;
          if (!ov) return [];
          return Object.values(ov).filter(Boolean).map((o) => ({ label: o.label || "", value: o.value || "", platform: o.platform || "", at: o.at || null })).slice(0, 80);
        } catch (e) { return []; }
      })(),
      convertedCaseId: intake.caseId || note.convertedCaseId || null,
      url: loanFormUrl(request, intake),
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
  audit({
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
  audit({
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
  const clientName = request.body?.clientName || composeLegalName(request.body?.firstName, "", request.body?.surname);
  const secondApplicantName = request.body?.secondApplicantName || composeLegalName(request.body?.secondApplicantFirstName, "", request.body?.secondApplicantSurname);
  const note = {
    id: `CN-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(2).toString("hex").toUpperCase()}`,
    status: request.body?.status || "New call",
    brokerUser: request.body?.brokerUser || "ryan.vu",
    clientName,
    firstName: request.body?.firstName || "",
    middleName: "",
    surname: request.body?.surname || "",
    clientNameSearch: normalizeSearchText(clientName),
    secondApplicantName,
    secondApplicantFirstName: request.body?.secondApplicantFirstName || "",
    secondApplicantMiddleName: "",
    secondApplicantSurname: request.body?.secondApplicantSurname || "",
    secondApplicantNameSearch: normalizeSearchText(secondApplicantName),
    hasSecondApplicant: request.body?.hasSecondApplicant || (secondApplicantName ? "Yes" : "No"),
    secondApplicantDateOfBirth: request.body?.secondApplicantDateOfBirth || "",
    secondApplicantGender: request.body?.secondApplicantGender || "",
    secondApplicantPermanentInAustralia: request.body?.secondApplicantPermanentInAustralia || "Yes",
    secondApplicantDriversLicenceNo: request.body?.secondApplicantDriversLicenceNo || "",
    secondApplicantLicenceCardNumber: request.body?.secondApplicantLicenceCardNumber || "",
    secondApplicantLicenceExpiryDate: normalizeAuDate(request.body?.secondApplicantLicenceExpiryDate || ""),
    secondApplicantLicenceState: request.body?.secondApplicantLicenceState || "",
    secondApplicantLicenceClass: request.body?.secondApplicantLicenceClass || "C",
    secondApplicantMobile: request.body?.secondApplicantMobile || "",
    secondApplicantEmail: request.body?.secondApplicantEmail || "",
    secondApplicantAddress: request.body?.secondApplicantAddress || "",
    secondApplicantResidencyStatus: request.body?.secondApplicantResidencyStatus || "",
    secondApplicantMaritalStatus: request.body?.secondApplicantMaritalStatus || request.body?.maritalStatus || "",
    secondApplicantDependants: Number(request.body?.secondApplicantDependants || 0),
    secondApplicantEmployerName: request.body?.secondApplicantEmployerName || "",
    secondApplicantJobTitle: request.body?.secondApplicantJobTitle || "",
    mobile: request.body?.mobile || "",
    email: request.body?.email || "",
    preferredLanguage: request.body?.preferredLanguage || "Vietnamese / English",
    sourceChannel: request.body?.sourceChannel || "",
    bestTimeToContact: request.body?.bestTimeToContact || "",
    loanCategory: request.body?.loanCategory || "",
    loanAction: request.body?.loanAction || "",
    occupancy: request.body?.occupancy || "",
    scenarioTags: Array.isArray(request.body?.scenarioTags) ? request.body.scenarioTags : [],
    borrowerType: request.body?.borrowerType || "",
    securityType: request.body?.securityType || "",
    depositOrEquity: request.body?.depositOrEquity || request.body?.depositEquity || "",
    existingLoanBalance: Number(request.body?.existingLoanBalance || 0),
    loanUseDescription: request.body?.loanUseDescription || "",
    settlementDate: normalizeAuDate(request.body?.settlementDate || ""),
    commercialAction: request.body?.commercialAction || "",
    businessPurpose: request.body?.businessPurpose || "",
    assetType: request.body?.assetType || "",
    assetCondition: request.body?.assetCondition || "",
    sellerType: request.body?.sellerType || "",
    businessUsePercent: request.body?.businessUsePercent || "",
    privatePurpose: request.body?.privatePurpose || "",
    propertyAddress: request.body?.propertyAddress || "",
    estimatedValue: Number(request.body?.estimatedValue || 0),
    rentalLeaseIncome: Number(request.body?.rentalLeaseIncome || 0),
    leaseRemainingTerm: request.body?.leaseRemainingTerm || "",
    businessName: request.body?.businessName || "",
    abnAcn: request.body?.abnAcn || "",
    tradingHistory: request.body?.tradingHistory || "",
    monthlyTurnover: Number(request.body?.monthlyTurnover || 0),
    gstRegistered: request.body?.gstRegistered || "",
    purposeOfFunds: request.body?.purposeOfFunds || "",
    existingBusinessDebts: request.body?.existingBusinessDebts || "",
    exitStrategy: request.body?.exitStrategy || "",
    urgency: request.body?.urgency || "",
    loanType: request.body?.loanType || "Purchase",
    loanPurpose: request.body?.loanPurpose || "",
    loanScenario: request.body?.loanScenario || "",
    loanAmount: Number(request.body?.loanAmount || 0),
    propertyValue: Number(request.body?.propertyValue || 0),
    depositEquity: Number(request.body?.depositEquity || 0),
    propertyLocation: request.body?.propertyLocation || "",
    timeline: request.body?.timeline || "",
    dateOfBirth: request.body?.dateOfBirth || "",
    gender: request.body?.gender || "",
    permanentInAustralia: request.body?.permanentInAustralia || "Yes",
    driversLicenceNo: request.body?.driversLicenceNo || "",
    licenceCardNumber: request.body?.licenceCardNumber || "",
    licenceExpiryDate: normalizeAuDate(request.body?.licenceExpiryDate || ""),
    licenceState: request.body?.licenceState || "",
    licenceClass: request.body?.licenceClass || "C",
    address: request.body?.address || "",
    residencyStatus: request.body?.residencyStatus || "",
    maritalStatus: request.body?.maritalStatus || "",
    dependants: Number(request.body?.dependants || 0),
    currentSuburb: request.body?.currentSuburb || "",
    currentState: request.body?.currentState || "",
    currentPostcode: request.body?.currentPostcode || "",
    currentAddressFromDate: normalizeAuDate(request.body?.currentAddressFromDate || ""),
    currentResidentialStatus: request.body?.currentResidentialStatus || "",
    postSettlementAddress: request.body?.postSettlementAddress || "",
    mailingAddress: request.body?.mailingAddress || "",
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
  audit({ type: "call-note", timestamp: now, brokerUser: note.brokerUser, caseId: note.id, clientName: note.clientName });
  notifyCallIntake(note).catch((error) => console.warn(`Call intake email failed: ${error.message}`));
  response.status(201).json(note);
});

app.patch("/api/call-notes/:noteId", (request, response) => {
  const index = callNotes.findIndex((item) => item.id === request.params.noteId);
  if (index === -1) return response.status(404).json({ error: "Call note not found" });
  const merged = { ...callNotes[index], ...request.body };
  const clientName = merged.clientName || composeLegalName(merged.firstName, "", merged.surname);
  const secondApplicantName = merged.secondApplicantName || composeLegalName(
    merged.secondApplicantFirstName,
    "",
    merged.secondApplicantSurname
  );
  const updated = {
    ...merged,
    clientName,
    clientNameSearch: normalizeSearchText(clientName),
    secondApplicantName,
    secondApplicantNameSearch: normalizeSearchText(secondApplicantName),
    id: callNotes[index].id,
    updatedAt: new Date().toISOString()
  };
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
  audit({ type: "delete-call-note", timestamp: new Date().toISOString(), brokerUser: note.brokerUser, caseId: note.id });
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
  audit({
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

  const now = new Date().toISOString();
  const localCase = callNotes[index].convertedCaseId
    ? findCase(callNotes[index].convertedCaseId)
    : upsertLocalCaseFromCallNote(index, "loan-form-link-created");
  const existing = clientIntakes.find((item) => item.callNoteId === request.params.noteId && item.status !== "expired");
  if (existing) {
    Object.assign(existing, {
      caseId: existing.caseId || localCase?.id || callNotes[index].convertedCaseId || null,
      source: existing.source || "client-call-link",
      lastLinkCopiedAt: now,
      linkCopyCount: Number(existing.linkCopyCount || 0) + 1
    });
    callNotes[index] = {
      ...callNotes[index],
      intakeToken: existing.token,
      intakeStatus: existing.status === "submitted" ? "submitted" : "sent",
      intakeLinkLastCopiedAt: now,
      updatedAt: now
    };
    persistClientIntakes();
    persistCallNotes();
    return response.json({
      ...existing,
      caseId: existing.caseId || localCase?.id || callNotes[index].convertedCaseId || null,
      url: loanFormUrl(request, existing),
      fallbackUrl: `${publicBaseUrl(request)}/loan-form/${existing.token}`
    });
  }

  const intake = {
    id: `INTAKE-${Date.now().toString(36).toUpperCase()}`,
    token: crypto.randomBytes(18).toString("hex"),
    callNoteId: request.params.noteId,
    caseId: localCase?.id || callNotes[index].convertedCaseId || null,
    brokerUser: callNotes[index].brokerUser,
    source: "client-call-link",
    status: "sent",
    createdAt: now,
    linkCreatedAt: now,
    lastLinkCopiedAt: now,
    linkCopyCount: 1,
    submittedAt: null,
    submission: null
  };
  clientIntakes.unshift(intake);
  persistClientIntakes();
  callNotes[index] = { ...callNotes[index], intakeToken: intake.token, intakeStatus: "sent", intakeLinkLastCopiedAt: now, updatedAt: now };
  persistCallNotes();
  response.status(201).json({
    ...intake,
    caseId: intake.caseId,
    url: loanFormUrl(request, intake),
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
    firstName: "",
    middleName: "",
    surname: "",
    secondApplicantName: "",
    secondApplicantFirstName: "",
    secondApplicantMiddleName: "",
    secondApplicantSurname: "",
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
    firstName: "",
    middleName: "",
    surname: "",
    clientNameSearch: "",
    secondApplicantName: "",
    secondApplicantFirstName: "",
    secondApplicantMiddleName: "",
    secondApplicantSurname: "",
    secondApplicantNameSearch: "",
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
    source: "public-loan-form",
    status: "submitted",
    createdAt: now,
    linkCreatedAt: now,
    lastLinkCopiedAt: null,
    linkCopyCount: 0,
    submittedAt: now,
    submission
  };

  const localCase = upsertLocalCaseFromCallNote(0, "public-loan-form-submitted");
  intake.caseId = localCase?.id || null;
  callNotes[0] = { ...callNotes[0], intakeToken: intake.token, intakeStatus: "submitted", convertedCaseId: localCase?.id || callNotes[0].convertedCaseId };
  clientIntakes.unshift(intake);
  persistCallNotes();
  persistClientIntakes();
  audit({
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
    caseId: intake.caseId || note?.convertedCaseId || null,
    status: intake.status,
    submittedAt: intake.submittedAt,
    callNoteId: intake.callNoteId
  });
});

// Field-level diff between two normalized loan-form submissions → the list of what the customer changed
// (for the broker alert + audit history). Flattens nested objects to dotted paths; arrays compared as JSON.
function diffSubmissions(a, b) {
  const flat = (obj, prefix, out) => {
    if (obj && typeof obj === "object" && !Array.isArray(obj)) {
      for (const k of Object.keys(obj)) flat(obj[k], prefix ? `${prefix}.${k}` : k, out);
    } else {
      out[prefix] = Array.isArray(obj) ? JSON.stringify(obj) : (obj == null ? "" : String(obj));
    }
    return out;
  };
  const fa = flat(a || {}, "", {}), fb = flat(b || {}, "", {});
  const keys = new Set([...Object.keys(fa), ...Object.keys(fb)]);
  const changes = [];
  for (const k of keys) if ((fa[k] || "") !== (fb[k] || "")) changes.push({ field: k, from: fa[k] || "", to: fb[k] || "" });
  return changes.slice(0, 200);
}

app.post("/api/client-intake/:token", (request, response) => {
  const intakeIndex = clientIntakes.findIndex((item) => item.token === request.params.token);
  if (intakeIndex === -1) return response.status(404).json({ error: "Loan form link not found" });
  const noteIndex = callNotes.findIndex((item) => item.id === clientIntakes[intakeIndex].callNoteId);
  if (noteIndex === -1) return response.status(404).json({ error: "Linked call note not found" });

  const now = new Date().toISOString();
  const submission = normalizeClientIntakeSubmission(request.body || {});
  // --- ADDITIVE: version the customer's loan form. RULE (broker's logic): a new version + "previous" copy
  // is created ONLY when something actually CHANGED. If the re-submit is identical → keep the same version,
  // no "pre" copy. Original v1 preserved. Wrapped so a failure here can NEVER block the core submit. ---
  let submissionHistory = [], changedFields = [], submissionVersion = 1, lastChangedFields = [];
  try {
    const prev = clientIntakes[intakeIndex];
    const prevSub = prev.submission || null;
    submissionHistory = Array.isArray(prev.submissionHistory) ? prev.submissionHistory.slice(-49) : [];
    submissionVersion = Number(prev.submissionVersion) || 1;
    lastChangedFields = Array.isArray(prev.lastChangedFields) ? prev.lastChangedFields : [];
    changedFields = diffSubmissions(prevSub, submission); // what THIS submit changed
    if (prevSub && changedFields.length) {
      // changed → the old value becomes a previous version, bump version, record the diff
      submissionHistory.push({ version: submissionVersion, submittedAt: prev.submittedAt || prev.updatedAt || null, submission: prevSub });
      submissionVersion += 1;
      lastChangedFields = changedFields;
    }
    // (first submit → v1, no history; identical re-submit → keep version, no "pre", keep prior change info)
  } catch (error) { console.warn(`intake versioning failed: ${error.message}`); }
  clientIntakes[intakeIndex] = {
    ...clientIntakes[intakeIndex],
    caseId: clientIntakes[intakeIndex].caseId || callNotes[noteIndex].convertedCaseId || null,
    source: clientIntakes[intakeIndex].source || "client-call-link",
    status: "submitted",
    submittedAt: now,
    submission,
    submissionHistory,
    submissionVersion,
    lastChangedFields
  };
  callNotes[noteIndex] = applyClientIntakeToNote(callNotes[noteIndex], submission);
  const localCase = upsertLocalCaseFromCallNote(noteIndex, "loan-form-submitted");
  clientIntakes[intakeIndex] = {
    ...clientIntakes[intakeIndex],
    caseId: localCase?.id || clientIntakes[intakeIndex].caseId || callNotes[noteIndex].convertedCaseId || null,
    updatedAt: now
  };
  persistClientIntakes();
  persistCallNotes();
  audit({
    type: "client-intake",
    timestamp: now,
    brokerUser: callNotes[noteIndex].brokerUser,
    caseId: localCase?.id || callNotes[noteIndex].id,
    clientName: callNotes[noteIndex].clientName
  });
  notifyLoanFormSubmission(clientIntakes[intakeIndex], callNotes[noteIndex]).catch((error) => console.warn(`Loan form email failed: ${error.message}`));
  // Surface what the customer changed (re-submission) to the case capture store so the broker / extension
  // can see "customer updated income 80k→95k" and re-check Infinity/AOL. Never blocks the submit.
  try {
    const cid = localCase?.id || clientIntakes[intakeIndex].caseId;
    if (cid && changedFields.length && submissionVersion > 1) {
      pushCaseHistory(cid, { type: "capture", key: "loanFormChanges", brokerUser: callNotes[noteIndex].brokerUser, platform: "loan-form", data: { at: now, version: submissionVersion, changes: changedFields } });
    }
  } catch (error) { console.warn(`loan-form change alert failed: ${error.message}`); }
  response.status(201).json({ ok: true, status: "submitted", caseId: localCase?.id || null, version: submissionVersion, changed: changedFields.length });
});

// Customer loan-form version history (for the broker UI: "original → updates", diff per version).
app.get("/api/client-intake/:token/history", (request, response) => {
  const intake = clientIntakes.find((item) => item.token === request.params.token || item.id === request.params.token);
  if (!intake) return response.status(404).json({ error: "Loan form link not found" });
  response.json({
    ok: true,
    token: intake.token,
    caseId: intake.caseId || null,
    currentVersion: Number(intake.submissionVersion) || 1,
    current: intake.submission || null,
    lastChangedFields: intake.lastChangedFields || [],
    history: Array.isArray(intake.submissionHistory) ? intake.submissionHistory : []
  });
});

app.get("/api/templates/:templateId", (request, response) => {
  const template = getTemplate(request.params.templateId);
  if (!template) return response.status(404).json({ error: "Template not found" });
  response.json(template);
});

app.put("/api/templates/:templateId", (request, response) => {
  try {
    const saved = saveTemplate({ ...request.body, id: request.params.templateId });
    // Mirror the user templates file to Supabase so the edit survives the next Render redeploy.
    try { writeStoredJson("user_templates", userTemplatesPath, JSON.parse(fs.readFileSync(userTemplatesPath, "utf8"))); } catch (mirrorError) { console.warn(`user templates mirror failed: ${mirrorError.message}`); }
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
    hemConfirmed: request.body.hemConfirmed,
    financialAssetBuffer: request.body.financialAssetBuffer,
    templateId: request.body.templateId,
    templateOverrides: request.body.templateOverrides,
    manualIntake: request.body.manualIntake
  });

  documentDrafts.set(caseData.id, draft);
  audit({
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
      hemConfirmed: request.body.hemConfirmed,
      financialAssetBuffer: request.body.financialAssetBuffer,
      templateId: request.body.templateId,
      templateOverrides: request.body.templateOverrides,
      manualIntake: request.body.manualIntake
    });
    documentDrafts.set(caseData.id, draft);
    audit({
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

app.get("/api/infinity/prepared-cases", (_request, response) => {
  const seen = new Set();
  const cases = preparedArchive
    .filter((prepared) => {
      if (!prepared?.caseId || seen.has(prepared.caseId)) return false;
      seen.add(prepared.caseId);
      return true;
    })
    .slice(0, 30)
    .map((prepared) => {
      const applicants = prepared.payload?.applicants || {};
      const primary = applicants.primary || {};
      const secondary = applicants.secondary || {};
      const primaryName = [primary.firstName, primary.lastName].filter(Boolean).join(" ") || prepared.caseId;
      const secondaryName = [secondary.firstName, secondary.lastName].filter(Boolean).join(" ");
      return {
        token: prepared.token,
        caseId: prepared.caseId,
        label: secondaryName ? `${primaryName} & ${secondaryName}` : primaryName,
        loanAmount: prepared.payload?.loan?.loanAmount || 0,
        security: prepared.payload?.property?.address || "",
        okToAutofill: Boolean(prepared.validation?.okToAutofill),
        preparedAt: prepared.preparedAt || null,
        expiresAt: prepared.expiresAt || null
      };
    });
  response.json({ cases });
});

app.get("/api/infinity/mappings/current", (_request, response) => {
  response.json(getMapping());
});

app.post("/api/infinity/autofill-log", (request, response) => {
  if (!extTokenOk(request)) return response.status(401).json({ error: "unauthorized" });
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
  audit(event);
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
  if (!extTokenOk(request)) return response.status(401).json({ error: "unauthorized" });
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
  app.use("/infinity-aol", express.static(distPath));
  app.get(/^\/infinity-aol\/(?!api).*/, (_request, response) => {
    response.sendFile(path.join(distPath, "index.html"));
  });
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
