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

export function normaliseRec(input = {}) {
  const purpose = String(input.loanPurpose || "purchase").toLowerCase();
  const isInvestment = /invest/.test(String(input.propertyType || "")) || /invest/.test(purpose);
  const isPreApproval = /pre/.test(String(input.loanType || ""));
  const approvalWord = isPreApproval ? "PRE-APPROVAL" : "FORMAL APPROVAL";
  const propWord = isInvestment ? "AN INVESTMENT PROPERTY" : "AN OWNER-OCCUPIED PROPERTY";
  const action = /refinance/.test(purpose) ? "TO REFINANCE" : "TO PURCHASE";
  const atLender = input.lenderName ? ` AT ${up(input.lenderName)}` : "";
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
    ["CHARACTER", input.character], ["COLLATERAL", input.collateral]
  ].filter(([, v]) => v && String(v).trim());
  return {
    fileOwner: input.fileOwner || "Viet Anh Vu",
    mobileNumber: input.mobileNumber || "0421 367 899",
    brokerEmail: input.brokerEmail || "ryan@easyloanfinance.com.au",
    clientName: input.clientName || "",
    seekingLine: `SEEKING ${approvalWord} ${action} ${propWord}${atLender}`,
    isInvestment, facts, sections, debts
  };
}

function debtsLines(debts) {
  if (!debts.length) return ["The applicant has no additional liabilities or unsecured debts."];
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
    // ---- Assessor note strip ----
    doc.roundedRect(M, y, CW, 30, 4).fill(LIGHT).stroke ? null : null;
    doc.roundedRect(M, y, CW, 30, 4).fillAndStroke(LIGHT, LINE);
    doc.fillColor(MUTED).font("Helvetica-Oblique").fontSize(8.5)
      .text("ATTENTION CREDIT ASSESSOR — please kindly read this note in full before issuing conditions or calling the broker for clarifications.", M + 10, y + 8, { width: CW - 20 });
    y += 44;

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
    const sectionHeading = (label) => {
      if (doc.y > doc.page.height - 90) doc.addPage({ margin: 0 }), (doc.y = 48);
      const yy = doc.y;
      doc.fillColor(navy).font("Helvetica-Bold").fontSize(10.5).text(label, M, yy);
      doc.moveTo(M, doc.y + 1).lineTo(M + 46, doc.y + 1).lineWidth(2).strokeColor(gold).stroke();
      doc.moveDown(0.35);
    };
    doc.y = y;
    for (const [label, body] of r.sections) {
      sectionHeading(label);
      doc.fillColor(INK).font("Helvetica").fontSize(9.6).text(safe(String(body).trim()), M, doc.y, { width: CW, align: "justify", lineGap: 2 });
      doc.moveDown(0.7);
    }
    sectionHeading("OTHER DEBTS");
    doc.fillColor(INK).font("Helvetica").fontSize(9.6);
    debtsLines(r.debts).forEach((ln) => doc.text("•  " + safe(ln), M, doc.y, { width: CW, lineGap: 2 }));

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

  const heading = (label) => new Paragraph({ spacing: { before: 200, after: 60 }, border: { bottom: { style: BorderStyle.SINGLE, size: 12, color: gold } }, children: [new TextRun({ text: label, bold: true, color: navy, size: 21 })] });

  const kids = [
    headerBar,
    P("ATTENTION CREDIT ASSESSOR — please kindly read this note in full before issuing conditions or calling the broker for clarifications.", { italics: true, color: muted, size: 16, before: 160 }),
    new Paragraph({ spacing: { before: 120, after: 60 }, children: [new TextRun({ text: up(r.clientName), bold: true, color: navy, size: 28 })] }),
    new Paragraph({ shading: { type: ShadingType.CLEAR, fill: gold, color: "auto" }, spacing: { after: 120 }, children: [new TextRun({ text: " " + r.seekingLine + " ", bold: true, color: navy, size: 19 })] }),
    factsTable
  ];
  for (const [label, body] of r.sections) {
    kids.push(heading(label));
    String(body).trim().split(/\n+/).forEach((ln) => kids.push(P(ln, { align: AlignmentType.JUSTIFIED })));
  }
  kids.push(heading("OTHER DEBTS"));
  debtsLines(r.debts).forEach((ln) => kids.push(new Paragraph({ bullet: { level: 0 }, spacing: { after: 60 }, children: [new TextRun({ text: ln, color: ink, size: 19 })] })));
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
