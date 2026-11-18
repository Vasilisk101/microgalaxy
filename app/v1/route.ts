import observatory from '../../simulator-v1/dist/MICROGALAXY-1.0.html?raw';

export const dynamic = 'force-dynamic';
export function GET() {
  return new Response(observatory, { headers: {
    'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'private, no-store, max-age=0',
    'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'X-Microgalaxy-Version': '1.1.0',
  } });
}
