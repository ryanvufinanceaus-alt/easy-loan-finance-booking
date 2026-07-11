import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardList,
  Download,
  ExternalLink,
  FileJson,
  History,
  UploadCloud,
  Play,
  RefreshCw,
  Search,
  Settings,
  ShieldCheck,
  Trash2,
  UserPlus
} from "lucide-react";

const isLoanFormHost = /^loan-form\./i.test(location.hostname);
const isClientCallHost = /^client-call\./i.test(location.hostname);
const isEasyFlowAiHost = /^(easyflow-ai|loanops|autofill)\./i.test(location.hostname);
const isLoanSubmissionsHost = /^(loan-submissions-management|loan-submissions|submissions)\./i.test(location.hostname);
const isPortalHost = /^portal\./i.test(location.hostname);
const isLoanSubmissionsRoute = isLoanSubmissionsHost || location.pathname === "/loan-submissions" || location.pathname === "/infinity-aol/loan-submissions";
const apiBase = isLoanFormHost
  ? location.origin
  : isClientCallHost || isEasyFlowAiHost || isLoanSubmissionsHost || (isPortalHost && isLoanSubmissionsRoute)
  ? location.origin
  : location.pathname.startsWith("/infinity-aol")
  ? `${location.origin}/infinity-aol`
  : ["localhost", "127.0.0.1"].includes(location.hostname)
    ? "http://127.0.0.1:8797"
    : `${location.origin}/infinity-aol`;
const appBasePath = !isLoanFormHost && !isClientCallHost && !isEasyFlowAiHost && !isLoanSubmissionsHost && location.pathname.startsWith("/infinity-aol") ? "/infinity-aol" : "";
const mockAolPath = `${appBasePath}/mock-infinity-aol`;
const brandLogoSrc = "/elf-logo.png";

function pageTitle() {
  if (isLoanSubmissionsRoute) return "Loan Case Manager - Easy Loan Finance";
  if (isClientCallHost || location.pathname.includes("client-call")) return "Client Call - Easy Loan Finance";
  if (isLoanFormHost) return "Loan Form - Easy Loan Finance";
  if (isEasyFlowAiHost) return "EasyFlow AI - Easy Loan Finance";
  return "EasyFlow AI - Infinity & AOL Automation";
}

function appMark(appName) {
  if (/submissions/i.test(appName)) return { code: "LS", label: "Loan Form Submissions" };
  if (/client call/i.test(appName)) return { code: "CC", label: "Client Call" };
  if (/loan form/i.test(appName)) return { code: "LF", label: "Loan Form" };
  return { code: "EF", label: "EasyFlow AI" };
}

function SystemBrand({ appName, compact = false }) {
  const mark = appMark(appName);
  return (
    <div className={`brand-block system-brand ${compact ? "compact-brand" : ""}`}>
      <img className="brand-logo" src={brandLogoSrc} alt="Easy Loan Finance" />
      <span className="app-mark" aria-label={mark.label}>{mark.code}</span>
      <div>
        <span>Easy Loan Finance</span>
        <strong>{appName}</strong>
      </div>
    </div>
  );
}

function appThemeClass() {
  if (isLoanSubmissionsRoute) return "theme-records";
  if (isClientCallHost || location.pathname.includes("client-call")) return "theme-call";
  if (isLoanFormHost) return "theme-loan-form";
  if (isEasyFlowAiHost) return "theme-easyflow";
  return "theme-easyflow";
}

function currency(value) {
  return new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD", maximumFractionDigits: 0 }).format(value || 0);
}

function parseMoneyInput(value) {
  const number = Number(String(value || "").replace(/[$,\s]/g, ""));
  return Number.isFinite(number) && number > 0 ? number : "";
}

