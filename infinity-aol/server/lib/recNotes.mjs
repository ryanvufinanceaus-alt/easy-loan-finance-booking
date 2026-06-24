// Recommendation Notes (credit-assessor cover note) — professional, branded PDF + Word.
// Ported from Broker Desk CRM (which delegated file generation to Google Apps Script); EasyFlow builds
// the documents natively. Brand: Easy Loan Finance navy #1E2430 + gold #D4A843, with the ELF logo.

import PDFDocument from "pdfkit";
import {
  Document, Packer, Paragraph, TextRun, ImageRun, Table, TableRow, TableCell,
  WidthType, AlignmentType, BorderStyle, ShadingType, HeadingLevel, VerticalAlign
} from "docx";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const NAVY = "#1E2430", GOLD = "#D4A843", INK = "#222831", MUTED = "#6B7280", LIGHT = "#F5F6F8", LINE = "#E2E5EA";
const HERE = path.dirname(fileURLToPath(import.meta.url));
function loadLogo() {
  for (const p of [path.join(HERE, "../../../public/elf-logo.png"), path.join(process.cwd(), "public/elf-logo.png"), path.join(process.cwd(), "dist/elf-logo.png")]) {
    try { return readFileSync(p); } catch { /* try next */ }
  }
  return null;
}
const LOGO = loadLogo();

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const money = (v) => "$" + num(v).toLocaleString("en-AU");
const up = (s) => String(s || "").toUpperCase();
// pdfkit's standard fonts are WinAnsi-only — transliterate smart punctuation pasted from Word/lender PDFs.
const safe = (s) => String(s == null ? "" : s)
  .replace(/[‘’‚‛]/g, "'").replace(/[“”„‟]/g, '"').replace(/[–—−]/g, "-").replace(/…/g, "...").replace(/[   ​]/g, " ");

