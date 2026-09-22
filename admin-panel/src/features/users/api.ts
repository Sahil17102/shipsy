import { api } from "@/lib/api";
import { readStaticUsers, writeStaticUsers } from "@/lib/staticSeeds";
import type {
  ListUsersResponse,
  UserListItem,
  ListTeamMembersResponse,
  CreateTeamMemberPayload,
  TeamMember,
  ResetPasswordResponse,
  UserSummary,
} from "./types";

const useStaticData = import.meta.env.VITE_STATIC_DATA_ENABLED !== "false";
const SHARED_API_BASE_URL = (import.meta.env.VITE_SHARED_API_URL || "https://shipsy-kyio.onrender.com/api").replace(/\/$/, "");
const KYC_STATUSES = ["not_submitted", "pending", "approved", "rejected"] as const;
const STATIC_TEAM_MEMBERS_KEY = "shipsy-static-team-members";

function readStaticTeamMembers(): TeamMember[] {
  if (typeof window === "undefined") return [];
  try {
    const value = JSON.parse(localStorage.getItem(STATIC_TEAM_MEMBERS_KEY) || "[]");
    return Array.isArray(value) ? value as TeamMember[] : [];
  } catch {
    return [];
  }
}

function writeStaticTeamMembers(members: TeamMember[]): void {
  if (typeof window !== "undefined") {
    localStorage.setItem(STATIC_TEAM_MEMBERS_KEY, JSON.stringify(members));
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function booleanValue(value: unknown, fallback = false): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function stringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map((item) => (typeof item === "string" ? item.trim() : ""))
      .filter(Boolean);
  }

  if (typeof value === "string") {
    return value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }

  return [];
}

function normalizePlan(value: unknown): string {
  if (typeof value === "string" && value.trim()) return value;
  const plan = asRecord(value);
  return nullableString(plan.slug) ?? nullableString(plan.name)?.toLowerCase() ?? "basic";
}

function normalizeKycStatus(value: unknown): UserListItem["kycStatus"] {
  return typeof value === "string" && KYC_STATUSES.includes(value as UserListItem["kycStatus"])
    ? (value as UserListItem["kycStatus"])
    : "not_submitted";
}

function normalizeUser(raw: unknown): UserListItem {
  const user = asRecord(raw);
  const profile = asRecord(user.companyProfile);
  const now = new Date().toISOString();

  return {
    id: String(user.id ?? user._id ?? ""),
    name: nullableString(user.name),
    firstName: nullableString(user.firstName),
    lastName: nullableString(user.lastName),
    email: nullableString(user.email),
    phone: nullableString(user.phone),
    businessName: nullableString(user.businessName) ?? nullableString(profile.businessName),
    pincode: nullableString(user.pincode) ?? nullableString(profile.pincode),
    city: nullableString(user.city) ?? nullableString(profile.city),
    state: nullableString(user.state) ?? nullableString(profile.state),
    website: nullableString(user.website) ?? nullableString(profile.website),
    supportEmail: nullableString(user.supportEmail) ?? nullableString(profile.supportEmail),
    contactNumber: nullableString(user.contactNumber) ?? nullableString(profile.contactNumber),
    address: nullableString(user.address) ?? nullableString(profile.address),
    sellsOn: stringArray(user.sellsOn ?? profile.sellsOn),
    monthlyShipmentVolume: nullableString(user.monthlyShipmentVolume) ?? nullableString(profile.monthlyShipmentVolume),
    lastLogin: nullableString(user.lastLogin),
    isActive: booleanValue(user.isActive, true),
    onboardingComplete: booleanValue(user.onboardingComplete),
    isVerified: booleanValue(user.isVerified),
    kycStatus: normalizeKycStatus(user.kycStatus),
    plan: normalizePlan(user.plan),
    createdAt: nullableString(user.createdAt) ?? now,
    updatedAt: nullableString(user.updatedAt) ?? nullableString(user.createdAt) ?? now,
  };
}

function mergeUsers(localUsers: UserListItem[], sharedUsers: UserListItem[]): UserListItem[] {
  const users = new Map(localUsers.map((user) => [user.id, normalizeUser(user)]));
  sharedUsers.forEach((user) => users.set(user.id, normalizeUser(user)));
  return Array.from(users.values()).sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

async function readUsersWithSharedRegistry(): Promise<UserListItem[]> {
  const localUsers = readStaticUsers();
  try {
    const response = await fetch(`${SHARED_API_BASE_URL}/sellers`, {
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    if (!response.ok) return localUsers;
    const payload = asRecord(await response.json());
    const sharedUsers = Array.isArray(payload.users) ? payload.users.map(normalizeUser) : [];
    return mergeUsers(localUsers, sharedUsers);
  } catch {
    return localUsers;
  }
}

async function writeUserToSharedRegistry(user: UserListItem): Promise<void> {
  try {
    await fetch(`${SHARED_API_BASE_URL}/sellers`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ seller: { ...user, planAssignedByAdmin: true } }),
    });
  } catch {
    // The local copy keeps the admin usable if the free backend is waking up.
  }
}

