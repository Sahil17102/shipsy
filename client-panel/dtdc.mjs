const URLS = {
  staging: {
    booking: "https://demodashboardapi.shipsy.in/api/customer/integration/consignment/softdata",
    label: "https://lut-details-2-demo.demoprojectxsandbox4.shipsy.io/api/customer/integration/consignment/shippinglabel/stream",
    cancel: "https://lut-details-2-demo.demoprojectxsandbox4.shipsy.io/api/customer/integration/consignment/cancel",
    epod: "https://alphademodashboardapi.shipsy.io/api/customer/integration/consignment/ePodLabel",
    pincode: "https://smarttrack.ctbsplus.dtdc.com/ratecalapi/PincodeApiCall",
    trackingAuth: "https://dtdcstagingapi.dtdc.com/dtdc-api/api/dtdc/authenticate",
    tracking: "https://dtdcstagingapi.dtdc.com/dtdc-tracking-api/dtdc-api/rest/JSONCnTrk/getTrackDetails",
  },
  production: {
    booking: "https://pxapi.dtdc.in/api/customer/integration/consignment/softdata",
    label: "https://pxapi.dtdc.in/api/customer/integration/consignment/shippinglabel/stream",
    cancel: "https://pxapi.dtdc.in/api/customer/integration/consignment/cancel",
    epod: "https://pxapi.dtdc.in/api/customer/integration/consignment/ePodLabel",
    pincode: "https://smarttrack-ctbsplus.dtdc.com/ratecalapi/PincodeApiCall",
    trackingAuth: "https://blktracksvc.dtdc.com/dtdc-api/api/dtdc/authenticate",
    tracking: "https://blktracksvc.dtdc.com/dtdc-api/rest/JSONCnTrk/getTrackDetails",
  },
};

const OPERATIONS = {
  pincodeServiceability: "Check DTDC origin and destination pincode serviceability",
  createShipment: "Create one or more DTDC consignments",
  generateLabel: "Generate a DTDC shipping label as PDF or base64",
  cancelShipment: "Cancel DTDC consignments by AWB number",
  trackShipment: "Track a DTDC consignment or customer reference number",
  generateEpod: "Retrieve ePOD for one or more DTDC reference numbers",
};

export function registerDtdcRoutes(app, { requireSeller } = {}) {
  app.get("/api/providers/dtdc/status", (_req, res) => {
    res.set("Cache-Control", "no-store").json({
      connected: bookingConfigured(),
      bookingConfigured: bookingConfigured(),
      trackingConfigured: trackingConfigured(),
      pincodeConfigured: true,
      environment: environment(),
      provider: "DTDC",
    });
  });

  app.post("/api/providers/dtdc/pincode", async (req, res, next) => {
    try {
      const result = await callDtdc({ operation: "pincodeServiceability", payload: req.body || {} });
      res.status(result.ok ? 200 : result.status || 502).set("Cache-Control", "no-store").json(result);
    } catch (error) { next(error); }
  });

  app.post("/api/providers/dtdc/create-order", async (req, res, next) => {
    try {
      requireSeller?.(req);
      const result = await callDtdc({ operation: "createShipment", payload: req.body || {} });
      if (!result.ok) return res.status(result.status || 502).json(result);
      const requestedCustomerReference = deepString(req.body, ["customer_reference_number"]);
      const booking = parseDtdcBookingResponse(result.data, requestedCustomerReference);
      if (!booking.success) {
        return res.status(422).json({
          message: booking.message,
          upstream: result.data,
        });
      }
      return res.status(201).json({
        success: true,
        awb: booking.awb,
        referenceNumber: booking.referenceNumber,
        environment: result.environment,
        upstream: result.data,
      });
    } catch (error) { next(error); }
  });

  app.post("/api/providers/dtdc/cancel-order", async (req, res, next) => {
    try {
      requireSeller?.(req);
      const awb = clean(req.body?.awb || req.body?.waybill);
      if (!awb) throw statusError("DTDC AWB is required", 400);
      const result = await callDtdc({ operation: "cancelShipment", params: { AWBNo: [awb] } });
      res.status(result.ok ? 200 : result.status || 502).json(result);
    } catch (error) { next(error); }
  });

  app.get("/api/providers/dtdc/track", async (req, res, next) => {
    try {
      const awb = clean(req.query?.awb || req.query?.waybill);
      if (!awb) throw statusError("DTDC AWB is required", 400);
      const result = await callDtdc({ operation: "trackShipment", params: { trkType: "cnno", strcnno: awb, addtnlDtl: "Y" } });
      res.status(result.ok ? 200 : result.status || 502).json(result);
    } catch (error) { next(error); }
  });

  app.get("/api/dtdc", (_req, res) => {
    res.set("Cache-Control", "no-store").json({
      ok: true,
      service: "dtdc",
      environment: environment(),
      operations: Object.entries(OPERATIONS).map(([operation, description]) => ({ operation, description })),
      usage: {
        method: "POST",
        body: { operation: "pincodeServiceability", payload: { orgPincode: "160036", desPincode: "110001" } },
      },
    });
  });

  app.post("/api/dtdc", async (req, res, next) => {
    try {
      requireProxyToken(req);
      const operation = String(req.body?.operation || "");
      if (!Object.hasOwn(OPERATIONS, operation)) throw statusError("Unsupported DTDC operation", 400);
      const result = await callDtdc({ ...req.body, operation });
      res.status(result.ok ? 200 : result.status || 502).set("Cache-Control", "no-store").json(result);
    } catch (error) {
      next(error);
    }
  });
}

