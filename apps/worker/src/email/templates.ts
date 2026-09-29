import type { EmailTemplate } from '@hotel/contracts';
import { escapeHtml } from '@hotel/format';

export interface RenderedEmail {
  subject: string;
  text: string;
  html: string;
}

function layout(paragraphs: string[], action?: { label: string; url: string }): string {
  const body = paragraphs.map((p) => `<p style="margin:0 0 16px">${escapeHtml(p)}</p>`).join('');
  const button = action
    ? `<p style="margin:24px 0"><a href="${escapeHtml(action.url)}" style="background:#1d4ed8;color:#fff;padding:12px 20px;border-radius:6px;text-decoration:none;display:inline-block">${escapeHtml(action.label)}</a></p>`
    : '';
  return `<!doctype html><html><body style="font-family:system-ui,sans-serif;font-size:15px;line-height:1.5;color:#111;max-width:560px;margin:0 auto;padding:24px">${body}${button}</body></html>`;
}

/**
 * English templates. Plain text is always included for clients that block HTML. Other
 * locales plug in here by `job.locale` when they are added.
 */
export function renderEmail(email: EmailTemplate): RenderedEmail {
  switch (email.template) {
    case 'password-reset': {
      const { displayName, resetUrl, expiresInMinutes } = email.data;
      const lines = [
        `Hello ${displayName},`,
        `We received a request to reset your password. The link works once and expires in ${expiresInMinutes} minutes.`,
        'If you did not ask for this, ignore this email; your password stays the same.',
      ];
      return {
        subject: 'Reset your password',
        text: `${lines[0]}\n\n${lines[1]}\n\n${resetUrl}\n\n${lines[2]}\n`,
        html: layout(lines, { label: 'Reset password', url: resetUrl }),
      };
    }
    case 'password-changed': {
      const lines = [
        `Hello ${email.data.displayName},`,
        'Your password was just changed and your other sessions were signed out.',
        'If this was not you, reset your password immediately and contact your administrator.',
      ];
      return {
        subject: 'Your password was changed',
        text: lines.join('\n\n') + '\n',
        html: layout(lines),
      };
    }
    case 'member-invitation': {
      const { displayName, organizationName, inviterName, acceptUrl, expiresInDays } = email.data;
      const lines = [
        `Hello ${displayName},`,
        `${inviterName} invited you to join ${organizationName} on Hotel Platform.`,
        `The invitation expires in ${expiresInDays} days.`,
      ];
      return {
        subject: `You're invited to ${organizationName}`,
        text: `${lines.join('\n\n')}\n\n${acceptUrl}\n`,
        html: layout(lines, { label: 'Accept invitation', url: acceptUrl }),
      };
    }
    case 'mfa-enabled': {
      const lines = [
        `Hello ${email.data.displayName},`,
        'Two-step verification is now on for your account. Other sessions were signed out.',
        'If this was not you, contact your administrator immediately.',
      ];
      return {
        subject: 'Two-step verification enabled',
        text: lines.join('\n\n') + '\n',
        html: layout(lines),
      };
    }
    case 'mfa-disabled': {
      const lines = [
        `Hello ${email.data.displayName},`,
        'Two-step verification was turned off for your account.',
        'If this was not you, reset your password and contact your administrator immediately.',
      ];
      return {
        subject: 'Two-step verification disabled',
        text: lines.join('\n\n') + '\n',
        html: layout(lines),
      };
    }
    case 'guest-portal-link': {
      const { guestName, propertyName, portalUrl, arrivalDate } = email.data;
      const lines = [
        `Hello ${guestName},`,
        `We look forward to welcoming you at ${propertyName} on ${arrivalDate}.`,
        'Use your personal link to see your booking, tell us when you will arrive and, where offered, check in online. Do not forward this email: the link opens your booking.',
      ];
      return {
        subject: `Your stay at ${propertyName}`,
        text: `${lines.join('\n\n')}\n\n${portalUrl}\n`,
        html: layout(lines, { label: 'Open my booking', url: portalUrl }),
      };
    }
    case 'guest-verification-code': {
      const { propertyName, code, expiresInMinutes } = email.data;
      const lines = [
        `Your ${propertyName} verification code is ${code}.`,
        `It expires in ${expiresInMinutes} minutes. If you did not ask for it, you can ignore this email.`,
      ];
      return {
        subject: `${code} is your ${propertyName} code`,
        text: lines.join('\n\n') + '\n',
        html: layout(lines),
      };
    }
    case 'schedule-published': {
      const { employeeName, propertyName, from, to, shifts, scheduleUrl } = email.data;
      const lines = [
        `Hello ${employeeName},`,
        `Your ${propertyName} schedule for ${from} to ${to} is out:`,
        ...shifts.map((s) => `${s.date}: ${s.startTime}–${s.endTime}`),
      ];
      return {
        subject: `Your schedule at ${propertyName}, ${from} to ${to}`,
        text: `${lines.join('\n')}\n\n${scheduleUrl}\n`,
        html: layout(lines, { label: 'Open my schedule', url: scheduleUrl }),
      };
    }
    case 'booking-confirmation': {
      const { guestName, propertyName, confirmationNo, arrivalDate, departureDate, rooms } =
        email.data;
      const lines = [
        `Hello ${guestName},`,
        `Thank you for booking ${propertyName}. Your confirmation number is ${confirmationNo}.`,
        `Arrival ${arrivalDate}, departure ${departureDate}, ${rooms} room${rooms === 1 ? '' : 's'}.`,
        'We will send you a link to check in online before you arrive.',
      ];
      return {
        subject: `Booking confirmed: ${confirmationNo}`,
        text: lines.join('\n\n') + '\n',
        html: layout(lines),
      };
    }
    case 'booking-cancelled': {
      const { guestName, propertyName, confirmationNo } = email.data;
      const lines = [
        `Hello ${guestName},`,
        `Your booking ${confirmationNo} at ${propertyName} has been cancelled.`,
        'If you did not expect this, please contact the hotel.',
      ];
      return {
        subject: `Booking cancelled: ${confirmationNo}`,
        text: lines.join('\n\n') + '\n',
        html: layout(lines),
      };
    }
    case 'checked-in': {
      const { guestName, propertyName, roomNumber, departureDate, checkOutTime } = email.data;
      const lines = [
        `Welcome to ${propertyName}, ${guestName}.`,
        `You are in room ${roomNumber}. Check-out is on ${departureDate} by ${checkOutTime}.`,
        'Ask the front desk, or use your guest portal, for anything you need.',
      ];
      return {
        subject: `Welcome to ${propertyName}`,
        text: lines.join('\n\n') + '\n',
        html: layout(lines),
      };
    }
    case 'checkin-reminder': {
      const { guestName, propertyName, arrivalDate, checkInTime, portalUrl } = email.data;
      const lines = [
        `Hello ${guestName},`,
        `We look forward to seeing you at ${propertyName} on ${arrivalDate}. Check-in starts at ${checkInTime}.`,
        'Save time at the desk: tell us when you will arrive and, where offered, check in online. Do not forward this email: the link opens your booking.',
      ];
      return {
        subject: `See you tomorrow at ${propertyName}`,
        text: `${lines.join('\n\n')}\n\n${portalUrl}\n`,
        html: layout(lines, { label: 'Check in online', url: portalUrl }),
      };
    }
    case 'checkout-reminder': {
      const { guestName, propertyName, checkOutTime, roomNumber } = email.data;
      const lines = [
        `Good morning ${guestName},`,
        `A reminder that check-out from room ${roomNumber} at ${propertyName} is today by ${checkOutTime}.`,
        'Your bill is in your guest portal. We hope you enjoyed your stay.',
      ];
      return {
        subject: `Check-out today at ${propertyName}`,
        text: lines.join('\n\n') + '\n',
        html: layout(lines),
      };
    }
    case 'payment-received': {
      const { guestName, propertyName, amount, folioNo, reference } = email.data;
      const lines = [
        `Hello ${guestName},`,
        `We received your payment of ${amount} for folio ${folioNo} at ${propertyName}.`,
        `Reference: ${reference}. This email is not an official receipt; ask the front desk for one.`,
      ];
      return {
        subject: `Payment received: ${amount}`,
        text: lines.join('\n\n') + '\n',
        html: layout(lines),
      };
    }
    case 'leave-decided': {
      const { employeeName, leaveTypeName, startDate, endDate, decision, note } = email.data;
      const verdict = decision === 'APPROVED' ? 'approved' : 'not approved';
      const lines = [
        `Hello ${employeeName},`,
        `Your ${leaveTypeName} request for ${startDate} to ${endDate} was ${verdict}.`,
        ...(note ? [`Note: ${note}`] : []),
      ];
      return {
        subject: `Leave ${verdict}: ${startDate} to ${endDate}`,
        text: lines.join('\n\n') + '\n',
        html: layout(lines),
      };
    }
  }
}
