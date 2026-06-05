import { prisma } from "@/lib/prisma";


export const toolDefinitions = [
  {
    type: "function" as const,
    function: {
      name: "createTask",
      description:
        "Create a new task. Use this when the user wants to add a task or reminder.",
      parameters: {
        type: "object",
        properties: {
          title: {
            type: "string",
            description: "Short description of the task",
          },
          scheduledAt: {
            type: "string",
            description:
              "ISO 8601 datetime string for when the task is scheduled. Omit if no time mentioned.",
          },
        },
        required: ["title"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "getTasks",
      description:
        "Retrieve tasks for the session. Optionally filter by a time window.",
      parameters: {
        type: "object",
        properties: {
          filter: {
            type: "string",
            enum: ["today", "tomorrow", "morning", "afternoon", "evening", "all"],
            description: "Time-based filter. Default is 'all'.",
          },
        },
        required: [],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "updateTask",
      description:
        "Update an existing task's title or scheduled time. Use the task id from the current task list.",
      parameters: {
        type: "object",
        properties: {
          id: {
            type: "string",
            description: "The task id to update",
          },
          title: {
            type: "string",
            description: "New title (omit to keep existing)",
          },
          scheduledAt: {
            type: "string",
            description: "New ISO 8601 datetime (omit to keep existing)",
          },
        },
        required: ["id"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "deleteTask",
      description:
        "Delete a task by id. Only call this after the user has confirmed the deletion.",
      parameters: {
        type: "object",
        properties: {
          id: {
            type: "string",
            description: "The task id to delete",
          },
        },
        required: ["id"],
      },
    },
  },
];


type ToolResult = {
  success: boolean;
  message: string;
  data?: unknown;
};

export async function executeTool(
  sessionId: string,
  toolName: string,
  args: Record<string, unknown>
): Promise<ToolResult> {
  try {
    switch (toolName) {
      case "createTask": {
        const title = String(args.title);

        const scheduledAt = args.scheduledAt
          ? new Date(
            new Date(String(args.scheduledAt)).toLocaleString("en-US", {
              timeZone: "Asia/Kolkata",
            })
          )
          : null;

        const existing = await prisma.task.findFirst({
          where: {
            sessionId,
            title,
          },
          orderBy: {
            createdAt: "desc",
          },
        });

        if (
          existing &&
          Date.now() - existing.createdAt.getTime() < 30000
        ) {
          console.log(
            "[createTask] prevented duplicate:",
            title
          );

          console.log(
            "[TOOL]",
            toolName,
            JSON.stringify(args, null, 2)
          );


          return {
            success: true,
            message: "Task already exists.",
            data: existing,
          };
        }

        const task = await prisma.task.create({
          data: {
            sessionId,
            title,
            scheduledAt,
          },
        });

        console.log(
          "[createTask] created:",
          task.title,
          task.scheduledAt
        );

        console.log(
          "[TIME RECEIVED]",
          args.scheduledAt
        );

        return {
          success: true,
          message: "Task created",
          data: task,
        };
      }

      case "getTasks": {
        const filter = (args.filter as string) ?? "all";
        const now = new Date();

        let where: { sessionId: string; scheduledAt?: { gte: Date; lt: Date } } =
          { sessionId };

        if (filter !== "all") {
          const today = new Date(now);
          today.setHours(0, 0, 0, 0);
          const tomorrow = new Date(today);
          tomorrow.setDate(tomorrow.getDate() + 1);
          const dayAfter = new Date(tomorrow);
          dayAfter.setDate(dayAfter.getDate() + 1);

          const timeRanges: Record<string, { gte: Date; lt: Date }> = {
            today: { gte: today, lt: tomorrow },
            tomorrow: { gte: tomorrow, lt: dayAfter },
            morning: {
              gte: new Date(today.setHours(5, 0, 0, 0)),
              lt: new Date(today.setHours(12, 0, 0, 0)),
            },
            afternoon: {
              gte: new Date(today.setHours(12, 0, 0, 0)),
              lt: new Date(today.setHours(17, 0, 0, 0)),
            },
            evening: {
              gte: new Date(today.setHours(17, 0, 0, 0)),
              lt: new Date(today.setHours(23, 59, 59, 0)),
            },
          };

          if (timeRanges[filter]) {
            where = { sessionId, scheduledAt: timeRanges[filter] };
          }
        }

        const tasks = await prisma.task.findMany({
          where,
          orderBy: { scheduledAt: "asc" },
        });

        console.log(
          "[TOOL]",
          toolName,
          JSON.stringify(args, null, 2)
        );


        return {
          success: true,
          message: `Found ${tasks.length} task(s)`,
          data: tasks,
        };
      }

      case "updateTask": {
        const existing = await prisma.task.findFirst({
          where: { id: args.id as string, sessionId },
        });

        if (!existing) {
          return { success: false, message: "Task not found" };
        }

        const updated = await prisma.task.update({
          where: { id: args.id as string },
          data: {
            ...(args.scheduledAt
              ? {
                scheduledAt: new Date(
                  new Date(args.scheduledAt as string).toLocaleString(
                    "en-US",
                    {
                      timeZone: "Asia/Kolkata",
                    }
                  )
                ),
              }
              : {}),
          },
        });

        console.log(
          "[TOOL]",
          toolName,
          JSON.stringify(args, null, 2)
        );

        console.log(
          "[TIME RECEIVED]",
          args.scheduledAt
        );

        return {
          success: true,
          message: `Task updated: "${updated.title}"`,
          data: updated,
        };
      }

      case "deleteTask": {
        const existing = await prisma.task.findFirst({
          where: { id: args.id as string, sessionId },
        });

        if (!existing) {
          return { success: false, message: "Task not found" };
        }

        await prisma.task.delete({ where: { id: args.id as string } });

        console.log(
          "[TOOL]",
          toolName,
          JSON.stringify(args, null, 2)
        );


        return {
          success: true,
          message: `Task deleted: "${existing.title}"`,
        };
      }

      default:
        return { success: false, message: `Unknown tool: ${toolName}` };
    }
  } catch (err) {
    console.error(`Tool error [${toolName}]:`, err);
    return { success: false, message: "Something went wrong executing the tool" };
  }
}