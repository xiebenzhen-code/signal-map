#!/usr/bin/env node
/** Offline only. Importing does not read files; CLI opens only its two explicit inputs. */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, posix } from 'node:path';
import { pathToFileURL } from 'node:url';
import { inflateRawSync } from 'node:zlib';

const UNKNOWN = '材料不够，看不出';
const FORMULA = Symbol('formula');
const LABELS = new Set(['必看','值得看但可以折叠','存档即可','不相关',UNKNOWN]);
const LABEL_ALIASES = new Map([['可看','值得看但可以折叠'],['可忽略','不相关'],['材料不足',UNKNOWN]]);
const DESTINATIONS = new Set(['FORMAL_ATTENTION','RELATED_UPDATE','LIBRARY_ONLY','POSSIBLE_RELATED','FILTERED','NOT_RETAINED_BEFORE_CLUSTER','BACKGROUND']);
const fail = code => { throw new Error(code); };
const ratio = (numerator, denominator) => ({numerator, denominator, value:denominator ? numerator / denominator : null});
const array = value => Array.isArray(value) ? value : fail('INVALID_ARRAY');
const id = value => typeof value === 'string' && value.trim() ? value.trim() : fail('INVALID_ID');
const publicId = value => /^[A-Za-z0-9_.-]{1,80}$/.test(id(value)) ? value : fail('INVALID_PUBLIC_CASE_ID');

function crc32(bytes) {
 let c=0xffffffff;
 for(const byte of bytes){c^=byte;for(let n=0;n<8;n++)c=(c>>>1)^((c&1)?0xedb88320:0);}
 return (c^0xffffffff)>>>0;
}

