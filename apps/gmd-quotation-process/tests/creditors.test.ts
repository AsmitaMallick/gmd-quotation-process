import test from 'node:test'
import assert from 'node:assert/strict'
import { BUCKETS } from '../lib/debtorsAgeing.js'
import { buildCreditorParties, vendorGroup } from '../lib/creditors.js'
import type { AdvanceRow, CreditorRow } from '../lib/creditors.js'

const today = new Date(2026, 9, 31)
const bill = (o: Partial<CreditorRow>): CreditorRow => ({
  id: 'b', accSch: 'S1', accCode: 'A', accName: 'Acme', vrNo: null, vrDate: null, dueDate: null,
  unAllocCr: 0, partyBillNo: null, partyBillDate: null, ...o,
})
const adv = (o: Partial<AdvanceRow>): AdvanceRow => ({
  id: 'a', accSch: 'S1', accCode: 'A', vrNo: null, vrDate: null, unAllocDr: 0,
  partyBillNo: null, partyBillDate: null, particular: null, narration: null, ...o,
})

test('net payable = bills - advances per party', () => {
  const { parties } = buildCreditorParties([bill({ unAllocCr: 1000, dueDate: '2026-10-01T00:00:00.000Z' })], [adv({ unAllocDr: 400 })], today)
  assert.equal(parties[0].totalDues, 1000)
  assert.equal(parties[0].credits, 400)
  assert.equal(parties[0].net, 600)
})

test('a party with both bills and advances is flagged advanceNotAdjusted', () => {
  const { parties } = buildCreditorParties(
    [bill({ unAllocCr: 100 }), bill({ accCode: 'B', accName: 'Beta', unAllocCr: 50 })],
    [adv({ unAllocDr: 10 }), adv({ accCode: 'C', unAllocDr: 5 })],
    today,
  )
  const by = Object.fromEntries(parties.map((p) => [p.accCode, p]))
  assert.equal(by.A.advanceNotAdjusted, true)
  assert.equal(by.B.advanceNotAdjusted, false)
  // advances only: still listed, negative net, not flagged (nothing to adjust against)
  assert.equal(by.C.net, -5)
  assert.equal(by.C.advanceNotAdjusted, false)
})

test('import and customs schedules are reported separately from local vendors', () => {
  assert.equal(vendorGroup('COMMISSIONER OF CUSTOMS', null), 'customs')
  assert.equal(vendorGroup('TIANJIN TANGFA IMPORT AND EXPORT CO LTD', null), 'import')
  assert.equal(vendorGroup('Some Labour Contractor', null), 'labour')
  assert.equal(vendorGroup('Local Steel Traders', 'SUNDRY CREDITORS'), 'local')
  assert.equal(vendorGroup('Local Steel Traders', 'IMPORT CREDITORS'), 'import')
  const { parties } = buildCreditorParties(
    [bill({ accCode: 'C1', accName: 'COMMISSIONER OF CUSTOMS', unAllocCr: 227 }), bill({ accCode: 'L1', accName: 'Local Steel Traders', unAllocCr: 5 })],
    [], today,
  )
  assert.deepEqual(parties.filter((p) => p.group === 'local').map((p) => p.accCode), ['L1'])
})

test('ageing buckets sum to total bills; missing due date ages from voucher date', () => {
  const { summary, parties } = buildCreditorParties(
    [
      bill({ unAllocCr: 100, dueDate: '2026-12-01T00:00:00.000Z' }),
      bill({ unAllocCr: 200, dueDate: '2026-09-01T00:00:00.000Z' }),
      bill({ unAllocCr: 300, dueDate: null, vrDate: '2026-01-01T00:00:00.000Z' }),
    ],
    [adv({ unAllocDr: 50 })], today,
  )
  assert.equal(BUCKETS.reduce((s, b) => s + summary.buckets[b], 0), summary.totalDues)
  assert.equal(summary.totalDues, 600)
  assert.equal(parties[0].buckets['180+'], 300)
  assert.ok(summary.buckets['180+'] >= 0)
})
