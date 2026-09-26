import { query } from './database';

// Ensure additive schema changes for Notion-like features
export async function ensureAppSchema(): Promise<void> {
  await query(`CREATE EXTENSION IF NOT EXISTS "pgcrypto"`);

  await query(`
    CREATE TABLE IF NOT EXISTS users (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      name TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'member'`);

  await query(`
    CREATE TABLE IF NOT EXISTS pages (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      parent_page_id UUID REFERENCES pages(id) ON DELETE SET NULL,
      title TEXT NOT NULL,
      slug TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'note',
      icon TEXT,
      is_section BOOLEAN NOT NULL DEFAULT FALSE,
      cover_url TEXT,
      cover_position_y INTEGER,
      content JSONB NOT NULL DEFAULT '{"type":"doc","content":[]}',
      sort_order INTEGER NOT NULL DEFAULT 0,
      deleted_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await query(`
    ALTER TABLE pages
    ADD COLUMN IF NOT EXISTS parent_page_id UUID REFERENCES pages(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS icon TEXT,
    ADD COLUMN IF NOT EXISTS is_section BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS cover_url TEXT,
    ADD COLUMN IF NOT EXISTS cover_position_y INTEGER,
    ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ
  `);

  await query(`
    ALTER TABLE pages
    ADD COLUMN IF NOT EXISTS tags TEXT[] NOT NULL DEFAULT '{}',
    ADD COLUMN IF NOT EXISTS status TEXT,
    ADD COLUMN IF NOT EXISTS due_date DATE,
    ADD COLUMN IF NOT EXISTS type TEXT NOT NULL DEFAULT 'note',
    ADD COLUMN IF NOT EXISTS working_directory TEXT
  `);

  await query(`
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS telegram_chat_id TEXT,
    ADD COLUMN IF NOT EXISTS telegram_notifications_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS failed_login_attempts INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS failed_login_window_started_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS login_locked_until TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS session_version INTEGER NOT NULL DEFAULT 1,
    ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS password_changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ADD COLUMN IF NOT EXISTS two_factor_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS two_factor_secret TEXT,
    ADD COLUMN IF NOT EXISTS two_factor_pending_secret TEXT
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS page_versions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      page_id UUID NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      content JSONB NOT NULL,
      reason TEXT NOT NULL DEFAULT 'edit',
      content_hash TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS custom_emojis (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name TEXT NOT NULL,
      url TEXT NOT NULL,
      created_by TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS terminal_tabs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id TEXT NOT NULL,
      request_key TEXT NOT NULL,
      title TEXT NOT NULL,
      cwd TEXT,
      is_active BOOLEAN NOT NULL DEFAULT FALSE,
      last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(user_id, request_key)
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS remember_notes (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id TEXT NOT NULL,
      title TEXT NOT NULL DEFAULT '',
      body TEXT NOT NULL DEFAULT '',
      color TEXT NOT NULL DEFAULT 'sand',
      checklist JSONB NOT NULL DEFAULT '[]'::jsonb,
      tags TEXT[] NOT NULL DEFAULT '{}',
      reminder_date DATE,
      reminder_time TIME,
      reminder_label TEXT,
      reminder_repeat_daily BOOLEAN NOT NULL DEFAULT FALSE,
      reminder_sent_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS trusted_devices (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id TEXT NOT NULL,
      selector TEXT NOT NULL UNIQUE,
      verifier_hash TEXT NOT NULL,
      name TEXT,
      user_agent TEXT,
      last_ip TEXT,
      last_used_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      expires_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS mobile_devices (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      session_version INTEGER NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_used_at TIMESTAMPTZ,
      revoked_at TIMESTAMPTZ
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS mobile_sessions (
      session_id UUID PRIMARY KEY,
      user_id TEXT NOT NULL,
      device_id UUID NOT NULL REFERENCES mobile_devices(id),
      started_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS browser_recording_sessions (
      session_id UUID PRIMARY KEY,
      user_id TEXT NOT NULL,
      started_at TIMESTAMPTZ NOT NULL,
      completed_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await query(`CREATE INDEX IF NOT EXISTS idx_browser_recording_sessions_user ON browser_recording_sessions(user_id, started_at DESC)`);

  await query(`
    ALTER TABLE remember_notes
    ADD COLUMN IF NOT EXISTS tags TEXT[] NOT NULL DEFAULT '{}'
  `);

  await query(`
    ALTER TABLE remember_notes
    ADD COLUMN IF NOT EXISTS reminder_time TIME,
    ADD COLUMN IF NOT EXISTS reminder_repeat_daily BOOLEAN NOT NULL DEFAULT FALSE
  `);

  await query(`CREATE INDEX IF NOT EXISTS idx_page_versions_page_created ON page_versions(page_id, created_at DESC)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_pages_parent_page_id ON pages(parent_page_id)`);
  await query(`ALTER TABLE pages ADD COLUMN IF NOT EXISTS revision BIGINT NOT NULL DEFAULT 0`);
  await query(`ALTER TABLE page_versions
    ADD COLUMN IF NOT EXISTS author_user_id UUID REFERENCES users(id),
    ADD COLUMN IF NOT EXISTS page_revision BIGINT`);
  await query(`CREATE TABLE IF NOT EXISTS page_grants (
    page_id UUID NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('editor', 'viewer')),
    granted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (page_id, user_id)
  )`);
  await query(`CREATE INDEX IF NOT EXISTS idx_page_grants_user ON page_grants(user_id, page_id)`);
  await query(`CREATE TABLE IF NOT EXISTS contacts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    requester_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    addressee_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (requester_user_id <> addressee_user_id)
  )`);
  await query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_contacts_pair ON contacts(requester_user_id, addressee_user_id)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_contacts_addressee ON contacts(addressee_user_id, status)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_contacts_requester ON contacts(requester_user_id, status)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_pages_deleted_at ON pages(deleted_at DESC)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_pages_status ON pages(status)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_pages_due_date ON pages(due_date)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_custom_emojis_created ON custom_emojis(created_at DESC)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_terminal_tabs_user_seen ON terminal_tabs(user_id, is_active DESC, last_seen_at DESC)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_remember_notes_user_updated ON remember_notes(user_id, updated_at DESC)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_remember_notes_user_reminder ON remember_notes(user_id, reminder_date ASC NULLS LAST)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_trusted_devices_user_expires ON trusted_devices(user_id, expires_at DESC)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_mobile_devices_user ON mobile_devices(user_id, revoked_at)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_mobile_sessions_user ON mobile_sessions(user_id, started_at DESC)`);
}
