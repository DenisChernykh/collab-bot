import type { Clock } from "../../application/ports/clock.js";

export class FakeClock implements Clock {
	private currentMs: number;

	constructor(initial: Date | number) {
		this.currentMs = toMilliseconds(initial);
	}

	now(): Date {
		return new Date(this.currentMs);
	}

	set(value: Date | number): void {
		this.currentMs = toMilliseconds(value);
	}

	advanceBy(milliseconds: number): void {
		if (!Number.isFinite(milliseconds)) {
			throw new RangeError("clock increment must be finite");
		}
		const nextMs = this.currentMs + milliseconds;
		if (!Number.isFinite(nextMs)) {
			throw new RangeError("clock time must remain finite");
		}
		this.currentMs = nextMs;
	}
}

function toMilliseconds(value: Date | number): number {
	const milliseconds = value instanceof Date ? value.getTime() : value;
	if (!Number.isFinite(milliseconds)) {
		throw new RangeError("clock time must be finite");
	}
	return milliseconds;
}
