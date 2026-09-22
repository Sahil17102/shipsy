import { api } from "@/lib/api";
import type { ListOrdersResponse, OrderListItem, TrackingEvent } from "../orders/types";

export interface TrackingSearchParams {
  search?: string;
  page?: number;
  limit?: number;
}

const emptyOrdersResponse: ListOrdersResponse = {
  orders: [],
  pagination: { page: 1, limit: 10, total: 0, totalPages: 0 },
  stats: {
    total: 0,
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
  },
};

function normalizeOrderSearchResponse(data: unknown): ListOrdersResponse {
  if (data && typeof data === "object") {
    const record = data as Record<string, unknown>;
    if (Array.isArray(record.orders)) {
      return {
        ...emptyOrdersResponse,
        ...(record as Partial<ListOrdersResponse>),
        orders: record.orders as OrderListItem[],
      };
    }
    if (Array.isArray(record.data)) {
      return {
        ...emptyOrdersResponse,
        orders: record.data as OrderListItem[],
      };
    }
  }

  if (Array.isArray(data)) {
    return {
      ...emptyOrdersResponse,
      orders: data as OrderListItem[],
    };
  }

  return emptyOrdersResponse;
}

export const orderTrackingApi = {
  search: async (params: TrackingSearchParams): Promise<ListOrdersResponse> => {
    // Always opt into the user expansion — the tracking UI shows the seller's
    // business name alongside each order.
    const { data } = await api.get("/orders", { params: { ...params, expand: "user" } });
    return normalizeOrderSearchResponse(data);
  },

  getTracking: async (orderId: string): Promise<TrackingEvent[]> => {
    const { data } = await api.get(`/orders/${orderId}/tracking`);
    return data as TrackingEvent[];
  },
};
