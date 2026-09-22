import type { User } from "@/contexts/AuthContext";

export const ADMIN_STATIC_USERS_KEY = "shipsy-static-users";
export const CLIENT_COMPANY_PROFILE_KEY = "shipsy-client-company-profile";
export const CLIENT_KYC_KEY = "shipsy-client-kyc";
export const DEMO_APPROVED_KYC_EMAIL = "sahilmittal1920@gmail.com";
const SHARED_API_BASE_URL = (import.meta.env.VITE_SHARED_API_URL || "https://shipsy-kyio.onrender.com/api").replace(/\/$/, "");

type ClientCompanyProfile = {
  businessName?: string | null;
  website?: string | null;
  supportEmail?: string | null;
  contactNumber?: string | null;
  address?: string | null;
  pincode?: string | null;
  city?: string | null;
  state?: string | null;
  plan?: string | null;
};

type AdminSeller = {
  id: string;
  name: string | null;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  phone: string | null;
  businessName: string | null;
  pincode: string | null;
  city: string | null;
  state: string | null;
  website: string | null;
  supportEmail: string | null;
  contactNumber: string | null;
  address: string | null;
  sellsOn: string[];
  monthlyShipmentVolume: string | null;
  lastLogin: string | null;
  isActive: boolean;
  onboardingComplete: boolean;
  isVerified: boolean;
  kycStatus: "not_submitted" | "pending" | "approved" | "rejected";
  plan: string;
  createdAt: string;
  updatedAt: string;
};

type ClientKyc = {
  status?: "not_submitted" | "pending" | "approved" | "rejected";
};

function readJson<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson<T>(key: string, value: T): void {
  if (typeof window !== "undefined") {
    window.localStorage.setItem(key, JSON.stringify(value));
  }
}

function syncSellerToSharedApi(seller: AdminSeller): void {
  void fetch(`${SHARED_API_BASE_URL}/sellers`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ seller }),
    keepalive: true,
  }).catch(() => {
    // Local client data remains usable while the shared service wakes up or redeploys.
  });
}

function buildName(user: User): string | null {
  return user.name ?? ([user.firstName, user.lastName].filter(Boolean).join(" ") || null);
}

function buildBusinessName(user: User, profile?: ClientCompanyProfile | null): string | null {
  if (profile?.businessName) return profile.businessName;
  const name = buildName(user);
  return name ? `${name} Store` : user.email ?? user.phone ?? "New Seller";
}

export function isDemoApprovedKycUser(user: Pick<User, "email"> | null): boolean {
  return user?.email?.trim().toLowerCase() === DEMO_APPROVED_KYC_EMAIL;
}

function readKycStatus(user: User): AdminSeller["kycStatus"] {
  if (isDemoApprovedKycUser(user)) return "approved";
  const kyc = readJson<ClientKyc | null>(`${CLIENT_KYC_KEY}:${user.id}`, null);
  return kyc?.status ?? "not_submitted";
}

export function mirrorClientSellerToAdmin(user: User, profile?: ClientCompanyProfile | null): void {
  if (typeof window === "undefined") return;

  const savedProfile = profile ?? readJson<ClientCompanyProfile | null>(CLIENT_COMPANY_PROFILE_KEY, null);
  const kycStatus = readKycStatus(user);
  const sellers = readJson<AdminSeller[]>(ADMIN_STATIC_USERS_KEY, []);
  const current = sellers.find((seller) => seller.id === user.id);
  const now = new Date().toISOString();

  const nextSeller: AdminSeller = {
    id: user.id,
    name: buildName(user),
    firstName: user.firstName ?? null,
    lastName: user.lastName ?? null,
    email: user.email ?? savedProfile?.supportEmail ?? null,
    phone: user.phone ?? savedProfile?.contactNumber ?? null,
    businessName: buildBusinessName(user, savedProfile),
    pincode: savedProfile?.pincode ?? current?.pincode ?? null,
    city: savedProfile?.city ?? current?.city ?? null,
    state: savedProfile?.state ?? current?.state ?? null,
    website: savedProfile?.website ?? current?.website ?? null,
    supportEmail: savedProfile?.supportEmail ?? user.email ?? current?.supportEmail ?? null,
    contactNumber: savedProfile?.contactNumber ?? user.phone ?? current?.contactNumber ?? null,
    address: savedProfile?.address ?? current?.address ?? null,
    sellsOn: current?.sellsOn?.length ? current.sellsOn : ["Website"],
    monthlyShipmentVolume: current?.monthlyShipmentVolume ?? null,
    lastLogin: now,
    isActive: true,
    onboardingComplete: user.onboardingComplete,
    isVerified: user.isVerified,
    kycStatus,
    plan: savedProfile?.plan ?? current?.plan ?? "basic",
    createdAt: current?.createdAt ?? now,
    updatedAt: now,
  };

  writeJson(ADMIN_STATIC_USERS_KEY, [nextSeller, ...sellers.filter((seller) => seller.id !== user.id)]);
  syncSellerToSharedApi(nextSeller);
}
