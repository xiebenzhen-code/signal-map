import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { deflateRawSync } from 'node:zlib';
import { compareAnnotations, readAnnotationWorkbook } from '../scripts/compare-annotations.mjs';

// Entirely invented cases; never load a real annotation workbook or PRIVATE report.
const labels = ['必看','值得看但可以折叠','存档即可','不相关','材料不够，看不出'];
const human = (id, label, choice = 'S-02') => ({ caseId:'S', entryId:id, label, choice });
function fixture() {
 return {cases:[{id:'S', planMode:'frozen', fetchedCount:8,
  entries:[
   {entryId:'S-01',clusterId:'main',destination:'FORMAL_ATTENTION'},
   {entryId:'S-02',clusterId:'main',destination:'FORMAL_ATTENTION'},
   {entryId:'S-03',clusterId:'fold',destination:'RELATED_UPDATE'},
   {entryId:'S-04',clusterId:'fold',destination:'RELATED_UPDATE'},
   {entryId:'S-05',clusterId:'unknown',destination:'RELATED_UPDATE'},
   {entryId:'S-06',clusterId:'drop',destination:'FILTERED',reason:'TOPIC_MISMATCH'},
   {entryId:'S-07',clusterId:'lib',destination:'LIBRARY_ONLY'},
   {entryId:'S-08',clusterId:null,destination:'NOT_RETAINED_BEFORE_CLUSTER'}],
  formalItems:[{id:'main',attentionDecision:'MUST_READ',relatedUpdates:[{id:'fold'},{id:'unknown'}]}],
  filteringDetails:[{id:'lib',reason:'LOW_RELIABILITY'}]}]};
}
function annotations() {return [human('S-01',labels[0]),human('S-02',labels[0]),human('S-03',labels[1]),human('S-04',labels[2]),human('S-05',labels[4]),human('S-06',labels[0]),human('S-07',labels[1]),human('S-08',labels[4])];}

test('cluster membership drives main hit, item recall, fold noise and private misses', () => {
 const result=compareAnnotations(annotations(),fixture());
 const row=result.public.cases[0];
 assert.equal(row.mainHit.value,1);
 assert.deepEqual(row.mustReadRecall,{numerator:2,denominator:3,value:2/3});
 assert.deepEqual(row.foldNoise,{numerator:1,denominator:2,value:0.5});
 assert.equal(row.unknownCount,2);
 assert.equal(row.falseKillCount,2);
 assert.equal(row.systemCompression.value,8);
 assert.equal(row.humanCompression.value,8/3);
 assert.deepEqual(result.private.cases[0].falseKills.map(x=>x.reasonCodes),[['TOPIC_MISMATCH'],['LOW_RELIABILITY']]);
 const serialized=JSON.stringify(result.public);
 assert.ok(!serialized.includes('S-06') && !serialized.includes('TOPIC_MISMATCH'));
});

test('none choice records hard push; no system main is not hard push', () => {
 const rows=annotations().map(x=>({...x,choice:'都不用看'}));
 assert.equal(compareAnnotations(rows,fixture()).public.cases[0].hardPushCount,1);
 const system=fixture();system.cases[0].formalItems=[];
 system.cases[0].entries.forEach(x=>{if(['FORMAL_ATTENTION','RELATED_UPDATE'].includes(x.destination))x.destination='FILTERED';});
 assert.equal(compareAnnotations(rows,system).public.cases[0].hardPushCount,0);
});

test('all unknown and zero denominators yield null, never 0 or perfect accuracy', () => {
 const result=compareAnnotations(annotations().map(x=>({...x,label:labels[4],choice:''})),fixture());
 const row=result.public.cases[0];
 assert.equal(row.mainHit.value,null);assert.equal(row.mustReadRecall.value,null);
 assert.equal(row.foldNoise.value,null);assert.equal(row.humanCompression.value,null);
 assert.equal(row.unknownCount,8);assert.equal(row.falseKillCount,0);
});
test('an empty retrieved case has no fabricated success or compression ratio',()=>{
 const row=compareAnnotations([],{cases:[{id:'EMPTY',fetchedCount:0,entries:[],formalItems:[]}]}).public.cases[0];
 assert.equal(row.mainHit.value,null);assert.equal(row.foldNoise.value,null);
 assert.equal(row.systemCompression.value,null);assert.equal(row.humanCompression.value,null);
 assert.equal(row.falseKillCount,0);assert.equal(row.hardPushCount,0);
});

test('summary uses pooled numerators, and never mixes frozen and rebuilt runs', () => {
 const system=fixture();system.cases.push({...system.cases[0],planMode:'rebuilt'});
 const result=compareAnnotations(annotations(),system);
 assert.equal(result.public.cases.length,2);assert.equal(result.public.totals.length,2);
 assert.ok(result.public.totals.every(x=>x.mustReadRecall.denominator===3));
});

