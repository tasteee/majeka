<script lang="ts">
	import CaretRightIcon from 'phosphor-svelte/lib/CaretRightIcon'
	import CaretDownIcon from 'phosphor-svelte/lib/CaretDownIcon'
	import FunnelIcon from 'phosphor-svelte/lib/FunnelIcon'
	import ColorSwatch from './ColorSwatch.svelte'
	import { editor, listProjectColors } from '../../state/editor.svelte'
	import type { ProjectMetaT } from '../../model/types'
	import './ProjectColorsSection.css'

	let props: { meta: ProjectMetaT; onreplace: (color: string) => void } = $props()
	let outsideOnly = $state(false)
	const usedColors = $derived.by(() => {
		void props.meta
		return listProjectColors(editor.docVersion)
	})
	const outsideCount = $derived(usedColors.filter((entry) => !entry.isInPalette).length)
	const visibleColors = $derived(outsideOnly ? usedColors.filter((entry) => !entry.isInPalette) : usedColors)
	const info = $derived(`All ${usedColors.length} colors used in this project. Filter to see only the ${outsideCount} colors outside the palette. Right-click a color square to replace it with the current color. Select a group first to repaint only that group and its nested groups; otherwise repaint the whole project.`)
	const toggleFilter = (): void => {
		outsideOnly = !outsideOnly
		editor.isProjectColorsOpen = true
	}
</script>

<div class="color-group">
	<div class="color-group-header">
		<button type="button" class="project-color-toggle" aria-expanded={editor.isProjectColorsOpen} aria-controls="project-color-swatches" data-info={info} onclick={() => { editor.isProjectColorsOpen = !editor.isProjectColorsOpen }}>
			<z-text size="xs" color="muted">Project</z-text>
			{#if editor.isProjectColorsOpen}<CaretDownIcon size={10} />{:else}<CaretRightIcon size={10} />{/if}
		</button>
		<button type="button" class="color-section-action" aria-pressed={outsideOnly} aria-label="Outside palette only" data-info="Show only project colors outside the palette. Right-click a color square to replace it with a palette color you have chosen." onclick={toggleFilter}>
			<FunnelIcon size={13} weight={outsideOnly ? 'fill' : 'regular'} />
		</button>
	</div>
	{#if editor.isProjectColorsOpen}
		<div id="project-color-swatches" class="color-swatches project-color-swatches" data-info={info}>
			{#each visibleColors as entry (entry.color)}
				<ColorSwatch color={entry.color} onreplace={props.onreplace} label="{entry.color.toUpperCase()} · {entry.count.toLocaleString()} voxels · {entry.isInPalette ? 'In palette' : 'Outside palette'}" />
			{/each}
		</div>
	{/if}
</div>
