import { api } from "@/lib/api";
import { CLIENT_KYC_KEY, isDemoApprovedKycUser, mirrorClientSellerToAdmin } from "@/lib/adminSellerMirror";
import { isRecord, shouldUseStaticClientData } from "@/lib/staticMode";
import type { User } from "@/contexts/AuthContext";
import { getRequiredDocuments } from "./config";
import type { DocumentField, DocumentKey, KycRecord, KycResponse, KycSubmitPayload } from "./types";

const USER_STORAGE_KEY = "shipsy-client-user";
const DOCUMENT_KEYS: DocumentKey[] = [
  "selfie",
  "panCard",
  "aadhaar",
  "cancelledCheque",
  "boardResolution",
  "partnershipDeed",
  "llpAgreement",
  "companyAddressProof",
  "businessPan",
  "gstCertificate",
];

function emptyDocument(): DocumentField {
  return { status: "not_uploaded" };
}

function makeEmptyKyc(): KycRecord {
  const createdAt = new Date().toISOString();
  return {
    id: "static-kyc-demo",
    userId: "demo-client-user",
    status: "not_submitted",
    selfie: emptyDocument(),
    panCard: emptyDocument(),
    aadhaar: emptyDocument(),
    cancelledCheque: emptyDocument(),
    boardResolution: emptyDocument(),
    partnershipDeed: emptyDocument(),
    llpAgreement: emptyDocument(),
    companyAddressProof: emptyDocument(),
    businessPan: emptyDocument(),
    gstCertificate: emptyDocument(),
    createdAt,
    updatedAt: createdAt,
  };
}

function kycStorageKey(user: User | null): string {
  return user?.id ? `${CLIENT_KYC_KEY}:${user.id}` : CLIENT_KYC_KEY;
}

function makeApprovedDemoKyc(user: User): KycRecord {
  const now = new Date().toISOString();
  const approvedDocument = (): DocumentField => ({
    status: "approved",
    url: "demo-verified://document",
    mime: "application/pdf",
  });
  return {
    ...makeEmptyKyc(),
    id: `kyc-${user.id}`,
    userId: user.id,
    status: "approved",
    businessStructure: "sole_proprietor",
    selfie: approvedDocument(),
    panCard: approvedDocument(),
    aadhaar: approvedDocument(),
    cancelledCheque: approvedDocument(),
    createdAt: now,
    updatedAt: now,
  };
}

function readStaticKyc(): KycRecord {
  if (typeof window === "undefined") return makeEmptyKyc();
  const user = readCurrentUser();
  const key = kycStorageKey(user);
  if (user && isDemoApprovedKycUser(user)) {
    const approvedKyc = makeApprovedDemoKyc(user);
    localStorage.setItem(key, JSON.stringify(approvedKyc));
    return approvedKyc;
  }

  const raw = localStorage.getItem(key);
  if (!raw) {
    const kyc = makeEmptyKyc();
    if (user) kyc.userId = user.id;
    localStorage.setItem(key, JSON.stringify(kyc));
    return kyc;
  }

  try {
    const parsed = JSON.parse(raw) as KycRecord;
    return { ...makeEmptyKyc(), ...parsed };
  } catch {
    const kyc = makeEmptyKyc();
    if (user) kyc.userId = user.id;
    localStorage.setItem(key, JSON.stringify(kyc));
    return kyc;
  }
}

function writeStaticKyc(kyc: KycRecord): KycResponse {
  const updated = { ...kyc, updatedAt: new Date().toISOString() };
  if (typeof window !== "undefined") {
    localStorage.setItem(kycStorageKey(readCurrentUser()), JSON.stringify(updated));
    mirrorCurrentSeller();
  }
  return { success: true, kyc: updated };
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

function mirrorCurrentSeller(): void {
  const user = readCurrentUser();
  if (user) mirrorClientSellerToAdmin(user);
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => resolve(`local-document://${file.name}`);
    reader.readAsDataURL(file);
  });
}

function isKycResponse(value: unknown): value is KycResponse {
  return (
    isRecord(value) &&
    value.success === true &&
    isRecord(value.kyc) &&
    typeof value.kyc.status === "string"
  );
}

function makeMissingDocumentError(missingDocuments: DocumentKey[]): Error {
  const error = new Error("Please upload all required documents before submitting.");
  (error as any).response = {
    data: {
      success: false,
      error: error.message,
      missingDocuments,
    },
  };
  return error;
}

export const kycApi = {
  /** Fetch the current user's KYC record. Falls back to local demo KYC on static deploys. */
  get: async (): Promise<KycResponse> => {
    if (shouldUseStaticClientData()) {
      return { success: true, kyc: readStaticKyc() };
    }

    try {
      const { data } = await api.get("/kyc");
      return isKycResponse(data) ? data : { success: true, kyc: readStaticKyc() };
    } catch {
      return { success: true, kyc: readStaticKyc() };
    }
  },

  /** Submit / update KYC details and set status to pending. */
  submit: async (payload: KycSubmitPayload): Promise<KycResponse> => {
    if (!shouldUseStaticClientData()) {
      try {
        const { data } = await api.post("/kyc", payload);
        if (isKycResponse(data)) {
          if (typeof window !== "undefined") {
            localStorage.setItem(kycStorageKey(readCurrentUser()), JSON.stringify(data.kyc));
            mirrorCurrentSeller();
          }
          return data;
        }
      } catch {
        // Static panels should remain usable when the API is absent.
      }
    }

    const current = readStaticKyc();
    const required = getRequiredDocuments(payload.businessStructure, payload.companyType);
    const missingDocuments = required.filter(
      (key) => !current[key]?.url || current[key]?.status === "not_uploaded",
    );
    if (missingDocuments.length > 0) throw makeMissingDocumentError(missingDocuments);

    return writeStaticKyc({
      ...current,
      ...payload,
      status: "pending",
    });
  },

  /** Upload a single document to the KYC record. */
  uploadDocument: async (
    documentKey: string,
    file: File,
  ): Promise<KycResponse> => {
    if (!shouldUseStaticClientData()) {
      try {
        const formData = new FormData();
        formData.append("document", file);
        formData.append("documentKey", documentKey);
        const { data } = await api.post("/kyc/upload", formData, {
          headers: { "Content-Type": "multipart/form-data" },
        });
        if (isKycResponse(data)) {
          if (typeof window !== "undefined") {
            localStorage.setItem(kycStorageKey(readCurrentUser()), JSON.stringify(data.kyc));
            mirrorCurrentSeller();
          }
          return data;
        }
      } catch {
        // Use the local document state on static deploys and API failures.
      }
    }

    if (!DOCUMENT_KEYS.includes(documentKey as DocumentKey)) {
      throw new Error("Invalid KYC document type");
    }

    const key = documentKey as DocumentKey;
    const current = readStaticKyc();
    const dataUrl = await fileToDataUrl(file);

    return writeStaticKyc({
      ...current,
      [key]: {
        url: dataUrl,
        status: "pending",
        mime: file.type || "application/octet-stream",
      },
    });
  },
};
