// ===== application-link.gs =====
const FORM_MAKER_PROJECT_LINK_TTL_MAX_MS = 6 * 60 * 60 * 1000;

/** Validate and claim the app-created one-time room reservation before creating external resources. */
function formMakerClaimProjectRoomLink_(job) {
  const input = job && job.input || {};
  if (Number(job && job.protocolVersion) !== 2) return null;
  const roomId = String(input.targetRoomId || '');
  const capabilityHash = String(input.targetRoomCapabilityHash || '');
  if (!/^[A-Za-z0-9_-]{6,80}$/.test(roomId) || !/^[a-f0-9]{64}$/.test(capabilityHash) ||
      !/^[a-f0-9]{32}$/.test(String(job.jobId || ''))) throw new Error('project_link_invalid');

  const roomResult = formMakerWorkerRequest_('get', 'rooms/' + roomId, {
    idToken: job.workerIdToken, headers: { 'X-Firebase-ETag': 'true' },
  });
  const room = roomResult.value;
  if (!room || Number(room.schemaVersion) !== 6 || !room.allocations) throw new Error('project_room_invalid');
  const linked = formMakerProjectRoomMeta_(room).applicationSync;
  if (linked) {
    if (linked.kind === 'formApplicationSync' && Number(linked.version) === 2 &&
        linked.projectId === roomId && linked.handoffTokenHash === String(input.handoffTokenHash || '')) {
      return { roomId: roomId, alreadyLinked: true };
    }
    throw new Error('project_room_already_linked');
  }

  const path = 'projectFormLinksV1/' + roomId;
  const linkResult = formMakerWorkerRequest_('get', path, {
    idToken: job.workerIdToken, headers: { 'X-Firebase-ETag': 'true' },
  });
  const link = linkResult.value;
  if (!link || Number(link.schemaVersion) !== 1 || link.jobId !== job.jobId || link.tokenHash !== capabilityHash) throw new Error('project_link_invalid');
  if (link.state === 'processing') return { roomId: roomId, alreadyProcessing: true };
  if (link.state !== 'pending' || !Number.isSafeInteger(Number(link.requestedAt)) || !Number.isSafeInteger(Number(link.expiresAt)) ||
      Number(link.expiresAt) <= Date.now() || Number(link.expiresAt) - Number(link.requestedAt) > FORM_MAKER_PROJECT_LINK_TTL_MAX_MS) {
    throw new Error('project_link_expired');
  }
  if (!linkResult.etag) throw new Error('project_link_unavailable');
  const claimed = Object.assign({}, link, { state: 'processing', startedAt: Date.now() });
  try {
    formMakerWorkerRequest_('put', path, { idToken: job.workerIdToken, body: claimed, headers: { 'if-match': linkResult.etag } });
  } catch (error) {
    if (!/HTTP 412/.test(String(error && error.message || error))) throw error;
    const raced = formMakerWorkerRequest_('get', path, { idToken: job.workerIdToken });
    if (!raced.value || raced.value.jobId !== job.jobId || raced.value.tokenHash !== capabilityHash || raced.value.state !== 'processing') throw new Error('project_link_conflict');
  }
  return { roomId: roomId, alreadyProcessing: false };
}

function formMakerCompleteProjectRoomLink_(job, state) {
  if (Number(job && job.protocolVersion) !== 2) return;
  const input = job.input || {};
  const path = 'projectFormLinksV1/' + String(input.targetRoomId || '');
  const result = formMakerWorkerRequest_('get', path, { idToken: job.workerIdToken, headers: { 'X-Firebase-ETag': 'true' } });
  if (!result.value || result.value.jobId !== job.jobId || result.value.tokenHash !== input.targetRoomCapabilityHash ||
      !['processing', 'linked'].includes(result.value.state)) throw new Error('project_link_conflict');
  if (result.value.state === 'linked') return;
  const next = Object.assign({}, result.value, { state: state, completedAt: Date.now() });
  formMakerWorkerRequest_('put', path, { idToken: job.workerIdToken, body: next, headers: { 'if-match': result.etag } });
}

function formMakerCheckExistingProjectRoom_(metadata, idToken) {
  const projectId = validateManagedProjectId_(metadata && metadata.projectId);
  const room = firebaseGetJson_('rooms/' + projectId, idToken).value;
  if (!isManagedProjectRoomValid_(room)) return { state: 'repair-required' };
  const linked = formMakerProjectRoomMeta_(room).applicationSync;
  if (linked && (linked.projectId !== projectId || linked.handoffTokenHash !== String(metadata.handoffTokenHash || ''))) return { state: 'conflict' };
  return { state: 'ready' };
}

function formMakerWriteLinkedApplicationSnapshot_(metadata, applicationSync, idToken) {
  const projectId = validateManagedProjectId_(metadata && metadata.projectId);
  const link = formMakerWorkerRequest_('get', 'projectFormLinksV1/' + projectId, { idToken: idToken }).value;
  if (!link || link.jobId !== metadata.projectLinkJobId || link.tokenHash !== metadata.projectLinkCapabilityHash ||
      (link.state !== 'processing' && link.state !== 'linked')) throw new Error('project_link_invalid');
  const room = firebaseGetJson_('rooms/' + projectId, idToken).value;
  if (!room || Number(room.schemaVersion) !== 6 || !room.allocations) throw new Error('project_room_invalid');
  const existing = formMakerProjectRoomMeta_(room).applicationSync;
  if (existing && (existing.projectId !== projectId || existing.handoffTokenHash !== String(metadata.handoffTokenHash || ''))) {
    throw new Error('project_room_already_linked');
  }
  const path = 'rooms/' + projectId + '/meta/applicationSync';
  const current = firebaseGetJson_(path, idToken);
  if (current.value && (current.value.projectId !== projectId || current.value.handoffTokenHash !== String(metadata.handoffTokenHash || ''))) {
    throw new Error('project_room_already_linked');
  }
  if (!current.etag) throw new Error('project_link_unavailable');
  try {
    formMakerWorkerRequest_('put', path, { idToken: idToken, body: applicationSync, headers: { 'if-match': current.etag } });
  } catch (error) {
    if (/HTTP 412/.test(String(error && error.message || error))) throw new Error('project_room_already_linked');
    throw error;
  }
}


// ===== creation.gs =====
const FORM_MAKER_CREATION_MARKER_PREFIX = '作成要求:';

function doPost(e) {
  try {
    const payload = JSON.parse(String(e && e.postData && e.postData.contents || '{}'));
    const properties = PropertiesService.getScriptProperties();
    const secret = String(properties.getProperty('FORM_MAKER_QUEUE_CALLBACK_SECRET_V1') || '');
    const timestamp = String(payload.timestamp || '');
    const nonce = String(payload.nonce || '');
    const uid = String(payload.uid || '');
    const jobId = String(payload.jobId || '');
    if (payload.version !== 1 || !secret || !/^\d{13}$/.test(timestamp) || !/^[A-Za-z0-9_-]{16,80}$/.test(nonce) ||
        !/^[A-Za-z0-9_-]{1,128}$/.test(uid) || !/^[A-Za-z0-9_-]{16,80}$/.test(jobId) || Math.abs(Date.now() - Number(timestamp)) > 2 * 60 * 1000) {
      return formMakerQueueCallbackResponse_({ ok: false, state: 'invalid_request' });
    }
    const canonical = [timestamp, nonce, uid, jobId].join('\n');
    const expected = Utilities.computeHmacSha256Signature(canonical, secret).map(function (byte) {
      return ('0' + ((byte + 256) % 256).toString(16)).slice(-2);
    }).join('');
    const supplied = String(payload.signature || '');
    if (!/^[a-f0-9]{64}$/.test(supplied) || !formMakerConstantTimeEqual_(expected, supplied)) {
      return formMakerQueueCallbackResponse_({ ok: false, state: 'unauthorized' });
    }
    const result = formMakerProcessQueuedJobByIdV1_(uid, jobId);
    return formMakerQueueCallbackResponse_({ ok: true, state: result.state });
  } catch (error) {
    console.error('Queue callback failed: ' + formMakerClassifyWorkerError_(error));
    return formMakerQueueCallbackResponse_({ ok: false, state: 'retry' });
  }
}

function formMakerQueueCallbackResponse_(value) {
  return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON);
}

function formMakerConstantTimeEqual_(left, right) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return difference === 0;
}

function formMakerProcessQueuedJobByIdV1_(uid, jobId) {
  const properties = PropertiesService.getScriptProperties();
  if (properties.getProperty(FORM_MAKER_QUEUE_ENABLED_PROPERTY) !== 'true') throw new Error('queue_paused');
  if (formMakerQueueDailyCount_() >= FORM_MAKER_QUEUE_DAILY_LIMIT) throw new Error('daily_limit');
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) throw new Error('worker_busy');
  const startedAt = Date.now();
  let lease = '';
  let job = null;
  let lockHeld = true;
  try {
    const currentLease = JSON.parse(properties.getProperty(FORM_MAKER_QUEUE_ACTIVE_LEASE_PROPERTY) || 'null');
    if (currentLease && Number(currentLease.expiresAt) > startedAt) return { state: 'already_running' };
    lease = Utilities.getUuid();
    properties.setProperty(FORM_MAKER_QUEUE_ACTIVE_LEASE_PROPERTY, JSON.stringify({ id: lease, expiresAt: startedAt + FORM_MAKER_QUEUE_RUN_BUDGET_MS + 60000 }));
    const idToken = formMakerWorkerIdToken_();
    const path = 'formMakerV1/users/' + uid + '/jobs/' + jobId;
    const current = formMakerWorkerRequest_('get', path, { idToken: idToken }).value;
    if (!current || current.jobId !== jobId) return { state: 'not_queued' };
    if (current.state !== 'queued') return { state: current.state === 'running' ? 'already_running' : 'not_queued' };
    const mode = formMakerQueueAcceptanceMode_();
    if (mode !== 'open' && mode !== 'test') throw new Error('acceptance_paused');
    if (mode === 'test') {
      const owner = formMakerWorkerRequest_('get', 'formMakerV1/testOwners/' + uid, { idToken: idToken }).value;
      if (owner !== true) throw new Error('test_owner_required');
    }
    const invalidCode = formMakerValidateQueuedJob_(uid, jobId, current, Date.now()) ||
      (formMakerValidateAdmissionReservation_(uid, jobId, current.admissionSlotId, 'create', current.inputHash, current.requestedAt, idToken) ? '' : 'invalid_request');
    if (invalidCode) throw new Error(invalidCode);
    const claimedAt = Date.now();
    if (!formMakerTransitionJobState_(uid, jobId, 'queued', 'running', { startedAt: claimedAt }, idToken)) return { state: 'already_running' };
    job = { kind: 'creation', uid: uid, jobId: jobId, protocolVersion: current.protocolVersion, admissionSlotId: current.admissionSlotId, input: current.input, inputHash: current.inputHash, requestedAt: current.requestedAt, startedAt: claimedAt, workerIdToken: idToken };
    formMakerIncrementDailyCount_();
    lock.releaseLock();
    lockHeld = false;
    if (Date.now() - startedAt > FORM_MAKER_QUEUE_RUN_BUDGET_MS) {
      formMakerMarkClaimUnknown_(job, 'worker_time_limit');
      throw new Error('worker_time_limit');
    }
    const outcome = formMakerProcessJob_(job);
    return { state: outcome && outcome.state || 'unknown' };
  } catch (error) {
    if (job) formMakerMarkClaimUnknown_(job, formMakerClassifyWorkerError_(error));
    throw error;
  } finally {
    if (!lockHeld && lease) {
      const cleanupLock = LockService.getScriptLock();
      if (cleanupLock.tryLock(1000)) {
        try {
          const active = JSON.parse(properties.getProperty(FORM_MAKER_QUEUE_ACTIVE_LEASE_PROPERTY) || 'null');
          if (active && active.id === lease) properties.deleteProperty(FORM_MAKER_QUEUE_ACTIVE_LEASE_PROPERTY);
        } finally { cleanupLock.releaseLock(); }
      }
    }
    if (lockHeld) try { lock.releaseLock(); } catch (_) {}
  }
}

function formMakerProcessJob_(job) {
  let journal = formMakerReadCreationJournal_(job.uid, job.jobId);
  if (journal && journal.result && ['completed', 'partial'].indexOf(journal.stage) >= 0) {
    formMakerFinishJob_(job, journal.stage, journal.errorCode || '', journal.result);
    return { state: journal.stage, result: journal.result, errorCode: journal.errorCode || '' };
  }

  try {
    const result = formMakerRunCreationSteps_(job, journal);
    const state = result.stepResults && Object.keys(result.stepResults).every(function (step) { return result.stepResults[step] === 'completed'; }) ? 'completed' : 'partial';
    formMakerWriteCreationJournal_(job.uid, job.jobId, { stage: state, result: result, errorCode: '' });
    if (!formMakerFinishJob_(job, state, '', result)) throw new Error('job_completion_write_failed');
    return { state: state, result: result, errorCode: '' };
  } catch (error) {
    journal = formMakerReadCreationJournal_(job.uid, job.jobId) || journal || {};
    const form = formMakerRecoverFormFromJournal_(job, journal);
    const code = formMakerClassifyCreationError_(error);
    if (!form && journal.stage === 'creating_form') {
      formMakerWriteCreationJournal_(job.uid, job.jobId, { stage: 'unknown', errorCode: 'resource_creation_outcome_unknown' });
      formMakerFinishJob_(job, 'unknown', 'resource_creation_outcome_unknown');
      return { state: 'unknown', errorCode: 'resource_creation_outcome_unknown' };
    }
    if (!form && Number(job.protocolVersion) === 2 && journal.stage !== 'unknown') {
      try { formMakerCompleteProjectRoomLink_(job, 'failed'); } catch (_) { /* Keep the original safe failure; an uncertain reservation stays locked. */ }
    }
    if (form) {
      const partial = formMakerPartialResult_(job, journal, form, code);
      formMakerWriteCreationJournal_(job.uid, job.jobId, { stage: 'partial', result: partial, errorCode: code });
      formMakerFinishJob_(job, 'partial', code, partial);
      return { state: 'partial', errorCode: code, result: partial };
    }
    formMakerWriteCreationJournal_(job.uid, job.jobId, { stage: 'failed', errorCode: code });
    formMakerFinishJob_(job, 'failed', code);
    return { state: 'failed', errorCode: code };
  }
}

function formMakerRunCreationSteps_(job, existingJournal) {
  const input = job.input;
  let journal = existingJournal || formMakerReadCreationJournal_(job.uid, job.jobId) || {};
  if (Number(job.protocolVersion) === 2) formMakerClaimProjectRoomLink_(job);
  const marker = FORM_MAKER_CREATION_MARKER_PREFIX + job.jobId;
  let form = formMakerRecoverFormFromJournal_(job, journal);

  if (!form) {
    if (journal.stage === 'creating_form' || journal.stage === 'unknown') throw new Error('resource_creation_outcome_unknown');
    const projectId = input.targetRoomId || journal.projectId || generateManagedProjectId_();
    journal = formMakerWriteCreationJournal_(job.uid, job.jobId, {
      stage: 'creating_form', marker: marker, projectId: projectId, inputHash: job.inputHash,
      stepResults: { form: 'unknown', sharing: 'skipped', responses: 'skipped', project: 'unknown', sync: 'skipped' },
    });
    const temporaryTitle = cleanText_(input.planName, 100) + ' 応募フォーム [' + marker + ']';
    form = FormApp.create(temporaryTitle);
    journal = formMakerWriteCreationJournal_(job.uid, job.jobId, { stage: 'form_created', formId: form.getId() });
    DriveApp.getFileById(form.getId()).setName(cleanText_(input.planName, 100) + ' 応募フォーム');
  }

  if (!journal.stepResults || journal.stepResults.form !== 'completed') {
    configureApplicationForm_(form, input);
    journal = formMakerWriteCreationJournal_(job.uid, job.jobId, {
      stage: 'form_configured', stepResults: Object.assign({}, journal.stepResults || {}, { form: 'completed' }),
    });
  }

  let editorResult = { granted: Boolean(journal.formEditorGranted), method: journal.formEditorMethod || '', warning: '' };
  if (!journal.stepResults || journal.stepResults.sharing !== 'completed') {
    editorResult = grantEditorAccess_(form, input.editorEmail);
    journal = formMakerWriteCreationJournal_(job.uid, job.jobId, {
      stage: 'form_shared', formEditorGranted: Boolean(editorResult.granted), formEditorMethod: editorResult.method || '',
      stepResults: Object.assign({}, journal.stepResults || {}, { sharing: editorResult.granted ? 'completed' : 'failed' }),
    });
  }

  const projectId = input.targetRoomId || journal.projectId || generateManagedProjectId_();
  if (typeof form.isAcceptingResponses === 'function' && form.isAcceptingResponses()) {
    const earlyResult = {
      planName: input.planName,
      createdAt: Date.now(),
      formId: form.getId(),
      formUrl: form.getPublishedUrl(),
      editUrl: form.getEditUrl(),
      projectId: projectId,
    };
    if (earlyResult.formUrl) formMakerPersistAvailableFormResult_(job, earlyResult);
  }
  const handoffTokenHash = String(input.handoffTokenHash || '');
  const managed = setupManagedFormResponseSync_(form, input, {
    workerIdToken: job.workerIdToken,
    projectId: projectId,
    handoffTokenHash: handoffTokenHash,
    projectLinkJobId: Number(job.protocolVersion) === 2 ? job.jobId : '',
    projectLinkCapabilityHash: Number(job.protocolVersion) === 2 ? String(input.targetRoomCapabilityHash || '') : '',
    existingProjectRoom: Number(job.protocolVersion) === 2,
    spreadsheetId: journal.spreadsheetId || '',
    checkpoint: function (checkpoint) { formMakerWriteCreationJournal_(job.uid, job.jobId, checkpoint); },
  });
  if (Number(job.protocolVersion) === 2 && managed.syncEnabled && managed.projectId === projectId) {
    formMakerCompleteProjectRoomLink_(job, 'linked');
  }
  const stepResults = Object.assign({}, journal.stepResults || {}, {
    form: 'completed',
    sharing: editorResult.granted ? 'completed' : 'failed',
    responses: managed.spreadsheetId ? 'completed' : 'failed',
    project: managed.projectId ? 'completed' : 'failed',
    sync: managed.syncEnabled ? 'completed' : (managed.status === 'capacity' ? 'failed' : 'unknown'),
  });
  const result = {
    planName: input.planName,
    createdAt: Date.now(),
    formId: form.getId(),
    formUrl: form.getPublishedUrl(),
    editUrl: form.getEditUrl(),
    projectId: projectId,
    projectUrl: managed.projectUrl || buildManagedProjectUrl_(projectId),
    responseSheetUrl: managed.spreadsheetUrl || '',
    stepResults: stepResults,
  };
  formMakerWriteCreationJournal_(job.uid, job.jobId, {
    stage: 'configured', formId: form.getId(), projectId: projectId,
    spreadsheetId: managed.spreadsheetId || journal.spreadsheetId || '',
    stepResults: stepResults,
  });
  return result;
}

