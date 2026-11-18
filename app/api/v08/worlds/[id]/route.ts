import {retentionProtocol,cloudLease,withCloudLease} from '@/lib/retention-cloud';
import { getChatGPTUser } from '@/app/chatgpt-auth';
import {
  readV08MutationBody, readV08World, updateV08World, v08Error, v08Response,
  v08RevisionFromPayload, v08WorldFromPayload,
} from '@/lib/world-v08-storage';

export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: Context) {
  try {
    const user = await getChatGPTUser();
    if (!user) return v08Response({ error: 'Войдите, чтобы открыть сохранение.', code: 'unauthorized' }, 401);
    const protocol=retentionProtocol(request);if(protocol)return protocol;
    const { id } = await context.params;
    const leaseVersion=await cloudLease(user.userId,'v08',id,request.headers.get('x-microgalaxy-session')!);
    const result = await readV08World(user.userId, id, request.headers.get('if-none-match'));
    if ('notModified' in result) return withCloudLease(new Response(null, { status: 304, headers: { ETag: result.etag, 'Cache-Control': 'private, no-store' } }),leaseVersion);
    const response = v08Response(result);
    response.headers.set('ETag', result.etag);
    return withCloudLease(response,leaseVersion);
  } catch (error) { return v08Error(error); }
}

export async function PUT(request: Request, context: Context) {
  try {
    const user = await getChatGPTUser();
    if (!user) return v08Response({ error: 'Войдите, чтобы сохранить мир.', code: 'unauthorized' }, 401);
    const protocol=retentionProtocol(request);if(protocol)return protocol;
    const { id } = await context.params;
    const leaseVersion=await cloudLease(user.userId,'v08',id,request.headers.get('x-microgalaxy-session')!);
    const body = await readV08MutationBody(request);
    return withCloudLease(v08Response(await updateV08World(user.userId, id, v08WorldFromPayload(body), v08RevisionFromPayload(body))),leaseVersion);
  } catch (error) { return v08Error(error); }
}
