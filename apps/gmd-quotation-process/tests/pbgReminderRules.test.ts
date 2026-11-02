import test from 'node:test'
import assert from 'node:assert/strict'
import {
  daysUntilExpiry,
  describeDaysUntilExpiry,
  isEligibleStatus,
  isMailTriggerContinue,
  isPostExpiryDue,
  isPreExpiryDue,
} from '../lib/pbg/reminder-rules.js'

const IST_MORNING = new Date('2026-10-28T03:30:00.000Z') // 09:00 IST

test('daysUntilExpiry uses the IST calendar date', () => {
  assert.equal(daysUntilExpiry('2026-11-27', IST_MORNING), 30)
  assert.equal(daysUntilExpiry('2026-10-28', IST_MORNING), 0)
  assert.equal(daysUntilExpiry('2026-10-27', IST_MORNING), -1)
  assert.equal(daysUntilExpiry('2026-12-12', IST_MORNING), 45)
})

test('a UTC evening that is already the next day in IST counts as that day', () => {
  // 2026-10-27T19:00Z is 2026-10-28 00:30 IST.
  const lateUtc = new Date('2026-10-27T19:00:00.000Z')
  assert.equal(daysUntilExpiry('2026-11-27', lateUtc), 30)
})

test('closed is never eligible; open, running and expired are', () => {
  for (const status of ['OPEN', 'open', 'Running', 'EXPIRED']) {
    assert.equal(isEligibleStatus(status), true, status)
  }
  for (const status of [
    'CLOSED',
    'Closed',
    'close',
    'RETURNED',
    'Returned',
    '',
    null,
  ]) {
    assert.equal(isEligibleStatus(status), false, String(status))
  }
})

test('only an explicit CONTINUE allows mail', () => {
  assert.equal(isMailTriggerContinue('CONTINUE'), true)
  assert.equal(isMailTriggerContinue(' continue '), true)
  assert.equal(isMailTriggerContinue('HOLD'), false)
  assert.equal(isMailTriggerContinue(null), false)
  assert.equal(isMailTriggerContinue(''), false)
})

test('pre-expiry is due exactly on day 30, and retries only after a failure', () => {
  assert.equal(isPreExpiryDue({ days: 30, hasSent: false, hasFailed: false }), true)
  assert.equal(isPreExpiryDue({ days: 29, hasSent: false, hasFailed: false }), false)
  assert.equal(isPreExpiryDue({ days: 29, hasSent: false, hasFailed: true }), true)
  assert.equal(isPreExpiryDue({ days: 0, hasSent: false, hasFailed: true }), false)
  assert.equal(isPreExpiryDue({ days: 30, hasSent: true, hasFailed: false }), false)
})

test('post-expiry repeats after seven days', () => {
  const now = new Date('2026-10-28T03:30:00.000Z')
  assert.equal(isPostExpiryDue(null, now), true)
  assert.equal(
    isPostExpiryDue(new Date(now.getTime() - 6 * 86_400_000), now),
    false,
  )
  assert.equal(
    isPostExpiryDue(new Date(now.getTime() - 7 * 86_400_000), now),
    true,
  )
})

test('days description is human-readable', () => {
  assert.equal(describeDaysUntilExpiry(0), 'today')
  assert.equal(describeDaysUntilExpiry(1), 'tomorrow')
  assert.equal(describeDaysUntilExpiry(30), 'in 30 days')
  assert.equal(describeDaysUntilExpiry(-1), 'yesterday')
  assert.equal(describeDaysUntilExpiry(-7), '7 days ago')
})
