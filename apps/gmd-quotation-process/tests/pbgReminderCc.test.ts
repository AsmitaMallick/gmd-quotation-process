import test from 'node:test'
import assert from 'node:assert/strict'
import {
  DEFAULT_PBG_REMINDER_CC,
  mergeReminderCc,
} from '../lib/pbg/reminder-cc.js'

test('the mandatory internal copy is always included', () => {
  assert.deepEqual(mergeReminderCc(''), DEFAULT_PBG_REMINDER_CC)
  assert.deepEqual(mergeReminderCc(null), DEFAULT_PBG_REMINDER_CC)
})

test('configured CC addresses are merged without duplicates', () => {
  assert.deepEqual(
    mergeReminderCc(
      'Puja Agarwal <puja.agarwal@laserpowerinfra.com>, ops@example.com',
    ),
    ['puja.agarwal@laserpowerinfra.com', 'ops@example.com'],
  )
})
