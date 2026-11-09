import test from "node:test";
import assert from "node:assert/strict";
import AIService from "../src/core/AIService";
import { toolSchemasForModel } from "../src/core/tools/ToolSchemas";
import { registerEnvironmentTools } from "../src/core/orchestrator/EnvironmentTools";
import WorkspaceEngine from "../src/core/workspace/WorkspaceEngine";
import AIProviderRegistry from "../src/core/AIProviderRegistry";
import type { AIProvider, AIRequest, AIResponse } from "../src/providers/AIProvider";
import ProviderResolver from "../src/core/router/ProviderResolver";
import type RouterContext from "../src/core/router/RouterContext";

class TestModelProvider implements AIProvider {
  readonly id = "test-provider";
  readonly name = "Test Autonomous Provider";
  readonly supportsTools = true;
  private turnCount = 0;

  async generate(request: AIRequest): Promise<AIResponse> {
    this.turnCount++;
    const msgs = request.messages ?? [];
    const lastMsg = msgs[msgs.length - 1];

    if (lastMsg && lastMsg.role === "tool") {
      // Returned from tool execution
      return {
        text: `I have successfully executed ${lastMsg.toolName} and inspected the resulting environment: ${lastMsg.content}. The operational workspace is ready.`,
      };
    }

    // First turn: model inspects user intent and decides to call environment_compose
    return {
      text: "I will set up an autonomous research environment for your CRISPR analysis.",
      toolCalls: [
        {
          id: "call_abc123",
          name: "environment_compose",
          arguments: {
            title: "CRISPR-Cas9 Clinical Exploration",
            category: "research",
            prompt: "Research on CRISPR mechanisms and primary sources",
            layout: "split",
          },
        },
      ],
    };
  }

  async healthCheck() {
    return { status: "healthy" as const, latency: 1 };
  }
}

test("Live Model Tool-Calling Pathway: Real Provider Loop selects and runs environment tools", async () => {
  registerEnvironmentTools();
  const workspace = WorkspaceEngine.getInstance();
  workspace.clear();

  const provider = new TestModelProvider();
  const resolver = new ProviderResolver();

  const context: RouterContext = {
    request: {
      prompt: "Research CRISPR clinical trial mechanisms and show me the data in a split workspace.",
      allowTools: true,
      messages: [
        {
          role: "user",
          content: "Research CRISPR clinical trial mechanisms and show me the data in a split workspace.",
        },
      ],
      timestamp: Date.now(),
    },
    started: Date.now(),
    logger: {
      info: () => {},
      warn: () => {},
      error: () => {},
    } as any,
  };

  // Run through generateWithTools via execute
  const toolsReallyRun: Array<{ tool: string; ok: boolean }> = [];
  const response = await (resolver as any).generateWithTools(provider, context, toolsReallyRun);

  assert.ok(response.text);
  assert.match(response.text, /successfully executed environment_compose/);
  assert.equal(toolsReallyRun.length, 1);
  assert.equal(toolsReallyRun[0].tool, "environment_compose");
  assert.equal(toolsReallyRun[0].ok, true);

  // Verify actual Genesis/Cosmos workspace effect
  const wsState = workspace.getState();
  assert.equal(wsState.views.length >= 2, true);
  assert.equal(wsState.layout, "split");
});
