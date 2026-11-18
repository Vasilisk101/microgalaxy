import {retentionProtocol,cloudLease,withCloudLease} from '@/lib/retention-cloud';
import { getChatGPTUser } from '@/app/chatgpt-auth';
import {
  readV07MutationBody, readV07World, updateV07World, v07Error, v07Response,
  v07RevisionFromPayload, v07WorldFromPayload,
} from '@/lib/world-v07-storage';

export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: Context) {
  try {
    const user = await getChatGPTUser();
    if (!user) return v07Response({ error: 'Войдите, чтобы открыть сохранение.', code: 'unauthorized' }, 401);
    const protocol=retentionProtocol(request);if(protocol)return protocol;
    const { id } = await context.params;
    const leaseVersion=await cloudLease(user.userId,'v07',id,request.headers.get('x-microgalaxy-session')!);
    const result = await readV07World(user.userId, id, request.headers.get('if-none-match'));
    if ('notModified' in result) return withCloudLease(new Response(null, { status: 304, headers: { ETag: result.etag, 'Cache-Control': 'private, no-store' } }),leaseVersion);
    const response = v07Response(result);
    response.headers.set('ETag', result.etag);
    return withCloudLease(response,leaseVersion);
  } catch (error) { return v07Error(error); }
}

export async function PUT(request: Request, context: Context) {
  try {
    const user = await getChatGPTUser();
    if (!user) return v07Response({ error: 'Войдите, чтобы сохранить мир.', code: 'unauthorized' }, 401);
    const protocol=retentionProtocol(request);if(protocol)return protocol;
    const { id } = await context.params;
    const leaseVersion=await cloudLease(user.userId,'v07',id,request.headers.get('x-microgalaxy-session')!);
    const body = await readV07MutationBody(request);
    return withCloudLease(v07Response(await updateV07World(user.userId, id, v07WorldFromPayload(body), v07RevisionFromPayload(body))),leaseVersion);
  } catch (error) { return v07Error(error); }
}
