/*
 * Express authentication route for a Telegram Mini App game.
 *
 * Required packages:
 *   npm install express
 *   npm install -D typescript @types/express @types/node
 *
 * Copy this file beside telegram-init-data-verifier.ts. Configure
 * TELEGRAM_BOT_TOKEN and SESSION_SIGNING_SECRET through your deployment's
 * secret manager. Never send either value to the Mini App client.
 */

import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { Router, json, type NextFunction, type Request, type Response } from "express";
import {
  TelegramInitDataValidationError,
  type TelegramWebAppUser,
  verifyTelegramInitData,
} from "./telegram-init-data-verifier.js";

export interface GameSession {
  readonly token: string;
  readonly expiresAt: Date;
}

export interface SessionIssuer {
  /** Persist/issue a server-authoritative session for this verified Telegram player. */
  issue(input: { telegramUser: TelegramWebAppUser; queryId: string | null; startParam: string | null }): Promise<GameSession>;
}

export interface TelegramAuthRouterOptions {
  /** Read from a server-side secret store, e.g. process.env.TELEGRAM_BOT_TOKEN. */
  readonly botToken: string;
  /** Normally five minutes. Set based on your launch/reconnect UX. */
  readonly maxInitDataAgeSeconds?: number;
  /** Inject only in deterministic tests. Omit in production to use the system clock. */
  readonly now?: () => Date;
  readonly sessionIssuer: SessionIssuer;
}

type InitDataRequestBody = { initData?: unknown };

function getInitData(body: unknown): string {
  const initData = (body as InitDataRequestBody | null)?.initData;
  if (typeof initData !== "string" || initData.length === 0) {
    throw new TelegramInitDataValidationError("Missing initData");
  }
  return initData;
}

/**
 * Mount with `app.use("/api", createTelegramAuthRouter(...))`.
 *
 * Apply rate limiting, HTTPS, trusted proxy configuration, and your existing
 * CSRF/origin policy at the app or reverse-proxy layer. Do not log `initData`.
 */
export function createTelegramAuthRouter(options: TelegramAuthRouterOptions): Router {
  if (!options.botToken) throw new Error("TELEGRAM_BOT_TOKEN is required");

  const router = Router();
  router.use(json({ limit: "16kb", type: "application/json" }));

  router.post("/auth/telegram", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const rawInitData = getInitData(req.body);
      const verified = verifyTelegramInitData(rawInitData, options.botToken, {
        maxAgeSeconds: options.maxInitDataAgeSeconds ?? 300,
        requireUser: true,
        now: options.now?.(),
      });
      // `requireUser: true` above means this is safe after validation succeeds.
      const session = await options.sessionIssuer.issue({
        telegramUser: verified.user!,
        queryId: verified.queryId,
        startParam: verified.startParam,
      });

      res.setHeader("cache-control", "no-store");
      return res.status(200).json({
        sessionToken: session.token,
        userId: String(verified.user!.id),
        expiresAt: session.expiresAt.toISOString(),
      });
    } catch (error) {
      if (error instanceof TelegramInitDataValidationError) {
        // Do not include raw initData, hash details, or bot-token state in logs/responses.
        return res.status(401).json({ error: "Invalid Telegram launch data" });
      }
      return next(error);
    }
  });

  return router;
}

/**
 * Example session issuer for a stateless deployment. It creates a compact,
 * signed, short-lived game session token. Replace this with your existing
 * opaque session store if you need immediate revocation or central session
 * management. The token's payload is not encrypted, so include no secrets.
 */
export function createSignedGameSessionIssuer(
  signingSecret: string,
  options: { ttlSeconds?: number; now?: () => Date } = {},
): SessionIssuer {
  if (!signingSecret) throw new Error("SESSION_SIGNING_SECRET is required");
  const ttlSeconds = options.ttlSeconds ?? 3_600;
  if (!Number.isSafeInteger(ttlSeconds) || ttlSeconds <= 0) throw new RangeError("ttlSeconds must be a positive integer");
  const now = options.now ?? (() => new Date());

  return {
    async issue({ telegramUser, queryId, startParam }): Promise<GameSession> {
      const issuedAt = now();
      const expiresAt = new Date(issuedAt.valueOf() + ttlSeconds * 1_000);
      const payload = {
        sub: String(telegramUser.id),
        iat: Math.floor(issuedAt.valueOf() / 1_000),
        exp: Math.floor(expiresAt.valueOf() / 1_000),
        jti: randomUUID(),
        queryId,
        startParam,
        aud: "telegram-game",
      };
      const encodedPayload = Buffer.from(JSON.stringify(payload)).toString("base64url");
      const signature = createHmac("sha256", signingSecret).update(encodedPayload).digest("base64url");
      return { token: `${encodedPayload}.${signature}`, expiresAt };
    },
  };
}

/** Verify a token issued by createSignedGameSessionIssuer before authorizing game API calls. */
export function verifySignedGameSession(token: string, signingSecret: string, now = new Date()): { userId: string; expiresAt: Date } {
  const [encodedPayload, receivedSignature, ...extra] = token.split(".");
  if (!encodedPayload || !receivedSignature || extra.length > 0) throw new Error("Invalid session token");
  const expectedSignature = createHmac("sha256", signingSecret).update(encodedPayload).digest();
  const actualSignature = Buffer.from(receivedSignature, "base64url");
  if (actualSignature.length !== expectedSignature.length || !timingSafeEqual(actualSignature, expectedSignature)) {
    throw new Error("Invalid session token");
  }

  let payload: unknown;
  try {
    payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8"));
  } catch {
    throw new Error("Invalid session token");
  }
  const value = payload as { sub?: unknown; exp?: unknown; aud?: unknown };
  if (typeof value.sub !== "string" || typeof value.exp !== "number" || !Number.isSafeInteger(value.exp) || value.aud !== "telegram-game") {
    throw new Error("Invalid session token");
  }
  const expiresAt = new Date(value.exp * 1_000);
  if (expiresAt.valueOf() <= now.valueOf()) throw new Error("Expired session token");
  return { userId: value.sub, expiresAt };
}

/*
 * Minimal server composition:
 *
 * import express from "express";
 * import { createSignedGameSessionIssuer, createTelegramAuthRouter } from "./express-telegram-auth-router";
 *
 * const app = express();
 * const botToken = process.env.TELEGRAM_BOT_TOKEN;
 * const sessionSecret = process.env.SESSION_SIGNING_SECRET;
 * if (!botToken || !sessionSecret) throw new Error("Missing server secrets");
 *
 * app.use("/api", createTelegramAuthRouter({
 *   botToken,
 *   sessionIssuer: createSignedGameSessionIssuer(sessionSecret),
 * }));
 * app.listen(process.env.PORT ?? 3000);
 */
