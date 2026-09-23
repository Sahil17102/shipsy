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
  const value = String(process.env[name] || "").trim();
  if (!value) {
    const error = new Error(`${name} is not configured on the Shipsy client service`);
    error.status = 503;
    throw error;
  }
  return value;
}

async function readUpstream(response) {
  const contentType = response.headers.get("content-type") || "";
  const body = contentType.includes("application/json")
    ? await response.json().catch(() => ({ message: "Invalid JSON returned by courier" }))
    : await response.text();
  return { body, contentType };
}

let teampafexToken = "";

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

app.all("/api/providers/logixmitra/*path", async (req, res, next) => {
  try {
    const pathPart = Array.isArray(req.params.path) ? req.params.path.join("/") : req.params.path;
    const target = new URL(`/api/${pathPart}`, "https://capi.fship.in");
    for (const [key, value] of Object.entries(req.query)) target.searchParams.set(key, String(value));
    const publicKey = String(process.env.LOGIXMITRA_PUBLIC_KEY || "").trim();
    const response = await fetch(target, {
      method: req.method,
      headers: {
        Accept: "application/json",
        "Content-Type": req.get("content-type") || "application/json",
        signature: requireEnv("LOGIXMITRA_PRIVATE_KEY"),
        ...(publicKey ? { publickey: publicKey, "public-key": publicKey } : {}),
      },
      body: ["GET", "HEAD"].includes(req.method) ? undefined : JSON.stringify(req.body),
    });
    const { body, contentType } = await readUpstream(response);
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

app.get("/api/health", (_req, res) => res.json({ ok: true }));
app.use(express.static(path.join(root, "dist")));
app.get("*path", (_req, res) => res.sendFile(path.join(root, "dist", "index.html")));
app.use((error, _req, res, _next) => {
  const status = Number(error?.status) || 500;
  res.status(status).json({ message: error instanceof Error ? error.message : "Courier proxy request failed" });
});

app.listen(port, "0.0.0.0", () => console.log(`Shipsy client listening on ${port}`));
