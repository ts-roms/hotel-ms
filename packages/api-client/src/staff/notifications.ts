import type { NotificationList } from '@hotel/contracts';
import * as op from '../generated/operations.js';
import { data, type Transport } from '../http.js';

/** The signed-in staff member's in-app notifications (part of the `me` group). */
export function notificationsClient({ call }: Transport) {
  return {
    me: {
      notifications: (unread = false) =>
        op
          .NotificationsController_list<NotificationList>(call, unread ? { unread: 'true' } : {})
          .then(data),
      readNotification: (notificationId: string) =>
        op.NotificationsController_read(call, { notificationId }).then(data),
      readAllNotifications: () => op.NotificationsController_readAll(call).then(data),
    },
  };
}
