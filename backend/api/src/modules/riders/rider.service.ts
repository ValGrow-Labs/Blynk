import { riderRepository } from './rider.repository.js';
import { AppError } from '../../middleware/error.middleware.js';
import type { RiderDeliveryStatus } from './rider.schema.js';
import { runTransition } from '../orders/lifecycle/engine.js';
import type { ActionName } from '../orders/lifecycle/catalogue.js';
import type { CodSettlement } from '../orders/lifecycle/settlement.js';
import type { Actor } from '../orders/lifecycle/types.js';

const RIDER_STEP: Record<RiderDeliveryStatus, ActionName> = {
  PICKED_UP: 'RIDER_PICKUP',
  ARRIVED_AT_CUSTOMER: 'RIDER_ARRIVE',
  FAILED: 'RIDER_FAIL',
};

/**
 * Who may be doing rider work: a RIDER, or the Operations app's ADMIN
 * operator (operations plan §2, §7). The role is carried through to the
 * lifecycle engine as the caller's *real* role, so the engine's own role
 * check stays a genuine second gate rather than a fabricated 'RIDER'.
 * The rider *identity* is never taken from here - it is always looked up
 * from the authenticated user's own riders row below.
 */
export class RiderService {
  private async getRiderOrThrow(userId: string) {
    const rider = await riderRepository.findRiderByUserId(userId);
    if (!rider) {
      throw new AppError('Rider profile not found for this user account.', 403, 'RIDER_PROFILE_NOT_FOUND');
    }
    if (!rider.is_active) {
      throw new AppError('This rider profile is inactive.', 403, 'RIDER_INACTIVE');
    }
    return rider;
  }

  async getActiveDeliveries(userId: string) {
    const rider = await this.getRiderOrThrow(userId);
    return await riderRepository.findActiveDeliveries(rider.id);
  }

  async getDeliveryById(deliveryId: string, userId: string) {
    const rider = await this.getRiderOrThrow(userId);
    const delivery = await riderRepository.findDeliveryById(deliveryId, rider.id);
    if (!delivery) {
      throw new AppError('Delivery assignment not found.', 404, 'DELIVERY_NOT_FOUND');
    }
    return delivery;
  }

  /**
   * Rider steps are lifecycle actions (#6 RIDER_PICKUP, #7 RIDER_ARRIVE,
   * #8 RIDER_FAIL): ownership, state and precedence are checked under the
   * delivery -> order locks.
   */
  async updateDeliveryStatus(
    deliveryId: string,
    actor: Actor,
    newStatus: RiderDeliveryStatus,
    failureReason?: string
  ) {
    const rider = await this.getRiderOrThrow(actor.id);
    await runTransition(RIDER_STEP[newStatus], {
      actor,
      deliveryId,
      riderId: rider.id,
      input: { failure_reason: failureReason },
    });
    return await riderRepository.findDeliveryById(deliveryId, rider.id);
  }

  /** Lifecycle #9 RIDER_COLLECT_COD, settled by the shared COD settlement. */
  async collectCod(deliveryId: string, actor: Actor, amount: number) {
    const rider = await this.getRiderOrThrow(actor.id);
    return await runTransition<CodSettlement>('RIDER_COLLECT_COD', {
      actor,
      deliveryId,
      riderId: rider.id,
      input: { amount },
    });
  }
}

export const riderService = new RiderService();
