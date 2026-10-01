import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import multer from "multer";
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";

const DOCUMENT_KEYS = [
  "selfie", "panCard", "aadhaar", "cancelledCheque", "boardResolution",
  "partnershipDeed", "llpAgreement", "companyAddressProof", "businessPan", "gstCertificate",
];
const DOCUMENT_KEY_SET = new Set(DOCUMENT_KEYS);
const REQUIRED_DOCUMENTS = {
  individual: ["selfie", "panCard", "aadhaar"],
  sole_proprietor: ["selfie", "panCard", "aadhaar", "gstCertificate"],
  partnership_firm: ["selfie", "partnershipDeed", "panCard", "aadhaar", "gstCertificate"],
  private_limited: ["selfie", "businessPan", "aadhaar", "boardResolution", "gstCertificate"],
  public_limited: ["selfie", "businessPan", "aadhaar", "gstCertificate"],
  one_person_company: ["selfie", "businessPan", "aadhaar", "companyAddressProof"],
  llp: ["selfie", "businessPan", "aadhaar", "companyAddressProof", "llpAgreement"],
  section_8_company: ["selfie", "businessPan", "aadhaar", "companyAddressProof", "boardResolution"],
};

const maxUploadBytes = Number(process.env.MAX_UPLOAD_BYTES || 15 * 1024 * 1024);
export const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: maxUploadBytes, files: 5 },
});

let client;
function clean(value) {
  return String(value || "").trim().replace(/^("|')(.*)\1$/, "$2").trim();
}

function storageConfig() {
  const bucket = clean(process.env.PROD_BUCKET || process.env.R2_BUCKET);
  let endpoint = clean(process.env.R2_ENDPOINT).replace(/\/+$/, "");
  if (bucket && endpoint.endsWith(`/${bucket}`)) endpoint = endpoint.slice(0, -(bucket.length + 1));
  const accessKeyId = clean(process.env.R2_ACCESS_KEY_ID);
  const secretAccessKey = clean(process.env.R2_SECRET_ACCESS_KEY);
  if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) {
    const error = new Error("ShipSy R2 storage is not fully configured");
    error.status = 503;
    throw error;
  }
  return {
    endpoint,
    bucket,
    prefix: clean(process.env.R2_PREFIX || "shipsy").replace(/^\/+|\/+$/g, "") || "shipsy",
    accessKeyId,
    secretAccessKey,
  };
}

function r2Client() {
  if (client) return client;
  const config = storageConfig();
  client = new S3Client({
    region: "auto",
    endpoint: config.endpoint,
    forcePathStyle: true,
    credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
  });
  return client;
}

function safePart(value, fallback = "unknown") {
  const result = String(value || fallback).trim().replace(/[^a-zA-Z0-9@._-]+/g, "-").replace(/^-+|-+$/g, "");
  return result || fallback;
}

export function shipsyObjectKey(...parts) {
  const { prefix } = storageConfig();
  return [prefix, ...parts.map((part) => safePart(part))].join("/");
}

export async function putShipsyObject(key, body, contentType, metadata = {}) {
  const { bucket, prefix } = storageConfig();
  if (!key.startsWith(`${prefix}/`)) throw new Error("Refusing to write outside the ShipSy storage prefix");
  await r2Client().send(new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: body,
    ContentType: contentType || "application/octet-stream",
    Metadata: Object.fromEntries(Object.entries(metadata).map(([name, value]) => [name, String(value)])),
  }));
  return key;
}

async function getShipsyObject(key) {
  const { bucket, prefix } = storageConfig();
  if (!key.startsWith(`${prefix}/`)) throw Object.assign(new Error("Invalid ShipSy object key"), { status: 400 });
  return r2Client().send(new GetObjectCommand({ Bucket: bucket, Key: key }));
}

