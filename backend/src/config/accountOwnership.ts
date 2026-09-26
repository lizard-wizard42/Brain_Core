import fs from 'fs';
import path from 'path';
import { config } from './index';
import { pool } from './database';

const uploadsDirectory = path.resolve(config.UPLOADS_DIR);

function existingUploadPaths(directory = uploadsDirectory, prefix = ''): string[] {
  if (!fs.existsSync(directory)) return [];
  const paths: string[] = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || entry.isSymbolicLink()) continue;
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) paths.push(...existingUploadPaths(path.join(directory, entry.name), relative));
    else if (entry.isFile()) paths.push(relative);
  }
  return paths;
}

/** Backfill the legacy single-user library before a second account can exist. */
export async function ensureAccountOwnership(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('LOCK TABLE users, pages, custom_emojis IN ACCESS EXCLUSIVE MODE');
    await client.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'member'");
    await client.query('ALTER TABLE pages ADD COLUMN IF NOT EXISTS owner_user_id UUID REFERENCES users(id)');
    await client.query('ALTER TABLE custom_emojis ADD COLUMN IF NOT EXISTS owner_user_id UUID REFERENCES users(id)');
    await client.query(`CREATE TABLE IF NOT EXISTS uploaded_assets (
      relative_path TEXT PRIMARY KEY,
      owner_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
    await client.query(`CREATE TABLE IF NOT EXISTS account_migrations (
      key TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);

    const users = (await client.query<{ id: string }>('SELECT id FROM users ORDER BY created_at, id')).rows;
    const ownerMigrated = (await client.query(
      "SELECT key FROM account_migrations WHERE key = 'legacy_owner_assigned'",
    )).rowCount !== 0;
    const unowned = (await client.query<{ pages: string; emojis: string }>(`
      SELECT (SELECT COUNT(*) FROM pages WHERE owner_user_id IS NULL)::text AS pages,
             (SELECT COUNT(*) FROM custom_emojis WHERE owner_user_id IS NULL)::text AS emojis
    `)).rows[0];
    const uploadsMigrated = (await client.query(
      "SELECT key FROM account_migrations WHERE key = 'legacy_uploads_assigned'",
    )).rowCount !== 0;
    const legacyFiles = uploadsMigrated ? [] : existingUploadPaths();
    const needsLegacyOwner = Number(unowned.pages) > 0 || Number(unowned.emojis) > 0
      || legacyFiles.length > 0;
    if (needsLegacyOwner && users.length !== 1) {
      throw new Error('Migração multiusuário exige exatamente uma conta para atribuir dados legados');
    }
    if (users.length === 1) {
      const legacyUserId = users[0].id;
      if (!ownerMigrated) {
        await client.query("UPDATE users SET role = 'owner' WHERE id = $1", [legacyUserId]);
      }
      await client.query('UPDATE pages SET owner_user_id = $1 WHERE owner_user_id IS NULL', [legacyUserId]);
      await client.query('UPDATE custom_emojis SET owner_user_id = $1 WHERE owner_user_id IS NULL', [legacyUserId]);
      for (const relativePath of legacyFiles) {
        await client.query(
          'INSERT INTO uploaded_assets (relative_path, owner_user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
          [relativePath, legacyUserId],
        );
      }
    }
    if (users.length > 0) {
      const owners = await client.query<{ count: string }>("SELECT COUNT(*)::text AS count FROM users WHERE role = 'owner'");
      if (Number(owners.rows[0].count) !== 1) {
        throw new Error('A instância precisa ter exatamente uma conta proprietária');
      }
    }
    if (!uploadsMigrated) {
      await client.query("INSERT INTO account_migrations (key) VALUES ('legacy_uploads_assigned')");
    }
    if (!ownerMigrated && users.length > 0) {
      await client.query("INSERT INTO account_migrations (key) VALUES ('legacy_owner_assigned')");
    }
    await client.query('ALTER TABLE pages ALTER COLUMN owner_user_id SET NOT NULL');
    await client.query('ALTER TABLE custom_emojis ALTER COLUMN owner_user_id SET NOT NULL');
    await client.query('CREATE INDEX IF NOT EXISTS idx_pages_owner_parent ON pages(owner_user_id, parent_page_id, deleted_at, sort_order)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_emojis_owner_created ON custom_emojis(owner_user_id, created_at DESC)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_assets_owner ON uploaded_assets(owner_user_id)');
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
