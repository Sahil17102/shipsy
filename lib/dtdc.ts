export type DtdcEnvironment = "staging" | "production";

export type DtdcOperation =
  | "pincodeServiceability"
  | "createShipment"
  | "generateLabel"
  | "cancelShipment"
  | "trackShipment"
  | "generateEpod";

export interface DtdcProxyRequest {
  operation: DtdcOperation;
  params?: Record<string, unknown>;
  payload?: unknown;
}

export interface DtdcConfig {
  apiKey: string;
  customerCode: string;
  serviceTypeId: string;
  environment?: DtdcEnvironment;
  trackingAccessToken?: string;
  trackingUsername?: string;
  trackingPassword?: string;
  pincodeToken?: string;
}

export interface DtdcProxyResponse {
  operation: DtdcOperation;
  environment: DtdcEnvironment;
  upstreamUrl: string;
  status: number;
  ok: boolean;
  data: unknown;
}

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
} satisfies Record<DtdcEnvironment, Record<string, string>>;

const DESCRIPTIONS: Record<DtdcOperation, string> = {
  pincodeServiceability: "Check DTDC origin and destination pincode serviceability",
  createShipment: "Create one or more DTDC consignments",
  generateLabel: "Generate a DTDC shipping label as PDF or base64",
  cancelShipment: "Cancel DTDC consignments by AWB number",
  trackShipment: "Track a DTDC consignment or customer reference number",
  generateEpod: "Retrieve ePOD for one or more DTDC reference numbers",
};

export function listDtdcOperations() {
  return Object.entries(DESCRIPTIONS).map(([operation, description]) => ({ operation, description }));
}

export async function callDtdc(
  request: DtdcProxyRequest,
  config: DtdcConfig,
): Promise<DtdcProxyResponse> {
  const environment = config.environment ?? "production";
  const urls = URLS[environment];
  const params = request.params ?? {};
  let upstreamUrl: string;
  let method: "GET" | "POST";
  let headers = new Headers({ Accept: "application/json" });
  let body: BodyInit | undefined;

  switch (request.operation) {
    case "pincodeServiceability": {
      const payload = request.payload ?? params;
      requireObject(payload, request.operation);
      upstreamUrl = urls.pincode;
      method = "POST";
      headers.set("Content-Type", "application/json");
      if (config.pincodeToken) headers.set("Authorization", `Bearer ${config.pincodeToken}`);
      body = JSON.stringify({
        orgPincode: required(payload as Record<string, unknown>, "orgPincode"),
        desPincode: required(payload as Record<string, unknown>, "desPincode"),
      });
      break;
    }
    case "createShipment": {
      const payload = requireObject(request.payload, request.operation);
      const consignments = payload.consignments;
      if (!Array.isArray(consignments) || consignments.length === 0) {
        throw new Error("createShipment payload must contain a non-empty consignments array");
      }
      upstreamUrl = urls.booking;
      method = "POST";
      headers = apiHeaders(config.apiKey);
      body = JSON.stringify({
        ...payload,
        consignments: consignments.map((item) => ({
          ...requireObject(item, request.operation),
          customer_code: config.customerCode,
          service_type_id: config.serviceTypeId,
        })),
      });
      break;
    }
    case "generateLabel": {
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
      const awbNumbers = params.AWBNo ?? requireObject(request.payload, request.operation).AWBNo;
      if (!Array.isArray(awbNumbers) || !awbNumbers.length) throw new Error("AWBNo must be a non-empty array");
      upstreamUrl = urls.cancel;
      method = "POST";
      headers = apiHeaders(config.apiKey);
      body = JSON.stringify({ AWBNo: awbNumbers, customerCode: config.customerCode });
      break;
    }
    case "trackShipment": {
      upstreamUrl = urls.tracking;
      method = "POST";
      const token = await getTrackingToken(config, urls.trackingAuth);
      headers.set("Content-Type", "application/json");
      headers.set("x-access-token", token);
      body = JSON.stringify({
        trkType: params.trkType ?? "cnno",
        strcnno: required(params, "strcnno"),
        addtnlDtl: params.addtnlDtl ?? "Y",
      });
      break;
    }
    case "generateEpod": {
      const refs = params.reference_number_list ?? requireObject(request.payload, request.operation).reference_number_list;
      if (!Array.isArray(refs) || !refs.length) throw new Error("reference_number_list must be a non-empty array");
      upstreamUrl = urls.epod;
      method = "POST";
      headers = apiHeaders(config.apiKey);
      body = JSON.stringify({ reference_number_list: refs });
      break;
    }
    default:
      return assertNever(request.operation);
  }

  const response = await fetch(upstreamUrl, { method, headers, body });
  return {
    operation: request.operation,
    environment,
    upstreamUrl,
    status: response.status,
    ok: response.ok,
    data: await readResponse(response),
  };
}

function apiHeaders(apiKey: string): Headers {
  return new Headers({ Accept: "application/json", "Content-Type": "application/json", "api-key": apiKey });
}

async function getTrackingToken(config: DtdcConfig, authUrl: string): Promise<string> {
  if (config.trackingAccessToken) return config.trackingAccessToken;
  if (!config.trackingUsername || !config.trackingPassword) {
    throw new Error("Configure DTDC_TRACKING_ACCESS_TOKEN or DTDC_TRACKING_USERNAME and DTDC_TRACKING_PASSWORD");
  }
  const url = withQuery(authUrl, { username: config.trackingUsername, password: config.trackingPassword });
  const response = await fetch(url, { headers: { Accept: "application/json, text/plain" } });
  const text = await response.text();
  if (!response.ok) throw new Error(`DTDC tracking authentication failed (${response.status})`);
  let value = text.trim();
  try {
    const parsed = JSON.parse(value) as unknown;
    if (typeof parsed === "string") value = parsed;
    else if (parsed && typeof parsed === "object") {
      const record = parsed as Record<string, unknown>;
      value = String(record["x-access-token"] ?? record.access_token ?? record.accessToken ?? record.token ?? "");
    }
  } catch {
    // The tracking auth API returns the access token as plain text in some environments.
  }
  value = value.replace(/^Bearer\s+/i, "").replace(/^"|"$/g, "").trim();
  if (!value) throw new Error("DTDC tracking authentication returned no access token");
  return value;
}

function withQuery(url: string, values: Record<string, unknown>): string {
  const result = new URL(url);
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined && value !== null && value !== "") result.searchParams.set(key, String(value));
  }
  return result.toString();
}

function required(params: Record<string, unknown>, key: string): unknown {
  const value = params[key];
  if (value === undefined || value === null || value === "") throw new Error(`Missing required parameter: ${key}`);
  return value;
}

function requireObject(value: unknown, operation: DtdcOperation): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${operation} payload must be a JSON object`);
  }
  return value as Record<string, unknown>;
}

async function readResponse(response: Response): Promise<unknown> {
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/pdf") || contentType.includes("application/octet-stream")) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    let binary = "";
    for (let offset = 0; offset < bytes.length; offset += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
    }
    return { contentType, base64: btoa(binary) };
  }
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function assertNever(operation: never): never {
  throw new Error(`Unsupported DTDC operation: ${String(operation)}`);
}
