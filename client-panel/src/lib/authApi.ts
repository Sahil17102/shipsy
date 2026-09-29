import type { User } from "@/contexts/AuthContext";
import { api, setAccessToken } from "./api";
import { mirrorClientSellerToAdmin } from "./adminSellerMirror";
import { isCourierApiConfigured, loginCourierApi, shouldUseCourierApi } from "./courierApi";
import { shouldUseStaticClientData } from "./staticMode";

const USER_STORAGE_KEY = "shipsy-client-user";
const ACCOUNTS_STORAGE_KEY = "shipsy-client-accounts";
const DEMO_OTP = "123456";
const EMAIL_OTP_ENABLED = import.meta.env.VITE_EMAIL_OTP_ENABLED === "true";

const DEMO_USER: User = {
  id: "demo-client-user",
  email: "pkmmittal97@gmail.com",
  phone: null,
  name: "Sahil Mittal",
  firstName: "Sahil",
  lastName: "Mittal",
  role: "user",
  teamRole: "owner",
  parentUserId: null,
  isVerified: true,
  onboardingComplete: true,
  hasPassword: true,
};

function withOnboardingState(user: User): User {
  const isLegacyDemoUser =
    user.id === DEMO_USER.id ||
    user.name === "Demo Seller" ||
    user.email === "client@shipsy.in";

  return {
    ...user,
    email: isLegacyDemoUser && user.email === "client@shipsy.in" ? DEMO_USER.email : user.email,
    name: isLegacyDemoUser ? DEMO_USER.name : user.name,
    firstName: isLegacyDemoUser ? DEMO_USER.firstName : user.firstName,
    lastName: isLegacyDemoUser ? DEMO_USER.lastName : user.lastName,
    isVerified: true,
    onboardingComplete: user.onboardingComplete,
  };
}

function normalizeIdentifier(identifier: string): string {
  return identifier.trim().toLowerCase();
}

function readAccounts(): User[] {
  try {
    const raw = localStorage.getItem(ACCOUNTS_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as User[]) : [];
  } catch {
    return [];
  }
}

function findAccount(identifier: string): User | null {
  const normalized = normalizeIdentifier(identifier);
  const saved = readAccounts().find((account) =>
    [account.email, account.phone].some((value) => value && normalizeIdentifier(value) === normalized),
  );
  if (saved) return saved;

  const current = readUser();
  if (current && [current.email, current.phone].some((value) => value && normalizeIdentifier(value) === normalized)) {
    return current;
  }
  return null;
}

function saveAccount(user: User): void {
  const accounts = readAccounts();
  const next = accounts.filter((account) => account.id !== user.id);
  next.push(user);
  localStorage.setItem(ACCOUNTS_STORAGE_KEY, JSON.stringify(next));
}

function readUser(): User | null {
  const raw = localStorage.getItem(USER_STORAGE_KEY);
  if (!raw) return null;
  try {
    return withOnboardingState(JSON.parse(raw) as User);
  } catch {
    return withOnboardingState(DEMO_USER);
  }
}

function persistUser(user: User): User {
  const normalized = withOnboardingState(user);
  localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(normalized));
  saveAccount(normalized);
  mirrorClientSellerToAdmin(normalized);
  setAccessToken("static-client-token");
  return normalized;
}

function makeShipsyUser(identifier?: string, onboardingComplete = false): User {
  const cleanIdentifier = identifier?.trim() || "";
  return {
    ...DEMO_USER,
    id: `client-${normalizeIdentifier(cleanIdentifier || crypto.randomUUID())}`,
    email: cleanIdentifier.includes("@") ? cleanIdentifier : null,
    phone: cleanIdentifier && !cleanIdentifier.includes("@") ? cleanIdentifier : null,
    name: null,
    firstName: null,
    lastName: null,
    onboardingComplete,
    hasPassword: false,
  };
}

