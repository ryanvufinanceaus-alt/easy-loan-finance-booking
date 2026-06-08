function getValue(object, path) {
  return path.split(".").reduce((current, part) => current?.[part], object);
}

const repeatCursors = {};

function normalize(value) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function isVisible(element) {
  const rect = element.getBoundingClientRect();
  const style = window.getComputedStyle(element);
  return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
}

function isBackdropOnly(element) {
  const marker = normalize(`${element.className || ""} ${element.id || ""}`);
  return marker.includes("backdrop") || marker === "overlay";
}

function hasUsableControls(element) {
  return Boolean(element.querySelector("input, textarea, select, button, a, [role='button']"));
}

function activeModal() {
  const candidates = [
    ...document.querySelectorAll(
      "[role='dialog'], [aria-modal='true'], .modal, .modal-dialog, .modal-content, .dialog, .popup, .overlay"
    )
  ]
    .filter(isVisible)
    .map((element) => ({ element, rect: element.getBoundingClientRect() }))
    .filter(({ element, rect }) => rect.width > 180 && rect.height > 120 && !isBackdropOnly(element) && hasUsableControls(element))
    .sort((a, b) => b.rect.width * b.rect.height - a.rect.width * a.rect.height);

  return candidates[0]?.element || null;
}

function activeSurfaceRoot() {
  return activeModal() || document;
}

function showAutomationStatus(message, type = "running") {
  let status = document.querySelector("#easyflow-ai-extension-status");
  if (!status) {
    status = document.createElement("div");
    status.id = "easyflow-ai-extension-status";
    document.documentElement.appendChild(status);
  }
  const colors = {
    running: ["#0f2b1f", "#ffffff"],
    success: ["#157347", "#ffffff"],
    error: ["#8b2018", "#ffffff"]
  };
  const [background, color] = colors[type] || colors.running;
  Object.assign(status.style, {
    position: "fixed",
    top: "14px",
    right: "14px",
    zIndex: "2147483647",
    maxWidth: "360px",
    padding: "12px 14px",
    borderRadius: "10px",
    boxShadow: "0 14px 40px rgba(0,0,0,.22)",
    font: "700 14px/1.35 Arial, sans-serif",
    background,
    color
  });
  status.textContent = message;
}

function cleanupStuckModalState() {
  if (activeModal()) return;
  document.querySelectorAll(".modal-backdrop, [class*='backdrop']").forEach((element) => element.remove());
  document.body?.classList.remove("modal-open");
  if (document.body) {
    document.body.style.overflow = "";
    document.body.style.paddingRight = "";
  }
}

function nativeSetValue(element, value) {
  const stringValue = value === undefined || value === null ? "" : String(value);
  const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const descriptor = Object.getOwnPropertyDescriptor(prototype, "value");
  if (descriptor?.set) {
    descriptor.set.call(element, stringValue);
  } else {
    element.value = stringValue;
  }
  element.dispatchEvent(new Event("input", { bubbles: true }));
  element.dispatchEvent(new Event("change", { bubbles: true }));
  element.dispatchEvent(new Event("blur", { bubbles: true }));
}

function clickElement(element) {
  element.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
  element.click();
  element.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(predicate, timeoutMs = 5000, intervalMs = 150) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const value = predicate();
    if (value) return value;
    await sleep(intervalMs);
  }
  return null;
}

function visibleText(element) {
  return normalize(
    [
      element.textContent,
      element.getAttribute("aria-label"),
      element.getAttribute("title"),
      element.getAttribute("value")
    ]
      .filter(Boolean)
      .join(" ")
  );
}

function clickableElements(root = document) {
  return [...root.querySelectorAll("button, a, [role='button'], input[type='button'], input[type='submit']")].filter(isVisible);
}

function isUnsafeFinalAction(element) {
  const text = visibleText(element);
  return /\b(push aol|submit|lodge|send|settle|finalise|finalize|confirm submission)\b/.test(text);
}