test('case totals pool counts rather than averaging percentages; zero-main compression is N/A',()=>{
 const system=fixture();
 system.cases.push({id:'T',planMode:'frozen',fetchedCount:2,entries:[
  {entryId:'T-01',clusterId:null,destination:'FILTERED',reason:'STALE'},
  {entryId:'T-02',clusterId:null,destination:'FILTERED'}],formalItems:[]});
 const rows=[...annotations(),{caseId:'T',entryId:'T-01',label:'必看',choice:'T-01'},
  {caseId:'T',entryId:'T-02',label:labels[4],choice:'T-01'}];
 const report=compareAnnotations(rows,system).public;
 assert.equal(report.cases[1].systemCompression.value,null);
 assert.deepEqual(report.totals[0].mustReadRecall,{numerator:2,denominator:4,value:0.5});
 assert.equal(report.totals[0].systemCompression.value,10);
 assert.equal(report.totals[0].mainHit.value,0.5);
});

test('possible-related recommendations stay pending; background misses do not invent reason codes',()=>{
 const system=fixture();
 system.cases[0].entries[5].destination='BACKGROUND';delete system.cases[0].entries[5].reason;
 system.cases[0].entries[6].destination='POSSIBLE_RELATED';
 const result=compareAnnotations(annotations(),system);
 assert.equal(result.public.cases[0].falseKillCount,1);
 assert.equal(result.public.cases[0].falseKillReasonMissingCount,1);
 assert.equal(result.public.cases[0].pendingRecommendedCount,1);
 assert.deepEqual(result.private.cases[0].falseKills[0].reasonCodes,[]);
});

test('incomplete labels, duplicate IDs, unknown labels and unmapped clusters fail closed', () => {
 assert.throws(()=>compareAnnotations(annotations().slice(1),fixture()),/ANNOTATION_SET_MISMATCH/);
 assert.throws(()=>compareAnnotations([...annotations(),annotations()[0]],fixture()),/DUPLICATE_ENTRY/);
 assert.throws(()=>compareAnnotations(annotations().map((x,i)=>i?x:{...x,label:'maybe'}),fixture()),/UNKNOWN_LABEL/);
 const system=fixture();system.cases[0].formalItems[0].id='absent';
 assert.throws(()=>compareAnnotations(annotations(),system),/UNMAPPED_CLUSTER/);
});

test('only unannotated BACKGROUND entries may be omitted from the annotation subset',()=>{
 const system=fixture();system.cases[0].entries.push({entryId:'S-09',clusterId:null,destination:'BACKGROUND'});
 system.cases[0].fetchedCount=9;
 const report=compareAnnotations(annotations(),system);
 assert.equal(report.public.cases[0].unannotatedBackgroundCount,1);
 assert.equal(report.public.cases[0].annotatedCount,8);
 assert.equal(report.public.cases[0].mustReadRecall.denominator,3);
 assert.equal(report.private.cases[0].entries.at(-1).humanLabel,null);
 for(const destination of ['FILTERED','NOT_RETAINED_BEFORE_CLUSTER','POSSIBLE_RELATED','LIBRARY_ONLY','FORMAL_ATTENTION','RELATED_UPDATE']){
  system.cases[0].entries.at(-1).destination=destination;
  assert.throws(()=>compareAnnotations(annotations(),system),/ANNOTATION_SET_MISMATCH/);
 }
 assert.throws(()=>compareAnnotations([...annotations(),human('S-10','必看')],fixture()),/ANNOTATION_SET_MISMATCH/);
});

test('must-read recall separates main, folded and WORTH_WATCHING membership',()=>{
 const system=fixture();system.cases[0].entries[5]={entryId:'S-06',clusterId:'early',destination:'FORMAL_ATTENTION'};
 system.cases[0].formalItems.push({id:'early',attentionDecision:'WORTH_WATCHING'});
 const row=compareAnnotations(annotations(),system).public.cases[0];
 assert.deepEqual(row.mustReadRecallMain,{numerator:2,denominator:3,value:2/3});
 assert.deepEqual(row.mustReadRecallFolded,{numerator:0,denominator:3,value:0});
 assert.deepEqual(row.mustReadRecallWorthWatching,{numerator:1,denominator:3,value:1/3});
 assert.deepEqual(row.mustReadRecall,{numerator:3,denominator:3,value:1});
 assert.equal(row.systemMainCount,1);
 assert.equal(row.worthWatchingClusterCount,1);
 assert.equal(row.falseKillCount,1);
});

test('blank background rows preserve the case choice and cannot hide choice conflicts',()=>{
 const system=fixture();system.cases[0].entries.push({entryId:'S-09',clusterId:null,destination:'BACKGROUND'});system.cases[0].fetchedCount=9;
 const rows=annotations().map(x=>({...x,choice:''}));rows.push(human('S-09','','都不用看'));
 assert.equal(compareAnnotations(rows,system).public.cases[0].hardPushCount,1);
 rows[0].choice='S-01';
 assert.throws(()=>compareAnnotations(rows,system),/CONFLICTING_HUMAN_CHOICE/);
});

