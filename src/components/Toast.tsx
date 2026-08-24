import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { IconAlert, IconCheck, IconClose, IconInfo } from './Icons';

export type ToastKind = 'info' | 'success' | 'error';

interface Toast {
  id: number;
  message: string;
  kind: ToastKind;
}

type Notify = (message: string, kind?: ToastKind) => void;

const ToastContext = createContext<Notify>(() => {});

export function useNotify(): Notify {
  return useContext(ToastContext);
}

let nextId = 1;

/**
 * A phone screen is about four toasts tall. Pasting a folder of screenshots
 * would otherwise bury the catalog under its own progress reports, so the
 * stack keeps only the newest few and the older ones drop out early.
 *
 * Errors are exempt from that trim. A failed import that scrolls out from
 * under a run of "catalogued" messages is a failure nobody ever reads.
 */
const MAX_VISIBLE = 3;

/**
 * How long each kind survives. Errors do not: the thing that went wrong is
 * usually the thing you need to act on, and a six-second window to read a
 * filename is not a window at all. They stay until dismissed.
 */
const LIFESPAN: Record<ToastKind, number | null> = {
  info: 3200,
  success: 3200,
  error: null,
};

/*
   Severity is carried by a mark and a word, never by colour alone.

   This palette is measured off a screenshot that contained no red and no
   green, so --danger resolves to the body-text ink in the light theme and to
   the page cream in the dark one, and --success to a brown and a tan. A
   border tinted with either is not a signal anyone can read, and it fails
   WCAG 1.4.1 besides. The icon distinguishes the kinds at a glance; the
   prefix names it for a screen reader and for anyone who cannot tell the two
   marks apart.
*/
const MARK: Record<ToastKind, { icon: typeof IconInfo; label: string }> = {
  info: { icon: IconInfo, label: 'Note' },
  success: { icon: IconCheck, label: 'Done' },
  error: { icon: IconAlert, label: 'Error' },
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((t) => t.id !== id));
  }, []);

  const notify = useCallback<Notify>((message, kind = 'info') => {
    const id = nextId++;
    setToasts((current) => {
      const next = [...current, { id, message, kind }];
      // Trim the transient ones only, newest kept. An error stays until it is
      // dismissed, however many successes land on top of it.
      const errors = next.filter((t) => t.kind === 'error');
      const rest = next.filter((t) => t.kind !== 'error').slice(-MAX_VISIBLE);
      return next.filter((t) => errors.includes(t) || rest.includes(t));
    });
    const life = LIFESPAN[kind];
    if (life !== null) setTimeout(() => dismiss(id), life);
  }, [dismiss]);

  const value = useMemo(() => notify, [notify]);

  const render = (toast: Toast) => {
    const { icon: Icon, label } = MARK[toast.kind];
    return (
      <div key={toast.id} className={`toast toast-${toast.kind}`}>
        <span className="toast-mark" aria-hidden="true">
          <Icon size={16} />
        </span>
        <p className="toast-body">
          <span className="visually-hidden">{label}: </span>
          {toast.message}
        </p>
        <button
          type="button"
          className="toast-dismiss"
          onClick={() => dismiss(toast.id)}
          aria-label={`Dismiss: ${toast.message}`}
        >
          <IconClose size={14} />
        </button>
      </div>
    );
  };

  /*
     Two regions, because they are announced differently. A catalogued-three-
     designs message can wait for a gap in what the screen reader is saying;
     a failure cannot, and a polite region that also auto-expired meant an
     error could be raised and retired without ever being spoken.
  */
  const failures = toasts.filter((t) => t.kind === 'error');
  const notices = toasts.filter((t) => t.kind !== 'error');

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toasts">
        <div role="alert" aria-live="assertive" className="toast-region">
          {failures.map(render)}
        </div>
        <div role="status" aria-live="polite" className="toast-region">
          {notices.map(render)}
        </div>
      </div>
    </ToastContext.Provider>
  );
}
