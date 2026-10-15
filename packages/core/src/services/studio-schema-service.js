import { BaseService } from './base-service.js';
import { PermissionsService } from './permissions-service.js';
import { SchemaCache } from '../schema.js';
import { ItemsService } from './items-service.js';
import { compileFilter } from '../query.js';
import { quoteIdentifier } from '../identifier.js';

export function studioCollectionDisplay(collection) {
  const metadata = collection.metadata ?? {};
  return { collection: collection.collection, name: collection.name, primary_key: collection.primary_key,
    hidden: collection.hidden, singleton: collection.singleton, system: false,
    metadata: Object.fromEntries(['icon', 'color', 'sort', 'navigationGroup', 'navigation_group'].filter(key => Object.hasOwn(metadata, key)).map(key => [key, metadata[key]])) };
}
export function studioReadableFields(entry, permission) {
  return Object.values(entry.fields).filter(field => field.field === entry.primary_key || permission.fields == null || permission.fields.includes(field.field))
    .map(field => ({ field: field.field, name: field.name, type: field.type, required: field.required, readonly: field.readonly,
      hidden: field.hidden, sort: field.sort, interface: field.interface, options: field.options, schema_metadata: field.schema_metadata }));
}

export class StudioSchemaService extends BaseService {
  async readCapabilities(collection, ids = []) {
    const schema = await this.#snapshot(), entry = Object.hasOwn(schema.collections, collection) ? schema.collections[collection] : null;
    if (!entry || entry.system) throw Object.assign(new Error('Collection is unavailable'), { code: 'COLLECTION_NOT_FOUND' });
    if (!Array.isArray(ids) || ids.length > 100 || ids.some(id => !['string', 'number'].includes(typeof id) || !String(id) || String(id).length > 191)) throw Object.assign(new Error('Provide at most 100 record ids'), { code: 'INVALID_QUERY' });
    const items = new ItemsService(collection, this), read = await items.resolvePermission('read');
    const result = { records: Object.fromEntries(ids.map(id => [String(id), { update: false, delete: false }])) };
    for (const action of ['create', 'update', 'delete']) {
      let permission;
      try { permission = await items.resolvePermission(action); }
      catch (error) { if (error.code !== 'FORBIDDEN') throw error; }
      result[action] = { allowed: Boolean(permission), fields: permission?.fields ?? [] };
      if (permission && permission.fields === null) result[action].fields = null;
      if (!permission || action === 'create' || !ids.length) continue;
      const filters = [{ [entry.primary_key]: { _in: ids } }];
      if (read.filter) filters.push(read.filter);
      if (permission.filter) filters.push(permission.filter);
      const compiled = compileFilter({ _and: filters }, entry, { dynamicVariables: items.dynamicVariables() });
      const [rows] = await this.database.query(`SELECT ${quoteIdentifier(entry.primary_key)} AS record_key FROM ${quoteIdentifier(entry.collection)}${compiled.sql}`, compiled.params);
      for (const row of rows) {
        const key = ids.find(id => String(id).toLowerCase() === String(row.record_key).toLowerCase());
        if (key !== undefined) result.records[String(key)][action] = true;
      }
    }
    return result;
  }
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
      result.push(studioCollectionDisplay(collection));
    }
    return result;
  }
  async readFields(collection) {
    const schema = await this.#snapshot(), entry = Object.hasOwn(schema.collections, collection) ? schema.collections[collection] : null;
    if (!entry || entry.system) throw Object.assign(new Error('Collection is unavailable'), { code: 'COLLECTION_NOT_FOUND' });
    const permission = await this.#permission(collection);
    return studioReadableFields(entry, permission);
  }
  async readRelations() {
    const schema = await this.#snapshot();
    const visible = await this.readCollections(), fields = new Map();
    for (const collection of visible) fields.set(collection.collection, new Set((await this.readFields(collection.collection)).map(field => field.field)));
    return schema.relations.filter(relation => fields.get(relation.many_collection)?.has(relation.many_field) && fields.has(relation.one_collection)
      && (!relation.one_field || fields.get(relation.one_collection).has(relation.one_field)));
  }
}