function normalizeSummary(raw: unknown): UserSummary {
  const response = asRecord(raw);
  const summary = asRecord(response.summary ?? raw);
  const orders = asRecord(summary.orders);
  const revenue = asRecord(summary.revenue);
  const remittance = asRecord(summary.remittance);
  const wallet = asRecord(summary.wallet);
  const byType = asRecord(orders.byType);
  const byPayment = asRecord(orders.byPayment);

  return {
    orders: {
      total: Number(orders.total) || 0,
      byStatus: asRecord(orders.byStatus) as Record<string, number>,
      byType: { B2B: Number(byType.B2B) || 0, B2C: Number(byType.B2C) || 0 },
      byPayment: { prepaid: Number(byPayment.prepaid) || 0, cod: Number(byPayment.cod) || 0 },
    },
    revenue: {
      total: Number(revenue.total) || 0,
      freight: Number(revenue.freight) || 0,
      cod: Number(revenue.cod) || 0,
    },
    remittance: {
      totalCodCollected: Number(remittance.totalCodCollected) || 0,
      totalRemitted: Number(remittance.totalRemitted) || 0,
      pendingRemittance: Number(remittance.pendingRemittance) || 0,
      pendingCount: Number(remittance.pendingCount) || 0,
      creditedCount: Number(remittance.creditedCount) || 0,
    },
    wallet: {
      balance: Number(wallet.balance) || 0,
      totalCredits: Number(wallet.totalCredits) || 0,
      totalDebits: Number(wallet.totalDebits) || 0,
    },
    topProviders: Array.isArray(summary.topProviders)
      ? summary.topProviders.map((item) => {
        const provider = asRecord(item);
        return {
          provider: String(provider.provider ?? ""),
          count: Number(provider.count) || 0,
          revenue: Number(provider.revenue) || 0,
        };
      })
      : [],
  };
}

function buildStats(users: UserListItem[]): ListUsersResponse["stats"] {
  return {
    total: users.length,
    verified: users.filter((user) => user.isVerified).length,
    onboarded: users.filter((user) => user.onboardingComplete).length,
    active: users.filter((user) => user.isActive).length,
    kycPending: users.filter((user) => user.kycStatus === "pending").length,
    kycVerified: users.filter((user) => user.kycStatus === "approved").length,
    inactive: users.filter((user) => !user.isActive).length,
    notOnboarded: users.filter((user) => !user.onboardingComplete).length,
    kycNotStarted: users.filter((user) => user.kycStatus === "not_submitted").length,
  };
}

function filterUsers(
  users: UserListItem[],
  params?: {
    search?: string;
    onboardingComplete?: string;
    isVerified?: string;
    isActive?: string;
    plan?: string;
    kycStatus?: string;
    page?: number;
    limit?: number;
  },
): ListUsersResponse {
  let filtered = [...users];
  if (params?.search) {
    const query = params.search.toLowerCase();
    filtered = filtered.filter((user) =>
      [user.name, user.email, user.phone, user.businessName, user.city, user.state]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(query)),
    );
  }
  if (params?.onboardingComplete) filtered = filtered.filter((user) => user.onboardingComplete === (params.onboardingComplete === "true"));
  if (params?.isVerified) filtered = filtered.filter((user) => user.isVerified === (params.isVerified === "true"));
  if (params?.isActive) filtered = filtered.filter((user) => user.isActive === (params.isActive === "true"));
  if (params?.plan) filtered = filtered.filter((user) => user.plan === params.plan);
  if (params?.kycStatus) filtered = filtered.filter((user) => user.kycStatus === params.kycStatus);

  const page = params?.page ?? 1;
  const limit = params?.limit ?? 20;
  const total = filtered.length;
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const start = (page - 1) * limit;
  return {
    users: filtered.slice(start, start + limit),
    pagination: { page, limit, total, totalPages },
    stats: buildStats(users),
  };
}

