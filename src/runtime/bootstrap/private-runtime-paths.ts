import { constants } from "node:fs";
import { access, chmod, lstat, open } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";

export async function assertPrivateEnvFile(envFilePath: string): Promise<void> {
	if (!isAbsolute(envFilePath)) throw new Error("env-file path must be absolute");
	const info = await lstat(envFilePath);
	if (!info.isFile()) throw new Error("env-file path must be a regular file");
	if (process.getuid !== undefined && info.uid !== process.getuid()) throw new Error("env-file must be owned by the current user");
	if ((info.mode & 0o777) !== 0o600) throw new Error("env-file mode must be 0600");
}

export async function ensurePrivateDatabasePath(databasePath: string): Promise<void> {
	if (!isAbsolute(databasePath) || resolve(databasePath) === "/") throw new Error("database path must be an absolute non-root path");
	const parent = resolve(dirname(databasePath));
	if (parent === resolve(process.cwd())) throw new Error("database parent must not be the repository root");
	const parentInfo = await lstat(parent);
	if (!parentInfo.isDirectory() || (parentInfo.mode & 0o777) !== 0o700) {
		throw new Error("database parent must be the current user's private 0700 directory");
	}
	if (process.getuid !== undefined && parentInfo.uid !== process.getuid()) {
		throw new Error("database parent must be owned by the current user");
	}
	await access(parent, constants.W_OK);
	try {
		await assertPrivateDatabaseFile(databasePath);
	} catch (error) {
		if (!isErrno(error, "ENOENT")) throw error;
		const handle = await open(databasePath, "wx", 0o600);
		await handle.close();
		await chmod(databasePath, 0o600);
		await assertPrivateDatabaseFile(databasePath);
	}
}

function isErrno(error: unknown, code: string): boolean {
	return typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === code;
}

async function assertPrivateDatabaseFile(databasePath: string): Promise<void> {
	const info = await lstat(databasePath);
	if (!info.isFile()) throw new Error("database path must be a regular file");
	if (process.getuid !== undefined && info.uid !== process.getuid()) throw new Error("database must be owned by the current user");
	if ((info.mode & 0o777) !== 0o600) throw new Error("database mode must be 0600");
}
