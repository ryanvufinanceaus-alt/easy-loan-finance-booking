import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Building2,
  Bell,
  CalendarDays,
  CalendarPlus,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock,
  Copy,
  Trash2,
  ExternalLink,
  Link2,
  Phone,
  Plus,
  Search,
  ShieldCheck,
  Sparkles,
  Users,
  Video
} from "lucide-react";
import "./App.css";

const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const STATUS = ["Confirmed", "Done", "Not done", "Cancelled"];
const CHANNELS = ["Phone call", "Video call", "Office"];
const DURATIONS = [30, 45, 60, 90];
const PUBLIC_BOOKING_DURATION = 30;
const PUBLIC_SERVICE_OPTIONS = [
  "Home loan consultation",
  "First home buyer strategy",
  "Refinance review",
  "Investment loan planning",
  "Borrowing capacity check"
];
const BOOKING_TIME_ZONE = "Australia/Adelaide";
const EAST_COAST_TIME_ZONE = "Australia/Sydney";
const BOOKING_TIME_LABEL = "Adelaide time";
const EAST_COAST_TIME_LABEL = "Sydney/Melbourne time is 30 minutes later";
const NOTIFICATION_SNAPSHOT_KEY = "elfBookingNotificationSnapshot";
const NOTIFICATION_ITEMS_KEY = "elfBookingNotifications";
const DISMISSED_FOLLOWUPS_KEY = "elfDismissedFollowups";

function addMinutes(date, minutes) {
  return new Date(date.getTime() + minutes * 60000);
}

function startOfDay(date) {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  return next;
}

function startOfWeek(date) {
  const next = startOfDay(date);
  const day = next.getDay() || 7;
  next.setDate(next.getDate() - day + 1);
  return next;
}

function startOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function sameDay(a, b) {
  return startOfDay(a).getTime() === startOfDay(b).getTime();
}

function dateKey(date) {
  return date.toISOString().slice(0, 10);
}

function displayMonth(date) {
  return new Intl.DateTimeFormat("en-AU", { month: "long", year: "numeric" }).format(date);
}

function displayDay(date) {
  return new Intl.DateTimeFormat("en-AU", {
    timeZone: BOOKING_TIME_ZONE,
    weekday: "short",
    day: "numeric",
    month: "short"
  }).format(date);
}

function displayTime(value) {
  return new Intl.DateTimeFormat("en-AU", {
    timeZone: BOOKING_TIME_ZONE,
    hour: "numeric",
    minute: "2-digit"
  }).format(new Date(value));
}

function displayEastCoastTime(value) {
  return new Intl.DateTimeFormat("en-AU", {
    timeZone: EAST_COAST_TIME_ZONE,
    hour: "numeric",
    minute: "2-digit"
  }).format(new Date(value));
}

function statusLabel(status) {
  if (status === "Completed") return "Done";
  if (status === "Undone") return "Not done";
  return status;
}

