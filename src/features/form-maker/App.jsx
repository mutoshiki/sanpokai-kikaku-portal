import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Button,
  Content,
  Column,
  Grid,
  Header,
  HeaderName,
  InlineLoading,
  InlineNotification,
  SkipToContent,
  TextArea,
  TextInput,
  Tile,
  ToastNotification,
  Theme as CarbonTheme,
} from '@carbon/react';
import { Copy, Launch, Renew } from '@carbon/icons-react';
import { ThemeHeaderControl } from '../../ThemeToggle.jsx';
import { FORM_MAKER_FIREBASE_CONFIG } from '../../services/firebase-public-config.js';
import { createFormMakerSession } from '../../services/form-maker-session.js';
import { mergeFormMakerJobs, projectUrlWithHandoffCapability, readCachedFormMakerHistory, writeCachedFormMakerHistory } from '../../services/form-maker-history.js';

const PENDING_JOB_KEY = 'sanpokai-form-maker-pending-job-v1';
const INITIAL_INPUT = { planName: '', editorEmail: '', eventDate: '', deadline: '', description: '' };
const POLL_MS = 3000;

function readPendingJobId() {
  try { return sessionStorage.getItem(PENDING_JOB_KEY) || ''; } catch { return ''; }
}

function savePendingJobId(jobId) {
  try {
    if (jobId) sessionStorage.setItem(PENDING_JOB_KEY, jobId);
    else sessionStorage.removeItem(PENDING_JOB_KEY);
    return true;
  } catch { return false; }
}

function jobMessage(job) {
  switch (job?.state) {
    case 'queued': return '受付しました。処理が始まるまでこの画面を閉じても、履歴から状態を確認できます。';
    case 'running': return 'フォームを作成しています。少し時間をおいて状態を確認します。';
    case 'completed': return 'フォームを作成しました。下の履歴からリンクを開けます。';
    case 'partial': return 'フォームはできましたが、一部の設定を確認してください。履歴に結果を表示しています。';
    case 'failed': return 'フォームは作成されませんでした。内容を確認して、もう一度お試しください。';
    case 'unknown': return '作成結果を確認できません。重複を防ぐため自動で再作成しません。履歴を更新してください。';
    default: return '';
  }
}

