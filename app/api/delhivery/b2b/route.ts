import { env } from "cloudflare:workers";
import {
  callDelhiveryB2b,
  delhiveryB2bOperationRequiresToken,
  listDelhiveryB2bOperations,
  type DelhiveryB2bEnvironment,
  type DelhiveryB2bProxyRequest,
} from "@/lib/delhivery-b2b";

export async function GET(): Promise<Response> {
  return Response.json({
    ok: true,
    service: "delhivery-b2b",
    operations: listDelhiveryB2bOperations(),
    usage: {
      method: "POST",
      body: {
        operation: "serviceability",
        params: { pincode: "122001", weight: 1 },
      },
    },
  });
}

export async function POST(request: Request): Promise<Response> {
  try {
    const body = (await request.json()) as DelhiveryB2bProxyRequest;
    if (!body.operation) {
      return Response.json({ error: "operation is required" }, { status: 400 });
    }

    const token = readRequestToken(request) || readEnv("DELHIVERY_B2B_TOKEN");
    if (delhiveryB2bOperationRequiresToken(body.operation) && !token) {
      return Response.json(
        {
          error: "DELHIVERY_B2B_TOKEN is not configured",
          hint: "Set DELHIVERY_B2B_TOKEN in the environment or send X-Delhivery-B2B-Token for Postman testing.",
        },
        { status: 500 },
      );
    }

    const result = await callDelhiveryB2b(body, {
      token,
      environment: readEnvironment(request),
      baseUrl: readRequestHeader(request, "x-delhivery-b2b-base-url") || readEnv("DELHIVERY_B2B_BASE_URL") || undefined,
    });

    return Response.json(result, { status: result.ok ? 200 : result.status || 502 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Delhivery B2B request failed";
    return Response.json({ error: message }, { status: 400 });
  }
}

function readEnv(key: string): string {
  const value =
    (env as unknown as Record<string, string | undefined>)[key] ??
    (globalThis as unknown as { process?: { env?: Record<string, string | undefined> } }).process?.env?.[key];
  return typeof value === "string" ? value.trim() : "";
}

function readEnvironment(request: Request): DelhiveryB2bEnvironment {
  const value = (readRequestHeader(request, "x-delhivery-b2b-env") || readEnv("DELHIVERY_B2B_ENV")).toLowerCase();
  return value === "production" ? "production" : "staging";
}

function readRequestToken(request: Request): string {
  const directToken = readRequestHeader(request, "x-delhivery-b2b-token");
  if (directToken) {
    return directToken;
  }

  const authorization = request.headers.get("authorization")?.trim() || "";
  return authorization.toLowerCase().startsWith("bearer ") ? authorization.slice(7).trim() : "";
}

function readRequestHeader(request: Request, key: string): string {
  return request.headers.get(key)?.trim() || "";
}
