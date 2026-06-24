const EASYFLOW_EXTENSION_BUILD_ID = "aol-workflow-v2.35";
const REPORT_HISTORY_KEY = "easyflowReportHistory";
const REPORT_HISTORY_LIMIT = 5;

const state = {
  prepared: null,
  mapping: null,
  lastResult: null,
  lastDiagnostics: null
};

const els = {
  apiBase: document.querySelector("#apiBase"),
  caseToken: document.querySelector("#caseToken"),
  casePicker: document.querySelector("#casePicker"),
  refreshCases: document.querySelector("#refreshCases"),
  startInfinityAutofill: document.querySelector("#startInfinityAutofill"),
  startAolAutofill: document.querySelector("#startAolAutofill"),
  runDiagnostics: document.querySelector("#runDiagnostics"),
  copyDiagnostics: document.querySelector("#copyDiagnostics"),
  copyInfinityReport: document.querySelector("#copyInfinityReport"),
  copyAolReport: document.querySelector("#copyAolReport"),
  toggleChecklist: document.querySelector("#toggleChecklist"),
  fillSection: document.querySelector("#fillSection"),
  comparePage: document.querySelector("#comparePage"),
  roSync: document.querySelector("#roSync"),
  compareCase: document.querySelector("#compareCase"),
  status: document.querySelector("#status"),
  reviewRows: document.querySelector("#reviewRows"),
  buildId: document.querySelector("#buildId")
};

// Show the REAL installed version straight from the manifest (chrome.runtime.getManifest) — so after a reload
// the badge is literally what Chrome loaded, never a stale hand-typed number. One number, big, top-right.
const EF_VERSION = (() => { try { return chrome.runtime.getManifest().version; } catch (_e) { return ""; } })();
const efVerBadge = document.querySelector("#versionBadge");
if (efVerBadge) efVerBadge.textContent = EF_VERSION ? `v${EF_VERSION}` : "v?";
if (els.buildId) els.buildId.textContent = `v${EF_VERSION} · ${EASYFLOW_EXTENSION_BUILD_ID}`;

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

chrome.storage.local.get(["apiBase", "caseToken", REPORT_HISTORY_KEY], (stored) => {
  if (stored.apiBase) {
    els.apiBase.value = stored.apiBase.includes("easy-loan-finance-booking.onrender.com")
      ? "https://booking.easyloanfinance.com.au/infinity-aol"
      : stored.apiBase;
  }
  if (stored.caseToken) els.caseToken.value = stored.caseToken;
  hydrateLastReport(stored[REPORT_HISTORY_KEY]);
  loadPreparedCases().catch((error) => setStatus(error.message, "error"));
});

function setStatus(message, type = "muted") {
  els.status.className = `status ${type}`;
  els.status.textContent = message;
}

// ===== Progress bar (0–100%) for Start Infinity / Start AOL / Sync =====
// Driven by REAL EF_PROGRESS messages the content script emits at each step, plus a gentle auto-creep toward a
// cap so the bar always shows movement (installer feel) even when steps are slow or the content script is older.
const efProgEls = {
  box: document.querySelector("#efProgress"),
  bar: document.querySelector("#efProgressBar"),
  text: document.querySelector("#efProgressText"),
  pct: document.querySelector("#efProgressPct")
};
let efProgTimer = null, efProgPct = 0, efProgCap = 92, efProgLabel = "Working…";
function efProgRender() {
  if (!efProgEls.box) return;
  const p = Math.max(0, Math.min(100, Math.round(efProgPct)));
  efProgEls.bar.style.width = p + "%";
  efProgEls.text.textContent = efProgLabel;
  efProgEls.pct.textContent = p + "%";
}
function efProgressShow(label, cap = 92) {
  if (!efProgEls.box) return;
  efProgLabel = label || "Working…"; efProgPct = 3; efProgCap = cap;
  efProgEls.box.style.display = "block"; efProgRender();
  clearInterval(efProgTimer);
  efProgTimer = setInterval(() => { if (efProgPct < efProgCap) { efProgPct += (efProgCap - efProgPct) * 0.05 + 0.25; efProgRender(); } }, 450);
}
function efProgressSet(pct, label) {
  if (!efProgEls.box) return;
  if (typeof pct === "number" && pct > efProgPct) efProgPct = pct;
  if (label) efProgLabel = label;
  efProgRender();
}
function efProgressDone(label) {
  clearInterval(efProgTimer); efProgTimer = null;
  efProgPct = 100; efProgLabel = label || "Done"; efProgRender();
  setTimeout(() => { if (efProgEls.box) efProgEls.box.style.display = "none"; }, 1400);
}
function efProgressHide() { clearInterval(efProgTimer); efProgTimer = null; if (efProgEls.box) efProgEls.box.style.display = "none"; }
// Live step updates pushed by the content script during a run/sweep.
chrome.runtime.onMessage.addListener((msg) => {
  if (msg && msg.type === "EF_PROGRESS") efProgressSet(msg.pct, msg.label);
});

function enableAdvanced(enabled) {
  els.fillSection.disabled = !enabled;
  els.compareCase.disabled = !enabled;
}

function hydrateLastReport(history = []) {
  const latest = Array.isArray(history) ? history[0] : null;
  if (!latest?.report) return;
  if (latest.kind === "diagnostic") {
    state.lastDiagnostics = latest.report;
    state.lastResult = latest.report;
  } else {
    state.lastDiagnostics = null;
    state.lastResult = latest.report;
  }
  els.copyDiagnostics.disabled = false;
  setStatus(`Loaded last ${latest.kind || "autofill"} report from ${new Date(latest.savedAt || Date.now()).toLocaleString()}.`, "muted");
}

function persistReport(kind, report) {
  if (!report) return;
  const entry = {
    kind,
    savedAt: new Date().toISOString(),
    caseId: state.prepared?.caseId || report.caseId || report.meta?.caseId || "",
    report
  };
  chrome.storage.local.get([REPORT_HISTORY_KEY], (stored) => {
    const history = Array.isArray(stored[REPORT_HISTORY_KEY]) ? stored[REPORT_HISTORY_KEY] : [];
    chrome.storage.local.set({ [REPORT_HISTORY_KEY]: [entry, ...history].slice(0, REPORT_HISTORY_LIMIT) });
  });
}

async function readJsonResponse(response, fallbackMessage) {
  const text = await response.text();
  try {
    return text ? JSON.parse(text) : {};
  } catch (_error) {
    throw new Error(`${fallbackMessage}. The API returned a web page instead of JSON; check the EasyFlow API URL.`);
  }
}

function shortValue(value) {
  const text = String(value ?? "");
  return text.length > 60 ? `${text.slice(0, 57)}...` : text;
}

function easyFlowUrlForIssue(issue = {}) {
  if (!state.prepared?.caseId) return "";
  const apiBase = els.apiBase.value.replace(/\/$/, "");
  const url = new URL(apiBase);
  const path = url.pathname.replace(/\/api\/?.*$/, "").replace(/\/$/, "");
  url.pathname = path || "/";
  url.search = "";
  url.hash = "";
  url.searchParams.set("caseId", state.prepared.caseId);
  url.searchParams.set("fix", issue.fixTarget || fixTargetForIssue(issue));
  if (issue.path) url.searchParams.set("path", issue.path);
  if (issue.code) url.searchParams.set("code", issue.code);
  return url.toString();
}

