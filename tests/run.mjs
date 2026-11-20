import { createRequire } from 'node:module'
import { compileModule } from 'svelte/compiler'
import ts from 'typescript'
import { readFile, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

// Use Vite's existing esbuild dependency, including with pnpm's strict layout.
const require = createRequire(import.meta.url)
const { build } = require(require.resolve('esbuild', { paths: [dirname(require.resolve('vite/package.json'))] }))
const directory = await mkdtemp(join(tmpdir(), 'majeka-tests-'))
try {
	const outfile = join(directory, 'projectColors.test.mjs')
	await build({
		entryPoints: ['tests/projectColors.test.ts'], outfile, bundle: true, platform: 'node', format: 'esm',
		conditions: ['browser'],
		plugins: [{
			name: 'svelte-state',
			setup(builder) {
				builder.onLoad({ filter: /\.svelte\.ts$/ }, async ({ path }) => {
					const source = await readFile(path, 'utf8')
					const javascript = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext, verbatimModuleSyntax: true } }).outputText
					return { contents: compileModule(javascript, { filename: path, generate: 'client' }).js.code, loader: 'js' }
				})
			}
		}]
	})
	const result = spawnSync(process.execPath, ['--test', outfile], { stdio: 'inherit' })
	process.exitCode = result.status ?? 1
} finally {
	if (resolve(dirname(directory)) !== resolve(tmpdir()) || !basename(directory).startsWith('majeka-tests-')) {
		throw new Error('Refusing to clean up an unexpected test directory')
	}
	await rm(directory, { recursive: true, force: true })
}
