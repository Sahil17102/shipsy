import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { kycApi } from "./api";
import { KYC_QUERY_KEY } from "./config";
import type { KycSubmitPayload } from "./types";

// ── Queries ──

export function useKyc() {
  return useQuery({
    queryKey: KYC_QUERY_KEY,
    queryFn: kycApi.get,
    staleTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
    select: (data) => data.kyc,
  });
}

// ── Mutations ──

export function useSubmitKyc() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: KycSubmitPayload) => kycApi.submit(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [...KYC_QUERY_KEY] });
    },
  });
}

export function useUploadKycDocument() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ documentKey, file }: { documentKey: string; file: File }) =>
      kycApi.uploadDocument(documentKey, file),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [...KYC_QUERY_KEY] });
    },
  });
}
