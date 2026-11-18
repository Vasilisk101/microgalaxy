import oldObservatory from '../simulator-v05/dist/MICROGALAXY-0.5.html?raw';
import observatory from '../simulator-v1/dist/MICROGALAXY-1.0.html?raw';

// Sites retains its existing owner-only access boundary. Save APIs additionally
// require the authenticated user's identity and authorize every world operation.
export function GET(request: Request) {
  const oldLink = new URL(request.url).searchParams.has('world');
  return new Response(oldLink ? oldObservatory : observatory, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'private, no-store, max-age=0',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'X-Microgalaxy-Version': oldLink ? '0.5.0' : '1.3.0',
    },
  });
}
