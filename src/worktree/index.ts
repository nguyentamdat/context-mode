import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

import { Effect } from "effect";

import type { CommandRunner, RepositoryInfo, WorktreeStatus } from "../git/index.js";
import {
  createBranchWorktreeEffect,
  getBranchNameEffect,
  getRepositoryEffect,
  hasChangesEffect,
  listWorktreesEffect,
  removeWorktreeEffect,
  stashPopEffect,
  stashPushEffect
} from "../git/index.js";
import type { WorktreeError } from "../errors/index.js";
import { errorToMessage } from "../errors/index.js";
import type { ManagedPaths, WorktreeMetadata } from "../storage/index.js";
import {
  getManagedPaths,
  getMetadataPath,
  getMetadataPathForWorktree,
  getWorktreePath,
  normalizeWorktreeName,
  readMetadataEffect
} from "../storage/index.js";

export interface CreateWorktreeOptions {
  cwd: string;
  name?: string;
  moveChanges: boolean;
  storageHome?: string;
  now?: Date;
  randomName?: string;
}

export interface CreateWorktreeResult {
  name: string;
  branchName: string;
  path: string;
  originalPath: string;
  movedChanges: boolean;
}

export interface ReturnWorktreeOptions {
  cwd: string;
  moveChanges: boolean;
}

export interface DeleteWorktreeOptions {
  cwd: string;
  path: string;
  force: boolean;
  storageHome?: string;
}

export interface DeleteWorktreeResult {
  path: string;
  wasDirty: boolean;
}

export interface ReturnWorktreeResult {
  originalPath: string;
  currentPath: string;
  movedChanges: boolean;
}

export interface WorktreeOverlayData {
  repository: RepositoryInfo;
  managedPaths: ManagedPaths;
  items: WorktreeStatus[];
  returnMetadata?: WorktreeMetadata;
}

export function getOverlayDataEffect(runner: CommandRunner, cwd: string, storageHome?: string): Effect.Effect<WorktreeOverlayData, WorktreeError> {
  return Effect.gen(function* () {
    const repository = yield* getRepositoryEffect(runner, cwd);
    const returnMetadata = yield* readMetadataEffect(readFile, getMetadataPathForWorktree(repository.root));
    const paths = getRuntimeManagedPaths(repository.root, returnMetadata, storageHome);
    const worktrees = yield* listWorktreesEffect(runner, cwd);
    const currentPath = path.resolve(repository.root);
    const managedRoot = path.resolve(paths.managedRoot);
    const items: WorktreeStatus[] = [];

    for (const worktree of worktrees) {
      const worktreePath = path.resolve(worktree.path);
      const isCurrent = worktreePath === currentPath;
      const isManaged = isInside(managedRoot, worktreePath);
      const isOriginal = returnMetadata ? worktreePath === path.resolve(returnMetadata.originalPath) : false;
      if (!isManaged && !isCurrent && !isOriginal) {
        continue;
      }

      const isDirty = yield* hasChangesEffect(runner, worktree.path);
      items.push({
        ...worktree,
        isCurrent,
        isManaged,
        isDirty
      });
    }

    items.sort((left, right) => Number(right.isCurrent) - Number(left.isCurrent) || left.path.localeCompare(right.path));

    return { repository, managedPaths: paths, items, returnMetadata };
  });
}

export function createWorktreeEffect(runner: CommandRunner, options: CreateWorktreeOptions): Effect.Effect<CreateWorktreeResult, WorktreeError> {
  return Effect.gen(function* () {
    const repository = yield* getRepositoryEffect(runner, options.cwd);
    const returnMetadata = yield* readMetadataEffect(readFile, getMetadataPathForWorktree(repository.root));
    const nameResult = yield* Effect.try({
      try: () => normalizeWorktreeName(options.name, options.now, options.randomName),
      catch: (error) => ({ type: "validation" as const, message: errorToMessage(error) })
    });
    const paths = getRuntimeManagedPaths(repository.root, returnMetadata, options.storageHome);
    const targetPath = getWorktreePath(paths, nameResult.name, nameResult.storageTimestamp);
    const branchBase = yield* getBranchNameEffect(runner, options.cwd);
    const branchName = `wt/${nameResult.name}`;
    const stashMessage = `pi-worktrees:${nameResult.name}:${Date.now()}`;
    const hasChanges = yield* hasChangesEffect(runner, options.cwd);
    const shouldMoveChanges = options.moveChanges && hasChanges;

    yield* mkdirEffect(path.dirname(targetPath));

    if (shouldMoveChanges) {
      yield* stashPushEffect(runner, options.cwd, stashMessage);
    }

    yield* createBranchWorktreeEffect(runner, options.cwd, targetPath, branchName, branchBase || "HEAD");

    if (shouldMoveChanges) {
      yield* stashPopEffect(runner, targetPath);
    }

    const metadata: WorktreeMetadata = {
      version: 1,
      name: nameResult.name,
      originalPath: paths.repoRoot,
      worktreePath: targetPath,
      storageTimestamp: nameResult.storageTimestamp,
      createdAt: (options.now ?? new Date()).toISOString()
    };
    yield* writeMetadataEffect(paths, metadata);

    return {
      name: nameResult.name,
      branchName,
      path: targetPath,
      originalPath: repository.root,
      movedChanges: shouldMoveChanges
    };
  });
}

