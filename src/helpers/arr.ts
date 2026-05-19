import axios from 'axios'

const MONTHS = 12
const CACHE_TTL = 30 * 60 * 1000

interface ArrPoint {
  month: string
  monthlyRecurringRevenue: number
  annualRecurringRevenue: number
}

interface ArrResponse {
  configured: boolean
  currency: string
  history: ArrPoint[]
  includes: string[]
  excludes: string[]
}

interface StripeInvoiceLine {
  amount: number
  currency: string
  type?: string
  price?: {
    recurring?: {
      interval: string
    }
  }
}

interface StripeInvoice {
  created: number
  currency: string
  status: string
  subscription?: string
  lines?: {
    data: StripeInvoiceLine[]
  }
}

interface StripeList<T> {
  data: T[]
  has_more: boolean
}

const includes = [
  'Paid Stripe invoices with subscription-backed recurring line items.',
  'Monthly recurring revenue is grouped by invoice month and annualized as MRR x 12.',
]

const excludes = [
  'One-time invoice items, usage without recurring price metadata, unpaid invoices, taxes, refunds, disputes, and non-Stripe revenue.',
]

let cache:
  | {
      expiresAt: number
      data: ArrResponse
    }
  | undefined

function monthKey(date: Date) {
  return `${date.getFullYear()}-${date.getMonth() + 1 > 9 ? '' : '0'}${
    date.getMonth() + 1
  }`
}

function months() {
  const result: string[] = []
  const date = new Date()
  date.setDate(1)
  date.setHours(0, 0, 0, 0)
  date.setMonth(date.getMonth() - (MONTHS - 1))
  for (let i = 0; i < MONTHS; i++) {
    result.push(monthKey(date))
    date.setMonth(date.getMonth() + 1)
  }
  return result
}

function query(params: { [key: string]: string | number | undefined }) {
  return Object.keys(params)
    .filter((key) => params[key] !== undefined)
    .map(
      (key) =>
        `${encodeURIComponent(key)}=${encodeURIComponent(`${params[key]}`)}`
    )
    .join('&')
}

async function stripeGet<T>(path: string, params: { [key: string]: any }) {
  const stripeSecret = process.env.STRIPE_SECRET_KEY || process.env.STRIPE_SECRET
  const url = `https://api.stripe.com/v1/${path}?${query(params)}`
  return (
    await axios.get(url, {
      headers: {
        Authorization: `Bearer ${stripeSecret}`,
      },
    })
  ).data as T
}

function recurringAmount(line: StripeInvoiceLine) {
  if (!line.price || !line.price.recurring) {
    return 0
  }
  return line.amount || 0
}

function emptyArrResponse(configured: boolean): ArrResponse {
  return {
    configured,
    currency: 'usd',
    history: months().map((month) => ({
      month,
      monthlyRecurringRevenue: 0,
      annualRecurringRevenue: 0,
    })),
    includes,
    excludes,
  }
}

export async function arr(): Promise<ArrResponse> {
  const stripeSecret = process.env.STRIPE_SECRET_KEY || process.env.STRIPE_SECRET
  if (!stripeSecret) {
    return emptyArrResponse(false)
  }

  if (cache && cache.expiresAt > Date.now()) {
    return cache.data
  }

  const monthKeys = months()
  const monthlyRevenue: { [month: string]: number } = {}
  for (const month of monthKeys) {
    monthlyRevenue[month] = 0
  }

  const since = new Date()
  since.setDate(1)
  since.setHours(0, 0, 0, 0)
  since.setMonth(since.getMonth() - (MONTHS - 1))

  let startingAfter: string | undefined
  let currency = 'usd'
  do {
    const invoices = await stripeGet<StripeList<StripeInvoice>>('invoices', {
      limit: 100,
      status: 'paid',
      'created[gte]': Math.floor(since.getTime() / 1000),
      starting_after: startingAfter,
    })

    for (const invoice of invoices.data) {
      const key = monthKey(new Date(invoice.created * 1000))
      if (monthlyRevenue[key] === undefined || !invoice.subscription) {
        continue
      }
      currency = invoice.currency || currency
      const lines = invoice.lines && invoice.lines.data ? invoice.lines.data : []
      monthlyRevenue[key] += lines
        .map(recurringAmount)
        .reduce((a, b) => a + b, 0)
    }

    startingAfter = invoices.has_more
      ? (invoices.data[invoices.data.length - 1] as any).id
      : undefined
  } while (startingAfter)

  const data = {
    configured: true,
    currency,
    history: monthKeys.map((month) => {
      const monthlyRecurringRevenue = Math.round(monthlyRevenue[month]) / 100
      return {
        month,
        monthlyRecurringRevenue,
        annualRecurringRevenue: monthlyRecurringRevenue * 12,
      }
    }),
    includes,
    excludes,
  }

  cache = {
    expiresAt: Date.now() + CACHE_TTL,
    data,
  }

  return data
}
