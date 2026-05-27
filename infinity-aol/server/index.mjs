import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import cors from "cors";
import multer from "multer";
import { cases } from "./data/sampleCases.mjs";
import { buildInfinityPayload, getMapping } from "./lib/mapper.mjs";
import { validateInfinityPayload } from "./lib/validation.mjs";
import { buildDocumentDraft, mergeDocumentDraft } from "./lib/documentIntake.mjs";
import { listTemplates, getTemplate, saveTemplate } from "./lib/caseTemplates.mjs";
import { buildTemplateTextPreview } from "./lib/infinityTemplate.mjs";

const app = express();
const port = Number(process.env.PORT || 8797);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distPath = path.resolve(__dirname, "../dist");
const historyPath = path.resolve(__dirname, "data/caseHistory.json");
const preparedArchivePath = path.resolve(__dirname, "data/preparedPayloads.json");
const comparisonSnapshotsPath = path.resolve(__dirname, "data/comparisonSnapshots.json");

const preparedCases = new Map();
const documentDrafts = new Map();
const caseHistory = new Map();
const comparisonSnapshots = new Map();
const auditLog = [];
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024, files: 12 } });

app.use(cors());
app.use(express.json({ limit: "1mb" }));

function findCase(caseId) {
  return cases.find((item) => item.id === caseId);
}

function readJson(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function persistHistory() {
  writeJson(historyPath, Object.fromEntries(caseHistory.entries()));
}

function persistComparisonSnapshots() {
  writeJson(comparisonSnapshotsPath, Object.fromEntries(comparisonSnapshots.entries()));
}

function persistPrepared(prepared) {
  const archived = readJson(preparedArchivePath, []).filter((item) => item.token !== prepared.token);
  archived.unshift(prepared);
  writeJson(preparedArchivePath, archived.slice(0, 100));
}

function deleteLocalCaseData(caseId) {
  const archivedPrepared = readJson(preparedArchivePath, []);
  const remainingPrepared = archivedPrepared.filter((item) => item.caseId !== caseId);
  const removedTokens = archivedPrepared.filter((item) => item.caseId === caseId).map((item) => item.token);
  for (const [key, prepared] of [...preparedCases.entries()]) {
    if (key === caseId || prepared?.caseId === caseId) preparedCases.delete(key);
  }

  const historyRemoved = caseHistory.get(caseId)?.length || 0;
  const snapshotsRemoved = comparisonSnapshots.get(caseId)?.length || 0;
  const hadDocumentDraft = documentDrafts.delete(caseId);
  caseHistory.delete(caseId);
  comparisonSnapshots.delete(caseId);

  writeJson(preparedArchivePath, remainingPrepared.slice(0, 100));
  persistHistory();
  persistComparisonSnapshots();

  return {
    preparedPayloadsRemoved: archivedPrepared.length - remainingPrepared.length,
    memoryTokensRemoved: removedTokens.length,
    historyEventsRemoved: historyRemoved,
    comparisonSnapshotsRemoved: snapshotsRemoved,
    documentDraftRemoved: hadDocumentDraft
  };
}

function hydrateLocalHistory() {
  const loadedHistory = readJson(historyPath, {});
  for (const [caseId, events] of Object.entries(loadedHistory)) {
    if (Array.isArray(events)) caseHistory.set(caseId, events);
  }

  const loadedSnapshots = readJson(comparisonSnapshotsPath, {});
  for (const [caseId, snapshots] of Object.entries(loadedSnapshots)) {
    if (Array.isArray(snapshots)) comparisonSnapshots.set(caseId, snapshots);
  }

  const archivedPrepared = readJson(preparedArchivePath, []);
  for (const prepared of archivedPrepared) {
    if (!prepared?.token || !prepared?.caseId) continue;
    preparedCases.set(prepared.token, prepared);
    if (!preparedCases.has(prepared.caseId)) preparedCases.set(prepared.caseId, prepared);
  }
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
  if (options.templateId || options.templateOverrides || options.hemMonthly || options.financialAssetBuffer) {
    const draft = buildDocumentDraft([], {
      templateId: options.templateId,
      templateOverrides: options.templateOverrides,
      hemMonthly: options.hemMonthly,
      financialAssetBuffer: options.financialAssetBuffer
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

hydrateLocalHistory();

app.get("/api/health", (_request, response) => {
  response.json({ ok: true, service: "Infinity AOL AutoFill Assistant" });
});

app.get("/api/cases", (_request, response) => {
  response.json(
    cases.map((caseData) => ({
      id: caseData.id,
      status: caseData.status,
      brokerUser: caseData.brokerUser,
      applicantNames: caseData.applicants.map((applicant) => `${applicant.firstName} ${applicant.lastName}`).join(" & "),
      loanAmount: caseData.loan.loanAmount,
      propertyAddress: caseData.property.address || "Missing property address"
    }))
  );
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
    financialAssetBuffer: request.body?.financialAssetBuffer
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
    templateOverrides: request.body.templateOverrides
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
  if (request.files?.length || request.body.templateId || request.body.templateOverrides || request.body.hemMonthly || request.body.financialAssetBuffer) {
    draft = buildDocumentDraft(request.files, {
      hemMonthly: request.body.hemMonthly,
      financialAssetBuffer: request.body.financialAssetBuffer,
      templateId: request.body.templateId,
      templateOverrides: request.body.templateOverrides
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

if (fs.existsSync(distPath)) {
  app.use(express.static(distPath));
  app.get(/^\/(?!api).*/, (_request, response) => {
    response.sendFile(path.join(distPath, "index.html"));
  });
}

export { app };

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  app.listen(port, () => {
    console.log(`Infinity AOL AutoFill Assistant API running on http://127.0.0.1:${port}`);
  });
}
