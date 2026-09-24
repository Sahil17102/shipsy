import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import PDFDocument from "pdfkit";
import bwipjs from "bwip-js";

const app = express();
const port = Number(process.env.PORT || 10000);
const root = path.dirname(fileURLToPath(import.meta.url));

app.disable("x-powered-by");
app.use((req, res, next) => {
  const allowed = new Set([
    "https://shipsy-client-wkxv.onrender.com",
    "https://shipsy-1admin.onrender.com",
    "http://localhost:5173",
  ]);
  const origin = req.get("origin");
  if (origin && allowed.has(origin)) res.set("Access-Control-Allow-Origin", origin);
  res.set("Vary", "Origin");
  res.set("Access-Control-Allow-Headers", "Authorization, Content-Type");
  res.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true, limit: "2mb" }));

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

let teampafexToken = "";
// Provider-created orders are mirrored here so the client and admin panels
// share the same order list even when the upstream courier has no list API.
const providerOrders = new Map();

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

app.get("/api/provider-orders", (_req, res) => {
  res.json({ orders: [...providerOrders.values()] });
});

app.post("/api/provider-orders", (req, res) => {
  const order = req.body;
  if (!order || !order.id) return res.status(400).json({ message: "Order id is required" });
  providerOrders.set(String(order.id), order);
  return res.status(201).json({ order });
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
    doc.fillColor(blue).font("Helvetica-Bold").text("support@shipsy.in  |  shipsy.in", 42, 792, { width: 510, align: "center" });
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
  doc.fillColor(blue).font("Helvetica-Bold").fontSize(8).text("support@shipsy.in  |  shipsy.in", 40, 795, { width: 515, align: "center" });
  doc.end();
  return completed;
}

function findProviderOrder(id) {
  return [...providerOrders.values()].find((item) => [item.id, item.orderId, item.providerOrderId, item.awb].map(String).includes(String(id)));
}

app.get("/api/provider-orders/:id/:document", async (req, res, next) => {
  try {
  const order = findProviderOrder(req.params.id);
  if (!order || !["label", "invoice"].includes(req.params.document)) return res.status(404).json({ message: "Provider order document not found" });
  const kind = req.params.document;
  res.type("application/pdf").set("Content-Disposition", `attachment; filename=${kind}-${order.awb || order.orderId}.pdf`).send(await orderPdf(order, kind));
  } catch (error) { next(error); }
});

app.post("/api/provider-orders/manifest", async (req, res, next) => {
  try {
    const ids = Array.isArray(req.body?.orderIds) ? req.body.orderIds.map(String) : [];
    const orders = ids.map(findProviderOrder).filter(Boolean);
    if (!orders.length) return res.status(404).json({ message: "No provider orders found for manifest" });
    res.type("application/pdf").set("Content-Disposition", `attachment; filename=manifest-${Date.now()}.pdf`).send(await manifestPdf(orders));
  } catch (error) { next(error); }
});

app.get("/api/health", (_req, res) => res.json({ ok: true }));
app.use(express.static(path.join(root, "dist")));
app.get("*path", (_req, res) => res.sendFile(path.join(root, "dist", "index.html")));
app.use((error, _req, res, _next) => {
  const status = Number(error?.status) || 500;
  res.status(status).json({ message: error instanceof Error ? error.message : "Courier proxy request failed" });
});

app.listen(port, "0.0.0.0", () => console.log(`Shipsy client listening on ${port}`));