function fixTargetForIssue(issue = {}) {
  const text = `${issue.code || ""} ${issue.path || ""} ${issue.section || ""} ${issue.label || ""}`.toLowerCase();
  if (text.includes("hem") || text.includes("living") || text.includes("expense")) return "hem";
  if (text.includes("document") || text.includes("ocr") || text.includes("intake")) return "documents";
  if (text.includes("serviceability") || text.includes("loan") || text.includes("property") || text.includes("applicant") || text.includes("income")) return "quick-inputs";
  if (text.includes("validation")) return "validation";
  return "validation";
}

async function openIssueInEasyFlow(issue) {
  const url = easyFlowUrlForIssue(issue);
  if (!url) return;
  await chrome.tabs.create({ url });
}

function appendIssueRow(issue) {
  const row = document.createElement("button");
  row.className = `review-row issue-link ${issue.severity || ""}`;
  row.type = "button";
  const strong = document.createElement("strong");
  strong.textContent = issue.label;
  const span = document.createElement("span");
  span.textContent = issue.value;
  const small = document.createElement("small");
  small.textContent = "Click to fix in EasyFlow AI";
  row.append(strong, span, small);
  row.addEventListener("click", () => openIssueInEasyFlow(issue).catch((error) => setStatus(error.message, "error")));
  els.reviewRows.append(row);
}

function appendWorkflowStepRow(step) {
  const failed = ["error", "failed", "partial_failed"].includes(String(step.status || "").toLowerCase());
  const canRetry = failed && (step.platform || state.lastResult?.platform || "infinity") === "infinity";
  const row = document.createElement(canRetry ? "button" : "div");
  row.className = `review-row workflow-step ${failed ? "issue-link error" : ""}`;
  if (canRetry) row.type = "button";

  const strong = document.createElement("strong");
  strong.textContent = `Step ${step.order || ""}: ${step.label || step.id}`.trim();
  const span = document.createElement("span");
  span.textContent = step.status || "pending";
  const small = document.createElement("small");
  small.textContent = canRetry
    ? "Click to retry only this step"
    : (step.message || "Ready");
  row.append(strong, span, small);

  if (canRetry) {
    row.addEventListener("click", () => retryWorkflowStep(step).catch((error) => setStatus(error.message, "error")));
  }
  els.reviewRows.append(row);
}

