/** @type {import('next').NextConfig} */
const API_ORIGIN = (process.env.API_ORIGIN || 'http://localhost:4000').replace(/\/+$/, '');
const REALTIME_URL = (process.env.NEXT_PUBLIC_REALTIME_URL || API_ORIGIN).replace(/\/+$/, '');

const csp = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://challenges.cloudflare.com",
  "frame-src https://challenges.cloudflare.com",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://*.tile.openstreetmap.org https://tile.openstreetmap.org https://lh3.googleusercontent.com",
  "worker-src 'self' blob:",
  "media-src 'self' blob:",
  `connect-src 'self' ${REALTIME_URL} ${REALTIME_URL.replace(/^http/, 'ws')} https://challenges.cloudflare.com https://*.tile.openstreetmap.org`,
  "font-src 'self' data:",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');

const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  transpilePackages: ['@campuscare/shared'],
  // The browser talks to the API through this origin, so session cookies stay first-party.
  async rewrites() {
    return [{ source: '/api/v1/:path*', destination: `${API_ORIGIN}/api/v1/:path*` }];
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'Content-Security-Policy', value: csp },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'geolocation=(self), camera=(), microphone=()' },
        ],
      },
    ];
  },
};

export default nextConfig;
