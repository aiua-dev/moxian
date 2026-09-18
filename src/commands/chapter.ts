import { readFile } from 'node:fs/promises';
import * as path from 'node:path';
import type { Command } from 'commander';
import { MoxianError } from '../core/errors.js';
import { normalizeChapter, normalizeEntryId, splitChapter } from '../core/ids.js';
import { findVolume } from '../core/project.js';
import { writeChapter, writeEntries, type Chapter } from '../core/store.js';
import { validateDataset } from '../core/validate.js';
import type { ChapterMeta } from '../domain/schema.js';
import {
  blockIfNewHardErrors,
  collect,
  collectList,
  countCharacters,
  loadDataset,
  parseVolume,
  resolvePerson,
  resolveSetting,
  say,
  unique,
} from './shared.js';

const KNOWLEDGE_STATES = ['不知', '存疑', '已知', '误信'] as const;
type KnowledgeState = (typeof KNOWLEDGE_STATES)[number];

interface NewOptions {
  标题: string;
  卷: string;
  章?: string;
  摘要?: string;
  正文文件?: string;
}

interface EditOptions {
  标题?: string;
  摘要?: string;
  叙事序?: string;
}

interface LogOptions {
  埋: string[];
  收: string[];
  事件: string[];
  认知: string[];
  关系: string[];
}