// Scenario-aware narrative templates. Adapts to single/couple (verb agreement), owner-occupied /
// investment / refinance, pre-approval / formal-approval, cash-out, and debt / no-debt — placeholders
// filled from the case. INCOME / VISA / RENTAL stay data-driven (per applicant) and are assembled by the
// caller; this produces the prose sections that change with the deal type.
// Evidence-gated narrative engine. Every strong, lender-facing statement is conditioned on a flag the caller
// derives from real case/capture data — so the note never overclaims (no "clean credit" without CCR, no
// "Contract of Sale attached" without it, no "good condition" without a valuation, etc.). Missing data degrades
// to neutral "to be confirmed / subject to lender assessment" wording rather than invented facts.
export function buildRecNarrative(ctx = {}) {
  const couple = (ctx.applicantCount || 1) > 1;
  const company = ctx.borrowerType === "company_trust";
  const v = (s, p) => (couple ? p : s);                 // verb agreement: v("is","are")
  const subj = couple ? "The clients" : "The applicant";
  const possS = couple ? "the clients'" : "the applicant's";
  const listJoin = (a) => a.length <= 1 ? (a[0] || "") : a.slice(0, -1).join(", ") + " and " + a[a.length - 1];
  const occ = ctx.isInvestment ? "investment" : "owner-occupied";
  const lenderWith = ctx.lenderName ? ` with ${ctx.lenderName}` : "";

  // --- application stage → approval phrase (never "formal approval" unless the workflow says so) ---
  const stage = ctx.stage || (ctx.isRefi ? "refinance" : "pre_approval");
  const approval = ({
    pre_approval: "pre-approval / assessment", assessment: "pre-approval / assessment",
    formal: "formal approval", conditional: "conditional approval",
    refinance: "assessment of the refinance proposal", construction: "assessment of the construction facility",
    commercial: "assessment"
  })[stage] || "pre-approval / assessment";

  // ===== 01 PROPOSAL =====
  let purpose;
  const propTarget = ctx.propertyFound
    ? `${ctx.isInvestment ? "an investment property" : "an owner-occupied property to live in"}${ctx.security ? ` at ${ctx.security}` : ""}`
    : `a proposed ${occ} purchase (the property is to be confirmed)`;
  if (company) {
    purpose = `${ctx.borrowerName || "The borrowing entity"} is seeking ${approval} ${ctx.purposeText || `for ${occ} lending`}${lenderWith}${ctx.guarantorNames ? `, supported by guarantee(s) from ${ctx.guarantorNames}` : ""}.`;
  } else if (ctx.isRefi) {
    purpose = `${subj} ${v("is", "are")} seeking ${approval} to refinance ${v("their", "their")} existing ${occ} lending${lenderWith}${ctx.cashOut ? `, together with the release of additional funds${ctx.cashOutPurpose ? ` for ${ctx.cashOutPurpose}` : ""}` : ""}. The objective is to achieve a loan structure and pricing that better align with ${possS} requirements, subject to lender assessment.`;
  } else {
    purpose = `${subj} ${v("is", "are")} seeking ${approval} to purchase ${propTarget}${lenderWith}.${ctx.firstHomeBuyer ? ` As ${v("a first-home buyer", "first-home buyers")}, ${subj.toLowerCase()} ${v("is", "are")} entering home ownership in a financially responsible manner.` : ""}`;
  }
  // Structure — only the parts we actually have.
  let structure = "";
  if (ctx.loanAmount) {
    structure = `The proposed loan amount is ${money(ctx.loanAmount)}`
      + (ctx.value ? ` against ${ctx.isRefi ? "an estimated security value" : (ctx.propertyFound ? "a purchase price" : "an estimated value")} of ${money(ctx.value)}` : "")
      + (ctx.lvr ? `, representing an LVR of ${ctx.lvr}` : "") + ".";
  }
  const facilityBits = [];
  if (ctx.product) facilityBits.push(`the ${ctx.product} product`);
  if (ctx.repaymentType) facilityBits.push(`${ctx.repaymentType} repayments`);
  if (ctx.rateType) facilityBits.push(`a ${ctx.rateType} rate`);
  if (facilityBits.length) structure += ` The facility is proposed on ${listJoin(facilityBits)}${ctx.loanTerm ? ` over a ${ctx.loanTerm}-year term` : ""}.`;
  // Rate-type + IO notes.
  const rateNote = ctx.rateType === "fixed"
    ? " The fixed rate provides repayment certainty for the fixed period; break costs and limited additional repayments during the fixed period have been discussed."
    : ctx.rateType === "variable" ? " The variable rate provides flexibility, including additional repayments and redraw, with an awareness of potential rate movements." : "";
  const ioNote = /interest only/i.test(ctx.repaymentType || "")
    ? ` The interest-only period assists ${possS} cash flow; the facility reverts to principal and interest thereafter, with repayment supported by ongoing income and the security held.` : "";
  // Preferences + strengths (data-gated).
  const prefBits = [];
  if (ctx.redraw) prefBits.push("redraw access (subject to lender terms)");
  if (ctx.offset) prefBits.push("an offset facility");
  if (ctx.extraRepayments) prefBits.push("the flexibility to make additional repayments");
  const prefs = prefBits.length ? ` ${subj} ${v("values", "value")} ${listJoin(prefBits)}.` : "";
  const strengthBits = [];
  if (ctx.depositStrong) strengthBits.push("a strong deposit position");
  if (ctx.dependants === 0 || ctx.dependants === "0") strengthBits.push("no dependants");
  if (ctx.noLiabilities) strengthBits.push("no disclosed liabilities");
  const strengths = strengthBits.length ? ` ${subj} ${v("has", "have")} ${listJoin(strengthBits)}.` : "";
  const proposal = (purpose + " " + structure + strengths + prefs + rateNote + ioNote
    + ` The application is submitted for ${stage === "formal" ? "formal approval" : "assessment"}, subject to the lender's standard credit, valuation and verification requirements.`).replace(/\s+/g, " ").trim();

  // ===== 03 CAPACITY (servicing-evidence gated) =====
  const servLine = ctx.servicingResult === "pass" ? "Serviceability is supported by the lender's servicing assessment."
    : ctx.servicingResult === "tight" ? "Serviceability is subject to lender assessment and verification of income and expenses."
      : "Serviceability is to be confirmed by the lender's servicing assessment.";
  const verifSource = company ? "the entity's financial statements and supporting documentation" : ctx.selfEmployed ? "the financials provided" : "the recent payslips and employment documentation provided";
  const basisClause = company ? "" : ctx.selfEmployed ? `, and ${v("the applicant operates", "the clients operate")} an established business`
    : (ctx.employmentBasis ? `, and ${v("the applicant is", "the clients are")} employed on a ${ctx.employmentBasis} basis` : "");
  const capacity = `${servLine} ${subj} ${v("earns", "earn")} income that is verifiable from ${verifSource}${basisClause}. ${subj} ${v("has", "have")} advised no foreseeable changes that would adversely affect ${v("their", "their")} income or ability to meet the proposed repayments. Please refer to the serviceability assessment for full details.`;

  // ===== 05 CHARACTER (credit-evidence gated — never assert a clean file without CCR) =====
  const strengthParts = [];
  if (ctx.depositStrong) strengthParts.push("a strong deposit position");
  if (ctx.noLiabilities) strengthParts.push("no disclosed liabilities");
  const dispLine = strengthParts.length ? ` This includes ${listJoin(strengthParts)}.` : "";
  const creditLine = ctx.ccrClean
    ? ` Based on the credit report reviewed, ${possS} credit conduct does not show adverse listings.`
    : ` No credit report has been relied upon for this note; credit conduct is to be confirmed on assessment.`;
  const equifax = ctx.equifaxLifted ? ` ${subj} ${v("has", "have")} confirmed the Equifax credit file restriction has been lifted for lender assessment.` : "";
  const character = `${subj} ${v("has", "have")} demonstrated a responsible financial position based on the information provided.${dispLine}${equifax}${creditLine} ${subj} ${v("understands", "understand")} the obligations of the proposed facility.`;

  // ===== 06 COLLATERAL (property-type + valuation + LVR gated) =====
  const collLines = [];
  if (!ctx.propertyFound) {
    collLines.push("The security property is yet to be identified; the security address and details are to be confirmed once a property is selected.");
  } else {
    collLines.push(`The security offered is ${ctx.isRefi ? "the applicant's existing property" : "the subject property"}${ctx.security ? ` at ${ctx.security}` : ""}, which is considered suitable for the proposed lending, subject to valuation and lender acceptance:`);
    if (ctx.value) collLines.push(`• ${ctx.isInvestment ? "Estimated value / purchase price" : "Purchase price / security value"}: ${money(ctx.value)}`);
    if (ctx.lvr) collLines.push(`• Resulting LVR: ${ctx.lvr}`);
    if (ctx.dwellingDesc) collLines.push(`• ${ctx.dwellingDesc}`);
    collLines.push(ctx.valuationDone ? "• Valuation completed and acceptable" : "• Subject to valuation and lender acceptance");
    collLines.push(ctx.isRefi ? "• Existing loan statements / payout figures to be provided"
      : (ctx.contractStatus === "attached" ? "• Contract of Sale provided" : "• Contract of Sale to be provided once signed"));
    if (ctx.lvr && parseFloat(ctx.lvr) <= 80) collLines.push("The conservative LVR provides a strong equity buffer and mitigates lender risk.");
    else if (ctx.lvr && parseFloat(ctx.lvr) > 80) collLines.push("The application carries a higher LVR and may be subject to LMI and stricter lender assessment; the proposal remains supported by the applicant's objectives and servicing position, subject to lender policy.");
  }
  const collateral = collLines.join("\n");

  // ===== EXIT STRATEGY (IO, short term, or cash-out) =====
  let exitStrategy = "";
  if (/interest only/i.test(ctx.repaymentType || "") || (ctx.loanTerm && ctx.loanTerm <= 10) || ctx.cashOut) {
    exitStrategy = [
      "The proposed lending is supported by the following exit pathways:",
      `• Primary — the facility is to be serviced and repaid from ${possS} ongoing income over the loan term, subject to the lender's servicing assessment.`,
      ctx.value && ctx.lvr && parseFloat(ctx.lvr) < 70
        ? `• Secondary — equity is held in the security (LVR ${ctx.lvr}), providing the option to refinance or realise the asset if circumstances change.`
        : "• Secondary — the option to refinance or realise the secured asset remains available if circumstances change."
    ].join("\n");
  }

  // ===== 07 OTHER DEBTS =====
  const noDebtsNote = `${subj} ${v("has", "have")} declared no credit cards, personal loans, car loans, HECS/HELP, buy-now-pay-later facilities or other liabilities. This has been taken into account in the servicing position.`;
  const debtsLead = `${subj} ${v("has", "have")} declared the following existing ${ctx.debtCount > 1 ? "liabilities" : "liability"}, ${ctx.isRefi || ctx.debtConsolidation ? "which form part of this application" : "which ha" + (ctx.debtCount > 1 ? "ve" : "s") + " been included in the servicing assessment"}:`;

  return { proposal, character, collateral, capacity, exitStrategy, noDebtsNote, debtsLead };
}

