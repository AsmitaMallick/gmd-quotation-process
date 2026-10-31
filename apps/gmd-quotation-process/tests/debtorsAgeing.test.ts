import test from 'node:test'
import assert from 'node:assert/strict'
import { BUCKETS, bucketOf, daysOverdue, effectiveDueDate, outstanding, summarise } from '../lib/debtorsAgeing.js'
import type { DebtorRow } from '../lib/debtors.js'

const today = new Date(2026, 9, 31)
const row = (o: Partial<DebtorRow>): DebtorRow => ({
  id: 'x', accSch: null, accCode: 'A', accName: 'Acme', tCode: null, vrNo: null, vrDate: null,
  dueDate: null, particular: null, drAmt: null, drAllocAmt: null, unAllocDr: 0, unAllocCr: 0,
  partyBillNo: null, partyBillDate: null, ...o,
})

test('days and buckets', () => {
  assert.equal(daysOverdue('2026-10-01T00:00:00.000Z', today), 30)
  assert.equal(daysOverdue('2026-11-05T00:00:00.000Z', today), -5)
  assert.equal(bucketOf(-5), 'Not due')
  assert.equal(bucketOf(30), '0-30')
  assert.equal(bucketOf(31), '31-60')
  assert.equal(bucketOf(90), '61-90')
  assert.equal(bucketOf(91), '91-180')
  assert.equal(bucketOf(181), '180+')
})

test('credits are separate, never netted into dues', () => {
  assert.equal(outstanding(row({ unAllocDr: 100, unAllocCr: 30 })), 70)
  const s = summarise([
    row({ unAllocDr: 1000, dueDate: '2026-01-01T00:00:00.000Z' }),
    row({ unAllocDr: 500, dueDate: '2026-12-01T00:00:00.000Z' }),
    row({ unAllocDr: 0, unAllocCr: 200 }),
  ], today)
  assert.equal(s.totalDues, 1500)
  assert.equal(s.overdue, 1000)
  assert.equal(s.over90, 1000)
  assert.equal(s.credits, 200)
  assert.equal(s.net, 1300)
  assert.equal(s.parties.length, 1)
})

test('creditor side flips the sign', () => {
  const r = { unAllocDr: 100, unAllocCr: 400 }
  assert.equal(outstanding(r), -300)
  assert.equal(outstanding(r, 'creditor'), 300)
})

test('advances with no bills give a negative net, party still listed', () => {
  const rows = [row({ accCode: 'A1', accName: 'Tangfa', vrDate: '2026-01-01', unAllocDr: 500 })]
  const s = summarise(rows, new Date('2026-10-31'), { side: 'creditor' })
  assert.equal(s.parties.length, 1)
  assert.equal(s.parties[0].net, -500)
  assert.equal(s.totalDues, 0)
  assert.ok(BUCKETS.every((b) => s.buckets[b] >= 0))
})

test('effectiveDueDate falls back to vrDate', () => {
  assert.equal(effectiveDueDate(null, '2026-05-01'), '2026-05-01')
  assert.equal(effectiveDueDate('2026-06-01', '2026-05-01'), '2026-06-01')
  assert.equal(effectiveDueDate(null, null), null)
})

test('bucket totals equal the sum of party dues', () => {
  const dues = ['2026-11-30', '2026-10-15', '2026-09-15', '2026-08-15', '2026-06-01', '2025-01-01']
  const rows = dues.map((d, i) => row({ accCode: `P${i}`, dueDate: `${d}T00:00:00.000Z`, unAllocDr: 100 * (i + 1) }))
  const s = summarise(rows, today)
  assert.ok(BUCKETS.every((b) => s.buckets[b] > 0))
  assert.equal(BUCKETS.reduce((t, b) => t + s.buckets[b], 0), s.totalDues)
})

test('missing due date uses vrDate for ageing', () => {
  const s = summarise([row({ vrDate: '2025-01-01T00:00:00.000Z', unAllocDr: 100 })], today)
  assert.equal(s.buckets['180+'], 100)
})
