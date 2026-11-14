function safeGoogleUrl(value, kind) {
  try {
    const url = new URL(String(value || ''));
    const matchesPath = kind === 'public-form'
      ? /^\/forms\/d\/(?:e\/)?[A-Za-z0-9_-]+\/viewform\/?$/.test(url.pathname)
      : kind === 'edit-form'
        ? /^\/forms\/d\/(?:e\/)?[A-Za-z0-9_-]+\/edit\/?$/.test(url.pathname)
        : /^\/spreadsheets\/d\/[A-Za-z0-9_-]+(?:\/edit)?\/?$/.test(url.pathname);
    return url.protocol === 'https:' && url.hostname === 'docs.google.com' && matchesPath ? url.href : '';
  } catch { return ''; }
}

export function resolveProjectFormLinks(applicationSnapshot, jobResult) {
  const sharedFormUrl = safeGoogleUrl(applicationSnapshot?.formUrl, 'public-form');
  const resultFormUrl = safeGoogleUrl(jobResult?.formUrl, 'public-form');
  const formUrl = sharedFormUrl || resultFormUrl;
  const resultMatches = Boolean(formUrl && resultFormUrl === formUrl);
  const editCandidate = resultMatches ? safeGoogleUrl(jobResult?.editUrl, 'edit-form') : '';
  const sheetCandidate = resultMatches ? safeGoogleUrl(jobResult?.responseSheetUrl, 'response-sheet') : '';
  return {
    formUrl,
    linked: applicationSnapshot?.linked === true,
    responseCount: Math.max(0, Number(applicationSnapshot?.responseCount) || 0),
    editUrl: editCandidate,
    responseSheetUrl: sheetCandidate,
  };
}
