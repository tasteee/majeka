<script lang="ts">
	import { T, useTask } from '@threlte/core'
	import type { Group } from 'three'
	import CellBoxes from './CellBoxes.svelte'
	import { fromCellKey } from '../../model/cellKey'
	import { selection } from '../../state/editor.svelte'
	import { applyRotationAnimation } from '../../state/rotationAnimation'
	import { readTokenColor } from '../tokenColor'

	const selectionColor = readTokenColor('--accent')
	const selectedCells = $derived([...selection].map(fromCellKey))

	let animatedGroup = $state.raw<Group>()

	useTask(() => {
		if (!animatedGroup) return
		applyRotationAnimation(animatedGroup, null)
	})
</script>

<T.Group bind:ref={animatedGroup}>
	<CellBoxes cells={selectedCells} color={selectionColor} opacity={0.35} scale={1.06} renderOrder={12} />
</T.Group>
