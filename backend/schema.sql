-- Brain Core baseline schema for a new personal installation.
-- The backend also applies additive migrations at startup.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  name TEXT,
  telegram_chat_id TEXT,
  telegram_notifications_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  failed_login_attempts INTEGER NOT NULL DEFAULT 0,
  failed_login_window_started_at TIMESTAMPTZ,
  login_locked_until TIMESTAMPTZ,
  session_version INTEGER NOT NULL DEFAULT 1,
  last_login_at TIMESTAMPTZ,
  password_changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  two_factor_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  two_factor_secret TEXT,
  two_factor_pending_secret TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

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
  tags TEXT[] NOT NULL DEFAULT '{}',
  status TEXT,
  due_date DATE,
  working_directory TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS page_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  page_id UUID NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  content JSONB NOT NULL,
  reason TEXT NOT NULL DEFAULT 'edit',
  content_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS custom_emojis (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

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
);

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
);

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
);

CREATE INDEX IF NOT EXISTS idx_pages_parent_page_id ON pages(parent_page_id);
CREATE INDEX IF NOT EXISTS idx_pages_deleted_at ON pages(deleted_at DESC);
CREATE INDEX IF NOT EXISTS idx_pages_status ON pages(status);
CREATE INDEX IF NOT EXISTS idx_pages_due_date ON pages(due_date);
CREATE INDEX IF NOT EXISTS idx_page_versions_page_created ON page_versions(page_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_custom_emojis_created ON custom_emojis(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_terminal_tabs_user_seen ON terminal_tabs(user_id, is_active DESC, last_seen_at DESC);
CREATE INDEX IF NOT EXISTS idx_remember_notes_user_updated ON remember_notes(user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_remember_notes_user_reminder ON remember_notes(user_id, reminder_date ASC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_trusted_devices_user_expires ON trusted_devices(user_id, expires_at DESC);
