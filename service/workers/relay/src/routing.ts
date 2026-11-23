import { isCityAddress } from '../../../packages/service-protocol/src/index';

export const DELIVERY_LANES_PER_CITY = 16;
export const DELIVERY_LANE_LAYOUT = 'arrivals-v2';
export const DELIVERY_BATCH_DELAY_MS = 50;
// Sixteen lanes provide the same 16,384-message bounded online burst budget as
// the destination mailbox. Backpressure still fails closed once that budget is
// exhausted instead of allowing an unbounded Durable Object queue.
export const DELIVERY_LANE_PENDING_LIMIT = 1_024;

export type DeliveryRoute = {
  city: string;
  lane: number;
};

export const deliveryLaneIndex = (roadId: string) => {
  let hash = 0x811c9dc5;
  for (let index = 0; index < roadId.length; index += 1) {
    hash ^= roadId.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0) % DELIVERY_LANES_PER_CITY;
};

export const deliveryRoute = (city: string, roadId: string): DeliveryRoute => ({
  city,
  lane: deliveryLaneIndex(roadId),
});

export const deliveryLaneName = (route: DeliveryRoute) => {
  if (!isCityAddress(route.city) || !Number.isInteger(route.lane)
    || route.lane < 0 || route.lane >= DELIVERY_LANES_PER_CITY) {
    throw new Error('invalid_delivery_route');
  }
  return `${route.city}/${DELIVERY_LANE_LAYOUT}/lane-${route.lane}`;
};

export const validDeliveryRoute = (value: DeliveryRoute) => (
  isCityAddress(value.city)
  && Number.isInteger(value.lane)
  && value.lane >= 0
  && value.lane < DELIVERY_LANES_PER_CITY
);
