import axios from "axios";

// Keep the private FShip signature on the Shipsy server. The browser should
// call the same-origin proxy, which forwards authenticated requests upstream.
// The client panel is deployed as a static Render service, so relative
// `/api/*` URLs are handled by the SPA fallback and never reach the courier
// proxy. Keep the provider proxy on the dedicated API service by default.
const DEFAULT_FSHIP_API_URL = "https://shipsy-courier-api.onrender.com/api/providers/fship";
const FS_TOKEN_STORAGE_KEY = "shipsy-fship-signature";
const FS_WAREHOUSE_STORAGE_KEY = "shipsy-fship-warehouses";
const FS_ORDERS_STORAGE_KEY = "shipsy-fship-created-orders";

const fshipApiBaseUrl = (
  import.meta.env.VITE_FSHIP_API_URL || DEFAULT_FSHIP_API_URL
).replace(/\/+$/, "");

const fshipSignature = import.meta.env.VITE_FSHIP_CLIENT_KEY || import.meta.env.VITE_FSHIP_SIGNATURE || "";
const fshipEnabled = import.meta.env.VITE_FSHIP_API_ENABLED ?? import.meta.env.VITE_LOGIXMITRA_API_ENABLED;
const serverManagedFship = fshipApiBaseUrl.includes("shipsy-courier-api.onrender.com") || fshipApiBaseUrl.startsWith("/");

function readStored(key: string): string {
  if (typeof window === "undefined") return "";
  return localStorage.getItem(key)?.trim() || "";
}

function readJsonArray<T>(key: string): T[] {
  if (typeof window === "undefined") return [];
  const raw = localStorage.getItem(key);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed as T[] : [];
  } catch {
    return [];
  }
}

function writeJsonArray<T>(key: string, value: T[]): void {
  if (typeof window !== "undefined") {
    localStorage.setItem(key, JSON.stringify(value));
  }
}

export function shouldUseFshipApi(): boolean {
  return fshipEnabled === "true";
}

export function isFshipServiceProvider(value?: string | null): boolean {
  const key = String(value || "").toLowerCase();
  return ["fship", "logixmitra", "logix_mitra"].includes(key);
}

export function isFshipApiConfigured(): boolean {
  return serverManagedFship || Boolean(fshipSignature || readStored(FS_TOKEN_STORAGE_KEY));
}

function getSignature(): string {
  if (serverManagedFship) return "server-managed";
  const signature = fshipSignature || readStored(FS_TOKEN_STORAGE_KEY);
  if (!signature) {
    throw new Error("FShip Client Key missing. Set FSHIP_CLIENT_KEY on the shipment API server.");
  }
  return signature;
}

function normalizeApiError(err: unknown): Error {
  if (axios.isAxiosError(err)) {
    const data = err.response?.data as any;
    const message =
      data?.response ||
      data?.message ||
      data?.error ||
      (err.response?.status ? `FShip API returned ${err.response.status}${err.response.statusText ? ` ${err.response.statusText}` : ""}` : err.message) ||
      "FShip API request failed";
    const error = new Error(message);
    (error as any).status = err.response?.status;
    return error;
  }
  return err instanceof Error ? err : new Error("LogixMitra API request failed");
}

const fshipHttp = axios.create({
  baseURL: fshipApiBaseUrl,
  timeout: 60_000,
  headers: {
    Accept: "application/json",
    "Content-Type": "application/json",
  },
});

async function fshipRequest<T>(method: "get" | "post", url: string, data?: unknown): Promise<T> {
  try {
    const serverManaged = serverManagedFship;
    const res = await fshipHttp.request<T>({
      method,
      url,
      data,
      headers: {
        ...(serverManaged ? {} : { signature: getSignature() }),
      },
    });
    return res.data;
  } catch (err) {
    throw normalizeApiError(err);
  }
}

export interface FshipCourier {
  courierId: number | string;
  courierName: string;
  logoUrl?: string;
}

export interface FshipWarehousePayload {
  warehouseId?: number | string;
  warehouseName: string;
  contactName: string;
  addressLine1: string;
  addressLine2?: string;
  pincode: string;
  city: string;
  stateId?: number;
  countryId?: number;
  phoneNumber: string;
  email?: string;
}

export interface FshipWarehouseResponse {
  warehouseId?: number | string;
  status: boolean;
  response?: string;
}

export interface FshipProductPayload {
  productId?: string;
  productName: string;
  unitPrice: number;
  quantity: number;
  productCategory?: string;
  hsnCode?: string;
  sku?: string;
  taxRate?: number;
  productDiscount?: number;
}

