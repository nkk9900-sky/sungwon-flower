# -*- coding: utf-8 -*-
"""
거래내역서 CSV -> Supabase orders 테이블 마이그레이션
인코딩: cp949 우선, 실패 시 utf-8. 숫자 콤마 제거 후 저장.
사용: python scripts/migrate_csv_to_orders.py
     python scripts/migrate_csv_to_orders.py --file "거래내역서/data.csv"
"""
import os
import re
import sys
import csv
from datetime import datetime
from decimal import Decimal, InvalidOperation

# CSV 한글 컬럼명 -> DB 영문 컬럼명 매핑
CSV_TO_DB = {
    '번호': '_row_no',
    '연도': 'year',
    '월': 'month',
    '거래처': 'client',
    '배송일': 'date_str',
    '일자': 'date_str',
    '발주처': 'provider',
    '수주화원': 'partner',
    '평점': 'rating',
    '사유': 'reason',
    '발송장소': 'location',
    '지점명': 'branch',
    '받는이': 'recipient',
    '품목': 'item',
    '특이사항': 'notes',
    '수량': 'quantity',
    '판매가': 'price',
    '발주가': 'cost',
    '수익': 'profit',
}

def detect_encoding(path):
    for enc in ('cp949', 'utf-8-sig', 'utf-8'):
        try:
            with open(path, 'r', encoding=enc) as f:
                f.read(1)
            return enc
        except (UnicodeDecodeError, UnicodeError):
            continue
    return 'cp949'

def strip_num(s):
    if not s or not isinstance(s, str):
        return None
    raw = s.strip()
    negative = raw.startswith('(') and raw.endswith(')')
    s = raw.replace(',', '').replace(' ', '')
    s = re.sub(r'[\(\)]', '', s)
    if not s or s == '-':
        return None
    try:
        v = float(s)
        return -v if negative else v
    except ValueError:
        return None

def parse_date(year_val, month_val, date_str):
    try:
        s = (date_str or '').strip()
        # 날짜가 "YYYY-MM-DD" / "YYYY/MM/DD" 형태면 그대로 파싱
        if re.match(r'^\d{4}[-/]\d{1,2}[-/]\d{1,2}', s):
            parts = re.split(r'[/\-]', s)
            if len(parts) >= 3:
                return datetime(int(parts[0]), int(parts[1]), int(parts[2])).date()
        y = int(year_val) if year_val else None
        m = int(month_val) if month_val else None
        if not y or not m:
            return None
        if not s:
            return None
        parts = re.split(r'[/\-\.]', s)
        if len(parts) >= 2:
            d = int(parts[1])
        elif len(parts) == 1:
            d = int(parts[0])
        else:
            return None
        return datetime(y, m, d).date()
    except (ValueError, TypeError):
        return None

def clean_str(s):
    if s is None:
        return None
    t = (s if isinstance(s, str) else str(s)).strip()
    return t if t else None

