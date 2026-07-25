import { notFound } from '@/lib/core/errors';
import { newId } from '@/lib/core/id';
import { getRepositories } from '@/lib/db';
import type { PromptRecord, PromptVersionRecord } from '@/lib/db/models';
import type { PromptFilter } from '@/lib/db/repositories';
import type { Session } from '@/lib/auth/session';
import type {
  CreatePromptInput,
  CreateVersionInput,
  UpdatePromptInput,
} from '@/lib/api/schemas';
import type { CompletionParams } from '@/lib/core/types';

/**
 * Prompt and version operations.
 *
 * Versions are append-only: an "edit" always creates a new version and moves
 * the prompt's `currentVersionId` pointer, and a "rollback" creates a *new*
 * version whose content matches an old one rather than deleting history. That
 * makes the audit trail complete and makes rollback itself reversible, which
 * matters when a prompt change is what regressed a production system.
 */

export interface PromptWithVersion {
  prompt: PromptRecord;
  currentVersion: PromptVersionRecord | null;
}

export async function createPrompt(
  session: Session,
  input: CreatePromptInput,
): Promise<PromptWithVersion> {
  const repos = getRepositories();
  const promptId = newId('prompt');

  await repos.prompts.create({
    id: promptId,
    workspaceId: session.workspaceId,
    name: input.name,
    description: input.description,
    collection: input.collection,
    tags: input.tags,
    favorite: false,
    currentVersionId: null,
    createdBy: session.userId,
  });

  const version = await repos.promptVersions.create({
    id: newId('ver'),
    promptId,
    workspaceId: session.workspaceId,
    version: 1,
    template: input.template,
    systemPrompt: input.systemPrompt,
    params: input.params as CompletionParams,
    changeNote: 'Initial version',
    createdBy: session.userId,
  });

  const updated = await repos.prompts.update(session.workspaceId, promptId, {
    currentVersionId: version.id,
  });

  return { prompt: updated, currentVersion: version };
}

export async function getPrompt(
  session: Session,
  promptId: string,
): Promise<PromptWithVersion> {
  const repos = getRepositories();
  const prompt = await repos.prompts.findById(session.workspaceId, promptId);
  if (!prompt) throw notFound('Prompt', promptId);

  const currentVersion = prompt.currentVersionId
    ? await repos.promptVersions.findById(session.workspaceId, prompt.currentVersionId)
    : null;

  return { prompt, currentVersion };
}

export async function listPrompts(session: Session, filter?: PromptFilter) {
  return getRepositories().prompts.list(session.workspaceId, filter);
}

export async function updatePrompt(
  session: Session,
  promptId: string,
  input: UpdatePromptInput,
): Promise<PromptRecord> {
  const repos = getRepositories();
  const existing = await repos.prompts.findById(session.workspaceId, promptId);
  if (!existing) throw notFound('Prompt', promptId);
  return repos.prompts.update(session.workspaceId, promptId, input);
}

export async function deletePrompt(session: Session, promptId: string): Promise<void> {
  const repos = getRepositories();
  const existing = await repos.prompts.findById(session.workspaceId, promptId);
  if (!existing) throw notFound('Prompt', promptId);
  await repos.prompts.delete(session.workspaceId, promptId);
}

/** Creates the next version and points the prompt at it. */
export async function createVersion(
  session: Session,
  promptId: string,
  input: CreateVersionInput,
): Promise<PromptVersionRecord> {
  const repos = getRepositories();
  const prompt = await repos.prompts.findById(session.workspaceId, promptId);
  if (!prompt) throw notFound('Prompt', promptId);

  const nextVersion = (await repos.promptVersions.latestVersionNumber(promptId)) + 1;

  const version = await repos.promptVersions.create({
    id: newId('ver'),
    promptId,
    workspaceId: session.workspaceId,
    version: nextVersion,
    template: input.template,
    systemPrompt: input.systemPrompt,
    params: input.params as CompletionParams,
    changeNote: input.changeNote,
    createdBy: session.userId,
  });

  await repos.prompts.update(session.workspaceId, promptId, {
    currentVersionId: version.id,
  });

  return version;
}

export async function listVersions(
  session: Session,
  promptId: string,
): Promise<PromptVersionRecord[]> {
  const repos = getRepositories();
  const prompt = await repos.prompts.findById(session.workspaceId, promptId);
  if (!prompt) throw notFound('Prompt', promptId);
  return repos.promptVersions.listForPrompt(session.workspaceId, promptId);
}

/**
 * Rolls back to a previous version by appending a copy of it.
 *
 * History is never rewritten, so the rollback itself appears in the timeline
 * and can be undone the same way.
 */
export async function rollbackToVersion(
  session: Session,
  promptId: string,
  versionId: string,
): Promise<PromptVersionRecord> {
  const repos = getRepositories();
  const target = await repos.promptVersions.findById(session.workspaceId, versionId);
  if (!target || target.promptId !== promptId)
    throw notFound('Prompt version', versionId);

  return createVersion(session, promptId, {
    template: target.template,
    systemPrompt: target.systemPrompt,
    params: target.params,
    changeNote: `Rolled back to v${target.version}`,
  });
}

// Diffing lives in `lib/prompts/diff` so client components can import it
// without pulling the repository layer into the browser bundle. Re-exported
// here for callers already working with the service module.
export {
  diffLines,
  diffStats,
  type DiffLine,
  type DiffOp,
  type DiffStats,
} from '@/lib/prompts/diff';
