import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const PASSWORD_MASK = "********";
const INDIA_POST_ID = "sp-india-post";
const DEFAULT_BASE_URL = "https://test.cept.gov.in/beextcustomer";

const credentialFields = [
  { key: "environment", label: "Environment (sandbox/production)", type: "text", required: true },
  { key: "baseUrl", label: "API Base URL", type: "text", required: true },
  { key: "username", label: "API Username", type: "text", required: true },
  { key: "password", label: "API Password", type: "password", required: true },
  { key: "customerId", label: "Customer ID (10 digits)", type: "text", required: true },
  { key: "speedPostContractId", label: "Speed Post Contract ID", type: "text", required: true },
  { key: "businessParcelContractId", label: "Business Parcel Contract ID", type: "text", required: false },
  { key: "defaultOfficeId", label: "Drop-off Office ID (8 digits)", type: "text", required: true },
  { key: "defaultOfficeName", label: "Drop-off Office Name", type: "text", required: false },
  { key: "defaultPincode", label: "Drop-off Pincode", type: "text", required: true },
  { key: "barcodePrefix", label: "Allocated Barcode Prefix", type: "text", required: true },
  { key: "nextBarcodeSerial", label: "Next Barcode Serial (8 digits)", type: "text", required: true },
];

function defaults() {
  return {
    environment: "sandbox",
    baseUrl: DEFAULT_BASE_URL,
    username: "",
    passwordEncrypted: "",
    customerId: "9999605907",
    speedPostContractId: "41585456",
    businessParcelContractId: "41367422",
    defaultOfficeId: "",
    defaultOfficeName: "",
    defaultPincode: "",
    barcodePrefix: "ET",
    nextBarcodeSerial: "21433001",
    isEnabled: true,
    updatedAt: new Date(0).toISOString(),
  };
}

function encryptionKey() {
  const secret = String(process.env.INDIA_POST_CONFIG_SECRET || process.env.OTP_SECRET || "").trim();
  if (!secret) throw Object.assign(new Error("INDIA_POST_CONFIG_SECRET is not configured"), { status: 503 });
  return crypto.createHash("sha256").update(secret).digest();
}

function encrypt(value) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(String(value), "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), ciphertext].map((part) => part.toString("base64url")).join(".");
}

function decrypt(value) {
  if (!value) return "";
  const [iv, tag, ciphertext] = String(value).split(".").map((part) => Buffer.from(part, "base64url"));
  const decipher = crypto.createDecipheriv("aes-256-gcm", encryptionKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}

function readConfig(file) {
  try {
    return { ...defaults(), ...JSON.parse(fs.readFileSync(file, "utf8")) };
  } catch {
    return defaults();
  }
}

function writeConfig(file, config) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(config, null, 2), { encoding: "utf8", mode: 0o600 });
  fs.renameSync(temp, file);
  return config;
}

function publicValues(config) {
  return {
    environment: config.environment,
    baseUrl: config.baseUrl,
    username: config.username,
    password: config.passwordEncrypted ? PASSWORD_MASK : "",
    customerId: config.customerId,
    speedPostContractId: config.speedPostContractId,
    businessParcelContractId: config.businessParcelContractId,
    defaultOfficeId: config.defaultOfficeId,
    defaultOfficeName: config.defaultOfficeName,
    defaultPincode: config.defaultPincode,
    barcodePrefix: config.barcodePrefix,
    nextBarcodeSerial: config.nextBarcodeSerial,
  };
}

function isConfigured(config) {
  const productionSettingsAreSafe = config.environment !== "production" || (
    !String(config.baseUrl).includes("test.cept.gov.in") && config.customerId !== "9999605907"
  );
  return Boolean(
    config.isEnabled && config.baseUrl && config.username && config.passwordEncrypted &&
    /^\d{10}$/.test(config.customerId) && /^\d{8}$/.test(config.speedPostContractId) &&
    /^\d{8}$/.test(config.defaultOfficeId) && /^\d{6}$/.test(config.defaultPincode) &&
    /^[A-Z]{2}$/.test(config.barcodePrefix) && /^\d{8}$/.test(config.nextBarcodeSerial) && productionSettingsAreSafe,
  );
}

function safeBaseUrl(value) {
  const url = new URL(String(value || DEFAULT_BASE_URL));
  if (url.protocol !== "https:" || !(url.hostname === "gov.in" || url.hostname.endsWith(".gov.in"))) {
    throw Object.assign(new Error("India Post Base URL must be an HTTPS gov.in address"), { status: 400 });
  }
  return url.toString().replace(/\/$/, "");
}

function requireConfig(file) {
  const config = readConfig(file);
  if (!isConfigured(config)) {
    throw Object.assign(new Error("India Post is not fully configured in Admin > Service Providers"), { status: 503 });
  }
  return config;
}