function renderReview() {
  els.reviewRows.innerHTML = "";
  if (!state.prepared) return;

  const rows = [
    ["Case", state.prepared.caseId],
    ["Broker", state.prepared.brokerUser],
    ["Build", state.lastResult?.buildId || EASYFLOW_EXTENSION_BUILD_ID],
    ["Validation", state.prepared.validation.okToAutofill ? "Ready" : "Fix required fields first"]
  ];

  if (state.lastResult?.fieldsFilled) {
    rows.push(["Filled", String(asArray(state.lastResult.fieldsFilled).length)]);
    rows.push(["Skipped", String(asArray(state.lastResult.fieldsSkipped).length)]);
    rows.push(["Errors", String(asArray(state.lastResult.errors).length)]);
    rows.push(["Verify", String(asArray(state.lastResult.verificationFailures).length)]);
  }

  if (state.lastDiagnostics?.summary) {
    rows.push(["Test status", state.lastDiagnostics.summary.ok ? "Pass" : "Fail"]);
    rows.push(["Test checks", `${state.lastDiagnostics.summary.pass || 0} pass / ${state.lastDiagnostics.summary.fail || 0} fail / ${state.lastDiagnostics.summary.warn || 0} warn`]);
  }

  if (state.lastResult?.crossPlatformMismatches) {
    rows.push(["Snapshots", String(state.lastResult.snapshotCount)]);
    rows.push(["Page issues", String(Math.min(state.lastResult.pageIssues.length, 200)) + (state.lastResult.pageIssues.length > 200 ? ` shown of ${state.lastResult.pageIssues.length}` : "")]);
    rows.push(["Infinity/AOL issues", String(Math.min(state.lastResult.crossPlatformMismatches.length, 200)) + (state.lastResult.crossPlatformMismatches.length > 200 ? ` shown of ${state.lastResult.crossPlatformMismatches.length}` : "")]);
    rows.push(["Not checked yet", String(state.lastResult.pendingChecks?.length || 0)]);
  }

  if (state.lastResult?.comparisonRows?.length) {
    const reviewCount = state.lastResult.comparisonRows.filter((row) => row.status !== "match").length;
    rows.push(["Common compare", `${reviewCount} review / ${state.lastResult.comparisonRows.length} checked`]);
  }

  for (const [label, value] of rows) {
    const row = document.createElement("div");
    row.className = "review-row";
    row.innerHTML = `<strong>${label}</strong><span>${value}</span>`;
    els.reviewRows.append(row);
  }

  if (state.lastResult?.workflowSteps?.length) {
    for (const step of state.lastResult.workflowSteps) appendWorkflowStepRow(step);
  }

  const issues = [
    ...(state.prepared?.validation?.issues || []).map((issue) => ({
      label: issue.code?.replaceAll("_", " ") || "Validation issue",
      value: issue.message || issue.path || "Fix this prepared payload issue.",
      code: issue.code,
      path: issue.path,
      severity: issue.severity
    })),
    ...(!hasConfirmedHem(state.prepared?.payload) && !(state.prepared?.validation?.issues || []).some((issue) => issue.code === "HEM_NOT_CONFIRMED") ? [{
      label: "HEM NOT CONFIRMED",
      value: "Confirm HEM / living expense breakdown before Financials autofill.",
      code: "HEM_NOT_CONFIRMED",
      path: "serviceability.hemConfirmed",
      severity: "error",
      fixTarget: "hem"
    }] : []),
    ...(state.lastResult?.errors || []).map((issue) => ({
      label: `${issue.section || "AutoFill"} error`,
      value: issue.message || issue.label || "Review this section.",
      section: issue.section,
      severity: "error"
    })),
    ...(state.lastResult?.verificationFailures || []).map((issue) => ({
      label: `${issue.section || "Verify"}: ${issue.label || "verification"}`,
      value: issue.message || "Expected value was not visible after save.",
      section: issue.section,
      path: issue.path,
      severity: "error"
    })),
    ...(state.lastResult?.pageIssues || []).slice(0, 8).map((issue) => ({
      label: `${issue.platform || "page"}: ${issue.label}`,
      value: `${shortValue(issue.actual ?? "missing")} -> ${shortValue(issue.expected ?? "")}`,
      path: issue.fieldPath || issue.path,
      section: issue.platform
    })),
    ...(state.lastResult?.crossPlatformMismatches || []).slice(0, 8).map((issue) => ({
      label: `Infinity/AOL: ${issue.label}`,
      value: `${shortValue(issue.infinityValue ?? "blank")} <> ${shortValue(issue.aolValue ?? "blank")}`,
      path: issue.fieldPath || issue.path,
      section: "comparison"
    })),
    ...(state.lastResult?.comparisonRows || [])
      .filter((row) => row.status !== "match")
      .slice(0, 6)
      .map((row) => ({
        label: `Common: ${row.label}`,
        value: `${shortValue(row.infinity ?? "blank")} <> ${shortValue(row.aol ?? "blank")}`,
        section: "comparison"
      })),
    ...(state.lastDiagnostics?.checks || [])
      .filter((check) => check.status !== "pass")
      .map((check) => ({
        label: `Test: ${check.label}`,
        value: check.message || JSON.stringify(check.details || {}),
        section: check.section,
        severity: check.status === "fail" ? "error" : ""
      }))
  ].slice(0, 8);

  for (const issue of issues) {
    appendIssueRow(issue);
  }
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

function runtimeErrorMessage() {
  return chrome.runtime.lastError?.message || "";
}

async function injectContentScript(tabId) {
  await chrome.scripting.executeScript({
    target: { tabId },
    files: ["contentScript.infinityWorkflow.v4.js"]
  });
}

async function pingContent(tabId) {
  return chrome.tabs.sendMessage(tabId, { type: "INFINITY_AOL_PING" });
}

async function ensureContentScript(tabId) {
  try {
    await pingContent(tabId);
    return;
  } catch (error) {
    if (!/Receiving end does not exist|Could not establish connection/i.test(error.message || runtimeErrorMessage())) {
      throw error;
    }
  }

  await injectContentScript(tabId);
  await new Promise((resolve) => setTimeout(resolve, 150));
  await pingContent(tabId);
}

async function sendToContent(message) {
  const tab = await getActiveTab();
  await ensureContentScript(tab.id);
  return chrome.tabs.sendMessage(tab.id, message);
}

function hasConfirmedHem(payload) {
  return payload?.serviceability?.hemConfirmed === true ||
    payload?.expenses?.hemConfirmed === true ||
    payload?.documentIntake?.assumptions?.hemConfirmed === true;
}

// The case to act on. The dropdown is the source of truth. Only fall back to the Advanced manual Case-ID
// override when there are genuinely NO selectable cases (manual mode) — NEVER silently reuse a stale stored
// token while a case list is present, or Start/Sync would run against the previously-selected case.
function getSelectedCaseToken() {
  const picked = els.casePicker.value.trim();
  if (picked) return picked;
  const hasCases = Array.from(els.casePicker.options).some((o) => o.value);
  return hasCases ? "" : els.caseToken.value.trim();
}
async function loadPayload() {
  const apiBase = els.apiBase.value.replace(/\/$/, "");
  const caseToken = getSelectedCaseToken();
  if (!caseToken) { state.prepared = null; throw new Error("Select a prepared case first."); }

  chrome.storage.local.set({ apiBase, caseToken });
  const [preparedResponse, mappingResponse] = await Promise.all([
    fetch(`${apiBase}/api/infinity/payload/${encodeURIComponent(caseToken)}`),
    fetch(`${apiBase}/api/infinity/mappings/current`)
  ]);

  const preparedJson = await readJsonResponse(preparedResponse, "Payload endpoint is not available");
  const mappingJson = await readJsonResponse(mappingResponse, "Mapping endpoint is not available");
  if (!preparedResponse.ok) throw new Error(preparedJson.error || "Payload not found");
  if (!mappingResponse.ok) throw new Error(mappingJson.error || "Mapping endpoint is not available");

  state.prepared = preparedJson;
  state.mapping = mappingJson;
  state.lastResult = null;
  enableAdvanced(state.prepared.validation.okToAutofill);
  renderReview();

  if (!state.prepared.validation.okToAutofill) {
    throw new Error("Prepared case has validation errors. Fix those before autofill.");
  }
  if (!hasConfirmedHem(state.prepared.payload)) {
    throw new Error("Confirm HEM / living expense breakdown in EasyFlow AI, then prepare again before autofill.");
  }
}

function renderPreparedCases(cases) {
  els.casePicker.innerHTML = "";
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = cases.length ? "Choose a prepared case" : "No prepared case found";
  els.casePicker.append(placeholder);

  for (const item of cases) {
    const option = document.createElement("option");
    option.value = item.token || item.caseId;
    option.textContent = `${item.label} - ${item.caseId}${item.okToAutofill ? "" : " (fix first)"}`;
    option.dataset.caseId = item.caseId || "";
    els.casePicker.append(option);
  }
}

async function loadPreparedCases() {
  const apiBase = els.apiBase.value.replace(/\/$/, "");
  setStatus("Loading prepared cases...", "muted");
  const response = await fetch(`${apiBase}/api/infinity/prepared-cases`);
  const data = await readJsonResponse(response, "Prepared case list is not available");
  if (!response.ok) throw new Error(data.error || "Prepared case list is not available");
  renderPreparedCases(data.cases || []);
  const storedToken = els.caseToken.value.trim();
  if (storedToken) els.casePicker.value = storedToken;
  setStatus(data.cases?.length ? "Choose a prepared case, then start AutoFill." : "Prepare a case in EasyFlow AI first.", "muted");
}

async function fetchComparisonReport() {
  const apiBase = els.apiBase.value.replace(/\/$/, "");
  const response = await fetch(`${apiBase}/api/cases/${encodeURIComponent(state.prepared.caseId)}/comparison-report`);
  if (!response.ok) return null;
  return response.json();
}

function setStartButtonsDisabled(disabled) {
  els.startInfinityAutofill.disabled = disabled;
  els.startAolAutofill.disabled = disabled;
}

async function startAutofill(targetPlatform = "auto") {
  const platLabel = targetPlatform === "aol" ? "AOL" : "Infinity";
  try {
    setStartButtonsDisabled(true);
    efProgressShow(`Starting ${platLabel}…`);
    setStatus(`Loading case and starting ${platLabel} AutoFill...`, "muted");
    await loadPayload();
    efProgressSet(8, `Filling ${platLabel}…`);
    renderReview();

    const apiBase = els.apiBase.value.replace(/\/$/, "");
    // For AOL, pull the lender scenarios captured earlier on Infinity from EasyFlow AI
    // (internal source of truth) so the content script can fill the Product Selector.
    if (targetPlatform !== "infinity" && state.prepared?.caseId) {
      try {
        const capRes = await fetch(`${apiBase}/api/cases/${encodeURIComponent(state.prepared.caseId)}/capture/lenderScenarios`);
        const capJson = await capRes.json().catch(() => null);
        if (capJson?.data) state.prepared.payload.lenderScenarios = capJson.data;
      } catch (_e) { /* non-fatal */ }
    }
    setStatus(`${targetPlatform === "aol" ? "AOL" : "Infinity"} AutoFill is running on the active tab. Review before Push AOL or Submit.`, "muted");
    const result = await sendToContent({
      type: "INFINITY_AOL_AUTOFILL",
      targetPlatform,
      payload: state.prepared.payload,
      mapping: state.mapping,
      apiBase,
      caseId: state.prepared?.caseId || ""
    });

    state.lastResult = result;
    state.lastDiagnostics = null;
    persistReport("autofill", result);
    if (Array.isArray(result?.loanFormMismatches) && result.loanFormMismatches.length && state.prepared?.caseId) {
      const noteBase = els.apiBase.value.replace(/\/$/, "");
      fetch(`${noteBase}/api/cases/${encodeURIComponent(state.prepared.caseId)}/loan-form-note`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mismatches: result.loanFormMismatches, brokerUser: state.prepared?.brokerUser })
      }).catch(() => {});
    }
    // Lender scenarios scraped on Infinity → store in EasyFlow AI for the AOL Product Selector.
    if (Array.isArray(result?.lenderScenarios) && result.lenderScenarios.length && state.prepared?.caseId) {
      fetch(`${apiBase}/api/cases/${encodeURIComponent(state.prepared.caseId)}/capture`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: "lenderScenarios", data: result.lenderScenarios, platform: "infinity", brokerUser: state.prepared?.brokerUser })
      }).catch(() => {});
    }
    // Live Infinity financials scraped during Start Infinity → store for the AOL Financials compare.
    if (result?.infinityFinancials && state.prepared?.caseId) {
      fetch(`${apiBase}/api/cases/${encodeURIComponent(state.prepared.caseId)}/capture`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: "infinityFinancials", data: result.infinityFinancials, platform: "infinity", brokerUser: state.prepared?.brokerUser })
      }).catch(() => {});
    }
    els.copyDiagnostics.disabled = false;
    const issues = asArray(result?.errors).length + asArray(result?.verificationFailures).length;
    efProgressDone(issues ? `${platLabel}: ${issues} to review` : `${platLabel} AutoFill done`);
    setStatus(
      issues
        ? `${result.message || `AutoFill stopped with ${issues} item(s) to review.`}`
        : "AutoFill finished. Review the page before Push AOL or Submit.",
      issues ? "error" : "success"
    );
    renderReview();
  } catch (error) {
    efProgressHide();
    state.lastDiagnostics = null;
    state.lastResult = {
      status: "failed",
      blockedAt: "popup",
      message: error.message || String(error),
      platform: "extension-popup",
      fieldsFilled: [],
      fieldsSkipped: [],
      errors: [{
        section: "popup",
        label: "Start AutoFill",
        message: error.message || String(error),
        stack: error.stack || ""
      }],
      verificationFailures: [],
      actions: [],
      createdAt: new Date().toISOString()
    };
    persistReport("autofill-error", state.lastResult);
    els.copyDiagnostics.disabled = false;
    setStatus(error.message, "error");
    renderReview();
  } finally {
    setStartButtonsDisabled(false);
  }
}

