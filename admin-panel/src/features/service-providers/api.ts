import { api } from "@/lib/api";
import type {
  ProviderCredentialsResponse,
  ListProvidersResponse,
  ProviderListItem,
  CredentialFieldDef,
} from "./types";

const STATIC_SERVICE_PROVIDERS_KEY = "shipsy-static-service-providers";
const STATIC_SERVICE_PROVIDER_CREDS_KEY = "shipsy-static-service-provider-credentials";

interface CredentialBlockPayload {
  values: Record<string, string>;
  fields?: CredentialFieldDef[];
  description?: string;
}

export interface CreateProviderPayload {
  slug: string;
  name: string;
  baseUrl?: string;
  isActive?: boolean;
  credentials?: {
    b2c?: CredentialBlockPayload;
    b2b?: CredentialBlockPayload & { sameAsB2c?: boolean };
  };
}

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

function defaultProvider(payload?: CreateProviderPayload): ProviderListItem {
  const updatedAt = nowIso();
  const name = payload?.name?.trim() || "New Provider";
  const slug = payload?.slug?.trim().toLowerCase() || `provider-${Date.now()}`;
  return {
    id: `sp-${slug}`,
    serviceProvider: slug,
    displayName: name,
    logoUrl: "",
    totalCouriers: 0,
    enabledCouriers: 0,
    serviceProviderDisplayName: name,
    isEnabled: payload?.isActive !== false,
    b2c: { configured: false },
    b2b: { configured: false, sameAsB2c: false },
    status: payload?.isActive === false ? "inactive" : "active",
    updatedAt,
  };
}

function defaultCredentials(): ProviderCredentialsResponse {
  return {
    b2c: {
      fields: [],
      description: "Courier API credentials are not configured for this local admin panel.",
      values: {},
    },
    b2b: {
      fields: [],
      description: "Courier API credentials are not configured for this local admin panel.",
      values: {},
      sameAsB2c: false,
    },
  };
}

function isListProvidersResponse(data: unknown): data is ListProvidersResponse {
  const value = data as Partial<ListProvidersResponse> | null;
  return Boolean(
    value &&
      Array.isArray(value.providers) &&
      value.stats &&
      value.pagination,
  );
}

function readStaticProviders(): ProviderListItem[] {
  const providers = readJson<ProviderListItem[]>(STATIC_SERVICE_PROVIDERS_KEY, []);
  const filtered = providers.filter(
    (provider) => !["teampafex", "shadowfax"].includes(provider.serviceProvider.toLowerCase()),
  );
  if (filtered.length !== providers.length) writeStaticProviders(filtered);
  return filtered;
}

function writeStaticProviders(providers: ProviderListItem[]): ProviderListItem[] {
  return writeJson(STATIC_SERVICE_PROVIDERS_KEY, providers);
}

function readStaticCredentials(providerId: string): ProviderCredentialsResponse {
  const all = readJson<Record<string, ProviderCredentialsResponse>>(STATIC_SERVICE_PROVIDER_CREDS_KEY, {});
  const fallback = defaultCredentials();
  const creds = all[providerId] ?? fallback;
  const merged: ProviderCredentialsResponse = {
    b2c: { ...fallback.b2c, ...creds.b2c, values: { ...fallback.b2c.values, ...creds.b2c?.values } },
    b2b: { ...fallback.b2b, ...creds.b2b, values: { ...fallback.b2b.values, ...creds.b2b?.values } },
  };
  all[providerId] = merged;
  writeJson(STATIC_SERVICE_PROVIDER_CREDS_KEY, all);
  return merged;
}

function writeStaticCredentials(
  providerId: string,
  type: "b2c" | "b2b",
  credentials: Record<string, string>,
): void {
  const all = readJson<Record<string, ProviderCredentialsResponse>>(STATIC_SERVICE_PROVIDER_CREDS_KEY, {});
  const current = readStaticCredentials(providerId);
  all[providerId] = {
    ...current,
    [type]: {
      ...current[type],
      values: {
        ...current[type].values,
        ...credentials,
      },
    },
  };
  writeJson(STATIC_SERVICE_PROVIDER_CREDS_KEY, all);
}

