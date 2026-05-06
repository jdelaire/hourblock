import { describe, expect, it } from 'vitest'
import {
  calculateDurationMinutes,
  createEntry,
  createStartedSession,
  filterEntriesByClient,
  currentWeekRange,
  formatHours,
  formatMonthLabel,
  getEntryMonths,
  getEstimatedRevenue,
  getEstimatedSessionFare,
  getClientTotals,
  getCsvFilename,
  getMonthlyBillableMinutes,
  getUniqueClients,
  getWeeklyBillableMinutes,
  loadActiveSession,
  loadClients,
  loadEntries,
  stopSession,
  toCsv,
} from './hourblock.js'

describe('HourBlock time tracking logic', () => {
  it('calculates same-day manual entry duration in minutes', () => {
    expect(calculateDurationMinutes('2026-04-27', '09:00', '11:30')).toBe(150)
  })

  it('accepts 12-hour manual entry times and stores normalized 24-hour values', () => {
    const entry = createEntry({
      client: 'Acme Studio',
      date: '2026-04-27',
      startTime: '03:30 PM',
      endTime: '06:30 PM',
      note: 'Project scaffold',
      billable: true,
    })

    expect(entry.startTime).toBe('15:30')
    expect(entry.endTime).toBe('18:30')
    expect(entry.durationMinutes).toBe(180)
  })

  it('rejects manual entries where the end time is not after the start time', () => {
    expect(() => createEntry({
      client: 'Acme Studio',
      date: '2026-04-27',
      startTime: '14:00',
      endTime: '13:45',
      note: 'Backwards time',
      billable: true,
    })).toThrow('End time must be after start time')
  })

  it('starts and stops a billable session with editable client and note fields', () => {
    const started = createStartedSession(
      { client: 'Acme Studio', note: 'Audit', billable: true },
      new Date('2026-04-27T09:00:00+07:00'),
    )

    expect(started).toMatchObject({
      client: 'Acme Studio',
      note: 'Audit',
      billable: true,
      date: '2026-04-27',
      startTime: '09:00',
    })

    const entry = stopSession(started, new Date('2026-04-27T11:30:00+07:00'))

    expect(entry).toMatchObject({
      client: 'Acme Studio',
      date: '2026-04-27',
      startTime: '09:00',
      endTime: '11:30',
      durationMinutes: 150,
      billable: true,
      note: 'Audit',
    })
  })

  it('rounds live timer starts down and stops up to quarter-hour cuts', () => {
    const started = createStartedSession(
      { client: 'Acme Studio', note: '', billable: true },
      new Date('2026-04-27T08:01:00+07:00'),
    )

    expect(started.startTime).toBe('08:00')

    const entry = stopSession(started, new Date('2026-04-27T18:10:00+07:00'))

    expect(entry).toMatchObject({
      startTime: '08:00',
      endTime: '18:15',
      durationMinutes: 615,
    })
  })

  it('totals only billable entries for a Monday-start week', () => {
    const entries = [
      createEntry({ client: 'Acme Studio', date: '2026-04-27', startTime: '09:00', endTime: '11:00', note: '', billable: true }),
      createEntry({ client: 'ThaiQuest', date: '2026-05-01', startTime: '10:00', endTime: '11:30', note: '', billable: true }),
      createEntry({ client: 'Internal', date: '2026-04-30', startTime: '13:00', endTime: '14:00', note: '', billable: false }),
      createEntry({ client: 'Old', date: '2026-04-26', startTime: '13:00', endTime: '15:00', note: '', billable: true }),
    ]

    expect(currentWeekRange(new Date('2026-04-30T12:00:00+07:00'))).toEqual({
      start: '2026-04-27',
      end: '2026-05-03',
    })
    expect(getWeeklyBillableMinutes(entries, new Date('2026-04-30T12:00:00+07:00'))).toBe(210)
  })

  it('builds month navigation from current month and months with entries', () => {
    const entries = [
      createEntry({ client: 'Acme Studio', date: '2026-03-31', startTime: '09:00', endTime: '10:00', note: '', billable: true }),
      createEntry({ client: 'Acme Studio', date: '2026-04-27', startTime: '09:00', endTime: '10:00', note: '', billable: true }),
      createEntry({ client: 'Acme Studio', date: '2026-04-28', startTime: '09:00', endTime: '10:00', note: '', billable: true }),
    ]

    expect(getEntryMonths(entries, new Date('2026-05-01T12:00:00+07:00'))).toEqual([
      '2026-05',
      '2026-04',
      '2026-03',
    ])
    expect(formatMonthLabel('2026-05')).toBe('May 2026')
  })

  it('totals only billable entries inside selected month', () => {
    const entries = [
      createEntry({ client: 'Acme Studio', date: '2026-05-01', startTime: '09:00', endTime: '11:00', note: '', billable: true }),
      createEntry({ client: 'Beta Labs', date: '2026-05-15', startTime: '10:00', endTime: '11:30', note: '', billable: true }),
      createEntry({ client: 'Acme Studio', date: '2026-05-20', startTime: '13:00', endTime: '14:00', note: '', billable: false }),
      createEntry({ client: 'Acme Studio', date: '2026-04-30', startTime: '09:00', endTime: '12:00', note: '', billable: true }),
    ]

    expect(getMonthlyBillableMinutes(entries, '2026-05')).toBe(210)
  })

  it('groups billable hours by client for the visible entry list', () => {
    const totals = getClientTotals([
      createEntry({ client: 'Acme Studio', date: '2026-04-27', startTime: '09:00', endTime: '17:30', note: '', billable: true }),
      createEntry({ client: 'ThaiQuest', date: '2026-04-27', startTime: '18:00', endTime: '20:00', note: '', billable: true }),
      createEntry({ client: '', date: '2026-04-27', startTime: '20:00', endTime: '20:30', note: '', billable: true }),
      createEntry({ client: 'Acme Studio', date: '2026-04-28', startTime: '10:00', endTime: '11:00', note: '', billable: false }),
    ])

    expect(totals).toEqual([
      { client: 'Acme Studio', minutes: 510, hours: '8.5' },
      { client: 'ThaiQuest', minutes: 120, hours: '2' },
      { client: 'No client', minutes: 30, hours: '0.5' },
    ])
  })

  it('estimates revenue from billable entries using each client hourly rate', () => {
    const entries = [
      createEntry({ client: 'Acme Studio', date: '2026-04-27', startTime: '09:00', endTime: '11:00', note: '', billable: true }),
      createEntry({ client: 'Beta Labs', date: '2026-04-27', startTime: '11:00', endTime: '11:30', note: '', billable: true }),
      createEntry({ client: 'Acme Studio', date: '2026-04-27', startTime: '12:00', endTime: '13:00', note: '', billable: false }),
      createEntry({ client: '', date: '2026-04-27', startTime: '13:00', endTime: '14:00', note: '', billable: true }),
    ]
    const clients = [
      { name: 'Acme Studio', hourlyRate: 100 },
      { name: 'Beta Labs', hourlyRate: 200 },
    ]

    expect(getEstimatedRevenue(entries, clients)).toBe(300)
  })

  it('estimates an active session fare from elapsed seconds and client hourly rate', () => {
    const clients = [
      { name: 'Acme Studio', hourlyRate: 120 },
      { name: 'Beta Labs', hourlyRate: 200 },
    ]

    expect(getEstimatedSessionFare(5400, 'Acme Studio', clients, true)).toBe(180)
    expect(getEstimatedSessionFare(5400, 'Acme Studio', clients, false)).toBe(0)
    expect(getEstimatedSessionFare(5400, 'Unknown', clients, true)).toBe(0)
  })

  it('starts without bundled client configuration', () => {
    const storage = {
      getItem: () => null,
    }

    expect(loadClients(storage)).toEqual([])
  })

  it('loads editable client info from local storage', () => {
    const storage = {
      getItem: () => JSON.stringify([
        { name: 'Acme Studio', hourlyRate: '125.50', website: 'https://example.com' },
      ]),
    }

    expect(loadClients(storage)).toEqual([
      { name: 'Acme Studio', hourlyRate: 125.5, website: 'https://example.com' },
    ])
  })

  it('recovers entries from legacy BlockLog local storage', () => {
    const storedEntry = {
      id: 'entry-legacy',
      client: 'Acme Studio',
      date: '2026-04-27',
      startTime: '09:00',
      endTime: '11:30',
      durationMinutes: 150,
      note: 'Legacy entry',
      billable: true,
    }
    const writes = []
    const storage = {
      getItem: (key) => (key === 'blocklog.entries.v1' ? JSON.stringify([storedEntry]) : null),
      setItem: (key, value) => writes.push([key, value]),
    }

    expect(loadEntries(storage)).toEqual([storedEntry])
    expect(writes).toEqual([
      ['hourblock.entries.v1', JSON.stringify([storedEntry])],
    ])
  })

  it('recovers clients from legacy BlockLog local storage', () => {
    const storedClient = { name: 'Acme Studio', hourlyRate: '125.50', website: 'https://example.com' }
    const writes = []
    const storage = {
      getItem: (key) => (key === 'blocklog.clients.v1' ? JSON.stringify([storedClient]) : null),
      setItem: (key, value) => writes.push([key, value]),
    }

    expect(loadClients(storage)).toEqual([
      { name: 'Acme Studio', hourlyRate: 125.5, website: 'https://example.com' },
    ])
    expect(writes).toEqual([
      ['hourblock.clients.v1', JSON.stringify([storedClient])],
    ])
  })

  it('recovers an active session from legacy BlockLog local storage', () => {
    const storedSession = {
      id: 'session-legacy',
      client: 'Acme Studio',
      date: '2026-04-27',
      startTime: '09:00',
      startedAt: '2026-04-27T02:00:00.000Z',
      note: 'Legacy session',
      billable: true,
    }
    const writes = []
    const storage = {
      getItem: (key) => (key === 'blocklog.activeSession.v1' ? JSON.stringify(storedSession) : null),
      setItem: (key, value) => writes.push([key, value]),
    }

    expect(loadActiveSession(storage)).toEqual(storedSession)
    expect(writes).toEqual([
      ['hourblock.activeSession.v1', JSON.stringify(storedSession)],
    ])
  })

  it('exports CSV with escaped notes and slash-formatted dates', () => {
    const csv = toCsv([
      createEntry({
        client: 'Acme Studio',
        date: '2026-04-27',
        startTime: '09:00',
        endTime: '11:30',
        note: 'Facebook page audit and "priority" recommendations',
        billable: true,
      }),
    ])

    expect(csv).toBe([
      'Date,Client,Start,End,Duration hours,Note,Billable',
      '2026/04/27,Acme Studio,09:00,11:30,2.5,"Facebook page audit and ""priority"" recommendations",Yes',
    ].join('\n'))
  })

  it('builds CSV filenames from the selected data month and client', () => {
    expect(getCsvFilename('2026-04', 'Acme Studio')).toBe('hourblock-2026-04-acme-studio.csv')
    expect(getCsvFilename('2026-04', 'all')).toBe('hourblock-2026-04-all-clients.csv')
    expect(getCsvFilename('2026-04', 'Client / Research & Dev')).toBe('hourblock-2026-04-client-research-dev.csv')
  })

  it('filters export entries by selected client and treats all as unfiltered', () => {
    const entries = [
      createEntry({ client: 'Acme Studio', date: '2026-04-27', startTime: '09:00', endTime: '11:00', note: '', billable: true }),
      createEntry({ client: 'Beta Labs', date: '2026-04-27', startTime: '11:00', endTime: '12:00', note: '', billable: true }),
      createEntry({ client: 'acme studio', date: '2026-04-28', startTime: '13:00', endTime: '14:00', note: '', billable: false }),
    ]

    expect(filterEntriesByClient(entries, 'all')).toEqual(entries)
    expect(filterEntriesByClient(entries, 'Acme Studio')).toEqual([entries[0], entries[2]])
  })

  it('builds client suggestions from saved entries', () => {
    const clients = getUniqueClients([
      { client: 'Acme Studio' },
      { client: ' ThaiQuest ' },
      { client: 'acme studio' },
      { client: '' },
    ])

    expect(clients).toEqual(['Acme Studio', 'ThaiQuest'])
  })

  it('keeps stored edited entries visible when their times are temporarily invalid', () => {
    const storage = {
      getItem: () => JSON.stringify([
        {
          id: 'entry-1',
          client: 'Acme Studio',
          date: '2026-04-27',
          startTime: '14:00',
          endTime: '13:00',
          durationMinutes: 0,
          note: 'Fixing a row edit',
          billable: true,
        },
      ]),
    }

    expect(loadEntries(storage)).toEqual([
      {
        id: 'entry-1',
        client: 'Acme Studio',
        date: '2026-04-27',
        startTime: '14:00',
        endTime: '13:00',
        durationMinutes: 0,
        note: 'Fixing a row edit',
        billable: true,
      },
    ])
  })

  it('formats decimal hours without noisy trailing zeros', () => {
    expect(formatHours(150)).toBe('2.5')
    expect(formatHours(120)).toBe('2')
    expect(formatHours(125)).toBe('2.08')
  })
})
