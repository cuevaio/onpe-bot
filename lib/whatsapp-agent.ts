import { openai } from "@ai-sdk/openai";
import { generateText, stepCountIs, tool } from "ai";
import { z } from "zod";

import type { OnpeTopCount } from "@/lib/cache";
import type { DeterministicCommandAction } from "@/lib/whatsapp-command-router";
import type { SenderState } from "@/lib/whatsapp-senders";
import {
	pauseUpdates,
	resumeUpdates,
	sendHelp,
	sendLatestChart,
	setChartPreference,
} from "@/lib/whatsapp-tools";

type ConversationMessage = {
	direction: "inbound" | "outbound";
	text: string;
};

export async function handleInboundMessageWithAgent(params: {
	phoneNumber: string;
	senderState: SenderState;
	currentMessage: string;
	recentMessages: ConversationMessage[];
}) {
	const result = await generateText({
		model: openai.chat("gpt-5.4"),
		prompt: [
			`Current sender state: active=${params.senderState.active}, preferredTopCount=${params.senderState.preferredTopCount}.`,
			`Recent conversation:\n${params.recentMessages
				.map((message) => `${message.direction}: ${message.text}`)
				.join("\n")}`,
			`Current inbound message: ${params.currentMessage}`,
		].join("\n\n"),
		system:
			[
				"You route a WhatsApp ONPE bot.",
				"Always call exactly one tool.",
				"Treat short commands as valid, not ambiguous.",
				"Examples that MUST map to set_chart_preference: 'top 5', 'top5', 'quiero top 5', 'quiero recibir el top 5', 'mandame el top 5', 'top 3', 'top3'.",
				"Examples that MUST map to send_latest_chart: 'ultimo chart', 'latest chart', 'manda el chart', 'envia la imagen'.",
				"Examples that MUST map to pause_updates: 'pausa', 'stop', 'no quiero updates', 'deja de enviar'.",
				"Examples that MUST map to resume_updates: 'reactiva', 'reanuda', 'resume', 'quiero updates otra vez'.",
				"Use send_help only when the user is explicitly asking what the bot can do or asking for instructions/help.",
				"Examples that MUST map to send_help: 'que puedes hacer?', 'ayuda', 'help', 'como funciona?', 'que comandos hay?'.",
				"If the message is vague but still mentions top 3, top 5, pausing, resuming, or charts, do not use send_help; choose the closest action tool.",
				"Do not use send_help for clear commands like 'top 5'.",
			].join(" "),
		stopWhen: stepCountIs(1),
		toolChoice: "required",
		tools: {
			pause_updates: tool({
				description:
					"Use when the user wants to stop receiving automatic updates. Examples: 'pausa', 'stop', 'no quiero updates', 'deja de enviar'.",
				inputSchema: z.object({}),
				strict: true,
				execute: async () => {
					await pauseUpdates(params.phoneNumber);
					return { action: "paused" };
				},
			}),
			resume_updates: tool({
				description:
					"Use when the user wants to receive automatic updates again. Examples: 'reactiva', 'reanuda', 'resume', 'quiero updates otra vez'.",
				inputSchema: z.object({}),
				strict: true,
				execute: async () => {
					await resumeUpdates(
						params.phoneNumber,
						params.senderState.preferredTopCount,
					);
					return { action: "resumed" };
				},
			}),
			send_latest_chart: tool({
				description:
					"Use when the user asks for the current image/chart without changing preference. Examples: 'ultimo chart', 'latest chart', 'manda el chart', 'envia la imagen'.",
				inputSchema: z.object({}),
				strict: true,
				execute: async () => {
					await sendLatestChart(
						params.phoneNumber,
						params.senderState.preferredTopCount,
					);
					return { action: "sent_latest_chart" };
				},
			}),
			set_chart_preference: tool({
				description:
					"Use when the user asks for top 3 or top 5. This updates preferred_top_count and immediately sends that variant. Examples: 'top 5', 'top5', 'quiero top 5', 'quiero recibir el top 5', 'mandame top 5', 'top 3', 'top3'.",
				inputSchema: z.object({
					topCount: z.union([z.literal(3), z.literal(5)]),
				}),
				strict: true,
				execute: async ({ topCount }) => {
					await setChartPreference(params.phoneNumber, topCount as OnpeTopCount);
					return { action: "set_chart_preference", topCount };
				},
			}),
			send_help: tool({
				description:
					"Use only when the user explicitly asks what the bot can do or asks for help/instructions. Examples: 'que puedes hacer?', 'ayuda', 'help', 'como funciona?', 'que comandos hay?'. Do not use for top 3, top 5, pause/resume, or latest chart requests.",
				inputSchema: z.object({}),
				strict: true,
				execute: async () => {
					await sendHelp(params.phoneNumber);
					return { action: "sent_help" };
				},
			}),
		},
	});

	const selectedTool = result.steps
		.flatMap((step) => step.toolCalls)
		.at(-1);

	if (!selectedTool) {
		return { type: "none" } satisfies DeterministicCommandAction;
	}

	if (selectedTool.toolName === "set_chart_preference") {
		const topCount =
			typeof selectedTool.input === "object" &&
			selectedTool.input !== null &&
			"topCount" in selectedTool.input &&
			(selectedTool.input as { topCount?: unknown }).topCount === 5
				? 5
				: 3;

		return {
			type: "set_chart_preference",
			topCount,
		} satisfies DeterministicCommandAction;
	}

	if (selectedTool.toolName === "pause_updates") {
		return { type: "pause_updates" } satisfies DeterministicCommandAction;
	}

	if (selectedTool.toolName === "resume_updates") {
		return { type: "resume_updates" } satisfies DeterministicCommandAction;
	}

	if (selectedTool.toolName === "send_latest_chart") {
		return { type: "send_latest_chart" } satisfies DeterministicCommandAction;
	}

	if (selectedTool.toolName === "send_help") {
		return { type: "send_help" } satisfies DeterministicCommandAction;
	}

	return { type: "none" } satisfies DeterministicCommandAction;
}