function jsonStore(dataDir, name, fallback) {
  const filename = path.join(dataDir, name);
  function read() {
    try { return JSON.parse(fs.readFileSync(filename, "utf8")); } catch { return structuredClone(fallback); }
  }
  function write(value) {
    fs.mkdirSync(path.dirname(filename), { recursive: true });
    const temporary = `${filename}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(value, null, 2), "utf8");
    fs.renameSync(temporary, filename);
  }
  return { read, write };
}

function normalizedSellerEmail(value) {
  const email = String(value || "").trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : "";
}

export function createSellerRegistry(dataDir) {
  const store = jsonStore(dataDir, "sellers.json", []);

  function list() {
    const records = store.read();
    return Array.isArray(records) ? records : [];
  }

  function findByEmail(email) {
    const normalized = normalizedSellerEmail(email);
    return normalized
      ? list().find((seller) => normalizedSellerEmail(seller?.email) === normalized) || null
      : null;
  }

  function upsert(record) {
    const email = normalizedSellerEmail(record?.email);
    const requestedId = String(record?.id || "").trim();
    if (!email && !requestedId) throw Object.assign(new Error("seller.id or seller.email is required"), { status: 400 });

    const canonicalId = email ? `client-${email}` : requestedId;
    const records = list();
    const matches = records.filter((seller) =>
      String(seller?.id || "") === canonicalId ||
      (email && normalizedSellerEmail(seller?.email) === email),
    );
    const current = Object.assign({}, ...matches);
    const next = {
      ...current,
      ...record,
      id: canonicalId,
      email: email || record.email || null,
      createdAt: current.createdAt || record.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    if (current.planAssignedByAdmin === true && record.planAssignedByAdmin !== true) {
      next.plan = current.plan;
      next.planAssignedByAdmin = true;
    }
    store.write([
      next,
      ...records.filter((seller) =>
        String(seller?.id || "") !== canonicalId &&
        (!email || normalizedSellerEmail(seller?.email) !== email),
      ),
    ]);
    return next;
  }

  return { list, findByEmail, upsert };
}

function requestUser(req) {
  return safePart(req.get("x-shipsy-user-id") || req.get("x-shipsy-user-email") || "anonymous");
}

function emptyDocument() { return { status: "not_uploaded" }; }
function emptyKyc(userId) {
  const now = new Date().toISOString();
  return {
    id: `kyc-${userId}`, userId, status: "not_submitted",
    ...Object.fromEntries(DOCUMENT_KEYS.map((key) => [key, emptyDocument()])),
    createdAt: now, updatedAt: now,
  };
}

function publicObjectUrl(key) {
  const base = clean(process.env.PUBLIC_API_URL || "https://api.goshipsy.in/api").replace(/\/+$/, "");
  return `${base}/storage/object/${Buffer.from(key).toString("base64url")}`;
}

function attachmentMeta(file, key) {
  return { id: crypto.randomUUID(), name: file.originalname, contentType: file.mimetype, size: file.size, storageKey: key };
}

export function registerStorageRoutes(app, { dataDir, sellerRegistry = createSellerRegistry(dataDir) }) {
  const kycStore = jsonStore(dataDir, "kyc.json", {});
  const labelStore = jsonStore(dataDir, "label-settings.json", {});
  const ticketStore = jsonStore(dataDir, "support-tickets.json", []);

  app.get("/api/sellers", (_req, res) => {
    const kycRecords = kycStore.read();
    const users = sellerRegistry.list().map((seller) => ({
      ...seller,
      kycStatus: kycRecords[seller.id]?.status || seller.kycStatus || "not_submitted",
    }));
    res.json({ users });
  });

  app.post("/api/sellers", (req, res, next) => {
    try {
      res.status(201).json({ user: sellerRegistry.upsert(req.body?.seller) });
    } catch (error) { next(error); }
  });

  app.get("/api/storage/health", async (_req, res, next) => {
    const key = shipsyObjectKey("healthchecks", `check-${crypto.randomUUID()}.txt`);
    try {
      const { bucket, prefix } = storageConfig();
      await putShipsyObject(key, Buffer.from("shipsy-r2-ok"), "text/plain", { service: "shipsy" });
      await r2Client().send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
      await r2Client().send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
      res.json({ ok: true, provider: "cloudflare-r2", bucket, prefix: `${prefix}/` });
    } catch (error) { next(error); }
  });

  app.get("/api/storage/object/:encoded", async (req, res, next) => {
    try {
      const key = Buffer.from(req.params.encoded, "base64url").toString("utf8");
      const object = await getShipsyObject(key);
      res.type(object.ContentType || "application/octet-stream");
      if (object.ContentLength) res.set("Content-Length", String(object.ContentLength));
      res.set("Cache-Control", "private, max-age=300");
      object.Body.pipe(res);
    } catch (error) { next(error); }
  });

  app.get("/api/kyc", (req, res) => {
    const userId = requestUser(req);
    const all = kycStore.read();
    res.json({ success: true, kyc: all[userId] || emptyKyc(userId) });
  });

  app.post("/api/kyc/upload", upload.single("document"), async (req, res, next) => {
    try {
      const userId = requestUser(req);
      const documentKey = String(req.body?.documentKey || "");
      if (!DOCUMENT_KEY_SET.has(documentKey)) return res.status(400).json({ message: "Invalid KYC document type" });
      if (!req.file) return res.status(400).json({ message: "Document file is required" });
      if (!/^(image\/(jpeg|png|webp)|application\/pdf)$/.test(req.file.mimetype)) return res.status(415).json({ message: "Only PDF, JPG, PNG, and WebP documents are supported" });
      const key = shipsyObjectKey("kyc", userId, documentKey, `${crypto.randomUUID()}-${req.file.originalname}`);
      await putShipsyObject(key, req.file.buffer, req.file.mimetype, { userId, documentKey });
      const all = kycStore.read();
      const current = all[userId] || emptyKyc(userId);
      const kyc = {
        ...current,
        status: current.status === "approved" ? "pending" : current.status,
        [documentKey]: { url: publicObjectUrl(key), status: "pending", mime: req.file.mimetype, storageKey: key },
        updatedAt: new Date().toISOString(),
      };
      all[userId] = kyc; kycStore.write(all);
      res.json({ success: true, kyc });
    } catch (error) { next(error); }
  });

  app.post("/api/kyc", (req, res) => {
    const userId = requestUser(req);
    const all = kycStore.read();
    const current = all[userId] || emptyKyc(userId);
    const structure = String(req.body?.businessStructure || "");
    const required = structure === "company" ? (REQUIRED_DOCUMENTS[req.body?.companyType] || []) : (REQUIRED_DOCUMENTS[structure] || []);
    const missingDocuments = required.filter((key) => !current[key]?.storageKey);
    if (missingDocuments.length) return res.status(400).json({ success: false, error: "Please upload all required documents before submitting.", missingDocuments });
    const kyc = { ...current, businessStructure: structure, companyType: req.body?.companyType, gstin: req.body?.gstin, cin: req.body?.cin, status: "pending", updatedAt: new Date().toISOString() };
    all[userId] = kyc; kycStore.write(all);
    res.json({ success: true, kyc });
  });

  app.get("/api/admin/users/:userId/kyc", (req, res) => {
    const all = kycStore.read();
    res.json({ success: true, kyc: all[req.params.userId] || emptyKyc(req.params.userId) });
  });

  function updateKycReview(req, res, documentKey, status) {
    const all = kycStore.read();
    const userId = String(req.params.id).replace(/^kyc-/, "");
    const current = all[userId] || emptyKyc(userId);
    if (documentKey && !DOCUMENT_KEY_SET.has(documentKey)) {
      return res.status(400).json({ message: "Invalid KYC document type" });
    }
    const rejectionReason = status === "rejected"
      ? String(req.body?.rejectionReason || "Rejected by admin")
      : undefined;
    const reviewedDocuments = documentKey
      ? {}
      : Object.fromEntries(DOCUMENT_KEYS.flatMap((key) => {
        const document = current[key];
        return document?.storageKey || document?.url
          ? [[key, { ...document, status, rejectionReason }]]
          : [];
      }));
    const update = documentKey
      ? { [documentKey]: { ...current[documentKey], status, rejectionReason } }
      : { ...reviewedDocuments, status, rejectionReason };
    const kyc = { ...current, ...update, updatedAt: new Date().toISOString() };
    all[userId] = kyc; kycStore.write(all);
    res.json({ success: true, kyc });
  }
  app.post("/api/admin/kyc/:id/approve", (req, res) => updateKycReview(req, res, null, "approved"));
  app.post("/api/admin/kyc/:id/reject", (req, res) => updateKycReview(req, res, null, "rejected"));
  app.post("/api/admin/kyc/:id/document/:key/approve", (req, res) => updateKycReview(req, res, req.params.key, "approved"));
  app.post("/api/admin/kyc/:id/document/:key/reject", (req, res) => updateKycReview(req, res, req.params.key, "rejected"));
  app.get("/api/admin/document/:userId/:key/:filename", async (req, res, next) => {
    try {
      const doc = kycStore.read()[req.params.userId]?.[req.params.key];
      if (!doc?.storageKey) return res.status(404).json({ message: "KYC document not found" });
      const object = await getShipsyObject(doc.storageKey);
      res.type(object.ContentType || doc.mime || "application/octet-stream");
      object.Body.pipe(res);
    } catch (error) { next(error); }
  });

  const defaultLabelSettings = (userId) => ({ id: `label-${userId}`, userId, showLogo: true, hideCustomerMobile: false, hideCustomerOrderBar: false, hideGstNumber: false, hidePickupAddress: false, hideRtoAddress: false, hideRtoName: false, hidePickupMobile: false, hideRtoMobile: false, hidePickupName: false, hideHsn: false, hideSku: false, hideQty: false, hideTotalAmount: false, hideOrderAmount: false, hideProduct: false, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
  app.get("/api/label-settings", (req, res) => {
    const userId = requestUser(req); const all = labelStore.read();
    res.json({ settings: all[userId] || defaultLabelSettings(userId) });
  });
  app.put("/api/label-settings", (req, res) => {
    const userId = requestUser(req); const all = labelStore.read(); const current = all[userId] || defaultLabelSettings(userId);
    const settings = { ...current, ...req.body, id: current.id, userId, updatedAt: new Date().toISOString() };
    all[userId] = settings; labelStore.write(all); res.json({ settings });
  });
  app.post("/api/label-settings/logo", upload.single("logo"), async (req, res, next) => {
    try {
      if (!req.file || !/^image\/(jpeg|png|webp|svg\+xml)$/.test(req.file.mimetype)) return res.status(415).json({ message: "A JPG, PNG, WebP, or SVG logo is required" });
      const userId = requestUser(req); const key = shipsyObjectKey("branding", userId, `${crypto.randomUUID()}-${req.file.originalname}`);
      await putShipsyObject(key, req.file.buffer, req.file.mimetype, { userId, use: "label-logo" });
      const logoUrl = publicObjectUrl(key); const all = labelStore.read(); const current = all[userId] || defaultLabelSettings(userId);
      all[userId] = { ...current, logoUrl, updatedAt: new Date().toISOString() }; labelStore.write(all);
      res.json({ logoUrl });
    } catch (error) { next(error); }
  });

  async function saveAttachments(files, userId, ticketId) {
    const result = [];
    for (const file of files || []) {
      const key = shipsyObjectKey("support", userId, ticketId, `${crypto.randomUUID()}-${file.originalname}`);
      await putShipsyObject(key, file.buffer, file.mimetype, { userId, ticketId });
      result.push(attachmentMeta(file, key));
    }
    return result;
  }
  function ticketById(id) { return ticketStore.read().find((ticket) => ticket.id === id); }
  app.get(["/api/support-tickets", "/api/admin/support-tickets"], (req, res) => {
    const admin = req.path.startsWith("/api/admin/"); const userId = requestUser(req);
    const items = ticketStore.read().filter((ticket) => (admin || ticket.userId === userId) && (!req.query.status || ticket.status === req.query.status));
    res.json({ items });
  });
  app.get(["/api/support-tickets/:id", "/api/admin/support-tickets/:id"], (req, res) => {
    const ticket = ticketById(req.params.id); if (!ticket) return res.status(404).json({ message: "Support ticket not found" }); res.json({ ticket });
  });
  app.post("/api/support-tickets", upload.array("attachments", 5), async (req, res, next) => {
    try {
      const userId = requestUser(req); const id = crypto.randomUUID(); const now = new Date().toISOString();
      const attachments = await saveAttachments(req.files, userId, id);
      const ticket = { id, ticketNumber: `SHP-${Date.now().toString().slice(-8)}`, userId, subject: String(req.body?.subject || "Support request"), category: req.body?.category || "general", priority: req.body?.priority || "medium", status: "open", relatedOrderId: req.body?.relatedOrderId || undefined, messages: [{ id: crypto.randomUUID(), fromRole: "seller", fromUserId: userId, body: String(req.body?.message || ""), attachments, createdAt: now }], lastMessageAt: now, unreadBySeller: 0, unreadByAdmin: 1, createdAt: now };
      const all = ticketStore.read(); all.unshift(ticket); ticketStore.write(all); res.status(201).json({ ticket });
    } catch (error) { next(error); }
  });
  app.post(["/api/support-tickets/:id/reply", "/api/admin/support-tickets/:id/reply"], upload.array("attachments", 5), async (req, res, next) => {
    try {
      const all = ticketStore.read(); const index = all.findIndex((ticket) => ticket.id === req.params.id);
      if (index < 0) return res.status(404).json({ message: "Support ticket not found" });
      const admin = req.path.startsWith("/api/admin/"); const ticket = all[index]; const now = new Date().toISOString();
      const attachments = await saveAttachments(req.files, requestUser(req), ticket.id);
      const message = { id: crypto.randomUUID(), fromRole: admin ? "admin" : "seller", fromUserId: admin ? "shipsy-admin" : requestUser(req), body: String(req.body?.message || ""), attachments, createdAt: now };
      all[index] = { ...ticket, messages: [...(ticket.messages || []), message], lastMessageAt: now, unreadBySeller: admin ? (ticket.unreadBySeller || 0) + 1 : 0, unreadByAdmin: admin ? 0 : (ticket.unreadByAdmin || 0) + 1 };
      ticketStore.write(all); res.json({ ticket: all[index] });
    } catch (error) { next(error); }
  });
  app.patch("/api/admin/support-tickets/:id", (req, res) => {
    const all = ticketStore.read(); const index = all.findIndex((ticket) => ticket.id === req.params.id);
    if (index < 0) return res.status(404).json({ message: "Support ticket not found" });
    all[index] = { ...all[index], ...(req.body?.status ? { status: req.body.status } : {}), ...(req.body?.priority ? { priority: req.body.priority } : {}) };
    ticketStore.write(all); res.json({ ticket: all[index] });
  });
  app.get(["/api/support-tickets/:ticketId/attachments/:attachmentId", "/api/admin/support-tickets/:ticketId/attachments/:attachmentId"], async (req, res, next) => {
    try {
      const ticket = ticketById(req.params.ticketId); const attachment = ticket?.messages?.flatMap((message) => message.attachments || []).find((item) => item.id === req.params.attachmentId);
      if (!attachment?.storageKey) return res.status(404).json({ message: "Attachment not found" });
      const object = await getShipsyObject(attachment.storageKey); res.type(object.ContentType || attachment.contentType); res.set("Content-Disposition", `inline; filename="${safePart(attachment.name, "attachment")}"`); object.Body.pipe(res);
    } catch (error) { next(error); }
  });
}
