import { randomUUID } from 'node:crypto';

import { BaseService } from './base-service.js';
import { resolveSystemResourceAccess } from './system-resource-access.js';

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

function assertSpecialRoleCreation(accountability, { admin = false, public: publicRole = false } = {}) {
  if (accountability.admin === true || accountability.system === true) return;
  if (admin || publicRole) {
    const error = new Error('Delegated role managers cannot create administrator or public roles');
    error.code = 'FORBIDDEN';
    throw error;
  }
}

export class RolesService extends BaseService {
  async action(event, payload) {
    if (!this.emitter) return;
    await this.emitter.action(event, payload, {
      accountability: this.accountability,
      requestId: this.requestId,
      collection: 'yuncms_roles',
    });
  }

  async #readOneUnsafe(id) {
    const [rows] = await this.database.query(
      `SELECT id, name, description, admin, public, created_at, updated_at
       FROM yuncms_roles
       WHERE id = ?
       LIMIT 1`,
      [id],
    );
    return rows[0] ?? null;
  }

  async readMany() {
    await resolveSystemResourceAccess(this, 'read', 'yuncms_roles');
    const [rows] = await this.database.query(
      `SELECT id, name, description, admin, public, created_at, updated_at
       FROM yuncms_roles
       ORDER BY name ASC`,
    );
    return rows;
  }

  async readOne(id) {
    await resolveSystemResourceAccess(this, 'read', 'yuncms_roles');
    return this.#readOneUnsafe(id);
  }

  async createOne(input = {}) {
    await resolveSystemResourceAccess(this, 'create', 'yuncms_roles');
    const name = normalizeRoleName(input.name);

    const admin = input.admin === true;
    const publicRole = input.public === true;
    if (admin && publicRole) {
      const error = new Error('A role cannot be both administrator and public');
      error.code = 'INVALID_ROLE';
      throw error;
    }
    assertSpecialRoleCreation(this.accountability, { admin, public: publicRole });

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
    const role = await this.#readOneUnsafe(id);
    await this.action('roles.create', { key: id, item: role });
    return role;
  }

  async updateOne(id, patch = {}) {
    await resolveSystemResourceAccess(this, 'update', 'yuncms_roles');
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

    const existing = await this.#readOneUnsafe(id);
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
    const role = await this.#readOneUnsafe(id);
    await this.action('roles.update', { key: id, item: role, before: existing, changes: patch });
    return role;
  }

  async deleteOne(id) {
    await resolveSystemResourceAccess(this, 'delete', 'yuncms_roles');
    const role = await this.#readOneUnsafe(id);
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
    await this.action('roles.delete', { key: id, before: role });
    return true;
  }
}
