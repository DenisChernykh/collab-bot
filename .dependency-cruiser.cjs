/* global module */
/** @type {import("dependency-cruiser").IConfiguration} */
const FEATURE_MODULES = ["profiles", "collaborations", "marketplace", "applications", "moderation", "connections"];

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
			name: "no-legacy-top-level-layer-imports",
			severity: "error",
			from: { path: "(^|/)src/" },
			to: { path: "(^|/)src/(application|domain|infrastructure|presentation)(/|$)" },
		},
		{
			name: "shared-domain-must-point-only-inward",
			severity: "error",
			from: { path: "(^|/)src/shared/domain(/|$)" },
			to: { path: "(^|/)src/(shared/application|modules|platform|runtime|config|cli)(/|$)" },
		},
		{
			name: "feature-domain-must-not-import-outer-layers",
			severity: "error",
			from: { path: "(^|/)src/modules/[^/]+/domain(/|$)" },
			to: {
				path: "(^|/)src/(shared/application|platform|runtime|config|cli|modules/[^/]+/(application|infrastructure|presentation|composition))(/|$)",
			},
		},
		{
			name: "domain-must-not-import-runtime-libraries",
			severity: "error",
			from: { path: "(^|/)src/(shared/domain|modules/[^/]+/domain)(/|$)" },
			to: { path: "(^|/)(node_modules/)?grammy(/|$)|^node:sqlite$" },
		},
		{
			name: "shared-application-must-not-import-outer-layers",
			severity: "error",
			from: { path: "(^|/)src/shared/application(/|$)" },
			to: { path: "(^|/)src/(modules|platform|runtime|config|cli)(/|$)" },
		},
		{
			name: "feature-application-must-not-import-outer-layers",
			severity: "error",
			from: { path: "(^|/)src/modules/[^/]+/application(/|$)" },
			to: {
				path: "(^|/)src/(platform|runtime|config|cli|modules/[^/]+/(infrastructure|presentation|composition))(/|$)",
			},
		},
		{
			name: "application-must-not-import-runtime-libraries",
			severity: "error",
			from: { path: "(^|/)src/(shared/application|modules/[^/]+/application)(/|$)" },
			to: { path: "(^|/)(node_modules/)?grammy(/|$)|^node:sqlite$" },
		},
		{
			name: "platform-must-not-import-business-or-runtime",
			severity: "error",
			from: { path: "(^|/)src/platform(/|$)" },
			to: { path: "(^|/)src/(modules|runtime|config|cli)(/|$)" },
		},
		{
			name: "feature-presentation-must-not-import-implementation-adapters",
			severity: "error",
			from: { path: "(^|/)src/modules/[^/]+/presentation(/|$)" },
			to: { path: "(^|/)src/(platform|modules/[^/]+/infrastructure)(/|$)" },
		},
		{
			name: "feature-infrastructure-must-not-import-presentation-or-composition",
			severity: "error",
			from: { path: "(^|/)src/modules/[^/]+/infrastructure(/|$)" },
			to: { path: "(^|/)src/modules/[^/]+/(presentation|composition)(/|$)" },
		},
		{
			name: "feature-modules-must-not-import-runtime-or-cli",
			severity: "error",
			from: { path: "(^|/)src/modules(/|$)" },
			to: { path: "(^|/)src/(runtime|cli)(/|$)" },
		},
		{
			name: "runtime-must-compose-features-through-public-entrypoints",
			severity: "error",
			from: { path: "(^|/)src/runtime(/|$)" },
			to: { path: "(^|/)src/modules/[^/]+/(?!index\\.ts$|application/index\\.ts$).+" },
		},
		{
			name: "config-must-not-import-runtime-or-adapters",
			severity: "error",
			from: { path: "(^|/)src/config(/|$)" },
			to: { path: "(^|/)src/(modules|shared/application|platform|runtime|cli)(/|$)" },
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
