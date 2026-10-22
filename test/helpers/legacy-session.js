import { randomUUID } from 'node:crypto';
import { createOpaqueToken } from '../../packages/core/src/auth/tokens.js';

// Seed the real pre-0027 session shape. Current session services intentionally
// require the complete schema; migration fixtures must not weaken that guard.
export async function seedLegacySession(database, user) {
  const session = randomUUID(), access = createOpaqueToken('access'), refresh = createOpaqueToken('refresh');
  await database.query(`INSERT INTO yuncms_sessions
    (id,user,token_hash,access_token_hash,access_expires_at,expires_at)
    VALUES (?,?,?,?,DATE_ADD(CURRENT_TIMESTAMP(3), INTERVAL 15 MINUTE),DATE_ADD(CURRENT_TIMESTAMP(3), INTERVAL 30 DAY))`,
    [session,user.id,refresh.hash,access.hash]);
  return { session, access_token: access.token, refresh_token: refresh.token };
}
