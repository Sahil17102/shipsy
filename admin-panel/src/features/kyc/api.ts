import { api } from "@/lib/api";
import { readStaticUsers, writeStaticUsers } from "@/lib/staticSeeds";
import type { UserListItem } from "@/features/users/types";
import type { AdminKycResponse, DocumentField, KycRecord, KycStatus } from "./types";

const useStaticData = import.meta.env.PROD || import.meta.env.VITE_STATIC_DATA_ENABLED !== "false";
const SHARED_API_BASE_URL = (import.meta.env.VITE_SHARED_API_URL || "https://shipsy-kyio.onrender.com/api").replace(/\/$/, "");

function documentFor(status: KycStatus): DocumentField {
  return status === "approved"
    ? { status: "approved", url: "demo-verified://document", mime: "application/pdf" }
    : { status: "not_uploaded" };
}

function kycForUser(userId: string, status: KycStatus): AdminKycResponse {
  const now = new Date().toISOString();
  const document = documentFor(status);
  const kyc: KycRecord = {
    id: `kyc-${userId}`,
    userId,
    status,
    businessStructure: "sole_proprietor",
    selfie: { ...document }, panCard: { ...document }, aadhaar: { ...document },
    cancelledCheque: { ...document }, boardResolution: { status: "not_uploaded" },
    partnershipDeed: { status: "not_uploaded" }, llpAgreement: { status: "not_uploaded" },
    companyAddressProof: { status: "not_uploaded" }, businessPan: { status: "not_uploaded" },
    gstCertificate: { status: "not_uploaded" }, createdAt: now, updatedAt: now,
  };
  return { success: true, kyc };
}

async function sharedUserById(userId: string): Promise<UserListItem | undefined> {
  try {
    const response = await fetch(`${SHARED_API_BASE_URL}/sellers`, { cache: "no-store" });
    const payload = await response.json() as { users?: UserListItem[] };
    const shared = payload.users?.find((user) => user.id === userId);
    if (shared) return shared;
  } catch {
    // Fall back to the admin's local cache while the shared service wakes up.
  }
  return readStaticUsers().find((user) => user.id === userId);
}

async function updateStaticKyc(userId: string, status: KycStatus): Promise<AdminKycResponse> {
  const user = await sharedUserById(userId);
  if (user) {
    const updated = { ...user, kycStatus: status, updatedAt: new Date().toISOString() };
    const users = readStaticUsers();
    writeStaticUsers([updated, ...users.filter((item) => item.id !== userId)]);
    try {
      await fetch(`${SHARED_API_BASE_URL}/sellers`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ seller: updated }),
      });
    } catch {
      // Local state remains available if the shared service is waking up.
    }
  }
  return kycForUser(userId, status);
}

/** Fetch a KYC document as a blob URL (goes through axios with auth token) */
export async function fetchDocumentBlob(
  userId: string,
  key: string,
  filename: string,
): Promise<string> {
  const { data } = await api.get(`/document/${userId}/${key}/${filename}`, {
    responseType: "blob",
  });
  return URL.createObjectURL(data);
}

export const adminKycApi = {
  getByUserId: async (userId: string): Promise<AdminKycResponse> => {
    if (useStaticData) {
      const user = await sharedUserById(userId);
      return kycForUser(userId, user?.kycStatus ?? "not_submitted");
    }
    const { data } = await api.get(`/users/${userId}/kyc`);
    return data as AdminKycResponse;
  },

  approve: async (id: string): Promise<AdminKycResponse> => {
    if (useStaticData) return updateStaticKyc(id.replace(/^kyc-/, ""), "approved");
    const { data } = await api.post(`/kyc/${id}/approve`);
    return data as AdminKycResponse;
  },

  reject: async (id: string, rejectionReason: string): Promise<AdminKycResponse> => {
    if (useStaticData) return updateStaticKyc(id.replace(/^kyc-/, ""), "rejected");
    const { data } = await api.post(`/kyc/${id}/reject`, { rejectionReason });
    return data as AdminKycResponse;
  },

  approveDocument: async (id: string, key: string): Promise<AdminKycResponse> => {
    if (useStaticData) return updateStaticKyc(id.replace(/^kyc-/, ""), "approved");
    const { data } = await api.post(`/kyc/${id}/document/${key}/approve`);
    return data as AdminKycResponse;
  },

  rejectDocument: async (
    id: string,
    key: string,
    rejectionReason: string,
  ): Promise<AdminKycResponse> => {
    if (useStaticData) return updateStaticKyc(id.replace(/^kyc-/, ""), "rejected");
    const { data } = await api.post(`/kyc/${id}/document/${key}/reject`, {
      rejectionReason,
    });
    return data as AdminKycResponse;
  },

  /** Build a URL to serve a KYC document via the admin proxy */
  getDocumentUrl: (userId: string, key: string, filename: string): string =>
    `/api/admin/document/${userId}/${key}/${filename}`,
};
