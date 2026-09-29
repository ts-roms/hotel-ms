import { type BOOKING_SOURCES } from '@hotel/contracts';

/** The new-reservation form's values, owned by the page. */
export type ReservationFormValues = {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  roomTypeId: string;
  ratePlanId: string;
  arrivalDate: string;
  departureDate: string;
  adults: number;
  children: number;
  source: (typeof BOOKING_SOURCES)[number];
  specialRequests: string;
};

/** Sets one field of the form. */
export type SetReservationField = <K extends keyof ReservationFormValues>(
  key: K,
  value: ReservationFormValues[K],
) => void;
