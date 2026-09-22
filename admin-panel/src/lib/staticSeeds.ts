import type { User } from "@/features/auth/types";
import type { Plan } from "@/features/plans/types";
import type { LocationListItem } from "@/features/serviceability/types";
import type { UserListItem } from "@/features/users/types";

export const STATIC_PLANS_KEY = "shipsy-static-plans";
export const STATIC_USERS_KEY = "shipsy-static-users";
export const STATIC_LOCATIONS_KEY = "shipsy-static-locations";
export const STATIC_ADMIN_KEY = "shipsy-admin-user";
export const STATIC_ADMIN_ACCOUNT_KEY = "shipsy-static-admin-account";
const CLIENT_ACCOUNTS_KEY = "shipsy-client-accounts";
const CLIENT_USER_KEY = "shipsy-client-user";
const CLIENT_COMPANY_PROFILE_KEY = "shipsy-client-company-profile";
const CLIENT_KYC_KEY = "shipsy-client-kyc";

type ClientAccount = {
  id?: string;
  name?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
  phone?: string | null;
  isVerified?: boolean;
  onboardingComplete?: boolean;
};

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

type ClientKyc = {
  status?: UserListItem["kycStatus"];
};

function nowIso(): string {
  return new Date().toISOString();
}

function readJson<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  const raw = localStorage.getItem(key);
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeJson<T>(key: string, value: T): T {
  if (typeof window !== "undefined") {
    localStorage.setItem(key, JSON.stringify(value));
  }
  return value;
}

export function readStaticPlans(): Plan[] {
  seedDefaultPlans();
  return readJson<Plan[]>(STATIC_PLANS_KEY, []);
}

export function writeStaticPlans(plans: Plan[]): Plan[] {
  return writeJson(STATIC_PLANS_KEY, plans);
}

export function readStaticUsers(): UserListItem[] {
  assignBasicPlan();
  return mergeClientPanelUsers(readJson<UserListItem[]>(STATIC_USERS_KEY, []));
}

export function writeStaticUsers(users: UserListItem[]): UserListItem[] {
  return writeJson(STATIC_USERS_KEY, users);
}

function clientName(user: ClientAccount): string | null {
  return user.name ?? ([user.firstName, user.lastName].filter(Boolean).join(" ") || null);
}

function clientBusinessName(user: ClientAccount, profile: ClientCompanyProfile | null): string | null {
  if (profile?.businessName) return profile.businessName;
  const name = clientName(user);
  return name ? `${name} Store` : user.email ?? user.phone ?? "New Seller";
}

function readClientKycStatus(existing?: UserListItem): UserListItem["kycStatus"] {
  const kyc = readJson<ClientKyc | null>(CLIENT_KYC_KEY, null);
  return kyc?.status ?? existing?.kycStatus ?? "not_submitted";
}

function toSeller(user: ClientAccount, existing: UserListItem | undefined, profile: ClientCompanyProfile | null): UserListItem | null {
  if (!user.id) return null;
  const updatedAt = nowIso();
  const kycStatus = readClientKycStatus(existing);
  return {
    id: user.id,
    name: clientName(user),
    firstName: user.firstName ?? null,
    lastName: user.lastName ?? null,
    email: user.email ?? profile?.supportEmail ?? null,
    phone: user.phone ?? profile?.contactNumber ?? null,
    businessName: clientBusinessName(user, profile),
    pincode: profile?.pincode ?? existing?.pincode ?? null,
    city: profile?.city ?? existing?.city ?? null,
    state: profile?.state ?? existing?.state ?? null,
    website: profile?.website ?? existing?.website ?? null,
    supportEmail: profile?.supportEmail ?? user.email ?? existing?.supportEmail ?? null,
    contactNumber: profile?.contactNumber ?? user.phone ?? existing?.contactNumber ?? null,
    address: profile?.address ?? existing?.address ?? null,
    sellsOn: existing?.sellsOn?.length ? existing.sellsOn : ["Website"],
    monthlyShipmentVolume: existing?.monthlyShipmentVolume ?? null,
    lastLogin: existing?.lastLogin ?? updatedAt,
    isActive: existing?.isActive ?? true,
    onboardingComplete: user.onboardingComplete ?? existing?.onboardingComplete ?? false,
    isVerified: user.isVerified ?? existing?.isVerified ?? true,
    kycStatus,
    plan: profile?.plan ?? existing?.plan ?? "basic",
    createdAt: existing?.createdAt ?? updatedAt,
    updatedAt,
  };
}

