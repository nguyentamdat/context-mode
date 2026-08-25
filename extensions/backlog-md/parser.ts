export type BacklogTask = {
  id: string;
  title: string;
  status: "To Do" | "In Progress" | "Done";
  priority?: string;
  type?: string;
};

const STATUSES = ["To Do", "In Progress", "Done"] as const;

export function parseTaskList(output: string): BacklogTask[] {
  let status: BacklogTask["status"] | undefined;
  const tasks: BacklogTask[] = [];
  const linePattern = /^\s*(?:\[([^\]]+)\]\s*)?(?:\[([^\]]+)\]\s*)?(TASK-\S+)\s+-\s+(.+)$/;

  for (const line of output.split(/\r?\n/)) {
    const heading = line.trim().replace(/:$/, "");
    if (STATUSES.includes(heading as (typeof STATUSES)[number])) {
      status = heading as BacklogTask["status"];
      continue;
    }
    const match = line.match(linePattern);
    if (!match || !status) continue;
    tasks.push({ id: match[3], title: match[4].trim(), status, priority: match[1], type: match[2] });
  }
  return tasks;
}
