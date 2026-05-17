import { AppState } from "./global-state";
import { onAgilityBotStart } from "./automate-bots/agility-bot";
import { onAttackZamorakWarriorSafeSpotBotStart } from "./automate-bots/attack-zamorak-warrior-safe-spot-bot";
import { onCombatAutoBotStart } from "./automate-bots/combat/auto-bot";
import { onEndToEndBotStart } from "./automate-bots/end-to-end-bot";
import {
  onMiningGuildCoalOreBotStart,
  onMiningGuildMithrilOreBotStart,
} from "./automate-bots/mining-guild-mithril-ore-bot";
import { onMotherlodeMineBotStart } from "./automate-bots/motherlode-mine-bot";
import { onMotherlodeMineBotV2Start } from "./automate-bots/motherlode-mine-bot-v2";
import { onMotherlodeMineBotV3Start } from "./automate-bots/motherlode-mine-bot-v3";
import {
  onRunecraftingArceuusBloodRuneV2BotStart,
  onRunecraftingArceuusBloodRuneV2BotStartFromStep,
} from "./automate-bots/runecrafting-arceuus-blood-rune-bot-v2";
import { onRunecraftingGuardianOfTheRiftBotStart } from "./automate-bots/runecrafting-guardian-of-the-rift-bot";
import {
  AUTOMATE_BOTS,
  AGILITY_BOT_ID,
  ATTACK_ZAMORAK_WARRIOR_SAFE_SPOT_BOT_ID,
  COMBAT_AUTO_BOT_ID,
  END_TO_END_BOT_ID,
  DEFAULT_AUTOMATE_BOT_ID,
  MINING_GUILD_COAL_ORE_BOT_ID,
  MINING_GUILD_MITHRIL_ORE_BOT_ID,
  MINING_MOTHERLODE_MINE_BOT_ID,
  MINING_MOTHERLODE_MINE_V2_BOT_ID,
  MINING_MOTHERLODE_MINE_V3_BOT_ID,
  RUNECRAFTING_ARCEUUS_BLOOD_RUNE_V2_BOT_ID,
  RUNECRAFTING_GUARDIAN_OF_THE_RIFT_BOT_ID,
  normalizeAutomateBotId,
} from "./automate-bots/definitions";
import { flushOcrDebugDirectory } from "./automate-bots/shared/ocr-engine";
import { readStartupPlayerTileCalibration } from "./automate-bots/shared/startup-calibration";
import { startAutomateBotLogSession, stopAutomateBotLogSession } from "./automateBotLogs";
import { CHANNELS } from "./ipcChannels";
import { getSavedSelectedAutomateBotId, setSavedSelectedAutomateBotId } from "./csvOperator";
import { alignRuneLiteWindowBoundsForAutomateBot, getRuneLite } from "./runeLiteWindow";

const botStartHandlers = new Map<string, () => void>([
  [AGILITY_BOT_ID, onAgilityBotStart],
  [ATTACK_ZAMORAK_WARRIOR_SAFE_SPOT_BOT_ID, onAttackZamorakWarriorSafeSpotBotStart],
  [COMBAT_AUTO_BOT_ID, onCombatAutoBotStart],
  [END_TO_END_BOT_ID, onEndToEndBotStart],
  [MINING_GUILD_COAL_ORE_BOT_ID, onMiningGuildCoalOreBotStart],
  [MINING_GUILD_MITHRIL_ORE_BOT_ID, onMiningGuildMithrilOreBotStart],
  [MINING_MOTHERLODE_MINE_BOT_ID, onMotherlodeMineBotStart],
  [MINING_MOTHERLODE_MINE_V2_BOT_ID, onMotherlodeMineBotV2Start],
  [MINING_MOTHERLODE_MINE_V3_BOT_ID, onMotherlodeMineBotV3Start],
  [RUNECRAFTING_ARCEUUS_BLOOD_RUNE_V2_BOT_ID, onRunecraftingArceuusBloodRuneV2BotStart],
  [RUNECRAFTING_GUARDIAN_OF_THE_RIFT_BOT_ID, onRunecraftingGuardianOfTheRiftBotStart],
]);

const botStartFromStepHandlers = new Map<string, (stepId: string) => void>([
  [RUNECRAFTING_ARCEUUS_BLOOD_RUNE_V2_BOT_ID, onRunecraftingArceuusBloodRuneV2BotStartFromStep],
]);

function getAutomateBotName(botId: string): string {
  return AUTOMATE_BOTS.find((bot) => bot.id === botId)?.name ?? botId;
}

function getAutomateBotVersionName(botId: string): string | undefined {
  return AUTOMATE_BOTS.find((bot) => bot.id === botId)?.versionName;
}

