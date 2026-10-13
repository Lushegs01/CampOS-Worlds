import { useCallback, useEffect, useRef, useState } from 'react';
import { LoaderCircle, RotateCcw, TriangleAlert } from 'lucide-react';
import { toServiceError } from '../services/community';

/** Load data with loading / error / retry states; stale responses from earlier calls are ignored. */
export function useLoad<T>(load: () => Promise<T>, deps: unknown[]) {
  const [state, setState] = useState<{ data: T | undefined; error: string; loading: boolean }>({ data: undefined, error: '', loading: true });
  const run = useRef(0);
  const reload = useCallback(() => {
    const id = ++run.current;
    setState(s => ({ ...s, loading: true, error: '' }));
    load().then(data => { if (id === run.current) setState({ data, error: '', loading: false }); },
      e => { if (id === run.current) setState(s => ({ ...s, error: toServiceError(e).message, loading: false })); });
  }, deps);
  useEffect(() => { reload(); }, [reload]);
  return { ...state, reload, setData: (data: T) => setState(s => ({ ...s, data })) };
}

/** Run an action with a pending flag and a readable error; resolves to the result or undefined. */
export function useAction() {
  const [pending, setPending] = useState(false), [error, setError] = useState('');
  const act = useCallback(async <R,>(fn: () => Promise<R>): Promise<R | undefined> => {
    setPending(true); setError('');
    try { return await fn(); } catch (e) { setError(toServiceError(e).message); return undefined; } finally { setPending(false); }
  }, []);
  return { pending, error, setError, act };
}

export function Loading({ label = 'Loading…' }: { label?: string }) {
  return <div className="state-note" role="status"><LoaderCircle size={20} className="spin" /><span>{label}</span></div>;
}
export function Failure({ message, retry }: { message: string; retry?: () => void }) {
  return <div className="state-note error" role="alert"><TriangleAlert size={20} /><span>{message}</span>{retry && <button className="text-button" onClick={retry}><RotateCcw size={14} /> Try again</button>}</div>;
}
