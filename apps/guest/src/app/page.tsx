import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@hotel/ui';
import Link from 'next/link';

export default function HomePage() {
  return (
    <main className="flex min-h-dvh items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>My stay</CardTitle>
          <CardDescription>
            Open the personal link from your booking email to see your stay.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Link href="/stay" className="text-sm text-primary underline">
            Already opened your link on this device? Continue to your stay
          </Link>
        </CardContent>
      </Card>
    </main>
  );
}
