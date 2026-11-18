import {retentionProtocol,cloudLease,withCloudLease} from '@/lib/retention-cloud';
import { getChatGPTUser } from '@/app/chatgpt-auth';
import {
  readV06MutationBody, readV06World, updateV06World, v06Error, v06Response,
  v06RevisionFromPayload, v06WorldFromPayload,
} from '@/lib/world-v06-storage';

export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: Context) {
  try {
    const user = await getChatGPTUser();
    if (!user) return v06Response({ error: 'Войдите, чтобы открыть сохранение.', code: 'unauthorized' }, 401);
    const protocol=retentionProtocol(request);if(protocol)return protocol;
    const { id } = await context.params;
    const leaseVersion=await cloudLease(user.userId,'v06',id,request.headers.get('x-microgalaxy-session')!);
    const result = await readV06World(user.userId, id, request.headers.get('if-none-match'));
    if ('notModified' in result) return withCloudLease(new Response(null, { status: 304, headers: { ETag: result.etag, 'Cache-Control': 'private, no-store' } }),leaseVersion);
    const response = v06Response(result);
    response.headers.set('ETag', result.etag);
    return withCloudLease(response,leaseVersion);
  } catch (error) { return v06Error(error); }
}

export async function PUT(request: Request, context: Context) {
  try {
    const user = await getChatGPTUser();
    if (!user) return v06Response({ error: 'Войдите, чтобы сохранить мир.', code: 'unauthorized' }, 401);
    const protocol=retentionProtocol(request);if(protocol)return protocol;
    const { id } = await context.params;
    const leaseVersion=await cloudLease(user.userId,'v06',id,request.headers.get('x-microgalaxy-session')!);
    const body = await readV06MutationBody(request);
    return withCloudLease(v06Response(await updateV06World(user.userId, id, v06WorldFromPayload(body), v06RevisionFromPayload(body))),leaseVersion);
  } catch (error) { return v06Error(error); }
}
