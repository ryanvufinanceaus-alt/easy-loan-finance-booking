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

function normalizeText(text) {
  return normalize(text);
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

const automationRunState = {
  stopped: false,
  current: 0,
  total: 1,
  message: "",
  hideTimer: null,
  segmentBase: 0,
  segmentSpan: 1,
  clientDetails: { applicants: {} }
};

function automationProgressPercent() {
  const total = Math.max(1, Number(automationRunState.total || 1));
  const current = Math.max(0, Math.min(total, Number(automationRunState.current || 0)));
  return Math.max(0, Math.min(100, Math.round((current / total) * 100)));
}

function requestAutomationStop() {
  automationRunState.stopped = true;
  showAutomationStatus("EasyFlow AI stopping after current action...", "error", { keepProgress: true });
}

function hideAutomationStatus() {
  if (automationRunState.hideTimer) clearTimeout(automationRunState.hideTimer);
  automationRunState.hideTimer = null;
  document.querySelector("#easyflow-ai-extension-status")?.remove();
}

function resetAutomationRun(total = 1) {
  automationRunState.stopped = false;
  automationRunState.current = 0;
  automationRunState.total = Math.max(1, Number(total || 1));
  automationRunState.message = "";
  automationRunState.segmentBase = 0;
  automationRunState.segmentSpan = automationRunState.total;
  automationRunState.clientDetails = { applicants: {} };
}

function configureAutomationSegment(base, span) {
  automationRunState.segmentBase = Math.max(0, Number(base || 0));
  automationRunState.segmentSpan = Math.max(1, Number(span || 1));
}

function setAutomationProgress(current, total, message) {
  if (Number.isFinite(Number(current))) {
    const localTotal = Math.max(1, Number(total || 1));
    const localCurrent = Math.max(0, Math.min(localTotal, Number(current)));
    automationRunState.current = automationRunState.segmentBase + (localCurrent / localTotal) * automationRunState.segmentSpan;
  }
  if (message) automationRunState.message = message;
  showAutomationStatus(message || automationRunState.message || "EasyFlow AI running...", "running");
}

function advanceAutomationProgress(message, increment = 1) {
  automationRunState.current = Math.min(Math.max(1, automationRunState.total), automationRunState.current + increment);
  if (message) automationRunState.message = message;
  showAutomationStatus(message || automationRunState.message || "EasyFlow AI running...", "running");
}

function throwIfAutomationStopped() {
  if (automationRunState.stopped) {
    throw new Error("EasyFlow AI run stopped by user.");
  }
}

function showAutomationStatus(message, type = "running", options = {}) {
  if (automationRunState.hideTimer) {
    clearTimeout(automationRunState.hideTimer);
    automationRunState.hideTimer = null;
  }
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
    width: "360px",
    maxWidth: "calc(100vw - 28px)",
    padding: "12px",
    borderRadius: "8px",
    boxShadow: "0 14px 40px rgba(0,0,0,.22)",
    font: "700 13px/1.35 Arial, sans-serif",
    background,
    color
  });
  const percent = options.progress ?? (options.keepProgress ? automationProgressPercent() : automationProgressPercent());
  status.innerHTML = "";
  const header = document.createElement("div");
  Object.assign(header.style, { display: "flex", alignItems: "center", gap: "10px" });
  const text = document.createElement("div");
  Object.assign(text.style, { flex: "1", minWidth: "0" });
  text.textContent = message;
  const stop = document.createElement("button");
  stop.type = "button";
  const finalState = type === "success" || options.final === true;
  stop.textContent = finalState ? "Hide" : automationRunState.stopped ? "Stopping" : "Stop";
  stop.disabled = automationRunState.stopped && !finalState;
  Object.assign(stop.style, {
    border: "1px solid rgba(255,255,255,.55)",
    background: "rgba(255,255,255,.14)",
    color: "#fff",
    borderRadius: "6px",
    padding: "5px 9px",
    font: "700 12px Arial, sans-serif",
    cursor: stop.disabled ? "default" : "pointer"
  });
  stop.addEventListener("click", finalState ? hideAutomationStatus : requestAutomationStop);
  header.append(text, stop);
  const progressOuter = document.createElement("div");
  Object.assign(progressOuter.style, {
    marginTop: "9px",
    height: "8px",
    borderRadius: "999px",
    background: "rgba(255,255,255,.28)",
    overflow: "hidden"
  });
  const progressInner = document.createElement("div");
  Object.assign(progressInner.style, {
    height: "100%",
    width: `${percent}%`,
    borderRadius: "999px",
    background: "#ffffff",
    transition: "width .18s ease"
  });
  progressOuter.append(progressInner);
  const footer = document.createElement("div");
  Object.assign(footer.style, { marginTop: "6px", opacity: ".9", font: "700 11px Arial, sans-serif" });
  footer.textContent = `${percent}% complete`;
  status.append(header, progressOuter, footer);
  if (options.autoHideMs) {
    automationRunState.hideTimer = setTimeout(hideAutomationStatus, options.autoHideMs);
  }
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

function setNativeValue(element, value) {
  nativeSetValue(element, value);
}

function clickElement(element) {
  element.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
  element.click();
  element.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
}

function pressEscape() {
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", keyCode: 27, bubbles: true }));
  document.activeElement?.dispatchEvent?.(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", keyCode: 27, bubbles: true }));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(predicate, timeoutMs = 5000, intervalMs = 150) {
  if (typeof timeoutMs === "object") {
    const options = timeoutMs || {};
    timeoutMs = options.timeoutMs || options.timeout || 5000;
    intervalMs = options.intervalMs || options.interval || 150;
  }
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const value = predicate();
    if (value) return value;
    await sleep(intervalMs);
  }
  return null;
}

async function waitForAngularSettle() {
  await sleep(250);
  await waitFor(() => !document.querySelector(".loading, .spinner, .fa-spinner, [aria-busy='true']"), { timeout: 2500, interval: 150 });
  cleanupStuckModalState();
  await sleep(150);
}

function ensureResultShape(result) {
  result.fieldsFilled = result.fieldsFilled || [];
  result.fieldsSkipped = result.fieldsSkipped || [];
  result.errors = result.errors || [];
  result.actions = result.actions || [];
  result.verificationFailures = result.verificationFailures || [];
  result.warnings = result.warnings || [];
  return result;
}

async function safeClick(element, result, actionName, meta = {}) {
  ensureResultShape(result);
  if (!element || !isVisible(element)) {
    result.fieldsSkipped.push({ action: actionName, reason: "click target not visible", ...meta });
    return false;
  }
  clickElement(element);
  result.actions.push({ action: actionName, label: visibleText(element), ...meta });
  await waitForAngularSettle();
  return true;
}

