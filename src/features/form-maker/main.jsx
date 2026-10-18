import React from 'react';
import { createRoot } from 'react-dom/client';
import { ThemePreferenceProvider } from '../../ThemeToggle.jsx';
import App from './App.jsx';
import './form-maker.scss';

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ThemePreferenceProvider><App /></ThemePreferenceProvider>
  </React.StrictMode>,
);