/** Small bounded OOXML reader: stored/deflated ZIP, inline/shared strings; no macros or formula evaluation. */
function unzip(bytes) {
 if(bytes.length>64*1024*1024)fail('XLSX_TOO_LARGE');
 let end=-1;
 for(let i=bytes.length-22;i>=Math.max(0,bytes.length-65557);i--){
  if(bytes.readUInt32LE(i)===0x06054b50 && i+22+bytes.readUInt16LE(i+20)===bytes.length){end=i;break;}
 }
 if(end<0)fail('INVALID_XLSX_ZIP');
 if(bytes.readUInt16LE(end+4)||bytes.readUInt16LE(end+6))fail('UNSUPPORTED_MULTIDISK_ZIP');
 const count=bytes.readUInt16LE(end+10),directory=bytes.readUInt32LE(end+16);
 if(count>2048 || count===65535 || directory>bytes.length)fail('XLSX_ZIP_LIMIT');
 const files=new Map();let cursor=directory,total=0;
 for(let n=0;n<count;n++){
  if(cursor+46>bytes.length || bytes.readUInt32LE(cursor)!==0x02014b50)fail('INVALID_XLSX_ZIP');
  const flags=bytes.readUInt16LE(cursor+8),method=bytes.readUInt16LE(cursor+10),crc=bytes.readUInt32LE(cursor+16);
  const compressed=bytes.readUInt32LE(cursor+20),size=bytes.readUInt32LE(cursor+24);
  const nameLength=bytes.readUInt16LE(cursor+28),extra=bytes.readUInt16LE(cursor+30),comment=bytes.readUInt16LE(cursor+32),offset=bytes.readUInt32LE(cursor+42);
  const name=bytes.subarray(cursor+46,cursor+46+nameLength).toString('utf8');
  if(flags&1 || ![0,8].includes(method) || size>8*1024*1024 || offset+30>bytes.length)fail('UNSUPPORTED_XLSX_ZIP');
  if(name.includes('..') || name.startsWith('/') || name.includes('\\') || files.has(name))fail('UNSAFE_XLSX_ZIP_PATH');
  if(bytes.readUInt32LE(offset)!==0x04034b50)fail('INVALID_XLSX_ZIP');
  const start=offset+30+bytes.readUInt16LE(offset+26)+bytes.readUInt16LE(offset+28);
  if(start+compressed>bytes.length)fail('INVALID_XLSX_ZIP');
  const packed=bytes.subarray(start,start+compressed);
  const data=method===0 ? packed : inflateRawSync(packed,{maxOutputLength:8*1024*1024});
  total+=data.length;
  if(data.length!==size || total>32*1024*1024 || crc32(data)!==crc)fail('XLSX_INTEGRITY_OR_SIZE');
  files.set(name,data.toString('utf8'));cursor+=46+nameLength+extra+comment;
 }
 return files;
}
function xmlText(text) {
 if(/<!DOCTYPE|<!ENTITY/i.test(text))fail('UNSUPPORTED_XML_DECLARATION');
 const prefixes=[...text.matchAll(/xmlns:([\w]+)=["']http:\/\/schemas\.openxmlformats\.org\/(?:spreadsheetml\/2006\/main|package\/2006\/relationships)["']/g)].map(x=>x[1]);
 for(const prefix of prefixes)text=text.replace(new RegExp(`<(/?)${prefix}:`,'g'),'<$1');
 return text;
}
function decode(text) {
 const named={amp:'&',lt:'<',gt:'>',quot:'"',apos:"'"};
 return text.replace(/&([^;]+);/g,(_,entity)=>{
  if(Object.hasOwn(named,entity))return named[entity];
  if(/^#x[\da-f]+$/i.test(entity) || /^#\d+$/.test(entity)){
   const number=entity[1]==='x'||entity[1]==='X' ? parseInt(entity.slice(2),16) : Number(entity.slice(1));
   if(number>0x10ffff || number<0 || (number>=0xd800 && number<=0xdfff))fail('INVALID_XML_ENTITY');
   return String.fromCodePoint(number);
  }
  return fail('UNKNOWN_XML_ENTITY');
 });
}
function attrs(text){return Object.fromEntries([...text.matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)].map(x=>[x[1],decode(x[2]??x[3])]));}
function texts(xml){return [...xml.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map(x=>decode(x[1])).join('');}
function sheetRows(xml, strings) {
 xml=xmlText(xml);
 return [...xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)].map(row=>{
  const cells=[];
  for(const cell of row[1].matchAll(/<c\b([^>]*)(?:\/>|>([\s\S]*?)<\/c>)/g)){
   const a=attrs(cell[1]),body=cell[2]??'';
   const letters=a.r?.match(/^[A-Z]+/)?.[0];if(!letters)fail('INVALID_CELL_REFERENCE');
   const column=[...letters].reduce((n,c)=>n*26+c.charCodeAt(0)-64,0)-1;
   if(column>1023)fail('XLSX_COLUMN_LIMIT');
   if(/<f\b/.test(body)){cells[column]=FORMULA;continue;}
   const value=body.match(/<v\b[^>]*>([\s\S]*?)<\/v>/)?.[1]??'';
   if(a.t==='s' && (!/^\d+$/.test(value) || strings[Number(value)]===undefined))fail('INVALID_SHARED_STRING');
   cells[column]=(a.t==='s' ? strings[Number(value)] : a.t==='inlineStr' ? texts(body) : decode(value)).trim();
  }
  return cells;
 });
}

export function readAnnotationWorkbook(bytes, choiceBytes) {
 const result=[],selections=new Map();
 for(const input of [bytes,choiceBytes].filter(Boolean)){
 const files=unzip(input),get=name=>xmlText(files.get(name)??fail('MISSING_XLSX_PART'));
 const strings=[...xmlText(files.get('xl/sharedStrings.xml')??'').matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)].map(x=>texts(x[1]));
 const relationships=new Map([...get('xl/_rels/workbook.xml.rels').matchAll(/<Relationship\b([^>]*?)\/?\s*>/g)].map(x=>{const a=attrs(x[1]);return [a.Id,a];}));
 for(const sheet of get('xl/workbook.xml').matchAll(/<sheet\b([^>]*?)\/?\s*>/g)){
  const relation=relationships.get(attrs(sheet[1])['r:id']);
  if(!relation || relation.TargetMode==='External')fail('UNSUPPORTED_SHEET_RELATIONSHIP');
  const target=posix.normalize(relation.Target.startsWith('/') ? relation.Target.slice(1) : posix.join('xl',relation.Target));
  if(!target.startsWith('xl/worksheets/'))fail('UNSUPPORTED_SHEET_PATH');
  const rows=sheetRows(get(target),strings);
  const headerIndex=rows.findIndex(row=>row.includes('条目ID') && (row.includes('标签')||row.includes('人工标注')) || ['案例','案例ID','批次'].some(name=>row.includes(name))&&row.includes('只能看一条'));
  if(headerIndex<0)continue; // Instruction sheets are not annotation data.
  const h=rows[headerIndex],column=(row,...names)=>{
   const value=row[h.findIndex(x=>names.includes(x))]??'';
   return value===FORMULA ? fail('FORMULAS_NOT_SUPPORTED') : value;
  };
  for(const row of rows.slice(headerIndex+1)){
   const entryId=column(row,'条目ID'),caseValue=column(row,'案例','案例ID','批次');
   if(!entryId && !caseValue)continue;
   if(entryId==='示例-0'&&caseValue==='示例')continue;
   const caseId=(caseValue || entryId.replace(/-\d+$/,'')).replace(/-UNCERTAIN$/,'');
   let choice=column(row,'只能看一条');
   if(['是','选这条','✓'].includes(choice))choice=entryId;
   if(choice){if(selections.has(caseId)&&selections.get(caseId)!==choice)fail('CONFLICTING_HUMAN_CHOICE');selections.set(caseId,choice);}
   if(entryId){
    const label=column(row,'标签','人工标注').replace('材料不够,看不出',UNKNOWN);
    result.push({caseId,entryId,label:LABEL_ALIASES.get(label)??label});
   }
  }
 }
 }
 if(!result.length)fail('NO_ANNOTATION_ROWS');
 return result.map(row=>({...row,choice:selections.get(row.caseId)??''}));
}

function metricsForCase(annotations, run) {
 const caseId=publicId(run.id),planMode=publicId(run.planMode??'system');
 if(!Number.isInteger(run.fetchedCount)||run.fetchedCount<0)fail('INVALID_FETCHED_COUNT');
 const rows=new Map();
 for(const row of annotations){
  if(row.caseId!==caseId)continue;
  if(rows.has(id(row.entryId)))fail('DUPLICATE_ENTRY');
  if(!LABELS.has(row.label)&&row.label!=='')fail('UNKNOWN_LABEL');rows.set(row.entryId,row);
 }
 const entries=array(run.entries),seen=new Set(),clusters=new Map();
 for(const entry of entries){
  if(seen.has(id(entry.entryId)))fail('DUPLICATE_SYSTEM_ENTRY');seen.add(entry.entryId);
  if(!rows.get(entry.entryId)?.label&&entry.destination!=='BACKGROUND')fail('ANNOTATION_SET_MISMATCH');
  if(!DESTINATIONS.has(entry.destination))fail('UNKNOWN_DESTINATION');
  if(entry.clusterId){const members=clusters.get(entry.clusterId)??[];members.push(entry.entryId);clusters.set(entry.clusterId,members);}
 }
 if([...rows.keys()].some(key=>!seen.has(key)))fail('ANNOTATION_SET_MISMATCH');
 const unannotatedBackgroundCount=entries.filter(entry=>!rows.get(entry.entryId)?.label).length;
 if(run.fetchedCount<entries.length)fail('FETCHED_COUNT_SMALLER_THAN_ENTRIES');
 const choices=new Set([...rows.values()].map(row=>row.choice??'').filter(Boolean));
 if(choices.size>1)fail('CONFLICTING_HUMAN_CHOICE');
 const choice=[...choices][0]??'';
 if(choice && choice!=='都不用看'&&!rows.has(choice))fail('UNKNOWN_CHOSEN_ENTRY');
 for(const [key,row] of rows)if(!row.label)rows.delete(key);
 const mains=[],folds=[],worth=[],formal=new Set(),assigned=new Set();
 const members=card=>{
  const ids=clusters.get(id(card.id));if(!ids?.length)fail('UNMAPPED_CLUSTER');
  if(assigned.has(card.id))fail('DUPLICATE_CARD_CLUSTER');assigned.add(card.id);return ids;
 };
 for(const card of array(run.formalItems)){
  const ids=members(card);
  if(!['MUST_READ','WORTH_WATCHING'].includes(card.attentionDecision))fail('INVALID_FORMAL_DECISION');
  ids.forEach(entry=>formal.add(entry));
  if(card.attentionDecision==='MUST_READ')mains.push({clusterId:card.id,entryIds:ids});
  else worth.push({clusterId:card.id,entryIds:ids});
  for(const folded of card.relatedUpdates??[]){
   if(card.attentionDecision!=='MUST_READ')fail('FOLD_WITHOUT_MUST_READ_PARENT');
   folds.push({clusterId:folded.id,entryIds:members(folded)});
  }
 }
 const mainIds=new Set(mains.flatMap(x=>x.entryIds)),foldIds=new Set(folds.flatMap(x=>x.entryIds));
 const worthIds=new Set(worth.flatMap(x=>x.entryIds));
 for(const entry of entries){
  if((entry.destination==='FORMAL_ATTENTION')!==formal.has(entry.entryId) ||
     (entry.destination==='RELATED_UPDATE')!==foldIds.has(entry.entryId))fail('DESTINATION_CARD_MISMATCH');
 }
 const unknown=[...rows.values()].filter(x=>x.label===UNKNOWN).length;
 const must=[...rows.values()].filter(x=>x.label==='必看');
 const eligibleFold=[...foldIds].filter(x=>rows.get(x).label!==UNKNOWN);
 const noise=eligibleFold.filter(x=>['存档即可','不相关'].includes(rows.get(x).label));
 const details=new Map((run.filteringDetails??[]).map(x=>[x.id,x]));
 const privateEntries=entries.map(entry=>{
  const row=rows.get(entry.entryId),detail=details.get(entry.clusterId);
  const reasonCodes=[...new Set([...(entry.reasonCodes??[]),entry.reasonCode,detail?.reason,entry.reason].filter(x=>typeof x==='string'&&/^[A-Z][A-Z0-9_]+$/.test(x)))];
  return {entryId:entry.entryId,clusterId:entry.clusterId??null,humanLabel:row?.label??null,systemDestination:entry.destination,
   reasonCodes,reasonRecorded:reasonCodes.length>0,reasonText:entry.reason??null,
   falseKill: ['必看','值得看但可以折叠'].includes(row?.label)&&['LIBRARY_ONLY','FILTERED','NOT_RETAINED_BEFORE_CLUSTER','BACKGROUND'].includes(entry.destination)};
 });
 const falseKills=privateEntries.filter(x=>x.falseKill);
 const canCompareChoice=choice && choice!=='都不用看' && rows.has(choice) && rows.get(choice).label!==UNKNOWN;
 const summary={caseId,planMode,fetchedCount:run.fetchedCount,annotatedCount:rows.size,unknownCount:unknown,unannotatedBackgroundCount,
  worthWatchingClusterCount:worth.length,
  systemMainCount:mains.length,foldedClusterCount:folds.length,foldedEntryCount:foldIds.size,
  humanMustReadCount:must.length,mainHit:ratio(canCompareChoice&&mainIds.has(choice)?1:0,canCompareChoice?1:0),
  noneChoiceCount:choice==='都不用看'?1:0,hardPushCount:choice==='都不用看'&&mains.length?1:0,
  selectionMissingCount:choice?0:1,
  mustReadRecallMain:ratio(must.filter(x=>mainIds.has(x.entryId)).length,must.length),
  mustReadRecallFolded:ratio(must.filter(x=>foldIds.has(x.entryId)).length,must.length),
  mustReadRecallWorthWatching:ratio(must.filter(x=>worthIds.has(x.entryId)).length,must.length),
  mustReadRecall:ratio(must.filter(x=>mainIds.has(x.entryId)||foldIds.has(x.entryId)||worthIds.has(x.entryId)).length,must.length),
  foldNoise:ratio(noise.length,eligibleFold.length),falseKillCount:falseKills.length,
  falseKillReasonMissingCount:falseKills.filter(x=>!x.reasonRecorded).length,
  pendingRecommendedCount:privateEntries.filter(x=>['必看','值得看但可以折叠'].includes(x.humanLabel)&&x.systemDestination==='POSSIBLE_RELATED').length,
  systemCompression:ratio(run.fetchedCount,mains.length),humanCompression:ratio(run.fetchedCount,must.length)};
 return {summary,privateCase:{caseId,planMode,choice:choice||null,mainClusters:mains,foldedClusters:folds,worthWatchingClusters:worth,entries:privateEntries,falseKills}};
}

export function compareAnnotations(annotations, system) {
 array(annotations);const runs=array(system.cases);
 if(!runs.length)fail('NO_SYSTEM_CASES');
 const cases=[],privateCases=[],keys=new Set();
 for(const run of runs){
  const key=`${run.id}/${run.planMode??'system'}`;if(keys.has(key))fail('DUPLICATE_CASE_MODE');keys.add(key);
  const result=metricsForCase(annotations,run);cases.push(result.summary);privateCases.push(result.privateCase);
 }
 if(annotations.some(x=>!runs.some(run=>run.id===x.caseId)))fail('ANNOTATION_CASE_NOT_IN_SYSTEM');
 const totals=[...new Set(cases.map(x=>x.planMode))].map(planMode=>{
  const group=cases.filter(x=>x.planMode===planMode),sum=key=>group.reduce((n,x)=>n+x[key],0);
  const pooled=key=>ratio(group.reduce((n,x)=>n+x[key].numerator,0),group.reduce((n,x)=>n+x[key].denominator,0));
  return {planMode,caseCount:group.length,...Object.fromEntries(['fetchedCount','annotatedCount','unknownCount','unannotatedBackgroundCount','worthWatchingClusterCount','systemMainCount','foldedClusterCount','foldedEntryCount','humanMustReadCount','noneChoiceCount','hardPushCount','selectionMissingCount','falseKillCount','falseKillReasonMissingCount','pendingRecommendedCount'].map(key=>[key,sum(key)])),
   mainHit:pooled('mainHit'),mustReadRecallMain:pooled('mustReadRecallMain'),mustReadRecallFolded:pooled('mustReadRecallFolded'),mustReadRecallWorthWatching:pooled('mustReadRecallWorthWatching'),mustReadRecall:pooled('mustReadRecall'),foldNoise:pooled('foldNoise'),systemCompression:pooled('systemCompression'),humanCompression:pooled('humanCompression')};
 });
 return {public:{schemaVersion:1,cases,totals,notes:[
  '按事件簇成员精确映射，召回按唯一条目分别计算主卡、折叠、值得关注和三者合计；值得关注不计入必看主卡数。',
  '主卡命中按案例计；人工都不用看单列硬推，不伪装成命中。选择未填或选择材料不足项时命中率为 N/A。',
  '材料不足项不进入召回、折叠噪声和误杀分母。抓取数及系统主卡数是原始运行计数，压缩比不据人工标签重写；分母为零返回 null。',
  '误杀含资料库、过滤、聚类前未保留和窗口外背景；可能相关单列待判，不冒充已确认误杀。原因码缺失时如实计数，不推断原因。',
  '按 planMode 分开汇总，比例用合计分子/合计分母，不平均案例百分比。仅背景条目允许缺标注并单独计数；其余缺标注或簇映射均停止。',
  '旧模板别名：可看→值得看但可以折叠；可忽略→不相关；材料不足→材料不够，看不出。未提供只能看一条时主卡命中为 N/A。']},
  private:{schemaVersion:1,cases:privateCases}};
}

function markdown(report) {
 const percent=x=>x.value===null?'N/A':`${(100*x.value).toFixed(1)}% (${x.numerator}/${x.denominator})`;
 const compression=x=>x.value===null?'N/A':`${x.value.toFixed(2)} (${x.numerator}/${x.denominator})`;
 const row=(x,name)=>`| ${name} | ${percent(x.mainHit)} | ${x.hardPushCount} | ${percent(x.mustReadRecallMain)} | ${percent(x.mustReadRecallFolded)} | ${percent(x.mustReadRecallWorthWatching)} | ${percent(x.mustReadRecall)} | ${percent(x.foldNoise)} | ${x.falseKillCount} | ${x.unknownCount} | ${x.unannotatedBackgroundCount} | ${compression(x.systemCompression)} | ${compression(x.humanCompression)} |`;
 return `# 标注对比汇总\n\n| 案例 / 模式 | 主卡命中 | 硬推案例 | 主卡召回 | 折叠召回 | 值得关注召回 | 必看召回合计 | 折叠噪声 | 误杀条目 | 材料不足 | 未标背景 | 抓取/系统主卡 | 抓取/人工必看 |\n|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|\n${report.cases.map(x=>row(x,`${x.caseId} / ${x.planMode}`)).join('\n')}\n${report.totals.map(x=>row(x,`合计 / ${x.planMode}`)).join('\n')}\n\n${report.notes.map(x=>`- ${x}`).join('\n')}\n`;
}

function main(args) {
 if(args.length===1&&args[0]==='--help'){
  console.log(`Usage: node scripts/compare-annotations.mjs --annotations <xlsx> --system <PRIVATE-json> --output-dir <new-directory> [--choices <xlsx>]
XLSX: 条目ID、案例（或批次）、标签、只能看一条。只能看一条填条目ID或“都不用看”；同案例可只填一次。
也支持单独选择表或 --choices 工作簿：案例、只能看一条。支持 inlineStr/sharedStrings、命名空间前缀和旧模板标签别名。
说明页统计公式不执行、不参与读取；判定输入列中的公式仍拒绝。不支持加密/ZIP64。
JSON: eval-frozen 的 {cases:[{id,planMode,fetchedCount,entries,formalItems,filteringDetails}]}。
entries 必须含 entryId、clusterId（无簇可 null）、destination；formalItems 含 id、attentionDecision、relatedUpdates[].id。
缺少完整簇成员映射时停止，不按标题或 URL 猜测。不扫描目录，不访问网络，不覆盖现有报告。
输出 summary.json、summary.md（仅聚合），PRIVATE-differences.json（含逐条标注与系统判定，请勿公开）。`);return;
 }
 const options=new Map();
 for(let i=0;i<args.length;i+=2){if(!['--annotations','--system','--output-dir','--choices'].includes(args[i])||!args[i+1]||options.has(args[i]))fail('INVALID_ARGUMENTS');options.set(args[i],args[i+1]);}
 if(['--annotations','--system','--output-dir'].some(key=>!options.has(key)))fail('MISSING_ARGUMENTS');
 const annotations=readAnnotationWorkbook(readFileSync(resolve(options.get('--annotations'))),options.has('--choices')?readFileSync(resolve(options.get('--choices'))):undefined);
 const systemPath=resolve(options.get('--system'));
 if(!/PRIVATE/i.test(systemPath.split(/[\\/]/).at(-1)))fail('SYSTEM_FILENAME_MUST_INCLUDE_PRIVATE');
 const systemBytes=readFileSync(systemPath);if(systemBytes.length>64*1024*1024)fail('SYSTEM_JSON_TOO_LARGE');
 const result=compareAnnotations(annotations,JSON.parse(systemBytes.toString('utf8'))),out=resolve(options.get('--output-dir'));
 const outputs=['summary.json','summary.md','PRIVATE-differences.json'].map(name=>resolve(out,name));
 if(outputs.some(path=>existsSync(path)))fail('OUTPUT_EXISTS');
 mkdirSync(out,{recursive:true});
 writeFileSync(outputs[0],`${JSON.stringify(result.public,null,2)}\n`,{flag:'wx'});
 writeFileSync(outputs[1],markdown(result.public),{flag:'wx'});
 writeFileSync(outputs[2],`${JSON.stringify(result.private,null,2)}\n`,{flag:'wx',mode:0o600});
 console.log('Comparison complete: public summaries and PRIVATE differences written.');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 try{main(process.argv.slice(2));}catch(error){
  // Never echo workbook values, source rows, JSON fragments or supplied paths into public logs.
  const code=/^[A-Z][A-Z0-9_]+$/.test(error?.message??'')?error.message:'INPUT_OR_OUTPUT_ERROR';
  console.error(code);process.exitCode=1;
 }
}
