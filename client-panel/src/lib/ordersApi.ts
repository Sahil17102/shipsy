import axios from "axios";
import { api } from "./api";
import { downloadBlob } from "./utils";
import type { Order, CreateOrderPayload, TrackingEvent } from "./ordersTypes";
import {
  courierApi,
  isCourierApiConfigured,
  shouldUseCourierApi,
  type CourierCreateOrderPayload,
  type CourierPackagePayload,
  type CourierPickupAddressPayload,
  type CourierRawOrder,
  type CourierOrdersResponse,
} from "./courierApi";
import {
  fshipApi,
  isFshipApiConfigured,
  isFshipServiceProvider,
  shouldUseFshipApi,
  type FshipCreateForwardOrderPayload,
  type FshipTrackingResponse,
} from "./fshipApi";

const PROVIDER_ORDER_MIRROR_URL = "https://shipsy-courier-api.onrender.com/api/provider-orders";

async function mirrorProviderOrder(order: Order): Promise<void> {
  await axios.post(PROVIDER_ORDER_MIRROR_URL, order, { timeout: 15_000 }).catch(() => undefined);
}

// Re-export types for backward compatibility
export type { Order, OrderStatus, OrderAddress, OrderProduct, OrderRate, CreateOrderPayload, TrackingEvent } from "./ordersTypes";

/**
 * Result of an "Initiate Pickup" call. `warnings` carries orders that went
 * through without a pickup of their own — e.g. the courier already had one for
 * that warehouse/date — so the UI can avoid reporting a false clean success.
 */
export interface ManifestResponse {
  manifestUrl?: string;
  ordersProcessed: number;
  errors: Array<{ awb: string; error: string }>;
  warnings?: Array<{ awb: string; warning: string }>;
}

export interface OrderStats {
  total: number;
  created: number;
  processing: number;
  booked: number;
  pickup_initiated: number;
  shipped: number;
  in_transit: number;
  out_for_delivery: number;
  delivered: number;
  ndr: number;
  rto_initiated: number;
  rto_in_transit: number;
  rto_delivered: number;
  cancelled: number;
  lost: number;
  totalRevenue: number;
}

/**
 * Filters shared by the NDR and RTO screens. Same names as the main order list
 * so the server can reuse one where-builder — except `startDate`/`endDate`,
 * which mean "NDR date" / "RTO updated" on those screens.
 */
export interface NdrRtoFilterParams {
  page?: number;
  limit?: number;
  search?: string;
  courierId?: string;
  paymentType?: string;
  orderType?: string;
  startDate?: string;
  endDate?: string;
  sortField?: string;
  sortOrder?: string;
}

export interface OrderListParams {
  search?: string;
  status?: string;
  orderType?: string;
  paymentType?: string;
  pickupAddressId?: string;
  /** Filter by the named courier (couriers.id) — applied in SQL, not per page. */
  courierId?: string;
  startDate?: string;
  endDate?: string;
  page?: number;
  limit?: number;
  sortField?: string;
  sortOrder?: "asc" | "desc";
}

export interface BulkCreateRowResult {
  rowNumber: number;
  orderId: string;
  success: boolean;
  order?: Order;
  error?: string;
}

export interface BulkCreateResponse {
  success: boolean;
  total: number;
  successCount: number;
  failedCount: number;
  results: BulkCreateRowResult[];
}

