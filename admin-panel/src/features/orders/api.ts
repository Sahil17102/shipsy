import axios from "axios";
import { api } from "@/lib/api";
import type {
  ListOrdersResponse,
  GetOrderDetailResponse,
  OrderStatus,
  TrackingEvent,
  NdrEventItem,
  RtoEventItem,
  OrderListItem,
  NdrOrderListItem,
  RtoOrderListItem,
  ExpandableOrderRelation,
  ExportJob,
  ListExportJobsResponse,
} from "./types";

const useStaticData = import.meta.env.PROD || import.meta.env.VITE_STATIC_DATA_ENABLED !== "false";
const PROVIDER_API_URL = "https://shipsy-courier-api.onrender.com/api/provider-orders";

type ProviderOrder = Record<string, unknown>;

function providerStatus(value: unknown): OrderStatus {
  const status = String(value || "created").toLowerCase().replace(/[\s-]+/g, "_");
  const aliases: Record<string, OrderStatus> = {
    created: "created", processing: "processing", booked: "booked",
    pickup_initiated: "pickup_initiated", shipped: "shipped",
    ready_to_ship: "booked", manifested: "booked", dispatched: "shipped",
    in_transit: "in_transit", out_for_delivery: "out_for_delivery", delivered: "delivered",
    cancelled: "cancelled", canceled: "cancelled", rto: "rto_initiated",
    rto_initiated: "rto_initiated", rto_in_transit: "rto_in_transit",
    rto_delivered: "rto_delivered", ndr: "ndr", lost: "lost",
  };
  return aliases[status] ?? "created";
}

