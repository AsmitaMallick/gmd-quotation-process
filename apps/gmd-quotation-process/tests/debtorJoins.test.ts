import test from 'node:test'
import assert from 'node:assert/strict'
import { bgExposureByName, bgFor, billInfoFor, buildBillInfo, toCsv } from '../lib/debtorJoins.js'

test('bill info joins bill + register on invoice no', () => {
  const m = buildBillInfo(
    [{ vrNo: 'GD1', orderVrNo: 'OD1', partyRefNo: 'PO/9', itemCode: 'I1' }, { vrNo: 'GD1', orderVrNo: 'OD1', partyRefNo: 'PO/9', itemCode: 'I2' }],
    [{ invoiceNo: 'gd1 ', itemName: null, orderCopy: null, invoice: 'http://x', inspectionReport: null, driveLink: null }],
  )
  const i = billInfoFor(m, 'GD1')!
  assert.equal(i.orderNo, 'OD1')
  assert.equal(i.items, 'I1, I2')
  assert.equal(i.invoice, 'http://x')
  assert.equal(billInfoFor(m, 'nope'), undefined)
})

test('BG exposure counts only open BGs, name matched loosely on case/spaces', () => {
  const m = bgExposureByName([
    { beneficiaryName: 'NCC  Limited', bgAmt: 100, cancelledStatus: 'OPEN' },
    { beneficiaryName: 'NCC LIMITED', bgAmt: 50, cancelledStatus: 'CLOSED' },
  ])
  assert.equal(bgFor(m, 'ncc limited'), 100)
  assert.equal(bgFor(m, 'other'), 0)
})

test('csv escapes quotes', () => {
  assert.equal(toCsv(['a'], [['x"y']]), '"a"\r\n"x""y"')
})
