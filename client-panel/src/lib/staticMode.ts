export function shouldUseStaticClientData(): boolean {
  const flag = import.meta.env.VITE_STATIC_DATA_ENABLED;
  // Static data is only for an intentionally configured demo build. Real
  // deployments must use the API for wallet balances and payment verification.
  return flag === "true";
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
