/* EasyFlow AI Infinity workflow v4.
   Purpose: dedicated workflows only. No generic autofill for Infinity sections.
   Exposes no globals except the Chrome message listener state in this IIFE. */
(function () {
  "use strict";

  if (window.EF_INFINITY_WORKFLOW_V4) return;
  window.EF_INFINITY_WORKFLOW_V4 = true;

  var running = false;
  var stopRequested = false;
  var lastReport = null;
  var aolActivePayload = null;
  // Context for writing captured data back to EasyFlow AI from in-page broker actions
  // (set from the popup message: apiBase + caseId; scenarios filled during the Infinity run).
  var brokerCtx = { apiBase: "", caseId: "", scenarios: [], pageKey: "", extToken: "" };
  // Headers for WRITE (POST) calls — includes the optional shared-secret token if the popup passed one.
  // (Server only enforces it when EASYFLOW_EXT_SECRET is set; harmless otherwise.)
  function efWriteHeaders() {
    var h = { "Content-Type": "application/json" };
    if (brokerCtx.extToken) h["x-easyflow-ext-token"] = brokerCtx.extToken;
    return h;
  }
  // A stable signature of the document the bot is working on (AOL doc id / Infinity ca/soa_id, else path).
  // Auto capture-back only fires when the CURRENT page still matches the page Start was run on — so a
  // broker who switches cases in the same SPA tab never has edits mis-filed to the previous case.
  function efPageKey() {
    var u = location.href;
    var m = u.match(/[?&#]id=([^&]+)/i) || u.match(/[?&]ca=([^&]+)/i) || u.match(/[?&#]soa_id=([^&]+)/i);
    return location.host + "|" + (m ? m[1] : location.pathname);
  }
  function efPostCapture(captureKey, data, platform) {
    try {
      if (!brokerCtx.apiBase || !brokerCtx.caseId) return Promise.resolve(false);
      return fetch(brokerCtx.apiBase + "/api/cases/" + encodeURIComponent(brokerCtx.caseId) + "/capture", {
        method: "POST",
        headers: efWriteHeaders(),
        body: JSON.stringify({ key: captureKey, data: data, platform: platform || "infinity" })
      }).then(function (r) { return r.ok; }).catch(function () { return false; });
    } catch (e) { return Promise.resolve(false); }
  }
  // Read a per-case capture back (e.g. the manual-checklist done states) so the panel can restore them.
  function efGetCapture(captureKey) {
    try {
      if (!brokerCtx.apiBase || !brokerCtx.caseId) return Promise.resolve(null);
      return fetch(brokerCtx.apiBase + "/api/cases/" + encodeURIComponent(brokerCtx.caseId) + "/capture/" + encodeURIComponent(captureKey))
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (j) { return j ? j.data : null; })
        .catch(function () { return null; });
    } catch (e) { return Promise.resolve(null); }
  }
  // Per-lender SELF-LEARNING AOL template (Compliance R&O reasons). Each lender's form differs, so the
  // bot reads the lender's stored template before filling and writes back whatever it recognises.
  function efGetTemplate(lender) {
    try {
      if (!brokerCtx.apiBase || !lender) return Promise.resolve(null);
      return fetch(brokerCtx.apiBase + "/api/aol-templates/" + encodeURIComponent(lender))
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (j) { return (j && j.template) || null; })
        .catch(function () { return null; });
    } catch (e) { return Promise.resolve(null); }
  }
  function efSaveTemplate(lender, template) {
    try {
      if (!brokerCtx.apiBase || !lender) return Promise.resolve(false);
      return fetch(brokerCtx.apiBase + "/api/aol-templates/" + encodeURIComponent(lender), {
        method: "POST", headers: efWriteHeaders(), body: JSON.stringify(template)
      }).then(function (r) { return r.ok; }).catch(function () { return false; });
    } catch (e) { return Promise.resolve(false); }
  }
  // Lender code from the AOL ApplyOnline ID, e.g. "I-ANZ-11305495-LKT" → "ANZ", "I-ING-…" → "ING".
  function detectAolLenderCode() {
    var m = (document.body.innerText || "").match(/I-([A-Z]{2,6})-\d{3,}/);
    if (m) return m[1].toUpperCase();
    var head = norm(document.body.innerText).slice(0, 400);
    var known = ["ANZ", "ING", "NAB", "CBA", "Westpac", "Macquarie", "Pepper", "Bankwest", "Suncorp", "St George", "AMP", "BankSA", "Bendigo", "Adelaide Bank"];
    for (var i = 0; i < known.length; i += 1) { if (new RegExp(known[i].replace(/\s/g, "\\s*"), "i").test(head)) return known[i].toUpperCase().replace(/\s/g, ""); }
    return "DEFAULT";
  }
  // Phrases of currently-CHECKED reason checkboxes (excludes risk declarations + "Other") — used to
  // learn the lender's reason wording from whatever the broker has already ticked.
  function scrapeCheckedReasonPhrases() {
    return allRaw("input[type=checkbox]").filter(function (c) {
      if (!c.checked) return false;
      var lab = (c.id && document.querySelector('label[for="' + c.id + '"]')) || c.closest("label");
      if (!lab || lab.getBoundingClientRect().width <= 0) return false;
      var t = norm(textOf(lab));
      if (!t || t.length < 5 || t.length > 130) return false;
      if (/^yes$/i.test(t) || /understood the risks|have been explained|ensured (that )?each applicant/i.test(t)) return false;
      if (/^other\b|please provide details/i.test(t)) return false;
      return true;
    }).map(function (c) {
      var lab = (c.id && document.querySelector('label[for="' + c.id + '"]')) || c.closest("label");
      return norm(textOf(lab)).toLowerCase();
    });
  }

  var STEP_IDS = ["clientDetails", "financials", "loansProducts"];
  var STEP_LABELS = {
    clientDetails: "Step 1: Client Details",
    financials: "Step 2: Financials",
    loansProducts: "Step 3: Loans & Products"
  };

  function sleep(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
  }

  function norm(value) {
    return String(value == null ? "" : value).replace(/\s+/g, " ").trim();
  }

  function key(value) {
    return norm(value).toLowerCase().replace(/[^a-z0-9]+/g, "");
  }

  function isVisible(el) {
    if (!el) return false;
    var style = window.getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) return false;
    var rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function textOf(el) {
    return norm(el && (el.innerText || el.textContent || el.value || ""));
  }

  function all(selector, root) {
    return Array.prototype.slice.call((root || document).querySelectorAll(selector)).filter(isVisible);
  }
  // Styled AOL checkboxes/radios have a HIDDEN native <input> (the visible part is a .checkbox-box span),
  // so `all()`'s isVisible filter drops them. Use this raw query for checkbox/radio logic and judge
  // visibility by the LABEL instead. (This was the real cause of "0 ticked / report rendered 0".)
  function allRaw(selector, root) {
    return Array.prototype.slice.call((root || document).querySelectorAll(selector));
  }

  function first(selector, root) {
    var list = all(selector, root);
    return list.length ? list[0] : null;
  }

  function fire(el, type) {
    if (!el) return;
    el.dispatchEvent(new Event(type, { bubbles: true }));
  }

  function setNativeValue(el, value) {
    if (!el) return false;
    var stringValue = value == null ? "" : String(value);
    var proto = el.tagName === "TEXTAREA" ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
    var desc = Object.getOwnPropertyDescriptor(proto, "value");
    if (desc && desc.set) desc.set.call(el, stringValue);
    else el.value = stringValue;
    fire(el, "input");
    fire(el, "change");
    return true;
  }

  function clickOnce(el) {
    if (!el || !isVisible(el)) return false;
    el.scrollIntoView({ block: "center", inline: "center" });
    el.click();
    return true;
  }

  function addIssue(result, section, field, message) {
    result.issues.push({ section: section, field: field, message: message });
    result.verificationFailures.push({ section: section, label: field, field: field, message: message });
  }

  function addAction(result, label) {
    result.actions.push(label);
  }

  function addFilled(result, label) {
    result.fieldsFilled.push(label);
  }

  function addSkipped(result, label, reason) {
    result.fieldsSkipped.push(label + (reason ? ": " + reason : ""));
  }

  function waitFor(fn, timeoutMs, intervalMs) {
    var started = Date.now();
    var timeout = timeoutMs || 8000;
    var interval = intervalMs || 100;
    return new Promise(function (resolve) {
      (function tick() {
        var value = null;
        try { value = fn(); } catch (err) { value = null; }
        if (value) return resolve(value);
        if (Date.now() - started >= timeout) return resolve(null);
        setTimeout(tick, interval);
      })();
    });
  }
  // Wait until the DOM stops changing (the page/tab has finished rendering) instead of a fixed sleep —
  // resolves as soon as it's been quiet for quietMs (fast on a good network), capped at maxMs (patient
  // on a slow one). Event-based: proceeds when the new tab actually appears, not after N seconds.
  function waitForSettle(maxMs, quietMs) {
    maxMs = maxMs || 8000; quietMs = quietMs || 400;
    return new Promise(function (resolve) {
      var last = Date.now(), start = Date.now(), obs = null;
      function done() { try { obs && obs.disconnect(); } catch (e) { /* ignore */ } resolve(); }
      try {
        obs = new MutationObserver(function () { last = Date.now(); });
        obs.observe(document.body, { childList: true, subtree: true });
      } catch (e) { return setTimeout(resolve, 1000); }
      (function check() {
        var now = Date.now();
        if (now - last >= quietMs || now - start >= maxMs) return done();
        setTimeout(check, 120);
      })();
    });
  }
  // Navigate-and-wait: after changing the hash, wait for the hash to reflect the route AND the DOM to
  // settle (+ optional readyFn for a specific element). Replaces fixed post-navigation sleeps.
  async function waitForRoute(routePart, readyFn, maxMs) {
    maxMs = maxMs || 8000;
    if (routePart) await waitFor(function () { return location.hash.indexOf(routePart) >= 0; }, maxMs, 80);
    await waitForSettle(maxMs, 420);
    if (readyFn) await waitFor(readyFn, maxMs, 120);
  }

  function makeResult(payload) {
    return {
      ok: false,
      target: "infinity",
      caseId: findFirstString(payload, ["caseId", "id", "reference", "externalReference"]) || "",
      startedAt: new Date().toISOString(),
      fieldsFilled: [],
      fieldsSkipped: [],
      errors: [],
      actions: [],
      verificationFailures: [],
      issues: [],
      loanFormMismatches: [],
      steps: STEP_IDS.map(function (id) {
        return { id: id, label: STEP_LABELS[id], status: "pending" };
      })
    };
  }

  function step(result, id, status) {
    result.steps.forEach(function (item) {
      if (item.id === id) item.status = status;
    });
    showStatus(result, STEP_LABELS[id] || id, status);
  }

  function showStatus(result, label, status) {
    var panel = document.getElementById("ef-v4-status");
    if (!panel) {
      panel = document.createElement("div");
      panel.id = "ef-v4-status";
      panel.style.cssText = [
        "position:fixed",
        "top:92px",
        "right:18px",
        "z-index:2147483647",
        "width:340px",
        "max-width:calc(100vw - 36px)",
        "background:#0f2d21",
        "color:#fff",
        "border-radius:8px",
        "box-shadow:0 14px 40px rgba(0,0,0,.28)",
        "font:13px/1.35 Arial,sans-serif",
        "padding:12px"
      ].join(";");
      document.documentElement.appendChild(panel);
    }

    var complete = result.steps.filter(function (s) { return s.status === "done"; }).length;
    var active = result.steps.filter(function (s) { return s.status === "running"; }).length;
    var failed = result.steps.filter(function (s) { return s.status === "failed"; }).length;
    var percent = Math.round(((complete + (active ? 0.5 : 0)) / result.steps.length) * 100);
    if (failed) percent = Math.max(percent, 33);

    panel.innerHTML = ""
      + "<div style=\"display:flex;align-items:center;gap:8px;margin-bottom:8px\">"
      + "<strong style=\"flex:1\">" + escapeHtml(label || "EasyFlow AI") + "</strong>"
      + "<button id=\"ef-v4-stop\" style=\"border:1px solid rgba(255,255,255,.45);background:transparent;color:#fff;border-radius:5px;padding:4px 8px;cursor:pointer\">Stop</button>"
      + "<button id=\"ef-v4-hide\" style=\"border:1px solid rgba(255,255,255,.45);background:transparent;color:#fff;border-radius:5px;padding:4px 8px;cursor:pointer\">Hide</button>"
      + "</div>"
      + "<div style=\"height:8px;background:rgba(255,255,255,.2);border-radius:999px;overflow:hidden\"><div style=\"width:" + percent + "%;height:100%;background:#8ee6b0\"></div></div>"
      + "<div style=\"margin:7px 0 8px\">" + percent + "% complete</div>"
      + result.steps.map(function (s) {
        return "<div style=\"border-top:1px solid rgba(255,255,255,.14);padding:5px 0\">"
          + escapeHtml(s.label) + " - " + escapeHtml(s.status)
          + "</div>";
      }).join("")
      + (result.issues.length ? "<div style=\"margin-top:8px;background:#fff1f1;color:#8a1111;border-radius:6px;padding:8px\">"
          + "<div style=\"font-weight:700;margin-bottom:4px\">Issues: " + result.issues.length + "</div>"
          + result.issues.slice(0, 10).map(function (it) {
              return "<div style=\"border-top:1px solid rgba(138,17,17,.18);padding:4px 0\">"
                + escapeHtml((it.section || "") + (it.field ? " · " + it.field : "")) + ": <strong>" + escapeHtml(it.message || "") + "</strong>"
                + "</div>";
            }).join("")
          + "</div>" : "")
      + (result.loanFormMismatches && result.loanFormMismatches.length ? "<div style=\"margin-top:8px;background:#fffbeb;color:#92400e;border:1px solid #fcd34d;border-radius:6px;padding:8px\">"
          + "<div style=\"font-weight:700;margin-bottom:4px\">⚠️ Loan Form note (saved to history)</div>"
          + result.loanFormMismatches.slice(0, 8).map(function (m) {
              return "<div style=\"border-top:1px solid rgba(146,64,14,.18);padding:4px 0\">"
                + escapeHtml(m.field) + " — Loan Form: <strong>" + escapeHtml(m.loanForm || "") + "</strong> <span style=\"opacity:.75\">(differs in Infinity)</span>"
                + "</div>";
            }).join("")
          + "</div>" : "");

    var stop = document.getElementById("ef-v4-stop");
    var hide = document.getElementById("ef-v4-hide");
    if (stop) stop.onclick = function () { stopRequested = true; };
    if (hide) hide.onclick = function () { panel.remove(); };
  }

  function finishStatus(result, message) {
    showStatus(result, message || (result.ok ? "EasyFlow AI complete" : "EasyFlow AI needs review"), result.ok ? "done" : "failed");
    setTimeout(function () {
      var panel = document.getElementById("ef-v4-status");
      var hasNote = result.loanFormMismatches && result.loanFormMismatches.length;
      if (panel && result.ok && !hasNote) panel.remove();
    }, 10000);
  }

  function escapeHtml(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function getByPath(obj, path) {
    var cur = obj;
    for (var i = 0; i < path.length; i += 1) {
      if (!cur || typeof cur !== "object") return undefined;
      cur = cur[path[i]];
    }
    return cur;
  }

  function findFirstString(obj, names) {
    var found = "";
    function walk(value) {
      if (found || !value || typeof value !== "object") return;
      Object.keys(value).some(function (k) {
        var v = value[k];
        if (names.indexOf(k) >= 0 && typeof v === "string" && norm(v)) {
          found = norm(v);
          return true;
        }
        if (v && typeof v === "object") walk(v);
        return Boolean(found);
      });
    }
    walk(obj);
    return found;
  }

  function asArray(value) {
    if (!value) return [];
    return Array.isArray(value) ? value : [value];
  }

  function objectAtPath(obj, path) {
    var value = getByPath(obj, path);
    return value && typeof value === "object" ? value : null;
  }

  function payloadRoots(payload) {
    var roots = [];
    var seen = [];
    function addRoot(root) {
      if (!root || typeof root !== "object" || seen.indexOf(root) >= 0) return;
      seen.push(root);
      roots.push(root);
    }

    addRoot(payload);
    [
      ["payload"],
      ["payload", "payload"],
      ["data"],
      ["data", "payload"],
      ["case"],
      ["case", "payload"],
      ["caseData"],
      ["caseData", "payload"],
      ["clientDetails"],
      ["clientDetails", "payload"],
      ["loanForm"],
      ["loanForm", "payload"],
      ["form"],
      ["form", "payload"],
      ["intake"],
      ["intake", "payload"],
      ["clientCall"],
      ["clientCall", "payload"],
      ["brokerIntake"],
      ["brokerIntake", "payload"],
      ["prepared"],
      ["prepared", "payload"]
    ].forEach(function (path) {
      addRoot(objectAtPath(payload, path));
    });

    return roots;
  }

  function firstValue(source, names) {
    for (var i = 0; i < names.length; i += 1) {
      var name = names[i];
      if (source && source[name] != null && norm(source[name])) return source[name];
    }
    return "";
  }

  function dateValue(value) {
    var s = norm(value);
    if (!s) return "";
    var m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
    if (m) return pad2(m[1]) + "/" + pad2(m[2]) + "/" + m[3];
    m = s.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})$/);
    if (m) return pad2(m[3]) + "/" + pad2(m[2]) + "/" + m[1];
    return "";
  }

  function pad2(value) {
    return String(value).padStart(2, "0");
  }

  function isDateLike(value) {
    return Boolean(dateValue(value));
  }

  function isAddressLike(value) {
    var s = norm(value).toLowerCase();
    return /\b(unit|street|st\b|road|rd\b|avenue|ave\b|drive|dr\b|crescent|cct|circuit|way|nsw|vic|qld|sa|wa|tas|act|nt|australia|postcode)\b/.test(s);
  }

  function stateValue(value) {
    var s = norm(value).toUpperCase();
    var m = s.match(/\b(ACT|NSW|NT|QLD|SA|TAS|VIC|WA)\b/);
    return m ? m[1] : "";
  }

  function titleFor(applicant) {
    var title = norm(applicant.title);
    if (title) return title;
    if (key(applicant.gender) === "male") return "Mr.";
    if (key(applicant.gender) === "female" && key(applicant.maritalStatus).indexOf("married") >= 0) return "Mrs.";
    if (key(applicant.gender) === "female") return "Ms.";
    return "";
  }

  function normaliseApplicant(raw, index, fallbackAddress) {
    var full = norm(firstValue(raw, ["fullName", "name", "applicantName"]));
    var firstName = norm(firstValue(raw, ["firstName", "givenName", "givenNames", "first"]));
    var surname = norm(firstValue(raw, ["surname", "lastName", "familyName", "last"]));
    if (!firstName && full) {
      var bits = full.split(" ");
      firstName = bits.shift() || "";
      surname = surname || bits.join(" ");
    }

    var genderRaw = norm(firstValue(raw, ["gender", "sex"]));
    var genderKey = key(genderRaw);
    var gender = genderKey === "male" ? "Male" : (genderKey === "female" ? "Female" : "");
    var dob = dateValue(firstValue(raw, ["dateOfBirth", "dob", "birthDate"]));
    var expiry = dateValue(firstValue(raw, ["licenceExpiryDate", "licenseExpiryDate", "driverLicenceExpiry", "driverLicenseExpiry", "expiryDate"]));
    var licenceNoRaw = norm(firstValue(raw, ["driverLicenceNumber", "driverLicenseNumber", "licenceNumber", "licenseNumber", "driversLicenceNo", "driverLicenceNo"]));
    if (isDateLike(licenceNoRaw) || stateValue(licenceNoRaw)) licenceNoRaw = "";

    var address = norm(firstValue(raw, ["currentAddress", "residentialAddress", "homeAddress", "address"]));
    if (!address && index > 0) address = fallbackAddress || "";

    return {
      raw: raw,
      firstName: firstName,
      surname: surname,
      fullName: norm((firstName + " " + surname) || full),
      title: norm(firstValue(raw, ["title"])),
      applicantType: norm(firstValue(raw, ["applicantType"])) || "Applicant",
      entityType: norm(firstValue(raw, ["entityType"])) || "Individual",
      primaryApplicant: index === 0 ? "Yes" : "No",
      mobile: norm(firstValue(raw, ["mobile", "phone", "mobilePhone"])),
      email: norm(firstValue(raw, ["email", "emailAddress"])),
      maritalStatus: norm(firstValue(raw, ["maritalStatus"])) || "Married",
      relatedSpouse: "",
      dob: dob,
      gender: gender,
      currentHousing: normaliseHousing(firstValue(raw, ["currentHousingSituation", "housingSituation", "livingSituation", "residentialStatus"])),
      permanentInAustralia: norm(firstValue(raw, ["permanentInAustralia", "permanentResident"])) || "Yes",
      country: norm(firstValue(raw, ["country", "countryOfResidence"])) || "Australia",
      licenceNo: licenceNoRaw,
      licenceExpiry: expiry,
      licenceState: stateValue(firstValue(raw, ["licenceState", "licenseState", "driverLicenceState", "driverLicenseState"])) || stateValue(address),
      licenceClass: norm(firstValue(raw, ["licenceClass", "licenseClass", "driverLicenceClass", "driverLicenseClass"])) || "C",
      dependants: norm(firstValue(raw, ["dependants", "numberOfDependants", "numberOfDependents"])) || "0",
      currentAddress: address,
      previousAddress: norm(firstValue(raw, ["previousAddress"])),
      postSettlementAddress: norm(firstValue(raw, ["postSettlementAddress"])),
      mailingAddress: norm(firstValue(raw, ["mailingAddress", "postalAddress"]))
    };
  }

  function normaliseHousing(value) {
    var k = key(value);
    if (!k) return "";
    if (k.indexOf("rent") >= 0) return "Renting";
    if (k.indexOf("own") >= 0 || k.indexOf("mortgage") >= 0) return "Own Home";
    if (k.indexOf("board") >= 0) return "Boarding";
    if (k.indexOf("parent") >= 0) return "Living with Parents";
    return norm(value);
  }

  function finaliseApplicantList(raw) {
    var out = [];
    var fb = "";
    raw.forEach(function (item) {
      if (!item || typeof item !== "object") return;
      var app = normaliseApplicant(item, out.length, fb);
      if (!app.fullName && !app.firstName && !app.surname) return;
      if (!fb && app.currentAddress) fb = app.currentAddress;
      out.push(app);
    });
    if (out.length === 2) {
      out[0].relatedSpouse = out[1].fullName;
      out[1].relatedSpouse = out[0].fullName;
    }
    return out;
  }

  function collectApplicants(payload) {
    // Prefer the server-prepared Infinity applicants (already mapped to target shape).
    var prepared = asArray(getByPath(payload, ["infinity", "applicants"]));
    if (!prepared.length) {
      var pa = getByPath(payload, ["applicants"]);
      if (pa && typeof pa === "object" && !Array.isArray(pa)) {
        prepared = [pa.primary, pa.secondary].filter(function (x) { return x && typeof x === "object"; });
      }
    }
    if (prepared.length) {
      var preparedApplicants = finaliseApplicantList(prepared);
      if (preparedApplicants.length) return preparedApplicants;
    }

    var candidates = [];
    var roots = payloadRoots(payload);
    var applicantPaths = [
      ["applicants"],
      ["caseData", "applicants"],
      ["clientDetails", "applicants"],
      ["data", "applicants"],
      ["borrowers"],
      ["clients"],
      ["loanForm", "applicants"],
      ["loanForm", "borrowers"],
      ["form", "applicants"],
      ["intake", "applicants"],
      ["clientCall", "applicants"],
      ["brokerIntake", "applicants"],
      ["payload", "applicants"]
    ];

    roots.forEach(function (root) {
      applicantPaths.forEach(function (path) {
        candidates = candidates.concat(asArray(getByPath(root, path)));
      });

      ["primaryApplicant", "applicant1", "mainApplicant", "applicantOne"].forEach(function (name) {
        if (root && root[name] && typeof root[name] === "object") candidates.push(root[name]);
      });
      ["secondApplicant", "secondaryApplicant", "applicant2", "coApplicant"].forEach(function (name) {
        if (root && root[name] && typeof root[name] === "object") candidates.push(root[name]);
      });
    });

    var seen = {};
    var fallbackAddress = "";
    var applicants = [];
    candidates.forEach(function (item, index) {
      if (!item || typeof item !== "object") return;
      var app = normaliseApplicant(item, applicants.length, fallbackAddress);
      if (!app.fullName && !app.firstName && !app.surname) return;
      if (!fallbackAddress && app.currentAddress) fallbackAddress = app.currentAddress;
      var k = key(app.fullName || (app.firstName + app.surname));
      if (seen[k]) return;
      seen[k] = true;
      applicants.push(app);
    });

    if (applicants.length === 2) {
      applicants[0].relatedSpouse = applicants[1].fullName;
      applicants[1].relatedSpouse = applicants[0].fullName;
    }
    return applicants;
  }

  var OBJECTIVE_LABELS = {
    bridging: "Bridging",
    constructRenovateOwnerOccupiedDwelling: "Construct / Renovate Owner Occupied Dwelling",
    constructRenovateInvestmentProperty: "Construct/Renovate Investment Property",
    debtConsolidation: "Debt Consolidation",
    purchaseInvestmentProperty: "Purchase Investment Property",
    purchaseOwnerOccupiedDwelling: "Purchase Owner Occupied Dwelling",
    purchaseVacantLand: "Purchase Vacant Land",
    refinance: "Refinance",
    reverseMortgage: "Reverse Mortgage",
    otherPurpose: "Other Purpose",
    consumerConstruction: "Construction",
    leisurePurchase: "Leisure Purchase",
    medicalPurchase: "Medical Purchase",
    vehiclePurchase: "Vehicle Purchase",
    consumerOtherPurpose: "Other Purpose"
  };
  var REQUIREMENT_GROUPS = {
    general: { bridgingFinance: "Bridging Finance", extraRepayments: "Extra Repayments", lineOfCredit: "Line of Credit", nonConformingLoan: "Non-conforming Loan", offset: "Offset", rateLock: "Rate Lock", redraw: "Redraw", reverseMortgage: "Reverse Mortgage", otherRequirements: "Other Requirements", noEarlyRepaymentPenalty: "No Early Repayment Penalty" },
    rateTypes: { fixedRate: "Fixed Rate", variableRate: "Variable Rate", fixedVariableRate: "Fixed & Variable Rate" },
    repaymentTypes: { interestOnly: "Interest Only", balloonRepayments: "Balloon Repayments", principalAndInterest: "P & I Repayments" },
    repaymentFreq: { weeklyRepayments: "Weekly Repayments", fortnightlyRepayments: "Fortnightly Repayments", monthlyRepayments: "Monthly Repayments" }
  };
  function labelsFromFlags(map, flags) {
    var out = [];
    if (!flags || typeof flags !== "object") return out;
    Object.keys(map).forEach(function (k) { if (flags[k]) out.push(map[k]); });
    return out;
  }

  function getCaseData(payload, applicants) {
    // Preferred path: use the server-prepared Needs Analysis exactly.
    var na = objectAtPath(payload, ["infinity", "needsAnalysis"]);
    if (na) {
      var preparedObjectives = labelsFromFlags(OBJECTIVE_LABELS, na.objectives);
      var selected = asArray(na.selectedApplicants).filter(Boolean);
      return {
        applicantNames: selected.length ? selected : applicants.map(function (a) { return a.fullName; }).filter(Boolean),
        facilityAmount: na.facilityAmount != null ? String(na.facilityAmount) : "",
        methodOfDocId: na.methodDocumentIdentification || "VOI",
        methodOfInterview: na.methodClientInterview || "Face to Face",
        // Normalise through dateValue so ISO (yyyy-mm-dd, since the date-sync deploy) becomes dd/mm/yyyy
        // — fillNeedsAnalysis's fillDateTime rejects anything that isn't dd/mm/yyyy (bad-format).
        creditGuideDate: dateValue(na.dateCreditGuideProvided) || today(),
        interviewDate: dateValue(na.dateInterviewConducted) || today(),
        settlementDate: dateValue(na.estimatedSettlementDate) || futureDate(90),
        loanObjectives: preparedObjectives.length ? preparedObjectives : ["Purchase Owner Occupied Dwelling"],
        loanRequirements: labelsFromFlags(REQUIREMENT_GROUPS.general, na.requirements).filter(function (x) { return x !== "Extra Repayments"; }),
        rateTypes: labelsFromFlags(REQUIREMENT_GROUPS.rateTypes, na.requirements),
        repaymentTypes: labelsFromFlags(REQUIREMENT_GROUPS.repaymentTypes, na.requirements),
        repaymentFreq: labelsFromFlags(REQUIREMENT_GROUPS.repaymentFreq, na.requirements),
        isRefinance: Boolean(na.isRefinanceApplication),
        loanObjectiveExplanation: na.loanObjectiveExplanation || "",
        loanRequirementsExplanation: na.loanRequirementsExplanation || ""
      };
    }
    // Fallback: derive from generic payload fields.
    var loanAmount = findFirstString(payload, ["loanAmount", "facilityAmount", "amount"]) || "";
    var loanPurpose = findFirstString(payload, ["loanPurpose", "purpose", "loanObjective", "useOfFunds"]) || "";
    var occupancy = findFirstString(payload, ["occupancy", "propertyOccupancy"]) || "";
    var template = key(loanPurpose + " " + occupancy);
    var isRefi = template.indexOf("refi") >= 0 || template.indexOf("refinance") >= 0;
    var isInv = template.indexOf("invest") >= 0;
    var objective = isRefi ? "Refinance" : (isInv ? "Purchase Investment Property" : "Purchase Owner Occupied Dwelling");
    var settlement = dateValue(findFirstString(payload, ["estimatedSettlementDate", "settlementDate"])) || futureDate(90);
    return {
      applicantNames: applicants.map(function (a) { return a.fullName; }).filter(Boolean),
      facilityAmount: loanAmount || findFirstString(payload, ["purchasePrice"]) || "",
      methodOfDocId: "VOI",
      methodOfInterview: "Face to Face",
      creditGuideDate: today(),
      interviewDate: today(),
      settlementDate: settlement,
      loanObjectives: [objective],
      loanRequirements: ["Offset", "Redraw", "Extra Repayments"],
      rateTypes: ["Variable Rate"],
      repaymentTypes: ["P & I Repayments"],
      repaymentFreq: ["Monthly Repayments"],
      isRefinance: isRefi,
      loanObjectiveExplanation: isRefi
        ? "Clients are seeking finance to refinance their existing loan."
        : (isInv ? "Clients are seeking finance to purchase an investment property." : "Clients are seeking finance to purchase an owner-occupied property to live in."),
      loanRequirementsExplanation: "Clients require a variable rate loan with offset, redraw, extra repayments, principal and interest repayments, and monthly repayment frequency."
    };
  }

  function today() {
    var d = new Date();
    return pad2(d.getDate()) + "/" + pad2(d.getMonth() + 1) + "/" + d.getFullYear();
  }

  function futureDate(days) {
    var d = new Date(Date.now() + days * 86400000);
    return pad2(d.getDate()) + "/" + pad2(d.getMonth() + 1) + "/" + d.getFullYear();
  }

  function findMainTab(label) {
    var target = key(label);
    // Infynity top tabs are <button class="TabButton"> elements; target the real control,
    // not the wrapping <div>/<span> that share the same text.
    var btn = all("button.TabButton, button[class*='TabButton']").find(function (el) {
      return key(textOf(el)) === target;
    });
    if (btn) return btn;
    btn = all("button,a,li").find(function (el) {
      return key(textOf(el)) === target && el.getBoundingClientRect().height < 90;
    });
    if (btn) return btn;
    return all("a,button,li,div,span").find(function (el) {
      return key(textOf(el)) === target && el.getBoundingClientRect().height < 90;
    }) || null;
  }

  function activeMainTabName() {
    var active = all("button.TabButton.active, button[class*='TabButton'][class*='active']")[0];
    return active ? key(textOf(active)) : "";
  }

  async function clickMainTab(label, result) {
    var tab = findMainTab(label);
    if (!tab) {
      addIssue(result, label, label, "tab-not-found");
      return false;
    }
    tab.scrollIntoView({ block: "center", inline: "center" });
    await sleep(120);
    tab.click();
    addAction(result, "Open tab: " + label);
    // Event-based: wait until this tab is actually active; retry the click once if it didn't land.
    var ok = await waitFor(function () { return activeMainTabName() === key(label); }, 5000, 120);
    if (!ok) { var t2 = findMainTab(label); if (t2) { t2.click(); await waitFor(function () { return activeMainTabName() === key(label); }, 4000, 120); } }
    await waitForSettle(2500, 350);
    return true;
  }

  function findLabel(label, root) {
    var target = key(label);
    return all("label,div,span,p", root).find(function (el) {
      var t = key(textOf(el).replace(/\*$/, ""));
      return t === target || t.indexOf(target) === 0;
    }) || null;
  }

  function controlNearLabel(label, root) {
    var labelEl = findLabel(label, root || document);
    if (!labelEl) return null;
    var forId = labelEl.getAttribute("for");
    if (forId) {
      var byId = document.getElementById(forId);
      if (byId && isVisible(byId)) return byId;
    }
    var box = labelEl.closest(".form-group,.field,.row,[class*='col-'],td,li,div") || labelEl.parentElement;
    for (var i = 0; box && i < 4; i += 1, box = box.parentElement) {
      var ctl = first("input:not([type=hidden]),textarea,select,[role='combobox'],.select2-choice,.ui-select-container", box);
      if (ctl && ctl !== labelEl) return ctl;
    }
    return null;
  }

  function fillByLabel(label, value, root, result, section) {
    if (value == null || value === "") {
      addSkipped(result, section + ": " + label, "empty-value");
      return true;
    }
    var el = controlNearLabel(label, root);
    if (!el) {
      addIssue(result, section, label, "control-not-found");
      return false;
    }
    if (el.tagName === "SELECT") {
      return selectByText(label, value, root, result, section);
    }
    setNativeValue(el, value);
    addFilled(result, section + ": " + label);
    return true;
  }

  function visibleDatePopup() {
    var pop = all("ul.uib-datepicker-popup, .uib-datepicker-popup, [uib-datepicker-popup-wrap], .dropdown-menu").find(function (p) {
      return isVisible(p) && /\b(Sun|Mon|Jan|Feb|Mar|19\d\d|20\d\d)\b/.test(textOf(p));
    });
    if (pop) return pop;
    return all("table").find(function (t) {
      return isVisible(t) && /Sun\s*Mon|Mon\s*Tue/.test(textOf(t));
    }) || null;
  }

  async function pickDateByCalendar(el, date) {
    var parts = String(date).split("/");
    if (parts.length !== 3) return { ok: false, reason: "bad-format" };
    var dd = Number(parts[0]);
    el.scrollIntoView({ block: "center", inline: "center" });
    el.focus();
    el.click();
    await sleep(250);
    // Typing the date makes the picker navigate to that month and highlight the matching day.
    setNativeValue(el, date);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    var pop = await waitFor(visibleDatePopup, 2500, 120);
    if (!pop) { el.click(); pop = await waitFor(visibleDatePopup, 1500, 120); }
    if (!pop) return { ok: false, reason: "no-popup", val: el.value };

    // Days from the current month only (muted = adjacent month) matching the target day number.
    var cells = all("button, td, a, span", pop).filter(function (b) {
      var tx = key(textOf(b));
      if (tx !== String(dd) && tx !== ("0" + dd).slice(-2)) return false;
      var c = String(b.className || "");
      if (/muted|disabled|text-muted|other-month/.test(c) || b.disabled) return false;
      return isVisible(b);
    });
    // Prefer the highlighted/selected day; else take the first valid in-month day.
    var target = cells.find(function (b) {
      return /active|selected|btn-info|btn-primary|highlight|today/.test(String(b.className || "") + " " + String((b.parentElement && b.parentElement.className) || ""));
    }) || cells[0];
    if (!target) return { ok: false, reason: "day-not-found", val: el.value, popupCls: String(pop.className || "").slice(0, 50) };
    var clickable = target.closest("button, a, td") || target;
    clickable.click();
    await sleep(200);
    // Close the calendar so it does not linger on screen.
    el.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Escape", keyCode: 27, which: 27 }));
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    el.blur();
    el.dispatchEvent(new Event("blur", { bubbles: true }));
    document.body.click();
    await sleep(150);
    return { ok: true };
  }

  async function fillDateByLabel(label, value, root, result, section) {
    var date = dateValue(value);
    if (!date) {
      addSkipped(result, section + ": " + label, "empty-or-invalid-date");
      return true;
    }
    var el = controlNearLabel(label, root);
    if (!el) {
      addIssue(result, section, label, "date-control-not-found");
      return false;
    }
    var r = await pickDateByCalendar(el, date);
    await sleep(150);
    var committed = (el.classList.contains("ng-not-empty") || (el.value && el.value.trim())) && !el.classList.contains("ng-invalid-parse");
    if (committed) {
      addFilled(result, section + ": " + label);
      return true;
    }
    addIssue(result, section, label, "date-not-committed:" + ((r && r.reason) || "") + ":val=" + (el.value ? el.value.trim() : "empty") + ((r && r.popupCls) ? ":pop=" + r.popupCls : ""));
    return false;
  }

  async function clickHighlightedDateOnce(date) {
    var day = String(Number(date.split("/")[0]));
    var pickers = all(".datepicker,.datepicker-dropdown,.datetimepicker,.uib-datepicker-popup,.dropdown-menu,table");
    var cells = [];
    pickers.forEach(function (picker) {
      cells = cells.concat(all("td,button,span,a", picker).filter(function (cell) {
        var t = norm(cell.textContent);
        if (t !== day && t !== pad2(day)) return false;
        var cls = String(cell.className || "").toLowerCase();
        return cls.indexOf("active") >= 0 || cls.indexOf("selected") >= 0 || cls.indexOf("today") >= 0 || cls.indexOf("btn") >= 0;
      }));
    });
    if (cells.length) {
      clickOnce(cells[0]);
      await sleep(120);
    }
  }

  function selectByText(label, value, root, result, section) {
    var el = controlNearLabel(label, root);
    if (!el) {
      addIssue(result, section, label, "dropdown-not-found");
      return false;
    }
    var desired = norm(value);
    if (el.tagName === "SELECT") {
      var option = Array.prototype.slice.call(el.options).find(function (opt) {
        return key(opt.textContent) === key(desired) || key(opt.value) === key(desired);
      });
      if (!option) {
        addIssue(result, section, label, "option-not-found: " + desired);
        return false;
      }
      el.value = option.value;
      fire(el, "change");
      addFilled(result, section + ": " + label);
      return true;
    }
    clickOnce(el);
    var optionEl = all("li,div,span,a,button").find(function (opt) {
      return key(textOf(opt)) === key(desired);
    });
    if (!optionEl) {
      addIssue(result, section, label, "option-not-found: " + desired);
      return false;
    }
    clickOnce(optionEl);
    addFilled(result, section + ": " + label);
    return true;
  }

  function activeApplicantName() {
    var tabs = all("a,li,div,span").filter(function (el) {
      var txt = textOf(el);
      if (!txt || txt.length > 80) return false;
      var rect = el.getBoundingClientRect();
      return rect.top > 250 && rect.top < 480 && rect.height < 70;
    });
    var best = tabs.find(function (el) {
      var cs = window.getComputedStyle(el);
      return cs.borderBottomColor && cs.borderBottomWidth !== "0px" && /0,\s*128|0,\s*150|17,\s*185|26,\s*188/.test(cs.borderBottomColor);
    });
    return best ? textOf(best).replace(/\s*x$/i, "") : "";
  }

  async function clickApplicantTab(name, result, optional) {
    var wanted = key(name);
    var candidates = all("a,li,div,span").filter(function (el) {
      var txt = key(textOf(el).replace(/\s*x$/i, ""));
      if (txt !== wanted) return false;
      var rect = el.getBoundingClientRect();
      return rect.top > 250 && rect.top < 520 && rect.height < 80;
    });
    if (!candidates.length) {
      // Single-applicant cases show the applicant form directly with no per-applicant tab.
      if (optional) {
        addSkipped(result, "Client Details: applicant tab " + name, "single-applicant-no-tab");
        return true;
      }
      addIssue(result, "Client Details", name, "applicant-tab-not-found");
      return false;
    }
    var el = candidates[0];
    var rect = el.getBoundingClientRect();
    window.scrollBy(0, rect.top - 360);
    await sleep(120);
    clickOnce(el);
    await sleep(700);
    addAction(result, "Open applicant: " + name);
    return true;
  }

  function parseAddress(raw) {
    var s = norm(raw).replace(/,\s*Australia$/i, "");
    var state = stateValue(s);
    var postcode = "";
    // Postcode = the 4-digit number AFTER the state (e.g. "... NSW 2304"); fall back to the LAST 4-digit run.
    // This avoids mistaking a 4-digit street number for the postcode. NOTE: the value is copied verbatim from
    // the source address — a wrong postcode here (e.g. "Mayfield NSW 2034") is a source-data error, not a parse bug.
    var pm = state && s.match(new RegExp("\\b" + state + "\\b\\D*(\\d{4})\\b", "i"));
    if (pm) postcode = pm[1];
    else { var all4 = s.match(/\b\d{4}\b/g); if (all4) postcode = all4[all4.length - 1]; }
    var beforeState = state ? s.split(new RegExp("\\b" + state + "\\b", "i"))[0].replace(/[,\s]+$/, "") : s;
    var parts = beforeState.split(",").map(norm).filter(Boolean);
    var line = parts.length > 1 ? parts.slice(0, -1).join(" ") : beforeState;
    var suburb = parts.length > 1 ? parts[parts.length - 1] : "";
    var unit = "";
    var streetNumber = "";
    var streetName = "";
    var streetType = "";

    var m = line.match(/^(?:Unit\s*)?(\d+)\s*\/\s*(\d+)\s+(.+)$/i);
    if (m) {
      unit = m[1];
      streetNumber = m[2];
      line = m[3];
    } else {
      m = line.match(/^Unit\s+(\w+)\s*,?\s*(\d+)\s+(.+)$/i);
      if (m) {
        unit = m[1];
        streetNumber = m[2];
        line = m[3];
      } else {
        m = line.match(/^(\d+)\s+(.+)$/);
        if (m) {
          streetNumber = m[1];
          line = m[2];
        }
      }
    }

    var typeMap = {
      st: "Street", street: "Street", rd: "Road", road: "Road", ave: "Avenue", avenue: "Avenue",
      dr: "Drive", drive: "Drive", cres: "Crescent", crescent: "Crescent", cct: "Circuit",
      circuit: "Circuit", way: "Way", close: "Close", court: "Court", ct: "Court", place: "Place", pl: "Place"
    };
    var words = line.split(/\s+/).filter(Boolean);
    if (words.length) {
      var last = words[words.length - 1].toLowerCase().replace(/\./g, "");
      if (typeMap[last]) {
        streetType = typeMap[last];
        streetName = words.slice(0, -1).join(" ");
      } else {
        streetName = line;
      }
    }
    if (!suburb && state) {
      var sm = beforeState.match(/([A-Za-z][A-Za-z\s'-]+)$/);
      if (sm) suburb = norm(sm[1]);
    }
    return {
      unitNumber: unit,
      streetNumber: streetNumber,
      streetName: streetName,
      streetType: streetType,
      suburb: suburb,
      state: state,
      postcode: postcode,
      country: "Australia",
      startDate: ""
    };
  }

  async function fillAddress(addressLabel, rawAddress, result, applicantName) {
    if (!rawAddress) {
      addSkipped(result, "Client Details: " + applicantName + " " + addressLabel, "no-address-in-payload");
      return true;
    }
    var labelEl = findLabel(addressLabel);
    if (!labelEl) {
      addIssue(result, "Client Details", applicantName + " " + addressLabel, "address-label-not-found");
      return false;
    }
    var row = labelEl.closest("div,section,li,tr") || labelEl.parentElement;
    var edit = null;
    for (var i = 0; row && i < 4 && !edit; i += 1, row = row.parentElement) {
      edit = all("a,button,span", row).find(function (el) { return key(textOf(el)) === "edit"; });
    }
    if (!edit) {
      addIssue(result, "Client Details", applicantName + " " + addressLabel, "edit-button-not-found");
      return false;
    }
    clickOnce(edit);
    var modal = await waitFor(function () {
      return all(".modal-content,.modal-dialog,.modal").find(function (m) {
        return /edit address/i.test(textOf(m));
      });
    }, 5000);
    if (!modal) {
      addIssue(result, "Client Details", applicantName + " " + addressLabel, "address-modal-not-open");
      return false;
    }
    var parsed = parseAddress(rawAddress);
    fillByLabel("Unit Number", parsed.unitNumber, modal, result, "Address");
    fillByLabel("Street Number", parsed.streetNumber, modal, result, "Address");
    fillByLabel("Street Name", parsed.streetName, modal, result, "Address");
    selectByText("Street Type", parsed.streetType, modal, result, "Address");
    fillByLabel("Suburb/City", parsed.suburb, modal, result, "Address");
    selectByText("State", parsed.state, modal, result, "Address");
    fillByLabel("Postcode", parsed.postcode, modal, result, "Address");
    selectByText("Country", parsed.country, modal, result, "Address");
    var save = all("button,a", modal).find(function (el) { return key(textOf(el)) === "save"; });
    if (!save) {
      addIssue(result, "Client Details", applicantName + " " + addressLabel, "modal-save-not-found");
      return false;
    }
    clickOnce(save);
    await waitFor(function () { return !isVisible(modal); }, 5000);
    addFilled(result, "Client Details: " + applicantName + " " + addressLabel);
    return true;
  }

  function clearAddressGarbage(result, applicantName) {
    ["Home Phone", "Work Phone", "Fax"].forEach(function (label) {
      var el = controlNearLabel(label);
      if (el && isAddressLike(el.value)) {
        setNativeValue(el, "");
        addAction(result, "Cleared address text from " + applicantName + " " + label);
      }
    });
  }

  async function saveClientDetails(result) {
    window.scrollTo(0, document.body.scrollHeight);
    await sleep(250);
    var save = all("button,a").reverse().find(function (el) {
      return key(textOf(el)) === "savechanges";
    });
    if (!save) {
      addIssue(result, "Client Details", "Save Changes", "button-not-found");
      return false;
    }
    clickOnce(save);
    addAction(result, "Save Client Details");
    await waitForSettle(5000, 400);
    return true;
  }

  async function runClientDetailsWorkflow(payload, mapping, apiBase, result) {
    step(result, "clientDetails", "running");
    var applicants = collectApplicants(payload);
    result.applicants = applicants.map(function (a) { return a.fullName; });
    if (!applicants.length) {
      addIssue(result, "Client Details", "Applicants", "No applicants found in payload");
      step(result, "clientDetails", "failed");
      return false;
    }
    await clickMainTab("Client Details", result);
    for (var i = 0; i < applicants.length; i += 1) {
      if (stopRequested) return false;
      var app = applicants[i];
      if (!(await clickApplicantTab(app.fullName, result, applicants.length === 1))) return false;
      // Selects bind their ng-options a beat after the applicant tab renders — wait until the Title
      // dropdown actually has options, else the first selects (Title, Marital Status) hit option-not-found.
      await waitFor(function () {
        var t = controlNearLabel("Title", document);
        return t && t.tagName === "SELECT" && t.options.length > 1;
      }, 8000);
      fillByLabel("Entity Type", app.entityType, document, result, "Client Details");
      fillByLabel("Primary Applicant", app.primaryApplicant, document, result, "Client Details");
      fillByLabel("Applicant Type", app.applicantType, document, result, "Client Details");
      selectByText("Title", titleFor(app), document, result, "Client Details");
      fillByLabel("First Name", app.firstName, document, result, "Client Details");
      fillByLabel("Surname", app.surname, document, result, "Client Details");
      selectByText("Marital Status", app.maritalStatus, document, result, "Client Details");
      if (app.relatedSpouse) selectByText("Related Spouse", app.relatedSpouse, document, result, "Client Details");
      await fillDateByLabel("Date of Birth", app.dob, document, result, "Client Details");
      selectByText("Gender", app.gender, document, result, "Client Details");
      selectByText("Current Housing Situation", app.currentHousing, document, result, "Client Details");
      selectByText("Permanent in Australia", app.permanentInAustralia, document, result, "Client Details");
      selectByText("Country (if not Aus Perm)", app.country, document, result, "Client Details");
      fillByLabel("Driver's Licence No.", app.licenceNo, document, result, "Client Details");
      await fillDateByLabel("Licence Expiry Date", app.licenceExpiry, document, result, "Client Details");
      selectByText("Licence State", app.licenceState, document, result, "Client Details");
      fillByLabel("Licence Class", app.licenceClass, document, result, "Client Details");
      fillByLabel("Number of Dependents", app.dependants, document, result, "Client Details");
      clearAddressGarbage(result, app.fullName);
      await fillAddress("Current Address", app.currentAddress, result, app.fullName);
      await fillAddress("Previous Address", app.previousAddress, result, app.fullName);
      await fillAddress("Post Settlement Address", app.postSettlementAddress, result, app.fullName);
      await fillAddress("Mailing Address", app.mailingAddress, result, app.fullName);
      if (!(await saveClientDetails(result))) {
        step(result, "clientDetails", "failed");
        return false;
      }
    }
    try { await restoreBrokerOverrides(result); } catch (e) { /* non-fatal */ } // EasyFlow live source
    step(result, "clientDetails", "done");
    return true;
  }

  function numberValue(value) {
    var n = Number(String(value == null ? "" : value).replace(/[^0-9.-]/g, ""));
    return Number.isFinite(n) ? n : 0;
  }

  function formatMoney(value) {
    var n = numberValue(value);
    return "$" + n.toLocaleString("en-AU", { maximumFractionDigits: 0 });
  }

  function expenseRows(payload) {
    var rows = asArray(financialsOf(payload).expenses).filter(Boolean);
    if (!rows.length) rows = asArray(getByPath(payload, ["expenses"])).filter(Boolean);
    if (rows.length) {
      return rows.map(function (r) {
        return {
          type: norm(firstValue(r, ["type", "expenseType", "category"])),
          amount: numberValue(firstValue(r, ["amount", "monthlyAmount", "value"])),
          description: norm(firstValue(r, ["description"])) || norm(firstValue(r, ["type", "expenseType", "category"]))
        };
      }).filter(function (r) { return r.type && r.amount >= 0; });
    }
    var hem = numberValue(findFirstString(payload, ["hem", "livingExpenseMonthly", "monthlyExpenses"])) || 3050;
    var defaults = [
      ["Groceries", 950],
      ["Vehicle Maintenance & Transport", 500],
      ["Entertainment", 300],
      ["Telephone and Internet", 200],
      ["Clothing & Personal Care", 200],
      ["Health Care", 100],
      ["Home Maintenance", 300],
      ["Other Insurances", 200],
      ["Investment Property Costs", 300]
    ];
    var sum = defaults.reduce(function (a, r) { return a + r[1]; }, 0);
    if (hem !== sum) defaults[0][1] += hem - sum;
    return defaults.map(function (r) { return { type: r[0], amount: r[1], description: r[0] }; });
  }

  function existingMonthlyExpenseTypes() {
    var header = all("h1,h2,h3,h4,div,span").find(function (el) {
      return /monthly expenses/i.test(textOf(el));
    });
    if (!header) return {};
    var section = header.closest("div,section") || header.parentElement;
    var text = textOf(section || document);
    var found = {};
    [
      "Groceries", "Vehicle Maintenance & Transport", "Entertainment", "Telephone and Internet",
      "Clothing & Personal Care", "Health Care", "Home Maintenance", "Other Insurances",
      "Investment Property Costs"
    ].forEach(function (type) {
      if (key(text).indexOf(key(type)) >= 0) found[key(type)] = true;
    });
    return found;
  }

  async function upsertExpense(row, result) {
    var existing = existingMonthlyExpenseTypes();
    if (existing[key(row.type)]) {
      addSkipped(result, "Financials: " + row.type, "already-exists");
      return true;
    }
    window.scrollTo(0, document.body.scrollHeight);
    await sleep(250);
    var add = all("button,a,span").reverse().find(function (el) { return key(textOf(el)) === "addexpense"; });
    if (!add) {
      addIssue(result, "Financials", row.type, "add-expense-not-found");
      return false;
    }
    clickOnce(add);
    var modal = await waitFor(function () {
      return all(".modal-content,.modal-dialog,.modal").find(function (m) { return /expense/i.test(textOf(m)); });
    }, 5000);
    if (!modal) {
      addIssue(result, "Financials", row.type, "expense-modal-not-open");
      return false;
    }
    setSelectNg(modal, "evm.form.type", row.type);
    setNumberByLabel(modal, "Expense Amount", row.amount);
    setSelectNg(modal, "evm.form.frequency", "Monthly");
    setInputNg(modal, "evm.form.description", row.description);
    setSelectNg(modal, "evm.form.post_settlement", "Yes");
    setNumberByLabel(modal, "Ownership", financialsOwnerPct);
    var save = all("button,a", modal).find(function (el) { return /save/i.test(textOf(el)); });
    if (!save) {
      addIssue(result, "Financials", row.type, "expense-save-not-found");
      return false;
    }
    clickOnce(save);
    await waitFor(function () { return !isVisible(modal); }, 5000);
    addFilled(result, "Financials: " + row.type);
    return true;
  }

  var financialsOwnerPct = "100";
  function financialsOf(payload) {
    return objectAtPath(payload, ["infinity", "financials"]) || {};
  }
  function assetRows(payload) {
    return asArray(financialsOf(payload).assets).map(function (a) {
      return {
        type: norm(firstValue(a, ["type", "assetType"])),
        value: numberValue(firstValue(a, ["value", "amount"])),
        valueBasis: norm(firstValue(a, ["valueBasis", "value_basis"])) || "Applicant Estimate",
        description: norm(firstValue(a, ["description"])) || norm(firstValue(a, ["type", "assetType"]))
      };
    }).filter(function (a) { return a.type; });
  }
  function incomeRows(payload) {
    return asArray(financialsOf(payload).incomes).map(function (i) {
      return {
        type: norm(firstValue(i, ["type", "incomeType"])),
        amount: numberValue(firstValue(i, ["amount", "value"])),
        frequency: norm(firstValue(i, ["frequency"])) || "Annually",
        ownership: norm(firstValue(i, ["ownership", "applicant", "owner"]))
      };
    }).filter(function (i) { return i.type && i.amount > 0; });
  }
  // ---- SAFETY: never let a date-looking value land in a money/amount field. The $20,062,026 bug was a
  // date "20/06/2026" (slashes stripped) typed into an expense amount. These helpers are the single
  // chokepoint — every value write goes through setInputCommit, so one guard here covers ALL paths
  // (resolveRequiredAol, applyAolFields, Sync, etc.). typeDateValue (char-by-char) has its own guard.
  function looksMoneyField(el) {
    if (!el) return false;
    var ng = String((el.getAttribute && (el.getAttribute("ng-model") || el.getAttribute("formcontrolname"))) || "").toLowerCase();
    var ph = String(el.placeholder || "").toLowerCase();
    return /amount|expense|premium|balance|value|loan|bsb|account|rate|income|deposit|\bfee\b|price|consideration|contribution|salary/.test(ng + " " + ph) || /^\s*\$/.test(String(el.value || ""));
  }
  function looksDateField(el) {
    if (!el) return false;
    var ng = String((el.getAttribute && (el.getAttribute("ng-model") || el.getAttribute("formcontrolname"))) || "").toLowerCase();
    var ph = String(el.placeholder || "").toLowerCase();
    return /dd[\/ ]?mm|mmm|yyyy/.test(ph) || /\bdate\b/.test(ng) || /\bdate\b/.test(ph);
  }
  function isDateLikeValue(v) {
    var s = String(v == null ? "" : v).trim();
    return /^\d{1,2}[\/ -]\d{1,2}[\/ -]\d{2,4}$/.test(s) || /^\d{4}-\d{2}-\d{2}$/.test(s);
  }
  function setInputCommit(el, value) {
    if (!el) return;
    // GLOBAL guard: refuse a date-looking value into a field that is money-like AND not date-like.
    // (date-field wins: e.g. "valuationDate"/"effectiveDate" matches money's "value" but IS a date field.)
    if (isDateLikeValue(value) && looksMoneyField(el) && !looksDateField(el)) return;
    setNativeValue(el, value);
    fire(el, "input");
    fire(el, "change");
  }
  // Angular datepicker inputs ignore a bulk value set — type char by char with key events.
  function typeDateValue(el, str) {
    if (!el) return;
    // SAFETY: never type a date into a money/amount field (the $20,062,026 class). Date-field wins, so a
    // field that looks money-AND-date (valuationDate) is still allowed; only money-and-NOT-date is refused.
    if (looksMoneyField(el) && !looksDateField(el)) return;
    el.focus();
    setNativeValue(el, "");
    fire(el, "input");
    for (var i = 0; i < str.length; i += 1) {
      var ch = str.charAt(i);
      el.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: ch }));
      setNativeValue(el, str.slice(0, i + 1));
      el.dispatchEvent(new InputEvent("input", { bubbles: true, data: ch }));
      el.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true, key: ch }));
    }
    fire(el, "change");
    el.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Enter" }));
    if (el.blur) el.blur();
  }
  function setSelectValue(sel, value) {
    if (!sel || value == null || value === "") return false;
    var want = key(value);
    var option = Array.prototype.slice.call(sel.options).find(function (opt) {
      return key(opt.textContent) === want || key(opt.value) === want;
    });
    if (!option) return false;
    sel.value = option.value;
    fire(sel, "change");
    return true;
  }
  function setSelectNg(modal, ng, value) {
    if (value == null || value === "") return;
    var sel = first('select[ng-model="' + ng + '"]', modal);
    if (sel) setSelectValue(sel, value);
  }
  function setInputNg(modal, ng, value) {
    var el = first('input[ng-model="' + ng + '"],textarea[ng-model="' + ng + '"]', modal);
    if (el) setInputCommit(el, value);
  }
  function setNumberByLabel(modal, label, value) {
    var lbl = findLabel(label, modal);
    if (!lbl) return false;
    var box = lbl.closest("div,td,li") || lbl.parentElement;
    for (var i = 0; box && i < 4; i += 1, box = box.parentElement) {
      var num = first("input[type='number']", box);
      if (num) { setInputCommit(num, value); return true; }
    }
    return false;
  }
  async function openAddModal(addKey, matchRe) {
    window.scrollTo(0, document.body.scrollHeight);
    await sleep(250);
    var add = all("button,a,span").reverse().find(function (el) { return key(textOf(el)) === addKey; });
    if (!add) return null;
    clickOnce(add);
    return await waitFor(function () {
      return all(".modal-content,.modal-dialog,.modal").find(function (m) { return isVisible(m) && matchRe.test(textOf(m)); });
    }, 5000);
  }
  async function saveAddModal(modal, result, desc) {
    var save = all("button,a", modal).find(function (el) { return /save/i.test(textOf(el)); });
    if (!save) { addIssue(result, "Financials", desc, "modal-save-not-found"); return false; }
    clickOnce(save);
    var closed = await waitFor(function () { return !isVisible(modal); }, 6000);
    if (!closed) { addIssue(result, "Financials", desc, "modal-did-not-close"); return false; }
    addFilled(result, "Financials: " + desc);
    return true;
  }
  function financialsTableText(headerRe) {
    var t = all("table").find(function (tb) { return headerRe.test(textOf(first("thead", tb) || tb)); });
    return t ? key(textOf(t)) : "";
  }
  async function upsertAsset(asset, result) {
    var existing = financialsTableText(/value basis/i);
    if (existing.indexOf(key(asset.type)) >= 0) {
      if (existing.indexOf(key(formatMoney(asset.value))) < 0) {
        result.loanFormMismatches.push({ field: "Asset · " + asset.type, loanForm: formatMoney(asset.value), note: "Infinity value differs from Loan Form" });
      }
      addSkipped(result, "Financials Asset: " + asset.type, "already-exists");
      return true;
    }
    var modal = await openAddModal("addasset", /asset/i);
    if (!modal) { addIssue(result, "Financials", "Asset " + asset.type, "add-asset-modal-not-open"); return false; }
    setSelectNg(modal, "avm.form.type", asset.type);
    await sleep(180);
    setNumberByLabel(modal, "Asset Value", asset.value);
    setSelectNg(modal, "avm.form.value_basis", asset.valueBasis);
    setInputNg(modal, "avm.form.description", asset.description);
    setNumberByLabel(modal, "Ownership", financialsOwnerPct);
    return await saveAddModal(modal, result, "Asset " + asset.type);
  }
  async function upsertIncome(income, result) {
    var existing = financialsTableText(/employer/i);
    if (existing.indexOf(key(income.type)) >= 0) {
      if (income.amount && existing.indexOf(key(formatMoney(income.amount))) < 0) {
        result.loanFormMismatches.push({ field: "Income · " + income.type, loanForm: formatMoney(income.amount), note: "Infinity amount differs from Loan Form" });
      }
      addSkipped(result, "Financials Income: " + income.type, "already-exists");
      return true;
    }
    var modal = await openAddModal("addincome", /income/i);
    if (!modal) { addIssue(result, "Financials", "Income " + income.type, "add-income-modal-not-open"); return false; }
    setSelectNg(modal, "ivm.form.type_selected", income.type);
    setNumberByLabel(modal, "Amount", income.amount);
    setSelectNg(modal, "ivm.form.frequency", income.frequency);
    if (income.ownership) setSelectNg(modal, "ivm.form.applicant", income.ownership);
    return await saveAddModal(modal, result, "Income " + income.type);
  }

  // Task #12: set Ownership = 100% (or 50% couple) on existing Infinity expense rows that have
  // 0%/blank ownership. Opens each row's Actions▸Edit (a.dropdown-item "Edit"), sets the Ownership
  // % number input, clicks Save Changes. Re-scans each pass (the table re-renders after save).
  async function fixInfinityExpenseOwnership(result) {
    // An expense row = a <tr> with a $amount cell + a Monthly/Weekly frequency cell (same as the scrape).
    function expenseRows() {
      return all("tr").filter(function (tr) {
        if (!isVisible(tr)) return false;
        var cells = all("td", tr).map(function (td) { return norm(textOf(td)); }).filter(Boolean);
        if (cells.length < 2) return false;
        return cells.some(function (c) { return /^\$[\d,]/.test(c); }) && cells.some(function (c) { return /^(monthly|weekly|fortnightly)$/i.test(c); });
      });
    }
    function rowType(tr) {
      var cells = all("td", tr).map(function (td) { return norm(textOf(td)); }).filter(Boolean);
      return cells[0] || norm(textOf(tr)).slice(0, 24);
    }
    function needsFix(tr) { return !/\b100(\.0)?\s*%/.test(norm(textOf(tr))); }
    var need = expenseRows().filter(needsFix);
    addAction(result, "Ownership fix: " + need.length + " expense row(s) need " + financialsOwnerPct + "%");
    var processed = {}, fixed = 0, guard = 0;
    while (guard++ < 40) {
      if (stopRequested) break;
      var tr = expenseRows().find(function (r) { return needsFix(r) && !processed[key(rowType(r))]; });
      if (!tr) break;
      var type = rowType(tr);
      processed[key(type)] = true;
      // Find the Actions toggle for this row (in the row, else the nearest on the same visual row).
      var actionsBtn = all("button,a", tr).find(function (b) { return /^\s*actions/i.test(norm(textOf(b))); });
      if (!actionsBtn) {
        var ar = tr.getBoundingClientRect();
        actionsBtn = all("button,a").find(function (b) { return /^\s*actions/i.test(norm(textOf(b))) && isVisible(b) && Math.abs(b.getBoundingClientRect().top - ar.top) < 26; });
      }
      if (!actionsBtn) { addSkipped(result, "Ownership: " + type, "actions-btn-not-found"); continue; }
      actionsBtn.scrollIntoView({ block: "center" }); await sleep(250);
      clickOnce(actionsBtn); await sleep(700);
      // Pick the CLICKABLE <a> "Edit" (it carries ng-click) of THIS row's open dropdown — nearest
      // below the Actions button. The wrapping <li>Edit</li> has no handler, so must be excluded.
      var ar = actionsBtn.getBoundingClientRect();
      var edits = all("a").filter(function (el) { return /^edit$/i.test(norm(textOf(el))) && isVisible(el); });
      edits.sort(function (a, b) {
        var ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
        return (Math.abs(ra.top - ar.bottom) + Math.abs(ra.left - ar.left)) - (Math.abs(rb.top - ar.bottom) + Math.abs(rb.left - ar.left));
      });
      var edit = edits[0];
      if (!edit) { addSkipped(result, "Ownership: " + type, "edit-link-not-found"); document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); if (fixed === 0) break; continue; }
      clickOnce(edit);
      await waitFor(function () { return all(".modal-content,.modal-dialog,.modal").find(function (m) { return /expense/i.test(textOf(m)) && isVisible(m); }); }, 5000);
      var modal = all(".modal-content,.modal-dialog,.modal").find(function (m) { return /expense/i.test(textOf(m)) && isVisible(m); });
      if (!modal) {
        addSkipped(result, "Ownership: " + type, "expense-modal-not-open");
        document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); await sleep(350);
        if (fixed === 0) { addSkipped(result, "Ownership", "aborted after first failure (not risking the workflow)"); break; }
        continue;
      }
      var setOk = setNumberByLabel(modal, "Ownership", financialsOwnerPct);
      await sleep(300);
      var save = all("button,a", modal).find(function (el) { return /save/i.test(textOf(el)) && isVisible(el); });
      if (!save) { addSkipped(result, "Ownership: " + type, "save-btn-not-found (setOwnership=" + setOk + ")"); continue; }
      clickOnce(save);
      await waitFor(function () { return !isVisible(modal); }, 4500);
      await sleep(700);
      fixed += 1;
    }
    // Cleanup: close any leftover dropdown/modal so the next workflow step (Loans & Products) isn't blocked.
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    var leftover = all(".modal-content,.modal-dialog,.modal").find(isVisible);
    if (leftover) { var cl = all("button,a", leftover).find(function (b) { return /^\s*(close|cancel)\s*$/i.test(norm(textOf(b))); }); if (cl) clickOnce(cl); }
    window.scrollTo(0, 0);
    await sleep(400);
    if (fixed) addFilled(result, "Infinity: set ownership " + financialsOwnerPct + "% on " + fixed + " expense row(s)");
    return fixed;
  }

  async function runFinancialsWorkflow(payload, mapping, apiBase, result) {
    step(result, "financials", "running");
    if (!(await clickMainTab("Financials", result))) {
      step(result, "financials", "failed");
      return false;
    }
    // Ownership %: single applicant = 100, couple = 50.
    financialsOwnerPct = collectApplicants(payload).length >= 2 ? "50" : "100";
    var assets = assetRows(payload);
    for (var a = 0; a < assets.length; a += 1) {
      if (stopRequested) return false;
      await upsertAsset(assets[a], result);
    }
    var incomes = incomeRows(payload);
    for (var n = 0; n < incomes.length; n += 1) {
      if (stopRequested) return false;
      await upsertIncome(incomes[n], result);
    }
    var rows = expenseRows(payload);
    // EasyFlow live source: if the broker has ALREADY populated/curated the Infinity expenses, do NOT
    // re-add from the template — that was re-adding rows the broker had deleted (e.g. Home Maintenance).
    // Fresh case (no expenses yet) → fill normally. The broker manages expenses via Compare/Sync after.
    if (Object.keys(existingMonthlyExpenseTypes()).length > 0) {
      addAction(result, "Infinity expenses already populated — skipped template expense fill (respecting your edits/deletions). Use Compare to reconcile.");
    } else {
      for (var i = 0; i < rows.length; i += 1) {
        if (stopRequested) return false;
        await upsertExpense(rows[i], result);
      }
    }
    // Task #12: fix ownership (0%/blank → 100%) on existing expense rows.
    if (!stopRequested) { try { await fixInfinityExpenseOwnership(result); } catch (e) { /* non-fatal */ } }
    // Capture the LIVE Infinity financials (real values) so the AOL compare uses them, not the
    // template. The popup POSTs result.infinityFinancials to EasyFlow after the run.
    try {
      result.infinityFinancials = scrapeInfinityFinancials();
      addAction(result, "Captured live Infinity financials (" + (result.infinityFinancials.expenses.length) + " expenses) for AOL compare");
    } catch (e) { /* non-fatal */ }
    try { await restoreBrokerOverrides(result); } catch (e) { /* non-fatal */ } // EasyFlow live source
    step(result, "financials", "done");
    return true;
  }

  async function clickBestInterestDuty(result) {
    // Existing application: open the SOCA editor via the edit pencil (same screen as post-BID).
    var editPencil = all(".soa-application-edit, [ng-click*='editSoaClicked'], [ng-click*='editSoa']").find(function (el) {
      return isVisible(el);
    });
    if (editPencil) {
      editPencil.scrollIntoView({ block: "center", inline: "center" });
      await sleep(150);
      clickOnce(editPencil);
      addAction(result, "Open SOCA (edit existing application)");
      await waitForRoute("soca", null, 9000);
      return true;
    }
    // New application: Create Application -> Best Interest Duty.
    var create = all("button,a").find(function (el) {
      return /create application/i.test(textOf(el));
    });
    if (create) {
      clickOnce(create);
      await sleep(900);
    }
    var bid = all("button,a,li,div,span").find(function (el) {
      return /best interest duty/i.test(textOf(el));
    });
    if (bid) {
      clickOnce(bid);
      addAction(result, "Open Best Interest Duty");
      await waitForSettle(5000, 400);
    }
    return true;
  }

  // ---- SOCA sub-tab helpers (heading/label based; data from payload.infinity.*) ----
  function lpcData(payload) { return objectAtPath(payload, ["infinity", "loansSecuritiesCommentary"]) || {}; }
  function recData(payload) { return objectAtPath(payload, ["infinity", "recommendation"]) || {}; }
  function commData(payload) { return objectAtPath(payload, ["infinity", "commissionsConflict"]) || {}; }
  function prefFeatures(payload) { return asArray(getByPath(payload, ["infinity", "preferredLoanFeatures"])); }

  function textareaUnderHeading(headingRe) {
    var heads = all("label,h1,h2,h3,h4,h5,strong,b,p,div,span").filter(function (el) {
      return headingRe.test(textOf(el)) && textOf(el).length < 90;
    });
    for (var i = 0; i < heads.length; i += 1) {
      var box = heads[i].closest("div,section,fieldset,td,li") || heads[i].parentElement;
      for (var up = 0; box && up < 5; up += 1, box = box.parentElement) {
        var ta = first("textarea", box);
        if (ta && isVisible(ta)) return ta;
      }
    }
    return null;
  }
  function fillTextareaByHeading(headingRe, value, result, section, label) {
    if (value == null || value === "") { addSkipped(result, section + ": " + label, "empty"); return true; }
    var ta = textareaUnderHeading(headingRe);
    if (!ta) { addIssue(result, section, label, "textarea-not-found"); return false; }
    ta.scrollIntoView({ block: "center" });
    setInputCommit(ta, value);
    if (norm(ta.value) === norm(value)) { addFilled(result, section + ": " + label); return true; }
    addIssue(result, section, label, "textarea-not-committed");
    return false;
  }
  function selectUnderHeading(headingRe, value, result, section, label) {
    if (value == null || value === "") return true;
    var heads = all("label,h4,h5,strong,div,span,p").filter(function (el) { return headingRe.test(textOf(el)) && textOf(el).length < 90; });
    for (var i = 0; i < heads.length; i += 1) {
      var box = heads[i].closest("div,section,td,li") || heads[i].parentElement;
      for (var up = 0; box && up < 4; up += 1, box = box.parentElement) {
        var sel = first("select", box);
        if (sel && isVisible(sel) && setSelectValue(sel, value)) { addFilled(result, section + ": " + label); return true; }
      }
    }
    addIssue(result, section, label, "select-not-found");
    return false;
  }
  async function clickSaveNext(result, label) {
    var sn = all("button,a").reverse().find(function (el) { return key(textOf(el)) === "savenext"; });
    if (!sn) return false;
    clickOnce(sn);
    await waitForSettle(6000, 450); // event-based: wait until the save + next-tab render settles
    addAction(result, label);
    return true;
  }
  // Navigate to a SOCA sub-tab and WAIT for it to render (event-based, no fixed sleep).
  async function socaTabWait(section) {
    gotoSocaTab(section);
    await waitForRoute("/soca/" + section, null, 9000);
  }

  function fillTextareaNg(ng, value, result, section, label) {
    if (value == null || value === "") { addSkipped(result, section + ": " + label, "empty"); return true; }
    var ta = first('textarea[ng-model="' + ng + '"]');
    if (!ta) { addIssue(result, section, label, "textarea-not-found"); return false; }
    ta.scrollIntoView({ block: "center" });
    setInputCommit(ta, value);
    if (norm(ta.value) === norm(value)) { addFilled(result, section + ": " + label); return true; }
    addIssue(result, section, label, "textarea-not-committed");
    return false;
  }
  function lenderPlaceholderText(text, payload) {
    var sample = (recData(payload) || {}).selectedLender;
    if (!text || !sample) return text;
    return String(text).split(sample).join("[LENDER]");
  }
  // Correct the narrative's OCCUPANCY wording to match the loan purpose — a case prepared from the wrong
  // template can carry "investment property" text on an owner-occupied loan (and vice versa).
  function fixOccupancyText(text, payload) {
    if (!text) return text;
    var t = key((findFirstString(payload, ["loanPurpose", "purpose", "loanObjective", "useOfFunds"]) || "") + " " + (findFirstString(payload, ["occupancy", "propertyOccupancy"]) || ""));
    if (/refin/.test(t)) return text;                         // don't touch refinance wording
    if (t.indexOf("invest") >= 0) {
      return String(text)
        .replace(/owner[- ]?occupied property to live in/gi, "investment property")
        .replace(/owner[- ]?occupied property/gi, "investment property")
        .replace(/an owner[- ]?occupied\b/gi, "an investment");
    }
    return String(text)
      .replace(/an investment property/gi, "an owner-occupied property to live in")
      .replace(/investment property/gi, "owner-occupied property")
      .replace(/an investment\b/gi, "an owner-occupied");
  }
  async function fillLoansSecurities(payload, result) {
    // Wait for the SOCA narrative textareas to render before filling (progressive bind, slow network).
    await waitFor(function () { return first('textarea[ng-model="mvm.soaForm.circunstances_objectives_priorities_description"]'); }, 9000);
    var d = lpcData(payload);
    fillTextareaNg("mvm.soaForm.circunstances_objectives_priorities_description", fixOccupancyText(lenderPlaceholderText(d.circumstancesObjectivesPriorities, payload), payload), result, "Loans Securities", "Circumstances/Objectives/Priorities");
    fillTextareaNg("mvm.soaForm.financial_awarness_and_practices_description", d.financialAwarenessPractices, result, "Loans Securities", "Financial Awareness");
    fillTextareaNg("mvm.soaForm.anticipated_significant_changes_description", d.anySignificantChangesAnticipated || "No", result, "Loans Securities", "Significant Changes");
    if (d.otherItemsDiscussed) fillTextareaNg("mvm.soaForm.other_descripton", d.otherItemsDiscussed, result, "Loans Securities", "Other Items");
  }
  async function fillPreferredFeatures(payload, result) {
    // All priority rows share ng-model loanFeature.loan_feature / loanFeature.justification (ng-repeat);
    // target by DOM order = priority order. Loan Scenario Comparison (3 lenders) stays manual.
    // Wait for the ng-repeat rows to render first — filling too early made every priority "row-not-found".
    var needed = (prefFeatures(payload) || []).length || 1;
    await waitFor(function () { return all('select[ng-model="loanFeature.loan_feature"]').filter(isVisible).length >= needed; }, 9000);
    var selects = all('select[ng-model="loanFeature.loan_feature"]').filter(isVisible);
    var reasons = all('textarea[ng-model="loanFeature.justification"]').filter(isVisible);
    prefFeatures(payload).forEach(function (f) {
      var idx = (Number(f.priority) || 0) - 1;
      if (idx < 0 || idx >= selects.length) { addIssue(result, "Preferred Features", "Priority " + f.priority, "row-not-found"); return; }
      setSelectValue(selects[idx], f.feature);
      if (reasons[idx] && f.reason) setInputCommit(reasons[idx], f.reason);
      addFilled(result, "Preferred Features: Priority " + f.priority);
    });
  }

  // ---- Lender scenarios bridge (Infinity Preferred Features → EasyFlow AI → AOL) ----
  // Infinity and AOL are different origins, so the Loan Scenario Comparison cards (lender +
  // product) are scraped on Infinity into result.lenderScenarios; the popup POSTs them to the
  // EasyFlow AI server (per case = internal source of truth) and, on AOL push, GETs them back
  // into payload.lenderScenarios so runAol can fill the Product Selector for the matched lender.
  function scrapeLenderScenarios() {
    var cards = [];
    var lenderLabels = all("label,span,div,strong,td,th,b").filter(function (e) {
      return e.children.length === 0 && /^lender$/i.test(norm(textOf(e)));
    });
    lenderLabels.forEach(function (lab) {
      var card = lab;
      for (var i = 0; i < 7 && card; i += 1, card = card.parentElement) {
        var t = textOf(card);
        if (/product/i.test(t) && /rate/i.test(t) && /term/i.test(t)) break;
      }
      if (!card) return;
      function valFor(name) {
        var l = all("label,span,div,strong,td,th,b", card).find(function (e) {
          return e.children.length === 0 && new RegExp("^" + name + "$", "i").test(norm(textOf(e)));
        });
        if (!l) return "";
        // The value sits in the next non-empty sibling of the label OR of one of its wrappers
        // (e.g. Product's label is inside <div style="min-width:150px"> and the value is the
        // wrapper's next column). Climb up to 3 levels; take the first sibling that has its own text.
        var nameKey = key(name.replace(/\\/g, ""));
        var node = l;
        for (var up = 0; up < 3 && node; up += 1, node = node.parentElement) {
          var sib = node.nextElementSibling;
          while (sib && !norm(textOf(sib))) sib = sib.nextElementSibling;
          if (sib) {
            var t = norm(textOf(sib));
            if (t && key(t) !== nameKey) return t;
          }
        }
        return "";
      }
      var lender = valFor("Lender"), product = valFor("Product");
      if (lender || product) {
        cards.push({ lender: lender, product: product, rate: valFor("Rate"), term: valFor("Term \\(years\\)") || valFor("Term"), repaymentType: valFor("Repayment type") });
      }
    });
    return cards;
  }
  function saveLenderScenarios(result) {
    try {
      var cards = scrapeLenderScenarios();
      if (!cards.length) { addSkipped(result, "Lender scenarios", "no-cards-scraped"); return; }
      // Attach to the run result; the popup forwards this to EasyFlow AI (POST capture).
      result.lenderScenarios = cards;
      brokerCtx.scenarios = cards; // also keep in-memory so the broker-confirm panel can match product
      efPostCapture("lenderScenarios", cards, "infinity"); // belt-and-braces: save now (popup also POSTs)
      addFilled(result, "Captured " + cards.length + " lender scenario(s) for AOL: " + cards.map(function (c) { return c.lender; }).join(", "));
    } catch (e) { addSkipped(result, "Lender scenarios", "scrape-error: " + ((e && e.message) || e)); }
  }
  // Which lender is this AOL document for? (ApplyOnline ID code I-ANZ- / lender name in header)
  function aolLenderCode() {
    // ApplyOnline ID header, e.g. "I-ANZ-11305495-LKT" → "anz".
    var m = (document.body.innerText || "").match(/\bI-([A-Za-z]{2,5})-\d/);
    return m ? m[1].toLowerCase() : "";
  }
  function detectAolLender(cards) {
    var bodyLow = " " + (document.body.innerText || "").toLowerCase().replace(/[^a-z0-9]+/g, " ") + " ";
    var aliasMap = {
      anz: ["anz"], westpac: ["westpac", "wbc"], cba: ["cba", "commonwealth", "commbank"],
      nab: ["nab", "national australia"], stgeorge: ["st george", "stgeorge", "stg"],
      macquarie: ["macquarie", "mac"], bankwest: ["bankwest"], ing: ["ing"], suncorp: ["suncorp"],
      amp: ["amp"], boq: ["boq", "bank of queensland"], banksa: ["banksa"], bom: ["bank of melbourne"]
    };
    function aliasesFor(lender) {
      var n = (lender || "").toLowerCase();
      for (var k in aliasMap) { if (aliasMap[k].some(function (a) { return n.indexOf(a) >= 0; })) return aliasMap[k]; }
      var bare = n.replace(/[^a-z0-9]/g, "");
      return bare ? [bare] : [];
    }
    var code = aolLenderCode();
    var best = null, bestScore = 0;
    (cards || []).forEach(function (c) {
      var score = 0;
      aliasesFor(c.lender).forEach(function (a) {
        if (code && (code === a || code.indexOf(a) >= 0 || a.indexOf(code) >= 0)) score += 3;
        if (bodyLow.indexOf(" " + a + " ") >= 0) score += 1;
      });
      if (score > bestScore) { bestScore = score; best = c; }
    });
    return bestScore > 0 ? best : null;
  }
  // ---- Broker manual-action checklist ----
  // Some fields can't be auto-filled (values differ between systems, or are decisions): the bot
  // lists them with a reference value + a tick box the broker checks once done. Used for ALL
  // manual-required items so nothing is silently dropped.
  function addManual(result, label, reference, group) {
    result.manualActions = result.manualActions || [];
    var k = key(label);
    var dup = result.manualActions.some(function (m) {
      var mk = key(m.label);
      return mk && k && (mk.indexOf(k.slice(0, 12)) >= 0 || k.indexOf(mk.slice(0, 12)) >= 0);
    });
    if (!dup) result.manualActions.push({ label: label, reference: reference || "", group: group || "AOL", done: false });
  }
  // Save a checklist to EasyFlow WITHOUT losing the broker's existing done/doneAt (GET → merge → POST).
  // Used after each run so the per-platform checklist exists for the toggle, without resetting ticks.
  async function persistChecklist(captureKey, items) {
    if (!items || !items.length) return;
    var saved = await efGetCapture(captureKey);
    if (saved && Array.isArray(saved)) {
      items.forEach(function (it) { var m = saved.find(function (s) { return key(s.label) === key(it.label); }); if (m) { it.done = !!m.done; it.doneAt = m.doneAt || null; } });
    }
    efPostCapture(captureKey, items.map(function (it) { return { label: it.label, reference: it.reference, group: it.group, done: !!it.done, doneAt: it.doneAt || null }; }), captureKey.indexOf("infinity") >= 0 ? "infinity" : "aol");
  }
  async function showManualChecklist(items, title, captureKey) {
    var existing = document.getElementById("ef-manual-checklist");
    if (existing) existing.remove();
    // ALWAYS show a COMBINED checklist (Infinity + AOL) so the broker sees everything missing in one
    // place. Load BOTH saved captures + union this run's fresh items; group headers ("Infinity · …" /
    // "AOL · …") separate them. Done states preserved; ticking saves back SPLIT per platform.
    var infSaved = (await efGetCapture("infinityManualChecklist")) || [];
    var aolSaved = (await efGetCapture("aolManualChecklist")) || [];
    var byLabel = {}, order = [];
    // These used to be manual but are now auto-filled (Statement of position; Savings Account interest).
    // Drop them from the checklist even if an OLD capture still has them, so they don't linger.
    function efObsoleteManual(label) {
      var l = String(label || "").toLowerCase();
      return /statement of position/.test(l) || /savings account interest/.test(l) || (/other assets/.test(l) && /savings/.test(l))
        || /employer \(manual\)/.test(l) || /employment occupation/.test(l); // superseded by the "⚠ Employer — Business name" note
    }
    function mergeIn(list) {
      asArray(list).forEach(function (it) {
        if (!it || !it.label || efObsoleteManual(it.label)) return;
        var k = key(it.label);
        if (!byLabel[k]) { byLabel[k] = { label: it.label, reference: it.reference || "", group: it.group || "AOL", done: false, doneAt: null }; order.push(k); }
        if (it.reference) byLabel[k].reference = it.reference;
        if (it.group) byLabel[k].group = it.group;
        if (it.done) { byLabel[k].done = true; byLabel[k].doneAt = it.doneAt || byLabel[k].doneAt; }
      });
    }
    mergeIn(infSaved); mergeIn(aolSaved); mergeIn(items);
    items = order.map(function (k) { return byLabel[k]; });
    if (!items.length) {
      var t = document.createElement("div");
      t.style.cssText = "position:fixed;top:70px;right:18px;z-index:2147483647;background:#1f2937;color:#fff;padding:10px 14px;border-radius:8px;font-family:system-ui;font-size:12.5px;box-shadow:0 6px 20px rgba(0,0,0,.3);";
      t.textContent = "No broker checklist saved for this case yet — run Start Infinity / Start AOL first.";
      document.body.appendChild(t);
      setTimeout(function () { t.remove(); }, 3500);
      return;
    }
    var panel = document.createElement("div");
    panel.id = "ef-manual-checklist";
    panel.style.cssText = "position:fixed;top:70px;right:18px;z-index:2147483647;background:#fff;border:2px solid #d97706;border-radius:12px;box-shadow:0 12px 36px rgba(0,0,0,.3);padding:14px 16px;width:370px;max-height:84vh;overflow:auto;font-family:system-ui,Segoe UI,sans-serif;color:#1f2937;";
    var head = '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">'
      + '<div style="font-weight:800;font-size:14px;color:#b45309;">📋 ' + escapeHtml(title || "Broker manual steps · Infinity + AOL") + '</div>'
      + '<button id="ef-mc-close" style="background:#e5e7eb;border:none;border-radius:6px;width:24px;height:24px;cursor:pointer;font-size:15px;line-height:1;">×</button></div>'
      + '<div style="font-size:11.5px;color:#6b7280;margin-bottom:8px;">These differ between systems or are broker decisions — choose each in the page, then tick it.</div>'
      + '<div id="ef-mc-progress" style="font-weight:800;font-size:12px;margin-bottom:9px;"></div>';
    var body = "";
    var groups = [];
    items.forEach(function (it) { var g = it.group || "AOL"; if (groups.indexOf(g) < 0) groups.push(g); });
    groups.sort(function (a, b) { return (/infinity/i.test(a) ? 0 : 1) - (/infinity/i.test(b) ? 0 : 1); }); // Infinity groups first
    groups.forEach(function (g) {
      body += '<div style="font-weight:800;font-size:11px;color:#0d9488;text-transform:uppercase;letter-spacing:.04em;margin:8px 0 4px;">' + escapeHtml(g) + '</div>';
      items.forEach(function (it, i) {
        if ((it.group || "AOL") !== g) return;
        body += '<label style="display:flex;gap:9px;align-items:flex-start;padding:8px 9px;border:1px solid ' + (it.done ? "#bbf7d0" : "#e5e7eb") + ';background:' + (it.done ? "#f0fdf4" : "#fff") + ';border-radius:8px;margin-bottom:6px;cursor:pointer;">'
          + '<input type="checkbox" class="ef-mc-cb" data-i="' + i + '"' + (it.done ? " checked" : "") + ' style="margin-top:2px;width:16px;height:16px;flex:0 0 auto;accent-color:#15803d;">'
          + '<span style="font-size:12.5px;line-height:1.4;"><b>' + escapeHtml(it.label) + '</b>'
          + (it.reference ? '<br><span style="color:#0e7490;">→ ' + escapeHtml(it.reference) + '</span>' : "")
          + (it.done && it.doneAt ? '<br><span style="color:#15803d;font-size:11px;">✓ done ' + escapeHtml(fmtDoneAt(it.doneAt)) + '</span>' : "")
          + '</span></label>';
      });
    });
    panel.innerHTML = head + body;
    document.body.appendChild(panel);
    var close = document.getElementById("ef-mc-close");
    if (close) close.onclick = function () { panel.remove(); };
    function refresh(persist) {
      var cbs = all(".ef-mc-cb", panel);
      var done = cbs.filter(function (c) { return c.checked; }).length;
      cbs.forEach(function (c) {
        var idx = +c.getAttribute("data-i"); if (!items[idx]) return;
        var wasDone = items[idx].done;
        items[idx].done = c.checked;
        // Stamp WHEN it was ticked (history); clear the stamp if un-ticked.
        if (c.checked && !wasDone) items[idx].doneAt = new Date().toISOString();
        else if (!c.checked) items[idx].doneAt = null;
      });
      var prog = document.getElementById("ef-mc-progress");
      if (prog) {
        var all_done = done === cbs.length && cbs.length > 0;
        prog.textContent = (all_done ? "✅ All " : "") + done + " / " + cbs.length + " manual steps confirmed";
        prog.style.color = all_done ? "#15803d" : "#b45309";
      }
      // Persist on a real toggle, SPLIT per platform by group (Infinity items → infinityManualChecklist,
      // rest → aolManualChecklist) so each platform's checklist stays its own record.
      if (persist) {
        var ser = function (it) { return { label: it.label, reference: it.reference, group: it.group, done: !!it.done, doneAt: it.doneAt || null }; };
        efPostCapture("infinityManualChecklist", items.filter(function (it) { return /infinity/i.test(it.group || ""); }).map(ser), "infinity");
        efPostCapture("aolManualChecklist", items.filter(function (it) { return !/infinity/i.test(it.group || ""); }).map(ser), "aol");
      }
    }
    all(".ef-mc-cb", panel).forEach(function (cb) { cb.onchange = function () { refresh(true); }; });
    refresh(false);
  }
  function fmtDoneAt(iso) {
    try { var d = new Date(iso); return ("0" + d.getDate()).slice(-2) + "/" + ("0" + (d.getMonth() + 1)).slice(-2) + " " + ("0" + d.getHours()).slice(-2) + ":" + ("0" + d.getMinutes()).slice(-2); }
    catch (e) { return ""; }
  }
  // Strip Infinity pricing prefix + LVR/amount tier suffix → core product name AOL can search.
  function aolProductSearchTerm(raw) {
    var p = String(raw || "").replace(/^\*+\s*/, "").trim();
    var lt = p.search(/\s[<(]/); // cut at the first " <70.00% LVR..." or " (..." tier annotation
    if (lt > 0) p = p.slice(0, lt);
    p = p.replace(/^(pricing discretion|discounted pricing|special offer|package pricing|standard pricing)\s*-\s*/i, "");
    p = p.replace(/^HLPT\s+/i, "");
    return p.trim();
  }
  // The AOL Product Selector searches AOL's own catalog, whose names differ from Infinity's, so
  // the bot does NOT type/auto-pick it (broker tried — copying doesn't work). It registers a
  // manual checklist item with the Infinity product as a reference so the broker picks the right one.
  function noteAolProductSelector(result) {
    var cards = (aolActivePayload && aolActivePayload.lenderScenarios) || [];
    var scenario = cards.length ? detectAolLender(cards) : null;
    var ref;
    if (scenario && scenario.product) {
      ref = scenario.lender + " — search \"" + aolProductSearchTerm(scenario.product) + "\"";
    } else if (cards.length) {
      ref = "pick the confirmed lender's product";
    } else {
      ref = "run Infinity first to capture the lender";
    }
    addManual(result, "Product Selector", "select the confirmed lender's product (search by name)", "AOL · Loans");
    addSkipped(result, "AOL Loans: Product Selector", "broker selects manually — see checklist");
  }

  async function fillRecommendation(payload, result) {
    // Text justifications only; broker picks the confirmed lender card manually.
    // Wait for the justification textareas to render — filling too early made all of them "textarea-not-found".
    await waitFor(function () { return first('textarea[ng-model="mvm.form.lender_recommended_justification"]'); }, 9000);
    var r = recData(payload);
    fillTextareaNg("mvm.form.lender_recommended_justification", lenderPlaceholderText(r.lender, payload), result, "Recommendation", "Lender");
    fillTextareaNg("mvm.form.loan_amount_justification", lenderPlaceholderText(r.loanAmount, payload), result, "Recommendation", "Loan Amount");
    fillTextareaNg("mvm.form.interest_rate_justification", lenderPlaceholderText(r.interestRate, payload), result, "Recommendation", "Interest Rate");
    fillTextareaNg("mvm.form.loan_structure_justification", lenderPlaceholderText(r.loanStructure, payload), result, "Recommendation", "Loan Structure");
    fillTextareaNg("mvm.form.goals_and_objectives_justification", lenderPlaceholderText(r.goalsObjectives, payload), result, "Recommendation", "Goals & Objectives");
    fillTextareaNg("mvm.form.loan_features_justification", lenderPlaceholderText(r.loanFeatures, payload), result, "Recommendation", "Loan Features");
    if (r.loanSummaryNotes) fillTextareaNg("mvm.form.notes", lenderPlaceholderText(r.loanSummaryNotes, payload), result, "Recommendation", "Summary Notes");
  }
  async function fillCommissions(payload, result) {
    // Ensure we are on the Commissions tab before filling (Save/Next render can lag, esp. slow network).
    await socaTabWait("commissions");
    // Wait for the Comments textarea to actually render (up to 6s) before filling — avoids the
    // "textarea-not-found" issue when the tab is still loading.
    await waitFor(function () { return first('textarea[ng-model="mvm.form.comments_on_commissions"]'); }, 6000);
    var c = commData(payload);
    fillTextareaNg("mvm.form.comments_on_commissions", c.comments, result, "Commissions", "Comments");
    if (c.otherFeeNotes) fillTextareaNg("mvm.form.fee_upfront_other_notes", c.otherFeeNotes, result, "Commissions", "Other Fee Notes");
  }

  var SOCA_LENDERS = ["Westpac", "Commonwealth Bank", "Commonwealth", "CBA", "ANZ", "NAB", "Macquarie", "Pepper Money", "Pepper", "Firstmac", "Bankwest", "St George", "St.George", "ING", "Suncorp", "AMP", "Resimac", "Bluestone", "Brighten", "BC Invest", "MA Money", "Better Choice", "Thinktank", "Granite", "HomeStart", "ME Bank", "BankSA", "Adelaide Bank", "La Trobe", "Liberty"];
  function detectSelectedLender() {
    function saturated(rgb) {
      var m = String(rgb).match(/(\d+),\s*(\d+),\s*(\d+)/);
      if (!m) return false;
      return (Math.max(+m[1], +m[2], +m[3]) - Math.min(+m[1], +m[2], +m[3])) > 40;
    }
    var cards = all("div,li,label,a,td").filter(function (el) {
      if (!isVisible(el)) return false;
      var t = textOf(el);
      return t.length < 160 && SOCA_LENDERS.some(function (n) { return key(t).indexOf(key(n)) >= 0; });
    });
    var sel = cards.find(function (el) {
      var cs = window.getComputedStyle(el);
      if (cs.borderStyle !== "none" && parseFloat(cs.borderWidth || "0") >= 1 && saturated(cs.borderTopColor)) return true;
      if (cs.outlineStyle !== "none" && saturated(cs.outlineColor)) return true;
      return /active|selected|highlight|checked/.test(String(el.className || ""));
    });
    if (!sel) return "";
    return SOCA_LENDERS.find(function (n) { return key(textOf(sel)).indexOf(key(n)) >= 0; }) || "";
  }

  // True only when the broker is actually viewing the Recommendation tab — so we don't scrape stray
  // "Lender"/"Limit"/"Ownership" labels off the Financials/Scenarios grids onto the recommendation.
  function onRecommendationPage() {
    return /\/loans\/soca\/recommendation/i.test(location.hash || location.href || "");
  }
  function gotoSocaTab(section) {
    var h = location.hash || "";
    var idx = h.indexOf("/loans/soca/");
    if (idx < 0) return false;
    var after = h.slice(idx + "/loans/soca/".length);
    var q = after.indexOf("?");
    location.hash = h.slice(0, idx) + "/loans/soca/" + section + (q >= 0 ? after.slice(q) : "");
    return true;
  }

  function showReadyForAol() {
    var existing = document.getElementById("ef-ready-aol");
    if (existing) existing.remove();
    var p = document.createElement("div");
    p.id = "ef-ready-aol";
    p.style.cssText = "position:fixed;top:78px;left:50%;transform:translateX(-50%);z-index:2147483647;background:#ecfdf5;border:2px solid #15803d;border-radius:12px;box-shadow:0 10px 34px rgba(0,0,0,.25);padding:16px 20px;max-width:480px;font-family:system-ui,Segoe UI,sans-serif;color:#065f46;";
    p.innerHTML = '<div style="font-weight:700;font-size:15px;margin-bottom:6px;">✅ Infinity SOCA finalised</div><div style="font-size:13px;margin-bottom:10px;">Ready to <b>Push AOL</b>. Open ApplyOnline, then click <b>Start AOL</b> in the EasyFlow extension.</div><button id="ef-ready-close" style="background:#15803d;color:#fff;border:none;border-radius:7px;padding:8px 16px;cursor:pointer;font-size:13px;font-weight:600;">OK</button>';
    document.body.appendChild(p);
    var b = document.getElementById("ef-ready-close");
    if (b) b.onclick = function () { p.remove(); };
  }

  async function brokerFinaliseAndReturn(lenderName) {
    var scratch = { issues: [], verificationFailures: [], actions: [] };
    if (lenderName) {
      var subs = [
        { tab: "loans_securities", ngs: ["mvm.soaForm.circunstances_objectives_priorities_description"] },
        { tab: "recommendation", ngs: ["mvm.form.lender_recommended_justification", "mvm.form.loan_amount_justification", "mvm.form.interest_rate_justification", "mvm.form.loan_structure_justification", "mvm.form.goals_and_objectives_justification", "mvm.form.loan_features_justification"] }
      ];
      for (var i = 0; i < subs.length; i += 1) {
        await socaTabWait(subs[i].tab);
        subs[i].ngs.forEach(function (ng) {
          var ta = first('textarea[ng-model="' + ng + '"]');
          if (ta && ta.value.indexOf("[LENDER]") >= 0) setInputCommit(ta, ta.value.split("[LENDER]").join(lenderName));
        });
        await clickSaveNext(scratch, "Lender substitution save (" + subs[i].tab + ")");
        await sleep(900);
      }
    }
    await socaTabWait("commissions");
    var fin = all("button,a").find(function (el) { return /finalise application/i.test(textOf(el)); });
    if (fin) { clickOnce(fin); await waitForSettle(9000, 500); } // wait for Infinity to finalise + re-render
    // Broker decision (2026-06-20): STOP after finalise. The Client Forms tab + "Return to Loans &
    // Products" appear only AFTER finalise; the broker clicks back to Overview himself.
    showReadyForAol();
  }

  var lenderPanelKeepAlive = null;
  function stopLenderKeepAlive() { if (lenderPanelKeepAlive) { clearInterval(lenderPanelKeepAlive); lenderPanelKeepAlive = null; } }
  function showBrokerActions(items) {
    var existing = document.getElementById("ef-broker-actions");
    if (existing) existing.remove();
    var panel = document.createElement("div");
    panel.id = "ef-broker-actions";
    panel.style.cssText = "position:fixed;top:78px;left:50%;transform:translateX(-50%);z-index:2147483647;background:#ffffff;border:2px solid #d97706;border-radius:12px;box-shadow:0 10px 34px rgba(0,0,0,.28);padding:16px 20px;max-width:580px;font-family:system-ui,Segoe UI,sans-serif;color:#1f2937;";
    var html = '<div style="font-weight:700;font-size:15px;color:#b45309;margin-bottom:8px;">⚠️ EasyFlow — Broker action required</div>';
    html += '<ol style="margin:0 0 12px 20px;padding:0;font-size:13px;line-height:1.6;">';
    (items || []).forEach(function (it) { html += "<li>" + escapeHtml(it) + "</li>"; });
    html += "</ol>";
    html += '<div style="font-size:13px;margin-bottom:10px;">Confirmed lender: <input id="ef-lender-input" placeholder="auto-detected from selection" style="padding:5px 9px;border:1px solid #cbd5e1;border-radius:6px;width:200px;font-size:13px;"> <button id="ef-detect-btn" style="background:#0e7490;color:#fff;border:none;border-radius:6px;padding:5px 10px;cursor:pointer;font-size:12px;">Auto-detect</button></div>';
    html += '<button id="ef-finalise-btn" style="background:#15803d;color:#fff;border:none;border-radius:7px;padding:9px 16px;cursor:pointer;font-size:13px;font-weight:700;margin-right:8px;">Confirm lender, Finalise &amp; Return</button>';
    html += '<button id="ef-broker-close" style="background:#e5e7eb;color:#374151;border:none;border-radius:7px;padding:9px 14px;cursor:pointer;font-size:13px;">Close</button>';
    panel.innerHTML = html;
    document.body.appendChild(panel);
    // KEEP-ALIVE: an Infinity SPA route change / Angular re-render wipes this panel from document.body.
    // Re-append it (until the broker finalises or closes) so it never disappears on them.
    stopLenderKeepAlive();
    lenderPanelKeepAlive = setInterval(function () {
      if (!document.getElementById("ef-broker-actions")) showBrokerActions(items);
    }, 1500);
    var close = document.getElementById("ef-broker-close");
    if (close) close.onclick = function () { stopLenderKeepAlive(); panel.remove(); };
    var detect = document.getElementById("ef-detect-btn");
    if (detect) detect.onclick = async function () {
      detect.textContent = "Detecting…";
      await socaTabWait("recommendation");
      var l = detectSelectedLender();
      var inp = document.getElementById("ef-lender-input");
      if (inp) { inp.value = l || ""; if (!l) inp.placeholder = "Not detected — type lender"; }
      detect.textContent = "Auto-detect";
    };
    var btn = document.getElementById("ef-finalise-btn");
    if (btn) btn.onclick = async function () {
      var inp = document.getElementById("ef-lender-input");
      var lender = (inp && inp.value.trim()) || detectSelectedLender();
      // Sync the confirmed lender + its product back to EasyFlow AI before finalising.
      if (lender) {
        btn.textContent = "Saving lender to EasyFlow…";
        await efPostCapture("selectedLender", selectedLenderRecord(lender), "infinity");
      }
      stopLenderKeepAlive();
      panel.remove();
      brokerFinaliseAndReturn(lender);
    };
  }
  // Build the synced record for the confirmed lender, pulling its product from the scraped scenarios.
  function selectedLenderRecord(lender) {
    var sc = (brokerCtx.scenarios || []).find(function (s) {
      var a = key(s.lender || ""), b = key(lender || "");
      return a && b && (a.indexOf(b) >= 0 || b.indexOf(a) >= 0);
    }) || {};
    return {
      lender: lender,
      product: sc.product || "",
      rate: sc.rate || "",
      term: sc.term || "",
      repaymentType: sc.repaymentType || "",
      confirmedAt: new Date().toISOString(),
      source: "infinity-recommendation"
    };
  }

  async function runLoansProductsWorkflow(payload, mapping, apiBase, result) {
    step(result, "loansProducts", "running");
    if (!(await clickMainTab("Loans & Products", result))) {
      step(result, "loansProducts", "failed");
      return false;
    }
    await clickBestInterestDuty(result);
    var applicants = collectApplicants(payload);
    var caseData = getCaseData(payload, applicants);
    if (typeof window.EF_fillNeedsAnalysis !== "function") {
      addIssue(result, "Loans & Products", "Needs Analysis", "EF_fillNeedsAnalysis v3 not loaded");
      step(result, "loansProducts", "failed");
      return false;
    }
    // fillNeedsAnalysis calls EF.log(level, payload) — capture each FAIL so we SURFACE the exact field
    // (label + reason) that blocked, instead of a generic "did not verify".
    var naFails = [];
    var ef = {
      log: function (level, payload) {
        if (payload && typeof payload === "object") {
          if (payload.result === "FAIL") naFails.push(payload.label + (payload.reason ? " (" + payload.reason + ")" : ""));
        } else if (typeof level === "string") {
          addAction(result, "Needs Analysis: " + norm(level));
        }
      }
    };
    // The SOCA Needs Analysis form renders PROGRESSIVELY — objectives bind first, but the method selects,
    // date inputs, applicant toggle + requirement checkboxes bind a beat later. Filling too early made
    // every ng-model/label finder return "not-found" (proven by console probe: all exist post-load).
    // Wait for the late-binding controls to exist before filling.
    await waitFor(function () {
      return document.querySelector('select[ng-model="mvm.form.interview_method"]')
        && document.querySelector('select[ng-model="mvm.form.document_identification_method"]')
        && document.querySelector('input[ng-model="mvm.form.interview_date"]')
        && document.querySelector('input[ng-model="mvm.form.estimated_settlement_date"]')
        && document.querySelector('input[ng-model="applicant.checked"]');
    }, 15000, 150);
    var na = await window.EF_fillNeedsAnalysis(caseData, ef);
    if (!na || !na.ok) {
      // One retry — a late control can still slip the first pass. fillNeedsAnalysis is idempotent
      // (ensureChecked compares state; dates have an efDateDone guard), so a second pass is safe.
      naFails.length = 0;
      await sleep(1200);
      na = await window.EF_fillNeedsAnalysis(caseData, ef);
    }
    if (!na || !na.ok) {
      // Show the REASON per field (not-found / option-not-found / mismatch) — naFails carries reasons.
      var why = (naFails.length ? naFails.join("; ") : ((na && na.blockers && na.blockers.join(", ")) || "unknown field"));
      addIssue(result, "Loans & Products", "Needs Analysis", "Needs Analysis did not verify — " + why);
      step(result, "loansProducts", "failed");
      return false;
    }
    await clickSaveNext(result, "Needs Analysis Save/Next");

    // Sub-tabs (best-effort, non-fatal; bank choice + Finalise stay manual). Each fill now WAITS for its
    // own controls to render (event-based) — the old fixed sleep(600) was too short on slow network and
    // caused row/textarea/option "not-found" issues across these tabs.
    await fillLoansSecurities(payload, result);
    await clickSaveNext(result, "Loans Securities Save/Next");
    await fillPreferredFeatures(payload, result);
    saveLenderScenarios(result); // capture the 3 lender cards for AOL Product Selector
    await clickSaveNext(result, "Preferred Features Save/Next");
    await fillRecommendation(payload, result);
    await clickSaveNext(result, "Recommendation Save/Next");
    await fillCommissions(payload, result);

    // Lender is the broker's decision: text keeps a [LENDER] placeholder until confirmed.
    // The bot does NOT finalise yet — the broker picks the lender, then clicks the panel button,
    // which substitutes the lender + finalises (the Client Forms tab with "Return to Loans & Products"
    // only appears AFTER finalise; the broker clicks back to Overview himself).
    window.__efPayload = payload;
    var brokerSteps = [
      "Recommendation tab: click the confirmed lender card (it gets a highlighted border).",
      "Click Auto-detect to capture that lender (or type it), then click the green button — it fills [LENDER] everywhere and finalises. Then click 'Return to Loans & Products' to go back."
    ];
    showBrokerActions(brokerSteps, "");
    brokerSteps.forEach(function (s) { addAction(result, "BROKER: " + s); });
    addManual(result, "Recommendation: confirm the lender", "click the confirmed lender card, then Auto-detect + the green button (fills [LENDER] + finalises)", "Infinity · Recommendation");
    (result.loanFormMismatches || []).forEach(function (m) {
      addManual(result, "Reconcile: " + m.field, "Loan Form = " + m.loanForm + " — check Infinity value (" + (m.note || "") + ")", "Infinity · Reconcile");
    });
    await persistChecklist("infinityManualChecklist", result.manualActions);

    step(result, "loansProducts", "done");
    return true;
  }

  async function runInfinity(payload, mapping, apiBase, retryStepId) {
    var result = makeResult(payload);
    stopRequested = false;
    brokerCtx.pageKey = efPageKey();      // arm auto capture-back for THIS page only
    brokerCtx.scenarios = [];             // never let a previous case's lender cards bleed in
    try { efOverridesCache = (await efGetCapture("brokerOverrides")) || {}; } catch (e) { efOverridesCache = {}; } // live-source layer
    if (retryStepId) {
      result.steps.forEach(function (s) { s.status = s.id === retryStepId ? "pending" : "skipped"; });
    }
    try {
      var ok = true;
      if (!retryStepId || retryStepId === "clientDetails") { ok = await runClientDetailsWorkflow(payload, mapping, apiBase, result); await efCaptureStepData(); }
      if (ok && (!retryStepId || retryStepId === "financials")) { ok = await runFinancialsWorkflow(payload, mapping, apiBase, result); await efCaptureStepData(); }
      if (ok && (!retryStepId || retryStepId === "loansProducts")) { ok = await runLoansProductsWorkflow(payload, mapping, apiBase, result); await efCaptureStepData(); }
      result.ok = ok && result.issues.length === 0 && !stopRequested;
    } catch (err) {
      result.errors.push(err && err.stack ? err.stack : String(err));
      result.ok = false;
    }
    result.finishedAt = new Date().toISOString();
    lastReport = result;
    finishStatus(result, result.ok ? "Infinity autofill complete" : "Infinity needs review");
    return result;
  }

  function applyAolFields(result, section, pairs) {
    pairs.forEach(function (p) {
      var label = p[0], value = p[1];
      if (value == null || value === "") return;
      var el = controlNearLabel(label, document);
      if (!el) { addSkipped(result, "AOL " + section + ": " + label, "field-not-found"); return; }
      if (el.tagName === "SELECT") {
        if (setSelectValue(el, value)) addFilled(result, "AOL " + section + ": " + label);
        else addIssue(result, "AOL " + section, label, "option-not-found: " + value);
        return;
      }
      setInputCommit(el, String(value));
      addFilled(result, "AOL " + section + ": " + label);
    });
  }

  function mapResidency(v) {
    var k = key(v || "");
    if (!k) return "";
    if (k.indexOf("citizen") >= 0) return "Citizen";
    if (k.indexOf("temporary") >= 0 || k.indexOf("temp") >= 0) return "Temporary Resident";
    if (k.indexOf("non") >= 0) return "Non Resident";
    return "Permanent Resident";
  }
  function clickYesNoByLabel(result, section, labelText, value) {
    if (value == null || value === "") return;
    var want = key(value);
    // Pick the TIGHTEST element matching the label. Inline question rows (e.g. "Off the plan? /
    // 3 units / 25%") share a container whose text is still <120 chars, so .find() could grab the
    // whole row and click a neighbour's No. Sorting by text length picks the actual <label>.
    var matches = all("label,div,span,p,strong,td").filter(function (el) {
      return isVisible(el) && key(textOf(el)).indexOf(key(labelText)) >= 0 && textOf(el).length < 120;
    });
    if (!matches.length) { addSkipped(result, "AOL " + section + ": " + labelText, "toggle-label-not-found"); return; }
    matches.sort(function (a, b) { return textOf(a).length - textOf(b).length; });
    var lab = matches[0];
    var box = lab.closest("div,section,li,td") || lab.parentElement;
    for (var i = 0; box && i < 3; i += 1, box = box.parentElement) {
      var btn = all("button,a,span,label", box).find(function (b) {
        return key(textOf(b)) === want && b.getBoundingClientRect().width > 0;
      });
      if (btn) { clickOnce(btn); addFilled(result, "AOL " + section + ": " + labelText + " = " + value); return; }
    }
    addSkipped(result, "AOL " + section + ": " + labelText, "toggle-not-found");
  }

  // AOL (ApplyOnline / NextGen). No ng-model; auto-generated ids (lim-*-NNN) are unstable,
  // so fill by LABEL. Fills whatever AOL tab is currently visible (run per tab). Never submits.
  function gotoAolTab(route) {
    location.hash = "#!/" + route;
  }
  // Is this control flagged required (red border / "Required." text / invalid class)?
  function aolIsRequired(e) {
    var box = e.closest("div,td,li,section");
    if (box && /\brequired\.?/i.test(textOf(box).slice(0, 220))) return true;
    var cs = window.getComputedStyle(e);
    var m = String(cs.borderTopColor || cs.borderColor || "").match(/(\d+),\s*(\d+),\s*(\d+)/);
    if (m && Number(m[1]) > 150 && Number(m[2]) < 110 && Number(m[3]) < 110) return true;
    return /\b(ng-invalid|is-invalid|has-error)\b/.test(String(e.className || ""));
  }
  function aolLabelOf(e) {
    var b = e.closest("div,td,li,label,section"), t = "";
    for (var i = 0; i < 4 && b && !t; i += 1, b = b.parentElement) {
      var l = b.querySelector("label");
      if (l) t = norm(textOf(l)).slice(0, 60);
    }
    return t || norm(e.getAttribute("placeholder") || "");
  }
  function aolToday() {
    var d = new Date();
    return ("0" + d.getDate()).slice(-2) + "/" + ("0" + (d.getMonth() + 1)).slice(-2) + "/" + d.getFullYear();
  }
  // AOL date inputs are moment.js and accept the "19 Jun 2026" (DD MMM YYYY) format, not dd/mm/yyyy.
  function aolMomentDate() {
    var d = new Date(), m = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    return d.getDate() + " " + m[d.getMonth()] + " " + d.getFullYear();
  }
  // Safety net: after the known fills, scan every still-empty REQUIRED (red) field on the
  // current tab and derive a value from the loan case / templates. What can't be derived
  // (e.g. Product Selector = lender choice) is reported as a manual item for the broker.
  function resolveRequiredAol(result, section) {
    var payload = aolActivePayload || {};
    var sec = objectAtPath(payload, ["aol", "securities"]) || {};
    var purchase = sec.transferOfLandAmount || sec.estimatedValue;
    var estVal = sec.estimatedValue || sec.transferOfLandAmount;
    var settle = dateValue(findFirstString(payload, ["estimatedSettlementDate", "settlementDate"]));
    var today = aolToday();
    var textRules = [
      [/statement of position|position date/i, today],
      [/transfer of land|contract price|purchase price|consideration|contract of sale|dutiable/i, purchase],
      [/estimated value|security value|property value|valuation amount/i, estVal],
      [/settlement date/i, settle || today],
      [/valuation date|effective date|date of statement|as at date|date signed/i, today]
    ];
    var selectRules = [
      [/frequency/i, "Monthly"],
      [/repayment type/i, "Principal & Interest"],
      [/basis of (the )?estimate/i, "Applicant Estimate"],
      [/title type/i, "Freehold"],
      [/zoning/i, "Residential"]
    ];
    var controls = all("input,select,textarea").filter(function (e) {
      if (!isVisible(e)) return false;
      var t = (e.type || "").toLowerCase();
      if (t === "hidden" || t === "checkbox" || t === "radio" || t === "button" || t === "submit") return false;
      var empty = e.tagName === "SELECT" ? !e.value : !String(e.value || "").trim();
      return empty && aolIsRequired(e);
    });
    controls.forEach(function (el) {
      var label = aolLabelOf(el);
      var rules = el.tagName === "SELECT" ? selectRules : textRules;
      for (var i = 0; i < rules.length; i += 1) {
        if (!rules[i][0].test(label)) continue;
        var v = rules[i][1];
        if (v == null || v === "") continue;
        if (el.tagName === "SELECT") {
          if (setSelectValue(el, v)) { addFilled(result, "AOL " + section + " (auto-required): " + label.slice(0, 40)); return; }
        } else {
          setInputCommit(el, String(v));
          addFilled(result, "AOL " + section + " (auto-required): " + label.slice(0, 40));
          return;
        }
      }
      // Could not derive from case data → broker manual checklist (the Product Selector is
      // registered separately by noteAolProductSelector, so skip it here to avoid duplicates).
      if (/product name|product selector/i.test(label)) return;
      addSkipped(result, "AOL " + section + ": " + (label.slice(0, 40) || "required field"), "required-manual (no case data to derive)");
      addManual(result, (label.slice(0, 44) || "required field"), "required — choose/enter", "AOL · " + section);
    });
  }
  async function fillAolTab(result, route, tabName, fillFn) {
    if (stopRequested) return;
    gotoAolTab(route);
    // Event-based: wait for the route + the tab content to render (not a fixed sleep).
    await waitForRoute(route, function () { return all("input,select,textarea,button").filter(isVisible).length > 3; }, 9000);
    addAction(result, "AOL tab: " + tabName);
    try { if (fillFn) await fillFn(); } catch (e) { addIssue(result, "AOL " + tabName, "fill", String((e && e.message) || e)); }
    // Resolve any leftover required (red) fields from case/template logic before leaving the tab.
    try { resolveRequiredAol(result, tabName); } catch (e) { /* non-fatal */ }
    // Restore any broker-edited values (EasyFlow live source) that are still empty on this tab.
    try { await restoreBrokerOverrides(result); } catch (e) { /* non-fatal */ }
    // Blur the active field so AOL (auto-save draft) persists, then wait for it to settle before leaving.
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    await waitForSettle(3000, 350);
    var diag = collectAolDiagnostics();
    var req = diag.filter(function (f) { return f.required; });
    result.aolTabs = result.aolTabs || {};
    result.aolTabs[tabName] = { requiredCount: req.length, required: req.slice(0, 25), totalFields: diag.length };
  }

  // ---- Infinity ↔ AOL Financials COMPARE + SYNC (Task #11) ----
  function parseMoney(v) { var n = Number(String(v == null ? "" : v).replace(/[^0-9.]/g, "")); return isFinite(n) ? n : 0; }
  // AOL expense category (regex on the row's category label) → Infinity expense-type keywords.
  var AOL_EXPENSE_RULES = [
    { aol: /clothing|personal care/, inf: ["clothing", "personal care"] },
    { aol: /groceries/, inf: ["groceries", "food"] },
    { aol: /transport|vehicle/, inf: ["transport", "vehicle"] },
    { aol: /telephone|internet|pay tv|media streaming/, inf: ["telephone", "internet", "phone", "media"] },
    { aol: /recreation|entertainment/, inf: ["entertainment", "recreation"] },
    { aol: /medical|health \(excl/, inf: ["health care", "medical"] },
    { aol: /general .*insurance|basic insurance/, inf: ["insurance"] },
    { aol: /primary residence|running costs|home maintenance/, inf: ["home maintenance", "running cost", "rates", "utilities", "investment property"] },
    { aol: /rent/, inf: ["rent", "rental", "board"] },
    { aol: /childcare|child care/, inf: ["childcare", "child care"] },
    { aol: /higher education|vocational/, inf: ["higher education", "vocational"] },
    { aol: /public.*education|government.*education|primary and secondary/, inf: ["education"] },
    { aol: /pet care/, inf: ["pet"] }
  ];
  function infinityMonthly(infExp, keywords) {
    var sum = 0, found = false;
    asArray(infExp).forEach(function (e) {
      var t = key(e.expenseType || e.type || "");
      if (!keywords.some(function (kw) { return t.indexOf(key(kw)) >= 0; })) return;
      var a = parseMoney(e.amount), f = (e.frequency || "Monthly").toLowerCase();
      if (f.indexOf("year") >= 0 || f.indexOf("annual") >= 0) a = a / 12;
      else if (f.indexOf("week") >= 0) a = a * 52 / 12;
      else if (f.indexOf("fortnight") >= 0) a = a * 26 / 12;
      sum += a; found = true;
    });
    return found ? Math.round(sum) : null;
  }
  // Scrape the LIVE Infinity financials table (Assets / Income / Monthly Expenses) so the compare
  // uses real Infinity values, not the (possibly stale) EasyFlow template payload.
  function scrapeInfinityFinancials() {
    var sec = scrapeSectionedRows(INF_SECTION_DEFS);
    return {
      assets: (sec.assets || []).map(function (r) { return { type: r.type, value: r.amount }; }),
      liabilities: (sec.liabilities || []).map(function (r) { return { type: r.type, balance: r.amount }; }),
      incomes: (sec.incomes || []).map(function (r) { return { type: r.type, amount: r.amount, frequency: r.frequency || "Annually", ownership: r.ownership || "" }; }),
      expenses: (sec.expenses || []).map(function (r) { return { type: r.type, expenseType: r.type, amount: r.amount, frequency: r.frequency || "Monthly" }; }),
      scrapedAt: new Date().toISOString()
    };
  }
  // Read the value of the input/select nearest a field label (for live Client-Details scraping).
  function valByLabel(labels) {
    var lab = all("label,span,div,th,strong").find(function (el) {
      if (!isVisible(el) || textOf(el).length > 42) return false;
      var t = key(textOf(el));
      return labels.some(function (l) { return t === key(l) || t.indexOf(key(l)) >= 0; });
    });
    if (!lab) return "";
    var r = lab.getBoundingClientRect(), inp = null;
    all("input,select").forEach(function (el) {
      if (inp || !isVisible(el)) return;
      var er = el.getBoundingClientRect();
      if (er.top >= r.top - 12 && er.top < r.top + 90 && er.left >= r.left - 30 && er.left < r.left + 520) inp = el;
    });
    if (!inp) return "";
    if (inp.tagName === "SELECT") { var o = inp.options[inp.selectedIndex]; return o ? norm(o.textContent) : ""; }
    return norm(inp.value || "");
  }
  // The text value sitting to the RIGHT of an element, on the same visual row (for label→value reads on the
  // Scenarios / Recommendation cards where values are display text, not inputs).
  function rightOf(labelEl) {
    var r = labelEl.getBoundingClientRect(), best = null, bx = 1e9;
    all("div,span,td,b,strong,p,a").forEach(function (e) {
      if (e === labelEl || !isVisible(e) || e.contains(labelEl) || labelEl.contains(e)) return;
      var t = norm(textOf(e)); if (!t || t.length > 160) return;
      var er = e.getBoundingClientRect();
      if (Math.abs(er.top - r.top) < 16 && er.left >= r.right - 4) { var dx = er.left - r.right; if (dx < bx) { bx = dx; best = e; } }
    });
    return best ? norm(textOf(best)) : "";
  }
  function labelVal(root, label) {
    var lab = all("div,span,td,b,strong,p,label", root).find(function (e) {
      return isVisible(e) && textOf(e).length < 30 && key(textOf(e)).indexOf(key(label)) === 0;
    });
    return lab ? rightOf(lab) : "";
  }
  // Scrape the lender scenarios on the "Preferred Loan Features/Scenarios" tab: each card = Lender / Product /
  // Rate / Term / Repayment type. This is where the interest rate + product live.
  function scrapeInfinityScenarios() {
    var cards = [];
    all("div,span,td,strong,b,label").forEach(function (el) {
      if (!isVisible(el) || norm(textOf(el)) !== "Lender") return;
      var card = el, hops = 0;
      while (card && hops < 8 && !(/product/i.test(card.innerText || "") && /rate/i.test(card.innerText || "") && (card.innerText || "").length < 800)) { card = card.parentElement; hops += 1; }
      if (!card) return;
      // Regex over the card's text is far more robust than label→value DOM traversal.
      var txt = (card.innerText || "").replace(/\s+/g, " ").trim();
      var lender = ((txt.match(/lender\s+([A-Za-z][A-Za-z& ]*?)\s+(?:product|override)/i) || [])[1] || rightOf(el) || "").trim();
      var product = ((txt.match(/product\s+(.+?)\s+rate\b/i) || [])[1] || "").trim();
      var rate = (txt.match(/\brate\s+\$?([\d]+(?:\.[\d]+)?)/i) || [])[1] || "";
      var term = (txt.match(/term\s*\(years\)\s*([\d]+)/i) || [])[1] || "";
      var repay = ((txt.match(/repayment type\s+([A-Za-z& ]+?)\s+(?:show fees|$)/i) || [])[1] || "").trim();
      if (lender && !/^$/.test(lender) && !cards.some(function (c) { return c.lender === lender && c.product === product; })) {
        cards.push({ lender: lender, product: product, rate: rate, term: term, repaymentType: repay });
      }
    });
    return cards;
  }
  // Scrape the CURRENT applicants + active-applicant employment from the live Infinity Client Details page.
  // The broker edits Infinity directly (e.g. removed a co-borrower), so this is the up-to-date source for
  // documents. Heuristic (applicant tabs are Title-Case names in the tab strip) — refine against live DOM.
  function scrapeInfinityClientDetails() {
    var names = [], seen = {};
    var EXCLUDE = /client details|client forms|client account|loans|products|securities|commentary|preferred loan|loan features|scenarios|financials|needs analysis|recommendation|commissions|conflict|interest|new lead|new client|dashboard|pipeline|opportunity|calculators|resources|reports|marketing|services|education|admin|contacts|manage accounts|add applicant|loan amount|return to/i;
    all("a,li,div,span,button").forEach(function (el) {
      if (!isVisible(el)) return;
      var r = el.getBoundingClientRect();
      if (r.top < 170 || r.top > 560 || r.height > 80 || r.width > 340) return;
      var t = norm(textOf(el).replace(/\s*[x×]$/i, ""));
      if (t.length < 4 || t.length > 46 || EXCLUDE.test(t)) return;
      if (!/^[A-Z][a-zA-Z'.-]+(\s+[A-Z][a-zA-Z'.-]+)+$/.test(t)) return; // Title-Case multi-word = a person name
      if (!seen[key(t)]) { seen[key(t)] = 1; names.push(t); }
    });
    return {
      platform: "infinity", scrapedAt: new Date().toISOString(),
      applicants: names.map(function (n) { return { name: n }; }),
      employment: {
        employerName: valByLabel(["current employment", "employer", "business name", "company name", "employer name"]),
        occupation: valByLabel(["occupation", "job title", "position"]),
        status: valByLabel(["employment status", "employment type", "employment basis", "basis"])
      },
      // Residency / dependants / gender — read on the Client Details page (blank elsewhere). Infinity has NO
      // "residency status"/"visa subclass" field; it uses "Permanent in Australia" (Yes → PR) + "Country (if
      // not Aus Perm)". Visa subclass is not stored in Infinity, so it stays blank (broker knowledge).
      profile: (function () {
        var perm = valByLabel(["permanent in australia"]);
        var residency = /yes/i.test(perm) ? "Australian Permanent Resident"
          : (/no/i.test(perm) ? "Temporary visa holder" : valByLabel(["residency status", "residency", "citizenship"]));
        return {
          residencyStatus: residency,
          countryIfNotPerm: valByLabel(["country (if not aus perm)", "country"]),
          dependants: valByLabel(["number of dependents", "number of dependants", "no. of dependants", "dependants", "dependents"]),
          gender: valByLabel(["gender", "sex"]),
          title: valByLabel(["title"]),
          dob: valByLabel(["date of birth", "dob"]),
          maritalStatus: valByLabel(["marital status"]),
          currentHousing: valByLabel(["current housing situation", "housing situation"]),
          address: valByLabel(["current address", "residential address", "address"])
        };
      })(),
      // Repayment structure + loan features — read on Loans & Products / Preferred Loan Features (the scenario
      // cards show "Repayment type: Principal & Interest"; prioritised features list Redraw / P&I / Offset).
      loanPrefs: {
        repaymentType: valByLabel(["repayment type", "repayment method"]) || (/principal\s*&?\s*i|p\s*&\s*i\b/i.test(document.body.innerText || "") ? "Principal & Interest" : (/interest only/i.test(document.body.innerText || "") ? "Interest Only" : "")),
        repaymentFrequency: valByLabel(["repayment frequency", "repayment freq", "frequency of repayments"]),
        // true-or-undefined (not false): efMergeObj treats "false" as a real value and would wipe a true from
        // another page, so only ever SET the flag, never clear it.
        redraw: /redraw/i.test(document.body.innerText || "") ? true : undefined,
        offset: /offset/i.test(document.body.innerText || "") ? true : undefined,
        extraRepayments: /additional repayment|extra repayment|unlimited repayment/i.test(document.body.innerText || "") ? true : undefined
      },
      // Lender/rate/product — ONLY trusted on the Recommendation tab. On any other page the same labels
      // ("Lender", "Limit", "Ownership"…) appear as financials/grid headers and would poison the note, so we
      // leave recommendation blank elsewhere and let the server fall back to the captured lenderScenarios.
      recommendation: onRecommendationPage() ? {
        lender: valByLabel(["recommended lender", "lender"]) || labelVal(document.body, "Lender"),
        rate: valByLabel(["interest rate", "recommended rate"]) || labelVal(document.body, "Interest Rate"),
        product: valByLabel(["loan product", "product"]) || labelVal(document.body, "Product"),
        loanAmount: valByLabel(["loan amount", "total loan amount"]) || labelVal(document.body, "Loan Amount"),
        term: valByLabel(["loan term", "term"]) || labelVal(document.body, "Term"),
        lvr: valByLabel(["lvr", "loan to value"]) || labelVal(document.body, "LVR"),
        settlementDate: valByLabel(["settlement date", "settlement"]),
        financeDate: valByLabel(["finance date", "finance due", "finance approval date"])
      } : {},
      scenarios: scrapeInfinityScenarios()
    };
  }
  // Scrape AOL expense rows by GEOMETRY: for each category link, find the amount input, the
  // ownership text, and the delete (trash) icon on the SAME visual row. Robust to AOL's grid DOM.
  function scrapeAolExpenseRows() {
    var rows = [];
    var inputs = all("input").filter(function (i) { return isVisible(i) && (!i.type || i.type === "text"); });
    var selects = all("select").filter(isVisible);
    var links = all("a").filter(function (a) {
      if (!isVisible(a)) return false;
      var t = norm(textOf(a)).toLowerCase();
      return t.length > 2 && t.length < 90 && AOL_EXPENSE_RULES.some(function (r) { return r.aol.test(t); });
    });
    links.forEach(function (a) {
      var ar = a.getBoundingClientRect();
      function sameRow(el) { var r = el.getBoundingClientRect(); return r.width > 0 && Math.abs(r.top - ar.top) < 24; }
      var best = null, bestDx = 1e9;
      inputs.forEach(function (inp) {
        var r = inp.getBoundingClientRect();
        if (Math.abs(r.top - ar.top) > 24 || r.left <= ar.left) return;
        var dx = r.left - ar.left;
        if (dx < bestDx) { bestDx = dx; best = inp; }
      });
      if (!best) return;
      var owner = "";
      var sel = selects.find(sameRow);
      if (sel && sel.options[sel.selectedIndex]) owner = norm(sel.options[sel.selectedIndex].text);
      if (!owner) { var oe = all("span,div").find(function (e) { return sameRow(e) && /auto-allocation|\(100%\)|allocation/i.test(textOf(e)) && textOf(e).length < 40; }); if (oe) owner = norm(textOf(oe)); }
      var trash = null, tx = -1;
      all("i,span,a,button").forEach(function (el) {
        if (!sameRow(el)) return;
        var c = String(el.className || "") + " " + ((el.getAttribute && (el.getAttribute("title") || el.getAttribute("aria-label"))) || "");
        if (!/trash|\bdelete\b|fa-times|remove/i.test(c)) return;
        var r = el.getBoundingClientRect();
        if (r.left > tx) { tx = r.left; trash = el; }
      });
      rows.push({ category: norm(textOf(a)), amount: parseMoney(best.value), input: best, ownership: owner, trash: trash });
    });
    return rows;
  }
  // Section-aware <tr> scraper: assigns each $-amount row to the section header sitting above it.
  // Works for the Infinity financials table AND the AOL Assets/Liabilities tables. The sectionDefs
  // list EVERY section (even ones we ignore) so a later section's rows don't leak into an earlier one.
  function scrapeSectionedRows(sectionDefs) {
    // Exclude (a) our OWN EasyFlow panels (#ef-compare etc. are <table>s with section titles + $ rows —
    // re-scraping them dumps everything into one section) and (b) the AOL Financials LEFT SIDEBAR nav
    // (its "Liabilities"/"Income"/"Expenses" links match the section regexes and sit at content-row Y,
    // so they act as false headers). AOL shows one section per page; the sidebar is the real culprit.
    function excluded(e) {
      if (!e) return true;
      if (e.closest && e.closest('[id^="ef-"]')) return true;     // our own floating panels
      var r = e.getBoundingClientRect();
      if (r.right > 0 && r.right < 345) return true;              // left sub-nav sidebar (content is to the right)
      return false;
    }
    var heads = [];
    all("h1,h2,h3,h4,h5,strong,div,span,td,th").forEach(function (e) {
      if (excluded(e)) return;
      var t = norm(textOf(e));
      if (!t || t.length > 34) return;
      sectionDefs.forEach(function (d) { if (d.re.test(t)) heads.push({ key: d.key, y: e.getBoundingClientRect().top }); });
    });
    heads.sort(function (a, b) { return a.y - b.y; });
    var out = {}; sectionDefs.forEach(function (d) { out[d.key] = out[d.key] || []; });
    all("tr").forEach(function (tr) {
      if (excluded(tr)) return;
      var cells = all("td", tr).map(function (td) { return norm(textOf(td)); }).filter(Boolean);
      if (cells.length < 2) return;
      var amtCell = cells.find(function (c) { return /^-?\$[\d,]/.test(c); });
      if (!amtCell) return;
      var type = cells[0];
      if (!type || /^total$/i.test(type)) return;
      var y = tr.getBoundingClientRect().top, sec = null;
      heads.forEach(function (h) { if (h.y <= y + 6) sec = h.key; });
      if (!sec || !out[sec]) return;
      var freq = cells.find(function (c) { return /^(monthly|weekly|fortnightly|annually|yearly)$/i.test(c); });
      // ownership = the applicant-name cell (Title-case, not the type/amount/freq/ownership-% chips)
      var ownership = cells.find(function (c) {
        return c !== type && c !== amtCell && c !== freq && c.length < 44
          && !/^-?\$/.test(c) && !/%/.test(c) && /^[A-Z][a-zA-Z'.\-]+(\s+[A-Z][a-zA-Z'.\-]+)+/.test(c);
      }) || "";
      out[sec].push({ type: type, amount: parseMoney(amtCell), frequency: freq || "", ownership: ownership.replace(/\s*\(.*\)\s*$/, "").trim() });
    });
    return out;
  }
  var INF_SECTION_DEFS = [
    { key: "assets", re: /^(assets|real estate)/i }, { key: "liabilities", re: /^liabilit/i },
    // header on the Infinity Financials page is "Annual Incomes" — must match that, not just "Income".
    { key: "incomes", re: /^(annual\s+)?incomes?\b/i }, { key: "expenses", re: /(monthly expenses|^expenses)/i }
  ];
  var AOL_SECTION_DEFS = [
    { key: "assets", re: /(real estate assets|other assets|^assets$)/i }, { key: "income", re: /^income$/i },
    { key: "liabilities", re: /^liabilit/i }, { key: "expenses", re: /^expenses$/i }
  ];
  // Match items by normalised type across the 3 sources (Loan Form / Infinity / AOL). amtKey = which
  // numeric field to read from the loan-form objects ("value" for assets, "balance" for liabilities).
  function mergeByType(loanArr, infArr, aolArr, amtKey) {
    var rows = {}, order = [];
    function add(list, col, getAmt) {
      asArray(list).forEach(function (it) {
        var type = norm(it.type || it.expenseType || it.name || "");
        if (!type) return;
        var k = key(type);
        if (!rows[k]) { rows[k] = { type: type, loan: null, infinity: null, aol: null }; order.push(k); }
        var v = getAmt(it);
        if (v != null && !isNaN(v)) rows[k][col] = Math.round(v);
      });
    }
    add(loanArr, "loan", function (it) { return parseMoney(it[amtKey] != null ? it[amtKey] : (it.value != null ? it.value : it.amount)); });
    add(infArr, "infinity", function (it) { return parseMoney(it.value != null ? it.value : it.amount); });
    add(aolArr, "aol", function (it) { return parseMoney(it.value != null ? it.value : it.amount); });
    return order.map(function (k) {
      var r = rows[k];
      var nums = [r.loan, r.infinity, r.aol].filter(function (n) { return n != null; });
      var allEqual = nums.length > 1 && nums.every(function (n) { return Math.abs(n - nums[0]) < 1; });
      r.status = nums.length <= 1 ? "single" : (allEqual ? "match" : "differ");
      return r;
    });
  }
  function buildExpenseDiff(payload) {
    // Prefer the LIVE Infinity scrape (captured via EasyFlow) over the template payload.
    var live = objectAtPath(payload, ["liveInfinityFinancials", "expenses"]);
    var infExp = (live && live.length) ? live : asArray(objectAtPath(payload, ["infinity", "financials", "expenses"]));
    var aolRows = scrapeAolExpenseRows(), used = [], diff = [];
    AOL_EXPENSE_RULES.forEach(function (rule) {
      var infAmt = infinityMonthly(infExp, rule.inf);
      var matches = aolRows.filter(function (r) { return rule.aol.test(r.category.toLowerCase()) && used.indexOf(r.input) < 0; });
      // Prefer the named-ownership row (Arsalan 100%) over an Auto-allocation duplicate.
      matches.sort(function (a, b) { return (/auto/i.test(a.ownership) ? 1 : 0) - (/auto/i.test(b.ownership) ? 1 : 0); });
      var arow = matches[0];
      if (arow) used.push(arow.input);
      if (!arow && infAmt == null) return;
      var aolAmt = arow ? arow.amount : null, status;
      if (arow && infAmt != null) status = Math.abs(aolAmt - infAmt) < 1 ? "match" : "differ";
      else if (arow && infAmt == null) status = aolAmt > 0 ? "aol-only" : "match"; // no Infinity data + AOL $0 = fine
      else status = "missing-aol";
      diff.push({ label: arow ? arow.category : rule.inf[0], infinity: infAmt, aol: aolAmt, target: infAmt != null ? infAmt : 0, status: status, input: arow ? arow.input : null });
    });
    return diff;
  }
  // The full 3-section compare (shown on the AOL page): AOL is scraped live; Infinity comes from the
  // captured liveInfinityFinancials; the loan-form baseline from the payload. Assets + Liabilities are
  // matched by type name across all 3; Expenses keep the rule-based Infinity↔AOL diff (with Sync).
  // Broker decision (2026-06-20): Compare = Monthly Expenses (HEM) ONLY. Assets/Liabilities/Income
  // dropped — the only number the broker reconciles between Infinity ↔ AOL is the living expenses.
  function buildFinancialsDiff(payload) {
    return { expenses: buildExpenseDiff(payload || {}) };
  }
  // Delete duplicate expense rows (keep the named-ownership row, remove Auto-allocation copies).
  // Deletes one at a time, re-scraping each pass (AOL re-renders the list after each delete).
  async function removeDuplicateExpenseRows() {
    var removed = 0, guard = 0;
    while (guard++ < 25) {
      var rows = scrapeAolExpenseRows(), groups = {};
      rows.forEach(function (r) { var k = key(r.category); (groups[k] = groups[k] || []).push(r); });
      var target = null;
      Object.keys(groups).some(function (k) {
        var g = groups[k]; if (g.length < 2) return false;
        var autos = g.filter(function (r) { return /auto/i.test(r.ownership) && r.trash; });
        var named = g.filter(function (r) { return !/auto/i.test(r.ownership); });
        if (named.length && autos.length) { target = autos[0]; return true; }
        // all-auto group → only delete a TRUE duplicate (same amount AND ownership); two distinct
        // expenses that happen to share a category key must NOT be collapsed.
        if (!named.length && g[1] && g[1].trash) {
          var a0 = parseMoney(g[0].input && g[0].input.value), a1 = parseMoney(g[1].input && g[1].input.value);
          if (a0 === a1 && key(g[0].ownership || "") === key(g[1].ownership || "")) { target = g[1]; return true; }
        }
        return false;
      });
      if (!target) break;
      clickOnce(target.trash);
      removed += 1;
      await sleep(900);
      var ok = all("button,a").find(function (b) { return /^(ok|yes|delete|confirm|remove)$/i.test(norm(textOf(b))) && isVisible(b); });
      if (ok) { clickOnce(ok); await sleep(700); }
    }
    return removed;
  }
  // A "✓ reviewed" checkbox for a Compare section (broker ticks it after eyeballing the table; persisted
  // per case via the financialsChecked capture so a refresh/re-Compare keeps the tick + timestamp).
  function sectionCheckHtml(secKey, title) {
    return '<div style="display:flex;justify-content:space-between;align-items:center;margin:10px 0 3px;">'
      + '<span style="font-weight:800;color:#0d9488;font-size:12px;">' + escapeHtml(title) + '</span>'
      + '<label style="font-size:10.5px;color:#6b7280;cursor:pointer;display:flex;align-items:center;gap:4px;white-space:nowrap;">'
      + '<input type="checkbox" class="ef-cmp-check" data-sec="' + secKey + '" style="cursor:pointer;"> '
      + '<span class="ef-cmp-check-lbl" data-sec="' + secKey + '">reviewed</span></label></div>';
  }
  // 3-column table (Loan form | Infinity | AOL) for Assets / Liabilities / Income — matched by type name.
  function render3col(title, rows, secKey) {
    var h = secKey ? sectionCheckHtml(secKey, title)
      : '<div style="margin:10px 0 3px;font-weight:800;color:#0d9488;font-size:12px;">' + escapeHtml(title) + '</div>';
    if (!rows || !rows.length) return h + '<div style="font-size:11px;color:#9ca3af;margin-bottom:2px;">— none —</div>';
    h += '<table style="width:100%;border-collapse:collapse;"><tr style="text-align:left;color:#6b7280;font-size:10.5px;"><th style="padding:1px 3px;">Type</th><th style="text-align:right;">Loan form</th><th style="text-align:right;">Infinity</th><th style="text-align:right;">AOL</th><th></th></tr>';
    rows.forEach(function (r) {
      var col = r.status === "match" ? "#15803d" : (r.status === "single" ? "#9ca3af" : "#dc2626");
      var mark = r.status === "match" ? "✓" : (r.status === "single" ? "·" : "≠");
      h += '<tr style="border-top:1px solid #eee;"><td style="padding:2px 3px;">' + escapeHtml(r.type) + '</td>'
        + '<td style="text-align:right;">' + (r.loan == null ? "—" : "$" + r.loan) + '</td>'
        + '<td style="text-align:right;">' + (r.infinity == null ? "—" : "$" + r.infinity) + '</td>'
        + '<td style="text-align:right;color:' + col + ';font-weight:' + (r.status === "differ" ? 700 : 400) + ';">' + (r.aol == null ? "—" : "$" + r.aol) + '</td>'
        + '<td style="text-align:center;color:' + col + ';">' + mark + '</td></tr>';
    });
    return h + "</table>";
  }
  // A prominent in-panel notice for cross-tab push results (the corner toast alone is easy to miss).
  // The broker MUST be told when the other tab isn't open / didn't receive the sync.
  function efPushNoteHtml() { return '<div id="ef-push-note" style="display:none;"></div>'; }
  function efShowPushNote(kind, msg) {
    var el = document.getElementById("ef-push-note"); if (!el) return;
    var s = { ok: "background:#dcfce7;border:1px solid #86efac;color:#166534;", warn: "background:#fef3c7;border:1px solid #fcd34d;color:#92400e;", err: "background:#fee2e2;border:1px solid #fca5a5;color:#991b1b;" };
    el.style.cssText = "display:block;margin-top:7px;font-size:11px;line-height:1.45;border-radius:8px;padding:9px 11px;font-weight:600;" + (s[kind] || s.warn);
    el.innerHTML = msg;
  }
  // Shared handler: interpret a relay result and surface the right notice (open-tab reminder / 0-row warning / success).
  function efHandlePushResult(res, hadError, targetName, applied) {
    if (hadError || !res || !res.ok) {
      var emsg = (res && res.error) || "Could not reach the " + targetName + " tab.";
      efShowPushNote("err", "⚠ <b>" + targetName + " was NOT updated.</b><br>" + escapeHtml(emsg) + " Open the <b>" + targetName + " tab</b> on the same client's Financials page, then push again.");
      try { efShowSyncToast("⚠ " + targetName + " not updated", emsg); } catch (e) {}
      return false;
    }
    if (!applied) {
      var tgtRows = res.financials && Array.isArray(res.financials.expenses) ? res.financials.expenses.length : 0;
      if (tgtRows > 0) { // reachable + has expense rows → nothing differed, already in sync
        efShowPushNote("ok", "✓ <b>" + targetName + "</b> already matches — 0 changes needed.");
        return true;
      }
      efShowPushNote("warn", "⚠ Reached the <b>" + targetName + " tab</b> but found <b>no expense rows</b> to update. Make sure it's open on the <b>same client's Financials page</b>, then push again.");
      try { efShowSyncToast("⚠ " + targetName + ": nothing to update", "Check the " + targetName + " tab is on the right client + Financials page"); } catch (e) {}
      return false;
    }
    efShowPushNote("ok", "✓ Updated <b>" + applied + " row(s)</b> on the <b>" + targetName + " tab</b> + saved to EasyFlow AI.");
    return true;
  }
  function showFinancialsCompare(data) {
    if (Array.isArray(data)) data = { assets: [], liabilities: [], expenses: data }; // back-compat
    data = data || { assets: [], liabilities: [], expenses: [] };
    var diff = data.expenses || [];
    var existing = document.getElementById("ef-compare"); if (existing) existing.remove();
    var panel = document.createElement("div");
    panel.id = "ef-compare";
    var accent = "#4f46e5"; // AOL panel = indigo (Infinity panel = teal) so the broker can tell them apart at a glance
    panel.style.cssText = "position:fixed;top:58px;right:16px;z-index:2147483647;background:#fff;border:2px solid " + accent + ";border-top:6px solid " + accent + ";border-radius:12px;box-shadow:0 12px 36px rgba(0,0,0,.3);padding:14px 16px;width:460px;max-height:86vh;overflow:auto;font-family:system-ui,Segoe UI,sans-serif;color:#1f2937;font-size:12.5px;";
    var diffs = diff.filter(function (d) { return d.status !== "match"; });
    var html = '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">'
      + '<b style="font-size:14px;color:' + accent + ';"><span style="background:' + accent + ';color:#fff;border-radius:6px;padding:1px 7px;font-size:10px;font-weight:800;margin-right:6px;vertical-align:middle;">AOL</span>Compare · Loan form / Infinity / AOL</b>'
      + '<button id="ef-cmp-close" style="background:#e5e7eb;border:none;border-radius:6px;width:24px;height:24px;cursor:pointer;font-size:15px;">×</button></div>';
    html += sectionCheckHtml("expenses", "Monthly Expenses · HEM (Infinity ↔ AOL)");
    html += '<table style="width:100%;border-collapse:collapse;"><tr style="text-align:left;color:#6b7280;font-size:11px;"><th style="padding:2px 4px;">Category</th><th style="text-align:right;">Infinity</th><th style="text-align:right;">AOL</th><th></th></tr>';
    diff.forEach(function (d) {
      var col = d.status === "match" ? "#15803d" : (d.status === "missing-aol" ? "#dc2626" : "#b45309");
      var mark = d.status === "match" ? "✓" : (d.status === "missing-aol" ? "add" : "≠");
      html += '<tr style="border-top:1px solid #eee;"><td style="padding:3px 4px;">' + escapeHtml(d.label) + '</td>'
        + '<td style="text-align:right;">' + (d.infinity == null ? "—" : "$" + d.infinity) + '</td>'
        + '<td style="text-align:right;color:' + col + ';font-weight:' + (d.status === "match" ? 400 : 700) + ';">' + (d.aol == null ? "—" : "$" + d.aol) + '</td>'
        + '<td style="text-align:center;color:' + col + ';font-size:11px;">' + mark + '</td></tr>';
    });
    var infTotal = diff.reduce(function (s, d) { return s + (d.infinity || 0); }, 0);
    var aolTotal = diff.reduce(function (s, d) { return s + (d.aol || 0); }, 0);
    var totalMatch = Math.abs(infTotal - aolTotal) < 1;
    html += '<tr style="border-top:2px solid ' + accent + ';font-weight:800;"><td style="padding:4px;">TOTAL / month</td>'
      + '<td style="text-align:right;">$' + infTotal + '</td>'
      + '<td style="text-align:right;color:' + (totalMatch ? "#15803d" : "#dc2626") + ';">$' + aolTotal + '</td>'
      + '<td style="text-align:center;color:' + (totalMatch ? "#15803d" : "#dc2626") + ';">' + (totalMatch ? "✓" : "≠") + '</td></tr>';
    html += '</table>';
    var syncable = diff.filter(function (d) { return d.input && d.status !== "match"; }).length;
    var missing = diff.filter(function (d) { return d.status === "missing-aol"; }).length;
    html += '<div style="margin-top:9px;font-size:11px;color:' + (totalMatch ? "#15803d" : "#6b7280") + ';">' + diffs.length + ' difference(s). '
      + (totalMatch ? "Totals match ✓. " : "Totals differ by $" + Math.abs(infTotal - aolTotal) + ". ")
      + (missing ? missing + ' category(ies) missing in AOL — add the row first (broker), then Compare again.' : "Sync sets AOL = Infinity for existing rows.") + '</div>';
    // PRIMARY: push these AOL numbers onto the Infinity tab (teal = it changes Infinity). Mirror of the
    // Infinity panel's push. Cross-tab, so it hops through the background worker (EF_RELAY_TO_INFINITY).
    html += '<div style="margin-top:9px;font-size:10.5px;color:#6b7280;">Copy your AOL numbers to the <b>open Infinity tab</b> so it matches (slower — edits each Infinity row):</div>';
    html += '<button id="ef-cmp-push-inf" style="margin-top:5px;background:#0d9488;color:#fff;border:none;border-radius:8px;padding:10px;width:100%;font-weight:700;cursor:pointer;">📤 Copy the AOL numbers to Infinity</button>' + efPushNoteHtml();
    // SECONDARY (rare): overwrite the rows on THIS AOL page to match Infinity (indigo = it changes AOL).
    html += '<div style="margin-top:8px;font-size:10.5px;color:#6b7280;">Rarely needed — go the other way and change <b>THIS AOL page</b> to match Infinity\'s numbers instead:</div>';
    html += '<button id="ef-cmp-sync" style="margin-top:5px;background:#fff;border:1px solid ' + accent + ';color:' + accent + ';border-radius:8px;padding:9px;width:100%;font-weight:700;cursor:pointer;">Instead, change AOL to match Infinity (' + syncable + ')</button>';
    html += '<button id="ef-cmp-dedup" style="margin-top:7px;background:#fff;border:1px solid #dc2626;color:#dc2626;border-radius:8px;padding:8px;width:100%;font-weight:700;cursor:pointer;">Remove duplicate (Auto-allocation) rows</button>';
    panel.innerHTML = html;
    document.body.appendChild(panel);
    document.getElementById("ef-cmp-close").onclick = function () { panel.remove(); };
    // "✓ reviewed" ticks per section — restore saved state, persist on toggle (timestamped per case).
    (function wireSectionChecks() {
      var boxes = all("input.ef-cmp-check", panel);
      function lblFor(sec) { return panel.querySelector('.ef-cmp-check-lbl[data-sec="' + sec + '"]'); }
      function paint(sec, st) {
        var l = lblFor(sec); if (!l) return;
        if (st && st.done) { l.textContent = "✓ reviewed " + (st.at ? fmtDoneAt(st.at) : ""); l.style.color = "#15803d"; l.style.fontWeight = "700"; }
        else { l.textContent = "reviewed"; l.style.color = "#6b7280"; l.style.fontWeight = "400"; }
      }
      efGetCapture("financialsChecked").then(function (saved) {
        var state = saved && typeof saved === "object" ? saved : {};
        boxes.forEach(function (b) { var s = state[b.getAttribute("data-sec")]; b.checked = !!(s && s.done); paint(b.getAttribute("data-sec"), s); });
        boxes.forEach(function (b) {
          b.onchange = function () {
            var sec = b.getAttribute("data-sec");
            state[sec] = b.checked ? { done: true, at: new Date().toISOString() } : { done: false };
            paint(sec, state[sec]);
            efPostCapture("financialsChecked", state, "aol");
          };
        });
      });
    })();
    // Primary: relay live AOL expenses to the Infinity tab (background → EF_APPLY_FINANCIALS there).
    document.getElementById("ef-cmp-push-inf").onclick = function () {
      var pb = document.getElementById("ef-cmp-push-inf"); pb.disabled = true; pb.textContent = "Copying to Infinity…";
      var src = getCurrentFinancials(); // live AOL expenses
      chrome.runtime.sendMessage({ type: "EF_RELAY_TO_INFINITY", expenses: src.expenses }, function (res) {
        var hadError = !!chrome.runtime.lastError;
        var ok = efHandlePushResult(res, hadError, "Infinity", res && res.applied);
        if (!ok) { pb.disabled = false; pb.textContent = "📤 Copy the AOL numbers to Infinity"; pb.style.background = hadError || !res || !res.ok ? "#dc2626" : "#0d9488"; pb.style.color = "#fff"; return; }
        pb.textContent = "✓ Copied " + res.applied + " change(s) to Infinity"; pb.style.background = "#15803d"; pb.style.color = "#fff";
        try { efPostCapture("aolFinancials", src, "aol"); } catch (e) {}
        try { if (res.financials) efPostCapture("infinityFinancials", res.financials, "infinity"); } catch (e) {}
        var changes = (diff || []).filter(function (d) { return d.status === "differ"; }).map(function (d) { return { field: d.label, from: d.infinity, to: d.aol }; });
        efRecordSyncHistory("AOL → Infinity", changes, res.applied); efAppendHistoryLink();
      });
    };
    document.getElementById("ef-cmp-sync").onclick = async function () {
      var n = 0;
      diff.forEach(function (d) { if (d.input && d.status !== "match") { setInputCommit(d.input, String(d.target)); n += 1; } });
      if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
      var b = document.getElementById("ef-cmp-sync");
      b.textContent = "Synced " + n + " row(s) — refreshing…"; b.style.background = "#15803d"; b.style.color = "#fff";
      efPostCapture("financialsCompare", diff.map(function (d) { return { label: d.label, infinity: d.infinity, aol: d.aol, status: d.status }; }), "aol");
      await sleep(1300); // let AOL save the new values, then re-scrape + re-render so the tables are live
      showFinancialsCompare(buildFinancialsDiff(aolActivePayload || {}));
    };
    document.getElementById("ef-cmp-dedup").onclick = async function () {
      var b = document.getElementById("ef-cmp-dedup");
      b.textContent = "Removing duplicates…"; b.disabled = true;
      var removed = await removeDuplicateExpenseRows();
      b.textContent = "✓ Removed " + removed + " duplicate row(s) — click Compare again";
      b.style.background = "#15803d"; b.style.color = "#fff"; b.style.borderColor = "#15803d";
    };
  }

  // Open the AOL Savings Account "Other asset" row and set its required Interest income amount=0 +
  // Frequency=Monthly (deterministic). Account number stays manual (must be a real numeric value).
  async function fixAolSavingsInterest(result) {
    var label = all("a,td,span,div").find(function (el) { return /^savings account$/i.test(norm(textOf(el))) && isVisible(el) && textOf(el).length < 25; });
    if (!label) { addIssue(result, "Financials", "Savings Account interest", "could not find the Savings row — set Interest income $0 / Monthly manually"); return; }
    var lr = label.getBoundingClientRect();
    var pencil = all("i,span,a,button").find(function (el) {
      var c = String(el.className || "");
      return /fa-pencil|pencil|edit/i.test(c) && isVisible(el) && el.getBoundingClientRect().width < 42 && Math.abs(el.getBoundingClientRect().top - lr.top) < 28;
    });
    if (!pencil) { addIssue(result, "Financials", "Savings Account interest", "could not open the Savings row — set Interest income $0 / Monthly manually"); return; }
    clickOnce(pencil); await waitForSettle(5000, 400);
    var intEl = controlNearLabel("Interest income amount", document);
    if (intEl && intEl.tagName !== "SELECT") { setInputCommit(intEl, "0"); addFilled(result, "AOL Savings: Interest income amount = 0"); }
    var freqEl = controlNearLabel("Frequency", document);
    if (freqEl && freqEl.tagName === "SELECT") { if (setSelectValue(freqEl, "Monthly")) addFilled(result, "AOL Savings: Interest frequency = Monthly"); }
    // (Savings account number is optional for this lender — not added to the checklist.)
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    await sleep(800);
    closeAolModal(); await waitForSettle(3000, 380); dismissAnyAolModal();
    await sleep(800);
  }

  // Motor Vehicle (Other assets) → the required vehicle "Type" dropdown (4WD/Bike/Large/Luxury Car/
  // Medium/Small/Small Medium) is blank. Default to "Medium" (a generic passenger car). Year/Make are
  // optional for a value-basis "Applicant Estimate" so left for the broker.
  async function fixAolMotorVehicle(result) {
    var label = all("a,td,span,div").find(function (el) { return /^motor vehicle$/i.test(norm(textOf(el))) && isVisible(el) && textOf(el).length < 25; });
    if (!label) return; // no Motor Vehicle asset on this case
    var lr = label.getBoundingClientRect();
    var pencil = all("i,span,a,button").find(function (el) {
      var c = String(el.className || "");
      return /fa-pencil|pencil|edit/i.test(c) && isVisible(el) && el.getBoundingClientRect().width < 42 && Math.abs(el.getBoundingClientRect().top - lr.top) < 28;
    });
    if (!pencil) { clickOnce(label); await waitForSettle(5000, 400); } // fall back to clicking the row link
    else { clickOnce(pencil); await waitForSettle(5000, 400); }
    // The vehicle-size <select> is the one whose options include the distinctive sizes.
    var vSel = all("select").filter(isVisible).find(function (s) {
      return Array.prototype.some.call(s.options, function (o) { return /^(4wd|bike|luxury car|small medium)$/i.test(norm(o.textContent)); });
    });
    if (vSel) {
      var cur = vSel.selectedIndex >= 0 ? norm(vSel.options[vSel.selectedIndex].textContent) : "";
      if (!cur || /please select|^select$|^$/i.test(cur)) {
        if (setSelectValue(vSel, "Medium")) addFilled(result, "AOL Motor Vehicle: Type = Medium");
      } else {
        addFilled(result, "AOL Motor Vehicle: Type already = " + cur);
      }
    } else {
      addManual(result, "Motor Vehicle type / year / make", "open Motor Vehicle → set Type (e.g. Medium)", "AOL · Financials");
    }
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    await sleep(700);
    closeAolModal(); await waitForSettle(3000, 380); dismissAnyAolModal();
    await sleep(800);
  }

  // Delete the duplicate "Other Income" (BaseSalary) row — it sits in the Income section and is
  // deletable (has a trash); the real Gross Salary / Interest are linked (→) and read-only.
  async function fixAolIncomeJunk(result) {
    var incomeHead = all("h1,h2,h3,h4,div,span").find(function (el) { return /^income$/i.test(norm(textOf(el))) && textOf(el).length < 12 && isVisible(el); });
    var liabHead = all("h1,h2,h3,h4,div,span").find(function (el) { return /^liabilities$/i.test(norm(textOf(el))) && textOf(el).length < 16 && isVisible(el); });
    if (!incomeHead) { return; }
    var topY = incomeHead.getBoundingClientRect().bottom;
    var botY = liabHead ? liabHead.getBoundingClientRect().top : topY + 500;
    var trash = all("i,span,a,button").find(function (el) {
      var c = String(el.className || "") + " " + ((el.getAttribute && (el.getAttribute("title") || el.getAttribute("aria-label"))) || "");
      if (!/trash|\bdelete\b|fa-times|bin|remove/i.test(c)) return false;
      var r = el.getBoundingClientRect();
      return isVisible(el) && r.top > topY && r.top < botY && r.width < 42;
    });
    if (!trash) { return; }
    clickOnce(trash); await sleep(900);
    var ok = all("button,a").find(function (b) { return /^(ok|yes|delete|confirm|remove)$/i.test(norm(textOf(b))) && isVisible(b); });
    if (ok) { clickOnce(ok); await sleep(700); }
    addFilled(result, "AOL Income: removed duplicate BaseSalary row");
  }

  // Compliance (requirements & objectives): common-sense answers for a clean owner-occupied
  // purchase. The tab expands as you answer, so re-apply over several passes.
  // Answer a Yes/No question by keyword — handles RADIO inputs first, then toggle buttons. Picks the
  // Yes/No control nearest below the matched question text.
  function complianceAnswer(kw, value) {
    var want = key(value);
    // Pick the TIGHTEST element containing the question text (a broad parent div would put qy below
    // the radios → they'd be excluded). Shortest text = the actual question label.
    // Cap 460 so the long "any other requirements not already stated…?" question (~370 chars) is still
    // matched; shortest-pick still lands on the question label, not a radio-wrapping parent.
    var matches = all("div,p,span,label").filter(function (e) { return key(textOf(e)).indexOf(key(kw)) >= 0 && textOf(e).length < 460 && isVisible(e); });
    if (!matches.length) return false;
    matches.sort(function (a, b) { return textOf(a).length - textOf(b).length; });
    var q = matches[0];
    var qy = q.getBoundingClientRect().bottom;
    // 1) RADIO: the radio whose own label text is "Yes"/"No", nearest below the question. AOL radios are
    // styled the same as the checkboxes — the native <input> is HIDDEN, so use allRaw + judge visibility
    // and geometry by the LABEL (the visible "Yes"/"No"), not the hidden input.
    var rTarget = null, rDy = 1e9;
    allRaw("input[type=radio]").forEach(function (r) {
      var lab = r.closest("label") || (r.id && document.querySelector('label[for="' + r.id + '"]')) || r.parentElement;
      if (!lab) return;
      var lr = lab.getBoundingClientRect();
      if (lr.width <= 0) return;
      var dy = lr.top - qy;
      if (dy < -16 || dy > 300) return;
      var lt = key(textOf(lab));
      if (!lt || lt.length > 5) { var sib = r.nextElementSibling || r.previousElementSibling; lt = sib ? key(textOf(sib)) : ""; }
      if (lt.indexOf(want) >= 0 && lt.length <= 4 && dy < rDy) { rDy = dy; rTarget = r; }
    });
    if (rTarget) {
      clickOnce(rTarget);
      // Same as the checkboxes: if a click didn't register (styled/hidden input), set + fire change.
      if (!rTarget.checked) { rTarget.checked = true; rTarget.dispatchEvent(new Event("change", { bubbles: true })); }
      return true;
    }
    // 2) Toggle buttons (Yes/No).
    var best = null, bestDy = 1e9;
    all("button,label,span,a").forEach(function (e) {
      if (key(textOf(e)) !== want || !isVisible(e) || textOf(e).length > 6) return;
      var r = e.getBoundingClientRect(), dy = r.top - qy;
      if (dy < -16 || dy > 260) return;
      if (dy < bestDy) { bestDy = dy; best = e; }
    });
    if (best) { clickOnce(best); return true; }
    return false;
  }
  // AOL calendar date: typing often won't validate (it formats to "19 Jun 2026") — open the picker
  // and click today's day cell.
  // AOL dates are ngx-bootstrap bsDatepicker: <input placeholder=dd/mm/yyyy> + a <button.input-icon-wrapper>
  // (qeid=datepickerPopoverToggle) holding <i.fa-calendar>; the popover renders in <body> as .bs-datepicker.
  // Typing doesn't update the model — open the popover (click the BUTTON, not the bare icon) and click
  // today's enabled day cell (.bs-datepicker-body td span).
  async function pickAolDate(dateEl, targetDate) {
    var d = (targetDate instanceof Date && !isNaN(targetDate.getTime())) ? targetDate : new Date();
    var wrap = (dateEl.closest && dateEl.closest(".date-picker-wrapper,.input-wrapper")) || dateEl.parentElement;
    var trigger = (wrap && (wrap.querySelector('button.input-icon-wrapper') || wrap.querySelector('[qeid="datepickerPopoverToggle"]'))) ||
      (wrap && wrap.querySelector(".fa-calendar") && wrap.querySelector(".fa-calendar").closest("button")) ||
      (wrap && wrap.querySelector(".fa-calendar"));
    if (!trigger) return false;
    trigger.click(); await sleep(800);
    var pop = function () { return allRaw("popover-container, .datepicker, [class*='datepicker']").filter(isVisible)[0] || document; };
    var MON = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
    var wantHdr = MON[d.getMonth()] + " " + d.getFullYear();
    // Navigate to the target month if the calendar is showing a different one (click ‹ / › up to 24x).
    for (var nav = 0; nav < 24; nav += 1) {
      var hdr = Array.prototype.slice.call(pop().querySelectorAll("button,.current,th,bs-datepicker-navigation-view,[class*='title']"))
        .map(function (e) { return norm(textOf(e)); }).find(function (t) { return /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+\d{4}\b/i.test(t) && t.length < 25; }) || "";
      var hk = key(hdr), wk = key(wantHdr);
      if (hk.indexOf(wk) >= 0 || hk.indexOf(key(MON[d.getMonth()].slice(0, 3) + " " + d.getFullYear())) >= 0) break;
      // decide direction by comparing the shown month/year to the target
      var shown = parseHdr(hdr); var goPrev = shown ? (shown.y > d.getFullYear() || (shown.y === d.getFullYear() && shown.m > d.getMonth())) : true;
      var navBtns = Array.prototype.slice.call(pop().querySelectorAll("button.previous, button.next, [class*='previous'], [class*='next'], th.previous, th.next"));
      var prevBtn = navBtns.find(function (e) { return /previous|prev/i.test(e.className || "") || norm(textOf(e)) === "‹" || norm(textOf(e)) === "<"; });
      var nextBtn = navBtns.find(function (e) { return /\bnext\b/i.test(e.className || "") || norm(textOf(e)) === "›" || norm(textOf(e)) === ">"; });
      var nb = goPrev ? prevBtn : nextBtn;
      if (!nb) break;
      nb.click(); await sleep(350);
    }
    var day = String(d.getDate());
    var btn = Array.prototype.slice.call(pop().querySelectorAll("td button, button.btn")).find(function (e) {
      if (norm(textOf(e)) !== day || e.getBoundingClientRect().width <= 0) return false;
      var td = e.closest && e.closest("td");
      var cls = String(e.className || "") + " " + String((td && td.className) || "");
      return !/is-other-month|disabled|muted|week|grey/i.test(cls);
    });
    if (btn) { btn.click(); await sleep(500); return true; }
    return false;
  }
  function parseHdr(hdr) {
    var m = norm(hdr).toLowerCase().match(/(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+(\d{4})/);
    if (!m) return null;
    var idx = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"].indexOf(m[1]);
    return { m: idx, y: Number(m[2]) };
  }
  // Parse an ISO/au date string from the payload to a Date (for the interview/SoP date). Falls to today.
  function payloadDate(value) {
    if (value) {
      var iso = String(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
      if (iso) return new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
      var au = String(value).match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/);
      if (au) return new Date(Number(au[3]), Number(au[2]) - 1, Number(au[1]));
      var d = new Date(value); if (!isNaN(d.getTime())) return d;
    }
    return new Date();
  }
  function auStr(d) {
    var x = (d instanceof Date && !isNaN(d.getTime())) ? d : new Date();
    return ("0" + x.getDate()).slice(-2) + "/" + ("0" + (x.getMonth() + 1)).slice(-2) + "/" + x.getFullYear();
  }
  // Tick a styled checkbox whose native <input> sits INSIDE its <label> (AOL pattern). Clicking the
  // input double-toggles (the click bubbles to the label which re-toggles), so click a NON-input
  // child (.checkbox-box / .checkbox-label) — that bubbles to the label and toggles the input ONCE.
  function tickStyledCheckbox(cb) {
    if (!cb || cb.checked) return;
    // EMPIRICALLY PROVEN on the live AOL R&O form (console test, 4 methods): clicking the .checkbox-box,
    // the <label>, or the <input> does NOT toggle these styled checkboxes (the visible box has no toggle
    // handler and the real <input> is hidden). ONLY setting .checked + dispatching a 'change' event
    // updates the Angular model — and that value survives the re-render. So that's all we do.
    cb.checked = true;
    cb.dispatchEvent(new Event("change", { bubbles: true }));
  }
  // Untick a styled checkbox (mirror of tickStyledCheckbox) — set unchecked + fire change to commit.
  function untickStyledCheckbox(cb) {
    if (!cb || !cb.checked) return;
    cb.checked = false;
    cb.dispatchEvent(new Event("change", { bubbles: true }));
  }
  // Close an AOL slide-in / asset modal robustly: try Save/Done/Close button, then the AOL close icon
  // (click its button ancestor — the bare <i> often isn't the click target), then Escape as last resort.
  function closeAolModal() {
    var btn = all("button,a").find(function (el) { return /^(save|done|update|apply|save changes|close)$/i.test(norm(textOf(el))) && isVisible(el); });
    if (btn) { clickOnce(btn); return true; }
    var icon = all(".acl-close-button__icon,.fa-close-thin,.fa-close,.fa-times,.fa-remove").filter(isVisible)[0];
    var target = icon ? (icon.closest("button,a,.acl-close-button,[role=button]") || icon) : null;
    if (!target) target = all("button,span,a,i").find(function (el) { return /^[×✕✖x]$/.test(norm(textOf(el))) && isVisible(el) && el.getBoundingClientRect().top < 175; });
    if (target) { target.click(); return true; }
    document.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Escape", keyCode: 27, which: 27 }));
    return false;
  }
  // Dismiss ANY open modal/overlay (used before a tab switch so a leftover modal can't corrupt the
  // next tab's form). Clicks every visible AOL close icon + sends Escape.
  function dismissAnyAolModal() {
    all(".acl-close-button__icon,.acl-close-button,.fa-close-thin,.modal .close").filter(isVisible).forEach(function (el) {
      (el.closest("button,a,.acl-close-button,[role=button]") || el).click();
    });
    document.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Escape", keyCode: 27, which: 27 }));
  }
  async function fixAolCompliance(result) {
    // Guard: close any modal left open by a previous tab (e.g. Motor Vehicle) — a lingering overlay
    // re-renders the page when it finally dismisses and wipes anything ticked here.
    dismissAnyAolModal(); await sleep(600);
    // Foreseeable changes (simple, stable): Anticipated adverse changes = No.
    location.hash = "#!/compliance-tab/requirements-and-objectives";
    await waitForRoute("requirements-and-objectives", null, 9000);
    complianceAnswer("adversely", "No");
    complianceAnswer("anticipate", "No");
    await sleep(400);
    // Interview basics on the Reports sub-tab: date + tick the customer (stable, top of the form).
    location.hash = "#!/compliance-tab/reports";
    await waitForRoute("compliance-tab/reports", null, 9000);
    // Interview date = same source as Infinity (loan-form timestamp) → Infinity ↔ AOL match. Pick on the
    // calendar (ngx-bootstrap won't commit a typed value); the AU string is the fallback.
    var ivDate = payloadDate(objectAtPath(aolActivePayload, ["aol", "compliance", "interviewDate"]));
    var dEls = allRaw('input[placeholder*="dd/mm" i], input[placeholder*="dd mmm" i]').filter(function (e) { return e.getBoundingClientRect().width > 0; });
    for (var di = 0; di < dEls.length; di += 1) {
      if (String(dEls[di].value || "").trim()) continue;
      var ok = await pickAolDate(dEls[di], ivDate);
      if (!ok || !String(dEls[di].value || "").trim()) { typeDateValue(dEls[di], auStr(ivDate)); }
    }
    var poaHead = all("div,span,p,label").find(function (e) { return /power of attorney/i.test(textOf(e)) && textOf(e).length < 140 && isVisible(e); });
    var poaY = poaHead ? poaHead.getBoundingClientRect().top : 1e9;
    var icb = allRaw("input[type=checkbox]").find(function (c) { var lab = (c.id && document.querySelector('label[for="' + c.id + '"]')) || c.closest("label"); return !c.checked && lab && lab.getBoundingClientRect().width > 0 && c.getBoundingClientRect().top < poaY && c.getBoundingClientRect().top > 90; });
    if (icb) tickStyledCheckbox(icb); // styled checkbox → set+change (clickOnce does nothing here)
    complianceAnswer("interviewed", "Yes");
    complianceAnswer("reason to suspect", "No");
    // Count the R&O report's styled checkboxes currently in the DOM.
    function roBoxCount() {
      return allRaw("input[type=checkbox]").filter(function (c) {
        var l = (c.id && document.querySelector('label[for="' + c.id + '"]')) || c.closest("label");
        return l && l.querySelector && l.querySelector(".checkbox-box") && l.getBoundingClientRect().width > 0;
      }).length;
    }
    // Select "Requirements & Objectives" ONLY if its checkboxes aren't already showing. RE-selecting an
    // already-selected report CLEARS the rendered body (that's exactly why the bot saw 0). If it's
    // already rendered, leave it; otherwise select + wait for the (async) render.
    var roReady = roBoxCount();
    if (roReady < 5) {
      var repSel = all("select").filter(isVisible).find(function (sel) { return Array.prototype.some.call(sel.options, function (o) { return /requirement|objective/i.test(o.text); }); });
      if (repSel) {
        var opts = Array.prototype.slice.call(repSel.options);
        var roOpt = opts.find(function (o) { return /requirement|objective/i.test(o.text); });
        var otherOpt = opts.find(function (o) { return o.value && !/requirement|objective/i.test(o.text) && norm(o.text); });
        // FORCE a real render: navigating back to /reports leaves the dropdown on R&O but the body
        // empty, and re-setting the SAME value doesn't re-render. Flip to the OTHER report then back to
        // R&O so the value actually CHANGES both times → Angular rebuilds the report body.
        if (otherOpt && roOpt) {
          repSel.value = otherOpt.value; fire(repSel, "change"); await waitForSettle(3000, 350);
          repSel.value = roOpt.value; fire(repSel, "change"); await waitForSettle(4000, 400);
        } else if (roOpt) {
          repSel.value = roOpt.value; fire(repSel, "change"); await waitForSettle(4000, 400);
        }
      }
      for (var rw = 0; rw < 25; rw += 1) { roReady = roBoxCount(); if (roReady >= 5) break; await sleep(400); }
    }
    addFilled(result, "AOL R&O: report rendered " + roReady + " styled checkboxes for the bot");
    await sleep(400);
    // Fill SEQUENTIALLY with a short await + fresh DOM query after each change.
    var radioQs = ["secondary purpose for debt", "secondary purpose for refinance", "conflicts between", "preferred lender or lenders", "other requirements and objectives not already stated"];
    // TWO passes: answering "preferred lender" reveals the "any other requirements not already stated"
    // question, which renders too late for the first pass — the second pass catches it.
    for (var rpass = 0; rpass < 2; rpass += 1) {
      for (var ri = 0; ri < radioQs.length; ri += 1) { complianceAnswer(radioQs[ri], "No"); await sleep(450); }
      await sleep(600);
    }
    function labelFor(cb) { return (cb.id && document.querySelector('label[for="' + cb.id + '"]')) || cb.closest("label"); }
    // NOTE: do NOT auto-click the Rate type / "How important is X" toggle BUTTONS — they are styled
    // controls clickOnce can't reliably set, and clicking an already-active one toggles it OFF which
    // HIDES that feature's reason checkboxes (caused 0 ticks). The reasons are already visible when the
    // feature is important; the broker confirms the toggles. (Re-add only with a verified toggle method.)
    // R&O reason selections — per-lender template from EasyFlow (each lender's AOL wording differs).
    // The bot reads this lender's stored template (or the gold default), ENFORCES it on the page (ticks
    // the template reasons, unticks "Other" + any wrong leftover), and saves the template per lender so
    // it's editable in EasyFlow. Defaults below = gold reference (ING 11800579). NEVER "Other".
    var DEFAULT_REASONS = [
      "flexibility with respect to repayment",   // Variable rate
      "minimise interest paid",                  // Principal & Interest
      "build up equity from the start",          // Principal & Interest
      "allows access to funds",                  // Offset account
      "flexibility to access prepaid funds",     // Redraw feature
      "longest loan term available"              // Loan term (purchase → 30yr, lowest min repayment)
    ];
    var lenderCode = detectAolLenderCode();
    var savedTmpl = await efGetTemplate(lenderCode);
    // The template is AUTHORITATIVE (saved lender template, or per-case override, or the gold default).
    // We do NOT union arbitrary pre-checked boxes — a previous "tick everything" draft would teach the
    // wrong reasons. The broker edits the template in EasyFlow to teach corrections.
    var RO_REASON_TEMPLATE = (aolActivePayload && aolActivePayload.aolComplianceReasons)
      || (savedTmpl && Array.isArray(savedTmpl.reasons) && savedTmpl.reasons.length ? savedTmpl.reasons.slice() : DEFAULT_REASONS.slice());
    // ROOT CAUSE (proven on the live console): clicking does nothing; ONLY `checked=true + change`
    // commits the model AND persists. NO scrollIntoView — scrolling triggers AOL's re-render error
    // ("Cannot destructure 'id' of null") that drops ticks; set+change works on off-screen nodes.
    // One tick at a time with a settle pause = a clean $digest each time (a burst makes Angular throw).
    async function tickReasonsSequential() {
      for (var i = 0; i < RO_REASON_TEMPLATE.length; i += 1) {
        var phrase = RO_REASON_TEMPLATE[i];
        var cb = allRaw("input[type=checkbox]").find(function (c) {
          if (c.checked) return false;
          var lab = labelFor(c); if (!lab || lab.getBoundingClientRect().width <= 0) return false;
          return key(textOf(lab)).indexOf(key(phrase)) >= 0;
        });
        if (cb) { tickStyledCheckbox(cb); await sleep(380); }
      }
    }
    // ENFORCE the template: untick anything WRONG left in the report's feature groups — "Other" (always,
    // it opens a required text box) + any reason NOT in the template (e.g. a previous "tick everything"
    // draft). Scoped BELOW the first "Loan Features/Rate type" heading so the interview checkbox above
    // is never touched. Declarations ("understood the risks"/"Yes") are kept.
    function wrongCheckedBoxes() {
      var anchor = all("div,span,p,h3,h4,strong").find(function (e) { return /loan features|^rate type/i.test(norm(textOf(e))) && textOf(e).length < 80 && isVisible(e); });
      var anchorY = anchor ? anchor.getBoundingClientRect().top : -1e9;
      return allRaw("input[type=checkbox]").filter(function (c) {
        if (!c.checked) return false;
        var lab = labelFor(c); if (!lab || lab.getBoundingClientRect().width <= 0) return false;
        var t = norm(textOf(lab)), tk = key(t);
        if (/^yes$/i.test(t) || /understood the risks|have been explained|ensured (that )?each applicant/i.test(t)) return false; // declaration → keep
        var isOther = /^other\b|please provide details/i.test(t);
        var inTemplate = RO_REASON_TEMPLATE.some(function (p) { return tk.indexOf(key(p)) >= 0 || key(p).indexOf(tk) >= 0; });
        var inReport = lab.getBoundingClientRect().top >= anchorY - 4;
        return isOther || (inReport && !inTemplate);
      });
    }
    // Untick wrong reasons ("Other" + non-template) with VERIFY + RETRY: a re-render can re-hydrate a
    // box from the saved draft, so re-scan up to 3 passes until none remain. Returns counts for the report.
    async function enforceUntick() {
      var unticked = 0;
      for (var attempt = 0; attempt < 3; attempt += 1) {
        var targets = wrongCheckedBoxes();
        if (!targets.length) break;
        for (var i = 0; i < targets.length; i += 1) { untickStyledCheckbox(targets[i]); unticked += 1; await sleep(340); }
      }
      return { unticked: unticked, stillChecked: wrongCheckedBoxes().length };
    }
    // Risk declarations: the "I have ensured … understood the risks" / "Yes" acknowledgement under each
    // feature (wording varies by lender). Never matches a reason or "Other".
    async function tickDeclarationsSequential() {
      for (var pass = 0; pass < 16; pass += 1) {
        var dcb = allRaw("input[type=checkbox]").find(function (c) {
          if (c.checked) return false;
          var lab = labelFor(c); if (!lab || lab.getBoundingClientRect().width <= 0) return false;
          var t = norm(textOf(lab));
          return /^yes$/i.test(t) || /understood the risks|have been explained|ensured (that )?each applicant/i.test(t);
        });
        if (!dcb) break;
        tickStyledCheckbox(dcb); await sleep(360);
      }
    }
    await tickReasonsSequential();      // pass 1: the template reasons
    await tickDeclarationsSequential(); // each risk acknowledgement
    await tickReasonsSequential();      // pass 2: catch any feature that rendered late
    var untick = await enforceUntick(); // LAST (no ticking after, so nothing re-hydrates): clear Other + wrong
    addFilled(result, "AOL R&O: unticked " + untick.unticked + " wrong (Other/non-template)" + (untick.stillChecked ? " — " + untick.stillChecked + " still stuck" : ""));
    var tickedCount = allRaw("input[type=checkbox]").filter(function (c) { var lab = labelFor(c); return c.checked && lab && lab.getBoundingClientRect().width > 0; }).length;
    // Start AOL only READS + APPLIES the lender template (it does NOT overwrite it — the broker teaches
    // deliberately via the "Learn / Apply R&O" button so an auto-run can never clobber a taught template).
    addFilled(result, "AOL R&O: applied " + lenderCode + " template (" + RO_REASON_TEMPLATE.length + " reasons)");
    // Product-selection NARRATIVE ← the broker's own Infinity narrative (Loans/Securities objectives
    // + Recommendation justifications). Copying the broker's own text, not bot-generating a declaration.
    var rec = objectAtPath(aolActivePayload, ["infinity", "recommendation"]) || {};
    var lpc = objectAtPath(aolActivePayload, ["infinity", "loansSecuritiesCommentary"]) || {};
    // De-duplicate sentences across the Infinity fields (they overlap) + cap at ~1800 chars (AOL limit 2000).
    var raw = [lpc.circumstancesObjectivesPriorities, rec.goalsObjectives, rec.loanFeatures, rec.lenderRecommended].filter(Boolean).join(" ");
    var seenS = {}, sents = [];
    raw.split(/(?<=[.!?])\s+/).forEach(function (sn) { var t = norm(sn); var k = key(t); if (t && !seenS[k]) { seenS[k] = 1; sents.push(t); } });
    var narrative = sents.join(" ").trim();
    // Substitute the real lender for the [LENDER] placeholder / the old "Pepper Money" template default.
    var scn = ((aolActivePayload && aolActivePayload.lenderScenarios) || []);
    var scLender = scn.length ? detectAolLender(scn) : null;
    var lenderName = (scLender && scLender.lender) || "the recommended lender";
    narrative = narrative.replace(/\[lender\]/gi, lenderName).replace(/pepper money/gi, lenderName);
    if (narrative.length > 1850) narrative = narrative.slice(0, 1850).replace(/\s+\S*$/, "").replace(/[,;]\s*$/, "") + ".";
    if (narrative) {
      var ta = all("textarea").filter(isVisible).find(function (t) { var box = t.closest("div"); return box && /product selection|concise narrative/i.test(textOf(box)); }) || all("textarea").filter(isVisible).pop();
      // Fill if empty OR overwrite a previous run's bad value (too long, or still has the wrong
      // "Pepper Money" / [LENDER] placeholder). Don't clobber a clean broker edit.
      var curVal = String((ta && ta.value) || "");
      if (ta && (!curVal.trim() || curVal.length > 1950 || /pepper money|\[lender\]/i.test(curVal))) {
        setNativeValue(ta, ""); fire(ta, "input");
        setInputCommit(ta, narrative);
        addFilled(result, "AOL Compliance: product-selection narrative ← Infinity (" + narrative.length + " chars)");
      }
    } else { addManual(result, "R&O · Product-selection narrative (BID)", "write the concise product-selection summary", "AOL · Compliance"); }
    // BID is the broker's responsibility — bot ticks the reasons/declarations, broker VERIFIES them.
    addManual(result, "R&O · verify feature reasons + declarations", "confirm the auto-ticked reason(s) for variable/P&I/offset/redraw + Broker Declarations are correct (broker BID)", "AOL · Compliance");
    addFilled(result, "AOL Compliance: anticipated changes + interview + R&O reasons/declarations (" + tickedCount + " checkboxes ticked)");
  }

  // Add a Statement of position: date=today, tick the applicant "Included", Has signed = Yes.
  async function fixAolStatementOfPosition(result, aolNow) {
    // The ADD control is <button class="add-button">Statement of position</button> (the "+" is a CSS
    // icon, not text). There's ALSO a left-nav <a class="tracking-list-item-link"> with the same text —
    // clicking that just navigates and never opens the form (the old bug: ddmmInputs=0). Target the
    // add-button, and never the nav link.
    var addBtn = allRaw("button").find(function (el) { return /statement of position/i.test(norm(textOf(el))) && /add-button/i.test(el.className || "") && el.getBoundingClientRect().width > 0; }) ||
      all("button,a").find(function (el) { return /statement of position/i.test(norm(textOf(el))) && isVisible(el) && textOf(el).length < 40 && !/tracking-list-item-link|list-item/i.test(el.className || ""); });
    // AOL requires EXACTLY ONE Statement of Position per applicant. Each Start AOL was adding another row
    // (the old pencil-by-geometry dedup missed the existing row), causing the "must be party to only one
    // statement of position" error. Recompute the SoP section bounds + its delete (trash) icons fresh each
    // pass (the list re-renders after a delete), and remove extras down to one.
    function sopSection() {
      var sh = all("h1,h2,h3,h4,div,span").find(function (e) { return /^statement of position$/i.test(norm(textOf(e))) && textOf(e).length < 30 && isVisible(e); });
      var rh = all("h1,h2,h3,h4,div,span").find(function (e) { return /real estate asset/i.test(norm(textOf(e))) && textOf(e).length < 30 && isVisible(e); });
      var top = sh ? sh.getBoundingClientRect().bottom : -1e9, bot = rh ? rh.getBoundingClientRect().top : (top + 460);
      return { top: top, bot: bot };
    }
    function sopTrashes() {
      var s = sopSection();
      return all("i,span,a,button").filter(function (e) {
        var r = e.getBoundingClientRect();
        var c = (e.className || "") + " " + ((e.getAttribute && (e.getAttribute("title") || e.getAttribute("aria-label"))) || "");
        return /trash|fa-trash|fa-times|\bdelete\b|remove/i.test(c) && isVisible(e) && r.width > 0 && r.top > s.top + 2 && r.top < s.bot;
      });
    }
    var ddg = 0;
    while (ddg++ < 10) {
      var trs = sopTrashes();
      if (trs.length <= 1) break;                 // keep one SoP, never delete the last
      clickOnce(trs[trs.length - 1]);             // remove the most recent extra row
      await waitForSettle(4000, 400);
      var okDel = all("button,a").find(function (b) { return /^(ok|yes|delete|confirm|remove)$/i.test(norm(textOf(b))) && isVisible(b); });
      if (okDel) { clickOnce(okDel); await sleep(700); }
      if (ddg === 1) addFilled(result, "AOL: removed duplicate Statement of position row(s)");
    }
    // Re-evaluate AFTER dedup (layout shifted). Edit the existing row, or add ONLY if none exists.
    var s2 = sopSection(), sopTop = s2.top, sopBot = s2.bot;
    var existingDate = allRaw('input[placeholder*="dd/mm" i]').filter(function (e) { return e.getBoundingClientRect().width > 0; })[0];
    var editPencil = all("i,span,a,button").find(function (e) { var r = e.getBoundingClientRect(); return /fa-pencil|pencil|fa-edit|\bedit\b/i.test(e.className || "") && isVisible(e) && r.width < 42 && r.top > sopTop && r.top < sopBot; });
    var hasExistingSoP = sopTrashes().length > 0 || !!editPencil;
    if (!existingDate) {
      if (hasExistingSoP) {
        if (editPencil) { clickOnce(editPencil); await waitForSettle(5000, 400); }   // open the existing row to set its date
        else { addFilled(result, "AOL Statement of position already present — not adding a duplicate."); return; }
      } else if (addBtn) { clickOnce(addBtn); await waitForSettle(5000, 400); }       // none yet → add one
      else { addIssue(result, "Financials", "Statement of position", "could not open/add the SoP row — add it manually (date today, tick applicant, Has signed = Yes)"); return; }
    }
    // Date input: ONLY a visible dd/mm/yyyy input whose wrapper has the calendar button (= the SoP date).
    // Do NOT fall back to controlNearLabel / first-dd-mm — a fuzzy match once hit an expense amount and
    // wrote "$20,062,026". If no proper SoP date field is found, skip (better than corrupting a field).
    var ddmm = allRaw('input[placeholder*="dd/mm" i],input[placeholder*="dd mmm" i]').filter(function (e) { return e.getBoundingClientRect().width > 0; });
    var dateEl = ddmm.filter(function (e) {
      var w = (e.closest && e.closest(".date-picker-wrapper,.input-wrapper")) || e.parentElement;
      return w && w.querySelector && w.querySelector(".fa-calendar,[class*='calendar']");
    })[0];
    if (dateEl && dateEl.tagName !== "SELECT") {
      // SoP date = the INTERVIEW date (same source as Infinity → they match), NOT today. Pick it on the
      // calendar (ngx-bootstrap won't commit a typed value); typing the AU string is the fallback.
      var sopDate = payloadDate(objectAtPath(aolActivePayload, ["aol", "financials", "statementOfPositionDate"]));
      var picked = await pickAolDate(dateEl, sopDate);
      if (!picked || !String(dateEl.value || "").trim()) { typeDateValue(dateEl, auStr(sopDate)); } // typing fallback
      addFilled(result, "AOL Statement of position: date = " + (String(dateEl.value || "").trim() || "(empty)"));
    }
    await sleep(400);
    // Tick the "Included" applicant checkbox. It's a styled/hidden native input (clickOnce skips it
    // because isVisible is false), so call the native input.click() directly (renders Has-signed Y/N).
    var cb = allRaw("input[type=checkbox]").find(function (c) {
      if (c.checked) return false;
      var lab = (c.id && document.querySelector('label[for="' + c.id + '"]')) || c.closest("label");
      return lab && lab.getBoundingClientRect().width > 0 && lab.getBoundingClientRect().left < 700;
    });
    if (cb) { tickStyledCheckbox(cb); await waitForSettle(3000, 350); } // wait for the Has-signed Y/N to render
    clickYesNoByLabel(result, "Statement of position", "has signed", "Yes");
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    await sleep(700);
    addFilled(result, "AOL Statement of position: date + applicant + Has signed = Yes");
    closeAolModal(); await waitForSettle(3000, 380); dismissAnyAolModal();
    await sleep(800);
  }

  // Fill the two REQUIRED-empty Employer fields AOL flags ("Business name" + Contact "Surname"). These
  // get lost because Business name is a SEARCH typeahead (a pushed value without a selection doesn't
  // stick). Opens the Employment modal → fills only the empty required fields → Done → close. Defensive:
  // never breaks the run; only fills empty fields; the surname is targeted as the lastName input BELOW
  // the ABN so it can't hit the applicant's surname. DOM confirmed 2026-06-21 via console dump.
  async function fixAolEmployment(result) {
    var btn = allRaw('button[qeid="editEmployment"]').filter(isVisible)[0];
    if (!btn) return;
    var ap = objectAtPath(aolActivePayload, ["aol", "applicants"]) || {};
    var employerName = ap.employmentName || findFirstString(aolActivePayload, ["employerName", "employmentName", "employer"]) || "";
    var surname = ap.familyName || ap.surname || findFirstString(aolActivePayload, ["familyName", "surname", "lastName"]) || "";
    try {
      clickOnce(btn);
      await waitForSettle(5000, 420);
      var filled = 0;
      // Business name (qeid="searchControl" typeahead) — type so the search component registers it.
      var bn = allRaw('input[qeid="searchControl"]').filter(isVisible)[0];
      if (bn && !String(bn.value || "").trim() && employerName && !looksMoneyField(bn)) {
        bn.focus(); setNativeValue(bn, employerName);
        bn.dispatchEvent(new Event("input", { bubbles: true }));
        bn.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true }));
        bn.dispatchEvent(new Event("change", { bubbles: true }));
        addFilled(result, "AOL Employment: Business name = " + employerName); filled += 1;
        addManual(result, "Employment · Business name", "bot typed '" + employerName + "' — if AOL clears it, use the business Search + pick the result", "AOL · Applicants");
      }
      // Employer contact Surname = the lastName input positioned BELOW the ABN (NOT the applicant's surname).
      var abn = first('input[ng-model="businessAbn"]');
      var empSurname = null;
      if (abn) { var ar = abn.getBoundingClientRect(); empSurname = all('input[ng-model="lastName"]').filter(isVisible).find(function (e) { return e.getBoundingClientRect().top > ar.top; }); }
      if (empSurname && !String(empSurname.value || "").trim() && surname) {
        setInputCommit(empSurname, surname);
        addFilled(result, "AOL Employment: Contact surname = " + surname); filled += 1;
      }
      // Save via Done only if we changed something; else just close.
      if (filled) {
        var done = all("button").find(function (b) { return /^done$/i.test(norm(textOf(b))) && isVisible(b); });
        if (done) { clickOnce(done); await waitForSettle(4500, 380); }
      }
    } catch (e) {
      addAction(result, "Employment fill skipped: " + String((e && e.message) || e));
    } finally {
      try { dismissAnyAolModal(); await waitForSettle(2500, 350); } catch (e) {}
    }
  }

  // RESTORE the broker-override layer (EasyFlow live source): re-fill fields the broker changed after the
  // loan form, if they've been lost. SAFE by design — only fills EMPTY fields, only with the broker's OWN
  // prior value, only same-platform (key match), money-guarded via setInputCommit. Never overwrites; modal
  // typeahead fields aren't scanned here so nothing risky is auto-restored.
  var efOverridesCache = null;
  async function restoreBrokerOverrides(result) {
    var ov = efOverridesCache;
    if (!ov || typeof ov !== "object") return;
    var platform = /applyonline|loankit/i.test(location.href) ? "aol" : "infinity";
    var filled = 0, fixed = 0;
    all("input,select,textarea").forEach(function (el) {
      if (!isVisible(el)) return;
      var t = (el.type || "").toLowerCase();
      if (/^(hidden|checkbox|radio|button|submit|password|file|search)$/.test(t)) return;
      if (el.closest && el.closest('[id^="ef-"]')) return;
      var o = ov[efFieldKey(el)];
      if (!o || o.value == null || o.value === "" || o.platform !== platform) return;
      var isSel = el.tagName === "SELECT";
      var empty = isSel ? !el.value : !String(el.value || "").trim();
      if (empty) {                                          // (a) fill empty — always safe
        if (isSel) { if (setSelectValue(el, o.value)) filled += 1; }
        else { setInputCommit(el, String(o.value)); if (String(el.value || "").trim()) filled += 1; }
        return;
      }
      // (b) OVERRIDE-WINS over a stale loan-form value the bot just filled — but ONLY for a TEXT field
      // whose ng-model/qeid is UNIQUE on the page (no collision = can't hit the wrong field) and whose
      // value actually differs. Selects stay empty-only (safer). money-guarded via setInputCommit.
      if (isSel) return;
      if (norm(String(el.value || "")) === norm(String(o.value))) return; // already equal
      var ng = el.getAttribute && (el.getAttribute("ng-model") || el.getAttribute("formcontrolname") || el.getAttribute("qeid"));
      if (!ng) return;
      if (allRaw('[ng-model="' + ng + '"],[formcontrolname="' + ng + '"],[qeid="' + ng + '"]').filter(isVisible).length !== 1) return; // ambiguous → skip
      setInputCommit(el, String(o.value));
      fixed += 1;
    });
    if (filled || fixed) addAction(result, "EasyFlow live source: filled " + filled + " empty + corrected " + fixed + " field(s) to broker value");
  }

  async function runAol(payload, mapping, apiBase) {
    var result = {
      ok: false, target: "aol", startedAt: new Date().toISOString(),
      fieldsFilled: [], fieldsSkipped: [], errors: [], actions: [], issues: [], verificationFailures: [],
      aolTabs: {}, manualActions: [],
      steps: [
        { id: "aolApplication", label: "AOL: Application", status: "pending" },
        { id: "aolApplicants", label: "AOL: Applicants", status: "pending" },
        { id: "aolLoans", label: "AOL: Loans", status: "pending" },
        { id: "aolSecurities", label: "AOL: Securities", status: "pending" },
        { id: "aolFinancials", label: "AOL: Financials", status: "pending" },
        { id: "aolCompliance", label: "AOL: Compliance", status: "pending" }
      ]
    };
    stopRequested = false;
    aolActivePayload = payload;
    brokerCtx.pageKey = efPageKey();      // arm auto capture-back for THIS AOL doc only
    try { efOverridesCache = (await efGetCapture("brokerOverrides")) || {}; } catch (e) { efOverridesCache = {}; } // live-source layer
    // Surface "customer updated the loan form after submitting" (server records the diff) so the broker
    // re-checks the changed fields on Infinity/AOL.
    try {
      var lfc = await efGetCapture("loanFormChanges");
      if (lfc && lfc.changes && lfc.changes.length) {
        addManual(result, "⚠ Client updated the loan form (v" + (lfc.version || "?") + ")", lfc.changes.slice(0, 8).map(function (c) { return c.field + ": " + c.from + "→" + c.to; }).join("; "), "Loan Form · Client changes");
      }
    } catch (e) { /* non-fatal */ }
    var aol = objectAtPath(payload, ["aol"]) || {};
    try {
      var ap = aol.applicants || {}, ln = aol.loans || {}, appn = aol.application || {};

      await fillAolTab(result, "application-tab", "Application", function () {
        applyAolFields(result, "Application", [["Receive Loan Offer Documentation Method", "Email"]]);
        clickYesNoByLabel(result, "Application", "Government Guarantee Scheme", "No");
        clickYesNoByLabel(result, "Application", "Dual, Health business banker", "No");
        // Bottom narrative textareas. Lenders vary (1–3 of: Comments / Loan Objectives / Customer
        // Preference) but typically only ONE is required — fill every one that's present (empty) so the
        // required one is always covered. Text comes from the prepared Infinity narrative.
        var recA = objectAtPath(aolActivePayload, ["infinity", "recommendation"]) || {};
        var lpcA = objectAtPath(aolActivePayload, ["infinity", "loansSecuritiesCommentary"]) || {};
        function fillNarrativeTa(label, text) {
          if (!text) return;
          var el = controlNearLabel(label, document);
          if (el && el.tagName === "TEXTAREA" && !String(el.value || "").trim()) { setInputCommit(el, text); addFilled(result, "AOL Application: " + label); }
        }
        fillNarrativeTa("Comments", appn.originatorComments);
        fillNarrativeTa("Loan Objectives", recA.goalsObjectives || lpcA.circumstancesObjectivesPriorities || appn.originatorComments);
        fillNarrativeTa("Customer Preference", recA.loanFeatures || recA.goalsObjectives || appn.originatorComments);
      });
      step(result, "aolApplication", "done");

      await fillAolTab(result, "applicants-tab/applicants/0-P1", "Applicants", async function () {
        applyAolFields(result, "Applicants", [
          ["Residency status", mapResidency(ap.residencyStatus)],
          ["Preferred contact method", "No Preference"]
        ]);
        clickYesNoByLabel(result, "Applicants", "spouse", "No");
        clickYesNoByLabel(result, "Applicants", "dependants", ap.hasDependants || "No");
        clickYesNoByLabel(result, "Applicants", "permanent Australian resident", ap.permanentResident || "Yes");
        clickYesNoByLabel(result, "Applicants", "foreign tax resident", "No");
        clickYesNoByLabel(result, "Applicants", "existing customer", ap.customerOfLender || "No");
        clickYesNoByLabel(result, "Applicants", "Employee of", ap.employeeOfLender || "No");
        clickYesNoByLabel(result, "Applicants", "First Home Buyer", ap.firstHomeBuyer || "No");
        clickYesNoByLabel(result, "Applicants", "credit authority signed", "Yes");
        // Face-to-face identity check = Yes ONLY if the client is in the broker's home state (SA /
        // Adelaide); interstate clients (e.g. NSW) → No. Broker = Easy Loan Finance, Adelaide SA.
        var addrStr = String(ap.currentResidentialAddress || objectAtPath(aolActivePayload, ["infinity", "applicants", 0, "currentAddress"]) || objectAtPath(aolActivePayload, ["infinity", "clientDetails", "address"]) || "");
        var clientInSA = /\bSA\b|south australia|adelaide/i.test(addrStr);
        clickYesNoByLabel(result, "Applicants", "face to face identity", clientInSA ? "Yes" : "No");
        // ID document + Income are auto-populated (pushed from Infinity/lodgement). Only Employment's
        // Occupation is a type-ahead the broker picks — note it for verification.
        // Employer is a NEW employer the broker enters by hand — the loan form has OLD/Self-Employed data,
        // so the bot must NOT push loan-form values into the Employer fields (that's wrong data). Just remind.
        if (allRaw('button[qeid="editEmployment"]').filter(isVisible).length) addManual(result, "⚠ Employer — Business name (select by hand)", "Open Employment → Business name: type the company, then CLICK the correct match from the search list. The bot does NOT auto-pick (avoids the wrong company / wrong ABN on a live file). Contact surname + Occupation are auto-filled/restored. Loan form has old Self-Employed data — not used.", "AOL · Applicants");
      });
      step(result, "aolApplicants", "done");

      await fillAolTab(result, "loans-tab", "Loans", async function () {
        // The loan split form is collapsed by default — expand it via its pencil (span.fa-pencil).
        var pencils = all("span.fa-pencil, .fa-pencil").filter(isVisible);
        var splitPencil = pencils.find(function (el) {
          var box = el.closest("div,section,li");
          var t = box ? textOf(box) : "";
          return /loan split|owner occupied|principal|p & i|30 yrs|275,?000/i.test(t) && !/payment method|^type/i.test(t.slice(0, 40));
        }) || pencils[pencils.length - 1];
        if (splitPencil) { clickOnce(splitPencil); await waitForSettle(5000, 400); }
        // These 4 are plain <select>s — target by ng-model (Primary purpose has none → by its options).
        // applyAolFields' label search missed them; ng-model is exact + reliable.
        function setLoanSel(ng, value, label) {
          var sel = first('select[ng-model="' + ng + '"]');
          if (sel && setSelectValue(sel, value)) { addFilled(result, "AOL Loans: " + label + " = " + value); return true; }
          addSkipped(result, "AOL Loans: " + label, sel ? "value-not-in-options" : "select-not-found"); return false;
        }
        setLoanSel("repaymentType", ln.repaymentType || "Principal & Interest", "Repayment type");
        setLoanSel("repaymentFrequency", ln.repaymentFrequency || "Monthly", "Repayment frequency");
        setLoanSel("lmiPremiumPaymentMethod", "To be added to Loan Amount", "LMI payment method");
        // Primary purpose: the <select> whose options include Owner Occupied + Investment (no ng-model).
        var ppSel = all("select").filter(isVisible).find(function (s) {
          return Array.prototype.some.call(s.options, function (o) { return /owner occupied/i.test(o.text); }) &&
                 Array.prototype.some.call(s.options, function (o) { return /^\s*investment\s*$/i.test(o.text); });
        });
        if (ppSel) {
          var pp = /investment/i.test(ln.primaryPurpose || "") ? "Investment" : "Owner Occupied";
          if (setSelectValue(ppSel, pp)) addFilled(result, "AOL Loans: Primary purpose = " + pp);
        } else { addSkipped(result, "AOL Loans: Primary purpose", "select-not-found"); }
        // Application/Loan fee: AOL flags "Payment method is required for Fee N". Open each fee row
        // (its edit control is <button qeid="editFee"> with a fa-pencil), set the required Payment
        // method = "Included in Loan Amount", then save/close. Re-query each pass (the list re-renders).
        var feeCount = allRaw('button[qeid="editFee"]').filter(isVisible).length;
        for (var fi = 0; fi < feeCount && fi < 5; fi += 1) {
          var feeBtns = allRaw('button[qeid="editFee"]').filter(isVisible);
          if (!feeBtns[fi]) break;
          clickOnce(feeBtns[fi]);
          await waitFor(function () { return first('select[ng-model="paymentMethod"]'); }, 4000);
          var pm = first('select[ng-model="paymentMethod"]');
          if (pm && !pm.value) { if (setSelectValue(pm, "Included in Loan Amount")) addFilled(result, "AOL Loans: Fee " + (fi + 1) + " payment method = Included in Loan Amount"); }
          if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
          await sleep(400);
          closeAolModal(); await waitForSettle(3500, 380); dismissAnyAolModal();
        }
        // Product Selector value comes from Infinity Preferred Features (matched by lender).
        noteAolProductSelector(result);
        // The "Loan feature" (Offset/Redraw) modal stays open after editing. Its close control is a
        // <span class="acl-close-button__icon fa fa-close-thin"> (confirmed from DOM) — click every
        // visible one to dismiss the modal(s) before the run navigates to the next tab.
        var doneBtns = all("button,a").filter(function (b) { return /^\s*done\s*$/i.test(norm(textOf(b))) && isVisible(b); });
        for (var di = 0; di < doneBtns.length; di += 1) { clickOnce(doneBtns[di]); await sleep(700); }
        var closeIcons = all(".acl-close-button__icon, .fa-close-thin").filter(isVisible);
        for (var ci = 0; ci < closeIcons.length; ci += 1) { clickOnce(closeIcons[ci].closest("button,a,span") || closeIcons[ci]); await sleep(600); }
        document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
        await sleep(500);
      });
      step(result, "aolLoans", "done");

      var se = aol.securities || {};
      var aolContact = se.contactForAccess || (ap.firstName ? (ap.firstName + " " + (ap.familyName || "")) : "");
      var hasSecondary = !!(objectAtPath(aolActivePayload, ["applicants", "secondary", "firstName"]) || asArray(objectAtPath(aolActivePayload, ["infinity", "applicants"])).length > 1);
      var holding = se.holding || (hasSecondary ? "Joint Tenants" : "Sole");
      await fillAolTab(result, "securities-tab", "Securities", function () {
        applyAolFields(result, "Securities", [
          ["Title type", se.titleType],
          ["Contact", aolContact],
          ["Transfer of land amount", se.transferOfLandAmount || se.estimatedValue],
          ["Holding", holding]
        ]);
        // Strata/complex concentration + off-the-plan risk questions (No for a standard purchase).
        clickYesNoByLabel(result, "Securities", "Off the plan", se.offThePlan || "No");
        clickYesNoByLabel(result, "Securities", "own 3 units", se.ownThreeUnits || "No");
        clickYesNoByLabel(result, "Securities", "own 25", se.ownTwentyFivePercent || "No");
      });
      step(result, "aolSecurities", "done");

      var aolNow = (function () { var d = new Date(); return ("0" + d.getDate()).slice(-2) + "/" + ("0" + (d.getMonth() + 1)).slice(-2) + "/" + d.getFullYear(); })();
      await fillAolTab(result, "financials-tab", "Financials", async function () {
        // The Financials page renders its sections (Statement of position / assets / expenses)
        // PROGRESSIVELY — wait for the content before the SoP/Savings sub-fills, else they run too early
        // and report "could not find/open the row" (a timing false-negative, not a real failure).
        await waitFor(function () {
          var sop = all("h1,h2,h3,h4,div,span,td").some(function (e) { return /statement of position/i.test(norm(textOf(e))) && isVisible(e); });
          var rows = all("a,td,span,div").some(function (e) { return /savings account|other assets|real estate|clothing|groceries|transport/i.test(norm(textOf(e))) && isVisible(e); });
          return sop && rows;
        }, 9000, 200);
        applyAolFields(result, "Financials", [["Statement of position date", aolNow]]);
        // Statement of position: add one, type the date (char-by-char), tick applicant, Has signed = Yes.
        await fixAolStatementOfPosition(result, aolNow);
        // Deterministic confirmation toggles (clear the structural Financials errors).
        var hasLiab = asArray(objectAtPath(aolActivePayload, ["infinity", "financials", "liabilities"])).length > 0;
        clickYesNoByLabel(result, "Financials", "no liabilities", hasLiab ? "No" : "Yes");
        clickYesNoByLabel(result, "Financials", "expense categories have been reviewed", "Yes");
        clickYesNoByLabel(result, "Financials", "no incomes", "No");
        // Savings Account required interest fields (deterministic $0/Monthly).
        await fixAolSavingsInterest(result);
        // Auto-delete the duplicate BaseSalary income row.
        await fixAolIncomeJunk(result);
        // Motor Vehicle: set the required vehicle "Type" dropdown to Medium (year/make stay manual).
        await fixAolMotorVehicle(result);
        // Expense amounts are reconciled via the Compare Infinity/AOL panel (deliberate sync).
      });
      step(result, "aolFinancials", "done");
      await fillAolTab(result, "compliance-tab", "Compliance", async function () {
        await fixAolCompliance(result);
      });
      step(result, "aolCompliance", "done");

      // Remaining broker-only manual steps for AOL (kept minimal — only what the bot can't do).
      addManual(result, "Branch to sign documents", "select the branch", "AOL · Application");
      addManual(result, "Review all tabs, then Lodge to lender", "bot never submits — broker lodges", "Final");

      result.ok = result.issues.length === 0 && !stopRequested;
      result.actions.push("AOL auto-navigated all tabs + filled known required fields. " + result.manualActions.length + " manual step(s) listed in the broker checklist. Broker reviews + Lodges (no auto-submit).");
    } catch (err) {
      result.errors.push(err && err.stack ? err.stack : String(err));
      result.ok = false;
    }
    result.aolMeta = {
      url: location.href,
      framework: (window.angular ? "angularjs" : (document.querySelector("[ng-version]") ? "angular" : ((window.React || document.querySelector("#root")) ? "react" : "?")))
    };
    result.finishedAt = new Date().toISOString();
    lastReport = result;
    finishStatus(result, result.ok ? "AOL tabs filled" : "AOL needs review");
    await persistChecklist("aolManualChecklist", result.manualActions);
    await showManualChecklist(result.manualActions, "AOL — broker manual steps", "aolManualChecklist");
    return result;
  }

  function collectAolDiagnostics() {
    function nearLabel(e) {
      var b = e.closest("div,td,li,label,section"), t = "";
      for (var i = 0; i < 4 && b && !t; i += 1, b = b.parentElement) {
        var l = b.querySelector("label");
        if (l) t = norm(textOf(l)).slice(0, 40);
      }
      return t;
    }
    function isRequired(e) {
      var box = e.closest("div,td,li,section");
      if (box && /\brequired\.?/i.test(textOf(box).slice(0, 220))) return true;
      var cs = window.getComputedStyle(e);
      var m = String(cs.borderTopColor || cs.borderColor || "").match(/(\d+),\s*(\d+),\s*(\d+)/);
      if (m && Number(m[1]) > 150 && Number(m[2]) < 110 && Number(m[3]) < 110) return true;
      return /\b(ng-invalid|is-invalid|has-error|invalid|required)\b/.test(String(e.className || ""));
    }
    var fields = all("input,select,textarea").filter(isVisible).map(function (e) {
      return {
        tag: e.tagName.toLowerCase(),
        type: e.type || "",
        ng: e.getAttribute("ng-model") || "",
        id: e.id || "",
        name: e.name || "",
        ph: e.getAttribute("placeholder") || "",
        opts: e.tagName === "SELECT" ? Array.prototype.slice.call(e.options).slice(0, 6).map(function (o) { return norm(o.textContent); }) : undefined,
        near: nearLabel(e),
        required: isRequired(e),
        value: e.tagName === "SELECT" || e.type === "checkbox" ? undefined : (e.value || "").slice(0, 30)
      };
    });
    fields.sort(function (a, b) { return (b.required ? 1 : 0) - (a.required ? 1 : 0); });
    return fields.slice(0, 90);
  }

  // LEARN + APPLY the R&O reason ticks on the CURRENTLY-OPEN report (broker opened it manually, so the
  // body is rendered — the bot can't render it during auto-nav). Learns from whatever the broker has
  // ticked (saved per lender), unticks "Other"/non-template, ensures the template reasons + risk
  // declarations are ticked. One button = teach on the first case, auto-apply on the next.
  async function roLearnApply(payload, apiBase, caseId) {
    if (apiBase) brokerCtx.apiBase = apiBase;
    if (caseId) brokerCtx.caseId = caseId;
    aolActivePayload = payload || aolActivePayload;
    function labFor(c) { return (c.id && document.querySelector('label[for="' + c.id + '"]')) || c.closest("label"); }
    function roBoxes() {
      return allRaw("input[type=checkbox]").filter(function (c) {
        var l = labFor(c); return l && l.querySelector && l.querySelector(".checkbox-box") && l.getBoundingClientRect().width > 0;
      });
    }
    function isDeclLabel(t) { return /^yes$/i.test(t) || /understood the risks|have been explained|ensured (that )?each applicant/i.test(t); }
    var present = roBoxes().length;
    if (present < 3) return { ok: false, error: "Open Compliance → Reports → 'Requirements & Objectives' first (report not showing checkboxes yet)." };
    var lender = detectAolLenderCode();
    // TWO modes, decided by whether the broker has ticked reasons:
    //  • TEACH (broker ticked some): that EXACT set becomes the lender template (overwrite) + applied.
    //  • APPLY (nothing ticked): use the saved lender template (or the gold defaults), don't overwrite.
    var brokerChecked = scrapeCheckedReasonPhrases();
    var mode, template, doSave = false;
    if (brokerChecked.length) {
      mode = "teach"; template = brokerChecked.slice(); doSave = true;
    } else {
      mode = "apply";
      var saved = await efGetTemplate(lender);
      template = (saved && Array.isArray(saved.reasons) && saved.reasons.length)
        ? saved.reasons.slice()
        : ["flexibility with respect to repayment", "minimise interest paid", "build up equity from the start", "allows access to funds", "flexibility to access prepaid funds", "longest loan term available"];
    }
    // 2) APPLY — untick "Other" + non-template (verify/retry), then tick template + declarations.
    var unticked = 0, ticked = 0;
    for (var ua = 0; ua < 3; ua += 1) {
      var wrong = roBoxes().filter(function (c) {
        if (!c.checked) return false;
        var t = norm(textOf(labFor(c))), tk = key(t);
        if (isDeclLabel(t)) return false;
        var isOther = /^other\b|please provide details/i.test(t);
        var inTpl = template.some(function (p) { return tk.indexOf(key(p)) >= 0 || key(p).indexOf(tk) >= 0; });
        return isOther || !inTpl;
      });
      if (!wrong.length) break;
      for (var wi = 0; wi < wrong.length; wi += 1) { untickStyledCheckbox(wrong[wi]); unticked += 1; await sleep(340); }
    }
    for (var ti = 0; ti < template.length; ti += 1) {
      var phrase = template[ti];
      var cb = roBoxes().find(function (c) { return !c.checked && key(textOf(labFor(c))).indexOf(key(phrase)) >= 0; });
      if (cb) { tickStyledCheckbox(cb); ticked += 1; await sleep(360); }
    }
    for (var di = 0; di < 16; di += 1) {
      var dcb = roBoxes().find(function (c) { return !c.checked && isDeclLabel(norm(textOf(labFor(c)))); });
      if (!dcb) break;
      tickStyledCheckbox(dcb); ticked += 1; await sleep(340);
    }
    // Answer the Yes/No radio questions too (so the button does the FULL R&O, same as Start AOL).
    // TWO passes: "preferred lender" reveals the "any other requirements not already stated" question.
    var radioQs = ["secondary purpose for debt", "secondary purpose for refinance", "conflicts between", "preferred lender or lenders", "other requirements and objectives not already stated"];
    for (var rp = 0; rp < 2; rp += 1) {
      for (var rqi = 0; rqi < radioQs.length; rqi += 1) { complianceAnswer(radioQs[rqi], "No"); await sleep(450); }
      await sleep(600);
    }
    // SAVE only in TEACH mode (deliberate overwrite). APPLY mode never writes.
    var savedOk = false;
    if (doSave && lender && lender !== "DEFAULT") savedOk = await efSaveTemplate(lender, { reasons: template, lender: lender, replace: true });
    return { ok: true, lender: lender, mode: mode, learned: template.length, ticked: ticked, unticked: unticked, saved: savedOk, present: present };
  }

  // ===== Reverse sync (symmetric): on the INFINITY tab, push AOL's captured values INTO Infinity =====
  // Infinity expenses are edited via the row's Actions ▸ Edit modal (not a direct input), so we reuse the
  // proven ownership-edit pattern to set "Expense Amount". Broker-triggered + notice.
  async function setInfinityExpenseAmount(type, amount) {
    function rows() {
      return all("tr").filter(function (tr) {
        if (!isVisible(tr)) return false;
        var cells = all("td", tr).map(function (td) { return norm(textOf(td)); }).filter(Boolean);
        return cells.length >= 2 && cells.some(function (c) { return /^\$[\d,]/.test(c); }) && cells.some(function (c) { return /^(monthly|weekly|fortnightly)$/i.test(c); });
      });
    }
    var tr = rows().find(function (r) { var c = all("td", r).map(function (td) { return norm(textOf(td)); }).filter(Boolean)[0] || ""; return key(c).indexOf(key(type)) >= 0 || key(type).indexOf(key(c)) >= 0; });
    if (!tr) return false;
    var ar0 = tr.getBoundingClientRect();
    var actionsBtn = all("button,a", tr).find(function (b) { return /^\s*actions/i.test(norm(textOf(b))); }) || all("button,a").find(function (b) { return /^\s*actions/i.test(norm(textOf(b))) && isVisible(b) && Math.abs(b.getBoundingClientRect().top - ar0.top) < 26; });
    if (!actionsBtn) return false;
    actionsBtn.scrollIntoView({ block: "center" }); await sleep(250); clickOnce(actionsBtn); await sleep(700);
    var ar = actionsBtn.getBoundingClientRect();
    var edits = all("a").filter(function (el) { return /^edit$/i.test(norm(textOf(el))) && isVisible(el); });
    edits.sort(function (a, b) { var ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect(); return (Math.abs(ra.top - ar.bottom) + Math.abs(ra.left - ar.left)) - (Math.abs(rb.top - ar.bottom) + Math.abs(rb.left - ar.left)); });
    if (!edits[0]) { document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); return false; }
    clickOnce(edits[0]);
    await waitFor(function () { return all(".modal-content,.modal-dialog,.modal").find(function (m) { return /expense/i.test(textOf(m)) && isVisible(m); }); }, 5000);
    var modal = all(".modal-content,.modal-dialog,.modal").find(function (m) { return /expense/i.test(textOf(m)) && isVisible(m); });
    if (!modal) { document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); return false; }
    setNumberByLabel(modal, "Expense Amount", amount); await sleep(300);
    var save = all("button,a", modal).find(function (el) { return /save/i.test(textOf(el)) && isVisible(el); });
    if (!save) { document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); return false; }
    clickOnce(save); await waitFor(function () { return !isVisible(modal); }, 4500); await sleep(600);
    return true;
  }
  function buildInfinityExpenseDiff(aolExpenses) {
    var infRows = (scrapeInfinityFinancials().expenses) || [];
    var aol = asArray(aolExpenses);
    function aolAmtForInf(infType) {
      var rule = AOL_EXPENSE_RULES.find(function (r) { return r.inf.some(function (kw) { return key(infType).indexOf(key(kw)) >= 0; }); });
      if (!rule) return null;
      var m = aol.find(function (e) { return rule.aol.test(String(e.type || "").toLowerCase()); });
      return m ? parseMoney(m.amount) : null;
    }
    var diff = [];
    infRows.forEach(function (r) {
      var infAmt = parseMoney(r.amount), aolAmt = aolAmtForInf(r.type);
      if (aolAmt == null) return;
      diff.push({ label: r.type, infinity: infAmt, aol: aolAmt, target: aolAmt, status: Math.abs(infAmt - aolAmt) < 1 ? "match" : "differ" });
    });
    return diff;
  }
  // Same canonical HEM categories + ordering as the AOL-side buildExpenseDiff, so BOTH compare panels
  // show identical labels/rows. On Infinity we don't have AOL's DOM, so AOL values come from the captured
  // aolFinancials; `infLabel` keeps the actual Infinity row name to drive the modal edit.
  function buildInfinityCanonicalDiff(aolExpenses) {
    var infRows = (scrapeInfinityFinancials().expenses) || [];
    var aol = asArray(aolExpenses);
    var diff = [];
    AOL_EXPENSE_RULES.forEach(function (rule) {
      var infRow = infRows.find(function (r) { return rule.inf.some(function (kw) { return key(r.type).indexOf(key(kw)) >= 0; }); });
      var infAmt = infRow ? parseMoney(infRow.amount) : null;
      var aolRow = aol.find(function (e) { return rule.aol.test(String(e.type || "").toLowerCase()); });
      var aolAmt = aolRow ? parseMoney(aolRow.amount) : null;
      if (infAmt == null && aolAmt == null) return; // neither side has this category
      var status;
      if (aolAmt == null) status = "match"; // no AOL value → nothing to push to Infinity
      else if (infAmt == null) status = aolAmt > 0 ? "missing-inf" : "match"; // AOL>0 but no Infinity row → broker adds; AOL $0 = fine
      else status = Math.abs(infAmt - aolAmt) < 1 ? "match" : "differ";
      diff.push({ label: aolRow ? aolRow.type : rule.inf[0], infinity: infAmt, aol: aolAmt, target: aolAmt, status: status, infLabel: infRow ? infRow.type : null });
    });
    return diff;
  }
  // Mirror of showFinancialsCompare (the AOL-side panel) so BOTH tabs show an identical table: same
  // title, canonical HEM labels, full row list, TOTAL row + "✓ reviewed" tick. Only the action differs —
  // here the button updates the Infinity rows (via the Actions▸Edit modal) to match AOL.
  function showInfinityExpenseCompare(diff, noAolData) {
    var existing = document.getElementById("ef-compare"); if (existing) existing.remove();
    var panel = document.createElement("div"); panel.id = "ef-compare";
    var accent = "#0d9488"; // Infinity panel = teal (AOL panel = indigo) so the broker can tell them apart at a glance
    panel.style.cssText = "position:fixed;top:58px;right:16px;z-index:2147483647;background:#fff;border:2px solid " + accent + ";border-top:6px solid " + accent + ";border-radius:12px;box-shadow:0 12px 36px rgba(0,0,0,.3);padding:14px 16px;width:460px;max-height:86vh;overflow:auto;font-family:system-ui,Segoe UI,sans-serif;color:#1f2937;font-size:12.5px;";
    var html = '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">'
      + '<b style="font-size:14px;color:' + accent + ';"><span style="background:' + accent + ';color:#fff;border-radius:6px;padding:1px 7px;font-size:10px;font-weight:800;margin-right:6px;vertical-align:middle;">INFINITY</span>Compare · Loan form / Infinity / AOL</b>'
      + '<button id="ef-cmp-close" style="background:#e5e7eb;border:none;border-radius:6px;width:24px;height:24px;cursor:pointer;font-size:15px;">×</button></div>';
    // PRIMARY broker workflow: edit on Infinity → push those numbers onto the AOL tab. A content script
    // can't touch the AOL tab directly, so we hand the live Infinity expenses to the background worker,
    // which forwards them to the AOL tab (EF_APPLY_FINANCIALS). Indigo = it changes AOL.
    function pushBtnHtml() {
      return '<button id="ef-cmp-push-aol" style="margin-top:8px;background:#4f46e5;color:#fff;border:none;border-radius:8px;padding:10px;width:100%;font-weight:700;cursor:pointer;">📤 Copy the Infinity numbers to AOL</button>' + efPushNoteHtml();
    }
    function wirePushBtn() {
      var pb = panel.querySelector("#ef-cmp-push-aol"); if (!pb) return;
      pb.onclick = function () {
        pb.disabled = true; pb.textContent = "Copying to AOL…";
        var src = getCurrentFinancials(); // live Infinity expenses
        chrome.runtime.sendMessage({ type: "EF_RELAY_TO_AOL", expenses: src.expenses }, function (res) {
          var hadError = !!chrome.runtime.lastError;
          var ok = efHandlePushResult(res, hadError, "AOL", res && res.applied);
          if (!ok) { pb.disabled = false; pb.textContent = "📤 Copy the Infinity numbers to AOL"; pb.style.background = hadError || !res || !res.ok ? "#dc2626" : "#4f46e5"; return; }
          pb.textContent = "✓ Copied " + res.applied + " change(s) to AOL"; pb.style.background = "#15803d";
          try { efPostCapture("infinityFinancials", src, "infinity"); } catch (e) {}
          try { if (res.financials) efPostCapture("aolFinancials", res.financials, "aol"); } catch (e) {}
          var changes = (diff || []).filter(function (d) { return d.status === "differ"; }).map(function (d) { return { field: d.label, from: d.aol, to: d.infinity }; });
          efRecordSyncHistory("Infinity → AOL", changes, res.applied); efAppendHistoryLink();
        });
      };
    }
    if (noAolData) {
      html += '<div style="background:#fef3c7;border:1px solid #fcd34d;border-radius:8px;padding:10px 12px;color:#92400e;line-height:1.45;">No AOL numbers saved yet, so there is nothing to compare against.<div style="margin-top:6px;">Open the <b>AOL tab</b> and click <b>Compare</b> (or run <b>Start AOL</b>) once — that saves AOL\'s expenses. Then come back here and Compare again.</div></div>';
      html += '<div style="margin-top:8px;font-size:10.5px;color:#6b7280;">Or copy your Infinity numbers straight to AOL (no comparison needed — the open AOL tab is updated to match):</div>';
      html += pushBtnHtml();
      panel.innerHTML = html;
      document.body.appendChild(panel);
      document.getElementById("ef-cmp-close").onclick = function () { panel.remove(); };
      wirePushBtn();
      return;
    }
    html += sectionCheckHtml("expenses", "Monthly Expenses · HEM (Infinity ↔ AOL)");
    html += '<table style="width:100%;border-collapse:collapse;"><tr style="text-align:left;color:#6b7280;font-size:11px;"><th style="padding:2px 4px;">Category</th><th style="text-align:right;">Infinity</th><th style="text-align:right;">AOL</th><th></th></tr>';
    diff.forEach(function (d) {
      var col = d.status === "match" ? "#15803d" : (d.status === "missing-inf" ? "#dc2626" : "#b45309");
      var mark = d.status === "match" ? "✓" : (d.status === "missing-inf" ? "add" : "≠");
      html += '<tr style="border-top:1px solid #eee;"><td style="padding:3px 4px;">' + escapeHtml(d.label) + '</td>'
        + '<td style="text-align:right;color:' + (d.status === "differ" ? "#b45309" : "#1f2937") + ';font-weight:' + (d.status === "differ" ? 700 : 400) + ';">' + (d.infinity == null ? "—" : "$" + d.infinity) + '</td>'
        + '<td style="text-align:right;">' + (d.aol == null ? "—" : "$" + d.aol) + '</td>'
        + '<td style="text-align:center;color:' + col + ';font-size:11px;">' + mark + '</td></tr>';
    });
    var infTotal = diff.reduce(function (s, d) { return s + (d.infinity || 0); }, 0);
    var aolTotal = diff.reduce(function (s, d) { return s + (d.aol || 0); }, 0);
    var totalMatch = Math.abs(infTotal - aolTotal) < 1;
    html += '<tr style="border-top:2px solid #0d9488;font-weight:800;"><td style="padding:4px;">TOTAL / month</td>'
      + '<td style="text-align:right;">$' + infTotal + '</td>'
      + '<td style="text-align:right;color:' + (totalMatch ? "#15803d" : "#dc2626") + ';">$' + aolTotal + '</td>'
      + '<td style="text-align:center;color:' + (totalMatch ? "#15803d" : "#dc2626") + ';">' + (totalMatch ? "✓" : "≠") + '</td></tr>';
    html += '</table>';
    var syncable = diff.filter(function (d) { return d.status === "differ" && d.infLabel; });
    var missing = diff.filter(function (d) { return d.status === "missing-inf"; }).length;
    var diffs = diff.filter(function (d) { return d.status !== "match"; });
    html += '<div style="margin-top:9px;font-size:11px;color:' + (totalMatch ? "#15803d" : "#6b7280") + ';">' + diffs.length + ' difference(s). '
      + (totalMatch ? "Totals match ✓. " : "Totals differ by $" + Math.abs(infTotal - aolTotal) + ". ")
      + (missing ? missing + ' category(ies) missing in Infinity — add the row first (broker), then Compare again.' : "Sync sets Infinity = AOL for existing rows.") + '</div>';
    // Primary action on every Infinity panel: push Infinity ➜ AOL (matches the broker's usual workflow).
    html += pushBtnHtml();
    if (!syncable.length) {
      panel.innerHTML = html;
      document.body.appendChild(panel);
      document.getElementById("ef-cmp-close").onclick = function () { panel.remove(); };
      wireCompareReviewChecks(panel);
      wirePushBtn();
      return;
    }
    // Secondary (rare): pull the other way — overwrite Infinity to match AOL, via the row modal (teal = changes Infinity).
    html += '<div style="margin-top:8px;font-size:10.5px;color:#6b7280;">Rarely needed — go the other way and change <b>THIS Infinity page</b> to match AOL\'s numbers instead (slower, edits each row):</div>';
    html += '<button id="ef-cmp-sync-inf" style="margin-top:5px;background:#fff;border:1px solid #0d9488;color:#0d9488;border-radius:8px;padding:9px;width:100%;font-weight:700;cursor:pointer;">Instead, change Infinity to match AOL (' + syncable.length + ')</button>';
    panel.innerHTML = html;
    document.body.appendChild(panel);
    document.getElementById("ef-cmp-close").onclick = function () { panel.remove(); };
    wireCompareReviewChecks(panel);
    wirePushBtn();
    document.getElementById("ef-cmp-sync-inf").onclick = async function () {
      var b = document.getElementById("ef-cmp-sync-inf"); b.disabled = true; b.textContent = "Updating Infinity…";
      var n = 0;
      for (var i = 0; i < syncable.length; i++) { try { if (await setInfinityExpenseAmount(syncable[i].infLabel, syncable[i].target)) n += 1; } catch (e) { /* skip */ } }
      b.textContent = "✓ Updated " + n + "/" + syncable.length + " Infinity row(s) to match AOL"; b.style.background = "#15803d";
      try { efPostCapture("financialsCompare", diff.map(function (d) { return { label: d.label, infinity: d.infinity, aol: d.aol, status: d.status }; }), "infinity"); } catch (e) {}
      try { efShowSyncToast("✓ AOL ➜ Infinity", n + " expense row(s) updated to match AOL"); } catch (e) {}
    };
  }
  // Shared "✓ reviewed" tick wiring (same persisted financialsChecked state both panels use).
  function wireCompareReviewChecks(panel) {
    var boxes = all("input.ef-cmp-check", panel);
    if (!boxes.length) return;
    function lblFor(sec) { return panel.querySelector('.ef-cmp-check-lbl[data-sec="' + sec + '"]'); }
    function paint(sec, st) {
      var l = lblFor(sec); if (!l) return;
      if (st && st.done) { l.textContent = "✓ reviewed " + (st.at ? fmtDoneAt(st.at) : ""); l.style.color = "#15803d"; l.style.fontWeight = "700"; }
      else { l.textContent = "reviewed"; l.style.color = "#6b7280"; l.style.fontWeight = "400"; }
    }
    efGetCapture("financialsChecked").then(function (saved) {
      var state = saved && typeof saved === "object" ? saved : {};
      boxes.forEach(function (b) { var s = state[b.getAttribute("data-sec")]; b.checked = !!(s && s.done); paint(b.getAttribute("data-sec"), s); });
      boxes.forEach(function (b) {
        b.onchange = function () {
          var sec = b.getAttribute("data-sec");
          state[sec] = b.checked ? { done: true, at: new Date().toISOString() } : { done: false };
          paint(sec, state[sec]);
          efPostCapture("financialsChecked", state, "infinity");
        };
      });
    });
  }

  // Cross-tab sync (popup-orchestrated): read this page's expenses, or apply the OTHER platform's expenses
  // onto this page. Lets the popup push edits AOL⇄Infinity with both tabs open + persist to EasyFlow.
  function getCurrentFinancials() {
    if (/applyonline|loankit/i.test(location.href)) {
      return { platform: "aol", expenses: scrapeAolExpenseRows().map(function (r) { return { type: r.category, amount: r.amount, frequency: "Monthly" }; }), scrapedAt: new Date().toISOString() };
    }
    return { platform: "infinity", expenses: (scrapeInfinityFinancials().expenses || []).map(function (e) { return { type: e.type, amount: e.amount, frequency: e.frequency || "Monthly" }; }), scrapedAt: new Date().toISOString() };
  }
  async function applyFinancialsToCurrentPage(sourceExpenses) {
    var applied = 0;
    if (/applyonline|loankit/i.test(location.href)) {
      if (!/financials-tab/i.test(location.hash)) { location.hash = "#!/financials-tab"; await waitForRoute("financials-tab", null, 9000); }
      var diff = buildExpenseDiff({ liveInfinityFinancials: { expenses: asArray(sourceExpenses) } });
      // Set the AOL amount to match Infinity for EVERY non-matching category — including categories Infinity
      // doesn't have (target 0). Some AOL/HEM categories (e.g. "Primary Residence Ongoing Running Costs") are
      // REQUIRED and can't be deleted, so we zero them rather than remove the row: the HEM total still lines
      // up with Infinity ($3,650 → $3,050) without breaking AOL's "category is required" validation.
      diff.forEach(function (d) { if (d.input && d.status !== "match" && d.target != null) { setInputCommit(d.input, String(d.target)); applied += 1; } });
      if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    } else {
      var diff2 = buildInfinityExpenseDiff(asArray(sourceExpenses));
      for (var i = 0; i < diff2.length; i += 1) { if (diff2[i].status !== "match") { try { if (await setInfinityExpenseAmount(diff2[i].label, diff2[i].target)) applied += 1; } catch (e) { /* skip */ } } }
    }
    return applied;
  }

  async function compareCurrentPage(payload) {
    aolActivePayload = payload || aolActivePayload;
    var onAol = /applyonline|loankit/i.test(location.href);
    var onInfinity = !onAol; // Infynity = anything that isn't AOL (host is infYnity.com.au, not "infinity")
    var expenseDiff = null, infinityFinancials = null, aolFinancials = null;
    if (onInfinity) {
      // On Infinity: scrape live financials (popup stores them for the AOL compare) AND show the REVERSE
      // compare panel (Infinity ↔ AOL) so the broker can push AOL's values back INTO Infinity (symmetric).
      try { infinityFinancials = scrapeInfinityFinancials(); } catch (e) { /* non-fatal */ }
      try {
        var aolCap = await efGetCapture("aolFinancials");
        var aolExp = (aolCap && aolCap.expenses) || objectAtPath(payload, ["liveAolFinancials", "expenses"]) || [];
        // Always show the panel so the broker sees something; if no AOL data captured yet, show a hint.
        showInfinityExpenseCompare(aolExp.length ? buildInfinityCanonicalDiff(aolExp) : [], aolExp.length === 0);
      } catch (e) { /* non-fatal */ }
    } else if (onAol) {
      try {
        // Financials live on the Financials tab — navigate there first so the scrape finds the rows.
        if (!/financials-tab/i.test(location.hash)) { location.hash = "#!/financials-tab"; await waitForRoute("financials-tab", null, 9000); }
        // Use the FRESHEST live Infinity expenses (server-stored capture) over the stale template payload — so an
        // expense the broker deleted in Infinity (e.g. "Primary Residence Ongoing Running Costs") shows as an
        // AOL-only difference instead of a false match against the old template.
        var pay = payload || {};
        if (!(objectAtPath(pay, ["liveInfinityFinancials", "expenses"]) || []).length) {
          try { var infCap = await efGetCapture("infinityFinancials"); if (infCap && (infCap.expenses || []).length) pay = Object.assign({}, pay, { liveInfinityFinancials: { expenses: infCap.expenses } }); } catch (e) { /* use payload */ }
        }
        var fullDiff = buildFinancialsDiff(pay);
        expenseDiff = fullDiff.expenses;
        showFinancialsCompare(fullDiff);
        // AUTO-CAPTURE the live AOL financials snapshot to EasyFlow (popup POSTs it) — per-platform, no button.
        var aolSec = scrapeSectionedRows(AOL_SECTION_DEFS);
        aolFinancials = {
          assets: aolSec.assets || [], liabilities: aolSec.liabilities || [],
          expenses: scrapeAolExpenseRows().map(function (r) { return { type: r.category, amount: r.amount, frequency: "Monthly" }; }),
          scrapedAt: new Date().toISOString()
        };
      } catch (e) { /* non-fatal */ }
    }
    var diffs = (expenseDiff || []).filter(function (d) { return d.status !== "match"; });
    return {
      ok: true,
      url: location.href,
      title: document.title,
      applicants: collectApplicants(payload || {}),
      expenseDiff: expenseDiff,
      infinityFinancials: infinityFinancials,
      aolFinancials: aolFinancials,
      compareSummary: expenseDiff ? { total: expenseDiff.length, differences: diffs.length } : null,
      lastReport: lastReport
    };
  }

  // Read-only page test (the popup "Run diagnostic" button): scan the CURRENT page for empty-but-required
  // fields and form-flagged-invalid fields. Returns the {summary, checks, url, platform} shape the popup
  // renders. Writes nothing. (Previously the popup sent INFINITY_AOL_RUN_DIAGNOSTICS but no handler
  // existed → the button errored.)
  function runPageDiagnostics() {
    var platform = /applyonline|loankit/i.test(location.href) ? "aol" : "infynity";
    var checks = [], pass = 0, warn = 0, fail = 0;
    function add(status, section, label, message) {
      checks.push({ status: status, section: section, label: label, message: message || "" });
      if (status === "pass") pass += 1; else if (status === "warn") warn += 1; else fail += 1;
    }
    try {
      var requiredEmpty = all("input,select,textarea").filter(function (e) {
        if (!isVisible(e)) return false;
        var t = (e.type || "").toLowerCase();
        if (t === "hidden" || t === "button" || t === "submit" || t === "checkbox" || t === "radio") return false;
        var empty = e.tagName === "SELECT" ? !e.value : !String(e.value || "").trim();
        if (!empty) return false;
        return e.required || e.getAttribute("aria-required") === "true" || /ng-invalid-required|is-invalid/.test(e.className || "") || (platform === "aol" && typeof aolIsRequired === "function" && aolIsRequired(e));
      });
      if (!requiredEmpty.length) add("pass", "page", "Required fields", "No empty required fields detected");
      else requiredEmpty.slice(0, 60).forEach(function (e) {
        var label = (platform === "aol" && typeof aolLabelOf === "function") ? aolLabelOf(e) : (e.placeholder || (e.getAttribute && e.getAttribute("ng-model")) || e.name || "field");
        add("warn", "required", String(label || "field").slice(0, 50), "empty required field");
      });
      var invalid = all("input.ng-invalid,select.ng-invalid,textarea.ng-invalid,.is-invalid").filter(function (e) { return isVisible(e) && /^(input|select|textarea)$/i.test(e.tagName); });
      if (invalid.length) add("warn", "validation", "Form-flagged invalid", invalid.length + " field(s) flagged invalid by the form");
    } catch (e) {
      add("fail", "diagnostics", "Scan error", String(e && e.message || e));
    }
    var ok = fail === 0;
    return { ok: ok, summary: { ok: ok, pass: pass, warn: warn, fail: fail }, checks: checks, url: location.href, platform: platform, errors: [] };
  }

  if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener(function (message, sender, sendResponse) {
      if (!message || typeof message !== "object") return false;
      if (message.extToken) brokerCtx.extToken = String(message.extToken); // optional write-auth secret (any entry point)
      if (message.type === "INFINITY_AOL_RUN_DIAGNOSTICS") {
        try { sendResponse(runPageDiagnostics()); }
        catch (e) { sendResponse({ ok: false, summary: { ok: false, pass: 0, warn: 0, fail: 1 }, checks: [], errors: [{ message: String(e) }], url: location.href, platform: "" }); }
        return false;
      }
      if (message.type === "INFINITY_AOL_PING") {
        sendResponse({ ok: true, version: "infinityWorkflowV4", url: location.href });
        return false;
      }
      if (message.type === "INFINITY_AOL_STOP") {
        stopRequested = true;
        sendResponse({ ok: true, stopped: true });
        return false;
      }
      if (message.type === "INFINITY_AOL_GET_LAST_REPORT") {
        sendResponse({ ok: true, report: lastReport });
        return false;
      }
      if (message.type === "INFINITY_AOL_TOGGLE_CHECKLIST") {
        if (message.apiBase) brokerCtx.apiBase = message.apiBase;
        if (message.caseId) brokerCtx.caseId = message.caseId;
        var existing = document.getElementById("ef-manual-checklist");
        if (existing) { existing.remove(); sendResponse({ ok: true, shown: false }); return false; }
        // Combined checklist (Infinity + AOL). showManualChecklist loads BOTH saved captures + unions
        // this run's fresh items, so it shows everything regardless of which tab we're on.
        var fresh = (lastReport && lastReport.manualActions) || [];
        showManualChecklist(fresh, "Broker manual steps · Infinity + AOL")
          .then(function () { sendResponse({ ok: true, shown: true }); })
          .catch(function () { sendResponse({ ok: true, shown: true }); });
        return true;
      }
      if (message.type === "INFINITY_AOL_COMPARE" || message.type === "INFINITY_AOL_DIAGNOSTICS") {
        compareCurrentPage(message.payload || {}).then(function (r) { sendResponse(r); }).catch(function (e) { sendResponse({ ok: false, error: String(e) }); });
        return true;
      }
      if (message.type === "EF_GET_FINANCIALS") {
        try { sendResponse({ ok: true, financials: getCurrentFinancials() }); } catch (e) { sendResponse({ ok: false, error: String(e) }); }
        return false;
      }
      if (message.type === "EF_APPLY_FINANCIALS") {
        applyFinancialsToCurrentPage(message.expenses || [])
          .then(function (applied) { sendResponse({ ok: true, applied: applied, financials: getCurrentFinancials() }); })
          .catch(function (e) { sendResponse({ ok: false, error: String(e) }); });
        return true;
      }
      if (message.type === "INFINITY_AOL_RO_SYNC") {
        roLearnApply(message.payload || {}, message.apiBase || "", message.caseId || "")
          .then(function (r) { sendResponse(r); }).catch(function (e) { sendResponse({ ok: false, error: String(e) }); });
        return true;
      }
      // Capture the CURRENT Infinity Client-Details state (applicants + employment) as a versioned snapshot
      // for document generation. Original loan form stays untouched; this is the "updated copy" history.
      if (message.type === "EF_CAPTURE_STATE") {
        // Scrape only; the popup posts it to the server (broker-token auth) so this works without Start.
        try {
          var snap = scrapeInfinityClientDetails();
          snap.financials = scrapeInfinityFinancials();
          sendResponse({ ok: true, snapshot: snap });
        } catch (e) { sendResponse({ ok: false, error: String(e) }); }
        return false;
      }
      if (message.type === "EF_FULL_CAPTURE") {
        // Scrape current page + auto-click the SOCA Recommendation/Features tabs to grab selected lender + rate.
        efFullCapture()
          .then(function (s) { sendResponse({ ok: true, snapshot: s }); })
          .catch(function (e) { sendResponse({ ok: false, error: String(e) }); });
        return true;
      }
      if (message.type === "INFINITY_AOL_RETRY_STEP") {
        if (running) {
          sendResponse({ ok: false, error: "Already running" });
          return false;
        }
        running = true;
        brokerCtx.apiBase = message.apiBase || "";
        brokerCtx.caseId = message.caseId || "";
        runInfinity(message.payload || {}, message.mapping || {}, message.apiBase || "", message.stepId)
          .then(function (report) { running = false; sendResponse(report); })
          .catch(function (err) { running = false; sendResponse({ ok: false, error: String(err) }); });
        return true;
      }
      if (message.type === "INFINITY_AOL_AUTOFILL") {
        if (running) {
          sendResponse({ ok: false, error: "Already running" });
          return false;
        }
        running = true;
        brokerCtx.apiBase = message.apiBase || "";
        brokerCtx.caseId = message.caseId || "";
        var target = message.targetPlatform || "auto";
        var runner = target === "aol" ? runAol : runInfinity;
        runner(message.payload || {}, message.mapping || {}, message.apiBase || "")
          .then(function (report) { running = false; sendResponse(report); })
          .catch(function (err) { running = false; sendResponse({ ok: false, error: String(err) }); });
        return true;
      }
      return false;
    });
  }

  // ===== Auto capture-back: broker edits on a financials page → EasyFlow AI (with a VISIBLE notice) =====
  // The broker decided EasyFlow AI is the live source: when they edit a value on Infinity/AOL, it must
  // flow back to EasyFlow automatically — but they must KNOW it's happening, and the edits are logged.
  // Guard: we react ONLY to event.isTrusted (real broker keystrokes). The bot's own writes use
  // dispatchEvent (isTrusted=false), so the watcher never echoes the bot's fills back.
  var efSyncTimer = null, efSyncPending = [], efSyncStarted = false;
  function efOnFinancialsPage() {
    if (/\/financials-tab/i.test(location.href) || /\/financials\b/i.test(location.href)) return true;
    return !!all("h1,h2,h3,h4").find(function (e) { var t = norm(textOf(e)); return /^financials$|statement of position|^liabilities$|monthly expenses|^income$|other assets/i.test(t) && isVisible(e); });
  }
  function efCurrentSyncPlatform() { return /applyonline|loankit/i.test(location.href) ? "aol" : "infinity"; }
  function efFieldLabel(el) {
    var row = el.closest && el.closest("tr,div,li,td");
    if (row) { var l = all("label,td,span,div", row).find(function (n) { return n !== el && norm(textOf(n)) && textOf(n).length < 40 && !n.contains(el); }); if (l) return norm(textOf(l)); }
    return el.placeholder || (el.getAttribute && (el.getAttribute("ng-model") || el.getAttribute("formcontrolname"))) || "field";
  }
  function efShowSyncToast(title, sub) {
    var t = document.getElementById("ef-sync-toast");
    if (!t) { t = document.createElement("div"); t.id = "ef-sync-toast"; t.style.cssText = "position:fixed;bottom:18px;right:18px;z-index:2147483647;background:#0f766e;color:#fff;border-radius:10px;padding:10px 14px;font-family:system-ui,Segoe UI,sans-serif;font-size:12.5px;box-shadow:0 8px 24px rgba(0,0,0,.3);max-width:300px;cursor:pointer;"; t.title = "Click to view sync log"; t.onclick = efShowSyncLog; document.body.appendChild(t); }
    t.innerHTML = '<b>' + escapeHtml(title) + '</b>' + (sub ? '<div style="opacity:.92;margin-top:2px;">' + escapeHtml(sub) + '</div>' : '') + '<div style="opacity:.7;font-size:10.5px;margin-top:3px;">click to view sync log</div>';
    t.style.display = "block"; clearTimeout(t.__hide); t.__hide = setTimeout(function () { t.style.display = "none"; }, 5000);
  }
  function efShowSyncBanner() {
    if (document.getElementById("ef-sync-banner") || sessionStorage.getItem("efSyncBannerSeen")) return;
    var b = document.createElement("div"); b.id = "ef-sync-banner";
    b.style.cssText = "position:fixed;top:64px;right:16px;z-index:2147483646;background:#fef3c7;color:#92400e;border:1px solid #f59e0b;border-radius:10px;padding:9px 12px;font-family:system-ui,Segoe UI,sans-serif;font-size:12px;max-width:300px;box-shadow:0 8px 24px rgba(0,0,0,.2);";
    b.innerHTML = '⚡ <b>Auto-sync ON</b><div style="margin-top:3px;">Your edits on this page are <b>saved back to EasyFlow AI</b> automatically.</div><div id="ef-sync-banner-x" style="cursor:pointer;text-decoration:underline;margin-top:4px;">Got it</div>';
    document.body.appendChild(b);
    document.getElementById("ef-sync-banner-x").onclick = function () { sessionStorage.setItem("efSyncBannerSeen", "1"); b.remove(); };
    setTimeout(function () { if (b.parentNode) b.remove(); }, 9000);
  }
  async function efShowSyncLog() {
    var log = (await efGetCapture("syncLog")) || []; if (!Array.isArray(log)) log = [];
    var p = document.getElementById("ef-sync-log"); if (p) { p.remove(); return; }
    p = document.createElement("div"); p.id = "ef-sync-log";
    p.style.cssText = "position:fixed;bottom:62px;right:18px;z-index:2147483647;background:#fff;color:#1f2937;border:2px solid #0f766e;border-radius:12px;padding:12px 14px;width:340px;max-height:60vh;overflow:auto;font-family:system-ui,Segoe UI,sans-serif;font-size:12px;box-shadow:0 12px 36px rgba(0,0,0,.3);";
    var rows = log.slice(-60).reverse().map(function (e) { return '<div style="border-top:1px solid #eee;padding:4px 0;"><b>' + escapeHtml(e.field) + '</b> = ' + escapeHtml(String(e.value)) + '<div style="opacity:.6;font-size:10.5px;">' + escapeHtml(fmtDoneAt(e.at)) + ' · ' + escapeHtml(e.platform || "") + '</div></div>'; }).join("") || '<div style="opacity:.6;">No synced changes yet.</div>';
    p.innerHTML = '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;"><b style="color:#0f766e;">📝 EasyFlow AI sync log</b><button id="ef-sync-log-x" style="background:#e5e7eb;border:none;border-radius:6px;width:22px;height:22px;cursor:pointer;font-size:14px;">×</button></div>' + rows;
    document.body.appendChild(p);
    document.getElementById("ef-sync-log-x").onclick = function () { p.remove(); };
  }
  // Per-SYNC history: one grouped entry each time the broker pushes Infinity⇄AOL — direction + field-level
  // {from→to} diffs. This is the "what did this sync change" audit the broker asked for (separate from the
  // per-edit syncLog). Stored as capture `syncHistory`, also surfaced in EasyFlow AI.
  async function efRecordSyncHistory(direction, changes, applied) {
    try {
      if (!brokerCtx.caseId) return;
      var hist = (await efGetCapture("syncHistory")) || []; if (!Array.isArray(hist)) hist = [];
      hist.push({ at: new Date().toISOString(), direction: direction, appliedCount: applied || 0, changes: (changes || []).slice(0, 80), by: brokerCtx.brokerUser || "broker" });
      efPostCapture("syncHistory", hist.slice(-200), efCurrentSyncPlatform());
    } catch (e) { /* non-fatal */ }
  }
  async function efShowSyncHistory() {
    var hist = (await efGetCapture("syncHistory")) || []; if (!Array.isArray(hist)) hist = [];
    var p = document.getElementById("ef-sync-hist"); if (p) { p.remove(); return; }
    p = document.createElement("div"); p.id = "ef-sync-hist";
    p.style.cssText = "position:fixed;bottom:62px;right:18px;z-index:2147483647;background:#fff;color:#1f2937;border:2px solid #4f46e5;border-radius:12px;padding:12px 14px;width:380px;max-height:64vh;overflow:auto;font-family:system-ui,Segoe UI,sans-serif;font-size:12px;box-shadow:0 12px 36px rgba(0,0,0,.3);";
    var rows = hist.slice(-40).reverse().map(function (e) {
      var ch = (e.changes || []).map(function (c) { return '<div style="padding-left:8px;">• <b>' + escapeHtml(c.field) + '</b>: ' + (c.from == null ? "—" : "$" + c.from) + ' ➜ <b>' + (c.to == null ? "—" : "$" + c.to) + '</b></div>'; }).join("") || '<div style="padding-left:8px;opacity:.6;">(no value diffs recorded)</div>';
      return '<div style="border-top:1px solid #eee;padding:6px 0;"><div><b style="color:#4f46e5;">' + escapeHtml(e.direction) + '</b> · ' + (e.appliedCount || 0) + ' row(s)</div><div style="opacity:.6;font-size:10.5px;margin-bottom:2px;">' + escapeHtml(fmtDoneAt(e.at)) + ' · ' + escapeHtml(e.by || "broker") + '</div>' + ch + '</div>';
    }).join("") || '<div style="opacity:.6;">No syncs yet.</div>';
    p.innerHTML = '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;"><b style="color:#4f46e5;">🔁 Update history — what was copied</b><button id="ef-sync-hist-x" style="background:#e5e7eb;border:none;border-radius:6px;width:22px;height:22px;cursor:pointer;font-size:14px;">×</button></div>' + rows;
    document.body.appendChild(p);
    document.getElementById("ef-sync-hist-x").onclick = function () { p.remove(); };
  }
  function efAppendHistoryLink() {
    var el = document.getElementById("ef-push-note"); if (!el) return;
    var a = document.createElement("div"); a.style.cssText = "margin-top:5px;text-decoration:underline;cursor:pointer;color:#4f46e5;font-weight:700;";
    a.textContent = "View what was copied"; a.onclick = efShowSyncHistory;
    el.appendChild(a);
  }
  async function efFlushSync() {
    if (!brokerCtx.apiBase || !brokerCtx.caseId) return;     // need a case context (broker ran Start first)
    if (brokerCtx.pageKey !== efPageKey()) { efSyncPending = []; return; } // page/case changed → never mis-file
    var platform = efCurrentSyncPlatform();
    // Dedupe pending by field KEY (keep last value).
    var seen = {}, edits = [];
    efSyncPending.slice().reverse().forEach(function (e) { if (!seen[e.key]) { seen[e.key] = 1; edits.unshift(e); } });
    efSyncPending = [];
    if (!edits.length) return;
    // (1) THE OVERRIDE LAYER — brokerOverrides[key] = latest broker value + provenance. This is the "live
    // source" layer: things changed AFTER the loan form (new employer, new income...). The bot fills
    // `effective = brokerOverride ?? loanForm`, so the loan-form original is kept (audit) but never
    // overwrites a broker edit. Keyed by ng-model/qeid + label so it's stable across runs.
    var ov = (await efGetCapture("brokerOverrides")) || {};
    if (!ov || typeof ov !== "object" || Array.isArray(ov)) ov = {};
    edits.forEach(function (e) { ov[e.key] = { value: e.value, at: e.at, platform: e.platform, label: e.field }; });
    var ovKeys = Object.keys(ov);
    if (ovKeys.length > 600) ovKeys.slice(0, ovKeys.length - 600).forEach(function (k) { delete ov[k]; });
    efPostCapture("brokerOverrides", ov, platform);
    // (2) AUDIT LOG — full history of every edit (who/what/when/where).
    var log = (await efGetCapture("syncLog")) || []; if (!Array.isArray(log)) log = [];
    edits.forEach(function (e) { log.push(e); });
    efPostCapture("syncLog", log.slice(-300), platform);
    // (3) FINANCIALS SNAPSHOT — only on the financials page (feeds the Compare panel). Best-effort.
    if (efOnFinancialsPage()) {
      try {
        if (platform === "infinity") efPostCapture("infinityFinancials", scrapeInfinityFinancials(), "infinity");
        else efPostCapture("aolFinancials", { expenses: scrapeAolExpenseRows().map(function (r) { return { type: r.category, amount: parseMoney((r.input && r.input.value) || 0), ownership: r.ownership }; }), scrapedAt: new Date().toISOString() }, "aol");
      } catch (e) {}
    }
    efShowSyncToast("✓ Saved to EasyFlow AI", edits.length + " change(s) saved (broker layer, audited)");
  }
  // Stable per-field key for the override map: ng-model/qeid (+ label) — NOT AOL's dynamic
  // "lim-input-field-NNN" ids. Label disambiguates fields that share a bare ng-model (e.g. employer
  // "lastName"/Surname vs applicant "lastName"/Last name).
  function efFieldKey(el) {
    var base = (el.getAttribute && (el.getAttribute("ng-model") || el.getAttribute("formcontrolname") || el.getAttribute("qeid"))) || "";
    if (!base && el.id && !/^lim-(input|select)-field-/i.test(el.id)) base = el.id;
    var lab = efFieldLabel(el);
    return ((base || "") + "::" + (lab || "")).slice(0, 90).trim();
  }
  function efOnBrokerEdit(e) {
    if (!e || !e.isTrusted) return;                       // bot writes are isTrusted=false → ignored
    var el = e.target;
    if (!el || !/^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName || "")) return;
    if (el.type === "password" || el.type === "search" || el.type === "checkbox" || el.type === "radio" || el.type === "file") return;
    if (el.closest && el.closest('[id^="ef-"]')) return;  // ignore our own UI
    if (!brokerCtx.caseId) return;                        // need a case context (broker ran Start first)
    // SAFETY: only sync if THIS page is still the one Start ran on. If the broker switched cases in the
    // same SPA tab, refuse (and warn once) rather than mis-file edits to the previous case.
    if (brokerCtx.pageKey !== efPageKey()) {
      if (!sessionStorage.getItem("efSyncStaleWarned")) { sessionStorage.setItem("efSyncStaleWarned", "1"); efShowSyncToast("⚠ This page isn't synced", "Run Start again for the case open here to enable auto-sync"); }
      return;
    }
    var key = efFieldKey(el);
    if (!key || key === "::") return;
    // Capture broker edits ANYWHERE on the case page (not just financials) — employer/income/etc. that
    // changed after the loan form. The override layer is the live source.
    efSyncPending.push({ at: new Date().toISOString(), key: key, field: efFieldLabel(el), value: String(el.value == null ? "" : el.value).slice(0, 120), platform: efCurrentSyncPlatform() });
    efShowSyncBanner();
    clearTimeout(efSyncTimer);
    efSyncTimer = setTimeout(efFlushSync, 2500);          // debounce: flush 2.5s after edits settle
  }
  function startCaptureWatcher() {
    if (efSyncStarted) return; efSyncStarted = true;
    document.addEventListener("change", efOnBrokerEdit, true); // real user value commits (blur-after-edit)
  }
  startCaptureWatcher();

  // Accumulate a live case snapshot as the broker navigates the Infinity tabs: applicants come from Client
  // Details, income from Financials, lender/rate from Recommendation/Preferred — each visit fills in what it
  // can see, merging (never wiping good data with an empty scrape) so docs reflect the current Infinity state.
  function efMergeObj(prev, cur) {
    var o = Object.assign({}, prev || {});
    Object.keys(cur || {}).forEach(function (k) { if (cur[k] != null && String(cur[k]).trim() !== "") o[k] = cur[k]; });
    return o;
  }
  var efSnapTimer = null;
  async function efAccumulateSnapshot() {
    try {
      if (/applyonline|loankit/i.test(location.href)) return;       // Infinity only for now
      if (!brokerCtx.caseId || brokerCtx.pageKey !== efPageKey()) return;
      var prev = (await efGetCapture("liveCaseSnapshot")) || {};
      var cur = scrapeInfinityClientDetails();
      var fin = scrapeInfinityFinancials();
      var merged = {
        platform: "infinity", scrapedAt: new Date().toISOString(),
        applicants: (cur.applicants && cur.applicants.length) ? cur.applicants : (prev.applicants || []),
        employment: efMergeObj(prev.employment, cur.employment),
        recommendation: efMergeObj(prev.recommendation, cur.recommendation),
        financials: (fin && (fin.incomes || []).length) ? fin : (prev.financials || null)
      };
      efPostCapture("liveCaseSnapshot", merged, "infinity");
      if (merged.financials && (merged.financials.incomes || []).length) efPostCapture("infinityFinancials", merged.financials, "infinity");
      return merged;
    } catch (e) { return null; }
  }
  // Find a SOCA tab in the tab bar by its label text (to click + scrape it).
  function findInfinityTab(label) {
    return all("a,li,span,div,button").find(function (el) {
      if (!isVisible(el)) return false;
      var t = norm(textOf(el));
      if (t.toLowerCase().indexOf(label.toLowerCase()) < 0 || t.length > label.length + 26) return false;
      var r = el.getBoundingClientRect();
      return r.top > 120 && r.top < 330 && r.height < 64 && r.width < 380;
    });
  }
  function efScrapeCurrent() { var s = scrapeInfinityClientDetails(); s.financials = scrapeInfinityFinancials(); return s; }
  function efMergeSnap(a, b) {
    return {
      platform: "infinity", scrapedAt: new Date().toISOString(),
      applicants: (b.applicants && b.applicants.length) ? b.applicants : (a.applicants || []),
      employment: efMergeObj(a.employment, b.employment),
      profile: efMergeObj(a.profile, b.profile),
      loanPrefs: efMergeObj(a.loanPrefs, b.loanPrefs),
      recommendation: efMergeObj(a.recommendation, b.recommendation),
      scenarios: (b.scenarios && b.scenarios.length) ? b.scenarios : (a.scenarios || []),
      financials: (b.financials && (b.financials.incomes || []).length) ? b.financials : (a.financials || null)
    };
  }
  // One capture pass: scrape the current page, then (if the SOCA tab bar is present) click the Recommendation
  // + Preferred Loan Features tabs and scrape each — so a single generate on the loan page grabs the selected
  // lender + rate + scenarios. Read-only (clicking tabs doesn't change data).
  async function efFullCapture() {
    var merged = efScrapeCurrent();
    // If on a SOCA loan page, hop the hash to recommendation (selected lender + rate) then features (scenarios).
    if (/\/loans\/soca\//.test(location.hash || "")) {
      var sections = ["recommendation", "features"];
      for (var i = 0; i < sections.length; i += 1) {
        if (gotoSocaTab(sections[i])) {
          try { await waitForRoute("/soca/" + sections[i], null, 8000); } catch (e) { /* continue */ }
          await sleep(1300);
          merged = efMergeSnap(merged, efScrapeCurrent());
        }
      }
    }
    var scratch = { issues: [], actions: [] };
    // INCOME lives on the account-level Financials tab (NOT the SOCA loan page). If the current scrape found no
    // income, open the Financials tab and re-scrape it — so the broker's LIVE edits there are captured, not a
    // stale value from when Start last ran. Read-only (we only read the table).
    if (!(merged.financials && (merged.financials.incomes || []).length)) {
      try {
        if (findMainTab("Financials") && await clickMainTab("Financials", scratch)) {
          await sleep(900);
          var fin = scrapeInfinityFinancials();
          if (fin && (fin.incomes || []).length) merged.financials = fin;
        }
      } catch (e) { /* non-fatal — fall back to whatever was captured */ }
    }
    // RESIDENCY / VISA / DEPENDANTS + EMPLOYMENT live on Client Details. If not yet captured, open it + re-scrape.
    var prof = merged.profile || {};
    if (!(prof.residencyStatus || prof.dependants || (merged.employment && merged.employment.occupation))) {
      try {
        if (findMainTab("Client Details") && await clickMainTab("Client Details", scratch)) {
          await sleep(900);
          merged = efMergeSnap(merged, scrapeInfinityClientDetails());
        }
      } catch (e) { /* non-fatal */ }
    }
    // REPAYMENT TYPE / FREQUENCY / FEATURES live on Loans & Products. If not yet captured, open it + re-scrape.
    var lp = merged.loanPrefs || {};
    if (!(lp.repaymentType || lp.repaymentFrequency)) {
      try {
        if (findMainTab("Loans & Products") && await clickMainTab("Loans & Products", scratch)) {
          await sleep(900);
          merged = efMergeSnap(merged, scrapeInfinityClientDetails());
        }
      } catch (e) { /* non-fatal */ }
    }
    return merged;
  }
  // Called by the Start workflow after each step: scrape the tab the bot just finished + merge into the live
  // snapshot. So running Start (which navigates every tab) AUTO-captures applicants, income, scenarios — no
  // extra clicks; the broker just runs Start then exports. Uses brokerCtx (set during Start).
  async function efCaptureStepData() {
    try {
      if (!brokerCtx.apiBase || !brokerCtx.caseId) return;
      var prev = (await efGetCapture("liveCaseSnapshot")) || {};
      var merged = efMergeSnap(prev, efScrapeCurrent());
      await efPostCapture("liveCaseSnapshot", merged, "infinity");
      if (merged.financials && (merged.financials.incomes || []).length) await efPostCapture("infinityFinancials", merged.financials, "infinity");
      if (merged.scenarios && merged.scenarios.length) await efPostCapture("lenderScenarios", merged.scenarios, "infinity");
    } catch (e) { /* non-fatal */ }
  }
  function scheduleSnapshot() { clearTimeout(efSnapTimer); efSnapTimer = setTimeout(efAccumulateSnapshot, 1400); }
  window.addEventListener("hashchange", scheduleSnapshot);
  setTimeout(scheduleSnapshot, 3000); // also once after load
})();

