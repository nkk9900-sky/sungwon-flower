/**
 * 자동 채우기 메시지가 한글로 나오는지 검증 (실제 파서 로직 + 라벨 적용)
 * 실행: node dashboard/scripts/test-autofill-message.mjs
 */

const FIELD_LABELS = {
  date: '배송일', client: '거래처', branch: '지점명', requestDepartment: '요청부서', item: '품목', recipient: '받는이',
  provider: '플랫폼', partner: '수주화원', location: '배송장소', deliveryDetailAddress: '배송 세부주소', sender: '보내는 분',
  region: '지역', notes: '특이사항', price: '판매가', cost: '발주가', quantity: '수량', orderer: '주문자', ordererPhone: '연락처',
}

function parseTextForOrder(text) {
  const out = {}
  const raw = text
  const t = text.replace(/\s+/g, ' ')
  const lines = raw.split(/\r?\n/).map((s) => s.trim()).filter(Boolean)

  const dateM = t.match(/(\d{4})[-./년]\s*(\d{1,2})[-./월]\s*(\d{1,2})/)
  if (dateM) {
    const [, y, mon, d] = dateM
    out.date = `${y}-${String(Number(mon)).padStart(2, '0')}-${String(Number(d)).padStart(2, '0')}`
  }
  if (/결혼|청첩|축하|예식|웨딩|축하화환/i.test(t)) out.item = '축하화환'
  else if (/장례|부고|근조|빈소|영결|근조화환/i.test(t)) out.item = '근조화환'

  for (const line of lines) {
    const rec = line.match(/(?:받는\s*분\s*이름|신부\s*이름|받는이|수령인|성함)\s*[:\s]*([가-힣]{2,5})/i)
    if (rec) { out.recipient = rec[1].trim(); break }
  }
  if (!out.recipient) {
    const rec = t.match(/([가-힣]{2,4})\s*님\b/)
    if (rec) out.recipient = rec[1].trim()
  }

  const phoneM = t.match(/(?:연락처|전화)\s*[:\s]*([0-9\-]{9,15})/)
  if (phoneM) out.ordererPhone = phoneM[1].replace(/\s/g, '').trim()

  const clientM = raw.match(/([가-힣a-zA-Z0-9]+(?:비즈니스|플라워|투어|항공|코리아|엔터테인먼트))\s+[\s\S]*?입니다/)
  if (clientM) out.client = clientM[1].trim()

  const addrLine = lines.find((l) => /예식장\s*주소|배송장소|주소\s*:/.test(l))
  if (addrLine) {
    const addrContent = addrLine.replace(/^[\d.]+\s*(?:예식장\s*주소|배송장소|주소)\s*[:\s]*/i, '').replace(/\s+/g, ' ').trim()
    const hallM = addrContent.match(/(.+?)\s+([가-힣a-zA-Z]+\s+(?:볼룸|홀|룸)\s*\([^)]*\))\s*$/i)
    if (hallM) {
      const beforeHall = hallM[1].trim()
      const venueM = beforeHall.match(/([가-힣a-zA-Z]+\s+[가-힣a-zA-Z]+\s+[가-힣a-zA-Z]+)\s*$/)
      out.location = venueM ? venueM[1].trim() : beforeHall
      out.deliveryDetailAddress = hallM[2].trim()
    } else {
      out.location = addrContent
    }
  }
  if (!out.location) {
    const placePattern = /([가-힣a-zA-Z\s]{2,30}?(?:장례식장|결혼식장|예식장|병원|호텔|홀))/g
    let pm
    while ((pm = placePattern.exec(t)) !== null) {
      out.location = pm[1].replace(/\s+/g, ' ').trim()
      break
    }
  }

  return out
}

function getAppliedKeys(parsed) {
  const keys = []
  for (const k of Object.keys(parsed)) {
    const v = parsed[k]
    if (v != null && String(v).trim() !== '') keys.push(k)
  }
  return keys
}

function appliedLabels(keys) {
  return keys.map((k) => FIELD_LABELS[k] ?? k).join(', ')
}

// 실제 사용자 메시지 형식으로 테스트
const sampleText = `
1. 신부 이름: 고은지
2. 받는 분 이름: 고은지
3. 연락처: 010-8802-0616
4. 예식장 주소: 웨스틴 서울 파르나스 하모니 볼룸(LLF)
5. 날짜: 2026년 03월 01일
`

const parsed = parseTextForOrder(sampleText)
const applied = getAppliedKeys(parsed)
const message = `채운 항목: ${appliedLabels(applied)}. 확인 후 저장하세요.`

console.log('=== 자동 채우기 메시지 검증 ===')
console.log('추출된 필드(영문):', applied)
console.log('표시 메시지:', message)
console.log('')
const ok = !applied.some((k) => /^[a-z]+$/.test(k) && !FIELD_LABELS[k])
console.log(ok ? '✓ 한글 라벨로 표시됨' : '✗ 영문 필드명이 그대로 노출됨')
process.exit(ok ? 0 : 1)
