<script lang="ts">
	import Swatch from '../shared/Swatch.svelte'
	import { editor, selectColor } from '../../state/editor.svelte'
	import { normalizeColor } from '../../model/projectColors'
	import './ColorSwatch.css'

	let props: {
		color: string
		onreplace: (color: string) => void
		onremove?: () => void
		label?: string
	} = $props()
	let trigger: HTMLElement | undefined
	const isCurrentColor = $derived(normalizeColor(props.color) === normalizeColor(editor.selectedColor))
	const info = $derived(`${props.label ?? props.color.toUpperCase()}. Click to choose this color. Right-click to replace it with the current color${props.onremove ? ', or remove it from the palette' : ''}. Select a group first to repaint only that group and its nested groups; otherwise repaint the whole project.`)
	const openMenu = (): void => trigger?.click()
	const handleAction = (event: CustomEvent<{ value: string }>): void => {
		if (event.detail.value === 'replace' && !isCurrentColor) props.onreplace(props.color)
		if (event.detail.value === 'remove') props.onremove?.()
	}
</script>

<div class="color-swatch-control" data-info={info}>
	<Swatch color={props.color} label={props.label} showTooltip={false} isSelected={isCurrentColor} onselect={() => selectColor(props.color)} oncontext={openMenu} />
	<z-menu onselect={handleAction} onkeydown={(event: KeyboardEvent) => event.stopPropagation()}>
		<z-button bind:this={trigger} slot="trigger" class="color-menu-hidden" aria-label="Actions for {props.color}"></z-button>
		<z-menu-item value="replace" isDisabled={isCurrentColor}>Replace with current color…</z-menu-item>
		{#if props.onremove}
			<z-menu-separator></z-menu-separator>
			<z-menu-item value="remove">Remove from palette</z-menu-item>
		{/if}
	</z-menu>
</div>
