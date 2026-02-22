-- 주문자, 연락처 컬럼 추가 (같은 매장 시 이전 입력 불러오기용)
-- Supabase SQL Editor에서 Run 실행

ALTER TABLE orders
ADD COLUMN IF NOT EXISTS orderer_name TEXT,
ADD COLUMN IF NOT EXISTS orderer_phone TEXT;

COMMENT ON COLUMN orders.orderer_name IS '주문자 이름';
COMMENT ON COLUMN orders.orderer_phone IS '주문자 연락처';