def main():
    base = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    # --file 인자 지원 (예: --file "거래내역서/data.csv")
    csv_path = None
    for i, arg in enumerate(sys.argv):
        if arg == '--file' and i + 1 < len(sys.argv):
            csv_path = os.path.join(base, sys.argv[i + 1].replace('/', os.sep))
            break
    if not csv_path or not os.path.exists(csv_path):
        if not csv_path:
            # 기본 후보 경로 순서대로 시도 (거래내역서 폴더 → 프로젝트 루트)
            for name in ('거래내역서 커서용.csv', 'data.csv', '거래내역서 합계.csv'):
                candidate = os.path.join(base, '거래내역서', name)
                if os.path.exists(candidate):
                    csv_path = candidate
                    break
            if not csv_path:
                if os.path.exists(os.path.join(base, 'data.csv')):
                    csv_path = os.path.join(base, 'data.csv')
                else:
                    csv_path = os.path.join(base, '거래내역서', '거래내역서 커서용.csv')
        if not os.path.exists(csv_path):
            print('CSV not found:', csv_path)
            print('Usage: python scripts/migrate_csv_to_orders.py [--file "거래내역서/data.csv"]')
            return

    print('Using CSV:', csv_path)
    enc = detect_encoding(csv_path)
    print('Using encoding:', enc)

    rows_data = []
    with open(csv_path, 'r', encoding=enc) as f:
        r = csv.reader(f)
        header = [h.strip() for h in next(r)]
        # BOM 등 첫 셀 앞 공백 제거
        if header and header[0].startswith('\ufeff'):
            header[0] = header[0].lstrip('\ufeff')
        col_idx = {}
        for i, h in enumerate(header):
            h_clean = (h or '').strip().lstrip('\ufeff')
            if h_clean in CSV_TO_DB:
                col_idx[CSV_TO_DB[h_clean]] = i
            if h_clean == '거래처':
                col_idx['client'] = i
            if h_clean in ('배송일', '일자'):
                col_idx['date_str'] = i
            if h_clean == '연도':
                col_idx['year'] = i
            if h_clean == '월':
                col_idx['month'] = i
            if h_clean == '발주처':
                col_idx['provider'] = i
            if h_clean == '수주화원':
                col_idx['partner'] = i
            if h_clean == '발송장소':
                col_idx['location'] = i
            if h_clean == '지점명':
                col_idx['branch'] = i
            if h_clean == '특이사항':
                col_idx['notes'] = i
            if h_clean == '수량':
                col_idx['quantity'] = i
            if h_clean == '판매가':
                col_idx['price'] = i
            if h_clean == '발주가':
                col_idx['cost'] = i
            if h_clean == '수익':
                col_idx['profit'] = i
            if h_clean == '받는이':
                col_idx['recipient'] = i
            if h_clean == '품목':
                col_idx['item'] = i

        if 'client' not in col_idx or 'date_str' not in col_idx:
            col_idx = {
                'year': 1, 'month': 2, 'client': 3, 'date_str': 4, 'provider': 5,
                'partner': 6, 'item': 7, 'recipient': 8, 'notes': 9,
                'branch': 10, 'location': 10, 'quantity': 12, 'price': 13, 'cost': 14, 'profit': 15,
            }
            print('Using default column order (연도,월,거래처,배송일,... → 1,2,3,4,...)')

        debug = '--debug' in sys.argv
        if debug:
            print('Header:', header[:16])
            print('col_idx:', col_idx)

        for row in r:
            if len(row) < 14:
                if debug and len(rows_data) < 2:
                    print('Skip (len<14):', len(row), row[:8])
                continue

            def get(k, default=''):
                i = col_idx.get(k)
                if i is None or i >= len(row):
                    return default
                return (row[i] or '').strip() or default

            year_val = get('year')
            month_val = get('month')
            date_str_val = get('date_str')
            dt = parse_date(year_val, month_val, date_str_val)
            if not dt:
                if debug and len(rows_data) < 2:
                    print('Skip (no date):', repr(year_val), repr(month_val), repr(date_str_val), '→ parse_date failed')
                continue

            price_val = strip_num(get('price'))
            cost_val = strip_num(get('cost'))
            profit_val = strip_num(get('profit'))
            if price_val is None and cost_val is None and profit_val is None:
                if debug and len(rows_data) < 2:
                    print('Skip (no price/cost/profit):', repr(get('price')), repr(get('cost')), repr(get('profit')))
                continue

            qty_val = strip_num(get('quantity'))
            if qty_val is not None and int(qty_val) == qty_val:
                qty = int(qty_val)
            else:
                qty = 1

            rows_data.append({
                'date': dt.isoformat(),
                'client': clean_str(get('client')),
                'branch': clean_str(get('branch')),
                'item': clean_str(get('item')),
                'recipient': clean_str(get('recipient')),
                'provider': clean_str(get('provider')),
                'partner': clean_str(get('partner')),
                'location': clean_str(get('location')),
                'price': price_val,
                'cost': cost_val,
                'profit': profit_val,
                'notes': clean_str(get('notes')),
                'quantity': qty,
            })

    print('Parsed rows:', len(rows_data))
    if not rows_data:
        print('No data to insert. Check CSV columns.')
        return

    try:
        from supabase import create_client
        url = os.environ.get('SUPABASE_URL')
        key = os.environ.get('SUPABASE_SERVICE_KEY') or os.environ.get('SUPABASE_KEY')
        if not url or not key:
            print('Set SUPABASE_URL and SUPABASE_SERVICE_KEY (or SUPABASE_KEY) in .env or environment.')
            print('Sample .env:')
            print('  SUPABASE_URL=https://xxx.supabase.co')
            print('  SUPABASE_SERVICE_KEY=eyJ...')
            with open(os.path.join(base, 'orders_sample.json'), 'w', encoding='utf-8') as f:
                import json
                json.dump(rows_data[:5], f, ensure_ascii=False, indent=2)
            print('Wrote orders_sample.json (first 5 rows). Run again after setting env.')
            return

        supabase = create_client(url, key)
        BATCH = 100
        inserted = 0
        for i in range(0, len(rows_data), BATCH):
            batch = rows_data[i:i+BATCH]
            supabase.table('orders').insert(batch).execute()
            inserted += len(batch)
            print('Inserted', inserted, '/', len(rows_data))

        print('Done. Total inserted:', inserted)

        result = supabase.table('orders').select('id, date, client, price, profit', count='exact').order('date', desc=True).limit(5).execute()
        print('Verify (latest 5):', result.data)
        count_result = supabase.table('orders').select('*', count='exact', head=True).execute()
        print('Total count:', count_result.count)
    except ImportError:
        print('Install: pip install supabase')
        with open(os.path.join(base, 'orders_export.json'), 'w', encoding='utf-8') as f:
            import json
            json.dump(rows_data, f, ensure_ascii=False, indent=2)
        print('Saved orders_export.json. Install supabase and set env to upload.')
    except Exception as e:
        print('Error:', e)
        raise

if __name__ == '__main__':
    main()
