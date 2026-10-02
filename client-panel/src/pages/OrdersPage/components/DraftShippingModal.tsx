import { useEffect, useMemo, useState } from "react";
import { Alert, Modal, Select, Spin } from "antd";
import { Loader2, Package, Truck } from "lucide-react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import type { Order } from "@/lib/ordersTypes";
import type { AvailableCourier } from "@/lib/ratesApi";
import { cheapestCourierForProvider, getDraftCouriers, type DraftPickupAddress } from "@/lib/draftShipping";
import { ordersApi } from "@/lib/ordersApi";
import { formatCurrency, formatKeyword } from "@/lib/utils";
import { ORDERS_QUERY_KEY } from "@/queries/useOrders";

interface DraftShippingModalProps {
  open: boolean;
  drafts: Order[];
  pickupAddresses: DraftPickupAddress[];
  onClose: () => void;
  onComplete: () => void;
}

export default function DraftShippingModal({
  open,
  drafts,
  pickupAddresses,
  onClose,
  onComplete,
}: DraftShippingModalProps) {
  const queryClient = useQueryClient();
  const [ratesByDraft, setRatesByDraft] = useState<Record<string, AvailableCourier[]>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [selections, setSelections] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [shipping, setShipping] = useState(false);
  const [globalProvider, setGlobalProvider] = useState<string>();

  useEffect(() => {
    if (!open || drafts.length === 0) return;
    let cancelled = false;
    setLoading(true);
    setRatesByDraft({});
    setErrors({});
    setSelections({});
    setGlobalProvider(undefined);
    Promise.allSettled(drafts.map((draft) => getDraftCouriers(draft, pickupAddresses)))
      .then((results) => {
        if (cancelled) return;
        const nextRates: Record<string, AvailableCourier[]> = {};
        const nextErrors: Record<string, string> = {};
        results.forEach((result, index) => {
          const draft = drafts[index];
          if (result.status === "fulfilled" && result.value.length > 0) nextRates[draft.id] = result.value;
          else nextErrors[draft.id] = result.status === "rejected"
            ? result.reason instanceof Error ? result.reason.message : "Could not fetch courier rates"
            : "No courier is available for this shipment";
        });
        setRatesByDraft(nextRates);
        setErrors(nextErrors);
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [open, drafts, pickupAddresses]);

  const globalOptions = useMemo(() => {
    if (drafts.length === 0 || drafts.some((draft) => !(ratesByDraft[draft.id]?.length > 0))) return [];
    const common = new Set(ratesByDraft[drafts[0].id].map((courier) => courier.serviceProvider));
    drafts.slice(1).forEach((draft) => {
      const providers = new Set(ratesByDraft[draft.id].map((courier) => courier.serviceProvider));
      [...common].forEach((provider) => { if (!providers.has(provider)) common.delete(provider); });
    });
    return [...common].map((provider) => {
      const sample = ratesByDraft[drafts[0].id].find((courier) => courier.serviceProvider === provider);
      return { value: provider, label: `${sample?.serviceProviderDisplayName || formatKeyword(provider)} — best service for each shipment` };
    });
  }, [drafts, ratesByDraft]);

  function applyGlobalProvider(provider: string) {
    setGlobalProvider(provider);
    setSelections(Object.fromEntries(drafts.map((draft) => {
      const courier = cheapestCourierForProvider(ratesByDraft[draft.id] ?? [], provider);
      return [draft.id, courier?.courierId || ""];
    })));
  }

  const allSelected = drafts.length > 0 && drafts.every((draft) =>
    Boolean(selections[draft.id]) && !errors[draft.id],
  );

  async function shipDrafts() {
    if (!allSelected || shipping) return;
    setShipping(true);
    let successCount = 0;
    const failures: string[] = [];
    for (const draft of drafts) {
      const courier = (ratesByDraft[draft.id] ?? []).find((item) => item.courierId === selections[draft.id]);
      if (!courier) {
        failures.push(`${draft.orderId}: courier selection missing`);
        continue;
      }
      try {
        await ordersApi.shipDraft(draft, courier);
        successCount += 1;
      } catch (error) {
        failures.push(`${draft.orderId}: ${error instanceof Error ? error.message : "booking failed"}`);
      }
    }
    await queryClient.invalidateQueries({ queryKey: ORDERS_QUERY_KEY });
    setShipping(false);
    if (failures.length === 0) {
      toast.success(`${successCount} shipment${successCount === 1 ? "" : "s"} booked successfully`);
    } else {
      toast.warning(`${successCount} booked, ${failures.length} failed`, { description: failures[0] });
    }
    onComplete();
    onClose();
  }

  return (
    <Modal
      open={open}
      onCancel={shipping ? undefined : onClose}
      title={drafts.length === 1 ? `Ship ${drafts[0]?.orderId || "draft"}` : `Bulk ship ${drafts.length} drafts`}
      width={760}
      footer={null}
      destroyOnClose
    >
      <div className="space-y-4 pt-2">
        <p className="text-sm text-muted">
          Choose one courier provider for every shipment, then override any individual shipment if needed.
        </p>

        {loading ? (
          <div className="flex items-center justify-center gap-3 py-12 text-sm text-muted">
            <Spin size="small" /> Fetching available courier rates for {drafts.length} shipment{drafts.length === 1 ? "" : "s"}…
          </div>
        ) : (
          <>
            {globalOptions.length > 0 && drafts.length > 1 && (
              <div className="rounded-xl border border-primary/20 bg-primary/[0.04] p-4">
                <label className="mb-2 block text-xs font-bold text-foreground">Global courier selection</label>
                <Select
                  className="w-full"
                  value={globalProvider}
                  placeholder="Apply a courier provider to all shipments"
                  options={globalOptions}
                  onChange={applyGlobalProvider}
                  disabled={shipping}
                />
              </div>
            )}

            {drafts.length > 1 && globalOptions.length === 0 && Object.keys(errors).length === 0 && (
              <Alert type="info" showIcon message="No single courier provider serves every selected shipment. Choose couriers individually below." />
            )}

            <div className="max-h-[430px] space-y-2 overflow-y-auto pr-1">
              {drafts.map((draft) => {
                const rates = ratesByDraft[draft.id] ?? [];
                const selected = rates.find((courier) => courier.courierId === selections[draft.id]);
                return (
                  <div key={draft.id} className="rounded-xl border border-border-light bg-background p-3.5">
                    <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2">
                      <div className="flex min-w-0 items-center gap-2">
                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"><Package className="h-4 w-4" /></div>
                        <div className="min-w-0">
                          <p className="truncate text-sm font-bold text-foreground">{draft.orderId}</p>
                          <p className="text-[11px] text-muted">{draft.deliveryAddress.city}, {draft.deliveryAddress.pincode} · {draft.orderType}</p>
                        </div>
                      </div>
                      {selected && <span className="text-sm font-bold text-primary">{formatCurrency(selected.rate.totalCharge)}</span>}
                    </div>
                    {errors[draft.id] ? (
                      <Alert type="error" showIcon message={errors[draft.id]} />
                    ) : (
                      <Select
                        className="w-full"
                        value={selections[draft.id] || undefined}
                        placeholder="Select courier for this shipment"
                        disabled={shipping}
                        onChange={(courierId) => {
                          setSelections((current) => ({ ...current, [draft.id]: courierId }));
                          setGlobalProvider(undefined);
                        }}
                        options={rates.map((courier) => ({
                          value: courier.courierId,
                          label: `${courier.name} · ${formatCurrency(courier.rate.totalCharge)}`,
                        }))}
                      />
                    )}
                  </div>
                );
              })}
            </div>
          </>
        )}

        <div className="flex items-center justify-end gap-2 border-t border-border-light pt-4">
          <button type="button" onClick={onClose} disabled={shipping} className="rounded-lg border border-border-light px-4 py-2 text-sm font-semibold text-muted disabled:opacity-50">Cancel</button>
          <button
            type="button"
            onClick={shipDrafts}
            disabled={!allSelected || loading || shipping}
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-5 py-2 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            {shipping ? <Loader2 className="h-4 w-4 animate-spin" /> : <Truck className="h-4 w-4" />}
            {shipping ? "Booking shipments…" : drafts.length === 1 ? "Book Shipment" : `Book ${drafts.length} Shipments`}
          </button>
        </div>
      </div>
    </Modal>
  );
}
