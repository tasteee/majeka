import { SvelteSet } from 'svelte/reactivity'
import { checkIsInsideRoom, fromCellKey, toCellKey, toCellKeyFromVec } from '../model/cellKey'
import { checkIsGroupHidden, checkIsGroupLocked, computeGroupCenter, findGroup, getGroupFamilyIds } from '../model/groups'
import { createGroupMeta } from '../model/project'
import { getUsedProjectColors, planColorReplacement } from '../model/projectColors'
import type { PresetPaletteT } from '../model/presetPalettes'
import { findConnectedCells } from '../model/shapes'
import {
	buildProjectFromDoc,
	getCell,
	getGroupKeys,
	loadVoxelDoc,
	setCell,
	startRecordingChanges,
	stopRecordingChanges,
	takeDirtyGroupIds,
	voxelDoc
} from '../model/voxelDoc'
import type { CellChangeT } from '../model/voxelDoc'
import type { AxisT, CellT, GroupMetaT, ProjectMetaT, ProjectT, Vec3T } from '../model/types'
import { storeProject } from './gallery.svelte'
import { showToast } from './ui.svelte'
import type { ToolActionIdT, ToolShapeIdT } from './tools'

export type ViewModeT = 'flat' | 'render'

export const editor = $state({
	meta: null as ProjectMetaT | null,
	action: 'place' as ToolActionIdT,
	shape: 'block' as ToolShapeIdT,
	viewMode: 'flat' as ViewModeT,
	selectedColor: '#e85d75',
	prefabId: 'lCorner',
	prefabTurns: 0,
	// the group picked with the object or pivot tool
	selectedGroupId: '',
	additionalGroupIds: [] as string[],
	sharedGroupPivot: null as Vec3T | null,
	// bumps per group when its mesh must be rebuilt
	meshVersions: {} as Record<string, number>,
	canUndo: false,
	canRedo: false,
	isSaving: false,
	isColorsOpen: true,
	isGroupsOpen: true,
	isProjectColorsOpen: false,
	// bumps on every committed change, for derived panels
	docVersion: 0
})

// Edit-mode voxel selection, by cell key.
export const selection = new SvelteSet<number>()

// Effective hidden / locked flags, refreshed whenever groups
// change. Plain sets so the hot raycast path stays cheap.
const hiddenGroupIds = new Set<string>()
const lockedGroupIds = new Set<string>()

const refreshGroupFlags = (): void => {
	hiddenGroupIds.clear()
	lockedGroupIds.clear()
	const meta = editor.meta
	if (!meta) return

	for (const group of meta.groups) {
		const isHidden = checkIsGroupHidden(meta.groups, group.id)
		if (isHidden) hiddenGroupIds.add(group.id)
		const isLocked = checkIsGroupLocked(meta.groups, group.id)
		if (isLocked) lockedGroupIds.add(group.id)
	}
}

export const checkIsGroupIdHidden = (groupId: string): boolean => {
	return hiddenGroupIds.has(groupId)
}

export const checkIsGroupIdLocked = (groupId: string): boolean => {
	return lockedGroupIds.has(groupId)
}

// Visible voxels block the pointer and hide neighbor faces.
export const checkIsVisibleSolid = (x: number, y: number, z: number): boolean => {
	const cell = voxelDoc.cells.get(toCellKey(x, y, z))
	if (!cell) return false
	return !hiddenGroupIds.has(cell.groupId)
}

export const checkIsCellEditable = (cell: CellT | null): boolean => {
	if (cell === null) return false
	const isHidden = hiddenGroupIds.has(cell.groupId)
	const isLocked = lockedGroupIds.has(cell.groupId)
	return !isHidden && !isLocked
}

export const getMeta = (): ProjectMetaT => {
	const meta = editor.meta
	if (meta === null) throw new Error('No project is open')
	return meta
}

const bumpMeshVersion = (groupId: string): void => {
	const currentVersion = editor.meshVersions[groupId] ?? 0
	editor.meshVersions[groupId] = currentVersion + 1
}

const flushMeshes = (): void => {
	const dirtyGroupIds = takeDirtyGroupIds()
	for (const groupId of dirtyGroupIds) bumpMeshVersion(groupId)
}

export const rebuildAllMeshes = (): void => {
	takeDirtyGroupIds()
	const meta = editor.meta
	if (!meta) return
	for (const group of meta.groups) bumpMeshVersion(group.id)
}

