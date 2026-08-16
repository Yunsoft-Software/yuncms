import { createSystemAccountability } from './accountability.js';
import { withTransaction } from './transaction.js';
import { RolesService } from './services/roles-service.js';
import { UsersService } from './services/users-service.js';

export async function createInitialAdmin(pool, { email, password } = {}) {
  if (!pool) throw new Error('Database pool is required');
  const accountability = createSystemAccountability();

  return withTransaction(pool, async (connection) => {
    const [existingAdminUsers] = await connection.query(
      `SELECT u.id, u.email
       FROM yuncms_users u
       INNER JOIN yuncms_roles r ON r.id = u.role
       WHERE r.admin = 1
       ORDER BY u.created_at ASC
       LIMIT 1`,
    );

    if (existingAdminUsers[0]) {
      const error = new Error(`An administrator user already exists: ${existingAdminUsers[0].email}`);
      error.code = 'INITIAL_ADMIN_EXISTS';
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
