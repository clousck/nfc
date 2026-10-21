import { useCallback, useEffect, useEffectEvent, useState } from 'react';

export interface Resource<T> {
  data: T | undefined;
  error: Error | null;
  loading: boolean;
  reload: () => void;
}

interface Result<T> {
  key: string;
  request: string;
  data: T | undefined;
  error: Error | null;
}

/** Carga datos al montar y cada vez que cambia `key`. `reload()` vuelve a pedirlos. */
export function useResource<T>(load: () => Promise<T>, key: string): Resource<T> {
  const [version, setVersion] = useState(0);
  const [result, setResult] = useState<Result<T> | null>(null);
  const request = `${key}#${version}`;
  const run = useEffectEvent(load);

  useEffect(() => {
    let cancelled = false;
    run().then(
      (data) => {
        if (!cancelled) setResult({ key, request, data, error: null });
      },
      (error: unknown) => {
        if (cancelled) return;
        setResult((prev) => ({
          key,
          request,
          // Al recargar se conservan los datos anteriores aunque falle.
          data: prev?.key === key ? prev.data : undefined,
          error: error instanceof Error ? error : new Error(String(error)),
        }));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [key, request]);

  const reload = useCallback(() => setVersion((v) => v + 1), []);
  const current = result?.key === key ? result : null;
  return {
    data: current?.data,
    error: current?.error ?? null,
    loading: result?.request !== request,
    reload,
  };
}