export async function callDtdc(request) {
  const selectedEnvironment = environment();
  const urls = URLS[selectedEnvironment];
  const params = request.params ?? {};
  let upstreamUrl;
  let method;
  let headers = { Accept: "application/json" };
  let body;

  switch (request.operation) {
    case "pincodeServiceability": {
      const payload = requireObject(request.payload ?? params, request.operation);
      upstreamUrl = urls.pincode;
      method = "POST";
      headers["Content-Type"] = "application/json";
      if (clean(process.env.DTDC_PINCODE_TOKEN)) headers.Authorization = `Bearer ${clean(process.env.DTDC_PINCODE_TOKEN)}`;
      body = JSON.stringify({
        orgPincode: String(required(payload, "orgPincode")),
        desPincode: String(required(payload, "desPincode")),
      });
      break;
    }
    case "createShipment": {
      const payload = requireObject(request.payload, request.operation);
      const consignments = payload.consignments;
      if (!Array.isArray(consignments) || !consignments.length) {
        throw statusError("createShipment payload must contain a non-empty consignments array", 400);
      }
      const config = bookingConfig();
      upstreamUrl = urls.booking;
      method = "POST";
      headers = apiHeaders(config.apiKey);
      body = JSON.stringify({
        ...payload,
        consignments: consignments.map((item) => ({
          ...requireObject(item, request.operation),
          customer_code: config.customerCode,
          service_type_id: config.serviceTypeId,
          // DTDC expects a commodity master ID, not an arbitrary product name.
          // Use the official OTHERS code for generic products unless a numeric
          // master ID (or an operator-configured default) is supplied.
          commodity_id: dtdcCommodityId(item.commodity_id),
        })),
      });
      break;
    }
    case "generateLabel": {
      const config = bookingConfig();
      upstreamUrl = withQuery(urls.label, {
        reference_number: required(params, "reference_number"),
        label_code: params.label_code ?? "SHIP_LABEL_4X6",
        label_format: params.label_format ?? "pdf",
      });
      method = "GET";
      headers = apiHeaders(config.apiKey);
      break;
    }
    case "cancelShipment": {
      const config = bookingConfig();
      const awbNumbers = params.AWBNo ?? requireObject(request.payload, request.operation).AWBNo;
      if (!Array.isArray(awbNumbers) || !awbNumbers.length) throw statusError("AWBNo must be a non-empty array", 400);
      upstreamUrl = urls.cancel;
      method = "POST";
      headers = apiHeaders(config.apiKey);
      body = JSON.stringify({ AWBNo: awbNumbers, customerCode: config.customerCode });
      break;
    }
    case "trackShipment": {
      upstreamUrl = urls.tracking;
      method = "POST";
      headers = { Accept: "application/json", "Content-Type": "application/json", "x-access-token": await getTrackingToken(urls.trackingAuth) };
      body = JSON.stringify({
        trkType: params.trkType ?? "cnno",
        strcnno: required(params, "strcnno"),
        addtnlDtl: params.addtnlDtl ?? "Y",
      });
      break;
    }
    case "generateEpod": {
      const config = bookingConfig();
      const refs = params.reference_number_list ?? requireObject(request.payload, request.operation).reference_number_list;
      if (!Array.isArray(refs) || !refs.length) throw statusError("reference_number_list must be a non-empty array", 400);
      upstreamUrl = urls.epod;
      method = "POST";
      headers = apiHeaders(config.apiKey);
      body = JSON.stringify({ reference_number_list: refs });
      break;
    }
  }

  const response = await fetch(upstreamUrl, { method, headers, body, signal: AbortSignal.timeout(30_000) });
  return {
    operation: request.operation,
    environment: selectedEnvironment,
    upstreamUrl,
    status: response.status,
    ok: response.ok,
    data: await readResponse(response),
  };
}

