import { ratesApi, type AvailableCourier } from "./ratesApi";
import type { Order } from "./ordersTypes";
import { expandPackagesByQuantity } from "@/utils/b2bBoxes";

export interface DraftPickupAddress {
  id: string;
  pincode: string;
}

export async function getDraftCouriers(
  draft: Order,
  pickupAddresses: DraftPickupAddress[],
): Promise<AvailableCourier[]> {
  const payload = draft.draftPayload;
  if (!payload) throw new Error("Draft shipment details are missing");
  const pickup = pickupAddresses.find((address) => address.id === payload.pickupAddressId);
  if (!pickup?.pincode) throw new Error("Draft pickup address is unavailable");

  if (payload.orderType === "B2B") {
    const packages = expandPackagesByQuantity(payload.packages ?? []);
    const couriers = await ratesApi.getB2bAvailableCouriers({
      origin: pickup.pincode,
      destination: payload.pincode,
      packages,
      paymentType: payload.paymentType,
      orderAmount: payload.orderAmount,
    });
    return couriers.map((courier) => ({
      courierId: courier.courierId,
      name: courier.name,
      serviceProvider: courier.serviceProvider,
      serviceProviderDisplayName: courier.serviceProviderDisplayName,
      logo: courier.logo,
      mode: "surface" as const,
      zone: {
        code: `${courier.zone.originCode}→${courier.zone.destinationCode}`,
        name: `${courier.zone.originName} → ${courier.zone.destinationName}`,
      },
      chargeableWeight: courier.billableWeight * 1000,
      minWeight: 1000,
      rate: {
        forward: courier.rate.baseFreight,
        rto: courier.rate.rtoRate,
        codCharges: courier.rate.overheads.find((item) => item.code === "COD")?.amount ?? 0,
        otherCharges: courier.rate.overheads.filter((item) => item.code !== "COD").reduce((sum, item) => sum + item.amount, 0),
        freightCharge: courier.rate.baseFreight,
        totalCharge: courier.rate.total,
      },
      tag: courier.tag,
      _b2bRate: courier.rate,
    }));
  }

  return ratesApi.getAvailableCouriers({
    origin: pickup.pincode,
    destination: payload.pincode,
    weight: payload.weight,
    length: payload.length || undefined,
    breadth: payload.breadth || undefined,
    height: payload.height || undefined,
    paymentType: payload.paymentType,
    orderAmount: payload.paymentType === "cod" ? payload.orderAmount : undefined,
    orderType: "B2C",
  });
}

export function cheapestCourierForProvider(couriers: AvailableCourier[], provider: string) {
  return couriers
    .filter((courier) => courier.serviceProvider === provider)
    .sort((left, right) => left.rate.totalCharge - right.rate.totalCharge)[0];
}
