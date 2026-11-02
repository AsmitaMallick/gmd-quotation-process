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

test("creditNoteRefOf reads the bill a P row credits, and nothing else", async () => {
  const { creditNoteRefOf, creditNotesByBill } = await import("../lib/debtorJoins");
  assert.equal(creditNoteRefOf("Sales against Order/Bill No-GD26Y-00139", "P"), "GD26Y-00139");
  assert.equal(creditNoteRefOf("Sales against Challan No- GD26Y-00139 Order No-OD26Y-00108 Dt: 14-OCT-26", "S"), null);
  assert.equal(creditNoteRefOf("Sales against Challan No- GD26Y-00139 Order No-OD26Y-00108 Dt: 14-OCT-26", "P"), null);
  assert.equal(creditNoteRefOf("Opening balance", "P"), null);
  assert.equal(creditNoteRefOf(null, "P"), null);
  const m = creditNotesByBill([{ vrNo: "SR26Y-00009", tCode: "P", particular: "Sales against Order/Bill No-GD26Y-00139" }, { vrNo: "GD26Y-00139", tCode: "S", particular: "x" }]);
  assert.deepEqual(m.get("GD26Y-00139"), ["SR26Y-00009"]);
});
