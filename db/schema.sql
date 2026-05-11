-- ═══════════════════════════════════════════════════════════
-- Pipeline Executive Dashboard — Neon PostgreSQL Schema
-- วิธีใช้: วาง SQL นี้ใน Neon SQL Editor แล้วกด Run
-- ═══════════════════════════════════════════════════════════

-- Sessions (express-session + connect-pg-simple)
CREATE TABLE IF NOT EXISTS session (
  sid    VARCHAR(255)  NOT NULL COLLATE "default",
  sess   JSON          NOT NULL,
  expire TIMESTAMP(6)  NOT NULL,
  CONSTRAINT session_pkey PRIMARY KEY (sid)
);
CREATE INDEX IF NOT EXISTS idx_session_expire ON session (expire);

-- Users (username + password login)
CREATE TABLE IF NOT EXISTS users (
  id            SERIAL       PRIMARY KEY,
  username      VARCHAR(100) UNIQUE NOT NULL,
  display_name  VARCHAR(200),
  email         VARCHAR(200) UNIQUE,
  password_hash TEXT         NOT NULL,
  role          VARCHAR(20)  NOT NULL DEFAULT 'viewer',
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- Projects / Pipeline Items
CREATE TABLE IF NOT EXISTS projects (
  id          SERIAL       PRIMARY KEY,
  name        VARCHAR(200) NOT NULL,
  description TEXT,
  status      VARCHAR(20)  NOT NULL DEFAULT 'dev',
  progress    INTEGER      NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
  priority    VARCHAR(20)  NOT NULL DEFAULT 'medium',
  owner_name  VARCHAR(100),
  due_date    DATE,
  tags        TEXT[]       DEFAULT '{}',
  created_by  INTEGER      REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- Activity Log
CREATE TABLE IF NOT EXISTS activity_log (
  id         SERIAL       PRIMARY KEY,
  project_id INTEGER      REFERENCES projects(id) ON DELETE CASCADE,
  user_id    INTEGER      REFERENCES users(id) ON DELETE SET NULL,
  username   VARCHAR(100),
  action     VARCHAR(100) NOT NULL,
  old_value  TEXT,
  new_value  TEXT,
  created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_activity_created ON activity_log (created_at DESC);

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_users_updated_at    ON users;
DROP TRIGGER IF EXISTS trg_projects_updated_at ON projects;
CREATE TRIGGER trg_users_updated_at
  BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_projects_updated_at
  BEFORE UPDATE ON projects FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ─── Seed: Sample projects ────────────────────────────────────
INSERT INTO projects (name, description, status, progress, priority, owner_name, due_date)
VALUES
  ('Alpha',   'Core API redesign',       'deploy', 85,  'high',   'Prae', CURRENT_DATE + 5),
  ('Beta',    'Mobile app v2',           'qa',     60,  'high',   'Nack', CURRENT_DATE + 10),
  ('Gamma',   'Analytics dashboard',     'dev',    30,  'medium', 'Ton',  CURRENT_DATE + 22),
  ('Delta',   'Auth system upgrade',     'done',   100, 'high',   'Aim',  CURRENT_DATE - 5),
  ('Epsilon', 'Legacy migration',        'delay',  45,  'low',    'Boom', CURRENT_DATE - 3),
  ('Zeta',    'Payment integration',     'qa',     70,  'medium', 'Fah',  CURRENT_DATE + 15),
  ('Eta',     'CI/CD pipeline setup',    'dev',    20,  'medium', 'Karn', CURRENT_DATE + 30),
  ('Theta',   'Security audit fixes',    'done',   100, 'high',   'Mind', CURRENT_DATE - 8)
ON CONFLICT DO NOTHING;
