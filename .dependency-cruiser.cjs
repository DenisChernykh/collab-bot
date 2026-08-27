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
			name: "no-legacy-profile-feature-imports",
			severity: "error",
			from: { path: "(^|/)src/" },
			to: {
				path: "(^|/)src/(domain/profiles/|application/(profiles/|ports/profile-(repository|session-repository)\\.ts$)|infrastructure/(database/profile-(repository|session-repository)\\.ts$|telegram/grammy-telegram-audience-reader\\.ts$))",
			},
		},
		{
			name: "no-legacy-collaboration-feature-imports",
			severity: "error",
			from: { path: "(^|/)src/" },
			to: {
				path: "(^|/)src/(domain/collaborations/|application/(collaborations/collaboration-(draft-service|publication-service|renderer)\\.ts$|ports/(collaboration-(repository|session-repository|publication-repository)|showcase-capability)\\.ts$)|infrastructure/database/collaboration-(repository|session-repository|publication-repository)\\.ts$)",
			},
		},
		{
			name: "bot-application-must-compose-features-through-public-entrypoints",
			severity: "error",
			from: { path: "(^|/)src/runtime/bot-application\\.ts$" },
			to: {
				path: "(^|/)src/(modules/(profiles|collaborations|marketplace|applications|moderation)/(?!index\\.ts$).+|application/(profiles|collaborations|moderation)(/|$)|infrastructure/(database/(profile(-session)?|collaboration(-browse|-publication|-session)?|admin-moderation)-repository\\.ts$|telegram/grammy-telegram-audience-reader\\.ts$))",
			},
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
