#!/usr/bin/env node
import { Command } from 'commander';
import { registerChapter } from './commands/chapter.js';
import { registerCheck } from './commands/check.js';
import { registerEntries } from './commands/entries.js';
import { registerInit } from './commands/init.js';
import { registerOutline } from './commands/outline.js';
import { registerPack } from './commands/pack.js';
import { TOOL } from './constants.js';
import { MoxianError } from './core/errors.js';

const program = new Command();

program
  .name(TOOL.name)
  .description(
    `${TOOL.display}：面向中文长篇创作的连续性内核。管伏笔、人物、时间线、设定与大纲，按章给 agent 递料`,
  )
  .version(TOOL.version, '-v, --版本', '显示版本号')
  .helpOption('-h, --help', '显示帮助')
  .addHelpCommand('help [子命令]', '显示某个子命令的帮助')
  .showHelpAfterError('（加 --help 看用法）')
  .showSuggestionAfterError(true);

registerInit(program);
registerChapter(program);
registerEntries(program);
registerOutline(program);
registerCheck(program);
registerPack(program);

try {
  await program.parseAsync(process.argv);
} catch (error) {
  if (error instanceof MoxianError) {
    process.stderr.write(`错误：${error.message}\n`);
    process.exit(error.exitCode);
  }
  if (error instanceof Error) {
    process.stderr.write(`内部错误：${error.message}\n`);
    if (process.env.MOXIAN_DEBUG) process.stderr.write(`${error.stack ?? ''}\n`);
    process.exit(1);
  }
  throw error;
}
