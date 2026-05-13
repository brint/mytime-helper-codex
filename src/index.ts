#!/usr/bin/env node
import { Command } from 'commander';
import chalk from 'chalk';
import * as readline from 'readline';

function confirm(question: string): Promise<boolean> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => {
    rl.question(question, answer => { rl.close(); resolve(answer.trim().toLowerCase() === 'y'); });
  });
}
import { getToken } from './auth.js';
import {
  getApprovalProjectFilters,
  addApprovalProjectFilter,
  removeApprovalProjectFilter,
  clearApprovalProjectFilters,
  matchesProjectFilter,
} from './config.js';
import { apiGet, deleteTimeEntry, getTimeEntries, getTimeApprovals, postTimeEntry, postTimeApproval, NON_PROJECT_TIME, type ApprovalAction } from './mytime-client.js';
import { getWeekdays, getWeekMonday, toISO, normalizeApiDate } from './time-utils.js';
import { buildWeekDraftContext } from './week-draft-context.js';

const program = new Command();

program
  .name('mytime')
  .description('MyTime helper — drafts time entries without submitting them')
  .version('1.0.0');

program
  .command('auth')
  .description('Pre-warm the MyTime auth token (opens browser for Entra login if needed)')
  .action(async () => {
    try {
      await getToken();
      console.log(chalk.green('✓ Authenticated.'));
    } catch (err: any) {
      console.error(chalk.red('Auth failed:'), err.message);
      process.exit(1);
    }
  });

program
  .command('status')
  .description("Show this week's time entries")
  .action(async () => {
    let token: string;
    try {
      token = await getToken();
    } catch (err: any) {
      console.error(chalk.red('Auth failed:'), err.message);
      process.exit(1);
    }

    const weekdays = getWeekdays();
    const monday = getWeekMonday();

    let entries: Awaited<ReturnType<typeof getTimeEntries>>;
    try {
      entries = await getTimeEntries(token, monday);
    } catch (err: any) {
      console.error(chalk.red('Failed to fetch time entries:'), err.message);
      process.exit(1);
    }

    const weekISO = new Set(weekdays.map(toISO));
    const thisWeek = entries.filter(e => weekISO.has(normalizeApiDate(e.Date)));

    console.log();
    console.log(chalk.bold('Week:'), weekdays[0], '–', weekdays[4]);
    console.log();

    if (thisWeek.length === 0) {
      console.log(chalk.yellow('No time entries this week.'));
      return;
    }

    const totalHours = thisWeek.reduce((s, e) => s + e.RegularHours, 0);

    for (const e of thisWeek.sort((a, b) => a.Date.localeCompare(b.Date))) {
      const date = normalizeApiDate(e.Date);
      const status = e.ApprovalStatus ? chalk.yellow(e.ApprovalStatus) : chalk.dim('draft');
      const label = e.TaskName && e.TaskName !== e.ProjectName
        ? `${e.ProjectName} / ${e.TaskName}`
        : e.ProjectName;
      console.log(chalk.bold(date), `${e.RegularHours}h`, chalk.cyan(label), status);
    }

    console.log();
    console.log(chalk.bold('Total:'), `${totalHours}h`);
  });

