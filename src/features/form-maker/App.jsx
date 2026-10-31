import React, { useMemo } from 'react';
import { Header, HeaderName, SkipToContent, Theme as CarbonTheme } from '@carbon/react';
import { ThemeHeaderControl } from '../../ThemeToggle.jsx';
import { FormMakerWorkspace, FORM_MAKER_FIREBASE_CONFIG, createFormMakerSession, readFormMakerProjectLink } from '../../../packages/form-maker/src/index.js';

export default function App() {
  const session = useMemo(() => {
    try { return createFormMakerSession({ config: FORM_MAKER_FIREBASE_CONFIG }); }
    catch (error) {
      const unavailable = async () => { throw error; };
      return { prepare: unavailable, listJobs: unavailable, getJob: unavailable, enqueue: unavailable, getHandoffToken: () => '' };
    }
  }, []);
  const project = useMemo(() => readFormMakerProjectLink(), []);
  return <>
    <CarbonTheme as={Header} theme="g100" aria-label="山歩会フォームメーカー">
      <SkipToContent href="#main-content">本文へ移動</SkipToContent>
      <HeaderName href={`${import.meta.env.BASE_URL}`} target="_blank" rel="noopener noreferrer" aria-label="山歩会企画ツール一覧を新しいタブで開く" prefix="">山歩会フォームメーカー</HeaderName>
      <ThemeHeaderControl />
    </CarbonTheme>
    <FormMakerWorkspace session={session} project={project} />
  </>;
}
