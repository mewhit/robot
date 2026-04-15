import { AppState } from "./global-state";

const SUPPORTED_BOT_IDS = new Set(["falador-rooftop"]);

export function sendAutomateBotState() {
  AppState.mainWindow?.webContents.send("automate-bot-state", {
    selectedBotId: AppState.selectedAutomateBotId,
    isRunning: AppState.automateBotRunning,
  });
}

export function setActiveView(view: "clicker" | "automateBot") {
  AppState.activeView = view;
}

export function setSelectedAutomateBotId(botId: string | null) {
  const normalized = typeof botId === "string" ? botId.trim() : "";
  AppState.selectedAutomateBotId = normalized.length > 0 ? normalized : null;

  if (AppState.automateBotRunning && AppState.selectedAutomateBotId === null) {
    AppState.automateBotRunning = false;
  }

  sendAutomateBotState();
}

export function stopAutomateBot(source: "f2" | "ui") {
  if (!AppState.automateBotRunning) {
    return;
  }

  AppState.automateBotRunning = false;
  sendAutomateBotState();
  console.log(`Automate Bot STOPPED via ${source.toUpperCase()}.`);
}

export function startSelectedAutomateBot(source: "f2" | "ui") {
  if (AppState.automateBotRunning) {
    return;
  }

  const selectedBotId = AppState.selectedAutomateBotId;
  if (!selectedBotId) {
    throw new Error("No Automate Bot is selected.");
  }

  if (!SUPPORTED_BOT_IDS.has(selectedBotId)) {
    throw new Error(`Unsupported Automate Bot: ${selectedBotId}`);
  }

  AppState.automateBotRunning = true;
  sendAutomateBotState();

  if (selectedBotId === "falador-rooftop") {
    console.log("Automate Bot STARTED (Falador Roof Top): Step 1 - Scroll down to maximum.");
  } else {
    console.log(`Automate Bot STARTED: ${selectedBotId}.`);
  }
}

export function toggleSelectedAutomateBot(source: "f2" | "ui") {
  if (AppState.automateBotRunning) {
    stopAutomateBot(source);
    return;
  }

  startSelectedAutomateBot(source);
}
