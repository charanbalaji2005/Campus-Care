import Link from 'next/link';
import { Button } from '@/components/ui/primitives';

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center p-6 text-center">
      <div className="mx-auto max-w-md space-y-4">
        <span className="inline-block rounded-full bg-brand-50 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-brand-700">
          404 Not Found
        </span>
        <h1 className="text-3xl font-bold tracking-tight text-ink-strong">Page not found</h1>
        <p className="text-sm text-ink-soft">
          The requested page could not be found or has moved. If you are looking for student services, please use the CampusCare mobile app.
        </p>
        <div className="pt-2">
          <Button asChild>
            <Link href="/">Return Home</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
