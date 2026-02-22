# 성원플라워 관리 대시보드

## 1. DB 설계 및 생성 (Supabase)

1. [Supabase](https://supabase.com) 프로젝트에서 **SQL Editor** 열기
2. `supabase-schema.sql` 내용 전체 복사 후 실행

생성되는 테이블:
- **orders**: date(배송일), client(거래처), branch(지점명), item(품목), recipient(받는이), provider(발주처), partner(수주화원), location(발송장소), price(판매가), cost(발주가), profit(수익), notes(특이사항)
- **wallets**: 한플라워 / 베스트플라워 잔액

## 2. 데이터 마이그레이션 (CSV → orders)

1. 프로젝트 루트에 `.env` 생성 (또는 환경 변수 설정)
   ```
   SUPABASE_URL=https://xxx.supabase.co
   SUPABASE_SERVICE_KEY=서비스롤키
   ```
2. **프로젝트 폴더에서** 의존성 설치 및 실행
   ```bash
   cd "G:\내 드라이브\성원플라워"
   pip install -r requirements.txt
   python scripts/migrate_csv_to_orders.py
   ```
3. CSV 인코딩: 스크립트가 **cp949** 우선 시도 후 utf-8로 읽습니다. 숫자 필드(판매가, 발주가, 수익)의 콤마는 제거 후 숫자로 저장됩니다.

### CSV ↔ DB 컬럼 매핑

| CSV 한글 컬럼 | DB 컬럼 |
|---------------|---------|
| 연도 + 월 + 배송일 | date |
| 거래처 | client |
| 지점명 | branch |
| 품목 | item |
| 받는이 | recipient |
| 발주처 | provider |
| 수주화원 | partner |
| 발송장소 | location |
| 판매가 | price |
| 발주가 | cost |
| 수익 | profit |
| 특이사항 | notes |
| 수량 | quantity |

## 3. 대시보드 실행

1. `dashboard/` 폴더로 이동
2. `dashboard/.env` 생성
   ```
   VITE_SUPABASE_URL=https://xxx.supabase.co
   VITE_SUPABASE_ANON_KEY=anon키
   ```
3. 설치 및 실행
   ```bash
   cd dashboard
   npm install
   npm run dev
   ```
4. 브라우저에서 상단 **이번 달 매출/수익/주문수** 카드와 **날짜별 조회 테이블** 확인
