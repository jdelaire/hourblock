<script setup>
import { computed, onMounted, onUnmounted, reactive, ref, watch } from 'vue'
import {
  calculateDurationMinutes,
  createEntry,
  createStartedSession,
  filterEntriesByClient,
  formatHours,
  formatLocalDate,
  formatMonthLabel,
  getClientTotals,
  getEntryMonths,
  getEstimatedRevenue,
  getEstimatedSessionFare,
  getMonthKey,
  getMonthlyBillableMinutes,
  getUniqueClients,
  loadClients,
  loadActiveSession,
  loadEntries,
  saveActiveSession,
  saveClients,
  saveEntries,
  stopSession,
  toCsv,
} from './lib/hourblock.js'

const EXPORT_ALL_CLIENTS = 'all'

const defaultStartDraft = () => ({
  client: '',
  note: '',
  billable: true,
})

const defaultManualDraft = () => ({
  client: '',
  date: formatLocalDate(),
  startTime: '',
  endTime: '',
  note: '',
  billable: true,
})

const entries = ref(loadEntries())
const clients = ref(loadClients())
const activeSession = ref(loadActiveSession())
const startDraft = reactive(defaultStartDraft())
const manualDraft = reactive(defaultManualDraft())
const clientDraft = reactive({
  name: '',
  hourlyRate: 0,
  website: '',
})
const manualError = ref('')
const activeError = ref('')
const clientError = ref('')
const entryErrors = ref({})
const now = ref(Date.now())
const selectedMonth = ref(getMonthKey(new Date(now.value)))
const exportClient = ref(EXPORT_ALL_CLIENTS)
const detailsOpen = ref(false)

let clock = null

onMounted(() => {
  document.title = 'HourBlock'
  clock = window.setInterval(() => {
    now.value = Date.now()
  }, 1000)
})

onUnmounted(() => {
  if (clock) window.clearInterval(clock)
})

watch(entries, (value) => saveEntries(value), { deep: true })
watch(clients, (value) => saveClients(value), { deep: true })
watch(activeSession, (value) => saveActiveSession(value), { deep: true })

const availableMonths = computed(() => getEntryMonths(entries.value, new Date(now.value)))
const displayedEntries = computed(() => entries.value
  .filter((entry) => entry.date.startsWith(`${selectedMonth.value}-`))
  .sort((a, b) => {
  const left = `${b.date} ${b.startTime} ${b.id}`
  const right = `${a.date} ${a.startTime} ${a.id}`
  return left.localeCompare(right)
}))

const monthlyTotal = computed(() => formatHours(getMonthlyBillableMinutes(entries.value, selectedMonth.value)))
const clientTotals = computed(() => getClientTotals(displayedEntries.value))
const clientOptions = computed(() => clients.value.map((client) => client.name))
const exportClientOptions = computed(() => {
  const options = new Map()

  for (const client of clientOptions.value) {
    const name = client.trim()
    if (name) options.set(name.toLocaleLowerCase(), name)
  }

  for (const client of getUniqueClients(displayedEntries.value)) {
    const name = client.trim()
    if (name && !options.has(name.toLocaleLowerCase())) {
      options.set(name.toLocaleLowerCase(), name)
    }
  }

  return Array.from(options.values())
})
const exportEntries = computed(() => filterEntriesByClient(displayedEntries.value, exportClient.value))
const estimatedRevenue = computed(() => formatRevenue(getEstimatedRevenue(displayedEntries.value, clients.value)))
const activeMissingClient = computed(() => activeSession.value && !activeSession.value.client.trim())
const manualMissingClient = computed(() => !manualDraft.client.trim())
const activeElapsedSeconds = computed(() => {
  if (!activeSession.value?.startedAt) return 0
  return Math.max(0, Math.floor((now.value - new Date(activeSession.value.startedAt).getTime()) / 1000))
})
const activeEstimatedFare = computed(() => {
  if (!activeSession.value) return formatFare(0)

  return formatFare(getEstimatedSessionFare(
    activeElapsedSeconds.value,
    activeSession.value.client,
    clients.value,
    activeSession.value.billable,
  ))
})

watch(availableMonths, (months) => {
  if (!months.includes(selectedMonth.value)) {
    selectedMonth.value = getMonthKey(new Date(now.value))
  }
}, { immediate: true })

