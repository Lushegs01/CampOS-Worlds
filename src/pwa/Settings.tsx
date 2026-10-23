import { Download, RefreshCw } from 'lucide-react';
import { installCampus, iosSafari, updateCampus, usePwa } from './store';

export default function InstallationSettings() {
  const pwa = usePwa();
  return <section className="installation-settings" aria-labelledby="installation-title">
    <h3 id="installation-title">CampOS on your home screen</h3>
    <p className="muted">{pwa.installed ? 'You’re using the installed campus.' :
      pwa.canInstall ? 'Open campus in its own window, straight from your home screen.' :
      iosSafari() ? 'In Safari, tap Share, then Add to Home Screen. Keep Open as Web App enabled if offered.' :
      'Use your browser’s install option when offered. You can also keep playing in this browser.'}</p>
    {pwa.canInstall && !pwa.installed && <button className="secondary" onClick={() => void installCampus()}><Download size={16}/>Install CampOS Worlds</button>}
    <p className="small-text muted">An internet connection is needed to download the campus and use accounts, multiplayer and shared activities. Installation keeps a small launch and recovery shell; it doesn’t download the entire world.</p>
    {!pwa.online && <p role="status">You’re offline. Already loaded areas may remain explorable locally; shared actions need a connection.</p>}
    {pwa.updateAvailable && <div className="note"><b>A campus update is ready.</b><p>Update when you’re ready to leave your current activity. Other open campus tabs will also be offered a reload. Saved preferences and account progress are kept; live matches and guest activities may end.</p><button className="secondary" onClick={() => void updateCampus()}><RefreshCw size={16}/>Reload and update</button></div>}
    {pwa.message && <p className="small-text" role="status">{pwa.message}</p>}
  </section>;
}
