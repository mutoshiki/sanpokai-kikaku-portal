import React from 'react';
import { createRoot } from 'react-dom/client';
import { ThemePreferenceProvider } from '../../ThemeToggle.jsx';
import App from './App.jsx';
import './carbon-base.scss';

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ThemePreferenceProvider><App /></ThemePreferenceProvider>
  </React.StrictMode>,
);
