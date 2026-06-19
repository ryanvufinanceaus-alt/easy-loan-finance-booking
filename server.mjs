import { createServer } from "node:http";
import { createHash, createHmac, createSign, randomBytes, timingSafeEqual } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dns from "node:dns";
import nodemailer from "nodemailer";
import { app as infinityAolApp } from "./infinity-aol/server/index.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3000);
const DATA_DIR = path.join(__dirname, "data");
const DIST_DIR = path.join(__dirname, "dist");
const BROKER_DESK_DIR = path.join(__dirname, "broker-desk", "public");
const INFINITY_AOL_BASE = "/infinity-aol";
const BOOKING_HOST_RE = /^booking\./i;
const PORTAL_HOST_RE = /^(portal|app)\./i;
const CLIENT_CALL_HOST_RE = /^client-call\./i;
const LOAN_FORM_HOST_RE = /^loan-form\./i;
const EASYFLOW_AI_HOST_RE = /^(easyflow-ai|loanops|autofill)\./i;
const LOAN_SUBMISSIONS_HOST_RE = /^(loan-submissions-management|loan-submissions|submissions)\./i;
const LOAN_FORM_PUBLIC_PATH_RE = /^\/(?:loan-form|client-info|apply|start|home-loan|refinance|commercial-loan|business-loan|car-loan|personal-loan)(?:\/[^/]+)?\/?$/;
const LOAN_FORM_PUBLIC_API_RE = /^\/api\/client-intake\/[^/]+\/?$/;
const EASYFLOW_EXTENSION_API_RE = /^\/api\/(?:infinity\/(?:payload\/[^/]+|mappings\/current|prepared-cases|autofill-log)|cases\/[^/]+\/(?:comparison-report|comparison-snapshot|capture(?:\/[^/]+)?|loan-form-note)|aol-templates\/[^/]+)\/?$/;
const SHARED_BRAND_ASSET_RE = /^\/(?:elf-logo\.(?:png|svg)|favicon\.ico)$/i;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
const USE_SUPABASE = Boolean(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY);
const TIME_ZONE = process.env.BOOKING_TIME_ZONE || "Australia/Adelaide";
const EAST_COAST_TIME_ZONE = process.env.BOOKING_EAST_COAST_TIME_ZONE || "Australia/Sydney";
const BOOKING_TIME_LABEL = process.env.BOOKING_TIME_LABEL || "Adelaide time";
const EAST_COAST_TIME_LABEL = process.env.BOOKING_EAST_COAST_TIME_LABEL || "Sydney/Melbourne time";
const NOTIFY_EMAIL = process.env.BOOKING_NOTIFY_EMAIL || process.env.NOTIFY_EMAIL;
const CLIENT_CONFIRMATION_EMAILS = process.env.CLIENT_CONFIRMATION_EMAILS !== "false";
const GOOGLE_CALENDAR_ID = process.env.GOOGLE_CALENDAR_ID;
const GOOGLE_APPS_SCRIPT_CALENDAR_ID = process.env.GOOGLE_APPS_SCRIPT_CALENDAR_ID;
const BROKER_GOOGLE_CALENDAR_IDS = Object.fromEntries(
  (process.env.BROKER_GOOGLE_CALENDAR_IDS || "")
    .split(",")
    .map((pair) => pair.trim())
    .filter(Boolean)
    .map((pair) => {
      const [brokerId, ...calendarParts] = pair.split(":");
      return [brokerId?.trim(), calendarParts.join(":").trim()];
    })
    .filter(([brokerId, calendarId]) => brokerId && calendarId)
);
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || "ryan.vufinanceaus@gmail.com";
const ADMIN_EMAILS = Array.from(new Set([
  ADMIN_EMAIL,
  "ryan.vufinanceaus@gmail.com",
  "ryan@easyloanfinance.com.au",
  ...(process.env.ADMIN_EMAILS || "").split(",")
].map(normalizeEmail).filter(Boolean)));
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "";
const ADMIN_SESSION_SECRET = process.env.ADMIN_SESSION_SECRET || ADMIN_PASSWORD || "local-dev-secret-change-me";
const SESSION_MAX_AGE_SECONDS = Number(process.env.SESSION_MAX_AGE_SECONDS || 6 * 60 * 60);
const PASSWORD_RESET_TTL_SECONDS = Number(process.env.PASSWORD_RESET_TTL_SECONDS || 30 * 60);
const PUBLIC_API_ROUTES = new Set(["/api/health", "/api/brokers", "/api/bookings"]);
const PUBLIC_BOOKING_DURATION = 30;
const BUSINESS_START = "09:30";
const BUSINESS_END = "17:00";
const BROKER_DESK_API_URL = String(process.env.APPS_SCRIPT_URL || "").trim();
const REMINDER_MINUTES_BEFORE = Number(process.env.BOOKING_REMINDER_MINUTES_BEFORE || 10);
const reminderSendKeys = new Set();
const EMAIL_TEMPLATES_SETTING_KEY = "email_templates";

dns.setDefaultResultOrder?.("ipv4first");

const defaultEmailTemplates = {
  confirmationSubject: "Your Easy Loan Finance appointment is confirmed",
  confirmationBody: [
    "Hi {{clientName}},",
    "",
    "Your Easy Loan Finance appointment is confirmed.",
    "",
    "Broker: {{brokerName}}",
    "Service: {{service}}",
    "Time: {{time}}",
    "Meeting style: {{channel}}",
    "",
    "You will receive a quick reminder 10 minutes before we start.",
    "",
    "If anything changes, feel free to reply to this email.",
    "",
    "Kind regards,",
    "{{brokerName}}",
    "Easy Loan Finance | Quick Loan, Easy Life",
    "hello@easyloanfinance.com.au",
    "https://easyloanfinance.com.au"
  ].join("\n"),
  reminderSubject: "Reminder: your Easy Loan Finance appointment starts in 10 minutes",
  reminderBody: [
    "Hi {{clientName}},",
    "",
    "A quick reminder that your Easy Loan Finance appointment starts in 10 minutes.",
    "",
    "Broker: {{brokerName}}",
    "Time: {{time}}",
    "Meeting style: {{channel}}",
    "",
    "Easy Loan Finance | Quick Loan, Easy Life"
  ].join("\n")
};

const seedBrokers = [
  {
    id: "ryan-vu",
    name: "Ryan Vu",
    title: "Finance Broker",
    location: "Adelaide, SA",
    email: "ryan@easyloanfinance.com.au",
    phone: "0400 000 000",
    color: "#b89044",
    services: ["First home buyer", "Refinance", "Investment loan", "Commercial lending"],
    hours: { start: "09:00", end: "18:00" }
  },
  {
    id: "team-broker-1",
    name: "Mia Nguyen",
    title: "Senior Broker",
    location: "Adelaide, SA",
    email: "mia@easyloanfinance.com.au",
    phone: "0400 000 001",
    color: "#2f7d74",
    services: ["Pre-approval", "Construction loan", "Debt consolidation"],
    hours: { start: "09:00", end: "17:30" }
  },
  {
    id: "team-broker-2",
    name: "Daniel Park",
    title: "Credit Specialist",
    location: "Melbourne, VIC",
    email: "daniel@easyloanfinance.com.au",
    phone: "0400 000 002",
    color: "#8b5d6b",
    services: ["Complex income", "Asset finance", "Business lending"],
    hours: { start: "08:30", end: "17:00" }
  }
];

const seedBookings = [
  {
    id: "bk-demo-1",
    clientName: "Linh Tran",
    phone: "0412 555 110",
    email: "linh@example.com",
    brokerId: "ryan-vu",
    service: "First home buyer",
    channel: "Video call",
    status: "Confirmed",
    start: nextIso(1, 10, 0),
    end: nextIso(1, 10, 45),
    notes: "Needs borrowing capacity estimate before auction."
  },
  {
    id: "bk-demo-2",
    clientName: "Aiden Brooks",
    phone: "0412 555 210",
    email: "aiden@example.com",
    brokerId: "team-broker-1",
    service: "Refinance",
    channel: "Phone call",
    status: "Pending",
    start: nextIso(2, 14, 0),
    end: nextIso(2, 14, 30),
    notes: "Compare fixed expiry options."
  },
  {
    id: "bk-demo-3",
    clientName: "Sophia Wilson",
    phone: "0412 555 310",
    email: "sophia@example.com",
    brokerId: "team-broker-2",
    service: "Commercial lending",
    channel: "Office",
    status: "Confirmed",
    start: nextIso(4, 11, 30),
    end: nextIso(4, 12, 30),
    notes: "Bring trust structure and accountant contact."
  }
];

function nextIso(daysAhead, hour, minute) {
  const date = new Date();
  date.setDate(date.getDate() + daysAhead);
  date.setHours(hour, minute, 0, 0);
  return date.toISOString();
}

async function ensureData() {
  if (USE_SUPABASE) return;
  await fs.mkdir(DATA_DIR, { recursive: true });
  await ensureFile("brokers.json", seedBrokers);
  await ensureFile("bookings.json", seedBookings);
}

async function ensureFile(name, fallback) {
  const file = path.join(DATA_DIR, name);
  try {
    await fs.access(file);
  } catch {
    await fs.writeFile(file, JSON.stringify(fallback, null, 2));
  }
}

async function readJson(name) {
  const raw = await fs.readFile(path.join(DATA_DIR, name), "utf8");
  return JSON.parse(raw);
}

async function writeJson(name, value) {
  await fs.writeFile(path.join(DATA_DIR, name), JSON.stringify(value, null, 2));
}

async function readLocalSettings() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  try {
    return JSON.parse(await fs.readFile(path.join(DATA_DIR, "settings.json"), "utf8"));
  } catch {
    return {};
  }
}

async function writeLocalSettings(value) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(path.join(DATA_DIR, "settings.json"), JSON.stringify(value, null, 2));
}

