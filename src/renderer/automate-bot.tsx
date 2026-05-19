import React, { useEffect, useMemo, useRef } from "react";
import type {
  GuardianOfTheRiftActiveElement,
  GuardianOfTheRiftConfig,
  GuardianOfTheRiftPouch,
} from "../main/automate-bots/guardian-of-the-rift-config";
import type {
  EndToEndGuideChecklist,
} from "../main/automate-bots/end-to-end/guide-checklist";
import {
  formatEndToEndGuideChecklistStepSourceLabel,
} from "../main/automate-bots/end-to-end/guide-checklist";
import {
  GUARDIAN_OF_THE_RIFT_POUCHES,
  getGuardianOfTheRiftColossalPouchStats,
} from "../main/automate-bots/guardian-of-the-rift-config";
import type {
  AllInOneMiningConfig,
  AllInOneMiningOreDefinition,
  AllInOneMiningOreType,
} from "../main/automate-bots/all-in-one-mining-config";

type TaskNode = {
  id: string;
  name: string;
  children?: TaskNode[];
};

type AutomateBotProps = {
  taskTree: TaskNode[];
  selectableTaskIds: Set<string>;
  expandedTaskNodeIds: Set<string>;
  selectedTaskNodeId: string | null;
  isSelectedTaskRunning: boolean;
  currentStepId: string | null;
  logLines: string[];
  showEndToEndConfig: boolean;
  endToEndChecklist: EndToEndGuideChecklist | null;
  endToEndCompletedGuideStepIds: string[];
  isEndToEndChecklistLoading: boolean;
  endToEndChecklistError: string | null;
  showGuardianOfTheRiftConfig: boolean;
  guardianOfTheRiftElements: readonly GuardianOfTheRiftActiveElement[];
  guardianOfTheRiftConfig: GuardianOfTheRiftConfig;
  showAllInOneMiningConfig: boolean;
  allInOneMiningOreTypes: readonly AllInOneMiningOreDefinition[];
  allInOneMiningConfig: AllInOneMiningConfig;
  onToggleTaskNodeExpand: (id: string) => void;
  onSelectTaskNode: (id: string) => void;
  onToggleSelectedTaskRun: (taskNodeId?: string) => void;
  onStepContextMenu: (e: React.MouseEvent, stepId: string, stepName: string) => void;
  onEndToEndChecklistRefresh: () => void;
  onEndToEndChecklistStepChange: (stepId: string, completed: boolean) => void;
  onGuardianOfTheRiftElementEnabledChange: (element: GuardianOfTheRiftActiveElement, enabled: boolean) => void;
  onGuardianOfTheRiftUseAgilityCourseChange: (enabled: boolean) => void;
  onGuardianOfTheRiftRunecraftLevelChange: (level: number) => void;
  onGuardianOfTheRiftPouchChange: (pouch: GuardianOfTheRiftPouch, enabled: boolean) => void;
  onAllInOneMiningOreEnabledChange: (oreType: AllInOneMiningOreType, enabled: boolean) => void;
  colossalPouchFullFillCount: number;
  onGuardianOfTheRiftColossalFillCountChange: (count: number) => void;
};

function formatGuardianElementLabel(value: GuardianOfTheRiftActiveElement): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function formatGuardianPouchLabel(value: GuardianOfTheRiftPouch): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

const AUTOMATE_BOT_LOG_TOKEN_REGEX =
  /(FF[0-9A-Fa-f]{6}|rewardPoints=|preference=|chosen=|skipped=|nextUnknown=|focus=|\b(?:elemental|catalytic|WARN|ERROR|LOG)\b)/gi;
const AUTOMATE_BOT_COLOR_TOKEN_REGEX = /^FF[0-9A-Fa-f]{6}$/;

