import { Quaternion, Vector3 } from 'three'
import type { Object3D } from 'three'
import type { AxisT, Vec3T } from '../model/types'

// The voxel data rotates instantly. This module only drives the
// visuals: meshes start at the inverse angle and ease to zero, so
// the user can see which way the selection just turned.

const ROTATION_DURATION_MS = 260
const QUARTER_TURN = Math.PI / 2

// Matches CSS cubic-bezier(0.22, 1, 0.36, 1): fast start, soft landing.
const BEZIER_X1 = 0.22
const BEZIER_Y1 = 1
const BEZIER_X2 = 0.36
const BEZIER_Y2 = 1

type RotationAnimationT = {
	isActive: boolean
	groupIds: Set<string>
	pivot: Vec3T
	axis: AxisT
	startAngle: number
	startTimeMs: number
}

const animation: RotationAnimationT = {
	isActive: false,
	groupIds: new Set(),
	pivot: [0, 0, 0],
	axis: 1,
	startAngle: 0,
	startTimeMs: 0
}

const axisVectors: Vec3T[] = [
	[1, 0, 0],
	[0, 1, 0],
	[0, 0, 1]
]

const scratchAxis = new Vector3()
const scratchPivot = new Vector3()
const scratchOffset = new Vector3()
const scratchQuaternion = new Quaternion()

const sampleBezier = (t: number, first: number, second: number): number => {
	const inverse = 1 - t
	const firstTerm = 3 * inverse * inverse * t * first
	const secondTerm = 3 * inverse * t * t * second
	const lastTerm = t * t * t
	return firstTerm + secondTerm + lastTerm
}

const solveBezierProgress = (timeFraction: number): number => {
	let low = 0
	let high = 1
	for (const attempt of Array.from({ length: 20 })) {
		const middle = (low + high) / 2
		const x = sampleBezier(middle, BEZIER_X1, BEZIER_X2)
		const isBeforeTarget = x < timeFraction
		if (isBeforeTarget) low = middle
		if (!isBeforeTarget) high = middle
	}
	const solvedT = (low + high) / 2
	return sampleBezier(solvedT, BEZIER_Y1, BEZIER_Y2)
}

export const startRotationAnimation = (groupIds: string[], pivot: Vec3T, axis: AxisT, direction: 1 | -1): void => {
	animation.isActive = true
	animation.groupIds = new Set(groupIds)
	animation.pivot = [...pivot]
	animation.axis = axis
	animation.startAngle = -direction * QUARTER_TURN
	animation.startTimeMs = performance.now()
}

const resetTransform = (target: Object3D): void => {
	target.position.set(0, 0, 0)
	target.quaternion.identity()
}

// Call every frame. Pass null for objects that always follow the
// animation (like the selection overlay).
export const applyRotationAnimation = (target: Object3D, groupId: string | null): void => {
	const isAnimatingThisTarget = animation.isActive && (groupId === null || animation.groupIds.has(groupId))
	if (!isAnimatingThisTarget) return resetTransform(target)

	const elapsedMs = performance.now() - animation.startTimeMs
	const timeFraction = Math.min(1, elapsedMs / ROTATION_DURATION_MS)
	const isFinished = timeFraction >= 1
	if (isFinished) animation.isActive = false
	if (isFinished) return resetTransform(target)

	const easedProgress = solveBezierProgress(timeFraction)
	const currentAngle = animation.startAngle * (1 - easedProgress)
	const axisVector = axisVectors[animation.axis]

	scratchAxis.set(axisVector[0], axisVector[1], axisVector[2])
	scratchPivot.set(animation.pivot[0], animation.pivot[1], animation.pivot[2])
	scratchQuaternion.setFromAxisAngle(scratchAxis, currentAngle)

	// Rotate about the pivot: position = pivot - rotation * pivot.
	scratchOffset.copy(scratchPivot).applyQuaternion(scratchQuaternion)
	target.quaternion.copy(scratchQuaternion)
	target.position.copy(scratchPivot).sub(scratchOffset)
}
