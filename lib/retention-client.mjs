// One tab/session holds conservative cloud leases until it explicitly finishes.
// No expiry can falsely declare a suspended/offline editor safe to delete.
export const RETENTION_SESSION=globalThis.crypto?.randomUUID?.()||('session-'+Date.now()+'-'+Math.random().toString(36).slice(2));
const leaseReceipts=new Map();
export function rememberCloudLease(model,id,version){if(typeof id==='string'&&typeof version==='string'&&/^[0-9a-f-]{36}$/i.test(version))leaseReceipts.set(JSON.stringify([model,id]),version);}
export function retentionHeaders(headers={}){const result=new Headers(headers);result.set('X-Microgalaxy-Retention','1');result.set('X-Microgalaxy-Session',RETENTION_SESSION);return result;}
export async function cloudRetention(action=null,values={}){
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),12000);
  try{const response=await fetch('/api/retention',{method:action?'POST':'GET',headers:retentionHeaders(action?{'Content-Type':'application/json'}:{}),body:action?JSON.stringify({...values,action}):undefined,credentials:'same-origin',cache:'no-store',redirect:'error',signal:controller.signal});const data=await response.json();if(!response.ok){const error=new Error(data.error||'Облачный архив недоступен.');error.status=response.status;throw error;}return data;}finally{clearTimeout(timer);}
}
export async function releaseCloudWorld(model,id){const key=JSON.stringify([model,id]),leaseVersion=leaseReceipts.get(key);if(!leaseVersion)return {released:false,protected:true};const result=await cloudRetention('release',{model,id,leaseVersion});if(result.released&&leaseReceipts.get(key)===leaseVersion)leaseReceipts.delete(key);return result;}
