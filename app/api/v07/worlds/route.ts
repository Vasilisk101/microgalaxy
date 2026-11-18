import {retentionProtocol,cloudLease,withCloudLease} from '@/lib/retention-cloud';
import { getChatGPTUser } from '@/app/chatgpt-auth';
import {
  createV07World, listV07Worlds, readV07MutationBody, v07Error, v07Response, v07WorldFromPayload,
} from '@/lib/world-v07-storage';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const user = await getChatGPTUser();
    if (!user) return v07Response({ error: 'Войдите, чтобы открыть свои сохранения.', code: 'unauthorized', user: null }, 401);
    const cursors = new URL(request.url).searchParams.getAll('cursor');
    if (cursors.length > 1) return v07Response({ error: 'Неверный указатель страницы архива.', code: 'invalid_cursor' }, 400);
    return v07Response({ ...await listV07Worlds(user.userId, cursors[0]), user: { name: user.displayName } });
  } catch (error) { return v07Error(error); }
}

export async function POST(request: Request) {
  try {
    const user = await getChatGPTUser();
    if (!user) return v07Response({ error: 'Войдите, чтобы сохранить мир.', code: 'unauthorized' }, 401);
    const protocol=retentionProtocol(request);if(protocol)return protocol;
    const body = await readV07MutationBody(request);
    const leaseVersion=await cloudLease(user.userId,'v07',v07WorldFromPayload(body).id,request.headers.get('x-microgalaxy-session')!);
    return withCloudLease(v07Response(await createV07World(user.userId, v07WorldFromPayload(body)), 201),leaseVersion);
  } catch (error) { return v07Error(error); }
}