export const usersApi = {
  list: async (params?: {
    search?: string;
    onboardingComplete?: string;
    isVerified?: string;
    isActive?: string;
    plan?: string;
    kycStatus?: string;
    page?: number;
    limit?: number;
    sortField?: string;
    sortOrder?: string;
  }): Promise<ListUsersResponse> => {
    if (useStaticData) {
      return filterUsers(await readUsersWithSharedRegistry(), params);
    }

    try {
      const { data } = await api.get("/users", { params });
      const response = data as ListUsersResponse;
      const users = Array.isArray(response.users) ? response.users.map(normalizeUser) : [];
      if (users.length === 0) {
        return filterUsers(await readUsersWithSharedRegistry(), params);
      }
      return {
        ...response,
        users,
        stats: response.stats ?? buildStats(users),
        pagination: response.pagination ?? {
          page: params?.page ?? 1,
          limit: params?.limit ?? 20,
          total: users.length,
          totalPages: 1,
        },
      };
    } catch {
      return filterUsers(await readUsersWithSharedRegistry(), params);
    }
  },

  getById: async (id: string): Promise<{ user: UserListItem }> => {
    if (useStaticData) {
      const user = (await readUsersWithSharedRegistry()).find((item) => item.id === id);
      if (!user) throw new Error("User not found");
      return { user: normalizeUser(user) };
    }

    try {
      const { data } = await api.get(`/users/${id}`);
      const response = data as { user: UserListItem };
      if (response.user) return { ...response, user: normalizeUser(response.user) };
    } catch {
      // Static admin deploys keep seller data locally.
    }
    const user = (await readUsersWithSharedRegistry()).find((item) => item.id === id);
    if (!user) throw new Error("User not found");
    return { user: normalizeUser(user) };
  },

  toggleActive: async (id: string): Promise<{ message: string }> => {
    if (useStaticData) {
      const users = await readUsersWithSharedRegistry();
      const current = users.find((user) => user.id === id);
      if (!current) throw new Error("User not found");
      const updated = { ...current, isActive: !current.isActive, updatedAt: new Date().toISOString() };
      writeStaticUsers(users.map((user) => user.id === id ? updated : user));
      await writeUserToSharedRegistry(updated);
      return { message: "User updated" };
    }

    const { data } = await api.patch(`/users/${id}/toggle-active`);
    return data as { message: string };
  },

  updatePlan: async (id: string, plan: string): Promise<{ message: string }> => {
    if (!useStaticData) {
      try {
        const { data } = await api.patch(`/users/${id}/plan`, { plan });
        return data as { message: string };
      } catch {
        // Static production deploys persist the assignment in the shared seller registry.
      }
    }

    const users = await readUsersWithSharedRegistry();
    const updated = users.find((user) => user.id === id);
    if (!updated) throw new Error("User not found");
    const nextUser = { ...updated, plan, updatedAt: new Date().toISOString() };
    writeStaticUsers(users.map((user) => user.id === id ? nextUser : user));
    await writeUserToSharedRegistry(nextUser);
    return { message: "Plan assigned" };
  },

  // ── Team members ──

  listTeamMembers: async (id: string): Promise<ListTeamMembersResponse> => {
    if (useStaticData) {
      return { members: readStaticTeamMembers().filter((member) => member.parentUserId === id) };
    }

    try {
      const { data } = await api.get(`/users/${id}/team-members`);
      const response = data as ListTeamMembersResponse;
      if (Array.isArray(response.members) && response.members.length > 0) return response;
    } catch {
      // Static admin deploys keep seller data locally.
    }

    const user = readStaticUsers().find((item) => item.id === id);
    if (!user) return { members: [] };
    return {
      members: [
        {
          id: `${id}-owner`,
          name: user.name,
          firstName: user.firstName,
          lastName: user.lastName,
          email: user.email,
          phone: user.phone,
          teamRole: "owner",
          parentUserId: id,
          isActive: user.isActive,
          lastLogin: user.lastLogin,
          createdAt: user.createdAt,
          updatedAt: user.updatedAt,
        },
      ],
    };
  },

  createTeamMember: async (
    id: string,
    payload: CreateTeamMemberPayload,
  ): Promise<{ member: TeamMember }> => {
    if (useStaticData) {
      const member: TeamMember = {
        id: `member-${Date.now()}`,
        name: `${payload.firstName} ${payload.lastName}`,
        firstName: payload.firstName,
        lastName: payload.lastName,
        email: payload.email,
        phone: payload.phone ?? null,
        teamRole: "member",
        parentUserId: id,
        isActive: true,
        lastLogin: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      writeStaticTeamMembers([member, ...readStaticTeamMembers()]);
      return { member };
    }

    const { data } = await api.post(`/users/${id}/team-members`, payload);
    return data as { member: TeamMember };
  },

  deleteTeamMember: async (id: string, memberId: string): Promise<void> => {
    if (useStaticData) {
      writeStaticTeamMembers(readStaticTeamMembers().filter(
        (member) => !(member.parentUserId === id && member.id === memberId),
      ));
      return;
    }

    await api.delete(`/users/${id}/team-members/${memberId}`);
  },

  resetPassword: async (id: string): Promise<ResetPasswordResponse> => {
    if (useStaticData) {
      return { message: "Temporary password generated", tempPassword: "Shipsy@123", resetBy: "admin" };
    }

    const { data } = await api.post(`/users/${id}/reset-password`);
    return data as ResetPasswordResponse;
  },

  // ── Summary ──

  getSummary: async (id: string): Promise<UserSummary> => {
    if (useStaticData) {
      const user = (await readUsersWithSharedRegistry()).find((item) => item.id === id);
      if (!user) throw new Error("User not found");
      return {
        orders: {
          total: 0,
          byStatus: {},
          byType: { B2B: 0, B2C: 0 },
          byPayment: { prepaid: 0, cod: 0 },
        },
        revenue: { total: 0, freight: 0, cod: 0 },
        remittance: {
          totalCodCollected: 0,
          totalRemitted: 0,
          pendingRemittance: 0,
          pendingCount: 0,
          creditedCount: 0,
        },
        wallet: { balance: 0, totalCredits: 0, totalDebits: 0 },
        topProviders: [],
      };
    }

    const { data } = await api.get(`/users/${id}/summary`);
    return normalizeSummary(data);
  },
};
