// YTD / Casual income calculator — Excel only (per broker). Rebuilds the broker's existing
// "CASUAL CALC/YTD TEMPLATE" look (bordered box, merged banner, yellow input cells, accounting $ format,
// live formulas) and polishes it with the Easy Loan Finance brand (navy/gold + logo) and a Base+OT total.

import ExcelJS from "exceljs";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const NAVY = "FF1E2430", GOLD = "FFD4A843", YELLOW = "FFFFF2B8", LIGHT = "FFF5F6F8", LINE = "FFCED3DA", WHITE = "FFFFFFFF";
const ACCT = '_-"$"* #,##0.00_-;-"$"* #,##0.00_-;_-"$"* "-"??_-;_-@_-';
const HERE = path.dirname(fileURLToPath(import.meta.url));
function loadLogo() {
  for (const p of [path.join(HERE, "../../../public/elf-logo.png"), path.join(process.cwd(), "public/elf-logo.png"), path.join(process.cwd(), "dist/elf-logo.png")]) {
    try { return readFileSync(p); } catch { /* next */ }
  }
  return null;
}
const LOGO = loadLogo();

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const round2 = (v) => Math.round(num(v) * 100) / 100;
function toDate(value) { if (value instanceof Date) return value; const d = new Date(value); return Number.isNaN(d.getTime()) ? null : d; }
function days360(d1, d2) {
  if (!d1 || !d2) return 0;
  let a = d1.getDate(), b = d2.getDate();
  if (a === 31) a = 30; if (b === 31) b = 30;
  return (d2.getFullYear() - d1.getFullYear()) * 360 + (d2.getMonth() - d1.getMonth()) * 30 + (b - a);
}

export function computeYtd(input = {}) {
  const first = toDate(input.firstPayDay), last = toDate(input.lastPayDay);
  const days = days360(first, last);
  const additional = (input.additionalIncomes || []).filter((x) => num(x.ytdAmount) > 0);
  const deductions = (input.deductions || []).filter((x) => num(x.ytdAmount) > 0);
  const baseYtd = num(input.ytdIncome);
  const addYtd = additional.reduce((s, x) => s + num(x.ytdAmount), 0);
  const dedYtd = deductions.reduce((s, x) => s + num(x.ytdAmount), 0);
  const netYtd = baseYtd + addYtd - dedYtd;
  const perDay = days > 0 ? netYtd / days : 0;
  const yearly = perDay * 365;
  const base = num(input.baseAnnual);
  const ot = yearly - base;
  return {
    clientName: input.clientName || "", first, last, days, netYtd, perDay: round2(perDay),
    yearly: round2(yearly), base, ot: round2(ot)
  };
}

function thin(color = LINE) { return { style: "thin", color: { argb: color } }; }
function setOuterBox(ws, c1, r1, c2, r2, color, style = "medium") {
  for (let r = r1; r <= r2; r += 1) {
    for (let c = c1; c <= c2; c += 1) {
      const cell = ws.getRow(r).getCell(c);
      const b = { ...cell.border };
      if (r === r1) b.top = { style, color: { argb: color } };
      if (r === r2) b.bottom = { style, color: { argb: color } };
      if (c === c1) b.left = { style, color: { argb: color } };
      if (c === c2) b.right = { style, color: { argb: color } };
      cell.border = b;
    }
  }
}

