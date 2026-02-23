-- 발송장소 통일: 서울성모, 서울성모병원, 서울성모병원장례식장 → 서울성모병원
-- Supabase 대시보드 → SQL Editor → New query → 붙여넣기 → Run

UPDATE public.orders
SET location = '서울성모병원'
WHERE location IN ('서울성모', '서울성모병원', '서울성모병원장례식장');
