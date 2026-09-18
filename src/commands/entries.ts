import type { Command } from 'commander';
import { MoxianError } from '../core/errors.js';
import { normalizeChapter, normalizeEntryId } from '../core/ids.js';
import type { Project } from '../core/project.js';
import { projectState } from '../core/state.js';
import { writeChapter, writeEntries, type Chapter } from '../core/store.js';
import { validateDataset, type Dataset } from '../core/validate.js';
import type { Foreshadow, Person, Setting, TimelineEvent } from '../domain/schema.js';
import {
  blockIfNewHardErrors,
  collectList,
  loadDataset,
  nextEntryId,
  resolvePerson,
  say,
  unique,
} from './shared.js';

async function guard(dataset: Dataset, action: string, patch: Partial<Dataset>): Promise<void> {
  const before = validateDataset(dataset);
  const after = validateDataset({ ...dataset, ...patch } as Dataset);
  blockIfNewHardErrors(before, after, action);
}

async function saveChapters(project: Project, chapters: readonly Chapter[]): Promise<void> {
  for (const chapter of chapters) {
    await writeChapter(project, chapter, chapter.meta, chapter.body);
  }
}

/** 把某个伏笔编号按需要写进/移出某一章的埋或收列表。 */
function patchChapterMark(
  chapter: Chapter,
  field: '埋' | '收',
  id: string,
  mode: 'add' | 'remove',
): Chapter {
  const current = chapter.meta[field];
  const next = mode === 'add' ? unique([...current, id]) : current.filter((item) => item !== id);
  if (next.length === current.length && mode === 'add') return chapter;
  return { ...chapter, meta: { ...chapter.meta, [field]: next } };
}

export function registerEntries(program: Command): void {
  registerForeshadow(program);
  registerPerson(program);
  registerTimeline(program);
  registerSetting(program);
}

/* --------------------------------- 伏笔 --------------------------------- */

