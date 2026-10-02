import { walletApi } from "./walletApi";
import { ordersApi } from "./ordersApi";
import type { Order } from "./ordersTypes";

export interface QuickStats {
  ordersToday: number;
  inTransit: number;
  ndrPending: number;
  rtoPending: number;
}

export interface RecentHomeOrder {
  id: string;
  orderId: string;
  awb: string;
  status: string;
  serviceProvider: string;
  city: string;
  contactName: string;
  createdAt: string;
}

export interface StatusBucket {
  status: string;
  count: number;
}

export interface SellerHomeData {
  quickStats: QuickStats;
  wallet: { balance: number };
  codPending: { amount: number; count: number };
  statusDistribution: StatusBucket[];
  recentOrders: RecentHomeOrder[];
  performance: {
    deliveryRate: number;
    onTimeRate: number;
    avgTransitDays: number | null;
    ndrRate: number;
  };
}

function indiaDayKey(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  return new Date(date.getTime() + 330 * 60_000).toISOString().slice(0, 10);
}

function round(value: number, digits = 1): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function buildHomeData(orders: Order[], balance: number): SellerHomeData {
  const today = indiaDayKey(new Date());
  const activeTransit = new Set(["pickup_initiated", "shipped", "in_transit", "out_for_delivery"]);
  const rtoStatuses = new Set(["rto_initiated", "rto_in_transit", "rto_delivered"]);
  const statusCounts = new Map<string, number>();
  orders.forEach((order) => statusCounts.set(order.status, (statusCounts.get(order.status) ?? 0) + 1));
  const delivered = orders.filter((order) => order.status === "delivered");
  const completed = orders.filter((order) => order.status === "delivered" || order.status === "cancelled" || rtoStatuses.has(order.status));
  const transitDays = delivered.map((order) => {
    const start = new Date(order.createdAt).getTime();
    const end = new Date(order.deliveredAt || order.updatedAt).getTime();
    return Number.isFinite(start) && Number.isFinite(end) ? Math.max(0, (end - start) / 86_400_000) : null;
  }).filter((value): value is number => value != null);
  const onTime = transitDays.filter((days) => days <= 5).length;
  const codPendingOrders = orders.filter((order) => order.paymentType === "cod" && !["cancelled", "rto_delivered"].includes(order.status));

  return {
    quickStats: {
      ordersToday: orders.filter((order) => indiaDayKey(order.createdAt) === today).length,
      inTransit: orders.filter((order) => activeTransit.has(order.status)).length,
      ndrPending: orders.filter((order) => order.status === "ndr").length,
      rtoPending: orders.filter((order) => rtoStatuses.has(order.status)).length,
    },
    wallet: { balance },
    codPending: {
      amount: round(codPendingOrders.reduce((sum, order) => sum + Number(order.codAmount || 0), 0), 2),
      count: codPendingOrders.length,
    },
    statusDistribution: [...statusCounts.entries()]
      .map(([status, count]) => ({ status, count }))
      .sort((left, right) => right.count - left.count),
    recentOrders: orders.slice(0, 5).map((order) => ({
      id: order.id,
      orderId: order.orderId,
      awb: order.awb,
      status: order.status,
      serviceProvider: order.courierName || order.serviceProvider,
      city: order.deliveryAddress.city,
      contactName: order.deliveryAddress.contactName,
      createdAt: order.createdAt,
    })),
    performance: {
      deliveryRate: completed.length ? round((delivered.length / completed.length) * 100) : 0,
      onTimeRate: delivered.length ? round((onTime / delivered.length) * 100) : 0,
      avgTransitDays: transitDays.length ? round(transitDays.reduce((sum, days) => sum + days, 0) / transitDays.length) : null,
      ndrRate: orders.length ? round((orders.filter((order) => order.status === "ndr").length / orders.length) * 100) : 0,
    },
  };
}

export const homeApi = {
  get: async (): Promise<SellerHomeData> => {
    const emptyHome: SellerHomeData = {
      quickStats: {
        ordersToday: 0,
        inTransit: 0,
        ndrPending: 0,
        rtoPending: 0,
      },
      wallet: { balance: 0 },
      codPending: { amount: 0, count: 0 },
      statusDistribution: [],
      recentOrders: [],
      performance: { deliveryRate: 0, onTimeRate: 0, avgTransitDays: null, ndrRate: 0 },
    };
    try {
      const [orderData, wallet] = await Promise.all([
        ordersApi.getAll({ page: 1, limit: 10_000 }),
        walletApi.getBalance().catch(() => ({ balance: 0, currency: "INR" })),
      ]);
      return buildHomeData(orderData.orders, wallet.balance);
    } catch {
      const wallet = await walletApi.getBalance().catch(() => ({ balance: 0, currency: "INR" }));
      return { ...emptyHome, wallet: { balance: wallet.balance } };
    }
  },
};
