export async function readAuthenticationUserByEmail(database, email) {
  const [rows] = await database.query(
    `SELECT u.id, u.email, u.password_hash, u.role, u.status, u.email_verified_at,
            r.admin AS role_admin, r.public AS role_public
     FROM yuncms_users u
     LEFT JOIN yuncms_roles r ON r.id = u.role
     WHERE u.email = ?
     LIMIT 1`,
    [email],
  );
  return rows[0] ?? null;
}

export async function readAuthenticationUserById(database, id) {
  const [rows] = await database.query(
    `SELECT u.id, u.email, u.password_hash, u.role, u.status, u.email_verified_at,
            r.admin AS role_admin, r.public AS role_public
     FROM yuncms_users u
     LEFT JOIN yuncms_roles r ON r.id = u.role
     WHERE u.id = ?
     LIMIT 1`,
    [id],
  );
  return rows[0] ?? null;
}