export const authApi = {
  getSession: async (): Promise<User | null> => {
    const user = readUser();
    if (user) {
      setAccessToken("static-client-token");
      readAccounts().forEach((account) => mirrorClientSellerToAdmin(withOnboardingState(account)));
      mirrorClientSellerToAdmin(user);
    }
    return user;
  },

  sendOtp: async (identifier: string): Promise<{ isNewUser: boolean }> => {
    const cleanIdentifier = identifier.trim();
    if (EMAIL_OTP_ENABLED && !cleanIdentifier.includes("@")) {
      throw new Error("Enter a valid email address to receive an OTP.");
    }
    if (cleanIdentifier.includes("@") && (EMAIL_OTP_ENABLED || !shouldUseStaticClientData())) {
      const { data } = await api.post<{ isNewUser: boolean }>("/auth/send-otp", {
        identifier: cleanIdentifier,
      });
      return { ...data, isNewUser: !findAccount(cleanIdentifier) };
    }
    return { isNewUser: !findAccount(cleanIdentifier) };
  },

  verifyOtp: async (params: {
    identifier: string;
    code: string;
  }): Promise<{ user: User; isNewUser: boolean }> => {
    if (EMAIL_OTP_ENABLED && !params.identifier.includes("@")) {
      throw new Error("Email OTP verification is required.");
    }
    if (params.identifier.includes("@") && (EMAIL_OTP_ENABLED || !shouldUseStaticClientData())) {
      const { data } = await api.post<{ user: User; isNewUser: boolean }>("/auth/verify-otp", params);
      const existingUser = findAccount(params.identifier);
      return {
        user: persistUser(existingUser ?? data.user),
        isNewUser: !existingUser,
      };
    }
    if (params.code !== DEMO_OTP) {
      throw new Error("Invalid OTP. Use 123456 to sign in.");
    }
    const existingUser = findAccount(params.identifier);
    if (existingUser) {
      return { user: persistUser(existingUser), isNewUser: false };
    }
    const user = makeShipsyUser(params.identifier, false);
    return { user: persistUser(user), isNewUser: true };
  },

  loginWithPassword: async (params: {
    identifier: string;
    password: string;
  }): Promise<{ user: User }> => {
    const identifier = params.identifier.trim();
    if (shouldUseCourierApi() && !isCourierApiConfigured()) {
      await loginCourierApi(identifier, params.password);
    }
    const user = findAccount(identifier);
    if (!user) throw new Error("Account not found. Please sign in with OTP to create your account.");
    return { user: persistUser(user) };
  },

  loginWithGoogle: async (params: {
    accessToken: string;
  }): Promise<{ user: User; isNewUser: boolean }> => {
    const identifier = params.accessToken.includes("@") ? params.accessToken : undefined;
    const existingUser = identifier ? findAccount(identifier) : null;
    const user = existingUser ?? makeShipsyUser(identifier, false);
    return { user: persistUser(user), isNewUser: !existingUser };
  },

  onboarding: async (payload: Record<string, unknown>): Promise<{ user: User }> => {
    const current = readUser() ?? DEMO_USER;
    if (!shouldUseStaticClientData()) {
      const { data } = await api.post<{ user: User }>("/auth/onboarding", payload);
      return { user: persistUser(data.user) };
    }

    const firstName = typeof payload.firstName === "string" ? payload.firstName : current.firstName;
    const lastName = typeof payload.lastName === "string" ? payload.lastName : current.lastName;
    const email = typeof payload.email === "string" ? payload.email : current.email;
    const phone = typeof payload.phone === "string" ? payload.phone : current.phone;

    return {
      user: persistUser({
        ...current,
        firstName,
        lastName,
        name: [firstName, lastName].filter(Boolean).join(" ") || current.name,
        email,
        phone,
        onboardingComplete: true,
      }),
    };
  },

  logout: async (): Promise<void> => {
    localStorage.removeItem(USER_STORAGE_KEY);
    setAccessToken(null);
  },
};
