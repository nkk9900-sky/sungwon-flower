-- orders 테이블에 지역(region) 컬럼 추가
-- Supabase 대시보드 > SQL Editor에서 한 번 실행하세요.

ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS region TEXT;

COMMENT ON COLUMN public.orders.region IS '지역';
