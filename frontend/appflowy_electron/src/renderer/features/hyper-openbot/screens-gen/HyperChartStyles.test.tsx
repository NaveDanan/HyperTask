import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { HyperAreaChartCard, HyperLineChartCard, HyperPieChartCard } from './charts';

it('uses supported radius tokens for shared line and area legends', () => {
  const args = { labels: ['One', 'Two'], series: [{ name: 'A', values: [1, 2] }, { name: 'B', values: [2, 3] }] };
  for (const Chart of [HyperLineChartCard, HyperAreaChartCard]) {
    const html = renderToStaticMarkup(<Chart {...args} />);
    expect(html).toContain('size-2 shrink-0 rounded-md');
    expect(html).not.toContain('rounded-[');
  }
});
it('uses the supported small-control radius for pie legend markers', () => {
  const html = renderToStaticMarkup(<HyperPieChartCard points={[{ label: 'One', value: 1 }, { label: 'Two', value: 2 }]} />);
  expect(html).toContain('size-2.5 shrink-0 rounded-md');
  expect(html).not.toContain('rounded-[');
});