function getAutomateBotLogLineClass(line: string): string {
  const lowerLine = line.toLowerCase();
  const classNames = ["automatebot-log-line"];

  if (lowerLine.includes("guardian decision") || lowerLine.includes("guardian re-click decision")) {
    classNames.push("automatebot-log-line-guardian-decision");
  }

  if (
    lowerLine.includes("rewardpoints=") ||
    lowerLine.includes("startup reward points") ||
    lowerLine.includes("reward points")
  ) {
    classNames.push("automatebot-log-line-reward");
  }

  if (
    lowerLine.includes("chosen=catalytic:") ||
    lowerLine.includes("preference=catalytic->") ||
    lowerLine.includes("focus=catalytic") ||
    lowerLine.includes("clicked catalytic guardian") ||
    lowerLine.includes("re-clicked catalytic guardian")
  ) {
    classNames.push("automatebot-log-line-catalytic-choice");
  } else if (
    lowerLine.includes("chosen=elemental:") ||
    lowerLine.includes("preference=elemental->") ||
    lowerLine.includes("focus=elemental") ||
    lowerLine.includes("clicked elemental guardian") ||
    lowerLine.includes("re-clicked elemental guardian")
  ) {
    classNames.push("automatebot-log-line-elemental-choice");
  }

  if (lowerLine.includes("clicked") || lowerLine.includes("re-clicked")) {
    classNames.push("automatebot-log-line-click");
  }

  if (
    (lowerLine.includes("skipped=") && !lowerLine.includes("skipped=none")) ||
    lowerLine.includes("not visible") ||
    lowerLine.includes("not found") ||
    lowerLine.includes("too close") ||
    lowerLine.includes("failed")
  ) {
    classNames.push("automatebot-log-line-blocked");
  }

  if (lowerLine.includes("[error]")) {
    classNames.push("automatebot-log-line-error");
  } else if (lowerLine.includes("[warn]")) {
    classNames.push("automatebot-log-line-warn");
  }

  return classNames.join(" ");
}

function getCssColorFromArgbToken(token: string): string {
  return `#${token.slice(2)}`;
}

function renderAutomateBotLogToken(token: string, key: string): React.ReactNode {
  const lowerToken = token.toLowerCase();

  if (AUTOMATE_BOT_COLOR_TOKEN_REGEX.test(token)) {
    return (
      <span key={key} className="automatebot-log-color-token" title={token}>
        <span className="automatebot-log-color-swatch" style={{ backgroundColor: getCssColorFromArgbToken(token) }} />
        <span className="automatebot-log-color-code">{token}</span>
      </span>
    );
  }

  if (lowerToken === "elemental") {
    return (
      <span key={key} className="automatebot-log-token automatebot-log-token-elemental">
        {token}
      </span>
    );
  }

  if (lowerToken === "catalytic") {
    return (
      <span key={key} className="automatebot-log-token automatebot-log-token-catalytic">
        {token}
      </span>
    );
  }

  if (lowerToken === "warn") {
    return (
      <span key={key} className="automatebot-log-token automatebot-log-token-warn">
        {token}
      </span>
    );
  }

  if (lowerToken === "error") {
    return (
      <span key={key} className="automatebot-log-token automatebot-log-token-error">
        {token}
      </span>
    );
  }

  if (lowerToken === "log") {
    return (
      <span key={key} className="automatebot-log-token automatebot-log-token-level">
        {token}
      </span>
    );
  }

  return (
    <span key={key} className="automatebot-log-token automatebot-log-token-key">
      {token}
    </span>
  );
}

function renderAutomateBotLogLine(line: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  let cursor = 0;
  let keyIndex = 0;
  AUTOMATE_BOT_LOG_TOKEN_REGEX.lastIndex = 0;

  let match = AUTOMATE_BOT_LOG_TOKEN_REGEX.exec(line);
  while (match) {
    if (match.index > cursor) {
      nodes.push(<React.Fragment key={`text-${keyIndex++}`}>{line.slice(cursor, match.index)}</React.Fragment>);
    }

    nodes.push(renderAutomateBotLogToken(match[0], `token-${keyIndex++}`));
    cursor = match.index + match[0].length;
    match = AUTOMATE_BOT_LOG_TOKEN_REGEX.exec(line);
  }

  if (cursor < line.length) {
    nodes.push(<React.Fragment key={`text-${keyIndex++}`}>{line.slice(cursor)}</React.Fragment>);
  }

  return nodes;
}

