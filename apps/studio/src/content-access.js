export function canWriteContent(capabilities, action, recordId = null) {
  if (capabilities?.[action]?.allowed !== true) return false;
  return action === 'create' || (recordId !== null && Object.hasOwn(capabilities.records ?? {}, String(recordId)) && capabilities.records[String(recordId)][action] === true);
}

export function contentWritableFields(fields, capabilities, action, readonly) {
  if (capabilities?.[action]?.allowed !== true) return [];
  const allowed = capabilities[action].fields;
  return fields.filter(field => !readonly(field) && (allowed === null || allowed?.includes(field.field)));
}
