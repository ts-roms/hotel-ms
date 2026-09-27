import path from 'node:path';
import type { NextConfig } from 'next';

// Server-side address of the API. Only the guest realm is proxied: staff endpoints are not
// reachable through the guest origin at all.
const API_ORIGIN = process.env.API_INTERNAL_ORIGIN ?? 'http://localhost:48100';

const securityHeaders = [
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  // The portal link carries its token in the fragment; never leak the URL onward.
  { key: 'Referrer-Policy', value: 'no-referrer' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
];

const nextConfig: NextConfig = {
  output: 'standalone',
  outputFileTracingRoot: path.join(import.meta.dirname, '../..'),
  poweredByHeader: false,
  async rewrites() {
    return [{ source: '/api/v1/guest/:path*', destination: `${API_ORIGIN}/api/v1/guest/:path*` }];
  },
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
};

export default nextConfig;
