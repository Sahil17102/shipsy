import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";

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

function pdfText(value) {
  return String(value ?? "").replace(/[\\()]/g, "\\$&").replace(/[^\x20-\x7e]/g, "?");
}

function orderPdf(order, kind) {
  const address = order.deliveryAddress || {};
  const lines = kind === "label"
    ? ["SHIPSY  |  SHIPPING LABEL", `Order: ${order.orderId || order.id}`, `AWB: ${order.awb || "-"}`, `Courier: ${order.courierName || "Delhivery"}`, "", "SHIP TO", address.contactName, address.phone, address.addressLine1, `${address.city}, ${address.state} - ${address.pincode}`, "", `Payment: ${String(order.paymentType || "prepaid").toUpperCase()}`]
    : ["SHIPSY  |  TAX INVOICE", `Invoice: ${order.orderId || order.id}`, `Order date: ${order.createdAt || new Date().toISOString()}`, `AWB: ${order.awb || "-"}`, "", "BILL TO", address.contactName, address.phone, address.addressLine1, `${address.city}, ${address.state} - ${address.pincode}`, "", `Shipment charge: INR ${Number(order.rate?.totalCharge || order.orderAmount || 0).toFixed(2)}`, `Payment mode: ${String(order.paymentType || "prepaid").toUpperCase()}`, "", "Thank you for shipping with ShipSy."];
  const commands = ["BT", "/F1 18 Tf", "50 760 Td", `(${pdfText(lines[0])}) Tj`, "/F1 10 Tf"];
  lines.slice(1).forEach((line) => commands.push("0 -24 Td", `(${pdfText(line)}) Tj`));
  commands.push("ET");
  const stream = commands.join("\n");
  const objects = [`<< /Type /Catalog /Pages 2 0 R >>`, `<< /Type /Pages /Kids [3 0 R] /Count 1 >>`, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>`, `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>`, `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`];
  let pdf = "%PDF-1.4\n"; const offsets = [0];
  objects.forEach((object, index) => { offsets.push(Buffer.byteLength(pdf, "utf8")); pdf += `${index + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = Buffer.byteLength(pdf, "utf8"); pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n `).join("\n")}\ntrailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(pdf, "utf8");
}

function findProviderOrder(id) {
  return [...providerOrders.values()].find((item) => [item.id, item.orderId, item.providerOrderId, item.awb].map(String).includes(String(id)));
}

app.get("/api/provider-orders/:id/:document", (req, res) => {
  const order = findProviderOrder(req.params.id);
  if (!order || !["label", "invoice"].includes(req.params.document)) return res.status(404).json({ message: "Provider order document not found" });
  const kind = req.params.document;
  res.type("application/pdf").set("Content-Disposition", `attachment; filename=${kind}-${order.awb || order.orderId}.pdf`).send(orderPdf(order, kind));
});

app.get("/api/health", (_req, res) => res.json({ ok: true }));
app.use(express.static(path.join(root, "dist")));
app.get("*path", (_req, res) => res.sendFile(path.join(root, "dist", "index.html")));
app.use((error, _req, res, _next) => {
  const status = Number(error?.status) || 500;
  res.status(status).json({ message: error instanceof Error ? error.message : "Courier proxy request failed" });
});

app.listen(port, "0.0.0.0", () => console.log(`Shipsy client listening on ${port}`));
