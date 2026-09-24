// GPlates finite rotations. Kept independent of the runtime and file system.
const identity = [1, 0, 0, 0];
const rad = Math.PI / 180;
const normalize = q => { const n = Math.hypot(...q); return q.map(v => v / n); };
const inverse = q => [q[0], -q[1], -q[2], -q[3]];
function multiply(a, b) {
    const [w,x,y,z]=a, [v,i,j,k]=b;
    return normalize([w*v-x*i-y*j-z*k,w*i+x*v+y*k-z*j,w*j-x*k+y*v+z*i,w*k+x*j-y*i+z*v]);
}
function slerp(a,b,t) {
    let dot=a.reduce((s,v,i)=>s+v*b[i],0);
    if(dot<0){b=b.map(v=>-v);dot=-dot;}
    if(dot>0.9995)return normalize(a.map((v,i)=>v+(b[i]-v)*t));
    const theta=Math.acos(Math.min(1,dot)),den=Math.sin(theta);
    return a.map((v,i)=>(v*Math.sin((1-t)*theta)+b[i]*Math.sin(t*theta))/den);
}
function axis(lat,lon,angle) {
    const a=angle*rad/2,s=Math.sin(a),c=Math.cos(lat*rad);
    return [Math.cos(a),s*c*Math.cos(lon*rad),s*c*Math.sin(lon*rad),s*Math.sin(lat*rad)];
}
function parseRotations(text) {
    const sequences=[];
    let sequence;
    for(const line of text.split(/\r?\n/)) {
        if(!/^\s*\d/.test(line))continue;
        const [plate,time,lat,lon,angle,fixed]=line.split('!')[0].trim().split(/\s+/).slice(0,6).map(Number);
        if(![plate,time,lat,lon,angle,fixed].every(Number.isFinite))throw Error('Malformed rotation row');
        if(!sequence || sequence.plate!==plate || sequence.fixed!==fixed || time<sequence.rows.at(-1).time){
            sequence={plate,fixed,rows:[]};sequences.push(sequence);
        }
        sequence.rows.push({time,q:axis(lat,lon,angle)});
    }
    const cache=new Map();
    function at(plate,time,visited=new Set()) {
        if(plate===0)return identity;
        const key=`${plate}:${time}`;
        if(cache.has(key))return cache.get(key);
        if(visited.has(plate))throw Error(`Cyclic rotation circuit: ${plate} at ${time}`);
        const next=new Set(visited);next.add(plate);
        const candidates=sequences.filter(s=>s.plate===plate && s.rows[0].time<=time && s.rows.at(-1).time>=time && s.rows.length>1);
        if(!candidates.length)throw Error(`Missing rotation circuit: ${plate} at ${time}`);
        // At a reference switch, use the sequence extending toward younger time.
        const s=candidates.sort((a,b)=>a.rows[0].time-b.rows[0].time)[0];
        const hi=s.rows.findIndex(r=>r.time>=time),b=s.rows[hi],a=s.rows[Math.max(0,hi-1)];
        const q=b.time===a.time?b.q:slerp(a.q,b.q,(time-a.time)/(b.time-a.time));
        const absolute=multiply(at(s.fixed,time,next),q);cache.set(key,absolute);return absolute;
    }
    return {at};
}
module.exports={parseRotations,multiply,inverse,slerp,axis};
