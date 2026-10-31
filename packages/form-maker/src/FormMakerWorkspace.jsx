import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Button,
  Content,
  Column,
  Grid,
  InlineLoading,
  InlineNotification,
  TextArea,
  TextInput,
  Tile,
  ToastNotification,
} from '@carbon/react';
import { Copy, Launch, Renew } from '@carbon/icons-react';
import { FORM_MAKER_FIREBASE_CONFIG } from './firebase-public-config.js';
import { canonicalInput, createFormMakerSession } from './form-maker-session.js';
import { mergeFormMakerJobs, projectUrlWithHandoffCapability, readCachedFormMakerHistory, writeCachedFormMakerHistory } from './form-maker-history.js';
import { createProjectJobStorage, migrateLegacyPendingJob } from './project-job-storage.js';
import './form-maker.scss';

const PENDING_JOB_KEY = 'sanpokai-form-maker-pending-job-v1';
const INITIAL_INPUT = { planName: '', editorEmail: '', eventDate: '', deadline: '', description: '' };
const POLL_MS = 3000;

function readPendingJobId(projectStorage) {
  if (projectStorage) return projectStorage.readPendingJob()?.jobId || '';
  try { return sessionStorage.getItem(PENDING_JOB_KEY) || ''; } catch { return ''; }
}

function savePendingJobId(projectStorage, jobId, state = 'queued') {
  if (projectStorage) return jobId
    ? projectStorage.writePendingJob({ jobId, state, updatedAt: Date.now() })
    : projectStorage.clearPendingJob();
  try {
    if (jobId) sessionStorage.setItem(PENDING_JOB_KEY, jobId);
    else sessionStorage.removeItem(PENDING_JOB_KEY);
    return true;
  } catch { return false; }
}

function jobMessage(job) {
  switch (job?.state) {
    case 'queued': return '作成が始まるまで数分かかることがあります。完了したフォームは下に表示されます。';
    case 'running': return 'フォームを作成しています。完了したら下に表示します。';
    case 'completed': return '応募用リンクを参加者に共有してください。';
    case 'partial': return unfinishedSteps(job).length
      ? 'フォームはできましたが、設定が一部残っています。下の項目と作成履歴を確認してください。'
      : 'フォームはできましたが、設定が一部残っています。作成履歴を確認してください。';
    case 'failed': return '作成履歴を確認してください。フォームが見つかった場合は、重複して作らないようご注意ください。';
    case 'unknown': return '作成結果がまだ分かりません。重複を避けるため、下の「作成結果を確認」を押してください。';
    default: return '';
  }
}

function userFacingError(error, fallback) {
  if (error?.status === 401 || error?.status === 403) {
    return '作成結果を確認できませんでした。時間をおいて「作成結果を確認」を押してください。結果が分かるまでは、新しいフォームを作らないでください。';
  }
  if (/Firebase request failed/i.test(String(error?.message || ''))) {
    return '作成結果を確認できませんでした。通信を確認して「作成結果を確認」を押してください。結果が分かるまでは、新しいフォームを作らないでください。';
  }
  return error instanceof Error && error.message ? error.message : fallback;
}

function readinessError(error) {
  if (error?.status === 401 || error?.status === 403) {
    return { title: 'フォーム作成サービスを利用できません', message: '時間をおいて、もう一度「接続を再確認」を押してください。' };
  }
  if (/起動できません/.test(String(error?.message || ''))) {
    return { title: 'フォーム作成サービスを起動できません', message: 'ページを開き直してください。' };
  }
  if (/このブラウザーではフォームを作成できません/.test(String(error?.message || ''))) {
    return { title: 'このブラウザーではフォームを作成できません', message: 'ブラウザーを最新版にして、もう一度お試しください。' };
  }
  return {
    title: 'フォーム作成サービスに接続できません',
    message: error instanceof Error && error.message
      ? error.message
      : '通信を確認して、「接続を再確認」を押してください。',
  };
}