function findClickableByText(labels, root = document) {
  const wanted = labels.map(normalize);
  return clickableElements(root).find((element) => {
    if (isUnsafeFinalAction(element)) return false;
    const text = visibleText(element);
    return wanted.some((label) => text === label || text.includes(label));
  });
}

async function clickAndWaitForModal(element) {
  const before = activeModal();
  clickElement(element);
  return waitFor(() => {
    const modal = activeModal();
    return modal && modal !== before ? modal : modal && !before ? modal : null;
  });
}

async function clickModalSave() {
  const modal = activeModal();
  if (!modal) return false;
  const save = findClickableByText(["Save Changes", "Save", "Done", "Update"], modal);
  if (!save || isUnsafeFinalAction(save)) return false;
  clickElement(save);
  const closed = await waitFor(() => !activeModal(), 5000);
  if (!closed) cleanupStuckModalState();
  return Boolean(closed);
}

async function clickPageSaveIfVisible() {
  if (activeModal()) return false;
  const save = findClickableByText(["Save Changes", "Save", "Done", "Update"], document);
  if (!save || isUnsafeFinalAction(save)) return false;
  clickElement(save);
  await sleep(900);
  return true;
}

function readFieldValue(element) {
  if (!element) return "";
  if (element.tagName === "SELECT") return element.selectedOptions?.[0]?.textContent?.trim() || element.value || "";
  if (element.type === "checkbox") return element.checked;
  if ("value" in element) return element.value;
  return element.textContent?.trim() || "";
}

function chooseVisibleOption(text, root = activeSurfaceRoot()) {
  const wanted = normalize(text);
  const option = [...root.querySelectorAll("[role='option'], li, .option, .dropdown-item, .select-item")]
    .filter(isVisible)
    .find((item) => normalize(item.textContent) === wanted || normalize(item.textContent).includes(wanted));
  if (!option && root !== document) return chooseVisibleOption(text, document);
  if (!option) return false;
  clickElement(option);
  return true;
}

function isChoiceValue(value) {
  const text = normalize(value);
  return [
    "yes",
    "no",
    "important",
    "not important",
    "don't want",
    "dont want",
    "variable",
    "fixed",
    "fixed and variable",
    "applicable",
    "not applicable",
    "monthly",
    "weekly",
    "fortnightly"
  ].includes(text);
}

function buttonLikeControls(container, value) {
  const wanted = typeof value === "boolean" ? null : normalize(value);
  return [...container.querySelectorAll("button, [role='button'], [role='switch'], [role='checkbox'], [aria-checked]")]
    .filter(isVisible)
    .filter((control) => {
      if (typeof value === "boolean") return true;
      const text = normalize(control.textContent || control.getAttribute("aria-label") || control.getAttribute("title"));
      return text === wanted || text.includes(wanted) || wanted.includes(text);
    });
}

function radioControls(container, value) {
  const wanted = normalize(value);
  return [...container.querySelectorAll("input[type='radio']")]
    .filter(isVisible)
    .filter((control) => {
      const label = control.closest("label") || document.querySelector(`label[for='${control.id}']`);
      const text = normalize([control.value, label?.textContent, control.getAttribute("aria-label")].filter(Boolean).join(" "));
      return text === wanted || text.includes(wanted) || wanted.includes(text);
    });
}

function setAriaChecked(element, value) {
  const current = element.getAttribute("aria-checked") === "true" || element.classList.contains("active") || element.classList.contains("selected");
  if (current !== Boolean(value)) clickElement(element);
  element.dispatchEvent(new Event("change", { bubbles: true }));
  return true;
}