function formMakerPersistAvailableFormResult_(job, result) {
  if (!job || !result || !result.formUrl || !job.workerIdToken) return false;
  formMakerWorkerRequest_('put', 'formMakerV1/users/' + job.uid + '/jobs/' + job.jobId + '/result', {
    idToken: job.workerIdToken,
    body: result,
  });
  return true;
}

function formMakerRecoverFormFromJournal_(job, journal) {
  if (journal && journal.formId) {
    try { return FormApp.openById(journal.formId); } catch (_) { return null; }
  }
  if (!journal || !journal.marker || typeof DriveApp.searchFiles !== 'function') return null;
  const escaped = String(journal.marker).replace(/'/g, "\\'");
  const files = DriveApp.searchFiles("title contains '" + escaped + "' and mimeType = 'application/vnd.google-apps.form'");
  if (!files.hasNext()) return null;
  const file = files.next();
  const form = FormApp.openById(file.getId());
  formMakerWriteCreationJournal_(job.uid, job.jobId, { stage: 'form_created', formId: form.getId() });
  return form;
}

function formMakerPartialResult_(job, journal, form, errorCode) {
  const projectId = journal.projectId || '';
  const projectUrl = projectId ? buildManagedProjectUrl_(projectId) : '';
  const stepResults = Object.assign({}, journal.stepResults || {}, { form: 'completed', sync: 'unknown' });
  return {
    planName: job.input.planName,
    createdAt: Number(journal.createdAt || Date.now()),
    formId: form.getId(),
    formUrl: form.getPublishedUrl(),
    editUrl: form.getEditUrl(),
    projectId: projectId,
    projectUrl: projectUrl,
    responseSheetUrl: journal.spreadsheetId ? SpreadsheetApp.openById(journal.spreadsheetId).getUrl() : '',
    stepResults: stepResults,
  };
}

function formMakerClassifyCreationError_(error) {
  const message = String(error && error.message || '');
  if (/resource_creation_outcome_unknown/.test(message)) return 'resource_creation_outcome_unknown';
  if (/HTTP 401|HTTP 403|identity mismatch|not provisioned/i.test(message)) return 'firebase_auth';
  if (/quota|too many/i.test(message)) return 'quota';
  if (/execution|timeout|time limit/i.test(message)) return 'execution_limit';
  if (/sharing/i.test(message)) return 'sharing_failed';
  return 'creation_step_failed';
}


// ===== events.gs =====
const FORM_IMPORT_EVENT_TRIGGER_HANDLER = 'syncManagedFormOnSubmitV1';
const FORM_IMPORT_EVENT_TRIGGER_SAFE_TOTAL_LIMIT = 16;
const FORM_IMPORT_EVENT_SYNC_LOCK_MS = 1000;

function ensureManagedFormSubmitTrigger_(form) {
  if (!form || typeof form.getId !== 'function') return { enabled: false, status: 'invalid_form' };
  const formId = String(form.getId() || '').trim();
  if (!formId) return { enabled: false, status: 'invalid_form' };

  const result = withMetadataLock_(function () {
    const triggers = ScriptApp.getProjectTriggers();
    const matching = triggers.filter(function (trigger) {
      return trigger.getHandlerFunction() === FORM_IMPORT_EVENT_TRIGGER_HANDLER &&
        trigger.getTriggerSourceId() === formId;
    });
    if (matching.length) {
      matching.slice(1).forEach(function (trigger) { ScriptApp.deleteTrigger(trigger); });
      return { enabled: true, status: 'existing' };
    }
    if (typeof form.isAcceptingResponses === 'function' && !form.isAcceptingResponses()) {
      return { enabled: false, status: 'closed' };
    }
    if (triggers.length >= FORM_IMPORT_EVENT_TRIGGER_SAFE_TOTAL_LIMIT) {
      return { enabled: false, status: 'capacity' };
    }
    ScriptApp.newTrigger(FORM_IMPORT_EVENT_TRIGGER_HANDLER).forForm(form).onFormSubmit().create();
    return { enabled: true, status: 'installed' };
  });
  return result || { enabled: false, status: 'busy' };
}

function cleanupClosedManagedFormSubmitTrigger_(formId, knownForm) {
  const id = String(formId || '').trim();
  if (!id) return false;
  const form = knownForm || FormApp.openById(id);
  if (!form || typeof form.isAcceptingResponses !== 'function' || form.isAcceptingResponses()) return false;
  const removed = withMetadataLock_(function () {
    const matching = ScriptApp.getProjectTriggers().filter(function (trigger) {
      return trigger.getHandlerFunction() === FORM_IMPORT_EVENT_TRIGGER_HANDLER &&
        trigger.getTriggerSourceId() === id;
    });
    matching.forEach(function (trigger) { ScriptApp.deleteTrigger(trigger); });
    return matching.length > 0;
  });
  return removed === true;
}

function syncManagedFormOnSubmitV1(event) {
  const formId = event && event.source && typeof event.source.getId === 'function'
    ? String(event.source.getId() || '').trim()
    : '';
  if (!formId || !event.response || typeof event.response.getId !== 'function') return { status: 'ignored' };
  const metadata = readManagedFormImport_(formId);
  if (!metadata || metadata.syncOwner !== 'worker-v1' || metadata.status !== 'active' || !metadata.projectId) {
    return { status: 'ignored' };
  }

  const lock = LockService.getUserLock();
  if (!lock.tryLock(FORM_IMPORT_EVENT_SYNC_LOCK_MS)) return { status: 'deferred' };
  try {
    const token = formMakerWorkerIdToken_();
    const roomReady = metadata.roomStatus === 'ready' &&
      Date.now() - Number(metadata.roomCheckedAtMs || 0) < FORM_IMPORT_FULL_REFRESH_MS;
    if (!roomReady) {
      const room = ensureManagedProjectRoom_(metadata, token);
      if (room.state !== 'ready') throw new Error('Firebase room requires owner repair.');
    }
    const updated = syncManagedFormImportById_(formId, token, false, true);
    recordSyncSuccess_(formId);
    return { status: updated ? 'synced' : 'unchanged' };
  } catch (error) {
    const errorCode = classifySyncError_(error);
    recordSyncFailure_(metadata, error, errorCode);
    return { status: 'error', errorCode: errorCode };
  } finally {
    lock.releaseLock();
  }
}



// ===== firebase-client.gs =====
const FORM_MAKER_WORKER_UID_PROPERTY = 'FORM_MAKER_WORKER_UID_V1';
const FORM_MAKER_WORKER_REFRESH_TOKEN_PROPERTY = 'FORM_MAKER_WORKER_REFRESH_TOKEN_V1';
const FORM_MAKER_WORKER_API_KEY_PROPERTY = 'FORM_MAKER_WORKER_FIREBASE_API_KEY_V1';
const FORM_MAKER_WORKER_DATABASE_URL_PROPERTY = 'FORM_MAKER_WORKER_DATABASE_URL_V1';
const FORM_MAKER_WORKER_DEFAULT_DATABASE_URL = 'https://sanpokai-tool-default-rtdb.firebaseio.com';
const FORM_MAKER_WORKER_SAFE_AUTH_ERRORS = [
  'API_KEY_INVALID', 'API_KEY_SERVICE_BLOCKED', 'OPERATION_NOT_ALLOWED',
  'PROJECT_NOT_FOUND', 'INVALID_ARGUMENT', 'TOO_MANY_ATTEMPTS_TRY_LATER', 'ADMIN_ONLY_OPERATION',
];

function formMakerWorkerSafeAuthError_(response) {
  try {
    const body = JSON.parse(response.getContentText() || '{}');
    const message = String(body && body.error && body.error.message || '');
    const code = FORM_MAKER_WORKER_SAFE_AUTH_ERRORS.find(function (candidate) {
      return message.split(/[^A-Z0-9_]+/).includes(candidate);
    });
    if (code) return ' (' + code + ')';
    if (/blocked|restrict|referrer|client application/i.test(message)) return ' (REQUEST_RESTRICTED)';
    if (/permission denied|does not have permission|forbidden/i.test(message)) return ' (PERMISSION_DENIED)';
    if (/service disabled|not enabled|not been used/i.test(message)) return ' (API_NOT_ENABLED)';
    if (/api key|key is invalid/i.test(message)) return ' (API_KEY_REJECTED)';
    return '';
  } catch (_) {
    return '';
  }
}

function formMakerWorkerIdToken_() {
  const properties = PropertiesService.getScriptProperties();
  const uid = String(properties.getProperty(FORM_MAKER_WORKER_UID_PROPERTY) || '').trim();
  const refreshToken = String(properties.getProperty(FORM_MAKER_WORKER_REFRESH_TOKEN_PROPERTY) || '').trim();
  if (!uid || !refreshToken) throw new Error('Firebase worker identity is not provisioned.');
  const apiKey = formMakerWorkerApiKey_();

  let response;
  try {
    response = UrlFetchApp.fetch(
      'https://securetoken.googleapis.com/v1/token?key=' + encodeURIComponent(apiKey),
      {
        method: 'post',
        contentType: 'application/x-www-form-urlencoded',
        payload: { grant_type: 'refresh_token', refresh_token: refreshToken },
        muteHttpExceptions: true,
      }
    );
  } catch (_) {
    throw new Error('Firebase worker token refresh failed (network).');
  }
  if (response.getResponseCode() !== 200) {
    throw new Error('Firebase worker token refresh failed (HTTP ' + response.getResponseCode() + ')' + formMakerWorkerSafeAuthError_(response) + '.');
  }

  let payload;
  try { payload = JSON.parse(response.getContentText() || '{}'); } catch (_) {
    throw new Error('Firebase worker token refresh returned invalid JSON.');
  }
  const tokenUid = String(payload.user_id || payload.localId || '').trim();
  if (!payload.id_token || !tokenUid) throw new Error('Firebase worker token response is incomplete.');
  if (tokenUid !== uid) throw new Error('Firebase worker identity mismatch.');
  if (payload.refresh_token) properties.setProperty(FORM_MAKER_WORKER_REFRESH_TOKEN_PROPERTY, payload.refresh_token);
  return payload.id_token;
}

function formMakerWorkerApiKey_() {
  const properties = PropertiesService.getScriptProperties();
  const configured = String(properties.getProperty(FORM_MAKER_WORKER_API_KEY_PROPERTY) || '').trim();
  if (configured) return configured;
  throw new Error('Firebase worker API key is not configured.');
}

function formMakerWorkerDatabaseUrl_() {
  const properties = PropertiesService.getScriptProperties();
  const configured = String(properties.getProperty(FORM_MAKER_WORKER_DATABASE_URL_PROPERTY) || '').trim();
  const url = configured || FORM_MAKER_WORKER_DEFAULT_DATABASE_URL;
  if (!/^https:\/\/[a-z0-9.-]+(?:\.firebasedatabase\.app|\.firebaseio\.com)$/.test(url)) {
    throw new Error('Firebase worker database URL is invalid.');
  }
  return url;
}

function formMakerWorkerRequest_(method, path, options) {
  const token = options && options.idToken || formMakerWorkerIdToken_();
  const safePath = String(path || '').replace(/^\/+|\/+$/g, '');
  if (!safePath || safePath.split('/').some(function (segment) { return !segment || segment === '.' || segment === '..'; })) {
    throw new Error('Firebase worker path is invalid.');
  }
  const query = ['auth=' + encodeURIComponent(token)];
  if (options && options.query) query.push(options.query);
  const headers = Object.assign({}, options && options.headers || {});
  const request = {
    method: String(method || 'get').toLowerCase(),
    contentType: 'application/json',
    muteHttpExceptions: true,
    headers,
  };
  if (options && Object.prototype.hasOwnProperty.call(options, 'body')) request.payload = JSON.stringify(options.body);
  const response = UrlFetchApp.fetch(formMakerWorkerDatabaseUrl_() + '/' + safePath + '.json?' + query.join('&'), request);
  const code = response.getResponseCode();
  if (code < 200 || code >= 300) {
    if (!(options && options.acceptedCodes || []).includes(code)) throw new Error('Firebase worker request failed (HTTP ' + code + ').');
  }
  const text = response.getContentText() || 'null';
  let value;
  try { value = JSON.parse(text); } catch (_) { throw new Error('Firebase worker returned invalid JSON.'); }
  const responseHeaders = response.getHeaders ? response.getHeaders() : {};
  const etagHeader = Object.keys(responseHeaders || {}).find(function (name) { return name.toLowerCase() === 'etag'; });
  return { value: value, etag: etagHeader ? responseHeaders[etagHeader] : '', code: code };
}



// ===== form-support.gs =====
// Curated worker-only helpers mirrored from コード.js. UI endpoints and anonymous auth are intentionally excluded.
function configureApplicationForm_(form, data) {
  form.setDescription(buildDescription_(data));
  form.setConfirmationMessage('回答ありがとうございました！\n企画担当者からの連絡をお待ちください。');
  form.setAcceptingResponses(true);
  form.addSectionHeaderItem().setTitle('参加者情報');
  form.addTextItem().setTitle('氏名').setRequired(true);
  form.addTextItem().setTitle('学籍番号').setRequired(true);
  form.addMultipleChoiceItem().setTitle('学年').setChoiceValues(['1年', '2年', '3年', '4年', '大学院', 'その他']).setRequired(true);
  form.addTextItem().setTitle('学部・学科').setRequired(true);
  form.addTextItem().setTitle('LINEの表示名').setRequired(true);
  const carQuestion = form.addMultipleChoiceItem();
  carQuestion.setTitle('車出しはできますか？').setRequired(true);
  const carSection = form.addPageBreakItem().setTitle('車出しについて');
  form.addTextItem().setTitle('車種').setHelpText('例：スバル インプレッサ').setRequired(true);
  form.addTextItem().setTitle('運転者を除いて何人乗せられますか？').setHelpText('数字で入力してください。').setRequired(true);
  form.addParagraphTextItem().setTitle('車についての備考').setHelpText('集合場所・荷物・運転可能時間など、必要な場合のみ記入してください。');
  const finalSection = form.addPageBreakItem().setTitle('その他');
  carQuestion.setChoices([carQuestion.createChoice('はい', carSection), carQuestion.createChoice('いいえ', finalSection)]);
  carSection.setGoToPage(finalSection);
  form.addParagraphTextItem().setTitle('自由記述').setHelpText('連絡事項や質問などがあれば記入してください。');
}

function grantEditorAccess_(form, editorEmail) {
  const errors = [];

  try {
    DriveApp.getFileById(form.getId()).addEditor(editorEmail);
    return { granted: true, method: 'drive', warning: '' };
  } catch (error) {
    errors.push('Drive共有: ' + getErrorMessage_(error));
    console.error('Drive editor sharing failed.');
  }

  try {
    form.addEditor(editorEmail);
    return { granted: true, method: 'forms', warning: '' };
  } catch (error) {
    errors.push('Forms共有: ' + getErrorMessage_(error));
    console.error('Form editor sharing failed.');
  }

  return {
    granted: false,
    method: '',
    warning: 'フォームは作成されましたが、編集者へのアクセス権を追加できませんでした。 原因: ' + errors.join(' / ')
  };
}

function getErrorMessage_(error) {
  if (!error) return '不明なエラー';
  if (error.message) return String(error.message);
  return String(error);
}

/**
 * フォーム作成履歴をScript Propertiesへ保存。
 * 公開Webアプリから全履歴を読み出すAPIは用意せず、編集URLの漏えいを防ぐ。
 */

function buildDescription_(data) {
  const lines = [];
  if (data.eventDate) lines.push(`開催日：${formatDate_(data.eventDate)}`);
  if (data.deadline) lines.push(`回答期限：${formatDateTime_(data.deadline)}`);
  if (lines.length > 0 && data.description) lines.push('');
  if (data.description) lines.push(data.description);
  return lines.join('\n');
}

function cleanText_(value, maxLength) {
  if (value === null || value === undefined) return '';
  return String(value).trim().substring(0, maxLength);
}

function formatDate_(value) {
  if (!value) return '';
  const parts = value.split('-');
  if (parts.length !== 3) return value;
  return `${Number(parts[0])}年${Number(parts[1])}月${Number(parts[2])}日`;
}

function formatDateTime_(value) {
  if (!value) return '';
  const normalized = value.replace('T', ' ');
  const parts = normalized.split(' ');
  const date = formatDate_(parts[0]);
  if (!parts[1]) return date;
  return `${date} ${parts[1]}`;
}

/** 所有者アカウントで一度だけ追加権限を承認する。 */

function isValidEmail_(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}


// ===== handoff.gs =====
const FORM_MAKER_HANDOFF_MAX_SELECTED = 200;
const FORM_MAKER_HANDOFF_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const FORM_MAKER_HANDOFF_FUTURE_SKEW_MS = 5 * 60 * 1000;
const FORM_MAKER_HANDOFF_FILE_LEDGER_PROPERTY = 'FORM_MAKER_HANDOFF_FILES_V1';
const FORM_MAKER_HANDOFF_FILE_CLEANUP_PROPERTY = 'FORM_MAKER_HANDOFF_FILE_CLEANUP_AT_V1';
const FORM_MAKER_HANDOFF_FILE_TTL_MS = 24 * 60 * 60 * 1000;

function formMakerCreateHandoffToken_() {
  return 'h_' + Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
}

function formMakerHandoffTokenHash_(token) {
  const normalized = String(token || '');
  if (!/^h_[A-Za-z0-9_-]{48,160}$/.test(normalized)) throw new Error('Invalid handoff capability.');
  const digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, normalized, Utilities.Charset.UTF_8);
  return digest.map(function (byte) { return ('0' + ((byte + 256) % 256).toString(16)).slice(-2); }).join('');
}

