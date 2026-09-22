type SellerRecord = Record<string, unknown> & { id: string };

const sellerStore = new Map<string, SellerRecord>();

function corsHeaders(request: Request): HeadersInit {
  const origin = request.headers.get("origin") ?? "*";
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Cache-Control": "no-store",
    Vary: "Origin",
  };
}

export async function OPTIONS(request: Request): Promise<Response> {
  return new Response(null, { status: 204, headers: corsHeaders(request) });
}

export async function GET(request: Request): Promise<Response> {
  return Response.json(
    { users: Array.from(sellerStore.values()) },
    { headers: corsHeaders(request) },
  );
}

export async function POST(request: Request): Promise<Response> {
  try {
    const body = (await request.json()) as { seller?: unknown };
    const seller = body.seller;
    if (!seller || typeof seller !== "object") {
      return Response.json({ error: "seller is required" }, { status: 400, headers: corsHeaders(request) });
    }

    const record = seller as Record<string, unknown>;
    const id = typeof record.id === "string" ? record.id.trim() : "";
    if (!id) {
      return Response.json({ error: "seller.id is required" }, { status: 400, headers: corsHeaders(request) });
    }

    const current = sellerStore.get(id) ?? { id };
    const next = { ...current, ...record, id, updatedAt: new Date().toISOString() };
    sellerStore.set(id, next);

    return Response.json({ user: next }, { status: 201, headers: corsHeaders(request) });
  } catch {
    return Response.json({ error: "Invalid JSON payload" }, { status: 400, headers: corsHeaders(request) });
  }
}
