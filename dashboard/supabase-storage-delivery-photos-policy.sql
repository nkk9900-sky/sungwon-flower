-- delivery-photos 버킷: anon 업로드/조회 허용 (평점·배송사진 저장 후 사라지는 문제 해결용)
-- Supabase 대시보드 → SQL Editor → 이 내용 붙여넣기 → Run

DROP POLICY IF EXISTS "delivery-photos anon upload" ON storage.objects;
DROP POLICY IF EXISTS "delivery-photos anon read" ON storage.objects;

CREATE POLICY "delivery-photos anon upload"
ON storage.objects FOR INSERT TO anon
WITH CHECK (bucket_id = 'delivery-photos');

CREATE POLICY "delivery-photos anon read"
ON storage.objects FOR SELECT TO anon
USING (bucket_id = 'delivery-photos');