function statusClass(status) {
  return `status-${statusLabel(status).toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
}

function isFinalStatus(status) {
  return ["Done", "Completed", "Not done", "Undone", "Cancelled"].includes(status);
}

function bookingSignature(booking) {
  return [
    booking.clientName,
    booking.phone,
    booking.email,
    booking.brokerId,
    booking.service,
    booking.channel,
    booking.status,
    booking.start,
    booking.end,
    booking.notes
  ].map((value) => String(value || "")).join("|");
}

function notificationDetail(booking, broker) {
  return `${displayDay(new Date(booking.start))} at ${displayTime(booking.start)} - ${broker?.name || "Easy Loan Finance"}`;
}

function toLocalDateInput(value = new Date()) {
  const date = new Date(value);
  const offset = date.getTimezoneOffset();
  return new Date(date.getTime() - offset * 60000).toISOString().slice(0, 10);
}

function toLocalTimeInput(value = new Date()) {
  const date = new Date(value);
  const offset = date.getTimezoneOffset();
  return new Date(date.getTime() - offset * 60000).toISOString().slice(11, 16);
}

function nextBusinessDateInput(from = new Date()) {
  const date = startOfDay(from);
  if (date.getDay() === 6) date.setDate(date.getDate() + 2);
  else if (date.getDay() === 0) date.setDate(date.getDate() + 1);
  return toLocalDateInput(date);
}

function timeZoneOffsetMs(date, timeZone) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23"
  }).formatToParts(date);
  const get = (type) => Number(parts.find((part) => part.type === type)?.value || 0);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return asUtc - date.getTime();
}

function isoFor(dateValue, timeValue, timeZone = BOOKING_TIME_ZONE) {
  const [year, month, day] = dateValue.split("-").map(Number);
  const [hour, minute] = timeValue.split(":").map(Number);
  const targetUtc = Date.UTC(year, month - 1, day, hour, minute, 0);
  let result = new Date(targetUtc - timeZoneOffsetMs(new Date(targetUtc), timeZone));
  result = new Date(targetUtc - timeZoneOffsetMs(result, timeZone));
  return result.toISOString();
}

function googleDate(value) {
  return new Date(value).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function classNames(...values) {
  return values.filter(Boolean).join(" ");
}

function bookingTemplate(brokerId = "ryan-vu") {
  const start = new Date();
  start.setDate(start.getDate() + 1);
  start.setHours(9, 30, 0, 0);
  return {
    clientName: "",
    phone: "",
    email: "",
    brokerId,
    service: "Home loan consultation",
    channel: "Phone call",
    status: "Confirmed",
    startDate: nextBusinessDateInput(start),
    startTime: "09:30",
    duration: PUBLIC_BOOKING_DURATION,
    notes: ""
  };
}

function brokerTemplate() {
  return {
    name: "",
    title: "Finance Broker",
    location: "Adelaide, SA",
    email: "",
    phone: "",
    color: "#b89044",
    accessCode: "",
    services: "First home buyer, Refinance, Investment loan"
  };
}

function sortBrokersForUi(brokers) {
  return [...brokers].sort((a, b) => {
    if (a.id === "ryan-vu") return -1;
    if (b.id === "ryan-vu") return 1;
    return a.name.localeCompare(b.name);
  });
}

function brokerInitials(name = "") {
  const parts = String(name).trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "EL";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

function BrandMark() {
  return (
    <img className="brand-mark" src="/elf-logo.png" alt="Easy Loan Finance" width="52" height="52" />
  );
}

function App() {
  const publicPath = typeof window !== "undefined" ? window.location.pathname : "/";
  if (publicPath.startsWith("/book")) {
    return <PublicBookingPage />;
  }
  if (publicPath.startsWith("/login")) {
    return <LoginPage />;
  }

  const [brokers, setBrokers] = useState([]);
  const [bookings, setBookings] = useState([]);
  const [view, setView] = useState("month");
  const [anchor, setAnchor] = useState(new Date());
  const [brokerFilter, setBrokerFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [form, setForm] = useState(bookingTemplate());
  const [brokerForm, setBrokerForm] = useState(brokerTemplate());
  const [reassigningBroker, setReassigningBroker] = useState(null);
  const [selectedBooking, setSelectedBooking] = useState(null);
  const [copied, setCopied] = useState("");
  const [integrations, setIntegrations] = useState({ emailNotifications: false, clientConfirmationEmails: false, googleDirectSync: false, icsSync: true });
  const [auth, setAuth] = useState({ required: false, authenticated: false, email: null });
  const [lastSyncedAt, setLastSyncedAt] = useState(null);
  const [emailTestStatus, setEmailTestStatus] = useState("");
  const [notificationItems, setNotificationItems] = useState(() => {
    try {
      return JSON.parse(window.localStorage.getItem(NOTIFICATION_ITEMS_KEY) || "[]");
    } catch {
      return [];
    }
  });
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [loading, setLoading] = useState(true);

  function persistNotificationItems(items) {
    const next = items.slice(0, 30);
    setNotificationItems(next);
    window.localStorage.setItem(NOTIFICATION_ITEMS_KEY, JSON.stringify(next));
  }

  function persistBookingSnapshot(nextBookings) {
    const snapshot = Object.fromEntries(nextBookings.map((booking) => [booking.id, bookingSignature(booking)]));
    window.localStorage.setItem(NOTIFICATION_SNAPSHOT_KEY, JSON.stringify(snapshot));
  }

  function updateBookingNotifications(nextBookings, nextBrokers = brokers, { initial = false } = {}) {
    let previous = {};
    try {
      previous = JSON.parse(window.localStorage.getItem(NOTIFICATION_SNAPSHOT_KEY) || "{}");
    } catch {
      previous = {};
    }

    const hasPreviousSnapshot = Object.keys(previous).length > 0;
    const nextSnapshot = Object.fromEntries(nextBookings.map((booking) => [booking.id, bookingSignature(booking)]));
    window.localStorage.setItem(NOTIFICATION_SNAPSHOT_KEY, JSON.stringify(nextSnapshot));

    if (initial && !hasPreviousSnapshot) return;

    const brokerMap = Object.fromEntries(nextBrokers.map((broker) => [broker.id, broker]));
    const updates = nextBookings
      .filter((booking) => !previous[booking.id] || previous[booking.id] !== nextSnapshot[booking.id])
      .map((booking) => {
        const type = previous[booking.id] ? "changed" : "new";
        return {
          key: `${type}-${booking.id}-${nextSnapshot[booking.id]}`,
          bookingId: booking.id,
          type,
          title: type === "new" ? `New booking: ${booking.clientName}` : `Updated booking: ${booking.clientName}`,
          detail: notificationDetail(booking, brokerMap[booking.brokerId]),
          createdAt: new Date().toISOString()
        };
      });

    let dismissedFollowups = [];
    try {
      dismissedFollowups = JSON.parse(window.localStorage.getItem(DISMISSED_FOLLOWUPS_KEY) || "[]");
    } catch {
      dismissedFollowups = [];
    }
    const now = Date.now();
    const followups = nextBookings
      .filter((booking) => !isFinalStatus(booking.status))
      .filter((booking) => new Date(booking.end || booking.start).getTime() + 60 * 60 * 1000 <= now)
      .filter((booking) => !dismissedFollowups.includes(booking.id))
      .map((booking) => ({
        key: `followup-${booking.id}`,
        bookingId: booking.id,
        type: "followup",
        title: `Follow up: ${booking.clientName}`,
        detail: `Confirm whether this appointment is Done or Not done - ${notificationDetail(booking, brokerMap[booking.brokerId])}`,
        createdAt: new Date().toISOString()
      }));

    if (updates.length === 0 && followups.length === 0) return;
    let storedItems = notificationItems;
    try {
      storedItems = JSON.parse(window.localStorage.getItem(NOTIFICATION_ITEMS_KEY) || "[]");
    } catch {
      storedItems = [];
    }
    const merged = [...updates, ...followups, ...storedItems].filter((item, index, array) => (
      array.findIndex((candidate) => candidate.key === item.key) === index
    ));
    persistNotificationItems(merged);
  }

  useEffect(() => {
    Promise.all([
      fetch("/api/auth/status").then((res) => res.json()),
      fetch("/api/brokers").then((res) => res.json()),
      fetch("/api/bookings").then((res) => res.json()),
      fetch("/api/integrations").then((res) => res.json())
    ])
      .then(([authData, brokerData, bookingData, integrationData]) => {
        if (authData.required && !authData.authenticated) {
          window.location.href = "/login";
          return;
        }
        const sortedBrokers = sortBrokersForUi(brokerData);
        setAuth(authData);
        setBrokers(sortedBrokers);
        setBookings(bookingData);
        updateBookingNotifications(bookingData, sortedBrokers, { initial: true });
        setIntegrations(integrationData);
        setLastSyncedAt(new Date());
        if (authData.role === "broker" && authData.brokerId) {
          setBrokerFilter(authData.brokerId);
          setForm(bookingTemplate(authData.brokerId));
        } else {
          setForm(bookingTemplate(sortedBrokers[0]?.id));
        }
      })
      .finally(() => setLoading(false));
  }, []);

  async function refreshBookings({ quiet = false } = {}) {
    const res = await fetch("/api/bookings");
    if (!res.ok) return;
    const data = await res.json();
    updateBookingNotifications(data, brokers);
    setBookings(data);
    setLastSyncedAt(new Date());
    if (!quiet) {
      setSelectedBooking((current) => current ? data.find((booking) => booking.id === current.id) || current : current);
    }
  }

  useEffect(() => {
    const tick = () => {
      if (document.visibilityState === "visible") refreshBookings({ quiet: true });
    };
    const timer = window.setInterval(tick, 8000);
    window.addEventListener("focus", tick);
    document.addEventListener("visibilitychange", tick);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", tick);
      document.removeEventListener("visibilitychange", tick);
    };
  }, []);

  const brokerById = useMemo(
    () => Object.fromEntries(brokers.map((broker) => [broker.id, broker])),
    [brokers]
  );

  const visibleBookings = useMemo(() => {
    const cleanQuery = query.trim().toLowerCase();
    return bookings
      .filter((booking) => brokerFilter === "all" || booking.brokerId === brokerFilter)
      .filter((booking) => {
        if (!cleanQuery) return true;
        return [booking.clientName, booking.phone, booking.email, booking.service, booking.notes]
          .filter(Boolean)
          .some((value) => value.toLowerCase().includes(cleanQuery));
      })
      .sort((a, b) => new Date(a.start) - new Date(b.start));
  }, [bookings, brokerFilter, query]);

  const metrics = useMemo(() => {
    const today = startOfDay(new Date());
    const weekEnd = new Date(today);
    weekEnd.setDate(today.getDate() + 7);
    return {
      week: bookings.filter((booking) => {
        const start = new Date(booking.start);
        return start >= today && start <= weekEnd;
      }).length,
      pending: bookings.filter((booking) => booking.status === "Pending").length,
      confirmed: bookings.filter((booking) => booking.status === "Confirmed").length,
      needsReview: bookings.filter((booking) => (
        booking.status === "Confirmed" && new Date(booking.end || booking.start).getTime() + 60 * 60 * 1000 <= Date.now()
      )).length
    };
  }, [bookings]);

  const activeBroker = brokerFilter === "all" ? brokers[0] : brokerById[brokerFilter];
  const isAdmin = auth.role === "admin" || !auth.required;
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const teamIcsUrl = `${origin}/calendar/team.ics`;
  const brokerIcsUrl = `${origin}/calendar/broker/${activeBroker?.id || "ryan-vu"}.ics`;
  const teamBookingUrl = `${origin}/book`;
  const brokerBookingUrl = `${origin}/book/${activeBroker?.id || "ryan-vu"}`;

  function step(direction) {
    const next = new Date(anchor);
    if (view === "month") next.setMonth(next.getMonth() + direction);
    if (view === "week") next.setDate(next.getDate() + direction * 7);
    if (view === "day") next.setDate(next.getDate() + direction);
    setAnchor(next);
  }

  function createGoogleLink(booking) {
    const broker = brokerById[booking.brokerId];
    const text = `${booking.clientName} - ${booking.service}`;
    const details = [
      `Broker: ${broker?.name || "Easy Loan Finance"}`,
      `Status: ${booking.status}`,
      `Channel: ${booking.channel}`,
      booking.phone ? `Phone: ${booking.phone}` : "",
      booking.email ? `Email: ${booking.email}` : "",
      booking.notes ? `Notes: ${booking.notes}` : ""
    ].filter(Boolean).join("\n");
    const url = new URL("https://calendar.google.com/calendar/render");
    url.searchParams.set("action", "TEMPLATE");
    url.searchParams.set("text", text);
    url.searchParams.set("dates", `${googleDate(booking.start)}/${googleDate(booking.end)}`);
    url.searchParams.set("details", details);
    url.searchParams.set("location", booking.channel);
    return url.toString();
  }

  async function copyText(text, key) {
    await navigator.clipboard.writeText(text);
    setCopied(key);
    window.setTimeout(() => setCopied(""), 1500);
  }

  async function submitBooking(event) {
    event.preventDefault();
    const start = isoFor(form.startDate, form.startTime);
    const end = addMinutes(new Date(start), PUBLIC_BOOKING_DURATION).toISOString();
    const payload = {
      clientName: form.clientName.trim() || "New client",
      phone: form.phone.trim(),
      email: form.email.trim(),
      brokerId: form.brokerId,
      service: form.service,
      channel: form.channel,
      status: form.status,
      start,
      end,
      notes: form.notes.trim()
    };

    const saved = await fetch("/api/bookings", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload)
    }).then((res) => res.json());

    setBookings((current) => {
      const next = [...current, saved];
      persistBookingSnapshot(next);
      return next;
    });
    setSelectedBooking(saved);
    setForm(bookingTemplate(form.brokerId));
  }

  async function updateStatus(booking, status) {
    const saved = await fetch(`/api/bookings/${booking.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status })
    }).then((res) => res.json());
    setBookings((current) => {
      const next = current.map((item) => (item.id === saved.id ? saved : item));
      persistBookingSnapshot(next);
      return next;
    });
    persistNotificationItems(notificationItems.filter((item) => item.bookingId !== saved.id));
    setSelectedBooking(saved);
  }

  async function sendEmailTest() {
    setEmailTestStatus("Sending test...");
    const res = await fetch("/api/email-test", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ clientEmail: integrations.notifyEmail })
    });
    const data = await res.json();
    if (!res.ok) {
      setEmailTestStatus(data.error || "Email test failed");
      return;
    }
    const recipients = data.internalRecipients?.length ? ` to ${data.internalRecipients.join(", ")}` : "";
    setEmailTestStatus(`Test email sent${recipients}`);
  }

  function clearNotifications() {
    const followupIds = notificationItems.filter((item) => item.type === "followup").map((item) => item.bookingId);
    if (followupIds.length > 0) {
      let dismissed = [];
      try {
        dismissed = JSON.parse(window.localStorage.getItem(DISMISSED_FOLLOWUPS_KEY) || "[]");
      } catch {
        dismissed = [];
      }
      window.localStorage.setItem(DISMISSED_FOLLOWUPS_KEY, JSON.stringify(Array.from(new Set([...dismissed, ...followupIds]))));
    }
    persistNotificationItems([]);
    setNotificationsOpen(false);
  }

  function openNotification(item) {
    const booking = bookings.find((entry) => entry.id === item.bookingId);
    if (booking) setSelectedBooking(booking);
    if (item.type === "followup") {
      let dismissed = [];
      try {
        dismissed = JSON.parse(window.localStorage.getItem(DISMISSED_FOLLOWUPS_KEY) || "[]");
      } catch {
        dismissed = [];
      }
      window.localStorage.setItem(DISMISSED_FOLLOWUPS_KEY, JSON.stringify(Array.from(new Set([...dismissed, item.bookingId]))));
    }
    const remaining = notificationItems.filter((entry) => entry.key !== item.key);
    persistNotificationItems(remaining);
    setNotificationsOpen(false);
  }

  async function deleteSelectedBooking(booking) {
    const ok = window.confirm(`Delete booking for ${booking.clientName}? This cannot be undone.`);
    if (!ok) return;
    await fetch(`/api/bookings/${booking.id}`, { method: "DELETE" });
    setBookings((current) => {
      const next = current.filter((item) => item.id !== booking.id);
      persistBookingSnapshot(next);
      return next;
    });
    setSelectedBooking(null);
  }

  async function createBrokerFromForm(event) {
    event.preventDefault();
    const payload = {
      ...brokerForm,
      services: brokerForm.services.split(",").map((service) => service.trim()).filter(Boolean)
    };
    try {
      const saved = await fetch("/api/brokers", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload)
      }).then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Could not create broker");
        return data;
      });
      setBrokers((current) => [...current, saved]);
      setBrokerFilter(saved.id);
      setForm((current) => ({ ...current, brokerId: saved.id }));
      setBrokerForm(brokerTemplate());
    } catch (error) {
      window.alert(error.message || "Could not create broker");
    }
  }

  async function removeBroker(broker, reassignTo = "") {
    const query = reassignTo ? `?reassignTo=${encodeURIComponent(reassignTo)}` : "";
    const res = await fetch(`/api/brokers/${broker.id}${query}`, { method: "DELETE" });
    const data = await res.json();
    if (!res.ok) {
      if (res.status === 409) {
        setReassigningBroker(broker);
        return;
      }
      window.alert(data.error || "Could not delete broker");
      return;
    }
    const remaining = brokers.filter((item) => item.id !== broker.id);
    setBrokers(remaining);
    if (reassignTo) {
      setBookings((current) => current.map((booking) => (
        booking.brokerId === broker.id ? { ...booking, brokerId: reassignTo } : booking
      )));
    }
    if (brokerFilter === broker.id) setBrokerFilter("all");
    if (form.brokerId === broker.id) setForm((current) => ({ ...current, brokerId: remaining[0]?.id || "ryan-vu" }));
    setReassigningBroker(null);
  }

  async function updateBrokerAccessCode(broker) {
    const accessCode = window.prompt(`Set access code for ${broker.name}`);
    if (accessCode === null) return;
    const saved = await fetch(`/api/brokers/${broker.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ accessCode })
    }).then(async (res) => {
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not update broker access code");
      return data;
    });
    setBrokers((current) => current.map((item) => item.id === saved.id ? saved : item));
  }

  async function updateBrokerColor(broker, color) {
    const saved = await fetch(`/api/brokers/${broker.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ color })
    }).then(async (res) => {
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not update broker colour");
      return data;
    });
    setBrokers((current) => sortBrokersForUi(current.map((item) => item.id === saved.id ? saved : item)));
  }

  const renderedCalendar = view === "month"
    ? <MonthView anchor={anchor} bookings={visibleBookings} brokerById={brokerById} onSelect={setSelectedBooking} />
    : <AgendaView mode={view} anchor={anchor} bookings={visibleBookings} brokerById={brokerById} onSelect={setSelectedBooking} />;

  return (
    <main className="app-shell">
      <aside className="side-panel">
        <div className="brand-block">
          <BrandMark />
          <div>
            <p className="eyebrow">Easy Loan Finance</p>
            <h1>Broker Booking</h1>
          </div>
        </div>

        <div className="admin-identity">
          <ShieldCheck size={16} />
          <span>{auth.required ? `${auth.role === "broker" ? "Broker" : "Ryan admin"} - ${auth.email || ""}` : "Local admin mode"}</span>
          {auth.required && <button onClick={() => fetch("/api/auth/logout", { method: "POST" }).then(() => { window.location.href = "/login"; })}>Logout</button>}
        </div>

        <div className="metric-grid">
          <Metric icon={CalendarDays} label="Next 7 days" value={metrics.week} />
          <Metric icon={ShieldCheck} label="Confirmed" value={metrics.confirmed} />
          <Metric icon={Clock} label="Needs review" value={metrics.needsReview} />
          <Metric icon={Users} label="Brokers" value={brokers.length} />
        </div>

        <section className="panel broker-panel">
          <div className="section-title">
            <Users size={18} />
            <h2>Broker Desk</h2>
          </div>
          {isAdmin && (
            <button
              className={classNames("broker-row", brokerFilter === "all" && "active")}
              onClick={() => setBrokerFilter("all")}
            >
              <span className="broker-dot team-dot" />
              <span>
                <strong>All brokers</strong>
                <small>Team calendar</small>
              </span>
            </button>
          )}
          {brokers.map((broker) => (
            <button
              key={broker.id}
              className={classNames("broker-row", brokerFilter === broker.id && "active")}
              onClick={() => setBrokerFilter(broker.id)}
            >
              <span className="broker-dot" style={{ background: broker.color }} />
              <span>
                <strong>{broker.name}</strong>
                <small>{broker.location} · {bookings.filter((booking) => booking.brokerId === broker.id).length} bookings</small>
              </span>
            </button>
          ))}
        </section>

        {isAdmin && <section className="panel sync-panel">
          <div className="section-title">
            <Link2 size={18} />
            <h2>Google Sync</h2>
          </div>
          <SyncRow label="Team ICS" value={teamIcsUrl} copied={copied === "team"} onCopy={() => copyText(teamIcsUrl, "team")} />
          <SyncRow label="Broker ICS" value={brokerIcsUrl} copied={copied === "broker"} onCopy={() => copyText(brokerIcsUrl, "broker")} />
          <p className="sync-note">Use the ICS URL after deployment to subscribe in Google Calendar and view it on mobile.</p>
        </section>}

        <section className="panel client-link-panel">
          <div className="section-title">
            <CalendarPlus size={18} />
            <h2>Client Booking Link</h2>
          </div>
          <SyncRow label="Team booking" value={teamBookingUrl} copied={copied === "book-team"} onCopy={() => copyText(teamBookingUrl, "book-team")} />
          <SyncRow label="Broker booking" value={brokerBookingUrl} copied={copied === "book-broker"} onCopy={() => copyText(brokerBookingUrl, "book-broker")} />
          <a className="public-link-preview" href={brokerBookingUrl} target="_blank" rel="noreferrer">
            <ExternalLink size={15} />
            Preview client page
          </a>
        </section>

        {isAdmin && <section className="panel alerts-panel">
          <div className="section-title">
            <ShieldCheck size={18} />
            <h2>Alerts & Sync</h2>
          </div>
          <IntegrationFlag label="Email alerts" active={integrations.emailNotifications} />
          <IntegrationFlag label="Broker email routing" active={integrations.brokerEmailRouting} />
          <IntegrationFlag label="Client confirmation" active={integrations.clientConfirmationEmails} />
          <IntegrationFlag label="Google direct sync" active={integrations.googleDirectSync} />
          <IntegrationFlag label="ICS calendar feed" active={integrations.icsSync} />
          <button className="secondary-button full-width" onClick={sendEmailTest}>Send Test Email</button>
          {emailTestStatus && <p className="integration-note">{emailTestStatus}</p>}
          {integrations.missingEmailSettings?.length > 0 && (
            <p className="integration-note danger-text">Missing: {integrations.missingEmailSettings.join(", ")}</p>
          )}
        </section>}
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div>
            <p className="eyebrow">Australia broker operations</p>
            <h2>{displayMonth(anchor)}</h2>
          </div>
          <div className="toolbar">
            <div className="search-wrap">
              <Search size={16} />
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search client, service, phone" />
            </div>
            <button className="icon-button" onClick={() => step(-1)} aria-label="Previous">
              <ChevronLeft size={18} />
            </button>
            <button className="today-button" onClick={() => setAnchor(new Date())}>Today</button>
            <button className="icon-button" onClick={() => step(1)} aria-label="Next">
              <ChevronRight size={18} />
            </button>
            <div className="segment">
              {["month", "week", "day"].map((item) => (
                <button key={item} className={view === item ? "active" : ""} onClick={() => setView(item)}>
                  {item}
                </button>
              ))}
            </div>
            <NotificationButton
              items={notificationItems}
              open={notificationsOpen}
              onToggle={() => setNotificationsOpen((value) => !value)}
              onOpen={openNotification}
              onClear={clearNotifications}
            />
            <a className="client-page-button" href={brokerBookingUrl} target="_blank" rel="noreferrer">
              <ExternalLink size={16} />
              Client page
            </a>
          </div>
          {lastSyncedAt && <p className="sync-stamp">Live refresh · {displayTime(lastSyncedAt)}</p>}
        </header>

        <div className="main-grid">
          <section className="calendar-panel">
            {loading ? <div className="loading">Loading Easy Loan Finance calendar...</div> : renderedCalendar}
          </section>

          {isAdmin ? <aside className="booking-panel admin-control-panel">
            <div className="admin-control-head">
              <div>
                <p className="eyebrow">Control Centre</p>
                <h2>Dashboard tools</h2>
              </div>
              <span>Full access</span>
            </div>

            <details className="control-details appointment-details">
              <summary>
                <span><CalendarPlus size={18} /> New Appointment</span>
                <small>Add a booking manually</small>
              </summary>
            <form onSubmit={submitBooking} className="booking-form">
              <label>
                Client name
                <input value={form.clientName} onChange={(event) => setForm({ ...form, clientName: event.target.value })} placeholder="Client full name" />
              </label>
              <div className="two-col">
                <label>
                  Phone
                  <input value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} placeholder="04..." />
                </label>
                <label>
                  Email
                  <input value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} placeholder="client@email.com" />
                </label>
              </div>
              <label>
                Broker
                <select value={form.brokerId} onChange={(event) => setForm({ ...form, brokerId: event.target.value })}>
                  {brokers.map((broker) => <option key={broker.id} value={broker.id}>{broker.name}</option>)}
                </select>
              </label>
              <label>
                Service
                <input value={form.service} onChange={(event) => setForm({ ...form, service: event.target.value })} placeholder="Refinance, first home buyer..." />
              </label>
              <div className="two-col">
                <label>
                  Date
                  <input type="date" value={form.startDate} onChange={(event) => setForm({ ...form, startDate: event.target.value })} />
                </label>
                <label>
                  Time ({BOOKING_TIME_LABEL})
                  <input type="time" value={form.startTime} onChange={(event) => setForm({ ...form, startTime: event.target.value })} />
                </label>
              </div>
              <div className="two-col">
                <label>
                  Duration
                  <select value={form.duration} onChange={(event) => setForm({ ...form, duration: event.target.value })}>
                    {DURATIONS.map((duration) => <option key={duration} value={duration}>{duration} min</option>)}
                  </select>
                </label>
                <label>
                  Status
                  <select value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value })}>
                    {STATUS.map((status) => <option key={status} value={status}>{status}</option>)}
                  </select>
                </label>
              </div>
              <div className="channel-row">
                {CHANNELS.map((channel) => (
                  <button
                    type="button"
                    key={channel}
                    className={form.channel === channel ? "active" : ""}
                    onClick={() => setForm({ ...form, channel })}
                  >
                    {channel === "Phone call" && <Phone size={15} />}
                    {channel === "Video call" && <Video size={15} />}
                    {channel === "Office" && <Building2 size={15} />}
                    {channel}
                  </button>
                ))}
              </div>
              <label>
                Notes
                <textarea value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} placeholder="Documents, goals, next action" />
              </label>
              <button className="primary-button" type="submit">
                <Plus size={18} />
                Book Appointment
              </button>
            </form>
            </details>

            <details className="control-details">
              <summary>
                <span><ShieldCheck size={18} /> Ryan Admin</span>
                <small>Manage brokers, access codes, and reassignment</small>
              </summary>
              <BrokerManager
                brokers={brokers}
                bookings={bookings}
                brokerForm={brokerForm}
                setBrokerForm={setBrokerForm}
                onCreate={createBrokerFromForm}
                onRemove={removeBroker}
                onUpdateAccessCode={updateBrokerAccessCode}
                onUpdateColor={updateBrokerColor}
                onFocusBroker={setBrokerFilter}
                reassigningBroker={reassigningBroker}
                onCancelReassign={() => setReassigningBroker(null)}
              />
            </details>

          </aside> : (
            <aside className="booking-panel read-only-panel">
              <div className="section-title">
                <ShieldCheck size={18} />
                <h2>Broker View</h2>
              </div>
              <p className="sync-note light">
                You can view your own Easy Loan Finance calendar here. Ryan admin manages broker access, status changes, reassignment, and deletions.
              </p>
              <a className="client-page-button full-width" href={brokerBookingUrl} target="_blank" rel="noreferrer">
                <ExternalLink size={16} />
                Open Your Client Link
              </a>
            </aside>
          )}
        </div>
      </section>

      {selectedBooking && (
        <BookingDrawer
          booking={selectedBooking}
          broker={brokerById[selectedBooking.brokerId]}
          googleUrl={createGoogleLink(selectedBooking)}
          copied={copied === selectedBooking.id}
          onCopy={() => copyText(createGoogleLink(selectedBooking), selectedBooking.id)}
          onClose={() => setSelectedBooking(null)}
          onStatus={isAdmin ? (status) => updateStatus(selectedBooking, status) : null}
          onDelete={isAdmin ? () => deleteSelectedBooking(selectedBooking) : null}
        />
      )}
    </main>
  );
}

