// Conservative contradiction evidence: same explicit subject and predicate,
// opposite polarity in different records. Defect vocabulary is not a denial.
export function hasOppositeClaims(texts: string[]): boolean {
  const claims: {key:string; negative:boolean; record:number}[] = [];
  texts.forEach((text,record)=>{
    for (const sentence of text.split(/[.!?。！？\n]+/u)) {
      const match = /^\s*(.{2,120}?)\s+(?:is|are|was|were)\s+(not\s+)?(available|released|confirmed|true|supported|enabled)\s*$/iu.exec(sentence);
      if (match) claims.push({key:(match[1]+' '+match[3]).toLowerCase().replace(/\s+/g,' ').trim(),negative:Boolean(match[2]),record});
      const chinese = /^\s*(.{2,80}?)(尚未|没有|未|已|已经)(发布|上线|开放|确认)\s*$/u.exec(sentence);
      if (chinese) claims.push({key:chinese[1]+chinese[3],negative:['尚未','没有','未'].includes(chinese[2]),record});
    }
  });
  return claims.some(a=>claims.some(b=>a.record!==b.record && a.key===b.key && a.negative!==b.negative));
}
