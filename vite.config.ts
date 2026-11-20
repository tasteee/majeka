import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import { resolve } from 'node:path'

// voxel: first-person voxel editor. Svelte 5 + Threlte,
// with the compiled @tasteee/zest web components for all UI.
//
// VITE_BASE_PATH is the public base path of the deployed
// site (e.g. /majeka/ on GitHub Pages). Defaults to /.
const getSiteBase = (): string => {
	const siteBase = process.env.VITE_BASE_PATH ?? '/'
	const hasTrailingSlash = siteBase.endsWith('/')
	if (hasTrailingSlash) return siteBase
	return `${siteBase}/`
}

export default defineConfig((environment) => {
	const isBuild = environment.command === 'build'
	const base = isBuild ? getSiteBase() : '/'

	return {
		base,
		root: resolve(__dirname),
		plugins: [svelte()],
		server: {
			port: 5178,
			host: true,
			fs: { allow: [resolve(__dirname, '../..')] }
		},
		resolve: {
			dedupe: ['three']
		},
		build: {
			outDir: resolve(__dirname, 'dist'),
			emptyOutDir: true,
			chunkSizeWarningLimit: 2500
		}
	}
})
