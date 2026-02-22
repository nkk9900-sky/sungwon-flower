-- ============================================================
-- 평점·배송사진 저장 후 orders에 변화 없음 → 칸 없음 + 권한 한번에 적용
-- Supabase 대시보드 → SQL Editor → New query → 전체 붙여넣기 → Run
-- ============================================================

-- 0) orders 테이블에 평점·사유·배송사진 칸이 없으면 추가 (필수!)
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS partner_rating NUMERIC;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS partner_reason TEXT;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS delivery_photo TEXT;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS delivery_photo_2 TEXT;

-- 1) public 스키마 사용 권한 + orders 테이블 모든 권한 (anon이 수정 가능하도록)
GRANT USAGE ON SCHEMA public TO anon;
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT ALL ON public.orders TO anon;
GRANT ALL ON public.orders TO authenticated;

-- 1) orders 테이블: RLS 켜기 + 조회/등록/수정 허용 (anon으로 저장 가능)
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "orders_select" ON public.orders;
DROP POLICY IF EXISTS "orders_insert" ON public.orders;
DROP POLICY IF EXISTS "orders_update" ON public.orders;

CREATE POLICY "orders_select" ON public.orders FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "orders_insert" ON public.orders FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "orders_update" ON public.orders FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);

-- 2) delivery-photos 버킷: anon이 사진 업로드·조회 가능
DROP POLICY IF EXISTS "delivery-photos anon upload" ON storage.objects;
DROP POLICY IF EXISTS "delivery-photos anon read" ON storage.objects;

CREATE POLICY "delivery-photos anon upload"
ON storage.objects FOR INSERT TO anon WITH CHECK (bucket_id = 'delivery-photos');

CREATE POLICY "delivery-photos anon read"
ON storage.objects FOR SELECT TO anon USING (bucket_id = 'delivery-photos');
