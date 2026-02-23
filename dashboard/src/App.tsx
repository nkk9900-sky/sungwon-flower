import { useEffect, useMemo, useRef, useState } from 'react'
import imageCompression from 'browser-image-compression'
import * as XLSX from 'xlsx'
import { supabase, type Order } from './supabase'
import { type ExportFormatType, filterGeneralFormatClients, ENTAS_STATEMENT_CLIENTS } from './statement-formats'

const ENTAS_CLIENT_SET = new Set(ENTAS_STATEMENT_CLIENTS as readonly string[])

const CHOSUNG = 'ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ'

/** 노랑풍선 명세서: 상품명 규칙 (계획서 5) */
function yellowBalloonProductName(o: Order): string {
  const item = (o.item ?? '').toLowerCase()
  const notes = (o.notes ?? '').toLowerCase()
  const loc = (o.location ?? '').toLowerCase()
  if (item.includes('결혼') || notes.includes('결혼')) return '결혼화환'
  if (loc.includes('장례') || loc.includes('장례식장')) return '근조화환'
  return ''
}

/** 노랑풍선 템플릿(norang_template.xlsx) 불러와서 해당 월 시트에 주문 채운 뒤 Blob 반환. 템플릿은 public/norang_template.xlsx 에 두세요. */
async function fillYellowBalloonTemplate(orders: Order[], dateFrom: string, dateTo: string): Promise<Blob> {
  const res = await fetch('/norang_template.xlsx')
  if (!res.ok) throw new Error('템플릿을 불러올 수 없습니다. dashboard/public 폴더에 norang_template.xlsx를 넣어 주세요.')
  const ab = await res.arrayBuffer()
  const wb = XLSX.read(ab, { type: 'array' })
  const month = parseInt(dateFrom.slice(5, 7), 10)
  const sheetName = `${month}월`
  if (!wb.SheetNames.includes(sheetName)) throw new Error(`템플릿에 '${sheetName}' 시트가 없습니다.`)
  const ws = wb.Sheets[sheetName]!

  const isExecutive = (o: Order) => (o.branch ?? '').includes('노랑풍선') || (o.client ?? '').includes('노랑풍선')
  const 거래처List = orders.filter((o) => !isExecutive(o)).slice(0, 21)
  const 임직원List = orders.filter((o) => isExecutive(o)).slice(0, 5)

  const toRow = (o: Order, no: number, isExec: boolean): (string | number)[] => {
    const price = o.price ?? 0
    const qty = o.quantity ?? 1
    const amount = price * qty
    return [
      '', // 구분
      no,
      o.date ?? '', // 배달일자
      yellowBalloonProductName(o), // 상품명
      '이상훈', // 발주자
      o.location ?? '', // 배송지
      isExec ? '본인결혼' : (o.client ?? ''), // 거래처명 또는 사유
      o.request_department ?? '', // 요청팀
      o.recipient ?? '', // 수령인
      amount, // 금액
      '', // 비고(넣지 않음)
    ]
  }

  const 거래처Rows = 거래처List.map((o, i) => toRow(o, i + 1, false))
  while (거래처Rows.length < 21) 거래처Rows.push(['', '', '', '', '', '', '', '', '', '', ''])
  const 임직원Rows = 임직원List.map((o, i) => toRow(o, i + 1, true))
  while (임직원Rows.length < 5) 임직원Rows.push(['', '', '', '', '', '', '', '', '', '', ''])

  // 시트를 배열로 읽어서 해당 행만 덮어쓰고 다시 시트로 넣기
  const arr = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' }) as (string | number)[][]
  while (arr.length < 32) arr.push([])
  for (let i = 0; i < 21; i++) arr[3 + i] = [...거래처Rows[i]]
  for (let i = 0; i < 5; i++) arr[26 + i] = [...임직원Rows[i]]
  // 채움 표시 (코드 실행 여부 확인용)
  if (arr[0]) arr[0][0] = `성원플라워 채움 (${orders.length}건)`
  else arr[0] = [`성원플라워 채움 (${orders.length}건)`]
  const newWs = XLSX.utils.aoa_to_sheet(arr)
  wb.Sheets[sheetName] = newWs
  // 채운 시트를 맨 앞으로 (열면 해당 월이 보이게)
  wb.SheetNames = [sheetName, ...wb.SheetNames.filter((s) => s !== sheetName)]

  const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' })
  return new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
}

/** 배송사진 업로드 전 브라우저에서 압축 (저장 공간·비용 절감) */
async function compressImageForUpload(file: File): Promise<File> {
  try {
    const options = { maxSizeMB: 1, maxWidthOrHeight: 1024, useWebWorker: true }
    const compressed = await imageCompression(file, options)
    return compressed as File
  } catch {
    return file
  }
}

function getChosung(str: string): string {
  if (!str) return ''
  return [...str].map((c) => {
    const code = c.codePointAt(0) ?? 0
    if (code >= 0xac00 && code <= 0xd7a3) {
      const idx = Math.floor((code - 0xac00) / 588)
      return CHOSUNG[idx] ?? c
    }
    return c.toLowerCase()
  }).join('')
}

function formatMoney(n: number | null | undefined) {
  if (n == null) return '-'
  return new Intl.NumberFormat('ko-KR').format(n) + '원'
}

/** 거래명세표 HTML (세부내역서 디자인) 생성. 품목: general=원본 품목, entas="경조 "+지점명 */
function buildStatementHtml(
  list: Order[],
  clientName: string,
  dateLabel: string,
  kind: 'general' | 'entas'
): string {
  const fmtNum = (n: number) => n.toLocaleString('ko-KR')
  const esc = (s: string) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  const requestColumnLabel = kind === 'general' ? '요청부서' : '요청인'
  const rows = list.map((o) => {
    const [y, m, d] = (o.date ?? '').split('-').map(Number)
    const month = m ?? ''
    const day = d ?? ''
    const price = o.price ?? 0
    const qty = o.quantity ?? 1
    const amount = price * qty
    const item = kind === 'entas' ? `경조 ${esc(o.branch ?? '')}`.trim() : esc(o.item ?? '')
    const requestCol = kind === 'general' ? esc(o.request_department ?? '') : esc(o.recipient ?? '')
    return { month, day, item, requestCol, location: esc(o.location ?? ''), qty, supply: price, tax: 0, amount }
  })
  const totalQty = rows.reduce((s, r) => s + r.qty, 0)
  const totalSupply = rows.reduce((s, r) => s + r.supply * r.qty, 0)
  const totalAmount = rows.reduce((s, r) => s + r.amount, 0)
  const rowHtml = rows
    .map(
      (r) =>
        `<tr><td class="col-month num">${r.month}</td><td class="col-day num">${r.day}</td><td class="col-item">${r.item}</td><td class="col-requester">${r.requestCol}</td><td class="col-location">${r.location}</td><td class="col-qty num">${r.qty}</td><td class="col-supply num">${fmtNum(r.supply)}</td><td class="col-tax num">${r.tax}</td><td class="col-amount num">${fmtNum(r.amount)}</td></tr>`
    )
    .join('')
  return `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>거래명세표 - ${esc(clientName)}</title>
  <style>
    * { box-sizing: border-box; }
    body { margin: 0; padding: 48px 24px; font-family: 'Malgun Gothic', '맑은 고딕', sans-serif; font-size: 14px; color: #1a1a1a; line-height: 1.5; background: #f8fafc; }
    .sheet { max-width: 900px; margin: 0 auto; background: #fff; padding: 48px 40px; box-shadow: 0 1px 3px rgba(0,0,0,0.06); border-radius: 2px; }
    .title { text-align: center; font-size: 24px; font-weight: 700; margin: 0 0 32px; color: #0f172a; }
    .meta { margin-bottom: 28px; padding-bottom: 20px; border-bottom: 1px solid #e2e8f0; }
    .meta .date { font-size: 14px; color: #64748b; margin-bottom: 6px; }
    .meta .recipient { font-size: 16px; font-weight: 600; color: #0f172a; }
    table { width: 100%; border-collapse: collapse; font-size: 13px; }
    thead th { padding: 12px 8px; text-align: center; font-weight: 600; font-size: 13px; color: #334155; background: #f1f5f9; border: 1px solid #e2e8f0; border-bottom: 2px solid #cbd5e1; }
    tbody td { padding: 10px 8px; border: 1px solid #e2e8f0; vertical-align: middle; }
    tbody tr:hover { background: #fafafa; }
    .col-month { width: 6%; text-align: center; }
    .col-day { width: 6%; text-align: center; }
    .col-item { width: 9%; text-align: center; padding-left: 6px; padding-right: 6px; }
    .col-requester { width: 14%; padding-left: 10px; }
    .col-location { width: 27%; padding-left: 10px; text-align: center; }
    .col-qty { width: 8%; text-align: center; padding-right: 10px; }
    .col-supply { width: 11%; text-align: right; padding-right: 10px; }
    .col-tax { width: 6%; text-align: right; padding-right: 8px; }
    .col-amount { width: 12%; text-align: right; padding-right: 10px; font-weight: 500; }
    thead th.col-supply, thead th.col-tax, thead th.col-amount { text-align: center; }
    .num { font-variant-numeric: tabular-nums; }
    .total-row td { padding: 12px 8px; font-weight: 700; background: #f8fafc; border-top: 2px solid #cbd5e1; border-bottom: 1px solid #e2e8f0; color: #0f172a; }
    .total-row .col-item { text-align: center; padding-left: 0; }
    .empty-row td { height: 36px; border-color: #e2e8f0; }
    .empty-row:hover { background: transparent; }
    .entas-sheet .col-item { width: 15%; text-align: center; }
    .entas-sheet .col-requester { width: 14%; text-align: center; }
    .entas-sheet .col-location { width: 22%; text-align: center; }
    .entas-sheet .col-qty { text-align: center; }
    @page { size: A4; margin: 15mm; }
    @media print {
      body { background: #fff; padding: 0; margin: 0; font-size: 12pt; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      .sheet { max-width: none; width: 100%; margin: 0; padding: 0; box-shadow: none; border-radius: 0; }
      thead { display: table-header-group; }
      tr { page-break-inside: avoid; }
      tbody tr:hover { background: transparent; }
    }
  </style>
</head>
<body>
  <div class="sheet${kind === 'entas' ? ' entas-sheet' : ''}">
    <h1 class="title">거래명세표</h1>
    <div class="meta">
      <div class="date">${esc(dateLabel)}</div>
      <div class="recipient">${esc(clientName)}</div>
    </div>
    <table>
      <thead>
        <tr>
          <th class="col-month">월</th>
          <th class="col-day">일</th>
          <th class="col-item">품목</th>
          <th class="col-requester">${requestColumnLabel}</th>
          <th class="col-location">발송 장소</th>
          <th class="col-qty">수량</th>
          <th class="col-supply">공급가액</th>
          <th class="col-tax">세액</th>
          <th class="col-amount">금액</th>
        </tr>
      </thead>
      <tbody>
        ${rowHtml}
        <tr class="empty-row"><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td></tr>
        <tr class="total-row">
          <td colspan="5" class="col-item">계</td>
          <td class="col-qty num">${totalQty}</td>
          <td class="col-supply num">${fmtNum(totalSupply)}</td>
          <td class="col-tax num">0</td>
          <td class="col-amount num">${fmtNum(totalAmount)}</td>
        </tr>
      </tbody>
    </table>
  </div>
</body>
</html>`
}

function formatNum(n: number | null | undefined) {
  if (n == null) return '-'
  return new Intl.NumberFormat('ko-KR').format(n)
}