export function registerChapter(program: Command): void {
  const group = program.command('章').description('章节：新建、登记、改、显示、列表');

  group
    .command('新建')
    .description('新建一章。章号按该卷已有的最大章号往下排')
    .requiredOption('--标题 <标题>', '章标题')
    .option('--卷 <卷>', '卷号', '1')
    .option('--章 <章号>', '手动指定章号，例如 1-03')
    .option('--摘要 <摘要>', '一句话概要，打包时优先用它')
    .option('--正文文件 <路径>', '从文件读入正文内容')
    .action(async (options: NewOptions) => {
      const dataset = await loadDataset();
      const volume = parseVolume(options.卷);
      if (!findVolume(dataset.project, volume)) {
        throw new MoxianError(
          `作品.yaml 里没有第 ${volume} 卷。先用「卷 添加 --序号 ${volume} --名 卷名」登记。`,
          2,
        );
      }

      const chapterNo = options.章
        ? normalizeChapter(options.章)
        : nextChapterNumber(dataset.chapters, volume);

      if (dataset.chapters.some((item) => item.chapter === chapterNo)) {
        throw new MoxianError(`第 ${chapterNo} 章已经存在，换一个章号，或直接「章 登记」。`, 2);
      }

      const body = options.正文文件
        ? await readFile(path.resolve(options.正文文件), 'utf8')
        : '';

      const meta: ChapterMeta = {
        章: chapterNo,
        标题: options.标题,
        ...(options.摘要 ? { 摘要: options.摘要 } : {}),
        埋: [],
        收: [],
        事件: [],
        认知: [],
        关系: [],
      };

      const file = await writeChapter(dataset.project, null, meta, body);
      say(`已建第 ${chapterNo} 章「${options.标题}」`);
      say(`  ${path.relative(dataset.project.root, file)}`);
      if (body.length === 0) {
        say('  正文还是空的。可以在这里写，也可以让 agent 写完贴进来。');
      }
    });

  group
    .command('登记')
    .description('把这一章发生的事登记进去。先预演校验，会引入硬错就拦下不写')
    .argument('<章号>', '章号，例如 1-03')
    .option('--埋 <编号>', '本章埋下的伏笔，逗号分隔', collectList, [])
    .option('--收 <编号>', '本章回收的伏笔，逗号分隔', collectList, [])
    .option('--事件 <编号>', '本章发生的时间线事件，逗号分隔', collectList, [])
    .option('--认知 <人物:设定:状态>', '谁知道了什么，状态取 不知/存疑/已知/误信；可重复', collect, [])
    .option('--关系 <甲:乙:变化>', '人物关系发生变化，例如 沈砚:裴照:敌对；可重复', collect, [])
    .action(async (chapterInput: string, options: LogOptions) => {
      const dataset = await loadDataset();
      const chapter = findChapter(dataset.chapters, chapterInput);
      const chapterNo = chapter.chapter;
      const before = validateDataset(dataset);

      const buriedIds = unique(options.埋.map((item) => normalizeEntryId(item, '伏笔')));
      const collectedIds = unique(options.收.map((item) => normalizeEntryId(item, '伏笔')));
      const eventIds = unique(options.事件.map((item) => normalizeEntryId(item, '时间线')));

      const knowledge = options.认知.map((raw) => {
        const [personToken, settingToken, stateToken] = parseTriple(raw, '认知', '人物:设定:状态');
        return {
          人物: resolvePerson(dataset.entries.人物, personToken),
          设定: resolveSetting(dataset.entries.设定, settingToken),
          变为: parseState(stateToken),
        };
      });

      const relations = options.关系.map((raw) => {
        const [first, second, change] = parseTriple(raw, '关系', '甲:乙:变化');
        return {
          甲: resolvePerson(dataset.entries.人物, first),
          乙: resolvePerson(dataset.entries.人物, second),
          变为: change,
        };
      });

      const nextMeta: ChapterMeta = {
        ...chapter.meta,
        埋: unique([...chapter.meta.埋, ...buriedIds]),
        收: unique([...chapter.meta.收, ...collectedIds]),
        事件: unique([...chapter.meta.事件, ...eventIds]),
        认知: [...chapter.meta.认知, ...knowledge],
        关系: [...chapter.meta.关系, ...relations],
      };

      // 两侧同步：章节登记了埋/收，条目那边的字段跟着补齐。
      const nextForeshadows = dataset.entries.伏笔.map((item) => {
        if (buriedIds.includes(item.编号)) return { ...item, 埋: item.埋 ?? chapterNo };
        if (collectedIds.includes(item.编号)) {
          return { ...item, 回收: item.回收 ?? chapterNo, 状态: '已收' as const };
        }
        return item;
      });

      const nextChapters = dataset.chapters.map((item) =>
        item.chapter === chapterNo ? { ...item, meta: nextMeta } : item,
      );
      const after = validateDataset({
        ...dataset,
        chapters: nextChapters,
        entries: { ...dataset.entries, 伏笔: nextForeshadows },
      });
      blockIfNewHardErrors(before, after, '登记');

      await writeChapter(dataset.project, chapter, nextMeta, chapter.body);
      if (buriedIds.length > 0 || collectedIds.length > 0) {
        await writeEntries(dataset.project, '伏笔', nextForeshadows);
      }

      say(`已登记到第 ${chapterNo} 章：`);
      if (buriedIds.length > 0) say(`  埋 ${buriedIds.join('、')}`);
      if (collectedIds.length > 0) say(`  收 ${collectedIds.join('、')}`);
      if (eventIds.length > 0) say(`  事件 ${eventIds.join('、')}`);
      for (const item of knowledge) say(`  认知 ${item.人物} ${item.变为} ${item.设定}`);
      for (const item of relations) say(`  关系 ${item.甲} 与 ${item.乙} 变为 ${item.变为}`);
    });

  group
    .command('改')
    .description('改标题、摘要或叙事序。叙事序只有闪回、插叙才需要填')
    .argument('<章号>', '章号')
    .option('--标题 <标题>', '新标题，会同时改文件名')
    .option('--摘要 <摘要>', '新摘要')
    .option('--叙事序 <数字>', '故事内时间顺序')
    .action(async (chapterInput: string, options: EditOptions) => {
      if (!options.标题 && !options.摘要 && !options.叙事序) {
        throw new MoxianError('至少要给一个要改的字段：--标题、--摘要 或 --叙事序。', 2);
      }
      const dataset = await loadDataset();
      const chapter = findChapter(dataset.chapters, chapterInput);

      const nextMeta: ChapterMeta = { ...chapter.meta };
      if (options.标题 !== undefined) nextMeta.标题 = options.标题;
      if (options.摘要 !== undefined) nextMeta.摘要 = options.摘要;
      if (options.叙事序 !== undefined) {
        const order = Number.parseInt(options.叙事序, 10);
        if (!Number.isInteger(order)) {
          throw new MoxianError(`--叙事序 要一个整数，收到「${options.叙事序}」。`, 2);
        }
        nextMeta.叙事序 = order;
      }

      const before = validateDataset(dataset);
      const nextChapters = dataset.chapters.map((item) =>
        item.chapter === chapter.chapter ? { ...item, meta: nextMeta } : item,
      );
      const after = validateDataset({ ...dataset, chapters: nextChapters });
      blockIfNewHardErrors(before, after, '改动');

      const file = await writeChapter(dataset.project, chapter, nextMeta, chapter.body);
      say(`已改第 ${chapter.chapter} 章：${path.relative(dataset.project.root, file)}`);
    });

  group
    .command('显示')
    .description('看这一章登记了什么')
    .argument('<章号>', '章号')
    .action(async (chapterInput: string) => {
      const dataset = await loadDataset();
      const chapter = findChapter(dataset.chapters, chapterInput);
      const meta = chapter.meta;

      say(`第 ${chapter.chapter} 章 ${meta.标题}`);
      say(`  文件：${path.relative(dataset.project.root, chapter.file)}`);
      say(`  字数：${countCharacters(chapter.body)}`);
      if (meta.叙事序 !== undefined) say(`  叙事序：${meta.叙事序}`);
      if (meta.摘要) say(`  摘要：${meta.摘要}`);
      if (meta.埋.length > 0) say(`  埋：${meta.埋.join('、')}`);
      if (meta.收.length > 0) say(`  收：${meta.收.join('、')}`);
      if (meta.事件.length > 0) say(`  事件：${meta.事件.join('、')}`);
      for (const item of meta.认知) say(`  认知：${item.人物} ${item.变为} ${item.设定}`);
      for (const item of meta.关系) say(`  关系：${item.甲} 与 ${item.乙} ${item.变为}`);
    });

  group
    .command('列表')
    .description('列出所有章节与登记密度')
    .option('--卷 <卷>', '只看某一卷')
    .action(async (options: { 卷?: string }) => {
      const dataset = await loadDataset();
      const volume = options.卷 ? parseVolume(options.卷) : null;
      const rows = dataset.chapters.filter(
        (item) => volume === null || splitChapter(item.chapter).volume === volume,
      );

      if (rows.length === 0) {
        say(volume === null ? '还没有任何章节。' : `第 ${volume} 卷还没有章节。`);
        return;
      }

      let total = 0;
      for (const chapter of rows) {
        const meta = chapter.meta;
        const count = countCharacters(chapter.body);
        total += count;
        const marks = [
          meta.埋.length > 0 ? `埋${meta.埋.length}` : '',
          meta.收.length > 0 ? `收${meta.收.length}` : '',
          meta.事件.length > 0 ? `事${meta.事件.length}` : '',
          meta.认知.length > 0 ? `知${meta.认知.length}` : '',
          meta.关系.length > 0 ? `关${meta.关系.length}` : '',
        ]
          .filter(Boolean)
          .join(' ');
        say(`${chapter.chapter}  ${meta.标题}   ${count} 字   ${marks}`);
      }
      say(`共 ${rows.length} 章，${total} 字。`);
    });
}

