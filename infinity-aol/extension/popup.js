const state = {
  prepared: null,
  mapping: null,
  lastResult: null
};

const els = {
  apiBase: document.querySelector("#apiBase"),
  caseToken: document.querySelector("#caseToken"),
  casePicker: document.querySelector("#casePicker"),
  refreshCases: document.querySelector("#refreshCases"),
  startAutofill: document.querySelector("#startAutofill"),
  fillSection: document.querySelector("#fillSection"),
  comparePage: document.querySelector("#comparePage"),
  compareCase: document.querySelector("#compareCase"),
  status: document.querySelector("#status"),
  reviewRows: document.querySelector("#reviewRows")
};

chrome.storage.local.get(["apiBase", "caseToken"], (stored) => {
  if (stored.apiBase) {
    els.apiBase.value = stored.apiBase.includes("easy-loan-finance-booking.onrender.com")
      ? "https://booking.easyloanfinance.com.au/infinity-aol"
      : stored.apiBase;
  }
  if (stored.caseToken) els.caseToken.value = stored.caseToken;
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

function renderReview() {
  els.reviewRows.innerHTML = "";
  if (!state.prepared) return;

  const rows = [
    ["Case", state.prepared.caseId],
    ["Broker", state.prepared.brokerUser],
    ["Validation", state.prepared.validation.okToAutofill ? "Ready" : "Fix required fields first"]
  ];

  if (state.lastResult?.fieldsFilled) {
    rows.push(["Filled", String(state.lastResult.fieldsFilled.length)]);
    rows.push(["Skipped", String(state.lastResult.fieldsSkipped.length)]);
    rows.push(["Errors", String(state.lastResult.errors.length)]);
    rows.push(["Verify", String(state.lastResult.verificationFailures?.length || 0)]);
  }

  if (state.lastResult?.crossPlatformMismatches) {
    rows.push(["Snapshots", String(state.lastResult.snapshotCount)]);
    rows.push(["Page issues", String(state.lastResult.pageIssues.length)]);
    rows.push(["Infinity/AOL issues", String(state.lastResult.crossPlatformMismatches.length)]);
    rows.push(["Not checked yet", String(state.lastResult.pendingChecks?.length || 0)]);
  }

  for (const [label, value] of rows) {
    const row = document.createElement("div");
    row.className = "review-row";
    row.innerHTML = `<strong>${label}</strong><span>${value}</span>`;
    els.reviewRows.append(row);
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
    ...(state.lastResult?.pageIssues || []).map((issue) => ({
      label: `${issue.platform || "page"}: ${issue.label}`,
      value: `${shortValue(issue.actual ?? "missing")} -> ${shortValue(issue.expected ?? "")}`,
      path: issue.fieldPath || issue.path,
      section: issue.platform
    })),
    ...(state.lastResult?.crossPlatformMismatches || []).map((issue) => ({
      label: `Infinity/AOL: ${issue.label}`,
      value: `${shortValue(issue.infinityValue ?? "blank")} <> ${shortValue(issue.aolValue ?? "blank")}`,
      path: issue.fieldPath || issue.path,
      section: "comparison"
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

async function startAutofill() {
  try {
    els.startAutofill.disabled = true;
    setStatus("Loading case and starting AutoFill...", "muted");
    await loadPayload();
    renderReview();

    const apiBase = els.apiBase.value.replace(/\/$/, "");
    setStatus("AutoFill is running on this Infinity/AOL tab. Review before Push AOL or Submit.", "muted");
    const result = await sendToContent({
      type: "INFINITY_AOL_RUN_ALL_PAGES",
      payload: state.prepared.payload,
      mapping: state.mapping,
      apiBase
    });

    const report = await fetchComparisonReport();
    state.lastResult = report || result;
    const issues = (report?.pageIssues?.length || 0) + (report?.crossPlatformMismatches?.length || 0) + (result.errors?.length || 0) + (result.verificationFailures?.length || 0);
    setStatus(
      issues
        ? `AutoFill finished, but ${issues} item(s) need review. See Broker Review below.`
        : "AutoFill finished. Review the page before Push AOL or Submit.",
      issues ? "error" : "success"
    );
    renderReview();
  } catch (error) {
    setStatus(error.message, "error");
  } finally {
    els.startAutofill.disabled = false;
  }
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
  setStatus(`${result.matched.length} matched, ${result.mismatched.length} mismatched, ${result.missing.length} missing.`, result.mismatched.length || result.missing.length ? "error" : "success");
  renderReview();
}

async function compareCase() {
  await loadPayload();
  state.lastResult = await fetchComparisonReport();
  const count = (state.lastResult?.pageIssues?.length || 0) + (state.lastResult?.crossPlatformMismatches?.length || 0);
  setStatus(
    count ? `${count} issue(s) found between prepared data, Infinity, and AOL.` : "No checked mismatch found so far.",
    count ? "error" : "success"
  );
  renderReview();
}

els.startAutofill.addEventListener("click", startAutofill);
els.refreshCases.addEventListener("click", () => loadPreparedCases().catch((error) => setStatus(error.message, "error")));
els.casePicker.addEventListener("change", () => {
  els.caseToken.value = els.casePicker.value;
  chrome.storage.local.set({ caseToken: els.casePicker.value });
});
els.fillSection.addEventListener("click", () => fillCurrentPopup().catch((error) => setStatus(error.message, "error")));
els.comparePage.addEventListener("click", () => checkCurrentPage().catch((error) => setStatus(error.message, "error")));
els.compareCase.addEventListener("click", () => compareCase().catch((error) => setStatus(error.message, "error")));
