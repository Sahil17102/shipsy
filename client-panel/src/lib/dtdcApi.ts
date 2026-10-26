import { api } from "./api";

export interface DtdcStatus {
  connected: boolean;
  bookingConfigured: boolean;
  trackingConfigured: boolean;
  pincodeConfigured: boolean;
  environment: "staging" | "production";
  provider: "DTDC";
}

export interface DtdcPincodeResult {
  ok: boolean;
  status: number;
  environment: "staging" | "production";
  data?: {
    ZIPCODE_RESP?: Array<{ MESSAGE?: string; SERVFLAG?: string; ORGPIN?: string; DESTPIN?: string }>;
    SERV_LIST_DTLS?: Array<{ CODE?: string; PCODE?: string; NAME?: string; TAT?: string }>;
  };
}

export interface DtdcBookingResult {
  success: boolean;
  awb: string;
  referenceNumber?: string;
  environment: "staging" | "production";
}

export interface DtdcCancellationResult {
  ok: boolean;
  status: number;
  environment: "staging" | "production";
  data?: unknown;
}

export const dtdcApi = {
  status: async (): Promise<DtdcStatus> => (await api.get<DtdcStatus>("/providers/dtdc/status")).data,
  pincode: async (orgPincode: string, desPincode: string): Promise<DtdcPincodeResult> =>
    (await api.post<DtdcPincodeResult>("/providers/dtdc/pincode", { orgPincode, desPincode })).data,
  createOrder: async (payload: Record<string, unknown>): Promise<DtdcBookingResult> =>
    (await api.post<DtdcBookingResult>("/providers/dtdc/create-order", payload, { timeout: 60_000 })).data,
  cancelOrder: async (awb: string): Promise<DtdcCancellationResult> =>
    (await api.post<DtdcCancellationResult>("/providers/dtdc/cancel-order", { awb }, { timeout: 60_000 })).data,
};