async function supabaseRequest(table, { method = "GET", query = "", body, prefer } = {}) {
  const url = `${SUPABASE_URL}/rest/v1/${table}${query}`;
  const response = await fetch(url, {
    method,
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      "content-type": "application/json",
      ...(prefer ? { prefer } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Supabase ${method} ${table} failed: ${detail}`);
  }

  if (response.status === 204) return null;
  return response.json();
}

async function listBrokers() {
  if (!USE_SUPABASE) return readJson("brokers.json");
  return supabaseRequest("brokers", { query: "?select=*&order=name.asc" });
}

async function createBroker(payload) {
  if (!USE_SUPABASE) {
    const brokers = await readJson("brokers.json");
    brokers.push(payload);
    await writeJson("brokers.json", brokers);
    return payload;
  }
  const [created] = await supabaseRequest("brokers", {
    method: "POST",
    body: payload,
    prefer: "return=representation"
  });
  return created;
}

async function updateBroker(id, patch) {
  if (!USE_SUPABASE) {
    const brokers = await readJson("brokers.json");
    const index = brokers.findIndex((broker) => broker.id === id);
    if (index === -1) return null;
    brokers[index] = { ...brokers[index], ...patch, id };
    await writeJson("brokers.json", brokers);
    return brokers[index];
  }
  const [updated] = await supabaseRequest("brokers", {
    method: "PATCH",
    query: `?id=eq.${encodeURIComponent(id)}`,
    body: patch,
    prefer: "return=representation"
  });
  return updated || null;
}

async function reassignBookings(fromBrokerId, toBrokerId) {
  if (!USE_SUPABASE) {
    const bookings = await readJson("bookings.json");
    const next = bookings.map((booking) => (
      booking.brokerId === fromBrokerId ? { ...booking, brokerId: toBrokerId } : booking
    ));
    await writeJson("bookings.json", next);
    return next.filter((booking) => booking.brokerId === toBrokerId).length;
  }

  const updated = await supabaseRequest("bookings", {
    method: "PATCH",
    query: `?brokerId=eq.${encodeURIComponent(fromBrokerId)}`,
    body: { brokerId: toBrokerId },
    prefer: "return=representation"
  });
  return updated.length;
}

async function deleteBroker(id, reassignTo) {
  const bookings = await listBookings();
  const bookingCount = bookings.filter((booking) => booking.brokerId === id).length;
  if (bookingCount > 0) {
    if (!reassignTo) {
      return { ok: false, bookingCount, needsReassign: true };
    }
    await reassignBookings(id, reassignTo);
  }

  if (!USE_SUPABASE) {
    const brokers = await readJson("brokers.json");
    await writeJson("brokers.json", brokers.filter((broker) => broker.id !== id));
    return { ok: true, bookingCount: 0 };
  }

  await supabaseRequest("brokers", {
    method: "DELETE",
    query: `?id=eq.${encodeURIComponent(id)}`,
    prefer: "return=minimal"
  });
  return { ok: true, bookingCount: 0 };
}

async function listBookings() {
  if (!USE_SUPABASE) return readJson("bookings.json");
  return supabaseRequest("bookings", { query: "?select=*&order=start.asc" });
}

async function readAppSetting(key, fallback) {
  if (!USE_SUPABASE) {
    const settings = await readLocalSettings();
    return settings[key] || fallback;
  }

  try {
    const rows = await supabaseRequest("app_settings", {
      query: `?key=eq.${encodeURIComponent(key)}&select=value`
    });
    return rows?.[0]?.value || fallback;
  } catch (error) {
    console.warn(`App setting read fallback: ${error.message}`);
    const settings = await readLocalSettings();
    return settings[key] || fallback;
  }
}

async function writeAppSetting(key, value) {
  if (!USE_SUPABASE) {
    const settings = await readLocalSettings();
    settings[key] = value;
    await writeLocalSettings(settings);
    return { value, storage: "local" };
  }

  try {
    const [saved] = await supabaseRequest("app_settings", {
      method: "POST",
      query: "?on_conflict=key",
      body: { key, value },
      prefer: "resolution=merge-duplicates,return=representation"
    });
    return { value: saved?.value || value, storage: "supabase" };
  } catch (error) {
    console.warn(`App setting write fallback: ${error.message}`);
    const settings = await readLocalSettings();
    settings[key] = value;
    await writeLocalSettings(settings);
    return { value, storage: "temporary", warning: "Supabase app_settings table is missing. Run the SQL migration so templates persist across redeploys." };
  }
}

async function getEmailTemplates() {
  const saved = await readAppSetting(EMAIL_TEMPLATES_SETTING_KEY, {});
  return cleanEmailTemplates({ ...defaultEmailTemplates, ...saved });
}

async function saveEmailTemplates(patch) {
  const current = await getEmailTemplates();
  const source = patch.reset ? defaultEmailTemplates : patch;
  const next = cleanEmailTemplates({
    confirmationSubject: String(source.confirmationSubject ?? current.confirmationSubject).trim() || defaultEmailTemplates.confirmationSubject,
    confirmationBody: String(source.confirmationBody ?? current.confirmationBody).trim() || defaultEmailTemplates.confirmationBody,
    reminderSubject: String(source.reminderSubject ?? current.reminderSubject).trim() || defaultEmailTemplates.reminderSubject,
    reminderBody: String(source.reminderBody ?? current.reminderBody).trim() || defaultEmailTemplates.reminderBody
  });
  const result = await writeAppSetting(EMAIL_TEMPLATES_SETTING_KEY, next);
  return { templates: result.value, storage: result.storage, warning: result.warning };
}

async function readBackupLocalJson(name, fallback) {
  try {
    return await readJson(name);
  } catch {
    return fallback;
  }
}

async function readInfinityAolBackup() {
  if (!USE_SUPABASE) return null;
  try {
    return await supabaseRequest("app_kv", {
      query: "?key=like.infinity_aol_%25&select=key,value,updated_at&order=key.asc"
    });
  } catch (error) {
    console.warn(`Infinity AOL backup read fallback: ${error.message}`);
    return null;
  }
}

async function buildSystemBackup() {
  const [brokers, bookings, settings, infinityAolStore] = await Promise.all([
    listBrokers(),
    listBookings(),
    readBackupLocalJson("settings.json", {}),
    readInfinityAolBackup()
  ]);

  return {
    exportedAt: new Date().toISOString(),
    service: "BrokerDesk CRM",
    storage: USE_SUPABASE ? "supabase" : "local-json",
    brokers,
    bookings,
    settings,
    infinityAolStore
  };
}

function sortBrokers(brokers) {
  return [...brokers].sort((a, b) => {
    if (a.id === "ryan-vu") return -1;
    if (b.id === "ryan-vu") return 1;
    return a.name.localeCompare(b.name);
  });
}

function normalizeEmail(value = "") {
  return String(value).trim().toLowerCase();
}

function isAdminEmail(email) {
  return ADMIN_EMAILS.includes(normalizeEmail(email));
}

function publicBroker(broker) {
  const { accessCode, ...safeBroker } = broker;
  return safeBroker;
}

function normalizedLoginKey(value = "") {
  return String(value || "").trim().toLowerCase();
}

function brokerLoginAliases(broker) {
  const aliases = new Set();
  const push = (value) => {
    const normalized = normalizedLoginKey(value);
    if (normalized) aliases.add(normalized);
  };

  push(broker?.email);
  push(broker?.username);
  push(broker?.id);
  push(broker?.name);

  const email = normalizedLoginKey(broker?.email);
  if (email.includes("@")) push(email.split("@")[0]);

  const brokerId = normalizedLoginKey(broker?.id);
  if (brokerId.includes("-")) {
    brokerId.split("-").forEach(push);
  }

  const brokerName = normalizedLoginKey(broker?.name);
  if (brokerName) {
    push(brokerName.replace(/\s+/g, ""));
    brokerName.split(/\s+/).forEach(push);
  }

  return aliases;
}

function brokerMatchesLogin(broker, identifier, password) {
  if (!broker?.accessCode) return false;
  const normalizedIdentifier = normalizedLoginKey(identifier);
  if (!normalizedIdentifier) return false;
  if (!brokerLoginAliases(broker).has(normalizedIdentifier)) return false;
  return safeEqual(String(broker.accessCode), String(password || ""));
}

function passwordHash(value = "") {
  return createHash("sha256").update(String(value || "")).digest("hex");
}

async function readAdminAuth() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  try {
    return JSON.parse(await fs.readFile(path.join(DATA_DIR, "admin-auth.json"), "utf8"));
  } catch {
    return {};
  }
}

async function writeAdminAuth(value) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(path.join(DATA_DIR, "admin-auth.json"), JSON.stringify(value, null, 2));
}

async function matchAdminPassword(password, { allowTemporary = true } = {}) {
  const enteredHash = passwordHash(password);
  const auth = await readAdminAuth();
  const storedHash = auth.passwordHash || (ADMIN_PASSWORD ? passwordHash(ADMIN_PASSWORD) : "");
  if (storedHash && safeEqual(enteredHash, storedHash)) {
    return { ok: true, temporary: false };
  }
  if (
    allowTemporary
    && auth.tempPasswordHash
    && Number(auth.tempExpiresAt || 0) > Date.now()
    && safeEqual(enteredHash, auth.tempPasswordHash)
  ) {
    return { ok: true, temporary: true };
  }
  return { ok: false, temporary: false };
}

async function setAdminPassword(newPassword) {
  const auth = await readAdminAuth();
  await writeAdminAuth({
    ...auth,
    passwordHash: passwordHash(newPassword),
    passwordUpdatedAt: new Date().toISOString(),
    tempPasswordHash: null,
    tempExpiresAt: null,
    tempIssuedAt: null
  });
}

function sessionForRequest(req) {
  if (!ADMIN_PASSWORD) return { role: "admin", email: ADMIN_EMAIL };
  return normalizeSession(adminSession(req));
}

function isAdminSession(session) {
  return !ADMIN_PASSWORD || session?.role === "admin";
}

function normalizeSession(session) {
  if (!session) return null;
  if (isAdminEmail(session.email)) {
    return { ...session, role: "admin", brokerId: null, name: session.name || "Ryan Vu" };
  }
  return session;
}

async function createBooking(payload) {
  const cleanPayload = bookingStoragePayload(payload);
  if (!USE_SUPABASE) {
    const bookings = await readJson("bookings.json");
    bookings.push(cleanPayload);
    await writeJson("bookings.json", bookings);
    return cleanPayload;
  }
  const [created] = await supabaseRequest("bookings", {
    method: "POST",
    body: cleanPayload,
    prefer: "return=representation"
  });
  return created;
}

async function updateBooking(id, patch) {
  const cleanPatch = bookingStoragePayload(patch, { partial: true });
  if (!USE_SUPABASE) {
    const bookings = await readJson("bookings.json");
    const index = bookings.findIndex((booking) => booking.id === id);
    if (index === -1) return null;
    bookings[index] = { ...bookings[index], ...cleanPatch, id };
    await writeJson("bookings.json", bookings);
    return bookings[index];
  }
  const [updated] = await supabaseRequest("bookings", {
    method: "PATCH",
    query: `?id=eq.${encodeURIComponent(id)}`,
    body: cleanPatch,
    prefer: "return=representation"
  });
  return updated || null;
}

function bookingStoragePayload(input, { partial = false } = {}) {
  const allowed = ["id", "clientName", "phone", "email", "brokerId", "service", "channel", "status", "start", "end", "googleEventId", "notes"];
  const clean = {};
  for (const key of allowed) {
    if (Object.prototype.hasOwnProperty.call(input, key) && (partial || input[key] !== undefined)) {
      clean[key] = input[key];
    }
  }
  return clean;
}

async function deleteBooking(id) {
  if (!USE_SUPABASE) {
    const bookings = await readJson("bookings.json");
    await writeJson("bookings.json", bookings.filter((booking) => booking.id !== id));
    return;
  }
  await supabaseRequest("bookings", {
    method: "DELETE",
    query: `?id=eq.${encodeURIComponent(id)}`,
    prefer: "return=minimal"
  });
}

function sendJson(res, status, payload) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  res.end(JSON.stringify(payload));
}

function parseCookies(req) {
  return Object.fromEntries((req.headers.cookie || "").split(";").filter(Boolean).map((cookie) => {
    const [key, ...rest] = cookie.trim().split("=");
    return [key, decodeURIComponent(rest.join("="))];
  }));
}

function safeEqual(a = "", b = "") {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

function signSession(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = createHmac("sha256", ADMIN_SESSION_SECRET).update(body).digest("base64url");
  return `${body}.${signature}`;
}

function verifySession(token = "") {
  const [body, signature] = token.split(".");
  if (!body || !signature) return null;
  const expected = createHmac("sha256", ADMIN_SESSION_SECRET).update(body).digest("base64url");
  if (!safeEqual(signature, expected)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (!payload.exp || payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

function sessionCookieDomain(req) {
  const configured = process.env.COOKIE_DOMAIN || process.env.SESSION_COOKIE_DOMAIN;
  if (configured) return configured.startsWith(".") ? configured : `.${configured}`;
  return "";
}

function sessionCookieName(req) {
  const hostname = String(req?.headers?.host || "").split(":")[0].toLowerCase();
  if (PORTAL_HOST_RE.test(hostname)) return "elf_portal_session";
  if (CLIENT_CALL_HOST_RE.test(hostname)) return "elf_client_call_session";
  if (LOAN_SUBMISSIONS_HOST_RE.test(hostname)) return "elf_loan_submissions_session";
  if (EASYFLOW_AI_HOST_RE.test(hostname)) return "elf_easyflow_session";
  if (LOAN_FORM_HOST_RE.test(hostname)) return "elf_loan_form_session";
  if (BOOKING_HOST_RE.test(hostname)) return "elf_booking_session";
  return "elf_app_session";
}

function setSessionCookie(req, res, token) {
  const domain = sessionCookieDomain(req);
  const name = sessionCookieName(req);
  res.setHeader("set-cookie", [
    `${name}=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_MAX_AGE_SECONDS}${domain ? `; Domain=${domain}` : ""}`,
  ]);
}

function clearSessionCookie(req, res) {
  const domain = sessionCookieDomain(req);
  const name = sessionCookieName(req);
  res.setHeader("set-cookie", [
    `${name}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${domain ? `; Domain=${domain}` : ""}`,
    `elf_admin=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${domain ? `; Domain=${domain}` : ""}`
  ]);
}

function isPublicRequest(req, url) {
  if (url.pathname.startsWith("/book")) return true;
  if (url.pathname.startsWith("/calendar/")) return true;
  if (url.pathname === "/api/auth/login" || url.pathname === "/api/auth/status" || url.pathname === "/api/auth/logout" || url.pathname === "/api/auth/request-password-reset") return true;
  if (url.pathname === "/api/availability" && req.method === "GET") return true;
  if (url.pathname === "/api/bookings" && req.method === "POST") return true;
  if (url.pathname === "/api/brokers" && req.method === "GET") return true;
  return false;
}

function adminSession(req) {
  return verifySession(parseCookies(req)[sessionCookieName(req)]);
}

function requireAdmin(req, res, url) {
  if (!ADMIN_PASSWORD) return true;
  if (isPublicRequest(req, url)) return true;
  if (adminSession(req)) return true;
  sendJson(res, 401, { error: "Admin login required" });
  return false;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) {
        reject(new Error("Request body too large"));
        req.destroy();
      }
    });
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new Error("Invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}

function escapeIcs(value = "") {
  return String(value)
    .replace(/\\/g, "\\\\")
    .replace(/\n/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");
}

function icsDate(value) {
  return new Date(value).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function calendarText(bookings, brokers, req) {
  const origin = requestOrigin(req);
  const brokerById = Object.fromEntries(brokers.map((broker) => [broker.id, broker]));
  const rows = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Easy Loan Finance//Broker Booking//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "X-WR-CALNAME:Easy Loan Finance Bookings",
    "X-WR-TIMEZONE:Australia/Adelaide"
  ];

  for (const booking of bookings) {
    const broker = brokerById[booking.brokerId];
    rows.push(
      "BEGIN:VEVENT",
      `UID:${booking.id}@easyloanfinance.booking`,
      `DTSTAMP:${icsDate(new Date())}`,
      `DTSTART:${icsDate(booking.start)}`,
      `DTEND:${icsDate(booking.end)}`,
      `SUMMARY:${escapeIcs(`${booking.clientName} - ${booking.service}`)}`,
      `DESCRIPTION:${escapeIcs(bookingDescription(booking, broker, origin))}`,
      `LOCATION:${escapeIcs(booking.channel === "Office" ? "Easy Loan Finance office" : booking.channel)}`,
      "END:VEVENT"
    );
  }

  rows.push("END:VCALENDAR");
  return rows.join("\r\n");
}

function bookingDescription(booking, broker, origin = "") {
  return [
    `Booking ID: ${booking.id}`,
    `Broker: ${broker?.name || "Easy Loan Finance"}`,
    `Status: ${booking.status}`,
    `Channel: ${booking.channel}`,
    `Phone: ${booking.phone || ""}`,
    `Email: ${booking.email || ""}`,
    booking.notes ? `Notes: ${booking.notes}` : "",
    origin ? `Manage: ${origin}` : ""
  ].filter(Boolean).join("\n");
}

function googleEventBody(booking, broker, origin = "") {
  return {
    summary: `${booking.clientName} - ${booking.service}`,
    description: bookingDescription(booking, broker, origin),
    location: booking.channel === "Office" ? "Easy Loan Finance office" : booking.channel,
    start: {
      dateTime: new Date(booking.start).toISOString(),
      timeZone: TIME_ZONE
    },
    end: {
      dateTime: new Date(booking.end).toISOString(),
      timeZone: TIME_ZONE
    },
    extendedProperties: {
      private: {
        easyLoanBookingId: booking.id
      }
    }
  };
}

function minutesFromTime(time = "00:00") {
  const [hours, minutes] = String(time).split(":").map((value) => Number(value));
  return hours * 60 + minutes;
}

function timeFromMinutes(totalMinutes) {
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function slotLabel(time) {
  const [hours, minutes] = time.split(":").map(Number);
  const suffix = hours >= 12 ? "PM" : "AM";
  const displayHour = hours % 12 || 12;
  return `${displayHour}:${String(minutes).padStart(2, "0")} ${suffix}`;
}

function bookingLocalDateTime(value) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).formatToParts(new Date(value));
  const get = (type) => parts.find((part) => part.type === type)?.value;
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    minutes: Number(get("hour")) * 60 + Number(get("minute"))
  };
}

function isBusinessDay(date) {
  const day = new Date(`${date}T12:00:00`).getDay();
  return day >= 1 && day <= 5;
}

function overlaps(startA, endA, startB, endB) {
  return startA < endB && endA > startB;
}

function hasBookingConflict(candidate, bookings) {
  const start = new Date(candidate.start).getTime();
  const end = new Date(candidate.end).getTime();
  return bookings.some((booking) => {
    if (booking.brokerId !== candidate.brokerId || booking.status === "Cancelled") return false;
    return overlaps(start, end, new Date(booking.start).getTime(), new Date(booking.end).getTime());
  });
}

function validatePublicBookingWindow(candidate) {
  const localStart = bookingLocalDateTime(candidate.start);
  const localEnd = bookingLocalDateTime(candidate.end);
  if (!isBusinessDay(localStart.date) || localStart.date !== localEnd.date) {
    return "Bookings are available Monday to Friday only.";
  }
  const nowLocal = bookingLocalDateTime(new Date());
  if (localStart.date === nowLocal.date && localStart.minutes <= nowLocal.minutes) {
    return "Please choose a future time.";
  }
  const startMinutes = minutesFromTime(BUSINESS_START);
  const endMinutes = minutesFromTime(BUSINESS_END);
  if (localStart.minutes < startMinutes || localEnd.minutes > endMinutes) {
    return "Please choose a time between 9:30 AM and 5:00 PM.";
  }
  if (localEnd.minutes - localStart.minutes !== PUBLIC_BOOKING_DURATION) {
    return "Bookings are fixed at 30 minutes.";
  }
  if ((localStart.minutes - startMinutes) % 30 !== 0) {
    return "Please choose one of the available 30-minute slots.";
  }
  return "";
}

function availabilityFor({ brokerId, date, duration }, brokers, bookings) {
  const broker = brokers.find((item) => item.id === brokerId) || brokers[0];
  const startMinutes = minutesFromTime(BUSINESS_START);
  const endMinutes = minutesFromTime(BUSINESS_END);
  const slotDuration = PUBLIC_BOOKING_DURATION;
  if (!isBusinessDay(date)) {
    return {
      brokerId: broker?.id || brokerId,
      date,
      duration: slotDuration,
      slots: []
    };
  }
  const brokerBookings = bookings
    .filter((booking) => booking.brokerId === broker?.id && booking.status !== "Cancelled")
    .map((booking) => {
      const start = bookingLocalDateTime(booking.start);
      const end = bookingLocalDateTime(booking.end);
      return { date: start.date, start: start.minutes, end: end.minutes };
    })
    .filter((booking) => booking.date === date);
  const nowLocal = bookingLocalDateTime(new Date());

  const slots = [];
  for (let minute = startMinutes; minute + slotDuration <= endMinutes; minute += 30) {
    const end = minute + slotDuration;
    const booked = brokerBookings.some((booking) => overlaps(minute, end, booking.start, booking.end));
    const past = date === nowLocal.date && minute <= nowLocal.minutes;
    const time = timeFromMinutes(minute);
    slots.push({
      time,
      label: slotLabel(time),
      available: !booked && !past
    });
  }

  return {
    brokerId: broker?.id || brokerId,
    date,
    duration: slotDuration,
    slots
  };
}

function base64Url(input) {
  return Buffer.from(input).toString("base64url");
}

function googleCredentials() {
  if (process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
    const parsed = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
    return {
      clientEmail: parsed.client_email,
      privateKey: parsed.private_key
    };
  }

  return {
    clientEmail: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    privateKey: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, "\n")
  };
}

async function googleAccessToken() {
  const { clientEmail, privateKey } = googleCredentials();
  if (!GOOGLE_CALENDAR_ID || !clientEmail || !privateKey) return null;

  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const claim = {
    iss: clientEmail,
    scope: "https://www.googleapis.com/auth/calendar.events",
    aud: "https://oauth2.googleapis.com/token",
    exp: now + 3600,
    iat: now
  };
  const unsigned = `${base64Url(JSON.stringify(header))}.${base64Url(JSON.stringify(claim))}`;
  const signature = createSign("RSA-SHA256").update(unsigned).sign(privateKey, "base64url");
  const assertion = `${unsigned}.${signature}`;

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion
    })
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Google token failed: ${detail}`);
  }

  const token = await response.json();
  return token.access_token;
}