function formMakerVerifyHandoffToken_(token, expectedHash) {
  const expected = String(expectedHash || '');
  if (!/^[a-f0-9]{64}$/.test(expected)) return false;
  let actual;
  try { actual = formMakerHandoffTokenHash_(token); } catch (_) { return false; }
  let difference = 0;
  for (let index = 0; index < expected.length; index += 1) difference |= expected.charCodeAt(index) ^ actual.charCodeAt(index);
  return difference === 0;
}

function formMakerParseHandoffResponseKeys_(value) {
  const source = String(value || '');
  if (!source || source.length > 8599) throw new Error('Invalid handoff selection.');
  const keys = source.split(',');
  if (!keys.length || keys.length > FORM_MAKER_HANDOFF_MAX_SELECTED) throw new Error('Invalid handoff selection.');
  const seen = Object.create(null);
  keys.forEach(function (key) {
    if (!/^r_[A-Za-z0-9_-]{12,40}$/.test(key) || seen[key]) throw new Error('Invalid handoff selection.');
    seen[key] = true;
  });
  return keys;
}

function formMakerValidateHandoffJob_(uid, jobId, job, now) {
  const current = Number(now || Date.now());
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(String(uid || '')) || !/^[A-Za-z0-9_-]{16,80}$/.test(String(jobId || ''))) return 'invalid_request';
  if (!job || typeof job !== 'object' || Array.isArray(job) || job.jobId !== jobId || job.protocolVersion !== 1 || job.state !== 'queued') return 'invalid_request';
  if (Object.keys(job).some(function (key) { return ['jobId', 'protocolVersion', 'admissionSlotId', 'input', 'requestedAt', 'state'].indexOf(key) < 0; })) return 'invalid_request';
  if (!/^(0[1-9]|[1-3][0-9]|40)$/.test(String(job.admissionSlotId || ''))) return 'invalid_request';
  const input = job.input;
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(function (key) { return ['projectId', 'tokenHash', 'responseKeys', 'manualParticipantHashes'].indexOf(key) < 0; }) || !Object.prototype.hasOwnProperty.call(input, 'manualParticipantHashes')) return 'invalid_request';
  if (!/^[A-Za-z0-9_-]{6,80}$/.test(String(input.projectId || '')) || !/^[a-f0-9]{64}$/.test(String(input.tokenHash || ''))) return 'invalid_request';
  try {
    const responseKeys = input.responseKeys ? formMakerParseHandoffResponseKeys_(input.responseKeys) : [];
    const manualHashes = formMakerParseHandoffParticipantHashes_(input.manualParticipantHashes);
    if (!responseKeys.length && !manualHashes.length || responseKeys.length + manualHashes.length > FORM_MAKER_HANDOFF_MAX_SELECTED) return 'invalid_request';
  } catch (_) { return 'invalid_request'; }
  const requestedAt = Number(job.requestedAt);
  if (!Number.isSafeInteger(requestedAt) || requestedAt < current - FORM_MAKER_HANDOFF_MAX_AGE_MS || requestedAt > current + FORM_MAKER_HANDOFF_FUTURE_SKEW_MS) return 'request_expired';
  return '';
}

function formMakerParseHandoffParticipantHashes_(value) {
  const source = String(value || '');
  if (!source) return [];
  if (source.length > 12999) throw new Error('Invalid handoff selection.');
  const hashes = source.split(',');
  if (hashes.length > FORM_MAKER_HANDOFF_MAX_SELECTED || hashes.some(function (hash) { return !/^[a-f0-9]{64}$/.test(hash); }) || new Set(hashes).size !== hashes.length) throw new Error('Invalid handoff selection.');
  return hashes;
}

function formMakerSelectHandoffResponses_(formResponses, responseKeyCsv) {
  const wanted = responseKeyCsv ? formMakerParseHandoffResponseKeys_(responseKeyCsv) : [];
  const selected = Object.create(null);
  wanted.forEach(function (key) { selected[key] = null; });
  (formResponses || []).forEach(function (response) {
    const responseId = String(response && response.getId && response.getId() || '');
    if (!responseId) return;
    const key = responseParticipantKey_(responseId);
    if (!Object.prototype.hasOwnProperty.call(selected, key)) return;
    const answers = Object.create(null);
    response.getItemResponses().forEach(function (itemResponse) {
      const item = itemResponse.getItem && itemResponse.getItem();
      const title = String(item && item.getTitle && item.getTitle() || '').trim();
      if (!title) return;
      const value = itemResponse.getResponse();
      answers[title] = Array.isArray(value) ? value.join(', ') : String(value == null ? '' : value).trim();
    });
    const name = String(answers['氏名'] || answers['名前'] || '').trim().slice(0, 120);
    const studentIdTitle = Object.keys(answers).find(function (title) { return /^(学籍番号|学生番号|学籍ID|student\s*id)$/i.test(title); });
    selected[key] = { studentId: String(studentIdTitle ? answers[studentIdTitle] : '').trim().slice(0, 80), name: name };
  });
  const missing = wanted.some(function (key) { return !selected[key] || !selected[key].name; });
  if (missing) throw new Error('Selected responses are no longer available.');
  return wanted.map(function (key) { return selected[key]; });
}

function formMakerSelectManualParticipants_(roomParticipants, manualHashCsv, salt) {
  const wanted = formMakerParseHandoffParticipantHashes_(manualHashCsv);
  const participants = roomParticipants && typeof roomParticipants === 'object' ? roomParticipants : {};
  const selected = wanted.map(function (expectedHash) {
    const matches = Object.keys(participants).filter(function (participantId) {
      const digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(salt) + ':' + participantId, Utilities.Charset.UTF_8);
      const actualHash = digest.map(function (byte) { return ('0' + ((byte + 256) % 256).toString(16)).slice(-2); }).join('');
      let difference = 0;
      for (let index = 0; index < expectedHash.length; index += 1) difference |= expectedHash.charCodeAt(index) ^ actualHash.charCodeAt(index);
      return difference === 0;
    });
    if (matches.length !== 1) throw new Error('Selected participant is no longer available.');
    const name = String(participants[matches[0]] && participants[matches[0]].name || '').trim().slice(0, 120);
    if (!name) throw new Error('Selected participant is no longer available.');
    return { studentId: '', name: name };
  });
  return selected;
}

function formMakerHandoffCsv_(participants) {
  function cell(value) {
    let text = String(value == null ? '' : value).replace(/[\r\n\u0000-\u001f]/g, ' ').trim();
    if (/^[=+@-]/.test(text)) text = "'" + text;
    return /[",\r\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
  }
  return [['学籍番号', '氏名']].concat((participants || []).map(function (person) {
    return [String(person && person.studentId || ''), String(person && person.name || '')];
  })).map(function (row) { return row.map(cell).join(','); }).join('\r\n') + '\r\n';
}

function formMakerFindHandoffMetadata_(metadataList, projectId, tokenHash) {
  const expected = String(tokenHash || '');
  if (!/^[a-f0-9]{64}$/.test(expected)) return null;
  const matches = (metadataList || []).filter(function (metadata) {
    if (!metadata || metadata.projectId !== projectId || metadata.syncOwner !== 'worker-v1' ||
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(metadata.editorEmail || '')) || !/^[a-f0-9]{64}$/.test(String(metadata.handoffTokenHash || ''))) return false;
    let difference = 0;
    for (let index = 0; index < expected.length; index += 1) difference |= expected.charCodeAt(index) ^ metadata.handoffTokenHash.charCodeAt(index);
    return difference === 0;
  });
  return matches.length === 1 ? matches[0] : null;
}

function formMakerClaimHandoffForOwner_(uid, idToken) {
  const path = 'formMakerV1/users/' + uid + '/handoffs';
  const queued = formMakerWorkerRequest_('get', path, { idToken: idToken, query: 'orderBy=%22state%22&equalTo=%22queued%22&limitToFirst=1' }).value || {};
  const jobIds = Object.keys(queued);
  if (!jobIds.length) return null;
  const jobId = jobIds[0];
  const jobPath = path + '/' + jobId;
  const current = formMakerWorkerRequest_('get', jobPath, { idToken: idToken });
  if (!current.value || current.value.state !== 'queued') return null;
  const errorCode = formMakerValidateHandoffJob_(uid, jobId, current.value, Date.now()) ||
    (formMakerValidateAdmissionReservation_(uid, jobId, current.value.admissionSlotId, 'handoff', current.value.input && current.value.input.tokenHash, current.value.requestedAt, idToken) ? '' : 'invalid_request');
  const state = formMakerWorkerRequest_('get', jobPath + '/state', { idToken: idToken, headers: { 'X-Firebase-ETag': 'true' } });
  if (state.value !== 'queued' || !state.etag) return null;
  const now = Date.now();
  formMakerWorkerRequest_('patch', jobPath, { idToken: idToken, body: { updatedAt: now, startedAt: now } });
  const transitioned = formMakerWorkerRequest_('put', jobPath + '/state', { idToken: idToken, headers: { 'if-match': state.etag }, acceptedCodes: [412], body: 'running' });
  if (transitioned.code === 412) return null;
  if (errorCode) {
    const invalid = { uid: uid, jobId: jobId, admissionSlotId: current.value.admissionSlotId, input: current.value.input, requestedAt: current.value.requestedAt, workerIdToken: idToken };
    formMakerFinishHandoffJob_(invalid, 'failed', errorCode);
    return null;
  }
  return { kind: 'handoff', uid: uid, jobId: jobId, admissionSlotId: current.value.admissionSlotId, input: current.value.input, requestedAt: current.value.requestedAt, startedAt: now, workerIdToken: idToken };
}

