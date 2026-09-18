import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import * as path from 'node:path';
import YAML from 'yaml';
import { DIR_CONTINUITY, DIR_OUTLINE, DIR_TEXT, type Kind } from '../constants.js';
import {
  ENTRY_SCHEMAS,
  chapterMetaSchema,
  outlineMetaSchema,
  type ChapterMeta,
  type EntryOf,
  type OutlineMeta,
} from '../domain/schema.js';
import { describeZodError, MoxianError } from './errors.js';
import { chapterFileName, chapterFromFileName, compareChapter, normalizeChapter, titleFromFileName } from './ids.js';
import { joinFrontmatter, splitFrontmatter, stringifyEntries } from './markdown.js';
import { continuityDir, exists, outlineDir, textDir, type Project } from './project.js';

/* ---------------------------------- 条目 ---------------------------------- */

export function entryFilePath(project: Project, kind: Kind): string {
  return path.join(continuityDir(project), `${kind}.yaml`);
}

export async function readEntries<K extends Kind>(project: Project, kind: K): Promise<EntryOf<K>[]> {
  const file = entryFilePath(project, kind);
  const label = `${DIR_CONTINUITY}/${kind}.yaml`;

  let text: string;
  try {
    text = await readFile(file, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }

  let raw: unknown;
  try {
    raw = YAML.parse(text);
  } catch (error) {
    throw new MoxianError(`${label} 不是合法 YAML：${(error as Error).message}`, 2);
  }
  if (raw === null || raw === undefined) return [];
  if (!Array.isArray(raw)) {
    throw new MoxianError(`${label} 的顶层应该是条目列表。`, 2);
  }

  const schema = ENTRY_SCHEMAS[kind];
  return raw.map((item, index) => {
    const parsed = schema.safeParse(item);
    if (!parsed.success) {
      throw new MoxianError(`${label} 第 ${index + 1} 条不合法：${describeZodError(parsed.error)}`, 2);
    }
    return parsed.data as EntryOf<K>;
  });
}

export async function writeEntries(
  project: Project,
  kind: Kind,
  entries: readonly unknown[],
): Promise<void> {
  const file = entryFilePath(project, kind);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, stringifyEntries(entries), 'utf8');
}

/* ---------------------------------- 章节 ---------------------------------- */

export interface ChapterRef {
  chapter: string;
  title: string;
  file: string;
}

export interface Chapter extends ChapterRef {
  meta: ChapterMeta;
  body: string;
}

/** 只读文件名，快。需要 frontmatter 时再单独读。 */
export async function listChapters(project: Project): Promise<ChapterRef[]> {
  const dir = textDir(project);
  let names: string[];
  try {
    names = await readdir(dir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }

  const refs: ChapterRef[] = [];
  for (const name of names) {
    if (!name.endsWith('.md')) continue;
    const chapter = chapterFromFileName(name);
    const title = titleFromFileName(name);
    if (chapter === null || title === null) continue;
    refs.push({ chapter, title, file: path.join(dir, name) });
  }
  refs.sort((a, b) => compareChapter(a.chapter, b.chapter));
  return refs;
}

export async function readChapterFile(ref: ChapterRef): Promise<Chapter> {
  const label = path.basename(ref.file);
  const text = await readFile(ref.file, 'utf8');
  const parsed = splitFrontmatter(text, label);
  if (!parsed) {
    throw new MoxianError(`${label} 缺 frontmatter。正文文件必须带 frontmatter，连续性数据都装在那里。`, 2);
  }
  const meta = chapterMetaSchema.safeParse(parsed.data);
  if (!meta.success) {
    throw new MoxianError(`${label} 的 frontmatter 不合法：${describeZodError(meta.error)}`, 2);
  }
  return { ...ref, meta: meta.data, body: parsed.body };
}

export async function readChapter(project: Project, input: string): Promise<Chapter> {
  const chapter = normalizeChapter(input);
  const refs = await listChapters(project);
  const ref = refs.find((item) => item.chapter === chapter);
  if (!ref) {
    throw new MoxianError(`找不到第 ${chapter} 章。先跑「章 新建」把它建出来。`, 2);
  }
  return readChapterFile(ref);
}

export async function readAllChapters(project: Project): Promise<Chapter[]> {
  const refs = await listChapters(project);
  return Promise.all(refs.map((ref) => readChapterFile(ref)));
}

/**
 * 写章节。标题改了会导致文件名变化，旧文件顺手清掉，
 * 否则同一章会留下两个文件，校验时撞出编号重复。
 */
export async function writeChapter(
  project: Project,
  previous: ChapterRef | null,
  meta: ChapterMeta,
  body: string,
): Promise<string> {
  const dir = textDir(project);
  await mkdir(dir, { recursive: true });
  const target = path.join(dir, chapterFileName(meta.章, meta.标题));
  await writeFile(target, joinFrontmatter(meta, body), 'utf8');
  if (previous && previous.file !== target && (await exists(previous.file))) {
    await rm(previous.file);
  }
  return target;
}

export function chapterLabel(chapter: string, title: string): string {
  return `${chapter} ${title}`;
}

/* ---------------------------------- 大纲 ---------------------------------- */

export interface Outline {
  volume: number;
  name: string;
  meta: OutlineMeta;
  body: string;
  file: string;
}

/**
 * 大纲目录里以数字开头的 .md 视为卷大纲，必须带合法 frontmatter；
 * 其余（例如 总纲.md）是作者的自由文档，CLI 只读不动。
 */
export async function listOutlines(project: Project): Promise<Outline[]> {
  const dir = outlineDir(project);
  let names: string[];
  try {
    names = await readdir(dir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }

  const outlines: Outline[] = [];
  for (const name of names) {
    if (!name.endsWith('.md') || !/^\d+-/.test(name)) continue;
    const file = path.join(dir, name);
    const text = await readFile(file, 'utf8');
    const parsed = splitFrontmatter(text, `${DIR_OUTLINE}/${name}`);
    if (!parsed) {
      throw new MoxianError(`${DIR_OUTLINE}/${name} 缺 frontmatter。以数字开头的 .md 会被当作卷大纲。`, 2);
    }
    const meta = outlineMetaSchema.safeParse(parsed.data);
    if (!meta.success) {
      throw new MoxianError(`${DIR_OUTLINE}/${name} 的 frontmatter 不合法：${describeZodError(meta.error)}`, 2);
    }
    outlines.push({
      volume: meta.data.卷,
      name: meta.data.名,
      meta: meta.data,
      body: parsed.body,
      file,
    });
  }
  outlines.sort((a, b) => a.volume - b.volume);
  return outlines;
}

export async function readOutline(project: Project, volume: number): Promise<Outline | null> {
  const outlines = await listOutlines(project);
  return outlines.find((item) => item.volume === volume) ?? null;
}

export async function writeOutline(project: Project, meta: OutlineMeta, body: string): Promise<string> {
  const dir = outlineDir(project);
  await mkdir(dir, { recursive: true });
  const previous = await readOutline(project, meta.卷);
  const target = path.join(dir, `${meta.卷}-${meta.名.replace(/[\\/:*?"<>|]/g, '')}.md`);
  await writeFile(target, joinFrontmatter(meta, body), 'utf8');
  if (previous && previous.file !== target && (await exists(previous.file))) {
    await rm(previous.file);
  }
  return target;
}

export async function readOutlineDoc(project: Project, fileName: string): Promise<string | null> {
  const file = path.join(outlineDir(project), fileName);
  try {
    return await readFile(file, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}
