import { createServer } from "node:http";
import { createHash, createHmac, createSign, timingSafeEqual } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import nodemailer from "nodemailer";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3000);
const DATA_DIR = path.join(__dirname, "data");
const DIST_DIR = path.join(__dirname, "dist");
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
const USE_SUPABASE = Boolean(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY);
const TIME_ZONE = process.env.BOOKING_TIME_ZONE || "Australia/Adelaide";
const NOTIFY_EMAIL = process.env.BOOKING_NOTIFY_EMAIL || process.env.NOTIFY_EMAIL;
const CLIENT_CONFIRMATION_EMAILS = process.env.CLIENT_CONFIRMATION_EMAILS !== "false";
const GOOGLE_CALENDAR_ID = process.env.GOOGLE_CALENDAR_ID;
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || "ryan.vufinanceaus@gmail.com";
const ADMIN_EMAILS = Array.from(new Set([
  ADMIN_EMAIL,
  "ryan.vufinanceaus@gmail.com",
  "ryan@easyloanfinance.com.au",
  ...(process.env.ADMIN_EMAILS || "").split(",")
].map(normalizeEmail).filter(Boolean)));
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "";
const ADMIN_SESSION_SECRET = process.env.ADMIN_SESSION_SECRET || ADMIN_PASSWORD || "local-dev-secret-change-me";
const PUBLIC_API_ROUTES = new Set(["/api/health", "/api/brokers", "/api/bookings"]);
const PUBLIC_BOOKING_DURATION = 30;
const BUSINESS_START = "09:30";
const BUSINESS_END = "17:00";

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

function brokerMatchesLogin(broker, email, password) {
  if (!broker?.email || !broker?.accessCode) return false;
  return broker.email.toLowerCase() === String(email || "").trim().toLowerCase()
    && safeEqual(String(broker.accessCode), String(password || ""));
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
  if (!USE_SUPABASE) {
    const bookings = await readJson("bookings.json");
    bookings.push(payload);
    await writeJson("bookings.json", bookings);
    return payload;
  }
  const [created] = await supabaseRequest("bookings", {
    method: "POST",
    body: payload,
    prefer: "return=representation"
  });
  return created;
}

