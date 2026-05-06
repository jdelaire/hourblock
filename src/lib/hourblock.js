export const ENTRIES_STORAGE_KEY = 'hourblock.entries.v1'
export const ACTIVE_SESSION_STORAGE_KEY = 'hourblock.activeSession.v1'
export const CLIENTS_STORAGE_KEY = 'hourblock.clients.v1'

const pad = (value) => String(value).padStart(2, '0')

export function formatLocalDate(date = new Date()) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

export function formatLocalTime(date = new Date()) {
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`
}

export function getMonthKey(date = new Date()) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}`
}

export function formatMonthLabel(monthKey) {
  const [year, month] = cleanText(monthKey).split('-').map(Number)
  if (!Number.isFinite(year) || !Number.isFinite(month)) return cleanText(monthKey)

  return new Date(year, month - 1, 1).toLocaleDateString(undefined, {
    month: 'long',
    year: 'numeric',
  })
}

function roundToQuarterHour(date, direction) {
  const rounded = new Date(date)
  const minutes = rounded.getMinutes()
  const remainder = minutes % 15
  const hasPartialMinute = rounded.getSeconds() > 0 || rounded.getMilliseconds() > 0

  if (direction === 'down') {
    rounded.setMinutes(minutes - remainder, 0, 0)
    return rounded
  }

  if (remainder === 0 && !hasPartialMinute) {
    rounded.setSeconds(0, 0)
    return rounded
  }

  rounded.setMinutes(minutes + (15 - remainder), 0, 0)
  return rounded
}