async function retryWorkflowStep(step) {
  if (!step?.id) throw new Error("No workflow step selected.");
  if ((step.platform || state.lastResult?.platform || "infinity") !== "infinity") {
    throw new Error("Step retry is currently available for Infinity steps only.");
  }
  try {
    setStartButtonsDisabled(true);
    setStatus(`Retrying ${step.label || step.id} only...`, "muted");
    if (!state.prepared || !state.mapping) await loadPayload();

    const apiBase = els.apiBase.value.replace(/\/$/, "");
    const result = await sendToContent({
      type: "INFINITY_AOL_RETRY_STEP",
      stepId: step.id,
      payload: state.prepared.payload,
      mapping: state.mapping,
      apiBase,
      caseId: state.prepared?.caseId || ""
    });

    state.lastResult = result;
    state.lastDiagnostics = null;
    persistReport("retry-step", result);
    els.copyDiagnostics.disabled = false;
    const issues = asArray(result?.errors).length + asArray(result?.verificationFailures).length;
    setStatus(
      issues ? `${result.message || `${step.label || step.id} retry still needs review.`}` : `${step.label || step.id} retry finished.`,
      issues ? "error" : "success"
    );
    renderReview();
  } finally {
    setStartButtonsDisabled(false);
  }
}

function diagnosticReportText(report) {
  if (!report) return "";
  const lines = [
    "EASYFLOW AI DIAGNOSTIC REPORT",
    `Time: ${new Date().toISOString()}`,
    `URL: ${report.url || ""}`,
    `Platform: ${report.platform || ""}`,
    `Summary: ${report.summary?.ok ? "PASS" : "FAIL"} (${report.summary?.pass || 0} pass, ${report.summary?.warn || 0} warn, ${report.summary?.fail || 0} fail)`,
    "",
    "Checks:"
  ];
  for (const check of report.checks || []) {
    lines.push(`- [${String(check.status || "").toUpperCase()}] ${check.section || "general"} > ${check.label}: ${check.message || ""}`);
    if (check.details && Object.keys(check.details).length) lines.push(`  details: ${JSON.stringify(check.details)}`);
  }
  if (report.errors?.length) {
    lines.push("", "Errors:");
    for (const error of report.errors) lines.push(`- ${error.message || JSON.stringify(error)}`);
  }
  lines.push("", "Raw JSON:", JSON.stringify(report, null, 2));
  return lines.join("\n");
}

function autofillReportText(report) {
  if (!report) return "";
  const lines = [
    "EASYFLOW AI AUTOFILL RUN REPORT",
    `Time: ${new Date().toISOString()}`,
    `Status: ${report.status || ""}`,
    `BlockedAt: ${report.blockedAt || ""}`,
    `Message: ${report.message || ""}`,
    `Platform: ${report.platform || ""}`,
    "",
    `Filled: ${report.fieldsFilled?.length || 0}`,
    `Skipped: ${report.fieldsSkipped?.length || 0}`,
    `Errors: ${report.errors?.length || 0}`,
    `Verification failures: ${report.verificationFailures?.length || 0}`,
    "",
    "Errors:"
  ];
  for (const item of report.errors || []) lines.push(`- ${item.section || ""} > ${item.label || ""}: ${item.message || item.reason || ""} ${JSON.stringify(item)}`);
  lines.push("", "Verification failures:");
  for (const item of report.verificationFailures || []) lines.push(`- ${item.section || ""} > ${item.label || ""}: ${item.message || item.reason || ""} ${JSON.stringify(item)}`);
  lines.push("", "Workflow steps:");
  for (const item of report.workflowSteps || []) lines.push(`- ${item.order || ""}. ${item.label || item.id}: ${item.status || ""} ${item.message || ""}`);
  lines.push("", "Common Infinity/AOL comparison:");
  for (const row of report.comparisonRows || []) lines.push(`- ${row.status}: ${row.label} | Infinity=${row.infinity ?? ""} | AOL=${row.aol ?? ""}`);
  lines.push("", "Skipped:");
  for (const item of report.fieldsSkipped || []) lines.push(`- ${item.section || ""} > ${item.label || ""}: ${item.reason || ""} ${JSON.stringify(item)}`);
  lines.push("", "Actions:");
  for (const item of report.actions || []) lines.push(`- ${item.section || ""} > ${item.action || ""}: ${item.label || ""} ${JSON.stringify(item)}`);
  lines.push("", "Raw JSON:", JSON.stringify(report, null, 2));
  return lines.join("\n");
}

async function runDiagnostics() {
  try {
    els.runDiagnostics.disabled = true;
    els.copyDiagnostics.disabled = true;
    setStatus("Running page test. No fields will be saved.", "muted");
    await loadPayload();
    const result = await sendToContent({
      type: "INFINITY_AOL_RUN_DIAGNOSTICS",
      payload: state.prepared.payload,
      mapping: state.mapping,
      apiBase: els.apiBase.value.replace(/\/$/, "")
    });
    state.lastDiagnostics = result;
    state.lastResult = result;
    persistReport("diagnostic", result);
    els.copyDiagnostics.disabled = false;
    els.copyDiagnostics.disabled = false;
    const summary = result.summary || {};
    setStatus(
      summary.ok
        ? `Test passed: ${summary.pass || 0} checks OK.`
        : `Test found ${summary.fail || 0} fail and ${summary.warn || 0} warning check(s). Copy report for Codex.`,
      summary.ok ? "success" : "error"
    );
    renderReview();
  } catch (error) {
    state.lastDiagnostics = null;
    state.lastResult = {
      status: "failed",
      blockedAt: "popup",
      message: error.message || String(error),
      platform: "extension-popup",
      fieldsFilled: [],
      fieldsSkipped: [],
      errors: [{
        section: "popup",
        label: "Run Test",
        message: error.message || String(error),
        stack: error.stack || ""
      }],
      verificationFailures: [],
      actions: [],
      createdAt: new Date().toISOString()
    };
    persistReport("diagnostic-error", state.lastResult);
    els.copyDiagnostics.disabled = false;
    setStatus(error.message, "error");
    renderReview();
  } finally {
    els.runDiagnostics.disabled = false;
  }
}

