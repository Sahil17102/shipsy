import { api } from "@/lib/api";
import { readStaticUsers } from "@/lib/staticSeeds";
import type {
  ListWalletsResponse,
  ListWalletsParams,
  ListTransactionsResponse,
  ListTransactionsParams,
  AdjustWalletPayload,
  WalletListItem,
  WalletTransaction,
} from "./types";

const useStaticData = import.meta.env.PROD || import.meta.env.VITE_STATIC_DATA_ENABLED !== "false";
const SHARED_API_BASE_URL = (import.meta.env.VITE_SHARED_API_URL || "https://shipsy-kyio.onrender.com/api").replace(/\/$/, "");
const SHARED_WALLETS_URL = `${SHARED_API_BASE_URL}/wallets`;
const STATIC_WALLET_TRANSACTIONS_KEY = "shipsy-static-wallet-transactions";
const STATIC_WALLET_ID = "wallet-shipsy-demo-seller";

function nowIso(): string {
  return new Date().toISOString();
}

function staticWalletSeedTransactions(): WalletTransaction[] {
  const createdAt = nowIso();
  return [
    {
      id: "wallet-seed-shipsy-1000",
      walletId: STATIC_WALLET_ID,
      amount: 1000,
      currency: "INR",
      type: "credit",
      reason: "admin_credit",
      ref: "SHP-SEED-1000",
      meta: { source: "shipsy_seed", notes: "Initial test balance for Shipsy Demo Store" },
      createdAt,
    },
    {
      id: "wallet-seed-shipsy-topup-1000",
      walletId: STATIC_WALLET_ID,
      amount: 1000,
      currency: "INR",
      type: "credit",
      reason: "admin_credit",
      ref: "SHP-SEED-TOPUP-1000",
      meta: { source: "shipsy_seed", notes: "Additional wallet balance for Shipsy Demo Store" },
      createdAt,
    },
  ];
}

function ensureStaticWalletSeeds(transactions: WalletTransaction[]): WalletTransaction[] {
  const cleaned = transactions.filter(
    (transaction) =>
      !transaction.id.includes("sahil") &&
      !String(transaction.ref ?? "").startsWith("LGC-") &&
      !String(transaction.meta?.notes ?? "").includes("Sahil Mittal"),
  );
  const missingSeeds = staticWalletSeedTransactions().filter((seed) => (
    !cleaned.some((transaction) => transaction.id === seed.id || transaction.ref === seed.ref)
  ));
  if (!missingSeeds.length && cleaned.length === transactions.length) return transactions;
  const next = [...missingSeeds, ...cleaned];
  writeStaticTransactions(next);
  return next;
}

function readStaticTransactions(): WalletTransaction[] {
  if (typeof window === "undefined") return [];
  const raw = localStorage.getItem(STATIC_WALLET_TRANSACTIONS_KEY);
  if (!raw) return ensureStaticWalletSeeds([]);
  try {
    const parsed = JSON.parse(raw);
    return ensureStaticWalletSeeds(Array.isArray(parsed) ? (parsed as WalletTransaction[]) : []);
  } catch {
    return ensureStaticWalletSeeds([]);
  }
}

function writeStaticTransactions(transactions: WalletTransaction[]): void {
  if (typeof window !== "undefined") {
    localStorage.setItem(STATIC_WALLET_TRANSACTIONS_KEY, JSON.stringify(transactions));
  }
}

function balanceFor(userId: string, transactions = readStaticTransactions()): number {
  return transactions
    .filter((transaction) => transaction.walletId === `wallet-${userId}`)
    .reduce((sum, transaction) => (
      transaction.type === "credit" ? sum + transaction.amount : sum - transaction.amount
    ), 0);
}

function walletForUser(userId: string, sharedUser?: ReturnType<typeof readStaticUsers>[number]): WalletListItem {
  const user = sharedUser ?? readStaticUsers().find((item) => item.id === userId);
  const createdAt = user?.createdAt ?? nowIso();
  return {
    id: `wallet-${userId}`,
    userId,
    userName: user?.name ?? ([user?.firstName, user?.lastName].filter(Boolean).join(" ") || null),
    userEmail: user?.email ?? null,
    userPhone: user?.phone ?? null,
    businessName: user?.businessName ?? null,
    balance: balanceFor(userId),
    currency: "INR",
    plan: user?.plan ?? "basic",
    isActive: user?.isActive ?? true,
    createdAt,
    updatedAt: nowIso(),
  };
}

async function sharedUserById(userId: string) {
  try {
    const response = await fetch(`${SHARED_API_BASE_URL}/sellers`, { cache: "no-store" });
    const payload = await response.json() as { users?: ReturnType<typeof readStaticUsers> };
    const shared = payload.users?.find((user) => user.id === userId);
    if (shared) return shared;
  } catch {
    // Fall back to the local seller cache while the shared service wakes up.
  }
  return readStaticUsers().find((item) => item.id === userId);
}

async function readSharedWallet(userId: string, params?: Record<string, unknown>) {
  const query = new URLSearchParams({ userId });
  Object.entries(params ?? {}).forEach(([key, value]) => value != null && query.set(key, String(value)));
  const response = await fetch(`${SHARED_WALLETS_URL}?${query}`, { cache: "no-store" });
  if (!response.ok) throw new Error("Wallet service unavailable");
  return response.json();
}

