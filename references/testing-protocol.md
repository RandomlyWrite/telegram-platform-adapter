# Telegram Game Testing Protocol

Run this after every implemented system and again as a complete release playtest. A screenshot of an idle game screen is not a pass; exercise the player behavior and observe the specific expected outcome.

## 1. Start with the local browser harness

1. Start the project’s local development server and open the persistent dev route/scene.
2. Confirm the adapter chooses **mock mode** outside Telegram and displays no real user identity, entitlement, or bot-only capability.
3. Reset the fixture state. Exercise the system exactly as a player would, including touch/click/key input and relevant failure states.
4. Check the console and network log. A system-specific exception, failed asset request, unexpected retry, or leaking sensitive data is a failure.
5. Test at representative small and desktop viewport sizes. Change the mock theme and safe-area fixtures when the system affects layout.
6. Capture before/after evidence only when it helps diagnose the behavior. Record action, observation, and pass/fail in `SYSTEMS.md`.

If the system fails, fix and repeat this section. Do not move to another system.

## 2. Test backend trust boundaries

Run these checks for any system involving session bootstrap, score, save, reward, referral, leaderboard, purchase, or room state.

| Test | Expected result |
|---|---|
| Valid raw `initData` | Server verifies it and creates the minimal permitted game session. |
| Invalid signature | Server rejects it without creating a session or disclosing verification detail. |
| Expired launch data | Server rejects it under the project’s documented freshness policy. |
| Replayed/duplicated state-changing request | Server response is idempotent; score/reward/purchase is not duplicated. |
| Altered client score/currency/inventory | Server rejects, clamps, or recomputes according to the declared trust model. |
| Unauthenticated cross-user request | Server rejects it; no other player data becomes visible or writable. |
| Rate limit/error path | Game recovers with player-safe messaging and no infinite retry loop. |

Use synthetic test identities and fixtures. Do not put a bot token, raw production `initData`, private user record, or purchase payload in source code, screenshots, `SYSTEMS.md`, or `PLAYTEST.md`.

## 3. Test in a real Telegram client

Complete this section for every Telegram-dependent system after deploying to the intended HTTPS origin.

1. Launch from the configured surface: profile/main app, menu, inline button, direct link, or legacy game message.
2. Confirm the game loads from the configured origin and the server receives and validates a genuine client launch. Verify that no fatal error appears when a Telegram capability is unavailable.
3. Exercise the system and confirm the end-to-end result. For a score system, play a round, submit it, refresh/relaunch, and verify the stored/displayed result. For a shared feature, test the recipient/room path in an actual chat.
4. Test light/dark theme, small safe areas, app background/foreground transition, and launch restart. Test fullscreen, orientation, haptics, motion, or storage only if the game uses them.
5. Repeat on every declared platform. Touch-first games require a mobile-client check. Test Telegram Desktop when keyboard/mouse support is advertised.
6. Record Telegram app version/platform, launch method, action, expected result, observed result, and pass/fail in `PLAYTEST.md` or `SYSTEMS.md`.

## 4. Legacy Bot API Games only

If the project uses legacy Bot API Games, verify the entire bot loop in a real chat:

1. Send the game message.
2. Select the game launch button and receive the callback.
3. Answer the callback with the HTTPS game URL.
4. Load and play the game through Telegram.
5. Submit an authenticated server-side score.
6. Retrieve or show the expected scoreboard.

A direct browser visit to the game URL is not a substitute for this test.

## 5. Full release playtest

After all rows are `done`, start at the public Telegram entry point and complete a real player session from launch to declared finish. Run cold start, resume, temporary offline/error recovery, and relevant social/purchase flows. Attempt invalid/expired identity, duplicate requests, and manipulated client values. Review errors/analytics with sensitive data redacted.

Write results, known issues, client coverage, configuration state, and release decision in `PLAYTEST.md` and `INTEGRATION_STATUS.md`. Do not claim readiness until all required flows pass or the user explicitly accepts a documented limitation.

## Official sources

[1]: https://core.telegram.org/bots/webapps "Telegram Mini Apps"
[2]: https://core.telegram.org/bots/api#validating-data-received-via-the-mini-app "Telegram Bot API: Validating data received via the Mini App"
[3]: https://core.telegram.org/bots/api#games "Telegram Bot API: Games"