function formMakerProcessHandoffJob_(job) {
  const properties = PropertiesService.getScriptProperties();
  const index = readJsonArrayProperty_(FORM_IMPORT_INDEX_KEY);
  const metadataList = index.map(function (formId) { return readManagedFormImport_(formId); }).filter(Boolean);
  const metadata = formMakerFindHandoffMetadata_(metadataList, job.input.projectId, job.input.tokenHash);
  if (!metadata) return { state: 'failed', errorCode: 'handoff_not_authorized' };

  const requestedKeys = job.input.responseKeys ? formMakerParseHandoffResponseKeys_(job.input.responseKeys) : [];
  const manualHashes = formMakerParseHandoffParticipantHashes_(job.input.manualParticipantHashes);
  if (requestedKeys.length + manualHashes.length > FORM_MAKER_HANDOFF_MAX_SELECTED) return { state: 'failed', errorCode: 'handoff_limit' };
  let participants = [];
  if (requestedKeys.length) {
    const form = FormApp.openById(metadata.formId);
    participants = formMakerSelectHandoffResponses_(form.getResponses(), job.input.responseKeys);
  }
  if (manualHashes.length) {
    const room = formMakerWorkerRequest_('get', 'rooms/' + job.input.projectId + '/participants', { idToken: job.workerIdToken }).value || {};
    participants = participants.concat(formMakerSelectManualParticipants_(room, job.input.manualParticipantHashes, job.jobId));
  }
  const safeName = String(metadata.planName || '企画').replace(/[\\/:*?"<>|\r\n]/g, '_').slice(0, 80) || '企画';
  const filename = safeName + '_参加者.csv';
  const expiresAt = Date.now() + FORM_MAKER_HANDOFF_FILE_TTL_MS;
  const file = DriveApp.createFile(filename, '\uFEFF' + formMakerHandoffCsv_(participants), MimeType.CSV);
  try {
    formMakerTrackHandoffFile_(file.getId(), expiresAt);
    file.addEditor(metadata.editorEmail);
  } catch (_) {
    file.setTrashed(true);
    throw new Error('handoff_share_or_tracking_failed');
  }
  const result = {
    fileId: String(file.getId()),
    downloadUrl: 'https://drive.google.com/uc?export=download&id=' + encodeURIComponent(file.getId()),
    expiresAt: expiresAt,
    count: participants.length,
  };
  return { state: 'completed', result: result };
}

function formMakerFinishHandoffJob_(job, stateName, errorCode, result) {
  const jobPath = 'formMakerV1/users/' + job.uid + '/handoffs/' + job.jobId;
  const current = formMakerWorkerRequest_('get', jobPath + '/state', { idToken: job.workerIdToken, headers: { 'X-Firebase-ETag': 'true' } });
  if (current.value !== 'running' || !current.etag) return false;
  const now = Date.now();
  const patch = { updatedAt: now, finishedAt: now };
  if (result) patch.result = result;
  if (errorCode) patch.errorCode = String(errorCode).slice(0, 80);
  formMakerWorkerRequest_('patch', jobPath, { idToken: job.workerIdToken, body: patch });
  const saved = formMakerWorkerRequest_('put', jobPath + '/state', { idToken: job.workerIdToken, headers: { 'if-match': current.etag }, acceptedCodes: [412], body: stateName });
  if (saved.code === 412) return false;
  if (typeof formMakerReleaseAdmissionSlot_ === 'function') {
    formMakerReleaseAdmissionSlot_(job.uid, job.jobId, job.admissionSlotId, 'handoff', job.workerIdToken,
      job.input && job.input.tokenHash, job.requestedAt);
  }
  return true;
}

function formMakerTrackHandoffFile_(fileId, expiresAt) {
  const properties = PropertiesService.getScriptProperties();
  let files = [];
  try { files = JSON.parse(properties.getProperty(FORM_MAKER_HANDOFF_FILE_LEDGER_PROPERTY) || '[]'); } catch (_) {}
  if (!Array.isArray(files)) files = [];
  files = files.filter(function (item) { return item && item.fileId !== fileId; });
  if (files.length >= 200) throw new Error('handoff_file_capacity');
  files.push({ fileId: String(fileId), expiresAt: Number(expiresAt) });
  properties.setProperty(FORM_MAKER_HANDOFF_FILE_LEDGER_PROPERTY, JSON.stringify(files));
}

function formMakerCleanupExpiredHandoffFiles_() {
  const properties = PropertiesService.getScriptProperties();
  const now = Date.now();
  if (now - Number(properties.getProperty(FORM_MAKER_HANDOFF_FILE_CLEANUP_PROPERTY) || 0) < 60 * 60 * 1000) return 0;
  let files = [];
  try { files = JSON.parse(properties.getProperty(FORM_MAKER_HANDOFF_FILE_LEDGER_PROPERTY) || '[]'); } catch (_) {}
  if (!Array.isArray(files)) files = [];
  let removed = 0;
  const active = [];
  files.forEach(function (item) {
    if (!item || !/^[A-Za-z0-9_-]{10,200}$/.test(String(item.fileId || ''))) return;
    if (Number(item.expiresAt) > now) { active.push(item); return; }
    try { DriveApp.getFileById(item.fileId).setTrashed(true); removed += 1; }
    catch (_) { active.push(item); }
  });
  properties.setProperty(FORM_MAKER_HANDOFF_FILE_LEDGER_PROPERTY, JSON.stringify(active));
  properties.setProperty(FORM_MAKER_HANDOFF_FILE_CLEANUP_PROPERTY, String(now));
  return removed;
}


// ===== health.gs =====
/** Returns a safe worker health summary without exposing Firebase credentials. */
function formMakerWorkerHealth_() {
  const properties = PropertiesService.getScriptProperties();
  const configured = Boolean(
    properties.getProperty(FORM_MAKER_WORKER_UID_PROPERTY) &&
    properties.getProperty(FORM_MAKER_WORKER_REFRESH_TOKEN_PROPERTY)
  );
  if (!configured) return { ok: false, configured: false, authenticated: false, state: 'not_configured' };

  try {
    const token = formMakerWorkerIdToken_();
    const response = formMakerWorkerRequest_('get', 'formMakerV1/status', { idToken: token });
    const status = response.value;
    if (!status || typeof status !== 'object' || Array.isArray(status)) {
      return { ok: false, configured: true, authenticated: true, state: 'status_unavailable' };
    }
    return {
      ok: true,
      configured: true,
      authenticated: true,
      accepting: status.accepting === true,
      state: String(status.state || 'unknown'),
      dailyCount: Number(status.dailyCount || 0),
      dailyLimit: Number(status.dailyLimit || 0),
      updatedAt: Number(status.updatedAt || 0),
      errorCode: String(status.errorCode || ''),
    };
  } catch (error) {
    return {
      ok: false,
      configured: true,
      authenticated: false,
      state: formMakerClassifyWorkerError_(error),
    };
  }
}

/** Returns a deliberately small release summary; never reads credentials or response data. */
function getFormMakerReleaseDiagnosticsV1() {
  const properties = PropertiesService.getScriptProperties();
  const configuredMode = properties.getProperty(FORM_MAKER_ACCEPTANCE_MODE_PROPERTY);
  const acceptanceMode = configuredMode == null || configuredMode === '' ? 'open' :
    (configuredMode === 'open' || configuredMode === 'test' ? configuredMode : 'invalid');
  const today = Utilities.formatDate(new Date(), Session.getScriptTimeZone() || 'Etc/UTC', 'yyyy-MM-dd');
  const countDate = properties.getProperty(FORM_MAKER_QUEUE_DAILY_DATE_PROPERTY);
  const dailyCount = countDate === today ? Math.max(0, Number(properties.getProperty(FORM_MAKER_QUEUE_DAILY_COUNT_PROPERTY) || 0)) : 0;
  const accepting = properties.getProperty(FORM_MAKER_QUEUE_ENABLED_PROPERTY) === 'true' &&
    (acceptanceMode === 'open' || acceptanceMode === 'test') && dailyCount < FORM_MAKER_QUEUE_DAILY_LIMIT;

  let ledger = [];
  try {
    const rawLedger = properties.getProperty(FORM_MAKER_HANDOFF_FILE_LEDGER_PROPERTY) || '[]';
    if (rawLedger.length <= 200000) {
      const parsed = JSON.parse(rawLedger);
      if (Array.isArray(parsed)) ledger = parsed.slice(0, 200);
    }
  } catch (_) {}
  const now = Date.now();
  const trackedFiles = ledger.filter(function (item) {
    return item && /^[A-Za-z0-9_-]{10,200}$/.test(String(item.fileId || '')) &&
      Number.isSafeInteger(Number(item.expiresAt)) && Number(item.expiresAt) > 0;
  });
  const cleanupAt = Number(properties.getProperty(FORM_MAKER_HANDOFF_FILE_CLEANUP_PROPERTY) || 0);
  return {
    accepting: accepting,
    acceptanceMode: acceptanceMode,
    trackedCsvCount: trackedFiles.length,
    expiredCsvCount: trackedFiles.filter(function (item) { return Number(item.expiresAt) <= now; }).length,
    lastCsvCleanupAt: Number.isSafeInteger(cleanupAt) && cleanupAt > 0 ? cleanupAt : 0,
  };
}

/** Writes a non-accepting status once to verify the dedicated worker identity and RTDB rules. */
function initializeFormMakerWorkerStatus() {
  const token = formMakerWorkerIdToken_();
  const statusWritten = formMakerPersistQueueStatus_('paused', '', false, token);
  const health = formMakerWorkerHealth_();
  return {
    statusWritten: statusWritten === true,
    authenticated: health.authenticated === true,
    ok: health.ok === true,
    accepting: health.accepting === true,
    state: String(health.state || 'unknown'),
  };
}

/** Editor-only operator entrypoint for enabling the managed queue and its recovery triggers. */
function activateFormMakerWorkerV1() {
  const health = formMakerWorkerHealth_();
  if (!health.ok) throw new Error('Worker activation refused: ' + String(health.state || 'health_check_failed'));
  resumeFormMakerQueue_();
  const active = formMakerWorkerHealth_();
  return {
    ok: active.ok === true && active.accepting === true,
    accepting: active.accepting === true,
    state: String(active.state || 'unknown'),
    dailyCount: Number(active.dailyCount || 0),
    dailyLimit: Number(active.dailyLimit || 0),
  };
}

/** Editor-only operator entrypoint that pauses work without deleting queued jobs. */
function pauseFormMakerWorkerV1() {
  pauseFormMakerQueue_();
  const paused = formMakerWorkerHealth_();
  return {
    ok: paused.ok === true && paused.accepting === false,
    accepting: paused.accepting === true,
    state: String(paused.state || 'unknown'),
  };
}

/** Runs one empty-queue poll and always returns the processor to its paused state. */
function smokeFormMakerEmptyQueueOnce() {
  const properties = PropertiesService.getScriptProperties();
  if (properties.getProperty(FORM_MAKER_QUEUE_ENABLED_PROPERTY) === 'true') {
    return { ok: false, state: 'already_enabled', paused: false };
  }

  const token = formMakerWorkerIdToken_();
  const users = formMakerWorkerRequest_('get', 'formMakerV1/users', { idToken: token, query: 'shallow=true' }).value || {};
  if (Object.keys(users).length) return { ok: false, state: 'queue_not_empty', paused: true };

  let pollState = 'unknown';
  let pollDurationMs = 0;
  properties.setProperty(FORM_MAKER_QUEUE_ENABLED_PROPERTY, 'true');
  try {
    const pollStartedAt = Date.now();
    pollState = processFormMakerQueue_().state || 'unknown';
    pollDurationMs = Math.max(0, Date.now() - pollStartedAt);
  } finally {
    properties.setProperty(FORM_MAKER_QUEUE_ENABLED_PROPERTY, 'false');
    formMakerPersistQueueStatus_('paused', '', false, token);
  }
  const health = formMakerWorkerHealth_();
  const summary = {
    ok: pollState === 'idle' && health.ok === true && health.accepting === false && health.state === 'paused',
    state: pollState,
    paused: health.accepting === false && health.state === 'paused',
    authenticated: health.authenticated === true,
    pollDurationMs: pollDurationMs,
  };
  console.log(JSON.stringify(summary));
  return summary;
}


// ===== journal.gs =====
const FORM_MAKER_CREATION_JOURNAL_PREFIX = 'FORM_MAKER_CREATION_JOURNAL_V1_';
const FORM_MAKER_CREATION_JOURNAL_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function formMakerCreationJournalKey_(uid, jobId) {
  return FORM_MAKER_CREATION_JOURNAL_PREFIX + String(uid || '') + '_' + String(jobId || '');
}

function formMakerReadCreationJournal_(uid, jobId) {
  const raw = PropertiesService.getScriptProperties().getProperty(formMakerCreationJournalKey_(uid, jobId));
  if (!raw) return null;
  try {
    const journal = JSON.parse(raw);
    return journal && journal.protocolVersion === 1 ? journal : null;
  } catch (_) {
    return null;
  }
}

function formMakerWriteCreationJournal_(uid, jobId, updates) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) throw new Error('creation_journal_busy');
  try {
    const properties = PropertiesService.getScriptProperties();
    const key = formMakerCreationJournalKey_(uid, jobId);
    let journal = formMakerReadCreationJournal_(uid, jobId) || {
      protocolVersion: 1,
      uid: String(uid),
      jobId: String(jobId),
      stage: 'queued',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    Object.keys(updates || {}).forEach(function (name) { journal[name] = updates[name]; });
    journal.updatedAt = Date.now();
    properties.setProperty(key, JSON.stringify(journal));
    return journal;
  } finally {
    lock.releaseLock();
  }
}

function formMakerDeleteCreationJournal_(uid, jobId) {
  const journal = formMakerReadCreationJournal_(uid, jobId);
  if (!journal || ['completed', 'partial'].indexOf(journal.stage) < 0) return false;
  if (Date.now() - Number(journal.updatedAt || 0) < FORM_MAKER_CREATION_JOURNAL_TTL_MS) return false;
  PropertiesService.getScriptProperties().deleteProperty(formMakerCreationJournalKey_(uid, jobId));
  return true;
}

function formMakerFinishJob_(job, state, errorCode, result) {
  if (!job || ['completed', 'partial', 'failed', 'unknown'].indexOf(state) < 0) return false;
  const fields = { finishedAt: Date.now(), errorCode: String(errorCode || '') };
  if (result) fields.result = result;
    const saved = formMakerTransitionJobState_(job.uid, job.jobId, 'running', state, fields, job.workerIdToken);
    if (saved && typeof formMakerReleaseAdmissionSlot_ === 'function') formMakerReleaseAdmissionSlot_(job.uid, job.jobId, job.admissionSlotId, 'create', job.workerIdToken, job.inputHash, job.requestedAt);
    return saved;
}


// ===== managed-sync.gs =====
// Curated worker-only application setup/sync. Helpers mirror auto-sync.js, use worker auth, and install bounded per-form submit triggers.
const FORM_IMPORT_INDEX_KEY = 'FORM_IMPORT_INDEX_V2';
const FORM_IMPORT_PREFIX = 'FORM_IMPORT_V2_';
const FORM_IMPORT_CURSOR_KEY = 'FORM_IMPORT_CURSOR_V2';
const FORM_IMPORT_HISTORY_LIMIT = 100;
const FORM_IMPORT_BATCH_LIMIT = 20;
const FORM_IMPORT_PRIORITY_LIMIT = 5;
const FORM_IMPORT_FULL_REFRESH_MS = 60 * 60 * 1000;
const FORM_IMPORT_INCREMENTAL_OVERLAP_MS = 2 * 60 * 1000;
const FORM_IMPORT_METADATA_LOCK_MS = 1000;
const FORM_IMPORT_SYNC_LEASE_KEY = 'FORM_IMPORT_SYNC_LEASE_V1';
const FORM_IMPORT_GLOBAL_STATUS_KEY = 'FORM_IMPORT_GLOBAL_STATUS_V1';
const FORM_IMPORT_SYNC_LEASE_MS = 180 * 1000;
const FORM_IMPORT_MAX_FAILURES = 3;
const FORM_IMPORT_MAX_BACKOFF_MS = 60 * 60 * 1000;
const FORM_MAKER_WORKER_SYNC_STATUS_KEY = 'FORM_MAKER_WORKER_SYNC_STATUS_V1';
const FORM_IMPORT_LEGACY_SCRIPT_ID = '1m39W74vR_dyz05yuL24tjym8hdjUxS9NoLev5qWnPsDcYqCh41LG7Sjl';
const FORM_MAKER_LEGACY_MIGRATION_PAYLOAD_KEY = 'FORM_MAKER_LEGACY_MIGRATION_PAYLOAD_V1';
const FORM_MAKER_DEDICATED_SCRIPT_ID = '1Z_fpG_nd4UazqRZKbZHhzlcTsD0jBEaUXIqCXmqNTmgg5edgLNljgx50';
const FORM_APPLICATION_KIND = 'formApplicationSync';
const FORM_APPLICATION_VERSION = 2;
const CIRCLE_TOOL_BASE_URL = 'https://mutoshiki.github.io/circle-kikaku-tools/';

function setupManagedFormResponseSync_(form, data, jobContext) {
  if (!jobContext || !jobContext.workerIdToken) throw new Error('Dedicated worker token is required.');
  const responseSpreadsheet = jobContext && jobContext.spreadsheetId
    ? SpreadsheetApp.openById(jobContext.spreadsheetId)
    : SpreadsheetApp.create(`${data.planName} 応募フォーム回答`);
  if (jobContext && !jobContext.spreadsheetId) {
    const checkpoint = { stage: 'spreadsheet-created', spreadsheetId: responseSpreadsheet.getId() };
    if (typeof jobContext.checkpoint === 'function') jobContext.checkpoint(checkpoint);
    else if (jobContext.requestId && jobContext.tokenHash) updateCreationJob_(jobContext.requestId, jobContext.tokenHash, checkpoint);
  }
  form.setDestination(FormApp.DestinationType.SPREADSHEET, responseSpreadsheet.getId());

  let spreadsheetEditorResult = { granted: true, method: '', warning: '' };
  try {
    DriveApp.getFileById(responseSpreadsheet.getId()).addEditor(data.editorEmail);
    spreadsheetEditorResult = { granted: true, method: 'drive', warning: '' };
  } catch (error) {
    console.error('Response spreadsheet editor sharing failed.');
    spreadsheetEditorResult = {
      granted: false,
      method: '',
      warning: '回答スプレッドシートの編集権限を追加できませんでした。原因: ' + getErrorMessage_(error)
    };
  }

  const projectId = jobContext && jobContext.projectId || generateManagedProjectId_();
  const projectUrl = buildManagedProjectUrl_(projectId);
  const registration = registerManagedFormImport_({
    formId: form.getId(),
    spreadsheetId: responseSpreadsheet.getId(),
    projectId,
    planName: data.planName,
    eventDate: data.eventDate,
    deadline: data.deadline,
    editorEmail: data.editorEmail,
    handoffTokenHash: jobContext && jobContext.handoffTokenHash || '',
    syncOwner: jobContext && jobContext.workerIdToken ? 'worker-v1' : 'legacy-v2'
  });
  if (!registration) throw new Error('同期設定が混み合っています。作成済みフォームは残っています。');

  let responseSubmitTrigger = { enabled: false, status: 'unavailable' };
  try { responseSubmitTrigger = ensureManagedFormSubmitTrigger_(form); }
  catch (_) { console.error('Form submit trigger setup failed; hourly reconciliation remains available.'); }

  if (!registration.registered) {
    return {
      status: 'capacity',
      registered: false,
      projectId,
      projectUrl,
      spreadsheetId: responseSpreadsheet.getId(),
      spreadsheetUrl: responseSpreadsheet.getUrl(),
      spreadsheetEditorResult,
      syncEnabled: false,
      syncState: 'capacity',
      syncWarning: '自動応募者同期の上限に達しました。作成済みフォームは利用できます。管理者の確認が必要です。',
    };
  }

  let syncEnabled = false;
  let syncState = 'pending';
  let syncWarning = '';
  try {
    const token = jobContext.workerIdToken;
    const room = ensureManagedProjectRoom_({ projectId, planName: data.planName, eventDate: data.eventDate, formId: form.getId() }, token);
    if (room.state === 'ready') {
      syncManagedFormImportById_(form.getId(), token, true, true);
      syncEnabled = true;
      syncState = 'ready';
    } else {
      syncState = 'blocked';
      syncWarning = '企画ルームは既に存在しますが、必要な構造を確認できません。管理者の修復が必要です。';
    }
  } catch (error) {
    console.error('Automatic applicant sync setup failed (' + classifySyncError_(error) + ').');
    syncState = 'pending';
    syncWarning =
      'フォームと回答スプレッドシートは作成されましたが、企画への応募者同期は保留中です。' +
      ' 管理者側の同期設定を確認してください。';
  }

  if (!responseSubmitTrigger.enabled) {
    syncWarning = [syncWarning, '回答送信後の即時同期は使えません。定期照合で反映します。'].filter(Boolean).join(' ');
  }

  return {
    projectId,
    projectUrl,
    spreadsheetId: responseSpreadsheet.getId(),
    spreadsheetUrl: responseSpreadsheet.getUrl(),
    spreadsheetEditorResult,
    syncEnabled,
    syncState,
    status: 'active',
    registered: true,
    responseSubmitTrigger: responseSubmitTrigger.status,
    syncWarning
  };
}

function generateManagedProjectId_() {
  const compact = Utilities.getUuid().replace(/-/g, '').toUpperCase();
  return 'P' + compact.slice(0, 19);
}

function buildManagedProjectUrl_(projectId) {
  return CIRCLE_TOOL_BASE_URL + '?room=' + encodeURIComponent(projectId);
}

function registerManagedFormImport_(metadata) {
  return withMetadataLock_(function () {
  const properties = PropertiesService.getScriptProperties();
  const formId = cleanText_(metadata.formId, 200);
  const spreadsheetId = cleanText_(metadata.spreadsheetId, 200);
  const projectId = cleanText_(metadata.projectId, 80);
  if (!formId || !spreadsheetId || !projectId) {
    throw new Error('フォームと企画の自動連携IDを取得できませんでした。');
  }

  const entry = {
    formId,
    spreadsheetId,
    projectId,
    planName: cleanText_(metadata.planName, 100),
    editorEmail: cleanText_(metadata.editorEmail, 254),
    handoffTokenHash: /^[a-f0-9]{64}$/.test(String(metadata.handoffTokenHash || '')) ? String(metadata.handoffTokenHash) : '',
    handoffVersion: /^[a-f0-9]{64}$/.test(String(metadata.handoffTokenHash || '')) ? 1 : 0,
    eventDate: cleanText_(metadata.eventDate, 30),
    deadline: cleanText_(metadata.deadline, 30),
    syncOwner: metadata.syncOwner === 'worker-v1' ? 'worker-v1' : 'legacy-v2',
    createdAtMs: Date.now(),
    lastSyncedAtMs: 0,
    lastResponseCount: -1,
    lastError: '',
    status: 'active',
    failureCount: 0,
    lastErrorCode: '',
    lastErrorAtMs: 0,
    nextAttemptAtMs: 0
  };
  let index = readJsonArrayProperty_(FORM_IMPORT_INDEX_KEY);
  if (index.indexOf(formId) === -1 && index.length >= FORM_IMPORT_HISTORY_LIMIT) {
    entry.status = 'capacity';
    entry.lastErrorCode = 'managed_form_capacity';
    entry.lastErrorAtMs = Date.now();
    properties.setProperty(FORM_IMPORT_PREFIX + formId, JSON.stringify(entry));
    return { status: 'capacity', registered: false };
  }
  properties.setProperty(FORM_IMPORT_PREFIX + formId, JSON.stringify(entry));
  index = [formId].concat(index.filter(function (id) { return id !== formId; }));
  properties.setProperty(FORM_IMPORT_INDEX_KEY, JSON.stringify(index));
  return { status: 'active', registered: true };
  });
}

/** Register one legacy form in the dedicated worker after the old writer is paused. */

function readJsonArrayProperty_(key) {
  const raw = PropertiesService.getScriptProperties().getProperty(key) || '[]';
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    return [];
  }
}