function calendarIdForBroker(broker) {
  if (broker?.id && BROKER_GOOGLE_CALENDAR_IDS[broker.id]) return BROKER_GOOGLE_CALENDAR_IDS[broker.id];
  if (broker?.googleCalendarId) return broker.googleCalendarId;
  if (broker?.id === "ryan-vu") return GOOGLE_APPS_SCRIPT_CALENDAR_ID || "";
  return "";
}

function appsScriptCalendarConfigured(broker) {
  return Boolean(process.env.GOOGLE_APPS_SCRIPT_EMAIL_URL && process.env.GOOGLE_APPS_SCRIPT_EMAIL_TOKEN && calendarIdForBroker(broker));
}

async function syncAppsScriptCalendarEvent(booking, broker, origin = "") {
  const calendarId = calendarIdForBroker(broker);
  if (!appsScriptCalendarConfigured(broker)) return null;
  const response = await fetch(process.env.GOOGLE_APPS_SCRIPT_EMAIL_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      token: process.env.GOOGLE_APPS_SCRIPT_EMAIL_TOKEN,
      type: "calendar",
      calendarId,
      eventId: booking.googleEventId || "",
      event: googleEventBody(booking, broker, origin)
    })
  });
  const raw = await response.text();
  let payload = {};
  try {
    payload = raw ? JSON.parse(raw) : {};
  } catch {
    payload = { error: raw };
  }
  if (!response.ok || payload.ok === false) {
    throw new Error(payload.error || `Google Apps Script calendar sync failed with HTTP ${response.status}`);
  }
  return { id: payload.eventId };
}