// ---------- saving ----------

let saveTimer: ReturnType<typeof setTimeout> | null = null

export const saveNow = async (): Promise<void> => {
	if (saveTimer) clearTimeout(saveTimer)
	saveTimer = null
	const meta = editor.meta
	if (!meta) return
	const plainMeta: ProjectMetaT = $state.snapshot(meta)
	const project = buildProjectFromDoc(plainMeta)
	editor.isSaving = true
	await storeProject(project)
	editor.isSaving = false
}

const scheduleSave = (): void => {
	if (saveTimer) clearTimeout(saveTimer)
	saveTimer = setTimeout(saveNow, 700)
}

// ---------- history ----------

type HistoryEntryT = {
	label: string
	changes: Map<number, CellChangeT>
	metaBefore: string
	metaAfter: string
	// set only on selection entries, which touch no voxels
	selectionBefore: number[] | null
	selectionAfter: number[] | null
}

const MAX_HISTORY = 300
let undoStack: HistoryEntryT[] = []
let redoStack: HistoryEntryT[] = []

const refreshHistoryFlags = (): void => {
	editor.canUndo = undoStack.length > 0
	editor.canRedo = redoStack.length > 0
}

const snapshotMeta = (): string => {
	return JSON.stringify($state.snapshot(getMeta()))
}

const refreshAutoPivots = (changes: Map<number, CellChangeT>): void => {
	const meta = getMeta()
	const touchedGroupIds = new Set<string>()

	for (const change of changes.values()) {
		if (change.before) touchedGroupIds.add(change.before.groupId)
		if (change.after) touchedGroupIds.add(change.after.groupId)
	}

	for (const groupId of touchedGroupIds) {
		const group = findGroup(meta.groups, groupId)
		if (!group) continue
		if (group.hasCustomPivot) continue
		const center = computeGroupCenter([groupId])
		if (center) group.pivot = center
	}
}

const afterDocChange = (): void => {
	refreshGroupFlags()
	flushMeshes()
	editor.docVersion += 1
	refreshHistoryFlags()
	scheduleSave()
}

// Every edit runs through here, so every edit is undoable:
// voxel changes are recorded cell by cell and the rest of the
// project (groups, colors, pivots) is snapshotted.
export const runEdit = (label: string, mutate: () => void, recordSelection = false): boolean => {
	const meta = editor.meta
	if (!meta) return false
	const metaBefore = snapshotMeta()
	const selectionBefore = recordSelection ? [...selection] : null
	startRecordingChanges()
	mutate()
	const changes = stopRecordingChanges()
	refreshAutoPivots(changes)
	const metaAfter = snapshotMeta()
	const hasVoxelChanges = changes.size > 0
	const hasMetaChanges = metaBefore !== metaAfter
	const hasAnyChange = hasVoxelChanges || hasMetaChanges

	if (!hasAnyChange) {
		flushMeshes()
		return false
	}

	undoStack.push({ label, changes, metaBefore, metaAfter, selectionBefore, selectionAfter: recordSelection ? [...selection] : null })
	const isTooLong = undoStack.length > MAX_HISTORY
	if (isTooLong) undoStack = undoStack.slice(-MAX_HISTORY)
	redoStack = []
	afterDocChange()
	return true
}

const applyMetaText = (metaText: string): void => {
	const previousHiddenIds = [...hiddenGroupIds].join()
	const previousRoomSize = voxelDoc.roomSize.join()
	const nextMeta: ProjectMetaT = JSON.parse(metaText)
	editor.meta = nextMeta
	voxelDoc.roomSize = [...nextMeta.roomSize]
	refreshGroupFlags()
	const nextHiddenIds = [...hiddenGroupIds].join()
	const didVisibilityChange = previousHiddenIds !== nextHiddenIds
	const didRoomChange = previousRoomSize !== voxelDoc.roomSize.join()
	const needsFullRebuild = didVisibilityChange || didRoomChange
	if (needsFullRebuild) rebuildAllMeshes()
}

const applyChanges = (changes: Map<number, CellChangeT>, isUndo: boolean): void => {
	for (const [key, change] of changes) {
		const targetCell = isUndo ? change.before : change.after
		setCell(key, targetCell)
	}
}

const replaceSelection = (cellKeys: number[]): void => {
	selection.clear()
	for (const cellKey of cellKeys) selection.add(cellKey)
}

