-- 매장명 → 거래처(법인명) 매핑 테이블 (계산서 발행용)
-- Supabase SQL Editor에서 실행 후, 매장명/거래처 데이터를 입력하세요.

-- 테이블 생성
CREATE TABLE IF NOT EXISTS public.store_client_map (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_name text NOT NULL,
  client_name text NOT NULL,
  created_at timestamptz DEFAULT now()
);

-- RLS 정책 (anon으로 조회 허용)
ALTER TABLE public.store_client_map ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "store_client_map_select" ON public.store_client_map;
CREATE POLICY "store_client_map_select"
  ON public.store_client_map FOR SELECT
  TO anon, authenticated
  USING (true);

-- 예시: 법인명·매장명 데이터 입력 (이미지 기준)
-- INSERT INTO public.store_client_map (store_name, client_name) VALUES
--   ('방이삿뽀로', '㈜엔타스'),
--   ('오산칠리스', '㈜엔타스'),
--   ('수원경복궁', '㈜엔타스'),
--   ('선한정식', '㈜퍼시픽 스타'),
--   ('한옥경복궁', '㈜엔타스 에스디'),
--   ... (엑셀에서 복사 후 VALUES 형식으로 붙여넣기);

COMMENT ON TABLE public.store_client_map IS '매장명 입력 시 거래처(법인명) 자동 입력용';
