import { api } from "@/lib/api";
import { readStaticUsers } from "@/lib/staticSeeds";
import type { UserListItem } from "@/features/users/types";
import type { PickupAddressesResponse } from "./types";

const useStaticData = import.meta.env.VITE_STATIC_DATA_ENABLED !== "false";
const SHARED_API_BASE_URL = (import.meta.env.VITE_SHARED_API_URL || "https://shipsy-kyio.onrender.com/api").replace(/\/$/, "");

async function sharedUserById(userId: string): Promise<UserListItem | undefined> {
  try {
    const response = await fetch(`${SHARED_API_BASE_URL}/sellers`, { cache: "no-store" });
    const payload = await response.json() as { users?: UserListItem[] };
    const shared = payload.users?.find((user) => user.id === userId);
    if (shared) return shared;
  } catch {
    // Use the admin's local cache while the shared service wakes up.
  }
  return readStaticUsers().find((user) => user.id === userId);
}

export const pickupAddressApi = {
  listByUser: async (userId: string): Promise<PickupAddressesResponse> => {
    if (useStaticData) {
      const user = await sharedUserById(userId);
      if (!user?.address || !user.pincode) return { addresses: [] };
      const now = new Date().toISOString();
      return {
        addresses: [{
          id: `pickup-${userId}`,
          userId,
          nickname: "Primary Warehouse",
          contactName: user.name || user.email || "Seller",
          phone: user.contactNumber || user.phone || "",
          email: user.supportEmail || user.email || "",
          role: "warehouse_manager",
          addressLine1: user.address,
          city: user.city || "",
          state: user.state || "",
          country: "India",
          pincode: user.pincode,
          isPrimary: true,
          addressType: "pickup",
          isSameAsRto: true,
          isActive: true,
          createdAt: user.createdAt || now,
          updatedAt: user.updatedAt || now,
        }],
      };
    }
    const { data } = await api.get(`/users/${userId}/pickup-addresses`);
    return data;
  },
};
