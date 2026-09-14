import { useState } from 'react';
import { expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Network from '../src/Network';
import { initialWorkspace, makeDoc } from '../src/lib/storage';
import type { Workspace } from '../src/types';
it('keeps typed relationships and retrieval usable without WebGL',async()=>{
  vi.spyOn(HTMLCanvasElement.prototype,'getContext').mockReturnValue(null);
  vi.spyOn(console,'error').mockImplementation(()=>{});
  const start=initialWorkspace();
  const note=makeDoc('Carbonyl plan','Study nucleophilic addition to carbonyl compounds.');
  const skill=makeDoc('Review mechanisms','Check atom mapping and formal charges.','skill');
  start.docs.push(note,skill);
  let latest=start;
  function Harness(){const[w,setW]=useState(start);return <Network workspace={w} commit={async(update:(w:Workspace)=>Workspace)=>{latest=update(latest);setW(latest);return true;}} openDoc={()=>{}}/>;}
  const user=userEvent.setup();render(<Harness/>);
  expect(await screen.findByText(/3D is unavailable on this device/)).toBeInTheDocument();
  await user.click(screen.getByRole('button',{name:/Carbonyl plan Notes/}));
  await user.selectOptions(screen.getByLabelText('Relationship'),'uses_skill');
  await user.selectOptions(screen.getByLabelText('Connect to'),'doc:'+skill.id);
  await user.click(screen.getByRole('button',{name:'Connect items'}));
  await waitFor(()=>expect(latest.relations?.[0]).toMatchObject({source:'doc:'+note.id,target:'doc:'+skill.id,relation:'uses_skill'}));
  await user.type(screen.getByLabelText('Find context'),'carbonyl');
  await user.click(screen.getByRole('button',{name:/Retrieve context/}));
  expect(await screen.findByText(/one-hop uses_skill/, {selector:'pre'})).toBeInTheDocument();
});
