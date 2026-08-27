/* global module */
/** @type {import("dependency-cruiser").IConfiguration} */
module.exports = {
	forbidden: [
		{
			name: "no-unresolvable-imports",
			severity: "error",
			from: {},
			to: { couldNotResolve: true },
		},
		{
			name: "no-circular-dependencies",
			severity: "error",
			from: {},
			to: { circular: true },
		},
		{
			name: "domain-must-not-import-outer-layers",
			severity: "error",
			from: { path: "(^|/)src/(domain|modules/[^/]+/domain)(/|$)" },
			to: {
				path: "(^|/)src/(application|infrastructure|bot|presentation|runtime|config|cli|modules/[^/]+/(application|infrastructure|presentation|composition))(/|$)",
			},
		},
		{
			name: "domain-must-not-import-runtime-libraries",
			severity: "error",
			from: { path: "(^|/)src/(domain|modules/[^/]+/domain)(/|$)" },
			to: {
				path: "(^|/)(node_modules/)?(drizzle-orm|grammy)(/|$)|^node:sqlite$",
			},
		},
		{
			name: "application-must-not-import-outer-layers",
			severity: "error",
			from: { path: "(^|/)src/(application|modules/[^/]+/application)(/|$)" },
			to: {
				path: "(^|/)src/(infrastructure|bot|presentation|runtime|config|cli|modules/[^/]+/(infrastructure|presentation|composition))(/|$)",
			},
		},
		{
			name: "application-must-not-import-runtime-libraries",
			severity: "error",
			from: { path: "(^|/)src/(application|modules/[^/]+/application)(/|$)" },
			to: {
				path: "(^|/)(node_modules/)?(drizzle-orm|grammy)(/|$)|^node:sqlite$",
			},
		},
		{
			name: "presentation-must-not-import-infrastructure",
			severity: "error",
			from: { path: "(^|/)src/(bot|presentation|modules/[^/]+/presentation)(/|$)" },
			to: { path: "(^|/)src/(infrastructure|modules/[^/]+/infrastructure)(/|$)" },
		},
		{
			name: "infrastructure-must-not-import-presentation",
			severity: "error",
			from: { path: "(^|/)src/(infrastructure|modules/[^/]+/infrastructure)(/|$)" },
			to: { path: "(^|/)src/(bot|presentation|modules/[^/]+/presentation)(/|$)" },
		},
		{
			name: "feature-modules-must-not-import-runtime-or-cli",
			severity: "error",
			from: { path: "(^|/)src/modules(/|$)" },
			to: { path: "(^|/)src/(runtime|cli)(/|$)" },
		},
		{
			name: "source-must-not-import-tests",
			severity: "error",
			from: { path: "^src/" },
			to: { path: "^test/" },
		},
	],
	options: {
		doNotFollow: { path: "node_modules" },
		enhancedResolveOptions: {
			conditionNames: ["node", "import", "types", "default"],
			exportsFields: ["exports"],
		},
		tsPreCompilationDeps: true,
		tsConfig: { fileName: "tsconfig.json" },
	},
};
