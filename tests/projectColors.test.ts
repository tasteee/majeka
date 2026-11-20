import { findPressedAction } from '../src/lib/state/keymap.svelte'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { getUsedProjectColors, planColorReplacement } from '../src/lib/model/projectColors'
import { fromCellKey, toCellKey } from '../src/lib/model/cellKey'
import { voxelDoc } from '../src/lib/model/voxelDoc'
import { editor, loadProjectIntoEditor, replaceProjectColor, undo, redo, selectGroup, getSelectedGroupIds, moveSelectedGroups, rotateSelectedGroups, selectAllGroups, selection, selectGroupsFromVoxelSelection } from '../src/lib/state/editor.svelte'
import type { ProjectMetaT, GroupMetaT, CellT, ProjectT } from '../src/lib/model/types'

const group = (id: string, parentId: string | null = null, isLocked = false, isHidden = false): GroupMetaT => ({
	id, name: id, parentId, pivot: [0, 0, 0], hasCustomPivot: true, isLocked, isHidden
})
const meta: ProjectMetaT = {
	version: 1, id: 'colors-test', name: 'Colors test', roomSize: [16, 16, 16],
	colors: ['#AA0000', '#00bb00', '#aa0000', '#0000cc', '#ffffff'],
	palette: [1, 2], recentColors: [], activeGroupId: 'root',
	groups: [group('root'), group('child', 'root'), group('locked', 'root', true), group('locked-child', 'locked'), group('other'), group('hidden', 'root', false, true)]
}
const cell = (groupId: string, colorIndex = 0): CellT => ({ groupId, colorIndex, shape: 'cube', rotation: 3 })
const cells = new Map([
	[toCellKey(0, 0, 0), cell('root')],
	[toCellKey(1, 0, 0), cell('child', 2)],
	[toCellKey(2, 0, 0), cell('locked')],
	[toCellKey(3, 0, 0), cell('locked-child')],
	[toCellKey(4, 0, 0), cell('other')],
	[toCellKey(5, 0, 0), cell('hidden')],
	[toCellKey(6, 0, 0), cell('child', 3)]
])

test('project colors include hidden/locked colors, merge duplicate hex values, and compare palette by value', () => {
	assert.deepEqual(getUsedProjectColors(meta, cells), [
		{ color: '#aa0000', count: 6, isInPalette: true },
		{ color: '#0000cc', count: 1, isInPalette: false }
	])
	assert.deepEqual(getUsedProjectColors(meta, new Map()), [])
})

test('group replacement includes descendants and hidden voxels, skips inherited locks and unrelated groups', () => {
	const plan = planColorReplacement(meta, cells, '#aa0000', '#00bb00', 'root')
	assert.deepEqual(plan.keys, [toCellKey(0, 0, 0), toCellKey(1, 0, 0), toCellKey(5, 0, 0)])
	assert.equal(plan.skippedLocked, 2)
	assert.equal(planColorReplacement(meta, cells, '#AA0000', '#00bb00').keys.length, 4)
	assert.deepEqual(planColorReplacement(meta, cells, '#aa0000', '#AA0000'), { keys: [], skippedLocked: 0 })
	assert.deepEqual(planColorReplacement(meta, cells, '#aa0000', '#00bb00', 'deleted'), { keys: [], skippedLocked: 0 })
	assert.deepEqual(planColorReplacement(meta, cells, '#ffffff', '#00bb00'), { keys: [], skippedLocked: 0 })
})

test('replacement preserves palette and voxel properties, and undoes/redoes in a single step', () => {
	// Suppress autosave/toast timers: this test uses the real editor history,
	// but deliberately does not open a browser database.
	const originalSetTimeout = globalThis.setTimeout
	globalThis.setTimeout = (() => 0) as unknown as typeof setTimeout
	try {
		const project: ProjectT = {
			...structuredClone(meta),
			groups: meta.groups.map((entry) => ({
				...structuredClone(entry),
				voxels: [...cells].filter(([, cell]) => cell.groupId === entry.id).map(([key, cell]) => ({
					position: fromCellKey(key), colorIndex: cell.colorIndex, shape: cell.shape, rotation: cell.rotation
				}))
			}))
		}
		loadProjectIntoEditor(project)
		const before = [...voxelDoc.cells].map(([key, value]) => [key, { ...value }])
		const beforeMeta = JSON.stringify(editor.meta)
		replaceProjectColor('#aa0000', '#00bb00', 'root')
		assert.deepEqual(editor.meta?.palette, meta.palette)
		assert.deepEqual(editor.meta?.colors, meta.colors)
		assert.equal([...voxelDoc.cells.values()].filter((value) => value.colorIndex === 1).length, 3)
		assert.ok([...voxelDoc.cells.values()].every((value) => value.rotation === 3))
		undo()
		assert.deepEqual([...voxelDoc.cells], before)
		assert.equal(JSON.stringify(editor.meta), beforeMeta)
		assert.equal(editor.canUndo, false)
		redo()
		assert.equal([...voxelDoc.cells.values()].filter((value) => value.colorIndex === 1).length, 3)
		assert.equal(editor.canRedo, false)

		loadProjectIntoEditor(project)
		replaceProjectColor('#aa0000', '#abcdef', null)
		assert.equal(editor.meta?.colors.at(-1), '#abcdef')
		assert.deepEqual(editor.meta?.palette, meta.palette)
		assert.equal([...voxelDoc.cells.values()].filter((value) => value.colorIndex === 5).length, 4)
		undo()
		assert.deepEqual([...voxelDoc.cells], before)
		assert.deepEqual(editor.meta?.colors, meta.colors)
		assert.equal(editor.canUndo, false)

		replaceProjectColor('#aa0000', '#AA0000', null)
		assert.equal(editor.canUndo, false)
		assert.deepEqual(editor.meta?.colors, meta.colors)
	} finally {
		globalThis.setTimeout = originalSetTimeout
	}
})