// Selection changes are history entries too, so undo and redo
// step through them in order with the voxel edits.
export const runSelectionEdit = (label: string, mutate: () => void): void => {
	const selectionBefore = [...selection]
	mutate()
	const selectionAfter = [...selection]
	const isSameSize = selectionBefore.length === selectionAfter.length
	const hasSameKeys = selectionBefore.every((cellKey) => selection.has(cellKey))
	const didChange = !(isSameSize && hasSameKeys)
	if (!didChange) return
	const changes = new Map<number, CellChangeT>()
	undoStack.push({ label, changes, metaBefore: '', metaAfter: '', selectionBefore, selectionAfter })
	const isTooLong = undoStack.length > MAX_HISTORY
	if (isTooLong) undoStack = undoStack.slice(-MAX_HISTORY)
	redoStack = []
	refreshHistoryFlags()
}

export const undo = (): void => {
	editor.sharedGroupPivot = null
	const entry = undoStack.pop()
	if (!entry) return
	redoStack.push(entry)
	const isSelectionEntry = entry.metaBefore === ''

	if (isSelectionEntry) {
		replaceSelection(entry.selectionBefore ?? [])
		refreshHistoryFlags()
		showToast(`Undo ${entry.label}`)
		return
	}

	applyMetaText(entry.metaBefore)
	applyChanges(entry.changes, true)
	replaceSelection(entry.selectionBefore ?? [])
	afterDocChange()
	showToast(`Undo ${entry.label}`)
}

export const redo = (): void => {
	editor.sharedGroupPivot = null
	const entry = redoStack.pop()
	if (!entry) return
	undoStack.push(entry)
	const isSelectionEntry = entry.metaAfter === ''

	if (isSelectionEntry) {
		replaceSelection(entry.selectionAfter ?? [])
		refreshHistoryFlags()
		showToast(`Redo ${entry.label}`)
		return
	}

	applyMetaText(entry.metaAfter)
	applyChanges(entry.changes, false)
	replaceSelection(entry.selectionAfter ?? [])
	afterDocChange()
	showToast(`Redo ${entry.label}`)
}

// ---------- open / close ----------

export const loadProjectIntoEditor = (project: ProjectT): void => {
	loadVoxelDoc(project)
	const groups: GroupMetaT[] = project.groups.map((group) => {
		const groupMeta: GroupMetaT = {
			id: group.id,
			name: group.name,
			parentId: group.parentId,
			pivot: [...group.pivot],
			hasCustomPivot: group.hasCustomPivot,
			isHidden: group.isHidden,
			isLocked: group.isLocked
		}
		return groupMeta
	})

	editor.meta = { ...project, groups }
	editor.meshVersions = {}
	clearGroupSelection()
	editor.action = 'place'
	editor.shape = 'block'
	undoStack = []
	redoStack = []
	selection.clear()
	refreshGroupFlags()
	rebuildAllMeshes()
	refreshHistoryFlags()
	editor.docVersion += 1
}

export const closeEditor = async (): Promise<void> => {
	await saveNow()
	editor.meta = null
	selection.clear()
}

// ---------- colors ----------

const MAX_RECENT_COLORS = 32

const normalizeHex = (hexColor: string): string => {
	return hexColor.trim().toLowerCase()
}

const getOrAddColorIndex = (hexColor: string): number => {
	const meta = getMeta()
	const normalizedColor = normalizeHex(hexColor)
	const existingIndex = meta.colors.findIndex((color) => normalizeHex(color) === normalizedColor)
	const hasExisting = existingIndex >= 0
	if (hasExisting) return existingIndex
	meta.colors.push(normalizedColor)
	return meta.colors.length - 1
}

const markColorUsed = (colorIndex: number): void => {
	const meta = getMeta()
	const otherRecents = meta.recentColors.filter((recentIndex) => recentIndex !== colorIndex)
	meta.recentColors = [colorIndex, ...otherRecents].slice(0, MAX_RECENT_COLORS)
}

export const selectColor = (hexColor: string): void => {
	editor.selectedColor = normalizeHex(hexColor)
}

export const addSelectedColorToPalette = (): void => {
	runEdit('add to palette', () => {
		const meta = getMeta()
		const colorIndex = getOrAddColorIndex(editor.selectedColor)
		const isInPalette = meta.palette.includes(colorIndex)
		if (isInPalette) return
		meta.palette.push(colorIndex)
	})
}

