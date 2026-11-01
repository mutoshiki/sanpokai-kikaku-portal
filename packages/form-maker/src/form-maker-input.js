export const INITIAL_FORM_MAKER_INPUT = Object.freeze({
  planName: '',
  editorEmail: '',
  eventDate: '',
  deadline: '',
  description: '',
});

const editableFields = Object.keys(INITIAL_FORM_MAKER_INPUT);

function editableValues(source) {
  return Object.fromEntries(editableFields
    .filter((key) => source && Object.hasOwn(source, key))
    .map((key) => [key, source[key] ?? '']));
}

export function createInitialFormMakerInput({ project = null, savedInput = null } = {}) {
  return {
    ...INITIAL_FORM_MAKER_INPUT,
    ...editableValues(project?.sampleInput),
    ...editableValues(savedInput),
    ...(project ? {
      planName: String(project.projectName || ''),
      eventDate: String(project.eventDate || ''),
    } : {}),
  };
}
