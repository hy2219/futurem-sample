\getenv reader_password PG_READER_PASSWORD

CREATE SCHEMA private;
CREATE SCHEMA workshop;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
REVOKE ALL ON SCHEMA private FROM PUBLIC;
CREATE ROLE demo_reader LOGIN PASSWORD :'reader_password'
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;
REVOKE ALL ON DATABASE workshop FROM PUBLIC;
GRANT CONNECT ON DATABASE workshop TO demo_reader;
GRANT USAGE ON SCHEMA workshop TO demo_reader;

CREATE TABLE private.it_assets (
  asset_id text PRIMARY KEY,
  name text NOT NULL,
  system_type text NOT NULL,
  site text NOT NULL,
  status text NOT NULL CHECK (status IN ('operational', 'maintenance', 'retired')),
  criticality text NOT NULL CHECK (criticality IN ('high', 'medium', 'low')),
  team_id text NOT NULL,
  internal_note text NOT NULL
);
INSERT INTO private.it_assets VALUES
  ('AST-001', '가상 품질분석 시스템', 'quality-analysis', '가상 새봄공장', 'operational', 'high', 'TEAM-QUALITY', 'Synthetic internal note, never exposed'),
  ('AST-002', '가상 생산실적 시스템', 'production-reporting', '가상 새봄공장', 'operational', 'high', 'TEAM-PRODUCTION', 'Synthetic internal note, never exposed'),
  ('AST-003', '가상 창고관리 시스템', 'warehouse', '가상 은빛물류센터', 'maintenance', 'medium', 'TEAM-MATERIALS', 'Synthetic internal note, never exposed'),
  ('AST-004', '가상 품질분석 보조 시스템', 'quality-analysis', '가상 은빛연구동', 'operational', 'low', 'TEAM-QUALITY', 'Synthetic internal note, never exposed');

CREATE VIEW workshop.asset_summary AS
  SELECT asset_id, name, system_type, site, status, criticality, team_id FROM private.it_assets;
GRANT SELECT ON workshop.asset_summary TO demo_reader;
