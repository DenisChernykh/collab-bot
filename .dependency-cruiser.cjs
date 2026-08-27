/* global module */
/** @type {import("dependency-cruiser").IConfiguration} */
const FEATURE_MODULES = ["profiles", "collaborations", "marketplace", "applications", "moderation"];

const crossModuleInternalRules = FEATURE_MODULES.map((moduleName) => ({
	name: `module-internals-must-not-cross-feature-boundaries-${moduleName}`,
	severity: "error",
	from: { path: `(^|/)src/modules/${moduleName}(/|$)` },
	to: {
		path: `(^|/)src/modules/(?:${FEATURE_MODULES.filter((candidate) => candidate !== moduleName).join("|")})/(?!index\\.ts$|application/index\\.ts$).+`,
	},
}));

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
		...crossModuleInternalRules,
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
				path: "(^|/)(node_modules/)?grammy(/|$)|^node:sqlite$",
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
				path: "(^|/)(node_modules/)?grammy(/|$)|^node:sqlite$",
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
