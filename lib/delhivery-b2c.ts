export type DelhiveryEnvironment = "staging" | "production";

export interface DelhiveryConfig {
  token: string;
  environment?: DelhiveryEnvironment;
  baseUrl?: string;
}

export type DelhiveryOperation =
  | "pincodeServiceability"
  | "heavyPincodeServiceability"
  | "expectedTat"
  | "fetchBulkWaybills"
  | "fetchWaybill"
  | "createShipment"
  | "editShipment"
  | "cancelShipment"
  | "updateEwaybill"
  | "trackShipment"
  | "calculateShippingCost"
  | "generateLabel"
  | "createPickupRequest"
  | "createWarehouse"
  | "updateWarehouse"
  | "downloadDocument"
  | "ndrAction"
  | "getNdrStatus";

export interface DelhiveryProxyRequest {
  operation: DelhiveryOperation;
  params?: Record<string, unknown>;
  payload?: unknown;
}

export interface DelhiveryProxyResponse {
  operation: DelhiveryOperation;
  environment: DelhiveryEnvironment;
  upstreamUrl: string;
  status: number;
  ok: boolean;
  data: unknown;
}

const BASE_URLS: Record<DelhiveryEnvironment, string> = {
  staging: "https://staging-express.delhivery.com",
  production: "https://track.delhivery.com",
};

const OPERATION_DESCRIPTIONS: Record<DelhiveryOperation, string> = {
  pincodeServiceability: "B2C pincode serviceability",
  heavyPincodeServiceability: "Heavy product pincode serviceability",
  expectedTat: "Expected TAT by origin and destination pincode",
  fetchBulkWaybills: "Fetch bulk waybills",
  fetchWaybill: "Fetch single waybill",
  createShipment: "Create B2C shipment, MPS shipment, RVP, or REPL manifest",
  editShipment: "Edit shipment details",
  cancelShipment: "Cancel shipment through edit endpoint",
  updateEwaybill: "Update shipment e-waybill",
  trackShipment: "Track shipment by waybill or order id",
  calculateShippingCost: "Calculate estimated shipping cost",
  generateLabel: "Generate packing slip / shipping label",
  createPickupRequest: "Create pickup request",
  createWarehouse: "Create Delhivery client warehouse",
  updateWarehouse: "Update Delhivery client warehouse",
  downloadDocument: "Download shipment document URL/data",
  ndrAction: "Apply NDR action",
  getNdrStatus: "Get NDR UPL status",
};

export function listDelhiveryOperations() {
  return Object.entries(OPERATION_DESCRIPTIONS).map(([operation, description]) => ({
    operation,
    description,
  }));
}

export async function callDelhiveryB2c(
  request: DelhiveryProxyRequest,
  config: DelhiveryConfig,
): Promise<DelhiveryProxyResponse> {
  const environment = config.environment ?? "staging";
  const baseUrl = (config.baseUrl || BASE_URLS[environment]).replace(/\/+$/, "");
  const endpoint = buildEndpoint(request.operation, request.params ?? {}, request.payload, config.token);
  const upstreamUrl = `${baseUrl}${endpoint.path}${endpoint.query ? `?${endpoint.query}` : ""}`;

  const headers = new Headers(endpoint.headers);
  headers.set("Accept", "application/json");
  if (endpoint.auth !== "query") {
    headers.set("Authorization", `Token ${config.token}`);
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
    upstreamUrl: redactToken(upstreamUrl, config.token),
    status: response.status,
    ok: response.ok,
    data,
  };
}

interface EndpointSpec {
  method: "GET" | "POST" | "PUT";
  path: string;
  query?: string;
  headers?: Record<string, string>;
  body?: BodyInit;
  auth?: "header" | "query";
}