function makeId(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

function cleanText(value) {
  return String(value ?? '').trim()
}

function cleanHourlyRate(value) {
  const rate = Number(value)
  if (!Number.isFinite(rate) || rate < 0) return 0
  return Math.round(rate * 100) / 100
}

function normalizeClient(client) {
  return {
    name: cleanText(client.name),
    hourlyRate: cleanHourlyRate(client.hourlyRate),
    website: cleanText(client.website),
  }
}

export function normalizeTime(value) {
  const text = cleanText(value)
  if (!text) return null

  const twentyFourHourMatch = text.match(/^(\d{1,2}):([0-5]\d)(?::[0-5]\d)?$/)
  if (twentyFourHourMatch) {
    const hour = Number(twentyFourHourMatch[1])
    const minute = Number(twentyFourHourMatch[2])

    if (hour >= 0 && hour <= 23) {
      return `${pad(hour)}:${pad(minute)}`
    }
  }

  const twelveHourMatch = text.match(/^(\d{1,2})(?::([0-5]\d))?\s*([ap])\.?\s*m\.?$/i)
  if (twelveHourMatch) {
    let hour = Number(twelveHourMatch[1])
    const minute = Number(twelveHourMatch[2] || 0)
    const meridiem = twelveHourMatch[3].toLowerCase()

    if (hour >= 1 && hour <= 12) {
      if (meridiem === 'a' && hour === 12) hour = 0
      if (meridiem === 'p' && hour !== 12) hour += 12

      return `${pad(hour)}:${pad(minute)}`
    }
  }

  return null
}

function parseDateTime(date, time) {
  const normalizedTime = normalizeTime(time)
  if (!date || !normalizedTime) return null

  const [year, month, day] = date.split('-').map(Number)
  const [hour, minute] = normalizedTime.split(':').map(Number)

  if (![year, month, day, hour, minute].every(Number.isFinite)) return null

  return new Date(year, month - 1, day, hour, minute)
}

export function calculateDurationMinutes(date, startTime, endTime) {
  const start = parseDateTime(date, startTime)
  const end = parseDateTime(date, endTime)

  if (!start || !end) return 0

  return Math.round((end.getTime() - start.getTime()) / 60000)
}

export function formatHours(minutes) {
  const value = Number(minutes || 0) / 60
  return value.toFixed(2).replace(/\.?0+$/, '')
}

export function createEntry(fields) {
  const date = cleanText(fields.date)
  const startTime = normalizeTime(fields.startTime)
  const endTime = normalizeTime(fields.endTime)

  if (!date || !startTime || !endTime) {
    throw new Error('Use times like 15:30 or 3:30 PM')
  }

  const durationMinutes = calculateDurationMinutes(date, startTime, endTime)

  if (durationMinutes <= 0) {
    throw new Error('End time must be after start time')
  }

  return {
    id: fields.id || makeId('entry'),
    client: cleanText(fields.client),
    date,
    startTime,
    endTime,
    durationMinutes,
    note: cleanText(fields.note),
    billable: fields.billable !== false,
  }
}

export function createStartedSession(fields = {}, now = new Date()) {
  const roundedStart = roundToQuarterHour(now, 'down')

  return {
    id: makeId('session'),
    client: cleanText(fields.client),
    date: formatLocalDate(roundedStart),
    startTime: formatLocalTime(roundedStart),
    startedAt: now.toISOString(),
    note: cleanText(fields.note),
    billable: fields.billable !== false,
  }
}

export function stopSession(session, now = new Date()) {
  const startedAt = session.startedAt
    ? new Date(session.startedAt)
    : parseDateTime(session.date, session.startTime)
  const elapsedMs = now.getTime() - startedAt.getTime()

  if (!Number.isFinite(startedAt.getTime()) || elapsedMs <= 0) {
    throw new Error('Stop time must be after start time')
  }

  const roundedEnd = roundToQuarterHour(now, 'up')
  const recordedStart = parseDateTime(session.date, session.startTime)
  const recordedDurationMinutes = Math.round((roundedEnd.getTime() - recordedStart.getTime()) / 60000)

  if (!recordedStart || recordedDurationMinutes <= 0) {
    throw new Error('Stop time must be after start time')
  }

  return {
    id: makeId('entry'),
    client: cleanText(session.client),
    date: session.date,
    startTime: session.startTime,
    endTime: formatLocalTime(roundedEnd),
    durationMinutes: recordedDurationMinutes,
    note: cleanText(session.note),
    billable: session.billable !== false,
  }
}

export function currentWeekRange(now = new Date()) {
  const date = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const daysSinceMonday = (date.getDay() + 6) % 7
  const start = new Date(date)
  start.setDate(date.getDate() - daysSinceMonday)

  const end = new Date(start)
  end.setDate(start.getDate() + 6)

  return {
    start: formatLocalDate(start),
    end: formatLocalDate(end),
  }
}

export function getTodayBillableMinutes(entries, now = new Date()) {
  const today = formatLocalDate(now)
  return entries
    .filter((entry) => entry.billable && entry.date === today)
    .reduce((total, entry) => total + Number(entry.durationMinutes || 0), 0)
}

export function getWeeklyBillableMinutes(entries, now = new Date()) {
  const { start, end } = currentWeekRange(now)
  return entries
    .filter((entry) => entry.billable && entry.date >= start && entry.date <= end)
    .reduce((total, entry) => total + Number(entry.durationMinutes || 0), 0)
}

export function getEntryMonths(entries, now = new Date()) {
  const months = new Set([getMonthKey(now)])

  for (const entry of entries) {
    const monthKey = cleanText(entry.date).slice(0, 7)
    if (/^\d{4}-\d{2}$/.test(monthKey)) {
      months.add(monthKey)
    }
  }

  return Array.from(months).sort((a, b) => b.localeCompare(a))
}

export function getMonthlyBillableMinutes(entries, monthKey) {
  return entries
    .filter((entry) => entry.billable && cleanText(entry.date).startsWith(`${monthKey}-`))
    .reduce((total, entry) => total + Number(entry.durationMinutes || 0), 0)
}

export function getClientTotals(entries) {
  const totals = new Map()

  for (const entry of entries) {
    if (!entry.billable) continue

    const client = cleanText(entry.client) || 'No client'
    totals.set(client, (totals.get(client) || 0) + Number(entry.durationMinutes || 0))
  }

  return Array.from(totals, ([client, minutes]) => ({
    client,
    minutes,
    hours: formatHours(minutes),
  }))
}

export function getEstimatedRevenue(entries, clients) {
  const rates = new Map(
    clients.map((client) => {
      const normalized = normalizeClient(client)
      return [normalized.name.toLocaleLowerCase(), normalized.hourlyRate]
    }),
  )

  const revenue = entries
    .filter((entry) => entry.billable)
    .reduce((total, entry) => {
      const rate = rates.get(cleanText(entry.client).toLocaleLowerCase()) || 0
      return total + (Number(entry.durationMinutes || 0) / 60) * rate
    }, 0)

  return Math.round(revenue * 100) / 100
}

export function getEstimatedSessionFare(elapsedSeconds, clientName, clients, billable = true) {
  if (!billable) return 0

  const normalizedClientName = cleanText(clientName).toLocaleLowerCase()
  const client = clients
    .map(normalizeClient)
    .find((item) => item.name.toLocaleLowerCase() === normalizedClientName)
  const elapsedHours = Math.max(0, Number(elapsedSeconds || 0)) / 3600
  const fare = elapsedHours * (client?.hourlyRate || 0)

  return Math.round(fare * 100) / 100
}

export function getUniqueClients(entries) {
  const clients = new Map()

  for (const entry of entries) {
    const client = cleanText(entry.client)
    const key = client.toLocaleLowerCase()
    if (client && !clients.has(key)) {
      clients.set(key, client)
    }
  }

  return Array.from(clients.values()).sort((a, b) => a.localeCompare(b))
}

export function filterEntriesByClient(entries, clientName = 'all') {
  const selectedClient = cleanText(clientName)
  if (!selectedClient || selectedClient.toLocaleLowerCase() === 'all') return entries

  return entries.filter((entry) => (
    cleanText(entry.client).toLocaleLowerCase() === selectedClient.toLocaleLowerCase()
  ))
}

function escapeCsv(value) {
  const text = String(value ?? '')
  if (!/[",\n\r]/.test(text)) return text
  return `"${text.replaceAll('"', '""')}"`
}

export function toCsv(entries) {
  const rows = [
    ['Date', 'Client', 'Start', 'End', 'Duration hours', 'Note', 'Billable'],
    ...entries.map((entry) => [
      entry.date.replaceAll('-', '/'),
      entry.client,
      entry.startTime,
      entry.endTime,
      formatHours(entry.durationMinutes),
      entry.note,
      entry.billable ? 'Yes' : 'No',
    ]),
  ]

  return rows.map((row) => row.map(escapeCsv).join(',')).join('\n')
}

function readJson(storage, key, fallback) {
  try {
    const raw = storage.getItem(key)
    return raw ? JSON.parse(raw) : fallback
  } catch {
    return fallback
  }
}

export function loadEntries(storage = window.localStorage) {
  const entries = readJson(storage, ENTRIES_STORAGE_KEY, [])
  if (!Array.isArray(entries)) return []

  return entries
    .filter((entry) => entry && typeof entry === 'object')
    .map((entry) => {
      const date = cleanText(entry.date)
      const rawStartTime = cleanText(entry.startTime)
      const rawEndTime = cleanText(entry.endTime)
      const startTime = normalizeTime(rawStartTime) || rawStartTime
      const endTime = normalizeTime(rawEndTime) || rawEndTime
      const durationMinutes = Math.max(0, calculateDurationMinutes(date, startTime, endTime))

      return {
        id: entry.id || makeId('entry'),
        client: cleanText(entry.client),
        date,
        startTime,
        endTime,
        durationMinutes,
        note: cleanText(entry.note),
        billable: entry.billable !== false,
      }
    })
}

export function saveEntries(entries, storage = window.localStorage) {
  storage.setItem(ENTRIES_STORAGE_KEY, JSON.stringify(entries))
}

export function loadClients(storage = window.localStorage) {
  const storedClients = readJson(storage, CLIENTS_STORAGE_KEY, [])
  if (!Array.isArray(storedClients)) return []

  const clientsByName = new Map()

  for (const client of storedClients) {
    if (!client || typeof client !== 'object') continue

    const normalized = normalizeClient(client)
    if (!normalized.name) continue

    clientsByName.set(normalized.name.toLocaleLowerCase(), normalized)
  }

  return Array.from(clientsByName.values())
}

export function saveClients(clients, storage = window.localStorage) {
  storage.setItem(CLIENTS_STORAGE_KEY, JSON.stringify(clients.map(normalizeClient)))
}

export function loadActiveSession(storage = window.localStorage) {
  const session = readJson(storage, ACTIVE_SESSION_STORAGE_KEY, null)
  if (!session || typeof session !== 'object') return null

  return {
    id: session.id || makeId('session'),
    client: cleanText(session.client),
    date: cleanText(session.date),
    startTime: cleanText(session.startTime),
    startedAt: session.startedAt,
    note: cleanText(session.note),
    billable: session.billable !== false,
  }
}

export function saveActiveSession(session, storage = window.localStorage) {
  if (!session) {
    storage.removeItem(ACTIVE_SESSION_STORAGE_KEY)
    return
  }

  storage.setItem(ACTIVE_SESSION_STORAGE_KEY, JSON.stringify(session))
}
