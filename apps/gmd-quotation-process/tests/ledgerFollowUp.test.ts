import test from 'node:test'
import assert from 'node:assert/strict'
import { followUpKey, indexFollowUps, normaliseFollowUp } from '../lib/ledgerFollowUp.js'

test('party-level and bill-level rows coexist for one party', () => {
  assert.notEqual(followUpKey('A1', ''), followUpKey('A1', 'V9'))
  assert.equal(followUpKey('A1', null), followUpKey('A1', ''))
  const m = indexFollowUps([
    { accCode: 'A1', vrNo: '', owner: 'Ravi' },
    { accCode: 'A1', vrNo: 'V9', owner: 'Sita' },
  ])
  assert.equal(m['A1'].owner, 'Ravi')
  assert.equal(m['A1|V9'].owner, 'Sita')
})

test('a blank promised amount clears the stored value rather than writing 0', () => {
  const r = normaliseFollowUp({ ledger: 'debtor', accCode: 'A1', promisedAmount: '  ' })
  assert.ok(!('error' in r))
  if (!('error' in r)) {
    assert.equal(r.data.promisedAmount, null)
    assert.equal(r.data.vrNo, '')
  }
})

test('rejects bad ledger, blank party, bad amount, bad date', () => {
  assert.ok('error' in normaliseFollowUp({ ledger: 'x', accCode: 'A1' }))
  assert.ok('error' in normaliseFollowUp({ ledger: 'debtor', accCode: ' ' }))
  assert.ok('error' in normaliseFollowUp({ ledger: 'debtor', accCode: 'A1', promisedAmount: 'abc' }))
  assert.ok('error' in normaliseFollowUp({ ledger: 'debtor', accCode: 'A1', promisedDate: '31/02/2026' }))
})

test('later edit wins when two rows share a key', () => {
  const m = indexFollowUps([
    { accCode: 'A1', vrNo: '', owner: 'first' },
    { accCode: 'A1', vrNo: '', owner: 'second' },
  ])
  assert.equal(m['A1'].owner, 'second')
})

test('credit days: blank clears to null, whole numbers pass, junk is rejected', () => {
  const base = { ledger: 'debtor', accCode: 'A1' }
  assert.equal((normaliseFollowUp({ ...base, creditDays: '' }) as any).data.creditDays, null)
  assert.equal((normaliseFollowUp({ ...base, creditDays: '30' }) as any).data.creditDays, 30)
  assert.ok('error' in normaliseFollowUp({ ...base, creditDays: '4.5' }))
  assert.ok('error' in normaliseFollowUp({ ...base, nextActionDate: 'soon' }))
})
