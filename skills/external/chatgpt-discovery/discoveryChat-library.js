window.discoveryChat = (() => {
 const sleep=ms=>new Promise(r=>setTimeout(r,ms));
 const visible=e=>!!e&&e.getBoundingClientRect().width>0;
 const panel=()=>document.querySelector('[role="complementary"][aria-label="Sources"], [role="dialog"][aria-label="Sources"]');
 const root=()=>[...document.querySelectorAll('[data-dil-response]')].at(-1);
 const menuItems=()=>[...document.querySelectorAll('[role="menuitem"]')].filter(visible);
 const pointer=b=>b.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,button:0,pointerType:'mouse',ctrlKey:false}));
 let expectedSources=null;
 return {
 async prepare(){
  expectedSources=null;
  let b;
  for(let i=0;i<40;i++){b=[...document.querySelectorAll('button[aria-haspopup="menu"]')].find(e=>visible(e)&&e.textContent.trim()==='Personalization');if(b)break;await sleep(200);}
  if(!b)throw Error('Personalization dropdown unavailable');
  pointer(b);await sleep(200);
  const option=[...document.querySelectorAll('[role="menuitemradio"][data-radix-collection-item]')].find(e=>visible(e)&&e.textContent.startsWith('Unpersonalized'));
  if(!option)throw Error('Unpersonalized option unavailable (English UI required)');
  option.click();await sleep(200);
  const confirmation='This chat will ignore memory, plugins, and custom instructions';
  if(!document.body.innerText.includes(confirmation))throw Error('Unpersonalized confirmation missing');
  if(root())throw Error('Not a fresh chat: existing response detected');
  return {mode:'unpersonalized',page_confirmation:confirmation,verified_at:new Date().toISOString()};
 },
 async submit(prompt){
  if(typeof prompt!=='string'||!prompt.trim())throw Error('Prompt must be nonempty');
  if(!document.body.innerText.includes('This chat will ignore memory, plugins, and custom instructions'))throw Error('Unpersonalized not verified');
  if(root())throw Error('Existing response: reopen a fresh temporary chat');
  const e=[...document.querySelectorAll('[contenteditable="true"][role="textbox"]')].find(visible);
  if(!e||e.innerText.trim())throw Error('Composer absent or not empty');
  e.focus();document.execCommand('insertText',false,prompt);await sleep(400);
  if(e.innerText.trim()!==prompt.trim())throw Error('Composer does not match prompt');
  const b=[...document.querySelectorAll('button[aria-label="Send"]')].find(e=>visible(e)&&!e.disabled);
  if(!b)throw Error('Send unavailable');b.click();return {submitted:true};
 },
 response(){
  const r=root();const complete=!!r&&document.body.innerText.includes('Response complete')&&![...document.querySelectorAll('button[aria-label="Stop"],button[aria-label="Stop streaming"]')].some(visible);
  return {complete,response_text:r?.innerText||'',conversation_url:document.URL,captured_at:new Date().toISOString(),model_label:[...document.querySelectorAll('button[aria-label="Select ChatGPT model"]')].find(visible)?.innerText||null};
 },
 async openSources(){
  expectedSources=null;
  if(panel())return {opened:true};
  const r=root();if(!r)throw Error('No response');
  const b=[...document.querySelectorAll('button[aria-label="More actions"]')].filter(visible).at(-1);
  if(!b)throw Error('Response actions unavailable');pointer(b);await sleep(200);
  const icon=[...document.querySelectorAll('[role="menuitem"] use[href$="#codex-icon-book-open-light-16"]')].find(e=>visible(e.closest('[role="menuitem"]')));
  if(!icon){
   const badges=r.querySelectorAll('[aria-haspopup="dialog"]').length,links=r.querySelectorAll('a[href]').length;
   if(menuItems().length&&badges===0&&links===0)return {opened:false,no_sources_verified:true,evidence:'No View sources menu item, citation badges, or response links'};
   throw Error('View sources missing despite links/badges, or menu did not open');
  }
  icon.closest('[role="menuitem"]').click();await sleep(250);return {opened:!!panel(),pending:!panel()};
 },
 async sources(){
  const p=panel();if(!p||!p.querySelector('section'))return {ready:false,pending:true,reason:'Panel loading'};
  const before=p.querySelectorAll('section a[href]').length;
  const expand=[...p.querySelectorAll('button[aria-controls][aria-expanded="false"]')];
  const remaining=expand.reduce((n,b)=>n+Number(b.getAttribute('aria-label')?.match(/\d+/)?.[0]||0),0);
  if(expectedSources===null)expectedSources=before+remaining;
  for(const b of expand)b.click();if(expand.length)await sleep(400);
  const sections=[...p.querySelectorAll('section')].map(s=>({section:s.getAttribute('aria-label')==='Sources'?'main':'more',sources:[...s.querySelectorAll('a[href]')].map((a,i)=>({position:i+1,title:a.getAttribute('aria-label')||'',url:a.href,site:a.querySelector('span.truncate')?.textContent||new URL(a.href).hostname,excerpt:a.querySelector('span.break-words.text-secondary')?.textContent||a.textContent}))}));
  const entries=sections.flatMap(s=>s.sources.map(x=>({...x,section:s.section})));
  const morePending=p.querySelector('button[aria-controls][aria-expanded="false"]');
  const valid=entries.every(s=>s.title&&/^https?:/.test(s.url));
  const ready=!morePending&&entries.length===expectedSources&&valid;
  return {ready,pending:!ready,expected:expectedSources,captured:entries.length,all_titles_and_urls:valid,sections,conversation_url:document.URL};
 },
 closeSources(){document.querySelector('button[aria-label="Close sources"]')?.click();expectedSources=null;return {closed:!panel()};}
 };
})();