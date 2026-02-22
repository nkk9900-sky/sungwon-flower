-- orders 테이블 RLS 정책: 주문 등록/조회/수정 허용
-- Supabase 대시보드 → SQL Editor → New query → 이 내용 붙여넣기 → Run

DROP POLICY IF EXISTS "orders_select" ON orders;
DROP POLICY IF EXISTS "orders_insert" ON orders;
DROP POLICY IF EXISTS "orders_update" ON orders;

-- 조회 허용
CREATE POLICY "orders_select"
ON orders FOR SELECT
TO anon, authenticated
USING (true);

-- 추가(등록) 허용
CREATE POLICY "orders_insert"
ON orders FOR INSERT
TO anon, authenticated
WITH CHECK (true);

-- 수정 허용
CREATE POLICY "orders_update"
ON orders FOR UPDATE
TO anon, authenticated
USING (true)
WITH CHECK (true);
