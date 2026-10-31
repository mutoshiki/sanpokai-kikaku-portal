export async function recoverProjectJob({ session, jobId, project, input, createProjectLink, onHandoffReady = () => {} } = {}) {
  const id = String(jobId || '');
  if (!id) throw new Error('作成状況を確認できません。');
  const existing = await session.getJob(id);
  if (existing) {
    notifyProjectHandoff({ session, project, jobId: id, job: existing, onHandoffReady });
    return { job: { ...existing, jobId: id }, resumed: false };
  }

  const link = project ? (createProjectLink ? await createProjectLink(input) : project) : null;
  if (project && (!link || link.roomId !== project.roomId || link.jobId !== id || !link.token)) {
    throw new Error('同じ企画・依頼の情報を確認できません。企画画面を開き直してください。');
  }
  const jobInput = link?.roomId
    ? { ...input, targetRoomId: link.roomId, targetRoomJobId: link.jobId, targetRoomCapability: link.token }
    : input;
  const accepted = await session.enqueue(jobInput, { jobId: id });
  const token = accepted?.handoffToken || session.getHandoffToken?.(id) || '';
  if (token && link?.roomId) onHandoffReady({ roomId: link.roomId, jobId: id, token });
  return { job: { ...accepted, jobId: id }, resumed: true };
}

export function notifyProjectHandoff({ session, project, jobId, job, onHandoffReady = () => {} } = {}) {
  const id = String(jobId || '');
  const token = session?.getHandoffToken?.(id) || job?.handoffToken || '';
  if (!id || !token || !project?.roomId) return false;
  onHandoffReady({ roomId: project.roomId, jobId: id, token });
  return true;
}
