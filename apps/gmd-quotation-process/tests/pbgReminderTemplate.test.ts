import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildReminderEmail,
  type ReminderEmailRow,
} from '../lib/pbg/reminder-template.js'

function row(overrides: Partial<ReminderEmailRow> = {}): ReminderEmailRow {
  return {
    bgNo: 'BG1',
    bgDate: '2023-03-27',
    bgAmtFc: 100000,
    expiryDate: '2026-11-27',
    poNumber: 'PO1',
    project: 'Masora Sindhwaha Water Supply',
    clientName: 'Kalpataru Projects International Limited',
    invoiceNos: ['GD24Y-001'],
    daysUntilExpiry: -10,
    ...overrides,
  }
}

const expiredRows = [
  row({
    bgNo: 'OLD',
    expiryDate: '2025-02-20',
    daysUntilExpiry: -600,
    project: 'Masora Sindhwaha Water Supply',
    invoiceNos: ['GD24Y-001', 'GD24Y-002'],
  }),
  row({
    bgNo: 'NEW',
    expiryDate: '2026-01-15',
    daysUntilExpiry: -200,
    bgAmtFc: 50000,
    poNumber: 'PO2',
    project: 'Masora Sindhwaha Water Supply',
    invoiceNos: ['GD24Y-003'],
  }),
]

const upcomingRows = [
  row({
    bgNo: 'UP',
    expiryDate: '2026-11-27',
    daysUntilExpiry: 10,
    bgAmtFc: 5000,
    poNumber: 'PO2',
    project: 'Upcoming Project',
    invoiceNos: [],
  }),
]

test('consolidated mail has Section A, Section B, new labels, days column and signature block', () => {
  const email = buildReminderEmail({
    stage: 'EXPIRED',
    rows: [...expiredRows, ...upcomingRows],
    expiredRows,
    upcomingRows,
    partyName: 'Kalpataru Projects International Limited',
    reminderNumber: 1,
    udyamNo: 'UDYAM-TEST-123',
  })

  assert.match(email.subject, /Expired PBG return request/)
  assert.doesNotMatch(email.html, /<strong>Subject:<\/strong>/)
  assert.match(email.html, /Dear Sir\/Madam,/)
  assert.match(email.html, /Kalpataru Projects International Limited/)
  assert.match(email.html, /A\. Expired \(Return Requested\)/)
  assert.match(email.html, /B\. Expiring in Next 30 Days \(For Information\)/)
  assert.match(email.html, /BG Amt \(₹\)/)
  assert.match(email.html, /Days since expiry/)
  assert.match(email.html, /Total BG Amount/)
  assert.match(email.html, /Total BG Amount Pending Return/)
  assert.doesNotMatch(email.html, /PO Total/)
  assert.doesNotMatch(email.html, /Grand Total/)
  assert.match(email.html, /This is reminder no\. 1\./)
  assert.match(email.html, /Rule 171 of the General Financial Rules/)
  assert.match(email.html, /Sections 15 &amp; 16 – amounts/)
  assert.doesNotMatch(email.html, /Section 18 of the MSMED Act/)
  assert.doesNotMatch(email.html, /MSEFC/)
  assert.match(email.html, /For your information, the following Performance Bank Guarantee is due to expire/)
  const [sectionA, sectionB] = email.html.split(
    'B. Expiring in Next 30 Days',
  )
  assert.equal((sectionA.match(/Days since expiry/g) ?? []).length, 2)
  assert.doesNotMatch(sectionB ?? '', /Days since expiry/)

  // Oldest expired BG must appear first.
  assert.ok(email.html.indexOf('OLD') < email.html.indexOf('NEW'))

  // Address block sits below the signature, and carries both phone and email.
  assert.ok(email.html.indexOf('Thanks &amp; Regards,') < email.html.indexOf('19th Floor'))
  assert.ok(email.html.indexOf('Director') < email.html.indexOf('19th Floor'))
  assert.match(email.html, /\+91 88200 44755/)
  assert.match(email.html, /\(\+91\) 9147176248/)
  assert.match(email.html, /puja\.agarwal@laserpowerinfra\.com/)
  assert.match(email.html, /info@gmdalui\.co\.in/)
})

