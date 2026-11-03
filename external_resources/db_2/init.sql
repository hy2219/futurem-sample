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

CREATE TABLE private.change_requests (
  change_id text PRIMARY KEY,
  asset_id text NOT NULL,
  team_id text NOT NULL,
  title text NOT NULL,
  status text NOT NULL CHECK (status IN ('requested', 'approved', 'completed')),
  risk text NOT NULL CHECK (risk IN ('high', 'medium', 'low')),
  planned_date text NOT NULL,
  internal_note text NOT NULL
);
INSERT INTO private.change_requests VALUES
  ('CHG-001', 'AST-001', 'TEAM-QUALITY', '가상 분석 기준표 갱신', 'requested', 'medium', '2026-11-07', 'Synthetic internal note, never exposed'),
  ('CHG-002', 'AST-002', 'TEAM-PRODUCTION', '가상 생산 집계 배치 조정', 'approved', 'high', '2026-11-08', 'Synthetic internal note, never exposed'),
  ('CHG-003', 'AST-003', 'TEAM-MATERIALS', '가상 창고 조회 인덱스 점검', 'approved', 'low', '2026-11-09', 'Synthetic internal note, never exposed'),
  ('CHG-004', 'AST-001', 'TEAM-QUALITY', '가상 분석 보고서 문구 정비', 'completed', 'low', '2026-10-30', 'Synthetic internal note, never exposed');

CREATE VIEW workshop.change_request_summary AS
  SELECT change_id, asset_id, team_id, title, status, risk, planned_date FROM private.change_requests;
GRANT SELECT ON workshop.change_request_summary TO demo_reader;
