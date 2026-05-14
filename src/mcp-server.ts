import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { getToken } from './auth.js';
import { getTimeEntries, getTimeApprovals, postTimeEntry, NON_PROJECT_TIME } from './mytime-client.js';
import { getWeekdays, getWeekMonday, isValidMMDDYYYY, toISO, normalizeApiDate } from './time-utils.js';
import { buildWeekDraftContext } from './week-draft-context.js';

const server = new Server(
  { name: 'mytime', version: '1.0.0' },
  { capabilities: { tools: {} } },
);

function errorResult(message: string) {
  return { content: [{ type: 'text', text: `Error: ${message}` }], isError: true as const };
}

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'mytime_get_week_status',
      description: 'Get this week\'s MyTime time entries — hours per day by project, total per day, and days with fewer than 8h logged.',
      inputSchema: { type: 'object', properties: {}, required: [] },
    },
    {
      name: 'mytime_get_week_dates',
      description: 'Returns the Monday–Friday dates of the current work week in MM/DD/YYYY format.',
      inputSchema: { type: 'object', properties: {}, required: [] },
    },
    {
      name: 'mytime_get_week_draft_context',
      description: 'Get the current MyTime week with per-day missing hours and drafting guidance for Codex to combine with Calendar, Email, Teams, and Slack evidence.',
      inputSchema: {
        type: 'object',
        properties: {
          week: {
            type: 'string',
            description: 'Optional week start date (Monday) in MM/DD/YYYY format. Defaults to the current week.',
          },
          targetHoursPerDay: {
            type: 'number',
            description: 'Optional daily target hours. Defaults to 8.',
          },
        },
      },
    },
    {
      name: 'mytime_get_approvals',
      description: "Get pending time approvals for your direct reports, grouped by project. Returns only entries awaiting your approval (status = pending).",
      inputSchema: {
        type: 'object',
        properties: {
          week: {
            type: 'string',
            description: 'Week start date (Monday) in MM/DD/YYYY format. Defaults to the current week.',
          },
        },
      },
    },
    {
      name: 'mytime_draft_entry',
      description: 'Draft a "Non-Project time / Available" time entry for a specific date. The entry is saved as a draft and will NOT be submitted for approval.',
      inputSchema: {
        type: 'object',
        properties: {
          date: {
            type: 'string',
            description: 'Date in MM/DD/YYYY format (e.g. "5/12/2026")',
          },
          hours: {
            type: 'number',
            description: 'Hours to log. Should be 8 minus any hours already logged for that day.',
          },
          description: {
            type: 'string',
            description: 'Short note describing what the available time covered (e.g. "Internal admin, Slalom enablement")',
          },
        },
        required: ['date', 'hours'],
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args = {} } = req.params;

  const token = await getToken();
  const monday = getWeekMonday();
  const weekdays = getWeekdays();

  if (name === 'mytime_get_week_dates') {
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          monday: weekdays[0],
          tuesday: weekdays[1],
          wednesday: weekdays[2],
          thursday: weekdays[3],
          friday: weekdays[4],
        }),
      }],
    };
  }

  if (name === 'mytime_get_week_status') {
    const entries = await getTimeEntries(token, monday);
    const weekISO = new Set(weekdays.map(toISO));

    // Group by date
    const byDate = new Map<string, typeof entries>();
    for (const e of entries) {
      const iso = normalizeApiDate(e.Date);
      if (!weekISO.has(iso)) continue;
      if (!byDate.has(iso)) byDate.set(iso, []);
      byDate.get(iso)!.push(e);
    }

    const days = weekdays.map(d => {
      const iso = toISO(d);
      const dayEntries = byDate.get(iso) ?? [];
      const totalHours = dayEntries.reduce((s, e) => s + e.RegularHours, 0);
      const hasAvailable = dayEntries.some(
        e => e.ProjectId === NON_PROJECT_TIME.projectId && e.TaskId === NON_PROJECT_TIME.taskId
      );
      return {
        date: d,
        totalHours,
        missingHours: Math.max(0, 8 - totalHours),
        hasAvailableEntry: hasAvailable,
        entries: dayEntries.map(e => ({
          project: e.ProjectName,
          task: e.TaskName !== e.ProjectName ? e.TaskName : undefined,
          hours: e.RegularHours,
          status: e.ApprovalStatus || 'draft',
          isAvailable: e.ProjectId === NON_PROJECT_TIME.projectId,
        })),
      };
    });

    return {
      content: [{ type: 'text', text: JSON.stringify({ week: `${weekdays[0]} – ${weekdays[4]}`, days }) }],
    };
  }

  if (name === 'mytime_get_week_draft_context') {
    const week = (args.week as string | undefined) ?? monday;
    const targetHoursPerDay = (args.targetHoursPerDay as number | undefined) ?? 8;

    if (!isValidMMDDYYYY(week)) {
      return errorResult('week must be a valid date in MM/DD/YYYY format');
    }

    if (typeof targetHoursPerDay !== 'number' || !Number.isFinite(targetHoursPerDay) || targetHoursPerDay <= 0 || targetHoursPerDay > 24) {
      return errorResult('targetHoursPerDay must be a positive number up to 24');
    }

    const entries = await getTimeEntries(token, week);
    const context = buildWeekDraftContext(entries, { weekMonday: week, targetHoursPerDay });
    return {
      content: [{ type: 'text', text: JSON.stringify(context) }],
    };
  }

  if (name === 'mytime_get_approvals') {
    const week = (args.week as string | undefined) ?? monday;
    if (!isValidMMDDYYYY(week)) {
      return errorResult('week must be a valid date in MM/DD/YYYY format');
    }
    const records = await getTimeApprovals(token, week);

    type PendingDay = { date: string; hours: number };
    type PersonEntry = { name: string; email: string; days: PendingDay[] };
    type ProjectGroup = { project: string; task?: string; people: PersonEntry[] };

    const byProject = new Map<string, ProjectGroup>();

    for (const r of records) {
      for (const e of r.TimeEntries) {
        const dailySlots = [e.MondayHours, e.TuesdayHours, e.WednesdayHours, e.ThursdayHours, e.FridayHours];
        const pendingDays: PendingDay[] = dailySlots
          .filter((d): d is NonNullable<typeof d> => d !== null && d.ApprovalStatus === 'P' && d.RegularHours > 0)
          .map(d => ({ date: normalizeApiDate(d.Date), hours: d.RegularHours }));

        if (pendingDays.length === 0) continue;

        const key = `${e.ProjectId}:${e.TaskId}`;
        if (!byProject.has(key)) {
          byProject.set(key, {
            project: e.ProjectName,
            task: e.TaskName !== e.ProjectName ? e.TaskName : undefined,
            people: [],
          });
        }
        byProject.get(key)!.people.push({ name: r.Name, email: r.Email, days: pendingDays });
      }
    }

    const projects = [...byProject.values()];
    return { content: [{ type: 'text', text: JSON.stringify({ week, projects }) }] };
  }

  if (name === 'mytime_draft_entry') {
    const date        = args.date as string;
    const hours       = args.hours as number;
    const description = (args.description as string | undefined) ?? '';

    if (!date || !isValidMMDDYYYY(date)) {
      return errorResult('date must be a valid date in MM/DD/YYYY format');
    }

    if (typeof hours !== 'number' || !Number.isFinite(hours) || hours <= 0 || hours > 24) {
      return errorResult('hours must be a positive number up to 24');
    }

    const id = await postTimeEntry(token, { date, hours, description });
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({ success: true, id, date, hours, description, note: 'Draft created. Review and submit at https://mytime.slalom.com/' }),
      }],
    };
  }

  return { content: [{ type: 'text', text: `Unknown tool: ${name}` }], isError: true };
});

const transport = new StdioServerTransport();
await server.connect(transport);
