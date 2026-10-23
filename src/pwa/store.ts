import { create } from 'zustand';
import { registerSW } from 'virtual:pwa-register';

interface InstallPrompt extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}
interface PwaState {
  installed: boolean;
  canInstall: boolean;
  updateAvailable: boolean;
  online: boolean;
  message: string;
}
const standalone = () => window.matchMedia('(display-mode: standalone)').matches ||
  (navigator as Navigator & { standalone?: boolean }).standalone === true;
export const usePwa = create<PwaState>(() => ({
  installed: standalone(), canInstall: false, updateAvailable: false,
  online: navigator.onLine, message: '',
}));
let started = false, prompt: InstallPrompt | null = null;
let registration: ServiceWorkerRegistration | undefined;
export const iosSafari = () => (/iPad|iPhone|iPod/.test(navigator.userAgent) ||
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)) &&
  /Safari/.test(navigator.userAgent) && !/CriOS|FxiOS|EdgiOS|OPiOS/.test(navigator.userAgent);

/** One lifetime registration; updates wait for an explicit action so a game is never reloaded mid-match. */
export function initPwa() {
  if (started) return;
  started = true;
  const display = window.matchMedia('(display-mode: standalone)');
  display.addEventListener('change', () => usePwa.setState({ installed: standalone() }));
  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault(); prompt = event as InstallPrompt;
    usePwa.setState({ canInstall: true, message: '' });
  });
  window.addEventListener('appinstalled', () => {
    prompt = null; usePwa.setState({ installed: true, canInstall: false, message: '' });
  });
  window.addEventListener('offline', () => usePwa.setState({ online: false }));
  window.addEventListener('online', () => usePwa.setState({ online: true }));
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  let lastCheck = Date.now(), controlled = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (controlled) usePwa.setState({ updateAvailable: true });
    controlled = true;
  });
  const check = () => {
    if (document.hidden || !navigator.onLine || Date.now() - lastCheck < 3600000) return;
    lastCheck = Date.now();
    void registration?.update().catch(error => console.warn('Campus update check unavailable.', error));
  };
  document.addEventListener('visibilitychange', check);
  window.addEventListener('online', check);
  registerSW({
    immediate: true,
    onNeedRefresh: () => usePwa.setState({ updateAvailable: true }),
    // We own the reload handshake. Workbox's isUpdate heuristic treats rapid updates as external.
    onNeedReload: () => usePwa.setState({ updateAvailable: true }),
    onRegisteredSW: (_url, value) => { registration = value; },
    onRegisterError: error => {
      console.error('Campus installation support could not start.', error);
      usePwa.setState({ message: 'Installation support could not start. You can still play online; reload to retry.' });
    },
  });
}
export async function installCampus() {
  const pending = prompt;
  if (!pending) return;
  prompt = null; usePwa.setState({ canInstall: false, message: '' });
  try {
    await pending.prompt();
    const choice = await pending.userChoice;
    usePwa.setState({ message: choice.outcome === 'accepted'
      ? 'Follow your browser’s installation steps.' : 'You can install later from your browser’s menu.' });
  } catch (error) {
    console.warn('Campus installation prompt unavailable.', error);
    usePwa.setState({ message: 'Your browser could not open installation. Try its install menu instead.' });
  }
}
export async function updateCampus() {
  const waiting = registration?.waiting;
  if (!waiting) { window.location.reload(); return; }
  let cleanup = () => {};
  try {
    await new Promise<void>((resolve, reject) => {
      const changed = () => { cleanup(); resolve(); };
      const timer = setTimeout(() => { cleanup(); reject(new Error('Campus worker activation timed out')); }, 15000);
      cleanup = () => { clearTimeout(timer); navigator.serviceWorker.removeEventListener('controllerchange', changed); };
      navigator.serviceWorker.addEventListener('controllerchange', changed);
      waiting.postMessage({ type: 'SKIP_WAITING' });
    });
    window.location.reload();
  }
  catch (error) {
    cleanup();
    console.error('Campus update could not be applied.', error);
    usePwa.setState({ message: 'The update could not be applied. Reconnect and reload to try again.' });
  }
}
