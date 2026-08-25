import { parseTaskList } from "./parser.ts";

const tasks = parseTaskList(`To Do:
  [HIGH] [feature] TASK-26 - Build extension
In Progress:
  [MEDIUM] [task] TASK-7 - Test
Done:
  TASK-1 - Old task`);

if (tasks.length !== 3) throw new Error(`expected 3 tasks, got ${tasks.length}`);
if (tasks[0].priority !== "HIGH" || tasks[0].type !== "feature") throw new Error("priority/type parsing failed");
if (tasks[1].status !== "In Progress" || tasks[2].status !== "Done") throw new Error("status parsing failed");
console.log("backlog-md parser smoke: ok");
