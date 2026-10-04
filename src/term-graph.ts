import {findTerms,termKey,inferDomain} from './glossary';
import type {Domain,Term} from './types';
type Meaning={definition:string;contexts:string[];source:string};
const meanings:Record<string,Meaning>={
 'math:field':{definition:'具有加法和乘法运算，非零元存在乘法逆元的代数结构。',contexts:['field extension','algebra','polynomial','Galois'],source:'https://leanprover-community.github.io/mathlib4_docs/Mathlib/Algebra/Field/Defs.html'},
 'physics:field':{definition:'在空间或时空的各点指定一个物理量的对象。',contexts:['electric','magnetic','electromagnetic','spacetime'],source:'https://www.feynmanlectures.caltech.edu/II_01.html'},
 'cs:field':{definition:'记录、数据库表或数据结构中的具名分量。',contexts:['database','record','column','struct'],source:'https://www.postgresql.org/docs/current/ddl-basics.html'},
 'math:kernel':{definition:'在线性映射语境中，被映到零的输入组成的集合；其他数学语境需再消歧。',contexts:['linear map','null space','homomorphism'],source:'https://leanprover-community.github.io/mathlib4_docs/Mathlib/LinearAlgebra/Basic.html'},
 'cs:kernel':{definition:'操作系统中管理硬件和系统资源的核心部分；学习方法中的核函数需另行消歧。',contexts:['operating system','system call','Linux','process'],source:'https://docs.kernel.org/'},
 'math:ring':{definition:'具有加法和乘法且满足相应代数公理的结构。',contexts:['algebra','ideal','polynomial'],source:'https://leanprover-community.github.io/mathlib4_docs/Mathlib/Algebra/Ring/Defs.html'},
 'math:group':{definition:'带有满足结合律、有单位元且每个元素有逆元的运算的集合。',contexts:['algebra','homomorphism','subgroup'],source:'https://leanprover-community.github.io/mathlib4_docs/Mathlib/Algebra/Group/Defs.html'},
 'math:linear map':{definition:'保持向量加法与标量乘法的映射。',contexts:['vector space','kernel','linear algebra'],source:'https://leanprover-community.github.io/mathlib4_docs/Mathlib/LinearAlgebra/Basic.html'},
 'physics:momentum':{definition:'描述运动状态的物理量；此处不采用机器学习优化器的词义。',contexts:['particle','conservation','mechanics'],source:'https://www.feynmanlectures.caltech.edu/I_09.html'},
 'cs:compiler':{definition:'将源语言程序转换为目标语言程序的工具。',contexts:['source code','syntax','code generation'],source:'https://llvm.org/docs/GettingStarted.html'},
};
export function enrichTerms(terms:Term[]):Term[]{return terms.map(t=>{const m=meanings[t.domain+':'+t.source.toLowerCase()];return m?{...t,definition:t.definition??m.definition,contexts:t.contexts?.length?t.contexts:m.contexts,sourceNote:(t.sourceNote??'')+' 消歧说明为项目原创整理；参考 '+m.source}:t;});}
export type TermEdge={from:string;to:string;weight:number;source:string};
// Reviewed one-hop concept relationships. They are not generated from cosine
// similarity or passage co-occurrence and never become mandatory translations.
export const conceptEdges:TermEdge[]=[
 {from:'linear map|math|linear map',to:'kernel|math|kernel',weight:.95,source:meanings['math:linear map']!.source},
 {from:'vector space|math|vector space',to:'linear map|math|linear map',weight:.9,source:meanings['math:linear map']!.source},
 {from:'polynomial|math|polynomial',to:'ring|math|ring',weight:.85,source:meanings['math:ring']!.source},
 {from:'field extension|math|field extension',to:'field|math|field',weight:.95,source:meanings['math:field']!.source},
 {from:'operating system|cs|operating system',to:'kernel|cs|kernel',weight:.95,source:meanings['cs:kernel']!.source},
 {from:'database|cs|database',to:'field|cs|field',weight:.8,source:meanings['cs:field']!.source},
];
export function graphHints(text:string,terms:Term[],domain:Domain,context='',edges=conceptEdges){
 if(domain==='auto')domain=inferDomain(context+' '+text);
 const eligible=terms.filter(t=>t.enabled&&(t.domain===domain||t.domain==='general'));
 const key=(t:Term)=>termKey(t);
 const seeds=new Set(findTerms(context+' '+text,eligible,domain,true).map(m=>key(m.term)));
 const degree=new Map<string,number>();for(const e of edges)degree.set(e.from,(degree.get(e.from)??0)+1);
 const score=new Map<string,number>();
 for(const edge of edges){if(edge.weight<.75||!seeds.has(edge.from))continue;const value=edge.weight/Math.sqrt(degree.get(edge.from)??1);score.set(edge.to,Math.max(score.get(edge.to)??0,value));}
 const seen=new Set<string>();let budget=700;
 return eligible.filter(t=>score.has(key(t))).sort((a,b)=>score.get(key(b))!-score.get(key(a))!||termKey(a).localeCompare(termKey(b))).flatMap(t=>{
   const id=termKey(t);if(seen.has(id)||budget<=0)return [];seen.add(id);
   const sense=(t.definition??t.sense).slice(0,120);const cost=t.source.length+t.target.length+sense.length;if(cost>budget)return [];budget-=cost;return [{source:t.source,target:t.target,sense}];
 }).slice(0,8);
}