function readManagedFormImport_(formId) {
  const raw = PropertiesService.getScriptProperties().getProperty(FORM_IMPORT_PREFIX + formId);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (error) {
    return null;
  }
}

function writeManagedFormImport_(metadata) {
  if (!metadata || !metadata.formId) return;
  return withMetadataLock_(function () {
    PropertiesService.getScriptProperties().setProperty(
      FORM_IMPORT_PREFIX + metadata.formId,
      JSON.stringify(metadata)
    );
    return true;
  });
}

/** Run only small Script Properties changes while holding the global lock. */

function withMetadataLock_(callback, timeoutMs) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(Number(timeoutMs) || FORM_IMPORT_METADATA_LOCK_MS)) return null;
  try {
    return callback();
  } finally {
    lock.releaseLock();
  }
}

function claimSyncBatch_(now, syncOwner, batchLimit, statusKey) {
  const currentTime = Number(now) || Date.now();
  return withMetadataLock_(function () {
    const properties = PropertiesService.getScriptProperties();
    let globalStatus = {};
    const globalStatusProperty = statusKey || FORM_IMPORT_GLOBAL_STATUS_KEY;
    try { globalStatus = JSON.parse(properties.getProperty(globalStatusProperty) || '{}') || {}; } catch (error) {}
    if (globalStatus.state === 'error' && Number(globalStatus.nextAttemptAtMs || 0) > currentTime) {
      return { leaseId: '', formIds: [], globalBackoff: true, expiresAtMs: Number(globalStatus.nextAttemptAtMs) };
    }
    let lease = null;
    try { lease = JSON.parse(properties.getProperty(FORM_IMPORT_SYNC_LEASE_KEY) || 'null'); } catch (error) {}
    if (lease && Number(lease.expiresAtMs) > currentTime) return null;

    const index = readJsonArrayProperty_(FORM_IMPORT_INDEX_KEY);
    if (!index.length) return null;
    let cursor = Number(properties.getProperty(FORM_IMPORT_CURSOR_KEY) || 0);
    if (!isFinite(cursor) || cursor < 0) cursor = 0;
    cursor %= index.length;
    const eligible = [];
    const newest = index.slice(0, FORM_IMPORT_PRIORITY_LIMIT);
    const order = newest.concat(index.slice(FORM_IMPORT_PRIORITY_LIMIT).slice(cursor), index.slice(FORM_IMPORT_PRIORITY_LIMIT, cursor));
    const seen = new Set();
    let scannedAfterPriority = 0;
    order.forEach(function (formId, orderIndex) {
      if (eligible.length >= Math.min(FORM_IMPORT_BATCH_LIMIT, Number(batchLimit) || FORM_IMPORT_BATCH_LIMIT) || seen.has(formId)) return;
      if (orderIndex >= newest.length) scannedAfterPriority += 1;
      seen.add(formId);
      const metadata = readManagedFormImport_(formId);
      if (!metadata) return;
      if ((metadata.syncOwner || 'legacy-v2') !== (syncOwner || 'legacy-v2')) return;
      const status = metadata.status || 'active';
      if (status === 'paused' || status === 'backoff' && Number(metadata.nextAttemptAtMs || 0) > currentTime) return;
      eligible.push(formId);
    });
    const tailLength = Math.max(index.length - newest.length, 0);
    if (tailLength) properties.setProperty(FORM_IMPORT_CURSOR_KEY, String((cursor + Math.max(scannedAfterPriority, 1)) % tailLength));
    if (!eligible.length) return { leaseId: Utilities.getUuid(), formIds: [], expiresAtMs: currentTime + FORM_IMPORT_SYNC_LEASE_MS };
    const leaseId = Utilities.getUuid();
    properties.setProperty(FORM_IMPORT_SYNC_LEASE_KEY, JSON.stringify({ leaseId, expiresAtMs: currentTime + FORM_IMPORT_SYNC_LEASE_MS }));
    return { leaseId, formIds: eligible, expiresAtMs: currentTime + FORM_IMPORT_SYNC_LEASE_MS };
  });
}

function releaseSyncLease_(leaseId) {
  return withMetadataLock_(function () {
    const properties = PropertiesService.getScriptProperties();
    let lease = null;
    try { lease = JSON.parse(properties.getProperty(FORM_IMPORT_SYNC_LEASE_KEY) || 'null'); } catch (error) {}
    if (!lease || lease.leaseId !== leaseId) return false;
    properties.deleteProperty(FORM_IMPORT_SYNC_LEASE_KEY);
    return true;
  });
}

function writeGlobalSyncStatus_(status, statusKey) {
  return withMetadataLock_(function () {
    PropertiesService.getScriptProperties().setProperty(statusKey || FORM_IMPORT_GLOBAL_STATUS_KEY, JSON.stringify(status || {}));
    return true;
  });
}

function classifySyncError_(error) {
  const message = getErrorMessage_(error);
  if (/No item with the given ID|does not exist|do not have permission to access this item/i.test(message)) return 'form_unavailable';
  const http = message.match(/HTTP\s+(401|403|404|409|412|429|5\d\d)/i);
  if (http) return 'http_' + http[1];
  if (/timed out|timeout|temporar|network|service invoked too many times/i.test(message)) return 'transient';
  if (/Firebase匿名認証/i.test(message)) return 'firebase_auth';
  return 'sync_error';
}

function nextBackoffMs_(failureCount) {
  return Math.min(FORM_IMPORT_MAX_BACKOFF_MS, 60 * 1000 * Math.pow(2, Math.max(0, Number(failureCount || 1) - 1)));
}

function recordSyncFailure_(metadata, error, errorCode) {
  const formId = metadata && metadata.formId;
  if (!formId) return;
  return withMetadataLock_(function () {
    const current = readManagedFormImport_(formId);
    if (!current) return false;
    const now = Date.now();
    current.failureCount = Number(current.failureCount || 0) + 1;
    current.lastErrorCode = errorCode || classifySyncError_(error);
    current.lastErrorAtMs = now;
    current.lastError = sanitizeSyncError_(error);
    const ownerReviewRequired = current.lastErrorCode === 'form_unavailable' || current.lastErrorCode === 'http_401' || current.lastErrorCode === 'http_403';
    if (ownerReviewRequired && current.failureCount >= FORM_IMPORT_MAX_FAILURES) {
      current.status = 'paused';
      current.nextAttemptAtMs = 0;
    } else {
      current.status = 'backoff';
      current.nextAttemptAtMs = now + nextBackoffMs_(current.failureCount);
    }
    PropertiesService.getScriptProperties().setProperty(FORM_IMPORT_PREFIX + formId, JSON.stringify(current));
    return true;
  });
}

function sanitizeSyncError_(error) {
  return getErrorMessage_(error).replace(/(key|auth|token)=([^&\s]+)/ig, '$1=[redacted]').slice(0, 300);
}

function recordSyncSuccess_(formId) {
  return withMetadataLock_(function () {
    const metadata = readManagedFormImport_(formId);
    if (!metadata) return false;
    metadata.status = 'active';
    metadata.failureCount = 0;
    metadata.lastErrorCode = '';
    metadata.lastErrorAtMs = 0;
    metadata.nextAttemptAtMs = 0;
    metadata.lastError = '';
    PropertiesService.getScriptProperties().setProperty(FORM_IMPORT_PREFIX + formId, JSON.stringify(metadata));
    return true;
  });
}

function syncManagedFormImportById_(formId, token, force, roomReady) {
  const metadata = readManagedFormImport_(formId);
  if (!metadata || !metadata.projectId) return false;

  const form = FormApp.openById(metadata.formId);
  const publishedFormUrl = formMakerPublicFormUrl_(form.getPublishedUrl());
  if (typeof form.isAcceptingResponses === 'function' && !form.isAcceptingResponses() && typeof cleanupClosedManagedFormSubmitTrigger_ === 'function') {
    cleanupClosedManagedFormSubmitTrigger_(metadata.formId, form);
  }
  const now = Date.now();
  let fullRefresh = force || !Number(metadata.lastFullRefreshAtMs) || now - Number(metadata.lastFullRefreshAtMs) >= FORM_IMPORT_FULL_REFRESH_MS;
  const previousCursorMs = Number(metadata.responseCursorMs || 0);
  if (!previousCursorMs) fullRefresh = true;
  let responses = fullRefresh
    ? form.getResponses()
    : form.getResponses(new Date(Math.max(0, previousCursorMs - FORM_IMPORT_INCREMENTAL_OVERLAP_MS)));
  let applicants = {};
  let existingSync = null;
  if (!fullRefresh) {
    existingSync = firebaseGetJson_(
      'rooms/' + validateManagedProjectId_(metadata.projectId) + '/meta/applicationSync',
      token
    ).value;
    if (!existingSync || existingSync.kind !== FORM_APPLICATION_KIND || !existingSync.applicants || typeof existingSync.applicants !== 'object' || Array.isArray(existingSync.applicants)) {
      fullRefresh = true;
      responses = form.getResponses();
    } else {
      Object.keys(existingSync.applicants).forEach(function (key) {
        const item = existingSync.applicants[key];
        if (!item || typeof item !== 'object') return;
        applicants[key] = {
          id: String(item.id || key),
          name: cleanText_(item.name, 120),
          grade: Number(item.grade || 0),
          canDrive: item.canDrive === true,
          capacity: Math.max(0, Math.min(20, Number(item.capacity || 0))),
          updatedAt: Number(item.updatedAt || 0)
        };
      });
    }
  }
  if (fullRefresh) applicants = {};
  responses.forEach(function (formResponse) {
    const applicant = normalizeManagedFormResponse_(formResponse);
    if (!applicant.name) return;
    applicants[applicant.id] = applicant;
  });
  const applicantsHash = managedApplicationFingerprint_(applicants);
  const latestResponseMs = responses.reduce(function (latest, formResponse) {
    const timestamp = formResponse.getTimestamp ? formResponse.getTimestamp() : null;
    return timestamp ? Math.max(latest, timestamp.getTime()) : latest;
  }, previousCursorMs);
  const nextCursorMs = fullRefresh
    ? Math.max(latestResponseMs, now)
    : Math.max(previousCursorMs, latestResponseMs);
  if (!fullRefresh && metadata.lastApplicantsHash === applicantsHash && existingSync?.formUrl === publishedFormUrl) {
    metadata.responseCursorMs = nextCursorMs;
    metadata.lastSyncedAtMs = now;
    writeManagedFormImport_(metadata);
    return false;
  }

  const applicationSync = {
    kind: FORM_APPLICATION_KIND,
    version: FORM_APPLICATION_VERSION,
    projectId: metadata.projectId,
    title: String(metadata.planName || form.getTitle() || '').slice(0, 200),
    eventDate: cleanText_(metadata.eventDate, 30),
    formUrl: publishedFormUrl,
    responseCount: Object.keys(applicants).length,
    handoffVersion: Number(metadata.handoffVersion || 0),
    syncedAt: now,
    applicants
  };

  if (!roomReady) {
    const room = ensureManagedProjectRoom_(metadata, token);
    if (room.state !== 'ready') throw new Error('Firebase room requires owner repair.');
  }
  firebasePatchJson_(
    'rooms/' + validateManagedProjectId_(metadata.projectId) + '/meta/applicationSync',
    applicationSync,
    token
  );

  metadata.lastSyncedAtMs = now;
  metadata.lastResponseCount = Object.keys(applicants).length;
  metadata.lastApplicantsHash = applicantsHash;
  metadata.responseCursorMs = nextCursorMs;
  if (fullRefresh) metadata.lastFullRefreshAtMs = now;
  metadata.lastError = '';
  writeManagedFormImport_(metadata);
  return true;
}

function managedApplicationFingerprint_(applicants) {
  const canonical = {};
  Object.keys(applicants || {}).sort().forEach(function (key) {
    const item = applicants[key] || {};
    canonical[key] = {
      id: String(item.id || key),
      name: String(item.name || ''),
      grade: Number(item.grade || 0),
      canDrive: item.canDrive === true,
      capacity: Number(item.capacity || 0),
      updatedAt: Number(item.updatedAt || 0),
    };
  });
  const digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, JSON.stringify(canonical), Utilities.Charset.UTF_8);
  return digest.map(function (byte) { return ('0' + ((byte + 256) % 256).toString(16)).slice(-2); }).join('');
}

function initializeManagedProjectRoom_(projectId, planName, eventDate, formId, idToken) {
  const safeProjectId = validateManagedProjectId_(projectId);
  const now = Date.now();
  const room = {
    schemaVersion: 6,
    roomName: String(planName || '').slice(0, 200),
    allocations: {
      car: {
        id: 'plan-car',
        type: 'car',
        name: '車割',
        groups: {},
        placements: {},
        lastAutoAssignLabel: '',
        updatedAt: now
      },
      team: {
        id: 'plan-team',
        type: 'team',
        name: '班割',
        groups: {},
        placements: {},
        lastAutoAssignLabel: '',
        updatedAt: now
      }
    },
    activeAllocationType: 'car',
    resetGeneration: 0,
    lastUpdatedAt: now,
    lastUpdatedBy: 'sanpokai-form-maker',
    revision: 0,
    meta: {
      applicationSync: {
        kind: FORM_APPLICATION_KIND,
        version: FORM_APPLICATION_VERSION,
        projectId: safeProjectId,
        title: String(planName || '').slice(0, 200),
        eventDate: cleanText_(eventDate, 30),
        formUrl: formMakerPublicFormUrl_(FormApp.openById(formId).getPublishedUrl()),
        responseCount: 0,
        handoffVersion: Number(metadata.handoffVersion || 0),
        syncedAt: now,
        applicants: {}
      }
    }
  };
  return ensureManagedProjectRoom_({ projectId: safeProjectId, planName, eventDate, formId }, idToken, room);
}

function ensureManagedProjectRoom_(metadata, idToken, roomToCreate) {
  const safeProjectId = validateManagedProjectId_(metadata && metadata.projectId);
  const path = 'rooms/' + safeProjectId;
  const existing = firebaseGetJson_(path, idToken);
  if (existing.value != null) {
    const state = isManagedProjectRoomValid_(existing.value) ? 'ready' : 'repair-required';
    rememberManagedRoomCheck_(metadata, state);
    return { state };
  }
  const room = roomToCreate || buildManagedProjectRoom_(metadata, Date.now());
  try {
    firebasePutJsonIfAbsent_(path, room, idToken, existing.etag);
    rememberManagedRoomCheck_(metadata, 'ready');
    return { state: 'ready' };
  } catch (error) {
    if (classifySyncError_(error) !== 'http_412') throw error;
    const reread = firebaseGetJson_(path, idToken);
    const state = isManagedProjectRoomValid_(reread.value) ? 'ready' : 'repair-required';
    rememberManagedRoomCheck_(metadata, state);
    return { state };
  }
}

function rememberManagedRoomCheck_(metadata, state) {
  const now = Date.now();
  metadata.roomStatus = state;
  metadata.roomCheckedAtMs = now;
  return withMetadataLock_(function () {
    const current = readManagedFormImport_(metadata.formId);
    if (!current) return false;
    current.roomStatus = state;
    current.roomCheckedAtMs = now;
    PropertiesService.getScriptProperties().setProperty(FORM_IMPORT_PREFIX + metadata.formId, JSON.stringify(current));
    return true;
  });
}

function buildManagedProjectRoom_(metadata, now) {
  const projectId = validateManagedProjectId_(metadata.projectId);
  const planName = metadata.planName || '';
  const eventDate = metadata.eventDate || '';
  return {
    schemaVersion: 6,
    roomName: String(planName).slice(0, 200),
    allocations: {
      car: { id: 'plan-car', type: 'car', name: '車割', groups: {}, placements: {}, lastAutoAssignLabel: '', updatedAt: now },
      team: { id: 'plan-team', type: 'team', name: '班割', groups: {}, placements: {}, lastAutoAssignLabel: '', updatedAt: now }
    },
    activeAllocationType: 'car',
    resetGeneration: 0,
    lastUpdatedAt: now,
    lastUpdatedBy: 'sanpokai-form-maker',
    revision: 0,
    meta: {
      applicationSync: {
        kind: FORM_APPLICATION_KIND,
        version: FORM_APPLICATION_VERSION,
        projectId,
        title: String(planName).slice(0, 200),
        eventDate: cleanText_(eventDate, 30),
        formUrl: formMakerPublicFormUrl_(FormApp.openById(metadata.formId).getPublishedUrl()),
        responseCount: 0,
        syncedAt: now,
        applicants: {}
      }
    }
  };
}

