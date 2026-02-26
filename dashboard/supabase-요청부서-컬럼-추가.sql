-- ============================================================
-- 요청부서( request_department ) 칸이 DB에 없을 때
-- Supabase 대시보드 → SQL Editor → New query → 전체 붙여넣기 → Run
-- ============================================================

-- orders 테이블에 요청부서 칸 추가
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS request_department TEXT;

-- (이미 한번에-적용.sql 실행하셨으면 권한은 그대로입니다. 저장이 안 되면 그쪽도 다시 실행해 보세요.)