/* EasyFlow AI - Needs Analysis deterministic fill v3 (ASCII, collision-proof IIFE).
   Exposes ONE global: window.EF_fillNeedsAnalysis(caseData, EF). Paste anywhere.
   v3 nails the last 3: Switchery applicant toggles, ng-model textareas,
   and date-time directive inputs (typed value commits; verified via ng classes). */
(function () {
  if (window.EF_fillNeedsAnalysis && window.EF_fillNeedsAnalysis.__v === 3) return;

  const norm = (s) => (s || "").replace(/\s+/g, " ").trim().toLowerCase();
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const setNativeValue = (el, val) => {
    const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype
                : el.tagName === "SELECT" ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value").set.call(el, val);
  };
  const scrollOnce = (el) => el && el.scrollIntoView({ block: "center", behavior: "instant" });
  const nodeByText = (text) => {
    const t = norm(text);
    return [...document.querySelectorAll("label,.control-label,span,div,h5,h4,h3,strong")].find((n) => norm(n.textContent) === t);
  };

  const inputByLabel = (text, forPrefix) => {
    const t = norm(text);
    const lbl = [...document.querySelectorAll("label.checkbox-label[for]")].find(
      (l) => norm(l.textContent) === t && (!forPrefix || l.getAttribute("for").startsWith(forPrefix)));
    return lbl ? document.getElementById(lbl.getAttribute("for")) : null;
  };
  const ensureChecked = async (input, want) => {
    if (!input) return false;
    if (input.checked === want) return true;
    input.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    await sleep(70);
    if (input.checked === want) return true;
    input.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    await sleep(70);
    return input.checked === want;
  };
  const switcheryFor = (input) => {
    if (!input) return null;
    if (input.nextElementSibling && /switchery/.test(input.nextElementSibling.className || "")) return input.nextElementSibling;
    const box = input.closest("div,li,tr,label") || input.parentElement;
    return box ? box.querySelector(".switchery") : null;
  };
  const ensureCheckedClickEl = async (input, clickEl, want) => {
    if (!input) return false;
    if (input.checked === want) return true;
    (clickEl || input).dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    await sleep(90);
    if (input.checked === want) return true;
    input.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    await sleep(90);
    return input.checked === want;
  };
  const setGroupExactByLabels = async (forPrefix, members, desired) => {
    const want = new Set(desired.map(norm));
    const missingDesired = []; // only a DESIRED checkbox we can't find is a real problem
    for (const label of members) {
      const i = inputByLabel(label, forPrefix);
      if (!i) {
        if (want.has(norm(label))) missingDesired.push(label); // a non-desired absent option is fine
        continue;
      }
      await ensureChecked(i, want.has(norm(label)));
    }
    const wrongOn = [];
    const missingOff = [];
    for (const label of members) {
      const i = inputByLabel(label, forPrefix);
      if (!i) continue;
      const s = want.has(norm(label));
      if (i.checked && !s) wrongOn.push(label);
      if (!i.checked && s) missingOff.push(label);
    }
    return { ok: !missingDesired.length && !wrongOn.length && !missingOff.length, missing: missingDesired, wrongOn, missingOff };
  };
  const setObjectivesExact = async (desired) => {
    const want = new Set(desired.map(norm));
    const inputs = [...document.querySelectorAll('input[id^="checkbox-objective-"]')];
    const lblOf = (i) => {
      const l = document.querySelector('label[for="' + CSS.escape(i.id) + '"]');
      return l ? l.textContent.trim() : i.id;
    };
    if (inputs[0]) scrollOnce(inputs[0]);
    for (const i of inputs) {
      const lab = document.querySelector('label[for="' + CSS.escape(i.id) + '"]');
      await ensureCheckedClickEl(i, lab || i, want.has(norm(lblOf(i))));
    }
    const wrongOn = [];
    const missingOff = [];
    for (const i of inputs) {
      const s = want.has(norm(lblOf(i)));
      if (i.checked && !s) wrongOn.push(lblOf(i));
      if (!i.checked && s) missingOff.push(lblOf(i));
    }
    return { ok: !wrongOn.length && !missingOff.length, wrongOn, missingOff };
  };
  const REQ = "checkbox-requirements-";
  const MEMBERS = {
    general: ["Bridging Finance", "Extra Repayments", "Line of Credit", "Non-conforming Loan", "Offset", "Rate Lock", "Redraw", "Reverse Mortgage", "Other Requirements", "No Early Repayment Penalty"],
    rateTypes: ["Fixed Rate", "Fixed & Variable Rate", "Variable Rate"],
    repaymentTypes: ["Interest Only", "Balloon Repayments", "P & I Repayments"],
    repaymentFreq: ["Weekly Repayments", "Fortnightly Repayments", "Monthly Repayments"],
  };

  const selectByLabel = (text) => {
    const lbl = nodeByText(text);
    if (!lbl) return null;
    if (lbl.htmlFor) {
      const f = document.getElementById(lbl.htmlFor);
      if (f && f.tagName === "SELECT") return f;
    }
    return [...document.querySelectorAll("select")].find((s) => lbl.compareDocumentPosition(s) & Node.DOCUMENT_POSITION_FOLLOWING) || null;
  };
  const setSelectExact = (sel, text) => {
    const t = norm(text);
    const opt = [...sel.options].find((o) => norm(o.textContent) === t || norm(o.value) === t);
    if (!opt) return { ok: false, reason: "option-not-found", text };
    if (sel.value !== opt.value) {
      setNativeValue(sel, opt.value);
      sel.dispatchEvent(new Event("change", { bubbles: true }));
    }
    return { ok: sel.value === opt.value };
  };

  const setTextareaByNg = (ngModel, value) => {
    if (!value) return { ok: true, skip: true };
    const el = document.querySelector('textarea[ng-model="' + ngModel + '"]');
    if (!el) return { ok: false, reason: "textarea-not-found" };
    scrollOnce(el);
    setNativeValue(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    return { ok: el.value.trim() === value.trim() };
  };

  const applicantInputByName = (name) => {
    const want = norm(name);
    // 1) A real label[for] that contains the applicant name -> its input.
    const lbl = [...document.querySelectorAll("label[for]")].find(
      (l) => norm(l.textContent).includes(want) && norm(l.textContent).length < 60);
    if (lbl) {
      const byLabel = document.getElementById(lbl.getAttribute("for"));
      if (byLabel) return byLabel;
    }
    // 2) A Switchery toggle whose nearby container text matches the name (Infynity uses random input ids).
    const sw = [...document.querySelectorAll(".switchery")].find((s) => {
      const box = s.closest("div,li,tr,label") || s.parentElement;
      return box && norm(box.textContent).includes(want);
    });
    if (sw) {
      const input = (sw.previousElementSibling && sw.previousElementSibling.tagName === "INPUT")
        ? sw.previousElementSibling
        : (sw.parentElement && sw.parentElement.querySelector('input[type=checkbox]'));
      if (input) return input;
    }
    // 3) Any applicant.checked checkbox sitting near the name.
    return [...document.querySelectorAll('input[type=checkbox][ng-model="applicant.checked"]')].find((i) => {
      const box = i.closest("div,li,tr,label") || i.parentElement;
      return box && norm(box.textContent).includes(want);
    }) || null;
  };
  const ensureApplicantOn = async (name) => {
    const input = applicantInputByName(name);
    if (!input) return { ok: false, reason: "applicant-not-found", name };
    if (input.checked) return { ok: true };
    scrollOnce(input);
    const span = switcheryFor(input);
    if (span) {
      span.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
      await sleep(120);
    }
    if (!input.checked) {
      input.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
      await sleep(120);
    }
    return { ok: !!input.checked, reason: input.checked ? undefined : "toggle-did-not-turn-on", name };
  };

  const fillDateTime = async (input, ddmmyyyy) => {
    // Accept ISO yyyy-mm-dd too → normalise to dd/mm/yyyy (Infynity inputs only commit dd/mm/yyyy).
    const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(String(ddmmyyyy || "").trim());
    if (iso) ddmmyyyy = ("0" + iso[3]).slice(-2) + "/" + ("0" + iso[2]).slice(-2) + "/" + iso[1];
    if (input.dataset.efDateDone === ddmmyyyy) return { ok: true, skipped: true };
    if (!/^\d{2}\/\d{2}\/\d{4}$/.test(ddmmyyyy)) return { ok: false, reason: "bad-format", got: ddmmyyyy };
    scrollOnce(input);
    input.focus();
    setNativeValue(input, ddmmyyyy);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Escape", keyCode: 27, which: 27 }));
    input.blur();
    input.dispatchEvent(new Event("blur", { bubbles: true }));
    await sleep(160);
    const committed = input.value.trim() === ddmmyyyy
      && input.classList.contains("ng-not-empty")
      && !input.classList.contains("ng-invalid-parse");
    if (committed) {
      input.dataset.efDateDone = ddmmyyyy;
      return { ok: true };
    }
    return { ok: false, reason: "model-not-committed", got: input.value, cls: input.className };
  };

  const ensureRefinanceOff = async () => {
    const cb = document.querySelector('input[type=checkbox][ng-model="mvm.refinancing"]')
      || document.getElementById("checkbox-refinancing");
    if (!cb || !cb.checked) return;
    const span = switcheryFor(cb);
    if (span) {
      span.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
      await sleep(100);
    }
    if (cb.checked) {
      cb.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
      await sleep(100);
    }
  };

  async function fillNeedsAnalysis(caseData, EF) {
    caseData = caseData || {};
    const phase = "needsAnalysis";
    const blockers = [];
    const note = (label, r, fatalReason) => {
      if (r && (r.ok || r.skip || r.skipped)) {
        EF.log("info", { phase, label, result: r.skip || r.skipped ? "SKIP" : "OK" });
        return;
      }
      EF.log("error", { phase, label, result: "FAIL", ...(r || {}), reason: (r && r.reason) || fatalReason });
      blockers.push(label);
    };

    for (const s of [
      { label: "Method of Document Identification", ng: "mvm.form.document_identification_method", value: caseData.methodOfDocId || "VOI" },
      { label: "Method of Client Interview", ng: "mvm.form.interview_method", value: caseData.methodOfInterview || "Face to Face" },
    ]) {
      const el = (s.ng && document.querySelector('select[ng-model="' + s.ng + '"]')) || selectByLabel(s.label);
      let r = el ? setSelectExact(el, s.value) : { ok: false, reason: "select-not-found" };
      // Tolerant: if our desired option text isn't in this lender's dropdown but it ALREADY holds a
      // valid (non-placeholder) selection, keep that and DON'T abort the whole step over it.
      if (el && r && r.reason === "option-not-found") {
        const cur = el.selectedOptions && el.selectedOptions[0] ? norm(el.selectedOptions[0].textContent) : "";
        if (cur && !/^(select|please|choose|--|n\/a)/i.test(cur)) r = { ok: true, skip: true, kept: cur };
      }
      note(s.label, r);
    }

    for (const name of (caseData.applicantNames || ["Arsalan Saleem", "Araj Khan"])) {
      note("Applicant: " + name, await ensureApplicantOn(name));
    }

    note("Loan Objectives", await setObjectivesExact(caseData.loanObjectives || ["Purchase Owner Occupied Dwelling"]));
    note("Loan Requirements (General)", await setGroupExactByLabels(REQ, MEMBERS.general, caseData.loanRequirements || ["Offset", "Redraw"]));
    note("Rate types", await setGroupExactByLabels(REQ, MEMBERS.rateTypes, caseData.rateTypes || ["Variable Rate"]));
    note("Repayment types", await setGroupExactByLabels(REQ, MEMBERS.repaymentTypes, caseData.repaymentTypes || ["P & I Repayments"]));
    note("Repayment frequency", await setGroupExactByLabels(REQ, MEMBERS.repaymentFreq, caseData.repaymentFreq || ["Monthly Repayments"]));

    note("Loan Objective Explanation", setTextareaByNg("mvm.form.loan_purposes_description", caseData.loanObjectiveExplanation));
    note("Loan Requirements Explanation", setTextareaByNg("mvm.form.loan_requirements_description", caseData.loanRequirementsExplanation));

    await ensureRefinanceOff();

    const dates = [
      ["Date Credit Guide was Provided to Client", "mvm.form.credit_guide_provisioning_date", caseData.creditGuideDate],
      ["Date Interview was Conducted", "mvm.form.interview_date", caseData.interviewDate],
      ["Estimated Settlement Date", "mvm.form.estimated_settlement_date", caseData.settlementDate],
    ];
    for (const [label, ng, value] of dates) {
      if (!value) continue;
      const el = document.querySelector('input[ng-model="' + ng + '"]');
      note(label, el ? await fillDateTime(el, value) : { ok: false, reason: "date-input-not-found" });
    }

    if (blockers.length) {
      EF.log("error", { phase, label: "Needs Analysis", result: "BLOCKED", blockers });
      return { ok: false, blockers };
    }
    return { ok: true, phase };
  }

  fillNeedsAnalysis.__v = 3;
  window.EF_fillNeedsAnalysis = fillNeedsAnalysis;
})();