function listStaticProviders(params?: { page?: number; limit?: number; configured?: boolean }): ListProvidersResponse {
  const configuredOnly = params?.configured === true;
  const filtered = readStaticProviders().filter((provider) => {
    if (!configuredOnly) return true;
    return provider.b2c.configured || provider.b2b.configured;
  });
  const page = Math.max(1, Number(params?.page ?? 1));
  const limit = Math.max(1, Number(params?.limit ?? 50));
  const start = (page - 1) * limit;
  const providers = filtered.slice(start, start + limit);
  return {
    providers,
    stats: {
      total: filtered.length,
      active: filtered.filter((provider) => provider.status === "active").length,
      b2cConfigured: filtered.filter((provider) => provider.b2c.configured).length,
    },
    pagination: {
      page,
      limit,
      total: filtered.length,
      totalPages: Math.max(1, Math.ceil(filtered.length / limit)),
    },
  };
}

export const serviceProvidersApi = {
  list: async (params?: { page?: number; limit?: number; configured?: boolean }): Promise<ListProvidersResponse> => {
    if (import.meta.env.VITE_STATIC_DATA_ENABLED === "true") {
      return listStaticProviders(params);
    }

    try {
      const { data } = await api.get("/service-providers", { params });
      return isListProvidersResponse(data) && data.providers.length > 0 ? data : listStaticProviders(params);
    } catch {
      return listStaticProviders(params);
    }
  },

  create: async (payload: CreateProviderPayload): Promise<ProviderListItem> => {
    try {
      const { data } = await api.post("/service-providers", {
        slug: payload.slug,
        name: payload.name,
        isActive: payload.isActive,
      });
      if (data?.provider) {
        const provider = data.provider as ProviderListItem;
        return {
          ...provider,
          b2c: { configured: false },
          b2b: { configured: false, sameAsB2c: false },
        };
      }
    } catch {
      // Static admin deploys keep provider configuration locally.
    }

    const provider: ProviderListItem = {
      ...defaultProvider(payload),
      updatedAt: nowIso(),
    };
    writeStaticProviders([provider, ...readStaticProviders().filter((item) => item.id !== provider.id)]);
    return provider;
  },

  getById: async (id: string): Promise<ProviderListItem> => {
    try {
      const { data } = await api.get(`/service-providers/${id}`);
      if (data?.provider) return data.provider as ProviderListItem;
    } catch {
      // Static admin deploys keep provider configuration locally.
    }
    const provider = readStaticProviders().find((item) => item.id === id);
    if (!provider) throw new Error("Service provider not found");
    return provider;
  },

  update: async (
    id: string,
    payload: {
      status?: "active" | "inactive";
      isEnabled?: boolean;
      b2bSameAsB2c?: boolean;
    },
  ): Promise<void> => {
    try {
      await api.put(`/service-providers/${id}`, payload);
      return;
    } catch {
      // Static admin deploys keep provider configuration locally.
    }
    const providers = readStaticProviders().map((provider) =>
      provider.id === id
        ? {
            ...provider,
            status: payload.status ?? provider.status,
            isEnabled: payload.isEnabled ?? (payload.status ? payload.status === "active" : provider.isEnabled),
            b2b: {
              ...provider.b2b,
              sameAsB2c: payload.b2bSameAsB2c ?? provider.b2b.sameAsB2c,
              configured: payload.b2bSameAsB2c === true ? true : provider.b2b.configured,
            },
            updatedAt: nowIso(),
          }
        : provider,
    );
    writeStaticProviders(providers);
  },

  updateCredentials: async (
    id: string,
    type: "b2c" | "b2b",
    credentials: Record<string, string>,
  ): Promise<void> => {
    try {
      await api.patch(`/service-providers/${id}/credentials`, { type, credentials });
      return;
    } catch {
      // Static admin deploys keep provider configuration locally.
    }
    writeStaticCredentials(id, type, credentials);
    writeStaticProviders(readStaticProviders().map((provider) =>
      provider.id === id
        ? { ...provider, [type]: { ...provider[type], configured: true }, updatedAt: nowIso() }
        : provider,
    ));
  },

  getCredentials: async (id: string): Promise<ProviderCredentialsResponse> => {
    try {
      const { data } = await api.get(`/service-providers/${id}/credentials`);
      if (data?.b2c && data?.b2b) return data as ProviderCredentialsResponse;
    } catch {
      // Static admin deploys keep provider configuration locally.
    }
    return readStaticCredentials(id);
  },

  uploadLogo: async (id: string, file: File): Promise<{ logoUrl: string }> => {
    const form = new FormData();
    form.append("logo", file);
    try {
      const { data } = await api.post(`/service-providers/${id}/logo`, form, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      return data as { logoUrl: string };
    } catch {
      return { logoUrl: "" };
    }
  },
};
