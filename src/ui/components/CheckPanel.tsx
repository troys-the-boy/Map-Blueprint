// The Check panel: validation results in plain language. Click one to jump to it.

import { useStore } from "../store";

export function CheckPanel() {
  const s = useStore();
  const map = s.currentMap;
  if (!map) return null;
  const errors = s.issues.filter((i) => i.severity === "error");
  const warnings = s.issues.filter((i) => i.severity === "warning");
  const list = [...errors, ...warnings];

  return (
    <div className="check-panel">
      <p className={`check-summary ${errors.length ? "bad" : warnings.length ? "warn" : "good"}`}>
        {errors.length === 0 && warnings.length === 0
          ? "✓ No problems found."
          : `${errors.length} error${errors.length === 1 ? "" : "s"} · ${warnings.length} warning${warnings.length === 1 ? "" : "s"}`}
      </p>
      <p className="hint">
        Errors must be fixed before exporting. Warnings are advice. Checks run after every change; click one to see it on the map.
      </p>
      <ul className="issue-list">
        {list.map((issue, k) => (
          <li key={k}>
            <button
              className={`issue ${issue.severity}`}
              disabled={!issue.cells.length}
              title={issue.cells.length ? "Show on the map" : undefined}
              onClick={() => s.focusIssue(issue)}
            >
              <span className="issue-badge">{issue.severity === "error" ? "Error" : "Warning"}</span>
              <span>{issue.message}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