function formMakerPublicFormUrl_(value) {
  const url = String(value || '').trim();
  return /^https:\/\/docs\.google\.com\/forms\/d\/(?:e\/)?[A-Za-z0-9_-]+\/viewform\/?(?:\?[^#]*)?(?:#[^\s]*)?$/.test(url) ? url : '';
}

function isManagedProjectRoomValid_(room) {
  return Boolean(room && Number(room.schemaVersion) === 6 && room.allocations &&
    room.allocations.car && room.allocations.team &&
    (room.meta == null || (typeof room.meta === 'object' && !Array.isArray(room.meta))));
}

function formMakerProjectRoomMeta_(room) {
  if (!room || room.meta == null) return {};
  if (typeof room.meta !== 'object' || Array.isArray(room.meta)) throw new Error('project_room_invalid');
  return room.meta;
}

/**
 * Deliberately whitelist only the fields needed for planning. Student number,
 * department, LINE name, free text and car notes stay only in Google Forms/Sheets.
 */

function normalizeManagedFormResponse_(formResponse) {
  const answers = {};
  formResponse.getItemResponses().forEach(function (itemResponse) {
    const title = String(itemResponse.getItem().getTitle() || '').trim();
    if (!title) return;
    const value = itemResponse.getResponse();
    answers[title] = Array.isArray(value) ? value.join(', ') : String(value == null ? '' : value).trim();
  });

  const sourceResponseId = String(formResponse.getId() || Utilities.getUuid());
  const submittedAt = formResponse.getTimestamp() ? formResponse.getTimestamp().getTime() : Date.now();
  return {
    id: responseParticipantKey_(sourceResponseId),
    name: cleanText_(answers['氏名'], 120),
    grade: parseManagedGrade_(answers['学年']),
    canDrive: normalizeManagedDriver_(answers['車出しはできますか？']),
    capacity: Math.max(0, Math.min(20, parseInt(answers['運転者を除いて何人乗せられますか？'], 10) || 0)),
    updatedAt: submittedAt
  };
}

function parseManagedGrade_(value) {
  const match = String(value || '').match(/([1-4])\s*年/);
  return match ? Number(match[1]) : 0;
}

function normalizeManagedDriver_(value) {
  return /^(?:はい|する|できます|できる|可|可能)$/i.test(String(value || '').trim());
}

function responseParticipantKey_(responseId) {
  const digest = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    String(responseId || ''),
    Utilities.Charset.UTF_8
  );
  return 'r_' + Utilities.base64EncodeWebSafe(digest).replace(/=+$/g, '').slice(0, 24);
}

function validateManagedProjectId_(projectId) {
  const id = String(projectId || '').trim();
  if (!/^[A-Za-z0-9_-]{6,80}$/.test(id)) throw new Error('企画IDが不正です。');
  return id;
}

function registerConfiguredLegacyManagedFormForWorkerMigration_() {
  if (ScriptApp.getScriptId() !== FORM_MAKER_DEDICATED_SCRIPT_ID) throw new Error('Legacy form import was run from the wrong Apps Script project.');
  const properties = PropertiesService.getScriptProperties();
  const raw = properties.getProperty(FORM_MAKER_LEGACY_MIGRATION_PAYLOAD_KEY);
  if (!raw) throw new Error('Migration payload is missing.');
  let payload;
  try { payload = JSON.parse(raw); } catch (_) { throw new Error('Migration payload is invalid.'); }
  const allowed = ['sourceScriptId', 'targetScriptId', 'legacyWriterStatus', 'legacyWriterPausedAtMs', 'formId', 'spreadsheetId', 'projectId', 'editorEmail', 'planName', 'eventDate', 'deadline', 'handoffTokenHash'];
  if (!payload || typeof payload !== 'object' || Array.isArray(payload) || Object.keys(payload).some(function (key) { return allowed.indexOf(key) === -1; })) throw new Error('Migration payload fields are invalid.');
  if (payload.sourceScriptId !== FORM_IMPORT_LEGACY_SCRIPT_ID || payload.targetScriptId !== FORM_MAKER_DEDICATED_SCRIPT_ID ||
      payload.legacyWriterStatus !== 'paused' || !Number.isSafeInteger(Number(payload.legacyWriterPausedAtMs)) || Number(payload.legacyWriterPausedAtMs) <= 0) {
    throw new Error('Legacy writer pause confirmation or project identity is invalid.');
  }
  const formId = cleanText_(payload.formId, 200);
  const spreadsheetId = cleanText_(payload.spreadsheetId, 200);
  const projectId = validateManagedProjectId_(payload.projectId);
  const editorEmail = cleanText_(payload.editorEmail, 254);
  const planName = cleanText_(payload.planName, 100);
  if (!/^[A-Za-z0-9_-]{10,200}$/.test(formId) || !/^[A-Za-z0-9_-]{10,200}$/.test(spreadsheetId) ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(editorEmail) || !planName ||
      (payload.handoffTokenHash && !/^[a-f0-9]{64}$/.test(String(payload.handoffTokenHash)))) {
    throw new Error('Legacy form metadata is invalid.');
  }
  const existing = readManagedFormImport_(formId);
  if (existing) {
    const existingIndex = readJsonArrayProperty_(FORM_IMPORT_INDEX_KEY);
    if (existing.syncOwner === 'worker-v1' && existing.spreadsheetId === spreadsheetId && existing.projectId === projectId &&
        existing.status !== 'capacity' && existingIndex.indexOf(formId) !== -1) {
      properties.deleteProperty(FORM_MAKER_LEGACY_MIGRATION_PAYLOAD_KEY);
      return { status: 'already_registered', formIdSuffix: formId.slice(-7), projectIdSuffix: projectId.slice(-9) };
    }
    if (existing.syncOwner !== 'worker-v1' || existing.spreadsheetId !== spreadsheetId || existing.projectId !== projectId ||
        existing.status !== 'capacity' || existingIndex.indexOf(formId) !== -1) {
      throw new Error('A conflicting worker record already exists for this form.');
    }
  }
  const registration = registerManagedFormImport_({
    formId,
    spreadsheetId,
    projectId,
    editorEmail,
    planName,
    eventDate: cleanText_(payload.eventDate, 30),
    deadline: cleanText_(payload.deadline, 30),
    handoffTokenHash: payload.handoffTokenHash || '',
    syncOwner: 'worker-v1',
  });
  if (!registration || registration.status !== 'active' || !registration.registered) throw new Error('Dedicated worker form capacity is unavailable.');
  properties.deleteProperty(FORM_MAKER_LEGACY_MIGRATION_PAYLOAD_KEY);
  const result = {
    status: 'registered',
    formIdSuffix: formId.slice(-7),
    projectIdSuffix: projectId.slice(-9),
    handoff: payload.handoffTokenHash ? 'preserved' : 'needs_capability',
  };
  console.log('Legacy form worker registration: ' + JSON.stringify({ status: result.status, handoff: result.handoff }));
  return result;
}

function pauseWorkerManagedFormImportForMigrationRollback_(formId) {
  const target = cleanText_(formId, 200);
  if (!target) throw new Error('移行対象フォームIDが設定されていません。');
  const result = withMetadataLock_(function () {
    const properties = PropertiesService.getScriptProperties();
    const metadata = readManagedFormImport_(target);
    if (!metadata || metadata.formId !== target) throw new Error('管理対象フォームが見つかりません。');
    if (metadata.syncOwner !== 'worker-v1') throw new Error('worker-v1 が所有するフォームだけ停止できます。');
    if (metadata.status === 'paused' && metadata.pauseReason === 'migration_rollback') {
      return { status: 'paused', formIdSuffix: target.slice(-7), pausedAtMs: Number(metadata.migrationRollbackPausedAtMs || 0) };
    }
    if ((metadata.status || 'active') !== 'active') throw new Error('自動停止または再試行中のフォームです。先に状態を確認してください。');
    let lease = null;
    try { lease = JSON.parse(properties.getProperty(FORM_IMPORT_SYNC_LEASE_KEY) || 'null'); } catch (error) {}
    if (lease && Number(lease.expiresAtMs) > Date.now()) {
      return { status: 'busy', reason: 'sync_in_flight', formIdSuffix: target.slice(-7), retryAfterMs: Number(lease.expiresAtMs) };
    }
    const now = Date.now();
    metadata.status = 'paused';
    metadata.pauseReason = 'migration_rollback';
    metadata.migrationRollbackPausedAtMs = now;
    properties.setProperty(FORM_IMPORT_PREFIX + target, JSON.stringify(metadata));
    properties.setProperty('FORM_MAKER_MIGRATION_STOPPED_FORM_ID', target);
    return { status: 'paused', formIdSuffix: target.slice(-7), pausedAtMs: now };
  });
  return result === null
    ? { status: 'busy', reason: 'metadata_lock', formIdSuffix: target.slice(-7) }
    : result;
}

/** Editor-run rollback entry point. Copy the exact stopped form ID to the legacy project only after this succeeds. */

function pauseConfiguredWorkerFormImportForMigrationRollback_() {
  if (ScriptApp.getScriptId() !== FORM_MAKER_DEDICATED_SCRIPT_ID) throw new Error('Worker migration pause was run from the wrong Apps Script project.');
  const target = PropertiesService.getScriptProperties().getProperty('FORM_MAKER_MIGRATION_STOP_TARGET_FORM_ID');
  if (!target) throw new Error('Script properties に FORM_MAKER_MIGRATION_STOP_TARGET_FORM_ID を設定してください。');
  const result = pauseWorkerManagedFormImportForMigrationRollback_(target);
  if (result.status === 'paused') PropertiesService.getScriptProperties().deleteProperty('FORM_MAKER_MIGRATION_STOP_TARGET_FORM_ID');
  console.log('Worker migration pause: ' + JSON.stringify({ status: result.status, reason: result.reason || '' }));
  return result;
}

/** Register one legacy form in the dedicated worker after the old writer is paused. */
/** Owner-run editor diagnostic only. The trailing underscore keeps this out of google.script.run. */

function firebaseGetJson_(path, idToken) {
  const result = formMakerWorkerRequest_('get', path, { idToken: idToken, headers: { 'X-Firebase-ETag': 'true' } });
  return { value: result.value, etag: result.etag };
}

function firebasePutJsonIfAbsent_(path, value, idToken, etag) {
  if (!etag) throw new Error('Firebase room creation was refused because its ETag was unavailable.');
  try {
    formMakerWorkerRequest_('put', path, { idToken: idToken, body: value, headers: { 'if-match': etag } });
  } catch (error) {
    if (/HTTP 412/.test(String(error && error.message || error))) throw new Error('Firebase room creation conflict (HTTP 412).');
    throw error;
  }
}

function firebasePutJson_(path, value, idToken) {
  formMakerWorkerRequest_('put', path, { idToken: idToken, body: value });
}

function firebasePatchJson_(path, value, idToken) {
  formMakerWorkerRequest_('patch', path, { idToken: idToken, body: value });
}


// ===== provision.gs =====
/** Creates one dedicated anonymous Firebase identity and stores its refresh token privately. */
function provisionFormMakerWorkerIdentity_() {
  const properties = PropertiesService.getScriptProperties();
  const uid = String(properties.getProperty(FORM_MAKER_WORKER_UID_PROPERTY) || '').trim();
  const refreshToken = String(properties.getProperty(FORM_MAKER_WORKER_REFRESH_TOKEN_PROPERTY) || '').trim();
  if (uid && refreshToken) return { ok: true, uid: uid, alreadyProvisioned: true };
  if (uid || refreshToken) throw new Error('Firebase worker identity is only partially configured.');

  const created = createFormMakerWorkerIdentity_();
  properties.setProperty(FORM_MAKER_WORKER_REFRESH_TOKEN_PROPERTY, created.refreshToken);
  properties.setProperty(FORM_MAKER_WORKER_UID_PROPERTY, created.uid);
  return { ok: true, uid: created.uid, alreadyProvisioned: false };
}

/** Creates a new identity in Firebase without persisting or returning credentials. */
function createFormMakerWorkerIdentity_() {

  const apiKey = formMakerWorkerApiKey_();
  let response;
  try {
    response = UrlFetchApp.fetch(
      'https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=' + encodeURIComponent(apiKey),
      {
        method: 'post',
        contentType: 'application/json',
        payload: JSON.stringify({ returnSecureToken: true }),
        muteHttpExceptions: true,
      }
    );
  } catch (_) {
    throw new Error('Firebase worker identity creation failed (network).');
  }
  if (response.getResponseCode() !== 200) {
    throw new Error('Firebase worker identity creation failed (HTTP ' + response.getResponseCode() + ')' + formMakerWorkerSafeAuthError_(response) + '.');
  }

  let payload;
  try { payload = JSON.parse(response.getContentText() || '{}'); } catch (_) {
    throw new Error('Firebase worker identity response is invalid.');
  }
  const createdUid = String(payload.localId || '').trim();
  const createdRefreshToken = String(payload.refreshToken || '').trim();
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(createdUid) || !createdRefreshToken) {
    throw new Error('Firebase worker identity response is incomplete.');
  }
  return { uid: createdUid, refreshToken: createdRefreshToken };
}

/** Safe editor entrypoint; the refresh token remains in Script Properties. */
function setupFormMakerWorkerIdentity() {
  return provisionFormMakerWorkerIdentity_();
}

/** Rotates the dedicated worker credential only from its paused, dedicated project. */
function rotateFormMakerWorkerIdentityV1() {
  let lock = null;
  try {
    if (!ScriptApp || ScriptApp.getScriptId() !== FORM_MAKER_DEDICATED_SCRIPT_ID) {
      return { ok: false, oldUid: '', newUid: '', state: 'wrong_script' };
    }
    const properties = PropertiesService.getScriptProperties();
    if (properties.getProperty(FORM_MAKER_QUEUE_ENABLED_PROPERTY) === 'true') {
      return { ok: false, oldUid: '', newUid: '', state: 'queue_enabled' };
    }
    lock = LockService.getScriptLock();
    if (!lock.tryLock(1000)) return { ok: false, oldUid: '', newUid: '', state: 'busy' };

    const oldUid = String(properties.getProperty(FORM_MAKER_WORKER_UID_PROPERTY) || '').trim();
    const oldRefreshToken = String(properties.getProperty(FORM_MAKER_WORKER_REFRESH_TOKEN_PROPERTY) || '').trim();
    if (!oldUid || !oldRefreshToken) return { ok: false, oldUid: '', newUid: '', state: 'provision_failed' };

    let created;
    try { created = createFormMakerWorkerIdentity_(); }
    catch (_) { return { ok: false, oldUid: '', newUid: '', state: 'provision_failed' }; }
    if (!created || created.uid === oldUid) return { ok: false, oldUid: '', newUid: '', state: 'provision_failed' };

    try {
      const values = {};
      values[FORM_MAKER_WORKER_REFRESH_TOKEN_PROPERTY] = created.refreshToken;
      values[FORM_MAKER_WORKER_UID_PROPERTY] = created.uid;
      properties.setProperties(values, false);
    } catch (_) {
      return { ok: false, oldUid: '', newUid: '', state: 'save_failed' };
    }
    return { ok: true, oldUid: oldUid, newUid: created.uid, state: 'rotated' };
  } catch (_) {
    return { ok: false, oldUid: '', newUid: '', state: 'provision_failed' };
  } finally {
    if (lock) try { lock.releaseLock(); } catch (_) {}
  }
}


// ===== queue.gs =====
const FORM_MAKER_QUEUE_CURSOR_PROPERTY = 'FORM_MAKER_QUEUE_CURSOR_V1';
// Keep each minute trigger to one owner (roughly three reads) so the worker
// remains viable on the free Apps Script UrlFetch quota.
const FORM_MAKER_QUEUE_SCAN_LIMIT = 1;
const FORM_MAKER_QUEUE_MAX_OWNERS = 5000;
const FORM_MAKER_QUEUE_STALE_MS = 15 * 60 * 1000;
const FORM_MAKER_QUEUE_REQUEST_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const FORM_MAKER_QUEUE_FUTURE_SKEW_MS = 5 * 60 * 1000;
const FORM_MAKER_ADMISSION_ORPHAN_MS = 15 * 60 * 1000;
const FORM_MAKER_ADMISSION_CLEANUP_AT_PROPERTY = 'FORM_MAKER_ADMISSION_CLEANUP_AT_V1';

function formMakerQueueRotateOwners_(owners, cursor, limit) {
  const normalized = (owners || []).map(String).filter(function (uid) { return /^[A-Za-z0-9_-]{1,128}$/.test(uid); }).sort();
  if (!normalized.length || limit <= 0) return [];
  const start = ((Number(cursor) || 0) % normalized.length + normalized.length) % normalized.length;
  const count = Math.min(Math.floor(limit), normalized.length);
  const rotated = [];
  for (let index = 0; index < count; index += 1) rotated.push(normalized[(start + index) % normalized.length]);
  return rotated;
}

function formMakerClaimNextJob_() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(100)) return null;
  try { return formMakerClaimNextJobLocked_(); } finally { lock.releaseLock(); }
}

