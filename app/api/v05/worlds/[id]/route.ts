import {retentionProtocol,cloudLease,withCloudLease} from '@/lib/retention-cloud';
import { getChatGPTUser } from '@/app/chatgpt-auth';
import {
  readV05MutationBody, readV05World, updateV05World, v05Error, v05Response,
  v05RevisionFromPayload, v05WorldFromPayload,
} from '@/lib/world-v05-storage';

export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: Context) {
  try {
    const user = await getChatGPTUser();
    if (!user) return v05Response({ error: 'Войдите, чтобы открыть сохранение.', code: 'unauthorized' }, 401);
    const protocol=retentionProtocol(request);if(protocol)return protocol;
    const { id } = await context.params;
    const leaseVersion=await cloudLease(user.userId,'v05',id,request.headers.get('x-microgalaxy-session')!);
    const result = await readV05World(user.userId, id, request.headers.get('if-none-match'));
    if ('notModified' in result) return withCloudLease(new Response(null, { status: 304, headers: { ETag: result.etag, 'Cache-Control': 'private, no-store' } }),leaseVersion);
    const response = v05Response(result);
    response.headers.set('ETag', result.etag);
    return withCloudLease(response,leaseVersion);
  } catch (error) { return v05Error(error); }
}

export async function PUT(request: Request, context: Context) {
  try {
    const user = await getChatGPTUser();
    if (!user) return v05Response({ error: 'Войдите, чтобы сохранить мир.', code: 'unauthorized' }, 401);
    const protocol=retentionProtocol(request);if(protocol)return protocol;
    const { id } = await context.params;
    const leaseVersion=await cloudLease(user.userId,'v05',id,request.headers.get('x-microgalaxy-session')!);
    const body = await readV05MutationBody(request);
    return withCloudLease(v05Response(await updateV05World(user.userId, id, v05WorldFromPayload(body), v05RevisionFromPayload(body))),leaseVersion);
  } catch (error) { return v05Error(error); }
}
