import {retentionProtocol,cloudLease,withCloudLease} from '@/lib/retention-cloud';
import { getChatGPTUser } from '@/app/chatgpt-auth';
import {
  createV06World, listV06Worlds, readV06MutationBody, v06Error, v06Response, v06WorldFromPayload,
} from '@/lib/world-v06-storage';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const user = await getChatGPTUser();
    if (!user) return v06Response({ error: 'Войдите, чтобы открыть свои сохранения.', code: 'unauthorized', user: null }, 401);
    const cursors = new URL(request.url).searchParams.getAll('cursor');
    if (cursors.length > 1) return v06Response({ error: 'Неверный указатель страницы архива.', code: 'invalid_cursor' }, 400);
    return v06Response({ ...await listV06Worlds(user.userId, cursors[0]), user: { name: user.displayName } });
  } catch (error) { return v06Error(error); }
}

export async function POST(request: Request) {
  try {
    const user = await getChatGPTUser();
    if (!user) return v06Response({ error: 'Войдите, чтобы сохранить мир.', code: 'unauthorized' }, 401);
    const protocol=retentionProtocol(request);if(protocol)return protocol;
    const body = await readV06MutationBody(request);
    const leaseVersion=await cloudLease(user.userId,'v06',v06WorldFromPayload(body).id,request.headers.get('x-microgalaxy-session')!);
    return withCloudLease(v06Response(await createV06World(user.userId, v06WorldFromPayload(body)), 201),leaseVersion);
  } catch (error) { return v06Error(error); }
}
