/*
 * Telegram Mini App initData verifier (Node.js 20+)
 *
 * Validate raw Telegram.WebApp.initData on the server before creating a game
 * session, accepting scores, granting rewards, or loading cloud progress.
 * Do not call this in browser code and do not expose TELEGRAM_BOT_TOKEN.
 *
 * Algorithm: https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
 */

import { createHmac, timingSafeEqual } from "node:crypto";

export interface TelegramWebAppUser {
  readonly id: number;
  readonly first_name: string;
  readonly last_name?: string;
  readonly username?: string;
  readonly language_code?: string;
  readonly is_premium?: boolean;
  readonly allows_write_to_pm?: boolean;
  readonly photo_url?: string;
}

export interface VerifiedTelegramInitData {
  readonly authDate: Date;
  readonly user: TelegramWebAppUser | null;
  readonly queryId: string | null;
  readonly startParam: string | null;
  /** Non-sensitive launch fields, excluding `hash` and parsed `user`. */
  readonly fields: Readonly<Record<string, string>>;
}

export interface VerifyTelegramInitDataOptions {
  /** Reject an initData value older than this many seconds. Default: 5 minutes. */
  readonly maxAgeSeconds?: number;
  /** Permit a small client/server clock difference for future `auth_date`. Default: 60 seconds. */
  readonly futureSkewSeconds?: number;
  /** Require a valid WebApp user object. Default: true for player-auth routes. */
  readonly requireUser?: boolean;
  /** Injectable clock for deterministic tests. Default: the current system time. */
  readonly now?: Date;
}

export class TelegramInitDataValidationError extends Error {
  constructor(message = "Invalid Telegram Mini App launch data") {
    super(message);
    this.name = "TelegramInitDataValidationError";
  }
}

const MAX_INIT_DATA_LENGTH = 16_384;

function validationError(message?: string): never {
  throw new TelegramInitDataValidationError(message);
}

function parseAuthDate(value: string | undefined): Date {
  if (!value || !/^\d+$/.test(value)) validationError("Missing or malformed auth_date");
  const seconds = Number(value);
  if (!Number.isSafeInteger(seconds) || seconds <= 0) validationError("Malformed auth_date");
  const date = new Date(seconds * 1_000);
  if (Number.isNaN(date.valueOf())) validationError("Malformed auth_date");
  return date;
}

function parseUser(value: string | undefined, requireUser: boolean): TelegramWebAppUser | null {
  if (!value) {
    if (requireUser) validationError("Missing user");
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    validationError("Malformed user");
  }

  if (
    !parsed ||
    typeof parsed !== "object" ||
    !Number.isSafeInteger((parsed as { id?: unknown }).id) ||
    typeof (parsed as { first_name?: unknown }).first_name !== "string"
  ) {
    validationError("Malformed user");
  }
  return parsed as TelegramWebAppUser;
}

function singleValueFields(rawInitData: string): Map<string, string> {
  if (!rawInitData || rawInitData.length > MAX_INIT_DATA_LENGTH) validationError("Missing or oversized initData");

  const fields = new Map<string, string>();
  for (const [key, value] of new URLSearchParams(rawInitData)) {
    if (!key || fields.has(key)) validationError("Malformed initData");
    fields.set(key, value);
  }
  return fields;
}

/**
 * Verify the raw query string from `Telegram.WebApp.initData`.
 *
 * `botToken` must come from a server-only secret store such as
 * `process.env.TELEGRAM_BOT_TOKEN`; it must never come from the request.
 */
export function verifyTelegramInitData(
  rawInitData: string,
  botToken: string,
  options: VerifyTelegramInitDataOptions = {},
): VerifiedTelegramInitData {
  if (!botToken) validationError("Server configuration error");
  const maxAgeSeconds = options.maxAgeSeconds ?? 300;
  const futureSkewSeconds = options.futureSkewSeconds ?? 60;
  if (!Number.isSafeInteger(maxAgeSeconds) || maxAgeSeconds <= 0) throw new RangeError("maxAgeSeconds must be a positive integer");
  if (!Number.isSafeInteger(futureSkewSeconds) || futureSkewSeconds < 0) throw new RangeError("futureSkewSeconds must be a non-negative integer");

  const fields = singleValueFields(rawInitData);
  const receivedHash = fields.get("hash");
  if (!receivedHash || !/^[0-9a-f]{64}$/i.test(receivedHash)) validationError("Missing or malformed hash");
  fields.delete("hash");

  const dataCheckString = [...fields.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");

  // First key: HMAC(bot_token, key = "WebAppData"). Keep this as bytes.
  const secretKey = createHmac("sha256", "WebAppData").update(botToken).digest();
  const expectedHash = createHmac("sha256", secretKey).update(dataCheckString).digest();
  const receivedHashBuffer = Buffer.from(receivedHash, "hex");
  if (receivedHashBuffer.length !== expectedHash.length || !timingSafeEqual(receivedHashBuffer, expectedHash)) {
    validationError("Signature mismatch");
  }

  const authDate = parseAuthDate(fields.get("auth_date"));
  const now = options.now ?? new Date();
  const ageSeconds = Math.floor((now.valueOf() - authDate.valueOf()) / 1_000);
  if (ageSeconds > maxAgeSeconds || ageSeconds < -futureSkewSeconds) validationError("Expired or future-dated initData");

  const user = parseUser(fields.get("user"), options.requireUser ?? true);
  const { user: _rawUser, ...safeFields } = Object.fromEntries(fields);
  return Object.freeze({
    authDate,
    user,
    queryId: fields.get("query_id") ?? null,
    startParam: fields.get("start_param") ?? null,
    fields: Object.freeze(safeFields),
  });
}
