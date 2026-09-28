import { Injectable, Logger } from '@nestjs/common';
import type { EmailTemplate } from '@hotel/contracts';
import type { Tx } from '@hotel/database';
import { ClsService } from 'nestjs-cls';
import { fromDbDate } from '../../common/dates.js';
import type { RequestContext } from '../../common/request-context.js';
import { TenantDb } from '../../infrastructure/database.js';
import { NotificationsQueue } from '../../infrastructure/queue.js';
import { NotificationsService } from './notifications.service.js';

interface Outgoing {
  email: (EmailTemplate & { to: string }) | null;
  sms: { to: string | null; text: string } | null;
}

const money = (minor: bigint, currency: string) =>
  new Intl.NumberFormat('en-PH', { style: 'currency', currency }).format(Number(minor) / 100);

/**
 * Messages to guests about their booking (spec §40, ADR-0024): confirmation, cancellation,
 * check-in welcome, payment received. Each is reserved once in the message log, then
 * queued after the business transaction commits; a messaging failure never fails the
 * booking itself.
 */
@Injectable()
export class GuestMessagesService {
  private readonly logger = new Logger(GuestMessagesService.name);

  constructor(
    private readonly db: TenantDb,
    private readonly notifications: NotificationsService,
    private readonly queue: NotificationsQueue,
    private readonly cls: ClsService<RequestContext>,
  ) {}

  private async send(
    dedupeKey: string,
    build: (tx: Tx) => Promise<Outgoing | null>,
  ): Promise<void> {
    try {
      const out = await this.db.run(async (tx) => {
        const message = await build(tx);
        if (!message) return null;
        return (await this.notifications.reserveMessage(tx, dedupeKey, 'EMAIL')) ? message : null;
      });
      if (!out) return;
      if (out.email) await this.queue.sendEmail(out.email);
      if (out.sms) await this.queue.sendSms(out.sms.to, out.sms.text);
    } catch (error) {
      this.logger.error(`Guest message ${dedupeKey} failed: ${String(error)}`);
    }
  }

  private async reservationFacts(tx: Tx, reservationId: string) {
    const r = await tx.reservation.findUnique({
      where: { id: reservationId },
      include: {
        booker: true,
        property: { select: { name: true, checkInTime: true, checkOutTime: true } },
        rooms: { select: { arrivalDate: true, departureDate: true, status: true } },
      },
    });
    if (!r) return null;
    const dates = r.rooms.map((l) => [fromDbDate(l.arrivalDate), fromDbDate(l.departureDate)]);
    return {
      r,
      arrival: dates.map((d) => d[0]!).sort()[0]!,
      departure: dates
        .map((d) => d[1]!)
        .sort()
        .at(-1)!,
    };
  }

  bookingConfirmed(reservationId: string): Promise<void> {
    return this.send(`booking-confirmation:${reservationId}`, async (tx) => {
      const facts = await this.reservationFacts(tx, reservationId);
      if (!facts) return null;
      const { r, arrival, departure } = facts;
      return {
        email: r.booker.email
          ? {
              template: 'booking-confirmation',
              to: r.booker.email,
              data: {
                guestName: r.booker.firstName,
                propertyName: r.property.name,
                confirmationNo: r.confirmationNo,
                arrivalDate: arrival,
                departureDate: departure,
                rooms: r.rooms.length,
              },
            }
          : null,
        sms: {
          to: r.booker.phone,
          text: `${r.property.name}: booking ${r.confirmationNo} confirmed, ${arrival} to ${departure}.`,
        },
      };
    });
  }

  /** Only when the whole reservation is cancelled. */
  bookingCancelled(reservationId: string): Promise<void> {
    return this.send(`booking-cancelled:${reservationId}`, async (tx) => {
      const facts = await this.reservationFacts(tx, reservationId);
      if (!facts || facts.r.status !== 'CANCELLED') return null;
      const { r } = facts;
      return {
        email: r.booker.email
          ? {
              template: 'booking-cancelled',
              to: r.booker.email,
              data: {
                guestName: r.booker.firstName,
                propertyName: r.property.name,
                confirmationNo: r.confirmationNo,
              },
            }
          : null,
        sms: {
          to: r.booker.phone,
          text: `${r.property.name}: booking ${r.confirmationNo} cancelled.`,
        },
      };
    });
  }

  checkedIn(reservationRoomId: string): Promise<void> {
    return this.send(`checked-in:${reservationRoomId}`, async (tx) => {
      const line = await tx.reservationRoom.findUnique({
        where: { id: reservationRoomId },
        include: {
          guest: true,
          reservation: {
            include: {
              booker: true,
              property: { select: { name: true, checkOutTime: true } },
            },
          },
          assignments: {
            where: { releasedAt: null, kind: 'RESERVATION' },
            include: { room: { select: { number: true } } },
          },
        },
      });
      const to = line?.guest.email ?? line?.reservation.booker.email;
      if (!line || !to || !line.assignments[0]) return null;
      return {
        email: {
          template: 'checked-in',
          to,
          data: {
            guestName: line.guest.firstName,
            propertyName: line.reservation.property.name,
            roomNumber: line.assignments[0].room.number,
            departureDate: fromDbDate(line.departureDate),
            checkOutTime: line.reservation.property.checkOutTime,
          },
        },
        sms: null,
      };
    });
  }

  paymentReceived(paymentId: string): Promise<void> {
    return this.send(`payment-received:${paymentId}`, async (tx) => {
      const payment = await tx.payment.findUnique({
        where: { id: paymentId },
        include: {
          folio: {
            include: {
              reservationRoom: { include: { reservation: { include: { booker: true } } } },
            },
          },
        },
      });
      const booker = payment?.folio.reservationRoom?.reservation.booker;
      if (!payment || !booker?.email) return null;
      const property = await tx.property.findUniqueOrThrow({
        where: { id: payment.propertyId },
        select: { name: true },
      });
      return {
        email: {
          template: 'payment-received',
          to: booker.email,
          data: {
            guestName: booker.firstName,
            propertyName: property.name,
            amount: money(payment.amountMinor, payment.currency),
            folioNo: payment.folio.folioNo,
            reference: payment.reference ?? payment.id.slice(0, 8),
          },
        },
        sms: null,
      };
    });
  }
}
