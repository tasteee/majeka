<script lang="ts">
	import { untrack } from 'svelte'
	import ArrowRightIcon from 'phosphor-svelte/lib/ArrowRightIcon'
	import { findGroup } from '../../model/groups'
	import { editor, previewColorReplacement, replaceProjectColor } from '../../state/editor.svelte'
	import { buildCloseHandler, closeOverlay, ui } from '../../state/ui.svelte'
	import type { ProjectMetaT } from '../../model/types'
	import '../shared/Dialog.css'
	import './ReplaceColorDialog.css'

	let props: { meta: ProjectMetaT; source: string; initialTarget: string } = $props()
	// Freeze the selected group for this confirmation; the active build group
	// is not a selection and must not silently limit project-wide replacement.
	const groupId = untrack(() => editor.selectedGroupId || null)
	const group = $derived(findGroup(props.meta.groups, groupId))
	const plan = $derived(previewColorReplacement(props.source, props.initialTarget, groupId, editor.docVersion))
	const isOpen = $derived(ui.overlay === 'replaceColor')
	const description = $derived(`${plan.keys.length.toLocaleString()} blocks will be repainted${group ? ` in “${group.name}” and its nested groups` : ' in this project'}. Are you sure? You can undo this.`)
	const handleClose = buildCloseHandler('replaceColor')
	const repaint = (): void => {
		if (plan.keys.length === 0) return
		replaceProjectColor(props.source, props.initialTarget, groupId)
		closeOverlay()
	}
</script>

<z-dialog {isOpen} heading="Replace color?" {description} class="app-dialog isSmall" onclose={handleClose}>
	<div class="replace-color-preview">
		<div class="replace-color-sample">
			<span class="replace-color-chip" role="img" aria-label="Before: {props.source}" style:--swatch-color={props.source}></span>
			<z-text size="xs" color="muted">{props.source.toUpperCase()}</z-text>
		</div>
		<ArrowRightIcon size={20} />
		<div class="replace-color-sample">
			<span class="replace-color-chip" role="img" aria-label="After: {props.initialTarget}" style:--swatch-color={props.initialTarget}></span>
			<z-text size="xs" color="muted">{props.initialTarget.toUpperCase()}</z-text>
		</div>
	</div>
	{#if plan.skippedLocked > 0}
		<z-text size="xs" color="muted">{plan.skippedLocked.toLocaleString()} locked blocks will be skipped.</z-text>
	{/if}
	<div slot="footer" class="replace-color-footer">
		<z-button size="sm" kind="ghost" onclick={closeOverlay}>Cancel</z-button>
		<z-button size="sm" kind="solid" isDisabled={plan.keys.length === 0} onclick={repaint}>Repaint</z-button>
	</div>
</z-dialog>
