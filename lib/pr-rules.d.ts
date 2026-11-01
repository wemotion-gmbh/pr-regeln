export type Forge = 'github' | 'bitbucket';
export type FindingCode = 'K1' | 'K2' | 'K3' | 'K4' | 'K5' | 'K6' | 'K7' | 'K8' | 'K9' | 'M1' | 'W1' | 'W2';

export interface Finding {
  code: FindingCode;
  message: string;
  fix?: string;
}

export interface Cutoffs {
  T0: string | null;
  T1: string | null;
  T2: string | null;
}

export interface Author {
  login: string;
  type?: string;
}

export interface PrFile {
  path: string;
  patch?: string | null;
}

export interface PrInput {
  forge: Forge;
  repo: string;
  head: string;
  base: string;
  title?: string;
  body: string;
  draft?: boolean;
  labels?: string[];
  author?: Author | null;
  createdAt?: string;
  files?: PrFile[];
}

export interface MigrationResult {
  deleting: boolean;
  files: string[];
}

export interface CheckResult {
  errors: Finding[];
  warnings: Finding[];
  isNew: boolean;
  migration?: MigrationResult | null;
  skipped?: 'bot';
}

export interface BranchCheck {
  ok: boolean;
  kind: string | null;
  promotion: boolean;
  suggestion?: string;
}

export interface HeadEntry {
  key: 'Paired-with' | 'Braucht' | 'Merge-Stopp' | 'Nach dem Merge';
  value: string;
  line: number;
}

export interface HeadBlock {
  entries: HeadEntry[];
  end: number;
  needs: { repo: string; number: number; note: string }[];
  stops: string[];
  pairedWith: { repo: string; url: string }[];
  after: string[];
  findings: Finding[];
}

export interface StopPhrase {
  kind: 'stop' | 'dependency';
  quote: string;
}

export const KINDS: readonly string[];
export const FIXED_BRANCHES: readonly string[];
export const TYPE_LABEL_BY_KIND: Readonly<Record<string, string>>;
export const TYPE_LABELS: readonly string[];
export const READY_LABEL_OLD: string;
export const RETIRED_LABELS: readonly string[];
export const MIGRATION_LABEL_MISSING: string;
export const MIGRATION_LABEL_OK: string;
export const HEAD_KEYS: readonly string[];
export const CUTOFFS: Readonly<Cutoffs>;

export function isBot(author: Author | null | undefined): boolean;
export function checkBranchName(head: string): BranchCheck;
export function typeLabelFor(head: string): string | null;
export function normalizeBody(body: string, forge: Forge): string;
export function parseHeadBlock(body: string): HeadBlock;
export function findStopPhrases(body: string, headEnd?: number): StopPhrase[];
export function splitUnifiedDiff(diff: string): { path: string; patch: string }[];
export function deletesData(files: PrFile[]): MigrationResult;
export function checkBody(body: string, forge: Forge): { rules: Finding[]; warnings: Finding[]; headBlock: HeadBlock };
export function isNewPr(createdAt: string | null | undefined, cutoffs?: Cutoffs): boolean;
export function checkPr(pr: PrInput, opts?: { cutoffs?: Cutoffs }): CheckResult;
