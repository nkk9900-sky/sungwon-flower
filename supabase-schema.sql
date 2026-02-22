-- ============================================
-- 성원플라워 관리 대시보드 - Supabase 스키마
-- ============================================
-- Supabase 대시보드 > SQL Editor에서 실행
-- ============================================

-- 1. wallets (한플라워 / 베스트플라워 잔액)
CREATE TABLE IF NOT EXISTS public.wallets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  balance NUMERIC(15,2) DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO public.wallets (name, balance) VALUES
  ('한플라워', 0),
  ('베스트플라워', 0)
ON CONFLICT (name) DO NOTHING;

-- 2. orders (거래 내역)
CREATE TABLE IF NOT EXISTS public.orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  date DATE NOT NULL,
  client TEXT,
  branch TEXT,
  item TEXT,
  recipient TEXT,
  provider TEXT,
  partner TEXT,
  location TEXT,
  region TEXT,
  price NUMERIC(15,2),
  cost NUMERIC(15,2),
  profit NUMERIC(15,2),
  notes TEXT,
  quantity INTEGER DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_orders_date ON public.orders(date);
CREATE INDEX IF NOT EXISTS idx_orders_provider ON public.orders(provider);

COMMENT ON TABLE public.orders IS '거래 내역: date=배송일, client=거래처, branch=지점명, item=품목, recipient=받는이, provider=발주처, partner=수주화원, location=발송장소, region=지역, price=판매가, cost=발주가, profit=수익, notes=특이사항';

-- RLS
ALTER TABLE public.wallets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow service_role" ON public.wallets;
DROP POLICY IF EXISTS "Allow service_role" ON public.orders;
DROP POLICY IF EXISTS "Allow authenticated" ON public.wallets;
DROP POLICY IF EXISTS "Allow authenticated" ON public.orders;

CREATE POLICY "Allow service_role" ON public.wallets FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Allow service_role" ON public.orders FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Allow authenticated" ON public.wallets FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Allow authenticated" ON public.orders FOR ALL TO authenticated USING (true) WITH CHECK (true);
