import type { ConnectionActor, ConnectionSession, ConnectionState, PublicPerson, SearchFilters } from "../connection-model.js";

export interface ConnectionRepository {
	getActor(userId: string): Promise<ConnectionActor | undefined>;
	getSession(userId: string): Promise<ConnectionSession | undefined>;
	saveSession(userId: string, state: ConnectionState, now: number): Promise<ConnectionSession>;
	isVisible(profileId: string): Promise<boolean>;
	setVisible(profileId: string, visible: boolean, now: number): Promise<void>;
	search(excludeProfileId: string, filters: SearchFilters, offset: number): Promise<{ person: PublicPerson | null; hasNext: boolean }>;
}
