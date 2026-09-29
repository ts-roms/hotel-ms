import type { ReactNode } from 'react';
import { AuthBackdrop } from '@/components/auth-shell';

/**
 * Sign-in screens: login, the MFA step, password recovery, invitations and organization
 * selection. The group adds no URL segment; it only shares the backdrop. Each page renders its
 * own `AuthCard` because the title and description differ per step.
 */
export default function AuthLayout({ children }: { children: ReactNode }) {
  return <AuthBackdrop>{children}</AuthBackdrop>;
}
