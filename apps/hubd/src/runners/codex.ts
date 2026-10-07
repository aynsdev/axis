import { config } from '../config.ts';
import { spawnJsonl, truncate } from './process.ts';
import type { Runner } from './types.ts';

/** Runs `codex exec --json` and maps its JSONL events to task events. */
export const runCodex: Runner = (task, cwd, on) => {
  const args = ['exec', '--json', '--color', 'never', '-C', cwd];
  if (task.permission === 'full') args.push('--dangerously-bypass-approvals-and-sandbox');
  else args.push('-s', 'workspace-write');
  if (task.model) args.push('-m', task.model);
  args.push('-'); // read prompt from stdin

  let lastMessage = '';

  return spawnJsonl({
    bin: config.codexBin,
    args,
    cwd,
    stdin: task.prompt,
    on,
    onJson(msg) {
      switch (msg.type) {
        case 'thread.started':
          if (msg.thread_id) on.session(msg.thread_id);
          on.event('system', 'Session started');
          return;
        case 'item.started':
          if (msg.item?.type === 'command_execution') on.event('tool', `shell · ${msg.item.command}`);
          return;
        case 'item.completed': {
          const item = msg.item ?? {};
          switch (item.type) {
            case 'agent_message':
              lastMessage = item.text ?? '';
              if (lastMessage.trim()) on.event('message', lastMessage);
              return;
            case 'command_execution':
              on.event(
                item.exit_code && item.exit_code !== 0 ? 'error' : 'tool_result',
                truncate(item.aggregated_output || `(exit ${item.exit_code ?? '?'})`, 2000),
              );
              return;
            case 'file_change':
              on.event('tool', `edit · ${(item.changes ?? []).map((c: any) => `${c.kind} ${c.path}`).join(', ')}`);
              return;
            case 'mcp_tool_call':
              on.event('tool', `${item.server ?? 'mcp'} · ${item.tool ?? ''}`);
              return;
            case 'web_search':
              on.event('tool', `web search · ${item.query ?? ''}`);
              return;
            case 'error':
              on.event('error', item.message ?? 'Unknown error');
              return;
          }
          return;
        }
        case 'turn.completed': {
          const u = msg.usage ?? {};
          const cached = u.cached_input_tokens ?? 0;
          on.usage({
            inputTokens: Math.max(0, (u.input_tokens ?? 0) - cached),
            cachedInputTokens: cached,
            outputTokens: u.output_tokens ?? 0,
          });
          if (lastMessage) on.summary(lastMessage);
          on.event('result', 'Turn completed');
          return;
        }
        case 'turn.failed':
          return msg.error?.message ?? 'Codex turn failed';
        case 'error':
          on.event('error', msg.message ?? 'Codex error');
          return;
      }
    },
  });
};
