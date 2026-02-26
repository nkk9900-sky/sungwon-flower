/**
 * POST { "url": "https://..." } → fetch page, strip HTML, return { "text": "..." }.
 * Used to extract text from 근조/청첩 URLs for order form auto-fill.
 */
export const config = { maxDuration: 15 }

export async function POST(request: Request) {
  try {
    const body = await request.json() as { url?: string }
    const url = typeof body?.url === 'string' ? body.url.trim() : ''
    if (!url || !url.startsWith('http')) {
      return Response.json({ error: '유효한 URL을 입력하세요.' }, { status: 400 })
    }
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 10000)
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; SeongwonFlower/1)' },
      redirect: 'follow',
    })
    clearTimeout(timeout)
    if (!res.ok) {
      return Response.json({ error: `페이지를 가져올 수 없습니다 (${res.status})` }, { status: 400 })
    }
    const html = await res.text()
    const text = stripHtml(html)
    return Response.json({ text })
  } catch (e) {
    const msg = e instanceof Error ? e.message : '요청 실패'
    return Response.json({ error: msg }, { status: 500 })
  }
}

function stripHtml(html: string): string {
  let s = html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
  s = s.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
  return s.replace(/\s+/g, ' ').trim()
}