export interface OrderListResponse {
  orders: Order[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
  stats: OrderStats;
}

interface StoredProviderPickupAddress {
  id: string;
  providerPickupAddressId?: string;
  nickname?: string;
  contactName?: string;
  phone?: string;
  email?: string;
  addressLine1?: string;
  addressLine2?: string;
  city?: string;
  state?: string;
  pincode?: string;
  [key: string]: unknown;
}

interface StoredFshipPickupAddress extends StoredProviderPickupAddress {
  providerWarehouseId?: string;
  warehouseId?: string | number;
}

function toNumber(value: unknown, fallback = 0): number {
  const n = typeof value === "string" ? Number(value) : value;
  return typeof n === "number" && Number.isFinite(n) ? n : fallback;
}

function round(value: number, digits = 3): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function kgFromGrams(grams: number): number {
  return round(Math.max(grams, 0) / 1000);
}

function volumetricKg(length = 0, breadth = 0, height = 0): number {
  if (!length || !breadth || !height) return 0;
  return round((length * breadth * height) / 5000);
}

function b2cChargeableKg(weightG: number, length?: number, breadth?: number, height?: number): number {
  return Math.max(kgFromGrams(weightG), volumetricKg(length, breadth, height), 0.5);
}

function makeProviderPackage(input: {
  count?: number;
  weightKg: number;
  length?: number;
  breadth?: number;
  height?: number;
}): CourierPackagePayload {
  const count = input.count ?? 1;
  const length = input.length || 0;
  const breadth = input.breadth || 0;
  const height = input.height || 0;
  const weightKg = round(input.weightKg);
  return {
    count: String(count),
    length: String(length),
    width: String(breadth),
    height: String(height),
    volumetric_weight: String(volumetricKg(length, breadth, height)),
    weight: String(weightKg),
    total_weight: String(round(weightKg * count)),
  };
}

function extractProviderOrderId(id: string): string {
  const stored = courierApi.readStoredOrders<Order & { providerOrderId: string }>();
  const match = stored.find((order) => order.id === id || order.orderId === id || order.providerOrderId === id);
  return String(match?.providerOrderId || id);
}

function mapProviderStatus(status?: string): Order["status"] {
  const value = (status || "").toLowerCase().replace(/[\s-]+/g, "_");
  if (value.includes("manifest")) return "booked";
  if (value.includes("transit")) return "in_transit";
  if (value.includes("out_for_delivery")) return "out_for_delivery";
  if (value.includes("delivered") || value.includes("completed")) return "delivered";
  if (value.includes("cancel")) return "cancelled";
  if (value.includes("rto")) return value.includes("delivered") ? "rto_delivered" : "rto_in_transit";
  if (value.includes("process")) return "processing";
  if (value.includes("pending")) return "created";
  return "processing";
}

function getCourierDisplayName(courierId: string): string {
  const id = courierId.includes(":") ? courierId.split(":").pop() : courierId;
  if (id === "80") return "DLVY Standard";
  if (id === "152") return "Delhivery B2B";
  if (id === "161") return "Shadowfax";
  if (courierId.toLowerCase().includes("logixmitra")) return "LogixMitra";
  return courierId || "Teampafex";
}

function buildStats(orders: Order[]): OrderStats {
  const stats: OrderStats = {
    total: orders.length,
    created: 0,
    processing: 0,
    booked: 0,
    pickup_initiated: 0,
    shipped: 0,
    in_transit: 0,
    out_for_delivery: 0,
    delivered: 0,
    ndr: 0,
    rto_initiated: 0,
    rto_in_transit: 0,
    rto_delivered: 0,
    cancelled: 0,
    lost: 0,
    totalRevenue: 0,
  };
  orders.forEach((order) => {
    stats[order.status] += 1;
    stats.totalRevenue += order.rate?.totalCharge ?? 0;
  });
  return stats;
}

function isProviderId(value: string): boolean {
  return /^\d+$/.test(value);
}

function findStoredPickupAddress(id: string): StoredProviderPickupAddress | undefined {
  return courierApi
    .readStoredPickupAddresses<StoredProviderPickupAddress>()
    .find((address) => address.id === id || address.providerPickupAddressId === id);
}

function toPickupRegistrationPayload(address: StoredProviderPickupAddress): CourierPickupAddressPayload {
  return {
    address_nick_name: String(address.nickname || "Pickup Address"),
    contact_name: String(address.contactName || "Warehouse Manager"),
    phone: String(address.phone || ""),
    email: typeof address.email === "string" && address.email ? address.email : undefined,
    address_line_1: String(address.addressLine1 || ""),
    address_line_2: typeof address.addressLine2 === "string" && address.addressLine2 ? address.addressLine2 : undefined,
    pincode: String(address.pincode || ""),
    city: String(address.city || ""),
    state: String(address.state || ""),
  };
}

async function resolveProviderPickupAddress(
  pickupAddressId: string,
): Promise<{ id: string; city: string; pincode: string }> {
  if (isProviderId(pickupAddressId)) {
    const stored = findStoredPickupAddress(pickupAddressId);
    return { id: pickupAddressId, city: String(stored?.city || ""), pincode: String(stored?.pincode || "") };
  }

  const address = findStoredPickupAddress(pickupAddressId);
  if (!address) return { id: pickupAddressId, city: "", pincode: "" };
  if (address.providerPickupAddressId && isProviderId(address.providerPickupAddressId)) {
    return { id: address.providerPickupAddressId, city: String(address.city || ""), pincode: String(address.pincode || "") };
  }

  const result = await courierApi.registerPickupAddress(toPickupRegistrationPayload(address));
  if (!result.status || !result.pickup_address_id) {
    throw new Error(result.msg || "Pickup address registration failed");
  }

  const providerPickupAddressId = String(result.pickup_address_id);
  const addresses = courierApi.readStoredPickupAddresses<StoredProviderPickupAddress>();
  courierApi.writeStoredPickupAddresses(
    addresses.map((item) =>
      item.id === address.id ? { ...item, providerPickupAddressId } : item,
    ),
  );
  return { id: providerPickupAddressId, city: String(address.city || ""), pincode: String(address.pincode || "") };
}

function getProviderOrderId(result: {
  order_id?: string | number;
  id?: string | number;
  data?: { order_id?: string | number; id?: string | number };
}): string {
  return String(result.order_id ?? result.data?.order_id ?? result.id ?? result.data?.id ?? `provider-${Date.now()}`);
}

function getProviderAwb(result: {
  awb_no?: string;
  awb?: string;
  awb_number?: string;
  data?: { awb_no?: string; awb?: string; awb_number?: string };
}): string {
  return String(result.awb_no ?? result.data?.awb_no ?? result.awb ?? result.data?.awb ?? result.awb_number ?? result.data?.awb_number ?? "");
}

function extractFshipProviderId(id: string): string {
  const stored = fshipApi.readStoredOrders<Order & { providerOrderId: string }>();
  const match = stored.find((order) => order.id === id || order.orderId === id || order.providerOrderId === id || order.awb === id);
  return String(match?.awb || match?.providerOrderId || id);
}

function extractFshipApiOrderId(id: string): string {
  const stored = fshipApi.readStoredOrders<Order & { providerOrderId: string }>();
  const match = stored.find((order) => order.id === id || order.orderId === id || order.providerOrderId === id || order.awb === id);
  return String(match?.providerOrderId || id);
}

function mapFshipStatus(status?: string): Order["status"] {
  const value = (status || "").toLowerCase().replace(/[\s-]+/g, "_");
  if (value.includes("delivered")) return "delivered";
  if (value.includes("out_for_delivery")) return "out_for_delivery";
  if (value.includes("transit") || value.includes("dispatch")) return "in_transit";
  if (value.includes("manifest")) return "pickup_initiated";
  if (value.includes("book")) return "booked";
  if (value.includes("cancel")) return "cancelled";
  if (value.includes("rto")) return value.includes("delivered") ? "rto_delivered" : "rto_in_transit";
  if (value.includes("exception") || value.includes("ndr")) return "ndr";
  return "booked";
}

function findStoredFshipPickupAddress(id: string): StoredFshipPickupAddress | undefined {
  return fshipApi
    .readStoredWarehouses<StoredFshipPickupAddress>()
    .find((address) => address.id === id || address.providerWarehouseId === id || String(address.warehouseId || "") === id);
}

async function resolveFshipPickupAddress(
  pickupAddressId: string,
): Promise<{ id: string; city: string; pincode: string }> {
  if (/^\d+$/.test(pickupAddressId)) {
    const stored = findStoredFshipPickupAddress(pickupAddressId);
    return { id: pickupAddressId, city: String(stored?.city || ""), pincode: String(stored?.pincode || "") };
  }

  const address = findStoredFshipPickupAddress(pickupAddressId) || findStoredPickupAddress(pickupAddressId);
  if (!address) return { id: pickupAddressId, city: "", pincode: "" };

  const existingId = String((address as StoredFshipPickupAddress).providerWarehouseId || (address as StoredFshipPickupAddress).warehouseId || "");
  if (/^\d+$/.test(existingId)) {
    return { id: existingId, city: String(address.city || ""), pincode: String(address.pincode || "") };
  }

  const result = await fshipApi.addWarehouse({
    warehouseId: 0,
    warehouseName: String(address.nickname || `Warehouse ${Date.now()}`).slice(0, 80),
    contactName: String(address.contactName || "Warehouse Manager"),
    addressLine1: String(address.addressLine1 || ""),
    addressLine2: String(address.addressLine2 || ""),
    pincode: String(address.pincode || ""),
    city: String(address.city || ""),
    stateId: 0,
    countryId: 1,
    phoneNumber: String(address.phone || ""),
    email: String(address.email || ""),
  });
  if (!result.status || !result.warehouseId) {
    throw new Error(result.response || "LogixMitra warehouse registration failed");
  }

  const providerWarehouseId = String(result.warehouseId);
  const warehouses = fshipApi.readStoredWarehouses<StoredFshipPickupAddress>();
  const updated = {
    ...address,
    providerWarehouseId,
    warehouseId: providerWarehouseId,
  } as StoredFshipPickupAddress;
  fshipApi.writeStoredWarehouses([updated, ...warehouses.filter((item) => item.id !== address.id)]);
  return { id: providerWarehouseId, city: String(address.city || ""), pincode: String(address.pincode || "") };
}

function toFshipCreateForwardPayload(
  data: CreateOrderPayload,
  providerPickupAddress: { id: string },
): FshipCreateForwardOrderPayload {
  const selectedRate = data.rate || {};
  const firstInvoice = data.invoices?.[0];
  const shipmentWeightKg = data.orderType === "B2B"
    ? kgFromGrams(data.weight)
    : Math.max(kgFromGrams(data.weight), 0.5);
  const volumetric = volumetricKg(data.length, data.breadth, data.height);
  const courierId = data.courierId.includes(":") ? data.courierId.split(":").pop() || data.courierId : data.courierId;
  return {
    customer_Name: data.buyerName,
    customer_Mobile: data.buyerPhone,
    customer_Emailid: data.buyerEmail || "",
    customer_Address: data.address,
    landMark: data.address2 || "",
    customer_Address_Type: "Home",
    customer_PinCode: data.pincode,
    customer_City: data.city,
    orderId: data.orderId,
    invoice_Number: firstInvoice?.invoiceNumber || data.orderId,
    payment_Mode: data.paymentType === "cod" ? 1 : 2,
    express_Type: "surface",
    is_Ndd: 0,
    order_Amount: round(data.orderAmount, 2),
    tax_Amount: 0,
    extra_Charges: round(toNumber(selectedRate.otherCharges), 2),
    total_Amount: round(data.orderAmount, 2),
    cod_Amount: data.paymentType === "cod" ? round(data.codAmount, 2) : 0,
    shipment_Weight: shipmentWeightKg,
    shipment_Length: data.length || 1,
    shipment_Width: data.breadth || 1,
    shipment_Height: data.height || 1,
    volumetric_Weight: volumetric,
    latitude: 0,
    longitude: 0,
    pick_Address_ID: providerPickupAddress.id,
    return_Address_ID: providerPickupAddress.id,
    products: data.products.map((product, index) => ({
      productId: product.hsn || `${data.orderId}-${index + 1}`,
      productName: product.name,
      unitPrice: round(product.unitPrice, 2),
      quantity: product.quantity,
      productCategory: "",
      hsnCode: product.hsn || "",
      sku: product.hsn || product.name.replace(/\s+/g, "-").toUpperCase().slice(0, 32),
      taxRate: product.taxRate ?? 0,
      productDiscount: 0,
    })),
    courierId,
  };
}

async function createFshipOrder(data: CreateOrderPayload): Promise<Order> {
  if (!isFshipApiConfigured()) {
    throw new Error("Real shipment was not sent to LogixMitra. Configure VITE_FSHIP_SIGNATURE or VITE_LOGIXMITRA_PRIVATE_KEY, then redeploy.");
  }

  const providerPickupAddress = await resolveFshipPickupAddress(data.pickupAddressId);
  const payload = toFshipCreateForwardPayload(data, providerPickupAddress);
  const result = await fshipApi.createForwardOrder(payload);
  if (result.status === false) throw new Error(result.response || "LogixMitra order creation failed");
  const providerOrderId = String(result.apiorderid || `${data.orderId}-${Date.now()}`);
  const awb = String(result.waybill || "");
  const order = makeOrderFromPayload(data, providerOrderId, awb);
  const updated: Order & { providerOrderId: string } = {
    ...order,
    id: providerOrderId,
    status: awb ? "booked" : "processing",
    serviceProvider: "logixmitra",
    courierName: data.courierName || getCourierDisplayName(data.courierId),
    providerOrderId,
    awb,
  };
  const existing = fshipApi.readStoredOrders<Order & { providerOrderId: string }>();
  fshipApi.writeStoredOrders([updated, ...existing.filter((item) => item.id !== updated.id)]);
  return updated;
}

async function createDelhiveryOrder(data: CreateOrderPayload): Promise<Order> {
  const pickupName = import.meta.env.VITE_DELHIVERY_PICKUP_NAME || "BILAL";
  const shipment = {
    name: data.buyerName,
    add: [data.address, data.address2].filter(Boolean).join(", "),
    pin: data.pincode,
    city: data.city,
    state: data.state,
    country: "India",
    phone: data.buyerPhone,
    order: data.orderId,
    payment_mode: data.paymentType === "cod" ? "COD" : "Prepaid",
    cod_amount: data.paymentType === "cod" ? data.codAmount : 0,
    products_desc: data.products.map((product) => product.name).join(", "),
    total_amount: data.orderAmount,
    quantity: data.products.reduce((sum, product) => sum + product.quantity, 0),
    shipment_width: data.breadth || 1,
    shipment_height: data.height || 1,
    shipment_length: data.length || 1,
    weight: data.weight,
    shipping_mode: "Surface",
  };
  const response = await axios.post<{
    success?: boolean;
    packages?: Array<{ waybill?: string; status?: string; remarks?: string }>;
    rmks?: string;
  }>("https://shipsy-courier-api.onrender.com/api/providers/delhivery/create-order", {
    shipments: [shipment],
    pickup_location: { name: pickupName },
  }, { timeout: 60_000 });
  const result = response.data;
  const created = result.packages?.[0];
  const awb = String(created?.waybill || "");
  if (!result.success || !awb) {
    throw new Error(created?.remarks || result.rmks || "Delhivery shipment creation failed");
  }
  const order: Order & { providerOrderId: string } = {
    ...makeOrderFromPayload(data, data.orderId, awb),
    id: data.orderId,
    providerOrderId: data.orderId,
    awb,
    status: "booked",
    serviceProvider: "delhivery",
    courierName: data.courierName || "Delhivery B2C Surface",
  };
  // Keep provider-created shipments in the same local fallback store used by
  // the provider order list.  Delhivery's create endpoint returns the AWB but
  // does not expose a seller order-list endpoint, so without this write the
  // newly created shipment disappears from the client Orders screen.
  const existing = courierApi.readStoredOrders<Order & { providerOrderId: string }>();
  courierApi.writeStoredOrders([order, ...existing.filter((item) => item.id !== order.id)]);
  await mirrorProviderOrder(order);
  return order;
}

function mapFshipTrackingEvents(providerOrderId: string, awb: string, data: FshipTrackingResponse): TrackingEvent[] {
  const scans = data.trackingdata ?? [];
  if (scans.length > 0) {
    return scans.map((scan, index) => ({
      id: `${awb}-${index}`,
      orderId: providerOrderId,
      awb,
      statusCode: mapFshipStatus(scan.Status),
      statusText: scan.Status || "Shipment update",
      location: scan.Location,
      remarks: scan.Remark,
      source: "logixmitra",
      eventTimestamp: scan.DateandTime,
      createdAt: scan.DateandTime ? new Date(scan.DateandTime).toISOString() : new Date().toISOString(),
    }));
  }
  const summary = data.summary;
  return [{
    id: `${awb}-latest`,
    orderId: providerOrderId,
    awb,
    statusCode: mapFshipStatus(summary?.status),
    statusText: summary?.status || data.response || "Shipment update",
    location: summary?.location,
    remarks: summary?.remark || data.response,
    source: "logixmitra",
    eventTimestamp: summary?.lastscandate || summary?.lastscanned,
    createdAt: new Date().toISOString(),
  }];
}

function toProviderCreateOrderPayload(
  data: CreateOrderPayload,
  providerPickupAddress: { id: string; city: string; pincode: string },
): CourierCreateOrderPayload {
  const providerPickupAddressId = providerPickupAddress.id;
  const isB2B = data.orderType === "B2B";
  const packages = isB2B && data.packages?.length
    ? data.packages.flatMap((pkg) => {
        const count = Math.max(1, Math.floor(pkg.quantity ?? 1));
        return Array.from({ length: count }, () =>
          makeProviderPackage({
            weightKg: pkg.weight,
            length: pkg.length,
            breadth: pkg.breadth,
            height: pkg.height,
          }),
        );
      })
    : [
        makeProviderPackage({
          weightKg: b2cChargeableKg(data.weight, data.length, data.breadth, data.height),
          length: data.length,
          breadth: data.breadth,
          height: data.height,
        }),
      ];

  const totalWeight = round(packages.reduce((sum, pkg) => sum + toNumber(pkg.total_weight ?? pkg.weight), 0));
  const totalVolumetricWeight = round(packages.reduce((sum, pkg) => sum + toNumber(pkg.volumetric_weight), 0));
  const chargeableWeight = Math.max(totalWeight, totalVolumetricWeight, isB2B ? 1 : 0.5);
  const selectedRate = data.rate || {};
  const freightCharge = round(toNumber(selectedRate.freightCharge ?? selectedRate.forward), 2);
  const totalCharge = round(toNumber(selectedRate.totalCharge), 2);
  const otherCharges = round(toNumber(selectedRate.otherCharges), 2);
  const selectedCodCharges = round(toNumber(selectedRate.codCharges, data.paymentType === "cod" ? Math.max(35, data.orderAmount * 0.02) : 0), 2);
  const firstInvoice = data.invoices?.[0];
  const products = data.products.map((product) => {
    const total = product.unitPrice * product.quantity;
    return {
      product_name: product.name,
      sku: product.hsn || product.name.replace(/\s+/g, "-").toUpperCase().slice(0, 32) || data.orderId,
      rate: String(product.unitPrice),
      quantity: String(product.quantity),
      tax_rate: String(product.taxRate ?? 0),
      total: String(round(total, 2)),
    };
  });

  return {
    buyer_pincode: data.pincode,
    buyer_city: data.city,
    buyer_state: data.state,
    buyer_name: data.buyerName,
    buyer_mobile: data.buyerPhone,
    alternate_buyer_mobile: null,
    buyer_email: data.buyerEmail || "support@shipsy.in",
    buyer_address1: data.address,
    buyer_address2: data.address2 || "",
    invoice_number: firstInvoice?.invoiceNumber || data.orderId,
    order_date: data.orderDate,
    reseller_name: "",
    eway_bill_no: firstInvoice?.ebn || "",
    dimension_unit: "cm",
    rov: "Owner Risk",
    total_order_value: String(round(data.orderAmount, 2)),
    payment_amount: String(round(data.orderAmount, 2)),
    order_amount: String(round(data.orderAmount, 2)),
    products,
    product_name: products.map((product) => product.product_name),
    product_sku: products.map((product) => product.sku),
    sku: products.map((product) => product.sku),
    rate: products.map((product) => product.rate),
    quantity: products.map((product) => product.quantity),
    tax_rate: products.map((product) => product.tax_rate),
    total: products.map((product) => product.total),
    payment_method: data.paymentType === "cod" ? "COD" : "PREPAID",
    cod_amount: data.paymentType === "cod" ? String(round(data.codAmount, 2)) : null,
    cod_charges: String(selectedCodCharges),
    no_of_box: String(packages.length),
    total_weight: String(totalWeight),
    total_volumetric_weight: String(totalVolumetricWeight),
    chargeable_weight: String(chargeableWeight),
    packages,
    pickup_code: providerPickupAddress.pincode,
    delivery_code: data.pincode,
    freight: String(freightCharge),
    freight_charge: String(freightCharge),
    total_freight: String(freightCharge),
    gst: String(otherCharges),
    shipping_amount: String(totalCharge),
    shipping_charge: String(totalCharge),
    total_charges: String(totalCharge),
    pickup_address_city_name: providerPickupAddress.city || data.city,
    pickup_address_id: providerPickupAddressId,
    rto_address_id: providerPickupAddressId,
    submit_value: "Save Order",
    order_type: data.orderType,
    calculator_type: data.orderType,
    delivery_partner_id: /^\d+$/.test(data.courierId) ? Number(data.courierId) : data.courierId,
    courier_id: /^\d+$/.test(data.courierId) ? Number(data.courierId) : data.courierId,
    delivery_patner_id: /^\d+$/.test(data.courierId) ? Number(data.courierId) : data.courierId,
  };
}

function makeOrderFromPayload(
  payload: CreateOrderPayload,
  providerOrderId: string,
  awb: string,
): Order & { providerOrderId: string } {
  const now = new Date().toISOString();
  return {
    id: providerOrderId,
    userId: "courier-api",
    orderId: payload.orderId,
    orderType: payload.orderType,
    paymentType: payload.paymentType,
    status: awb ? "booked" : "created",
    courierId: payload.courierId,
    serviceProvider: "teampafex",
    courierName: payload.courierName || getCourierDisplayName(payload.courierId),
    awb,
    providerOrderId,
    pickupAddressId: payload.pickupAddressId,
    deliveryAddress: {
      contactName: payload.buyerName,
      phone: payload.buyerPhone,
      email: payload.buyerEmail,
      addressLine1: payload.address,
      addressLine2: payload.address2,
      city: payload.city,
      state: payload.state,
      country: "India",
      pincode: payload.pincode,
    },
    weight: payload.weight,
    length: payload.length,
    breadth: payload.breadth,
    height: payload.height,
    chargeableWeight: payload.chargeableWeight,
    products: payload.products,
    orderAmount: payload.orderAmount,
    codAmount: payload.codAmount,
    rate: payload.rate,
    createdAt: now,
    updatedAt: now,
    companyName: payload.companyName,
    companyGst: payload.companyGst,
    packages: payload.packages,
    invoices: payload.invoices,
    chargesBreakdown: payload.chargesBreakdown,
  };
}

async function createDirectCourierOrder(data: CreateOrderPayload): Promise<Order> {
  try {
    const providerPickupAddress = await resolveProviderPickupAddress(data.pickupAddressId);
    const providerPayload = toProviderCreateOrderPayload(data, providerPickupAddress);
    const result = await courierApi.createOrder(providerPayload);
    if (!result.status) throw new Error(result.msg || "Courier API order creation failed");
    const order = makeOrderFromPayload(data, getProviderOrderId(result), getProviderAwb(result));
    const existing = courierApi.readStoredOrders<Order & { providerOrderId: string }>();
    courierApi.writeStoredOrders([order, ...existing.filter((item) => item.id !== order.id)]);
    return order;
  } catch (err) {
    if (isNetworkError(err)) {
      throw new Error(
        "Real shipment was not sent to Teampafex because the browser cannot reach the courier API directly. Deploy the Shipsy API server and set TEAMPAFEX_EMAIL and TEAMPAFEX_PASSWORD there.",
      );
    }
    throw err;
  }
}

function isNetworkError(err: unknown): boolean {
  return err instanceof Error && err.message.toLowerCase().includes("network");
}

function isApiUnavailableError(err: unknown): boolean {
  const status = typeof (err as { status?: unknown })?.status === "number"
    ? (err as { status: number }).status
    : undefined;
  const message = err instanceof Error ? err.message.toLowerCase() : "";
  return isNetworkError(err) || status === 404 || status === 405 || message.includes("not reachable");
}

function apiServerUnavailableError(): Error {
  return new Error(
    "Shipsy API server is not reachable. Deploy the Render web service from render.yaml and set TEAMPAFEX_EMAIL and TEAMPAFEX_PASSWORD there, then redeploy.",
  );
}

async function createSameOriginApiOrder(data: CreateOrderPayload): Promise<Order | null> {
  if (typeof window === "undefined") return null;

  const sameOriginApi = `${window.location.origin.replace(/\/+$/, "")}/api`;
  const configuredApi = String(api.defaults.baseURL || "").replace(/\/+$/, "");
  if (sameOriginApi === configuredApi) return null;

  try {
    const response = await axios.post<{ order?: Order }>(`${sameOriginApi}/orders`, data, {
      timeout: 60_000,
      headers: { "Content-Type": "application/json" },
      withCredentials: true,
    });
    return response.data?.order ?? null;
  } catch {
    return null;
  }
}

function mapProviderOrder(raw: CourierRawOrder): Order {
  const status = mapProviderStatus(raw.status);
  const totalCharge = toNumber(raw.shipping_amount ?? raw.payment_amount);
  const createdAt = raw.order_date ? new Date(String(raw.order_date)).toISOString() : new Date().toISOString();
  return {
    id: String(raw.id),
    userId: "courier-api",
    orderId: String(raw.invoice_number || raw.id),
    orderType: "B2C",
    paymentType: String(raw.payment_method || "PREPAID").toLowerCase() === "cod" ? "cod" : "prepaid",
    status,
    courierId: "",
    serviceProvider: "courier_api",
    courierName: "Courier API",
    awb: String(raw.awb_no || ""),
    providerOrderId: String(raw.id),
    pickupAddressId: String(raw.pickup_address_id || ""),
    deliveryAddress: {
      contactName: String(raw.buyer_name || ""),
      phone: String(raw.buyer_mobile || ""),
      email: raw.buyer_email || undefined,
      addressLine1: String(raw.buyer_address1 || ""),
      addressLine2: String(raw.buyer_address2 || ""),
      city: String(raw.buyer_city || ""),
      state: String(raw.buyer_state || ""),
      country: String(raw.country || "India"),
      pincode: String(raw.buyer_pincode || ""),
    },
    weight: 0,
    length: 0,
    breadth: 0,
    height: 0,
    chargeableWeight: 0,
    products: [],
    orderAmount: toNumber(raw.payment_amount),
    codAmount: toNumber(raw.cod_amount),
    rate: {
      forward: totalCharge,
      rto: 0,
      codCharges: 0,
      otherCharges: 0,
      freightCharge: totalCharge,
      totalCharge,
      zone: "",
    },
    shippedAt: raw.manifested_at || undefined,
    deliveredAt: raw.delivered_at || undefined,
    cancelledAt: raw.cancelled_at || undefined,
    createdAt,
    updatedAt: createdAt,
  };
}

async function getProviderOrders(params?: OrderListParams): Promise<OrderListResponse> {
  let orders: Order[] = [];
  try {
    const response = await courierApi.getOrders();
    // Teampafex has returned both `{ orders: [] }` and `{ data: { orders: [] } }`
    // over time.  Accept both shapes (and a bare array) so a successful
    // provider response never gets mistaken for an empty order list.
    const rawResponse = response as CourierOrdersResponse & {
      data?: { orders?: CourierRawOrder[] } | CourierRawOrder[];
    };
    const providerOrders = Array.isArray(rawResponse)
      ? rawResponse
      : rawResponse.orders ?? (Array.isArray(rawResponse.data) ? rawResponse.data : rawResponse.data?.orders) ?? [];
    orders = providerOrders.map(mapProviderOrder);
  } catch {
    orders = [];
  }

  try {
    const mirror = await axios.get<{ orders?: Order[] }>(PROVIDER_ORDER_MIRROR_URL, { timeout: 15_000 });
    const seen = new Set(orders.map((order) => order.id));
    (mirror.data?.orders ?? []).forEach((order) => {
      if (!seen.has(order.id)) orders.unshift(order);
    });
  } catch {
    // Provider mirror is optional; continue with upstream/local orders.
  }

  const storedOrders = courierApi.readStoredOrders<Order & { providerOrderId: string }>();
  const seen = new Set(orders.map((order) => order.id));
  storedOrders.forEach((order) => {
    if (!seen.has(order.id)) orders.unshift(order);
  });

  if (params?.status) orders = orders.filter((order) => order.status === params.status);
  if (params?.orderType) orders = orders.filter((order) => order.orderType === params.orderType);
  if (params?.paymentType) orders = orders.filter((order) => order.paymentType === params.paymentType);
  if (params?.pickupAddressId) orders = orders.filter((order) => order.pickupAddressId === params.pickupAddressId);
  if (params?.search) {
    const query = params.search.toLowerCase();
    orders = orders.filter((order) =>
      [order.orderId, order.awb, order.deliveryAddress.contactName, order.deliveryAddress.phone]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(query)),
    );
  }

