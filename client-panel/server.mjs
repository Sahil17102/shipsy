import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import crypto from "node:crypto";
import PDFDocument from "pdfkit";
import bwipjs from "bwip-js";
import dotenv from "dotenv";
import nodemailer from "nodemailer";
import { createSellerRegistry, registerStorageRoutes, shipsyObjectKey, putShipsyObject } from "./shipsy-storage.mjs";
import { registerIndiaPostRoutes } from "./india-post.mjs";

const app = express();
const port = Number(process.env.PORT || 10000);
const root = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: process.env.DOTENV_CONFIG_PATH || path.join(root, ".env") });
const providerOrdersFile = process.env.PROVIDER_ORDERS_FILE || path.join(process.env.DATA_DIR || root, "data", "provider-orders.json");
const dataDir = process.env.DATA_DIR || path.join(root, "data");
const notificationsFile = path.join(dataDir, "notifications.json");
const sellerRegistry = createSellerRegistry(dataDir);

app.disable("x-powered-by");
app.use((req, res, next) => {
  const allowed = new Set([
    "https://goshipsy.in",
    "https://www.goshipsy.in",
    "https://admin.goshipsy.in",
    "https://shipsy-client-wkxv.onrender.com",
    "https://shipsy-1admin.onrender.com",
    "http://localhost:5173",
    ...String(process.env.ALLOWED_ORIGINS || "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  ]);
  const origin = req.get("origin");
  if (origin && allowed.has(origin)) res.set("Access-Control-Allow-Origin", origin);
  res.set("Vary", "Origin");
  res.set("Access-Control-Allow-Credentials", "true");
  res.set("Access-Control-Allow-Headers", "Authorization, Content-Type, X-Shipsy-User-Id, X-Shipsy-User-Email");
  res.set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, OPTIONS");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true, limit: "2mb" }));

registerIndiaPostRoutes(app, { dataDir });

const otpStore = new Map();
let mailTransport;

function normalizedEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function requireEmail(value) {
  const email = normalizedEmail(value);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    const error = new Error("A valid email address is required");
    error.status = 400;
    throw error;
  }
  return email;
}

function otpDigest(email, code) {
  return crypto
    .createHmac("sha256", requireEnv("OTP_SECRET"))
    .update(`${email}:${code}`)
    .digest("hex");
}

function getMailTransport() {
  if (mailTransport) return mailTransport;
  mailTransport = nodemailer.createTransport({
    host: process.env.SMTP_HOST || "smtp.gmail.com",
    port: Number(process.env.SMTP_PORT || 465),
    secure: String(process.env.SMTP_SECURE || "true") !== "false",
    auth: {
      user: requireEnv("SMTP_USER"),
      pass: requireEnv("SMTP_PASS").replace(/\s+/g, ""),
    },
  });
  return mailTransport;
}

function publicUserForEmail(email, existing = null) {
  return {
    ...(existing || {}),
    id: `client-${email}`,
    email,
    phone: existing?.phone || null,
    name: existing?.name || null,
    firstName: existing?.firstName || null,
    lastName: existing?.lastName || null,
    role: "user",
    teamRole: "owner",
    parentUserId: null,
    isVerified: true,
    onboardingComplete: existing?.onboardingComplete === true,
    hasPassword: existing?.hasPassword === true,
  };
}

app.post("/api/auth/send-otp", async (req, res, next) => {
  try {
    const email = requireEmail(req.body?.identifier);
    const current = otpStore.get(email);
    if (current && Date.now() - current.sentAt < 30_000) {
      return res.status(429).json({ message: "Please wait before requesting another OTP." });
    }

    const code = String(crypto.randomInt(100000, 1000000));
    otpStore.set(email, {
      digest: otpDigest(email, code),
      expiresAt: Date.now() + 10 * 60_000,
      sentAt: Date.now(),
      attempts: 0,
    });

    const fromAddress = normalizedEmail(process.env.MAIL_FROM_ADDRESS || process.env.SMTP_USER);
    const fromName = String(process.env.MAIL_FROM_NAME || "ShipSy").trim();
    await getMailTransport().sendMail({
      from: { name: fromName, address: fromAddress },
      to: email,
      subject: `${code} is your ShipSy verification code`,
      text: `Your ShipSy verification code is ${code}. It expires in 10 minutes. If you did not request this code, you can ignore this email.`,
      html: `<div style="font-family:Arial,sans-serif;max-width:520px;margin:auto;padding:28px;color:#0f1f3d"><h2 style="margin:0 0 12px">ShipSy verification</h2><p>Use this one-time code to continue:</p><div style="font-size:32px;font-weight:700;letter-spacing:8px;color:#165dff;margin:24px 0">${code}</div><p>This code expires in 10 minutes.</p><p style="color:#667085;font-size:13px">If you did not request this code, you can safely ignore this email.</p></div>`,
    });

    return res.json({ isNewUser: !sellerRegistry.findByEmail(email), message: "OTP sent successfully." });
  } catch (error) {
    next(error);
  }
});

app.post("/api/auth/verify-otp", (req, res, next) => {
  try {
    const email = requireEmail(req.body?.identifier);
    const code = String(req.body?.code || "").trim();
    const entry = otpStore.get(email);
    if (!entry || entry.expiresAt < Date.now()) {
      otpStore.delete(email);
      return res.status(400).json({ message: "OTP has expired. Request a new code." });
    }
    if (entry.attempts >= 5) {
      otpStore.delete(email);
      return res.status(429).json({ message: "Too many attempts. Request a new code." });
    }
    entry.attempts += 1;
    const expected = Buffer.from(entry.digest, "hex");
    const received = Buffer.from(otpDigest(email, code), "hex");
    if (expected.length !== received.length || !crypto.timingSafeEqual(expected, received)) {
      return res.status(400).json({ message: "Invalid OTP." });
    }
    otpStore.delete(email);
    const existing = sellerRegistry.findByEmail(email);
    const user = publicUserForEmail(email, existing);
    sellerRegistry.upsert(user);
    return res.json({ user, isNewUser: !existing });
  } catch (error) {
    next(error);
  }
});

app.post("/api/admin/auth/login", (req, res, next) => {
  try {
    const email = requireEmail(req.body?.email);
    const password = String(req.body?.password || "");
    const expectedEmail = normalizedEmail(requireEnv("ADMIN_EMAIL"));
    const expectedPassword = Buffer.from(requireEnv("ADMIN_PASSWORD"));
    const receivedPassword = Buffer.from(password);
    const passwordMatches =
      expectedPassword.length === receivedPassword.length &&
      crypto.timingSafeEqual(expectedPassword, receivedPassword);
    if (email !== expectedEmail || !passwordMatches) {
      return res.status(401).json({ message: "Invalid admin email or password." });
    }
    return res.json({
      token: crypto.randomBytes(24).toString("base64url"),
      user: {
        id: "shipsy-admin",
        email: expectedEmail,
        phone: null,
        name: process.env.ADMIN_NAME || "ShipSy Admin",
        firstName: "ShipSy",
        lastName: "Admin",
        role: "superadmin",
        designation: "Administrator",
        roleLabel: "Superadmin",
        assignedSellerIds: [],
        permissions: [],
        isVerified: true,
        onboardingComplete: true,
      },
    });
  } catch (error) {
    next(error);
  }
});

function requireEnv(name) {
  // Render/dashboard values are sometimes pasted with surrounding quotes.
  // Those quotes become part of the header and make FShip reject the key.
  const value = String(process.env[name] || "").trim().replace(/^("|')(.*)\1$/, "$2").trim();
  if (!value) {
    const error = new Error(`${name} is not configured on the Shipsy client service`);
    error.status = 503;
    throw error;
  }
  return value;
}

function getFshipClientKey() {
  return requireEnv("FSHIP_CLIENT_KEY");
}

async function readUpstream(response) {
  const contentType = response.headers.get("content-type") || "";
  const body = contentType.includes("application/json")
    ? await response.json().catch(() => ({ message: "Invalid JSON returned by courier" }))
    : await response.text();
  return { body, contentType };
}

function upstreamErrorMessage(body, fallback) {
  if (typeof body === "string" && body.trim()) return body.trim();
  if (body && typeof body === "object") {
    for (const key of ["message", "error", "detail", "prepaid", "cod", "response", "remark", "remarks"]) {
      const value = body[key];
      if (typeof value === "string" && value.trim()) return value.trim();
    }
    for (const value of Object.values(body)) {
      if (typeof value === "string" && value.trim()) return value.trim();
    }
  }
  return fallback;
}

let teampafexToken = "";
// Provider-created orders are mirrored here so the client and admin panels
// share the same order list even when the upstream courier has no list API.
function loadProviderOrders() {
  try {
    const rows = JSON.parse(fs.readFileSync(providerOrdersFile, "utf8"));
    return new Map((Array.isArray(rows) ? rows : []).filter((order) => order?.id).map((order) => [String(order.id), order]));
  } catch { return new Map(); }
}
const providerOrders = loadProviderOrders();
function persistProviderOrders() {
  fs.mkdirSync(path.dirname(providerOrdersFile), { recursive: true });
  const temporary = `${providerOrdersFile}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify([...providerOrders.values()], null, 2), "utf8");
  fs.renameSync(temporary, providerOrdersFile);
}

function readNotifications() {
  try {
    const rows = JSON.parse(fs.readFileSync(notificationsFile, "utf8"));
    return Array.isArray(rows) ? rows : [];
  } catch { return []; }
}

function persistNotifications(rows) {
  fs.mkdirSync(path.dirname(notificationsFile), { recursive: true });
  const temporary = `${notificationsFile}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(rows.slice(0, 5000), null, 2), "utf8");
  fs.renameSync(temporary, notificationsFile);
}

async function getTeampafexToken(force = false) {
  if (teampafexToken && !force) return teampafexToken;
  const response = await fetch("https://teampafex.in/api/login", {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({
      email: requireEnv("TEAMPAFEX_EMAIL"),
      password: requireEnv("TEAMPAFEX_PASSWORD"),
    }),
  });
  const { body } = await readUpstream(response);
  if (!response.ok) throw Object.assign(new Error(body?.message || body?.msg || "Teampafex login failed"), { status: response.status });
  teampafexToken = typeof body?.token === "string"
    ? body.token
    : body?.token?.token || body?.token?.jwt || body?.token?.accessToken || body?.accessToken || body?.access_token || body?.data?.token || "";
  if (!teampafexToken) throw Object.assign(new Error("Teampafex login did not return a token"), { status: 502 });
  return teampafexToken;
}

app.all("/api/providers/teampafex/*path", async (req, res, next) => {
  try {
    const pathPart = Array.isArray(req.params.path) ? req.params.path.join("/") : req.params.path;
    const target = new URL(`/api/${pathPart}`, "https://teampafex.in");
    for (const [key, value] of Object.entries(req.query)) target.searchParams.set(key, String(value));
    let token = await getTeampafexToken();
    const call = () => fetch(target, {
      method: req.method,
      headers: { Accept: "application/json", "Content-Type": req.get("content-type") || "application/json", Authorization: `Bearer ${token}` },
      body: ["GET", "HEAD"].includes(req.method) ? undefined : req.get("content-type")?.includes("urlencoded") ? new URLSearchParams(req.body) : JSON.stringify(req.body),
    });
    let response = await call();
    if (response.status === 401) {
      token = await getTeampafexToken(true);
      response = await call();
    }
    const { body, contentType } = await readUpstream(response);
    res.status(response.status).type(contentType || "application/json").send(body);
  } catch (error) { next(error); }
});

app.all(["/api/providers/fship/*path", "/api/providers/logixmitra/*path"], async (req, res, next) => {
  try {
    const pathPart = Array.isArray(req.params.path) ? req.params.path.join("/") : req.params.path;
    const target = new URL(`/api/${pathPart}`, "https://capi.fship.in");
    for (const [key, value] of Object.entries(req.query)) target.searchParams.set(key, String(value));
    const signature = getFshipClientKey();
    const response = await fetch(target, {
      method: req.method,
      headers: {
        Accept: "application/json",
        "Content-Type": req.get("content-type") || "application/json",
        signature,
      },
      body: ["GET", "HEAD"].includes(req.method) ? undefined : JSON.stringify(req.body),
    });
    const { body, contentType } = await readUpstream(response);
    console.info("FShip proxy request", {
      credentialSource: "env:FSHIP_CLIENT_KEY",
      signaturePresent: Boolean(signature),
      baseUrl: "https://capi.fship.in",
      endpoint: target.pathname,
      method: req.method,
      status: response.status,
      response: typeof body === "string" ? body.slice(0, 200) : body?.message || body?.response || response.statusText,
    });
    if (!response.ok && (!body || body === "")) {
      return res.status(response.status).json({ message: `FShip API returned ${response.status} ${response.statusText}`.trim() });
    }
    res.status(response.status).type(contentType || "application/json").send(body);
  } catch (error) { next(error); }
});


app.post("/api/providers/delhivery/create-order", async (req, res, next) => {
  try {
    const form = new URLSearchParams({
      format: "json",
      data: JSON.stringify(req.body),
    });
    const response = await fetch("https://track.delhivery.com/api/cmu/create.json", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Token ${requireEnv("DELHIVERY_TOKEN")}`,
      },
      body: form,
    });
    const { body, contentType } = await readUpstream(response);
    res.status(response.status).type(contentType || "application/json").send(body);
  } catch (error) { next(error); }
});

app.post("/api/providers/delhivery/pickup-request", async (req, res, next) => {
  try {
    const indiaNow = new Date(Date.now() + 330 * 60 * 1000);
    const afterSameDayCutoff = indiaNow.getUTCHours() >= 15;
    if (afterSameDayCutoff) indiaNow.setUTCDate(indiaNow.getUTCDate() + 1);
    const defaultHour = afterSameDayCutoff ? 14 : Math.max(10, indiaNow.getUTCHours() + 2);
    const datePart = `${indiaNow.getUTCFullYear()}-${String(indiaNow.getUTCMonth() + 1).padStart(2, "0")}-${String(indiaNow.getUTCDate()).padStart(2, "0")}`;
    // Delhivery expects local pickup date/time and the exact registered
    // warehouse name. Never send a past slot: after 3 PM schedule next day.
    const pickupDate = String(req.body?.pickup_date || datePart);
    const pickupTime = String(req.body?.pickup_time || `${String(defaultHour).padStart(2, "0")}:00:00`);
    const pickupLocation = String(req.body?.pickup_location || process.env.DELHIVERY_PICKUP_NAME || "BILAL");
    const expectedPackageCount = Math.max(1, Number(req.body?.expected_package_count || 1));
    const response = await fetch("https://track.delhivery.com/fm/request/new/", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: `Token ${requireEnv("DELHIVERY_TOKEN")}`,
      },
      body: JSON.stringify({
        pickup_time: pickupTime,
        pickup_date: pickupDate,
        pickup_location: pickupLocation,
        expected_package_count: expectedPackageCount,
      }),
    });
    const { body, contentType } = await readUpstream(response);
    if (!response.ok) {
      return res.status(response.status).json({
        message: upstreamErrorMessage(body, `Delhivery pickup request failed (${response.status})`),
        provider: "delhivery",
      });
    }
    return res.status(response.status).json({ success: true, pickup: body });
  } catch (error) { next(error); }
});

app.post("/api/providers/delhivery/cancel-order", async (req, res, next) => {
  try {
    const waybill = String(req.body?.waybill || "").trim();
    if (!/^\d{8,}$/.test(waybill)) return res.status(400).json({ message: "A valid Delhivery waybill is required" });
    const response = await fetch("https://track.delhivery.com/api/p/edit", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: `Token ${requireEnv("DELHIVERY_TOKEN")}`,
      },
      body: JSON.stringify({ waybill, cancellation: "true" }),
    });
    const { body, contentType } = await readUpstream(response);
    const rejected = body && typeof body === "object" && (body.status === false || body.success === false || body.error === true);
    if (!response.ok || rejected) {
      return res.status(response.ok ? 400 : response.status).type(contentType || "application/json").send(body);
    }
    return res.status(response.status).type(contentType || "application/json").send(body);
  } catch (error) { next(error); }
});

app.get("/api/providers/delhivery/track", async (req, res, next) => {
  try {
    const waybill = String(req.query?.waybill || "").trim();
    if (!/^\d{8,}$/.test(waybill)) return res.status(400).json({ message: "A valid Delhivery waybill is required" });
    const target = new URL("https://track.delhivery.com/api/v1/packages/json/");
    target.searchParams.set("waybill", waybill);
    const response = await fetch(target, {
      headers: {
        Accept: "application/json",
        Authorization: `Token ${requireEnv("DELHIVERY_TOKEN")}`,
      },
    });
    const { body, contentType } = await readUpstream(response);
    return res.status(response.status).type(contentType || "application/json").send(body);
  } catch (error) { next(error); }
});

function publicOrder(order) {
  const seller = sellerRegistry.list().find((item) => String(item?.id || "") === String(order?.userId || ""));
  return seller ? { ...order, user: seller } : order;
}

function requestSeller(req) {
  const requestedId = String(req.get("x-shipsy-user-id") || "").trim();
  const requestedEmail = normalizedEmail(req.get("x-shipsy-user-email"));
  return (requestedId && sellerRegistry.list().find((item) => String(item?.id || "") === requestedId))
    || (requestedEmail && sellerRegistry.findByEmail(requestedEmail))
    || null;
}

function hasSellerIdentity(req) {
  return Boolean(String(req.get("x-shipsy-user-id") || "").trim() || normalizedEmail(req.get("x-shipsy-user-email")));
}

function canAccessProviderOrder(req, order) {
  const seller = requestSeller(req);
  return !hasSellerIdentity(req) || Boolean(seller && String(order?.userId || "") === String(seller.id));
}

function providerOrderOwner(req, order) {
  const existing = order?.id ? providerOrders.get(String(order.id)) : null;
  const existingSeller = existing
    ? sellerRegistry.list().find((item) => String(item?.id || "") === String(existing.userId || ""))
    : null;
  // Browser-local provider stores may replay older copies of an order. Once
  // the shared VPS record has a real seller, never allow that replay to erase
  // or reassign ownership. Seller identity is established at the first
  // authenticated mirror write (or by a controlled legacy backfill).
  if (existingSeller) {
    return { ...order, userId: existingSeller.id, user: existingSeller };
  }
  const seller = requestSeller(req);
  return seller ? { ...order, userId: seller.id, user: seller } : order;
}

function trackingStatus(value) {
  const status = String(value || "").trim().toLowerCase().replace(/[_-]+/g, " ");
  if (/rto.*deliver|return.*deliver/.test(status)) return "rto_delivered";
  if (/rto.*transit|return.*transit/.test(status)) return "rto_in_transit";
  if (status.includes("rto") || status.includes("return to origin")) return "rto_initiated";
  if (status.includes("out for delivery") || status.includes("ofd")) return "out_for_delivery";
  if (status.includes("ndr") || status.includes("undelivered") || status.includes("not delivered") || status.includes("delivery failed")) return "ndr";
  if (status.includes("deliver")) return "delivered";
  if (status.includes("transit") || status.includes("dispatch") || status.includes("bagged")) return "in_transit";
  if (status.includes("picked") || status.includes("pickup done") || status.includes("shipped")) return "shipped";
  if (status.includes("manifest") || status.includes("scheduled") || status.includes("booked")) return "booked";
  if (status.includes("cancel")) return "cancelled";
  return "processing";
}

const terminalTrackingStatuses = new Set(["delivered", "cancelled", "rto_delivered", "lost"]);
const trackingStatusRank = new Map([
  ["created", 0], ["processing", 0], ["booked", 1], ["pickup_initiated", 2],
  ["shipped", 3], ["in_transit", 4], ["out_for_delivery", 5], ["delivered", 6],
]);

function shouldApplyTrackingStatus(current, next) {
  if (!next || next === "processing" || current === next) return false;
  if (terminalTrackingStatuses.has(current)) return false;
  if (["ndr", "rto_initiated", "rto_in_transit", "rto_delivered", "cancelled", "lost"].includes(next)) return true;
  if (["ndr", "rto_initiated", "rto_in_transit"].includes(current)) return false;
  return (trackingStatusRank.get(next) ?? -1) >= (trackingStatusRank.get(current) ?? -1);
}

function statusLabel(status) {
  return String(status || "Shipment update").replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function addStatusNotification(order, oldStatus, newStatus) {
  const ownerId = String(order?.userId || order?.user?.id || "").trim();
  if (!ownerId) return;
  const orderRef = order.orderId || order.awb || order.id;
  const now = new Date().toISOString();
  const rows = readNotifications();
  rows.unshift({
    id: crypto.randomUUID(), userId: ownerId, event: `order.${newStatus}`, category: "orders",
    title: `${orderRef}: ${statusLabel(newStatus)}`,
    body: `Shipment ${orderRef} moved from ${statusLabel(oldStatus)} to ${statusLabel(newStatus)}.`,
    link: `/orders/${encodeURIComponent(order.id)}`, readAt: null, createdAt: now,
    data: { orderId: order.id, awb: order.awb, oldStatus, status: newStatus },
  });
  persistNotifications(rows);
}

async function emailStatusNotification(order, oldStatus, newStatus) {
  if (!process.env.SMTP_USER || !process.env.SMTP_PASS) return;
  const customerEmail = normalizedEmail(order?.deliveryAddress?.email);
  const seller = sellerRegistry.list().find((item) => String(item?.id || "") === String(order?.userId || ""));
  const sellerEmail = normalizedEmail(order?.user?.email || seller?.email);
  if (!customerEmail && !sellerEmail) return;
  const orderRef = order.orderId || order.awb || order.id;
  const customer = String(order?.deliveryAddress?.contactName || "Customer").trim();
  const trackingUrl = `https://goshipsy.in/track-shipment?awb=${encodeURIComponent(order.awb || orderRef)}`;
  const fromAddress = normalizedEmail(process.env.MAIL_FROM_ADDRESS || process.env.SMTP_USER);
  const from = { name: String(process.env.MAIL_FROM_NAME || "ShipSy").trim(), address: fromAddress };
  const sends = [];
  if (customerEmail) sends.push(getMailTransport().sendMail({
    from, to: customerEmail, subject: `${statusLabel(newStatus)} — shipment ${orderRef}`,
    text: `Hi ${customer}, your shipment ${orderRef} is now ${statusLabel(newStatus)}. Track it here: ${trackingUrl}`,
    html: `<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;padding:28px;color:#0f1f3d"><h2 style="margin:0 0 12px">${statusLabel(newStatus)}</h2><p>Hi ${customer},</p><p>Your shipment <strong>${orderRef}</strong> is now <strong>${statusLabel(newStatus)}</strong>.</p><p><a href="${trackingUrl}">Track your shipment</a></p><p style="color:#667085;font-size:13px">Previous status: ${statusLabel(oldStatus)}</p></div>`,
  }));
  if (sellerEmail && sellerEmail !== customerEmail) sends.push(getMailTransport().sendMail({
    from, to: sellerEmail, subject: `Order ${orderRef} is ${statusLabel(newStatus)}`,
    text: `Order ${orderRef} moved from ${statusLabel(oldStatus)} to ${statusLabel(newStatus)}. AWB: ${order.awb || "Not assigned"}.`,
  }));
  await Promise.allSettled(sends);
}

async function fetchJson(target, options) {
  const response = await fetch(target, options);
  const { body } = await readUpstream(response);
  if (!response.ok) throw Object.assign(new Error(upstreamErrorMessage(body, `Tracking returned HTTP ${response.status}`)), { status: response.status });
  return body;
}

function newestDelhiveryUpdate(body) {
  const shipments = Array.isArray(body?.ShipmentData) ? body.ShipmentData : [];
  const shipment = shipments[0]?.Shipment || {};
  const scans = shipments.flatMap((entry) => Array.isArray(entry?.Shipment?.Scans) ? entry.Shipment.Scans : []);
  const candidates = scans.map((entry) => {
    const scan = entry?.ScanDetail || entry || {};
    return {
      text: String(scan.Scan || scan.Instructions || scan.Status || ""),
      timestamp: scan.ScanDateTime || scan.StatusDateTime || null,
      location: scan.ScannedLocation || scan.ScanLocation || scan.StatusLocation || null,
    };
  });
  if (shipment.Status?.Status) candidates.push({
    text: String(shipment.Status.Status), timestamp: shipment.Status.StatusDateTime || null,
    location: shipment.Status.StatusLocation || shipment.Destination || null,
  });
  return candidates.filter((item) => item.text).sort((a, b) => new Date(b.timestamp || 0).getTime() - new Date(a.timestamp || 0).getTime())[0] || null;
}

async function trackingUpdateFor(order) {
  const provider = String(order.serviceProvider || "").trim().toLowerCase();
  const awb = String(order.awb || "").trim();
  if (!awb && provider !== "teampafex" && provider !== "courier_api") return null;

  if (provider === "delhivery") {
    const target = new URL("https://track.delhivery.com/api/v1/packages/json/");
    target.searchParams.set("waybill", awb);
    const body = await fetchJson(target, { headers: { Accept: "application/json", Authorization: `Token ${requireEnv("DELHIVERY_TOKEN")}` } });
    return newestDelhiveryUpdate(body);
  }
  if (["fship", "logixmitra", "logix_mitra"].includes(provider)) {
    const body = await fetchJson("https://capi.fship.in/api/shipmentsummary", {
      method: "POST", headers: { Accept: "application/json", "Content-Type": "application/json", signature: getFshipClientKey() },
      body: JSON.stringify({ waybill: awb }),
    });
    const summary = body?.summary || {};
    return { text: String(summary.status || body?.response || ""), timestamp: summary.lastscandate || summary.lastscanned || null, location: summary.location || null };
  }
  if (["teampafex", "courier_api"].includes(provider)) {
    const providerId = String(order.providerOrderId || order.id || "").replace(/^courier-/, "");
    if (!providerId) return null;
    const token = await getTeampafexToken();
    const body = await fetchJson(`https://teampafex.in/api/track_order/${encodeURIComponent(providerId)}`, {
      headers: { Accept: "application/json", Authorization: `Bearer ${token}` },
    });
    return { text: String(body?.order_status || body?.msg || ""), timestamp: null, location: null };
  }
  if (provider === "india-post") {
    const body = await fetchJson(`http://127.0.0.1:${port}/api/providers/india-post/track?awb=${encodeURIComponent(awb)}`);
    const serialized = JSON.stringify(body);
    const text = body?.status || body?.event || body?.description || body?.tracking_status || serialized.match(/"(?:status|event|description)"\s*:\s*"([^"]+)"/i)?.[1] || "";
    return { text: String(text), timestamp: body?.event_date || body?.date || null, location: body?.location || null };
  }
  return null;
}

let syncInProgress = false;
async function syncProviderOrders() {
  if (syncInProgress) return { checked: 0, updated: 0 };
  syncInProgress = true;
  let checked = 0;
  let updatedCount = 0;
  try {
    for (const [id, order] of providerOrders) {
      const currentStatus = dashboardStatus(order);
      if (terminalTrackingStatuses.has(currentStatus)) continue;
      try {
        const update = await trackingUpdateFor(order);
        checked += 1;
        const nextStatus = trackingStatus(update?.text);
        if (!update || !shouldApplyTrackingStatus(currentStatus, nextStatus)) continue;
        const now = new Date().toISOString();
        const next = {
          ...order, status: nextStatus, courierStatus: update.text, lastTrackingLocation: update.location || order.lastTrackingLocation,
          lastTrackingAt: update.timestamp || now, updatedAt: now,
          ...(nextStatus === "delivered" ? { deliveredAt: update.timestamp || now } : {}),
        };
        providerOrders.set(id, next);
        persistProviderOrders();
        addStatusNotification(next, currentStatus, nextStatus);
        emailStatusNotification(next, currentStatus, nextStatus).catch((error) => console.error("Status email failed", { orderId: id, message: error.message }));
        updatedCount += 1;
      } catch (error) {
        console.error("Order tracking sync failed", { orderId: id, provider: order.serviceProvider, message: error.message });
      }
    }
    return { checked, updated: updatedCount };
  } finally { syncInProgress = false; }
}

function notificationRowsForRequest(req) {
  const seller = requestSeller(req);
  if (!seller) return [];
  return readNotifications().filter((item) => String(item.userId) === String(seller.id));
}

app.get("/api/notifications", (req, res) => {
  const limit = Math.min(100, Math.max(1, Number(req.query?.limit) || 30));
  const unreadOnly = String(req.query?.unread || "").toLowerCase() === "true";
  const all = notificationRowsForRequest(req);
  const filtered = unreadOnly ? all.filter((item) => !item.readAt) : all;
  res.json({ items: filtered.slice(0, limit), unreadCount: all.filter((item) => !item.readAt).length });
});

app.get("/api/notifications/unread-count", (req, res) => {
  res.json({ count: notificationRowsForRequest(req).filter((item) => !item.readAt).length });
});

app.post("/api/notifications/:id/read", (req, res) => {
  const seller = requestSeller(req);
  if (!seller) return res.status(401).json({ message: "Seller identity is required" });
  const rows = readNotifications();
  const item = rows.find((entry) => entry.id === req.params.id && String(entry.userId) === String(seller.id));
  if (!item) return res.status(404).json({ message: "Notification not found" });
  item.readAt ||= new Date().toISOString();
  persistNotifications(rows);
  return res.json({ notification: item });
});

app.post("/api/notifications/read-all", (req, res) => {
  const seller = requestSeller(req);
  if (!seller) return res.status(401).json({ message: "Seller identity is required" });
  const now = new Date().toISOString();
  const rows = readNotifications();
  rows.forEach((item) => {
    if (String(item.userId) === String(seller.id) && !item.readAt) item.readAt = now;
  });
  persistNotifications(rows);
  return res.json({ success: true });
});

app.get("/api/provider-orders", (req, res) => {
  const seller = requestSeller(req);
  const sellerScopedRequest = hasSellerIdentity(req);
  const orders = [...providerOrders.values()]
    .filter((order) => !sellerScopedRequest || Boolean(seller && String(order?.userId || "") === String(seller.id)))
    .map(publicOrder)
    .sort((left, right) => new Date(right.createdAt || 0).getTime() - new Date(left.createdAt || 0).getTime());
  res.json({ orders });
});

function dashboardNumber(value) {
  const result = Number(value);
  return Number.isFinite(result) ? result : 0;
}

function dashboardRevenue(order) {
  return dashboardNumber(order?.rate?.totalCharge ?? order?.totalCharge ?? order?.shippingCharge);
}

function dashboardCost(order) {
  return dashboardNumber(order?.rate?.freightCharge ?? order?.rate?.forward ?? order?.freightCharge);
}

function dashboardStatus(order) {
  return String(order?.status || "processing").trim().toLowerCase().replace(/[\s-]+/g, "_");
}

function dashboardDate(order) {
  const value = new Date(order?.createdAt || order?.created_at || 0);
  return Number.isNaN(value.getTime()) ? null : value;
}

function dashboardDayKey(value) {
  const date = value instanceof Date ? value : new Date(value);
  return new Date(date.getTime() + 330 * 60_000).toISOString().slice(0, 10);
}

function dashboardRound(value, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function dashboardData(req) {
  const days = Math.min(365, Math.max(1, Math.trunc(dashboardNumber(req.query?.days) || 30)));
  const now = new Date();
  const todayKey = dashboardDayKey(now);
  const todayStart = new Date(`${todayKey}T00:00:00+05:30`);
  const periodStart = new Date(todayStart.getTime() - (days - 1) * 86_400_000);
  const previousStart = new Date(periodStart.getTime() - days * 86_400_000);
  const serviceProvider = String(req.query?.serviceProvider || "").trim().toLowerCase();
  const paymentType = String(req.query?.paymentType || "").trim().toLowerCase();
  const matchesFilters = (order) => {
    const courier = String(order?.serviceProvider || order?.courierName || "").trim().toLowerCase();
    const payment = String(order?.paymentType || "prepaid").trim().toLowerCase();
    return (!serviceProvider || courier === serviceProvider) && (!paymentType || payment === paymentType);
  };
  const datedOrders = [...providerOrders.values()]
    .filter(matchesFilters)
    .map((order) => ({ order, date: dashboardDate(order) }))
    .filter((entry) => entry.date);
  const current = datedOrders.filter(({ date }) => date >= periodStart && date <= now).map(({ order }) => order);
  const previous = datedOrders.filter(({ date }) => date >= previousStart && date < periodStart).map(({ order }) => order);
  const deliveredStatuses = new Set(["delivered"]);
  const failedStatuses = new Set(["cancelled", "ndr", "rto_initiated", "rto_in_transit", "rto_delivered", "lost"]);
  const isDelivered = (order) => deliveredStatuses.has(dashboardStatus(order));
  const isFailed = (order) => failedStatuses.has(dashboardStatus(order));
  const sumRevenue = (orders) => dashboardRound(orders.reduce((sum, order) => sum + dashboardRevenue(order), 0));
  const deliveryRate = (orders) => {
    const completed = orders.filter((order) => isDelivered(order) || isFailed(order));
    return completed.length ? dashboardRound((completed.filter(isDelivered).length / completed.length) * 100, 1) : 0;
  };
  const averageDeliveryDays = (orders) => {
    const durations = orders.filter(isDelivered).map((order) => {
      const start = dashboardDate(order);
      const end = new Date(order?.deliveredAt || order?.updatedAt || 0);
      return start && !Number.isNaN(end.getTime()) ? Math.max(0, (end.getTime() - start.getTime()) / 86_400_000) : null;
    }).filter((value) => value != null);
    return durations.length ? dashboardRound(durations.reduce((sum, value) => sum + value, 0) / durations.length, 1) : null;
  };
  const groupBy = (orders, keyFor) => {
    const groups = new Map();
    orders.forEach((order) => {
      const key = keyFor(order);
      groups.set(key, [...(groups.get(key) || []), order]);
    });
    return groups;
  };
  const courierName = (order) => String(order?.serviceProvider || order?.courierName || "unknown").trim() || "unknown";
  const courierGroups = groupBy(current, courierName);
  const courierInsights = [...courierGroups.entries()].map(([courier, orders]) => {
    const delivered = orders.filter(isDelivered).length;
    const failed = orders.filter(isFailed).length;
    const completed = delivered + failed;
    return {
      courier, totalOrders: orders.length, delivered, failed,
      successRate: completed ? dashboardRound((delivered / completed) * 100, 1) : 0,
      failureRate: completed ? dashboardRound((failed / completed) * 100, 1) : 0,
      revenue: sumRevenue(orders), avgDeliveryDays: averageDeliveryDays(orders),
    };
  }).sort((left, right) => right.totalOrders - left.totalOrders);
  const margins = [...courierGroups.entries()].map(([courier, orders]) => {
    const revenue = sumRevenue(orders);
    const cost = dashboardRound(orders.reduce((sum, order) => sum + dashboardCost(order), 0));
    const margin = dashboardRound(revenue - cost);
    return {
      courier, revenue, cost, margin,
      marginPercent: revenue ? dashboardRound((margin / revenue) * 100, 1) : 0,
      orderCount: orders.length,
      revenuePerOrder: orders.length ? dashboardRound(revenue / orders.length) : 0,
    };
  }).sort((left, right) => right.revenue - left.revenue);
  const totalRevenue = sumRevenue(current);
  const totalCost = dashboardRound(current.reduce((sum, order) => sum + dashboardCost(order), 0));
  const totalMargin = dashboardRound(totalRevenue - totalCost);
  const sellerById = new Map(sellerRegistry.list().map((seller) => [String(seller.id), seller]));
  const sellerGroups = groupBy(current.filter((order) => order?.userId), (order) => String(order.userId));
  const sellerRows = [...sellerGroups.entries()].map(([id, orders]) => {
    const seller = sellerById.get(id) || orders[0]?.user || {};
    const rto = orders.filter((order) => dashboardStatus(order).startsWith("rto_")).length;
    return {
      id, name: seller.name || seller.businessName || seller.email || "Seller", email: seller.email || "",
      totalOrders: orders.length, delivered: orders.filter(isDelivered).length, rto,
      revenue: sumRevenue(orders), rtoRate: orders.length ? dashboardRound((rto / orders.length) * 100, 1) : 0,
    };
  }).sort((left, right) => right.revenue - left.revenue);
  const startDay = new Date(periodStart);
  const trends = [];
  for (let index = 0; index < days; index += 1) {
    const date = new Date(startDay.getTime() + index * 86_400_000);
    const dateKey = dashboardDayKey(date);
    const orders = current.filter((order) => dashboardDayKey(dashboardDate(order)) === dateKey);
    trends.push({
      date: dateKey, orders: orders.length, delivered: orders.filter(isDelivered).length,
      rto: orders.filter((order) => dashboardStatus(order).startsWith("rto_")).length,
      revenue: sumRevenue(orders),
    });
  }
  const statusDistribution = [...groupBy(current, dashboardStatus).entries()]
    .map(([status, orders]) => ({ status, count: orders.length }))
    .sort((left, right) => right.count - left.count);
  const stateGroups = groupBy(current, (order) => String(order?.deliveryAddress?.state || "Unknown").trim() || "Unknown");
  const topStates = [...stateGroups.entries()].map(([state, orders]) => ({
    state, orders: orders.length, deliveryRate: deliveryRate(orders), revenue: sumRevenue(orders),
  })).sort((left, right) => right.orders - left.orders).slice(0, 10);
  const paymentBucket = (type) => {
    const orders = current.filter((order) => String(order?.paymentType || "prepaid").toLowerCase() === type);
    return {
      orders: orders.length, delivered: orders.filter(isDelivered).length, revenue: sumRevenue(orders),
      codAmount: dashboardRound(orders.reduce((sum, order) => sum + dashboardNumber(order?.codAmount), 0)),
    };
  };
  let kycRecords = {};
  try { kycRecords = JSON.parse(fs.readFileSync(path.join(dataDir, "kyc.json"), "utf8")); } catch { /* optional data */ }
  const kycPending = Object.values(kycRecords).filter((record) => record?.status === "pending").length;
  const delayedShipments = current.filter((order) => {
    const status = dashboardStatus(order);
    const created = dashboardDate(order);
    return created && ["pickup_initiated", "shipped", "in_transit", "out_for_delivery"].includes(status) && now.getTime() - created.getTime() > 5 * 86_400_000;
  }).length;
  const ndrPending = current.filter((order) => dashboardStatus(order) === "ndr").length;
  const failureSpikes = courierInsights.filter((item) => item.failed > 0 && item.failureRate >= 20).map((item) => ({
    courier: item.courier, total: item.totalOrders, failed: item.failed, failureRate: item.failureRate,
  }));
  return {
    overview: {
      totalOrders: current.length, previousOrders: previous.length,
      ordersToday: current.filter((order) => dashboardDayKey(dashboardDate(order)) === todayKey).length,
      activeSellers: sellerGroups.size, revenue: totalRevenue, previousRevenue: sumRevenue(previous),
      deliveryRate: deliveryRate(current), previousDeliveryRate: deliveryRate(previous), avgDeliveryDays: averageDeliveryDays(current),
    },
    courierInsights, trends,
    revenue: { margins, totalRevenue, totalCost, totalMargin },
    sellers: { topSellers: sellerRows.slice(0, 10), highRtoSellers: sellerRows.filter((seller) => seller.rtoRate >= 15).slice(0, 10) },
    alerts: { failureSpikes, delayedShipments, ndrPending, totalAlerts: failureSpikes.length + delayedShipments + ndrPending },
    pendingActions: { kycPending, bankApprovalsPending: 0, codRemittancesPending: 0 },
    paymentSplit: { prepaid: paymentBucket("prepaid"), cod: paymentBucket("cod") },
    topStates, statusDistribution,
  };
}

app.get("/api/admin/dashboard", (req, res, next) => {
  try { return res.json(dashboardData(req)); } catch (error) { return next(error); }
});

app.post("/api/provider-orders", (req, res) => {
  const order = providerOrderOwner(req, req.body);
  if (!order || !order.id) return res.status(400).json({ message: "Order id is required" });
  providerOrders.set(String(order.id), order);
  persistProviderOrders();
  return res.status(201).json({ order: publicOrder(order) });
});

app.get("/api/provider-orders/:id/tracking", async (req, res, next) => {
  try {
    const order = findProviderOrder(req.params.id);
    if (!order || !canAccessProviderOrder(req, order)) return res.status(404).json({ message: "Provider order not found" });
    const provider = String(order.serviceProvider || "").toLowerCase();
    const awb = String(order.awb || "").trim();

    if (provider === "delhivery") {
      if (!awb) return res.json([]);
      const target = new URL("https://track.delhivery.com/api/v1/packages/json/");
      target.searchParams.set("waybill", awb);
      const response = await fetch(target, {
        headers: { Accept: "application/json", Authorization: `Token ${requireEnv("DELHIVERY_TOKEN")}` },
      });
      const { body } = await readUpstream(response);
      if (!response.ok) return res.status(response.status).send(body);
      const shipments = Array.isArray(body?.ShipmentData) ? body.ShipmentData : [];
      const scans = shipments.flatMap((entry) => Array.isArray(entry?.Shipment?.Scans) ? entry.Shipment.Scans : []);
      return res.json(scans.map((entry, index) => {
        const scan = entry?.ScanDetail || entry || {};
        const statusText = String(scan.Scan || scan.Instructions || scan.Status || "Shipment update");
        const timestamp = scan.ScanDateTime || scan.StatusDateTime || new Date().toISOString();
        return {
          id: `${awb}-${index}`,
          orderId: String(order.id), awb,
          statusCode: trackingStatus(statusText), statusText,
          location: scan.ScannedLocation || scan.ScanLocation || scan.StatusLocation,
          remarks: scan.Instructions,
          source: "delhivery", courierEventCode: scan.StatusCode,
          eventTimestamp: timestamp, createdAt: timestamp,
        };
      }).sort((a, b) => new Date(b.eventTimestamp).getTime() - new Date(a.eventTimestamp).getTime()));
    }

    return res.json([]);
  } catch (error) { next(error); }
});

app.post("/api/provider-orders/:id/cancel", async (req, res, next) => {
  try {
    const order = findProviderOrder(req.params.id);
    if (!order || !canAccessProviderOrder(req, order)) return res.status(404).json({ message: "Provider order not found" });
    if (String(order.serviceProvider || "").toLowerCase() === "delhivery") {
      const waybill = String(order.awb || "").trim();
      if (!waybill) return res.status(400).json({ message: "Delhivery AWB is missing; shipment was not cancelled" });
      const response = await fetch("https://track.delhivery.com/api/p/edit", {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          Authorization: `Token ${requireEnv("DELHIVERY_TOKEN")}`,
        },
        body: JSON.stringify({ waybill, cancellation: "true" }),
      });
      const { body, contentType } = await readUpstream(response);
      const rejected = body && typeof body === "object" && (body.status === false || body.success === false || body.error === true);
      if (!response.ok || rejected) {
        return res.status(response.ok ? 400 : response.status).type(contentType || "application/json").send(body);
      }
    }
    const updated = { ...order, status: "cancelled", cancellationReason: String(req.body?.reason || "Cancelled by admin"), cancelledAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    providerOrders.set(String(order.id), updated);
    persistProviderOrders();
    return res.json({ order: updated });
  } catch (error) { next(error); }
});

app.post("/api/provider-orders/pickup-initiated", (req, res) => {
  const ids = Array.isArray(req.body?.orderIds) ? req.body.orderIds.map(String) : [];
  const now = new Date().toISOString();
  const updated = [];
  ids.forEach((id) => {
    const order = findProviderOrder(id);
    if (!order || !canAccessProviderOrder(req, order)) return;
    const next = { ...order, status: "pickup_initiated", pickupRequestedAt: now, updatedAt: now };
    providerOrders.set(String(order.id), next);
    updated.push(next);
  });
  if (updated.length) persistProviderOrders();
  return res.json({ orders: updated });
});

async function orderPdf(order, kind) {
  const address = order.deliveryAddress || {};
  const isLabel = kind === "label";
  const doc = new PDFDocument({ size: isLabel ? [288, 432] : "A4", margin: isLabel ? 18 : 42, info: { Title: `${kind} - ${order.orderId || order.id}`, Author: "ShipSy" } });
  const chunks = [];
  doc.on("data", (chunk) => chunks.push(chunk));
  const completed = new Promise((resolve) => doc.on("end", () => resolve(Buffer.concat(chunks))));
  const blue = "#165DFF", ink = "#0F1F3D", muted = "#667085", line = "#D9E2F1", pale = "#EFF5FF";
  const orderId = String(order.orderId || order.id || "-");
  const awb = String(order.awb || "-");
  const payment = String(order.paymentType || "prepaid").toUpperCase();
  const amount = Number(order.orderAmount || 0);
  const date = new Date(order.createdAt || Date.now()).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
  const destination = [address.addressLine1, address.addressLine2, address.city, address.state, address.pincode].filter(Boolean).join(", ");

  if (isLabel) {
    doc.roundedRect(10, 10, 268, 412, 7).lineWidth(1.2).stroke(ink);
    doc.rect(10, 10, 268, 52).fill(ink);
    doc.fillColor("white").font("Helvetica-Bold").fontSize(22).text("ShipSy", 24, 23);
    doc.font("Helvetica").fontSize(7).text("SHIPPING, SIMPLIFIED.", 24, 47);
    doc.font("Helvetica-Bold").fontSize(9).text("SHIPPING LABEL", 174, 27, { width: 88, align: "right" });
    doc.fillColor(ink).fontSize(7).text("COURIER PARTNER", 22, 75);
    doc.fontSize(13).text(order.courierName || "Delhivery", 22, 87);
    doc.roundedRect(198, 72, 62, 28, 5).fill(pale);
    doc.fillColor(blue).fontSize(11).text(payment, 202, 81, { width: 54, align: "center" });
    doc.moveTo(18, 112).lineTo(270, 112).strokeColor(line).stroke();
    const barcode = await bwipjs.toBuffer({ bcid: "code128", text: awb, scale: 2, height: 10, includetext: true, textxalign: "center" });
    doc.image(barcode, 38, 122, { fit: [212, 68], align: "center" });
    doc.fillColor(muted).font("Helvetica").fontSize(7).text("ORDER ID", 22, 202);
    doc.fillColor(ink).font("Helvetica-Bold").fontSize(12).text(orderId, 22, 214);
    doc.fillColor(muted).font("Helvetica").fontSize(7).text("ORDER DATE", 182, 202, { width: 78, align: "right" });
    doc.fillColor(ink).font("Helvetica-Bold").fontSize(9).text(date, 182, 215, { width: 78, align: "right" });
    doc.rect(18, 242, 252, 116).fillAndStroke("#F8FAFD", line);
    doc.fillColor(blue).font("Helvetica-Bold").fontSize(8).text("DELIVER TO", 28, 255);
    doc.fillColor(ink).fontSize(15).text(address.contactName || "Customer", 28, 270, { width: 220 });
    doc.font("Helvetica").fontSize(9).text(destination || "Address unavailable", 28, 292, { width: 220, lineGap: 3 });
    doc.font("Helvetica-Bold").fontSize(9).text(address.phone ? `Phone: ${address.phone}` : "", 28, 334);
    doc.moveTo(18, 372).lineTo(270, 372).strokeColor(line).stroke();
    doc.fillColor(muted).font("Helvetica").fontSize(7).text("PACKAGE", 22, 383);
    doc.fillColor(ink).font("Helvetica-Bold").fontSize(9).text(`${order.weight || order.chargeableWeight || "-"} g`, 22, 395);
    doc.fillColor(muted).font("Helvetica").fontSize(7).text("AMOUNT", 198, 383, { width: 62, align: "right" });
    doc.fillColor(ink).font("Helvetica-Bold").fontSize(9).text(`INR ${amount.toFixed(2)}`, 188, 395, { width: 72, align: "right" });
  } else {
    const pageWidth = 595.28;
    doc.rect(0, 0, pageWidth, 96).fill(ink);
    doc.fillColor("white").font("Helvetica-Bold").fontSize(28).text("ShipSy", 42, 28);
    doc.font("Helvetica").fontSize(8).text("SHIPPING, SIMPLIFIED.", 43, 61);
    doc.font("Helvetica-Bold").fontSize(19).text("INVOICE", 380, 32, { width: 170, align: "right" });
    doc.font("Helvetica").fontSize(8).text(`INVOICE NO. ${orderId}`, 350, 60, { width: 200, align: "right" });
    doc.fillColor(muted).font("Helvetica-Bold").fontSize(8).text("BILLED TO", 42, 126);
    doc.fillColor(ink).fontSize(13).text(address.contactName || "Customer", 42, 142);
    doc.font("Helvetica").fontSize(9).text(destination || "Address unavailable", 42, 162, { width: 245, lineGap: 3 });
    if (address.phone) doc.text(`Phone: ${address.phone}`, 42, 204);
    doc.roundedRect(346, 122, 207, 100, 7).fill(pale);
    doc.fillColor(muted).font("Helvetica").fontSize(8).text("ORDER DATE", 363, 140).text("AWB NUMBER", 363, 168).text("PAYMENT", 363, 196);
    doc.fillColor(ink).font("Helvetica-Bold").text(date, 442, 140).text(awb, 442, 168).text(payment, 442, 196);
    doc.rect(42, 250, 511, 32).fill(blue);
    doc.fillColor("white").font("Helvetica-Bold").fontSize(8).text("DESCRIPTION", 54, 262).text("QTY", 365, 262, { width: 40, align: "center" }).text("RATE", 420, 262, { width: 54, align: "right" }).text("AMOUNT", 483, 262, { width: 58, align: "right" });
    const products = order.products?.length ? order.products : [{ name: "Shipment item", quantity: 1, unitPrice: amount }];
    let y = 298;
    products.slice(0, 8).forEach((product) => {
      const qty = Number(product.quantity || 1), rate = Number(product.unitPrice || 0);
      doc.fillColor(ink).font("Helvetica-Bold").fontSize(9).text(product.name || "Item", 54, y, { width: 285 });
      doc.font("Helvetica").text(String(qty), 365, y, { width: 40, align: "center" }).text(`INR ${rate.toFixed(2)}`, 420, y, { width: 54, align: "right" }).text(`INR ${(qty * rate).toFixed(2)}`, 483, y, { width: 58, align: "right" });
      doc.moveTo(42, y + 24).lineTo(553, y + 24).strokeColor(line).stroke(); y += 42;
    });
    const subtotal = products.reduce((sum, product) => sum + Number(product.quantity || 1) * Number(product.unitPrice || 0), 0) || amount;
    const shipping = Number(order.rate?.totalCharge || 0);
    const total = subtotal + shipping;
    const totalY = Math.max(540, y + 20);
    doc.fillColor(muted).font("Helvetica").fontSize(9).text("Subtotal", 382, totalY, { width: 82 }).text("Shipping", 382, totalY + 25, { width: 82 });
    doc.fillColor(ink).font("Helvetica-Bold").text(`INR ${subtotal.toFixed(2)}`, 468, totalY, { width: 73, align: "right" }).text(`INR ${shipping.toFixed(2)}`, 468, totalY + 25, { width: 73, align: "right" });
    doc.roundedRect(365, totalY + 51, 188, 43, 6).fill(ink);
    doc.fillColor("white").fontSize(10).text("TOTAL", 382, totalY + 67).fontSize(13).text(`INR ${total.toFixed(2)}`, 450, totalY + 64, { width: 86, align: "right" });
    doc.fillColor(muted).font("Helvetica").fontSize(8).text("This is a computer-generated invoice and does not require a signature.", 42, 770, { width: 510, align: "center" });
    doc.fillColor(blue).font("Helvetica-Bold").text("pkmmittal97@gmail.com  |  goshipsy.in", 42, 792, { width: 510, align: "center" });
  }
  doc.end();
  return completed;
}

async function manifestPdf(orders) {
  const doc = new PDFDocument({ size: "A4", margin: 40, info: { Title: "ShipSy Pickup Manifest", Author: "ShipSy" } });
  const chunks = [];
  doc.on("data", (chunk) => chunks.push(chunk));
  const completed = new Promise((resolve) => doc.on("end", () => resolve(Buffer.concat(chunks))));
  const blue = "#165DFF", ink = "#0F1F3D", muted = "#667085", line = "#D9E2F1", pale = "#EFF5FF";
  const manifestNo = `MNF-${new Date().toISOString().slice(0, 10).replaceAll("-", "")}-${String(Date.now()).slice(-5)}`;
  const courier = [...new Set(orders.map((order) => order.courierName || order.serviceProvider || "Courier"))].join(", ");
  doc.rect(0, 0, 595.28, 96).fill(ink);
  doc.fillColor("white").font("Helvetica-Bold").fontSize(28).text("ShipSy", 40, 27);
  doc.font("Helvetica").fontSize(8).text("SHIPPING, SIMPLIFIED.", 41, 60);
  doc.font("Helvetica-Bold").fontSize(18).text("PICKUP MANIFEST", 320, 30, { width: 235, align: "right" });
  doc.font("Helvetica").fontSize(8).text(manifestNo, 320, 59, { width: 235, align: "right" });
  doc.fillColor(muted).font("Helvetica-Bold").fontSize(8).text("COURIER PARTNER", 40, 122).text("GENERATED ON", 335, 122);
  doc.fillColor(ink).fontSize(12).text(courier, 40, 137, { width: 250 }).text(new Date().toLocaleString("en-IN"), 335, 137, { width: 220 });
  doc.roundedRect(40, 174, 515, 58, 6).fill(pale);
  doc.fillColor(muted).font("Helvetica-Bold").fontSize(8).text("TOTAL SHIPMENTS", 58, 188).text("PREPAID", 220, 188).text("COD", 365, 188).text("TOTAL WEIGHT", 465, 188);
  const prepaid = orders.filter((order) => order.paymentType !== "cod").length;
  const cod = orders.filter((order) => order.paymentType === "cod").length;
  const weight = orders.reduce((sum, order) => sum + Number(order.weight || order.chargeableWeight || 0), 0);
  doc.fillColor(ink).fontSize(15).text(String(orders.length), 58, 204).text(String(prepaid), 220, 204).text(String(cod), 365, 204).text(`${weight || "-"} g`, 465, 204);
  const columns = [{ x: 48, w: 36, label: "#" }, { x: 84, w: 105, label: "ORDER ID" }, { x: 189, w: 130, label: "AWB" }, { x: 319, w: 120, label: "DESTINATION" }, { x: 439, w: 105, label: "PAYMENT" }];
  let y = 258;
  doc.rect(40, y, 515, 30).fill(blue);
  doc.fillColor("white").font("Helvetica-Bold").fontSize(8);
  columns.forEach((column) => doc.text(column.label, column.x, y + 11, { width: column.w }));
  y += 30;
  orders.slice(0, 24).forEach((order, index) => {
    if (y > 720) { doc.addPage(); y = 50; }
    if (index % 2 === 0) doc.rect(40, y, 515, 34).fill("#F8FAFD");
    const address = order.deliveryAddress || {};
    doc.fillColor(ink).font(index === 0 ? "Helvetica-Bold" : "Helvetica").fontSize(8);
    const values = [String(index + 1), String(order.orderId || order.id), String(order.awb || "-"), [address.city, address.pincode].filter(Boolean).join(" - ") || "-", String(order.paymentType || "prepaid").toUpperCase()];
    columns.forEach((column, colIndex) => doc.text(values[colIndex], column.x, y + 12, { width: column.w - 6, ellipsis: true }));
    doc.moveTo(40, y + 34).lineTo(555, y + 34).strokeColor(line).stroke(); y += 34;
  });
  const signY = Math.max(y + 55, 610);
  doc.strokeColor(line).moveTo(40, signY).lineTo(220, signY).stroke().moveTo(375, signY).lineTo(555, signY).stroke();
  doc.fillColor(muted).font("Helvetica").fontSize(8).text("Seller / Warehouse signature", 40, signY + 9, { width: 180, align: "center" }).text("Courier executive signature", 375, signY + 9, { width: 180, align: "center" });
  doc.fillColor(ink).font("Helvetica-Bold").fontSize(9).text("Handover declaration", 40, signY + 45);
  doc.fillColor(muted).font("Helvetica").fontSize(8).text("The shipments listed above were handed over in sealed condition. The courier representative verified the shipment count at pickup.", 40, signY + 61, { width: 515, lineGap: 3 });
  doc.fillColor(blue).font("Helvetica-Bold").fontSize(8).text("pkmmittal97@gmail.com  |  goshipsy.in", 40, 795, { width: 515, align: "center" });
  doc.end();
  return completed;
}

function findProviderOrder(id) {
  return [...providerOrders.values()].find((item) => [item.id, item.orderId, item.providerOrderId, item.awb].map(String).includes(String(id)));
}

app.get("/api/provider-orders/:id/:document", async (req, res, next) => {
  try {
  const order = findProviderOrder(req.params.id);
  if (!order || !canAccessProviderOrder(req, order) || !["label", "invoice"].includes(req.params.document)) return res.status(404).json({ message: "Provider order document not found" });
  const kind = req.params.document;
  const pdf = await orderPdf(order, kind);
  const storageKey = shipsyObjectKey("documents", kind, `${order.awb || order.orderId || order.id}.pdf`);
  await putShipsyObject(storageKey, pdf, "application/pdf", { kind, orderId: order.orderId || order.id });
  res.type("application/pdf").set("X-Shipsy-Storage-Key", storageKey).set("Content-Disposition", `attachment; filename=${kind}-${order.awb || order.orderId}.pdf`).send(pdf);
  } catch (error) { next(error); }
});

app.post("/api/provider-orders/manifest", async (req, res, next) => {
  try {
    const ids = Array.isArray(req.body?.orderIds) ? req.body.orderIds.map(String) : [];
    const orders = ids.map(findProviderOrder).filter((order) => order && canAccessProviderOrder(req, order));
    if (!orders.length) return res.status(404).json({ message: "No provider orders found for manifest" });
    const pdf = await manifestPdf(orders);
    const manifestId = crypto.createHash("sha256").update(ids.sort().join(":" )).digest("hex").slice(0, 20);
    const storageKey = shipsyObjectKey("documents", "manifests", `${manifestId}.pdf`);
    await putShipsyObject(storageKey, pdf, "application/pdf", { kind: "manifest", orderCount: orders.length });
    res.type("application/pdf").set("X-Shipsy-Storage-Key", storageKey).set("Content-Disposition", `attachment; filename=manifest-${Date.now()}.pdf`).send(pdf);
  } catch (error) { next(error); }
});

registerStorageRoutes(app, { dataDir, sellerRegistry });

app.get("/", (_req, res) => res.json({ service: "goshipsy-api", ok: true }));
app.get("/api/health", (_req, res) => res.json({ service: "goshipsy-api", ok: true }));
app.use(express.static(path.join(root, "dist")));
app.get("*path", (_req, res) => res.sendFile(path.join(root, "dist", "index.html")));
app.use((error, _req, res, _next) => {
  const status = Number(error?.status) || 500;
  res.status(status).json({ message: error instanceof Error ? error.message : "Courier proxy request failed" });
});

app.listen(port, "0.0.0.0", () => {
  console.log(`Shipsy client listening on ${port}`);
  const intervalMs = Math.max(60_000, Number(process.env.TRACKING_SYNC_INTERVAL_MS) || 5 * 60_000);
  setTimeout(() => syncProviderOrders().catch((error) => console.error("Initial tracking sync failed", error)), 10_000).unref();
  setInterval(() => syncProviderOrders().catch((error) => console.error("Tracking sync failed", error)), intervalMs).unref();
});