async function deleteAppsScriptCalendarEvent(booking, broker) {
  const calendarId = calendarIdForBroker(broker);
  if (!appsScriptCalendarConfigured(broker) || !booking) return false;
  const response = await fetch(process.env.GOOGLE_APPS_SCRIPT_EMAIL_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      token: process.env.GOOGLE_APPS_SCRIPT_EMAIL_TOKEN,
      type: "calendar_delete",
      calendarId,
      eventId: booking.googleEventId || "",
      event: googleEventBody(booking, broker, "")
    })
  });
  const raw = await response.text();
  let payload = {};
  try {
    payload = raw ? JSON.parse(raw) : {};
  } catch {
    payload = { error: raw };
  }
  if (!response.ok || payload.ok === false) {
    throw new Error(payload.error || `Google Apps Script calendar delete failed with HTTP ${response.status}`);
  }
  return true;
}

async function syncGoogleEvent(booking, broker, origin = "") {
  if (appsScriptCalendarConfigured(broker)) {
    return syncAppsScriptCalendarEvent(booking, broker, origin);
  }

  const accessToken = await googleAccessToken();
  if (!accessToken) return null;

  const url = booking.googleEventId
    ? `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(GOOGLE_CALENDAR_ID)}/events/${encodeURIComponent(booking.googleEventId)}`
    : `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(GOOGLE_CALENDAR_ID)}/events`;

  const response = await fetch(url, {
    method: booking.googleEventId ? "PATCH" : "POST",
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json"
    },
    body: JSON.stringify(googleEventBody(booking, broker, origin))
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Google Calendar sync failed: ${detail}`);
  }

  return response.json();
}

async function deleteGoogleEvent(booking, broker) {
  if (appsScriptCalendarConfigured(broker)) {
    return deleteAppsScriptCalendarEvent(booking, broker);
  }
  if (!booking?.googleEventId) return false;

  const accessToken = await googleAccessToken();
  if (!accessToken || !GOOGLE_CALENDAR_ID) return false;

  const response = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(GOOGLE_CALENDAR_ID)}/events/${encodeURIComponent(booking.googleEventId)}`,
    {
      method: "DELETE",
      headers: { authorization: `Bearer ${accessToken}` }
    }
  );

  if (response.status === 404 || response.status === 410) return true;
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Google Calendar delete failed: ${detail}`);
  }
  return true;
}

function smtpConfigured() {
  return Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
}

function appsScriptEmailConfigured() {
  return Boolean(process.env.GOOGLE_APPS_SCRIPT_EMAIL_URL && process.env.GOOGLE_APPS_SCRIPT_EMAIL_TOKEN);
}

function emailDeliveryReady() {
  return appsScriptEmailConfigured() || smtpConfigured();
}

async function sendAdminPasswordResetEmail(email, tempPassword, origin) {
  if (!emailDeliveryReady()) {
    throw new Error("Email delivery is not configured. Set GOOGLE_APPS_SCRIPT_EMAIL_URL/TOKEN or SMTP settings first.");
  }
  const loginUrl = `${origin || "https://booking.easyloanfinance.com.au"}/login`;
  await sendEmail({
    to: email,
    from: senderFrom(),
    subject: "Easy Loan Finance admin temporary password",
    text: [
      "Hi Ryan,",
      "",
      "A temporary admin password was requested for Easy Loan Finance.",
      "",
      `Temporary password: ${tempPassword}`,
      `Login: ${loginUrl}`,
      "",
      `This temporary password expires in ${Math.round(PASSWORD_RESET_TTL_SECONDS / 60)} minutes.`,
      "After logging in, open Security and set a new password.",
      "",
      "If you did not request this, ignore this email."
    ].join("\n"),
    html: [
      "<p>Hi Ryan,</p>",
      "<p>A temporary admin password was requested for Easy Loan Finance.</p>",
      `<p><strong>Temporary password:</strong> <code>${escapeHtml(tempPassword)}</code></p>`,
      `<p><a href="${escapeHtml(loginUrl)}">Open Easy Loan Finance login</a></p>`,
      `<p>This temporary password expires in ${Math.round(PASSWORD_RESET_TTL_SECONDS / 60)} minutes. After logging in, open Security and set a new password.</p>`,
      "<p>If you did not request this, ignore this email.</p>"
    ].join("")
  });
}

async function sendBrokerAccessResetEmail(adminEmail, broker, tempAccessCode, origin) {
  if (!emailDeliveryReady()) {
    throw new Error("Email delivery is not configured. Set GOOGLE_APPS_SCRIPT_EMAIL_URL/TOKEN or SMTP settings first.");
  }
  const loginUrl = `${origin || "https://client-call.easyloanfinance.com.au"}/login`;
  await sendEmail({
    to: adminEmail,
    from: senderFrom(),
    subject: `Easy Loan Finance user access reset - ${broker.name}`,
    text: [
      "Hi Ryan,",
      "",
      "A temporary access code was generated for an Easy Loan Finance internal user.",
      "",
      `User: ${broker.name}`,
      `Email: ${broker.email}`,
      `Temporary access code: ${tempAccessCode}`,
      `Login: ${loginUrl}`,
      "",
      "Share this code only with the intended team member, then ask them to change it after login."
    ].join("\n"),
    html: [
      "<p>Hi Ryan,</p>",
      "<p>A temporary access code was generated for an Easy Loan Finance internal user.</p>",
      `<p><strong>User:</strong> ${escapeHtml(broker.name)}<br><strong>Email:</strong> ${escapeHtml(broker.email)}<br><strong>Temporary access code:</strong> <code>${escapeHtml(tempAccessCode)}</code></p>`,
      `<p><a href="${escapeHtml(loginUrl)}">Open internal login</a></p>`,
      "<p>Share this code only with the intended team member, then ask them to change it after login.</p>"
    ].join("")
  });
}

function internalNotificationRecipients(broker) {
  return Array.from(new Set([
    NOTIFY_EMAIL,
    broker?.email
  ].map(normalizeEmail).filter(Boolean)));
}

function mailTransporter(overrides = {}) {
  if (!smtpConfigured()) return null;
  const dnsFamily = Number(process.env.SMTP_DNS_FAMILY || 4);

  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === "true",
    connectionTimeout: Number(process.env.SMTP_CONNECTION_TIMEOUT_MS || 8000),
    greetingTimeout: Number(process.env.SMTP_GREETING_TIMEOUT_MS || 8000),
    socketTimeout: Number(process.env.SMTP_SOCKET_TIMEOUT_MS || 12000),
    family: dnsFamily,
    lookup: (hostname, options, callback) => dns.lookup(hostname, { ...options, family: dnsFamily }, callback),
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS
    },
    ...overrides
  });
}

function gmailFallbackTransporter() {
  const host = String(process.env.SMTP_HOST || "").toLowerCase();
  const port = Number(process.env.SMTP_PORT || 587);
  if (!host.includes("smtp.gmail.com") || port === 465 || process.env.SMTP_DISABLE_GMAIL_465_FALLBACK === "true") {
    return null;
  }
  return mailTransporter({ port: 465, secure: true });
}

async function sendSmtpMail(mailOptions) {
  const transporter = mailTransporter();
  if (!transporter) return false;
  try {
    await transporter.sendMail(mailOptions);
    return true;
  } catch (error) {
    const fallback = gmailFallbackTransporter();
    if (!fallback) throw error;
    try {
      await fallback.sendMail(mailOptions);
      return true;
    } catch (fallbackError) {
      fallbackError.message = `${error.message}; Gmail 465 fallback failed: ${fallbackError.message}`;
      throw fallbackError;
    }
  }
}

function parseEmailAddress(value = "") {
  const match = String(value).match(/<([^>]+)>/);
  return normalizeEmail(match?.[1] || value);
}

function parseEmailName(value = "") {
  const match = String(value).match(/^([^<]+)</);
  return match?.[1]?.replace(/"/g, "").trim() || "Easy Loan Finance";
}

async function sendAppsScriptMail(mailOptions) {
  if (!appsScriptEmailConfigured()) return false;
  const response = await fetch(process.env.GOOGLE_APPS_SCRIPT_EMAIL_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      token: process.env.GOOGLE_APPS_SCRIPT_EMAIL_TOKEN,
      to: mailOptions.to,
      from: parseEmailAddress(mailOptions.from),
      name: parseEmailName(mailOptions.from),
      replyTo: mailOptions.replyTo,
      subject: cleanEmailContent(mailOptions.subject),
      text: cleanEmailContent(mailOptions.text || ""),
      html: cleanEmailContent(mailOptions.html || "")
    })
  });
  const raw = await response.text();
  let payload = {};
  try {
    payload = raw ? JSON.parse(raw) : {};
  } catch {
    payload = { error: raw };
  }
  if (!response.ok || payload.ok === false) {
    throw new Error(payload.error || `Google Apps Script email failed with HTTP ${response.status}`);
  }
  return true;
}

async function sendEmail(mailOptions) {
  const cleanOptions = {
    ...mailOptions,
    subject: cleanEmailContent(mailOptions.subject),
    text: cleanEmailContent(mailOptions.text || ""),
    html: cleanEmailContent(mailOptions.html || "")
  };
  if (appsScriptEmailConfigured()) {
    return sendAppsScriptMail(cleanOptions);
  }
  return sendSmtpMail(cleanOptions);
}

function senderFrom() {
  return process.env.SMTP_FROM || "Easy Loan Finance <hello@easyloanfinance.com.au>";
}

function clientSenderFrom() {
  return process.env.CLIENT_CONFIRMATION_FROM || senderFrom();
}

function shortTimeZoneLabel(label = "") {
  return String(label || "").replace(/\s*time$/i, "").trim() || label;
}

function formattedShortTime(value, timeZone) {
  return new Intl.DateTimeFormat("en-AU", {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
    hour12: true
  }).format(new Date(value)).replace(/\s?(am|pm)$/i, (match) => match.toUpperCase());
}

function formattedBookingTime(booking) {
  const date = new Intl.DateTimeFormat("en-AU", {
    timeZone: TIME_ZONE,
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric"
  }).format(new Date(booking.start));
  const adelaide = formattedShortTime(booking.start, TIME_ZONE);
  const eastCoast = formattedShortTime(booking.start, EAST_COAST_TIME_ZONE);
  return `${date}\n${adelaide} (${shortTimeZoneLabel(BOOKING_TIME_LABEL)}) | ${eastCoast} (${shortTimeZoneLabel(EAST_COAST_TIME_LABEL)})`;
}

function templateVariables(booking, broker) {
  return {
    clientName: booking.clientName || "there",
    brokerName: broker?.name || "Easy Loan Finance",
    brokerPhone: broker?.phone || "",
    service: booking.service || "Home loan consultation",
    time: formattedBookingTime(booking),
    channel: booking.channel || "Phone call",
    companyName: "Easy Loan Finance",
    slogan: "Quick Loan, Easy Life"
  };
}

function cleanEmailContent(value = "") {
  return String(value)
    .replace(/[\uFFFD]+/g, "")
    .replace(/\p{Extended_Pictographic}/gu, "")
    .replace(/[\uFE0E\uFE0F]/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim();
}

function cleanEmailTemplates(templates = {}) {
  return {
    confirmationSubject: cleanEmailContent(templates.confirmationSubject || defaultEmailTemplates.confirmationSubject),
    confirmationBody: cleanEmailContent(templates.confirmationBody || defaultEmailTemplates.confirmationBody),
    reminderSubject: cleanEmailContent(templates.reminderSubject || defaultEmailTemplates.reminderSubject),
    reminderBody: cleanEmailContent(templates.reminderBody || defaultEmailTemplates.reminderBody)
  };
}

function renderTemplate(template = "", variables = {}) {
  return cleanEmailContent(String(template).replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, key) => (
    variables[key] ?? ""
  )));
}

function emailLogoUrl(origin = "") {
  const base = origin || process.env.PUBLIC_APP_URL || process.env.RENDER_EXTERNAL_URL || "";
  return base ? `${base.replace(/\/$/, "")}/elf-logo.png` : "";
}

function brandedEmailHtml({ title, body, logoUrl }) {
  const paragraphs = cleanEmailContent(body || "")
    .split(/\n{2,}/)
    .map((block) => `<p style="margin:0 0 14px">${escapeHtml(block).replace(/\n/g, "<br/>")}</p>`)
    .join("");
  const logo = logoUrl ? `<img src="${escapeHtml(logoUrl)}" alt="Easy Loan Finance" width="72" height="72" style="display:block;width:72px;height:72px;border-radius:10px;margin:0 0 14px;background:#004c2f"/>` : "";
  return `
    <div style="margin:0;padding:0;background:#f6f3ec;font-family:Arial,sans-serif;color:#161411">
      <div style="max-width:640px;margin:0 auto;padding:28px 18px">
        <div style="background:#0f241d;color:#fff8ed;border-radius:10px 10px 0 0;padding:22px 24px">
          ${logo}
          <div style="font-size:13px;font-weight:700;color:#f5dfad;text-transform:uppercase">Easy Loan Finance</div>
          <h1 style="margin:8px 0 0;font-size:26px;line-height:1.15">${escapeHtml(cleanEmailContent(title))}</h1>
        </div>
        <div style="background:#fffdf8;border:1px solid #eadfca;border-top:0;border-radius:0 0 10px 10px;padding:24px;line-height:1.55">
          ${paragraphs}
        </div>
      </div>
    </div>
  `;
}

async function clientConfirmationEmailContent(booking, broker, origin = "") {
  const templates = await getEmailTemplates();
  const variables = templateVariables(booking, broker);
  const subject = renderTemplate(templates.confirmationSubject, variables);
  const text = renderTemplate(templates.confirmationBody, variables);
  const html = brandedEmailHtml({
    title: subject,
    body: text,
    logoUrl: emailLogoUrl(origin)
  });
  return { subject, text, html };
}

function legacyClientConfirmationEmailContent(booking, broker) {
  const when = formattedBookingTime(booking);
  const brokerName = broker?.name || "Easy Loan Finance";
  const phoneLine = broker?.phone ? `Broker phone: ${broker.phone}` : "";
  const text = [
    `Hi ${booking.clientName},`,
    "",
    "Your Easy Loan Finance appointment is confirmed.",
    "",
    `Broker: ${brokerName}`,
    `Service: ${booking.service}`,
    `Time: ${when}`,
    `Meeting style: ${booking.channel}`,
    phoneLine,
    "",
    "We will send a reminder 10 minutes before your appointment.",
    "",
    "If anything changes, please reply to this email.",
    "",
    "Easy Loan Finance",
    "Quick Loan, Easy Life"
  ].filter(Boolean).join("\n");

  const html = `
    <div style="margin:0;padding:0;background:#f6f3ec;font-family:Arial,sans-serif;color:#161411">
      <div style="max-width:640px;margin:0 auto;padding:28px 18px">
        <div style="background:#0f241d;color:#fff8ed;border-radius:10px 10px 0 0;padding:22px 24px">
          <div style="font-size:13px;font-weight:700;color:#f5dfad;text-transform:uppercase">Easy Loan Finance</div>
          <h1 style="margin:8px 0 0;font-size:26px;line-height:1.15">Your appointment is confirmed</h1>
        </div>
        <div style="background:#fffdf8;border:1px solid #eadfca;border-top:0;border-radius:0 0 10px 10px;padding:24px">
          <p style="margin:0 0 16px">Hi ${escapeHtml(booking.clientName)},</p>
          <p style="margin:0 0 18px">Thanks for booking with Easy Loan Finance. Your consultation has been confirmed.</p>
          <div style="background:#f7f1e5;border:1px solid #eadfca;border-radius:8px;padding:16px;margin:0 0 18px">
            <p style="margin:0 0 8px"><strong>Broker:</strong> ${escapeHtml(brokerName)}</p>
            <p style="margin:0 0 8px"><strong>Service:</strong> ${escapeHtml(booking.service)}</p>
            <p style="margin:0 0 8px"><strong>Time:</strong> ${escapeHtmlWithBreaks(when)}</p>
            <p style="margin:0"><strong>Meeting style:</strong> ${escapeHtml(booking.channel)}</p>
          </div>
          <p style="margin:0 0 14px">We will send a reminder 10 minutes before your appointment.</p>
          <p style="margin:0 0 18px">If anything changes, please reply to this email.</p>
          <p style="margin:0;color:#6f675a">Easy Loan Finance<br/>Quick Loan, Easy Life</p>
        </div>
      </div>
    </div>
  `;

  return { text, html };
}

async function sendBookingEmail(booking, broker, origin = "") {
  const recipients = internalNotificationRecipients(broker);
  if (recipients.length === 0) return false;
  const when = formattedBookingTime(booking);

  return sendEmail({
    from: senderFrom(),
    to: recipients.join(", "),
    replyTo: booking.email || undefined,
    subject: `New confirmed booking: ${booking.clientName} (${booking.service})`,
    text: [
      "New Easy Loan Finance confirmed booking",
      "",
      `Client: ${booking.clientName}`,
      `Phone: ${booking.phone || "Not provided"}`,
      `Email: ${booking.email || "Not provided"}`,
      `Broker: ${broker?.name || booking.brokerId}`,
      `Service: ${booking.service}`,
      `Time: ${when}`,
      `Channel: ${booking.channel}`,
      `Status: ${booking.status}`,
      "",
      booking.notes ? `Notes: ${booking.notes}` : "",
      origin ? `Dashboard: ${origin}` : ""
    ].filter(Boolean).join("\n"),
    html: `
      <div style="font-family:Arial,sans-serif;color:#161411;line-height:1.5">
        <h2 style="margin:0 0 12px">New Easy Loan Finance confirmed booking</h2>
        <p><strong>Client:</strong> ${escapeHtml(booking.clientName)}</p>
        <p><strong>Phone:</strong> ${escapeHtml(booking.phone || "Not provided")}</p>
        <p><strong>Email:</strong> ${escapeHtml(booking.email || "Not provided")}</p>
        <p><strong>Broker:</strong> ${escapeHtml(broker?.name || booking.brokerId)}</p>
        <p><strong>Service:</strong> ${escapeHtml(booking.service)}</p>
        <p><strong>Time:</strong> ${escapeHtmlWithBreaks(when)}</p>
        <p><strong>Channel:</strong> ${escapeHtml(booking.channel)}</p>
        <p><strong>Status:</strong> ${escapeHtml(booking.status)}</p>
        ${booking.notes ? `<p><strong>Notes:</strong> ${escapeHtml(booking.notes)}</p>` : ""}
        ${origin ? `<p><a href="${escapeHtml(origin)}">Open booking dashboard</a></p>` : ""}
      </div>
    `
  });
}

async function sendClientConfirmationEmail(booking, broker, origin = "") {
  if (!CLIENT_CONFIRMATION_EMAILS || !booking.email) return false;

  const from = clientSenderFrom();
  const replyTo = process.env.CLIENT_REPLY_TO || NOTIFY_EMAIL || process.env.SMTP_USER;
  const content = await clientConfirmationEmailContent(booking, broker, origin);

  return sendEmail({
    from,
    to: booking.email,
    replyTo,
    subject: content.subject,
    text: content.text,
    html: content.html
  });
}

async function sendBookingReminderEmails(booking, broker, origin = "") {
  if (!emailDeliveryReady()) return { client: false, internal: false };

  const when = formattedBookingTime(booking);
  const templates = await getEmailTemplates();
  const variables = templateVariables(booking, broker);
  const reminderSubject = renderTemplate(templates.reminderSubject, variables);
  const reminderBody = renderTemplate(templates.reminderBody, variables);
  const from = clientSenderFrom();
  const replyTo = process.env.CLIENT_REPLY_TO || NOTIFY_EMAIL || process.env.SMTP_USER;
  const results = { client: false, internal: false };

  if (booking.email) {
    results.client = await sendEmail({
      from,
      to: booking.email,
      replyTo,
      subject: reminderSubject,
      text: reminderBody,
      html: brandedEmailHtml({
        title: reminderSubject,
        body: reminderBody,
        logoUrl: emailLogoUrl(origin)
      })
    });
  }

  const internalRecipients = internalNotificationRecipients(broker);
  if (internalRecipients.length > 0) {
    results.internal = await sendEmail({
      from: senderFrom(),
      to: internalRecipients.join(", "),
      replyTo: booking.email || undefined,
      subject: `Reminder: ${booking.clientName} appointment in 10 minutes`,
      text: [
        "Easy Loan Finance booking reminder",
        "",
        `Client: ${booking.clientName}`,
        `Phone: ${booking.phone || "Not provided"}`,
        `Email: ${booking.email || "Not provided"}`,
        `Broker: ${broker?.name || booking.brokerId}`,
        `Service: ${booking.service}`,
        `Time: ${when}`,
        `Channel: ${booking.channel}`,
        origin ? `Dashboard: ${origin}` : ""
      ].filter(Boolean).join("\n")
    });
  }

  return results;
}

function escapeHtml(value = "") {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeHtmlWithBreaks(value = "") {
  return escapeHtml(value).replace(/\n/g, "<br/>");
}

async function afterBookingSaved(booking, brokers, req, { sendEmail = true, syncCalendar = true } = {}) {
  const broker = brokers.find((item) => item.id === booking.brokerId);
  const origin = requestOrigin(req);

  const results = {
    emailSent: false,
    clientConfirmationSent: false,
    emailError: "",
    clientConfirmationError: "",
    googleSynced: false,
    googleEventId: booking.googleEventId || null,
    googleError: ""
  };

  if (sendEmail) {
    const [internalResult, clientResult] = await Promise.allSettled([
      sendBookingEmail(booking, broker, origin),
      sendClientConfirmationEmail(booking, broker, origin)
    ]);

    if (internalResult.status === "fulfilled") {
      results.emailSent = internalResult.value;
      if (!results.emailSent) {
        results.emailError = "SMTP is not configured or no broker/admin recipient is available.";
      }
    } else {
      results.emailError = internalResult.reason?.message || "Internal notification failed.";
      console.warn(`Internal notification failed: ${results.emailError}`);
    }

    if (clientResult.status === "fulfilled") {
      results.clientConfirmationSent = clientResult.value;
      if (!results.clientConfirmationSent) {
        results.clientConfirmationError = "SMTP is not configured, client confirmation emails are off, or client email is missing.";
      }
    } else {
      results.clientConfirmationError = clientResult.reason?.message || "Client confirmation failed.";
      console.warn(`Client confirmation failed: ${results.clientConfirmationError}`);
    }
  }

  if (syncCalendar && booking.status === "Confirmed") {
    try {
      const event = await syncGoogleEvent(booking, broker, origin);
      if (event?.id && event.id !== booking.googleEventId) {
        results.googleEventId = event.id;
        await updateBooking(booking.id, { googleEventId: event.id });
      }
      results.googleSynced = Boolean(event?.id);
    } catch (error) {
      results.googleError = error.message || "Google Calendar sync failed.";
      console.warn(error.message);
    }
  }

  return results;
}

async function processBookingReminders(origin = "") {
  if (!smtpConfigured()) return;
  const [brokers, bookings] = await Promise.all([listBrokers(), listBookings()]);
  const brokerById = Object.fromEntries(brokers.map((broker) => [broker.id, broker]));
  const now = Date.now();
  const reminderWindowMs = REMINDER_MINUTES_BEFORE * 60 * 1000;

  for (const booking of bookings) {
    if (booking.status !== "Confirmed") continue;
    const startMs = new Date(booking.start).getTime();
    if (!Number.isFinite(startMs)) continue;
    if (startMs <= now || startMs - now > reminderWindowMs) continue;
    const key = `${booking.id}:${booking.start}`;
    if (reminderSendKeys.has(key)) continue;
    reminderSendKeys.add(key);
    try {
      await sendBookingReminderEmails(booking, brokerById[booking.brokerId], origin);
    } catch (error) {
      reminderSendKeys.delete(key);
      console.warn(`Booking reminder failed: ${error.message}`);
    }
  }
}

function requestOrigin(req) {
  const proto = req.headers["x-forwarded-proto"] || "http";
  return `${proto}://${req.headers.host}`;
}

