import type postgres from "postgres";

/** Mirror a sqlite session user into the local console database so admin routes can authorize. */
export async function mirrorPlatformAdminInPostgres(
  sql: postgres.Sql,
  userId: string,
  email: string,
): Promise<void> {
  await sql`INSERT INTO auth.users (id) VALUES (${userId}::uuid) ON CONFLICT (id) DO NOTHING`;
  await sql`
    INSERT INTO users (id, identity_label, email)
    VALUES (${userId}, ${email}, ${email})
    ON CONFLICT (id) DO NOTHING
  `;
  await sql`
    INSERT INTO user_platform_roles (user_id, role)
    VALUES (${userId}::uuid, 'admin')
    ON CONFLICT (user_id) DO UPDATE SET role = 'admin'
  `;
}
