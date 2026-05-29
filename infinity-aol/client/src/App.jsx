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
  ShieldCheck,
  Trash2
} from "lucide-react";

const apiBase = location.pathname.startsWith("/infinity-aol")
  ? `${location.origin}/infinity-aol`
  : ["localhost", "127.0.0.1"].includes(location.hostname)
    ? "http://127.0.0.1:8797"
    : `${location.origin}/infinity-aol`;

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

export default function App() {
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
  const [financialAssetBuffer, setFinancialAssetBuffer] = useState(30000);
  const [documentDraft, setDocumentDraft] = useState(null);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [ocrRunning, setOcrRunning] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [error, setError] = useState("");

  const showMock = location.pathname === "/mock-infinity-aol";

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
      financialAssetBuffer
    };
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

  return (
    <main className="app-shell">
      <aside className="case-sidebar">
        <div className="brand-block">
          <ShieldCheck size={24} />
          <div>
            <span>Broker CRM</span>
            <strong>Infinity AOL Assistant</strong>
          </div>
        </div>
        <div className="case-search">
          <label>
            Search case
            <div className="search-input">
              <Search size={16} />
              <input
                value={caseSearch}
                onChange={(event) => setCaseSearch(event.target.value)}
                placeholder="Name, case ID, second applicant, address"
                autoComplete="off"
              />
            </div>
          </label>
          <select className="case-select" value={selectedCaseId} onChange={(event) => selectCase(event.target.value)}>
            <option value="">Dropdown by client name</option>
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
                ? "Recent searched cases, sorted by client name."
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
          <strong>Case Intake Snapshot</strong>
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
            <a className="ghost-button" href="/mock-infinity-aol" target="_blank" rel="noreferrer">
              <ExternalLink size={16} />
              Mock AOL
            </a>
            <button className="primary-button" type="button" disabled={loading || !caseData || !selectedCaseId} onClick={prepareInfinity}>
              {loading ? <RefreshCw size={17} className="spin" /> : <Play size={17} />}
              Prepare Infinity AOL
            </button>
          </div>
        </header>

        {error && <div className="error-banner">{error}</div>}

        <CaseFacts caseData={caseData} />

        <div className="main-grid">
          <section className="panel">
            <div className="panel-title split-title">
              <div>
                <ClipboardList size={18} />
                <h2>Quick Review Inputs</h2>
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
                <textarea
                  spellCheck="false"
                  value={templateJson}
                  onChange={(event) => {
                    setTemplateJson(event.target.value);
                    setTemplateMessage("Unsaved template edits will still be used for the next prepare.");
                  }}
                />
                <button className="ghost-button save-template" type="button" onClick={saveTemplate}>
                  Save Template
                </button>
                <button className="ghost-button save-template" type="button" onClick={previewTemplateText}>
                  Preview Case Text
                </button>
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
                <span>Driver licence front/back, income, bank statements, contract</span>
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
                Broker intake text format
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
                <div>
                  <span>HEM monthly</span>
                  <div className="segmented">
                    {[recommendedHem(caseData), 3000, 4000, 5000].filter((value, index, arr) => arr.indexOf(value) === index).map((value) => (
                      <button className={hemMonthly === value ? "selected" : ""} type="button" key={value} onClick={() => setHemMonthly(value)}>
                        {currency(value)}
                      </button>
                    ))}
                  </div>
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

              <button className="primary-button intake-button" type="button" disabled={uploading || ocrRunning || (!documents.length && !incomeFormatText.trim()) || !selectedCaseId} onClick={() => uploadDocuments()}>
                {uploading || ocrRunning ? <RefreshCw size={17} className="spin" /> : <UploadCloud size={17} />}
                Prepare From Files
              </button>
              <button className="primary-button intake-button" type="button" disabled={uploading || ocrRunning || (!documents.length && !incomeFormatText.trim()) || !selectedCaseId} onClick={() => uploadDocuments({ prepare: true })}>
                {uploading || ocrRunning ? <RefreshCw size={17} className="spin" /> : <Play size={17} />}
                One-Click Intake + Payload
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
              <h2>Prepared Payload</h2>
            </div>
            {prepared ? (
              <>
                <div className="payload-meta">
                  <div>
                    <span>Payload token</span>
                    <strong>{prepared.token}</strong>
                  </div>
                  <div>
                    <span>Mapping</span>
                    <strong>{prepared.mappingVersion}</strong>
                  </div>
                </div>
                <pre>{JSON.stringify(prepared.payload, null, 2)}</pre>
              </>
            ) : (
              <div className="empty-state">Click Prepare Infinity AOL to build a lender-ready payload.</div>
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
      </section>
    </main>
  );
}