function setFieldValue(element, value) {
  if (element.disabled || element.readOnly || element.getAttribute("aria-disabled") === "true") {
    return false;
  }

  if (element.tagName === "SELECT") {
    const stringValue = String(value ?? "");
    const option = [...element.options].find(
      (item) => item.value === stringValue || normalize(item.textContent) === normalize(stringValue)
    );
    if (!option) return false;
    element.value = option.value;
    element.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  }

  if (element.type === "checkbox") {
    element.checked = Boolean(value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  }

  if (element.type === "radio") {
    if (!element.checked) clickElement(element);
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  }

  if (element.getAttribute("role") === "switch" || element.getAttribute("role") === "checkbox" || element.hasAttribute("aria-checked")) {
    return setAriaChecked(element, value);
  }

  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
    nativeSetValue(element, value);
    return true;
  }

  if (element.isContentEditable || element.getAttribute("role") === "textbox") {
    element.textContent = String(value ?? "");
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  }

  if (element.getAttribute("role") === "combobox" || element.getAttribute("aria-haspopup") === "listbox") {
    element.click();
    return chooseVisibleOption(value);
  }

  if (element.tagName === "BUTTON" || element.getAttribute("role") === "button") {
    clickElement(element);
    return true;
  }

  if (typeof value === "boolean" && value) {
    clickElement(element);
    return true;
  }

  return false;
}

function fieldLabels(field) {
  return [field.label, ...(field.labelContains || [])].filter(Boolean);
}

function candidateControls(container, value) {
  const selector =
    "input:not([type='hidden']), textarea, select, [contenteditable='true'], [role='textbox'], [role='combobox'], [aria-haspopup='listbox']";
  const controls = [...container.querySelectorAll(selector)].filter(isVisible);
  if (typeof value === "boolean") {
    const checkbox = controls.find((control) => control.type === "checkbox");
    if (checkbox) return [checkbox];
    const buttonLikes = buttonLikeControls(container, value);
    if (buttonLikes.length) return buttonLikes;
  }
  if (isChoiceValue(value)) {
    const radios = radioControls(container, value);
    if (radios.length) return radios;
    const buttonLikes = buttonLikeControls(container, value);
    if (buttonLikes.length) return buttonLikes;
  }
  return controls;
}

function findByLabelText(labels, value, root = activeSurfaceRoot()) {
  const wanted = labels.map(normalize);
  const nodes = [...root.querySelectorAll("label, span, div, p, strong, h1, h2, h3, h4, td, th")]
    .filter(isVisible)
    .filter((node) => {
      const text = normalize(node.textContent);
      if (!text || text.length > 180) return false;
      return wanted.some((label) => text === label || text.includes(label));
    });

  for (const node of nodes) {
    let container = node;
    for (let depth = 0; depth < 5 && container; depth += 1) {
      const controls = candidateControls(container, value);
      if (controls.length) return { element: controls[0], selector: `near label: ${node.textContent.trim()}` };

      const next = container.nextElementSibling;
      if (next) {
        const nextControls = candidateControls(next, value);
        if (nextControls.length) return { element: nextControls[0], selector: `after label: ${node.textContent.trim()}` };
      }
      container = container.parentElement;
    }
    if (typeof value === "boolean") return { element: node, selector: `label click: ${node.textContent.trim()}` };
  }
  return null;
}

function findElement(field, value) {
  const root = activeSurfaceRoot();
  for (const selector of field.selectors || []) {
    const element = root.querySelector(selector) || document.querySelector(selector);
    if (element && isVisible(element)) return { element, selector };
  }
  if (Number.isInteger(field.occurrence)) {
    const matches = findAllByLabelText(fieldLabels(field), value, root);
    return matches[field.occurrence] || null;
  }
  return findByLabelText(fieldLabels(field), value, root);
}

function findAllByLabelText(labels, value, root = activeSurfaceRoot()) {
  const wanted = labels.map(normalize);
  const nodes = [...root.querySelectorAll("label, span, div, p, strong, h1, h2, h3, h4, td, th")]
    .filter(isVisible)
    .filter((node) => {
      const text = normalize(node.textContent);
      if (!text || text.length > 180) return false;
      return wanted.some((label) => text === label || text.includes(label));
    });

  const matches = [];
  for (const node of nodes) {
    let container = node;
    for (let depth = 0; depth < 5 && container; depth += 1) {
      const controls = candidateControls(container, value);
      if (controls.length) {
        matches.push({ element: controls[0], selector: `near label #${matches.length + 1}: ${node.textContent.trim()}` });
        break;
      }

      const next = container.nextElementSibling;
      if (next) {
        const nextControls = candidateControls(next, value);
        if (nextControls.length) {
          matches.push({ element: nextControls[0], selector: `after label #${matches.length + 1}: ${node.textContent.trim()}` });
          break;
        }
      }
      container = container.parentElement;
    }
  }
  return matches;
}

