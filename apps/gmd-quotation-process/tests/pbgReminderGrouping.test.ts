import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildExpiredReminderContext,
  buildLastExpiredSentByGroup,
  buildPreExpiryLogState,
  planReminderTasks,
  type PlannerLog,
  type PlannerRow,
} from '../lib/pbg/reminder-plan.js'
import {
  groupByPartyRecipient,
  normalizePartyKey,
  normalizePoKey,
} from '../lib/pbg/reminder-recipients.js'

const NOW = new Date('2026-10-28T03:30:00.000Z')

function row(overrides: Partial<PlannerRow> = {}): PlannerRow {
  return {
    id: '1',
    bgNo: 'BG1',
    bgDate: '2023-01-01',
    bgAmtFc: 100,
    expiryDate: '2026-10-01',
    poNumber: 'PO1',
    project: 'Project',
    clientName: 'Client',
    invoiceNos: [],
    daysUntilExpiry: -1,
    contactPerson: 'a@x.com',
    ...overrides,
  }
}

test('normalizePoKey trims, collapses spaces and upper-cases', () => {
  assert.equal(normalizePoKey('  po  123 '), 'PO 123')
  assert.equal(normalizePoKey(null), '')
  assert.equal(normalizePoKey(''), '')
})

test('normalizePartyKey ignores case and punctuation', () => {
  assert.equal(
    normalizePartyKey('G V P R ENGINEERS LIMITED'),
    normalizePartyKey('g.v.p.r engineers limited.'),
  )
})

test('groups by party + recipient across multiple POs and skips blank party / no email', () => {
  const groups = groupByPartyRecipient(
    [
      row({ id: '1', clientName: 'Client', poNumber: 'PO1', contactPerson: 'A@x.com' }),
      row({ id: '2', clientName: 'CLIENT', poNumber: 'PO2', contactPerson: 'a@x.com' }),
      row({ id: '3', clientName: 'Other', poNumber: 'PO1', contactPerson: 'a@x.com' }),
      row({ id: '4', clientName: 'Client', poNumber: 'PO1', contactPerson: 'b@y.com' }),
      row({ id: '5', clientName: '', poNumber: 'PO1', contactPerson: 'a@x.com' }),
      row({ id: '6', clientName: 'Client', poNumber: 'PO1', contactPerson: null }),
    ],
    (r) => r.clientName,
    (r) => r.contactPerson,
  )

  assert.equal(groups.size, 3)
  assert.equal(groups.get('CLIENT|a@x.com')?.rows.length, 2)
  assert.equal(groups.get('OTHER|a@x.com')?.rows.length, 1)
  assert.equal(groups.get('CLIENT|b@y.com')?.rows.length, 1)
})

test('expired party group sends expired BGs from every PO in one task', () => {
  const result = planReminderTasks({
    rows: [
      row({ id: '1', poNumber: 'PO1', daysUntilExpiry: -1 }),
      row({ id: '2', poNumber: 'PO2', daysUntilExpiry: -10 }),
    ],
    preSent: new Set(),
    preFailed: new Set(),
    lastExpiredSent: new Map(),
    now: NOW,
  })

  assert.equal(result.tasks.length, 1)
  assert.equal(result.tasks[0].stage, 'EXPIRED')
  assert.equal(result.tasks[0].partyName, 'Client')
  assert.deepEqual(result.tasks[0].poNumbers, ['PO1', 'PO2'])
  assert.equal(result.tasks[0].rows.length, 2)
  assert.equal(result.dueRows, 2)
})

test('expired party group waits until 7 days have passed', () => {
  const rows = [
    row({ id: '1', poNumber: 'PO1', daysUntilExpiry: -1 }),
    row({ id: '2', poNumber: 'PO2', daysUntilExpiry: -10 }),
  ]
  const key = 'CLIENT|a@x.com'

  const notDue = planReminderTasks({
    rows,
    preSent: new Set(),
    preFailed: new Set(),
    lastExpiredSent: new Map([
      [key, new Date(NOW.getTime() - 6 * 86_400_000)],
    ]),
    now: NOW,
  })
  assert.equal(notDue.tasks.length, 0)

  const due = planReminderTasks({
    rows,
    preSent: new Set(),
    preFailed: new Set(),
    lastExpiredSent: new Map([
      [key, new Date(NOW.getTime() - 7 * 86_400_000)],
    ]),
    now: NOW,
  })
  assert.equal(due.tasks.length, 1)
  assert.equal(due.tasks[0].rows.length, 2)
})

