/**
 * Guest portal (apps/guest) catalog. UI strings live in catalogs, not in components
 * (spec §54). `{name}` placeholders are filled by `t(key, { name })`.
 */
import { createTranslator } from './translator.js';

export const en = {
  'app.name': 'My stay',
  'app.description': 'Your booking, online check-in and requests during your stay.',

  'error.generic': 'Something went wrong. Please try again.',
  'error.INVALID_TOKEN': 'This link is no longer valid. Ask the hotel to send you a new one.',
  'error.UNAUTHENTICATED': 'Your session has ended. Open the link from your email again.',
  'error.INVALID_MFA_CODE': 'That code did not work. Check the latest email and try again.',
  'error.RATE_LIMITED': 'Too many attempts. Wait a few minutes and try again.',

  'home.description': 'Open the personal link from your booking email to see your stay.',
  'home.emailHint':
    'Look for an email with the subject “Your stay at” followed by the hotel name.',
  'home.alreadyOpened': 'Already opened your link on this device?',
  'home.continue': 'Continue to my stay',

  'welcome.title': 'Welcome',
  'welcome.incomplete': 'This link is incomplete. Open it again from your email.',
  'welcome.back': 'Back',
  'welcome.opening': 'Opening your booking…',

  'stay.loading': 'Loading your stay…',
  'stay.signedOut': 'Your session has ended. Open the link from your booking email again.',
  'stay.howToGetLink': 'How do I get my link?',
  'stay.status.RESERVED': 'Confirmed',
  'stay.status.IN_HOUSE': 'Checked in',
  'stay.status.CHECKED_OUT': 'Checked out',
  'stay.status.CANCELLED': 'Cancelled',
  'stay.status.NO_SHOW': 'No-show',
  'stay.adults.one': '{count} adult',
  'stay.adults.other': '{count} adults',
  'stay.children.one': '{count} child',
  'stay.children.other': '{count} children',
  'stay.hello': 'Hello, {name}',
  'stay.room': 'Room {number}',
  'stay.checkIn': 'Check-in',
  'stay.checkInFrom': 'from {time}',
  'stay.checkOut': 'Check-out',
  'stay.checkOutBy': 'by {time}',
  'stay.roomType': 'Room type',
  'stay.guests': 'Guests',
  'stay.booking': 'Booking {number}',

  'verify.noEmail':
    'We have no email address for this booking, so online check-in and requests are not available. The front desk will be happy to help.',
  'verify.title': 'Confirm it is you',
  'verify.description':
    'To check in online, see your bill or send requests, enter the code we email to {destination}.',
  'verify.emailCode': 'Email me a code',
  'verify.code': '6-digit code',
  'verify.confirm': 'Confirm',
  'verify.resend': 'Send a new code',

  'preCheckIn.thanks': 'Thanks! We expect you around {time}.',
  'preCheckIn.change': 'Change',
  'preCheckIn.title': 'Before you arrive',
  'preCheckIn.description': 'Help us prepare for your arrival.',
  'preCheckIn.arrival': 'Expected arrival time',
  'preCheckIn.phone': 'Mobile number (optional)',
  'preCheckIn.requests': 'Special requests (optional)',
  'preCheckIn.save': 'Save',

  'checkIn.done': 'You are checked in to room {room}',
  'checkIn.title': 'Check in online',
  'checkIn.description':
    'Skip the queue: we assign your room now and tell you how to get your key.',
  'checkIn.verifyFirst': 'Confirm it is you first (above) to check in online.',
  'checkIn.cardHold': 'Card hold for incidentals: {amount}',
  'checkIn.authorized': 'Authorized',
  'checkIn.holdHint':
    'The amount is reserved on your card, not charged. You only pay for what you use; the rest is released after check-out.',
  'checkIn.declined': 'Your card was declined. Try again or use another card.',
  'checkIn.authorizeHold': 'Authorize card hold',
  'checkIn.now': 'Check in now',

  'requests.title': 'Need anything?',
  'requests.request': 'Request',
  'requests.details': 'Details (optional)',
  'requests.send': 'Send request',
  'requests.loading': 'Loading your requests…',
  'requests.rated': 'You rated this {rating}/5. Thank you!',
  'requests.howDidWeDo': 'How did we do?',
  'requests.rate': 'Rate this request',
  'requests.stars': '{count} out of 5',
  'requests.category.TOWELS': 'Towels',
  'requests.category.TOILETRIES': 'Toiletries',
  'requests.category.PILLOWS_BLANKETS': 'Pillows & blankets',
  'requests.category.CLEANING': 'Room cleaning',
  'requests.category.MAINTENANCE': 'Something is broken',
  'requests.category.LAUNDRY': 'Laundry',
  'requests.category.TRANSPORT': 'Transport',
  'requests.category.LUGGAGE': 'Luggage help',
  'requests.category.WAKE_UP_CALL': 'Wake-up call',
  'requests.category.OTHER': 'Something else',
  'requests.category.CHECKOUT': 'Checkout',
  'requests.status.OPEN': 'Sent',
  'requests.status.ACKNOWLEDGED': 'Seen by staff',
  'requests.status.IN_PROGRESS': 'On its way',
  'requests.status.DONE': 'Done',
  'requests.status.CANCELLED': 'Cancelled',

  'bill.title': 'Your bill',
  'bill.empty': 'No charges yet.',
  'bill.balance': 'Balance',
  'bill.paid': 'Thank you, your payment was received.',
  'bill.failed': 'The payment did not go through. You can try again.',
  'bill.pay': 'Pay {amount} now',

  'events.title': "What's on",

  'contact.signOut': 'Sign out on this device',
  'contact.signedOut': 'Signed out. Your email link still works to sign back in.',

  'time.justNow': 'just now',
  'time.minutesAgo': '{count} min ago',
  'time.hoursAgo': '{count} h ago',

  'notifications.title': 'Updates',
  'notifications.new': '{count} new',
  'notifications.showAll': 'Show all {count}',
  'notifications.markAllRead': 'Mark all as read',

  'id.type.PASSPORT': 'Passport',
  'id.type.DRIVERS_LICENSE': "Driver's license",
  'id.type.NATIONAL_ID': 'National ID',
  'id.type.OTHER': 'Other government ID',
  'id.approvedTitle': 'ID approved',
  'id.approvedDescription': 'Your {type} was checked by the front desk.',
  'id.title': 'Your ID',
  'id.required': 'The hotel checks an ID before online check-in. Upload a clear photo of it.',
  'id.optional': 'Save time at the front desk: upload a clear photo of your ID.',
  'id.pending': 'Uploaded. The front desk will check it shortly.',
  'id.rejected': 'The front desk asked for another photo.',
  'id.rejectedWithReason': 'The front desk asked for another photo: {reason}',
  'id.typeLabel': 'Type of ID',
  'id.photo': 'ID photo',
  'id.upload': 'Upload a photo',
  'id.uploadNew': 'Upload a new photo',
  'id.hint':
    'JPEG, PNG, WebP or PDF, up to 8 MB. Only the front desk sees it, and it is deleted 30 days after your stay.',

  'info.title': 'About {name}',
  'info.wifiPassword': 'Password:',
  'info.houseRules': 'House rules',

  'checkout.requestedTitle': 'Checkout requested',
  'checkout.requestedDescription':
    'The front desk is preparing your bill. Drop by the front desk with your key when you leave.',
  'checkout.title': 'Ready to leave?',
  'checkout.description':
    'Check-out is by {time}. Let the front desk know and they will have your bill ready.',
  'checkout.time': 'Leaving at (optional)',
  'checkout.note': 'Anything we should know? (optional)',
  'checkout.notePlaceholder': 'e.g. please call a taxi',
  'checkout.submit': 'Request checkout',

  'roomService.open': 'Open',
  'roomService.closed': 'Closed',
  'roomService.closedNotice': 'Room service is closed right now.',
  'roomService.add': 'Add {item}',
  'roomService.yourOrder': 'Your order',
  'roomService.less': 'One less',
  'roomService.more': 'One more',
  'roomService.payment': 'Payment',
  'roomService.roomCharge': 'Charge to my room',
  'roomService.payOnDelivery': 'Pay on delivery',
  'roomService.order': 'Order',
  'roomService.yourOrders': 'Your orders',
  'roomService.cancel': 'Cancel',
  'roomService.status.PENDING': 'Sent to the kitchen',
  'roomService.status.CONFIRMED': 'Accepted',
  'roomService.status.PREPARING': 'Being prepared',
  'roomService.status.READY': 'Ready',
  'roomService.status.OUT_FOR_DELIVERY': 'On its way',
  'roomService.status.DELIVERED': 'Delivered',
  'roomService.status.CANCELLED': 'Cancelled',
} as const;

export type MessageKey = keyof typeof en;

export const t = createTranslator(en);
