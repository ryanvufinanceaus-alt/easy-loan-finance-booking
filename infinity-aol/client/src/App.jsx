import React, { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardList,
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
const apiBase = isLoanFormHost
  ? location.origin
  : isClientCallHost || isEasyFlowAiHost
  ? location.origin
  : location.pathname.startsWith("/infinity-aol")
  ? `${location.origin}/infinity-aol`
  : ["localhost", "127.0.0.1"].includes(location.hostname)
    ? "http://127.0.0.1:8797"
    : `${location.origin}/infinity-aol`;
const appBasePath = !isLoanFormHost && !isClientCallHost && !isEasyFlowAiHost && location.pathname.startsWith("/infinity-aol") ? "/infinity-aol" : "";
const mockAolPath = `${appBasePath}/mock-infinity-aol`;
const brandLogoSrc = "/elf-logo.png";

function pageTitle() {
  if (isClientCallHost) return "Client Call Notes - Easy Loan Finance";
  if (isLoanFormHost) return "Loan Form - Easy Loan Finance";
  if (isEasyFlowAiHost) return "EasyFlow AI - Easy Loan Finance";
  return "EasyFlow AI - Infinity & AOL Automation";
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

function initialManualIntake(caseData) {
  if (!caseData) return {};
  const primary = caseData.applicants.find((applicant) => applicant.role === "primary") || {};
  const secondary = caseData.applicants.find((applicant) => applicant.role === "secondary") || {};
  return {
    loanAmount: caseData.loan?.loanAmount || "",
    primaryAnnualIncome: primary.income?.baseAnnual || "",
    secondaryAnnualIncome: secondary.income?.baseAnnual || "",
    primaryDriversLicenceNo: primary.id?.driversLicenceNo || "",
    primaryLicenceExpiryDate: primary.id?.licenceExpiryDate || "",
    primaryLicenceCardNumber: primary.id?.licenceCardNumber || "",
    secondaryDriversLicenceNo: secondary.id?.driversLicenceNo || "",
    secondaryLicenceExpiryDate: secondary.id?.licenceExpiryDate || "",
    secondaryLicenceCardNumber: secondary.id?.licenceCardNumber || ""
  };
}

async function api(path, options) {
  const response = await fetch(`${apiBase}${path}`, {
    headers: { "content-type": "application/json" },
    ...options
  });
  if (!response.ok) throw new Error((await response.json()).error || response.statusText);
  return response.json();
}

function IssueList({ issues }) {
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
          </div>
        </div>
      ))}
    </div>
  );
}

function CaseFacts({ caseData }) {
  if (!caseData) return null;
  const primary = caseData.applicants.find((applicant) => applicant.role === "primary");
  return (
    <div className="facts-grid">
      <div>
        <span>Primary applicant</span>
        <strong>{primary ? `${primary.firstName} ${primary.lastName}` : "Missing"}</strong>
      </div>
      <div>
        <span>Loan amount</span>
        <strong>{currency(caseData.loan.loanAmount)}</strong>
      </div>
      <div>
        <span>Security</span>
        <strong>{caseData.property.address || "Missing address"}</strong>
      </div>
      <div>
        <span>Documents</span>
        <strong>
          {caseData.documentChecklist.filter((doc) => doc.status === "received").length}/{caseData.documentChecklist.length} received
        </strong>
      </div>
    </div>
  );
}

