import { env } from "cloudflare:workers";
import { callDtdc, listDtdcOperations, type DtdcProxyRequest } from "@/lib/dtdc";

export async function GET(): Promise<Response> {
  return Response.json({
    ok: true,
    service: "dtdc",
    environment: readEnv("DTDC_ENV") || "production",
    operations: listDtdcOperations(),
    usage: {
      method: "POST",
      body: { operation: "pincodeServiceability", payload: { orgPincode: "110046", desPincode: "636010" } },
    },
  }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request): Promise<Response> {
  try {
    const proxyToken = readEnv("DTDC_PROXY_TOKEN");
    if (!proxyToken) {
      return Response.json({ error: "DTDC_PROXY_TOKEN must be configured on the server" }, { status: 500 });
    }
    const authorization = request.headers.get("authorization")?.trim() ?? "";
    const suppliedToken = authorization.toLowerCase().startsWith("bearer ") ? authorization.slice(7).trim() : "";
    if (!suppliedToken || suppliedToken !== proxyToken) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json() as DtdcProxyRequest;
    if (!body || typeof body !== "object" || !body.operation) {
      return Response.json({ error: "operation is required" }, { status: 400 });
    }
    const apiKey = readEnv("DTDC_API_KEY");
    const customerCode = readEnv("DTDC_CUSTOMER_CODE");
    if (body.operation !== "pincodeServiceability" && (!apiKey || !customerCode)) {
      return Response.json({
        error: "DTDC_API_KEY and DTDC_CUSTOMER_CODE must be configured on the server",
      }, { status: 500 });
    }

    const result = await callDtdc(body, {
      apiKey,
      customerCode,
      serviceTypeId: readEnv("DTDC_SERVICE_TYPE_ID") || "PRIORITY",
      environment: readEnv("DTDC_ENV").toLowerCase() === "staging" ? "staging" : "production",
      trackingAccessToken: readEnv("DTDC_TRACKING_ACCESS_TOKEN"),
      trackingUsername: readEnv("DTDC_TRACKING_USERNAME"),
      trackingPassword: readEnv("DTDC_TRACKING_PASSWORD"),
      pincodeToken: readEnv("DTDC_PINCODE_TOKEN"),
    });
    return Response.json(result, { status: result.ok ? 200 : result.status || 502, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "DTDC request failed";
    return Response.json({ error: message }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }
}

function readEnv(key: string): string {
  const value =
    (env as unknown as Record<string, string | undefined>)[key] ??
    (globalThis as unknown as { process?: { env?: Record<string, string | undefined> } }).process?.env?.[key];
  return typeof value === "string" ? value.trim() : "";
}