function requestHostname(req) {
  return String(req.headers["x-forwarded-host"] || req.headers.host || "")
    .split(",")[0]
    .trim()
    .split(":")[0]
    .toLowerCase();
}

function safeJoin(base, pathname) {
  const decoded = decodeURIComponent(pathname);
  const target = path.join(base, decoded === "/" ? "index.html" : decoded);
  return target.startsWith(base) ? target : path.join(base, "index.html");
}

function contentType(file) {
  if (file.endsWith(".html")) return "text/html; charset=utf-8";
  if (file.endsWith(".js")) return "text/javascript; charset=utf-8";
  if (file.endsWith(".css")) return "text/css; charset=utf-8";
  if (file.endsWith(".svg")) return "image/svg+xml";
  if (file.endsWith(".png")) return "image/png";
  return "application/octet-stream";
}

function runtimeTargetForHost(hostname = "") {
  const value = String(hostname || "").toLowerCase();
  if (PORTAL_HOST_RE.test(value)) return "portal";
  return "booking";
}

function runtimeTitleForTarget(target) {
  return target === "portal" ? "BrokerDesk CRM" : "Easy Loan Finance Booking";
}

async function loadStaticShell(hostname = "") {
  const target = runtimeTargetForHost(hostname);
  const title = runtimeTitleForTarget(target);
  let html = await fs.readFile(path.join(DIST_DIR, "index.html"), "utf8");
  html = html.replace(/<title>.*?<\/title>/i, `<title>${title}</title>`);
  if (!html.includes("__ELF_RUNTIME_TARGET")) {
    const runtimeScript = `<script>window.__ELF_RUNTIME_TARGET=${JSON.stringify(target)};window.__ELF_RUNTIME_HOST=${JSON.stringify(String(hostname || ""))};</script>`;
    html = html.replace("</head>", `${runtimeScript}</head>`);
  }
  return Buffer.from(html, "utf8");
}

