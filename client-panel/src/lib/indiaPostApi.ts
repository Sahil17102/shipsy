import { api } from "./api";
import type { CreateOrderPayload, Order } from "./ordersTypes";

export interface IndiaPostStatus {
  configured: boolean;
  environment: string;
  customerId: string;
  products: Array<"speed-post" | "business-parcel">;
}

export interface IndiaPostRateResponse {
  product: "speed-post" | "business-parcel";
  total: number;
  raw: unknown;
}

export interface IndiaPostBookingResponse {
  success: boolean;
  awb: string;
  providerOrderId: string;
  raw: unknown;
}

export const indiaPostApi = {
  status: async (): Promise<IndiaPostStatus> => {
    const { data } = await api.get<IndiaPostStatus>("/providers/india-post/status");
    return data;
  },
  rate: async (payload: {
    product: "speed-post" | "business-parcel";
    origin: string;
    destination: string;
    weight: number;
    length?: number;
    breadth?: number;
    height?: number;
  }): Promise<IndiaPostRateResponse> => {
    const { data } = await api.post<IndiaPostRateResponse>("/providers/india-post/rates", payload);
    return data;
  },
  book: async (order: CreateOrderPayload, pickup: Record<string, unknown>): Promise<IndiaPostBookingResponse> => {
    const { data } = await api.post<IndiaPostBookingResponse>("/providers/india-post/book", { order, pickup }, { timeout: 90_000 });
    return data;
  },
};

export function makeIndiaPostOrder(data: CreateOrderPayload, booking: IndiaPostBookingResponse): Order {
  const now = new Date().toISOString();
  return {
    id: booking.providerOrderId || booking.awb,
    providerOrderId: booking.providerOrderId,
    userId: "india-post",
    orderId: data.orderId,
    orderType: data.orderType,
    paymentType: data.paymentType,
    status: "booked",
    courierId: data.courierId,
    serviceProvider: "india-post",
    courierName: data.courierName || "India Post",
    awb: booking.awb,
    pickupAddressId: data.pickupAddressId,
    deliveryAddress: {
      contactName: data.buyerName,
      phone: data.buyerPhone,
      email: data.buyerEmail,
      addressLine1: data.address,
      addressLine2: data.address2,
      city: data.city,
      state: data.state,
      country: "India",
      pincode: data.pincode,
    },
    weight: data.weight,
    length: data.length,
    breadth: data.breadth,
    height: data.height,
    chargeableWeight: data.chargeableWeight,
    products: data.products,
    orderAmount: data.orderAmount,
    codAmount: data.codAmount,
    rate: data.rate,
    companyName: data.companyName,
    companyGst: data.companyGst,
    packages: data.packages,
    invoices: data.invoices,
    chargesBreakdown: data.chargesBreakdown,
    createdAt: now,
    updatedAt: now,
  };
}