// Replaces the palette with a preset. Colors already used by
// voxels stay in the project, they just leave the palette.
export const loadPresetPalette = (preset: PresetPaletteT): void => {
	runEdit('load palette', () => {
		const meta = getMeta()
		meta.palette = preset.colors.map((hexColor) => getOrAddColorIndex(hexColor))
	})
}

export const removeFromPalette = (colorIndex: number): void => {
	runEdit('remove from palette', () => {
		const meta = getMeta()
		meta.palette = meta.palette.filter((paletteIndex) => paletteIndex !== colorIndex)
	})
}

// Version arguments make plain voxel-map reads reactive in panels.
export const listProjectColors = (_docVersion: number) => getUsedProjectColors(getMeta(), voxelDoc.cells)

export const previewColorReplacement = (source: string, target: string, groupId: string | null, _docVersion: number) => {
	return planColorReplacement(getMeta(), voxelDoc.cells, source, target, groupId)
}

export const replaceProjectColor = (source: string, target: string, groupId: string | null): void => {
	const plan = planColorReplacement(getMeta(), voxelDoc.cells, source, target, groupId)
	if (plan.keys.length > 0) {
		runEdit('replace color', () => {
			const colorIndex = getOrAddColorIndex(target)
			for (const key of plan.keys) {
				const cell = getCell(key)
				if (cell) setCell(key, { ...cell, colorIndex })
			}
			markColorUsed(colorIndex)
		})
	}
	const skipped = plan.skippedLocked > 0 ? ` · ${plan.skippedLocked.toLocaleString()} locked voxels skipped` : ''
	showToast(`Replaced ${plan.keys.length.toLocaleString()} voxels${skipped}`)
}

export const pickColorFromCell = (cellPosition: Vec3T): void => {
	const cell = getCell(toCellKeyFromVec(cellPosition))
	if (!cell) return
	const meta = getMeta()
	const pickedColor = meta.colors[cell.colorIndex]
	if (!pickedColor) return
	selectColor(pickedColor)
	showToast(`Picked ${pickedColor}`)
}

// ---------- building ----------

const getActiveGroupForBuilding = (): GroupMetaT | null => {
	const meta = getMeta()
	const activeGroup = findGroup(meta.groups, meta.activeGroupId)
	if (!activeGroup) return null
	const isBlocked = hiddenGroupIds.has(activeGroup.id) || lockedGroupIds.has(activeGroup.id)

	if (isBlocked) {
		showToast(`${activeGroup.name} is hidden or locked`, 'danger')
		return null
	}

	return activeGroup
}

const createCell = (groupId: string, colorIndex: number): CellT => {
	return { groupId, colorIndex, shape: 'cube', rotation: 0 }
}

export const checkCanPlaceAt = (position: Vec3T): boolean => {
	const isInside = checkIsInsideRoom(position, voxelDoc.roomSize)
	if (!isInside) return false
	return !voxelDoc.cells.has(toCellKeyFromVec(position))
}

export const checkCanRemoveAt = (position: Vec3T): boolean => {
	const isInside = checkIsInsideRoom(position, voxelDoc.roomSize)
	if (!isInside) return false
	const cell = getCell(toCellKeyFromVec(position))
	return checkIsCellEditable(cell)
}

export const placeCells = (label: string, positions: Vec3T[]): void => {
	const activeGroup = getActiveGroupForBuilding()
	if (!activeGroup) return

	runEdit(label, () => {
		const colorIndex = getOrAddColorIndex(editor.selectedColor)
		let placedCount = 0

		for (const position of positions) {
			const canPlace = checkCanPlaceAt(position)
			if (!canPlace) continue
			setCell(toCellKeyFromVec(position), createCell(activeGroup.id, colorIndex))
			placedCount += 1
		}

		const hasPlaced = placedCount > 0
		if (hasPlaced) markColorUsed(colorIndex)
	})
}

export const removeCells = (label: string, positions: Vec3T[]): void => {
	runEdit(label, () => {
		for (const position of positions) {
			const canRemove = checkCanRemoveAt(position)
			if (!canRemove) continue
			setCell(toCellKeyFromVec(position), null)
		}
	})
}

export type ExtrudePlanT = {
	adds: Vec3T[]
	removals: Vec3T[]
}

