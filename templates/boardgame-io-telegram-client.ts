/*
 * boardgame.io client for a Telegram Mini App.
 *
 * Required packages:
 *   npm install boardgame.io
 *
 * Copy this beside telegram-platform-adapter.ts. It owns the seam between the
 * Telegram platform adapter and the boardgame.io client: session bootstrap,
 * seat resolution, credential refresh, and connection state. Game and board
 * code should depend on the returned handle, not on window.Telegram and not on
 * the transport.
 *
 * Read references/boardgame-io.md before changing the credential handling.
 */

import { Client } from "boardgame.io/client";
import { Local, SocketIO } from "boardgame.io/multiplayer";
import type { Game } from "boardgame.io";
import {
  bootstrapTelegramSession,
  type TelegramGamePlatform,
  type TelegramSession,
} from "./telegram-platform-adapter.js";

/** boardgame.io does not export its client class; derive it. Needs TypeScript 4.7+. */
export type BoardgameClient<G = any> = ReturnType<typeof Client<G>>;

export interface TelegramBoardgameOptions<G = any> {
  readonly platform: TelegramGamePlatform;
  readonly game: Game<G>;
  /** Origin of the boardgame.io socket transport, e.g. 'https://game.example.com'. */
  readonly gameServer: string;
  /** Base path of your own game API. Never the boardgame.io Lobby API. */
  readonly apiBase?: string;
  /** Name shown to opponents. Public to anyone holding the match ID. */
  readonly displayName?: string;
  /** Refresh the session token this many seconds before it expires. */
  readonly refreshLeadSeconds?: number;
  /** Ship `true` only behind an explicit development flag. See below. */
  readonly debug?: boolean;
  readonly fetchImpl?: typeof fetch;
}

export interface TelegramBoardgameHandle<G = any> {
  readonly client: BoardgameClient<G>;
  readonly matchID: string;
  readonly playerID: string;
  /** True while the transport is connected to the master. Gate move input on it. */
  isConnected(): boolean;
  /** Stop timers, listeners, and the transport. */
  dispose(): void;
}

interface MatchSeat {
  readonly matchID: string;
  readonly playerID: string;
}

/**
 * A browser-mock client. No Telegram identity, no server, no trust: use it for
 * the dev route and local loop work only.
 *
 * `bots` accepts boardgame.io/ai bots, e.g. `{ '1': MCTSBot }`. They are ignored
 * unless the game definition also provides `ai: { enumerate }`.
 */
export function createMockBoardgameClient<G = any>(
  game: Game<G>,
  options: { playerID?: string; bots?: Record<string, any>; debug?: boolean } = {},
): BoardgameClient<G> {
  const client = Client<G>({
    game,
    multiplayer: Local(options.bots ? { bots: options.bots } : undefined),
    playerID: options.playerID ?? "0",
    debug: options.debug ?? false,
  });
  client.start();
  return client;
}

/**
 * Bootstrap a verified, seated, connected boardgame.io client inside Telegram.
 *
 * Throws when the launch is not a genuine Telegram launch. Fall back to
 * createMockBoardgameClient for browser development rather than loosening this.
 */
