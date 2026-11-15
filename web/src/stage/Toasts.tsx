import type { Toast } from "../useTrial";

export function StageToasts({
  notices,
  errors,
  onDismissError,
  onDismissNotice,
}: {
  notices: Toast[];
  errors: Toast[];
  onDismissError: (id: number) => void;
  onDismissNotice: (id: number) => void;
}) {
  if (!notices.length && !errors.length) return null;
  return (
    <div className="toasts" onClick={(e) => e.stopPropagation()}>
      {errors.map((e) => (
        <div key={e.id} className="toast error" role="alert">
          <span className="toast-kicker">Problem</span>
          <span className="toast-text">{e.text}</span>
          <button type="button" aria-label="Dismiss" onClick={() => onDismissError(e.id)}>
            ×
          </button>
        </div>
      ))}
      {notices.map((n) => (
        <div key={n.id} className="toast notice" role="status">
          <span className="toast-kicker">Court notice</span>
          <span className="toast-text">{n.text}</span>
          <button type="button" aria-label="Dismiss" onClick={() => onDismissNotice(n.id)}>
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
