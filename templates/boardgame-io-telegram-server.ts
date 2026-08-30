/*
 * boardgame.io master wired to verified Telegram Mini App identity.
 *
 * Required packages:
 *   npm install boardgame.io express
 *   npm install -D typescript @types/express @types/node @types/koa
 *
 * Copy this beside telegram-init-data-verifier.ts and
 * express-telegram-auth-router.ts. Read references/boardgame-io.md first --
 * the credential model here is comparison-based, not bearer-token-based, and
 * misreading it produces an authentication bypass.
 *
 * Layout this template assumes:
 *   - Your Express API (public) serves /api/auth/telegram and /api/match/*.
 *   - The boardgame.io socket transport (public) serves game traffic.
 *   - The boardgame.io Lobby API (private) is on a port your reverse proxy
 *     does not route. Only this process talks to it.
 */

import type Koa from "koa";
import { Router, json, type NextFunction, type Request, type Response } from "express";
import { LobbyClient } from "boardgame.io/client";
import type { Server as BgioServerTypes } from "boardgame.io";
import { verifySignedGameSession } from "./express-telegram-auth-router.js";

/* ------------------------------------------------------------------------ *
 * 1. Credential hooks for Server({ generateCredentials, authenticateCredentials })
 * ------------------------------------------------------------------------ */

/** Value stored in a seat's match metadata. Public by design, never a secret. */
export function seatCredentialFor(telegramUserId: string): string {
  return `tg:${telegramUserId}`;
}

function bearerFrom(header: unknown): string | null {
  if (typeof header !== "string") return null;
  const match = /^Bearer (.+)$/.exec(header.trim());
  return match ? match[1] : null;
}

export interface TelegramCredentialHooks {
  readonly generateCredentials: BgioServerTypes.GenerateCredentials;
  readonly authenticateCredentials: BgioServerTypes.AuthenticateCredentials;
}

/**
 * Bind boardgame.io seats to Telegram users.
 *
 * `generateCredentials` runs once per join and records who owns the seat.
 * `authenticateCredentials` runs on every move and on the credential-bearing
 * Lobby routes; it re-verifies the caller's signed session token and checks
 * that its subject owns the seat being played.
 */
export function createTelegramCredentialHooks(signingSecret: string): TelegramCredentialHooks {
  if (!signingSecret) throw new Error("SESSION_SIGNING_SECRET is required");

  return {
    generateCredentials: (ctx: Koa.DefaultContext): string => {
      const token = bearerFrom(ctx.request?.headers?.["authorization"]);
      if (token) {
        try {
          return seatCredentialFor(verifySignedGameSession(token, signingSecret).userId);
        } catch {
          // Fall through: do not distinguish forged from expired to the caller.
        }
      }
      // ctx.throw produces a 401 response; a bare throw would surface as a 500.
      return ctx.throw(401, "Invalid session token");
    },

    authenticateCredentials: (credentials, playerMetadata): boolean => {
      const owner = playerMetadata?.credentials;
      if (!credentials || !owner) return false;
      try {
        return seatCredentialFor(verifySignedGameSession(credentials, signingSecret).userId) === owner;
      } catch {
        // Expired or forged token. The client must refresh and call
        // client.updateCredentials(next) -- see the refresh route below.
        return false;
      }
    },
  };
}

/* ------------------------------------------------------------------------ *
 * 2. Seat assignments
 * ------------------------------------------------------------------------ */

/**
 * The Lobby API strips `credentials` from match reads, so the seat a Telegram
 * user holds cannot be recovered from boardgame.io. Persist it yourself, or a
 * player who reloads the Mini App cannot rejoin their own match.
 */
export interface SeatStore {
  /** Seat this user already holds in this match, if any. */
  get(matchID: string, telegramUserId: string): Promise<string | null>;
  /** Record a seat. Must reject a second seat for the same user in the same match. */
  claim(matchID: string, telegramUserId: string, playerID: string): Promise<void>;
}

