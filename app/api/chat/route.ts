import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";

import {
  getSessionContext,
  saveTurn,
  buildSystemPrompt,
} from "@/lib/session";

import {
  toolDefinitions,
  executeTool,
} from "@/tools";

const openai = new OpenAI({
  baseURL: "https://api.generalcompute.com",
  apiKey: process.env.GENERAL_COMPUTE_API_KEY!,
});

// Prevent duplicate requests from same session
const activeSessions = new Set<string>();

export async function POST(req: NextRequest) {
  let sessionId = "";

  try {
    const body = await req.json();

    sessionId = body.sessionId;
    const message = body.message;

    if (!sessionId || !message) {
      return NextResponse.json(
        {
          error: "sessionId and message are required",
        },
        {
          status: 400,
        }
      );
    }

    // Prevent double-submission
    if (activeSessions.has(sessionId)) {
      return NextResponse.json({
        reply: "Still processing your previous request.",
      });
    }

    activeSessions.add(sessionId);

    // Load context
    const { tasks, turns } =
      await getSessionContext(sessionId);

    const messages: OpenAI.Chat.ChatCompletionMessageParam[] =
      [
        {
          role: "system",
          content: buildSystemPrompt(tasks),
        },

        ...turns.map((turn) => ({
          role: turn.role as "user" | "assistant",
          content: turn.content,
        })),

        {
          role: "user",
          content: message,
        },
      ];

    // First model call
    const response =
      await openai.chat.completions.create({
        model: "minimax-m2.7",
        messages,
        tools: toolDefinitions,
        tool_choice: "auto",
      });

    let assistantMessage =
      response.choices[0].message;

    let finalReply =
      assistantMessage.content ?? "";

    // Handle ALL tool calls
    while (
      assistantMessage.tool_calls &&
      assistantMessage.tool_calls.length > 0
    ) {
     const toolCall = assistantMessage.tool_calls[0] as {
  id: string;
  function: {
    name: string;
    arguments: string;
  };
};

const toolName = toolCall.function.name;

const toolArgs = JSON.parse(
  toolCall.function.arguments
) as Record<string, unknown>;

      const result = await executeTool(
        sessionId,
        toolName,
        toolArgs
      );

      messages.push(
        assistantMessage as OpenAI.Chat.ChatCompletionAssistantMessageParam
      );

      messages.push({
        role: "tool",
        tool_call_id: toolCall.id,
        content: JSON.stringify(result),
      });

      const followUp =
        await openai.chat.completions.create({
          model: "minimax-m2.7",
          messages,
          tools: toolDefinitions,
          tool_choice: "auto",
        });

      assistantMessage =
        followUp.choices[0].message;
    }

    finalReply =
      assistantMessage.content ?? "Done.";

    // Save conversation
    await Promise.all([
      saveTurn(
        sessionId,
        "user",
        message
      ),

      saveTurn(
        sessionId,
        "assistant",
        finalReply
      ),
    ]);

    // Return latest tasks
    const { tasks: updatedTasks } =
      await getSessionContext(sessionId);

    return NextResponse.json({
      reply: finalReply,
      tasks: updatedTasks,
    });
  } catch (err) {
    console.error(
      "/api/chat error:",
      err
    );

    return NextResponse.json(
      {
        error: "Internal server error",
      },
      {
        status: 500,
      }
    );
  } finally {
    if (sessionId) {
      activeSessions.delete(sessionId);
    }
  }
}