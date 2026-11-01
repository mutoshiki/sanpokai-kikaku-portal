export function shouldShowProjectToolLink(project) {
  return !project?.roomId;
}