function findChapter(chapters: readonly Chapter[], input: string): Chapter {
  const chapterNo = normalizeChapter(input);
  const found = chapters.find((item) => item.chapter === chapterNo);
  if (!found) {
    throw new MoxianError(
      `找不到第 ${chapterNo} 章。先用「章 新建 --卷 ${splitChapter(chapterNo).volume}」建出来。`,
      2,
    );
  }
  return found;
}

function nextChapterNumber(chapters: readonly Chapter[], volume: number): string {
  const indexes = chapters
    .map((item) => splitChapter(item.chapter))
    .filter((item) => item.volume === volume)
    .map((item) => item.index);
  const next = (indexes.length > 0 ? Math.max(...indexes) : 0) + 1;
  return `${volume}-${String(next).padStart(2, '0')}`;
}

function parseTriple(raw: string, flag: string, shape: string): [string, string, string] {
  const parts = raw.split(/[:：]/).map((item) => item.trim());
  if (parts.length !== 3 || parts.some((item) => item.length === 0)) {
    throw new MoxianError(`--${flag} 的格式是 ${shape}，收到「${raw}」。`, 2);
  }
  return [parts[0]!, parts[1]!, parts[2]!];
}

function parseState(value: string): KnowledgeState {
  if (!(KNOWLEDGE_STATES as readonly string[]).includes(value)) {
    throw new MoxianError(`认知状态只能是 ${KNOWLEDGE_STATES.join('/')}，收到「${value}」。`, 2);
  }
  return value as KnowledgeState;
}
