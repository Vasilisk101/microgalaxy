import {retentionProtocol,cloudLease,withCloudLease} from '@/lib/retention-cloud';
import { getChatGPTUser } from '@/app/chatgpt-auth';
import {
  createV03World, listV03Worlds, readV03MutationBody, v03Error, v03Response, v03WorldFromPayload,
} from '@/lib/world-v03-storage';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const user = await getChatGPTUser();
    if (!user) return v03Response({ error: 'Войдите, чтобы открыть свои сохранения.', code: 'unauthorized', user: null }, 401);
    const cursors = new URL(request.url).searchParams.getAll('cursor');
    if (cursors.length > 1) return v03Response({ error: 'Неверный указатель страницы архива.', code: 'invalid_cursor' }, 400);
    return v03Response({ ...await listV03Worlds(user.userId, cursors[0]), user: { name: user.displayName } });
  } catch (error) { return v03Error(error); }
}

export async function POST(request: Request) {
  try {
    const user = await getChatGPTUser();
    if (!user) return v03Response({ error: 'Войдите, чтобы сохранить мир.', code: 'unauthorized' }, 401);
    const protocol=retentionProtocol(request);if(protocol)return protocol;
    const body = await readV03MutationBody(request);
    const leaseVersion=await cloudLease(user.userId,'v03',v03WorldFromPayload(body).id,request.headers.get('x-microgalaxy-session')!);
    return withCloudLease(v03Response(await createV03World(user.userId, v03WorldFromPayload(body)), 201),leaseVersion);
  } catch (error) { return v03Error(error); }
}
