import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!url || !key) {
  console.warn('VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY not set. Create .env in dashboard/')
}

export const supabase = url && key ? createClient(url, key) : null

export type Order = {
  id: string
  date: string
  client: string | null
  branch: string | null
  request_department: string | null
  item: string | null
  recipient: string | null
  provider: string | null
  partner: string | null
  partner_rating: number | null
  partner_reason: string | null
  delivery_photo: string | null
  delivery_photo_2: string | null
  location: string | null
  region: string | null
  notes: string | null
  price: number | null
  cost: number | null
  profit: number | null
  quantity: number | null
  orderer_name: string | null
  orderer_phone: string | null
  created_at?: string
}
