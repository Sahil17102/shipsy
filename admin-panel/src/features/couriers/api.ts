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

export const couriersApi = {
  list: async (params?: ListCouriersParams): Promise<ListCouriersResponse> => {
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
    const { data } = await api.post("/couriers", payload);
    return data.courier as { id: string; name: string; serviceProvider: string };
  },

  update: async (id: string, payload: UpdateCourierPayload): Promise<{ id: string; name: string; serviceProvider: string }> => {
    const { data } = await api.patch(`/couriers/${id}`, payload);
    return data.courier as { id: string; name: string; serviceProvider: string };
  },

  delete: async (id: string): Promise<void> => {
    await api.delete(`/couriers/${id}`);
  },

  toggle: async (id: string): Promise<{ message: string }> => {
    const { data } = await api.patch(`/couriers/${id}/toggle`);
    return data as { message: string };
  },
};
