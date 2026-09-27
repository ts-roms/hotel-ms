import { buttonVariants, CardContent } from '@hotel/ui';
import { ArrowRight, Mail } from 'lucide-react';
import Link from 'next/link';
import { GuestShell } from '@/components/guest-shell';

export default function HomePage() {
  return (
    <GuestShell
      title="My stay"
      description="Open the personal link from your booking email to see your stay."
    >
      <CardContent className="flex flex-col gap-4">
        <div className="flex items-center gap-3 rounded-xl bg-muted/60 p-3 text-sm text-muted-foreground">
          <Mail className="size-5 shrink-0 text-primary" />
          Look for an email with the subject “Your stay at” followed by the hotel name.
        </div>
        <div className="flex flex-col gap-2 text-center">
          <span className="text-xs text-muted-foreground">
            Already opened your link on this device?
          </span>
          <Link href="/stay" className={buttonVariants({ variant: 'outline' })}>
            Continue to my stay
            <ArrowRight />
          </Link>
        </div>
      </CardContent>
    </GuestShell>
  );
}
