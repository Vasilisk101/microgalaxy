import {retentionProtocol,leaseOwnedWorld,withCloudLease} from '@/lib/retention-cloud';
import { getChatGPTUser } from '@/app/chatgpt-auth';
import {
  readMutationBody, read, update, archiveError, archiveResponse,
  revisionFromPayload, worldFromPayload,
} from '@/lib/world-v1-storage';

export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: Context) {
  try {
    const user = await getChatGPTUser();
    if (!user) return archiveResponse({ error: 'Войдите, чтобы открыть сохранение.', code: 'unauthorized' }, 401);
    const protocol=retentionProtocol(request);if(protocol)return protocol;
    const { id } = await context.params;
    const leaseVersion=await leaseOwnedWorld(user.userId,'v1',id,request.headers.get('x-microgalaxy-session')!);
    const result = await read(user.userId, id, request.headers.get('if-none-match'));
    if ('notModified' in result) return withCloudLease(new Response(null, { status: 304, headers: { ETag: result.etag, 'Cache-Control': 'private, no-store' } }),leaseVersion);
    const response = archiveResponse(result);
    response.headers.set('ETag', result.etag);
    return withCloudLease(response,leaseVersion);
  } catch (error) { return archiveError(error); }
}

export async function PUT(request: Request, context: Context) {
  try {
    const user = await getChatGPTUser();
    if (!user) return archiveResponse({ error: 'Войдите, чтобы сохранить мир.', code: 'unauthorized' }, 401);
    const protocol=retentionProtocol(request);if(protocol)return protocol;
    const { id } = await context.params;
    const leaseVersion=await leaseOwnedWorld(user.userId,'v1',id,request.headers.get('x-microgalaxy-session')!);
    const body = await readMutationBody(request);
    return withCloudLease(archiveResponse(await update(user.userId, id, worldFromPayload(body), revisionFromPayload(body))),leaseVersion);
  } catch (error) { return archiveError(error); }
}