test('a BG that expires during the interval joins the next party cycle', () => {
  const key = 'CLIENT|a@x.com'
  const lastSent = new Date(NOW.getTime() - 6 * 86_400_000)

  const beforeCycle = planReminderTasks({
    rows: [
      row({ id: 'old', poNumber: 'PO1', daysUntilExpiry: -10 }),
      row({ id: 'new', poNumber: 'PO2', daysUntilExpiry: 0 }),
    ],
    preSent: new Set(),
    preFailed: new Set(),
    lastExpiredSent: new Map([[key, lastSent]]),
    now: NOW,
  })
  assert.equal(beforeCycle.tasks.length, 0)

  const nextCycle = planReminderTasks({
    rows: [
      row({ id: 'old', poNumber: 'PO1', daysUntilExpiry: -10 }),
      row({ id: 'new', poNumber: 'PO2', daysUntilExpiry: 0 }),
    ],
    preSent: new Set(),
    preFailed: new Set(),
    lastExpiredSent: new Map([
      [key, new Date(NOW.getTime() - 7 * 86_400_000)],
    ]),
    now: NOW,
  })
  assert.equal(nextCycle.tasks.length, 1)
  assert.equal(nextCycle.tasks[0].rows.length, 2)
})

test('one consolidated task carries expired and upcoming rows', () => {
  const result = planReminderTasks({
    rows: [
      row({ id: 'expired', daysUntilExpiry: -10, poNumber: 'PO1' }),
      row({ id: 'upcoming', daysUntilExpiry: 10, poNumber: 'PO2' }),
    ],
    preSent: new Set(),
    preFailed: new Set(),
    lastExpiredSent: new Map(),
    now: NOW,
  })

  assert.equal(result.tasks.length, 1)
  const task = result.tasks[0]
  assert.equal(task.stage, 'EXPIRED')
  assert.deepEqual(task.expiredRows.map((r) => r.id), ['expired'])
  assert.deepEqual(task.upcomingRows.map((r) => r.id), ['upcoming'])
  assert.deepEqual(task.preExpiryLogIds, ['upcoming'])
  assert.equal(task.reminderNumber, 1)
})

test('a B-only task is sent when the party has no expired BGs', () => {
  const result = planReminderTasks({
    rows: [row({ id: 'upcoming', daysUntilExpiry: 30 })],
    preSent: new Set(),
    preFailed: new Set(),
    lastExpiredSent: new Map(),
    now: NOW,
  })

  assert.equal(result.tasks.length, 1)
  assert.equal(result.tasks[0].stage, 'BEFORE_30_DAYS')
  assert.deepEqual(result.tasks[0].expiredRows, [])
  assert.deepEqual(result.tasks[0].upcomingRows.map((r) => r.id), ['upcoming'])
  assert.equal(result.tasks[0].reminderNumber, null)
})

test('upcoming rows wait for the next expired cycle when expired BGs exist', () => {
  const rows = [
    row({ id: 'expired', daysUntilExpiry: -10, poNumber: 'PO1' }),
    row({ id: 'upcoming', daysUntilExpiry: 30, poNumber: 'PO2' }),
  ]
  const key = 'CLIENT|a@x.com'

  const notDue = planReminderTasks({
    rows,
    preSent: new Set(),
    preFailed: new Set(),
    lastExpiredSent: new Map([
      [key, new Date(NOW.getTime() - 6 * 86_400_000)],
    ]),
    now: NOW,
  })
  assert.equal(notDue.tasks.length, 0)

  const due = planReminderTasks({
    rows,
    preSent: new Set(),
    preFailed: new Set(),
    lastExpiredSent: new Map([
      [key, new Date(NOW.getTime() - 7 * 86_400_000)],
    ]),
    now: NOW,
  })
  assert.equal(due.tasks.length, 1)
  assert.deepEqual(due.tasks[0].upcomingRows.map((r) => r.id), ['upcoming'])
})

