import { query } from './database';

export async function ensureAgentSchema(): Promise<void> {
  await query(`CREATE TABLE IF NOT EXISTS integration_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    session_version INTEGER NOT NULL,
    scopes TEXT[] NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    revoked_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  await query(`CREATE TABLE IF NOT EXISTS integration_settings (
    user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    enabled BOOLEAN NOT NULL DEFAULT FALSE,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  // Preserve existing installations; new accounts must explicitly enable MCP.
  await query(`INSERT INTO integration_settings (user_id, enabled)
    SELECT DISTINCT user_id, TRUE FROM integration_tokens ON CONFLICT DO NOTHING`);
  await query(`CREATE TABLE IF NOT EXISTS integration_operations (
    token_id UUID NOT NULL REFERENCES integration_tokens(id) ON DELETE CASCADE,
    operation_id UUID NOT NULL,
    request_hash TEXT NOT NULL,
    response JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (token_id, operation_id)
  )`);
  await query(`CREATE TABLE IF NOT EXISTS integration_audit (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    token_id UUID REFERENCES integration_tokens(id) ON DELETE SET NULL,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    operation TEXT NOT NULL,
    target_kind TEXT NOT NULL,
    target_id UUID NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  await query(`ALTER TABLE remember_notes ADD COLUMN IF NOT EXISTS revision BIGINT NOT NULL DEFAULT 0`);
  await query(`CREATE TABLE IF NOT EXISTS remember_note_versions (
    note_id UUID NOT NULL REFERENCES remember_notes(id) ON DELETE CASCADE,
    revision BIGINT NOT NULL,
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (note_id, revision)
  )`);
  // Every writer, including the existing web UI, participates in revision checks.
  await query(`CREATE OR REPLACE FUNCTION remember_note_revision() RETURNS trigger AS $$
    BEGIN NEW.revision := OLD.revision + 1; RETURN NEW; END;
    $$ LANGUAGE plpgsql`);
  await query(`CREATE OR REPLACE FUNCTION remember_note_history() RETURNS trigger AS $$
    BEGIN
      INSERT INTO remember_note_versions (note_id, revision, title, body)
      VALUES (NEW.id, NEW.revision, NEW.title, NEW.body);
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql`);
  await query(`DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'remember_note_revision_trigger' AND tgrelid = 'remember_notes'::regclass) THEN
      CREATE TRIGGER remember_note_revision_trigger BEFORE UPDATE ON remember_notes FOR EACH ROW EXECUTE FUNCTION remember_note_revision();
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'remember_note_history_trigger' AND tgrelid = 'remember_notes'::regclass) THEN
      CREATE TRIGGER remember_note_history_trigger AFTER INSERT OR UPDATE ON remember_notes FOR EACH ROW EXECUTE FUNCTION remember_note_history();
    END IF;
  END $$`);
  await query(`INSERT INTO remember_note_versions (note_id, revision, title, body)
    SELECT id, revision, title, body FROM remember_notes ON CONFLICT DO NOTHING`);
}