async function copyDiagnostics() {
  if (!state.lastResult && !state.lastDiagnostics) {
    const stored = await chrome.storage.local.get([REPORT_HISTORY_KEY]);
    hydrateLastReport(stored[REPORT_HISTORY_KEY]);
  }
  const text = state.lastDiagnostics ? diagnosticReportText(state.lastDiagnostics) : autofillReportText(state.lastResult);
  if (!text) {
    setStatus("Run Test or Start AutoFill first, then copy the report.", "error");
    return;
  }
  await navigator.clipboard.writeText(text);
  setStatus("Report copied. Paste it into Codex for the next fix.", "success");
}

// Copy the most recent autofill report for a specific platform ("infinity" or "aol")
// from the saved history, so Infinity and AOL reports can be copied separately.
async function copyReportByTarget(target) {
  const stored = await chrome.storage.local.get([REPORT_HISTORY_KEY]);
  const history = Array.isArray(stored[REPORT_HISTORY_KEY]) ? stored[REPORT_HISTORY_KEY] : [];
  const entry = history.find((e) => (e.report?.target || "") === target);
  if (!entry?.report) {
    setStatus(`No ${target.toUpperCase()} report yet — run ${target === "aol" ? "Start AOL" : "Start Infinity"} first.`, "error");
    return;
  }
  const text = autofillReportText(entry.report);
  await navigator.clipboard.writeText(text);
  setStatus(`${target === "aol" ? "AOL" : "Infinity"} report copied (${new Date(entry.savedAt).toLocaleTimeString()}).`, "success");
}

async function fillCurrentPopup() {
  await loadPayload();
  const result = await sendToContent({
    type: "INFINITY_AOL_AUTOFILL",
    mode: "currentSection",
    payload: state.prepared.payload,
    mapping: state.mapping,
    apiBase: els.apiBase.value.replace(/\/$/, "")
  });
  state.lastResult = result;
  persistReport("current-section", result);
  const issueCount = (result.errors?.length || 0) + (result.verificationFailures?.length || 0);
  setStatus(`${result.fieldsFilled.length} filled, ${result.fieldsSkipped.length} skipped, ${issueCount} issue(s).`, issueCount ? "error" : "success");
  renderReview();
}

async function checkCurrentPage() {
  await loadPayload();
  const apiBase = els.apiBase.value.replace(/\/$/, "");
  // Prefer a FRESH scrape of the open Infinity tab (reflects the broker's CURRENT edits) over the server
  // capture, which lags manual Infinity changes and caused the "extension 3150 vs AOL 3050" mismatch.
  let freshInf = null;
  try {
    const allTabs = await chrome.tabs.query({});
    const infTab = allTabs.find((t) => /infynity|infinity/i.test(t.url || "") && !/applyonline|loankit/i.test(t.url || ""));
    if (infTab) {
      const fin = await chrome.tabs.sendMessage(infTab.id, { type: "EF_GET_FINANCIALS" }).catch(() => null);
      if (fin && fin.ok && fin.financials && (fin.financials.expenses || []).length) freshInf = fin.financials;
    }
  } catch (_e) { /* fall back to the server capture */ }
  // Pull the captured LIVE Infinity financials so the AOL compare uses real Infinity values.
  if (state.prepared?.caseId) {
    if (freshInf) {
      state.prepared.payload.liveInfinityFinancials = freshInf;
      fetch(`${apiBase}/api/cases/${encodeURIComponent(state.prepared.caseId)}/capture`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: "infinityFinancials", data: freshInf, platform: "infinity" })
      }).catch(() => {});
    } else try {
      const r = await fetch(`${apiBase}/api/cases/${encodeURIComponent(state.prepared.caseId)}/capture/infinityFinancials`);
      const j = await r.json().catch(() => null);
      if (j?.data) state.prepared.payload.liveInfinityFinancials = j.data;
    } catch (_e) { /* non-fatal */ }
    // Also pull the captured LIVE AOL financials so the Infinity-side compare (AOL ➜ Infinity) has data.
    try {
      const r2 = await fetch(`${apiBase}/api/cases/${encodeURIComponent(state.prepared.caseId)}/capture/aolFinancials`);
      const j2 = await r2.json().catch(() => null);
      if (j2?.data) state.prepared.payload.liveAolFinancials = j2.data;
    } catch (_e) { /* non-fatal */ }
  }
  const result = await sendToContent({
    type: "INFINITY_AOL_COMPARE",
    mode: "visible",
    payload: state.prepared.payload,
    mapping: state.mapping
  });

  // Store the scraped live financials in EasyFlow (per-platform snapshot for the compare / sync-back).
  if (result?.infinityFinancials && state.prepared?.caseId) {
    fetch(`${apiBase}/api/cases/${encodeURIComponent(state.prepared.caseId)}/capture`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: "infinityFinancials", data: result.infinityFinancials, platform: "infinity" })
    }).catch(() => {});
  }
  if (result?.aolFinancials && state.prepared?.caseId) {
    fetch(`${apiBase}/api/cases/${encodeURIComponent(state.prepared.caseId)}/capture`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: "aolFinancials", data: result.aolFinancials, platform: "aol" })
    }).catch(() => {});
  }
  await fetch(`${apiBase}/api/cases/${encodeURIComponent(state.prepared.caseId)}/comparison-snapshot`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(result)
  }).catch(() => {});

  state.lastResult = result;
  persistReport("compare-visible", result);
  if (result?.infinityFinancials) {
    const n = result.infinityFinancials.expenses?.length || 0;
    setStatus(`Captured ${n} live Infinity expense(s) → now open the AOL Financials tab and click Compare to sync.`, "success");
  } else if (result?.compareSummary) {
    const { total, differences } = result.compareSummary;
    setStatus(
      differences
        ? `Expenses: ${differences}/${total} differ between Infinity and AOL — see the compare panel to sync.`
        : `Expenses match (${total} categories). `,
      differences ? "error" : "success"
    );
  } else if (result?.matched) {
    setStatus(`${result.matched.length} matched, ${result.mismatched.length} mismatched, ${result.missing.length} missing.`, result.mismatched.length || result.missing.length ? "error" : "success");
  } else {
    setStatus("Open the AOL Financials tab, then click Compare to diff against Infinity.", "muted");
  }
  renderReview();
}

