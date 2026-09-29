import { redirect } from 'next/navigation';

/** /settings has no page of its own: the member's settings start with security. */
export default function SettingsIndex() {
  redirect('/settings/security');
}