function NotificationButton({ items, open, onToggle, onOpen, onClear }) {
  return (
    <div className="notification-wrap">
      <button className="notification-button" type="button" onClick={onToggle} aria-label="Booking notifications">
        <Bell size={18} />
        {items.length > 0 && <span>{items.length > 9 ? "9+" : items.length}</span>}
      </button>
      {open && (
        <div className="notification-menu">
          <div className="notification-head">
            <strong>Booking updates</strong>
            {items.length > 0 && <button type="button" onClick={onClear}>Clear</button>}
          </div>
          {items.length === 0 ? (
            <p className="notification-empty">No new booking updates.</p>
          ) : (
            <div className="notification-list">
              {items.map((item) => (
                <button type="button" key={item.key} onClick={() => onOpen(item)}>
                  <span>{item.type === "followup" ? "Reminder" : item.type === "new" ? "New" : "Changed"}</span>
                  <strong>{item.title}</strong>
                  <small>{item.detail}</small>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function IntegrationFlag({ label, active }) {
  return (
    <div className="integration-flag">
      <span className={active ? "active" : ""}>{active ? <Check size={14} /> : <Clock size={14} />}</span>
      <strong>{label}</strong>
      <small>{active ? "On" : "Needs setup"}</small>
    </div>
  );
}

function LoginPage() {
  const [email, setEmail] = useState("ryan.vufinanceaus@gmail.com");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetch("/api/auth/status")
      .then((res) => res.json())
      .then((status) => {
        if (!status.required || status.authenticated) {
          window.location.href = "/";
        }
      });
  }, []);

  async function submitLogin(event) {
    event.preventDefault();
    setLoading(true);
    setError("");
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password })
    });
    const data = await res.json();
    setLoading(false);
    if (!res.ok) {
      setError(data.error || "Could not login");
      return;
    }
    window.location.href = "/";
  }

  return (
    <main className="login-page">
      <section className="login-card">
          <div className="brand-block">
          <BrandMark />
          <div>
            <p className="eyebrow">Easy Loan Finance</p>
            <h1>Ryan Admin</h1>
          </div>
        </div>
        <form onSubmit={submitLogin} className="booking-form">
          <label>
            Email
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="ryan.vufinanceaus@gmail.com"
            />
          </label>
          <label>
            Password or broker access code
            <input
              autoFocus
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="Enter dashboard password"
            />
          </label>
          {error && <p className="login-error">{error}</p>}
          <button className="primary-button" type="submit" disabled={loading}>
            <ShieldCheck size={17} />
            {loading ? "Checking..." : "Login"}
          </button>
        </form>
      </section>
    </main>
  );
}

function BrokerManager({ brokers, bookings, brokerForm, setBrokerForm, onCreate, onRemove, onUpdateAccessCode, onUpdateColor, onFocusBroker, reassigningBroker, onCancelReassign }) {
  const reassignOptions = brokers.filter((broker) => broker.id !== reassigningBroker?.id);
  const [targetBroker, setTargetBroker] = useState("");

  useEffect(() => {
    setTargetBroker(reassignOptions[0]?.id || "");
  }, [reassigningBroker?.id, reassignOptions[0]?.id]);

  return (
    <section className="admin-panel">
      <div className="section-title">
        <Users size={18} />
        <h2>Broker Management</h2>
      </div>
      <form className="broker-admin-form" onSubmit={onCreate}>
        <label>
          Broker name
          <input required value={brokerForm.name} onChange={(event) => setBrokerForm({ ...brokerForm, name: event.target.value })} placeholder="New broker name" />
        </label>
        <div className="two-col">
          <label>
            Title
            <input value={brokerForm.title} onChange={(event) => setBrokerForm({ ...brokerForm, title: event.target.value })} />
          </label>
          <label>
            Location
            <input value={brokerForm.location} onChange={(event) => setBrokerForm({ ...brokerForm, location: event.target.value })} />
          </label>
        </div>
        <div className="two-col">
          <label>
            Email
            <input type="email" value={brokerForm.email} onChange={(event) => setBrokerForm({ ...brokerForm, email: event.target.value })} placeholder="broker@easyloanfinance.com.au" />
          </label>
          <label>
            Phone
            <input value={brokerForm.phone} onChange={(event) => setBrokerForm({ ...brokerForm, phone: event.target.value })} placeholder="04..." />
          </label>
        </div>
        <label>
          Broker access code
          <input value={brokerForm.accessCode} onChange={(event) => setBrokerForm({ ...brokerForm, accessCode: event.target.value })} placeholder="Set a private login code" />
          <small className="field-help">Private code for this broker to log in with their email. Ryan admin still uses the main admin password.</small>
        </label>
        <label>
          Services
          <input value={brokerForm.services} onChange={(event) => setBrokerForm({ ...brokerForm, services: event.target.value })} placeholder="First home buyer, Refinance" />
        </label>
        <label>
          Colour
          <input type="color" value={brokerForm.color} onChange={(event) => setBrokerForm({ ...brokerForm, color: event.target.value })} />
        </label>
        <button className="secondary-button" type="submit">
          <Plus size={17} />
          Add Broker
        </button>
      </form>

      <div className="broker-admin-list">
        {brokers.map((broker) => {
          const count = bookings.filter((booking) => booking.brokerId === broker.id).length;
          return (
            <div className="broker-admin-row" key={broker.id}>
              <span className="broker-dot" style={{ background: broker.color }} />
              <button type="button" onClick={() => onFocusBroker(broker.id)}>
                <strong>{broker.name}</strong>
                <small>{count} booking{count === 1 ? "" : "s"} · {broker.accessCode ? "login ready" : "no access code"}</small>
              </button>
              <input
                className="broker-color-input"
                type="color"
                value={broker.color || "#b89044"}
                onChange={(event) => onUpdateColor(broker, event.target.value)}
                title={`Change ${broker.name} calendar colour`}
                aria-label={`Change ${broker.name} calendar colour`}
              />
              <button className="mini-action" type="button" onClick={() => onUpdateAccessCode(broker)}>
                Code
              </button>
              <button className="icon-button small danger" onClick={() => onRemove(broker)} aria-label={`Delete ${broker.name}`}>
                <Trash2 size={15} />
              </button>
            </div>
          );
        })}
      </div>

      {reassigningBroker && (
        <div className="reassign-box">
          <strong>Move bookings before removing {reassigningBroker.name}</strong>
          <small>
            This broker has {bookings.filter((booking) => booking.brokerId === reassigningBroker.id).length} booking(s). Choose who receives them.
          </small>
          <select value={targetBroker} onChange={(event) => setTargetBroker(event.target.value)} required>
            {reassignOptions.map((broker) => (
              <option key={broker.id} value={broker.id}>{broker.name}</option>
            ))}
          </select>
          <div className="reassign-actions">
            <button className="danger-button" type="button" disabled={!targetBroker} onClick={() => onRemove(reassigningBroker, targetBroker)}>
              <Trash2 size={16} />
              Move & Remove
            </button>
            <button className="secondary-button" type="button" onClick={onCancelReassign}>Cancel</button>
          </div>
        </div>
      )}
    </section>
  );
}

function PublicBookingPage() {
  const brokerIdFromPath = typeof window !== "undefined" ? window.location.pathname.split("/book/")[1] : "";
  const [brokers, setBrokers] = useState([]);
  const [form, setForm] = useState(bookingTemplate(brokerIdFromPath || "ryan-vu"));
  const [submitted, setSubmitted] = useState(null);
  const [availability, setAvailability] = useState({ slots: [] });
  const [availabilityLoading, setAvailabilityLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/brokers")
      .then((res) => res.json())
      .then((data) => {
        const sorted = sortBrokersForUi(data);
        setBrokers(sorted);
        const requested = sorted.find((broker) => broker.id === brokerIdFromPath);
        setForm((current) => ({
          ...current,
          brokerId: requested?.id || sorted[0]?.id || current.brokerId || "ryan-vu",
          status: "Confirmed",
          channel: "Phone call",
          service: "Home loan consultation",
          duration: PUBLIC_BOOKING_DURATION,
          startDate: nextBusinessDateInput(),
          startTime: "09:30"
        }));
      })
      .finally(() => setLoading(false));
  }, [brokerIdFromPath]);

  const selectedBroker = brokers.find((broker) => broker.id === form.brokerId) || brokers[0];
  const selectedSlot = availability.slots.find((slot) => slot.time === form.startTime && slot.available);

  useEffect(() => {
    if (!form.brokerId || !form.startDate) return;
    const controller = new AbortController();
    setAvailabilityLoading(true);
    fetch(`/api/availability?brokerId=${encodeURIComponent(form.brokerId)}&date=${encodeURIComponent(form.startDate)}&duration=${encodeURIComponent(form.duration)}`, {
      signal: controller.signal
    })
      .then((res) => res.json())
      .then((data) => {
        setAvailability(data);
        const currentStillOpen = data.slots?.some((slot) => slot.time === form.startTime && slot.available);
        if (!currentStillOpen) {
          const firstOpen = data.slots?.find((slot) => slot.available);
          setForm((current) => ({ ...current, startTime: firstOpen?.time || "" }));
        }
      })
      .catch((error) => {
        if (error.name !== "AbortError") setAvailability({ slots: [] });
      })
      .finally(() => setAvailabilityLoading(false));
    return () => controller.abort();
  }, [form.brokerId, form.startDate, form.duration]);

  async function submitPublicBooking(event) {
    event.preventDefault();
    if (!selectedSlot) {
      setSubmitError("Please choose an available time.");
      return;
    }
    setSubmitting(true);
    setSubmitError("");
    const start = isoFor(form.startDate, form.startTime);
    const end = addMinutes(new Date(start), Number(form.duration)).toISOString();
    const payload = {
      clientName: form.clientName.trim() || "New client",
      phone: form.phone.trim(),
      email: form.email.trim(),
      brokerId: form.brokerId,
      service: form.service,
      channel: form.channel,
      status: "Confirmed",
      start,
      end,
      notes: form.notes.trim()
    };

    const res = await fetch("/api/bookings", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload)
    });
    const saved = await res.json();
    setSubmitting(false);
    if (!res.ok) {
      setSubmitError(saved.error || "This time is no longer available. Please choose another slot.");
      const refreshed = await fetch(`/api/availability?brokerId=${encodeURIComponent(form.brokerId)}&date=${encodeURIComponent(form.startDate)}&duration=${encodeURIComponent(form.duration)}`).then((response) => response.json());
      setAvailability(refreshed);
      return;
    }

    setSubmitted(saved);
  }

  if (submitted) {
    return (
      <main className="public-page">
        <section className="public-success">
          <BrandMark />
          <div className="drawer-kicker">
            <Check size={16} />
            Booking confirmed
          </div>
          <h1>Thanks, {submitted.clientName}</h1>
          <p>Your Easy Loan Finance appointment is confirmed. We have sent the details to your email.</p>
          <div className="success-details">
            <span><Clock size={16} /> {displayDay(new Date(submitted.start))}, {displayTime(submitted.start)} {BOOKING_TIME_LABEL}</span>
            <span><Clock size={16} /> {displayEastCoastTime(submitted.start)} Sydney/Melbourne time</span>
            <span><Users size={16} /> {selectedBroker?.name || "Easy Loan Finance"}</span>
            <span><Phone size={16} /> {submitted.channel}</span>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="public-page">
      <section className="public-hero">
        <div className="public-brand-lockup">
          <BrandMark />
          <div>
            <strong>Easy Loan Finance</strong>
            <span>Quick Loan, Easy Life</span>
          </div>
        </div>
        <h1>Home loan consultation</h1>
        <div className="consultation-panel" aria-label="Consultation summary">
          <div className="consultation-panel-head">
            <div>
              <span>Free consultation</span>
              <strong>Home loan consultation - 30 mins</strong>
            </div>
          </div>
          <div className="consultation-points">
            <span>Borrowing capacity</span>
            <span>Refinance options</span>
            <span>Next steps</span>
          </div>
        </div>
        <p className="public-copy">
          Speak with an Easy Loan Finance broker for Australia-wide support with borrowing capacity, refinance options, or your next property move.
        </p>
        <div className="public-trust-row">
          <span><ShieldCheck size={16} /> Free consultation</span>
          <span><Clock size={16} /> 30 minutes</span>
          <span><Users size={16} /> No obligation</span>
        </div>
      </section>

      <section className="public-form-panel">
        <div className="section-title">
          <CalendarPlus size={18} />
          <h2>Book Your Appointment</h2>
        </div>
        {loading ? (
          <div className="loading">Loading booking page...</div>
        ) : (
          <form onSubmit={submitPublicBooking} className="booking-form">
            <div className="service-summary">
              <div>
                <span>Recommended</span>
                <strong>Home loan consultation - 30 mins ⭐</strong>
                <small>Free consultation with an Easy Loan Finance broker.</small>
              </div>
            </div>
            <label>
              Your name
              <input required value={form.clientName} onChange={(event) => setForm({ ...form, clientName: event.target.value })} placeholder="Full name" />
            </label>
            <div className="two-col">
              <label>
                Phone
                <input required value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} placeholder="04..." />
              </label>
              <label>
                Email
                <input required type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} placeholder="name@email.com" />
              </label>
            </div>
            <label>
              Preferred broker
              <select value={form.brokerId} onChange={(event) => setForm({ ...form, brokerId: event.target.value })}>
                {brokers.map((broker) => <option key={broker.id} value={broker.id}>{broker.name}</option>)}
              </select>
            </label>
            <label>
              Consultation type
              <select value={form.service} onChange={(event) => setForm({ ...form, service: event.target.value })}>
                {PUBLIC_SERVICE_OPTIONS.map((service) => (
                  <option key={service} value={service}>{service}</option>
                ))}
              </select>
            </label>
            <div className="two-col">
              <label>
                Preferred date ({BOOKING_TIME_LABEL})
                <input required type="date" value={form.startDate} onChange={(event) => setForm({ ...form, startDate: event.target.value })} />
              </label>
              <div className="fixed-duration">
                <span>Duration</span>
                <strong>30 min</strong>
              </div>
            </div>
            <TimeSlotPicker
              slots={availability.slots}
              value={form.startTime}
              loading={availabilityLoading}
              timeLabel={BOOKING_TIME_LABEL}
              eastCoastLabel={EAST_COAST_TIME_LABEL}
              onChange={(time) => setForm({ ...form, startTime: time })}
            />
            <label>
              Meeting style
              <select value={form.channel} onChange={(event) => setForm({ ...form, channel: event.target.value })}>
                {CHANNELS.map((channel) => <option key={channel} value={channel}>{channel}</option>)}
              </select>
            </label>
            <label>
              Notes
              <textarea value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} placeholder="Loan purpose, suburb, timeframe, preferred language" />
            </label>
            {submitError && <p className="login-error">{submitError}</p>}
            <button className="primary-button" type="submit" disabled={submitting || !selectedSlot}>
              <CalendarPlus size={18} />
              {submitting ? "Confirming booking..." : "Confirm Booking"}
            </button>
          </form>
        )}
      </section>
    </main>
  );
}

