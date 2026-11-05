import { isWithinDeliveryRadius, calculateHaversineKm } from '../../utils/geo.js';
import { AppError } from '../../middleware/error.middleware.js';
import { orderRepository, type DBConnection } from './order.repository.js';
import { db } from '../../database/connection.js';
import { deliveryZonesService, pointInZones } from '../configuration/delivery-zones.js';

/**
 * The service-area check shared by checkout and the address book: the coordinates must lie within the
 * active dark store's radius_km OR inside an enabled extra delivery area (configuration/delivery-zones.ts,
 * e.g. Beruwala). Throws the same 422 DELIVERY_OUTSIDE_RADIUS in both places, so an address that saves is
 * an address that can order. details: { distance_km, max_radius_km } (from the store) plus
 * zones: [{ name, distance_km }] (from each enabled zone's centre; [] when none is on).
 */
export async function assertWithinServiceZone(latitude: number, longitude: number, executor: DBConnection = db) {
  const store = await orderRepository.findActiveDarkStore(executor);
  if (!store) {
    throw new AppError('No active dark store hub found.', 500, 'STORE_UNAVAILABLE');
  }

  const { isWithin, distanceKm } = isWithinDeliveryRadius(
    Number(store.latitude),
    Number(store.longitude),
    Number(latitude),
    Number(longitude),
    Number(store.radius_km)
  );

  if (!isWithin) {
    const zones = (await deliveryZonesService.read(executor)).filter((zone) => zone.enabled);
    if (!pointInZones(zones, Number(latitude), Number(longitude))) {
      throw new AppError(
        `Delivery address is outside our delivery area (${distanceKm} km from the store).`,
        422,
        'DELIVERY_OUTSIDE_RADIUS',
        {
          distance_km: distanceKm,
          max_radius_km: Number(store.radius_km),
          zones: zones.map((zone) => ({
            name: zone.name,
            distance_km: calculateHaversineKm(zone.lat, zone.lng, Number(latitude), Number(longitude)),
          })),
        }
      );
    }
  }
  return store;
}

/**
 * assertWithinServiceZone for the Google Play review customer (test orders, migration 068): when
 * `allowOutside` is true an address outside the zone is accepted instead of refused, and `outside` says so
 * (the caller then measures the delivery fee from the store itself, not from the far-away address). Anyone
 * else (allowOutside false) gets exactly assertWithinServiceZone.
 */
export async function checkServiceZone(
  latitude: number,
  longitude: number,
  allowOutside: boolean,
  executor: DBConnection = db
): Promise<{ store: NonNullable<Awaited<ReturnType<typeof orderRepository.findActiveDarkStore>>>; outside: boolean }> {
  try {
    return { store: await assertWithinServiceZone(latitude, longitude, executor), outside: false };
  } catch (err) {
    if (!allowOutside || !(err instanceof AppError) || err.code !== 'DELIVERY_OUTSIDE_RADIUS') throw err;
    const store = await orderRepository.findActiveDarkStore(executor);
    if (!store) throw err;
    return { store, outside: true };
  }
}
