import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import type { SyncResult } from './api';

type Kind = 'success' | 'warning' | 'error';

interface Notice {
  id: number;
  kind: Kind;
  text: string;
}

interface NoticeApi {
  notify: (kind: Kind, text: string) => void;
  /** Avisa si un guardado no llegó a publicarse en Cloudflare. */
  reportSync: (sync: SyncResult | undefined, successText: string) => void;
  reportError: (error: unknown) => void;
}

const NoticeContext = createContext<NoticeApi | null>(null);

let nextId = 1;

export function NoticeProvider({ children }: { children: ReactNode }) {
  const [notices, setNotices] = useState<Notice[]>([]);

  const dismiss = useCallback((id: number) => {
    setNotices((list) => list.filter((n) => n.id !== id));
  }, []);

  const notify = useCallback(
    (kind: Kind, text: string) => {
      const id = nextId++;
      setNotices((list) => [...list, { id, kind, text }]);
      if (kind === 'success') setTimeout(() => dismiss(id), 3500);
    },
    [dismiss],
  );

  const value = useMemo<NoticeApi>(
    () => ({
      notify,
      reportSync: (sync, successText) => {
        if (sync && !sync.ok) {
          notify(
            'warning',
            `Guardado, pero no se publicó en Cloudflare: ${sync.error}. Usa "Re-sincronizar todo" cuando se resuelva.`,
          );
        } else {
          notify('success', successText);
        }
      },
      reportError: (error) =>
        notify('error', error instanceof Error ? error.message : String(error)),
    }),
    [notify],
  );

  return (
    <NoticeContext.Provider value={value}>
      {children}
      <div className="notices" role="status" aria-live="polite">
        {notices.map((n) => (
          <div key={n.id} className={`notice notice-${n.kind}`}>
            <span>{n.text}</span>
            <button type="button" className="notice-close" onClick={() => dismiss(n.id)}>
              ×
            </button>
          </div>
        ))}
      </div>
    </NoticeContext.Provider>
  );
}

export function useNotices(): NoticeApi {
  const ctx = useContext(NoticeContext);
  if (!ctx) throw new Error('useNotices debe usarse dentro de <NoticeProvider>');
  return ctx;
}
