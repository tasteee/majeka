<script lang="ts">
	import CheckCircleIcon from 'phosphor-svelte/lib/CheckCircleIcon'
	import ArrowsOutCardinalIcon from 'phosphor-svelte/lib/ArrowsOutCardinalIcon'
	import EyeIcon from 'phosphor-svelte/lib/EyeIcon'
	import EyeSlashIcon from 'phosphor-svelte/lib/EyeSlashIcon'
	import LockIcon from 'phosphor-svelte/lib/LockIcon'
	import LockOpenIcon from 'phosphor-svelte/lib/LockOpenIcon'
	import CrosshairIcon from 'phosphor-svelte/lib/CrosshairIcon'
	import TreeStructureIcon from 'phosphor-svelte/lib/TreeStructureIcon'
	import TrashIcon from 'phosphor-svelte/lib/TrashIcon'
	import PlusIcon from 'phosphor-svelte/lib/PlusIcon'
	import MenuItem from '../shared/MenuItem.svelte'
	import { setAction } from '../../state/controls'
	import { deleteGroup, editor, getSelectedGroupIds, renameGroup, resetGroupPivot, selectGroup, setActiveGroup, toggleGroupHidden, toggleGroupLocked, unnestGroup } from '../../state/editor.svelte'
	import type { GroupMetaT } from '../../model/types'
	import '../shared/MenuItem.css'
	import './GroupContextMenu.css'

	let props: { group: GroupMetaT; isOpen: boolean; onclose: () => void } = $props()
	let name = $state('')
	const isSelected = $derived(getSelectedGroupIds().includes(props.group.id))
	$effect(() => {
		if (props.isOpen) name = props.group.name
	})
	const saveName = (): void => {
		const trimmed = name.trim()
		if (trimmed && trimmed !== props.group.name) renameGroup(props.group.id, trimmed)
		else if (!trimmed) name = props.group.name
	}
	const run = (action: () => void): void => {
		saveName()
		action()
		props.onclose()
	}
	const toggleSelection = (): void => run(() => {
		selectGroup(props.group.id, isSelected)
	})
	const move = (): void => run(() => {
		setAction('object')
		selectGroup(props.group.id)
	})
	const pivot = (): void => run(() => {
		selectGroup(props.group.id)
		setAction('pivot')
	})
	const handleKeys = (event: KeyboardEvent): void => {
		event.stopPropagation()
		if (event.key === 'Escape') {
			event.preventDefault()
			name = props.group.name
			props.onclose()
		}
	}
</script>

<z-popover class="group-context" label="Group options" placement="bottom-end" isOpen={props.isOpen} onkeydown={handleKeys} ontoggle={(event: CustomEvent<{ open: boolean }>) => { if (!event.detail.open && props.isOpen) { saveName(); props.onclose() } }}>
	<div class="group-context-content">
		<div class="group-context-name">
			<z-input size="sm" value={name} label="Group name" aria-label="Group name" data-info="Rename this group. Press Enter to save, or Escape to cancel." oninput={(event: CustomEvent<{ value: string }>) => { name = event.detail.value }} onchange={() => { if (props.isOpen) saveName() }} onkeydown={(event: KeyboardEvent) => { if (event.key === 'Enter' && !event.isComposing) { event.preventDefault(); run(() => {}) } }}></z-input>
		</div>
		<div class="menu-list">
			<MenuItem label={isSelected ? 'Deselect group' : 'Select group'} icon={CheckCircleIcon} onselect={toggleSelection} />
			<MenuItem label="Build into this group" icon={PlusIcon} onselect={() => run(() => setActiveGroup(props.group.id))} />
			<MenuItem label="Move group" icon={ArrowsOutCardinalIcon} onselect={move} />
			<div class="menu-separator"></div>
			<MenuItem label={props.group.isHidden ? 'Show group' : 'Hide group'} icon={props.group.isHidden ? EyeIcon : EyeSlashIcon} onselect={() => run(() => toggleGroupHidden(props.group.id))} />
			<MenuItem label={props.group.isLocked ? 'Unlock group' : 'Lock group'} icon={props.group.isLocked ? LockOpenIcon : LockIcon} onselect={() => run(() => toggleGroupLocked(props.group.id))} />
			<div class="menu-separator"></div>
			<MenuItem label="Move pivot" icon={CrosshairIcon} onselect={pivot} />
			<MenuItem label="Reset pivot to center" icon={CrosshairIcon} onselect={() => run(() => resetGroupPivot(props.group.id))} />
			{#if props.group.parentId !== null}
				<MenuItem label="Move out of parent" icon={TreeStructureIcon} onselect={() => run(() => unnestGroup(props.group.id))} />
			{/if}
			<div class="menu-separator"></div>
			<MenuItem label="Delete group" icon={TrashIcon} isDanger onselect={() => run(() => deleteGroup(props.group.id))} />
		</div>
	</div>
</z-popover>
