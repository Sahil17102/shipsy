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
const walletLedgerFile = path.join(dataDir, "wallet-ledger.json");
const razorpayOrdersFile = path.join(dataDir, "razorpay-orders.json");
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
  res.set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});
app.use(express.json({ limit: "2mb", verify: (req, _res, buffer) => {
  if (req.originalUrl === "/api/webhooks/razorpay") req.rawBody = Buffer.from(buffer);
} }));
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

const fshipApiBaseUrl = String(process.env.FSHIP_API_URL || "https://api.logixmitra.com/api").replace(/\/+$/, "");
let fshipSession = { token: "", userId: "", expiresAt: 0 };

async function getFshipSession(force = false) {
  if (!force && fshipSession.token && fshipSession.expiresAt > Date.now()) return fshipSession;
  const response = await fetch(`${fshipApiBaseUrl}/auth/login`, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({
      email: requireEnv("FSHIP_API_EMAIL"),
      password: requireEnv("FSHIP_API_PASSWORD"),
    }),
  });
  const { body } = await readUpstream(response);
  const token = String(body?.data?.token || "").trim();
  if (!response.ok || !token) {
    throw Object.assign(new Error(upstreamErrorMessage(body, "Shipping provider login failed")), { status: response.status || 502 });
  }
  fshipSession = {
    token,
    userId: String(body?.data?.user?.id || "").trim(),
    // The documented lifetime is seven days; refresh a little early.
    expiresAt: Date.now() + (6 * 24 * 60 * 60 * 1000),
  };
  return fshipSession;
}