function isStaticAsset(pathname) {
  return pathname.startsWith("/assets/")
    || pathname === "/favicon.ico"
    || pathname === "/robots.txt"
    || pathname === "/manifest.webmanifest"
    || /\.(css|js|mjs|map|png|jpg|jpeg|svg|gif|webp|ico|woff2?|ttf)$/i.test(pathname);
}

function infinityAolPath(url) {
  if (url.pathname === INFINITY_AOL_BASE) return "/";
  if (url.pathname.startsWith(`${INFINITY_AOL_BASE}/`)) return url.pathname.slice(INFINITY_AOL_BASE.length) || "/";
  return url.pathname;
}

function forwardToInfinityAolApp(req, res, url, forwardedPrefix = "") {
  req.headers["x-forwarded-prefix"] = forwardedPrefix;
  const session = sessionForRequest(req);
  if (session?.role) req.headers["x-elf-role"] = session.role;
  if (session?.accessLevel) req.headers["x-elf-access-level"] = session.accessLevel;
  if (session?.email) req.headers["x-elf-user-email"] = session.email;
  const pathname = url.pathname.startsWith(`${INFINITY_AOL_BASE}/`)
    ? url.pathname.slice(INFINITY_AOL_BASE.length) || "/"
    : url.pathname === INFINITY_AOL_BASE
      ? "/"
      : url.pathname;
  req.url = `${pathname}${url.search}`;
  infinityAolApp(req, res);
}

function isPublicInfinityAolRequest(url) {
  const pathname = infinityAolPath(url);
  return pathname === "/api/health"
    || LOAN_FORM_PUBLIC_PATH_RE.test(pathname)
    || LOAN_FORM_PUBLIC_API_RE.test(pathname)
    || EASYFLOW_EXTENSION_API_RE.test(pathname)
    || isStaticAsset(pathname);
}

function requireInfinityAolLogin(req, res, url) {
  if (!ADMIN_PASSWORD) return true;
  if (isPublicInfinityAolRequest(url)) return true;
  if (adminSession(req)) return true;
  if (infinityAolPath(url).startsWith("/api/")) {
    sendJson(res, 401, { error: "BrokerDesk CRM login required" });
  } else {
    const returnTo = `${url.pathname}${url.search}`;
    res.writeHead(302, { location: `/login?returnTo=${encodeURIComponent(returnTo)}` });
    res.end();
  }
  return false;
}

function requireLoanFormHostPublicOnly(res, url) {
  if (isPublicInfinityAolRequest(url)) return true;
  if (url.pathname === "/") {
    res.writeHead(302, { location: "/loan-form" });
    res.end();
    return false;
  }
  sendJson(res, 404, { error: "Loan Form link required" });
  return false;
}

