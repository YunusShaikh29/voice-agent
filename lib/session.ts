import { prisma } from "./prisma";

export async function getSessionContext(sessionId: string) {
  const [tasks, recentTurns] = await Promise.all([
    prisma.task.findMany({
      where: { sessionId },
      orderBy: { scheduledAt: "asc" },
    }),

    prisma.conversationTurn.findMany({
      where: { sessionId },
      orderBy: { createdAt: "desc" },
      take: 15,
    }),
  ]);

  const turns = recentTurns.reverse();

  return { tasks, turns };
}

export async function saveTurn(
  sessionId: string,
  role: "user" | "assistant",
  content: string
) {
  return prisma.conversationTurn.create({
    data: {
      sessionId,
      role,
      content,
    },
  });
}

export function buildSystemPrompt(
  tasks: Awaited<ReturnType<typeof getSessionContext>>["tasks"]
) {
  const now = new Date();

  const taskList =
    tasks.length === 0
      ? "No tasks."
      : tasks
          .map((t, i) => {
            const when = t.scheduledAt
              ? t.scheduledAt.toLocaleString()
              : "No time";

            return `${i + 1}. ${t.title} [${t.id}] ${when}`;
          })
          .join("\n");

  return `
You are a voice task assistant.

IMPORTANT:

The user's timezone is Asia/Kolkata (IST, UTC+5:30).

ALL times mentioned by the user are in IST.

When creating or updating tasks:

- NEVER use UTC.
- NEVER convert times.
- If user says 3 PM, store 3 PM IST.
- If user says 7 AM, store 7 AM IST.
- Generate ISO timestamps in Asia/Kolkata time.

Current date:
${now.toLocaleString("en-IN", {
  timeZone: "Asia/Kolkata",
})}

Current tasks:
${taskList}

Keep responses short.
`}