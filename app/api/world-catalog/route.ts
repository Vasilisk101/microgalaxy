import { getChatGPTUser } from '@/app/chatgpt-auth';
import { catalogError, catalogResponse, listWorldCatalog } from '@/lib/world-catalog';

export const dynamic = 'force-dynamic';

/** Metadata-only unified catalogue. Intentionally no POST, PUT, PATCH or DELETE. */
export async function GET(request: Request) {
  try {
    const user = await getChatGPTUser();
    if (!user) return catalogResponse({ error: 'Войдите, чтобы открыть свои облачные миры.', code: 'unauthorized', user: null }, 401);
    const cursors = new URL(request.url).searchParams.getAll('cursor');
    if (cursors.length > 1) return catalogResponse({ error: 'Неверный указатель страницы общего архива.', code: 'invalid_cursor' }, 400);
    return catalogResponse({ ...await listWorldCatalog(user.userId, cursors[0]), user: { name: user.displayName } });
  } catch (error) { return catalogError(error); }
}
