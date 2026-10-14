import { BaseService } from './base-service.js';
import { PermissionsService } from './permissions-service.js';
import { SchemaCache } from '../schema.js';

export class StudioSchemaService extends BaseService {
  async #snapshot() {
    if (!this.accountability.user && !this.accountability.system) throw Object.assign(new Error('Studio metadata requires authentication'), { code: 'FORBIDDEN' });
    this.schema ??= await new SchemaCache().get(this.database);
    return this.schema;
  }
  async #permission(collection) {
    return new PermissionsService(this).resolve('read', collection);
  }
  async readCollections() {
    const schema = await this.#snapshot(), result = [];
    for (const collection of Object.values(schema.collections)) {
      if (collection.system) continue;
      try { await this.#permission(collection.collection); }
      catch (error) { if (error.code === 'FORBIDDEN') continue; throw error; }
      const metadata = collection.metadata ?? {};
      result.push({ collection: collection.collection, name: collection.name, primary_key: collection.primary_key,
        hidden: collection.hidden, singleton: collection.singleton, system: false,
        metadata: Object.fromEntries(['icon', 'color', 'sort', 'navigationGroup', 'navigation_group'].filter(key => Object.hasOwn(metadata, key)).map(key => [key, metadata[key]])) });
    }
    return result;
  }
  async readFields(collection) {
    const schema = await this.#snapshot(), entry = schema.collections[collection];
    if (!entry || entry.system) throw Object.assign(new Error('Collection is unavailable'), { code: 'COLLECTION_NOT_FOUND' });
    const permission = await this.#permission(collection);
    return Object.values(entry.fields).filter(field => field.field === entry.primary_key || permission.fields == null || permission.fields.includes(field.field))
      .map(field => ({ field: field.field, name: field.name, type: field.type, required: field.required, readonly: field.readonly,
        hidden: field.hidden, sort: field.sort, interface: field.interface, options: field.options, schema_metadata: field.schema_metadata }));
  }
  async readRelations() {
    const schema = await this.#snapshot();
    const visible = await this.readCollections(), fields = new Map();
    for (const collection of visible) fields.set(collection.collection, new Set((await this.readFields(collection.collection)).map(field => field.field)));
    return schema.relations.filter(relation => fields.get(relation.many_collection)?.has(relation.many_field) && fields.has(relation.one_collection)
      && (!relation.one_field || fields.get(relation.one_collection).has(relation.one_field)));
  }
}
