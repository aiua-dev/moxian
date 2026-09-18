import type { Command } from 'commander';
import { createProject } from '../core/scaffold.js';
import { say } from './shared.js';

export function registerInit(program: Command): void {
  program
    .command('初始化')
    .description('在空目录里建一部作品的骨架。作品目录要与代码仓库分开')
    .argument('<目录>', '作品根目录，必须是空目录')
    .requiredOption('--书名 <书名>', '作品名')
    .option('--作者 <作者>', '作者名')
    .action(async (target: string, options: { 书名: string; 作者?: string }) => {
      const root = await createProject(target, options.书名, options.作者);
      say(`已经在 ${root} 建好作品《${options.书名}》。`);
      say('');
      say('目录结构：');
      say('  作品.yaml        作品信息与卷册');
      say('  正文/            一章一个 Markdown 文件');
      say('  大纲/            总纲与各卷大纲');
      say('  连续性/          伏笔、人物、时间线、设定');
      say('');
      say('下一步：');
      say('  章 新建 --卷 1 --标题 第一章的标题');
      say('  校验');
    });
}