async function compareCase() {
  await loadPayload();
  state.lastResult = await fetchComparisonReport();
  persistReport("compare-case", state.lastResult);
  const count = (state.lastResult?.pageIssues?.length || 0) + (state.lastResult?.crossPlatformMismatches?.length || 0);
  setStatus(
    count ? `${count} issue(s) found between prepared data, Infinity, and AOL.` : "No checked mismatch found so far.",
    count ? "error" : "success"
  );
  renderReview();
}

async function roSync() {
  await loadPayload();
  const apiBase = els.apiBase.value.replace(/\/$/, "");
  const result = await sendToContent({
    type: "INFINITY_AOL_RO_SYNC",
    apiBase,
    caseId: state.prepared?.caseId || "",
    payload: state.prepared?.payload || {}
  });
  if (!result?.ok) { setStatus(result?.error || "R&O sync failed.", "error"); return; }
  const modeLabel = result.mode === "teach"
    ? (result.saved ? `taught ${result.lender} template ✓ (${result.learned} reasons)` : "taught (save failed)")
    : `applied ${result.lender} template (${result.learned} reasons)`;
  setStatus(`R&O ${modeLabel} — ticked ${result.ticked}, unticked ${result.unticked}`, "success");
}

els.startInfinityAutofill.addEventListener("click", () => startAutofill("infinity"));
els.startAolAutofill.addEventListener("click", () => startAutofill("aol"));
els.runDiagnostics.addEventListener("click", runDiagnostics);
els.copyDiagnostics.addEventListener("click", () => copyDiagnostics().catch((error) => setStatus(error.message, "error")));
els.copyInfinityReport.addEventListener("click", () => copyReportByTarget("infinity").catch((error) => setStatus(error.message, "error")));
els.copyAolReport.addEventListener("click", () => copyReportByTarget("aol").catch((error) => setStatus(error.message, "error")));
els.toggleChecklist.addEventListener("click", async () => {
  try {
    await loadPayload().catch(() => {});
    const r = await sendToContent({
      type: "INFINITY_AOL_TOGGLE_CHECKLIST",
      apiBase: els.apiBase.value.replace(/\/$/, ""),
      caseId: state.prepared?.caseId || ""
    });
    setStatus(r?.shown ? "Broker checklist shown on the page." : "Broker checklist hidden.", "muted");
  } catch (error) { setStatus(error.message, "error"); }
});
els.refreshCases.addEventListener("click", () => loadPreparedCases().catch((error) => setStatus(error.message, "error")));
els.casePicker.addEventListener("change", () => {
  els.caseToken.value = els.casePicker.value;
  chrome.storage.local.set({ caseToken: els.casePicker.value });
  // Picking the blank placeholder = no case. Drop any previously-loaded case + hide the sync panel so the
  // next Start/Sync can't run against the old one.
  if (!els.casePicker.value.trim()) {
    state.prepared = null;
    const p = document.querySelector("#reverseSyncPanel");
    if (p) { p.style.display = "none"; p.innerHTML = ""; }
    setStatus("Select a prepared case to begin.", "muted");
  }
});
els.fillSection.addEventListener("click", () => fillCurrentPopup().catch((error) => setStatus(error.message, "error")));
els.comparePage.addEventListener("click", () => checkCurrentPage().catch((error) => setStatus(error.message, "error")));
els.roSync.addEventListener("click", () => roSync().catch((error) => setStatus(error.message, "error")));
els.compareCase.addEventListener("click", () => compareCase().catch((error) => setStatus(error.message, "error")));

// ===== Per-broker login gate + document generation =====
const authEls = {
  loginBox: document.querySelector("#loginBox"),
  appBox: document.querySelector("#appBox"),
  email: document.querySelector("#loginEmail"),
  password: document.querySelector("#loginPassword"),
  loginBtn: document.querySelector("#loginBtn"),
  who: document.querySelector("#loggedInWho"),
  logoutBtn: document.querySelector("#logoutBtn"),
  genYtd: document.querySelector("#genYtd")
};
let brokerToken = null;
// The login endpoint lives on the ROOT host (not under /infinity-aol).
function rootApiBase() { return els.apiBase.value.replace(/\/$/, "").replace(/\/infinity-aol$/, ""); }
function decodeTokenExp(token) {
  try {
    const b64 = String(token).split(".")[0].replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(decodeURIComponent(escape(atob(b64)))).exp || 0;
  } catch { return 0; }
}
function showAuthState(token, name) {
  const valid = !!token && decodeTokenExp(token) > Date.now();
  brokerToken = valid ? token : null;
  if (authEls.loginBox) authEls.loginBox.style.display = valid ? "none" : "block";
  if (authEls.appBox) authEls.appBox.style.display = valid ? "block" : "none";
  if (valid && authEls.who) authEls.who.textContent = "Signed in: " + (name || "broker");
}
chrome.storage.local.get(["brokerToken", "brokerName"], (s) => showAuthState(s.brokerToken, s.brokerName));
async function brokerLogin() {
  const email = (authEls.email.value || "").trim(), password = authEls.password.value || "";
  if (!email || !password) { setStatus("Enter email and access code.", "error"); return; }
  setStatus("Signing in…", "muted");
  try {
    const res = await fetch(`${rootApiBase()}/api/auth/login`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password })
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok || !j.token || (j.role !== "broker" && j.role !== "admin")) { setStatus(j.error || "Wrong email or access code.", "error"); return; }
    chrome.storage.local.set({ brokerToken: j.token, brokerName: j.name || j.email });
    authEls.password.value = "";
    showAuthState(j.token, j.name || j.email);
    setStatus("Signed in as " + (j.name || j.email) + ".", "success");
    loadPreparedCases().catch(() => {});
  } catch (error) { setStatus("Sign in failed: " + error.message, "error"); }
}
function brokerLogout() { chrome.storage.local.remove(["brokerToken", "brokerName"]); showAuthState(null); setStatus("Signed out.", "muted"); }
authEls.loginBtn?.addEventListener("click", () => brokerLogin());
authEls.password?.addEventListener("keydown", (event) => { if (event.key === "Enter") brokerLogin(); });
authEls.logoutBtn?.addEventListener("click", () => brokerLogout());