// Minimal synthetic XLSX ZIP (stored entries), using standard OOXML paths.
function crc32(bytes){let c=0xffffffff;for(const byte of bytes){c^=byte;for(let n=0;n<8;n++)c=(c>>>1)^((c&1)?0xedb88320:0);}return (c^0xffffffff)>>>0;}
function workbook(rows, shared=false, compressed=false, choices, prefixed=false, formulaCell) {
 const escape=s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;');
 const strings=[];
 const xml=rows.map((row,i)=>`<row r="${i+1}">${row.map((v,j)=>{
  const ref=`${String.fromCharCode(65+j)}${i+1}`;
  if(shared){strings.push(v);return `<c r="${ref}" t="s"><v>${strings.length-1}</v></c>`;}
  return `<c r="${ref}" t="inlineStr"><is><t>${escape(v)}</t></is></c>`;
 }).join('')}</row>`).join('');
 const files={
  'xl/workbook.xml':'<workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Synthetic" r:id="rId1"/></sheets></workbook>',
  'xl/_rels/workbook.xml.rels':'<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>',
  'xl/worksheets/sheet1.xml':`<worksheet><sheetData>${xml}</sheetData></worksheet>`,
  'xl/sharedStrings.xml':`<sst>${strings.map(x=>`<si><t>${escape(x)}</t></si>`).join('')}</sst>`};
 if(choices){
  files['xl/workbook.xml']=files['xl/workbook.xml'].replace('</sheets>','<sheet name="SyntheticChoices" r:id="rId2"/></sheets>');
  files['xl/_rels/workbook.xml.rels']=files['xl/_rels/workbook.xml.rels'].replace('</Relationships>','<Relationship Id="rId2" Target="worksheets/sheet2.xml"/></Relationships>');
  files['xl/worksheets/sheet2.xml']=`<worksheet><sheetData>${choices.map((row,i)=>`<row r="${i+1}">${row.map((v,j)=>`<c r="${String.fromCharCode(65+j)}${i+1}" t="inlineStr"><is><t>${escape(v)}</t></is></c>`).join('')}</row>`).join('')}</sheetData></worksheet>`;
 }
 if(prefixed)for(const name of ['xl/workbook.xml','xl/worksheets/sheet1.xml','xl/sharedStrings.xml']){
  files[name]=files[name].replace(/<(\/?)([A-Za-z][\w]*)(?=[\s/>])/g,'<$1sml:$2')
   .replace(/^(<sml:\w+)/,'$1 xmlns:sml="http://schemas.openxmlformats.org/spreadsheetml/2006/main"');
 }
 if(formulaCell){const [part,ref]=formulaCell;files[part]=files[part].replace(new RegExp(`<c r="${ref}"[^>]*>[\\s\\S]*?<\\/c>`),`<c r="${ref}"><f>1+1</f><v>2</v></c>`);}
 const local=[],central=[];let offset=0;
 for(const [name,text] of Object.entries(files)){
  const n=Buffer.from(name),b=Buffer.from(text),packed=compressed?deflateRawSync(b):b,h=Buffer.alloc(30),c=Buffer.alloc(46);
  h.writeUInt32LE(0x04034b50);h.writeUInt16LE(compressed?8:0,8);h.writeUInt32LE(crc32(b),14);h.writeUInt32LE(packed.length,18);h.writeUInt32LE(b.length,22);h.writeUInt16LE(n.length,26);
  c.writeUInt32LE(0x02014b50);c.writeUInt16LE(compressed?8:0,10);c.writeUInt32LE(crc32(b),16);c.writeUInt32LE(packed.length,20);c.writeUInt32LE(b.length,24);c.writeUInt16LE(n.length,28);c.writeUInt32LE(offset,42);
  local.push(h,n,packed);central.push(c,n);offset+=h.length+n.length+packed.length;
 }
 const directory=Buffer.concat(central),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(Object.keys(files).length,8);end.writeUInt16LE(Object.keys(files).length,10);end.writeUInt32LE(directory.length,12);end.writeUInt32LE(offset,16);
 return Buffer.concat([...local,directory,end]);
}
function rows(){return [['条目ID','案例','标签','只能看一条'],...annotations().map(x=>[x.entryId,x.caseId,x.label,x.choice])];}
test('XLSX inline and shared strings parse only synthetic label columns',()=>{
 for(const shared of [false,true])for(const compressed of [false,true])assert.deepEqual(readAnnotationWorkbook(workbook(rows(),shared,compressed)),annotations());
});

