import { config } from '../config.ts';
import { spawnJsonl, truncate } from './process.ts';
import type { Runner } from './types.ts';

function describeToolUse(name: string, input: Record<string, unknown> = {}) {
  const hint = input.command ?? input.file_path ?? input.path ?? input.pattern ?? input.url ?? input.description;
  return typeof hint === 'string' ? `${name} · ${hint}` : `${name} ${truncate(JSON.stringify(input), 300)}`;
}

function toolResultText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map((c) => (c?.type === 'text' ? c.text : `[${c?.type ?? 'content'}]`)).join('\n');
  }
  return JSON.stringify(content);
}

/** Runs `claude -p` headless and maps its stream-json output to task events. */
export const runClaude: Runner = (task, cwd, on) => {
  const args = [
    '-p',
    '--output-format', 'stream-json',
    '--verbose',
    '--permission-mode', task.permission === 'full' ? 'bypassPermissions' : 'acceptEdits',
  ];
  if (task.model) args.push('--model', task.model);

  return spawnJsonl({
    bin: config.claudeBin,
    args,
    cwd,
    stdin: task.prompt,
    on,
    onJson(msg) {
      switch (msg.type) {
        case 'system':
          if (msg.subtype === 'init') {
            if (msg.session_id) on.session(msg.session_id);
            on.event('system', `Session started · ${msg.model ?? 'default model'}`);
          }
          return;
        case 'assistant':
          for (const block of msg.message?.content ?? []) {
            if (block.type === 'text' && block.text.trim()) on.event('message', block.text);
            else if (block.type === 'tool_use') on.event('tool', describeToolUse(block.name, block.input));
          }
          return;
        case 'user':
          for (const block of msg.message?.content ?? []) {
            if (block.type === 'tool_result') {
              const text = truncate(toolResultText(block.content), 2000);
              on.event(block.is_error ? 'error' : 'tool_result', text || '(no output)');
            }
          }
          return;
        case 'result': {
          const u = msg.usage ?? {};
          on.usage({
            inputTokens: (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0),
            cachedInputTokens: u.cache_read_input_tokens ?? 0,
            outputTokens: u.output_tokens ?? 0,
            costUsd: typeof msg.total_cost_usd === 'number' ? msg.total_cost_usd : undefined,
          });
          if (typeof msg.result === 'string' && msg.result) on.summary(msg.result);
          on.event('result', `${msg.subtype ?? 'done'} · ${msg.num_turns ?? '?'} turns · ${Math.round((msg.duration_ms ?? 0) / 1000)}s`);
          if (msg.is_error) return typeof msg.result === 'string' && msg.result ? msg.result : `Claude finished with ${msg.subtype}`;
          return;
        }
      }
    },
  });
};
