import {retentionProtocol,cloudLease,withCloudLease} from '@/lib/retention-cloud';
import { getChatGPTUser } from '@/app/chatgpt-auth';
import {
  readV04MutationBody, readV04World, updateV04World, v04Error, v04Response,
  v04RevisionFromPayload, v04WorldFromPayload,
} from '@/lib/world-v04-storage';

export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: Context) {
  try {
    const user = await getChatGPTUser();
    if (!user) return v04Response({ error: 'Войдите, чтобы открыть сохранение.', code: 'unauthorized' }, 401);
    const protocol=retentionProtocol(request);if(protocol)return protocol;
    const { id } = await context.params;
    const leaseVersion=await cloudLease(user.userId,'v04',id,request.headers.get('x-microgalaxy-session')!);
    return withCloudLease(v04Response(await readV04World(user.userId, id)),leaseVersion);
  } catch (error) { return v04Error(error); }
}

export async function PUT(request: Request, context: Context) {
  try {
    const user = await getChatGPTUser();
    if (!user) return v04Response({ error: 'Войдите, чтобы сохранить мир.', code: 'unauthorized' }, 401);
    const protocol=retentionProtocol(request);if(protocol)return protocol;
    const { id } = await context.params;
    const leaseVersion=await cloudLease(user.userId,'v04',id,request.headers.get('x-microgalaxy-session')!);
    const body = await readV04MutationBody(request);
    return withCloudLease(v04Response(await updateV04World(user.userId, id, v04WorldFromPayload(body), v04RevisionFromPayload(body))),leaseVersion);
  } catch (error) { return v04Error(error); }
}
