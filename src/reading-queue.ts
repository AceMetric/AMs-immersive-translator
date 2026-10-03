export type ReadingPosition={id:string;order:number;top:number;bottom:number};
// Recompute at dispatch time. Visible paragraphs stay in document order even
// when the first paragraph starts above the viewport and spans several screens.
export function readingWindow<T extends ReadingPosition>(items:T[],height:number):T[]{
  const band=(p:T)=>p.bottom>0&&p.top<height?0:p.top>=height?1:2;
  return items.filter(p=>p.bottom>=-300&&p.top<=height+500).sort((a,b)=>band(a)-band(b)||a.order-b.order);
}
