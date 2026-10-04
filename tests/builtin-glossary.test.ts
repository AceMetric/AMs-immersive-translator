import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { lockTerms, findTerms } from '../src/glossary';
import type { Term } from '../src/types';
import { enrichTerms } from '../src/term-graph';

const core = (domain: string): Term[] => JSON.parse(readFileSync(
  `public/glossaries/core-${domain}.json`, 'utf8',
)).terms;

describe('built-in terminology in real sentences', () => {
  it('selects mathematical remainder and permutation senses from their actual context',()=>{
    const terms=core('math');
    const target=(text:string,word:string)=>findTerms(text,terms,'math').find(m=>m.term.source===word)?.term.target;
    expect(target('The Taylor series has a remainder.','remainder')).toBe('余项');
    expect(target('Integer division gives a quotient and a remainder.','remainder')).toBe('余数');
    expect(target('A permutation is a bijection in the symmetric group.','permutation')).toBe('置换');
    expect(target('Count the permutation arrangements in combinatorics.','permutation')).toBe('排列');
    expect(target('A remainder appears here.','remainder')).toBeUndefined();
  });
  it('keeps numerical precision, database normalization and sampling temperature distinct',()=>{
    const terms=core('cs');
    const target=(text:string,word:string)=>findTerms(text,terms,'cs').find(m=>m.term.source===word)?.term.target;
    expect(target('Floating-point precision controls rounding.','precision')).toBe('精度');
    expect(target('Classification precision and recall are metrics.','precision')).toBe('精确率');
    expect(target('Database normalization removes functional dependency anomalies.','normalization')).toBe('规范化');
    expect(target('Feature scaling uses min-max normalization.','normalization')).toBe('归一化');
    expect(target('Adjust the temperature for sampling from logits.','temperature')).toBe('温度参数');
    expect(target('The GPU temperature rises during cooling failure.','temperature')).toBe('温度');
  });
  it('does not force a narrow sense when only unrelated words or substrings match',()=>{
    const terms=enrichTerms(core('cs'));
    expect(findTerms('Preprocess a kernel for a learning algorithm.',terms,'cs').some(m=>m.term.source==='kernel')).toBe(false);
    expect(findTerms('A Linux kernel handles a system call.',terms,'cs').find(m=>m.term.source==='kernel')?.term.target).toBe('内核');
    expect(findTerms('The switch statement selects a branch.',terms,'cs').some(m=>m.term.source==='switch')).toBe(false);
    expect(findTerms('The Ethernet switch forwards traffic.',terms,'cs').find(m=>m.term.source==='switch')?.term.target).toBe('交换机');
    expect(findTerms('The signal passes through a low-pass anti-aliasing filter.',terms,'cs').find(m=>m.term.source==='anti-aliasing')?.term.target).toBe('抗混叠');
    expect(findTerms('Rendering pixel edges uses anti-aliasing.',terms,'cs').find(m=>m.term.source==='anti-aliasing')?.term.target).toBe('抗锯齿');
    const user={...terms.find(t=>t.source==='kernel')!,quality:'user' as const,target:'用户指定核'};
    expect(findTerms('The kernel is here.',[...terms,user],'cs').find(m=>m.term.source==='kernel')?.term.target).toBe('用户指定核');
    expect(findTerms('The integral has upper limit 1.',core('math'),'math').some(m=>m.term.source==='limit')).toBe(false);
  });
  it('distinguishes the ray path from its refractive-index-weighted length', () => {
    const hits = findTerms('The optical path length depends on the medium along the optical path.', core('physics'), 'physics');
    expect(hits.filter(hit => hit.term.source.startsWith('optical path')).map(hit => [hit.matched, hit.term.target]))
      .toEqual([['optical path length', '光程'], ['optical path', '光路']]);
  });

  it('keeps disjoint subsets distinct from the union-find data structure', () => {
    const terms = core('cs');
    const plain = lockTerms('Partition the vertices into disjoint sets.', terms, 'cs', 'plain');
    expect(Object.values(plain.literals)).not.toContain('并查集');
    for (const name of ['disjoint-set data structure', 'union-find', 'union–find', 'disjoint-set union']) {
      const result = lockTerms(`Use a ${name} to maintain the partition.`, terms, 'cs', 'dsu');
      expect(Object.values(result.literals)).toContain('并查集');
    }
    expect(findTerms('a union-finder object', terms, 'cs').some(m => m.term.target === '并查集')).toBe(false);
  });
});
