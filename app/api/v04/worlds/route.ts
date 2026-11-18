import {retentionProtocol,cloudLease,withCloudLease} from '@/lib/retention-cloud';
import { getChatGPTUser } from '@/app/chatgpt-auth';
import {
  createV04World, listV04Worlds, readV04MutationBody, v04Error, v04Response, v04WorldFromPayload,
} from '@/lib/world-v04-storage';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const user = await getChatGPTUser();
    if (!user) return v04Response({ error: 'Войдите, чтобы открыть свои сохранения.', code: 'unauthorized', user: null }, 401);
    const cursors = new URL(request.url).searchParams.getAll('cursor');
    if (cursors.length > 1) return v04Response({ error: 'Неверный указатель страницы архива.', code: 'invalid_cursor' }, 400);
    return v04Response({ ...await listV04Worlds(user.userId, cursors[0]), user: { name: user.displayName } });
  } catch (error) { return v04Error(error); }
}

export async function POST(request: Request) {
  try {
    const user = await getChatGPTUser();
    if (!user) return v04Response({ error: 'Войдите, чтобы сохранить мир.', code: 'unauthorized' }, 401);
    const protocol=retentionProtocol(request);if(protocol)return protocol;
    const body = await readV04MutationBody(request);
    const leaseVersion=await cloudLease(user.userId,'v04',v04WorldFromPayload(body).id,request.headers.get('x-microgalaxy-session')!);
    return withCloudLease(v04Response(await createV04World(user.userId, v04WorldFromPayload(body)), 201),leaseVersion);
  } catch (error) { return v04Error(error); }
}
