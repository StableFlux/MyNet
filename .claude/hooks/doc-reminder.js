#!/usr/bin/env node
/**
 * PreToolUse hook invoked before every Bash tool call.
 * When the command is a git commit, inspects the staged diff and surfaces a
 * reminder if user-facing code files are staged without README.md or docs/
 * being staged alongside. Never blocks — just surfaces context.
 */
const { execSync } = require('child_process')

const CODE_RE = /^site\/(backend\/(routers|services|models)|frontend\/src\/(pages|components))\//
const DOC_RE  = /^(README\.md|docs\/)/

let raw = ''
process.stdin.on('data', (c) => { raw += c })
process.stdin.on('end', () => {
  let input
  try { input = JSON.parse(raw || '{}') } catch { process.exit(0) }

  const cmd = input?.tool_input?.command || ''
  if (!/\bgit\s+commit\b/.test(cmd)) { process.exit(0) }

  let staged = ''
  try {
    staged = execSync('git diff --cached --name-only', { encoding: 'utf8' })
  } catch { process.exit(0) }

  const lines = staged.split(/\r?\n/).filter(Boolean)
  const code  = lines.filter((l) => CODE_RE.test(l))
  const docs  = lines.filter((l) => DOC_RE.test(l))

  if (code.length === 0 || docs.length > 0) { process.exit(0) }

  const filesList = code.map((f) => `  ${f}`).join('\n')
  const msg =
    `Committing code changes without updating docs:\n${filesList}\n\n` +
    `Consider whether README.md or docs/ need updating to reflect these user-facing changes.`

  process.stdout.write(JSON.stringify({
    systemMessage: msg,
    hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext: msg },
  }))
  process.exit(0)
})
