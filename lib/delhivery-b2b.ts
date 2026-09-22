export type DelhiveryB2bEnvironment = "staging" | "production";

export interface DelhiveryB2bConfig {
  token?: string;
  environment?: DelhiveryB2bEnvironment;
  baseUrl?: string;
}

export type DelhiveryB2bOperation =
  | "passwordReset"
  | "login"
  | "logout"
  | "serviceability"
  | "expectedTat"
  | "freightEstimator"
  | "freightCharges"
  | "createShipment"
  | "getShipmentStatus"
  | "updateShipment"
  | "getShipmentUpdateStatus"
  | "cancelShipment"
  | "trackShipment"
  | "bookAppointment"
  | "createPickupRequest"
  | "cancelPickupRequest"
  | "generateLabelUrl"
  | "getLrCopy"
  | "generateDocument"
  | "getGenerateDocumentStatus"
  | "downloadDocument"
  | "createWarehouse"
  | "updateWarehouse";

export interface DelhiveryB2bProxyRequest {
  operation: DelhiveryB2bOperation;
  params?: Record<string, unknown>;
  payload?: unknown;
}

export interface DelhiveryB2bProxyResponse {
  operation: DelhiveryB2bOperation;
  environment: DelhiveryB2bEnvironment;
  upstreamUrl: string;
  status: number;
  ok: boolean;
  data: unknown;
}

const BASE_URLS: Record<DelhiveryB2bEnvironment, string> = {
  staging: "https://ltl-clients-api-dev.delhivery.com",
  production: "https://ltl-clients-api.delhivery.com",
};

const PUBLIC_OPERATIONS = new Set<DelhiveryB2bOperation>(["passwordReset", "login"]);

const OPERATION_DESCRIPTIONS: Record<DelhiveryB2bOperation, string> = {
  passwordReset: "Reset password for a B2B account username",
  login: "Generate B2B UMS bearer token",
  logout: "Logout the current bearer token",
  serviceability: "Check B2B pincode serviceability",
  expectedTat: "Estimate B2B TAT by origin and destination pincode",
  freightEstimator: "Estimate B2B freight charges",
  freightCharges: "Fetch freight charge breakup by LRNs",
  createShipment: "Create B2B manifest / shipment",
  getShipmentStatus: "Fetch manifest status by job id",
  updateShipment: "Update manifested LR shipment details",
  getShipmentUpdateStatus: "Fetch LR update job status",
  cancelShipment: "Cancel manifested LRN",
  trackShipment: "Track B2B shipment by LR number",
  bookAppointment: "Book last-mile delivery appointment",
  createPickupRequest: "Create B2B pickup request",
  cancelPickupRequest: "Cancel B2B pickup request",
  generateLabelUrl: "Generate shipping label URLs by LRN",
  getLrCopy: "Fetch LR copy PDF for an LRN",
  generateDocument: "Async document generation for labels or LR copies",
  getGenerateDocumentStatus: "Fetch async document generation status",
  downloadDocument: "Download POD/document by LRN or MWN",
  createWarehouse: "Create B2B client warehouse",
  updateWarehouse: "Update B2B client warehouse",
};

export function listDelhiveryB2bOperations() {
  return Object.entries(OPERATION_DESCRIPTIONS).map(([operation, description]) => ({
    operation,
    description,
    requiresToken: !PUBLIC_OPERATIONS.has(operation as DelhiveryB2bOperation),
  }));
}

export function delhiveryB2bOperationRequiresToken(operation: DelhiveryB2bOperation): boolean {
  return !PUBLIC_OPERATIONS.has(operation);
}

export async function callDelhiveryB2b(
  request: DelhiveryB2bProxyRequest,
  config: DelhiveryB2bConfig,
): Promise<DelhiveryB2bProxyResponse> {
  const environment = config.environment ?? "staging";
  const token = config.token?.trim() || "";
  if (delhiveryB2bOperationRequiresToken(request.operation) && !token) {
    throw new Error("Missing Delhivery B2B bearer token");
  }

  const baseUrl = (config.baseUrl || BASE_URLS[environment]).replace(/\/+$/, "");
  const endpoint = buildEndpoint(request.operation, request.params ?? {}, request.payload);
  const upstreamUrl = `${baseUrl}${endpoint.path}${endpoint.query ? `?${endpoint.query}` : ""}`;

  const headers = new Headers(endpoint.headers);
  headers.set("Accept", "application/json");
  if (endpoint.auth !== false) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  const response = await fetch(upstreamUrl, {
    method: endpoint.method,
    headers,
    body: endpoint.body,
  });
  const data = await readUpstreamResponse(response);

  return {
    operation: request.operation,
    environment,
    upstreamUrl,
    status: response.status,
    ok: response.ok,
    data,
  };
}

interface EndpointSpec {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  query?: string;
  headers?: Record<string, string>;
  body?: BodyInit;
  auth?: false;
}

