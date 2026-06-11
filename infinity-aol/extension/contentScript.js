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
  return [
    ...root.querySelectorAll(
      [
        "button",
        "a",
        "[role='button']",
        "input[type='button']",
        "input[type='submit']",
        "[ng-click]",
        "[data-ng-click]",
        "[onclick]",
        ".btn",
        ".button",
        ".clickable",
        ".nav-tabs li",
        ".nav-tabs a",
        ".tab",
        ".edit",
        "[class*='edit']"
      ].join(",")
    )
  ].filter(isVisible);
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

function allTextNodes(root = document) {
  return [...root.querySelectorAll("label, span, div, p, strong, h1, h2, h3, h4, td, th, li, a, button")]
    .filter((node) => {
      const text = normalize(node.textContent);
      return text && text.length <= 180;
    });
}

function findTextNode(labels, root = document) {
  const wanted = labels.map(normalize);
  return allTextNodes(root).find((node) => {
    const text = normalize(node.textContent);
    return wanted.some((label) => text === label || text.includes(label));
  });
}

async function scrollElementIntoView(element, block = "center") {
  if (!element) return false;
  element.scrollIntoView({ block, inline: "nearest", behavior: "instant" });
  await sleep(180);
  return true;
}

async function scrollToText(labels, root = document) {
  const node = findTextNode(labels, root);
  if (!node) return false;
  await scrollElementIntoView(node);
  return true;
}

