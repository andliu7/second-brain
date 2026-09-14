#!/usr/bin/env node
import fs from 'node:fs/promises';
import {buildIndex,searchGraph,validateGraph} from '../shared/graph.mjs';
const args=process.argv.slice(2);
const command=args.shift();
function option(name,fallback){const i=args.indexOf(name);return i<0?fallback:args[i+1];}
const file=option('--graph',null);
try {
  if(!file || !['search','get','neighbors','stats'].includes(command)) {
    process.stdout.write('Second Brain · read-only context CLI\n\nnode bin/brain.mjs search "your query" --graph agent-graph.json --budget 6000 --limit 5\nnode bin/brain.mjs get "doc:ID" --graph agent-graph.json --budget 6000\nnode bin/brain.mjs neighbors "doc:ID" --graph agent-graph.json\nnode bin/brain.mjs stats --graph agent-graph.json\n\nExport the agent graph from Network. Budgets are characters, not exact tokens.\n');process.exitCode=file?1:0;
  } else {
    const stat=await fs.stat(file);if(stat.size>64*1024*1024)throw new Error('Graph export exceeds 64 MB.');
    const graph=validateGraph(JSON.parse(await fs.readFile(file,'utf8')));
    const index=buildIndex(graph);let result;
    const budget=Math.max(300,Math.min(32000,Number(option('--budget',6000))||6000));
    if(command==='search')result=searchGraph(index,args[0]||'',{budget,limit:Number(option('--limit',5))});
    if(command==='get'){const node=index.byId.get(args[0]);if(!node)throw new Error('Node not found.');result={...node,content:node.content.slice(0,budget),truncated:node.content.length>budget};}
    if(command==='neighbors'){if(!index.byId.has(args[0]))throw new Error('Node not found.');result={node:args[0],relationships:index.adjacent.get(args[0])||[]};}
    if(command==='stats')result={nodes:graph.nodes.length,relationships:graph.edges.length,uniqueTerms:index.postings.size,corpusChars:index.corpusChars};
    process.stdout.write(JSON.stringify(result,null,2)+'\n');
  }
} catch(error){process.stderr.write(JSON.stringify({error:error.message})+'\n');process.exitCode=1;}