export interface FshipCreateForwardOrderPayload {
  customer_Name: string;
  customer_Mobile: string;
  customer_Emailid?: string;
  customer_Address: string;
  landMark?: string;
  customer_Address_Type?: string;
  customer_PinCode: string;
  customer_City?: string;
  orderId: string;
  invoice_Number?: string;
  payment_Mode: 1 | 2;
  express_Type: "air" | "surface" | string;
  is_Ndd?: 0 | 1;
  order_Amount: number;
  tax_Amount: number;
  extra_Charges: number;
  total_Amount: number;
  cod_Amount: number;
  shipment_Weight: number;
  shipment_Length: number;
  shipment_Width: number;
  shipment_Height: number;
  volumetric_Weight: number;
  latitude?: number;
  longitude?: number;
  pick_Address_ID: number | string;
  return_Address_ID?: number | string;
  products: FshipProductPayload[];
  courierId: number | string;
}

export interface FshipCreateForwardOrderResponse {
  route_code?: string;
  order_status?: string;
  apiorderid?: number | string;
  waybill?: string;
  status?: boolean;
  response?: string;
}

export interface FshipRateCalculatorPayload {
  source_Pincode: string;
  destination_Pincode: string;
  payment_Mode: "COD" | "P" | "PREPAID" | string;
  amount: number;
  express_Type: "air" | "surface" | string;
  shipment_Weight: number;
  shipment_Length: number;
  shipment_Width: number;
  shipment_Height: number;
  volumetric_Weight: number;
}

export interface FshipShipmentRate {
  courier_name: string;
  shipping_charge: number | string;
  cod_charge: number | string;
  rto_charge: number | string;
  service_mode?: string;
}

export interface FshipRateCalculatorResponse {
  status: boolean;
  response?: string;
  shipment_rates?: FshipShipmentRate[];
}

export interface FshipTrackingResponse {
  status?: boolean;
  error?: boolean;
  response?: string;
  summary?: {
    waybill?: string;
    apiorderid?: number | string;
    orderid?: string;
    fulfilledby?: string;
    statusid?: number | string;
    status?: string;
    lastscandate?: string;
    orderedon?: string;
    lastscanned?: string;
    statuscode?: string;
    location?: string;
    remark?: string;
  };
  trackingdata?: Array<{
    DateandTime?: string;
    Status?: string;
    Remark?: string;
    Location?: string;
    shipmentJourney?: number;
  }>;
}

export interface StoredFshipWarehouse {
  id: string;
  providerWarehouseId?: string;
  [key: string]: unknown;
}

export interface StoredFshipOrder {
  id: string;
  providerOrderId: string;
  [key: string]: unknown;
}

export const fshipApi = {
  getCouriers: () => fshipRequest<FshipCourier[]>("get", "/getallcourier"),

  addWarehouse: (payload: FshipWarehousePayload) =>
    fshipRequest<FshipWarehouseResponse>("post", "/addwarehouse", payload),

  updateWarehouse: (payload: FshipWarehousePayload) =>
    fshipRequest<FshipWarehouseResponse>("post", "/updatewarehouse", payload),

  rateCalculator: (payload: FshipRateCalculatorPayload) =>
    fshipRequest<FshipRateCalculatorResponse>("post", "/ratecalculator", payload),

  createForwardOrder: (payload: FshipCreateForwardOrderPayload) =>
    fshipRequest<FshipCreateForwardOrderResponse>("post", "/createforwardorder", payload),

  cancelOrder: (waybill: string, reason?: string) =>
    fshipRequest<{ status: boolean; response?: string }>("post", "/cancelorder", { waybill, reason: reason || "" }),

  registerPickup: (waybills: string[]) =>
    fshipRequest<{ status: boolean; response?: string; apipickuporderids?: Array<{ pickupOrderId: number | string; waybills: string[] }> }>(
      "post",
      "/registerpickup",
      { waybills },
    ),

  trackingHistory: (waybill: string) =>
    fshipRequest<FshipTrackingResponse>("post", "/trackinghistory", { waybill }),

  shipmentSummary: (waybill: string) =>
    fshipRequest<FshipTrackingResponse>("post", "/shipmentsummary", { waybill }),

  readStoredWarehouses: <T = StoredFshipWarehouse>() =>
    readJsonArray<T>(FS_WAREHOUSE_STORAGE_KEY),

  writeStoredWarehouses: <T = StoredFshipWarehouse>(warehouses: T[]) =>
    writeJsonArray(FS_WAREHOUSE_STORAGE_KEY, warehouses),

  readStoredOrders: <T = StoredFshipOrder>() =>
    readJsonArray<T>(FS_ORDERS_STORAGE_KEY),

  writeStoredOrders: <T = StoredFshipOrder>(orders: T[]) =>
    writeJsonArray(FS_ORDERS_STORAGE_KEY, orders),
};