function unfinishedSteps(job) {
  const labelForStep = (key) => {
    const normalized = key.toLowerCase();
    if (/editor|shar/.test(normalized)) return '編集権限の共有';
    if (/sheet|spread/.test(normalized)) return '回答シートの設定';
    if (/project|room/.test(normalized)) return '企画の作成';
    if (/applic|sync/.test(normalized)) return '応募者情報の連携';
    return 'その他の設定';
  };
  return Object.entries(job?.result?.stepResults || {}).flatMap(([key, result]) => {
    const label = labelForStep(key);
    const state = typeof result === 'string' ? result.toLowerCase() : String(result?.state || result?.status || '').toLowerCase();
    const succeeded = result === true || result?.ok === true || result?.success === true || result?.granted === true || result?.completed === true || ['complete', 'completed', 'succeeded', 'success', 'done'].includes(state);
    const failed = result === false || result?.ok === false || result?.success === false || result?.granted === false || result?.completed === false || ['failed', 'error', 'incomplete', 'skipped'].includes(state) || Boolean(result?.warning || result?.error);
    return !succeeded && failed ? [label] : [];
  }).filter((label, index, values) => values.indexOf(label) === index);
}

export default function FormMakerWorkspace({ project = null, session: providedSession, createProjectLink, linkedForm = null, active = true, onNotice = () => {}, onHandoffReady = () => {} }) {
  const projectStorage = useMemo(() => project?.roomId ? createProjectJobStorage({ roomId: project.roomId }) : null, [project?.roomId]);
  const session = useMemo(() => {
    if (providedSession) return providedSession;
    try {
      return createFormMakerSession({ config: FORM_MAKER_FIREBASE_CONFIG });
    } catch (error) {
      const unavailable = async () => { throw error; };
      return { prepare: unavailable, listJobs: unavailable, getJob: unavailable, enqueue: unavailable, getHandoffToken: () => '' };
    }
  }, [providedSession]);
  const [projectLink, setProjectLink] = useState(project);
  const [input, setInput] = useState(() => ({
    ...INITIAL_INPUT,
    ...(projectStorage?.readInput() || {}),
    ...(projectLink ? { planName: projectLink.projectName, eventDate: projectLink.eventDate,
      targetRoomId: projectLink.roomId, targetRoomJobId: projectLink.jobId, targetRoomCapability: projectLink.token } : {}),
  }));
  const [readiness, setReadiness] = useState({ state: 'checking', accepting: false });
  const [job, setJob] = useState(linkedForm);
  const [history, setHistory] = useState(() => mergeFormMakerJobs(readCachedFormMakerHistory(), []));
  const [historyState, setHistoryState] = useState('loading');
  const [error, setError] = useState('');
  const [errorTitle, setErrorTitle] = useState('作成結果を確認できませんでした');
  const [errorNeedsRefresh, setErrorNeedsRefresh] = useState(false);
  const [toast, setToast] = useState('');
  const [copyError, setCopyError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const formMakerHistoryHeadingRef = useRef(null);
  const workspaceRootRef = useRef(null);

  useEffect(() => { if (projectStorage) projectStorage.writeInput(input); }, [input, projectStorage]);
  useEffect(() => { if (linkedForm) setJob(linkedForm); }, [linkedForm]);

  const applyJobs = useCallback((jobs) => {
    setHistory((current) => {
      const next = mergeFormMakerJobs(mergeFormMakerJobs(readCachedFormMakerHistory(), current), jobs);
      writeCachedFormMakerHistory(next);
      return next;
    });
  }, []);

  const refreshReadiness = useCallback(async () => {
    try {
      const status = await session.prepare();
      const state = status.accepting ? 'ready' : status.acceptanceMode === 'test' && !status.testOwner ? 'maintenance' : 'paused';
      setReadiness({ ...status, state });
    } catch (error) {
      const detail = readinessError(error);
      setReadiness((current) => ({ ...current, state: 'unavailable', errorTitle: detail.title, errorMessage: detail.message }));
    }
  }, [session]);

  const refreshHistory = useCallback(async () => {
    setHistoryState('loading');
    try {
      const jobs = await session.listJobs(20);
      applyJobs(jobs);
      setHistoryState('ready');
    } catch {
      setHistoryState('unavailable');
    }
  }, [applyJobs, session]);

  const refreshPendingJob = useCallback(async () => {
    if (projectStorage && project?.jobId) migrateLegacyPendingJob({ roomStorage: projectStorage, projectJobId: project.jobId });
    const pendingId = readPendingJobId(projectStorage) || (project?.roomId ? String(project.jobId || '') : '');
    if (!pendingId) return;
    try {
      const pendingJob = await session.getJob(pendingId);
      setJob(pendingJob ? { ...pendingJob, jobId: pendingId } : { jobId: pendingId, state: 'unknown' });
      setError('');
      setErrorNeedsRefresh(false);
    } catch {
      setJob({ jobId: pendingId, state: 'unknown' });
    }
  }, [project?.jobId, project?.roomId, projectStorage, session]);

  const refresh = useCallback(async () => {
    await refreshReadiness();
    await refreshHistory();
    await refreshPendingJob();
  }, [refreshHistory, refreshPendingJob, refreshReadiness]);

  useEffect(() => { if (active) void refresh(); }, [active, refresh]);

  useEffect(() => {
    if (!active || !job || !['queued', 'running'].includes(job.state)) return undefined;
    const timer = window.setInterval(async () => {
      try {
        const latest = await session.getJob(job.jobId);
        if (!latest) return;
        setJob({ ...latest, jobId: job.jobId });
        const jobs = await session.listJobs(20);
        applyJobs(jobs);
        if (['completed', 'partial', 'failed'].includes(latest.state)) savePendingJobId(projectStorage, '', latest.state);
      } catch { /* Keep the last known state and let the user retry. */ }
    }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [active, applyJobs, job, projectStorage, session]);

  useEffect(() => {
    if (job && ['completed', 'partial'].includes(job.state) && job.result?.formUrl) formMakerHistoryHeadingRef.current?.focus();
  }, [job?.state, job?.result?.formUrl]);

  const update = (key) => (event) => setInput((current) => ({ ...current, [key]: event.target.value }));

  const submit = async (event) => {
    event.preventDefault();
    if (submitting || !readiness.accepting || readPendingJobId(projectStorage)) return;
    try {
      canonicalInput(input);
    } catch (failure) {
      setErrorTitle('入力内容を確認してください');
      setErrorNeedsRefresh(false);
      setError(userFacingError(failure, '入力内容を確認してください。'));
      return;
    }
    let link = projectLink;
    try { if (project) link = await createProjectLink?.(input); }
    catch (failure) {
      setErrorTitle('企画と連携できません');
      setErrorNeedsRefresh(false);
      setError(userFacingError(failure, '企画との接続を確認できません。ページを開き直してください。'));
      return;
    }
    if (project && !link) {
      setErrorTitle('企画と連携できません');
      setErrorNeedsRefresh(false);
      setError('企画との接続を確認できません。ページを開き直してください。');
      return;
    }
    const jobId = link?.jobId || crypto.randomUUID().replaceAll('-', '');
    if (!savePendingJobId(projectStorage, jobId)) {
      setErrorTitle('作成状況を保存できません');
      setErrorNeedsRefresh(false);
      setError('作成状況を保存できませんでした。ブラウザーでこのサイトのデータ保存を許可してください。');
      return;
    }
    setSubmitting(true);
    setError('');
    setErrorNeedsRefresh(false);
    try {
      const jobInput = link?.roomId ? { ...input, targetRoomId: link.roomId, targetRoomJobId: link.jobId, targetRoomCapability: link.token } : input;
      const accepted = await session.enqueue(jobInput, { jobId });
      setJob({ ...accepted, jobId });
      if (projectStorage) projectStorage.writeInput(INITIAL_INPUT);
      setInput(projectStorage ? INITIAL_INPUT : input);
      if (accepted.handoffToken && link?.roomId) onHandoffReady({ roomId: link.roomId, jobId, token: accepted.handoffToken });
      onNotice('応募フォームの作成を受け付けました');
      await refreshHistory();
    } catch (failure) {
      const message = userFacingError(failure, '作成結果を確認できませんでした。');
      setErrorTitle(/作成結果を確認|新しく作り直さず/.test(message) ? '作成結果を確認できませんでした' : 'フォームを作成できませんでした');
      setErrorNeedsRefresh(true);
      setError(message);
      try {
        const recovered = await session.getJob(jobId);
        if (recovered) {
          setJob({ ...recovered, jobId });
          setError('');
          setErrorNeedsRefresh(false);
        }
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
      setCopyError('応募用リンクをコピーできませんでした。「応募フォームを開く」から開き、アドレス欄のURLをコピーしてください。');
    }
  };

  const startAnotherForm = () => {
    if (project) return;
    savePendingJobId(projectStorage, '');
    setJob(null);
    setInput(INITIAL_INPUT);
    setProjectLink(null);
    setError('');
    setErrorNeedsRefresh(false);
    workspaceRootRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' });
    workspaceRootRef.current?.querySelector('#plan-name')?.focus();
  };

  const pendingId = readPendingJobId(projectStorage);
  const accepting = readiness.accepting && readiness.state === 'ready';
  const canSubmit = accepting && !submitting && !pendingId && !job && !project?.jobId;
  const hasFinishedForm = ['completed', 'partial'].includes(job?.state);
  const hasFinishedResult = hasFinishedForm && Boolean(job?.result?.formUrl);
  const projectHistory = project
    ? history.filter((item) => item.jobId === project.jobId || item.projectId === project.roomId)
    : history;
  const visibleHistory = projectHistory.filter((item) => !(hasFinishedResult && ((job.result?.formId && item.formId === job.result.formId) || (job.jobId && item.jobId === job.jobId))));

  return <Content ref={workspaceRootRef} id={project?.roomId ? `form-maker-${project.roomId}` : 'main-content'} className="form-maker-page">
      <div className="form-maker-layout">
        <h1 className="cds--visually-hidden">フォーム作成</h1>
        <div className="form-maker-heading">
          <p>{projectLink ? `「${projectLink.projectName}」に連携する応募フォームを作成します。` : '企画の情報を入力すると、参加者向けの応募フォームを作成できます。'}</p>
        </div>

        {readiness.state === 'checking' && <div className="form-maker-status" role="status"><InlineLoading description="作成サービスに接続しています" /></div>}
        {readiness.state === 'maintenance' && <InlineNotification kind="warning" lowContrast hideCloseButton title="ただいまメンテナンス中です" subtitle="時間をおいて、もう一度お試しください。" />}
        {readiness.state === 'paused' && <InlineNotification kind="warning" lowContrast hideCloseButton title="現在、新しいフォームを作成できません" subtitle="時間をおいて、もう一度お試しください。" />}
        {readiness.state === 'unavailable' && <div className="form-maker-readiness-error"><InlineNotification kind="error" lowContrast hideCloseButton title={readiness.errorTitle || 'フォーム作成サービスに接続できません'} subtitle={readiness.errorMessage || '通信を確認して、「接続を再確認」を押してください。'} /><Button kind="ghost" size="sm" renderIcon={Renew} onClick={() => void refreshReadiness()}>接続を再確認</Button></div>}

        {!hasFinishedForm && <Tile className="form-maker-panel">
          <form onSubmit={submit} aria-label="応募フォームの作成">
            <TextInput id="plan-name" labelText="企画名（必須）" placeholder="例：妙高山登山企画" helperText="100文字以内" required maxLength={100} value={input.planName} onChange={update('planName')} />
            <TextInput id="editor-email" labelText="メールアドレス（必須）" helperText="作成したGoogleフォームの編集権限を、このアドレスに共有します。" type="email" autoComplete="email" required value={input.editorEmail} onChange={update('editorEmail')} />
            <Grid narrow className="form-maker-date-grid">
              <Column sm={4} md={4} lg={8}><TextInput id="event-date" labelText="実施日（任意）" type="date" value={input.eventDate} onChange={update('eventDate')} /></Column>
              <Column sm={4} md={4} lg={8}><TextInput id="application-deadline" labelText="応募締切日（任意）" type="date" value={input.deadline} onChange={update('deadline')} /></Column>
            </Grid>
            <TextArea id="plan-description" labelText="企画の説明（任意）" helperText="集合場所や持ち物、注意事項など" rows={3} maxLength={3000} value={input.description} onChange={update('description')} />
            <p className="form-maker-character-count" aria-label={`3,000文字中${input.description.length}文字`}>{input.description.length.toLocaleString('ja-JP')} / 3,000文字</p>
            {error && <div className="form-maker-submit-error"><InlineNotification kind="error" lowContrast hideCloseButton title={errorTitle} subtitle={error} />{errorNeedsRefresh && <Button kind="ghost" size="sm" renderIcon={Renew} onClick={() => void refresh()}>作成結果を確認</Button>}</div>}
            {!job && <p className="form-maker-submit-note">作成には数分かかることがあります。</p>}
            <Button type="submit" className="form-maker-submit" kind="primary" size="lg" disabled={!canSubmit} renderIcon={submitting ? Renew : undefined}>
              {submitting ? '作成を依頼しています…' : '応募フォームを作成'}
            </Button>
          </form>
        </Tile>}

        {job && !hasFinishedResult && <section className="form-maker-job" aria-labelledby="job-status-heading">
          <h2 id="job-status-heading">フォームの作成状況</h2>
          <InlineNotification kind={job.state === 'completed' ? 'success' : job.state === 'partial' || job.state === 'unknown' || job.state === 'queued' ? 'warning' : job.state === 'failed' ? 'error' : 'info'} lowContrast hideCloseButton title={job.state === 'queued' ? '作成待ちです' : job.state === 'running' ? '作成中です' : job.state === 'completed' ? 'フォームを作成しました' : job.state === 'partial' ? 'フォームはできましたが、設定が一部残っています' : job.state === 'unknown' ? '作成結果がまだ分かりません' : 'フォームを作成できませんでした'} subtitle={jobMessage(job)} />
          {job.state === 'partial' && unfinishedSteps(job).length > 0 && <ul className="form-maker-incomplete-steps">{unfinishedSteps(job).map((step) => <li key={step}>{step}が完了していません。</li>)}</ul>}
          {job.state === 'unknown' && <Button kind="tertiary" size="sm" renderIcon={Renew} onClick={() => void refresh()}>作成結果を確認</Button>}
          {!project && ['completed', 'partial', 'failed'].includes(job.state) && <Button kind="tertiary" size="sm" onClick={startAnotherForm}>別のフォームを作る</Button>}
        </section>}

        <section className={`form-maker-history${hasFinishedResult ? ' form-maker-history--with-current' : ''}`} aria-labelledby="form-maker-history-heading">
          <div className="form-maker-section-heading"><h2 id="form-maker-history-heading" tabIndex={hasFinishedResult ? -1 : undefined} ref={formMakerHistoryHeadingRef}>作成したフォーム</h2><Button kind="ghost" size="sm" renderIcon={Renew} onClick={() => void refreshHistory()}>履歴を再読み込み</Button></div>
          {historyState === 'loading' && history.length === 0 && <p role="status">作成履歴を読み込んでいます。</p>}
          {historyState === 'unavailable' && <p role="status">作成履歴を読み込めませんでした。「履歴を再読み込み」を押してください。</p>}
          {visibleHistory.length === 0 && historyState === 'ready' && !hasFinishedResult && <p>まだフォームはありません。作成したフォームはここに表示されます。</p>}
          <ul className="form-maker-history-list">
            {hasFinishedResult && <li className="form-maker-current-result">
              <InlineNotification kind={job.state === 'completed' ? 'success' : 'warning'} lowContrast hideCloseButton title={job.state === 'completed' ? 'フォームを作成しました' : 'フォームはできましたが、設定が一部残っています'} subtitle={jobMessage(job)} />
              {job.state === 'partial' && unfinishedSteps(job).length > 0 && <ul className="form-maker-incomplete-steps">{unfinishedSteps(job).map((step) => <li key={step}>{step}が完了していません。</li>)}</ul>}
              <div className="form-maker-result-summary">
                <strong>{job.result.planName || job.planName || '企画名なし'}</strong>
                <time>{job.result.createdAt || job.createdAt ? `作成日時：${new Intl.DateTimeFormat('ja-JP', { dateStyle: 'medium', timeStyle: 'short' }).format(Number(job.result.createdAt || job.createdAt))}` : '作成日時は不明です'}</time>
              </div>
              <div className="form-maker-result-links">
                <Button kind={job.state === 'completed' ? 'primary' : 'tertiary'} size="lg" renderIcon={Copy} onClick={() => copyLink(job.result.formUrl)}>応募用リンクをコピー</Button>
                <a href={job.result.formUrl} target="_blank" rel="noopener noreferrer">応募フォームを開く <Launch size={16} aria-hidden="true" /></a>
                {job.result.editUrl && <a href={job.result.editUrl} target="_blank" rel="noopener noreferrer">フォームを編集する <Launch size={16} aria-hidden="true" /></a>}
                {job.result.projectUrl && <a href={projectUrlWithHandoffCapability(job.result.projectUrl, session.getHandoffToken(job.jobId))} target="_blank" rel="noopener noreferrer" aria-label="企画ツールを開く（新しいタブ）">企画ツールを開く <Launch size={16} aria-hidden="true" /></a>}
                {job.result.responseSheetUrl && <a href={job.result.responseSheetUrl} target="_blank" rel="noopener noreferrer">回答シートを開く <Launch size={16} aria-hidden="true" /></a>}
              </div>
              {copyError && <p className="form-maker-error" role="alert">コピーできませんでした。「応募フォームを開く」から開き、アドレス欄のURLをコピーしてください。</p>}
              {!project && <Button className="form-maker-another-button" kind="tertiary" size="sm" onClick={startAnotherForm}>別のフォームを作る</Button>}
            </li>}
            {visibleHistory.map((item) => <li key={item.formId}>
                <div><strong>{item.planName || '企画名なし'}</strong><time>{item.createdAt ? `作成日時：${new Intl.DateTimeFormat('ja-JP', { dateStyle: 'medium', timeStyle: 'short' }).format(Number(item.createdAt))}` : '作成日時は不明です'}</time></div>
              <div className="form-maker-history-actions">
                {item.responseUrl && <a href={item.responseUrl} target="_blank" rel="noopener noreferrer">応募フォームを開く</a>}
                {item.editUrl && <a href={item.editUrl} target="_blank" rel="noopener noreferrer">フォームを編集する</a>}
                {item.projectUrl && <a href={projectUrlWithHandoffCapability(item.projectUrl, session.getHandoffToken(item.jobId))} target="_blank" rel="noopener noreferrer">企画ツールを開く</a>}
                {item.responseSheetUrl && <a href={item.responseSheetUrl} target="_blank" rel="noopener noreferrer">回答シートを開く</a>}
              </div>
            </li>)}
          </ul>
        </section>
      </div>
    {toast && <ToastNotification className="toast-host" kind="success" title={toast} timeout={4000} lowContrast onCloseButtonClick={() => setToast('')} />}
  </Content>;
}