function getTodayISO(): string {
  const n = new Date()
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`
}

/** CSV 한 줄을 따옴표를 고려해 컬럼 배열로 파싱 */
function parseCsvLine(line: string): string[] {
  const out: string[] = []
  let field = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (inQuotes) {
      if (c === '"') inQuotes = false
      else field += c
    } else {
      if (c === '"') inQuotes = true
      else if (c === ',') {
        out.push(field.trim())
        field = ''
      } else field += c
    }
  }
  out.push(field.trim())
  return out
}

/** CSV 숫자 문자열 → 숫자 (쉼표 제거, 괄호는 음수) */
function parseCsvNumber(s: string): number | null {
  const t = (s ?? '').trim().replace(/,/g, '')
  if (!t) return null
  const neg = /^\(.*\)$/.test(t)
  const num = parseInt(t.replace(/[^\d]/g, ''), 10)
  if (Number.isNaN(num)) return null
  return neg ? -num : num
}

/** 배송일 문자열(예: 3/15) + 연도 → YYYY-MM-DD */
function csvDateToIso(yearStr: string, deliveryDateStr: string): string | null {
  const y = parseInt(yearStr.trim(), 10)
  const s = (deliveryDateStr ?? '').trim()
  if (!s || Number.isNaN(y)) return null
  const parts = s.split('/').map((p) => parseInt(p.trim(), 10))
  let month: number
  let day: number
  if (parts.length >= 2) {
    month = parts[0]
    day = parts[1]
  } else if (parts.length === 1) {
    month = 1
    day = parts[0]
  } else return null
  if (Number.isNaN(month) || Number.isNaN(day)) return null
  if (month < 1 || month > 12) return null
  const lastDay = new Date(y, month, 0).getDate()
  if (day < 1 || day > lastDay) day = Math.min(day, lastDay)
  return `${y}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

type CsvOrderRow = {
  date: string
  client: string | null
  branch: string | null
  item: string | null
  recipient: string | null
  provider: string | null
  partner: string | null
  location: string | null
  region: string | null
  notes: string | null
  price: number | null
  cost: number | null
  profit: number | null
  quantity: number | null
}

/** CSV 헤더와 한 행으로 orders 테이블용 객체 생성 (거래내역서 data.csv 형식) */
function csvRowToOrder(headers: string[], cells: string[]): CsvOrderRow | null {
  const get = (name: string) => {
    const i = headers.findIndex((h) => h.trim() === name.trim())
    return i >= 0 ? (cells[i] ?? '').trim() : ''
  }
  const year = get('연도')
  const deliveryDate = get('배송일')
  const date = csvDateToIso(year, deliveryDate)
  if (!date) return null
  const price = parseCsvNumber(get('판매가') || get(' 판매가 '))
  const cost = parseCsvNumber(get('발주가') || get(' 발주가 '))
  const profitRaw = get('수익') || get(' 수익 ')
  let profit: number | null = parseCsvNumber(profitRaw)
  if (profit === null && price != null && cost != null) profit = price - cost
  const qty = parseCsvNumber(get('수 량') || get('수량'))
  return {
    date,
    client: get('거래처') || null,
    branch: get('지점명') || null,
    item: get('품 목') || null,
    recipient: null,
    provider: get('발주처') || null,
    partner: get('수주화원') || null,
    location: get('발 송 장 소') || null,
    region: get('지역') || null,
    notes: get('특이사항') || null,
    price,
    cost,
    profit,
    quantity: qty != null ? qty : 1,
  }
}

/** CSV 전체 텍스트 파싱 → orders용 행 배열 */
function parseCsvToOrders(csvText: string): CsvOrderRow[] {
  const raw = csvText.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  const lines = raw.split('\n').filter((l) => l.length > 0)
  if (lines.length < 2) return []
  const headerLine = lines[0].startsWith('\uFEFF') ? lines[0].slice(1) : lines[0]
  const headers = parseCsvLine(headerLine)
  const rows: CsvOrderRow[] = []
  for (let i = 1; i < lines.length; i++) {
    const cells = parseCsvLine(lines[i])
    const row = csvRowToOrder(headers, cells)
    if (row) rows.push(row)
  }
  return rows
}

function useOrders(dateFrom?: string, dateTo?: string) {
  const [orders, setOrders] = useState<Order[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [refreshTrigger, setRefreshTrigger] = useState(0)

  useEffect(() => {
    if (!supabase) {
      setError('Supabase 설정이 없습니다. dashboard/.env에 VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY를 설정하세요.')
      setLoading(false)
      return
    }
    let q = supabase.from('orders').select('*').order('date', { ascending: true })
    if (dateFrom) q = q.gte('date', dateFrom)
    if (dateTo) q = q.lte('date', dateTo)
    q.then(({ data, error: e }) => {
      setError(e?.message ?? null)
      setOrders((data as Order[]) ?? [])
      setLoading(false)
    })
  }, [dateFrom, dateTo, refreshTrigger])

  const refetch = () => setRefreshTrigger((t) => t + 1)
  return { orders, loading, error, refetch }
}

/** 주문 등록 폼용: 전체 주문에서 발송장소 목록 (날짜 구간 무관) */
function useAllLocationsList() {
  const [list, setList] = useState<string[]>([])
  useEffect(() => {
    if (!supabase) return
    supabase
      .from('orders')
      .select('location')
      .not('location', 'is', null)
      .order('date', { ascending: false })
      .limit(5000)
      .then(({ data }) => {
        const locs = [...new Set((data ?? []).map((r: { location: string | null }) => r.location).filter(Boolean))] as string[]
        setList(locs.sort())
      })
  }, [])
  return list
}

function useOrdersSummary(dateFrom: string | undefined, dateTo: string | undefined) {
  const [summary, setSummary] = useState<{ sales: number; profit: number; count: number }>({ sales: 0, profit: 0, count: 0 })
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    if (!supabase || !dateFrom || !dateTo) {
      setSummary({ sales: 0, profit: 0, count: 0 })
      setLoading(false)
      return
    }
    setLoading(true)
    supabase
      .from('orders')
      .select('price, profit, cost', { count: 'exact' })
      .gte('date', dateFrom)
      .lte('date', dateTo)
      .order('date', { ascending: true })
      .limit(5000)
      .then(({ data, error, count }) => {
        setLoading(false)
        if (error) return
        const rows = (data ?? []) as { price: number | null; profit: number | null; cost: number | null }[]
        const sales = rows.reduce((s, r) => s + (r.price ?? 0), 0)
        const profit = rows.reduce((s, r) => {
          const p = r.profit ?? (r.price != null && r.cost != null ? r.price - r.cost : 0)
          return s + p
        }, 0)
        setSummary({ sales, profit, count: count ?? rows.length })
      })
  }, [dateFrom, dateTo])
  return { summary, loading }
}

const CLIENT_PRIORITY_ORDER = ['노랑풍선', '엔타스', '하나투어비즈니스', '하나투어ITC', '경복궁면세점', '준제이엔씨']

function useClientList() {
  const [clients, setClients] = useState<string[]>([])
  useEffect(() => {
    if (!supabase) return
    supabase.from('orders').select('client').not('client', 'is', null).then(({ data }) => {
      const list = [...new Set((data ?? []).map((r: { client: string }) => r.client).filter(Boolean))] as string[]
      const orderSet = new Set(CLIENT_PRIORITY_ORDER)
      const priority = list.filter((c) => orderSet.has(c))
      const rest = list.filter((c) => !orderSet.has(c)).sort((a, b) => a.localeCompare(b, 'ko'))
      setClients([...CLIENT_PRIORITY_ORDER.filter((c) => priority.includes(c)), ...rest])
    })
  }, [])
  return clients
}

function useProviderList() {
  const [providers, setProviders] = useState<string[]>([])
  useEffect(() => {
    if (!supabase) return
    supabase.from('orders').select('provider').not('provider', 'is', null).then(({ data }) => {
      const list = [...new Set((data ?? []).map((r: { provider: string }) => r.provider).filter(Boolean))] as string[]
      setProviders(list.sort())
    })
  }, [])
  return providers
}

type StoreClientRow = { store_name: string; client_name: string }

function useStoreClientMap() {
  const [list, setList] = useState<StoreClientRow[]>([])
  useEffect(() => {
    if (!supabase) return
    supabase.from('store_client_map').select('store_name, client_name').then(({ data, error }) => {
      if (error) return
      setList((data ?? []) as StoreClientRow[])
    })
  }, [])
  return list
}

const CHARGED_PROVIDERS = ['한플라워', '베스트플라워'] as const

type ProviderBalanceRow = { id: string; provider_name: string; balance: number; updated_at?: string }

function useProviderBalances(refreshTrigger?: number) {
  const [list, setList] = useState<ProviderBalanceRow[]>([])
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    if (!supabase) {
      setLoading(false)
      return
    }
    supabase.from('provider_balances').select('id, provider_name, balance, updated_at').in('provider_name', [...CHARGED_PROVIDERS]).then(({ data, error }) => {
      setLoading(false)
      if (error) return
      setList((data ?? []).map((r: { id: string; provider_name: string; balance: number; updated_at?: string }) => ({ ...r, balance: Number(r.balance) })))
    })
  }, [refreshTrigger])
  return { list, loading }
}

/** 잔액 수정 시점(updated_at) 이후에 등록된 주문의 발주가만 합계 — 충전잔액 = 입력한 잔액 − (지금 이후 입력한 주문 발주가) */
function useProviderCostSumsAfterBalance(providerBalances: ProviderBalanceRow[], refreshTrigger?: number) {
  const [sums, setSums] = useState<Record<string, number>>({})
  useEffect(() => {
    if (!supabase || providerBalances.length === 0) {
      const next: Record<string, number> = {}
      for (const p of CHARGED_PROVIDERS) next[p] = 0
      setSums(next)
      return
    }
    const updatedAtByProvider: Record<string, string> = {}
    for (const r of providerBalances) if (r.updated_at) updatedAtByProvider[r.provider_name] = r.updated_at

    supabase.from('orders').select('provider, cost, created_at').in('provider', [...CHARGED_PROVIDERS]).then(({ data, error }) => {
      if (error) {
        const next: Record<string, number> = {}
        for (const p of CHARGED_PROVIDERS) next[p] = 0
        setSums(next)
        return
      }
      const rows = (data ?? []) as { provider: string | null; cost: number | null; created_at?: string | null }[]
      const next: Record<string, number> = {}
      for (const p of CHARGED_PROVIDERS) next[p] = 0
      const cutoff = updatedAtByProvider
      for (const r of rows) {
        if (!r.provider || !CHARGED_PROVIDERS.includes(r.provider as typeof CHARGED_PROVIDERS[number])) continue
        const cut = cutoff[r.provider]
        if (!cut) continue
        const orderCreated = r.created_at ?? ''
        if (orderCreated > cut) next[r.provider] = (next[r.provider] ?? 0) + (r.cost ?? 0)
      }
      setSums(next)
    })
  }, [providerBalances, refreshTrigger])
  return sums
}

const emptyForm = {
  date: '',
  client: '',
  branch: '',
  requestDepartment: '',
  item: '',
  recipient: '',
  provider: '',
  partner: '',
  location: '',
  region: '',
  notes: '',
  price: '',
  cost: '',
  quantity: '1',
  orderer: '',
  ordererPhone: '',
}

type RowDraft = {
  partnerRating: string
  partnerReason: string
  deliveryPhotoUrl: string
  photoFile: File | null
  deliveryPhotoUrl2: string
  photoFile2: File | null
}

function getRowDraft(row: Order, rowUpdates: Record<string, RowDraft>): RowDraft {
  const cur = rowUpdates[row.id]
  if (cur) return cur
  return {
    partnerRating: row.partner_rating != null ? String(row.partner_rating) : '',
    partnerReason: row.partner_reason ?? '',
    deliveryPhotoUrl: row.delivery_photo ?? '',
    photoFile: null,
    deliveryPhotoUrl2: row.delivery_photo_2 ?? '',
    photoFile2: null,
  }
}

