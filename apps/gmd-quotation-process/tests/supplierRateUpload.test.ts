import test from 'node:test'
import assert from 'node:assert/strict'
import * as XLSX from 'xlsx'
import {
  SUPPLIER_RATE_HEADERS,
  parseSupplierRateRows,
  parseSupplierRateFile,
  planSupplierRateUpload,
  isTradingValve,
  vendorReferenceOf,
} from '../lib/supplierRateUpload.js'

const header = [...SUPPLIER_RATE_HEADERS]
const row = (code: unknown, rate: unknown, supplier = '', offer = '', date: unknown = '') =>
  [code, 'SLV', 'DI', '', '50', 'PN16', rate, supplier, offer, date]

test('valid rows parse; code upper-cased, zero rate and dd-mm-yyyy date accepted', () => {
  const { rates, errors } = parseSupplierRateRows([
    header,
    row('abc123456', '22.39', 'Tianjin', 'TF-101', '30-10-2026'),
    header.map(() => null),
    row('ABC123457', 0),
  ])
  assert.deepEqual(errors, [])
  assert.deepEqual(rates[0], { erpItemCode: 'ABC123456', rateUsd: 22.39, supplier: 'Tianjin', offerNo: 'TF-101', offerDate: '2026-10-30' })
  assert.equal(rates[1].rateUsd, 0)
  assert.equal(vendorReferenceOf(rates[0]), 'Tianjin / TF-101 / 30-10-2026')
})

test('missing columns, bad values and repeated codes are reported by row', () => {
  assert.deepEqual(parseSupplierRateRows([['Item Type']]).errors.map((e) => e.row), [1, 1])
  const { rates, errors } = parseSupplierRateRows([
    header,
    row('', 10),
    row('ABC123456', 'abc'),
    row('ABC123456', -5),
    row('ABC123456', 5, '', '', '31-02-2026'),
    row('ABC123456', 5),
    row('ABC123456', 6),
  ])
  assert.equal(rates.length, 1)
  assert.deepEqual(errors.map((e) => e.row), [2, 3, 4, 5, 7])
  assert.match(errors[0].message, /ERP Item Code is required/)
  assert.match(errors[4].message, /row 6/)
})

test('xlsx file round-trip parses the first sheet', () => {
  const ws = XLSX.utils.aoa_to_sheet([header, row('ABC123456', 40, 'S', 'O-1', new Date(Date.UTC(2026, 9, 30)))], { cellDates: false })
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Rates')
  const { rates, errors } = parseSupplierRateFile(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }))
  assert.deepEqual(errors, [])
  assert.equal(rates[0].rateUsd, 40)
  assert.equal(rates[0].offerDate, '2026-10-30')
})

test('plan classifies updated / added / unchanged / notMatched, never deletes', () => {
  const ref = 'S / O'
  const master = [
    { erpItemCode: 'ABC000001', usd: 20, vendorReference: ref, category: 'TRADING VALVE' },
    { erpItemCode: 'ABC000002', usd: 30, vendorReference: ref, category: null },
    { erpItemCode: 'ABC000003', usd: 40, vendorReference: ref, category: 'RAW MATERIAL' },
  ]
  const r = (erpItemCode: string, rateUsd: number) => ({ erpItemCode, rateUsd, supplier: 'S', offerNo: 'O', offerDate: '' })
  const plan = planSupplierRateUpload(master, [
    r('ABC000001', 22), r('ABC000002', 30), r('ABC000003', 1), r('XYZ000009', 5), r('BAD', 5),
  ])
  assert.equal(plan.updates.length, 1)
  assert.equal(plan.updates[0].old.usd, 20)
  assert.equal(plan.unchanged.length, 1)
  assert.deepEqual(plan.adds.map((x) => x.erpItemCode), ['XYZ000009'])
  assert.equal(plan.notMatched.length, 2)
  assert.match(plan.notMatched[0].reason, /not TRADING VALVE/)
  assert.equal('deletes' in plan, false)
})

test('the master spells the category plural, and those rows still update', () => {
  // Every one of the 916 real master rows is "TRADING VALVES". An exact match on
  // the singular sent all of them to notMatched, so the upload updated nothing.
  assert.equal(isTradingValve('TRADING VALVES'), true)
  assert.equal(isTradingValve('TRADING VALVE'), true)
  assert.equal(isTradingValve(' trading valves '), true)
  assert.equal(isTradingValve('RAW MATERIAL'), false)

  const master = [{ erpItemCode: 'ABC000001', usd: 20, vendorReference: '', category: 'TRADING VALVES' }]
  const plan = planSupplierRateUpload(master, [
    { erpItemCode: 'ABC000001', rateUsd: 25, supplier: '', offerNo: '', offerDate: '' },
  ])
  assert.equal(plan.notMatched.length, 0)
  assert.equal(plan.updates.length, 1)
  assert.equal(plan.updates[0].next.rateUsd, 25)
})
