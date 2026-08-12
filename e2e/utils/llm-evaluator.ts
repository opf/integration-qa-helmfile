import { logInfo, logWarn, logError } from './logger';
import { getErrorMessage } from './error-utils';

export interface ToolDefinition {
  name: string;
  description?: string;
  inputSchema?: object;
}

export interface EvaluationResult {
  expectedTool: string;
  actualTool: string | null;
  correct: boolean;
  reasoning: string;
  skipped?: boolean;
}

const LLM_BASE_URL = process.env.LLM_STACK_URL || 'https://llm-stack.openproject-edge.eu/v1';
const LLM_API_KEY = process.env.LLM_STACK_API_KEY || '';
const LLM_MODEL = process.env.LLM_MODEL || 'Llama-3.3-70b-instruct';

export async function evaluateToolChoice(
  prompt: string,
  tools: ToolDefinition[],
  expectedToolName: string
): Promise<EvaluationResult> {
  if (!LLM_API_KEY) {
    logWarn('[LLM Eval] Skipping evaluation: LLM_STACK_API_KEY is not set');
    return {
      expectedTool: expectedToolName,
      actualTool: null,
      correct: false,
      reasoning: 'Skipped: LLM_STACK_API_KEY not configured',
      skipped: true,
    };
  }

  const openaiTools = tools.map((t) => ({
    type: 'function' as const,
    function: {
      name: t.name,
      description: t.description || '',
      parameters: t.inputSchema || {},
    },
  }));

  try {
    const response = await fetch(`${LLM_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${LLM_API_KEY}`,
      },
      body: JSON.stringify({
        model: LLM_MODEL,
        messages: [
          {
            role: 'system',
            content: 'You are an AI assistant using tools to help the user. Select the single best tool for the user request.',
          },
          {
            role: 'user',
            content: prompt,
          },
        ],
        tools: openaiTools,
        tool_choice: 'auto',
        max_tokens: 300,
        temperature: 0.1,
      }),
    });

    if (response.status === 429) {
      logWarn('[LLM Eval] Rate limited (429) by Scaleway LLM stack');
      return {
        expectedTool: expectedToolName,
        actualTool: null,
        correct: false,
        reasoning: 'Skipped due to 429 rate limit',
        skipped: true,
      };
    }

    if (!response.ok) {
      const errorText = await response.text();
      logError(`[LLM Eval] Scaleway API error ${response.status}: ${errorText}`);
      return {
        expectedTool: expectedToolName,
        actualTool: null,
        correct: false,
        reasoning: `HTTP ${response.status}: ${errorText}`,
      };
    }

    const data = await response.json() as {
      choices?: Array<{
        message?: {
          tool_calls?: Array<{
            function?: {
              name?: string;
            };
          }>;
        };
      }>;
    };

    const toolCall = data.choices?.[0]?.message?.tool_calls?.[0];
    const actualTool = toolCall?.function?.name || null;
    const correct = actualTool === expectedToolName;

    logInfo(`[LLM Eval] Prompt: "${prompt}" | Expected: "${expectedToolName}" | Actual: "${actualTool}" | Correct: ${correct}`);

    return {
      expectedTool: expectedToolName,
      actualTool,
      correct,
      reasoning: correct
        ? `Model correctly selected tool '${actualTool}'`
        : `Model selected '${actualTool}' instead of '${expectedToolName}'`,
    };
  } catch (error: unknown) {
    const msg = getErrorMessage(error);
    logError('[LLM Eval] Request error:', msg);
    return {
      expectedTool: expectedToolName,
      actualTool: null,
      correct: false,
      reasoning: `Request failed: ${msg}`,
    };
  }
}
