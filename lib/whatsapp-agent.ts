import { openai } from "@ai-sdk/openai";
import { generateText, stepCountIs, tool } from "ai";
import { z } from "zod";

import type { OnpeTopCount } from "@/lib/cache";
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
	await generateText({
		model: openai.chat("gpt-5.4"),
		prompt: [
			`Current sender state: active=${params.senderState.active}, preferredTopCount=${params.senderState.preferredTopCount}.`,
			`Recent conversation:\n${params.recentMessages
				.map((message) => `${message.direction}: ${message.text}`)
				.join("\n")}`,
			`Current inbound message: ${params.currentMessage}`,
		].join("\n\n"),
		system:
			"You route a WhatsApp ONPE bot. Always use one tool. Use the full conversation context. If the user wants to pause updates, use pause_updates. If they want to resume updates, use resume_updates. If they ask for the latest chart, use send_latest_chart. If they want top 3 or top 5, use set_chart_preference with the right topCount. If the request is unclear or not text-friendly, use send_help. Do not answer without a tool.",
		stopWhen: stepCountIs(1),
		tools: {
			pause_updates: tool({
				description:
					"Pause future broadcasts for this sender and send the fixed paused confirmation.",
				inputSchema: z.object({}),
				strict: true,
				execute: async () => {
					await pauseUpdates(params.phoneNumber);
					return { action: "paused" };
				},
			}),
			resume_updates: tool({
				description:
					"Resume future broadcasts and immediately send the latest chart using the stored preference.",
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
					"Send the latest chart immediately without changing broadcast preferences.",
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
					"Persist the chart preference as top 3 or top 5 and immediately send that chart variant.",
				inputSchema: z.object({
					topCount: z.union([z.literal(3), z.literal(5)]),
				}),
				strict: true,
				execute: async ({ topCount }) => {
					await setChartPreference(
						params.phoneNumber,
						topCount as OnpeTopCount,
					);
					return { action: "set_chart_preference", topCount };
				},
			}),
			send_help: tool({
				description: "Send the fixed help/configuration message.",
				inputSchema: z.object({}),
				strict: true,
				execute: async () => {
					await sendHelp(params.phoneNumber);
					return { action: "sent_help" };
				},
			}),
		},
	});
}
