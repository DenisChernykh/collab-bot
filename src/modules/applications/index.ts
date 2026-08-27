export type { ApplicationsFeatureApi } from "./application/application-feature.js";
export type { ApplicationFailureCode, AuthorManagementView } from "./application/application-contracts.js";
export {
	createApplicationsFeature,
	type ApplicationsFeature,
	type ApplicationsProjectionMaintenance,
	type CreateApplicationsFeatureOptions,
} from "./composition/create-applications-feature.js";
