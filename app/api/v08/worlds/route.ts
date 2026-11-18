import {retentionProtocol,cloudLease,withCloudLease} from '@/lib/retention-cloud';
import { getChatGPTUser } from '@/app/chatgpt-auth';
import {
  createV08World, listV08Worlds, readV08MutationBody, v08Error, v08Response, v08WorldFromPayload,
} from '@/lib/world-v08-storage';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const user = await getChatGPTUser();
    if (!user) return v08Response({ error: 'Войдите, чтобы открыть свои сохранения.', code: 'unauthorized', user: null }, 401);
    const cursors = new URL(request.url).searchParams.getAll('cursor');
    if (cursors.length > 1) return v08Response({ error: 'Неверный указатель страницы архива.', code: 'invalid_cursor' }, 400);
    return v08Response({ ...await listV08Worlds(user.userId, cursors[0]), user: { name: user.displayName } });
  } catch (error) { return v08Error(error); }
}

export async function POST(request: Request) {
  try {
    const user = await getChatGPTUser();
    if (!user) return v08Response({ error: 'Войдите, чтобы сохранить мир.', code: 'unauthorized' }, 401);
    const protocol=retentionProtocol(request);if(protocol)return protocol;
    const body = await readV08MutationBody(request);
    const leaseVersion=await cloudLease(user.userId,'v08',v08WorldFromPayload(body).id,request.headers.get('x-microgalaxy-session')!);
    return withCloudLease(v08Response(await createV08World(user.userId, v08WorldFromPayload(body)), 201),leaseVersion);
  } catch (error) { return v08Error(error); }
}