function TaskNodeComponent({
  node,
  selectableTaskIds,
  expandedNodeIds,
  selectedNodeId,
  isSelectedTaskRunning,
  activeStepId,
  onToggleExpand,
  onSelectNode,
  onToggleSelectedTaskRun,
  onStepContextMenu,
}: {
  node: TaskNode;
  selectableTaskIds: Set<string>;
  expandedNodeIds: Set<string>;
  selectedNodeId: string | null;
  isSelectedTaskRunning: boolean;
  activeStepId: string | null;
  onToggleExpand: (id: string) => void;
  onSelectNode: (id: string) => void;
  onToggleSelectedTaskRun: (taskNodeId?: string) => void;
  onStepContextMenu: (e: React.MouseEvent, stepId: string, stepName: string) => void;
}) {
  const isExpanded = expandedNodeIds.has(node.id);
  const hasChildren = (node.children ?? []).length > 0;
  const isSelectableTask = selectableTaskIds.has(node.id);
  const isSelected = isSelectableTask && selectedNodeId === node.id;
  const isActiveStep = node.id === activeStepId;
  const isStep = !hasChildren && node.id.includes("-step-");

  return (
    <li>
      <div
        className={`tree-item task-item${isSelected ? " selected" : ""}${isActiveStep ? " active-step" : ""}`}
        onClick={() => {
          if (isSelectableTask) {
            onSelectNode(node.id);
          }
        }}
        onContextMenu={(e) => {
          if (isStep) {
            e.preventDefault();
            e.stopPropagation();
            onStepContextMenu(e, node.id, node.name);
          }
        }}
      >
        {hasChildren && (
          <span
            className={`expand-icon${isExpanded ? " expanded" : ""}`}
            onClick={(e) => {
              e.stopPropagation();
              onToggleExpand(node.id);
            }}
          >
            ▶
          </span>
        )}
        {!hasChildren && <span className="expand-icon placeholder" />}
        <span className="task-name">{node.name}</span>
        {isSelectableTask && (
          <button
            type="button"
            className={`task-play-btn${isSelectedTaskRunning && isSelected ? " running" : ""}`}
            onClick={(e) => {
              e.stopPropagation();
              onToggleSelectedTaskRun(node.id);
            }}
          >
            {isSelectedTaskRunning && isSelected ? "Stop" : "Play"}
          </button>
        )}
      </div>
      {hasChildren && isExpanded && (
        <ul className="tree-children">
          {(node.children ?? []).map((child) => (
            <TaskNodeComponent
              key={child.id}
              node={child}
              selectableTaskIds={selectableTaskIds}
              expandedNodeIds={expandedNodeIds}
              selectedNodeId={selectedNodeId}
              isSelectedTaskRunning={isSelectedTaskRunning}
              activeStepId={activeStepId}
              onToggleExpand={onToggleExpand}
              onSelectNode={onSelectNode}
              onToggleSelectedTaskRun={onToggleSelectedTaskRun}
              onStepContextMenu={onStepContextMenu}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

export default function AutomateBot(props: AutomateBotProps) {
  const {
    taskTree,
    selectableTaskIds,
    expandedTaskNodeIds,
    selectedTaskNodeId,
    isSelectedTaskRunning,
    currentStepId,
    logLines,
    showEndToEndConfig,
    endToEndChecklist,
    endToEndCompletedGuideStepIds,
    isEndToEndChecklistLoading,
    endToEndChecklistError,
    showGuardianOfTheRiftConfig,
    guardianOfTheRiftElements,
    guardianOfTheRiftConfig,
    showAllInOneMiningConfig,
    allInOneMiningOreTypes,
    allInOneMiningConfig,
    onToggleTaskNodeExpand,
    onSelectTaskNode,
    onToggleSelectedTaskRun,
    onStepContextMenu,
    onEndToEndChecklistRefresh,
    onEndToEndChecklistStepChange,
    onGuardianOfTheRiftElementEnabledChange,
    onGuardianOfTheRiftUseAgilityCourseChange,
    onGuardianOfTheRiftRunecraftLevelChange,
    onGuardianOfTheRiftPouchChange,
    onAllInOneMiningOreEnabledChange,
    colossalPouchFullFillCount,
    onGuardianOfTheRiftColossalFillCountChange,
  } = props;

  const logContainerRef = useRef<HTMLDivElement | null>(null);
  const visibleLogLines = useMemo(() => logLines.slice(-500), [logLines]);
  const endToEndCompletedGuideStepIdSet = useMemo(
    () => new Set(endToEndCompletedGuideStepIds),
    [endToEndCompletedGuideStepIds],
  );
  const visibleEndToEndChecklistSteps = useMemo(
    () => endToEndChecklist?.steps ?? [],
    [endToEndChecklist],
  );
  const endToEndCompletedGuideStepCount = visibleEndToEndChecklistSteps.length
    ? visibleEndToEndChecklistSteps.filter((step) => endToEndCompletedGuideStepIdSet.has(step.id)).length
    : 0;
  const endToEndChecklistProgress =
    visibleEndToEndChecklistSteps.length > 0
      ? Math.round((endToEndCompletedGuideStepCount / visibleEndToEndChecklistSteps.length) * 100)
      : 0;
  const colossalPouchStats = getGuardianOfTheRiftColossalPouchStats(guardianOfTheRiftConfig.runecraftLevel);
  const maxColossalPouchUseCount = colossalPouchStats?.fullUsesBeforeDecay ?? 0;
  const normalizedColossalPouchFullFillCount =
    maxColossalPouchUseCount > 0
      ? Math.max(0, Math.min(maxColossalPouchUseCount, colossalPouchFullFillCount))
      : 0;
  const remainingColossalPouchUses =
    maxColossalPouchUseCount > 0 ? Math.max(0, maxColossalPouchUseCount - normalizedColossalPouchFullFillCount) : 0;
  const colossalInputValue = maxColossalPouchUseCount > 0 ? normalizedColossalPouchFullFillCount : 0;

  useEffect(() => {
    const container = logContainerRef.current;
    if (!container) {
      return;
    }
    container.scrollTop = container.scrollHeight;
  }, [visibleLogLines]);

  return (
    <div className="automatebot-view">
      <aside className="sidebar automatebot-sidebar">
        <div className="sidebar-head">
          <h2 className="sidebar-title">TASKS</h2>
        </div>
        <ul className="tree">
          {taskTree.length === 0 ? (
            <li className="tree-item">No tasks</li>
          ) : (
            taskTree.map((node) => (
              <TaskNodeComponent
                key={node.id}
                node={node}
                selectableTaskIds={selectableTaskIds}
                expandedNodeIds={expandedTaskNodeIds}
                selectedNodeId={selectedTaskNodeId}
                isSelectedTaskRunning={isSelectedTaskRunning}
                activeStepId={currentStepId}
                onToggleExpand={onToggleTaskNodeExpand}
                onSelectNode={onSelectTaskNode}
                onToggleSelectedTaskRun={onToggleSelectedTaskRun}
                onStepContextMenu={onStepContextMenu}
              />
            ))
          )}
        </ul>
        {showGuardianOfTheRiftConfig && (
          <div className="automatebot-config-panel">
            <h3 className="automatebot-config-title">Guardian of the Rift</h3>
            <label className="automatebot-toggle-row">
              <span className="automatebot-toggle-label">Runecraft level</span>
              <input
                type="number"
                min={1}
                max={99}
                step={1}
                value={guardianOfTheRiftConfig.runecraftLevel}
                onChange={(e) => onGuardianOfTheRiftRunecraftLevelChange(Number(e.target.value))}
              />
              <span className="automatebot-toggle-value">
                {colossalPouchStats
                  ? `Colossal ${colossalPouchStats.capacity}/${colossalPouchStats.fullUsesBeforeDecay}`
                  : "No colossal"}
              </span>
            </label>
            <label className="automatebot-toggle-row">
              <span className="automatebot-toggle-label">
                Colossal fills since repair{maxColossalPouchUseCount > 0 ? ` (remaining ${remainingColossalPouchUses})` : ""}
              </span>
              <input
                type="number"
                min={0}
                max={maxColossalPouchUseCount > 0 ? maxColossalPouchUseCount : 0}
                step={1}
                value={colossalInputValue}
                onChange={(e) => {
                  const raw = Number(e.target.value);
                  const clamped =
                    maxColossalPouchUseCount > 0
                      ? Math.max(0, Math.min(maxColossalPouchUseCount, Number.isFinite(raw) ? Math.round(raw) : 0))
                      : 0;
                  onGuardianOfTheRiftColossalFillCountChange(clamped);
                }}
                disabled={maxColossalPouchUseCount === 0}
              />
              <span className="automatebot-toggle-value">
                {maxColossalPouchUseCount > 0
                  ? `${normalizedColossalPouchFullFillCount}/${maxColossalPouchUseCount}`
                  : "No colossal"}
              </span>
            </label>
            <label className="automatebot-toggle-row">
              <span className="automatebot-toggle-label">Use agility course</span>
              <input
                type="checkbox"
                checked={guardianOfTheRiftConfig.useAgilityCourse}
                onChange={(e) => onGuardianOfTheRiftUseAgilityCourseChange(e.target.checked)}
              />
              <span className="automatebot-toggle-value">
                {guardianOfTheRiftConfig.useAgilityCourse ? "Yes" : "No"}
              </span>
            </label>
            <p className="automatebot-config-subtitle">Pouches</p>
            <div className="automatebot-element-grid">
              {GUARDIAN_OF_THE_RIFT_POUCHES.map((pouch) => {
                const isAbyssalSelected = guardianOfTheRiftConfig.pouches.abyssal;
                const isChecked = guardianOfTheRiftConfig.pouches[pouch];
                const isDisabled = pouch !== "abyssal" && isAbyssalSelected;

                return (
                  <label
                    key={pouch}
                    className={`automatebot-toggle-row automatebot-toggle-row-small${isDisabled ? " automatebot-toggle-row-disabled" : ""}`}
                  >
                    <span className="automatebot-toggle-label">{formatGuardianPouchLabel(pouch)}</span>
                    <input
                      type="checkbox"
                      checked={isChecked}
                      disabled={isDisabled}
                      onChange={(e) => onGuardianOfTheRiftPouchChange(pouch, e.target.checked)}
                    />
                    <span className="automatebot-toggle-value">{isChecked ? "Yes" : "No"}</span>
                  </label>
                );
              })}
            </div>
            <p className="automatebot-config-subtitle">Active guardian elements (12)</p>
            <div className="automatebot-element-grid">
              {guardianOfTheRiftElements.map((element) => {
                const enabled = guardianOfTheRiftConfig.activeGuardianElements[element];

                return (
                  <label key={element} className="automatebot-toggle-row automatebot-toggle-row-small">
                    <span className="automatebot-toggle-label">{formatGuardianElementLabel(element)}</span>
                    <input
                      type="checkbox"
                      checked={enabled}
                      onChange={(e) => onGuardianOfTheRiftElementEnabledChange(element, e.target.checked)}
                    />
                    <span className="automatebot-toggle-value">{enabled ? "Yes" : "No"}</span>
                  </label>
                );
              })}
            </div>
          </div>
        )}
        {showAllInOneMiningConfig && (
          <div className="automatebot-config-panel">
            <h3 className="automatebot-config-title">All-In-One Mining</h3>
            <p className="automatebot-config-subtitle">Ore rocks</p>
            <div className="automatebot-element-grid">
              {allInOneMiningOreTypes.map((ore) => {
                const oreType = ore.id as AllInOneMiningOreType;
                const enabled = allInOneMiningConfig.enabledOreTypes[oreType] === true;

                return (
                  <label key={ore.id} className="automatebot-toggle-row automatebot-toggle-row-small">
                    <span className="automatebot-toggle-label">{ore.label}</span>
                    <input
                      type="checkbox"
                      checked={enabled}
                      onChange={(e) => onAllInOneMiningOreEnabledChange(oreType, e.target.checked)}
                    />
                    <span className="automatebot-toggle-value">{enabled ? "Yes" : "No"}</span>
                  </label>
                );
              })}
            </div>
          </div>
        )}
      </aside>

      <div className={showEndToEndConfig ? "automatebot-workspace automatebot-workspace-end-to-end" : "automatebot-workspace"}>
        {showEndToEndConfig && (
          <section className="automatebot-checklist-panel">
            <div className="automatebot-checklist-head">
              <div className="automatebot-checklist-title-wrap">
                <h2 className="automatebot-checklist-title">Section 1.1</h2>
                <span className="automatebot-checklist-source">ironman.guide</span>
              </div>
              <button
                type="button"
                className="automatebot-checklist-refresh"
                onClick={onEndToEndChecklistRefresh}
                disabled={isEndToEndChecklistLoading}
              >
                {isEndToEndChecklistLoading ? "Loading" : "Refresh"}
              </button>
            </div>
            {endToEndChecklist && (
              <div className="automatebot-checklist-progress">
                <span>
                  {endToEndCompletedGuideStepCount} / {visibleEndToEndChecklistSteps.length}
                </span>
                <span>{endToEndChecklistProgress}%</span>
                <div className="automatebot-checklist-progress-track">
                  <div className="automatebot-checklist-progress-fill" style={{ width: `${endToEndChecklistProgress}%` }} />
                </div>
              </div>
            )}
            {endToEndChecklistError && <p className="automatebot-checklist-error">{endToEndChecklistError}</p>}
            {!endToEndChecklist && !endToEndChecklistError && (
              <p className="automatebot-checklist-empty">
                {isEndToEndChecklistLoading ? "Loading checklist." : "Checklist not loaded."}
              </p>
            )}
            {endToEndChecklist && (
              <div className="automatebot-checklist-list">
                {visibleEndToEndChecklistSteps.map((step, index) => {
                  const isCompleted = endToEndCompletedGuideStepIdSet.has(step.id);
                  const sourceLabel = formatEndToEndGuideChecklistStepSourceLabel(step);
                  const displayIndex = index + 1;
                  return (
                    <label
                      key={step.id}
                      className={`automatebot-checklist-step${isCompleted ? " automatebot-checklist-step-completed" : ""}`}
                    >
                      <input
                        type="checkbox"
                        checked={isCompleted}
                        onChange={(e) => onEndToEndChecklistStepChange(step.id, e.target.checked)}
                      />
                      <span className="automatebot-checklist-step-number">
                        <span className="automatebot-checklist-step-index">{displayIndex}</span>
                        <span className="automatebot-checklist-step-source">{sourceLabel}</span>
                      </span>
                      <span className="automatebot-checklist-step-body">
                        <span className="automatebot-checklist-step-text">{step.text}</span>
                        {step.location && <span className="automatebot-checklist-step-meta">{step.location}</span>}
                      </span>
                    </label>
                  );
                })}
              </div>
            )}
          </section>
        )}

        <aside className="automatebot-log-panel">
          <div className="automatebot-log-head">
            <h2 className="sidebar-title">LOGS</h2>
            <span className="automatebot-log-count">{visibleLogLines.length}</span>
          </div>
          <div className="automatebot-log-list" ref={logContainerRef}>
            {visibleLogLines.length === 0 ? (
              <p className="automatebot-log-empty">No logs yet.</p>
            ) : (
              visibleLogLines.map((line, index) => (
                <p key={`${index}-${line}`} className={getAutomateBotLogLineClass(line)}>
                  {renderAutomateBotLogLine(line)}
                </p>
              ))
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
