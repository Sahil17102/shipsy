import { api } from "./api";
import { shouldUseStaticClientData } from "./staticMode";

const STATIC_WALLET_TRANSACTIONS_KEY = "shipsy-static-wallet-transactions";
const STATIC_WALLET_ID = "wallet-demo-client-user";
const SHARED_WALLET_URL = "https://shipsy-kyio.onrender.com/api/wallets";

function currentUserId(): string {
  try {
    const user = JSON.parse(localStorage.getItem("shipsy-client-user") || "{}") as { id?: string };
    return user.id || "demo-client-user";
  } catch { return "demo-client-user"; }
}

async function sharedWallet(params?: Record<string, string | number>): Promise<any> {
  const query = new URLSearchParams({ userId: currentUserId() });
  Object.entries(params ?? {}).forEach(([key, value]) => query.set(key, String(value)));
  const response = await fetch(`${SHARED_WALLET_URL}?${query}`, { cache: "no-store" });
  if (!response.ok) throw new Error("Wallet service unavailable");
  return response.json();
}

export interface WalletBalance {
  balance: number;
  currency: string;
}

export interface WalletTransaction {
  id: string;
  walletId: string;
  amount: number;
  currency: string;
  type: "credit" | "debit";
  reason: string;
  ref?: string;
  meta?: Record<string, unknown>;
  createdAt: string;
}

export interface WalletTransactionStats {
  totalCredits: number;
  totalDebits: number;
}

export interface WalletTransactionsResponse {
  transactions: WalletTransaction[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
  stats: WalletTransactionStats;
  courierOptions: string[];
}

export interface CreateRechargeOrderResponse {
  orderId: string;
  amount: number;
  currency: string;
  keyId: string;
}

export interface VerifyRechargeResponse {
  message: string;
  balance: number;
  creditedAmount: number;
}

function readStaticTransactions(): WalletTransaction[] {
  if (typeof window === "undefined") return [];
  const raw = localStorage.getItem(STATIC_WALLET_TRANSACTIONS_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as WalletTransaction[]) : [];
  } catch {
    return [];
  }
}

function writeStaticTransactions(transactions: WalletTransaction[]): void {
  if (typeof window !== "undefined") {
    localStorage.setItem(STATIC_WALLET_TRANSACTIONS_KEY, JSON.stringify(transactions));
  }
}

function getStaticBalance(transactions = readStaticTransactions()): number {
  return transactions.filter((transaction) => transaction.walletId === STATIC_WALLET_ID).reduce((sum, transaction) => {
    return transaction.type === "credit"
      ? sum + transaction.amount
      : sum - transaction.amount;
  }, 0);
}

function filterStaticTransactions(
  transactions: WalletTransaction[],
  params?: {
    type?: "credit" | "debit";
    serviceProvider?: string;
    dateFrom?: string;
    dateTo?: string;
    page?: number;
    limit?: number;
    sortField?: string;
    sortOrder?: string;
  },
): WalletTransactionsResponse {
  let filtered = [...transactions];

  if (params?.type) {
    filtered = filtered.filter((transaction) => transaction.type === params.type);
  }
  if (params?.serviceProvider) {
    filtered = filtered.filter((transaction) => transaction.meta?.serviceProvider === params.serviceProvider);
  }
  if (params?.dateFrom) {
    const from = new Date(`${params.dateFrom}T00:00:00`).getTime();
    filtered = filtered.filter((transaction) => new Date(transaction.createdAt).getTime() >= from);
  }
  if (params?.dateTo) {
    const to = new Date(`${params.dateTo}T23:59:59`).getTime();
    filtered = filtered.filter((transaction) => new Date(transaction.createdAt).getTime() <= to);
  }

  filtered.sort((a, b) => {
    const direction = params?.sortOrder === "asc" ? 1 : -1;
    if (params?.sortField === "amount") return (a.amount - b.amount) * direction;
    return (new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()) * direction;
  });

  const page = params?.page ?? 1;
  const limit = params?.limit ?? 10;
  const total = filtered.length;
  const start = (page - 1) * limit;
  const paginated = filtered.slice(start, start + limit);
  const totalCredits = transactions
    .filter((transaction) => transaction.type === "credit")
    .reduce((sum, transaction) => sum + transaction.amount, 0);
  const totalDebits = transactions
    .filter((transaction) => transaction.type === "debit")
    .reduce((sum, transaction) => sum + transaction.amount, 0);

  return {
    transactions: paginated,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    },
    stats: { totalCredits, totalDebits },
    courierOptions: [
      ...new Set(
        transactions
          .map((transaction) => transaction.meta?.serviceProvider)
          .filter((value): value is string => typeof value === "string" && value.length > 0),
      ),
    ],
  };
}

