export type Forge = 'github' | 'bitbucket';
export type FindingCode = 'K1' | 'K2' | 'K3' | 'K4' | 'K5' | 'K6' | 'K7' | 'K8' | 'K9' | 'M1' | 'D1' | 'D2' | 'D3' | 'D4' | 'D5' | 'W1' | 'W2' | 'W3';

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

export interface DesignApproval {
  cockpit: string;
  sha: string;
  /** UI files changed since `sha`; null when unknown, which voids the yes. */
  changedUi: string[] | null;
}

export interface DesignRule {
  skill: string;
  ui: readonly string[];
  notUi: readonly string[];
}

export interface DesignValue {
  ok: boolean;
  reason?: string;
  cards: string[];
  isNew: boolean;
  none: boolean;
  newText: string;
}

export interface DesignResult {
  exempt: 'promotion' | 'release' | 'revert' | null;
  /** null when the files were not known. */
  uiFiles: string[] | null;
  value: string | null;
  cards: string[];
  isNew: boolean;
  none: boolean;
  approval?: DesignApproval | null;
  enforced: boolean;
}

export interface PrInput {
  forge: Forge;
  owner?: string;
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
  /** Read by forges.mjs when the yes label is set: null without a note, undefined when not read. */
  designApproval?: DesignApproval | null;
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
  /** Only for a repo with the design rule. */
  design?: DesignResult;
}

export interface BranchCheck {
  ok: boolean;
  kind: string | null;
  promotion: boolean;
  suggestion?: string;
}

export interface HeadEntry {
  key: 'Paired-with' | 'Braucht' | 'Merge-Stopp' | 'Nach dem Merge' | 'Design';
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
  design: string[];
  findings: Finding[];
}

export interface StopPhrase {
  kind: 'stop' | 'dependency' | 'mention';
  quote: string;
}

export const KINDS: readonly string[];
export const FIXED_BRANCHES: readonly string[];
export const BITBUCKET_REPOS: readonly string[];
export function forgeOfRepo(name: string, opts?: { bitbucketRepos?: readonly string[] }): Forge;
export const TYPE_LABEL_BY_KIND: Readonly<Record<string, string>>;
export const TYPE_LABELS: readonly string[];
export const READY_LABEL_OLD: string;
export const RETIRED_LABELS: readonly string[];
export const MIGRATION_LABEL_MISSING: string;
export const MIGRATION_LABEL_OK: string;
export const HEAD_KEYS: readonly string[];
export const CUTOFFS: Readonly<Cutoffs>;
export const DESIGN_LABEL_MISSING: string;
export const DESIGN_LABEL_OK: string;
export const DESIGN_RULES: Readonly<Record<string, DesignRule>>;
export const DESIGN_CUTOFFS: Readonly<{ T1: string | null; T2: string | null }>;
export const DESIGN_APPROVAL: RegExp;
export function designApprovalNote(cockpit: string, sha: string): string;
export function globToRegExp(glob: string): RegExp;
export function designRuleFor(ref: { forge?: Forge; owner?: string; repo?: string }): DesignRule | null;
export function isDesignUiPath(path: string, rule: DesignRule | null): boolean;
export function parseDesignValue(value: string): DesignValue;
export function designEnforced(createdAt: string | null | undefined, now: string | null | undefined, cutoffs?: { T1: string | null; T2: string | null }): boolean;

export function isBot(author: Author | null | undefined): boolean;
export function checkBranchName(head: string): BranchCheck;
export function typeLabelFor(head: string): string | null;
export function normalizeBody(body: string, forge: Forge): string;
export function parseHeadBlock(body: string): HeadBlock;
export function stopLines(body: string): string[];
export function findStopPhrases(body: string, headEnd?: number): StopPhrase[];
export function allStopPhrases(
  body: string,
  headEnd?: number,
  opts?: { keepDependencySection?: boolean; extra?: { kind: string; patterns: RegExp[] }[] },
): { kind: string; quote: string }[];
export function firstContentLine(lines: string[]): number;
export function splitUnifiedDiff(diff: string): { path: string; patch: string }[];
export function deletesData(files: PrFile[]): MigrationResult;
export function checkBody(body: string, forge: Forge): { rules: Finding[]; warnings: Finding[]; headBlock: HeadBlock };
export function isNewPr(createdAt: string | null | undefined, cutoffs?: Cutoffs): boolean;
export function checkPr(pr: PrInput, opts?: { cutoffs?: Cutoffs; designCutoffs?: { T1: string | null; T2: string | null }; now?: string }): CheckResult;
