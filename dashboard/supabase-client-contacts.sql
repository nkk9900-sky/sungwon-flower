-- 거래처 담당자 정보 (담당자 이름, 부서명, 연락처, 메일)
-- 저장 시 "client_contacts 테이블이 없습니다" 오류가 나면
-- Supabase 대시보드 → SQL Editor 열고 → 아래 전체를 붙여넣기 후 Run 실행하세요.

CREATE TABLE IF NOT EXISTS public.client_contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_name text NOT NULL UNIQUE,
  contact_name text,
  department text,
  phone text,
  email text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE public.client_contacts ADD COLUMN IF NOT EXISTS department text;

ALTER TABLE public.client_contacts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "client_contacts_select" ON public.client_contacts;
DROP POLICY IF EXISTS "client_contacts_all" ON public.client_contacts;
DROP POLICY IF EXISTS "client_contacts_anon_insert_update" ON public.client_contacts;
DROP POLICY IF EXISTS "client_contacts_service" ON public.client_contacts;
CREATE POLICY "client_contacts_select" ON public.client_contacts FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "client_contacts_all" ON public.client_contacts FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "client_contacts_anon_insert_update" ON public.client_contacts FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "client_contacts_service" ON public.client_contacts FOR ALL TO service_role USING (true) WITH CHECK (true);

COMMENT ON TABLE public.client_contacts IS '거래처별 담당자 이름, 연락처, 메일 주소';
