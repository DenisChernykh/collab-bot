import type { Entity } from "../domain/entity.js";

export function entityId(entity: Entity): string {
	return entity.id;
}