function findToken(body) {
  const queue = [body];
  while (queue.length) {
    const value = queue.shift();
    if (!value || typeof value !== "object") continue;
    for (const key of ["access_token", "accessToken", "token", "jwtToken", "jwt_token"]) {
      if (typeof value[key] === "string" && value[key]) return value[key];
    }
    queue.push(...Object.values(value).filter((item) => item && typeof item === "object"));
  }
  return "";
}

async function readResponse(response) {
  const text = await response.text();
  try { return text ? JSON.parse(text) : {}; } catch { return { message: text || response.statusText }; }
}

let tokenCache = { key: "", token: "", expiresAt: 0 };
async function accessToken(config, force = false) {
  const key = `${config.baseUrl}:${config.username}`;
  if (!force && tokenCache.key === key && tokenCache.expiresAt > Date.now() + 30_000) return tokenCache.token;
  const response = await fetch(`${safeBaseUrl(config.baseUrl)}/v1/access/Login`, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({ username: config.username, password: decrypt(config.passwordEncrypted) }),
  });
  const body = await readResponse(response);
  if (!response.ok) throw Object.assign(new Error(body?.message || "India Post login failed"), { status: response.status });
  const token = findToken(body);
  if (!token) throw Object.assign(new Error("India Post login did not return an access token"), { status: 502 });
  tokenCache = { key, token, expiresAt: Date.now() + 14 * 60_000 };
  return token;
}

async function indiaPostFetch(config, endpoint, options = {}, retry = true) {
  const token = await accessToken(config);
  const response = await fetch(`${safeBaseUrl(config.baseUrl)}${endpoint}`, {
    ...options,
    headers: { Accept: "application/json", Authorization: `Bearer ${token}`, ...(options.headers || {}) },
  });
  if (response.status === 401 && retry) {
    await accessToken(config, true);
    return indiaPostFetch(config, endpoint, options, false);
  }
  const body = await readResponse(response);
  if (!response.ok) throw Object.assign(new Error(body?.message || body?.error || `India Post returned HTTP ${response.status}`), { status: response.status, details: body });
  return body;
}

function barcodeCheckDigit(serial) {
  const weights = [8, 6, 4, 2, 3, 5, 9, 7];
  const remainder = serial.split("").reduce((sum, digit, index) => sum + Number(digit) * weights[index], 0) % 11;
  if (remainder === 0) return "5";
  if (remainder === 1) return "0";
  const result = 11 - remainder;
  return String(result === 10 ? 0 : result);
}

function takeBarcode(file, config) {
  const serial = String(config.nextBarcodeSerial).padStart(8, "0");
  if (!/^\d{8}$/.test(serial)) throw Object.assign(new Error("Next India Post barcode serial must contain 8 digits"), { status: 400 });
  const barcode = `${config.barcodePrefix}${serial}${barcodeCheckDigit(serial)}IN`;
  config.nextBarcodeSerial = String(Number(serial) + 1).padStart(8, "0");
  config.updatedAt = new Date().toISOString();
  writeConfig(file, config);
  return barcode;
}

function amountFrom(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && /^\d+(\.\d+)?$/.test(value.trim())) return Number(value);
  if (!value || typeof value !== "object") return 0;
  for (const key of ["final_amount", "finalAmount", "total_amount", "totalAmount", "total_tariff", "totalTariff", "tariff", "amount", "total", "gross_amount"]) {
    const amount = amountFrom(value[key]);
    if (amount > 0) return amount;
  }
  for (const child of Object.values(value).filter((item) => item && typeof item === "object")) {
    const amount = amountFrom(child);
    if (amount > 0) return amount;
  }
  return 0;
}

