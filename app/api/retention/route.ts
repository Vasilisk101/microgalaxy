import {getChatGPTUser} from '@/app/chatgpt-auth';
import {cloudRetentionStatus,cloudLease,inventoryCloudRetention,pruneCloudRetention,setCloudPinned,setCloudRetentionLimit,retentionProtocol,RetentionError,adoptCloudWorld} from '@/lib/retention-cloud';
export const dynamic='force-dynamic';
const response=(data:unknown,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});
function failure(error:unknown){return error instanceof RetentionError?response({error:error.message,code:error.code},error.status):response({error:'Учёт облачного архива временно недоступен.',code:'retention_unavailable'},503);}
export async function GET(){try{const user=await getChatGPTUser();if(!user)return response({error:'Войдите для облачного архива.'},401);return response(await cloudRetentionStatus(user.userId));}catch(error){return failure(error);}}
export async function POST(request:Request){try{
  const user=await getChatGPTUser();if(!user)return response({error:'Войдите для облачного архива.'},401);const protocol=retentionProtocol(request);if(protocol)return protocol;
  const origin=request.headers.get('origin');if(request.headers.get('sec-fetch-site')==='cross-site'||origin&&origin!==new URL(request.url).origin)return response({error:'Недопустимый источник запроса.'},403);
  if(!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type')||''))return response({error:'Ожидается JSON.'},415);
  const reader=request.body?.getReader();if(!reader)return response({error:'Пустой запрос.'},400);let text='',bytes=0;const decoder=new TextDecoder();try{while(true){const part=await reader.read();if(part.done)break;bytes+=part.value.length;if(bytes>4096){await reader.cancel();return response({error:'Запрос слишком большой.'},413);}text+=decoder.decode(part.value,{stream:true});}text+=decoder.decode();}finally{reader.releaseLock();}
  const body=JSON.parse(text),owner=user.userId;
  if(body.action==='settings')return response(await setCloudRetentionLimit(owner,body.limitBytes,body.confirmation));
  if(body.action==='adopt')return response(await adoptCloudWorld(owner,body.model,body.id,request.headers.get('x-microgalaxy-session')!,body.revision,body.observed,body.acknowledge));
  if(body.action==='pin')return response(await setCloudPinned(owner,body.model,body.id,body.pinned));
  if(body.action==='inventory')return response(await inventoryCloudRetention(owner));
  if(body.action==='cleanup')return response(await pruneCloudRetention(owner,undefined,8));
  if(body.action==='lease'||body.action==='release'){const receipt=await cloudLease(owner,body.model,body.id,request.headers.get('x-microgalaxy-session')!,body.action==='release',body.leaseVersion);return response(body.action==='release'?{released:receipt===true}:{ok:true,leaseVersion:receipt});}
  return response({error:'Неизвестная операция.'},400);
}catch(error){return failure(error);}}