watch(exportClientOptions, (options) => {
  if (
    exportClient.value !== EXPORT_ALL_CLIENTS
    && !options.some((client) => client.toLocaleLowerCase() === exportClient.value.toLocaleLowerCase())
  ) {
    exportClient.value = EXPORT_ALL_CLIENTS
  }
})

function resetStartDraft() {
  Object.assign(startDraft, defaultStartDraft())
}

function resetManualDraft() {
  Object.assign(manualDraft, defaultManualDraft())
}

function resetClientDraft() {
  Object.assign(clientDraft, {
    name: '',
    hourlyRate: 0,
    website: '',
  })
}

function formatTimer(totalSeconds) {
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  return [hours, minutes, seconds].map((part) => String(part).padStart(2, '0')).join(':')
}

function formatRevenue(value) {
  return Number(value || 0).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

function formatFare(value) {
  return Number(value || 0).toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

function startWork() {
  activeError.value = ''
  activeSession.value = createStartedSession(startDraft, new Date(now.value))
}

function stopWork() {
  activeError.value = ''

  try {
    const entry = stopSession(activeSession.value, new Date())
    entries.value = [entry, ...entries.value]
    activeSession.value = null
    resetStartDraft()
  } catch (error) {
    activeError.value = error.message
  }
}

function submitManualEntry() {
  manualError.value = ''

  try {
    const entry = createEntry(manualDraft)
    entries.value = [entry, ...entries.value]
    resetManualDraft()
  } catch (error) {
    manualError.value = error.message
  }
}

function addClient() {
  clientError.value = ''

  const name = clientDraft.name.trim()
  if (!name) {
    clientError.value = 'Client name is required'
    return
  }

  const existingIndex = clients.value.findIndex((client) => (
    client.name.toLocaleLowerCase() === name.toLocaleLowerCase()
  ))
  const client = {
    name,
    hourlyRate: Number.isFinite(Number(clientDraft.hourlyRate))
      ? Math.max(0, Math.round(Number(clientDraft.hourlyRate) * 100) / 100)
      : 0,
    website: clientDraft.website.trim(),
  }

  if (existingIndex >= 0) {
    clients.value.splice(existingIndex, 1, client)
  } else {
    clients.value.push(client)
  }

  resetClientDraft()
}

function deleteClient(clientName) {
  clients.value = clients.value.filter((client) => client.name !== clientName)
}

function recalculateEntry(entry) {
  try {
    const updatedEntry = createEntry(entry)
    Object.assign(entry, updatedEntry)

    const nextErrors = { ...entryErrors.value }
    delete nextErrors[entry.id]
    entryErrors.value = nextErrors
  } catch (error) {
    const durationMinutes = calculateDurationMinutes(entry.date, entry.startTime, entry.endTime)
    entry.durationMinutes = Math.max(0, durationMinutes)
    entryErrors.value = {
      ...entryErrors.value,
      [entry.id]: error.message,
    }
  }
}

function deleteEntry(entry) {
  if (!window.confirm(`Delete this ${formatHours(entry.durationMinutes)}h entry?`)) return

  entries.value = entries.value.filter((item) => item.id !== entry.id)
}

function exportCsv() {
  const csv = toCsv(exportEntries.value)
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  const clientSlug = exportClient.value === EXPORT_ALL_CLIENTS
    ? 'all-clients'
    : exportClient.value.trim().replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase()

  link.href = url
  link.download = `hourblock-${formatLocalDate()}-${clientSlug}.csv`
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}
</script>

<template>
  <div class="meter-page min-h-screen text-zinc-950">
    <main class="fare-stage" :class="{ 'fare-stage--details-open': detailsOpen }">
      <section class="taxi-meter fare-counter" aria-live="polite" aria-label="Fare counter">
        <div class="taxi-meter__stripe" />
        <div class="taxi-meter__header">
          <span>Fare meter</span>
          <span>{{ activeSession ? 'Running' : 'Ready' }}</span>
        </div>
        <div class="taxi-meter__readouts fare-counter__readouts">
          <div class="taxi-meter__readout fare-counter__readout">
            <span>Time spent</span>
            <strong>{{ formatTimer(activeElapsedSeconds) }}</strong>
          </div>
          <div class="taxi-meter__readout fare-counter__readout">
            <span>Estimated fare</span>
            <strong>{{ activeEstimatedFare }}</strong>
          </div>
        </div>
        <p class="taxi-meter__note">
          <template v-if="activeSession && activeSession.billable">Fare uses the selected client hourly rate.</template>
          <template v-else-if="activeSession">Not billable, so the meter stays at $0.00.</template>
          <template v-else>Select a client with an hourly rate before starting.</template>
        </p>
      </section>
    </main>

    <button
      type="button"
      class="details-tab"
      :aria-expanded="String(detailsOpen)"
      aria-controls="hourblock-details"
      @click="detailsOpen = !detailsOpen"
    >
      {{ detailsOpen ? 'Hide details' : 'Details' }}
    </button>

    <button
      v-if="detailsOpen"
      type="button"
      class="details-scrim"
      aria-label="Hide details"
      @click="detailsOpen = false"
    />

    <aside
      id="hourblock-details"
      class="details-drawer"
      :class="{ 'details-drawer--open': detailsOpen }"
      :aria-hidden="String(!detailsOpen)"
      :inert="!detailsOpen"
      aria-label="HourBlock details"
    >
      <div class="details-drawer__inner">
        <header class="details-header">
          <div>
            <p class="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-700">Local-first time tracker</p>
            <h1 class="mt-2 text-3xl font-semibold tracking-normal text-slate-950">HourBlock</h1>
          </div>

          <div class="grid gap-3 sm:grid-cols-[minmax(11rem,14rem)_auto] sm:items-end">
            <label class="block">
              <span class="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Export client</span>
              <select
                v-model="exportClient"
                class="mt-1 h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
              >
                <option :value="EXPORT_ALL_CLIENTS">All</option>
                <option v-for="client in exportClientOptions" :key="client" :value="client">{{ client }}</option>
              </select>
            </label>

            <button
              type="button"
              class="inline-flex h-11 items-center justify-center rounded-lg border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-900 shadow-sm transition hover:border-slate-400 hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2"
              @click="exportCsv"
            >
              Export CSV
            </button>
          </div>
        </header>

        <main class="details-layout">
          <div class="space-y-6">
            <section class="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
              <div class="mb-5 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <p class="taxi-kicker">HourBlock cab meter</p>
                  <h2 class="text-xl font-black uppercase text-zinc-950">Session controls</h2>
                  <p class="mt-1 text-sm font-medium text-zinc-700">
                    <template v-if="activeSession">Started {{ activeSession.date }} at {{ activeSession.startTime }}</template>
                    <template v-else>Start a live timer for billable work.</template>
                  </p>
                </div>

                <div class="taxi-roof-light" :class="{ 'taxi-roof-light--active': activeSession }">
                  {{ activeSession ? 'Hired' : 'Vacant' }}
                </div>
              </div>

              <div v-if="!activeSession" class="space-y-4">
                <div class="grid gap-4 sm:grid-cols-[minmax(0,1fr)_10rem]">
                  <label class="block">
                    <span class="text-sm font-medium text-slate-700">Client</span>
                    <select
                      v-model="startDraft.client"
                      class="mt-1 h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
                    >
                      <option value="">No client</option>
                      <option v-for="client in clientOptions" :key="client" :value="client">{{ client }}</option>
                    </select>
                  </label>

                  <label class="flex h-11 items-center gap-3 self-end">
                    <input
                      v-model="startDraft.billable"
                      type="checkbox"
                      class="h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                    >
                    <span class="text-sm font-bold text-zinc-800">Billable</span>
                  </label>
                </div>

                <label class="block">
                  <span class="text-sm font-medium text-slate-700">Work note</span>
                  <textarea
                    v-model="startDraft.note"
                    rows="3"
                    class="mt-1 w-full resize-none rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
                    placeholder="What are you working on?"
                  />
                </label>

                <button
                  type="button"
                  class="taxi-button taxi-button--start flex h-16 w-full items-center justify-center rounded-lg px-6 text-lg font-black uppercase shadow-sm transition focus:outline-none focus:ring-2 focus:ring-yellow-700 focus:ring-offset-2"
                  @click="startWork"
                >
                  Start meter
                </button>
              </div>

              <div v-else class="space-y-4">
                <div class="grid gap-4 sm:grid-cols-[minmax(0,1fr)_10rem]">
                  <label class="block">
                    <span class="text-sm font-medium text-slate-700">Client</span>
                    <select
                      v-model="activeSession.client"
                      class="mt-1 h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
                    >
                      <option value="">No client</option>
                      <option v-for="client in clientOptions" :key="client" :value="client">{{ client }}</option>
                    </select>
                  </label>

                  <label class="flex h-11 items-center gap-3 self-end">
                    <input
                      v-model="activeSession.billable"
                      type="checkbox"
                      class="h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                    >
                    <span class="text-sm font-bold text-zinc-800">Billable</span>
                  </label>
                </div>

                <label class="block">
                  <span class="text-sm font-medium text-slate-700">Work note</span>
                  <textarea
                    v-model="activeSession.note"
                    rows="3"
                    class="mt-1 w-full resize-none rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
                    placeholder="What did you work on?"
                  />
                </label>

                <p v-if="activeMissingClient" class="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                  No client selected. This will save under No client.
                </p>

                <p v-if="activeError" class="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                  {{ activeError }}
                </p>

                <button
                  type="button"
                  class="taxi-button taxi-button--stop flex h-14 w-full items-center justify-center rounded-lg px-6 text-base font-black uppercase shadow-sm transition focus:outline-none focus:ring-2 focus:ring-zinc-900 focus:ring-offset-2"
                  @click="stopWork"
                >
                  Stop meter
                </button>
              </div>
            </section>

            <section class="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
              <div class="mb-5">
                <h2 class="text-lg font-semibold text-slate-950">Manual entry</h2>
                <p class="mt-1 text-sm text-slate-500">Add missed work from start and end times.</p>
              </div>

              <form class="space-y-4" @submit.prevent="submitManualEntry">
                <div class="grid gap-4 sm:grid-cols-2">
                  <label class="block">
                    <span class="text-sm font-medium text-slate-700">Client</span>
                    <select
                      v-model="manualDraft.client"
                      class="mt-1 h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
                    >
                      <option value="">No client</option>
                      <option v-for="client in clientOptions" :key="client" :value="client">{{ client }}</option>
                    </select>
                  </label>

                  <label class="block">
                    <span class="text-sm font-medium text-slate-700">Date</span>
                    <input
                      v-model="manualDraft.date"
                      type="date"
                      required
                      class="mt-1 h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
                    >
                  </label>
                </div>

                <div class="grid gap-4 sm:grid-cols-[1fr_1fr_10rem]">
                  <label class="block">
                    <span class="text-sm font-medium text-slate-700">Start time</span>
                    <input
                      v-model="manualDraft.startTime"
                      type="text"
                      autocomplete="off"
                      placeholder="15:30 or 3:30 PM"
                      required
                      class="mt-1 h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
                    >
                  </label>

                  <label class="block">
                    <span class="text-sm font-medium text-slate-700">End time</span>
                    <input
                      v-model="manualDraft.endTime"
                      type="text"
                      autocomplete="off"
                      placeholder="18:30 or 6:30 PM"
                      required
                      class="mt-1 h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
                    >
                  </label>

                  <label class="flex items-end gap-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-3">
                    <input
                      v-model="manualDraft.billable"
                      type="checkbox"
                      class="h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                    >
                    <span class="text-sm font-medium text-slate-700">Billable</span>
                  </label>
                </div>

                <label class="block">
                  <span class="text-sm font-medium text-slate-700">Note</span>
                  <textarea
                    v-model="manualDraft.note"
                    rows="3"
                    class="mt-1 w-full resize-none rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
                    placeholder="Work completed"
                  />
                </label>

                <p v-if="manualMissingClient" class="text-sm text-slate-500">Empty client entries appear as No client in totals.</p>
                <p v-if="manualError" class="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{{ manualError }}</p>

                <button
                  type="submit"
                  class="inline-flex h-11 items-center justify-center rounded-lg bg-slate-950 px-5 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-slate-700 focus:ring-offset-2"
                >
                  Add entry
                </button>
              </form>
            </section>

            <section class="rounded-lg border border-slate-200 bg-white shadow-sm">
              <div class="flex flex-col gap-2 border-b border-slate-200 p-5 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <h2 class="text-lg font-semibold text-slate-950">Entries</h2>
                  <p class="mt-1 text-sm text-slate-500">{{ displayedEntries.length }} entries in {{ formatMonthLabel(selectedMonth) }}</p>
                </div>
              </div>

              <div v-if="displayedEntries.length" class="divide-y divide-slate-200">
                <article v-for="entry in displayedEntries" :key="entry.id" class="space-y-4 p-4 sm:p-5">
                  <div class="grid min-w-0 gap-3 xl:grid-cols-[minmax(0,1fr)_10rem] xl:items-start">
                    <div class="grid min-w-0 gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(8.5rem,1fr)_minmax(7.5rem,1fr)_minmax(5.5rem,0.7fr)_minmax(5.5rem,0.7fr)_minmax(5rem,0.6fr)]">
                      <label class="block min-w-0">
                        <span class="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Date</span>
                        <input
                          v-model="entry.date"
                          type="date"
                          class="mt-1 h-10 w-full min-w-0 rounded-lg border border-slate-300 bg-white px-2 text-sm outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
                          @change="recalculateEntry(entry)"
                        >
                      </label>

                      <label class="block min-w-0">
                        <span class="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Client</span>
                        <select
                          v-model="entry.client"
                          class="mt-1 h-10 w-full min-w-0 rounded-lg border border-slate-300 bg-white px-2 text-sm outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
                        >
                          <option value="">No client</option>
                          <option v-for="client in clientOptions" :key="client" :value="client">{{ client }}</option>
                        </select>
                      </label>

                      <label class="block min-w-0">
                        <span class="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Start</span>
                        <input
                          v-model="entry.startTime"
                          type="text"
                          autocomplete="off"
                          class="mt-1 h-10 w-full min-w-0 rounded-lg border border-slate-300 bg-white px-2 text-sm outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
                          @change="recalculateEntry(entry)"
                        >
                      </label>

                      <label class="block min-w-0">
                        <span class="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">End</span>
                        <input
                          v-model="entry.endTime"
                          type="text"
                          autocomplete="off"
                          class="mt-1 h-10 w-full min-w-0 rounded-lg border border-slate-300 bg-white px-2 text-sm outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
                          @change="recalculateEntry(entry)"
                        >
                      </label>

                      <div class="min-w-0">
                        <span class="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Duration</span>
                        <p class="mt-3 font-mono text-sm font-semibold tabular-nums text-slate-900">{{ formatHours(entry.durationMinutes) }}h</p>
                        <p v-if="entryErrors[entry.id]" class="mt-1 text-xs text-red-600">{{ entryErrors[entry.id] }}</p>
                      </div>
                    </div>

                    <div class="flex flex-wrap gap-3 xl:flex-col xl:items-stretch">
                      <label class="inline-flex h-10 items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3">
                        <input
                          v-model="entry.billable"
                          type="checkbox"
                          class="h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                        >
                        <span class="text-sm text-slate-700">{{ entry.billable ? 'Billable' : 'Not billable' }}</span>
                      </label>

                      <button
                        type="button"
                        class="h-10 rounded-lg border border-red-200 bg-white px-3 text-sm font-semibold text-red-700 transition hover:bg-red-50 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2"
                        @click="deleteEntry(entry)"
                      >
                        Delete
                      </button>
                    </div>
                  </div>

                  <label class="block min-w-0">
                    <span class="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Note</span>
                    <input
                      v-model="entry.note"
                      type="text"
                      class="mt-1 h-10 w-full min-w-0 rounded-lg border border-slate-300 bg-white px-2 text-sm outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
                      placeholder="Work note"
                    >
                  </label>
                </article>
              </div>

              <div v-else class="px-5 py-12 text-center text-sm text-slate-500">
                No entries yet.
              </div>
            </section>
          </div>

          <aside class="space-y-6">
            <section class="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
              <div>
                <h2 class="text-lg font-semibold text-slate-950">Monthly stats</h2>
                <label class="mt-4 block">
                  <span class="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Month</span>
                  <select
                    v-model="selectedMonth"
                    class="mt-1 h-10 w-full rounded-lg border border-slate-300 bg-white px-2 text-sm outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
                  >
                    <option v-for="month in availableMonths" :key="month" :value="month">{{ formatMonthLabel(month) }}</option>
                  </select>
                </label>
              </div>

              <dl class="mt-5 space-y-4">
                <div class="flex items-end justify-between gap-4 border-b border-slate-100 pb-4">
                  <dt>
                    <p class="text-sm font-medium text-slate-700">Billable hours</p>
                    <p class="mt-1 text-xs text-slate-500">{{ formatMonthLabel(selectedMonth) }}</p>
                  </dt>
                  <dd class="font-mono text-3xl font-semibold tabular-nums text-slate-950">{{ monthlyTotal }}h</dd>
                </div>

                <div class="flex items-end justify-between gap-4">
                  <dt>
                    <p class="text-sm font-medium text-slate-700">Estimated revenue</p>
                    <p class="mt-1 text-xs text-slate-500">Selected month</p>
                  </dt>
                  <dd class="font-mono text-3xl font-semibold tabular-nums text-slate-950">{{ estimatedRevenue }}</dd>
                </div>
              </dl>
            </section>

            <section class="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
              <div>
                <h2 class="text-lg font-semibold text-slate-950">Client totals</h2>
                <p class="mt-1 text-sm text-slate-500">Billable hours in {{ formatMonthLabel(selectedMonth) }}.</p>
              </div>

              <ul v-if="clientTotals.length" class="mt-5 divide-y divide-slate-100">
                <li v-for="total in clientTotals" :key="total.client" class="flex items-center justify-between gap-4 py-3">
                  <span class="truncate text-sm font-medium text-slate-700">{{ total.client }}</span>
                  <span class="font-mono text-base font-semibold tabular-nums text-slate-950">{{ total.hours }}h</span>
                </li>
              </ul>

              <p v-else class="mt-5 text-sm text-slate-500">No billable entries yet.</p>
            </section>

            <section class="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
              <div>
                <h2 class="text-lg font-semibold text-slate-950">Clients</h2>
                <p class="mt-1 text-sm text-slate-500">Hourly rate used for revenue.</p>
              </div>

              <form class="mt-5 space-y-4 rounded-lg border border-slate-200 bg-slate-50 p-4" @submit.prevent="addClient">
                <label class="block">
                  <span class="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Name</span>
                  <input
                    v-model.trim="clientDraft.name"
                    type="text"
                    class="mt-1 h-10 w-full min-w-0 rounded-lg border border-slate-300 bg-white px-2 text-sm outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
                    placeholder="Client name"
                  >
                </label>

                <div class="grid gap-3 sm:grid-cols-[8rem_1fr]">
                  <label class="block">
                    <span class="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Rate / hour</span>
                    <input
                      v-model.number="clientDraft.hourlyRate"
                      type="number"
                      min="0"
                      step="0.01"
                      class="mt-1 h-10 w-full min-w-0 rounded-lg border border-slate-300 bg-white px-2 text-sm outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
                      placeholder="0.00"
                    >
                  </label>

                  <label class="block">
                    <span class="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Website</span>
                    <input
                      v-model.trim="clientDraft.website"
                      type="url"
                      class="mt-1 h-10 w-full min-w-0 rounded-lg border border-slate-300 bg-white px-2 text-sm outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
                      placeholder="https://"
                    >
                  </label>
                </div>

                <p v-if="clientError" class="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{{ clientError }}</p>

                <button
                  type="submit"
                  class="h-10 rounded-lg bg-slate-950 px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-slate-700 focus:ring-offset-2"
                >
                  Save client
                </button>
              </form>

              <div class="mt-5 space-y-5">
                <div v-for="client in clients" :key="client.name" class="space-y-3 border-b border-slate-100 pb-5 last:border-b-0 last:pb-0">
                  <div class="flex items-center justify-between gap-3">
                    <p class="truncate text-sm font-semibold text-slate-900">{{ client.name }}</p>
                    <button
                      type="button"
                      class="h-8 rounded-lg border border-red-200 bg-white px-3 text-xs font-semibold text-red-700 transition hover:bg-red-50 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2"
                      @click="deleteClient(client.name)"
                    >
                      Delete
                    </button>
                  </div>

                  <label class="block">
                    <span class="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Rate / hour</span>
                    <input
                      v-model.number="client.hourlyRate"
                      type="number"
                      min="0"
                      step="0.01"
                      class="mt-1 h-10 w-full min-w-0 rounded-lg border border-slate-300 bg-white px-2 text-sm outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
                      placeholder="0.00"
                    >
                  </label>

                  <label class="block">
                    <span class="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Website</span>
                    <input
                      v-model.trim="client.website"
                      type="url"
                      class="mt-1 h-10 w-full min-w-0 rounded-lg border border-slate-300 bg-white px-2 text-sm outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
                      placeholder="https://"
                    >
                  </label>
                </div>
              </div>
            </section>
          </aside>
        </main>
      </div>
    </aside>
  </div>
</template>