program
  .command('draft')
  .description('Draft 8h of "Non-Project time / Available" for each unfilled weekday this week')
  .option('-h, --hours <n>', 'Hours per day', '8')
  .option('-d, --description <text>', 'Entry description', '')
  .option('--dry-run', 'Preview what would be drafted without creating entries')
  .action(async (opts) => {
    const hoursPerDay = parseFloat(opts.hours);
    if (isNaN(hoursPerDay) || hoursPerDay <= 0 || hoursPerDay > 24) {
      console.error(chalk.red('--hours must be a positive number up to 24'));
      process.exit(1);
    }

    let token: string;
    try {
      token = await getToken();
    } catch (err: any) {
      console.error(chalk.red('Auth failed:'), err.message);
      process.exit(1);
    }

    const weekdays = getWeekdays();
    const monday = getWeekMonday();

    let existing: Awaited<ReturnType<typeof getTimeEntries>>;
    try {
      existing = await getTimeEntries(token, monday);
    } catch (err: any) {
      console.error(chalk.red('Failed to fetch time entries:'), err.message);
      process.exit(1);
    }

    const filledDates = new Set(
      existing
        .filter(e => e.ProjectId === NON_PROJECT_TIME.projectId && e.TaskId === NON_PROJECT_TIME.taskId)
        .map(e => normalizeApiDate(e.Date))
    );

    const toCreate = weekdays.filter(d => !filledDates.has(toISO(d)));

    console.log();
    console.log(chalk.bold('Week:'), weekdays[0], '–', weekdays[4]);
    console.log();

    if (toCreate.length === 0) {
      console.log(chalk.green('✓ All weekdays already have a Non-Project time / Available entry.'));
      return;
    }

    for (const date of toCreate) {
      const label = `${date}  ${hoursPerDay}h  ${NON_PROJECT_TIME.projectName} / ${NON_PROJECT_TIME.taskName}`;
      if (opts.dryRun) {
        console.log(chalk.dim('[dry-run]'), label);
        continue;
      }
      try {
        const id = await postTimeEntry(token, { date, hours: hoursPerDay, description: opts.description });
        console.log(chalk.green('✓'), label, chalk.dim(id));
      } catch (err: any) {
        console.error(chalk.red('✗'), label);
        console.error(chalk.red('  Error:'), err.message);
      }
    }

    if (!opts.dryRun) {
      console.log();
      console.log(chalk.bold('Done.'), `Drafted ${toCreate.length} entr${toCreate.length === 1 ? 'y' : 'ies'}.`);
      console.log(chalk.dim('Review and submit at https://mytime.slalom.com/'));
    }
  });

program
  .command('weekly-draft-context')
  .description('Show structured week-gap context for Codex to use with Calendar, Email, Teams, and Slack while drafting personal time')
  .option('-w, --week <MM/DD/YYYY>', 'Week start date (Monday); defaults to current week')
  .option('-t, --target-hours <n>', 'Target hours per day', '8')
  .action(async (opts) => {
    const targetHours = parseFloat(opts.targetHours);
    if (isNaN(targetHours) || targetHours <= 0 || targetHours > 24) {
      console.error(chalk.red('--target-hours must be a positive number up to 24'));
      process.exit(1);
    }

    const weekMonday = opts.week ?? getWeekMonday();

    let token: string;
    try {
      token = await getToken();
    } catch (err: any) {
      console.error(chalk.red('Auth failed:'), err.message);
      process.exit(1);
    }

    let entries: Awaited<ReturnType<typeof getTimeEntries>>;
    try {
      entries = await getTimeEntries(token, weekMonday);
    } catch (err: any) {
      console.error(chalk.red('Failed to fetch time entries:'), err.message);
      process.exit(1);
    }

    const context = buildWeekDraftContext(entries, { weekMonday, targetHoursPerDay: targetHours });
    console.log(JSON.stringify(context, null, 2));
  });

program
  .command('raw-week')
  .description('Print raw MyTime entries for a week, including project and task identifiers')
  .option('-w, --week <MM/DD/YYYY>', 'Week start date (Monday); defaults to current week')
  .action(async (opts) => {
    const weekMonday = opts.week ?? getWeekMonday();

    let token: string;
    try {
      token = await getToken();
    } catch (err: any) {
      console.error(chalk.red('Auth failed:'), err.message);
      process.exit(1);
    }

    try {
      const entries = await getTimeEntries(token, weekMonday);
      console.log(JSON.stringify(entries, null, 2));
    } catch (err: any) {
      console.error(chalk.red('Failed to fetch time entries:'), err.message);
      process.exit(1);
    }
  });

program
  .command('draft-entry')
  .description('Create a specific MyTime draft entry for a date and project/task')
  .requiredOption('--date <MM/DD/YYYY>', 'Date to log')
  .requiredOption('--hours <n>', 'Hours to log')
  .option('--description <text>', 'Entry description', '')
  .option('--project-id <id>', 'Project ID')
  .option('--project-name <name>', 'Project name')
  .option('--task-id <id>', 'Task ID')
  .option('--task-name <name>', 'Task name')
  .option('--time-code <id>', 'Time code')
  .option('--work-code-category-id <id>', 'Work code category ID')
  .option('--work-code-id <id>', 'Work code ID')
  .option('--work-location-group-id <id>', 'Work location group ID')
  .option('--work-location-id <id>', 'Work location ID')
  .action(async (opts) => {
    const hours = parseFloat(opts.hours);
    if (isNaN(hours) || hours <= 0 || hours > 24) {
      console.error(chalk.red('--hours must be a positive number up to 24'));
      process.exit(1);
    }

    let token: string;
    try {
      token = await getToken();
    } catch (err: any) {
      console.error(chalk.red('Auth failed:'), err.message);
      process.exit(1);
    }

    try {
      const id = await postTimeEntry(token, {
        date: opts.date,
        hours,
        description: opts.description,
        projectId: opts.projectId,
        projectName: opts.projectName,
        taskId: opts.taskId,
        taskName: opts.taskName,
        timeCode: opts.timeCode,
        workCodeCategoryId: opts.workCodeCategoryId,
        workCodeId: opts.workCodeId,
        workLocationGroupId: opts.workLocationGroupId,
        workLocationId: opts.workLocationId,
      });
      console.log(JSON.stringify({ success: true, id }, null, 2));
    } catch (err: any) {
      console.error(chalk.red('Failed to draft entry:'), err.message);
      process.exit(1);
    }
  });