export function normaliseRec(input = {}) {
  const purpose = String(input.loanPurpose || "purchase").toLowerCase();
  const isInvestment = /invest/.test(String(input.propertyType || "")) || /invest/.test(purpose);
  const isPreApproval = /pre|assess/.test(String(input.loanType || ""));
  const approvalWord = isPreApproval ? "PRE-APPROVAL / ASSESSMENT" : "FORMAL APPROVAL";
  const propWord = isInvestment ? "AN INVESTMENT PROPERTY" : "AN OWNER-OCCUPIED PROPERTY";
  const action = /refinance/.test(purpose) ? "TO REFINANCE" : "TO PURCHASE";
  const atLender = input.lenderName ? ` WITH ${up(input.lenderName)}` : "";
  const debts = (input.otherDebts || []).map((d) => ({
    lenderType: d.lenderType || "", balance: num(d.balance), repayment: num(d.repayment),
    repayFreq: d.repayFreq || "Month", rate: d.rate || "", security: d.security || "", action: d.action || ""
  })).filter((d) => d.lenderType || d.balance);
  const facts = [
    ["Finance due", input.financeDate], ["Settlement due", input.settlementDate],
    ["Loan amount", input.loanAmount ? money(input.loanAmount) : ""],
    ["Product", input.product], ["Rate", input.interestRate],
    ["Security", input.securityAddress],
    [isInvestment ? "Valuation" : "Purchase price", input.estimatedValue ? money(input.estimatedValue) : ""],
    ["LVR", input.lvr], ["LMI", input.lmi]
  ].filter(([, v]) => v && String(v).trim());
  const sections = [
    ["PROPOSAL", input.proposal], ["VISA", input.visaStatus], ["CAPACITY", input.capacity],
    ["INCOME", input.incomeDetails], ["RENTAL INCOME", isInvestment ? input.rentalIncome : ""],
    ["CHARACTER", input.character], ["COLLATERAL", input.collateral], ["EXIT STRATEGY", input.exitStrategy]
  ].filter(([, v]) => v && String(v).trim());
  return {
    fileOwner: input.fileOwner || "Viet Anh Vu",
    mobileNumber: input.mobileNumber || "0421 367 899",
    brokerEmail: input.brokerEmail || "ryan@easyloanfinance.com.au",
    clientName: input.clientName || "",
    seekingLine: `SEEKING ${approvalWord} ${action} ${propWord}${atLender}`,
    isInvestment, facts, sections, debts,
    noDebtsNote: input.noDebtsNote || "", debtsLead: input.debtsLead || "",
    brokerComment: input.brokerComment || ""
  };
}

