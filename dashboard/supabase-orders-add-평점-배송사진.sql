-- orders 테이블에 평점·사유·배송사진 컬럼 추가 (없으면 생성)
-- Supabase SQL Editor에서 Run 한 번 실행하세요.

ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS partner_rating NUMERIC;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS partner_reason TEXT;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS delivery_photo TEXT;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS delivery_photo_2 TEXT;

COMMENT ON COLUMN public.orders.partner_rating IS '수주화원 평점';
COMMENT ON COLUMN public.orders.partner_reason IS '평점 사유';
COMMENT ON COLUMN public.orders.delivery_photo IS '배송사진 URL 1';
COMMENT ON COLUMN public.orders.delivery_photo_2 IS '배송사진 URL 2';