function activeSectionId(mapping) {
  const root = activeSurfaceRoot();
  const headings = [...root.querySelectorAll("h1, h2, h3, legend, [role='heading'], .active")]
    .filter(isVisible)
    .map((heading) => normalize(heading.textContent));

  const matched = mapping.sections.find((section) => {
    const names = [section.label, ...(section.aliases || [])].map(normalize);
    return names.some((name) => headings.some((heading) => heading.includes(name)));
  });
  return matched?.id || null;
}

function fieldsForMode(mapping, mode) {
  const sectionId = mode === "currentSection" ? activeSectionId(mapping) : null;
  const sections = sectionId ? mapping.sections.filter((section) => section.id === sectionId) : mapping.sections;
  return { sectionId, sections };
}

function repeatPathForSection(sectionId) {
  return {
    financialsIncome: "infinity.financials.incomes",
    financialsAsset: "infinity.financials.assets",
    financialsLiability: "infinity.financials.liabilities"
  }[sectionId];
}

function repeatCursorKey(payload, sectionId) {
  return `${payload.meta?.caseId || "case"}:${sectionId}`;
}

function collectionAt(payload, path) {
  const collection = getValue(payload, path);
  return Array.isArray(collection) ? collection : [];
}

function fieldValue(payload, field) {
  const value = getValue(payload, field.payloadPath);
  if ((value === undefined || value === null || value === "") && field.defaultValue !== undefined) {
    return field.defaultValue;
  }
  return value;
}

function sectionForRepeatCursor(section, payload) {
  const repeatPath = repeatPathForSection(section.id);
  if (!repeatPath || !activeModal()) return { section, rowIndex: null, rowCount: null };

  const rows = collectionAt(payload, repeatPath);
  if (!rows.length) return { section, rowIndex: 0, rowCount: 0 };

  const key = repeatCursorKey(payload, section.id);
  const rowIndex = Math.min(repeatCursors[key] || 0, rows.length - 1);
  const fields = section.fields.map((field) => ({
    ...field,
    payloadPath: field.payloadPath.replace(`${repeatPath}.0.`, `${repeatPath}.${rowIndex}.`)
  }));

  return { section: { ...section, fields }, rowIndex, rowCount: rows.length };
}

function advanceRepeatCursor(section, payload, rowIndex, rowCount) {
  if (rowIndex === null || rowCount === null || rowCount < 2) return;
  const key = repeatCursorKey(payload, section.id);
  repeatCursors[key] = Math.min(rowIndex + 1, rowCount - 1);
}

async function logAutofill(apiBase, payload, result) {
  try {
    await fetch(`${apiBase}/api/infinity/autofill-log`, {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        brokerUser: payload.meta?.brokerUser,
        caseId: payload.meta?.caseId,
        fieldsFilled: result.fieldsFilled,
        fieldsSkipped: result.fieldsSkipped,
        errors: result.errors,
        sectionId: result.sectionId
      })
    });
  } catch (error) {
    result.errors.push({ label: "Audit log", message: error.message });
  }
}

async function logComparisonSnapshot(apiBase, payload, result) {
  try {
    await fetch(`${apiBase}/api/cases/${encodeURIComponent(payload.meta?.caseId || "unknown")}/comparison-snapshot`, {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(result)
    });
  } catch (error) {
    result.missing = result.missing || [];
    result.missing.push({ label: "Comparison snapshot", message: error.message });
  }
}

