const MAX_DATE = 8.64e15;

function timestamp(value) {
  if (typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= MAX_DATE) return value;
  if (typeof value === 'string' && value.trim()) {
    const numeric = Number(value);
    if (Number.isFinite(numeric) && Math.abs(numeric) <= MAX_DATE) return numeric;
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed) && Math.abs(parsed) <= MAX_DATE) return parsed;
  }
  return null;
}

function priorityDate(form) {
  return timestamp(form.updatedAt) ?? timestamp(form.createdAt);
}

function createdDate(form) {
  return timestamp(form.createdAt);
}

export function mergeFormHistories(stored, incoming, limit = 10) {
  const records = new Map();
  for (const [sourceOrder, list] of [stored, incoming].entries()) {
    for (const raw of Array.isArray(list) ? list : []) {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
      const formId = String(raw.formId || '').trim();
      if (!formId) continue;
      const next = { ...raw, formId };
      const current = records.get(formId);
      const priority = priorityDate(next);
      const previousPriority = current && priorityDate(current.form);
      if (!current || (priority ?? -Infinity) > (previousPriority ?? -Infinity)
        || priority === previousPriority && sourceOrder > current.sourceOrder) {
        records.set(formId, { form: { ...(current?.form || {}), ...next }, sourceOrder });
      } else if (current) {
        records.set(formId, { ...current, form: { ...next, ...current.form } });
      }
    }
  }
  const safeLimit = Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : 10;
  return [...records.values()].map(({ form }) => form).sort((a, b) => {
    const dateOrder = (createdDate(b) ?? -Infinity) - (createdDate(a) ?? -Infinity);
    return dateOrder || a.formId.localeCompare(b.formId);
  }).slice(0, safeLimit);
}
