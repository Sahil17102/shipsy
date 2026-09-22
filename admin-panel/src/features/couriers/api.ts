import { api } from "@/lib/api";
import { defaultCourierResponse } from "../pricingDefaults";
import type { CreateCourierPayload, UpdateCourierPayload, ListCouriersResponse } from "./types";

interface ListCouriersParams {
  serviceProvider?: string;
  businessType?: string;
  isEnabled?: string;
  page?: number;
  limit?: number;
}

const useStaticCourierData = import.meta.env.VITE_STATIC_DATA_ENABLED === "true";
const SHARED_COURIERS_URL = "https://shipsy-kyio.onrender.com/api/couriers";

async function sharedRequest(body?: Record<string, unknown>): Promise<any> {
  const response = await fetch(SHARED_COURIERS_URL, body ? {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  } : { cache: "no-store" });
  if (!response.ok) throw new Error("Courier registry unavailable");
  return response.json();
}

function toResponse(couriers: ListCouriersResponse["couriers"], params?: ListCouriersParams): ListCouriersResponse {
  const filtered = couriers.filter((courier) => {
    if (params?.serviceProvider && courier.serviceProvider !== params.serviceProvider) return false;
    if (params?.businessType && !courier.businessType.includes(params.businessType.toLowerCase())) return false;
    if (params?.isEnabled === "true" && !courier.isEnabled) return false;
    if (params?.isEnabled === "false" && courier.isEnabled) return false;
    return true;
  });
  const page = Math.max(1, Number(params?.page ?? 1));
  const limit = Math.max(1, Number(params?.limit ?? 50));
  return { couriers: filtered.slice((page - 1) * limit, page * limit), pagination: { page, limit, total: filtered.length, totalPages: Math.max(1, Math.ceil(filtered.length / limit)) }, stats: { total: filtered.length, enabled: filtered.filter((item) => item.isEnabled).length, disabled: filtered.filter((item) => !item.isEnabled).length, delivery: filtered.length } };
}

export const couriersApi = {
  list: async (params?: ListCouriersParams): Promise<ListCouriersResponse> => {
    try {
      const data = await sharedRequest();
      if (Array.isArray(data.couriers)) return toResponse(data.couriers, params);
    } catch { /* Fall through to the configured admin API or seeded data. */ }

    if (useStaticCourierData) {
      return defaultCourierResponse(params);
    }

    try {
      const { data } = await api.get("/couriers", { params });
      return Array.isArray(data?.couriers) && data.couriers.length > 0 ? data as ListCouriersResponse : defaultCourierResponse(params);
    } catch {
      return defaultCourierResponse(params);
    }
  },

  create: async (payload: CreateCourierPayload): Promise<{ id: string; name: string; serviceProvider: string }> => {
    try { return (await sharedRequest({ ...payload })).courier; } catch { /* Try the admin API below. */ }
    const { data } = await api.post("/couriers", payload);
    return data.courier as { id: string; name: string; serviceProvider: string };
  },

  update: async (id: string, payload: UpdateCourierPayload): Promise<{ id: string; name: string; serviceProvider: string }> => {
    try { return (await sharedRequest({ action: "update", id, ...payload })).courier; } catch { /* Try the admin API below. */ }
    const { data } = await api.patch(`/couriers/${id}`, payload);
    return data.courier as { id: string; name: string; serviceProvider: string };
  },

  delete: async (id: string): Promise<void> => {
    try { await sharedRequest({ action: "delete", id }); return; } catch { /* Try the admin API below. */ }
    await api.delete(`/couriers/${id}`);
  },

  toggle: async (id: string): Promise<{ message: string }> => {
    try { await sharedRequest({ action: "toggle", id }); return { message: "Courier status updated" }; } catch { /* Try the admin API below. */ }
    const { data } = await api.patch(`/couriers/${id}/toggle`);
    return data as { message: string };
  },
};