function cacheStartupPlayerTileCalibration(botId: string): void {
  AppState.automateBotStartupRawTilePx = null;

  if (botId !== RUNECRAFTING_GUARDIAN_OF_THE_RIFT_BOT_ID) {
    return;
  }

  try {
    const window = alignRuneLiteWindowBoundsForAutomateBot(botId) ?? getRuneLite();
    if (!window) {
      return;
    }

    if (!window.isVisible()) {
      window.show();
    }

    window.bringToTop();

    const calibration = readStartupPlayerTileCalibration(window);
    if (!calibration) {
      return;
    }

    AppState.automateBotStartupRawTilePx =
      calibration.rawTilePx !== null && Number.isFinite(calibration.rawTilePx) && calibration.rawTilePx > 0
        ? calibration.rawTilePx
        : null;
  } catch (error) {
    AppState.automateBotStartupRawTilePx = null;
  }
}

export function sendAutomateBotState() {
  AppState.mainWindow?.webContents.send(CHANNELS.AUTOMATE_BOT_STATE, {
    selectedBotId: AppState.selectedAutomateBotId,
    isRunning: AppState.automateBotRunning,
    currentStepId: AppState.automateBotCurrentStepId,
  });
}

export function setAutomateBotCurrentStep(stepId: string | null) {
  AppState.automateBotCurrentStepId = stepId;
  sendAutomateBotState();
}

export function setActiveView(view: "clicker" | "automateBot" | "stats" | "map" | "debug") {
  AppState.activeView = view;
}

export function setSelectedAutomateBotId(botId: string | null) {
  AppState.selectedAutomateBotId = normalizeAutomateBotId(botId) ?? DEFAULT_AUTOMATE_BOT_ID;
  setSavedSelectedAutomateBotId(AppState.selectedAutomateBotId ?? "");

  if (AppState.automateBotRunning && AppState.selectedAutomateBotId === null) {
    AppState.automateBotRunning = false;
  }

  sendAutomateBotState();
}

export function loadSavedAutomateBotSelection() {
  const savedBotId = getSavedSelectedAutomateBotId();
  AppState.selectedAutomateBotId = normalizeAutomateBotId(savedBotId) ?? DEFAULT_AUTOMATE_BOT_ID;
}

export function stopAutomateBot(source: "f4" | "ui" | "bot") {
  if (!AppState.automateBotRunning) {
    return;
  }

  stopAutomateBotLogSession(source, "bot-stopped");
  AppState.automateBotRunning = false;
  AppState.automateBotCurrentStepId = null;
  sendAutomateBotState();
  console.log(`Automate Bot STOPPED via ${source.toUpperCase()}.`);
}

export function startSelectedAutomateBot(source: "f4" | "ui") {
  if (AppState.automateBotRunning) {
    return;
  }

  const selectedBotId = AppState.selectedAutomateBotId ?? DEFAULT_AUTOMATE_BOT_ID;
  if (!selectedBotId) {
    throw new Error("No Automate Bot is selected.");
  }

  const selectedBotStartHandler = botStartHandlers.get(selectedBotId);
  if (!selectedBotStartHandler) {
    throw new Error(`Unsupported Automate Bot: ${selectedBotId}`);
  }

  flushOcrDebugDirectory();

  startAutomateBotLogSession(selectedBotId, source, getAutomateBotVersionName(selectedBotId));
  cacheStartupPlayerTileCalibration(selectedBotId);
  AppState.automateBotRunning = true;
  sendAutomateBotState();
  selectedBotStartHandler();
}

export function startAutomateBotFromStep(stepId: string) {
  if (AppState.automateBotRunning) {
    return;
  }

  let matchedBotId: string | null = null;
  let matchedHandler: ((stepId: string) => void) | null = null;

  for (const [botId, handler] of botStartFromStepHandlers) {
    if (stepId === botId || stepId.startsWith(`${botId}-step-`) || stepId.startsWith(`${botId}:`)) {
      matchedBotId = botId;
      matchedHandler = handler;
      break;
    }
  }

  if (!matchedBotId || !matchedHandler) {
    throw new Error(`Unknown step ID: ${stepId}`);
  }

  flushOcrDebugDirectory();

  startAutomateBotLogSession(matchedBotId, "ui", getAutomateBotVersionName(matchedBotId));
  cacheStartupPlayerTileCalibration(matchedBotId);
  AppState.selectedAutomateBotId = matchedBotId;
  setSavedSelectedAutomateBotId(matchedBotId);
  AppState.automateBotRunning = true;
  sendAutomateBotState();
  matchedHandler(stepId);
}

export function toggleSelectedAutomateBot(source: "f4" | "ui") {
  if (AppState.automateBotRunning) {
    stopAutomateBot(source);
    return;
  }

  startSelectedAutomateBot(source);
}
