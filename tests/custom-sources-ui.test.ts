import assert from "node:assert/strict";
import test from "node:test";
import {readFileSync} from "node:fs";
import ts from "typescript";
import {createElement,type ReactElement} from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {parseCustomSources} from "../lib/custom-sources.ts";
import {saveFilterSources} from "../lib/alpha-storage.ts";

const source=readFileSync(new URL("../app/components/custom-sources-editor.tsx",import.meta.url),"utf8");
const ast=ts.createSourceFile("editor.tsx",source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
const node=ast.statements.find(node=>ts.isFunctionDeclaration(node) && node.name?.text==="CustomSourcesEditor");
assert.ok(node);
const js=ts.transpileModule(node.getText(ast).replace(/^export /,""),{compilerOptions:{target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.React}}).outputText;
function editor(onSave:(urls:string[])=>Promise<void>){
  const states:unknown[]=[];let cursor=0;let value="https://example.com/update";
  const useState=(initial:unknown)=>{const i=cursor++;if(!(i in states))states[i]=initial;return [states[i],(next:unknown)=>{states[i]=next;}];};
  const useRef=(initial:unknown)=>{const i=cursor++;if(!(i in states))states[i]={current:initial};return states[i];};
  const component=new Function("React","useState","useRef","parseCustomSources",`${js};return CustomSourcesEditor;`)({createElement},useState,useRef,parseCustomSources);
  return {render:()=>{cursor=0;return component({value,onChange:(next:string)=>{value=next;},onSave});},value:()=>value};
}
function button(tree:ReactElement,name:string):ReactElement{
  const props=tree.props as {children?:unknown};
  if(tree.type==="button" && props.children===name)return tree;
  for(const child of [props.children].flat(Infinity)){
    if(child && typeof child==="object" && "type" in child){try{return button(child as ReactElement,name);}catch{/* keep searching */}}
  }
  throw new Error(`Missing button ${name}`);
}
const flush=()=>new Promise<void>(resolve=>setImmediate(resolve));
for(const succeeds of [true,false]){
  test(`real source editor shows pending then ${succeeds?"saved":"failure"}, without starting research`,async(t)=>{
    let resolveSave:()=>void=()=>{};let rejectSave:(error:Error)=>void=()=>{};let requests=0;
    t.mock.method(globalThis,"fetch",async()=>{requests++;throw new Error("saving sources must not submit research");});
    const ui=editor(()=>new Promise<void>((resolve,reject)=>{resolveSave=resolve;rejectSave=reject;}));
    (button(ui.render(),"保存来源").props as {onClick:()=>void}).onClick();
    assert.match(renderToStaticMarkup(ui.render()),/正在处理/);
    if(succeeds)resolveSave();else rejectSave(new Error("storage failed"));
    await flush();
    const markup=renderToStaticMarkup(ui.render());
    assert.match(markup,succeeds?/来源已保存到当前浏览器/:/来源保存失败/);
    if(!succeeds)assert.doesNotMatch(markup,/来源已保存/);
    assert.equal(ui.value(),"https://example.com/update");assert.equal(requests,0);
  });
}
test("real source editor labels readable as unverified and renders login/thin failures",async(t)=>{
  t.mock.method(globalThis,"fetch",async()=>Response.json({checks:[
    {url:"https://example.com/update",status:"readable",reason:"正文可读取；仍需筛选",requestCount:1},
    {url:"https://example.com/login",status:"login_required",reason:"页面需要登录",requestCount:1},
    {url:"https://example.com/thin",status:"too_thin",reason:"正文太少",requestCount:1}
  ]}));
  const ui=editor(async()=>{});
  (button(ui.render(),"检查链接").props as {onClick:()=>void}).onClick();await flush();
  const markup=renderToStaticMarkup(ui.render());
  assert.match(markup,/正文可读取/);assert.match(markup,/未识别到发布日期/);
  assert.match(markup,/页面需要登录/);assert.match(markup,/正文太少/);
  assert.doesNotMatch(markup,/已验证|高可靠性/);
});
for(const fail of [false,true]){
  test(`source configuration and revision commit atomically (${fail?"abort":"success"})`,async()=>{
    const prior=Object.getOwnPropertyDescriptor(globalThis,"indexedDB");
    const writes:string[]=[];let transactions=0;
    const database={close:()=>{},transaction:()=>{
      transactions++;
      const store={get:()=>{const req={onsuccess:undefined as undefined|(()=>void),result:undefined as unknown};queueMicrotask(()=>req.onsuccess?.());return req;},put:(_value:unknown,key:string)=>{writes.push(key);}};
      const transaction={objectStore:()=>store,oncomplete:undefined as undefined|(()=>void),onabort:undefined as undefined|(()=>void),onerror:undefined as undefined|(()=>void)};
      queueMicrotask(()=>{if(fail)transaction.onabort?.();else transaction.oncomplete?.();});
      return transaction;
    }};
    Object.defineProperty(globalThis,"indexedDB",{configurable:true,value:{open:()=>{
      const request={result:database,onsuccess:undefined as undefined|(()=>void)};
      queueMicrotask(()=>request.onsuccess?.());return request;
    }}});
    try{
      const save=saveFilterSources({ filterId: 'f1', filterEntry: {} as never, knowledgeFilterId: 'f1', knowledgeEntry: {} as never });
      if(fail)await assert.rejects(save);else await save;
      assert.deepEqual(writes,["filters","knowledgeByFilterId"]);assert.equal(transactions,1);
    }finally{if(prior)Object.defineProperty(globalThis,"indexedDB",prior);else Reflect.deleteProperty(globalThis,"indexedDB");}
  });
}
