import React from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/dm-sans';
import '@fontsource-variable/manrope';
import './index.css';
import './accessibility.css';
import App from './App';
import Demo from './components/ui/demo';
createRoot(document.getElementById('root')!).render(<React.StrictMode>{location.pathname === '/prompt-demo' ? <Demo /> : <App />}</React.StrictMode>);