test('prefixed OOXML and legacy template labels parse without changing the workbook',()=>{
 const input=[['条目ID','批次','问题或任务','标签'],
  ['S-01','S-UNCERTAIN','invented question','必看'],
  ['S-02','S-UNCERTAIN','invented question','可看'],
  ['S-03','S-UNCERTAIN','invented question','可忽略'],
  ['S-04','S-UNCERTAIN','invented question','材料不足']];
 const bytes=workbook(input,true,true,undefined,true),before=Buffer.from(bytes);
 const parsed=readAnnotationWorkbook(bytes);
 assert.deepEqual(parsed.map(x=>x.label),['必看','值得看但可以折叠','不相关','材料不够，看不出']);
 assert.ok(parsed.every(x=>x.caseId==='S'&&x.choice===''));
 assert.deepEqual(bytes,before);
});

test('instruction-sheet formulas are ignored but formulas in label fields are rejected',()=>{
 const sheets=[['说明','统计'],['total','placeholder']];
 assert.deepEqual(readAnnotationWorkbook(workbook(rows(),false,true,sheets,false,['xl/worksheets/sheet2.xml','B2'])),annotations());
 assert.throws(()=>readAnnotationWorkbook(workbook(rows(),false,true,undefined,false,['xl/worksheets/sheet1.xml','C2'])),/FORMULAS_NOT_SUPPORTED/);
});

test('legacy template example is not a human label and blank background rows remain blank',()=>{
 const input=[['条目ID','批次','标签'],['示例-0','示例','必看'],['S-01','S-UNCERTAIN','必看'],['S-02','S-UNCERTAIN','']];
 assert.deepEqual(readAnnotationWorkbook(workbook(input)),[
  {entryId:'S-01',caseId:'S',label:'必看',choice:''},{entryId:'S-02',caseId:'S',label:'',choice:''}]);
});
test('XLSX batch suffix and row selection markers map without reading instruction text',()=>{
 const input=[['条目ID','批次','标签','只能看一条'],['S-01','S-UNCERTAIN','必看','是'],['S-02','S-UNCERTAIN','存档即可','']];
 const result=readAnnotationWorkbook(workbook(input));
 assert.ok(result.every(x=>x.caseId==='S'&&x.choice==='S-01'));
 const invalid=workbook(rows());invalid[invalid.length-1]=1;
 assert.throws(()=>readAnnotationWorkbook(invalid),/INVALID_XLSX_ZIP/);
});
test('separate choice sheets recognize all case-column aliases and retain none-choice hard pushes',()=>{
 for(const header of ['案例','案例ID','批次']){
  const materials=rows().map(row=>row.slice(0,3));
  const parsed=readAnnotationWorkbook(workbook(materials,false,true,[[header,'只能看一条'],['S','都不用看']]));
  assert.ok(parsed.every(x=>x.choice==='都不用看'));
  assert.equal(compareAnnotations(parsed,fixture()).public.cases[0].hardPushCount,1);
 }
});

test('a separate choice workbook joins by case without rewriting the annotation workbook',()=>{
 const materials=workbook(rows().map(row=>row.slice(0,3)));
 const choices=workbook([['案例','只能看一条'],['S','S-02']]);
 assert.deepEqual(readAnnotationWorkbook(materials,choices),annotations());
 const conflict=workbook([['案例','只能看一条'],['S','S-01']]);
 assert.throws(()=>readAnnotationWorkbook(workbook(rows()),conflict),/CONFLICTING_HUMAN_CHOICE/);
});
test('CLI writes public aggregates and PRIVATE differences without modifying inputs',()=>{
 const dir=mkdtempSync(join(tmpdir(),'annotation-synthetic-'));
 try {
  const xlsx=join(dir,'synthetic.xlsx'),json=join(dir,'PRIVATE-synthetic.json'),out=join(dir,'out');
  writeFileSync(xlsx,workbook(rows()));writeFileSync(json,JSON.stringify(fixture()));
  const before=readFileSync(xlsx);
  const run=spawnSync(process.execPath,['scripts/compare-annotations.mjs','--annotations',xlsx,'--system',json,'--output-dir',out],{encoding:'utf8'});
  assert.equal(run.status,0,run.stderr);
  assert.deepEqual(readdirSync(out).sort(),['PRIVATE-differences.json','summary.json','summary.md']);
  assert.deepEqual(readFileSync(xlsx),before);
  assert.ok(!readFileSync(join(out,'summary.md'),'utf8').includes('S-06'));
  assert.ok(!run.stdout.includes('S-06'));
  const again=spawnSync(process.execPath,['scripts/compare-annotations.mjs','--annotations',xlsx,'--system',json,'--output-dir',out],{encoding:'utf8'});
  assert.notEqual(again.status,0,'must never overwrite old comparison output');
 } finally {rmSync(dir,{recursive:true,force:true});}
});