async function autofill({ mode, payload, mapping, apiBase }) {
  const { sectionId, sections } = fieldsForMode(mapping, mode);
  const result = { sectionId, fieldsFilled: [], fieldsSkipped: [], errors: [] };

  for (const originalSection of sections) {
    const { section, rowIndex, rowCount } = sectionForRepeatCursor(originalSection, payload);
    const filledBeforeSection = result.fieldsFilled.length;

    for (const field of section.fields) {
      const value = fieldValue(payload, field);
      if ((value === undefined || value === null || value === "") && field.optional) {
        result.fieldsSkipped.push({ section: section.id, label: field.label, reason: "optional empty value", rowIndex });
        continue;
      }

      const found = findElement(field, value);
      if (!found) {
        result.fieldsSkipped.push({ section: section.id, label: field.label, reason: "no visible matching field", rowIndex });
        continue;
      }

      try {
        const ok = setFieldValue(found.element, value);
        if (ok) {
          result.fieldsFilled.push({ section: section.id, label: field.label, selector: found.selector, expected: value, rowIndex });
        } else {
          result.fieldsSkipped.push({ section: section.id, label: field.label, reason: "custom control needs site handler", rowIndex });
        }
      } catch (error) {
        result.errors.push({ section: section.id, label: field.label, message: error.message, rowIndex });
      }
    }

    if (mode === "currentSection" && result.fieldsFilled.length > filledBeforeSection) {
      advanceRepeatCursor(originalSection, payload, rowIndex, rowCount);
    }
  }

  await logAutofill(apiBase, payload, result);
  return result;
}

function mergeAutofillResult(target, source) {
  target.fieldsFilled.push(...(source.fieldsFilled || []));
  target.fieldsSkipped.push(...(source.fieldsSkipped || []));
  target.errors.push(...(source.errors || []));
}

function pageHasAnyText(labels) {
  const bodyText = normalize(document.body?.innerText || "");
  return labels.map(normalize).some((label) => bodyText.includes(label));
}

function detectPlatform() {
  const text = normalize(document.body?.innerText || "");
  const url = normalize(location.href);
  if (url.includes("applyonline") || text.includes("applyonline") || text.includes("lender id")) return "aol";
  if (text.includes("loans & products") || text.includes("fact find") || text.includes("statement of credit assistance")) return "infinity";
  return "unknown";
}

const popupWorkflows = [
  {
    sectionId: "financialsIncome",
    pageHints: ["Annual Incomes", "Income"],
    addLabels: ["Add Income", "+ Add Income"],
    repeatPath: "infinity.financials.incomes"
  },
  {
    sectionId: "financialsAsset",
    pageHints: ["Assets"],
    addLabels: ["Add Asset", "+ Add Asset"],
    repeatPath: "infinity.financials.assets"
  },
  {
    sectionId: "financialsLiability",
    pageHints: ["Liabilities"],
    addLabels: ["Add Liability", "+ Add Liability"],
    repeatPath: "infinity.financials.liabilities"
  },
  {
    sectionId: "financialsExpense",
    pageHints: ["Monthly Expenses", "Expenses"],
    addLabels: ["Add Expense", "+ Add Expense"],
    repeatPath: null,
    defaultCount: 1
  }
];

function supportedPopupWorkflows(payload) {
  return popupWorkflows
    .map((workflow) => {
      const rows = workflow.repeatPath ? collectionAt(payload, workflow.repeatPath) : [];
      const rowCount = workflow.repeatPath ? rows.length : workflow.defaultCount || 1;
      return { ...workflow, rowCount };
    })
    .filter((workflow) => workflow.rowCount > 0 && pageHasAnyText(workflow.pageHints));
}