test('multi-group transforms are atomic, deduplicate descendants and preserve shared rotation', () => {
 const originalSetTimeout = globalThis.setTimeout
 globalThis.setTimeout = (() => 0) as unknown as typeof setTimeout
 try {
  const project: ProjectT = {
   ...structuredClone(meta), activeGroupId: 'a',
   groups: [group('a'), group('b', 'a'), group('c')].map((g, i) => ({
    ...g, pivot: [4, 4, 4], voxels: [{ position: [3 + i, 3, 3], colorIndex: 0, shape: 'cube', rotation: 0 }]
   }))
  }
  const snapshot = () => [...voxelDoc.cells].map(([key, value]) => [key, { ...value }]).sort((a, b) => Number(a[0]) - Number(b[0]))
  loadProjectIntoEditor(project)
  selectGroup('a'); selectGroup('b', true); selectGroup('c', true)
  assert.deepEqual(getSelectedGroupIds(), ['a', 'b', 'c'])
  const marker = toCellKey(10, 10, 10)
  selection.add(toCellKey(3, 3, 3))
  selection.add(toCellKey(4, 3, 3))
  selection.add(marker)
  selectGroupsFromVoxelSelection()
  assert.deepEqual(getSelectedGroupIds(), ['a', 'b'])
  selectGroup('c', true)
  const selectedBefore = [...selection].sort((a, b) => a - b)
  const assertHighlights = () => {
   const expected = [...voxelDoc.cells].filter(([, cell]) => cell.groupId !== 'c').map(([key]) => key)
   assert.deepEqual([...selection].sort((a, b) => a - b), [...expected, marker].sort((a, b) => a - b))
  }
  const before = snapshot()
  moveSelectedGroups([0, 1, 0])
  assert.equal(voxelDoc.cells.size, 3)
  assert.ok([...voxelDoc.cells.keys()].every((key) => fromCellKey(key)[1] === 4))
  assertHighlights()
  undo(); assert.deepEqual(snapshot(), before)
  assert.deepEqual([...selection].sort((a, b) => a - b), selectedBefore)
  redo(); assert.ok([...voxelDoc.cells.keys()].every((key) => fromCellKey(key)[1] === 4))
  assertHighlights()
  for (const axis of [0, 1, 2] as const) {
   const start = snapshot()
   rotateSelectedGroups(axis, -1); assertHighlights()
   rotateSelectedGroups(axis, 1); assertHighlights()
   assert.deepEqual(snapshot(), start)
   for (let i = 0; i < 4; i++) { rotateSelectedGroups(axis); assertHighlights() }
   assert.deepEqual(snapshot(), start)
  }
  const valid = snapshot()
  moveSelectedGroups([0, -20, 0]); assert.deepEqual(snapshot(), valid)
  assertHighlights()
  editor.meta!.groups[1].isLocked = true
  // Reload to refresh inherited lock flags.
  project.groups[1].isLocked = true
  loadProjectIntoEditor(project); selectAllGroups()
  const locked = snapshot()
  moveSelectedGroups([0, 1, 0]); assert.deepEqual(snapshot(), locked)
  loadProjectIntoEditor(project); assert.deepEqual(getSelectedGroupIds(), [])
  selectGroup('a'); selectGroup('c', true); selectGroup('a', true)
  assert.deepEqual(getSelectedGroupIds(), ['c'])
 } finally { globalThis.setTimeout = originalSetTimeout }
})


test('modified arrows map to vertical movement and all three rotation axes', () => {
 const cases = [
  ['ArrowUp', 'shiftKey', 'nudgeVerticalUp'], ['ArrowDown', 'shiftKey', 'nudgeVerticalDown'],
  ['ArrowLeft', 'ctrlKey', 'rotateYNegative'], ['ArrowRight', 'ctrlKey', 'rotateYPositive'],
  ['ArrowUp', 'ctrlKey', 'rotateXNegative'], ['ArrowDown', 'ctrlKey', 'rotateXPositive'],
  ['ArrowLeft', 'altKey', 'rotateZNegative'], ['ArrowRight', 'altKey', 'rotateZPositive']
 ]
 for (const [code, modifier, expected] of cases) {
  assert.equal(findPressedAction({ code, ctrlKey: false, shiftKey: false, altKey: false, metaKey: false, [modifier]: true } as unknown as KeyboardEvent), expected)
 }
 assert.equal(findPressedAction({ code: 'ArrowUp' } as KeyboardEvent), 'nudgeForward')
})