function TimeSlotPicker({ slots, value, loading, onChange, timeLabel, eastCoastLabel }) {
  return (
    <div className="slot-picker">
      <div className="slot-heading">
        <span>Preferred time ({timeLabel})</span>
        <small>{loading ? "Checking..." : "Mon-Fri, 9:30 AM-5:00 PM"}</small>
      </div>
      <p className="time-zone-note">{eastCoastLabel}</p>
      <div className="slot-grid">
        {slots.length === 0 && <div className="empty-slot">No slots available for this date</div>}
        {slots.map((slot) => (
          <button
            key={slot.time}
            type="button"
            disabled={!slot.available}
            className={classNames("time-slot", !slot.available && "booked", value === slot.time && slot.available && "selected")}
            onClick={() => onChange(slot.time)}
          >
            {slot.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function Metric({ icon: Icon, label, value }) {
  return (
    <div className="metric-card">
      <Icon size={17} />
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function SyncRow({ label, value, copied, onCopy }) {
  return (
    <div className="sync-row">
      <span>{label}</span>
      <code>{value}</code>
      <button className="icon-button small" onClick={onCopy} aria-label={`Copy ${label}`}>
        {copied ? <Check size={16} /> : <Copy size={16} />}
      </button>
    </div>
  );
}

function MonthView({ anchor, bookings, brokerById, onSelect }) {
  const monthStart = startOfMonth(anchor);
  const gridStart = startOfWeek(monthStart);
  const days = Array.from({ length: 42 }, (_, index) => {
    const date = new Date(gridStart);
    date.setDate(gridStart.getDate() + index);
    return date;
  });

  return (
    <div className="month-view">
      {DAY_NAMES.map((day) => <div key={day} className="day-name">{day}</div>)}
      {days.map((date) => {
        const dayBookings = bookings.filter((booking) => sameDay(new Date(booking.start), date));
        const isOutside = date.getMonth() !== anchor.getMonth();
        return (
          <div key={dateKey(date)} className={classNames("month-cell", isOutside && "muted", sameDay(date, new Date()) && "today")}>
            <div className="cell-date">{date.getDate()}</div>
            <div className="booking-stack">
              {dayBookings.slice(0, 4).map((booking) => {
                const broker = brokerById[booking.brokerId];
                const brokerColor = broker?.color || "#b89044";
                return (
                  <button
                    key={booking.id}
                    className={classNames("booking-chip", statusClass(booking.status))}
                    style={{
                      borderLeftColor: brokerColor,
                      "--broker-color": brokerColor
                    }}
                    onClick={() => onSelect(booking)}
                  >
                    <span className="broker-initials" style={{ background: brokerColor }}>{brokerInitials(broker?.name)}</span>
                    <span className="booking-time">{displayTime(booking.start)}</span>
                    <strong>{booking.clientName}</strong>
                    <em>{statusLabel(booking.status)}</em>
                  </button>
                );
              })}
              {dayBookings.length > 4 && <small className="more-count">+{dayBookings.length - 4} more</small>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function AgendaView({ mode, anchor, bookings, brokerById, onSelect }) {
  const start = mode === "week" ? startOfWeek(anchor) : startOfDay(anchor);
  const days = Array.from({ length: mode === "week" ? 7 : 1 }, (_, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    return date;
  });

  return (
    <div className={classNames("agenda-view", mode === "day" && "single-day")}>
      {days.map((date) => {
        const dayBookings = bookings.filter((booking) => sameDay(new Date(booking.start), date));
        return (
          <div className="agenda-day" key={dateKey(date)}>
            <div className={classNames("agenda-date", sameDay(date, new Date()) && "today")}>{displayDay(date)}</div>
            <div className="agenda-list">
              {dayBookings.length === 0 && <div className="empty-slot">Available</div>}
              {dayBookings.map((booking) => {
                const broker = brokerById[booking.brokerId];
                const brokerColor = broker?.color || "#b89044";
                return (
                  <button
                    className={classNames("agenda-booking", statusClass(booking.status))}
                    key={booking.id}
                    style={{
                      borderLeftColor: brokerColor,
                      "--broker-color": brokerColor
                    }}
                    onClick={() => onSelect(booking)}
                  >
                    <span className="agenda-booking-head">
                      <span className="broker-initials" style={{ background: brokerColor }}>{brokerInitials(broker?.name)}</span>
                      <span className="time-block">{displayTime(booking.start)} - {displayTime(booking.end)}</span>
                      <span className={classNames("status-pill", statusClass(booking.status))}>{statusLabel(booking.status)}</span>
                    </span>
                    <strong>{booking.clientName}</strong>
                    <small style={{ color: brokerColor }}>{broker?.name}</small>
                    <em>{booking.service}</em>
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function BookingDrawer({ booking, broker, googleUrl, copied, onCopy, onClose, onStatus, onDelete }) {
  const canManage = Boolean(onStatus && onDelete);
  return (
    <div className="drawer-backdrop" onClick={onClose}>
      <aside className="booking-drawer" onClick={(event) => event.stopPropagation()}>
        <button className="close-button" onClick={onClose}>Close</button>
        <div className="drawer-kicker">
          <Sparkles size={16} />
          {statusLabel(booking.status)}
        </div>
        <h2>{booking.clientName}</h2>
        <p className="drawer-service">{booking.service}</p>
        <div className="drawer-details">
          <span><Clock size={16} /> {displayDay(new Date(booking.start))}, {displayTime(booking.start)} - {displayTime(booking.end)}</span>
          <span><Users size={16} /> {broker?.name || "Easy Loan Finance"}</span>
          <span><Phone size={16} /> {booking.phone || "No phone saved"}</span>
          <span><Link2 size={16} /> {booking.channel}</span>
        </div>
        <p className="drawer-notes">{booking.notes || "No notes yet."}</p>
        {canManage && (
          <div className="status-actions">
            {STATUS.map((status) => (
              <button key={status} className={classNames(statusClass(status), statusLabel(booking.status) === status && "active")} onClick={() => onStatus(status)}>
                {status}
              </button>
            ))}
          </div>
        )}
        <div className="drawer-actions">
          <a className="primary-button" href={googleUrl} target="_blank" rel="noreferrer">
            <ExternalLink size={17} />
            Open in Google
          </a>
          <button className="secondary-button" onClick={onCopy}>
            {copied ? <Check size={17} /> : <Copy size={17} />}
            Copy Google Link
          </button>
          {canManage && (
            <button className="danger-button" onClick={onDelete}>
              <Trash2 size={17} />
              Delete Booking
            </button>
          )}
        </div>
      </aside>
    </div>
  );
}

createRoot(document.getElementById("root")).render(<App />);
