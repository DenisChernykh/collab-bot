import type { Clock } from "../../shared/application/ports/clock.js";

export class SystemClock implements Clock {
	now(): Date {
		return new Date();
	}
}
