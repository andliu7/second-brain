import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../src/App';
import { loadWorkspace, saveWorkspace, initialWorkspace, makeDoc } from '../src/lib/storage';
const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aBZkAAAAASUVORK5CYII=';
let requests:{url:string;body:any}[]=[];
beforeEach(()=>{
 requests=[];
 vi.stubGlobal('fetch',vi.fn(async(url,options)=>{
  const path=String(url);const body=options?.body?JSON.parse(options.body):undefined;requests.push({url:path,body});
  const reply=path.endsWith('/status')?{local:true,authRequired:false,providers:{claude:true,openai:false,gemini:true,kie:true,fal:true},models:{claude:'test-model',openai:'gpt-5.4',gemini:'gemini-3.5-flash',geminiImage:'gemini-3.1-flash-image',fal:'fal-ai/flux/schnell',kie:'nano-banana-pro'}}:path.endsWith('/chat')?{text:'TEST FIXTURE: grounded answer'}:path.endsWith('/generate')?{status:'complete',model:'test-image-model',images:[png]}:{sources:[]};
  return new Response(JSON.stringify(reply),{status:200,headers:{'content-type':'application/json'}});
 }));
});
async function ready(){await screen.findByRole('button',{name:/Capture a thought/});}
describe('real workspace flows in a test DOM (not visual QA)',()=>{
 it('creates a note and persists it across application reloads',async()=>{
  const user=userEvent.setup();const app=render(<App/>);await ready();
  await user.click(screen.getByRole('button',{name:/Capture a thought/}));
  const dialog=screen.getByRole('dialog');
  await user.type(within(dialog).getByLabelText('Title'),'Research decision');
  const body=within(dialog).getByRole('textbox',{name:/Content|Instructions|Note/i});
  await user.type(body,'Use a small local index before asking the model.');
  await user.click(within(dialog).getByRole('button',{name:/Save note|Create note|Save skill|Save$/i}));
  await waitFor(async()=>expect((await loadWorkspace()).docs.some(d=>d.name==='Research decision')).toBe(true));
  app.unmount();render(<App/>);await ready();
  // Files is no longer a page: a saved note is reached through the workspace search (Ctrl K).
  await user.keyboard('{Control>}k{/Control}');
  await user.type(screen.getByLabelText('Search files, goals and conversations'),'Research');
  expect(await screen.findByText('Research decision')).toBeInTheDocument();
 });
 it('quick capture stores independent rapid updates without losing data',async()=>{
  const user=userEvent.setup();render(<App/>);await ready();
  await user.click(screen.getByRole('button',{name:'Today'})); // quick capture lives on the Today page, behind the home globe's burger
  const capture=await screen.findByLabelText('Your quick thought');
  await user.type(capture,'A durable thought');await user.click(screen.getByRole('button',{name:'Save note'}));
  await waitFor(()=>expect(capture).toHaveValue(''));
  await user.type(capture,'A second durable thought');await user.click(screen.getByRole('button',{name:'Save note'}));
  await waitFor(async()=>expect((await loadWorkspace()).docs.filter(d=>d.tags.includes('Quick capture'))).toHaveLength(2));
 });
 it('creates a goal, completes a milestone, and persists progress',async()=>{
  const user=userEvent.setup();render(<App/>);await ready();await user.click(screen.getByRole('button',{name:'Goals'}));
  const create=screen.getAllByRole('button',{name:/New goal|Create.*goal|Set.*goal/i})[0];await user.click(create);
  const dialog=screen.getByRole('dialog');await user.type(within(dialog).getByLabelText('Goal title'),'Organize my research');
  await user.type(within(dialog).getByLabelText('New milestone'),'Sort the reading list');
  await user.click(within(dialog).getByRole('button',{name:'Create goal'}));
  const checkbox=await screen.findByRole('checkbox',{name:/Sort the reading list/});await user.click(checkbox);
  await waitFor(async()=>expect((await loadWorkspace()).goals[0].milestones[0].done).toBe(true));
 });
 it('sends only selected skill context and stores the model response',async()=>{
  const w=initialWorkspace();w.docs.push(makeDoc('Review skill','Ask for evidence before making a claim.','skill'));await saveWorkspace(w);
  const user=userEvent.setup();render(<App/>);await ready();await user.click(screen.getByRole('button',{name:/^Chat\s*AI?$/}));
  await user.click(screen.getByRole('button',{name:'Add context'}));const dialog=screen.getByRole('dialog');
  await user.click(within(dialog).getByRole('checkbox',{name:/Review skill/}));await user.click(within(dialog).getByRole('button',{name:/Done/}));
  await user.type(screen.getByLabelText('Message'),'Review this decision');await user.click(screen.getByRole('button',{name:'Send message'}));
  expect(await screen.findByText('TEST FIXTURE: grounded answer')).toBeInTheDocument();
  const sent=requests.find(r=>r.url.endsWith('/chat'))!.body;expect(sent.context).toHaveLength(1);expect(sent.context[0].name).toBe('Review skill');expect(sent.model).toBe('test-model');
  expect((await loadWorkspace()).conversations[0].messages).toHaveLength(2);
 });
 it('supports all three generation provider paths without an empty model record',async()=>{
  // Generate is a mode of Chat, the second button of the Chat | Generate control at the top of that page.
  const user=userEvent.setup();render(<App/>);await ready();await user.click(screen.getByRole('button',{name:/^Chat\s*AI?$/}));await user.click(screen.getByRole('button',{name:'Generate'}));
  for(const provider of ['gemini','fal','kie']){
   await user.selectOptions(screen.getByLabelText('Provider'),provider);
   await user.clear(screen.getByLabelText('What do you imagine?'));await user.type(screen.getByLabelText('What do you imagine?'),'TEST FIXTURE '+provider);
   await user.click(screen.getByRole('button',{name:/Generate image/}));
   await waitFor(()=>expect(requests.some(r=>r.url.endsWith('/generate')&&r.body.provider===provider)).toBe(true));
   await waitFor(async()=>expect((await loadWorkspace()).generations.some(g=>g.provider===provider&&g.status==='complete')).toBe(true));
  }
  expect((await loadWorkspace()).generations).toHaveLength(3);
 });
 it('disables sending when the selected provider has no configured key',async()=>{
  const user=userEvent.setup();render(<App/>);await ready();await user.click(screen.getByRole('button',{name:/^Chat\s*AI?$/}));
  await user.selectOptions(screen.getByLabelText('Chat provider'),'openai');await user.type(screen.getByLabelText('Message'),'Hello');
  expect(screen.getByRole('button',{name:'Send message'})).toBeDisabled();
  expect(requests.some(r=>r.url.endsWith('/chat'))).toBe(false);
 });
});

