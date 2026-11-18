import {retentionProtocol,cloudLease,withCloudLease} from '@/lib/retention-cloud';
import { getChatGPTUser } from '@/app/chatgpt-auth';
import {
  create, list, readMutationBody, archiveError, archiveResponse, worldFromPayload,
} from '@/lib/world-v1-storage';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const user = await getChatGPTUser();
    if (!user) return archiveResponse({ error: 'Войдите, чтобы открыть свои сохранения.', code: 'unauthorized', user: null }, 401);
    const cursors = new URL(request.url).searchParams.getAll('cursor');
    if (cursors.length > 1) return archiveResponse({ error: 'Неверный указатель страницы архива.', code: 'invalid_cursor' }, 400);
    return archiveResponse({ ...await list(user.userId, cursors[0]), user: { name: user.displayName } });
  } catch (error) { return archiveError(error); }
}

export async function POST(request: Request) {
  try {
    const user = await getChatGPTUser();
    if (!user) return archiveResponse({ error: 'Войдите, чтобы сохранить мир.', code: 'unauthorized' }, 401);
    const protocol=retentionProtocol(request);if(protocol)return protocol;
    const body = await readMutationBody(request);
    const world = worldFromPayload(body);
    const leaseVersion=await cloudLease(user.userId,'v1',world.id,request.headers.get('x-microgalaxy-session')!);
    return withCloudLease(archiveResponse(await create(user.userId, world), 201),leaseVersion);
  } catch (error) { return archiveError(error); }
}
