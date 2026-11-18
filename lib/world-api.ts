/** Keep an unavailable cloud from blocking the local observatory indefinitely. */
import {retentionHeaders,rememberCloudLease} from './retention-client.mjs';
export type WorldApiResult<T> = { ok: boolean; status: number; data: T };

export async function worldApi<T>(
  url: string,
  init: RequestInit = {},
  timeoutMs = 6000,
): Promise<WorldApiResult<T>> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error('Облако не ответило вовремя. Локальная копия остаётся доступна.'));
    }, timeoutMs);
  });
  try {
    const request = (async () => {
      const response = await fetch(url, { ...init, headers:retentionHeaders(init.headers), signal: controller.signal, redirect: 'error' });
      const data = await response.json() as T;
      if(response.ok&&/^\/api\/worlds(?:\/|$)/.test(url)){const payload=data as {id?:string,world?:{id?:string}};rememberCloudLease('classic',payload.id||payload.world?.id,response.headers.get('x-microgalaxy-lease'));}
      return { ok: response.ok, status: response.status, data };
    })();
    return await Promise.race([request, deadline]);
  } finally {
    clearTimeout(timer);
  }
}
