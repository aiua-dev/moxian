import { mkdir, readdir, writeFile } from 'node:fs/promises';
import * as path from 'node:path';
import YAML from 'yaml';
import { DIR_CONTINUITY, DIR_OUTLINE, DIR_TEXT, FORMAT_VERSION, KINDS, PROJECT_FILE } from '../constants.js';
import type { Work } from '../domain/schema.js';
import { MoxianError } from './errors.js';
import { exists } from './project.js';

const OUTLINE_TEMPLATE = `# 总纲

一句话主线：

## 题材与基调

## 主要冲突

## 结局方向

## 卷册安排

（卷大纲用「大纲 设置 --卷 N」写进本目录。本文件是自由文档，CLI 只读不解析。）
`;

/**
 * 初始化一部作品。根下只有三个目录，刻意保持浅。
 * 拒绝在非空目录里初始化：作品目录必须与代码仓库分开。
 */
export async function createProject(
  target: string,
  title: string,
  author?: string,
): Promise<string> {
  const root = path.resolve(target);
  const manifest = path.join(root, PROJECT_FILE);

  if (await exists(manifest)) {
    throw new MoxianError(`${root} 已经是作品目录了（存在 ${PROJECT_FILE}）。`, 2);
  }

  await mkdir(root, { recursive: true });
  const contents = await readdir(root);
  if (contents.length > 0) {
    throw new MoxianError(
      `${root} 不是空目录，里面有 ${contents.length} 项。作品目录要与代码仓库分开，请换一个空目录。`,
      2,
    );
  }

  const work: Work = {
    格式版本: FORMAT_VERSION,
    书名: title,
    ...(author ? { 作者: author } : {}),
    卷: [{ 序号: 1, 名: '第一卷' }],
  };
  await writeFile(manifest, YAML.stringify(work, { lineWidth: 0 }), 'utf8');

  await mkdir(path.join(root, DIR_TEXT), { recursive: true });
  await mkdir(path.join(root, DIR_OUTLINE), { recursive: true });
  await mkdir(path.join(root, DIR_CONTINUITY), { recursive: true });

  await writeFile(path.join(root, DIR_OUTLINE, '总纲.md'), OUTLINE_TEMPLATE, 'utf8');

  for (const kind of KINDS) {
    const file = path.join(root, DIR_CONTINUITY, `${kind}.yaml`);
    await writeFile(file, `# ${kind}清单。一条一个，编号由「${kind} 新建」自动分配。\n`, 'utf8');
  }

  return root;
}
