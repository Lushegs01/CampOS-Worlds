import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';
import '@fontsource-variable/dm-sans';
import '@fontsource-variable/manrope';
import { initPwa } from './pwa/store';
initPwa();
createRoot(document.getElementById('root')!).render(<React.StrictMode><App/></React.StrictMode>);
