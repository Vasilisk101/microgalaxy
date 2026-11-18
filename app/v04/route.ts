import observatory from '../../simulator-v04/dist/MICROGALAXY-0.4.html?raw';

// Retain the original simulation and save namespace for existing 0.4 worlds.
export const dynamic = 'force-dynamic';

export function GET() {
  return new Response(observatory, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'private, no-store, max-age=0',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'X-Microgalaxy-Version': '0.4.0',
    },
  });
}