function numberValue(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function mapProviderOrder(raw: ProviderOrder): OrderListItem {
  // The shared mirror already stores ShipSy-normalized orders. Preserve those
  // fields instead of treating them like a raw courier response.
  if (raw.deliveryAddress && raw.orderId && raw.rate) {
    return {
      ...(raw as unknown as OrderListItem),
      id: String(raw.id),
      orderId: String(raw.orderId),
      awb: String(raw.awb ?? ""),
      status: providerStatus(raw.status),
      courierName: String(raw.courierName ?? "Delhivery"),
      serviceProvider: String(raw.serviceProvider ?? "delhivery"),
      createdAt: String(raw.createdAt ?? new Date().toISOString()),
    };
  }
  const id = String(raw.id ?? raw.order_id ?? raw.awb_no ?? "");
  const amount = numberValue(raw.payment_amount ?? raw.order_amount ?? raw.total_order_value);
  const charge = numberValue(raw.shipping_amount ?? raw.shipping_charge ?? raw.total_charges);
  return {
    id,
    userId: "courier-api",
    courierId: String(raw.courier_id ?? raw.delivery_partner_id ?? ""),
    pickupAddressId: String(raw.pickup_address_id ?? ""),
    orderId: String(raw.invoice_number ?? raw.order_number ?? id),
    orderType: String(raw.order_type ?? "B2C").toUpperCase() === "B2B" ? "B2B" : "B2C",
    paymentType: String(raw.payment_method ?? "PREPAID").toLowerCase() === "cod" ? "cod" : "prepaid",
    status: providerStatus(raw.status ?? raw.order_status),
    serviceProvider: "delhivery",
    courierName: "Delhivery",
    awb: String(raw.awb_no ?? raw.awb ?? ""),
    deliveryAddress: {
      contactName: String(raw.buyer_name ?? raw.customer_name ?? ""),
      phone: String(raw.buyer_mobile ?? raw.phone ?? ""),
      email: raw.buyer_email ? String(raw.buyer_email) : undefined,
      addressLine1: String(raw.buyer_address1 ?? raw.address ?? ""),
      addressLine2: raw.buyer_address2 ? String(raw.buyer_address2) : undefined,
      city: String(raw.buyer_city ?? raw.city ?? ""),
      state: String(raw.buyer_state ?? raw.state ?? ""),
      country: String(raw.country ?? "India"),
      pincode: String(raw.buyer_pincode ?? raw.pincode ?? ""),
    },
    weight: numberValue(raw.weight ?? raw.total_weight),
    chargeableWeight: numberValue(raw.chargeable_weight ?? raw.weight),
    products: [],
    orderAmount: amount,
    codAmount: numberValue(raw.cod_amount),
    rate: { forward: charge, rto: 0, codCharges: 0, otherCharges: 0, freightCharge: charge, totalCharge: charge, zone: String(raw.zone ?? "") },
    createdAt: String(raw.order_date ?? raw.created_at ?? new Date().toISOString()),
  };
}

async function listProviderOrders(): Promise<OrderListItem[]> {
  try {
    const { data } = await axios.get(PROVIDER_API_URL, { timeout: 60_000 });
    const rows = Array.isArray(data) ? data : data?.orders ?? data?.data?.orders ?? data?.data ?? [];
    return Array.isArray(rows) ? rows.map(mapProviderOrder).filter((order) => order.id) : [];
  } catch {
    return [];
  }
}

function emptyOrderStats() {
  return {
    total: 0, created: 0, processing: 0, booked: 0, pickup_initiated: 0,
    shipped: 0, in_transit: 0, out_for_delivery: 0, delivered: 0, ndr: 0,
    rto_initiated: 0, rto_in_transit: 0, rto_delivered: 0, cancelled: 0,
    lost: 0, totalRevenue: 0,
  };
}

export interface OrderFiltersParams {
  search?: string;
  status?: string;
  orderType?: string;
  paymentType?: string;
  serviceProvider?: string;
  /** Filter by the named courier (couriers.id) rather than the aggregator slug. */
  courierId?: string;
  userId?: string;
  startDate?: string;
  endDate?: string;
  page?: number;
  limit?: number;
  sortField?: string;
  sortOrder?: string;
  // Frontend-driven embedding — see server/src/utils/expand.ts. Pass the
  // relations you actually need on this page; absent ones are omitted.
  expand?: ExpandableOrderRelation[];
}

/**
 * Filters shared by the NDR and RTO lists. They accept the same names as the
 * main order list so one mental model (and one server-side where-builder)
 * covers all three screens — except `startDate`/`endDate`, which mean "NDR
 * date" / "RTO updated" on those screens rather than "order created".
 */
export interface NdrRtoFiltersParams {
  page?: number;
  limit?: number;
  search?: string;
  courierId?: string;
  userId?: string;
  paymentType?: string;
  orderType?: string;
  startDate?: string;
  endDate?: string;
  sortField?: string;
  sortOrder?: string;
}

function withExpand<T extends { expand?: ExpandableOrderRelation[] }>(
  params: T | undefined,
): (Omit<T, "expand"> & { expand?: string }) | undefined {
  if (!params) return params;
  const { expand, ...rest } = params;
  return expand && expand.length > 0
    ? ({ ...rest, expand: expand.join(",") } as Omit<T, "expand"> & { expand: string })
    : (rest as Omit<T, "expand">);
}

export const ordersApi = {
  list: async (params?: OrderFiltersParams): Promise<ListOrdersResponse> => {
    if (useStaticData) {
      const page = params?.page ?? 1;
      const limit = params?.limit ?? 20;
      let orders = await listProviderOrders();
      if (params?.search) {
        const query = params.search.toLowerCase();
        orders = orders.filter((order) => [order.orderId, order.awb, order.deliveryAddress.contactName, order.deliveryAddress.city]
          .some((value) => String(value || "").toLowerCase().includes(query)));
      }
      if (params?.status) orders = orders.filter((order) => order.status === params.status);
      if (params?.orderType) orders = orders.filter((order) => order.orderType === params.orderType);
      if (params?.paymentType) orders = orders.filter((order) => order.paymentType === params.paymentType);
      const stats = emptyOrderStats();
      stats.total = orders.length;
      orders.forEach((order) => {
        stats[order.status] += 1;
        stats.totalRevenue += order.rate.totalCharge;
      });
      const total = orders.length;
      const start = (page - 1) * limit;
      return { orders: orders.slice(start, start + limit), pagination: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) }, stats };
    }
    const { data } = await api.get("/orders", { params: withExpand(params) });
    return data as ListOrdersResponse;
  },

  getById: async (id: string, expand?: ExpandableOrderRelation[]): Promise<GetOrderDetailResponse> => {
    if (useStaticData) {
      const orders = await listProviderOrders();
      const order = orders.find((item) => [item.id, item.orderId, item.awb].includes(id));
      if (order) return { order: order as GetOrderDetailResponse["order"] };
    }
    const { data } = await api.get(`/orders/${id}`, {
      params: expand && expand.length > 0 ? { expand: expand.join(",") } : undefined,
    });
    return data as GetOrderDetailResponse;
  },

  // ── Status Management ──

  updateStatus: async (
    id: string,
    payload: {
      status: OrderStatus;
      remarks?: string;
      location?: string;
      ndrReason?: string;
      ndrNextAction?: string;
      rtoCharges?: number;
      codAmount?: number;
    },
  ): Promise<{ order: OrderListItem }> => {
    const { data } = await api.patch(`/orders/${id}/status`, payload);
    return data;
  },

  getTransitions: async (id: string): Promise<{ currentStatus: string; validTransitions: OrderStatus[] }> => {
    const { data } = await api.get(`/orders/${id}/transitions`);
    return data;
  },

  cancelOrder: async (id: string, reason?: string): Promise<{ order: OrderListItem }> => {
    if (useStaticData) {
      try {
        const { data } = await axios.post(`${PROVIDER_API_URL}/${encodeURIComponent(id)}/cancel`, { reason }, { timeout: 30_000 });
        return { order: mapProviderOrder(data.order as ProviderOrder) };
      } catch (error) {
        if (axios.isAxiosError(error) && error.response?.status !== 404) throw error;
      }
    }
    const { data } = await api.post(`/orders/${id}/cancel`, { reason });
    return data;
  },

  // ── Tracking ──

  getTracking: async (id: string): Promise<TrackingEvent[]> => {
    const { data } = await api.get(`/orders/${id}/tracking`);
    return data as TrackingEvent[];
  },

  // ── NDR ──

  listNdr: async (params?: NdrRtoFiltersParams): Promise<{ orders: NdrOrderListItem[]; total: number }> => {
    const { data } = await api.get("/orders/ndr/list", { params });
    return data;
  },

  getNdrEvents: async (id: string): Promise<NdrEventItem[]> => {
    const { data } = await api.get(`/orders/${id}/ndr-events`);
    return data as NdrEventItem[];
  },

  recordNdr: async (id: string, payload: { reason: string; remarks?: string; location?: string; nextAction?: string; attemptDate?: string }): Promise<void> => {
    await api.post(`/orders/${id}/ndr`, payload);
  },

  takeNdrAction: async (id: string, payload: { action: "reattempt" | "rto" | "reschedule"; remarks?: string; rescheduledDate?: string }): Promise<void> => {
    await api.post(`/orders/${id}/ndr-action`, payload);
  },

  // ── CSV export (async) ──

  /** Queue a server-side CSV build for the given filters. Returns instantly. */
  startExport: async (params: OrderFiltersParams = {}): Promise<{ job: ExportJob; reused: boolean; message?: string }> => {
    const { page, limit, sortField, sortOrder, expand, ...filters } = params;
    // `{}` rather than null — axios serialises a null body to the literal
    // string "null", which body-parser's strict JSON mode rejects.
    const { data } = await api.post("/orders/export", {}, { params: filters });
    return data;
  },

  listExports: async (params: { page?: number; limit?: number } = {}): Promise<ListExportJobsResponse> => {
    const { data } = await api.get("/orders/exports", { params });
    return data as ListExportJobsResponse;
  },

  rerunExport: async (id: string): Promise<{ job: ExportJob; reused: boolean }> => {
    const { data } = await api.post(`/orders/exports/${id}/rerun`, {});
    return data;
  },

  downloadExport: async (id: string): Promise<Blob> => {
    const { data } = await api.get(`/orders/exports/${id}/download`, { responseType: "blob" });
    return data as Blob;
  },

  // ── RTO ──

  listRto: async (params?: NdrRtoFiltersParams & { rtoPhase?: string }): Promise<{ orders: RtoOrderListItem[]; total: number }> => {
    const { data } = await api.get("/orders/rto/list", { params });
    return data;
  },

  getRtoEvents: async (id: string): Promise<RtoEventItem[]> => {
    const { data } = await api.get(`/orders/${id}/rto-events`);
    return data as RtoEventItem[];
  },

  updateRtoPhase: async (id: string, payload: { phase: "initiated" | "in_transit" | "delivered"; remarks?: string; rtoCharges?: number }): Promise<void> => {
    await api.post(`/orders/${id}/rto`, payload);
  },
};
