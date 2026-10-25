import type { Metadata, Viewport } from 'next';
import { Suspense } from 'react';
import { GeistSans } from 'geist/font/sans';
import { GeistMono } from 'geist/font/mono';
import './globals.css';
import { Providers } from '@/components/providers';

export const metadata: Metadata = {
  title: { default: 'CampusCare', template: '%s · CampusCare' },
  description: 'University campus safety, incident reporting, grievance and counselling support.',
  robots: { index: false, follow: false },
};

export const viewport: Viewport = { themeColor: '#064E3B', width: 'device-width', initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <body>
        <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:rounded-lg focus:bg-white focus:px-4 focus:py-2 focus:shadow-lift">Skip to content</a>
        <Providers><Suspense>{children}</Suspense></Providers>
      </body>
    </html>
  );
}
