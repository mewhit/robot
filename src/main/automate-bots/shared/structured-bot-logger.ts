import * as logger from "../../logger";

type StructuredBotLoggerContext = {
  loopIndex: number;
  label: string;
};

type StructuredBotLoggerOptions = {
  includeBotPrefix?: boolean;
  maxStep?: number;
};

function formatElapsedSince(startedAtMs: number): string {
  const elapsedMs = Math.max(0, Date.now() - startedAtMs);
  const totalSeconds = Math.floor(elapsedMs / 1000);
  const mm = String(Math.floor(totalSeconds / 60)).padStart(2, "0");
  const ss = String(totalSeconds % 60).padStart(2, "0");
  const ms = String(elapsedMs % 1000).padStart(3, "0");
  return `+${mm}:${ss}.${ms}`;
}

function splitStepLabel(label: string): { step: string; phase: string } {
  const normalized = label.trim();
  const stepMatch = /^Step\s+([^\s]+)\s+(.+)$/i.exec(normalized);
  if (stepMatch) {
    return {
      step: stepMatch[1],
      phase: stepMatch[2],
    };
  }

  const match = /^([^\s]+)\s+(.+)$/.exec(normalized);
  if (!match) {
    return {
      step: normalized || "?",
      phase: "unknown",
    };
  }

  return {
    step: match[1],
    phase: match[2],
  };
}

function isStructuredMessage(message: string): boolean {
  return /^\[\+\d{2}:\d{2}\.\d{3}\]\s+#\d+\s+\[[^\]]+\]\s+\[[^\]]+\]/.test(message);
}

export function createStructuredBotLogger(botName: string, options: StructuredBotLoggerOptions = {}) {
  const startedAtMs = Date.now();
  const includeBotPrefix = options.includeBotPrefix ?? true;
  const maxStep = Number.isFinite(options.maxStep) && options.maxStep !== undefined ? Math.max(1, Math.floor(options.maxStep)) : null;
  let context: StructuredBotLoggerContext = {
    loopIndex: 0,
    label: "Step 0 startup",
  };

  function setContext(nextContext: Partial<StructuredBotLoggerContext>): void {
    context = {
      loopIndex:
        typeof nextContext.loopIndex === "number" && Number.isFinite(nextContext.loopIndex)
          ? Math.max(0, Math.floor(nextContext.loopIndex))
          : context.loopIndex,
      label: typeof nextContext.label === "string" && nextContext.label.trim().length > 0 ? nextContext.label : context.label,
    };
  }

  function format(label: string, message: string): string {
    const { step, phase } = splitStepLabel(label);
    const stepLabel = maxStep !== null ? `${step}/${maxStep}` : step;
    return `[${formatElapsedSince(startedAtMs)}] #${context.loopIndex} [${stepLabel}] [${phase}] ${message}`;
  }

  function normalize(message: string): string {
    return isStructuredMessage(message) ? message : format(context.label, message);
  }

  function withBotPrefix(message: string): string {
    return includeBotPrefix ? `Automate Bot (${botName}): ${message}` : message;
  }

  return {
    setContext,
    format,
    log(message: string): void {
      logger.log(withBotPrefix(normalize(message)));
    },
    warn(message: string): void {
      logger.warn(withBotPrefix(normalize(message)));
    },
    error(message: string): void {
      logger.error(withBotPrefix(normalize(message)));
    },
  };
}