/** Development only. Replace with a row in the database that backs your game API. */
export function createInMemorySeatStore(): SeatStore {
  const seats = new Map<string, string>();
  const key = (matchID: string, userId: string) => `${matchID} ${userId}`;
  return {
    async get(matchID, userId) {
      return seats.get(key(matchID, userId)) ?? null;
    },
    async claim(matchID, userId, playerID) {
      const entry = key(matchID, userId);
      if (seats.has(entry)) throw new Error("Player already seated in this match");
      seats.set(entry, playerID);
    },
  };
}

/* ------------------------------------------------------------------------ *
 * 3. Server-side matchmaking
 * ------------------------------------------------------------------------ */

export interface MatchSeat {
  readonly matchID: string;
  readonly playerID: string;
}

export interface MatchmakerOptions {
  /** Base URL of the private Lobby API, e.g. 'http://127.0.0.1:8001'. */
  readonly lobbyServer: string;
  readonly gameName: string;
  readonly numPlayers: number;
  readonly seats: SeatStore;
}

const MATCH_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

export class MatchmakingError extends Error {
  readonly status: number;
  constructor(message: string, status = 409) {
    super(message);
    this.name = "MatchmakingError";
    this.status = status;
  }
}

export class TelegramMatchmaker {
  private readonly lobby: LobbyClient;

  constructor(private readonly options: MatchmakerOptions) {
    this.lobby = new LobbyClient({ server: options.lobbyServer });
  }

  /** Create a match nobody has joined yet. Unlisted keeps it out of public listings. */
  async createMatch(sessionToken: string): Promise<string> {
    const { matchID } = await this.lobby.createMatch(
      this.options.gameName,
      { numPlayers: this.options.numPlayers, unlisted: true },
      this.authHeader(sessionToken),
    );
    return matchID;
  }

  /**
   * Seat a verified Telegram user, or return the seat they already hold.
   *
   * `displayName` is readable by every client that knows the match ID. Pass a
   * chosen display name only, never a Telegram user ID, username, or photo URL.
   */
  async joinMatch(input: {
    matchID: string;
    telegramUserId: string;
    sessionToken: string;
    displayName: string;
  }): Promise<MatchSeat> {
    const { matchID, telegramUserId, sessionToken } = input;
    if (!MATCH_ID_PATTERN.test(matchID)) throw new MatchmakingError("Malformed match ID", 400);

    const existing = await this.options.seats.get(matchID, telegramUserId);
    if (existing) return { matchID, playerID: existing };

    const match = await this.lobby.getMatch(this.options.gameName, matchID).catch(() => null);
    if (!match) throw new MatchmakingError("Match not found", 404);
    if (match.gameover !== undefined) throw new MatchmakingError("Match is over", 410);

    const free = match.players.find((player) => !player.name);
    if (!free) throw new MatchmakingError("Match is full");
    const playerID = String(free.id);

    // Claim locally first: two taps from the same user must not take two seats.
    await this.options.seats.claim(matchID, telegramUserId, playerID);
    await this.lobby.joinMatch(
      this.options.gameName,
      matchID,
      { playerID, playerName: sanitizeDisplayName(input.displayName) },
      this.authHeader(sessionToken),
    );
    return { matchID, playerID };
  }

  private authHeader(sessionToken: string) {
    // Consumed by generateCredentials on the create/join request.
    return { headers: { authorization: `Bearer ${sessionToken}` } };
  }
}

/** Match metadata is world-readable. Keep names short, plain, and non-identifying. */
export function sanitizeDisplayName(name: string): string {
  const cleaned = name.replace(/\p{C}/gu, "").trim().slice(0, 32);
  return cleaned.length > 0 ? cleaned : "Player";
}

/* ------------------------------------------------------------------------ *
 * 4. Express routes the Mini App calls
 * ------------------------------------------------------------------------ */

export interface MatchRouterOptions {
  readonly signingSecret: string;
  readonly matchmaker: TelegramMatchmaker;
  /** Issue a fresh session token for an already-authenticated user. */
  readonly refreshSession: (telegramUserId: string) => Promise<{ token: string; expiresAt: Date }>;
}

