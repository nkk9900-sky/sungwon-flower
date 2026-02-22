# CSV header inspection - run once to get column index mapping
import csv
import os
path = os.path.join(os.path.dirname(__file__), '..', '거래내역서', '거래내역서 커서용.csv')
for enc in ['cp949', 'utf-8', 'utf-8-sig']:
    try:
        with open(path, 'r', encoding=enc) as f:
            r = csv.reader(f)
            h = next(r)
            print('Encoding:', enc)
            for i, x in enumerate(h):
                if i < 25: print(i, repr(x.strip()))
            row = next(r)
            print('First row len:', len(row))
            for i in range(min(20, len(row))):
                print(i, repr(row[i][:50] if row[i] else ''))
        break
    except Exception as e:
        print(enc, str(e))
