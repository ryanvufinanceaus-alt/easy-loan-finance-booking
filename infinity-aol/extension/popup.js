const EASYFLOW_EXTENSION_BUILD_ID = "aol-workflow-v2.18";
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
  fillSection: document.querySelector("#fillSection"),
  comparePage: document.querySelector("#comparePage"),
  compareCase: document.querySelector("#compareCase"),
  status: document.querySelector("#status"),
  reviewRows: document.querySelector("#reviewRows"),
  buildId: document.querySelector("#buildId")
};

if (els.buildId) els.buildId.textContent = `Build: ${EASYFLOW_EXTENSION_BUILD_ID}`;

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
    rows.push(["Filled", String(state.lastResult.fieldsFilled.length)]);
    rows.push(["Skipped", String(state.lastResult.fieldsSkipped.length)]);
    rows.push(["Errors", String(state.lastResult.errors.length)]);
    rows.push(["Verify", String(state.lastResult.verificationFailures?.length || 0)]);
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
    files: ["contentScript.js"]
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

async function loadPayload() {
  const apiBase = els.apiBase.value.replace(/\/$/, "");
  const selectedToken = els.casePicker.value.trim();
  const caseToken = (selectedToken || els.caseToken.value).trim();
  if (!caseToken) throw new Error("Enter the Case ID first.");

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
  try {
    setStartButtonsDisabled(true);
    setStatus(`Loading case and starting ${targetPlatform === "aol" ? "AOL" : "Infinity"} AutoFill...`, "muted");
    await loadPayload();
    renderReview();

    const apiBase = els.apiBase.value.replace(/\/$/, "");
    setStatus(`${targetPlatform === "aol" ? "AOL" : "Infinity"} AutoFill is running on the active tab. Review before Push AOL or Submit.`, "muted");
    const result = await sendToContent({
      type: "INFINITY_AOL_RUN_ALL_PAGES",
      targetPlatform,
      payload: state.prepared.payload,
      mapping: state.mapping,
      apiBase
    });

    state.lastResult = result;
    state.lastDiagnostics = null;
    persistReport("autofill", result);
    els.copyDiagnostics.disabled = false;
    const issues = (result.errors?.length || 0) + (result.verificationFailures?.length || 0);
    setStatus(
      issues
        ? `${result.message || `AutoFill stopped with ${issues} item(s) to review.`}`
        : "AutoFill finished. Review the page before Push AOL or Submit.",
      issues ? "error" : "success"
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
      apiBase
    });

    state.lastResult = result;
    state.lastDiagnostics = null;
    persistReport("retry-step", result);
    els.copyDiagnostics.disabled = false;
    const issues = (result.errors?.length || 0) + (result.verificationFailures?.length || 0);
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
  const result = await sendToContent({
    type: "INFINITY_AOL_COMPARE",
    mode: "visible",
    payload: state.prepared.payload,
    mapping: state.mapping
  });

  const apiBase = els.apiBase.value.replace(/\/$/, "");
  await fetch(`${apiBase}/api/cases/${encodeURIComponent(state.prepared.caseId)}/comparison-snapshot`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(result)
  });

  state.lastResult = result;
  persistReport("compare-visible", result);
  setStatus(`${result.matched.length} matched, ${result.mismatched.length} mismatched, ${result.missing.length} missing.`, result.mismatched.length || result.missing.length ? "error" : "success");
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

els.startInfinityAutofill.addEventListener("click", () => startAutofill("infinity"));
els.startAolAutofill.addEventListener("click", () => startAutofill("aol"));
els.runDiagnostics.addEventListener("click", runDiagnostics);
els.copyDiagnostics.addEventListener("click", () => copyDiagnostics().catch((error) => setStatus(error.message, "error")));
els.refreshCases.addEventListener("click", () => loadPreparedCases().catch((error) => setStatus(error.message, "error")));
els.casePicker.addEventListener("change", () => {
  els.caseToken.value = els.casePicker.value;
  chrome.storage.local.set({ caseToken: els.casePicker.value });
});
els.fillSection.addEventListener("click", () => fillCurrentPopup().catch((error) => setStatus(error.message, "error")));
els.comparePage.addEventListener("click", () => checkCurrentPage().catch((error) => setStatus(error.message, "error")));
els.compareCase.addEventListener("click", () => compareCase().catch((error) => setStatus(error.message, "error")));
