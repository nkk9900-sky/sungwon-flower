-- orders 테이블에 요청부서, 배송 세부 주소, 보내는 분 컬럼 추가
-- Supabase SQL Editor에서 Run 실행

ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS request_department TEXT;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS delivery_detail_address TEXT;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS sender TEXT;

COMMENT ON COLUMN public.orders.request_department IS '요청부서';
COMMENT ON COLUMN public.orders.delivery_detail_address IS '배송 세부 주소';
COMMENT ON COLUMN public.orders.sender IS '보내는 분';
