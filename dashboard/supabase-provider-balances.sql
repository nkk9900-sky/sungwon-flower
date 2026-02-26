-- 플랫폼별 충전 잔액 (한플라워·베스트플라워 등)
-- 충전·월이용료 차감 시 대시보드에서 수정하고, 발주가 차감 후 잔여포인트를 표시합니다.

CREATE TABLE IF NOT EXISTS public.provider_balances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_name text NOT NULL UNIQUE,
  balance numeric NOT NULL DEFAULT 0,
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE public.provider_balances ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "provider_balances_select" ON public.provider_balances;
CREATE POLICY "provider_balances_select"
  ON public.provider_balances FOR SELECT
  TO anon, authenticated
  USING (true);

DROP POLICY IF EXISTS "provider_balances_update" ON public.provider_balances;
CREATE POLICY "provider_balances_update"
  ON public.provider_balances FOR UPDATE
  TO anon, authenticated
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "provider_balances_insert" ON public.provider_balances;
CREATE POLICY "provider_balances_insert"
  ON public.provider_balances FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

-- 초기 데이터 (충전 잔액은 대시보드에서 수정 가능)
INSERT INTO public.provider_balances (provider_name, balance) VALUES
  ('한플라워', 1424000),
  ('베스트플라워', 90000)
ON CONFLICT (provider_name) DO NOTHING;

COMMENT ON TABLE public.provider_balances IS '플랫폼별 충전 잔액. 충전/월이용료 차감 시 수정';
