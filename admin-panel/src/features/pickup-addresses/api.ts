import { api } from "@/lib/api";
import type { PickupAddressesResponse } from "./types";

const useStaticData = import.meta.env.VITE_STATIC_DATA_ENABLED !== "false";

export const pickupAddressApi = {
  listByUser: async (userId: string): Promise<PickupAddressesResponse> => {
    if (useStaticData) return { addresses: [] };
    const { data } = await api.get(`/users/${userId}/pickup-addresses`);
    return data;
  },
};
