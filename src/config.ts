import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const CONFIG_DIR  = path.join(os.homedir(), '.mytime-helper');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');

interface Config {
  approvals?: {
    projectFilter?: string[];
  };
}

function load(): Config {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'));
  } catch {
    return {};
  }
}

function save(config: Config): void {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2) + '\n', 'utf-8');
}

export function getApprovalProjectFilters(): string[] {
  return load().approvals?.projectFilter ?? [];
}

export function addApprovalProjectFilter(pattern: string): string[] {
  const config = load();
  config.approvals ??= {};
  config.approvals.projectFilter ??= [];
  if (!config.approvals.projectFilter.includes(pattern)) {
    config.approvals.projectFilter.push(pattern);
  }
  save(config);
  return config.approvals.projectFilter;
}

export function removeApprovalProjectFilter(pattern: string): string[] {
  const config = load();
  config.approvals ??= {};
  config.approvals.projectFilter = (config.approvals.projectFilter ?? []).filter(p => p !== pattern);
  save(config);
  return config.approvals.projectFilter;
}

export function clearApprovalProjectFilters(): void {
  const config = load();
  if (config.approvals) delete config.approvals.projectFilter;
  save(config);
}

// Supports exact match and * wildcard, case-insensitive
export function matchesProjectFilter(projectName: string, filters: string[]): boolean {
  if (filters.length === 0) return true;
  return filters.some(pattern => {
    const re = '^' + pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$';
    return new RegExp(re, 'i').test(projectName);
  });
}
