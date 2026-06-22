// Single source of truth for classifying a case as Refinance / Investment / Owner-occupied (+ Vacant land).
//
// THE RULE (fixes the "OOC case picked the INV template" bug, 2026-06-22):
//   1. The broker's EXPLICIT `property.occupancy` selection ("Owner occupied" / "Investment") wins for the
//      owner-occupied-vs-investment decision. It is the deliberate dropdown on the loan form.
//   2. `loan.opportunityName` is FREE TEXT from Infynity (e.g. an opportunity title) and must NEVER drive the
//      OOC/INV decision — a stray "investment"/"inv"/"rental" in it was flipping owner-occupied cases to INV.
//   3. Only when occupancy is absent do we fall back to the structured loan-purpose fields (still not the
//      free-text opportunity name).
// All three template builders (Infinity, AOL, and the case-template picker) call these so they can never drift.

function occupancyText(caseData) {
  return `${caseData?.property?.occupancy || ""}`.toLowerCase();
}

// Structured, deliberate fields only — deliberately EXCLUDES loan.opportunityName.
function structuredText(caseData) {
  return [
    caseData?.property?.purpose,
    caseData?.loan?.purpose,
    caseData?.loan?.loanPurpose,
    caseData?.loan?.applicationType,
    caseData?.selectedTemplate?.id,
    caseData?.selectedTemplate?.title
  ].map((v) => `${v || ""}`).join(" ").toLowerCase();
}

export function isRefinanceCase(caseData) {
  return /refinance|\brefi\b|cash.?out/.test(structuredText(caseData));
}

// Returns: "refinance" | "vacant-land" | "investment" | "owner-occupied"
export function classifyLoanPurpose(caseData) {
  const structured = structuredText(caseData);
  if (/refinance|\brefi\b|cash.?out/.test(structured)) return "refinance";
  if (structured.includes("vacant land")) return "vacant-land";

  const occ = occupancyText(caseData);
  if (/invest|rental/.test(occ)) return "investment";              // explicit broker choice
  if (/owner|occup|live.?in|\booc\b/.test(occ)) return "owner-occupied"; // explicit broker choice

  // occupancy not set → fall back to structured fields (NOT the free-text opportunity name)
  if (/investment|\binv\b|rental/.test(structured)) return "investment";
  return "owner-occupied";
}