async function findElementWithScroll(field, value, root = document) {
  await scrollToText(fieldLabels(field), root);
  await sleep(100);
  return findElement(field, value);
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

async function clickPageNextIfVisible() {
  if (activeModal()) return false;
  const next = findClickableByText(["Save & Next", "Save and Next", "Next", "Continue"], document);
  if (!next || isUnsafeFinalAction(next)) return false;
  clickElement(next);
  await sleep(1200);
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

function looksLikeChoiceControl(element) {
  const role = element.getAttribute("role");
  const popup = element.getAttribute("aria-haspopup");
  const classText = String(element.className || "").toLowerCase();
  return role === "combobox" || popup === "listbox" || classText.includes("select") || classText.includes("dropdown");
}

function optionAliases(value) {
  const text = String(value ?? "").trim();
  const aliases = [text];
  const normalized = normalize(text);
  if (normalized === "groceries") aliases.push("Food & Groceries");
  if (normalized === "monthly") aliases.push("Monthly");
  const streetTypeAliases = {
    ave: "Avenue",
    blvd: "Boulevard",
    ct: "Court",
    cres: "Crescent",
    dr: "Drive",
    ln: "Lane",
    pde: "Parade",
    pl: "Place",
    rd: "Road",
    st: "Street",
    tce: "Terrace"
  };
  if (streetTypeAliases[normalized]) aliases.push(streetTypeAliases[normalized]);
  if (normalized === "australia") aliases.push("Australia");
  return [...new Set(aliases.filter(Boolean))];
}

function formatDateValue(value, format) {
  if (!format || value === undefined || value === null || value === "") return value;
  const text = String(value).trim();
  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso && format === "au") return `${iso[3]}/${iso[2]}/${iso[1]}`;
  const auDash = text.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
  if (auDash && format === "au") return `${auDash[1].padStart(2, "0")}/${auDash[2].padStart(2, "0")}/${auDash[3]}`;
  return text;
}

async function setFieldValue(element, value) {
  if (element.disabled || element.readOnly || element.getAttribute("aria-disabled") === "true") {
    return false;
  }

  if (element.tagName === "SELECT") {
    const stringValue = String(value ?? "");
    const wanted = normalize(stringValue);
    const option = [...element.options].find(
      (item) => item.value === stringValue || normalize(item.textContent) === wanted || normalize(item.textContent).includes(wanted) || wanted.includes(normalize(item.textContent))
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

  if (looksLikeChoiceControl(element)) {
    clickElement(element);
    await sleep(250);
    for (const alias of optionAliases(value)) {
      if (chooseVisibleOption(alias)) return true;
    }
    return false;
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

const controlSelector =
  "input:not([type='hidden']), textarea, select, [contenteditable='true'], [role='textbox'], [role='combobox'], [aria-haspopup='listbox']";

function candidateControls(container, value) {
  const controls = [...container.querySelectorAll(controlSelector)].filter(isVisible);
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

function directControlForLabel(node, value) {
  if (node.tagName === "LABEL") {
    const forId = node.getAttribute("for");
    if (forId) {
      const byFor = (node.getRootNode?.() || document).getElementById?.(forId) || document.getElementById(forId);
      if (byFor && isVisible(byFor)) return byFor;
    }
    const nested = candidateControls(node, value)[0];
    if (nested) return nested;
  }
  return null;
}

function nearestFieldContainer(node) {
  let current = node;
  for (let depth = 0; depth < 4 && current; depth += 1) {
    const marker = normalize(`${current.className || ""} ${current.getAttribute?.("class") || ""}`);
    if (
      marker.includes("form-group") ||
      marker.includes("form-field") ||
      marker.includes("field") ||
      marker.includes("input-group") ||
      marker.includes("col-") ||
      marker.includes("row")
    ) {
      return current;
    }
    current = current.parentElement;
  }
  return node.parentElement;
}

function controlAfterLabel(node, value, root) {
  const direct = directControlForLabel(node, value);
  if (direct) return direct;

  const fieldContainer = nearestFieldContainer(node);
  if (fieldContainer) {
    const local = candidateControls(fieldContainer, value);
    const nodeRect = node.getBoundingClientRect();
    const sameField = local.find((control) => {
      const rect = control.getBoundingClientRect();
      return rect.left >= nodeRect.left - 8 && rect.top >= nodeRect.top - 12;
    });
    if (sameField) return sameField;
  }

  const nodeRect = node.getBoundingClientRect();
  const controls = [...root.querySelectorAll(controlSelector)]
    .filter(isVisible)
    .map((control) => ({ control, rect: control.getBoundingClientRect() }))
    .filter(({ rect }) => rect.top >= nodeRect.top - 8 && rect.left >= nodeRect.left - 12)
    .filter(({ rect }) => rect.top - nodeRect.bottom < 90 || Math.abs(rect.top - nodeRect.top) < 45)
    .sort((a, b) => {
      const aRow = Math.abs(a.rect.top - nodeRect.top);
      const bRow = Math.abs(b.rect.top - nodeRect.top);
      const aDistance = aRow * 4 + Math.max(0, a.rect.left - nodeRect.left);
      const bDistance = bRow * 4 + Math.max(0, b.rect.left - nodeRect.left);
      return aDistance - bDistance;
    });
  return controls[0]?.control || null;
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
    const control = controlAfterLabel(node, value, root);
    if (control) return { element: control, selector: `near label: ${node.textContent.trim()}` };
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
    const control = controlAfterLabel(node, value, root);
    if (control) {
      matches.push({ element: control, selector: `near label #${matches.length + 1}: ${node.textContent.trim()}` });
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
    financialsLiability: "infinity.financials.liabilities",
    financialsExpense: "infinity.financials.expenses"
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
    return formatDateValue(field.defaultValue, field.dateFormat);
  }
  return formatDateValue(value, field.dateFormat);
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

      const found = mode === "currentSection" ? await findElementWithScroll(field, value) : findElement(field, value);
      if (!found) {
        result.fieldsSkipped.push({ section: section.id, label: field.label, reason: "no visible matching field", rowIndex });
        continue;
      }

      try {
      const ok = await setFieldValue(found.element, value);
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

function isInfinityLoansSummaryPage() {
  const url = normalize(location.href);
  return url.includes("infinity.com.au") && url.includes("#!/loans") && !url.includes("/soca/");
}

function isInfinitySocaPage() {
  const url = normalize(location.href);
  return url.includes("infinity.com.au") && (url.includes("/soca/") || pageHasAnyText(["Needs Analysis", "Loans, Securities & Commentary", "Preferred Loan Features"]));
}

function isInfinityFinancialsPage() {
  return pageHasAnyText(["Assets", "Liabilities", "Annual Incomes", "Monthly Expenses", "Add Expense"]);
}

async function ensureBestInterestDutyApplication(result) {
  if (!isInfinityLoansSummaryPage() && !pageHasAnyText(["Create Application"])) return false;
  if (pageHasAnyText(["Needs Analysis", "Loans, Securities & Commentary"])) return false;
  const create = findClickableByText(["Create Application +", "Create Application"]);
  if (!create) return false;
  result.actions.push({ action: "open-create-application", section: "loansProducts", label: visibleText(create) });
  const modal = await clickAndWaitForModal(create);
  await sleep(300);
  const bid = findClickableByText(["Best Interest Duty"], modal || document);
  if (!bid) {
    result.fieldsSkipped.push({ section: "loansProducts", label: "Best Interest Duty", reason: "application flow button not visible" });
    return false;
  }
  clickElement(bid);
  result.actions.push({ action: "choose-application-flow", section: "loansProducts", label: "Best Interest Duty" });
  await waitFor(() => normalize(location.href).includes("/soca/") || pageHasAnyText(["Needs Analysis"]), 8000, 250);
  await sleep(1200);
  return true;
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
    repeatPath: "infinity.financials.expenses"
  }
];

function supportedPopupWorkflows(payload) {
  return popupWorkflows
    .map((workflow) => {
      const rowIndexes = workflowRowIndexes(workflow, payload);
      return { ...workflow, rowIndexes, rowCount: rowIndexes.length };
    })
    .filter((workflow) => workflow.rowCount > 0 && pageHasAnyText(workflow.pageHints));
}

function hasPositiveMoney(value) {
  const raw = String(value ?? "").replace(/[^\d.-]/g, "");
  if (!raw) return false;
  const number = Number(raw);
  return Number.isFinite(number) && Math.abs(number) > 0;
}

function isHemConfirmed(payload) {
  return getValue(payload, "serviceability.hemConfirmed") === true ||
    getValue(payload, "expenses.hemConfirmed") === true ||
    getValue(payload, "documentIntake.assumptions.hemConfirmed") === true;
}

function hasMeaningfulText(value) {
  const text = normalize(value);
  return Boolean(text) && !["none", "n/a", "na", "not applicable", "no existing liabilities declared"].includes(text);
}

function isEmptyLiabilityRow(row) {
  if (!row) return true;
  const combined = normalize([row.type, row.description, row.lender, row.financialInstitution, row.otherInstitution].filter(Boolean).join(" "));
  const hasDebtAmount = [row.balance, row.limit, row.amountOwing, row.amount, row.monthlyRepayment].some(hasPositiveMoney);
  const hasCreditor = [row.lender, row.financialInstitution, row.otherInstitution, row.accountNo, row.bsb].some(hasMeaningfulText);
  const noDebtText = combined.includes("no existing liabilities") || combined.includes("no debt") || combined === "other";
  return !hasDebtAmount && (noDebtText || !hasCreditor);
}

function workflowRowIndexes(workflow, payload) {
  if (workflow.sectionId === "financialsExpense") {
    const rows = collectionAt(payload, "infinity.financials.expenses");
    if (rows.length) return rows.map((row, index) => ({ row, index })).filter(({ row }) => hasPositiveMoney(row.amount)).map(({ index }) => index);
    return hasPositiveMoney(getValue(payload, "serviceability.hemMonthly")) ? [0] : [];
  }
  if (!workflow.repeatPath) return Array.from({ length: workflow.defaultCount || 1 }, (_, index) => index);
  return collectionAt(payload, workflow.repeatPath)
    .map((row, index) => ({ row, index }))
    .filter(({ row }) => workflow.sectionId !== "financialsLiability" || !isEmptyLiabilityRow(row))
    .map(({ index }) => index);
}

function numericTokens(value) {
  const raw = String(value ?? "").replace(/[^\d.-]/g, "");
  const number = Number(raw);
  if (!Number.isFinite(number)) return [];
  return [...new Set([raw, String(number), number.toLocaleString("en-AU")].filter(Boolean))];
}

function rowIdentity(workflow, payload, index) {
  const row = workflow.repeatPath ? collectionAt(payload, workflow.repeatPath)[index] : null;
  if (workflow.sectionId === "financialsExpense") {
    return { labels: [row?.type || "Groceries"], values: [row?.amount || getValue(payload, "serviceability.hemMonthly")] };
  }
  if (!row) return null;
  if (workflow.sectionId === "financialsAsset") return { labels: [row.type, row.description], values: [row.value] };
  if (workflow.sectionId === "financialsIncome") return { labels: [row.type, row.employer, row.ownership], values: [row.amount] };
  if (workflow.sectionId === "financialsLiability") return { labels: [row.type, row.description, row.lender], values: [row.balance, row.limit] };
  return null;
}

function existingWorkflowRowVisible(workflow, payload, index) {
  const identity = rowIdentity(workflow, payload, index);
  if (!identity) return false;
  const text = normalize(document.body?.innerText || "");
  const labels = (identity.labels || []).filter((item) => item !== undefined && item !== null && String(item).trim());
  const values = (identity.values || []).flatMap(numericTokens);
  const hasLabel = labels.some((label) => text.includes(normalize(label)));
  const hasValue = values.some((value) => text.includes(normalize(value)));
  return hasLabel && (hasValue || !values.length);
}

function fullApplicantName(applicant) {
  return [applicant?.firstName, applicant?.middleName, applicant?.lastName || applicant?.surname].filter(Boolean).join(" ").trim();
}

function infinityApplicantRows(payload) {
  const rows = collectionAt(payload, "infinity.applicants");
  if (rows.length) return rows;
  return [getValue(payload, "infinity.clientDetails")].filter(Boolean);
}

function rawApplicantForIndex(payload, index) {
  return index === 0 ? getValue(payload, "applicants.primary") : getValue(payload, "applicants.secondary");
}

function isClientDetailsPage() {
  return pageHasAnyText(["Client Details", "Entity Type", "Applicant Type", "Current Address"]);
}

function clickApplicantTabByName(name) {
  if (!name) return false;
  const wanted = normalize(name);
  const candidates = [
    ...clickableElements(document),
    ...document.querySelectorAll("li, span, div, a")
  ].filter(isVisible);
  const tab = candidates.find((element) => {
    const text = visibleText(element);
    if (!text || text.length > 120) return false;
    return text === wanted || text.includes(wanted);
  });
  if (!tab) return false;
  clickElement(tab);
  return true;
}

function addressPartsFromApplicant(applicant, fallbackAddressText = "") {
  const rawAddress = applicant?.address || {};
  const address = typeof rawAddress === "string" ? { line1: rawAddress } : rawAddress;
  const fullText = String([address.line1, address.suburb, address.state, address.postcode].filter(Boolean).join(" ") || fallbackAddressText || "")
    .replace(/\s+/g, " ")
    .trim();
  const stateMatch = String(address.state || fullText || fallbackAddressText || "").match(/\b(ACT|NSW|NT|QLD|SA|TAS|VIC|WA)\b/i);
  const postcodeMatch = String(address.postcode || fullText || fallbackAddressText || "").match(/\b(\d{4})\b/);
  const streetTypes = [
    "Avenue",
    "Ave",
    "Boulevard",
    "Blvd",
    "Circuit",
    "Close",
    "Court",
    "Ct",
    "Crescent",
    "Cres",
    "Drive",
    "Dr",
    "Lane",
    "Ln",
    "Parade",
    "Pde",
    "Place",
    "Pl",
    "Road",
    "Rd",
    "Street",
    "St",
    "Terrace",
    "Tce",
    "Way"
  ];
  const line = String(address.line1 || fullText)
    .replace(/\b(ACT|NSW|NT|QLD|SA|TAS|VIC|WA)\b.*$/i, "")
    .replace(/\b\d{4}\b.*$/i, "")
    .split(",")[0]
    .trim();
  const unit = line.match(/\b(?:unit|u|apt|apartment)\s*([a-z0-9/-]+)/i)?.[1] || "";
  const withoutUnit = line.replace(/\b(?:unit|u|apt|apartment)\s*[a-z0-9/-]+\s*,?\s*/i, "").trim();
  const number = withoutUnit.match(/^(\d+[a-z]?(?:-\d+[a-z]?)?)/i)?.[1] || "";
  const afterNumber = withoutUnit.replace(/^(\d+[a-z]?(?:-\d+[a-z]?)?)\s*/i, "").trim();
  const typePattern = new RegExp(`\\b(${streetTypes.join("|")})\\b\\.?$`, "i");
  const typeMatch = afterNumber.match(typePattern);
  const streetType = typeMatch?.[1] || "";
  const streetName = streetType ? afterNumber.replace(typePattern, "").trim() : afterNumber;

  return {
    buildingName: address.buildingName || "",
    floorNumber: address.floorNumber || "",
    unitNumber: address.unitNumber || unit,
    streetNumber: address.streetNumber || number,
    streetName: address.streetName || streetName,
    streetType: address.streetType || streetType,
    suburb: address.suburb || inferSuburb(fullText, stateMatch?.[1], postcodeMatch?.[1]),
    state: address.state || stateMatch?.[1]?.toUpperCase() || "",
    postcode: address.postcode || postcodeMatch?.[1] || "",
    country: address.country || "Australia",
    startDate: address.startDate || address.fromDate || ""
  };
}

function inferSuburb(text, state, postcode) {
  const source = String(text || "");
  if (!state && !postcode) return "";
  const beforeState = state ? source.split(new RegExp(`\\b${state}\\b`, "i"))[0] : source.split(postcode)[0];
  const words = beforeState.replace(/[,]/g, " ").trim().split(/\s+/).filter(Boolean);
  if (words.length < 2) return "";
  return words.slice(-2).join(" ");
}

function findEditButtonForAddress(addressLabel) {
  const wanted = normalize(addressLabel);
  const nodes = [...document.querySelectorAll("label, span, div, p, strong, h1, h2, h3, h4, td, th")]
    .filter((node) => {
      const text = normalize(node.textContent);
      return text && text.length <= 180 && (text === wanted || text.includes(wanted));
    });

  for (const node of nodes) {
    node.scrollIntoView({ block: "center", inline: "nearest", behavior: "instant" });
    let container = node.parentElement;
    for (let depth = 0; depth < 8 && container; depth += 1) {
      const edit = findClickableByText(["Edit"], container);
      if (edit) return edit;
      const iconEdit = [...container.querySelectorAll("[ng-click], [data-ng-click], [onclick], a, button, span, i")]
        .filter(isVisible)
        .find((item) => {
          const text = visibleText(item);
          const marker = normalize(`${item.className || ""} ${item.getAttribute("title") || ""} ${item.getAttribute("aria-label") || ""}`);
          return text === "edit" || text.includes("edit") || marker.includes("edit") || marker.includes("pencil");
        });
      if (iconEdit) return iconEdit;
      container = container.parentElement;
    }
  }
  return null;
}

async function fillAddressModal(addressLabel, applicant, fallbackAddressText, result, rowIndex) {
  await scrollToText([addressLabel]);
  const edit = findEditButtonForAddress(addressLabel);
  if (!edit) {
    result.fieldsSkipped.push({ section: "clientDetails", label: `${addressLabel} Edit`, reason: "Edit button not visible", rowIndex });
    return false;
  }
  const modal = await clickAndWaitForModal(edit);
  if (!modal) {
    result.errors.push({ section: "clientDetails", label: addressLabel, message: "Edit Address modal did not open", rowIndex });
    return false;
  }

  const parts = addressPartsFromApplicant(applicant, fallbackAddressText);
  const addressFields = [
    ["Building Name", parts.buildingName],
    ["Floor Number", parts.floorNumber],
    ["Unit Number", parts.unitNumber],
    ["Street Number", parts.streetNumber],
    ["Street Name", parts.streetName],
    ["Street Type", parts.streetType],
    ["Suburb/City", parts.suburb],
    ["State", parts.state],
    ["Postcode", parts.postcode],
    ["Country", parts.country],
    ["Start Date", formatDateValue(parts.startDate, "au")]
  ];

  for (const [label, value] of addressFields) {
    if (value === undefined || value === null || value === "") continue;
    const found = findByLabelText([label], value, modal);
    if (!found) {
      result.fieldsSkipped.push({ section: "clientDetails", label, reason: "address modal field not visible", rowIndex });
      continue;
    }
    const ok = await setFieldValue(found.element, value);
    if (ok) result.fieldsFilled.push({ section: "clientDetails", label, selector: found.selector, expected: value, rowIndex });
  }

  const saved = await clickModalSave();
  result.actions.push({ action: saved ? "save-address" : "review-address", section: "clientDetails", rowIndex });
  if (!saved) {
    result.errors.push({ section: "clientDetails", label: addressLabel, message: "Address modal was filled but did not close", rowIndex });
  }
  return saved;
}

function payloadForApplicant(payload, applicantDetails) {
  return {
    ...payload,
    infinity: {
      ...payload.infinity,
      clientDetails: applicantDetails
    }
  };
}

function looksLikeAddressValue(value) {
  const text = normalize(value);
  return /\b(unit|street|st|road|rd|avenue|ave|lane|ln|drive|dr|court|ct|sa|nsw|vic|qld|wa|tas|act|nt|\d{4})\b/.test(text) && !/^\+?\d[\d\s()-]{6,}$/.test(text);
}

function looksLikeDateValue(value) {
  return /^\d{4}-\d{2}-\d{2}$|^\d{1,2}\/\d{1,2}\/\d{4}$/.test(String(value || "").trim());
}

function isAustralianState(value) {
  return /^(ACT|NSW|NT|QLD|SA|TAS|VIC|WA)$/i.test(String(value || "").trim());
}

async function clearFieldByLabels(labels, reason, result, rowIndex) {
  const found = findByLabelText(labels, "", document);
  if (!found) return false;
  const actual = readFieldValue(found.element);
  if (!actual) return false;
  await setFieldValue(found.element, "");
  result.actions.push({ action: "clear-invalid-field", section: "clientDetails", label: labels[0], reason, actual, rowIndex });
  return true;
}

async function cleanupMisfilledClientDetails(result, rowIndex) {
  const phoneFields = [
    ["Home Phone"],
    ["Work Phone"],
    ["Fax"]
  ];

  for (const labels of phoneFields) {
    const found = findByLabelText(labels, "", document);
    const actual = found ? readFieldValue(found.element) : "";
    if (actual && looksLikeAddressValue(actual)) {
      await setFieldValue(found.element, "");
      result.actions.push({ action: "clear-invalid-field", section: "clientDetails", label: labels[0], reason: "address detected in phone field", actual, rowIndex });
    }
  }

  const licenceNo = findByLabelText(["Driver's Licence No.", "Licence No"], "", document);
  const licenceNoValue = licenceNo ? readFieldValue(licenceNo.element) : "";
  if (licenceNoValue && looksLikeDateValue(licenceNoValue)) {
    await setFieldValue(licenceNo.element, "");
    result.actions.push({ action: "clear-invalid-field", section: "clientDetails", label: "Driver's Licence No.", reason: "date detected in licence number", actual: licenceNoValue, rowIndex });
  }

  const licenceState = findByLabelText(["Licence State"], "", document);
  const licenceStateValue = licenceState ? readFieldValue(licenceState.element) : "";
  if (licenceStateValue && !isAustralianState(licenceStateValue)) {
    await setFieldValue(licenceState.element, "");
    result.actions.push({ action: "clear-invalid-field", section: "clientDetails", label: "Licence State", reason: "invalid Australian state", actual: licenceStateValue, rowIndex });
  }
}

function clientDetailsFieldMap() {
  return [
    ["Entity Type", "entityType"],
    ["Primary Applicant", "primaryApplicant"],
    ["Applicant Type", "applicantType"],
    ["Title", "title"],
    ["First Name", "firstName"],
    ["Middle Name", "middleName"],
    ["Surname", "surname"],
    ["Marital Status", "maritalStatus"],
    ["Related Spouse", "relatedSpouse"],
    ["Date of Birth", "dateOfBirth", "au"],
    ["Gender", "gender"],
    ["Current Housing Situation", "currentHousingSituation"],
    ["Permanent in Australia", "permanentInAustralia"],
    ["Mobile", "mobile"],
    ["Email", "email"],
    ["Driver's Licence No.", "driversLicenceNo"],
    ["Licence Expiry Date", "licenceExpiryDate", "au"],
    ["Licence State", "licenceState"],
    ["Licence Class", "licenceClass"],
    ["Number of Dependents", "numberOfDependants"],
    ["Number of Dependants", "numberOfDependants"]
  ];
}

async function fillClientDetailsDirect(applicant, result, rowIndex) {
  let filledCount = 0;
  for (const [label, key, dateFormat] of clientDetailsFieldMap()) {
    const rawValue = applicant?.[key];
    if (rawValue === undefined || rawValue === null || rawValue === "") continue;
    const value = formatDateValue(rawValue, dateFormat);
    await scrollToText([label]);
    const found = findByLabelText([label], value, document);
    if (!found) {
      result.fieldsSkipped.push({ section: "clientDetails", label, reason: "field not found after scroll", rowIndex });
      continue;
    }
    try {
      const ok = await setFieldValue(found.element, value);
      const actual = readFieldValue(found.element);
      if (ok) {
        result.fieldsFilled.push({ section: "clientDetails", label, selector: found.selector, expected: value, actual, rowIndex });
        filledCount += 1;
      } else {
        result.fieldsSkipped.push({ section: "clientDetails", label, reason: "control refused value", rowIndex });
      }
    } catch (error) {
      result.errors.push({ section: "clientDetails", label, message: error.message, rowIndex });
    }
    await sleep(90);
  }
  return filledCount;
}

async function fillApplicantAddresses(applicant, rawApplicant, result, rowIndex) {
  const labels = ["Current Address", "Previous Address", "Post Settlement Address", "Mailing Address"];
  for (const label of labels) {
    const addressSource = label === "Previous Address" ? rawApplicant?.previousAddress || rawApplicant?.address : rawApplicant?.address;
    const fallback = label === "Previous Address" ? rawApplicant?.previousAddressText || applicant?.currentAddress : applicant?.currentAddress;
    await fillAddressModal(label, addressSource ? { ...rawApplicant, address: addressSource } : rawApplicant, fallback, result, rowIndex);
    await sleep(250);
  }
}

async function runClientDetailsWorkflow(payload, mapping, apiBase, result) {
  if (!isClientDetailsPage()) return false;
  const section = mapping.sections.find((item) => item.id === "clientDetails");
  if (!section) return false;
  const applicants = infinityApplicantRows(payload);
  if (!applicants.length) return false;

  for (let index = 0; index < applicants.length; index += 1) {
    const applicant = applicants[index];
    const name = fullApplicantName(applicant);
    showAutomationStatus(`EasyFlow AI: filling Client Details ${index + 1}/${applicants.length}...`);
    if (index > 0) {
      const clicked = clickApplicantTabByName(name);
      result.actions.push({ action: clicked ? "open-applicant-tab" : "review-applicant-tab", section: "clientDetails", label: name, rowIndex: index });
      if (clicked) await sleep(700);
    }

    await cleanupMisfilledClientDetails(result, index);
    await fillClientDetailsDirect(applicant, result, index);
    await fillApplicantAddresses(applicant, rawApplicantForIndex(payload, index), result, index);
    await cleanupMisfilledClientDetails(result, index);
    const saved = await clickPageSaveIfVisible();
    result.actions.push({ action: saved ? "save-client-details" : "review-client-details", section: "clientDetails", rowIndex: index });
    await sleep(500);
  }

  return true;
}

async function runPopupWorkflow(workflow, payload, mapping, apiBase, result) {
  const section = mapping.sections.find((item) => item.id === workflow.sectionId);
  if (!section) {
    result.fieldsSkipped.push({ section: workflow.sectionId, label: workflow.sectionId, reason: "workflow section not mapped" });
    return;
  }

  for (let index = 0; index < workflow.rowCount; index += 1) {
    const sourceIndex = workflow.rowIndexes?.[index] ?? index;
    showAutomationStatus(`EasyFlow AI: filling ${workflow.sectionId} ${index + 1}/${workflow.rowCount}...`);
    if (existingWorkflowRowVisible(workflow, payload, sourceIndex)) {
      result.actions.push({ action: "skip-existing-row", section: workflow.sectionId, rowIndex: sourceIndex });
      continue;
    }

    const addButton = findClickableByText(workflow.addLabels);
    if (!addButton) {
      result.fieldsSkipped.push({
        section: workflow.sectionId,
        label: workflow.addLabels[0],
        reason: "Add/Edit button not visible on this page",
        rowIndex: sourceIndex
      });
      return;
    }

    result.actions.push({ action: "open-popup", section: workflow.sectionId, label: visibleText(addButton), rowIndex: sourceIndex });
    const modal = await clickAndWaitForModal(addButton);
    if (!modal) {
      result.errors.push({ section: workflow.sectionId, label: workflow.addLabels[0], message: "Popup did not open", rowIndex: sourceIndex });
      return;
    }

    if (workflow.repeatPath) {
      repeatCursors[repeatCursorKey(payload, workflow.sectionId)] = sourceIndex;
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

async function runFinancialsWorkflow(payload, mapping, apiBase, result) {
  if (!isInfinityFinancialsPage()) return false;
  if (!isHemConfirmed(payload)) {
    result.errors.push({
      section: "financials",
      message: "HEM / living expense breakdown is not confirmed. Confirm it in EasyFlow AI and prepare again before Financials autofill."
    });
    return true;
  }
  const workflows = supportedPopupWorkflows(payload);
  if (!workflows.length) {
    result.fieldsSkipped.push({ section: "financials", label: "Financials popups", reason: "No supported Add buttons or payload rows found" });
    return true;
  }
  for (const workflow of workflows) {
    await runPopupWorkflow(workflow, payload, mapping, apiBase, result);
  }
  return true;
}

async function selectNeedsAnalysisApplicants(payload, result) {
  const applicants = infinityApplicantRows(payload).map(fullApplicantName).filter(Boolean);
  if (!applicants.length || !pageHasAnyText(["Select Applicant"])) return;
  await scrollToText(["Select Applicant"]);
  for (const name of applicants) {
    const node = findTextNode([name]);
    if (!node) {
      result.fieldsSkipped.push({ section: "needsAnalysis", label: `Select Applicant ${name}`, reason: "applicant toggle label not found" });
      continue;
    }
    let container = node.parentElement;
    let clicked = false;
    for (let depth = 0; depth < 5 && container && !clicked; depth += 1) {
      const toggle = [...container.querySelectorAll("input[type='checkbox'], [role='switch'], [role='checkbox'], .switch, .toggle, button, [ng-click], [data-ng-click]")]
        .filter(isVisible)
        .find((item) => {
          const text = visibleText(item);
          return !text || text.includes(name.toLowerCase()) || item.getAttribute("aria-checked") !== null || item.type === "checkbox";
        });
      if (toggle) {
        const alreadyOn = toggle.checked === true || toggle.getAttribute("aria-checked") === "true" || normalize(toggle.className).includes("active");
        if (!alreadyOn) clickElement(toggle);
        clicked = true;
        result.actions.push({ action: "select-applicant", section: "needsAnalysis", label: name });
      }
      container = container.parentElement;
    }
    if (!clicked) {
      result.fieldsSkipped.push({ section: "needsAnalysis", label: `Select Applicant ${name}`, reason: "toggle control not found" });
    }
    await sleep(150);
  }
}

async function runSocaWorkflow(payload, mapping, apiBase, result) {
  if (!isInfinitySocaPage()) return false;
  await selectNeedsAnalysisApplicants(payload, result);
  const currentResult = await autofill({ mode: "currentSection", payload, mapping, apiBase });
  mergeAutofillResult(result, currentResult);
  result.actions.push({ action: "fill-soca-current-section", section: currentResult.sectionId || "soca", filled: currentResult.fieldsFilled.length });
  if (currentResult.fieldsFilled.length) {
    const saved = await clickPageSaveIfVisible();
    result.actions.push({ action: saved ? "save-soca-page" : "review-soca-page", section: currentResult.sectionId || "soca" });
    const advanced = await clickPageNextIfVisible();
    if (advanced) result.actions.push({ action: "next-soca-page", section: currentResult.sectionId || "soca" });
  }
  return true;
}

async function runWorkflow({ payload, mapping, apiBase }) {
  const result = { sectionId: "workflow", fieldsFilled: [], fieldsSkipped: [], errors: [], actions: [] };

  if (detectPlatform() === "infinity") {
    await ensureBestInterestDutyApplication(result);
  }

  const clientDetailsHandled = await runClientDetailsWorkflow(payload, mapping, apiBase, result);
  const financialsHandled = clientDetailsHandled ? false : await runFinancialsWorkflow(payload, mapping, apiBase, result);
  const socaHandled = clientDetailsHandled || financialsHandled ? false : await runSocaWorkflow(payload, mapping, apiBase, result);

  if (!clientDetailsHandled && !financialsHandled && !socaHandled) {
    const visibleResult = await autofill({ mode: "visible", payload, mapping, apiBase });
    mergeAutofillResult(result, visibleResult);
    result.actions.push({ action: "fill-visible-fields", section: "visible", filled: visibleResult.fieldsFilled.length });
    if (visibleResult.fieldsFilled.length) {
      const saved = await clickPageSaveIfVisible();
      result.actions.push({ action: saved ? "save-page" : "review-page", section: "visible", label: saved ? "Save" : "No page save button visible" });
      if (normalize(location.href).includes("/loans/soca/")) {
        const advanced = await clickPageNextIfVisible();
        result.actions.push({ action: advanced ? "next-page" : "review-page", section: "visible", label: advanced ? "Next" : "No next button visible" });
      }
    }
  }

  for (const workflow of clientDetailsHandled || financialsHandled ? [] : supportedPopupWorkflows(payload)) {
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
    { id: "needsAnalysis", labels: ["Needs Analysis"] },
    { id: "loansSecuritiesCommentary", labels: ["Loans, Securities & Commentary"] },
    { id: "preferredLoanFeaturesScenarios", labels: ["Preferred Loan Features", "Scenarios"] },
    { id: "recommendation", labels: ["Recommendation"] },
    { id: "commissionsConflictInterest", labels: ["Commissions", "Conflict of Interest"] },
    { id: "clientForms", labels: ["Client Forms"] },
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
