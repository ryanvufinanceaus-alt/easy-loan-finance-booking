// YTD / Casual income calculator — Excel only (per broker). Rebuilds the broker's existing
// "CASUAL CALC/YTD TEMPLATE" look (bordered box, yellow input cells, accounting $ format, live formulas)
// and polishes it with the Easy Loan Finance brand (navy/gold + logo), a Base+OT total, the base-income
// working shown as a formula, and IFERROR guards so the sheet never shows #DIV/0! before the broker
// completes the yellow payslip cells.

import ExcelJS from "exceljs";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const NAVY = "FF1E2430", GOLD = "FFD4A843", YELLOW = "FFFFF2B8", LIGHT = "FFF5F6F8", LINE = "FFCED3DA", WHITE = "FFFFFFFF", INK = "FF222831", MUTE = "FF6B7280";
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
function toDate(value) {
  if (value instanceof Date) return value;
  if (value == null || value === "") return null;
  // Australian dd/mm/yyyy (or dd-mm-yyyy) — JS Date misreads these as mm/dd, so parse explicitly.
  const m = String(value).trim().match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  if (m) { const yr = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]); const d = new Date(yr, Number(m[2]) - 1, Number(m[1])); return Number.isNaN(d.getTime()) ? null : d; }
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}
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
  [15, 12, 12, 11, 17, 12, 12, 11].forEach((w, i) => { ws.getColumn(i + 1).width = w; });

  const merge = (range) => ws.mergeCells(range);
  const fillOf = (cell, argb) => { cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb } }; };
  function box(range) { const [a, b] = range.split(":"); const cc1 = ws.getCell(a), cc2 = ws.getCell(b || a); setOuterBox(ws, cc1.col, cc1.row, cc2.col, cc2.row, LINE, "thin"); }
  const label = (range, text, opts = {}) => {
    merge(range); const cell = ws.getCell(range.split(":")[0]);
    cell.value = text;
    cell.font = { name: "Calibri", size: opts.size || 10, bold: opts.bold !== false, color: { argb: opts.color || NAVY } };
    cell.alignment = { horizontal: opts.h || "left", vertical: "middle", wrapText: true };
    if (opts.fill) fillOf(cell, opts.fill);
    if (opts.box !== false) box(range);
  };
  const value = (range, val, opts = {}) => {
    merge(range); const cell = ws.getCell(range.split(":")[0]);
    cell.value = val;
    cell.font = { name: "Calibri", size: opts.size || 11, bold: !!opts.bold, color: { argb: opts.color || INK } };
    cell.alignment = { horizontal: opts.h || "left", vertical: "middle" };
    if (opts.numFmt) cell.numFmt = opts.numFmt;
    fillOf(cell, opts.fill || WHITE);
    if (opts.box !== false) box(range);
  };

  // ---- Header band (navy) + logo + gold rule ----
  merge("A1:H3");
  const band = ws.getCell("A1");
  band.value = "EASY LOAN FINANCE";
  band.font = { name: "Calibri", size: 18, bold: true, color: { argb: WHITE } };
  band.alignment = { horizontal: "center", vertical: "middle" };
  fillOf(band, NAVY);
  ws.getRow(1).height = 16; ws.getRow(2).height = 18; ws.getRow(3).height = 12;
  merge("A4:H4");
  const sub = ws.getCell("A4");
  sub.value = "CASUAL / YTD INCOME CALCULATION";
  sub.font = { name: "Calibri", size: 11, bold: true, color: { argb: NAVY } };
  sub.alignment = { horizontal: "center", vertical: "middle" };
  fillOf(sub, GOLD);
  ws.getRow(4).height = 16;
  if (LOGO) { try { const id = wb.addImage({ buffer: LOGO, extension: "png" }); ws.addImage(id, { tl: { col: 0.15, row: 0.25 }, ext: { width: 46, height: 46 } }); } catch { /* skip */ } }

  // ---- Client + base-income working ----
  label("A6:B6", "CLIENT", { h: "left" });
  value("C6:H6", c.clientName, { h: "left", bold: true });
  const baseAmt = num(input.baseAmount), mult = num(input.baseMultiplier) || 1, freq = input.baseFrequency || "Annually";
  label("A7:B7", "BASE INCOME", { h: "left" });
  const money2 = (n) => "$" + round2(n).toLocaleString("en-AU", { minimumFractionDigits: 2 });
  let working;
  if (baseAmt && mult > 1) working = `${money2(baseAmt)} × ${mult} (${freq.toLowerCase()})  =  ${money2(c.base)} p.a.`;
  else if (c.base) working = `${money2(c.base / 26)} × 26 (fortnightly)  =  ${money2(c.base)} p.a.`; // auto-derive the formula
  else working = "(captured from Infinity)";
  value("C7:H7", working, { h: "left", color: MUTE });
  ws.getRow(6).height = 18; ws.getRow(7).height = 16;

  // ---- Instruction strip ----
  label("A9:H9", "Complete the YELLOW cells from the most recent payslip — the annualised figures update automatically.", { color: MUTE, bold: false, h: "center", fill: LIGHT, size: 9.5 });
  ws.getRow(9).height = 16;

  // ---- Inputs (yellow) + computed ----
  const R = { fd: 11, lp: 14, days: 17, base: 20 };
  ws.getRow(R.fd + 1).height = 24; ws.getRow(R.lp + 1).height = 24; ws.getRow(R.days + 1).height = 22; ws.getRow(R.base + 1).height = 22;

  label(`A${R.fd}:D${R.fd}`, "First Pay Day / Start of Financial Year");
  label(`E${R.fd}:H${R.fd}`, "YTD Income on Last Payslip");
  if (c.first) value(`A${R.fd + 1}:D${R.fd + 1}`, c.first, { numFmt: "dd/mm/yyyy", fill: YELLOW, h: "center", bold: true });
  else value(`A${R.fd + 1}:D${R.fd + 1}`, "", { fill: YELLOW });
  value(`E${R.fd + 1}:H${R.fd + 1}`, c.netYtd ? round2(c.netYtd) : "", { numFmt: ACCT, fill: YELLOW, bold: true });

  label(`A${R.lp}:D${R.lp}`, "Last Pay Day as per Payslip");
  label(`E${R.lp}:H${R.lp}`, "Income per Day  ( YTD ÷ Days )");
  if (c.last) value(`A${R.lp + 1}:D${R.lp + 1}`, c.last, { numFmt: "dd/mm/yyyy", fill: YELLOW, h: "center", bold: true });
  else value(`A${R.lp + 1}:D${R.lp + 1}`, "", { fill: YELLOW });
  value(`E${R.lp + 1}:H${R.lp + 1}`, { formula: `IFERROR(E${R.fd + 1}/A${R.days + 1},0)` }, { numFmt: ACCT });

  label(`A${R.days}:D${R.days}`, "No. of Days Between (DAYS360)");
  label(`E${R.days}:H${R.days}`, "Annualised Income  ( Income/Day × 365 )");
  value(`A${R.days + 1}:D${R.days + 1}`, { formula: `IFERROR(DAYS360(A${R.fd + 1},A${R.lp + 1}),0)` }, { h: "center", bold: true });
  // Extrapolate once the broker enters the payslip YTD figure; until then show the captured base annual so the
  // sheet never reads $0 (the pay dates are auto-filled, so gate on the YTD income cell, not on the day count).
  value(`E${R.days + 1}:H${R.days + 1}`, { formula: `IF(E${R.fd + 1}>0,E${R.lp + 1}*365,A${R.base + 1})` }, { numFmt: ACCT, bold: true, fill: LIGHT });

  label(`A${R.base}:D${R.base}`, "Base Income (Annually)");
  label(`E${R.base}:H${R.base}`, "Over Time / Casual Loading (Annually)");
  value(`A${R.base + 1}:D${R.base + 1}`, round2(c.base), { numFmt: ACCT, fill: YELLOW, bold: true });
  value(`E${R.base + 1}:H${R.base + 1}`, { formula: `MAX(E${R.days + 1}-A${R.base + 1},0)` }, { numFmt: ACCT });

  // ---- Overtime shading table (Base + OT) ----
  const H = R.base + 3;
  ws.getRow(H).height = 18;
  label(`A${H}:D${H}`, "OVERTIME SHADING", { color: WHITE, fill: NAVY, h: "center" });
  label(`E${H}:F${H}`, "Overtime (p.a.)", { color: WHITE, fill: NAVY, h: "center" });
  label(`G${H}:H${H}`, "Total (Base + OT)", { color: WHITE, fill: NAVY, h: "center" });
  const otCell = `E${R.base + 1}`, baseCell = `A${R.base + 1}`;
  const weeks = [["40 WEEKS", `${otCell}/52*40`], ["46 WEEKS", `${otCell}/52*46`], ["48 WEEKS", `${otCell}/52*48`], ["52 WEEKS", otCell]];
  weeks.forEach(([lbl, otFormula], i) => {
    const row = H + 1 + i;
    const highlight = i === weeks.length - 1;
    label(`A${row}:D${row}`, lbl, { bold: true, fill: highlight ? GOLD : LIGHT });
    value(`E${row}:F${row}`, { formula: otFormula }, { numFmt: ACCT, fill: highlight ? GOLD : WHITE, bold: highlight });
    value(`G${row}:H${row}`, { formula: `${baseCell}+${otFormula}` }, { numFmt: ACCT, fill: highlight ? GOLD : LIGHT, bold: true });
  });
  const lastRow = H + weeks.length;

  // ---- Footer ----
  const fr = lastRow + 2;
  merge(`A${fr}:H${fr}`);
  const foot = ws.getCell(`A${fr}`);
  foot.value = "Easy Loan Finance  ·  Prepared with EasyFlow AI  ·  Figures are indicative and subject to lender assessment.";
  foot.font = { name: "Calibri", size: 8.5, italic: true, color: { argb: MUTE } };
  foot.alignment = { horizontal: "center", vertical: "middle" };
  ws.getRow(fr).height = 14;

  setOuterBox(ws, 1, 1, 8, lastRow, NAVY, "medium");
  return Buffer.from(await wb.xlsx.writeBuffer());
}
