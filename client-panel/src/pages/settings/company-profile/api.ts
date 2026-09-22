import { api } from "@/lib/api";
import { mirrorClientSellerToAdmin } from "@/lib/adminSellerMirror";
import { shouldUseStaticClientData } from "@/lib/staticMode";
import type { User } from "@/contexts/AuthContext";
import type { ProfileResponse, ProfileUpdatePayload } from "./types";

const COMPANY_PROFILE_STORAGE_KEY = "shipsy-client-company-profile";
const USER_STORAGE_KEY = "shipsy-client-user";

function readUserName(): { firstName?: string; lastName?: string; email?: string; phone?: string } {
  if (typeof window === "undefined") return {};
  try {
    const user = JSON.parse(localStorage.getItem(USER_STORAGE_KEY) || "{}");
    return {
      firstName: user.firstName || "Demo",
      lastName: user.lastName || "Seller",
      email: user.email || "client@shipsy.in",
      phone: user.phone || "9876543210",
    };
  } catch {
    return {};
  }
}

function readCurrentUser(): User | null {
  if (typeof window === "undefined") return null;
  try {
    const user = JSON.parse(localStorage.getItem(USER_STORAGE_KEY) || "{}") as User;
    return user?.id ? user : null;
  } catch {
    return null;
  }
}

function defaultProfile(): ProfileResponse {
  const user = readUserName();
  return {
    success: true,
    profile: {
      id: "static-company-profile",
      firstName: user.firstName ?? "Demo",
      lastName: user.lastName ?? "Seller",
      email: user.email ?? "client@shipsy.in",
      phone: user.phone ?? "9876543210",
      businessName: "Shipsy Demo Store",
      website: "https://shipsy.in",
      supportEmail: "support@shipsy.in",
      contactNumber: "9876543210",
      address: "DLF Cyber City, Sector 24",
      pincode: "122001",
      city: "Gurugram",
      state: "Haryana",
      plan: "basic",
    },
  };
}

function readStaticProfile(): ProfileResponse {
  if (typeof window === "undefined") return defaultProfile();
  const raw = localStorage.getItem(COMPANY_PROFILE_STORAGE_KEY);
  if (!raw) {
    const profile = defaultProfile();
    localStorage.setItem(COMPANY_PROFILE_STORAGE_KEY, JSON.stringify(profile.profile));
    return profile;
  }
  try {
    return { success: true, profile: { ...defaultProfile().profile, ...JSON.parse(raw) } };
  } catch {
    const profile = defaultProfile();
    localStorage.setItem(COMPANY_PROFILE_STORAGE_KEY, JSON.stringify(profile.profile));
    return profile;
  }
}

function writeStaticProfile(payload: ProfileUpdatePayload): ProfileResponse {
  const current = readStaticProfile().profile;
  const profile = { ...current, ...payload };
  if (typeof window !== "undefined") {
    localStorage.setItem(COMPANY_PROFILE_STORAGE_KEY, JSON.stringify(profile));
    const user = readCurrentUser();
    if (user?.id) mirrorClientSellerToAdmin(user, profile);
  }
  return { success: true, profile };
}

export const profileApi = {
  get: async (): Promise<ProfileResponse> => {
    if (shouldUseStaticClientData()) return readStaticProfile();
    try {
      const { data } = await api.get("/profile");
      return data?.profile ? data : readStaticProfile();
    } catch {
      return readStaticProfile();
    }
  },

  update: async (payload: ProfileUpdatePayload): Promise<ProfileResponse> => {
    if (!shouldUseStaticClientData()) {
      try {
        const { data } = await api.put("/profile", payload);
        if (data?.profile) {
          if (typeof window !== "undefined") {
            localStorage.setItem(COMPANY_PROFILE_STORAGE_KEY, JSON.stringify(data.profile));
            const user = readCurrentUser();
            if (user?.id) mirrorClientSellerToAdmin(user, data.profile);
          }
          return data;
        }
      } catch {
        // Persist locally when the static panel has no backend.
      }
    }
    return writeStaticProfile(payload);
  },
};
