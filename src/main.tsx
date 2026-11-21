import React, { lazy, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';
import '@fontsource-variable/dm-sans';
import '@fontsource-variable/manrope';
import { initPwa } from './pwa/store';

const Studio=import.meta.env.DEV&&new URLSearchParams(location.search).get('primitive-editor')==='1'
  ?lazy(()=>import('./animation/editor/Studio')):null;
if(!Studio)initPwa();
createRoot(document.getElementById('root')!).render(<React.StrictMode>
  {Studio?<Suspense fallback={null}><Studio/></Suspense>:<App/>}
</React.StrictMode>);
