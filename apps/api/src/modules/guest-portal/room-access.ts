import type { RoomAccess } from '@hotel/contracts';

/**
 * Room access integration point (spec §25). The PMS never talks to lock hardware
 * directly; a provider per property (smart lock vendor, mobile key, PIN) implements this.
 */
export interface RoomAccessProvider {
  readonly code: string;
  createAccess(input: {
    propertyId: string;
    roomNumber: string;
    stayId: string;
    validFrom: Date;
    validTo: Date;
    guestName: string;
  }): Promise<RoomAccess>;
  revokeAccess(stayId: string): Promise<void>;
}

/**
 * Default provider: physical key cards issued at the front desk. Nothing to integrate;
 * the guest is told where to collect the key.
 */
export class FrontDeskKeyProvider implements RoomAccessProvider {
  readonly code = 'front-desk-key';

  async createAccess(input: { roomNumber: string }): Promise<RoomAccess> {
    return {
      method: 'FRONT_DESK_KEY',
      instructions: `You are checked in to room ${input.roomNumber}. Collect your key card at the front desk; show this screen and a photo ID.`,
    };
  }

  async revokeAccess(): Promise<void> {
    // Key cards are collected or expire at the lock; nothing to call.
  }
}

export const ROOM_ACCESS_PROVIDER = Symbol('ROOM_ACCESS_PROVIDER');
