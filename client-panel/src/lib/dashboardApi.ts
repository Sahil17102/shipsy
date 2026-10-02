import { ordersApi } from "./ordersApi";
import type { Order } from "./ordersTypes";

// ── KPI with trend ──
export interface KpiTrend {
  current: number;
  previous: number;
}

export interface NullableKpiTrend {
  current: number | null;
  previous: number | null;
}

// ── Pipeline ──
export interface ShipmentPipeline {
  created: number;
  processing: number;
  inTransit: number;
  outForDelivery: number;
  ndr: number;
  rto: number;
}

// ── Trend ──
export interface TrendPoint {
  date: string;
  orders: number;
  delivered: number;
  rto: number;
}

// ── Courier ──
export interface CourierScore {
  courier: string;
  totalOrders: number;
  delivered: number;
  successRate: number;
  rtoRate: number;
  avgDeliveryDays: number | null;
  avgCost: number;
}

// ── Zone ──
export interface ZonePerf {
  zone: string;
  zoneName: string;
  totalOrders: number;
  successRate: number;
  rtoRate: number;
  avgCost: number;
  avgDeliveryDays: number | null;
}

// ── Payment ──
export interface PaymentBucket {
  orders: number;
  delivered: number;
  totalAmount: number;
  codAmount: number;
}

// ── City ──
export interface CityData {
  city: string;
  orders: number;
  deliveryRate: number;
}

// ── Full response ──
export interface SellerDashboardData {
  kpis: {
    deliveryRate: KpiTrend;
    avgDeliveryDays: NullableKpiTrend;
    rtoRate: KpiTrend;
    totalOrders: KpiTrend;
    totalCost: number;
  };
  pipeline: ShipmentPipeline;
  trends: TrendPoint[];
  courierScorecard: CourierScore[];
  zonePerformance: ZonePerf[];
  paymentSplit: {
    prepaid: PaymentBucket;
    cod: PaymentBucket;
  };
  codPending: {
    amount: number;
    count: number;
  };
  topCities: CityData[];
}

// ── Filters ──
export interface DashboardFilters {
  from?: string;
  to?: string;
  days?: number;
  orderType?: "B2B" | "B2C";
}

function emptyBucket(): PaymentBucket {
  return { orders: 0, delivered: 0, totalAmount: 0, codAmount: 0 };
}

function getStaticSummary(): SellerDashboardData {
  return {
    kpis: {
      deliveryRate: { current: 0, previous: 0 },
      avgDeliveryDays: { current: null, previous: null },
      rtoRate: { current: 0, previous: 0 },
      totalOrders: { current: 0, previous: 0 },
      totalCost: 0,
    },
    pipeline: {
      created: 0,
      processing: 0,
      inTransit: 0,
      outForDelivery: 0,
      ndr: 0,
      rto: 0,
    },
    trends: [],
    courierScorecard: [],
    zonePerformance: [],
    paymentSplit: {
      prepaid: emptyBucket(),
      cod: emptyBucket(),
    },
    codPending: {
      amount: 0,
      count: 0,
    },
    topCities: [],
  };
}

function round(value: number, digits = 1): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function indiaDayKey(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  return new Date(date.getTime() + 330 * 60_000).toISOString().slice(0, 10);
}

function orderDate(order: Order): Date | null {
  const date = new Date(order.createdAt);
  return Number.isNaN(date.getTime()) ? null : date;
}

function deliveryRate(orders: Order[]): number {
  const completed = orders.filter((order) => ["delivered", "cancelled", "rto_delivered", "lost"].includes(order.status));
  return completed.length ? round((completed.filter((order) => order.status === "delivered").length / completed.length) * 100) : 0;
}

function rtoRate(orders: Order[]): number {
  return orders.length ? round((orders.filter((order) => order.status.startsWith("rto_")).length / orders.length) * 100) : 0;
}

function averageDeliveryDays(orders: Order[]): number | null {
  const durations = orders.filter((order) => order.status === "delivered").map((order) => {
    const start = new Date(order.createdAt).getTime();
    const end = new Date(order.deliveredAt || order.updatedAt).getTime();
    return Number.isFinite(start) && Number.isFinite(end) ? Math.max(0, (end - start) / 86_400_000) : null;
  }).filter((value): value is number => value != null);
  return durations.length ? round(durations.reduce((sum, value) => sum + value, 0) / durations.length) : null;
}

function groupOrders(orders: Order[], keyFor: (order: Order) => string): Map<string, Order[]> {
  const groups = new Map<string, Order[]>();
  orders.forEach((order) => {
    const key = keyFor(order);
    groups.set(key, [...(groups.get(key) ?? []), order]);
  });
  return groups;
}

function dateRange(filters?: DashboardFilters) {
  const now = new Date();
  if (filters?.from) {
    const start = new Date(`${filters.from}T00:00:00+05:30`);
    const end = filters.to ? new Date(`${filters.to}T23:59:59.999+05:30`) : now;
    const duration = Math.max(86_400_000, end.getTime() - start.getTime() + 1);
    return { start, end, previousStart: new Date(start.getTime() - duration), previousEnd: new Date(start.getTime() - 1) };
  }
  const days = Math.min(365, Math.max(1, Math.trunc(filters?.days ?? 30)));
  const today = indiaDayKey(now);
  const start = new Date(`${today}T00:00:00+05:30`);
  start.setTime(start.getTime() - (days - 1) * 86_400_000);
  return { start, end: now, previousStart: new Date(start.getTime() - days * 86_400_000), previousEnd: new Date(start.getTime() - 1) };
}

