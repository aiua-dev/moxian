import { DIR_CONTINUITY, type Kind } from '../constants.js';
import { summarize, type Diagnostic } from '../core/diagnostics.js';
import { MoxianError } from '../core/errors.js';
import { allocateEntryId, normalizeEntryId } from '../core/ids.js';
import { loadProject, type Project } from '../core/project.js';
import { listChapters, listOutlines, readAllChapters, readChapter, readEntries } from '../core/store.js';
import { validateDataset, type Dataset } from '../core/validate.js';
import type { Person, Setting } from '../domain/schema.js';

export function say(message = ''): void {
  process.stdout.write(`${message}\n`);
}

/** 一次把整部作品读进内存。作品规模在长篇量级，直接全读最省心。 */
export async function loadDataset(cwd: string = process.cwd()): Promise<Dataset> {
  const project = await loadProject(cwd);
  const [chapters, 伏笔, 人物, 时间线, 设定, outlines] = await Promise.all([
    readAllChapters(project),
    readEntries(project, '伏笔'),
    readEntries(project, '人物'),
    readEntries(project, '时间线'),
    readEntries(project, '设定'),
    listOutlines(project),
  ]);
  return { project, chapters, entries: { 伏笔, 人物, 时间线, 设定 }, outlines };
}

export async function nextEntryId(project: Project, kind: Kind): Promise<string> {
  const entries = await readEntries(project, kind);
  return allocateEntryId(
    kind,
    entries.map((item) => item.编号),
  );
}

export async function loadChapter(project: Project, input: string) {
  return readChapter(project, input);
}

export { listChapters };

/* ------------------------------- 诊断输出 ------------------------------- */

export function printDiagnostics(
  diagnostics: readonly Diagnostic[],
  title = '校验结果',
  stream: 'stdout' | 'stderr' = 'stdout',
): void {
  const write = (line = ''): void => {
    if (stream === 'stderr') process.stderr.write(`${line}\n`);
    else process.stdout.write(`${line}\n`);
  };

  if (diagnostics.length === 0) {
    write(`${title}：没有发现问题。`);
    return;
  }
  const { hard, soft } = summarize(diagnostics);
  write(`${title}：硬错 ${hard.length} 条，提醒 ${soft.length} 条。`);
  for (const item of [...hard, ...soft]) {
    const where = item.where ? ` ${item.where}` : '';
    write(`  [${item.rule}]${where}`);
    write(`      ${item.message}`);
  }
}

/**
 * 写入前预演：先算出「写下去之后」的硬错，和现在比，
 * 只拦本次新引入的。历史遗留问题不该阻止作者继续写。
 */
export function newHardErrors(
  before: readonly Diagnostic[],
  after: readonly Diagnostic[],
): Diagnostic[] {
  const key = (item: Diagnostic): string => `${item.rule}|${item.message}`;
  const known = new Set(before.filter((item) => item.severity === '硬错').map(key));
  return after.filter((item) => item.severity === '硬错' && !known.has(key(item)));
}

export function blockIfNewHardErrors(
  before: readonly Diagnostic[],
  after: readonly Diagnostic[],
  action: string,
): void {
  const introduced = newHardErrors(before, after);
  if (introduced.length === 0) return;
  process.stderr.write('\n');
  printDiagnostics(
    introduced,
    `这次「${action}」会引入硬错，已经拦下，磁盘上没有改动`,
    'stderr',
  );
  throw new MoxianError(`${action}被拦下：先处理上面 ${introduced.length} 条硬错。`, 2);
}

/* ------------------------------- 名字解析 ------------------------------- */

/** 允许用人物名或别名代替编号，前提是唯一命中。 */
export function resolvePerson(people: readonly Person[], token: string): string {
  const trimmed = token.trim();
  if (/^[Pp]-?\d+$/.test(trimmed)) return normalizeEntryId(trimmed, '人物');

  const hits = people.filter((item) => item.名 === trimmed || item.别名.includes(trimmed));
  if (hits.length === 1) return hits[0]!.编号;
  if (hits.length === 0) {
    throw new MoxianError(`找不到人物「${trimmed}」。先用「人物 新建 --名 ${trimmed}」把它登记出来。`, 2);
  }
  throw new MoxianError(
    `「${trimmed}」对应多个人物：${hits.map((item) => item.编号).join('、')}。这种情况请直接写编号。`,
    2,
  );
}

/** 设定允许用描述里的短名指代，但更推荐写编号。 */
export function resolveSetting(settings: readonly Setting[], token: string): string {
  const trimmed = token.trim();
  if (/^[Ss]-?\d+$/.test(trimmed)) return normalizeEntryId(trimmed, '设定');

  const hits = settings.filter((item) => item.描述 === trimmed);
  if (hits.length === 1) return hits[0]!.编号;
  if (hits.length === 0) {
    throw new MoxianError(`找不到设定「${trimmed}」。先用「设定 新建 --描述 ${trimmed}」登记，或直接写编号。`, 2);
  }
  throw new MoxianError(
    `「${trimmed}」对应多条设定：${hits.map((item) => item.编号).join('、')}。请直接写编号。`,
    2,
  );
}

export function entryFileLabel(kind: Kind): string {
  return `${DIR_CONTINUITY}/${kind}.yaml`;
}

/** commander 的重复选项收集器。 */
export function collect(value: string, previous: string[]): string[] {
  return [...previous, value];
}

/** 逗号、顿号、空格都能当分隔符的列表选项收集器。 */
export function collectList(value: string, previous: string[]): string[] {
  return [
    ...previous,
    ...value
      .split(/[,，、\s]+/)
      .map((item) => item.trim())
      .filter(Boolean),
  ];
}

export function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

/** 去掉不可见字符后的正文字数，用于粗略进度。 */
export function countCharacters(body: string): number {
  return body.replace(/\s/g, '').length;
}

export function parseVolume(value: string, flagName = '卷'): number {
  const volume = Number.parseInt(value, 10);
  if (!Number.isInteger(volume) || volume < 1) {
    throw new MoxianError(`--${flagName} 要一个大于 0 的整数，收到的是「${value}」。`, 2);
  }
  return volume;
}
