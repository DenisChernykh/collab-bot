import { format, isValid, parse } from "date-fns";
import { fromZonedTime } from "date-fns-tz";

const LOCAL_TIME_ZONE = "Asia/Yekaterinburg";
const LOCAL_DATE_PATTERN = /^\d{2}\.\d{2}\.\d{4}$/;

export interface LocalDate {
	readonly year: number;
	readonly month: number;
	readonly day: number;
}

export function parseLocalDate(input: string): LocalDate {
	if (!LOCAL_DATE_PATTERN.test(input)) {
		throw new RangeError("date must use strict DD.MM.YYYY format");
	}

	const parsed = parse(input, "dd.MM.yyyy", new Date(0));
	if (!isValid(parsed) || format(parsed, "dd.MM.yyyy") !== input) {
		throw new RangeError("date is not a valid calendar date");
	}

	return {
		year: Number(input.slice(6, 10)),
		month: Number(input.slice(3, 5)),
		day: Number(input.slice(0, 2)),
	};
}

export function formatEventDate(date: LocalDate): string {
	assertValidLocalDate(date);
	return `${date.year.toString().padStart(4, "0")}-${date.month.toString().padStart(2, "0")}-${date.day.toString().padStart(2, "0")}`;
}

export function deadlineAtEndOfLocalDay(date: LocalDate): number {
	assertValidLocalDate(date);
	const localDateTime = `${formatEventDate(date)}T23:59:59.999`;
	return fromZonedTime(localDateTime, LOCAL_TIME_ZONE).getTime();
}

export function isMutationAllowed(occurredAtMs: number, deadlineMs: number): boolean {
	return occurredAtMs <= deadlineMs;
}

export function isDeadlineDue(nowMs: number, deadlineMs: number): boolean {
	return nowMs > deadlineMs;
}

function assertValidLocalDate(date: LocalDate): void {
	if (
		typeof date !== "object" ||
		date === null ||
		!Number.isInteger(date.year) ||
		!Number.isInteger(date.month) ||
		!Number.isInteger(date.day)
	) {
		throw new RangeError("date components must be integers");
	}

	const input = `${date.day.toString().padStart(2, "0")}.${date.month.toString().padStart(2, "0")}.${date.year.toString().padStart(4, "0")}`;
	const parsed = parse(input, "dd.MM.yyyy", new Date(0));
	if (!LOCAL_DATE_PATTERN.test(input) || !isValid(parsed) || format(parsed, "dd.MM.yyyy") !== input) {
		throw new RangeError("date is not a valid calendar date");
	}
}
