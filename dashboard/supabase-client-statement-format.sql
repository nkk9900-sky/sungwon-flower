-- 거래처별 거래명세서 양식 매핑 (회사마다 양식이 다를 때 사용)
-- Supabase SQL Editor에서 실행하세요.

CREATE TABLE IF NOT EXISTS public.client_statement_format (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_name text NOT NULL UNIQUE,
  format_key text NOT NULL DEFAULT 'default',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE public.client_statement_format ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "client_statement_format_select" ON public.client_statement_format;
DROP POLICY IF EXISTS "client_statement_format_all" ON public.client_statement_format;
CREATE POLICY "client_statement_format_select" ON public.client_statement_format FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "client_statement_format_all" ON public.client_statement_format FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "client_statement_format_all_service" ON public.client_statement_format FOR ALL TO service_role USING (true) WITH CHECK (true);

COMMENT ON TABLE public.client_statement_format IS '거래처별 거래명세서 양식: format_key = default | format_2 | format_3 등';