function storageGet(key, fallback) {
  try {
    const value = localStorage.getItem(key);
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

function storageSet(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Local storage can be blocked in hardened browser profiles.
  }
}

function sessionTimeLabel(seconds) {
  if (seconds === null || seconds === undefined) return "";
  const safe = Math.max(0, Number(seconds) || 0);
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  if (hours) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function useSessionStatus() {
  const [session, setSession] = useState(null);

  async function refreshSession() {
    const status = await api("/api/auth/status");
    setSession(status);
    return status;
  }

  useEffect(() => {
    refreshSession().catch(() => {});
    const timer = window.setInterval(() => refreshSession().catch(() => {}), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  return { session, refreshSession };
}

function SessionWarning({ session }) {
  if (!session?.required || !session?.authenticated || session.secondsRemaining === null) return null;
  if (session.secondsRemaining > 15 * 60) return null;
  return (
    <div className="session-warning">
      <AlertTriangle size={16} />
      Session expires in {sessionTimeLabel(session.secondsRemaining)}. Save your work, then login again if needed.
    </div>
  );
}

function caseStorageKey(caseId) {
  return `infinity-aol-case-inputs:${caseId}`;
}

function fileSizeLabel(bytes) {
  if (!bytes) return "0 KB";
  if (bytes > 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function classifyQueuedFile(file) {
  const name = file.name.toLowerCase();
  if (/driver|licen[cs]e|passport|medicare|id|voi/.test(name)) return "identity";
  if (/pay|income|salary|financial|accountant|bas|tax/.test(name)) return "income";
  if (/bank|statement|saving|deposit/.test(name)) return "bank statement";
  if (/contract|sale|purchase/.test(name)) return "contract";
  if (/ocr-/.test(name)) return "ocr text";
  return "supporting";
}

function recommendedHem(caseData) {
  const applicantCount = caseData?.applicants?.length || 1;
  const dependants = Math.max(...(caseData?.applicants || []).map((applicant) => Number(applicant.dependants || 0)), 0);
  const base = applicantCount > 1 ? 4300 : 3200;
  const withDependants = base + dependants * 500;
  return Math.round(withDependants / 100) * 100;
}

function caseHasSecondApplicant(caseData, manualIntake = {}) {
  if (manualIntake.hasSecondApplicant === "Yes") return true;
  if (manualIntake.hasSecondApplicant === "No") return false;
  return Boolean(
    caseData?.applicants?.some((applicant) => applicant.role === "secondary") ||
      manualIntake.secondaryApplicantName ||
      manualIntake.secondaryAnnualIncome ||
      manualIntake.secondaryDriversLicenceNo
  );
}

function initialManualIntake(caseData) {
  if (!caseData) return {};
  const primary = caseData.applicants.find((applicant) => applicant.role === "primary") || {};
  const secondary = caseData.applicants.find((applicant) => applicant.role === "secondary") || {};
  return {
    hasSecondApplicant: secondary.firstName || secondary.lastName || secondary.income?.baseAnnual ? "Yes" : "No",
    primaryApplicantName: [primary.firstName, primary.middleName, primary.lastName].filter(Boolean).join(" ") || primary.name || "",
    secondaryApplicantName: [secondary.firstName, secondary.middleName, secondary.lastName].filter(Boolean).join(" ") || secondary.name || "",
    loanAmount: caseData.loan?.loanAmount || "",
    propertyPurchasePrice: caseData.property?.purchasePrice || caseData.property?.estimatedValue || "",
    depositEquity: caseData.loan?.deposit || "",
    lvr: caseData.loan?.lvr || "",
    primaryAnnualIncome: primary.income?.baseAnnual || "",
    secondaryAnnualIncome: secondary.income?.baseAnnual || "",
    primaryDateOfBirth: primary.dateOfBirth || "",
    secondaryDateOfBirth: secondary.dateOfBirth || "",
    primaryGender: primary.gender || "",
    secondaryGender: secondary.gender || "",
    primaryMobile: primary.mobile || "",
    secondaryMobile: secondary.mobile || "",
    primaryEmail: primary.email || "",
    secondaryEmail: secondary.email || "",
    primaryDriversLicenceNo: primary.id?.driversLicenceNo || "",
    primaryLicenceExpiryDate: primary.id?.licenceExpiryDate || "",
    primaryLicenceCardNumber: primary.id?.licenceCardNumber || "",
    primaryLicenceState: primary.id?.licenceState || "",
    primaryLicenceClass: primary.id?.licenceClass || "",
    secondaryDriversLicenceNo: secondary.id?.driversLicenceNo || "",
    secondaryLicenceExpiryDate: secondary.id?.licenceExpiryDate || "",
    secondaryLicenceCardNumber: secondary.id?.licenceCardNumber || "",
    secondaryLicenceState: secondary.id?.licenceState || "",
    secondaryLicenceClass: secondary.id?.licenceClass || ""
  };
}

async function api(path, options) {
  const { headers, ...fetchOptions } = options || {};
  const method = fetchOptions.method || "GET";
  const response = await fetch(`${apiBase}${path}`, {
    ...fetchOptions,
    cache: "no-store",
    headers: { accept: "application/json", "content-type": "application/json", ...(headers || {}) }
  });
  const contentType = response.headers.get("content-type") || "";
  const text = await response.text();
  let data = null;
  if (contentType.includes("application/json") && text) {
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error("API returned broken JSON. Please refresh and try again.");
    }
  }

  if (!contentType.includes("application/json")) {
    const shortBody = text.replace(/\s+/g, " ").trim().slice(0, 120);
    console.error("Expected JSON API response", {
      url: `${apiBase}${path}`,
      status: response.status,
      contentType,
      body: text.slice(0, 300)
    });
    throw new Error(response.status === 401
      ? "Your session has expired. Please log in again."
      : `API connection issue on ${method} ${path}. Server returned ${contentType || "unknown content"} ${response.status}${shortBody ? `: ${shortBody}` : ""}`);
  }

  if (!response.ok) throw new Error(data?.detail || data?.error || response.statusText || "API request failed.");
  return data;
}

function IssueList({ issues, onFixIssue, onAutoFixIssue }) {
  if (!issues) {
    return <div className="empty-state">Prepare the CRM case to run Infinity/AOL validation.</div>;
  }

  if (!issues.length) {
    return (
      <div className="empty-state success">
        <CheckCircle2 size={18} />
        Validation passed. Payload is ready for broker review and section-by-section autofill.
      </div>
    );
  }

  return (
    <div className="issue-list">
      {issues.map((issue) => (
        <div className={`issue ${issue.severity}`} key={`${issue.code}-${issue.path}`}>
          <AlertTriangle size={17} />
          <div>
            <strong>{issue.code.replaceAll("_", " ")}</strong>
            <span>{issue.message}</span>
            <small>{issue.path}</small>
            <IssueFixGuide issue={issue} />
            <div className="issue-actions">
              {["LVR_MISMATCH", "DEPOSIT_LOAN_TOTAL_MISMATCH"].includes(issue.code) && (
                <button className="ghost-button mini-button" type="button" onClick={() => onAutoFixIssue?.(issue)}>
                  Auto fix
                </button>
              )}
              <button className="ghost-button mini-button" type="button" onClick={() => onFixIssue?.(issue)}>
                Fix here
              </button>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function ValidationFixPanel({ issue, manualIntake, preparedPayload, onChange, onClose, onSavePrepare }) {
  if (!issue) return null;
  const loanAmount = manualIntake.loanAmount || preparedPayload?.loan?.loanAmount || "";
  const purchasePrice = manualIntake.propertyPurchasePrice || preparedPayload?.property?.purchasePrice || "";
  const deposit = manualIntake.depositEquity || preparedPayload?.loan?.deposit || "";
  const lvr = manualIntake.lvr || preparedPayload?.loan?.lvr || "";
  const missingPath = issue.code === "MISSING_REQUIRED_FIELD" ? issue.path : "";

  return (
    <div className="validation-fix-panel">
      <div className="split-title">
        <div>
          <strong>Fix validation issue</strong>
          <small>{issue.code.replaceAll("_", " ")} {issue.path ? `- ${issue.path}` : ""}</small>
        </div>
        <button className="ghost-button mini-button" type="button" onClick={onClose}>Close</button>
      </div>
      {missingPath && (
        <p className="panel-helper">This field is missing from the prepared payload. Fill the matching field below if shown, or update it in Loan Case Manager / Loan Form record.</p>
      )}
      <div className="quick-input-grid compact-grid">
        <label>
          Loan amount
          <input value={loanAmount} onChange={(event) => onChange("loanAmount", event.target.value)} />
        </label>
        <label>
          Property / security value
          <input value={purchasePrice} onChange={(event) => onChange("propertyPurchasePrice", event.target.value)} />
        </label>
        <label>
          Deposit/equity
          <input value={deposit} onChange={(event) => onChange("depositEquity", event.target.value)} />
        </label>
        <label>
          LVR %
          <input value={lvr} onChange={(event) => onChange("lvr", event.target.value)} />
        </label>
      </div>
      <button className="primary-button" type="button" onClick={onSavePrepare}>
        Save fix & prepare again
      </button>
    </div>
  );
}

function IssueFixGuide({ issue }) {
  const guides = {
    LVR_MISMATCH: {
      title: "Where to fix",
      steps: [
        "Open Loan Case Manager or the linked Loan Form record.",
        "Check Loan amount and Security / Property value.",
        "If those numbers are correct, update CRM LVR to the calculated LVR, then Save and Prepare again."
      ]
    },
    DEPOSIT_LOAN_TOTAL_MISMATCH: {
      title: "Where to fix",
      steps: [
        "Check Purchase price, Deposit/equity, and Loan amount in the Loan Request / Property section.",
        "Deposit plus loan amount should match the purchase price unless there is a clear reason in notes."
      ]
    },
    MISSING_REQUIRED_FIELD: {
      title: "Where to fix",
      steps: [
        "Open the selected case in Loan Case Manager.",
        "Search for the field path shown above, fill the missing client information, then Save and Prepare again."
      ]
    },
    LMI_REVIEW_REQUIRED: {
      title: "Broker check",
      steps: [
        "Review whether LMI applies before Push AOL.",
        "Confirm LMI treatment, lender policy, and notes before final broker review."
      ]
    },
    PENDING_DOCUMENTS: {
      title: "Document check",
      steps: [
        "Review the document checklist and mark received files before treating the case as complete.",
        "You can still prepare autofill if no hard validation errors remain."
      ]
    },
    DOCUMENT_EXTRACTION_NEEDS_REVIEW: {
      title: "Document check",
      steps: [
        "Open Document Intake and review OCR/AI extracted values.",
        "Correct any licence, income, bank, or contract values before preparing AOL."
      ]
    }
  };
  const guide = guides[issue.code];
  if (!guide) return null;

  return (
    <div className="issue-guide">
      <b>{guide.title}</b>
      <ol>
        {guide.steps.map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ol>
    </div>
  );
}

function CaseDocuments({ caseData }) {
  const captures = caseData?.captures || {};
  const docHistory = captures.docHistory || {};
  const caseId = caseData?.id;
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const clientName = (caseData?.applicants || [])
    .map((a) => [a.firstName, a.lastName || a.surname].filter(Boolean).join(" ")).filter(Boolean).join(" & ");
  const fileSlug = (clientName || "client").toUpperCase().replace(/[^A-Z0-9]+/g, "_");

  async function download(path, filename, body) {
    setBusy(true); setMsg("Generating…");
    try {
      const res = await fetch(`${apiBase}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body || {}) });
      if (res.status === 401) { setMsg("Please sign in again."); return; }
      if (!res.ok) { setMsg("Failed: " + (await res.text().catch(() => "")).slice(0, 120)); return; }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a"); a.href = url; a.download = filename; document.body.appendChild(a); a.click();
      setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 1500);
      setMsg("✓ Downloaded " + filename + " (refresh case to update history)");
    } catch (error) { setMsg("Failed: " + error.message); } finally { setBusy(false); }
  }
  const histLine = (label, e) => <li key={label}>{label}: {e?.at ? `✓ ${e.count || 1}× · ${new Date(e.at).toLocaleString()}` : "not downloaded yet"}</li>;

  return (
    <div style={{ marginBottom: 12, padding: "10px 12px", background: "#fff", border: "1px solid #e2e5ea", borderRadius: 8 }}>
      <strong>📄 Documents</strong>
      <div style={{ fontSize: 11, color: "#6b7280", marginTop: 2 }}>Generated from this prepared case. Recommendation Notes prefill from the case; refine in the Word file.</div>
      <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
        <button type="button" disabled={busy} onClick={() => download(`/api/cases/${encodeURIComponent(caseId)}/recommendation-notes?format=pdf`, `RECNOTES_${fileSlug}.pdf`)}>Rec Notes · PDF</button>
        <button type="button" disabled={busy} onClick={() => download(`/api/cases/${encodeURIComponent(caseId)}/recommendation-notes?format=docx`, `RECNOTES_${fileSlug}.docx`)}>Rec Notes · Word</button>
        <button type="button" disabled={busy} onClick={() => download(`/api/cases/${encodeURIComponent(caseId)}/ytd-calc`, `YTD_${fileSlug}.xlsx`)}>YTD · Excel</button>
      </div>
      <div style={{ fontSize: 11, color: "#6b7280", marginTop: 4 }}>YTD prefills client + base income from the case; complete the yellow payslip cells in Excel.</div>
      <ul style={{ fontSize: 12, color: "#6b7280", marginTop: 8, paddingLeft: 18 }}>{histLine("YTD Excel", docHistory.ytd)}{histLine("Rec PDF", docHistory.recPdf)}{histLine("Rec Word", docHistory.recDocx)}</ul>
      {msg && <div style={{ fontSize: 12, marginTop: 4, color: "#1f2937" }}>{msg}</div>}
    </div>
  );
}

function CaseFacts({ caseData }) {
  if (!caseData) return null;
  // Show the EFFECTIVE (synced/updated) version by default; the original is preserved server-side.
  const eff = caseData.effective || caseData;
  const effApplicants = Array.isArray(eff.applicants) ? eff.applicants : [];
  const primary = effApplicants.find((applicant) => applicant.role === "primary") || effApplicants[0];
  const secondary = effApplicants.find((applicant) => applicant.role === "secondary") || (effApplicants.length > 1 ? effApplicants[1] : null);
  const origApplicants = Array.isArray(caseData.applicants) ? caseData.applicants : [];
  const droppedSecondary = origApplicants.length > effApplicants.length;
  const brokerVer = caseData.versions?.broker || null;
  const loanFormNotes = Array.isArray(caseData.loanFormNotes) ? caseData.loanFormNotes : [];
  const captures = caseData.captures || {};
  const selectedLender = captures.selectedLender || null;
  const scenarios = Array.isArray(captures.lenderScenarios) ? captures.lenderScenarios : [];
  return (
    <>
      {brokerVer && (
        <div className="broker-version-badge" style={{ marginBottom: 12, padding: "10px 12px", background: "#fff7e6", border: "1px solid #f0d9a8", borderRadius: 8, color: "#92400e" }}>
          <strong>② Broker updated — Infinity &amp; AOL</strong>
          {brokerVer.updatedAt ? <span style={{ fontWeight: 600 }}> · {new Date(brokerVer.updatedAt).toLocaleString()}</span> : null}
          {Array.isArray(brokerVer.changedFields) && brokerVer.changedFields.length ? (
            <div style={{ fontSize: 12, marginTop: 3 }}>Updated: {brokerVer.changedFields.join(", ")}</div>
          ) : null}
          <div style={{ fontSize: 11.5, color: "#9a7b4f", marginTop: 3 }}>Showing the synced version below. The original loan-form case is kept (① Loan form).</div>
        </div>
      )}
      {loanFormNotes.length > 0 && (
        <div className="loan-form-note" style={{ marginBottom: 12, padding: "10px 12px", background: "#fffbeb", border: "1px solid #fcd34d", borderRadius: 8, color: "#92400e" }}>
          <strong>⚠️ Loan Form mismatch on this case</strong>
          <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
            {loanFormNotes.map((m, idx) => (
              <li key={idx}>{m.field} — Loan Form: <strong>{m.loanForm}</strong> (differs in Infinity)</li>
            ))}
          </ul>
        </div>
      )}
      {(
        <div className="lender-sync" style={{ marginBottom: 12, padding: "10px 12px", background: "#f0fdf4", border: "1px solid #86efac", borderRadius: 8, color: "#14532d" }}>
          <strong>🏦 Lender &amp; product (synced from Infinity)</strong>
          {selectedLender ? (
            <div style={{ marginTop: 6, fontSize: 13 }}>
              Confirmed: <strong>{selectedLender.lender || "—"}</strong>
              {selectedLender.product ? <> · <span title="Product">{selectedLender.product}</span></> : null}
              {selectedLender.rate ? <> · {selectedLender.rate}%</> : null}
              {selectedLender.term ? <> · {selectedLender.term} yrs</> : null}
            </div>
          ) : scenarios.length > 0 ? (
            <div style={{ marginTop: 6, fontSize: 13, color: "#65a30d" }}>Lender not confirmed yet — broker confirms it in Infinity Recommendation.</div>
          ) : (
            <div style={{ marginTop: 6, fontSize: 13, color: "#65a30d" }}>Not synced yet — run Infinity AutoFill (through Preferred Features) and confirm the lender; it appears here automatically.</div>
          )}
          {scenarios.length > 0 && (
            <table style={{ marginTop: 8, width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead>
                <tr style={{ textAlign: "left", color: "#3f6212" }}>
                  <th style={{ padding: "2px 6px" }}>Lender</th>
                  <th style={{ padding: "2px 6px" }}>Product</th>
                  <th style={{ padding: "2px 6px" }}>Rate</th>
                  <th style={{ padding: "2px 6px" }}>Term</th>
                </tr>
              </thead>
              <tbody>
                {scenarios.map((s, idx) => {
                  const isChosen = selectedLender && (s.lender || "").toLowerCase().includes((selectedLender.lender || "").toLowerCase()) && selectedLender.lender;
                  return (
                    <tr key={idx} style={{ background: isChosen ? "#dcfce7" : "transparent", fontWeight: isChosen ? 700 : 400 }}>
                      <td style={{ padding: "2px 6px" }}>{s.lender || "—"}{isChosen ? " ✓" : ""}</td>
                      <td style={{ padding: "2px 6px" }}>{s.product || "—"}</td>
                      <td style={{ padding: "2px 6px" }}>{s.rate || "—"}</td>
                      <td style={{ padding: "2px 6px" }}>{s.term || "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      )}
      {Array.isArray(captures.syncHistory) && captures.syncHistory.length > 0 && (
        <div className="sync-history" style={{ marginBottom: 12, padding: "10px 12px", background: "#eef2ff", border: "1px solid #c7d2fe", borderRadius: 8, color: "#3730a3" }}>
          <strong>🔁 Update history — what was copied between Infinity & AOL</strong>
          <div style={{ fontSize: 11, color: "#6366f1", marginTop: 2 }}>Every time the broker copied numbers from one system to the other, with exactly what changed.</div>
          <div style={{ marginTop: 8 }}>
            {captures.syncHistory.slice().reverse().slice(0, 25).map((entry, idx) => (
              <div key={idx} style={{ borderTop: "1px solid #ddd6fe", padding: "6px 0", fontSize: 12 }}>
                <div>
                  <strong>{entry.direction || "Sync"}</strong> · {entry.appliedCount || 0} row(s)
                  <span style={{ color: "#818cf8" }}> · {entry.at ? new Date(entry.at).toLocaleString() : ""} · {entry.by || "broker"}</span>
                </div>
                {Array.isArray(entry.changes) && entry.changes.length > 0 ? (
                  <ul style={{ margin: "3px 0 0", paddingLeft: 18 }}>
                    {entry.changes.map((change, ci) => {
                      const fmt = (v) => (v == null ? "—" : (typeof v === "number" || /^\$?[\d,.\s]+$/.test(String(v)) ? currency(v) : String(v)));
                      return (
                        <li key={ci}>{change.field}: {fmt(change.from)} → <strong>{fmt(change.to)}</strong>{change.auto ? <span style={{ color: "#0d9488" }}> · auto</span> : null}</li>
                      );
                    })}
                  </ul>
                ) : (
                  <div style={{ color: "#818cf8", paddingLeft: 4 }}>(no value diffs recorded)</div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
      <CaseDocuments caseData={caseData} />
    <div className="facts-grid">
      <div>
        <span>Primary applicant</span>
        <strong>{primary ? `${primary.firstName} ${primary.lastName}` : "Missing"}</strong>
      </div>
      <div>
        <span>Second applicant</span>
        <strong>{secondary ? `${secondary.firstName} ${secondary.lastName}` : (droppedSecondary ? "Removed (synced)" : "None")}</strong>
      </div>
      <div>
        <span>Loan amount</span>
        <strong>{currency(eff.loan?.loanAmount)}</strong>
      </div>
      <div>
        <span>Security</span>
        <strong>{eff.property?.address || "Missing address"}</strong>
      </div>
      <div>
        <span>Documents</span>
        <strong>
          {caseData.documentChecklist.filter((doc) => doc.status === "received").length}/{caseData.documentChecklist.length} received
        </strong>
      </div>
    </div>
    </>
  );
}

function TeamSettingsPanel({ appName }) {
  const { session: auth, refreshSession } = useSessionStatus();
  const [open, setOpen] = useState(false);
  const [brokers, setBrokers] = useState([]);
  const [form, setForm] = useState({ name: "", email: "", phone: "", accessLevel: "staff", accessCode: "" });
  const [passwordForm, setPasswordForm] = useState({ currentPassword: "", newPassword: "", confirmPassword: "" });
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function refresh() {
    const [, brokerData] = await Promise.all([
      refreshSession(),
      api("/api/brokers")
    ]);
    setBrokers(brokerData);
  }

  useEffect(() => {
    refresh().catch(() => {});
  }, []);

  async function createBrokerUser(event) {
    event.preventDefault();
    setMessage("");
    setError("");
    try {
      const saved = await api("/api/brokers", {
        method: "POST",
        body: JSON.stringify({
          ...form,
          title: "Finance Broker",
          location: "Adelaide, SA",
          services: ["Home loan consultation", "Refinance", "Pre-approval"]
        })
      });
      setMessage(`User created: ${saved.name}`);
      setForm({ name: "", email: "", phone: "", accessLevel: "staff", accessCode: "" });
      await refresh();
    } catch (err) {
      setError(err.message);
    }
  }

  async function saveAccessCode(broker, accessCode) {
    setMessage("");
    setError("");
    try {
      await api(`/api/brokers/${broker.id}`, {
        method: "PATCH",
        body: JSON.stringify({ accessCode })
      });
      setMessage(`Access updated for ${broker.name}`);
      await refresh();
    } catch (err) {
      setError(err.message);
    }
  }

  async function saveAccessLevel(broker, accessLevel) {
    setMessage("");
    setError("");
    try {
      await api(`/api/brokers/${broker.id}`, {
        method: "PATCH",
        body: JSON.stringify({ accessLevel })
      });
      setMessage(`Access level updated for ${broker.name}`);
      await refresh();
    } catch (err) {
      setError(err.message);
    }
  }

  async function resetAccessCode(broker) {
    if (!window.confirm(`Reset access code for ${broker.name}? The temporary code will be emailed to Ryan admin.`)) return;
    setMessage("");
    setError("");
    try {
      const result = await api(`/api/brokers/${broker.id}/reset-access`, {
        method: "POST",
        body: "{}"
      });
      setMessage(result.message || `Access reset for ${broker.name}.`);
      await refresh();
    } catch (err) {
      setError(err.message);
    }
  }

  async function deleteBrokerUser(broker) {
    const expected = `DELETE ${broker.id}`;
    const typed = window.prompt(`Remove this user from internal tools.\n\nType ${expected} to confirm.`);
    if (typed !== expected) return;
    setMessage("");
    setError("");
    try {
      await api(`/api/brokers/${broker.id}`, { method: "DELETE" });
      setMessage(`User removed: ${broker.name}`);
      await refresh();
    } catch (err) {
      setError(err.message);
    }
  }

  async function logout() {
    await api("/api/auth/logout", { method: "POST" }).catch(() => {});
    window.location.href = `/login?returnTo=${encodeURIComponent(location.pathname + location.search)}`;
  }

  async function changePassword(event) {
    event.preventDefault();
    setMessage("");
    setError("");
    if (passwordForm.newPassword !== passwordForm.confirmPassword) {
      setError("New access codes do not match.");
      return;
    }
    try {
      const result = await api("/api/auth/change-password", {
        method: "POST",
        body: JSON.stringify(passwordForm)
      });
      setPasswordForm({ currentPassword: "", newPassword: "", confirmPassword: "" });
      setMessage(result.message || "Access updated.");
      await refresh();
    } catch (err) {
      setError(err.message);
    }
  }

  const isAdmin = !auth?.required || auth?.role === "admin";

  return (
    <details className="team-settings" open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary>
        <span><Settings size={16} /> Settings</span>
        <small>{auth?.role === "broker" ? "Broker access" : "Admin access"}</small>
      </summary>
      <div className="team-settings-body">
        <div className="team-session-card">
          <span>{appName}</span>
          <strong>{auth?.email || "Local admin"}</strong>
          <small>{auth?.secondsRemaining !== null && auth?.secondsRemaining !== undefined ? `Session: ${sessionTimeLabel(auth.secondsRemaining)} remaining` : "Session: local admin mode"}</small>
          <small>{isAdmin ? "Ryan admin can add broker users and access codes here." : "Broker users can use assigned internal tools only."}</small>
          <button type="button" onClick={logout}>Logout</button>
        </div>
        <SessionWarning session={auth} />
        <form className="team-user-form" onSubmit={changePassword}>
          <label>Current password/access code<input value={passwordForm.currentPassword} onChange={(event) => setPasswordForm({ ...passwordForm, currentPassword: event.target.value })} type="password" required /></label>
          <label>New password/access code<input value={passwordForm.newPassword} onChange={(event) => setPasswordForm({ ...passwordForm, newPassword: event.target.value })} type="password" minLength={6} required /></label>
          <label>Confirm new<input value={passwordForm.confirmPassword} onChange={(event) => setPasswordForm({ ...passwordForm, confirmPassword: event.target.value })} type="password" minLength={6} required /></label>
          <button type="submit">Change access code</button>
          {isAdmin && <small className="settings-note">Ryan admin can reset by email. New password here overrides the Render env fallback.</small>}
        </form>
        {isAdmin ? (
          <>
            <form className="team-user-form" onSubmit={createBrokerUser}>
              <label>Name<input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="Broker / staff name" required /></label>
              <label>Email<input value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} placeholder="user@easyloanfinance.com.au" required /></label>
              <label>Phone<input value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} placeholder="04..." /></label>
              <label>Access level<select value={form.accessLevel} onChange={(event) => setForm({ ...form, accessLevel: event.target.value })}><option value="staff">Staff - call intake only</option><option value="broker">Broker - submissions + EasyFlow</option></select></label>
              <label>Access code<input value={form.accessCode} onChange={(event) => setForm({ ...form, accessCode: event.target.value })} placeholder="Private login code" required /></label>
              <button type="submit"><UserPlus size={15} /> Add user</button>
            </form>
            <div className="team-user-list">
              {brokers.map((broker) => (
                <div key={broker.id} className="team-user-row">
                  <div>
                    <strong>{broker.name}</strong>
                    <small>{broker.email || "No email set"} | {(broker.accessLevel || "broker").toUpperCase()}</small>
                  </div>
                  <select
                    defaultValue={broker.accessLevel || "broker"}
                    onChange={(event) => saveAccessLevel(broker, event.target.value)}
                  >
                    <option value="staff">Staff</option>
                    <option value="broker">Broker</option>
                  </select>
                  <input
                    defaultValue={broker.accessCode || ""}
                    placeholder="Access code"
                    onBlur={(event) => {
                      if (event.target.value !== (broker.accessCode || "")) saveAccessCode(broker, event.target.value);
                    }}
                  />
                  <div className="team-user-actions">
                    <button type="button" onClick={() => resetAccessCode(broker)}>Reset</button>
                    <button type="button" className="danger-mini-button" onClick={() => deleteBrokerUser(broker)}><Trash2 size={13} /> Remove</button>
                  </div>
                </div>
              ))}
            </div>
            <a className="settings-link" href="https://portal.easyloanfinance.com.au" target="_blank" rel="noreferrer">Open BrokerDesk Team & Users for full CRM roles</a>
          </>
        ) : (
          <p className="panel-helper">Ask Ryan admin to change your access code, role, or CRM permissions.</p>
        )}
        {message && <div className="success-banner compact">{message}</div>}
        {error && <div className="error-banner compact">{error}</div>}
      </div>
    </details>
  );
}

function InternalLoginPage() {
  const [email, setEmail] = useState("ryan.vufinanceaus@gmail.com");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const appName = isLoanSubmissionsHost ? "Loan Form Submissions Management" : isClientCallHost ? "Client Call Intake" : "EasyFlow AI";
  const appCopy = isLoanSubmissionsHost
    ? "Secure broker access for reviewing, editing, and exporting client fact-find submissions."
    : isClientCallHost
      ? "Secure staff access for phone intake, quick notes, and loan form links."
      : "Secure staff access for Infinity & AOL automation, case payloads, and autofill preparation.";

  useEffect(() => {
    document.title = `${appName} Login - Easy Loan Finance`;
    api("/api/auth/status")
      .then((status) => {
        if (!status.required || status.authenticated) {
          const returnTo = new URLSearchParams(window.location.search).get("returnTo") || "/";
          window.location.href = returnTo.startsWith("/") ? returnTo : "/";
        }
      })
      .catch(() => {});
  }, [appName]);

  async function submitLogin(event) {
    event.preventDefault();
    setLoading(true);
    setError("");
    try {
      await api("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password })
      });
      const returnTo = new URLSearchParams(window.location.search).get("returnTo") || "/";
      window.location.href = returnTo.startsWith("/") ? returnTo : "/";
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="internal-login-shell">
      <section className="internal-login-card">
        <div className="internal-login-brand">
          <SystemBrand appName={appName} compact />
        </div>
        <div className="internal-login-copy">
          <span>Staff only</span>
          <h1>Sign in to {appName}</h1>
          <p>{appCopy}</p>
        </div>
        <form className="internal-login-form" onSubmit={submitLogin}>
          <label>
            Email
            <input value={email} onChange={(event) => setEmail(event.target.value)} type="email" />
          </label>
          <label>
            Password or broker access code
            <input autoFocus value={password} onChange={(event) => setPassword(event.target.value)} type="password" placeholder="Enter secure access" />
          </label>
          {error && <div className="error-banner compact">{error}</div>}
          <button className="primary-button" type="submit" disabled={loading}>
            {loading ? <RefreshCw size={17} className="spin" /> : <ShieldCheck size={17} />}
            {loading ? "Checking..." : "Login"}
          </button>
        </form>
      </section>
    </main>
  );
}

function WorkflowGuide({ selectedCaseId, prepared, documentDraft }) {
  const steps = [
    {
      title: "1. Select case",
      body: selectedCaseId ? selectedCaseId : "Search or choose a case by client name.",
      done: Boolean(selectedCaseId)
    },
    {
      title: "2. Review data",
      body: documentDraft
        ? `${documentDraft.extracted?.fieldSuggestions?.length || 0} extracted field(s), ${documentDraft.warnings?.length || 0} warning(s).`
        : "Drop files or use quick inputs, then review OCR warnings.",
      done: Boolean(documentDraft)
    },
    {
      title: "3. Use extension",
      body: prepared
        ? `Ready. Enter ${prepared.caseId} or token ${prepared.token.slice(0, 10)}... in the extension.`
        : "Prepare payload, open Infinity/AOL, then click Start AutoFill in the extension.",
      done: Boolean(prepared)
    }
  ];

  return (
    <section className="workflow-guide" aria-label="EasyFlow AI workflow">
      {steps.map((step) => (
        <div className={step.done ? "done" : ""} key={step.title}>
          <CheckCircle2 size={16} />
          <strong>{step.title}</strong>
          <span>{step.body}</span>
        </div>
      ))}
    </section>
  );
}

function MockInfinity() {
  return (
    <main className="mock-shell">
      <header className="mock-header">
        <div>
          <span>Mock Infinity AOL</span>
          <h1>Application Online</h1>
        </div>
        <button className="push-button" type="button">Push AOL</button>
      </header>
      <section className="mock-section">
        <h2>Applicants</h2>
        <div className="form-grid">
          <label>Primary first name<input name="primaryFirstName" data-aol-field="primary.firstName" /></label>
          <label>Primary last name<input name="primaryLastName" data-aol-field="primary.lastName" /></label>
          <label>Primary DOB<input name="primaryDob" data-aol-field="primary.dateOfBirth" /></label>
          <label>Primary email<input name="primaryEmail" data-aol-field="primary.email" /></label>
          <label>Primary mobile<input name="primaryMobile" data-aol-field="primary.mobile" /></label>
          <label>Secondary first name<input name="secondaryFirstName" data-aol-field="secondary.firstName" /></label>
          <label>Secondary last name<input name="secondaryLastName" data-aol-field="secondary.lastName" /></label>
        </div>
      </section>
      <section className="mock-section">
        <h2>Employment and Income</h2>
        <div className="form-grid">
          <label>Primary employment status<input name="primaryEmploymentStatus" data-aol-field="primary.employment.status" /></label>
          <label>Primary employer<input name="primaryEmployerName" data-aol-field="primary.employment.employerName" /></label>
          <label>Primary base income<input name="primaryBaseAnnual" data-aol-field="primary.income.baseAnnual" /></label>
          <label>Secondary employment status<input name="secondaryEmploymentStatus" data-aol-field="secondary.employment.status" /></label>
          <label>Secondary base income<input name="secondaryBaseAnnual" data-aol-field="secondary.income.baseAnnual" /></label>
        </div>
      </section>
      <section className="mock-section">
        <h2>Loan Structure</h2>
        <div className="form-grid">
          <label>Application type<input name="applicationType" data-aol-field="loan.applicationType" /></label>
          <label>Loan amount<input name="loanAmount" data-aol-field="loan.loanAmount" /></label>
          <label>LVR<input name="lvr" data-aol-field="loan.lvr" /></label>
          <label>Repayment type<input name="repaymentType" data-aol-field="loan.repaymentType" /></label>
          <label>Loan term<input name="loanTermYears" data-aol-field="loan.loanTermYears" /></label>
        </div>
      </section>
      <section className="mock-section">
        <h2>Property and Expenses</h2>
        <div className="form-grid">
          <label>Property address<input name="propertyAddress" data-aol-field="property.address" /></label>
          <label>Purchase price<input name="purchasePrice" data-aol-field="property.purchasePrice" /></label>
          <label>Property type<input name="propertyType" data-aol-field="property.propertyType" /></label>
          <label>Living expenses<input name="livingMonthly" data-aol-field="expenses.livingMonthly" /></label>
          <label>Total monthly expenses<input name="totalMonthlyExpenses" data-aol-field="expenses.totalMonthly" /></label>
          <label>HEM monthly<input name="hemMonthly" data-aol-field="serviceability.hemMonthly" /></label>
          <label>Financial asset buffer<input name="financialAssetBuffer" data-aol-field="serviceability.financialAssetBuffer" /></label>
        </div>
      </section>
      <section className="mock-section">
        <h2>Needs Analysis</h2>
        <div className="check-grid">
          <label><input type="checkbox" /> Purchase Investment Property</label>
          <label><input type="checkbox" /> Purchase Owner Occupied Dwelling</label>
          <label><input type="checkbox" /> Offset</label>
          <label><input type="checkbox" /> Redraw</label>
          <label><input type="checkbox" /> Variable Rate</label>
          <label><input type="checkbox" /> P & I Repayments</label>
          <label><input type="checkbox" /> Monthly Repayments</label>
        </div>
        <label className="wide-field">Loan Objective Explanation<textarea /></label>
      </section>
      <section className="mock-section">
        <h2>Loans, Securities & Commentary</h2>
        <div className="form-grid">
          <label>Loan Purpose<input /></label>
          <label>Facility Amount<input /></label>
          <label>Any Significant Changes to Circumstances Anticipated?<div className="button-group"><button type="button">Yes</button><button type="button">No</button></div></label>
        </div>
        <label className="wide-field">Circumstances, Objectives and Priorities<textarea /></label>
        <label className="wide-field">Financial Awareness & Practices<textarea /></label>
      </section>
      <section className="mock-section">
        <h2>Preferred Loan Features/Scenarios</h2>
        {[1, 2, 3, 4, 5].map((priority) => (
          <div className="priority-row" key={priority}>
            <label>{`Priority ${priority} Loan Feature`}<input /></label>
            <label>Reasons for selecting this type<textarea /></label>
          </div>
        ))}
      </section>
      <section className="mock-section">
        <h2>Compliance</h2>
        <div className="form-grid">
          <label>Which product rate type is most important<div className="button-group"><button type="button">Fixed</button><button type="button">Variable</button><button type="button">Fixed and variable</button></div></label>
          <label>How important is principal and interest<div className="button-group"><button type="button">Important</button><button type="button">Not important</button><button type="button">Don't want</button></div></label>
          <label>How important is having an offset account<div className="button-group"><button type="button">Important</button><button type="button">Not important</button><button type="button">Don't want</button></div></label>
          <label>How important is having a redraw account<div className="button-group"><button type="button">Important</button><button type="button">Not important</button><button type="button">Don't want</button></div></label>
        </div>
        <div className="check-grid">
          <label><input type="checkbox" /> Flexibility with respect to repayment, redraw and/or early repayment of loan</label>
          <label><input type="checkbox" /> Minimise interest paid over life of loan</label>
          <label><input type="checkbox" /> Build up equity from the start</label>
          <label><input type="checkbox" /> Allows access to funds</label>
          <label><input type="checkbox" /> Flexibility to access prepaid funds if needed</label>
        </div>
        <label className="wide-field">Product selection<textarea /></label>
      </section>
    </main>
  );
}

const emptyCallNote = {
  brokerUser: "ryan.vu",
  clientName: "",
  firstName: "",
  middleName: "",
  surname: "",
  hasSecondApplicant: "No",
  secondApplicantName: "",
  secondApplicantFirstName: "",
  secondApplicantMiddleName: "",
  secondApplicantSurname: "",
  secondApplicantDateOfBirth: "",
  secondApplicantGender: "",
  secondApplicantPermanentInAustralia: "Yes",
  secondApplicantDriversLicenceNo: "",
  secondApplicantLicenceCardNumber: "",
  secondApplicantLicenceExpiryDate: "",
  secondApplicantLicenceState: "",
  secondApplicantLicenceClass: "C",
  secondApplicantMobile: "",
  secondApplicantEmail: "",
  secondApplicantAddress: "",
  secondApplicantResidencyStatus: "Australian citizen",
  secondApplicantMaritalStatus: "Single",
  secondApplicantDependants: "0",
  secondApplicantEmployerName: "",
  secondApplicantJobTitle: "",
  mobile: "",
  email: "",
  preferredLanguage: "Vietnamese / English",
  sourceChannel: "",
  bestTimeToContact: "",
  loanCategory: "Residential Home Loan",
  loanAction: "Purchase",
  occupancy: "Owner occupied",
  scenarioTags: [],
  borrowerType: "Individual",
  securityType: "Residential property",
  depositOrEquity: "",
  existingLoanBalance: "",
  loanUseDescription: "",
  settlementDate: "",
  commercialAction: "Purchase",
  businessPurpose: "Working capital",
  assetType: "Car",
  assetCondition: "Used",
  sellerType: "Dealer",
  businessUsePercent: "",
  privatePurpose: "Private mortgage",
  propertyAddress: "",
  estimatedValue: "",
  rentalLeaseIncome: "",
  leaseRemainingTerm: "",
  businessName: "",
  abnAcn: "",
  tradingHistory: "",
  monthlyTurnover: "",
  gstRegistered: "No",
  purposeOfFunds: "",
  existingBusinessDebts: "",
  exitStrategy: "",
  urgency: "",
  loanType: "Home loan",
  loanPurpose: "Purchase owner occupied dwelling",
  loanAmount: "",
  propertyValue: "",
  depositEquity: "",
  propertyLocation: "",
  timeline: "",
  dateOfBirth: "",
  gender: "",
  permanentInAustralia: "Yes",
  driversLicenceNo: "",
  licenceCardNumber: "",
  licenceExpiryDate: "",
  licenceState: "",
  licenceClass: "C",
  address: "",
  residencyStatus: "Australian citizen",
  maritalStatus: "Single",
  dependants: "0",
  currentSuburb: "",
  currentState: "",
  currentPostcode: "",
  currentAddressFromDate: "",
  currentResidentialStatus: "",
  postSettlementAddress: "",
  mailingAddress: "",
  employmentType: "PAYG",
  employerName: "",
  occupation: "",
  annualIncome: "",
  secondAnnualIncome: "",
  rentalIncomeAnnual: "",
  existingDebtsSummary: "",
  creditIssue: "Unknown",
  loanTermYears: "30",
  repaymentType: "Principal and interest",
  ratePreference: "Variable",
  offsetRequested: true,
  hemMonthly: "",
  financialAssetBuffer: "30000",
  quickNotes: "",
  brokerAssessment: "",
  nextAction: ""
};

const redFlagOptions = [
  "Low deposit",
  "LMI likely",
  "Self-employed",
  "Visa/residency",
  "Credit issue",
  "Urgent settlement",
  "Complex structure",
  "Commercial",
  "Low doc"
];

const loanCategoryOptions = [
  "Residential Home Loan",
  "Commercial Property Loan",
  "Business Finance",
  "Asset / Car / Equipment Finance",
  "Personal Loan",
  "Private Lending / Specialist Lending",
  "Not Sure / Need Broker Advice"
];

const residentialLoanActionOptions = [
  "Purchase",
  "Refinance",
  "Pre-approval",
  "Construction",
  "Cash out / equity release",
  "Debt consolidation"
];

const occupancyOptions = ["Owner occupied", "Investment"];
const borrowerTypeOptions = ["Individual", "Company", "Trust", "SMSF", "Sole trader", "Partnership"];
const securityTypeOptions = ["Residential property", "Commercial property", "Business asset", "Vehicle/equipment", "No security yet"];
const commercialActionOptions = [
  "Purchase",
  "Refinance",
  "Cash out / equity release",
  "Lease doc",
  "SMSF commercial",
  "Owner occupied business premises",
  "Commercial investment",
  "Development / construction",
  "Other"
];
const assetActionOptions = ["Purchase", "Refinance", "Upgrade / replacement", "Other"];
const privatePurposeOptions = ["Private mortgage", "Bridging", "Urgent settlement", "Credit impaired", "Low doc", "Other"];
const scenarioTagOptions = [
  "First home buyer",
  "Low deposit",
  "LMI likely",
  "Guarantor",
  "Self-employed",
  "Visa/residency",
  "Credit issue",
  "Urgent settlement",
  "Complex structure",
  "Commercial",
  "Low doc"
];

const homeLoanPurposeOptions = [
  "Purchase owner occupied dwelling",
  "Purchase investment property",
  "Pre-approval - owner occupied",
  "Pre-approval - investment",
  "Refinance existing home loan",
  "Refinance and cash out",
  "Construction",
  "Other purpose"
];
const commercialPurposeOptions = ["Commercial property purchase", "Commercial refinance", "Commercial cash out", "Business/commercial lending", "Asset finance", "Other purpose"];
const businessPurposeOptions = ["Working capital", "Business expansion", "Equipment purchase", "Cash flow support", "Tax debt", "Other purpose"];
const carPurposeOptions = ["Car loan - purchase", "Car loan - refinance", "Business vehicle", "Other purpose"];
const personalPurposeOptions = ["Personal loan - debt consolidation", "Personal loan - home improvement", "Personal loan - travel", "Personal loan - other"];
const loanScenarioOptions = [
  "Owner occupied purchase",
  "First home buyer",
  "Investment purchase",
  "Refinance owner occupied",
  "Refinance investment",
  "Pre-approval owner occupied",
  "Pre-approval investment",
  "Construction",
  "Debt consolidation",
  "Cash out",
  "Commercial property",
  "Business loan",
  "Car loan",
  "Personal loan",
  "Other"
];

function deriveLoanScenario(loanType = "", loanPurpose = "") {
  const text = `${loanType} ${loanPurpose}`.toLowerCase();
  if (/first home|fhb/.test(text)) return "First home buyer";
  if (/pre-approval|pre approval/.test(text) && /invest/.test(text)) return "Pre-approval investment";
  if (/pre-approval|pre approval/.test(text)) return "Pre-approval owner occupied";
  if (/refinance/.test(text) && /cash|equity|top.?up/.test(text)) return "Cash out";
  if (/cash/.test(text)) return "Cash out";
  if (/refinance/.test(text) && /invest/.test(text)) return "Refinance investment";
  if (/refinance/.test(text)) return "Refinance owner occupied";
  if (/construction/.test(text)) return "Construction";
  if (/debt/.test(text)) return "Debt consolidation";
  if (/commercial/.test(text)) return "Commercial property";
  if (/business/.test(text)) return "Business loan";
  if (/car|vehicle/.test(text)) return "Car loan";
  if (/personal/.test(text)) return "Personal loan";
  if (/invest/.test(text)) return "Investment purchase";
  if (/owner|occupied|home loan/.test(text)) return "Owner occupied purchase";
  return "";
}

function ensureArray(value) {
  if (Array.isArray(value)) return value.filter(Boolean);
  if (typeof value === "string") return value.split(",").map((item) => item.trim()).filter(Boolean);
  return [];
}

function defaultLoanActionForCategory(category) {
  if (category === "Residential Home Loan") return "Purchase";
  if (category === "Commercial Property Loan") return "Purchase";
  if (category === "Business Finance") return "Working capital";
  if (category === "Asset / Car / Equipment Finance") return "Purchase";
  if (category === "Personal Loan") return "Debt consolidation";
  if (category === "Private Lending / Specialist Lending") return "Private mortgage";
  return "Broker advice";
}

function actionOptionsForCategory(category) {
  if (category === "Residential Home Loan") return residentialLoanActionOptions;
  if (category === "Commercial Property Loan") return commercialActionOptions;
  if (category === "Business Finance") return businessPurposeOptions;
  if (category === "Asset / Car / Equipment Finance") return assetActionOptions;
  if (category === "Personal Loan") return personalPurposeOptions;
  if (category === "Private Lending / Specialist Lending") return privatePurposeOptions;
  return ["Broker advice"];
}

function inferCanonicalLoan(values = {}) {
  const legacyText = [
    values.loanCategory,
    values.loanAction,
    values.occupancy,
    values.loanType,
    values.loanPurpose,
    values.loanScenario,
    values.loanUseDescription
  ].join(" ").toLowerCase();
  let loanCategory = values.loanCategory || "";
  if (!loanCategory) {
    if (/commercial/.test(legacyText)) loanCategory = "Commercial Property Loan";
    else if (/business|working capital|cash flow|tax debt/.test(legacyText)) loanCategory = "Business Finance";
    else if (/car|vehicle|asset|equipment/.test(legacyText)) loanCategory = "Asset / Car / Equipment Finance";
    else if (/private|bridging|specialist/.test(legacyText)) loanCategory = "Private Lending / Specialist Lending";
    else if (/personal/.test(legacyText)) loanCategory = "Personal Loan";
    else loanCategory = "Residential Home Loan";
  }

  let loanAction = values.loanAction || "";
  if (!loanAction) {
    if (/pre-approval|pre approval/.test(legacyText)) loanAction = "Pre-approval";
    else if (/refinance/.test(legacyText)) loanAction = "Refinance";
    else if (/cash|equity|top.?up/.test(legacyText)) loanAction = "Cash out / equity release";
    else if (/debt/.test(legacyText)) loanAction = "Debt consolidation";
    else if (/construction|renovat/.test(legacyText)) loanAction = "Construction";
    else if (/purchase|buy/.test(legacyText)) loanAction = "Purchase";
    else loanAction = defaultLoanActionForCategory(loanCategory);
  }

  let occupancy = values.occupancy || "";
  if (!occupancy) occupancy = /invest|rental/.test(legacyText) ? "Investment" : "Owner occupied";

  return { loanCategory, loanAction, occupancy };
}

function mapCanonicalLoan(values = {}) {
  const inferred = inferCanonicalLoan(values);
  const category = inferred.loanCategory;
  const action = inferred.loanAction;
  const occupancy = inferred.occupancy;
  let loanType = values.loanType || "";
  let loanPurpose = values.loanPurpose || "";
  let loanScenario = values.loanScenario || "";

  if (category === "Residential Home Loan") {
    if (action === "Purchase") {
      loanType = "Home loan";
      loanPurpose = occupancy === "Investment" ? "Purchase investment property" : "Purchase owner occupied dwelling";
      loanScenario = occupancy === "Investment" ? "Investment purchase" : "Owner occupied purchase";
    } else if (action === "Pre-approval") {
      loanType = "Home loan";
      loanPurpose = occupancy === "Investment" ? "Pre-approval - investment" : "Pre-approval - owner occupied";
      loanScenario = occupancy === "Investment" ? "Pre-approval investment" : "Pre-approval owner occupied";
    } else if (action === "Refinance") {
      loanType = "Refinance";
      loanPurpose = "Refinance existing home loan";
      loanScenario = occupancy === "Investment" ? "Refinance investment" : "Refinance owner occupied";
    } else if (action === "Cash out / equity release") {
      loanType = "Refinance";
      loanPurpose = "Refinance and cash out";
      loanScenario = "Cash out";
    } else if (action === "Debt consolidation") {
      loanType = "Refinance";
      loanPurpose = "Personal loan - debt consolidation";
      loanScenario = "Debt consolidation";
    } else if (action === "Construction") {
      loanType = "Home loan";
      loanPurpose = "Construction";
      loanScenario = "Construction";
    }
  } else if (category === "Commercial Property Loan") {
    loanType = "Commercial loan";
    loanPurpose = action === "Refinance" ? "Commercial refinance" : action === "Cash out / equity release" ? "Commercial cash out" : "Commercial property purchase";
    loanScenario = "Commercial property";
  } else if (category === "Business Finance") {
    loanType = "Business loan";
    loanPurpose = action || "Working capital";
    loanScenario = "Business loan";
  } else if (category === "Asset / Car / Equipment Finance") {
    loanType = /car|vehicle/i.test(values.assetType || "") ? "Car loan" : "Business loan";
    loanPurpose = /car|vehicle/i.test(values.assetType || "") ? "Car loan - purchase" : "Equipment purchase";
    loanScenario = /car|vehicle/i.test(values.assetType || "") ? "Car loan" : "Business loan";
  } else if (category === "Personal Loan") {
    loanType = "Personal loan";
    loanPurpose = action || "Personal loan - other";
    loanScenario = action === "Debt consolidation" ? "Debt consolidation" : "Personal loan";
  } else if (category === "Private Lending / Specialist Lending") {
    loanType = "Private lending";
    loanPurpose = action || values.privatePurpose || "Other purpose";
    loanScenario = "Other";
  }

  loanScenario = loanScenario || deriveLoanScenario(loanType, loanPurpose) || values.loanScenario || "";
  return { ...inferred, loanType, loanPurpose, loanScenario };
}

function normalizeCallNote(values = {}) {
  const mapped = mapCanonicalLoan(values);
  const scenarioTags = ensureArray(values.scenarioTags);
  const depositOrEquity = values.depositOrEquity || values.depositEquity || "";
  const depositEquity = values.depositEquity || values.depositOrEquity || "";
  const estimatedValue = values.estimatedValue || values.propertyValue || "";
  const propertyValue = values.propertyValue || values.estimatedValue || "";
  return {
    ...values,
    ...mapped,
    scenarioTags,
    depositOrEquity,
    depositEquity,
    estimatedValue,
    propertyValue
  };
}

function dynamicMissingInfo(values = {}) {
  const normalized = normalizeCallNote(values);
  const missing = [];
  if (!composeLegalName(normalized.firstName, "", normalized.surname, normalized.clientName).trim()) missing.push("client name");
  if (!String(normalized.mobile || normalized.email || "").trim()) missing.push("mobile or email");
  if (!normalized.loanCategory) missing.push("loan category");
  if (normalized.loanCategory !== "Not Sure / Need Broker Advice" && !normalized.loanAction) missing.push("loan action");
  if (normalized.loanCategory === "Residential Home Loan" && !normalized.occupancy) missing.push("occupancy");
  if (["Residential Home Loan", "Commercial Property Loan", "Private Lending / Specialist Lending"].includes(normalized.loanCategory) && !String(normalized.propertyValue || normalized.estimatedValue || "").trim()) missing.push("property value");
  if (!String(normalized.loanAmount || "").trim()) missing.push("loan amount");
  return missing;
}

function callPathProfile(values = {}) {
  const normalized = normalizeCallNote(values);
  const category = normalized.loanCategory || "Residential Home Loan";
  const action = normalized.loanAction || "";
  const residential = category === "Residential Home Loan";
  const commercial = category === "Commercial Property Loan";
  const business = category === "Business Finance";
  const asset = category === "Asset / Car / Equipment Finance";
  const personal = category === "Personal Loan";
  const specialist = category === "Private Lending / Specialist Lending";
  const unsure = category === "Not Sure / Need Broker Advice";
  const refinanceLike = /refinance|cash out|debt consolidation/i.test(action);
  const purchaseLike = /purchase|pre-approval|construction|commercial investment|owner occupied business premises/i.test(action);
  const securedProperty = residential || commercial || specialist;
  return {
    residential,
    commercial,
    business,
    asset,
    personal,
    specialist,
    unsure,
    refinanceLike,
    purchaseLike,
    showOccupancy: residential,
    showLoanAmount: !unsure,
    showPropertyValue: securedProperty || refinanceLike,
    showDepositEquity: residential && (purchaseLike || refinanceLike),
    showExistingLoanBalance: refinanceLike || commercial,
    showPropertyLocation: residential || commercial || specialist,
    showTimeline: true,
    showUseOfFunds: !unsure,
    showScenarioTags: residential || commercial || specialist
  };
}

function composeLegalName(firstName, middleName, surname, fallback = "") {
  const name = [firstName, middleName, surname].map((part) => String(part || "").trim()).filter(Boolean).join(" ");
  return name || String(fallback || "").trim();
}

function splitNameFallback(fullName = "") {
  const parts = String(fullName || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return { firstName: "", middleName: "", surname: "" };
  if (parts.length === 1) return { firstName: parts[0], middleName: "", surname: "" };
  return { firstName: parts.slice(0, -1).join(" "), middleName: "", surname: parts.at(-1) };
}

function hydrateNameParts(values = {}) {
  const primaryFallback = values.firstName || values.surname ? {} : splitNameFallback(values.clientName);
  const secondaryFallback = values.secondApplicantFirstName || values.secondApplicantSurname
    ? {}
    : splitNameFallback(values.secondApplicantName);
  return {
    ...primaryFallback,
    ...secondaryFallback,
    ...values
  };
}

function searchKey(value = "") {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase();
}
const loanPurposeOptions = [...homeLoanPurposeOptions, ...commercialPurposeOptions, ...businessPurposeOptions, ...carPurposeOptions, ...personalPurposeOptions]
  .filter((value, index, arr) => arr.indexOf(value) === index);
const loanTypeOptions = ["Home loan", "Refinance", "Commercial loan", "Business loan", "Car loan", "Personal loan"];
const publicLoanEntries = {
  start: { type: "", title: "Loan Application", viTitle: "Thông tin vay", purpose: "" },
  "loan-form": { type: "", title: "Loan Application", viTitle: "Thông tin vay", purpose: "" },
  "client-info": { type: "", title: "Loan Application", viTitle: "Thông tin vay", purpose: "" },
  apply: { type: "", title: "Loan Application", viTitle: "Thông tin vay", purpose: "" },
  "home-loan": { type: "Home loan", title: "Home Loan Application", viTitle: "Thông tin vay mua nhà", purpose: "Purchase owner occupied dwelling" },
  refinance: { type: "Refinance", title: "Refinance Application", viTitle: "Thông tin refinance", purpose: "Refinance existing home loan" },
  "commercial-loan": { type: "Commercial loan", title: "Commercial Loan Application", viTitle: "Thông tin vay commercial", purpose: "Commercial property purchase" },
  "business-loan": { type: "Business loan", title: "Business Loan Application", viTitle: "Thông tin vay business", purpose: "Working capital" },
  "car-loan": { type: "Car loan", title: "Car Loan Application", viTitle: "Thông tin vay mua xe", purpose: "Car loan - purchase" },
  "personal-loan": { type: "Personal loan", title: "Personal Loan Application", viTitle: "Thông tin vay cá nhân", purpose: "Personal loan - debt consolidation" }
};

const callLoanTypeOptions = ["Home loan", "Investment loan", "Refinance", "Commercial", "Personal loan", "Car loan"];
const callLoanPurposeOptions = [
  ...loanPurposeOptions,
  "Personal loan - debt consolidation",
  "Personal loan - other",
  "Car loan - purchase",
  "Car loan - refinance"
];

const defaultHemProfiles = {
  singleLow: { label: "Single - lean", amount: 3000, note: "Use only when living expenses are clearly modest and supported." },
  singleStandard: { label: "Single - standard", amount: 3450, note: "Good default for most single applicants before verified expenses." },
  singleHigher: { label: "Single - higher buffer", amount: 4000, note: "Use when lifestyle, rent, insurance or transport costs look higher." },
  coupleStandard: { label: "Couple - standard", amount: 4500, note: "Good default for two-adult households before verified expenses." },
  coupleHigher: { label: "Couple - higher buffer", amount: 5200, note: "Use when dependants, rent or higher discretionary spend are likely." }
};
const hemTemplateRows = [
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

function scaleTemplateRows(rows, total, adjustLabel = "Groceries") {
  const target = Number(total || 0);
  if (!target) return rows.map(([type]) => ({ type, amount: 0, frequency: "Monthly", ownership: "100%" }));
  const baseTotal = rows.reduce((sum, [, amount]) => sum + amount, 0) || 1;
  const scaled = rows.map(([type, amount]) => ({
    type,
    amount: Math.round(((amount / baseTotal) * target) / 50) * 50,
    frequency: "Monthly",
    ownership: "100%"
  }));
  const diff = target - scaled.reduce((sum, row) => sum + row.amount, 0);
  const adjustRow = scaled.find((row) => row.type === adjustLabel) || scaled[0];
  if (adjustRow) adjustRow.amount += diff;
  return scaled;
}

function hemBreakdown(total) {
  return scaleTemplateRows(hemTemplateRows, total);
}

function assetBreakdown(total) {
  const amount = Number(total || 0);
  if (!amount) return [];
  const rows = scaleTemplateRows([
    ["Deposit Account", 30000],
    ["Motor Vehicle", 20000],
    ["Home Contents", 10000]
  ], amount, "Deposit Account");
  return rows.map((row) => ({
    type: row.type,
    description: row.type === "Deposit Account" ? "Savings / financial asset buffer" : "Applicant estimate",
    value: row.amount,
    ownership: "100%",
    valueBasis: "Applicant Estimate"
  }));
}

const maritalStatusOptions = ["Single", "Married", "Divorced", "Widowed"];
const genderOptions = ["Female", "Male", "Other / prefer not to say"];
const licenceStateOptions = ["SA", "NSW", "VIC", "QLD", "WA", "TAS", "ACT", "NT"];
const residentialStatusOptions = ["Boarding", "Renting", "Own home with mortgage", "Own home without mortgage", "Living with parents"];
const residencyOptions = ["Australian Citizen", "Australian PR", "Australian TR", "NZ Citizen"];
const employmentTypeOptions = ["PAYG", "Self - employed", "Unemployed", "Retired"];
const employmentBasisOptions = ["Full-time", "Part-time", "Contract", "Temporary", "Internship"];
const yesNoOptions = ["Yes", "No"];
const yesNoAdviseOptions = ["Yes", "No", "Please advise"];
const insurancePolicyOptions = ["Yes", "No", "I would like to know more"];

const clientFormCopy = {
  en: {
    title: "Loan Form",
    intro: "Please complete this form with accurate, complete and up-to-date information so Easy Loan Finance can prepare your loan application properly.",
    secure: "Secure client information",
    receivedTitle: "Thank you. We have received your loan form.",
    receivedDescription: "Your information has been sent securely to Easy Loan Finance. A broker will review your details and contact you as soon as practical.",
    nextTitle: "What happens next",
    nextBody: "We will check the information you provided, match it with any call notes already on file, and let you know if anything else is needed before preparing lender or application documents.",
    disclaimer: "This confirmation means your form was received. It is not a loan approval or lender submission.",
    alreadySubmitted: "This form has already been submitted. You can submit again if you need to update details.",
    submit: "Submit to Easy Loan Finance",
    select: "Please Select",
    updating: "Submitting..."
  },
  vi: {
    title: "Thông tin vay",
    intro: "Vui lòng điền thông tin chính xác, đầy đủ và cập nhật để Easy Loan Finance chuẩn bị hồ sơ vay cho bạn.",
    secure: "Thông tin khách hàng bảo mật",
    receivedTitle: "Cảm ơn bạn. Easy Loan Finance đã nhận được form.",
    receivedDescription: "Thông tin đã được gửi bảo mật đến Easy Loan Finance. Broker sẽ kiểm tra và liên hệ bạn trong thời gian sớm nhất.",
    nextTitle: "Bước tiếp theo",
    nextBody: "Chúng tôi sẽ kiểm tra thông tin bạn cung cấp, đối chiếu với ghi chú cuộc gọi nếu đã có, và báo lại nếu cần thêm giấy tờ trước khi chuẩn bị hồ sơ cho ngân hàng.",
    disclaimer: "Xác nhận này nghĩa là form đã được nhận. Đây không phải là phê duyệt khoản vay hoặc hồ sơ đã nộp lên ngân hàng.",
    alreadySubmitted: "Form này đã được gửi trước đó. Bạn vẫn có thể gửi lại nếu muốn cập nhật thông tin.",
    submit: "Gửi cho Easy Loan Finance",
    select: "Vui lòng chọn",
    updating: "Đang gửi..."
  }
};

const labelVi = {
  "First / given name(s)": "Ten va ten dem theo giay to",
  "Middle name(s)": "Ten dem neu muon tach rieng",
  "Family name / surname": "Ho theo giay to",
  "Enter names exactly as shown on ID. Vietnamese accents are OK.": "Nhap ten dung nhu tren giay to. Co dau tieng Viet van duoc.",
  "Leave blank if no middle name.": "De trong neu khong co ten dem.",
  "Second applicant first / given name(s)": "Nguoi vay thu hai - ten va ten dem",
  "Second applicant middle name(s)": "Nguoi vay thu hai - ten dem",
  "Second applicant family name / surname": "Nguoi vay thu hai - ho",
  "Personal Details": "Thông tin cá nhân",
  "Full Name": "Họ và tên",
  "Second applicant": "Người vay thứ hai",
  "Date of birth": "Ngày sinh",
  "Email": "Email",
  "Mobile": "Số điện thoại",
  "Marital Status": "Tình trạng hôn nhân",
  "Residential Status": "Tình trạng cư trú",
  "Visa Sub-class": "Loại visa",
  "Number of Dependents": "Số người phụ thuộc",
  "DOB of Dependent 1": "Ngày sinh người phụ thuộc 1",
  "DOB of Dependent 2": "Ngày sinh người phụ thuộc 2",
  "DOB of Dependent 3": "Ngày sinh người phụ thuộc 3",
  "DOB of Dependent 4": "Ngày sinh người phụ thuộc 4",
  "date": "ngày tháng",
  "Leave blank if there is no second applicant.": "Để trống nếu không có người vay thứ hai.",
  "Leave blank if not applicable.": "Để trống nếu không áp dụng.",
  "Leave blank if unsure.": "Để trống nếu chưa chắc.",
  "Only enter previous address if current address is less than 2 years.": "Chỉ điền địa chỉ trước đây nếu bạn ở địa chỉ hiện tại chưa đủ 2 năm.",
  "Residential History Within The Last 2 Years": "Lịch sử địa chỉ trong 2 năm gần nhất",
  "Current residential address": "Địa chỉ hiện tại",
  "Suburb": "Suburb",
  "State": "Bang",
  "From Date": "Từ ngày",
  "Previous residential address": "Địa chỉ trước đây",
  "Previous suburb": "Suburb trước đây",
  "Previous state": "Bang trước đây",
  "Previous postal code": "Postcode trước đây",
  "Previous Residential Status": "Tình trạng nhà ở trước đây",
  "Employment History Within The Last 2 Years": "Lịch sử công việc trong 2 năm gần nhất",
  "Employment Type": "Loại công việc",
  "Business Name": "Tên công ty/doanh nghiệp",
  "Business Address": "Địa chỉ công ty/doanh nghiệp",
  "Job Title": "Chức danh",
  "Employment Basis": "Hình thức làm việc",
  "Contact Name": "Tên người liên hệ",
  "Contact Number": "Số điện thoại liên hệ",
  "Main income p.a.": "Thu nhập chính mỗi năm",
  "Second income p.a.": "Thu nhập người vay thứ hai mỗi năm",
  "Rental income p.a.": "Thu nhập cho thuê mỗi năm",
  "Previous Employment Type": "Loại công việc trước đây",
  "Previous Business Name": "Tên công ty trước đây",
  "Previous Job Title": "Chức danh trước đây",
  "Previous Employment Basis": "Hình thức làm việc trước đây",
  "Previous From Date": "Làm từ ngày",
  "Previous To Date": "Đến ngày",
  "Living Expenses": "Chi phí sinh hoạt",
  "Expenses": "Loại chi phí",
  "AP 1 - Amount ($)": "Người vay 1 - số tiền ($)",
  "AP 2 - Amount ($)": "Người vay 2 - số tiền ($)",
  "Private Health Insurance - Applicant 1": "Bảo hiểm sức khỏe tư nhân - người vay 1",
  "Applicant 1 Amount ($)/month": "Người vay 1 - số tiền/tháng",
  "Private Health Insurance - Applicant 2": "Bảo hiểm sức khỏe tư nhân - người vay 2",
  "Applicant 2 Amount ($)/month": "Người vay 2 - số tiền/tháng",
  "Income protection or life insurance policies": "Bảo hiểm thu nhập hoặc bảo hiểm nhân thọ",
  "Monthly living expense total": "Tổng chi phí sinh hoạt mỗi tháng",
  "Your Assets": "Tài sản",
  "Real Estate Address": "Địa chỉ bất động sản",
  "Real Estate Value ($)": "Giá trị bất động sản ($)",
  "Cash/Savings Amount ($)": "Tiền mặt/tiết kiệm ($)",
  "Banking with": "Ngân hàng đang dùng",
  "Car/Motor Vehicle Model/year": "Xe - model/năm",
  "Motor Vehicle Estimated value ($)": "Giá trị xe ước tính ($)",
  "Home contents item": "Tài sản trong nhà",
  "Home contents estimated value ($)": "Giá trị tài sản trong nhà ($)",
  "Savings/assets total": "Tổng tiết kiệm/tài sản",
  "Loan Details": "Thông tin khoản vay",
  "Your loan purpose": "Mục đích vay",
  "Type of property": "Loại bất động sản",
  "How much would you like to borrow ($)": "Số tiền muốn vay ($)",
  "Location (intended postcode OR address)": "Địa chỉ hoặc postcode dự định mua/vay",
  "Estimated property value ($)": "Giá trị bất động sản ước tính ($)",
  "Deposit/equity": "Tiền cọc/equity",
  "Are you first home buyer?": "Bạn có phải người mua nhà lần đầu không?",
  "Would you like fixed interest rate for a certain period?": "Bạn có muốn lãi suất cố định trong một thời gian không?",
  "Would you like interest rate to be variable?": "Bạn có muốn lãi suất thả nổi không?",
  "Would you like to consider a split home loan?": "Bạn có muốn cân nhắc vay split không?",
  "Loan term": "Thời hạn vay",
  "Timeline": "Thời gian dự kiến",
  "Credit issue": "Vấn đề tín dụng",
  "Existing debts / comments": "Các khoản nợ hiện tại / ghi chú",
  "Anything else for your broker": "Thông tin khác cho broker",
  "Commercial Details": "Thông tin commercial",
  "Commercial property use": "Mục đích sử dụng tài sản commercial",
  "Business trading name": "Tên doanh nghiệp giao dịch",
  "Business ABN/ACN": "ABN/ACN",
  "Business structure": "Cấu trúc doanh nghiệp",
  "Annual business turnover": "Doanh thu doanh nghiệp mỗi năm",
  "Net profit before tax": "Lợi nhuận trước thuế",
  "Commercial security address": "Địa chỉ tài sản bảo đảm commercial",
  "Lease/rental income": "Thu nhập thuê/lease",
  "Purpose of funds": "Mục đích sử dụng vốn"
};

const optionVi = {
  "Single": "Độc thân",
  "Married": "Đã kết hôn",
  "Divorced": "Ly hôn",
  "Widowed": "Góa",
  "Australian Citizen": "Công dân Úc",
  "Australian PR": "Thường trú nhân Úc",
  "Australian TR": "Visa tạm trú Úc",
  "NZ Citizen": "Công dân New Zealand",
  "Own home": "Nhà sở hữu",
  "Own home with mortgage": "Nhà sở hữu còn mortgage",
  "Renting": "Thuê nhà",
  "Boarding": "Ở cùng gia đình/người khác",
  "PAYG": "Làm công ăn lương",
  "Self - employed": "Tự kinh doanh",
  "Unemployed": "Thất nghiệp",
  "Retired": "Nghỉ hưu",
  "Full-time": "Toàn thời gian",
  "Part-time": "Bán thời gian",
  "Contract": "Hợp đồng",
  "Temporary": "Tạm thời",
  "Internship": "Thực tập",
  "Yes": "Có",
  "No": "Không",
  "Please advise": "Cần tư vấn",
  "I would like to know more": "Tôi muốn biết thêm",
  "Purchase owner occupied dwelling": "Mua nhà để ở",
  "Purchase investment property": "Mua bất động sản đầu tư",
  "Pre-approval - owner occupied": "Pre-approval mua nhà ở",
  "Pre-approval - investment": "Pre-approval mua đầu tư",
  "Refinance existing home loan": "Refinance khoản vay hiện tại",
  "Refinance and cash out": "Refinance và rút equity",
  "Construction": "Xây nhà",
  "Commercial property purchase": "Mua bất động sản commercial",
  "Commercial refinance": "Refinance commercial",
  "Business/commercial lending": "Vay doanh nghiệp/commercial",
  "Other purpose": "Mục đích khác"
};

function tx(label, language) {
  return language === "vi" ? labelVi[label] || label : label;
}

function optionText(option, language) {
  return language === "vi" ? optionVi[option] || option : option;
}

function getPublicLoanEntry(pathname) {
  const clean = pathname.replace(/^\/infinity-aol\/?/, "/").replace(/^\/+|\/+$/g, "");
  const [first, second] = clean.split("/");
  if (publicLoanEntries[first]) return publicLoanEntries[first];
  if (["loan-form", "client-info", "apply"].includes(first) && !second) return publicLoanEntries[first];
  return null;
}

function purposeOptionsForLoanType(loanType) {
  if (loanType === "Commercial loan") return commercialPurposeOptions;
  if (loanType === "Business loan") return businessPurposeOptions;
  if (loanType === "Car loan") return carPurposeOptions;
  if (loanType === "Personal loan") return personalPurposeOptions;
  if (loanType === "Refinance") return ["Refinance existing home loan", "Refinance and cash out", "Other purpose"];
  return homeLoanPurposeOptions;
}

function RequiredMark({ show }) {
  return show ? <span className="required-mark" aria-hidden="true">*</span> : null;
}

function FieldError({ message }) {
  return message ? <span className="field-error-message">{message}</span> : null;
}

function SelectField({ label, value, onChange, options, language = "en", required = false, help = "", fieldKey = "", missing = false, errorMessage = "" }) {
  return (
    <label
      data-loan-field={fieldKey || undefined}
      data-required={required ? "true" : undefined}
      data-missing={missing ? "true" : undefined}
    >
      <span className="field-label-text">{tx(label, language)} <RequiredMark show={required} /></span>
      <select required={required} value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="">{clientFormCopy[language].select}</option>
        {options.map((option) => <option key={option} value={option}>{optionText(option, language)}</option>)}
      </select>
      <FieldError message={missing ? errorMessage : ""} />
      {help ? <span className="field-help">{tx(help, language)}</span> : null}
    </label>
  );
}

function auDateValue(value = "") {
  const raw = String(value || "").trim();
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return `${iso[3]}-${iso[2]}-${iso[1]}`;
  const slash = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (slash) return `${slash[1].padStart(2, "0")}-${slash[2].padStart(2, "0")}-${slash[3]}`;
  return raw.replace(/\//g, "-");
}

function cleanAuDateInput(value = "") {
  return String(value || "").replace(/[^\d/-]/g, "").replace(/\//g, "-").slice(0, 10);
}

function isFilled(value) {
  if (typeof value === "boolean") return true;
  return value !== undefined && value !== null && String(value).trim() !== "";
}

function DateField({ label, value, onChange, language = "en", required = false, help = "", fieldKey = "", missing = false, errorMessage = "" }) {
  return (
    <label
      data-loan-field={fieldKey || undefined}
      data-required={required ? "true" : undefined}
      data-missing={missing ? "true" : undefined}
    >
      <span className="field-label-text">{tx(label, language)} <RequiredMark show={required} /> <span className="field-label-note">(DD-MM-YYYY)</span></span>
      <input
        required={required}
        inputMode="numeric"
        placeholder="DD-MM-YYYY"
        value={auDateValue(value)}
        onChange={(event) => onChange(cleanAuDateInput(event.target.value))}
      />
      <FieldError message={missing ? errorMessage : ""} />
      {help ? <span className="field-help">{tx(help, language)}</span> : <span className="field-help">DD-MM-YYYY</span>}
    </label>
  );
}

const loanTypeKeys = {
  "Home loan": "homeLoan",
  "Refinance": "refinance",
  "Commercial loan": "commercialLoan",
  "Business loan": "businessLoan",
  "Car loan": "carLoan",
  "Personal loan": "personalLoan"
};

function currentLoanTypeKey(loanType = "") {
  return loanTypeKeys[loanType] || "homeLoan";
}

function loanScenarioKey(formOrType = {}, maybePurpose = "", maybeScenario = "") {
  const input = typeof formOrType === "object" && formOrType !== null
    ? formOrType
    : { loanType: formOrType, loanPurpose: maybePurpose, loanScenario: maybeScenario };
  const text = `${input.loanType || ""} ${input.loanPurpose || ""} ${input.loanScenario || ""}`.toLowerCase();
  if (/commercial/.test(text)) return "commercial";
  if (/business/.test(text)) return "business";
  if (/car|vehicle/.test(text)) return "car";
  if (/personal/.test(text)) return "personal";
  if (/refinance/.test(text) && /cash|cash.?out|equity|top.?up/.test(text)) return "refinanceCashOut";
  if (/cash.?out/.test(text)) return "refinanceCashOut";
  if (/refinance/.test(text)) return /invest/.test(text) ? "refinanceInvestment" : "refinanceOoc";
  if (/construction/.test(text)) return "construction";
  if (/vacant land/.test(text)) return "vacantLand";
  if (/pre-approval|pre approval/.test(text)) return /invest/.test(text) ? "preApprovalInvestment" : "preApprovalOoc";
  if (/invest/.test(text)) return "investmentPurchase";
  return "oocPurchase";
}

function dynamicLoanTypeKeyForScenario(form) {
  const scenario = loanScenarioKey(form);
  if (scenario === "commercial") return "commercialLoan";
  if (scenario === "business") return "businessLoan";
  if (scenario === "car") return "carLoan";
  if (scenario === "personal") return "personalLoan";
  if (scenario === "refinanceCashOut" || scenario === "refinanceInvestment" || scenario === "refinanceOoc") return "refinance";
  return "homeLoan";
}

function scenarioUiProfile(form) {
  const scenario = loanScenarioKey(form);
  const purchase = ["oocPurchase", "investmentPurchase", "preApprovalOoc", "preApprovalInvestment", "construction", "vacantLand"].includes(scenario);
  const refinance = ["refinanceCashOut", "refinanceInvestment", "refinanceOoc"].includes(scenario);
  const propertyRelated = purchase || refinance || scenario === "commercial";
  return {
    scenario,
    purchase,
    refinance,
    cashOut: scenario === "refinanceCashOut",
    propertyRelated,
    showPropertyType: propertyRelated && scenario !== "business" && scenario !== "personal" && scenario !== "car",
    showPropertyLocation: propertyRelated,
    showPropertyValue: propertyRelated,
    showDepositEquity: purchase || refinance,
    showFirstHomeBuyer: purchase && !/invest/i.test(`${form.loanPurpose || ""} ${form.loanScenario || ""}`),
    showFeaturePrefs: propertyRelated || scenario === "commercial",
    showTimeline: true,
    showCreditIssue: true
  };
}

const dynamicLoanFieldCatalog = [
  {
    section: "Home loan details",
    key: "propertyFoundStatus",
    label_en: "Have you found a property?",
    label_vi: "Bạn đã tìm được bất động sản chưa?",
    type: "select",
    options: ["Yes", "No", "Pre-approval only"],
    required: true,
    loanTypes: ["homeLoan"],
    infinityField: "loan.propertyFoundStatus",
    aolField: "loans.security.propertyFoundStatus",
    helpText_en: "Select pre-approval only if there is no property address yet.",
    helpText_vi: "Chọn pre-approval nếu chưa có địa chỉ bất động sản."
  },
  {
    section: "Home loan details",
    key: "purchasePrice",
    label_en: "Purchase price",
    label_vi: "Giá mua",
    type: "money",
    required: (form) => form.propertyFoundStatus === "Yes",
    loanTypes: ["homeLoan"],
    infinityField: "loan.purchasePrice",
    aolField: "loans.purchasePrice",
    helpText_en: "Leave blank if you are still looking.",
    helpText_vi: "Để trống nếu vẫn đang tìm nhà."
  },
  {
    section: "Home loan details",
    key: "sourceOfDeposit",
    label_en: "Source of deposit",
    label_vi: "Nguồn tiền deposit",
    type: "text",
    required: true,
    loanTypes: ["homeLoan"],
    infinityField: "loan.depositSource",
    aolField: "loans.deposit.source",
    helpText_en: "For example savings, equity, gift, sale of asset.",
    helpText_vi: "Ví dụ tiền tiết kiệm, equity, quà tặng, bán tài sản."
  },
  {
    section: "Home loan details",
    key: "contractStatus",
    label_en: "Contract status",
    label_vi: "Tình trạng hợp đồng mua",
    type: "select",
    options: ["Not signed", "Signed", "Auction", "Off the plan", "Construction"],
    required: true,
    loanTypes: ["homeLoan"],
    infinityField: "loan.contractStatus",
    aolField: "loans.contractStatus"
  },
  {
    section: "Home loan details",
    key: "auctionDate",
    label_en: "Auction date",
    label_vi: "Ngày đấu giá",
    type: "date",
    required: (form) => form.contractStatus === "Auction",
    loanTypes: ["homeLoan"],
    conditionalDisplay: (form) => form.contractStatus === "Auction",
    infinityField: "loan.auctionDate",
    aolField: "loans.auctionDate"
  },
  {
    section: "Home loan details",
    key: "settlementDate",
    label_en: "Settlement date",
    label_vi: "Ngày settlement",
    type: "date",
    required: (form) => form.propertyFoundStatus === "Yes",
    loanTypes: ["homeLoan", "refinance"],
    infinityField: "loan.settlementDate",
    aolField: "loans.estimatedSettlementDate"
  },
  {
    section: "Home loan details",
    key: "financeClauseDate",
    label_en: "Finance clause date",
    label_vi: "Ngày finance clause",
    type: "date",
    required: false,
    loanTypes: ["homeLoan"],
    infinityField: "loan.financeClauseDate",
    aolField: "loans.financeClauseDate",
    helpText_en: "Leave blank if not applicable.",
    helpText_vi: "Để trống nếu không áp dụng."
  },
  {
    section: "Home loan details",
    key: "propertyUsage",
    label_en: "Property use",
    label_vi: "Mục đích sử dụng bất động sản",
    type: "select",
    options: ["Owner occupied", "Investment"],
    required: true,
    loanTypes: ["homeLoan", "refinance", "commercialLoan"],
    infinityField: "loan.propertyUsage",
    aolField: "securities.propertyPrimaryPurpose"
  },
  {
    section: "Home loan details",
    key: "fhogEligible",
    label_en: "First Home Owner Grant",
    label_vi: "First Home Owner Grant",
    type: "select",
    options: ["Yes", "No", "Unsure"],
    required: (form) => form.firstHomeBuyer === "Yes",
    loanTypes: ["homeLoan"],
    conditionalDisplay: (form) => form.firstHomeBuyer === "Yes",
    infinityField: "loan.fhogEligible",
    aolField: "loans.firstHomeOwnerGrant"
  },
  {
    section: "Home loan details",
    key: "constructionDetails",
    label_en: "Construction details",
    label_vi: "Thông tin xây dựng",
    type: "textarea",
    required: (form) => /construction/i.test(`${form.loanPurpose} ${form.contractStatus}`),
    loanTypes: ["homeLoan"],
    conditionalDisplay: (form) => /construction/i.test(`${form.loanPurpose} ${form.contractStatus}`),
    infinityField: "loan.constructionDetails",
    aolField: "loans.construction.details"
  },
  {
    section: "Refinance details",
    key: "currentLender",
    label_en: "Current lender",
    label_vi: "Ngân hàng hiện tại",
    type: "text",
    required: true,
    loanTypes: ["refinance"],
    infinityField: "liabilities.currentLender",
    aolField: "financials.liabilities.creditor"
  },
  {
    section: "Refinance details",
    key: "currentLoanBalance",
    label_en: "Current loan balance",
    label_vi: "Dư nợ hiện tại",
    type: "money",
    required: true,
    loanTypes: ["refinance"],
    infinityField: "liabilities.currentBalance",
    aolField: "financials.liabilities.balance"
  },
  {
    section: "Refinance details",
    key: "currentInterestRate",
    label_en: "Current interest rate",
    label_vi: "Lãi suất hiện tại",
    type: "text",
    required: true,
    loanTypes: ["refinance"],
    infinityField: "liabilities.interestRate",
    aolField: "financials.liabilities.interestRate"
  },
  {
    section: "Refinance details",
    key: "currentRepayment",
    label_en: "Monthly repayment",
    label_vi: "Trả nợ hàng tháng",
    type: "money",
    required: true,
    loanTypes: ["refinance"],
    infinityField: "liabilities.monthlyRepayment",
    aolField: "financials.liabilities.monthlyRepayment"
  },
  {
    section: "Refinance details",
    key: "currentLoanRepaymentType",
    label_en: "Current repayment type",
    label_vi: "Kiểu trả nợ hiện tại",
    type: "select",
    options: ["Principal and interest", "Interest only"],
    required: true,
    loanTypes: ["refinance"],
    infinityField: "liabilities.repaymentType",
    aolField: "loans.repaymentType"
  },
  {
    section: "Refinance details",
    key: "currentRateType",
    label_en: "Current rate type",
    label_vi: "Loại lãi suất hiện tại",
    type: "select",
    options: ["Variable", "Fixed", "Split"],
    required: true,
    loanTypes: ["refinance"],
    infinityField: "liabilities.rateType",
    aolField: "loans.rateType"
  },
  {
    section: "Refinance details",
    key: "fixedExpiryDate",
    label_en: "Fixed expiry date",
    label_vi: "Ngày hết fixed rate",
    type: "date",
    required: (form) => form.currentRateType === "Fixed",
    conditionalDisplay: (form) => form.currentRateType === "Fixed",
    loanTypes: ["refinance"],
    infinityField: "liabilities.fixedExpiryDate",
    aolField: "loans.fixedExpiryDate"
  },
  {
    section: "Refinance details",
    key: "offsetRedrawBalance",
    label_en: "Offset/redraw balance",
    label_vi: "Số dư offset/redraw",
    type: "money",
    required: false,
    loanTypes: ["refinance"],
    infinityField: "liabilities.offsetRedrawBalance",
    aolField: "loans.offsetRedrawBalance",
    helpText_en: "Leave blank if not applicable.",
    helpText_vi: "Để trống nếu không áp dụng."
  },
  {
    section: "Refinance details",
    key: "propertyEstimatedValue",
    label_en: "Estimated property value",
    label_vi: "Giá trị nhà ước tính",
    type: "money",
    required: true,
    loanTypes: ["refinance"],
    infinityField: "assets.propertyEstimatedValue",
    aolField: "securities.estimatedValue"
  },
  {
    section: "Refinance details",
    key: "cashOutAmount",
    label_en: "Cash out amount",
    label_vi: "Số tiền rút equity",
    type: "money",
    required: (form) => /cash/i.test(form.loanPurpose || ""),
    conditionalDisplay: (form) => loanScenarioKey(form) === "refinanceCashOut",
    loanTypes: ["refinance"],
    infinityField: "loan.cashOutAmount",
    aolField: "loans.cashOut.amount"
  },
  {
    section: "Refinance details",
    key: "cashOutPurpose",
    label_en: "Cash out purpose",
    label_vi: "Mục đích rút equity",
    type: "textarea",
    required: (form) => Number(form.cashOutAmount || 0) > 0 || /cash/i.test(form.loanPurpose || ""),
    conditionalDisplay: (form) => loanScenarioKey(form) === "refinanceCashOut" || /cash/i.test(form.loanPurpose || ""),
    loanTypes: ["refinance", "commercialLoan"],
    infinityField: "loan.cashOutPurpose",
    aolField: "loans.cashOut.purpose"
  },
  {
    section: "Refinance details",
    key: "debtConsolidationDebts",
    label_en: "Debt consolidation debts",
    label_vi: "Các khoản nợ muốn gom",
    type: "textarea",
    required: (form) => /debt/i.test(`${form.loanPurpose} ${form.personalLoanPurpose || ""}`),
    loanTypes: ["refinance", "personalLoan"],
    infinityField: "loan.debtConsolidationDebts",
    aolField: "loans.debtConsolidation.details"
  },
  {
    section: "Refinance details",
    key: "payoutDetails",
    label_en: "Payout details",
    label_vi: "Thông tin payout",
    type: "textarea",
    required: false,
    loanTypes: ["refinance", "carLoan"],
    infinityField: "loan.payoutDetails",
    aolField: "loans.payoutDetails"
  },
  {
    section: "Refinance details",
    key: "arrearsHistory",
    label_en: "Any missed repayments or arrears?",
    label_vi: "Có trễ hạn hoặc arrears không?",
    type: "select",
    options: ["No", "Yes", "Unsure"],
    required: true,
    loanTypes: ["refinance"],
    infinityField: "compliance.arrearsHistory",
    aolField: "compliance.arrearsHistory"
  },
  {
    section: "Commercial loan details",
    key: "borrowerEntity",
    label_en: "Borrower entity",
    label_vi: "Tên pháp nhân vay",
    type: "text",
    required: true,
    loanTypes: ["commercialLoan"],
    infinityField: "commercial.borrowerEntity",
    aolField: "applicants.entityName"
  },
  {
    section: "Commercial loan details",
    key: "abnAcn",
    label_en: "ABN / ACN",
    label_vi: "ABN / ACN",
    type: "text",
    required: true,
    loanTypes: ["commercialLoan", "businessLoan"],
    infinityField: "business.abnAcn",
    aolField: "applicants.abnAcn"
  },
  {
    section: "Commercial loan details",
    key: "companyTrustDirectorsGuarantors",
    label_en: "Company, trust, directors and guarantors",
    label_vi: "Công ty, trust, directors và guarantors",
    type: "textarea",
    required: true,
    loanTypes: ["commercialLoan"],
    infinityField: "commercial.entityStructure",
    aolField: "applicants.entityStructure"
  },
  {
    section: "Commercial loan details",
    key: "commercialPropertyAddress",
    label_en: "Commercial property address",
    label_vi: "Địa chỉ bất động sản commercial",
    type: "text",
    required: true,
    loanTypes: ["commercialLoan"],
    infinityField: "commercial.propertyAddress",
    aolField: "securities.address"
  },
  {
    section: "Commercial loan details",
    key: "commercialPropertyType",
    label_en: "Commercial property type",
    label_vi: "Loại tài sản commercial",
    type: "select",
    options: ["Office", "Retail", "Industrial", "Warehouse", "Mixed use", "Other"],
    required: true,
    loanTypes: ["commercialLoan"],
    infinityField: "commercial.propertyType",
    aolField: "securities.propertyType"
  },
  {
    section: "Commercial loan details",
    key: "commercialPurchasePrice",
    label_en: "Commercial value / purchase price",
    label_vi: "Giá trị / giá mua commercial",
    type: "money",
    required: true,
    loanTypes: ["commercialLoan"],
    infinityField: "commercial.purchasePrice",
    aolField: "securities.estimatedValue"
  },
  {
    section: "Commercial loan details",
    key: "commercialZoning",
    label_en: "Zoning",
    label_vi: "Zoning",
    type: "text",
    required: false,
    loanTypes: ["commercialLoan"],
    infinityField: "commercial.zoning",
    aolField: "securities.zoning"
  },
  {
    section: "Commercial loan details",
    key: "commercialOccupancy",
    label_en: "Owner occupied or investment",
    label_vi: "Owner occupied hay investment",
    type: "select",
    options: ["Owner occupied", "Investment", "Mixed use"],
    required: true,
    loanTypes: ["commercialLoan"],
    infinityField: "commercial.occupancy",
    aolField: "securities.propertyPrimaryPurpose"
  },
  {
    section: "Commercial loan details",
    key: "commercialLeaseDetails",
    label_en: "Lease details",
    label_vi: "Thông tin lease",
    type: "textarea",
    required: (form) => /investment|mixed/i.test(form.commercialOccupancy || ""),
    loanTypes: ["commercialLoan"],
    infinityField: "commercial.leaseDetails",
    aolField: "securities.leaseDetails"
  },
  {
    section: "Commercial loan details",
    key: "commercialAnnualRent",
    label_en: "Annual rent",
    label_vi: "Tiền thuê hàng năm",
    type: "money",
    required: (form) => /investment|mixed/i.test(form.commercialOccupancy || ""),
    loanTypes: ["commercialLoan"],
    infinityField: "commercial.annualRent",
    aolField: "income.annualRent"
  },
  {
    section: "Commercial loan details",
    key: "commercialTenantDetails",
    label_en: "Tenant details",
    label_vi: "Thông tin tenant",
    type: "textarea",
    required: false,
    loanTypes: ["commercialLoan"],
    infinityField: "commercial.tenantDetails",
    aolField: "securities.tenantDetails"
  },
  {
    section: "Commercial loan details",
    key: "currentCommercialLoanDetails",
    label_en: "Current commercial loan details",
    label_vi: "Thông tin khoản vay commercial hiện tại",
    type: "textarea",
    required: (form) => /refinance/i.test(form.loanPurpose || ""),
    loanTypes: ["commercialLoan"],
    infinityField: "commercial.currentLoanDetails",
    aolField: "financials.liabilities.commercialLoan"
  },
  {
    section: "Commercial loan details",
    key: "commercialIncomeEvidence",
    label_en: "Income evidence available",
    label_vi: "Giấy tờ chứng minh thu nhập có sẵn",
    type: "select",
    options: ["Financials", "BAS", "Bank statements", "Lease income", "Accountant letter", "Not sure"],
    required: true,
    loanTypes: ["commercialLoan"],
    infinityField: "documents.incomeEvidence",
    aolField: "documents.incomeEvidence"
  },
  {
    section: "Commercial loan details",
    key: "commercialFinancialsAvailable",
    label_en: "Financials / BAS / bank statements available",
    label_vi: "Có financials / BAS / bank statements không?",
    type: "textarea",
    required: true,
    loanTypes: ["commercialLoan"],
    infinityField: "documents.financialsAvailable",
    aolField: "documents.financialsAvailable"
  },
  {
    section: "Business loan details",
    key: "businessLegalName",
    label_en: "Business legal name",
    label_vi: "Tên pháp lý doanh nghiệp",
    type: "text",
    required: true,
    loanTypes: ["businessLoan"],
    infinityField: "business.legalName",
    aolField: "applicants.businessLegalName"
  },
  {
    section: "Business loan details",
    key: "businessTradingName",
    label_en: "Trading name",
    label_vi: "Tên giao dịch",
    type: "text",
    required: true,
    loanTypes: ["businessLoan", "commercialLoan"],
    infinityField: "business.tradingName",
    aolField: "applicants.tradingName"
  },
  {
    section: "Business loan details",
    key: "entityType",
    label_en: "Entity type",
    label_vi: "Loại pháp nhân",
    type: "select",
    options: ["Sole trader", "Company", "Trust", "Partnership"],
    required: true,
    loanTypes: ["businessLoan"],
    infinityField: "business.entityType",
    aolField: "applicants.entityType"
  },
  {
    section: "Business loan details",
    key: "gstRegistered",
    label_en: "GST registered",
    label_vi: "Đã đăng ký GST",
    type: "select",
    options: ["Yes", "No"],
    required: true,
    loanTypes: ["businessLoan"],
    infinityField: "business.gstRegistered",
    aolField: "business.gstRegistered"
  },
  {
    section: "Business loan details",
    key: "abnStartDate",
    label_en: "ABN start date",
    label_vi: "Ngày bắt đầu ABN",
    type: "date",
    required: true,
    loanTypes: ["businessLoan"],
    infinityField: "business.abnStartDate",
    aolField: "business.abnStartDate"
  },
  {
    section: "Business loan details",
    key: "industry",
    label_en: "Industry",
    label_vi: "Ngành nghề",
    type: "text",
    required: true,
    loanTypes: ["businessLoan"],
    infinityField: "business.industry",
    aolField: "business.industry"
  },
  {
    section: "Business loan details",
    key: "businessAddress",
    label_en: "Business address",
    label_vi: "Địa chỉ doanh nghiệp",
    type: "text",
    required: true,
    loanTypes: ["businessLoan"],
    infinityField: "business.address",
    aolField: "business.address"
  },
  {
    section: "Business loan details",
    key: "businessOwnersDirectors",
    label_en: "Owners / directors",
    label_vi: "Chủ doanh nghiệp / directors",
    type: "textarea",
    required: true,
    loanTypes: ["businessLoan"],
    infinityField: "business.ownersDirectors",
    aolField: "business.ownersDirectors"
  },
  {
    section: "Business loan details",
    key: "businessLoanPurpose",
    label_en: "Business loan purpose",
    label_vi: "Mục đích vay business",
    type: "textarea",
    required: true,
    loanTypes: ["businessLoan"],
    infinityField: "loan.businessPurpose",
    aolField: "loans.businessPurpose"
  },
  {
    section: "Business loan details",
    key: "businessLoanAmount",
    label_en: "Business loan amount",
    label_vi: "Số tiền vay business",
    type: "money",
    required: true,
    loanTypes: ["businessLoan"],
    infinityField: "loan.amount",
    aolField: "loans.amount"
  },
  {
    section: "Business loan details",
    key: "businessLoanTerm",
    label_en: "Business loan term",
    label_vi: "Thời hạn vay business",
    type: "select",
    options: ["1 year", "2 years", "3 years", "5 years", "7 years", "Other"],
    required: true,
    loanTypes: ["businessLoan"],
    infinityField: "loan.term",
    aolField: "loans.term"
  },
  {
    section: "Business loan details",
    key: "businessSecurityType",
    label_en: "Secured or unsecured",
    label_vi: "Có tài sản bảo đảm hay không",
    type: "select",
    options: ["Secured", "Unsecured", "Unsure"],
    required: true,
    loanTypes: ["businessLoan", "personalLoan"],
    infinityField: "loan.securityType",
    aolField: "loans.securityType"
  },
  {
    section: "Business loan details",
    key: "monthlyTurnover",
    label_en: "Monthly revenue",
    label_vi: "Doanh thu hàng tháng",
    type: "money",
    required: true,
    loanTypes: ["businessLoan"],
    infinityField: "business.monthlyRevenue",
    aolField: "business.monthlyRevenue"
  },
  {
    section: "Business loan details",
    key: "annualBusinessTurnover",
    label_en: "Annual turnover",
    label_vi: "Doanh thu hàng năm",
    type: "money",
    required: true,
    loanTypes: ["businessLoan"],
    infinityField: "business.annualTurnover",
    aolField: "business.annualTurnover"
  },
  {
    section: "Business loan details",
    key: "netProfitBeforeTax",
    label_en: "Net profit",
    label_vi: "Lợi nhuận ròng",
    type: "money",
    required: true,
    loanTypes: ["businessLoan"],
    infinityField: "business.netProfit",
    aolField: "business.netProfit"
  },
  {
    section: "Business loan details",
    key: "existingBusinessDebts",
    label_en: "Existing business debts",
    label_vi: "Nợ doanh nghiệp hiện tại",
    type: "textarea",
    required: false,
    loanTypes: ["businessLoan"],
    infinityField: "business.existingDebts",
    aolField: "financials.businessDebts"
  },
  {
    section: "Business loan details",
    key: "atoDebtPaymentPlan",
    label_en: "ATO debt / payment plan",
    label_vi: "Nợ ATO / payment plan",
    type: "textarea",
    required: false,
    loanTypes: ["businessLoan"],
    infinityField: "business.atoDebt",
    aolField: "business.atoDebt"
  },
  {
    section: "Business loan details",
    key: "bankStatementsAvailable",
    label_en: "Bank statements available",
    label_vi: "Có bank statements không?",
    type: "select",
    options: ["Yes", "No", "Can provide"],
    required: true,
    loanTypes: ["businessLoan"],
    infinityField: "documents.bankStatements",
    aolField: "documents.bankStatements"
  },
  {
    section: "Business loan details",
    key: "basAvailable",
    label_en: "BAS available",
    label_vi: "Có BAS không?",
    type: "select",
    options: ["Yes", "No", "Can provide"],
    required: true,
    loanTypes: ["businessLoan"],
    infinityField: "documents.bas",
    aolField: "documents.bas"
  },
  {
    section: "Business loan details",
    key: "taxReturnsAvailable",
    label_en: "Tax returns available",
    label_vi: "Có tax returns không?",
    type: "select",
    options: ["Yes", "No", "Can provide"],
    required: true,
    loanTypes: ["businessLoan"],
    infinityField: "documents.taxReturns",
    aolField: "documents.taxReturns"
  },
  {
    section: "Business loan details",
    key: "equipmentQuoteInvoice",
    label_en: "Equipment quote / invoice",
    label_vi: "Quote / invoice thiết bị",
    type: "textarea",
    required: (form) => /equipment/i.test(`${form.loanPurpose} ${form.businessLoanPurpose}`),
    loanTypes: ["businessLoan"],
    infinityField: "documents.equipmentQuote",
    aolField: "documents.equipmentQuote"
  },
  {
    section: "Car loan details",
    key: "vehicleUse",
    label_en: "Personal or business use",
    label_vi: "Dùng cá nhân hay business",
    type: "select",
    options: ["Personal", "Business"],
    required: true,
    loanTypes: ["carLoan"],
    infinityField: "vehicle.use",
    aolField: "assets.vehicle.use"
  },
  {
    section: "Car loan details",
    key: "vehicleApplicantType",
    label_en: "Applicant type",
    label_vi: "Loại người vay",
    type: "select",
    options: ["Individual", "Company", "Sole trader", "Trust"],
    required: true,
    loanTypes: ["carLoan"],
    infinityField: "vehicle.applicantType",
    aolField: "applicants.type"
  },
  {
    section: "Car loan details",
    key: "vehicleCondition",
    label_en: "Vehicle condition",
    label_vi: "Tình trạng xe",
    type: "select",
    options: ["New", "Used"],
    required: true,
    loanTypes: ["carLoan"],
    infinityField: "vehicle.condition",
    aolField: "assets.vehicle.condition"
  },
  {
    section: "Car loan details",
    key: "vehicleMake",
    label_en: "Make",
    label_vi: "Hãng xe",
    type: "text",
    required: true,
    loanTypes: ["carLoan"],
    infinityField: "vehicle.make",
    aolField: "assets.vehicle.make"
  },
  {
    section: "Car loan details",
    key: "vehicleModel",
    label_en: "Model",
    label_vi: "Model",
    type: "text",
    required: true,
    loanTypes: ["carLoan"],
    infinityField: "vehicle.model",
    aolField: "assets.vehicle.model"
  },
  {
    section: "Car loan details",
    key: "vehicleYear",
    label_en: "Year",
    label_vi: "Năm xe",
    type: "number",
    required: true,
    loanTypes: ["carLoan"],
    infinityField: "vehicle.year",
    aolField: "assets.vehicle.year"
  },
  {
    section: "Car loan details",
    key: "vehicleVariant",
    label_en: "Variant",
    label_vi: "Phiên bản",
    type: "text",
    required: false,
    loanTypes: ["carLoan"],
    infinityField: "vehicle.variant",
    aolField: "assets.vehicle.variant"
  },
  {
    section: "Car loan details",
    key: "vehicleVin",
    label_en: "VIN",
    label_vi: "Số VIN",
    type: "text",
    required: false,
    loanTypes: ["carLoan"],
    infinityField: "vehicle.vin",
    aolField: "assets.vehicle.vin"
  },
  {
    section: "Car loan details",
    key: "vehicleRego",
    label_en: "Rego",
    label_vi: "Biển số",
    type: "text",
    required: false,
    loanTypes: ["carLoan"],
    infinityField: "vehicle.rego",
    aolField: "assets.vehicle.rego"
  },
  {
    section: "Car loan details",
    key: "vehicleOdometer",
    label_en: "Odometer",
    label_vi: "Số km đã đi",
    type: "number",
    required: false,
    loanTypes: ["carLoan"],
    infinityField: "vehicle.odometer",
    aolField: "assets.vehicle.odometer"
  },
  {
    section: "Car loan details",
    key: "vehiclePrice",
    label_en: "Purchase price",
    label_vi: "Giá mua xe",
    type: "money",
    required: true,
    loanTypes: ["carLoan"],
    infinityField: "vehicle.purchasePrice",
    aolField: "assets.vehicle.purchasePrice"
  },
  {
    section: "Car loan details",
    key: "tradeInDeposit",
    label_en: "Deposit / trade-in",
    label_vi: "Deposit / trade-in",
    type: "money",
    required: false,
    loanTypes: ["carLoan"],
    infinityField: "vehicle.deposit",
    aolField: "assets.vehicle.deposit"
  },
  {
    section: "Car loan details",
    key: "saleType",
    label_en: "Seller type",
    label_vi: "Người bán",
    type: "select",
    options: ["Dealer", "Private sale"],
    required: true,
    loanTypes: ["carLoan"],
    infinityField: "vehicle.sellerType",
    aolField: "assets.vehicle.sellerType"
  },
  {
    section: "Car loan details",
    key: "dealerInvoiceAvailable",
    label_en: "Dealer invoice available",
    label_vi: "Có invoice từ dealer không?",
    type: "select",
    options: ["Yes", "No", "Can provide"],
    required: (form) => form.saleType === "Dealer",
    conditionalDisplay: (form) => form.saleType === "Dealer",
    loanTypes: ["carLoan"],
    infinityField: "documents.dealerInvoice",
    aolField: "documents.dealerInvoice"
  },
  {
    section: "Car loan details",
    key: "privateSellerDetails",
    label_en: "Private seller details",
    label_vi: "Thông tin người bán private",
    type: "textarea",
    required: (form) => form.saleType === "Private sale",
    conditionalDisplay: (form) => form.saleType === "Private sale",
    loanTypes: ["carLoan"],
    infinityField: "vehicle.privateSeller",
    aolField: "assets.vehicle.privateSeller"
  },
  {
    section: "Car loan details",
    key: "balloonResidual",
    label_en: "Balloon / residual",
    label_vi: "Balloon / residual",
    type: "money",
    required: false,
    loanTypes: ["carLoan"],
    infinityField: "loan.balloonResidual",
    aolField: "loans.balloonResidual"
  },
  {
    section: "Car loan details",
    key: "insuranceStatus",
    label_en: "Insurance status",
    label_vi: "Tình trạng bảo hiểm",
    type: "select",
    options: ["Already arranged", "Will arrange", "Need help", "Unsure"],
    required: true,
    loanTypes: ["carLoan"],
    infinityField: "vehicle.insuranceStatus",
    aolField: "assets.vehicle.insuranceStatus"
  },
  {
    section: "Car loan details",
    key: "vehicleRefinancePayout",
    label_en: "Refinance payout details",
    label_vi: "Thông tin payout nếu refinance xe",
    type: "textarea",
    required: (form) => /refinance/i.test(form.loanPurpose || ""),
    conditionalDisplay: (form) => /refinance/i.test(form.loanPurpose || ""),
    loanTypes: ["carLoan"],
    infinityField: "vehicle.refinancePayout",
    aolField: "loans.vehiclePayout"
  },
  {
    section: "Car loan details",
    key: "businessUsePercentage",
    label_en: "Business use percentage",
    label_vi: "Tỉ lệ dùng cho business",
    type: "number",
    required: (form) => form.vehicleUse === "Business",
    conditionalDisplay: (form) => form.vehicleUse === "Business",
    loanTypes: ["carLoan"],
    infinityField: "vehicle.businessUsePercentage",
    aolField: "assets.vehicle.businessUsePercentage"
  },
  {
    section: "Car loan details",
    key: "chattelMortgageRequired",
    label_en: "Chattel mortgage required?",
    label_vi: "Có cần chattel mortgage không?",
    type: "select",
    options: ["Yes", "No", "Unsure"],
    required: (form) => form.vehicleUse === "Business",
    conditionalDisplay: (form) => form.vehicleUse === "Business",
    loanTypes: ["carLoan"],
    infinityField: "vehicle.chattelMortgage",
    aolField: "loans.chattelMortgage"
  },
  {
    section: "Personal loan details",
    key: "personalLoanPurpose",
    label_en: "Personal loan purpose",
    label_vi: "Mục đích vay cá nhân",
    type: "select",
    options: ["Debt consolidation", "Home improvement", "Medical", "Travel", "Wedding", "Other"],
    required: true,
    loanTypes: ["personalLoan"],
    infinityField: "loan.personalPurpose",
    aolField: "loans.personalPurpose"
  },
  {
    section: "Personal loan details",
    key: "personalLoanAmount",
    label_en: "Personal loan amount",
    label_vi: "Số tiền vay cá nhân",
    type: "money",
    required: true,
    loanTypes: ["personalLoan"],
    infinityField: "loan.amount",
    aolField: "loans.amount"
  },
  {
    section: "Personal loan details",
    key: "personalLoanTerm",
    label_en: "Personal loan term",
    label_vi: "Thời hạn vay cá nhân",
    type: "select",
    options: ["1 year", "2 years", "3 years", "5 years", "7 years"],
    required: true,
    loanTypes: ["personalLoan"],
    infinityField: "loan.term",
    aolField: "loans.term"
  },
  {
    section: "Personal loan details",
    key: "personalSecurityType",
    label_en: "Secured or unsecured",
    label_vi: "Có tài sản bảo đảm hay không",
    type: "select",
    options: ["Secured", "Unsecured", "Unsure"],
    required: true,
    loanTypes: ["personalLoan"],
    infinityField: "loan.securityType",
    aolField: "loans.securityType"
  },
  {
    section: "Personal loan details",
    key: "fundingTimeframe",
    label_en: "Funding timeframe",
    label_vi: "Khi nào cần tiền",
    type: "text",
    required: true,
    loanTypes: ["personalLoan"],
    infinityField: "loan.fundingTimeframe",
    aolField: "loans.fundingTimeframe"
  },
  {
    section: "Personal loan details",
    key: "quoteInvoiceAvailable",
    label_en: "Quote / invoice available",
    label_vi: "Có quote / invoice không?",
    type: "select",
    options: ["Yes", "No", "Not applicable"],
    required: true,
    loanTypes: ["personalLoan"],
    infinityField: "documents.quoteInvoice",
    aolField: "documents.quoteInvoice"
  },
  {
    section: "Personal loan details",
    key: "personalDebtConsolidationDetails",
    label_en: "Debt consolidation details",
    label_vi: "Chi tiết gom nợ",
    type: "textarea",
    required: (form) => form.personalLoanPurpose === "Debt consolidation",
    conditionalDisplay: (form) => form.personalLoanPurpose === "Debt consolidation",
    loanTypes: ["personalLoan"],
    infinityField: "loan.personalDebtConsolidation",
    aolField: "loans.debtConsolidation.details"
  },
  {
    section: "Credit history",
    key: "paydayLoans",
    label_en: "Any payday loans?",
    label_vi: "Có payday loan không?",
    type: "select",
    options: ["No", "Yes", "Unsure"],
    required: true,
    loanTypes: ["personalLoan"],
    infinityField: "credit.paydayLoans",
    aolField: "credit.paydayLoans"
  },
  {
    section: "Credit history",
    key: "bnplUse",
    label_en: "BNPL usage",
    label_vi: "Có dùng BNPL không?",
    type: "select",
    options: ["No", "Yes", "Unsure"],
    required: true,
    loanTypes: ["personalLoan"],
    infinityField: "credit.bnplUse",
    aolField: "credit.bnplUse"
  },
  {
    section: "Credit history",
    key: "gamblingTransactions",
    label_en: "Gambling transactions",
    label_vi: "Có giao dịch gambling không?",
    type: "select",
    options: ["No", "Yes", "Unsure"],
    required: true,
    loanTypes: ["personalLoan"],
    infinityField: "credit.gamblingTransactions",
    aolField: "credit.gamblingTransactions"
  },
  {
    section: "Credit history",
    key: "dishonoursHistory",
    label_en: "Dishonours",
    label_vi: "Có dishonour không?",
    type: "select",
    options: ["No", "Yes", "Unsure"],
    required: true,
    loanTypes: ["personalLoan"],
    infinityField: "credit.dishonours",
    aolField: "credit.dishonours"
  },
  {
    section: "Credit history",
    key: "hardshipHistory",
    label_en: "Hardship history",
    label_vi: "Có hardship không?",
    type: "select",
    options: ["No", "Yes", "Unsure"],
    required: true,
    loanTypes: ["personalLoan"],
    infinityField: "credit.hardship",
    aolField: "credit.hardship"
  },
  {
    section: "Credit history",
    key: "recentDeclines",
    label_en: "Recent loan declines",
    label_vi: "Có bị từ chối vay gần đây không?",
    type: "select",
    options: ["No", "Yes", "Unsure"],
    required: true,
    loanTypes: ["personalLoan"],
    infinityField: "credit.recentDeclines",
    aolField: "credit.recentDeclines"
  }
];

function activeDynamicFields(form) {
  const typeKey = dynamicLoanTypeKeyForScenario(form);
  return dynamicLoanFieldCatalog.filter((field) => {
    if (!field.loanTypes.includes(typeKey)) return false;
    if (field.conditionalDisplay && !field.conditionalDisplay(form)) return false;
    return true;
  });
}

function fieldRequired(field, form) {
  return typeof field.required === "function" ? field.required(form) : Boolean(field.required);
}

function fieldLabel(field, language) {
  return language === "vi" ? field.label_vi || field.label_en : field.label_en;
}

function fieldHelp(field, language) {
  return language === "vi" ? field.helpText_vi || field.helpText_en || "" : field.helpText_en || "";
}

function missingFieldLabel(field, language) {
  return language === "vi" ? field.label_vi || field.label_en : field.label_en;
}

function buildClientLoanMissingFields(form, language) {
  const baseRequired = [
    { key: "firstName", label_en: "First / given name(s)", label_vi: "Tên" },
    { key: "surname", label_en: "Family name / surname", label_vi: "Họ" },
    { key: "dateOfBirth", label_en: "Date of birth", label_vi: "Ngày sinh" },
    { key: "email", label_en: "Email", label_vi: "Email" },
    { key: "mobile", label_en: "Mobile", label_vi: "Số điện thoại" },
    { key: "maritalStatus", label_en: "Marital Status", label_vi: "Tình trạng hôn nhân" },
    { key: "residencyStatus", label_en: "Residential Status", label_vi: "Tình trạng cư trú" },
    { key: "loanType", label_en: "Loan type", label_vi: "Loại khoản vay" },
    { key: "loanPurpose", label_en: "Your loan purpose", label_vi: "Mục đích vay" },
    { key: "loanAmount", label_en: "How much would you like to borrow ($)", label_vi: "Số tiền muốn vay" },
    { key: "address", label_en: "Current residential address", label_vi: "Địa chỉ hiện tại" },
    { key: "currentSuburb", label_en: "Suburb", label_vi: "Suburb" },
    { key: "currentState", label_en: "State", label_vi: "Bang" },
    { key: "currentAddressFromDate", label_en: "From Date", label_vi: "Ở từ ngày" },
    { key: "currentResidentialStatus", label_en: "Residential Status", label_vi: "Tình trạng nhà ở" },
    { key: "employmentType", label_en: "Employment Type", label_vi: "Loại công việc" },
    { key: "annualIncome", label_en: "Main income p.a.", label_vi: "Thu nhập chính mỗi năm" },
    { key: "generalExpenses", label_en: "Monthly living expense total", label_vi: "Tổng chi phí sinh hoạt hàng tháng" }
  ];
  if (!/unemployed|retired/i.test(form.employmentType || "")) {
    baseRequired.push(
      { key: "employerName", label_en: "Business Name", label_vi: "Tên công ty" },
      { key: "occupation", label_en: "Job Title", label_vi: "Chức danh công việc" },
      { key: "employmentBasis", label_en: "Employment Basis", label_vi: "Hình thức làm việc" },
      { key: "employmentFromDate", label_en: "From Date", label_vi: "Làm từ ngày" }
    );
  }
  if (/married|defacto/i.test(form.maritalStatus || "") || form.hasSecondApplicant === "Yes") {
    baseRequired.push(
      { key: "secondApplicantFirstName", label_en: "Second applicant first / given name(s)", label_vi: "Tên người vay thứ hai" },
      { key: "secondApplicantSurname", label_en: "Second applicant family name / surname", label_vi: "Họ người vay thứ hai" },
      { key: "secondApplicantDateOfBirth", label_en: "Second applicant date of birth", label_vi: "Ngày sinh người vay thứ hai" },
      { key: "secondApplicantResidencyStatus", label_en: "Second applicant residency", label_vi: "Tình trạng cư trú người vay thứ hai" },
      { key: "secondAnnualIncome", label_en: "Second income p.a.", label_vi: "Thu nhập người vay thứ hai" }
    );
  }
  const dynamicRequired = activeDynamicFields(form)
    .filter((field) => fieldRequired(field, form))
    .map((field) => ({ key: field.key, label_en: field.label_en, label_vi: field.label_vi }));
  return [...baseRequired, ...dynamicRequired]
    .filter((field) => !isFilled(form[field.key]))
    .map((field) => ({ key: field.key, label: missingFieldLabel(field, language) }));
}

function normalizeImportKey(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function flattenImportLeaves(value, prefix = "") {
  if (value === null || value === undefined || value === "") return [];
  if (Array.isArray(value)) {
    if (value.every((item) => item === null || typeof item !== "object")) {
      return [{ path: prefix, value: value.filter((item) => item !== null && item !== undefined).join(", ") }];
    }
    return value.flatMap((item, index) => flattenImportLeaves(item, `${prefix}.${index}`));
  }
  if (typeof value === "object") {
    return Object.entries(value).flatMap(([key, child]) => flattenImportLeaves(child, prefix ? `${prefix}.${key}` : key));
  }
  return [{ path: prefix, value }];
}

function buildImportLookup(data) {
  const lookup = new Map();
  flattenImportLeaves(data).forEach((entry) => {
    const key = normalizeImportKey(entry.path);
    if (key && !lookup.has(key)) lookup.set(key, entry);
  });
  return lookup;
}

const caseImportMappings = [
  ["firstName", ["applicantDetails.firstName", "primaryApplicant.firstName", "applicants.0.firstName", "firstName"]],
  ["surname", ["applicantDetails.surname", "applicantDetails.lastName", "primaryApplicant.surname", "applicants.0.lastName", "surname"]],
  ["dateOfBirth", ["applicantDetails.dateOfBirth", "applicantDetails.dob", "primaryApplicant.dateOfBirth", "applicants.0.dateOfBirth", "dob"]],
  ["gender", ["applicantDetails.gender", "primaryApplicant.gender", "applicants.0.gender"]],
  ["email", ["applicantDetails.email", "contact.email", "primaryApplicant.email", "applicants.0.email"]],
  ["mobile", ["applicantDetails.mobile", "applicantDetails.phone", "contact.mobile", "primaryApplicant.mobile", "applicants.0.mobile"]],
  ["maritalStatus", ["applicantDetails.maritalStatus", "primaryApplicant.maritalStatus", "applicants.0.maritalStatus"]],
  ["residencyStatus", ["applicantDetails.residencyStatus", "applicantDetails.residency", "primaryApplicant.residencyStatus", "applicants.0.residencyStatus"]],
  ["permanentInAustralia", ["applicantDetails.permanentInAustralia", "primaryApplicant.permanentInAustralia", "applicants.0.permanentInAustralia"]],
  ["visaSubclass", ["applicantDetails.visaSubclass", "primaryApplicant.visaSubclass", "applicants.0.visaSubclass"]],
  ["dependants", ["applicantDetails.dependants", "applicantDetails.numberOfDependants", "primaryApplicant.dependants", "applicants.0.dependants"]],
  ["driversLicenceNo", ["applicantDetails.driversLicenceNo", "applicantDetails.driverLicenceNumber", "applicantDetails.licence.number", "primaryApplicant.driversLicenceNo", "applicants.0.driversLicenceNo"]],
  ["licenceExpiryDate", ["applicantDetails.licenceExpiryDate", "applicantDetails.driverLicenceExpiry", "applicantDetails.licence.expiry", "primaryApplicant.licenceExpiryDate", "applicants.0.licenceExpiryDate"]],
  ["licenceState", ["applicantDetails.licenceState", "applicantDetails.driverLicenceState", "applicantDetails.licence.state", "primaryApplicant.licenceState", "applicants.0.licenceState"]],
  ["licenceClass", ["applicantDetails.licenceClass", "applicantDetails.driverLicenceClass", "applicantDetails.licence.class", "primaryApplicant.licenceClass", "applicants.0.licenceClass"]],
  ["address", ["applicantDetails.address", "applicantDetails.currentAddress", "address.current", "primaryApplicant.address", "applicants.0.address"]],
  ["currentSuburb", ["applicantDetails.currentSuburb", "address.suburb", "primaryApplicant.currentSuburb", "applicants.0.currentSuburb"]],
  ["currentState", ["applicantDetails.currentState", "address.state", "primaryApplicant.currentState", "applicants.0.currentState"]],
  ["currentPostcode", ["applicantDetails.currentPostcode", "address.postcode", "primaryApplicant.currentPostcode", "applicants.0.currentPostcode"]],
  ["currentResidentialStatus", ["applicantDetails.currentHousingSituation", "applicantDetails.currentResidentialStatus", "address.housingSituation", "primaryApplicant.currentResidentialStatus"]],
  ["currentAddressFromDate", ["applicantDetails.currentAddressFromDate", "address.fromDate", "primaryApplicant.currentAddressFromDate"]],
  ["postSettlementAddress", ["applicantDetails.postSettlementAddress", "address.postSettlementAddress"]],
  ["mailingAddress", ["applicantDetails.mailingAddress", "address.mailingAddress"]],
  ["previousAddress", ["applicantDetails.previousAddress", "address.previousAddress"]],
  ["secondApplicantFirstName", ["applicantDetails.secondApplicant.firstName", "jointApplicant.firstName", "secondaryApplicant.firstName", "applicants.1.firstName"]],
  ["secondApplicantSurname", ["applicantDetails.secondApplicant.surname", "applicantDetails.secondApplicant.lastName", "jointApplicant.lastName", "secondaryApplicant.lastName", "applicants.1.lastName"]],
  ["secondApplicantDateOfBirth", ["applicantDetails.secondApplicant.dateOfBirth", "applicantDetails.secondApplicant.dob", "jointApplicant.dateOfBirth", "secondaryApplicant.dateOfBirth", "applicants.1.dateOfBirth"]],
  ["secondApplicantGender", ["applicantDetails.secondApplicant.gender", "jointApplicant.gender", "secondaryApplicant.gender", "applicants.1.gender"]],
  ["secondApplicantEmail", ["applicantDetails.secondApplicant.email", "jointApplicant.email", "secondaryApplicant.email", "applicants.1.email"]],
  ["secondApplicantMobile", ["applicantDetails.secondApplicant.mobile", "jointApplicant.mobile", "secondaryApplicant.mobile", "applicants.1.mobile"]],
  ["secondApplicantResidencyStatus", ["applicantDetails.secondApplicant.residencyStatus", "jointApplicant.residencyStatus", "secondaryApplicant.residencyStatus", "applicants.1.residencyStatus"]],
  ["secondApplicantPermanentInAustralia", ["applicantDetails.secondApplicant.permanentInAustralia", "jointApplicant.permanentInAustralia", "secondaryApplicant.permanentInAustralia", "applicants.1.permanentInAustralia"]],
  ["secondApplicantDriversLicenceNo", ["applicantDetails.secondApplicant.driversLicenceNo", "jointApplicant.driversLicenceNo", "secondaryApplicant.driversLicenceNo", "applicants.1.driversLicenceNo"]],
  ["secondApplicantLicenceExpiryDate", ["applicantDetails.secondApplicant.licenceExpiryDate", "jointApplicant.licenceExpiryDate", "secondaryApplicant.licenceExpiryDate", "applicants.1.licenceExpiryDate"]],
  ["secondApplicantLicenceState", ["applicantDetails.secondApplicant.licenceState", "jointApplicant.licenceState", "secondaryApplicant.licenceState", "applicants.1.licenceState"]],
  ["secondApplicantLicenceClass", ["applicantDetails.secondApplicant.licenceClass", "jointApplicant.licenceClass", "secondaryApplicant.licenceClass", "applicants.1.licenceClass"]],
  ["loanScenario", ["loanDetails.loanScenario", "loanDetails.scenario", "loanRequest.loanScenario", "clientWants.loanScenario", "clientObjectives.loanScenario"]],
  ["loanType", ["loanDetails.loanType", "loanRequest.loanType"]],
  ["loanPurpose", ["loanDetails.loanPurpose", "loanDetails.purpose", "loanRequest.purpose"]],
  ["loanAmount", ["loanDetails.loanAmount", "loanDetails.amount", "loanRequest.loanAmount"]],
  ["propertyValue", ["loanDetails.propertyValue", "loanRequest.propertyValue", "securityProperties.0.estimatedValue"]],
  ["depositEquity", ["loanDetails.depositEquity", "loanDetails.deposit", "loanRequest.deposit"]],
  ["propertyLocation", ["loanDetails.propertyLocation", "loanDetails.propertyAddress", "securityProperties.0.address"]],
  ["timeline", ["loanDetails.timeline", "loanRequest.timeline", "loanRequest.settlementTimeframe"]],
  ["loanTermYears", ["loanDetails.loanTermYears", "loanDetails.termYears", "loanRequest.termYears"]],
  ["repaymentType", ["loanDetails.repaymentType", "loanRequest.repaymentType"]],
  ["ratePreference", ["loanDetails.ratePreference", "loanRequest.ratePreference"]],
  ["offsetRequested", ["loanDetails.offsetRequested", "loanDetails.offset", "loanRequest.offsetRequested"]],
  ["annualIncome", ["income.annualIncome", "income.primaryAnnualIncome", "employment.annualIncome", "employment.income", "applicants.0.annualIncome"]],
  ["secondAnnualIncome", ["income.secondAnnualIncome", "income.secondaryAnnualIncome", "employment.secondAnnualIncome", "applicants.1.annualIncome"]],
  ["rentalIncomeAnnual", ["income.rentalIncomeAnnual", "income.rentalIncome"]],
  ["employmentType", ["employment.employmentType", "employment.type", "applicants.0.employmentType"]],
  ["employerName", ["employment.employerName", "employment.employer", "applicants.0.employerName"]],
  ["occupation", ["employment.occupation", "employment.jobTitle", "applicants.0.occupation"]],
  ["employmentBasis", ["employment.employmentBasis", "employment.basis"]],
  ["employmentFromDate", ["employment.employmentFromDate", "employment.startDate", "employment.fromDate"]],
  ["secondApplicantEmploymentType", ["employment.secondApplicant.employmentType", "secondaryEmployment.employmentType", "applicants.1.employmentType"]],
  ["secondApplicantEmployerName", ["employment.secondApplicant.employerName", "secondaryEmployment.employerName", "applicants.1.employerName"]],
  ["secondApplicantJobTitle", ["employment.secondApplicant.jobTitle", "secondaryEmployment.jobTitle", "applicants.1.occupation"]],
  ["generalExpenses", ["expenses.generalExpenses", "expenses.monthlyLivingExpenses", "expenses.hemMonthly"]],
  ["hemMonthly", ["expenses.hemMonthly", "loanDetails.hemMonthly"]],
  ["financialAssetBuffer", ["assets.financialAssetBuffer", "assets.financialAssets", "assets.savings"]],
  ["cashSavingsAmount", ["assets.cashSavingsAmount", "assets.cashSavings", "assets.savingsAmount"]],
  ["realEstateAssetAddress", ["assets.realEstateAssetAddress", "assets.realEstate.0.address"]],
  ["realEstateAssetValue", ["assets.realEstateAssetValue", "assets.realEstate.0.value"]],
  ["motorVehicleModelYear", ["assets.motorVehicleModelYear", "assets.vehicle.modelYear"]],
  ["motorVehicleValue", ["assets.motorVehicleValue", "assets.vehicle.value"]],
  ["existingDebtsSummary", ["liabilities.existingDebtsSummary", "liabilities.summary", "loanDetails.debtConsolidationDebts"]],
  ["currentLender", ["liabilities.currentLender", "loanDetails.currentLender"]],
  ["currentLoanBalance", ["liabilities.currentLoanBalance", "loanDetails.currentLoanBalance"]],
  ["creditIssue", ["creditFile.creditIssue", "creditFile.hasCreditIssue", "creditHistory.creditIssue"]],
  ["paydayLoans", ["creditFile.paydayLoans"]],
  ["bnplUse", ["creditFile.bnplUse", "creditFile.buyNowPayLater"]],
  ["gamblingTransactions", ["creditFile.gamblingTransactions"]],
  ["dishonoursHistory", ["creditFile.dishonoursHistory", "creditFile.dishonours"]],
  ["hardshipHistory", ["creditFile.hardshipHistory", "creditFile.hardship"]],
  ["recentDeclines", ["creditFile.recentDeclines"]],
  ["clientNotes", ["lenderNotes", "brokerNotes", "additionalNotes", "notes"]]
];

function importCaseDataIntoForm(currentForm, caseData) {
  const lookup = buildImportLookup(caseData);
  const consumed = new Set();
  const next = { ...currentForm };
  let importedCount = 0;

  caseImportMappings.forEach(([field, aliases]) => {
    const directAliases = [
      field,
      `applicantDetails.${field}`,
      `applicantDetails.secondApplicant.${field.replace(/^secondApplicant/, "")}`,
      `loanDetails.${field}`,
      `employment.${field}`,
      `employment.secondApplicant.${field.replace(/^secondApplicant/, "")}`,
      `income.${field}`,
      `assets.${field}`,
      `liabilities.${field}`,
      `expenses.${field}`,
      `creditFile.${field}`
    ];
    const entry = [...aliases, ...directAliases].map((alias) => lookup.get(normalizeImportKey(alias))).find(Boolean);
    if (!entry) return;
    consumed.add(entry.path);
    next[field] = typeof currentForm[field] === "boolean"
      ? /^(true|yes|y|1)$/i.test(String(entry.value))
      : String(entry.value);
    importedCount += 1;
  });

  dynamicLoanFieldCatalog.forEach((field) => {
    if (isFilled(next[field.key])) return;
    const entry = [
      field.key,
      `loanDetails.${field.key}`,
      `homeLoan.${field.key}`,
      `refinance.${field.key}`,
      `commercialLoan.${field.key}`,
      `businessLoan.${field.key}`,
      `carLoan.${field.key}`,
      `personalLoan.${field.key}`
    ].map((alias) => lookup.get(normalizeImportKey(alias))).find(Boolean);
    if (!entry) return;
    consumed.add(entry.path);
    next[field.key] = String(entry.value);
    importedCount += 1;
  });

  if (next.secondApplicantFirstName || next.secondApplicantSurname || next.secondApplicantDateOfBirth || next.secondAnnualIncome) {
    next.hasSecondApplicant = "Yes";
    if (/single/i.test(next.secondApplicantMaritalStatus || "")) next.secondApplicantMaritalStatus = next.maritalStatus || "Married";
  }

  if (!next.loanScenario) {
    next.loanScenario = deriveLoanScenario(next.loanType, next.loanPurpose);
  }

  const unknown = flattenImportLeaves(caseData)
    .filter((entry) => !consumed.has(entry.path))
    .map((entry) => `${entry.path}: ${String(entry.value)}`);

  if (unknown.length) {
    const block = `Imported unmapped data:\n${unknown.join("\n")}`;
    next.clientNotes = [next.clientNotes, block].filter(Boolean).join("\n\n");
  }

  return { next: hydrateNameParts(next), importedCount, unknown };
}

function DynamicLoanField({ field, form, language, onChange }) {
  const required = fieldRequired(field, form);
  const label = fieldLabel(field, language);
  const help = fieldHelp(field, language);
  const value = form[field.key] ?? "";
  if (field.type === "select") {
    return (
      <label data-loan-field={field.key}>
        {label}
        <select required={required} value={value} onChange={(event) => onChange(field.key, event.target.value)}>
          <option value="">{clientFormCopy[language].select}</option>
          {field.options.map((option) => <option key={option} value={option}>{optionText(option, language)}</option>)}
        </select>
        {help ? <span className="field-help">{help}</span> : null}
      </label>
    );
  }
  if (field.type === "textarea") {
    return (
      <label className="client-wide-field" data-loan-field={field.key}>
        {label}
        <textarea required={required} value={value} onChange={(event) => onChange(field.key, event.target.value)} />
        {help ? <span className="field-help">{help}</span> : null}
      </label>
    );
  }
  if (field.type === "date") {
    return <DateField fieldKey={field.key} label={label} language={language} required={required} value={value} onChange={(next) => onChange(field.key, next)} help={help} />;
  }
  return (
    <label data-loan-field={field.key}>
      {label}
      <input
        required={required}
        inputMode={field.type === "money" || field.type === "number" ? "decimal" : undefined}
        value={value}
        onChange={(event) => onChange(field.key, event.target.value)}
      />
      {help ? <span className="field-help">{help}</span> : null}
    </label>
  );
}

function DynamicLoanSections({ form, language, onChange }) {
  const sections = activeDynamicFields(form).reduce((acc, field) => {
    if (!acc[field.section]) acc[field.section] = [];
    acc[field.section].push(field);
    return acc;
  }, {});
  return Object.entries(sections).map(([section, fields]) => (
    <div className="conditional-panel" key={section}>
      <h3>{language === "vi" ? tx(section, language) : section}</h3>
      <div className="client-intake-grid">
        {fields.map((field) => (
          <DynamicLoanField key={field.key} field={field} form={form} language={language} onChange={onChange} />
        ))}
      </div>
    </div>
  ));
}

const loanCaseManagerGroups = [
  {
    title: "Applicant identity",
    fields: [
      ["dateOfBirth", "Primary DOB", "date"],
      ["gender", "Primary gender", "select", genderOptions],
      ["maritalStatus", "Primary marital status", "select", maritalStatusOptions],
      ["dependants", "Primary dependants"],
      ["residencyStatus", "Primary residency", "select", residencyOptions],
      ["permanentInAustralia", "Permanent in Australia", "select", yesNoOptions],
      ["driversLicenceNo", "Driver licence no."],
      ["licenceExpiryDate", "Licence expiry", "date"],
      ["licenceState", "Licence state", "select", licenceStateOptions],
      ["licenceClass", "Licence class"]
    ]
  },
  {
    title: "Address history",
    fields: [
      ["address", "Current residential address", "wide"],
      ["currentSuburb", "Current suburb"],
      ["currentState", "Current state", "select", licenceStateOptions],
      ["currentPostcode", "Current postcode"],
      ["currentAddressFromDate", "Current address from", "date"],
      ["currentResidentialStatus", "Current housing situation", "select", residentialStatusOptions],
      ["postSettlementAddress", "Post settlement address", "wide"],
      ["mailingAddress", "Mailing address", "wide"],
      ["previousAddress", "Previous residential address", "wide"],
      ["previousSuburb", "Previous suburb"],
      ["previousState", "Previous state", "select", licenceStateOptions],
      ["previousPostcode", "Previous postcode"],
      ["previousResidentialStatus", "Previous residential status", "select", residentialStatusOptions]
    ]
  },
  {
    title: "Second applicant full details",
    secondOnly: true,
    fields: [
      ["secondApplicantDateOfBirth", "Second DOB", "date"],
      ["secondApplicantGender", "Second gender", "select", genderOptions],
      ["secondApplicantMaritalStatus", "Second marital status", "select", maritalStatusOptions],
      ["secondApplicantDependants", "Second dependants"],
      ["secondApplicantResidencyStatus", "Second residency", "select", residencyOptions],
      ["secondApplicantPermanentInAustralia", "Second permanent in Australia", "select", yesNoOptions],
      ["secondApplicantDriversLicenceNo", "Second licence no."],
      ["secondApplicantLicenceExpiryDate", "Second licence expiry", "date"],
      ["secondApplicantLicenceState", "Second licence state", "select", licenceStateOptions],
      ["secondApplicantLicenceClass", "Second licence class"],
      ["secondApplicantAddress", "Second current residential address", "wide"],
      ["secondApplicantCurrentSuburb", "Second current suburb"],
      ["secondApplicantCurrentState", "Second current state", "select", licenceStateOptions],
      ["secondApplicantCurrentAddressFromDate", "Second address from", "date"],
      ["secondApplicantCurrentResidentialStatus", "Second housing situation", "select", residentialStatusOptions],
      ["secondApplicantPreviousAddress", "Second previous address", "wide"],
      ["secondApplicantPreviousSuburb", "Second previous suburb"],
      ["secondApplicantPreviousState", "Second previous state", "select", licenceStateOptions],
      ["secondApplicantPreviousPostcode", "Second previous postcode"],
      ["secondApplicantPreviousResidentialStatus", "Second previous residential status", "select", residentialStatusOptions]
    ]
  },
  {
    title: "Employment and income",
    fields: [
      ["employmentType", "Primary employment type", "select", employmentTypeOptions],
      ["employerName", "Business/employer name"],
      ["businessAddress", "Business address"],
      ["occupation", "Job title"],
      ["employmentBasis", "Employment basis", "select", employmentBasisOptions],
      ["employmentFromDate", "Employment from", "date"],
      ["rentalIncomeAnnual", "Rental income p.a."],
      ["secondApplicantEmploymentType", "Second employment type", "select", employmentTypeOptions],
      ["secondApplicantEmployerName", "Second employer"],
      ["secondApplicantJobTitle", "Second job title"],
      ["secondApplicantEmploymentBasis", "Second employment basis", "select", employmentBasisOptions],
      ["secondApplicantEmploymentFromDate", "Second employment from", "date"]
    ]
  },
  {
    title: "Living expenses and assets",
    fields: [
      ["generalExpenses", "Monthly living expense total"],
      ["applicant1Expenses", "Applicant 1 expense amount"],
      ["applicant2Expenses", "Applicant 2 expense amount"],
      ["privateHealthInsuranceApplicant1", "Private health insurance - Applicant 1", "select", yesNoAdviseOptions],
      ["applicant1HealthInsuranceAmount", "Applicant 1 health amount/month"],
      ["privateHealthInsuranceApplicant2", "Private health insurance - Applicant 2", "select", yesNoAdviseOptions],
      ["applicant2HealthInsuranceAmount", "Applicant 2 health amount/month"],
      ["incomeProtectionLifeInsurance", "Income protection/life insurance", "select", yesNoAdviseOptions],
      ["cashSavingsAmount", "Cash/savings amount"],
      ["realEstateAssetAddress", "Real estate asset address", "wide"],
      ["realEstateAssetValue", "Real estate asset value"],
      ["bankingWith", "Banking with"],
      ["motorVehicleModelYear", "Motor vehicle model/year"],
      ["motorVehicleValue", "Motor vehicle estimated value"],
      ["homeContentsItem", "Home contents item"],
      ["homeContentsValue", "Home contents estimated value"]
    ]
  },
  {
    title: "Loan details and credit",
    fields: [
      ["loanTermYears", "Loan term", "select", ["30", "25", "20", "15", "40"]],
      ["repaymentType", "Repayment type", "select", ["Principal & Interest", "Interest Only", "Split"]],
      ["ratePreference", "Rate preference", "select", ["Variable", "Fixed", "Fixed and variable", "Unsure"]],
      ["offsetRequested", "Offset requested", "select", yesNoAdviseOptions],
      ["redrawRequested", "Redraw requested", "select", yesNoAdviseOptions],
      ["creditIssue", "Credit issue", "select", ["No", "Yes", "Unsure", "Unknown"]],
      ["paydayLoans", "Payday loans", "select", yesNoAdviseOptions],
      ["bnplUse", "BNPL use", "select", yesNoAdviseOptions],
      ["gamblingTransactions", "Gambling transactions", "select", yesNoAdviseOptions],
      ["dishonoursHistory", "Dishonours history", "select", yesNoAdviseOptions],
      ["hardshipHistory", "Hardship history", "select", yesNoAdviseOptions],
      ["recentDeclines", "Recent loan declines", "select", yesNoAdviseOptions],
      ["existingDebtsSummary", "Existing debts/comments", "textarea"]
    ]
  }
];

function ClientLoanFormHeader({ title, description, language = "en", onLanguageChange }) {
  return (
    <header className="client-form-hero">
      <div className="client-form-hero-top">
        <div className="client-form-brand">
          <img src="/elf-logo.png" alt="Easy Loan Finance" />
          <span className="app-mark client-form-mark" aria-label="Loan Form">LF</span>
          <div>
            <span>Easy Loan Finance</span>
            <strong>Quick Loan, Easy Life</strong>
          </div>
        </div>
        {onLanguageChange && (
          <div className="language-switch" aria-label="Language">
            <button type="button" className={language === "en" ? "active" : ""} onClick={() => onLanguageChange("en")}>
              <span>🇦🇺</span> English
            </button>
            <button type="button" className={language === "vi" ? "active" : ""} onClick={() => onLanguageChange("vi")}>
              <span>🇻🇳</span> Việt Nam
            </button>
          </div>
        )}
      </div>
      <div className="client-form-copy">
        <p className="client-form-kicker">{clientFormCopy[language].secure}</p>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      <div className="client-form-support">
        <a href="https://easyloanfinance.com.au" target="_blank" rel="noreferrer">easyloanfinance.com.au</a>
        <a href="mailto:hello@easyloanfinance.com.au">hello@easyloanfinance.com.au</a>
      </div>
    </header>
  );
}

function CallNotesPage({ onOpenAutofill, initialPanel = "call" }) {
  const { session } = useSessionStatus();
  const [form, setForm] = useState(emptyCallNote);
  const emptySubmissionEdit = {
    ...emptyCallNote,
    clientName: "",
    firstName: "",
    middleName: "",
    surname: "",
    secondApplicantName: "",
    secondApplicantFirstName: "",
    secondApplicantMiddleName: "",
    secondApplicantSurname: "",
  secondApplicantDateOfBirth: "",
  secondApplicantGender: "",
  secondApplicantPermanentInAustralia: "Yes",
  secondApplicantDriversLicenceNo: "",
  secondApplicantLicenceCardNumber: "",
  secondApplicantLicenceExpiryDate: "",
  secondApplicantLicenceState: "",
  secondApplicantLicenceClass: "C",
  secondApplicantMobile: "",
    secondApplicantEmail: "",
    secondApplicantResidencyStatus: "",
    secondApplicantVisaSubclass: "",
    secondApplicantMaritalStatus: "",
    secondApplicantDependants: "",
    secondApplicantAddress: "",
    secondApplicantCurrentSuburb: "",
    secondApplicantCurrentState: "",
    secondApplicantCurrentAddressFromDate: "",
    secondApplicantCurrentResidentialStatus: "",
    secondApplicantPreviousAddress: "",
    secondApplicantPreviousSuburb: "",
    secondApplicantPreviousState: "",
    secondApplicantPreviousPostcode: "",
    secondApplicantPreviousResidentialStatus: "",
    secondApplicantEmploymentType: "",
    secondApplicantEmployerName: "",
    secondApplicantBusinessAddress: "",
    secondApplicantJobTitle: "",
    secondApplicantEmploymentBasis: "",
    secondApplicantEmploymentFromDate: "",
    secondApplicantEmploymentContactName: "",
    secondApplicantEmploymentContactNumber: "",
    secondApplicantPreviousBusinessName: "",
    secondApplicantPreviousJobTitle: "",
    secondApplicantPreviousEmploymentBasis: "",
    secondApplicantPreviousEmploymentFromDate: "",
    secondApplicantPreviousEmploymentToDate: "",
    mobile: "",
    email: "",
    loanScenario: "",
    loanType: "",
    loanPurpose: "",
    loanAmount: "",
    propertyValue: "",
    depositEquity: "",
    propertyLocation: "",
    annualIncome: "",
    secondAnnualIncome: "",
    hemMonthly: "",
    financialAssetBuffer: "",
    clientNotes: ""
  };
  const [notes, setNotes] = useState([]);
  const [intakes, setIntakes] = useState([]);
  const [search, setSearch] = useState("");
  const [ccTab, setCcTab] = useState("call"); // client-call: Client Call | Client Prospects | Team & Users
  const [activePanel, setActivePanel] = useState(initialPanel);
  const [selectedId, setSelectedId] = useState("");
  const [selectedIntakeId, setSelectedIntakeId] = useState("");
  const [submissionEdit, setSubmissionEdit] = useState(emptySubmissionEdit);
  const [savedSubmissionEdit, setSavedSubmissionEdit] = useState(emptySubmissionEdit);
  const submissionEditorRef = useRef(null);
  const [redFlags, setRedFlags] = useState([]);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [caseImportOpen, setCaseImportOpen] = useState(false);
  const [caseImportJson, setCaseImportJson] = useState("");
  const [caseImportWarning, setCaseImportWarning] = useState("");
  const [templateLibraryOpen, setTemplateLibraryOpen] = useState(false);
  const [loanFormImportTemplate, setLoanFormImportTemplate] = useState("");
  const canViewLoanSubmissions = Boolean(session && (!session.required || session.role === "admin" || session.accessLevel === "broker"));

  async function refreshNotes() {
    const result = await api("/api/call-notes");
    setNotes(result);
  }

  async function refreshIntakes() {
    const result = await api("/api/client-intakes");
    setIntakes(result);
  }

  useEffect(() => {
    refreshNotes().catch((err) => setError(err.message));
  }, []);

  useEffect(() => {
    if (canViewLoanSubmissions) refreshIntakes().catch((err) => setError(err.message));
  }, [canViewLoanSubmissions]);

  const filteredNotes = useMemo(() => {
    const terms = searchKey(search).trim().split(/\s+/).filter(Boolean);
    const source = terms.length
      ? notes.filter((note) => {
          const haystack = [
            note.id,
            note.clientName,
            note.firstName,
            note.middleName,
            note.surname,
            note.secondApplicantName,
            note.secondApplicantFirstName,
            note.secondApplicantMiddleName,
            note.secondApplicantSurname,
            note.mobile,
            note.email,
            note.loanPurpose,
            note.convertedCaseId
          ].join(" ");
          const searchable = searchKey(haystack);
          return terms.every((term) => searchable.includes(term));
        })
      : notes.slice(0, 6);
    return source.slice(0, 12);
  }, [notes, search]);

  const filteredIntakes = useMemo(() => {
    const terms = searchKey(search).trim().split(/\s+/).filter(Boolean);
    const source = intakes.filter((intake) => {
      if (!terms.length) return true;
          const haystack = [
            intake.clientName,
            intake.firstName,
            intake.middleName,
            intake.surname,
            intake.secondApplicantName,
            intake.secondApplicantFirstName,
            intake.secondApplicantMiddleName,
            intake.secondApplicantSurname,
            intake.mobile,
            intake.email,
            intake.loanScenario,
            intake.loanPurpose,
            intake.loanType,
            intake.convertedCaseId,
            intake.callNoteId,
            intake.status
          ].join(" ");
          const searchable = searchKey(haystack);
          return terms.every((term) => searchable.includes(term));
        });
    return source.slice(0, 12);
  }, [intakes, search]);
  const selectedIntake = useMemo(() => intakes.find((intake) => intake.id === selectedIntakeId) || null, [intakes, selectedIntakeId]);
  const newlyAddedIntakes = useMemo(() => {
    return [...intakes]
      .sort((a, b) => new Date(b.submittedAt || b.createdAt || 0) - new Date(a.submittedAt || a.createdAt || 0))
      .slice(0, 3);
  }, [intakes]);
  const recentlyEditedIntakes = useMemo(() => {
    return [...intakes]
      .filter((intake) => intake.lastSavedAt || intake.updatedAt)
      .sort((a, b) => new Date(b.lastSavedAt || b.updatedAt || 0) - new Date(a.lastSavedAt || a.updatedAt || 0))
      .slice(0, 3);
  }, [intakes]);
  const submissionDirty = selectedIntake && JSON.stringify(submissionEdit) !== JSON.stringify(savedSubmissionEdit);

  function updateField(field, value) {
    setForm((current) => {
      const next = { ...current, [field]: value };
      if (field === "loanCategory") {
        next.loanAction = defaultLoanActionForCategory(value);
        if (value !== "Residential Home Loan") next.occupancy = "";
      }
      const loanFields = new Set([
        "loanCategory",
        "loanAction",
        "occupancy",
        "loanType",
        "loanPurpose",
        "loanScenario",
        "depositEquity",
        "depositOrEquity",
        "propertyValue",
        "estimatedValue",
        "assetType",
        "privatePurpose"
      ]);
      return loanFields.has(field) ? normalizeCallNote(next) : next;
    });
  }

  function clearSecondApplicantFields(current) {
    return {
      ...current,
      hasSecondApplicant: "No",
      secondApplicantName: "",
      secondApplicantFirstName: "",
      secondApplicantMiddleName: "",
      secondApplicantSurname: "",
      secondApplicantDateOfBirth: "",
      secondApplicantGender: "",
      secondApplicantPermanentInAustralia: "Yes",
      secondApplicantDriversLicenceNo: "",
      secondApplicantLicenceCardNumber: "",
      secondApplicantLicenceExpiryDate: "",
      secondApplicantLicenceState: "",
      secondApplicantLicenceClass: "C",
      secondApplicantMobile: "",
      secondApplicantEmail: "",
      secondApplicantAddress: "",
      secondApplicantResidencyStatus: "Australian citizen",
      secondApplicantMaritalStatus: "Single",
      secondApplicantDependants: "0",
      secondApplicantEmployerName: "",
      secondApplicantJobTitle: "",
      secondAnnualIncome: ""
    };
  }

  function updateMaritalStatus(value) {
    setForm((current) => {
      const next = { ...current, maritalStatus: value };
      if (/married|defacto/i.test(value)) {
        return {
          ...next,
          hasSecondApplicant: "Yes",
          secondApplicantMaritalStatus: value
        };
      }
      return clearSecondApplicantFields(next);
    });
  }

  function updateSecondApplicantChoice(value) {
    setForm((current) => {
      if (value !== "Yes") return clearSecondApplicantFields(current);
      return {
        ...current,
        hasSecondApplicant: "Yes",
        secondApplicantResidencyStatus: current.secondApplicantResidencyStatus || "Australian citizen",
        secondApplicantMaritalStatus: /married|defacto/i.test(current.maritalStatus || "")
          ? current.maritalStatus
          : current.secondApplicantMaritalStatus || "Single",
        secondApplicantDependants: current.secondApplicantDependants || "0"
      };
    });
  }

  function loadNote(note) {
    setSelectedId(note.id);
    const normalized = normalizeCallNote({ ...emptyCallNote, ...hydrateNameParts(note) });
    setForm(normalized);
    setRedFlags(note.redFlags || normalized.scenarioTags || []);
    setMessage(`Loaded ${note.id}`);
  }

  function loanFormStatus(item) {
    if (item.validationStatus?.ok || item.lastSavedAt) return "Ready for EasyFlow";
    if (item.status === "submitted" || item.intakeStatus === "submitted") return "Loan Form Submitted";
    if (item.intakeToken || item.status === "sent") return "Loan Form Link Created";
    if (item.callNoteId || item.convertedCaseId) return "Call Intake Linked";
    return "Call Intake Only";
  }

  function intakeSourceLabel(intake) {
    return intake.source === "public-loan-form" ? "Public Loan Form" : "Client Call linked";
  }

  function loanFormLinkDetail(item) {
    if (!item?.intakeToken && !item?.token) return "No Loan Form link yet";
    const copiedAt = item.intakeLinkLastCopiedAt || item.lastLinkCopiedAt;
    const copiedText = copiedAt ? `Last copied ${new Date(copiedAt).toLocaleString()}` : "Link created, not copied yet";
    const count = Number(item.linkCopyCount || 0);
    return count ? `${copiedText} (${count} copy${count === 1 ? "" : "ies"})` : copiedText;
  }

  function toggleRedFlag(flag) {
    setRedFlags((items) => (items.includes(flag) ? items.filter((item) => item !== flag) : [...items, flag]));
  }

  function toggleScenarioTag(tag) {
    setForm((current) => {
      const currentTags = ensureArray(current.scenarioTags);
      const scenarioTags = currentTags.includes(tag)
        ? currentTags.filter((item) => item !== tag)
        : [...currentTags, tag];
      return normalizeCallNote({ ...current, scenarioTags });
    });
    setRedFlags((items) => (items.includes(tag) ? items.filter((item) => item !== tag) : [...items, tag]));
  }

  function validateDraftCase() {
    const missing = [];
    const normalized = normalizeCallNote(form);
    if (!composeLegalName(normalized.firstName, "", normalized.surname, normalized.clientName).trim()) missing.push("Client name");
    if (!String(normalized.mobile || "").trim() && !String(normalized.email || "").trim()) missing.push("Mobile or email");
    if (!normalized.loanCategory.trim()) missing.push("Loan category");
    return missing;
  }

  async function saveCallNote({ convert = false } = {}) {
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const normalizedForm = normalizeCallNote(form);
      const primaryNameParts = hydrateNameParts(normalizedForm);
      const primaryLegalName = composeLegalName(primaryNameParts.firstName, "", primaryNameParts.surname, normalizedForm.clientName);
      const secondaryLegalName = composeLegalName(
        normalizedForm.secondApplicantFirstName,
        "",
        normalizedForm.secondApplicantSurname,
        normalizedForm.secondApplicantName
      );
      const hasSecondApplicantForSave =
        normalizedForm.hasSecondApplicant === "Yes" ||
        isFilled(normalizedForm.secondApplicantFirstName) ||
        isFilled(normalizedForm.secondApplicantSurname) ||
        isFilled(normalizedForm.secondApplicantName);
      const callPayload = {
        ...normalizedForm,
        firstName: primaryNameParts.firstName,
        middleName: "",
        surname: primaryNameParts.surname,
        secondApplicantMiddleName: "",
        clientName: primaryLegalName,
        secondApplicantName: hasSecondApplicantForSave ? secondaryLegalName : "",
        hasSecondApplicant: hasSecondApplicantForSave ? "Yes" : "No",
        redFlags
      };
      const missing = convert ? validateDraftCase() : [];
      if (missing.length) {
        throw new Error(`Cannot create Loan Form link yet. Missing: ${missing.join(", ")}.`);
      }

      const saved = await api(selectedId ? `/api/call-notes/${selectedId}` : "/api/call-notes", {
        method: selectedId ? "PATCH" : "POST",
        body: JSON.stringify(callPayload)
      });
      let output = saved;
      if (convert) {
        const intake = await api(`/api/call-notes/${saved.id}/intake-link`, { method: "POST", body: "{}" });
        await navigator.clipboard?.writeText(intake.url).catch(() => {});
        output = {
          ...saved,
          convertedCaseId: intake.caseId || saved.convertedCaseId,
          intakeToken: intake.token,
          intakeStatus: intake.status,
          intakeLinkLastCopiedAt: intake.lastLinkCopiedAt || new Date().toISOString()
        };
        setMessage(`${saved.intakeToken ? "Existing" : "New"} Loan Form link copied. Case ID: ${intake.caseId || output.convertedCaseId || saved.id}.`);
      } else {
        setMessage(`Call note saved: ${saved.id}. No Loan Form link was created yet.`);
      }
      setSelectedId(output.id);
      setForm(normalizeCallNote({ ...emptyCallNote, ...output }));
      setRedFlags(output.redFlags || output.scenarioTags || []);
      await refreshNotes();
      if (canViewLoanSubmissions) await refreshIntakes();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function convertSelected(note) {
    setSaving(true);
    setError("");
    try {
      const intake = await api(`/api/call-notes/${note.id}/intake-link`, { method: "POST", body: "{}" });
      await navigator.clipboard?.writeText(intake.url).catch(() => {});
      setMessage(`Loan Form link copied. ${note.intakeToken ? "Existing linked form reused" : "New linked form created"}. Case ID: ${intake.caseId || note.convertedCaseId || note.id}.`);
      await refreshNotes();
      if (canViewLoanSubmissions) await refreshIntakes();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function createIntakeLink(note) {
    setSaving(true);
    setError("");
    try {
      const intake = await api(`/api/call-notes/${note.id}/intake-link`, { method: "POST", body: "{}" });
      await navigator.clipboard?.writeText(intake.url).catch(() => {});
      setMessage(`Loan Form link copied for ${note.clientName || note.id}. ${note.intakeToken ? "Existing linked form reused" : "New linked form created"} and linked to call note ${note.id}.`);
      await refreshNotes();
      if (canViewLoanSubmissions) await refreshIntakes();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function deleteNote(note) {
    const expected = `DELETE ${note.id}`;
    const typed = window.prompt(`Delete this local call note only.\n\nType ${expected} to confirm.`);
    if (typed !== expected) return;
    setSaving(true);
    setError("");
    try {
      await api(`/api/call-notes/${note.id}`, {
        method: "DELETE",
        body: JSON.stringify({ confirm: expected })
      });
      if (selectedId === note.id) setSelectedId("");
      setMessage(`Deleted ${note.id}`);
      await refreshNotes();
      if (canViewLoanSubmissions) await refreshIntakes();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  function downloadFactFind(intake) {
    window.open(`${apiBase}/api/client-intakes/${encodeURIComponent(intake.id)}/fact-find`, "_blank", "noopener,noreferrer");
    setIntakes((current) => current.map((item) => item.id === intake.id ? { ...item, factFindExportedAt: new Date().toISOString() } : item));
  }

  function caseIdForIntake(intake) {
    return intake?.convertedCaseId || intake?.caseId || intake?.callNoteId || "";
  }

  function openEasyFlowForIntake(intake = selectedIntake) {
    const caseId = caseIdForIntake(intake);
    if (!caseId) {
      setError("This record is not linked to an EasyFlow case yet. Create the Loan Form link first.");
      return;
    }
    onOpenAutofill?.(caseId);
  }

  function importCaseJsonIntoSelected() {
    if (!selectedIntake) return;
    setError("");
    setMessage("");
    setCaseImportWarning("");
    let parsed;
    try {
      parsed = JSON.parse(caseImportJson);
    } catch (err) {
      setError(`Invalid JSON. Please check the pasted case data. ${err.message}`);
      return;
    }
    const { next, importedCount, unknown } = importCaseDataIntoForm(submissionEdit, parsed);
    setSubmissionEdit(next);
    setCaseImportOpen(false);
    setMessage(`Case JSON imported. Please review and save before EasyFlow. ${importedCount} fields filled.`);
    if (unknown.length) {
      setCaseImportWarning(`${unknown.length} unmapped field(s) were added to Client notes: ${unknown.slice(0, 8).map((item) => item.split(":")[0]).join(", ")}${unknown.length > 8 ? "..." : ""}`);
    }
  }

  async function openLoanFormTemplateLibrary({ copy = false } = {}) {
    setError("");
    setMessage("");
    try {
      let template = loanFormImportTemplate;
      if (!template) {
        const response = await fetch(`${apiBase}/api/loan-form-import-template`, { credentials: "include" });
        if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || response.statusText);
        template = await response.text();
        setLoanFormImportTemplate(template);
      }
      setTemplateLibraryOpen(true);
      if (copy) {
        await navigator.clipboard?.writeText(template).catch(() => {});
        setMessage("Full Loan Form ChatGPT template copied.");
      }
    } catch (err) {
      setError(err.message);
    }
  }

  function loadIntake(intake) {
    if (submissionDirty && !window.confirm("You have unsaved changes. Switch submission anyway?")) return;
    const nextEdit = {
      clientName: intake.clientName || "",
      firstName: intake.firstName || "",
      middleName: intake.middleName || "",
      surname: intake.surname || "",
      secondApplicantName: intake.secondApplicantName || "",
      secondApplicantFirstName: intake.secondApplicantFirstName || "",
      secondApplicantMiddleName: intake.secondApplicantMiddleName || "",
      secondApplicantSurname: intake.secondApplicantSurname || "",
      secondApplicantDateOfBirth: intake.secondApplicantDateOfBirth || "",
      secondApplicantMobile: intake.secondApplicantMobile || "",
      secondApplicantEmail: intake.secondApplicantEmail || "",
      secondApplicantResidencyStatus: intake.secondApplicantResidencyStatus || "",
      secondApplicantVisaSubclass: intake.secondApplicantVisaSubclass || "",
      secondApplicantMaritalStatus: intake.secondApplicantMaritalStatus || "",
      secondApplicantDependants: intake.secondApplicantDependants || "",
      secondApplicantAddress: intake.secondApplicantAddress || "",
      secondApplicantCurrentSuburb: intake.secondApplicantCurrentSuburb || "",
      secondApplicantCurrentState: intake.secondApplicantCurrentState || "",
      secondApplicantCurrentAddressFromDate: intake.secondApplicantCurrentAddressFromDate || "",
      secondApplicantCurrentResidentialStatus: intake.secondApplicantCurrentResidentialStatus || "",
      secondApplicantPreviousAddress: intake.secondApplicantPreviousAddress || "",
      secondApplicantPreviousSuburb: intake.secondApplicantPreviousSuburb || "",
      secondApplicantPreviousState: intake.secondApplicantPreviousState || "",
      secondApplicantPreviousPostcode: intake.secondApplicantPreviousPostcode || "",
      secondApplicantPreviousResidentialStatus: intake.secondApplicantPreviousResidentialStatus || "",
      secondApplicantEmploymentType: intake.secondApplicantEmploymentType || "",
      secondApplicantEmployerName: intake.secondApplicantEmployerName || "",
      secondApplicantBusinessAddress: intake.secondApplicantBusinessAddress || "",
      secondApplicantJobTitle: intake.secondApplicantJobTitle || "",
      secondApplicantEmploymentBasis: intake.secondApplicantEmploymentBasis || "",
      secondApplicantEmploymentFromDate: intake.secondApplicantEmploymentFromDate || "",
      secondApplicantEmploymentContactName: intake.secondApplicantEmploymentContactName || "",
      secondApplicantEmploymentContactNumber: intake.secondApplicantEmploymentContactNumber || "",
      secondApplicantPreviousBusinessName: intake.secondApplicantPreviousBusinessName || "",
      secondApplicantPreviousJobTitle: intake.secondApplicantPreviousJobTitle || "",
      secondApplicantPreviousEmploymentBasis: intake.secondApplicantPreviousEmploymentBasis || "",
      secondApplicantPreviousEmploymentFromDate: intake.secondApplicantPreviousEmploymentFromDate || "",
      secondApplicantPreviousEmploymentToDate: intake.secondApplicantPreviousEmploymentToDate || "",
      mobile: intake.mobile || "",
      email: intake.email || "",
      loanScenario: intake.loanScenario || deriveLoanScenario(intake.loanType, intake.loanPurpose),
      loanType: intake.loanType || "",
      loanPurpose: intake.loanPurpose || "",
      loanAmount: intake.loanAmount || "",
      propertyValue: intake.propertyValue || "",
      depositEquity: intake.depositEquity || "",
      propertyLocation: intake.propertyLocation || "",
      annualIncome: intake.annualIncome || "",
      secondAnnualIncome: intake.secondAnnualIncome || "",
      hemMonthly: intake.hemMonthly || "",
      financialAssetBuffer: intake.financialAssetBuffer || "",
      clientNotes: intake.clientNotes || ""
    };
    const fullEdit = { ...emptySubmissionEdit, ...intake, ...nextEdit };
    setSelectedIntakeId(intake.id);
    setSubmissionEdit(fullEdit);
    setSavedSubmissionEdit(fullEdit);
    setMessage(`Opened Loan Form record for ${intake.clientName || "this client"}. Review and edit it below.`);
    setTimeout(() => submissionEditorRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 0);
  }

  async function saveIntakeEdits() {
    if (!selectedIntake) return;
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const payload = {
        ...submissionEdit,
        middleName: "",
        secondApplicantMiddleName: "",
        loanScenario: submissionEdit.loanScenario || deriveLoanScenario(submissionEdit.loanType, submissionEdit.loanPurpose),
        clientName: composeLegalName(submissionEdit.firstName, "", submissionEdit.surname, submissionEdit.clientName),
        secondApplicantName: composeLegalName(
          submissionEdit.secondApplicantFirstName,
          "",
          submissionEdit.secondApplicantSurname,
          submissionEdit.secondApplicantName
        )
      };
      await api(`/api/client-intakes/${encodeURIComponent(selectedIntake.id)}`, {
        method: "PATCH",
        body: JSON.stringify({ submission: payload })
      });
      setMessage("Loan Form submission updated.");
      setSubmissionEdit(payload);
      setSavedSubmissionEdit(payload);
      await refreshIntakes();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  function SubmissionEditorActions({ top = false } = {}) {
    return (
      <div className={`actions submission-editor-actions${top ? " submission-editor-actions-top" : ""}`}>
        <span>{submissionDirty ? "Unsaved changes" : "Saved"}</span>
        <button className="primary-button" type="button" disabled={saving || !submissionDirty} onClick={saveIntakeEdits}>{saving ? "Saving..." : "Save changes"}</button>
        <button className="ghost-button" type="button" onClick={() => openLoanFormTemplateLibrary()}><ClipboardList size={14} /> ChatGPT Template</button>
        <button className="ghost-button" type="button" onClick={() => setCaseImportOpen(true)}><UploadCloud size={14} /> Import Case JSON</button>
        <button className="ghost-button" type="button" onClick={() => downloadFactFind(selectedIntake)}><Download size={14} /> Download Fact Find</button>
        <button className="ghost-button" type="button" onClick={() => openEasyFlowForIntake()}><Play size={14} /> Prepare EasyFlow AI</button>
      </div>
    );
  }

  function updateSubmissionField(field, value) {
    setSubmissionEdit((current) => {
      const next = { ...current, [field]: value };
      if (field === "hemMonthly") {
        if (!isFilled(next.generalExpenses)) next.generalExpenses = value;
        if (!isFilled(next.applicant1Expenses)) next.applicant1Expenses = value;
      }
      if (field === "financialAssetBuffer" && !isFilled(next.cashSavingsAmount)) {
        next.cashSavingsAmount = value;
      }
      if (field === "maritalStatus" && /married|defacto/i.test(value || "")) {
        next.hasSecondApplicant = "Yes";
        if (!isFilled(next.secondApplicantMaritalStatus) || /single/i.test(next.secondApplicantMaritalStatus)) {
          next.secondApplicantMaritalStatus = value;
        }
      }
      return next;
    });
  }

  function renderSubmissionField([field, label, type = "text", options = []]) {
    const value = submissionEdit[field] ?? "";
    if (type === "date") {
      return <DateField key={field} label={label} value={value} onChange={(next) => updateSubmissionField(field, next)} />;
    }
    if (type === "select") {
      return (
        <label key={field}>
          {label}
          <select value={value} onChange={(event) => updateSubmissionField(field, event.target.value)}>
            <option value="">Please select</option>
            {options.map((option) => <option key={option} value={option}>{option}</option>)}
          </select>
        </label>
      );
    }
    if (type === "textarea") {
      return (
        <label className="wide-field" key={field}>
          {label}
          <textarea value={value} onChange={(event) => updateSubmissionField(field, event.target.value)} />
        </label>
      );
    }
    return (
      <label className={type === "wide" ? "wide-field" : ""} key={field}>
        {label}
        <input value={value} onChange={(event) => updateSubmissionField(field, event.target.value)} />
      </label>
    );
  }

  function renderLoanCaseManagerGroup(group) {
    const hasSecond = submissionEdit.hasSecondApplicant === "Yes" ||
      /married|defacto/i.test(submissionEdit.maritalStatus || "") ||
      isFilled(submissionEdit.secondApplicantFirstName) ||
      isFilled(submissionEdit.secondApplicantSurname);
    if (group.secondOnly && !hasSecond) return null;
    return (
      <section key={group.title}>
        <h3>{group.title}</h3>
        <div className="note-form-grid">
          {group.fields.map(renderSubmissionField)}
        </div>
      </section>
    );
  }

  function renderDynamicLoanCaseManagerSections() {
    const sections = activeDynamicFields(submissionEdit).reduce((acc, field) => {
      if (!acc[field.section]) acc[field.section] = [];
      acc[field.section].push(field);
      return acc;
    }, {});
    return Object.entries(sections).map(([section, fields]) => (
      <section key={`dynamic-${section}`}>
        <h3>{section}</h3>
        <div className="note-form-grid">
          {fields.map((field) => (
            <DynamicLoanField
              key={field.key}
              field={field}
              form={submissionEdit}
              language="en"
              onChange={updateSubmissionField}
            />
          ))}
        </div>
      </section>
    ));
  }

  useEffect(() => {
    if (!submissionDirty) return undefined;
    const handleBeforeUnload = (event) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [submissionDirty]);

  const callHasSecondApplicant =
    form.hasSecondApplicant === "Yes" ||
    isFilled(form.secondApplicantFirstName) ||
    isFilled(form.secondApplicantSurname) ||
    isFilled(form.secondApplicantName);
  const normalizedCallForm = useMemo(() => normalizeCallNote(form), [form]);
  const callPath = useMemo(() => callPathProfile(normalizedCallForm), [normalizedCallForm]);
  const callMissingInfo = useMemo(() => dynamicMissingInfo(normalizedCallForm), [normalizedCallForm]);
  const loanActionOptions = actionOptionsForCategory(normalizedCallForm.loanCategory);

  return (
    <main className={`notes-shell ${appThemeClass()} ${isLoanSubmissionsRoute ? "submissions-shell" : ""}`} style={isClientCallHost ? { paddingTop: 46 } : undefined}>
      {isClientCallHost && (
        <div style={{ position: "fixed", top: 0, left: 0, right: 0, height: 46, display: "flex", gap: 6, alignItems: "center", padding: "0 12px", background: "#0B6B4F", zIndex: 50 }}>
          {[["call", "📞 Client Call"], ["prospects", "🧲 Client Prospects"], ["team", "👥 Team & Users"]].map(([key, label]) => (
            <button key={key} type="button" onClick={() => setCcTab(key)}
              style={{ border: 0, borderRadius: 8, padding: "7px 14px", fontWeight: 700, fontSize: 13, cursor: "pointer", background: ccTab === key ? "#fff" : "rgba(255,255,255,.15)", color: ccTab === key ? "#0B6B4F" : "#fff" }}>{label}</button>
          ))}
        </div>
      )}
      {isClientCallHost && ccTab === "prospects" && (
        <iframe title="Client Prospects" src="https://sabrina.easyloanfinance.com.au/prospects"
          style={{ position: "fixed", top: 46, left: 0, right: 0, bottom: 0, width: "100%", height: "calc(100vh - 46px)", border: 0, zIndex: 40, background: "#fff" }} />
      )}
      {isClientCallHost && ccTab === "team" && (
        <iframe title="Team & Users" src="https://sabrina.easyloanfinance.com.au/team"
          style={{ position: "fixed", top: 46, left: 0, right: 0, bottom: 0, width: "100%", height: "calc(100vh - 46px)", border: 0, zIndex: 40, background: "#fff" }} />
      )}
      <aside className="notes-sidebar">
        <SystemBrand appName={isLoanSubmissionsRoute ? "Loan Case Manager" : "Client Call Intake"} />
        <TeamSettingsPanel appName={isLoanSubmissionsRoute ? "Loan Case Manager" : "Client Call Intake"} />
        <label className="note-search">
          Search clients
          <div className="search-input">
            <Search size={16} />
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Name, phone, case" />
          </div>
        </label>
        <div className="note-list">
          {activePanel === "submissions" && !canViewLoanSubmissions ? (
            <div className="case-search-empty">Broker access required.</div>
          ) : activePanel === "submissions" ? (
            filteredIntakes.length ? filteredIntakes.map((intake) => (
              <button className={intake.id === selectedIntakeId ? "active" : ""} key={intake.id} type="button" onClick={() => loadIntake(intake)}>
                <span>{intake.convertedCaseId || intake.callNoteId || intake.id}</span>
                <strong>{[intake.clientName, intake.secondApplicantName].filter(Boolean).join(" & ") || "Unnamed client"}</strong>
                <small>{intake.submittedAt ? `Added ${new Date(intake.submittedAt).toLocaleDateString()}` : "Form link sent"}</small>
              </button>
            )) : <div className="case-search-empty">No loan forms yet.</div>
          ) : (
            filteredNotes.length ? filteredNotes.map((note) => (
              <button className={note.id === selectedId ? "active" : ""} key={note.id} type="button" onClick={() => loadNote(note)}>
                <span>{note.convertedCaseId || note.id}</span>
                <strong>{[note.clientName, note.secondApplicantName].filter(Boolean).join(" & ") || "Unnamed client"}</strong>
                <small>{note.mobile || note.email || note.status}</small>
              </button>
            )) : <div className="case-search-empty">No call notes yet.</div>
          )}
        </div>
      </aside>

      <section className="notes-workspace">
        <header className="topbar">
          <div>
            <span>{activePanel === "submissions" ? "Secure internal management" : "Quick phone intake only"}</span>
            <h1>{activePanel === "submissions" ? "Loan Case Manager" : "Client Call Intake"}</h1>
            <p className="topbar-helper">
              {activePanel === "submissions"
                ? "Broker-only case data hub. Review, edit, export, and prepare clean case data for EasyFlow AI."
                : "Call note is the short phone record. Create case turns it into the internal client file used by Loan Form and EasyFlow AI."}
            </p>
          </div>
          {activePanel === "submissions" && <div className="submission-top-actions">
            <span>Last updated {new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
            <strong>{session?.email || "Broker user"}</strong>
            <button className="ghost-button" type="button" onClick={() => refreshIntakes().catch((err) => setError(err.message))}>Refresh</button>
            <button className="ghost-button" type="button" onClick={() => openLoanFormTemplateLibrary({ copy: true })}>
              <ClipboardList size={16} /> Copy ChatGPT Template
            </button>
            <button className="primary-button" type="button" disabled={!selectedIntake} onClick={() => openEasyFlowForIntake()}>
              <Play size={16} /> Prepare in EasyFlow AI
            </button>
            <button className="ghost-button" type="button" onClick={async () => {
              await api("/api/auth/logout", { method: "POST", body: "{}" }).catch(() => {});
              window.location.href = "/login";
            }}>Logout</button>
          </div>}
          {activePanel === "call" && <div className="actions call-actions">
            <button className="ghost-button quiet-action" type="button" onClick={() => {
              if ((form.clientName || form.mobile || form.email || form.quickNotes) && !window.confirm("Clear the current call intake? Unsaved changes will be lost.")) return;
              setForm(normalizeCallNote(emptyCallNote));
              setRedFlags([]);
              setSelectedId("");
              setMessage("");
              setError("");
            }}>
              New call
            </button>
            <button className="ghost-button" type="button" disabled={saving} onClick={() => saveCallNote()}>
              Save call note
              <small>Phone note only</small>
            </button>
            <button className="primary-button" type="button" disabled={saving || !composeLegalName(form.firstName, "", form.surname, form.clientName).trim()} onClick={() => saveCallNote({ convert: true })}>
              {saving ? <RefreshCw size={17} className="spin" /> : <Play size={17} />}
              {form.intakeToken ? "Copy Loan Form Link" : "Create Loan Form Link"}
              <small>{form.intakeToken ? "Uses existing linked form" : "Creates case + copies link"}</small>
            </button>
            {form.intakeToken && (
              <span className="linked-form-status">
                {loanFormStatus(form)} · {loanFormLinkDetail(form)}
              </span>
            )}
          </div>}
        </header>
        {error && <div className="error-banner">{error}</div>}
        {message && <div className="success-banner">{message}</div>}
        <SessionWarning session={session} />

        {activePanel === "submissions" ? (
          <div className="submission-management">
            <section className="panel note-panel recent-note-panel">
              <div className="panel-title"><FileJson size={18} /><h2>Loan Cases</h2></div>
              <p className="panel-helper inbox-helper">Canonical case records linked with Client Call Intake, Loan Form, and EasyFlow AI. Open data, export files, and prepare clean payloads for Infinity/AOL.</p>
              {canViewLoanSubmissions ? (
                <>
                {!search.trim() && <div className="submission-smart-groups">
                  <section>
                    <h3>Newly added</h3>
                    <div>
                      {newlyAddedIntakes.length ? newlyAddedIntakes.map((intake) => (
                        <button key={`new-${intake.id}`} type="button" onClick={() => loadIntake(intake)}>
                          <strong>{[intake.clientName, intake.secondApplicantName].filter(Boolean).join(" & ") || "Unnamed client"}</strong>
                          <span>{intakeSourceLabel(intake)} | {intake.submittedAt ? new Date(intake.submittedAt).toLocaleString() : "Form link sent"}</span>
                        </button>
                      )) : <span>No records yet.</span>}
                    </div>
                  </section>
                  <section>
                    <h3>Recently edited</h3>
                    <div>
                      {recentlyEditedIntakes.length ? recentlyEditedIntakes.map((intake) => (
                        <button key={`edit-${intake.id}`} type="button" onClick={() => loadIntake(intake)}>
                          <strong>{[intake.clientName, intake.secondApplicantName].filter(Boolean).join(" & ") || "Unnamed client"}</strong>
                          <span>{intakeSourceLabel(intake)} | {intake.lastSavedAt ? `Edited ${new Date(intake.lastSavedAt).toLocaleString()}` : `Updated ${new Date(intake.updatedAt).toLocaleString()}`}</span>
                        </button>
                      )) : <span>No edits yet.</span>}
                    </div>
                  </section>
                </div>}
                <div className="recent-note-list submission-list">
                  {filteredIntakes.length ? filteredIntakes.map((intake) => (
                    <div className={`submission-row${intake.id === selectedIntakeId ? " selected-submission" : ""}`} key={intake.id}>
                      <button className="submission-row-main" type="button" onClick={() => loadIntake(intake)}>
                        <span className="submission-client-cell">
                          <strong>{intake.clientName || "Unnamed client"}</strong>
                          <small>{intake.secondApplicantName ? `Second applicant: ${intake.secondApplicantName}` : intake.id}</small>
                          <small>{intakeSourceLabel(intake)} | {intake.convertedCaseId || intake.callNoteId}</small>
                        </span>
                        <span className="submission-contact-cell">
                          <strong>{intake.mobile || "No mobile"}</strong>
                          <small>{intake.email || "No email"}</small>
                        </span>
                        <span className="submission-loan-cell">
                          <strong>{intake.loanScenario || deriveLoanScenario(intake.loanType, intake.loanPurpose) || intake.loanPurpose || "Purpose not set"}</strong>
                          <small>{[intake.loanType || "Loan type not set", intake.loanPurpose].filter(Boolean).join(" | ")} | {currency(Number(intake.loanAmount || 0))}</small>
                        </span>
                        <span>
                          <strong>{intake.lastSavedAt ? "Edited" : "Added"}</strong>
                          <small>{loanFormStatus(intake)} | {intake.lastSavedAt ? new Date(intake.lastSavedAt).toLocaleString() : intake.submittedAt ? new Date(intake.submittedAt).toLocaleString() : `Sent ${new Date(intake.createdAt).toLocaleString()}`}</small>
                          <small>{loanFormLinkDetail(intake)}</small>
                        </span>
                      </button>
                      <div className="submission-row-actions">
                        <button type="button" onClick={() => loadIntake(intake)}>{intake.status === "submitted" ? "Open Submission Review" : "Open Record Review"}</button>
                        <button type="button" onClick={async () => {
                          await navigator.clipboard?.writeText(intake.url).catch(() => {});
                          setMessage(`Existing Loan Form link copied: ${intake.url}`);
                        }}>Copy Loan Form link</button>
                        <button type="button" onClick={() => downloadFactFind(intake)}><Download size={13} /> Fact Find</button>
                        <button type="button" onClick={() => {
                          loadIntake(intake);
                          openEasyFlowForIntake(intake);
                        }}><Play size={13} /> EasyFlow AI</button>
                      </div>
                    </div>
                  )) : <div className="case-search-empty"><strong>No loan form submissions found.</strong><span>When clients submit the loan form, their fact-find details will appear here for broker review.</span></div>}
                </div>
                </>
              ) : (
                <div className="locked-data-panel">
                  <ShieldCheck size={20} />
                  <strong>Broker access required</strong>
                  <span>Loan Form Submissions contain full client fact-find details. Ask Ryan admin to upgrade this user if they need broker access.</span>
                </div>
              )}
            </section>
            {canViewLoanSubmissions && <section className="panel note-panel submission-editor-panel" ref={submissionEditorRef}>
              <div className="panel-title"><FileJson size={18} /><h2>Edit Case Data</h2></div>
              {selectedIntake ? (
                <>
                  <div className="submission-editor-summary">
                    <div>
                      <span className={`status-badge status-${loanFormStatus(selectedIntake).toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}>{loanFormStatus(selectedIntake)}</span>
                      <strong>{submissionEdit.clientName || "Unnamed client"}</strong>
                      <small>{selectedIntake.id} | {selectedIntake.convertedCaseId || selectedIntake.callNoteId}</small>
                    </div>
                    <div>
                      <span>{submissionDirty ? "Unsaved changes" : "Saved"}</span>
                      <small>{selectedIntake.lastSavedAt ? `Last saved ${new Date(selectedIntake.lastSavedAt).toLocaleString()}` : "Not edited yet"}</small>
                      <small>{selectedIntake.lastEditedBy ? `Edited by ${selectedIntake.lastEditedBy}` : "Original client submission"}</small>
                    </div>
                  </div>
                  <SubmissionEditorActions top />
                  {selectedIntake.status !== "submitted" && (
                    <div className="info-banner compact">
                      This is a Loan Form Record only. The full submission fields will appear after the client submits the Loan Form.
                    </div>
                  )}
                  <div className="info-banner compact">
                    <strong>Workflow:</strong> 1. Import Case JSON or wait for the client Loan Form. 2. Review the full Loan Form fields below. 3. Save changes. 4. Download Fact Find or Prepare EasyFlow AI for Infinity/AOL.
                  </div>
                  <div className="submission-editor-sections">
                    <section>
                      <h3>Overview</h3>
                      <div className="submission-meta-grid">
                        <span><strong>Submitted</strong>{selectedIntake.submittedAt ? new Date(selectedIntake.submittedAt).toLocaleString() : "Not submitted yet"}</span>
                        <span><strong>Fact Find</strong>{selectedIntake.factFindExportedAt ? `Exported ${new Date(selectedIntake.factFindExportedAt).toLocaleDateString()}` : "Not exported"}</span>
                        <span><strong>Linked case</strong>{selectedIntake.convertedCaseId || "Not created"}</span>
                        <span><strong>Call note</strong>{selectedIntake.callNoteId || "Not linked"}</span>
                      </div>
                    </section>
                    <section>
                      <h3>Loan form history{Number(selectedIntake.submissionVersion) > 1 ? ` (v${selectedIntake.submissionVersion})` : ""}</h3>
                      {Array.isArray(selectedIntake.lastChangedFields) && selectedIntake.lastChangedFields.length ? (
                        <div className="info-banner compact">
                          <strong>⚠ Client changed {selectedIntake.lastChangedFields.length} field(s) on the last submission:</strong>
                          <ul>
                            {selectedIntake.lastChangedFields.slice(0, 25).map((change, index) => (
                              <li key={index}>{change.field}: <em>{String(change.from || "—")}</em> → <strong>{String(change.to || "—")}</strong></li>
                            ))}
                          </ul>
                        </div>
                      ) : (
                        <div className="submission-meta-grid"><span>No client re-submissions yet — this is the original version.</span></div>
                      )}
                      {Array.isArray(selectedIntake.submissionHistory) && selectedIntake.submissionHistory.length ? (
                        <details>
                          <summary>{selectedIntake.submissionHistory.length} earlier version(s)</summary>
                          <ul>
                            {selectedIntake.submissionHistory.slice().reverse().map((entry, index) => (
                              <li key={index}>v{entry.version} — {entry.submittedAt ? new Date(entry.submittedAt).toLocaleString() : "unknown date"}</li>
                            ))}
                          </ul>
                        </details>
                      ) : null}
                    </section>
                    <section>
                      <h3>Broker edits (synced from Infinity / AOL)</h3>
                      {Array.isArray(selectedIntake.brokerEdits) && selectedIntake.brokerEdits.length ? (
                        <>
                          <div className="info-banner compact"><strong>Values you changed on Infinity/AOL, synced back to EasyFlow (live source).</strong> The loan form above stays the client's original — these are the broker layer.</div>
                          <div className="submission-meta-grid">
                            {selectedIntake.brokerEdits.map((edit, index) => (
                              <span key={index}><strong>{edit.label || "field"}{edit.platform ? ` (${edit.platform})` : ""}</strong>{String(edit.value || "—")}{edit.at ? ` · ${new Date(edit.at).toLocaleString()}` : ""}</span>
                            ))}
                          </div>
                        </>
                      ) : (
                        <div className="submission-meta-grid"><span>No broker edits captured from Infinity/AOL yet.</span></div>
                      )}
                    </section>
                    <section>
                      <h3>Applicant</h3>
                      <div className="note-form-grid">
                        <label>Primary given name(s)<input value={submissionEdit.firstName} onChange={(event) => setSubmissionEdit({ ...submissionEdit, firstName: event.target.value })} /></label>
                        <label>Primary surname<input value={submissionEdit.surname} onChange={(event) => setSubmissionEdit({ ...submissionEdit, surname: event.target.value })} /></label>
                        <label>Second given name(s)<input value={submissionEdit.secondApplicantFirstName} onChange={(event) => setSubmissionEdit({ ...submissionEdit, secondApplicantFirstName: event.target.value })} /></label>
                        <label>Second surname<input value={submissionEdit.secondApplicantSurname} onChange={(event) => setSubmissionEdit({ ...submissionEdit, secondApplicantSurname: event.target.value })} /></label>
                        {composeLegalName(submissionEdit.secondApplicantFirstName, "", submissionEdit.secondApplicantSurname, submissionEdit.secondApplicantName) && <>
                          <label>Second applicant DOB<input value={submissionEdit.secondApplicantDateOfBirth} onChange={(event) => setSubmissionEdit({ ...submissionEdit, secondApplicantDateOfBirth: event.target.value })} /></label>
                          <label>Second applicant mobile<input value={submissionEdit.secondApplicantMobile} onChange={(event) => setSubmissionEdit({ ...submissionEdit, secondApplicantMobile: event.target.value })} /></label>
                          <label>Second applicant email<input value={submissionEdit.secondApplicantEmail} onChange={(event) => setSubmissionEdit({ ...submissionEdit, secondApplicantEmail: event.target.value })} /></label>
                          <label>Second residency<input value={submissionEdit.secondApplicantResidencyStatus} onChange={(event) => setSubmissionEdit({ ...submissionEdit, secondApplicantResidencyStatus: event.target.value })} /></label>
                          <label>Second visa<input value={submissionEdit.secondApplicantVisaSubclass} onChange={(event) => setSubmissionEdit({ ...submissionEdit, secondApplicantVisaSubclass: event.target.value })} /></label>
                          <label>Second employment<input value={submissionEdit.secondApplicantEmploymentType} onChange={(event) => setSubmissionEdit({ ...submissionEdit, secondApplicantEmploymentType: event.target.value })} /></label>
                          <label>Second employer<input value={submissionEdit.secondApplicantEmployerName} onChange={(event) => setSubmissionEdit({ ...submissionEdit, secondApplicantEmployerName: event.target.value })} /></label>
                          <label>Second job title<input value={submissionEdit.secondApplicantJobTitle} onChange={(event) => setSubmissionEdit({ ...submissionEdit, secondApplicantJobTitle: event.target.value })} /></label>
                        </>}
                      </div>
                    </section>
                    <section>
                      <h3>Contact</h3>
                      <div className="note-form-grid">
                        <label>Mobile<input value={submissionEdit.mobile} onChange={(event) => setSubmissionEdit({ ...submissionEdit, mobile: event.target.value })} /></label>
                        <label>Email<input value={submissionEdit.email} onChange={(event) => setSubmissionEdit({ ...submissionEdit, email: event.target.value })} /></label>
                      </div>
                    </section>
                    <section>
                      <h3>Loan Request</h3>
                      <div className="note-form-grid">
                        <label>Loan scenario<select value={submissionEdit.loanScenario} onChange={(event) => setSubmissionEdit({ ...submissionEdit, loanScenario: event.target.value })}>
                          <option value="">Select scenario</option>
                          {loanScenarioOptions.includes(submissionEdit.loanScenario) || !submissionEdit.loanScenario ? null : <option value={submissionEdit.loanScenario}>{submissionEdit.loanScenario}</option>}
                          {loanScenarioOptions.map((option) => <option key={option} value={option}>{option}</option>)}
                        </select></label>
                        <label>Loan type<input value={submissionEdit.loanType} onChange={(event) => setSubmissionEdit({ ...submissionEdit, loanType: event.target.value })} /></label>
                        <label>Loan purpose<input value={submissionEdit.loanPurpose} onChange={(event) => setSubmissionEdit({ ...submissionEdit, loanPurpose: event.target.value })} /></label>
                        <label>Loan amount<input value={submissionEdit.loanAmount} onChange={(event) => setSubmissionEdit({ ...submissionEdit, loanAmount: event.target.value })} /></label>
                      </div>
                    </section>
                    <section>
                      <h3>Property / Security</h3>
                      <div className="note-form-grid">
                        <label>Property value<input value={submissionEdit.propertyValue} onChange={(event) => setSubmissionEdit({ ...submissionEdit, propertyValue: event.target.value })} /></label>
                        <label>Deposit/equity<input value={submissionEdit.depositEquity} onChange={(event) => setSubmissionEdit({ ...submissionEdit, depositEquity: event.target.value })} /></label>
                        <label className="wide-field">Property/location<input value={submissionEdit.propertyLocation} onChange={(event) => setSubmissionEdit({ ...submissionEdit, propertyLocation: event.target.value })} /></label>
                      </div>
                    </section>
                    <section>
                      <h3>Income & Servicing Snapshot</h3>
                      <div className="note-form-grid">
                        <label>Annual income<input value={submissionEdit.annualIncome} onChange={(event) => setSubmissionEdit({ ...submissionEdit, annualIncome: event.target.value })} /></label>
                        <label>Second income<input value={submissionEdit.secondAnnualIncome} onChange={(event) => setSubmissionEdit({ ...submissionEdit, secondAnnualIncome: event.target.value })} /></label>
                        <label>HEM monthly<input value={submissionEdit.hemMonthly} onChange={(event) => updateSubmissionField("hemMonthly", event.target.value)} /></label>
                        <label>Financial assets<input value={submissionEdit.financialAssetBuffer} onChange={(event) => updateSubmissionField("financialAssetBuffer", event.target.value)} /></label>
                      </div>
                    </section>
                    {loanCaseManagerGroups.map(renderLoanCaseManagerGroup)}
                    {renderDynamicLoanCaseManagerSections()}
                    <section>
                      <h3>Notes</h3>
                      <div className="note-form-grid">
                        <label className="wide-field">Client notes<textarea value={submissionEdit.clientNotes} onChange={(event) => setSubmissionEdit({ ...submissionEdit, clientNotes: event.target.value })} /></label>
                      </div>
                    </section>
                  </div>
                  <SubmissionEditorActions />
                  {caseImportWarning && <div className="info-banner compact">{caseImportWarning}</div>}
                </>
              ) : (
                <div className="case-search-empty">Select a submission to review and edit client information.</div>
              )}
            </section>}
          </div>
        ) : (
        <div className="notes-grid">
          <div className="info-banner compact call-workflow-guide">
            <strong>Call workflow:</strong> Save call note for quick phone records. Use Create Loan Form Link when the client should complete the full Loan Form. The linked case then appears in Loan Case Manager and EasyFlow AI.
          </div>
          <section className="panel note-panel call-contact-panel">
            <div className="panel-title"><ClipboardList size={18} /><h2>Call Contact</h2></div>
            <p className="panel-helper inbox-helper">Only capture the client details needed to triage the call. Full fact-find stays in Loan Form.</p>
            <div className="note-form-grid">
              <label>First / given name(s)<input value={form.firstName} onChange={(event) => updateField("firstName", event.target.value)} placeholder="Main applicant" /></label>
              <label>Last name / surname<input value={form.surname} onChange={(event) => updateField("surname", event.target.value)} /></label>
              <label>Second applicant?<select value={callHasSecondApplicant ? "Yes" : "No"} onChange={(event) => updateSecondApplicantChoice(event.target.value)}><option>No</option><option>Yes</option></select></label>
              {callHasSecondApplicant && (
                <div className="call-second-applicant-inline">
                  <div className="call-key-detail-heading">
                    <strong>Second applicant details</strong>
                    <span>This section appears immediately when you choose Yes so the co-borrower can be captured here instead of hunting for another panel.</span>
                  </div>
                  <div className="note-form-grid compact-inline-grid">
                    <label>Given name(s)<input value={form.secondApplicantFirstName} onChange={(event) => updateField("secondApplicantFirstName", event.target.value)} placeholder="As shown on ID" /></label>
                    <label>Surname<input value={form.secondApplicantSurname} onChange={(event) => updateField("secondApplicantSurname", event.target.value)} /></label>
                    <DateField label="DOB" value={form.secondApplicantDateOfBirth} onChange={(value) => updateField("secondApplicantDateOfBirth", value)} />
                    <label>Gender<select value={form.secondApplicantGender} onChange={(event) => updateField("secondApplicantGender", event.target.value)}><option value="">Please select</option>{genderOptions.map((option) => <option key={option}>{option}</option>)}</select></label>
                    <label>Mobile<input value={form.secondApplicantMobile} onChange={(event) => updateField("secondApplicantMobile", event.target.value)} placeholder="Leave blank if same contact" /></label>
                    <label>Email<input value={form.secondApplicantEmail} onChange={(event) => updateField("secondApplicantEmail", event.target.value)} placeholder="Leave blank if same email" /></label>
                    <label>Address<input value={form.secondApplicantAddress} onChange={(event) => updateField("secondApplicantAddress", event.target.value)} placeholder="Leave blank if same address" /></label>
                    <label>Residency<select value={form.secondApplicantResidencyStatus || "Australian citizen"} onChange={(event) => updateField("secondApplicantResidencyStatus", event.target.value)}>{residencyOptions.map((option) => <option key={option}>{option}</option>)}</select></label>
                    <label>Permanent in Australia<select value={form.secondApplicantPermanentInAustralia} onChange={(event) => updateField("secondApplicantPermanentInAustralia", event.target.value)}>{yesNoOptions.map((option) => <option key={option}>{option}</option>)}</select></label>
                    <label>Marital<select value={form.secondApplicantMaritalStatus || form.maritalStatus} onChange={(event) => updateField("secondApplicantMaritalStatus", event.target.value)}><option>Single</option><option>Married</option><option>Defacto</option><option>Separated</option></select></label>
                    <label>Dependants<input value={form.secondApplicantDependants || "0"} onChange={(event) => updateField("secondApplicantDependants", event.target.value)} /></label>
                    <label>Driver licence no.<input value={form.secondApplicantDriversLicenceNo} onChange={(event) => updateField("secondApplicantDriversLicenceNo", event.target.value)} /></label>
                    <DateField label="Licence expiry" value={form.secondApplicantLicenceExpiryDate} onChange={(value) => updateField("secondApplicantLicenceExpiryDate", value)} />
                    <label>Licence state<select value={form.secondApplicantLicenceState} onChange={(event) => updateField("secondApplicantLicenceState", event.target.value)}><option value="">Please select</option>{licenceStateOptions.map((option) => <option key={option}>{option}</option>)}</select></label>
                    <label>Licence class<input value={form.secondApplicantLicenceClass} onChange={(event) => updateField("secondApplicantLicenceClass", event.target.value)} placeholder="C" /></label>
                    <label>Income p.a.<input value={form.secondAnnualIncome} onChange={(event) => updateField("secondAnnualIncome", event.target.value)} /></label>
                    <label>Employer<input value={form.secondApplicantEmployerName} onChange={(event) => updateField("secondApplicantEmployerName", event.target.value)} /></label>
                    <label>Occupation<input value={form.secondApplicantJobTitle} onChange={(event) => updateField("secondApplicantJobTitle", event.target.value)} /></label>
                  </div>
                </div>
              )}
              <label>Mobile<input value={form.mobile} onChange={(event) => updateField("mobile", event.target.value)} /></label>
              <label>Email<input value={form.email} onChange={(event) => updateField("email", event.target.value)} /></label>
              <label>Language<select value={form.preferredLanguage} onChange={(event) => updateField("preferredLanguage", event.target.value)}><option>Vietnamese / English</option><option>English</option><option>Vietnamese</option></select></label>
              <label>Source<input value={form.sourceChannel} onChange={(event) => updateField("sourceChannel", event.target.value)} placeholder="Referral, Facebook, website" /></label>
              <label className="wide-field">Quick call note<textarea value={form.quickNotes} onChange={(event) => updateField("quickNotes", event.target.value)} placeholder="What client said on the call" /></label>
            </div>
          </section>

          <section className="panel note-panel call-path-panel">
            <div className="panel-title"><FileJson size={18} /><h2>Loan Path</h2></div>
            <p className="panel-helper inbox-helper">Choose the main path first. The old loan type, purpose, and scenario are mapped automatically on save.</p>
            <div className="note-form-grid">
              <label className="wide-field">Loan category<select value={normalizedCallForm.loanCategory} onChange={(event) => updateField("loanCategory", event.target.value)}>{loanCategoryOptions.map((option) => <option key={option}>{option}</option>)}</select></label>
              <label>Loan action<select value={normalizedCallForm.loanAction} onChange={(event) => updateField("loanAction", event.target.value)}>{loanActionOptions.map((option) => <option key={option}>{option}</option>)}</select></label>
              {callPath.showOccupancy && (
                <label>Occupancy<select value={normalizedCallForm.occupancy} onChange={(event) => updateField("occupancy", event.target.value)}>{occupancyOptions.map((option) => <option key={option}>{option}</option>)}</select></label>
              )}
              {callPath.showLoanAmount && <label>{callPath.asset ? "Amount required" : "Loan amount"}<input value={form.loanAmount} onChange={(event) => updateField("loanAmount", event.target.value)} placeholder="390000" /></label>}
              {callPath.showPropertyValue && <label>{callPath.refinanceLike ? "Estimated property value" : "Property value"}<input value={form.propertyValue} onChange={(event) => updateField("propertyValue", event.target.value)} /></label>}
              {callPath.showDepositEquity && <label>Deposit/equity<input value={normalizedCallForm.depositOrEquity} onChange={(event) => updateField("depositOrEquity", event.target.value)} /></label>}
              {callPath.showExistingLoanBalance && (
                <label>Existing loan balance<input value={form.existingLoanBalance} onChange={(event) => updateField("existingLoanBalance", event.target.value)} /></label>
              )}
              {callPath.showPropertyLocation && <label>Property suburb/state<input value={form.propertyLocation} onChange={(event) => updateField("propertyLocation", event.target.value)} /></label>}
              {callPath.showTimeline && <label>Timeline<input value={form.timeline} onChange={(event) => updateField("timeline", event.target.value)} placeholder="ASAP, 3 months, pre-approval" /></label>}
              {callPath.showUseOfFunds && <label className="wide-field">Use of funds / client objective<textarea value={form.loanUseDescription} onChange={(event) => updateField("loanUseDescription", event.target.value)} placeholder="Short plain-English reason for the loan" /></label>}
            </div>

            {normalizedCallForm.loanCategory === "Commercial Property Loan" && (
              <div className="dynamic-loan-panel">
                <div className="note-form-grid">
                  <label>Borrower type<select value={form.borrowerType} onChange={(event) => updateField("borrowerType", event.target.value)}>{borrowerTypeOptions.map((option) => <option key={option}>{option}</option>)}</select></label>
                  <label>Security type<select value={form.securityType} onChange={(event) => updateField("securityType", event.target.value)}>{securityTypeOptions.map((option) => <option key={option}>{option}</option>)}</select></label>
                  <label>Property address<input value={form.propertyAddress} onChange={(event) => updateField("propertyAddress", event.target.value)} /></label>
                  <label>Rental/lease income<input value={form.rentalLeaseIncome} onChange={(event) => updateField("rentalLeaseIncome", event.target.value)} /></label>
                  <label>Lease remaining<input value={form.leaseRemainingTerm} onChange={(event) => updateField("leaseRemainingTerm", event.target.value)} /></label>
                  <label>ABN/ACN/entity<input value={form.abnAcn} onChange={(event) => updateField("abnAcn", event.target.value)} /></label>
                </div>
              </div>
            )}

            {normalizedCallForm.loanCategory === "Business Finance" && (
              <div className="dynamic-loan-panel">
                <div className="note-form-grid">
                  <label>Business name<input value={form.businessName} onChange={(event) => updateField("businessName", event.target.value)} /></label>
                  <label>ABN/ACN<input value={form.abnAcn} onChange={(event) => updateField("abnAcn", event.target.value)} /></label>
                  <label>Trading history<input value={form.tradingHistory} onChange={(event) => updateField("tradingHistory", event.target.value)} /></label>
                  <label>Monthly turnover<input value={form.monthlyTurnover} onChange={(event) => updateField("monthlyTurnover", event.target.value)} /></label>
                  <label>GST registered<select value={form.gstRegistered} onChange={(event) => updateField("gstRegistered", event.target.value)}>{yesNoOptions.map((option) => <option key={option}>{option}</option>)}</select></label>
                  <label>Existing business debts<input value={form.existingBusinessDebts} onChange={(event) => updateField("existingBusinessDebts", event.target.value)} /></label>
                </div>
              </div>
            )}

            {normalizedCallForm.loanCategory === "Asset / Car / Equipment Finance" && (
              <div className="dynamic-loan-panel">
                <div className="note-form-grid">
                  <label>Asset type<input value={form.assetType} onChange={(event) => updateField("assetType", event.target.value)} placeholder="Car, truck, equipment" /></label>
                  <label>New or used<select value={form.assetCondition} onChange={(event) => updateField("assetCondition", event.target.value)}><option>New</option><option>Used</option><option>Unknown</option></select></label>
                  <label>Seller<select value={form.sellerType} onChange={(event) => updateField("sellerType", event.target.value)}><option>Dealer</option><option>Private seller</option><option>Not sure</option></select></label>
                  <label>Business use %<input value={form.businessUsePercent} onChange={(event) => updateField("businessUsePercent", event.target.value)} /></label>
                  <label>ABN if business use<input value={form.abnAcn} onChange={(event) => updateField("abnAcn", event.target.value)} /></label>
                </div>
              </div>
            )}

            {normalizedCallForm.loanCategory === "Private Lending / Specialist Lending" && (
              <div className="dynamic-loan-panel">
                <div className="note-form-grid">
                  <label>Private purpose<select value={form.privatePurpose} onChange={(event) => updateField("privatePurpose", event.target.value)}>{privatePurposeOptions.map((option) => <option key={option}>{option}</option>)}</select></label>
                  <label>Security property<input value={form.propertyAddress} onChange={(event) => updateField("propertyAddress", event.target.value)} /></label>
                  <label>Urgency / settlement date<input value={form.urgency} onChange={(event) => updateField("urgency", event.target.value)} /></label>
                  <label className="wide-field">Exit strategy<textarea value={form.exitStrategy} onChange={(event) => updateField("exitStrategy", event.target.value)} placeholder="Sale, refinance, incoming funds, or other exit" /></label>
                </div>
              </div>
            )}

            {callPath.showScenarioTags && <div className="scenario-tag-row">
              {scenarioTagOptions.map((tag) => (
                <button className={ensureArray(normalizedCallForm.scenarioTags).includes(tag) ? "selected" : ""} key={tag} type="button" onClick={() => toggleScenarioTag(tag)}>
                  {tag}
                </button>
              ))}
            </div>}
          </section>

          <section className="panel note-panel note-text-panel">
            <div className="panel-title"><FileJson size={18} /><h2>Broker Notes</h2></div>
            <div className="note-text-grid">
              <label>Broker assessment<textarea value={form.brokerAssessment} onChange={(event) => updateField("brokerAssessment", event.target.value)} placeholder="Serviceability, red flags, likely lender path" /></label>
              <label>Next action<textarea value={form.nextAction} onChange={(event) => updateField("nextAction", event.target.value)} placeholder="Send intake link, collect payslips, book appointment" /></label>
              <label>Internal note<textarea value={form.existingDebtsSummary} onChange={(event) => updateField("existingDebtsSummary", event.target.value)} placeholder="Debts, risk, document requests" /></label>
            </div>
          </section>

          <section className="panel note-panel call-summary-panel">
            <div className="panel-title"><ShieldCheck size={18} /><h2>Call Summary</h2></div>
            <div className="call-summary-card">
              <div><span>Client</span><strong>{composeLegalName(form.firstName, "", form.surname, form.clientName) || "Not set"}</strong></div>
              <div><span>Mobile</span><strong>{form.mobile || "Not set"}</strong></div>
              <div><span>Category</span><strong>{normalizedCallForm.loanCategory}</strong></div>
              <div><span>Action</span><strong>{normalizedCallForm.loanAction}</strong></div>
              <div><span>Scenario</span><strong>{normalizedCallForm.loanScenario || "Not mapped"}</strong></div>
              <div><span>Amount</span><strong>{form.loanAmount || "Not set"}</strong></div>
            </div>
            {callMissingInfo.length ? (
              <div className="call-missing-info">Missing before Loan Form: {callMissingInfo.join(", ")}</div>
            ) : (
              <div className="call-ready-info">Ready to create the Loan Form link.</div>
            )}
          </section>

          <section className="panel note-panel">
            <div className="panel-title"><ShieldCheck size={18} /><h2>Quick Triage</h2></div>
            <p className="panel-helper">Only ask enough to decide the next action. The full fact-find belongs in the Loan Form.</p>
            <div className="note-form-grid">
              <label>Employment<select value={form.employmentType} onChange={(event) => updateField("employmentType", event.target.value)}><option>PAYG</option><option>Self-employed</option><option>Casual</option><option>Contractor</option><option>Unemployed</option></select></label>
              <label>Rough income p.a.<input value={form.annualIncome} onChange={(event) => updateField("annualIncome", event.target.value)} placeholder="Rough income is OK" /></label>
              <label>Living expense monthly<input value={form.hemMonthly} onChange={(event) => updateField("hemMonthly", event.target.value)} placeholder="Only if known" /></label>
              <label>Savings/assets<input value={form.financialAssetBuffer} onChange={(event) => updateField("financialAssetBuffer", event.target.value)} /></label>
              <label>Credit issue<select value={form.creditIssue} onChange={(event) => updateField("creditIssue", event.target.value)}><option>Unknown</option><option>No</option><option>Unsure</option><option>Yes</option></select></label>
            </div>
            <div className="red-flag-row">
              {redFlagOptions.map((flag) => (
                <button className={redFlags.includes(flag) ? "selected" : ""} key={flag} type="button" onClick={() => toggleRedFlag(flag)}>
                  {flag}
                </button>
              ))}
            </div>
          </section>

          <details className="panel note-panel call-key-details-panel optional-borrower-details" open={callHasSecondApplicant || undefined}>
            <summary><ShieldCheck size={18} /><strong>Optional Borrower Details</strong><span>{callHasSecondApplicant ? "Main applicant details stay here. Second applicant details now appear above as soon as Yes is selected." : "Open only if the client gives ID, address, income, or spouse details during the call."}</span></summary>
            <div className="call-key-detail-groups">
              <div className="call-key-detail-group">
                <div className="call-key-detail-heading">
                  <strong>Main applicant</strong>
                  <span>Primary contact and borrower information.</span>
                </div>
                <div className="note-form-grid">
                  <DateField label="DOB" value={form.dateOfBirth} onChange={(value) => updateField("dateOfBirth", value)} />
                  <label>Gender<select value={form.gender} onChange={(event) => updateField("gender", event.target.value)}><option value="">Please select</option>{genderOptions.map((option) => <option key={option}>{option}</option>)}</select></label>
                  <label>Address<input value={form.address} onChange={(event) => updateField("address", event.target.value)} /></label>
                  <label>Residency<select value={form.residencyStatus} onChange={(event) => updateField("residencyStatus", event.target.value)}>{residencyOptions.map((option) => <option key={option}>{option}</option>)}</select></label>
                  <label>Permanent in Australia<select value={form.permanentInAustralia} onChange={(event) => updateField("permanentInAustralia", event.target.value)}>{yesNoOptions.map((option) => <option key={option}>{option}</option>)}</select></label>
                  <label>Marital<select value={form.maritalStatus} onChange={(event) => updateMaritalStatus(event.target.value)}><option>Single</option><option>Married</option><option>Defacto</option><option>Separated</option></select></label>
                  <label>Dependants<input value={form.dependants} onChange={(event) => updateField("dependants", event.target.value)} /></label>
                  <label>Current housing situation<select value={form.currentResidentialStatus} onChange={(event) => updateField("currentResidentialStatus", event.target.value)}><option value="">Please select</option>{residentialStatusOptions.map((option) => <option key={option}>{option}</option>)}</select></label>
                  <label>Driver licence no.<input value={form.driversLicenceNo} onChange={(event) => updateField("driversLicenceNo", event.target.value)} /></label>
                  <DateField label="Licence expiry" value={form.licenceExpiryDate} onChange={(value) => updateField("licenceExpiryDate", value)} />
                  <label>Licence state<select value={form.licenceState} onChange={(event) => updateField("licenceState", event.target.value)}><option value="">Please select</option>{licenceStateOptions.map((option) => <option key={option}>{option}</option>)}</select></label>
                  <label>Licence class<input value={form.licenceClass} onChange={(event) => updateField("licenceClass", event.target.value)} placeholder="C" /></label>
                  <label>Employer<input value={form.employerName} onChange={(event) => updateField("employerName", event.target.value)} /></label>
                  <label>Occupation<input value={form.occupation} onChange={(event) => updateField("occupation", event.target.value)} /></label>
                </div>
              </div>
            </div>
          </details>

          <section className="panel note-panel recent-note-panel">
            <div className="panel-title"><History size={18} /><h2>Client Call Intake Data</h2></div>
            <p className="panel-helper inbox-helper">Short phone records for team visibility. Save calls, create or copy the linked Loan Form, then manage full data in Loan Case Manager.</p>
            <div className="recent-note-list">
              {filteredNotes.length ? filteredNotes.map((note) => (
                <div key={`row-${note.id}`}>
                  <button type="button" onClick={() => loadNote(note)}>
                    <strong>{[note.clientName, note.secondApplicantName].filter(Boolean).join(" & ") || "Unnamed client"}</strong>
                    <span>{note.convertedCaseId || note.status} | {new Date(note.updatedAt || note.createdAt).toLocaleString()}</span>
                    <small>{loanFormStatus(note)} · {loanFormLinkDetail(note)}</small>
                  </button>
                  <div>
                    {!note.intakeToken && <button type="button" onClick={() => convertSelected(note)}>Create Linked Loan Form</button>}
                    <button type="button" onClick={() => createIntakeLink(note)}>{note.intakeToken ? "Copy Existing Loan Form Link" : "Create & Copy Loan Form Link"}</button>
                    {note.convertedCaseId && <button type="button" onClick={() => onOpenAutofill?.(note.convertedCaseId)}>Open EasyFlow AI</button>}
                    <button type="button" className="danger-link" onClick={() => deleteNote(note)}>Delete</button>
                  </div>
                </div>
              )) : <div className="case-search-empty">No matching call notes yet.</div>}
            </div>
          </section>

        </div>
        )}
        {caseImportOpen ? (
          <div className="case-import-backdrop" role="dialog" aria-modal="true" aria-label="Import Case JSON">
            <div className="case-import-modal">
              <h2>Import Case JSON</h2>
              <p>Paste ChatGPT-generated case data here. Matching fields will update the selected Loan Case Manager record only. Nothing is submitted automatically.</p>
              <textarea
                value={caseImportJson}
                onChange={(event) => setCaseImportJson(event.target.value)}
                placeholder={`{
  "applicantDetails": {
    "firstName": "Arsalan",
    "surname": "Saleem",
    "dateOfBirth": "29-09-1988"
  },
  "loanDetails": {
    "loanType": "Home loan",
    "loanAmount": "275000"
  }
}`}
              />
              <div className="case-import-actions">
                <button className="ghost-button" type="button" onClick={() => setCaseImportOpen(false)}>Cancel</button>
                <button className="primary-button" type="button" onClick={importCaseJsonIntoSelected}>Import</button>
              </div>
            </div>
          </div>
        ) : null}
        {templateLibraryOpen ? (
          <div className="case-import-backdrop" role="dialog" aria-modal="true" aria-label="Loan Form ChatGPT Template">
            <div className="case-import-modal template-library-modal">
              <h2>Full Loan Form ChatGPT Template</h2>
              <p>Copy this prompt and JSON template into ChatGPT. Paste ChatGPT's completed JSON back into Import Case JSON.</p>
              <textarea readOnly value={loanFormImportTemplate} />
              <div className="case-import-actions">
                <button className="ghost-button" type="button" onClick={() => setTemplateLibraryOpen(false)}>Close</button>
                <button className="primary-button" type="button" onClick={async () => {
                  await navigator.clipboard?.writeText(loanFormImportTemplate).catch(() => {});
                  setMessage("Full Loan Form ChatGPT template copied.");
                }}>Copy template</button>
              </div>
            </div>
          </div>
        ) : null}
      </section>
    </main>
  );
}

function ClientIntakePage({ token, publicForm = false, entry = null }) {
  const [meta, setMeta] = useState(null);
  const [language, setLanguage] = useState("en");
  const [form, setForm] = useState({
    clientName: "",
    firstName: "",
    middleName: "",
    surname: "",
    secondApplicantName: "",
    secondApplicantFirstName: "",
    secondApplicantMiddleName: "",
    secondApplicantSurname: "",
    hasSecondApplicant: "No",
    secondApplicantDateOfBirth: "",
    secondApplicantGender: "",
    secondApplicantPermanentInAustralia: "Yes",
    secondApplicantDriversLicenceNo: "",
    secondApplicantLicenceCardNumber: "",
    secondApplicantLicenceExpiryDate: "",
    secondApplicantLicenceState: "",
    secondApplicantLicenceClass: "C",
    secondApplicantMobile: "",
    secondApplicantEmail: "",
    secondApplicantResidencyStatus: "Australian Citizen",
    secondApplicantVisaSubclass: "",
    secondApplicantMaritalStatus: "Single",
    secondApplicantDependants: "0",
    secondApplicantAddress: "",
    secondApplicantCurrentSuburb: "",
    secondApplicantCurrentState: "",
    secondApplicantCurrentPostcode: "",
    secondApplicantCurrentAddressFromDate: "",
    secondApplicantCurrentResidentialStatus: "",
    secondApplicantPreviousAddress: "",
    secondApplicantPreviousSuburb: "",
    secondApplicantPreviousState: "",
    secondApplicantPreviousPostcode: "",
    secondApplicantPreviousResidentialStatus: "",
    secondApplicantEmploymentType: "PAYG",
    secondApplicantEmployerName: "",
    secondApplicantBusinessAddress: "",
    secondApplicantJobTitle: "",
    secondApplicantEmploymentBasis: "",
    secondApplicantEmploymentFromDate: "",
    secondApplicantEmploymentContactName: "",
    secondApplicantEmploymentContactNumber: "",
    secondApplicantPreviousBusinessName: "",
    secondApplicantPreviousJobTitle: "",
    secondApplicantPreviousEmploymentBasis: "",
    secondApplicantPreviousEmploymentFromDate: "",
    secondApplicantPreviousEmploymentToDate: "",
    mobile: "",
    email: "",
    preferredLanguage: "Vietnamese / English",
    loanType: entry?.type || "Home loan",
    loanPurpose: entry?.purpose || "",
    loanAmount: "",
    propertyValue: "",
    depositEquity: "",
    propertyLocation: "",
    timeline: "",
    dateOfBirth: "",
    gender: "",
    permanentInAustralia: "Yes",
    driversLicenceNo: "",
    licenceCardNumber: "",
    licenceExpiryDate: "",
    licenceState: "",
    licenceClass: "C",
    address: "",
    residencyStatus: "Australian Citizen",
    maritalStatus: "Single",
    dependants: "0",
    dependant1Dob: "",
    dependant2Dob: "",
    dependant3Dob: "",
    dependant4Dob: "",
    currentSuburb: "",
    currentState: "",
    currentPostcode: "",
    currentAddressFromDate: "",
    currentResidentialStatus: "",
    postSettlementAddress: "",
    mailingAddress: "",
    previousAddress: "",
    previousSuburb: "",
    previousState: "",
    previousPostcode: "",
    previousResidentialStatus: "",
    employmentType: "PAYG",
    employerName: "",
    businessAddress: "",
    occupation: "",
    employmentBasis: "",
    employmentFromDate: "",
    employmentContactName: "",
    employmentContactNumber: "",
    previousEmploymentType: "",
    previousBusinessName: "",
    previousBusinessAddress: "",
    previousJobTitle: "",
    previousEmploymentBasis: "",
    previousEmploymentFromDate: "",
    previousEmploymentToDate: "",
    annualIncome: "",
    secondAnnualIncome: "",
    rentalIncomeAnnual: "",
    generalExpenses: "",
    applicant1Expenses: "",
    applicant2Expenses: "",
    applicant1PrivateHealth: "",
    applicant1PrivateHealthAmount: "",
    applicant2PrivateHealth: "",
    applicant2PrivateHealthAmount: "",
    insurancePolicies: "",
    realEstateAssetAddress: "",
    realEstateAssetValue: "",
    cashSavingsAmount: "",
    cashSavingsBank: "",
    motorVehicleModelYear: "",
    motorVehicleValue: "",
    homeContentsItem: "",
    homeContentsValue: "",
    existingDebtsSummary: "",
    creditIssue: "No",
    propertyType: "",
    firstHomeBuyer: "",
    fixedRatePreference: "",
    variableRatePreference: "",
    splitLoanPreference: "",
    loanTermYears: "30",
    repaymentType: "Principal and interest",
    ratePreference: "Variable",
    offsetRequested: true,
    hemMonthly: "",
    financialAssetBuffer: "",
    commercialPropertyUse: "",
    businessTradingName: "",
    businessAbnAcn: "",
    businessStructure: "",
    annualBusinessTurnover: "",
    netProfitBeforeTax: "",
    commercialSecurityAddress: "",
    commercialLeaseIncome: "",
    commercialFundsPurpose: "",
    vehicleUse: "",
    vehicleCondition: "",
    saleType: "",
    vehicleDescription: "",
    vehiclePrice: "",
    tradeInDeposit: "",
    currentLender: "",
    currentLoanBalance: "",
    currentRepayment: "",
    refinanceReason: "",
    businessPurpose: "",
    gstRegistered: "",
    yearsTrading: "",
    monthlyTurnover: "",
    propertyFoundStatus: "",
    purchasePrice: "",
    sourceOfDeposit: "",
    contractStatus: "",
    auctionDate: "",
    settlementDate: "",
    financeClauseDate: "",
    propertyUsage: "",
    fhogEligible: "",
    constructionDetails: "",
    currentInterestRate: "",
    currentLoanRepaymentType: "",
    currentRateType: "",
    fixedExpiryDate: "",
    offsetRedrawBalance: "",
    propertyEstimatedValue: "",
    cashOutAmount: "",
    cashOutPurpose: "",
    debtConsolidationDebts: "",
    payoutDetails: "",
    arrearsHistory: "",
    borrowerEntity: "",
    abnAcn: "",
    companyTrustDirectorsGuarantors: "",
    commercialPropertyAddress: "",
    commercialPropertyType: "",
    commercialPurchasePrice: "",
    commercialZoning: "",
    commercialOccupancy: "",
    commercialLeaseDetails: "",
    commercialAnnualRent: "",
    commercialTenantDetails: "",
    currentCommercialLoanDetails: "",
    commercialIncomeEvidence: "",
    commercialFinancialsAvailable: "",
    commercialCashOutPurposeEvidence: "",
    businessLegalName: "",
    entityType: "",
    abnStartDate: "",
    industry: "",
    businessOwnersDirectors: "",
    businessLoanPurpose: "",
    businessLoanAmount: "",
    businessLoanTerm: "",
    businessSecurityType: "",
    existingBusinessDebts: "",
    atoDebtPaymentPlan: "",
    bankStatementsAvailable: "",
    basAvailable: "",
    taxReturnsAvailable: "",
    equipmentQuoteInvoice: "",
    vehicleApplicantType: "",
    vehicleMake: "",
    vehicleModel: "",
    vehicleYear: "",
    vehicleVariant: "",
    vehicleVin: "",
    vehicleRego: "",
    vehicleOdometer: "",
    sellerType: "",
    dealerInvoiceAvailable: "",
    privateSellerDetails: "",
    balloonResidual: "",
    insuranceStatus: "",
    vehicleRefinancePayout: "",
    businessUsePercentage: "",
    chattelMortgageRequired: "",
    personalLoanPurpose: "",
    personalLoanAmount: "",
    personalLoanTerm: "",
    personalSecurityType: "",
    fundingTimeframe: "",
    quoteInvoiceAvailable: "",
    personalDebtConsolidationDetails: "",
    paydayLoans: "",
    bnplUse: "",
    gamblingTransactions: "",
    dishonoursHistory: "",
    hardshipHistory: "",
    recentDeclines: "",
    sourceUrl: "",
    clientNotes: ""
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [importJson, setImportJson] = useState("");
  const [importWarning, setImportWarning] = useState("");

  useEffect(() => {
    document.title = pageTitle();
    document.body.classList.remove("theme-call", "theme-easyflow", "theme-loan-form", "theme-records");
    document.body.classList.add(appThemeClass());
  }, []);
  const [submitted, setSubmitted] = useState(false);
  const [draftRestored, setDraftRestored] = useState(false);
  const draftKey = `elf-loan-form-draft:${publicForm ? entry?.type || location.pathname : token || "public"}`;

  function readDraft() {
    try {
      const raw = localStorage.getItem(draftKey);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  function clearDraft() {
    localStorage.removeItem(draftKey);
    setDraftRestored(false);
  }

  useEffect(() => {
    if (publicForm) {
      const routeDefaults = {
        loanType: entry?.type || "Home loan",
        loanPurpose: entry?.purpose || "Purchase owner occupied dwelling"
      };
      const draft = readDraft();
      setMeta({
        token: "public",
        status: "new",
        submittedAt: null,
        callNoteId: null
      });
      if (draft?.language) setLanguage(draft.language);
      if (draft?.form) setDraftRestored(true);
      setForm((current) => ({
        ...current,
        ...hydrateNameParts({
          ...routeDefaults,
          ...(draft?.form || {})
        })
      }));
      setError("");
      setLoading(false);
      return;
    }

    const endpointToken = publicForm ? "public" : token;
    api(`/api/client-intake/${endpointToken}`)
      .then((result) => {
        setMeta(result);
        const draft = readDraft();
        if (draft?.language) setLanguage(draft.language);
        if (draft?.form) setDraftRestored(true);
        setForm((current) => ({
          ...current,
          ...hydrateNameParts({
            ...Object.fromEntries(Object.entries(result).filter(([, value]) => value !== "" && value !== null)),
            ...(draft?.form || {})
          })
        }));
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [token, publicForm, entry]);

  useEffect(() => {
    if (loading || submitted) return undefined;
    const timeout = setTimeout(() => {
      localStorage.setItem(draftKey, JSON.stringify({
        form,
        language,
        savedAt: new Date().toISOString()
      }));
    }, 600);
    return () => clearTimeout(timeout);
  }, [draftKey, form, language, loading, submitted]);

  function updateField(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function updateMaritalStatus(value) {
    setForm((current) => ({
      ...current,
      maritalStatus: value,
      hasSecondApplicant: current.hasSecondApplicant
    }));
  }

  function importCaseData() {
    setError("");
    setImportWarning("");
    let parsed;
    try {
      parsed = JSON.parse(importJson);
    } catch (err) {
      setError(`Invalid JSON. Please check the pasted case data. ${err.message}`);
      return;
    }
    const { next, importedCount, unknown } = importCaseDataIntoForm(form, parsed);
    setForm(next);
    setMessage(`Case data imported. Please review before submitting. ${importedCount} fields filled.`);
    if (unknown.length) {
      setImportWarning(`Imported known fields. ${unknown.length} unknown fields were added to broker notes: ${unknown.slice(0, 8).map((item) => item.split(":")[0]).join(", ")}${unknown.length > 8 ? "..." : ""}`);
    }
    setImportModalOpen(false);
  }

  const txt = clientFormCopy[language];
  const currentTitle = language === "vi" ? entry?.viTitle || txt.title : entry?.title || txt.title;
  const purposeOptions = purposeOptionsForLoanType(form.loanType);
  const loanProfile = scenarioUiProfile(form);
  const missingFields = buildClientLoanMissingFields(form, language);
  const missingFieldKeys = new Set(missingFields.map((field) => field.key));
  const missingFieldMap = new Map(missingFields.map((field) => [field.key, field.label]));
  const dependantCount = Math.min(Math.max(Number(form.dependants || 0), 0), 4);
  const hasSecondApplicant = form.hasSecondApplicant === "Yes";
  const canImportCaseData = false;
  const L = (label) => tx(label, language);
  const requiredErrorText = (key) => {
    if (!submitAttempted || !missingFieldKeys.has(key)) return "";
    const label = missingFieldMap.get(key) || key;
    return language === "vi" ? `Bắt buộc - vui lòng điền ${label}.` : `Required - please complete ${label}.`;
  };
  const fieldStatus = (key, required = true) => ({
    missing: submitAttempted && missingFieldKeys.has(key),
    errorMessage: requiredErrorText(key),
    required
  });
  const fieldAttrs = (key, required = true) => ({
    "data-loan-field": key,
    "data-required": required ? "true" : undefined,
    "data-missing": submitAttempted && missingFieldKeys.has(key) ? "true" : undefined,
    "data-error": submitAttempted && missingFieldKeys.has(key) ? requiredErrorText(key) : undefined
  });
  const fieldError = (key) => <FieldError message={requiredErrorText(key)} />;
  const sectionMissingCount = (keys) => keys.filter((key) => missingFieldKeys.has(key)).length;
  const sectionTitle = (title, keys = []) => {
    const count = submitAttempted ? sectionMissingCount(keys) : 0;
    return (
      <h2>
        <span>{title}</span>
        {count ? <span className="section-error-badge">{count} {language === "vi" ? "thiếu" : "missing"}</span> : null}
      </h2>
    );
  };

  function focusLoanField(key) {
    const wrapper = document.querySelector(`[data-loan-field="${key}"]`);
    const target = wrapper?.matches?.("input, select, textarea")
      ? wrapper
      : wrapper?.querySelector?.("input, select, textarea");
    wrapper?.classList?.add("field-jump-highlight");
    (target || wrapper)?.scrollIntoView({ behavior: "smooth", block: "center" });
    setTimeout(() => target?.focus?.(), 250);
    setTimeout(() => wrapper?.classList?.remove("field-jump-highlight"), 1800);
  }

  async function submitIntake(event) {
    event.preventDefault();
    setSubmitAttempted(true);
    if (missingFields.length) {
      focusLoanField(missingFields[0].key);
      setError(language === "vi"
        ? `Vui long bo sung ${missingFields.length} muc con thieu. Bam vao tung muc ben duoi de di toi o can dien.`
        : `Please complete ${missingFields.length} missing item${missingFields.length > 1 ? "s" : ""}. Click an item below to jump to that field.`);
      return;
    }
    setSaving(true);
    setError("");
    try {
      const endpointToken = publicForm ? "public" : token;
      const primaryLegalName = composeLegalName(form.firstName, "", form.surname, form.clientName);
      const secondaryLegalName = composeLegalName(
        form.secondApplicantFirstName,
        "",
        form.secondApplicantSurname,
        form.secondApplicantName
      );
      await api(`/api/client-intake/${endpointToken}`, {
        method: "POST",
        body: JSON.stringify({
          ...form,
          middleName: "",
          secondApplicantMiddleName: "",
          clientName: primaryLegalName,
          secondApplicantName: secondaryLegalName,
          sourceUrl: location.href
        })
      });
      clearDraft();
      setSubmitted(true);
      setMessage("");
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <main className={`client-intake-shell ${appThemeClass()}`}><div className="empty-state">Loading loan form...</div></main>;
  if (submitted) {
    return (
      <main className={`client-intake-shell ${appThemeClass()}`}>
        <section className="client-intake-card client-thank-you-card">
          <ClientLoanFormHeader
            title={txt.receivedTitle}
            description={txt.receivedDescription}
            language={language}
          />
          <div className="client-thank-you-body">
            <CheckCircle2 size={42} />
            <div>
              <h2>{txt.nextTitle}</h2>
              <p>{txt.nextBody}</p>
              <p>{txt.disclaimer}</p>
            </div>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className={`client-intake-shell ${appThemeClass()}`}>
      <form className="client-intake-card" noValidate onSubmit={submitIntake}>
        <ClientLoanFormHeader
          title={currentTitle}
          description={txt.intro}
          language={language}
          onLanguageChange={setLanguage}
        />
        {canImportCaseData ? (
          <div className="client-form-top-actions">
            <button className="ghost-button" type="button" onClick={() => setImportModalOpen(true)}>
              <UploadCloud size={16} /> Import Case Data
            </button>
          </div>
        ) : null}
        {error && <div className="error-banner">{error}</div>}
        {message && <div className="success-banner">{message}</div>}
        {importWarning && <div className="info-banner compact">{importWarning}</div>}
        {meta?.status === "submitted" && !message ? <div className="success-banner">{txt.alreadySubmitted}</div> : null}
        {importModalOpen ? (
          <div className="case-import-backdrop" role="dialog" aria-modal="true" aria-label="Import Case Data">
            <div className="case-import-modal">
              <h2>Import Case Data</h2>
              <p>Paste ChatGPT-generated JSON case data. Matching fields will be filled into this form. The form will not submit automatically.</p>
              <textarea
                value={importJson}
                onChange={(event) => setImportJson(event.target.value)}
                placeholder={`{
  "applicantDetails": {
    "firstName": "Arsalan",
    "surname": "Saleem",
    "dateOfBirth": "29-09-1988"
  },
  "loanDetails": {
    "loanType": "Home loan",
    "loanAmount": "275000"
  }
}`}
              />
              <div className="case-import-actions">
                <button className="ghost-button" type="button" onClick={() => setImportModalOpen(false)}>Cancel</button>
                <button className="primary-button" type="button" onClick={importCaseData}>Import</button>
              </div>
            </div>
          </div>
        ) : null}
        {draftRestored ? (
          <div className="draft-banner">
            <span>{L("Saved draft restored on this device.")}</span>
            <button type="button" onClick={() => {
              clearDraft();
              window.location.reload();
            }}>{L("Start fresh")}</button>
          </div>
        ) : null}
        {submitAttempted && missingFields.length ? (
          <div className="missing-data-report">
            <strong>{language === "vi" ? "Missing data report" : "Missing data report"}</strong>
            <p>{language === "vi" ? "Các mục bắt buộc sẽ thay đổi theo loại khoản vay và câu trả lời của khách." : "Mandatory items change by loan type and by the client's answers."}</p>
            <ul>{missingFields.map((field) => (
              <li key={field.key}>
                <button type="button" onClick={() => focusLoanField(field.key)}>{field.label}</button>
              </li>
            ))}</ul>
          </div>
        ) : null}

        <section className="loan-type-strip">
          <div>
            <span>{L("Loan type")}</span>
            <strong>{currentTitle}</strong>
          </div>
          <label {...fieldAttrs("loanType")}>{L("Change loan type")}
            <select value={form.loanType} onChange={(event) => {
              const nextType = event.target.value;
              const nextPurpose = purposeOptionsForLoanType(nextType)[0] || "";
              setForm((current) => ({
                ...current,
                loanType: nextType,
                loanPurpose: nextPurpose,
                loanScenario: deriveLoanScenario(nextType, nextPurpose)
              }));
            }}>
              {loanTypeOptions.map((option) => <option key={option} value={option}>{optionText(option, language)}</option>)}
            </select>
            {fieldError("loanType")}
          </label>
        </section>

        <section>
          {sectionTitle(L("Personal Details"), ["firstName", "surname", "dateOfBirth", "email", "mobile", "maritalStatus", "residencyStatus", "dependants", "secondApplicantFirstName", "secondApplicantSurname", "secondApplicantDateOfBirth", "secondApplicantResidencyStatus"])}
          <div className="client-intake-grid">
            <label {...fieldAttrs("firstName")}>{L("First / given name(s)")}<input required value={form.firstName} onChange={(event) => updateField("firstName", event.target.value)} /><span className="field-help">{L("Enter names exactly as shown on ID. Vietnamese accents are OK.")}</span></label>
            <label {...fieldAttrs("surname")}>{L("Family name / surname")}<input required value={form.surname} onChange={(event) => updateField("surname", event.target.value)} /></label>
            <SelectField language={language} label="Add second applicant" value={hasSecondApplicant ? "Yes" : "No"} onChange={(value) => setForm((current) => ({
              ...current,
              hasSecondApplicant: value,
              secondApplicantName: value === "Yes" ? current.secondApplicantName : "",
              secondApplicantFirstName: value === "Yes" ? current.secondApplicantFirstName : "",
              secondApplicantSurname: value === "Yes" ? current.secondApplicantSurname : "",
              secondApplicantDateOfBirth: value === "Yes" ? current.secondApplicantDateOfBirth : "",
              secondApplicantMobile: value === "Yes" ? current.secondApplicantMobile : "",
              secondApplicantEmail: value === "Yes" ? current.secondApplicantEmail : ""
            }))} options={yesNoOptions} />
            <DateField fieldKey="dateOfBirth" language={language} required label="Date of birth" value={form.dateOfBirth} onChange={(value) => updateField("dateOfBirth", value)} {...fieldStatus("dateOfBirth")} />
            <SelectField language={language} label="Gender" value={form.gender} onChange={(value) => updateField("gender", value)} options={genderOptions} />
            <label {...fieldAttrs("email")}>{L("Email")}<input required value={form.email} onChange={(event) => updateField("email", event.target.value)} placeholder="example@example.com" /></label>
            <label {...fieldAttrs("mobile")}>{L("Mobile")}<input required value={form.mobile} onChange={(event) => updateField("mobile", event.target.value)} /></label>
            <SelectField fieldKey="maritalStatus" language={language} required label="Marital Status" value={form.maritalStatus} onChange={updateMaritalStatus} options={maritalStatusOptions} {...fieldStatus("maritalStatus")} />
            <SelectField fieldKey="residencyStatus" language={language} required label="Residential Status" value={form.residencyStatus} onChange={(value) => updateField("residencyStatus", value)} options={residencyOptions} {...fieldStatus("residencyStatus")} />
            <SelectField language={language} label="Permanent in Australia" value={form.permanentInAustralia} onChange={(value) => updateField("permanentInAustralia", value)} options={yesNoOptions} />
            <label>{L("Visa Sub-class")}<input value={form.visaSubclass || ""} onChange={(event) => updateField("visaSubclass", event.target.value)} /><span className="field-help">{L("Leave blank if not applicable.")}</span></label>
            <label {...fieldAttrs("dependants")}>{L("Number of Dependents")}<select required value={form.dependants} onChange={(event) => updateField("dependants", event.target.value)}>{[0, 1, 2, 3, 4].map((count) => <option key={count} value={count}>{count}</option>)}</select></label>
            {Array.from({ length: dependantCount }, (_, index) => {
              const field = `dependant${index + 1}Dob`;
              return <DateField key={field} language={language} label={`DOB of Dependent ${index + 1}`} value={form[field]} onChange={(value) => updateField(field, value)} />;
            })}
          </div>
          {hasSecondApplicant && <div className="second-applicant-panel">
            <h3>{L("Second Applicant Details")}</h3>
            <p>Only complete this section when there is a co-applicant, spouse, partner, or second borrower on the application.</p>
            <div className="client-intake-grid">
              <label {...fieldAttrs("secondApplicantFirstName")}>{L("Second applicant first / given name(s)")}<input required value={form.secondApplicantFirstName} onChange={(event) => updateField("secondApplicantFirstName", event.target.value)} /><span className="field-help">{L("Enter names exactly as shown on ID. Vietnamese accents are OK.")}</span></label>
              <label {...fieldAttrs("secondApplicantSurname")}>{L("Second applicant family name / surname")}<input required value={form.secondApplicantSurname} onChange={(event) => updateField("secondApplicantSurname", event.target.value)} /></label>
              <DateField fieldKey="secondApplicantDateOfBirth" language={language} required label="Date of birth" value={form.secondApplicantDateOfBirth} onChange={(value) => updateField("secondApplicantDateOfBirth", value)} {...fieldStatus("secondApplicantDateOfBirth")} />
              <SelectField language={language} label="Gender" value={form.secondApplicantGender} onChange={(value) => updateField("secondApplicantGender", value)} options={genderOptions} />
              <label>{L("Second applicant email")}<input value={form.secondApplicantEmail} onChange={(event) => updateField("secondApplicantEmail", event.target.value)} placeholder="Leave blank if same contact email" /></label>
              <label>{L("Second applicant mobile")}<input value={form.secondApplicantMobile} onChange={(event) => updateField("secondApplicantMobile", event.target.value)} placeholder="Leave blank if same contact mobile" /></label>
              <SelectField fieldKey="secondApplicantResidencyStatus" language={language} required label="Second applicant residency" value={form.secondApplicantResidencyStatus} onChange={(value) => updateField("secondApplicantResidencyStatus", value)} options={residencyOptions} {...fieldStatus("secondApplicantResidencyStatus")} />
              <SelectField language={language} label="Permanent in Australia" value={form.secondApplicantPermanentInAustralia} onChange={(value) => updateField("secondApplicantPermanentInAustralia", value)} options={yesNoOptions} />
              <label>{L("Second applicant visa")}<input value={form.secondApplicantVisaSubclass} onChange={(event) => updateField("secondApplicantVisaSubclass", event.target.value)} /><span className="field-help">{L("Leave blank if not applicable.")}</span></label>
              <SelectField language={language} label="Marital Status" value={form.secondApplicantMaritalStatus} onChange={(value) => updateField("secondApplicantMaritalStatus", value)} options={maritalStatusOptions} />
              <label>{L("Number of Dependents")}<select value={form.secondApplicantDependants} onChange={(event) => updateField("secondApplicantDependants", event.target.value)}>{[0, 1, 2, 3, 4].map((count) => <option key={count} value={count}>{count}</option>)}</select></label>
              <SelectField language={language} label="Second applicant employment" value={form.secondApplicantEmploymentType} onChange={(value) => updateField("secondApplicantEmploymentType", value)} options={employmentTypeOptions} />
              <label>{L("Employer Name")}<input value={form.secondApplicantEmployerName} onChange={(event) => updateField("secondApplicantEmployerName", event.target.value)} /><span className="field-help">{L("Leave blank if not applicable.")}</span></label>
            </div>
          </div>}
        </section>

        <section>
          <h2>{L("Driver Licence / ID")}</h2>
          <div className="client-intake-grid">
            <label>{L("Driver licence no.")}<input value={form.driversLicenceNo} onChange={(event) => updateField("driversLicenceNo", event.target.value)} /></label>
            <DateField language={language} label="Licence expiry" value={form.licenceExpiryDate} onChange={(value) => updateField("licenceExpiryDate", value)} />
            <SelectField language={language} label="Licence state" value={form.licenceState} onChange={(value) => updateField("licenceState", value)} options={licenceStateOptions} />
            <label>{L("Licence Class")}<input value={form.licenceClass} onChange={(event) => updateField("licenceClass", event.target.value)} placeholder="C" /></label>
          </div>
          {hasSecondApplicant && <div className="client-intake-grid second-applicant-panel">
            <label>{L("Second applicant licence no.")}<input value={form.secondApplicantDriversLicenceNo} onChange={(event) => updateField("secondApplicantDriversLicenceNo", event.target.value)} /></label>
            <DateField language={language} label="Second applicant licence expiry" value={form.secondApplicantLicenceExpiryDate} onChange={(value) => updateField("secondApplicantLicenceExpiryDate", value)} />
            <SelectField language={language} label="Second applicant licence state" value={form.secondApplicantLicenceState} onChange={(value) => updateField("secondApplicantLicenceState", value)} options={licenceStateOptions} />
            <label>{L("Second applicant licence class")}<input value={form.secondApplicantLicenceClass} onChange={(event) => updateField("secondApplicantLicenceClass", event.target.value)} placeholder="C" /></label>
          </div>}
        </section>

        <section>
          {sectionTitle(L("Income Summary"), ["annualIncome", "secondAnnualIncome"])}
          <div className="client-intake-grid income-summary-grid">
            <label {...fieldAttrs("annualIncome")}>{L("Main income p.a.")}<input required value={form.annualIncome} onChange={(event) => updateField("annualIncome", event.target.value)} /></label>
            {hasSecondApplicant && <label {...fieldAttrs("secondAnnualIncome")}>{L("Second income p.a.")}<input value={form.secondAnnualIncome} onChange={(event) => updateField("secondAnnualIncome", event.target.value)} /></label>}
            <label>{L("Rental income p.a.")}<input value={form.rentalIncomeAnnual} onChange={(event) => updateField("rentalIncomeAnnual", event.target.value)} /><span className="field-help">{L("Leave blank if not applicable.")}</span></label>
          </div>
        </section>

        <section>
          {sectionTitle(L("Residential History Within The Last 2 Years"), ["address", "currentSuburb", "currentState", "currentAddressFromDate", "currentResidentialStatus"])}
          <div className="client-intake-grid">
            <label {...fieldAttrs("address")}>{L("Current residential address")}<input required value={form.address} onChange={(event) => updateField("address", event.target.value)} /></label>
            <label {...fieldAttrs("currentSuburb")}>{L("Suburb")}<input required value={form.currentSuburb} onChange={(event) => updateField("currentSuburb", event.target.value)} /></label>
            <label {...fieldAttrs("currentState")}>{L("State")}<input required value={form.currentState} onChange={(event) => updateField("currentState", event.target.value)} /></label>
            <label>{L("Postcode")}<input value={form.currentPostcode} onChange={(event) => updateField("currentPostcode", event.target.value)} /></label>
            <DateField fieldKey="currentAddressFromDate" language={language} required label="From Date" value={form.currentAddressFromDate} onChange={(value) => updateField("currentAddressFromDate", value)} {...fieldStatus("currentAddressFromDate")} />
            <SelectField fieldKey="currentResidentialStatus" language={language} required label="Residential Status" value={form.currentResidentialStatus} onChange={(value) => updateField("currentResidentialStatus", value)} options={residentialStatusOptions} {...fieldStatus("currentResidentialStatus")} />
            <label>{L("Post settlement address")}<input value={form.postSettlementAddress} onChange={(event) => updateField("postSettlementAddress", event.target.value)} placeholder="Leave blank if same as current address" /></label>
            <label>{L("Mailing address")}<input value={form.mailingAddress} onChange={(event) => updateField("mailingAddress", event.target.value)} placeholder="Leave blank if same as current address" /></label>
            <label>{L("Previous residential address")}<input value={form.previousAddress} onChange={(event) => updateField("previousAddress", event.target.value)} /><span className="field-help">{L("Only enter previous address if current address is less than 2 years.")}</span></label>
            <label>{L("Previous suburb")}<input value={form.previousSuburb} onChange={(event) => updateField("previousSuburb", event.target.value)} /><span className="field-help">{L("Leave blank if not applicable.")}</span></label>
            <label>{L("Previous state")}<input value={form.previousState} onChange={(event) => updateField("previousState", event.target.value)} /><span className="field-help">{L("Leave blank if not applicable.")}</span></label>
            <label>{L("Previous postal code")}<input value={form.previousPostcode} onChange={(event) => updateField("previousPostcode", event.target.value)} /><span className="field-help">{L("Leave blank if not applicable.")}</span></label>
            <SelectField language={language} label="Previous Residential Status" value={form.previousResidentialStatus} onChange={(value) => updateField("previousResidentialStatus", value)} options={residentialStatusOptions} help="Leave blank if not applicable." />
          </div>
        </section>
        {hasSecondApplicant && <section>
          <h2>{L("Second Applicant Residential History")}</h2>
          <div className="client-intake-grid">
            <label>{L("Current residential address")}<input value={form.secondApplicantAddress} onChange={(event) => updateField("secondApplicantAddress", event.target.value)} placeholder="Leave blank if same as main applicant" /></label>
            <label>{L("Suburb")}<input value={form.secondApplicantCurrentSuburb} onChange={(event) => updateField("secondApplicantCurrentSuburb", event.target.value)} /></label>
            <label>{L("State")}<input value={form.secondApplicantCurrentState} onChange={(event) => updateField("secondApplicantCurrentState", event.target.value)} /></label>
            <label>{L("Postcode")}<input value={form.secondApplicantCurrentPostcode} onChange={(event) => updateField("secondApplicantCurrentPostcode", event.target.value)} /></label>
            <DateField language={language} label="From Date" value={form.secondApplicantCurrentAddressFromDate} onChange={(value) => updateField("secondApplicantCurrentAddressFromDate", value)} help="Leave blank if same as main applicant." />
            <SelectField language={language} label="Residential Status" value={form.secondApplicantCurrentResidentialStatus} onChange={(value) => updateField("secondApplicantCurrentResidentialStatus", value)} options={residentialStatusOptions} help="Leave blank if same as main applicant." />
            <label>{L("Previous residential address")}<input value={form.secondApplicantPreviousAddress} onChange={(event) => updateField("secondApplicantPreviousAddress", event.target.value)} /><span className="field-help">{L("Only enter previous address if current address is less than 2 years.")}</span></label>
            <label>{L("Previous suburb")}<input value={form.secondApplicantPreviousSuburb} onChange={(event) => updateField("secondApplicantPreviousSuburb", event.target.value)} /><span className="field-help">{L("Leave blank if not applicable.")}</span></label>
            <label>{L("Previous state")}<input value={form.secondApplicantPreviousState} onChange={(event) => updateField("secondApplicantPreviousState", event.target.value)} /><span className="field-help">{L("Leave blank if not applicable.")}</span></label>
            <label>{L("Previous postal code")}<input value={form.secondApplicantPreviousPostcode} onChange={(event) => updateField("secondApplicantPreviousPostcode", event.target.value)} /><span className="field-help">{L("Leave blank if not applicable.")}</span></label>
            <SelectField language={language} label="Previous Residential Status" value={form.secondApplicantPreviousResidentialStatus} onChange={(value) => updateField("secondApplicantPreviousResidentialStatus", value)} options={residentialStatusOptions} help="Leave blank if not applicable." />
          </div>
        </section>}

        <section>
          {sectionTitle(L("Employment History Within The Last 2 Years"), ["employmentType", "employerName", "occupation", "employmentBasis", "employmentFromDate"])}
          <div className="client-intake-grid">
            <SelectField fieldKey="employmentType" language={language} required label="Employment Type" value={form.employmentType} onChange={(value) => updateField("employmentType", value)} options={employmentTypeOptions} {...fieldStatus("employmentType")} />
            <label {...fieldAttrs("employerName")}>{L("Business Name")}<input required value={form.employerName} onChange={(event) => updateField("employerName", event.target.value)} /></label>
            <label>{L("Business Address")}<input value={form.businessAddress} onChange={(event) => updateField("businessAddress", event.target.value)} /></label>
            <label {...fieldAttrs("occupation")}>{L("Job Title")}<input required value={form.occupation} onChange={(event) => updateField("occupation", event.target.value)} /></label>
            <SelectField fieldKey="employmentBasis" language={language} required label="Employment Basis" value={form.employmentBasis} onChange={(value) => updateField("employmentBasis", value)} options={employmentBasisOptions} {...fieldStatus("employmentBasis")} />
            <DateField fieldKey="employmentFromDate" language={language} required label="From Date" value={form.employmentFromDate} onChange={(value) => updateField("employmentFromDate", value)} {...fieldStatus("employmentFromDate")} />
            <label>{L("Contact Name")}<input value={form.employmentContactName} onChange={(event) => updateField("employmentContactName", event.target.value)} /><span className="field-help">{L("Leave blank if not applicable.")}</span></label>
            <label>{L("Contact Number")}<input value={form.employmentContactNumber} onChange={(event) => updateField("employmentContactNumber", event.target.value)} /><span className="field-help">{L("Leave blank if not applicable.")}</span></label>
            <SelectField language={language} label="Previous Employment Type" value={form.previousEmploymentType} onChange={(value) => updateField("previousEmploymentType", value)} options={employmentBasisOptions} help="Leave blank if not applicable." />
            <label>{L("Previous Business Name")}<input value={form.previousBusinessName} onChange={(event) => updateField("previousBusinessName", event.target.value)} /><span className="field-help">{L("Leave blank if not applicable.")}</span></label>
            <label>{L("Previous Job Title")}<input value={form.previousJobTitle} onChange={(event) => updateField("previousJobTitle", event.target.value)} /><span className="field-help">{L("Leave blank if not applicable.")}</span></label>
            <SelectField language={language} label="Previous Employment Basis" value={form.previousEmploymentBasis} onChange={(value) => updateField("previousEmploymentBasis", value)} options={employmentBasisOptions} help="Leave blank if not applicable." />
            <DateField language={language} label="Previous From Date" value={form.previousEmploymentFromDate} onChange={(value) => updateField("previousEmploymentFromDate", value)} help="Leave blank if not applicable." />
            <DateField language={language} label="Previous To Date" value={form.previousEmploymentToDate} onChange={(value) => updateField("previousEmploymentToDate", value)} help="Leave blank if not applicable." />
          </div>
        </section>
        {hasSecondApplicant && <section>
          <h2>{L("Second Applicant Employment History")}</h2>
          <div className="client-intake-grid">
            <SelectField language={language} label="Employment Type" value={form.secondApplicantEmploymentType} onChange={(value) => updateField("secondApplicantEmploymentType", value)} options={employmentTypeOptions} />
            <label>{L("Business Name")}<input value={form.secondApplicantEmployerName} onChange={(event) => updateField("secondApplicantEmployerName", event.target.value)} /></label>
            <label>{L("Business Address")}<input value={form.secondApplicantBusinessAddress} onChange={(event) => updateField("secondApplicantBusinessAddress", event.target.value)} /></label>
            <label>{L("Job Title")}<input value={form.secondApplicantJobTitle} onChange={(event) => updateField("secondApplicantJobTitle", event.target.value)} /></label>
            <SelectField language={language} label="Employment Basis" value={form.secondApplicantEmploymentBasis} onChange={(value) => updateField("secondApplicantEmploymentBasis", value)} options={employmentBasisOptions} help="Leave blank if not applicable." />
            <DateField language={language} label="From Date" value={form.secondApplicantEmploymentFromDate} onChange={(value) => updateField("secondApplicantEmploymentFromDate", value)} help="Leave blank if not applicable." />
            <label>{L("Contact Name")}<input value={form.secondApplicantEmploymentContactName} onChange={(event) => updateField("secondApplicantEmploymentContactName", event.target.value)} /><span className="field-help">{L("Leave blank if not applicable.")}</span></label>
            <label>{L("Contact Number")}<input value={form.secondApplicantEmploymentContactNumber} onChange={(event) => updateField("secondApplicantEmploymentContactNumber", event.target.value)} /><span className="field-help">{L("Leave blank if not applicable.")}</span></label>
            <label>{L("Previous Business Name")}<input value={form.secondApplicantPreviousBusinessName} onChange={(event) => updateField("secondApplicantPreviousBusinessName", event.target.value)} /><span className="field-help">{L("Leave blank if not applicable.")}</span></label>
            <label>{L("Previous Job Title")}<input value={form.secondApplicantPreviousJobTitle} onChange={(event) => updateField("secondApplicantPreviousJobTitle", event.target.value)} /><span className="field-help">{L("Leave blank if not applicable.")}</span></label>
            <SelectField language={language} label="Previous Employment Basis" value={form.secondApplicantPreviousEmploymentBasis} onChange={(value) => updateField("secondApplicantPreviousEmploymentBasis", value)} options={employmentBasisOptions} help="Leave blank if not applicable." />
            <DateField language={language} label="Previous From Date" value={form.secondApplicantPreviousEmploymentFromDate} onChange={(value) => updateField("secondApplicantPreviousEmploymentFromDate", value)} help="Leave blank if not applicable." />
            <DateField language={language} label="Previous To Date" value={form.secondApplicantPreviousEmploymentToDate} onChange={(value) => updateField("secondApplicantPreviousEmploymentToDate", value)} help="Leave blank if not applicable." />
          </div>
        </section>}

        <section>
          {sectionTitle(L("Living Expenses"), ["generalExpenses"])}
          <div className="client-intake-grid">
            <label {...fieldAttrs("generalExpenses")}>{L("Expenses")}<input required value={form.generalExpenses} onChange={(event) => updateField("generalExpenses", event.target.value)} /></label>
            <label>{L("AP 1 - Amount ($)")}<input value={form.applicant1Expenses} onChange={(event) => updateField("applicant1Expenses", event.target.value)} /></label>
            <label>{L("AP 2 - Amount ($)")}<input value={form.applicant2Expenses} onChange={(event) => updateField("applicant2Expenses", event.target.value)} /><span className="field-help">{L("Leave blank if there is no second applicant.")}</span></label>
            <SelectField language={language} label="Private Health Insurance - Applicant 1" value={form.applicant1PrivateHealth} onChange={(value) => updateField("applicant1PrivateHealth", value)} options={yesNoOptions} />
            <label>{L("Applicant 1 Amount ($)/month")}<input value={form.applicant1PrivateHealthAmount} onChange={(event) => updateField("applicant1PrivateHealthAmount", event.target.value)} /></label>
            <SelectField language={language} label="Private Health Insurance - Applicant 2" value={form.applicant2PrivateHealth} onChange={(value) => updateField("applicant2PrivateHealth", value)} options={yesNoOptions} />
            <label>{L("Applicant 2 Amount ($)/month")}<input value={form.applicant2PrivateHealthAmount} onChange={(event) => updateField("applicant2PrivateHealthAmount", event.target.value)} /><span className="field-help">{L("Leave blank if there is no second applicant.")}</span></label>
            <SelectField language={language} label="Income protection or life insurance policies" value={form.insurancePolicies} onChange={(value) => updateField("insurancePolicies", value)} options={insurancePolicyOptions} />
            <label>{L("Monthly living expense total")}<input value={form.hemMonthly} onChange={(event) => updateField("hemMonthly", event.target.value)} /><span className="field-help">{L("Leave blank if unsure.")}</span></label>
          </div>
        </section>

        <section>
          <h2>{L("Your Assets")}</h2>
          <div className="client-intake-grid">
            <label>{L("Real Estate Address")}<input value={form.realEstateAssetAddress} onChange={(event) => updateField("realEstateAssetAddress", event.target.value)} /></label>
            <label>{L("Real Estate Value ($)")}<input value={form.realEstateAssetValue} onChange={(event) => updateField("realEstateAssetValue", event.target.value)} /></label>
            <label>{L("Cash/Savings Amount ($)")}<input value={form.cashSavingsAmount} onChange={(event) => updateField("cashSavingsAmount", event.target.value)} /></label>
            <label>{L("Banking with")}<input value={form.cashSavingsBank} onChange={(event) => updateField("cashSavingsBank", event.target.value)} /></label>
            <label>{L("Car/Motor Vehicle Model/year")}<input value={form.motorVehicleModelYear} onChange={(event) => updateField("motorVehicleModelYear", event.target.value)} /></label>
            <label>{L("Motor Vehicle Estimated value ($)")}<input value={form.motorVehicleValue} onChange={(event) => updateField("motorVehicleValue", event.target.value)} /></label>
            <label>{L("Home contents item")}<input value={form.homeContentsItem} onChange={(event) => updateField("homeContentsItem", event.target.value)} /></label>
            <label>{L("Home contents estimated value ($)")}<input value={form.homeContentsValue} onChange={(event) => updateField("homeContentsValue", event.target.value)} /></label>
            <label>{L("Savings/assets total")}<input value={form.financialAssetBuffer} onChange={(event) => updateField("financialAssetBuffer", event.target.value)} /></label>
          </div>
        </section>

        <section>
          {sectionTitle(L("Loan Details"), ["loanPurpose", "loanAmount"])}
          <div className="client-intake-grid">
            <SelectField fieldKey="loanPurpose" language={language} required label="Your loan purpose" value={form.loanPurpose} onChange={(value) => setForm((current) => ({
              ...current,
              loanPurpose: value,
              loanScenario: deriveLoanScenario(current.loanType, value)
            }))} options={purposeOptions} {...fieldStatus("loanPurpose")} />
            {loanProfile.showPropertyType ? <label>{L("Type of property")}<input value={form.propertyType} onChange={(event) => updateField("propertyType", event.target.value)} /><span className="field-help">{L("Leave blank if not applicable.")}</span></label> : null}
            <label {...fieldAttrs("loanAmount")}>{L("How much would you like to borrow ($)")}<input required value={form.loanAmount} onChange={(event) => updateField("loanAmount", event.target.value)} placeholder="390000" /></label>
            {loanProfile.showPropertyLocation ? <label>{L("Location (intended postcode OR address)")}<input value={form.propertyLocation} onChange={(event) => updateField("propertyLocation", event.target.value)} /></label> : null}
            {loanProfile.showPropertyValue ? <label>{L("Estimated property value ($)")}<input value={form.propertyValue} onChange={(event) => updateField("propertyValue", event.target.value)} /><span className="field-help">{L("Leave blank if unsure.")}</span></label> : null}
            {loanProfile.showDepositEquity ? <label>{L("Deposit/equity")}<input value={form.depositEquity} onChange={(event) => updateField("depositEquity", event.target.value)} /></label> : null}
            {loanProfile.showFirstHomeBuyer ? <SelectField language={language} label="Are you first home buyer?" value={form.firstHomeBuyer} onChange={(value) => updateField("firstHomeBuyer", value)} options={yesNoOptions} /> : null}
            {loanProfile.showFeaturePrefs ? <SelectField language={language} label="Would you like fixed interest rate for a certain period?" value={form.fixedRatePreference} onChange={(value) => updateField("fixedRatePreference", value)} options={yesNoAdviseOptions} /> : null}
            {loanProfile.showFeaturePrefs ? <SelectField language={language} label="Would you like interest rate to be variable?" value={form.variableRatePreference} onChange={(value) => updateField("variableRatePreference", value)} options={yesNoAdviseOptions} /> : null}
            {loanProfile.showFeaturePrefs ? <SelectField language={language} label="Would you like to consider a split home loan?" value={form.splitLoanPreference} onChange={(value) => updateField("splitLoanPreference", value)} options={yesNoAdviseOptions} /> : null}
            <label>{L("Loan term")}<select value={form.loanTermYears} onChange={(event) => updateField("loanTermYears", event.target.value)}><option>30</option><option>25</option><option>40</option></select></label>
            {loanProfile.showTimeline ? <label>{L("Timeline")}<input value={form.timeline} onChange={(event) => updateField("timeline", event.target.value)} placeholder="ASAP, 3 months, pre-approval" /></label> : null}
            {loanProfile.showCreditIssue ? <SelectField language={language} label="Credit issue" value={form.creditIssue} onChange={(value) => updateField("creditIssue", value)} options={["No", "Unsure", "Yes"]} /> : null}
          </div>
          <DynamicLoanSections form={form} language={language} onChange={updateField} />
          <label className="client-wide-field">{L("Existing debts / comments")}<textarea value={form.existingDebtsSummary} onChange={(event) => updateField("existingDebtsSummary", event.target.value)} /></label>
          <label className="client-wide-field">{L("Anything else for your broker")}<textarea value={form.clientNotes} onChange={(event) => updateField("clientNotes", event.target.value)} /></label>
        </section>

        <button className="primary-button client-submit" type="submit" disabled={saving}>
          {saving ? <RefreshCw size={17} className="spin" /> : <CheckCircle2 size={17} />}
          {saving ? txt.updating : txt.submit}
        </button>
      </form>
    </main>
  );
}

export default function App() {
  const { session } = useSessionStatus();
  const [view, setView] = useState(() => (isLoanSubmissionsRoute || isClientCallHost || location.pathname.includes("call-notes") || location.pathname.includes("client-call") ? "notes" : "autofill"));
  const [deepLinkFix] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    return {
      caseId: params.get("caseId") || params.get("case") || "",
      fix: params.get("fix") || "",
      path: params.get("path") || "",
      code: params.get("code") || ""
    };
  });
  const [cases, setCases] = useState([]);
  const [caseSearch, setCaseSearch] = useState("");
  const [selectedCaseId, setSelectedCaseId] = useState("");
  const [caseData, setCaseData] = useState(null);
  const [prepared, setPrepared] = useState(null);
  const [fixIssue, setFixIssue] = useState(null);
  const [auditLog, setAuditLog] = useState([]);
  const [caseHistory, setCaseHistory] = useState([]);
  const [recentCaseIds, setRecentCaseIds] = useState(() => storageGet("infinity-aol-recent-cases", []));
  const [templates, setTemplates] = useState([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState("single-investor-preapproval");
  const [templateJson, setTemplateJson] = useState("");
  const [templateMessage, setTemplateMessage] = useState("");
  const [templatePreview, setTemplatePreview] = useState(null);
  const [documents, setDocuments] = useState([]);
  const [ocrTextFiles, setOcrTextFiles] = useState([]);
  const [manualIntake, setManualIntake] = useState({});
  const [incomeFormatText, setIncomeFormatText] = useState("");
  const [hemMonthly, setHemMonthly] = useState(4000);
  const [hemConfirmed, setHemConfirmed] = useState(false);
  const [hemProfileKey, setHemProfileKey] = useState("singleStandard");
  const [hemProfiles, setHemProfiles] = useState(() => storageGet("easyflow-hem-profiles", defaultHemProfiles));
  const [financialAssetBuffer, setFinancialAssetBuffer] = useState(30000);
  const [documentDraft, setDocumentDraft] = useState(null);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [ocrRunning, setOcrRunning] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [error, setError] = useState("");
  const selectedTemplateIdRef = useRef("");
  const templateAutoSaveRef = useRef({ canonical: "" });

  useEffect(() => {
    document.title = pageTitle();
    document.body.classList.remove("theme-call", "theme-easyflow", "theme-loan-form", "theme-records");
    document.body.classList.add(appThemeClass());
  }, []);

  const showMock = location.pathname === "/mock-infinity-aol" || location.pathname === "/infinity-aol/mock-infinity-aol";
  const internalLogin = (isClientCallHost || isEasyFlowAiHost || isLoanSubmissionsHost || isPortalHost) && location.pathname === "/login";
  const intakeToken = location.pathname.match(/^\/(?:infinity-aol\/)?(?:client-info|loan-form|apply)\/([^/]+)/)?.[1] || "";
  const publicEntry = getPublicLoanEntry(location.pathname);
  const publicLoanForm = Boolean(publicEntry) || (isLoanFormHost && location.pathname === "/");

  useEffect(() => {
    if (!deepLinkFix.caseId) return;
    setView("autofill");
    selectCase(deepLinkFix.caseId);
  }, [deepLinkFix.caseId]);

  useEffect(() => {
    if (!deepLinkFix.fix || !caseData || caseData.id !== selectedCaseId) return;
    const timer = setTimeout(() => jumpToFixTarget(deepLinkFix), 350);
    return () => clearTimeout(timer);
  }, [deepLinkFix, caseData, selectedCaseId]);

  useEffect(() => {
    if (showMock || internalLogin) return;
    if (view === "notes") return;
    api("/api/cases").then(setCases).catch((err) => setError(err.message));
    api("/api/templates").then(setTemplates).catch((err) => setError(err.message));
    api("/api/audit-log").then(setAuditLog).catch(() => {});
  }, [showMock, internalLogin, view]);

  useEffect(() => {
    if (showMock || !selectedCaseId) return;
    setPrepared(null);
    setDocumentDraft(null);
    setTemplatePreview(null);
    setCaseHistory([]);
    setDocuments([]);
    setOcrTextFiles([]);
    setIncomeFormatText("");
    api(`/api/cases/${selectedCaseId}`).then(setCaseData).catch((err) => setError(err.message));
    api(`/api/cases/${selectedCaseId}/history`).then(setCaseHistory).catch(() => {});
    api(`/api/cases/${selectedCaseId}/document-intake`)
      .then((result) => setDocumentDraft(result.draft))
      .catch(() => {});
  }, [selectedCaseId, showMock]);

  useEffect(() => {
    if (!caseData) return;
    const saved = storageGet(caseStorageKey(caseData.id), {});
    const intake = { ...initialManualIntake(caseData), ...saved };
    setManualIntake(intake);
    setHemMonthly(Number(saved.hemMonthly || caseData.expenses?.livingMonthly || recommendedHem(caseData)));
    setHemConfirmed(saved.hemConfirmed === true);
    setHemProfileKey(saved.hemProfileKey || (caseHasSecondApplicant(caseData, intake) ? "coupleStandard" : "singleStandard"));
    setFinancialAssetBuffer(Number(saved.financialAssetBuffer || 30000));
  }, [caseData]);

  const filteredCases = useMemo(() => {
    const terms = searchKey(caseSearch).trim().split(/\s+/).filter(Boolean);
    if (caseSearch.trim().length < 2 || !terms.length) return [];
    return cases
      .filter((caseItem) => {
        const haystack = [
          caseItem.id,
          caseItem.status,
          caseItem.brokerUser,
          caseItem.applicantNames,
          caseItem.propertyAddress,
          String(caseItem.loanAmount || "")
        ].join(" ");
        const searchable = searchKey(haystack);
        return terms.every((term) => searchable.includes(term));
      })
      .slice(0, 12);
  }, [caseSearch, cases]);

  const sortedCases = useMemo(
    () => [...cases].sort((a, b) => a.applicantNames.localeCompare(b.applicantNames)),
    [cases]
  );
  const recentCases = useMemo(() => {
    const recent = recentCaseIds
      .map((caseId) => cases.find((caseItem) => caseItem.id === caseId))
      .filter(Boolean)
      .sort((a, b) => a.applicantNames.localeCompare(b.applicantNames));
    return recent.slice(0, 6);
  }, [cases, recentCaseIds]);
  const visibleCases = caseSearch.trim().length < 2 ? recentCases : filteredCases;

  const selectedSummary = useMemo(() => cases.find((item) => item.id === selectedCaseId), [cases, selectedCaseId]);
  const selectedTemplate = useMemo(
    () => templates.find((template) => template.id === selectedTemplateId) || null,
    [templates, selectedTemplateId]
  );

  useEffect(() => {
    if (!selectedTemplate) return;
    const switchedTemplate = selectedTemplateIdRef.current !== selectedTemplate.id;
    selectedTemplateIdRef.current = selectedTemplate.id;
    templateAutoSaveRef.current.canonical = JSON.stringify(selectedTemplate);
    if (!switchedTemplate) return;
    setTemplateJson(JSON.stringify(selectedTemplate, null, 2));
    const saved = selectedCaseId ? storageGet(caseStorageKey(selectedCaseId), {}) : {};
    const hasSavedHem = saved.hemMonthly !== undefined && saved.hemMonthly !== null && saved.hemMonthly !== "";
    const hasSavedAssetBuffer = saved.financialAssetBuffer !== undefined && saved.financialAssetBuffer !== null && saved.financialAssetBuffer !== "";
    if (!hasSavedHem && selectedTemplate.defaults?.hemMonthly) updateHemMonthly(selectedTemplate.defaults.hemMonthly);
    if (!hasSavedAssetBuffer && selectedTemplate.defaults?.financialAssetBuffer) updateFinancialAssetBuffer(selectedTemplate.defaults.financialAssetBuffer);
    setTemplateMessage("");
  }, [selectedTemplate, selectedCaseId]);

  useEffect(() => {
    if (!selectedTemplateId || !templateJson.trim()) return;
    let parsed = null;
    try {
      parsed = JSON.parse(templateJson);
    } catch (_error) {
      setTemplateMessage("Template auto-save paused until JSON is valid.");
      return;
    }
    if (!parsed?.id || parsed.id !== selectedTemplateId) return;
    const canonical = JSON.stringify(parsed);
    if (canonical === templateAutoSaveRef.current.canonical) return;
    setTemplateMessage("Auto-saving template edits...");
    const timer = setTimeout(() => {
      saveTemplate({ silent: true }).catch(() => {});
    }, 800);
    return () => clearTimeout(timer);
  }, [templateJson, selectedTemplateId]);

  function currentTemplatePayload() {
    if (!templateJson.trim()) return null;
    return JSON.parse(templateJson);
  }

  const easyFlowHasSecondApplicant = caseHasSecondApplicant(caseData, manualIntake);
  const primaryCaseApplicant = caseData?.applicants?.find((applicant) => applicant.role === "primary") || {};
  const secondaryCaseApplicant = caseData?.applicants?.find((applicant) => applicant.role === "secondary") || {};
  const primaryLinkedName = manualIntake.primaryApplicantName || [primaryCaseApplicant.firstName, primaryCaseApplicant.middleName, primaryCaseApplicant.lastName].filter(Boolean).join(" ");
  const secondaryLinkedName = manualIntake.secondaryApplicantName || [secondaryCaseApplicant.firstName, secondaryCaseApplicant.middleName, secondaryCaseApplicant.lastName].filter(Boolean).join(" ");

  function updateEasyFlowSecondApplicant(value) {
    setManualIntake((current) => {
      if (value !== "Yes") {
        return {
          ...current,
          hasSecondApplicant: "No",
          secondaryApplicantName: "",
          secondaryAnnualIncome: "",
          secondaryDateOfBirth: "",
          secondaryGender: "",
          secondaryMobile: "",
          secondaryEmail: "",
          secondaryDriversLicenceNo: "",
          secondaryLicenceCardNumber: "",
          secondaryLicenceExpiryDate: "",
          secondaryLicenceState: "",
          secondaryLicenceClass: ""
        };
      }
      return {
        ...current,
        hasSecondApplicant: "Yes",
        secondaryApplicantName: current.secondaryApplicantName || secondaryLinkedName || "",
        secondaryAnnualIncome: current.secondaryAnnualIncome || secondaryCaseApplicant.income?.baseAnnual || ""
      };
    });
  }

  function currentManualIntake(overrides = {}) {
    const hasSecondApplicant = caseHasSecondApplicant(caseData, manualIntake);
    const nextManualIntake = { ...manualIntake, ...overrides };
    const effectiveHemConfirmed = overrides.hemConfirmed ?? hemConfirmed;
    const effectiveHemMonthly = overrides.hemMonthly ?? hemMonthly;
    const effectiveFinancialAssetBuffer = overrides.financialAssetBuffer ?? financialAssetBuffer;
    const loanAmount = parseMoneyInput(nextManualIntake.loanAmount);
    const propertyPurchasePrice = parseMoneyInput(nextManualIntake.propertyPurchasePrice);
    const calculatedLvr = loanAmount > 0 && propertyPurchasePrice > 0
      ? Number(((loanAmount / propertyPurchasePrice) * 100).toFixed(2))
      : 0;
    return {
      ...nextManualIntake,
      hasSecondApplicant: hasSecondApplicant ? "Yes" : "No",
      secondaryApplicantName: hasSecondApplicant ? nextManualIntake.secondaryApplicantName : "",
      loanAmount,
      propertyPurchasePrice,
      depositEquity: parseMoneyInput(nextManualIntake.depositEquity),
      lvr: calculatedLvr || Number(nextManualIntake.lvr || 0),
      primaryAnnualIncome: parseMoneyInput(nextManualIntake.primaryAnnualIncome),
      secondaryAnnualIncome: hasSecondApplicant ? parseMoneyInput(nextManualIntake.secondaryAnnualIncome) : 0,
      primaryGender: nextManualIntake.primaryGender || primaryCaseApplicant.gender || "",
      secondaryGender: hasSecondApplicant ? nextManualIntake.secondaryGender || secondaryCaseApplicant.gender || "" : "",
      secondaryDriversLicenceNo: hasSecondApplicant ? nextManualIntake.secondaryDriversLicenceNo : "",
      secondaryLicenceCardNumber: hasSecondApplicant ? nextManualIntake.secondaryLicenceCardNumber : "",
      secondaryLicenceExpiryDate: hasSecondApplicant ? nextManualIntake.secondaryLicenceExpiryDate : "",
      secondaryLicenceState: hasSecondApplicant ? nextManualIntake.secondaryLicenceState : "",
      secondaryLicenceClass: hasSecondApplicant ? nextManualIntake.secondaryLicenceClass : "",
      hemMonthly: effectiveHemMonthly,
      hemConfirmed: effectiveHemConfirmed,
      hemProfileKey,
      hemBreakdown: hemBreakdown(effectiveHemMonthly),
      financialAssetBuffer: effectiveFinancialAssetBuffer,
      assetBreakdown: assetBreakdown(effectiveFinancialAssetBuffer)
    };
  }

  useEffect(() => {
    if (!selectedCaseId || !caseData) return;
    const timer = setTimeout(() => {
      storageSet(caseStorageKey(selectedCaseId), currentManualIntake());
    }, 350);
    return () => clearTimeout(timer);
  }, [manualIntake, hemMonthly, hemConfirmed, hemProfileKey, financialAssetBuffer, selectedCaseId, caseData]);

  function persistCaseInputs(overrides = {}) {
    if (!selectedCaseId) return;
    storageSet(caseStorageKey(selectedCaseId), currentManualIntake(overrides));
  }

  function updateHemProfile(profileKey, changes) {
    setHemProfiles((current) => {
      const next = { ...current, [profileKey]: { ...current[profileKey], ...changes } };
      storageSet("easyflow-hem-profiles", next);
      return next;
    });
    setTemplateMessage("HEM template saved.");
    if (profileKey === hemProfileKey && Object.prototype.hasOwnProperty.call(changes, "amount")) {
      updateHemMonthly(changes.amount);
    }
  }

  function updateHemMonthly(value) {
    const nextValue = Number(value || 0);
    setHemMonthly(nextValue);
    setHemConfirmed(false);
    persistCaseInputs({ hemMonthly: nextValue, hemConfirmed: false });
  }

  function setHemConfirmation(value) {
    setHemConfirmed(value);
    persistCaseInputs({ hemConfirmed: value });
  }

  function updateFinancialAssetBuffer(value) {
    const nextValue = Number(value || 0);
    setFinancialAssetBuffer(nextValue);
    persistCaseInputs({ financialAssetBuffer: nextValue });
  }

  function confirmHemIfNeeded() {
    if (!hemMonthly) {
      setError("Set HEM / living expense monthly before preparing Infinity Financials.");
      return false;
    }
    if (hemConfirmed) return true;
    const lines = hemBreakdown(hemMonthly)
      .map((row) => `${row.type}: ${currency(row.amount)}`)
      .join("\n");
    const ok = window.confirm(`Confirm HEM / living expense monthly ${currency(hemMonthly)} before preparing Financials?\n\n${lines}`);
    if (ok) setHemConfirmation(true);
    return ok;
  }

  function applyHemProfile(profileKey) {
    const profile = hemProfiles[profileKey];
    if (!profile) return;
    const amount = Number(profile.amount || 0);
    setHemProfileKey(profileKey);
    setHemMonthly(amount);
    setHemConfirmed(false);
    persistCaseInputs({ hemProfileKey: profileKey, hemMonthly: amount, hemConfirmed: false });
  }

  function fixSectionForTarget(target = {}) {
    const text = `${target.fix || ""} ${target.path || ""} ${target.code || ""}`.toLowerCase();
    if (text.includes("hem") || text.includes("living") || text.includes("expense")) return "hem";
    if (text.includes("document") || text.includes("ocr") || text.includes("intake")) return "documents";
    if (text.includes("handoff") || text.includes("payload")) return "handoff";
    if (text.includes("validation")) return "validation";
    return "quick-inputs";
  }

  function jumpToFixTarget(target = {}) {
    const section = fixSectionForTarget(target);
    const node = document.querySelector(`[data-fix-section="${section}"]`) || document.querySelector("[data-fix-section='validation']");
    if (!node) return;
    node.classList.add("fix-jump-highlight");
    node.scrollIntoView({ behavior: "smooth", block: "center" });
    const focusTarget = node.querySelector("input, select, textarea, button");
    setTimeout(() => focusTarget?.focus?.(), 300);
    setTimeout(() => node.classList.remove("fix-jump-highlight"), 2200);
  }

  function selectCase(caseId) {
    if (!caseId) return;
    setSelectedCaseId(caseId);
    setRecentCaseIds((items) => {
      const next = [caseId, ...items.filter((item) => item !== caseId)].slice(0, 10);
      storageSet("infinity-aol-recent-cases", next);
      return next;
    });
  }

  async function refreshCaseSidePanels(caseId = selectedCaseId) {
    await Promise.all([
      api("/api/audit-log").then(setAuditLog).catch(() => {}),
      caseId ? api(`/api/cases/${caseId}/history`).then(setCaseHistory).catch(() => {}) : Promise.resolve()
    ]);
  }

  function openEasyFlowCase(caseId = "") {
    const cleanCaseId = String(caseId || "").trim();
    if (cleanCaseId) selectCase(cleanCaseId);
    setView("autofill");
  }

  function saveManualIntake() {
    if (!selectedCaseId) return;
    const payload = currentManualIntake();
    storageSet(caseStorageKey(selectedCaseId), payload);
    setTemplateMessage("Case inputs saved locally. Prepare will use these numbers.");
  }

  function handleFiles(fileList) {
    const incoming = [...fileList];
    if (!incoming.length) return;
    setDocuments((items) => {
      const seen = new Set(items.map((file) => `${file.name}-${file.size}-${file.lastModified}`));
      const next = [...items];
      for (const file of incoming) {
        const key = `${file.name}-${file.size}-${file.lastModified}`;
        if (!seen.has(key)) next.push(file);
      }
      return next;
    });
  }

  async function runOcrForImages(files) {
    const imageFiles = files.filter((file) => /^image\//i.test(file.type));
    if (!imageFiles.length) return [];
    setOcrRunning(true);
    try {
      const Tesseract = await import("tesseract.js");
      const output = [];
      for (const file of imageFiles.slice(0, 6)) {
        const result = await Tesseract.recognize(file, "eng");
        const text = result?.data?.text || "";
        if (text.trim()) {
          output.push(new File([`OCR SOURCE: ${file.name}\n${text}`], `ocr-${file.name}.txt`, { type: "text/plain" }));
        }
      }
      setOcrTextFiles(output);
      return output;
    } finally {
      setOcrRunning(false);
    }
  }

  async function prepareInfinity(manualOverrides = {}) {
    if (!selectedCaseId) {
      setError("Search and select a case first.");
      return false;
    }
    const confirmedHem = confirmHemIfNeeded();
    if (!confirmedHem) {
      setError("Confirm HEM / living expense breakdown before preparing Infinity Financials.");
      return false;
    }
    const nextManualOverrides = { ...manualOverrides, hemConfirmed: true };
    setLoading(true);
    setError("");
    try {
      const result = await api(`/api/cases/${selectedCaseId}/prepare-infinity-aol`, {
        method: "POST",
        body: JSON.stringify({
          templateId: selectedTemplateId,
          templateOverrides: currentTemplatePayload(),
          manualIntake: currentManualIntake(nextManualOverrides),
          hemMonthly,
          hemConfirmed: true,
          financialAssetBuffer
        })
      });
      setPrepared(result);
      if (result.documentDraft || result.payload?.documentIntake) setDocumentDraft(result.documentDraft || result.payload.documentIntake);
      await refreshCaseSidePanels(selectedCaseId);
      return true;
    } catch (err) {
      setError(err.message);
      return false;
    } finally {
      setLoading(false);
    }
  }

  function updateValidationFixField(key, value) {
    setManualIntake((current) => ({ ...current, [key]: value }));
  }

  async function autoFixIssue(issue) {
    const payload = prepared?.payload || {};
    const loanAmount = parseMoneyInput(manualIntake.loanAmount || payload.loan?.loanAmount);
    const purchasePrice = parseMoneyInput(manualIntake.propertyPurchasePrice || payload.property?.purchasePrice);
    if (issue.code === "LVR_MISMATCH") {
      if (!loanAmount || !purchasePrice) {
        setFixIssue(issue);
        setError("Need loan amount and property/security value before auto-fixing LVR.");
        return;
      }
      const lvr = Number(((loanAmount / purchasePrice) * 100).toFixed(2));
      const next = { lvr: String(lvr), loanAmount: String(loanAmount), propertyPurchasePrice: String(purchasePrice) };
      setManualIntake((current) => ({ ...current, ...next }));
      if (await prepareInfinity(next)) setFixIssue(null);
      return;
    }
    if (issue.code === "DEPOSIT_LOAN_TOTAL_MISMATCH") {
      if (!loanAmount || !purchasePrice || purchasePrice < loanAmount) {
        setFixIssue(issue);
        setError("Need a property/security value higher than loan amount before auto-fixing deposit.");
        return;
      }
      const next = { depositEquity: String(purchasePrice - loanAmount), loanAmount: String(loanAmount), propertyPurchasePrice: String(purchasePrice) };
      setManualIntake((current) => ({ ...current, ...next }));
      if (await prepareInfinity(next)) setFixIssue(null);
    }
  }

  async function uploadDocuments({ prepare = false } = {}) {
    if (!selectedCaseId) {
      setError("Search and select a case first.");
      return;
    }
    if (!documents.length && !incomeFormatText.trim()) {
      setError("Choose at least one customer document or paste the broker intake format first.");
      return;
    }
    if (prepare && !confirmHemIfNeeded()) {
      setError("Confirm HEM / living expense breakdown before preparing Infinity Financials.");
      return;
    }

    setUploading(true);
    setError("");
    try {
      const ocrFiles = await runOcrForImages(documents);
      const formData = new FormData();
      for (const file of documents) formData.append("documents", file);
      for (const file of ocrFiles) formData.append("documents", file);
      if (incomeFormatText.trim()) {
        formData.append("documents", new File([incomeFormatText], "broker-intake-format.txt", { type: "text/plain" }));
      }
      formData.append("hemMonthly", String(hemMonthly));
      formData.append("hemConfirmed", String(prepare ? true : hemConfirmed));
      formData.append("financialAssetBuffer", String(financialAssetBuffer));
      formData.append("templateId", selectedTemplateId);
      formData.append("templateOverrides", JSON.stringify(currentTemplatePayload()));
      formData.append("manualIntake", JSON.stringify(currentManualIntake(prepare ? { hemConfirmed: true } : {})));

      const endpoint = prepare ? "intake-and-prepare" : "document-intake";
      const response = await fetch(`${apiBase}/api/cases/${selectedCaseId}/${endpoint}`, {
        method: "POST",
        cache: "no-store",
        body: formData
      });
      const contentType = response.headers.get("content-type") || "";
      const text = await response.text();
      if (!contentType.includes("application/json")) {
        const shortBody = text.replace(/\s+/g, " ").trim().slice(0, 120);
        throw new Error(`API connection issue on POST /api/cases/${selectedCaseId}/${endpoint}. Server returned ${contentType || "unknown content"} ${response.status}${shortBody ? `: ${shortBody}` : ""}`);
      }
      const result = text ? JSON.parse(text) : {};
      if (!response.ok) throw new Error(result.error || response.statusText);

      setDocumentDraft(result.draft || result.documentDraft);
      if (prepare) setPrepared(result);
      await refreshCaseSidePanels(selectedCaseId);
    } catch (err) {
      setError(err.message);
    } finally {
      setUploading(false);
    }
  }

  async function saveTemplate({ silent = false } = {}) {
    if (!silent) {
      setError("");
      setTemplateMessage("");
    }
    try {
      const template = currentTemplatePayload();
      const saved = await api(`/api/templates/${template.id}`, {
        method: "PUT",
        body: JSON.stringify(template)
      });
      templateAutoSaveRef.current.canonical = JSON.stringify(saved);
      setTemplates((items) => {
        const next = items.filter((item) => item.id !== saved.id);
        return [...next, saved].sort((a, b) => a.name.localeCompare(b.name));
      });
      setSelectedTemplateId(saved.id);
      if (!silent) setTemplateJson(JSON.stringify(saved, null, 2));
      setTemplateMessage(silent ? "Template auto-saved." : "Template saved. Future prepares can use this edited version.");
    } catch (err) {
      if (silent) {
        setTemplateMessage(`Template auto-save paused: ${err.message}`);
      } else {
        setError(`Template JSON is not valid: ${err.message}`);
      }
    }
  }

  async function previewTemplateText() {
    if (!selectedCaseId) {
      setError("Search and select a case first.");
      return;
    }
    setError("");
    try {
      const result = await api(`/api/cases/${selectedCaseId}/template-preview`, {
        method: "POST",
        body: JSON.stringify({
          templateId: selectedTemplateId,
          templateOverrides: currentTemplatePayload(),
          manualIntake: currentManualIntake(),
          hemMonthly,
          financialAssetBuffer
        })
      });
      setTemplatePreview(result);
    } catch (err) {
      setError(`Template preview failed: ${err.message}`);
    }
  }

  async function restorePrepared(token) {
    setError("");
    try {
      const result = await api(`/api/infinity/payload/${token}`);
      setPrepared(result);
      setDocumentDraft(result.payload.documentIntake || null);
    } catch (err) {
      setError(`History payload not found. It may have expired or the server restarted. ${err.message}`);
    }
  }

  async function deleteLocalCaseData() {
    if (!selectedCaseId) {
      setError("Search and select a case first.");
      return;
    }

    const expected = `DELETE ${selectedCaseId}`;
    const typed = window.prompt(`This only deletes assistant payload/history/intake data, not the CRM case.\n\nType ${expected} to confirm.`);
    if (typed !== expected) {
      if (typed !== null) setError(`Delete cancelled. You must type exactly: ${expected}`);
      return;
    }

    setError("");
    try {
      await api(`/api/cases/${selectedCaseId}/local-data`, {
        method: "DELETE",
        body: JSON.stringify({ confirm: expected, brokerUser: caseData?.brokerUser || "unknown" })
      });
      setPrepared(null);
      setDocumentDraft(null);
      setTemplatePreview(null);
      setCaseHistory([]);
      setDocuments([]);
      setAuditLog(await api("/api/audit-log"));
    } catch (err) {
      setError(`Could not delete local case data: ${err.message}`);
    }
  }

  const queuedFiles = [...documents, ...ocrTextFiles];
  const extractedRows = [
    ["Loan amount", manualIntake.loanAmount ? currency(parseMoneyInput(manualIntake.loanAmount)) : prepared?.payload?.loan?.loanAmount ? currency(prepared.payload.loan.loanAmount) : "Not set"],
    ["Primary applicant", primaryLinkedName || "Not selected"],
    ["Second applicant", easyFlowHasSecondApplicant ? (secondaryLinkedName || "Joint applicant") : "No"],
    ["Primary income", manualIntake.primaryAnnualIncome ? currency(parseMoneyInput(manualIntake.primaryAnnualIncome)) : "CRM/file"],
    ["Secondary income", easyFlowHasSecondApplicant ? (manualIntake.secondaryAnnualIncome ? currency(parseMoneyInput(manualIntake.secondaryAnnualIncome)) : "CRM/file") : "N/A"],
    ["HEM / living", currency(hemMonthly)],
    ["Financial asset", currency(financialAssetBuffer)],
    ["Files queued", String(queuedFiles.length)],
    ["Fields found", String(documentDraft?.extracted?.fieldSuggestions?.length || 0)],
    ["Warnings", String(documentDraft?.warnings?.length || 0)],
    ["Last payload", prepared?.token ? prepared.token.slice(0, 10) : "Not prepared"]
  ];

  if (showMock) return <MockInfinity />;
  if (internalLogin) return <InternalLoginPage />;
  if (intakeToken || publicLoanForm) return <ClientIntakePage token={intakeToken} publicForm={!intakeToken} entry={publicEntry} />;
  if (view === "notes") return <CallNotesPage initialPanel={isLoanSubmissionsRoute ? "submissions" : "call"} onOpenAutofill={openEasyFlowCase} />;

  return (
    <main className={`app-shell ${appThemeClass()}`}>
      <aside className="case-sidebar">
        <SystemBrand appName="EasyFlow AI" />
        <button className="ghost-button sidebar-action" type="button" onClick={() => setView("notes")}>
          <ClipboardList size={16} />
          Client Call Intake
        </button>
        <TeamSettingsPanel appName="EasyFlow AI" />
        <div className="case-search">
          <label>
            Search
            <div className="search-input">
              <Search size={16} />
              <input
                value={caseSearch}
                onChange={(event) => setCaseSearch(event.target.value)}
                placeholder="Name, case ID, address"
                autoComplete="off"
              />
            </div>
          </label>
          <select className="case-select" value={selectedCaseId} onChange={(event) => selectCase(event.target.value)}>
            <option value="">All cases by name</option>
            {sortedCases.map((caseItem) => (
              <option key={caseItem.id} value={caseItem.id}>
                {caseItem.applicantNames} - {caseItem.id}
              </option>
            ))}
          </select>
          <small>
            {caseSearch.trim().length >= 2
              ? `${filteredCases.length} result${filteredCases.length === 1 ? "" : "s"}`
              : recentCases.length
                ? "Recent cases sorted by name."
                : "Type at least 2 letters or use the dropdown."}
          </small>
        </div>
        <div className="case-list">
          {visibleCases.length ? (
            visibleCases.map((caseItem) => (
              <button
                className={caseItem.id === selectedCaseId ? "active" : ""}
                key={caseItem.id}
                type="button"
                onClick={() => selectCase(caseItem.id)}
              >
                <span>{caseItem.id}</span>
                <strong>{caseItem.applicantNames}</strong>
                <small>{currency(caseItem.loanAmount)}</small>
              </button>
            ))
          ) : (
            <div className="case-search-empty">
              {caseSearch.trim().length < 2 ? "Recent cases will appear here after you search/select them." : "No matching case found."}
            </div>
          )}
        </div>
        <div className="side-info-card">
          <strong>Case Snapshot</strong>
          {extractedRows.map(([label, value]) => (
            <div key={label}>
              <span>{label}</span>
              <small>{value}</small>
            </div>
          ))}
        </div>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div>
            <span>{selectedSummary?.status || "Case view"}</span>
            <h1>{selectedCaseId || "Search and select a case"}</h1>
          </div>
          <div className="actions">
            <button className="primary-button" type="button" disabled={loading || !caseData || !selectedCaseId} onClick={() => prepareInfinity()}>
              {loading ? <RefreshCw size={17} className="spin" /> : <Play size={17} />}
              Prepare for Extension
            </button>
          </div>
        </header>

        {error && <div className="error-banner">{error}</div>}
        <SessionWarning session={session} />

        <CaseFacts caseData={caseData} />
        <WorkflowGuide selectedCaseId={selectedCaseId} prepared={prepared} documentDraft={documentDraft} />

        <div className="main-grid">
          <section className="panel" data-fix-section="quick-inputs">
            <div className="panel-title split-title">
              <div>
                <ClipboardList size={18} />
                <h2>Quick Inputs</h2>
              </div>
              <button className="ghost-button mini-button" type="button" disabled={!selectedCaseId} onClick={saveManualIntake}>
                Save
              </button>
            </div>
            <div className="quick-input-grid">
              <label>
                Primary applicant
                <input
                  value={manualIntake.primaryApplicantName || primaryLinkedName || ""}
                  onChange={(event) => setManualIntake((value) => ({ ...value, primaryApplicantName: event.target.value }))}
                  placeholder="Linked from call/form"
                />
              </label>
              <label>
                Second applicant
                <select value={easyFlowHasSecondApplicant ? "Yes" : "No"} onChange={(event) => updateEasyFlowSecondApplicant(event.target.value)}>
                  <option>No</option>
                  <option>Yes</option>
                </select>
              </label>
              {easyFlowHasSecondApplicant && (
                <label>
                  Second applicant name
                  <input
                    value={manualIntake.secondaryApplicantName || secondaryLinkedName || ""}
                    onChange={(event) => setManualIntake((value) => ({ ...value, secondaryApplicantName: event.target.value }))}
                    placeholder="Linked from call/form"
                  />
                </label>
              )}
              <label>
                Loan amount
                <input
                  value={manualIntake.loanAmount || ""}
                  onChange={(event) => setManualIntake((value) => ({ ...value, loanAmount: event.target.value }))}
                  placeholder="$390,000"
                />
              </label>
              <label>
                Property/security value
                <input
                  value={manualIntake.propertyPurchasePrice || ""}
                  onChange={(event) => setManualIntake((value) => ({ ...value, propertyPurchasePrice: event.target.value }))}
                  placeholder="$500,000"
                />
              </label>
              <label>
                Deposit/equity
                <input
                  value={manualIntake.depositEquity || ""}
                  onChange={(event) => setManualIntake((value) => ({ ...value, depositEquity: event.target.value }))}
                  placeholder="$225,000"
                />
              </label>
              <label>
                LVR %
                <input
                  value={manualIntake.lvr || ""}
                  onChange={(event) => setManualIntake((value) => ({ ...value, lvr: event.target.value }))}
                  placeholder="55"
                />
              </label>
              <label>
                Primary annual income
                <input
                  value={manualIntake.primaryAnnualIncome || ""}
                  onChange={(event) => setManualIntake((value) => ({ ...value, primaryAnnualIncome: event.target.value }))}
                  placeholder="$130,600"
                />
              </label>
              {easyFlowHasSecondApplicant && (
                <label>
                  Secondary annual income
                  <input
                    value={manualIntake.secondaryAnnualIncome || ""}
                    onChange={(event) => setManualIntake((value) => ({ ...value, secondaryAnnualIncome: event.target.value }))}
                    placeholder="$80,000"
                  />
                </label>
              )}
              <label>
                Primary DOB
                <input
                  value={manualIntake.primaryDateOfBirth || ""}
                  onChange={(event) => setManualIntake((value) => ({ ...value, primaryDateOfBirth: event.target.value }))}
                  placeholder="DD-MM-YYYY"
                />
              </label>
              {easyFlowHasSecondApplicant && (
                <label>
                  Secondary DOB
                  <input
                    value={manualIntake.secondaryDateOfBirth || ""}
                    onChange={(event) => setManualIntake((value) => ({ ...value, secondaryDateOfBirth: event.target.value }))}
                    placeholder="DD-MM-YYYY"
                  />
                </label>
              )}
              <label>
                Primary licence no.
                <input
                  value={manualIntake.primaryDriversLicenceNo || ""}
                  onChange={(event) => setManualIntake((value) => ({ ...value, primaryDriversLicenceNo: event.target.value }))}
                />
              </label>
              <label>
                Primary expiry
                <input
                  value={manualIntake.primaryLicenceExpiryDate || ""}
                  onChange={(event) => setManualIntake((value) => ({ ...value, primaryLicenceExpiryDate: event.target.value }))}
                  placeholder="DD-MM-YYYY"
                />
              </label>
              <label>
                Primary licence state
                <input
                  value={manualIntake.primaryLicenceState || ""}
                  onChange={(event) => setManualIntake((value) => ({ ...value, primaryLicenceState: event.target.value.toUpperCase() }))}
                  placeholder="SA"
                />
              </label>
              <label>
                Primary licence class
                <input
                  value={manualIntake.primaryLicenceClass || ""}
                  onChange={(event) => setManualIntake((value) => ({ ...value, primaryLicenceClass: event.target.value.toUpperCase() }))}
                  placeholder="C"
                />
              </label>
              {easyFlowHasSecondApplicant && (
                <>
                  <label>
                    Secondary licence no.
                    <input
                      value={manualIntake.secondaryDriversLicenceNo || ""}
                      onChange={(event) => setManualIntake((value) => ({ ...value, secondaryDriversLicenceNo: event.target.value }))}
                    />
                  </label>
                  <label>
                    Secondary expiry
                    <input
                      value={manualIntake.secondaryLicenceExpiryDate || ""}
                      onChange={(event) => setManualIntake((value) => ({ ...value, secondaryLicenceExpiryDate: event.target.value }))}
                      placeholder="DD-MM-YYYY"
                    />
                  </label>
                  <label>
                    Secondary licence state
                    <input
                      value={manualIntake.secondaryLicenceState || ""}
                      onChange={(event) => setManualIntake((value) => ({ ...value, secondaryLicenceState: event.target.value.toUpperCase() }))}
                      placeholder="SA"
                    />
                  </label>
                  <label>
                    Secondary licence class
                    <input
                      value={manualIntake.secondaryLicenceClass || ""}
                      onChange={(event) => setManualIntake((value) => ({ ...value, secondaryLicenceClass: event.target.value.toUpperCase() }))}
                      placeholder="C"
                    />
                  </label>
                </>
              )}
            </div>
          </section>

          <section className="panel" data-fix-section="validation">
            <div className="panel-title">
              <ClipboardList size={18} />
              <h2>Validation</h2>
            </div>
            <IssueList issues={prepared?.validation?.issues} onFixIssue={setFixIssue} onAutoFixIssue={autoFixIssue} />
            <ValidationFixPanel
              issue={fixIssue}
              manualIntake={manualIntake}
              preparedPayload={prepared?.payload}
              onChange={updateValidationFixField}
              onClose={() => setFixIssue(null)}
              onSavePrepare={async () => {
                if (await prepareInfinity()) setFixIssue(null);
              }}
            />
          </section>

          <section className="panel" data-fix-section="documents">
            <div className="panel-title">
              <UploadCloud size={18} />
              <h2>Document Intake</h2>
            </div>
            <div className="document-panel">
              <div className="template-box">
                <label>
                  EasyFlow AI template
                  <select value={selectedTemplateId} onChange={(event) => setSelectedTemplateId(event.target.value)}>
                    {templates.map((template) => (
                      <option key={template.id} value={template.id}>
                        {template.name}
                      </option>
                    ))}
                  </select>
                </label>
                {selectedTemplate && <p>{selectedTemplate.description}</p>}
                <details className="advanced-template">
                  <summary>Edit template text</summary>
                  <textarea
                    spellCheck="false"
                    value={templateJson}
                    onChange={(event) => {
                      setTemplateJson(event.target.value);
                      setTemplateMessage("Auto-saving template edits...");
                    }}
                  />
                </details>
                <div className="button-row">
                  <button className="ghost-button save-template" type="button" onClick={saveTemplate}>
                    Save Template
                  </button>
                  <button className="ghost-button save-template" type="button" onClick={previewTemplateText}>
                    Preview Text
                  </button>
                </div>
                {templateMessage && <small className="template-message">{templateMessage}</small>}
              </div>

              {templatePreview && (
                <div className="template-preview">
                  {templatePreview.versions?.broker && (
                    <div className="tpl-banner">
                      ② Broker updated — Infinity &amp; AOL
                      {templatePreview.versions.broker.updatedAt ? ` · ${new Date(templatePreview.versions.broker.updatedAt).toLocaleString()}` : ""}
                      {templatePreview.versions.broker.changedFields?.length ? (
                        <em> (changed: {templatePreview.versions.broker.changedFields.join(", ")})</em>
                      ) : null}
                      <div className="tpl-banner-sub">These templates use the synced (updated) data. The original loan-form case is kept.</div>
                    </div>
                  )}

                  <div className="tpl-platform">INFINITY · Loans &amp; Products</div>

                  <div>
                    <span>Infinity · Needs Analysis</span>
                    <strong>Loan Objective</strong>
                    <p>{templatePreview.preview.needsAnalysis.loanObjectiveExplanation}</p>
                  </div>
                  <div>
                    <span>Infinity · Loans, Securities &amp; Commentary</span>
                    <strong>Circumstances, Objectives &amp; Priorities</strong>
                    <p>{templatePreview.preview.loansSecuritiesCommentary.circumstancesObjectivesPriorities}</p>
                    <strong>Financial Awareness &amp; Practices</strong>
                    <p>{templatePreview.preview.loansSecuritiesCommentary.financialAwarenessPractices}</p>
                  </div>
                  <div>
                    <span>Infinity · Preferred Loan Features / Scenarios</span>
                    <strong>Prioritised Loan Features</strong>
                    <ul className="tpl-features">
                      {(templatePreview.preview.preferredLoanFeatures || []).map((f) => (
                        <li key={f.priority}><b>{f.priority}. {f.feature}</b> — {f.reason}</li>
                      ))}
                    </ul>
                  </div>
                  <div>
                    <span>Infinity · Recommendation</span>
                    <strong>Lender</strong>
                    <p>{templatePreview.preview.recommendation.lender}</p>
                    <strong>Loan Amount</strong>
                    <p>{templatePreview.preview.recommendation.loanAmount}</p>
                    <strong>Interest Rate</strong>
                    <p>{templatePreview.preview.recommendation.interestRate}</p>
                    <strong>Loan Structure</strong>
                    <p>{templatePreview.preview.recommendation.loanStructure}</p>
                    <strong>Goals &amp; Objectives</strong>
                    <p>{templatePreview.preview.recommendation.goalsObjectives}</p>
                    <strong>Loan Features</strong>
                    <p>{templatePreview.preview.recommendation.loanFeatures}</p>
                  </div>
                  <div>
                    <span>Infinity · Commissions / Conflict of Interest</span>
                    <strong>Comments</strong>
                    <p>{templatePreview.preview.commissionsConflict.comments}</p>
                  </div>

                  <div className="tpl-platform">AOL · ApplyOnline</div>
                  <div>
                    <span>AOL · Compliance — Requirements &amp; Objectives</span>
                    <p className="tpl-note">AOL R&amp;O reasons are filled by Start AOL from the lender template (taught per lender). The structured AOL fields (applicants, loans, securities, financials) come from the same prepared case shown above.</p>
                  </div>
                </div>
              )}

              <label
                className={`dropzone ${isDragging ? "dragging" : ""}`}
                onDragOver={(event) => {
                  event.preventDefault();
                  setIsDragging(true);
                }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={(event) => {
                  event.preventDefault();
                  setIsDragging(false);
                  handleFiles(event.dataTransfer.files);
                }}
              >
                <UploadCloud size={22} />
                <strong>{documents.length ? `${documents.length} file(s) selected` : "Drop customer files"}</strong>
                <span>Licence front/back, income, bank, contract</span>
                <input multiple type="file" onChange={(event) => handleFiles(event.target.files)} />
              </label>

              {queuedFiles.length ? (
                <div className="queued-files">
                  {queuedFiles.map((file) => (
                    <div key={`${file.name}-${file.size}-${file.lastModified || 0}`}>
                      <strong>{file.name}</strong>
                      <span>{classifyQueuedFile(file)} | {fileSizeLabel(file.size)}</span>
                    </div>
                  ))}
                </div>
              ) : null}

              <label className="income-format-box">
                Broker intake format
                <textarea
                  value={incomeFormatText}
                  onChange={(event) => setIncomeFormatText(event.target.value)}
                  placeholder={`Applicant 1:
Annual income: 130600
Rental income: 26000
Driver licence no: EA2889
Licence expiry: 20/08/2034
Card number: 123456789

Applicant 2:
Annual income: 95000

Loan amount: 390000
HEM: 3000
Financial asset: 30000`}
                />
              </label>

              <div className="preset-grid">
                <div className="hem-tool" data-fix-section="hem">
                  <span>HEM / living expense monthly</span>
                  <div className="hem-row">
                    <select value={hemProfileKey} onChange={(event) => applyHemProfile(event.target.value)}>
                      {Object.entries(hemProfiles).map(([key, profile]) => (
                        <option key={key} value={key}>{profile.label}</option>
                      ))}
                    </select>
                    <input
                      value={hemMonthly || ""}
                      onChange={(event) => updateHemMonthly(Number(String(event.target.value).replace(/[$,\s]/g, "")) || 0)}
                      placeholder="Manual e.g. 3450"
                    />
                  </div>
                  <small>{hemProfiles[hemProfileKey]?.note || "Manual amount overrides the selected profile for this case."}</small>
                  <button
                    className={`hem-confirm-button ${hemConfirmed ? "confirmed" : ""}`}
                    type="button"
                    onClick={() => setHemConfirmation(!hemConfirmed)}
                  >
                    {hemConfirmed ? "HEM confirmed for Financials" : "Confirm HEM for Financials"}
                  </button>
                  <div className="segmented">
                    {[recommendedHem(caseData), 3000, 3450, 4000, 4500, 5200].filter((value, index, arr) => value && arr.indexOf(value) === index).map((value) => (
                      <button className={hemMonthly === value ? "selected" : ""} type="button" key={value} onClick={() => updateHemMonthly(value)}>
                        {currency(value)}
                      </button>
                    ))}
                  </div>
                  <div className="template-breakdown">
                    {hemBreakdown(hemMonthly).map((row) => (
                      <span key={row.type}><strong>{row.type}</strong>{currency(row.amount)}</span>
                    ))}
                  </div>
                  <details className="advanced-template hem-template-editor">
                    <summary>HEM template settings</summary>
                    {Object.entries(hemProfiles).map(([key, profile]) => (
                      <div className="hem-template-row" key={key}>
                        <input value={profile.label} onChange={(event) => updateHemProfile(key, { label: event.target.value })} />
                        <input value={profile.amount} onChange={(event) => updateHemProfile(key, { amount: Number(String(event.target.value).replace(/[$,\s]/g, "")) || 0 })} />
                        <input value={profile.note} onChange={(event) => updateHemProfile(key, { note: event.target.value })} />
                      </div>
                    ))}
                  </details>
                </div>
                <div>
                  <span>Financial asset</span>
                  <div className="segmented">
                    {[20000, 30000, 40000].map((value) => (
                      <button
                        className={financialAssetBuffer === value ? "selected" : ""}
                        type="button"
                        key={value}
                        onClick={() => updateFinancialAssetBuffer(value)}
                      >
                        {currency(value)}
                      </button>
                    ))}
                  </div>
                  <div className="template-breakdown">
                    {assetBreakdown(financialAssetBuffer).map((row) => (
                      <span key={row.type}><strong>{row.type}</strong>{currency(row.value)}</span>
                    ))}
                  </div>
                </div>
              </div>

              <details className="advanced-template">
                <summary>Review files only</summary>
                <button className="ghost-button intake-button" type="button" disabled={uploading || ocrRunning || (!documents.length && !incomeFormatText.trim()) || !selectedCaseId} onClick={() => uploadDocuments()}>
                  {uploading || ocrRunning ? <RefreshCw size={17} className="spin" /> : <UploadCloud size={17} />}
                  Run OCR without payload
                </button>
              </details>
              <button className="primary-button intake-button" type="button" disabled={uploading || ocrRunning || (!documents.length && !incomeFormatText.trim()) || !selectedCaseId} onClick={() => uploadDocuments({ prepare: true })}>
                {uploading || ocrRunning ? <RefreshCw size={17} className="spin" /> : <Play size={17} />}
                Prepare Files for Extension
              </button>
              {ocrRunning && <small className="template-message">Running free browser OCR on image files...</small>}

              {documentDraft ? (
                <>
                  <div className="draft-summary">
                    <div>
                      <span>Template</span>
                      <strong>{documentDraft.template?.name || "Custom"}</strong>
                    </div>
                    <div>
                      <span>HEM</span>
                      <strong>{currency(documentDraft.assumptions.hemMonthly)}</strong>
                    </div>
                    <div>
                      <span>Financial asset</span>
                      <strong>{currency(documentDraft.assumptions.financialAssetBuffer)}</strong>
                    </div>
                    <div>
                      <span>Income source</span>
                      <strong>{documentDraft.assumptions.incomeSource}</strong>
                    </div>
                    <div>
                      <span>Warnings</span>
                      <strong>{documentDraft.warnings.length}</strong>
                    </div>
                    <div>
                      <span>Field suggestions</span>
                      <strong>{documentDraft.extracted?.fieldSuggestions?.length || 0}</strong>
                    </div>
                  </div>
                  {documentDraft.documents?.length ? (
                    <div className="document-detections">
                      {documentDraft.documents.map((doc) => (
                        <div key={`${doc.fileName}-${doc.size}`} className={doc.warnings?.length ? "needs-review" : ""}>
                          <strong>{doc.fileName}</strong>
                          <span>
                            {doc.type} | {Math.round((doc.confidence || 0) * 100)}% confidence | {doc.suggestions?.length || 0} fields
                          </span>
                          {doc.warnings?.map((warning) => <small key={warning}>{warning}</small>)}
                        </div>
                      ))}
                    </div>
                  ) : null}
                </>
              ) : (
                <div className="empty-state">Upload files or use presets before preparing AOL.</div>
              )}
            </div>
          </section>

          <section className="panel payload-panel" data-fix-section="handoff">
            <div className="panel-title">
              <FileJson size={18} />
              <h2>Extension Handoff</h2>
            </div>
            {prepared ? (
              <>
                <div className="payload-meta">
                  <div>
                    <span>Use in extension</span>
                    <strong>{prepared.caseId}</strong>
                  </div>
                  <div>
                    <span>Backup token</span>
                    <strong>{prepared.token}</strong>
                  </div>
                  <div>
                    <span>Mapping</span>
                    <strong>{prepared.mappingVersion}</strong>
                  </div>
                </div>
                <div className="handoff-note">
                  Open the real Infinity or AOL case tab, open the Chrome extension, enter the Case ID above, then click Start AutoFill. The extension fills only; broker still reviews and manually pushes/submits.
                </div>
                <details className="payload-json">
                  <summary>Developer payload JSON</summary>
                  <pre>{JSON.stringify(prepared.payload, null, 2)}</pre>
                </details>
              </>
            ) : (
              <div className="empty-state">Click Prepare for Extension to build a lender-ready payload.</div>
            )}
          </section>
        </div>

        <section className="panel history-panel">
          <div className="panel-title split-title">
            <div>
              <History size={18} />
              <h2>Case Fill History</h2>
            </div>
            <button className="danger-button" type="button" disabled={!selectedCaseId} onClick={deleteLocalCaseData}>
              <Trash2 size={16} />
              Delete local data
            </button>
          </div>
          {caseHistory.length ? (
            <div className="history-list">
              {caseHistory.map((event, index) => (
                <button
                  type="button"
                  key={`${event.timestamp}-${event.token || index}`}
                  onClick={() => event.token && restorePrepared(event.token)}
                  disabled={!event.token}
                >
                  <span>{new Date(event.timestamp).toLocaleString()}</span>
                  <strong>{event.type}</strong>
                  <small>
                    {event.token
                      ? `${event.template?.name || "No template"} | ${event.errors || 0} errors, ${event.warnings || 0} warnings`
                      : event.type === "autofill"
                        ? `${event.sectionId || "visible section"} | ${event.fieldsFilled?.length || 0} filled, ${event.fieldsSkipped?.length || 0} skipped`
                        : `${event.files?.length || 0} files | ${event.warnings || 0} warnings`}
                  </small>
                </button>
              ))}
            </div>
          ) : (
            <div className="empty-state">No prepared or autofill history for this case yet.</div>
          )}
        </section>

        <section className="panel">
          <div className="panel-title">
            <ShieldCheck size={18} />
            <h2>EasyFlow AI Safety Log</h2>
          </div>
          <div className="log-table">
            <div className="log-row header">
              <span>Time</span>
              <span>Type</span>
              <span>Case</span>
              <span>Details</span>
            </div>
            {auditLog.map((event, index) => (
              <div className="log-row" key={`${event.timestamp}-${index}`}>
                <span>{new Date(event.timestamp).toLocaleString()}</span>
                <span>{event.type}</span>
                <span>{event.caseId}</span>
                <span>
                  {event.type === "prepare" || event.type === "intake-and-prepare"
                    ? `${event.errors} errors, ${event.warnings} warnings`
                    : event.type === "document-intake"
                      ? `${event.files?.length || 0} files, HEM ${currency(event.hemMonthly)}, assets ${currency(event.financialAssetBuffer)}`
                    : `${event.fieldsFilled?.length || 0} filled, ${event.fieldsSkipped?.length || 0} skipped`}
                </span>
              </div>
            ))}
          </div>
        </section>

        <section className="panel developer-panel">
          <div className="panel-title">
            <ExternalLink size={18} />
            <h2>Developer Tools</h2>
          </div>
          <details>
            <summary>Sandbox test page</summary>
            <p>This is only for testing the extension. It is not real Infinity or AOL and should not be part of the broker workflow.</p>
            <a className="ghost-button" href={mockAolPath} target="_blank" rel="noreferrer">
              <ExternalLink size={16} />
              Open Sandbox Test Page
            </a>
          </details>
        </section>
      </section>
    </main>
  );
}
