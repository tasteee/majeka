<script lang="ts">
	import { onMount, tick } from 'svelte'
	import { editor } from '../../state/editor.svelte'
	import { getToolHint } from '../../state/tools'
	import { ui } from '../../state/ui.svelte'
	import './HoverInfo.css'

	let hoveredInfo = $state('')
	let hoveredWarning = $state('')
	const warning = $derived(!ui.isPointerLocked && hoveredInfo ? hoveredWarning : '')
	let viewport = $state<HTMLDivElement>()
	let text = $state<HTMLDivElement>()
	let overflow = $state(0)
	const message = $derived(!ui.isPointerLocked && hoveredInfo ? hoveredInfo : getToolHint(editor.action, editor.shape))
	const measure = (): void => {
		overflow = viewport && text ? Math.max(0, text.scrollWidth - viewport.clientWidth) : 0
	}
	const showInfo = (event: Event): void => {
		const elements = event.composedPath().filter((target): target is HTMLElement => target instanceof HTMLElement)
		if (elements.some((element) => element.classList.contains('hover-info'))) return
		hoveredWarning = elements.find((element) => element.dataset.info)?.dataset.infoWarning ?? ''
		// Prefer authored guidance over short native labels, including through
		// custom-element shadow roots. Existing titled controls work too.
		hoveredInfo = elements.find((element) => element.dataset.info)?.dataset.info
			?? elements.map((element) => element.getAttribute('title') || element.getAttribute('aria-label')).find(Boolean)
			?? ''
	}
	const clearInfo = (): void => { hoveredInfo = '' }
	$effect(() => {
		void message
		void warning
		void tick().then(measure)
	})
	onMount(() => {
		const observer = new ResizeObserver(measure)
		if (viewport) observer.observe(viewport)
		document.addEventListener('pointerover', showInfo)
		document.addEventListener('focusin', showInfo)
		document.addEventListener('pointerleave', clearInfo)
		document.addEventListener('pointerlockchange', clearInfo)
		window.addEventListener('blur', clearInfo)
		void document.fonts.ready.then(measure)
		return () => {
			observer.disconnect()
			document.removeEventListener('pointerover', showInfo)
			document.removeEventListener('focusin', showInfo)
			document.removeEventListener('pointerleave', clearInfo)
			document.removeEventListener('pointerlockchange', clearInfo)
			window.removeEventListener('blur', clearInfo)
		}
	})
</script>

<aside class="hover-info" aria-label="Context help">
	<div class="hover-info-viewport" bind:this={viewport} style:--info-travel="{-overflow}px" style:--info-duration="{overflow / 32 + 6}s">
		{#key message + warning}
			<div bind:this={text} class="hover-info-text" class:isScrolling={overflow > 0}>
				<z-text size="xs" class="hover-info-copy" color="muted">{#if warning}<strong class="hover-info-warning">{warning}</strong> {/if}{message}</z-text>
			</div>
		{/key}
	</div>
</aside>
