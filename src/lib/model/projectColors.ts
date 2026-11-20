import { checkIsGroupLocked, getGroupFamilyIds } from './groups'
import type { CellT, ProjectMetaT } from './types'

export type UsedColorT = { color: string; count: number; isInPalette: boolean }
export type ColorReplacementT = { keys: number[]; skippedLocked: number }

export const normalizeColor = (color: string): string => color.trim().toLowerCase()

// Older recoloring could leave several indexes pointing at the same color.
// Present and replace those as one color, independent of palette membership.
export const getUsedProjectColors = (meta: ProjectMetaT, cells: ReadonlyMap<number, CellT>): UsedColorT[] => {
	const palette = new Set(meta.palette.map((index) => normalizeColor(meta.colors[index] ?? '')))
	const usage = new Map<string, UsedColorT>()
	for (const cell of cells.values()) {
		const color = normalizeColor(meta.colors[cell.colorIndex] ?? '')
		if (!color) continue
		const entry = usage.get(color) ?? { color, count: 0, isInPalette: palette.has(color) }
		entry.count += 1
		usage.set(color, entry)
	}
	return [...usage.values()].sort((left, right) => right.count - left.count || left.color.localeCompare(right.color))
}

export const planColorReplacement = (
	meta: ProjectMetaT,
	cells: ReadonlyMap<number, CellT>,
	source: string,
	target: string,
	groupId: string | null = null
): ColorReplacementT => {
	const result: ColorReplacementT = { keys: [], skippedLocked: 0 }
	const sourceColor = normalizeColor(source)
	if (!sourceColor || sourceColor === normalizeColor(target)) return result
	if (groupId !== null && !meta.groups.some((group) => group.id === groupId)) return result
	const scope = groupId === null ? null : new Set(getGroupFamilyIds(meta.groups, groupId))
	const locked = new Set(meta.groups.filter((group) => checkIsGroupLocked(meta.groups, group.id)).map((group) => group.id))
	for (const [key, cell] of cells) {
		if (scope !== null && !scope.has(cell.groupId)) continue
		if (normalizeColor(meta.colors[cell.colorIndex] ?? '') !== sourceColor) continue
		if (locked.has(cell.groupId)) result.skippedLocked += 1
		else result.keys.push(key)
	}
	return result
}
