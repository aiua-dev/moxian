import { access, readFile, writeFile } from 'node:fs/promises';
import * as path from 'node:path';
import YAML from 'yaml';
import { DIR_CONTINUITY, DIR_OUTLINE, DIR_TEXT, PROJECT_FILE } from '../constants.js';
import { workSchema, type Work } from '../domain/schema.js';
import { describeZodError, MoxianError } from './errors.js';
import { deepClean } from './markdown.js';

/** 一部作品一个根。创作数据与代码仓库彻底分离，根下只有三个目录。 */
export interface Project {
  root: string;
  work: Work;
}

export async function exists(target: string): Promise<boolean> {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

export function textDir(project: Project): string {
  return path.join(project.root, DIR_TEXT);
}

export function outlineDir(project: Project): string {
  return path.join(project.root, DIR_OUTLINE);
}

export function continuityDir(project: Project): string {
  return path.join(project.root, DIR_CONTINUITY);
}

/** 从给定目录往上找 作品.yaml。找不到就说明这里不是作品目录。 */
export async function findProjectRoot(start: string): Promise<string> {
  let current = path.resolve(start);
  for (;;) {
    if (await exists(path.join(current, PROJECT_FILE))) return current;
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  throw new MoxianError(`当前目录往上都没有 ${PROJECT_FILE}，这里不是作品目录。先跑「初始化」。`, 2);
}

export async function loadProject(start: string): Promise<Project> {
  const root = await findProjectRoot(start);
  const file = path.join(root, PROJECT_FILE);
  const text = await readFile(file, 'utf8');

  let raw: unknown;
  try {
    raw = YAML.parse(text);
  } catch (error) {
    throw new MoxianError(`${PROJECT_FILE} 不是合法 YAML：${(error as Error).message}`, 2);
  }

  const parsed = workSchema.safeParse(raw);
  if (!parsed.success) {
    throw new MoxianError(`${PROJECT_FILE} 不合法：${describeZodError(parsed.error)}`, 2);
  }
  return { root, work: parsed.data };
}

export async function saveWork(project: Project): Promise<void> {
  const file = path.join(project.root, PROJECT_FILE);
  await writeFile(file, YAML.stringify(deepClean(project.work), { lineWidth: 0 }), 'utf8');
}

/** 卷册结构里查一下这个卷有没有登记。 */
export function findVolume(project: Project, volume: number): { 序号: number; 名: string } | null {
  return project.work.卷.find((item) => item.序号 === volume) ?? null;
}
