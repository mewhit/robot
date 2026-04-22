export type BotEngineLoopState<FunctionKey extends string> = {
  loopIndex: number;
  currentFunction: FunctionKey;
};

export type BotEngineFunction<
  State extends BotEngineLoopState<FunctionKey>,
  FunctionKey extends string,
  TickCapture = undefined,
> = (params: { state: State; nowMs: number; tickCapture: TickCapture }) => Promise<State> | State;

export type BotEngineFunctionMap<State extends BotEngineLoopState<FunctionKey>, FunctionKey extends string, TickCapture = undefined> = {
  [Key in FunctionKey]: BotEngineFunction<State, FunctionKey, TickCapture>;
};

export type RunBotEngineOptions<State extends BotEngineLoopState<FunctionKey>, FunctionKey extends string, TickCapture = undefined> = {
  tickMs: number;
  isRunning: () => boolean;
  createInitialState: () => State;
  captureTick?: (params: { state: State; nowMs: number }) => Promise<TickCapture> | TickCapture;
  functions: BotEngineFunctionMap<State, FunctionKey, TickCapture>;
  onTickError?: (error: unknown, state: State) => void;
};

export type OrsrPhaseState = {
  phase: "mining" | "searching" | "moving" | "depositing";
};

export type CreateMineFunctionOptions<State extends OrsrPhaseState, Capture, TickCapture = undefined> = {
  capture: (
    state: State,
    nowMs: number,
    tickCapture: TickCapture,
  ) => Promise<{ state: State; capture: Capture }> | { state: State; capture: Capture };
  beforePhase?: (
    state: State,
    capture: Capture,
    nowMs: number,
    tickCapture: TickCapture,
  ) => Promise<State | null | undefined> | State | null | undefined;
  runMiningPhase: (state: State, capture: Capture, nowMs: number, tickCapture: TickCapture) => Promise<State> | State;
};

export function createMineFunction<State extends OrsrPhaseState, Capture, TickCapture = undefined>(
  options: CreateMineFunctionOptions<State, Capture, TickCapture>,
): (state: State, nowMs: number, tickCapture: TickCapture) => Promise<State> {
  return async (state: State, nowMs: number, tickCapture: TickCapture): Promise<State> => {
    const prepared = await options.capture(state, nowMs, tickCapture);
    const current = prepared.state;
    const capture = prepared.capture;

    if (options.beforePhase) {
      const earlyState = await options.beforePhase(current, capture, nowMs, tickCapture);
      if (earlyState) {
        return earlyState;
      }
    }

    return options.runMiningPhase(current, capture, nowMs, tickCapture);
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

export async function runBotEngine<State extends BotEngineLoopState<FunctionKey>, FunctionKey extends string, TickCapture = undefined>(
  options: RunBotEngineOptions<State, FunctionKey, TickCapture>,
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
      const tickCapture: TickCapture = options.captureTick
        ? await options.captureTick({
            state,
            nowMs: tickStartedAt,
          })
        : (undefined as TickCapture);
      state = await tickFunction({
        state,
        nowMs: tickStartedAt,
        tickCapture,
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
