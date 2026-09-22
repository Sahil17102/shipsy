import { env } from "cloudflare:workers";
import {
  callDelhiveryB2c,
  listDelhiveryOperations,
  type DelhiveryEnvironment,
  type DelhiveryProxyRequest,
} from "@/lib/delhivery-b2c";

export async function GET(): Promise<Response> {
  return Response.json({
    ok: true,
    service: "delhivery-b2c",
    operations: listDelhiveryOperations(),
    usage: {
      method: "POST",
      body: {
        operation: "pincodeServiceability",
        params: { filter_codes: "194103" },
      },
    },
  });
}

export async function POST(request: Request): Promise<Response> {
  try {
    const body = (await request.json()) as DelhiveryProxyRequest;
    if (!body.operation) {
      return Response.json({ error: "operation is required" }, { status: 400 });
    }

    const token = readRequestToken(request) || readEnv("DELHIVERY_TOKEN");
    if (!token) {
      return Response.json(
        {
          error: "DELHIVERY_TOKEN is not configured",
          hint: "Set DELHIVERY_TOKEN in the environment or send X-Delhivery-Token for Postman testing.",
        },
        { status: 500 },
      );
    }

    const environment = readEnvironment(request);
    const result = await callDelhiveryB2c(body, {
      token,
      environment,
      baseUrl: readRequestHeader(request, "x-delhivery-base-url") || readEnv("DELHIVERY_BASE_URL") || undefined,
    });

    return Response.json(result, { status: result.ok ? 200 : result.status || 502 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Delhivery request failed";
    return Response.json({ error: message }, { status: 400 });
  }
}

function readEnv(key: string): string {
  const value =
    (env as unknown as Record<string, string | undefined>)[key] ??
    (globalThis as unknown as { process?: { env?: Record<string, string | undefined> } }).process?.env?.[key];
  return typeof value === "string" ? value.trim() : "";
}

function readEnvironment(request: Request): DelhiveryEnvironment {
  const value = (readRequestHeader(request, "x-delhivery-env") || readEnv("DELHIVERY_ENV")).toLowerCase();
  return value === "production" ? "production" : "staging";
}

function readRequestToken(request: Request): string {
  const directToken = readRequestHeader(request, "x-delhivery-token");
  if (directToken) {
    return directToken;
  }

  const authorization = request.headers.get("authorization")?.trim() || "";
  return authorization.toLowerCase().startsWith("token ") ? authorization.slice(6).trim() : "";
}

function readRequestHeader(request: Request, key: string): string {
  return request.headers.get(key)?.trim() || "";
}
