import React from "react";

type TaskNode = {
  id: string;
  name: string;
  children?: TaskNode[];
};

type AutomateBotProps = {
  taskTree: TaskNode[];
  expandedTaskNodeIds: Set<string>;
  selectedTaskNodeId: string | null;
  isSelectedTaskRunning: boolean;
  onToggleTaskNodeExpand: (id: string) => void;
  onSelectTaskNode: (id: string) => void;
  onToggleSelectedTaskRun: () => void;
};

function TaskNodeComponent({
  node,
  expandedNodeIds,
  selectedNodeId,
  isSelectedTaskRunning,
  onToggleExpand,
  onSelectNode,
  onToggleSelectedTaskRun,
}: {
  node: TaskNode;
  expandedNodeIds: Set<string>;
  selectedNodeId: string | null;
  isSelectedTaskRunning: boolean;
  onToggleExpand: (id: string) => void;
  onSelectNode: (id: string) => void;
  onToggleSelectedTaskRun: () => void;
}) {
  const isExpanded = expandedNodeIds.has(node.id);
  const hasChildren = (node.children ?? []).length > 0;
  const isSelectableTask = node.id === "falador-rooftop";
  const isSelected = isSelectableTask && selectedNodeId === node.id;

  return (
    <li>
      <div
        className={`tree-item task-item${isSelected ? " selected" : ""}`}
        onClick={() => {
          if (isSelectableTask) {
            onSelectNode(node.id);
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
              onSelectNode(node.id);
              onToggleSelectedTaskRun();
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
              expandedNodeIds={expandedNodeIds}
              selectedNodeId={selectedNodeId}
              isSelectedTaskRunning={isSelectedTaskRunning}
              onToggleExpand={onToggleExpand}
              onSelectNode={onSelectNode}
              onToggleSelectedTaskRun={onToggleSelectedTaskRun}
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
    expandedTaskNodeIds,
    selectedTaskNodeId,
    isSelectedTaskRunning,
    onToggleTaskNodeExpand,
    onSelectTaskNode,
    onToggleSelectedTaskRun,
  } = props;

  return (
    <div className="automatebot-view">
      <h1>Automate Bot</h1>
      <aside className="sidebar">
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
                expandedNodeIds={expandedTaskNodeIds}
                selectedNodeId={selectedTaskNodeId}
                isSelectedTaskRunning={isSelectedTaskRunning}
                onToggleExpand={onToggleTaskNodeExpand}
                onSelectNode={onSelectTaskNode}
                onToggleSelectedTaskRun={onToggleSelectedTaskRun}
              />
            ))
          )}
        </ul>
      </aside>
      <main className="main">
        <p>Select a task from the left panel</p>
      </main>
    </div>
  );
}
