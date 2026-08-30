# boardgame.io for Telegram Mini App Games

Read this when the game in `TELEGRAM_GAME_SPEC.md` is **turn-based with discrete moves** and the user has chosen, or would benefit from, the [boardgame.io](https://boardgame.io) engine. It covers only the Telegram-specific integration; the engine's own rules API (moves, phases, stages, turn order, plugins) is documented upstream.

Nothing here replaces the skill's non-negotiable rules. boardgame.io gives you an authoritative game master; it does **not** give you Telegram identity, and its `credentials` are not a Telegram session.

Verified against boardgame.io `0.50.x` (MIT). Confirm current API shapes against the version you install.

## When it fits

| Fits well | Fits badly |
|---|---|
| Discrete turns and legal-move validation: cards, board, word, deduction, trick-taking, drafting, async "play a move a day". | Real-time action, physics, continuous input, per-frame state, or anything needing sub-100 ms authoritative ticks. |
| Server-authoritative rules where the client must not be trusted. | Purely local single-player arcade games — the engine adds a server and a reducer you do not need. |
| Hidden information (`playerView`), randomness the server owns (`ctx.random`), spectators, replay/undo. | Games whose state is large per frame; every move round-trips a state delta over socket.io. |

If the loop is real-time, say so and pick a plain authoritative WebSocket server instead. Do not force a turn engine onto an action game.

## Architecture map

| Piece | Import | Runs | Telegram role |
|---|---|---|---|
| Game definition | `boardgame.io/core` | Both | Pure rules. Shared by client and master; keep it free of `window`, `Telegram`, and DOM. |
| Client | `boardgame.io/client`, `/react` | Mini App WebView | Optimistic local copy plus transport. Wrapped by your platform adapter, never the reverse. |
| Master | internal to Server | Node process | Single source of truth for game state. |
| Lobby REST API | Koa router on the Server | Node process | Create/join/leave matches, issue seat credentials. **This is the identity seam.** |
| Transport | `boardgame.io/multiplayer` (`SocketIO`, `Local`) | Both | `Local()` for browser-mock and pass-and-play; `SocketIO()` against the deployed origin. |
| Storage | `db` option | Node process | In-memory by default — matches vanish on restart. Use a real connector for anything a player can resume. |

Your game code depends on the boardgame.io client **and** on `templates/telegram-platform-adapter.ts`. It must not reach for `window.Telegram` directly, and the boardgame.io `game` object must not import the adapter.

## The identity bridge

boardgame.io addresses players by **ordinal seat** (`playerID` = `'0'`, `'1'`, …). Telegram addresses players by **numeric user ID**. Binding the two is the whole integration, and the `join` call is where it happens.

Read `credentials` correctly before designing anything:

- `generateCredentials(ctx)` runs on `POST /games/{name}/{id}/join` and returns the value stored in that seat's metadata.
- `authenticateCredentials(credentials, playerMetadata)` runs on every move over the socket transport and on the credential-bearing Lobby routes (`update`, `leaveSlot`, `leaveGame`, `playAgain`).
- The stored value is **compared**, not presented. Follow the upstream pattern: store a stable public user identifier in metadata, and require the client to present a **signed, short-lived session token** whose subject matches it. A stored `tg:<user_id>` is safe under this pattern and unsafe if you treat it as a bearer secret.
- Defaults are not this. Without a `generateCredentials` override the server hands out a random `nanoid` — a bearer token with no link to Telegram, which any client that obtains it can replay.

Recommended flow, reusing the templates this skill already provides:

1. Mini App bootstraps a session: `bootstrapTelegramSession()` POSTs raw `initData` to `/api/auth/telegram`; `templates/telegram-init-data-verifier.ts` validates the HMAC and freshness; the auth router returns a signed session token whose `sub` is the Telegram user ID.
2. Mini App asks **your** API — not the Lobby API — to find or create a match, sending the session token.
3. Your API calls the Lobby API server-side (`create`, then `join` with an explicit `playerID`), forwarding the session token as an `Authorization` header.
4. `generateCredentials(ctx)` verifies that header and stores `tg:<sub>` as the seat's credentials.
5. Your API returns `{ matchID, playerID, credentials: <session token> }` to the Mini App.
6. The Mini App constructs `Client({ game, multiplayer: SocketIO({ server }), matchID, playerID, credentials })`.
7. Every move carries the session token; `authenticateCredentials` re-verifies its signature and expiry and compares `sub` against the seat's stored `tg:<sub>`.

Copy `templates/boardgame-io-telegram-server.ts` and `templates/boardgame-io-telegram-client.ts` rather than improvising this.

### Keep the Lobby API private

The Lobby API is unauthenticated by design apart from `generateCredentials`. Anyone who can reach it can enumerate matches, create matches at will, and take any free seat in a match whose ID they know. Run it on a separate port (`server.run({ port, lobbyConfig: { apiPort } })`) and do not route that port through your public reverse proxy. Expose only your own game API and the socket transport path.

If you must expose it publicly, gate `create` and `join` with Koa middleware on `server.router` that rejects requests without a verified session, and rate-limit both. Note that router-level middleware runs before the routes' body parser, so read the session from the `Authorization` header and the match ID from `ctx.path` — not from `ctx.request.body`.

### What match metadata leaks

`GET /games/{name}` and `GET /games/{name}/{id}` strip `credentials` but return each seat's `name` and `data` verbatim to any caller. Put a display name there and nothing else. Never store Telegram user IDs, usernames, photo URLs, `query_id`, or session tokens in `playerName` or `data`.

## Telegram-specific traps

| Trap | What goes wrong | Do this |
|---|---|---|
| Debug panel shipped | boardgame.io's Debug UI lets anyone switch `playerID` and dispatch arbitrary moves, and it is unusable at phone width. | Pass `debug: false` in every non-development build. Gate it on an explicit dev flag, not on `NODE_ENV` alone. |
| Session expiry mid-match | The signed session token expires (an hour by default) while a long match is open, and every subsequent move is rejected. | Refresh before expiry from the **existing valid token**, then call `client.updateCredentials(next)`. Re-POSTing the original `initData` will fail: its `auth_date` is fixed at launch and the verifier's freshness window is minutes. |
| WebView suspension | Telegram mobile clients suspend backgrounded WebViews; the socket drops and the local optimistic state drifts. | On the adapter's `onLifecycleChange(active)`, refresh credentials if needed and check `client.getState().isConnected` before re-enabling move input. socket.io reconnects and the master re-syncs — render a reconnecting state rather than accepting taps. |
| Client-visible secret state | The whole `G` is broadcast by default, so hands, decks, and hidden roles are readable in the WebView. | Set `playerView` (or `PlayerView.STRIP_SECRETS`) and keep secrets under it. Disable optimistic updates for moves that read stripped state. |
| Client-side randomness | `Math.random()` in a move desyncs the optimistic client from the master. | Use the engine's `random` plugin (`ctx.random` / the `random` move argument) for every shuffle and roll. |
| Ephemeral hosting | socket.io needs a long-lived process with sticky connections; serverless functions and scale-to-zero platforms drop matches. | Deploy the master as an always-on service, as the skill's Phase 2 already requires. Bot webhooks may stay serverless; the game master may not. |
| In-memory storage | The default `db` loses every match on deploy or restart — including matches a player was invited to by deep link. | Choose a storage connector before the first real-client test if matches outlive a session. |
| Missing `origins` | The Mini App loads and then silently fails to connect. | Set `origins` to the deployed Mini App HTTPS origin (plus `Origins.LOCALHOST_IN_DEVELOPMENT`). The Mini App's origin is your domain, not `telegram.org`. |

## Deep links and match invites

Default match IDs are `nanoid(11)` over `A-Za-z0-9_-`, which is exactly the character set a Telegram `startapp` parameter accepts and well inside its 64-character limit. A match ID can therefore travel in a link without encoding:

```
https://t.me/<bot>/<app>?startapp=<matchID>
```

Read it through the adapter's `startParam`, never from `initDataUnsafe`, and treat it as an untrusted string: an arbitrary match ID only ever grants what your own join API decides to grant. Validate the format, confirm the match exists and has a free seat, and enforce one seat per Telegram user before joining. For a chat challenge, prefix the parameter (`m-<matchID>`) so you can route several link types through one entry point.

## Fitting it into the skill's phases

Phase 2 — record in `TELEGRAM_GAME_SPEC.md` that the engine is boardgame.io, whether the master is `Local()` or `SocketIO()`, the storage connector, and where the Lobby API is exposed.

Phase 3 — the dev route should mount a `Local()` client with `bots: { '1': MCTSBot }` (from `boardgame.io/ai`) or a second seat, so the loop is playable in a normal browser with the mock adapter and no server.

Phase 4 — insert these into `SYSTEMS.md` around the default order:

1. game definition and move validation, tested headlessly against the engine's own test client;
2. board rendering through the platform adapter, themed and safe-area aware;
3. `Local()` multiplayer or a bot opponent for browser play;
4. Telegram session bootstrap, then the seat-binding join API;
5. `SocketIO()` against the deployed origin, with reconnect and credential refresh;
6. storage connector and match resume;
7. `playerView` and secret state, if in scope;
8. deep-link invites, rematch (`playAgain`), and abandonment (`leaveGame` / `onPlayerLeave`).

Phase 5 — beyond the standard protocol, verify in a real Telegram client: two devices in one match; a move rejected for a wrong seat; background and resume mid-turn; an expired session token followed by a refresh; a deep-link join by a second account; a duplicate join attempt by the same account; and a server restart if storage is meant to survive it.

## Sources

[1]: https://github.com/boardgameio/boardgame.io "boardgame.io"
[2]: https://boardgame.io/documentation/#/api/Server "boardgame.io: Server API"
[3]: https://boardgame.io/documentation/#/api/Lobby "boardgame.io: Lobby API"
[4]: https://boardgame.io/documentation/#/secret-state "boardgame.io: Secret state"
[5]: https://boardgame.io/documentation/#/storage "boardgame.io: Storage"
[6]: https://core.telegram.org/bots/webapps "Telegram Mini Apps"
