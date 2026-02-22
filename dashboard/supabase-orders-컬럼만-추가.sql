-- 1) 이 4줄만 복사해서 Supabase SQL Editor에 붙여넣고 Run (컬럼만 추가)
-- orders 테이블이 있는 "지금 쓰는 그 프로젝트"에서 실행하세요.

ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS partner_rating NUMERIC;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS partner_reason TEXT;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS delivery_photo TEXT;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS delivery_photo_2 TEXT;
