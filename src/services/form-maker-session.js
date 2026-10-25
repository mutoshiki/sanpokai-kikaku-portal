const AUTH_CACHE_KEY = 'sanpokai-form-maker-auth-v1';
const HANDOFF_TOKEN_KEY_PREFIX = 'sanpokai-form-maker-handoff-capability-v1:';
const JOB_ID_PATTERN = /^[A-Za-z0-9_-]{16,80}$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ADMISSION_SLOT_COUNT = 40;

function safeRead(storage, key) {
  try {
    const value = storage?.getItem(key);
    return value ? JSON.parse(value) : null;
  } catch {
    return null;
  }
}

function safeWrite(storage, key, value) {
  try {
    storage?.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

function authCacheValid(value) {
  return value && typeof value.uid === 'string' && value.uid &&
    typeof value.refreshToken === 'string' && value.refreshToken;
}

function canonicalInput(input) {
  const value = {
    planName: String(input?.planName || '').trim(),
    editorEmail: String(input?.editorEmail || '').trim(),
    eventDate: String(input?.eventDate || ''),
    deadline: String(input?.deadline || ''),
    description: String(input?.description || ''),
  };
  if (!value.planName || value.planName.length > 100) throw new Error('企画名を100文字以内で入力してください。');
  if (!EMAIL_PATTERN.test(value.editorEmail) || value.editorEmail.length > 254) throw new Error('編集者のメールアドレスを確認してください。');
  if (value.eventDate.length > 40 || value.deadline.length > 40) throw new Error('日付の入力が長すぎます。');
  if (value.description.length > 3000) throw new Error('企画内容は3000文字以内で入力してください。');
  if (Object.values(value).some((item) => /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(item))) {
    throw new Error('入力に使用できない制御文字が含まれています。');
  }
  return value;
}

function makeJobId(cryptoApi) {
  const uuid = cryptoApi?.randomUUID?.();
  if (uuid) return uuid.replaceAll('-', '');
  const bytes = new Uint8Array(16);
  cryptoApi.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function validHandoffToken(value) {
  return /^h_[A-Za-z0-9_-]{48,160}$/.test(String(value || ''));
}

function handoffTokenKey(jobId) {
  return HANDOFF_TOKEN_KEY_PREFIX + String(jobId || '');
}

function readHandoffToken(jobId, storage) {
  const token = safeRead(storage, handoffTokenKey(jobId));
  return validHandoffToken(token?.token) ? token.token : '';
}

async function hashHandoffToken(token, cryptoApi) {
  const digest = await cryptoApi.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

function newHandoffToken(cryptoApi) {
  if (typeof cryptoApi?.randomUUID !== 'function') throw new Error('このブラウザーでは安全な引き継ぎ権限を作成できません。');
  return `h_${cryptoApi.randomUUID().replaceAll('-', '')}${cryptoApi.randomUUID().replaceAll('-', '')}`;
}

function safeProviderError(payload) {
  const code = String(payload?.error?.message || '');
  return /^[A-Z0-9_]+$/.test(code) ? code : '';
}

export function createFormMakerSession({
  config,
  fetchImpl = globalThis.fetch?.bind(globalThis),
  storage = globalThis.localStorage,
  cryptoApi = globalThis.crypto,
  now = Date.now,
} = {}) {
  if (!config?.apiKey || !config?.databaseURL) throw new Error('Firebaseの接続設定を読み込めません。');
  if (typeof fetchImpl !== 'function') throw new Error('このブラウザーでは通信機能を使えません。');

  const authBase = 'https://identitytoolkit.googleapis.com/v1';
  const tokenBase = 'https://securetoken.googleapis.com/v1';
  const databaseBase = String(config.databaseURL).replace(/\/$/, '');
  let memoryAuth = null;

  async function fetchJson(url, options = {}) {
    let response;
    try {
      response = await fetchImpl(url, options);
    } catch {
      throw new Error('Firebaseに接続できません。通信状態を確認して、もう一度お試しください。');
    }
    let payload = null;
    try { payload = await response.json(); } catch { payload = null; }
    if (!response.ok) {
      const error = new Error(`Firebase request failed (${response.status}).`);
      error.status = response.status;
      error.providerCode = safeProviderError(payload);
      throw error;
    }
    return payload;
  }

  function authHeaders(idToken) {
    return { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` };
  }

  function databaseUrl(path, idToken, query = {}) {
    const params = new URLSearchParams({ auth: idToken, ...query });
    return `${databaseBase}/${path}.json?${params.toString()}`;
  }

  function persistAuth(auth) {
    memoryAuth = auth;
    safeWrite(storage, AUTH_CACHE_KEY, { uid: auth.uid, refreshToken: auth.refreshToken });
  }

  async function createAnonymousAuth() {
    const payload = await fetchJson(`${authBase}/accounts:signUp?key=${encodeURIComponent(config.apiKey)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ returnSecureToken: true }),
    });
    if (!payload?.localId || !payload?.idToken || !payload?.refreshToken) {
      throw new Error('Firebaseの利用者情報を受け取れませんでした。');
    }
    const auth = {
      uid: String(payload.localId),
      idToken: String(payload.idToken),
      refreshToken: String(payload.refreshToken),
      expiresAt: now() + Number(payload.expiresIn || 3600) * 1000,
    };
    persistAuth(auth);
    return auth;
  }

  async function refreshAuth(cached) {
    const payload = await fetchJson(`${tokenBase}/token?key=${encodeURIComponent(config.apiKey)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: cached.refreshToken }).toString(),
    });
    if (!payload?.user_id || !payload?.id_token || !payload?.refresh_token || String(payload.user_id) !== cached.uid) {
      throw new Error('Firebaseの利用者情報を確認できませんでした。履歴の安全のため、新しいIDは自動で作成しません。');
    }
    const auth = {
      uid: String(payload.user_id),
      idToken: String(payload.id_token),
      refreshToken: String(payload.refresh_token),
      expiresAt: now() + Number(payload.expires_in || 3600) * 1000,
    };
    persistAuth(auth);
    return auth;
  }

  async function getAuth() {
    if (memoryAuth?.idToken && memoryAuth.expiresAt > now() + 30_000) return memoryAuth;
    const cached = memoryAuth || safeRead(storage, AUTH_CACHE_KEY);
    if (authCacheValid(cached)) {
      try {
        return await refreshAuth(cached);
      } catch (error) {
        if (!['INVALID_REFRESH_TOKEN', 'TOKEN_EXPIRED', 'USER_DISABLED'].includes(error.providerCode)) throw error;
        try { storage?.removeItem(AUTH_CACHE_KEY); } catch { /* unavailable storage */ }
        memoryAuth = null;
      }
    }
    return createAnonymousAuth();
  }

  async function readStatusWithAuth(auth) {
    const status = await fetchJson(databaseUrl('formMakerV1/status', auth.idToken));
    if (!status || typeof status !== 'object' || typeof status.accepting !== 'boolean') {
      throw new Error('受付状況を確認できません。しばらくしてからもう一度お試しください。');
    }
    const acceptanceMode = status.acceptanceMode === undefined ? 'open' : status.acceptanceMode;
    if (!['open', 'test'].includes(acceptanceMode)) {
      throw new Error('受付状況を確認できません。しばらくしてからもう一度お試しください。');
    }
    let testOwner = false;
    if (acceptanceMode === 'test') {
      try {
        testOwner = (await fetchJson(databaseUrl(`formMakerV1/testOwners/${encodeURIComponent(auth.uid)}`, auth.idToken))) === true;
      } catch {
        throw new Error('受付状況を確認できません。しばらくしてからもう一度お試しください。');
      }
    }
    return {
      accepting: status.accepting && (acceptanceMode === 'open' || testOwner),
      acceptanceMode,
      testOwner,
      state: String(status.state || 'unknown'),
      dailyCount: Number(status.dailyCount || 0),
      dailyLimit: Number(status.dailyLimit || 0),
      updatedAt: Number(status.updatedAt || 0),
    };
  }

  async function prepare() {
    const auth = await getAuth();
    return { uid: auth.uid, ...(await readStatusWithAuth(auth)) };
  }

  async function getJob(jobId) {
    if (!JOB_ID_PATTERN.test(String(jobId || ''))) throw new Error('作成要求を確認できません。');
    const auth = await getAuth();
    const job = await fetchJson(databaseUrl(`formMakerV1/users/${encodeURIComponent(auth.uid)}/jobs/${encodeURIComponent(jobId)}`, auth.idToken));
    return job && typeof job === 'object' ? job : null;
  }

  async function listJobs(limit = 10) {
    const auth = await getAuth();
    const safeLimit = Math.max(1, Math.min(50, Math.floor(Number(limit) || 10)));
    const jobs = await fetchJson(databaseUrl(`formMakerV1/users/${encodeURIComponent(auth.uid)}/jobs`, auth.idToken, {
      orderBy: '"requestedAt"',
      limitToLast: String(safeLimit),
    }));
    return jobs && typeof jobs === 'object'
      ? Object.entries(jobs).map(([jobId, job]) => ({ ...job, jobId })).sort((left, right) => Number(right.requestedAt || 0) - Number(left.requestedAt || 0))
      : [];
  }

  async function reserveAdmissionSlot({ auth, jobId, kind, requestHash, requestedAt }) {
    const start = (Number.parseInt(requestHash.slice(0, 8), 16) % ADMISSION_SLOT_COUNT) + 1;
    const reservation = { uid: auth.uid, jobId, kind, requestHash, requestedAt };
    for (let offset = 0; offset < ADMISSION_SLOT_COUNT; offset += 1) {
      const slotId = String(((start - 1 + offset) % ADMISSION_SLOT_COUNT) + 1).padStart(2, '0');
      const slotUrl = databaseUrl(`formMakerV1/admission/slots/${slotId}`, auth.idToken);
      try {
        await fetchJson(slotUrl, {
          method: 'PUT',
          headers: authHeaders(auth.idToken),
          body: JSON.stringify(reservation),
        });
        return { slotId, requestedAt };
      } catch (error) {
        if (error.status === 412 || ['PERMISSION_DENIED', 'UNAUTHENTICATED'].includes(error.providerCode)) {
          // Another owner may hold this slot. A retry by this same owner can read it back.
          try {
            const existing = await fetchJson(slotUrl);
            if (existing?.uid === auth.uid && existing.jobId === jobId && existing.kind === kind &&
                existing.requestHash === requestHash && Number(existing.requestedAt) > 0) {
              return { slotId, requestedAt: Number(existing.requestedAt) };
            }
          } catch { /* occupied by another owner, or read access is unavailable */ }
          continue;
        }
        // A lost response may have committed the reservation. Verify only this deterministic slot
        // before retrying elsewhere, so a network interruption cannot strand a hidden duplicate.
        try {
          const existing = await fetchJson(slotUrl);
          if (existing?.uid === auth.uid && existing.jobId === jobId && existing.kind === kind &&
              existing.requestHash === requestHash && Number(existing.requestedAt) > 0) {
            return { slotId, requestedAt: Number(existing.requestedAt) };
          }
        } catch { /* outcome remains unknown */ }
        throw new Error('受付枠を確保できたか確認できません。履歴を更新して状態を確認してください。');
      }
    }
    throw new Error('受付枠を確保できません。申込みが混み合っているため、時間をおいてもう一度お試しください。');
  }

  async function enqueue(input, options = {}) {
    const cleanInput = canonicalInput(input);
    const auth = await getAuth();
    const status = await readStatusWithAuth(auth);
    if (!status.accepting) {
      if (status.acceptanceMode === 'test' && !status.testOwner) throw new Error('現在はテスト端末だけで確認しています。一般のフォーム作成はメンテナンス中です。');
      throw new Error('受付を一時停止中です。入力内容は残っています。時間をおいてもう一度お試しください。');
    }

    const jobId = String(options.jobId || makeJobId(cryptoApi));
    if (!JOB_ID_PATTERN.test(jobId)) throw new Error('作成要求IDが正しくありません。');
    let handoffToken = readHandoffToken(jobId, storage);
    if (!handoffToken) {
      handoffToken = newHandoffToken(cryptoApi);
      if (!safeWrite(storage, handoffTokenKey(jobId), { token: handoffToken })) {
        throw new Error('この端末に引き継ぎ権限を保存できません。ブラウザーの保存設定を確認してください。');
      }
    }
    const jobInput = { ...cleanInput, handoffTokenHash: await hashHandoffToken(handoffToken, cryptoApi) };
    const canonical = JSON.stringify(jobInput);
    const digest = await cryptoApi.subtle.digest('SHA-256', new TextEncoder().encode(canonical));
    const inputHash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
    const path = `formMakerV1/users/${encodeURIComponent(auth.uid)}/jobs/${encodeURIComponent(jobId)}`;
    const url = databaseUrl(path, auth.idToken);
    const existing = await fetchJson(url);
    if (existing) {
      if (existing.jobId !== jobId || existing.inputHash !== inputHash) {
        throw new Error('この作成要求IDは別の入力に使われています。入力を変えず、履歴から状態を確認してください。');
      }
      return { ...existing, jobId, handoffToken };
    }

    const admission = await reserveAdmissionSlot({ auth, jobId, kind: 'create', requestHash: inputHash, requestedAt: now() });
    const payload = {
      jobId,
      protocolVersion: 1,
      admissionSlotId: admission.slotId,
      input: jobInput,
      inputHash,
      requestedAt: admission.requestedAt,
      state: 'queued',
    };
    try {
      await fetchJson(url, {
        method: 'PUT',
        headers: { ...authHeaders(auth.idToken), 'if-match': 'null_etag' },
        body: JSON.stringify(payload),
      });
      return { ...payload, handoffToken };
    } catch (error) {
      if (error.status !== 412) throw error;
      const raced = await getJob(jobId);
      if (raced?.jobId === jobId && raced.inputHash === inputHash) return { ...raced, handoffToken };
      throw new Error('同じ要求が別のタブで受付済みです。履歴から状態を確認してください。');
    }
  }

  return Object.freeze({ prepare, enqueue, getJob, listJobs, getUid: async () => (await getAuth()).uid, getHandoffToken: jobId => readHandoffToken(jobId, storage) });
}

export { AUTH_CACHE_KEY, canonicalInput };