// Grows (distance > 0) or shrinks (distance < 0) a surface.
// Grown voxels use the selected color, like the ghost.
export const planExtrude = (surface: Vec3T[], normal: Vec3T, distance: number): ExtrudePlanT => {
	const plan: ExtrudePlanT = { adds: [], removals: [] }
	const isGrowing = distance > 0
	const layerCount = Math.abs(distance)

	for (const sourceCell of surface) {
		const source = getCell(toCellKeyFromVec(sourceCell))
		if (!source) continue

		for (const layerIndex of Array.from({ length: layerCount }, (_unused, position) => position)) {
			if (isGrowing) {
				const step = layerIndex + 1
				const target: Vec3T = [sourceCell[0] + normal[0] * step, sourceCell[1] + normal[1] * step, sourceCell[2] + normal[2] * step]
				const canPlace = checkCanPlaceAt(target)
				// Growth stops at the first obstacle in the column
				if (!canPlace) break
				plan.adds.push(target)
				continue
			}

			const target: Vec3T = [sourceCell[0] - normal[0] * layerIndex, sourceCell[1] - normal[1] * layerIndex, sourceCell[2] - normal[2] * layerIndex]
			const canRemove = checkCanRemoveAt(target)
			if (canRemove) plan.removals.push(target)
		}
	}

	return plan
}

export const applyExtrude = (plan: ExtrudePlanT): void => {
	const hasAdds = plan.adds.length > 0
	const activeGroup = hasAdds ? getActiveGroupForBuilding() : null
	const isBlocked = hasAdds && activeGroup === null
	if (isBlocked) return

	runEdit('extrude', () => {
		for (const removal of plan.removals) setCell(toCellKeyFromVec(removal), null)
		if (!activeGroup) return

		const colorIndex = getOrAddColorIndex(editor.selectedColor)

		for (const position of plan.adds) {
			setCell(toCellKeyFromVec(position), createCell(activeGroup.id, colorIndex))
		}

		markColorUsed(colorIndex)
	})
}

// ---------- edit-mode selection ----------

export const paintSelection = (): void => {
	runEdit('paint selection', () => {
		const colorIndex = getOrAddColorIndex(editor.selectedColor)

		for (const key of selection) {
			const cell = getCell(key)
			const isEditable = checkIsCellEditable(cell)
			if (!isEditable) continue
			if (!cell) continue
			setCell(key, { ...cell, colorIndex })
		}

		markColorUsed(colorIndex)
	})
}

// Voxels touching face to face that share the start voxel's
// group and color, skipping hidden or locked groups.
export const findColorRegion = (startCell: Vec3T): Vec3T[] => {
	const startData = getCell(toCellKeyFromVec(startCell))
	if (startData === null) return []

	return findConnectedCells(startCell, voxelDoc.roomSize, (candidate) => {
		const candidateData = getCell(toCellKeyFromVec(candidate))
		if (candidateData === null) return false
		const isSameGroup = candidateData.groupId === startData.groupId
		const isSameColor = candidateData.colorIndex === startData.colorIndex
		const isEditable = checkIsCellEditable(candidateData)
		return isSameGroup && isSameColor && isEditable
	})
}

export const checkCanPaintAt = (position: Vec3T): boolean => {
	const isInside = checkIsInsideRoom(position, voxelDoc.roomSize)
	if (!isInside) return false
	return checkIsCellEditable(getCell(toCellKeyFromVec(position)))
}

// Edit-mode selection only reaches voxels in the active group.
export const checkCanSelectAt = (position: Vec3T): boolean => {
	const canPaint = checkCanPaintAt(position)
	if (!canPaint) return false
	const cell = getCell(toCellKeyFromVec(position))
	return cell?.groupId === getMeta().activeGroupId
}

// Recolors existing voxels to the selected color.
export const paintCells = (label: string, positions: Vec3T[]): void => {
	runEdit(label, () => {
		const colorIndex = getOrAddColorIndex(editor.selectedColor)
		let paintedCount = 0

		for (const position of positions) {
			const canPaint = checkCanPaintAt(position)
			if (!canPaint) continue
			const key = toCellKeyFromVec(position)
			const cell = getCell(key)
			if (!cell) continue
			const isAlreadyPainted = cell.colorIndex === colorIndex
			if (isAlreadyPainted) continue
			setCell(key, { ...cell, colorIndex })
			paintedCount += 1
		}

		const hasPainted = paintedCount > 0
		if (hasPainted) markColorUsed(colorIndex)
	})
}

