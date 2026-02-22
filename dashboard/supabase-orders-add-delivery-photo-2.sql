-- orders 테이블에 배송사진 2번 컬럼 추가 (사진 2장 업로드용)
-- Supabase 대시보드 > SQL Editor에서 한 번 실행하세요.

ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS delivery_photo_2 TEXT;

COMMENT ON COLUMN public.orders.delivery_photo_2 IS '배송사진 2';