function buildOrderSummary(allOrders: Order[], filters?: DashboardFilters): SellerDashboardData {
  const typedOrders = filters?.orderType ? allOrders.filter((order) => order.orderType === filters.orderType) : allOrders;
  const range = dateRange(filters);
  const current = typedOrders.filter((order) => {
    const date = orderDate(order);
    return date && date >= range.start && date <= range.end;
  });
  const previous = typedOrders.filter((order) => {
    const date = orderDate(order);
    return date && date >= range.previousStart && date <= range.previousEnd;
  });
  const rtoStatuses = new Set(["rto_initiated", "rto_in_transit", "rto_delivered"]);
  const totalCost = (orders: Order[]) => round(orders.reduce((sum, order) => sum + Number(order.rate?.totalCharge || 0), 0), 2);
  const pipeline: ShipmentPipeline = {
    created: current.filter((order) => order.status === "created").length,
    processing: current.filter((order) => ["processing", "booked"].includes(order.status)).length,
    inTransit: current.filter((order) => ["pickup_initiated", "shipped", "in_transit"].includes(order.status)).length,
    outForDelivery: current.filter((order) => order.status === "out_for_delivery").length,
    ndr: current.filter((order) => order.status === "ndr").length,
    rto: current.filter((order) => rtoStatuses.has(order.status)).length,
  };
  const trends: TrendPoint[] = [];
  for (let cursor = new Date(range.start); cursor <= range.end; cursor = new Date(cursor.getTime() + 86_400_000)) {
    const key = indiaDayKey(cursor);
    const orders = current.filter((order) => indiaDayKey(order.createdAt) === key);
    trends.push({
      date: key,
      orders: orders.length,
      delivered: orders.filter((order) => order.status === "delivered").length,
      rto: orders.filter((order) => rtoStatuses.has(order.status)).length,
    });
  }
  const courierScorecard = [...groupOrders(current, (order) => order.courierName || order.serviceProvider || "Courier").entries()]
    .map(([courier, orders]) => ({
      courier,
      totalOrders: orders.length,
      delivered: orders.filter((order) => order.status === "delivered").length,
      successRate: deliveryRate(orders),
      rtoRate: rtoRate(orders),
      avgDeliveryDays: averageDeliveryDays(orders),
      avgCost: orders.length ? round(totalCost(orders) / orders.length, 2) : 0,
    }))
    .sort((left, right) => right.totalOrders - left.totalOrders);
  const zonePerformance = [...groupOrders(current, (order) => order.rate?.zone || "Unknown").entries()]
    .map(([zone, orders]) => ({
      zone,
      zoneName: zone,
      totalOrders: orders.length,
      successRate: deliveryRate(orders),
      rtoRate: rtoRate(orders),
      avgCost: orders.length ? round(totalCost(orders) / orders.length, 2) : 0,
      avgDeliveryDays: averageDeliveryDays(orders),
    }))
    .sort((left, right) => right.totalOrders - left.totalOrders);
  const paymentBucket = (type: "prepaid" | "cod"): PaymentBucket => {
    const orders = current.filter((order) => order.paymentType === type);
    return {
      orders: orders.length,
      delivered: orders.filter((order) => order.status === "delivered").length,
      totalAmount: round(orders.reduce((sum, order) => sum + Number(order.orderAmount || 0), 0), 2),
      codAmount: round(orders.reduce((sum, order) => sum + Number(order.codAmount || 0), 0), 2),
    };
  };
  const codPendingOrders = current.filter((order) => order.paymentType === "cod" && !["cancelled", "rto_delivered"].includes(order.status));
  const topCities = [...groupOrders(current, (order) => order.deliveryAddress.city || "Unknown").entries()]
    .map(([city, orders]) => ({ city, orders: orders.length, deliveryRate: deliveryRate(orders) }))
    .sort((left, right) => right.orders - left.orders)
    .slice(0, 10);

  return {
    kpis: {
      deliveryRate: { current: deliveryRate(current), previous: deliveryRate(previous) },
      avgDeliveryDays: { current: averageDeliveryDays(current), previous: averageDeliveryDays(previous) },
      rtoRate: { current: rtoRate(current), previous: rtoRate(previous) },
      totalOrders: { current: current.length, previous: previous.length },
      totalCost: totalCost(current),
    },
    pipeline,
    trends,
    courierScorecard,
    zonePerformance,
    paymentSplit: { prepaid: paymentBucket("prepaid"), cod: paymentBucket("cod") },
    codPending: {
      amount: round(codPendingOrders.reduce((sum, order) => sum + Number(order.codAmount || 0), 0), 2),
      count: codPendingOrders.length,
    },
    topCities,
  };
}

// ── API ──
export const dashboardApi = {
  getSummary: async (filters?: DashboardFilters): Promise<SellerDashboardData> => {
    try {
      const { orders } = await ordersApi.getAll({ page: 1, limit: 10_000 });
      return buildOrderSummary(orders, filters);
    } catch {
      return getStaticSummary();
    }
  },
};
