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
export function buildRecNarrative(ctx = {}) {
  const couple = (ctx.applicantCount || 1) > 1;
  const v = (s, p) => (couple ? p : s);                 // verb agreement: v("is","are")
  const subj = couple ? "The clients" : "The applicant";
  // Pre-approval / assessment wording until a signed Contract of Sale is provided (per the broker's rule).
  const approval = ctx.assessment ? "pre-approval / assessment" : ctx.preApproval ? "pre-approval" : "formal approval";
  const listJoin = (a) => a.length <= 1 ? (a[0] || "") : a.slice(0, -1).join(", ") + " and " + a[a.length - 1];
  const withLender = ctx.lenderName ? ` with ${ctx.lenderName}` : "";
  const dealLine = `The total loan amount is ${money(ctx.loanAmount)}`
    + (ctx.value ? ` against a security valued at ${money(ctx.value)} (LVR ${ctx.lvr || "TBC"})` : "")
    + (ctx.rate ? `, on a ${ctx.product || "variable"} product at ${String(ctx.rate).replace(/\.+$/, "")}.` : ".");

  let purpose;
  if (ctx.isRefi) {
    purpose = `${subj} ${v("is", "are")} seeking ${approval} to refinance ${v("their", "their")} existing ${ctx.isInvestment ? "investment" : "owner-occupied"} loan${withLender}${ctx.cashOut ? ", with additional funds to be released as equity for investment or personal use" : ""}. The primary objective of this refinance is to secure a more competitive interest rate and a loan structure that better aligns with ${v("the applicant's", "the clients'")} current financial position and longer-term goals, while improving overall cash flow.`;
  } else if (ctx.isInvestment) {
    purpose = `${subj} ${v("is", "are")} seeking ${approval} to purchase an investment property${withLender}. ${subj} ${v("has", "have")} a clear, considered strategy to build long-term wealth and capital growth through property investment, and ${v("intends", "intend")} to hold the asset over the long term, benefiting from rental income and prospective capital appreciation while diversifying ${v("their", "their")} asset base.`;
  } else if (ctx.firstHomeBuyer) {
    purpose = `${subj} ${v("is", "are")} seeking ${approval} to purchase ${v("a", "their")} first owner-occupied home to live in${withLender}. As ${v("a first-home buyer", "first-home buyers")}, ${subj.toLowerCase()} ${v("has", "have")} been saving diligently towards this purchase and ${v("is", "are")} entering home ownership in a financially responsible manner.`;
  } else {
    purpose = `${subj} ${v("is", "are")} seeking ${approval} to purchase an owner-occupied property to live in${withLender}. This purchase aligns with ${v("the applicant's", "the clients'")} personal and long-term housing objectives, providing stable, secure accommodation.`;
  }
  const lvrText = ctx.lvr || "a conservative level";
  const structure = ctx.rate
    ? `The total loan amount is ${money(ctx.loanAmount)}${ctx.value ? ` against a security valued at ${money(ctx.value)}, representing an LVR of ${lvrText}` : ""}. The facility is structured on a ${ctx.product || "variable"} product at ${String(ctx.rate).replace(/\.$/, "")}${ctx.term ? ` over a ${ctx.term}-year term` : ""}, which is appropriate to ${v("the applicant's", "the clients'")} objectives and repayment capacity.`
    : `The total loan amount is ${money(ctx.loanAmount)}${ctx.value ? ` against a security valued at ${money(ctx.value)}, representing an LVR of ${lvrText}` : ""}${ctx.term ? `, structured over a ${ctx.term}-year term` : ""}.`;
  // Repayment preferences + financial strengths — only stated when the case actually records them (no invention).
  const prefBits = [];
  if (ctx.repaymentType) prefBits.push(`a ${ctx.repaymentType} repayment structure`);
  if (ctx.repaymentFreq) prefBits.push(`${String(ctx.repaymentFreq).toLowerCase()} repayments`);
  if (ctx.redraw) prefBits.push("redraw access");
  if (ctx.extraRepayments) prefBits.push("the flexibility to make additional repayments where possible");
  const prefs = prefBits.length ? `${subj} ${v("prefers", "prefer")} ${listJoin(prefBits)} to assist with paying down the loan over time. ` : "";
  const strengthBits = [];
  if (ctx.depositStrong) strengthBits.push("a strong deposit position");
  if (ctx.dependants === 0 || ctx.dependants === "0") strengthBits.push("no dependants");
  if (ctx.noLiabilities) strengthBits.push("no disclosed liabilities");
  const strengths = strengthBits.length ? `${subj} ${v("has", "have")} ${listJoin(strengthBits)}. ` : "";
  const reassurance = `${subj} ${v("is", "are")} employed and ${v("earns", "earn")} consistent, verifiable income (detailed below), ${v("lives", "live")} within ${v("their", "their")} means, and ${v("does", "do")} not foresee any changes to ${v("their", "their")} financial position that would adversely affect serviceability.`;
  const proposal = [purpose, structure, (strengths + prefs).trim(), reassurance].filter(Boolean).join(" ");

  // Note: do NOT assert a "clean credit file" (that requires a checked credit report). State disclosed conduct.
  // Deposit/liabilities line follows the real data: strong deposit (low LVR) and/or no disclosed liabilities.
  const strengthParts = [];
  if (ctx.depositStrong) strengthParts.push("strong deposit position");
  if (ctx.noLiabilities) strengthParts.push("absence of disclosed liabilities");
  const dispLine = strengthParts.length ? ` ${v("The applicant's", "The clients'")} ${listJoin(strengthParts)} support${strengthParts.length > 1 ? "" : "s"} a disciplined financial position.` : "";
  const character = `${subj} ${v("demonstrates", "demonstrate")} a stable and responsible financial position with the capacity to service the proposed lending. ${subj} ${v("has", "have")} disclosed no adverse credit conduct, arrears or repayment difficulty, and ${v("lives", "live")} within ${v("their", "their")} means while maintaining a consistent savings pattern.${ctx.equifaxLifted ? ` ${subj} ${v("has", "have")} confirmed the Equifax credit file restriction has been lifted.` : ""}${dispLine} ${subj} ${v("understands", "understand")} the obligations of the facility and ${v("does", "do")} not foresee any changes to ${v("their", "their")} financial circumstances that would impair the ability to meet repayments.`;

  const collateral = [
    `The security offered is ${ctx.isRefi ? "the applicant's existing property" : "the subject property"}${ctx.security ? ` at ${ctx.security}` : ""}, which is considered acceptable for the proposed lending:`,
    ctx.value ? `• Estimated security value: ${money(ctx.value)}` : "",
    ctx.lvr ? `• Resulting LVR: ${ctx.lvr}${ctx.isRefi ? "" : ""}` : "",
    "• Located in an acceptable, established postcode",
    "• Standard residential dwelling in good condition",
    ctx.isRefi ? "• Existing loan statements / payout figures attached" : (ctx.contractPending ? "• Contract of Sale to be provided once signed" : "• Contract of Sale attached"),
    ctx.lvr && parseFloat(ctx.lvr) <= 80 ? "The conservative LVR provides a strong equity buffer and materially mitigates lender risk." : ""
  ].filter(Boolean).join("\n");

  const capacity = `Serviceability is supported by ${couple ? "the clients'" : "the applicant's"} ${v("income, which", "incomes, which")} ${v("is", "are")} consistent and verifiable from the recent payslips provided, and ${couple ? "the clients are" : "the applicant is"} employed on a full-time permanent basis. ${subj} ${v("has", "have")} advised no foreseeable changes that would adversely impact ${v("their", "their")} income or ability to meet the proposed repayments. The position supports servicing subject to the lender's standard credit assessment and verification requirements; please refer to the serviceability assessment for full details.`;

  // EXIT STRATEGY — included for short-term facilities, cash-out, or where the broker wants it spelled out.
  let exitStrategy = "";
  if ((ctx.term && ctx.term <= 10) || ctx.cashOut) {
    exitStrategy = [
      `The proposed lending is supported by clear and realistic exit pathways:`,
      `• Primary strategy — the facility will be serviced and repaid from ${couple ? "the clients'" : "the applicant's"} ongoing income over the loan term, which has been assessed as sufficient and sustainable.`,
      ctx.value && ctx.lvr && parseFloat(ctx.lvr) < 70 ? `• Secondary strategy — substantial equity is held in the security (LVR ${ctx.lvr}), providing the option to refinance or sell the asset if circumstances change.` : "• Secondary strategy — the option to refinance or realise the secured asset remains available if circumstances change.",
      `Given the loan amount, structure${ctx.term ? ` and ${ctx.term}-year term` : ""}, repayments are considered manageable and sustainable throughout the life of the facility.`
    ].filter(Boolean).join("\n");
  }

  const noDebtsNote = `${subj} ${v("has", "have")} no additional liabilities or unsecured debts — no personal loans, credit cards or buy-now-pay-later facilities are held in ${v("their", "their")} name. This reflects strong financial discipline and a positive, well-managed repayment history.`;
  const debtsLead = `${subj} ${v("has", "have")} the following existing ${ctx.debtCount > 1 ? "liabilities" : "liability"}, ${ctx.isRefi ? "which form part of this application" : "which ha" + (ctx.debtCount > 1 ? "ve" : "s") + " been considered and allowed for in the servicing assessment"}:`;

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

    // ---- Facts grid (2 columns) ----
    const colW = (CW - 14) / 2, labelW = 92, rowH = 19;
    let fx = M, fy = y, colCount = 0;
    for (const [k, v] of r.facts) {
      const x = colCount % 2 === 0 ? M : M + colW + 14;
      doc.rect(x, fy, labelW, rowH).fill(navy);
      doc.fillColor("#FFFFFF").font("Helvetica-Bold").fontSize(7.8).text(up(k), x + 6, fy + 6, { width: labelW - 10 });
      doc.rect(x + labelW, fy, colW - labelW, rowH).fillAndStroke("#FFFFFF", LINE);
      doc.fillColor(INK).font("Helvetica").fontSize(8.6).text(safe(String(v)), x + labelW + 6, fy + 6, { width: colW - labelW - 10, ellipsis: true, height: rowH - 4 });
      colCount += 1;
      if (colCount % 2 === 0) fy += rowH + 4;
    }
    if (colCount % 2 === 1) fy += rowH + 4;
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
