import {retentionProtocol,cloudLease,withCloudLease} from '@/lib/retention-cloud';
import { getChatGPTUser } from '@/app/chatgpt-auth';
import {
  readV03MutationBody, readV03World, updateV03World, v03Error, v03Response,
  v03RevisionFromPayload, v03WorldFromPayload,
} from '@/lib/world-v03-storage';

export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: Context) {
  try {
    const user = await getChatGPTUser();
    if (!user) return v03Response({ error: 'Войдите, чтобы открыть сохранение.', code: 'unauthorized' }, 401);
    const protocol=retentionProtocol(request);if(protocol)return protocol;
    const { id } = await context.params;
    const leaseVersion=await cloudLease(user.userId,'v03',id,request.headers.get('x-microgalaxy-session')!);
    return withCloudLease(v03Response(await readV03World(user.userId, id)),leaseVersion);
  } catch (error) { return v03Error(error); }
}

export async function PUT(request: Request, context: Context) {
  try {
    const user = await getChatGPTUser();
    if (!user) return v03Response({ error: 'Войдите, чтобы сохранить мир.', code: 'unauthorized' }, 401);
    const protocol=retentionProtocol(request);if(protocol)return protocol;
    const { id } = await context.params;
    const leaseVersion=await cloudLease(user.userId,'v03',id,request.headers.get('x-microgalaxy-session')!);
    const body = await readV03MutationBody(request);
    return withCloudLease(v03Response(await updateV03World(user.userId, id, v03WorldFromPayload(body), v03RevisionFromPayload(body))),leaseVersion);
  } catch (error) { return v03Error(error); }
}
