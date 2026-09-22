import { api } from "@/lib/api";
import type { BankAccountsResponse, BankAccountResponse } from "./types";

const useStaticData = import.meta.env.VITE_STATIC_DATA_ENABLED !== "false";

export const adminBankAccountApi = {
  listByUser: async (userId: string): Promise<BankAccountsResponse> => {
    if (useStaticData) return { success: true, accounts: [] };
    const { data } = await api.get(`/bank-accounts/user/${userId}`);
    return data;
  },

  approve: async (id: string): Promise<BankAccountResponse> => {
    if (useStaticData) throw new Error(`Bank account ${id} was not found`);
    const { data } = await api.post(`/bank-accounts/${id}/approve`);
    return data;
  },

  reject: async (
    id: string,
    rejectionReason: string,
  ): Promise<BankAccountResponse> => {
    if (useStaticData) throw new Error(`Bank account ${id} was not found`);
    const { data } = await api.post(`/bank-accounts/${id}/reject`, {
      rejectionReason,
    });
    return data;
  },
};