export async function createTelegramBoardgameClient<G = any>(
  options: TelegramBoardgameOptions<G>,
): Promise<TelegramBoardgameHandle<G>> {
  const {
    platform,
    game,
    gameServer,
    apiBase = "/api",
    displayName = "Player",
    refreshLeadSeconds = 120,
    fetchImpl = fetch,
  } = options;

  if (!platform.isTelegram) {
    throw new Error("createTelegramBoardgameClient requires a genuine Telegram launch");
  }

  let session = await bootstrapTelegramSession(platform, `${apiBase}/auth/telegram`, fetchImpl);

  const api = async <T>(path: string, body: unknown): Promise<T> => {
    const response = await fetchImpl(`${apiBase}${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${session.sessionToken}`,
      },
      body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error(`${path} failed (${response.status})`);
    return (await response.json()) as T;
  };

  // startParam is untrusted input. The server decides whether this match ID
  // exists, has a free seat, and may be joined by this user.
  const invitedMatchID = parseMatchInvite(platform.startParam);
  const matchID =
    invitedMatchID ?? (await api<{ matchID: string }>("/match/create", {})).matchID;
  const seat = await api<MatchSeat>("/match/join", { matchID, displayName });

  const client = Client<G>({
    game,
    multiplayer: SocketIO({ server: gameServer }),
    matchID: seat.matchID,
    playerID: seat.playerID,
    credentials: session.sessionToken,
    // The debug panel can switch seats and dispatch arbitrary moves, and it is
    // unusable at phone width. Never enable it in a shipped Mini App build.
    debug: options.debug ?? false,
  });
  client.start();

  /* --- credential refresh ------------------------------------------------ */

  let refreshTimer: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;

  const refreshNow = async (): Promise<void> => {
    if (disposed) return;
    try {
      const refreshed = await api<{ sessionToken: string; expiresAt: string }>(
        "/match/refresh-credentials",
        {},
      );
      session = { ...session, ...refreshed } as TelegramSession;
      client.updateCredentials(session.sessionToken);
    } catch {
      // Leave the stale token in place; moves will be rejected until the next
      // attempt succeeds. Surface a reconnect prompt in the UI rather than
      // silently dropping the player's input.
    } finally {
      scheduleRefresh();
    }
  };

  const scheduleRefresh = (): void => {
    if (disposed) return;
    if (refreshTimer) clearTimeout(refreshTimer);
    const msUntilRefresh =
      new Date(session.expiresAt).valueOf() - Date.now() - refreshLeadSeconds * 1_000;
    refreshTimer = setTimeout(() => void refreshNow(), Math.max(msUntilRefresh, 5_000));
  };
  scheduleRefresh();

  /* --- lifecycle --------------------------------------------------------- */

  // Telegram mobile clients suspend backgrounded WebViews: the socket drops and
  // the token may have expired while the app was away.
  const stopLifecycle = platform.onLifecycleChange((active) => {
    if (!active || disposed) return;
    const expiresInMs = new Date(session.expiresAt).valueOf() - Date.now();
    if (expiresInMs < refreshLeadSeconds * 1_000) void refreshNow();
  });

  return {
    client,
    matchID: seat.matchID,
    playerID: seat.playerID,
    isConnected: () => client.getState()?.isConnected === true,
    dispose: () => {
      disposed = true;
      if (refreshTimer) clearTimeout(refreshTimer);
      stopLifecycle();
      client.stop();
    },
  };
}

/**
 * Read a match invite out of a `?startapp=` value.
 *
 * Default boardgame.io match IDs are nanoid(11) over `A-Za-z0-9_-`, which is
 * exactly what Telegram accepts in startapp, so no encoding is needed. Prefix
 * the value when one entry point routes several link types.
 */
export function parseMatchInvite(startParam: string | null): string | null {
  if (!startParam) return null;
  const value = startParam.startsWith("m-") ? startParam.slice(2) : startParam;
  return /^[A-Za-z0-9_-]{1,64}$/.test(value) ? value : null;
}

/** Build the invite link for a match. */
export function matchInviteLink(botUsername: string, appName: string, matchID: string): string {
  return `https://t.me/${botUsername}/${appName}?startapp=m-${matchID}`;
}

/*
 * Usage:
 *
 * const platform = createTelegramGamePlatform();
 * platform.ready();
 *
 * const handle = platform.isTelegram
 *   ? await createTelegramBoardgameClient({ platform, game: TicTacToe, gameServer: GAME_SERVER })
 *   : { client: createMockBoardgameClient(TicTacToe, { bots: { "1": MCTSBot } }) };
 *
 * handle.client.subscribe((state) => {
 *   if (state === null) return;              // remote master: null until synced
 *   renderBoard(state, { canMove: handle.isConnected?.() ?? true });
 * });
 */
