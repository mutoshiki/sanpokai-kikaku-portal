import type { ComponentType } from 'react';

export interface FormMakerProject {
  roomId: string;
  projectName?: string;
  eventDate?: string;
  jobId?: string;
  token?: string;
  debugSample?: boolean;
  sampleInput?: Partial<Record<'planName' | 'editorEmail' | 'eventDate' | 'deadline' | 'description', string>>;
}

export interface FormMakerSession {
  prepare(): Promise<Record<string, unknown>>;
  listJobs(limit?: number): Promise<any[]>;
  getJob(jobId: string): Promise<any>;
  enqueue(input: Record<string, unknown>, options?: { jobId?: string }): Promise<any>;
  getHandoffToken(jobId: string): string;
}

export const FormMakerWorkspace: ComponentType<{
  project?: FormMakerProject | null;
  session?: FormMakerSession;
  createProjectLink?: (input: Record<string, string>) => Promise<FormMakerProject | null>;
  linkedForm?: Record<string, unknown> | null;
  active?: boolean;
  sampleMode?: boolean;
  onNotice?: (message: string) => void;
  onHandoffReady?: (value: { roomId: string; jobId: string; token: string }) => void;
}>;
export function createFormMakerSession(options: Record<string, unknown>): FormMakerSession;
export function canonicalInput(input: Record<string, unknown>): Record<string, string>;
export function readFormMakerProjectLink(options?: Record<string, unknown>): FormMakerProject | null;
export function createProjectJobStorage(options: Record<string, unknown>): Record<string, unknown>;
export function formMakerProjectStorageKey(roomId: string, kind: 'input' | 'pending'): string;
export function migrateLegacyPendingJob(options: Record<string, unknown>): boolean;
export function mergeFormMakerJobs(localHistory: unknown[], jobs: unknown[]): unknown[];
export function projectUrlWithHandoffCapability(projectUrl: string, token: string): string;
export function readCachedFormMakerHistory(storage?: Storage): unknown[];
export function writeCachedFormMakerHistory(history: unknown[], storage?: Storage): boolean;
export const FORM_MAKER_FIREBASE_CONFIG: Readonly<Record<string, string>>;