function buildEndpoint(
  operation: DelhiveryOperation,
  params: Record<string, unknown>,
  payload: unknown,
  token: string,
): EndpointSpec {
  switch (operation) {
    case "pincodeServiceability":
      return get("/c/api/pin-codes/json/", {
        filter_codes: required(params, "filter_codes"),
      });
    case "heavyPincodeServiceability":
      return get("/api/dc/fetch/serviceability/pincode", {
        product_type: params.product_type ?? "Heavy",
        pincode: required(params, "pincode"),
      });
    case "expectedTat":
      return get("/api/dc/expected_tat", {
        origin_pin: required(params, "origin_pin"),
        destination_pin: required(params, "destination_pin"),
        mot: required(params, "mot"),
        pdt: params.pdt,
        expected_pickup_date: params.expected_pickup_date,
      });
    case "fetchBulkWaybills":
      return get("/waybill/api/bulk/json/", {
        token,
        count: required(params, "count"),
      }, "query");
    case "fetchWaybill":
      return get("/waybill/api/fetch/json/", { token }, "query");
    case "createShipment":
      return postForm("/api/cmu/create.json", {
        format: "json",
        data: JSON.stringify(requiredPayload(payload, operation)),
      });
    case "editShipment":
      return postJson("/api/p/edit", requiredPayload(payload, operation));
    case "cancelShipment":
      return postJson("/api/p/edit", {
        waybill: required(params, "waybill"),
        cancellation: "true",
      });
    case "updateEwaybill":
      return putJson(`/api/rest/ewaybill/${encodeURIComponent(String(required(params, "waybill")))}/`, requiredPayload(payload, operation));
    case "trackShipment":
      return get("/api/v1/packages/json/", {
        waybill: params.waybill,
        ref_ids: params.ref_ids ?? "",
      });
    case "calculateShippingCost":
      return get("/api/kinko/v1/invoice/charges/.json", {
        md: required(params, "md"),
        cgm: required(params, "cgm"),
        o_pin: required(params, "o_pin"),
        d_pin: required(params, "d_pin"),
        ss: required(params, "ss"),
        pt: required(params, "pt"),
        l: params.l,
        b: params.b,
        h: params.h,
        ipkg_type: params.ipkg_type,
      });
    case "generateLabel":
      return get("/api/p/packing_slip", {
        wbns: required(params, "waybill"),
        pdf: params.pdf ?? true,
        pdf_size: params.pdf_size,
      });
    case "createPickupRequest":
      return postJson("/fm/request/new/", requiredPayload(payload, operation));
    case "createWarehouse":
      return postJson("/api/backend/clientwarehouse/create/", requiredPayload(payload, operation));
    case "updateWarehouse":
      return postJson("/api/backend/clientwarehouse/edit/", requiredPayload(payload, operation));
    case "downloadDocument":
      return get("/api/rest/fetch/pkg/document/", {
        doc_type: required(params, "doc_type"),
        waybill: required(params, "waybill"),
      });
    case "ndrAction":
      return postJson("/api/p/update", requiredPayload(payload, operation));
    case "getNdrStatus":
      return get(`/api/cmu/get_bulk_upl/${encodeURIComponent(String(required(params, "upl_id")))}`, {
        verbose: params.verbose ?? true,
      });
    default:
      assertNever(operation);
  }
}

function get(path: string, params: Record<string, unknown>, auth: "header" | "query" = "header"): EndpointSpec {
  return {
    method: "GET",
    path,
    query: toQuery(params),
    auth,
  };
}

function postJson(path: string, body: unknown): EndpointSpec {
  return {
    method: "POST",
    path,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

function putJson(path: string, body: unknown): EndpointSpec {
  return {
    method: "PUT",
    path,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

function postForm(path: string, values: Record<string, string>): EndpointSpec {
  return {
    method: "POST",
    path,
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(values),
  };
}

function toQuery(params: Record<string, unknown>): string {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === null || value === "") return;
    query.set(key, String(value));
  });
  return query.toString();
}

function required(params: Record<string, unknown>, key: string): unknown {
  const value = params[key];
  if (value === undefined || value === null || value === "") {
    throw new Error(`Missing required parameter: ${key}`);
  }
  return value;
}

function requiredPayload(payload: unknown, operation: DelhiveryOperation): unknown {
  if (payload === undefined || payload === null) {
    throw new Error(`Missing required payload for operation: ${operation}`);
  }
  return payload;
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

function redactToken(url: string, token: string): string {
  if (!token) return url;
  return url.replaceAll(encodeURIComponent(token), "[redacted]").replaceAll(token, "[redacted]");
}

function assertNever(value: never): never {
  throw new Error(`Unsupported Delhivery operation: ${String(value)}`);
}