function formMakerClaimNextJobLocked_(workerToken) {
    const idToken = workerToken || formMakerWorkerIdToken_();
    const acceptanceMode = formMakerQueueAcceptanceMode_();
    if (acceptanceMode !== 'open' && acceptanceMode !== 'test') return null;
    let testOwners = null;
    if (acceptanceMode === 'test') {
      testOwners = formMakerWorkerRequest_('get', 'formMakerV1/testOwners', { idToken: idToken, query: 'shallow=true' }).value || {};
    }
    const users = formMakerWorkerRequest_('get', 'formMakerV1/users', { idToken: idToken, query: 'shallow=true' }).value || {};
    const ownerIds = Object.keys(users).filter(function (uid) { return /^[A-Za-z0-9_-]{1,128}$/.test(uid); }).sort();
    if (ownerIds.length > FORM_MAKER_QUEUE_MAX_OWNERS) throw new Error('Firebase worker owner scan limit exceeded.');
    if (!ownerIds.length) return null;

    const properties = PropertiesService.getScriptProperties();
    const cursor = Number(properties.getProperty(FORM_MAKER_QUEUE_CURSOR_PROPERTY) || 0);
    const owners = formMakerQueueRotateOwners_(ownerIds, cursor, FORM_MAKER_QUEUE_SCAN_LIMIT);
    properties.setProperty(FORM_MAKER_QUEUE_CURSOR_PROPERTY, String((cursor + owners.length) % ownerIds.length));

    for (let ownerIndex = 0; ownerIndex < owners.length; ownerIndex += 1) {
      const uid = owners[ownerIndex];
      if (acceptanceMode === 'test' && testOwners[uid] !== true) continue;
      const basePath = 'formMakerV1/users/' + uid + '/jobs';
      const running = formMakerWorkerRequest_('get', basePath, {
        idToken: idToken,
        query: 'orderBy=%22state%22&equalTo=%22running%22&limitToFirst=1',
      }).value || {};
      const runningIds = Object.keys(running);
      if (runningIds.length) {
        formMakerResolveStaleRunningJob_(uid, runningIds[0], idToken);
        continue;
      }

      const queued = formMakerWorkerRequest_('get', basePath, {
        idToken: idToken,
        query: 'orderBy=%22state%22&equalTo=%22queued%22&limitToFirst=1',
      }).value || {};
      const queuedIds = Object.keys(queued);
      if (queuedIds.length) {
        const jobId = queuedIds[0];
        const jobPath = basePath + '/' + jobId;
        const current = formMakerWorkerRequest_('get', jobPath, { idToken: idToken });
        if (!current.value || current.value.state !== 'queued') continue;
        const invalidCode = formMakerValidateQueuedJob_(uid, jobId, current.value, Date.now()) ||
          (formMakerValidateAdmissionReservation_(uid, jobId, current.value.admissionSlotId, 'create', current.value.inputHash, current.value.requestedAt, idToken) ? '' : 'invalid_request');
        const now = Date.now();
        if (invalidCode) {
          if (formMakerTransitionJobState_(uid, jobId, 'queued', 'failed', { finishedAt: now, errorCode: invalidCode }, idToken)) {
            formMakerReleaseAdmissionSlot_(uid, jobId, current.value.admissionSlotId, 'create', idToken, current.value.inputHash, current.value.requestedAt);
          }
          continue;
        }
        if (!formMakerTransitionJobState_(uid, jobId, 'queued', 'running', { startedAt: now }, idToken)) continue;
        return { kind: 'creation', uid: uid, jobId: jobId, protocolVersion: current.value.protocolVersion, admissionSlotId: current.value.admissionSlotId, input: current.value.input, inputHash: current.value.inputHash, requestedAt: current.value.requestedAt, startedAt: now, workerIdToken: idToken };
      }
      if (typeof formMakerClaimHandoffForOwner_ === 'function') {
        const handoff = formMakerClaimHandoffForOwner_(uid, idToken);
        if (handoff) return handoff;
      }
    }
    return null;
}

function formMakerValidateQueuedJob_(uid, jobId, job, now) {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(uid) || !/^[A-Za-z0-9_-]{16,80}$/.test(jobId)) return 'invalid_request';
  if (!job || typeof job !== 'object' || Array.isArray(job) || job.jobId !== jobId || ![1, 2].includes(job.protocolVersion) || job.state !== 'queued') return 'invalid_request';
  const allowedJobKeys = ['jobId', 'protocolVersion', 'admissionSlotId', 'input', 'inputHash', 'requestedAt', 'state'];
  if (Object.keys(job).some(function (key) { return allowedJobKeys.indexOf(key) < 0; })) return 'invalid_request';
  if (!/^(0[1-9]|[1-3][0-9]|40)$/.test(String(job.admissionSlotId || ''))) return 'invalid_request';
  if (!Number.isSafeInteger(job.requestedAt) || job.requestedAt < now - FORM_MAKER_QUEUE_REQUEST_MAX_AGE_MS || job.requestedAt > now + FORM_MAKER_QUEUE_FUTURE_SKEW_MS) return 'request_expired';
  if (!/^[a-f0-9]{64}$/.test(String(job.inputHash || ''))) return 'invalid_request';
  const hasTargetRoom = Boolean(job.input && (job.input.targetRoomId || job.input.targetRoomCapabilityHash));
  if ((job.protocolVersion === 2) !== hasTargetRoom || !formMakerValidateInput_(job.input, job.protocolVersion)) return 'invalid_request';
  if (formMakerInputHash_(job.input) !== job.inputHash) return 'invalid_request';
  return '';
}

function formMakerValidateInput_(input, protocolVersion) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return false;
  const keys = Object.keys(input);
  if (keys.some(function (key) { return ['planName', 'editorEmail', 'eventDate', 'deadline', 'description', 'handoffTokenHash', 'targetRoomId', 'targetRoomCapabilityHash'].indexOf(key) < 0; })) return false;
  if (input.handoffTokenHash != null && !/^[a-f0-9]{64}$/.test(String(input.handoffTokenHash))) return false;
  const hasTargetRoom = Boolean(input.targetRoomId || input.targetRoomCapabilityHash);
  if ((Number(protocolVersion) === 2) !== hasTargetRoom) return false;
  if (hasTargetRoom && (!/^[A-Za-z0-9_-]{6,80}$/.test(String(input.targetRoomId || '')) || !/^[a-f0-9]{64}$/.test(String(input.targetRoomCapabilityHash || '')))) return false;
  const planName = String(input.planName || '').trim();
  const email = String(input.editorEmail || '').trim();
  if (!planName || planName.length > 100 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) return false;
  return ['eventDate', 'deadline', 'description'].every(function (key) {
    const value = input[key] == null ? '' : String(input[key]);
    const max = key === 'description' ? 3000 : 40;
    return value.length <= max && !/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(value);
  });
}

function formMakerCanonicalInputJson_(input) {
  const canonical = {
    planName: String(input.planName || '').trim(),
    editorEmail: String(input.editorEmail || '').trim(),
    eventDate: String(input.eventDate || ''),
    deadline: String(input.deadline || ''),
    description: String(input.description || ''),
  };
  if (input.targetRoomId != null) canonical.targetRoomId = String(input.targetRoomId);
  if (input.handoffTokenHash != null) canonical.handoffTokenHash = String(input.handoffTokenHash);
  if (input.targetRoomCapabilityHash != null) canonical.targetRoomCapabilityHash = String(input.targetRoomCapabilityHash);
  return JSON.stringify(canonical);
}

function formMakerInputHash_(input) {
  const digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, formMakerCanonicalInputJson_(input), Utilities.Charset.UTF_8);
  return digest.map(function (byte) { return ('0' + ((byte + 256) % 256).toString(16)).slice(-2); }).join('');
}

function formMakerTransitionJobState_(uid, jobId, expectedState, nextState, updates, idToken) {
  const jobPath = 'formMakerV1/users/' + uid + '/jobs/' + jobId;
  const statePath = jobPath + '/state';
  const state = formMakerWorkerRequest_('get', statePath, { idToken: idToken, headers: { 'X-Firebase-ETag': 'true' } });
  if (state.value !== expectedState || !state.etag) return false;
  const now = Date.now();
  const patch = Object.assign({ updatedAt: now }, updates || {});
  formMakerWorkerRequest_('patch', jobPath, { idToken: idToken, body: patch });
  const result = formMakerWorkerRequest_('put', statePath, {
    idToken: idToken,
    headers: { 'if-match': state.etag },
    acceptedCodes: [412],
    body: nextState,
  });
  return result.code !== 412;
}
function formMakerResolveStaleRunningJob_(uid, jobId, idToken) {
  const jobPath = 'formMakerV1/users/' + uid + '/jobs/' + jobId;
  const current = formMakerWorkerRequest_('get', jobPath, { idToken: idToken });
  const job = current.value;
  if (!job || job.state !== 'running') return false;
  const updatedAt = Number(job.updatedAt || job.startedAt || 0);
  if (!updatedAt || Date.now() - updatedAt < FORM_MAKER_QUEUE_STALE_MS) return false;
  const now = Date.now();
  const transitioned = formMakerTransitionJobState_(uid, jobId, 'running', 'unknown', { finishedAt: now, errorCode: 'worker_interrupted' }, idToken);
  if (transitioned) formMakerReleaseAdmissionSlot_(uid, jobId, job.admissionSlotId, 'create', idToken, job.inputHash, job.requestedAt);
  return transitioned;
}

function formMakerReleaseAdmissionSlot_(uid, jobId, slotId, kind, idToken, requestHash, requestedAt) {
  if (!/^(0[1-9]|[1-3][0-9]|40)$/.test(String(slotId || ''))) return false;
  const path = 'formMakerV1/admission/slots/' + slotId;
  const current = formMakerWorkerRequest_('get', path, { idToken: idToken, headers: { 'X-Firebase-ETag': 'true' } });
  const slot = current.value;
  if (!slot || slot.uid !== uid || slot.jobId !== jobId || slot.kind !== kind || !current.etag) return false;
  if (requestHash && slot.requestHash !== requestHash) return false;
  if (Number(requestedAt) && Number(slot.requestedAt) !== Number(requestedAt)) return false;
  const result = formMakerWorkerRequest_('delete', path, {
    idToken: idToken,
    headers: { 'if-match': current.etag },
    acceptedCodes: [412],
  });
  return result.code !== 412;
}

function formMakerValidateAdmissionReservation_(uid, jobId, slotId, kind, requestHash, requestedAt, idToken) {
  if (!/^(0[1-9]|[1-3][0-9]|40)$/.test(String(slotId || ''))) return false;
  const current = formMakerWorkerRequest_('get', 'formMakerV1/admission/slots/' + slotId, { idToken: idToken });
  const slot = current.value;
  return Boolean(slot && slot.uid === uid && slot.jobId === jobId && slot.kind === kind &&
    slot.requestHash === requestHash && Number(slot.requestedAt) === Number(requestedAt));
}

function formMakerCleanupOneOrphanAdmissionSlot_(idToken) {
  const properties = PropertiesService.getScriptProperties();
  const now = Date.now();
  const lastRun = Number(properties.getProperty(FORM_MAKER_ADMISSION_CLEANUP_AT_PROPERTY) || 0);
  if (now - lastRun < 5 * 60 * 1000) return 0;
  properties.setProperty(FORM_MAKER_ADMISSION_CLEANUP_AT_PROPERTY, String(now));
  const response = formMakerWorkerRequest_('get', 'formMakerV1/admission/slots', {
    idToken: idToken,
    query: 'orderBy=%22requestedAt%22&limitToFirst=1',
    headers: { 'X-Firebase-ETag': 'true' },
  });
  const slots = response.value || {};
  const slotId = Object.keys(slots)[0];
  if (!slotId || !/^(0[1-9]|[1-3][0-9]|40)$/.test(slotId)) return 0;
  const slot = slots[slotId];
  if (!slot || now - Number(slot.requestedAt || 0) < FORM_MAKER_ADMISSION_ORPHAN_MS) return 0;
  const collection = slot.kind === 'handoff' ? 'handoffs' : 'jobs';
  const job = formMakerWorkerRequest_('get', 'formMakerV1/users/' + encodeURIComponent(slot.uid) + '/' + collection + '/' + encodeURIComponent(slot.jobId), { idToken: idToken });
  if (job.value && ['completed', 'partial', 'failed', 'unknown'].indexOf(job.value.state) < 0) return 0;
  if (job.value) {
    return formMakerReleaseAdmissionSlot_(slot.uid, slot.jobId, slotId, slot.kind, idToken, slot.requestHash, slot.requestedAt) ? 1 : 0;
  }
  const exact = formMakerWorkerRequest_('get', 'formMakerV1/admission/slots/' + slotId, { idToken: idToken, headers: { 'X-Firebase-ETag': 'true' } });
  if (!exact.etag || !exact.value || exact.value.uid !== slot.uid || exact.value.jobId !== slot.jobId) return 0;
  const removed = formMakerWorkerRequest_('delete', 'formMakerV1/admission/slots/' + slotId, {
    idToken: idToken,
    headers: { 'if-match': exact.etag },
    acceptedCodes: [412],
  });
  return removed.code === 412 ? 0 : 1;
}


// ===== recovery.gs =====
/** Administrator-invoked recovery; it never creates a replacement form. */
function formMakerRecoverUnknownJob_(uid, jobId) {
  const properties = PropertiesService.getScriptProperties();
  if (properties.getProperty(FORM_MAKER_QUEUE_ENABLED_PROPERTY) === 'true') {
    return { ok: false, state: 'paused_required' };
  }
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(String(uid || '')) || !/^[A-Za-z0-9_-]{16,80}$/.test(String(jobId || ''))) {
    return { ok: false, state: 'invalid_request' };
  }

  const token = formMakerWorkerIdToken_();
  const path = 'formMakerV1/users/' + uid + '/jobs/' + jobId;
  const current = formMakerWorkerRequest_('get', path, { idToken: token });
  const job = current.value;
  if (!job || job.state !== 'unknown') return { ok: false, state: 'not_unknown' };
  const journal = formMakerReadCreationJournal_(uid, jobId);
  const form = formMakerRecoverFormFromJournal_({ uid: uid, jobId: jobId }, journal || {});
  if (!form) return { ok: false, state: 'manual_review_required', created: false };

  const partial = formMakerPartialResult_({ uid: uid, jobId: jobId, input: job.input }, journal || {}, form, 'recovered_existing_form');
  const updated = formMakerTransitionJobState_(uid, jobId, 'unknown', 'partial', {
    finishedAt: Date.now(), errorCode: 'recovered_existing_form', result: partial,
  }, token);
  if (!updated) return { ok: false, state: 'state_changed' };
  formMakerWriteCreationJournal_(uid, jobId, { stage: 'partial', result: partial, errorCode: 'recovered_existing_form' });
  return { ok: true, state: 'partial', created: false, result: partial };
}


// ===== sync.gs =====
const FORM_MAKER_APPLICATION_SYNC_BATCH_LIMIT = 20;
const FORM_MAKER_APPLICATION_SYNC_BUDGET_MS = 45000;

function processFormMakerApplicationSync_() {
  const lease = claimSyncBatch_(Date.now(), 'worker-v1', FORM_MAKER_APPLICATION_SYNC_BATCH_LIMIT, FORM_MAKER_WORKER_SYNC_STATUS_KEY);
  if (!lease) return { status: 'busy', processed: 0 };
  if (lease.globalBackoff) return { status: 'backoff', processed: 0, nextAttemptAtMs: lease.expiresAtMs };
  if (!lease.formIds.length) {
    releaseSyncLease_(lease.leaseId);
    return { status: 'idle', processed: 0 };
  }

  const startedAt = Date.now();
  const summary = { status: 'complete', processed: 0, succeeded: 0, failed: 0, skipped: 0 };
  try {
    const token = formMakerWorkerIdToken_();
    writeGlobalSyncStatus_({ state: 'ready', lastSuccessAtMs: Date.now(), lastErrorCode: '', nextAttemptAtMs: 0 }, FORM_MAKER_WORKER_SYNC_STATUS_KEY);
    for (let index = 0; index < lease.formIds.length; index += 1) {
      if (Date.now() - startedAt >= FORM_MAKER_APPLICATION_SYNC_BUDGET_MS) {
        summary.status = 'budget_exhausted';
        summary.skipped += lease.formIds.length - index;
        break;
      }
      const formId = lease.formIds[index];
      const metadata = readManagedFormImport_(formId);
      if (!metadata || metadata.syncOwner !== 'worker-v1') { summary.skipped += 1; continue; }
      const syncLock = LockService.getUserLock();
      if (!syncLock.tryLock(FORM_IMPORT_EVENT_SYNC_LOCK_MS)) { summary.skipped += 1; continue; }
      try {
        try { ensureManagedFormSubmitTrigger_(FormApp.openById(formId)); } catch (_) {}
        const roomReady = metadata.roomStatus === 'ready' && Date.now() - Number(metadata.roomCheckedAtMs || 0) < FORM_IMPORT_FULL_REFRESH_MS;
        if (!roomReady) {
          const initialized = ensureManagedProjectRoom_(metadata, token);
          if (initialized.state !== 'ready') throw new Error('Firebase room requires owner repair.');
        }
        syncManagedFormImportById_(formId, token, false, true);
        recordSyncSuccess_(formId);
        summary.succeeded += 1;
      } catch (error) {
        const errorCode = classifySyncError_(error);
        recordSyncFailure_(metadata, error, errorCode);
        summary.failed += 1;
      } finally {
        syncLock.releaseLock();
      }
      summary.processed += 1;
    }
    writeGlobalSyncStatus_({ state: summary.failed ? 'partial' : 'ready', lastSuccessAtMs: Date.now(), lastErrorCode: summary.failed ? 'sync_error' : '', nextAttemptAtMs: 0 }, FORM_MAKER_WORKER_SYNC_STATUS_KEY);
    return summary;
  } catch (error) {
    const errorCode = classifySyncError_(error);
    writeGlobalSyncStatus_({ state: 'error', lastErrorCode: errorCode, lastErrorAtMs: Date.now(), nextAttemptAtMs: Date.now() + nextBackoffMs_(1) }, FORM_MAKER_WORKER_SYNC_STATUS_KEY);
    if (errorCode === 'firebase_auth' || errorCode === 'http_401' || errorCode === 'http_403') {
      PropertiesService.getScriptProperties().setProperty(FORM_MAKER_QUEUE_ENABLED_PROPERTY, 'false');
    }
    return { status: 'error', processed: summary.processed, errorCode: errorCode };
  } finally {
    releaseSyncLease_(lease.leaseId);
  }
}