async function runPopupWorkflow(workflow, payload, mapping, apiBase, result) {
  const section = mapping.sections.find((item) => item.id === workflow.sectionId);
  if (!section) {
    result.fieldsSkipped.push({ section: workflow.sectionId, label: workflow.sectionId, reason: "workflow section not mapped" });
    return;
  }

  for (let index = 0; index < workflow.rowCount; index += 1) {
    showAutomationStatus(`EasyFlow AI: filling ${workflow.sectionId} ${index + 1}/${workflow.rowCount}...`);
    const addButton = findClickableByText(workflow.addLabels);
    if (!addButton) {
      result.fieldsSkipped.push({
        section: workflow.sectionId,
        label: workflow.addLabels[0],
        reason: "Add/Edit button not visible on this page",
        rowIndex: index
      });
      return;
    }

    result.actions.push({ action: "open-popup", section: workflow.sectionId, label: visibleText(addButton), rowIndex: index });
    const modal = await clickAndWaitForModal(addButton);
    if (!modal) {
      result.errors.push({ section: workflow.sectionId, label: workflow.addLabels[0], message: "Popup did not open", rowIndex: index });
      return;
    }

    if (workflow.repeatPath) {
      repeatCursors[repeatCursorKey(payload, workflow.sectionId)] = index;
    }

    const filled = await autofill({ mode: "currentSection", payload, mapping, apiBase });
    mergeAutofillResult(result, filled);

    const saved = await clickModalSave();
    result.actions.push({
      action: saved ? "save-popup" : "review-popup",
      section: workflow.sectionId,
      rowIndex: index,
      label: saved ? "Save Changes" : "Save button not found"
    });

    if (!saved) {
      result.errors.push({
        section: workflow.sectionId,
        label: workflow.addLabels[0],
        message: "Popup was filled but did not close. Please review and save it manually.",
        rowIndex: index
      });
      return;
    }
    await sleep(350);
  }
}

async function runWorkflow({ payload, mapping, apiBase }) {
  const result = { sectionId: "workflow", fieldsFilled: [], fieldsSkipped: [], errors: [], actions: [] };

  const visibleResult = await autofill({ mode: "visible", payload, mapping, apiBase });
  mergeAutofillResult(result, visibleResult);
  result.actions.push({ action: "fill-visible-fields", section: "visible", filled: visibleResult.fieldsFilled.length });
  if (visibleResult.fieldsFilled.length) {
    const saved = await clickPageSaveIfVisible();
    result.actions.push({ action: saved ? "save-page" : "review-page", section: "visible", label: saved ? "Save" : "No page save button visible" });
  }

  for (const workflow of supportedPopupWorkflows(payload)) {
    await runPopupWorkflow(workflow, payload, mapping, apiBase, result);
  }

  await logAutofill(apiBase, payload, result);
  return result;
}

const navigationPlans = {
  infinity: [
    { id: "clientDetails", labels: ["Client Details"] },
    { id: "financials", labels: ["Financials"] },
    { id: "loansProducts", labels: ["Loans & Products", "Loans and Products"] },
    { id: "factFind", labels: ["Fact Find"] },
    { id: "notes", labels: ["Notes"] },
    { id: "documents", labels: ["Documents"] }
  ],
  aol: [
    { id: "application", labels: ["Application"] },
    { id: "applicants", labels: ["Applicants"] },
    { id: "loans", labels: ["Loans"] },
    { id: "securities", labels: ["Securities"] },
    { id: "financials", labels: ["Financials"] },
    { id: "compliance", labels: ["Compliance"] },
    { id: "summary", labels: ["Summary"] },
    { id: "documents", labels: ["Documents"] }
  ]
};

function findNavigationTarget(labels) {
  const wanted = labels.map(normalize);
  return clickableElements(document)
    .filter((element) => !isUnsafeFinalAction(element))
    .find((element) => {
      const text = visibleText(element);
      if (!text || text.length > 80) return false;
      return wanted.some((label) => text === label || text.includes(label));
    });
}

async function navigateToPage(step) {
  const target = findNavigationTarget(step.labels);
  if (!target) return false;
  const before = location.href;
  clickElement(target);
  await sleep(1200);
  await waitFor(() => location.href !== before || pageHasAnyText(step.labels), 6000);
  return true;
}