export async function buildYtdXlsx(input = {}) {
  const c = computeYtd(input);
  const wb = new ExcelJS.Workbook();
  wb.creator = "EasyFlow AI";
  const ws = wb.addWorksheet("YTD Calc", { views: [{ showGridLines: false }] });
  [14, 12, 12, 10, 16, 12, 12, 10].forEach((w, i) => { ws.getColumn(i + 1).width = w; });

  const merge = (range) => ws.mergeCells(range);
  const fillOf = (cell, argb) => { cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb } }; };
  const label = (range, text, opts = {}) => {
    merge(range); const cell = ws.getCell(range.split(":")[0]);
    cell.value = text;
    cell.font = { name: "Calibri", size: opts.size || 10.5, bold: opts.bold !== false, color: { argb: opts.color || NAVY } };
    cell.alignment = { horizontal: opts.h || "left", vertical: "middle", wrapText: true };
    if (opts.fill) fillOf(cell, opts.fill);
    box(range);
  };
  const value = (range, val, opts = {}) => {
    merge(range); const cell = ws.getCell(range.split(":")[0]);
    cell.value = val;
    cell.font = { name: "Calibri", size: opts.size || 11, bold: !!opts.bold, color: { argb: opts.color || "FF222831" } };
    cell.alignment = { horizontal: opts.h || "left", vertical: "middle" };
    if (opts.numFmt) cell.numFmt = opts.numFmt;
    fillOf(cell, opts.fill || WHITE);
    box(range);
  };
  function box(range) { ws.getCell(range.split(":")[0]); const [a, b] = range.split(":"); const cc1 = ws.getCell(a), cc2 = ws.getCell(b || a); setOuterBox(ws, cc1.col, cc1.row, cc2.col, cc2.row, LINE, "thin"); }

  // ---- Banner ----
  merge("A1:H2");
  const banner = ws.getCell("A1");
  banner.value = "EASY LOAN FINANCE   ·   CASUAL / YTD INCOME CALCULATION";
  banner.font = { name: "Calibri", size: 15, bold: true, color: { argb: NAVY } };
  banner.alignment = { horizontal: "center", vertical: "middle" };
  fillOf(banner, GOLD);
  ws.getRow(1).height = 20; ws.getRow(2).height = 18;
  if (LOGO) { try { const id = wb.addImage({ buffer: LOGO, extension: "png" }); ws.addImage(id, { tl: { col: 0.12, row: 0.18 }, ext: { width: 38, height: 38 } }); } catch { /* skip */ } }

  // ---- Client ----
  label("A3:B3", "CLIENT NAME", { h: "left" });
  value("C3:H3", c.clientName, { h: "left", bold: true });
  ws.getRow(3).height = 18;

  // ---- Inputs (yellow) + computed ----
  ws.getRow(5).height = 26; ws.getRow(8).height = 26; ws.getRow(11).height = 18; ws.getRow(14).height = 18;
  label("A5:D5", "First Pay Day / Start of Financial Year");
  label("E5:H5", "YTD Income on Last Payslip");
  if (c.first) value("A6:D6", c.first, { numFmt: "dd/mm/yyyy", fill: YELLOW, h: "center", bold: true });
  else value("A6:D6", "", { fill: YELLOW });
  value("E6:H6", round2(c.netYtd), { numFmt: ACCT, fill: YELLOW, bold: true });

  label("A8:D8", "Last Pay Day as per Payslip");
  label("E8:H8", "Income per Day");
  if (c.last) value("A9:D9", c.last, { numFmt: "dd/mm/yyyy", fill: YELLOW, h: "center", bold: true });
  else value("A9:D9", "", { fill: YELLOW });
  value("E9:H9", { formula: "E6/A12" }, { numFmt: ACCT });

  label("A11:D11", "No. of Days Between (DAYS360)");
  label("E11:H11", "Yearly Income (annualised)");
  value("A12:D12", { formula: "DAYS360(A6,A9)" }, { h: "center", bold: true });
  value("E12:H12", { formula: "E9*365" }, { numFmt: ACCT, bold: true });

  label("A14:D14", "Base Income (Annually)");
  label("E14:H14", "Over Time / Casual Loading (Annually)");
  value("A15:D15", round2(c.base), { numFmt: ACCT, fill: YELLOW, bold: true });
  value("E15:H15", { formula: "E12-A15" }, { numFmt: ACCT });

  // ---- Overtime shading table (Base + OT) ----
  ws.getRow(17).height = 18;
  label("A17:D17", "OVERTIME SHADING", { color: WHITE, fill: NAVY, h: "center" });
  label("E17:F17", "Overtime (p.a.)", { color: WHITE, fill: NAVY, h: "center" });
  label("G17:H17", "Total (Base + OT)", { color: WHITE, fill: NAVY, h: "center" });
  const weeks = [[18, "40 WEEKS", "E15/52*40"], [19, "46 WEEKS", "E15/52*46"], [20, "48 WEEKS", "E15/52*48"], [21, "52 WEEKS", "E15"]];
  for (const [row, lbl, otFormula] of weeks) {
    const highlight = row === 21;
    label(`A${row}:D${row}`, lbl, { bold: true, fill: highlight ? GOLD : LIGHT });
    value(`E${row}:F${row}`, { formula: otFormula }, { numFmt: ACCT, fill: highlight ? GOLD : WHITE, bold: highlight });
    value(`G${row}:H${row}`, { formula: `A15+${otFormula}` }, { numFmt: ACCT, fill: highlight ? GOLD : LIGHT, bold: true });
  }

  setOuterBox(ws, 1, 1, 8, 21, NAVY, "medium");
  return Buffer.from(await wb.xlsx.writeBuffer());
}
