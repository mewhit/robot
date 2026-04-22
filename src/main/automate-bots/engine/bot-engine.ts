export type BotEngineLoopState<FunctionKey extends string> = {
  loopIndex: number;
  currentFunction: FunctionKey;
};

export type BotEngineFunction<State extends BotEngineLoopState<FunctionKey>, FunctionKey extends string> = (params: {
  state: State;
  nowMs: number;
}) => Promise<State> | State;

export type BotEngineFunctionMap<State extends BotEngineLoopState<FunctionKey>, FunctionKey extends string> = {
  [Key in FunctionKey]: BotEngineFunction<State, FunctionKey>;
};

export type RunBotEngineOptions<State extends BotEngineLoopState<FunctionKey>, FunctionKey extends string> = {
  tickMs: number;
  isRunning: () => boolean;
  createInitialState: () => State;
  functions: BotEngineFunctionMap<State, FunctionKey>;
  onTickError?: (error: unknown, state: State) => void;
};

export type MinePhaseState = {
  phase: "searching" | "mining";
};

export type CreateMineFunctionOptions<State extends MinePhaseState, Capture> = {
  capture: (
    state: State,
    nowMs: number,
  ) => Promise<{ state: State; capture: Capture }> | { state: State; capture: Capture };
  beforePhase?: (
    state: State,
    capture: Capture,
    nowMs: number,
  ) => Promise<State | null | undefined> | State | null | undefined;
  runSearchingPhase: (state: State, capture: Capture, nowMs: number) => Promise<State> | State;
  runMiningPhase: (state: State, capture: Capture, nowMs: number) => Promise<State> | State;
};

export function createMineFunction<State extends MinePhaseState, Capture>(
  options: CreateMineFunctionOptions<State, Capture>,
): (state: State, nowMs: number) => Promise<State> {
  return async (state: State, nowMs: number): Promise<State> => {
    const prepared = await options.capture(state, nowMs);
    const current = prepared.state;
    const capture = prepared.capture;

    if (options.beforePhase) {
      const earlyState = await options.beforePhase(current, capture, nowMs);
      if (earlyState) {
        return earlyState;
      }
    }

    if (current.phase === "searching") {
      return options.runSearchingPhase(current, capture, nowMs);
    }

    return options.runMiningPhase(current, capture, nowMs);
  };
}

export function sleepWithAbort(ms: number, isRunning: () => boolean): Promise<void> {
  return new Promise<void>((resolve) => {
    const tickMs = 50;
    let elapsedMs = 0;

    const timer = setInterval(() => {
      elapsedMs += tickMs;
      if (!isRunning() || elapsedMs >= ms) {
        clearInterval(timer);
        resolve();
      }
    }, tickMs);
  });
}

export async function runBotEngine<State extends BotEngineLoopState<FunctionKey>, FunctionKey extends string>(
  options: RunBotEngineOptions<State, FunctionKey>,
): Promise<void> {
  let state = options.createInitialState();

  while (options.isRunning()) {
    const tickStartedAt = Date.now();
    state = {
      ...state,
      loopIndex: state.loopIndex + 1,
    };

    const tickFunction = options.functions[state.currentFunction];
    try {
      state = await tickFunction({
        state,
        nowMs: tickStartedAt,
      });
    } catch (error) {
      options.onTickError?.(error, state);
    }

    const tickElapsedMs = Date.now() - tickStartedAt;
    const remainingTickMs = options.tickMs - tickElapsedMs;
    const sleepMs = remainingTickMs > 0 ? remainingTickMs : 1;
    await sleepWithAbort(sleepMs, options.isRunning);
  }
}
