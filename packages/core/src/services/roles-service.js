import { randomUUID } from 'node:crypto';

import { BaseService } from './base-service.js';

function assertRoleManager(accountability) {
  if (accountability.admin === true || accountability.system === true) return;
  const error = new Error('Role management requires administrator accountability');
  error.code = 'FORBIDDEN';
  throw error;
}

function normalizeRoleName(name) {
  if (!name || typeof name !== 'string' || name.trim().length === 0) {
    const error = new Error('Role name is required');
    error.code = 'INVALID_PAYLOAD';
    throw error;
  }
  const normalized = name.trim();
  if (normalized.length > 100) {
    const error = new Error('Role name cannot exceed 100 characters');
    error.code = 'INVALID_PAYLOAD';
    throw error;
  }
  return normalized;
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
    const name = normalizeRoleName(input.name);

    const admin = input.admin === true;
    const publicRole = input.public === true;
    if (admin && publicRole) {
      const error = new Error('A role cannot be both administrator and public');
      error.code = 'INVALID_ROLE';
      throw error;
    }

    if (publicRole) {
      const [rows] = await this.database.query(
        'SELECT id FROM yuncms_roles WHERE public = 1 LIMIT 1',
      );
      if (rows[0]) {
        const error = new Error('A public role already exists');
        error.code = 'PUBLIC_ROLE_EXISTS';
        throw error;
      }
    }

    const id = randomUUID();
    await this.database.query(
      `INSERT INTO yuncms_roles (id, name, description, admin, public)
       VALUES (?, ?, ?, ?, ?)`,
      [
        id,
        name,
        input.description ?? null,
        admin ? 1 : 0,
        publicRole ? 1 : 0,
      ],
    );
    return this.readOne(id);
  }

  async updateOne(id, patch = {}) {
    assertRoleManager(this.accountability);
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
      const error = new Error('Role patch must be an object');
      error.code = 'INVALID_PAYLOAD';
      throw error;
    }
    const keys = Object.keys(patch);
    if (keys.length === 0 || keys.some((key) => !['name', 'description'].includes(key))) {
      const error = new Error('Role update supports name and description only in V1');
      error.code = 'INVALID_PAYLOAD';
      throw error;
    }

    const existing = await this.readOne(id);
    if (!existing) {
      const error = new Error(`Unknown role: ${id}`);
      error.code = 'ROLE_NOT_FOUND';
      throw error;
    }

    const assignments = [];
    const params = [];
    if (Object.hasOwn(patch, 'name')) {
      assignments.push('name = ?');
      params.push(normalizeRoleName(patch.name));
    }
    if (Object.hasOwn(patch, 'description')) {
      assignments.push('description = ?');
      params.push(patch.description ?? null);
    }
    params.push(id);

    await this.database.query(
      `UPDATE yuncms_roles SET ${assignments.join(', ')} WHERE id = ?`,
      params,
    );
    return this.readOne(id);
  }

  async deleteOne(id) {
    assertRoleManager(this.accountability);
    const role = await this.readOne(id);
    if (!role) {
      const error = new Error(`Unknown role: ${id}`);
      error.code = 'ROLE_NOT_FOUND';
      throw error;
    }
    if (Boolean(role.admin) || Boolean(role.public)) {
      const error = new Error('Administrator and public roles cannot be deleted through the V1 role API');
      error.code = 'PROTECTED_ROLE';
      throw error;
    }

    const [users] = await this.database.query(
      'SELECT id FROM yuncms_users WHERE role = ? LIMIT 1',
      [id],
    );
    if (users[0]) {
      const error = new Error('Role cannot be deleted while users are assigned to it');
      error.code = 'ROLE_IN_USE';
      throw error;
    }

    const [result] = await this.database.query('DELETE FROM yuncms_roles WHERE id = ?', [id]);
    if (result.affectedRows !== 1) {
      const error = new Error(`Unknown role: ${id}`);
      error.code = 'ROLE_NOT_FOUND';
      throw error;
    }
    return true;
  }
}
