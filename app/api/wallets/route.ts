type WalletTransaction = {
  id: string; walletId: string; amount: number; currency: string; type: "credit" | "debit";
  reason: string; ref: string; meta: Record<string, unknown>; createdAt: string;
};

const DEMO_USER_ID = "client-sahilmittal1920@gmail.com";
const transactions = new Map<string, WalletTransaction[]>([
  [DEMO_USER_ID, [{
    id: "admin-wallet-opening-credit-5000", walletId: `wallet-${DEMO_USER_ID}`, amount: 5000,
    currency: "INR", type: "credit", reason: "Admin credit", ref: "ADM-OPENING-5000",
    meta: { source: "admin_adjustment", notes: "Opening credit previously added from admin" },
    createdAt: "2026-09-22T17:47:00.000Z",
  }]],
]);

function cors(request: Request): HeadersInit {
  return { "Access-Control-Allow-Origin": request.headers.get("origin") ?? "*", "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type", "Cache-Control": "no-store", Vary: "Origin" };
}
function balanceFor(userId: string): number {
  return (transactions.get(userId) ?? []).reduce((sum, item) => sum + (item.type === "credit" ? item.amount : -item.amount), 0);
}
export async function OPTIONS(request: Request) { return new Response(null, { status: 204, headers: cors(request) }); }

export async function GET(request: Request) {
  const url = new URL(request.url);
  const userId = url.searchParams.get("userId");
  if (!userId) {
    return Response.json({ wallets: Array.from(transactions.keys()).map((id) => ({ userId: id, balance: balanceFor(id), currency: "INR" })) }, { headers: cors(request) });
  }
  let items = [...(transactions.get(userId) ?? [])];
  const type = url.searchParams.get("type");
  if (type === "credit" || type === "debit") items = items.filter((item) => item.type === type);
  items.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  const page = Math.max(1, Number(url.searchParams.get("page") ?? 1));
  const limit = Math.max(1, Number(url.searchParams.get("limit") ?? 20));
  const total = items.length;
  return Response.json({
    wallet: { id: `wallet-${userId}`, userId, balance: balanceFor(userId), currency: "INR" },
    transactions: items.slice((page - 1) * limit, page * limit),
    pagination: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) },
    stats: {
      totalCredits: (transactions.get(userId) ?? []).filter((item) => item.type === "credit").reduce((sum, item) => sum + item.amount, 0),
      totalDebits: (transactions.get(userId) ?? []).filter((item) => item.type === "debit").reduce((sum, item) => sum + item.amount, 0),
    },
    courierOptions: [],
  }, { headers: cors(request) });
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as Record<string, unknown>;
    const userId = String(body.userId ?? "").trim();
    const type = body.type === "debit" ? "debit" : "credit";
    const amount = Math.round(Number(body.amount) * 100) / 100;
    if (!userId || !Number.isFinite(amount) || amount <= 0) return Response.json({ error: "Valid userId and amount are required" }, { status: 400, headers: cors(request) });
    if (type === "debit" && amount > balanceFor(userId)) return Response.json({ error: "Insufficient wallet balance" }, { status: 400, headers: cors(request) });
    const now = new Date().toISOString();
    const transaction: WalletTransaction = {
      id: `wallet-txn-${Date.now()}`, walletId: `wallet-${userId}`, amount, currency: "INR", type,
      reason: String(body.reason ?? (type === "credit" ? "Admin credit" : "Admin debit")), ref: `ADM-${Date.now().toString().slice(-8)}`,
      meta: { source: String(body.source ?? "admin_adjustment"), notes: String(body.notes ?? "") }, createdAt: now,
    };
    transactions.set(userId, [transaction, ...(transactions.get(userId) ?? [])]);
    return Response.json({ message: "Wallet adjusted successfully", wallet: { id: `wallet-${userId}`, userId, balance: balanceFor(userId), currency: "INR", updatedAt: now }, transaction }, { status: 201, headers: cors(request) });
  } catch { return Response.json({ error: "Invalid wallet payload" }, { status: 400, headers: cors(request) }); }
}
