import { NATIVE_REFERENCE_TARGETS, nativeReferenceError } from './native-reference.js';
import { UsersService } from './services/users-service.js';
import { FilesService } from './services/files-service.js';

const metadataOnlyStorage = Object.freeze({ get() { throw new Error('Native reference reads cannot access storage'); } });

export function nativeReferenceService(collection, options) {
  if (collection === 'yuncms_users') return new UsersService(options);
  if (collection === 'yuncms_files') return new FilesService({ ...options, storage: options.storage ?? metadataOnlyStorage });
  throw nativeReferenceError('UNSUPPORTED_RELATION_TARGET', 'Unsupported native reference identity');
}

export async function validateNativeReferenceWrites(service, entries) {
  const snapshot = service.schema ?? await service.schemaCache.get(service.database);
  for (const [field, value] of entries) {
    const relation = snapshot.relationByManyField?.get(`${service.collection}.${field}`);
    if (!relation || value == null) continue;
    const metadata = typeof relation.metadata === 'string' ? JSON.parse(relation.metadata) : relation.metadata;
    if (metadata?.nativeReference !== true) continue;
    if (!NATIVE_REFERENCE_TARGETS.includes(relation.one_collection) || relation.one_field !== 'id') throw nativeReferenceError('UNSUPPORTED_RELATION_TARGET', 'Invalid native reference metadata');
    if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) throw nativeReferenceError('INVALID_PAYLOAD', `Native reference ${field} requires a UUID`);
    const { data } = await nativeReferenceService(relation.one_collection, { ...service, schema: snapshot }).readManyForRelation({ fields: ['id'], lookupField: 'id', values: [value] });
    if (data.length !== 1) throw nativeReferenceError('FORBIDDEN', 'Native reference is unavailable to this caller');
  }
}
