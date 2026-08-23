import React, { useEffect, useState } from 'react';
import { Button } from '@carbon/react';
import { Asleep, Light } from '@carbon/icons-react';

const STORAGE_KEY = 'sanpokai-ui-theme-v1';
const LIGHT_THEME = 'light';
const DARK_THEME = 'dark';

function readInitialTheme() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === LIGHT_THEME || stored === DARK_THEME) return stored;
  } catch {
    // Storage can be unavailable in privacy-restricted contexts.
  }
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? DARK_THEME : LIGHT_THEME;
}

function applyTheme(theme) {
  const carbonTheme = theme === DARK_THEME ? 'g100' : 'white';
  document.documentElement.setAttribute('data-carbon-theme', carbonTheme);
  document.documentElement.style.colorScheme = theme;

  document.querySelectorAll('[data-carbon-theme]').forEach((node) => {
    if (node.getAttribute('data-carbon-theme') !== carbonTheme) {
      node.setAttribute('data-carbon-theme', carbonTheme);
    }
  });
}

export default function ThemeToggle() {
  const [theme, setTheme] = useState(readInitialTheme);
  const dark = theme === DARK_THEME;

  useEffect(() => {
    applyTheme(theme);
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      // Theme still works for the current page even when storage is unavailable.
    }

    const observer = new MutationObserver(() => applyTheme(theme));
    observer.observe(document.documentElement, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['data-carbon-theme'],
    });
    return () => observer.disconnect();
  }, [theme]);

  const label = dark ? 'ライトモードに切り替え' : 'ダークモードに切り替え';
  return (
    <div className="theme-toggle-host">
      <Button
        kind="ghost"
        size="lg"
        hasIconOnly
        renderIcon={dark ? Light : Asleep}
        iconDescription={label}
        aria-label={label}
        aria-pressed={dark}
        onClick={() => setTheme(dark ? LIGHT_THEME : DARK_THEME)}
      />
    </div>
  );
}