export const deleteSelection = (): void => {
	const hasSelection = selection.size > 0
	if (!hasSelection) return

	runEdit('delete selection', () => {
		for (const key of selection) {
			const cell = getCell(key)
			const isEditable = checkIsCellEditable(cell)
			if (isEditable) setCell(key, null)
		}
	})

	selection.clear()
}

// Moves the selected voxels into a new group nested under the
// active group (carving a wheel out of a car).
export const groupSelection = (name: string): void => {
	const hasSelection = selection.size > 0
	if (!hasSelection) return
	const meta = getMeta()
	const parentGroup = findGroup(meta.groups, meta.activeGroupId)
	const parentId = parentGroup ? parentGroup.id : null
	const newGroup = createGroupMeta(name, parentId)

	runEdit('group selection', () => {
		const editMeta = getMeta()
		editMeta.groups.push(newGroup)

		for (const key of selection) {
			const cell = getCell(key)
			const isEditable = checkIsCellEditable(cell)
			if (!isEditable) continue
			if (!cell) continue
			setCell(key, { ...cell, groupId: newGroup.id })
		}

		editMeta.activeGroupId = newGroup.id
	})

	selection.clear()
	refreshGroupFlags()
}

// ---------- groups ----------

export const setActiveGroup = (groupId: string): void => {
	runEdit('active group', () => {
		getMeta().activeGroupId = groupId
	})
}

export const createEmptyGroup = (name: string): void => {
	const newGroup = createGroupMeta(name, null)
	const meta = getMeta()
	newGroup.pivot = [meta.roomSize[0] / 2, 0, meta.roomSize[2] / 2]

	runEdit('new group', () => {
		const editMeta = getMeta()
		editMeta.groups.push(newGroup)
		editMeta.activeGroupId = newGroup.id
	})
}

export const renameGroup = (groupId: string, name: string): void => {
	runEdit('rename group', () => {
		const group = findGroup(getMeta().groups, groupId)
		if (group) group.name = name
	})
}

export const toggleGroupHidden = (groupId: string): void => {
	runEdit('hide group', () => {
		const group = findGroup(getMeta().groups, groupId)
		if (group) group.isHidden = !group.isHidden
	})
	rebuildAllMeshes()
}

export const toggleGroupLocked = (groupId: string): void => {
	runEdit('lock group', () => {
		const group = findGroup(getMeta().groups, groupId)
		if (group) group.isLocked = !group.isLocked
	})
}

export const unnestGroup = (groupId: string): void => {
	runEdit('unnest group', () => {
		const groups = getMeta().groups
		const group = findGroup(groups, groupId)
		if (!group) return
		const parentGroup = findGroup(groups, group.parentId)
		group.parentId = parentGroup ? parentGroup.parentId : null
	})
}

export const deleteGroup = (groupId: string): void => {
	const meta = getMeta()
	const familyIds = getGroupFamilyIds(meta.groups, groupId)
	const remainingCount = meta.groups.length - familyIds.length
	const isLastGroup = remainingCount < 1

	if (isLastGroup) {
		showToast('A project needs at least one group', 'danger')
		return
	}

	runEdit('delete group', () => {
		const editMeta = getMeta()

		for (const familyId of familyIds) {
			for (const key of getGroupKeys(familyId)) setCell(key, null)
		}

		editMeta.groups = editMeta.groups.filter((group) => !familyIds.includes(group.id))
		const isActiveRemoved = familyIds.includes(editMeta.activeGroupId)
		if (isActiveRemoved) editMeta.activeGroupId = editMeta.groups[0].id
	})

	const remaining = getSelectedGroupIds().filter((id) => !familyIds.includes(id))
	editor.selectedGroupId = remaining[0] ?? ''
	editor.additionalGroupIds = remaining.slice(1)
	editor.sharedGroupPivot = null
}

export const getSelectedGroupIds = (): string[] => editor.selectedGroupId
	? [editor.selectedGroupId, ...editor.additionalGroupIds].filter((id) => editor.meta?.groups.some((group) => group.id === id)) : []

export const clearGroupSelection = (): void => {
	editor.selectedGroupId = ''
	editor.additionalGroupIds = []
	editor.sharedGroupPivot = null
}

export const selectGroupsFromVoxelSelection = (): void => {
	const ids = [...new Set([...selection].flatMap((key) => {
		const cell = getCell(key)
		return cell ? [cell.groupId] : []
	}))]
	if (!ids.length) return
	editor.selectedGroupId = ids[0]
	editor.additionalGroupIds = ids.slice(1)
	editor.sharedGroupPivot = null
}