function registerForeshadow(program: Command): void {
  const group = program.command('伏笔').description('伏笔与承诺：埋了什么、打算在哪收、收没收');

  group
    .command('新建')
    .description('登记一条伏笔或承诺')
    .requiredOption('--描述 <描述>', '这条伏笔是什么')
    .option('--埋 <章号>', '在哪一章埋下，会同时写进那一章')
    .option('--预期回收 <章号>', '打算在哪一章收，可以先不填')
    .option('--关联 <编号>', '关联的编号，逗号分隔', collectList, [])
    .action(
      async (options: { 描述: string; 埋?: string; 预期回收?: string; 关联: string[] }) => {
        const dataset = await loadDataset();
        const id = await nextEntryId(dataset.project, '伏笔');

        const entry: Foreshadow = {
          编号: id,
          描述: options.描述,
          ...(options.埋 ? { 埋: normalizeChapter(options.埋) } : {}),
          ...(options.预期回收 ? { 预期回收: normalizeChapter(options.预期回收) } : {}),
          状态: '悬空',
          关联: options.关联,
        };

        let chapters = dataset.chapters;
        let touched: Chapter | null = null;
        if (entry.埋) {
          const target = dataset.chapters.find((item) => item.chapter === entry.埋);
          if (!target) {
            throw new MoxianError(
              `第 ${entry.埋} 章还不存在。先「章 新建」建出来，或者先不写 --埋。`,
              2,
            );
          }
          touched = patchChapterMark(target, '埋', id, 'add');
          chapters = dataset.chapters.map((item) => (item.chapter === entry.埋 ? touched! : item));
        }

        const nextEntries = [...dataset.entries.伏笔, entry];
        await guard(dataset, '新建伏笔', {
          entries: { ...dataset.entries, 伏笔: nextEntries },
          chapters,
        });

        await writeEntries(dataset.project, '伏笔', nextEntries);
        if (touched) await saveChapters(dataset.project, [touched]);

        say(`已登记伏笔 ${id}：${entry.描述}`);
        if (entry.埋) say(`  埋在第 ${entry.埋} 章`);
      },
    );

  group
    .command('收')
    .description('收回一条伏笔。条目和那一章会同时更新')
    .argument('<编号>', '伏笔编号，例如 F-001')
    .requiredOption('--在 <章号>', '在第几章收回')
    .action(async (idInput: string, options: { 在: string }) => {
      const dataset = await loadDataset();
      const id = normalizeEntryId(idInput, '伏笔');
      const chapterNo = normalizeChapter(options.在);
      const chapter = dataset.chapters.find((item) => item.chapter === chapterNo);
      if (!chapter) {
        throw new MoxianError(`第 ${chapterNo} 章还不存在。先「章 新建」建出来。`, 2);
      }
      const entry = dataset.entries.伏笔.find((item) => item.编号 === id);
      if (!entry) throw new MoxianError(`找不到伏笔 ${id}。`, 2);
      if (entry.回收) {
        throw new MoxianError(`伏笔 ${id} 已经在第 ${entry.回收} 章收过了。`, 2);
      }

      const nextEntries = dataset.entries.伏笔.map((item) =>
        item.编号 === id ? { ...item, 回收: chapterNo, 状态: '已收' as const } : item,
      );
      const touched = patchChapterMark(chapter, '收', id, 'add');
      const chapters = dataset.chapters.map((item) =>
        item.chapter === chapterNo ? touched : item,
      );

      await guard(dataset, `收回伏笔 ${id}`, {
        entries: { ...dataset.entries, 伏笔: nextEntries },
        chapters,
      });

      await writeEntries(dataset.project, '伏笔', nextEntries);
      await saveChapters(dataset.project, [touched]);
      say(`伏笔 ${id} 已在第 ${chapterNo} 章收回。`);
    });

  group
    .command('弃')
    .description('放弃一条伏笔，不再追它')
    .argument('<编号>', '伏笔编号')
    .option('--原因 <原因>', '为什么放弃')
    .action(async (idInput: string, options: { 原因?: string }) => {
      const dataset = await loadDataset();
      const id = normalizeEntryId(idInput, '伏笔');
      const entry = dataset.entries.伏笔.find((item) => item.编号 === id);
      if (!entry) throw new MoxianError(`找不到伏笔 ${id}。`, 2);

      const nextEntries = dataset.entries.伏笔.map((item) =>
        item.编号 === id
          ? {
              ...item,
              状态: '弃用' as const,
              ...(options.原因 ? { 备注: options.原因 } : {}),
            }
          : item,
      );
      await writeEntries(dataset.project, '伏笔', nextEntries);
      say(`伏笔 ${id} 已标为弃用。`);
    });

  group
    .command('改')
    .description('改描述、预期回收章，或把埋设章挪到别处')
    .argument('<编号>', '伏笔编号')
    .option('--描述 <描述>', '新描述')
    .option('--预期回收 <章号>', '新的预期回收章')
    .action(async (idInput: string, options: { 描述?: string; 预期回收?: string }) => {
      if (!options.描述 && !options.预期回收) {
        throw new MoxianError('至少要给 --描述 或 --预期回收。', 2);
      }
      const dataset = await loadDataset();
      const id = normalizeEntryId(idInput, '伏笔');
      const entry = dataset.entries.伏笔.find((item) => item.编号 === id);
      if (!entry) throw new MoxianError(`找不到伏笔 ${id}。`, 2);

      const nextEntries = dataset.entries.伏笔.map((item) => {
        if (item.编号 !== id) return item;
        const updated = { ...item };
        if (options.描述) updated.描述 = options.描述;
        if (options.预期回收) updated.预期回收 = normalizeChapter(options.预期回收);
        return updated;
      });

      await guard(dataset, `修改伏笔 ${id}`, {
        entries: { ...dataset.entries, 伏笔: nextEntries },
      });
      await writeEntries(dataset.project, '伏笔', nextEntries);
      say(`已改伏笔 ${id}。`);
    });

  group
    .command('列表')
    .description('列出伏笔。默认全部，--悬空 只看没收的')
    .option('--悬空', '只看还没收的')
    .action(async (options: { 悬空?: boolean }) => {
      const dataset = await loadDataset();
      const rows = options.悬空
        ? dataset.entries.伏笔.filter((item) => item.状态 === '悬空')
        : dataset.entries.伏笔;

      if (rows.length === 0) {
        say(options.悬空 ? '没有悬空的伏笔。' : '还没有登记任何伏笔。');
        return;
      }

      for (const item of rows) {
        const buried = item.埋 ? `埋 ${item.埋}` : '没写埋设章';
        const tail =
          item.状态 === '已收'
            ? `收 ${item.回收}`
            : item.预期回收
              ? `计划 ${item.预期回收} 收`
              : '没规划回收章';
        say(`${item.编号}  [${item.状态}]  ${item.描述}   ${buried}  ${tail}`);
      }
      say(`共 ${rows.length} 条。`);
    });
}