test('expired rows are ordered oldest expiry first', () => {
  const result = planReminderTasks({
    rows: [
      row({ id: 'newer', bgNo: 'BG2', expiryDate: '2026-10-01', daysUntilExpiry: -1 }),
      row({ id: 'older', bgNo: 'BG1', expiryDate: '2026-09-01', daysUntilExpiry: -31 }),
    ],
    preSent: new Set(),
    preFailed: new Set(),
    lastExpiredSent: new Map(),
    now: NOW,
  })

  assert.deepEqual(result.tasks[0].expiredRows.map((r) => r.id), [
    'older',
    'newer',
  ])
})

test('different parties and different contacts produce separate tasks', () => {
  const result = planReminderTasks({
    rows: [
      row({ id: '1', clientName: 'Client A', poNumber: 'PO1', contactPerson: 'a@x.com' }),
      row({ id: '2', clientName: 'Client B', poNumber: 'PO2', contactPerson: 'a@x.com' }),
      row({ id: '3', clientName: 'Client A', poNumber: 'PO1', contactPerson: 'b@y.com' }),
    ],
    preSent: new Set(),
    preFailed: new Set(),
    lastExpiredSent: new Map(),
    now: NOW,
  })

  assert.equal(result.tasks.length, 3)
})

test('pre-expiry stays one-time per BG but groups by party', () => {
  const result = planReminderTasks({
    rows: [
      row({ id: '1', daysUntilExpiry: 30 }),
      row({ id: '2', poNumber: 'PO2', daysUntilExpiry: 30 }),
      row({ id: '3', clientName: 'Other', daysUntilExpiry: 30 }),
    ],
    preSent: new Set(['1']),
    preFailed: new Set(),
    lastExpiredSent: new Map(),
    now: NOW,
  })

  const preTasks = result.tasks.filter((task) => task.stage === 'BEFORE_30_DAYS')
  assert.equal(preTasks.length, 2)
  assert.deepEqual(
    preTasks.map((task) => task.partyName).sort(),
    ['Client', 'Other'],
  )
  assert.deepEqual(
    preTasks.find((task) => task.partyName === 'Client')?.rows.map((r) => r.id),
    ['1', '2'],
  )
  assert.deepEqual(
    preTasks.find((task) => task.partyName === 'Client')?.preExpiryLogIds,
    ['2'],
  )
})

test('rows without email are counted as skipped', () => {
  const result = planReminderTasks({
    rows: [
      row({ id: '1', daysUntilExpiry: -1, contactPerson: 'a@x.com' }),
      row({ id: '2', daysUntilExpiry: -1, contactPerson: null }),
    ],
    preSent: new Set(),
    preFailed: new Set(),
    lastExpiredSent: new Map(),
    now: NOW,
  })

  assert.equal(result.tasks.length, 1)
  assert.equal(result.tasks[0].rows.length, 1)
  assert.equal(result.skippedNoEmail, 1)
})

test('buildPreExpiryLogState tracks SENT and FAILED per BG', () => {
  const logs: PlannerLog[] = [
    { pbgId: '1', stage: 'BEFORE_30_DAYS', status: 'SENT', poNumber: 'PO1', recipientKey: 'a@x.com', emails: 'a@x.com', sentAt: NOW, pbgClientName: 'Client' },
    { pbgId: '2', stage: 'BEFORE_30_DAYS', status: 'FAILED', poNumber: 'PO1', recipientKey: 'a@x.com', emails: 'a@x.com', sentAt: NOW, pbgClientName: 'Client' },
    { pbgId: '3', stage: 'EXPIRED', status: 'SENT', poNumber: 'PO1', recipientKey: 'a@x.com', emails: 'a@x.com', sentAt: NOW, pbgClientName: 'Client' },
  ]
  const state = buildPreExpiryLogState(logs)
  assert.deepEqual([...state.sent], ['1'])
  assert.deepEqual([...state.failed], ['2'])
})