function paginate<T>(items: T[], page = 1, limit = 20) {
  const total = items.length;
  const start = (page - 1) * limit;
  return {
    items: items.slice(start, start + limit),
    pagination: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) },
  };
}

export const walletsApi = {
  list: async (params?: ListWalletsParams) => {
    if (useStaticData) {
      let wallets = readStaticUsers().map((user) => walletForUser(user.id));
      try {
        const response = await fetch(SHARED_WALLETS_URL, { cache: "no-store" });
        const shared = await response.json() as { wallets?: Array<{ userId: string; balance: number }> };
        const balances = new Map((shared.wallets ?? []).map((wallet) => [wallet.userId, wallet.balance]));
        wallets = wallets.map((wallet) => ({ ...wallet, balance: balances.get(wallet.userId) ?? wallet.balance }));
      } catch { /* Keep local balances while the shared service wakes up. */ }
      if (params?.search) {
        const query = params.search.toLowerCase();
        wallets = wallets.filter((wallet) =>
          [wallet.userName, wallet.userEmail, wallet.userPhone, wallet.businessName]
            .filter(Boolean)
            .some((value) => String(value).toLowerCase().includes(query)),
        );
      }
      wallets.sort((a, b) => {
        const dir = params?.sortOrder === "asc" ? 1 : -1;
        const field = params?.sortField ?? params?.sortBy ?? "createdAt";
        if (field === "balance") return (a.balance - b.balance) * dir;
        if (field === "userName") return String(a.userName ?? "").localeCompare(String(b.userName ?? "")) * dir;
        return (new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()) * dir;
      });
      const { items, pagination } = paginate(wallets, params?.page ?? 1, params?.limit ?? 20);
      return {
        wallets: items,
        pagination,
        stats: {
          totalWallets: wallets.length,
          totalBalance: wallets.reduce((sum, wallet) => sum + wallet.balance, 0),
          walletsWithBalance: wallets.filter((wallet) => wallet.balance !== 0).length,
          walletsEmpty: wallets.filter((wallet) => wallet.balance === 0).length,
        },
      } as ListWalletsResponse;
    }

    const { data } = await api.get<ListWalletsResponse>("/wallets", { params });
    return data;
  },

  getByUserId: async (userId: string) => {
    if (useStaticData) {
      const wallet = walletForUser(userId, await sharedUserById(userId));
      try {
        const shared = await readSharedWallet(userId) as { wallet: { balance: number; currency: string } };
        return { wallet: { ...wallet, ...shared.wallet } };
      } catch { return { wallet }; }
    }

    const { data } = await api.get<{ wallet: WalletListItem }>(`/wallets/${userId}`);
    return data;
  },

  transactions: async ({ userId, ...params }: ListTransactionsParams) => {
    if (useStaticData) {
      try {
        const shared = await readSharedWallet(userId, params) as ListTransactionsResponse;
        return { transactions: shared.transactions, pagination: shared.pagination };
      } catch { /* Keep local history while the shared service wakes up. */ }
      let transactions = readStaticTransactions().filter(
        (transaction) => transaction.walletId === `wallet-${userId}`,
      );
      if (params.type) {
        transactions = transactions.filter((transaction) => transaction.type === params.type);
      }
      if (params.dateFrom) {
        const from = new Date(params.dateFrom).getTime();
        transactions = transactions.filter((transaction) => new Date(transaction.createdAt).getTime() >= from);
      }
      if (params.dateTo) {
        const to = new Date(params.dateTo).getTime();
        transactions = transactions.filter((transaction) => new Date(transaction.createdAt).getTime() <= to);
      }
      transactions.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      const { items, pagination } = paginate(transactions, params.page ?? 1, params.limit ?? 15);
      return { transactions: items, pagination } as ListTransactionsResponse;
    }

    const { data } = await api.get<ListTransactionsResponse>(
      `/wallets/${userId}/transactions`,
      { params },
    );
    return data;
  },

  adjust: async (userId: string, payload: AdjustWalletPayload) => {
    if (useStaticData) {
      try {
        const response = await fetch(SHARED_WALLETS_URL, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userId, ...payload }) });
        const shared = await response.json();
        if (!response.ok) throw new Error(shared.error || "Wallet adjustment failed");
        return shared;
      } catch (error) {
        if (error instanceof Error && error.message === "Insufficient wallet balance") throw error;
      }
      const transaction: WalletTransaction = {
        id: `admin-wallet-txn-${Date.now()}`,
        walletId: `wallet-${userId}`,
        amount: payload.amount,
        currency: "INR",
        type: payload.type,
        reason: payload.reason,
        ref: `ADM-${Date.now().toString().slice(-8)}`,
        meta: { notes: payload.notes ?? "", source: "admin_adjustment" },
        createdAt: nowIso(),
      };
      const next = [transaction, ...readStaticTransactions()];
      writeStaticTransactions(next);
      return {
        message: "Wallet adjusted",
        wallet: walletForUser(userId, await sharedUserById(userId)),
        transaction,
      };
    }

    const { data } = await api.post<{
      message: string;
      wallet: WalletListItem;
      transaction: WalletTransaction;
    }>(`/wallets/${userId}/adjust`, payload);
    return data;
  },
};