export default function App() {
  const [dateFrom, setDateFrom] = useState(() => {
    const n = new Date()
    const y = n.getFullYear(), m = n.getMonth() + 1
    return `${y}-${String(m).padStart(2, '0')}-01`
  })
  const [dateTo, setDateTo] = useState(() => {
    const n = new Date()
    const y = n.getFullYear(), m = n.getMonth() + 1
    const last = new Date(y, m, 0).getDate()
    return `${y}-${String(m).padStart(2, '0')}-${String(last).padStart(2, '0')}`
  })
  const [appliedDateFrom, setAppliedDateFrom] = useState(() => {
    const n = new Date()
    const y = n.getFullYear(), m = n.getMonth() + 1
    return `${y}-${String(m).padStart(2, '0')}-01`
  })
  const [appliedDateTo, setAppliedDateTo] = useState(() => {
    const n = new Date()
    const y = n.getFullYear(), m = n.getMonth() + 1
    const last = new Date(y, m, 0).getDate()
    return `${y}-${String(m).padStart(2, '0')}-${String(last).padStart(2, '0')}`
  })
  const [searchCondition, setSearchCondition] = useState<'' | 'client' | 'location' | 'region'>('')
  const [searchClient, setSearchClient] = useState('')
  const [searchLocation, setSearchLocation] = useState('')
  const [searchRegion, setSearchRegion] = useState('')
  const [form, setForm] = useState(() => ({ ...emptyForm, date: getTodayISO() }))
  const [submitStatus, setSubmitStatus] = useState<'idle' | 'saving' | 'ok' | 'error'>('idle')
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [rowUpdates, setRowUpdates] = useState<Record<string, RowDraft>>({})
  const [updatingId, setUpdatingId] = useState<string | null>(null)
  const [savedRowId, setSavedRowId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null)
  const [csvParsedRows, setCsvParsedRows] = useState<CsvOrderRow[] | null>(null)
  const [csvFileLoading, setCsvFileLoading] = useState(false)
  const [csvImportStatus, setCsvImportStatus] = useState<'idle' | 'importing' | 'ok' | 'error'>('idle')
  const [csvImportError, setCsvImportError] = useState<string | null>(null)
  const [backupDateFrom, setBackupDateFrom] = useState(() => {
    const n = new Date()
    const y = n.getFullYear(), m = n.getMonth() + 1
    return `${y}-${String(m).padStart(2, '0')}-01`
  })
  const [backupDateTo, setBackupDateTo] = useState(() => {
    const n = new Date()
    const y = n.getFullYear(), m = n.getMonth() + 1
    const last = new Date(y, m, 0).getDate()
    return `${y}-${String(m).padStart(2, '0')}-${String(last).padStart(2, '0')}`
  })
  const [backupLoading, setBackupLoading] = useState(false)
  const [yellowBalloonDateFrom, setYellowBalloonDateFrom] = useState(() => {
    const n = new Date()
    const y = n.getFullYear(), m = n.getMonth() + 1
    return `${y}-${String(m).padStart(2, '0')}-01`
  })
  const [yellowBalloonDateTo, setYellowBalloonDateTo] = useState(() => {
    const n = new Date()
    const y = n.getFullYear(), m = n.getMonth() + 1
    const last = new Date(y, m, 0).getDate()
    return `${y}-${String(m).padStart(2, '0')}-${String(last).padStart(2, '0')}`
  })
  const [yellowBalloonExportLoading, setYellowBalloonExportLoading] = useState(false)
  const [exportFormat, setExportFormat] = useState<ExportFormatType>('general')
  const [generalFormatClient, setGeneralFormatClient] = useState('')
  const [statementExportLoading, setStatementExportLoading] = useState(false)
  const [dataRefreshTrigger, setDataRefreshTrigger] = useState(0)
  // 지역·발송장소 검색 시에는 날짜 조건 없이 전체 조회
  const ordersDateFrom = (searchCondition === 'location' || searchCondition === 'region') ? undefined : (appliedDateFrom || undefined)
  const ordersDateTo = (searchCondition === 'location' || searchCondition === 'region') ? undefined : (appliedDateTo || undefined)
  const { orders, loading: ordersLoading, error, refetch } = useOrders(ordersDateFrom, ordersDateTo)
  const allLocationsList = useAllLocationsList()
  const clientList = useClientList()
  const generalFormatClients = useMemo(() => filterGeneralFormatClients(clientList), [clientList])
  const providerList = useProviderList()
  const storeClientMap = useStoreClientMap()
  const { list: providerBalances, loading: providerBalancesLoading } = useProviderBalances(dataRefreshTrigger)
  const providerCostSumsAfterBalance = useProviderCostSumsAfterBalance(providerBalances, dataRefreshTrigger)
  const [clientDropdownOpen, setClientDropdownOpen] = useState(false)
  const [providerDropdownOpen, setProviderDropdownOpen] = useState(false)
  const [branchDropdownOpen, setBranchDropdownOpen] = useState(false)
  const [locationDropdownOpen, setLocationDropdownOpen] = useState(false)
  const [regionDropdownOpen, setRegionDropdownOpen] = useState(false)
  const [formLocationDropdownOpen, setFormLocationDropdownOpen] = useState(false)
  const clientInputRef = useRef<HTMLInputElement>(null)
  const providerInputRef = useRef<HTMLInputElement>(null)
  const branchInputRef = useRef<HTMLInputElement>(null)
  const locationInputRef = useRef<HTMLInputElement>(null)
  const regionInputRef = useRef<HTMLInputElement>(null)
  const formLocationInputRef = useRef<HTMLInputElement>(null)
  const contactClientInputRef = useRef<HTMLInputElement>(null)
  const [photoPreviewUrl, setPhotoPreviewUrl] = useState<string | null>(null)
  const [photoPreviewFailed, setPhotoPreviewFailed] = useState(false)
  const [balanceEditOpen, setBalanceEditOpen] = useState(false)
  const [balanceEditForm, setBalanceEditForm] = useState<Record<string, string>>({})
  const [balanceSaving, setBalanceSaving] = useState(false)
  const [balanceEditError, setBalanceEditError] = useState<string | null>(null)
  const [statementFormatKey, setStatementFormatKey] = useState<string>('default')
  const [clientStatementFormatFromDb, setClientStatementFormatFromDb] = useState<string | null>(null)
  const [saveStatementFormatAsDefault, setSaveStatementFormatAsDefault] = useState(false)
  const [statementFormatSaving, setStatementFormatSaving] = useState(false)

  useEffect(() => {
    if (!supabase || !searchClient.trim()) {
      setClientStatementFormatFromDb(null)
      setStatementFormatKey('default')
      return
    }
    supabase.from('client_statement_format').select('format_key').eq('client_name', searchClient.trim()).maybeSingle().then(({ data }) => {
      const key = (data as { format_key?: string } | null)?.format_key ?? null
      setClientStatementFormatFromDb(key)
      setStatementFormatKey(key ?? 'default')
    })
  }, [searchClient])

  const STATEMENT_FORMATS: { key: string; label: string }[] = [
    { key: 'default', label: '기본 양식' },
    { key: 'format_2', label: '양식 2' },
    { key: 'format_3', label: '양식 3' },
  ]

  const saveClientStatementFormat = async () => {
    if (!supabase || !searchClient.trim()) return
    setStatementFormatSaving(true)
    const { error } = await supabase.from('client_statement_format').upsert(
      { client_name: searchClient.trim(), format_key: statementFormatKey, updated_at: new Date().toISOString() },
      { onConflict: 'client_name' }
    )
    setStatementFormatSaving(false)
    if (!error) setClientStatementFormatFromDb(statementFormatKey)
  }

  const [contactClient, setContactClient] = useState('')
  const [contactClientInput, setContactClientInput] = useState('')
  const [contactClientDropdownOpen, setContactClientDropdownOpen] = useState(false)
  const [contactName, setContactName] = useState('')
  const [contactDepartment, setContactDepartment] = useState('')
  const [contactPhone, setContactPhone] = useState('')
  const [contactEmail, setContactEmail] = useState('')
  const [contactSaving, setContactSaving] = useState(false)
  const [contactLoading, setContactLoading] = useState(false)
  const [contactSaveError, setContactSaveError] = useState<string | null>(null)
  const [contactSaveOk, setContactSaveOk] = useState(false)

  useEffect(() => {
    if (!contactClient.trim()) {
      setContactClientInput('')
      return
    }
    setContactClientInput(contactClient)
  }, [contactClient])

  useEffect(() => {
    if (!supabase || !contactClient.trim()) {
      setContactName('')
      setContactDepartment('')
      setContactPhone('')
      setContactEmail('')
      setContactLoading(false)
      return
    }
    setContactLoading(true)
    supabase.from('client_contacts').select('contact_name, department, phone, email').eq('client_name', contactClient.trim()).maybeSingle().then(({ data, error }) => {
      setContactLoading(false)
      if (error) {
        setContactName('')
        setContactDepartment('')
        setContactPhone('')
        setContactEmail('')
        return
      }
      const r = data as { contact_name?: string; department?: string; phone?: string; email?: string } | null
      setContactName(r?.contact_name ?? '')
      setContactDepartment(r?.department ?? '')
      setContactPhone(r?.phone ?? '')
      setContactEmail(r?.email ?? '')
    })
  }, [contactClient])

  const saveClientContact = async () => {
    if (!supabase || !contactClient.trim()) return
    setContactSaving(true)
    setContactSaveError(null)
    setContactSaveOk(false)
    const { error } = await supabase.from('client_contacts').upsert(
      { client_name: contactClient.trim(), contact_name: contactName.trim() || null, department: contactDepartment.trim() || null, phone: contactPhone.trim() || null, email: contactEmail.trim() || null, updated_at: new Date().toISOString() },
      { onConflict: 'client_name' }
    )
    setContactSaving(false)
    if (error) {
      const msg = error.message || ''
      const isTableMissing = /client_contacts|schema cache|relation.*does not exist/i.test(msg)
      setContactSaveError(isTableMissing ? 'client_contacts 테이블이 없습니다. Supabase 대시보드 → SQL Editor에서 supabase-client-contacts.sql 내용을 실행해 주세요.' : msg || '저장 실패')
      return
    }
    setContactSaveError(null)
    setContactSaveOk(true)
    setTimeout(() => setContactSaveOk(false), 3000)
  }

  const openPhotoPreview = (urlOrFile: string | File) => {
    setPhotoPreviewFailed(false)
    if (typeof urlOrFile === 'string') {
      setPhotoPreviewUrl(urlOrFile)
    } else {
      setPhotoPreviewUrl(URL.createObjectURL(urlOrFile))
    }
  }
  const closePhotoPreview = () => {
    if (photoPreviewUrl?.startsWith('blob:')) URL.revokeObjectURL(photoPreviewUrl)
    setPhotoPreviewUrl(null)
    setPhotoPreviewFailed(false)
  }

  const openBalanceEdit = () => {
    setBalanceEditError(null)
    const form: Record<string, string> = {}
    for (const row of providerBalances) form[row.provider_name] = String(row.balance)
    for (const p of CHARGED_PROVIDERS) if (form[p] === undefined) form[p] = '0'
    setBalanceEditForm(form)
    setBalanceEditOpen(true)
  }

  const saveBalanceEdit = async () => {
    if (!supabase) return
    setBalanceSaving(true)
    setBalanceEditError(null)
    for (const p of CHARGED_PROVIDERS) {
      const val = parseInt(String(balanceEditForm[p] ?? '0').replace(/,/g, ''), 10)
      if (Number.isNaN(val)) continue
      const { error } = await supabase.from('provider_balances').upsert(
        { provider_name: p, balance: val, updated_at: new Date().toISOString() },
        { onConflict: 'provider_name' }
      )
      if (error) {
        setBalanceEditError(error.message)
        setBalanceSaving(false)
        return
      }
    }
    setBalanceSaving(false)
    setBalanceEditOpen(false)
    setBalanceEditError(null)
    setDataRefreshTrigger((t) => t + 1)
  }

  const escapeCsv = (v: string | number | null | undefined): string => {
    const s = v == null ? '' : String(v)
    if (s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r')) return `"${s.replace(/"/g, '""')}"`
    return s
  }

  const backupCsvHeaders = ['배송일', '거래처', '지점명', '요청부서', '품목', '받는이', '발주처', '수주화원', '평점', '사유', '배송사진', '배송사진2', '발송장소', '지역', '특이사항', '판매가', '발주가', '수익', '수량']
  const orderToCsvCells = (o: Order) => [
    o.date,
    o.client ?? '',
    o.branch ?? '',
    o.request_department ?? '',
    o.item ?? '',
    o.recipient ?? '',
    o.provider ?? '',
    o.partner ?? '',
    o.partner_rating ?? '',
    o.partner_reason ?? '',
    o.delivery_photo ?? '',
    o.delivery_photo_2 ?? '',
    o.location ?? '',
    o.region ?? '',
    o.notes ?? '',
    o.price ?? '',
    o.cost ?? '',
    o.profit ?? '',
    o.quantity ?? '',
  ]

  const handleBackupExport = async () => {
    if (!supabase || !backupDateFrom.trim() || !backupDateTo.trim()) return
    setBackupLoading(true)
    const { data: rows, error } = await supabase
      .from('orders')
      .select('*')
      .gte('date', backupDateFrom.trim())
      .lte('date', backupDateTo.trim())
      .order('date', { ascending: true })
    setBackupLoading(false)
    if (error) return
    const list = (rows ?? []) as Order[]
    const csvLines = [backupCsvHeaders.join(',')]
    for (const o of list) csvLines.push(orderToCsvCells(o).map(escapeCsv).join(','))
    const bom = '\uFEFF'
    const blob = new Blob([bom + csvLines.join('\r\n')], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `주문백업_${backupDateFrom}_${backupDateTo}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const handleYellowBalloonExcel = async () => {
    if (!supabase || !yellowBalloonDateFrom.trim() || !yellowBalloonDateTo.trim()) return
    setYellowBalloonExportLoading(true)
    try {
      const { data: rows, error } = await supabase
        .from('orders')
        .select('*')
        .eq('client', '노랑풍선')
        .gte('date', yellowBalloonDateFrom.trim())
        .lte('date', yellowBalloonDateTo.trim())
        .order('date', { ascending: true })
      setYellowBalloonExportLoading(false)
      if (error) return
      const list = (rows ?? []) as Order[]
      if (list.length === 0) alert('선택한 기간에 노랑풍선 주문이 없습니다. 빈 양식으로 내려받습니다.')
      const blob = await fillYellowBalloonTemplate(list, yellowBalloonDateFrom.trim(), yellowBalloonDateTo.trim())
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `2026년_경조화환발주내역_성원플라워_${yellowBalloonDateFrom}_${yellowBalloonDateTo}.xlsx`
      a.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      setYellowBalloonExportLoading(false)
      alert(err instanceof Error ? err.message : '노랑풍선 명세서 생성 실패')
    }
  }

  const handleStatementExport = async () => {
    const dateFrom = appliedDateFrom?.trim() ?? ''
    const dateTo = appliedDateTo?.trim() ?? ''
    if (!dateFrom || !dateTo) {
      alert('먼저 날짜를 선택하고 [검색]을 실행해 주세요.')
      return
    }
    if (exportFormat === 'general') {
      const client = searchCondition === 'client' && searchClient && generalFormatClients.includes(searchClient) ? searchClient : ''
      if (!client) {
        alert('일반양식: 검색 조건에서 거래처를 선택한 뒤 [검색]을 눌러 주세요. (하나투어비즈니스 등 일반 거래처만 해당됩니다.)')
        return
      }
      if (!supabase) return
      setStatementExportLoading(true)
      const { data: rows, error } = await supabase
        .from('orders')
        .select('*')
        .eq('client', client)
        .gte('date', dateFrom)
        .lte('date', dateTo)
        .order('date', { ascending: true })
      setStatementExportLoading(false)
      if (error) return
      const list = (rows ?? []) as Order[]
      const dateLabel = dateFrom && dateTo ? `${dateFrom.replace(/-/g,'.')} ~ ${dateTo.replace(/-/g,'.')}` : dateFrom?.replace(/-/g, '.') ?? ''
      const html = buildStatementHtml(list, client, dateLabel, 'general')
      const blob = new Blob([html], { type: 'text/html;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `거래명세표_${client}_${dateFrom}_${dateTo}.html`
      a.click()
      URL.revokeObjectURL(url)
      return
    }
    if (exportFormat === 'yellow_balloon') {
      if (!supabase) return
      setYellowBalloonExportLoading(true)
      try {
        const { data: rows, error } = await supabase
          .from('orders')
          .select('*')
          .eq('client', '노랑풍선')
          .gte('date', dateFrom)
          .lte('date', dateTo)
          .order('date', { ascending: true })
        setYellowBalloonExportLoading(false)
        if (error) return
        const list = (rows ?? []) as Order[]
        if (list.length === 0) alert('선택한 기간에 노랑풍선 주문이 없습니다. 빈 양식으로 내려받습니다.')
        const blob = await fillYellowBalloonTemplate(list, dateFrom, dateTo)
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = `2026년_경조화환발주내역_성원플라워_${dateFrom}_${dateTo}.xlsx`
        a.click()
        URL.revokeObjectURL(url)
      } catch (err) {
        setYellowBalloonExportLoading(false)
        alert(err instanceof Error ? err.message : '노랑풍선 명세서 생성 실패')
      }
      return
    }
    if (exportFormat === 'entas_statement') {
      const entasClient = searchCondition === 'client' && ENTAS_CLIENT_SET.has(searchClient) ? searchClient : ''
      if (!entasClient) {
        alert('엔타스형 명세표는 검색 조건에서 거래처를 "엔타스", "엔타스프레쉬미트", "엔타스에스디", "퍼시픽스타" 중 하나로 선택한 뒤 [검색]을 누르고 다운로드해 주세요.')
        return
      }
      if (!supabase) return
      setStatementExportLoading(true)
      const { data: rows, error } = await supabase
        .from('orders')
        .select('*')
        .eq('client', entasClient)
        .gte('date', dateFrom)
        .lte('date', dateTo)
        .order('date', { ascending: true })
      setStatementExportLoading(false)
      if (error) return
      const list = (rows ?? []) as Order[]
      const dateLabel = dateFrom && dateTo ? `${dateFrom.replace(/-/g, '.')} ~ ${dateTo.replace(/-/g, '.')}` : dateFrom?.replace(/-/g, '.') ?? ''
      const html = buildStatementHtml(list, entasClient, dateLabel, 'entas')
      const blob = new Blob([html], { type: 'text/html;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `거래명세표_${entasClient}_${dateFrom}_${dateTo}.html`
      a.click()
      URL.revokeObjectURL(url)
    }
  }

  /** 명세서 다운로드 후 담당자 이메일로 메일 쓰기 열기 (첨부는 사용자가 수동) */
  const handleSendStatementToContact = async () => {
    const dateFrom = appliedDateFrom?.trim() ?? ''
    const dateTo = appliedDateTo?.trim() ?? ''
    if (!dateFrom || !dateTo) {
      alert('먼저 날짜를 선택하고 [검색]을 실행해 주세요.')
      return
    }
    let client = ''
    if (exportFormat === 'general') {
      client = searchCondition === 'client' && searchClient && generalFormatClients.includes(searchClient) ? searchClient : ''
      if (!client) {
        alert('일반양식: 검색 조건에서 거래처를 선택한 뒤 [검색]을 눌러 주세요.')
        return
      }
    } else if (exportFormat === 'yellow_balloon') {
      client = '노랑풍선'
    } else {
      client = searchCondition === 'client' && ENTAS_CLIENT_SET.has(searchClient) ? searchClient : ''
      if (!client) {
        alert('엔타스형은 검색 조건에서 해당 거래처를 선택한 뒤 [검색]을 눌러 주세요.')
        return
      }
    }
    if (!supabase) return
    const { data: contactRow } = await supabase.from('client_contacts').select('email').eq('client_name', client).maybeSingle()
    const email = (contactRow as { email?: string } | null)?.email?.trim()
    if (!email) {
      alert(`「${client}」 거래처의 담당자 이메일이 등록되어 있지 않습니다.\n오른쪽 [거래처 관리]에서 해당 거래처를 선택한 뒤 담당자 이메일을 등록·저장해 주세요.`)
      return
    }
    setStatementExportLoading(true)
    if (exportFormat === 'general') {
      const { data: rows, error } = await supabase.from('orders').select('*').eq('client', client).gte('date', dateFrom).lte('date', dateTo).order('date', { ascending: true })
      setStatementExportLoading(false)
      if (error) return
      const list = (rows ?? []) as Order[]
      const dateLabel = `${dateFrom.replace(/-/g, '.')} ~ ${dateTo.replace(/-/g, '.')}`
      const html = buildStatementHtml(list, client, dateLabel, 'general')
      const blob = new Blob([html], { type: 'text/html;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `거래명세표_${client}_${dateFrom}_${dateTo}.html`
      a.click()
      URL.revokeObjectURL(url)
    } else if (exportFormat === 'yellow_balloon') {
      const { data: rows, error } = await supabase.from('orders').select('*').eq('client', '노랑풍선').gte('date', dateFrom).lte('date', dateTo).order('date', { ascending: true })
      setStatementExportLoading(false)
      if (error) return
      const list = (rows ?? []) as Order[]
      if (list.length === 0) alert('선택한 기간에 노랑풍선 주문이 없습니다. 빈 양식으로 내려받습니다.')
      try {
        const blob = await fillYellowBalloonTemplate(list, dateFrom, dateTo)
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = `2026년_경조화환발주내역_성원플라워_${dateFrom}_${dateTo}.xlsx`
        a.click()
        URL.revokeObjectURL(url)
      } catch (err) {
        alert(err instanceof Error ? err.message : '노랑풍선 명세서 생성 실패')
      }
    } else {
      const { data: rows, error } = await supabase.from('orders').select('*').eq('client', client).gte('date', dateFrom).lte('date', dateTo).order('date', { ascending: true })
      setStatementExportLoading(false)
      if (error) return
      const list = (rows ?? []) as Order[]
      const dateLabel = `${dateFrom.replace(/-/g, '.')} ~ ${dateTo.replace(/-/g, '.')}`
      const html = buildStatementHtml(list, client, dateLabel, 'entas')
      const blob = new Blob([html], { type: 'text/html;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `거래명세표_${client}_${dateFrom}_${dateTo}.html`
      a.click()
      URL.revokeObjectURL(url)
    }
    const subject = encodeURIComponent(`[성원플라워] 거래명세표 ${client} ${dateFrom}~${dateTo}`)
    const body = encodeURIComponent('안녕하세요.\n첨부와 같이 거래명세표를 보내드립니다.\n(첨부파일을 메일에 추가해 주세요)\n\n성원플라워 드림')
    window.location.href = `mailto:${email}?subject=${subject}&body=${body}`
  }

  const searchPeriodSummary = useMemo(() => {
    const sales = orders.reduce((s, o) => s + (o.price ?? 0), 0)
    const profit = orders.reduce((s, o) => {
      const p = o.profit ?? (o.price != null && o.cost != null ? o.price - o.cost : 0)
      return s + p
    }, 0)
    return { sales, profit, count: orders.length }
  }, [orders])

  const prevYearSameMonthRange = useMemo(() => {
    if (!appliedDateFrom || !appliedDateTo) return { from: undefined as string | undefined, to: undefined as string | undefined }
    const parts = appliedDateFrom.split('-').map(Number)
    const y = parts[0]
    const m = parts[1]
    if (!y || !m) return { from: undefined, to: undefined }
    const prevY = y - 1
    const first = `${prevY}-${String(m).padStart(2, '0')}-01`
    const lastDay = new Date(prevY, m, 0).getDate()
    const last = `${prevY}-${String(m).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`
    return { from: first, to: last }
  }, [appliedDateFrom, appliedDateTo])

  const { summary: prevYearSummary, loading: prevYearLoading } = useOrdersSummary(prevYearSameMonthRange.from, prevYearSameMonthRange.to)

  const balanceByProvider = useMemo(() => {
    const m: Record<string, number> = {}
    for (const row of providerBalances) m[row.provider_name] = row.balance
    return m
  }, [providerBalances])

  const chargedBalanceByProvider = useMemo(() => {
    const m: Record<string, number> = {}
    for (const p of CHARGED_PROVIDERS) {
      m[p] = (balanceByProvider[p] ?? 0) - (providerCostSumsAfterBalance[p] ?? 0)
    }
    return m
  }, [balanceByProvider, providerCostSumsAfterBalance])

  const locationList = useMemo(() => {
    const list = [...new Set(orders.map((o) => o.location).filter(Boolean))] as string[]
    return list.sort()
  }, [orders])

  const locationSuggestions = useMemo(() => {
    const q = searchLocation.trim()
    if (!q) return locationList.slice(0, 50)
    const cho = getChosung(q)
    return locationList.filter(
      (loc) => getChosung(loc).startsWith(cho) || loc.includes(q)
    ).slice(0, 50)
  }, [searchLocation, locationList])

  /** 주문 등록 폼 발송장소 추천 (전체 발송장소 목록 + 초성·포함) */
  const formLocationSuggestions = useMemo(() => {
    const q = form.location.trim()
    if (!q) return allLocationsList.slice(0, 50)
    const cho = getChosung(q)
    return allLocationsList.filter(
      (loc) => getChosung(loc).startsWith(cho) || loc.includes(q)
    ).slice(0, 50)
  }, [form.location, allLocationsList])

  const regionList = useMemo(() => {
    const list = [...new Set(orders.map((o) => o.region).filter(Boolean))] as string[]
    return list.sort()
  }, [orders])

  const regionSuggestions = useMemo(() => {
    const q = searchRegion.trim().toLowerCase()
    if (!q) return regionList.slice(0, 50)
    return regionList.filter((r) => r.toLowerCase().includes(q)).slice(0, 50)
  }, [searchRegion, regionList])

  const filteredOrders = useMemo(() => {
    let list = orders
    if (searchCondition === 'client' && searchClient.trim()) {
      list = orders.filter((o) => (o.client ?? '').trim() === searchClient.trim())
    } else if (searchCondition === 'location' && searchLocation.trim()) {
      list = orders.filter((o) => (o.location ?? '').trim() === searchLocation.trim())
    } else if (searchCondition === 'region' && searchRegion.trim()) {
      list = orders.filter((o) => (o.region ?? '').trim() === searchRegion.trim())
    }
    // 최근(배송일·등록순)이 맨 위로
    return [...list].sort((a, b) => {
      const byDate = (b.date || '').localeCompare(a.date || '')
      if (byDate !== 0) return byDate
      return (b.id || '').localeCompare(a.id || '')
    })
  }, [orders, searchCondition, searchClient, searchLocation, searchRegion])

  const clientSummary = useMemo(() => {
    if (searchCondition !== 'client' || !searchClient.trim()) return null
    const list = filteredOrders
    const sales = list.reduce((s, o) => s + (o.price ?? 0), 0)
    const profit = list.reduce((s, o) => s + (o.profit ?? 0), 0)
    return { sales, profit, count: list.length }
  }, [searchCondition, searchClient, filteredOrders])

  const clientSuggestions = useMemo(() => {
    const q = form.client.trim()
    if (!q) return []
    const cho = getChosung(q)
    return clientList.filter(
      (name) => getChosung(name).startsWith(cho) || name.toLowerCase().includes(q.toLowerCase())
    ).slice(0, 10)
  }, [form.client, clientList])

  const providerSuggestions = useMemo(() => {
    const q = form.provider.trim()
    if (!q) return []
    const cho = getChosung(q)
    return providerList.filter(
      (name) => getChosung(name).startsWith(cho) || name.toLowerCase().includes(q.toLowerCase())
    ).slice(0, 10)
  }, [form.provider, providerList])

  const storeSuggestions = useMemo(() => {
    const q = form.branch.trim()
    if (!q) return []
    const cho = getChosung(q)
    return storeClientMap.filter(
      (row) => getChosung(row.store_name).startsWith(cho) || row.store_name.toLowerCase().includes(q.toLowerCase())
    ).slice(0, 10)
  }, [form.branch, storeClientMap])

  const contactClientSuggestions = useMemo(() => {
    const q = contactClientInput.trim()
    if (!q) return clientList.slice(0, 30)
    const cho = getChosung(q)
    return clientList.filter(
      (name) => getChosung(name).startsWith(cho) || name.toLowerCase().includes(q.toLowerCase())
    ).slice(0, 20)
  }, [contactClientInput, clientList])

  // 같은 매장명이면 마지막으로 입력했던 주문자/연락처 (날짜 최신 순)
  const lastOrdererByBranch = useMemo(() => {
    const map: Record<string, { orderer_name: string; orderer_phone: string }> = {}
    const sorted = [...orders].sort((a, b) => (b.date || '').localeCompare(a.date || ''))
    for (const o of sorted) {
      const branch = (o.branch ?? '').trim()
      if (!branch) continue
      if (map[branch]) continue
      const name = (o.orderer_name ?? '').trim()
      const phone = (o.orderer_phone ?? '').trim()
      if (name || phone) map[branch] = { orderer_name: name, orderer_phone: phone }
    }
    return map
  }, [orders])

  const updateForm = (field: string, value: string) => setForm((f) => ({ ...f, [field]: value }))

  const setRowUpdate = (row: Order, patch: Partial<RowDraft>) => {
    setRowUpdates((prev) => {
      const next = { ...prev }
      next[row.id] = { ...getRowDraft(row, prev), ...patch }
      return next
    })
  }

  const handleUpdateOrderRow = async (row: Order) => {
    if (!supabase) return
    const draft = getRowDraft(row, rowUpdates)
    setUpdatingId(row.id)
    let photoUrl = draft.deliveryPhotoUrl.trim() || null
    if (draft.photoFile) {
      const toUpload = await compressImageForUpload(draft.photoFile)
      const ext = toUpload.name.split('.').pop() || 'jpg'
      const path = `orders/${row.id}/${Date.now()}_1.${ext}`
      const { error: upErr } = await supabase.storage.from('delivery-photos').upload(path, toUpload, { upsert: true })
      if (!upErr) {
        const { data: urlData } = supabase.storage.from('delivery-photos').getPublicUrl(path)
        photoUrl = urlData.publicUrl
      } else {
        alert(`배송사진 1 업로드 실패: ${upErr.message}\n\nSupabase Storage → delivery-photos 버킷의 정책(RLS)에서 anon 업로드를 허용해 주세요.`)
        if (row.delivery_photo) photoUrl = row.delivery_photo
      }
      if (photoUrl == null && row.delivery_photo) photoUrl = row.delivery_photo
    }
    let photoUrl2 = draft.deliveryPhotoUrl2.trim() || null
    if (draft.photoFile2) {
      const toUpload = await compressImageForUpload(draft.photoFile2)
      const ext = toUpload.name.split('.').pop() || 'jpg'
      const path = `orders/${row.id}/${Date.now()}_2.${ext}`
      const { error: upErr } = await supabase.storage.from('delivery-photos').upload(path, toUpload, { upsert: true })
      if (!upErr) {
        const { data: urlData } = supabase.storage.from('delivery-photos').getPublicUrl(path)
        photoUrl2 = urlData.publicUrl
      } else {
        alert(`배송사진 2 업로드 실패: ${upErr.message}\n\nSupabase Storage → delivery-photos 버킷의 정책(RLS)에서 anon 업로드를 허용해 주세요.`)
        if (row.delivery_photo_2) photoUrl2 = row.delivery_photo_2
      }
      if (photoUrl2 == null && row.delivery_photo_2) photoUrl2 = row.delivery_photo_2
    }
    const { data: updatedRows, error: updateErr } = await supabase
      .from('orders')
      .update({
        partner_rating: draft.partnerRating === '' ? null : Number(draft.partnerRating),
        partner_reason: draft.partnerReason.trim() || null,
        delivery_photo: photoUrl,
        delivery_photo_2: photoUrl2,
      })
      .eq('id', row.id)
      .select('id')
    setUpdatingId(null)
    if (updateErr) {
      alert(`저장 실패: ${updateErr.message}\n\nSupabase → SQL Editor에서 dashboard/supabase-한번에-적용.sql 내용을 Run 실행해 주세요.`)
      return
    }
    if (!updatedRows?.length) {
      alert('저장이 DB에 반영되지 않았습니다. (수정된 행 없음)\n\nSupabase → SQL Editor에서 dashboard/supabase-한번에-적용.sql 파일 내용을 붙여넣고 Run 실행해 주세요.')
      return
    }
    setRowUpdates((prev) => {
      const next = { ...prev }
      delete next[row.id]
      return next
    })
    setSavedRowId(row.id)
    setTimeout(() => setSavedRowId(null), 2500)
    refetch()
    setDataRefreshTrigger((t) => t + 1)
  }

  const loadOrderIntoForm = (row: Order) => {
    setForm({
      date: row.date,
      client: row.client ?? '',
      branch: row.branch ?? '',
      requestDepartment: row.request_department ?? '',
      item: row.item ?? '',
      recipient: row.recipient ?? '',
      provider: row.provider ?? '',
      partner: row.partner ?? '',
      location: row.location ?? '',
      region: row.region ?? '',
      notes: row.notes ?? '',
      price: row.price != null ? String(row.price) : '',
      cost: row.cost != null ? String(row.cost) : '',
      quantity: row.quantity != null ? String(row.quantity) : '1',
      orderer: row.orderer_name ?? '',
      ordererPhone: row.orderer_phone ?? '',
    })
  }

  const handleSelectRow = (row: Order, checked: boolean) => {
    if (checked) {
      setSelectedOrderId(row.id)
      loadOrderIntoForm(row)
    } else {
      setSelectedOrderId(null)
      setForm({ ...emptyForm, date: getTodayISO() })
    }
  }

  const handleDeleteOrder = async (row: Order) => {
    if (!supabase) return
    if (!window.confirm(`이 주문을 삭제할까요?\n배송일: ${row.date}, 거래처: ${row.client ?? '-'}`)) return
    setDeletingId(row.id)
    const { error: deleteErr } = await supabase.from('orders').delete().eq('id', row.id)
    setDeletingId(null)
    if (!deleteErr) {
      refetch()
      setDataRefreshTrigger((t) => t + 1)
    }
  }

  const handleSubmitOrder = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!supabase) {
      setSubmitError('Supabase 설정이 없습니다.')
      setSubmitStatus('error')
      return
    }
    if (!form.date.trim()) {
      setSubmitError('배송일을 입력하세요.')
      setSubmitStatus('error')
      return
    }
    setSubmitStatus('saving')
    setSubmitError(null)
    const price = form.price === '' ? null : Number(form.price)
    const costNum = form.cost === '' ? null : Number(form.cost)
    const profit = price != null && costNum != null ? price - costNum : null
    const payload = {
      date: form.date.trim() || getTodayISO(),
      client: form.client.trim() || null,
      branch: form.branch.trim() || null,
      request_department: form.requestDepartment.trim() || null,
      item: form.item.trim() || null,
      recipient: form.recipient.trim() || null,
      provider: form.provider.trim() || null,
      partner: form.partner.trim() || null,
      location: form.location.trim() || null,
      region: form.region.trim() || null,
      notes: form.notes.trim() || null,
      price,
      cost: costNum,
      profit,
      quantity: form.quantity === '' ? 1 : Number(form.quantity),
      orderer_name: form.orderer.trim() || null,
      orderer_phone: form.ordererPhone.trim() || null,
    }
    if (selectedOrderId) {
      const currentRow = filteredOrders.find((o) => o.id === selectedOrderId)
      const updatePayload = currentRow
        ? { ...payload, partner_rating: currentRow.partner_rating, partner_reason: currentRow.partner_reason ?? null, delivery_photo: currentRow.delivery_photo ?? null, delivery_photo_2: currentRow.delivery_photo_2 ?? null }
        : payload
      const { error: updateError } = await supabase.from('orders').update(updatePayload).eq('id', selectedOrderId)
      if (updateError) {
        setSubmitError(updateError.message)
        setSubmitStatus('error')
        return
      }
      setSubmitStatus('ok')
      setSelectedOrderId(null)
      setForm({ ...emptyForm, date: getTodayISO() })
      refetch()
      setDataRefreshTrigger((t) => t + 1)
      setTimeout(() => setSubmitStatus('idle'), 2000)
      return
    }
    const { error: insertError } = await supabase.from('orders').insert(payload)
    if (insertError) {
      setSubmitError(insertError.message)
      setSubmitStatus('error')
      return
    }
    setSubmitStatus('ok')
    setForm({ ...emptyForm, date: getTodayISO() })
    refetch()
    setDataRefreshTrigger((t) => t + 1)
    setTimeout(() => setSubmitStatus('idle'), 2000)
  }

  const handleCsvFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    setCsvParsedRows(null)
    setCsvImportStatus('idle')
    setCsvImportError(null)
    if (!file) return
    setCsvFileLoading(true)

    const applyResult = (rows: CsvOrderRow[]) => {
      setCsvParsedRows(rows)
      setCsvImportError(rows.length === 0 ? '파싱된 행이 0건입니다. CSV 첫 줄에 연도, 배송일, 거래처 등 컬럼이 있는지 확인하세요. 엑셀에서는 "CSV UTF-8(쉼표로 분리)"로 저장해 보세요.' : null)
      setCsvFileLoading(false)
    }

    const reader = new FileReader()
    reader.onerror = () => {
      setCsvImportError('파일을 읽을 수 없습니다.')
      setCsvFileLoading(false)
    }
    reader.onload = () => {
      try {
        const text = (reader.result as string) ?? ''
        const rows = parseCsvToOrders(text)
        if (rows.length > 0 || text.length < 50) {
          applyResult(rows)
          return
        }
        // UTF-8로 0건이면 한글 인코딩(EUC-KR)으로 재시도
        const reader2 = new FileReader()
        reader2.onerror = () => applyResult(rows)
        reader2.onload = () => {
          try {
            const text2 = (reader2.result as string) ?? ''
            const rows2 = parseCsvToOrders(text2)
            applyResult(rows2)
          } catch {
            applyResult(rows)
          }
        }
        reader2.readAsText(file, 'EUC-KR')
      } catch (err) {
        setCsvImportError(err instanceof Error ? err.message : 'CSV 파싱 실패')
        setCsvFileLoading(false)
      }
    }
    reader.readAsText(file, 'UTF-8')
  }

  const handleCsvBulkInsert = async () => {
    if (!supabase || !csvParsedRows?.length) return
    setCsvImportStatus('importing')
    setCsvImportError(null)
    const BATCH = 50
    const payloads = csvParsedRows.map((r) => ({
      date: r.date,
      client: r.client,
      branch: r.branch,
      item: r.item,
      recipient: r.recipient,
      provider: r.provider,
      partner: r.partner,
      location: r.location,
      region: r.region ?? null,
      notes: r.notes,
      price: r.price,
      cost: r.cost,
      profit: r.profit,
      quantity: r.quantity ?? 1,
    }))
    // 중복 제외: 이미 같은 날짜+거래처+발송장소(또는 매장명)+판매가+수량이 있으면 건너뜀
    const dates = csvParsedRows.map((r) => r.date)
    const minDate = dates.reduce((a, b) => (a <= b ? a : b), dates[0])
    const maxDate = dates.reduce((a, b) => (a >= b ? a : b), dates[0])
    const { data: existing } = await supabase
      .from('orders')
      .select('date, client, location, branch, price, quantity')
      .gte('date', minDate)
      .lte('date', maxDate)
    const key = (o: { date: string; client: string | null; location: string | null; branch: string | null; price: number | null; quantity: number | null }) =>
      `${o.date}|${o.client ?? ''}|${o.location ?? o.branch ?? ''}|${o.price ?? ''}|${o.quantity ?? ''}`
    const existingKeys = new Set((existing ?? []).map(key))
    const toInsert = payloads.filter((p) => !existingKeys.has(key(p)))
    const skipped = payloads.length - toInsert.length
    for (let i = 0; i < toInsert.length; i += BATCH) {
      const batch = toInsert.slice(i, i + BATCH)
      const { error: batchError } = await supabase.from('orders').insert(batch)
      if (batchError) {
        setCsvImportError(batchError.message)
        setCsvImportStatus('error')
        return
      }
    }
    setCsvImportStatus('ok')
    setCsvParsedRows(null)
    setCsvImportError(skipped > 0 ? `${payloads.length}건 중 ${skipped}건 중복 제외, ${toInsert.length}건 등록했습니다.` : null)
    refetch()
    setDataRefreshTrigger((t) => t + 1)
    setTimeout(() => { setCsvImportStatus('idle'); setCsvImportError(null) }, 5000)
  }

  return (
    <div style={{ width: '99%', maxWidth: '99%', margin: '0 auto', padding: '16px 24px', minHeight: '100vh', boxSizing: 'border-box', overflowX: 'auto' }}>
      <header style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap', minWidth: 0 }}>
        <h1 style={{ margin: 0, fontSize: 28, fontWeight: 700 }}>성원플라워 관리 대시보드</h1>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ ...cardStyle, minWidth: 200, padding: '14px 20px' }}>
          <h2 style={{ margin: '0 0 6px', fontSize: 16, fontWeight: 600 }}>CSV 일괄 등록</h2>
            <input type="file" accept=".csv" onChange={handleCsvFile} style={{ marginBottom: 6, fontSize: 12 }} disabled={csvFileLoading} />
            {csvFileLoading && <p style={{ margin: '0 0 4px', fontSize: 12, color: '#334155' }}>파일 읽는 중…</p>}
            {csvImportError && <p style={{ margin: '0 0 4px', fontSize: 11, color: csvImportStatus === 'ok' ? '#047857' : '#dc2626' }}>{csvImportError}</p>}
            {!csvFileLoading && csvParsedRows != null && (
              <>
                <p style={{ margin: '0 0 4px', fontSize: 13 }}><strong>{csvParsedRows.length}</strong>건 파싱</p>
                <button type="button" onClick={handleCsvBulkInsert} disabled={csvImportStatus === 'importing'} style={{ padding: '6px 12px', background: '#334155', color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, cursor: 'pointer' }}>
                  {csvImportStatus === 'importing' ? '등록 중…' : csvImportStatus === 'ok' ? '완료' : '일괄 등록'}
                </button>
              </>
            )}
          </div>
          <div style={{ ...cardStyle, minWidth: 200, padding: '14px 20px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6, flexWrap: 'wrap' }}>
              <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>데이터 백업</h2>
              <button type="button" onClick={handleBackupExport} disabled={backupLoading} style={{ padding: '5px 12px', background: '#475569', color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, cursor: backupLoading ? 'wait' : 'pointer' }}>
                {backupLoading ? '백업 중…' : 'CSV로 백업'}
              </button>
            </div>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
              <input type="date" value={backupDateFrom} onChange={(e) => setBackupDateFrom(e.target.value)} style={{ padding: '5px 8px', border: '1px solid #cbd5e1', borderRadius: 8, fontSize: 12 }} />
              <span style={{ color: '#64748b' }}>~</span>
              <input type="date" value={backupDateTo} onChange={(e) => setBackupDateTo(e.target.value)} style={{ padding: '5px 8px', border: '1px solid #cbd5e1', borderRadius: 8, fontSize: 12 }} />
            </div>
          </div>
        </div>
      </header>

      <section style={{ display: 'flex', gap: 16, marginBottom: 32, alignItems: 'flex-start', flexWrap: 'nowrap' }}>
        <div style={{ flex: '0 0 900px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 0 }}>
        {/* 주문 등록 영역 폭: 900px 고정 */}
        <div style={{ ...cardStyle, width: '100%', maxWidth: 900, boxSizing: 'border-box', overflow: 'hidden' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 12, flexWrap: 'wrap' }}>
            <h2 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>{selectedOrderId ? '주문 수정' : '주문 등록'}</h2>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 12, color: '#64748b', fontWeight: 500 }}>배송일</span>
              <input type="date" value={form.date} onChange={(e) => updateForm('date', e.target.value)} style={inputStyle} />
            </label>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 12, color: '#64748b', fontWeight: 500 }}>충전잔액</span>
              {providerBalancesLoading ? (
                <span style={{ fontSize: 13 }}>…</span>
              ) : (
                <span style={{ fontSize: 14, whiteSpace: 'nowrap' }}>
                  {CHARGED_PROVIDERS.map((p) => (
                    <span key={p} style={{ marginRight: 12 }}><span style={{ fontWeight: 600 }}>{p}</span> {formatMoney(chargedBalanceByProvider[p])}</span>
                  ))}
                </span>
              )}
              <button type="button" onClick={openBalanceEdit} style={{ padding: '6px 12px', background: '#e2e8f0', border: 'none', borderRadius: 6, fontSize: 12, cursor: 'pointer' }}>월초 충전잔액 수정</button>
            </div>
          </div>
          {selectedOrderId && <p style={{ margin: '0 0 12px', fontSize: 12, color: '#334155' }}>목록에서 선택한 주문을 수정한 뒤 버튼을 누르세요.</p>}
          <form onSubmit={handleSubmitOrder}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1.2fr 0.9fr 0.9fr', gap: 8, marginBottom: 10, width: '100%', minWidth: 0 }}>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
              <span style={{ fontSize: 11, color: '#64748b', fontWeight: 500 }}>품목</span>
              <input type="text" value={form.item} onChange={(e) => updateForm('item', e.target.value)} placeholder="품목" style={inputStyle} />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 2, position: 'relative', minWidth: 0 }}>
              <span style={{ fontSize: 11, color: '#64748b', fontWeight: 500 }}>거래처</span>
              <input
                ref={clientInputRef}
                type="text"
                value={form.client}
                onChange={(e) => { updateForm('client', e.target.value); setClientDropdownOpen(true); }}
                onFocus={() => setClientDropdownOpen(true)}
                onBlur={() => setTimeout(() => setClientDropdownOpen(false), 150)}
                onKeyDown={(e) => { if (e.key === 'Enter') e.preventDefault(); }}
                placeholder="초성 검색" style={inputStyle}
              />
              {clientDropdownOpen && clientSuggestions.length > 0 && (
                <ul style={{ position: 'absolute', top: '100%', left: 0, right: 0, margin: 0, padding: 0, listStyle: 'none', background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, boxShadow: '0 4px 12px rgba(0,0,0,0.1)', zIndex: 10, maxHeight: 200, overflowY: 'auto' }}>
                  {clientSuggestions.map((name) => (
                    <li
                      key={name}
                      onMouseDown={(e) => { e.preventDefault(); updateForm('client', name); setClientDropdownOpen(false); clientInputRef.current?.blur(); }}
                      style={{ padding: '8px 12px', cursor: 'pointer', fontSize: 14, borderBottom: '1px solid #f1f5f9' }}
                    >
                      {name}
                    </li>
                  ))}
                </ul>
              )}
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 2, position: 'relative', minWidth: 0 }}>
              <span style={{ fontSize: 11, color: '#64748b', fontWeight: 500 }}>매장명 (선택 시 거래처 자동)</span>
              <input
                ref={branchInputRef}
                type="text"
                value={form.branch}
                onChange={(e) => { updateForm('branch', e.target.value); setBranchDropdownOpen(true); }}
                onFocus={() => setBranchDropdownOpen(true)}
                onBlur={() => {
                  setTimeout(() => {
                    setBranchDropdownOpen(false)
                    setForm((f) => {
                      const branch = (branchInputRef.current?.value ?? f.branch).trim()
                      if (!branch || f.orderer || f.ordererPhone) return f
                      const prev = lastOrdererByBranch[branch]
                      if (prev) return { ...f, orderer: prev.orderer_name, ordererPhone: prev.orderer_phone }
                      return f
                    })
                  }, 150)
                }}
                onKeyDown={(e) => { if (e.key === 'Enter') e.preventDefault(); }}
                placeholder="매장명 입력·초성 검색" style={inputStyle}
              />
              {branchDropdownOpen && storeSuggestions.length > 0 && (
                <ul style={{ position: 'absolute', top: '100%', left: 0, right: 0, margin: 0, padding: 0, listStyle: 'none', background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, boxShadow: '0 4px 12px rgba(0,0,0,0.1)', zIndex: 10, maxHeight: 200, overflowY: 'auto' }}>
                  {storeSuggestions.map((row) => (
                    <li
                      key={row.store_name}
                      onMouseDown={(e) => {
                        e.preventDefault()
                        const prev = lastOrdererByBranch[row.store_name]
                        setForm((f) => ({
                          ...f,
                          branch: row.store_name,
                          client: row.client_name,
                          ...(prev ? { orderer: prev.orderer_name, ordererPhone: prev.orderer_phone } : {}),
                        }))
                        setBranchDropdownOpen(false)
                        branchInputRef.current?.blur()
                      }}
                      style={{ padding: '8px 12px', cursor: 'pointer', fontSize: 14, borderBottom: '1px solid #f1f5f9' }}
                    >
                      <span style={{ fontWeight: 500 }}>{row.store_name}</span>
                      <span style={{ color: '#64748b', fontSize: 12, marginLeft: 8 }}> → {row.client_name}</span>
                    </li>
                  ))}
                </ul>
              )}
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
              <span style={{ fontSize: 11, color: '#64748b', fontWeight: 500 }}>요청부서</span>
              <input type="text" value={form.requestDepartment} onChange={(e) => updateForm('requestDepartment', e.target.value)} placeholder="요청부서" style={inputStyle} />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <span style={{ fontSize: 11, color: '#64748b', fontWeight: 500 }}>받는이</span>
              <input type="text" value={form.recipient} onChange={(e) => updateForm('recipient', e.target.value)} placeholder="받는이" style={inputStyle} />
            </label>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr 1fr 1fr', gap: 8, marginBottom: 10, width: '100%', minWidth: 0 }}>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 2, position: 'relative', minWidth: 0 }}>
              <span style={{ fontSize: 11, color: '#64748b', fontWeight: 500 }}>발주처 (초성 검색)</span>
              <input
                ref={providerInputRef}
                type="text"
                value={form.provider}
                onChange={(e) => { updateForm('provider', e.target.value); setProviderDropdownOpen(true); }}
                onFocus={() => setProviderDropdownOpen(true)}
                onBlur={() => setTimeout(() => setProviderDropdownOpen(false), 150)}
                onKeyDown={(e) => { if (e.key === 'Enter') e.preventDefault(); }}
                placeholder="초성 검색" style={inputStyle}
              />
              {providerDropdownOpen && providerSuggestions.length > 0 && (
                <ul style={{ position: 'absolute', top: '100%', left: 0, right: 0, margin: 0, padding: 0, listStyle: 'none', background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, boxShadow: '0 4px 12px rgba(0,0,0,0.1)', zIndex: 10, maxHeight: 200, overflowY: 'auto' }}>
                  {providerSuggestions.map((name) => (
                    <li
                      key={name}
                      onMouseDown={(e) => { e.preventDefault(); updateForm('provider', name); setProviderDropdownOpen(false); providerInputRef.current?.blur(); }}
                      style={{ padding: '8px 12px', cursor: 'pointer', fontSize: 14, borderBottom: '1px solid #f1f5f9' }}
                    >
                      {name}
                    </li>
                  ))}
                </ul>
              )}
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
              <span style={{ fontSize: 11, color: '#64748b', fontWeight: 500 }}>수주화원</span>
              <input type="text" value={form.partner} onChange={(e) => updateForm('partner', e.target.value)} placeholder="수주화원" style={inputStyle} />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 2, position: 'relative' }}>
              <span style={{ fontSize: 11, color: '#64748b', fontWeight: 500 }}>발송장소</span>
              <input
                ref={formLocationInputRef}
                type="text"
                value={form.location}
                onChange={(e) => { updateForm('location', e.target.value); setFormLocationDropdownOpen(true); }}
                onFocus={() => setFormLocationDropdownOpen(true)}
                onBlur={() => setTimeout(() => setFormLocationDropdownOpen(false), 150)}
                placeholder="발송장소 (초성 검색 가능)"
                style={inputStyle}
              />
              {formLocationDropdownOpen && formLocationSuggestions.length > 0 && (
                <ul style={{ position: 'absolute', top: '100%', left: 0, right: 0, margin: 0, padding: 0, listStyle: 'none', background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, boxShadow: '0 4px 12px rgba(0,0,0,0.1)', zIndex: 10, maxHeight: 200, overflowY: 'auto' }}>
                  {formLocationSuggestions.map((loc) => (
                    <li
                      key={loc}
                      onMouseDown={(e) => { e.preventDefault(); updateForm('location', loc); setFormLocationDropdownOpen(false); formLocationInputRef.current?.blur(); }}
                      style={{ padding: '6px 10px', cursor: 'pointer', fontSize: 13, borderBottom: '1px solid #f1f5f9' }}
                    >
                      {loc}
                    </li>
                  ))}
                </ul>
              )}
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <span style={{ fontSize: 11, color: '#64748b', fontWeight: 500 }}>특이사항</span>
              <input type="text" value={form.notes} onChange={(e) => updateForm('notes', e.target.value)} placeholder="특이사항" style={inputStyle} />
            </label>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 56px 72px', gap: 8, marginBottom: 12, width: '100%', minWidth: 0 }}>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <span style={{ fontSize: 11, color: '#64748b', fontWeight: 500 }}>판매가</span>
              <input type="number" value={form.price} onChange={(e) => updateForm('price', e.target.value)} placeholder="0" min={0} style={inputStyle} />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <span style={{ fontSize: 11, color: '#64748b', fontWeight: 500 }}>발주가</span>
              <input type="number" value={form.cost} onChange={(e) => updateForm('cost', e.target.value)} placeholder="0" min={0} style={inputStyle} />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <span style={{ fontSize: 11, color: '#64748b', fontWeight: 500 }}>수익</span>
              <input type="text" value={form.price !== '' && form.cost !== '' && !isNaN(Number(form.price)) && !isNaN(Number(form.cost)) ? String(Number(form.price) - Number(form.cost)) : ''} readOnly placeholder="자동" style={{ ...inputStyle, background: '#f1f5f9', color: '#64748b' }} />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <span style={{ fontSize: 11, color: '#64748b', fontWeight: 500 }}>수량</span>
              <input type="number" value={form.quantity} onChange={(e) => updateForm('quantity', e.target.value)} min={1} style={{ ...inputStyle, width: 48, minWidth: 48, maxWidth: 56 }} />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <span style={{ fontSize: 11, color: '#64748b', fontWeight: 500 }}>지역</span>
              <input type="text" value={form.region} onChange={(e) => updateForm('region', e.target.value)} placeholder="지역" style={{ ...inputStyle, width: 64, minWidth: 64, maxWidth: 72 }} />
            </label>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <button type="submit" disabled={submitStatus === 'saving'} style={submitBtnStyle}>
              {submitStatus === 'saving' ? '저장 중…' : selectedOrderId ? '수정 저장' : '주문 등록'}
            </button>
            {selectedOrderId && (
              <button type="button" onClick={() => { setSelectedOrderId(null); setForm({ ...emptyForm, date: getTodayISO() }); }} style={{ padding: '10px 20px', background: '#e2e8f0', border: 'none', borderRadius: 8, fontSize: 14, cursor: 'pointer' }}>
                선택 해제
              </button>
            )}
            <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 12, color: '#64748b', fontWeight: 500, whiteSpace: 'nowrap' }}>주문자</span>
              <input type="text" value={form.orderer} onChange={(e) => updateForm('orderer', e.target.value)} placeholder="주문자" style={{ ...inputStyle, width: 100, minWidth: 80 }} />
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 12, color: '#64748b', fontWeight: 500, whiteSpace: 'nowrap' }}>연락처</span>
              <input type="text" value={form.ordererPhone} onChange={(e) => updateForm('ordererPhone', e.target.value)} placeholder="연락처" style={{ ...inputStyle, width: 120, minWidth: 100 }} />
            </label>
            {submitStatus === 'ok' && <span style={{ color: '#047857', fontSize: 14 }}>등록되었습니다.</span>}
            {submitStatus === 'error' && submitError && <span style={{ color: '#dc2626', fontSize: 14 }}>{submitError}</span>}
          </div>
        </form>
        </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'row', gap: 16, flex: '0 0 auto', alignItems: 'flex-start', flexWrap: 'nowrap' }}>
        <div style={{ display: 'flex', gap: 16, flex: '0 0 auto', alignItems: 'flex-start' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={cardStyle}>
              <div style={{ color: '#64748b', fontSize: 14, marginBottom: 4 }}>검색 기간 매출</div>
              <div style={{ fontSize: 24, fontWeight: 700 }}>{ordersLoading ? '…' : formatMoney(searchPeriodSummary.sales)}</div>
            </div>
            <div style={cardStyle}>
              <div style={{ color: '#64748b', fontSize: 14, marginBottom: 4 }}>검색 기간 수익</div>
              <div style={{ fontSize: 24, fontWeight: 700, color: '#047857' }}>{ordersLoading ? '…' : formatMoney(searchPeriodSummary.profit)}</div>
            </div>
            <div style={cardStyle}>
              <div style={{ color: '#64748b', fontSize: 14, marginBottom: 4 }}>검색 기간 주문수</div>
              <div style={{ fontSize: 24, fontWeight: 700 }}>{ordersLoading ? '…' : `${searchPeriodSummary.count}건`}</div>
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={cardStyle}>
              <div style={{ color: '#64748b', fontSize: 14, marginBottom: 4 }}>전년동월 매출</div>
              <div style={{ fontSize: 24, fontWeight: 700 }}>{prevYearLoading ? '…' : formatMoney(prevYearSummary.sales)}</div>
            </div>
            <div style={cardStyle}>
              <div style={{ color: '#64748b', fontSize: 14, marginBottom: 4 }}>전년동월 수익</div>
              <div style={{ fontSize: 24, fontWeight: 700, color: '#047857' }}>{prevYearLoading ? '…' : formatMoney(prevYearSummary.profit)}</div>
            </div>
            <div style={cardStyle}>
              <div style={{ color: '#64748b', fontSize: 14, marginBottom: 4 }}>전년동월 주문수</div>
              <div style={{ fontSize: 24, fontWeight: 700 }}>{prevYearLoading ? '…' : `${prevYearSummary.count}건`}</div>
            </div>
          </div>
        </div>
        <div style={{ ...cardStyle, flex: '0 0 auto', minWidth: 320 }}>
          <h3 style={{ margin: '0 0 12px', fontSize: 16, fontWeight: 600 }}>거래처 관리</h3>
          <p style={{ margin: '0 0 12px', fontSize: 13, color: '#64748b' }}>거래처를 선택하면 해당 담당자의 정보가 표시됩니다. 수정 후 저장하세요.</p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, position: 'relative', flexWrap: 'wrap' }}>
              <span style={{ fontSize: 13, minWidth: 70 }}>거래처</span>
              <div style={{ position: 'relative', display: 'inline-flex', alignItems: 'stretch', gap: 8 }}>
                <div style={{ position: 'relative' }}>
                  <input
                    ref={contactClientInputRef}
                    type="text"
                    value={contactClientInput}
                    onChange={(e) => {
                      const v = e.target.value
                      setContactClientInput(v)
                      setContactClientDropdownOpen(true)
                      const trimmed = v.trim()
                      if (trimmed && clientList.includes(trimmed)) setContactClient(trimmed)
                    }}
                    onFocus={() => setContactClientDropdownOpen(true)}
                    onBlur={() => {
                      const value = (contactClientInputRef.current?.value ?? contactClientInput).trim()
                      setTimeout(() => {
                        setContactClientDropdownOpen(false)
                        if (value) setContactClient(value)
                      }, 150)
                    }}
                    onKeyDown={(e) => { if (e.key === 'Enter') e.preventDefault(); }}
                    placeholder="거래처 검색 또는 선택"
                    style={{ padding: '8px 12px', border: '1px solid #cbd5e1', borderRadius: 8, fontSize: 14, minWidth: 200 }}
                  />
                  {contactClientDropdownOpen && contactClientSuggestions.length > 0 && (
                    <ul style={{ position: 'absolute', top: '100%', left: 0, right: 0, margin: 0, padding: 0, listStyle: 'none', background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, boxShadow: '0 4px 12px rgba(0,0,0,0.1)', zIndex: 10, maxHeight: 220, overflowY: 'auto' }}>
                      {contactClientSuggestions.map((name) => (
                        <li
                          key={name}
                          onMouseDown={(e) => {
                            e.preventDefault()
                            setContactClient(name)
                            setContactClientInput(name)
                            setContactClientDropdownOpen(false)
                            contactClientInputRef.current?.blur()
                          }}
                          style={{ padding: '8px 12px', cursor: 'pointer', fontSize: 14, borderBottom: '1px solid #f1f5f9' }}
                        >
                          {name}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setContactClientDropdownOpen(false)
                    setContactSaveError(null)
                    const v = contactClientInput.trim()
                    if (v) setContactClient(v)
                  }}
                  style={{ padding: '8px 14px', background: '#64748b', color: '#fff', border: 'none', borderRadius: 8, fontSize: 14, cursor: 'pointer', fontWeight: 500, flexShrink: 0 }}
                >
                  조회
                </button>
              </div>
            </div>
            {/* 담당자 정보: 항상 아래 공간에 고정 표시. 조회 시 이 영역만 갱신됨. */}
            <div style={{ width: '100%', marginTop: 8, minHeight: 140, padding: 12, background: '#f1f5f9', border: '1px solid #e2e8f0', borderRadius: 8 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#334155', marginBottom: 8 }}>담당자 정보</div>
              {!contactClient.trim() ? (
                <p style={{ margin: 0, fontSize: 13, color: '#64748b' }}>거래처를 선택한 뒤 조회를 눌러 주세요.</p>
              ) : contactLoading ? (
                <p style={{ margin: 0, fontSize: 13, color: '#64748b' }}>불러오는 중…</p>
              ) : (
                <>
                  <p style={{ margin: '0 0 8px', fontSize: 12, color: '#64748b' }}>담당자가 바뀌면 항목을 수정한 뒤 저장하세요.</p>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center', marginBottom: 8 }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ fontSize: 13, minWidth: 70 }}>담당자 이름</span>
                      <input type="text" value={contactName} onChange={(e) => setContactName(e.target.value)} placeholder="이름" style={{ padding: '8px 12px', border: '1px solid #cbd5e1', borderRadius: 8, fontSize: 14, width: 120 }} />
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ fontSize: 13, minWidth: 70 }}>부서명</span>
                      <input type="text" value={contactDepartment} onChange={(e) => setContactDepartment(e.target.value)} placeholder="부서명" style={{ padding: '8px 12px', border: '1px solid #cbd5e1', borderRadius: 8, fontSize: 14, width: 120 }} />
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ fontSize: 13, minWidth: 70 }}>전화번호</span>
                      <input type="text" value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} placeholder="전화번호" style={{ padding: '8px 12px', border: '1px solid #cbd5e1', borderRadius: 8, fontSize: 14, width: 140 }} />
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ fontSize: 13, minWidth: 70 }}>이메일 주소</span>
                      <input type="email" value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} placeholder="email@example.com" style={{ padding: '8px 12px', border: '1px solid #cbd5e1', borderRadius: 8, fontSize: 14, width: 200 }} />
                    </label>
                  </div>
                  {!contactName.trim() && !contactDepartment.trim() && !contactPhone.trim() && !contactEmail.trim() && (
                    <p style={{ margin: '0 0 8px', fontSize: 12, color: '#64748b' }}>등록된 담당자가 없습니다. 신규 등록 시 저장하세요.</p>
                  )}
                  {contactSaveError && <p style={{ margin: '0 0 8px', fontSize: 12, color: '#dc2626' }}>{contactSaveError}</p>}
                  {contactSaveOk && <p style={{ margin: '0 0 8px', fontSize: 12, color: '#047857' }}>저장되었습니다.</p>}
                  <button type="button" disabled={contactSaving} onClick={saveClientContact} style={{ padding: '8px 16px', background: '#334155', color: '#fff', border: 'none', borderRadius: 8, fontSize: 14, cursor: 'pointer' }}>
                    {contactSaving ? '저장 중…' : '저장'}
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
        </div>
      </section>

      <section>
        <div style={{ display: 'flex', gap: 16, alignItems: 'center', marginBottom: 16, flexWrap: 'wrap' }}>
          <label>
            <span style={{ marginRight: 8 }}>날짜 from</span>
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              style={{ padding: 8, border: '1px solid #cbd5e1', borderRadius: 8 }}
            />
          </label>
          <label>
            <span style={{ marginRight: 8 }}>날짜 to</span>
            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              style={{ padding: 8, border: '1px solid #cbd5e1', borderRadius: 8 }}
            />
          </label>
          <button
            type="button"
            onClick={() => { setAppliedDateFrom(dateFrom); setAppliedDateTo(dateTo); }}
            style={{ padding: '8px 20px', background: '#334155', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 600 }}
          >
            검색
          </button>
          <span style={{ marginLeft: 8, color: '#64748b', fontSize: 14 }}>검색 조건</span>
          <select
            value={searchCondition}
            onChange={(e) => { setSearchCondition(e.target.value as '' | 'client' | 'location' | 'region'); setSearchClient(''); setSearchLocation(''); setSearchRegion(''); }}
            style={{ padding: '8px 12px', border: '1px solid #cbd5e1', borderRadius: 8, fontSize: 14 }}
          >
            <option value="">없음</option>
            <option value="client">거래처</option>
            <option value="location">발송장소</option>
            <option value="region">지역</option>
          </select>
          {searchCondition === 'client' && (
            <select
              value={searchClient}
              onChange={(e) => setSearchClient(e.target.value)}
              style={{ padding: '8px 12px', border: '1px solid #cbd5e1', borderRadius: 8, fontSize: 14, minWidth: 160 }}
            >
              <option value="">거래처 선택</option>
              {clientList.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          )}
          {searchCondition === 'location' && (
            <div style={{ position: 'relative', minWidth: 220 }}>
              <input
                ref={locationInputRef}
                type="text"
                value={searchLocation}
                onChange={(e) => { setSearchLocation(e.target.value); setLocationDropdownOpen(true); }}
                onFocus={() => setLocationDropdownOpen(true)}
                onBlur={() => setTimeout(() => setLocationDropdownOpen(false), 150)}
                placeholder="발송장소 입력 또는 목록에서 선택"
                style={{ padding: '8px 12px', border: '1px solid #cbd5e1', borderRadius: 8, fontSize: 14, width: '100%', minWidth: 220 }}
              />
              {locationDropdownOpen && locationSuggestions.length > 0 && (
                <ul style={{ position: 'absolute', top: '100%', left: 0, right: 0, margin: 0, padding: 0, listStyle: 'none', background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, boxShadow: '0 4px 12px rgba(0,0,0,0.1)', zIndex: 10, maxHeight: 240, overflowY: 'auto' }}>
                  {locationSuggestions.map((loc) => (
                    <li
                      key={loc}
                      onMouseDown={(e) => { e.preventDefault(); setSearchLocation(loc); setLocationDropdownOpen(false); locationInputRef.current?.blur(); }}
                      style={{ padding: '8px 12px', cursor: 'pointer', fontSize: 14, borderBottom: '1px solid #f1f5f9' }}
                    >
                      {loc}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
          {searchCondition === 'region' && (
            <div style={{ position: 'relative', minWidth: 220 }}>
              <input
                ref={regionInputRef}
                type="text"
                value={searchRegion}
                onChange={(e) => { setSearchRegion(e.target.value); setRegionDropdownOpen(true); }}
                onFocus={() => setRegionDropdownOpen(true)}
                onBlur={() => setTimeout(() => setRegionDropdownOpen(false), 150)}
                placeholder="지역 입력 또는 목록에서 선택"
                style={{ padding: '8px 12px', border: '1px solid #cbd5e1', borderRadius: 8, fontSize: 14, width: '100%', minWidth: 220 }}
              />
              {regionDropdownOpen && regionSuggestions.length > 0 && (
                <ul style={{ position: 'absolute', top: '100%', left: 0, right: 0, margin: 0, padding: 0, listStyle: 'none', background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, boxShadow: '0 4px 12px rgba(0,0,0,0.1)', zIndex: 10, maxHeight: 240, overflowY: 'auto' }}>
                  {regionSuggestions.map((r) => (
                    <li
                      key={r}
                      onMouseDown={(e) => { e.preventDefault(); setSearchRegion(r); setRegionDropdownOpen(false); regionInputRef.current?.blur(); }}
                      style={{ padding: '8px 12px', cursor: 'pointer', fontSize: 14, borderBottom: '1px solid #f1f5f9' }}
                    >
                      {r}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
          <div style={{ marginLeft: 16, paddingLeft: 16, borderLeft: '1px solid #e2e8f0', display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ color: '#64748b', fontSize: 14, fontWeight: 600 }}>명세/내역서 내보내기</span>
            {(['general', 'yellow_balloon', 'entas_statement'] as const).map((fmt) => (
              <label key={fmt} style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer', fontSize: 13 }}>
                <input type="radio" name="exportFormat" checked={exportFormat === fmt} onChange={() => setExportFormat(fmt)} />
                {fmt === 'general' ? '일반양식' : fmt === 'yellow_balloon' ? '노랑풍선 엑셀' : '엔타스형 명세표'}
              </label>
            ))}
            {exportFormat === 'general' && (
              <span style={{ fontSize: 12, color: searchCondition === 'client' && searchClient && generalFormatClients.includes(searchClient) ? '#334155' : '#94a3b8' }}>
                {searchCondition === 'client' && searchClient ? (generalFormatClients.includes(searchClient) ? `거래처: ${searchClient}` : '일반 거래처만 해당. 검색 조건에서 선택 후 검색') : '검색 조건에서 거래처 선택 후 [검색]'}
              </span>
            )}
            <button type="button" onClick={handleStatementExport} disabled={yellowBalloonExportLoading || statementExportLoading || (exportFormat === 'general' && !(searchCondition === 'client' && searchClient && generalFormatClients.includes(searchClient))) || (exportFormat === 'entas_statement' && !(searchCondition === 'client' && ENTAS_CLIENT_SET.has(searchClient)))} style={{ padding: '8px 16px', background: exportFormat === 'general' ? '#475569' : exportFormat === 'yellow_balloon' ? '#0d9488' : '#334155', color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, cursor: yellowBalloonExportLoading || statementExportLoading ? 'wait' : 'pointer', fontWeight: 500 }}>
              {yellowBalloonExportLoading || statementExportLoading ? '생성 중…' : '다운로드'}
            </button>
            <button type="button" onClick={handleSendStatementToContact} disabled={yellowBalloonExportLoading || statementExportLoading || (exportFormat === 'general' && !(searchCondition === 'client' && searchClient && generalFormatClients.includes(searchClient))) || (exportFormat === 'entas_statement' && !(searchCondition === 'client' && ENTAS_CLIENT_SET.has(searchClient)))} style={{ padding: '8px 16px', background: '#6366f1', color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, cursor: yellowBalloonExportLoading || statementExportLoading ? 'wait' : 'pointer', fontWeight: 500 }} title="명세서를 다운로드한 뒤 담당자 이메일로 메일 쓰기를 엽니다. 첨부는 메일에서 직접 해 주세요.">
              담당자에게 보내기
            </button>
            <span style={{ fontSize: 11, color: '#94a3b8' }}>기간: 검색 조건과 동일</span>
          </div>
        </div>

        {error && <p style={{ color: '#dc2626' }}>{error}</p>}
        {ordersLoading ? <p>로딩 중…</p> : (
          <div style={{ overflowX: 'auto', overflowY: 'scroll', maxHeight: '55vh', background: '#fff', borderRadius: 12, boxShadow: '0 1px 3px rgba(0,0,0,0.1)', display: 'block' }}>
            {searchCondition === 'client' && searchClient.trim() && (
              <p style={{ padding: '10px 16px', margin: 0, background: '#eff6ff', borderBottom: '1px solid #bfdbfe', fontSize: 13, fontWeight: 600, color: '#1e40af' }}>
                거래처 「{searchClient}」 주문 목록
              </p>
            )}
            {searchCondition === 'region' && searchRegion.trim() && (
              <p style={{ padding: '10px 16px', margin: 0, background: '#f0fdf4', borderBottom: '1px solid #bbf7d0', fontSize: 13, fontWeight: 600, color: '#166534' }}>
                지역 「{searchRegion}」 주문 목록
              </p>
            )}
            <p style={{ padding: '10px 16px', margin: 0, background: '#f1f5f9', borderBottom: '1px solid #e2e8f0', fontSize: 12, color: '#475569' }}>
              배송 후 평점·사유·배송사진 입력 후 해당 행 [저장] 클릭
            </p>
            <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'auto' }}>
              <thead>
                <tr style={{ borderBottom: '2px solid #e2e8f0', background: '#f8fafc' }}>
                  <th style={{ ...thStyle, width: 44 }}>선택</th>
                  <th style={{ ...thStyle, width: 88 }}>배송일</th>
                  <th style={{ ...thStyle, width: 90 }}>품목</th>
                  <th style={{ ...thStyle, minWidth: 135 }}>거래처</th>
                  <th style={{ ...thStyle, width: 135 }}>지점명</th>
                  <th style={thStyle}>요청부서</th>
                  <th style={thStyle}>받는이</th>
                  <th style={{ ...thStyle, minWidth: 115 }}>발주처</th>
                  <th style={{ ...thStyle, width: 109 }}>수주화원</th>
                  <th style={{ ...thStyle, background: '#f1f5f9', width: 38 }}>평점</th>
                  <th style={{ ...thStyle, background: '#f1f5f9', width: 44 }}>사유</th>
                  <th style={{ ...thStyle, background: '#f1f5f9', width: 293 }}>배송사진</th>
                  <th style={{ ...thStyle, background: '#f1f5f9', width: 90 }}>저장</th>
                  <th style={{ ...thStyle, minWidth: 130 }}>발송장소</th>
                  <th style={thStyle}>지역</th>
                  <th style={thStyle}>특이사항</th>
                  <th style={thStyle}>판매가</th>
                  <th style={thStyle}>발주가</th>
                  <th style={thStyle}>수익</th>
                  <th style={{ ...thStyle, width: 56 }}>삭제</th>
                </tr>
              </thead>
              <tbody>
                {filteredOrders.map((row) => {
                  const draft = getRowDraft(row, rowUpdates)
                  const afterStyle = { ...tdStyle, background: '#f1f5f9', borderLeft: '2px solid #e2e8f0', borderRight: '2px solid #e2e8f0' }
                  return (
                    <tr key={row.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                      <td style={tdStyle}>
                        <input
                          type="checkbox"
                          checked={selectedOrderId === row.id}
                          onChange={(e) => handleSelectRow(row, e.target.checked)}
                          title="선택 시 상단 주문 등록에서 수정"
                        />
                      </td>
                      <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>{row.date ? `${row.date.slice(2, 4)}-${row.date.slice(5, 7)}-${row.date.slice(8, 10)}` : ''}</td>
                      <td style={tdStyle}>{row.item ?? '-'}</td>
                      <td style={tdStyle}>{row.client ?? '-'}</td>
                      <td style={tdStyle}>{row.branch ?? '-'}</td>
                      <td style={tdStyle}>{row.request_department ?? '-'}</td>
                      <td style={tdStyle}>{row.recipient ?? '-'}</td>
                      <td style={tdStyle}>{row.provider ?? '-'}</td>
                      <td style={tdStyle}>{row.partner ?? '-'}</td>
                      <td style={afterStyle}>
                        <input type="text" value={draft.partnerRating} onChange={(e) => setRowUpdate(row, { partnerRating: e.target.value })} placeholder="평점" style={{ ...cellInputStyle, width: 34, minWidth: 34, padding: '4px 4px', textAlign: 'center' }} title="수주화원 평점 (수기 입력)" />
                      </td>
                      <td style={afterStyle}>
                        <input type="text" value={draft.partnerReason} onChange={(e) => setRowUpdate(row, { partnerReason: e.target.value })} placeholder="사유 입력" style={{ ...cellInputStyle, maxWidth: '100%' }} title="평점 사유" />
                      </td>
                      <td style={{ ...afterStyle, width: 293, maxWidth: 293, overflow: 'visible' }}>
                        <div style={{ display: 'flex', flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
                          <div
                            style={{ flex: '1 1 120px', display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}
                            onPasteCapture={(e) => {
                              const dt = e.clipboardData
                              if (!dt || !dt.items) return
                              for (let i = 0; i < dt.items.length; i++) {
                                const item = dt.items[i]
                                if (item.kind === 'file' && item.type.startsWith('image/')) {
                                  const blob = item.getAsFile()
                                  if (!blob) return
                                  e.preventDefault()
                                  e.stopPropagation()
                                  const ext = blob.type === 'image/png' ? 'png' : blob.type === 'image/jpeg' ? 'jpg' : 'png'
                                  setRowUpdate(row, { photoFile: new File([blob], `붙여넣기.${ext}`, { type: blob.type }) })
                                  return
                                }
                              }
                            }}
                            title="캡처 후 이 칸에서 Ctrl+V"
                          >
                            <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                              <span style={{ fontSize: 10, color: '#64748b', flexShrink: 0 }}>1</span>
                              <label style={{ flexShrink: 0, fontSize: 10, padding: '4px 6px', border: '1px solid #cbd5e1', borderRadius: 6, cursor: 'pointer', background: '#f8fafc' }}>
                                파일
                                <input type="file" accept="image/*" onChange={(e) => setRowUpdate(row, { photoFile: e.target.files?.[0] ?? null })} style={{ position: 'absolute', width: 0, height: 0, opacity: 0 }} title="배송 사진 1" />
                              </label>
                              <input type="text" value={draft.deliveryPhotoUrl} onChange={(e) => setRowUpdate(row, { deliveryPhotoUrl: e.target.value })} placeholder="URL" style={{ ...cellInputStyle, flex: 1, minWidth: 60, padding: '4px 4px' }} />
                            </div>
                            {(draft.photoFile || draft.deliveryPhotoUrl?.trim() || row.delivery_photo) && (
                              <button type="button" onClick={() => draft.photoFile ? openPhotoPreview(draft.photoFile) : openPhotoPreview((draft.deliveryPhotoUrl?.trim() || row.delivery_photo)!)} style={{ alignSelf: 'flex-start', fontSize: 10, color: '#64748b', background: 'none', border: 'none', cursor: 'pointer', padding: 0, textDecoration: 'underline', lineHeight: 1 }}>보기</button>
                            )}
                          </div>
                          <div
                            style={{ flex: '1 1 120px', display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}
                            onPasteCapture={(e) => {
                              const dt = e.clipboardData
                              if (!dt || !dt.items) return
                              for (let i = 0; i < dt.items.length; i++) {
                                const item = dt.items[i]
                                if (item.kind === 'file' && item.type.startsWith('image/')) {
                                  const blob = item.getAsFile()
                                  if (!blob) return
                                  e.preventDefault()
                                  e.stopPropagation()
                                  const ext = blob.type === 'image/png' ? 'png' : blob.type === 'image/jpeg' ? 'jpg' : 'png'
                                  setRowUpdate(row, { photoFile2: new File([blob], `붙여넣기.${ext}`, { type: blob.type }) })
                                  return
                                }
                              }
                            }}
                            title="캡처 후 이 칸에서 Ctrl+V"
                          >
                            <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                              <span style={{ fontSize: 10, color: '#64748b', flexShrink: 0 }}>2</span>
                              <label style={{ flexShrink: 0, fontSize: 10, padding: '4px 6px', border: '1px solid #cbd5e1', borderRadius: 6, cursor: 'pointer', background: '#f8fafc' }}>
                                파일
                                <input type="file" accept="image/*" onChange={(e) => setRowUpdate(row, { photoFile2: e.target.files?.[0] ?? null })} style={{ position: 'absolute', width: 0, height: 0, opacity: 0 }} title="배송 사진 2" />
                              </label>
                              <input type="text" value={draft.deliveryPhotoUrl2} onChange={(e) => setRowUpdate(row, { deliveryPhotoUrl2: e.target.value })} placeholder="URL" style={{ ...cellInputStyle, flex: 1, minWidth: 60, padding: '4px 4px' }} />
                            </div>
                            {(draft.photoFile2 || draft.deliveryPhotoUrl2?.trim() || row.delivery_photo_2) && (
                              <button type="button" onClick={() => draft.photoFile2 ? openPhotoPreview(draft.photoFile2) : openPhotoPreview((draft.deliveryPhotoUrl2?.trim() || row.delivery_photo_2)!)} style={{ alignSelf: 'flex-start', fontSize: 10, color: '#64748b', background: 'none', border: 'none', cursor: 'pointer', padding: 0, textDecoration: 'underline', lineHeight: 1 }}>보기</button>
                            )}
                          </div>
                        </div>
                      </td>
                      <td style={afterStyle}>
                        <button type="button" disabled={updatingId === row.id} onClick={() => handleUpdateOrderRow(row)} style={editBtnStyle} title="저장">
                          {updatingId === row.id ? '저장 중…' : '저장'}
                        </button>
                        {savedRowId === row.id && <span style={{ marginLeft: 6, fontSize: 12, color: '#047857', fontWeight: 600 }}>저장됨</span>}
                      </td>
                      <td style={tdStyle}>{row.location ?? '-'}</td>
                      <td style={tdStyle}>{row.region ?? '-'}</td>
                      <td style={tdStyle}>{row.notes ?? '-'}</td>
                      <td style={tdStyle}>{formatNum(row.price)}</td>
                      <td style={tdStyle}>{formatNum(row.cost)}</td>
                      <td style={tdStyle}>{formatNum(row.profit)}</td>
                      <td style={tdStyle}>
                        <button
                          type="button"
                          disabled={deletingId === row.id}
                          onClick={() => handleDeleteOrder(row)}
                          style={{ padding: '6px 10px', background: '#dc2626', color: '#fff', border: 'none', borderRadius: 6, fontSize: 12, cursor: 'pointer' }}
                          title="이 주문 삭제"
                        >
                          {deletingId === row.id ? '삭제 중…' : '삭제'}
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            {filteredOrders.length === 0 && !error && <p style={{ padding: 24, textAlign: 'center', color: '#64748b' }}>조회된 주문이 없습니다.</p>}
          </div>
        )}

        {!ordersLoading && searchCondition === 'client' && searchClient.trim() && clientSummary && (
          <div style={{ ...cardStyle, marginTop: 24, display: 'inline-flex', gap: 40, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <div style={{ color: '#64748b', fontSize: 12, marginBottom: 8, width: '100%' }}>위 목록 하단 합계</div>
            <div>
              <div style={{ color: '#64748b', fontSize: 12, marginBottom: 4 }}>판매가 합계</div>
              <div style={{ fontSize: 18, fontWeight: 700 }}>{formatNum(clientSummary.sales)}</div>
            </div>
            <div>
              <div style={{ color: '#64748b', fontSize: 12, marginBottom: 4 }}>수익 합계</div>
              <div style={{ fontSize: 18, fontWeight: 700, color: '#047857' }}>{formatNum(clientSummary.profit)}</div>
            </div>
            <div>
              <div style={{ color: '#64748b', fontSize: 12, marginBottom: 4 }}>주문 건수</div>
              <div style={{ fontSize: 18, fontWeight: 700 }}>{clientSummary.count}건</div>
            </div>
          </div>
        )}

        {!ordersLoading && searchCondition === 'location' && searchLocation.trim() && filteredOrders.length > 0 && (
          <div style={{ ...cardStyle, marginTop: 24 }}>
            <h3 style={{ margin: '0 0 12px', fontSize: 16, fontWeight: 600 }}>해당 장소 배송 수주화원 · 평점 · 사유 · 배송사진</h3>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ borderBottom: '2px solid #e2e8f0', background: '#f8fafc' }}>
                    <th style={thStyle}>배송일</th>
                    <th style={thStyle}>수주화원</th>
                    <th style={thStyle}>평점</th>
                    <th style={thStyle}>사유</th>
                    <th style={thStyle}>배송사진</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredOrders.map((row) => (
                    <tr key={row.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                      <td style={tdStyle}>{row.date ? `${row.date.slice(2, 4)}-${row.date.slice(5, 7)}-${row.date.slice(8, 10)}` : ''}</td>
                      <td style={tdStyle}>{row.partner ?? '-'}</td>
                      <td style={tdStyle}>{row.partner_rating ?? '-'}</td>
                      <td style={tdStyle}>{row.partner_reason ?? '-'}</td>
                      <td style={tdStyle}>
                        <span style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                          {row.delivery_photo && (
                            <button type="button" onClick={() => openPhotoPreview(row.delivery_photo!)} style={{ background: 'none', border: 'none', color: '#334155', fontSize: 13, cursor: 'pointer', textDecoration: 'underline', padding: 0 }}>1 미리보기</button>
                          )}
                          {row.delivery_photo_2 && (
                            <button type="button" onClick={() => openPhotoPreview(row.delivery_photo_2!)} style={{ background: 'none', border: 'none', color: '#334155', fontSize: 13, cursor: 'pointer', textDecoration: 'underline', padding: 0 }}>2 미리보기</button>
                          )}
                          {!row.delivery_photo && !row.delivery_photo_2 && '-'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>

      {photoPreviewUrl && (
        <div
          role="dialog"
          aria-modal="true"
          onClick={closePhotoPreview}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.75)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 9999,
            padding: 24,
          }}
        >
          <button type="button" onClick={closePhotoPreview} style={{ position: 'absolute', top: 16, right: 16, background: '#fff', border: 'none', borderRadius: 8, padding: '8px 16px', fontSize: 14, cursor: 'pointer', fontWeight: 600 }}>닫기</button>
          {photoPreviewFailed && typeof photoPreviewUrl === 'string' && !photoPreviewUrl.startsWith('blob:') ? (
            <div onClick={(e) => e.stopPropagation()} style={{ background: '#fff', padding: 24, borderRadius: 12, maxWidth: 400 }}>
              <p style={{ margin: '0 0 12px', fontSize: 14, color: '#64748b' }}>미리보기를 불러올 수 없습니다.</p>
              <a href={photoPreviewUrl} target="_blank" rel="noopener noreferrer" style={{ fontSize: 14, color: '#334155', wordBreak: 'break-all' }}>새 탭에서 열기</a>
            </div>
          ) : (
            <img
              src={photoPreviewUrl ?? ''}
              alt="배송사진 크게 보기"
              onClick={(e) => e.stopPropagation()}
              onError={() => setPhotoPreviewFailed(true)}
              style={{ maxWidth: '90vw', maxHeight: '90vh', objectFit: 'contain', borderRadius: 8, boxShadow: '0 4px 24px rgba(0,0,0,0.3)' }}
            />
          )}
        </div>
      )}

      {balanceEditOpen && (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 9999,
            padding: 24,
          }}
          onClick={() => !balanceSaving && setBalanceEditOpen(false)}
        >
          <div
            style={{ background: '#fff', padding: 24, borderRadius: 12, boxShadow: '0 4px 24px rgba(0,0,0,0.15)', minWidth: 280 }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{ margin: '0 0 16px', fontSize: 18, fontWeight: 600 }}>월초 충전잔액 입력</h3>
            <p style={{ margin: '0 0 12px', fontSize: 12, color: '#64748b' }}>지금 잔액을 입력하세요. 저장한 시점 이후에 등록하는 주문의 발주가만 차감해 옆에 표시됩니다.</p>
            {balanceEditError && <p style={{ margin: '0 0 12px', fontSize: 13, color: '#dc2626' }}>{balanceEditError}</p>}
            {CHARGED_PROVIDERS.map((p) => (
              <label key={p} style={{ display: 'block', marginBottom: 12 }}>
                <span style={{ display: 'block', fontSize: 12, color: '#64748b', marginBottom: 4 }}>{p}</span>
                <input
                  type="number"
                  value={balanceEditForm[p] ?? ''}
                  onChange={(e) => setBalanceEditForm((prev) => ({ ...prev, [p]: e.target.value }))}
                  style={{ padding: '8px 12px', border: '1px solid #cbd5e1', borderRadius: 8, fontSize: 14, width: '100%' }}
                />
              </label>
            ))}
            <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
              <button type="button" onClick={saveBalanceEdit} disabled={balanceSaving} style={{ padding: '8px 16px', background: '#334155', color: '#fff', border: 'none', borderRadius: 8, fontSize: 14, cursor: balanceSaving ? 'wait' : 'pointer', fontWeight: 600 }}>
                {balanceSaving ? '저장 중…' : '저장'}
              </button>
              <button type="button" onClick={() => setBalanceEditOpen(false)} disabled={balanceSaving} style={{ padding: '8px 16px', background: '#e2e8f0', border: 'none', borderRadius: 8, fontSize: 14, cursor: 'pointer' }}>취소</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

const cardStyle: React.CSSProperties = {
  background: '#fff',
  padding: 20,
  borderRadius: 12,
  boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
}
const inputStyle: React.CSSProperties = {
  padding: '8px 12px',
  border: '1px solid #cbd5e1',
  borderRadius: 8,
  fontSize: 14,
}
const submitBtnStyle: React.CSSProperties = {
  padding: '10px 20px',
  background: '#334155',
  color: '#fff',
  border: 'none',
  borderRadius: 8,
  fontSize: 14,
  fontWeight: 600,
  cursor: 'pointer',
}
const thStyle: React.CSSProperties = {
  textAlign: 'center',
  padding: '12px 16px',
  fontSize: 13,
  fontWeight: 600,
  color: '#475569',
}
const tdStyle: React.CSSProperties = {
  padding: '12px 16px',
  fontSize: 14,
}
const cellInputStyle: React.CSSProperties = {
  padding: '4px 8px',
  border: '1px solid #e2e8f0',
  borderRadius: 6,
  fontSize: 13,
  minWidth: 60,
}
const editBtnStyle: React.CSSProperties = {
  padding: '6px 12px',
  background: '#334155',
  color: '#fff',
  border: 'none',
  borderRadius: 6,
  fontSize: 12,
  cursor: 'pointer',
}
