/** Screen-level overlay shell: traps focus, closes on Esc, restores focus on close. */
import { useEffect, useRef, type ReactNode } from "react";

const FOCUSABLE = 'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select, [tabindex]:not([tabindex="-1"])';

export function Modal({
  label,
  onClose,
  onKey,
  children,
  className,
  initialFocus,
}: {
  label: string;
  onClose: () => void;
  /** Extra shortcuts while open; return true when handled. */
  onKey?: (e: KeyboardEvent) => boolean | void;
  children: ReactNode;
  className?: string;
  initialFocus?: string; // selector inside the modal
}) {
  const ref = useRef<HTMLDivElement>(null);
  const handlers = useRef({ onClose, onKey });
  handlers.current = { onClose, onKey };

  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const el = ref.current;
    const first = (initialFocus && el?.querySelector<HTMLElement>(initialFocus)) || el?.querySelector<HTMLElement>(FOCUSABLE) || el;
    first?.focus({ preventScroll: true });
    return () => {
      if (prev && document.contains(prev)) prev.focus({ preventScroll: true });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keys are handled at the window so they still work when the focused element disappears
  // (switching tabs unmounts it). Focus that escapes the dialog is pulled back in.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const el = ref.current;
      if (!el) return;
      // Only the topmost modal listens.
      const roots = document.querySelectorAll(".modal-root");
      if (roots[roots.length - 1] !== el.parentElement) return;
      if (!el.contains(document.activeElement)) el.focus();
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopImmediatePropagation();
        handlers.current.onClose();
        return;
      }
      if (e.key === "Tab") {
        const items = [...el.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((x) => x.offsetParent !== null);
        if (!items.length) return;
        const first = items[0]!;
        const last = items[items.length - 1]!;
        const active = document.activeElement;
        if (e.shiftKey && (active === first || active === el)) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && (active === last || active === el)) {
          e.preventDefault();
          first.focus();
        }
        return;
      }
      if (handlers.current.onKey?.(e)) e.preventDefault();
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, []);

  return (
    <div className="modal-root">
      <div className="modal-scrim" onClick={() => handlers.current.onClose()} />
      <div ref={ref} className={`modal ${className ?? ""}`} role="dialog" aria-modal="true" aria-label={label} tabIndex={-1}>
        {children}
      </div>
    </div>
  );
}