function environment() {
  return clean(process.env.DTDC_ENV).toLowerCase() === "staging" ? "staging" : "production";
}

function requireProxyToken(req) {
  const expected = clean(process.env.DTDC_PROXY_TOKEN);
  if (!expected) throw statusError("DTDC_PROXY_TOKEN must be configured on the server", 503);
  const authorization = clean(req.get("authorization"));
  const supplied = authorization.toLowerCase().startsWith("bearer ") ? authorization.slice(7).trim() : "";
  const valid = supplied.length === expected.length && cryptoSafeEqual(supplied, expected);
  if (!valid) throw statusError("Unauthorized", 401);
}

function cryptoSafeEqual(left, right) {
  const leftBytes = new TextEncoder().encode(left);
  const rightBytes = new TextEncoder().encode(right);
  if (leftBytes.length !== rightBytes.length) return false;
  let difference = 0;
  for (let index = 0; index < leftBytes.length; index += 1) difference |= leftBytes[index] ^ rightBytes[index];
  return difference === 0;
}

function bookingConfig() {
  const apiKey = clean(process.env.DTDC_API_KEY);
  const customerCode = clean(process.env.DTDC_CUSTOMER_CODE);
  if (!apiKey || !customerCode) throw statusError("DTDC_API_KEY and DTDC_CUSTOMER_CODE must be configured on the server", 503);
  return { apiKey, customerCode, serviceTypeId: clean(process.env.DTDC_SERVICE_TYPE_ID) || "PRIORITY" };
}

function bookingConfigured() {
  return Boolean(clean(process.env.DTDC_API_KEY) && clean(process.env.DTDC_CUSTOMER_CODE));
}

function dtdcCommodityId(value) {
  const supplied = clean(value);
  if (/^\d+$/.test(supplied)) return supplied;
  const configured = clean(process.env.DTDC_DEFAULT_COMMODITY_ID);
  return /^\d+$/.test(configured) ? configured : "7";
}

function trackingConfigured() {
  return Boolean(clean(process.env.DTDC_TRACKING_ACCESS_TOKEN) || (clean(process.env.DTDC_TRACKING_USERNAME) && clean(process.env.DTDC_TRACKING_PASSWORD)));
}

