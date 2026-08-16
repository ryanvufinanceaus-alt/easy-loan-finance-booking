import mapping from "../mappings/infinity-aol-v1.json" with { type: "json" };
import { buildInfinityTemplate } from "./infinityTemplate.mjs";
import { buildAolTemplate } from "./aolTemplate.mjs";

const money = (value) => Number(value || 0);

function applicantByRole(caseData, role) {
  return caseData.applicants.find((applicant) => applicant.role === role) || null;
}

function compactApplicant(applicant) {
  if (!applicant) return null;
  const fullName = [applicant.firstName, applicant.middleName, applicant.lastName || applicant.surname].filter(Boolean).join(" ").trim();
  if (!fullName) return null;
  const currentResidentialStatus =
    applicant.currentResidentialStatus ||
    applicant.currentHousingSituation ||
    applicant.address?.residentialStatus ||
    applicant.address?.currentResidentialStatus ||
    "";

  return {
    fullName,
    firstName: applicant.firstName || "",
    middleName: applicant.middleName || "",
    lastName: applicant.lastName || "",
    title: applicant.title || "",
    gender: applicant.gender || "",
    dateOfBirth: applicant.dateOfBirth || "",
    maritalStatus: applicant.maritalStatus || "",
    currentResidentialStatus,
    currentHousingSituation: applicant.currentHousingSituation || currentResidentialStatus,
    residencyStatus: applicant.residencyStatus || "",
    dependants: applicant.dependants ?? 0,
    email: applicant.email || "",
    mobile: applicant.mobile || "",
    // PHẢI map thật, không chỉ khai trong READ_APPLICANT_KEYS. Khai mà không map = tắt chuông rồi để
    // field rơi im lặng như cũ — đúng thứ guard sinh ra để chặn. AOL đòi "Current Address Since".
    addressSince: applicant.addressSince || "",
    id: applicant.id || {},
    // 2026-08-16 — MAP THẬT, không khai suông (đúng câu ghi ngay trên: khai mà không map = tắt chuông).
    // Guard chặn prepare-infinity-aol bằng 500 vì case gửi `currentResidentialAddress` và `driverLicence`
    // mà mapper không đọc. Guard làm ĐÚNG: hai khoá đó chính là địa chỉ ở và bằng lái của khách — thứ
    // Infynity Client Details bắt buộc có (4 ô địa chỉ + 4 trường licence), và là thứ phía Sabrina đang
    // chờ để bù vào form. Bỏ qua chúng thì form trống mà không ai biết vì sao.
    // `address` giữ nguyên làm nguồn chính; currentResidentialAddress là TÊN case thật đang dùng nên
    // nhận cả hai, ưu tiên cái có dữ liệu.
    address: applicant.address || applicant.currentResidentialAddress || {},
    currentResidentialAddress: applicant.currentResidentialAddress || applicant.address || {},
    driverLicence: applicant.driverLicence || {},
    employment: applicant.employment || {},
    income: applicant.income || {}
  };
}

// 🔑 A MAPPER THAT SILENTLY DISCARDS IS THE DEFECT (2026-08-09).
//
// /api/cases/import does `caseData = {...body}` - it enforces no shape at all. So THIS file is the only
// contract there is, and anything it does not read is gone with nothing said. Measured cost: a fixture
// sent assets/liabilities/expenses per-applicant and `phone` instead of `mobile`; all of it vanished,
// the SoCA filled a template $40,000 over real savings of $168,000, and three sessions went looking in
// the browser for a fault that was never there. Downstream someone had already started patching around
// it by hand - `loadCase` re-patches six named fields from the raw case - which hides the next one.
//
// So: every key must be ACCOUNTED FOR. Two lists, because "not read" and "not known" are different
// things and collapsing them would throw on legitimate metadata like clientName. READ = this file
// consumes it. IGNORED = deliberately not consumed, written down so the decision is visible. Anything
// on neither list throws, naming the key - a new field can then only ever arrive loudly.
const READ_KEYS = new Set(["id", "brokerUser", "applicants", "expenses", "assets", "liabilities",
  "property", "loan", "brokerNotes", "documentChecklist", "documentIntake", "selectedTemplate",
  "expenseSource", "assetSource",
  // 2026-08-16: map thật ở buildInfinityPayload bên dưới (solicitor → khối AOL; recommendation → lender thắng).
  "solicitor", "recommendation"]);
// clientProfile: khai BỎ QUA có chủ đích. Nó là khối hồ sơ tổng do Broker Desk đính kèm; Infynity/AOL
// đọc từng trường riêng (applicants/loan/property) chứ không đọc khối này. Khai ra đây để lần sau
// không ai phải đoán "quên map hay cố ý bỏ" — đó chính là câu hỏi guard sinh ra để loại bỏ.
// clientCall: khai BỎ QUA có chủ đích (2026-08-16). Đây là ghi chú cuộc gọi ở front-of-funnel
// (client-call app) — dùng để dựng hồ sơ ban đầu, Infynity/AOL không có ô nào cho nó.
// serviceability: cũng BỎ QUA có chủ đích. Đây là ƯỚC LƯỢNG của Sabrina, mà theo C19 thì file SERV CALC
// của lender mới là thẩm quyền. Đẩy con số ước lượng sang portal là mời người đọc tin nhầm nó.
const IGNORED_KEYS = new Set(["clientName", "isTest", "email", "phone", "dependants", "status",
  "importedAt", "source", "notes", "createdAt", "updatedAt", "clientProfile",
  "clientCall", "serviceability"]);
