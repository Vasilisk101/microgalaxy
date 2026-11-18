/** Opaque keyset position for updated_at DESC, id ASC. Never used as SQL. */
export type WorldCursor = { updatedAt: string; id: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

export class InvalidWorldCursorError extends Error {
  constructor() {
    super("Неверный указатель страницы архива. Откройте архив заново.");
    this.name = "InvalidWorldCursorError";
  }
}

function base64url(value: string): string {
  return btoa(value).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function encodeWorldCursor(cursor: WorldCursor): string {
  return base64url(JSON.stringify({ v: 1, updatedAt: cursor.updatedAt, id: cursor.id }));
}

export function decodeWorldCursor(token: string): WorldCursor {
  try {
    if (typeof token !== "string" || token.length > 256 || !/^[A-Za-z0-9_-]+$/.test(token)) {
      throw new InvalidWorldCursorError();
    }
    const decoded = atob(token.replace(/-/g, "+").replace(/_/g, "/"));
    if (base64url(decoded) !== token) throw new InvalidWorldCursorError();
    const value: unknown = JSON.parse(decoded);
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new InvalidWorldCursorError();
    const cursor = value as Record<string, unknown>;
    if (Object.keys(cursor).length !== 3 || cursor.v !== 1 ||
        typeof cursor.updatedAt !== "string" || !ISO_TIMESTAMP.test(cursor.updatedAt) ||
        !Number.isFinite(Date.parse(cursor.updatedAt)) || new Date(cursor.updatedAt).toISOString() !== cursor.updatedAt ||
        typeof cursor.id !== "string" || !UUID.test(cursor.id)) {
      throw new InvalidWorldCursorError();
    }
    return { updatedAt: cursor.updatedAt, id: cursor.id };
  } catch {
    throw new InvalidWorldCursorError();
  }
}