async function fshipFetch(pathname, options = {}, authenticated = true) {
  let session = authenticated ? await getFshipSession() : null;
  const call = () => fetch(`${fshipApiBaseUrl}/${String(pathname).replace(/^\/+/, "")}`, {
    ...options,
    headers: {
      Accept: "application/json",
      ...(options.body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(authenticated ? { Authorization: `Bearer ${session.token}` } : {}),
      ...(options.headers || {}),
    },
  });
  let response = await call();
  if (authenticated && response.status === 401) {
    session = await getFshipSession(true);
    response = await call();
  }
  return response;
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

app.get(["/api/providers/fship/getallcourier", "/api/providers/logixmitra/getallcourier"], (_req, res) => {
  // The new rate endpoint already returns the available courier names.
  res.json([]);
});

app.post(["/api/providers/fship/ratecalculator", "/api/providers/logixmitra/ratecalculator"], async (req, res, next) => {
  try {
    const payload = {
      shipmentType: "FORWARD",
      packageType: "SPS",
      originPincode: String(req.body?.source_Pincode || ""),
      deliveryPincode: String(req.body?.destination_Pincode || ""),
      paymentMode: String(req.body?.payment_Mode || "").toUpperCase() === "COD" ? "COD" : "PREPAID",
      weight: Number(req.body?.shipment_Weight || 0),
      invoiceValue: Number(req.body?.amount || 0),
      dimensions: {
        length: Number(req.body?.shipment_Length || 0),
        width: Number(req.body?.shipment_Width || 0),
        height: Number(req.body?.shipment_Height || 0),
      },
      serviceType: "domestic",
    };
    const response = await fshipFetch("integrations/ratecalculate", { method: "POST", body: JSON.stringify(payload) }, false);
    const { body } = await readUpstream(response);
    if (!response.ok || body?.success === false) {
      return res.status(response.status || 502).json({ status: false, response: upstreamErrorMessage(body, "Live rate calculation failed") });
    }
    const rates = Array.isArray(body?.data) ? body.data : [];
    return res.json({
      status: true,
      shipment_rates: rates.map((rate) => ({
        courier_name: String(rate?.type || "Shipping Partner"),
        shipping_charge: Number(rate?.rates || 0),
        cod_charge: 0,
        rto_charge: 0,
        service_mode: "surface",
      })),
    });
  } catch (error) { next(error); }
});

app.post(["/api/providers/fship/addwarehouse", "/api/providers/logixmitra/addwarehouse"], async (req, res, next) => {
  try {
    const session = await getFshipSession();
    const payload = {
      name: String(req.body?.warehouseName || "Pickup Location"),
      address: [req.body?.addressLine1, req.body?.addressLine2].filter(Boolean).join(", "),
      city: String(req.body?.city || ""),
      state: String(req.body?.state || ""),
      pincode: String(req.body?.pincode || ""),
      contactPerson: String(req.body?.contactName || ""),
      phone: String(req.body?.phoneNumber || "").replace(/\D/g, ""),
      user_id: Number(session.userId),
      isDefault: false,
      isActive: true,
    };
    const response = await fshipFetch("auth/createWarehouse", { method: "POST", body: JSON.stringify(payload) });
    const { body } = await readUpstream(response);
    if (!response.ok || body?.success === false) {
      return res.status(response.status || 502).json({ status: false, response: upstreamErrorMessage(body, "Pickup location registration failed") });
    }
    return res.status(response.status).json({ status: true, warehouseId: body?.data?.id, response: body?.message });
  } catch (error) { next(error); }
});

app.post(["/api/providers/fship/updatewarehouse", "/api/providers/logixmitra/updatewarehouse"], async (req, res, next) => {
  try {
    const warehouseId = String(req.body?.warehouseId || "").trim();
    if (!warehouseId) return res.status(400).json({ status: false, response: "Pickup location id is required" });
    const payload = {
      name: String(req.body?.warehouseName || "Pickup Location"),
      address: [req.body?.addressLine1, req.body?.addressLine2].filter(Boolean).join(", "),
      city: String(req.body?.city || ""),
      state: String(req.body?.state || ""),
      pincode: String(req.body?.pincode || ""),
      contactPerson: String(req.body?.contactName || ""),
      phone: String(req.body?.phoneNumber || "").replace(/\D/g, ""),
      isActive: true,
    };
    const response = await fshipFetch(`auth/updateWarehouse/${encodeURIComponent(warehouseId)}`, { method: "PUT", body: JSON.stringify(payload) });
    const { body } = await readUpstream(response);
    if (!response.ok || body?.success === false) {
      return res.status(response.status || 502).json({ status: false, response: upstreamErrorMessage(body, "Pickup location update failed") });
    }
    return res.status(response.status).json({ status: true, warehouseId, response: body?.message });
  } catch (error) { next(error); }
});

app.post(["/api/providers/fship/createforwardorder", "/api/providers/logixmitra/createforwardorder"], async (req, res, next) => {
  try {
    const products = Array.isArray(req.body?.products) ? req.body.products : [];
    const subtotal = products.reduce((sum, product) => sum + (Number(product?.unitPrice || 0) * Number(product?.quantity || 0)), 0);
    const orderAmount = Number(req.body?.order_Amount || req.body?.total_Amount || subtotal || 0);
    const payload = {
      referenceId: String(req.body?.orderId || ""),
      orderNumber: String(req.body?.orderId || ""),
      orderDate: String(req.body?.orderDate || new Date().toISOString().slice(0, 10)),
      customerName: String(req.body?.customer_Name || ""),
      customerPhone: String(req.body?.customer_Mobile || "").replace(/\D/g, "").slice(-10),
      customerEmail: String(req.body?.customer_Emailid || ""),
      addressLine1: String(req.body?.customer_Address || ""),
      addressLine2: String(req.body?.addressLine2 || ""),
      landmark: String(req.body?.landMark || ""),
      pincode: String(req.body?.customer_PinCode || ""),
      city: String(req.body?.customer_City || ""),
      state: String(req.body?.customer_State || ""),
      paymentGateway: Number(req.body?.payment_Mode) === 1 ? "COD" : "Prepaid",
      totalOutstanding: Number(req.body?.payment_Mode) === 1 ? Number(req.body?.cod_Amount || orderAmount) : 0,
      amount: String(orderAmount),
      subtotalPrice: subtotal || orderAmount,
      totalTax: Number(req.body?.tax_Amount || 0),
      totalShippingPrice: Number(req.body?.extra_Charges || 0),
      totalDiscounts: products.reduce((sum, product) => sum + Number(product?.productDiscount || 0), 0),
      currency: "INR",
      warehouse: Number(req.body?.pick_Address_ID),
      platform: "ShipSy",
      courier: String(req.body?.courierName || ""),
      items: products.map((product) => ({
        name: String(product?.productName || "Item"),
        sku: String(product?.sku || product?.productId || ""),
        quantity: Number(product?.quantity || 1),
        unitPrice: Number(product?.unitPrice || 0),
        gstRate: Number(product?.taxRate || 0),
        discount: Number(product?.productDiscount || 0),
        deadWeight: Number(req.body?.shipment_Weight || 0),
        length: Number(req.body?.shipment_Length || 0),
        width: Number(req.body?.shipment_Width || 0),
        height: Number(req.body?.shipment_Height || 0),
      })),
    };
    const response = await fshipFetch("auth/manualcreateOrder", { method: "POST", body: JSON.stringify(payload) });
    const { body } = await readUpstream(response);
    if (!response.ok || body?.success === false) {
      return res.status(response.status || 502).json({ status: false, response: upstreamErrorMessage(body, "Order creation failed") });
    }
    const awb = String(body?.data?.awb || "").trim();
    return res.status(response.status).json({
      status: true,
      response: body?.message,
      apiorderid: body?.data?.id,
      waybill: awb === "-" ? "" : awb,
      order_status: body?.data?.status,
    });
  } catch (error) { next(error); }
});

app.post(["/api/providers/fship/cancelorder", "/api/providers/logixmitra/cancelorder"], async (req, res, next) => {
  try {
    const response = await fshipFetch("orders/cancelshipment", {
      method: "PUT",
      body: JSON.stringify({ referenceId: String(req.body?.referenceId || req.body?.waybill || "") }),
    });
    const { body } = await readUpstream(response);
    return res.status(response.status).json({ status: response.ok && body?.success !== false, response: body?.message || body?.error });
  } catch (error) { next(error); }
});

app.post(["/api/providers/fship/trackinghistory", "/api/providers/fship/shipmentsummary", "/api/providers/logixmitra/trackinghistory", "/api/providers/logixmitra/shipmentsummary"], async (req, res, next) => {
  try {
    const awb = String(req.body?.waybill || "").trim();
    const response = await fshipFetch(`tracking/track/${encodeURIComponent(awb)}`, { method: "GET" }, false);
    const { body } = await readUpstream(response);
    if (!response.ok || body?.success === false) {
      return res.status(response.status || 502).json({ status: false, response: upstreamErrorMessage(body, "Tracking lookup failed") });
    }
    const data = body?.data || {};
    return res.json({
      status: true,
      summary: {
        waybill: data.awb || awb,
        fulfilledby: data.courier,
        status: data.currentStatus,
        lastscandate: data.statusTime,
      },
      trackingdata: (Array.isArray(data.scanDetail) ? data.scanDetail : []).map((scan) => ({
        DateandTime: scan?.date || scan?.timestamp || scan?.statusTime,
        Status: scan?.status || scan?.currentStatus,
        Remark: scan?.remark || scan?.remarks,
        Location: scan?.location,
      })),
    });
  } catch (error) { next(error); }
});

app.post(["/api/providers/fship/registerpickup", "/api/providers/logixmitra/registerpickup"], (_req, res) => {
  res.status(501).json({ status: false, response: "Pickup booking requires an order booking payload from the shipping provider." });
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

function readJsonFile(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return fallback; }
}

function writeJsonFile(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(value, null, 2), { encoding: "utf8", mode: 0o600 });
  fs.renameSync(temporary, file);
}

function requireSeller(req) {
  const seller = requestSeller(req);
  if (!seller) {
    const error = new Error("Please sign in before using the wallet.");
    error.status = 401;
    throw error;
  }
  return seller;
}

function walletLedger() {
  const value = readJsonFile(walletLedgerFile, { transactions: [] });
  return { transactions: Array.isArray(value.transactions) ? value.transactions : [] };
}

function walletBalance(transactions, userId) {
  return transactions
    .filter((transaction) => String(transaction.userId) === String(userId))
    .reduce((total, transaction) => total + (transaction.type === "credit" ? Number(transaction.amount || 0) : -Number(transaction.amount || 0)), 0);
}

function razorpayAuthorization() {
  return `Basic ${Buffer.from(`${requireEnv("RAZORPAY_KEY_ID")}:${requireEnv("RAZORPAY_KEY_SECRET")}`).toString("base64")}`;
}

async function razorpayRequest(pathname, options = {}) {
  const response = await fetch(`https://api.razorpay.com/v1/${pathname.replace(/^\/+/, "")}`, {
    ...options,
    headers: { Accept: "application/json", Authorization: razorpayAuthorization(), ...(options.headers || {}) },
  });
  const text = await response.text();
  let body;
  try { body = text ? JSON.parse(text) : {}; } catch { body = { message: text }; }
  if (!response.ok) {
    const error = new Error(body?.error?.description || body?.message || `Razorpay returned HTTP ${response.status}`);
    error.status = response.status >= 400 && response.status < 500 ? response.status : 502;
    throw error;
  }
  return body;
}

function safeSignatureEqual(expected, received) {
  const expectedBuffer = Buffer.from(String(expected || ""), "hex");
  const receivedBuffer = Buffer.from(String(received || ""), "hex");
  return expectedBuffer.length > 0 && expectedBuffer.length === receivedBuffer.length && crypto.timingSafeEqual(expectedBuffer, receivedBuffer);
}

app.get("/api/wallet/balance", (req, res, next) => {
  try {
    const seller = requireSeller(req);
    const ledger = walletLedger();
    res.json({ balance: walletBalance(ledger.transactions, seller.id), currency: "INR" });
  } catch (error) { next(error); }
});

app.get("/api/wallet/transactions", (req, res, next) => {
  try {
    const seller = requireSeller(req);
    const ledger = walletLedger();
    const page = Math.max(1, Number(req.query.page || 1));
    const limit = Math.min(100, Math.max(1, Number(req.query.limit || 10)));
    const type = String(req.query.type || "").trim();
    const serviceProvider = String(req.query.serviceProvider || "").trim();
    const all = ledger.transactions
      .filter((transaction) => String(transaction.userId) === String(seller.id))
      .filter((transaction) => !type || transaction.type === type)
      .filter((transaction) => !serviceProvider || transaction.meta?.serviceProvider === serviceProvider)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    const transactions = all.slice((page - 1) * limit, page * limit);
    const credits = all.filter((transaction) => transaction.type === "credit").reduce((total, transaction) => total + Number(transaction.amount || 0), 0);
    const debits = all.filter((transaction) => transaction.type === "debit").reduce((total, transaction) => total + Number(transaction.amount || 0), 0);
    res.json({
      transactions,
      pagination: { page, limit, total: all.length, totalPages: Math.max(1, Math.ceil(all.length / limit)) },
      stats: { totalCredits: credits, totalDebits: debits },
      courierOptions: [...new Set(all.map((transaction) => transaction.meta?.serviceProvider).filter(Boolean))],
    });
  } catch (error) { next(error); }
});

app.post("/api/wallet/recharge/create-order", async (req, res, next) => {
  try {
    const seller = requireSeller(req);
    const amount = Math.round(Number(req.body?.amount) * 100) / 100;
    if (!Number.isFinite(amount) || amount < 100 || amount > 500000) {
      const error = new Error("Recharge amount must be between INR 100 and INR 5,00,000.");
      error.status = 400;
      throw error;
    }
    const amountPaise = Math.round(amount * 100);
    const receipt = `shipsy_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;
    const order = await razorpayRequest("orders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ amount: amountPaise, currency: "INR", receipt, notes: { sellerId: seller.id, source: "shipsy_wallet" } }),
    });
    const pending = readJsonFile(razorpayOrdersFile, { orders: {} });
    pending.orders = pending.orders && typeof pending.orders === "object" ? pending.orders : {};
    pending.orders[order.id] = { sellerId: seller.id, amount, amountPaise, currency: "INR", receipt, createdAt: new Date().toISOString(), status: "created" };
    writeJsonFile(razorpayOrdersFile, pending);
    res.status(201).json({ orderId: order.id, amount, currency: "INR", keyId: requireEnv("RAZORPAY_KEY_ID") });
  } catch (error) { next(error); }
});

app.post("/api/wallet/recharge/verify", async (req, res, next) => {
  try {
    const seller = requireSeller(req);
    const razorpayOrderId = String(req.body?.razorpayOrderId || "").trim();
    const razorpayPaymentId = String(req.body?.razorpayPaymentId || "").trim();
    const razorpaySignature = String(req.body?.razorpaySignature || "").trim();
    const pending = readJsonFile(razorpayOrdersFile, { orders: {} });
    const order = pending.orders?.[razorpayOrderId];
    if (!order || String(order.sellerId) !== String(seller.id)) {
      const error = new Error("This Razorpay order does not belong to the signed-in seller.");
      error.status = 400;
      throw error;
    }
    const expected = crypto.createHmac("sha256", requireEnv("RAZORPAY_KEY_SECRET")).update(`${razorpayOrderId}|${razorpayPaymentId}`).digest("hex");
    if (!safeSignatureEqual(expected, razorpaySignature)) {
      const error = new Error("Razorpay signature verification failed.");
      error.status = 400;
      throw error;
    }
    const payment = await razorpayRequest(`payments/${encodeURIComponent(razorpayPaymentId)}`);
    if (payment.order_id !== razorpayOrderId || payment.status !== "captured" || Number(payment.amount) !== Number(order.amountPaise) || payment.currency !== "INR") {
      const error = new Error("Razorpay payment is not captured for this wallet order.");
      error.status = 400;
      throw error;
    }
    const ledger = walletLedger();
    const existing = ledger.transactions.find((transaction) => transaction.meta?.razorpayPaymentId === razorpayPaymentId);
    if (!existing) {
      ledger.transactions.unshift({
        id: crypto.randomUUID(), walletId: `wallet-${seller.id}`, userId: seller.id, amount: Number(order.amount), currency: "INR", type: "credit",
        reason: "Wallet recharge via Razorpay", ref: razorpayPaymentId,
        meta: { razorpayOrderId, razorpayPaymentId, receipt: order.receipt }, createdAt: new Date().toISOString(),
      });
      writeJsonFile(walletLedgerFile, ledger);
    }
    pending.orders[razorpayOrderId] = { ...order, status: "credited", razorpayPaymentId, creditedAt: new Date().toISOString() };
    writeJsonFile(razorpayOrdersFile, pending);
    res.json({ message: existing ? "Payment was already credited." : "Wallet recharged successfully.", balance: walletBalance(ledger.transactions, seller.id), creditedAmount: Number(order.amount) });
  } catch (error) { next(error); }
});

app.post("/api/webhooks/razorpay", (req, res, next) => {
  try {
    const webhookSecret = String(process.env.RAZORPAY_WEBHOOK_SECRET || "").trim();
    if (!webhookSecret) return res.status(503).json({ message: "Razorpay webhook secret is not configured." });
    const signature = String(req.get("x-razorpay-signature") || "").trim();
    const expected = crypto.createHmac("sha256", webhookSecret).update(req.rawBody || Buffer.from("")).digest("hex");
    if (!safeSignatureEqual(expected, signature)) return res.status(400).json({ message: "Invalid Razorpay webhook signature." });
    res.status(200).json({ received: true });
  } catch (error) { next(error); }
});

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
    const body = await fetchJson(`${fshipApiBaseUrl}/tracking/track/${encodeURIComponent(awb)}`, {
      headers: { Accept: "application/json" },
    });
    const summary = body?.data || {};
    return { text: String(summary.currentStatus || body?.message || ""), timestamp: summary.statusTime || null, location: summary.location || null };
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
      if (currentStatus === "draft" || terminalTrackingStatuses.has(currentStatus)) continue;
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

app.post("/api/provider-orders/drafts", (req, res) => {
  const seller = requestSeller(req);
  if (!seller) return res.status(401).json({ message: "Seller identity is required" });
  const payload = req.body || {};
  const orderId = String(payload.orderId || "").trim();
  if (!orderId) return res.status(400).json({ message: "Order ID is required" });
  const duplicate = [...providerOrders.values()].find((order) =>
    String(order?.userId || "") === String(seller.id) &&
    String(order?.orderId || "").toLowerCase() === orderId.toLowerCase() &&
    dashboardStatus(order) !== "cancelled",
  );
  if (duplicate) return res.status(409).json({ message: `Order ID ${orderId} already exists` });

  const now = new Date().toISOString();
  const draft = {
    id: `draft-${crypto.randomUUID()}`,
    userId: seller.id,
    user: seller,
    orderId,
    orderType: payload.orderType === "B2B" ? "B2B" : "B2C",
    paymentType: payload.paymentType === "cod" ? "cod" : "prepaid",
    status: "draft",
    courierId: "",
    courierName: null,
    serviceProvider: "",
    awb: "",
    pickupAddressId: String(payload.pickupAddressId || ""),
    deliveryAddress: {
      contactName: String(payload.buyerName || ""),
      phone: String(payload.buyerPhone || ""),
      email: payload.buyerEmail ? String(payload.buyerEmail) : undefined,
      addressLine1: String(payload.address || ""),
      addressLine2: payload.address2 ? String(payload.address2) : undefined,
      city: String(payload.city || ""),
      state: String(payload.state || ""),
      country: "India",
      pincode: String(payload.pincode || ""),
    },
    weight: Number(payload.weight) || 0,
    length: Number(payload.length) || 0,
    breadth: Number(payload.breadth) || 0,
    height: Number(payload.height) || 0,
    chargeableWeight: 0,
    products: Array.isArray(payload.products) ? payload.products : [],
    orderAmount: Number(payload.orderAmount) || 0,
    codAmount: Number(payload.codAmount) || 0,
    rate: { forward: 0, rto: 0, codCharges: 0, otherCharges: 0, freightCharge: 0, totalCharge: 0, zone: "" },
    companyName: payload.companyName,
    companyGst: payload.companyGst,
    packages: payload.packages,
    invoices: payload.invoices,
    draftPayload: payload,
    createdAt: now,
    updatedAt: now,
  };
  providerOrders.set(draft.id, draft);
  persistProviderOrders();
  return res.status(201).json({ order: publicOrder(draft) });
});

app.delete("/api/provider-orders/:id/draft", (req, res) => {
  const order = findProviderOrder(req.params.id);
  if (!order || !canAccessProviderOrder(req, order)) return res.status(404).json({ message: "Draft not found" });
  if (dashboardStatus(order) !== "draft") return res.status(409).json({ message: "Only draft orders can be removed" });
  providerOrders.delete(String(order.id));
  persistProviderOrders();
  return res.json({ success: true });
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
