/**
 * 거래처별 명세/내역서 양식 구분
 * - 일반양식: 하나투어비즈니스 등 나머지 거래처
 * - 노랑풍선: 전용 엑셀
 * - 엔타스·엔타스프레쉬미트·엔타스에스디·퍼시픽스타: 거래명세표
 */

export type ExportFormatType = 'general' | 'yellow_balloon' | 'entas_statement'

/** 노랑풍선 전용 엑셀 양식 (구분, No, 배달일자, 상품명, 발주자, 배송지, 거래처 명, 요청팀, 수령인, 금액, 비고) */
export const YELLOW_BALLOON_CLIENTS = ['노랑풍선'] as const

/** 거래명세표 양식 (월, 일, 품목=경조+지점명, 요청인=받는이, 발송장소, 수량, 공급가액, 세액=0, 금액) */
export const ENTAS_STATEMENT_CLIENTS = [
  '엔타스',
  '엔타스프레쉬미트',
  '엔타스에스디',
  '퍼시픽스타',
] as const

const SPECIAL_CLIENTS = new Set<string>([
  ...YELLOW_BALLOON_CLIENTS,
  ...ENTAS_STATEMENT_CLIENTS,
])

/** 해당 거래처의 내보내기 양식 (일반양식 / 노랑풍선 엑셀 / 엔타스형 명세표) */
export function getExportFormat(client: string | null): ExportFormatType {
  if (client == null) return 'general'
  if (YELLOW_BALLOON_CLIENTS.includes(client as (typeof YELLOW_BALLOON_CLIENTS)[number])) return 'yellow_balloon'
  if ((ENTAS_STATEMENT_CLIENTS as readonly string[]).includes(client)) return 'entas_statement'
  return 'general'
}

export function isYellowBalloonClient(client: string | null): boolean {
  return getExportFormat(client) === 'yellow_balloon'
}

export function isEntasStatementClient(client: string | null): boolean {
  return getExportFormat(client) === 'entas_statement'
}

/** 일반양식 거래처 여부 (하나투어비즈니스 등) */
export function isGeneralFormatClient(client: string | null): boolean {
  return getExportFormat(client) === 'general'
}

/** 특수양식(노랑풍선/엔타스형)이 아닌 거래처만 필터 */
export function filterGeneralFormatClients(clientNames: string[] | undefined | null): string[] {
  if (!Array.isArray(clientNames)) return []
  return clientNames.filter((name) => !SPECIAL_CLIENTS.has(name))
}
