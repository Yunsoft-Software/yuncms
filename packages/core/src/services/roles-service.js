import { randomUUID } from 'node:crypto';

import { BaseService } from './base-service.js';

function assertRoleManager(accountability) {
  if (accountability.admin === true || accountability.system === true) return;
  const error = new Error('Role management requires administrator accountability');
  error.code = 'FORBIDDEN';
  throw error;
}

export class RolesService extends BaseService {
  async readMany() {
    assertRoleManager(this.accountability);
    const [rows] = await this.database.query(
      `SELECT id, name, description, admin, public, created_at, updated_at
       FROM yuncms_roles
       ORDER BY name ASC`,
    );
    return rows;
  }

  async readOne(id) {
    assertRoleManager(this.accountability);
    const [rows] = await this.database.query(
      `SELECT id, name, description, admin, public, created_at, updated_at
       FROM yuncms_roles
       WHERE id = ?
       LIMIT 1`,
      [id],
    );
    return rows[0] ?? null;
  }

  async createOne(input = {}) {
    assertRoleManager(this.accountability);
    if (!input.name || typeof input.name !== 'string' || input.name.trim().length === 0) {
      const error = new Error('Role name is required');
      error.code = 'INVALID_PAYLOAD';
      throw error;
    }

    const id = randomUUID();
    await this.database.query(
      `INSERT INTO yuncms_roles (id, name, description, admin, public)
       VALUES (?, ?, ?, ?, ?)`,
      [
        id,
        input.name.trim(),
        input.description ?? null,
        input.admin === true ? 1 : 0,
        input.public === true ? 1 : 0,
      ],
    );
    return this.readOne(id);
  }
}
