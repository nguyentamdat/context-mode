import { randomInt } from "node:crypto";
import { homedir } from "node:os";
import path from "node:path";

import { Effect } from "effect";

import type { WorktreeError } from "../errors/index.js";
import { errorToMessage } from "../errors/index.js";

const MAX_NAME_LENGTH = 64;
const MAX_BASE_NAME_LENGTH = MAX_NAME_LENGTH - "-worktree-yyyymmdd".length;
const RANDOM_ADJECTIVES = ["brave", "calm", "clear", "fast", "fresh", "kind", "light", "sharp"];
const RANDOM_NOUNS = ["cedar", "falcon", "harbor", "meadow", "orbit", "river", "signal", "tiger"];

export interface ManagedPaths {
  repoRoot: string;
  managedRoot: string;
  metaDir: string;
}

export interface NameResult {
  name: string;
  isGenerated: boolean;
  storageTimestamp: string;
}

export interface WorktreeMetadata {
  version: 1;
  name: string;
  originalPath: string;
  worktreePath: string;
  storageTimestamp: string;
  createdAt: string;
}

export function normalizeWorktreeName(input: string | undefined, now: Date = new Date(), randomName = generateRandomName()): NameResult {
  const raw = (input ?? "").trim();
  const isGenerated = raw.length === 0;
  const baseName = normalizeBaseName(isGenerated ? randomName : raw, now);

  return {
    name: `${baseName}-worktree-${formatDay(now)}`,
    isGenerated,
    storageTimestamp: formatTimestamp(now)
  };
}

export function isValidWorktreeName(name: string): boolean {
  if (name.length === 0 || name.length > MAX_NAME_LENGTH) {
    return false;
  }

  return /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(name);
}

export function getManagedPaths(repoRoot: string, storageHome = getStorageHome()): ManagedPaths {
  const managedRoot = path.resolve(storageHome);

  return {
    repoRoot: path.resolve(repoRoot),
    managedRoot,
    metaDir: path.join(managedRoot, ".meta")
  };
}

export function getWorktreePath(paths: ManagedPaths, name: string, storageTimestamp = formatTimestamp()): string {
  if (!isValidWorktreeName(name)) {
    throw new Error("worktree name must be kebab-case");
  }

  const targetPath = path.resolve(paths.managedRoot, storageTimestamp, name);
  assertInside(paths.managedRoot, targetPath);
  return targetPath;
}

export function getMetadataPath(paths: ManagedPaths, name: string, storageTimestamp: string): string {
  const targetPath = path.resolve(paths.metaDir, storageTimestamp, `${name}.json`);
  assertInside(paths.metaDir, targetPath);
  return targetPath;
}

export function getMetadataPathForWorktree(worktreeRoot: string): string {
  const name = path.basename(worktreeRoot);
  const timestampDir = path.dirname(worktreeRoot);
  const storageTimestamp = path.basename(timestampDir);
  const managedRoot = path.dirname(timestampDir);

  return getMetadataPath({ repoRoot: worktreeRoot, managedRoot, metaDir: path.join(managedRoot, ".meta") }, name, storageTimestamp);
}

export function readMetadataEffect(readFile: (filePath: string, encoding: "utf8") => Promise<string>, filePath: string): Effect.Effect<WorktreeMetadata | undefined, WorktreeError> {
  return Effect.tryPromise({
    try: async () => {
      try {
        const content = await readFile(filePath, "utf8");
        const parsed = JSON.parse(content) as Partial<WorktreeMetadata>;
        return normalizeMetadata(parsed, filePath);
      } catch (error) {
        if (isMissingFile(error)) {
          return undefined;
        }

        throw error;
      }
    },
    catch: (error) => ({ type: "fs", path: filePath, message: errorToMessage(error) })
  });
}

function normalizeBaseName(input: string, now: Date): string {
  const normalized = input
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-")
    .slice(0, MAX_BASE_NAME_LENGTH)
    .replace(/-+$/g, "");

  if (!isValidWorktreeName(`${normalized}-worktree-${formatDay(now)}`)) {
    throw new Error("worktree name must contain letters or numbers and fit kebab-case");
  }

  return normalized;
}

function getStorageHome(): string {
  if (process.env.PI_WORKTREE_HOME) {
    return process.env.PI_WORKTREE_HOME;
  }

  const dataHome = process.env.XDG_DATA_HOME || path.join(homedir(), ".local", "share");
  return path.join(dataHome, "pi-worktrees");
}

function generateRandomName(): string {
  const adjective = RANDOM_ADJECTIVES[randomInt(RANDOM_ADJECTIVES.length)] ?? "fresh";
  const noun = RANDOM_NOUNS[randomInt(RANDOM_NOUNS.length)] ?? "branch";
  const suffix = randomInt(10_000).toString().padStart(4, "0");
  return `${adjective}-${noun}-${suffix}`;
}

function assertInside(parentPath: string, childPath: string): void {
  const relative = path.relative(path.resolve(parentPath), path.resolve(childPath));
  if (relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))) {
    return;
  }

  throw new Error("managed worktree path escaped storage root");
}

function formatDay(date: Date = new Date()): string {
  const year = date.getUTCFullYear().toString();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}${month}${day}`;
}

function formatTimestamp(date: Date = new Date()): string {
  const year = date.getUTCFullYear().toString();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  const hour = String(date.getUTCHours()).padStart(2, "0");
  const minute = String(date.getUTCMinutes()).padStart(2, "0");
  const second = String(date.getUTCSeconds()).padStart(2, "0");
  return `${year}${month}${day}${hour}${minute}${second}`;
}

function normalizeMetadata(value: Partial<WorktreeMetadata>, filePath: string): WorktreeMetadata | undefined {
  const storageTimestamp = value.storageTimestamp ?? path.basename(path.dirname(filePath));
  if (
    value.version !== 1 ||
    typeof value.name !== "string" ||
    typeof value.originalPath !== "string" ||
    typeof value.worktreePath !== "string" ||
    typeof value.createdAt !== "string" ||
    storageTimestamp.length === 0
  ) {
    return undefined;
  }

  return {
    version: 1,
    name: value.name,
    originalPath: value.originalPath,
    worktreePath: value.worktreePath,
    storageTimestamp,
    createdAt: value.createdAt
  };
}

function isMissingFile(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