const READ_APPLICANT_KEYS = new Set(["role", "firstName", "middleName", "lastName", "surname", "title",
  "gender", "dateOfBirth", "maritalStatus", "currentResidentialStatus", "currentHousingSituation",
  // addressSince: AOL đòi "Current Address Since" cho mỗi applicant. Guard bắt được nó ngay lần deploy
  // đầu — trước đó nó rơi ÂM THẦM ở đây, nên dù case có gửi thì form vẫn trống và không ai biết vì sao.
  // Đúng việc guard sinh ra để làm: gọi tên thứ đang bị nuốt.
  "residencyStatus", "dependants", "email", "mobile", "id", "address", "addressSince", "employment", "income",
  // 2026-08-16: hai khoá này case THẬT vẫn gửi (tên do loan form/import đặt) và đều được map ở
  // compactApplicant — địa chỉ ở + bằng lái, thứ Infynity Client Details bắt buộc có.
  "currentResidentialAddress", "driverLicence"]);

function assertFullyMapped(caseData) {
  const unknown = [];
  for (const k of Object.keys(caseData || {})) {
    if (!READ_KEYS.has(k) && !IGNORED_KEYS.has(k)) unknown.push(k);
  }
  (Array.isArray(caseData?.applicants) ? caseData.applicants : []).forEach((a, i) => {
    for (const k of Object.keys(a || {})) {
      if (!READ_APPLICANT_KEYS.has(k)) unknown.push("applicants[" + i + "]." + k);
    }
  });
  if (unknown.length) {
    // Name them ALL at once. One per round trip is how a two-minute read became six requests last week.
    throw new Error("MAPPER: " + unknown.length + " key(s) this mapper does not read, so they would be "
      + "silently dropped: " + unknown.join(", ")
      + "\n  Fix ONE of two ways - map the key here, or add it to IGNORED_KEYS to record that dropping "
      + "it is intended. Do not leave it unlisted."
      + "\n  Known shape traps: assets/liabilities are TOP-LEVEL ARRAYS of {value}, expenses is a "
      + "TOP-LEVEL OBJECT, and the phone field is read as `mobile` - per-applicant financials are not read.");
  }
}

export function buildInfinityPayload(caseData) {
  assertFullyMapped(caseData);
  const primary = compactApplicant(applicantByRole(caseData, "primary"));
  const secondary = compactApplicant(applicantByRole(caseData, "secondary"));
  const expenses = caseData.expenses || {};
  const totalMonthly =
    money(expenses.livingMonthly) +
    money(expenses.rentMonthly) +
    money(expenses.educationMonthly) +
    money(expenses.insuranceMonthly) +
    money(expenses.transportMonthly) +
    money(expenses.otherMonthly);
  const infinity = buildInfinityTemplate(caseData);
  const assetTotal = (caseData.assets || []).reduce((sum, asset) => sum + money(asset.value), 0);
  const serviceability = {
    hemMonthly: expenses.livingMonthly || caseData.documentIntake?.assumptions?.hemMonthly || 0,
    hemConfirmed: expenses.hemConfirmed === true || caseData.documentIntake?.assumptions?.hemConfirmed === true,
    financialAssetBuffer: assetTotal || caseData.documentIntake?.assumptions?.financialAssetBuffer || 0,
    // "" not "crm". These three fields state WHERE a number came from, and a fallback that answers
    // "crm" when nobody said is not a default - it is a provenance claim nobody made. Same shape as
    // stamping statementOfPositionDate = today, and worse in kind: an audit reads these to decide
    // whether a figure was verified. Unknown must read as unknown.
    documentIncomeSource: caseData.documentIntake?.assumptions?.incomeSource || "",
    expenseSource: caseData.expenseSource || expenses.source || caseData.documentIntake?.assumptions?.expenseSource || "",
    assetSource: caseData.assetSource || caseData.documentIntake?.assumptions?.assetSource || ""
  };

  return {
    meta: {
      caseId: caseData.id,
      brokerUser: caseData.brokerUser,
      preparedAt: new Date().toISOString(),
      source: "BrokerDesk CRM",
      targetPlatform: mapping.platform,
      mappingVersion: mapping.version,
      template: caseData.documentIntake?.template || caseData.selectedTemplate?.id || null,
      explicitBrokerReviewRequired: true,
      autoSubmitAllowed: false
    },
    applicants: {
      primary,
      secondary
    },
    // 2026-08-16 — MAP THẬT hai khoá cấp case mà guard đang chặn:
    // · solicitor: AOL Application tab có khối solicitor/conveyancer, handler bên Sabrina đọc thẳng
    //   payload.solicitor. Bỏ nó thì khối đó trống và sweep phải đi hỏi broker thứ case đã có sẵn.
    // · recommendation: đây là nguồn lender thắng. Bỏ nó ĐÃ TỪNG gây lỗi thật — caseById.recommendation
    //   về rỗng ⇒ validLenders=0 ⇒ addThreeScenarios bỏ qua ⇒ SoCA không finalise ⇒ không có nút Nextgen
    //   ⇒ AOL không mở được. Đó là lý do bên Sabrina phải đọc lender từ nhiều nguồn.
    solicitor: caseData.solicitor || {},
    recommendation: caseData.recommendation || {},
    expenses: {
      ...expenses,
      totalMonthly
    },
    assets: caseData.assets || [],
    liabilities: caseData.liabilities || [],
    property: caseData.property || {},
    loan: caseData.loan || {},
    brokerNotes: caseData.brokerNotes || "",
    documentChecklist: caseData.documentChecklist || [],
    documentIntake: caseData.documentIntake || null,
    serviceability,
    infinity,
    aol: buildAolTemplate({ ...caseData, serviceability }, infinity)
  };
}

export function getMapping() {
  return mapping;
}
