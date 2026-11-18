import {retentionProtocol,cloudLease,withCloudLease} from '@/lib/retention-cloud';
import { getChatGPTUser } from "@/app/chatgpt-auth";
import {
  createSavedWorld,
  listWorlds,
  readMutationBody,
  storageError,
  storageResponse,
  worldFromPayload,
} from "@/lib/world-storage";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const user = await getChatGPTUser();
    if (!user) return storageResponse({ error: "Войдите, чтобы открыть свои сохранения.", code: "unauthorized", user: null }, 401);
    const cursors = new URL(request.url).searchParams.getAll("cursor");
    if (cursors.length > 1) return storageResponse({ error: "Неверный указатель страницы архива. Откройте архив заново.", code: "invalid_cursor" }, 400);
    const catalogue = await listWorlds(user.userId, cursors[0]);
    return storageResponse({ ...catalogue, user: { name: user.displayName } });
  } catch (error) {
    return storageError(error);
  }
}

export async function POST(request: Request) {
  try {
    const user = await getChatGPTUser();
    if (!user) return storageResponse({ error: "Войдите, чтобы сохранить мир.", code: "unauthorized" }, 401);
    const protocol=retentionProtocol(request);if(protocol)return protocol;
    const body = await readMutationBody(request);
    const leaseVersion=await cloudLease(user.userId,'classic',worldFromPayload(body).id,request.headers.get('x-microgalaxy-session')!);
    const world = worldFromPayload(body);
    return withCloudLease(storageResponse(await createSavedWorld(user.userId, world), 201),leaseVersion);
  } catch (error) {
    return storageError(error);
  }
}
