import observatory from '../../simulator-v03/dist/MICROGALAXY-0.3.html?raw';

// The 0.3 engine and its local/cloud saves are deliberately retained unchanged.
// Opening a new release must never rewrite an existing world's history.
export function GET() {
  return new Response(observatory, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'private, no-store, max-age=0',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'X-Microgalaxy-Version': '0.3.0',
    },
  });
}