export function parseDtdcBookingResponse(body, requestedCustomerReference = "") {
  const responseData = body && typeof body === "object" ? body.data : undefined;
  const outcome = Array.isArray(responseData)
    ? responseData[0]
    : responseData && typeof responseData === "object"
      ? responseData
      : body;
  const customerReference = directString(outcome, ["customer_reference_number"])
    || clean(requestedCustomerReference);
  const referenceNumber = directString(outcome, ["reference_number", "referenceNo"]);
  const awb = directString(outcome, ["awb_number", "awb_no", "awb", "waybill", "consignment_number"])
    || referenceNumber;
  const providerAccepted = outcome && typeof outcome === "object" && outcome.success === true;

  if (!providerAccepted) {
    return {
      success: false,
      message: deepString(outcome, ["message", "reason", "remarks", "error_message", "errorMessage"])
        || "DTDC rejected the consignment; no shipment was created",
    };
  }
  if (!awb || (customerReference && awb.toLowerCase() === customerReference.toLowerCase())) {
    return {
      success: false,
      message: "DTDC accepted the API request but did not create a consignment/AWB number",
    };
  }
  return { success: true, awb, referenceNumber: referenceNumber || awb };
}

function directString(value, keys) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "";
  const wanted = new Set(keys.map((key) => key.toLowerCase()));
  for (const [key, item] of Object.entries(value)) {
    if (wanted.has(key.toLowerCase()) && item !== undefined && item !== null && String(item).trim()) {
      return String(item).trim();
    }
  }
  return "";
}

function deepString(value, keys) {
  const wanted = new Set(keys.map((key) => key.toLowerCase()));
  const queue = [value];
  while (queue.length) {
    const current = queue.shift();
    if (!current || typeof current !== "object") continue;
    if (Array.isArray(current)) { queue.push(...current); continue; }
    for (const [key, item] of Object.entries(current)) {
      if (wanted.has(key.toLowerCase()) && item !== undefined && item !== null && String(item).trim()) return String(item).trim();
      if (item && typeof item === "object") queue.push(item);
    }
  }
  return "";
}

function apiHeaders(apiKey) {
  return { Accept: "application/json", "Content-Type": "application/json", "api-key": apiKey };
}

async function getTrackingToken(authUrl) {
  const configured = clean(process.env.DTDC_TRACKING_ACCESS_TOKEN).replace(/^Bearer\s+/i, "");
  if (configured) return configured;
  const username = clean(process.env.DTDC_TRACKING_USERNAME);
  const password = clean(process.env.DTDC_TRACKING_PASSWORD);
  if (!username || !password) {
    throw statusError("Configure DTDC_TRACKING_ACCESS_TOKEN or DTDC_TRACKING_USERNAME and DTDC_TRACKING_PASSWORD", 503);
  }
  const response = await fetch(withQuery(authUrl, { username, password }), {
    headers: { Accept: "application/json, text/plain" },
    signal: AbortSignal.timeout(30_000),
  });
  const text = await response.text();
  if (!response.ok) throw statusError(`DTDC tracking authentication failed (${response.status})`, 502);
  let value = text.trim();
  try {
    const parsed = JSON.parse(value);
    if (typeof parsed === "string") value = parsed;
    else if (parsed && typeof parsed === "object") value = String(parsed["x-access-token"] ?? parsed.access_token ?? parsed.accessToken ?? parsed.token ?? "");
  } catch {
    // Some DTDC environments return the access token as plain text.
  }
  value = value.replace(/^Bearer\s+/i, "").replace(/^"|"$/g, "").trim();
  if (!value) throw statusError("DTDC tracking authentication returned no access token", 502);
  return value;
}

function withQuery(url, values) {
  const result = new URL(url);
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined && value !== null && value !== "") result.searchParams.set(key, String(value));
  }
  return result.toString();
}

function required(params, key) {
  const value = params[key];
  if (value === undefined || value === null || value === "") throw statusError(`Missing required parameter: ${key}`, 400);
  return value;
}

function requireObject(value, operation) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw statusError(`${operation} payload must be a JSON object`, 400);
  return value;
}

async function readResponse(response) {
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/pdf") || contentType.includes("application/octet-stream")) {
    return { contentType, base64: Buffer.from(await response.arrayBuffer()).toString("base64") };
  }
  const text = await response.text();
  if (!text) return null;
  try { return JSON.parse(text); } catch { return text; }
}

function clean(value) {
  return String(value || "").trim();
}

function statusError(message, status) {
  return Object.assign(new Error(message), { status });
}
