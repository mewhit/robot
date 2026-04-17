import * as logger from "../logger";
import { stopAutomateBot } from "../automateBotManager";
import { initAgilityBotV2 } from "./shared/init-bot.v2";

export const AGILITY_BOT_ID = "agility";

let isAgilityV2StartupRunning = false;
let agilityV2StartedAtMs: number | null = null;

function formatElapsedSinceStart(): string {
  if (agilityV2StartedAtMs === null) {
    return "+0ms";
  }

  const elapsedMs = Math.max(0, Date.now() - agilityV2StartedAtMs);
  const totalSeconds = Math.floor(elapsedMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const milliseconds = elapsedMs % 1000;

  const mm = String(minutes).padStart(2, "0");
  const ss = String(seconds).padStart(2, "0");
  const mmm = String(milliseconds).padStart(3, "0");
  return `+${mm}:${ss}.${mmm}`;
}

function logWithDelta(message: string): void {
  logger.log(`[${formatElapsedSinceStart()}] ${message}`);
}

function errorWithDelta(message: string): void {
  logger.error(`[${formatElapsedSinceStart()}] ${message}`);
}

async function runAgilityV2StartupCheck(): Promise<void> {
  if (isAgilityV2StartupRunning) {
    logWithDelta("Automate Bot (Agility V2): startup check already running.");
    return;
  }

  isAgilityV2StartupRunning = true;

  try {
    const initResult = await initAgilityBotV2();
    if (!initResult.ok) {
      return;
    }

    const detections = initResult.detections;
    logWithDelta(
      `Automate Bot (Agility V2): startup check passed - coordinate-box='${detections?.coordinateBox?.matchedLine}', tile-location='${detections?.tileLocation?.matchedLine}', agility=${detections?.agility?.color}.`,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    errorWithDelta(`Automate Bot (Agility V2): startup check crashed - ${message}`);
  } finally {
    isAgilityV2StartupRunning = false;
    agilityV2StartedAtMs = null;
    stopAutomateBot("bot");
  }
}

export function onAgilityBotStart(): void {
  if (!isAgilityV2StartupRunning) {
    agilityV2StartedAtMs = Date.now();
  }

  logWithDelta("Automate Bot STARTED (Agility V2 preflight).");
  void runAgilityV2StartupCheck();
}