function debtsLines(debts, noDebtsNote) {
  if (!debts.length) return [noDebtsNote || "The applicant has no additional liabilities or unsecured debts."];
  return debts.map((d) => {
    const bits = [d.lenderType];
    if (d.balance) bits.push(`balance ${money(d.balance)}`);
    if (d.repayment) bits.push(`repayment ${money(d.repayment)}/${d.repayFreq}`);
    if (d.rate) bits.push(`rate ${d.rate}`);
    if (d.security) bits.push(`security ${d.security}`);
    if (d.action) bits.push(d.action);
    return bits.filter(Boolean).join(", ") + ".";
  });
}

// =================== PDF ===================
export function buildRecPdf(input = {}) {
  const r = normaliseRec(input);
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 0, bufferPages: true });
    const chunks = [];
    doc.on("data", (d) => chunks.push(d));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const PW = doc.page.width, M = 48, CW = PW - M * 2;
    const navy = NAVY, gold = GOLD;

    // ---- Header band ----
    doc.rect(0, 0, PW, 92).fill(navy);
    doc.rect(0, 92, PW, 4).fill(gold);
    if (LOGO) { try { doc.image(LOGO, M, 24, { width: 46, height: 46 }); } catch { /* skip */ } }
    const tx = M + (LOGO ? 60 : 0);
    doc.fillColor("#FFFFFF").font("Helvetica-Bold").fontSize(17).text("EASY LOAN FINANCE", tx, 30);
    doc.fillColor(gold).font("Helvetica-Bold").fontSize(10).text("RECOMMENDATION NOTES", tx, 54);
    doc.fillColor("#C9CED6").font("Helvetica").fontSize(8.5)
      .text(`File owner: ${safe(r.fileOwner)}   ·   M ${safe(r.mobileNumber)}   ·   ${safe(r.brokerEmail)}`, M, 70, { width: CW, align: "right" });

    let y = 116;
    // ---- Assessor note strip (prominent) ----
    doc.roundedRect(M, y, CW, 46, 5).fillAndStroke("#FFF7E6", gold);
    doc.fillColor(navy).font("Helvetica-Bold").fontSize(13).text("ATTENTION CREDIT ASSESSOR", M + 14, y + 8, { width: CW - 28 });
    doc.fillColor(INK).font("Helvetica").fontSize(9.5).text("Please kindly read this note IN FULL before issuing conditions or calling the broker for clarifications.", M + 14, y + 27, { width: CW - 28 });
    y += 58;

    // ---- Client + seeking line ----
    doc.fillColor(navy).font("Helvetica-Bold").fontSize(15).text(safe(up(r.clientName)), M, y, { width: CW });
    y = doc.y + 6;
    doc.rect(M, y, CW, 26).fill(gold);
    doc.fillColor(navy).font("Helvetica-Bold").fontSize(10.5).text(safe(r.seekingLine), M + 10, y + 7, { width: CW - 20 });
    y += 38;

    // ---- Facts grid (2 columns). Rows AUTO-GROW to fit the value (no ellipsis) so long PRODUCT / SECURITY
    // strings show IN FULL — e.g. "*Discounted Pricing - Standard Variable Owner-Occupied P&I <60% LVR …". ----
    const colW = (CW - 14) / 2, labelW = 92, valW = colW - labelW - 12, minRowH = 19;
    let fy = y;
    for (let i = 0; i < r.facts.length; i += 2) {
      const pair = [r.facts[i], r.facts[i + 1]].filter(Boolean);
      doc.font("Helvetica").fontSize(8.6);
      const rowH = Math.max(minRowH, ...pair.map(([, v]) => doc.heightOfString(safe(String(v)), { width: valW }) + 12));
      pair.forEach(([k, v], j) => {
        const x = j === 0 ? M : M + colW + 14;
        doc.rect(x, fy, labelW, rowH).fill(navy);
        doc.fillColor("#FFFFFF").font("Helvetica-Bold").fontSize(7.8).text(up(k), x + 6, fy + 6, { width: labelW - 10 });
        doc.rect(x + labelW, fy, colW - labelW, rowH).fillAndStroke("#FFFFFF", LINE);
        doc.fillColor(INK).font("Helvetica").fontSize(8.6).text(safe(String(v)), x + labelW + 6, fy + 6, { width: valW });
      });
      fy += rowH + 4;
    }
    y = fy + 8;

    // ---- Narrative sections ----
    let secNo = 0;
    const sectionHeading = (label) => {
      if (doc.y > doc.page.height - 96) doc.addPage({ margin: 0 }), (doc.y = 48);
      secNo += 1;
      const yy = doc.y;
      // gold number badge + navy heading + full-width hairline rule
      doc.rect(M, yy, 16, 14).fill(gold);
      doc.fillColor(navy).font("Helvetica-Bold").fontSize(8.5).text(String(secNo).padStart(2, "0"), M, yy + 3.5, { width: 16, align: "center" });
      doc.fillColor(navy).font("Helvetica-Bold").fontSize(10.5).text(label, M + 24, yy + 1.5);
      const ry = yy + 17;
      doc.moveTo(M, ry).lineTo(M + CW, ry).lineWidth(0.6).strokeColor(LINE).stroke();
      doc.y = ry + 5;
    };
    // Render a body that may mix paragraphs and "• " bullet lines (bullets indented, never justified).
    const renderBody = (body) => {
      const lines = String(body).trim().split(/\n+/).map((s) => s.trim()).filter(Boolean);
      for (const ln of lines) {
        if (doc.y > doc.page.height - 60) doc.addPage({ margin: 0 }), (doc.y = 48);
        if (/^[•·-]\s*/.test(ln)) {
          const txt = ln.replace(/^[•·-]\s*/, "");
          doc.fillColor(gold).font("Helvetica-Bold").fontSize(9.6).text("•", M + 4, doc.y, { continued: false, width: 10 });
          const by = doc.y;
          doc.fillColor(INK).font("Helvetica").fontSize(9.6).text(safe(txt), M + 18, by, { width: CW - 18, align: "left", lineGap: 2 });
        } else {
          doc.fillColor(INK).font("Helvetica").fontSize(9.6).text(safe(ln), M, doc.y, { width: CW, align: "justify", lineGap: 2 });
        }
        doc.moveDown(0.3);
      }
    };
    doc.y = y;
    for (const [label, body] of r.sections) {
      sectionHeading(label);
      renderBody(body);
      doc.moveDown(0.55);
    }
    sectionHeading("OTHER DEBTS");
    if (r.debts.length && r.debtsLead) { doc.fillColor(INK).font("Helvetica").fontSize(9.6).text(safe(r.debtsLead), M, doc.y, { width: CW, lineGap: 2 }); doc.moveDown(0.3); }
    renderBody(debtsLines(r.debts, r.noDebtsNote).map((ln) => (r.debts.length ? "• " : "") + ln).join("\n"));

    if (r.brokerComment) { doc.moveDown(0.55); sectionHeading("BROKER RECOMMENDATION"); renderBody(r.brokerComment); }

    // ---- Sign-off ----
    doc.moveDown(1.2);
    doc.fillColor(navy).font("Helvetica-Bold").fontSize(10).text(safe(r.fileOwner), M, doc.y);
    doc.fillColor(MUTED).font("Helvetica").fontSize(9).text("Broker - Authorised Credit Representative", M, doc.y);
    doc.text(`M ${safe(r.mobileNumber)}    E ${safe(r.brokerEmail)}`, M, doc.y);

    // ---- Footer on every page ----
    const range = doc.bufferedPageRange();
    for (let i = 0; i < range.count; i += 1) {
      doc.switchToPage(range.start + i);
      doc.rect(0, doc.page.height - 26, PW, 26).fill(navy);
      doc.fillColor("#C9CED6").font("Helvetica").fontSize(7.5)
        .text("Easy Loan Finance  ·  Quick Loan, Easy Life  ·  ryan@easyloanfinance.com.au", M, doc.page.height - 18, { width: CW - 40 });
      doc.fillColor(GOLD).text(`Page ${i + 1} of ${range.count}`, PW - M - 80, doc.page.height - 18, { width: 80, align: "right" });
    }
    doc.end();
  });
}

