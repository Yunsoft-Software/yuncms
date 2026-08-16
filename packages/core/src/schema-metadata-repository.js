function encodeJson(value) {
  return value == null ? null : JSON.stringify(value);
}

export class SchemaMetadataRepository {
  constructor(database) {
    if (!database) throw new Error('Database handle is required');
    this.database = database;
  }

  async listCollections() {
    const [rows] = await this.database.query(
      `SELECT collection, primary_key, note, singleton, hidden, system, metadata, created_at, updated_at
       FROM yuncms_collections
       ORDER BY collection ASC`,
    );
    return rows;
  }

  async readCollection(collection) {
    const [rows] = await this.database.query(
      `SELECT collection, primary_key, note, singleton, hidden, system, metadata, created_at, updated_at
       FROM yuncms_collections
       WHERE collection = ?
       LIMIT 1`,
      [collection],
    );
    return rows[0] ?? null;
  }

  async createCollection({
    collection,
    primaryKey = 'id',
    note = null,
    singleton = false,
    hidden = false,
    system = false,
    metadata = null,
  }) {
    await this.database.query(
      `INSERT INTO yuncms_collections
       (collection, primary_key, note, singleton, hidden, system, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        collection,
        primaryKey,
        note,
        singleton ? 1 : 0,
        hidden ? 1 : 0,
        system ? 1 : 0,
        encodeJson(metadata),
      ],
    );
    return this.readCollection(collection);
  }

  async deleteCollection(collection) {
    const [result] = await this.database.query(
      'DELETE FROM yuncms_collections WHERE collection = ?',
      [collection],
    );
    return result.affectedRows;
  }

  async listFields(collection) {
    const [rows] = await this.database.query(
      `SELECT id, collection, field, type, required, readonly, hidden, sort, interface, options, schema_metadata,
              created_at, updated_at
       FROM yuncms_fields
       WHERE collection = ?
       ORDER BY COALESCE(sort, 2147483647), id ASC`,
      [collection],
    );
    return rows;
  }

  async readField(collection, field) {
    const [rows] = await this.database.query(
      `SELECT id, collection, field, type, required, readonly, hidden, sort, interface, options, schema_metadata,
              created_at, updated_at
       FROM yuncms_fields
       WHERE collection = ? AND field = ?
       LIMIT 1`,
      [collection, field],
    );
    return rows[0] ?? null;
  }

  async createField({
    collection,
    field,
    type,
    required = false,
    readonly = false,
    hidden = false,
    sort = null,
    interface: fieldInterface = null,
    options = null,
    schemaMetadata = null,
  }) {
    await this.database.query(
      `INSERT INTO yuncms_fields
       (collection, field, type, required, readonly, hidden, sort, interface, options, schema_metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        collection,
        field,
        type,
        required ? 1 : 0,
        readonly ? 1 : 0,
        hidden ? 1 : 0,
        sort,
        fieldInterface,
        encodeJson(options),
        encodeJson(schemaMetadata),
      ],
    );
    return this.readField(collection, field);
  }

  async deleteField(collection, field) {
    const [result] = await this.database.query(
      'DELETE FROM yuncms_fields WHERE collection = ? AND field = ?',
      [collection, field],
    );
    return result.affectedRows;
  }

  async listRelations() {
    const [rows] = await this.database.query(
      `SELECT id, many_collection, many_field, one_collection, one_field, junction_collection,
              junction_field, on_delete, metadata, created_at
       FROM yuncms_relations
       ORDER BY many_collection, many_field`,
    );
    return rows;
  }

  async readRelation(manyCollection, manyField) {
    const [rows] = await this.database.query(
      `SELECT id, many_collection, many_field, one_collection, one_field, junction_collection,
              junction_field, on_delete, metadata, created_at
       FROM yuncms_relations
       WHERE many_collection = ? AND many_field = ?
       LIMIT 1`,
      [manyCollection, manyField],
    );
    return rows[0] ?? null;
  }

  async createRelation({
    manyCollection,
    manyField,
    oneCollection,
    oneField = null,
    junctionCollection = null,
    junctionField = null,
    onDelete = 'RESTRICT',
    metadata = null,
  }) {
    await this.database.query(
      `INSERT INTO yuncms_relations
       (many_collection, many_field, one_collection, one_field, junction_collection, junction_field, on_delete, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        manyCollection,
        manyField,
        oneCollection,
        oneField,
        junctionCollection,
        junctionField,
        onDelete,
        encodeJson(metadata),
      ],
    );
    return this.readRelation(manyCollection, manyField);
  }

  async deleteRelation(manyCollection, manyField) {
    const [result] = await this.database.query(
      'DELETE FROM yuncms_relations WHERE many_collection = ? AND many_field = ?',
      [manyCollection, manyField],
    );
    return result.affectedRows;
  }
}
