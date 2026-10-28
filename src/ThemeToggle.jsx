import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
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
  const triggerRef = useRef(null);
  const closePanel = () => {
    setExpanded(false);
    window.requestAnimationFrame(() => triggerRef.current?.focus());
  };
  const currentLabel = preference === SYSTEM ? '端末の設定に合わせる' : preference === LIGHT ? 'ライト' : 'ダーク';

  const selectPreference = (value) => {
    setPreference(value);
  };

  useEffect(() => {
    if (!expanded) return undefined;
    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closePanel();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [expanded]);

  return (
    <>
      <HeaderGlobalBar>
        <HeaderGlobalAction
          ref={triggerRef}
          aria-label={`表示設定を${expanded ? '閉じる' : '開く'}（現在：${currentLabel}）`}
          aria-expanded={expanded}
          aria-controls="theme-preference-panel"
          isActive={expanded}
          tooltipAlignment="end"
          onClick={() => expanded ? closePanel() : setExpanded(true)}
        >
          <Settings size={20} />
        </HeaderGlobalAction>
      </HeaderGlobalBar>
      <HeaderPanel id="theme-preference-panel" aria-label="表示設定" aria-hidden={!expanded} inert={!expanded} expanded={expanded}>
        <div className="theme-preference-panel__content">
          <RadioButtonGroup
            legendText="表示モード"
            name="theme-preference"
            orientation="vertical"
            valueSelected={preference}
            onChange={selectPreference}
          >
            <RadioButton id="theme-system" labelText="端末の設定に合わせる" value={SYSTEM} />
            <RadioButton id="theme-light" labelText="ライト" value={LIGHT} />
            <RadioButton id="theme-dark" labelText="ダーク" value={DARK} />
          </RadioButtonGroup>
          {preference === SYSTEM && <p className="theme-preference-panel__status">現在は{resolvedTheme === 'g100' ? 'ダーク' : 'ライト'}モードです。</p>}
        </div>
      </HeaderPanel>
    </>
  );
}