async function handleApi(req, res, url) {
  const brokers = await listBrokers();
  const session = sessionForRequest(req);

  if (req.method === "GET" && url.pathname === "/api/health") {
    processBookingReminders(requestOrigin(req)).catch((error) => console.warn(error.message));
    return sendJson(res, 200, { ok: true, app: "easy-loan-finance-booking" });
  }

  if (req.method === "GET" && url.pathname === "/api/auth/status") {
    const session = sessionForRequest(req);
    return sendJson(res, 200, {
      required: Boolean(ADMIN_PASSWORD),
      authenticated: !ADMIN_PASSWORD || Boolean(session),
      email: session?.email || (ADMIN_PASSWORD ? null : ADMIN_EMAIL),
      role: session?.role || (!ADMIN_PASSWORD ? "admin" : null),
      accessLevel: session?.accessLevel || (session?.role === "broker" ? "broker" : null),
      brokerId: session?.brokerId || null,
      mustChangePassword: Boolean(session?.mustChangePassword),
      expiresAt: session?.exp || null,
      maxAgeSeconds: SESSION_MAX_AGE_SECONDS,
      secondsRemaining: session?.exp ? Math.max(0, Math.floor((session.exp - Date.now()) / 1000)) : null
    });
  }

  if (req.method === "POST" && url.pathname === "/api/auth/request-password-reset") {
    const body = await readBody(req);
    const resetEmail = normalizeEmail(body.email);
    if (!isAdminEmail(resetEmail)) {
      return sendJson(res, 200, { ok: true, message: "If this admin email exists, a temporary password will be sent." });
    }
    if (!emailDeliveryReady()) {
      return sendJson(res, 500, { error: "Email delivery is not configured. Set the email provider first, then retry password reset." });
    }
    const tempPassword = `ELF-${randomBytes(4).toString("hex").toUpperCase()}`;
    const auth = await readAdminAuth();
    await writeAdminAuth({
      ...auth,
      tempPasswordHash: passwordHash(tempPassword),
      tempExpiresAt: Date.now() + PASSWORD_RESET_TTL_SECONDS * 1000,
      tempIssuedAt: new Date().toISOString()
    });
    await sendAdminPasswordResetEmail(resetEmail, tempPassword, requestOrigin(req));
    return sendJson(res, 200, { ok: true, message: `Temporary password sent to ${resetEmail}.` });
  }

  if (req.method === "POST" && url.pathname === "/api/auth/login") {
    const body = await readBody(req);
    const loginEmail = normalizeEmail(body.email);
    const adminPasswordMatch = ADMIN_PASSWORD ? await matchAdminPassword(body.password) : { ok: false, temporary: false };
    if (!adminPasswordMatch.ok) {
      if (isAdminEmail(loginEmail)) {
        return sendJson(res, 401, { error: "Use the Ryan admin password for this email." });
      }
      const broker = brokers.find((item) => brokerMatchesLogin(item, body.email, body.password));
      if (!broker) return sendJson(res, 401, { error: "Wrong email or access code" });
      const token = signSession({
        role: "broker",
        accessLevel: broker.accessLevel || "broker",
        brokerId: broker.id,
        email: broker.email,
        name: broker.name,
        exp: Date.now() + SESSION_MAX_AGE_SECONDS * 1000
      });
      setSessionCookie(req, res, token);
      return sendJson(res, 200, { ok: true, role: "broker", accessLevel: broker.accessLevel || "broker", brokerId: broker.id, email: broker.email });
    }
    const adminEmail = isAdminEmail(loginEmail) ? loginEmail : ADMIN_EMAIL;
    const token = signSession({
      role: "admin",
      email: adminEmail,
      mustChangePassword: adminPasswordMatch.temporary,
      exp: Date.now() + SESSION_MAX_AGE_SECONDS * 1000
    });
    setSessionCookie(req, res, token);
    return sendJson(res, 200, { ok: true, role: "admin", email: adminEmail, mustChangePassword: adminPasswordMatch.temporary });
  }

  if (req.method === "POST" && url.pathname === "/api/auth/logout") {
    clearSessionCookie(req, res);
    return sendJson(res, 200, { ok: true });
  }

  if (!requireAdmin(req, res, url)) return;

  if (req.method === "POST" && url.pathname === "/api/auth/change-password") {
    if (!session) return sendJson(res, 401, { error: "Login required" });
    const body = await readBody(req);
    const currentPassword = String(body.currentPassword || "");
    const newPassword = String(body.newPassword || "");
    if (newPassword.length < 6) return sendJson(res, 400, { error: "New access code must be at least 6 characters." });
    if (isAdminSession(session)) {
      const ok = await matchAdminPassword(currentPassword);
      if (!ok.ok) return sendJson(res, 401, { error: "Current Ryan admin password or temporary password is incorrect." });
      await setAdminPassword(newPassword);
      const token = signSession({
        role: "admin",
        email: session.email || ADMIN_EMAIL,
        exp: Date.now() + SESSION_MAX_AGE_SECONDS * 1000
      });
      setSessionCookie(req, res, token);
      return sendJson(res, 200, { ok: true, message: "Ryan admin password changed.", expiresAt: Date.now() + SESSION_MAX_AGE_SECONDS * 1000 });
    }
    const broker = brokers.find((item) => item.id === session.brokerId);
    if (!broker || !brokerMatchesLogin(broker, session.email, currentPassword)) {
      return sendJson(res, 401, { error: "Current access code is incorrect." });
    }
    const updated = await updateBroker(broker.id, { accessCode: newPassword });
    const token = signSession({
      role: "broker",
      accessLevel: updated.accessLevel || "broker",
      brokerId: updated.id,
      email: updated.email,
      name: updated.name,
      exp: Date.now() + SESSION_MAX_AGE_SECONDS * 1000
    });
    setSessionCookie(req, res, token);
    return sendJson(res, 200, { ok: true, message: "Access code changed.", expiresAt: Date.now() + SESSION_MAX_AGE_SECONDS * 1000 });
  }

  if (req.method === "GET" && url.pathname === "/api/backup") {
    if (!isAdminSession(session)) return sendJson(res, 403, { error: "Admin only" });
    res.writeHead(200, {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "content-disposition": `attachment; filename="brokerdesk-backup-${new Date().toISOString().slice(0, 10)}.json"`
    });
    res.end(JSON.stringify(await buildSystemBackup(), null, 2));
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/integrations") {
    if (!isAdminSession(session)) return sendJson(res, 403, { error: "Admin only" });
    const emailReady = emailDeliveryReady();
    const appsScriptReady = appsScriptEmailConfigured();
    const internalRecipients = Array.from(new Set(brokers.flatMap((broker) => internalNotificationRecipients(broker))));
    return sendJson(res, 200, {
      emailNotifications: Boolean(emailReady && internalRecipients.length > 0),
      brokerEmailRouting: Boolean(emailReady && brokers.some((broker) => broker.email)),
      clientConfirmationEmails: Boolean(emailReady && CLIENT_CONFIRMATION_EMAILS),
      emailProvider: appsScriptReady ? "google_apps_script" : "smtp",
      emailFrom: senderFrom(),
      clientEmailFrom: clientSenderFrom(),
      notifyEmail: NOTIFY_EMAIL || "",
      internalRecipients,
      clientReplyTo: process.env.CLIENT_REPLY_TO || NOTIFY_EMAIL || process.env.SMTP_USER || "",
      smtpHost: process.env.SMTP_HOST || "",
      appsScriptEmail: appsScriptReady,
      missingEmailSettings: [
        !appsScriptReady && !process.env.SMTP_HOST && "SMTP_HOST or GOOGLE_APPS_SCRIPT_EMAIL_URL",
        !appsScriptReady && !process.env.SMTP_USER && "SMTP_USER or GOOGLE_APPS_SCRIPT_EMAIL_TOKEN",
        !appsScriptReady && !process.env.SMTP_PASS && "SMTP_PASS",
        !NOTIFY_EMAIL && "BOOKING_NOTIFY_EMAIL"
      ].filter(Boolean),
      googleDirectSync: Boolean(brokers.some((broker) => appsScriptCalendarConfigured(broker)) || (GOOGLE_CALENDAR_ID && (process.env.GOOGLE_SERVICE_ACCOUNT_JSON || (process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL && process.env.GOOGLE_PRIVATE_KEY)))),
      reminderMinutesBefore: REMINDER_MINUTES_BEFORE,
      icsSync: true
    });
  }

  if (req.method === "GET" && url.pathname === "/api/email-templates") {
    if (!isAdminSession(session)) return sendJson(res, 403, { error: "Admin only" });
    const templates = await getEmailTemplates();
    return sendJson(res, 200, {
      templates,
      defaults: cleanEmailTemplates(defaultEmailTemplates),
      logoUrl: emailLogoUrl(requestOrigin(req)),
      placeholders: ["clientName", "brokerName", "brokerPhone", "service", "time", "channel", "companyName", "slogan"]
    });
  }

  if (req.method === "PATCH" && url.pathname === "/api/email-templates") {
    if (!isAdminSession(session)) return sendJson(res, 403, { error: "Admin only" });
    const body = await readBody(req);
    const result = await saveEmailTemplates(body);
    return sendJson(res, 200, {
      ok: true,
      ...result,
      defaults: cleanEmailTemplates(defaultEmailTemplates),
      logoUrl: emailLogoUrl(requestOrigin(req)),
      placeholders: ["clientName", "brokerName", "brokerPhone", "service", "time", "channel", "companyName", "slogan"]
    });
  }

  if (req.method === "POST" && url.pathname === "/api/email-test") {
    if (!isAdminSession(session)) return sendJson(res, 403, { error: "Admin only" });
    const body = await readBody(req);
    const broker = brokers.find((item) => item.id === "ryan-vu") || brokers[0];
    const testBooking = {
      id: `email-test-${Date.now()}`,
      clientName: body.clientName || "Email Test Client",
      phone: body.phone || "0400 000 000",
      email: body.clientEmail || NOTIFY_EMAIL,
      brokerId: broker?.id || "ryan-vu",
      service: "Home loan consultation",
      channel: "Phone call",
      status: "Confirmed",
      start: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      end: new Date(Date.now() + 24 * 60 * 60 * 1000 + 30 * 60 * 1000).toISOString(),
      notes: "This is a test email from Easy Loan Finance Booking."
    };
    const results = { internal: false, client: false };
    try {
      results.internal = await sendBookingEmail(testBooking, broker, requestOrigin(req));
    } catch (error) {
      return sendJson(res, 500, { error: `Internal email failed: ${error.message}`, results });
    }
    try {
      results.client = await sendClientConfirmationEmail(testBooking, broker, requestOrigin(req));
    } catch (error) {
      return sendJson(res, 500, { error: `Client confirmation failed: ${error.message}`, results });
    }
    return sendJson(res, 200, { ok: true, results, internalRecipients: internalNotificationRecipients(broker) });
  }

  if (req.method === "GET" && url.pathname === "/api/brokers") {
    if (isAdminSession(session)) return sendJson(res, 200, sortBrokers(brokers));
    if (session?.role === "broker") {
      return sendJson(res, 200, sortBrokers(brokers.filter((broker) => broker.id === session.brokerId)).map(publicBroker));
    }
    return sendJson(res, 200, sortBrokers(brokers).map(publicBroker));
  }

  if (req.method === "GET" && url.pathname === "/api/availability") {
    const bookings = await listBookings();
    const date = url.searchParams.get("date") || new Date().toISOString().slice(0, 10);
    const brokerId = url.searchParams.get("brokerId") || brokers[0]?.id;
    const duration = Number(url.searchParams.get("duration") || 30);
    return sendJson(res, 200, availabilityFor({ brokerId, date, duration }, brokers, bookings));
  }

  if (req.method === "POST" && url.pathname === "/api/brokers") {
    if (!isAdminSession(session)) return sendJson(res, 403, { error: "Admin only" });
    const body = await readBody(req);
    const id = body.id || body.name?.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || `broker-${Date.now()}`;
    if (brokers.some((broker) => broker.id === id)) {
      return sendJson(res, 409, { error: "Broker ID already exists" });
    }
    const next = {
      id,
      name: body.name || "New Broker",
      title: body.title || "Finance Broker",
      location: body.location || "Adelaide, SA",
      email: body.email || "",
      phone: body.phone || "",
      color: body.color || "#b89044",
      accessLevel: body.accessLevel === "staff" ? "staff" : "broker",
      accessCode: body.accessCode || "",
      services: Array.isArray(body.services) ? body.services : ["First home buyer", "Refinance"],
      hours: body.hours || { start: "09:00", end: "17:00" }
    };
    const saved = await createBroker(next);
    return sendJson(res, 201, saved);
  }

  const brokerResetMatch = url.pathname.match(/^\/api\/brokers\/([^/]+)\/reset-access$/);
  if (brokerResetMatch && req.method === "POST") {
    if (!isAdminSession(session)) return sendJson(res, 403, { error: "Admin only" });
    const id = brokerResetMatch[1];
    const broker = brokers.find((item) => item.id === id);
    if (!broker) return sendJson(res, 404, { error: "Broker not found" });
    const tempAccessCode = `ELF-${randomBytes(4).toString("hex").toUpperCase()}`;
    const updated = await updateBroker(id, { accessCode: tempAccessCode });
    if (emailDeliveryReady()) {
      await sendBrokerAccessResetEmail(ADMIN_EMAIL, updated, tempAccessCode, requestOrigin(req));
    }
    return sendJson(res, 200, {
      ok: true,
      broker: updated,
      sentTo: emailDeliveryReady() ? ADMIN_EMAIL : null,
      message: emailDeliveryReady()
        ? `Temporary access code sent to ${ADMIN_EMAIL}.`
        : `Temporary access code generated. Email is not configured: ${tempAccessCode}`
    });
  }

  const brokerMatch = url.pathname.match(/^\/api\/brokers\/([^/]+)$/);
  if (brokerMatch && req.method === "PATCH") {
    if (!isAdminSession(session)) return sendJson(res, 403, { error: "Admin only" });
    const id = brokerMatch[1];
    const body = await readBody(req);
    const updated = await updateBroker(id, body);
    if (!updated) return sendJson(res, 404, { error: "Broker not found" });
    return sendJson(res, 200, updated);
  }

  if (brokerMatch && req.method === "DELETE") {
    if (!isAdminSession(session)) return sendJson(res, 403, { error: "Admin only" });
    const id = brokerMatch[1];
    const reassignTo = url.searchParams.get("reassignTo");
    if (reassignTo === id) {
      return sendJson(res, 400, { error: "Choose a different broker to receive bookings." });
    }
    if (reassignTo && !brokers.some((broker) => broker.id === reassignTo)) {
      return sendJson(res, 404, { error: "Receiving broker not found." });
    }
    const result = await deleteBroker(id, reassignTo);
    if (!result.ok) {
      return sendJson(res, 409, {
        error: "Broker still has bookings. Choose another broker to receive those bookings.",
        bookingCount: result.bookingCount
      });
    }
    return sendJson(res, 200, { ok: true });
  }

  if (req.method === "GET" && url.pathname === "/api/bookings") {
    const bookings = await listBookings();
    if (session?.role === "broker") {
      return sendJson(res, 200, bookings.filter((booking) => booking.brokerId === session.brokerId));
    }
    return sendJson(res, 200, bookings);
  }

  if (req.method === "POST" && url.pathname === "/api/bookings") {
    const body = await readBody(req);
    const next = { ...body, id: body.id || `bk-${Date.now()}` };
    if (!session && isPublicRequest(req, url)) {
      next.status = "Confirmed";
      if (!String(next.email || "").trim()) {
        return sendJson(res, 400, { error: "Email is required so we can send the booking confirmation." });
      }
      const windowError = validatePublicBookingWindow(next);
      if (windowError) return sendJson(res, 400, { error: windowError });
    }
    const existingBookings = await listBookings();
    if (hasBookingConflict(next, existingBookings)) {
      return sendJson(res, 409, { error: "This time is already booked. Please choose another available slot." });
    }
    const saved = await createBooking(next);
    afterBookingSaved(saved, brokers, req, { syncCalendar: false }).catch((error) => console.warn(error.message));
    afterBookingSaved(saved, brokers, req, { sendEmail: false }).catch((error) => console.warn(error.message));
    return sendJson(res, 201, { ...saved, integrations: { queued: true } });
  }

  const bookingMatch = url.pathname.match(/^\/api\/bookings\/([^/]+)$/);
  if (bookingMatch && req.method === "PATCH") {
    if (!isAdminSession(session)) return sendJson(res, 403, { error: "Admin only" });
    const id = bookingMatch[1];
    const body = await readBody(req);
    const updated = await updateBooking(id, body);
    if (!updated) return sendJson(res, 404, { error: "Booking not found" });
    if (updated.status === "Confirmed" || updated.googleEventId) {
      afterBookingSaved(updated, brokers, req, { sendEmail: false }).catch((error) => console.warn(error.message));
    }
    return sendJson(res, 200, updated);
  }

  if (bookingMatch && req.method === "DELETE") {
    if (!isAdminSession(session)) return sendJson(res, 403, { error: "Admin only" });
    const id = bookingMatch[1];
    const booking = (await listBookings()).find((item) => item.id === id);
    if (!booking) return sendJson(res, 404, { error: "Booking not found" });
    const broker = brokers.find((item) => item.id === booking.brokerId);
    try {
      await deleteGoogleEvent(booking, broker);
    } catch (error) {
      console.warn(`Calendar delete failed: ${error.message}`);
      return sendJson(res, 502, { error: `Calendar delete failed: ${error.message}` });
    }
    await deleteBooking(id);
    return sendJson(res, 200, { ok: true });
  }

  return sendJson(res, 404, { error: "Not found" });
}