async function runAllPages({ payload, mapping, apiBase }) {
  const platform = detectPlatform();
  const plan = navigationPlans[platform] || [];
  const result = { sectionId: "all-pages", fieldsFilled: [], fieldsSkipped: [], errors: [], actions: [], pages: [], platform };

  if (!plan.length) {
    result.errors.push({ message: "Could not detect Infinity or AOL page. Open a case page first." });
    return result;
  }

  for (const step of plan) {
    showAutomationStatus(`EasyFlow AI: opening ${step.labels[0]}...`);
    const navigated = await navigateToPage(step);
    result.pages.push({ id: step.id, labels: step.labels, navigated });
    if (!navigated) {
      result.fieldsSkipped.push({ section: step.id, label: step.labels[0], reason: "page navigation link not visible" });
      continue;
    }

    const pageResult = await runWorkflow({ payload, mapping, apiBase });
    mergeAutofillResult(result, pageResult);
    result.actions.push(...(pageResult.actions || []));

    const compareResult = await scanCompare({ mode: "visible", payload, mapping });
    await logComparisonSnapshot(apiBase, payload, compareResult);
    result.actions.push({
      action: "snapshot-page",
      section: step.id,
      matched: compareResult.matched.length,
      mismatched: compareResult.mismatched.length,
      missing: compareResult.missing.length
    });
    await sleep(500);
    cleanupStuckModalState();
  }

  await logAutofill(apiBase, payload, result);
  const issueCount = result.errors.length + result.fieldsSkipped.length;
  showAutomationStatus(
    issueCount
      ? `EasyFlow AI finished with ${issueCount} item(s) to review.`
      : "EasyFlow AI finished. Review before Push AOL or Submit.",
    issueCount ? "error" : "success"
  );
  return result;
}

function comparable(value) {
  if (typeof value === "boolean") return value ? "true" : "false";
  return normalize(String(value ?? "").replace(/[$,]/g, ""));
}

async function scanCompare({ mode, payload, mapping }) {
  const { sectionId, sections } = fieldsForMode(mapping, mode);
  const result = { sectionId, platform: detectPlatform(), url: location.href, matched: [], mismatched: [], missing: [] };

  for (const section of sections) {
    for (const field of section.fields) {
      const expected = fieldValue(payload, field);
      if ((expected === undefined || expected === null || expected === "") && field.optional) continue;
      const found = findElement(field, expected);
      if (!found) {
        result.missing.push({ section: section.id, label: field.label, payloadPath: field.payloadPath, expected });
        continue;
      }
      const actual = readFieldValue(found.element);
      const ok = comparable(actual).includes(comparable(expected)) || comparable(expected).includes(comparable(actual));
      const row = { section: section.id, label: field.label, payloadPath: field.payloadPath, expected, actual, selector: found.selector };
      if (ok) result.matched.push(row);
      else result.mismatched.push(row);
    }
  }

  return result;
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === "INFINITY_AOL_PING") {
    sendResponse({ ok: true });
    return false;
  }

  if (message.type === "INFINITY_AOL_AUTOFILL") {
    autofill(message)
      .then(sendResponse)
      .catch((error) => sendResponse({ sectionId: null, fieldsFilled: [], fieldsSkipped: [], errors: [{ message: error.message }] }));
    return true;
  }

  if (message.type === "INFINITY_AOL_RUN_WORKFLOW") {
    runWorkflow(message)
      .then(sendResponse)
      .catch((error) =>
        sendResponse({ sectionId: "workflow", fieldsFilled: [], fieldsSkipped: [], errors: [{ message: error.message }], actions: [] })
      );
    return true;
  }

  if (message.type === "INFINITY_AOL_RUN_ALL_PAGES") {
    runAllPages(message)
      .then(sendResponse)
      .catch((error) =>
        sendResponse({
          sectionId: "all-pages",
          fieldsFilled: [],
          fieldsSkipped: [],
          errors: [{ message: error.message }],
          actions: [],
          pages: []
        })
      );
    return true;
  }

  if (message.type === "INFINITY_AOL_COMPARE") {
    scanCompare(message)
      .then(sendResponse)
      .catch((error) => sendResponse({ sectionId: null, matched: [], mismatched: [], missing: [{ message: error.message }] }));
    return true;
  }

  return false;
});