function preparedClientName() {
  try {
    const p = state.prepared && state.prepared.payload;
    const a = (p && (p.applicants || (p.infinity && p.infinity.applicants))) || [];
    if (Array.isArray(a) && a[0]) return [a[0].firstName, a[0].lastName || a[0].surname].filter(Boolean).join(" ").trim();
  } catch (_e) { /* ignore */ }
  return "";
}
function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; document.body.appendChild(a); a.click();
  setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 1500);
}
// The server names the file from the CASE client name (e.g. RECNOTES_ARSALAN_SALEEM); prefer that over the
// popup's own guess, which can fall back to "CLIENT" when the prepared payload has no applicant names.
function filenameFromResponse(res, fallback) {
  try {
    const cd = res.headers.get("content-disposition") || "";
    const m = cd.match(/filename\*?=(?:UTF-8'')?"?([^";]+)"?/i);
    if (m && m[1]) { const n = decodeURIComponent(m[1].trim()); if (n && !/_CLIENT\.[a-z]+$/i.test(n)) return n; }
  } catch (_e) { /* fall back */ }
  return fallback;
}
// Silently pull the CURRENT Infinity state (applicants / income / selected lender + rate) and merge it
// server-side, so both documents reflect the broker's live edits. No buttons, no debug output.
// The content-script build the popup expects in the open Infinity tab. If the tab is running an OLDER content
// script (reloading the extension does NOT replace it — only an F5 does), the capture returns instantly with
// no tab-walk. Keep this in sync with EF_CS_BUILD in the content script; bump both when the sweep changes.
const EXPECTED_CS_BUILD = "2.11.0";
function waitForTabComplete(tabId, maxMs = 15000) {
  return new Promise((resolve) => {
    const start = Date.now();
    (function poll() {
      chrome.tabs.get(tabId, (t) => {
        if (chrome.runtime.lastError || !t) return resolve(false);
        if (t.status === "complete") return resolve(true);
        if (Date.now() - start >= maxMs) return resolve(false);
        setTimeout(poll, 250);
      });
    })();
  });
}
async function efCaptureLive(apiBase, caseId, full) {
  try {
    const tabs = await chrome.tabs.query({});
    const inf = tabs.find((t) => /infynity|infinity/i.test(t.url || ""));
    if (!inf) return "";
    setStatus(full ? "Reading all Infinity tabs…" : "Reading Infinity…", "muted");
    let scraped = await chrome.tabs.sendMessage(inf.id, { type: "EF_FULL_CAPTURE", full: !!full }).catch(() => null);
    // Stale (or missing) content script in the already-open tab → reload it ONCE so the new sweep code runs,
    // then retry. This is what makes "click Sync → it actually walks the tabs" work without a manual F5.
    if (!scraped || scraped.csBuild !== EXPECTED_CS_BUILD) {
      setStatus("Updating the Infinity page first…", "muted");
      await chrome.tabs.reload(inf.id);
      await waitForTabComplete(inf.id);
      await new Promise((r) => setTimeout(r, 1400)); // let the SPA + content script settle
      setStatus(full ? "Reading all Infinity tabs…" : "Reading Infinity…", "muted");
      scraped = await chrome.tabs.sendMessage(inf.id, { type: "EF_FULL_CAPTURE", full: !!full }).catch(() => null);
    }
    if (!scraped || !scraped.ok || !scraped.snapshot) return "";
    const merged = await fetch(`${apiBase}/api/cases/${encodeURIComponent(caseId)}/live-snapshot`, {
      method: "POST", headers: { "Content-Type": "application/json", "x-easyflow-broker-token": brokerToken },
      body: JSON.stringify(scraped.snapshot)
    }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    const s = (merged && merged.snapshot) || scraped.snapshot;
    const apps = (s.applicants || []).map((a) => a.name).join(", ") || "(none)";
    const scen = (s.scenarios || []).map((x) => `${x.lender} ${x.rate}%`).join(" | ") || "(none)";
    const inc = ((s.financials && s.financials.incomes) || [])
      .map((i) => `${i.type}${i.frequency ? " " + i.frequency : ""} $${Number(i.amount).toLocaleString()}`).join("; ") || "(none — open the Financials tab)";
    return `\nCaptured live → ${apps}\nincome: ${inc}\nlenders: ${scen}`;
  } catch (_e) { return ""; }
}

// YTD rides the selected Prepared case (server prefills client + base annual from the case; the broker
// completes the yellow payslip cells in Excel). No form in the popup.
async function generateYtd() {
  if (!brokerToken) { setStatus("Sign in first.", "error"); return; }
  await loadPayload().catch(() => {});
  if (!state.prepared || !state.prepared.caseId) { setStatus("Select a Prepared case first.", "error"); return; }
  const apiBase = els.apiBase.value.replace(/\/$/, "");
  const snapMsg = await efCaptureLive(apiBase, state.prepared.caseId);
  // The ONLY figure no synced source has is the YTD gross on the latest payslip. Ask for it ONCE — leaving it
  // blank reuses the value saved on the case (everything else: name, base, dates, frequency is auto from sync).
  const ytdRaw = window.prompt("YTD gross on the latest payslip\n(leave blank to use the saved / auto value):", "");
  const body = {};
  if (ytdRaw && Number(String(ytdRaw).replace(/[^0-9.]/g, "")) > 0) {
    body.ytdIncome = Number(String(ytdRaw).replace(/[^0-9.]/g, ""));
    // First Pay Day = the LATER of 1 July and the job start date. Only matters when the client started THIS
    // financial year — then the YTD must be annualised over days worked, not since 1 July.
    const startRaw = window.prompt("Did the client START this job during this financial year (after 1 July)?\nIf yes, enter the start date (dd/mm/yyyy). Leave BLANK if they started before 1 July.", "");
    if (startRaw && /^\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4}$/.test(startRaw.trim())) body.firstPayDay = startRaw.trim();
  }
  setStatus("Generating YTD…" + snapMsg, "muted");
  try {
    const res = await fetch(`${apiBase}/api/cases/${encodeURIComponent(state.prepared.caseId)}/ytd-calc`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-easyflow-broker-token": brokerToken },
      body: JSON.stringify(body)
    });
    if (res.status === 401) { setStatus("Session expired — sign in again.", "error"); showAuthState(null); return; }
    if (!res.ok) { const t = await res.text().catch(() => ""); setStatus("YTD failed: " + t.slice(0, 140), "error"); return; }
    downloadBlob(await res.blob(), filenameFromResponse(res, `YTD_${(preparedClientName() || "client").toUpperCase().replace(/[^A-Z0-9]+/g, "_")}.xlsx`));
    setStatus("✓ YTD Excel downloaded.", "success");
    loadDocHistory();
  } catch (error) { setStatus("YTD failed: " + error.message, "error"); }
}
authEls.genYtd?.addEventListener("click", () => generateYtd());