program
  .command('delete-entry')
  .description('Delete a specific MyTime time entry by ID')
  .requiredOption('--id <id>', 'Time entry ID')
  .option('-w, --week <MM/DD/YYYY>', 'Week start date to resolve the full entry payload before deleting')
  .action(async (opts) => {
    let token: string;
    try {
      token = await getToken();
    } catch (err: any) {
      console.error(chalk.red('Auth failed:'), err.message);
      process.exit(1);
    }

    try {
      let record: unknown;
      if (opts.week) {
        const entries = await getTimeEntries(token, opts.week);
        record = entries.find(entry => entry.Id === opts.id);
      }
      await deleteTimeEntry(token, opts.id, record);
      console.log(JSON.stringify({ success: true, id: opts.id }, null, 2));
    } catch (err: any) {
      console.error(chalk.red('Failed to delete entry:'), err.message);
      process.exit(1);
    }
  });

program
  .command('api-get')
  .description('Read a raw MyTime API path for diagnostics')
  .requiredOption('--path <path>', 'API path beginning with /')
  .action(async (opts) => {
    let token: string;
    try {
      token = await getToken();
    } catch (err: any) {
      console.error(chalk.red('Auth failed:'), err.message);
      process.exit(1);
    }

    try {
      const result = await apiGet<unknown>(token, opts.path);
      console.log(JSON.stringify(result, null, 2));
    } catch (err: any) {
      console.error(chalk.red('Failed API GET:'), err.message);
      process.exit(1);
    }
  });

