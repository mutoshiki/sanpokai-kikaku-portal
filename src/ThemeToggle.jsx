import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import {
  GlobalTheme,
  HeaderGlobalAction,
  HeaderGlobalBar,
  HeaderPanel,
  RadioButton,
  RadioButtonGroup,
  Theme as CarbonTheme,
} from '@carbon/react';
import { Settings } from '@carbon/icons-react';

export const THEME_STORAGE_KEY = 'sanpokai-theme-preference-v1';
const SYSTEM = 'system';
const LIGHT = 'light';
const DARK = 'dark';
const VALID_PREFERENCES = new Set([SYSTEM, LIGHT, DARK]);
const DARK_QUERY = '(prefers-color-scheme: dark)';
const ROOT_THEME_CLASSES = ['cds--white', 'cds--g100'];

const ThemePreferenceContext = createContext({
  preference: SYSTEM,
  resolvedTheme: 'white',
  setPreference: () => {},
});

function readPreference() {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    if (VALID_PREFERENCES.has(stored)) return stored;
  } catch {
    // Keep the default when storage is unavailable.
  }
  return SYSTEM;
}

function readSystemDark() {
  return Boolean(window.matchMedia?.(DARK_QUERY).matches);
}

export function ThemePreferenceProvider({ children }) {
  const [preference, setPreferenceState] = useState(readPreference);
  const [systemDark, setSystemDark] = useState(readSystemDark);
  const resolvedTheme = preference === DARK || (preference === SYSTEM && systemDark) ? 'g100' : 'white';

  useEffect(() => {
    const media = window.matchMedia?.(DARK_QUERY);
    if (!media) return undefined;
    const sync = (event) => setSystemDark(event.matches);
    setSystemDark(media.matches);
    media.addEventListener?.('change', sync);
    return () => media.removeEventListener?.('change', sync);
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute('data-carbon-theme', resolvedTheme);
    root.style.colorScheme = resolvedTheme === 'g100' ? 'dark' : 'light';
    root.classList.remove(...ROOT_THEME_CLASSES);
    root.classList.add(resolvedTheme === 'g100' ? 'cds--g100' : 'cds--white', 'cds--layer-one');
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', resolvedTheme === 'g100' ? '#161616' : '#ffffff');
  }, [resolvedTheme]);

  const setPreference = (nextPreference) => {
    const next = VALID_PREFERENCES.has(nextPreference) ? nextPreference : SYSTEM;
    setPreferenceState(next);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // Theme still works for this visit when persistence is unavailable.
    }
  };

  const value = useMemo(() => ({ preference, resolvedTheme, setPreference }), [preference, resolvedTheme]);

  return (
    <ThemePreferenceContext.Provider value={value}>
      <GlobalTheme theme={resolvedTheme}>
        <CarbonTheme theme={resolvedTheme} className="app-theme-root">
          {children}
        </CarbonTheme>
      </GlobalTheme>
    </ThemePreferenceContext.Provider>
  );
}

export function useThemePreference() {
  return useContext(ThemePreferenceContext);
}

export function ThemeHeaderControl() {
  const { preference, resolvedTheme, setPreference } = useThemePreference();
  const [expanded, setExpanded] = useState(false);
  const currentLabel = preference === SYSTEM ? 'システム設定' : preference === LIGHT ? 'ライト' : 'ダーク';

  const selectPreference = (value) => {
    setPreference(value);
    setExpanded(false);
  };

  return (
    <>
      <HeaderGlobalBar>
        <HeaderGlobalAction
          aria-label={`テーマ設定：${currentLabel}`}
          aria-expanded={expanded}
          isActive={expanded}
          tooltipAlignment="end"
          onClick={() => setExpanded((value) => !value)}
        >
          <Settings size={20} />
        </HeaderGlobalAction>
      </HeaderGlobalBar>
      <HeaderPanel aria-label="テーマ設定" expanded={expanded}>
        <div className="theme-preference-panel__content">
          <p className="theme-preference-panel__title">表示テーマ</p>
          <RadioButtonGroup
            legendText="表示テーマ"
            name="theme-preference"
            orientation="vertical"
            valueSelected={preference}
            onChange={selectPreference}
          >
            <RadioButton id="theme-system" labelText="システム設定" value={SYSTEM} />
            <RadioButton id="theme-light" labelText="ライト" value={LIGHT} />
            <RadioButton id="theme-dark" labelText="ダーク" value={DARK} />
          </RadioButtonGroup>
          <p className="theme-preference-panel__status">
            現在の表示：{resolvedTheme === 'g100' ? 'ダーク' : 'ライト'}
          </p>
        </div>
      </HeaderPanel>
    </>
  );
}
