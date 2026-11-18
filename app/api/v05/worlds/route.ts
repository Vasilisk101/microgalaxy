import {retentionProtocol,cloudLease,withCloudLease} from '@/lib/retention-cloud';
import { getChatGPTUser } from '@/app/chatgpt-auth';
import {
  createV05World, listV05Worlds, readV05MutationBody, v05Error, v05Response, v05WorldFromPayload,
} from '@/lib/world-v05-storage';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const user = await getChatGPTUser();
    if (!user) return v05Response({ error: 'Войдите, чтобы открыть свои сохранения.', code: 'unauthorized', user: null }, 401);
    const cursors = new URL(request.url).searchParams.getAll('cursor');
    if (cursors.length > 1) return v05Response({ error: 'Неверный указатель страницы архива.', code: 'invalid_cursor' }, 400);
    return v05Response({ ...await listV05Worlds(user.userId, cursors[0]), user: { name: user.displayName } });
  } catch (error) { return v05Error(error); }
}

export async function POST(request: Request) {
  try {
    const user = await getChatGPTUser();
    if (!user) return v05Response({ error: 'Войдите, чтобы сохранить мир.', code: 'unauthorized' }, 401);
    const protocol=retentionProtocol(request);if(protocol)return protocol;
    const body = await readV05MutationBody(request);
    const leaseVersion=await cloudLease(user.userId,'v05',v05WorldFromPayload(body).id,request.headers.get('x-microgalaxy-session')!);
    return withCloudLease(v05Response(await createV05World(user.userId, v05WorldFromPayload(body)), 201),leaseVersion);
  } catch (error) { return v05Error(error); }
}