function buildEndpoint(
  operation: DelhiveryB2bOperation,
  params: Record<string, unknown>,
  payload: unknown,
): EndpointSpec {
  switch (operation) {
    case "passwordReset":
      return postJson("/forgot-password", requiredPayload(payload, operation), false);
    case "login":
      return postJson("/ums/login", requiredPayload(payload, operation), false);
    case "logout":
      return get("/ums/logout", {});
    case "serviceability":
      return get(`/pincode-service/${encodePath(required(params, "pincode"))}`, {
        weight: params.weight,
      });
    case "expectedTat":
      return get("/tat/estimate", {
        origin_pin: required(params, "origin_pin"),
        destination_pin: required(params, "destination_pin"),
      });
    case "freightEstimator":
      return postJson("/freight/estimate", requiredPayload(payload, operation));
    case "freightCharges":
      return get(`/lrn/freight-breakup/lrns=${encodeURIComponent(String(required(params, "lrns")))}`, {});
    case "createShipment":
      return postMultipart("/manifest", requiredPayloadRecord(payload, operation));
    case "getShipmentStatus":
      return get("/manifest", {
        job_id: required(params, "job_id"),
      });
    case "updateShipment":
      return putMultipart(`/lrn/update/${encodePath(required(params, "lrn"))}`, requiredPayloadRecord(payload, operation));
    case "getShipmentUpdateStatus":
      return get("/lrn/update/status", {
        job_id: required(params, "job_id"),
      });
    case "cancelShipment":
      return {
        method: "DELETE",
        path: `/lrn/cancel/${encodePath(required(params, "lrn"))}`,
      };
    case "trackShipment":
      return get("/lrn/track", {
        lrnum: params.lrnum ?? params.lrn,
        track_id: params.track_id,
        all_wbns: params.all_wbns,
      });
    case "bookAppointment":
      return postJson("/v2/appointments/lm", requiredPayload(payload, operation));
    case "createPickupRequest":
      return postJson("/pickup_requests", requiredPayload(payload, operation));
    case "cancelPickupRequest":
      return {
        method: "DELETE",
        path: `/pickup_requests/${encodePath(required(params, "pickup_id"))}`,
      };
    case "generateLabelUrl":
      return get(`/label/get_urls/${encodePath(required(params, "size"))}/${encodePath(required(params, "lrn"))}`, {});
    case "getLrCopy":
      return get(`/lr_copy/print/${encodePath(required(params, "lrn"))}`, {
        lr_copy_type: params.lr_copy_type,
      });
    case "generateDocument":
      return postJson(`/generate/${encodePath(required(params, "doc_type"))}`, requiredPayload(payload, operation));
    case "getGenerateDocumentStatus":
      return get(`/generate/${encodePath(required(params, "doc_type"))}/status/${encodePath(required(params, "job_id"))}`, {});
    case "downloadDocument":
      return get("/document/download", {
        lrn: params.lrn,
        mwn: params.mwn,
        doc_type: params.doc_type,
        auto_download: params.auto_download,
        version: params.version,
        fields: params.fields,
      });
    case "createWarehouse":
      return postJson("/client-warehouse/create/", requiredPayload(payload, operation));
    case "updateWarehouse":
      return patchJson("/client-warehouse/update/", requiredPayload(payload, operation));
    default:
      assertNever(operation);
  }
}

function get(path: string, params: Record<string, unknown>): EndpointSpec {
  return {
    method: "GET",
    path,
    query: toQuery(params),
  };
}

function postJson(path: string, body: unknown, auth?: false): EndpointSpec {
  return {
    method: "POST",
    path,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    auth,
  };
}

function patchJson(path: string, body: unknown): EndpointSpec {
  return {
    method: "PATCH",
    path,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

function postMultipart(path: string, payload: Record<string, unknown>): EndpointSpec {
  return {
    method: "POST",
    path,
    body: toMultipart(payload),
  };
}

function putMultipart(path: string, payload: Record<string, unknown>): EndpointSpec {
  return {
    method: "PUT",
    path,
    body: toMultipart(payload),
  };
}

function toMultipart(payload: Record<string, unknown>): FormData {
  const body = new FormData();
  Object.entries(payload).forEach(([key, value]) => {
    if (value === undefined || value === null) return;
    body.append(key, typeof value === "object" ? JSON.stringify(value) : String(value));
  });
  return body;
}

function toQuery(params: Record<string, unknown>): string {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === null || value === "") return;
    query.set(key, String(value));
  });
  return query.toString();
}

function encodePath(value: unknown): string {
  return encodeURIComponent(String(value));
}

function required(params: Record<string, unknown>, key: string): unknown {
  const value = params[key];
  if (value === undefined || value === null || value === "") {
    throw new Error(`Missing required parameter: ${key}`);
  }
  return value;
}

function requiredPayload(payload: unknown, operation: DelhiveryB2bOperation): unknown {
  if (payload === undefined || payload === null) {
    throw new Error(`Missing required payload for operation: ${operation}`);
  }
  return payload;
}

function requiredPayloadRecord(payload: unknown, operation: DelhiveryB2bOperation): Record<string, unknown> {
  const value = requiredPayload(payload, operation);
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Payload for operation ${operation} must be an object`);
  }
  return value as Record<string, unknown>;
}

async function readUpstreamResponse(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function assertNever(value: never): never {
  throw new Error(`Unsupported Delhivery B2B operation: ${String(value)}`);
}
