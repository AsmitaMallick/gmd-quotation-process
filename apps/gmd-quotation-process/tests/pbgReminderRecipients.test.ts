import test from 'node:test'
import assert from 'node:assert/strict'
import {
  groupByPartyRecipient,
  groupByRecipient,
  isUsablePoNumber,
  normalizePartyKey,
  parseRecipientEmails,
  partyRecipientKey,
  recipientKey,
} from '../lib/pbg/reminder-recipients.js'

test('parses a display-name contact into a bare email', () => {
  assert.deepEqual(
    parseRecipientEmails('Narender C <narender.c@gvpr.co.in>'),
    ['narender.c@gvpr.co.in'],
  )
})

test('parses comma-separated contacts, lower-cases and de-duplicates', () => {
  assert.deepEqual(
    parseRecipientEmails(
      'A <A@One.com>, b@two.com; A@one.com, not-an-email, ,',
    ),
    ['a@one.com', 'b@two.com'],
  )
})

test('empty or missing contact person produces no recipients', () => {
  assert.deepEqual(parseRecipientEmails(null), [])
  assert.deepEqual(parseRecipientEmails('   '), [])
  assert.deepEqual(parseRecipientEmails('Just a name'), [])
})

test('recipient key is order-independent', () => {
  assert.equal(
    recipientKey(['B@two.com', 'a@one.com']),
    recipientKey(['a@one.com', 'b@two.com']),
  )
})

test('groups rows that share the same recipient set', () => {
  const rows = [
    { id: '1', contactPerson: 'A <a@one.com>' },
    { id: '2', contactPerson: 'a@one.com' },
    { id: '3', contactPerson: 'b@two.com' },
    { id: '4', contactPerson: null },
  ]

  const groups = groupByRecipient(rows, (row) => row.contactPerson)
  assert.equal(groups.size, 2)
  assert.equal(groups.get('a@one.com')?.rows.length, 2)
  assert.equal(groups.get('b@two.com')?.rows.length, 1)
})

test('party key ignores case and punctuation', () => {
  assert.equal(
    normalizePartyKey('G V P R ENGINEERS LIMITED'),
    normalizePartyKey('g.v.p.r engineers limited.'),
  )
  assert.equal(normalizePartyKey(''), '')
})

test('party recipient key combines party and sorted recipients', () => {
  assert.equal(
    partyRecipientKey('G V P R ENGINEERS LIMITED', ['B@x.com', 'a@x.com']),
    'GVPRENGINEERSLIMITED|a@x.com,b@x.com',
  )
})

test('isUsablePoNumber rejects blank, placeholders and values without a digit', () => {
  for (const value of [
    '',
    '   ',
    '-',
    '--',
    '—',
    '–',
    'N/A',
    'NA',
    'NULL',
    'NIL',
    '.',
    '0',
    '0000',
    'GANJAM',
    null,
    undefined,
  ]) {
    assert.equal(isUsablePoNumber(value), false, String(value))
  }
})

test('isUsablePoNumber accepts real PO numbers', () => {
  for (const value of [
    '3000179463',
    'GVPR/GANJAM/23-24/340',
    'GEMC-511687790902751',
    'NCC/SWSM-UP/1832/21-22',
  ]) {
    assert.equal(isUsablePoNumber(value), true, value)
  }
})

test('groups by party + recipient across POs and skips blank party / no email', () => {
  const rows = [
    { id: '1', party: 'Client', po: 'PO1', contact: 'A <a@one.com>' },
    { id: '2', party: 'CLIENT', po: 'PO2', contact: 'a@one.com' },
    { id: '3', party: 'Other', po: 'PO1', contact: 'a@one.com' },
    { id: '4', party: 'Client', po: 'PO1', contact: 'b@two.com' },
    { id: '5', party: '', po: 'PO1', contact: 'a@one.com' },
    { id: '6', party: 'Client', po: 'PO1', contact: null },
  ]

  const groups = groupByPartyRecipient(
    rows,
    (row) => row.party,
    (row) => row.contact,
  )

  assert.equal(groups.size, 3)
  assert.equal(groups.get('CLIENT|a@one.com')?.rows.length, 2)
  assert.equal(groups.get('OTHER|a@one.com')?.rows.length, 1)
  assert.equal(groups.get('CLIENT|b@two.com')?.rows.length, 1)
})
