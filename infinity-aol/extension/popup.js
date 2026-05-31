const state = {
  prepared: null,
  mapping: null,
  lastResult: null
};

const els = {
  apiBase: document.querySelector("#apiBase"),
  caseToken: document.querySelector("#caseToken"),
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
});

function setStatus(message, type = "muted") {
  els.status.className = `status ${type}`;
  els.status.textContent = message;
}

function enableAdvanced(enabled) {
  els.fillSection.disabled = !enabled;
  els.compareCase.disabled = !enabled;
}

function shortValue(value) {
  const text = String(value ?? "");
  return text.length > 60 ? `${text.slice(0, 57)}...` : text;
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
    ...(state.lastResult?.pageIssues || []).map((issue) => ({
      label: `${issue.platform || "page"}: ${issue.label}`,
      value: `${shortValue(issue.actual ?? "missing")} -> ${shortValue(issue.expected ?? "")}`
    })),
    ...(state.lastResult?.crossPlatformMismatches || []).map((issue) => ({
      label: `Infinity/AOL: ${issue.label}`,
      value: `${shortValue(issue.infinityValue ?? "blank")} <> ${shortValue(issue.aolValue ?? "blank")}`
    }))
  ].slice(0, 5);

  for (const issue of issues) {
    const row = document.createElement("div");
    row.className = "review-row";
    row.innerHTML = `<strong>${issue.label}</strong><span>${issue.value}</span>`;
    els.reviewRows.append(row);
  }
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function sendToContent(message) {
  const tab = await getActiveTab();
  return chrome.tabs.sendMessage(tab.id, message);
}

async function loadPayload() {
  const apiBase = els.apiBase.value.replace(/\/$/, "");
  const caseToken = els.caseToken.value.trim();
  if (!caseToken) throw new Error("Enter the Case ID first.");

  chrome.storage.local.set({ apiBase, caseToken });
  const [preparedResponse, mappingResponse] = await Promise.all([
    fetch(`${apiBase}/api/infinity/payload/${encodeURIComponent(caseToken)}`, { credentials: "include" }),
    fetch(`${apiBase}/api/infinity/mappings/current`, { credentials: "include" })
  ]);

  if (!preparedResponse.ok) throw new Error((await preparedResponse.json()).error || "Payload not found");
  if (!mappingResponse.ok) throw new Error("Mapping endpoint is not available");

  state.prepared = await preparedResponse.json();
  state.mapping = await mappingResponse.json();
  state.lastResult = null;
  enableAdvanced(state.prepared.validation.okToAutofill);

  if (!state.prepared.validation.okToAutofill) {
    throw new Error("Prepared case has validation errors. Fix those before autofill.");
  }
}

async function fetchComparisonReport() {
  const apiBase = els.apiBase.value.replace(/\/$/, "");
  const response = await fetch(`${apiBase}/api/cases/${encodeURIComponent(state.prepared.caseId)}/comparison-report`, { credentials: "include" });
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
    const issues = (report?.pageIssues?.length || 0) + (report?.crossPlatformMismatches?.length || 0) + (result.errors?.length || 0);
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
  setStatus(`${result.fieldsFilled.length} filled, ${result.fieldsSkipped.length} skipped, ${result.errors.length} errors.`, result.errors.length ? "error" : "success");
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
    credentials: "include",
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
els.fillSection.addEventListener("click", () => fillCurrentPopup().catch((error) => setStatus(error.message, "error")));
els.comparePage.addEventListener("click", () => checkCurrentPage().catch((error) => setStatus(error.message, "error")));
els.compareCase.addEventListener("click", () => compareCase().catch((error) => setStatus(error.message, "error")));