export const walletApi = {
  getBalance: async (): Promise<WalletBalance> => {
    if (shouldUseStaticClientData()) {
      try { const data = await sharedWallet(); return data.wallet; } catch { /* Fall back to local demo data. */ }
      return { balance: getStaticBalance(), currency: "INR" };
    }

    const { data } = await api.get<WalletBalance>("/wallet/balance");
    return data;
  },

  getTransactions: async (params?: {
    type?: "credit" | "debit";
    serviceProvider?: string;
    dateFrom?: string;
    dateTo?: string;
    page?: number;
    limit?: number;
    sortField?: string;
    sortOrder?: string;
  }): Promise<WalletTransactionsResponse> => {
    if (shouldUseStaticClientData()) {
      try { return await sharedWallet(params as Record<string, string | number>); } catch { /* Fall back to local demo data. */ }
      return filterStaticTransactions(readStaticTransactions(), params);
    }

    const { data } = await api.get<WalletTransactionsResponse>(
      "/wallet/transactions",
      { params },
    );
    return data;
  },

  createRechargeOrder: async (amount: number): Promise<CreateRechargeOrderResponse> => {
    if (shouldUseStaticClientData()) {
      return {
        orderId: `demo_order_${Date.now()}`,
        amount,
        currency: "INR",
        keyId: "",
      };
    }

    const { data } = await api.post<CreateRechargeOrderResponse>(
      "/wallet/recharge/create-order",
      { amount },
    );
    return data;
  },

  verifyRecharge: async (payload: {
    razorpayOrderId: string;
    razorpayPaymentId: string;
    razorpaySignature: string;
  }): Promise<VerifyRechargeResponse> => {
    if (shouldUseStaticClientData()) {
      const amount = Number(payload.razorpaySignature) || 0;
      return walletApi.rechargeStatic(amount);
    }

    const { data } = await api.post<VerifyRechargeResponse>(
      "/wallet/recharge/verify",
      payload,
    );
    return data;
  },

  rechargeStatic: async (amount: number): Promise<VerifyRechargeResponse> => {
    const roundedAmount = Math.round(amount * 100) / 100;
    try {
      const response = await fetch(SHARED_WALLET_URL, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userId: currentUserId(), type: "credit", amount: roundedAmount, reason: "Wallet recharge", source: "client_recharge" }) });
      if (response.ok) {
        const data = await response.json() as { message: string; wallet: WalletBalance };
        return { message: data.message, balance: data.wallet.balance, creditedAmount: roundedAmount };
      }
    } catch { /* Fall back to local recharge while the shared service wakes up. */ }
    const transactions = readStaticTransactions();
    const transaction: WalletTransaction = {
      id: `txn-${Date.now()}`,
      walletId: STATIC_WALLET_ID,
      amount: roundedAmount,
      currency: "INR",
      type: "credit",
      reason: "wallet_recharge",
      ref: `LGC-RCH-${Date.now().toString().slice(-8)}`,
      meta: { source: "static_recharge" },
      createdAt: new Date().toISOString(),
    };
    const next = [transaction, ...transactions];
    writeStaticTransactions(next);
    return {
      message: "Wallet recharged",
      balance: getStaticBalance(next),
      creditedAmount: roundedAmount,
    };
  },

  debitOrder: async (amount: number, orderId: string, serviceProvider?: string): Promise<WalletBalance> => {
    const roundedAmount = Math.round(amount * 100) / 100;
    if (!Number.isFinite(roundedAmount) || roundedAmount <= 0) {
      throw new Error("A valid shipping charge is required before creating the order");
    }
    const response = await fetch(SHARED_WALLET_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: currentUserId(), type: "debit", amount: roundedAmount, reason: `Shipping charge - ${orderId}`, source: "order_shipping_charge", orderId, serviceProvider }),
    });
    const result = await response.json() as { error?: string; wallet?: WalletBalance };
    if (!response.ok || !result.wallet) throw new Error(result.error || "Unable to debit wallet");
    return result.wallet;
  },

  refundOrder: async (amount: number, orderId: string, serviceProvider?: string): Promise<void> => {
    const response = await fetch(SHARED_WALLET_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: currentUserId(), type: "credit", amount: Math.round(amount * 100) / 100, reason: `Shipping charge refund - ${orderId}`, source: "order_shipping_refund", orderId, serviceProvider }),
    });
    if (!response.ok) throw new Error("Shipment failed and wallet refund could not be recorded");
  },
};