// ===== trigger.gs =====
const FORM_MAKER_QUEUE_ENABLED_PROPERTY = 'FORM_MAKER_QUEUE_ENABLED_V1';
const FORM_MAKER_ACCEPTANCE_MODE_PROPERTY = 'FORM_MAKER_ACCEPTANCE_MODE_V1';
const FORM_MAKER_QUEUE_LAST_STARTED_PROPERTY = 'FORM_MAKER_QUEUE_LAST_STARTED_AT_V1';
const FORM_MAKER_QUEUE_LAST_FINISHED_PROPERTY = 'FORM_MAKER_QUEUE_LAST_FINISHED_AT_V1';
const FORM_MAKER_QUEUE_LAST_STATE_PROPERTY = 'FORM_MAKER_QUEUE_LAST_STATE_V1';
const FORM_MAKER_QUEUE_LAST_ERROR_PROPERTY = 'FORM_MAKER_QUEUE_LAST_ERROR_V1';
const FORM_MAKER_QUEUE_TRIGGER_HANDLER = 'runFormMakerQueueV1';
const FORM_MAKER_QUEUE_TRIGGER_CONFIG_PROPERTY = 'FORM_MAKER_QUEUE_TRIGGER_CONFIG_V1';
const FORM_MAKER_QUEUE_TRIGGER_CONFIG_VERSION = 'five-minute-v1';
const FORM_MAKER_QUEUE_TRIGGER_INTERVAL_MINUTES = 5;
const FORM_MAKER_QUEUE_DAILY_LIMIT = 16;
const FORM_MAKER_QUEUE_DAILY_COUNT_PROPERTY = 'FORM_MAKER_QUEUE_DAILY_COUNT_V1';
const FORM_MAKER_QUEUE_DAILY_DATE_PROPERTY = 'FORM_MAKER_QUEUE_DAILY_DATE_V1';
const FORM_MAKER_QUEUE_RUN_BUDGET_MS = 180000;
const FORM_MAKER_QUEUE_STATUS_SIGNATURE_PROPERTY = 'FORM_MAKER_QUEUE_STATUS_SIGNATURE_V1';
const FORM_MAKER_QUEUE_STATUS_UPDATED_PROPERTY = 'FORM_MAKER_QUEUE_STATUS_UPDATED_AT_V1';
const FORM_MAKER_QUEUE_STATUS_HEARTBEAT_MS = 5 * 60 * 1000;
const FORM_MAKER_QUEUE_ACTIVE_LEASE_PROPERTY = 'FORM_MAKER_QUEUE_ACTIVE_LEASE_V1';
const FORM_MAKER_APPLICATION_SYNC_TRIGGER_CONFIG_PROPERTY = 'FORM_MAKER_APPLICATION_SYNC_TRIGGER_CONFIG_V1';
const FORM_MAKER_APPLICATION_SYNC_TRIGGER_CONFIG_VERSION = 'hourly-v1';
const FORM_MAKER_APPLICATION_SYNC_TRIGGER_HANDLER = 'runFormMakerApplicationSyncV1';
const FORM_MAKER_APPLICATION_SYNC_TRIGGER_INTERVAL_MINUTES = 60;

function formMakerQueueAcceptanceMode_() {
  const configured = PropertiesService.getScriptProperties().getProperty(FORM_MAKER_ACCEPTANCE_MODE_PROPERTY);
  return configured == null || configured === '' ? 'open' : String(configured);
}

function processFormMakerQueue_() {
  const properties = PropertiesService.getScriptProperties();
  const acceptanceMode = formMakerQueueAcceptanceMode_();
  if (acceptanceMode !== 'open' && acceptanceMode !== 'test') {
    formMakerPersistQueueStatus_('error', 'acceptance_mode_invalid', false);
    return formMakerRecordQueueState_('error', 'acceptance_mode_invalid');
  }
  if (properties.getProperty(FORM_MAKER_QUEUE_ENABLED_PROPERTY) !== 'true') {
    formMakerPersistQueueStatus_('paused', '', false);
    return formMakerRecordQueueState_('paused', '');
  }
  if (typeof formMakerProcessJob_ !== 'function') return formMakerRecordQueueState_('worker_unavailable', 'worker_unavailable');
  if (formMakerQueueDailyCount_() >= FORM_MAKER_QUEUE_DAILY_LIMIT) {
    formMakerPersistQueueStatus_('daily_limit', 'daily_limit', false);
    return formMakerRecordQueueState_('daily_limit', 'daily_limit');
  }

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(100)) {
    formMakerPersistQueueStatus_('busy', '', true);
    return formMakerRecordQueueState_('busy', '');
  }
  const start = Date.now();
  let idToken = '';
  let lease = '';
  let job = null;
  let lockHeld = true;
  properties.setProperty(FORM_MAKER_QUEUE_LAST_STARTED_PROPERTY, String(start));
  try {
    if (properties.getProperty(FORM_MAKER_QUEUE_ENABLED_PROPERTY) !== 'true') {
      formMakerPersistQueueStatus_('paused', '', false);
      return formMakerRecordQueueState_('paused', '');
    }
    const activeLease = JSON.parse(properties.getProperty(FORM_MAKER_QUEUE_ACTIVE_LEASE_PROPERTY) || 'null');
    if (activeLease && Number(activeLease.expiresAt) > start) {
      formMakerPersistQueueStatus_('busy', '', true);
      return formMakerRecordQueueState_('busy', '');
    }
    lease = Utilities.getUuid();
    properties.setProperty(FORM_MAKER_QUEUE_ACTIVE_LEASE_PROPERTY, JSON.stringify({ id: lease, expiresAt: start + FORM_MAKER_QUEUE_RUN_BUDGET_MS + 60000 }));
    idToken = formMakerWorkerIdToken_();
    job = formMakerClaimNextJobLocked_(idToken);
    if (!job) {
      properties.deleteProperty(FORM_MAKER_QUEUE_ACTIVE_LEASE_PROPERTY);
      lease = '';
      return formMakerRecordQueueState_('idle', '');
    }
    formMakerIncrementDailyCount_();
    lock.releaseLock();
    lockHeld = false;
    if (Date.now() - start > FORM_MAKER_QUEUE_RUN_BUDGET_MS) {
      formMakerMarkClaimUnknown_(job, 'worker_time_limit');
      return formMakerRecordQueueState_('unknown', 'worker_time_limit');
    }
    if (job.kind === 'handoff') {
      const result = formMakerProcessHandoffJob_(job);
      if (!formMakerFinishHandoffJob_(job, result.state, result.errorCode || '', result.result || null)) throw new Error('handoff_job_completion_write_failed');
      return formMakerRecordQueueState_(result.state, result.errorCode || '');
    }
    const result = formMakerProcessJob_(job);
    return formMakerRecordQueueState_(result && result.state || 'unknown', result && result.errorCode || '');
  } catch (error) {
    const code = formMakerClassifyWorkerError_(error);
    if (job) formMakerMarkClaimUnknown_(job, code);
    if (code === 'firebase_auth' || code === 'quota') properties.setProperty(FORM_MAKER_QUEUE_ENABLED_PROPERTY, 'false');
    return formMakerRecordQueueState_('error', code);
  } finally {
    if (!lockHeld && lease) {
      const cleanupLock = LockService.getScriptLock();
      if (cleanupLock.tryLock(100)) {
        try {
          const currentLease = JSON.parse(properties.getProperty(FORM_MAKER_QUEUE_ACTIVE_LEASE_PROPERTY) || 'null');
          if (currentLease && currentLease.id === lease) properties.deleteProperty(FORM_MAKER_QUEUE_ACTIVE_LEASE_PROPERTY);
        } finally { cleanupLock.releaseLock(); }
      }
    }
    if (lockHeld) try { lock.releaseLock(); } catch (_) {}
    properties.setProperty(FORM_MAKER_QUEUE_LAST_FINISHED_PROPERTY, String(Date.now()));
    const state = properties.getProperty(FORM_MAKER_QUEUE_LAST_STATE_PROPERTY) || 'unknown';
    const errorCode = properties.getProperty(FORM_MAKER_QUEUE_LAST_ERROR_PROPERTY) || '';
    const enabled = properties.getProperty(FORM_MAKER_QUEUE_ENABLED_PROPERTY) === 'true';
    const accepting = enabled && formMakerQueueDailyCount_() < FORM_MAKER_QUEUE_DAILY_LIMIT && state !== 'error';
    formMakerPersistQueueStatus_(state, errorCode, accepting, idToken);
  }
}

function resumeFormMakerQueue_() {
  PropertiesService.getScriptProperties().setProperty(FORM_MAKER_QUEUE_ENABLED_PROPERTY, 'true');
  if (formMakerQueueDailyCount_() >= FORM_MAKER_QUEUE_DAILY_LIMIT) formMakerPersistQueueStatus_('daily_limit', 'daily_limit', false);
  else formMakerPersistQueueStatus_('ready', '', true);
  return formMakerQueueHealth_();
}

/** Public Apps Script time-trigger handler; maintain the selected five-minute cadence. */
function runFormMakerQueueV1() {
  try { ensureFormMakerQueueTrigger_(); }
  catch (_) { console.error('Queue trigger migration failed; existing schedule remains active.'); }
  try { ensureFormMakerHourlyReconciliationTrigger_(); }
  catch (_) { console.error('Hourly reconciliation trigger migration failed; existing schedule remains active.'); }
  if (PropertiesService.getScriptProperties().getProperty(FORM_MAKER_QUEUE_ENABLED_PROPERTY) !== 'true') {
    return formMakerRecordQueueState_('paused', '');
  }
  try { formMakerCleanupOneOrphanAdmissionSlot_(formMakerWorkerIdToken_()); } catch (_) {}
  return processFormMakerQueue_();
}

/** Replace older queue timer triggers with one five-minute trigger. */
function ensureFormMakerQueueTrigger_() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) return { status: 'busy' };
  try {
    const properties = PropertiesService.getScriptProperties();
    const triggers = ScriptApp.getProjectTriggers();
    const existing = triggers.filter(function (trigger) {
      return trigger.getHandlerFunction() === FORM_MAKER_QUEUE_TRIGGER_HANDLER;
    });
    if (properties.getProperty(FORM_MAKER_QUEUE_TRIGGER_CONFIG_PROPERTY) === FORM_MAKER_QUEUE_TRIGGER_CONFIG_VERSION && existing.length === 1) {
      return { status: 'current' };
    }
    const replacement = ScriptApp.newTrigger(FORM_MAKER_QUEUE_TRIGGER_HANDLER)
      .timeBased()
      .everyMinutes(FORM_MAKER_QUEUE_TRIGGER_INTERVAL_MINUTES)
      .create();
    existing.forEach(function (trigger) {
      if (trigger !== replacement) ScriptApp.deleteTrigger(trigger);
    });
    properties.setProperty(FORM_MAKER_QUEUE_TRIGGER_CONFIG_PROPERTY, FORM_MAKER_QUEUE_TRIGGER_CONFIG_VERSION);
    return { status: 'configured', intervalMinutes: FORM_MAKER_QUEUE_TRIGGER_INTERVAL_MINUTES };
  } finally {
    lock.releaseLock();
  }
}

/** Public Apps Script time-trigger handler; ensureFormMakerHourlyReconciliationTrigger_ maintains its hourly schedule. */
function runFormMakerApplicationSyncV1() {
  let cleanedFiles = 0;
  if (typeof formMakerCleanupExpiredHandoffFiles_ === 'function') {
    try { cleanedFiles = formMakerCleanupExpiredHandoffFiles_(); } catch (_) {}
  }
  if (PropertiesService.getScriptProperties().getProperty(FORM_MAKER_QUEUE_ENABLED_PROPERTY) !== 'true') {
    return { status: 'paused', processed: 0, cleanedFiles: cleanedFiles };
  }
  return processFormMakerApplicationSync_();
}

/** Replace the old five-minute scan with one hourly reconciliation trigger. */
function ensureFormMakerHourlyReconciliationTrigger_() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) return { status: 'busy' };
  try {
    const properties = PropertiesService.getScriptProperties();
    const triggers = ScriptApp.getProjectTriggers();
    const existing = triggers.filter(function (trigger) {
      return trigger.getHandlerFunction() === FORM_MAKER_APPLICATION_SYNC_TRIGGER_HANDLER;
    });
    if (properties.getProperty(FORM_MAKER_APPLICATION_SYNC_TRIGGER_CONFIG_PROPERTY) === FORM_MAKER_APPLICATION_SYNC_TRIGGER_CONFIG_VERSION && existing.length === 1) {
      return { status: 'current' };
    }
    const replacement = ScriptApp.newTrigger(FORM_MAKER_APPLICATION_SYNC_TRIGGER_HANDLER)
      .timeBased()
      .everyHours(1)
      .create();
    existing.forEach(function (trigger) {
      if (trigger !== replacement) ScriptApp.deleteTrigger(trigger);
    });
    properties.setProperty(FORM_MAKER_APPLICATION_SYNC_TRIGGER_CONFIG_PROPERTY, FORM_MAKER_APPLICATION_SYNC_TRIGGER_CONFIG_VERSION);
    return { status: 'configured', intervalMinutes: FORM_MAKER_APPLICATION_SYNC_TRIGGER_INTERVAL_MINUTES };
  } finally {
    lock.releaseLock();
  }
}

function pauseFormMakerQueue_() {
  PropertiesService.getScriptProperties().setProperty(FORM_MAKER_QUEUE_ENABLED_PROPERTY, 'false');
  formMakerPersistQueueStatus_('paused', '', false);
  return formMakerQueueHealth_();
}

function formMakerPersistQueueStatus_(state, errorCode, accepting, idToken) {
  try {
    if (!idToken && (errorCode === 'firebase_auth' || errorCode === 'quota')) return false;
    const properties = PropertiesService.getScriptProperties();
    const configuredMode = formMakerQueueAcceptanceMode_();
    const acceptanceMode = configuredMode === 'open' ? 'open' : 'test';
    const effectiveAccepting = Boolean(accepting) && (configuredMode === 'open' || configuredMode === 'test');
    const signature = JSON.stringify([effectiveAccepting, acceptanceMode, String(state || 'error'), formMakerQueueDailyCount_(), String(errorCode || '')]);
    const lastUpdatedAt = Number(properties.getProperty(FORM_MAKER_QUEUE_STATUS_UPDATED_PROPERTY) || 0);
    if (properties.getProperty(FORM_MAKER_QUEUE_STATUS_SIGNATURE_PROPERTY) === signature && Date.now() - lastUpdatedAt < FORM_MAKER_QUEUE_STATUS_HEARTBEAT_MS) return true;
    const token = idToken || formMakerWorkerIdToken_();
    formMakerWorkerRequest_('put', 'formMakerV1/status', {
      idToken: token,
      body: {
        accepting: effectiveAccepting,
        acceptanceMode: acceptanceMode,
        state: String(state || 'error'),
        dailyCount: formMakerQueueDailyCount_(),
        dailyLimit: FORM_MAKER_QUEUE_DAILY_LIMIT,
        updatedAt: Date.now(),
        errorCode: String(errorCode || ''),
      },
    });
    properties.setProperty(FORM_MAKER_QUEUE_STATUS_SIGNATURE_PROPERTY, signature);
    properties.setProperty(FORM_MAKER_QUEUE_STATUS_UPDATED_PROPERTY, String(Date.now()));
    return true;
  } catch (_) {
    return false;
  }
}

function formMakerQueueHealth_() {
  const properties = PropertiesService.getScriptProperties();
  return {
    enabled: properties.getProperty(FORM_MAKER_QUEUE_ENABLED_PROPERTY) === 'true',
    dailyCount: formMakerQueueDailyCount_(),
    dailyLimit: FORM_MAKER_QUEUE_DAILY_LIMIT,
    lastStartedAt: Number(properties.getProperty(FORM_MAKER_QUEUE_LAST_STARTED_PROPERTY) || 0),
    lastFinishedAt: Number(properties.getProperty(FORM_MAKER_QUEUE_LAST_FINISHED_PROPERTY) || 0),
    lastState: properties.getProperty(FORM_MAKER_QUEUE_LAST_STATE_PROPERTY) || 'not_started',
    lastErrorCode: properties.getProperty(FORM_MAKER_QUEUE_LAST_ERROR_PROPERTY) || '',
  };
}

function formMakerRecordQueueState_(state, errorCode) {
  const properties = PropertiesService.getScriptProperties();
  properties.setProperty(FORM_MAKER_QUEUE_LAST_STATE_PROPERTY, String(state || 'unknown'));
  properties.setProperty(FORM_MAKER_QUEUE_LAST_ERROR_PROPERTY, String(errorCode || ''));
  return { state: String(state || 'unknown'), errorCode: String(errorCode || '') };
}

function formMakerQueueDailyCount_() {
  const properties = PropertiesService.getScriptProperties();
  const day = Utilities.formatDate(new Date(), Session.getScriptTimeZone() || 'Etc/UTC', 'yyyy-MM-dd');
  if (properties.getProperty(FORM_MAKER_QUEUE_DAILY_DATE_PROPERTY) !== day) return 0;
  return Math.max(0, Number(properties.getProperty(FORM_MAKER_QUEUE_DAILY_COUNT_PROPERTY) || 0));
}

function formMakerIncrementDailyCount_() {
  const properties = PropertiesService.getScriptProperties();
  const day = Utilities.formatDate(new Date(), Session.getScriptTimeZone() || 'Etc/UTC', 'yyyy-MM-dd');
  const count = formMakerQueueDailyCount_() + 1;
  properties.setProperty(FORM_MAKER_QUEUE_DAILY_DATE_PROPERTY, day);
  properties.setProperty(FORM_MAKER_QUEUE_DAILY_COUNT_PROPERTY, String(count));
  return count;
}

function formMakerClassifyWorkerError_(error) {
  const message = String(error && error.message || '');
  if (/HTTP 401|HTTP 403|identity mismatch|not provisioned/i.test(message)) return 'firebase_auth';
  if (/HTTP 429|quota|too many/i.test(message)) return 'quota';
  if (/time limit|execution|timeout/i.test(message)) return 'execution_limit';
  return 'worker_error';
}

function formMakerMarkClaimUnknown_(job, errorCode) {
  if (job && job.kind === 'handoff' && typeof formMakerFinishHandoffJob_ === 'function') return formMakerFinishHandoffJob_(job, 'unknown', errorCode || 'worker_interrupted');
  if (typeof formMakerFinishJob_ === 'function') return formMakerFinishJob_(job, 'unknown', errorCode);
  return false;
}
