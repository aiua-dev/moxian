import { readFile } from 'node:fs/promises';
import * as path from 'node:path';
import type { Command } from 'commander';
import { MoxianError } from '../core/errors.js';
import { normalizeChapter } from '../core/ids.js';
import { findVolume, saveWork } from '../core/project.js';
import { readOutline, readOutlineDoc, writeOutline } from '../core/store.js';
import type { OutlineMeta } from '../domain/schema.js';
import { collectList, loadDataset, parseVolume, say, unique } from './shared.js';

const MASTER_OUTLINE = '总纲.md';

export function registerOutline(program: Command): void {
  registerVolume(program);
  registerOutlineCommands(program);
}

function registerVolume(program: Command): void {
  const group = program.command('卷').description('卷册结构，存在 作品.yaml 里');

  group
    .command('添加')
    .description('加一卷')
    .requiredOption('--序号 <序号>', '卷号，从 1 开始')
    .requiredOption('--名 <名>', '卷名')
    .action(async (options: { 序号: string; 名: string }) => {
      const dataset = await loadDataset();
      const order = parseVolume(options.序号, '序号');
      if (findVolume(dataset.project, order)) {
        throw new MoxianError(`第 ${order} 卷已经在册了。`, 2);
      }
      const volumes = [...dataset.project.work.卷, { 序号: order, 名: options.名 }].sort(
        (a, b) => a.序号 - b.序号,
      );
      await saveWork({ ...dataset.project, work: { ...dataset.project.work, 卷: volumes } });
      say(`已加第 ${order} 卷「${options.名}」。`);
    });

  group
    .command('列表')
    .description('列出卷册')
    .action(async () => {
      const dataset = await loadDataset();
      if (dataset.project.work.卷.length === 0) {
        say('还没有登记任何卷。');
        return;
      }
      for (const item of dataset.project.work.卷) {
        const outline = dataset.outlines.find((outlineItem) => outlineItem.volume === item.序号);
        const chapters = dataset.chapters.filter((chapter) =>
          chapter.chapter.startsWith(`${item.序号}-`),
        );
        const plan = outline ? outline.meta.规划.length : 0;
        say(
          `第 ${item.序号} 卷  ${item.名}   已写 ${chapters.length} 章   大纲规划 ${plan} 章`,
        );
      }
    });
}

function registerOutlineCommands(program: Command): void {
  const group = program.command('大纲').description('卷大纲与总纲');

  group
    .command('设置')
    .description('写一卷的大纲。不给 --正文文件 就保留原来的正文')
    .requiredOption('--卷 <卷>', '卷号')
    .option('--名 <名>', '卷名，默认沿用 作品.yaml 里的')
    .option('--规划 <章号>', '这一卷打算写哪些章，逗号分隔', collectList, [])
    .option('--正文文件 <路径>', '大纲正文从这个文件读')
    .action(
      async (options: { 卷: string; 名?: string; 规划: string[]; 正文文件?: string }) => {
        const dataset = await loadDataset();
        const volume = parseVolume(options.卷);
        const registered = findVolume(dataset.project, volume);
        if (!registered) {
          throw new MoxianError(`第 ${volume} 卷不在册。先用「卷 添加 --序号 ${volume}」登记。`, 2);
        }

        const existing = dataset.outlines.find((item) => item.volume === volume) ?? null;
        const planned =
          options.规划.length > 0
            ? unique(options.规划.map((item) => normalizeChapter(item)))
            : (existing?.meta.规划 ?? []);
        const body = options.正文文件
          ? await readFile(path.resolve(options.正文文件), 'utf8')
          : (existing?.body ?? '');

        const meta: OutlineMeta = {
          卷: volume,
          名: options.名 ?? existing?.name ?? registered.名,
          规划: planned,
        };

        const file = await writeOutline(dataset.project, meta, body);
        say(`已写第 ${volume} 卷大纲：${path.relative(dataset.project.root, file)}`);
        if (planned.length > 0) say(`  规划 ${planned.length} 章：${planned.join('、')}`);
      },
    );

  group
    .command('查')
    .description('看大纲。不带 --卷 就列个清单')
    .option('--卷 <卷>', '看哪一卷的全文')
    .action(async (options: { 卷?: string }) => {
      const dataset = await loadDataset();

      if (!options.卷) {
        if (dataset.outlines.length === 0) {
          say('还没有写过任何卷大纲。');
          return;
        }
        for (const item of dataset.outlines) {
          say(`第 ${item.volume} 卷  ${item.name}   规划 ${item.meta.规划.length} 章`);
        }
        return;
      }

      const volume = parseVolume(options.卷);
      const outline = await readOutline(dataset.project, volume);
      if (!outline) {
        throw new MoxianError(`第 ${volume} 卷还没有大纲。先用「大纲 设置 --卷 ${volume}」。`, 2);
      }
      say(`# 第 ${outline.volume} 卷 ${outline.name}`);
      if (outline.meta.规划.length > 0) {
        say(`规划：${outline.meta.规划.join('、')}`);
      }
      say('');
      say(outline.body.trim() || '（正文还是空的）');
    });

  group
    .command('总纲')
    .description('打印 总纲.md，这份文件 CLI 只读不解析')
    .action(async () => {
      const dataset = await loadDataset();
      const text = await readOutlineDoc(dataset.project, MASTER_OUTLINE);
      if (text === null) {
        say(`还没有 ${MASTER_OUTLINE}。`);
        return;
      }
      process.stdout.write(text.endsWith('\n') ? text : `${text}\n`);
    });
}
