import type { Command } from 'commander';
import { validateDataset } from '../core/validate.js';
import { loadDataset, printDiagnostics } from './shared.js';

export function registerCheck(program: Command): void {
  program
    .command('校验')
    .description('全量检查：结构硬错 + 内容提醒。有硬错时退出码为 2')
    .option('--只硬错', '只看结构问题，忽略提醒')
    .option('--只提醒', '只看提醒，忽略硬错')
    .action(async (options: { 只硬错?: boolean; 只提醒?: boolean }) => {
      const dataset = await loadDataset();
      const diagnostics = validateDataset(dataset);

      const shown = options.只硬错
        ? diagnostics.filter((item) => item.severity === '硬错')
        : options.只提醒
          ? diagnostics.filter((item) => item.severity === '提醒')
          : diagnostics;

      printDiagnostics(shown);

      const hasHard = diagnostics.some((item) => item.severity === '硬错');
      if (hasHard) process.exitCode = 2;
    });
}