function articleFromOrder(order, pickup, config, barcode) {
  const weight = Math.max(1, Math.ceil(Number(order.weight || order.chargeableWeight || 0)));
  const businessParcel = String(order.courierId || "").includes("business-parcel");
  const contractId = businessParcel ? config.businessParcelContractId : config.speedPostContractId;
  if (!/^\d{8}$/.test(contractId || "")) throw Object.assign(new Error("Selected India Post product contract ID is not configured"), { status: 400 });
  return {
    bulk_customer_id: config.customerId,
    contract_id: contractId,
    barcode_no: barcode,
    pickup_or_dropoff: "dropoff",
    pickup_dropoff_office_id: Number(config.defaultOfficeId),
    article_type: businessParcel ? "BP" : "SP",
    physical_weight: weight,
    shape_of_article: "",
    length: String(Math.max(1, Number(order.length || 1))),
    breadth_diameter: String(Math.max(1, Number(order.breadth || 1))),
    height: String(Math.max(1, Number(order.height || 1))),
    priority_flag: "",
    delivery_instruction: "",
    delivery_slot: "",
    instruction_rts: "",
    sender_name: String(pickup.contactName || pickup.nickname || "ShipSy Seller").slice(0, 80),
    sender_company: String(pickup.nickname || pickup.contactName || "ShipSy").slice(0, 80),
    sender_add_line_1: String(pickup.addressLine1 || "").slice(0, 120),
    sender_add_line_2: String(pickup.addressLine2 || "").slice(0, 120),
    sender_city: String(pickup.city || "").slice(0, 80),
    sender_state: String(pickup.state || "").slice(0, 80),
    sender_pincode: String(pickup.pincode || config.defaultPincode),
    sender_emailid: String(pickup.email || ""), sender_alt_contact: "", sender_kyc: "", sender_tax_reference: "",
    receiver_name: String(order.buyerName || "").slice(0, 80),
    receiver_company: String(order.companyName || order.buyerName || "").slice(0, 80),
    receiver_add_line_1: String(order.address || "").slice(0, 120),
    receiver_add_line_2: String(order.address2 || "").slice(0, 120),
    receiver_city: String(order.city || "").slice(0, 80), receiver_state: String(order.state || "").slice(0, 80),
    receiver_pincode: String(order.pincode || ""), receiver_emailid: String(order.buyerEmail || ""),
    receiver_alt_contact: "", receiver_kyc: "", receiver_tax_reference: "", alt_address_flag: "FALSE",
    pickup_address_flag: "", drop_off_pincode: config.defaultPincode,
    sender_mobile_no: String(pickup.phone || ""), receiver_mobile_no: String(order.buyerPhone || ""),
    prepayment_code: "", value_of_prepayment: 0,
    codr_cod: order.paymentType === "cod" ? "COD" : "", value_for_codr_cod: order.paymentType === "cod" ? Number(order.codAmount || order.orderAmount || 0) : 0,
    insurance_type: "", value_of_insurance: 0, ack: "FALSE", reg: "FALSE", otp: "FALSE",
    bulk_reference: String(order.orderId || ""), pickup_address_id: "", pickup_addressee_name: "", pickup_company_name: "",
    pickup_address_line1: "", pickup_address_line2: "", pickup_address_line3: "", pickup_city: "", pickup_state: "", pickup_pincode: "",
    pickup_email_id: "", pickup_alt_contact_no: "0", pickup_mobile_no: "0", pickup_schedule_slot: "", pickup_schedule_date: "",
    alt_addressee_name: "", alt_company_name: "", alt_address_line1: "", alt_address_line2: "", alt_address_line3: "",
    alt_city: "", alt_state: "", alt_pincode: "", alt_email_id: "", alt_contact_no: "0", alt_alternate_mobile_no: "",
  };
}

function firstArticleResult(body) {
  const candidates = [body?.valid_articles, body?.validArticles, body?.data?.valid_articles, body?.data?.validArticles];
  for (const value of candidates) if (Array.isArray(value) && value.length) return value[0];
  return body?.data?.[0] || body;
}