test('reminder 2 includes the MSEFC provision and escalation wording', () => {
  const email = buildReminderEmail({
    stage: 'EXPIRED',
    rows: expiredRows,
    expiredRows,
    upcomingRows: [],
    partyName: 'Kalpataru Projects International Limited',
    reminderNumber: 2,
    earlierMailDates: ['2026-10-26'],
    udyamNo: 'UDYAM-TEST-123',
  })

  assert.match(
    email.html,
    /This is reminder no\. 2 with reference to our letters dated 26 Oct 2026/,
  )
  assert.match(email.html, /Section 18 of the MSMED Act/)
  assert.match(email.html, /Micro and Small Enterprises Facilitation Council/)
  assert.match(email.html, /MSEFC through the MSME Samadhaan portal/)
})

test('reminder 2 without earlier dates still references earlier letters', () => {
  const email = buildReminderEmail({
    stage: 'EXPIRED',
    rows: expiredRows,
    expiredRows,
    upcomingRows: [],
    reminderNumber: 2,
  })

  assert.match(
    email.html,
    /This is reminder no\. 2 with reference to our earlier letters/,
  )
  assert.match(email.html, /Section 18 of the MSMED Act/)
})

test('expiry-day mail keeps the confirmation wording and is reminder 1', () => {
  const today = row({
    bgNo: 'TODAY',
    expiryDate: '2026-10-31',
    daysUntilExpiry: 0,
  })
  const email = buildReminderEmail({
    stage: 'EXPIRED',
    rows: [today],
    expiredRows: [today],
    upcomingRows: [],
    partyName: 'Kalpataru Projects International Limited',
    reminderNumber: 1,
  })

  assert.match(email.subject, /PBG expiring today/)
  assert.match(email.html, /expired today, 31 Oct 2026/)
  assert.match(email.html, /This is reminder no\. 1\./)
  assert.match(email.html, /The said bank guarantee is considered as closed/)
  assert.doesNotMatch(email.html, /Section 18 of the MSMED Act/)
})

test('B-only mail is informational and has no legal/MSEFC text or days column', () => {
  const email = buildReminderEmail({
    stage: 'BEFORE_30_DAYS',
    rows: upcomingRows,
    expiredRows: [],
    upcomingRows,
    partyName: 'Kalpataru Projects International Limited',
  })

  assert.match(email.subject, /Information: PBG expiring within 30 days/)
  assert.match(email.html, /B\. Expiring in Next 30 Days \(For Information\)/)
  assert.doesNotMatch(email.html, /A\. Expired \(Return Requested\)/)
  assert.doesNotMatch(email.html, /Rule 171/)
  assert.doesNotMatch(email.html, /MSEFC/)
  assert.doesNotMatch(email.html, /Days since expiry/)
})

test('html escapes untrusted values', () => {
  const email = buildReminderEmail({
    stage: 'EXPIRED',
    rows: [
      row({
        project: '<script>alert(1)</script>',
        poNumber: 'A & B',
      }),
    ],
    expiredRows: [
      row({
        project: '<script>alert(1)</script>',
        poNumber: 'A & B',
      }),
    ],
    upcomingRows: [],
  })

  assert.doesNotMatch(email.html, /<script>/)
  assert.match(email.html, /&lt;script&gt;/)
  assert.match(email.html, /A &amp; B/)
})

test('text body contains both sections, new totals, days and provisions', () => {
  const email = buildReminderEmail({
    stage: 'EXPIRED',
    rows: [...expiredRows, ...upcomingRows],
    expiredRows,
    upcomingRows,
    partyName: 'Kalpataru Projects International Limited',
    reminderNumber: 1,
    earlierMailDates: ['2026-10-26'],
    udyamNo: 'UDYAM-TEST-123',
  })

  assert.doesNotMatch(email.text, /^Subject:/)
  assert.match(email.text, /^Dear Sir\/Madam,\nKalpataru Projects International Limited/)
  assert.match(email.text, /A\. Expired \(Return Requested\)/)
  assert.match(email.text, /B\. Expiring in Next 30 Days \(For Information\)/)
  assert.match(email.text, /Total BG Amount: 1,00,000\.00/)
  assert.match(email.text, /Total BG Amount: 50,000\.00/)
  assert.match(email.text, /Total BG Amount Pending Return: 1,50,000\.00/)
  assert.match(email.text, /Days since expiry: 600/)
  assert.match(email.text, /1\. Rule 171/)
  assert.match(email.text, /2\. Micro, Small and Medium Enterprises/)
  assert.doesNotMatch(email.text, /3\. Section 18/)
  assert.match(email.text, /Phone: \+91 88200 44755/)
  assert.match(email.text, /Email: puja\.agarwal@laserpowerinfra\.com/)
})

test('empty mail is rejected', () => {
  assert.throws(
    () => buildReminderEmail({ rows: [], expiredRows: [], upcomingRows: [] }),
    /no rows/,
  )
})
