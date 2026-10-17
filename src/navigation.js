/** Undirected arcade navigation over actual connected OpenStreetMap streets.
 * Traffic rules and one-way restrictions are deliberately not simulated.
 */
export function projectToSegment(point, a, b) {
  const dx=b.x-a.x,dz=b.z-a.z,len2=dx*dx+dz*dz;
  const t=Math.max(0,Math.min(1,((point.x-a.x)*dx+(point.z-a.z)*dz)/(len2||1)));
  const x=a.x+dx*t,z=a.z+dz*t;
  return {x,z,t,distance:Math.hypot(point.x-x,point.z-z)};
}

class MinHeap {
  values=[];
  push(value){
    const a=this.values;a.push(value);let i=a.length-1;
    while(i){const p=(i-1)>>1;if(a[p].f<=value.f)break;a[i]=a[p];i=p;}a[i]=value;
  }
  pop(){
    const a=this.values,first=a[0],last=a.pop();
    if(a.length){let i=0;while(i*2+1<a.length){let c=i*2+1;if(c+1<a.length&&a[c+1].f<a[c].f)c++;if(a[c].f>=last.f)break;a[i]=a[c];i=c;}a[i]=last;}
    return first;
  }
  get length(){return this.values.length;}
}

export function createNavigator(network){
  const {nodes,edges}=network,adj=nodes.map(()=>[]),grid=new Map(),cell=80;
  edges.forEach((e,index)=>{
    const a=nodes[e.a],b=nodes[e.b],length=Math.hypot(a.x-b.x,a.z-b.z);
    adj[e.a].push({to:e.b,length,edge:index});adj[e.b].push({to:e.a,length,edge:index});
    for(let x=Math.floor(Math.min(a.x,b.x)/cell);x<=Math.floor(Math.max(a.x,b.x)/cell);x++){
      for(let z=Math.floor(Math.min(a.z,b.z)/cell);z<=Math.floor(Math.max(a.z,b.z)/cell);z++){
        const key=`${x},${z}`;if(!grid.has(key))grid.set(key,[]);grid.get(key).push(index);
      }
    }
  });
  function nearest(point){
    const cx=Math.floor(point.x/cell),cz=Math.floor(point.z/cell),tested=new Set();let best=null;
    for(let radius=0;radius<130;radius++){
      for(let x=cx-radius;x<=cx+radius;x++)for(let z=cz-radius;z<=cz+radius;z++){
        if(radius&&x!==cx-radius&&x!==cx+radius&&z!==cz-radius&&z!==cz+radius)continue;
        for(const index of grid.get(`${x},${z}`)||[]){
          if(tested.has(index))continue;tested.add(index);
          const e=edges[index],p=projectToSegment(point,nodes[e.a],nodes[e.b]);
          if(!best||p.distance<best.distance)best={...p,edge:index,a:e.a,b:e.b,width:e.width};
        }
      }
      // Once every cell closer than the best candidate has been searched, exact.
      if(best&&best.distance<(radius-1)*cell)break;
    }
    return best;
  }
  function route(from,to){
    const start=nearest(from),finish=nearest(to);
    if(!start||!finish)return [];
    if(start.edge===finish.edge)return [start,finish];
    const scores=new Float64Array(nodes.length);scores.fill(Infinity);
    const parents=new Int32Array(nodes.length);parents.fill(-1);
    const closed=new Uint8Array(nodes.length),heap=new MinHeap();
    const heuristic=id=>Math.hypot(nodes[id].x-finish.x,nodes[id].z-finish.z);
    for(const id of [start.a,start.b]){
      scores[id]=Math.hypot(nodes[id].x-start.x,nodes[id].z-start.z);
      heap.push({id,f:scores[id]+heuristic(id)});
    }
    let goal=-1,best=Infinity;
    while(heap.length){
      const current=heap.pop(),id=current.id;
      if(current.f>=best)break;
      if(closed[id])continue;closed[id]=1;
      if(id===finish.a||id===finish.b){const total=scores[id]+heuristic(id);if(total<best){best=total;goal=id;}}
      for(const edge of adj[id]){
        const cost=scores[id]+edge.length;
        if(cost>=scores[edge.to])continue;
        scores[edge.to]=cost;parents[edge.to]=id;heap.push({id:edge.to,f:cost+heuristic(edge.to)});
      }
    }
    if(goal<0)return [];
    const path=[];for(let id=goal;id>=0;id=parents[id])path.push({...nodes[id],node:id});
    path.reverse();
    return [start,...path,finish].filter((p,i,a)=>i===0||Math.hypot(p.x-a[i-1].x,p.z-a[i-1].z)>0.1);
  }
  function nearbyEdges(point,radius=220){
    const result=new Set(),minX=Math.floor((point.x-radius)/cell),maxX=Math.floor((point.x+radius)/cell);
    for(let x=minX;x<=maxX;x++)for(let z=Math.floor((point.z-radius)/cell);z<=Math.floor((point.z+radius)/cell);z++){
      for(const index of grid.get(`${x},${z}`)||[])if(projectToSegment(point,nodes[edges[index].a],nodes[edges[index].b]).distance<=radius)result.add(index);
    }
    return [...result];
  }
  function walk(start,seed=1,steps=18){
    const snap=nearest(start);if(!snap)return [];
    let id=seed%2?snap.a:snap.b,previous=-1;const result=[{x:snap.x,z:snap.z},nodes[id]];
    for(let i=0;i<steps;i++){
      const choices=adj[id].filter(e=>e.to!==previous);if(!choices.length)break;
      seed=(seed*16807)%2147483647;const edge=choices[seed%choices.length];previous=id;id=edge.to;result.push(nodes[id]);
    }
    // Reverse at dead ends; the closing segment always follows an existing edge.
    return [...result,...result.slice(1,-1).reverse()];
  }
  return {nearest,route,nearbyEdges,walk,adj};
}

export function pathLength(path){
  let length=0;for(let i=1;i<path.length;i++)length+=Math.hypot(path[i].x-path[i-1].x,path[i].z-path[i-1].z);return length;
}

/** Attach a spatial query to the existing collider array without changing callers. */
export function indexColliders(colliders,cell=50){
  const grid=new Map();
  for(const b of colliders){
    const r=Math.hypot(b.w,b.d)/2;
    for(let x=Math.floor((b.x-r)/cell);x<=Math.floor((b.x+r)/cell);x++)for(let z=Math.floor((b.z-r)/cell);z<=Math.floor((b.z+r)/cell);z++){
      const key=`${x},${z}`;if(!grid.has(key))grid.set(key,[]);grid.get(key).push(b);
    }
  }
  const none=Object.freeze([]);
  colliders.query=(x,z,r=0)=>{
    const x0=Math.floor((x-r)/cell),x1=Math.floor((x+r)/cell),z0=Math.floor((z-r)/cell),z1=Math.floor((z+r)/cell);
    // Most bodies sit inside one cell: hand back its (read-only) list without copying.
    if(x0===x1&&z0===z1)return grid.get(`${x0},${z0}`)||none;
    const found=new Set();for(let gx=x0;gx<=x1;gx++)for(let gz=z0;gz<=z1;gz++)for(const b of grid.get(`${gx},${gz}`)||[])found.add(b);
    return [...found];
  };
  return colliders;
}