export const selectGroup = (groupId: string, additive = false): void => {
	editor.sharedGroupPivot = null
	const ids = additive ? getSelectedGroupIds() : []
	const next = ids.includes(groupId) ? ids.filter((id) => id !== groupId) : [...ids, groupId]
	editor.selectedGroupId = next[0] ?? ''
	editor.additionalGroupIds = next.slice(1)
	if (next.includes(groupId)) setActiveGroup(groupId)
}

export const selectAllGroups = (): void => {
	editor.sharedGroupPivot = null
	const ids = getMeta().groups.filter((g) => !checkIsGroupHidden(getMeta().groups, g.id) && !checkIsGroupLocked(getMeta().groups, g.id)).map((g) => g.id)
	editor.selectedGroupId = ids[0] ?? ''
	editor.additionalGroupIds = ids.slice(1)
}

const getTransformFamily = (ids: string[]): string[] => [...new Set(ids.flatMap((id) => getGroupFamilyIds(getMeta().groups, id)))]
export const moveSelectedGroups = (offset: Vec3T): void => moveGroup(getSelectedGroupIds(), offset)
export const rotateSelectedGroups = (axis: AxisT, direction: 1 | -1 = 1): void => rotateGroup(getSelectedGroupIds(), axis, direction)

type MovePlanT = {
	moves: { from: number; to: number; cell: CellT }[]
	isValid: boolean
}

const planFamilyMove = (familyIds: string[], mapPosition: (position: Vec3T) => Vec3T): MovePlanT => {
	const familySet = new Set(familyIds)
	const moves: MovePlanT['moves'] = []

	for (const familyId of familyIds) {
		for (const key of getGroupKeys(familyId)) {
			const cell = getCell(key)
			if (!cell) continue
			const target = mapPosition(fromCellKey(key))
			const isInside = checkIsInsideRoom(target, voxelDoc.roomSize)
			if (!isInside) return { moves, isValid: false }
			const targetCell = getCell(toCellKeyFromVec(target))
			const isBlocked = targetCell !== null && !familySet.has(targetCell.groupId)
			if (isBlocked) return { moves, isValid: false }
			moves.push({ from: key, to: toCellKeyFromVec(target), cell })
		}
	}

	return { moves, isValid: true }
}

const applyFamilyMove = (plan: MovePlanT): void => {
	// Map from the original selection before changing any keys: targets can
	// overlap other selected source cells during a move or rotation.
	const destinations = new Map(plan.moves.map((move) => [move.from, move.to]))
	const nextSelection = [...selection].map((key) => destinations.get(key) ?? key)
	for (const move of plan.moves) setCell(move.from, null)
	for (const move of plan.moves) setCell(move.to, move.cell)
	replaceSelection(nextSelection)
}

const checkCanEditGroup = (groupId: string): boolean => {
	const isLocked = lockedGroupIds.has(groupId)
	if (!isLocked) return true
	showToast('That group is locked', 'danger')
	return false
}

export const moveGroup = (groupId: string | string[], offset: Vec3T): void => {
	const familyIds = getTransformFamily(typeof groupId === 'string' ? [groupId] : groupId)
	if (!familyIds.length || !familyIds.every(checkCanEditGroup)) return

	const plan = planFamilyMove(familyIds, (position) => {
		const target: Vec3T = [position[0] + offset[0], position[1] + offset[1], position[2] + offset[2]]
		return target
	})

	if (!plan.isValid) {
		showToast('Blocked by the room or another group', 'danger')
		return
	}

	runEdit('move group', () => {
		applyFamilyMove(plan)
		if (editor.sharedGroupPivot) editor.sharedGroupPivot = editor.sharedGroupPivot.map((value, a) => value + offset[a]) as Vec3T

		for (const familyId of familyIds) {
			const group = findGroup(getMeta().groups, familyId)
			if (!group) continue
			group.pivot = [group.pivot[0] + offset[0], group.pivot[1] + offset[1], group.pivot[2] + offset[2]]
		}
	}, true)
}