function App() {
  const session = useMemo(() => createFormMakerSession({ config: FORM_MAKER_FIREBASE_CONFIG }), []);
  const [input, setInput] = useState(INITIAL_INPUT);
  const [readiness, setReadiness] = useState({ state: 'checking', accepting: false });
  const [job, setJob] = useState(null);
  const [history, setHistory] = useState(() => mergeFormMakerJobs(readCachedFormMakerHistory(), []));
  const [historyState, setHistoryState] = useState('loading');
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');
  const [copyError, setCopyError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const headingRef = useRef(null);

  const applyJobs = useCallback((jobs) => {
    setHistory((current) => {
      const next = mergeFormMakerJobs(mergeFormMakerJobs(readCachedFormMakerHistory(), current), jobs);
      writeCachedFormMakerHistory(next);
      return next;
    });
  }, []);

  const refresh = useCallback(async () => {
    try {
      const status = await session.prepare();
      const jobs = await session.listJobs(20);
      const state = status.accepting ? 'ready' : status.acceptanceMode === 'test' && !status.testOwner ? 'maintenance' : 'paused';
      setReadiness({ ...status, state });
      applyJobs(jobs);
      setHistoryState('ready');
      const pendingId = readPendingJobId();
      if (pendingId) {
        const pendingJob = await session.getJob(pendingId);
        setJob(pendingJob ? { ...pendingJob, jobId: pendingId } : { jobId: pendingId, state: 'unknown' });
      }
      setError('');
    } catch {
      setReadiness((current) => ({ ...current, state: 'unavailable' }));
      setHistoryState('unavailable');
    }
  }, [applyJobs, session]);

  useEffect(() => { void refresh(); }, [refresh]);

  useEffect(() => {
    if (!job || !['queued', 'running'].includes(job.state)) return undefined;
    const timer = window.setInterval(async () => {
      try {
        const latest = await session.getJob(job.jobId);
        if (!latest) return;
        setJob({ ...latest, jobId: job.jobId });
        const jobs = await session.listJobs(20);
        applyJobs(jobs);
        if (['completed', 'partial', 'failed'].includes(latest.state)) savePendingJobId('');
      } catch { /* Keep the last known state and let the user retry. */ }
    }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [applyJobs, job, session]);

  useEffect(() => {
    if (job && ['completed', 'partial'].includes(job.state)) headingRef.current?.focus();
  }, [job?.state]);

  const update = (key) => (event) => setInput((current) => ({ ...current, [key]: event.target.value }));

  const submit = async (event) => {
    event.preventDefault();
    if (submitting || !readiness.accepting || readPendingJobId()) return;
    const jobId = crypto.randomUUID().replaceAll('-', '');
    if (!savePendingJobId(jobId)) {
      setError('このタブで作成状況を保存できません。ブラウザーのタブ保存を許可してから、もう一度お試しください。');
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      const accepted = await session.enqueue(input, { jobId });
      setJob({ ...accepted, jobId });
      setInput(INITIAL_INPUT);
      const jobs = await session.listJobs(20);
      applyJobs(jobs);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : '受付状況を確認できませんでした。');
      try {
        const recovered = await session.getJob(jobId);
        if (recovered) setJob({ ...recovered, jobId });
      } catch { /* The request ID remains saved to prevent accidental duplicate creation. */ }
    } finally {
      setSubmitting(false);
    }
  };

  const copyLink = async (value) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopyError('');
      setToast('応募用リンクをコピーしました');
    } catch {
      setCopyError('コピーできませんでした。リンクを開いてコピーしてください。');
    }
  };

  const startAnotherForm = () => {
    savePendingJobId('');
    setJob(null);
    setInput(INITIAL_INPUT);
    setError('');
    window.scrollTo({ top: 0, behavior: 'smooth' });
    document.getElementById('plan-name')?.focus();
  };

  const pendingId = readPendingJobId();
  const accepting = readiness.accepting && readiness.state === 'ready';
  const canSubmit = accepting && !submitting && !pendingId && !job;

  return <>
    <CarbonTheme as={Header} theme="g100" aria-label="山歩会企画ツール一覧">
      <SkipToContent href="#main-content">本文へ移動</SkipToContent>
      <HeaderName href={`${import.meta.env.BASE_URL}`} prefix="">山歩会企画ツール一覧</HeaderName>
      <ThemeHeaderControl />
    </CarbonTheme>
    <Content id="main-content" className="form-maker-page">
      <div className="form-maker-layout">
        <div className="form-maker-heading">
          <p className="form-maker-eyebrow">参加者募集</p>
          <h1 tabIndex="-1" ref={headingRef}>応募フォームを作る</h1>
          <p>企画の情報を入力すると、応募用Googleフォームを用意します。</p>
        </div>

        {readiness.state === 'checking' && <div className="form-maker-status" role="status"><InlineLoading description="受付状況を確認しています" /></div>}
        {readiness.state === 'maintenance' && <InlineNotification kind="warning" lowContrast hideCloseButton title="メンテナンス中です" subtitle="現在は動作確認を行っています。フォーム作成はテスト端末からのみ利用できます。" />}
        {readiness.state === 'paused' && <InlineNotification kind="warning" lowContrast hideCloseButton title="現在、受付を止めています" subtitle="入力内容は入力できます。受付再開後に作成できます。" />}
        {readiness.state === 'unavailable' && <InlineNotification kind="error" lowContrast hideCloseButton title="受付状況を確認できません" subtitle="フォーム入力はできます。通信を確認してから、もう一度お試しください。" />}

        <Tile className="form-maker-panel">
          <form onSubmit={submit} aria-label="応募フォームの作成">
            <TextInput id="plan-name" labelText="企画名" placeholder="例：秋の山歩き" required maxLength={100} value={input.planName} onChange={update('planName')} />
            <TextInput id="editor-email" labelText="フォームを編集する人のメールアドレス" helperText="Googleフォームの編集権限を共有します。" type="email" autoComplete="email" required value={input.editorEmail} onChange={update('editorEmail')} />
            <Grid narrow className="form-maker-date-grid">
              <Column sm={4} md={4} lg={8}><TextInput id="event-date" labelText="実施日" type="date" value={input.eventDate} onChange={update('eventDate')} /></Column>
              <Column sm={4} md={4} lg={8}><TextInput id="application-deadline" labelText="応募締切" type="date" value={input.deadline} onChange={update('deadline')} /></Column>
            </Grid>
            <TextArea id="plan-description" labelText="企画の内容・集合場所・注意事項" rows={5} maxLength={3000} value={input.description} onChange={update('description')} />
            <p className="form-maker-character-count">{input.description.length}/3000</p>
            {error && <InlineNotification kind="error" lowContrast hideCloseButton title="受付を確認できませんでした" subtitle={error} />}
            <Button type="submit" className="form-maker-submit" kind="primary" size="lg" disabled={!canSubmit} renderIcon={Renew}>
              {submitting ? '受付を確認しています' : pendingId ? '作成状況を確認中' : job ? '履歴で作成状況を確認' : 'Googleフォームを作成'}
            </Button>
          </form>
        </Tile>

        {job && <section className="form-maker-job" aria-labelledby="job-status-heading">
          <h2 id="job-status-heading">作成状況</h2>
          <InlineNotification kind={job.state === 'completed' ? 'success' : job.state === 'partial' || job.state === 'unknown' ? 'warning' : job.state === 'failed' ? 'error' : 'info'} lowContrast hideCloseButton title={job.state === 'queued' ? '受付済み' : job.state === 'running' ? '作成中' : job.state === 'completed' ? '作成完了' : job.state === 'partial' ? '一部の設定が未完了です' : job.state === 'unknown' ? '結果を確認しています' : '作成できませんでした'} subtitle={jobMessage(job)} />
          {job.result?.formUrl && <div className="form-maker-result-links">
            <a href={job.result.formUrl} target="_blank" rel="noopener noreferrer">応募フォームを開く <Launch size={16} aria-hidden="true" /></a>
            <Button kind="ghost" size="sm" renderIcon={Copy} onClick={() => copyLink(job.result.formUrl)}>応募用リンクをコピー</Button>
            {copyError && <p className="form-maker-error" role="alert">{copyError}</p>}
            {job.result.projectUrl && <a href={projectUrlWithHandoffCapability(job.result.projectUrl, session.getHandoffToken(job.jobId))} target="_blank" rel="noopener noreferrer">サークル企画ツールで企画を開く <Launch size={16} aria-hidden="true" /></a>}
          </div>}
          {job.state === 'unknown' && <Button kind="tertiary" size="sm" renderIcon={Renew} onClick={() => void refresh()}>作成状況を更新</Button>}
          {['completed', 'partial', 'failed'].includes(job.state) && <Button kind="tertiary" size="sm" onClick={startAnotherForm}>別のフォームを作る</Button>}
        </section>}

        <section className="form-maker-history" aria-labelledby="form-maker-history-heading">
          <div className="form-maker-section-heading"><h2 id="form-maker-history-heading">作成したフォーム</h2><Button kind="ghost" size="sm" renderIcon={Renew} onClick={() => void refresh()}>更新</Button></div>
          {historyState === 'unavailable' && <p role="status">履歴を読み込めませんでした。入力画面はそのまま使えます。</p>}
          {history.length === 0 && historyState !== 'unavailable' && <p>作成したフォームはここに表示されます。</p>}
          <ul className="form-maker-history-list">
            {history.map((item) => <li key={item.formId}>
                <div><strong>{item.planName || '応募フォーム'}</strong><time>{item.createdAt ? new Intl.DateTimeFormat('ja-JP', { dateStyle: 'medium', timeStyle: 'short' }).format(Number(item.createdAt)) : '作成日不明'}</time></div>
              <div className="form-maker-history-actions">
                {item.responseUrl && <a href={item.responseUrl} target="_blank" rel="noopener noreferrer">応募フォームを開く</a>}
                {item.editUrl && <a href={item.editUrl} target="_blank" rel="noopener noreferrer">フォームを編集する</a>}
                {item.projectUrl && <a href={projectUrlWithHandoffCapability(item.projectUrl, session.getHandoffToken(item.jobId))} target="_blank" rel="noopener noreferrer">企画を開く</a>}
                {item.responseSheetUrl && <a href={item.responseSheetUrl} target="_blank" rel="noopener noreferrer">回答シートを開く</a>}
              </div>
            </li>)}
          </ul>
        </section>
      </div>
    </Content>
    {toast && <ToastNotification className="toast-host" kind="success" title={toast} timeout={4000} lowContrast onCloseButtonClick={() => setToast('')} />}
  </>;
}

export default App;
