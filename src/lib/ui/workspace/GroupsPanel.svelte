<script lang="ts">
	import EyeIcon from 'phosphor-svelte/lib/EyeIcon'
	import EyeSlashIcon from 'phosphor-svelte/lib/EyeSlashIcon'
	import LockIcon from 'phosphor-svelte/lib/LockIcon'
	import LockOpenIcon from 'phosphor-svelte/lib/LockOpenIcon'
	import PlusIcon from 'phosphor-svelte/lib/PlusIcon'
	import CheckIcon from 'phosphor-svelte/lib/CheckIcon'
	import XIcon from 'phosphor-svelte/lib/XIcon'
	import GroupContextMenu from './GroupContextMenu.svelte'
	import Panel from '../shared/Panel.svelte'
	import { getGroupDepth, getGroupsInTreeOrder } from '../../model/groups'
	import { countGroupVoxels } from '../../model/voxelDoc'
	import { createEmptyGroup, editor, selectGroup, getSelectedGroupIds, clearGroupSelection, selectAllGroups, moveSelectedGroups, rotateSelectedGroups, toggleGroupHidden, toggleGroupLocked } from '../../state/editor.svelte'
	import type { GroupMetaT, ProjectMetaT } from '../../model/types'
	import './GroupsPanel.css'

	type GroupsPanelPropsT = {
		meta: ProjectMetaT
	}

	let props: GroupsPanelPropsT = $props()
	let contextGroupId = $state('')
 const selectedIds = $derived(getSelectedGroupIds())
 const toggleSelection = (groupId: string, additive: boolean): void => {
  if (!additive && selectedIds.length === 1 && selectedIds.includes(groupId)) clearGroupSelection()
  else selectGroup(groupId, additive)
 }
	const openContext = (event: MouseEvent, groupId: string): void => {
		event.preventDefault()
		contextGroupId = groupId
	}

	type GroupRowT = {
		group: GroupMetaT
		depth: number
		voxelCount: number
		rowClass: string
	}

	const getRowClass = (group: GroupMetaT): string => {
		const classes = ['groups-row']
		const isActive = group.id === props.meta.activeGroupId
		if (isActive) classes.push('isActive')
		const isSelected = selectedIds.includes(group.id)
		if (isSelected) classes.push('isSelected')
		if (group.isHidden) classes.push('isHidden')
		return classes.join(' ')
	}

	// docVersion only makes the rows re-run after edits.
	const countVoxelsAtVersion = (groupId: string, docVersion: number): number => {
		const isUnloaded = docVersion < 0
		if (isUnloaded) return 0
		return countGroupVoxels(groupId)
	}

	const rows = $derived.by(() => {
		const orderedGroups = getGroupsInTreeOrder(props.meta.groups)

		return orderedGroups.map((group) => {
			const row: GroupRowT = {
				group,
				depth: getGroupDepth(props.meta.groups, group.id),
				voxelCount: countVoxelsAtVersion(group.id, editor.docVersion),
				rowClass: getRowClass(group)
			}
			return row
		})
	})

	const addGroup = (): void => {
		const groupNumber = props.meta.groups.length + 1
		createEmptyGroup(`Group ${groupNumber}`)
	}
</script>

<Panel title="Groups">
	{#snippet actions()}
		{#if editor.selectedGroupId}
			<z-button size="sm" kind="ghost" aria-label="Deselect group" data-info="Clear the selected group. Color replacement will apply to the whole project." onclick={clearGroupSelection}>
				<XIcon size={14} />
			</z-button>
		{/if}
		<z-button size="sm" kind="ghost" tone="neutral" onclick={addGroup} aria-label="New group" title="New group">
			<PlusIcon size={14} weight="bold" />
		</z-button>
	{/snippet}

	<div class="group-transforms">
 <button type="button" onclick={selectAllGroups}>Select all groups</button>
 {#if selectedIds.length}
  <span>{selectedIds.length} selected · Shift-click to select more</span>
  <fieldset><legend>Move one block · Y is up</legend>
   {#each [0, 1, 2] as axis}{#each [-1, 1] as direction}
    <button type="button" aria-label={'Move ' + ['X', 'Y', 'Z'][axis] + (direction > 0 ? ' positive' : ' negative')} onclick={() => moveSelectedGroups([axis === 0 ? direction : 0, axis === 1 ? direction : 0, axis === 2 ? direction : 0])}>{['X', 'Y', 'Z'][axis]}{direction > 0 ? '+' : '−'}</button>
   {/each}{/each}
  </fieldset>
  <fieldset><legend>Rotate 90°{selectedIds.length > 1 ? ' around shared center' : ' around pivot'}</legend>
   {#each [0, 1, 2] as axis}<button type="button" onclick={() => rotateSelectedGroups(axis as 0 | 1 | 2)}>Rotate {['X', 'Y', 'Z'][axis]}</button>{/each}
  </fieldset>
  <small>Arrows: floor · Shift+↑/↓: height (Y) · Ctrl+←/→: rotate Y · Ctrl+↑/↓: rotate X · Alt+←/→: rotate Z</small>
 {/if}
 </div>
 <div class="groups-list">
		{#each rows as row (row.group.id)}
			<div class={row.rowClass} style:--group-depth={row.depth}>
				<button type="button" class="groups-name" aria-pressed={selectedIds.includes(row.group.id)} onclick={(event) => toggleSelection(row.group.id, event.shiftKey)} oncontextmenu={(event) => openContext(event, row.group.id)} data-info="{row.group.name}: {row.voxelCount.toLocaleString()} blocks. Click to select; Shift-click to add or remove groups. Right-click to rename and manage the group.">
					{#if selectedIds.includes(row.group.id)}<CheckIcon size={12} weight="bold" />{:else}<span class="groups-dot"></span>{/if}
					<span class="groups-label">{row.group.name}</span>
					<span class="groups-count">{row.voxelCount}</span>
				</button>
				<button type="button" class="groups-toggle" onclick={() => toggleGroupHidden(row.group.id)} aria-label="Toggle visibility" title="Hide / show">
					{#if row.group.isHidden}
						<EyeSlashIcon size={14} weight="bold" />
					{:else}
						<EyeIcon size={14} weight="bold" />
					{/if}
				</button>
				<button type="button" class="groups-toggle" onclick={() => toggleGroupLocked(row.group.id)} aria-label="Toggle lock" title="Lock / unlock">
					{#if row.group.isLocked}
						<LockIcon size={14} weight="bold" />
					{:else}
						<LockOpenIcon size={14} weight="bold" />
					{/if}
				</button>
				<GroupContextMenu group={row.group} isOpen={contextGroupId === row.group.id} onclose={() => { if (contextGroupId === row.group.id) contextGroupId = '' }} />
			</div>
		{/each}
	</div>
</Panel>
