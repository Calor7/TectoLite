// Reproducible curated source geometry + finite rotations; no runtime downloads.
const fs=require('node:fs');
const path=require('node:path');
const clipping=require('polygon-clipping');
const {parseRotations}=require('./lib/finite-rotations.cjs');
const root=path.resolve(__dirname,'..');
const read=p=>JSON.parse(fs.readFileSync(path.join(root,p),'utf8'));
const rotations=parseRotations(fs.readFileSync(path.join(root,'gplates_references/1000_0_rotfile.rot'),'utf8'));
const covers=[1,2,3,4,5].flatMap(i=>read(`src/assets/gplates-modern-overview-covers-${i}.json`).plates);
const coast=name=>covers.find(p=>p.name===name);
const round=n=>Math.round(n*10000)/10000;
function simplify(ring) {
    const out=[ring[0]];
    for(let i=1;i<ring.length-1;i++) {
        const p=ring[i],q=out.at(-1),dx=((p[0]-q[0]+540)%360)-180;
        if(Math.hypot(dx*Math.cos(p[1]*Math.PI/180),p[1]-q[1])>=0.65)out.push(p);
    }
    if(out.length<3)return ring.map(p=>p.map(round));
    if(out[0][0]!==out.at(-1)[0]||out[0][1]!==out.at(-1)[1])out.push(out[0]);
    return out.map(p=>p.map(round));
}
const multi=rings=>rings.map(r=>[r]);
const eastAfrica=[[32,-40],[60,-40],[60,20],[43,20],[35,5],[32,-40]];
const intersect=(rings,mask)=>clipping.intersection(multi(rings),[mask]).map(p=>p[0]);
const subtract=(rings,...masks)=>clipping.difference(multi(rings),...masks.map(m=>[m])).map(p=>p[0]);
const asia=coast('Asia').rings,africa=coast('Africa').rings;
const specs=[
    ['africa','Africa',701,subtract(africa,eastAfrica)],
    ['somalia','East Africa',5032,intersect(africa,eastAfrica)],
    ['europe','Europe',302,coast('Europe').rings],
    ['asia','Asia',401,asia],
    ['india','India',501,coast('Indian Subcontinent').rings],
    ['arabia','Arabia',503,coast('Arabian Peninsula').rings],
    ['north-america','North America',101,coast('North America').rings],
    ['south-america','South America',201,coast('South America').rings],
    ['antarctica','Antarctica',803,coast('Antarctica').rings],
    ['australia','Australia',801,coast('Australia').rings],
    ['greenland','Greenland',102,coast('Greenland').rings],
    ['madagascar','Madagascar',702,coast('Madagascar').rings]
];
const colors=['#dbac69','#de855a','#bc9670','#bc8c76','#e4b85e','#c59e6f','#9ead76','#77aa86','#a9b6ca','#bd9664','#b4c4bd','#a8b679'];
const parts=specs.map(([id,name,plateId,rings],i)=>({id,name,plateId,color:colors[i],rings:rings.map(simplify).filter(r=>r.length>=4),rotations:Array.from({length:41},(_,n)=>({age:n*5,q:rotations.at(plateId,n*5).map(v=>Math.round(v*1e10)/1e10)}))}));
if(parts.some(p=>!p.rings.length))throw Error('Empty curated region');
const cratons=read('src/assets/gplates-modern-overview-cratons.json').plates.map(p=>({name:p.name,center:p.center,rings:p.rings.map(simplify)}));
const asset={source:'Bundled GPlates finite rotation circuits; representative plate IDs, simplified modern outlines; not a full paleogeography model.',parts,cratons};
fs.writeFileSync(path.join(root,'src/assets/geological-scenario-data.json'),JSON.stringify(asset));
console.log(`${parts.length} regions; ${parts.reduce((s,p)=>s+p.rings.reduce((n,r)=>n+r.length,0),0)} coastline vertices; ${JSON.stringify(asset).length} bytes`);
