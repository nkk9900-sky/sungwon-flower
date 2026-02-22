-- orders 테이블에 트리거가 있으면 저장 후 값이 지워질 수 있음
-- Supabase SQL Editor에서 Run → 결과에 트리거가 나오면 원인일 수 있음

SELECT trigger_name, event_manipulation, action_statement
FROM information_schema.triggers
WHERE event_object_table = 'orders';
