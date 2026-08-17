import { randomUUID } from 'node:crypto';

import { createSystemAccountability } from './accountability.js';
import { withTransaction } from './transaction.js';
import { RolesService } from './services/roles-service.js';
import { UsersService } from './services/users-service.js';

const PUBLIC_ROLE_NAMES = Object.freeze(['Public', 'Public API', 'Anonymous']);

export async function findExistingAdmin(database) {
  if (!database) throw new Error('Database handle is required');
  const [rows] = await database.query(
    `SELECT u.id, u.email, u.role
     FROM yuncms_users u
     INNER JOIN yuncms_roles r ON r.id = u.role
     WHERE r.admin = 1
     ORDER BY u.created_at ASC
     LIMIT 1`,
  );
  return rows[0] ?? null;
}

export async function findPublicRole(database) {
  if (!database) throw new Error('Database handle is required');
  const [rows] = await database.query(
    `SELECT id, name, description, admin, public
     FROM yuncms_roles
     WHERE public = 1
     ORDER BY created_at ASC
     LIMIT 2`,
  );
  if (rows.length > 1) {
    const error = new Error('Multiple public roles are configured');
    error.code = 'PUBLIC_ROLE_AMBIGUOUS';
    throw error;
  }
  return rows[0] ?? null;
}

async function availablePublicRoleName(database) {
  for (const candidate of PUBLIC_ROLE_NAMES) {
    const [rows] = await database.query(
      'SELECT id FROM yuncms_roles WHERE name = ? LIMIT 1',
      [candidate],
    );
    if (!rows[0]) return candidate;
  }
  return `Public ${randomUUID().slice(0, 8)}`;
}

export async function ensurePublicRole(database) {
  if (!database) throw new Error('Database handle is required');
  const existing = await findPublicRole(database);
  if (existing) return { ...existing, created: false };

  const roles = new RolesService({
    accountability: createSystemAccountability(),
    database,
  });
  const role = await roles.createOne({
    name: await availablePublicRoleName(database),
    description: 'Unauthenticated public API access. No collection access is granted by default.',
    public: true,
  });
  return { ...role, created: true };
}

export async function createInitialAdmin(pool, { email, password } = {}) {
  if (!pool) throw new Error('Database pool is required');
  const accountability = createSystemAccountability();

  return withTransaction(pool, async (connection) => {
    const existingAdmin = await findExistingAdmin(connection);
    if (existingAdmin) {
      const error = new Error(`An administrator user already exists: ${existingAdmin.email}`);
      error.code = 'INITIAL_ADMIN_EXISTS';
      error.admin = existingAdmin;
      throw error;
    }

    const [adminRoles] = await connection.query(
      `SELECT id, name
       FROM yuncms_roles
       WHERE admin = 1
       ORDER BY created_at ASC
       LIMIT 1`,
    );

    let roleId = adminRoles[0]?.id ?? null;
    if (!roleId) {
      const roles = new RolesService({ accountability, database: connection });
      const role = await roles.createOne({
        name: 'Administrator',
        description: 'Full YunCMS administrator access',
        admin: true,
      });
      roleId = role.id;
    }

    const users = new UsersService({ accountability, database: connection });
    const user = await users.createOne({
      email,
      password,
      role: roleId,
      status: 'active',
      emailVerified: true,
    });

    return {
      id: user.id,
      email: user.email,
      role: roleId,
    };
  });
}