function mergeClientPanelUsers(users: UserListItem[]): UserListItem[] {
  if (typeof window === "undefined") return users;
  const accounts = readJson<ClientAccount[]>(CLIENT_ACCOUNTS_KEY, []);
  const currentUser = readJson<ClientAccount | null>(CLIENT_USER_KEY, null);
  const profile = readJson<ClientCompanyProfile | null>(CLIENT_COMPANY_PROFILE_KEY, null);
  const clientUsers = [...accounts, ...(currentUser ? [currentUser] : [])];
  if (clientUsers.length === 0) return users;

  const byId = new Map(users.map((user) => [user.id, user]));
  clientUsers.forEach((clientUser) => {
    const seller = toSeller(clientUser, clientUser.id ? byId.get(clientUser.id) : undefined, profile);
    if (seller) byId.set(seller.id, seller);
  });

  return Array.from(byId.values());
}

export function readStaticLocations(): LocationListItem[] {
  seedLocations();
  return readJson<LocationListItem[]>(STATIC_LOCATIONS_KEY, []);
}

export function writeStaticLocations(locations: LocationListItem[]): LocationListItem[] {
  return writeJson(STATIC_LOCATIONS_KEY, locations);
}

export function seedBasicPlan(): Plan {
  const plans = readJson<Plan[]>(STATIC_PLANS_KEY, []);
  const existing = plans.find((plan) => plan.slug === "basic");
  if (existing) return existing;

  const basicPlan: Plan = {
    id: "plan-basic",
    name: "Basic",
    slug: "basic",
    description: "Default starter plan for new Shipsy sellers.",
    sortOrder: 1,
    isDefault: true,
    isActive: true,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
  writeStaticPlans([basicPlan, ...plans]);
  return basicPlan;
}

export function seedDefaultPlans(): Plan[] {
  const basic = seedBasicPlan();
  const plans = readJson<Plan[]>(STATIC_PLANS_KEY, []);
  const createdAt = nowIso();
  const defaults: Plan[] = [
    basic,
    {
      id: "plan-gold",
      name: "Gold",
      slug: "gold",
      description: "For growing sellers with higher monthly shipment volume.",
      sortOrder: 2,
      isDefault: false,
      isActive: true,
      createdAt,
      updatedAt: createdAt,
    },
    {
      id: "plan-platinum",
      name: "Platinum",
      slug: "platinum",
      description: "Advanced rates and controls for established businesses.",
      sortOrder: 3,
      isDefault: false,
      isActive: true,
      createdAt,
      updatedAt: createdAt,
    },
    {
      id: "plan-diamond",
      name: "Diamond",
      slug: "diamond",
      description: "Premium plan for high-volume shipping operations.",
      sortOrder: 4,
      isDefault: false,
      isActive: true,
      createdAt,
      updatedAt: createdAt,
    },
  ];
  const bySlug = new Map(plans.map((plan) => [plan.slug, plan]));
  defaults.forEach((plan) => {
    if (!bySlug.has(plan.slug)) bySlug.set(plan.slug, plan);
  });
  return writeStaticPlans(Array.from(bySlug.values()));
}

export function seedAdmin(): User {
  const existing = readJson<User | null>(STATIC_ADMIN_KEY, null);
  const defaultSellerIds = ["seller-deoband-bazaar", "shipsy-demo-seller"];
  const admin: User = {
    id: "demo-admin-user",
    email: existing?.email ?? "admin@shipsy.in",
    phone: existing?.phone ?? null,
    name: existing?.name ?? "Demo Admin",
    firstName: existing?.firstName ?? "Demo",
    lastName: existing?.lastName ?? "Admin",
    role: "superadmin",
    designation: existing?.designation ?? "Operations Lead",
    roleLabel: existing?.roleLabel ?? "Superadmin",
    assignedSellerIds: existing?.assignedSellerIds?.length ? existing.assignedSellerIds : defaultSellerIds,
    permissions: existing?.permissions ?? [],
    isVerified: existing?.isVerified ?? true,
    onboardingComplete: existing?.onboardingComplete ?? true,
  };
  writeJson(STATIC_ADMIN_ACCOUNT_KEY, admin);
  return writeJson(STATIC_ADMIN_KEY, admin);
}

export function assignBasicPlan(): UserListItem {
  const plan = seedBasicPlan();
  const users = readJson<UserListItem[]>(STATIC_USERS_KEY, []);
  const currentById = new Map(users.map((user) => [user.id, user]));
  const updatedAt = nowIso();
  const defaultSellers: UserListItem[] = [
    {
      id: "seller-deoband-bazaar",
      name: "Nuzhat Sayyed",
      firstName: "Nuzhat",
      lastName: "Sayyed",
      email: "nuzhatsayyed28@gmail.com",
      phone: null,
      businessName: "DEOBAND BAZAAR",
      pincode: "247554",
      city: "Deoband",
      state: "Uttar Pradesh",
      website: null,
      supportEmail: "nuzhatsayyed28@gmail.com",
      contactNumber: null,
      address: "Deoband Bazaar, Saharanpur, Uttar Pradesh",
      sellsOn: ["Website", "Marketplace"],
      monthlyShipmentVolume: "100-500",
      lastLogin: updatedAt,
      isActive: true,
      onboardingComplete: true,
      isVerified: true,
      kycStatus: "not_submitted",
      plan: plan.slug,
      createdAt: currentById.get("seller-deoband-bazaar")?.createdAt ?? updatedAt,
      updatedAt,
    },
    {
      id: "shipsy-demo-seller",
      name: "Shipsy Demo Seller",
      firstName: "Shipsy",
      lastName: "Seller",
      email: "support@shipsy.in",
      phone: "9876543210",
      businessName: "Shipsy Demo Store",
      pincode: "122001",
      city: "Gurugram",
      state: "Haryana",
      website: "https://shipsy.in",
      supportEmail: "support@shipsy.in",
      contactNumber: "9876543210",
      address: "ShipSy Business Hub, Sector 44, Gurugram",
      sellsOn: ["Website", "Shopify"],
      monthlyShipmentVolume: "100-500",
      lastLogin: updatedAt,
      isActive: true,
      onboardingComplete: true,
      isVerified: true,
      kycStatus: "not_submitted",
      plan: plan.slug,
      createdAt: currentById.get("shipsy-demo-seller")?.createdAt ?? updatedAt,
      updatedAt,
    },
  ];
  const defaultIds = new Set(defaultSellers.map((seller) => seller.id));
  writeStaticUsers([
    ...defaultSellers,
    ...users.filter(
      (user) =>
        !defaultIds.has(user.id) &&
        user.id !== "demo-client-user" &&
        user.name !== "Sahil Mittal" &&
        user.businessName !== "Sahil Mittal Store",
    ),
  ]);
  return defaultSellers[0];
}

export function seedLocations(): LocationListItem[] {
  const existing = readJson<LocationListItem[]>(STATIC_LOCATIONS_KEY, []);
  if (existing.length > 0) return existing;

  const createdAt = nowIso();
  const locations: LocationListItem[] = [
    { id: "loc-110001", pincode: "110001", city: "New Delhi", state: "Delhi", tags: ["north", "metro"], isActive: true, createdAt, updatedAt: createdAt },
    { id: "loc-400001", pincode: "400001", city: "Mumbai", state: "Maharashtra", tags: ["west", "metro"], isActive: true, createdAt, updatedAt: createdAt },
    { id: "loc-560102", pincode: "560102", city: "Bengaluru", state: "Karnataka", tags: ["south", "metro"], isActive: true, createdAt, updatedAt: createdAt },
    { id: "loc-700001", pincode: "700001", city: "Kolkata", state: "West Bengal", tags: ["east", "metro"], isActive: true, createdAt, updatedAt: createdAt },
    { id: "loc-800001", pincode: "800001", city: "Patna", state: "Bihar", tags: ["east"], isActive: true, createdAt, updatedAt: createdAt },
    { id: "loc-395001", pincode: "395001", city: "Surat", state: "Gujarat", tags: ["west"], isActive: true, createdAt, updatedAt: createdAt },
  ];
  return writeStaticLocations(locations);
}

export function ensureStaticSeeds(): void {
  seedDefaultPlans();
  assignBasicPlan();
  seedAdmin();
  seedLocations();
}