export function deleteWorktreeEffect(runner: CommandRunner, options: DeleteWorktreeOptions): Effect.Effect<DeleteWorktreeResult, WorktreeError> {
  return Effect.gen(function* () {
    const repository = yield* getRepositoryEffect(runner, options.cwd);
    const returnMetadata = yield* readMetadataEffect(readFile, getMetadataPathForWorktree(repository.root));
    const paths = getRuntimeManagedPaths(repository.root, returnMetadata, options.storageHome);
    const targetPath = path.resolve(options.path);
    const worktrees = yield* listWorktreesEffect(runner, options.cwd);
    const worktree = worktrees.find((item) => path.resolve(item.path) === targetPath);

    if (!worktree) {
      return yield* Effect.fail({ type: "validation" as const, message: "worktree not found" });
    }

    if (targetPath === path.resolve(repository.root)) {
      return yield* Effect.fail({ type: "validation" as const, message: "cannot delete the current worktree" });
    }

    if (!isInside(paths.managedRoot, targetPath)) {
      return yield* Effect.fail({ type: "validation" as const, message: "only managed pi-worktrees worktrees can be deleted" });
    }

    const wasDirty = yield* hasChangesEffect(runner, targetPath);
    if (wasDirty && !options.force) {
      return yield* Effect.fail({ type: "validation" as const, message: "worktree has uncommitted changes" });
    }

    yield* removeWorktreeEffect(runner, options.cwd, targetPath, options.force);
    yield* deleteMetadataEffect(targetPath);

    return { path: targetPath, wasDirty };
  });
}

export function returnFromWorktreeEffect(runner: CommandRunner, options: ReturnWorktreeOptions): Effect.Effect<ReturnWorktreeResult, WorktreeError> {
  return Effect.gen(function* () {
    const repository = yield* getRepositoryEffect(runner, options.cwd);
    const metadataPath = getMetadataPathForWorktree(repository.root);
    const metadata = yield* readMetadataEffect(readFile, metadataPath);
    if (!metadata) {
      return yield* Effect.fail({ type: "validation" as const, message: "current directory is not a managed pi-worktrees worktree" });
    }

    const hasChanges = yield* hasChangesEffect(runner, repository.root);
    const shouldMoveChanges = options.moveChanges && hasChanges;
    if (shouldMoveChanges) {
      const stashMessage = `pi-worktrees-return:${metadata.name}:${Date.now()}`;
      yield* stashPushEffect(runner, repository.root, stashMessage);
      yield* stashPopEffect(runner, metadata.originalPath);
    }

    return {
      originalPath: metadata.originalPath,
      currentPath: repository.root,
      movedChanges: shouldMoveChanges
    };
  });
}

function getRuntimeManagedPaths(repoRoot: string, metadata: WorktreeMetadata | undefined, storageHome: string | undefined): ManagedPaths {
  if (metadata) {
    const managedRoot = path.dirname(path.dirname(path.resolve(metadata.worktreePath)));
    return { repoRoot: path.resolve(metadata.originalPath), managedRoot, metaDir: path.join(managedRoot, ".meta") };
  }

  return getManagedPaths(repoRoot, storageHome);
}

function mkdirEffect(dirPath: string): Effect.Effect<void, WorktreeError> {
  return Effect.tryPromise({
    try: () => mkdir(dirPath, { recursive: true }).then(() => undefined),
    catch: (error) => ({ type: "fs", path: dirPath, message: errorToMessage(error) })
  });
}

function writeMetadataEffect(paths: ManagedPaths, metadata: WorktreeMetadata): Effect.Effect<void, WorktreeError> {
  const filePath = getMetadataPath(paths, metadata.name, metadata.storageTimestamp);
  return Effect.tryPromise({
    try: async () => {
      await mkdir(path.dirname(filePath), { recursive: true });
      await writeFile(filePath, `${JSON.stringify(metadata, null, 2)}\n`, "utf8");
    },
    catch: (error) => ({ type: "fs", path: filePath, message: errorToMessage(error) })
  });
}

function deleteMetadataEffect(worktreePath: string): Effect.Effect<void, WorktreeError> {
  const filePath = getMetadataPathForWorktree(worktreePath);
  return Effect.tryPromise({
    try: async () => {
      try {
        await unlink(filePath);
      } catch (error) {
        if (!isMissingFile(error)) {
          throw error;
        }
      }
    },
    catch: (error) => ({ type: "fs", path: filePath, message: errorToMessage(error) })
  });
}

function isMissingFile(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

function isInside(parentPath: string, childPath: string): boolean {
  const relative = path.relative(path.resolve(parentPath), path.resolve(childPath));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}
