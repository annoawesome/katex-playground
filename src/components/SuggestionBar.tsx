/** The "lazy math" suggestion card shown at the bottom of the editor pane. */
import { texToHtml } from "./Toolbar";
import type { Suggestion } from "../lib/suggest";

interface Props {
  suggestion: Suggestion;
  onApply(): void;
  onDismiss(): void;
}

export function SuggestionBar({ suggestion, onApply, onDismiss }: Props) {
  return (
    <div className="suggestion" role="status" aria-live="polite">
      <div className="suggestion-text">
        <span className="suggestion-label">{suggestion.kind === "wrap" ? "Write as math?" : "Use LaTeX symbols?"}</span>
        <span className="suggestion-preview" dangerouslySetInnerHTML={{ __html: texToHtml(suggestion.math) }} />
        <code className="suggestion-source" title={suggestion.replacement}>
          {suggestion.replacement}
        </code>
      </div>
      <div className="suggestion-actions">
        <button type="button" className="btn primary" onMouseDown={(e) => e.preventDefault()} onClick={onApply}>
          Apply <kbd>Alt+Enter</kbd>
        </button>
        <button type="button" className="btn" onMouseDown={(e) => e.preventDefault()} onClick={onDismiss}>
          Dismiss <kbd>Esc</kbd>
        </button>
      </div>
    </div>
  );
}