function TeamSettingsPanel({ appName }) {
  const [open, setOpen] = useState(false);
  const [auth, setAuth] = useState(null);
  const [brokers, setBrokers] = useState([]);
  const [form, setForm] = useState({ name: "", email: "", phone: "", accessCode: "" });
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function refresh() {
    const [authData, brokerData] = await Promise.all([
      api("/api/auth/status"),
      api("/api/brokers")
    ]);
    setAuth(authData);
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
      setForm({ name: "", email: "", phone: "", accessCode: "" });
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

  async function logout() {
    await api("/api/auth/logout", { method: "POST" }).catch(() => {});
    window.location.href = `/login?returnTo=${encodeURIComponent(location.pathname + location.search)}`;
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
          <small>{isAdmin ? "Ryan admin can add broker users and access codes here." : "Broker users can use assigned internal tools only."}</small>
          <button type="button" onClick={logout}>Logout</button>
        </div>
        {isAdmin ? (
          <>
            <form className="team-user-form" onSubmit={createBrokerUser}>
              <label>Name<input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="Broker / staff name" required /></label>
              <label>Email<input value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} placeholder="user@easyloanfinance.com.au" required /></label>
              <label>Phone<input value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} placeholder="04..." /></label>
              <label>Access code<input value={form.accessCode} onChange={(event) => setForm({ ...form, accessCode: event.target.value })} placeholder="Private login code" required /></label>
              <button type="submit"><UserPlus size={15} /> Add user</button>
            </form>
            <div className="team-user-list">
              {brokers.map((broker) => (
                <div key={broker.id} className="team-user-row">
                  <div>
                    <strong>{broker.name}</strong>
                    <small>{broker.email || "No email set"}</small>
                  </div>
                  <input
                    defaultValue={broker.accessCode || ""}
                    placeholder="Access code"
                    onBlur={(event) => {
                      if (event.target.value !== (broker.accessCode || "")) saveAccessCode(broker, event.target.value);
                    }}
                  />
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
    <section className="workflow-guide" aria-label="Autofill workflow">
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
  secondApplicantName: "",
  mobile: "",
  email: "",
  preferredLanguage: "Vietnamese / English",
  sourceChannel: "",
  bestTimeToContact: "",
  loanType: "Purchase",
  loanPurpose: "Purchase owner occupied dwelling",
  loanAmount: "",
  propertyValue: "",
  depositEquity: "",
  propertyLocation: "",
  timeline: "",
  dateOfBirth: "",
  address: "",
  residencyStatus: "Australian citizen",
  maritalStatus: "Single",
  dependants: "0",
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
  "Urgent settlement"
];

const loanPurposeOptions = [
  "Purchase owner occupied dwelling",
  "Purchase investment property",
  "Pre-approval - owner occupied",
  "Pre-approval - investment",
  "Refinance existing home loan",
  "Refinance and cash out",
  "Debt consolidation",
  "Construction",
  "Other purpose"
];

const defaultHemProfiles = {
  singleLow: { label: "Single - lean", amount: 3000, note: "Use only when living expenses are clearly modest and supported." },
  singleStandard: { label: "Single - standard", amount: 3450, note: "Good default for most single applicants before verified expenses." },
  singleHigher: { label: "Single - higher buffer", amount: 4000, note: "Use when lifestyle, rent, insurance or transport costs look higher." },
  coupleStandard: { label: "Couple - standard", amount: 4500, note: "Good default for two-adult households before verified expenses." },
  coupleHigher: { label: "Couple - higher buffer", amount: 5200, note: "Use when dependants, rent or higher discretionary spend are likely." }
};

const maritalStatusOptions = ["Single", "Married", "Divorced", "Widowed"];
const residentialStatusOptions = ["Own home", "Own home with mortgage", "Renting", "Boarding"];
const residencyOptions = ["Australian Citizen", "Australian PR", "Australian TR", "NZ Citizen"];
const employmentTypeOptions = ["PAYG", "Self - employed", "Unemployed", "Retired"];
const employmentBasisOptions = ["Full-time", "Part-time", "Contract", "Temporary", "Internship"];
const yesNoOptions = ["Yes", "No"];
const yesNoAdviseOptions = ["Yes", "No", "Please advise"];
const insurancePolicyOptions = ["Yes", "No", "I would like to know more"];

function SelectField({ label, value, onChange, options }) {
  return (
    <label>
      {label}
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="">Please Select</option>
        {options.map((option) => <option key={option}>{option}</option>)}
      </select>
    </label>
  );
}

function ClientLoanFormHeader({ title, description }) {
  return (
    <header className="client-form-hero">
      <div className="client-form-brand">
        <img src="/elf-logo.png" alt="Easy Loan Finance" />
        <div>
          <span>Easy Loan Finance</span>
          <strong>Quick Loan, Easy Life</strong>
        </div>
      </div>
      <div className="client-form-copy">
        <p className="client-form-kicker">Secure client information</p>
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

function CallNotesPage({ onOpenAutofill }) {
  const [form, setForm] = useState(emptyCallNote);
  const [notes, setNotes] = useState([]);
  const [intakes, setIntakes] = useState([]);
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [redFlags, setRedFlags] = useState([]);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

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
    refreshIntakes().catch((err) => setError(err.message));
  }, []);

  const filteredNotes = useMemo(() => {
    const terms = search.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const source = terms.length
      ? notes.filter((note) => {
          const haystack = [
            note.id,
            note.clientName,
            note.secondApplicantName,
            note.mobile,
            note.email,
            note.loanPurpose,
            note.convertedCaseId
          ].join(" ").toLowerCase();
          return terms.every((term) => haystack.includes(term));
        })
      : notes.slice(0, 6);
    return source.slice(0, 12);
  }, [notes, search]);

  const filteredIntakes = useMemo(() => {
    const terms = search.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const source = terms.length
      ? intakes.filter((intake) => {
          const haystack = [
            intake.clientName,
            intake.secondApplicantName,
            intake.mobile,
            intake.email,
            intake.loanPurpose,
            intake.convertedCaseId,
            intake.status
          ].join(" ").toLowerCase();
          return terms.every((term) => haystack.includes(term));
        })
      : intakes.slice(0, 8);
    return source.slice(0, 12);
  }, [intakes, search]);

  function updateField(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function loadNote(note) {
    setSelectedId(note.id);
    setForm({ ...emptyCallNote, ...note });
    setRedFlags(note.redFlags || []);
    setMessage(`Loaded ${note.id}`);
  }

  function toggleRedFlag(flag) {
    setRedFlags((items) => (items.includes(flag) ? items.filter((item) => item !== flag) : [...items, flag]));
  }

  async function saveCallNote({ convert = false } = {}) {
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const saved = await api("/api/call-notes", {
        method: "POST",
        body: JSON.stringify({ ...form, redFlags })
      });
      let output = saved;
      if (convert) {
        const converted = await api(`/api/call-notes/${saved.id}/convert-to-case`, { method: "POST", body: "{}" });
        output = converted.note;
        setMessage(`Draft case created: ${converted.case.id}. You can now prepare it in EasyFlow AI.`);
      } else {
        setMessage(`Call note saved: ${saved.id}`);
      }
      setSelectedId(output.id);
      setForm(emptyCallNote);
      setRedFlags([]);
      await refreshNotes();
      await refreshIntakes();
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
      const converted = await api(`/api/call-notes/${note.id}/convert-to-case`, { method: "POST", body: "{}" });
      setMessage(`Draft case ready: ${converted.case.id}`);
      await refreshNotes();
      await refreshIntakes();
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
      setMessage(`Loan Form link copied: ${intake.url}`);
      await refreshNotes();
      await refreshIntakes();
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
      await refreshIntakes();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="notes-shell">
      <aside className="notes-sidebar">
        <div className="brand-block">
          <img className="brand-logo" src={brandLogoSrc} alt="Easy Loan Finance" />
          <div>
            <span>Easy Loan Finance</span>
            <strong>Client Call Notes</strong>
          </div>
        </div>
        <button className="ghost-button sidebar-action" type="button" onClick={onOpenAutofill}>
          <ExternalLink size={16} />
          EasyFlow AI
        </button>
        <TeamSettingsPanel appName="Client Call Notes" />
        <label className="note-search">
          Search clients
          <div className="search-input">
            <Search size={16} />
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Name, phone, case" />
          </div>
        </label>
        <div className="note-list">
          {filteredNotes.length ? filteredNotes.map((note) => (
            <button className={note.id === selectedId ? "active" : ""} key={note.id} type="button" onClick={() => loadNote(note)}>
              <span>{note.convertedCaseId || note.id}</span>
              <strong>{[note.clientName, note.secondApplicantName].filter(Boolean).join(" & ") || "Unnamed client"}</strong>
              <small>{note.mobile || note.email || note.status}</small>
            </button>
          )) : <div className="case-search-empty">No call notes yet.</div>}
        </div>
      </aside>

      <section className="notes-workspace">
        <header className="topbar">
          <div>
            <span>Quick phone intake only</span>
            <h1>Client Call Notes</h1>
            <p>Use this for a short call summary. Send the Loan Form when the client needs to provide full application details.</p>
          </div>
          <div className="actions">
            <button className="ghost-button" type="button" onClick={() => { setForm(emptyCallNote); setRedFlags([]); setSelectedId(""); }}>
              New
            </button>
            <button className="ghost-button" type="button" disabled={saving} onClick={() => saveCallNote()}>
              Save Note
            </button>
            <button className="primary-button" type="button" disabled={saving || !form.clientName.trim()} onClick={() => saveCallNote({ convert: true })}>
              {saving ? <RefreshCw size={17} className="spin" /> : <Play size={17} />}
              Save + Draft Case
            </button>
          </div>
        </header>
        {error && <div className="error-banner">{error}</div>}
        {message && <div className="success-banner">{message}</div>}

        <div className="notes-grid">
          <section className="panel note-panel">
            <div className="panel-title"><ClipboardList size={18} /><h2>Client & Loan</h2></div>
            <div className="note-form-grid">
              <label>Client name<input value={form.clientName} onChange={(event) => updateField("clientName", event.target.value)} placeholder="Main applicant" /></label>
              <label>Second applicant<input value={form.secondApplicantName} onChange={(event) => updateField("secondApplicantName", event.target.value)} placeholder="Leave blank if single" /></label>
              <label>Mobile<input value={form.mobile} onChange={(event) => updateField("mobile", event.target.value)} /></label>
              <label>Email<input value={form.email} onChange={(event) => updateField("email", event.target.value)} /></label>
              <label>Language<select value={form.preferredLanguage} onChange={(event) => updateField("preferredLanguage", event.target.value)}><option>Vietnamese / English</option><option>English</option><option>Vietnamese</option></select></label>
              <label>Source<input value={form.sourceChannel} onChange={(event) => updateField("sourceChannel", event.target.value)} placeholder="Referral, Facebook, website" /></label>
              <label>Loan type<select value={form.loanType} onChange={(event) => updateField("loanType", event.target.value)}><option>Purchase</option><option>Refinance</option><option>Pre-approval</option><option>Construction</option></select></label>
              <label>Loan purpose<select value={form.loanPurpose} onChange={(event) => updateField("loanPurpose", event.target.value)}>{loanPurposeOptions.map((option) => <option key={option}>{option}</option>)}</select></label>
              <label>Loan amount<input value={form.loanAmount} onChange={(event) => updateField("loanAmount", event.target.value)} placeholder="390000" /></label>
              <label>Property value<input value={form.propertyValue} onChange={(event) => updateField("propertyValue", event.target.value)} /></label>
              <label>Deposit/equity<input value={form.depositEquity} onChange={(event) => updateField("depositEquity", event.target.value)} /></label>
              <label>Property/location<input value={form.propertyLocation} onChange={(event) => updateField("propertyLocation", event.target.value)} /></label>
              <label>Timeline<input value={form.timeline} onChange={(event) => updateField("timeline", event.target.value)} placeholder="ASAP, 3 months, pre-approval" /></label>
            </div>
          </section>

          <section className="panel note-panel">
            <div className="panel-title"><ShieldCheck size={18} /><h2>Fact Find Snapshot</h2></div>
            <p className="panel-helper">Only ask enough to triage borrowing path. Full fact-find belongs in the Loan Form.</p>
            <div className="note-form-grid">
              <label>Residency<select value={form.residencyStatus} onChange={(event) => updateField("residencyStatus", event.target.value)}>{residencyOptions.map((option) => <option key={option}>{option}</option>)}</select></label>
              <label>Dependants<input value={form.dependants} onChange={(event) => updateField("dependants", event.target.value)} /></label>
              <label>Employment<select value={form.employmentType} onChange={(event) => updateField("employmentType", event.target.value)}><option>PAYG</option><option>Self-employed</option><option>Casual</option><option>Contractor</option><option>Unemployed</option></select></label>
              <label>Total income p.a.<input value={form.annualIncome} onChange={(event) => updateField("annualIncome", event.target.value)} placeholder="Main or combined rough income" /></label>
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
            <details className="advanced-template optional-call-detail">
              <summary>Optional details if already known</summary>
              <div className="note-form-grid">
                <label>DOB<input value={form.dateOfBirth} onChange={(event) => updateField("dateOfBirth", event.target.value)} placeholder="YYYY-MM-DD" /></label>
                <label>Address<input value={form.address} onChange={(event) => updateField("address", event.target.value)} /></label>
                <label>Marital<select value={form.maritalStatus} onChange={(event) => updateField("maritalStatus", event.target.value)}><option>Single</option><option>Married</option><option>Defacto</option><option>Separated</option></select></label>
                <label>Employer<input value={form.employerName} onChange={(event) => updateField("employerName", event.target.value)} /></label>
                <label>Occupation<input value={form.occupation} onChange={(event) => updateField("occupation", event.target.value)} /></label>
                <label>Second income p.a.<input value={form.secondAnnualIncome} onChange={(event) => updateField("secondAnnualIncome", event.target.value)} /></label>
              </div>
            </details>
          </section>

          <section className="panel note-panel note-text-panel">
            <div className="panel-title"><FileJson size={18} /><h2>Broker Notes</h2></div>
            <div className="note-text-grid">
              <label>Quick notes<textarea value={form.quickNotes} onChange={(event) => updateField("quickNotes", event.target.value)} placeholder="What client said on call" /></label>
              <label>Broker assessment<textarea value={form.brokerAssessment} onChange={(event) => updateField("brokerAssessment", event.target.value)} placeholder="Serviceability, red flags, likely lender path" /></label>
              <label>Next action<textarea value={form.nextAction} onChange={(event) => updateField("nextAction", event.target.value)} placeholder="Send intake link, collect payslips, book appointment" /></label>
            </div>
          </section>

          <section className="panel note-panel recent-note-panel">
            <div className="panel-title"><History size={18} /><h2>Recent / Search Results</h2></div>
            <div className="recent-note-list">
              {filteredNotes.map((note) => (
                <div key={`row-${note.id}`}>
                  <button type="button" onClick={() => loadNote(note)}>
                    <strong>{[note.clientName, note.secondApplicantName].filter(Boolean).join(" & ") || "Unnamed client"}</strong>
                    <span>{note.convertedCaseId || note.status} | {new Date(note.updatedAt || note.createdAt).toLocaleString()}</span>
                  </button>
                  <div>
                    {!note.convertedCaseId && <button type="button" onClick={() => convertSelected(note)}>Draft case</button>}
                    <button type="button" onClick={() => createIntakeLink(note)}>Copy intake link</button>
                    {note.convertedCaseId && <button type="button" onClick={onOpenAutofill}>Open Autofill</button>}
                    <button type="button" className="danger-link" onClick={() => deleteNote(note)}>Delete</button>
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="panel note-panel recent-note-panel">
            <div className="panel-title"><FileJson size={18} /><h2>Loan Forms</h2></div>
            <div className="recent-note-list">
              {filteredIntakes.length ? filteredIntakes.map((intake) => (
                <div key={intake.id}>
                  <button type="button" onClick={() => {
                    const linked = notes.find((note) => note.id === intake.callNoteId);
                    if (linked) loadNote(linked);
                  }}>
                    <strong>{[intake.clientName, intake.secondApplicantName].filter(Boolean).join(" & ") || "Unnamed client"}</strong>
                    <span>{intake.status} | {intake.submittedAt ? `Submitted ${new Date(intake.submittedAt).toLocaleDateString()}` : `Sent ${new Date(intake.createdAt).toLocaleDateString()}`}</span>
                    <small>{intake.convertedCaseId || intake.callNoteId} | {intake.loanPurpose || "Purpose not set"}</small>
                  </button>
                  <div>
                    <button type="button" onClick={async () => {
                      await navigator.clipboard?.writeText(intake.url).catch(() => {});
                      setMessage(`Loan Form link copied: ${intake.url}`);
                    }}>Copy link</button>
                    {intake.convertedCaseId && <button type="button" onClick={onOpenAutofill}>Open EasyFlow</button>}
                  </div>
                </div>
              )) : <div className="case-search-empty">No loan forms yet.</div>}
            </div>
          </section>
        </div>
      </section>
    </main>
  );
}

function ClientIntakePage({ token, publicForm = false }) {
  const [meta, setMeta] = useState(null);
  const [form, setForm] = useState({
    clientName: "",
    secondApplicantName: "",
    mobile: "",
    email: "",
    preferredLanguage: "Vietnamese / English",
    loanType: "Purchase",
    loanPurpose: "",
    loanAmount: "",
    propertyValue: "",
    depositEquity: "",
    propertyLocation: "",
    timeline: "",
    dateOfBirth: "",
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
    currentAddressFromDate: "",
    currentResidentialStatus: "",
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
    clientNotes: ""
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    document.title = pageTitle();
  }, []);
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    const endpointToken = publicForm ? "public" : token;
    api(`/api/client-intake/${endpointToken}`)
      .then((result) => {
        setMeta(result);
        setForm((current) => ({ ...current, ...Object.fromEntries(Object.entries(result).filter(([, value]) => value !== "" && value !== null)) }));
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [token, publicForm]);

  function updateField(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  async function submitIntake(event) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      const endpointToken = publicForm ? "public" : token;
      await api(`/api/client-intake/${endpointToken}`, {
        method: "POST",
        body: JSON.stringify(form)
      });
      setSubmitted(true);
      setMessage("");
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <main className="client-intake-shell"><div className="empty-state">Loading loan form...</div></main>;
  if (submitted) {
    return (
      <main className="client-intake-shell">
        <section className="client-intake-card client-thank-you-card">
          <ClientLoanFormHeader
            title="Thank you. We have received your loan form."
            description="Your information has been sent securely to Easy Loan Finance. A broker will review your details and contact you as soon as practical."
          />
          <div className="client-thank-you-body">
            <CheckCircle2 size={42} />
            <div>
              <h2>What happens next</h2>
              <p>We will check the information you provided, match it with any call notes already on file, and let you know if anything else is needed before preparing lender or application documents.</p>
              <p>This confirmation means your form was received. It is not a loan approval or lender submission.</p>
            </div>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="client-intake-shell">
      <form className="client-intake-card" onSubmit={submitIntake}>
        <ClientLoanFormHeader
          title="Loan Form / Thong tin vay"
          description="This is the full client information form. It links with any phone call note we already have, and your broker will review everything before any application submission."
        />
        {error && <div className="error-banner">{error}</div>}
        {message && <div className="success-banner">{message}</div>}
        {meta?.status === "submitted" && !message ? <div className="success-banner">This form has already been submitted. You can submit again if you need to update details.</div> : null}

        <section>
          <h2>Personal Details</h2>
          <div className="client-intake-grid">
            <label>Full Name<input required value={form.clientName} onChange={(event) => updateField("clientName", event.target.value)} /></label>
            <label>Second applicant<input value={form.secondApplicantName} onChange={(event) => updateField("secondApplicantName", event.target.value)} /></label>
            <label>Date of birth<input value={form.dateOfBirth} onChange={(event) => updateField("dateOfBirth", event.target.value)} placeholder="DD/MM/YYYY" /></label>
            <label>Email<input required value={form.email} onChange={(event) => updateField("email", event.target.value)} placeholder="example@example.com" /></label>
            <label>Mobile<input required value={form.mobile} onChange={(event) => updateField("mobile", event.target.value)} /></label>
            <SelectField label="Marital Status" value={form.maritalStatus} onChange={(value) => updateField("maritalStatus", value)} options={maritalStatusOptions} />
            <SelectField label="Residential Status" value={form.residencyStatus} onChange={(value) => updateField("residencyStatus", value)} options={residencyOptions} />
            <label>Visa Sub-class<input value={form.visaSubclass || ""} onChange={(event) => updateField("visaSubclass", event.target.value)} /></label>
            <label>Number of Dependents<input value={form.dependants} onChange={(event) => updateField("dependants", event.target.value)} /></label>
            <label>DOB of Dependent 1<input value={form.dependant1Dob} onChange={(event) => updateField("dependant1Dob", event.target.value)} placeholder="DD/MM/YYYY" /></label>
            <label>DOB of Dependent 2<input value={form.dependant2Dob} onChange={(event) => updateField("dependant2Dob", event.target.value)} placeholder="DD/MM/YYYY" /></label>
            <label>DOB of Dependent 3<input value={form.dependant3Dob} onChange={(event) => updateField("dependant3Dob", event.target.value)} placeholder="DD/MM/YYYY" /></label>
            <label>DOB of Dependent 4<input value={form.dependant4Dob} onChange={(event) => updateField("dependant4Dob", event.target.value)} placeholder="DD/MM/YYYY" /></label>
          </div>
        </section>

        <section>
          <h2>Residential History Within The Last 3 Years</h2>
          <div className="client-intake-grid">
            <label>Current residential address<input value={form.address} onChange={(event) => updateField("address", event.target.value)} /></label>
            <label>Suburb<input value={form.currentSuburb} onChange={(event) => updateField("currentSuburb", event.target.value)} /></label>
            <label>State<input value={form.currentState} onChange={(event) => updateField("currentState", event.target.value)} /></label>
            <label>From Date<input value={form.currentAddressFromDate} onChange={(event) => updateField("currentAddressFromDate", event.target.value)} placeholder="DD/MM/YYYY" /></label>
            <SelectField label="Residential Status" value={form.currentResidentialStatus} onChange={(value) => updateField("currentResidentialStatus", value)} options={residentialStatusOptions} />
            <label>Previous residential address<input value={form.previousAddress} onChange={(event) => updateField("previousAddress", event.target.value)} /></label>
            <label>Previous suburb<input value={form.previousSuburb} onChange={(event) => updateField("previousSuburb", event.target.value)} /></label>
            <label>Previous state<input value={form.previousState} onChange={(event) => updateField("previousState", event.target.value)} /></label>
            <label>Previous postal code<input value={form.previousPostcode} onChange={(event) => updateField("previousPostcode", event.target.value)} /></label>
            <SelectField label="Previous Residential Status" value={form.previousResidentialStatus} onChange={(value) => updateField("previousResidentialStatus", value)} options={residentialStatusOptions} />
          </div>
        </section>

        <section>
          <h2>Employment History Within The Last 3 Years</h2>
          <div className="client-intake-grid">
            <SelectField label="Employment Type" value={form.employmentType} onChange={(value) => updateField("employmentType", value)} options={employmentTypeOptions} />
            <label>Business Name<input value={form.employerName} onChange={(event) => updateField("employerName", event.target.value)} /></label>
            <label>Business Address<input value={form.businessAddress} onChange={(event) => updateField("businessAddress", event.target.value)} /></label>
            <label>Job Title<input value={form.occupation} onChange={(event) => updateField("occupation", event.target.value)} /></label>
            <SelectField label="Employment Basis" value={form.employmentBasis} onChange={(value) => updateField("employmentBasis", value)} options={employmentBasisOptions} />
            <label>From Date<input value={form.employmentFromDate} onChange={(event) => updateField("employmentFromDate", event.target.value)} placeholder="DD/MM/YYYY" /></label>
            <label>Contact Name<input value={form.employmentContactName} onChange={(event) => updateField("employmentContactName", event.target.value)} /></label>
            <label>Contact Number<input value={form.employmentContactNumber} onChange={(event) => updateField("employmentContactNumber", event.target.value)} /></label>
            <label>Main income p.a.<input value={form.annualIncome} onChange={(event) => updateField("annualIncome", event.target.value)} /></label>
            <label>Second income p.a.<input value={form.secondAnnualIncome} onChange={(event) => updateField("secondAnnualIncome", event.target.value)} /></label>
            <label>Rental income p.a.<input value={form.rentalIncomeAnnual} onChange={(event) => updateField("rentalIncomeAnnual", event.target.value)} /></label>
            <SelectField label="Previous Employment Type" value={form.previousEmploymentType} onChange={(value) => updateField("previousEmploymentType", value)} options={employmentBasisOptions} />
            <label>Previous Business Name<input value={form.previousBusinessName} onChange={(event) => updateField("previousBusinessName", event.target.value)} /></label>
            <label>Previous Job Title<input value={form.previousJobTitle} onChange={(event) => updateField("previousJobTitle", event.target.value)} /></label>
            <SelectField label="Previous Employment Basis" value={form.previousEmploymentBasis} onChange={(value) => updateField("previousEmploymentBasis", value)} options={employmentBasisOptions} />
            <label>Previous From Date<input value={form.previousEmploymentFromDate} onChange={(event) => updateField("previousEmploymentFromDate", event.target.value)} /></label>
            <label>Previous To Date<input value={form.previousEmploymentToDate} onChange={(event) => updateField("previousEmploymentToDate", event.target.value)} /></label>
          </div>
        </section>

        <section>
          <h2>Living Expenses</h2>
          <div className="client-intake-grid">
            <label>Expenses<input value={form.generalExpenses} onChange={(event) => updateField("generalExpenses", event.target.value)} /></label>
            <label>AP 1 - Amount ($)<input value={form.applicant1Expenses} onChange={(event) => updateField("applicant1Expenses", event.target.value)} /></label>
            <label>AP 2 - Amount ($)<input value={form.applicant2Expenses} onChange={(event) => updateField("applicant2Expenses", event.target.value)} /></label>
            <SelectField label="Private Health Insurance - Applicant 1" value={form.applicant1PrivateHealth} onChange={(value) => updateField("applicant1PrivateHealth", value)} options={yesNoOptions} />
            <label>Applicant 1 Amount ($)/month<input value={form.applicant1PrivateHealthAmount} onChange={(event) => updateField("applicant1PrivateHealthAmount", event.target.value)} /></label>
            <SelectField label="Private Health Insurance - Applicant 2" value={form.applicant2PrivateHealth} onChange={(value) => updateField("applicant2PrivateHealth", value)} options={yesNoOptions} />
            <label>Applicant 2 Amount ($)/month<input value={form.applicant2PrivateHealthAmount} onChange={(event) => updateField("applicant2PrivateHealthAmount", event.target.value)} /></label>
            <SelectField label="Income protection or life insurance policies" value={form.insurancePolicies} onChange={(value) => updateField("insurancePolicies", value)} options={insurancePolicyOptions} />
            <label>Monthly living expense total<input value={form.hemMonthly} onChange={(event) => updateField("hemMonthly", event.target.value)} placeholder="Leave blank if unsure" /></label>
          </div>
        </section>

        <section>
          <h2>Your Assets</h2>
          <div className="client-intake-grid">
            <label>Real Estate Address<input value={form.realEstateAssetAddress} onChange={(event) => updateField("realEstateAssetAddress", event.target.value)} /></label>
            <label>Real Estate Value ($)<input value={form.realEstateAssetValue} onChange={(event) => updateField("realEstateAssetValue", event.target.value)} /></label>
            <label>Cash/Savings Amount ($)<input value={form.cashSavingsAmount} onChange={(event) => updateField("cashSavingsAmount", event.target.value)} /></label>
            <label>Banking with<input value={form.cashSavingsBank} onChange={(event) => updateField("cashSavingsBank", event.target.value)} /></label>
            <label>Car/Motor Vehicle Model/year<input value={form.motorVehicleModelYear} onChange={(event) => updateField("motorVehicleModelYear", event.target.value)} /></label>
            <label>Motor Vehicle Estimated value ($)<input value={form.motorVehicleValue} onChange={(event) => updateField("motorVehicleValue", event.target.value)} /></label>
            <label>Home contents item<input value={form.homeContentsItem} onChange={(event) => updateField("homeContentsItem", event.target.value)} /></label>
            <label>Home contents estimated value ($)<input value={form.homeContentsValue} onChange={(event) => updateField("homeContentsValue", event.target.value)} /></label>
            <label>Savings/assets total<input value={form.financialAssetBuffer} onChange={(event) => updateField("financialAssetBuffer", event.target.value)} /></label>
          </div>
        </section>

        <section>
          <h2>Loan Details</h2>
          <div className="client-intake-grid">
            <label>Your loan purpose<select value={form.loanPurpose} onChange={(event) => updateField("loanPurpose", event.target.value)}><option value="">Please Select</option>{loanPurposeOptions.map((option) => <option key={option}>{option}</option>)}</select></label>
            <label>Type of property<input value={form.propertyType} onChange={(event) => updateField("propertyType", event.target.value)} /></label>
            <label>How much would you like to borrow ($)<input value={form.loanAmount} onChange={(event) => updateField("loanAmount", event.target.value)} placeholder="390000" /></label>
            <label>Location (intended postcode OR address)<input value={form.propertyLocation} onChange={(event) => updateField("propertyLocation", event.target.value)} /></label>
            <label>Estimated property value ($)<input value={form.propertyValue} onChange={(event) => updateField("propertyValue", event.target.value)} /></label>
            <label>Deposit/equity<input value={form.depositEquity} onChange={(event) => updateField("depositEquity", event.target.value)} /></label>
            <SelectField label="Are you first home buyer?" value={form.firstHomeBuyer} onChange={(value) => updateField("firstHomeBuyer", value)} options={yesNoOptions} />
            <SelectField label="Would you like fixed interest rate for a certain period?" value={form.fixedRatePreference} onChange={(value) => updateField("fixedRatePreference", value)} options={yesNoAdviseOptions} />
            <SelectField label="Would you like interest rate to be variable?" value={form.variableRatePreference} onChange={(value) => updateField("variableRatePreference", value)} options={yesNoAdviseOptions} />
            <SelectField label="Would you like to consider a split home loan?" value={form.splitLoanPreference} onChange={(value) => updateField("splitLoanPreference", value)} options={yesNoAdviseOptions} />
            <label>Loan term<select value={form.loanTermYears} onChange={(event) => updateField("loanTermYears", event.target.value)}><option>30</option><option>25</option><option>40</option></select></label>
            <label>Timeline<input value={form.timeline} onChange={(event) => updateField("timeline", event.target.value)} placeholder="ASAP, 3 months, pre-approval" /></label>
            <SelectField label="Credit issue" value={form.creditIssue} onChange={(value) => updateField("creditIssue", value)} options={["No", "Unsure", "Yes"]} />
          </div>
          <label className="client-wide-field">Existing debts / comments<textarea value={form.existingDebtsSummary} onChange={(event) => updateField("existingDebtsSummary", event.target.value)} /></label>
          <label className="client-wide-field">Anything else for your broker<textarea value={form.clientNotes} onChange={(event) => updateField("clientNotes", event.target.value)} /></label>
        </section>

        <button className="primary-button client-submit" type="submit" disabled={saving}>
          {saving ? <RefreshCw size={17} className="spin" /> : <CheckCircle2 size={17} />}
          Submit to Easy Loan Finance
        </button>
      </form>
    </main>
  );
}

export default function App() {
  const [view, setView] = useState(() => (isClientCallHost || location.pathname.includes("call-notes") || location.pathname.includes("client-call") ? "notes" : "autofill"));
  const [cases, setCases] = useState([]);
  const [caseSearch, setCaseSearch] = useState("");
  const [selectedCaseId, setSelectedCaseId] = useState("");
  const [caseData, setCaseData] = useState(null);
  const [prepared, setPrepared] = useState(null);
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
  const [hemProfileKey, setHemProfileKey] = useState("singleStandard");
  const [hemProfiles, setHemProfiles] = useState(() => storageGet("easyflow-hem-profiles", defaultHemProfiles));
  const [financialAssetBuffer, setFinancialAssetBuffer] = useState(30000);
  const [documentDraft, setDocumentDraft] = useState(null);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [ocrRunning, setOcrRunning] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    document.title = pageTitle();
  }, []);

  const showMock = location.pathname === "/mock-infinity-aol" || location.pathname === "/infinity-aol/mock-infinity-aol";
  const intakeToken = location.pathname.match(/^\/(?:infinity-aol\/)?(?:client-info|loan-form|apply)\/([^/]+)/)?.[1] || "";
  const publicLoanForm = /^\/(?:infinity-aol\/)?(?:client-info|loan-form|apply)\/?$/.test(location.pathname) || (isLoanFormHost && location.pathname === "/");

  useEffect(() => {
    if (showMock) return;
    api("/api/cases").then(setCases).catch((err) => setError(err.message));
    api("/api/templates").then(setTemplates).catch((err) => setError(err.message));
    api("/api/audit-log").then(setAuditLog).catch(() => {});
  }, [showMock]);

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
    setHemProfileKey(saved.hemProfileKey || ((caseData.applicants?.length || 1) > 1 ? "coupleStandard" : "singleStandard"));
    setFinancialAssetBuffer(Number(saved.financialAssetBuffer || 30000));
  }, [caseData]);

  const filteredCases = useMemo(() => {
    const terms = caseSearch.trim().toLowerCase().split(/\s+/).filter(Boolean);
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
        ].join(" ").toLowerCase();
        return terms.every((term) => haystack.includes(term));
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
    setTemplateJson(JSON.stringify(selectedTemplate, null, 2));
    if (selectedTemplate.defaults?.hemMonthly) setHemMonthly(selectedTemplate.defaults.hemMonthly);
    if (selectedTemplate.defaults?.financialAssetBuffer) setFinancialAssetBuffer(selectedTemplate.defaults.financialAssetBuffer);
    setTemplateMessage("");
  }, [selectedTemplate]);

  function currentTemplatePayload() {
    if (!templateJson.trim()) return null;
    return JSON.parse(templateJson);
  }

  function currentManualIntake() {
    return {
      ...manualIntake,
      loanAmount: parseMoneyInput(manualIntake.loanAmount),
      primaryAnnualIncome: parseMoneyInput(manualIntake.primaryAnnualIncome),
      secondaryAnnualIncome: parseMoneyInput(manualIntake.secondaryAnnualIncome),
      hemMonthly,
      hemProfileKey,
      financialAssetBuffer
    };
  }

  function updateHemProfile(profileKey, changes) {
    setHemProfiles((current) => {
      const next = { ...current, [profileKey]: { ...current[profileKey], ...changes } };
      storageSet("easyflow-hem-profiles", next);
      return next;
    });
  }

  function applyHemProfile(profileKey) {
    const profile = hemProfiles[profileKey];
    if (!profile) return;
    setHemProfileKey(profileKey);
    setHemMonthly(Number(profile.amount || 0));
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

  async function prepareInfinity() {
    if (!selectedCaseId) {
      setError("Search and select a case first.");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const result = await api(`/api/cases/${selectedCaseId}/prepare-infinity-aol`, {
        method: "POST",
        body: JSON.stringify({
          templateId: selectedTemplateId,
          templateOverrides: currentTemplatePayload(),
          manualIntake: currentManualIntake(),
          hemMonthly,
          financialAssetBuffer
        })
      });
      setPrepared(result);
      if (result.documentDraft || result.payload?.documentIntake) setDocumentDraft(result.documentDraft || result.payload.documentIntake);
      setAuditLog(await api("/api/audit-log"));
      setCaseHistory(await api(`/api/cases/${selectedCaseId}/history`));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
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
      formData.append("financialAssetBuffer", String(financialAssetBuffer));
      formData.append("templateId", selectedTemplateId);
      formData.append("templateOverrides", JSON.stringify(currentTemplatePayload()));
      formData.append("manualIntake", JSON.stringify(currentManualIntake()));

      const endpoint = prepare ? "intake-and-prepare" : "document-intake";
      const response = await fetch(`${apiBase}/api/cases/${selectedCaseId}/${endpoint}`, {
        method: "POST",
        body: formData
      });
      if (!response.ok) throw new Error((await response.json()).error || response.statusText);

      const result = await response.json();
      setDocumentDraft(result.draft || result.documentDraft);
      if (prepare) setPrepared(result);
      setAuditLog(await api("/api/audit-log"));
      setCaseHistory(await api(`/api/cases/${selectedCaseId}/history`));
    } catch (err) {
      setError(err.message);
    } finally {
      setUploading(false);
    }
  }

  async function saveTemplate() {
    setError("");
    setTemplateMessage("");
    try {
      const template = currentTemplatePayload();
      const saved = await api(`/api/templates/${template.id}`, {
        method: "PUT",
        body: JSON.stringify(template)
      });
      setTemplates((items) => {
        const next = items.filter((item) => item.id !== saved.id);
        return [...next, saved].sort((a, b) => a.name.localeCompare(b.name));
      });
      setSelectedTemplateId(saved.id);
      setTemplateMessage("Template saved. Future prepares can use this edited version.");
    } catch (err) {
      setError(`Template JSON is not valid: ${err.message}`);
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
    ["Primary income", manualIntake.primaryAnnualIncome ? currency(parseMoneyInput(manualIntake.primaryAnnualIncome)) : "CRM/file"],
    ["Secondary income", manualIntake.secondaryAnnualIncome ? currency(parseMoneyInput(manualIntake.secondaryAnnualIncome)) : caseData?.applicants?.length > 1 ? "CRM/file" : "N/A"],
    ["HEM / living", currency(hemMonthly)],
    ["Financial asset", currency(financialAssetBuffer)],
    ["Files queued", String(queuedFiles.length)],
    ["Fields found", String(documentDraft?.extracted?.fieldSuggestions?.length || 0)],
    ["Warnings", String(documentDraft?.warnings?.length || 0)],
    ["Last payload", prepared?.token ? prepared.token.slice(0, 10) : "Not prepared"]
  ];

  if (showMock) return <MockInfinity />;
  if (intakeToken || publicLoanForm) return <ClientIntakePage token={intakeToken} publicForm={!intakeToken} />;
  if (view === "notes") return <CallNotesPage onOpenAutofill={() => setView("autofill")} />;

  return (
    <main className="app-shell">
      <aside className="case-sidebar">
        <div className="brand-block">
          <img className="brand-logo" src={brandLogoSrc} alt="Easy Loan Finance" />
          <div>
            <span>Easy Loan Finance</span>
            <strong>EasyFlow AI</strong>
          </div>
        </div>
        <button className="ghost-button sidebar-action" type="button" onClick={() => setView("notes")}>
          <ClipboardList size={16} />
          Client Call
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
            <button className="primary-button" type="button" disabled={loading || !caseData || !selectedCaseId} onClick={prepareInfinity}>
              {loading ? <RefreshCw size={17} className="spin" /> : <Play size={17} />}
              Prepare for Extension
            </button>
          </div>
        </header>

        {error && <div className="error-banner">{error}</div>}

        <CaseFacts caseData={caseData} />
        <WorkflowGuide selectedCaseId={selectedCaseId} prepared={prepared} documentDraft={documentDraft} />

        <div className="main-grid">
          <section className="panel">
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
                Loan amount
                <input
                  value={manualIntake.loanAmount || ""}
                  onChange={(event) => setManualIntake((value) => ({ ...value, loanAmount: event.target.value }))}
                  placeholder="$390,000"
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
              <label>
                Secondary annual income
                <input
                  value={manualIntake.secondaryAnnualIncome || ""}
                  onChange={(event) => setManualIntake((value) => ({ ...value, secondaryAnnualIncome: event.target.value }))}
                  placeholder="Leave blank for single applicant"
                />
              </label>
              <label>
                Primary licence no.
                <input
                  value={manualIntake.primaryDriversLicenceNo || ""}
                  onChange={(event) => setManualIntake((value) => ({ ...value, primaryDriversLicenceNo: event.target.value }))}
                />
              </label>
              <label>
                Primary card no.
                <input
                  value={manualIntake.primaryLicenceCardNumber || ""}
                  onChange={(event) => setManualIntake((value) => ({ ...value, primaryLicenceCardNumber: event.target.value }))}
                />
              </label>
              <label>
                Primary expiry
                <input
                  value={manualIntake.primaryLicenceExpiryDate || ""}
                  onChange={(event) => setManualIntake((value) => ({ ...value, primaryLicenceExpiryDate: event.target.value }))}
                  placeholder="YYYY-MM-DD"
                />
              </label>
              {caseData?.applicants?.length > 1 && (
                <>
                  <label>
                    Secondary licence no.
                    <input
                      value={manualIntake.secondaryDriversLicenceNo || ""}
                      onChange={(event) => setManualIntake((value) => ({ ...value, secondaryDriversLicenceNo: event.target.value }))}
                    />
                  </label>
                  <label>
                    Secondary card no.
                    <input
                      value={manualIntake.secondaryLicenceCardNumber || ""}
                      onChange={(event) => setManualIntake((value) => ({ ...value, secondaryLicenceCardNumber: event.target.value }))}
                    />
                  </label>
                  <label>
                    Secondary expiry
                    <input
                      value={manualIntake.secondaryLicenceExpiryDate || ""}
                      onChange={(event) => setManualIntake((value) => ({ ...value, secondaryLicenceExpiryDate: event.target.value }))}
                      placeholder="YYYY-MM-DD"
                    />
                  </label>
                </>
              )}
            </div>
          </section>

          <section className="panel">
            <div className="panel-title">
              <ClipboardList size={18} />
              <h2>Validation</h2>
            </div>
            <IssueList issues={prepared?.validation?.issues} />
          </section>

          <section className="panel">
            <div className="panel-title">
              <UploadCloud size={18} />
              <h2>Document Intake</h2>
            </div>
            <div className="document-panel">
              <div className="template-box">
                <label>
                  Autofill template
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
                      setTemplateMessage("Unsaved template edits will still be used for the next prepare.");
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
                  <div>
                    <span>Needs Analysis</span>
                    <strong>Loan Objective Explanation</strong>
                    <p>{templatePreview.preview.needsAnalysis.loanObjectiveExplanation}</p>
                  </div>
                  <div>
                    <span>Loans & Securities</span>
                    <strong>Circumstances, Objectives and Priorities</strong>
                    <p>{templatePreview.preview.loansSecuritiesCommentary.circumstancesObjectivesPriorities}</p>
                  </div>
                  <div>
                    <span>Recommendation</span>
                    <strong>Lender / Loan Structure / Goals</strong>
                    <p>{templatePreview.preview.recommendation.loanStructure}</p>
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
                <div className="hem-tool">
                  <span>HEM / living expense monthly</span>
                  <div className="hem-row">
                    <select value={hemProfileKey} onChange={(event) => applyHemProfile(event.target.value)}>
                      {Object.entries(hemProfiles).map(([key, profile]) => (
                        <option key={key} value={key}>{profile.label}</option>
                      ))}
                    </select>
                    <input
                      value={hemMonthly || ""}
                      onChange={(event) => setHemMonthly(Number(String(event.target.value).replace(/[$,\s]/g, "")) || 0)}
                      placeholder="Manual e.g. 3450"
                    />
                  </div>
                  <small>{hemProfiles[hemProfileKey]?.note || "Manual amount overrides the selected profile for this case."}</small>
                  <div className="segmented">
                    {[recommendedHem(caseData), 3000, 3450, 4000, 4500, 5200].filter((value, index, arr) => value && arr.indexOf(value) === index).map((value) => (
                      <button className={hemMonthly === value ? "selected" : ""} type="button" key={value} onClick={() => setHemMonthly(value)}>
                        {currency(value)}
                      </button>
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
                        onClick={() => setFinancialAssetBuffer(value)}
                      >
                        {currency(value)}
                      </button>
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

          <section className="panel payload-panel">
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
            <h2>Autofill Safety Log</h2>
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
