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
  ShieldCheck
} from "lucide-react";

const apiBase = "http://127.0.0.1:8797";

function currency(value) {
  return new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD", maximumFractionDigits: 0 }).format(value || 0);
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
  const [selectedCaseId, setSelectedCaseId] = useState("ELF-2026-0148");
  const [caseData, setCaseData] = useState(null);
  const [prepared, setPrepared] = useState(null);
  const [auditLog, setAuditLog] = useState([]);
  const [caseHistory, setCaseHistory] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState("single-investor-preapproval");
  const [templateJson, setTemplateJson] = useState("");
  const [templateMessage, setTemplateMessage] = useState("");
  const [templatePreview, setTemplatePreview] = useState(null);
  const [documents, setDocuments] = useState([]);
  const [hemMonthly, setHemMonthly] = useState(4000);
  const [financialAssetBuffer, setFinancialAssetBuffer] = useState(30000);
  const [documentDraft, setDocumentDraft] = useState(null);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
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
    api(`/api/cases/${selectedCaseId}`).then(setCaseData).catch((err) => setError(err.message));
    api(`/api/cases/${selectedCaseId}/history`).then(setCaseHistory).catch(() => {});
    api(`/api/cases/${selectedCaseId}/document-intake`)
      .then((result) => setDocumentDraft(result.draft))
      .catch(() => {});
  }, [selectedCaseId, showMock]);

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

  async function prepareInfinity() {
    setLoading(true);
    setError("");
    try {
      const result = await api(`/api/cases/${selectedCaseId}/prepare-infinity-aol`, {
        method: "POST",
        body: JSON.stringify({
          templateId: selectedTemplateId,
          templateOverrides: currentTemplatePayload(),
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
    if (!documents.length) {
      setError("Choose at least one customer document first.");
      return;
    }

    setUploading(true);
    setError("");
    try {
      const formData = new FormData();
      for (const file of documents) formData.append("documents", file);
      formData.append("hemMonthly", String(hemMonthly));
      formData.append("financialAssetBuffer", String(financialAssetBuffer));
      formData.append("templateId", selectedTemplateId);
      formData.append("templateOverrides", JSON.stringify(currentTemplatePayload()));

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
    setError("");
    try {
      const result = await api(`/api/cases/${selectedCaseId}/template-preview`, {
        method: "POST",
        body: JSON.stringify({
          templateId: selectedTemplateId,
          templateOverrides: currentTemplatePayload(),
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
        <div className="case-list">
          {cases.map((caseItem) => (
            <button
              className={caseItem.id === selectedCaseId ? "active" : ""}
              key={caseItem.id}
              type="button"
              onClick={() => setSelectedCaseId(caseItem.id)}
            >
              <span>{caseItem.id}</span>
              <strong>{caseItem.applicantNames}</strong>
              <small>{currency(caseItem.loanAmount)}</small>
            </button>
          ))}
        </div>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div>
            <span>{selectedSummary?.status || "Case view"}</span>
            <h1>{selectedCaseId}</h1>
          </div>
          <div className="actions">
            <a className="ghost-button" href="/mock-infinity-aol" target="_blank" rel="noreferrer">
              <ExternalLink size={16} />
              Mock AOL
            </a>
            <button className="primary-button" type="button" disabled={loading || !caseData} onClick={prepareInfinity}>
              {loading ? <RefreshCw size={17} className="spin" /> : <Play size={17} />}
              Prepare Infinity AOL
            </button>
          </div>
        </header>

        {error && <div className="error-banner">{error}</div>}

        <CaseFacts caseData={caseData} />

        <div className="main-grid">
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

              <label className="dropzone">
                <UploadCloud size={22} />
                <strong>{documents.length ? `${documents.length} file(s) selected` : "Drop customer files"}</strong>
                <span>Income, ID, bank statements, contract</span>
                <input multiple type="file" onChange={(event) => setDocuments([...event.target.files])} />
              </label>

              <div className="preset-grid">
                <div>
                  <span>HEM monthly</span>
                  <div className="segmented">
                    {[3000, 4000, 5000].map((value) => (
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

              <button className="primary-button intake-button" type="button" disabled={uploading || !documents.length} onClick={() => uploadDocuments()}>
                {uploading ? <RefreshCw size={17} className="spin" /> : <UploadCloud size={17} />}
                Prepare From Files
              </button>
              <button className="primary-button intake-button" type="button" disabled={uploading || !documents.length} onClick={() => uploadDocuments({ prepare: true })}>
                {uploading ? <RefreshCw size={17} className="spin" /> : <Play size={17} />}
                One-Click Intake + Payload
              </button>

              {documentDraft ? (
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
          <div className="panel-title">
            <History size={18} />
            <h2>Case Fill History</h2>
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
