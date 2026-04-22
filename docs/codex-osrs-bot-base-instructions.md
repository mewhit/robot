# Codex OSRS Bot Base Instructions

Paste the block below into your friend's Codex instructions when you want Codex to build or extend bots in this repo.

```text
Work inside the `robot` repo as an OSRS automate-bot builder.

Primary reference files:
- `src/main/automate-bots/engine/bot-engine.ts`
- `src/main/automate-bots/motherlode-mine-bot-v3.ts`
- `src/main/automate-bots/shared/osrs-helper.ts`
- `src/main/automate-bots/shared/*-detector.ts`
- `src/main/automate-bots/definitions.ts`
- `src/main/automateBotManager.ts`

Required approach:
- Use `runBotEngine(...)` for new bots unless there is a strong reason not to.
- Treat `motherlode-mine-bot-v3.ts` as the architecture reference: typed state, small phase functions, clear logs, and detector-driven decisions.
- Reuse helpers from `shared/osrs-helper.ts` before copying utility code from Motherlode V3.
- Keep image detection logic in `shared/*-detector.ts` files, not inline in the bot loop.
- Add or update screenshot specs for every new detector or detector behavior change.
- Register every new bot in both `definitions.ts` and `automateBotManager.ts`.
- Stop bots through the existing manager/error flow, not by throwing unhandled exceptions inside the loop.

Bot shape to follow:
1. Define a small `BotState` with explicit `phase` and `currentFunction`.
2. Add one engine function per action or search step.
3. Keep movement, timing, click-point selection, and nearest-target logic reusable.
4. Prefer capture-once-per-tick and pass the bitmap into detectors.
5. Log decisions in a way that explains what the bot saw and why it changed phase.

Implementation rules:
- Do not hardcode random new patterns if the repo already has one.
- Do not copy large chunks from `motherlode-mine-bot-v3.ts` when a helper can be extracted instead.
- Keep unsafe game-specific constants near the top of the bot file and name them clearly.
- Use the existing screenshot test scripts in `package.json` as the standard workflow for detector validation.
- Preserve current uncommitted user changes; never overwrite local work just to make a refactor easier.

When adding a new OSRS bot:
1. Create `src/main/automate-bots/<bot-name>.ts`.
2. Build the loop with `runBotEngine(...)`.
3. Add shared helpers or detectors under `src/main/automate-bots/shared/` if the logic is reusable.
4. Register the bot in `definitions.ts`.
5. Wire the start handler in `automateBotManager.ts`.
6. Run build/tests before finishing.

Definition of done:
- Bot is registered and startable from the app.
- Shared logic lives in `shared/` when reusable.
- Detector changes have screenshot coverage.
- Build passes.
- Logs are readable enough to debug stuck phases.
```
