/** Inspection/teleport hooks for automated QA: on in development and in `VITE_QA=1` builds only. */
export const QA_HOOKS = import.meta.env.DEV || import.meta.env.VITE_QA === '1';
