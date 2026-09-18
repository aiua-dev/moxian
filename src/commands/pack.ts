import { writeFile } from 'node:fs/promises';
import * as path from 'node:path';
import type { Command } from 'commander';
import { MoxianError } from '../core/errors.js';
import { normalizeChapter } from '../core/ids.js';
import { renderPack } from '../core/pack.js';
import { loadDataset, say } from './shared.js';

export function registerPack(program: Command): void {
  program
    .command('打包')
    .description('输出写这一章所需的全部上下文，直接喂给 agent')
    .argument('<章号>', '要写的章，例如 1-04')
    .option('--最近 <数量>', '带最近几章概要', '3')
    .option('--输出 <路径>', '写到文件，不给就打到屏幕')
    .action(async (chapterInput: string, options: { 最近: string; 输出?: string }) => {
      const dataset = await loadDataset();
      const chapterNo = normalizeChapter(chapterInput);
      const recent = Number.parseInt(options.最近, 10);
      if (!Number.isInteger(recent) || recent < 0) {
        throw new MoxianError(`--最近 要一个不小于 0 的整数，收到「${options.最近}」。`, 2);
      }

      const markdown = renderPack(dataset, chapterNo, recent);

      if (options.输出) {
        const target = path.resolve(options.输出);
        await writeFile(target, markdown, 'utf8');
        say(`已写到 ${target}`);
        return;
      }
      process.stdout.write(markdown.endsWith('\n') ? markdown : `${markdown}\n`);
    });
}
