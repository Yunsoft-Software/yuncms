export function assertSchemaManager(accountability) {
  if (accountability?.admin === true || accountability?.system === true) return;

  const error = new Error('Schema management requires administrator accountability');
  error.code = 'FORBIDDEN';
  throw error;
}
