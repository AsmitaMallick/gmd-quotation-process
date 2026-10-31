import test from 'node:test'
import assert from 'node:assert/strict'
import { constructTable, createSortedRowModel, rowSortingFeature, tableFeatures } from '@tanstack/react-table'
// @ts-expect-error untyped deep import: the adapter's reactivity binding, needed to build a table outside React
import { reactReactivity } from '../node_modules/@tanstack/react-table/dist/reactivity.js'
import { DEFAULT_DEBTOR_PREFS, loadPrefs, savePrefs, numericSort, dateSort, toAmount, toTime } from '../lib/tablePrefs.js'

const g = globalThis as unknown as { localStorage?: unknown }
const withStore = (store: unknown, fn: () => void) => {
  const prev = g.localStorage
  Object.defineProperty(globalThis, 'localStorage', { value: store, configurable: true, writable: true })
  try { fn() } finally { Object.defineProperty(globalThis, 'localStorage', { value: prev, configurable: true, writable: true }) }
}

test('default sort is overdue, highest first', () => {
  assert.deepEqual(DEFAULT_DEBTOR_PREFS.sorting, [{ id: 'overdue', desc: true }])
})

test('a blocked localStorage returns the defaults instead of throwing', () => {
  const boom = { getItem() { throw new Error('blocked') }, setItem() { throw new Error('blocked') } }
  withStore(boom, () => {
    assert.deepEqual(loadPrefs('x'), DEFAULT_DEBTOR_PREFS)
    assert.doesNotThrow(() => savePrefs('x', DEFAULT_DEBTOR_PREFS))
  })
})

test('corrupt or wrongly-shaped stored JSON falls back to the defaults', () => {
  withStore({ getItem: () => '{not json' }, () => assert.deepEqual(loadPrefs('x'), DEFAULT_DEBTOR_PREFS))
  withStore({ getItem: () => '{"sorting":"nope"}' }, () => assert.deepEqual(loadPrefs('x'), DEFAULT_DEBTOR_PREFS))
})

test('saved prefs round-trip', () => {
  const mem = new Map<string, string>()
  const store = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v) }
  const p = { sorting: [{ id: 'party', desc: false }], filters: { owner: 'Koushal' }, amountFormat: 'full' as const }
  withStore(store, () => { savePrefs('k', p); assert.deepEqual(loadPrefs('k'), p) })
})

type R = { name: string; amt: number; due?: number }
const features = tableFeatures({ rowSortingFeature, sortedRowModel: createSortedRowModel() })
const sorted = (data: R[], id: string, desc: boolean) => {
  const table = constructTable({
    features: { coreReactivityFeature: reactReactivity(), ...features }, data, state: { sorting: [{ id, desc }] },
    columns: [
      { id: 'amt', accessorFn: (r: R) => r.amt, sortFn: numericSort },
      { id: 'due', accessorFn: (r: R) => r.due, sortFn: dateSort, sortUndefined: 'last' },
    ],
  } as never) as unknown as { getRowModel(): { rows: { original: R }[] } }
  return table.getRowModel().rows.map((r) => r.original)
}

test('amounts sort as numbers, not text: 9 before 10 descending is wrong, 10 before 9 is right', () => {
  const data = [{ name: 'a', amt: 9 }, { name: 'b', amt: 10 }, { name: 'c', amt: 100 }]
  assert.deepEqual(sorted(data, 'amt', true).map((r) => r.amt), [100, 10, 9])
  assert.deepEqual(sorted(data, 'amt', false).map((r) => r.amt), [9, 10, 100])
})

test('blank dates sort last in both directions', () => {
  const data = [{ name: 'blank', amt: 0 }, { name: 'early', amt: 0, due: toTime('2026-01-01') }, { name: 'late', amt: 0, due: toTime('2026-06-01') }]
  assert.deepEqual(sorted(data, 'due', false).map((r) => r.name), ['early', 'late', 'blank'])
  assert.deepEqual(sorted(data, 'due', true).map((r) => r.name), ['late', 'early', 'blank'])
})

test('amount and date parsing', () => {
  assert.equal(toAmount('1,50,000'), 150000)
  assert.equal(toAmount('abc'), undefined)
  assert.equal(toAmount(' '), undefined)
  assert.equal(toTime(''), undefined)
  assert.equal(toTime('nope'), undefined)
})