/* --------------------------------- 人物 --------------------------------- */

function registerPerson(program: Command): void {
  const group = program.command('人物').description('人物：只存身份信息，状态由章节事件推导');

  group
    .command('新建')
    .description('登记一个人物')
    .requiredOption('--名 <名>', '人物名')
    .option('--别名 <别名>', '别名，逗号分隔', collectList, [])
    .option('--身份 <身份>', '身份或职务')
    .option('--描述 <描述>', '一句话说明')
    .action(
      async (options: { 名: string; 别名: string[]; 身份?: string; 描述?: string }) => {
        const dataset = await loadDataset();
        const duplicated = dataset.entries.人物.find(
          (item) => item.名 === options.名 || item.别名.includes(options.名),
        );
        if (duplicated) {
          throw new MoxianError(
            `「${options.名}」和已有的人物 ${duplicated.编号} 撞名了。重名会让名字解析失效，换一个写法。`,
            2,
          );
        }

        const id = await nextEntryId(dataset.project, '人物');
        const entry: Person = {
          编号: id,
          名: options.名,
          别名: options.别名,
          ...(options.身份 ? { 身份: options.身份 } : {}),
          ...(options.描述 ? { 描述: options.描述 } : {}),
        };

        const nextEntries = [...dataset.entries.人物, entry];
        await guard(dataset, '新建人物', {
          entries: { ...dataset.entries, 人物: nextEntries },
        });
        await writeEntries(dataset.project, '人物', nextEntries);

        say(`已登记人物 ${id}：${entry.名}`);
      },
    );

  group
    .command('查')
    .description('看一个人物。给 --在 章号 就能看到那一章时点的认知与关系')
    .argument('<人物>', '人物编号或名字')
    .option('--在 <章号>', '看哪一章时点的状态')
    .action(async (token: string, options: { 在?: string }) => {
      const dataset = await loadDataset();
      const id = resolvePerson(dataset.entries.人物, token);
      const person = dataset.entries.人物.find((item) => item.编号 === id)!;

      say(`${person.编号}  ${person.名}`);
      if (person.别名.length > 0) say(`  别名：${person.别名.join('、')}`);
      if (person.身份) say(`  身份：${person.身份}`);
      if (person.描述) say(`  描述：${person.描述}`);

      if (!options.在) return;
      const chapterNo = normalizeChapter(options.在);
      const state = projectState(dataset.chapters, chapterNo);

      say('');
      say(`截至第 ${chapterNo} 章之前：`);
      const bucket = state.knowledge.get(id);
      if (bucket && bucket.size > 0) {
        for (const [settingId, status] of bucket) {
          const setting = dataset.entries.设定.find((item) => item.编号 === settingId);
          say(`  认知 ${status} ${settingId}${setting ? `（${setting.描述}）` : ''}`);
        }
      } else {
        say('  认知：（没有任何登记）');
      }

      let relationCount = 0;
      for (const item of state.relations.values()) {
        if (item.甲 !== id && item.乙 !== id) continue;
        const otherId = item.甲 === id ? item.乙 : item.甲;
        const other = dataset.entries.人物.find((item2) => item2.编号 === otherId);
        say(`  关系 与 ${other ? other.名 : otherId}：${item.变为}`);
        relationCount += 1;
      }
      if (relationCount === 0) say('  关系：（没有任何登记）');
    });

  group
    .command('列表')
    .description('列出所有人物')
    .action(async () => {
      const dataset = await loadDataset();
      if (dataset.entries.人物.length === 0) {
        say('还没有登记任何人物。');
        return;
      }
      for (const item of dataset.entries.人物) {
        const identity = item.身份 ? `  ${item.身份}` : '';
        say(`${item.编号}  ${item.名}${identity}`);
      }
      say(`共 ${dataset.entries.人物.length} 人。`);
    });
}

