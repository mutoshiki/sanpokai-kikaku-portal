const TRUSTED_SCRIPT_HOSTS = new Set([
  'script.google.com',
  'script.googleusercontent.com',
]);

function isTrustedScriptHost(hostname) {
  return TRUSTED_SCRIPT_HOSTS.has(hostname)
    || hostname.endsWith('.script.googleusercontent.com')
    || hostname.endsWith('-script.googleusercontent.com');
}

export function isTrustedAppMessage(event, frameWindow) {
  try {
    const hostname = new URL(event.origin).hostname;
    if (!isTrustedScriptHost(hostname)) return false;

    let source = event.source;
    for (let depth = 0; source && depth < 8; depth += 1) {
      if (source === frameWindow) return true;
      let parent;
      try { parent = source.parent; } catch { return false; }
      if (!parent || parent === source) return false;
      source = parent;
    }
    return false;
  } catch {
    return false;
  }
}
