import { basename } from 'path';
import { NativeRuntime } from './types.js';

export function commandWords(command: string): string[] {
  const words: string[] = [];
  let current = '';
  let quote = '';
  let escaped = false;
  for (const character of command.trim()) {
    if (escaped) {
      current += character;
      escaped = false;
    } else if (character === '\\' && quote !== "'") {
      escaped = true;
    } else if (quote) {
      if (character === quote) quote = '';
      else current += character;
    } else if (character === "'" || character === '"') {
      quote = character;
    } else if (/\s/.test(character)) {
      if (current) words.push(current);
      current = '';
    } else {
      current += character;
    }
  }
  if (escaped) current += '\\';
  if (quote) throw new Error('runtime command has an unterminated quote');
  if (current) words.push(current);
  return words;
}

export function runtimeFor(command: string): NativeRuntime | 'claude' | 'unknown' {
  const executable = basename(commandWords(command)[0] || '').toLowerCase();
  if (executable === 'claude' || executable === 'claude-code') return 'claude';
  if (executable === 'codex') return 'codex';
  if (executable === 'opencode') return 'opencode';
  if (executable === 'kimi' || executable === 'kimi-code') return 'kimi';
  return 'unknown';
}

export function executableFor(command: string, fallback: string): string {
  return commandWords(command)[0] || fallback;
}

export function optionValue(command: string, names: string[]): string {
  const words = commandWords(command);
  for (let index = 1; index < words.length; index += 1) {
    const word = words[index];
    if (names.includes(word)) return words[index + 1] || '';
    for (const name of names) {
      if (word.startsWith(`${name}=`)) return word.slice(name.length + 1);
    }
  }
  return '';
}

export function hasOption(command: string, names: string[]): boolean {
  return commandWords(command).some(
    (word) => names.includes(word) || names.some((name) => word.startsWith(`${name}=`)),
  );
}