/* -------------------------------- 时间线 -------------------------------- */

function registerTimeline(program: Command): void {
  const group = program.command('时间线').description('时间线与因果。事件发生在哪一章由章节登记决定');

  group
    .command('新建')
    .description('登记一个事件')
    .requiredOption('--描述 <描述>', '发生了什么')
    .option('--时间 <时间>', '故事内的时间说法，例如 三年前')
    .option('--前置 <编号>', '因果上必须先发生的事件，逗号分隔', collectList, [])
    .action(async (options: { 描述: string; 时间?: string; 前置: string[] }) => {
      const dataset = await loadDataset();
      const id = await nextEntryId(dataset.project, '时间线');
      const entry: TimelineEvent = {
        编号: id,
        描述: options.描述,
        ...(options.时间 ? { 时间: options.时间 } : {}),
        前置: options.前置.map((item) => normalizeEntryId(item, '时间线')),
      };

      const nextEntries = [...dataset.entries.时间线, entry];
      await guard(dataset, '新建事件', {
        entries: { ...dataset.entries, 时间线: nextEntries },
      });
      await writeEntries(dataset.project, '时间线', nextEntries);
      say(`已登记事件 ${id}：${entry.描述}`);
    });

  group
    .command('列表')
    .description('按发生顺序列出事件')
    .action(async () => {
      const dataset = await loadDataset();
      if (dataset.entries.时间线.length === 0) {
        say('还没有登记任何事件。');
        return;
      }
      const at = new Map<string, string>();
      for (const chapter of dataset.chapters) {
        for (const id of chapter.meta.事件) at.set(id, chapter.chapter);
      }
      for (const item of dataset.entries.时间线) {
        const where = at.get(item.编号) ? `第 ${at.get(item.编号)} 章` : '未落到任何一章';
        const when = item.时间 ? `  ${item.时间}` : '';
        say(`${item.编号}  ${item.描述}   ${where}${when}`);
      }
      say(`共 ${dataset.entries.时间线.length} 条。`);
    });

  group
    .command('查')
    .description('看某一章发生了什么')
    .option('--章 <章号>', '章号')
    .action(async (options: { 章?: string }) => {
      const dataset = await loadDataset();
      if (!options.章) {
        throw new MoxianError('给一个 --章 章号。', 2);
      }
      const chapterNo = normalizeChapter(options.章);
      const chapter = dataset.chapters.find((item) => item.chapter === chapterNo);
      if (!chapter) throw new MoxianError(`第 ${chapterNo} 章还不存在。`, 2);

      if (chapter.meta.事件.length === 0) {
        say(`第 ${chapterNo} 章没有登记事件。`);
        return;
      }
      say(`第 ${chapterNo} 章发生的事件：`);
      for (const id of chapter.meta.事件) {
        const event = dataset.entries.时间线.find((item) => item.编号 === id);
        say(`  ${id}  ${event?.描述 ?? '（条目缺失）'}`);
      }
    });
}

