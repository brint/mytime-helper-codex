import { NON_PROJECT_TIME, type TimeEntry } from './mytime-client.js';
import { getWeekMonday, getWeekdays, normalizeApiDate, toISO } from './time-utils.js';

export interface WeekDraftContextOptions {
  weekMonday?: string;
  targetHoursPerDay?: number;
}

export interface DraftContextEntry {
  project: string;
  task?: string;
  hours: number;
  status: string;
  isAvailable: boolean;
  description: string;
}

export interface DraftContextDay {
  date: string;
  isoDate: string;
  totalHours: number;
  missingHours: number;
  hasAvailableEntry: boolean;
  needsDraft: boolean;
  suggestedPrompt: string;
  entries: DraftContextEntry[];
}

export interface WeekDraftContext {
  weekMonday: string;
  weekStart: string;
  weekEnd: string;
  targetHoursPerDay: number;
  days: DraftContextDay[];
  guidance: {
    purpose: string;
    preferredSources: string[];
    workflow: string[];
  };
}

function resolveWeekdays(weekMonday?: string): string[] {
  if (!weekMonday) return getWeekdays();

  const [month, day, year] = weekMonday.split('/').map(Number);
  const monday = new Date(year, month - 1, day);
  return getWeekdays(monday);
}

export function buildWeekDraftContext(
  entries: TimeEntry[],
  options: WeekDraftContextOptions = {},
): WeekDraftContext {
  const targetHoursPerDay = options.targetHoursPerDay ?? 8;
  const weekMonday = options.weekMonday ?? getWeekMonday();
  const weekdays = resolveWeekdays(options.weekMonday);
  const weekISO = new Set(weekdays.map(toISO));

  const byDate = new Map<string, TimeEntry[]>();
  for (const entry of entries) {
    const isoDate = normalizeApiDate(entry.Date);
    if (!weekISO.has(isoDate)) continue;
    if (!byDate.has(isoDate)) byDate.set(isoDate, []);
    byDate.get(isoDate)!.push(entry);
  }

  const days = weekdays.map(date => {
    const isoDate = toISO(date);
    const dayEntries = byDate.get(isoDate) ?? [];
    const totalHours = dayEntries.reduce((sum, entry) => sum + entry.RegularHours, 0);
    const missingHours = Math.max(0, targetHoursPerDay - totalHours);
    const hasAvailableEntry = dayEntries.some(
      entry => entry.ProjectId === NON_PROJECT_TIME.projectId && entry.TaskId === NON_PROJECT_TIME.taskId,
    );

    return {
      date,
      isoDate,
      totalHours,
      missingHours,
      hasAvailableEntry,
      needsDraft: missingHours > 0,
      suggestedPrompt: missingHours > 0
        ? `Use calendar, email, Teams, and Slack activity from ${date} to draft a concise description for ${missingHours}h of personal time.`
        : 'No additional draft needed.',
      entries: dayEntries.map(entry => ({
        project: entry.ProjectName,
        task: entry.TaskName !== entry.ProjectName ? entry.TaskName : undefined,
        hours: entry.RegularHours,
        status: entry.ApprovalStatus || 'draft',
        isAvailable: entry.ProjectId === NON_PROJECT_TIME.projectId && entry.TaskId === NON_PROJECT_TIME.taskId,
        description: entry.Description,
      })),
    };
  });

  return {
    weekMonday,
    weekStart: weekdays[0],
    weekEnd: weekdays[4],
    targetHoursPerDay,
    days,
    guidance: {
      purpose: 'Provide the exact MyTime gaps Codex should explain and draft using connected work evidence.',
      preferredSources: ['Outlook Calendar', 'Outlook Email', 'Teams', 'Slack', 'SharePoint'],
      workflow: [
        'Read the current MyTime week before drafting anything.',
        'For each day with missing hours, review the matching calendar events, email threads, Teams chats, Slack activity, and document work when relevant.',
        'Infer likely project allocation and approximate hours from that evidence. Treat explicit calendar tags as the strongest signal.',
        'Map calendar items tagged "Sales" to business development.',
        'Treat Marathon, Marathon Petroleum, and MPC as the same project family and map them to the MPC MyTime project unless stronger evidence points elsewhere.',
        'Do not allocate project time from calendar invites whose show-as status is Free.',
        'Draft concise, truthful descriptions without inventing meetings or work.',
        'Create MyTime draft entries only after the user is comfortable with the descriptions and hours.',
      ],
    },
  };
}