  const page = params?.page ?? 1;
  const limit = params?.limit ?? 20;
  const total = orders.length;
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const start = (page - 1) * limit;
  const paginated = orders.slice(start, start + limit);

  return {
    orders: paginated,
    pagination: { page, limit, total, totalPages },
    stats: buildStats(orders),
  };
}

export const ordersApi = {
  create: async (data: CreateOrderPayload): Promise<Order> => {
    if (isFshipServiceProvider(data.serviceProvider) || data.courierId.toLowerCase().includes("logixmitra")) {
      return createFshipOrder(data);
    }

    if (data.serviceProvider?.toLowerCase() === "delhivery" || data.courierId.toLowerCase().includes("delhivery")) {
      return createDelhiveryOrder(data);
    }

    if (shouldUseCourierApi()) {
      if (!isCourierApiConfigured()) {
        throw new Error(
          "Real shipment was not sent to Teampafex. Configure TEAMPAFEX_EMAIL and TEAMPAFEX_PASSWORD on the Shipsy API server, then redeploy.",
        );
      }

      return createDirectCourierOrder(data);
    }

    try {
      const { data: result } = await api.post("/orders", data);
      if (!result?.order) throw apiServerUnavailableError();
      return result.order as Order;
    } catch (err) {
      if (isApiUnavailableError(err)) {
        const sameOriginOrder = await createSameOriginApiOrder(data);
        if (sameOriginOrder) return sameOriginOrder;
      }
      if (isCourierApiConfigured()) return createDirectCourierOrder(data);
      if (isApiUnavailableError(err)) throw apiServerUnavailableError();
      throw err;
    }
  },

  getAll: async (params?: OrderListParams): Promise<OrderListResponse> => {
    if (shouldUseCourierApi()) {
      return getProviderOrders(params);
    }

    if (shouldUseFshipApi()) {
      let orders = fshipApi.readStoredOrders<Order & { providerOrderId: string }>();
      if (params?.status) orders = orders.filter((order) => order.status === params.status);
      if (params?.orderType) orders = orders.filter((order) => order.orderType === params.orderType);
      if (params?.paymentType) orders = orders.filter((order) => order.paymentType === params.paymentType);
      if (params?.search) {
        const query = params.search.toLowerCase();
        orders = orders.filter((order) =>
          [order.orderId, order.awb, order.deliveryAddress.contactName, order.deliveryAddress.phone]
            .filter(Boolean)
            .some((value) => String(value).toLowerCase().includes(query)),
        );
      }
      const page = params?.page ?? 1;
      const limit = params?.limit ?? 20;
      const total = orders.length;
      const start = (page - 1) * limit;
      return {
        orders: orders.slice(start, start + limit),
        pagination: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) },
        stats: buildStats(orders),
      };
    }

    const { data } = await api.get("/orders", { params });
    const result = data as OrderListResponse;
    // Even when the main API feature flag is disabled, provider-created
    // shipments must remain visible in the seller's order list.
    try {
      const mirror = await axios.get<{ orders?: Order[] }>(PROVIDER_ORDER_MIRROR_URL, { timeout: 15_000 });
      const mirrored = mirror.data?.orders ?? [];
      const existing = new Set(result.orders.map((order) => order.id));
      const merged = [...result.orders, ...mirrored.filter((order) => !existing.has(order.id))];
      return {
        ...result,
        orders: merged,
        pagination: { ...result.pagination, total: merged.length, totalPages: Math.max(1, Math.ceil(merged.length / (params?.limit ?? 20))) },
      };
    } catch {
      return result;
    }
  },

  getById: async (id: string): Promise<Order> => {
    const fshipMatch = fshipApi
      .readStoredOrders<Order & { providerOrderId: string }>()
      .find((order) => order.id === id || order.orderId === id || order.providerOrderId === id || order.awb === id);
    if (fshipMatch) return fshipMatch;

    if (shouldUseCourierApi()) {
      const stored = courierApi.readStoredOrders<Order & { providerOrderId: string }>();
      const match = stored.find((order) => order.id === id || order.orderId === id || order.providerOrderId === id);
      if (match) return match;
      const orders = await getProviderOrders({ search: id, page: 1, limit: 1 });
      const order = orders.orders[0];
      if (!order) throw new Error("Order not found");
      return order;
    }

    const { data } = await api.get(`/orders/${id}`);
    return data.order as Order;
  },

  downloadLabel: async (id: string, awb: string): Promise<void> => {
    const { data } = await api.get(`/orders/${id}/label`, { responseType: "blob" });
    downloadBlob(data, `label-${(awb || id).replace(/[^\w.-]+/g, "_")}.pdf`);
  },

  downloadInvoice: async (id: string, orderId: string): Promise<void> => {
    const { data } = await api.get(`/orders/${id}/invoice`, { responseType: "blob" });
    downloadBlob(data, `invoice-${(orderId || id).replace(/[^\w.-]+/g, "_")}.pdf`);
  },

  // ── New lifecycle APIs ──

  manifestOrders: async (orderIds: string[]): Promise<ManifestResponse> => {
    const storedFshipOrders = fshipApi.readStoredOrders<Order & { providerOrderId: string }>();
    const fshipOrders = orderIds
      .map((id) => storedFshipOrders.find((order) => order.id === id || order.orderId === id || order.providerOrderId === id || order.awb === id))
      .filter((order): order is Order & { providerOrderId: string } => Boolean(order));
    if (fshipOrders.length === orderIds.length && fshipOrders.length > 0) {
      const result = await fshipApi.registerPickup(fshipOrders.map((order) => order.awb).filter(Boolean));
      if (!result.status) {
        return {
          ordersProcessed: 0,
          errors: fshipOrders.map((order) => ({ awb: order.awb || order.orderId, error: result.response || "LogixMitra pickup registration failed" })),
        };
      }
      const now = new Date().toISOString();
      const updated = storedFshipOrders.map((order) =>
        fshipOrders.some((item) => item.id === order.id)
          ? { ...order, status: "pickup_initiated" as const, pickupRequestedAt: now, updatedAt: now }
          : order,
      );
      fshipApi.writeStoredOrders(updated);
      return { ordersProcessed: fshipOrders.length, errors: [] };
    }

    if (shouldUseCourierApi()) {
      return {
        ordersProcessed: 0,
        errors: [],
        warnings: orderIds.map((id) => ({
          awb: id,
          warning: "Courier API manifest/pickup endpoint is not available in the provided documentation.",
        })),
      };
    }

    const { data } = await api.post("/orders/manifest-orders", { orderIds });
    return data;
  },

  // ── Bulk B2C ──

  bulkCreate: async (orders: CreateOrderPayload[]): Promise<BulkCreateResponse> => {
    if (shouldUseCourierApi()) {
      const results: BulkCreateRowResult[] = [];
      for (let i = 0; i < orders.length; i += 1) {
        try {
          const order = await ordersApi.create(orders[i]);
          results.push({ rowNumber: i + 1, orderId: order.orderId, success: true, order });
        } catch (err) {
          results.push({
            rowNumber: i + 1,
            orderId: orders[i].orderId,
            success: false,
            error: err instanceof Error ? err.message : "Order creation failed",
          });
        }
      }
      const successCount = results.filter((result) => result.success).length;
      return {
        success: successCount === orders.length,
        total: orders.length,
        successCount,
        failedCount: orders.length - successCount,
        results,
      };
    }

    const { data } = await api.post("/orders/bulk-create", { orders });
    return data as BulkCreateResponse;
  },

  bulkCreateB2B: async (orders: CreateOrderPayload[]): Promise<BulkCreateResponse> => {
    if (shouldUseCourierApi()) {
      return ordersApi.bulkCreate(orders);
    }

    const { data } = await api.post("/orders/bulk-create-b2b", { orders });
    return data as BulkCreateResponse;
  },

  bulkManifest: async (orderIds: string[]): Promise<ManifestResponse> => {
    if (shouldUseCourierApi()) {
      return ordersApi.manifestOrders(orderIds);
    }

    const { data } = await api.post("/orders/bulk-manifest", { orderIds });
    return data;
  },

  downloadBulkLabels: async (orderIds: string[]): Promise<void> => {
    const { data } = await api.post("/orders/bulk-labels", { orderIds }, { responseType: "blob" });
    downloadBlob(data, `labels-${orderIds.length}.pdf`);
  },

  /** Download the pickup manifest for a single order. Same download-only rules as the bulk version. */
  downloadManifest: async (id: string, orderId: string): Promise<void> => {
    const { data } = await api.post("/orders/manifest", { orderIds: [id] }, { responseType: "blob" });
    downloadBlob(data, `manifest-${orderId.replace(/[^\w.-]+/g, "_")}.pdf`);
  },

  /**
   * Download the pickup manifest for a batch of orders — one sheet per courier
   * in a single PDF. Download only: it does NOT raise pickups or mark the
   * orders manifested (that stays with "Initiate Pickup").
   */
  downloadBulkManifest: async (orderIds: string[]): Promise<void> => {
    const { data } = await api.post("/orders/manifest", { orderIds }, { responseType: "blob" });
    downloadBlob(data, `manifest-${orderIds.length}.pdf`);
  },

  /** Couriers this seller has shipped with — options for the orders courier filter. */
  getCourierOptions: async (orderType?: string): Promise<Array<{ id: string; name: string }>> => {
    if (shouldUseCourierApi()) {
      const partners = await courierApi.getCourierIds();
      return partners
        .filter((partner) => !orderType || String(partner.type).toUpperCase() === orderType.toUpperCase())
        .map((partner) => ({ id: String(partner.id), name: partner.name }));
    }

    const { data } = await api.get("/orders/courier-options", { params: { orderType } });
    return (data.couriers ?? []) as Array<{ id: string; name: string }>;
  },

  downloadBulkTemplate: async (): Promise<void> => {
    const { data } = await api.get("/orders/bulk-template", { responseType: "blob" });
    downloadBlob(data, "b2c-bulk-upload-template.csv");
  },

  cancelOrder: async (id: string, reason?: string): Promise<Order> => {
    const fshipStored = fshipApi.readStoredOrders<Order & { providerOrderId: string }>();
    const fshipOrder = fshipStored.find((order) => order.id === id || order.orderId === id || order.providerOrderId === id || order.awb === id);
    if (fshipOrder) {
      await fshipApi.cancelOrder(extractFshipProviderId(id), reason);
      const updated = { ...fshipOrder, status: "cancelled" as const, cancelledAt: new Date().toISOString() };
      fshipApi.writeStoredOrders([updated, ...fshipStored.filter((item) => item.id !== updated.id)]);
      return updated;
    }

    if (shouldUseCourierApi()) {
      const order = await ordersApi.getById(id);
      // Delhivery orders are created through the Delhivery proxy and must not
      // be sent to the Teampafex cancellation endpoint.
      if (order.serviceProvider !== "delhivery") {
        await courierApi.cancelOrder(extractProviderOrderId(id));
      }
      const updated = { ...order, status: "cancelled" as const, cancelledAt: new Date().toISOString() };
      const stored = courierApi.readStoredOrders<Order & { providerOrderId: string }>();
      courierApi.writeStoredOrders([updated as Order & { providerOrderId: string }, ...stored.filter((item) => item.id !== updated.id)]);
      await mirrorProviderOrder(updated);
      return updated;
    }

    const { data } = await api.post(`/orders/${id}/cancel`, { reason });
    return data.order as Order;
  },

  getTracking: async (id: string): Promise<TrackingEvent[]> => {
    const fshipAwb = extractFshipProviderId(id);
    const fshipStored = fshipApi.readStoredOrders<Order & { providerOrderId: string }>();
    const hasFshipOrder = fshipStored.some((order) => order.id === id || order.orderId === id || order.providerOrderId === id || order.awb === id);
    if (hasFshipOrder) {
      const history = await fshipApi.trackingHistory(fshipAwb).catch(() => fshipApi.shipmentSummary(fshipAwb));
      return mapFshipTrackingEvents(extractFshipApiOrderId(id), fshipAwb, history);
    }

    if (shouldUseCourierApi()) {
      const providerOrderId = extractProviderOrderId(id);
      const data = await courierApi.trackOrder(providerOrderId);
      return [{
        id: `${providerOrderId}-latest`,
        orderId: providerOrderId,
        awb: "",
        statusCode: mapProviderStatus(data.order_status),
        statusText: data.order_status,
        source: "courier_api",
        remarks: data.msg,
        createdAt: new Date().toISOString(),
      }];
    }

    const { data } = await api.get(`/orders/${id}/tracking`);
    return data as TrackingEvent[];
  },

  // ── NDR ──

  listNdr: async (params?: NdrRtoFilterParams): Promise<{ orders: Order[]; total: number }> => {
    const { data } = await api.get("/orders/ndr/list", { params });
    return data;
  },

  takeNdrAction: async (id: string, payload: { action: "reattempt" | "rto" | "reschedule"; remarks?: string }): Promise<void> => {
    await api.post(`/orders/${id}/ndr-action`, payload);
  },

  // ── RTO ──

  listRto: async (params?: NdrRtoFilterParams & { rtoPhase?: string }): Promise<{ orders: Order[]; total: number }> => {
    const { data } = await api.get("/orders/rto/list", { params });
    return data;
  },
};