/**
 * Mount with `app.use("/api", createBoardgameMatchRouter(...))`, after the
 * Telegram auth router. Apply rate limiting at the app or proxy layer: match
 * creation is the cheapest way for a caller to exhaust your storage.
 */
export function createBoardgameMatchRouter(options: MatchRouterOptions): Router {
  const router = Router();
  router.use(json({ limit: "8kb", type: "application/json" }));

  const requireSession = (req: Request, res: Response, next: NextFunction) => {
    const token = bearerFrom(req.headers.authorization);
    if (!token) return res.status(401).json({ error: "Missing session token" });
    try {
      res.locals.telegramUserId = verifySignedGameSession(token, options.signingSecret).userId;
      res.locals.sessionToken = token;
      return next();
    } catch {
      return res.status(401).json({ error: "Invalid session token" });
    }
  };

  router.post("/match/create", requireSession, async (_req, res, next) => {
    try {
      const matchID = await options.matchmaker.createMatch(res.locals.sessionToken);
      res.setHeader("cache-control", "no-store");
      return res.status(201).json({ matchID });
    } catch (error) {
      return next(error);
    }
  });

  router.post("/match/join", requireSession, async (req, res, next) => {
    const body = req.body as { matchID?: unknown; displayName?: unknown };
    if (typeof body?.matchID !== "string") {
      return res.status(400).json({ error: "matchID is required" });
    }
    try {
      const seat = await options.matchmaker.joinMatch({
        matchID: body.matchID,
        telegramUserId: res.locals.telegramUserId,
        sessionToken: res.locals.sessionToken,
        displayName: typeof body.displayName === "string" ? body.displayName : "Player",
      });
      res.setHeader("cache-control", "no-store");
      return res.status(200).json(seat);
    } catch (error) {
      if (error instanceof MatchmakingError) {
        return res.status(error.status).json({ error: error.message });
      }
      return next(error);
    }
  });

  /*
   * Session tokens outlive neither a long match nor a backgrounded WebView.
   * Refresh from the still-valid token: re-posting the original initData fails,
   * because its auth_date is fixed at launch and the verifier enforces a
   * freshness window of minutes.
   */
  router.post("/match/refresh-credentials", requireSession, async (_req, res, next) => {
    try {
      const refreshed = await options.refreshSession(res.locals.telegramUserId);
      res.setHeader("cache-control", "no-store");
      return res.status(200).json({
        sessionToken: refreshed.token,
        expiresAt: refreshed.expiresAt.toISOString(),
      });
    } catch (error) {
      return next(error);
    }
  });

  return router;
}

/*
 * Composition:
 *
 * import { Server, Origins } from "boardgame.io/server";
 * import { TicTacToe } from "./game";
 *
 * const signingSecret = process.env.SESSION_SIGNING_SECRET;
 * const LOBBY_PORT = 8001; // private: not routed by the public reverse proxy
 *
 * const bgio = Server({
 *   games: [TicTacToe],
 *   origins: [process.env.MINI_APP_ORIGIN, Origins.LOCALHOST_IN_DEVELOPMENT],
 *   db: new MyStorageConnector(),          // in-memory loses matches on restart
 *   ...createTelegramCredentialHooks(signingSecret),
 * });
 * bgio.run({ port: 8000, lobbyConfig: { apiPort: LOBBY_PORT } });
 *
 * const matchmaker = new TelegramMatchmaker({
 *   lobbyServer: `http://127.0.0.1:${LOBBY_PORT}`,
 *   gameName: "tic-tac-toe",
 *   numPlayers: 2,
 *   seats: createInMemorySeatStore(),      // replace before production
 * });
 *
 * app.use("/api", createTelegramAuthRouter({ botToken, sessionIssuer }));
 * app.use("/api", createBoardgameMatchRouter({ signingSecret, matchmaker, refreshSession }));
 */
