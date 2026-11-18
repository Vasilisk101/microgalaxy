import {retentionProtocol,cloudLease,withCloudLease} from '@/lib/retention-cloud';
import { getChatGPTUser } from "@/app/chatgpt-auth";
import {
  readMutationBody,
  readSavedWorld,
  revisionFromPayload,
  storageError,
  storageResponse,
  updateSavedWorld,
  worldFromPayload,
} from "@/lib/world-storage";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: Context) {
  try {
    const user = await getChatGPTUser();
    if (!user) return storageResponse({ error: "Войдите, чтобы открыть сохранение.", code: "unauthorized" }, 401);
    const protocol=retentionProtocol(request);if(protocol)return protocol;
    const { id } = await context.params;
    const leaseVersion=await cloudLease(user.userId,'classic',id,request.headers.get('x-microgalaxy-session')!);
    return withCloudLease(storageResponse(await readSavedWorld(user.userId, id)),leaseVersion);
  } catch (error) {
    return storageError(error);
  }
}

export async function PUT(request: Request, context: Context) {
  try {
    const user = await getChatGPTUser();
    if (!user) return storageResponse({ error: "Войдите, чтобы сохранить мир.", code: "unauthorized" }, 401);
    const protocol=retentionProtocol(request);if(protocol)return protocol;
    const { id } = await context.params;
    const leaseVersion=await cloudLease(user.userId,'classic',id,request.headers.get('x-microgalaxy-session')!);
    const body = await readMutationBody(request);
    const world = worldFromPayload(body);
    const revision = revisionFromPayload(body);
    return withCloudLease(storageResponse(await updateSavedWorld(user.userId, id, world, revision)),leaseVersion);
  } catch (error) {
    return storageError(error);
  }
}
