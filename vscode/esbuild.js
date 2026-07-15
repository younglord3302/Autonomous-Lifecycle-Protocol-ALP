const esbuild = require("esbuild");

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

/**
 * @type {import('esbuild').Plugin}
 */
const esbuildProblemMatcherPlugin = {
	name: 'esbuild-problem-matcher',
	setup(build) {
		build.onStart(() => {
			console.log('[watch] build started');
		});
		build.onEnd((result) => {
			result.errors.forEach(({ text, location }) => {
				console.error(`✘ [ERROR] ${text}`);
				console.error(`    ${location.file}:${location.line}:${location.column}:`);
			});
			console.log('[watch] build finished');
		});
	},
};

const common = {
	bundle: true,
	minify: production,
	sourcemap: !production,
	external: ['vscode'],
	format: 'cjs',
	plugins: [esbuildProblemMatcherPlugin]
};

async function main() {
	const clientCtx = await esbuild.context({
		...common,
		entryPoints: ['src/extension.ts'],
		outfile: 'dist/extension.js',
		platform: 'node'
	});

	const serverCtx = await esbuild.context({
		...common,
		entryPoints: ['server/src/server.ts'],
		outfile: 'server/dist/server.js',
		platform: 'node'
	});

	if (watch) {
		await clientCtx.watch();
		await serverCtx.watch();
	} else {
		await clientCtx.rebuild();
		await serverCtx.rebuild();
		await clientCtx.dispose();
		await serverCtx.dispose();
	}
}

main().catch(e => {
	console.error(e);
	process.exit(1);
});
