import React from "react";

type TaskNode = {
  id: string;
  name: string;
  children?: TaskNode[];
};

type AutomateBotProps = {
  taskTree: TaskNode[];
  expandedTaskNodeIds: Set<string>;
  onToggleTaskNodeExpand: (id: string) => void;
};

function TaskNodeComponent({
  node,
  expandedNodeIds,
  onToggleExpand,
}: {
  node: TaskNode;
  expandedNodeIds: Set<string>;
  onToggleExpand: (id: string) => void;
}) {
  const isExpanded = expandedNodeIds.has(node.id);
  const hasChildren = (node.children ?? []).length > 0;

  return (
    <li>
      <div className="tree-item task-item">
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
        <span>{node.name}</span>
      </div>
      {hasChildren && isExpanded && (
        <ul className="tree-children">
          {(node.children ?? []).map((child) => (
            <TaskNodeComponent key={child.id} node={child} expandedNodeIds={expandedNodeIds} onToggleExpand={onToggleExpand} />
          ))}
        </ul>
      )}
    </li>
  );
}

export default function AutomateBot(props: AutomateBotProps) {
  const { taskTree, expandedTaskNodeIds, onToggleTaskNodeExpand } = props;

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
              <TaskNodeComponent key={node.id} node={node} expandedNodeIds={expandedTaskNodeIds} onToggleExpand={onToggleTaskNodeExpand} />
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