// =================== DOCX ===================
const noBorder = { style: BorderStyle.NONE, size: 0, color: "FFFFFF" };
function cellShade(text, { bold = false, color = "222831", shade = null, width = 50, align = AlignmentType.LEFT } = {}) {
  return new TableCell({
    width: { size: width, type: WidthType.PERCENTAGE },
    shading: shade ? { type: ShadingType.CLEAR, fill: shade, color: "auto" } : undefined,
    margins: { top: 60, bottom: 60, left: 110, right: 110 },
    verticalAlign: VerticalAlign.CENTER,
    children: [new Paragraph({ alignment: align, children: [new TextRun({ text, bold, color, size: 17 })] })]
  });
}

export async function buildRecDocx(input = {}) {
  const r = normaliseRec(input);
  const navy = "1E2430", gold = "D4A843", ink = "222831", muted = "6B7280";
  const P = (text, o = {}) => new Paragraph({ spacing: { after: o.after ?? 80, before: o.before ?? 0 }, alignment: o.align, children: [new TextRun({ text, bold: o.bold, italics: o.italics, color: o.color || ink, size: o.size || 19 })] });

  // Header: logo + brand
  const headerChildren = [];
  if (LOGO) headerChildren.push(new ImageRun({ type: "png", data: LOGO, transformation: { width: 44, height: 44 } }), new TextRun({ text: "  " }));
  headerChildren.push(new TextRun({ text: "EASY LOAN FINANCE", bold: true, color: navy, size: 30 }));
  const headerBar = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: { top: noBorder, bottom: { style: BorderStyle.SINGLE, size: 18, color: gold }, left: noBorder, right: noBorder, insideHorizontal: noBorder, insideVertical: noBorder },
    rows: [new TableRow({ children: [
      new TableCell({ width: { size: 60, type: WidthType.PERCENTAGE }, borders: { top: noBorder, bottom: noBorder, left: noBorder, right: noBorder }, verticalAlign: VerticalAlign.CENTER, children: [new Paragraph({ children: headerChildren }), new Paragraph({ spacing: { before: 20 }, children: [new TextRun({ text: "RECOMMENDATION NOTES", bold: true, color: gold, size: 18 })] })] }),
      new TableCell({ width: { size: 40, type: WidthType.PERCENTAGE }, borders: { top: noBorder, bottom: noBorder, left: noBorder, right: noBorder }, verticalAlign: VerticalAlign.CENTER, children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun({ text: `File owner: ${r.fileOwner}`, color: muted, size: 15 })] }), new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun({ text: `M ${r.mobileNumber}  ·  ${r.brokerEmail}`, color: muted, size: 15 })] })] })
    ] })]
  });

  // Facts table (2 label/value pairs per row)
  const factRows = [];
  for (let i = 0; i < r.facts.length; i += 2) {
    const a = r.facts[i], b = r.facts[i + 1];
    factRows.push(new TableRow({ children: [
      cellShade(up(a[0]), { bold: true, color: "FFFFFF", shade: navy, width: 18 }),
      cellShade(String(a[1]), { width: 32 }),
      b ? cellShade(up(b[0]), { bold: true, color: "FFFFFF", shade: navy, width: 18 }) : cellShade("", { width: 18 }),
      b ? cellShade(String(b[1]), { width: 32 }) : cellShade("", { width: 32 })
    ] }));
  }
  const factsTable = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: { top: { style: BorderStyle.SINGLE, size: 4, color: "E2E5EA" }, bottom: { style: BorderStyle.SINGLE, size: 4, color: "E2E5EA" }, left: { style: BorderStyle.SINGLE, size: 4, color: "E2E5EA" }, right: { style: BorderStyle.SINGLE, size: 4, color: "E2E5EA" }, insideHorizontal: { style: BorderStyle.SINGLE, size: 4, color: "FFFFFF" }, insideVertical: { style: BorderStyle.SINGLE, size: 4, color: "FFFFFF" } },
    rows: factRows
  });

  let secNo = 0;
  const heading = (label) => { secNo += 1; return new Paragraph({ spacing: { before: 220, after: 70 }, border: { bottom: { style: BorderStyle.SINGLE, size: 10, color: "E2E5EA" } }, children: [new TextRun({ text: String(secNo).padStart(2, "0") + "  ", bold: true, color: gold, size: 21 }), new TextRun({ text: label, bold: true, color: navy, size: 21 })] }); };
  // Render a body that may mix paragraphs and "• " bullet lines.
  const bodyParas = (body) => String(body).trim().split(/\n+/).map((s) => s.trim()).filter(Boolean).map((ln) => {
    if (/^[•·-]\s*/.test(ln)) return new Paragraph({ bullet: { level: 0 }, spacing: { after: 60 }, children: [new TextRun({ text: ln.replace(/^[•·-]\s*/, ""), color: ink, size: 19 })] });
    return P(ln, { align: AlignmentType.JUSTIFIED });
  });

  const kids = [
    headerBar,
    new Paragraph({ shading: { type: ShadingType.CLEAR, fill: "FFF7E6", color: "auto" }, border: { top: { style: BorderStyle.SINGLE, size: 8, color: gold }, bottom: { style: BorderStyle.SINGLE, size: 8, color: gold }, left: { style: BorderStyle.SINGLE, size: 8, color: gold }, right: { style: BorderStyle.SINGLE, size: 8, color: gold } }, spacing: { before: 160, after: 40 }, children: [new TextRun({ text: "ATTENTION CREDIT ASSESSOR", bold: true, color: navy, size: 26 })] }),
    P("Please kindly read this note IN FULL before issuing conditions or calling the broker for clarifications.", { color: ink, size: 18, after: 80 }),
    new Paragraph({ spacing: { before: 120, after: 60 }, children: [new TextRun({ text: up(r.clientName), bold: true, color: navy, size: 28 })] }),
    new Paragraph({ shading: { type: ShadingType.CLEAR, fill: gold, color: "auto" }, spacing: { after: 120 }, children: [new TextRun({ text: " " + r.seekingLine + " ", bold: true, color: navy, size: 19 })] }),
    factsTable
  ];
  for (const [label, body] of r.sections) {
    kids.push(heading(label));
    bodyParas(body).forEach((p) => kids.push(p));
  }
  kids.push(heading("OTHER DEBTS"));
  if (r.debts.length && r.debtsLead) kids.push(P(r.debtsLead));
  debtsLines(r.debts, r.noDebtsNote).forEach((ln) => kids.push(r.debts.length
    ? new Paragraph({ bullet: { level: 0 }, spacing: { after: 60 }, children: [new TextRun({ text: ln, color: ink, size: 19 })] })
    : P(ln)));
  if (r.brokerComment) { kids.push(heading("BROKER RECOMMENDATION")); bodyParas(r.brokerComment).forEach((p) => kids.push(p)); }
  kids.push(
    P(r.fileOwner, { bold: true, color: navy, size: 20, before: 240 }),
    P("Broker - Authorised Credit Representative", { color: muted, size: 17, after: 20 }),
    P(`M ${r.mobileNumber}    E ${r.brokerEmail}`, { color: muted, size: 17 })
  );

  const doc = new Document({
    creator: "EasyFlow AI",
    styles: { default: { document: { run: { font: "Calibri" } } } },
    sections: [{ children: kids }]
  });
  return Packer.toBuffer(doc);
}