async function handleCalendar(req, res, url) {
  const brokers = await listBrokers();
  const bookings = await listBookings();
  const brokerMatch = url.pathname.match(/^\/calendar\/broker\/([^/]+)\.ics$/);
  const filtered = brokerMatch
    ? bookings.filter((booking) => booking.brokerId === brokerMatch[1])
    : bookings;
  const text = calendarText(filtered, brokers, req);

  res.writeHead(200, {
    "content-type": "text/calendar; charset=utf-8",
    "content-disposition": "inline; filename=easy-loan-finance-bookings.ics",
    "cache-control": "no-cache"
  });
  res.end(text);
}

async function handleStatic(req, res, url) {
  const file = safeJoin(DIST_DIR, url.pathname);
  try {
    const stat = await fs.stat(file);
    const finalFile = stat.isDirectory() ? path.join(file, "index.html") : file;
    const isHtmlShell = path.basename(finalFile).toLowerCase() === "index.html";
    const bytes = isHtmlShell ? await loadStaticShell(requestHostname(req)) : await fs.readFile(finalFile);
    const headers = { "content-type": contentType(finalFile) };
    if (isHtmlShell) headers["cache-control"] = "no-store, no-cache, must-revalidate";
    res.writeHead(200, headers);
    res.end(bytes);
  } catch {
    try {
      const bytes = await loadStaticShell(requestHostname(req));
      res.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store, no-cache, must-revalidate"
      });
      res.end(bytes);
    } catch {
      sendJson(res, 404, { error: "Build not found. Run npm run build first." });
    }
  }
}

async function handleBrokerDeskStatic(req, res, url) {
  const file = safeJoin(BROKER_DESK_DIR, url.pathname);
  try {
    const stat = await fs.stat(file);
    const finalFile = stat.isDirectory() ? path.join(file, "index.html") : file;
    const isHtmlShell = path.basename(finalFile).toLowerCase() === "index.html";
    const bytes = await fs.readFile(finalFile);
    const headers = { "content-type": contentType(finalFile) };
    if (isHtmlShell) headers["cache-control"] = "no-store, no-cache, must-revalidate";
    res.writeHead(200, headers);
    res.end(bytes);
  } catch {
    try {
      const bytes = await fs.readFile(path.join(BROKER_DESK_DIR, "index.html"));
      res.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store, no-cache, must-revalidate"
      });
      res.end(bytes);
    } catch {
      sendJson(res, 404, { error: "Broker Desk build not found." });
    }
  }
}

async function handleBrokerDeskApi(req, res) {
  if (req.method !== "POST") {
    return sendJson(res, 405, { ok: false, msg: "Method not allowed" });
  }
  if (!BROKER_DESK_API_URL) {
    return sendJson(res, 500, {
      ok: false,
      msg: "APPS_SCRIPT_URL env var is not set on this service."
    });
  }

  const chunks = [];
  try {
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const body = Buffer.concat(chunks).toString("utf8");
    const upstream = await fetch(BROKER_DESK_API_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body,
      redirect: "follow"
    });
    const text = await upstream.text();
    res.writeHead(upstream.ok ? 200 : upstream.status || 502, {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store"
    });
    res.end(text);
  } catch (error) {
    sendJson(res, 502, {
      ok: false,
      msg: `Proxy error reaching broker desk backend: ${error.message || error}`
    });
  }
}

await ensureData();

setInterval(() => {
  processBookingReminders(process.env.PUBLIC_APP_URL || process.env.RENDER_EXTERNAL_URL || "").catch((error) => {
    console.warn(error.message);
  });
}, 60 * 1000);

createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", requestOrigin(req));
    const hostname = requestHostname(req);
    processBookingReminders(requestOrigin(req)).catch((error) => console.warn(error.message));
    if (LOAN_FORM_HOST_RE.test(hostname)) {
      if (req.method === "GET" && /^\/(?:loan-form|client-info|apply|start|home-loan|refinance|commercial-loan|business-loan|car-loan|personal-loan)?\/?$/.test(url.pathname)) {
        res.setHeader("Clear-Site-Data", "\"cache\", \"storage\"");
      }
      if (SHARED_BRAND_ASSET_RE.test(url.pathname)) return await handleStatic(req, res, url);
      if (!requireLoanFormHostPublicOnly(res, url)) return;
      forwardToInfinityAolApp(req, res, url);
      return;
    }
    if (CLIENT_CALL_HOST_RE.test(hostname) || EASYFLOW_AI_HOST_RE.test(hostname) || LOAN_SUBMISSIONS_HOST_RE.test(hostname)) {
      if (SHARED_BRAND_ASSET_RE.test(url.pathname)) return await handleStatic(req, res, url);
      if (url.pathname.startsWith(`${INFINITY_AOL_BASE}/assets/`)) {
        forwardToInfinityAolApp(req, res, url, INFINITY_AOL_BASE);
        return;
      }
      if (url.pathname === "/login") {
        forwardToInfinityAolApp(req, res, url);
        return;
      }
      if (url.pathname.startsWith("/api/auth/")) return await handleApi(req, res, url);
      if (url.pathname === "/api/storage/status") {
        forwardToInfinityAolApp(req, res, url);
        return;
      }
      if (/^\/api\/brokers(?:\/|$)/.test(url.pathname)) {
        if (!requireInfinityAolLogin(req, res, url)) return;
        return await handleApi(req, res, url);
      }
      if (CLIENT_CALL_HOST_RE.test(hostname) && /^\/api\/call-notes(?:\/|$)/.test(url.pathname) && ["GET", "POST", "PATCH", "DELETE"].includes(req.method)) {
        forwardToInfinityAolApp(req, res, url);
        return;
      }
      if (!requireInfinityAolLogin(req, res, url)) return;
      forwardToInfinityAolApp(req, res, url);
      return;
    }
    if (url.pathname === INFINITY_AOL_BASE || url.pathname.startsWith(`${INFINITY_AOL_BASE}/`)) {
      if (!requireInfinityAolLogin(req, res, url)) return;
      forwardToInfinityAolApp(req, res, url, INFINITY_AOL_BASE);
      return;
    }
    if (PORTAL_HOST_RE.test(hostname)) {
      if (url.pathname === "/loan-submissions") {
        res.writeHead(302, { location: "https://loan-submissions-management.easyloanfinance.com.au" });
        res.end();
        return;
      }
      if (url.pathname.startsWith(`${INFINITY_AOL_BASE}/`)) {
        if (!requireInfinityAolLogin(req, res, url)) return;
        forwardToInfinityAolApp(req, res, url, INFINITY_AOL_BASE);
        return;
      }
      if (url.pathname === "/api") return await handleBrokerDeskApi(req, res);
      if (url.pathname.startsWith("/api/auth/")) return await handleApi(req, res, url);
      if (/^\/api\/brokers(?:\/|$)/.test(url.pathname)) {
        if (!requireInfinityAolLogin(req, res, url)) return;
        return await handleApi(req, res, url);
      }
      if (/^\/api\/(?:call-notes|client-intakes)(?:\/|$)/.test(url.pathname)) {
        if (!requireInfinityAolLogin(req, res, url)) return;
        forwardToInfinityAolApp(req, res, url);
        return;
      }
      if (url.pathname.startsWith("/api/")) {
        return sendJson(res, 404, { ok: false, msg: "Broker Desk API route not found" });
      }
      if (url.pathname === "/calendar/team.ics" || url.pathname.startsWith("/calendar/broker/")) {
        return await handleCalendar(req, res, url);
      }
      return await handleBrokerDeskStatic(req, res, url);
    }
    if (BOOKING_HOST_RE.test(hostname)) {
      if (url.pathname.startsWith("/book") || url.pathname.startsWith("/widget")) return await handleStatic(req, res, url);
      if (url.pathname.startsWith("/api/") || url.pathname === "/calendar/team.ics" || url.pathname.startsWith("/calendar/broker/")) {
        if (url.pathname === "/calendar/team.ics" || url.pathname.startsWith("/calendar/broker/")) return await handleCalendar(req, res, url);
        return await handleApi(req, res, url);
      }
      if (isStaticAsset(url.pathname)) return await handleStatic(req, res, url);
      if (!ADMIN_PASSWORD || adminSession(req) || url.pathname === "/" || url.pathname === "/login") return await handleStatic(req, res, url);
      return await handleStatic(req, res, new URL("/login", requestOrigin(req)));
    }
    if (url.pathname === "/api/backup") return await handleApi(req, res, url);
    if (url.pathname.startsWith("/api/")) return await handleApi(req, res, url);
    if (url.pathname === "/calendar/team.ics" || url.pathname.startsWith("/calendar/broker/")) {
      return await handleCalendar(req, res, url);
    }
    if (isStaticAsset(url.pathname)) {
      return await handleStatic(req, res, url);
    }
    if (!ADMIN_PASSWORD || url.pathname.startsWith("/book") || adminSession(req)) {
      return await handleStatic(req, res, url);
    }
    return await handleStatic(req, res, new URL("/login", requestOrigin(req)));
  } catch (error) {
    sendJson(res, 500, { error: error.message || "Server error" });
  }
}).listen(PORT, () => {
  console.log(`Easy Loan Finance Booking is running on http://localhost:${PORT}`);
});