program
  .command('approvals')
  .description("Show pending time approvals for your direct reports, grouped by project")
  .option('-w, --week <MM/DD/YYYY>', 'Week start date (Monday); defaults to current week')
  .option('--approve', 'Approve all pending entries after confirming')
  .action(async (opts) => {
    const monday = opts.week ?? getWeekMonday();

    let token: string;
    try {
      token = await getToken();
    } catch (err: any) {
      console.error(chalk.red('Auth failed:'), err.message);
      process.exit(1);
    }

    let records: Awaited<ReturnType<typeof getTimeApprovals>>;
    try {
      records = await getTimeApprovals(token, monday);
    } catch (err: any) {
      console.error(chalk.red('Failed to fetch approvals:'), err.message);
      process.exit(1);
    }

    const projectFilters = getApprovalProjectFilters();

    // Compute the Mon–Sun dates for the requested week
    const [wm, wd, wy] = monday.split('/').map(Number);
    const mondayDate = new Date(wy, wm - 1, wd);
    const weekDates = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(mondayDate);
      d.setDate(mondayDate.getDate() + i);
      return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`;
    });
    const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

    console.log();
    console.log(chalk.bold('Pending Time Approvals — week of'), monday);
    if (projectFilters.length > 0) {
      console.log(chalk.dim(`Filtered to: ${projectFilters.join(', ')}`));
    }
    console.log();

    type PersonEntry = { name: string; hoursPerDay: (number | null)[] };
    type ProjectGroup = { label: string; people: PersonEntry[] };

    const byProject  = new Map<string, ProjectGroup>();
    const allActions: ApprovalAction[] = [];

    for (const r of records) {
      for (const e of r.TimeEntries) {
        const dailySlots = [e.MondayHours, e.TuesdayHours, e.WednesdayHours, e.ThursdayHours, e.FridayHours];
        const hoursPerDay: (number | null)[] = [
          ...dailySlots.map(d =>
            d !== null && d.ApprovalStatus === 'P' && d.RegularHours > 0 ? d.RegularHours : null
          ),
          null, // Saturday — not returned by API
          null, // Sunday   — not returned by API
        ];

        if (hoursPerDay.every(h => h === null)) continue;
        if (!matchesProjectFilter(e.ProjectName, projectFilters)) continue;

        // Collect per-day approval actions
        for (const d of dailySlots) {
          if (d !== null && d.ApprovalStatus === 'P' && d.RegularHours > 0) {
            allActions.push({
              ResourceId:   r.Id,
              TimeId:       d.Id,
              ProjectId:    e.ProjectId,
              TaskId:       e.TaskId,
              Date:         d.Date,
              Action:       true,
              RejectReason: null,
              TimeCode:     d.TimeCode ?? e.TimeCode ?? '00000000-0000-0000-0000-000000000000',
            });
          }
        }

        const key = `${e.ProjectId}:${e.TaskId}`;
        if (!byProject.has(key)) {
          const label = e.TaskName !== e.ProjectName ? `${e.ProjectName} / ${e.TaskName}` : e.ProjectName;
          byProject.set(key, { label, people: [] });
        }
        byProject.get(key)!.people.push({ name: r.Name, hoursPerDay });
      }
    }

    if (byProject.size === 0) {
      console.log(chalk.green('✓ No pending approvals.'));
      return;
    }

    const NAME_WIDTH = 26;
    const COL_WIDTH  = 7;

    const header = ' '.repeat(NAME_WIDTH + 4) +
      DAY_LABELS.map((l, i) => {
        const [m, d] = weekDates[i].split('/');
        return `${l} ${m}/${d}`.padStart(COL_WIDTH);
      }).join('');

    for (const { label, people } of byProject.values()) {
      console.log(chalk.bold(label));
      console.log(chalk.dim(header));
      for (const { name, hoursPerDay } of people) {
        const cols = hoursPerDay.map(h =>
          h !== null ? chalk.yellow(`${h}h`.padStart(COL_WIDTH)) : chalk.dim('—'.padStart(COL_WIDTH))
        ).join('');
        console.log(`  ${chalk.cyan(name.padEnd(NAME_WIDTH))}  ${cols}`);
      }
      console.log();
    }

    const totalPending = [...byProject.values()].reduce((s, g) => s + g.people.length, 0);
    console.log(chalk.yellow(`${totalPending} pending approval${totalPending === 1 ? '' : 's'} across ${byProject.size} project${byProject.size === 1 ? '' : 's'}.`));

    if (!opts.approve) {
      console.log(chalk.dim('Run with --approve to approve all pending entries.'));
      return;
    }

    console.log();
    const ok = await confirm(`Approve all ${allActions.length} pending entr${allActions.length === 1 ? 'y' : 'ies'}? [y/N] `);
    if (!ok) {
      console.log(chalk.dim('Cancelled.'));
      return;
    }

    try {
      await postTimeApproval(token, allActions);
      console.log(chalk.green(`✓ Approved ${allActions.length} entr${allActions.length === 1 ? 'y' : 'ies'}.`));
    } catch (err: any) {
      console.error(chalk.red('Approval failed:'), err.message);
      process.exit(1);
    }
  });

const configCmd = program
  .command('config')
  .description('Manage filter configuration');

configCmd
  .command('list')
  .description('Show current approval project filters')
  .action(() => {
    const filters = getApprovalProjectFilters();
    if (filters.length === 0) {
      console.log(chalk.dim('No project filters set — all projects shown.'));
    } else {
      console.log(chalk.bold('Approval project filters:'));
      for (const f of filters) console.log(' ', chalk.cyan(f));
    }
  });

configCmd
  .command('add <pattern>')
  .description('Add a project filter (* is wildcard, e.g. "Client A*")')
  .action((pattern: string) => {
    const filters = addApprovalProjectFilter(pattern);
    console.log(chalk.green('✓'), `Added: ${chalk.cyan(pattern)}`);
    console.log(chalk.dim(`Active filters: ${filters.join(', ')}`));
  });

configCmd
  .command('remove <pattern>')
  .description('Remove a project filter (must match exactly as added)')
  .action((pattern: string) => {
    const filters = removeApprovalProjectFilter(pattern);
    console.log(chalk.green('✓'), `Removed: ${chalk.cyan(pattern)}`);
    if (filters.length === 0) {
      console.log(chalk.dim('No filters remaining — all projects will be shown.'));
    } else {
      console.log(chalk.dim(`Active filters: ${filters.join(', ')}`));
    }
  });

configCmd
  .command('clear')
  .description('Remove all project filters (show all projects)')
  .action(() => {
    clearApprovalProjectFilters();
    console.log(chalk.green('✓ All project filters cleared.'));
  });

program.parse();
