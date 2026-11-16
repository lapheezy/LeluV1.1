const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const BASE='http://127.0.0.1:4173', OUT=process.env.OUT;
const [W,H]=process.env.SIZE.split('x').map(Number), tag=process.env.SIZE, phone=W<700;
const R={};
(async()=>{
  const b=await chromium.launch({args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
  const ctx=await b.newContext({viewport:{width:W,height:H},isMobile:phone,hasTouch:phone,deviceScaleFactor:1});
  const p=await ctx.newPage(); const errs=[]; p.on('pageerror',e=>errs.push(String(e).slice(0,200)));
  const boot=async()=>{ await p.waitForTimeout(6000); await p.evaluate(()=>[...document.querySelectorAll('[data-lelu-signin-gate] button')].find(x=>/^Continue/.test(x.innerText))?.click()); await p.waitForSelector('[data-lelu-home]',{timeout:60000}).catch(()=>{}); await p.waitForTimeout(3000); };
  await p.goto(BASE+'/'); await p.fill('input[name=password]','test-pass-123'); await p.click('button[type=submit]'); await p.waitForURL(BASE+'/'); await boot();
  const shot=(n)=>p.screenshot({path:`${OUT}/${tag}_${n}.png`,timeout:240000}).catch(()=>console.log('shot-timeout',n));
  const click=(s)=>p.evaluate(s=>document.querySelector(s)?.click(),s);
  const openU=async()=>{ await p.evaluate(()=>window.dispatchEvent(new CustomEvent('lelu-open-universe'))); await p.waitForTimeout(1200); };
  const wins=()=>p.evaluate(()=>[...document.querySelectorAll('[data-lelu-module-window^="chat:"]')].map(w=>{const r=w.getBoundingClientRect(); return {id:w.dataset.leluModuleWindow, x:Math.round(r.x), y:Math.round(r.y), w:Math.round(r.width), h:Math.round(r.height), z:Number(getComputedStyle(w).zIndex)||0, text:(w.querySelector('.lcw-thread')?.innerText||'').slice(0,60)};}));
  await openU();
  if (await p.evaluate(()=>document.querySelector('.lcu')?.dataset.cosmos)==='floating') await click('.lcu-mode');
  for (const t of ['Window A test','Window B test']) { await click('button[aria-label="New chat"]'); await p.waitForTimeout(700); await p.fill('.lcu-input textarea',t); await click('.lcu-send'); await p.waitForTimeout(1500); }
  let w=await wins(); R.opened=w.map(x=>({id:x.id.slice(0,14),text:x.text.slice(0,20)})); R.uniqueIds=new Set(w.map(x=>x.id)).size===w.length;
  await shot('1_managed_windows');
  const A=w.find(x=>/Window A/.test(x.text)), B=w.find(x=>/Window B/.test(x.text));
  // ---- drag A by its title bar (real pointer events); on a phone bring A forward first (B covers it)
  if(phone){ await p.evaluate(()=>[...document.querySelectorAll('.lcu-dock-item')].find(d=>/Window A/.test(d.innerText))?.click()); await p.waitForTimeout(500); }
  const chromeA=await p.evaluate(id=>{const r=document.querySelector(`[data-lelu-module-chrome="${id}"]`)?.getBoundingClientRect(); return r&&{x:r.x+r.width/2-40,y:r.y+r.height/2};},A.id);
  R.dragProbe=await p.evaluate(({x,y,aid})=>{const h=document.elementFromPoint(x,y); return h?`${h.tagName}.${(h.className||'').toString().slice(0,40)} chrome=${h.closest('[data-lelu-module-chrome]')?.dataset.leluModuleChrome===aid?'A':'other'} btn=${Boolean(h.closest('button'))}`:null;},{...chromeA,aid:A.id});
  const dx=phone?0:220, dy=phone?-110:120;
  await p.mouse.move(chromeA.x,chromeA.y); await p.mouse.down(); await p.mouse.move(chromeA.x+dx/2,chromeA.y+dy/2,{steps:6}); await p.mouse.move(chromeA.x+dx,chromeA.y+dy,{steps:6}); await p.mouse.up(); await p.waitForTimeout(400);
  let a1=(await wins()).find(x=>x.id===A.id); R.drag={before:[A.x,A.y],after:[a1.x,a1.y],moved:a1.x!==A.x||a1.y!==A.y};
  // ---- resize A by its corner handle
  const handle=await p.evaluate(id=>{const win=document.querySelector(`[data-lelu-module-window="${id}"]`); const el=[...win.querySelectorAll('*')].find(e=>/resize/.test(getComputedStyle(e).cursor)); const r=el?.getBoundingClientRect(); return r&&{x:r.x+r.width/2,y:r.y+r.height/2};},A.id);
  if(handle){ await p.mouse.move(handle.x,handle.y); await p.mouse.down(); await p.mouse.move(handle.x+(phone?0:140),handle.y+(phone?-120:90),{steps:8}); await p.mouse.up(); await p.waitForTimeout(400); }
  let a2=(await wins()).find(x=>x.id===A.id); R.resize={handle:Boolean(handle),before:[a1.w,a1.h],after:[a2.w,a2.h],resized:a2.w!==a1.w||a2.h!==a1.h};
  await shot('2_dragged_resized');
  // ---- focus order: click B's title bar, then A's
  const top=async()=>{const ws=await wins(); return ws.sort((x,y)=>y.z-x.z)[0]?.id;};
  // Click a point of the title bar that is actually uncovered (elementFromPoint).
  const clickChrome=async(id)=>{const c=await p.evaluate(id=>{const el=document.querySelector(`[data-lelu-module-chrome="${id}"]`); const r=el?.getBoundingClientRect(); if(!r) return null; for(let x=r.x+8;x<r.right-8;x+=12){const y=r.y+r.height/2; const hit=document.elementFromPoint(x,y); if(hit&&el.contains(hit)&&!hit.closest('button')) return {x,y};} return null;},id); if(c){await p.mouse.click(c.x,c.y); await p.waitForTimeout(400);} return Boolean(c);};
  const dock=async(t)=>{await p.evaluate(t=>[...document.querySelectorAll('.lcu-dock-item')].find(d=>d.innerText.includes(t))?.click(),t); await p.waitForTimeout(500);};
  if(phone) await dock('Window B'); else await clickChrome(B.id); const t1=await top(); if(phone){ await p.evaluate(()=>[...document.querySelectorAll('.lcu-dock-item')].find(d=>/Window A/.test(d.innerText))?.click()); await p.waitForTimeout(500);} else await clickChrome(A.id); const t2=await top();
  R.focus={afterB:t1===B.id, afterA:t2===A.id, targetFollowsFront:await p.evaluate(()=>document.querySelector('.lcu-target')?.innerText)};
  // ---- mode switch keeps geometry
  const g0=JSON.stringify((await wins()).map(x=>[x.id,x.x,x.y,x.w,x.h]));
  await click('.lcu-mode'); await p.waitForTimeout(1500); await shot('3_floating_with_windows');
  const g1=JSON.stringify((await wins()).map(x=>[x.id,x.x,x.y,x.w,x.h])); await click('.lcu-mode'); await p.waitForTimeout(800);
  R.modeSwitchKeepsGeometry=g0===g1;
  // ---- leave the Universe: windows stay; come back: no duplicates
  await click('button[aria-label="Close Chat Universe"]'); await p.waitForTimeout(1500);
  const outside=await wins(); R.outsideUniverse={count:outside.length, visible:outside.every(x=>x.w>0), aboveHome: await p.evaluate(()=>{const ws=[...document.querySelectorAll('[data-lelu-module-window^="chat:"]')]; const r=ws[0].getBoundingClientRect(); const hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2); return ws.some(w=>w.contains(hit));}), oldChatVisible: await p.evaluate(()=>Boolean(document.querySelector('[data-lelu-chat-surface], .lelu-cc-composer')?.offsetParent))};
  await shot('4_windows_outside_universe');
  await openU(); const back=await wins(); R.backInUniverse={count:back.length, unique:new Set(back.map(x=>x.id)).size===back.length};
  // ---- minimize B, then reload
  const bTitle=await p.evaluate(id=>document.querySelector(`[data-lelu-module-chrome="${id}"]`)?.querySelector('[aria-label^="Minimize"]')?.getAttribute('aria-label'),B.id);
  if(bTitle) await p.evaluate(l=>document.querySelector(`[aria-label="${l}"]`)?.click(),bTitle); await p.waitForTimeout(600);
  const preReload=(await wins()).find(x=>x.id===A.id);
  await p.reload(); await boot();
  const after=await wins(); const aR=after.find(x=>x.id===A.id);
  R.reload={windowsVisible:after.map(x=>x.id.slice(0,14)), A_restored:aR?[aR.x,aR.y,aR.w,aR.h]:null, A_before:[preReload.x,preReload.y,preReload.w,preReload.h], A_transcript:aR?.text.slice(0,24), B_stillMinimized:!after.some(x=>x.id===B.id)};
  await shot('5_after_reload');
  R.pageerrors=errs;
  console.log(tag, JSON.stringify(R,null,1));
  await b.close();
})();