async function updateBooking(id, patch) {
  if (!USE_SUPABASE) {
    const bookings = await readJson("bookings.json");
    const index = bookings.findIndex((booking) => booking.id === id);
    if (index === -1) return null;
    bookings[index] = { ...bookings[index], ...patch, id };
    await writeJson("bookings.json", bookings);
    return bookings[index];
  }
  const [updated] = await supabaseRequest("bookings", {
    method: "PATCH",
    query: `?id=eq.${encodeURIComponent(id)}`,
    body: patch,
    prefer: "return=representation"
  });
  return updated || null;
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

function setSessionCookie(res, token) {
  res.setHeader("set-cookie", [
    `elf_admin=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=604800`,
  ]);
}

function clearSessionCookie(res) {
  res.setHeader("set-cookie", "elf_admin=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0");
}

function isPublicRequest(req, url) {
  if (url.pathname.startsWith("/book")) return true;
  if (url.pathname.startsWith("/calendar/")) return true;
  if (url.pathname === "/api/auth/login" || url.pathname === "/api/auth/status" || url.pathname === "/api/auth/logout") return true;
  if (url.pathname === "/api/availability" && req.method === "GET") return true;
  if (url.pathname === "/api/bookings" && req.method === "POST") return true;
  if (url.pathname === "/api/brokers" && req.method === "GET") return true;
  return false;
}

function adminSession(req) {
  return verifySession(parseCookies(req).elf_admin);
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

  const slots = [];
  for (let minute = startMinutes; minute + slotDuration <= endMinutes; minute += 30) {
    const end = minute + slotDuration;
    const booked = brokerBookings.some((booking) => overlaps(minute, end, booking.start, booking.end));
    const time = timeFromMinutes(minute);
    slots.push({
      time,
      label: slotLabel(time),
      available: !booked
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

async function syncGoogleEvent(booking, broker, origin = "") {
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

function smtpConfigured() {
  return Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
}

function internalNotificationRecipients(broker) {
  return Array.from(new Set([
    NOTIFY_EMAIL,
    broker?.email
  ].map(normalizeEmail).filter(Boolean)));
}

function mailTransporter() {
  if (!smtpConfigured()) return null;

  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === "true",
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS
    }
  });
}

function formattedBookingTime(booking) {
  return new Intl.DateTimeFormat("en-AU", {
    timeZone: TIME_ZONE,
    dateStyle: "full",
    timeStyle: "short"
  }).format(new Date(booking.start));
}

async function sendBookingEmail(booking, broker, origin = "") {
  const transporter = mailTransporter();
  const recipients = internalNotificationRecipients(broker);
  if (!transporter || recipients.length === 0) return false;
  const when = new Intl.DateTimeFormat("en-AU", {
    timeZone: TIME_ZONE,
    dateStyle: "full",
    timeStyle: "short"
  }).format(new Date(booking.start));

  await transporter.sendMail({
    from: process.env.SMTP_FROM || process.env.SMTP_USER,
    to: recipients.join(", "),
    replyTo: booking.email || undefined,
    subject: `New booking request: ${booking.clientName} (${booking.service})`,
    text: [
      "New Easy Loan Finance booking request",
      "",
      `Client: ${booking.clientName}`,
      `Phone: ${booking.phone || "Not provided"}`,
      `Email: ${booking.email || "Not provided"}`,
      `Broker: ${broker?.name || booking.brokerId}`,
      `Service: ${booking.service}`,
      `When: ${when}`,
      `Channel: ${booking.channel}`,
      `Status: ${booking.status}`,
      "",
      booking.notes ? `Notes: ${booking.notes}` : "",
      origin ? `Dashboard: ${origin}` : ""
    ].filter(Boolean).join("\n"),
    html: `
      <div style="font-family:Arial,sans-serif;color:#161411;line-height:1.5">
        <h2 style="margin:0 0 12px">New Easy Loan Finance booking request</h2>
        <p><strong>Client:</strong> ${escapeHtml(booking.clientName)}</p>
        <p><strong>Phone:</strong> ${escapeHtml(booking.phone || "Not provided")}</p>
        <p><strong>Email:</strong> ${escapeHtml(booking.email || "Not provided")}</p>
        <p><strong>Broker:</strong> ${escapeHtml(broker?.name || booking.brokerId)}</p>
        <p><strong>Service:</strong> ${escapeHtml(booking.service)}</p>
        <p><strong>When:</strong> ${escapeHtml(when)}</p>
        <p><strong>Channel:</strong> ${escapeHtml(booking.channel)}</p>
        <p><strong>Status:</strong> ${escapeHtml(booking.status)}</p>
        ${booking.notes ? `<p><strong>Notes:</strong> ${escapeHtml(booking.notes)}</p>` : ""}
        ${origin ? `<p><a href="${escapeHtml(origin)}">Open booking dashboard</a></p>` : ""}
      </div>
    `
  });

  return true;
}

async function sendClientConfirmationEmail(booking, broker) {
  const transporter = mailTransporter();
  if (!CLIENT_CONFIRMATION_EMAILS || !transporter || !booking.email) return false;

  const when = formattedBookingTime(booking);
  const from = process.env.CLIENT_CONFIRMATION_FROM || process.env.SMTP_FROM || process.env.SMTP_USER;
  const replyTo = process.env.CLIENT_REPLY_TO || NOTIFY_EMAIL || process.env.SMTP_USER;

  await transporter.sendMail({
    from,
    to: booking.email,
    replyTo,
    subject: `Booking request received - Easy Loan Finance`,
    text: [
      `Hi ${booking.clientName},`,
      "",
      "Thanks for booking with Easy Loan Finance. We have received your appointment request.",
      "",
      `Broker: ${broker?.name || "Easy Loan Finance"}`,
      `Service: ${booking.service}`,
      `Requested time: ${when}`,
      `Meeting style: ${booking.channel}`,
      "",
      "A broker will confirm the appointment shortly.",
      "",
      "Easy Loan Finance"
    ].join("\n"),
    html: `
      <div style="font-family:Arial,sans-serif;color:#161411;line-height:1.5">
        <h2 style="margin:0 0 12px">Booking request received</h2>
        <p>Hi ${escapeHtml(booking.clientName)},</p>
        <p>Thanks for booking with Easy Loan Finance. We have received your appointment request.</p>
        <p><strong>Broker:</strong> ${escapeHtml(broker?.name || "Easy Loan Finance")}</p>
        <p><strong>Service:</strong> ${escapeHtml(booking.service)}</p>
        <p><strong>Requested time:</strong> ${escapeHtml(when)}</p>
        <p><strong>Meeting style:</strong> ${escapeHtml(booking.channel)}</p>
        <p>A broker will confirm the appointment shortly.</p>
        <p>Easy Loan Finance</p>
      </div>
    `
  });

  return true;
}

function escapeHtml(value = "") {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function afterBookingSaved(booking, brokers, req, { sendEmail = true } = {}) {
  const broker = brokers.find((item) => item.id === booking.brokerId);
  const origin = requestOrigin(req);

  const results = { emailSent: false, clientConfirmationSent: false, googleSynced: false, googleEventId: booking.googleEventId || null };

  if (sendEmail) {
    try {
      results.emailSent = await sendBookingEmail(booking, broker, origin);
    } catch (error) {
      console.warn(`Internal notification failed: ${error.message}`);
    }
    try {
      results.clientConfirmationSent = await sendClientConfirmationEmail(booking, broker);
    } catch (error) {
      console.warn(`Client confirmation failed: ${error.message}`);
    }
  }

  if (booking.status === "Confirmed") {
    try {
      const event = await syncGoogleEvent(booking, broker, origin);
      if (event?.id && event.id !== booking.googleEventId) {
        results.googleEventId = event.id;
        await updateBooking(booking.id, { googleEventId: event.id });
      }
      results.googleSynced = Boolean(event?.id);
    } catch (error) {
      console.warn(error.message);
    }
  }

  return results;
}

function requestOrigin(req) {
  const proto = req.headers["x-forwarded-proto"] || "http";
  return `${proto}://${req.headers.host}`;
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

function isStaticAsset(pathname) {
  return pathname.startsWith("/assets/")
    || pathname === "/favicon.ico"
    || pathname === "/robots.txt"
    || pathname === "/manifest.webmanifest"
    || /\.(css|js|mjs|map|png|jpg|jpeg|svg|gif|webp|ico|woff2?|ttf)$/i.test(pathname);
}

async function handleApi(req, res, url) {
  const brokers = await listBrokers();
  const session = sessionForRequest(req);

  if (req.method === "GET" && url.pathname === "/api/health") {
    return sendJson(res, 200, { ok: true, app: "easy-loan-finance-booking" });
  }

  if (req.method === "GET" && url.pathname === "/api/auth/status") {
    const session = sessionForRequest(req);
    return sendJson(res, 200, {
      required: Boolean(ADMIN_PASSWORD),
      authenticated: !ADMIN_PASSWORD || Boolean(session),
      email: session?.email || (ADMIN_PASSWORD ? null : ADMIN_EMAIL),
      role: session?.role || (!ADMIN_PASSWORD ? "admin" : null),
      brokerId: session?.brokerId || null
    });
  }

  if (req.method === "POST" && url.pathname === "/api/auth/login") {
    const body = await readBody(req);
    const loginEmail = normalizeEmail(body.email);
    const passwordOk = ADMIN_PASSWORD && createHash("sha256").update(String(body.password || "")).digest("hex") === createHash("sha256").update(ADMIN_PASSWORD).digest("hex");
    if (!passwordOk) {
      if (isAdminEmail(loginEmail)) {
        return sendJson(res, 401, { error: "Use the Ryan admin password for this email." });
      }
      const broker = brokers.find((item) => brokerMatchesLogin(item, body.email, body.password));
      if (!broker) return sendJson(res, 401, { error: "Wrong email or access code" });
      const token = signSession({
        role: "broker",
        brokerId: broker.id,
        email: broker.email,
        name: broker.name,
        exp: Date.now() + 7 * 24 * 60 * 60 * 1000
      });
      setSessionCookie(res, token);
      return sendJson(res, 200, { ok: true, role: "broker", brokerId: broker.id, email: broker.email });
    }
    const adminEmail = isAdminEmail(loginEmail) ? loginEmail : ADMIN_EMAIL;
    const token = signSession({
      role: "admin",
      email: adminEmail,
      exp: Date.now() + 7 * 24 * 60 * 60 * 1000
    });
    setSessionCookie(res, token);
    return sendJson(res, 200, { ok: true, role: "admin", email: adminEmail });
  }

  if (req.method === "POST" && url.pathname === "/api/auth/logout") {
    clearSessionCookie(res);
    return sendJson(res, 200, { ok: true });
  }

  if (!requireAdmin(req, res, url)) return;

  if (req.method === "GET" && url.pathname === "/api/integrations") {
    if (!isAdminSession(session)) return sendJson(res, 403, { error: "Admin only" });
    const emailReady = smtpConfigured();
    const internalRecipients = Array.from(new Set(brokers.flatMap((broker) => internalNotificationRecipients(broker))));
    return sendJson(res, 200, {
      emailNotifications: Boolean(emailReady && internalRecipients.length > 0),
      brokerEmailRouting: Boolean(emailReady && brokers.some((broker) => broker.email)),
      clientConfirmationEmails: Boolean(emailReady && CLIENT_CONFIRMATION_EMAILS),
      emailFrom: process.env.SMTP_FROM || process.env.SMTP_USER || "",
      notifyEmail: NOTIFY_EMAIL || "",
      internalRecipients,
      clientReplyTo: process.env.CLIENT_REPLY_TO || NOTIFY_EMAIL || process.env.SMTP_USER || "",
      smtpHost: process.env.SMTP_HOST || "",
      missingEmailSettings: [
        !process.env.SMTP_HOST && "SMTP_HOST",
        !process.env.SMTP_USER && "SMTP_USER",
        !process.env.SMTP_PASS && "SMTP_PASS",
        !NOTIFY_EMAIL && "BOOKING_NOTIFY_EMAIL"
      ].filter(Boolean),
      googleDirectSync: Boolean(GOOGLE_CALENDAR_ID && (process.env.GOOGLE_SERVICE_ACCOUNT_JSON || (process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL && process.env.GOOGLE_PRIVATE_KEY))),
      icsSync: true
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
      status: "Pending",
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
      results.client = await sendClientConfirmationEmail(testBooking, broker);
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
      accessCode: body.accessCode || "",
      services: Array.isArray(body.services) ? body.services : ["First home buyer", "Refinance"],
      hours: body.hours || { start: "09:00", end: "17:00" }
    };
    const saved = await createBroker(next);
    return sendJson(res, 201, saved);
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
      const windowError = validatePublicBookingWindow(next);
      if (windowError) return sendJson(res, 400, { error: windowError });
    }
    const existingBookings = await listBookings();
    if (hasBookingConflict(next, existingBookings)) {
      return sendJson(res, 409, { error: "This time is already booked. Please choose another available slot." });
    }
    const saved = await createBooking(next);
    afterBookingSaved(saved, brokers, req).catch((error) => console.warn(error.message));
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
    const bytes = await fs.readFile(finalFile);
    res.writeHead(200, { "content-type": contentType(finalFile) });
    res.end(bytes);
  } catch {
    try {
      const bytes = await fs.readFile(path.join(DIST_DIR, "index.html"));
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(bytes);
    } catch {
      sendJson(res, 404, { error: "Build not found. Run npm run build first." });
    }
  }
}

await ensureData();

createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", requestOrigin(req));
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