export function registerIndiaPostRoutes(app, { dataDir }) {
  const file = process.env.INDIA_POST_CONFIG_FILE || path.join(dataDir, "india-post-config.json");
  const provider = (config) => ({
    id: INDIA_POST_ID, serviceProvider: "india-post", displayName: "India Post", logoUrl: "", totalCouriers: 2,
    enabledCouriers: config.isEnabled ? 2 : 0, serviceProviderDisplayName: "India Post", isEnabled: config.isEnabled,
    b2c: { configured: isConfigured(config) }, b2b: { configured: false, sameAsB2c: true },
    status: config.isEnabled ? "active" : "inactive", updatedAt: config.updatedAt,
  });
  const credentials = (config) => ({
    b2c: { fields: credentialFields, description: "Secure India Post sandbox/production authentication, tariff, booking, tracking and label settings.", values: publicValues(config) },
    b2b: { fields: credentialFields, description: "India Post currently uses the same configured account for supported parcel services.", values: publicValues(config), sameAsB2c: true },
  });

  app.get("/api/admin/service-providers", (_req, res) => {
    const item = provider(readConfig(file));
    res.json({ providers: [item], stats: { total: 1, active: item.status === "active" ? 1 : 0, b2cConfigured: item.b2c.configured ? 1 : 0 }, pagination: { page: 1, limit: 50, total: 1, totalPages: 1 } });
  });
  app.get(`/api/admin/service-providers/${INDIA_POST_ID}`, (_req, res) => res.json({ provider: provider(readConfig(file)) }));
  app.get(`/api/admin/service-providers/${INDIA_POST_ID}/credentials`, (_req, res) => res.json(credentials(readConfig(file))));
  app.patch(`/api/admin/service-providers/${INDIA_POST_ID}/credentials`, (req, res, next) => {
    try {
      const incoming = req.body?.credentials || {};
      const config = readConfig(file);
      for (const key of Object.keys(publicValues(config))) {
        if (key === "password") continue;
        if (typeof incoming[key] === "string" && incoming[key].trim()) config[key] = incoming[key].trim();
      }
      if (incoming.password && incoming.password !== PASSWORD_MASK) config.passwordEncrypted = encrypt(incoming.password);
      config.baseUrl = safeBaseUrl(config.baseUrl);
      config.barcodePrefix = String(config.barcodePrefix).toUpperCase();
      config.updatedAt = new Date().toISOString();
      writeConfig(file, config);
      tokenCache = { key: "", token: "", expiresAt: 0 };
      res.json({ success: true, configured: isConfigured(config) });
    } catch (error) { next(error); }
  });
  app.put(`/api/admin/service-providers/${INDIA_POST_ID}`, (req, res) => {
    const config = readConfig(file);
    if (typeof req.body?.isEnabled === "boolean") config.isEnabled = req.body.isEnabled;
    if (req.body?.status) config.isEnabled = req.body.status === "active";
    config.updatedAt = new Date().toISOString();
    writeConfig(file, config);
    res.json({ provider: provider(config) });
  });

  app.get("/api/providers/india-post/status", (_req, res) => {
    const config = readConfig(file);
    res.json({ configured: isConfigured(config), environment: config.environment, customerId: config.customerId, products: ["speed-post", ...(config.businessParcelContractId ? ["business-parcel"] : [])] });
  });
  app.post("/api/providers/india-post/rates", async (req, res, next) => {
    try {
      const config = requireConfig(file);
      const product = req.body?.product === "business-parcel" ? "business-parcel" : "speed-post";
      const endpoint = product === "business-parcel" ? "/v1/parcel-tariff/calculate" : "/v1/speed-post/tariffs";
      const query = new URLSearchParams({
        "product-code": product === "business-parcel" ? "BP" : "SP", weight: String(Math.max(1, Math.ceil(Number(req.body?.weight || 0)))),
        "source-pincode": String(req.body?.origin || ""), "destination-pincode": String(req.body?.destination || ""),
        length: String(Math.max(1, Number(req.body?.length || 1))), width: String(Math.max(1, Number(req.body?.breadth || 1))),
        height: String(Math.max(0.5, Number(req.body?.height || 0.5))), INS: "0", POD: "NO",
      });
      const raw = await indiaPostFetch(config, `${endpoint}?${query}`);
      const total = amountFrom(raw);
      if (!(total > 0)) throw Object.assign(new Error("India Post tariff response did not contain a valid amount"), { status: 502 });
      res.json({ product, total, raw });
    } catch (error) { next(error); }
  });
  app.post("/api/providers/india-post/book", async (req, res, next) => {
    try {
      const config = requireConfig(file);
      const pickup = req.body?.pickup || {};
      for (const [label, value] of [["sender address", pickup.addressLine1], ["sender city", pickup.city], ["sender state", pickup.state], ["sender pincode", pickup.pincode], ["sender mobile", pickup.phone]]) {
        if (!String(value || "").trim()) throw Object.assign(new Error(`India Post requires ${label} in the selected pickup address`), { status: 400 });
      }
      const barcode = takeBarcode(file, config);
      const article = articleFromOrder(req.body?.order || {}, pickup, config, barcode);
      const form = new FormData();
      form.append("file", new Blob([JSON.stringify({ articles: [article] })], { type: "application/json" }), `shipsy-${barcode}.json`);
      const raw = await indiaPostFetch(config, `/process-articles-file/${config.customerId}`, { method: "POST", body: form });
      const result = firstArticleResult(raw);
      const errors = raw?.error_articles || raw?.errorArticles || raw?.data?.error_articles;
      if (Array.isArray(errors) && errors.length) throw Object.assign(new Error(errors[0]?.message || errors[0]?.error || "India Post rejected the shipment"), { status: 400, details: raw });
      res.status(201).json({ success: true, awb: String(result?.barcode_no || result?.barcode || result?.article_number || barcode), providerOrderId: String(raw?.batch_id || raw?.batchId || result?.booking_reference || barcode), raw });
    } catch (error) { next(error); }
  });
  app.get("/api/providers/india-post/track", async (req, res, next) => {
    try {
      const awb = String(req.query?.awb || "").trim();
      if (!/^[A-Z]{2}\d{9}IN$/.test(awb)) return res.status(400).json({ message: "A valid India Post article number is required" });
      const config = requireConfig(file);
      res.json(await indiaPostFetch(config, "/v1/tracking/bulk", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ bulk: [awb] }) }));
    } catch (error) { next(error); }
  });
}