// Quarter turn of a point around a pivot, about one axis.
const rotatePointQuarter = (point: Vec3T, pivot: Vec3T, axis: AxisT, direction: 1 | -1 = 1): Vec3T => {
	const relative: Vec3T = [point[0] - pivot[0], point[1] - pivot[1], point[2] - pivot[2]]
	if (axis === 1) return [pivot[0] + direction * relative[2], pivot[1] + relative[1], pivot[2] - direction * relative[0]]
	if (axis === 0) return [pivot[0] + relative[0], pivot[1] - direction * relative[2], pivot[2] + direction * relative[1]]
	return [pivot[0] - direction * relative[1], pivot[1] + direction * relative[0], pivot[2] + relative[2]]
}

export const rotateGroup = (groupId: string | string[], axis: AxisT, direction: 1 | -1 = 1): void => {
	const ids = typeof groupId === 'string' ? [groupId] : groupId
	const familyIds = getTransformFamily(ids)
	if (!familyIds.length || !familyIds.every(checkCanEditGroup)) return
	const meta = getMeta()
	const rootGroup = findGroup(meta.groups, ids[0])
	if (!rootGroup) return
	let pivot: Vec3T = [...rootGroup.pivot]
	if (ids.length > 1 && editor.sharedGroupPivot) pivot = [...editor.sharedGroupPivot]
	else if (ids.length > 1) {
		const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity]
		for (const id of familyIds) for (const key of getGroupKeys(id)) {
			const p = fromCellKey(key)
			for (let a = 0; a < 3; a++) { min[a] = Math.min(min[a], p[a]); max[a] = Math.max(max[a], p[a]) }
		}
		if (!Number.isFinite(min[0])) return
		// Snap the shared center to voxel corners to preserve the grid on every axis.
		pivot = min.map((value, a) => Math.round((value + max[a] + 1) / 2)) as Vec3T
	}

	const plan = planFamilyMove(familyIds, (position) => {
		const center: Vec3T = [position[0] + 0.5, position[1] + 0.5, position[2] + 0.5]
		const rotatedCenter = rotatePointQuarter(center, pivot, axis, direction)
		const target: Vec3T = [Math.floor(rotatedCenter[0]), Math.floor(rotatedCenter[1]), Math.floor(rotatedCenter[2])]
		return target
	})

	if (!plan.isValid) {
		showToast('No room to rotate there', 'danger')
		return
	}

	runEdit('rotate group', () => {
		applyFamilyMove(plan)
		if (ids.length > 1) editor.sharedGroupPivot = [...pivot]

		for (const familyId of familyIds) {
			const group = findGroup(getMeta().groups, familyId)
			if (!group) continue
			group.pivot = rotatePointQuarter(group.pivot, pivot, axis, direction)
		}
	}, true)
}

export const setGroupPivot = (groupId: string, pivot: Vec3T): void => {
	runEdit('move pivot', () => {
		const group = findGroup(getMeta().groups, groupId)
		if (!group) return
		group.pivot = pivot
		group.hasCustomPivot = true
	})
}

export const nudgeGroupPivot = (groupId: string, offset: Vec3T): void => {
	const group = findGroup(getMeta().groups, groupId)
	if (!group) return
	const nextPivot: Vec3T = [group.pivot[0] + offset[0], group.pivot[1] + offset[1], group.pivot[2] + offset[2]]
	setGroupPivot(groupId, nextPivot)
}

export const resetGroupPivot = (groupId: string): void => {
	runEdit('reset pivot', () => {
		const group = findGroup(getMeta().groups, groupId)
		if (!group) return
		group.hasCustomPivot = false
		const center = computeGroupCenter([groupId])
		if (center) group.pivot = center
	})
}

// ---------- project settings ----------

export const renameOpenProject = (name: string): void => {
	runEdit('rename project', () => {
		getMeta().name = name
	})
}

// Shrinking the room drops voxels outside the new bounds.
export const resizeRoom = (nextSize: Vec3T): void => {
	runEdit('resize room', () => {
		const meta = getMeta()

		for (const key of [...voxelDoc.cells.keys()]) {
			const position = fromCellKey(key)
			const isInside = checkIsInsideRoom(position, nextSize)
			if (!isInside) setCell(key, null)
		}

		meta.roomSize = nextSize
	})

	voxelDoc.roomSize = [...nextSize]
	rebuildAllMeshes()
}

export const countVoxelsOutside = (nextSize: Vec3T): number => {
	let outsideCount = 0

	for (const key of voxelDoc.cells.keys()) {
		const isInside = checkIsInsideRoom(fromCellKey(key), nextSize)
		if (!isInside) outsideCount += 1
	}

	return outsideCount
}