async function clearAndType(element, value) {
  if (!element) return false;
  await setFieldValue(element, "");
  await sleep(60);
  return setFieldValue(element, value);
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

function findSaveChangesButton(root = document) {
  const candidates = [...root.querySelectorAll("button, input[type='submit'], input[type='button'], a, [role='button']")]
    .filter(isVisible)
    .filter((element) => !isUnsafeFinalAction(element));
  return candidates.find((element) => normalize(element.innerText || element.value || element.textContent) === "save changes") ||
    candidates.find((element) => normalize(element.innerText || element.value || element.textContent).includes("save changes")) ||
    candidates.find((element) => normalize(element.innerText || element.value || element.textContent) === "save") ||
    candidates.find((element) => normalize(element.innerText || element.value || element.textContent).includes("save")) ||
    null;
}

function isDisabled(element) {
  return Boolean(
    !element ||
    element.disabled ||
    element.getAttribute("disabled") !== null ||
    element.getAttribute("aria-disabled") === "true" ||
    normalize(element.className || "").includes("disabled")
  );
}

async function waitForSaveComplete() {
  const startedAt = Date.now();
  let sawSaving = false;
  while (Date.now() - startedAt < 10000) {
    throwIfAutomationStopped();
    const bodyText = normalize(document.body?.innerText || "");
    if (
      bodyText.includes("saved successfully") ||
      bodyText.includes("successfully saved") ||
      bodyText.includes("changes saved") ||
      bodyText.includes("client account updated") ||
      bodyText.includes("updated successfully")
    ) {
      await waitForAngularSettle();
      return true;
    }
    if (bodyText.includes("saving") || document.querySelector(".loading, .spinner, .fa-spinner, [aria-busy='true']")) {
      sawSaving = true;
    }
    const saveButton = findSaveChangesButton();
    if (sawSaving && saveButton && !isDisabled(saveButton)) {
      await sleep(500);
      await waitForAngularSettle();
      return true;
    }
    await sleep(250);
  }

  const finalText = normalize(document.body?.innerText || "");
  if (/\b(error|required|invalid|failed)\b/.test(finalText)) return false;
  await waitForAngularSettle();
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
  const option = [...root.querySelectorAll("[role='option'], li, .option, .dropdown-item, .select-item, .ui-select-choices-row, .ui-select-choices-row-inner, .select2-results__option, a, span, div")]
    .filter(isVisible)
    .filter((item) => {
      const textContent = normalize(item.textContent);
      return textContent && textContent.length <= 120;
    })
    .find((item) => {
      const textContent = normalize(item.textContent);
      return textContent === wanted || textContent.includes(wanted);
    });
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
    const typedInput = [...document.querySelectorAll("input[type='search'], input[aria-autocomplete], .ui-select-search")]
      .filter(isVisible)[0];
    if (typedInput) {
      nativeSetValue(typedInput, value);
      await sleep(250);
      for (const alias of optionAliases(value)) {
        if (chooseVisibleOption(alias)) return true;
      }
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

function findExactByLabelText(label, value, root = activeSurfaceRoot()) {
  const wanted = normalize(label);
  const nodes = [...root.querySelectorAll("label, span, div, p, strong, h1, h2, h3, h4, td, th")]
    .filter(isVisible)
    .filter((node) => normalize(node.textContent).replace(/\s*\*\s*$/, "") === wanted);

  for (const node of nodes) {
    const control = controlAfterLabel(node, value, root);
    if (control) return { element: control, selector: `exact label: ${node.textContent.trim()}` };
  }
  return null;
}

function normalizedFieldValue(value) {
  const text = String(value ?? "").trim();
  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return `${iso[3]}/${iso[2]}/${iso[1]}`;
  return normalize(text.replace(/[$,\s]/g, ""));
}

function valuesMatch(expected, actual) {
  if (expected === undefined || expected === null) return true;
  const expectedText = normalizedFieldValue(expected);
  const actualText = normalizedFieldValue(actual);
  if (!expectedText) return true;
  if (!actualText) return false;
  return actualText === expectedText || actualText.includes(expectedText) || expectedText.includes(actualText);
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

function findFieldByLabel(label, scope = activeSurfaceRoot()) {
  return findByLabelText(Array.isArray(label) ? label : [label], "", scope);
}

function recordFieldFilled(result, section, label, value, found, meta = {}) {
  ensureResultShape(result);
  result.fieldsFilled.push({ section, label, selector: found?.selector, expected: value, actual: found?.element ? readFieldValue(found.element) : undefined, ...meta });
}

function recordFieldSkipped(result, section, label, reason, meta = {}) {
  ensureResultShape(result);
  result.fieldsSkipped.push({ section, label, reason, ...meta });
}

function recordError(result, section, label, message, meta = {}) {
  ensureResultShape(result);
  result.errors.push({ section, label, message, ...meta });
}

function recordVerificationFailure(result, section, label, message, meta = {}) {
  ensureResultShape(result);
  result.verificationFailures.push({ section, label, message, ...meta });
}

async function fillInputByLabel(label, value, scope = activeSurfaceRoot(), result, meta = {}) {
  if (value === undefined || value === null || value === "") return false;
  await scrollToText([label], scope === document ? document : undefined);
  const found = findByLabelText([label], value, scope);
  if (!found) {
    recordFieldSkipped(result, meta.section || "workflow", label, "field not found", meta);
    return false;
  }
  const ok = await clearAndType(found.element, value);
  if (ok) recordFieldFilled(result, meta.section || "workflow", label, value, found, meta);
  else recordFieldSkipped(result, meta.section || "workflow", label, "control refused value", meta);
  await sleep(80);
  return ok;
}

async function fillDateByLabel(label, value, scope = activeSurfaceRoot(), result, meta = {}) {
  const formatted = formatDateValue(value, "au");
  const ok = await fillInputByLabel(label, formatted, scope, result, meta);
  const found = findExactByLabelText(label, formatted, scope) || findByLabelText([label], formatted, scope);
  const actual = found?.element ? readFieldValue(found.element) : "";
  if (ok && found?.element && !valuesMatch(formatted, actual)) {
    found.element.focus?.();
    nativeSetValue(found.element, formatted);
    await sleep(120);
    found.element.blur?.();
    const retryActual = readFieldValue(found.element);
    if (!valuesMatch(formatted, retryActual)) {
      recordVerificationFailure(result, meta.section || "workflow", label, "Date value did not verify after retry", {
        ...meta,
        expected: formatted,
        actual: retryActual
      });
    }
  }
  return ok;
}

function findDropdownOption(value, root = document) {
  const aliases = optionAliases(value).map(normalize);
  return [...root.querySelectorAll("option, [role='option'], li, .option, .dropdown-item, .select-item, a, span")]
    .filter(isVisible)
    .find((item) => {
      const text = normalize(item.textContent || item.getAttribute("value"));
      return aliases.some((alias) => text === alias || text.includes(alias) || alias.includes(text));
    }) || null;
}

async function selectDropdownByText(label, value, scope = activeSurfaceRoot(), result, meta = {}) {
  if (value === undefined || value === null || value === "") return false;
  await scrollToText([label], scope === document ? document : undefined);
  const found = findByLabelText([label], value, scope);
  if (!found) {
    recordFieldSkipped(result, meta.section || "workflow", label, "dropdown not found", meta);
    return false;
  }
  const ok = await setFieldValue(found.element, value);
  if (ok) recordFieldFilled(result, meta.section || "workflow", label, value, found, meta);
  else recordFieldSkipped(result, meta.section || "workflow", label, `option not found: ${value}`, meta);
  await sleep(120);
  return ok;
}

async function clickCheckboxByLabel(label, result, meta = {}) {
  await scrollToText([label]);
  const node = findTextNode([label]);
  if (!node) {
    recordFieldSkipped(result, meta.section || "workflow", label, "checkbox label not found", meta);
    return false;
  }
  let container = node.closest("label") || node.parentElement;
  for (let depth = 0; depth < 6 && container; depth += 1) {
    const input = [...container.querySelectorAll("input[type='checkbox'], input[type='radio'], [role='checkbox'], [aria-checked], button, [ng-click], [data-ng-click]")]
      .filter(isVisible)
      .find((item) => {
        const text = visibleText(item);
        return item.type === "checkbox" || item.type === "radio" || item.hasAttribute("aria-checked") || !text || text.includes(normalize(label));
      });
    if (input) {
      const checked = input.checked === true || input.getAttribute("aria-checked") === "true" || normalize(input.className).includes("active") || normalize(input.className).includes("selected");
      if (!checked) clickElement(input);
      result.actions.push({ action: checked ? "checkbox-already-selected" : "select-checkbox", label, ...meta });
      await waitForAngularSettle();
      return true;
    }
    container = container.parentElement;
  }
  recordFieldSkipped(result, meta.section || "workflow", label, "checkbox control not found", meta);
  return false;
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
        verificationFailures: result.verificationFailures || [],
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
  const result = ensureResultShape({ sectionId, fieldsFilled: [], fieldsSkipped: [], errors: [], actions: [], verificationFailures: [] });

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
  ensureResultShape(target);
  target.fieldsFilled.push(...(source.fieldsFilled || []));
  target.fieldsSkipped.push(...(source.fieldsSkipped || []));
  target.errors.push(...(source.errors || []));
  target.actions.push(...(source.actions || []));
  target.verificationFailures.push(...(source.verificationFailures || []));
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

const INFINITY_EXPENSE_TYPES = [
  "Board",
  "Child Care",
  "Child Maintenance",
  "Clothing & Personal Care",
  "Electricity",
  "Entertainment",
  "Gas",
  "Groceries",
  "Health Care",
  "Higher Education and Vocational Training",
  "Holiday Home Costs",
  "Home & Contents Insurance",
  "Home Maintenance",
  "Investment Property Costs",
  "Medical and Life Insurance",
  "Other",
  "Other Insurances",
  "Owner Occupied Council & Water Rates",
  "Pet Care",
  "Private and Non-Government Education",
  "Public Primary and Secondary Education",
  "Rental Expenses",
  "Strata Fees and Land Tax",
  "Telephone and Internet",
  "Vehicle Insurance",
  "Vehicle Maintenance & Transport",
  "Water"
];

const EXPENSE_TYPE_ALIASES = {
  "Clothing & Personal Care": ["Clothing and Personal Care", "Personal Care", "Clothing"],
  "Other Insurances": ["Other Insurance", "Insurance", "Insurances", "Medical and Life Insurance", "Home & Contents Insurance"],
  Groceries: ["Food and Groceries", "Food & Groceries", "Food"],
  "Investment Property Costs": ["Investment Property Expenses", "Investment Property", "Rental Property Costs", "Strata Fees and Land Tax"],
  "Health Care": ["Healthcare", "Medical", "Medical and Health", "Health"],
  "Home Maintenance": ["Maintenance", "Home Repairs", "Repairs and Maintenance", "Property Maintenance"],
  Entertainment: ["Recreation", "Entertainment and Recreation", "Lifestyle", "Leisure"],
  "Telephone and Internet": ["Telephone & Internet", "Phone and Internet", "Phone & Internet", "Internet", "Telecommunications"],
  "Vehicle Maintenance & Transport": ["Vehicle Maintenance and Transport", "Vehicle / Transport", "Motor Vehicle", "Transport", "Car Expenses"]
};

const HEM_EXPENSE_TEMPLATE = [
  ["Clothing & Personal Care", 200],
  ["Other Insurances", 200],
  ["Groceries", 900],
  ["Investment Property Costs", 300],
  ["Health Care", 100],
  ["Home Maintenance", 300],
  ["Entertainment", 300],
  ["Telephone and Internet", 200],
  ["Vehicle Maintenance & Transport", 500]
];

function normalizeOptionLabel(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/\//g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function labelsMatchLoose(a, b) {
  const left = normalizeOptionLabel(a);
  const right = normalizeOptionLabel(b);
  return Boolean(left && right && (left === right || left.includes(right) || right.includes(left)));
}

function labelsEqual(a, b) {
  const left = normalizeOptionLabel(a);
  const right = normalizeOptionLabel(b);
  return Boolean(left && right && left === right);
}

function normalizeMoneyValue(value) {
  const number = Number(String(value ?? "").replace(/[^\d.-]/g, ""));
  return Number.isFinite(number) ? number : 0;
}

function normalizeExpenseRow(row) {
  const candidates = [
    ...(Array.isArray(row?.infinityTypeCandidates) ? row.infinityTypeCandidates : []),
    row?.expenseType,
    row?.type,
    row?.name
  ].filter(Boolean);
  return {
    type: String(row?.expenseType || row?.type || row?.name || "").trim(),
    amount: normalizeMoneyValue(row?.amount ?? row?.monthlyAmount ?? row?.value),
    frequency: row?.frequency || "Monthly",
    description: row?.description || row?.expenseType || row?.type || "Living expense",
    continuePostSettlement: row?.continuePostSettlement || "Yes",
    infinityTypeCandidates: [...new Set(candidates.map(String).map((item) => item.trim()).filter(Boolean))],
    ownership: row?.ownership,
    applicantScope: row?.applicantScope,
    source: row?.source,
    templateKey: row?.templateKey
  };
}

function scaleHemExpenseTemplate(total) {
  const target = normalizeMoneyValue(total);
  if (target <= 0) return [];
  const baseTotal = HEM_EXPENSE_TEMPLATE.reduce((sum, [, amount]) => sum + amount, 0) || 1;
  const rows = HEM_EXPENSE_TEMPLATE.map(([type, amount]) => ({
    type,
    amount: Math.round(((amount / baseTotal) * target) / 50) * 50,
    frequency: "Monthly",
    description: type,
    continuePostSettlement: "Yes"
  }));
  const diff = target - rows.reduce((sum, row) => sum + row.amount, 0);
  const groceries = rows.find((row) => row.type === "Groceries") || rows[0];
  if (groceries) groceries.amount += diff;
  return rows.filter((row) => row.amount > 0);
}

function buildHemExpenseRows(total, payload) {
  const preparedRows = collectionAt(payload, "infinity.financials.expenses")
    .map(normalizeExpenseRow)
    .filter((row) => row.type && row.amount > 0);
  return preparedRows;
}

function hemMonthlyAmount(payload) {
  return normalizeMoneyValue(
    getValue(payload, "serviceability.hemMonthly") ||
    getValue(payload, "expenses.livingMonthly") ||
    getValue(payload, "expenses.hemMonthly") ||
    getValue(payload, "documentIntake.assumptions.hemMonthly") ||
    getValue(payload, "infinity.serviceability.hemMonthly")
  );
}

async function closeActiveModalWithoutSaving() {
  const modal = activeModal();
  if (!modal) return false;
  const close = findClickableByText(["Close", "Cancel", "×", "x"], modal);
  if (!close) return false;
  clickElement(close);
  await waitFor(() => !activeModal(), { timeout: 2500, interval: 120 });
  cleanupStuckModalState();
  return true;
}

function canonicalInfinityExpenseType(type) {
  const exact = INFINITY_EXPENSE_TYPES.find((item) => labelsEqual(item, type));
  if (exact) return exact;
  for (const [canonical, aliases] of Object.entries(EXPENSE_TYPE_ALIASES)) {
    if (labelsEqual(canonical, type) || aliases.some((alias) => labelsEqual(alias, type))) return canonical;
  }
  for (const [canonical, aliases] of Object.entries(EXPENSE_TYPE_ALIASES)) {
    if (labelsMatchLoose(canonical, type) || aliases.some((alias) => labelsMatchLoose(alias, type))) return canonical;
  }
  return type || "Other";
}

function expenseTypeCandidates(preferredType, preparedCandidates = []) {
  const canonical = canonicalInfinityExpenseType(preferredType);
  const aliases = EXPENSE_TYPE_ALIASES[canonical] || EXPENSE_TYPE_ALIASES[preferredType] || [];
  const candidates = [...preparedCandidates, canonical, preferredType, ...aliases, "Other"].filter(Boolean);
  return [...new Set(candidates)].filter((candidate) => candidate !== "Please Select");
}

function findDropdownControlByLabels(labels, modal) {
  for (const label of labels) {
    const found = findExactByLabelText(label, "", modal) || findByLabelText([label], "", modal);
    if (found?.element) return found.element;
  }
  return null;
}

function findVisibleOptionInDocument(optionText) {
  const target = normalizeOptionLabel(optionText);
  const selectors = [
    "option",
    "[role='option']",
    ".ui-select-choices-row",
    ".ui-select-choices-row-inner",
    ".select2-results__option",
    ".select2-result-label",
    ".dropdown-menu li",
    ".dropdown-menu a",
    ".k-list .k-item",
    "li",
    "div",
    "span"
  ];
  const seen = new Set();
  const options = selectors.flatMap((selector) => [...document.querySelectorAll(selector)])
    .filter((element) => {
      if (seen.has(element)) return false;
      seen.add(element);
      return isVisible(element);
    })
    .filter((element) => {
      const text = normalizeOptionLabel(element.textContent || element.getAttribute("value"));
      return text && text.length <= 120;
    });
  return options.find((element) => normalizeOptionLabel(element.textContent || element.getAttribute("value")) === target) ||
    options.find((element) => labelsMatchLoose(element.textContent || element.getAttribute("value"), optionText)) ||
    null;
}

async function selectDropdownControlOption(control, optionText) {
  if (!control) return false;
  if (control.tagName === "SELECT") {
    const option = [...control.options].find((item) => labelsMatchLoose(item.textContent, optionText));
    if (!option) return false;
    control.value = option.value;
    control.dispatchEvent(new Event("input", { bubbles: true }));
    control.dispatchEvent(new Event("change", { bubbles: true }));
    control.dispatchEvent(new Event("blur", { bubbles: true }));
    await sleep(150);
    return labelsMatchLoose(readFieldValue(control), option.textContent);
  }

  clickElement(control);
  await sleep(250);
  const searchInput = [...document.querySelectorAll("input.ui-select-search, input.select2-search__field, input.select2-input, input[type='search'], input[aria-autocomplete]")]
    .filter(isVisible)[0];
  if (searchInput) {
    nativeSetValue(searchInput, optionText);
    await sleep(300);
  }
  const option = findVisibleOptionInDocument(optionText);
  if (!option) {
    pressEscape();
    await sleep(120);
    return false;
  }
  clickElement(option);
  await sleep(250);
  return true;
}

function readSelectedExpenseType(modal) {
  const control = findDropdownControlByLabels(["Expense Type", "Type", "Expense"], modal);
  if (!control) return "";
  if (control.tagName === "SELECT") return readFieldValue(control);
  const container = control.closest(".form-group, .row, .field, .control-group, div") || control.parentElement || modal;
  const display = container.querySelector(".ui-select-match-text, .select2-selection__rendered, .select2-chosen, .dropdown-toggle, [role='combobox']") || control;
  return String(readFieldValue(display) || display.textContent || "").trim();
}

function collectVisibleButtonsAndLinks(root = document) {
  return clickableElements(root)
    .map((element) => visibleText(element))
    .filter((text) => text && text.length <= 120)
    .filter((text, index, items) => items.indexOf(text) === index)
    .slice(0, 80);
}

function readDropdownDisplay(control) {
  if (!control) return "";
  if (control.tagName === "SELECT") return readFieldValue(control);
  const container = control.closest(".form-group, .row, .field, .control-group, div") || control.parentElement || document;
  const display = container.querySelector(".ui-select-match-text, .select2-selection__rendered, .select2-chosen, .dropdown-toggle, [role='combobox']") || control;
  return String(readFieldValue(display) || display.textContent || "").trim();
}

async function selectExpenseTypeWithFallback(preferredType, modal, result, preparedCandidates = []) {
  const control = findDropdownControlByLabels(["Expense Type", "Type", "Expense"], modal);
  if (!control) {
    recordError(result, "financialsExpense", "Expense Type", "Expense Type control not found", { expenseType: preferredType });
    return "";
  }
  const requested = canonicalInfinityExpenseType(preferredType);
  const candidates = expenseTypeCandidates(preferredType, preparedCandidates);
  for (const candidate of candidates) {
    const ok = await selectDropdownControlOption(control, candidate);
    if (!ok) continue;
    const selected = await waitFor(() => readSelectedExpenseType(modal), { timeout: 900, interval: 100 });
    if (selected && labelsMatchLoose(selected, candidate)) {
      if (!labelsMatchLoose(candidate, preferredType)) {
        result.warnings.push({ section: "financialsExpense", code: "EXPENSE_TYPE_ALIAS_USED", requested: preferredType, used: selected, matchedBy: candidate });
      }
      result.actions.push({ action: "select-expense-type", section: "financialsExpense", requested: preferredType, selected, canonical: requested });
      return selected;
    }
  }
  recordError(result, "financialsExpense", "Expense Type", `Could not select expense type ${preferredType}`, { tried: candidates });
  return "";
}

async function fillExpenseOwnership(modal, payload, result, expenseType, row = {}) {
  if (row.ownership && typeof row.ownership === "object") {
    const inputs = [...modal.querySelectorAll("input:not([type='hidden'])")].filter(isVisible);
    const percentInputs = inputs.filter((input) => normalize(input.value).includes("%") || input.value === "" || /^\d+%?$/.test(String(input.value || "")));
    const values = Object.values(row.ownership).filter((value) => value !== undefined && value !== null && value !== "");
    if (values.length && percentInputs.length >= values.length) {
      for (let index = 0; index < values.length; index += 1) {
        await setFieldValue(percentInputs[index], String(values[index]).includes("%") ? values[index] : `${values[index]}%`);
      }
      result.actions.push({ action: "set-expense-ownership", section: "financialsExpense", label: expenseType, split: values.join("/") });
      return true;
    }
  }
  const applicants = infinityApplicantRows(payload);
  if (applicants.length > 1) {
    const inputs = [...modal.querySelectorAll("input:not([type='hidden'])")].filter(isVisible);
    const percentInputs = inputs.filter((input) => normalize(input.value).includes("%") || input.value === "" || /^\d+%?$/.test(String(input.value || "")));
    if (percentInputs.length >= 2) {
      await setFieldValue(percentInputs[0], "50%");
      await setFieldValue(percentInputs[1], "50%");
      result.actions.push({ action: "set-expense-ownership", section: "financialsExpense", label: expenseType, split: "50/50" });
      return true;
    }
  }
  result.actions.push({ action: "review-expense-ownership", section: "financialsExpense", label: expenseType, reason: applicants.length > 1 ? "ownership inputs not found" : "single applicant default" });
  return false;
}

function tableSectionText(sectionLabel) {
  const node = findTextNode([sectionLabel]);
  if (!node) return normalize(document.body?.innerText || "");
  let container = node.parentElement;
  for (let depth = 0; depth < 6 && container; depth += 1) {
    const text = normalize(container.textContent);
    if (text.includes(normalize(sectionLabel)) && (text.includes("actions") || text.includes("add expense") || text.includes("nothing to show"))) return text;
    container = container.parentElement;
  }
  return normalize(document.body?.innerText || "");
}

function verifyTableRow(section, expectedText, result) {
  const text = tableSectionText(section);
  const ok = normalize(expectedText).split(/\s+/).filter(Boolean).every((part) => text.includes(part));
  if (!ok) {
    recordVerificationFailure(result, "financials", expectedText, `Expected row not visible in ${section}`);
    return false;
  }
  result.actions.push({ action: "verify-table-row", section: "financials", label: section, expectedText });
  return true;
}

function verifyExpenseTableRow(row, selectedType, result) {
  const text = tableSectionText("Monthly Expenses");
  const typeOk = labelsMatchLoose(text, selectedType) || labelsMatchLoose(text, row.type);
  const amountOk = numericTokens(row.amount).some((token) => text.includes(normalize(token)));
  if (!typeOk || !amountOk) {
    recordVerificationFailure(result, "financialsExpense", row.type, "Monthly expense row not verified by type and amount after save", {
      selectedType,
      amount: row.amount,
      typeOk,
      amountOk
    });
    return false;
  }
  result.actions.push({ action: "verify-expense-row", section: "financialsExpense", label: selectedType, amount: row.amount });
  return true;
}

function readExpenseAmount(modal) {
  const found = findExactByLabelText("Expense Amount", "", modal) || findByLabelText(["Expense Amount", "Amount"], "", modal);
  return normalizeMoneyValue(found?.element ? readFieldValue(found.element) : "");
}

async function verifyExpenseModalMandatoryFields(modal, row, selectedType, result) {
  const selected = readSelectedExpenseType(modal);
  const amount = readExpenseAmount(modal);
  const typeOk = Boolean(selected && (labelsMatchLoose(selected, selectedType) || labelsMatchLoose(selected, row.type)));
  const amountOk = Number(amount) === Number(normalizeMoneyValue(row.amount));
  if (typeOk && amountOk) return true;
  recordVerificationFailure(result, "financialsExpense", row.type, "Expense modal mandatory fields not verified before save", {
    selectedType,
    selected,
    expectedAmount: row.amount,
    actualAmount: amount,
    typeOk,
    amountOk
  });
  return false;
}

async function upsertExpenseRow(row, payload, result) {
  row = normalizeExpenseRow(row);
  if (!row.type || row.amount <= 0) {
    recordError(result, "financialsExpense", "Monthly Expenses", "Invalid expense row; missing type or amount", row);
    return false;
  }
  await scrollToText(["Monthly Expenses", "Add Expense"]);
  const existingText = tableSectionText("Monthly Expenses");
  if (labelsMatchLoose(existingText, row.type) && numericTokens(row.amount).some((token) => existingText.includes(normalize(token)))) {
    result.actions.push({ action: "skip-existing-expense", section: "financialsExpense", label: row.type, amount: row.amount });
    return true;
  }

  const addButton = findClickableByText(["Add Expense", "+ Add Expense"]);
  if (!addButton) {
    recordFieldSkipped(result, "financialsExpense", "Add Expense", "Add Expense button not visible", { expenseType: row.type, visibleActions: collectVisibleButtonsAndLinks() });
    return false;
  }
  const modal = await clickAndWaitForModal(addButton);
  if (!modal) {
    recordError(result, "financialsExpense", "Add Expense", "Expense modal did not open", { expenseType: row.type });
    return false;
  }
  result.actions.push({ action: "open-expense-modal", section: "financialsExpense", label: row.type });

  const selectedType = await selectExpenseTypeWithFallback(row.type, modal, result, row.infinityTypeCandidates);
  if (!selectedType) {
    await closeActiveModalWithoutSaving();
    return false;
  }
  await fillInputByLabel("Expense Amount", row.amount, modal, result, { section: "financialsExpense", expenseType: selectedType });
  await selectDropdownByText("Expense Frequency", row.frequency || "Monthly", modal, result, { section: "financialsExpense", expenseType: selectedType });
  await fillInputByLabel("Description", row.description || selectedType, modal, result, { section: "financialsExpense", expenseType: selectedType });
  await selectDropdownByText("Continue Post Settlement", row.continuePostSettlement || "Yes", modal, result, { section: "financialsExpense", expenseType: selectedType });
  await fillExpenseOwnership(modal, payload, result, selectedType, row);

  const verified = await verifyExpenseModalMandatoryFields(modal, row, selectedType, result);
  if (!verified) {
    await closeActiveModalWithoutSaving();
    recordError(result, "financialsExpense", row.type, "Expense modal closed without saving because type/amount verification failed", { amount: row.amount, selectedType });
    return false;
  }

  const saved = await saveModalAndVerifyClosed(result, `Expense ${selectedType}`);
  if (!saved) return false;
  await sleep(400);
  return verifyExpenseTableRow(row, selectedType, result);
}

function fullApplicantName(applicant) {
  return (applicant?.fullName || [applicant?.firstName, applicant?.middleName, applicant?.lastName || applicant?.surname].filter(Boolean).join(" ")).trim();
}

function readSectionTotal(sectionLabel) {
  const node = findTextNode([sectionLabel]);
  const candidates = [];
  if (node) {
    let container = node.parentElement;
    for (let depth = 0; depth < 5 && container; depth += 1) {
      candidates.push(container.textContent || "");
      container = container.parentElement;
    }
  }
  candidates.push(document.body?.innerText || "");
  for (const text of candidates) {
    const exactLine = String(text || "").split(/\n+/).find((line) => normalize(line).includes(normalize(sectionLabel)) && /\$[\d,]+/.test(line));
    const source = exactLine || text;
    const match = String(source || "").match(new RegExp(`${sectionLabel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\$?([\\d,]+(?:\\.\\d{1,2})?)`, "i"));
    if (match) return normalizeMoneyValue(match[1]);
  }
  return 0;
}

async function saveFinancialsPageAndVerify(rows, result) {
  showAutomationStatus("Financials: saving page and rechecking Monthly Expenses", "running");
  const saveButton = findSaveChangesButton();
  if (saveButton && !isDisabled(saveButton)) {
    clickElement(saveButton);
    const saved = await waitForSaveComplete();
    if (!saved) {
      recordVerificationFailure(result, "financialsExpense", "Save Changes", "Financials Save Changes was clicked but completion was not confirmed");
      return false;
    }
  } else {
    result.actions.push({ action: "financials-save-not-visible", section: "financialsExpense", reason: saveButton ? "save disabled" : "save button not visible" });
  }
  await sleep(800);
  const tableText = tableSectionText("Monthly Expenses");
  const expectedTotal = rows.reduce((sum, row) => sum + normalizeMoneyValue(row.amount), 0);
  const actualTotal = readSectionTotal("Monthly Expenses");
  const missingRows = rows.filter((row) => {
    const typeOk = labelsMatchLoose(tableText, row.type);
    const amountOk = numericTokens(row.amount).some((token) => tableText.includes(normalize(token)));
    return !typeOk || !amountOk;
  });
  if (missingRows.length || Number(expectedTotal) !== Number(actualTotal)) {
    recordVerificationFailure(result, "financialsExpense", "Monthly Expenses", "Monthly Expenses did not persist after Financials save/recheck", {
      expectedRows: rows.map((row) => ({ type: row.type, amount: row.amount })),
      missingRows: missingRows.map((row) => ({ type: row.type, amount: row.amount })),
      expectedTotal,
      actualTotal,
      tableText: tableText.slice(0, 1000)
    });
    return false;
  }
  result.actions.push({ action: "save-financials-verified", section: "financialsExpense", expectedTotal, actualTotal, rows: rows.length });
  return true;
}

function hasApplicantName(applicant) {
  return Boolean(fullApplicantName(applicant) || applicant?.firstName || applicant?.lastName || applicant?.surname);
}

function infinityApplicantRows(payload) {
  const rows = collectionAt(payload, "infinity.applicants").filter(hasApplicantName);
  if (rows.length) return rows;
  return [getValue(payload, "infinity.clientDetails")].filter(hasApplicantName);
}

function rawApplicantForIndex(payload, index) {
  return index === 0 ? getValue(payload, "applicants.primary") : getValue(payload, "applicants.secondary");
}

function isClientDetailsPage() {
  return pageHasAnyText(["Client Details", "Entity Type", "Applicant Type", "Current Address"]);
}

function collectVisibleApplicantTabs() {
  const textItems = [
    ...document.querySelectorAll("a, button, li, div, span")
  ]
    .filter(isVisible)
    .map((element) => ({ element, text: visibleText(element) }))
    .filter((item) => item.text && item.text.length <= 80)
    .filter((item) => /^[a-z]+(?:\s+[a-z]+)+$/.test(item.text))
    .filter((item) => !/(client details|add applicants|primary applicant|applicant type|entity type|related spouse|home phone|work phone)/i.test(item.text));
  const seen = new Set();
  return textItems.filter((item) => {
    if (seen.has(item.text)) return false;
    seen.add(item.text);
    return true;
  });
}

function applicantNameParts(applicant) {
  return {
    fullName: fullApplicantName(applicant),
    firstName: applicant?.firstName || "",
    surname: applicant?.surname || applicant?.lastName || ""
  };
}

function markApplicantState(applicant, patch) {
  const key = fullApplicantName(applicant) || `Applicant ${Object.keys(automationRunState.clientDetails.applicants).length + 1}`;
  automationRunState.clientDetails.applicants[key] = {
    name: key,
    visited: false,
    filled: false,
    verifiedBeforeSave: false,
    saved: false,
    verifiedAfterSave: false,
    ...(automationRunState.clientDetails.applicants[key] || {}),
    ...patch
  };
}

function applicantRunSummary() {
  return JSON.stringify(automationRunState.clientDetails.applicants || {}, null, 2);
}

function readDisplayByLabel(label, scope = document) {
  const found = findExactByLabelText(label, "", scope) || findByLabelText([label], "", scope);
  if (!found?.element) return "";
  if (looksLikeChoiceControl(found.element)) return readDropdownDisplay(found.element);
  return readFieldValue(found.element);
}

function applicantCriticalChecks(applicant) {
  const checks = [
    { label: "First Name", expected: applicant.firstName, type: "text" },
    { label: "Surname", expected: applicant.surname || applicant.lastName, type: "text" }
  ];
  if (applicant.dateOfBirth) checks.push({ label: "Date of Birth", expected: formatDateValue(applicant.dateOfBirth, "au"), type: "date" });
  if (applicant.gender) checks.push({ label: "Gender", expected: applicant.gender, type: "dropdown" });
  if (applicant.relatedSpouse) checks.push({ label: "Related Spouse", expected: applicant.relatedSpouse, type: "dropdown" });
  if (applicant.driversLicenceNo) checks.push({ label: "Driver's Licence No.", expected: applicant.driversLicenceNo, type: "text" });
  if (applicant.licenceExpiryDate) checks.push({ label: "Licence Expiry Date", expected: formatDateValue(applicant.licenceExpiryDate, "au"), type: "date" });
  if (applicant.licenceState) checks.push({ label: "Licence State", expected: applicant.licenceState, type: "dropdown" });
  if (applicant.licenceClass) checks.push({ label: "Licence Class", expected: applicant.licenceClass, type: "text" });
  return checks.filter((check) => check.expected !== undefined && check.expected !== null && check.expected !== "");
}

async function verifyApplicantCriticalFields(applicant, scope, result, phase) {
  const failures = [];
  for (const check of applicantCriticalChecks(applicant)) {
    const actualRaw = readDisplayByLabel(check.label, scope || document);
    const actual = check.type === "date" ? formatDateValue(actualRaw, "au") : actualRaw;
    const expected = check.expected;
    const ok = valuesMatch(expected, actual);
    if (!ok) {
      failures.push({ label: check.label, expected, actual, type: check.type });
      recordVerificationFailure(result, "clientDetails", check.label, `Applicant critical field failed verification at phase: ${phase}`, {
        applicantName: fullApplicantName(applicant),
        expected,
        actual,
        phase
      });
    }
  }
  return { ok: failures.length === 0, failures };
}

async function saveClientDetailsAndVerify(applicant, result, rowIndex) {
  const name = fullApplicantName(applicant);
  showAutomationStatus(`Client Details: saving ${name}`, "running");
  const saveButton = findSaveChangesButton();
  if (!saveButton) {
    recordVerificationFailure(result, "clientDetails", "Save Changes", "Save Changes button not found", { applicantName: name, rowIndex });
    return false;
  }
  if (isDisabled(saveButton)) {
    recordVerificationFailure(result, "clientDetails", "Save Changes", "Save Changes button is disabled", { applicantName: name, rowIndex });
    return false;
  }
  clickElement(saveButton);
  const saved = await waitForSaveComplete();
  if (!saved) {
    recordVerificationFailure(result, "clientDetails", "Save Changes", "Save was clicked but completion was not confirmed", { applicantName: name, rowIndex });
    return false;
  }
  await sleep(700);
  const activation = await activateInfinityApplicantTab(applicant, result, rowIndex);
  if (!activation.ok) return false;
  const afterSave = await verifyApplicantCriticalFields(applicant, activation.scope, result, "after-save");
  if (!afterSave.ok) {
    recordVerificationFailure(result, "clientDetails", name, "Applicant fields were filled but did not persist after Save Changes", {
      rowIndex,
      failures: afterSave.failures
    });
    return false;
  }
  result.actions.push({ action: "save-client-details-verified", section: "clientDetails", label: name, rowIndex });
  return true;
}

function clickApplicantTabByName(name) {
  if (!name) return false;
  const wanted = normalize(name);
  const candidates = collectVisibleApplicantTabs().map((item) => item.element);
  const tab = candidates.find((element) => {
    const text = visibleText(element);
    if (!text || text.length > 120) return false;
    return text === wanted;
  });
  if (!tab) return false;
  clickElement(tab);
  return true;
}

async function clickMainTabByText(text, result) {
  const target = findNavigationTarget([text]) || findClickableByText([text]);
  if (!target) {
    recordFieldSkipped(result, "navigation", text, "main tab not found");
    return false;
  }
  return safeClick(target, result, "open-main-tab", { section: "navigation", label: text });
}

async function clickSubTab(text, result) {
  const target = findClickableByText([text]) || findNavigationTarget([text]);
  if (!target) {
    recordFieldSkipped(result, "loansProducts", text, "subtab not found");
    return false;
  }
  return safeClick(target, result, "open-subtab", { section: "loansProducts", label: text });
}

async function waitForActiveApplicant(applicantName) {
  if (!applicantName) return null;
  const wanted = normalize(applicantName);
  return waitFor(() => {
    const activeCandidates = [...document.querySelectorAll(".active, .selected, [aria-selected='true'], li, a, span")]
      .filter(isVisible)
      .filter((element) => {
        const text = visibleText(element);
        const marker = normalize(`${element.className || ""} ${element.getAttribute("aria-selected") || ""}`);
        return text && (text === wanted || text.includes(wanted)) && (marker.includes("active") || marker.includes("selected") || element.getAttribute("aria-selected") === "true");
      });
    return activeCandidates[0] || null;
  }, { timeout: 4000, interval: 150 });
}

function getActiveApplicantScope(applicantName) {
  const wanted = normalize(applicantName);
  const activeTab = [...document.querySelectorAll(".active, .selected, [aria-selected='true'], li, a")]
    .filter(isVisible)
    .find((element) => {
      const text = visibleText(element);
      return text && (text === wanted || text.includes(wanted));
    });
  let container = activeTab?.parentElement;
  for (let depth = 0; depth < 6 && container; depth += 1) {
    const marker = normalize(`${container.className || ""} ${container.id || ""}`);
    if (marker.includes("tab") || marker.includes("client") || marker.includes("account")) break;
    container = container.parentElement;
  }
  const visibleForms = [...document.querySelectorAll("form, .tab-pane.active, .tab-content .active, [ng-show]:not(.ng-hide), [data-ng-show]:not(.ng-hide), .panel, .card")]
    .filter(isVisible)
    .filter((element) => element.querySelector(controlSelector))
    .sort((a, b) => (b.getBoundingClientRect().width * b.getBoundingClientRect().height) - (a.getBoundingClientRect().width * a.getBoundingClientRect().height));
  return visibleForms[0] || null;
}

function readClientNameFields(scope) {
  return {
    firstName: readFieldByExactLabel("First Name", scope || document),
    surname: readFieldByExactLabel("Surname", scope || document)
  };
}

async function activateInfinityApplicantTab(applicant, result, rowIndex) {
  const { fullName, firstName, surname } = applicantNameParts(applicant);
  const visibleApplicantTabs = collectVisibleApplicantTabs().map((item) => item.text);
  if (!fullName || !firstName || !surname) {
    recordFieldSkipped(result, "clientDetails", fullName || `Applicant ${rowIndex + 1}`, "Applicant name incomplete; skipped to avoid filling wrong tab", {
      rowIndex,
      expected: { firstName, surname, fullName },
      visibleApplicantTabs
    });
    return { ok: false, skip: true, visibleApplicantTabs };
  }

  const clicked = clickApplicantTabByName(fullName);
  if (!clicked) {
    recordError(result, "clientDetails", fullName, `Applicant tab not found for ${fullName}`, { rowIndex, visibleApplicantTabs });
    return { ok: false, clicked: false, visibleApplicantTabs };
  }

  await waitForAngularSettle();
  await sleep(500);
  const active = await waitForActiveApplicant(fullName);
  const scope = getActiveApplicantScope(fullName);
  const actual = readClientNameFields(scope || document);
  const ok = Boolean(
    scope &&
    valuesMatch(firstName, actual.firstName) &&
    valuesMatch(surname, actual.surname)
  );

  const details = {
    rowIndex,
    clicked,
    selectorUsed: active ? visibleText(active) : "",
    expected: { firstName, surname, fullName },
    actual,
    visibleApplicantTabs
  };

  if (!ok) {
    recordError(result, "clientDetails", fullName, "Applicant tab did not activate or visible form does not match payload. Stopped this applicant before filling.", details);
    return { ok: false, clicked, scope: null, ...details };
  }

  result.actions.push({ action: "activate-applicant-tab", section: "clientDetails", label: fullName, ...details });
  return { ok: true, clicked, scope, ...details };
}

function addressPartsFromApplicant(applicant, fallbackAddressText = "") {
  const rawAddress = applicant?.address || {};
  const address = typeof rawAddress === "string" ? { line1: rawAddress } : rawAddress;
  const line1 = address.line1 || address.current || address.fullAddress || fallbackAddressText || "";
  const fullText = String([line1, address.suburb, address.state, address.postcode].filter(Boolean).join(" ") || fallbackAddressText || "")
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
  const stateValue = address.state || stateMatch?.[1]?.toUpperCase() || "";
  const postcodeValue = address.postcode || postcodeMatch?.[1] || "";
  const splitFullAddress = splitAustralianAddress(fullText);
  const lineBeforeSuburb = splitFullAddress.line1 || line1 || fullText;
  const addressBeforeState = String(lineBeforeSuburb)
    .replace(/\b\d{4}\b.*$/i, "")
    .replace(/\b(ACT|NSW|NT|QLD|SA|TAS|VIC|WA)\b.*$/i, "")
    .replace(/,/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const unit = addressBeforeState.match(/\b(?:unit|u|apt|apartment)\s*([a-z0-9/-]+)/i)?.[1] || "";
  const withoutUnit = addressBeforeState
    .replace(/\b(?:unit|u|apt|apartment)\s*[a-z0-9/-]+\s*/i, "")
    .replace(/^[/,\s-]+/, "")
    .trim();
  const number = withoutUnit.match(/^(\d+[a-z]?(?:-\d+[a-z]?)?)/i)?.[1] || "";
  const afterNumber = withoutUnit.replace(/^(\d+[a-z]?(?:-\d+[a-z]?)?)\s*/i, "").trim();
  const typePattern = new RegExp(`\\b(${streetTypes.join("|")})\\b\\.?$`, "i");
  const typeAnywherePattern = new RegExp(`\\b(${streetTypes.join("|")})\\b\\.?`, "i");
  const typeMatch = afterNumber.match(typeAnywherePattern);
  const streetType = typeMatch?.[1] || "";
  const streetName = streetType ? afterNumber.slice(0, typeMatch.index).trim() : afterNumber;
  const suburbAfterStreet = streetType ? afterNumber.slice((typeMatch.index || 0) + typeMatch[0].length).trim() : "";
  const suburb = cleanSuburbCandidate(address.suburb || splitFullAddress.suburb || suburbAfterStreet || inferSuburb(fullText, stateValue, postcodeValue));

  return {
    buildingName: address.buildingName || "",
    floorNumber: address.floorNumber || "",
    unitNumber: address.unitNumber || unit,
    streetNumber: address.streetNumber || number,
    streetName: address.streetName || streetName,
    streetType: address.streetType || streetType,
    suburb,
    state: address.state || splitFullAddress.state || stateValue,
    postcode: address.postcode || splitFullAddress.postcode || postcodeValue,
    country: address.country || "Australia",
    startDate: address.startDate || address.fromDate || ""
  };
}

function parseAustralianAddress(raw) {
  return addressPartsFromApplicant({ address: typeof raw === "string" ? { line1: raw } : raw }, typeof raw === "string" ? raw : "");
}

function splitAustralianAddress(text) {
  const source = String(text || "").replace(/\s+/g, " ").trim();
  const match = source.match(/^(.*?),?\s+([A-Za-z][A-Za-z\s.'-]*?)\s+(ACT|NSW|NT|QLD|SA|TAS|VIC|WA)\s+(\d{4})(?:\s*,?\s*Australia)?$/i);
  if (!match) return {};
  return {
    line1: match[1].trim().replace(/,\s*$/, ""),
    suburb: cleanSuburbCandidate(match[2]),
    state: match[3].toUpperCase(),
    postcode: match[4]
  };
}

function cleanSuburbCandidate(value) {
  const text = String(value || "")
    .replace(/[,]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return "";
  const normalized = normalize(text);
  if (/^(act|nsw|nt|qld|sa|tas|vic|wa|\d{4}|australia)$/.test(normalized)) return "";
  if (/\b(street|st|road|rd|avenue|ave|boulevard|blvd|court|ct|drive|dr|lane|ln|unit|apartment|floor)\b/.test(normalized)) return "";
  return text;
}

function inferSuburb(text, state, postcode) {
  const source = String(text || "");
  if (!state && !postcode) return "";
  const beforeState = state ? source.split(new RegExp(`\\b${state}\\b`, "i"))[0] : source.split(postcode)[0];
  const words = beforeState.replace(/[,]/g, " ").trim().split(/\s+/).filter(Boolean);
  if (words.length < 2) return "";
  return cleanSuburbCandidate(words.slice(-2).join(" "));
}

function rowForAddressLabel(addressLabel) {
  const wanted = normalize(addressLabel);
  const nodes = [...document.querySelectorAll("label, span, div, p, strong, h1, h2, h3, h4, td, th")]
    .filter(isVisible)
    .filter((node) => {
      const text = normalize(node.textContent);
      return text && text.length <= 180 && (text === wanted || text.includes(wanted));
    });
  for (const node of nodes) {
    let container = node.parentElement;
    for (let depth = 0; depth < 8 && container; depth += 1) {
      if (findClickableByText(["Edit"], container) || normalize(container.textContent).includes("please start typing address")) return container;
      container = container.parentElement;
    }
  }
  return null;
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

async function clickAddressEdit(addressLabel, result, meta = {}) {
  await scrollToText([addressLabel]);
  const edit = findEditButtonForAddress(addressLabel);
  if (!edit) {
    recordFieldSkipped(result, "clientDetails", `${addressLabel} Edit`, "Edit button not visible", meta);
    return null;
  }
  const modal = await clickAndWaitForModal(edit);
  if (!modal) {
    recordError(result, "clientDetails", addressLabel, "Edit Address modal did not open", meta);
    return null;
  }
  result.actions.push({ action: "open-address-edit", section: "clientDetails", label: addressLabel, ...meta });
  return modal;
}

function exactLabelNode(label, root) {
  const wanted = normalize(label);
  return [...root.querySelectorAll("label, span, div, p, strong")]
    .filter(isVisible)
    .find((node) => {
      const text = normalize(node.textContent).replace(/\s*\*\s*$/, "");
      return text === wanted;
    }) || null;
}

function controlByExactModalLabel(label, modal, value = "") {
  const node = exactLabelNode(label, modal);
  if (!node) return null;
  const direct = directControlForLabel(node, value);
  if (direct) return { element: direct, selector: `address modal exact label: ${label}` };

  const labelRect = node.getBoundingClientRect();
  const labelCenterX = labelRect.left + labelRect.width / 2;
  const candidates = [...modal.querySelectorAll(controlSelector)]
    .filter(isVisible)
    .map((control) => ({ control, rect: control.getBoundingClientRect() }))
    .filter(({ rect }) => rect.width > 10 && rect.height > 10)
    .filter(({ rect }) => rect.top >= labelRect.top - 4 && rect.top - labelRect.bottom < 95)
    .filter(({ rect }) => {
      const centerX = rect.left + rect.width / 2;
      const sameColumn = centerX >= labelRect.left - 35 && centerX <= labelRect.right + 45;
      const labelInsideControl = labelCenterX >= rect.left - 8 && labelCenterX <= rect.right + 8;
      return sameColumn || labelInsideControl;
    })
    .sort((a, b) => {
      const aCenterX = a.rect.left + a.rect.width / 2;
      const bCenterX = b.rect.left + b.rect.width / 2;
      const aVertical = Math.max(0, a.rect.top - labelRect.bottom);
      const bVertical = Math.max(0, b.rect.top - labelRect.bottom);
      const aScore = Math.abs(aCenterX - labelCenterX) * 3 + aVertical;
      const bScore = Math.abs(bCenterX - labelCenterX) * 3 + bVertical;
      return aScore - bScore;
    });
  return candidates[0] ? { element: candidates[0].control, selector: `address modal geometry: ${label}` } : null;
}

async function setAddressModalField(label, value, modal, result, meta = {}) {
  if ((value === undefined || value === null || value === "") && !meta.allowEmpty) return false;
  const found = controlByExactModalLabel(label, modal, value);
  if (!found) {
    recordFieldSkipped(result, "clientDetails", label, "address modal field not found", meta);
    return false;
  }
  const ok = await setFieldValue(found.element, value ?? "");
  if (ok) recordFieldFilled(result, "clientDetails", label, value, found, meta);
  else recordFieldSkipped(result, "clientDetails", label, `address modal control refused value: ${value}`, meta);
  await sleep(90);
  return ok;
}

function hasCompleteStreetAddress(parsed) {
  return Boolean(
    parsed &&
    parsed.streetNumber &&
    parsed.streetName &&
    parsed.streetType &&
    parsed.suburb &&
    parsed.state &&
    parsed.postcode
  );
}

async function fillAddressModal(parsed, modal, result, meta = {}) {
  const addressFields = [
    ["Building Name", parsed.buildingName],
    ["Floor Number", parsed.floorNumber],
    ["Unit Number", parsed.unitNumber],
    ["Street Number", parsed.streetNumber],
    ["Street Name", parsed.streetName],
    ["Street Type", parsed.streetType],
    ["Suburb/City", parsed.suburb],
    ["State", parsed.state],
    ["Postcode", parsed.postcode],
    ["Country", parsed.country],
    ["Start Date", formatDateValue(parsed.startDate, "au")]
  ];

  for (const [label, value] of addressFields) {
    const canClear = ["Building Name", "Floor Number", "Unit Number", "Street Number", "Street Name", "Suburb/City", "Postcode", "Start Date"].includes(label);
    if ((value === undefined || value === null || value === "") && !canClear) continue;
    await setAddressModalField(label, value || "", modal, result, { ...meta, allowEmpty: canClear });
  }
  return true;
}

async function saveModalAndVerifyClosed(result, description) {
  const saved = await clickModalSave();
  result.actions.push({ action: saved ? "save-modal" : "review-modal", section: "modal", label: description });
  if (!saved) {
    recordError(result, "modal", description, "Modal was filled but did not close");
  }
  return saved;
}

async function verifyAddressRowNotPlaceholder(addressLabel, parsed, result, applicantName) {
  await scrollToText([addressLabel]);
  const row = rowForAddressLabel(addressLabel);
  const text = normalize(row?.textContent || "");
  if (!row || text.includes("please start typing address")) {
    recordVerificationFailure(result, "clientDetails", addressLabel, "Address row still shows placeholder after save", { applicantName, expected: parsed });
    return false;
  }
  const requiredParts = [parsed.streetNumber, parsed.streetName, parsed.state, parsed.postcode].filter(Boolean).map(normalize);
  const missingParts = requiredParts.filter((part) => !text.includes(part));
  if (missingParts.length) {
    recordVerificationFailure(result, "clientDetails", addressLabel, "Address row saved but does not match expected parsed address", {
      applicantName,
      expected: parsed,
      actual: row?.textContent?.trim() || "",
      missingParts
    });
    return false;
  }
  result.actions.push({ action: "verify-address-row", section: "clientDetails", label: addressLabel, applicantName });
  return true;
}

async function fillAddressForApplicant(addressLabel, applicant, rawAddress, result, meta = {}) {
  if (!rawAddress || (typeof rawAddress === "object" && !Object.values(rawAddress).some(Boolean))) {
    recordFieldSkipped(result, "clientDetails", addressLabel, "address data missing; skipped by rule", meta);
    return false;
  }
  const parsed = addressPartsFromApplicant({ ...applicant, address: rawAddress }, typeof rawAddress === "string" ? rawAddress : "");
  if (!hasCompleteStreetAddress(parsed)) {
    recordFieldSkipped(result, "clientDetails", addressLabel, "address incomplete; skipped to avoid half-saved CRM row", { ...meta, parsed });
    return false;
  }
  const modal = await clickAddressEdit(addressLabel, result, meta);
  if (!modal) return false;
  await fillAddressModal(parsed, modal, result, meta);
  const saved = await saveModalAndVerifyClosed(result, `Address ${addressLabel}`);
  if (saved) await verifyAddressRowNotPlaceholder(addressLabel, parsed, result, meta.applicantName);
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

function isAddressLikeText(value) {
  return looksLikeAddressValue(value);
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

async function cleanupMisfilledClientDetails(result, rowIndex, scope = document) {
  const phoneFields = [
    ["Home Phone"],
    ["Work Phone"],
    ["Fax"]
  ];

  for (const labels of phoneFields) {
    const found = findExactByLabelText(labels[0], "", scope) || findByLabelText(labels, "", scope);
    const actual = found ? readFieldValue(found.element) : "";
    if (actual && looksLikeAddressValue(actual)) {
      await setFieldValue(found.element, "");
      result.actions.push({ action: "clear-invalid-field", section: "clientDetails", label: labels[0], reason: "address detected in phone field", actual, rowIndex });
    }
  }

  const licenceNo = findExactByLabelText("Driver's Licence No.", "", scope) || findByLabelText(["Driver's Licence No.", "Licence No"], "", scope);
  const licenceNoValue = licenceNo ? readFieldValue(licenceNo.element) : "";
  if (licenceNoValue && looksLikeDateValue(licenceNoValue)) {
    await setFieldValue(licenceNo.element, "");
    result.actions.push({ action: "clear-invalid-field", section: "clientDetails", label: "Driver's Licence No.", reason: "date detected in licence number", actual: licenceNoValue, rowIndex });
  }

  const licenceState = findExactByLabelText("Licence State", "", scope) || findByLabelText(["Licence State"], "", scope);
  const licenceStateValue = licenceState ? readFieldValue(licenceState.element) : "";
  if (licenceStateValue && !isAustralianState(licenceStateValue)) {
    await setFieldValue(licenceState.element, "");
    result.actions.push({ action: "clear-invalid-field", section: "clientDetails", label: "Licence State", reason: "invalid Australian state", actual: licenceStateValue, rowIndex });
  }
}

async function clearAddressGarbageFromPhoneFields(scope, result, applicantName) {
  const phoneFields = ["Home Phone", "Work Phone", "Fax"];
  for (const label of phoneFields) {
    const found = findByLabelText([label], "", scope || document);
    const actual = found ? readFieldValue(found.element) : "";
    if (actual && isAddressLikeText(actual)) {
      await setFieldValue(found.element, "");
      result.actions.push({ action: "clear-invalid-field", section: "clientDetails", label, reason: "address detected in phone field", actual, applicantName });
    }
  }
}

async function detectAndFixDateSwap(applicant, scope, result) {
  const dob = formatDateValue(applicant?.dateOfBirth, "au");
  const expiry = formatDateValue(applicant?.licenceExpiryDate, "au");
  const dobField = findByLabelText(["Date of Birth"], dob, scope || document);
  const expiryField = findByLabelText(["Licence Expiry Date"], expiry, scope || document);
  const dobActual = dobField ? readFieldValue(dobField.element) : "";
  const expiryActual = expiryField ? readFieldValue(expiryField.element) : "";
  if (dob && expiry && normalize(dobActual) === normalize(expiry)) {
    await setFieldValue(dobField.element, dob);
    result.actions.push({ action: "fix-date-swap", section: "clientDetails", label: "Date of Birth", expected: dob, actual: dobActual });
  }
  if (dob && expiry && normalize(expiryActual) === normalize(dob)) {
    await setFieldValue(expiryField.element, expiry);
    result.actions.push({ action: "fix-date-swap", section: "clientDetails", label: "Licence Expiry Date", expected: expiry, actual: expiryActual });
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

async function selectRelatedSpouse(value, scope, result, rowIndex, applicantName) {
  const found = findExactByLabelText("Related Spouse", value, scope) || findByLabelText(["Related Spouse"], value, scope);
  if (!found?.element) {
    recordFieldSkipped(result, "clientDetails", "Related Spouse", "field not found after scroll", { rowIndex, applicantName });
    return false;
  }
  let ok = await selectDropdownControlOption(found.element, value);
  let visibleOptions = [];
  if (!ok) {
    clickElement(found.element);
    await sleep(250);
    visibleOptions = [...document.querySelectorAll("option, [role='option'], li, .option, .dropdown-item, .select-item, .ui-select-choices-row, .ui-select-choices-row-inner, .select2-results__option, a, span")]
      .filter(isVisible)
      .map((element) => ({ element, text: String(element.textContent || element.getAttribute("value") || "").trim() }))
      .filter((item) => item.text && item.text.length <= 120);
    const searchInput = [...document.querySelectorAll("input.ui-select-search, input[type='search'], input[aria-autocomplete]")]
      .filter(isVisible)[0];
    if (searchInput) {
      nativeSetValue(searchInput, value);
      await sleep(250);
    }
    const option = findVisibleOptionInDocument(value);
    if (option) {
      clickElement(option);
      ok = true;
    }
  }
  await sleep(350);
  const actual = readDropdownDisplay(found.element);
  result.fieldsFilled.push({ section: "clientDetails", label: "Related Spouse", selector: found.selector, expected: value, actual, rowIndex });
  const verified = valuesMatch(value, actual);
  if (!ok || !verified) {
    pressEscape();
    recordVerificationFailure(result, "clientDetails", "Related Spouse", "Related spouse option was clicked but selected value could not be verified", {
      expected: value,
      actual,
      rowIndex,
      applicantName,
      visibleOptions: visibleOptions.map((option) => option.text)
    });
  }
  return ok && verified;
}

async function fillClientDetailsDirect(applicant, result, rowIndex, scope = document) {
  let filledCount = 0;
  for (const [label, key, dateFormat] of clientDetailsFieldMap()) {
    const rawValue = applicant?.[key];
    if (rawValue === undefined || rawValue === null || rawValue === "") continue;
    const value = formatDateValue(rawValue, dateFormat);
    await scrollToText([label], scope === document ? document : scope);
    if (label === "Related Spouse") {
      const ok = await selectRelatedSpouse(value, scope, result, rowIndex, fullApplicantName(applicant));
      if (ok) filledCount += 1;
      await sleep(90);
      continue;
    }
    if (dateFormat === "au") {
      const ok = await fillDateByLabel(label, rawValue, scope, result, { section: "clientDetails", rowIndex, applicantName: fullApplicantName(applicant) });
      if (ok) filledCount += 1;
      await sleep(90);
      continue;
    }
    if (["Gender", "Licence State"].includes(label)) {
      const ok = await selectDropdownByText(label, value, scope, result, { section: "clientDetails", rowIndex, applicantName: fullApplicantName(applicant) });
      if (ok) filledCount += 1;
      await sleep(90);
      continue;
    }
    const found = findExactByLabelText(label, value, scope) || findByLabelText([label], value, scope);
    if (!found) {
      result.fieldsSkipped.push({ section: "clientDetails", label, reason: "field not found after scroll", rowIndex });
      continue;
    }
    try {
      const ok = await setFieldValue(found.element, value);
      if (ok) {
        await waitFor(() => valuesMatch(value, readFieldValue(found.element)), { timeout: 900, interval: 100 });
        const actual = readFieldValue(found.element);
        result.fieldsFilled.push({ section: "clientDetails", label, selector: found.selector, expected: value, actual, rowIndex });
        if (!valuesMatch(value, actual)) {
          recordVerificationFailure(result, "clientDetails", label, "CRM field value does not match prepared payload after fill", {
            expected: value,
            actual,
            rowIndex,
            applicantName: fullApplicantName(applicant)
          });
        }
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
  const rawAddress = rawApplicant?.address || {};
  const preparedAddress = applicant?.address || {};
  const currentAddressSource = rawAddress.line1 || rawAddress.current || rawAddress.fullAddress || applicant?.currentAddress || preparedAddress.line1 || preparedAddress.current || preparedAddress.fullAddress;
  const postSettlementSource = rawApplicant?.postSettlementAddress || rawAddress.postSettlement || applicant?.postSettlementAddress || preparedAddress.postSettlement || currentAddressSource;
  const mailingSource = rawApplicant?.mailingAddress || rawAddress.mailing || applicant?.mailingAddress || preparedAddress.mailing || currentAddressSource;
  const addressRows = [
    ["Current Address", currentAddressSource],
    ["Previous Address", rawApplicant?.previousAddress || rawApplicant?.previousResidentialAddress || rawAddress.previous || applicant?.previousAddress || preparedAddress.previous],
    ["Post Settlement Address", postSettlementSource],
    ["Mailing Address", mailingSource]
  ];
  for (const [label, addressSource] of addressRows) {
    await fillAddressForApplicant(label, applicant, addressSource, result, { rowIndex, applicantName: fullApplicantName(applicant) });
    await sleep(250);
  }
}

async function runClientDetailsWorkflow(payload, mapping, apiBase, result) {
  ensureResultShape(result);
  if (!isClientDetailsPage()) return false;
  const section = mapping.sections.find((item) => item.id === "clientDetails");
  if (!section) return false;
  const applicants = infinityApplicantRows(payload);
  if (!applicants.length) return false;

  for (let index = 0; index < applicants.length; index += 1) {
    throwIfAutomationStopped();
    const spouse = applicants.length > 1 ? applicants[index === 0 ? 1 : 0] : null;
    const applicant = {
      ...applicants[index],
      maritalStatus: applicants.length > 1 ? "Married" : applicants[index].maritalStatus,
      relatedSpouse: spouse ? fullApplicantName(spouse) : applicants[index].relatedSpouse
    };
    const name = fullApplicantName(applicant);
    setAutomationProgress(index, applicants.length, `Client Details: ${name || `Applicant ${index + 1}`}`);
    const activation = await activateInfinityApplicantTab(applicant, result, index);
    if (!activation.ok) {
      if (activation.skip) continue;
      result.verificationFailures.push({
        section: "clientDetails",
        label: name || `Applicant ${index + 1}`,
        message: "Applicant was not filled because active tab/form could not be verified.",
        rowIndex: index
      });
      continue;
    }
    markApplicantState(applicant, { visited: true });

    const scope = activation.scope;
    await clearAddressGarbageFromPhoneFields(scope, result, name);
    await cleanupMisfilledClientDetails(result, index, scope);
    await fillClientDetailsDirect(applicant, result, index, scope);
    if (applicant.relatedSpouse) {
      await selectRelatedSpouse(applicant.relatedSpouse, scope, result, index, name);
    }
    markApplicantState(applicant, { filled: true });
    await detectAndFixDateSwap(applicant, scope, result);
    await fillApplicantAddresses(applicant, rawApplicantForIndex(payload, index), result, index);
    await clearAddressGarbageFromPhoneFields(scope, result, name);
    await detectAndFixDateSwap(applicant, scope, result);
    const beforeSave = await verifyApplicantCriticalFields(applicant, scope, result, "before-save");
    if (!beforeSave.ok) {
      markApplicantState(applicant, { verifiedBeforeSave: false });
      recordVerificationFailure(result, "clientDetails", name, "Applicant failed before-save verification; not moving to next applicant as saved", {
        rowIndex: index,
        failures: beforeSave.failures
      });
      advanceAutomationProgress(`Client Details failed before save: ${name || `Applicant ${index + 1}`}`);
      continue;
    }
    markApplicantState(applicant, { verifiedBeforeSave: true });
    const saved = await saveClientDetailsAndVerify(applicant, result, index);
    markApplicantState(applicant, { saved, verifiedAfterSave: saved });
    advanceAutomationProgress(saved ? `Client Details saved and verified: ${name || `Applicant ${index + 1}`}` : `Client Details save failed: ${name || `Applicant ${index + 1}`}`);
    await sleep(500);
  }

  const incomplete = applicants
    .filter(hasApplicantName)
    .map((applicant) => automationRunState.clientDetails.applicants[fullApplicantName(applicant)])
    .filter((state) => !state?.visited || !state?.filled || !state?.verifiedBeforeSave || !state?.saved || !state?.verifiedAfterSave);
  if (incomplete.length) {
    recordVerificationFailure(result, "clientDetails", "All Applicants", "Not all applicants were visited, saved, and verified. Financials will not start.", {
      expected: applicants.map(fullApplicantName).join(", "),
      actual: applicantRunSummary()
    });
    return false;
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
    throwIfAutomationStopped();
    const sourceIndex = workflow.rowIndexes?.[index] ?? index;
    setAutomationProgress(index, workflow.rowCount, `${workflow.sectionId}: row ${index + 1}/${workflow.rowCount}`);
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
    advanceAutomationProgress(`${workflow.sectionId}: saved row ${index + 1}/${workflow.rowCount}`);
    await sleep(350);
  }
}

async function runFinancialsWorkflow(payload, mapping, apiBase, result) {
  ensureResultShape(result);
  if (!isInfinityFinancialsPage()) return false;
  const rows = buildHemExpenseRows(hemMonthlyAmount(payload), payload);
  if (!isHemConfirmed(payload)) {
    recordError(result, "financialsExpense", "Monthly Expenses", "HEM / living expense breakdown is not confirmed. Confirm HEM in EasyFlow AI, prepare again, then run Financials.");
    return true;
  }
  if (!rows.length) {
    recordError(result, "financialsExpense", "Monthly Expenses", "No prepared expense rows found at payload.infinity.financials.expenses. Financials stopped to avoid creating wrong HEM rows.");
    return true;
  }
  setAutomationProgress(0, rows.length, `Financials: ${rows.length} monthly expense rows`);
  for (const [index, row] of rows.entries()) {
    throwIfAutomationStopped();
    setAutomationProgress(index, rows.length, `Financials: ${row.type} ${index + 1}/${rows.length}`);
    await upsertExpenseRow(row, payload, result);
    advanceAutomationProgress(`Financials saved/reviewed: ${row.type}`);
  }
  const expectedTotal = rows.reduce((sum, row) => sum + normalizeMoneyValue(row.amount), 0);
  const actualTotal = readSectionTotal("Monthly Expenses");
  if (expectedTotal && Number(expectedTotal) !== Number(actualTotal)) {
    recordVerificationFailure(result, "financialsExpense", "Monthly Expenses Total", "Monthly Expenses total does not match prepared payload rows", {
      expected: expectedTotal,
      actual: actualTotal
    });
    return false;
  } else if (expectedTotal) {
    result.actions.push({ action: "verify-expense-total", section: "financialsExpense", expected: expectedTotal, actual: actualTotal });
  }
  return saveFinancialsPageAndVerify(rows, result);
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

function isLoansProductsArea() {
  return isInfinityLoansSummaryPage() || isInfinitySocaPage() || pageHasAnyText(["Loans & Products", "Create Application", "Best Interest Duty"]);
}

function isNeedsAnalysisVisible() {
  return pageHasAnyText(["Needs Analysis", "Loan Requirements", "Loan Objectives", "Select Applicant"]);
}

async function fillNeedsAnalysisField(field, payload, result) {
  const value = fieldValue(payload, field);
  if (value === undefined || value === null || value === "") {
    if (!field.optional) recordFieldSkipped(result, "needsAnalysis", field.label, "payload value missing");
    return false;
  }
  const meta = { section: "needsAnalysis", payloadPath: field.payloadPath };
  if (typeof value === "boolean") {
    if (!value) {
      result.actions.push({ action: "skip-false-checkbox", section: "needsAnalysis", label: field.label });
      return true;
    }
    return clickCheckboxByLabel(field.label, result, meta);
  }
  if (field.dateFormat === "au" || /date/i.test(field.label)) {
    return fillDateByLabel(field.label, value, document, result, meta);
  }
  if (isChoiceValue(value) || /method|frequency|type|status/i.test(field.label)) {
    const selected = await selectDropdownByText(field.label, value, document, result, meta);
    if (selected) return true;
  }
  return fillInputByLabel(field.label, value, document, result, meta);
}

async function fillNeedsAnalysis(payload, mapping, result) {
  await selectNeedsAnalysisApplicants(payload, result);
  const section = mapping.sections.find((item) => item.id === "needsAnalysis");
  if (!section) {
    recordFieldSkipped(result, "needsAnalysis", "Needs Analysis", "mapping section not found");
    return false;
  }
  let filledCount = 0;
  for (const [index, field] of section.fields.entries()) {
    throwIfAutomationStopped();
    setAutomationProgress(index, section.fields.length, `Needs Analysis: ${field.label}`);
    await scrollToText(fieldLabels(field));
    const ok = await fillNeedsAnalysisField(field, payload, result);
    if (ok) filledCount += 1;
    await sleep(90);
  }
  result.actions.push({ action: "fill-needs-analysis", section: "needsAnalysis", filled: filledCount });
  return filledCount > 0;
}

async function runLoansProductsWorkflow(payload, mapping, apiBase, result) {
  ensureResultShape(result);
  if (!isLoansProductsArea()) return false;
  setAutomationProgress(0, 5, "Loans & Products: opening Needs Analysis");

  if (isInfinityLoansSummaryPage() || pageHasAnyText(["Create Application"])) {
    throwIfAutomationStopped();
    await ensureBestInterestDutyApplication(result);
    await waitForAngularSettle();
  }

  if (!isNeedsAnalysisVisible()) {
    throwIfAutomationStopped();
    const opened = await clickSubTab("Needs Analysis", result);
    if (opened) await waitFor(() => isNeedsAnalysisVisible(), { timeout: 5000, interval: 150 });
  }

  if (!isNeedsAnalysisVisible()) {
    recordFieldSkipped(result, "loansProducts", "Needs Analysis", "Needs Analysis UI not visible after create/open application");
    return true;
  }

  const filled = await fillNeedsAnalysis(payload, mapping, result);
  if (!filled) {
    recordVerificationFailure(result, "needsAnalysis", "Needs Analysis", "No Needs Analysis fields were filled");
    return true;
  }

  const saved = await clickPageSaveIfVisible();
  result.actions.push({ action: saved ? "save-needs-analysis" : "review-needs-analysis", section: "needsAnalysis" });
  const next = await clickPageNextIfVisible();
  result.actions.push({
    action: next ? "next-after-needs-analysis" : "stop-after-needs-analysis",
    section: "needsAnalysis",
    label: next ? "Stopped before broker lender selection / later SOCA tabs" : "No next button visible"
  });
  return true;
}

async function runWorkflow({ payload, mapping, apiBase, preserveProgress = false }) {
  if (!preserveProgress) {
    resetAutomationRun(100);
    configureAutomationSegment(0, 100);
  }
  const result = ensureResultShape({ sectionId: "workflow", fieldsFilled: [], fieldsSkipped: [], errors: [], actions: [], verificationFailures: [] });

  try {
    const onClientDetails = isClientDetailsPage();
    const onFinancials = isInfinityFinancialsPage();
    const onLoansProducts = isLoansProductsArea();
    const clientDetailsHandled = onClientDetails ? await runClientDetailsWorkflow(payload, mapping, apiBase, result) : false;
    const financialsHandled = !onClientDetails && onFinancials ? await runFinancialsWorkflow(payload, mapping, apiBase, result) : false;
    const loansProductsHandled = !onClientDetails && !onFinancials && onLoansProducts ? await runLoansProductsWorkflow(payload, mapping, apiBase, result) : false;

    if (!onClientDetails && !onFinancials && !onLoansProducts && !clientDetailsHandled && !financialsHandled && !loansProductsHandled) {
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

    for (const workflow of onClientDetails || onFinancials || onLoansProducts || clientDetailsHandled || financialsHandled || loansProductsHandled ? [] : supportedPopupWorkflows(payload)) {
      await runPopupWorkflow(workflow, payload, mapping, apiBase, result);
    }
  } catch (error) {
    if (/stopped by user/i.test(error.message || "")) {
      result.actions.push({ action: "stop-run", section: "workflow", message: error.message });
      showAutomationStatus("EasyFlow AI stopped.", "error", { keepProgress: true, final: true, autoHideMs: 10000 });
    } else {
      throw error;
    }
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

function sectionIssueCount(result, sectionPrefix) {
  const starts = (value) => normalize(value || "").startsWith(normalize(sectionPrefix));
  return [
    ...(result.errors || []),
    ...(result.verificationFailures || [])
  ].filter((item) => starts(item.section)).length;
}

function seriousIssueCount(result) {
  return (result.errors || []).length + (result.verificationFailures || []).length;
}

async function openInfinityStep(step, isAlreadyVisible, result, pageIndex, totalSteps) {
  configureAutomationSegment((pageIndex / totalSteps) * 100, 100 / totalSteps);
  setAutomationProgress(0, 1, `Opening ${step.labels[0]}...`);
  if (isAlreadyVisible()) {
    result.pages.push({ id: step.id, labels: step.labels, navigated: true, alreadyVisible: true });
    return true;
  }
  const navigated = await navigateToPage(step);
  result.pages.push({ id: step.id, labels: step.labels, navigated });
  if (!navigated) {
    result.fieldsSkipped.push({ section: step.id, label: step.labels[0], reason: "page navigation link not visible", visibleActions: collectVisibleButtonsAndLinks() });
  }
  return navigated;
}

async function runInfinityTransactionPages({ payload, mapping, apiBase, result }) {
  const steps = [
    { id: "clientDetails", labels: ["Client Details"], isVisible: isClientDetailsPage, run: runClientDetailsWorkflow, blockedAt: "Client Details" },
    { id: "financials", labels: ["Financials"], isVisible: isInfinityFinancialsPage, run: runFinancialsWorkflow, blockedAt: "Financials" },
    { id: "loansProducts", labels: ["Loans & Products", "Loans and Products"], isVisible: isLoansProductsArea, run: runLoansProductsWorkflow, blockedAt: "Loans & Products" }
  ];

  for (const [index, step] of steps.entries()) {
    throwIfAutomationStopped();
    const opened = await openInfinityStep(step, step.isVisible, result, index, steps.length);
    if (!opened) {
      result.status = "partial_failed";
      result.blockedAt = step.blockedAt;
      result.message = `${step.blockedAt} was not opened; later tabs were not started.`;
      return result;
    }
    const beforeIssues = seriousIssueCount(result);
    const ok = await step.run(payload, mapping, apiBase, result);
    const afterIssues = seriousIssueCount(result);
    if (!ok || afterIssues > beforeIssues) {
      result.status = "partial_failed";
      result.blockedAt = step.blockedAt;
      result.message = `${step.blockedAt} failed save/verification gate. Later tabs were not started.`;
      showAutomationStatus(`${result.message}`, "error", { final: true, autoHideMs: 10000 });
      return result;
    }
    setAutomationProgress(1, 1, `Completed ${step.labels[0]}`);
  }

  result.status = "success";
  return result;
}

async function runAllPages({ payload, mapping, apiBase }) {
  const platform = detectPlatform();
  const plan = navigationPlans[platform] || [];
  const result = ensureResultShape({ sectionId: "all-pages", fieldsFilled: [], fieldsSkipped: [], errors: [], actions: [], verificationFailures: [], pages: [], platform });
  resetAutomationRun(100);

  if (!plan.length) {
    result.errors.push({ message: "Could not detect Infinity or AOL page. Open a case page first." });
    return result;
  }

  if (platform === "infinity") {
    await runInfinityTransactionPages({ payload, mapping, apiBase, result });
    await logAutofill(apiBase, payload, result);
    const issueCount = result.errors.length + result.fieldsSkipped.length + result.verificationFailures.length;
    showAutomationStatus(
      issueCount
        ? `${result.message || `EasyFlow AI stopped with ${issueCount} item(s) to review.`}`
        : "EasyFlow AI finished. Review before Push AOL or Submit.",
      issueCount ? "error" : "success",
      { final: true, progress: issueCount ? undefined : 100, autoHideMs: 10000 }
    );
    return result;
  }

  try {
    for (const [pageIndex, step] of plan.entries()) {
      throwIfAutomationStopped();
      const pageSpan = 100 / Math.max(1, plan.length);
      configureAutomationSegment(pageIndex * pageSpan, pageSpan);
      setAutomationProgress(0, 1, `Opening ${step.labels[0]}...`);
      const navigated = await navigateToPage(step);
      result.pages.push({ id: step.id, labels: step.labels, navigated });
      if (!navigated) {
        result.fieldsSkipped.push({ section: step.id, label: step.labels[0], reason: "page navigation link not visible" });
        continue;
      }

      const pageResult = await runWorkflow({ payload, mapping, apiBase, preserveProgress: true });
      mergeAutofillResult(result, pageResult);

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
      setAutomationProgress(1, 1, `Completed ${step.labels[0]}`);
    }
  } catch (error) {
    if (/stopped by user/i.test(error.message || "")) {
      result.actions.push({ action: "stop-run", section: "all-pages", message: error.message });
      showAutomationStatus("EasyFlow AI stopped.", "error", { keepProgress: true, final: true, autoHideMs: 10000 });
    } else {
      throw error;
    }
  }

  await logAutofill(apiBase, payload, result);
  const issueCount = result.errors.length + result.fieldsSkipped.length + result.verificationFailures.length;
  showAutomationStatus(
    issueCount
      ? `EasyFlow AI finished with ${issueCount} item(s) to review.`
      : "EasyFlow AI finished. Review before Push AOL or Submit.",
    issueCount ? "error" : "success",
    { final: true, progress: 100, autoHideMs: 10000 }
  );
  return result;
}

function diagnosticSummary(checks = []) {
  const summary = checks.reduce(
    (acc, check) => {
      acc[check.status] = (acc[check.status] || 0) + 1;
      return acc;
    },
    { pass: 0, warn: 0, fail: 0 }
  );
  summary.ok = !summary.fail;
  return summary;
}

function addDiagnosticCheck(result, status, section, label, message, details = {}) {
  result.checks.push({ status, section, label, message, details });
}

function readFieldByExactLabel(label, scope = document) {
  const found = findExactByLabelText(label, "", scope) || findByLabelText([label], "", scope);
  return found?.element ? readFieldValue(found.element) : "";
}

async function diagnoseClientDetails(payload, result) {
  const applicants = infinityApplicantRows(payload);
  addDiagnosticCheck(
    result,
    applicants.length ? "pass" : "fail",
    "payload",
    "Infinity applicants",
    applicants.length ? `${applicants.length} applicant(s) in payload.infinity.applicants` : "No applicants found in payload.infinity.applicants",
    { applicants: applicants.map(fullApplicantName) }
  );

  if (!isClientDetailsPage()) return;
  addDiagnosticCheck(result, "pass", "clientDetails", "Page detected", "Client Details page is visible");

  for (const [index, applicant] of applicants.entries()) {
    const name = fullApplicantName(applicant);
    const activation = await activateInfinityApplicantTab(applicant, result, index);
    addDiagnosticCheck(
      result,
      activation.ok ? "pass" : hasApplicantName(applicant) ? "fail" : "warn",
      "clientDetails",
      `Applicant tab ${index + 1}: ${name}`,
      activation.ok
        ? "Applicant tab activates and visible form matches payload name"
        : "Applicant tab did not activate or visible form does not match payload. Autofill must stop before filling this applicant.",
      activation
    );
    if (!activation.ok) continue;

    for (const label of ["Current Address", "Previous Address", "Post Settlement Address", "Mailing Address"]) {
      const edit = findEditButtonForAddress(label);
      addDiagnosticCheck(
        result,
        edit ? "pass" : label === "Current Address" ? "fail" : "warn",
        "clientDetails",
        `${name} ${label} Edit`,
        edit ? "Edit button found for this address row" : "Address Edit button not found/visible",
        { applicant: name, addressLabel: label }
      );
    }
  }
}

async function diagnoseFinancials(payload, result) {
  const rows = buildHemExpenseRows(hemMonthlyAmount(payload), payload);
  const hemConfirmed = isHemConfirmed(payload);
  addDiagnosticCheck(
    result,
    hemConfirmed ? "pass" : "fail",
    "financials",
    "HEM confirmed",
    hemConfirmed ? "HEM is confirmed in prepared payload" : "HEM is not confirmed; Financials autofill will stop",
    { hemMonthly: hemMonthlyAmount(payload) }
  );
  addDiagnosticCheck(
    result,
    rows.length ? "pass" : "fail",
    "financials",
    "Prepared monthly expense rows",
    rows.length ? `${rows.length} rows found at payload.infinity.financials.expenses` : "No rows found at payload.infinity.financials.expenses",
    { rows: rows.map((row) => ({ type: row.type, amount: row.amount, candidates: row.infinityTypeCandidates })) }
  );

  if (!isInfinityFinancialsPage()) return;
  addDiagnosticCheck(result, "pass", "financials", "Page detected", "Financials page is visible");
  await scrollToText(["Monthly Expenses", "Add Expense"]);
  const addButton = findClickableByText(["Add Expense", "+ Add Expense"]);
  addDiagnosticCheck(
    result,
    addButton ? "pass" : "fail",
    "financials",
    "Add Expense button",
    addButton ? "Add Expense button found" : "Add Expense button not visible on Financials page"
  );

  if (!addButton) return;
  const modal = await clickAndWaitForModal(addButton);
  addDiagnosticCheck(
    result,
    modal ? "pass" : "fail",
    "financials",
    "Expense modal",
    modal ? "Expense modal opens" : "Expense modal did not open after clicking Add Expense"
  );
  if (!modal) return;

  const typeControl = findDropdownControlByLabels(["Expense Type", "Type", "Expense"], modal);
  const amountField = findExactByLabelText("Expense Amount", "", modal) || findByLabelText(["Expense Amount", "Amount"], "", modal);
  const frequencyControl = findDropdownControlByLabels(["Expense Frequency", "Frequency"], modal);
  addDiagnosticCheck(result, typeControl ? "pass" : "fail", "financials", "Expense Type control", typeControl ? "Expense Type dropdown found in modal" : "Expense Type dropdown not found in modal");
  addDiagnosticCheck(result, amountField ? "pass" : "fail", "financials", "Expense Amount field", amountField ? "Expense Amount field found in modal" : "Expense Amount field not found in modal");
  addDiagnosticCheck(result, frequencyControl ? "pass" : "warn", "financials", "Expense Frequency control", frequencyControl ? "Expense Frequency dropdown found in modal" : "Expense Frequency dropdown not found in modal");

  await closeActiveModalWithoutSaving();
}

async function diagnoseLoansProducts(payload, result) {
  if (!isLoansProductsArea()) return;
  addDiagnosticCheck(result, "pass", "loansProducts", "Page detected", "Loans & Products area is visible");
  addDiagnosticCheck(
    result,
    findClickableByText(["Create Application"]) || pageHasAnyText(["Needs Analysis", "Best Interest Duty"]) ? "pass" : "warn",
    "loansProducts",
    "Create/Needs Analysis",
    "Checked for Create Application or Needs Analysis entry points",
    { hasNeedsAnalysis: isNeedsAnalysisVisible(), hasCreateApplication: Boolean(findClickableByText(["Create Application"])), visibleActions: collectVisibleButtonsAndLinks() }
  );
}

async function runDiagnostics({ payload }) {
  const result = {
    sectionId: "diagnostics",
    url: location.href,
    platform: detectPlatform(),
    checks: [],
    errors: [],
    actions: [],
    fieldsFilled: [],
    fieldsSkipped: [],
    verificationFailures: []
  };
  try {
    showAutomationStatus("EasyFlow AI test running. No fields will be saved.", "running", { progress: 5 });
    addDiagnosticCheck(result, detectPlatform() !== "unknown" ? "pass" : "fail", "page", "Platform", `Detected platform: ${detectPlatform()}`, { url: location.href });
    await diagnoseClientDetails(payload, result);
    await diagnoseFinancials(payload, result);
    await diagnoseLoansProducts(payload, result);
  } catch (error) {
    result.errors.push({ message: error.message, stack: error.stack });
    addDiagnosticCheck(result, "fail", "diagnostics", "Runtime error", error.message);
  } finally {
    result.summary = diagnosticSummary(result.checks);
    showAutomationStatus(
      result.summary.ok
        ? `EasyFlow AI test passed: ${result.summary.pass} checks.`
        : `EasyFlow AI test found ${result.summary.fail} fail / ${result.summary.warn} warn.`,
      result.summary.ok ? "success" : "error",
      { progress: 100, final: true, autoHideMs: 10000 }
    );
  }
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
      .catch((error) => sendResponse({ sectionId: null, fieldsFilled: [], fieldsSkipped: [], errors: [{ message: error.message }], actions: [], verificationFailures: [] }));
    return true;
  }

  if (message.type === "INFINITY_AOL_RUN_WORKFLOW") {
    runWorkflow(message)
      .then(sendResponse)
      .catch((error) =>
        sendResponse({ sectionId: "workflow", fieldsFilled: [], fieldsSkipped: [], errors: [{ message: error.message }], actions: [], verificationFailures: [] })
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
          verificationFailures: [],
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

  if (message.type === "INFINITY_AOL_RUN_DIAGNOSTICS") {
    runDiagnostics(message)
      .then(sendResponse)
      .catch((error) =>
        sendResponse({
          sectionId: "diagnostics",
          url: location.href,
          platform: detectPlatform(),
          checks: [{ status: "fail", section: "diagnostics", label: "Runtime error", message: error.message }],
          summary: { ok: false, pass: 0, warn: 0, fail: 1 },
          errors: [{ message: error.message, stack: error.stack }]
        })
      );
    return true;
  }

  return false;
});
