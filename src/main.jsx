import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import { ThemePreferenceProvider } from './ThemeToggle.jsx';
import './styles.scss';

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ThemePreferenceProvider>
      <App />
    </ThemePreferenceProvider>
  </React.StrictMode>,
);