// Recommendation Notes: rides the selected Prepared case (server prefills from case data) — just download.
async function generateRec(format) {
  if (!brokerToken) { setStatus("Sign in first.", "error"); return; }
  await loadPayload().catch(() => {}); // ensure the selected case is loaded
  if (!state.prepared || !state.prepared.caseId) { setStatus("Select a Prepared case first.", "error"); return; }
  const apiBase = els.apiBase.value.replace(/\/$/, "");
  // Pull the CURRENT Infinity state (applicants/income/rate) so the note reflects the broker's live edits.
  const snapMsg = await efCaptureLive(apiBase, state.prepared.caseId);
  setStatus("Generating Rec Notes…" + snapMsg, "muted");
  try {
    const res = await fetch(`${apiBase}/api/cases/${encodeURIComponent(state.prepared.caseId)}/recommendation-notes?format=${format}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-easyflow-broker-token": brokerToken },
      body: JSON.stringify({})
    });
    if (res.status === 401) { setStatus("Session expired — sign in again.", "error"); showAuthState(null); return; }
    if (!res.ok) { const t = await res.text().catch(() => ""); setStatus("Rec Notes failed: " + t.slice(0, 140), "error"); return; }
    const name = filenameFromResponse(res, `RECNOTES_${(preparedClientName() || "client").toUpperCase().replace(/[^A-Z0-9]+/g, "_")}.${format === "docx" ? "docx" : "pdf"}`);
    downloadBlob(await res.blob(), name);
    setStatus("✓ Rec Notes downloaded.", "success");
    loadDocHistory();
  } catch (error) { setStatus("Rec Notes failed: " + error.message, "error"); }
}
document.querySelector("#genRecPdf")?.addEventListener("click", () => generateRec("pdf"));
document.querySelector("#genRecDocx")?.addEventListener("click", () => generateRec("docx"));

// Per-case document history ("downloaded / not yet") — persisted server-side so it follows the case across devices.
async function loadDocHistory() {
  const el = document.querySelector("#docHistory"); if (!el) return;
  if (!state.prepared || !state.prepared.caseId) { el.innerHTML = '<span class="muted">Select a Prepared case to see document history.</span>'; return; }
  const apiBase = els.apiBase.value.replace(/\/$/, "");
  try {
    const r = await fetch(`${apiBase}/api/cases/${encodeURIComponent(state.prepared.caseId)}/capture/docHistory`);
    const j = await r.json().catch(() => ({}));
    const h = (j && j.data) || {};
    const row = (label, e) => `<div>${label}: ${e && e.at ? "✓ " + (e.count || 1) + "× · " + new Date(e.at).toLocaleString() : '<span class="muted">not downloaded yet</span>'}</div>`;
    el.innerHTML = row("YTD Excel", h.ytd) + row("Rec PDF", h.recPdf) + row("Rec Word", h.recDocx);
  } catch (_e) { el.innerHTML = ""; }
}
els.casePicker.addEventListener("change", () => { loadPayload().then(loadDocHistory).catch(() => loadDocHistory()); });

// Reverse sync: capture live Infinity/AOL, show what differs from the EasyFlow case, let the broker tick the
// changes to apply. Applying writes a versioned "Updated from Infinity/AOL" overlay — the original is kept.
const escRs = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
// Header that always shows the case's TWO versions so the broker can tell them apart:
//   ① Loan form (client filled) — the original, never changed
//   ② Broker updated on Infinity & AOL — exists once the broker has applied changes (with date + fields).
function rsVersionBanner(versions) {
  if (!versions) return "";
  const b = versions.broker;
  const when = b && b.updatedAt ? new Date(b.updatedAt).toLocaleString() : "";
  const fields = b && b.changedFields && b.changedFields.length ? b.changedFields.join(", ") : "";
  return '<div class="rs-ver">'
    + '<div class="rs-ver-row client"><b>① Loan form</b> — client filled <span class="muted">(original, kept)</span></div>'
    + (b
      ? `<div class="rs-ver-row broker"><b>② Broker updated</b> — Infinity &amp; AOL${when ? ' · ' + escRs(when) : ''}${fields ? '<div class="muted">Changed: ' + escRs(fields) + '</div>' : ''}</div>`
      : '<div class="rs-ver-row broker pending"><b>② Broker version</b> — none yet <span class="muted">(apply changes below to create it)</span></div>')
    + '</div>';
}
async function reverseSyncReview() {
  const panel = document.querySelector("#reverseSyncPanel");
  if (!brokerToken) { setStatus("Sign in first.", "error"); return; }
  // Require an explicit case selection BEFORE doing anything (loadPayload's error is swallowed below, so guard
  // here too — otherwise Sync would run against a stale previously-loaded case).
  if (!getSelectedCaseToken()) { state.prepared = null; panel.style.display = "none"; setStatus("Select a prepared case first.", "error"); return; }
  await loadPayload().catch(() => {});
  const caseId = state.prepared && state.prepared.caseId;
  if (!caseId) { panel.style.display = "none"; setStatus("Select a prepared case first.", "error"); return; }
  const apiBase = els.apiBase.value.replace(/\/$/, "");
  panel.style.display = "block";
  panel.innerHTML = '<div class="muted">Scanning all Infinity tabs (Client Details → Financials → Loans &amp; Products)… this takes ~15s.</div>';
  efProgressShow("Opening Infinity…");
  // Read-only: ONE click walks every Infinity tab (full=true) the same way Start does, scrapes each, merges.
  await efCaptureLive(apiBase, caseId, true).catch(() => {});
  efProgressSet(94, "Reading changes…");
  await reverseSyncLoad(apiBase, caseId, false);
  efProgressDone("Scan complete");
}
async function reverseSyncLoad(apiBase, caseId, skipCapture) {
  const panel = document.querySelector("#reverseSyncPanel");
  if (!skipCapture) { /* capture already done by caller */ }
  let diffs = [], versions = null;
  try {
    const r = await fetch(`${apiBase}/api/cases/${encodeURIComponent(caseId)}/reverse-sync`, { headers: { "x-easyflow-broker-token": brokerToken } });
    const j = await r.json().catch(() => ({}));
    diffs = j.diffs || [];
    versions = j.versions || null;
  } catch (_e) { panel.innerHTML = '<div class="muted">Could not read changes.</div>'; return; }
  window._rsDiffs = diffs;
  // Two clearly-labelled versions of the case so the broker can tell them apart.
  const verBanner = rsVersionBanner(versions);
  if (!diffs.length) {
    setStatus("Scan complete — EasyFlow already matches Infinity.", "success");
    panel.innerHTML = verBanner
      + '<div class="rs-ok">✓ Client (loan form) and Infinity match — nothing new to copy across.<br><span class="muted">Scanned Client Details, Financials and Loans &amp; Products. Open the case in an Infinity tab before syncing.</span></div>';
    return;
  }
  setStatus(`Scan complete — ${diffs.length} difference(s) found.`, "muted");
  panel.innerHTML = verBanner
    + '<div class="rs-title">' + diffs.length + ' field(s) the broker changed in Infinity/AOL — tick to copy into the case</div>'
    + '<div class="rs-cols"><span>① Loan form (client)</span><span>② Broker · Infinity &amp; AOL</span></div>'
    + '<div class="rs-list">' + diffs.map((d, i) => `<label class="rs-row"><input type="checkbox" class="rs-ck" data-i="${i}" checked>`
      + `<span class="rs-lbl">${escRs(d.section)} · ${escRs(d.label)}</span>`
      + `<span class="rs-vals"><s>${escRs(d.easyflow) || "—"}</s> → <b>${escRs(d.live)}</b></span></label>`).join("") + '</div>'
    + '<button id="rsApply" class="primary-action" type="button">Apply selected → Broker version</button>';
  document.querySelector("#rsApply").addEventListener("click", () => reverseSyncApply(apiBase, caseId));
}
async function reverseSyncApply(apiBase, caseId) {
  const fields = {};
  document.querySelectorAll(".rs-ck:checked").forEach((ck) => { const d = (window._rsDiffs || [])[Number(ck.getAttribute("data-i"))]; if (d) fields[d.key] = d.value; });
  if (!Object.keys(fields).length) { setStatus("Nothing ticked.", "muted"); return; }
  try {
    const r = await fetch(`${apiBase}/api/cases/${encodeURIComponent(caseId)}/reverse-sync/apply`, {
      method: "POST", headers: { "Content-Type": "application/json", "x-easyflow-broker-token": brokerToken }, body: JSON.stringify({ fields })
    });
    if (!r.ok) { setStatus("Apply failed.", "error"); return; }
    await fetch(`${apiBase}/api/cases/${encodeURIComponent(caseId)}/prepare-infinity-aol`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }).catch(() => {});
    await loadPreparedCases().catch(() => {});
    setStatus("✓ Case updated from live data.", "success");
    await reverseSyncLoad(apiBase, caseId, true);     // reload diff — applied rows drop out
  } catch (error) { setStatus("Apply failed: " + error.message, "error"); }
}
document.querySelector("#reverseSync")?.addEventListener("click", () => reverseSyncReview());
