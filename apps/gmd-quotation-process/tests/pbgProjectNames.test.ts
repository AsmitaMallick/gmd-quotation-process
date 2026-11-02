import test from 'node:test'
import assert from 'node:assert/strict'
import {
  KALPATARU_CLIENT_NAME,
  MASORA_PROJECT_NAME,
  canonicalPbgClientName,
  canonicalProjectName,
} from '../lib/pbg/project-names.js'

test('Masora spelling variants become one project name', () => {
  assert.equal(
    canonicalProjectName('Masora Sindwaha Water Supply'),
    MASORA_PROJECT_NAME,
  )
  assert.equal(
    canonicalProjectName('Masora Sindhwaha water Supply'),
    MASORA_PROJECT_NAME,
  )
  assert.equal(
    canonicalProjectName(null, '3000179463'),
    MASORA_PROJECT_NAME,
  )
})

test('Orissa becomes Odisha and comma spacing is normalised', () => {
  assert.equal(
    canonicalProjectName('OCDR Project, Cuttack ,Orissa'),
    'OCDR Project, Cuttack, Odisha',
  )
  assert.equal(
    canonicalProjectName('OCDR Project, Cuttack, Odisha'),
    'OCDR Project, Cuttack, Odisha',
  )
})

test('other project names are left untouched', () => {
  assert.equal(
    canonicalProjectName('BMWS- Balasore Odisha Project'),
    'BMWS- Balasore Odisha Project',
  )
  assert.equal(canonicalProjectName(null, 'PO1'), null)
})

test('JMC rows map to Kalpataru after the merger', () => {
  assert.equal(
    canonicalPbgClientName('JMC PROJECTS (INDIA) LIMITED'),
    KALPATARU_CLIENT_NAME,
  )
  assert.equal(
    canonicalPbgClientName('KALPATARU PROJECTS INTERNATIONAL LIMITED'),
    'KALPATARU PROJECTS INTERNATIONAL LIMITED',
  )
})
