const API_BASE = 'https://api.slalom.com/mytime-2/api/V1';

// Constants for "Non-Project time / Available" — IDs from captured traffic
const NULL_UUID = '00000000-0000-0000-0000-000000000000';
export const NON_PROJECT_TIME = {
  projectId:           'e811aa5d-b493-4d71-8ab2-20a9eca7b702',
  projectName:         'Non-Project time',
  taskId:              'f4ed8270-b3d3-44e1-859f-0fabdc50eb9d',
  taskName:            'Available',
  workCodeCategoryId:  NULL_UUID,
  workCodeId:          NULL_UUID,
  workLocationGroupId: NULL_UUID,
  workLocationId:      NULL_UUID,
  timeCode:            NULL_UUID,
};

export interface TimeEntry {
  Id:             string;
  Date:           string;
  RegularHours:   number;
  OvertimeHours:  number;
  ProjectId:      string;
  ProjectName:    string;
  TaskId:         string;
  TaskName:       string;
  ApprovalStatus: string;
  IsEditable:     boolean;
  Description:    string;
}

export interface DraftEntry {
  date:         string; // MM/DD/YYYY
  hours:        number;
  description?: string;
  projectId?: string;
  projectName?: string;
  taskId?: string;
  taskName?: string;
  workCodeCategoryId?: string;
  workCodeId?: string;
  workLocationGroupId?: string;
  workLocationId?: string;
  timeCode?: string;
}

async function request<T>(token: string, method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type':  'application/json',
      'Accept':        'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`${method} ${path} → ${res.status}: ${text}`);
  }

  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

export async function apiGet<T>(token: string, path: string): Promise<T> {
  return request<T>(token, 'GET', path);
}

export async function apiDelete(token: string, path: string): Promise<void> {
  await request<void>(token, 'DELETE', path);
}

export async function apiDeleteWithBody(token: string, path: string, body: unknown): Promise<void> {
  await request<void>(token, 'DELETE', path, body);
}

export interface DailyHours {
  Id:             string;
  Date:           string;
  RegularHours:   number;
  OvertimeHours:  number;
  ApprovalStatus: string; // "P" = pending, "" = not submitted
  IsEditable:     boolean;
  Description:    string;
  TimeCode?:      string;
}

export interface ApprovalTimeEntry {
  ProjectId:   string;
  ProjectName: string;
  TaskId:      string;
  TaskName:    string;
  TaskBillable: boolean;
  TimeCode?:      string;
  MondayHours:    DailyHours | null;
  TuesdayHours:   DailyHours | null;
  WednesdayHours: DailyHours | null;
  ThursdayHours:  DailyHours | null;
  FridayHours:    DailyHours | null;
  TotalHours:     number;
}

export interface ApprovalRecord {
  Id:                string;
  Name:              string;
  Email:             string;
  TimeEntries:       ApprovalTimeEntry[];
  GrandWeeklyTotal:  number;
  MondayHoursTotal:    number;
  TuesdayHoursTotal:   number;
  WednesdayHoursTotal: number;
  ThursdayHoursTotal:  number;
  FridayHoursTotal:    number;
}

// weekMonday: MM/DD/YYYY. filter: "PP" = past & pending (default)
export async function getTimeApprovals(
  token: string,
  weekMonday: string,
  filter = 'PP',
): Promise<ApprovalRecord[]> {
  const qs = `date=${encodeURIComponent(weekMonday)}&filter=${filter}&includeTimeOffData=true`;
  return request<ApprovalRecord[]>(token, 'GET', `/TimeApproval?${qs}`);
}

// date should be the Monday of the target week in MM/DD/YYYY format
export async function getTimeEntries(token: string, weekMonday: string): Promise<TimeEntry[]> {
  return request<TimeEntry[]>(token, 'GET', `/TimeEntry?date=${encodeURIComponent(weekMonday)}`);
}

export interface ApprovalAction {
  ResourceId:   string;
  TimeId:       string;
  ProjectId:    string;
  TaskId:       string;
  Date:         string;
  Action:       boolean;       // true = approve, false = reject
  RejectReason: string | null;
  TimeCode:     string;
}

export async function postTimeApproval(token: string, actions: ApprovalAction[]): Promise<void> {
  await request<void>(token, 'POST', '/TimeApproval', actions);
}

export async function postTimeEntry(
  token: string,
  entry: DraftEntry,
  rowIndex = 0,
  cellIndex = 0,
): Promise<string> {
  const projectId = entry.projectId ?? NON_PROJECT_TIME.projectId;
  const projectName = entry.projectName ?? NON_PROJECT_TIME.projectName;
  const taskId = entry.taskId ?? NON_PROJECT_TIME.taskId;
  const taskName = entry.taskName ?? NON_PROJECT_TIME.taskName;
  const workCodeCategoryId = entry.workCodeCategoryId ?? NON_PROJECT_TIME.workCodeCategoryId;
  const workCodeId = entry.workCodeId ?? NON_PROJECT_TIME.workCodeId;
  const workLocationGroupId = entry.workLocationGroupId ?? NON_PROJECT_TIME.workLocationGroupId;
  const workLocationId = entry.workLocationId ?? NON_PROJECT_TIME.workLocationId;
  const timeCode = entry.timeCode ?? NON_PROJECT_TIME.timeCode;

  const body = [{
    RefreshDisplayIdentifier: 0,
    Description:              entry.description ?? '',
    RegularHours:             entry.hours,
    OvertimeHours:            0,
    IsEditable:               true,
    CellIndex:                cellIndex,
    RowIndex:                 rowIndex,
    Date:                     entry.date,
    TimeCode:                 timeCode,
    TaskId:                   taskId,
    TaskName:                 taskName,
    ProjectId:                projectId,
    ProjectName:              projectName,
    IsTimekeepingTask:        false,
    WorkCodeCategoryId:       workCodeCategoryId,
    WorkCodeId:               workCodeId,
    WorkLocationGroupId:      workLocationGroupId,
    WorkLocationId:           workLocationId,
  }];

  const ids = await request<string[]>(token, 'POST', '/TimeEntry', body);
  return ids[0];
}

export async function deleteTimeEntry(token: string, id: string, record?: unknown): Promise<void> {
  const bodies = [
    record,
    record ? [record] : undefined,
    { Id: id },
    { id },
    [{ Id: id }],
    [{ id }],
  ].filter((body): body is unknown => body !== undefined);

  let lastError: unknown;
  for (const body of bodies) {
    try {
      await apiDeleteWithBody(token, '/TimeEntry', body);
      return;
    } catch (err) {
      lastError = err;
    }
  }

  throw lastError;
}
