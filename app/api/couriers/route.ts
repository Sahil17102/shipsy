type CourierRecord = {
  id: string; name: string; serviceProvider: string; serviceProviderDisplayName: string;
  courierType: "delivery"; businessType: string[]; isEnabled: boolean; logo: string | null;
  createdAt: string; updatedAt: string;
};

const createdAt = "2026-09-03T00:00:00.000Z";
function courier(id: string, name: string, serviceProvider: string, displayName: string, businessType: string): CourierRecord {
  return { id, name, serviceProvider, serviceProviderDisplayName: displayName, courierType: "delivery", businessType: [businessType], isEnabled: true, logo: null, createdAt, updatedAt: createdAt };
}
const seeds = [
  courier("delhivery:b2c-surface", "Delhivery B2C Surface", "delhivery", "Delhivery", "b2c"),
  courier("delhivery:b2b-ltl", "Delhivery B2B LTL", "delhivery", "Delhivery", "b2b"),
  courier("logixmitra:surface", "LogixMitra Surface", "logixmitra", "LogixMitra", "b2c"),
  courier("logixmitra:b2b-surface", "LogixMitra B2B Surface", "logixmitra", "LogixMitra", "b2b"),
];
const courierStore = new Map(seeds.map((item) => [item.id, item]));

function cors(request: Request): HeadersInit {
  return { "Access-Control-Allow-Origin": request.headers.get("origin") ?? "*", "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type", "Cache-Control": "no-store", Vary: "Origin" };
}
export async function OPTIONS(request: Request) { return new Response(null, { status: 204, headers: cors(request) }); }

export async function GET(request: Request) {
  const url = new URL(request.url);
  const type = url.searchParams.get("businessType")?.toLowerCase();
  const enabled = url.searchParams.get("isEnabled");
  const couriers = Array.from(courierStore.values()).filter((item) => (!type || item.businessType.includes(type)) && (enabled !== "true" || item.isEnabled) && (enabled !== "false" || !item.isEnabled));
  return Response.json({ couriers }, { headers: cors(request) });
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as Record<string, unknown>;
    const action = String(body.action ?? "create");
    const id = String(body.id ?? `courier:${Date.now()}`);
    const current = courierStore.get(id);
    if (action === "delete") { courierStore.delete(id); return Response.json({ success: true }, { headers: cors(request) }); }
    if (action === "toggle" && current) {
      const next = { ...current, isEnabled: !current.isEnabled, updatedAt: new Date().toISOString() };
      courierStore.set(id, next); return Response.json({ courier: next }, { headers: cors(request) });
    }
    const provider = String(body.serviceProviderId ?? current?.serviceProvider ?? "manual").replace(/^sp-/, "");
    const next: CourierRecord = {
      id, name: String(body.name ?? current?.name ?? "Courier"), serviceProvider: String(body.serviceProvider ?? current?.serviceProvider ?? provider),
      serviceProviderDisplayName: String(body.serviceProviderDisplayName ?? current?.serviceProviderDisplayName ?? provider), courierType: "delivery",
      businessType: Array.isArray(body.businessType) ? body.businessType.map(String) : current?.businessType ?? ["b2c"],
      isEnabled: typeof body.isEnabled === "boolean" ? body.isEnabled : current?.isEnabled ?? true, logo: current?.logo ?? null,
      createdAt: current?.createdAt ?? new Date().toISOString(), updatedAt: new Date().toISOString(),
    };
    courierStore.set(id, next);
    return Response.json({ courier: next }, { status: current ? 200 : 201, headers: cors(request) });
  } catch { return Response.json({ error: "Invalid courier payload" }, { status: 400, headers: cors(request) }); }
}
