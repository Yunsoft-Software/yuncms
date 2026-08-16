export async function readSchemaVersion(database) {
  const [rows] = await database.query('SELECT version FROM yuncms_schema_state WHERE id = 1 LIMIT 1');
  if (!rows?.[0]) {
    const error = new Error('YunCMS schema state is missing');
    error.code = 'SCHEMA_STATE_MISSING';
    throw error;
  }

  return Number(rows[0].version);
}

export async function incrementSchemaVersion(database) {
  const [result] = await database.query('UPDATE yuncms_schema_state SET version = version + 1 WHERE id = 1');
  if (result.affectedRows !== 1) {
    const error = new Error('Could not update YunCMS schema version');
    error.code = 'SCHEMA_STATE_MISSING';
    throw error;
  }

  return readSchemaVersion(database);
}
