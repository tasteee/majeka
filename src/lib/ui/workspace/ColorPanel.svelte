<script lang="ts">
	import PlusIcon from 'phosphor-svelte/lib/PlusIcon'
	import SwatchesIcon from 'phosphor-svelte/lib/SwatchesIcon'
	import Panel from '../shared/Panel.svelte'
	import ColorSwatch from './ColorSwatch.svelte'
	import ProjectColorsSection from './ProjectColorsSection.svelte'
	import ReplaceColorDialog from './ReplaceColorDialog.svelte'
	import { addSelectedColorToPalette, editor, loadPresetPalette, removeFromPalette, selectColor } from '../../state/editor.svelte'
	import { PRESET_PALETTES } from '../../model/presetPalettes'
	import type { ProjectMetaT } from '../../model/types'
	import { openOverlay, ui } from '../../state/ui.svelte'
	import './ColorPanel.css'

	type ColorPanelPropsT = {
		meta: ProjectMetaT
	}

	let props: ColorPanelPropsT = $props()

	type SwatchEntryT = {
		colorIndex: number
		color: string
	}

	const toSwatchEntries = (colorIndexes: number[]): SwatchEntryT[] => {
		const entries = colorIndexes.map((colorIndex) => ({ colorIndex, color: props.meta.colors[colorIndex] ?? '' }))
		return entries.filter((entry) => entry.color !== '')
	}

	const paletteEntries = $derived(toSwatchEntries(props.meta.palette))
	const recentEntries = $derived(toSwatchEntries(props.meta.recentColors))
	const hasPalette = $derived(paletteEntries.length > 0)
	const recentInfo = $derived(`The ${recentEntries.length} most recent colors placed or painted in this project (up to 32). Click a color square to choose it. Right-click to replace it with the current color. Select a group first to repaint only that group and its nested groups; otherwise repaint the whole project.`)

	const handlePickerChange = (changeEvent: CustomEvent<{ value: string }>): void => {
		selectColor(changeEvent.detail.value)
	}

	const handlePresetLoad = (event: CustomEvent<{ value: string }>): void => {
		const preset = PRESET_PALETTES.find((entry) => entry.id === event.detail.value)
		if (preset) loadPresetPalette(preset)
	}

	let replacementSource = $state('')
	let replacementTarget = $state('')
	let replacementSession = $state(0)
	const openReplacement = (color: string): void => {
		replacementSource = color
		replacementTarget = editor.selectedColor
		replacementSession += 1
		openOverlay('replaceColor')
	}
</script>

<Panel title="Color">
	<div class="color-current" data-info="Choose the current painting color. Add it to the palette with + Palette, then right-click another color square to replace that color with it.">
		<z-color-picker value={editor.selectedColor} onchange={handlePickerChange}></z-color-picker>
		<z-button size="sm" kind="soft" tone="neutral" onclick={addSelectedColorToPalette} title="Add to palette">
			<PlusIcon size={14} weight="bold" />
			Palette
		</z-button>
	</div>

	<div class="color-group">
		<div class="color-group-header">
			<z-text size="xs" color="muted" data-info="Your working palette. Choose a preset or add the current color with + Palette. Right-click a color square to replace it with the current color or remove it from the palette. Select a group first to repaint only that group and its nested groups; otherwise repaint the whole project.">Palette</z-text>
			<z-menu align="end" onselect={handlePresetLoad} onkeydown={(event: KeyboardEvent) => event.stopPropagation()}>
				<button type="button" slot="trigger" class="color-section-action" aria-label="Palette presets" data-info="Palette presets. Load a working palette without changing existing voxel colors. Use Project’s outside-palette filter to find colors to replace."><SwatchesIcon size={13} /></button>
				{#each PRESET_PALETTES as preset (preset.id)}
					<z-menu-item value={preset.id} label={preset.name}>
						<div class="color-preset-preview" data-info="{preset.name}: {preset.colors.length} colors. Load this working palette without recoloring existing voxels.">
							<z-text size="xs">{preset.name}</z-text>
							<div class="color-preset-strip">
								{#each preset.colors as presetColor (presetColor)}
									<span class="color-preset-chip" style:--swatch-color={presetColor}></span>
								{/each}
							</div>
						</div>
					</z-menu-item>
				{/each}
			</z-menu>
		</div>

		{#if hasPalette}
			<div class="color-swatches">
				{#each paletteEntries as entry (entry.colorIndex)}
					<ColorSwatch color={entry.color} onreplace={openReplacement} onremove={() => removeFromPalette(entry.colorIndex)} />
				{/each}
			</div>
		{/if}
	</div>

	<div class="color-group">
		<z-text size="xs" color="muted" data-info={recentInfo}>Recent</z-text>
		<div class="color-swatches">
			{#each recentEntries as entry (entry.colorIndex)}
				<ColorSwatch color={entry.color} onreplace={openReplacement} />
			{/each}
		</div>
	</div>
	<ProjectColorsSection meta={props.meta} onreplace={openReplacement} />
</Panel>

{#if ui.overlay === 'replaceColor'}
	{#key replacementSession}
		<ReplaceColorDialog meta={props.meta} source={replacementSource} initialTarget={replacementTarget} />
	{/key}
{/if}