/* --------------------------------- 设定 --------------------------------- */

function registerSetting(program: Command): void {
  const group = program.command('设定').description('世界规则与世界真相');

  group
    .command('新建')
    .description('登记一条设定。真相是等着被揭示的秘密，规则是约束')
    .requiredOption('--描述 <描述>', '内容')
    .option('--类型 <类型>', '规则 或 真相', '规则')
    .option('--生效 <章号>', '从哪一章开始生效')
    .option('--揭示 <章号>', '对读者揭示的章，只有真相需要')
    .action(
      async (options: { 描述: string; 类型: string; 生效?: string; 揭示?: string }) => {
        if (options.类型 !== '规则' && options.类型 !== '真相') {
          throw new MoxianError(`--类型 只能是 规则 或 真相，收到「${options.类型}」。`, 2);
        }
        const dataset = await loadDataset();
        const id = await nextEntryId(dataset.project, '设定');
        const entry: Setting = {
          编号: id,
          描述: options.描述,
          类型: options.类型,
          ...(options.生效 ? { 生效: normalizeChapter(options.生效) } : {}),
          ...(options.揭示 ? { 揭示: normalizeChapter(options.揭示) } : {}),
        };

        const nextEntries = [...dataset.entries.设定, entry];
        await guard(dataset, '新建设定', {
          entries: { ...dataset.entries, 设定: nextEntries },
        });
        await writeEntries(dataset.project, '设定', nextEntries);
        say(`已登记设定 ${id} [${entry.类型}]：${entry.描述}`);
      },
    );

  group
    .command('改')
    .description('补上生效章或揭示章')
    .argument('<编号>', '设定编号')
    .option('--描述 <描述>', '新描述')
    .option('--生效 <章号>', '生效章')
    .option('--揭示 <章号>', '揭示章')
    .action(
      async (
        idInput: string,
        options: { 描述?: string; 生效?: string; 揭示?: string },
      ) => {
        if (!options.描述 && !options.生效 && !options.揭示) {
          throw new MoxianError('至少要给 --描述、--生效 或 --揭示。', 2);
        }
        const dataset = await loadDataset();
        const id = normalizeEntryId(idInput, '设定');
        const exists = dataset.entries.设定.some((item) => item.编号 === id);
        if (!exists) throw new MoxianError(`找不到设定 ${id}。`, 2);

        const nextEntries = dataset.entries.设定.map((item) => {
          if (item.编号 !== id) return item;
          const updated = { ...item };
          if (options.描述) updated.描述 = options.描述;
          if (options.生效) updated.生效 = normalizeChapter(options.生效);
          if (options.揭示) updated.揭示 = normalizeChapter(options.揭示);
          return updated;
        });

        await guard(dataset, `修改设定 ${id}`, {
          entries: { ...dataset.entries, 设定: nextEntries },
        });
        await writeEntries(dataset.project, '设定', nextEntries);
        say(`已改设定 ${id}。`);
      },
    );

  group
    .command('列表')
    .description('列出设定')
    .option('--类型 <类型>', '只看 规则 或 真相')
    .action(async (options: { 类型?: string }) => {
      const dataset = await loadDataset();
      const rows = options.类型
        ? dataset.entries.设定.filter((item) => item.类型 === options.类型)
        : dataset.entries.设定;
      if (rows.length === 0) {
        say('没有符合条件的设定。');
        return;
      }
      for (const item of rows) {
        const tail = [
          item.生效 ? `生效 ${item.生效}` : '',
          item.揭示 ? `揭示 ${item.揭示}` : '',
        ]
          .filter(Boolean)
          .join('  ');
        say(`${item.编号}  [${item.类型}]  ${item.描述}   ${tail}`);
      }
      say(`共 ${rows.length} 条。`);
    });
}