test('buildLastExpiredSentByGroup keeps the latest SENT per party + recipient', () => {
  const older = new Date(NOW.getTime() - 10 * 86_400_000)
  const newer = new Date(NOW.getTime() - 2 * 86_400_000)
  const logs: PlannerLog[] = [
    { pbgId: '1', stage: 'EXPIRED', status: 'SENT', poNumber: 'PO1', recipientKey: 'a@x.com', emails: 'a@x.com', sentAt: older, pbgClientName: 'Client' },
    { pbgId: '2', stage: 'EXPIRED', status: 'SENT', poNumber: 'PO2', recipientKey: 'a@x.com', emails: 'a@x.com', sentAt: newer, pbgClientName: 'Client' },
    { pbgId: '3', stage: 'EXPIRED', status: 'FAILED', poNumber: 'PO1', recipientKey: 'a@x.com', emails: 'a@x.com', sentAt: NOW, pbgClientName: 'Client' },
  ]
  const last = buildLastExpiredSentByGroup(logs)
  assert.equal(last.get('CLIENT|a@x.com')?.toISOString(), newer.toISOString())
})

test('buildLastExpiredSentByGroup falls back to emails for old rows', () => {
  const logs: PlannerLog[] = [
    { pbgId: '1', stage: 'EXPIRED', status: 'SENT', poNumber: 'PO1', recipientKey: null, emails: 'B@y.com, a@x.com', sentAt: NOW, pbgClientName: 'Client' },
  ]
  const last = buildLastExpiredSentByGroup(logs)
  assert.ok(last.has('CLIENT|a@x.com,b@y.com'))
})

test('buildExpiredReminderContext counts prior mail cycles and dates', () => {
  const logs: PlannerLog[] = [
    { pbgId: '1', stage: 'EXPIRED', status: 'SENT', poNumber: 'PO1', recipientKey: 'a@x.com', emails: 'a@x.com', sentAt: new Date('2026-10-26T03:30:00.000Z'), messageId: 'm1', pbgClientName: 'Client' },
    { pbgId: '2', stage: 'EXPIRED', status: 'SENT', poNumber: 'PO2', recipientKey: 'a@x.com', emails: 'a@x.com', sentAt: new Date('2026-10-26T03:30:05.000Z'), messageId: 'm1', pbgClientName: 'Client' },
    { pbgId: '1', stage: 'EXPIRED', status: 'SENT', poNumber: 'PO1', recipientKey: 'a@x.com', emails: 'a@x.com', sentAt: new Date('2026-11-02T03:30:00.000Z'), messageId: 'm2', pbgClientName: 'Client' },
    { pbgId: '3', stage: 'EXPIRED', status: 'SENT', poNumber: 'PO1', recipientKey: 'b@y.com', emails: 'b@y.com', sentAt: new Date('2026-11-03T03:30:00.000Z'), messageId: 'm3', pbgClientName: 'Client' },
    { pbgId: '4', stage: 'EXPIRED', status: 'SENT', poNumber: 'PO1', recipientKey: 'a@x.com', emails: 'a@x.com', sentAt: new Date('2026-11-04T03:30:00.000Z'), messageId: 'm4', pbgClientName: 'Other' },
  ]

  const context = buildExpiredReminderContext(logs, 'Client', ['a@x.com'])
  assert.equal(context.reminderNumber, 3)
  assert.deepEqual(context.earlierMailDates, ['2026-10-26', '2026-11-02'])
})

test('buildExpiredReminderContext starts at one when no prior mail exists', () => {
  const context = buildExpiredReminderContext([], 'Client', ['a@x.com'])
  assert.equal(context.reminderNumber, 1)
  assert.deepEqual(context.earlierMailDates, [])
})

test('buildExpiredReminderContext groups old logs without message ids by day', () => {
  const logs: PlannerLog[] = [
    { pbgId: '1', stage: 'EXPIRED', status: 'SENT', poNumber: 'PO1', recipientKey: 'a@x.com', emails: 'a@x.com', sentAt: new Date('2026-10-26T03:30:00.000Z'), pbgClientName: 'Client' },
    { pbgId: '2', stage: 'EXPIRED', status: 'SENT', poNumber: 'PO2', recipientKey: 'a@x.com', emails: 'a@x.com', sentAt: new Date('2026-10-26T04:00:00.000Z'), pbgClientName: 'Client' },
  ]

  const context = buildExpiredReminderContext(logs, 'Client', ['a@x.com'])
  assert.equal(context.reminderNumber, 2)
  assert.deepEqual(context.earlierMailDates, ['2026-10-26'])
})
