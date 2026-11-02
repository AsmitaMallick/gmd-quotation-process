import test from 'node:test'
import assert from 'node:assert/strict'
import {
  mapCreditorRow, mapAdvanceRow, resolveCreditorColumns, resolveAdvanceColumns,
  CREDITOR_HEADERS, ADVANCE_HEADERS, CREDITORS_TAB, ADVANCES_TAB, parseAmount, parseSheetDate,
} from '../lib/creditorsSync.js'

const CH = Object.values(CREDITOR_HEADERS)
const AH = Object.values(ADVANCE_HEADERS)
const cIdx = resolveCreditorColumns(CH, CREDITORS_TAB)
const aIdx = resolveAdvanceColumns(AH, ADVANCES_TAB)

// headers are declared in column order, so key order == column order
function build<T extends Record<string, string>>(headers: T, base: Record<keyof T, string>, o: Partial<Record<keyof T, string>>) {
  const m = { ...base, ...o } as Record<keyof T, string>
  return (Object.keys(headers) as (keyof T)[]).map((k) => m[k])
}
const creditorRow = (o: Partial<Record<keyof typeof CREDITOR_HEADERS, string>> = {}) =>
  build(CREDITOR_HEADERS, {
    accSch: 'C', accCode: 'CAC01', accName: 'ACME STEELS', vrNo: 'GP22Y-00010', vrDate: '05-03-2026',
    dueDate: '04-04-2026', unAllocCr: '125000.5', partyBillNo: 'B-77', partyBillDate: '01-03-2026',
  }, o)
const advanceRow = (o: Partial<Record<keyof typeof ADVANCE_HEADERS, string>> = {}) =>
  build(ADVANCE_HEADERS, {
    accCode: 'CAC01', vrNo: 'PV-1', vrDate: '10-03-2026', unAllocDr: '5000', partyBillNo: 'AD-1',
    accSch: 'C', partyBillDate: '09-03-2026', particular: 'Advance', narration: 'against PO 5',
  }, o)

test('re-exports the shared parsers', () => {
  assert.equal(parseAmount('1,000'), 1000)
  assert.equal(parseSheetDate('22-03-2023')?.toISOString(), '2023-03-22T00:00:00.000Z')
})

test('maps a creditor row', () => {
  assert.deepEqual(mapCreditorRow(creditorRow(), cIdx), { ok: true, record: {
    accSch: 'C', accCode: 'CAC01', accName: 'ACME STEELS', vrNo: 'GP22Y-00010',
    vrDate: new Date('2026-03-05T00:00:00.000Z'), dueDate: new Date('2026-04-04T00:00:00.000Z'),
    unAllocCr: 125000.5, partyBillNo: 'B-77', partyBillDate: new Date('2026-03-01T00:00:00.000Z'),
  } })
})

test('blank due date stays null', () => {
  const r = mapCreditorRow(creditorRow({ dueDate: '' }), cIdx)
  assert.equal(r.ok && r.record.dueDate, null)
})

test('maps an advance row', () => {
  assert.deepEqual(mapAdvanceRow(advanceRow(), aIdx), { ok: true, record: {
    accSch: 'C', accCode: 'CAC01', vrNo: 'PV-1', vrDate: new Date('2026-03-10T00:00:00.000Z'),
    unAllocDr: 5000, partyBillNo: 'AD-1', partyBillDate: new Date('2026-03-09T00:00:00.000Z'),
    particular: 'Advance', narration: 'against PO 5',
  } })
})

test('blank ACC_CODE is skipped with a reason', () => {
  assert.deepEqual(mapCreditorRow(creditorRow({ accCode: '' }), cIdx), { ok: false, error: 'blank ACC_CODE' })
  assert.deepEqual(mapAdvanceRow(advanceRow({ accCode: '' }), aIdx), { ok: false, error: 'blank ACC_CODE' })
})

test('a renamed column fails loudly', () => {
  assert.throws(() => resolveCreditorColumns(['ACC_CODE', 'AMOUNT'], 'CREDITORS'), /UN_ALLOC_CR/)
  assert.throws(() => resolveAdvanceColumns(['ACC_CODE'], 'ADVANCE TO CREDITORS'), /UN_ALLOC_DR/)
})

test('text that is not a number is an error, not zero', () => {
  assert.equal(mapCreditorRow(creditorRow({ unAllocCr: 'abc' }), cIdx).ok, false)
  assert.equal(mapAdvanceRow(advanceRow({ unAllocDr: 'abc' }), aIdx).ok, false)
})
