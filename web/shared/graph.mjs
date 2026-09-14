// Shared deterministic graph and lexical retrieval. No model calls or code execution.
export const relationTypes = ['references', 'supports', 'depends_on', 'uses_skill', 'related_to'];
export function graphFromWorkspace(workspace) {
  const nodes = workspace.docs.map(doc => ({id:'doc:'+doc.id, title:doc.name, kind:doc.kind, tags:doc.tags, content:doc.content, source:doc.source || 'workspace', updated:doc.updated}));
  for (const goal of workspace.goals) nodes.push({id:'goal:'+goal.id,title:goal.title,kind:'goal',tags:goal.category?[goal.category]:[],content:goal.description+'\n'+goal.milestones.map(m => (m.done?'[x] ':'[ ] ')+m.title).join('\n'),source:'workspace',updated:goal.created});
  const edges = (workspace.relations || []).map(edge => ({...edge,origin:'explicit'}));
  const tagMap = new Map();
  for (const node of [...nodes]) for (const tag of node.tags) {
    const normalized=tag.trim().toLocaleLowerCase();
    if (!normalized) continue;
    const id='tag:'+normalized;
    if (!tagMap.has(id)) tagMap.set(id,{id,title:tag,kind:'topic',tags:[],content:'Topic shared by explicitly tagged items.',source:'tags'});
    edges.push({id:'tag-edge:'+node.id+':'+normalized,source:node.id,target:id,relation:'tagged',origin:'tag'});
  }
  nodes.push(...tagMap.values());
  const ids=new Set(nodes.map(n=>n.id));
  return {format:'second-brain-agent/v1',nodes,edges:edges.filter(e=>ids.has(e.source)&&ids.has(e.target))};
}
export function validateGraph(graph) {
  if (!graph || graph.format !== 'second-brain-agent/v1' || !Array.isArray(graph.nodes) || !Array.isArray(graph.edges) || graph.nodes.length>50000 || graph.edges.length>200000) throw new Error('Invalid or oversized Second Brain agent graph.');
  const ids=new Set();
  for(const n of graph.nodes) { if (!n || typeof n.id!=='string' || n.id.length>1024 || ids.has(n.id) || typeof n.title!=='string' || typeof n.content!=='string' || n.content.length>1048576 || !Array.isArray(n.tags) || n.tags.some(t=>typeof t!=='string') || !['note','file','skill','goal','topic'].includes(n.kind)) throw new Error('Invalid graph node.'); ids.add(n.id); }
  for(const e of graph.edges) if (!e || !ids.has(e.source) || !ids.has(e.target) || ![...relationTypes,'tagged'].includes(e.relation)) throw new Error('Invalid graph relationship.');
  return graph;
}
const stop=new Set(['the','and','for','with','that','this','from','what','how','can','you','your','are','was','into','does','have','about','will','would','should','use','using','a','an','to','of','in','is','it','my']);
export function terms(text) {return (text.toLowerCase().match(/[\p{L}\p{N}_-]{2,}/gu)||[]).filter(t=>!stop.has(t));}
export function buildIndex(graph) {
  validateGraph(graph);
  const byId=new Map(graph.nodes.map(n=>[n.id,n])); const postings=new Map(); const lengths=new Map(); const adjacent=new Map();
  let corpusChars=0;
  for(const node of graph.nodes) {
    corpusChars+=node.content.length;
    const title=terms(node.title+' '+node.tags.join(' ')); const content=terms(node.content);
    lengths.set(node.id,Math.max(1,content.length));
    const counts=new Map();
    for(const term of content) counts.set(term,(counts.get(term)||0)+1);
    for(const term of title) counts.set(term,(counts.get(term)||0)+5);
    for(const [term,count] of counts) {if(!postings.has(term))postings.set(term,new Map());postings.get(term).set(node.id,count);}
  }
  for(const edge of graph.edges) for(const id of [edge.source,edge.target]) {if(!adjacent.has(id))adjacent.set(id,[]);adjacent.get(id).push(edge);}
  const avg=Math.max(1,[...lengths.values()].reduce((a,b)=>a+b,0)/Math.max(1,graph.nodes.length));
  return {graph,byId,postings,lengths,adjacent,avg,corpusChars};
}
export function searchGraph(index,query,{limit=5,budget=6000,neighbors=true}={}) {
  const start=performance.now();
  limit=Math.max(1,Math.min(10,Number(limit)||5));budget=Math.max(300,Math.min(32000,Number(budget)||6000));
  const queryTerms=[...new Set(terms(String(query)))]; const scores=new Map();
  for(const term of queryTerms) { const posting=index.postings.get(term);if(!posting)continue;const idf=Math.log(1+(index.byId.size-posting.size+.5)/(posting.size+.5));for(const[id,tf]of posting){const normalized=tf*2.2/(tf+1.2*(.25+.75*index.lengths.get(id)/index.avg));scores.set(id,(scores.get(id)||0)+idf*normalized);}}
  const ranked=[...scores].sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0])).slice(0,limit);
  const picks=ranked.map(([id,score])=>({id,score,reason:'lexical match'}));
  if(neighbors) for(const [id]of ranked.slice(0,2)) for(const edge of (index.adjacent.get(id)||[]).filter(e=>e.relation!=='tagged').slice(0,2)) { const linked=edge.source===id?edge.target:edge.source; if(!picks.some(p=>p.id===linked))picks.push({id:linked,score:0,reason:'one-hop '+edge.relation}); }
  let context='';const matches=[];
  for(const pick of picks) {
    const node=index.byId.get(pick.id);const heading='['+node.id+'] '+node.title+' ('+node.kind+'; '+pick.reason+')\n';
    const available=budget-context.length-heading.length-2;
    if(available<40)break;
    const lower=node.content.toLowerCase();const offsets=queryTerms.map(t=>lower.indexOf(t)).filter(p=>p>=0);const offset=offsets.length?Math.max(0,Math.min(...offsets)-140):0;
    const excerpt=node.content.slice(offset,offset+Math.min(available,Math.max(400,Math.floor(budget/Math.max(1,picks.length)))));context+=heading+excerpt+'\n\n';
    matches.push({id:node.id,title:node.title,kind:node.kind,score:Number(pick.score.toFixed(3)),reason:pick.reason,excerpt,offset});
  }
  const ids=new Set(matches.map(n=>n.id));
  return {query,context,matches,relationships:index.graph.edges.filter(e=>ids.has(e.source)&&ids.has(e.target)),stats:{corpusChars:index.corpusChars,contextChars:context.length,budgetChars:budget,matchedNodes:matches.length,searchMs:Number((performance.now()-start).toFixed(2))},limits:'Lexical retrieval with explicit one-hop expansion; no semantic or token-count guarantee.'};
}

